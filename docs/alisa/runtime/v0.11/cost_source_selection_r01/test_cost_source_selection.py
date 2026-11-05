"""Independent synthetic gold for source selection and the existing scenario engine.
No live databases, credentials, provider traffic or self-derived expected totals.
"""
from pathlib import Path
from copy import deepcopy
from decimal import Decimal
from unittest.mock import patch
from datetime import datetime,timezone
import inspect,json,os,socket,sys,unittest
ROOT=Path(__file__).parent
sys.path.insert(0,str(ROOT/'dependencies'))
from test_scenario_bindings import Fixture as ScenarioFixture,NOW,BEFORE,AFTER,SCOPE,PERIOD
from scenario_bindings import ScenarioBindings,BindingError
from owner_inputs import InputError
from report_contracts import ContractError
from cost_source_selector import CostSourceSelector,SelectionError,digest,number,text,BASES
import scenario_selection_adapter as adapter
CAT=json.loads((ROOT/'cost_selection_catalog.json').read_text())

class Fixture:
 def __init__(self):
  self.f=ScenarioFixture();self.catalog=deepcopy(CAT);self.selector=CostSourceSelector(self.catalog)
  self.context=deepcopy(self.f.context);self.cohort=self.f.env(self.f.cohort)
  common={k:deepcopy(v) for k,v in self.f.cohort.items() if k not in ('schema','coverage','rows')}
  self.payload={'schema':'alice-cost-candidates/v1',**common,'cohort_hash':self.cohort['sha256'],'records':[]}
  self.allowed=True;self.actions=[]
  quantities={BEFORE:[[3,2,1],[3,2,1],[3,2,1],[0,0,0]],AFTER:[[2,2,0],[3,2,1],[3,2,1],[1,0,1]]}
  components=['commission','delivery','acquiring','reverse_logistics']
  for sid,qs in quantities.items():
   for ci,component in enumerate(components):
    for ri,row in enumerate(self.f.cohort['rows']):
     q=qs[ci][ri]
     if not q:continue
     if component=='commission':basis=['ACTUAL_MATCHED','API_TARIFF_ESTIMATE','OFFICIAL_TARIFF_ESTIMATE'][ri];method='line_amount' if ri==0 else 'explicit_percent';value={'amount':str(100*q)} if ri==0 else {'percent':'20' if ri==1 else '15'}
     elif component=='delivery':basis=['ACTUAL_MATCHED','API_TARIFF_ESTIMATE','OFFICIAL_TARIFF_ESTIMATE'][ri];method=['line_amount','unit_amount','interval_unit_amount'][ri];value=[{'amount':'150'},{'amount':'40'},{'minimum':'20','maximum':'40'}][ri]
     elif component=='acquiring':basis='ACTUAL_MATCHED' if ri==0 else 'API_TARIFF_ESTIMATE';method='line_amount' if ri==0 else 'unit_amount';value={'amount':'15' if ri==0 else '2'}
     else:basis='API_TARIFF_ESTIMATE';method='unit_amount';value={'amount':'50'}
     for prior in self.catalog['components'][component]['priority']:
      r=self.record(sid,component,row['line_id'],prior,q,method,value)
      if prior!=basis:r.update(state='UNAVAILABLE',method=None,values=None,covered_units=None,zero_proof=False,expense_keys=[],effective_on=None)
      self.payload['records'].append(r)
      if prior==basis:break
  self.evidence=self.env(self.payload)
 def env(self,payload):return {'payload':deepcopy(payload),'sha256':digest(payload)}
 def record(self,sid,component,line,basis,q,method,values):
  rid=sid+':'+component+':'+line+':'+basis
  return {'id':rid,'scenario':sid,'component':component,'line_id':line,'basis':basis,'state':'COMPLETE','method':method,'values':deepcopy(values),'covered_units':str(q),'currency':'RUB','source_hash':'c'*64,'receipt_hash':digest({'synthetic':rid}),'observed_at':NOW-30,'expires_at':NOW+1800,'zero_proof':False,'expense_keys':['bill:'+sid+':'+component+':'+line],'effective_on':None if basis=='ACTUAL_MATCHED' else datetime.fromtimestamp(NOW,timezone.utc).date().isoformat()}
 def verify(self,kind,value,context,action):self.actions.append((kind,action));return self.allowed
 def sync(self):
  self.cohort=self.env(self.cohort['payload']);self.payload['cohort_hash']=self.cohort['sha256'];self.evidence=self.env(self.payload)
 def select(self,**kw):return self.selector.select(self.cohort,self.evidence,self.context,verify=kw.pop('verify',self.verify),now=kw.pop('now',NOW),**kw)
 def known(self,sid=BEFORE,component='commission',line='order-a.1'):
  return next(r for r in self.payload['records'] if r['scenario']==sid and r['component']==component and r['line_id']==line and r['state']=='COMPLETE')
 def unavailable(self):return next(r for r in self.payload['records'] if r['state']=='UNAVAILABLE')
 def expense(self,selection=None,verify=None):
  kw={}
  if 'selector' in inspect.signature(adapter.expense_envelope).parameters:kw={'selector':self.selector,'verify':verify or self.verify,'now':NOW}
  return adapter.expense_envelope(selection or self.select(),self.evidence,self.cohort,self.context,self.f.env(self.f.expenses),**kw)
 def calculate(self,selection=None):
  c,g=adapter.expand_catalogs(self.f.catalog,self.f.gate_catalog,self.catalog)
  runtime=ScenarioBindings(c,self.f.owner_catalog,g)
  args=(self.cohort,self.expense(selection),self.f.env(self.f.owner),self.context)
  opts={'authorize':self.f.authorize,'owner_authorize':self.f.owner_authorize,'now':NOW}
  return runtime.execute(runtime.prepare(*args,**opts),*args,**opts)

