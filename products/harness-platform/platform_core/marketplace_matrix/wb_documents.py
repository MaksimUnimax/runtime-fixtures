"""Download proven Wildberries documents into the requesting chat's file store."""
from base64 import b64decode
from collections import Counter
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request
from zipfile import BadZipFile, ZipFile, is_zipfile

from starlette.exceptions import HTTPException

from ..chat_attachments import MAX_FILE_BYTES, save_marketplace_document
from ..storage import Scope
from .store_currency import retry_time


LIST = "read.wb.documents_list"
SINGLE = "read.wb.document_download"
BATCH = "read.wb.documents_download_all"
DOWNLOADS = {SINGLE, BATCH}
ORIGIN = "https://documents-api.wildberries.ru"
FORMAT = re.compile(r"[a-z0-9]{1,10}", re.ASCII)
SERVICE_NAME = re.compile(r"[A-Za-z0-9_-]{1,180}", re.ASCII)
DOCUMENT_FORMATS = {"zip", "xlsx", "xls", "pdf", "csv", "xml", "txt", "doc", "docx"}


def proof(service_name, extension):
    return "wb-document:" + sha256(f"{service_name}:{extension}".encode()).hexdigest()


def observed_documents(data):
    subtree = data.get("data") if isinstance(data, dict) else None
    documents = subtree.get("documents") if isinstance(subtree, dict) else None
    if not isinstance(documents, list):
        return
    for row in documents:
        if not isinstance(row, dict):
            continue
        service_name = row.get("serviceName")
        extensions = row.get("extensions")
        if isinstance(service_name, str) and SERVICE_NAME.fullmatch(service_name) and isinstance(extensions, list):
            for extension in extensions:
                if isinstance(extension, str) and FORMAT.fullmatch(extension):
                    yield proof(service_name, extension)


def request_for(card, params, observed, token):
    from semantics import Rejected

    single = card["id"] == SINGLE
    if single and set(params) == {"query"}:
        files = [params["query"]]
    elif not single and set(params) == {"body"} and isinstance(params["body"], dict) and set(params["body"]) == {"params"}:
        files = params["body"]["params"]
    else:
        raise Rejected("WB_DOCUMENT_PARAMETERS")
    if not isinstance(files, list) or not 1 <= len(files) <= 50:
        raise Rejected("WB_DOCUMENT_PARAMETERS")
    for row in files:
        if not isinstance(row, dict) or set(row) != {"serviceName", "extension"}:
            raise Rejected("WB_DOCUMENT_PARAMETERS")
        name, extension = row["serviceName"], row["extension"]
        if not isinstance(name, str) or not SERVICE_NAME.fullmatch(name) or not isinstance(extension, str) or not FORMAT.fullmatch(extension):
            raise Rejected("WB_DOCUMENT_PARAMETERS")
        if proof(name, extension) not in observed:
            raise Rejected("WB_DOCUMENT_NOT_CONFIRMED")
    path = "/api/v1/documents/download"
    headers = {"Authorization": token, "Content-Type": "application/json"}
    if single:
        return Request(ORIGIN + path + "?" + urlencode(files[0]), headers=headers)
    return Request(ORIGIN + path + "/all", data=json.dumps({"params": files}).encode(), headers=headers, method="POST")


def download(authority, store, card, params, turn, observed):
    from engine import CallError
    from http_transport import read_response
    from semantics import Rejected, strict_json

    journal = turn.get("attachmentsJournal")
    if not isinstance(journal, str) or not Path(journal).is_absolute() or Path(journal).name != "native-chats.sqlite3":
        raise Rejected("WB_DOCUMENT_CHAT_UNAVAILABLE")
    authority.check()
    credentials = authority.credentials(authority.pins, store)
    request = request_for(card, params, observed, credentials["seller_token"])
    started = time.monotonic()
    encoded_limit = 4 * ((MAX_FILE_BYTES + 2) // 3) + 4096
    try:
        raw, status = read_response(request, timeout=25, limit=encoded_limit, on_dispatch=authority.check)
    except HTTPError as error:
        due = retry_time(error.headers, time.time(), True)
        error.close()
        raise CallError(f"HTTP_{error.code}", status=error.code, retry_at=due) from None
    except (URLError, OSError):
        raise CallError("NETWORK_OUTCOME_UNKNOWN", unknown=True) from None
    if len(raw) > encoded_limit:
        raise CallError("WB_DOCUMENT_TOO_LARGE", status=status)
    entries = None
    try:
        record = strict_json(raw)["data"]
        name, extension, payload = record["fileName"], record["extension"], record["document"]
        body = b64decode(payload, validate=True)
        if not isinstance(name, str) or not isinstance(extension, str) or not FORMAT.fullmatch(extension) or not body:
            raise ValueError("Invalid file envelope")
        if extension in {"zip", "xlsx"} and not is_zipfile(BytesIO(body)):
            raise ValueError("Invalid archive")
        if extension == "zip":
            with ZipFile(BytesIO(body)) as archive:
                formats = (Path(item.filename).suffix[1:].casefold() for item in archive.infolist() if not item.is_dir())
                entries = dict(Counter(value if value in DOCUMENT_FORMATS else "other" for value in formats))
        if extension == "pdf" and not body.startswith(b"%PDF-"):
            raise ValueError("Invalid PDF")
    except (BadZipFile, KeyError, TypeError, ValueError, Rejected):
        raise CallError("WB_DOCUMENT_INVALID", status=status) from None
    if len(body) > MAX_FILE_BYTES:
        raise CallError("WB_DOCUMENT_TOO_LARGE", status=status)
    if not name.casefold().endswith("." + extension):
        name += "." + extension
    pins = authority.pins
    scope = Scope(pins["actor_id"], pins["tenant_id"], pins["chat_id"])
    try:
        file = save_marketplace_document(Path(journal), scope, turn["requestId"], name, body, authority.check)
    except HTTPException as error:
        raise CallError("WB_DOCUMENT_STORAGE_LIMIT", status=status) from error
    return {**file, **({"archiveEntriesByFormat": entries} if entries is not None else {})}, {
        "status": status, "elapsed_ms": round((time.monotonic() - started) * 1000),
    }
