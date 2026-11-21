"""Telegram Login and private Bot API delivery. Secrets stay on the server."""
import asyncio
import base64
import hashlib
import http.client
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlencode

import httpx
import jwt
from starlette.exceptions import HTTPException

ISSUER = "https://oauth.telegram.org"
CALLBACK = "https://octoport.ru/telegram/return"
SCOPES = "openid profile telegram:bot_access"


@dataclass(frozen=True, repr=False)
class Config:
    bot: str
    secret: str
    token: str

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
        bot, secret, token = str(data["client_id"]), data["client_secret"], data["bot_token"]
        if not re.fullmatch(r"[1-9][0-9]{0,15}", bot) or not isinstance(secret, str) or not secret.strip():
            raise ValueError("Invalid Telegram login configuration")
        if not re.fullmatch(re.escape(bot) + r":[A-Za-z0-9_-]{20,}", token):
            raise ValueError("Telegram bot and client IDs do not match")
        return cls(bot, secret, token)


def authorize(config, state, verifier, nonce):
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return ISSUER + "/auth?" + urlencode(dict(client_id=config.bot, redirect_uri=CALLBACK,
        response_type="code", scope=SCOPES, state=state, nonce=nonce,
        code_challenge=challenge, code_challenge_method="S256"))


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
    conn = http.client.HTTPSConnection("api.telegram.org", timeout=12)
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
