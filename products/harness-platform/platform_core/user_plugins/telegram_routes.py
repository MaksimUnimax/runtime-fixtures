"""Per-chat subscriptions to marketplace reports via the account Telegram integration."""
import asyncio
import sqlite3

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from ..browser_session import browser_token
from ..chat_connections import scope_for
from ..telegram_integration import MISSING
from .registry import attached
from .telegram_delivery import PLUGIN, read_journal, subscribe

BASE = "/api/chats/{chat_id}/plugins/telegram-reports"


def require_chat(db, token, chat):
    scope = scope_for(db, token, chat)
    if not attached(db, scope, PLUGIN):
        raise HTTPException(403, "Включите плагин Telegram в этом чате.")
    return scope


async def latest(state, scope):
    try:
        return await asyncio.to_thread(read_journal, state.worker.journal,
                                       scope.actor_id, scope.workspace_id, scope.chat_id)
    except sqlite3.Error:
        raise HTTPException(503, "История временно занята. Повторите подключение.") from None


def delivery_state(db, workspace, chat, linked):
    sub = db.execute("SELECT status,last_sent FROM telegram_subscriptions WHERE workspace=? AND chat=?",
                     (workspace, chat)).fetchone() if linked else None
    return {"subscribed": bool(sub), "status": sub[0] if sub else None, "lastSent": sub[1] if sub else None}


def routes(body):
    async def settings(req):
        token = browser_token(req)
        state = req.app.state
        chat = req.path_params["chat_id"]
        action = req.path_params.get("telegram_action")
        if action and action not in {"enable", "pause", "resume"}:
            raise HTTPException(404)
        if action:
            await body(req)
        if not action:
            with state.identity._lock:
                db = state.identity._db
                scope = require_chat(db, token, chat)
                account = state.telegram.status(db, scope.workspace_id)
                return JSONResponse({"linked": account["linked"], "configured": account["configured"],
                                     **delivery_state(db, scope.workspace_id, chat, account["linked"])})
        with state.identity._write() as db:
            scope = require_chat(db, token, chat)
            if action == "pause":
                db.execute("DELETE FROM telegram_subscriptions WHERE chat=?", (chat,))
                return JSONResponse({"ok": True})
            if not state.telegram.status(db, scope.workspace_id)["linked"]:
                raise HTTPException(409, MISSING)
            if action == "resume":
                resumed = db.execute("""UPDATE telegram_subscriptions SET status='ready',retry_at=0
                    WHERE chat=? AND workspace=? AND status IN ('unknown','rejected')""", (chat,scope.workspace_id)).rowcount
                if not resumed:
                    raise HTTPException(409, "Состояние доставки изменилось. Откройте настройки ещё раз.")
        if action == "enable":
            cursor = await latest(state, scope)
            with state.identity._write() as db:
                scope = require_chat(db, token, chat)
                if not state.telegram.status(db, scope.workspace_id)["linked"]:
                    raise HTTPException(409, MISSING)
                subscribe(db, scope, cursor)
        state.telegram_reports.wake.set()
        return JSONResponse({"ok": True})

    return [Route(BASE, settings), Route(BASE+"/{telegram_action}", settings, methods=["POST"])]
