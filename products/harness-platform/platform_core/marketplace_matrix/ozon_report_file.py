"""Read a previously created Ozon report and deliver its file only to its chat."""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request
from zipfile import is_zipfile

from starlette.exceptions import HTTPException

from ..chat_attachments import MAX_FILE_BYTES, save_marketplace_document
from ..storage import Scope
from .store_currency import retry_time


LIST = "read.seller.report_list"
INFO = "read.seller.report_info"
REPORT_CODE = re.compile(r"[A-Za-z0-9_:-]{1,160}", re.ASCII)


def proof(code):
    return "ozon-report:" + sha256(code.encode()).hexdigest()


def observed_reports(data):
    result = data.get("result") if isinstance(data, dict) else None
    reports = result.get("reports") if isinstance(result, dict) else None
    if not isinstance(reports, list):
        return
    for report in reports:
        if isinstance(report, dict) and isinstance(code := report.get("code"), str) and REPORT_CODE.fullmatch(code):
            yield proof(code)


def _read(authority, request, limit, file=False):
    from engine import CallError
    from http_transport import read_response

    try:
        return read_response(request, timeout=25, limit=limit, on_dispatch=authority.check)
    except HTTPError as error:
        due = retry_time(error.headers, time.time(), False)
        code = "OZON_REPORT_FILE_UNAVAILABLE" if file and error.code in (403, 404, 410) else f"HTTP_{error.code}"
        error.close()
        raise CallError(code, status=error.code, retry_at=due) from None
    except (URLError, OSError):
        raise CallError("NETWORK_OUTCOME_UNKNOWN", unknown=True) from None


def read(authority, store, params, turn, observed):
    from engine import CallError
    from semantics import Rejected, strict_json
    from protected_reads import validate_url

    code, download = params.get("code"), params.get("download", False)
    if set(params) - {"code", "download"} or not isinstance(code, str) or not REPORT_CODE.fullmatch(code) or type(download) is not bool:
        raise Rejected("OZON_REPORT_PARAMETERS")
    if proof(code) not in observed:
        raise Rejected("OZON_REPORT_NOT_CONFIRMED")
    journal = turn.get("attachmentsJournal")
    if download and (not isinstance(journal, str) or not Path(journal).is_absolute() or Path(journal).name != "native-chats.sqlite3"):
        raise Rejected("OZON_REPORT_CHAT_UNAVAILABLE")
    credentials = authority.credentials(authority.pins, store)
    headers = {"Client-Id": credentials["seller_client_id"], "Api-Key": credentials["seller_api_key"],
               "Content-Type": "application/json"}
    request = Request("https://api-seller.ozon.ru/v1/report/info", data=json.dumps({"code": code}).encode(),
                      headers=headers, method="POST")
    started = time.monotonic()
    raw, status = _read(authority, request, 500_000)
    try:
        report = strict_json(raw)["result"]
        if report.get("code") != code:
            raise ValueError("Unexpected report")
        data = {key: report[key] for key in ("report_type", "status", "created_at", "expires_at")
                if isinstance(report.get(key), str)}
    except (AttributeError, KeyError, TypeError, ValueError, Rejected):
        raise CallError("OZON_REPORT_INVALID", status=status) from None
    if download:
        if report.get("status") != "success" or not report.get("file"):
            raise CallError("OZON_REPORT_NOT_READY", status=status)
        try:
            expires = datetime.fromisoformat(report["expires_at"])
            if expires.tzinfo is None:
                raise ValueError("Invalid expiration")
        except (KeyError, TypeError, ValueError):
            raise CallError("OZON_REPORT_INVALID", status=status) from None
        if expires <= datetime.now(timezone.utc):
            raise CallError("OZON_REPORT_EXPIRED", status=status)
        url = validate_url(report["file"])
        body, status = _read(authority, Request(url), MAX_FILE_BYTES + 1, file=True)
        extension = Path(urlsplit(url).path).suffix.lower()
        if len(body) > MAX_FILE_BYTES:
            raise CallError("OZON_REPORT_TOO_LARGE", status=status)
        if (not body or extension not in {".xlsx", ".zip", ".pdf", ".csv"}
                or (extension in {".xlsx", ".zip"} and not is_zipfile(BytesIO(body)))
                or (extension == ".pdf" and not body.startswith(b"%PDF-"))):
            raise CallError("OZON_REPORT_INVALID", status=status)
        pins = authority.pins
        scope = Scope(pins["actor_id"], pins["tenant_id"], pins["chat_id"])
        try:
            data["file"] = save_marketplace_document(Path(journal), scope, turn["requestId"], "Ozon_report" + extension, body,
                                                        authority.check)
        except HTTPException as error:
            raise CallError("OZON_REPORT_STORAGE_LIMIT", status=status) from error
    authority.check()
    return data, {"status": status, "elapsed_ms": round((time.monotonic() - started) * 1000)}
