"""Deliver new completed marketplace reports from the committed, account-scoped journal."""
import asyncio
import hashlib
import json
import logging
import sqlite3
import time
from contextlib import closing
from uuid import uuid4

from ..integrations import SECRET_TEXT
from . import telegram_api as tg

PLUGIN = "telegram-reports"
SCHEMA = (
    """CREATE TABLE IF NOT EXISTS telegram_recipients(
        workspace TEXT PRIMARY KEY REFERENCES workspaces(workspace_id) ON DELETE CASCADE,
        bot TEXT NOT NULL, recipient INTEGER NOT NULL, UNIQUE(bot,recipient))""",
    """CREATE TABLE IF NOT EXISTS telegram_consents(
        session BLOB PRIMARY KEY, state TEXT UNIQUE NOT NULL, chat TEXT NOT NULL REFERENCES chats ON DELETE CASCADE,
        bot TEXT NOT NULL, verifier TEXT NOT NULL, nonce TEXT NOT NULL, expires INTEGER NOT NULL,
        workspace TEXT NOT NULL, plugin TEXT NOT NULL,
        FOREIGN KEY(workspace,chat,plugin) REFERENCES chat_plugins ON DELETE CASCADE)""",
    """CREATE TABLE IF NOT EXISTS telegram_subscriptions(
        workspace TEXT NOT NULL REFERENCES telegram_recipients(workspace) ON DELETE CASCADE,
        chat TEXT PRIMARY KEY, plugin TEXT NOT NULL, generation TEXT NOT NULL, cursor INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'ready', retry_at INTEGER NOT NULL DEFAULT 0, last_sent INTEGER,
        FOREIGN KEY(workspace,chat,plugin) REFERENCES chat_plugins ON DELETE CASCADE)""",
)


def read_journal(path, actor, workspace, chat, after=None):
    if not path.is_file():
        return -1 if after is None else []
    scope = hashlib.sha256(json.dumps([actor, workspace, chat], ensure_ascii=False,
                                     separators=(",", ":")).encode()).hexdigest()
    with closing(sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=.2)) as db:
        if not db.execute("SELECT 1 FROM sqlite_schema WHERE name='native_batches'").fetchone():
            return -1 if after is None else []
        if after is None:
            return db.execute("SELECT COALESCE(MAX(revision),-1) FROM native_batches WHERE scope_key=?",
                              (scope,)).fetchone()[0]
        # One immutable batch at a time bounds memory even with long conversations.
        return db.execute("""SELECT revision,action,events FROM native_batches
                             WHERE scope_key=? AND revision>? ORDER BY revision LIMIT 1""", (scope, after)).fetchall()


def report_text(events):
    calls = set()
    confirmed = False
    final = ""
    completed = False
    for event in events:
        data = event.get("data", {})
        kind = event.get("type")
        if kind == "assistant/message":
            blocks = data["message"]["content"]
            for block in blocks:
                if block.get("type") == "tool-call" and block.get("name") == "mcp__platform__marketplace_report":
                    calls.add(block["id"])
            final = "".join(b["text"] for b in blocks if b.get("type") == "text") if confirmed else ""
        elif kind == "tool/result":
            message = data["message"]
            if message.get("toolCallId") not in calls or message.get("isError"):
                continue
            for block in message.get("content", []):
                if block.get("type") != "text":
                    continue
                try:
                    payload = json.loads(block["text"])["result"]
                except (ValueError, TypeError, KeyError):
                    continue
                if isinstance(payload, dict) and payload.get("ok") is True and any(
                        payload.get(k) for k in ("answer", "reports", "pluginReports", "sourceValues")):
                    confirmed = True
        elif kind == "turn/end":
            completed = data.get("reason", {}).get("kind") == "completed"
    if completed and final.strip() and not SECRET_TEXT.search(final):
        return final
    return None


