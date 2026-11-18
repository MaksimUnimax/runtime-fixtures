"""Private durable dispatch ledger: reserve before HTTP, never replay uncertainty."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sqlite3
import time

from errors import LabError


class Ledger:
    def __init__(self, directory: str | Path, clock=time.time):
        root = Path(directory)
        if not root.is_absolute() or root.is_symlink():
            raise LabError("STATE_DIRECTORY")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        if root.stat().st_mode & 0o077:
            raise LabError("STATE_PERMISSIONS")
        self.path = root / "requests.sqlite3"
        if self.path.is_symlink():
            raise LabError("STATE_PERMISSIONS")
        self.clock = clock
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS requests (id INTEGER PRIMARY KEY, scope TEXT NOT NULL, "
                       "provider TEXT NOT NULL, fingerprint TEXT NOT NULL, started REAL NOT NULL, "
                       "finished REAL, status TEXT NOT NULL, result TEXT, error TEXT)")
            db.execute("CREATE INDEX IF NOT EXISTS requests_fingerprint ON requests(scope,provider,fingerprint,id)")
        os.chmod(self.path, 0o600)

    def connect(self):
        return sqlite3.connect(self.path, timeout=5, isolation_level="IMMEDIATE")

    def admit(self, scope: str, provider: str, fingerprint: str, *, ttl: int,
              interval: int, maximum: int) -> tuple[int | None, dict | None]:
        now = self.clock()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT id,started,status,result,error FROM requests "
                             "WHERE scope=? AND provider=? AND fingerprint=? ORDER BY id DESC LIMIT 1",
                             (scope, provider, fingerprint)).fetchone()
            if row:
                rid, started, status, result, error = row
                if status == "completed" and now - started < ttl:
                    return None, json.loads(result)
                if status in {"started", "unknown"}:
                    raise LabError("OUTCOME_UNKNOWN_NO_REPLAY", "Предыдущий вызов начат; его результат не подтверждён. Автоматического повтора нет.", unknown=True)
                if status == "failed" and now - started < ttl:
                    saved = json.loads(error)
                    raise LabError(saved["code"], saved["message"], unknown=saved["outcome_unknown"],
                                   retry_after=saved.get("retry_after_seconds"),
                                   provider_code=saved.get("provider_code"), provider_reason=saved.get("provider_reason"))
            total, first, last = db.execute("SELECT COUNT(*),MIN(started),MAX(started) FROM requests "
                                           "WHERE scope=? AND provider=? AND started>?",
                                           (scope, provider, now - 86400)).fetchone()
            if total >= maximum:
                raise LabError("LAB_DAILY_REQUEST_BUDGET", "Исчерпан настроенный лимит коннектора за скользящие 24 часа.",
                               retry_after=max(1, int(first + 86400 - now) + 1))
            if last is not None and now - last < interval:
                raise LabError("LOCAL_RATE_LIMIT", "Новый запрос пока ограничен частотой провайдера.",
                               retry_after=max(1, int(interval - (now - last)) + 1))
            cursor = db.execute("INSERT INTO requests(scope,provider,fingerprint,started,status) VALUES(?,?,?,?,?)",
                                (scope, provider, fingerprint, now, "started"))
            return int(cursor.lastrowid), None

    def complete(self, request_id: int, result: dict):
        with self.connect() as db:
            db.execute("UPDATE requests SET finished=?,status='completed',result=? WHERE id=? AND status='started'",
                       (self.clock(), json.dumps(result, ensure_ascii=False, allow_nan=False), request_id))

    def fail(self, request_id: int, error: LabError):
        with self.connect() as db:
            db.execute("UPDATE requests SET finished=?,status=?,error=? WHERE id=? AND status='started'",
                       (self.clock(), "unknown" if error.unknown else "failed",
                        json.dumps(error.public(), ensure_ascii=False), request_id))

    def counts(self, scope: str) -> dict:
        with self.connect() as db:
            return {provider: count for provider, count in db.execute(
                "SELECT provider,COUNT(*) FROM requests WHERE scope=? AND started>? GROUP BY provider",
                (scope, self.clock() - 86400))}
