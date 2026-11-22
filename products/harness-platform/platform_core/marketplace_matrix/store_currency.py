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


def wait_result(due, code=None):
    reason = {
        "HTTP_429": "Площадка временно ограничила частоту запросов.",
        "PROVIDER_SERVER_ERROR": "Площадка вернула внутреннюю ошибку при получении отчёта.",
        "PROVIDER_READ_UNAVAILABLE": "Ответ площадки получить не удалось.",
    }.get(code, "Следующий запрос к площадке будет доступен позже.")
    return {"ok": False, "code": code or "SOURCE_PACING", "reason": reason, "retryAt": due}


def retry_time(headers, now, wildberries=False):
    """Earliest permitted provider retry, including WB's delay in seconds."""
    if not headers:
        return None
    times = []
    for name in (("Retry-After", "X-Ratelimit-Retry") if wildberries else ("Retry-After",)):
        raw = (headers.get(name) or "").strip()
        try:
            if raw.isascii() and raw.isdigit():
                times.append(now + int(raw))
            elif raw and name == "Retry-After":
                times.append(parsedate_to_datetime(raw).timestamp())
        except (OverflowError, OSError, TypeError, ValueError):
            continue
    return max(times, default=None)


def profile_currency(authority, store):
    from finance_stock import CURRENCIES
    from http_transport import MATRICES, read_response
    from request_recovery import RATE_LIMIT_RETRY_SECONDS

    from . import ozon_retry
    previous = None
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
        def dispatch():
            authority.check()
            if previous and authority.resume_rate_limits:
                authority.ozon_notice(ozon_retry.SENDING_NOTICE)
        try:
            body, _ = read_response(req, timeout=min(10, max(.01, authority.deadline-time.time())),
                                    limit=256_000, on_dispatch=dispatch)
        except HTTPError as error:
            if error.code != 429:
                suffix = "ACCESS" if store.platform == "wb" and error.code in (401, 403) else "HTTP"
                raise ProfileError({"ok": False, "code": prefix + suffix,
                    "reason": f"{market} вернул HTTP {error.code} при чтении валюты кабинета."}) from None
            now = time.time()
            indicated = retry_time(error.headers, now, store.platform == "wb")
            error.close()
            if store.platform == "ozon":
                previous = ozon_retry.plan(indicated, now)
                due = previous.due
                if authority.resume_rate_limits:
                    authority.ozon_notice(previous.waiting())
            else:
                due = max(now + RATE_LIMIT_RETRY_SECONDS, indicated or 0)
            if authority.resume_rate_limits:
                if due > time.time():
                    authority.wait_for_provider(due)
            elif due >= authority.deadline:
                raise ProfileError(wait_result(due, "HTTP_429")) from None
            else:
                time.sleep(max(0, due - time.time()))
            continue
        except OSError:
            raise ProfileError({"ok": False, "code": prefix + "UNAVAILABLE",
                                "reason": f"Не удалось проверить валюту кабинета {market}."}) from None
        authority.check()
        if previous and authority.resume_rate_limits:
            authority.ozon_notice(ozon_retry.RECEIVED_NOTICE)
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
    from query_program import program_for_metrics
    from template_catalog import TEMPLATES, dependencies

    required = {}
    for call in calls:
        cid = call["store_id"]
        platform = stores[cid].platform
        if {"ozon": "seller_api_key", "wb": "seller_token"}[platform] not in fields[cid]:
            continue
        for tid in dependencies(call["template_id"]):
            template = TEMPLATES[tid]
            if template["kind"] in ("scalar", "formula"):
                program = program_for_metrics(template["metrics"], call["input"])
                if program["requires_confirmed_currency"]:
                    required[cid] = True
            for step in template["steps"]:
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
    for call in calls:
        cid = call["store_id"]
        for tid in dependencies(call["template_id"]):
            template = TEMPLATES[tid]
            if any(step.get("operation") == "ds_wb_adstats" for step in template["steps"]):
                required[cid] = True
            if template.get("parameter_report") == "economics.unit_forecast.v1":
                required[cid] = True
    for cid, strict in required.items():
        try:
            authority.currencies[cid] = profile_currency(authority, stores[cid])
        except ProfileError as error:
            # Some analytics sources explicitly permit an unknown currency.
            if strict or error.result["code"] == "HTTP_429":
                raise
