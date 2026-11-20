"""One browser owns one temporary public conversation until account registration."""

import base64
import hashlib
import hmac
import re
import secrets
from time import time
from uuid import uuid4

from .identity import (
    AuthenticationError, ChatUnavailable, IdentityStore, _SESSION_SECONDS,
    _derive, _login_name, _password_bytes, _secret_digest,
)
from .storage import Scope, _bind_chat

GUEST_LIFETIME = 24 * 60 * 60
MAX_GUEST_TURNS = 12


class RegistrationConflict(ValueError):
    pass


class GuestLimit(ValueError):
    pass


def _public_answer(text):
    words = text.casefold()
    if any(term in words for term in ("инструмент", "функци", "модул")):
        return ("В кабинете откройте «Инструменты» в нужном чате. "
                "Список зависит от прав аккаунта и функций, включённых для этого чата.")
    if any(term in words for term in ("истор", "сохран", "регистра", "войти")):
        return ("Чтобы сохранить этот разговор, нажмите «Создать аккаунт». "
                "После регистрации ссылка на чат останется прежней. На другом устройстве войдите с тем же логином.")
    return ("В гостевом чате доступна справка о сервисе. Спросите, как сохранить историю "
            "или где найти инструменты. Для работы со своими данными создайте аккаунт и подключите магазин.")


class RegistrationStore(IdentityStore):
    def __init__(self, path):
        super().__init__(path)
        try:
            with self._write() as db:
                db.execute("""CREATE TABLE IF NOT EXISTS guest_chats (
                    chat_id TEXT PRIMARY KEY NOT NULL, digest BLOB UNIQUE NOT NULL,
                    expires_at INTEGER NOT NULL,
                    claimed_actor TEXT UNIQUE REFERENCES identity_accounts ON DELETE CASCADE)""")
                db.execute("""CREATE TABLE IF NOT EXISTS guest_turns (
                    chat_id TEXT NOT NULL REFERENCES guest_chats ON DELETE CASCADE,
                    request_id TEXT NOT NULL, text TEXT NOT NULL, answer TEXT NOT NULL, at_ms INTEGER NOT NULL,
                    PRIMARY KEY (chat_id, request_id))""")
                db.execute("CREATE INDEX IF NOT EXISTS guest_expiry ON guest_chats(expires_at) WHERE claimed_actor IS NULL")
                self._prune(db)
        except BaseException:
            self.close()
            raise

    @staticmethod
    def _prune(db):
        db.execute("DELETE FROM guest_chats WHERE claimed_actor IS NULL AND expires_at <= ?", (int(time()),))

    def start_guest(self):
        token, chat = secrets.token_urlsafe(32), uuid4().hex
        with self._write() as db:
            self._prune(db)
            db.execute("INSERT INTO guest_chats VALUES (?, ?, ?, NULL)",
                       (chat, _secret_digest(token), int(time()) + GUEST_LIFETIME))
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

    @staticmethod
    def _turns(db, chat_id):
        rows = db.execute("""SELECT request_id, text, answer, at_ms FROM guest_turns
                             WHERE chat_id = ? ORDER BY rowid""", (chat_id,))
        return [dict(requestId=key, text=text, answer=answer, at=at) for key, text, answer, at in rows]

    def guest_history(self, token, chat):
        with self._write() as db:
            return self._turns(db, self._active(db, token, chat))

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
            if db.execute("SELECT count(*) FROM guest_turns WHERE chat_id=?", (chat,)).fetchone()[0] >= MAX_GUEST_TURNS:
                raise GuestLimit("Guest conversation is full")
            db.execute("INSERT INTO guest_turns VALUES (?,?,?,?,?)",
                       (chat, request_id, text, _public_answer(text), int(time() * 1000)))

    def register(self, guest_token, login, password, recovery):
        name = _login_name(login)
        secret = _password_bytes(password)
        digest, recovery_digest = _secret_digest(guest_token), _secret_digest(recovery)
        # The browser can repeat its original form after a lost response. Each
        # form has its own server-generated recovery secret. Store only digests.
        signature = hmac.digest(guest_token.encode("ascii"), b"guest-signup-v1:" + recovery_digest, "sha256")
        session = base64.urlsafe_b64encode(signature).decode().rstrip("=")
        with self._lock:
            prior = self._db.execute("""SELECT a.salt FROM guest_chats g
                LEFT JOIN identity_accounts a ON g.claimed_actor=a.actor_id
                WHERE g.digest=? AND g.expires_at>?""", (digest, int(time()))).fetchone()
        if prior is None:
            raise AuthenticationError("Guest session unavailable")
        # A deterministic unique salt for this registration makes concurrent
        # identical submissions independently verifiable without hashing under the write lock.
        salt = prior[0] or hashlib.sha256(b"signup-salt-v1:" + digest).digest()[:16]
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
            db.execute("UPDATE guest_chats SET claimed_actor=? WHERE chat_id=?", (actor, chat))
            db.execute("INSERT INTO identity_sessions (digest, actor_id, expires_at) VALUES (?,?,?)",
                       (_secret_digest(session), actor, now + _SESSION_SECONDS))
        return session, chat

    def claimed_history(self, scope):
        with self._lock:
            row = self._db.execute("""SELECT 1 FROM guest_chats g JOIN identity_accounts a
                ON a.actor_id=g.claimed_actor WHERE g.chat_id=? AND a.actor_id=? AND a.workspace_id=?""",
                                   (scope.chat_id, scope.actor_id, scope.workspace_id)).fetchone()
            return self._turns(self._db, scope.chat_id) if row else []

    def registered_chat(self, token):
        with self._lock:
            row = self._db.execute("""SELECT chat_id FROM guest_chats g JOIN identity_sessions s
                ON g.claimed_actor=s.actor_id WHERE s.digest=? AND s.expires_at>?""",
                                   (_secret_digest(token), int(time()))).fetchone()
            return row[0] if row else None
