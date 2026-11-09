"""Active bounded expiration for private reports. No model, network or credentials.
The independent timer runs even with no incoming chat. Payloads and idempotence
metadata have different lifetimes; uncertain outcomes never become blind retries.
"""
from __future__ import annotations
import argparse
import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path

PAYLOAD_TTL = 900
REPLAY_TTL = 86400
LEDGER_TTL = 90000
BATCH = 200
MAX_USED_BYTES = 64 * 1024 * 1024


def install(repo):
    """Additive migration: old runtime remains readable during code rollback."""
    with repo.connection(True) as c:
        c.execute('CREATE TABLE IF NOT EXISTS inbox_age(tenant TEXT,rid TEXT,created REAL NOT NULL,PRIMARY KEY(tenant,rid))')
        for name, table, cols in [
            ('jobs_updated','jobs','state,updated'), ('jobs_alias','jobs','alias'),
            ('inbox_time','inbox_age','created'), ('inbox_job','inbox','jid'),
            ('control_time','control_inbox','created'), ('calls_job','calls','jid'),
            ('calls_time','calls','at')]:
            c.execute('CREATE INDEX IF NOT EXISTS retention_'+name+' ON '+table+'('+cols+')')
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'dialogue_context' in tables:
            c.execute('CREATE INDEX IF NOT EXISTS retention_context_time ON dialogue_context(updated)')
            c.execute("CREATE INDEX IF NOT EXISTS retention_pending_expiry ON dialogue_context(json_extract(pending,'$.expires_at')) WHERE pending IS NOT NULL")
            c.execute('CREATE INDEX IF NOT EXISTS retention_dialogue_time ON dialogue_receipts(created)')
            c.execute('CREATE INDEX IF NOT EXISTS retention_dialogue_job ON dialogue_receipts(jid)')


def admission(c, tenant, kind):
    from semantics import Rejected
    used = (c.execute('PRAGMA page_count').fetchone()[0] - c.execute('PRAGMA freelist_count').fetchone()[0]) * c.execute('PRAGMA page_size').fetchone()[0]
    if kind not in ('job','dialogue','control','inbox','reader'):raise ValueError('admission kind')
    # Only measured storage capacity; no per-tenant/job/receipt-count allowance.
    if used >= MAX_USED_BYTES:
        raise Rejected('STORAGE_CAPACITY','Хранилище достигло безопасного лимита. Новый запрос не принят; действующие задания и уточнения не удалены.')


