"""Read contracts and typed business-only projections; no actual provider IO."""
from copy import deepcopy
from dataclasses import asdict
from datetime import date
from unittest.mock import patch
from decimal import Decimal
import json,unittest
import read_surface as rs
from semantics import Rejected
from engine import Worker,CallError
from test_runtime import OZ,WB
import test_read_transport as tf
import test_read_surface as wf
PARAMS={'fbp_order_list':{'count':1},'fbp_archive_list':{'count':'1'},'fbp_draft_list':{'count':1},'fbp_order_get':{'supply_id':'1'},'fbp_archive_get':{'supply_id':'1'},'fbp_draft_get':{'supply_id':'1'},'finance_b2b_sales_json':{'date':'2026-10'},'arrival_pass_list':{'limit':10},'posting_marks':{'posting_numbers':['123-1']},'fbs_posting_product_exemplar_status_v5':{'posting_number':'123-1'}}
BODIES={k:{'result':{'supplies':[{'supply_id':'s1','status':'ACCEPTED','quantity':2,'driver':{'phone':'PRIVATE'},'contact_name':'PRIVATE'}],'has_next':True,'last_id':'s1'}}for k in list(PARAMS)[:6]}
BODIES.update(finance_b2b_sales_json={'rows':[{'document_id':'d1','quantity':2,'price':{'amount':'100.10','currency':'RUB'},'vat_amount':'20.02','buyer':{'inn':'PRIVATE'},'bank_details':'PRIVATE'}]},arrival_pass_list={'passes':[{'id':'p1','warehouse_id':1,'status':'ACTIVE','driver':{'name':'PRIVATE'}}]},posting_marks={'postings':[{'posting_number':'123-1','products':[{'sku':11,'quantity':2,'marks':[{'status':'VALID','raw_code':'PRIVATE'}]}]}]},fbs_posting_product_exemplar_status_v5={'products':[{'product_id':11,'status':'READY','customer':'PRIVATE'}]})
class Supply(unittest.TestCase):
 def test_b2b_period_and_invoice_array_preserved(self):
  b={'date_from':'2026-10-01','date_to':'2026-10-31','invoices':[{'number':'INV-1','quantity':2,'amount':'99.10'}],'seller_info':{'inn':'PRIVATE'}};p=rs.project_response('ozon','finance_b2b_sales_json',b);self.assertEqual(p['date_from'],'2026-10-01');self.assertEqual(p['invoices'],b['invoices']);self.assertNotIn('seller_info',p)
 def test_explicit_empty_invoices_is_not_synthetic_zero(self):
  p=rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'2026-10-01','date_to':'2026-10-31','invoices':[]});self.assertEqual(p['invoices'],[]);self.assertNotIn('amount',p)
 def test_invoice_unknown_contact_never_returned(self):
  p=rs.project_response('ozon','finance_b2b_sales_json',{'invoices':[{'number':'INV-1','buyer_name':'PRIVATE','buyer_inn':'PRIVATE','buyer_address':'PRIVATE'}]});self.assertEqual(p['invoices'],[{'number':'INV-1'}])
 def test_invoice_money_not_computed_by_default(self):
  p=rs.project_response('ozon','finance_b2b_sales_json',{'invoices':[{'number':'INV-1','amount':None}]});self.assertIsNone(p['invoices'][0]['amount'])
 def test_provider_calendar_date_kept(self):self.assertEqual(rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'2026-10-01'})['date_from'],'2026-10-01')
 def test_provider_naive_datetime_no_zone_added(self):self.assertEqual(rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'2026-10-01T00:00:00'})['date_from'],'2026-10-01T00:00:00')
 def test_provider_timezone_not_shifted(self):self.assertEqual(rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'2026-10-01T00:00:00+03:00'})['date_from'],'2026-10-01T00:00:00+03:00')
 def test_provider_dotted_calendar_preserved(self):self.assertEqual(rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'01.10.2026'})['date_from'],'01.10.2026')
 def test_invalid_provider_day_not_accepted(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'31.02.2026'})
 def test_calendar_arbitrary_text_not_accepted(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'PRIVATE customer information'})
 def test_provider_nanosecond_text_not_truncated(self):
  x='2026-10-01T00:00:00.123456789Z';self.assertEqual(rs.project_response('ozon','finance_b2b_sales_json',{'date_from':x})['date_from'],x)
 def test_provider_dotted_datetime_not_shifted(self):
  x='01.10.2026 00:00:00';self.assertEqual(rs.project_response('ozon','finance_b2b_sales_json',{'date_from':x})['date_from'],x)
 def test_calendar_diagnostic_never_logs_actual_contents(self):
  with patch('builtins.print')as log:
   with self.assertRaises(Rejected):rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'PRIVATE 123456789'})
  text=str(log.call_args_list);self.assertNotIn('PRIVATE',text);self.assertNotIn('123456789',text);self.assertIn('value_shape',text)
 def test_explicit_blank_report_dates_preserved_not_invented(self):
  p=rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'','date_to':'','invoices':[]});self.assertEqual(p['date_from'],'');self.assertEqual(p['date_to'],'');self.assertEqual(p['_read_projection']['source_period_status'],'MISSING');self.assertNotIn('amount',p)
 def test_source_null_date_preserved_and_marked_missing(self):
  p=rs.project_response('ozon','finance_b2b_sales_json',{'date_from':None,'invoices':[]});self.assertIsNone(p['date_from']);self.assertEqual(p['_read_projection']['blank_calendar_fields'],['date_from'])
 def test_report_dates_not_manufactured_from_request(self):
  p=rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'','date_to':'','invoices':[]});self.assertNotIn('2026',json.dumps(p))
 def test_other_timestamp_rules_unchanged(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','arrival_pass_list',{'created_at':''})
 def test_direct_reply_warns_period_unconfirmed(self):
  from universal_reads import result
  data=rs.project_response('ozon','finance_b2b_sales_json',{'date_from':'','date_to':'','invoices':[]});plan={'direct_read':{'store_id':'oz1','operation':'finance_b2b_sales_json'}};value={'calls':[{'store_id':'oz1','operation':'finance_b2b_sales_json','data':data}],'decision':{'action':'direct_read'}};out=result(plan,value,'2026-11-09 00:00 UTC');self.assertIn('Источник не указал период',out['pages'][0])
 def test_count_separate_from_live_acceptance(self):
  allrows=[m for p in rs.CATALOG['providers'].values()for m in p['operations'].values()];self.assertEqual(len(allrows),490);self.assertEqual(sum(rs.available(m)for m in allrows),487)
 def test_source_record_not_modified(self):
  v=deepcopy(BODIES['fbp_order_list']);rs.project_response('ozon','fbp_order_list',v);self.assertEqual(v,BODIES['fbp_order_list'])
 def test_empty_page_not_whole_account_zero(self):
  p=rs.project_response('ozon','fbp_draft_list',{'supplies':[],'has_next':True});self.assertEqual(p['supplies'],[]);self.assertTrue(p['has_next'])
 def test_missing_money_not_filled(self):self.assertNotIn('price',rs.project_response('ozon','finance_b2b_sales_json',{'quantity':0}))
 def test_exact_money_preserved(self):
  p=rs.project_response('ozon','finance_b2b_sales_json',BODIES['finance_b2b_sales_json']);self.assertEqual(p['rows'][0]['price'],{'amount':'100.10','currency':'RUB'});self.assertEqual(p['rows'][0]['vat_amount'],'20.02')
 def test_unknown_buyer_subtree_not_mined(self):
  p=rs.project_response('ozon','finance_b2b_sales_json',{'id':'1','buyer':{'price':'999','id':'PRIVATE'}});self.assertNotIn('999',json.dumps(p));self.assertNotIn('PRIVATE',json.dumps(p))
 def test_full_unknown_payload_is_not_empty_success(self):
  with self.assertRaises(Rejected):rs.project_response('ozon','fbp_order_get',{'driver':'PRIVATE'})
 def test_create_or_get_not_unlocked(self):
  with self.assertRaises(Rejected):rs.build('ozon','fbs_posting_product_exemplar_create_or_get_v6',{})
 def test_validator_mutation_not_unlocked(self):
  with self.assertRaises(Rejected):rs.build('ozon','fbs_product_exemplar_validate',{})
 def test_create_order_not_unlocked(self):
  with self.assertRaises(Rejected):rs.build('ozon','order_create_v2',{})
 def test_ids_are_not_donor_defaults(self):
  r=rs.build('ozon','fbp_order_get',{'supply_id':'actual-id'});self.assertEqual(json.loads(r['body'])['supply_id'],'actual-id')
 def test_extra_url_not_ignored(self):
  with self.assertRaises(Rejected):rs.build('ozon','fbp_order_get',{'supply_id':'1','url':'https://invalid.example'})
 def test_old_gate_intact(self):
  with self.assertRaises(Rejected):rs.build('ozon','carriage_courier_contact_get',{})
 def test_profile_missing_prevents_call(self):
  with patch.dict(rs.CATALOG['response_projections'],{},clear=True):
   with self.assertRaises(Rejected):rs.build('ozon','fbp_order_list',{'count':1})
for name,params in PARAMS.items():
 def contract(self,name=name,params=params):
  request=rs.build('ozon',name,params);self.assertTrue(request['url'].startswith('https://api-seller.ozon.ru/'));self.assertEqual(request['headers'],{});self.assertEqual(request['method'],'POST')
 setattr(Supply,'test_contract_'+name,contract)
 def projection(self,name=name):
  p=rs.project_response('ozon',name,BODIES[name]);self.assertNotIn('PRIVATE',json.dumps(p));self.assertEqual(p['_read_projection']['content_scope'],'STRUCTURED_BUSINESS_DATA_NO_PERSONAL_DETAILS')
 setattr(Supply,'test_project_'+name,projection)
class Transport(unittest.TestCase):
 setUp=tf.ReadTransport.setUp;tearDown=tf.ReadTransport.tearDown
 def test_transport_projects_before_worker(self):
  req=rs.request_for(asdict(OZ),'fbp_order_list',{'count':1})
  with patch('http_transport.read_response',return_value=(json.dumps(BODIES['fbp_order_list']).encode(),200)):
   p,_=self.t.execute(req,asdict(OZ));self.assertNotIn('PRIVATE',json.dumps(p))
 def test_cross_platform_credential_denied(self):
  req=rs.request_for(asdict(OZ),'fbp_order_list',{'count':1})
  with patch('http_transport.read_response')as http:
   with self.assertRaises(CallError):self.t.execute(req,asdict(WB))
   http.assert_not_called()
class Queue(unittest.TestCase):
 setUp=wf.Universal.setUp;tearDown=wf.Universal.tearDown;finish=wf.Universal.finish
 def test_exact_read_without_report_template_shared_queue(self):
  holder=tf.ReadTransport();holder.setUp()
  try:
   self.worker=Worker(self.engine,holder.t);a=self.engine.submit_method('A','oz1','fbp_order_list',{'count':1},'fbp-read-1',date(2026,11,9),'fbp-read-session')
   with patch('http_transport.read_response',return_value=(json.dumps(BODIES['fbp_order_list']).encode(),200))as http:row=self.finish(a)
   self.assertEqual(row['state'],'READY',row['error']);self.assertNotIn('PRIVATE',row['result']);self.assertEqual(http.call_count,1)
  finally:holder.tearDown()
if __name__=='__main__':
 r=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [Supply,Transport,Queue]));print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'real_provider_http':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
