"""Integration with a separately pinned runtime's existing completeness gate.
Usage: ALISA_RUNTIME=/path/to/matrix-join-r1 python3 -B this_file.py
The bridge below is a synthetic test adapter, not a production adapter.
"""
from pathlib import Path
from copy import deepcopy
from unittest.mock import patch
import hashlib,json,os,socket,sys,unittest
from owner_inputs import OwnerInputs,InputError,digest
ROOT=Path(__file__).parent
RUNTIME=Path(os.environ['ALISA_RUNTIME']).resolve()
sys.path.insert(0,str(RUNTIME))
from report_contracts import ReportContracts
CATALOG=json.loads((ROOT/'owner_input_catalog.json').read_text())
POLICY=json.loads((RUNTIME/'report_contract_catalog.json').read_text())
NOW=1793865600
PERIOD={'from':'2026-11-01','to':'2026-11-04'}
SCOPE='a'*64
class Integration(unittest.TestCase):
 def setUp(self):
  self.owner=OwnerInputs(CATALOG);self.gate=ReportContracts(POLICY);self.allowed=True
  self.payload={'schema':'alice-owner-input-snapshot/v1','revision':'integration-r1','scope_hash':SCOPE,'catalog_hash':self.owner.hash,'issued_at':NOW-60,'expires_at':NOW+3600,'entries':[]}
  self.request={'scope_hash':SCOPE,'entity':'store:fixture','currency':'RUB','period':PERIOD,'fields':['own_cost_amount']}
  self.context={'scope_hash':SCOPE,'period':PERIOD,'currency':'RUB','mode':'period_financial_result_per_ordered_unit','as_of':NOW-1,'catalog_hash':'b'*64}
  self.records=[self.observation('ordered_units','4','order_date','item'),self.observation('marketplace_costs','10','accrual_date',keys=['market:a']),self.observation('advertising','2','advertising_date',keys=['ads:a']),self.observation('advertising_finance_overlap','0','reconciliation'),self.observation('expense_coverage','0','reconciliation')]
 def observation(self,name,value,axis,unit='currency',keys=None):
  return {'id':name,'state':'KNOWN','coverage':'COMPLETE','value':value,'currency':'RUB','period':PERIOD,'scope_hash':SCOPE,'axis':axis,'unit':unit,'source_hash':'c'*64,'receipt_hash':'d'*64,'observed_at':NOW,'expires_at':NOW+60,'zero_proof':value=='0','expense_keys':keys or []}
 def add(self,field,value,state='VALUE',period=None,rid='owner-fact'):
  self.payload['entries'].append({'id':rid,'field':field,'entity':'store:fixture','currency':'RUB','period':period or PERIOD,'state':state,'value':value})
 def resolve(self,**kwargs):
  return self.owner.resolve({'payload':self.payload,'sha256':digest(self.payload)},self.request,authorize=lambda *x:self.allowed,now=NOW,**kwargs)
 def bridge(self,result,field,component,axis,unit):
  body={k:v for k,v in result.items() if k!='resolution_sha256'}
  if digest(body)!=result['resolution_sha256']:raise ValueError('FORGED_RESOLUTION')
  segments=result['fields'][field]['segments']
  if len(segments)!=1:raise ValueError('SPLIT_INPUT_REQUIRES_UNIT_MATCH')
  s=segments[0]
  if s['unit']!=unit or s['period']!=PERIOD:raise ValueError('INPUT_DIMENSION_MISMATCH')
  r=self.observation(component,s['value'],axis,unit,keys=['owner:'+str(s['entry_id'])] if s['state']=='VALUE' else [])
  r.update(source_hash=result['pin']['catalog_hash'],receipt_hash=result['resolution_sha256'])
  if s['state']=='EXCLUDED_BY_OWNER':r.update(state='EXCLUDED_BY_USER',value=None,zero_proof=False)
  elif s['state']=='NOT_PROVIDED':r.update(state='NOT_PROVIDED',value=None,zero_proof=False)
  return r
 def evaluate(self,records):
  return self.gate.evaluate('period_unit_expenses',self.context,records,verify=lambda *x:self.allowed,now=NOW)
 def test_known_owner_period_cost_preserved(self):
  self.add('own_cost_amount','123.40');o=self.bridge(self.resolve(),'own_cost_amount','own_costs','user_cost_period','currency');r=self.evaluate(self.records+[o])
  self.assertTrue(r['usable']);self.assertEqual(r['values']['own_costs'],'123.40');self.assertFalse(r['report_saved'])
 def test_owner_cost_does_not_make_missing_advertising_zero(self):
  self.add('own_cost_amount','123.40');o=self.bridge(self.resolve(),'own_cost_amount','own_costs','user_cost_period','currency')
  r=self.evaluate([x for x in self.records if x['id']!='advertising']+[o]);self.assertFalse(r['usable']);self.assertEqual(r['values'],{})
 def test_explicit_excluded_tax_remains_omission(self):
  self.request['fields']=['tax_amount'];self.add('tax_amount',None,'EXCLUDED_BY_OWNER');o=self.bridge(self.resolve(),'tax_amount','tax','user_tax_basis','currency');r=self.evaluate(self.records+[o])
  self.assertTrue(r['usable']);self.assertNotIn('tax',r['values']);self.assertTrue(any(x['component']=='tax' and x['state']=='EXCLUDED_BY_USER' for x in r['omissions']))
 def test_unit_input_cannot_be_used_as_total_cogs(self):
  self.request['fields']=['unit_cost'];self.add('unit_cost','250');r=self.resolve()
  with self.assertRaisesRegex(ValueError,'INPUT_DIMENSION_MISMATCH'):self.bridge(r,'unit_cost','cogs','qualified_consumed_units','currency')
 def test_monthly_input_not_automatically_allocated(self):
  self.add('own_cost_amount','3000',period={'from':'2026-11-01','to':'2026-11-30'});o=self.bridge(self.resolve(),'own_cost_amount','own_costs','user_cost_period','currency');r=self.evaluate(self.records+[o])
  self.assertNotIn('own_costs',r['values']);self.assertTrue(any(x['component']=='own_costs' for x in r['omissions']))
 def test_changed_fact_requires_new_validation(self):
  self.add('own_cost_amount','10');r=self.resolve();r['fields']['own_cost_amount']['segments'][0]['value']='0'
  with self.assertRaisesRegex(ValueError,'FORGED_RESOLUTION'):self.bridge(r,'own_cost_amount','own_costs','user_cost_period','currency')
 def test_revoked_owner_approval_blocks_execute(self):
  self.add('own_cost_amount','10');r=self.resolve();self.allowed=False
  with self.assertRaises(InputError) as e:self.resolve(action='execute',pin=r['pin'])
  self.assertEqual(e.exception.code,'OWNER_INPUT_AUTH_DENIED')
 def test_multiple_effective_costs_require_quantity_alignment(self):
  self.request['fields']=['unit_cost'];self.add('unit_cost','250',period={'from':'2026-11-01','to':'2026-11-02'});self.add('unit_cost','300',period={'from':'2026-11-03','to':'2026-11-04'},rid='cost2')
  with self.assertRaisesRegex(ValueError,'SPLIT_INPUT_REQUIRES_UNIT_MATCH'):self.bridge(self.resolve(),'unit_cost','cogs','qualified_consumed_units','currency')
if __name__=='__main__':
 manifest=json.loads((RUNTIME/'DEPLOY_VERIFIED_MANIFEST.json').read_text())
 for n in ('report_contracts.py','report_contract_catalog.json'):assert hashlib.sha256((RUNTIME/n).read_bytes()).hexdigest()==manifest[n]
 with patch.object(socket.socket,'connect',side_effect=AssertionError('NETWORK_FORBIDDEN')),patch.object(socket,'getaddrinfo',side_effect=AssertionError('DNS_FORBIDDEN')):
  result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Integration))
 print(json.dumps({'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'network_calls':0,'production_adapter_installed':False,'status':'PASS' if result.wasSuccessful() else 'FAIL'}));raise SystemExit(0 if result.wasSuccessful() else 1)
