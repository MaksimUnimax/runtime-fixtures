"""Business-only access to six existing read methods. No customer data enters jobs."""
from copy import deepcopy
from dataclasses import asdict
from datetime import date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import json,unittest
import test_read_transport as transport_fixture
import test_read_surface as worker_fixture
from test_runtime import OZ,WB
from engine import Worker,CallError
from semantics import Rejected
import read_surface as rs

PARAMS={'filter':{'since':'2026-11-07T00:00:00Z','to':'2026-11-08T00:00:00Z'},'limit':10}
BODY={'postings':[{'posting_number':'123-1','status':'awaiting_packaging','customer':{'id':999,'name':'PRIVATE_PERSON','phone':'PRIVATE_PHONE'},'products':[{'sku':123,'quantity':2,'price':'199.50','name':'PRIVATE_TEXT'}]}],'has_next':False,'cursor':''}
METHODS=['fbs_posting_list','fbs_unfulfilled_list','posting_fbs_get','rfbs_returns_list','rfbs_returns_get','conditional_cancellation_list']
class Projection(unittest.TestCase):
 def project(self,value):return rs.project_response('ozon','fbs_posting_list',value)
 def test_explicit_result_array_and_object_supported(self):
  self.assertEqual(self.project({'result':[{'id':1}]})['result'],[{'id':1}]);self.assertEqual(self.project({'result':{'id':1}})['result'],{'id':1})
 def test_numeric_pagination_cursor_remains_numeric(self):self.assertEqual(self.project({'returns':[],'last_id':123})['last_id'],123)
 def test_seller_article_spaces_punctuation_not_customer_name(self):self.assertEqual(self.project({'offer_id':'Товар № 1 (красный), набор + чехол'})['offer_id'],'Товар № 1 (красный), набор + чехол')
 def test_article_control_characters_rejected(self):
  with self.assertRaises(Rejected):self.project({'offer_id':'sku\nline'})
 def test_business_label_does_not_allow_unknown_name_field(self):self.assertNotIn('name',self.project({'offer_id':'Артикул 1','name':'PRIVATE_NAME'}))
 def test_seller_article_cyrillic_is_business_identifier(self):self.assertEqual(self.project({'offer_id':'Товар-001'})['offer_id'],'Товар-001')
 def test_identifier_contact_syntax_is_rejected(self):
  with self.assertRaises(Rejected):self.project({'offer_id':'person@example.invalid'})
 def test_unstructured_additional_data_not_mined(self):
  data={'result':{'posting_number':'123-1','additional_data':[{'key':'recipient','value':'PRIVATE'}]}}
  value=self.project(data);self.assertEqual(value['result'],{'posting_number':'123-1'});self.assertNotIn('PRIVATE',json.dumps(value))
 def test_empty_additional_array_does_not_break_business_read(self):self.assertEqual(self.project({'posting_number':'123-1','additional_data':[]})['posting_number'],'123-1')
 def test_six_gated_methods_now_business_only(self):
  for name in METHODS:self.assertTrue(rs.available(rs.method('ozon',name)));self.assertEqual(rs.method('ozon',name)['privacy_policy'],'operator_personal_data_gate')
 def test_inventory_490_preserved_487_callable(self):
  methods=[m for p in rs.CATALOG['providers'].values()for m in p['operations'].values()];self.assertEqual(len(methods),490);self.assertEqual(sum(rs.available(m)for m in methods),487)
 def test_whole_customer_subtree_removed(self):
  p=self.project(BODY);self.assertNotIn('PRIVATE',json.dumps(p));self.assertNotIn('customer',p['postings'][0]);self.assertNotIn('999',json.dumps(p))
 def test_no_mining_unknown_container_for_allowed_keys(self):
  p=self.project({'postings':[],'unexpected':{'id':777,'price':'999','phone':'PRIVATE'}});self.assertNotIn('777',json.dumps(p));self.assertNotIn('999',json.dumps(p))
 def test_business_values_and_shape_retained(self):
  p=self.project(BODY);self.assertEqual(p['postings'][0]['products'][0],{'sku':123,'quantity':2,'price':'199.50'});self.assertFalse(p['has_next']);self.assertEqual(p['cursor'],'')
 def test_explicit_empty_array_preserved(self):self.assertEqual(self.project({'postings':[]})['postings'],[])
 def test_null_preserved_not_zero(self):self.assertIsNone(self.project({'result':{'price':None}})['result']['price'])
 def test_money_exact_decimal(self):self.assertEqual(self.project({'price':Decimal('999.00000001')})['price'],Decimal('999.00000001'))
 def test_negative_money_not_absolute(self):self.assertEqual(self.project({'amount':'-12.50'})['amount'],'-12.50')
 def test_float_not_silently_rounded(self):
  with self.assertRaises(Rejected):self.project({'price':12.5})
 def test_unknown_top_level_not_fake_empty_result(self):
  with self.assertRaises(Rejected)as e:self.project({'customer':{'name':'PRIVATE'}})
  self.assertEqual(e.exception.code,'READ_PROJECTION_UNQUALIFIED')
 def test_unknown_nonempty_row_fails(self):
  with self.assertRaises(Rejected):self.project({'postings':[{'name':'PRIVATE'}]})
 def test_named_scalar_cannot_contain_personal_text(self):
  with self.assertRaises(Rejected):self.project({'id':'PRIVATE_NAME'})
 def test_bool_is_not_money(self):
  with self.assertRaises(Rejected):self.project({'price':True})
 def test_has_next_is_not_truthy_string(self):
  with self.assertRaises(Rejected):self.project({'has_next':'true'})
 def test_nested_price_object_not_accepted_as_number(self):
  with self.assertRaises(Rejected):self.project({'price':{'name':'PRIVATE'}})
 def test_unknown_free_text_removed(self):self.assertNotIn('comment',self.project({'id':1,'comment':'PRIVATE_PHONE'}))
 def test_null_timestamp_stays_null(self):self.assertIsNone(self.project({'created_at':None})['created_at'])
 def test_timestamp_timezone_not_guessed(self):
  with self.assertRaises(Rejected):self.project({'created_at':'2026-11-08T01:00:00'})
 def test_source_data_not_mutated(self):
  data=deepcopy(BODY);self.project(data);self.assertEqual(data,BODY)
 def test_other_sensitive_methods_still_not_unlocked(self):
  for platform,op,params in [('ozon','chat_history_v3',{}),('wb','buyer_chats',{'force_raw':True})]:
   with self.assertRaises(Rejected):rs.build(platform,op,params)
 def test_retired_method_not_reenabled(self):
  with self.assertRaises(Rejected):rs.build('ozon','finance_transaction_list_v3',{})
 def test_writes_not_introduced(self):
  with self.assertRaises(Rejected):rs.build('ozon','rfbs_returns_reject',{'return_id':1})
 def test_no_response_profile_user_parameter(self):
  with self.assertRaises(Rejected):rs.build('ozon','fbs_posting_list',{**PARAMS,'response_projection':None})
 def test_missing_projection_policy_fails_closed(self):
  with patch.dict(rs.CATALOG['response_projections'],{},clear=True):
   with self.assertRaises(Rejected):rs.build('ozon','fbs_posting_list',PARAMS)
 def test_default_allow_cannot_replace_default_drop(self):
  p=deepcopy(rs.CATALOG['response_projections']['order-return-business-v1']);p['default']='ALLOW'
  with patch.dict(rs.CATALOG['response_projections'],{'order-return-business-v1':p}):
   with self.assertRaises(Rejected):self.project(BODY)
 def test_other_safe_responses_are_unchanged(self):
  data={'name':'seller'};self.assertIs(rs.project_response('wb','seller_info',data),data)
 def test_projection_is_visible_in_catalogue(self):
  x=next(x for x in rs.discover('ozon','fbs_posting_list')['items']if x['operation']=='fbs_posting_list');self.assertEqual(x['response_projection'],'order-return-business-v1');self.assertTrue(x['available'])