def sweep(repo, batch=BATCH):
    """One bounded transaction. Active jobs, access revocations and quota window stay."""
    if type(batch) is not int or not 1 <= batch <= 1000:
        raise ValueError('batch')
    now = repo.clock()
    counts = {}
    with repo.connection(True) as c:
        def change(name, sql, args=()):
            counts[name] = c.execute(sql, args).rowcount
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'dialogue_context' in tables:
            change('expired_pending', "UPDATE dialogue_context SET pending=NULL WHERE rowid IN (SELECT rowid FROM dialogue_context WHERE pending IS NOT NULL AND json_extract(pending,'$.expires_at')<=? LIMIT ?)", (now,batch))
            change('old_dialogue_receipts','DELETE FROM dialogue_receipts WHERE rowid IN (SELECT rowid FROM dialogue_receipts WHERE created<=? ORDER BY created LIMIT ?)',(now-REPLAY_TTL,batch))
            change('old_context_cursors','DELETE FROM dialogue_context WHERE rowid IN (SELECT rowid FROM dialogue_context WHERE pending IS NULL AND updated<=? ORDER BY updated LIMIT ?)',(now-REPLAY_TTL,batch))
            change('dialogue_payloads',"UPDATE dialogue_receipts SET reply='{}',plan=NULL,expires=MIN(COALESCE(expires,created+?),created+?) WHERE rowid IN (SELECT rowid FROM dialogue_receipts WHERE (created+?<=? OR (expires IS NOT NULL AND expires<=?)) AND (reply!='{}' OR plan IS NOT NULL) LIMIT ?)",(PAYLOAD_TTL,PAYLOAD_TTL,PAYLOAD_TTL,now,now,batch))
        if 'reader_cursors' in tables:
            # Preserve a reference to an active canonical job behind aliases.
            active_chain = """WITH RECURSIVE chain(id,state,alias,depth) AS (
              SELECT id,state,alias,0 FROM jobs WHERE id=reader_cursors.jid
              UNION ALL SELECT j.id,j.state,j.alias,ch.depth+1 FROM jobs j
              JOIN chain ch ON j.id=ch.alias WHERE ch.depth<7)
              SELECT 1 FROM chain WHERE state IN ('QUEUED','RUNNING')"""
            change('old_reader_cursors',"DELETE FROM reader_cursors WHERE rowid IN (SELECT rowid FROM reader_cursors WHERE updated<=? AND NOT EXISTS("+active_chain+") ORDER BY updated LIMIT ?)",(now-REPLAY_TTL,batch))
            change('orphan_reader_cursors',"DELETE FROM reader_cursors WHERE rowid IN (SELECT rowid FROM reader_cursors WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=reader_cursors.jid AND j.tenant=reader_cursors.tenant) LIMIT ?)",(batch,))
            change('orphan_reader_pointers',"DELETE FROM reader_pointers WHERE rowid IN (SELECT rowid FROM reader_pointers p WHERE NOT EXISTS(SELECT 1 FROM reader_cursors r WHERE r.tenant=p.tenant AND r.conversation=p.conversation AND r.jid=p.jid) LIMIT ?)",(batch,))
            change('expired_legacy_readers',"DELETE FROM pointers WHERE rowid IN (SELECT rowid FROM pointers p WHERE NOT EXISTS(SELECT 1 FROM reader_cursors r WHERE r.tenant=p.tenant AND r.conversation='' AND r.jid=p.jid) LIMIT ?)",(batch,))
        change('old_controls','DELETE FROM control_inbox WHERE rowid IN (SELECT rowid FROM control_inbox WHERE created<=? ORDER BY created LIMIT ?)',(now-REPLAY_TTL,batch))
        change('control_payloads',"UPDATE control_inbox SET reply='{}',plan=NULL,expires=MIN(COALESCE(expires,created+?),created+?) WHERE rowid IN (SELECT rowid FROM control_inbox WHERE (created+?<=? OR (expires IS NOT NULL AND expires<=?)) AND (reply!='{}' OR plan IS NOT NULL) LIMIT ?)",(PAYLOAD_TTL,PAYLOAD_TTL,PAYLOAD_TTL,now,now,batch))
        # Pre-migration ingress did not store receipt time. Start a conservative
        # 24-hour deduplication window at migration, not at an older job's creation.
        change('ingress_ages_registered','INSERT OR IGNORE INTO inbox_age SELECT i.tenant,i.rid,? FROM inbox i WHERE NOT EXISTS(SELECT 1 FROM inbox_age a WHERE a.tenant=i.tenant AND a.rid=i.rid) LIMIT ?',(now,batch))
        change('old_ingress','DELETE FROM inbox WHERE rowid IN (SELECT i.rowid FROM inbox i JOIN inbox_age a ON a.tenant=i.tenant AND a.rid=i.rid WHERE a.created<=? ORDER BY a.created LIMIT ?)',(now-REPLAY_TTL,batch))
        change('orphan_ingress_ages','DELETE FROM inbox_age WHERE rowid IN (SELECT rowid FROM inbox_age a WHERE NOT EXISTS(SELECT 1 FROM inbox i WHERE i.tenant=a.tenant AND i.rid=a.rid) LIMIT ?)',(batch,))
        eligible = "((state='READY' AND expires<=?) OR (state IN ('FAILED','CANCELLED','UNKNOWN','ALIASED') AND updated<=?))"
        change('job_payloads',"UPDATE jobs SET draft='{}',plan=NULL,result=NULL,progress=NULL,state=CASE WHEN state='READY' THEN 'EXPIRED' ELSE state END WHERE id IN (SELECT id FROM jobs WHERE "+eligible+" AND (draft!='{}' OR plan IS NOT NULL OR result IS NOT NULL OR progress IS NOT NULL) LIMIT ?)",(now,now-PAYLOAD_TTL,batch))
        # Unknown outcomes retain only an opaque blocking identity. Never remove
        # a target while a recent message or alias still references it.
        refs = " AND NOT EXISTS(SELECT 1 FROM inbox WHERE jid=jobs.id) AND NOT EXISTS(SELECT 1 FROM jobs a WHERE a.alias=jobs.id)"
        if 'reader_cursors' in tables:
            refs += ' AND NOT EXISTS(SELECT 1 FROM reader_cursors r WHERE r.jid=jobs.id)'
        if 'dialogue_receipts' in tables:
            refs += ' AND NOT EXISTS(SELECT 1 FROM dialogue_receipts d WHERE d.jid=jobs.id)'
        change('old_closed_jobs',"DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE state IN ('EXPIRED','FAILED','CANCELLED','ALIASED') AND updated<=?"+refs+' ORDER BY updated LIMIT ?)',(now-REPLAY_TTL,batch))
        change('orphan_slots','DELETE FROM slots WHERE rowid IN (SELECT rowid FROM slots WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.id=slots.jid) LIMIT ?)',(batch,))
        change('orphan_pointers','DELETE FROM pointers WHERE rowid IN (SELECT rowid FROM pointers WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE jobs.id=pointers.jid) LIMIT ?)',(batch,))
        if 'model_usage_requests' in tables:
            from model_usage import WINDOW_SECONDS
            change('old_model_requests','DELETE FROM model_usage_requests WHERE at<=?',(now-WINDOW_SECONDS,))
            # Model accounting expires even when its job is still running. Other
            # provider calls keep their previous replay/quota/active-job policy.
            change('old_model_calls',"DELETE FROM calls WHERE source LIKE 'model:%' AND COALESCE(dispatched,at)<=?",(now-WINDOW_SECONDS,))
            non_model="source NOT LIKE 'model:%' AND "
        else:
            non_model=''
        change('old_call_ledger',"DELETE FROM calls WHERE id IN (SELECT id FROM calls WHERE "+non_model+"at<=? AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=calls.jid AND j.state IN ('QUEUED','RUNNING')) ORDER BY at LIMIT ?)",(now-LEDGER_TTL,batch))
        change('old_rates','DELETE FROM rates WHERE rowid IN (SELECT rowid FROM rates WHERE not_before<=? AND NOT EXISTS(SELECT 1 FROM calls WHERE calls.source=rates.source) LIMIT ?)',(now-LEDGER_TTL,batch))
    return counts