class SelectionTests(unittest.TestCase):
 def setUp(self):self.f=Fixture()
 def bad(self,fn,code=None):
  with self.assertRaises(SelectionError)as caught:fn()
  if code:self.assertEqual(caught.exception.code,code)
 def test_explicit_mixed_cost_gold(self):
  r=self.f.select();self.assertEqual(r['status'],'SELECTED')
  expected={BEFORE:{'commission_actual':'300','commission_api_estimate':'480','commission_official_estimate':'90','delivery_actual':'150','delivery_api_estimate':'80','delivery_official_estimate':'30','acquiring_actual':'15','acquiring_api_estimate':'6','reverse_logistics_actual':'0','reverse_logistics_api_estimate':'0','reverse_logistics_official_estimate':'0'},AFTER:{'commission_actual':'200','commission_api_estimate':'480','commission_official_estimate':'0','delivery_actual':'150','delivery_api_estimate':'80','delivery_official_estimate':'30','acquiring_actual':'15','acquiring_api_estimate':'6','reverse_logistics_actual':'0','reverse_logistics_api_estimate':'100','reverse_logistics_official_estimate':'0'}}
  for sid,values in expected.items():
   self.assertEqual({k:str(Decimal(v['value']).normalize()) for k,v in r['scenarios'][sid]['components'].items()},{k:str(Decimal(v).normalize())for k,v in values.items()})
 def test_actual_priority_even_when_tariff_is_cheaper(self):
  r=deepcopy(self.f.known());r.update(id='cheap',basis='API_TARIFF_ESTIMATE',method='explicit_percent',values={'percent':'1'},effective_on='2026-11-05',expense_keys=['different']);self.f.payload['records'].append(r);self.f.sync()
  self.assertEqual(self.f.select()['scenarios'][BEFORE]['components']['commission_actual']['value'],'300')
 def test_missing_actual_not_permission_to_fallback(self):
  self.f.payload['records'].remove(self.f.unavailable());self.f.sync();r=self.f.select();self.assertEqual(r['status'],'BLOCKED');self.assertEqual(r['scenarios'],{});self.assertTrue(r['gaps'])
 def test_explicit_unavailable_is_not_zero(self):
  r=self.f.select();x=r['scenarios'][BEFORE]['components']['commission_api_estimate'];self.assertEqual(Decimal(x['value']),Decimal('480'));self.assertEqual(x['basis'],'API_TARIFF_ESTIMATE')
 def test_actual_zero_retained_over_tariff(self):
  x=self.f.known();x['values']['amount']='0';x['zero_proof']=True;x['expense_keys']=[];self.f.sync();r=self.f.select();self.assertEqual(r['scenarios'][BEFORE]['components']['commission_actual']['value'],'0')
 def test_negative_actual_reversal_preserved(self):
  self.f.known()['values']['amount']='-10';self.f.sync();self.assertEqual(self.f.select()['scenarios'][BEFORE]['components']['commission_actual']['value'],'-10')
 def test_same_charge_across_alternative_scenarios_allowed(self):
  for sid in (BEFORE,AFTER):self.f.known(sid)['expense_keys']=['same-observed-charge']
  self.f.sync();self.assertEqual(self.f.select()['status'],'SELECTED')
 def test_duplicate_charge_within_scenario_rejected(self):
  self.f.known(component='delivery')['expense_keys']=self.f.known()['expense_keys'];self.f.sync();self.bad(self.f.select,'SELECTION_DOUBLE_COUNT')
 def test_pin_and_inputs_immutable(self):
  args=deepcopy((self.f.cohort,self.f.evidence,self.f.context));p=self.f.select()['pin'];self.assertTrue(self.f.selector.check_pin(p,*args,verify=self.f.verify,now=NOW));self.assertEqual(args,(self.f.cohort,self.f.evidence,self.f.context))
 def test_pin_change_rejected(self):
  p=self.f.select()['pin'];self.f.known()['values']['amount']='301';self.f.sync();self.bad(lambda:self.f.select(pin=p),'SELECTION_PIN_CHANGED')
 def test_revocation_on_read(self):
  p=self.f.select()['pin'];self.f.allowed=False;self.bad(lambda:self.f.selector.check_pin(p,self.f.cohort,self.f.evidence,self.f.context,verify=self.f.verify,now=NOW),'SELECTION_AUTH_DENIED')
 def test_verifier_none_denied(self):self.bad(lambda:self.f.select(verify=None),'SELECTION_AUTH_REQUIRED')
 def test_verifier_exception_not_echoed(self):
  def faulty(*x):raise RuntimeError('secret private raw body')
  self.bad(lambda:self.f.select(verify=faulty),'SELECTION_AUTH_UNAVAILABLE')
 def test_literal_true_required(self):self.bad(lambda:self.f.select(verify=lambda*x:1),'SELECTION_AUTH_DENIED')
 def test_no_network_or_persist_claim(self):
  r=self.f.select();self.assertEqual(r['network_calls'],0);self.assertFalse(r['production_ready']);self.assertFalse(r['financial_report_saved'])
 def test_safe_restart_rebuild_same_selection(self):
  first=self.f.select();self.f.selector=CostSourceSelector(self.f.catalog);self.assertEqual(first,self.f.select(pin=first['pin']))
 def test_number_bound_without_rounding(self):self.bad(lambda:number('1000000000000000000.0000000000001'),'SELECTION_NUMBER')
 def test_missing_all_costs_is_blocked(self):
  self.f.payload['records']=[];self.f.sync();r=self.f.select();self.assertEqual(r['status'],'BLOCKED');self.assertEqual(r['scenarios'],{})
 def test_no_return_event_not_fabricated(self):
  result=self.f.select();rows=result['scenarios'][BEFORE]['lines'];self.assertTrue(all(x['basis']is None and x['reason']=='NOT_APPLICABLE_IN_SCENARIO' for x in rows if x['component']=='reverse_logistics'))
 def test_unknown_stage_uses_authorized_estimate_without_handover_gate(self):
  self.assertEqual(self.f.select()['scenarios'][AFTER]['components']['reverse_logistics_api_estimate']['value'],'100')
 def test_fractional_quantity_excluded(self):
  self.f.known()['covered_units']='2.5';self.f.sync();self.bad(self.f.select,'SELECTION_QUANTITY')
 def test_boolean_quantity_excluded(self):
  self.f.known()['covered_units']=True;self.f.sync();self.bad(self.f.select,'SELECTION_NUMBER')
 def test_json_only_extra_cost(self):
  before=(ROOT/'cost_source_selector.py').read_bytes();c=deepcopy(self.f.catalog)
  c['components']['packaging']={'priority':['ACTUAL_MATCHED'],'methods':{'ACTUAL_MATCHED':['line_amount']},'allow_negative_actual':False,'percent_base':'0'}
  for sid in c['scenarios']:c['scenarios'][sid]['packaging']={'$path':['row','original_units']}
  for sid in c['scenarios']:
   for row in self.f.cohort['payload']['rows']:self.f.payload['records'].append(self.f.record(sid,'packaging',row['line_id'],'ACTUAL_MATCHED',row['original_units'],'line_amount',{'amount':'1'}))
  self.f.selector=CostSourceSelector(c);self.f.sync();self.assertEqual(self.f.select()['scenarios'][AFTER]['components']['packaging_actual']['value'],'3');self.assertEqual(before,(ROOT/'cost_source_selector.py').read_bytes())

