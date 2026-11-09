"""No-network checks for source-bound metadata reads and the shared transport."""
from copy import deepcopy
from dataclasses import asdict
from datetime import date
from unittest.mock import patch
import json,unittest
import read_surface as rs
from semantics import Rejected
from engine import CallError,Worker
from test_runtime import OZ,WB
import test_read_transport as tf
import test_read_surface as wf
CASES={'review_list':{'limit':20,'sort_dir':'DESC'},'review_info':{'review_id':'review-123'},'review_comment_list':{'review_id':'review-123','limit':20,'sort_dir':'ASC'},'question_list':{'limit':20,'sort_dir':'DESC'},'question_info':{'question_id':'question-123'},'question_answer_list':{'question_id':'question-123','sku':123},'returns_utilization_history':{},'discount_task_list_v2':{'limit':20,'status':'ALL'}}
BODY={'reviews':[{'id':'review-123','sku':'123','rating':4,'status':'UNPROCESSED','text':'PRIVATE_TEXT','author_name':'PRIVATE_NAME','published_at':'2026-11-09T00:00:00Z'}],'last_id':'review-123','has_next':True}
class Metadata(unittest.TestCase):
 def test_count_not_full_live_claim(self):
  rows=[m for p in rs.CATALOG['providers'].values()for m in p['operations'].values()];self.assertEqual(len(rows),490);self.assertEqual(sum(rs.available(m)for m in rows),487)
 def test_excluded_text_and_preserved_rating(self):
  p=rs.project_response('ozon','review_list',BODY);self.assertNotIn('PRIVATE',json.dumps(p));self.assertEqual(p['reviews'][0]['rating'],4);self.assertEqual(p['_read_projection']['content_scope'],'METADATA_ONLY_NO_CUSTOMER_TEXT')
 def test_input_immutable(self):
  v=deepcopy(BODY);rs.project_response('ozon','review_list',v);self.assertEqual(v,BODY)
 def test_pagination_not_lost(self):
  p=rs.project_response('ozon','review_list',BODY);self.assertTrue(p['has_next']);self.assertEqual(p['last_id'],'review-123')
 def test_unknown_personal_container_not_mined(self):
  p=rs.project_response('ozon','review_info',{'id':'r','customer':{'id':'PRIVATE','rating':1}});self.assertNotIn('PRIVATE',json.dumps(p));self.assertNotIn('customer',p)
 def test_unknown_text_only_not_empty_success(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','review_info',{'text':'PRIVATE'})
 def test_missing_rating_not_zero(self):self.assertNotIn('rating',rs.project_response('ozon','review_info',{'id':'r'}))
 def test_null_not_zero(self):self.assertIsNone(rs.project_response('ozon','review_info',{'rating':None})['rating'])
 def test_false_not_missing(self):self.assertIs(rs.project_response('ozon','review_info',{'is_rating_participant':False})['is_rating_participant'],False)
 def test_contact_id_rejected(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','review_info',{'id':'a@example.invalid'})
 def test_bool_id_rejected(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','review_info',{'id':True})
 def test_uuid_id_preserved(self):
  v='01920411-f6af-7e58-a8a4-63c5cfc007d0';self.assertEqual(rs.project_response('ozon','review_info',{'id':v})['id'],v)
 def test_money_and_currency_exact(self):
  p={'amount':'12.00000001','currency':'USD'};self.assertEqual(rs.project_response('ozon','discount_task_list_v2',{'tasks':[{'price':p}]})['tasks'][0]['price'],p)
 def test_explicit_empty(self):self.assertEqual(rs.project_response('ozon','question_list',{'questions':[]})['questions'],[])
 def test_metadata_not_personal_mode(self):
  for p,a in [('ozon','chat_history_v3'),('wb','buyer_chats'),('wb','seller_users')]:
   with self.assertRaises(Rejected):rs.build(p,a,{'force_raw':True})
 def test_service_token_requirement_is_explicit(self):
  for a in ['subscriptions','seller_rating','tariff_constructor_options']:
   self.assertEqual(rs.method('wb',a)['completion']['credential_kind'],'WB_VERIFIED_SERVICE')
 def test_retired_stays_disabled(self):
  for a in ['finance_transaction_list_v3','fbs_carriage_available_list','fbs_stock_by_warehouse_v1']:
   with self.assertRaises(Rejected):rs.build('ozon',a,{})
 def test_no_write_methods(self):
  for p,a in [('ozon','question_answer_create'),('ozon','review_change_status'),('wb','passes_create')]:
   with self.assertRaises(Rejected):rs.build(p,a,{})
 def test_wb_personal_fields_dropped(self):
  p=rs.project_response('wb','fbs_passes',{'passes':[{'id':123,'officeId':45,'firstName':'PRIVATE','carNumber':'PRIVATE'}]});self.assertEqual(p['passes'][0],{'id':123,'officeId':45});self.assertNotIn('PRIVATE',json.dumps(p))
 def test_wb_root_array_declared(self):
  p=rs.project_response('wb','fbs_passes',[{'id':123}]);self.assertEqual(p['items'],[{'id':123}]);self.assertEqual(p['_read_projection']['root_array_wrapped_as'],'items')
 def test_old_orders_array_not_enabled(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','fbs_posting_list',[])
 def test_wb_fixed_request(self):
  for params in [{},{'path':{},'query':{}}]:
   r=rs.build('wb','fbs_passes',params);self.assertEqual(r['method'],'GET');self.assertEqual(r['url'],'https://marketplace-api.wildberries.ru/api/v3/passes');self.assertEqual(r['headers'],{});self.assertNotIn('body',r)
 def test_wb_unknown_params_not_ignored(self):
  for p in [{'body':{}},{'query':{'limit':10}},{'url':'https://invalid.example'},{'Authorization':'PRIVATE'},{'path':{'id':1}}]:
   with self.assertRaises(Rejected):rs.build('wb','fbs_passes',p)
 def test_missing_profile_fails_closed(self):
  with patch.dict(rs.CATALOG['response_projections'],{},clear=True):
   with self.assertRaises(Rejected):rs.build('wb','fbs_passes',{})
 def test_wrong_block_reason_not_lifted(self):
  with patch.dict(rs.method('wb','fbs_passes'),{'blocked_reason':'SERVICE_TOKEN_ONLY_PERSONAL_BUILD'}):
   with self.assertRaises(Rejected):rs.build('wb','fbs_passes',{})
 def test_noncurrent_not_enabled(self):
  with patch.dict(rs.method('wb','fbs_passes'),{'current':False}):
   with self.assertRaises(Rejected):rs.build('wb','fbs_passes',{})
 def test_discovery_content_scope_visible(self):
  r=next(r for r in rs.discover('ozon','review_list')['items']if r['operation']=='review_list');self.assertEqual(r['content_scope'],'METADATA_ONLY_NO_CUSTOMER_TEXT')
 def test_nested_rating_not_accepted(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','review_info',{'rating':{'name':'PRIVATE'}})
 def test_date_validation(self):
  with self.assertRaises(Rejected):rs.project_response('wb','fbs_passes',{'date':'2026-02-31'})
for name,params in CASES.items():
 def contract(self,name=name,params=params):
  request=rs.build('ozon',name,params);self.assertTrue(request['url'].startswith('https://api-seller.ozon.ru/'));self.assertEqual(request['headers'],{});self.assertTrue(rs.available(rs.method('ozon',name)))
 setattr(Metadata,'test_contract_'+name,contract)
class Transport(unittest.TestCase):
 setUp=tf.ReadTransport.setUp;tearDown=tf.ReadTransport.tearDown
 def test_redacted_before_return_to_worker(self):
  request=rs.request_for(asdict(OZ),'review_list',CASES['review_list'])
  with patch('http_transport.read_response',return_value=(json.dumps(BODY).encode(),200)):
   value,_=self.t.execute(request,asdict(OZ));self.assertNotIn('PRIVATE',json.dumps(value));self.assertEqual(value['reviews'][0]['rating'],4)
 def test_wrong_store_prevents_http(self):
  request=rs.request_for(asdict(OZ),'review_list',CASES['review_list'])
  with patch('http_transport.read_response')as http:
   with self.assertRaises(CallError):self.t.execute(request,asdict(WB))
   http.assert_not_called()
 def test_wb_uses_wb_binding(self):
  request=rs.request_for(asdict(WB),'fbs_passes',{})
  with patch('http_transport.read_response',return_value=(b'{"passes":[]}',200))as http:
   self.t.execute(request,asdict(WB));self.assertEqual(http.call_args.args[0].get_header('Authorization'),'SYNTHETIC_WB_TOKEN_123')
class Queue(unittest.TestCase):
 setUp=wf.Universal.setUp;tearDown=wf.Universal.tearDown;finish=wf.Universal.finish
 def test_exact_method_no_template_persists_only_metadata(self):
  holder=tf.ReadTransport();holder.setUp()
  try:
   self.worker=Worker(self.engine,holder.t);job=self.engine.submit_method('A','oz1','review_list',CASES['review_list'],'metadata-1',date(2026,11,9),'metadata-test-session')
   with patch('http_transport.read_response',return_value=(json.dumps(BODY).encode(),200))as http:row=self.finish(job)
   self.assertEqual(row['state'],'READY',row['error']);self.assertNotIn('PRIVATE',row['result']);self.assertEqual(http.call_count,1)
  finally:holder.tearDown()
if __name__=='__main__':
 suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [Metadata,Transport,Queue]);r=unittest.TextTestRunner(verbosity=2).run(suite);print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'real_provider_http':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
