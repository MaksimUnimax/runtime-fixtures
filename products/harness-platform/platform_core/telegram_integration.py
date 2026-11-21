"""Account-wide Telegram consent and private delivery for opted-in consumers."""
import hashlib
import html
import logging
import secrets
import sqlite3
import time
from contextlib import AsyncExitStack, asynccontextmanager
from urllib.parse import urlencode

import httpx
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from . import telegram_api as tg
from .browser_session import browser_token
from .identity import _principal, _secret_digest

BASE = "/api/integrations/telegram"
MISSING = "Добавьте интеграцию Telegram в разделе «Интеграции»."
SCHEMA = (
    """CREATE TABLE IF NOT EXISTS telegram_widget_receipts(
        signature TEXT PRIMARY KEY, expires INTEGER NOT NULL)""",
    """CREATE TABLE IF NOT EXISTS telegram_recipients(
        workspace TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        bot TEXT NOT NULL, recipient INTEGER NOT NULL, UNIQUE(bot,recipient))""",
    """CREATE TABLE IF NOT EXISTS telegram_integration_consents(
        session BLOB PRIMARY KEY, state TEXT UNIQUE NOT NULL,
        workspace TEXT NOT NULL REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        bot TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL)""",
    "DROP TRIGGER IF EXISTS telegram_uninstall",
)

