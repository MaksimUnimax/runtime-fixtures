from copy import deepcopy
from datetime import date
from dataclasses import replace
from unittest.mock import patch
from pathlib import Path
import json,socket,tempfile,unittest
from test_runtime import Clock,SCOPE
from repository import Repository
from engine import Engine,Worker,CallError
from semantics import fingerprint,Rejected
import read_surface as rs
from universal_reads import ReadSurface,identifier_provenance,result

POLICY={'enabled':True,'pin':rs.PIN,'max_model_steps':None,'max_provider_calls':None}
QUESTION='В каких акциях участвуют мои товары на Озоне'
class Universal(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.clock=Clock();self.scope=SCOPE;self.policy=deepcopy(POLICY)
  self.repo=Repository(Path(self.tmp.name)/'q.sqlite',self.clock);self.reads=ReadSurface(lambda:self.policy)
  self.engine=Engine(self.repo,lambda tenant:self.scope,read_surface=self.reads);self.physical=[]
  self.decisions=[{'action':'discover','platform':'ozon','cluster':'prices_promotions','query':'action','offset':0},
    {'action':'read','store_id':next(s.id for s in self.scope.stores if s.platform=='ozon'),'operation':'ozon_actions_list','params':{}},
    {'action':'finish','facts':[{'label':'Акция из ответа Ozon','expr':{'$path':['calls',0,'data','result',0,'title']}},{'label':'Участвующих товаров','expr':{'$path':['calls',0,'data','result',0,'participating_products_count']}}],'coverage':'complete'}]
  outer=self
  class Transport:
   def prepare(self,*a):return None
   def execute(self,request,store=None):
    outer.physical.append(request.operation)
    if request.operation=='deepseek_read_plan':return {'content':json.dumps(outer.decisions.pop(0),ensure_ascii=False),'finish_reason':'stop'},{'status':200,'elapsed_ms':1,'bytes':100}
    if request.operation=='read.ozon.ozon_actions_list':return {'result':[{'id':777,'title':'Тестовая акция','participating_products_count':3}]},{'status':200,'elapsed_ms':1,'bytes':100}
    raise AssertionError(request.operation)
  self.transport=Transport();self.worker=Worker(self.engine,self.transport)
 def tearDown(self):self.tmp.cleanup()
 def ask(self,q=QUESTION,i=0):return self.engine.safe_submit('A',q,'read-test-'+str(i),fingerprint(q),date(2026,11,8),conversation_id='session-read-test',message_id=i)
 def finish(self,a):
  for _ in range(16):
   row=self.repo.get('A',a['job_id'])
   if row['state']not in('QUEUED','RUNNING'):return row
   self.clock.advance(65);self.worker.step()
  return self.repo.get('A',a['job_id'])
 def direct(self,params=None,operation='ozon_actions_list',rid='direct-1'):
  store=next(s.id for s in self.scope.stores if s.platform=='ozon')
  return self.engine.submit_method('A',store,operation,params or{},rid,date(2026,11,8),'session-read-test')
 def test_exact_method_needs_no_model_or_report_template(self):
  a=self.direct();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(self.physical,['read.ozon.ozon_actions_list']);self.assertEqual(self.repo.call_count(),1)
 def test_exact_method_read_payload_preserved(self):
  a=self.direct();r=self.finish(a);v=json.loads(r['result']);self.assertEqual(v['data']['calls'][0]['data']['result'][0]['participating_products_count'],3)
 def test_exact_method_existing_model_limit_not_touched(self):
  self.engine.model_budget['daily_calls']=0;a=self.direct();r=self.finish(a);self.assertEqual(r['state'],'READY');self.assertNotIn('deepseek_read_plan',self.physical)
 def test_exact_method_wrong_store_denied(self):
  with self.assertRaises(Rejected):self.engine.submit_method('A','not-my-store','ozon_actions_list',{},'x',date(2026,11,8),'session-read-test')
  self.assertEqual(self.physical,[])
 def test_exact_method_write_not_exposed(self):
  with self.assertRaises(Rejected):self.direct(operation='ozon_actions_products_activate')
 def test_exact_method_revoke_before_io(self):
  a=self.direct();self.scope=replace(self.scope,revision='revoked');r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertEqual(self.physical,[])
 def test_exact_method_changed_replay_denied(self):
  self.direct()
  with self.assertRaises(Rejected):self.direct(operation='ozon_action_products',params={'action_id':777,'limit':100})
 def test_discovery_optional_defaults_are_not_missing_business_data(self):
  self.decisions[0]={'action':'discover','platform':'ozon','cluster':'prices_promotions'};a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error'])
 def test_denied_source_hides_cached_generic_result(self):
  a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY');plan=json.loads(r['plan']);ref=plan['read_source_refs'][0];self.repo.deny(ref['source'],ref['revision']);answer=self.ask('результат',1);self.assertNotIn('Тестовая акция',answer['text'])
 def test_source_ref_is_persisted_before_direct_io(self):
  a=self.direct();self.clock.advance(65);self.worker.step();r=self.repo.get('A',a['job_id']);self.assertTrue(json.loads(r['plan'])['read_source_refs']);self.assertEqual(self.physical,[])
 def test_station_status_can_read_generic_result(self):
  from station_status import status
  a=self.ask();self.finish(a);reply=status(self.engine,{'op':'station_status','tenant':'A','conversation_id':'session-read-test','job_id':a['job_id']});self.assertEqual(reply['state'],'READY');self.assertIn('Тестовая акция',reply['text']);self.assertEqual(len(self.physical),4)
 def test_station_status_rechecks_rights(self):
  from station_status import status
  a=self.ask();self.finish(a);self.scope=replace(self.scope,revision='revoked')
  with self.assertRaises(Rejected):status(self.engine,{'op':'station_status','tenant':'A','conversation_id':'session-read-test','job_id':a['job_id']})
 def test_without_template_or_dates_reaches_real_worker(self):
  a=self.ask();self.assertEqual(a.get('state'),'QUEUED',a);r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);answer=self.ask('результат',1);self.assertIn('Тестовая акция',answer['text']);self.assertIn('3',answer['text']);self.assertEqual(self.physical.count('read.ozon.ozon_actions_list'),1)
 def test_same_ledger_model_and_provider(self):
  a=self.ask();self.finish(a);self.assertEqual(self.repo.call_count(),4)
 def test_no_date_clarification(self):
  a=self.ask();self.assertNotEqual(a.get('error'),'PERIOD_REQUIRED');self.assertFalse(a.get('clarification_required'))
 def test_revoke_before_first_io(self):
  a=self.ask();self.scope=replace(self.scope,revision='revoked');r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertEqual(self.physical,[])
 def test_policy_disable_before_io(self):
  a=self.ask();self.policy['enabled']=False;r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertEqual(self.physical,[])
 def test_current_access_after_ready(self):
  a=self.ask();self.finish(a);self.scope=replace(self.scope,revision='revoked');self.assertNotIn('Тестовая акция',self.ask('результат',1)['text'])
 def test_no_write_disguised_as_read(self):self.assertEqual(self.ask('включи товары в акции на озоне')['error'],'READ_ONLY');self.assertEqual(self.physical,[])
 def test_secrets_not_sent_to_model(self):self.assertEqual(self.ask('акции api-key something-private')['error'],'SENSITIVE_INPUT');self.assertEqual(self.physical,[])
 def test_both_platform_catalogues_loaded(self):self.assertEqual(len(rs.CATALOG['providers']['ozon']['operations']),303);self.assertEqual(len(rs.CATALOG['providers']['wb']['operations']),187)
 def test_ozon_current_read_version(self):self.assertEqual(rs.build('ozon','ozon_action_products',{'action_id':777,'limit':100})['url'],'https://api-seller.ozon.ru/v2/actions/products')
 def test_wb_calendar_available(self):
  r=rs.build('wb','calendar_promotions',{'query':{'startDateTime':'2026-11-08T00:00:00Z','endDateTime':'2026-11-08T23:59:59Z','allPromo':False}});self.assertEqual(r['method'],'GET');self.assertIn('dp-calendar-api.wildberries.ru',r['url'])
 def test_unknown_method_not_network(self):
  with self.assertRaises(Rejected):rs.build('ozon','products_delete',{})
 def test_host_injection_denied(self):
  with self.assertRaises(Rejected):rs.build('ozon','ozon_actions_list',{'url':'https://invalid.example'})
 def test_wb_header_injection_denied(self):
  with self.assertRaises(Rejected):rs.build('wb','seller_info',{'headers':{'Authorization':'fake'}})
 def test_retired_method_retains_reason(self):
  with self.assertRaises(Rejected):rs.build('ozon','finance_transaction_list_v3',{})
 def test_sensitive_donor_gate_not_removed(self):
  with self.assertRaises(Rejected):rs.build('wb','buyer_chats',{'force_raw':True})
 def test_identifier_from_example_is_not_real(self):
  with self.assertRaises(Rejected):identifier_provenance({'action_id':1},QUESTION,[])
 def test_identifier_from_response_allowed(self):identifier_provenance({'action_id':777},QUESTION,[{'data':{'id':777}}])
 def test_identifier_from_explicit_request_allowed(self):identifier_provenance({'action_id':777},'акция 777',[])
 def test_large_integer_no_silent_rounding(self):
  with self.assertRaises(Rejected):rs.build('ozon','ozon_action_products',{'action_id':9007199254740999,'limit':100})
 def test_no_constant_financial_answer(self):
  plan=self.reads.plan(self.scope,QUESTION,date(2026,11,8),self.clock())
  with self.assertRaises(Rejected):result(plan,{'calls':[{'data':{}}],'decision':{'action':'finish','facts':[{'label':'Прибыль','expr':99999}],'coverage':'complete'}},'2026-11-08 08:00 UTC')
 def test_redaction_preserves_business_counts(self):
  d=rs.sanitize({'customer_count':3,'customer':{'phone':'PRIVATE'},'access_token':'PRIVATE','amount':123});self.assertEqual(d['customer_count'],3);self.assertNotIn('PRIVATE',json.dumps(d))
 def test_response_summary_preserves_path_shape(self):self.assertIsInstance(rs.summarize({'result':[1,2]})['result'],list)
 def test_no_template_unknown_query_uses_catalogue(self):
  a=self.ask('покажи доступные методы чтения цен на озоне');self.assertEqual(a.get('state'),'QUEUED',a)
 def test_existing_template_uses_existing_route(self):
  a=self.ask('сводка заказов за вчера на озоне');self.assertEqual(a.get('state'),'QUEUED');p=json.loads(self.repo.get('A',a['job_id'])['plan']);self.assertNotIn('universal_read',p)
if __name__=='__main__':
 attempts=[]
 def deny(*a,**kw):attempts.append(1);raise AssertionError('NETWORK_FORBIDDEN')
 with patch.object(socket.socket,'connect',deny),patch.object(socket,'getaddrinfo',deny):r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Universal))
 print(json.dumps({'status':'PASS'if r.wasSuccessful()and not attempts else'FAIL','tests':r.testsRun,'failures':len(r.failures),'errors':len(r.errors),'real_provider_http':0}));raise SystemExit(0 if r.wasSuccessful()and not attempts else 1)
