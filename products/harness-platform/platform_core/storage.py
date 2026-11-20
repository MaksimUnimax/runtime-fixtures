"""Local reference store for trusted account provisioning and scoped plugin access.

The pilot supports one owner per workspace. Scope values are supplied by a
trusted caller after authenticating the actor, never by plugin arguments.
"""

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from threading import Lock


_APPLICATION_ID = 0x48504C54  # HPLT, distinguishes our file from other SQLite databases.
_SCHEMA_VERSION = 1
_INITIAL_SCHEMA = (
    """CREATE TABLE workspaces (
           workspace_id TEXT PRIMARY KEY NOT NULL,
           owner_id TEXT NOT NULL
       )""",
    """CREATE TABLE chats (
           chat_id TEXT PRIMARY KEY NOT NULL,
           workspace_id TEXT NOT NULL REFERENCES workspaces ON DELETE CASCADE,
           UNIQUE (workspace_id, chat_id)
       )""",
    """CREATE TABLE entitlements (
           workspace_id TEXT NOT NULL REFERENCES workspaces ON DELETE CASCADE,
           plugin_id TEXT NOT NULL,
           PRIMARY KEY (workspace_id, plugin_id)
       )""",
    """CREATE TABLE chat_plugins (
           workspace_id TEXT NOT NULL,
           chat_id TEXT NOT NULL,
           plugin_id TEXT NOT NULL,
           PRIMARY KEY (workspace_id, chat_id, plugin_id),
           FOREIGN KEY (workspace_id, chat_id)
               REFERENCES chats (workspace_id, chat_id) ON DELETE CASCADE,
           FOREIGN KEY (workspace_id, plugin_id)
               REFERENCES entitlements (workspace_id, plugin_id) ON DELETE CASCADE
       )""",
    "CREATE INDEX chat_plugins_by_entitlement ON chat_plugins (workspace_id, plugin_id)",
)


def _check_id(value: str) -> None:
    if not isinstance(value, str) or not value or value.strip() != value:
        raise ValueError("An identifier must be a nonempty string without surrounding whitespace")


def _require_owner(db: sqlite3.Connection, actor_id: str, workspace_id: str) -> None:
    if not db.execute(
        "SELECT 1 FROM workspaces WHERE workspace_id = ? AND owner_id = ?",
        (workspace_id, actor_id),
    ).fetchone():
        raise PermissionError("Workspace unavailable")


def _ensure_workspace(db: sqlite3.Connection, actor_id: str, workspace_id: str) -> None:
    db.execute(
        "INSERT INTO workspaces (workspace_id, owner_id) VALUES (?, ?) "
        "ON CONFLICT (workspace_id) DO NOTHING",
        (workspace_id, actor_id),
    )
    _require_owner(db, actor_id, workspace_id)


@dataclass(frozen=True)
class Scope:
    actor_id: str
    workspace_id: str
    chat_id: str

    def __post_init__(self) -> None:
        for value in (self.actor_id, self.workspace_id, self.chat_id):
            _check_id(value)


def _owns_chat(db: sqlite3.Connection, scope: Scope) -> bool:
    return db.execute(
        """SELECT 1 FROM chats JOIN workspaces USING (workspace_id)
           WHERE workspace_id = ? AND chat_id = ? AND owner_id = ?""",
        (scope.workspace_id, scope.chat_id, scope.actor_id),
    ).fetchone() is not None


def _bind_chat(db: sqlite3.Connection, scope: Scope) -> None:
    """Caller has checked ownership in the same transaction."""
    db.execute(
        "INSERT INTO chats (chat_id, workspace_id) VALUES (?, ?) "
        "ON CONFLICT (chat_id) DO NOTHING",
        (scope.chat_id, scope.workspace_id),
    )
    if not db.execute(
        "SELECT 1 FROM chats WHERE workspace_id = ? AND chat_id = ?",
        (scope.workspace_id, scope.chat_id),
    ).fetchone():
        raise PermissionError("Chat unavailable")


