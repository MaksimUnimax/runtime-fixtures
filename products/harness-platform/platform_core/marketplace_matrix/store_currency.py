"""Resolve monetary units from authenticated seller profiles or the report itself."""
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


# These endpoints declare the reporting currency on every record.
# Only the decoder receives this context. The credential scope stays immutable.
REPORT_ROW_CURRENCY = {
    "wb_finance": ("currency", True),
    "wb_expense": ("currency", True),
    "ds_wb_prices": ("currencyIsoCode4217", True),
    "ds_wb_adstats": ("currency", False),
}


def report_store(operation, records, store, previous_page):
    from finance_stock import CURRENCIES
    from matrix_core import fail

    declaration = REPORT_ROW_CURRENCY.get(operation)
    if declaration is None:
        return store
    field, required = declaration
    currency = store.get("currency") or (previous_page or {}).get("currency")
    for row in records:
        if not required and isinstance(row, dict) and field not in row:
            continue
        code = row.get(field) if isinstance(row, dict) else None
        if not isinstance(code, str) or code not in CURRENCIES:
            fail("FINANCE_CURRENCY")
        if currency is not None and code != currency:
            fail("FINANCE_CURRENCY_CHANGED")
        currency = code
    return {**store, "currency": currency}


def wait_result(due, limited):
    return {"ok": False, "code": "HTTP_429" if limited else "SOURCE_PACING",
            "reason": ("Маркетплейс вернул HTTP 429." if limited else "Источник ограничивает частоту чтений.")
                      + " Следующая разрешённая попытка выходит за время этого запроса.",
            "retryAt": due}


def profile_currency(authority, store):
    from finance_stock import CURRENCIES
    from http_transport import MATRICES, read_response
    from request_recovery import RATE_LIMIT_RETRY_SECONDS

    market = "Wildberries" if store.platform == "wb" else "Ozon"
    prefix = store.platform.upper() + "_SELLER_PROFILE_"
    while True:
        credentials = authority.credentials(authority.pins, asdict(store))
        if store.platform == "wb":
            source = MATRICES["wb_balance"].recipe("wb_balance")
            req = Request(source["url"], headers={"Authorization": credentials["seller_token"]})
        else:
            req = Request(PROFILE_URL, b"{}", headers={"Content-Type": "application/json",
                          "Client-Id": credentials["seller_client_id"], "Api-Key": credentials["seller_api_key"]})
        try:
            body, _ = read_response(req, timeout=min(10, max(.01, authority.deadline-time.time())),
                                    limit=256_000, on_dispatch=authority.check)
        except HTTPError as error:
            if error.code != 429:
                suffix = "ACCESS" if store.platform == "wb" and error.code in (401, 403) else "HTTP"
                raise ProfileError({"ok": False, "code": prefix + suffix,
                    "reason": f"{market} вернул HTTP {error.code} при чтении валюты кабинета."}) from None
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
            raise ProfileError({"ok": False, "code": prefix + "UNAVAILABLE",
                                "reason": f"Не удалось проверить валюту кабинета {market}."}) from None
        authority.check()
        try:
            payload = json.loads(body)
            code = payload["currency"] if store.platform == "wb" else payload["company"]["currency"]
            if isinstance(code, str) and code in CURRENCIES:
                return code
        except (KeyError, TypeError, ValueError):
            pass
        raise ProfileError({"ok": False, "code": prefix + "CURRENCY",
                            "reason": f"{market} не указал поддерживаемый код валюты кабинета."})


def resolve(authority, calls, stores, fields):
    from http_transport import MATRICES
    from registry import DEFINITIONS
    from template_catalog import TEMPLATES, dependencies

    required = {}
    for call in calls:
        cid = call["store_id"]
        platform = stores[cid].platform
        if {"ozon": "seller_api_key", "wb": "seller_token"}[platform] not in fields[cid]:
            continue
        for tid in dependencies(call["template_id"]):
            for step in TEMPLATES[tid]["steps"]:
                op = step.get("operation")
                if step.get("platform") != platform or op not in MATRICES or op in REPORT_ROW_CURRENCY:
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
