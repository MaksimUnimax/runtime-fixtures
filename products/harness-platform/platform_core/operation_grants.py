"""Issue opaque model-operation grants from an authenticated platform scope.

The calling server chooses the operation source and stable idempotency key.
Only the token travels to the trusted model transport. Its digest stays in the
existing platform database. A fresh token can be issued for a retry.
"""

from contextlib import closing, contextmanager
from dataclasses import dataclass, field
import hashlib
from pathlib import Path
import re
import secrets
import sqlite3
import time
from uuid import uuid4


from . import coins


# Shared by account provisioning and operation grant migration.
PAID_ACCESS_SCHEMA = """CREATE TABLE IF NOT EXISTS workspace_paid_model_access (
    workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces ON DELETE CASCADE
)"""


DIRECT_DEFAULT_SCHEMA = """CREATE TABLE IF NOT EXISTS direct_chat_default (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1), model TEXT NOT NULL, effort TEXT NOT NULL)"""


class PaidAccessRequired(coins.InsufficientCoins):
    """The owner can still read history and replay completed requests."""


CHAT_GRANT_TTL_SECONDS = 150
_PLATFORM_APPLICATION = 0x48504C54
_SOURCE = re.compile(r"[a-z][a-z0-9_.-]{0,63}")
_RUN_KEY = re.compile(r"[A-Za-z0-9_.:-]{1,128}")
_TOKEN = re.compile(r"[A-Za-z0-9_-]{43}")
OPERATION_SCHEMA = (
    PAID_ACCESS_SCHEMA,
    """CREATE TABLE IF NOT EXISTS usage_operations (
           operation_id TEXT PRIMARY KEY NOT NULL,
           actor_id TEXT NOT NULL,
           workspace_id TEXT NOT NULL REFERENCES workspaces ON DELETE CASCADE,
           chat_id TEXT NOT NULL,
           source TEXT NOT NULL,
           run_key TEXT NOT NULL,
           UNIQUE(actor_id, workspace_id, chat_id, source, run_key)
       )""",
    """CREATE TABLE IF NOT EXISTS usage_grants (
           token_hash TEXT PRIMARY KEY NOT NULL,
           operation_id TEXT NOT NULL REFERENCES usage_operations ON DELETE CASCADE,
           expires_at INTEGER NOT NULL
       )""",
    "CREATE INDEX IF NOT EXISTS usage_grants_expiry ON usage_grants(expires_at)",
    """CREATE TABLE IF NOT EXISTS marketplace_retry_windows (
        token_hash TEXT PRIMARY KEY REFERENCES usage_grants ON DELETE CASCADE,
        deadline_ms INTEGER, retry_at_ms INTEGER, session_digest BLOB
    )""",
    DIRECT_DEFAULT_SCHEMA,
    """CREATE TABLE IF NOT EXISTS direct_operation_models (
        operation_id TEXT PRIMARY KEY REFERENCES usage_operations ON DELETE CASCADE,
        model TEXT NOT NULL, effort TEXT NOT NULL)""",
    *coins.SCHEMA,
)


@dataclass(frozen=True)
class OperationScope:
    """Shape accepted by issue_grant; platform_core.storage.Scope also conforms."""

    actor_id: str
    workspace_id: str
    chat_id: str | None = None


@dataclass(frozen=True)
class OperationGrant:
    operation_id: str
    workspace_id: str
    source: str
    token: str = field(repr=False)
    model: str | None = None
    direct_model: str | None = None
    effort: str | None = None


def direct_default(db, fallback):
    row = db.execute("SELECT model,effort FROM direct_chat_default WHERE singleton=1").fetchone()
    return tuple(row) if row else (fallback, "high")


def ensure_operation_schema(db):
    for statement in OPERATION_SCHEMA:
        db.execute(statement)


@contextmanager
def _transaction(database_path):
    # mode=rw forbids silent creation of an unrelated, empty SQLite file.
    url = Path(database_path).absolute().as_uri() + "?mode=rw"
    with closing(sqlite3.connect(url, uri=True, timeout=5)) as db, db:
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("BEGIN IMMEDIATE")
        application = db.execute("PRAGMA application_id").fetchone()[0]
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if (application, version) != (_PLATFORM_APPLICATION, 1):
            raise ValueError("Unsupported platform database")
        ensure_operation_schema(db)
        yield db


