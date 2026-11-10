"""Atomic terminal metadata, without changing the parallel executor/planner.

SQLite triggers copy only closed reasons and opaque local IDs. No question,
plan, result, provider body or model reply is placed in this outbox.
"""
import hashlib,json,sqlite3,time
from contextlib import contextmanager
from uuid import uuid4,uuid5,NAMESPACE_URL
from query_gap_events import canonical,make_event,event_shape

MAX_PENDING=16384
DOC="(CASE WHEN json_valid(new.result)THEN new.result ELSE '{}'END)"
def field(path):return "json_extract("+DOC+",'$."+path+"')"
CLASSIFY="""CASE
 WHEN {model}='SUBSCRIPTION_REQUIRED'THEN 'PROVIDER_PLAN_REQUIRED'
 WHEN {model}IN('METHOD_PERMISSION_REQUIRED','ACCESS_DENIED')OR {http}IN(401,403)THEN 'AUTH_OR_SCOPE'
 WHEN {http}=429 OR {http}>=500 THEN 'RATE_LIMIT_OR_PROVIDER_ERROR'
 WHEN {http}=404 THEN 'DATA_UNAVAILABLE'
 WHEN {http}IS NOT NULL THEN 'PARSER_OR_RUNTIME_BUG'
 WHEN new.state='FAILED'THEN CASE
   WHEN new.error IN('SOURCE_ACCESS','AUTH_REQUIRED','PERMISSION_DENIED','CREDENTIAL_REVOKED')THEN 'AUTH_OR_SCOPE'
   WHEN new.error IN('ACCESS_REQUIRED','SERVICE_ACCESS_REQUIRED')THEN 'SERVICE_ACCESS_REQUIRED'
   WHEN new.error IN('HTTP_429','RATE_LIMIT','PROVIDER_TIMEOUT','PROVIDER_UNAVAILABLE')THEN 'RATE_LIMIT_OR_PROVIDER_ERROR'
   WHEN new.error IN('DATA_UNAVAILABLE','SOURCE_EMPTY')THEN 'DATA_UNAVAILABLE'
   ELSE 'PARSER_OR_RUNTIME_BUG'END
 ELSE NULL END""".format(model=field('model_result.status'),http=field('provider_error.http_status'))

