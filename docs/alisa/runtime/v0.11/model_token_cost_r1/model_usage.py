"""Seven-day model dispatch accounting; no prompts, answers, credentials or quotas.

The queue's existing call ledger is the sole attempt journal. A reservation is
counted only when the production transport reaches the network dispatch boundary.
"""
from __future__ import annotations
import hashlib
import json
import re
from decimal import Decimal

WINDOW_SECONDS = 7 * 86400
SCHEMA = 'alisa-model-usage/v1'


def install(repo):
    with repo.connection(True) as c:
        columns = {r[1] for r in c.execute('PRAGMA table_info(calls)')}
        if 'dispatched' not in columns:
            c.execute('ALTER TABLE calls ADD COLUMN dispatched REAL')
        if 'error_code' not in columns:
            c.execute('ALTER TABLE calls ADD COLUMN error_code TEXT')
        if 'model_usage' not in columns:
            c.execute('ALTER TABLE calls ADD COLUMN model_usage TEXT')
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


def undispatched(repo, event_id):
    """Undo only a transport-proven abort before any HTTP send was attempted."""
    with repo.connection(True) as c:
        # The caller can already have recorded UNKNOWN while its I/O thread
        # finishes this proven pre-send abort. A received response must never
        # lose its stamp; no-send may retire a pending or failed reservation.
        count=c.execute("UPDATE calls SET dispatched=NULL WHERE id=? AND source LIKE 'model:%' AND state IN ('SENDING','HTTP_ERROR','UNKNOWN') AND dispatched IS NOT NULL",(event_id,)).rowcount
        if count!=1:raise RuntimeError('MODEL_DISPATCH_ABORT_INVALID')


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


def receipt(envelope, requested_model):
    """Only billing counters and model identity; never content or reasoning text."""
    result = {'requested_model': requested_model}
    if type(envelope) is not dict:
        return result
    model = envelope.get('model')
    if type(model) is str and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', model):
        result['model'] = model
    created = envelope.get('created')
    if type(created) is int and 0 <= created < 2**63:
        result['created'] = created
    usage = envelope.get('usage')
    if type(usage) is not dict:
        return result
    counts = {}
    for key in ('prompt_tokens', 'completion_tokens', 'total_tokens',
                'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens'):
        value = usage.get(key)
        if type(value) is int and 0 <= value < 2**63:
            counts[key] = value
    for detail, key in (('prompt_tokens_details', 'cached_tokens'),
                        ('completion_tokens_details', 'reasoning_tokens')):
        details = usage.get(detail)
        value = details.get(key) if type(details) is dict else None
        if type(value) is int and 0 <= value < 2**63:
            counts[detail] = {key: value}
    result['usage'] = counts
    return result


def record(repo, event_id, value):
    if value is None:
        return
    with repo.connection(True) as c:
        c.execute("UPDATE calls SET model_usage=? WHERE id=? AND source LIKE 'model:%' "
                  "AND dispatched IS NOT NULL AND model_usage IS NULL",
                  (json.dumps(value, ensure_ascii=False, separators=(',', ':')), event_id))


def job_attempts(repo, job_id):
    """All real attempts, including unknown costs; historical gaps stay unknown."""
    with repo.connection() as c:
        rows = c.execute("SELECT id,source,dispatched,state,http,model_usage FROM calls "
                         "WHERE jid=? AND source LIKE 'model:%' AND dispatched>? "
                         "ORDER BY id", (job_id, repo.clock()-WINDOW_SECONDS)).fetchall()
    return [dict(id=r['id'], source=r['source'], dispatched=r['dispatched'],
                 state=r['state'], http=r['http'],
                 receipt=json.loads(r['model_usage']) if r['model_usage'] else None)
            for r in rows]


def price_attempt(value, *, input_cached, input_uncached, output, rub_per_currency):
    """Quote at caller-supplied, dated rates per million; None means incomplete.

    Output includes reasoning tokens already. Never add reasoning_tokens twice.
    The caller selects the actual model, currency, tariff period and FX quote.
    """
    usage = (value or {}).get('usage', {})
    prompt = usage.get('prompt_tokens'); completion = usage.get('completion_tokens')
    hit = usage.get('prompt_cache_hit_tokens')
    details = usage.get('prompt_tokens_details', {})
    alternate = details.get('cached_tokens')
    if hit is None:
        hit = alternate
    elif alternate is not None and alternate != hit:
        return None
    if any(type(v) is not int or v < 0 for v in (prompt, completion, hit)):
        return None
    miss = usage.get('prompt_cache_miss_tokens', prompt-hit)
    if type(miss) is not int or miss < 0 or hit+miss != prompt:
        return None
    if 'total_tokens' in usage and usage['total_tokens'] != prompt+completion:
        return None
    cached, uncached, out, fx = map(lambda v: Decimal(str(v)),
                                  (input_cached, input_uncached, output, rub_per_currency))
    if any(not v.is_finite() or v < 0 for v in (cached, uncached, out)) or not fx.is_finite() or fx <= 0:
        raise ValueError('MODEL_COST_RATES')
    amount = (hit*cached + miss*uncached + completion*out) / Decimal(1000000)
    return {'currency_amount': str(amount), 'rub': str(amount*fx)}
