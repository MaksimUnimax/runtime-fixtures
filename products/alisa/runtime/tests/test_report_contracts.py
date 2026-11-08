import copy,json,unittest
from pathlib import Path
from decimal import Decimal,ROUND_HALF_UP
from report_contracts import ReportContracts,ContractError
ROOT=Path(__file__).resolve().parents[1]
CAT=json.loads((ROOT/'report_contract_catalog.json').read_text())
GOLD=json.loads((Path(__file__).with_name('fixtures')/'tester_ads_gold.json').read_text())
NOW=2000000000.
class ReportContractTests(unittest.TestCase):
 def setUp(self):
  self.gate=ReportContracts(CAT)
  self.ctx={'scope_hash':'a'*64,'period':{'from':'2030-01-02','to':'2030-01-02'},'currency':'RUB','mode':'period_financial_result_per_ordered_unit','as_of':NOW-60,'catalog_hash':'b'*64}
  values={'ordered_units':'10','marketplace_costs':'400','advertising':'100','advertising_finance_overlap':'1','expense_coverage':'1','cpo_detail':'80','cogs':'200'}
  self.obs=[]
  for key,value in values.items():self.obs.append(self.observation(key,value))
 def observation(self,cid,value):
  r=CAT['policies']['period_unit_expenses']['components'][cid]
  keys=[cid+'-charge'] if r['role']=='contribution' else []
  return {'id':cid,'state':'KNOWN','coverage':'COMPLETE','value':value,'currency':'RUB','period':copy.deepcopy(self.ctx['period']),'scope_hash':self.ctx['scope_hash'],'axis':r['axes'][0],'unit':r['unit'],'source_hash':'c'*64,'receipt_hash':'d'*64,'observed_at':NOW-30,'expires_at':NOW+30,'zero_proof':value=='0','expense_keys':keys}
 def result(self,verify=lambda r,c:True):return self.gate.evaluate('period_unit_expenses',self.ctx,self.obs,verify=verify,now=NOW)
 def row(self,cid):return next(x for x in self.obs if x['id']==cid)
 def blocked(self,code):
  r=self.result();self.assertFalse(r['usable']);self.assertEqual(r['values'],{});self.assertIn(code,[x['reason_code'] for x in r['reasons']]);self.assertFalse(r['report_saved'])
 def missing(self,cid,state='NOT_PROVIDED'):
  r=self.row(cid);r.update(state=state,value=None,zero_proof=False,expense_keys=[])
 def test_period_qualified_allows_calculation_not_saved_report(self):
  r=self.result();self.assertTrue(r['usable']);self.assertEqual(r['status'],'READY_FOR_CALCULATION');self.assertFalse(r['report_saved']);self.assertIn('не прибыль',r['label'])
 def test_gold_ratio_of_totals_not_product_cost(self):
  r=self.result();v=r['values'];spend=sum(Decimal(v[x]) for x in ('marketplace_costs','advertising','cogs'))
  self.assertEqual(spend,Decimal(GOLD['expected']['total_expenses']))
  self.assertEqual((spend/Decimal(v['ordered_units'])).quantize(Decimal('.01')),Decimal(GOLD['expected']['cost_per_ordered_unit']))
  self.assertNotEqual(spend/Decimal(v['ordered_units']),Decimal(GOLD['expected']['product_cost_model']))
 def test_cpo_control_not_contribution(self):
  r=self.result();self.assertIn('cpo_detail',r['controls']);self.assertNotIn('cpo_detail',r['values']);self.assertNotIn('cpo_detail',r['included'])
 def test_cpo_reuses_ads_keys_without_double_count(self):self.row('cpo_detail')['expense_keys']=self.row('advertising')['expense_keys'];self.assertTrue(self.result()['usable'])
 def test_missing_ads_blocks(self):self.obs.remove(self.row('advertising'));self.blocked('REPORT_REQUIRED_COMPONENT_MISSING')
 def test_unknown_ads_blocks(self):self.missing('advertising','UNKNOWN');self.blocked('REPORT_REQUIRED_COMPONENT_MISSING')
 def test_excluded_required_ads_blocks(self):self.missing('advertising','EXCLUDED_BY_USER');self.blocked('REPORT_REQUIRED_COMPONENT_MISSING')
 def test_partial_ads_blocks(self):self.row('advertising')['coverage']='PARTIAL';self.blocked('REPORT_COVERAGE_INCOMPLETE')
 def test_unknown_coverage_blocks(self):self.row('advertising')['coverage']='UNKNOWN';self.blocked('REPORT_COVERAGE_INCOMPLETE')
 def test_zero_needs_evidence(self):self.row('advertising').update(value='0',zero_proof=False);self.blocked('REPORT_ZERO_UNPROVEN')
 def test_qualified_explicit_zero(self):self.row('advertising').update(value='0',zero_proof=True,expense_keys=[]);self.assertEqual(self.result()['values']['advertising'],'0')
 def test_missing_cogs_labeled_not_zero(self):self.obs.remove(self.row('cogs'));r=self.result();self.assertTrue(r['usable']);self.assertNotIn('cogs',r['values']);self.assertTrue(any(o['component']=='cogs' for o in r['omissions']))
 def test_known_zero_cogs_distinct(self):self.row('cogs').update(value='0',zero_proof=True,expense_keys=[]);r=self.result();self.assertEqual(r['values']['cogs'],'0');self.assertFalse(any(x['component']=='cogs' for x in r['omissions']))
 def test_missing_tax_labeled(self):self.assertTrue(any(o['component']=='tax' and o['state']=='NOT_PROVIDED' for o in self.result()['omissions']))
 def test_explicit_excluded_tax_verified(self):
  r=self.observation('tax','0');r.update(state='EXCLUDED_BY_USER',value=None,zero_proof=False,expense_keys=[]);self.obs.append(r)
  result=self.result();self.assertTrue(result['usable']);self.assertTrue(any(o['component']=='tax' and o['state']=='EXCLUDED_BY_USER' for o in result['omissions']))
 def test_excluded_tax_not_trusted_from_json(self):
  r=self.observation('tax','0');r.update(state='EXCLUDED_BY_USER',value=None,zero_proof=False,expense_keys=[]);self.obs.append(r)
  result=self.result(lambda row,ctx:row['id']!='tax');self.assertFalse(result['usable'])
 def test_missing_numeric_cannot_fake_zero(self):
  self.row('advertising').update(state='UNKNOWN',value='0')
  with self.assertRaisesRegex(ContractError,'REPORT_MISSING_NOT_ZERO'):self.result()
 def test_controls_required(self):self.obs.remove(self.row('expense_coverage'));self.blocked('REPORT_REQUIRED_COMPONENT_MISSING')
 def test_overlap_control_required(self):self.obs.remove(self.row('advertising_finance_overlap'));self.blocked('REPORT_REQUIRED_COMPONENT_MISSING')
 def test_duplicate_expense_keys_blocks(self):self.row('advertising')['expense_keys']=self.row('marketplace_costs')['expense_keys'];self.blocked('REPORT_OVERLAP_UNRESOLVED')
 def test_unknown_expense_identity_blocks(self):self.row('advertising')['expense_keys']=[];self.blocked('REPORT_OVERLAP_UNRESOLVED')
 def test_repeated_key_in_one_component(self):self.row('advertising')['expense_keys']=['a','a'];self.blocked('REPORT_EXPENSE_KEYS')
 def test_receipt_required(self):self.row('advertising')['receipt_hash']=None;self.blocked('REPORT_EVIDENCE_INVALID')
 def test_source_hash_required(self):self.row('advertising')['source_hash']='bad';self.blocked('REPORT_EVIDENCE_INVALID')
 def test_expired_evidence(self):self.row('advertising')['expires_at']=NOW;self.blocked('REPORT_EVIDENCE_EXPIRED')
 def test_future_evidence(self):self.row('advertising')['observed_at']=NOW+1;self.blocked('REPORT_EVIDENCE_EXPIRED')
 def test_before_as_of(self):self.row('advertising')['observed_at']=NOW-120;self.blocked('REPORT_EVIDENCE_EXPIRED')
 def test_wrong_scope(self):self.row('advertising')['scope_hash']='e'*64;self.blocked('REPORT_SCOPE_MISMATCH')
 def test_wrong_currency(self):self.row('advertising')['currency']='USD';self.blocked('REPORT_SCOPE_MISMATCH')
 def test_wrong_period(self):self.row('advertising')['period']={'from':'2030-01-01','to':'2030-01-02'};self.blocked('REPORT_SCOPE_MISMATCH')
 def test_wrong_axis(self):self.row('advertising')['axis']='order_date';self.blocked('REPORT_SCOPE_MISMATCH')
 def test_wrong_unit(self):self.row('ordered_units')['unit']='count';self.blocked('REPORT_SCOPE_MISMATCH')
 def test_fractional_items(self):self.row('ordered_units')['value']='10.5';self.blocked('REPORT_VALUE_INVALID')
 def test_negative_ads(self):self.row('advertising')['value']='-1';self.blocked('REPORT_VALUE_INVALID')
 def test_signed_adjustment_is_allowed(self):self.row('marketplace_costs')['value']='-1';self.assertTrue(self.result()['usable'])
 def test_nonfinite(self):self.row('advertising')['value']='NaN';self.blocked('REPORT_VALUE_INVALID')
 def test_boolean_money(self):self.row('advertising')['value']=True;self.blocked('REPORT_VALUE_INVALID')
 def test_float_money_rejected(self):self.row('advertising')['value']=100.;self.blocked('REPORT_VALUE_INVALID')
 def test_no_verifier(self):r=self.result(None);self.assertFalse(r['usable']);self.assertTrue(all(x['reason_code']=='REPORT_EVIDENCE_VERIFIER_REQUIRED' for x in r['reasons']))
 def test_verifier_integer_not_true(self):r=self.result(lambda r,c:1);self.assertFalse(r['usable'])
 def test_verifier_error(self):
  def broken(r,c):raise RuntimeError('secret')
  result=self.result(broken);self.assertFalse(result['usable']);self.assertNotIn('secret',json.dumps(result))
 def test_verifier_gets_copy(self):
  before=copy.deepcopy((self.obs,self.ctx))
  def mutate(r,c):r['value']='0';c.clear();return True
  self.assertTrue(self.result(mutate)['usable']);self.assertEqual(before,(self.obs,self.ctx))
 def test_duplicate_component_rejected(self):
  self.obs.append(copy.deepcopy(self.row('advertising')))
  with self.assertRaisesRegex(ContractError,'REPORT_OBSERVATION_DUPLICATE'):self.result()
 def test_unknown_component_rejected(self):
  r=copy.deepcopy(self.row('advertising'));r['id']='injected';self.obs.append(r)
  with self.assertRaisesRegex(ContractError,'REPORT_OBSERVATION_UNKNOWN'):self.result()
 def test_extra_observation_field_rejected(self):
  self.row('advertising')['token']='not-real'
  with self.assertRaisesRegex(ContractError,'REPORT_OBSERVATIONS_SCHEMA'):self.result()
 def test_cohort_not_inferred(self):
  self.ctx['mode']='order_cohort'
  with self.assertRaisesRegex(ContractError,'REPORT_SCOPE_MISMATCH'):self.result()
 def test_extra_context_rejected(self):
  self.ctx['approved']=True
  with self.assertRaisesRegex(ContractError,'REPORT_SCOPE_MISMATCH'):self.result()
 def test_unknown_policy_rejected(self):
  with self.assertRaisesRegex(ContractError,'REPORT_CONTRACT_UNKNOWN'):self.gate.evaluate('unknown',self.ctx,self.obs,verify=None,now=NOW)
 def test_catalog_does_not_mutate(self):
  d=self.gate.definition;d['version']='tampered';self.assertNotEqual(d,self.gate.definition)
 def test_catalog_bad_role_rejected(self):
  d=copy.deepcopy(CAT);d['policies']['period_unit_expenses']['components']['advertising']['role']='eval'
  with self.assertRaises(ContractError):ReportContracts(d)
 def test_json_only_new_policy(self):
  d=copy.deepcopy(CAT);p=copy.deepcopy(d['policies']['period_unit_expenses']);p['label']='Другая проверенная совокупность';d['policies']['another_period_contract']=p
  m=ReportContracts(d);r=m.evaluate('another_period_contract',self.ctx,self.obs,verify=lambda r,c:True,now=NOW)
  self.assertTrue(r['usable']);self.assertEqual(r['label'],p['label'])
if __name__=='__main__':unittest.main()
