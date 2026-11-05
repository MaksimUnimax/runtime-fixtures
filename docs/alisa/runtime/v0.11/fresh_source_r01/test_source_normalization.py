"""Synthetic provider-shaped fixtures for declarative source qualification.
No real data copied, no API, credentials or working DB. Independent gold2479/2002.
"""
from pathlib import Path
from copy import deepcopy
from decimal import Decimal
from datetime import datetime,timezone
from unittest.mock import patch
import hashlib,json,socket,tempfile,time,unittest
from normalized_source_engine import QualifiedSourceNormalizer,SourceError
from matrix_core import MatrixError
from cost_source_selector import SelectionError
from scenario_bindings import BindingError
ROOT=Path(__file__).parent;POLICY=json.loads((ROOT/'normalization_catalog.json').read_text())
BEFORE='without_cancellations_counterfactual';AFTER='with_actual_cancellations'

def money(value):return {'amount':str(value),'currency':'RUB'}
def fm(value):return {'value':str(value),'currency_code':'RUB'}
def item(sku,offer,price,qty):return {'sku':sku,'offer_id':offer,'price':money(price),'quantity':qty}
def posting(number,status,products):return {'posting_number':number,'order_number':'order-'+number,'created_at':'2026-11-04T09:00:00Z','in_process_at':'2026-11-04T09:00:00Z','parent_posting_number':'','status':status,'external_order':{'is_external':False},'products':products}
def tariff(sku,offer):
 c={}
 for scheme in ('fbo','fbs'):
  c.update({scheme+'_direct_flow_trans_min_amount':10,scheme+'_direct_flow_trans_max_amount':30,scheme+'_deliv_to_customer_amount':5,scheme+'_return_flow_amount':7 if scheme=='fbo'else 9,'sales_percent_'+scheme:10})
 c.update(fbs_first_mile_min_amount=0,fbs_first_mile_max_amount=10)
 return {'product_id':sku+100,'offer_id':offer,'acquiring':'2','commissions':c,'price':{'currency_code':'RUB'}}
def fee(kind,amount):return {'type_id':kind,'accrued':money(amount)}
def accrual(aid,date,total,**extra):return {'accrual_id':aid,'date':date,'unit_number':'','posting':None,'item_fees':None,'total_amount':money(total),**extra}

