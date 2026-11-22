"""Deliver the original file of a ready Ozon Performance report to its chat."""
from decimal import Decimal
from io import BytesIO
from pathlib import Path
from zipfile import is_zipfile

from starlette.exceptions import HTTPException

from ..chat_attachments import MAX_FILE_BYTES, save_marketplace_document
from ..storage import Scope

OPERATION = "performance_statistics_report_download"
FILE_NAMES = {
    OPERATION: "Ozon_Performance",
    "performance_media_csv": "Ozon_Media_Campaigns",
    "performance_campaign_product_csv": "Ozon_CPC_Campaigns",
}
FORMATS = {"application/json": "json", "text/csv": "csv", "application/zip": "zip"}


def ready_proof(report_uuid):
    return "performance-file-ready:" + report_uuid.lower()


def attachment_journal(turn):
    from semantics import Rejected

    value = turn.get("attachmentsJournal")
    if not isinstance(value, str) or not Path(value).is_absolute() or Path(value).name != "native-chats.sqlite3":
        raise Rejected("PERFORMANCE_FILE_CHAT_UNAVAILABLE")
    return Path(value)


def receive(authority, journal, request_id, operation, dispatch):
    from engine import CallError
    from report_archive import DOCUMENT_SINK
    from semantics import Rejected, strict_json

    received = None

    def capture(body, mime, _original):
        nonlocal received
        received = body, mime

    token = DOCUMENT_SINK.set(capture)
    try:
        try:
            _, receipt = dispatch()
        except CallError as error:
            # The runtime's generic decoder assumes CSV. Ozon also serves
            # the original, already-generated report as JSON or ZIP.
            if (received is None or received[1] not in FORMATS
                    or not error.code.startswith("READ_CSV_")):
                raise
            receipt = {"status": error.status}
    finally:
        DOCUMENT_SINK.reset(token)
    status = receipt["status"]
    if received is None:
        raise CallError("PERFORMANCE_FILE_INVALID", status=status)
    body, mime = received
    if len(body) > MAX_FILE_BYTES:
        raise CallError("PERFORMANCE_FILE_TOO_LARGE", status=status)
    extension = FORMATS.get(mime)
    try:
        if not body or not extension or (extension == "zip" and not is_zipfile(BytesIO(body))):
            raise ValueError("Unexpected report file")
        if extension == "json" and not isinstance(strict_json(body, parse_float=Decimal), (dict, list)):
            raise ValueError("Unexpected report JSON")
        if extension == "csv":
            contents = body.decode("utf-8-sig").lstrip()
            # Campaign CSV files can start with a title row before the table header.
            if not contents or contents.startswith(("<", "{", "[")) or "\x00" in contents:
                raise ValueError("Unexpected report CSV")
    except (ValueError, Rejected, RecursionError):
        raise CallError("PERFORMANCE_FILE_INVALID", status=status) from None
    pins = authority.pins
    scope = Scope(pins["actor_id"], pins["tenant_id"], pins["chat_id"])
    try:
        file = save_marketplace_document(journal, scope, request_id, FILE_NAMES[operation] + "." + extension,
                                         body, authority.check)
    except HTTPException as error:
        raise CallError("PERFORMANCE_FILE_STORAGE_LIMIT", status=status) from error
    return {"file": file, "format": extension.upper()}, receipt
