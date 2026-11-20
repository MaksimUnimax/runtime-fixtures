"""Server-owned accounts and sessions on the existing single-owner workspace store."""

import hashlib
import json
import hmac
import re
import secrets
from pathlib import Path
from time import time
from uuid import uuid4

from .operation_grants import OPERATION_SCHEMA
from . import coins
from .storage import Scope, Store, _bind_chat, _owns_chat


_SESSION_SECONDS = 12 * 60 * 60
_FAILURE_WINDOW = 5 * 60
_MAX_FAILURES = 5
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
_SCHEMA = (
    *OPERATION_SCHEMA,
    """CREATE TABLE IF NOT EXISTS identity_accounts (
           actor_id TEXT PRIMARY KEY NOT NULL,
           login TEXT UNIQUE NOT NULL,
           workspace_id TEXT UNIQUE NOT NULL REFERENCES workspaces ON DELETE CASCADE,
           salt BLOB NOT NULL,
           password_hash BLOB NOT NULL,
           recovery_digest BLOB NOT NULL,
           failures INTEGER NOT NULL DEFAULT 0,
           failure_start INTEGER NOT NULL DEFAULT 0
       )""",
    """CREATE TABLE IF NOT EXISTS identity_sessions (
           digest BLOB PRIMARY KEY NOT NULL,
           actor_id TEXT NOT NULL REFERENCES identity_accounts ON DELETE CASCADE,
           expires_at INTEGER NOT NULL
       )""",
    """CREATE TABLE IF NOT EXISTS identity_admins (
           actor_id TEXT PRIMARY KEY NOT NULL REFERENCES identity_accounts ON DELETE CASCADE
       )""",
    "CREATE INDEX IF NOT EXISTS identity_session_expiry ON identity_sessions (expires_at)",
    "CREATE INDEX IF NOT EXISTS identity_session_owner ON identity_sessions (actor_id)",
)


class AuthenticationError(PermissionError):
    """Invalid credentials, expired session, or exhausted login attempts."""


class ChatUnavailable(LookupError):
    """A missing chat and another account's chat have the same public result."""


def _login_name(login: str) -> str:
    if not isinstance(login, str) or len(login) > 254:
        raise ValueError("Invalid login")
    name = login.strip().casefold()
    if not name or not name.isprintable() or len(name) > 254:
        raise ValueError("Invalid login")
    return name


def _password_bytes(password: str) -> bytes:
    if not isinstance(password, str) or not 15 <= len(password) <= 256:
        raise ValueError("Use a password of 15 to 256 characters")
    return password.encode("utf-8")


def _derive(password: bytes, salt: bytes) -> bytes:
    return hashlib.pbkdf2_hmac("sha256", password, salt, 600_000)


def _secret_digest(secret: str) -> bytes:
    if not isinstance(secret, str) or not _TOKEN.fullmatch(secret):
        raise AuthenticationError("Invalid credentials")
    return hashlib.sha256(secret.encode("ascii")).digest()


def _principal(db, token: str) -> tuple[str, str]:
    row = db.execute(
        """SELECT a.actor_id, a.workspace_id
           FROM identity_sessions s JOIN identity_accounts a USING (actor_id)
           JOIN workspaces w ON w.workspace_id = a.workspace_id AND w.owner_id = a.actor_id
           WHERE s.digest = ? AND s.expires_at > ?""",
        (_secret_digest(token), int(time())),
    ).fetchone()
    if row is None:
        raise AuthenticationError("Invalid session")
    return row