RETURN_PAGE = """<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport"
content="width=device-width,initial-scale=1"><title>Telegram · Октопорт</title>
<main><h1>Интеграция Telegram</h1><p role="status">Подтверждаем подключение…</p>
<a href="/app/">Вернуться в Октопорт</a></main><script src="/telegram/return.js" defer></script></html>"""
RETURN_JS = r"""(async () => {
  const query = new URLSearchParams(location.search);
  history.replaceState(null, '', '/telegram/return');
  const label = document.querySelector('[role=status]');
  const state = query.get('state');
  if (!state || query.getAll('state').length !== 1 || query.has('error')) {
    label.textContent = 'Подключение отменено. Вы можете вернуться в Октопорт.'; return;
  }
  try {
    const payload = {state};
    if (query.has('hash')) {
      query.delete('state');
      payload.user = Object.fromEntries(query);
    } else if (query.get('code')) {
      payload.code = query.get('code');
    } else {
      throw Error('Подключение отменено. Вы можете вернуться в Октопорт.');
    }
    const response = await fetch('/api/telegram/complete', {method:'POST', credentials:'same-origin',
      headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    const result = await response.json();
    if (!response.ok) throw Error(response.status === 401 ? 'Войдите в Октопорт и начните подключение заново.' : result.error);
    label.textContent = 'Telegram подключён к вашему аккаунту Октопорта.';
    const path = sessionStorage.getItem('octoport.telegram.return');
    sessionStorage.removeItem('octoport.telegram.return');
    if (path && /^\/app\/chats\/[A-Za-z0-9_-]+$/.test(path)) {
      const link = document.querySelector('a'); link.href = path; link.textContent = 'Вернуться в чат';
    }
  } catch (e) { label.textContent = e.message || 'Не удалось подтвердить подключение.'; }
})();"""
PRIVATE = {"Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
           "Content-Security-Policy": "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}
WIDGET_HEADERS = {**PRIVATE, "Content-Security-Policy":
    "default-src 'none'; script-src https://telegram.org/js/telegram-widget.js; "
    "frame-src https://oauth.telegram.org; style-src 'unsafe-inline'; "
    "base-uri 'none'; frame-ancestors 'none'; form-action 'none'"}


class TelegramIntegration:
    def __init__(self, identity, config, http):
        self.identity = identity
        self.config = config
        self.http = http
        with identity._write() as db:
            for sql in SCHEMA:
                db.execute(sql)

    @property
    def configured(self):
        return self.config is not None

    def status(self, db, workspace):
        row = db.execute("SELECT bot FROM telegram_recipients WHERE workspace=?", (workspace,)).fetchone()
        return {"configured": self.configured, "linked": bool(row and self.config and row[0] == self.config.bot),
                "hasBinding": bool(row)}

    async def send(self, workspace, text):
        """Deliver only to the confirmed recipient of this trusted workspace."""
        with self.identity._lock:
            row = self.identity._db.execute("SELECT recipient,rowid FROM telegram_recipients WHERE workspace=? AND bot=?",
                (workspace, self.config.bot)).fetchone() if self.config else None
        if not row:
            raise tg.DeliveryError("disconnected")
        try:
            return await tg.send(self.config, row[0], text)
        except tg.DeliveryError as error:
            if error.status == "blocked":
                with self.identity._write() as db:
                    db.execute("DELETE FROM telegram_recipients WHERE workspace=? AND bot=? AND rowid=?",
                               (workspace, self.config.bot, row[1]))
            raise


@asynccontextmanager
async def activate(state):
    try:
        config = tg.Config.load()
    except (OSError, KeyError, ValueError, TypeError):
        logging.getLogger(__name__).error("Telegram integration configuration is invalid")
        config = None
    async with AsyncExitStack() as clients:
        http = state.http
        if config and config.proxy_port:
            http = await clients.enter_async_context(httpx.AsyncClient(
                proxy=f"http://127.0.0.1:{config.proxy_port}", timeout=12, trust_env=False, follow_redirects=False))
        state.telegram = TelegramIntegration(state.identity, config, http)
        yield


def require_config(state):
    config = state.telegram.config
    if not config:
        raise HTTPException(503, "Бот Октопорта ещё не настроен.")
    return config


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def routes(body):
    async def returning(req):
        if req.url.path.endswith(".js"):
            return Response(RETURN_JS, media_type="text/javascript", headers=PRIVATE)
        if req.query_params.get("widget") == "1":
            state = req.app.state
            cfg = require_config(state)
            challenge = req.query_params.get("state", "")
            # Telegram can navigate back here without the Strict session cookie.
            # Only the same-origin completion POST may bind a recipient.
            with state.identity._lock:
                db = state.identity._db
                row = db.execute("""SELECT 1 FROM telegram_integration_consents WHERE state=? AND
                    bot=? AND verifier='' AND expires>unixepoch()""",
                    (digest(challenge), cfg.bot)).fetchone()
                if not row or not cfg.username:
                    raise HTTPException(409, "Подключение истекло. Начните его заново в разделе «Интеграции».")
            target = html.escape("/telegram/return?" + urlencode({"state": challenge}), quote=True)
            return HTMLResponse(f"""<!doctype html><html lang="ru"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Подключить Telegram · Октопорт</title>
<main><h1>Подключить Telegram</h1><p>Выберите аккаунт Telegram и разрешите боту присылать отчёты.</p>
<script async src="https://telegram.org/js/telegram-widget.js?22" data-telegram-login="{html.escape(cfg.username)}"
data-size="large" data-lang="ru" data-request-access="write" data-auth-url="{target}"></script>
<p><a href="/app/">Вернуться в Октопорт</a></p></main></html>""",
                                headers=WIDGET_HEADERS)
        return HTMLResponse(RETURN_PAGE, headers=PRIVATE)

    async def manage(req):
        token = browser_token(req)
        state = req.app.state
        await body(req)
        with state.identity._write() as db:
            _, ws = _principal(db, token)
            if req.url.path.endswith("/disconnect"):
                db.execute("DELETE FROM telegram_integration_consents WHERE workspace=?", (ws,))
                db.execute("DELETE FROM telegram_recipients WHERE workspace=?", (ws,))
                return JSONResponse({"linked": False})
            cfg = require_config(state)
            if state.telegram.status(db, ws)["hasBinding"]:
                raise HTTPException(409, "Сначала отключите существующую интеграцию Telegram.")
            challenge = secrets.token_urlsafe(32)
            verifier, nonce = (secrets.token_urlsafe(32), secrets.token_urlsafe(32)) if cfg.secret else ("", "")
            db.execute("DELETE FROM telegram_integration_consents WHERE workspace=? OR expires<=unixepoch()", (ws,))
            db.execute("""INSERT INTO telegram_integration_consents(session,state,workspace,bot,verifier,nonce,expires)
                          VALUES(?,?,?,?,?,?,?)""", (_secret_digest(token), digest(challenge), ws, cfg.bot,
                                                     verifier, nonce, int(time.time())+600))
        return JSONResponse({"url": tg.authorize(cfg, challenge, verifier, nonce)})

    async def complete(req):
        token = browser_token(req)
        state = req.app.state
        cfg = require_config(state)
        widget = cfg.secret is None
        fields = await body(req, "state", "user" if widget else "code")
        strings = [fields["state"]] if widget else fields.values()
        if any(not isinstance(v, str) or not 1 <= len(v) <= 2048 for v in strings):
            raise HTTPException(400, "Некорректный ответ Telegram.")
        sid = _secret_digest(token)
        with state.identity._write() as db:
            row = db.execute("""SELECT workspace,verifier,nonce,expires FROM telegram_integration_consents WHERE state=? AND
                session=? AND bot=? AND expires>unixepoch()""", (digest(fields["state"]),sid,cfg.bot)).fetchone()
            if not row:
                raise HTTPException(409,"Ссылка истекла или уже использована. Начните подключение заново.")
            ws, verifier, nonce, expires = row
            if widget != (verifier == ""):
                raise HTTPException(409, "Способ входа изменился. Начните подключение заново.")
            if _principal(db, token)[1] != ws:
                raise HTTPException(409, "Аккаунт подключения изменился.")
            if widget:
                uid, signature, until = tg.widget_identity(cfg, fields["user"], expires - 600)
                db.execute("DELETE FROM telegram_widget_receipts WHERE expires<=unixepoch()")
                inserted = db.execute("INSERT OR IGNORE INTO telegram_widget_receipts VALUES(?,?)",
                                      (signature, until)).rowcount
                if not inserted:
                    raise HTTPException(409, "Это подтверждение уже использовано. Войдите в Telegram заново.")
            # Reserve this response exactly once but leave the row revocable during network I/O.
            reservation = secrets.token_hex(32)
            db.execute("UPDATE telegram_integration_consents SET state=? WHERE session=?", (reservation,sid))
        if not widget:
            uid = await tg.verified_user(state.telegram.http, cfg, fields["code"], verifier, nonce)
        with state.identity._lock:
            db = state.identity._db
            if _principal(db, token)[1] != ws or not db.execute(
                    "SELECT 1 FROM telegram_integration_consents WHERE session=? AND state=? AND expires>unixepoch()",
                    (sid, reservation)).fetchone():
                raise HTTPException(409, "Подключение отменено. Начните заново.")
            existing = db.execute("SELECT workspace,recipient,bot FROM telegram_recipients WHERE workspace=? OR (bot=? AND recipient=?)",
                                  (ws,cfg.bot,uid)).fetchall()
            if existing and existing != [(ws,uid,cfg.bot)]:
                raise HTTPException(409,"Этот аккаунт уже связан. Для замены сначала отключите прежнюю связь.")
        try:
            await tg.send(cfg, uid, "Октопорт проверяет подключение Telegram к вашему аккаунту.")
        except tg.DeliveryError:
            raise HTTPException(409,"Доставка в Telegram не подтверждена. Разрешите сообщения и повторите подключение.") from None
        try:
            with state.identity._write() as db:
                if _principal(db, token)[1] != ws:
                    raise HTTPException(409, "Аккаунт подключения изменился.")
                if not db.execute("DELETE FROM telegram_integration_consents WHERE session=? AND state=? AND expires>unixepoch()",
                                  (sid,reservation)).rowcount:
                    raise HTTPException(409,"Подключение отменено. Начните заново.")
                # A late 403 from a previous binding must not revoke a fresh consent, even for the same user.
                db.execute("""INSERT INTO telegram_recipients(rowid,workspace,bot,recipient) VALUES(?,?,?,?)
                              ON CONFLICT(workspace) DO NOTHING""", (secrets.randbits(63),ws,cfg.bot,uid))
                if db.execute("SELECT bot,recipient FROM telegram_recipients WHERE workspace=?",
                              (ws,)).fetchone() != (cfg.bot,uid):
                    raise HTTPException(409,"Получатель изменился. Начните заново.")
        except sqlite3.IntegrityError:
            raise HTTPException(409,"Telegram уже привязан к другому аккаунту.") from None
        return JSONResponse({"linked": True})

    return [Route(BASE+"/connect", manage, methods=["POST"]), Route(BASE+"/disconnect", manage, methods=["POST"]),
            Route("/telegram/return", returning), Route("/telegram/return.js", returning),
            Route("/api/telegram/complete", complete, methods=["POST"])]
