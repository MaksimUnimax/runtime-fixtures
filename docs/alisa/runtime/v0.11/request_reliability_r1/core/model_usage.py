"""Seven-day model dispatch accounting; no prompts, answers, credentials or quotas.

The queue's existing call ledger is the sole attempt journal. A reservation is
counted only when the production transport reaches the network dispatch boundary.
"""
from __future__ import annotations
import hashlib
import json
import re
from decimal import Decimal
from contextvars import ContextVar

RECEIPT_OBSERVER = ContextVar('model_receipt_observer', default=None)

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
        if 'model_context' not in columns:
            c.execute('ALTER TABLE calls ADD COLUMN model_context TEXT')
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


def dispatch_context(request):
    """Only server-known stage and hashes. Never prompts, tenant IDs or tokens."""
    stage=request.operation
    if type(stage)is not str or re.fullmatch(r'[a-z][a-z0-9_]{0,63}',stage)is None:
        stage='unknown'
    result={'schema':'alisa-model-attempt-context/v1','stage':stage}
    if stage in('template_select','template_verify'):
        from template_protocol import request_metadata
        try:result.update(request_metadata(stage,request.body))
        except (ValueError,KeyError,TypeError):pass
    return result


def _context(value):
    if value is None:return None
    allowed={'schema','stage','prompt_layout','selector_view_sha256','prefix_sha256',
             'instruction_profile_sha256','request_payload_sha256','requested_model','isolation_policy','pricing_quote'}
    if type(value)is not dict or set(value)-allowed or value.get('schema')!='alisa-model-attempt-context/v1':
        raise ValueError('MODEL_ATTEMPT_CONTEXT_INVALID')
    if type(value.get('stage'))is not str or re.fullmatch(r'[a-z][a-z0-9_]{0,63}',value['stage'])is None:
        raise ValueError('MODEL_ATTEMPT_CONTEXT_INVALID')
    for k,v in value.items():
        if k.endswith('_sha256')and(type(v)is not str or re.fullmatch(r'[0-9a-f]{64}',v)is None):raise ValueError('MODEL_ATTEMPT_CONTEXT_INVALID')
    if 'prompt_layout'in value and value['prompt_layout']not in('legacy_v1','catalog_prefix_v2'):raise ValueError('MODEL_ATTEMPT_CONTEXT_INVALID')
    if 'isolation_policy'in value and value['isolation_policy']not in('legacy_none','tenant_v1'):raise ValueError('MODEL_ATTEMPT_CONTEXT_INVALID')
    if 'requested_model'in value and(type(value['requested_model'])is not str or re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}',value['requested_model'])is None):raise ValueError('MODEL_ATTEMPT_CONTEXT_INVALID')
    if 'pricing_quote'in value:
        from model_pricing import snapshot
        if value['pricing_quote']!=snapshot(value.get('requested_model'),value['pricing_quote'].get('dispatch_at')):raise ValueError('MODEL_COST_QUOTE')
    return json.dumps(value,ensure_ascii=False,separators=(',',':'))


def dispatched(repo, event_id, *, context=None):
    metadata=_context(context)
    with repo.connection(True) as c:
        count = c.execute("UPDATE calls SET dispatched=?,model_context=? WHERE id=? AND source LIKE 'model:%' AND dispatched IS NULL", (repo.clock(),metadata,event_id)).rowcount
        if count != 1:
            raise RuntimeError('MODEL_DISPATCH_RECEIPT_INVALID')


def undispatched(repo, event_id):
    """Undo only a transport-proven abort before any HTTP send was attempted."""
    with repo.connection(True) as c:
        # The caller can already have recorded UNKNOWN while its I/O thread
        # finishes this proven pre-send abort. A received response must never
        # lose its stamp; no-send may retire a pending or failed reservation.
        count=c.execute("UPDATE calls SET dispatched=NULL,model_context=NULL WHERE id=? AND source LIKE 'model:%' AND state IN ('SENDING','HTTP_ERROR','UNKNOWN') AND dispatched IS NOT NULL",(event_id,)).rowcount
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
                pending=by_state.get('SENDING', 0), by_model=by_model,
                cache_by_stage=stage_summary(repo)['groups'],economics=request_economics(repo))


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


