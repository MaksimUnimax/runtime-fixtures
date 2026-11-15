"""Existing Worker/ledger/source recipes, synthetic provider data, no live IO."""
from copy import deepcopy
from dataclasses import replace
from datetime import datetime,timezone,date
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch
import unittest,tempfile,json
from engine import Engine,Worker,CallError
from repository import Repository,Deferred
from semantics import fingerprint,canonical_json,strict_json,Rejected
from model_answer import Settings
from test_runtime import Clock,SCOPE
from test_template_only import Transport as BaseTransport,selection
from test_finance_stock import oz_finance
from parameter_support import economics_cohort as eco
from economics_cohort import fixtures as financial
import period_cost_source_runtime as leaf

PERIOD={'from':'2026-11-13','to':'2026-11-13'}
class Transport(BaseTransport):
 def __init__(self):
  super().__init__();self.selection=selection(['B01.ordered_units'],inputs={'period':PERIOD});self.fail_once=None;self.revoker=None;self.missing_storage=False;self.empty_ads=False
 def execute(self,request,store):
  if request.operation not in('ozon_finance','ozon_ads_daily'):return super().execute(request,store)
  self.calls.append(request)
  if self.revoker:self.revoker()
  if self.fail_once==request.operation:self.fail_once=None;raise CallError('HTTP_429',status=429,retry_at=0)
  if request.operation=='ozon_finance':
   value=oz_finance()
   if self.missing_storage:value['cashflows']['services']=[v for v in value['cashflows']['services']if v['name']!='product_placement_in_ozon_warehouses']
  else:value={'rows':[]if self.empty_ads else[{'id':'123','date':'2026-11-13','moneySpent':'100,00','title':'PRIVATE CAMPAIGN NAME'}]}
  return value,{'status':200,'bytes':100,'elapsed_ms':1}

