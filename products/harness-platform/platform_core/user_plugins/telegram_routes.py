"""Account linking and per-chat Telegram report settings."""
import asyncio
import hashlib
import logging
import secrets
import sqlite3
import time
from contextlib import asynccontextmanager

from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, JSONResponse
from starlette.routing import Route

from ..browser_session import browser_token
from ..chat_connections import scope_for
from ..identity import _secret_digest
from . import telegram_api as tg
from .registry import attached
from .telegram_delivery import Delivery, PLUGIN, read_journal, subscribe

BASE = "/api/chats/{chat_id}/plugins/telegram-reports"
RETURN_PAGE = """<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport"
content="width=device-width,initial-scale=1"><title>Telegram · Октопорт</title>
<main><h1>Отчёты в Telegram</h1><p role="status">Подтверждаем подключение…</p>
<a href="/app/">Вернуться в Октопорт</a></main><script src="/telegram/return.js" defer></script></html>"""
RETURN_JS = """(async () => {
  const query = new URLSearchParams(location.search);
  history.replaceState(null, '', '/telegram/return');
  const label = document.querySelector('[role=status]');
  if (!query.get('state') || !query.get('code') || query.get('error')) {
    label.textContent = 'Подключение отменено. Вы можете вернуться в Октопорт.'; return;
  }
  try {
    const response = await fetch('/api/telegram/complete', {method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify({code:query.get('code'),state:query.get('state')})});
    const result = await response.json();
    if (!response.ok) throw Error(response.status === 401 ? 'Войдите в Октопорт и начните подключение заново.' : result.error);
    label.textContent = 'Telegram подключён. Новые отчёты этого чата будут приходить в личные сообщения.';
    const link=document.querySelector('a'); link.href='/app/chats/'+encodeURIComponent(result.chat); link.textContent='Вернуться в чат';
  } catch (e) { label.textContent = e.message || 'Не удалось подтвердить подключение.'; }
})();"""
PRIVATE = {"Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
           "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}


@asynccontextmanager
async def activate(state):
    try:
        config = tg.Config.load()
    except (OSError, KeyError, ValueError, TypeError):
        logging.getLogger(__name__).error("Telegram configuration is invalid; report delivery is disabled")
        config = None
    state.telegram = Delivery(state, config)
    try:
        yield
    finally:
        await state.telegram.close()


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


def require_config(state):
    config = state.telegram.config
    if not config:
        raise HTTPException(503, "Бот Октопорта ещё не настроен.")
    return config


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def routes(body):
    from starlette.responses import Response

    async def returning(req):
        if req.url.path.endswith(".js"):
            return Response(RETURN_JS, media_type="text/javascript", headers=PRIVATE)
        return HTMLResponse(RETURN_PAGE, headers=PRIVATE)

    async def settings(req):
        token = browser_token(req)
        state = req.app.state
        chat = req.path_params["chat_id"]
        action = req.path_params.get("telegram_action")
        if action and action not in {"connect", "enable", "pause", "disconnect", "resume"}:
            raise HTTPException(404)
        if action:
            await body(req)
        with state.identity._lock:
            db = state.identity._db
            scope = require_chat(db, token, chat)
            cfg = state.telegram.config
            bound = db.execute("SELECT bot FROM telegram_recipients WHERE workspace=?", (scope.workspace_id,)).fetchone()
            linked = cfg and bound == (cfg.bot,)
            sub = db.execute("SELECT status,last_sent FROM telegram_subscriptions WHERE chat=?", (chat,)).fetchone()
        if not action:
            return JSONResponse({"configured": bool(cfg), "linked": bool(linked), "hasBinding": bool(bound), "subscribed": bool(linked and sub),
                                 "status": sub[0] if sub and linked else None, "lastSent": sub[1] if sub and linked else None})
        if action in ("pause","disconnect"):
            with state.identity._write() as db:
                scope = require_chat(db, token, chat)
                if action == "disconnect":
                    db.execute("DELETE FROM telegram_recipients WHERE workspace=?", (scope.workspace_id,))
                    db.execute("DELETE FROM telegram_consents WHERE chat IN (SELECT chat_id FROM chats WHERE workspace_id=?)",
                               (scope.workspace_id,))
                else:
                    db.execute("DELETE FROM telegram_subscriptions WHERE chat=?", (chat,))
                    db.execute("DELETE FROM telegram_consents WHERE chat=?", (chat,))
            return JSONResponse({"ok": True})
        cfg = require_config(state)
        if action == "resume":
            with state.identity._write() as db:
                scope = require_chat(db, token, chat)
                resumed = db.execute("""UPDATE telegram_subscriptions SET status='ready',retry_at=0
                    WHERE chat=? AND workspace=? AND status IN ('unknown','rejected') AND EXISTS
                    (SELECT 1 FROM telegram_recipients WHERE workspace=? AND bot=?)""",
                    (chat,scope.workspace_id,scope.workspace_id,cfg.bot)).rowcount
                if not resumed:
                    raise HTTPException(409,"Состояние доставки изменилось. Откройте настройки ещё раз.")
            state.telegram.wake.set()
            return JSONResponse({"ok": True})
        if action == "connect":
            challenge, verifier, nonce = (secrets.token_urlsafe(32) for _ in range(3))
            with state.identity._write() as db:
                require_chat(db, token, chat)
                db.execute("DELETE FROM telegram_consents WHERE session=? OR expires<=unixepoch()", (_secret_digest(token),))
                db.execute("INSERT INTO telegram_consents VALUES(?,?,?,?,?,?,?,?,?)",
                           (_secret_digest(token),digest(challenge),chat,cfg.bot,verifier,nonce,int(time.time())+600,scope.workspace_id,PLUGIN))
            return JSONResponse({"url": tg.authorize(cfg, challenge, verifier, nonce)})
        cursor = await latest(state, scope)
        with state.identity._write() as db:
            scope = require_chat(db, token, chat)
            if not db.execute("SELECT 1 FROM telegram_recipients WHERE workspace=? AND bot=?", (scope.workspace_id,cfg.bot)).fetchone():
                raise HTTPException(409, "Сначала подключите Telegram.")
            subscribe(db, scope, cursor)
        state.telegram.wake.set()
        return JSONResponse({"ok": True})

    async def complete(req):
        token = browser_token(req)
        state = req.app.state
        cfg = require_config(state)
        fields = await body(req, "state", "code")
        if any(not isinstance(v, str) or not 1 <= len(v) <= 2048 for v in fields.values()):
            raise HTTPException(400, "Некорректный ответ Telegram.")
        sid = _secret_digest(token)
        with state.identity._write() as db:
            row = db.execute("""SELECT chat,verifier,nonce FROM telegram_consents WHERE state=? AND
                session=? AND bot=? AND expires>unixepoch()""", (digest(fields["state"]),sid,cfg.bot)).fetchone()
            if not row:
                raise HTTPException(409,"Ссылка истекла или уже использована. Начните подключение заново.")
            chat, verifier, nonce = row
            scope = require_chat(db, token, chat)
            # Reserve this response exactly once but leave the row revocable during network I/O.
            reservation = secrets.token_hex(32)
            db.execute("UPDATE telegram_consents SET state=? WHERE session=?", (reservation,sid))
        uid = await tg.verified_user(state.http, cfg, fields["code"], verifier, nonce)
        with state.identity._lock:
            db = state.identity._db
            require_chat(db,token,chat)
            existing = db.execute("SELECT workspace,recipient,bot FROM telegram_recipients WHERE workspace=? OR (bot=? AND recipient=?)",
                                  (scope.workspace_id,cfg.bot,uid)).fetchall()
            if existing and existing != [(scope.workspace_id,uid,cfg.bot)]:
                raise HTTPException(409,"Этот аккаунт уже связан. Для замены сначала отключите прежнюю связь.")
        try:
            await tg.send(cfg, uid, "Октопорт проверяет доставку личных отчётов по вашему запросу.")
        except tg.DeliveryError:
            raise HTTPException(409,"Доставка в Telegram не подтверждена. Разрешите сообщения и повторите подключение.") from None
        cursor = await latest(state, scope)
        try:
            with state.identity._write() as db:
                scope = require_chat(db, token, chat)
                if not db.execute("DELETE FROM telegram_consents WHERE session=? AND state=? AND expires>unixepoch()",
                                  (sid,reservation)).rowcount:
                    raise HTTPException(409,"Подключение отменено. Начните заново.")
                db.execute("""INSERT INTO telegram_recipients VALUES(?,?,?)
                              ON CONFLICT(workspace) DO NOTHING""", (scope.workspace_id,cfg.bot,uid))
                if db.execute("SELECT bot,recipient FROM telegram_recipients WHERE workspace=?",
                              (scope.workspace_id,)).fetchone() != (cfg.bot,uid):
                    raise HTTPException(409,"Получатель изменился. Начните заново.")
                subscribe(db,scope,cursor)
        except sqlite3.IntegrityError:
            raise HTTPException(409,"Telegram уже привязан к другому аккаунту.") from None
        state.telegram.wake.set()
        return JSONResponse({"chat":chat})

    return [Route(BASE, settings), Route(BASE+"/{telegram_action}", settings, methods=["POST"]),
            Route("/telegram/return", returning), Route("/telegram/return.js", returning),
            Route("/api/telegram/complete", complete, methods=["POST"])]
