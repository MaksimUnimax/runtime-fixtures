"""Durable exact-only jobs, idempotent ingress, leases and per-source request reservations."""
from __future__ import annotations
import os
import sqlite3
import time
import uuid
from datetime import datetime
import providers
from contextlib import contextmanager
from pathlib import Path
from semantics import Rejected, canonical_json, fingerprint, strict_json

ACTIVE = {'QUEUED','RUNNING'}
class Deferred(Exception):
    def __init__(self, until):
        self.until = float(until)
        super().__init__('SOURCE_RATE_LIMIT')

class Repository:
    def __init__(self, path: str, clock=time.time, ttl: int=900, lease: int=120):
        self.path, self.clock, self.ttl, self.lease = str(path), clock, ttl, lease
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
            CREATE TABLE IF NOT EXISTS pointers(tenant TEXT PRIMARY KEY,jid TEXT);
            CREATE TABLE IF NOT EXISTS calls(
              id INTEGER PRIMARY KEY, jid TEXT, source TEXT, at REAL, state TEXT,
              http INTEGER, elapsed_ms INTEGER, response_bytes INTEGER);
            CREATE INDEX IF NOT EXISTS calls_source_at ON calls(source,at);
            CREATE INDEX IF NOT EXISTS runnable_jobs ON jobs(state,due,created);
            CREATE TABLE IF NOT EXISTS rates(source TEXT PRIMARY KEY,not_before REAL);
            CREATE TABLE IF NOT EXISTS denied(source TEXT,revision TEXT,PRIMARY KEY(source,revision));
            ''')
        if os.stat(self.path).st_uid == os.getuid():
            os.chmod(self.path,0o600)

    @contextmanager
    def connection(self, write=False):
        c = sqlite3.connect(self.path, timeout=2)
        c.row_factory = sqlite3.Row
        try:
            c.execute('PRAGMA busy_timeout=2000')
            if write: c.execute('BEGIN IMMEDIATE')
            yield c
            c.commit()
        except BaseException:
            c.rollback()
            raise
        finally:
            c.close()

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
        if not isinstance(tenant,str) or not tenant or not isinstance(rid,str) or not 0<len(rid)<=256 or not isinstance(body_hash,str) or len(body_hash)!=64:
            raise Rejected('INGRESS_SCHEMA')
        if plan and plan.get('tenant') != tenant: raise Rejected('TENANT_DENIED')
        canonical = plan is not None
        key = ('p:'+fingerprint(plan)) if canonical else 'u:'+fingerprint({'draft':draft,'scope':scope_signature})
        with self.connection(True) as c:
            old = c.execute('SELECT * FROM inbox WHERE tenant=? AND rid=?',(tenant,rid)).fetchone()
            if old:
                if old['body_hash'] != body_hash: raise Rejected('CHANGED_REPLAY')
                return self._expired(c,self._row(c,old['jid'],tenant)), 'REPLAY'
            slot = c.execute('SELECT jid FROM slots WHERE tenant=? AND key=?',(tenant,key)).fetchone()
            row = self._expired(c,self._row(c,slot['jid'],tenant)) if slot else None
            if self._reusable(row,draft['refresh'],canonical):
                jid = row['id']; outcome = 'HIT' if row['state']=='READY' else 'JOIN'
            else:
                if c.execute("SELECT COUNT(*) FROM jobs WHERE tenant=? AND state IN ('QUEUED','RUNNING')",(tenant,)).fetchone()[0]>=20:
                    raise Rejected('QUEUE_CAPACITY')
                jid = uuid.uuid4().hex; now = self.clock(); outcome = 'NEW'
                c.execute('INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due) VALUES(?,?,?,?,?,?,?,?,?)',
                          (jid,tenant,key,'QUEUED',canonical_json(draft),canonical_json(plan) if plan else None,now,now,now))
                c.execute('INSERT OR REPLACE INTO slots VALUES(?,?,?)',(tenant,key,jid))
            c.execute('INSERT INTO inbox VALUES(?,?,?,?)',(tenant,rid,body_hash,jid))
            c.execute('INSERT OR REPLACE INTO pointers VALUES(?,?)',(tenant,jid))
            return self._row(c,jid,tenant), outcome

    def claim(self):
        now = self.clock()
        with self.connection(True) as c:
            c.execute("UPDATE jobs SET state='UNKNOWN',error='LEASE_EXPIRED',updated=? WHERE state='RUNNING' AND lease<=?",(now,now))
            r = c.execute("SELECT * FROM jobs WHERE state='QUEUED' AND due<=? ORDER BY created,id LIMIT 1",(now,)).fetchone()
            if not r: return None
            owner = uuid.uuid4().hex
            c.execute("UPDATE jobs SET state='RUNNING',owner=?,lease=?,updated=? WHERE id=?",(owner,now+self.lease,now,r['id']))
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
            if set(result)!={'complete','pages','data','fetched_at'}:
                raise Rejected('RESULT_SCHEMA')
            try:
                datetime.strptime(result['fetched_at'],'%Y-%m-%d %H:%M UTC')
            except (ValueError,TypeError):
                raise Rejected('RESULT_TIMESTAMP') from None
            verified=providers.render(strict_json(r['plan']),result['data'],result['fetched_at'])
            if verified!=result:raise Rejected('RESULT_PROJECTION_MISMATCH')
            c.execute("UPDATE jobs SET state='READY',result=?,progress=NULL,error=NULL,expires=?,updated=?,owner=NULL,lease=NULL WHERE id=?",
                      (canonical_json(result),self.clock()+self.ttl,self.clock(),jid))

    def fail(self,jid,owner,code,unknown=False):
        with self.connection(True) as c:
            try: self._owned(c,jid,owner)
            except Rejected: return False
            c.execute('UPDATE jobs SET state=?,error=?,updated=?,owner=NULL,lease=NULL WHERE id=?',
                      ('UNKNOWN' if unknown else 'FAILED',code,self.clock(),jid))
            return True

    def get(self,tenant,jid=None):
        with self.connection(True) as c:
            if jid is None:
                p = c.execute('SELECT jid FROM pointers WHERE tenant=?',(tenant,)).fetchone()
                if not p: return None
                jid = p['jid']
            return self._expired(c,self._row(c,jid,tenant))

    def cancel(self,tenant):
        with self.connection(True) as c:
            p = c.execute('SELECT jid FROM pointers WHERE tenant=?',(tenant,)).fetchone()
            r = self._row(c,p['jid'],tenant) if p else None
            if r and r['state'] in ACTIVE:
                c.execute("UPDATE jobs SET state='CANCELLED',updated=? WHERE id=?",(self.clock(),r['id']))
                return True
            return False

    def page(self,tenant,jid,next_page=False):
        with self.connection(True) as c:
            r = self._row(c,jid,tenant)
            if not r or r['state']!='READY' or (r['expires'] or 0)<=self.clock(): raise Rejected('NOT_READY')
            result = strict_json(r['result']); pages = result['pages']
            i = min(r['page']+1,len(pages)-1) if next_page else 0
            c.execute('UPDATE jobs SET page=?,delivered=? WHERE id=?',(i,int(i==len(pages)-1),r['id']))
            return pages[i]

    def unread(self,tenant,exclude=None):
        # Notification index, not report reuse or historical result reconstruction.
        with self.connection() as c:
            r = c.execute("SELECT id,plan FROM jobs WHERE tenant=? AND state='READY' AND delivered=0 AND expires>? AND id!=? ORDER BY created LIMIT 1",
                          (tenant,self.clock(),exclude or '')).fetchone()
            return dict(r) if r else None

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
