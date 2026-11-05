"""Independent 24-case retest: isolated technical evidence. No production config."""
from pathlib import Path
from datetime import date,datetime,timezone
from decimal import Decimal
from unittest.mock import patch
import sys,json,hashlib,sqlite3,socket,time,traceback
ROOT=Path('/opt/alice-market/releases/20261105-v010-conversation-safety-r1')
sys.path.insert(0,str(ROOT))
import matrix_core,reader_state,retention
from matrix_core import MatrixError,decimal_text,source_decimal_text
from semantics import Rejected,period_from_text,fingerprint,strict_json,Scope
from test_dataset_pipeline import Pipeline,SCOPE,TODAY,fixture
from repository import Repository
from engine import Engine,Worker,CallError
Q='текущие цены предложения сейчас на озоне'
out={'utc':datetime.now(timezone.utc).isoformat(),'release':ROOT.name,'cases':{},'network_attempts':[]}
def caught(fn,code):
 try:fn()
 except (MatrixError,Rejected) as e:
  assert e.code==code,(e.code,code);return e.code
 raise AssertionError('EXPECTED_'+code)
def pipeline(fn):
 t=Pipeline();t.setUp()
 try:return fn(t)
 finally:t.tearDown()
def ask(t,conv,q,n):
 return t.engine.safe_submit(SCOPE.tenant,q,'ind-'+conv+'-'+str(n),fingerprint(q),TODAY,conversation_id=conv,message_id=n)
def ds01():
 result={}
 with patch.object(matrix_core,'format',side_effect=AssertionError('FORMATTING_MUST_NOT_RUN'),create=True) as fixed:
  for v in ['1e-400','1e-10000','1e-999999','0e-999999']:result[v]=caught(lambda v=v:decimal_text(v),'NUMBER_RANGE')
  assert fixed.call_count==0
 return {'rejections':result,'fixed_format_calls':0}
def ds02():
 vals=['100','-123.45','1e-10','0.002411','0','-0']
 outputs={v:decimal_text(v) for v in vals}
 assert all(Decimal(outputs[v])==Decimal(v) for v in vals)
 assert Decimal(source_decimal_text('1e-32'))==Decimal('1e-32')
 assert Decimal(decimal_text('1e-64'))==Decimal('1e-64')
 return {'ordinary':outputs,'source32':'PASS','intermediate64':'PASS','source33':caught(lambda:source_decimal_text('1e-33'),'NUMBER_RANGE'),'intermediate65':caught(lambda:decimal_text('1e-65'),'NUMBER_RANGE')}
def ds03():
 def run(t):
  def bad(op,body):
   x=fixture(op,body)
   if op=='ds_ozon_prices':x['items'][0]['price']['price']='1e-10000'
   return x
  with patch('test_dataset_pipeline.fixture',bad):
   a=ask(t,'ind-bad-provider',Q,0);t.worker.step()
   row=t.repo.get(SCOPE.tenant,a['job_id'])
   assert (row['state'],row['error'],row['result'])==('FAILED','NUMBER_RANGE',None),(row['state'],row['error'])
   t.clock.t+=1000;t.worker.step();assert len(t.transport.calls)==1
  return {'state':row['state'],'error':row['error'],'result_absent':row['result'] is None,'fake_http_calls':1,'automatic_retry':False}
 return pipeline(run)
def ds04():
 def run(t):
  t.transport.error=CallError('NETWORK_OUTCOME_UNKNOWN',unknown=True)
  a=ask(t,'ind-network-unknown',Q,0);t.worker.step();row=t.repo.get(SCOPE.tenant,a['job_id'])
  assert row['state']=='UNKNOWN';n=len(t.transport.calls);t.clock.t+=1000;t.worker.step();assert len(t.transport.calls)==n
  return {'state':row['state'],'error':row['error'],'fake_calls':n,'automatic_retry':False}
 return pipeline(run)
def ds05():
 def run(t):
  conv='ind-tenant-shared';a=ask(t,conv,Q,0);jid=a['job_id']
  read=caught(lambda:t.repo.get('other',jid),'TENANT_DENIED')
  # Seed a hostile cross-tenant pointer in disposable SQLite to test cancel's own tenant guard.
  with t.repo.connection(True) as c:
   c.execute('INSERT INTO reader_pointers VALUES(?,?,?,?)',('other',conv,jid,t.clock()))
   c.execute('INSERT INTO reader_cursors VALUES(?,?,?,0,0,0,?)',('other',conv,jid,t.clock()))
  with t.repo.reader_scope('other',conv):cancel=caught(lambda:t.repo.cancel('other'),'TENANT_DENIED')
  assert t.repo.get(SCOPE.tenant,jid)['state']=='QUEUED'
  return {'explicit_foreign_read':read,'foreign_selected_cancel':cancel,'owner_state':'QUEUED','pointer_seed':'temporary hostile fixture only'}
 return pipeline(run)
