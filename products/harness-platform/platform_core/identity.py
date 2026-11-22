"""Server-owned accounts and sessions on the existing single-owner workspace store."""

import hashlib
import json
import hmac
import re
import secrets
from pathlib import Path
from decimal import Decimal
from time import time
from uuid import uuid4

from .operation_grants import PAID_ACCESS_SCHEMA, ensure_operation_schema
from . import coins
from .storage import Scope, Store, _bind_chat, _owns_chat


_SESSION_SECONDS = 12 * 60 * 60
_FAILURE_WINDOW = 5 * 60
_MAX_FAILURES = 5
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
_SCHEMA = (
    PAID_ACCESS_SCHEMA,
    coins.PRICING_SCHEMA,
    coins.SIGNUP_SCHEMA,
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
    """CREATE TABLE IF NOT EXISTS identity_presence (
           actor_id TEXT PRIMARY KEY REFERENCES identity_accounts ON DELETE CASCADE,
           seconds INTEGER NOT NULL CHECK(seconds>=0), last_at INTEGER NOT NULL)""",
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
    if not isinstance(password, str) or not 1 <= len(password) <= 256:
        raise ValueError("Use a password of 1 to 256 characters")
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

    @staticmethod
    def _insert_new_account(db, actor, name, workspace, salt, password_hash, recovery_digest):
        db.execute("""INSERT INTO identity_accounts
            (actor_id, login, workspace_id, salt, password_hash, recovery_digest)
            VALUES (?,?,?,?,?,?)""", (actor, name, workspace, salt, password_hash, recovery_digest))
        ensure_operation_schema(db)
        bonus = coins.signup_bonus(db)
        if bonus:
            coins.grant(db, "signup", actor, workspace, coins.display(bonus), "Монеты за регистрацию")

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
            self._insert_new_account(db, actor, name, workspace, salt, password_hash, _secret_digest(recovery))
        return recovery

    def login(self, login: str, password: str) -> str:
        """Trusted in-process provisioning and fixtures. Public entry points use AccountAccess."""
        return self.password_action(login, password, None)

    def password_action(self, login, password, action, *, session=None):
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
        token = self._session_with_password(row, encoded, action=action, session=session)
        if token is None:
            raise AuthenticationError("Invalid credentials")
        return token

    def account_login(self, token: str) -> str:
        with self._lock:
            actor, _ = _principal(self._db, token)
            return self._db.execute("SELECT login FROM identity_accounts WHERE actor_id = ?", (actor,)).fetchone()[0]

    def change_password(self, token: str, current: str, new: str) -> str | None:
        """Verify the current password and renew the browser session in one transaction."""
        encoded, replacement = _password_bytes(current), _password_bytes(new)
        with self._lock:
            actor, _ = _principal(self._db, token)
            row = self._db.execute(
                """SELECT actor_id, salt, password_hash, failures, failure_start
                   FROM identity_accounts WHERE actor_id = ?""",
                (actor,),
            ).fetchone()
        return self._session_with_password(row, encoded, session=token, replacement=replacement)

    def _session_with_password(self, row, encoded, *, session=None, replacement=None, action=None):
        if row and row[3] >= _MAX_FAILURES and row[4] + _FAILURE_WINDOW > time():
            return None
        # Hash outside the SQLite writer lock. Unknown logins do comparable work.
        candidate = _derive(encoded, row[1] if row else bytes(16))
        if row is None:
            return None
        actor, _, previous_hash, _, _ = row
        matched = hmac.compare_digest(previous_hash, candidate)
        if matched and replacement is not None:
            salt = secrets.token_bytes(16)
            password_hash = _derive(replacement, salt)
        with self._write() as db:
            if session is not None:
                if _principal(db, session)[0] != actor:
                    raise AuthenticationError("Invalid session")
            now = int(time())
            current = db.execute(
                "SELECT password_hash, failures, failure_start FROM identity_accounts WHERE actor_id = ?",
                (actor,),
            ).fetchone()
            if current is None or current[0] != previous_hash:
                return None
            _, failures, start = current
            if start + _FAILURE_WINDOW <= now:
                failures, start = 0, now
            if failures >= _MAX_FAILURES:
                return None
            if not matched:
                db.execute(
                    "UPDATE identity_accounts SET failures = ?, failure_start = ? WHERE actor_id = ?",
                    (failures + 1, start, actor),
                )
                return None
            expires = now + _SESSION_SECONDS
            if replacement is not None:
                old_expiry = db.execute("SELECT expires_at FROM identity_sessions WHERE digest=?",
                                        (_secret_digest(session),)).fetchone()[0]
                expires = min(expires, old_expiry)
                db.execute("UPDATE identity_accounts SET salt = ?, password_hash = ? WHERE actor_id = ?",
                           (salt, password_hash, actor))
                db.execute("DELETE FROM identity_sessions WHERE actor_id = ?", (actor,))
            token = secrets.token_urlsafe(32)
            db.execute("UPDATE identity_accounts SET failures = 0, failure_start = 0 WHERE actor_id = ?", (actor,))
            if action is not None:
                return action(db, actor, now)
            db.execute("DELETE FROM identity_sessions WHERE expires_at <= ?", (now,))
            db.execute(
                "INSERT INTO identity_sessions (digest, actor_id, expires_at) VALUES (?, ?, ?)",
                (_secret_digest(token), actor, expires),
            )
            return token

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
            ensure_operation_schema(db)
            coins.grant(db, issuer, key, row[0], amount, reason)

    def public_signup_coins(self):
        with self._lock:
            return coins.display(coins.signup_bonus(self._db))

    def public_coin_price(self):
        with self._lock:
            return coins.sale_pricing(self._db)["rubPerCoin"]

    def wallet(self, token, *, account_login=None, balance_only=False):
        with self._write() as db:
            actor, workspace = _principal(db, token)
            admin = bool(db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (actor,)).fetchone())
            if account_login is not None:
                if not admin:
                    raise PermissionError("Administrator required")
                row = db.execute("SELECT workspace_id FROM identity_accounts WHERE login=?",
                                 (_login_name(account_login),)).fetchone()
                if row is None:
                    raise LookupError("Unknown account")
                workspace = row[0]
            ensure_operation_schema(db)
            coins.close_orders(db, workspace)
            available, held = coins.balances(db, workspace)
            if balance_only:
                return {"available": coins.display(available)}
            rows = db.execute("""SELECT u.run_key,u.chat_id,o.spent,o.closed,o.operation_id,o.markup,o.coins_per_usd,r.fx_e4
                FROM coin_order_totals o JOIN usage_operations u USING(operation_id) LEFT JOIN coin_ruble_orders r USING(operation_id) WHERE o.workspace_id=?
                ORDER BY o.created DESC,o.operation_id DESC LIMIT 50""", (workspace,))
            charges = []
            for key, chat, cost, closed, operation, markup, conversion, fx in rows:
                entry = {"coins": coins.display(cost), "pending": not closed}
                if account_login is None:
                    entry.update(requestId=key, chatId=chat)
                else:
                    entry["operationId"] = operation
                if admin:
                    attempts = []
                    provider_total = Decimal(0)
                    cost_complete = True
                    for model, period, usage, tariff, evidence, bound, charge in db.execute("""
                        SELECT model,period,usage_json,rate_version,evidence,bound,charge FROM coin_attempts
                        WHERE operation_id=? ORDER BY started_ms,attempt_id""", (operation,)):
                        provider_cost = coins.provider_receipt(evidence) if tariff == "openrouter-v1" else None
                        needs_review = (evidence or "").startswith("openrouter-review-usd:") or (
                            bound == 0 and bool(provider_cost) and (evidence or "").startswith("openrouter-usd:"))
                        if provider_cost is not None:
                            provider_total += provider_cost
                        elif charge is not None:
                            usd_units = charge * 10000 // fx if fx else charge * 100 // (conversion * (100 + markup))
                            provider_total += Decimal(usd_units) / coins.UNIT
                        else:
                            cost_complete = False
                        attempts.append({"model":model,"period":period,"tariff":tariff,
                                         "usage":json.loads(usage) if usage else None,
                                         "providerUsd":format(provider_cost,"f") if provider_cost is not None else None,
                                         "needsReview":needs_review})
                    entry["meter"] = {"markupPercent":markup,"rubPerUsd":fx / 10000 if fx else None,
                                      "coinsPerUsd":fx / 10000 if fx else conversion,
                                      "providerUsd":format(provider_total,"f") if cost_complete and closed else None,
                                      "attempts":attempts}
                charges.append(entry)
            meters = {}
            if admin:
                meters = {"providerMeters": coins.provider_meters(db, workspace)}
            return {**meters,"available": coins.display(available), "reserved": coins.display(held),
                    "salePrice": coins.sale_pricing(db), "canGrant": admin, "charges": charges}

    def pricing(self, token, percent=None, *, update=False):
        with self._write() as db:
            actor, _ = _principal(db, token)
            if not db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (actor,)).fetchone():
                raise PermissionError("Administrator required")
            ensure_operation_schema(db)
            return coins.set_sale_pricing(db, percent) if update else coins.sale_pricing(db)

    def set_admin(self, login: str, enabled: bool) -> None:
        """Local provisioning command. Ordinary accounts have no admin membership."""
        if type(enabled) is not bool:
            raise ValueError("Invalid admin membership")
        with self._write() as db:
            row = db.execute("SELECT actor_id FROM identity_accounts WHERE login=?", (_login_name(login),)).fetchone()
            if row is None:
                raise ValueError("Unknown account")
            if enabled:
                changed = db.execute("INSERT OR IGNORE INTO identity_admins(actor_id) VALUES (?)", row)
            else:
                changed = db.execute("DELETE FROM identity_admins WHERE actor_id=?", row)
            if changed.rowcount:
                db.execute("DELETE FROM identity_sessions WHERE actor_id=?", row)
                if db.execute("SELECT 1 FROM sqlite_master WHERE name='access_pending'").fetchone():
                    db.execute("DELETE FROM access_pending WHERE actor=?", row)

    def unattached_illustrations(self, scope):
        with self._lock:
            if not self._db.execute("SELECT 1 FROM sqlite_master WHERE name='openrouter_stopped_outputs'").fetchone():
                return []
            rows=self._db.execute("""SELECT i.id FROM openrouter_stopped_outputs s
                JOIN plugin_illustrations i ON i.id=s.illustration JOIN usage_operations o USING(operation_id)
                WHERE i.chat=? AND o.actor_id=? AND o.workspace_id=? ORDER BY i.rowid""",
                (scope.chat_id,scope.actor_id,scope.workspace_id)).fetchall()
            return [f"/api/chats/{scope.chat_id}/illustrations/{row[0]}" for row in rows]

    def chat_receipts(self, scope, ids):
        if not ids:
            return {}
        params = ",".join("?" for _ in ids)
        with self._lock:
            if not self._db.execute("SELECT 1 FROM sqlite_master WHERE name='coin_attempts'").fetchone():
                return {}
            rows = self._db.execute(f"""SELECT u.operation_id, o.spent, a.charge, r.fx_e4, a.usage_json, a.rate_version, a.evidence
                FROM usage_operations u JOIN coin_order_totals o USING(operation_id)
                JOIN coin_attempts a USING(operation_id) LEFT JOIN coin_ruble_orders r USING(operation_id)
                WHERE u.workspace_id=? AND u.actor_id=? AND u.chat_id=? AND u.operation_id IN ({params})""",
                (scope.workspace_id, scope.actor_id, scope.chat_id, *ids)).fetchall()
        result = {}
        provider_totals = {}
        for operation, spent, charge, fx, raw, tariff, evidence in rows:
            receipt = result.setdefault(operation, {"coins": coins.display(spent),
                "rub": coins.display(spent) if fx else None, "pending": False, "tokens": None, "providers": {}})
            receipt["pending"] |= charge is None
            if fx:
                usd = coins.provider_receipt(evidence) if tariff == "openrouter-v1" else None
                if usd is None and charge is not None:
                    usd = Decimal(charge * 10000 // fx) / coins.UNIT
                if usd is not None:
                    provider_totals[operation] = provider_totals.get(operation,Decimal(0)) + usd
            provider = "OpenRouter" if tariff == "openrouter-v1" else "DeepSeek"
            per = receipt["providers"].setdefault(provider, {"input":0,"cache":0,"output":0})
            if raw and (usage := json.loads(raw)):
                per["input"] += usage.get("input_tokens",0) + usage.get("cache_creation_input_tokens",0)
                per["cache"] += usage.get("cache_read_input_tokens",0)
                per["output"] += usage.get("output_tokens",0)
                counts = receipt["tokens"] or {"input": 0, "cache": 0, "output": 0}
                counts["input"] += usage.get("input_tokens", 0) + usage.get("cache_creation_input_tokens", 0)
                counts["cache"] += usage.get("cache_read_input_tokens", 0)
                counts["output"] += usage.get("output_tokens", 0)
                receipt["tokens"] = counts
        for op, value in provider_totals.items():
            if not result[op]["pending"]:
                result[op]["providerUsd"] = format(value,"f")
        return result

    def can_view_costs(self, token: str, scope: Scope) -> bool:
        """Recheck the live session and its chat before projecting an internal receipt."""
        with self._lock:
            actor, workspace = _principal(self._db, token)
            if (actor, workspace) != (scope.actor_id, scope.workspace_id) or not _owns_chat(self._db, scope):
                raise ChatUnavailable("Chat unavailable")
            return self._db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", (actor,)).fetchone() is not None

    def is_admin(self, token: str) -> bool:
        with self._lock:
            actor, _ = _principal(self._db, token)
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
