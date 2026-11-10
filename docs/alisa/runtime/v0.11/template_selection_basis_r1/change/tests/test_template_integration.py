from pathlib import Path
from dataclasses import asdict,replace
from copy import deepcopy
from datetime import date
from unittest.mock import patch
import json,unittest,tempfile
import template_catalog as tc
from template_gaps import GapStore
from template_runtime import HASH,MODE,SCHEMA,TEXT
from engine import Engine,Worker
from repository import Repository
from model_answer import Settings
from semantics import strict_json,fingerprint,Rejected
from test_runtime import Clock,SCOPE,TODAY
from test_template_only import Transport,selection,INPUT
from test_runtime_port_r01_contract import Setup
import dataset_pipeline as dp
import table_analytics as ta

def dataset_caps(scope=SCOPE):
 return {s.id:{op:{'status':'READ_ONLY_CANARY','dataset_source_hash':dp.SOURCES.hash,'dataset_query_hash':dp.HASH,'evidence_ref':'synthetic-only',**spec['proof_requirements']}for op,spec in dp.SOURCES.sources.items()if spec['platform']==s.platform}for s in scope.stores}
def table_caps(scope=SCOPE):
 return {s.id:{op:{'status':'READ_ONLY_CANARY','table_hash':ta.HASH,'evidence_ref':'synthetic-only',**spec['proof_requirements']}for op,spec in ta.OPERATIONS.items()if spec['platform']==s.platform}for s in scope.stores}

