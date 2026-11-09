"""Paid-access labels are source evidence, never assumed account authorizations."""
from copy import deepcopy
from datetime import date
from dataclasses import asdict
from unittest.mock import patch
import io,json,unittest,urllib.error
import subscription_access as sa
import read_surface as rs
from provider_denial import diagnose_denial
from engine import CallError,Worker
import test_read_transport as tf
import test_read_surface as wf
from test_runtime import OZ,WB
TODAY=date(2026,11,9)
BASIC={'date_from':'2026-11-01','date_to':'2026-11-08','dimension':['day'],'metrics':['revenue','ordered_units'],'limit':100}
def req(alias,params=None,as_of=TODAY):return sa.requirement('ozon',alias,{}if params is None else params,as_of)
class Labels(unittest.TestCase):
 def test_all303ozon_methods_have_labels(self):self.assertEqual(set(sa.POLICY['methods']),set(rs.CATALOG['providers']['ozon']['operations']));self.assertEqual(len(sa.POLICY['methods']),303)
 def test_all490read_methods_unchanged(self):self.assertEqual(sum(len(p['operations'])for p in rs.CATALOG['providers'].values()),490)
 def test_all_source_references_resolve(self):
  for row in sa.POLICY['methods'].values():self.assertTrue(all(x in sa.POLICY['sources']for x in row['evidence']))
 def test_basic_analytics_does_not_require_plus(self):
  r=req('analytics_data',BASIC);self.assertEqual(r['request_access'],'NO_PAID_REQUIREMENT_DOCUMENTED');self.assertEqual(r['required_products'],[])
 def test_no_whole_endpoint_paid_lock(self):self.assertEqual(sa.method_label('ozon','analytics_data')['base_access'],'BASE_PARAMETERS_AVAILABLE');rs.build('ozon','analytics_data',BASIC)
 def test_paid_metrics(self):
  r=req('analytics_data',{**BASIC,'metrics':['hits_view']});self.assertEqual(r['required_products'],['PREMIUM_PLUS','PREMIUM_PRO'])
 def test_paid_dimension(self):self.assertEqual(req('analytics_data',{**BASIC,'dimension':['brand']})['request_access'],'PAID_REQUIREMENT_DOCUMENTED')
 def test_premium_does_not_satisfy_plus(self):self.assertNotIn('PREMIUM',req('analytics_data',{**BASIC,'metrics':['hits_view']})['required_products'])
 def test_lite_not_plus(self):self.assertNotIn('PREMIUM_LITE',req('analytics_data',{**BASIC,'metrics':['hits_view']})['required_products'])
 def test_sort_by_paid_metric_is_paid(self):self.assertTrue(req('analytics_data',{**BASIC,'sort':[{'key':'hits_view','order':'DESC'}]})['required_products'])
 def test_filter_by_paid_dimension_is_paid(self):self.assertTrue(req('analytics_data',{**BASIC,'filters':[{'key':'brand','value':'x'}]})['required_products'])
 def test_unknown_metric_not_free(self):self.assertEqual(req('analytics_data',{**BASIC,'metrics':['new_metric']})['request_access'],'UNKNOWN')
 def test_unknown_dimension_not_free(self):self.assertEqual(req('analytics_data',{**BASIC,'dimension':['category4']})['request_access'],'UNKNOWN')
 def test_unknown_sort_not_free(self):self.assertEqual(req('analytics_data',{**BASIC,'sort':[{'key':'new_metric'}]})['request_access'],'UNKNOWN')
 def test_older_history_requires_plus(self):self.assertTrue(req('analytics_data',{**BASIC,'date_from':'2026-08-08'})['required_products'])
 def test_exact_three_month_boundary_is_not_older(self):self.assertEqual(req('analytics_data',{**BASIC,'date_from':'2026-08-09'})['required_products'],[])
 def test_months_not_ninety_days(self):self.assertEqual(req('analytics_data',{**BASIC,'date_from':'2026-02-28'},date(2026,5,31))['required_products'],[])
 def test_moscow_date_boundary(self):self.assertEqual(req('product_queries',{'date_from':'2026-10-09T00:00:00+03:00'})['required_products'],[])
 def test_product_queries_old_date_premium_plus_pro(self):self.assertEqual(req('product_queries',{'date_from':'2026-10-08T00:00:00Z'})['required_products'],['PREMIUM','PREMIUM_PLUS','PREMIUM_PRO'])
 def test_recent_product_queries_partial_not_full(self):
  r=req('product_queries',{'date_from':'2026-11-01T00:00:00Z'});self.assertTrue(r['may_have_limited_response']);self.assertEqual(r['request_access'],'BASE_WITH_LIMITED_RESPONSE')
 def test_product_query_sort_paid(self):self.assertEqual(req('product_queries_details',{'sort_by':'BY_VIEWS','date_from':'2026-11-01T00:00:00Z'})['required_products'],['PREMIUM','PREMIUM_PLUS','PREMIUM_PRO'])
 def test_invalid_date_is_unknown_not_paid(self):self.assertEqual(req('analytics_data',{**BASIC,'date_from':'nonsense'})['request_access'],'UNKNOWN')
 def test_input_is_not_modified(self):v=deepcopy(BASIC);req('analytics_data',v);self.assertEqual(v,BASIC)
 def test_unknown_method_no_invented_label(self):self.assertEqual(req('made_up')['request_access'],'UNKNOWN')
 def test_no_access_proof_from_label(self):self.assertEqual(req('question_count')['account_access'],'NOT_CHECKED')
 def test_ordinary_from_snapshot_is_qualified(self):self.assertEqual(req('seller_product_list')['evidence_basis'],'PINNED_DONOR_SNAPSHOT')
 def test_uncovered_method_stays_unknown(self):self.assertEqual(req('fbp_order_list')['group'],'UNKNOWN')
 def test_performance_is_separate(self):self.assertEqual(req('performance_campaigns')['request_access'],'SEPARATE_ACCESS_POLICY')
 def test_file_is_not_a_premium_request(self):self.assertEqual(req('report_file_get')['group'],'FILE_RESOURCE_ACCESS')
 def test_retired_status_preserved(self):self.assertEqual(req('finance_transaction_list_v3')['request_access'],'RETIRED')
 def test_reviews_current_addon_or_pro_not_obsolete_plus(self):self.assertEqual(req('review_list')['required_products'],['PREMIUM_PRO','REVIEWS_MANAGEMENT']);self.assertNotIn('PREMIUM_PLUS',req('review_list')['required_products'])
 def test_review_public_oauth_exception_not_auto_applied(self):self.assertTrue(req('review_list')['auth_exceptions'][0]['verified_connection_required']);self.assertEqual(req('review_list')['account_access'],'NOT_CHECKED')
 def test_discovery_shows_access_label(self):
  row=next(x for x in rs.discover('ozon','question_count')['items']if x['operation']=='question_count');self.assertEqual(row['subscription_access']['group'],'PREMIUM_PLUS_OR_PRO')
 def test_wb_not_marked_ozon_premium(self):self.assertEqual(sa.method_label('wb','seller_users')['group'],'OTHER_PROVIDER')
