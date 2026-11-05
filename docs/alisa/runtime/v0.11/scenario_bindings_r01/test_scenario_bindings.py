"""Independent synthetic expected values for owner + cohort + report composition.
No network, live credentials, live database or self-derived expected arithmetic.
"""
from copy import deepcopy
from pathlib import Path
from decimal import Decimal
from unittest.mock import patch
import hashlib,json,os,socket,sys,unittest
ROOT=Path(__file__).parent
RUNTIME=Path(os.environ.get('ALISA_RUNTIME',str(ROOT/'dependencies')))
sys.path.insert(0,str(RUNTIME))
from owner_inputs import OwnerInputs,InputError,digest
from scenario_bindings import ScenarioBindings,BindingError
from matrix_core import MatrixError
from report_contracts import ContractError
C=json.loads((ROOT/'scenario_catalog.json').read_text())
O=json.loads((ROOT/'owner_input_catalog.json').read_text())
G=json.loads((ROOT/'scenario_report_catalog.json').read_text())
NOW=1793865600
PERIOD={'from':'2026-11-03','to':'2026-11-04'}
SCOPE='a'*64
BEFORE='without_cancellations_counterfactual'
AFTER='with_actual_cancellations'

class Fixture:
 def __init__(self):
  self.catalog=deepcopy(C);self.owner_catalog=deepcopy(O);self.gate_catalog=deepcopy(G)
  self.runtime=ScenarioBindings(self.catalog,self.owner_catalog,self.gate_catalog)
  self.context={'scope_hash':SCOPE,'store_entity':'store:fixture','currency':'RUB','period':deepcopy(PERIOD),'as_of':NOW-120}
  common={'revision':'source-r1','scope_hash':SCOPE,'store_entity':'store:fixture','currency':'RUB','period':deepcopy(PERIOD),'issued_at':NOW-60,'expires_at':NOW+3600,'normalization_hash':'b'*64}
  self.cohort={'schema':'alice-qualified-cohort/v1',**deepcopy(common),'coverage':'COMPLETE','rows':[
   {'line_id':'order-a.1','product_entity':'sku:a','basis_day':'2026-11-03','original_units':'3','excluded_units':'1','seller_unit_price':'1000'},
   {'line_id':'order-a.2','product_entity':'sku:a','basis_day':'2026-11-04','original_units':'2','excluded_units':'0','seller_unit_price':'1200'},
   {'line_id':'order-b.1','product_entity':'sku:b','basis_day':'2026-11-04','original_units':'1','excluded_units':'1','seller_unit_price':'600'}]}
  self.expenses={'schema':'alice-scenario-expenses/v1',**deepcopy(common),'scenarios':{}}
  self.owner={'schema':'alice-owner-input-snapshot/v1','revision':'owner-r1','scope_hash':SCOPE,'catalog_hash':self.runtime.owner.hash,'issued_at':NOW-100,'expires_at':NOW+3600,'entries':[
   self.input('a-old','unit_cost','sku:a','250',period={'from':'2026-11-01','to':'2026-11-03'}),
   self.input('a-new','unit_cost','sku:a','300',period={'from':'2026-11-04','to':'2026-11-30'}),
   self.input('b','unit_cost','sku:b','180'),
   self.input('own','own_cost_amount','store:fixture','50'),
   self.input('tax','tax_amount','store:fixture',None,state='EXCLUDED_BY_OWNER')]}
  for sid,costs in [(BEFORE,{'commission':'600','delivery':'400','acquiring':'60','reverse_logistics':'0'}),
                    (AFTER,{'commission':'440','delivery':'400','acquiring':'60','reverse_logistics':'200'})]:
   entries=[self.source(k,v,'API_TARIFF_ESTIMATE') for k,v in costs.items()]
   entries+=[self.source('advertising','120','ACTUAL_PERIOD_ALLOCATION'),self.source('storage','30','ACTUAL_PERIOD_ALLOCATION'),
             self.source('expense_coverage','0','VERIFIED_CONTROL'),self.source('advertising_finance_overlap','0','VERIFIED_CONTROL')]
   self.expenses['scenarios'][sid]=entries
  self.auth_result=True;self.owner_auth_result=True;self.actions=[]
 def input(self,rid,field,entity,value,period=None,state='VALUE'):
  return {'id':rid,'field':field,'entity':entity,'currency':'RUB','period':deepcopy(period or PERIOD),'state':state,'value':value}
 def env(self,payload):return {'payload':deepcopy(payload),'sha256':digest(payload)}
 def source(self,name,value,basis):
  ctrl=basis=='VERIFIED_CONTROL'
  o={'id':name,'state':'KNOWN','coverage':'COMPLETE','value':value,'currency':'RUB','period':deepcopy(PERIOD),'scope_hash':SCOPE,'axis':'reconciliation' if ctrl else 'scenario_cost','unit':'currency','source_hash':'c'*64,'receipt_hash':'d'*64,'observed_at':NOW-30,'expires_at':NOW+1800,'zero_proof':Decimal(value)==0,'expense_keys':[] if ctrl or Decimal(value)==0 else ['bill:'+name]}
  allocation={'mode':'whole_store_cohort_period','scope_hash':SCOPE,'period':deepcopy(PERIOD),'cohort_hash':digest(self.cohort)} if basis=='ACTUAL_PERIOD_ALLOCATION' else None
  return {'observation':o,'basis':basis,'allocation':allocation}
 def sync_allocation(self):
  for rows in self.expenses['scenarios'].values():
   for row in rows:
    if row['allocation'] is not None:row['allocation']['cohort_hash']=digest(self.cohort)
 def authorize(self,kind,metadata,context,action):
  self.actions.append((kind,action))
  return self.auth_result
 def owner_authorize(self,meta,request,action):self.actions.append(('owner',action));return self.owner_auth_result
 def arguments(self):return (self.env(self.cohort),self.env(self.expenses),self.env(self.owner),deepcopy(self.context))
 def options(self):return {'authorize':self.authorize,'owner_authorize':self.owner_authorize,'now':NOW}
 def prepare(self):return self.runtime.prepare(*self.arguments(),**self.options())
 def run(self,pin=None):return self.runtime.execute(pin or self.prepare(),*self.arguments(),**self.options())
 def observation(self,name,sid=AFTER):return next(r['observation'] for r in self.expenses['scenarios'][sid] if r['observation']['id']==name)
 def row(self,result,name,sid=AFTER):return next(r for r in result['scenarios'][sid]['rows'] if r['component']==name)

