"""Read templates from the audited marketplace methods. Discovery is on demand."""
from collections import Counter
from dataclasses import asdict
from datetime import date, datetime, time as day_time
from decimal import Decimal
from functools import lru_cache
import json
from pathlib import Path
import re
from types import SimpleNamespace
import time
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request
from zoneinfo import ZoneInfo

from . import ozon_report_file, wb_documents

CREDENTIALS = {
    "seller": {"seller_client_id", "seller_api_key"},
    "performance": {"performance_client_id", "performance_client_secret"},
    "wb": {"seller_token"},
}
REASONS = {
    "source": "Требуется подтверждённая схема запроса и ответа площадки.",
    "workflow": "Требуется привязка к сценарию формирования и выдачи отчёта.",
    "protected": "Требуется безопасная проекция или выдача файла владельцу.",
    "service_token": "Требуется сервисный токен Wildberries.",
    "callback": "Требуется проверка зарегистрированного адреса уведомлений.",
    "effect": "Метод генерирует уникальные баркоды. Требуется подтверждение отсутствия записи на площадке.",
}
PAGE_SIZE = 12
SUPPLEMENTAL_HOSTS = {
    "seller": {"api-seller.ozon.ru"},
    "wb": {"advert-api.wildberries.ru", "content-api.wildberries.ru", "common-api.wildberries.ru",
           "marketplace-api.wildberries.ru", "seller-analytics-api.wildberries.ru", "supplies-api.wildberries.ru"},
}
REPORT_KEYS = {"uuid", "reportid", "reportcode", "taskid", "downloadid", "fileguid"}
WB_ACQUIRING_LIST = "read.wb.finance_acquiring_reports"
WB_ACQUIRING_DETAIL = "read.wb.finance_acquiring_detail_report"
WB_ACQUIRING_REPORT_PREFIX = "wb-acquiring-report:"


@lru_cache(maxsize=1)
def cards():
    items = json.loads(Path(__file__).with_name("read_templates.json").read_bytes())
    result = {row["id"]: row for row in items}
    if len(result) != len(items):
        raise ValueError("Duplicate marketplace read template")
    return result


def supported(card, provider, fields):
    profile = card["profile"]
    return (provider == ("wb" if profile == "wb" else "ozon")
            and CREDENTIALS[profile] <= set(fields))


def discover(query, offset, provider, fields):
    normalized = query.strip().casefold()
    refs = {ref.lstrip("/").rstrip(".") for ref in re.findall(
        r"(?<![\w./])(?:read\.(?:seller|performance|wb)\.[\w-]+|/?(?:api|v\d+)/[a-z0-9_/{}/.-]+)",
        normalized,
    )}
    exact = {
        card["id"] for card in cards().values()
        if card["id"].casefold() in refs or card["path"].casefold().lstrip("/") in refs
    }
    words = {word for word in re.findall(r"\w+", normalized) if len(word) > 2}
    candidates = []
    for card in cards().values():
        if not supported(card, provider, fields):
            continue
        if exact:
            if card["id"] in exact:
                candidates.append((0, card))
            continue
        search = " ".join(card.get(k, "") for k in ("id", "purpose", "category", "path", "searchTerms")).casefold()
        score = sum(len(word) for word in words if word in search)
        if not words or score:
            candidates.append((score, card))
    candidates.sort(key=lambda match: (-match[0], match[1]["state"] != "ready", match[1]["id"]))
    selected = [describe(card) for _, card in candidates[offset:offset + PAGE_SIZE]]
    next_offset = offset + PAGE_SIZE
    return {"templates": selected, "total": len(candidates),
            "nextOffset": next_offset if next_offset < len(candidates) else None}


def describe(card):
    description = {k: card[k] for k in ("id", "http", "path", "purpose", "category", "state", "access")}
    if "input" in card:
        description["input"] = card["input"]
    if "requestGuide" in card:
        description["requestGuide"] = card["requestGuide"]
    if "responseGuide" in card:
        description["responseGuide"] = card["responseGuide"]
    if card["state"] != "ready":
        description["reason"] = REASONS[card["state"]]
    return description