class PeriodWorker(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.clock=Clock();self.clock.now=datetime(2026,11,15,6,tzinfo=timezone.utc).timestamp();self.scope=SCOPE
  self.repo=Repository(Path(self.tmp.name)/'state.sqlite3',self.clock);self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=Settings(Path(self.tmp.name)/'answer.json'),template_mode=True)
  self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.permission=True;self.saved=None;self.output=None;self.crash=False
  q='Расчёт экономики Ozon за вчера';reply=self.engine.safe_submit('A',q,'r14-period',fingerprint(q),date(2026,11,15),conversation_id='r14-period-source-fixture',message_id=1)
  self.assertIn('job_id',reply);self.jid=reply['job_id'];self.worker.step();row=self.repo.get('A',self.jid);self.root=strict_json(row['plan'])
  self.desc=leaf.descriptor(self.engine,self.root,'oz1',PERIOD)
 def tearDown(self):self.tmp.cleanup()
 def once(self):
  before=self.repo.get('A',self.jid);self.clock.advance(max(2,before['due']-self.clock()+1));row=self.repo.claim();self.assertIsNotNone(row);progress=strict_json(row['progress'])if row['progress']else{}
  def save(packed):self.saved=packed;progress['_period_costs']=packed;self.repo.reschedule(row['id'],row['owner'],progress)
  def complete(value,packed):
   if self.crash:raise SystemExit('SYNTHETIC_PARENT_CRASH')
   self.output=value;self.saved=packed;self.repo.complete_answer(row['id'],row['owner'],{'complete':True,'pages':['Verified period source'],'data':value.checkpoint()})
  try:leaf.step(self.worker,row,self.root,self.desc,progress.get('_period_costs'),authorize=lambda:self.permission,save_progress=save,on_complete=complete)
  except Deferred as error:self.repo.reschedule(row['id'],row['owner'],until=error.until)
 def finish(self):
  for _ in range(8):
   if self.output:return self.output
   self.once()
  self.fail('did not finish')
 def calls(self):return len([x for x in self.transport.calls if x.store_id])
 def test_existing_two_sources_one_job(self):
  value=self.finish();self.assertEqual(value.data['rows'][1]['amount'],'30');self.assertEqual(value.data['rows'][0]['amount'],'100');self.assertEqual(self.calls(),2)
  with self.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
 def test_no_model_for_each_cost(self):
  count=len([c for c in self.transport.calls if c.source.startswith('model:')]);self.finish();self.assertEqual(len([c for c in self.transport.calls if c.source.startswith('model:')]),count)
 def test_each_source_receipt_real_success(self):
  self.finish()
  with self.repo.connection()as c:
   states=c.execute("SELECT state,http FROM calls WHERE source NOT LIKE 'model:%'").fetchall();self.assertEqual([tuple(x)for x in states],[('RECEIVED',200),('RECEIVED',200)])
 def test_storage_agreed_component_not_other_temporary_service(self):
  value=self.finish();self.assertEqual(value.as_source()['rows'][1]['amount'],'30')
 def test_checkpoint_encrypted_no_campaign_name(self):
  self.once();self.once();row=self.repo.get('A',self.jid);self.assertIn('cipher',row['progress']);self.assertNotIn('PRIVATE CAMPAIGN',row['progress']);self.finish();self.assertIsNone(self.repo.get('A',self.jid)['progress'])
 def test_restart_after_one_source_no_refetch(self):
  self.once();self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(self.calls(),2)
 def test_restart_after_two_sources_no_refetch(self):
  self.once();self.once();self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(self.calls(),2)
 def test_parent_crash_after_source_completion_no_refetch(self):
  self.once();self.once();self.crash=True
  with self.assertRaises(SystemExit):self.once()
  self.crash=False;self.clock.advance(125);self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(self.calls(),2)
 def test_existing_429_retry_not_source_specific_loop(self):
  self.transport.fail_once='ozon_ads_daily';self.finish();self.assertEqual(self.calls(),3)
 def test_permission_revoked_before_send(self):
  self.permission=False
  with self.assertRaises(Rejected):self.once()
  self.assertEqual(self.calls(),0)
 def test_permission_revoked_after_response_not_checkpointed(self):
  self.transport.revoker=lambda:setattr(self,'permission',False)
  with self.assertRaises(Rejected):self.once()
  self.assertIsNone(self.saved)
 def test_permission_revoked_before_restore(self):
  self.once();self.once();self.permission=False
  with self.assertRaises(Rejected):self.once()
  self.assertIsNone(self.output)
 def test_store_access_revision_revoked(self):
  self.once();self.scope=replace(self.scope,revision='changed')
  with self.assertRaises(Rejected):self.once()
  self.assertEqual(self.calls(),1)
 def test_receipt_from_other_job_refused(self):
  self.once();self.once()
  with self.repo.connection(True)as c:c.execute("UPDATE calls SET jid='other'WHERE source NOT LIKE 'model:%'")
  with self.assertRaises(Rejected):self.once()
 def test_receipt_http_not_200_refused(self):
  self.once();self.once()
  with self.repo.connection(True)as c:c.execute("UPDATE calls SET http=500 WHERE source NOT LIKE 'model:%'")
  with self.assertRaises(Rejected):self.once()
 def test_changed_descriptor_cannot_resume(self):
  self.once();self.desc=leaf.descriptor(self.engine,self.root,'oz1',{'from':'2026-11-12','to':'2026-11-12'})
  with self.assertRaises(Rejected):self.once()
 def test_missing_storage_is_not_zero_from_accepted_scalar(self):
  self.transport.missing_storage=True;self.once();self.once()
  with self.assertRaises(Rejected)as error:self.once()
  self.assertEqual(error.exception.code,'PERIOD_COST_STORAGE_ABSENT_NOT_ZERO')
 def test_empty_ads_refused_by_existing_contract(self):
  self.transport.empty_ads=True;self.once()
  with self.assertRaises(Rejected):self.once()
  self.assertIsNone(self.output)
 def test_source_can_rebind_formula_with_no_repeat_http(self):
  self.once();self.once();row=self.repo.get('A',self.jid)
  a=leaf.restore(self.worker,row,self.root,self.desc,self.saved,authorize=lambda:True)
  b=leaf.restore(self.worker,row,self.root,self.desc,self.saved,authorize=lambda:True)
  self.assertEqual(a.checkpoint(),b.checkpoint());self.assertEqual(self.calls(),2)
 def test_confirmed_costs_into_financial_formula(self):
  value=self.finish();target=self.desc['scope'];bundle=financial.bundle(target=target);bundle['period_costs']=value.as_source()
  known={k:eco.c.CANON(v)for k,v in bundle.items()if k!='period_costs'}
  q=eco.qualify(bundle,target,PERIOD,verify=lambda k,v,t,p:value.verifies(k,v,t,p)if k=='period_costs'else known[k]==eco.c.CANON(v))
  unit,coeffs=financial.numbers(q);out=eco.calculate(q,unit,coeffs,financial.unknown())
  self.assertEqual(out['scenarios']['with_loss']['totals']['advertising'],'100');self.assertEqual(out['scenarios']['with_loss']['totals']['storage'],'30');self.assertIsNone(out['scenarios']['with_loss']['after_declared_owner_inputs'])
 def test_ordinary_scalar_keeps_its_answer_capture(self):
  self.once();self.once()
  from providers import build_task
  before=self.repo.get('A',self.jid);self.clock.advance(62);row=self.repo.claim()
  child=self.desc['tasks'][0]['child'];task=self.desc['tasks'][0]['task'];store=child['stores'][0]
  self.worker._call(row,build_task(child,store,task),store)
  saved=strict_json(self.repo.get('A',self.jid)['progress']);self.assertEqual(len(saved['_answer_api_data']),1)
 def test_existing_other_capture_not_erased_by_private_period_source(self):
  before=self.repo.get('A',self.jid);self.clock.advance(2);row=self.repo.claim()
  from providers import build_task
  item=self.desc['tasks'][0];store=item['child']['stores'][0]
  self.worker._call(row,build_task(item['child'],store,item['task']),store)
  self.repo.reschedule(row['id'],row['owner'])
  self.once();self.once();saved=strict_json(self.repo.get('A',self.jid)['progress']);self.assertEqual(len(saved['_answer_api_data']),1)
 def test_descriptor_without_authority_not_read_permission(self):
  row=self.repo.get('A',self.jid)
  with self.assertRaises(Rejected):leaf.restore(self.worker,row,self.root,self.desc,{},authorize=None)

 def test_real_transport_decimal_money_and_unused_fields_survive_restart(self):
  original=self.transport.execute
  def numeric(request,store):
   value,meta=original(request,store)
   if request.operation=='ozon_finance':
    for service in value['cashflows']['services']:
     if service['name']=='product_placement_in_ozon_warehouses':service['amount']['value']=Decimal('-30.125')
    value['unused_provider_fraction']=Decimal('0.12345678901234567890123456789')
   elif request.operation=='ozon_ads_daily':
    value['rows'][0]['moneySpent']=Decimal('100.000000001')
    value['rows'][0]['unused_provider_fraction']=Decimal('0.12345678901234567890123456789')
   return value,meta
  self.transport.execute=numeric
  self.once();self.worker=Worker(self.engine,self.transport)
  value=self.finish()
  self.assertEqual(value.data['rows'][0]['amount'],'100.000000001')
  self.assertEqual(value.data['rows'][1]['amount'],'30.125')
  self.assertEqual(self.calls(),2)

 def test_transport_encoding_keeps_json_number_types_and_exact_digits(self):
  value={'nested':[Decimal('0.123456789012345678901234567890123456789'),True,None,3,'3'],
         'exponent':Decimal('1E-80')}
  decoded=json.loads(leaf._transport_body(value),parse_float=Decimal)
  self.assertEqual(decoded,value)
  self.assertIs(type(decoded['nested'][0]),Decimal)

 def test_transport_encoding_refuses_nonfinite_numbers_and_binary_floats(self):
  for value in (Decimal('NaN'),Decimal('Infinity'),Decimal('-Infinity'),0.1):
   with self.subTest(value=str(value)):
    with self.assertRaises(Rejected):leaf._transport_body({'unused':value})

 def test_provider_day_month_year_passes_existing_scalar_without_mutating_source(self):
  original=self.transport.execute;seen=[]
  def regional_date(request,store):
   value,meta=original(request,store)
   if request.operation=='ozon_ads_daily':
    value['rows'][0]['date']='13.11.2026';seen.append(value)
   return value,meta
  self.transport.execute=regional_date
  value=self.finish()
  self.assertEqual(value.data['rows'][0]['amount'],'100')
  self.assertEqual(seen[0]['rows'][0]['date'],'13.11.2026')
  state=leaf._open(self.repo,self.repo.get('A',self.jid),self.desc,self.saved)
  packet=leaf._packet(state['packets'][1])
  self.assertEqual(json.loads(packet['body'])['rows'][0]['date'],'13.11.2026')

 def test_same_campaign_day_in_two_date_formats_is_not_counted_twice(self):
  original=self.transport.execute
  def duplicate_date(request,store):
   value,meta=original(request,store)
   if request.operation=='ozon_ads_daily':value['rows'].append({**value['rows'][0],'date':'13.11.2026'})
   return value,meta
  self.transport.execute=duplicate_date
  with self.assertRaises(Rejected):self.finish()
  self.assertIsNone(self.output)

 def test_invalid_regional_date_is_typed_failure(self):
  original=self.transport.execute
  def invalid_date(request,store):
   value,meta=original(request,store)
   if request.operation=='ozon_ads_daily':value['rows'][0]['date']='31.11.2026'
   return value,meta
  self.transport.execute=invalid_date
  with self.assertRaises(Rejected)as error:self.finish()
  self.assertEqual(error.exception.code,'PERIOD_COST_DAY')