class ScenarioTests(unittest.TestCase):
 def setUp(self):self.f=Fixture()
 def bad(self,code,fn):
  with self.assertRaises((BindingError,InputError,ContractError,MatrixError)) as e:fn()
  self.assertEqual(e.exception.code,code)
 def test_two_scenario_gold(self):
  r=self.f.run();self.assertEqual(r['status'],'CALCULATED')
  self.assertEqual(self.f.row(r,'seller_value',BEFORE)['total'],'6000')
  self.assertEqual(self.f.row(r,'seller_value')['total'],'4400')
  self.assertEqual(self.f.row(r,'cogs',BEFORE)['total'],'1530')
  self.assertEqual(self.f.row(r,'cogs')['total'],'1100')
  self.assertEqual(r['scenarios'][BEFORE]['subtotal']['total'],'3210')
  self.assertEqual(r['scenarios'][AFTER]['subtotal']['total'],'2000')
 def test_explicit_denominators(self):
  r=self.f.run();v=r['scenarios'][AFTER]['subtotal'];self.assertEqual(v['unit_denominator'],'4');self.assertEqual(v['original_unit_denominator'],'6')
  self.assertEqual(v['per_scenario_unit'],'500');self.assertTrue(v['per_original_unit'].startswith('333.333'))
 def test_unit_cost_not_diluted_by_cancellations(self):
  lines=self.f.run()['scenarios'][AFTER]['line_inputs'];v=lines[0]['owner_inputs']['cogs']
  self.assertEqual((v['unit_value'],v['quantity'],v['amount']),('250','2','500'))
 def test_cost_change_applies_on_exact_day(self):
  lines=self.f.run()['scenarios'][AFTER]['line_inputs'];v=lines[1]['owner_inputs']['cogs'];self.assertEqual((v['unit_value'],v['amount']),('300','600'))
 def test_excluded_line_has_zero_total_not_zero_unit_cost(self):
  v=self.f.run()['scenarios'][AFTER]['line_inputs'][2]['owner_inputs']['cogs'];self.assertEqual(v['unit_value'],'180');self.assertEqual(v['amount'],'0');self.assertEqual(v['state'],'NOT_APPLICABLE')
 def test_tax_exclusion_remains_explicit(self):
  s=self.f.run()['scenarios'][AFTER];self.assertNotIn('tax',[r['component'] for r in s['rows']]);self.assertTrue(any(v['component']=='tax' and v['state']=='EXCLUDED_BY_USER' for v in s['eligibility']['omissions']))
 def test_no_net_profit_claim(self):
  r=self.f.run();self.assertFalse(r['production_ready']);self.assertFalse(r['financial_report_saved']);self.assertEqual(r['network_calls'],0)
  self.assertTrue(all(v['net_profit'] is None for v in r['scenarios'].values()))
 def test_actual_and_tariff_and_allocation_stay_distinct(self):
  row=next(r for r in self.f.expenses['scenarios'][AFTER] if r['observation']['id']=='delivery');row['basis']='ACTUAL_MATCHED'
  r=self.f.run();self.assertEqual(self.f.row(r,'delivery')['provenance']['basis'],'ACTUAL_MATCHED');self.assertEqual(self.f.row(r,'reverse_logistics')['provenance']['basis'],'API_TARIFF_ESTIMATE');self.assertEqual(self.f.row(r,'advertising')['provenance']['basis'],'ACTUAL_PERIOD_ALLOCATION')
 def test_unknown_physical_stage_is_not_a_manual_gate(self):
  # Normalized authorized estimate is accepted without inventing physical events.
  r=self.f.run();self.assertEqual(self.f.row(r,'reverse_logistics')['total'],'200')
 def test_actual_costs_retained_on_cancelled_rows(self):
  for row in self.f.cohort['rows']:row['excluded_units']=row['original_units']
  self.f.sync_allocation();r=self.f.run();self.assertEqual(self.f.row(r,'seller_value')['total'],'0');self.assertEqual(self.f.row(r,'cogs')['total'],'0');self.assertEqual(self.f.row(r,'delivery')['total'],'400')
 def test_all_cancelled_ratios_are_null(self):
  for row in self.f.cohort['rows']:row['excluded_units']=row['original_units']
  self.f.sync_allocation();v=self.f.run()['scenarios'][AFTER]['subtotal'];self.assertIsNone(v['per_scenario_unit']);self.assertIsNone(v['percent_of_scenario_seller_value']);self.assertIsNotNone(v['per_original_unit'])
 def test_unknown_cost_is_omitted_not_zero(self):
  self.f.owner['entries']=[e for e in self.f.owner['entries'] if e['field']!='unit_cost'];r=self.f.run();self.assertNotIn('cogs',[x['component'] for x in r['scenarios'][AFTER]['rows']]);self.assertEqual(len(r['scenarios'][AFTER]['owner_details']['cogs']['missing_lines']),2)
 def test_partial_cost_preserves_known_amount_without_false_full_total(self):
  self.f.owner['entries']=[e for e in self.f.owner['entries'] if e['id']!='a-new'];r=self.f.run();s=r['scenarios'][AFTER];self.assertEqual(s['owner_details']['cogs']['known_amount'],'500');self.assertNotIn('cogs',[x['component'] for x in s['rows']])
 def test_monthly_own_expense_not_prorated(self):
  next(e for e in self.f.owner['entries'] if e['id']=='own')['period']={'from':'2026-11-01','to':'2026-11-30'};s=self.f.run()['scenarios'][AFTER];self.assertEqual(s['owner_details']['own_costs']['reason'],'PERIOD_ALLOCATION_REQUIRED');self.assertNotIn('own_costs',[x['component'] for x in s['rows']])
 def test_missing_owner_not_replaced_by_default_250(self):
  self.f.owner['entries']=[];r=self.f.run();self.assertTrue(r['scenarios'][AFTER]['eligibility']['omissions']);self.assertNotIn('cogs',[x['component'] for x in r['scenarios'][AFTER]['rows']])
 def test_explicit_zero_owner_cost_valid(self):
  for e in self.f.owner['entries']:
   if e['state']=='VALUE':e['value']='0'
  self.assertEqual(self.f.row(self.f.run(),'cogs')['total'],'0')
 def test_missing_advertising_blocks_both_scenario_tables(self):
  self.f.expenses['scenarios'][AFTER]=[r for r in self.f.expenses['scenarios'][AFTER] if r['observation']['id']!='advertising'];r=self.f.run();self.assertEqual(r['status'],'BLOCKED');self.assertTrue(all(x['rows']==[] and x['subtotal'] is None for x in r['scenarios'].values()))
 def test_null_advertising_is_not_zero(self):
  o=self.f.observation('advertising');o.update(state='UNKNOWN',value=None,zero_proof=False,expense_keys=[]);self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_partial_advertising_not_used(self):self.f.observation('advertising')['coverage']='PARTIAL';self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_unproven_zero_rejected(self):
  self.f.observation('advertising').update(value='0',zero_proof=False);self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_source_scope_mismatch_blocks(self):self.f.observation('advertising')['scope_hash']='f'*64;self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_source_currency_mismatch_blocks(self):self.f.observation('advertising')['currency']='USD';self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_source_axis_mismatch_blocks(self):self.f.observation('advertising')['axis']='snapshot';self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_source_future_observation_blocks(self):self.f.observation('advertising')['observed_at']=NOW+1;self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_source_expired_observation_blocks(self):self.f.observation('advertising')['expires_at']=NOW;self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_source_overlapping_expense_keys_blocks(self):self.f.observation('advertising')['expense_keys']=['bill:delivery'];self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_control_is_not_cost(self):
  self.f.observation('advertising_finance_overlap').update(value='120',zero_proof=False,expense_keys=['bill:advertising']);r=self.f.run();self.assertEqual(r['scenarios'][AFTER]['subtotal']['total'],'2000');self.assertNotIn('advertising_finance_overlap',[v['component'] for v in r['scenarios'][AFTER]['rows']])
 def test_no_overlap_control_blocks(self):
  self.f.expenses['scenarios'][AFTER]=[r for r in self.f.expenses['scenarios'][AFTER] if r['observation']['id']!='advertising_finance_overlap'];self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_no_coverage_control_blocks(self):
  self.f.expenses['scenarios'][AFTER]=[r for r in self.f.expenses['scenarios'][AFTER] if r['observation']['id']!='expense_coverage'];self.assertEqual(self.f.run()['status'],'BLOCKED')
 def test_whole_period_allocation_requires_exact_cohort(self):
  self.f.expenses['scenarios'][AFTER][4]['allocation']['cohort_hash']='f'*64;self.bad('SCENARIO_ALLOCATION',self.f.run)
 def test_cohort_incomplete_rejected(self):self.f.cohort['coverage']='PARTIAL';self.bad('SCENARIO_COHORT_INCOMPLETE',self.f.run)
 def test_cohort_scope_rejected(self):self.f.cohort['scope_hash']='f'*64;self.bad('SCENARIO_SCOPE',self.f.run)
 def test_cohort_other_store_rejected(self):self.f.cohort['store_entity']='store:other';self.bad('SCENARIO_SCOPE',self.f.run)
 def test_duplicate_line_rejected(self):self.f.cohort['rows'].append(deepcopy(self.f.cohort['rows'][0]));self.f.sync_allocation();self.bad('SCENARIO_DUPLICATE_LINE',self.f.run)
 def test_out_of_period_row_rejected(self):self.f.cohort['rows'][0]['basis_day']='2026-11-02';self.f.sync_allocation();self.bad('SCENARIO_ROW_DATE',self.f.run)
 def test_invalid_date_rejected(self):self.f.cohort['rows'][0]['basis_day']='2026-02-30';self.f.sync_allocation();self.bad('SCENARIO_ROW_DATE',self.f.run)
 def test_excluded_more_than_original_rejected(self):self.f.cohort['rows'][0]['excluded_units']='4';self.f.sync_allocation();self.bad('SCENARIO_ROW_GUARD',self.f.run)
 def test_missing_scenario_rejected(self):self.f.expenses['scenarios'].pop(AFTER);self.bad('SCENARIO_SCOPES_MISSING',self.f.run)
 def test_repeated_cost_record_rejected(self):self.f.expenses['scenarios'][AFTER].append(deepcopy(self.f.expenses['scenarios'][AFTER][0]));self.bad('SCENARIO_SOURCE_COMPONENT',self.f.run)
 def test_unknown_cost_component_rejected(self):self.f.expenses['scenarios'][AFTER][0]['observation']['id']='magic_cost';self.bad('SCENARIO_SOURCE_COMPONENT',self.f.run)
 def test_unlabelled_cost_rejected(self):self.f.expenses['scenarios'][AFTER][0]['basis']='UNKNOWN';self.bad('SCENARIO_SOURCE_BASIS',self.f.run)
 def test_negative_tariff_rejected(self):self.f.observation('acquiring')['value']='-10';self.bad('SCENARIO_NUMBER',self.f.run)
 def test_negative_actual_adjustment_preserved(self):
  rec=next(r for r in self.f.expenses['scenarios'][AFTER] if r['observation']['id']=='acquiring');rec['basis']='ACTUAL_MATCHED';rec['observation']['value']='-10';self.assertEqual(self.f.row(self.f.run(),'acquiring')['total'],'-10')
 def test_counterfactual_cannot_silently_include_return_event(self):self.f.observation('reverse_logistics',BEFORE).update(value='100',zero_proof=False,expense_keys=['bill:reverse_logistics']);self.bad('SCENARIO_SOURCE_GUARD',self.f.run)
 def test_pin_rejects_changed_owner_version(self):
  pin=self.f.prepare();self.f.owner['revision']='r2';self.bad('OWNER_INPUT_PIN_CHANGED',lambda:self.f.run(pin))
 def test_pin_rejects_changed_owner_value(self):
  pin=self.f.prepare();self.f.owner['entries'][0]['value']='1';self.bad('OWNER_INPUT_PIN_CHANGED',lambda:self.f.run(pin))
 def test_pin_rejects_changed_sources(self):
  pin=self.f.prepare();self.f.observation('delivery')['value']='401';self.bad('SCENARIO_PIN_CHANGED',lambda:self.f.run(pin))
 def test_pin_rejects_changed_rows(self):
  pin=self.f.prepare();self.f.cohort['rows'][0]['seller_unit_price']='999';self.f.sync_allocation();self.bad('SCENARIO_PIN_CHANGED',lambda:self.f.run(pin))
 def test_same_plan_survives_restart(self):
  pin=json.loads(json.dumps(self.f.prepare()));r=self.f.run(pin);self.f.runtime=ScenarioBindings(C,O,G);self.assertEqual(r,self.f.run(pin))
 def test_read_checks_current_rights_without_formula_recompute(self):
  pin=self.f.prepare()
  with patch('scenario_bindings.evaluate',side_effect=AssertionError('NO_RECOMPUTATION')):
   self.assertTrue(self.f.runtime.check_pin(pin,*self.f.arguments(),**self.f.options()))
  self.assertIn(('cohort','read'),self.f.actions);self.assertIn(('owner','read'),self.f.actions)
 def test_revoke_after_prepare_blocks_execute(self):pin=self.f.prepare();self.f.auth_result=False;self.bad('SCENARIO_AUTH_DENIED',lambda:self.f.run(pin))
 def test_owner_revoke_blocks_read(self):
  pin=self.f.prepare();self.f.owner_auth_result=False;self.bad('OWNER_INPUT_AUTH_DENIED',lambda:self.f.runtime.check_pin(pin,*self.f.arguments(),**self.f.options()))
 def test_no_authority_blocks(self):
  args=self.f.options();args['authorize']=None;self.bad('SCENARIO_AUTH_REQUIRED',lambda:self.f.runtime.prepare(*self.f.arguments(),**args))
 def test_truthy_not_authorization(self):self.f.auth_result=1;self.bad('SCENARIO_AUTH_DENIED',self.f.run)
 def test_authority_exception_no_echo(self):
  def unavailable(*a):raise ValueError('Bearer secret-must-not-echo /private/path')
  self.f.authorize=unavailable;self.bad('SCENARIO_AUTH_UNAVAILABLE',self.f.run)
 def test_source_envelope_hash_tampering(self):
  args=list(self.f.arguments());args[0]['payload']['rows'][0]['seller_unit_price']='1';self.bad('SCENARIO_SOURCE_HASH',lambda:self.f.runtime.prepare(*args,**self.f.options()))
 def test_expired_source_snapshot(self):self.f.cohort['expires_at']=NOW;self.bad('SCENARIO_EXPIRED',self.f.run)
 def test_input_catalog_is_copied(self):
  h=self.f.runtime.hash;self.f.catalog['version']='mutated';self.assertEqual(self.f.runtime.hash,h)
 def test_property_is_copied(self):
  c=self.f.runtime.catalog;c['sources'].clear();self.assertTrue(self.f.runtime.catalog['sources'])
 def test_new_owner_cost_type_json_only(self):
  c,o,g=deepcopy(C),deepcopy(O),deepcopy(G)
  o['fields']['packaging']=deepcopy(o['fields']['unit_cost']);o['fields']['packaging']['label']='Упаковка физической единицы'
  c['owner_bindings']['packaging_cost']={'field':'packaging','mode':'unit_times_quantity','axis':'qualified_consumed_units','label':'Упаковка'}
  c['output']['cost_components'].append('packaging_cost');g['policies']['cohort_scenario']['components']['packaging_cost']=deepcopy(g['policies']['cohort_scenario']['components']['cogs'])
  before=hashlib.sha256((ROOT/'scenario_bindings.py').read_bytes()).hexdigest()
  self.f.runtime=ScenarioBindings(c,o,g);self.f.owner['catalog_hash']=self.f.runtime.owner.hash
  for ent in ('sku:a','sku:b'):self.f.owner['entries'].append(self.f.input('pack-'+ent,'packaging',ent,'10'))
  r=self.f.run();self.assertEqual(self.f.row(r,'packaging_cost')['total'],'40');self.assertEqual(r['scenarios'][AFTER]['subtotal']['total'],'1960')
  self.assertEqual(before,hashlib.sha256((ROOT/'scenario_bindings.py').read_bytes()).hexdigest())
 def test_third_scenario_json_only(self):
  c=deepcopy(C);c['scenarios']['another_declared_scenario']=deepcopy(c['scenarios'][BEFORE]);self.f.runtime=ScenarioBindings(c,O,G);self.f.expenses['scenarios']['another_declared_scenario']=deepcopy(self.f.expenses['scenarios'][BEFORE]);r=self.f.run();self.assertEqual(r['scenarios']['another_declared_scenario']['subtotal']['total'],'3210')
 def test_catalog_guard_all_branches_validated(self):
  c=deepcopy(C);c['row_guards'].append({'$if':[True,True,{'$fn':['eval','bad']}]});self.bad('MATRIX_OPERATOR_UNKNOWN',lambda:ScenarioBindings(c,O,G))
 def test_hidden_credential_path_disallowed(self):
  c=deepcopy(C);c['scenarios'][AFTER]['quantity']={'$path':['credentials','token']};self.bad('MATRIX_PATH_SCHEMA',lambda:ScenarioBindings(c,O,G))
 def test_only_unit_cost_binding_not_period_total(self):
  c=deepcopy(C);c['owner_bindings']['cogs']['field']='tax_amount';self.bad('SCENARIO_INPUT_DIMENSION',lambda:ScenarioBindings(c,O,G))
 def test_costs_cannot_include_control_total(self):
  c=deepcopy(C);c['output']['cost_components'].append('expense_coverage');self.bad('SCENARIO_COST_ROLE',lambda:ScenarioBindings(c,O,G))
 def test_cannot_drop_a_cost_component_from_sum(self):
  c=deepcopy(C);c['output']['cost_components'].remove('advertising');self.bad('SCENARIO_COST_ROLE',lambda:ScenarioBindings(c,O,G))
 def test_same_product_multiple_dates_not_duplicate(self):self.assertEqual(self.f.run()['status'],'CALCULATED')
 def test_product_id_mismatch_is_omission_not_other_product_cost(self):
  self.f.cohort['rows'][0]['product_entity']='sku:unknown';self.f.sync_allocation();r=self.f.run();self.assertEqual(r['scenarios'][AFTER]['line_inputs'][0]['owner_inputs']['cogs']['state'],'NOT_PROVIDED')
 def test_result_hash_reproducible(self):
  r=self.f.run();body={k:v for k,v in r.items() if k!='result_sha256'};self.assertEqual(digest(body),r['result_sha256'])
 def test_empty_cohort_has_no_imaginary_unit_cost(self):
  self.f.cohort['rows']=[];self.f.sync_allocation();r=self.f.run();self.assertEqual(self.f.row(r,'cogs')['total'],'0');self.assertIsNone(self.f.row(r,'cogs')['per_scenario_unit'])


 def test_execute_requires_accepted_pin(self):
  self.bad('SCENARIO_PIN_REQUIRED',lambda:self.f.runtime.execute(None,*self.f.arguments(),**self.f.options()))
 def test_read_requires_accepted_pin(self):
  self.bad('SCENARIO_PIN_REQUIRED',lambda:self.f.runtime.check_pin(None,*self.f.arguments(),**self.f.options()))
 def test_amount_expires_between_prepare_execute(self):
  pin=self.f.prepare();opt=self.f.options();opt['now']=NOW+3600
  self.bad('SCENARIO_EXPIRED',lambda:self.f.runtime.execute(pin,*self.f.arguments(),**opt))
 def test_metadata_does_not_include_owner_money(self):
  seen=[]
  def check(meta,request,action):seen.append(meta);return True
  self.f.owner_authorize=check;self.f.run()
  self.assertTrue(seen);self.assertTrue(all('entries' not in str(x) and '250' not in str(x) for x in seen))
 def test_owner_cross_currency_cannot_convert(self):
  self.f.owner['entries'][0]['currency']='USD';self.bad('OWNER_INPUT_CURRENCY',self.f.run)
 def test_oversized_cohort_rejected(self):
  self.f.cohort['rows']=[dict(self.f.cohort['rows'][0],line_id='r'+str(i)) for i in range(201)];self.f.sync_allocation();self.bad('SCENARIO_CAPACITY',self.f.run)
 def test_missing_normalization_proof_rejected(self):
  self.f.cohort['normalization_hash']=None;self.bad('SCENARIO_NORMALIZATION',self.f.run)
 def test_cost_nonfinite_cannot_leak_into_report(self):
  self.f.observation('advertising')['value']='Infinity';self.assertEqual(self.f.run()['status'],'BLOCKED')


 def test_code_version_pin_cannot_be_silently_changed(self):
  pin=self.f.prepare();self.f.runtime.code_hash='0'*64;self.bad('SCENARIO_PIN_CHANGED',lambda:self.f.run(pin))
 def test_callback_does_not_mutate_bound_snapshots(self):
  args=list(self.f.arguments());pin=self.f.runtime.prepare(*args,**self.f.options())
  def adversarial(kind,meta,context,action):
   args[2]['payload']['expires_at']=NOW+999999
   args[0]['payload']['rows'][0]['seller_unit_price']='1'
   return True
  opts=self.f.options();opts['authorize']=adversarial
  r=self.f.runtime.execute(pin,*args,**opts)
  self.assertEqual(r['scenarios'][AFTER]['subtotal']['total'],'2000')
 def test_scalar_owner_envelope_rejected_safely(self):
  args=list(self.f.arguments());args[2]=None
  self.bad('SCENARIO_OWNER_ENVELOPE',lambda:self.f.runtime.prepare(*args,**self.f.options()))