MUTATIONS=[
 ('currency',lambda r:r.update(currency='USD'),'SELECTION_CURRENCY'),
 ('expired',lambda r:r.update(expires_at=NOW),'SELECTION_EXPIRED'),
 ('future',lambda r:r.update(observed_at=NOW+1),'SELECTION_EXPIRED'),
 ('stale_asof',lambda r:r.update(observed_at=NOW-121),'SELECTION_EXPIRED'),
 ('too_long_ttl',lambda r:r.update(expires_at=NOW+90000),'SELECTION_EXPIRED'),
 ('bad_hash',lambda r:r.update(source_hash='bad'),'SELECTION_HASH'),
 ('bad_receipt',lambda r:r.update(receipt_hash='bad'),'SELECTION_HASH'),
 ('missing_proof',lambda r:r.update(zero_proof=1),'SELECTION_EXPENSE_KEYS'),
 ('zero_unproved',lambda r:r.update(values={'amount':'0'}),'SELECTION_ZERO_UNPROVEN'),
 ('quantity_mismatch',lambda r:r.update(covered_units='99'),'SELECTION_QUANTITY_MISMATCH'),
 ('no_cost_ids',lambda r:r.update(expense_keys=[]),'SELECTION_EXPENSE_KEYS'),
 ('duplicate_cost_ids',lambda r:r.update(expense_keys=['x','x']),'SELECTION_EXPENSE_KEYS'),
 ('wrong_method',lambda r:r.update(method='explicit_percent',values={'percent':'20'}),'SELECTION_METHOD'),
 ('unknown_line',lambda r:r.update(line_id='other'),'SELECTION_TARGET'),
 ('unknown_scenario',lambda r:r.update(scenario='other'),'SELECTION_TARGET'),
 ('unknown_component',lambda r:r.update(component='other'),'SELECTION_TARGET'),
 ('wrong_basis',lambda r:r.update(basis='UNQUALIFIED'),'SELECTION_BASIS'),
 ('partial',lambda r:r.update(state='PARTIAL'),'SELECTION_COVERAGE'),
 ('unavailable_with_money',lambda r:r.update(state='UNAVAILABLE'),'SELECTION_MISSING_NOT_ZERO'),
 ('bad_actual_date',lambda r:r.update(effective_on='2026-11-04'),'SELECTION_TARIFF_DATE'),
 ('NaN',lambda r:r.update(values={'amount':'NaN'}),'SELECTION_NUMBER'),
 ('huge_exponent',lambda r:r.update(values={'amount':'1e-10000'}),'SELECTION_NUMBER'),
 ('extra_field',lambda r:r.update(unsafe='field'),'SELECTION_SCHEMA'),
]
for name,mutate,code in MUTATIONS:
 def case(self,mutate=mutate,code=code):mutate(self.f.known());self.f.sync();self.bad(self.f.select,code)
 setattr(SelectionTests,'test_record_'+name,case)