def _identifier_params(params, acquiring_report_id=None):
    """Pass only business identifiers to the existing provenance validator."""
    aliases = {"nm": "nmId", "orders": "orderIds", "adverts": "advertIds",
               "barcode": "barcodeId", "barcodes": "barcodeIds", "subject": "subjectId",
               "supply": "supplyId"}
    names = {"postingnumber", "postingnumbers", "orderuid", "cursor", "next"} | REPORT_KEYS
    if isinstance(params, list):
        return [_identifier_params(item, acquiring_report_id) for item in params]
    if isinstance(params, dict):
        result = {}
        for k, v in params.items():
            name = k.lower().replace("_", "").replace("-", "")
            if name == "limitbysku":
                continue
            if name in REPORT_KEYS and v:
                if name == "reportid" and str(v) == acquiring_report_id:
                    continue
                from semantics import Rejected
                raise Rejected("READ_FILE_PROVENANCE_REQUIRED")
            if name in aliases or name in names or name.endswith(("id", "ids", "sku", "skus")):
                key = aliases.get(name, name)
                result[key] = [item.strip() for item in v.split(",")] if isinstance(v, str) and key.lower().endswith("ids") else v
            elif isinstance(v, (dict, list)):
                result[k] = _identifier_params(v, acquiring_report_id)
        return result
    return params


def observed_ids(value, key=""):
    """Read identifiers from provider data, excluding free text and file references."""
    if isinstance(value, dict):
        for name, child in value.items():
            yield from observed_ids(child, name.lower().replace("_", "").replace("-", ""))
    elif isinstance(value, list):
        for child in value:
            yield from observed_ids(child, key)
    elif (key not in REPORT_KEYS and
          (key.endswith(("id", "ids", "sku", "skus")) or key in {"postingnumber", "orderuid"}) and
          (type(value) is int or isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value))):
        yield str(value)


def observed_acquiring_reports(data):
    if isinstance(data, list):
        for row in data:
            if isinstance(row, dict) and type(report_id := row.get("reportId")) is int and report_id > 0:
                yield WB_ACQUIRING_REPORT_PREFIX + str(report_id)


def _result_sample(value, row_limits, time_zones=None):
    """Give the model a bounded sample with explicit coverage on every list."""
    omitted = Counter()
    coverage = []
    remaining = 280
    dropped = re.compile(r"link|url|uri|token|secret|authorization|phone|address|recipient|contact|chat_content", re.I)
    signed_url = re.compile(r"https?://\S+[?&](?:signature|token|x-amz-|expires|key)\b", re.I)
    zones = {path: ZoneInfo(zone) for path, zone in (time_zones or {}).items()}

    def sample(obj, depth=0, path="$"):
        nonlocal remaining
        remaining -= 1
        if remaining < 0 or depth > 9:
            omitted["nodes"] += 1
            return None
        if isinstance(obj, dict):
            result = {}
            for key, item in obj.items():
                courier_availability = key == "is_courier_return_mile_available" and type(item) is bool
                if dropped.search(key) and not courier_availability:
                    omitted["fields"] += 1
                    continue
                if remaining <= 0:
                    omitted["nodes"] += 1
                    break
                result[key] = sample(item, depth + 1, path+"."+key)
            return result
        if isinstance(obj, list):
            selected = []
            limit = row_limits.get(re.sub(r"\[\d+\]", "[]", path), 50)
            for index, item in enumerate(obj[:limit]):
                if remaining <= 0 or depth >= 9:
                    break
                selected.append(sample(item, depth + 1, f"{path}[{index}]"))
            if len(selected) < len(obj):
                omitted["rows"] += len(obj) - len(selected)
                if len(coverage) < 20:
                    coverage.append({"path": path, "availableRows": len(obj), "returnedRows": len(selected)})
            return selected
        if isinstance(obj, str) and (len(obj) > 1000 or signed_url.search(obj)):
            omitted["fields"] += 1
            return None
        if isinstance(obj, str) and zones:
            zone = zones.get(re.sub(r"\[\d+\]", "[]", path))
            if zone is not None:
                try:
                    instant = datetime.fromisoformat(obj)
                except ValueError:
                    return obj
                if instant.tzinfo is not None:
                    return instant.astimezone(zone).isoformat()
        return str(obj) if isinstance(obj, Decimal) else obj

    data = sample(value)
    return data, dict(omitted), coverage


