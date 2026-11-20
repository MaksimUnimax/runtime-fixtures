"""Fill the matrix Store from the selected seller's current Ozon account."""
from dataclasses import asdict
from email.utils import parsedate_to_datetime
import json
import time
from urllib.error import HTTPError
from urllib.request import Request

PROFILE_URL = "https://api-seller.ozon.ru/v1/seller/info"


class ProfileError(Exception):
    def __init__(self, result):
        self.result = result
        super().__init__(result["code"])


def wait_result(due, limited):
    return {"ok": False, "code": "HTTP_429" if limited else "SOURCE_PACING",
            "reason": ("Маркетплейс вернул HTTP 429." if limited else "Источник ограничивает частоту чтений.")
                      + " Следующая разрешённая попытка выходит за время этого запроса.",
            "retryAt": due}


def profile_currency(authority, store):
    from finance_stock import CURRENCIES
    from http_transport import read_response
    from request_recovery import RATE_LIMIT_RETRY_SECONDS

    while True:
        credentials = authority.credentials(authority.pins, asdict(store))
        req = Request(PROFILE_URL, b"{}", headers={"Content-Type": "application/json",
                      "Client-Id": credentials["seller_client_id"], "Api-Key": credentials["seller_api_key"]})
        try:
            body, _ = read_response(req, timeout=min(10, max(.01, authority.deadline-time.time())),
                                    limit=256_000, on_dispatch=authority.check)
        except HTTPError as error:
            if error.code != 429:
                raise ProfileError({"ok": False, "code": "OZON_SELLER_PROFILE_HTTP",
                    "reason": f"Ozon вернул HTTP {error.code} при чтении валюты кабинета (company.currency)."}) from None
            now = time.time()
            due = now + RATE_LIMIT_RETRY_SECONDS
            header = error.headers.get("Retry-After", "") if error.headers else ""
            try:
                earliest = now + int(header) if header.isascii() and header.isdigit() else parsedate_to_datetime(header).timestamp()
                due = max(due, earliest)
            except (OverflowError, TypeError, ValueError):
                pass
            if due >= authority.deadline:
                raise ProfileError(wait_result(due, True)) from None
            time.sleep(max(0, due - time.time()))
            continue
        except OSError:
            raise ProfileError({"ok": False, "code": "OZON_SELLER_PROFILE_UNAVAILABLE",
                                "reason": "Не удалось прочитать профиль продавца Ozon для проверки валюты."}) from None
        authority.check()
        try:
            code = json.loads(body)["company"]["currency"]
            if isinstance(code, str) and code in CURRENCIES:
                return code
        except (KeyError, TypeError, ValueError):
            pass
        raise ProfileError({"ok": False, "code": "OZON_SELLER_PROFILE_CURRENCY",
                            "reason": "В поле company.currency профиля продавца Ozon нет поддерживаемого кода валюты."})


def resolve(authority, calls, stores, fields):
    from http_transport import MATRICES
    from registry import DEFINITIONS
    from template_catalog import TEMPLATES, dependencies

    required = {}
    for call in calls:
        cid = call["store_id"]
        if stores[cid].platform != "ozon" or "seller_api_key" not in fields[cid]:
            continue
        for tid in dependencies(call["template_id"]):
            for step in TEMPLATES[tid]["steps"]:
                op = step.get("operation")
                if step.get("platform") != "ozon" or op not in MATRICES:
                    continue
                recipe = MATRICES[op].recipe(op)
                if recipe["response"]["currency"] != {"$path": ["store", "currency"]}:
                    continue
                strict = not recipe.get("options", {}).get("allow_null_currency", False)
                monetary = any(DEFINITIONS.get(metric, {}).get("unit", "").startswith("currency")
                               for metric in step.get("bind", {}).get("metrics", ()))
                if strict or monetary:
                    required[cid] = strict or required.get(cid, False)
    for cid, strict in required.items():
        try:
            authority.currencies[cid] = profile_currency(authority, stores[cid])
        except ProfileError as error:
            # Some analytics sources explicitly permit an unknown currency.
            if strict or error.result["code"] == "HTTP_429":
                raise