def install(c,now=None):
    required={'jobs':{'id','tenant','state','result','error','updated','alias'},'inbox':{'tenant','rid','jid','body_hash'},'inbox_age':{'tenant','rid','created'},'reader_cursors':{'tenant','conversation','jid','cancelled'},'rt_job_refs':{'runtime_tenant','jid','ref','body_hash'}}
    for table,columns in required.items():
        if not columns<={row[1]for row in c.execute('PRAGMA table_info('+table+')')}:raise ValueError('TERMINAL_SCHEMA_UNAVAILABLE')
    c.execute('''CREATE TABLE IF NOT EXISTS gap_terminal_health(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        stream_id TEXT NOT NULL,coverage_start REAL NOT NULL,dropped INTEGER NOT NULL DEFAULT 0)''')
    c.execute('INSERT OR IGNORE INTO gap_terminal_health(singleton,stream_id,coverage_start)VALUES(1,?,?)',(str(uuid4()),time.time()if now is None else now))
    c.execute('''CREATE TABLE IF NOT EXISTS gap_request_readers(tenant TEXT NOT NULL,rid TEXT NOT NULL,jid TEXT NOT NULL,conversation TEXT NOT NULL,cancelled INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(tenant,rid))''')
    c.execute('''CREATE TABLE IF NOT EXISTS gap_terminal_seen(tenant TEXT NOT NULL,rid TEXT NOT NULL,jid TEXT NOT NULL,
        revision INTEGER NOT NULL,queued_revision INTEGER NOT NULL,reason TEXT NOT NULL,reader_state TEXT NOT NULL,PRIMARY KEY(tenant,rid))''')
    c.execute('''CREATE TABLE IF NOT EXISTS gap_terminal_outbox(tenant TEXT NOT NULL,rid TEXT NOT NULL,jid TEXT NOT NULL,
        revision INTEGER NOT NULL,created REAL NOT NULL,reason TEXT NOT NULL,reader_state TEXT NOT NULL,body TEXT,sha256 TEXT,PRIMARY KEY(tenant,rid,revision))''')
    c.execute('CREATE INDEX IF NOT EXISTS gap_terminal_order ON gap_terminal_outbox(created,tenant,rid,revision)')
    aliases=' JOIN jobs j0 ON j0.id=r.jid '+''.join(' LEFT JOIN jobs j'+str(i)+' ON j'+str(i)+'.id=j'+str(i-1)+'.alias'for i in range(1,9))
    effective='coalesce('+','.join('j'+str(i)+'.id'for i in range(8,-1,-1))+')'
    reason=("CASE WHEN m.cancelled=1 OR k.cancelled=1 THEN 'CANCELED'WHEN new.state IN('CANCELLED','CANCELED')THEN 'CANCELED'WHEN coalesce("+field('template_gap')+",0)=1 THEN 'TEMPLATE_NOT_FOUND'ELSE "+CLASSIFY+" END").replace('new.','e.')
    readers=" LEFT JOIN gap_request_readers m ON m.tenant=r.tenant AND m.rid=r.rid AND m.jid=r.jid LEFT JOIN rt_job_refs f ON f.runtime_tenant=r.tenant AND f.jid=r.jid AND f.body_hash=r.body_hash LEFT JOIN reader_cursors k ON k.tenant=r.tenant AND k.jid=r.jid AND k.conversation=coalesce(m.conversation,'rt_'||replace(f.ref,'-',''))"
    reader_state="CASE WHEN m.cancelled=1 OR k.cancelled=1 THEN 'CANCELED'WHEN m.jid IS NOT NULL OR k.jid IS NOT NULL THEN 'OPEN'ELSE 'UNKNOWN'END"
    c.execute('CREATE VIEW IF NOT EXISTS gap_terminal_candidates_v1 AS SELECT r.tenant,r.rid,e.id AS jid,r.jid AS reader_jid,k.conversation AS reader_conversation,'+reader_state+' AS reader_state,coalesce((SELECT created FROM inbox_age a WHERE a.tenant=r.tenant AND a.rid=r.rid),e.updated)AS created,'+reason+' AS reason FROM inbox r'+aliases+' JOIN jobs e ON e.id='+effective+readers+" WHERE e.tenant=r.tenant AND e.alias IS NULL AND(e.state IN('READY','FAILED','CANCELLED','CANCELED')OR m.cancelled=1 OR k.cancelled=1)AND("+reason+')IS NOT NULL')
    def trigger(name,target,when,where):
        candidates='SELECT *FROM gap_terminal_candidates_v1 WHERE '+where
        c.execute('CREATE TRIGGER IF NOT EXISTS '+name+' '+target+' WHEN '+when+''' BEGIN
          INSERT INTO gap_terminal_seen(tenant,rid,jid,revision,queued_revision,reason,reader_state)
          SELECT tenant,rid,jid,1,0,reason,reader_state FROM ('''+candidates+''')WHERE true
          ON CONFLICT(tenant,rid)DO UPDATE SET jid=excluded.jid,revision=gap_terminal_seen.revision+1,reason=excluded.reason,reader_state=excluded.reader_state
          WHERE gap_terminal_seen.reason!=excluded.reason OR gap_terminal_seen.jid!=excluded.jid OR gap_terminal_seen.reader_state!=excluded.reader_state;
          INSERT OR IGNORE INTO gap_terminal_outbox(tenant,rid,jid,revision,created,reason,reader_state)
          SELECT s.tenant,s.rid,s.jid,s.revision,v.created,s.reason,s.reader_state FROM gap_terminal_seen s JOIN('''+candidates+''')v USING(tenant,rid)
          WHERE s.revision>s.queued_revision LIMIT max(0,'''+str(MAX_PENDING)+'''-(SELECT count(*)FROM gap_terminal_outbox));
          UPDATE gap_terminal_health SET dropped=dropped+(SELECT count(*)FROM gap_terminal_seen s JOIN('''+candidates+''')v USING(tenant,rid)
            WHERE s.revision>s.queued_revision AND NOT EXISTS(SELECT 1 FROM gap_terminal_outbox o WHERE o.tenant=s.tenant AND o.rid=s.rid AND o.revision=s.revision))WHERE singleton=1;
          UPDATE gap_terminal_seen SET queued_revision=revision WHERE(tenant,rid)IN(SELECT tenant,rid FROM('''+candidates+'''));
        END''')
    evidence='('+field('model_result.status')+'IS NOT NULL OR '+field('provider_error.http_status')+'IS NOT NULL OR coalesce('+field('template_gap')+',0)=1)'
    changed="new.state IN('READY','FAILED','CANCELLED','CANCELED')AND(old.state IS NOT new.state OR(old.result IS NOT new.result AND new.result IS NOT NULL AND "+evidence+'))'
    trigger('gap_terminal_capture_v1','AFTER UPDATE OF state,result,error ON jobs',changed,'jid=new.id')
    trigger('gap_inbox_capture_v1','AFTER INSERT ON inbox','true','tenant=new.tenant AND rid=new.rid')
    trigger('gap_inbox_move_v1','AFTER UPDATE OF jid ON inbox','old.jid IS NOT new.jid','tenant=new.tenant AND rid=new.rid')
    c.execute("CREATE TRIGGER IF NOT EXISTS gap_reader_latch_v1 BEFORE UPDATE OF cancelled ON reader_cursors WHEN old.cancelled=0 AND new.cancelled=1 BEGIN UPDATE gap_request_readers SET cancelled=1 WHERE tenant=new.tenant AND jid=new.jid AND conversation=new.conversation;END")
    trigger('gap_reader_capture_v1','AFTER UPDATE OF cancelled ON reader_cursors','old.cancelled IS NOT new.cancelled','tenant=new.tenant AND reader_jid=new.jid AND reader_conversation=new.conversation')
    trigger('gap_reader_attach_v1','AFTER INSERT ON reader_cursors','true','tenant=new.tenant AND reader_jid=new.jid AND reader_conversation=new.conversation')
    trigger('gap_reader_remap_v1','AFTER UPDATE ON gap_request_readers','true','tenant=new.tenant AND rid=new.rid')
    trigger('gap_reader_mapping_v1','AFTER INSERT ON gap_request_readers','true','tenant=new.tenant AND rid=new.rid')
    c.execute('''CREATE TRIGGER IF NOT EXISTS gap_receipt_clock_v1 AFTER INSERT ON inbox_age BEGIN
        UPDATE gap_terminal_outbox SET created=new.created WHERE tenant=new.tenant AND rid=new.rid;
    END''')