def record(repo, event_id, value, *, replace=False):
    if value is None:
        return
    with repo.connection(True) as c:
        c.execute("UPDATE calls SET model_usage=? WHERE id=? AND source LIKE 'model:%' "
                  "AND dispatched IS NOT NULL AND (model_usage IS NULL OR ?)",
                  (json.dumps(value, ensure_ascii=False, separators=(',', ':')), event_id, int(replace)))


def job_attempts(repo, job_id):
    """All real attempts, including unknown costs; historical gaps stay unknown."""
    with repo.connection() as c:
        rows = c.execute("SELECT id,source,dispatched,state,http,model_usage,model_context FROM calls "
                         "WHERE jid=? AND source LIKE 'model:%' AND dispatched>? "
                         "ORDER BY id", (job_id, repo.clock()-WINDOW_SECONDS)).fetchall()
    return [dict(id=r['id'], source=r['source'], dispatched=r['dispatched'],
                 state=r['state'], http=r['http'],
                 receipt=json.loads(r['model_usage']) if r['model_usage'] else None,
                  context=json.loads(r['model_context']) if r['model_context'] else None)
            for r in rows]


def price_attempt(value, *, input_cached, input_uncached, output, rub_per_currency):
    """Quote at caller-supplied, dated rates per million; None means incomplete.

    Output includes reasoning tokens already. Never add reasoning_tokens twice.
    The caller selects the actual model, currency, tariff period and FX quote.
    """
    if (value or {}).get('cost_incomplete'):return None
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


def stage_summary(repo, *, rates_by_model=None):
    """Seven-day measured tokens by actual stage/layout, including failed attempts.

    Optional rates are caller-supplied dated *normalization* quotes, not invoices.
    Missing/inconsistent usage remains unknown, never a zero-cost attempt.
    Grouping is bounded by stage/layout/model identities; no full catalogue hashes
    or user IDs are copied into the public summary. Per-attempt metadata retains
    those non-personal hashes in the existing seven-day calls ledger.
    """
    now=repo.clock();groups={}
    with repo.connection() as c:
        rows=c.execute("SELECT model_context,model_usage,state FROM calls WHERE source LIKE 'model:%' AND dispatched>? AND dispatched<=? ORDER BY id",(now-WINDOW_SECONDS,now)).fetchall()
    for row in rows:
        ctx=json.loads(row['model_context'])if row['model_context']else{}
        receipt=json.loads(row['model_usage'])if row['model_usage']else{}
        stage=ctx.get('stage','unknown');layout=ctx.get('prompt_layout','not_applicable'if stage!='unknown'else'unknown')
        requested=receipt.get('requested_model',ctx.get('requested_model','unknown'));served=receipt.get('model','unknown')
        key=(stage,layout,requested,served)
        if key not in groups:
            groups[key]={'stage':stage,'prompt_layout':layout,'requested_model':requested,'served_model':served,
              'attempts':0,'complete_receipts':0,'incomplete_receipts':0,'prompt_tokens':0,'cache_hit_tokens':0,
              'cache_miss_tokens':0,'completion_tokens':0,'quoted_attempts':0,'unquoted_attempts':0,
              '_quoted':Decimal(0),'_quoted_rub':Decimal(0)}
        g=groups[key];g['attempts']+=1
        # Reuse the existing consistency checks, including hit+miss and totals.
        valid=price_attempt(receipt,input_cached=0,input_uncached=0,output=0,rub_per_currency=1)
        if valid is None:g['incomplete_receipts']+=1
        else:
            u=receipt['usage'];hit=u.get('prompt_cache_hit_tokens',u.get('prompt_tokens_details',{}).get('cached_tokens'))
            g['complete_receipts']+=1;g['prompt_tokens']+=u['prompt_tokens'];g['cache_hit_tokens']+=hit
            g['cache_miss_tokens']+=u.get('prompt_cache_miss_tokens',u['prompt_tokens']-hit);g['completion_tokens']+=u['completion_tokens']
        rates=(rates_by_model or{}).get(served)
        if rates is None:rates=(rates_by_model or{}).get(requested)
        if rates is not None:quote=price_attempt(receipt,**rates)
        else:
            from model_pricing import price
            quote=price(receipt,ctx.get('pricing_quote'))
        if quote is None:g['unquoted_attempts']+=1
        else:
            g['quoted_attempts']+=1;g['_quoted']+=Decimal(quote['currency_amount']);g['_quoted_rub']+=Decimal(quote['rub'])
    output=[]
    for _,g in sorted(groups.items()):
        g['cache_hit_ratio']=g['cache_hit_tokens']/g['prompt_tokens']if g['prompt_tokens']else None
        g['receipt_coverage']=g['complete_receipts']/g['attempts']
        quoted=g.pop('_quoted');rub=g.pop('_quoted_rub')
        g['known_cost_at_supplied_rates']=str(quoted)if g['quoted_attempts']else None
        g['known_rub_at_supplied_rates']=str(rub)if g['quoted_attempts']else None
        g['all_attempts_priced']=g['quoted_attempts']==g['attempts']
        output.append(g)
    return {'schema':'alisa-model-cache-stages/v1','window_seconds':WINDOW_SECONDS,'generated_at':now,
            'cost_basis':'caller_supplied_rates_not_invoice'if rates_by_model else'dispatch_snapshot_or_unquoted','groups':output}


