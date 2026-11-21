"""Direct provider contracts. Every dispatch rechecks the supplier's price or hard free plan."""
import json
import os
import re
from decimal import Decimal, InvalidOperation
from email.utils import parsedate_to_datetime
from pathlib import Path
from time import time
from urllib.parse import urlsplit

import httpx
from cryptography.exceptions import InvalidTag
from .chat_connections import VaultUnavailable

from .chat_connections import vault_cipher


class Refused(Exception):
    def __init__(self, reason, delay=90):
        self.reason, self.delay = reason, delay
        super().__init__(reason)


def config():
    default = Path(__file__).resolve().parents[1] / "deploy/model-hub/direct-routes.json"
    rows = json.loads(Path(os.getenv("HARNESS_HUB_ROUTES_FILE") or default).read_text())
    routes = {}
    for row in rows:
        for url in [row["url"], row.get("price_url", row["url"])]:
            parsed = urlsplit(url)
            if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.query or parsed.fragment:
                raise ValueError("Expected an HTTPS provider endpoint")
        if (row["policy"] not in {"google-gemma","workers-free","atlas-zero","zai-flash"}
                or row["scope"] not in {"private","public"} or not 1 <= row["slots"] <= 32):
            raise ValueError("Invalid direct route")
        identity = row["provider"], row["model"]
        if identity in routes:
            raise ValueError("Duplicate direct route")
        routes[identity] = row
    return routes


def secret(key):
    blob = key["sealed"]
    aad = json.dumps(["model-hub",key["provider"],key["id"]]).encode()
    return vault_cipher().decrypt(blob[:12],blob[12:],aad).decode()


def response_ok(response):
    if response.is_success:
        return
    status = response.status_code
    retry = response.headers.get("retry-after","")
    try:
        seconds = int(retry) if retry.isdigit() else int(parsedate_to_datetime(retry).timestamp()-time())
    except (ValueError,TypeError,OverflowError):
        seconds = 300
    raise Refused("HTTP "+str(status), max(1,seconds) if status==429 else 600 if status in {401,402,403,404} else 60)


async def tariff(http, spec, key):
    base = spec["url"].rstrip("/")
    if spec["policy"] == "google-gemma":
        if spec["model"] not in {"gemma-4-31b-it","gemma-4-26b-a4b-it"}:
            raise Refused("Неизвестный тариф Gemma")
        page = await http.get(spec["price_url"],timeout=8)
        response_ok(page)
        section = re.search(r'(?m)^## [^\n]*id="gemma-4"[^\n]*\n([\s\S]*?)(?=^## |\Z)',page.text)
        for kind in ("Input price","Output price","Context caching price",r"Context caching \(storage\)"):
            if not section or not re.search(r'\* '+kind+r'\s+\* Free of charge\s+\* Not available\s',section[1]):
                raise Refused("Бесплатный тариф Google не подтверждён")
    elif spec["policy"] == "zai-flash":
        page = await http.get(spec["price_url"], timeout=8)
        response_ok(page)
        header = ["Model", "Input", "Cached Input", "Cached Input Storage", "Output"]
        model_id = spec["model"]
        token = re.compile(r"(?<![a-z0-9_.-])" + re.escape(model_id) + r"(?![a-z0-9_.-])", re.I)
        columns = []
        matches = []
        for line in page.text.splitlines():
            line = line.lstrip("> ").strip()
            if "|" not in line:
                columns = []
                continue
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if cells[0] == "Model":
                columns = cells
            if token.search(cells[0]):
                matches.append(cells[0].lower() == model_id and columns == header and cells[1:] == ["Free"] * 4)
        if matches != [True]:
            raise Refused("Z.ai не подтвердил нулевые ставки для этой модели")
    elif spec["policy"] == "atlas-zero":
        response = await http.get(base+"/models",headers={"Authorization":"Bearer "+secret(key)},timeout=8)
        response_ok(response)
        row = next((r for r in response.json()["data"] if r["id"]==spec["model"]),{})
        rates = row.get("pricing",{})
        if (not isinstance(rates,dict) or not {"prompt","completion","request"}.issubset(rates)
                or any(isinstance(v,bool) or not Decimal(str(v)).is_zero() for v in rates.values())):
            raise Refused("Atlas не подтвердил нулевые ставки")
    else:
        if not key["account_id"]:
            raise Refused("Требуется Account ID")
        base = base.format(account=key["account_id"])
        account_url = base.removesuffix("/ai/v1")
        response = await http.get(account_url+"/subscriptions",headers={"Authorization":"Bearer "+secret(key)},timeout=8)
        if response.status_code == 403:
            raise Refused("Cloudflare: Billing Read, HTTP 403",600)
        response_ok(response)
        sub = response.json()
        tiers = [str((r.get("rate_plan") or {}).get("public_name","")).strip().lower() for r in sub["result"]]
        if (sub.get("success") is not True or not any(t in {"workers free","workers free plan"} for t in tiers)
                or any("workers" in t and t not in {"workers free","workers free plan"} for t in tiers)
                or sub.get("result_info",{}).get("total_pages",1)>1):
            raise Refused("План Workers Free не подтверждён")
    return base


PROBE = {"messages":[{"role":"user","content":"Call report with market Ozon and orders 7. After the tool responds, give the order count and the sum of both cancellation counts."}],
         "tools":[{"type":"function","function":{"name":"report","description":"Record marketplace order count",
         "parameters":{"type":"object","properties":{"market":{"type":"string"},"orders":{"type":"integer"}},
         "required":["market","orders"]}}}],"max_tokens":1400}


async def call(http, spec, key, request, timeout):
    try:
        if spec["policy"] == "zai-flash" and any(t.get("type") != "function" for t in request.get("tools", [])):
            raise Refused("Встроенные платные инструменты Z.ai отключены")
        base = await tariff(http,spec,key)
        payload = {k:request[k] for k in ("messages","tools","max_tokens") if k in request}
        response = await http.post(base+"/chat/completions",headers={"Authorization":"Bearer "+secret(key)},
                                   json={**payload,"model":spec["model"],"stream":False},timeout=timeout)
        response_ok(response)
        data=response.json()
        choice=data["choices"][0]
        msg=choice["message"]
        content=msg.get("content")
        if isinstance(content,str) and content.lstrip().startswith("<thought>"):
            _,closed,answer=content.partition("</thought>")
            msg={**msg,"content":answer.strip() if closed else ""}
        calls=msg.get("tool_calls") or []
        if choice["finish_reason"] not in {"tool_calls","stop","length"} or not (calls or msg.get("content")):
            raise Refused("Неполный ответ модели")
        names={tool["function"]["name"] for tool in request.get("tools",[])}
        if any(c["function"]["name"] not in names or not isinstance(c["id"],str)
               or not isinstance(json.loads(c["function"]["arguments"]),dict) for c in calls):
            raise Refused("Недопустимый вызов инструмента")
        if bool(calls)!=(choice["finish_reason"]=="tool_calls"):
            raise Refused("Ответ и причина завершения расходятся")
        usage=data.get("usage") or {}
        if "cost" in usage and not Decimal(str(usage["cost"])).is_zero():
            raise Refused("Поставщик сообщил платное списание",86400)
        return {"message":msg,"finish_reason":choice["finish_reason"]},usage
    except httpx.TimeoutException:
        raise Refused("Тайм-аут",45) from None
    except (httpx.HTTPError,ValueError,KeyError,IndexError,TypeError,AttributeError,InvalidTag,VaultUnavailable,InvalidOperation):
        raise Refused("Ошибка транспорта или формата ответа") from None
