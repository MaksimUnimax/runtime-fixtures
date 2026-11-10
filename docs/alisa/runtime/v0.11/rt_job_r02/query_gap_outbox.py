"""Safe atomic outbox in the existing encrypted gap database; no raw backfill."""
import hashlib
import json
import time
import math
import sqlite3
from pathlib import Path
from uuid import uuid4
from query_gap_events import canonical,make_event,event_shape

MAX_PENDING_BYTES=8*1024*1024

def install(c,now=None):
    c.execute('CREATE TABLE IF NOT EXISTS gap_event_outbox(id TEXT PRIMARY KEY,case_id TEXT NOT NULL,rid TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,created REAL NOT NULL,sealed INTEGER NOT NULL DEFAULT 0)')
    c.execute('''CREATE TABLE IF NOT EXISTS gap_event_health(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        stream_id TEXT NOT NULL,coverage_start REAL NOT NULL,dropped INTEGER NOT NULL DEFAULT 0,
        pending_bytes INTEGER NOT NULL DEFAULT 0,last_ack REAL,last_error TEXT)''')
    c.execute('INSERT OR IGNORE INTO gap_event_health(singleton,stream_id,coverage_start)VALUES(1,?,?)',(str(uuid4()),time.time()if now is None else now))

def enqueue(c,key,tenant,jid,created,reason,catalog_hash,payload,*,internal_test=False):
    install(c)
    if type(payload)is not dict:
        c.execute("UPDATE gap_event_health SET dropped=dropped+1,last_error='INVALID_PROJECTION'WHERE singleton=1");return
    receipts=payload.get('request_receipts',[])
    identities=[r['rid']for r in receipts if type(r)is dict and type(r.get('rid'))is str and 0<len(r['rid'])<=512]if type(receipts)is list else[]
    if not identities:identities=[jid]
    if len(identities)>128:
        c.execute("UPDATE gap_event_health SET dropped=dropped+?,last_error='OUTBOX_BATCH_CAPACITY'WHERE singleton=1",(len(identities)-128,))
    for rid in identities[:128]:
        enqueue_one(c,key,tenant,jid,rid,created,reason,catalog_hash,payload,internal_test=internal_test)

def enqueue_one(c,key,tenant,jid,rid,created,reason,catalog_hash,payload,*,internal_test=False):
    try:body=canonical(make_event(key,tenant,jid+'\0'+rid,created,reason,catalog_hash,payload,internal_test=internal_test))
    except (ValueError,TypeError,OverflowError,KeyError):
        c.execute("UPDATE gap_event_health SET dropped=dropped+1,last_error='INVALID_PROJECTION'WHERE singleton=1")
        return
    size=len(body.encode());used=c.execute('SELECT pending_bytes FROM gap_event_health WHERE singleton=1').fetchone()[0]
    if used+size>MAX_PENDING_BYTES:
        c.execute("UPDATE gap_event_health SET dropped=dropped+1,last_error='OUTBOX_CAPACITY'WHERE singleton=1");return
    event=json.loads(body);digest=hashlib.sha256(body.encode()).hexdigest()
    case=c.execute('SELECT id FROM cases WHERE tenant=?AND jid=?',(tenant,jid)).fetchone()
    inserted=c.execute('INSERT OR IGNORE INTO gap_event_outbox(id,case_id,rid,body,sha256,created)VALUES(?,?,?,?,?,?)',(event['event_id'],case[0],rid,body,digest,created)).rowcount
    if inserted:c.execute('UPDATE gap_event_health SET pending_bytes=pending_bytes+?WHERE singleton=1',(size,))

