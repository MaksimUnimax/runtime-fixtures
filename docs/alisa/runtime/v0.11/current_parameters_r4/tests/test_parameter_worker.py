from pathlib import Path
from datetime import datetime,date,timezone
from dataclasses import replace
from copy import deepcopy
from unittest.mock import patch
import unittest,tempfile,json,csv,io,subprocess,socket
from engine import Engine,Worker,CallError
from repository import Repository
from semantics import fingerprint,strict_json,canonical_json,Rejected
from model_answer import Settings
from protected_reads import ProtectedPayload
from test_runtime import SCOPE,Clock
from test_template_only import selection,Transport as BaseTransport
import parameter_source_runtime as ps
from parameter_support import parameter_producers as pp

PERIOD={'from':'2026-10-01','to':'2026-10-31'}
TODAY=date(2026,11,14)
NODE='/root/alisa-owner-toolchain/node-v24.22.1-linux-x64/bin/node'

class Transport(BaseTransport):
 def __init__(self):
  super().__init__();self.selection=selection(['parameter.loss_rate.v1'],inputs={'period':PERIOD});self.codes={};self.polls={};self.pending_once=True;self.repeat_cursor=False;self.empty_middle=False;self.missing_column=False;self.outside=False;self.fail_once=None
 def execute(self,request,store):
  if not request.operation.startswith('read.'):return super().execute(request,store)
  self.calls.append(request)
  if self.on_call:self.on_call(request)
  op=request.operation.removeprefix('read.ozon.');v=request.body['params']
  if self.fail_once==op:self.fail_once=None;raise CallError('HTTP_429',status=429,retry_at=0)
  if op=='report_postings_create':
   code='REPORT-'+str(len(self.codes)+1);self.codes[code]=v['filter'];result={'result':{'code':code}}
  elif op=='report_info':
   code=v['code'];self.polls[code]=self.polls.get(code,0)+1
   result={'result':{'status':'processing'}}if self.pending_once and self.polls[code]==1 else{'result':{'status':'success','file':'https://ir.ozone.ru/'+code+'.csv'}}
  elif op=='report_file_get':
   resource=request.body['resolved_resource'];code=resource.rsplit('/',1)[-1].removesuffix('.csv');f=self.codes[code]
   head=['Номер отправления','SKU','Принят в обработку','Количество','Статус','Адрес покупателя']
   if self.missing_column:head.remove('Количество')
   rows=[head]
   if f['delivery_schema']==['fbo']:
    rows += [['ORDER-PRIVATE-ONE','10','2026-10-02 10:00:00','2','Отменён','PRIVATE BUYER ADDRESS'],
             ['ORDER-PRIVATE-TWO','11','2026-10-03 10:00:00','3','Доставлен','PRIVATE BUYER ADDRESS'],
             ['ORDER-PRIVATE-THREE','10','2026-10-04 10:00:00','1','Доставляется','PRIVATE BUYER ADDRESS']]
   if self.missing_column:
    for raw in rows[1:]:raw.pop(3)
   output=io.StringIO();csv.writer(output,delimiter=';').writerows(rows)
   result=ProtectedPayload({'document_received':True},output.getvalue().encode('utf-8-sig'),'text/csv')
  elif op=='returns_list':
   def item(i,post,sku,example,typ='Cancellation'):
    return {'id':i,'posting_number':post,'schema':'Fbo','type':typ,'product':{'sku':sku,'quantity':1},'exemplars':[{'exemplar_id':example}],'customer':{'name':'PRIVATE BUYER NAME'}}
   if not v['last_id']:result={'returns':[item(1,'ORDER-PRIVATE-ONE',10,101)],'has_next':True}
   else:
    result={'returns':[item(1 if self.repeat_cursor else 2,'ORDER-PRIVATE-TWO',11,201,'ClientReturn')],'has_next':self.repeat_cursor}
    if self.outside:result['returns'].append(item(3,'OLDER-PRIVATE',99,301))
    if self.empty_middle:result={'returns':[],'has_next':True}
  elif op in('posting_fbo_get','posting_fbs_get'):result={'result':{'posting_number':'OLDER-PRIVATE','in_process_at':'2025-01-01T00:00:00Z','products':[{'sku':99}]}}
  elif op=='finance_balance':result={'cashflows':{'services':[{'name':'logistics','amount':{'value':'-90','currency_code':'RUB'}},{'name':'courier_client_reinvoice','amount':{'value':'-20','currency_code':'RUB'}},{'name':'delivery_to_handover_place_by_ozon','amount':{'value':'-10','currency_code':'RUB'}},{'name':'reverse_logistics','amount':{'value':'-999','currency_code':'RUB'}}]}}
  else:raise AssertionError('UNEXPECTED_OPERATION '+op)
  return result,{'status':200,'bytes':100,'elapsed_ms':1}