def finish_request(repo,row,*,program_seconds=None):
    """Compact timings in the existing seven-day call ledger, no documents."""
    with repo.connection(True)as c:
        last=c.execute("SELECT id,model_context FROM calls WHERE jid=? AND source LIKE 'model:%' AND dispatched IS NOT NULL ORDER BY id DESC LIMIT 1",(row['id'],)).fetchone()
        if last is None:return
        ctx=json.loads(last['model_context'])if last['model_context']else{}
        total=max(0,round((repo.clock()-row['created'])*1000))
        wire=c.execute('SELECT COALESCE(SUM(elapsed_ms),0) FROM calls WHERE jid=?',(row['id'],)).fetchone()[0]
        program_ms=None if program_seconds is None else max(0,round(program_seconds*1000))
        saved=c.execute('SELECT progress FROM jobs WHERE id=?',(row['id'],)).fetchone()
        progress=json.loads(saved['progress'])if saved is not None and saved['progress']else{}
        if program_seconds is not None and progress.get('_program_started_at')is not None:
            program_ms=max(0,round((repo.clock()-progress['_program_started_at'])*1000))
        ctx['request_timing']={'total_ms':total,'provider_ms':wire,'program_ms':program_ms,
          'outside_provider_ms':max(0,total-wire)}
        c.execute('UPDATE calls SET model_context=? WHERE id=?',(json.dumps(ctx,separators=(',',':')),last['id']))

def request_economics(repo):
    from model_pricing import price
    groups={};now=repo.clock()
    with repo.connection()as c:
        rows=c.execute("SELECT jid,source,dispatched,state,elapsed_ms,model_context,model_usage FROM calls WHERE source LIKE 'model:%' AND dispatched>? AND dispatched<=? ORDER BY id",(now-WINDOW_SECONDS,now)).fetchall()
    for row in rows:
        key=hashlib.sha256(row['jid'].encode()).hexdigest()[:16]
        group=groups.setdefault(key,{'request':key,'first_dispatch':row['dispatched'],'route':'unknown','attempts':0,
          'complete_receipts':0,'priced_attempts':0,'unknown_attempts':0,'known_rub':Decimal(0),'quotes':{},'timing':None})
        group['attempts']+=1;ctx=json.loads(row['model_context'])if row['model_context']else{}
        value=json.loads(row['model_usage'])if row['model_usage']else{}
        stage=ctx.get('stage')
        if stage=='model_answer_program':group['route']='program'
        elif stage=='model_answer'and group['route']!='program':group['route']='direct'
        if price_attempt(value,input_cached=0,input_uncached=0,output=0,rub_per_currency=1)is not None:group['complete_receipts']+=1
        quote=ctx.get('pricing_quote');priced=price(value,quote)
        if priced is not None:
            group['priced_attempts']+=1;group['known_rub']+=Decimal(priced['rub']);group['quotes'][quote['id']]=quote
        if row['state'] in ('UNKNOWN','SENDING'):group['unknown_attempts']+=1
        if ctx.get('request_timing'):group['timing']=ctx['request_timing']
    results=[]
    for g in groups.values():
        g['known_rub']=str(g['known_rub'])if g['priced_attempts']else None
        g['cost_complete']=g['priced_attempts']==g['attempts']
        g['receipt_complete']=g['complete_receipts']==g['attempts']
        g['quotes']=list(g['quotes'].values());results.append(g)
    return {'basis':'published_tariff_with_dated_fx_estimate_not_invoice','window_seconds':WINDOW_SECONDS,
      'requests':sorted(results,key=lambda x:x['first_dispatch'],reverse=True)}