for key,value,code in [('coverage','PARTIAL','SELECTION_COHORT_INCOMPLETE'),('store_entity','other','SELECTION_SCOPE'),('currency','USD','SELECTION_SCOPE'),('scope_hash','0'*64,'SELECTION_SCOPE'),('issued_at',NOW+1,'SELECTION_EXPIRED'),('expires_at',NOW,'SELECTION_EXPIRED'),('normalization_hash','broken','SELECTION_HASH')]:
 def case(self,key=key,value=value,code=code):self.f.cohort['payload'][key]=value;self.f.sync();self.bad(self.f.select,code)
 setattr(SelectionTests,'test_cohort_'+key,case)

class AdapterTests(unittest.TestCase):
 def setUp(self):self.f=Fixture()
 def test_two_tables_with_independent_gold(self):
  r=self.f.calculate();self.assertEqual(r['status'],'CALCULATED');self.assertEqual(Decimal(r['scenarios'][BEFORE]['subtotal']['total']),Decimal('3119'));self.assertEqual(Decimal(r['scenarios'][AFTER]['subtotal']['total']),Decimal('2039'))
  self.assertFalse(r['production_ready']);self.assertFalse(r['financial_report_saved'])
 def test_wrong_selected_amount_cannot_be_wrapped(self):
  r=self.f.select();r['scenarios'][BEFORE]['components']['commission_actual']['value']='1'
  with self.assertRaises(SelectionError):self.f.expense(r)
 def test_wrong_basis_cannot_be_wrapped(self):
  r=self.f.select();r['scenarios'][BEFORE]['components']['commission_api_estimate']['basis']='ACTUAL_MATCHED'
  with self.assertRaises(SelectionError):self.f.expense(r)
 def test_missing_selected_component_cannot_be_wrapped(self):
  r=self.f.select();del r['scenarios'][AFTER]['components']['reverse_logistics_api_estimate']
  with self.assertRaises(SelectionError):self.f.expense(r)
 def test_authority_revocation_at_adapter(self):
  r=self.f.select();self.f.allowed=False
  with self.assertRaises(SelectionError):self.f.expense(r)
 def test_explicit_basis_rows_not_collapsed(self):
  r=self.f.calculate()['scenarios'][BEFORE];rows={x['component']:x for x in r['rows']}
  self.assertEqual(rows['commission_actual']['provenance']['basis'],'ACTUAL_MATCHED');self.assertEqual(rows['commission_api_estimate']['provenance']['basis'],'API_TARIFF_ESTIMATE');self.assertEqual(rows['commission_official_estimate']['provenance']['basis'],'OFFICIAL_TARIFF_ESTIMATE')
 def test_owner_unit_cost_unchanged(self):
  r=self.f.calculate();self.assertEqual(r['scenarios'][AFTER]['line_inputs'][0]['owner_inputs']['cogs']['unit_value'],'250');self.assertEqual(r['scenarios'][AFTER]['line_inputs'][0]['owner_inputs']['cogs']['amount'],'500')
 def test_missing_advertising_still_blocks(self):
  for rows in self.f.f.expenses['scenarios'].values():rows[:]=[x for x in rows if x['observation']['id']!='advertising']
  r=self.f.calculate();self.assertEqual(r['status'],'BLOCKED');self.assertTrue(all(v['subtotal']is None for v in r['scenarios'].values()))
 def test_missing_overlap_control_still_blocks(self):
  for rows in self.f.f.expenses['scenarios'].values():rows[:]=[x for x in rows if x['observation']['id']!='advertising_finance_overlap']
  r=self.f.calculate();self.assertEqual(r['status'],'BLOCKED');self.assertTrue(all(v['subtotal']is None for v in r['scenarios'].values()))
 def test_missing_owner_cogs_is_labelled_not_zero(self):
  self.f.f.owner['entries']=[r for r in self.f.f.owner['entries']if r['field']!='unit_cost'];r=self.f.calculate()['scenarios'][AFTER];self.assertTrue(r['eligibility']['omissions']);self.assertNotIn('cogs',[x['component'] for x in r['rows']])
 def test_excluded_tax_kept_as_omission(self):
  r=self.f.calculate()['scenarios'][AFTER];self.assertTrue(any(x['component']=='tax' and x['state']=='EXCLUDED_BY_USER' for x in r['eligibility']['omissions']))
 def test_retained_expenses_hash_guard(self):
  r=self.f.select();self.f.f.expenses['scope_hash']='b'*64
  with self.assertRaises(SelectionError):self.f.expense(r)
 def test_adapter_contract_requires_verifier(self):
  self.assertIn('verify',inspect.signature(adapter.expense_envelope).parameters);self.assertIn('selector',inspect.signature(adapter.expense_envelope).parameters)