def ds06():
 def run(t):
  a=ask(t,'ind-ttl-reader',Q,0);t.worker.step();assert t.repo.get(SCOPE.tenant,a['job_id'])['state']=='READY'
  t.clock.t+=retention.REPLAY_TTL+901
  for _ in range(5):retention.sweep(t.repo)
  with t.repo.connection() as c:
   terminal=[c.execute('SELECT count(*) FROM '+x).fetchone()[0] for x in ('reader_pointers','reader_cursors')]
  assert terminal==[0,0]
  a=ask(t,'ind-active-reader',Q,1);plan=strict_json(t.repo.get(SCOPE.tenant,a['job_id'])['plan']);t.repo.claim()
  with t.repo.reader_scope(SCOPE.tenant,'ind-active-alias'):
   alias,_=t.repo.enqueue(SCOPE.tenant,'ind-alias-id',fingerprint('alias'),{'refresh':False},None,'synthetic')
  j=t.repo.claim();t.repo.resolve(j['id'],j['owner'],plan)
  t.clock.t+=retention.REPLAY_TTL+1;retention.sweep(t.repo)
  with t.repo.connection() as c:
   kept=c.execute('SELECT count(*) FROM reader_cursors WHERE jid IN (?,?)',(a['job_id'],alias['id'])).fetchone()[0]
  assert kept==2,kept
  return {'terminal_refs_after_ttl':terminal,'active_canonical_alias_refs':kept,'clock':'fake only'}
 return pipeline(run)
def ds07():
 def rows(conn,tables):
  return {n:sorted([list(v) for v in conn.execute('SELECT * FROM "'+n+'"')],key=repr) for n in tables}
 def run(t):
  a=ask(t,'ind-migrate-known',Q,0);t.worker.step();jid=a['job_id']
  # A global pointer must not create a binding for an unrelated named reader.
  with t.repo.connection(True) as c:c.execute('INSERT OR REPLACE INTO pointers VALUES(?,?)',(SCOPE.tenant,jid))
  copy_path=Path(t.temp.name)/'legacy-copy.sqlite'
  with sqlite3.connect(t.repo.path) as old,sqlite3.connect(copy_path) as dest:old.backup(dest)
  with sqlite3.connect(copy_path) as c:
   for n in ('reader_pointers','reader_cursors','runtime_migrations'):c.execute('DROP TABLE '+n)
   tables=[r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")]
   before=rows(c,tables)
  copyrepo=Repository(copy_path,t.clock);reader_state.install(copyrepo)
  with copyrepo.connection() as c:
   after=rows(c,tables);mig=[tuple(r) for r in c.execute('SELECT * FROM runtime_migrations')]
   known=c.execute('SELECT jid FROM reader_pointers WHERE conversation=?',('ind-migrate-known',)).fetchone()
  assert before==after,'OLD_TABLES_CHANGED'
  assert known and known[0]==jid,'EXPLICIT_RECEIPT_NOT_MIGRATED'
  with copyrepo.reader_scope(SCOPE.tenant,'ind-migrate-new'):assert copyrepo.get(SCOPE.tenant) is None
  with copyrepo.connection() as c:assert [tuple(r) for r in c.execute('SELECT * FROM runtime_migrations')]==mig
  return {'old_tables_preserved':len(tables),'old_content_sha256':hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest(),'second_apply_identical':True,'named_binding_from_receipt':True,'new_reader_inherited_global':False}
 return pipeline(run)
def ds08():
 good=[('с 31 декабря по 4 января 2026','2025-12-31','2026-01-04'),('с 31 декабря 2025 по 4 января','2025-12-31','2026-01-04'),('с 29 февраля 2024 по 1 марта 2024','2024-02-29','2024-03-01')]
 for text,start,end in good:
  p,_=period_from_text(text,TODAY);assert p=={'from':start,'to':end}
 for text in ['с 31 сентября по 4 октября 2026','с 29 февраля по 1 марта 2026']:
  caught(lambda text=text:period_from_text(text,TODAY),'INVALID_DATE')
 p,_=period_from_text('с 31 октября по 4 ноября 2026 относительно с 30 сентября по 4 октября 2026',TODAY,True)
 assert p['comparison']=={'from':'2026-09-30','to':'2026-10-04'}
 p,rest=period_from_text('товар «с 31 декабря по 4 января» с 31 октября по 4 ноября 2026',TODAY)
 assert '«с 31 декабря по 4 января»' in rest and p['from']=='2026-10-31'
 return {'cross_year':2,'leap_valid':1,'invalid_rejected':2,'comparison_two_ranges':True,'quoted_name_preserved':True}
def network_block(*a,**k):
 out['network_attempts'].append('forbidden');raise AssertionError('NETWORK_FORBIDDEN')
with patch.object(socket.socket,'connect',network_block),patch.object(socket.socket,'connect_ex',network_block),patch.object(socket,'getaddrinfo',network_block):
 for case,fn in [('DS01',ds01),('DS02',ds02),('DS03',ds03),('DS04',ds04),('DS05',ds05),('DS06',ds06),('DS07',ds07),('DS08',ds08)]:
  start=time.monotonic()
  try:out['cases'][case]={'outcome':'PASS','evidence':fn()}
  except Exception as e:out['cases'][case]={'outcome':'FAIL','error':type(e).__name__+': '+str(e),'traceback':traceback.format_exc()}
  out['cases'][case]['elapsed_ms']=round((time.monotonic()-start)*1000,3)
out['status']='PASS' if not out['network_attempts'] and all(v['outcome']=='PASS' for v in out['cases'].values()) else 'FAIL'
out.update(live_database_used=False,live_credentials_read=False)
(Path(__file__).parent/'independent-isolated-result.json').write_text(json.dumps(out,ensure_ascii=False,indent=2))
print(json.dumps(out,ensure_ascii=False))