for alias in ['product_price_details','marketplace_search_queries_text','marketplace_search_queries_top']:
 def pro(self,alias=alias):self.assertEqual(req(alias)['required_products'],['PREMIUM_PRO'])
 setattr(Labels,'test_pro_'+alias,pro)
for alias in ['question_list','question_count','question_info','question_answer_list','question_top_sku','finance_realization_by_day','chat_history_v3']:
 def plus(self,alias=alias):self.assertEqual(req(alias)['required_products'],['PREMIUM_PLUS','PREMIUM_PRO'])
 setattr(Labels,'test_plus_'+alias,plus)
class Diagnosis(unittest.TestCase):
 def d(self,text,path='/v1/question/count',status=403,code=7,host='api-seller.ozon.ru'):
  return diagnose_denial('read.ozon.question_count','https://'+host+path,status,json.dumps({'code':code,'message':text}).encode())
 def test_specific_plus(self):self.assertEqual(self.d('Premium Plus subscription is required')['tier_public_code'],'HTTP_403_OZON_PREMIUM_PLUS_REQUIRED')
 def test_specific_pro(self):self.assertEqual(self.d('Premium Pro subscription required',path='/v1/product/prices/details')['tier_public_code'],'HTTP_403_OZON_PREMIUM_PRO_REQUIRED')
 def test_plus_or_pro(self):self.assertEqual(self.d('Only Premium Plus or Premium Pro subscription is allowed')['tier_public_code'],'HTTP_403_OZON_PLUS_OR_PRO_REQUIRED')
 def test_review_addon(self):self.assertEqual(self.d('Требуется подписка Управление отзывами',path='/v2/review/count')['tier_public_code'],'HTTP_403_OZON_REVIEWS_REQUIRED')
 def test_documented_pro_does_not_prove_cause_of_generic403(self):self.assertNotIn('tier_public_code',self.d('access denied',path='/v1/product/prices/details'))
 def test_current_review_rule_conflict_is_not_hidden(self):self.assertEqual(self.d('Premium Plus subscription required',path='/v2/review/count')['tier_public_code'],'HTTP_403_OZON_ACCESS_POLICY_CONFLICT')
 def test_no_purchase_from_active_mention(self):self.assertNotIn('tier_public_code',self.d('Premium Plus subscription active; access denied'))
 def test_separate_permission_clause_not_subscription(self):self.assertNotIn('tier_public_code',self.d('Premium Plus subscription active; required permissions missing'))
 def test_negated_subscription_requirement_not_purchase(self):
  d=self.d('Premium Plus subscription is not required');self.assertNotIn('tier_public_code',d);self.assertEqual(d['public_code'],'HTTP_403')
 def test_ordinary_premium_not_merged_with_plus(self):self.assertEqual(self.d('Premium subscription required',path='/v1/analytics/product-queries')['tier_public_code'],'HTTP_403_OZON_PREMIUM_REQUIRED')
 def test_other_host_not_ozon(self):self.assertNotIn('tier_public_code',self.d('Premium Plus subscription required',host='invalid.example'))
 def test_wrong_status_not_subscription(self):self.assertNotIn('tier_public_code',self.d('Premium Plus subscription required',status=429))
 def test_role_error_not_subscription(self):self.assertEqual(self.d('insufficient permissions for method')['public_code'],'HTTP_403_OZON_METHOD_PERMISSION')
 def test_no_personal_message_export(self):
  p=self.d('Premium Plus subscription required SECRET_KEY private@example.invalid');self.assertNotIn('SECRET',json.dumps(p));self.assertNotIn('example.invalid',json.dumps(p))
