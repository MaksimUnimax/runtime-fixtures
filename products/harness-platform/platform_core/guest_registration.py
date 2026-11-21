"""One browser owns one temporary public conversation until account registration."""

import base64
from contextlib import closing
import hashlib
import json
import sqlite3
import hmac
import re
import secrets
from pathlib import Path
from time import time
from uuid import uuid4

from .identity import (
    AuthenticationError, ChatUnavailable, IdentityStore, _SESSION_SECONDS,
    _derive, _login_name, _password_bytes, _principal, _secret_digest,
)
from .storage import Scope, _bind_chat
from .public_faq import PublicFAQ
from .coins import PRICING_SCHEMA, sale_pricing

GUEST_LIFETIME = 24 * 60 * 60
GUEST_PAGE_SIZE = 25


class RegistrationConflict(ValueError):
    pass


def _recovery_code(guest_token, nonce):
    signature = hmac.digest(guest_token.encode("ascii"), b"guest-recovery-v1:" + nonce, "sha256")
    return base64.urlsafe_b64encode(signature).decode().rstrip("=")


class RegistrationStore(IdentityStore):
    def __init__(self, path):
        self.faq = None
        super().__init__(path)
        try:
            self.faq = PublicFAQ(None if str(path) == ":memory:" else Path(str(path) + ".public-faq.sqlite3"))
            with self._write() as db:
                db.execute(PRICING_SCHEMA)
                db.execute("""CREATE TABLE IF NOT EXISTS guest_chats (
                    chat_id TEXT PRIMARY KEY NOT NULL, digest BLOB UNIQUE NOT NULL,
                    expires_at INTEGER NOT NULL, signup_nonce BLOB,
                    claimed_actor TEXT UNIQUE REFERENCES identity_accounts ON DELETE CASCADE)""")
                db.execute("""CREATE TABLE IF NOT EXISTS guest_turns (
                    chat_id TEXT NOT NULL REFERENCES guest_chats ON DELETE CASCADE,
                    request_id TEXT NOT NULL, text TEXT NOT NULL, answer TEXT NOT NULL, at_ms INTEGER NOT NULL,
                    PRIMARY KEY (chat_id, request_id))""")
                db.execute("CREATE INDEX IF NOT EXISTS guest_expiry ON guest_chats(expires_at) WHERE claimed_actor IS NULL")
                db.execute("CREATE INDEX IF NOT EXISTS guest_turn_chat ON guest_turns(chat_id)")
                self._prune(db)
        except BaseException:
            self.close()
            raise

    def close(self):
        super().close()
        if self.faq is not None:
            self.faq.close()

    @staticmethod
    def _prune(db):
        db.execute("DELETE FROM guest_chats WHERE claimed_actor IS NULL AND expires_at <= ?", (int(time()),))

    def start_guest(self):
        token, chat = secrets.token_urlsafe(32), uuid4().hex
        with self._write() as db:
            self._prune(db)
            db.execute("INSERT INTO guest_chats (chat_id, digest, expires_at, signup_nonce) VALUES (?, ?, ?, ?)",
                       (chat, _secret_digest(token), int(time()) + GUEST_LIFETIME, secrets.token_bytes(32)))
        return token, chat

    @staticmethod
    def _active(db, token, chat=None):
        row = db.execute("""SELECT chat_id FROM guest_chats
            WHERE digest = ? AND claimed_actor IS NULL AND expires_at > ?""",
                         (_secret_digest(token), int(time()))).fetchone()
        if row is None:
            raise AuthenticationError("Guest session unavailable")
        if chat is not None and row[0] != chat:
            raise ChatUnavailable("Chat unavailable")
        return row[0]

    def guest_chat(self, token):
        with self._lock:
            return self._active(self._db, token)

    def guest_chat_summary(self, token):
        with self._lock:
            chat = self._active(self._db, token)
            has_turns = self._db.execute("SELECT EXISTS(SELECT 1 FROM guest_turns WHERE chat_id=?)",
                                         (chat,)).fetchone()[0]
            return chat, bool(has_turns)

    def guest_recovery(self, token):
        with self._lock:
            row = self._db.execute("""SELECT signup_nonce FROM guest_chats
                WHERE digest=? AND claimed_actor IS NULL AND expires_at>?""",
                                   (_secret_digest(token), int(time()))).fetchone()
        if not row:
            raise AuthenticationError("Guest session unavailable")
        return _recovery_code(token, row[0])

    @staticmethod
    def _turns(db, chat_id):
        rows = db.execute("""SELECT request_id, text, answer, at_ms FROM guest_turns
                             WHERE chat_id = ? ORDER BY rowid""", (chat_id,))
        return [dict(requestId=key, text=text, answer=answer, at=at) for key, text, answer, at in rows]

    def chat_activity(self, token, journal):
        """Return each owned chat and the timestamp of its last committed conversation event."""
        with self._lock:
            actor, workspace = _principal(self._db, token)
            # Claimed guest messages can exist before the native worker imports them.
            rows = self._db.execute("""
                SELECT c.chat_id, (SELECT MAX(t.at_ms) FROM guest_turns t
                    JOIN guest_chats g ON g.chat_id=t.chat_id
                    WHERE t.chat_id=c.chat_id AND g.claimed_actor=?) FROM chats c
                WHERE c.workspace_id=? ORDER BY c.rowid""", (actor, workspace)).fetchall()
        result = dict(rows)
        if not rows or not journal.is_file():
            return result
        try:
            with closing(sqlite3.connect(journal.as_uri() + "?mode=ro", uri=True, timeout=0.1)) as db:
                if not db.execute("SELECT 1 FROM sqlite_schema WHERE name='native_batches'").fetchone():
                    return result
                # A single index lookup per chat. Reading the list never loads transcripts.
                keys = {hashlib.sha256(json.dumps([actor, workspace, cid], ensure_ascii=False,
                             separators=(",", ":")).encode()).hexdigest(): cid for cid in result}
                for key, at in db.execute("""SELECT value,
                        (SELECT json_extract(events,'$[#-1].time') FROM native_batches
                         WHERE scope_key=value ORDER BY revision DESC LIMIT 1)
                        FROM json_each(?)""", (json.dumps(list(keys)),)):
                    if isinstance(at, int):
                        cid = keys[key]
                        result[cid] = max(result[cid] or 0, at)
        except sqlite3.OperationalError as exc:
            # Sidebar timestamps are optional while the worker holds the journal lock.
            if (exc.sqlite_errorcode & 0xff) not in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                raise
        return result

    def guest_history(self, token, chat):
        with self._write() as db:
            return self._turns(db, self._active(db, token, chat))

    def guest_page(self, token, chat, before):
        rows, cursor, _ = self.guest_window(token, chat, before)
        return rows, cursor

    def guest_window(self, token, chat, before):
        with self._write() as db:
            self._active(db, token, chat)
            rows = db.execute("""SELECT rowid, text, answer, request_id, at_ms FROM guest_turns
                WHERE chat_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?""",
                              (chat, before, GUEST_PAGE_SIZE + 1)).fetchall()
            shown = rows[:GUEST_PAGE_SIZE]
            cursor = shown[-1][0] if len(rows) > GUEST_PAGE_SIZE else None
            offset = db.execute("SELECT COUNT(*) FROM guest_turns WHERE chat_id=? AND rowid<?",
                                (chat, cursor)).fetchone()[0] if cursor is not None else 0
            return ([{"text": text, "answer": answer, "requestId": key, "at": at}
                     for _, text, answer, key, at in reversed(shown)], cursor, offset)

    def guest_turn(self, token, chat, request_id, text):
        if not isinstance(text, str) or not text.strip() or len(text.encode()) > 8192:
            raise ValueError("Invalid message")
        if not isinstance(request_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_id):
            raise ValueError("Invalid request id")
        with self._write() as db:
            self._active(db, token, chat)
            row = db.execute("SELECT text FROM guest_turns WHERE chat_id=? AND request_id=?",
                             (chat, request_id)).fetchone()
            if row:
                if row[0] != text:
                    raise RegistrationConflict("Request already used")
                return
            answer = self.faq.answer(text)
            if "{sale_price}" in answer:
                price = sale_pricing(db)["rubPerCoin"]
                whole, _, fraction = price.partition(".")
                answer = answer.replace("{sale_price}", whole + "," + fraction.ljust(2, "0"))
            db.execute("INSERT INTO guest_turns VALUES (?,?,?,?,?)",
                       (chat, request_id, text, answer, int(time() * 1000)))

    def register(self, guest_token, login, password, recovery):
        name = _login_name(login)
        secret = _password_bytes(password)
        digest, recovery_digest = _secret_digest(guest_token), _secret_digest(recovery)
        # The browser can repeat its original form after a lost response. Each
        # draft has a server-issued recovery secret. Neither cookie nor recovery is stored in plaintext.
        signature = hmac.digest(guest_token.encode("ascii"), b"guest-signup-v1:" + recovery_digest, "sha256")
        session = base64.urlsafe_b64encode(signature).decode().rstrip("=")
        with self._lock:
            prior = self._db.execute("""SELECT a.salt, g.signup_nonce FROM guest_chats g
                LEFT JOIN identity_accounts a ON g.claimed_actor=a.actor_id
                WHERE g.digest=? AND g.expires_at>?""", (digest, int(time()))).fetchone()
        if prior is None:
            raise AuthenticationError("Guest session unavailable")
        # The nonce is private to an unclaimed draft. Identical concurrent
        # forms can hash outside the writer lock and use the same random salt.
        saved_salt, nonce = prior
        if nonce is not None and not hmac.compare_digest(_recovery_code(guest_token, nonce), recovery):
            raise AuthenticationError("Invalid registration form")
        salt = saved_salt if nonce is None else nonce[:16]
        candidate = _derive(secret, salt)
        with self._write() as db:
            now = int(time())
            row = db.execute("""SELECT chat_id, claimed_actor FROM guest_chats
                WHERE digest=? AND expires_at>?""", (digest, now)).fetchone()
            if row is None:
                raise AuthenticationError("Guest session unavailable")
            chat, claimed = row
            if claimed:
                account = db.execute("""SELECT login, password_hash, recovery_digest FROM identity_accounts
                    WHERE actor_id=?""", (claimed,)).fetchone()
                if (account[0] != name or not hmac.compare_digest(account[2], recovery_digest)
                        or not hmac.compare_digest(account[1], candidate)):
                    raise RegistrationConflict("Registration already completed")
                if not db.execute("""SELECT 1 FROM identity_sessions
                    WHERE digest=? AND actor_id=? AND expires_at>?""", (_secret_digest(session), claimed, now)).fetchone():
                    raise AuthenticationError("Sign in again")
                return session, chat
            if db.execute("SELECT 1 FROM identity_accounts WHERE login=?", (name,)).fetchone():
                raise RegistrationConflict("Login already in use")
            actor, workspace = uuid4().hex, uuid4().hex
            db.execute("INSERT INTO workspaces (workspace_id, owner_id) VALUES (?,?)", (workspace, actor))
            _bind_chat(db, Scope(actor, workspace, chat))
            db.execute("""INSERT INTO identity_accounts
                (actor_id, login, workspace_id, salt, password_hash, recovery_digest)
                VALUES (?,?,?,?,?,?)""", (actor, name, workspace, salt, candidate, recovery_digest))
            db.execute("UPDATE guest_chats SET claimed_actor=?, signup_nonce=NULL WHERE chat_id=?", (actor, chat))
            db.execute("INSERT INTO identity_sessions (digest, actor_id, expires_at) VALUES (?,?,?)",
                       (_secret_digest(session), actor, now + _SESSION_SECONDS))
        return session, chat

    def has_claimed_guest_turns(self, scope):
        with self._lock:
            return self._db.execute("""SELECT 1 FROM guest_chats g JOIN identity_accounts a
                ON a.actor_id=g.claimed_actor WHERE g.chat_id=? AND a.actor_id=? AND a.workspace_id=?
                AND EXISTS (SELECT 1 FROM guest_turns t WHERE t.chat_id=g.chat_id)""",
                                    (scope.chat_id, scope.actor_id, scope.workspace_id)).fetchone() is not None

    def registered_chat(self, token):
        with self._lock:
            row = self._db.execute("""SELECT chat_id FROM guest_chats g JOIN identity_sessions s
                ON g.claimed_actor=s.actor_id WHERE s.digest=? AND s.expires_at>?""",
                                   (_secret_digest(token), int(time()))).fetchone()
            return row[0] if row else None