class Fixture:
 def __init__(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.now=int(time.time());self.policy=deepcopy(POLICY)
  self.bodies={
   'orders_fbo':{'postings':[posting('A','delivered',[item(1,'p1',1000,2)]),posting('C','cancelled',[item(3,'p3',800,1)])]},
   'orders_fbs':{'postings':[posting('B','delivering',[item(2,'p2',1200,1)])]},
   'products':{'result':{'items':[{'sku':n,'offer_id':'p'+str(n),'product_id':n+100}for n in (1,2,3)]}},
   'prices':{'items':[tariff(n,'p'+str(n))for n in (1,2,3)]},
   'fee_types':{'accrual_types':[{'id':1,'name':'Acquiring'},{'id':32,'name':'Logistic'},{'id':29,'name':'LastMileCourier'}]},
   'accruals':{'accruals':[accrual(1,'2026-11-04',-3,unit_number='order-A',item_fees={'fees':[{'sku':1,'quantity':2,'fees':[fee(1,-3)]}]}),accrual(2,'2026-11-04',-17)]},
   'accruals_asof':{'accruals':[accrual(3,'2026-11-05',-242,unit_number='A',posting={'products':[{'sku':1,'quantity':2,'commission':{'sale_commission':money(-200)},'delivery':{'services':[fee(32,-35),fee(29,-7)]}}]})]},
   'advertising':{'rows':[{'id':'one','date':'2026-11-04','moneySpent':'10,00'},{'id':'two','date':'2026-11-04','moneySpent':'5.00'}]},
   'finance':{'cashflows':{'sales':{'amount':fm(0),'fee':fm(0)},'returns':{'amount':fm(0),'fee':fm(0)},'services':[{'name':'acquiring','amount':fm(-3)},{'name':'promotion_with_cost_per_order','amount':fm(-10)},{'name':'pay_per_click','amount':fm(-5)},{'name':'product_placement_in_ozon_warehouses','amount':fm(-2)}]},'total':{'accrued':fm(-20)}}}
  self.scope=True;self.sync()
 def sync(self):
  now=self.now;self.manifest={'state':'ACQUIRED_COMPLETE','scope_hash':'a'*64,'period':{'from':'2026-11-04','to':'2026-11-04'},'started_utc':datetime.fromtimestamp(now-120,timezone.utc).isoformat(),'config_hash':'b'*64,'sources':{},'requests':[]}
  for seq,(role,body)in enumerate(self.bodies.items(),1):
   path=self.root/(role+'.json');path.write_text(json.dumps(body));h=hashlib.sha256(path.read_bytes()).hexdigest();period={'from':'2026-11-05','to':'2026-11-05'}if role=='accruals_asof'else{'from':'2026-11-04','to':'2026-11-04'}
   self.manifest['sources'][role]={'complete':True,'scope_hash':'a'*64,'recipe_hash':'c'*64,'period':period,'pages':[{'seq':seq,'parsed_body_path':str(path),'sha256':h}]}
   self.manifest['requests'].append({'seq':seq,'state':'RECEIVED','http':200,'finished_utc':datetime.fromtimestamp(now-60,timezone.utc).isoformat()})
 def normalizer(self):return QualifiedSourceNormalizer(self.policy,self.manifest,now=self.now,evidence_root=self.root,scope_guard=lambda:self.scope)
 def calculate(self):return self.normalizer().calculate()
 def close(self):self.temp.cleanup()

class Tests(unittest.TestCase):
 def setUp(self):self.f=Fixture()
 def tearDown(self):self.f.close()
 def bad(self,change=None,code=None,sync=True):
  if change:change()
  if sync:self.f.sync()
  with self.assertRaises((SourceError,MatrixError,SelectionError,BindingError))as caught:self.f.calculate()
  if code:self.assertEqual(getattr(caught.exception,'code',str(caught.exception)),code)
 def test_two_independent_totals(self):
  r=self.f.calculate();self.assertEqual(Decimal(r['result']['scenarios'][BEFORE]['subtotal']['total']),Decimal(2479));self.assertEqual(Decimal(r['result']['scenarios'][AFTER]['subtotal']['total']),Decimal(2002))
 def test_explicit_original_and_remaining_units(self):
  r=self.f.calculate()['result']['scenarios'][AFTER]['subtotal'];self.assertEqual((r['unit_denominator'],r['original_unit_denominator']),('3','4'));self.assertEqual(r['per_original_unit'],'500.5')
 def test_actual_and_tariff_separate(self):
  n=self.f.normalizer();n.calculate();g=n.artifacts['selected']['scenarios'][AFTER]['components'];self.assertEqual(g['commission_actual']['value'],'200');self.assertEqual(Decimal(g['commission_api_estimate']['value']),Decimal(120))
 def test_split_cpc_cpo_preserved(self):
  rows={x['component']:x for x in self.f.calculate()['result']['scenarios'][AFTER]['rows']};self.assertEqual(rows['advertising_cpc']['total'],'5');self.assertEqual(rows['advertising_cpo']['total'],'10');self.assertNotIn('advertising',rows)
 def test_owner_cost_not_price_field(self):
  rows={x['component']:x for x in self.f.calculate()['result']['scenarios'][AFTER]['rows']};self.assertEqual(rows['cogs']['total'],'750')
 def test_tax_and_own_omissions(self):
  result=self.f.calculate()['result']['scenarios'][AFTER];names={x['component']for x in result['eligibility']['omissions']};self.assertEqual(names,{'tax','own_costs'});self.assertIsNone(result['net_profit'])
 def test_unknown_cancellation_stage_estimate(self):
  n=self.f.normalizer();n.calculate();self.assertEqual(n.artifacts['selected']['scenarios'][AFTER]['components']['reverse_logistics_api_estimate']['value'],'7')
 def test_actual_window_is_distinct_from_cohort(self):
  r=self.f.calculate();self.assertEqual(r['source_window']['actual_lookup'],['2026-11-04','2026-11-05']);self.assertEqual(r['source_window']['cohort']['to'],'2026-11-04')
 def test_incomplete_bundle(self):self.f.manifest['state']='BLOCKED';self.bad(code='SOURCE_BUNDLE_INCOMPLETE',sync=False)
 def test_partial_source(self):self.f.manifest['sources']['prices']['complete']=False;self.bad(code='SOURCE_COVERAGE',sync=False)
 def test_changed_evidence(self):(self.f.root/'prices.json').write_text('{}');self.bad(code='SOURCE_EVIDENCE_CHANGED',sync=False)
 def test_expired_evidence(self):self.f.now+=8000;self.bad(code='SOURCE_EVIDENCE_EXPIRED',sync=False)
 def test_cross_source_scope(self):self.f.manifest['sources']['prices']['scope_hash']='f'*64;self.bad(code='SOURCE_COVERAGE',sync=False)
 def test_bad_http_receipt(self):self.f.manifest['requests'][0]['http']=429;self.bad(code='SOURCE_RECEIPT',sync=False)
 def test_unknown_http_receipt(self):self.f.manifest['requests'][0]['state']='UNKNOWN';self.bad(code='SOURCE_RECEIPT',sync=False)
 def test_duplicate_order(self):self.f.bodies['orders_fbo']['postings'].append(deepcopy(self.f.bodies['orders_fbo']['postings'][0]));self.bad(code='DUPLICATE_NORMALIZED_ROW')
 def test_ambiguous_order_sku_split(self):
  row=deepcopy(self.f.bodies['orders_fbo']['postings'][0]);row['posting_number']='A-split';self.f.bodies['orders_fbo']['postings'].append(row);self.bad(code='AMBIGUOUS_JOIN_KEY')
 def test_partial_return_child_not_second_order(self):self.f.bodies['orders_fbs']['postings'][0]['parent_posting_number']='A';self.bad(code='COHORT_PARENT_OR_EXTERNAL')
 def test_external_order_rejected(self):self.f.bodies['orders_fbs']['postings'][0]['external_order']['is_external']=True;self.bad(code='COHORT_PARENT_OR_EXTERNAL')
 def test_unknown_status(self):self.f.bodies['orders_fbo']['postings'][0]['status']='magic';self.bad(code='COHORT_CURRENCY_OR_STATUS')
 def test_outside_moscow_day(self):self.f.bodies['orders_fbo']['postings'][0]['created_at']='2026-11-03T08:00:00Z';self.bad(code='COHORT_OUTSIDE_PERIOD')
 def test_moscow_midnight_correct(self):self.f.bodies['orders_fbo']['postings'][0]['created_at']='2026-11-03T21:00:00Z';self.f.sync();self.assertEqual(self.f.calculate()['aggregates']['ordered_units'],'4')
 def test_wrong_order_currency(self):self.f.bodies['orders_fbo']['postings'][0]['products'][0]['price']['currency']='USD';self.bad(code='COHORT_CURRENCY_OR_STATUS')
 def test_fractional_units(self):self.f.bodies['orders_fbo']['postings'][0]['products'][0]['quantity']='1.5';self.bad(code='COHORT_QUANTITY')
 def test_zero_units(self):self.f.bodies['orders_fbo']['postings'][0]['products'][0]['quantity']=0;self.bad(code='COHORT_QUANTITY')
 def test_missing_product_mapping(self):self.f.bodies['products']['result']['items'].pop();self.bad(code='PRODUCT_MAPPING_MISSING')
 def test_missing_tariff_mapping(self):self.f.bodies['prices']['items'].pop();self.bad(code='TARIFF_MAPPING_MISSING')
 def test_wrong_tariff_currency(self):self.f.bodies['prices']['items'][0]['price']['currency_code']='USD';self.bad(code='TARIFF_CURRENCY')
 def test_missing_explicit_acquiring(self):del self.f.bodies['prices']['items'][0]['acquiring'];self.bad()
 def test_number_range_preserved_in_projection(self):self.f.bodies['prices']['items'][0]['acquiring']='1e-10000';self.bad(code='NUMBER_RANGE')
 def test_actual_quantity_mismatch(self):self.f.bodies['accruals']['accruals'][0]['item_fees']['fees'][0]['quantity']=1;self.bad(code='ACTUAL_QUANTITY_AMBIGUOUS')
 def test_unknown_fee_dictionary_type(self):self.f.bodies['accruals']['accruals'][0]['item_fees']['fees'][0]['fees'][0]['type_id']=999;self.bad(code='ACCRUAL_TYPE_MISSING')
 def test_unclassified_matched_fee(self):self.f.bodies['fee_types']['accrual_types'][0]['name']='UnclassifiedService';self.bad(code='MATCHED_COST_TYPE_NOT_CLASSIFIED')
 def test_wrong_actual_date(self):self.f.bodies['accruals_asof']['accruals'][0]['date']='2026-10-01';self.bad(code='ACTUAL_DATE_OUTSIDE_LOOKUP')
 def test_wrong_actual_currency(self):self.f.bodies['accruals']['accruals'][0]['item_fees']['fees'][0]['fees'][0]['accrued']['currency']='USD';self.bad(code='ACTUAL_CURRENCY')
 def test_duplicate_fee(self):self.f.bodies['accruals']['accruals'].append(deepcopy(self.f.bodies['accruals']['accruals'][0]));self.bad(code='DUPLICATE_NORMALIZED_ROW')
 def test_missing_ads_is_not_zero(self):self.f.bodies['advertising']['rows']=[];self.bad(code='ADVERTISING_EMPTY_UNCONFIRMED')
 def test_advertising_reconciliation(self):self.f.bodies['advertising']['rows'][0]['moneySpent']='11';self.bad(code='ADVERTISING_FINANCE_DISAGREEMENT')
 def test_advertising_period(self):self.f.bodies['advertising']['rows'][0]['date']='2026-11-03';self.bad(code='ADVERTISING_PERIOD')
 def test_duplicate_campaign_day(self):self.f.bodies['advertising']['rows'].append(deepcopy(self.f.bodies['advertising']['rows'][0]));self.bad(code='DUPLICATE_NORMALIZED_ROW')
 def test_unclassified_financial_service(self):self.f.bodies['finance']['cashflows']['services'].append({'name':'unknown','amount':fm(0)});self.bad(code='UNCLASSIFIED_FINANCE_SERVICE')
 def test_absent_storage_not_zero(self):self.f.bodies['finance']['cashflows']['services'].pop();self.bad(code='OVERHEAD_COMPONENT_MISSING')
 def test_finance_totals_consistency(self):self.f.bodies['finance']['total']['accrued']['value']='-19';self.bad(code='FINANCE_INTERNAL_RECONCILIATION')
 def test_accrual_finance_consistency(self):self.f.bodies['accruals']['accruals'][1]['total_amount']['amount']='-16';self.bad(code='ACCRUAL_FINANCE_RECONCILIATION')
 def test_finance_zero_other_currency_rejected(self):self.f.bodies['finance']['cashflows']['sales']['fee']['currency_code']='USD';self.bad(code='FINANCE_CURRENCY')
 def test_revoke_before_execution(self):self.f.scope=False;self.bad(code='SELECTION_AUTH_DENIED')
 def test_copy_policy_no_mutation(self):n=self.f.normalizer();old=n.hash;self.f.policy['version']='changed';self.assertEqual(n.hash,old)
 def test_denormalized_result_not_voice_claim(self):r=self.f.calculate();self.assertFalse(r['production_installed']);self.assertFalse(r['voice_tested']);self.assertFalse(r['result']['production_ready']);self.assertFalse(r['result']['financial_report_saved'])

if __name__=='__main__':
 attempts=[]
 def blocked(*a,**kw):attempts.append('network');raise AssertionError('NETWORK_FORBIDDEN')
 with patch.object(socket.socket,'connect',blocked),patch.object(socket,'getaddrinfo',blocked):r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Tests))
 print(json.dumps({'tests':r.testsRun,'errors':len(r.errors),'failures':len(r.failures),'skipped':len(r.skipped),'network_attempts':len(attempts),'source_kind':'SYNTHETIC','status':'PASS'if r.wasSuccessful()and not attempts else'FAIL'}));raise SystemExit(0 if r.wasSuccessful()and not attempts else 1)