class Transport(unittest.TestCase):
 setUp=tf.ReadTransport.setUp;tearDown=tf.ReadTransport.tearDown
 def test_precise_error_is_returned_without_retry_or_body(self):
  body=io.BytesIO(b'{"code":7,"message":"Premium Pro subscription required PRIVATE"}');error=urllib.error.HTTPError('https://api-seller.ozon.ru/v1/product/prices/details',403,'Forbidden',{},body)
  r=rs.request_for(asdict(OZ),'product_price_details',{'skus':['123']})
  with patch('http_transport.read_response',side_effect=error)as http,patch('builtins.print')as output:
   with self.assertRaises(CallError)as caught:self.t.execute(r,asdict(OZ))
  self.assertEqual(caught.exception.status,403);self.assertEqual(caught.exception.code,'HTTP_403_OZON_PREMIUM_PRO_REQUIRED');self.assertFalse(caught.exception.unknown);self.assertEqual(http.call_count,1);self.assertTrue(body.closed);self.assertNotIn('PRIVATE',str(output.call_args_list))
 def test_account_not_assumed_from_static_label(self):
  request=rs.request_for(asdict(OZ),'question_count',{})
  with patch('http_transport.read_response',return_value=(b'{"all":0}',200))as http:answer,_=self.t.execute(request,asdict(OZ))
  self.assertEqual(answer['all'],0);self.assertEqual(http.call_count,1)
if __name__=='__main__':
 suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [Labels,Diagnosis,Transport]);r=unittest.TextTestRunner(verbosity=2).run(suite);print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'real_provider_calls':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