class Store:
    def __init__(self, path: str | Path, *, create: bool = True):
        self._lock = Lock()
        if not isinstance(create, bool):
            raise ValueError("create must be a boolean")
        if str(path) == ":memory:":
            if not create:
                raise ValueError("An in-memory database cannot be reopened")
            target = ":memory:"
        else:
            db_path = Path(path).absolute()
            if create:
                # sqlite3.connect() otherwise creates a database with the ambient umask.
                try:
                    fd = os.open(db_path, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
                except FileExistsError:
                    pass
                else:
                    os.close(fd)
            target = db_path.as_uri() + "?mode=rw"
        self._db = sqlite3.connect(
            target, uri=True, isolation_level=None, check_same_thread=False, timeout=5
        )
        try:
            self._db.execute("PRAGMA foreign_keys = ON")
            with self._write() as db:
                version = db.execute("PRAGMA user_version").fetchone()[0]
                application = db.execute("PRAGMA application_id").fetchone()[0]
                if (application, version) == (0, 0):
                    if not create:
                        raise ValueError("The platform database has not been initialized")
                    existing = db.execute(
                        "SELECT 1 FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' LIMIT 1"
                    ).fetchone()
                    if existing:
                        raise ValueError("The SQLite file already contains an unrecognized schema")
                    for statement in _INITIAL_SCHEMA:
                        db.execute(statement)
                    db.execute(f"PRAGMA application_id = {_APPLICATION_ID}")
                    db.execute(f"PRAGMA user_version = {_SCHEMA_VERSION}")
                elif (application, version) != (_APPLICATION_ID, _SCHEMA_VERSION):
                    raise ValueError("Unsupported platform database or schema version")
        except BaseException:
            self._db.close()
            raise

    @contextmanager
    def _write(self) -> Iterator[sqlite3.Connection]:
        with self._lock:
            self._db.execute("BEGIN IMMEDIATE")
            try:
                yield self._db
                self._db.commit()
            except BaseException:
                self._db.rollback()
                raise

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def __enter__(self):
        return self

    def __exit__(self, *_exc) -> None:
        self.close()

    def create_workspace(self, actor_id: str, workspace_id: str) -> None:
        """Trusted provisioning. Retrying cannot transfer an existing workspace."""
        _check_id(actor_id)
        _check_id(workspace_id)
        with self._write() as db:
            _ensure_workspace(db, actor_id, workspace_id)

    def create_chat(self, scope: Scope) -> None:
        """Bind a chat once. A resumed native session keeps its original owner."""
        with self._write() as db:
            _require_owner(db, scope.actor_id, scope.workspace_id)
            _bind_chat(db, scope)

    def provision(self, scope: Scope) -> None:
        """Trusted operation: initialize the owner, workspace and chat binding atomically."""
        with self._write() as db:
            _ensure_workspace(db, scope.actor_id, scope.workspace_id)
            _bind_chat(db, scope)

    def owns_chat(self, scope: Scope) -> bool:
        with self._lock:
            return _owns_chat(self._db, scope)

    def set_entitlement(self, workspace_id: str, plugin_id: str, granted: bool) -> None:
        """Trusted provisioning. Revocation atomically clears all chat opt-ins."""
        _check_id(workspace_id)
        _check_id(plugin_id)
        if not isinstance(granted, bool):
            raise ValueError("granted must be a boolean")
        with self._write() as db:
            if not db.execute(
                "SELECT 1 FROM workspaces WHERE workspace_id = ?", (workspace_id,)
            ).fetchone():
                raise LookupError("Workspace unavailable")
            if granted:
                db.execute(
                    "INSERT INTO entitlements (workspace_id, plugin_id) VALUES (?, ?) "
                    "ON CONFLICT (workspace_id, plugin_id) DO NOTHING",
                    (workspace_id, plugin_id),
                )
            else:
                db.execute(
                    "DELETE FROM entitlements WHERE workspace_id = ? AND plugin_id = ?",
                    (workspace_id, plugin_id),
                )

    def set_enabled(self, scope: Scope, plugin_id: str, enabled: bool) -> None:
        _check_id(plugin_id)
        if not isinstance(enabled, bool):
            raise ValueError("enabled must be a boolean")
        with self._write() as db:
            if not _owns_chat(db, scope):
                raise PermissionError("Chat unavailable")
            if enabled:
                if not db.execute(
                    "SELECT 1 FROM entitlements WHERE workspace_id = ? AND plugin_id = ?",
                    (scope.workspace_id, plugin_id),
                ).fetchone():
                    raise PermissionError("Plugin unavailable")
                db.execute(
                    "INSERT INTO chat_plugins (workspace_id, chat_id, plugin_id) VALUES (?, ?, ?) "
                    "ON CONFLICT (workspace_id, chat_id, plugin_id) DO NOTHING",
                    (scope.workspace_id, scope.chat_id, plugin_id),
                )
            else:
                db.execute(
                    "DELETE FROM chat_plugins WHERE workspace_id = ? AND chat_id = ? AND plugin_id = ?",
                    (scope.workspace_id, scope.chat_id, plugin_id),
                )

    def enabled_plugins(self, scope: Scope) -> tuple[str, ...]:
        with self._lock:
            rows = self._db.execute(
                """SELECT p.plugin_id FROM chat_plugins p
                   JOIN workspaces w USING (workspace_id)
                   WHERE p.workspace_id = ? AND p.chat_id = ? AND w.owner_id = ?
                   ORDER BY p.plugin_id""",
                (scope.workspace_id, scope.chat_id, scope.actor_id),
            ).fetchall()
            return tuple(row[0] for row in rows)

    def permits(self, scope: Scope, plugin_id: str) -> bool:
        _check_id(plugin_id)
        with self._lock:
            return self._db.execute(
                """SELECT 1 FROM chat_plugins p JOIN workspaces w USING (workspace_id)
                   WHERE p.workspace_id = ? AND p.chat_id = ? AND w.owner_id = ?
                   AND p.plugin_id = ?""",
                (scope.workspace_id, scope.chat_id, scope.actor_id, plugin_id),
            ).fetchone() is not None