class MaintenanceRepository:
    """Minimal DB holder: timer never initializes Engine, HTTPTransport or tokens."""
    def __init__(self, path, clock=time.time):
        self.path, self.clock = str(path), clock
    @contextmanager
    def connection(self, write=False):
        c = sqlite3.connect('file:'+self.path+'?mode=rw', uri=True, timeout=.2)
        try:
            c.execute('PRAGMA busy_timeout=200')
            c.execute('PRAGMA secure_delete=ON')
            c.execute('PRAGMA journal_size_limit=1048576')
            if write:
                c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()


def compact(repo):
    with repo.connection() as c:
        checkpoint = c.execute('PRAGMA wal_checkpoint(PASSIVE)').fetchone()
        mode = c.execute('PRAGMA auto_vacuum').fetchone()[0]
        if mode == 2:
            c.execute('PRAGMA incremental_vacuum(128)').fetchall()
            # Publish the reduced page count to the main file, not just WAL.
            checkpoint = c.execute('PRAGMA wal_checkpoint(PASSIVE)').fetchone()
        # Busy readers are not killed. TRUNCATE waits at most 200ms; retry on a
        # later tick if busy. Never unlink WAL/SHM from the filesystem.
        wal = Path(repo.path+'-wal')
        if wal.exists() and wal.stat().st_size > 1048576:
            checkpoint = c.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
        stats = {n:c.execute('PRAGMA '+n).fetchone()[0] for n in ('page_count','page_size','freelist_count','auto_vacuum')}
    return stats, checkpoint


def maintain(path, batch=BATCH):
    repo = MaintenanceRepository(path)
    started = time.monotonic()
    totals = {}
    passes = 0
    # Protect ingress latency: short commits and a bounded maintenance budget.
    while passes < 10 and time.monotonic()-started < 2:
        counts = sweep(repo,batch)
        passes += 1
        for name,count in counts.items():
            totals[name] = totals.get(name,0)+count
        if not any(counts.values()):
            break
    stats, checkpoint = compact(repo)
    return {'utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
            'removed_or_redacted':totals,'passes':passes,'database':stats,
            'checkpoint':checkpoint,'elapsed_ms':round(1000*(time.monotonic()-started)),
            'network_calls':0,'payloads_logged':False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database',required=True)
    parser.add_argument('--status-file')
    args = parser.parse_args()
    report = maintain(args.database)
    if args.status_file:
        p = Path(args.status_file)
        tmp = p.with_suffix('.tmp')
        tmp.write_text(json.dumps(report,indent=2))
        tmp.chmod(0o600)
        tmp.replace(p)
    print(json.dumps(report))
if __name__ == '__main__':
    main()
