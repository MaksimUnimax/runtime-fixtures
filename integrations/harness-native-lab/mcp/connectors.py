"""Two bounded read adapters; no hidden selector, answer model, or arbitrary HTTP."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import importlib
from pathlib import Path
import re
import sys
from typing import Callable
from zoneinfo import ZoneInfo

import httpx

from config import read_json, strict_json
from errors import LabError

YANDEX_URL = "https://searchapi.api.cloud.yandex.net/v2/wordstat/topRequests"
OZON_URL = "https://api-seller.ozon.ru/v1/analytics/data"
OZON_STOCKS_URL = "https://api-seller.ozon.ru/v4/product/info/stocks"
YANDEX_COMMIT = "08989e4d34db20bfd9f43d5becf90ab1d2e2fbff"
FRESHNESS_WARNING = ("По официальной документации Wordstat, проверенной 18.11.2026, "
                     "статистика после 07.10.2026 недоступна. Время получения ответа не означает свежесть статистики.")


@dataclass
class Prepared:
    provider: str
    source: dict
    body: dict
    headers: dict
    decoder: Callable[[dict], dict]
    ttl: int
    interval: int
    maximum: int
    identity: dict

    @property
    def url(self):
        return self.source["url"]


def credential_string(value, *, minimum=1, maximum=8192):
    if not isinstance(value, str) or not minimum <= len(value) <= maximum or "\r" in value or "\n" in value:
        raise LabError("CREDENTIAL_UNAVAILABLE", "Закрытые учётные данные коннектора не настроены.")
    return value


def safe_phrase(value: str) -> str:
    if (not isinstance(value, str) or not 1 <= len(value.strip()) <= 400 or
            any(ord(ch) < 32 for ch in value) or
            re.search(r"(?i)(?:bearer\s+\S+|api[_ -]?key\s*[:=]|oauth[_ -]?token\s*[:=]|seller[_ -]?token\s*[:=])", value)):
        raise LabError("INVALID_PHRASE", "Нужна обычная поисковая фраза длиной до 400 символов; секреты не принимаются.")
    return value.strip()


def natural(value):
    if isinstance(value, str) and re.fullmatch(r"[0-9]{1,30}", value):
        return int(value)
    if type(value) is int and value >= 0:
        return value
    raise LabError("UPSTREAM_SCHEMA", "Провайдер вернул неподтверждённый формат данных.")


def yandex(config: dict, arguments: dict) -> Prepared:
    phrase = safe_phrase(arguments["phrase"])
    limit = arguments.get("limit", 20)
    regions = arguments.get("regions", ["225"])
    device = arguments.get("device", "all")
    if type(limit) is not int or not 1 <= limit <= 50:
        raise LabError("INVALID_LIMIT")
    if (not isinstance(regions, list) or not 1 <= len(regions) <= 5 or
            any(not isinstance(x, str) or not re.fullmatch(r"[0-9]{1,10}", x) for x in regions) or
            len(set(regions)) != len(regions)):
        raise LabError("INVALID_REGIONS")
    devices = {"all": "DEVICE_ALL", "desktop": "DEVICE_DESKTOP", "phone": "DEVICE_PHONE", "tablet": "DEVICE_TABLET"}
    if device not in devices:
        raise LabError("INVALID_DEVICE")
    credential = read_json(config["credential_file"])
    key = credential_string(credential.get("api_key"), minimum=12)
    folder = credential_string(credential.get("folder_id"), maximum=50)
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,50}", folder):
        raise LabError("CREDENTIAL_UNAVAILABLE")
    body = {"phrase": phrase, "numPhrases": limit, "regions": regions,
            "devices": [devices[device]], "folderId": folder}

    def decode(raw):
        if not isinstance(raw, dict) or not {"totalCount", "results"} <= set(raw):
            raise LabError("UPSTREAM_SCHEMA")
        def rows(name, cap):
            items = raw.get(name, [])
            if not isinstance(items, list) or len(items) > cap:
                raise LabError("UPSTREAM_SCHEMA")
            out = []
            for row in items:
                if not isinstance(row, dict) or not isinstance(row.get("phrase"), str) or not 1 <= len(row["phrase"]) <= 2000:
                    raise LabError("UPSTREAM_SCHEMA")
                out.append({"phrase": row["phrase"], "count": natural(row.get("count"))})
            return out
        return {"seed": phrase, "total_count": natural(raw["totalCount"]),
                "phrases": rows("results", limit), "associations": rows("associations", 20),
                "regions": regions, "device": device,
                "coverage": "Один ограниченный GetTop; это не полное семантическое ядро и не прогноз продаж.",
                "statistics_available_through": "2026-10-07", "warnings": [FRESHNESS_WARNING],
                "provider_price_estimate": {"amount": "0.02", "currency": "RUB", "as_of": "2026-11-18",
                                            "basis": "20 RUB / 1000 GetTop; estimate, not an invoice"}}

    return Prepared("yandex", {"provider": "yandex-wordstat", "operation": "GetTop", "url": YANDEX_URL,
                               "upstream_commit": YANDEX_COMMIT,
                               "implementation_reference": "MaksimUnimax/Yandex_direct:extension/src/shared/wordstat_protocol.js"},
                    body, {"Authorization": "Api-Key " + key}, decode, 21600, 1,
                    config["max_daily_requests"], {"credential_file": config["credential_file"], "folder_id": folder})


_CORE_ROOT = None


def native_modules(root: str):
    global _CORE_ROOT
    path = Path(root).resolve()
    if not path.is_dir() or not (path / "scalar_runtime.py").is_file():
        raise LabError("NATIVE_MATRIX_UNAVAILABLE")
    if _CORE_ROOT is not None and _CORE_ROOT != path:
        raise LabError("NATIVE_MATRIX_ROOT_CHANGED", "Для смены версии матрицы требуется перезапуск лабораторного процесса.")
    if _CORE_ROOT is None:
        sys.path.insert(0, str(path))
        _CORE_ROOT = path
    try:
        scalar = importlib.import_module("scalar_runtime")
        transport = importlib.import_module("http_transport")
        providers = importlib.import_module("providers")
        if Path(scalar.__file__).resolve().parent != path:
            raise LabError("NATIVE_MATRIX_ROOT_CHANGED")
        return scalar, transport, providers
    except LabError:
        raise
    except Exception:
        raise LabError("NATIVE_MATRIX_UNAVAILABLE") from None


def dates(arguments: dict, now: datetime | None = None) -> dict:
    """Absolute or canonical relative dates, resolved by the server's Moscow clock.

    For an ambiguous natural-language "yesterday" the model must send
    period=yesterday; it must never invent YYYY-MM-DD from its own clock.
    """
    if arguments == {"period": "yesterday"}:
        today = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("Europe/Moscow")).date()
        target = (today - timedelta(days=1)).isoformat()
        return {"from": target, "to": target}
    if "period" in arguments:
        raise LabError("INVALID_PERIOD", "Для относительной даты поддерживается только period=yesterday.")
    try:
        start, end = arguments["date_from"], arguments["date_to"]
        if not all(isinstance(v, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) for v in (start, end)):
            raise ValueError("shape")
        a, b = date.fromisoformat(start), date.fromisoformat(end)
        today = (now or datetime.now(timezone.utc)).astimezone(ZoneInfo("Europe/Moscow")).date()
        if not 1 <= (b - a).days + 1 <= 31 or b >= today:
            raise ValueError("range")
        return {"from": start, "to": end}
    except (KeyError, ValueError, TypeError):
        raise LabError("INVALID_PERIOD", "Нужен завершённый период от 1 до 31 дня в формате ГГГГ-ММ-ДД (время Москвы).") from None


def ozon(config: dict, arguments: dict) -> Prepared:
    return _ozon_scalar(config, arguments, snapshot=False)


def ozon_stock_snapshot(config: dict, arguments: dict) -> Prepared:
    if arguments:
        raise LabError("UNKNOWN_ARGUMENT")
    return _ozon_scalar(config, arguments, snapshot=True)


def _ozon_scalar(config: dict, arguments: dict, *, snapshot: bool) -> Prepared:
    today = datetime.now(timezone.utc).astimezone(ZoneInfo("Europe/Moscow")).date().isoformat()
    period = {"from": today, "to": today} if snapshot else dates(arguments)
    recipe = "ozon_stocks" if snapshot else "ozon"
    operation = "ozon_stocks" if snapshot else "ozon_orders"
    expected_url = OZON_STOCKS_URL if snapshot else OZON_URL
    metrics = (["stock_fbo_units", "stock_fbs_units", "stock_fbo_reserved", "stock_fbs_reserved"]
               if snapshot else ["ordered_units", "ordered_revenue"])
    native = read_json(config["native_runtime_file"], private=False, maximum=2_000_000)
    if native.get("execution_enabled") is not True:
        raise LabError("SOURCE_DISABLED")
    accounts = native.get("accounts", {})
    matches = [s for account in accounts.values() if isinstance(account, dict) and account.get("active") is True
               for s in account.get("stores", []) if isinstance(s, dict) and s.get("id") == config["native_store_id"]]
    if len(matches) != 1 or matches[0].get("platform") != "ozon":
        raise LabError("STORE_SCOPE_DENIED", "Лабораторный доступ к этому магазину не подтверждён.")
    store = matches[0]
    if str(store.get("source_revision", "")).startswith("platform:"):
        raise LabError("STORE_SCOPE_DENIED")
    scalars, http_transport, provider_types = native_modules(config["core_root"])
    plan = {"period": period, "filters": {}}
    task = {"recipe": recipe, "role": "current", "metrics": metrics, "period": period}
    credential_path = Path(config["credential_file"])
    try:
        request = provider_types.Request(**scalars.MATRIX.build(plan, store, task))
        if request.operation != operation:
            raise LabError("OPERATION_NOT_ALLOWED")
        transport = http_transport.HTTPTransport(credential_path.parent, {store["id"]: credential_path.name},
                                                native.get("qualifications", {}), enabled=True)
        matrix = transport._qualification(request.operation)
        transport._scope(request, store)
        transport._scoped_qualification(matrix, request, store)
        credentials = read_json(credential_path)
        method, url, headers, body = matrix.http(request.operation, request.body, store, credentials)
        if method != "POST" or url != expected_url or request.body != body:
            raise LabError("OPERATION_NOT_ALLOWED")
    except LabError:
        raise
    except Exception as error:
        code = getattr(error, "code", "NATIVE_MATRIX_REJECTED")
        code = code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,100}", code) else "NATIVE_MATRIX_REJECTED"
        raise LabError(code, "Штатная матрица не подтвердила разрешение или параметры источника.") from None

    def decode(raw):
        try:
            result = scalars.MATRIX.decode(raw, plan, store, task)
            if result.get("complete") is not True or result.get("progress") is not None:
                raise LabError("INCOMPLETE_DATA", "Источник не подтвердил полноту отчёта.")
            values = result["values"]
            if snapshot:
                return {"report": "stock_snapshot", "product_count": result["rows"],
                        "fbo": {"present_units": natural(values["stock_fbo_units"]),
                                "reserved_units": natural(values["stock_fbo_reserved"])},
                        "fbs": {"present_units": natural(values["stock_fbs_units"]),
                                "reserved_units": natural(values["stock_fbs_reserved"])},
                        "basis": "Текущее состояние источника Ozon; FBO и FBS раздельно. Резерв показан отдельно и не вычитается повторно из present.",
                        "coverage": "Полный набор товаров, подтверждённый штатным decoder по identity/total/cursor; максимум одна страница до 1000 товаров.",
                        "warnings": ["Снимок на время получения; исторические остатки этим методом не восстанавливаются."]}
            units = natural(values["ordered_units"])
            money = str(Decimal(values["ordered_revenue"]))
            currency = result["currency"]
            return {"report": "orders", "period": period, "ordered_units": units,
                    "ordered_revenue": money, "currency": currency,
                    "source_rows": result["rows"],
                    "basis": "Заказы по аналитике Ozon за период; это не выплата продавцу и не прибыль.",
                    "warnings": [] if currency else ["Валюта источника не подтверждена."]}
        except LabError:
            raise
        except Exception as error:
            code = getattr(error, "code", "UPSTREAM_SCHEMA")
            code = code if isinstance(code, str) and re.fullmatch(r"[A-Z0-9_]{1,100}", code) else "UPSTREAM_SCHEMA"
            raise LabError(code, "Нативный обработчик отверг неполные или противоречивые данные; итог не выдуман.") from None

    return Prepared("ozon", {"provider": "ozon", "operation": operation, "url": expected_url,
                             "matrix_hash": scalars.MATRIX.hash, "source_hash": scalars.SOURCES.fingerprint(operation),
                             "dependency": "existing Alisa scalar matrix and read-only source qualification"},
                    body, headers, decode, 120 if snapshot else 900,
                    max(2 if snapshot else 61, request.interval), min(50, config["max_daily_requests"]),
                    {"store": store, "core_root": str(_CORE_ROOT), "credential_file": str(credential_path)})


def safe_provider_diagnostic(raw: bytes) -> dict:
    """Expose only numeric/fixed-enum code and fixed reason, never reflected provider prose."""
    try:
        value = strict_json(raw)
        if not isinstance(value, dict):
            return {}
        code = value.get("code")
        result = {}
        if type(code) is int and -10000 <= code <= 10000:
            result["provider_code"] = code
        elif code in ("RESOURCE_EXHAUSTED", "PERMISSION_DENIED", "UNAUTHENTICATED", "INVALID_ARGUMENT"):
            result["provider_code"] = code
        message = value.get("message")
        if isinstance(message, str) and len(message) <= 4000:
            if re.search(r"rate limit per second", message, re.I):
                result["provider_reason"] = "RATE_LIMIT_PER_SECOND"
            elif re.search(r"rate limit per minute", message, re.I):
                result["provider_reason"] = "RATE_LIMIT_PER_MINUTE"
            elif re.search(r"(?:daily|per day).*(?:limit|quota)|(?:limit|quota).*(?:daily|per day)", message, re.I):
                result["provider_reason"] = "DAILY_QUOTA"
        return result
    except (ValueError, TypeError, UnicodeError):
        return {}


async def request_json(prepared: Prepared, *, transport=None) -> dict:
    if prepared.url not in {YANDEX_URL, OZON_URL, OZON_STOCKS_URL}:
        raise LabError("ENDPOINT_NOT_ALLOWED")
    try:
        async with httpx.AsyncClient(transport=transport, timeout=httpx.Timeout(30, connect=10),
                                    follow_redirects=False, trust_env=False) as client:
            async with client.stream("POST", prepared.url, headers={**prepared.headers, "Content-Type": "application/json"},
                                     json=prepared.body) as response:
                if response.status_code != 200:
                    retry = response.headers.get("Retry-After", "")
                    seconds = min(86400, int(retry)) if re.fullmatch(r"\d{1,8}", retry) else None
                    diagnostic = {}
                    try:
                        limited = bytearray()
                        async for chunk in response.aiter_bytes():
                            limited.extend(chunk[:8193 - len(limited)])
                            if len(limited) > 8192:
                                break
                        if len(limited) <= 8192:
                            diagnostic = safe_provider_diagnostic(bytes(limited))
                    except httpx.HTTPError:
                        pass  # The received HTTP status is already definitive.
                    raise LabError(f"UPSTREAM_HTTP_{response.status_code}",
                                   "Провайдер отклонил запрос. Автоматический повтор не выполнялся.",
                                   retry_after=seconds, **diagnostic)
                chunks, size = [], 0
                async for chunk in response.aiter_bytes():
                    size += len(chunk)
                    if size > 2_000_000:
                        raise LabError("UPSTREAM_RESPONSE_LIMIT", "Ответ провайдера превышает лимит лабораторного инструмента.")
                    chunks.append(chunk)
        try:
            value = strict_json(b"".join(chunks), parse_float=Decimal)
        except (ValueError, UnicodeError):
            raise LabError("UPSTREAM_JSON", "Провайдер вернул неподтверждённый формат ответа.") from None
        if not isinstance(value, dict):
            raise LabError("UPSTREAM_SCHEMA")
        return value
    except LabError:
        raise
    except (httpx.HTTPError, OSError):
        raise LabError("UPSTREAM_OUTCOME_UNKNOWN", "Связь прервалась: выполнение запроса у провайдера неизвестно. Автоматического повтора нет.", unknown=True) from None