class BoundaryTests(unittest.TestCase):
 def setUp(self):self.f=Fixture()
 def bad(self,fn,code=None):
  with self.assertRaises(SelectionError)as e:fn()
  if code:self.assertEqual(e.exception.code,code)
 def test_extreme_fixed_zero_never_expands(self):self.bad(lambda:text(Decimal('0e-999999')),'SELECTION_NUMBER')
 def test_extreme_fixed_tiny_never_expands(self):self.bad(lambda:text(Decimal('1e-10000')),'SELECTION_NUMBER')
 def test_input_hash_mismatch(self):
  self.f.evidence['payload']['records'][0]['values']['amount']='999';self.bad(self.f.select,'SELECTION_HASH')
 def test_changed_context_pin(self):
  p=self.f.select()['pin'];self.f.context['as_of']-=1;self.bad(lambda:self.f.select(pin=p),'SELECTION_PIN_CHANGED')
 def test_read_pin_does_not_recalculate(self):
  p=self.f.select()['pin']
  with patch.object(self.f.selector,'select',side_effect=AssertionError('NO_RECALC')):self.assertTrue(self.f.selector.check_pin(p,self.f.cohort,self.f.evidence,self.f.context,verify=self.f.verify,now=NOW))
 def test_read_checks_authority(self):
  p=self.f.select()['pin'];self.f.actions=[];self.f.selector.check_pin(p,self.f.cohort,self.f.evidence,self.f.context,verify=self.f.verify,now=NOW);self.assertEqual(self.f.actions,[('policy','read'),('cohort','read'),('candidates','read')])
 def test_duplicate_line(self):
  self.f.cohort['payload']['rows'].append(deepcopy(self.f.cohort['payload']['rows'][0]));self.f.sync();self.bad(self.f.select,'SELECTION_DUPLICATE_LINE')
 def test_duplicate_record_id(self):
  self.f.payload['records'].append(deepcopy(self.f.payload['records'][0]));self.f.sync();self.bad(self.f.select,'SELECTION_DUPLICATE_CANDIDATE')
 def test_same_basis_ambiguous_source(self):
  r=deepcopy(self.f.payload['records'][0]);r['id']='another';self.f.payload['records'].append(r);self.f.sync();self.bad(self.f.select,'SELECTION_AMBIGUOUS_SOURCE')
 def test_unavailable_not_coerced_to_zero(self):
  self.f.unavailable()['values']={'amount':'0'};self.f.sync();self.bad(self.f.select,'SELECTION_MISSING_NOT_ZERO')
 def test_required_quantity_zero_conflict(self):
  r=self.f.record(BEFORE,'reverse_logistics','order-a.1','ACTUAL_MATCHED',0,'line_amount',{'amount':'10'});self.f.payload['records'].append(r);self.f.sync();self.bad(self.f.select,'SELECTION_NOT_APPLICABLE_CONFLICT')
 def test_output_component_collision(self):
  c=deepcopy(self.f.f.catalog);c['sources']['commission_actual']=deepcopy(c['sources']['commission'])
  self.bad(lambda:adapter.expand_catalogs(c,self.f.f.gate_catalog,self.f.catalog),'SELECTION_COMPONENT_COLLISION')
 def test_adapter_without_verifier_denied(self):
  self.bad(lambda:adapter.expense_envelope(self.f.select(),self.f.evidence,self.f.cohort,self.f.context,self.f.f.env(self.f.f.expenses),selector=self.f.selector,now=NOW),'SELECTION_AUTH_REQUIRED')
 def test_adapter_attests_retained_expenses(self):
  def verify(kind,*args):return kind!='retained_expenses'
  self.bad(lambda:self.f.expense(verify=verify),'SELECTION_AUTH_DENIED')
 def test_future_tariff_not_current(self):
  r=next(x for x in self.f.payload['records']if x['state']=='COMPLETE' and x['basis']!='ACTUAL_MATCHED');r['effective_on']='2027-01-01';self.f.sync();self.bad(self.f.select,'SELECTION_TARIFF_DATE')
 def test_reversed_real_tariff_range(self):
  r=next(x for x in self.f.payload['records']if x['method']=='interval_unit_amount');r['values']={'minimum':'40','maximum':'20'};self.f.sync();self.bad(self.f.select,'SELECTION_INTERVAL')
 def test_percent_not_inferred_from_amount(self):
  r=next(x for x in self.f.payload['records']if x['method']=='explicit_percent');r['values']={'amount':'20'};self.f.sync();self.bad(self.f.select,'SELECTION_VALUE')
 def test_acquiring_percent_forbidden(self):
  r=self.f.known(component='acquiring',line='order-a.2');r.update(method='explicit_percent',values={'percent':'1'});self.f.sync();self.bad(self.f.select,'SELECTION_METHOD')
 def test_no_negative_estimate(self):
  self.f.known(component='delivery',line='order-a.2')['values']['amount']='-1';self.f.sync();self.bad(self.f.select,'SELECTION_NEGATIVE')
 def test_canonical_output_bounded(self):
  from cost_source_selector import canonical
  self.bad(lambda:canonical({'x':'a'*1_048_576}),'SELECTION_CAPACITY')
 def test_period_too_long(self):
  p={'from':'2024-01-01','to':'2026-11-04'}
  self.f.context['period']=p;self.f.cohort['payload']['period']=p;self.f.payload['period']=p;self.f.sync();self.bad(self.f.select,'SELECTION_PERIOD')
 def test_valid_intermediate_precision_not_source32(self):self.assertEqual(text(Decimal('0.'+'0'*40+'1')),'0.'+'0'*40+'1')
 def test_decimal_coefficient_overflow_rejected(self):self.bad(lambda:text(Decimal('1.'+'1'*100)),'SELECTION_NUMBER')
 def test_high_precision_input_boundary_negative(self):self.bad(lambda:number('-1000000000000000000.0000000000001'),'SELECTION_NUMBER')
 def test_candidate_capacity_limit(self):
  c=deepcopy(self.f.catalog);c['max_candidates']=1;self.f.selector=CostSourceSelector(c);self.bad(self.f.select,'SELECTION_CAPACITY')
 def test_cohort_capacity_limit(self):
  c=deepcopy(self.f.catalog);c['max_rows']=1;self.f.selector=CostSourceSelector(c);self.bad(self.f.select,'SELECTION_CAPACITY')
 def test_bad_nested_method_raises_typed_error(self):
  c=deepcopy(self.f.catalog);c['components']['commission']['methods']['ACTUAL_MATCHED']=[{}];self.bad(lambda:CostSourceSelector(c))
 def test_zero_forecast_requires_proof(self):
  r=self.f.known(component='delivery',line='order-a.2');r['values']['amount']='0';self.f.sync();self.bad(self.f.select,'SELECTION_ZERO_UNPROVEN')
 def test_future_period(self):
  p={'from':'2027-01-01','to':'2027-01-02'};self.f.context['period']=p;self.f.cohort['payload']['period']=p;self.f.payload['period']=p;self.f.sync();self.bad(self.f.select,'SELECTION_PERIOD')
 def test_expired_pin_read(self):
  p=self.f.select()['pin'];self.bad(lambda:self.f.selector.check_pin(p,self.f.cohort,self.f.evidence,self.f.context,verify=self.f.verify,now=NOW+10000),'SELECTION_EXPIRED')

if __name__=='__main__':
 attempts=[]
 def forbidden(*a,**kw):attempts.append('NETWORK');raise AssertionError('NETWORK_FORBIDDEN')
 with patch.object(socket.socket,'connect',forbidden),patch.object(socket.socket,'connect_ex',forbidden),patch.object(socket,'getaddrinfo',forbidden):
  suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in (SelectionTests,AdapterTests,BoundaryTests));r=unittest.TextTestRunner(verbosity=2).run(suite)
 print(json.dumps({'tests':r.testsRun,'failures':len(r.failures),'errors':len(r.errors),'skipped':len(r.skipped),'network_attempts':len(attempts),'live_data':False,'status':'PASS' if r.wasSuccessful() and not attempts else 'FAIL'}));raise SystemExit(0 if r.wasSuccessful() and not attempts else 1)
