"""Telegram Login and private Bot API delivery. Secrets stay on the server."""
import asyncio
import base64
import hashlib
import hmac
import http.client
import json
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode

import httpx
import jwt
from starlette.exceptions import HTTPException

ISSUER = "https://oauth.telegram.org"
SITE_ORIGIN = "https://octoport.ru"
CALLBACK = SITE_ORIGIN + "/telegram/return"
SCOPES = "openid profile telegram:bot_access"


@dataclass(frozen=True, repr=False)
class Config:
    bot: str
    secret: str | None
    token: str
    proxy_port: int | None = None

    @classmethod
    def load(cls):
        path = os.getenv("HARNESS_TELEGRAM_CONFIG_FILE")
        if not path and os.getenv("CREDENTIALS_DIRECTORY"):
            path = Path(os.environ["CREDENTIALS_DIRECTORY"]) / "octoport-telegram.json"
            if not path.exists():
                return None
        if not path:
            return None
        data = json.loads(Path(path).read_text())
        bot, token = str(data["client_id"]), data["bot_token"]
        mode = data.get("auth_mode", "oidc")
        secret = data.get("client_secret")
        if mode not in ("widget", "oidc") or not re.fullmatch(r"[1-9][0-9]{0,15}", bot):
            raise ValueError("Invalid Telegram login configuration")
        if mode == "widget":
            if secret is not None:
                raise ValueError("Unexpected OIDC credentials for domain widget")
        elif not isinstance(secret, str) or not secret.strip():
            raise ValueError("Missing Telegram OIDC client secret")
        if not re.fullmatch(re.escape(bot) + r":[A-Za-z0-9_-]{20,}", token):
            raise ValueError("Telegram bot and client IDs do not match")
        proxy_port = data.get("connect_proxy_port")
        if proxy_port is not None and (type(proxy_port) is not int or not 1 <= proxy_port <= 65535):
            raise ValueError("Invalid loopback proxy port")
        return cls(bot, secret, token, proxy_port)


def authorize(config, state, verifier, nonce):
    if config.secret is None:
        return ISSUER + "/auth?" + urlencode({
            "bot_id": config.bot, "origin": SITE_ORIGIN,
            "request_access": "write", "return_to": CALLBACK + "?" + urlencode({"state": state}),
        })
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return ISSUER + "/auth?" + urlencode(dict(client_id=config.bot, redirect_uri=CALLBACK,
        response_type="code", scope=SCOPES, state=state, nonce=nonce,
        code_challenge=challenge, code_challenge_method="S256"))


def widget_identity(config, user, started):
    invalid = HTTPException(400, "Telegram не подтвердил подключение. Начните его заново.")
    if not isinstance(user, dict) or not {"id", "auth_date", "hash"} <= user.keys() or len(user) > 20:
        raise invalid
    signature = user["hash"]
    if not isinstance(signature, str) or not re.fullmatch(r"[0-9a-f]{64}", signature):
        raise invalid
    lines = []
    for key in sorted(user):
        if key == "hash":
            continue
        value = user[key]
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,63}", key) or type(value) not in (str, int):
            raise invalid
        value = str(value)
        if len(value) > 4096 or "\n" in value or "\r" in value:
            raise invalid
        lines.append(key + "=" + value)
    secret = hashlib.sha256(config.token.encode()).digest()
    expected = hmac.new(secret, "\n".join(lines).encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise invalid
    uid, stamp = str(user["id"]), str(user["auth_date"])
    if not re.fullmatch(r"[1-9][0-9]{0,15}", uid) or not re.fullmatch(r"[0-9]{1,12}", stamp):
        raise invalid
    now = int(time.time())
    if int(uid) >= 2**52 or not max(started - 30, now - 600) <= int(stamp) <= now + 30:
        raise invalid
    return int(uid), signature, int(stamp) + 601


async def verified_user(client, config, code, verifier, nonce):
    try:
        exchange = await client.post(ISSUER + "/token", auth=(config.bot, config.secret),
            data=dict(grant_type="authorization_code", code=code, redirect_uri=CALLBACK, code_verifier=verifier))
        exchange.raise_for_status()
        tokens = exchange.json()
        if "scope" in tokens and "telegram:bot_access" not in tokens["scope"].split():
            raise ValueError("write permission declined")
        token = tokens["id_token"]
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "RS256":
            raise ValueError("unexpected signature algorithm")
        response = await client.get(ISSUER + "/.well-known/jwks.json")
        response.raise_for_status()
        key = jwt.PyJWKSet.from_dict(response.json())[header["kid"]]
        claims = jwt.decode(token, key, algorithms=["RS256"], issuer=ISSUER, audience=config.bot,
            options={"require": ["iss", "aud", "exp", "iat", "sub", "id", "nonce"]})
        uid = claims["id"]
        if claims["nonce"] != nonce or type(uid) is not int or not 0 < uid < 2**52:
            raise ValueError("unverified Telegram identity")
        return uid
    except (httpx.HTTPError, jwt.PyJWTError, ValueError, TypeError, KeyError, AttributeError):
        raise HTTPException(400, "Telegram не подтвердил подключение. Попробуйте ещё раз.") from None


class DeliveryError(Exception):
    def __init__(self, status, delay=0):
        self.status, self.delay = status, delay
        super().__init__(status)


def _post(config, uid, text):
    # httpx logs request URLs at INFO. The Bot API token is part of the URL.
    # Send via a direct TLS connection without request logging or redirects.
    if len(text.encode("utf-16-le")) // 2 <= 4096:
        method = "sendMessage"
        data = {"chat_id": uid, "text": text, "protect_content": True,
                "link_preview_options": {"is_disabled": True}}
        body = json.dumps(data).encode()
        content_type = "application/json"
    else:
        method = "sendDocument"
        encoded = httpx.Request("POST", "https://api.telegram.org",
            data={"chat_id": str(uid), "protect_content": "true", "caption": "Отчёт Октопорта"},
            files={"document": ("octoport-report.txt", text.encode(), "text/plain; charset=utf-8")})
        body, content_type = encoded.read(), encoded.headers["content-type"]
    if config.proxy_port is None:
        conn = http.client.HTTPSConnection("api.telegram.org", timeout=12)
    else:
        # HTTPSConnection checks the certificate of the CONNECT destination.
        conn = http.client.HTTPSConnection("127.0.0.1", config.proxy_port, timeout=12)
        conn.set_tunnel("api.telegram.org", 443)
    try:
        conn.request("POST", "/bot" + config.token + "/" + method, body, {"Content-Type": content_type})
        response = conn.getresponse()
        result = json.loads(response.read(131072))
        if response.status == 429 and result.get("error_code") == 429:
            delay = result.get("parameters", {}).get("retry_after")
            raise DeliveryError("limited", delay if type(delay) is int and delay > 0 else 60)
        if response.status == 403:
            raise DeliveryError("blocked")
        if 400 <= response.status < 500:
            raise DeliveryError("rejected")
        message = result.get("result", {})
        if (response.status != 200 or result.get("ok") is not True or
                message.get("chat", {}).get("id") != uid or message["chat"].get("type") != "private" or
                type(message.get("message_id")) is not int):
            raise DeliveryError("unknown")
        return message["message_id"]
    except (OSError, http.client.HTTPException, ValueError, KeyError, TypeError, AttributeError):
        raise DeliveryError("unknown") from None
    finally:
        conn.close()


async def send(config, uid, text):
    return await asyncio.to_thread(_post, config, uid, text)