class TransportProjection(unittest.TestCase):
 setUp=transport_fixture.ReadTransport.setUp
 tearDown=transport_fixture.ReadTransport.tearDown
 def test_projection_error_is_known_http_outcome(self):
  req=rs.request_for(asdict(OZ),'fbs_posting_list',PARAMS)
  with patch('http_transport.read_response',return_value=(b'{"price":{"unknown":"PRIVATE"}}',200)):
   with self.assertRaises(CallError)as caught:self.t.execute(req,asdict(OZ))
  self.assertEqual(caught.exception.code,'READ_PROJECTION_TYPE');self.assertEqual(caught.exception.status,200);self.assertFalse(caught.exception.unknown)
 def test_real_transport_projects_before_return(self):
  req=rs.request_for(asdict(OZ),'fbs_posting_list',PARAMS)
  with patch('http_transport.read_response',return_value=(json.dumps(BODY).encode(),200))as http:
   data,meta=self.t.execute(req,asdict(OZ));self.assertNotIn('PRIVATE',json.dumps(data));self.assertEqual(http.call_args.args[0].full_url,'https://api-seller.ozon.ru/v4/posting/fbs/list');self.assertEqual(meta['status'],200)
 def test_projection_does_not_bypass_credentials_scope(self):
  req=rs.request_for(asdict(OZ),'fbs_posting_list',PARAMS)
  with patch('http_transport.read_response')as http:
   with self.assertRaises(CallError):self.t.execute(req,asdict(WB))
   http.assert_not_called()
 def test_source_policy_revocation_stops_http(self):
  req=rs.request_for(asdict(OZ),'fbs_posting_list',PARAMS);self.policy['enabled']=False
  with patch('http_transport.read_response')as http:
   with self.assertRaises(CallError):self.t.execute(req,asdict(OZ))
   http.assert_not_called()
class QueueProjection(unittest.TestCase):
 setUp=worker_fixture.Universal.setUp
 tearDown=worker_fixture.Universal.tearDown
 finish=worker_fixture.Universal.finish
 def test_only_projected_data_is_persisted_in_existing_queue(self):
  holder=transport_fixture.ReadTransport();holder.setUp()
  try:
   worker=Worker(self.engine,holder.t)
   self.worker=worker
   a=self.engine.submit_method('A','oz1','fbs_posting_list',PARAMS,'safe-business-only',date(2026,11,8),'session-read-test')
   with patch('http_transport.read_response',return_value=(json.dumps(BODY).encode(),200))as http:r=self.finish(a)
   self.assertEqual(r['state'],'READY',r['error']);self.assertNotIn('PRIVATE',r['result']);self.assertIn('199.50',r['result']);self.assertEqual(http.call_count,1)
  finally:holder.tearDown()
if __name__=='__main__':
 suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [Projection,TransportProjection,QueueProjection]);r=unittest.TextTestRunner(verbosity=2).run(suite);print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'real_provider_http':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