def _digest(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def initialize_grants(database_path):
    """Install the grant registry before starting a read-only gateway."""
    with _transaction(database_path) as db:
        # Also check the authoritative table names and columns on initialization.
        db.execute("""SELECT w.owner_id, c.chat_id FROM workspaces AS w
                      LEFT JOIN chats AS c ON c.workspace_id=w.workspace_id LIMIT 0""")


def issue_grant(database_path, scope, *, source, run_key, ttl_seconds=900, coin_limit=None,
                bind_model=None, direct_fallback=None, session_digest=None, direct_override=None):
    """Bind one short-lived credential to a stable, server-authorized operation.

    run_key is an opaque identifier (e.g. the HTTP idempotency key or scheduled
    occurrence ID). The caller owns request-content replay checks.
    """
    actor, workspace, chat = scope.actor_id, scope.workspace_id, scope.chat_id
    identifiers = (actor, workspace) if chat is None else (actor, workspace, chat)
    if any(not isinstance(v, str) or not 0 < len(v) <= 256
           or v.strip() != v or "\0" in v for v in identifiers):
        raise ValueError("Invalid operation scope")
    if not isinstance(source, str) or not _SOURCE.fullmatch(source):
        raise ValueError("Invalid operation source")
    if not isinstance(run_key, str) or not _RUN_KEY.fullmatch(run_key):
        raise ValueError("Invalid operation key")
    if type(ttl_seconds) is not int or ttl_seconds <= 0:
        raise ValueError("Invalid grant lifetime")
    with _transaction(database_path) as db:
        chat_key = "" if chat is None else chat
        owner = db.execute(
            """SELECT 1 FROM workspaces AS w
               WHERE w.workspace_id=? AND w.owner_id=?
               AND (?='' OR EXISTS (
                   SELECT 1 FROM chats AS c WHERE c.workspace_id=w.workspace_id AND c.chat_id=?
               ))""",
            (workspace, actor, chat_key, chat_key),
        ).fetchone()
        if owner is None:
            raise PermissionError("Operation scope unavailable")
        if source == "chat.turn" and not db.execute(
            "SELECT 1 FROM workspace_paid_model_access WHERE workspace_id=?", (workspace,)
        ).fetchone():
            raise PaidAccessRequired("Paid model access required")
        now = int(time.time())
        expires = now + ttl_seconds
        if expires >= 2**63:
            raise ValueError("Invalid grant lifetime")
        db.execute("DELETE FROM usage_grants WHERE expires_at <= ?", (now,))
        binding = (actor, workspace, chat_key, source, run_key)
        row = db.execute(
            """SELECT operation_id FROM usage_operations
               WHERE actor_id=? AND workspace_id=? AND chat_id=? AND source=? AND run_key=?""",
            binding,
        ).fetchone()
        if row:
            operation_id = row[0]
        else:
            operation_id = uuid4().hex
            db.execute(
                """INSERT INTO usage_operations
                   (operation_id, actor_id, workspace_id, chat_id, source, run_key)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (operation_id, *binding),
            )
        try:
            coins.reserve_order(db, workspace, operation_id, coin_limit)
        except coins.InsufficientCoins as exc:
            raise PaidAccessRequired("Insufficient coins") from exc
        model = bind_model(db,scope,operation_id) if bind_model else None
        direct_model = effort = None
        if model is None and direct_fallback:
            saved = db.execute("SELECT model,effort FROM direct_operation_models WHERE operation_id=?",
                               (operation_id,)).fetchone()
            if saved:
                direct_model, effort = saved
            else:
                direct_model, effort = direct_override or direct_default(db, direct_fallback)
                db.execute("INSERT INTO direct_operation_models VALUES(?,?,?)", (operation_id, direct_model, effort))
        token = secrets.token_urlsafe(32)
        token_hash = _digest(token)
        db.execute("INSERT INTO usage_grants(token_hash, operation_id, expires_at) VALUES (?, ?, ?)",
                   (token_hash, operation_id, expires))
        if session_digest is not None:
            if source != "chat.turn" or not db.execute("""
                SELECT 1 FROM identity_sessions WHERE digest=? AND actor_id=? AND expires_at>?
            """, (session_digest, actor, now)).fetchone():
                raise PermissionError("Chat session unavailable")
            db.execute("INSERT INTO marketplace_retry_windows(token_hash, session_digest) VALUES (?,?)",
                       (token_hash, session_digest))
    return OperationGrant(operation_id, workspace, source, token, model, direct_model, effort)


def _renew_marketplace_grant(db, token_hash, now):
    return bool(db.execute("""
        UPDATE usage_grants AS g SET expires_at=MAX(expires_at,?)
        WHERE token_hash=? AND expires_at>? AND EXISTS (
            SELECT 1 FROM usage_operations o
            JOIN workspaces w ON w.workspace_id=o.workspace_id AND w.owner_id=o.actor_id
            JOIN chats c ON c.chat_id=o.chat_id AND c.workspace_id=w.workspace_id
            LEFT JOIN marketplace_retry_windows r ON r.token_hash=g.token_hash
            LEFT JOIN identity_sessions s ON s.digest=r.session_digest AND s.actor_id=o.actor_id
            WHERE o.operation_id=g.operation_id AND o.source='chat.turn'
              AND (r.session_digest IS NULL OR s.expires_at>?)
        )
    """, (now + CHAT_GRANT_TTL_SECONDS, token_hash, now, now)).rowcount)


def renew_marketplace_grant(database_path, token_hash, now):
    with _transaction(database_path) as db:
        return _renew_marketplace_grant(db, token_hash, now)


def extend_marketplace_wait(database_path, token_hash, deadline_ms, retry_at_ms, now_ms):
    """Pause the working budget and renew only the short authorization lease."""
    if not (now_ms < deadline_ms and now_ms < retry_at_ms < 8_000_000_000_000_000):
        return None
    return set_marketplace_window(database_path, token_hash, deadline_ms,
                                  deadline_ms + retry_at_ms - now_ms, retry_at_ms, now_ms)


def set_marketplace_window(database_path, token_hash, previous_ms, deadline_ms, retry_at_ms, now_ms):
    """Record safe current progress while retaining the short authorization lease."""
    if not now_ms < previous_ms < deadline_ms < 8_000_000_000_000_000:
        return None
    with _transaction(database_path) as db:
        prior = db.execute("SELECT deadline_ms FROM marketplace_retry_windows WHERE token_hash=?",
                           (token_hash,)).fetchone()
        if prior and prior[0] not in (None, previous_ms):
            return None
        if not _renew_marketplace_grant(db, token_hash, now_ms // 1000):
            return None
        db.execute("""
            INSERT INTO marketplace_retry_windows(token_hash,deadline_ms,retry_at_ms) VALUES (?,?,?)
            ON CONFLICT(token_hash) DO UPDATE SET deadline_ms=excluded.deadline_ms,
                                                retry_at_ms=excluded.retry_at_ms
        """, (token_hash, deadline_ms, retry_at_ms))
        return deadline_ms


def marketplace_deadline(database, token_hash, initial_ms):
    with closing(sqlite3.connect(database, uri=True)) as db:
        row = db.execute("SELECT deadline_ms FROM marketplace_retry_windows WHERE token_hash=?",
                         (token_hash,)).fetchone()
    return row[0] if row and row[0] is not None else initial_ms


def revoke_grant(database_path, token):
    """Idempotently revoke this credential; sibling grants remain independent."""
    if not isinstance(token, str) or not _TOKEN.fullmatch(token):
        raise ValueError("Invalid grant token")
    with _transaction(database_path) as db:
        row = db.execute("SELECT workspace_id FROM usage_grants JOIN usage_operations USING(operation_id) WHERE token_hash=?", (_digest(token),)).fetchone()
        db.execute("DELETE FROM usage_grants WHERE token_hash=?", (_digest(token),))
        if row:
            coins.close_orders(db, row[0])


@contextmanager
def model_operation(database_path, scope, *, source, run_key, ttl_seconds=900):
    """Supply the per-operation credential while the private model adapter runs."""
    grant = issue_grant(database_path, scope, source=source, run_key=run_key, ttl_seconds=ttl_seconds)
    try:
        yield grant
    finally:
        revoke_grant(database_path, grant.token)
