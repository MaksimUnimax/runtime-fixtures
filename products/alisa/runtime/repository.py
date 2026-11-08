"""Durable exact-only jobs, idempotent ingress, leases and per-source request reservations."""
from __future__ import annotations
import os
import sqlite3
import time
import threading
import uuid
from datetime import datetime
import providers
from contextlib import contextmanager
from pathlib import Path
import retention
from semantics import Rejected, canonical_json, fingerprint, strict_json

ACTIVE = {'QUEUED','RUNNING'}
class Deferred(Exception):
    def __init__(self, until):
        self.until = float(until)
        super().__init__('SOURCE_RATE_LIMIT')

class Repository:
    def __init__(self, path: str, clock=time.time, ttl: int=900, lease: int=120):
        self.path, self.clock, self.ttl, self.lease = str(path), clock, ttl, lease
        self._transaction = threading.local()
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as c:
            c.execute('PRAGMA journal_mode=WAL')
            c.executescript('''
            CREATE TABLE IF NOT EXISTS jobs(
              id TEXT PRIMARY KEY, tenant TEXT NOT NULL, key TEXT NOT NULL,
              state TEXT NOT NULL, draft TEXT NOT NULL, plan TEXT, progress TEXT,
              result TEXT, error TEXT, created REAL NOT NULL, updated REAL NOT NULL,
              due REAL NOT NULL, lease REAL, owner TEXT, expires REAL,
              alias TEXT, delivered INTEGER NOT NULL DEFAULT 0, page INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE IF NOT EXISTS slots(tenant TEXT,key TEXT,jid TEXT,PRIMARY KEY(tenant,key));
            CREATE TABLE IF NOT EXISTS inbox(tenant TEXT,rid TEXT,body_hash TEXT,jid TEXT,
              PRIMARY KEY(tenant,rid));
            CREATE TABLE IF NOT EXISTS control_inbox(
              tenant TEXT NOT NULL,rid TEXT NOT NULL,body_hash TEXT NOT NULL,
              reply TEXT NOT NULL,plan TEXT,expires REAL,created REAL NOT NULL,
              PRIMARY KEY(tenant,rid));
            CREATE TABLE IF NOT EXISTS pointers(tenant TEXT PRIMARY KEY,jid TEXT);
            CREATE TABLE IF NOT EXISTS calls(
              id INTEGER PRIMARY KEY, jid TEXT, source TEXT, at REAL, state TEXT,
              http INTEGER, elapsed_ms INTEGER, response_bytes INTEGER);
            CREATE INDEX IF NOT EXISTS calls_source_at ON calls(source,at);
            CREATE INDEX IF NOT EXISTS runnable_jobs ON jobs(state,due,created);
            CREATE TABLE IF NOT EXISTS rates(source TEXT PRIMARY KEY,not_before REAL);
            CREATE TABLE IF NOT EXISTS denied(source TEXT,revision TEXT,PRIMARY KEY(source,revision));
            ''')
        # Additive migration: old code can still read/write the same database.
        # A monotonic dispatch sequence survives restarts and coarse clocks.
        with self.connection(True) as c:
            if 'dispatch_order' not in {r['name'] for r in c.execute('PRAGMA table_info(jobs)')}:
                c.execute('ALTER TABLE jobs ADD COLUMN dispatch_order INTEGER NOT NULL DEFAULT 0')
            if 'queue_order' not in {r['name'] for r in c.execute('PRAGMA table_info(jobs)')}:
                c.execute('ALTER TABLE jobs ADD COLUMN queue_order INTEGER NOT NULL DEFAULT 0')
            c.execute('CREATE INDEX IF NOT EXISTS tenant_dispatch ON jobs(tenant,dispatch_order)')
        from reader_state import install as install_readers
        install_readers(self)
        retention.install(self)
        if os.stat(self.path).st_uid == os.getuid():
            os.chmod(self.path,0o600)

    @contextmanager
    def connection(self, write=False):
        # Control receipts and their state changes share one transaction. The
        # connection is thread-local: other callers still serialize in SQLite.
        existing = getattr(self._transaction, 'connection', None)
        if existing is not None:
            if write and not self._transaction.write:
                raise Rejected('NESTED_WRITE_WITHOUT_TRANSACTION')
            yield existing
            return
        c = sqlite3.connect(self.path, timeout=2)
        c.row_factory = sqlite3.Row
        try:
            c.execute('PRAGMA busy_timeout=2000')
            c.execute('PRAGMA secure_delete=ON')
            c.execute('PRAGMA journal_size_limit=1048576')
            if write: c.execute('BEGIN IMMEDIATE')
            self._transaction.connection, self._transaction.write = c, write
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            self._transaction.connection, self._transaction.write = None, False
            c.close()

    @staticmethod
    def validate_ingress(tenant, rid, body_hash):
        if (not isinstance(tenant, str) or not tenant or not isinstance(rid, str)
            or not 0 < len(rid) <= 256 or not isinstance(body_hash, str)
            or len(body_hash) != 64):
            raise Rejected('INGRESS_SCHEMA')

    def control_reply(self, tenant, rid, body_hash, action, authorize):
        """Atomically persist a P0 reply and its cancellation/read cursor changes.

        action is network-free and returns (reply, protected_plan, expires).
        Replays recheck current authorization and TTL before returning figures.
        """
        self.validate_ingress(tenant, rid, body_hash)
        with self.connection(True) as c:
            if c.execute('SELECT 1 FROM inbox WHERE tenant=? AND rid=?', (tenant, rid)).fetchone():
                raise Rejected('CHANGED_REPLAY')
            old = c.execute('SELECT * FROM control_inbox WHERE tenant=? AND rid=?', (tenant, rid)).fetchone()
            if old:
                if old['body_hash'] != body_hash:
                    raise Rejected('CHANGED_REPLAY')
                if old['plan'] and not authorize(strict_json(old['plan'])):
                    raise Rejected('SOURCE_ACCESS', 'Доступ к источнику изменился. Сохраненные цифры не выдаю.')
                if old['created']+retention.PAYLOAD_TTL<=self.clock() or (old['expires'] is not None and old['expires'] <= self.clock()):
                    raise Rejected('RESULT_EXPIRED', 'Отчет устарел. Повторите исходный запрос для нового полного отчета.')
                return strict_json(old['reply'])
            retention.admission(c,tenant,'control')
            reply, plan, expires = action()
            if plan and (plan.get('tenant') != tenant or not authorize(plan)):
                raise Rejected('SOURCE_ACCESS')
            c.execute('INSERT INTO control_inbox VALUES(?,?,?,?,?,?,?)',
                      (tenant, rid, body_hash, canonical_json(reply),
                       canonical_json(plan) if plan else None, expires, self.clock()))
            return reply

    def _row(self,c,jid,tenant=None):
        seen = set()
        for _ in range(8):
            r = c.execute('SELECT * FROM jobs WHERE id=?',(jid,)).fetchone()
            if r is None: return None
            if tenant is not None and r['tenant'] != tenant:
                raise Rejected('TENANT_DENIED')
            if not r['alias']: return dict(r)
            if r['id'] in seen: raise Rejected('ALIAS_CYCLE')
            seen.add(r['id']); jid = r['alias']
        raise Rejected('ALIAS_DEPTH')

    def _expired(self,c,r):
        if r and r['state']=='RUNNING' and (r['lease'] or 0)<=self.clock():
            c.execute("UPDATE jobs SET state='UNKNOWN',error='LEASE_EXPIRED',updated=? WHERE id=?",(self.clock(),r['id']))
            return self._row(c,r['id'],r['tenant'])
        return r

    def _reusable(self,r,refresh,canonical):
        if not r: return False
        if r['state'] in ACTIVE | {'UNKNOWN'}: return True
        if not canonical: return False
        if r['state']=='READY': return not refresh and (r['expires'] or 0)>self.clock()
        if r['state']=='FAILED': return not refresh
        return False

    def enqueue(self,tenant,rid,body_hash,draft,plan,scope_signature):
        self.validate_ingress(tenant, rid, body_hash)
        if plan and plan.get('tenant') != tenant: raise Rejected('TENANT_DENIED')
        canonical = plan is not None
        key = ('p:'+fingerprint(plan)) if canonical else 'u:'+fingerprint({'draft':draft,'scope':scope_signature})
        with self.connection(True) as c:
            if c.execute('SELECT 1 FROM control_inbox WHERE tenant=? AND rid=?',(tenant,rid)).fetchone():
                raise Rejected('CHANGED_REPLAY')
            old = c.execute('SELECT * FROM inbox WHERE tenant=? AND rid=?',(tenant,rid)).fetchone()
            if old:
                if old['body_hash'] != body_hash: raise Rejected('CHANGED_REPLAY')
                return self._expired(c,self._row(c,old['jid'],tenant)), 'REPLAY'
            retention.admission(c,tenant,'inbox')
            slot = c.execute('SELECT jid FROM slots WHERE tenant=? AND key=?',(tenant,key)).fetchone()
            row = self._expired(c,self._row(c,slot['jid'],tenant)) if slot else None
            # An exact unresolved-key match may already own a fully compiled plan.
            # Reuse that precise job, not a fuzzy phrase/period/metric search.
            if self._reusable(row,draft['refresh'],canonical or bool(row and row['plan'])):
                jid = row['id']; outcome = 'HIT' if row['state']=='READY' else 'JOIN'
            else:
                if c.execute("SELECT COUNT(*) FROM jobs WHERE tenant=? AND state IN ('QUEUED','RUNNING')",(tenant,)).fetchone()[0]>=20:
                    raise Rejected('QUEUE_CAPACITY')
                retention.admission(c,tenant,'job')
                jid = uuid.uuid4().hex; now = self.clock(); outcome = 'NEW'
                queue_order = c.execute('SELECT COALESCE(MAX(queue_order),0)+1 FROM jobs').fetchone()[0]
                c.execute('INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,queue_order) VALUES(?,?,?,?,?,?,?,?,?,?)',
                          (jid,tenant,key,'QUEUED',canonical_json(draft),canonical_json(plan) if plan else None,now,now,now,queue_order))
                c.execute('INSERT OR REPLACE INTO slots VALUES(?,?,?)',(tenant,key,jid))
            c.execute('INSERT INTO inbox VALUES(?,?,?,?)',(tenant,rid,body_hash,jid))
            c.execute('INSERT INTO inbox_age VALUES(?,?,?)',(tenant,rid,self.clock()))
            from reader_state import bind
            bind(self,c,tenant,jid)
            return self._row(c,jid,tenant), outcome

    def claim(self):
        now = self.clock()
        with self.connection(True) as c:
            c.execute("UPDATE jobs SET state='UNKNOWN',error='LEASE_EXPIRED',updated=? WHERE state='RUNNING' AND lease<=?",(now,now))
            r = c.execute("""
                SELECT j.* FROM jobs j
                JOIN (SELECT tenant,MAX(dispatch_order) AS last_dispatch FROM jobs GROUP BY tenant) t
                  ON t.tenant=j.tenant
                WHERE j.state='QUEUED' AND j.due<=?
                ORDER BY t.last_dispatch,j.queue_order,j.created,j.id LIMIT 1
                """,(now,)).fetchone()
            if not r: return None
            owner = uuid.uuid4().hex
            sequence = c.execute('SELECT COALESCE(MAX(dispatch_order),0)+1 FROM jobs').fetchone()[0]
            queue_order = c.execute('SELECT COALESCE(MAX(queue_order),0)+1 FROM jobs').fetchone()[0]
            c.execute("UPDATE jobs SET state='RUNNING',owner=?,lease=?,updated=?,dispatch_order=?,queue_order=? WHERE id=?",
                      (owner,now+self.lease,now,sequence,queue_order,r['id']))
            return self._row(c,r['id'],r['tenant'])

    def _owned(self,c,jid,owner):
        r = self._row(c,jid)
        if not r or r['id']!=jid or r['state']!='RUNNING' or r['owner']!=owner or (r['lease'] or 0)<=self.clock():
            raise Rejected('CLAIM_INVALID')
        return r

    def resolve(self,jid,owner,plan):
        """Persist P2 once; atomically join the canonical report when already present."""
        key = 'p:'+fingerprint(plan)
        with self.connection(True) as c:
            r = self._owned(c,jid,owner)
            if plan.get('tenant') != r['tenant']: raise Rejected('TENANT_DENIED')
            draft = strict_json(r['draft'])
            slot = c.execute('SELECT jid FROM slots WHERE tenant=? AND key=?',(r['tenant'],key)).fetchone()
            other = self._expired(c,self._row(c,slot['jid'],r['tenant'])) if slot else None
            if other and other['id']!=jid and self._reusable(other,draft['refresh'],True):
                c.execute("UPDATE jobs SET state='ALIASED',alias=?,plan=?,owner=NULL,lease=NULL,updated=? WHERE id=?",(other['id'],canonical_json(plan),self.clock(),jid))
                return other
            c.execute('UPDATE jobs SET plan=?,key=?,updated=? WHERE id=?',(canonical_json(plan),key,self.clock(),jid))
            c.execute('INSERT OR REPLACE INTO slots VALUES(?,?,?)',(r['tenant'],key,jid))
            return self._row(c,jid,r['tenant'])

    def reschedule(self,jid,owner,progress=None,until=None):
        with self.connection(True) as c:
            row = self._owned(c,jid,owner)
            c.execute("UPDATE jobs SET state='QUEUED',progress=?,due=?,owner=NULL,lease=NULL,updated=? WHERE id=?",
                      (canonical_json(progress) if progress is not None else row['progress'],until or self.clock(),self.clock(),jid))

    def complete(self,jid,owner,result):
        if not isinstance(result,dict) or result.get('complete') is not True or not isinstance(result.get('pages'),list) or not result['pages'] or not all(isinstance(x,str) and 0<len(x)<=900 for x in result['pages']):
            raise Rejected('INCOMPLETE_RESULT')
        with self.connection(True) as c:
            r = self._owned(c,jid,owner)
            if not r['plan']: raise Rejected('PLAN_REQUIRED')
            base_fields={'complete','pages','data','fetched_at'}
            joined_fields=base_fields|{'join_coverage','enrichment_complete'}
            if set(result) not in (base_fields,joined_fields):
                raise Rejected('RESULT_SCHEMA')
            if set(result)==joined_fields and (type(result['join_coverage']) is not list or type(result['enrichment_complete']) is not bool):
                raise Rejected('RESULT_SCHEMA')
            try:
                datetime.strptime(result['fetched_at'],'%Y-%m-%d %H:%M UTC')
            except (ValueError,TypeError):
                raise Rejected('RESULT_TIMESTAMP') from None
            plan=strict_json(r['plan'])
            verified=providers.render(plan,result['data'],result['fetched_at'])
            if canonical_json(verified)!=canonical_json(result):raise Rejected('RESULT_PROJECTION_MISMATCH')
            c.execute("UPDATE jobs SET state='READY',result=?,progress=NULL,error=NULL,expires=?,updated=?,owner=NULL,lease=NULL WHERE id=?",
                      (canonical_json(result),self.clock()+min(self.ttl,plan.get('freshness_seconds',self.ttl)),self.clock(),jid))

    def fail(self,jid,owner,code,unknown=False):
        with self.connection(True) as c:
            try: self._owned(c,jid,owner)
            except Rejected: return False
            c.execute('UPDATE jobs SET state=?,error=?,updated=?,owner=NULL,lease=NULL WHERE id=?',
                      ('UNKNOWN' if unknown else 'FAILED',code,self.clock(),jid))
            return True

    def reader_scope(self,tenant,conversation):
        from reader_state import scope
        return scope(self,tenant,conversation)

    def get(self,tenant,jid=None):
        with self.connection(True) as c:
            if jid is None:
                from reader_state import selected
                return self._expired(c,selected(self,c,tenant))
            return self._expired(c,self._row(c,jid,tenant))

    def cancel(self,tenant):
        from reader_state import cancel
        return cancel(self,tenant)

    def page(self,tenant,jid,next_page=False):
        from reader_state import page
        return page(self,tenant,jid,next_page)

    def unread(self,tenant,exclude=None):
        from reader_state import unread
        return unread(self,tenant,exclude)

    def reserve(self,jid,owner,source,interval,daily_limit):
        if interval<1 or daily_limit<1: raise Rejected('RATE_CONFIG')
        now = self.clock()
        with self.connection(True) as c:
            self._owned(c,jid,owner)
            rate = c.execute('SELECT not_before FROM rates WHERE source=?',(source,)).fetchone()
            if rate and rate['not_before']>now: raise Deferred(rate['not_before'])
            recent = c.execute('SELECT at FROM calls WHERE source=? AND at>? ORDER BY at',(source,now-86400)).fetchall()
            if len(recent)>=daily_limit: raise Deferred(recent[-daily_limit]['at']+86400)
            c.execute('INSERT OR REPLACE INTO rates VALUES(?,?)',(source,now+interval))
            row = c.execute("INSERT INTO calls(jid,source,at,state) VALUES(?,?,?,'SENDING')",(jid,source,now))
            return row.lastrowid

    def received(self,event_id,meta):
        with self.connection(True) as c:
            c.execute("UPDATE calls SET state='RECEIVED',http=?,elapsed_ms=?,response_bytes=? WHERE id=?",
                      (meta.get('status'),meta.get('elapsed_ms'),meta.get('bytes'),event_id))

    def failed_call(self,event_id,status=None,unknown=False):
        with self.connection(True) as c:
            c.execute('UPDATE calls SET state=?,http=? WHERE id=?',('UNKNOWN' if unknown else 'HTTP_ERROR',status,event_id))

    def defer_source(self,source,until):
        with self.connection(True) as c:
            old = c.execute('SELECT not_before FROM rates WHERE source=?',(source,)).fetchone()
            c.execute('INSERT OR REPLACE INTO rates VALUES(?,?)',(source,max(until,old['not_before'] if old else 0)))

    def deny(self,source,revision):
        with self.connection(True) as c:
            c.execute('INSERT OR IGNORE INTO denied VALUES(?,?)',(source,revision))

    def denied(self,source,revision):
        with self.connection() as c:
            return c.execute('SELECT 1 FROM denied WHERE source=? AND revision=?',(source,revision)).fetchone() is not None

    def call_count(self):
        with self.connection() as c: return c.execute('SELECT COUNT(*) FROM calls').fetchone()[0]