def supplemental_route(card, params):
    """Compile a separately documented contract to its fixed provider route."""
    from jsonschema import Draft202012Validator
    from semantics import Rejected, canonical_json

    contract = card["contract"]
    if len(canonical_json(params).encode()) > 32000:
        raise Rejected("READ_PARAMS_SIZE")
    validator = Draft202012Validator(contract["schema"], format_checker=Draft202012Validator.FORMAT_CHECKER)
    if not validator.is_valid(params):
        raise Rejected("READ_PARAMS_SCHEMA")
    method, template = card["http"], card["path"]
    origin = urlsplit(contract["url"])
    if (method not in ("GET", "POST") or method != contract["http"] or origin.scheme != "https"
            or origin.netloc not in SUPPLEMENTAL_HOSTS[card["profile"]]
            or origin.path != template or origin.query or origin.fragment):
        raise Rejected("READ_FIXED_TRANSPORT")
    if card["profile"] == "seller":
        return method, contract["url"], canonical_json(params).encode()
    path = params.get("path", {})

    def segment(match):
        value = str(path[match.group(1)])
        if not re.fullmatch(r"[\w-]+", value, re.ASCII):
            raise Rejected("READ_PARAMS_SCHEMA")
        return quote(value, safe="")

    url = f"https://{origin.netloc}" + re.sub(r"\{([^{}]+)\}", segment, template)
    query = {k: str(v).lower() if isinstance(v, bool) else v for k, v in params.get("query", {}).items()}
    if query:
        url += "?" + urlencode(query, doseq=True)
    body = canonical_json(params["body"]).encode() if "body" in params else None
    return method, url, body


def supplemental_send(authority, store, card, route):
    from engine import CallError
    from http_transport import read_response
    from platform_store_credentials import resolve
    from read_surface import sanitize
    from semantics import Rejected, strict_json
    from .store_currency import retry_time

    method, url, body = route
    credentials = resolve(store)
    headers = {"Content-Type": "application/json"}
    if card["profile"] == "wb":
        headers["Authorization"] = credentials["seller_token"]
    else:
        headers.update({"Client-Id": credentials["seller_client_id"], "Api-Key": credentials["seller_api_key"]})
    request = Request(url, data=body, headers=headers, method=method)
    started = time.monotonic()
    try:
        raw, status = read_response(request, timeout=25, limit=12000000, on_dispatch=authority.check)
    except HTTPError as error:
        due = retry_time(error.headers, time.time(), card["profile"] == "wb")
        code = f"HTTP_{error.code}"
        known_codes = card.get("providerErrorCodes", {}).get(str(error.code), {})
        try:
            if known_codes:
                payload = strict_json(error.read(8192))
                if isinstance(payload, dict):
                    for field in ("code", "detail"):
                        value = payload.get(field)
                        if isinstance(value, str) and value in known_codes:
                            code = known_codes[value]
                            break
        except (Rejected, ValueError, OSError):
            pass
        finally:
            error.close()
        raise CallError(code, status=error.code, retry_at=due) from None
    except (URLError, OSError):
        raise CallError("NETWORK_OUTCOME_UNKNOWN", unknown=True) from None
    if len(raw) > 12000000:
        raise CallError("RESPONSE_SIZE", status=status)
    try:
        data = strict_json(raw, parse_float=Decimal) if raw else None
        return sanitize(data), {"status": status, "elapsed_ms": round((time.monotonic() - started) * 1000)}
    except (Rejected, ValueError, RecursionError):
        raise CallError("READ_RESPONSE_SCHEMA", status=status) from None