class IdentityStore(Store):
    def __init__(self, path: str | Path):
        super().__init__(path)
        try:
            with self._write() as db:
                for statement in _SCHEMA:
                    db.execute(statement)
        except BaseException:
            self.close()
            raise

    def create_account(self, login: str, password: str) -> str:
        """Trusted provisioning. Return the recovery secret once to its owner."""
        name = _login_name(login)
        salt = secrets.token_bytes(16)
        password_hash = _derive(_password_bytes(password), salt)
        recovery = secrets.token_urlsafe(32)
        actor, workspace = uuid4().hex, uuid4().hex
        with self._write() as db:
            if db.execute("SELECT 1 FROM identity_accounts WHERE login = ?", (name,)).fetchone():
                raise ValueError("Login already exists")
            db.execute("INSERT INTO workspaces (workspace_id, owner_id) VALUES (?, ?)", (workspace, actor))
            db.execute(
                """INSERT INTO identity_accounts
                   (actor_id, login, workspace_id, salt, password_hash, recovery_digest)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (actor, name, workspace, salt, password_hash, _secret_digest(recovery)),
            )
        return recovery

    def login(self, login: str, password: str) -> str:
        try:
            name, encoded = _login_name(login), _password_bytes(password)
        except ValueError:
            raise AuthenticationError("Invalid credentials") from None
        with self._lock:
            row = self._db.execute(
                """SELECT actor_id, salt, password_hash, failures, failure_start
                   FROM identity_accounts WHERE login = ?""",
                (name,),
            ).fetchone()
        if row and row[3] >= _MAX_FAILURES and row[4] + _FAILURE_WINDOW > time():
            raise AuthenticationError("Invalid credentials")
        # Hash outside the SQLite writer lock. Unknown logins do comparable work.
        candidate = _derive(encoded, row[1] if row else bytes(16))
        if row is None:
            raise AuthenticationError("Invalid credentials")
        actor, _, previous_hash, _, _ = row
        matched = hmac.compare_digest(previous_hash, candidate)
        with self._write() as db:
            now = int(time())
            current = db.execute(
                "SELECT password_hash, failures, failure_start FROM identity_accounts WHERE actor_id = ?",
                (actor,),
            ).fetchone()
            if current is None or current[0] != previous_hash:
                raise AuthenticationError("Invalid credentials")
            _, failures, start = current
            if start + _FAILURE_WINDOW <= now:
                failures, start = 0, now
            if failures >= _MAX_FAILURES:
                raise AuthenticationError("Invalid credentials")
            if matched:
                token = secrets.token_urlsafe(32)
                db.execute("UPDATE identity_accounts SET failures = 0, failure_start = 0 WHERE actor_id = ?", (actor,))
                db.execute("DELETE FROM identity_sessions WHERE expires_at <= ?", (now,))
                db.execute(
                    "INSERT INTO identity_sessions (digest, actor_id, expires_at) VALUES (?, ?, ?)",
                    (_secret_digest(token), actor, now + _SESSION_SECONDS),
                )
                return token
            db.execute(
                "UPDATE identity_accounts SET failures = ?, failure_start = ? WHERE actor_id = ?",
                (failures + 1, start, actor),
            )
        # Raise after committing the failed attempt.
        raise AuthenticationError("Invalid credentials")

    def logout(self, token: str) -> None:
        with self._write() as db:
            db.execute("DELETE FROM identity_sessions WHERE digest = ?", (_secret_digest(token),))

    def reset_password(self, login: str, recovery: str, password: str) -> str:
        """Consume the recovery secret, replace it and revoke all device sessions."""
        try:
            name = _login_name(login)
        except ValueError:
            raise AuthenticationError("Invalid credentials") from None
        digest = _secret_digest(recovery)
        with self._lock:
            row = self._db.execute(
                "SELECT actor_id, recovery_digest FROM identity_accounts WHERE login = ?", (name,)
            ).fetchone()
        if row is None or not hmac.compare_digest(digest, row[1]):
            raise AuthenticationError("Invalid credentials")
        salt = secrets.token_bytes(16)
        password_hash = _derive(_password_bytes(password), salt)
        replacement = secrets.token_urlsafe(32)
        with self._write() as db:
            updated = db.execute(
                """UPDATE identity_accounts SET salt = ?, password_hash = ?, recovery_digest = ?,
                       failures = 0, failure_start = 0
                   WHERE actor_id = ? AND recovery_digest = ?""",
                (salt, password_hash, _secret_digest(replacement), row[0], digest),
            )
            if updated.rowcount != 1:
                raise AuthenticationError("Invalid credentials")
            db.execute("DELETE FROM identity_sessions WHERE actor_id = ?", (row[0],))
        return replacement

    def set_paid(self, login: str, enabled: bool) -> None:
        """Operator-managed access to metered model turns, independent of admin membership."""
        if type(enabled) is not bool:
            raise ValueError("Expected a paid access flag")
        with self._write() as db:
            row = db.execute("SELECT workspace_id FROM identity_accounts WHERE login=?", (_login_name(login),)).fetchone()
            if row is None:
                raise ValueError("Unknown account")
            if enabled:
                db.execute("INSERT OR IGNORE INTO workspace_paid_model_access(workspace_id) VALUES (?)", row)
            else:
                db.execute("DELETE FROM workspace_paid_model_access WHERE workspace_id=?", row)

    def grant_coins(self, login, amount, key, reason, *, token=None):
        # The local CLI is a privileged server operator. HTTP always supplies a session.
        with self._write() as db:
            issuer = "local-operator"
            if token is not None:
                issuer, _ = _principal(db, token)
                if not db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (issuer,)).fetchone():
                    raise PermissionError("Administrator required")
            row = db.execute("SELECT workspace_id FROM identity_accounts WHERE login=?", (_login_name(login),)).fetchone()
            if row is None:
                raise ValueError("Unknown account")
            coins.grant(db, issuer, key, row[0], amount, reason)

    def wallet(self, token):
        with self._write() as db:
            actor, workspace = _principal(db, token)
            coins.close_orders(db, workspace)
            available, held = coins.balances(db, workspace)
            admin = bool(db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (actor,)).fetchone())
            rows = db.execute("""SELECT u.run_key,u.chat_id,o.spent,o.closed,o.operation_id,o.markup,o.coins_per_usd
                FROM coin_order_totals o JOIN usage_operations u USING(operation_id) WHERE o.workspace_id=?
                ORDER BY o.created DESC,o.operation_id DESC LIMIT 50""", (workspace,))
            charges = []
            for key, chat, cost, closed, operation, markup, conversion in rows:
                entry = {"requestId": key, "chatId": chat, "coins": coins.display(cost), "pending": not closed}
                if admin:
                    attempts = db.execute("""SELECT model,period,usage_json,rate_version FROM coin_attempts
                        WHERE operation_id=? ORDER BY started_ms,attempt_id""", (operation,))
                    entry["meter"] = {"markupPercent": markup, "coinsPerUsd": conversion,
                                      "attempts": [{"model": m, "period": h, "usage": json.loads(u) if u else None,
                                                    "tariff": v} for m,h,u,v in attempts]}
                charges.append(entry)
            return {"available": coins.display(available), "reserved": coins.display(held),
                    "turnLimit": coins.display(coins.policy()[0]), "canGrant": admin, "charges": charges}

    def set_admin(self, login: str, enabled: bool) -> None:
        """Local provisioning command. Ordinary accounts have no admin membership."""
        if type(enabled) is not bool:
            raise ValueError("Invalid admin membership")
        with self._write() as db:
            row = db.execute("SELECT actor_id FROM identity_accounts WHERE login=?", (_login_name(login),)).fetchone()
            if row is None:
                raise ValueError("Unknown account")
            if enabled:
                db.execute("INSERT OR IGNORE INTO identity_admins(actor_id) VALUES (?)", row)
            else:
                db.execute("DELETE FROM identity_admins WHERE actor_id=?", row)

    def can_view_costs(self, token: str, scope: Scope) -> bool:
        """Recheck the live session and its chat before projecting an internal receipt."""
        with self._lock:
            actor, workspace = _principal(self._db, token)
            if (actor, workspace) != (scope.actor_id, scope.workspace_id) or not _owns_chat(self._db, scope):
                raise ChatUnavailable("Chat unavailable")
            return self._db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (actor,)).fetchone() is not None

    def validate_session(self, token: str) -> None:
        with self._lock:
            _principal(self._db, token)

    def create_user_chat(self, token: str) -> Scope:
        with self._write() as db:
            actor, workspace = _principal(db, token)
            scope = Scope(actor, workspace, uuid4().hex)
            _bind_chat(db, scope)
            return scope

    def list_chats(self, token: str) -> list[str]:
        with self._lock:
            _, workspace = _principal(self._db, token)
            return [row[0] for row in self._db.execute(
                "SELECT chat_id FROM chats WHERE workspace_id = ? ORDER BY rowid", (workspace,)
            )]

    def resolve_chat(self, token: str, chat_id: str) -> Scope:
        with self._lock:
            actor, workspace = _principal(self._db, token)
            if not isinstance(chat_id, str) or not chat_id or chat_id.strip() != chat_id:
                raise ChatUnavailable("Chat unavailable")
            scope = Scope(actor, workspace, chat_id)
            if not _owns_chat(self._db, scope):
                raise ChatUnavailable("Chat unavailable")
            return scope
