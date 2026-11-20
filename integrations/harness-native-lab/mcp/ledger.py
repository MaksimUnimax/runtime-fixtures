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
                       "finished REAL, status TEXT NOT NULL, result TEXT, error TEXT, "
                       "attempts INTEGER NOT NULL DEFAULT 0)")
            # Existing lab rows predate physical-attempt accounting. Preserve
            # one reported provider attempt per historical logical request.
            columns = {row[1] for row in db.execute("PRAGMA table_info(requests)")}
            if "attempts" not in columns:
                db.execute("ALTER TABLE requests ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1")
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
                    # A transient per-second provider limit is NOT a cached
                    # analytics result. Cool down before permitting a new try.
                    if provider == "ozon" and saved.get("code") == "UPSTREAM_HTTP_429" and saved.get("provider_reason") == "RATE_LIMIT_PER_SECOND":
                        wait = max(interval, saved.get("retry_after_seconds") or 0)
                        if now - started < wait:
                            raise LabError("LOCAL_RATE_LIMIT", "Ozon ограничил частоту. Новый вызов возможен после паузы.",
                                           retry_after=max(1, int(wait - (now - started) + .999)))
                    else:
                        raise LabError(saved["code"], saved["message"], unknown=saved["outcome_unknown"],
                                       retry_after=saved.get("retry_after_seconds"),
                                       provider_code=saved.get("provider_code"), provider_reason=saved.get("provider_reason"))
            total, first, last = db.execute("SELECT COALESCE(SUM(attempts),0),MIN(started),MAX(started) FROM requests "
                                           "WHERE scope=? AND provider=? AND started>?",
                                           (scope, provider, now - 86400)).fetchone()
            if total >= maximum:
                raise LabError("LAB_DAILY_REQUEST_BUDGET", "Исчерпан настроенный лимит коннектора за скользящие 24 часа.",
                               retry_after=max(1, int(first + 86400 - now) + 1))
            if last is not None and now - last < interval:
                raise LabError("LOCAL_RATE_LIMIT", "Новый запрос пока ограничен частотой провайдера.",
                               retry_after=max(1, int(interval - (now - last)) + 1))
            cursor = db.execute("INSERT INTO requests(scope,provider,fingerprint,started,status,attempts) VALUES(?,?,?,?,?,0)",
                                (scope, provider, fingerprint, now, "started"))
            return int(cursor.lastrowid), None

    def reserve_attempt(self, request_id: int, maximum: int) -> int:
        """Durably count a physical outgoing request before dispatch, including 429 retries."""
        now = self.clock()
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT scope,provider,status,attempts FROM requests WHERE id=?", (request_id,)).fetchone()
            if not row or row[2] != "started":
                raise LabError("REQUEST_NOT_ACTIVE", "Запрос инструмента не активен.")
            scope, provider, _, attempts = row
            total, oldest = db.execute("SELECT COALESCE(SUM(attempts),0),MIN(started) FROM requests "
                                        "WHERE scope=? AND provider=? AND started>?",
                                        (scope, provider, now - 86400)).fetchone()
            if total >= maximum:
                raise LabError("LAB_DAILY_REQUEST_BUDGET", "Исчерпан лимит реальных запросов коннектора за 24 часа.",
                               retry_after=max(1, int(oldest + 86400 - now) + 1))
            db.execute("UPDATE requests SET attempts=attempts+1 WHERE id=?", (request_id,))
            return attempts + 1

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
                "SELECT provider,SUM(attempts) FROM requests WHERE scope=? AND started>? GROUP BY provider",
                (scope, self.clock() - 86400))}