class TerminalStore:
    def __init__(self,path,key,runtime_version,*,cases=None,internal_test=False):
        if type(internal_test)is not bool:raise ValueError('Internal test provenance required')
        self.path=path;self.key=key;self.runtime_version=runtime_version;self.cases=cases;self.internal_test=internal_test
    @contextmanager
    def connection(self):
        c=sqlite3.connect(self.path,timeout=2);c.row_factory=sqlite3.Row
        try:
            c.execute('BEGIN IMMEDIATE');yield c;c.commit()
        except BaseException:c.rollback();raise
        finally:c.close()
    def initialize(self):
        with self.connection()as c:
            install(c)
            c.execute('DELETE FROM gap_request_readers WHERE(tenant,rid)IN(SELECT m.tenant,m.rid FROM gap_request_readers m WHERE NOT EXISTS(SELECT 1 FROM inbox r WHERE r.tenant=m.tenant AND r.rid=m.rid AND r.jid=m.jid)LIMIT 200)')
            c.execute('DELETE FROM gap_terminal_seen WHERE(tenant,rid)IN(SELECT s.tenant,s.rid FROM gap_terminal_seen s WHERE NOT EXISTS(SELECT 1 FROM jobs j WHERE j.id=s.jid)AND NOT EXISTS(SELECT 1 FROM gap_terminal_outbox o WHERE o.tenant=s.tenant AND o.rid=s.rid)LIMIT 200)')
    def pending(self,limit=16):
        if type(limit)is not int or not 1<=limit<=16:raise ValueError('OUTBOX_LIMIT')
        with self.connection()as c:
            # A transaction may refine FAILED with the validated provider result.
            # Publish its final committed revision, not an intermediate UPDATE.
            c.execute('DELETE FROM gap_terminal_outbox AS o WHERE EXISTS(SELECT 1 FROM gap_terminal_outbox n WHERE n.tenant=o.tenant AND n.rid=o.rid AND n.jid=o.jid AND n.revision>o.revision)')
            rows=c.execute('SELECT *FROM gap_terminal_outbox ORDER BY created,tenant,rid,revision LIMIT ?',(limit,)).fetchall();h=dict(c.execute('SELECT *FROM gap_terminal_health WHERE singleton=1').fetchone())
            events=[];marks=[]
            for row in rows:
                mark=(row['tenant'],row['rid'],row['revision'])
                if row['body']is not None:
                    try:
                        event=event_shape(json.loads(row['body']))
                        if hashlib.sha256(row['body'].encode()).hexdigest()!=row['sha256']:raise ValueError('OUTBOX_INTEGRITY')
                    except (ValueError,TypeError,KeyError,OverflowError):
                        c.execute('DELETE FROM gap_terminal_outbox WHERE tenant=?AND rid=?AND revision=?',mark)
                        c.execute('UPDATE gap_terminal_health SET dropped=dropped+1 WHERE singleton=1')
                        h['dropped']+=1
                        continue
                    events.append(event);marks.append(mark);continue
                unsupported=row['reason']=='TEMPLATE_NOT_FOUND'
                case=None
                if self.cases is not None:
                    with self.cases.connection()as raw:case=raw.execute('SELECT reason,catalog_hash FROM cases WHERE tenant=?AND jid=?',(row['tenant'],row['jid'])).fetchone()
                if row['reason']=='CANCELED'and not case:
                    marks.append((row['tenant'],row['rid'],row['revision']));continue
                classification='SEMANTIC_UNSUPPORTED'if unsupported else row['reason']
                event=make_event(self.key,row['tenant'],row['jid']+'\0'+row['rid'],row['created'],case['reason']if case else'MODEL_NO_TEMPLATE',case['catalog_hash']if case else'unknown',{'runtime_release':'unknown'},internal_test=self.internal_test)
                classification=event['reason_code']if case and(unsupported or row['reason']=='CANCELED')else classification
                outcome='CANCELED'if row['reason']=='CANCELED'else'NEEDS_CLARIFICATION'if unsupported and classification in {'NEEDS_CLARIFICATION','AMBIGUOUS_STORE_OR_PERIOD'}else'UNSUPPORTED'if unsupported and classification!='PARSER_OR_RUNTIME_BUG'else'FAILED'
                if row['reader_state']=='UNKNOWN'and row['reason']!='CANCELED':outcome='IN_PROGRESS'
                event.update(episode_revision=row['revision']*2,reason_code=classification,final_outcome=outcome,p1_status='MISS'if case or unsupported else'NOT_ATTEMPTED')
                event['event_id']=str(uuid5(NAMESPACE_URL,'alisa-terminal-event-v1:'+event['logical_query_id']+':'+str(row['revision'])))
                raw=canonical(event_shape(event))
                c.execute('UPDATE gap_terminal_outbox SET body=?,sha256=?WHERE tenant=?AND rid=?AND revision=?',(raw,hashlib.sha256(raw.encode()).hexdigest(),*mark))
                events.append(event);marks.append((row['tenant'],row['rid'],row['revision']))
            total=c.execute('SELECT count(*)FROM gap_terminal_outbox').fetchone()[0]
            oldest=c.execute('SELECT created FROM gap_terminal_outbox ORDER BY created,tenant,rid,revision LIMIT 1 OFFSET ?',(len(marks),)).fetchone()
        return {'events':events,'coverage':{'kind':'terminal_outcomes','stream_id':h['stream_id'],'coverage_start':h['coverage_start'],'dropped':h['dropped'],
            'pending_bytes':max(0,total-len(marks))*512,'oldest_pending_at':oldest[0]if oldest else None,'internal_test':self.internal_test}},marks
    def acknowledge(self,marks):
        with self.connection()as c:
            c.executemany('DELETE FROM gap_terminal_outbox WHERE tenant=?AND rid=?AND revision=?',marks)