class AllTemplates(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.repo=Repository(Path(self.tmp.name)/'state.sqlite3',Clock());self.engine=Engine(self.repo,lambda _:SCOPE,template_mode=True,dataset_capabilities=dataset_caps,table_capabilities=table_caps)
 def tearDown(self):self.tmp.cleanup()
 def root(self,q):return {'schema':SCHEMA,'tenant':'A','access_revision':SCOPE.revision,'stores':[asdict(s)for s in SCOPE.stores],'question':q,'calendar_date':TODAY.isoformat(),'timezone':'Europe/Moscow','template_execution':{'catalog_hash':HASH,'mode':MODE},'selection_verified':False,'fragments':[]}
 def test_all_85_compile_without_speech_or_network(self):
  for tid,t in tc.TEMPLATES.items():
   with self.subTest(tid=tid):
    store=next((s for s in SCOPE.stores if not t['platforms']or s.platform in t['platforms']))
    values=deepcopy(INPUT)
    if t['input_policy']['snapshot']:values['period']=None
    root=self.root(t['purpose'])
    fragments=tc.compile_selection(self.engine,root,selection([tid],store.id,values));self.assertTrue(fragments)
 def test_unknown_source_override_cannot_publish(self):
  t=tc.TEMPLATES['B01.ordered_units'];old=deepcopy(t['steps'])
  try:
   t['steps'][0]['operation']='any_arbitrary_api'
   with self.assertRaises(ValueError):tc.validate_catalog()
  finally:t['steps']=old
 def test_nested_formula_has_named_template_dependency(self):self.assertTrue(any(s.get('template')=='finance_storage_logistics'for s in tc.TEMPLATES['finance_storage_logistics_share']['steps']))
 def test_selected_order_and_financial_metrics_remain_separate_outputs(self):
  f=tc.compile_selection(self.engine,self.root('Количество заказов и продажи до удержаний'),selection(['B01.ordered_units','B08.finance_sales']))
  self.assertEqual(len(f),1)
  self.assertEqual(set(f[0]['plan']['metrics']),{'ordered_units','finance_sales'})
  self.assertEqual(len(f[0]['plan']['program']['outputs']),2)
 def test_mixed_scalar_dataset_plan(self):
  v=selection(['B01.ordered_units','product_registry']);v['invocations'][1]['input']['period']=None
  f=tc.compile_selection(self.engine,self.root('Заказы и справочник товаров'),v);self.assertEqual({x['kind']for x in f},{'scalar','dataset'})

class MixedExecution(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.clock=Clock();self.repo=Repository(self.root/'state.sqlite3',self.clock);self.engine=Engine(self.repo,lambda _:SCOPE,template_mode=True,answer_settings=Settings(self.root/'settings.json'),dataset_capabilities=dataset_caps,table_capabilities=table_caps);self.transport=Transport();self.worker=Worker(self.engine,self.transport)
 def tearDown(self):self.tmp.cleanup()
 def run_request(self,q):
  a=self.engine.safe_submit('A',q,'request',fingerprint(q),TODAY,conversation_id='mixed-session',message_id=0)
  for _ in range(120):
   r=self.repo.get('A',a['job_id'])
   if r['state']not in('QUEUED','RUNNING'):return r
   self.clock.advance(max(0,r['due']-self.clock())+1);self.worker.step()
  self.fail('unfinished')
 def test_scalar_plus_dataset_same_job_full_api_data(self):
  self.transport.selection=selection(['B01.ordered_units','product_registry']);self.transport.selection['invocations'][1]['input']['period']=None
  r=self.run_request('Количество заказанных товаров и справочник товаров');self.assertEqual(r['state'],'READY',r['error']);self.assertIsNone(r['error']);ops=[x.operation for x in self.transport.calls];self.assertEqual(ops,['template_select','ozon_orders','ds_ozon_products','model_answer'])
  body=self.transport.calls[-1].body['messages'][-1]['content'];self.assertIn('ozon_orders',body);self.assertIn('ds_ozon_products',body)
 def test_financial_template_executes_natural_question_with_two_model_calls(self):
  self.transport.selection=selection(['B08.finance_sales'])
  execute=self.transport.execute
  def finance(request,store):
   if request.operation!='ozon_finance':return execute(request,store)
   self.transport.calls.append(request)
   money=lambda n:{'currency_code':'RUB','value':n}
   return {'cashflows':{'sales':{'amount':money('1000'),'fee':money('-200')},'returns':{'amount':money('0'),'fee':money('0')},'services':[]},'total':{'accrued':money('800'),'opening_balance':money('0'),'closing_balance':money('800'),'payments':[]}}, {'status':200}
  self.transport.execute=finance
  r=self.run_request('Сколько составили продажи Озона до удержаний за вчера?')
  self.assertEqual(r['state'],'READY',r['error']);self.assertIsNone(r['error'])
  self.assertEqual([x.operation for x in self.transport.calls],['template_select','ozon_finance','model_answer'])
  self.assertEqual(strict_json(r['result'])['data']['templates'][0]['data'][0]['values']['finance_sales'],'1000')
  self.assertIn('ozon_finance',self.transport.calls[-1].body['messages'][-1]['content'])
 def test_dataset_per_day_workflow_all_dates(self):
  self.transport.selection=selection(['accrual_days'],inputs={**deepcopy(INPUT),'period':{'from':'2026-11-01','to':'2026-11-02'}})
  r=self.run_request('Начисления по дням');self.assertEqual(r['state'],'READY',r['error']);self.assertIsNone(r['error']);calls=[x for x in self.transport.calls if x.operation=='ds_ozon_accrual_rows'];self.assertEqual([x.body['date']for x in calls],['2026-11-01','2026-11-02'])
 def test_wb_orders_preserve_qualified_source(self):
  self.transport.selection=selection(['SUMMARY.43'],'wb1');r=self.run_request('Сводка заказов WB за вчера');self.assertEqual(r['state'],'READY',r['error']);self.assertIsNone(r['error']);self.assertIn('wb_orders',[x.operation for x in self.transport.calls])
 def test_corrupt_encrypted_evidence_is_not_returned(self):
  self.transport.selection={'action':'unsupported','reason':'not-covered','missing':['x'],'reply':TEXT};r=self.run_request('Неизвестный показатель');case=strict_json(r['result'])['model_result']['case_id'];store=GapStore(self.root/'template-gaps.sqlite3')
  with store.connection()as c:c.execute('UPDATE cases SET payload=?WHERE id=?',(b'bad',case))
  with self.assertRaises(Rejected):store.get('A',case)

class GuardedPilot(Setup):
 def setUp(self):
  super().setUp();self.engine.template_mode=True;self.engine.answer_settings=Settings(self.root/'answer.json');self.repo.answer_settings=self.engine.answer_settings;self.transport=Transport();self.worker=Worker(self.engine,self.transport)
 def test_port_executes_templates_without_legacy_scope(self):
  def denied(_):raise AssertionError('legacy scope used')
  self.engine.scope_for=denied
  _,r=self.submit();value=self.finish(r);self.assertEqual(value['pages'],[self.transport.answer]);self.assertEqual([c.operation for c in self.transport.calls],['template_select','ozon_orders','model_answer'])
 def test_port_missing_template_returns_exact_text_and_model_result(self):
  self.transport.selection={'action':'unsupported','reason':'missing','missing':['x'],'reply':TEXT};_,r=self.submit('Неизвестный показатель');value=self.finish(r);self.assertEqual(value['pages'],[TEXT]);self.assertEqual(value['model_result']['status'],'TEMPLATE_NOT_FOUND');self.assertEqual(sum(bool(c.store_id)for c in self.transport.calls),0)
 def test_port_revocation_after_selection_stops_next_call(self):
  _,r=self.submit();self.worker.step();self.auth.revoked=True;self.clock.advance(2);self.worker.step()
  with self.repo.connection()as c:row=c.execute('SELECT state FROM jobs WHERE id=?',(self.inner_id(r),)).fetchone()
  self.assertEqual(row['state'],'FAILED');self.assertEqual(len(self.transport.calls),1)
 def test_port_ticket_never_in_gap_archive(self):
  self.transport.selection={'action':'unsupported','reason':'missing','missing':['x'],'reply':TEXT};_,r=self.submit('Неизвестно');value=self.finish(r);store=GapStore(self.root/'template-gaps.sqlite3');archive=store.get('A',value['model_result']['case_id']);self.assertNotIn(self.ctx['execution_ticket'],json.dumps(archive));self.assertIn('runtime_guard',archive['accepted_context'])
if __name__=='__main__':unittest.main()
