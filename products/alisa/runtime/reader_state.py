"""Conversation-local selection/subscription/cursor over shared immutable jobs.
No business payload, provider calls, token storage or template-specific branches.
The legacy ingress has its own empty reader key; named readers never inherit it.
"""
from __future__ import annotations
import re
from contextlib import contextmanager
import retention
from semantics import Rejected, strict_json

MIGRATION = 'reader-state-v1'
MAX_MIGRATION_ROWS = 10000


def key(repo, tenant):
    value = getattr(repo._transaction, 'reader', None)
    if value is None:
        return ''
    if value[0] != tenant:
        raise Rejected('TENANT_DENIED')
    return value[1]


@contextmanager
def scope(repo, tenant, conversation):
    if not isinstance(conversation, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', conversation):
        raise Rejected('DIALOGUE_SCHEMA')
    previous = getattr(repo._transaction, 'reader', None)
    if previous is not None and previous != (tenant, conversation):
        raise Rejected('READER_SCOPE_NESTING')
    repo._transaction.reader = (tenant, conversation)
    try:
        yield
    finally:
        repo._transaction.reader = previous


def _attach(repo, c, tenant, conversation, jid, now):
    old = c.execute('SELECT 1 FROM reader_cursors WHERE tenant=? AND conversation=? AND jid=?',
                    (tenant, conversation, jid)).fetchone()
    if not old:
        retention.admission(c, tenant, 'reader')
    c.execute('''INSERT INTO reader_cursors(tenant,conversation,jid,page,delivered,cancelled,updated)
                 VALUES(?,?,?,0,0,0,?) ON CONFLICT(tenant,conversation,jid)
                 DO UPDATE SET cancelled=0,updated=excluded.updated''',
              (tenant, conversation, jid, now))
    if conversation:
        c.execute('INSERT OR REPLACE INTO reader_pointers VALUES(?,?,?,?)',
                  (tenant, conversation, jid, now))
    else:
        c.execute('INSERT OR REPLACE INTO pointers VALUES(?,?)', (tenant, jid))


def install(repo):
    """Additive, atomic and idempotent. No guess from a global cursor for a session.
    Existing current dialogue receipts identify only their own accepted job.
    Cursor resets to page zero because old jobs.page was shared and untrustworthy.
    """
    with repo.connection(True) as c:
        c.execute('''CREATE TABLE IF NOT EXISTS reader_pointers(
            tenant TEXT NOT NULL,conversation TEXT NOT NULL,jid TEXT NOT NULL,
            updated REAL NOT NULL,PRIMARY KEY(tenant,conversation))''')
        c.execute('''CREATE TABLE IF NOT EXISTS reader_cursors(
            tenant TEXT NOT NULL,conversation TEXT NOT NULL,jid TEXT NOT NULL,
            page INTEGER NOT NULL DEFAULT 0,delivered INTEGER NOT NULL DEFAULT 0,
            cancelled INTEGER NOT NULL DEFAULT 0,updated REAL NOT NULL,
            PRIMARY KEY(tenant,conversation,jid))''')
        c.execute('CREATE INDEX IF NOT EXISTS reader_cursor_job ON reader_cursors(tenant,jid,cancelled)')
        c.execute('CREATE INDEX IF NOT EXISTS reader_cursor_age ON reader_cursors(updated)')
        c.execute('CREATE TABLE IF NOT EXISTS runtime_migrations(id TEXT PRIMARY KEY,applied REAL NOT NULL)')
        if c.execute('SELECT 1 FROM runtime_migrations WHERE id=?', (MIGRATION,)).fetchone():
            return
        now = repo.clock()
        legacy = c.execute('SELECT tenant,jid FROM pointers LIMIT ?', (MAX_MIGRATION_ROWS + 1,)).fetchall()
        if len(legacy) > MAX_MIGRATION_ROWS:
            raise Rejected('READER_MIGRATION_CAPACITY')
        for p in legacy:
            row = repo._row(c, p['jid'], p['tenant'])
            if row:
                _attach(repo,c,p['tenant'],'',p['jid'],now)
                c.execute('UPDATE reader_cursors SET page=?,delivered=? WHERE tenant=? AND conversation=? AND jid=?',
                          (row['page'],row['delivered'],p['tenant'],'',p['jid']))
        tables = {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if 'dialogue_receipts' in tables:
            rows = c.execute('''SELECT tenant,conversation,jid,created FROM dialogue_receipts
              WHERE jid IS NOT NULL AND created>? AND (expires IS NULL OR expires>?)
              ORDER BY created DESC,message_seq DESC LIMIT ?''',
              (now-retention.PAYLOAD_TTL,now,MAX_MIGRATION_ROWS+1)).fetchall()
            if len(rows) > MAX_MIGRATION_ROWS:
                raise Rejected('READER_MIGRATION_CAPACITY')
            seen = set()
            for p in rows:
                marker = (p['tenant'],p['conversation'])
                if marker in seen:
                    continue
                seen.add(marker)
                if (not re.fullmatch(r'[A-Za-z0-9_-]{8,128}',p['conversation']) or
                        not repo._row(c,p['jid'],p['tenant'])):
                    continue
                _attach(repo,c,p['tenant'],p['conversation'],p['jid'],p['created'])
        c.execute('INSERT INTO runtime_migrations VALUES(?,?)', (MIGRATION,now))


def bind(repo,c,tenant,jid):
    row = repo._row(c,jid,tenant)
    if row is None:
        raise Rejected('REPORT_NOT_FOUND')
    _attach(repo,c,tenant,key(repo,tenant),jid,repo.clock())


def selected(repo,c,tenant):
    conversation = key(repo,tenant)
    if conversation:
        pointer = c.execute('SELECT jid FROM reader_pointers WHERE tenant=? AND conversation=?',
                            (tenant,conversation)).fetchone()
    else:
        pointer = c.execute('SELECT jid FROM pointers WHERE tenant=?',(tenant,)).fetchone()
    if not pointer:
        return None
    row = repo._row(c,pointer['jid'],tenant)
    cursor = c.execute('SELECT * FROM reader_cursors WHERE tenant=? AND conversation=? AND jid=?',
                       (tenant,conversation,pointer['jid'])).fetchone()
    if row is None or cursor is None:
        return None
    if cursor['updated']+retention.REPLAY_TTL<=repo.clock() and row['state'] not in ('QUEUED','RUNNING'):
        return None
    row['_reader_ref'] = pointer['jid']
    if cursor['cancelled']:
        row.update(state='CANCELLED',result=None)
    return row


RELATED = '''WITH RECURSIVE related(id,depth) AS (
 SELECT ?,0 UNION ALL SELECT j.id,r.depth+1 FROM jobs j JOIN related r ON j.alias=r.id
 WHERE j.tenant=? AND r.depth<7) '''


def cancel(repo,tenant):
    with repo.connection(True) as c:
        row = selected(repo,c,tenant)
        if not row or row['state'] not in ('QUEUED','RUNNING'):
            return False
        conversation = key(repo,tenant)
        c.execute(RELATED+'''UPDATE reader_cursors SET cancelled=1,updated=?
          WHERE tenant=? AND conversation=? AND jid IN(SELECT id FROM related)''',
          (row['id'],tenant,repo.clock(),tenant,conversation))
        other = c.execute(RELATED+'''SELECT 1 FROM reader_cursors
          WHERE tenant=? AND cancelled=0 AND jid IN(SELECT id FROM related) LIMIT 1''',
          (row['id'],tenant,tenant)).fetchone()
        if not other:
            c.execute("UPDATE jobs SET state='CANCELLED',updated=? WHERE id=? AND tenant=? AND state IN ('QUEUED','RUNNING')",
                      (repo.clock(),row['id'],tenant))
        return True


def page(repo,tenant,jid,next_page=False):
    with repo.connection(True) as c:
        conversation = key(repo,tenant)
        if conversation:
            row = selected(repo,c,tenant)
            ref = row['_reader_ref'] if row else None
        else:
            # Preserve explicit-job legacy reads/replays without moving selection.
            row = repo._row(c,jid,tenant)
            ref = jid
        if not row or row['id']!=jid or row['state']!='READY' or (row['expires'] or 0)<=repo.clock():
            raise Rejected('NOT_READY')
        cursor = c.execute('SELECT * FROM reader_cursors WHERE tenant=? AND conversation=? AND jid=?',
                           (tenant,conversation,ref)).fetchone()
        if cursor is None:
            if conversation:raise Rejected('NOT_READY')
            retention.admission(c,tenant,'reader')
            c.execute('INSERT INTO reader_cursors VALUES(?,?,?,0,0,0,?)',(tenant,conversation,ref,repo.clock()))
            cursor = c.execute('SELECT * FROM reader_cursors WHERE tenant=? AND conversation=? AND jid=?',
                               (tenant,conversation,ref)).fetchone()
        row['_reader_ref']=ref
        pages = strict_json(row['result'])['pages']
        current = cursor['page'] if conversation else row['page']
        index = min(current+1,len(pages)-1) if next_page else 0
        c.execute('UPDATE reader_cursors SET page=?,delivered=?,updated=? WHERE tenant=? AND conversation=? AND jid=?',
                  (index,int(index==len(pages)-1),repo.clock(),tenant,conversation,row['_reader_ref']))
        if not conversation:
            c.execute('UPDATE jobs SET page=?,delivered=? WHERE id=?',
                      (index,int(index==len(pages)-1),jid))
        return pages[index]


def unread(repo,tenant,exclude=None):
    conversation = key(repo,tenant)
    with repo.connection() as c:
        # At most MAX_TENANT_RECEIPTS compact refs, no business payload duplication.
        for cursor in c.execute('''SELECT jid FROM reader_cursors WHERE tenant=? AND conversation=?
            AND delivered=0 AND cancelled=0 AND updated>? ORDER BY updated LIMIT ?''',
            (tenant,conversation,repo.clock()-retention.REPLAY_TTL,retention.MAX_TENANT_RECEIPTS)):
            row=repo._row(c,cursor['jid'],tenant)
            if row and row['id']!=exclude and row['state']=='READY' and (row['expires'] or 0)>repo.clock():
                return {'id':row['id'],'plan':row['plan']}
    return None