for field,value,code in [('original_units','1.5','SCENARIO_QUANTITY'),('original_units',True,'SCENARIO_NUMBER'),('original_units','-1','SCENARIO_ROW_BOUND'),('excluded_units','-1','SCENARIO_ROW_BOUND'),('seller_unit_price','NaN','SCENARIO_NUMBER'),('seller_unit_price',100,'SCENARIO_NUMBER'),('seller_unit_price','-1','SCENARIO_ROW_BOUND')]:
 def invalid(self,field=field,value=value,code=code):
  self.f.cohort['rows'][0][field]=value;self.f.sync_allocation();self.bad(code,self.f.run)
 setattr(ScenarioTests,'test_bad_numeric_'+field+'_'+str(value).replace('-','neg').replace('.','point'),invalid)

if __name__=='__main__':
 with patch.object(socket.socket,'connect',side_effect=AssertionError('NETWORK_FORBIDDEN')),patch.object(socket.socket,'connect_ex',side_effect=AssertionError('NETWORK_FORBIDDEN')),patch.object(socket,'getaddrinfo',side_effect=AssertionError('DNS_FORBIDDEN')):
  result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ScenarioTests))
 print(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'network_calls':0,'live_credentials':False,'live_database':False,'installed':False,'status':'PASS' if result.wasSuccessful() else 'FAIL'}));raise SystemExit(0 if result.wasSuccessful() else 1)
