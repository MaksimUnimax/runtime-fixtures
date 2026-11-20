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


class PaidAccessRequired(coins.InsufficientCoins):
    """The owner can still read history and replay completed requests."""


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


def issue_grant(database_path, scope, *, source, run_key, ttl_seconds=900, coin_limit=None, bind_model=None):
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
        token = secrets.token_urlsafe(32)
        db.execute("INSERT INTO usage_grants(token_hash, operation_id, expires_at) VALUES (?, ?, ?)",
                   (_digest(token), operation_id, expires))
    return OperationGrant(operation_id, workspace, source, token, model)


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
