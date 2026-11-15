from copy import deepcopy
from dataclasses import replace
from unittest import TestCase
from hashlib import sha256
import json
from alisa_platform.owner_data import economics_periods as p,economics_cohort as e
from economics_cohort import fixtures as f

SCOPE=deepcopy(f.TARGET);PERIOD=deepcopy(f.PERIOD);PROOF={'campaign_scope':'all_campaigns','response_contract_verified':True,'currency':'RUB'}
NOW='2026-11-15T12:00:00Z'
def packet(op,data,rid,period=None):
 q=period or PERIOD;keys=p.CATALOG['sources']['storage'if op=='finance_balance'else'advertising']['request_keys']
 body=json.dumps(data).encode();return {'operation':op,'scope':deepcopy(SCOPE),'request':dict(zip(keys,(q['from'],q['to']))),'body':body,'response_sha256':sha256(body).hexdigest(),'receipt_id':rid,'received_at':'2026-11-15T00:00:00Z','http':200}
def fixtures():
 return [packet('finance_balance',{'cashflows':{'services':[{'name':'product_placement_in_ozon_warehouses','amount':{'value':'-30','currency_code':'RUB'}},{'name':'logistics','amount':{'value':'-999','currency_code':'RUB'}}]}},'storage-receipt'),
         packet('ozon_ads_daily',{'rows':[{'id':'12','date':'13.11.2026','moneySpent':'100,00','ordersMoney':'99999','title':'PRIVATE CAMPAIGN'}]},'ads-receipt')]
def change(packet,fn):
 data=json.loads(packet['body']);fn(data);packet['body']=json.dumps(data).encode();packet['response_sha256']=sha256(packet['body']).hexdigest()
def normalize(data=None,period=None,verify=None,scopeproof=None):
 data=fixtures()if data is None else data;known=deepcopy(data)
 return p.normalize(data,SCOPE,period or PERIOD,verify=verify or(lambda row,proof:row in known and proof==PROOF),scope_proof=PROOF if scopeproof is None else scopeproof,as_of=NOW)