def reader_state(c,tenant,rid,expected_jid=None):
    columns={r[1]for r in c.execute('PRAGMA table_info(inbox)')}
    if 'body_hash'not in columns:return 'UNKNOWN'
    names={r[0]for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not {'gap_request_readers','rt_job_refs','reader_cursors'}<=names:return 'UNKNOWN'
    row=c.execute("SELECT CASE WHEN m.cancelled=1 OR k.cancelled=1 THEN 1 ELSE 0 END FROM inbox r LEFT JOIN gap_request_readers m ON m.tenant=r.tenant AND m.rid=r.rid AND m.jid=r.jid LEFT JOIN rt_job_refs f ON f.runtime_tenant=r.tenant AND f.jid=r.jid AND f.body_hash=r.body_hash LEFT JOIN reader_cursors k ON k.tenant=r.tenant AND k.jid=r.jid AND k.conversation=coalesce(m.conversation,'rt_'||replace(f.ref,'-','')) WHERE r.tenant=?AND r.rid=?AND(?IS NULL OR r.jid=?)AND(m.jid IS NOT NULL OR k.jid IS NOT NULL)",(tenant,rid,expected_jid,expected_jid)).fetchone()
    return 'UNKNOWN'if row is None else'CANCELED'if row[0]else'OPEN'

def remember_reader(c,repo,tenant,rid,jid):
    # No historical inference: remember only a newly accepted named/legacy reader.
    if c.execute("SELECT 1 FROM sqlite_master WHERE type='table'AND name='gap_request_readers'").fetchone():
        from reader_state import key
        c.execute('INSERT INTO gap_request_readers(tenant,rid,jid,conversation)VALUES(?,?,?,?)ON CONFLICT(tenant,rid)DO UPDATE SET jid=excluded.jid,conversation=excluded.conversation,cancelled=0',(tenant,rid,jid,key(repo,tenant)))
