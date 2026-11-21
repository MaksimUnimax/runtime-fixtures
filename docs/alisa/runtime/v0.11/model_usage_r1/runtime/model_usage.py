"""Seven-day model dispatch accounting; no prompts, answers, credentials or quotas.

The queue's existing call ledger is the sole attempt journal. A reservation is
counted only when the production transport reaches the network dispatch boundary.
"""
from __future__ import annotations
import hashlib
import json

WINDOW_SECONDS = 7 * 86400
SCHEMA = 'alisa-model-usage/v1'


def install(repo):
    with repo.connection(True) as c:
        columns = {r[1] for r in c.execute('PRAGMA table_info(calls)')}
        if 'dispatched' not in columns:
            c.execute('ALTER TABLE calls ADD COLUMN dispatched REAL')
        if 'error_code' not in columns:
            c.execute('ALTER TABLE calls ADD COLUMN error_code TEXT')
        c.execute('CREATE INDEX IF NOT EXISTS model_dispatch_time ON calls(dispatched)')
        c.execute('CREATE INDEX IF NOT EXISTS model_ledger_expiry ON calls(COALESCE(dispatched,at))')
        c.execute('CREATE TABLE IF NOT EXISTS model_usage_requests(request_key TEXT PRIMARY KEY, at REAL NOT NULL)')
        c.execute('CREATE INDEX IF NOT EXISTS model_request_time ON model_usage_requests(at)')
        c.execute('CREATE TABLE IF NOT EXISTS model_usage_meta(name TEXT PRIMARY KEY, value REAL NOT NULL)')
        c.execute("INSERT OR IGNORE INTO model_usage_meta VALUES('started_at',?)", (repo.clock(),))


def begin_run(repo):
    with repo.connection(True) as c:
        c.execute("INSERT OR REPLACE INTO model_usage_meta VALUES('coverage_since',?)", (repo.clock(),))


def accepted(c, tenant, request_id, now):
    # This is called in the SAME queue transaction, after replay validation.
    # Distinct cache hits and joins count as requests; transport/message replay,
    # pagination, help, delivery commands and unaccepted questions do not.
    key = hashlib.sha256(json.dumps([tenant, request_id], separators=(',', ':')).encode()).hexdigest()
    c.execute('INSERT OR IGNORE INTO model_usage_requests VALUES(?,?)', (key, now))


def dispatched(repo, event_id):
    with repo.connection(True) as c:
        count = c.execute("UPDATE calls SET dispatched=? WHERE id=? AND source LIKE 'model:%' AND dispatched IS NULL", (repo.clock(), event_id)).rowcount
        if count != 1:
            raise RuntimeError('MODEL_DISPATCH_RECEIPT_INVALID')


def summary(repo):
    now = repo.clock()
    cutoff = now - WINDOW_SECONDS
    with repo.connection() as c:
        started = c.execute("SELECT value FROM model_usage_meta WHERE name='started_at'").fetchone()[0]
        coverage = c.execute("SELECT value FROM model_usage_meta WHERE name='coverage_since'").fetchone()
        coverage_since = coverage[0] if coverage else started
        requests = c.execute('SELECT COUNT(*) FROM model_usage_requests WHERE at>? AND at<=?', (cutoff, now)).fetchone()[0]
        rows = c.execute("SELECT state, COUNT(*) FROM calls WHERE source LIKE 'model:%' AND dispatched>? AND dispatched<=? GROUP BY state", (cutoff, now)).fetchall()
        by_state = {row[0]: row[1] for row in rows}
        by_model = {row[0].removeprefix('model:'): row[1] for row in c.execute("SELECT source, COUNT(*) FROM calls WHERE source LIKE 'model:%' AND dispatched>? AND dispatched<=? GROUP BY source", (cutoff, now))}
    attempts = sum(by_state.values())
    return dict(schema=SCHEMA, generated_at=now, window_seconds=WINDOW_SECONDS,
                window_start=max(cutoff, started), collection_started_at=started,
                coverage_since=coverage_since, full_window=coverage_since <= cutoff, requests=requests, attempts=attempts,
                average=round(attempts / requests, 4) if requests else None,
                received=by_state.get('RECEIVED', 0),
                failed=by_state.get('HTTP_ERROR', 0),
                unknown=by_state.get('UNKNOWN', 0),
                pending=by_state.get('SENDING', 0), by_model=by_model)