def _with_rate_retries(authority, platform, operation, dispatch, calls):
    from engine import CallError
    from . import ozon_retry

    retries = 0
    while True:
        authority.check()
        try:
            calls.append(operation)
            return dispatch()
        except CallError as error:
            if error.status != 429:
                raise
            now = time.time()
            if platform == "ozon":
                wait = ozon_retry.plan(error.retry_at, now)
                due = wait.due
                if authority.resume_rate_limits:
                    authority.ozon_notice(wait.waiting())
            else:
                due = max(now + 20, error.retry_at or 0)
                if retries >= 3:
                    raise
            if due >= authority.deadline and not authority.resume_rate_limits:
                raise
            if authority.resume_rate_limits:
                authority.wait_for_provider(due)
                if platform == "ozon":
                    authority.ozon_notice(ozon_retry.SENDING_NOTICE)
            else:
                time.sleep(max(0, due - time.time()))
            retries += 1


def _request_params(card, params):
    zone_name = card.get("requestDateZone")
    active_status = card.get("activeStatusDefault")
    query = params.get("query", {})
    if not isinstance(query, dict) or (not zone_name and active_status is None):
        return params
    query = dict(query)
    if active_status is not None:
        if query.get("status") == "all":
            query.pop("status")
        else:
            query.setdefault("status", active_status)
    if zone_name:
        zone = ZoneInfo(zone_name)
        for field, boundary in (("dateFrom", day_time.min), ("dateTo", day_time(23, 59, 59))):
            value = query.get(field)
            if isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                instant = datetime.combine(date.fromisoformat(value), boundary, zone)
                query[field] = (instant.isoformat() if card.get("requestDateFormat") == "rfc3339"
                                else int(instant.timestamp()))
    return {**params, "query": query}


def _pinned_request(store, card, params):
    import read_surface
    from semantics import Rejected

    platform = store["platform"]
    operation = card["operation"]
    meta = read_surface.method(platform, operation)
    if (not read_surface.available(meta) or meta.get("completion")
            or meta.get("workflow_role") == "explicit_workflow_read_step"
            or meta.get("response_style") == "binary" or meta.get("response_mode") == "binary"
            or operation == "notification_check"):
        raise Rejected("SOURCE_ACCESS")
    request = read_surface.request_for(store, operation, params)
    route = read_surface.build(platform, operation, params)
    expected = urlsplit(meta["wire_url"])
    actual = urlsplit(route["url"])
    path = re.escape(expected.path)
    path = re.sub(r"\\\{[^{}]+\\\}", "[^/]+", path)
    if route["method"] != card["http"] or actual.netloc != expected.netloc or not re.fullmatch(path, actual.path):
        raise Rejected("READ_FIXED_TRANSPORT")
    return request


def _read_store(authority, store, card, params, directory, selected_proofs):
    import read_surface
    from http_transport import HTTPTransport
    from platform_store_credentials import execution

    store = asdict(store)
    platform = store["platform"]
    guard = {"runtime_guard": {"pins": authority.pins}, "stores": [store]}
    engine = SimpleNamespace(execution_policy=authority)
    calls = []

    with execution(engine, {"plan": json.dumps(guard)}, store):
        if "contract" in card:
            route = supplemental_route(card, params)
            data, receipt = _with_rate_retries(authority, platform, card["id"],
                                                lambda: supplemental_send(authority, store, card, route), calls)
        else:
            request = _pinned_request(store, card, params)
            transport = HTTPTransport(directory, {}, selected_proofs, enabled=True,
                                      read_surface_policy=lambda: {"enabled": True, "pin": read_surface.PIN})

            def send(target):
                return _with_rate_retries(authority, platform, target.operation,
                                          lambda: transport.execute(target, store, on_dispatch=authority.check),
                                          calls)

            authentication = transport.prepare(request, store)
            if authentication:
                send(authentication)
            data, receipt = send(request)
    authority.check()
    if data is None and str(receipt["status"]) in card.get("emptyResponses", {}):
        data = card["emptyResponses"][str(receipt["status"])]
    payload, omitted, coverage = _result_sample(data, card.get("sampleRows", {}), card.get("responseTimeZones"))
    result = {"ok": True, "data": payload, "omitted": omitted, "http": receipt["status"],
              "providerMilliseconds": receipt["elapsed_ms"]}
    if coverage:
        result["coverage"] = coverage
    if "responseFieldLabels" in card:
        result["fieldLabels"] = card["responseFieldLabels"]
    if "responseGuide" in card:
        result["responseGuide"] = card["responseGuide"]
    return result, calls