class PeriodCosts(TestCase):
 def test_same_period_two_expenses_exact(self):
  r=normalize();self.assertEqual(r.data['rows'],[{'amount':'100','basis':'FULL_PERIOD','component':'advertising'},{'amount':'30','basis':'FULL_PERIOD','component':'storage'}]);self.assertFalse(r.data['all_other_fees_complete'])
 def test_finance_logistics_not_readded(self):self.assertEqual(normalize().data['rows'][1]['amount'],'30')
 def test_explicit_zero_is_real(self):
  x=fixtures();change(x[0],lambda d:d['cashflows']['services'][0]['amount'].update(value='0'));change(x[1],lambda d:d['rows'][0].update(moneySpent='0'));self.assertTrue(all(r['amount']=='0'for r in normalize(x).data['rows']))
 def test_missing_storage_row_not_zero(self):
  x=fixtures();change(x[0],lambda d:d['cashflows'].update(services=[]))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_null_storage_not_zero(self):
  x=fixtures();change(x[0],lambda d:d['cashflows']['services'][0]['amount'].update(value=None))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_empty_ads_not_zero(self):
  x=fixtures();change(x[1],lambda d:d.update(rows=[]))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_partial_campaign_scope_denied(self):
  with self.assertRaises(p.PeriodCostError):normalize(scopeproof={**PROOF,'campaign_scope':'active_only'})
 def test_untrusted_receipt_rejected(self):
  with self.assertRaises(p.PeriodCostError):normalize(verify=lambda *a:False)
 def test_verifier_failure_not_source_success(self):
  def bad(*a):raise RuntimeError()
  with self.assertRaises(p.PeriodCostError):normalize(verify=bad)
 def test_boolean_not_money(self):
  x=fixtures();change(x[1],lambda d:d['rows'][0].update(moneySpent=True))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_negative_ads_not_positive_expense(self):
  x=fixtures();change(x[1],lambda d:d['rows'][0].update(moneySpent='-1'))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_storage_credit_not_abs_or_zero(self):
  x=fixtures();change(x[0],lambda d:d['cashflows']['services'][0]['amount'].update(value='10'))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_currency_mismatch_refused(self):
  x=fixtures();change(x[0],lambda d:d['cashflows']['services'][0]['amount'].update(currency_code='USD'))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_repeated_service_not_silently_summed(self):
  x=fixtures();change(x[0],lambda d:d['cashflows']['services'].append(deepcopy(d['cashflows']['services'][0])))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_repeated_campaign_day_not_double_counted(self):
  x=fixtures();change(x[1],lambda d:d['rows'].append(deepcopy(d['rows'][0])))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_two_campaigns_same_day_are_both_counted(self):
  x=fixtures();change(x[1],lambda d:d['rows'].append({**d['rows'][0],'id':'13'}));self.assertEqual(normalize(x).data['rows'][0]['amount'],'200')
 def test_daily_date_iso_and_russian_equal(self):
  x=fixtures();change(x[1],lambda d:d['rows'][0].update(date='2026-11-13'));self.assertEqual(normalize(x).data['rows'][0]['amount'],'100')
 def test_foreign_date_rejected(self):
  x=fixtures();change(x[1],lambda d:d['rows'][0].update(date='2026-11-12'))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_malformed_date_rejected(self):
  x=fixtures();change(x[1],lambda d:d['rows'][0].update(date='2026-02-30'))
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_missing_day_not_invented_as_zero(self):
  period={'from':'2026-11-12','to':'2026-11-13'};x=fixtures()
  for r in x:
   keys=list(r['request']);r['request']={keys[0]:period['from'],keys[1]:period['to']}
  with self.assertRaises(p.PeriodCostError):normalize(x,period=period)
 def test_other_store_rejected(self):
  x=fixtures();x[0]['scope']['store_id']='other'
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_wrong_body_hash_rejected(self):
  x=fixtures();x[0]['response_sha256']='a'*64
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_no_200_not_success(self):
  x=fixtures();x[0]['http']=429
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_reused_receipt_rejected(self):
  x=fixtures();x[1]['receipt_id']=x[0]['receipt_id']
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_missing_one_source_not_success(self):
  with self.assertRaises(p.PeriodCostError):normalize(fixtures()[:1])
 def test_overlapping_windows_not_added_twice(self):
  x=fixtures();x.append({**deepcopy(x[0]),'receipt_id':'second-storage'})
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_open_period_not_full_day(self):
  x=fixtures();period={'from':'2026-11-15','to':'2026-11-15'}
  with self.assertRaises(p.PeriodCostError):normalize(x,period=period)
 def test_source_clock_from_future_refused(self):
  x=fixtures();x[0]['received_at']='2026-11-16T00:00:00Z'
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_duplicate_json_key_denied(self):
  x=fixtures();x[1]['body']=b'{"rows":[],"rows":[]}';x[1]['response_sha256']=sha256(x[1]['body']).hexdigest()
  with self.assertRaises(p.PeriodCostError):normalize(x)
 def test_checkpoint_no_amount_titles_or_raw_receipt_ids(self):
  r=normalize();text=json.dumps(r.checkpoint());self.assertNotIn('PRIVATE',text);self.assertNotIn('100,00',text);self.assertNotIn('ads-receipt',text);self.assertNotIn('storage-receipt',text)
 def test_forged_constructor_refused(self):
  r=normalize();fake=p.PeriodCosts(r.payload_json,'forged')
  with self.assertRaises(p.PeriodCostError):fake.as_source()
 def test_changed_payload_refused(self):
  r=normalize();data=r.data;data['rows'][0]['amount']='999';fake=replace(r,payload_json=p.c.CANON(data))
  with self.assertRaises(p.PeriodCostError):fake.as_source()
 def test_data_property_returns_copy(self):
  r=normalize();data=r.data;data['rows'].clear();self.assertEqual(len(r.data['rows']),2)
 def test_sources_not_mutated(self):
  x=fixtures();before=deepcopy(x);normalize(x);self.assertEqual(x,before)
 def test_qualified_period_source_reaches_existing_nine_group_formula(self):
  r=normalize();data=f.bundle();data['period_costs']=r.as_source();known={k:e.c.CANON(v)for k,v in data.items()if k!='period_costs'}
  q=e.qualify(data,SCOPE,PERIOD,verify=lambda n,v,t,pd:r.verifies(n,v,t,pd)if n=='period_costs'else known[n]==e.c.CANON(v))
  costs,coeffs=f.numbers(q);answer=e.calculate(q,costs,coeffs,f.unknown())
  for scenario in answer['scenarios'].values():self.assertEqual(scenario['totals']['storage'],'30');self.assertEqual(scenario['totals']['advertising'],'100');self.assertIsNone(scenario['after_declared_owner_inputs'])
 def test_bonus_prepayment_and_attributed_sales_not_added(self):
  x=fixtures();change(x[1],lambda d:d['rows'][0].update(bonusSpent='200',prepaymentSpent='300',ordersMoney='90000'));self.assertEqual(normalize(x).data['rows'][0]['amount'],'100')
 def test_money_commas_spaces_and_decimal_precision(self):
  x=fixtures();change(x[1],lambda d:d['rows'][0].update(moneySpent='1\u00a0000,123456789'));self.assertEqual(normalize(x).data['rows'][0]['amount'],'1000.123456789')

 def test_money_larger_than_existing_financial_representation_refused(self):
  x=fixtures();change(x[1],lambda d:d['rows'][0].update(moneySpent='1'+'0'*60))
  with self.assertRaises(p.PeriodCostError)as error:normalize(x)
  self.assertEqual(error.exception.code,'PERIOD_COST_MONEY_PRECISION')
 def test_sum_carry_beyond_financial_representation_refused(self):
  x=fixtures();change(x[1],lambda d:d.update(rows=[{**d['rows'][0],'moneySpent':'9'*60},{**d['rows'][0],'id':'13','moneySpent':'1'}]))
  with self.assertRaises(p.PeriodCostError)as error:normalize(x)
  self.assertEqual(error.exception.code,'PERIOD_COST_MONEY_PRECISION')
 def test_small_fraction_must_not_disappear_next_to_large_amount(self):
  x=fixtures();change(x[1],lambda d:d.update(rows=[{**d['rows'][0],'moneySpent':'1'+'0'*59},{**d['rows'][0],'id':'13','moneySpent':'0.1'}]))
  with self.assertRaises(p.PeriodCostError)as error:normalize(x)
  self.assertEqual(error.exception.code,'PERIOD_COST_MONEY_PRECISION')
 def test_sixty_digit_exact_sum_keeps_low_units(self):
  x=fixtures();large='1'+'0'*59;change(x[1],lambda d:d.update(rows=[{**d['rows'][0],'moneySpent':large},{**d['rows'][0],'id':'13','moneySpent':'1'}]))
  self.assertEqual(normalize(x).data['rows'][0]['amount'],str(int(large)+1))
 def test_exact_sum_independent_of_ambient_decimal_context(self):
  from decimal import localcontext
  x=fixtures();change(x[1],lambda d:d.update(rows=[{**d['rows'][0],'moneySpent':'1000000000000000000.123456789'},{**d['rows'][0],'id':'13','moneySpent':'0.000000001'}]))
  with localcontext()as context:
   context.prec=6
   self.assertEqual(normalize(x).data['rows'][0]['amount'],'1000000000000000000.12345679')
 def test_precision_failure_does_not_modify_packets_or_return_object(self):
  x=fixtures();change(x[0],lambda d:d['cashflows']['services'][0]['amount'].update(value='-'+'1'+'0'*60));before=deepcopy(x)
  with self.assertRaises(p.PeriodCostError):normalize(x)
  self.assertEqual(x,before)