class Fixture:
 def setup(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.clock=Clock();self.clock.now=datetime(2026,11,14,6,tzinfo=timezone.utc).timestamp();self.scope=SCOPE
  self.settings=Settings(self.root/'answer.json');self.repo=Repository(self.root/'state.sqlite3',self.clock)
  self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=self.settings,template_mode=True);self.engine.parameter_source_policy={'enabled':True,'pin':ps.PIN}
  self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.seq=0
  original=subprocess.run
  def node(command,*a,**kw):
   if type(command)is list and command[0]=='/usr/local/bin/node':command=[NODE,*command[1:]]
   return original(command,*a,**kw)
  self.node=patch('subprocess.run',node);self.node.start()
 def close(self):self.node.stop();self.temp.cleanup()
 def ask(self,request='r1'):
  self.seq+=1;q='Рассчитай коэффициент потерь на Озоне за октябрь без сохранения'
  return self.engine.safe_submit('A',q,request,fingerprint(q),TODAY,conversation_id='parameter-runtime-tests',message_id=self.seq)
 def finish(self,a,steps=100):
  self.assertIn('job_id',a,a)
  for _ in range(steps):
   row=self.repo.get('A',a['job_id'])
   if row['state']not in('RUNNING','QUEUED'):return row
   self.clock.advance(max(1,row['due']-self.clock()+1));self.worker.step()
  self.fail('test workflow did not finish')
 def data(self,row):
  prog=strict_json(row['progress'])if row['progress']else{}
  # The final-answer stage keeps its typed context until normal job expiry.
  result=strict_json(row['result']);return result,prog