def _template_failure(card, code, status=None):
    rules = card.get("errorRules", {})
    reason = rules.get(code) or (rules.get(f"HTTP_{status}") if status is not None else None)
    if reason:
        return {"ok": False, "templateId": card["id"], "http": status,
                "reason": reason, "reasonSource": "template"}
    return None


def execute(packet, directory):
    from .authority import ChatAuthority
    from .worker import configure_catalogue, log_failure
    from engine import CallError
    from failure_explanations import explain
    from semantics import Rejected
    from universal_reads import identifier_provenance

    authority = ChatAuthority(packet)
    store, = authority.scope_for({"pins": authority.pins}).stores
    fields = authority.field_names(store)
    args = packet["readTemplate"]
    if args["action"] == "find":
        result = discover(args.get("query", ""), args.get("offset", 0), store.platform, fields)
        authority.check()
        return {"ok": True, **result}
    card = cards().get(args["templateId"])
    if card is None or not supported(card, store.platform, fields):
        raise Rejected("SOURCE_ACCESS")
    if card["state"] != "ready":
        return {"ok": False, "templateId": card["id"], "reason": REASONS[card["state"]]}
    params = args.get("params", {})
    try:
        evidence = packet.get("readEvidence", {})
        observed = evidence.get("ids", []) if evidence.get("revision") == authority.revision else []
        if card["id"] in wb_documents.DOWNLOADS:
            file, receipt = _with_rate_retries(authority, store.platform, card["id"],
                lambda: wb_documents.download(authority, asdict(store), card, params, packet["turn"], observed), [])
            return {"ok": True, "templateId": card["id"], "http": receipt["status"],
                    "data": {"file": file}, "responseGuide": card["responseGuide"]}
        if card["id"] == ozon_report_file.INFO:
            data, receipt = _with_rate_retries(authority, store.platform, card["id"],
                lambda: ozon_report_file.read(authority, asdict(store), params, packet["turn"], observed), [])
            return {"ok": True, "templateId": card["id"], "http": receipt["status"],
                    "data": data, "responseGuide": card["responseGuide"]}
        acquiring_report_id = None
        if card["id"] == WB_ACQUIRING_DETAIL and isinstance(params.get("path"), dict):
            candidate = str(params["path"].get("reportId"))
            if WB_ACQUIRING_REPORT_PREFIX + candidate in observed:
                acquiring_report_id = candidate
        identifier_provenance(_identifier_params(params, acquiring_report_id), packet["turn"]["question"],
                              [{"data": observed}])
        proofs = configure_catalogue(SimpleNamespace(), {store.id: fields})
        try:
            params = _request_params(card, params)
        except ValueError as error:
            raise Rejected("INVALID_OPERATION_PARAMS") from error
        public, calls = _read_store(authority, store, card, params, directory, proofs)
    except Rejected as error:
        if failure := _template_failure(card, error.code):
            log_failure(card["operation"] or card["id"], error.code, None)
            return failure
        raise
    except CallError as error:
        empty = card.get("emptyResponses", {}).get(str(error.status))
        if empty is not None:
            return {"ok": True, "templateId": card["id"], "http": error.status,
                    "data": empty, "responseGuide": card["responseGuide"]}
        log_failure(card["operation"] or card["id"], error.code, error.retry_at)
        result = {"ok": False, "templateId": card["id"], "http": error.status}
        if failure := _template_failure(card, error.code, error.status):
            return failure
        if card.get("errorRules") and error.status in (401, 402, 403):
            return {**result, "requiresTestReview": True}
        return {**result, "reason": explain(error.code)["text"]}
    return {**public, "templateId": card["id"], "operations": calls,
            **({"_readEvidenceRevision": authority.revision} if "readEvidence" in packet else {}),
            "scope": "Один запрос к площадке. Следующая страница запрашивается по её параметрам."}