def subscribe(db, scope, cursor):
    db.execute("""INSERT INTO telegram_subscriptions(workspace,chat,plugin,generation,cursor)
                  VALUES(?,?,?,?,?) ON CONFLICT(chat) DO NOTHING""",
               (scope.workspace_id, scope.chat_id, PLUGIN, uuid4().hex, cursor))


class Delivery:
    def __init__(self, state, config):
        self.state = state
        self.config = config
        self.wake = asyncio.Event()
        with state.identity._write() as db:
            for sql in SCHEMA:
                db.execute(sql)
            # A process may have stopped after Telegram accepted the HTTP request.
            db.execute("UPDATE telegram_subscriptions SET status='unknown' WHERE status='sending'")
        self.task = asyncio.create_task(self.run()) if config else None

    async def close(self):
        if self.task:
            self.task.cancel()
            await asyncio.gather(self.task, return_exceptions=True)

    async def run(self):
        while True:
            self.wake.clear()
            try:
                with self.state.identity._lock:
                    rows = self.state.identity._db.execute("""SELECT w.owner_id,s.workspace,s.chat,s.cursor,
                        s.generation,r.recipient FROM telegram_subscriptions s
                        JOIN telegram_recipients r USING(workspace) JOIN workspaces w ON w.workspace_id=s.workspace
                        WHERE r.bot=? AND s.status IN ('ready','limited') AND s.retry_at<=unixepoch()""",
                        (self.config.bot,)).fetchall()
                # Each recipient progresses independently. Per-bot burst is bounded.
                for offset in range(0, len(rows), 4):
                    await asyncio.gather(*(self.process(row) for row in rows[offset:offset+4]))
            except (OSError, sqlite3.Error, ValueError, KeyError, TypeError):
                logging.getLogger(__name__).warning("Telegram report scan will retry")
            try:
                await asyncio.wait_for(self.wake.wait(), timeout=12)
            except TimeoutError:
                pass

    async def process(self, row):
        actor, workspace, chat, cursor, generation, uid = row
        # Catch up a bounded number per pass so other recipients also make progress.
        for _ in range(16):
            entries = await asyncio.to_thread(read_journal, self.state.worker.journal, actor, workspace, chat, cursor)
            if not entries:
                return
            revision, action, raw = entries[0]
            text = report_text(json.loads(raw)) if action == "turn" else None
            with self.state.identity._write() as db:
                claimed = db.execute("""UPDATE telegram_subscriptions SET cursor=?,status=?,retry_at=0
                    WHERE chat=? AND generation=? AND cursor=? AND status IN ('ready','limited')
                    AND retry_at<=unixepoch() AND EXISTS(SELECT 1 FROM telegram_recipients
                    WHERE workspace=? AND bot=? AND recipient=?)""",
                    (revision, "sending" if text else "ready", chat, generation, cursor,
                     workspace, self.config.bot, uid)).rowcount
            if not claimed:
                return
            if text:
                try:
                    await tg.send(self.config, uid, text)
                except tg.DeliveryError as error:
                    with self.state.identity._write() as db:
                        if error.status == "blocked":
                            # Preserve other accounts and any replacement binding.
                            db.execute("""DELETE FROM telegram_recipients WHERE workspace=? AND bot=? AND recipient=?
                                AND EXISTS(SELECT 1 FROM telegram_subscriptions WHERE chat=? AND generation=?)""",
                                (workspace,self.config.bot,uid,chat,generation))
                        else:
                            db.execute("""UPDATE telegram_subscriptions SET cursor=?,status=?,retry_at=?
                                WHERE chat=? AND generation=?""",
                                (cursor if error.status == "limited" else revision, error.status,
                                 int(time.time()) + error.delay, chat, generation))
                    return
                with self.state.identity._write() as db:
                    db.execute("""UPDATE telegram_subscriptions SET status='ready',last_sent=unixepoch()
                                  WHERE chat=? AND generation=?""", (chat, generation))
            cursor = revision
        self.wake.set()