class Runtime(Fixture,unittest.TestCase):
 def setUp(self):self.setup()
 def tearDown(self):self.close()
 def test_actual_selector_worker_source_collection_answer(self):
  r=self.finish(self.ask());self.assertEqual(r['state'],'READY',r['error']);self.assertIsNone(r['error'])
  calls=[x.operation for x in self.transport.calls];self.assertEqual(calls.count('template_select'),1);self.assertEqual(calls.count('model_answer'),1);self.assertNotIn('deepseek_read_plan',calls)
  self.assertEqual(calls.count('read.ozon.report_postings_create'),2);self.assertEqual(calls.count('read.ozon.returns_list'),2)
  with self.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
 def test_missing_producer_enablement_no_data_calls(self):
  del self.engine.parameter_source_policy;r=self.finish(self.ask());self.assertTrue(r['error']);self.assertFalse(any(x.store_id for x in self.transport.calls))
 def test_staged_result_exact_loss_and_pending(self):
  r=self.finish(self.ask());self.assertIsNone(r['error']);a=next(x for x in self.transport.calls if x.operation=='model_answer')
  payload=canonical_json(a.body);self.assertIn('0.5',payload);self.assertIn('pending_units',payload);self.assertNotIn('PRIVATE BUYER',payload);self.assertNotIn('ORDER-PRIVATE',payload)
 def test_delivery_reuses_registered_components(self):
  self.transport.selection=selection(['parameter.delivery_mean.v1'],inputs={'period':PERIOD});r=self.finish(self.ask());self.assertIsNone(r['error']);a=next(x for x in self.transport.calls if x.operation=='model_answer');ctx=json.loads(a.body['messages'][-1]['content'].split('\n',1)[1]);self.assertEqual(ctx['parameter_context'][0]['result']['value'],'20')
 def test_no_plaintext_orders_or_personal_fields_in_job(self):
  a=self.ask();r=self.finish(a);self.assertIsNone(r['error'])
  with self.repo.connection()as c:
   for table in('jobs','calls'):
    for row in c.execute('SELECT *FROM '+table):self.assertNotIn('PRIVATE',str(tuple(row)))
 def test_checkpoint_survives_new_worker_same_job(self):
  a=self.ask();self.worker.step();self.clock.advance(1);self.worker.step();before=len(self.transport.calls)
  self.worker=Worker(self.engine,self.transport);r=self.finish(a);self.assertIsNone(r['error']);self.assertGreater(len(self.transport.calls),before);self.assertEqual(sum(c.operation=='template_select'for c in self.transport.calls),1)
 def test_no_duplicate_create_when_restarting_after_received(self):
  a=self.ask()
  for _ in range(12):
   row=self.repo.get('A',a['job_id']);self.clock.advance(max(1,row['due']-self.clock()+1));self.worker.step()
   if any(c.operation=='read.ozon.report_postings_create'for c in self.transport.calls):break
  self.worker=Worker(self.engine,self.transport);r=self.finish(a);self.assertIsNone(r['error']);self.assertEqual(sum(c.operation=='read.ozon.report_postings_create'for c in self.transport.calls),2)
 def test_received_poll_resumes_without_recreating_report(self):
  r=self.finish(self.ask());self.assertIsNone(r['error']);self.assertEqual(len(self.transport.codes),2);self.assertTrue(all(n==2 for n in self.transport.polls.values()))
 def test_shared_429_policy_not_local_retry(self):
  self.transport.fail_once='returns_list';r=self.finish(self.ask());self.assertIsNone(r['error']);self.assertEqual(sum(c.operation=='read.ozon.returns_list'for c in self.transport.calls),3)
 def test_repeat_cursor_refused(self):
  self.transport.repeat_cursor=True;r=self.finish(self.ask());self.assertEqual(r['state'],'FAILED');self.assertEqual(r['error'],'PARAMETER_CURSOR_NO_PROGRESS')
 def test_empty_nonterminal_page_not_success(self):
  self.transport.empty_middle=True;r=self.finish(self.ask());self.assertEqual(r['state'],'FAILED');self.assertEqual(r['error'],'PARAMETER_CURSOR_EMPTY')
 def test_boundary_lookup_is_real_registered_step(self):
  self.transport.outside=True;r=self.finish(self.ask());self.assertIsNone(r['error']);self.assertEqual(sum(c.operation=='read.ozon.posting_fbo_get'for c in self.transport.calls),1)
 def test_missing_csv_column_never_invents_zero(self):
  self.transport.missing_column=True;r=self.finish(self.ask());self.assertEqual(r['state'],'FAILED');self.assertEqual(r['error'],'PARAMETER_DOCUMENT_COLUMNS')
 def test_read_scope_revoked_before_source_no_calls(self):
  a=self.ask();self.worker.step();self.scope=replace(self.scope,revision='revoked');r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertFalse(any(c.store_id for c in self.transport.calls))
 def test_scope_revoked_during_response_discarded(self):
  def revoke(request):
   if request.operation=='read.ozon.returns_list':self.scope=replace(self.scope,revision='revoked')
  self.transport.on_call=revoke;r=self.finish(self.ask());self.assertEqual(r['state'],'FAILED');self.assertNotIn('model_answer',[c.operation for c in self.transport.calls])
 def test_model_cannot_grant_write(self):
  self.transport.selection=selection(['parameter.loss_rate.v1'],inputs={'period':PERIOD,'parameter_mode':'replace_calculated'});r=self.finish(self.ask());self.assertTrue(r['error']);self.assertFalse(any(c.store_id for c in self.transport.calls))
 def test_unsigned_file_url_not_accepted(self):
  from protected_reads import validate_url
  with self.assertRaises(Rejected):validate_url('https://evil.invalid/report.csv')
 def test_current_job_source_artifacts_cleared_on_completion(self):
  r=self.finish(self.ask());self.assertIsNone(r['error'])
  with self.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM read_payloads').fetchone()[0],0)
 def test_compile_is_pure_and_source_plan_pinned(self):
  a=self.ask();self.worker.step();r=self.repo.get('A',a['job_id']);p=strict_json(r['plan']);self.assertEqual([c.operation for c in self.transport.calls],['template_select']);self.assertTrue(self.engine.authorized(p))
  f=p['fragments'][0]['plan'];f['parameter_source']['collection']['steps'][0]['operation']='seller_info';self.assertFalse(ps.authorized(self.engine,f))
 def test_final_answer_failure_does_not_repeat_collection(self):
  a=self.ask()
  for _ in range(100):
   r=self.repo.get('A',a['job_id']);prog=strict_json(r['progress'])if r['progress']else{}
   if '_answer_pending'in prog:break
   self.clock.advance(max(1,r['due']-self.clock()+1));self.worker.step()
  count=sum(bool(c.store_id)for c in self.transport.calls);self.transport.network_failure=CallError('HTTP_503',status=503);r=self.finish(a);self.assertIsNone(r['error']);self.assertEqual(sum(bool(c.store_id)for c in self.transport.calls),count)


