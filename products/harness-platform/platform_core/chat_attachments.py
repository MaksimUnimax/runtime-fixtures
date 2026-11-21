"""Private upload/download endpoints for the shared Harness composer."""

import asyncio
from contextlib import closing
from hashlib import sha256
import json
from pathlib import Path
import re
import sqlite3
import time
from urllib.parse import quote
from uuid import uuid4

from starlette.concurrency import run_in_threadpool
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .identity import ChatUnavailable


MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_ACCOUNT_BYTES = 128 * 1024 * 1024
DRAFT_TTL_MS = 24 * 60 * 60 * 1000
FILE_ID = re.compile(r"[a-f0-9]{32}")
_SCHEMA = Path(__file__).resolve().parents[1] / "native" / "chat-attachments.sql"


def initialize(journal):
    journal.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with closing(sqlite3.connect(journal)) as db:
        db.executescript(_SCHEMA.read_text())


def scope_key(scope):
    fields = [scope.actor_id, scope.workspace_id, scope.chat_id]
    return sha256(json.dumps(fields, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def validate_ids(value):
    if (not isinstance(value, list) or len(value) > 10
            or any(not isinstance(item, str) or not FILE_ID.fullmatch(item) for item in value)
            or len(set(value)) != len(value)):
        raise HTTPException(400, "Допускается до 10 разных вложений в сообщении.")
    return value


def _name(value):
    basename = value.replace("\\", "/").rsplit("/", 1)[-1]
    return "".join(c for c in basename if c.isprintable()).strip()[:180] or "Файл"


def _stage(journal, scope, name, body):
    initialize(journal)
    file_id = uuid4().hex
    key = scope_key(scope)
    now = int(time.time() * 1000)
    with closing(sqlite3.connect(journal)) as db, db:
        db.execute("BEGIN IMMEDIATE")
        if db.execute("SELECT 1 FROM deleted_chat_scopes WHERE scope_key=?", (key,)).fetchone():
            raise ChatUnavailable()
        db.execute("DELETE FROM chat_files WHERE request_id IS NULL AND created_at<?", (now - DRAFT_TTL_MS,))
        used = db.execute("SELECT COALESCE(SUM(bytes),0) FROM chat_files WHERE actor_id=?", (scope.actor_id,)).fetchone()[0]
        if used + len(body) > MAX_ACCOUNT_BYTES:
            raise HTTPException(413, "Достигнут лимит хранения вложений аккаунта.")
        db.execute("INSERT INTO chat_files(scope_key,actor_id,id,name,bytes,created_at,body) VALUES (?,?,?,?,?,?,?)",
                   (key, scope.actor_id, file_id, name, len(body), now, bytes(body)))
    return {"receiptId": file_id, "file": {"attachmentId": file_id, "name": name, "bytes": len(body)}}


def _read(journal, scope, file_id):
    if not FILE_ID.fullmatch(file_id) or not journal.is_file():
        raise ChatUnavailable()
    with closing(sqlite3.connect(journal)) as db:
        row = db.execute("SELECT name, body FROM chat_files WHERE scope_key=? AND id=? AND request_id IS NOT NULL",
                         (scope_key(scope), file_id)).fetchone()
    if row is None:
        raise ChatUnavailable()
    return row


def routes(token_for):
    transfers = asyncio.Semaphore(8)

    async def upload(req):
        token = token_for(req, allow_cookie=True)
        identity = req.app.state.identity
        chat_id = req.query_params.get("sessionId", "")
        await run_in_threadpool(identity.resolve_chat, token, chat_id)
        if req.headers.get("content-type", "").split(";", 1)[0] != "application/octet-stream":
            raise HTTPException(415, "Ожидалось содержимое файла.")
        if transfers.locked():
            return failure("Слишком много одновременных загрузок. Повторите попытку.")
        async with transfers:
            return await receive(req, identity, token, chat_id)

    async def receive(req, identity, token, chat_id):
        body = bytearray()
        async for part in req.stream():
            if len(body) + len(part) > MAX_FILE_BYTES:
                return failure("Файл больше 8 МиБ.")
            body.extend(part)
        if not body:
            return failure("Файл пуст.")
        scope = await run_in_threadpool(identity.resolve_chat, token, chat_id)
        try:
            result = await run_in_threadpool(_stage, req.app.state.worker.journal, scope,
                                             _name(req.query_params.get("name", "")), body)
        except HTTPException as error:
            return failure(error.detail)
        return JSONResponse({"ok": True, "value": result})

    async def download(req):
        token = token_for(req, allow_cookie=True)
        scope = await run_in_threadpool(req.app.state.identity.resolve_chat, token, req.path_params["chat_id"])
        name, body = await run_in_threadpool(_read, req.app.state.worker.journal, scope, req.path_params["file_id"])
        return Response(body, media_type="application/octet-stream", headers={
            "Content-Disposition": "attachment; filename*=UTF-8''" + quote(name, safe=""),
            "X-Content-Type-Options": "nosniff",
        })

    return [Route("/api/session/uploadFileBinary", upload, methods=["POST"]),
            Route("/api/chats/{chat_id}/files/{file_id}", download)]


def failure(message):
    return JSONResponse({"ok": False, "error": {"code": "file-upload-refused", "message": message, "details": {}}})