def pending(store,limit=16):
    if type(limit)is not int or not 1<=limit<=16:raise ValueError('OUTBOX_LIMIT')
    with store.connection(True)as c:
        install(c)
        events=[];marks=[]
        for row in c.execute('SELECT *FROM gap_event_outbox ORDER BY created,id LIMIT ?',(limit,)).fetchall():
            try:
                body=json.loads(row['body']);event_shape(body)
                if body['event_id']!=row['id']or hashlib.sha256(row['body'].encode()).hexdigest()!=row['sha256']:raise ValueError('OUTBOX_INTEGRITY')
            except (ValueError,TypeError,KeyError,OverflowError):
                c.execute('DELETE FROM gap_event_outbox WHERE id=?',(row['id'],))
                c.execute("UPDATE gap_event_health SET pending_bytes=max(0,pending_bytes-?),dropped=dropped+1,last_error='INVALID_EVENT'WHERE singleton=1",(len(row['body'].encode()),))
                continue
            if not row['sealed']:
                body=seal(store,c,row,body)
                raw=canonical(body);digest=hashlib.sha256(raw.encode()).hexdigest()
                c.execute('UPDATE gap_event_outbox SET body=?,sha256=?,sealed=1 WHERE id=?',(raw,digest,row['id']))
                c.execute('UPDATE gap_event_health SET pending_bytes=max(0,pending_bytes+?)WHERE singleton=1',(len(raw.encode())-len(row['body'].encode()),))
                marks.append((row['id'],digest))
            else:marks.append((row['id'],row['sha256']))
            events.append(body)
        h=dict(c.execute('SELECT *FROM gap_event_health WHERE singleton=1').fetchone())
        if marks:
            oldest=c.execute('SELECT min(created)FROM gap_event_outbox WHERE id NOT IN('+','.join('?'for _ in marks)+')',[m[0]for m in marks]).fetchone()[0]
        else:oldest=c.execute('SELECT min(created)FROM gap_event_outbox').fetchone()[0]
        delivered=sum(len(canonical(event).encode())for event in events)
    return {'events':events,'coverage':{'kind':'template_misses','stream_id':h['stream_id'],'coverage_start':h['coverage_start'],
        'dropped':h['dropped'],'pending_bytes':max(0,h['pending_bytes']-delivered),'oldest_pending_at':oldest,
        'internal_test':store.internal_test}},marks

def seal(store,c,row,event):
    """Finality is observed once before first send, never changed on HTTP retry."""
    path=getattr(store,'state_path',store.path.with_name('state.sqlite3'))
    case=c.execute('SELECT tenant,jid FROM cases WHERE id=?',(row['case_id'],)).fetchone()
    if not path.is_file()or path.is_symlink()or not case:return event
    # Reads metadata only. No original question, plan, provider body or report.
    with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,timeout=2)as main:
        value=main.execute("SELECT state,error,CASE WHEN json_valid(result)THEN json_extract(result,'$.template_gap')END,CASE WHEN json_valid(result)THEN json_extract(result,'$.provider_error.http_status')END FROM jobs WHERE tenant=?AND id=?",(case['tenant'],case['jid'])).fetchone()
        from query_gap_terminal import reader_state
        reader=reader_state(main,case['tenant'],row['rid'],case['jid'])
        age=main.execute('SELECT a.created FROM inbox_age a JOIN inbox r ON r.tenant=a.tenant AND r.rid=a.rid WHERE r.tenant=?AND r.rid=?AND r.jid=?',(case['tenant'],row['rid'],case['jid'])).fetchone()
    if age and type(age[0])in {int,float}and math.isfinite(age[0]):
        from query_gap_events import stamp
        event['occurred_at']=stamp(age[0])
    if value:
        state,error,template_gap,http=value
        if reader=='CANCELED':event['final_outcome']='CANCELED';return event_shape(event)
        if reader=='UNKNOWN'and state not in {'CANCELLED','CANCELED'}:return event_shape(event)
        if state in {'CANCELLED','CANCELED'}:event['final_outcome']='CANCELED'
        elif state=='FAILED':
            event['final_outcome']='REVOKED'if error in {'CREDENTIAL_REVOKED','ACCOUNT_BLOCKED'}else'FAILED'
        elif state=='READY'and template_gap:
            event['final_outcome']='FAILED'if event['reason_code']=='PARSER_OR_RUNTIME_BUG'else'NEEDS_CLARIFICATION'if event['reason_code']in {'NEEDS_CLARIFICATION','AMBIGUOUS_STORE_OR_PERIOD'}else'UNSUPPORTED'
        elif state=='READY'and http is not None:event['final_outcome']='FAILED'
    return event_shape(event)

def acknowledge(store,marks):
    with store.connection(True)as c:
        for ident,digest in marks:
            row=c.execute('SELECT body FROM gap_event_outbox WHERE id=?AND sha256=?',(ident,digest)).fetchone()
            if row:
                c.execute('DELETE FROM gap_event_outbox WHERE id=?AND sha256=?',(ident,digest))
                c.execute('UPDATE gap_event_health SET pending_bytes=max(0,pending_bytes-?)WHERE singleton=1',(len(row['body'].encode()),))
        c.execute('UPDATE gap_event_health SET last_ack=?,last_error=NULL WHERE singleton=1',(time.time(),))