class ConfigurationTests(unittest.TestCase):
 def read_config(self,policy=None):
  from runtime import Configuration
  with tempfile.TemporaryDirectory()as tmp:
   path=Path(tmp)/'config.json';data={'execution_enabled':False,'accounts':{},'credential_bindings':{},'qualifications':{}}
   if policy is not None:data['parameter_sources']=policy
   path.write_text(json.dumps(data));return Configuration(path).read()
 def test_runtime_config_default_does_not_enable_collection(self):
  self.assertNotIn('parameter_sources',self.read_config())
 def test_runtime_config_accepts_only_exact_qualified_pin(self):
  self.assertEqual(self.read_config({'enabled':True,'pin':ps.PIN})['parameter_sources']['pin'],ps.PIN)
  with self.assertRaises(Rejected):self.read_config({'enabled':True,'pin':'wrong'})
 def test_runtime_config_integer_not_a_boolean_permission(self):
  with self.assertRaises(Rejected):self.read_config({'enabled':1,'pin':ps.PIN})
 def test_existing_template_definitions_preserved(self):
  import template_catalog,hashlib
  expected=json.loads((Path(__file__).resolve().parents[1]/'BASELINE_TEMPLATE_HASHES.json').read_text())
  for key,digest in expected.items():
   value=json.dumps(template_catalog.TEMPLATES[key],ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
   self.assertEqual(hashlib.sha256(value).hexdigest(),digest,key)
  self.assertEqual(set(template_catalog.TEMPLATES)-set(expected),{'parameter.loss_rate.v1','parameter.delivery_mean.v1'})
 def test_missing_policy_is_disabled(self):
  class E:pass
  self.assertFalse(ps.enabled(E()))
 def test_policy_requires_exact_release_pin(self):
  class E:parameter_source_policy={'enabled':True,'pin':'unverified'}
  self.assertFalse(ps.enabled(E()))
 def test_policy_is_read_again_for_revocation(self):
  current={'enabled':True,'pin':ps.PIN}
  class E:parameter_source_policy=staticmethod(lambda:current)
  self.assertTrue(ps.enabled(E()));current.clear();current.update(enabled=False);self.assertFalse(ps.enabled(E()))

if __name__=='__main__':unittest.main()
