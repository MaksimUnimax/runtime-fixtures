import importlib.util, unittest
if importlib.util.find_spec('parameter_report_runtime') is None:
 raise unittest.SkipTest('Requires the explicit isolated R8 runtime candidate; not an installed-feature assertion')
from copy import deepcopy
from unittest.mock import patch
from django.test import TransactionTestCase,override_settings
from django.utils import timezone
from datetime import timedelta
import json,uuid,os,sys,traceback
from current_parameters.collection_fixture import Environment
from alisa_platform.queries import service as queries
from alisa_platform.queries.models import Query
from alisa_platform.owner_data import parameter_service as values,parameter_report_rpc as rpc
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.runtime_adapter.authority import SessionPrincipal
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from alisa_platform.entitlements.models import AccessAdjustment
from test_template_only import selection
from engine import Worker
from semantics import strict_json,canonical_json
import parameter_report_runtime as report

TID='economics.delivery_projection.v1'
PERIOD={'from':'2026-10-01','to':'2026-10-31'}
COEFFICIENT_PERIODS={'loss_rate':{'from':'2026-10-01','to':'2026-10-31'},'delivery_mean':{'from':'2026-10-01','to':'2026-10-31'}}

class Compound(TransactionTestCase):
 def setUp(self):
  self.e=Environment();self.e.setup();self.e.engine.parameter_compound_policy={'enabled':True,'pin':report.PIN}
  # Recalculate version file after enabling only the test policy, if applicable.
  self.e.transport.selection=selection([TID],store='native-store',inputs={'period':PERIOD,'parameter_periods':COEFFICIENT_PERIODS})
  self.qid=str(uuid.uuid4());self.question='Оцени потери и доставку заказов Озон за октябрь по сохранённым коэффициентам'
 def tearDown(self):self.e.close()
 def start(self):return queries.submit(SessionPrincipal(self.e.token),self.qid,[str(self.e.store.pk)],self.question)
 def delivery(self,value='100',revision=0):
  q=self.e.command(value=value,revision=revision);q.update(parameter='delivery_mean',unit='RUB/ordered_unit');return values.execute(self.e.token,q)
 def filled(self):self.e.save('0.1');self.delivery('100')
 def run(self,result=None):return super().run(result)
 def tick(self):
  row=self.e.row();self.e.clock.advance(max(1,row['due']-self.e.clock()+1))
  if os.environ.get('PARAMETER_R8_TRACE')=='1':
   def trace(frame,event,arg):
    if event=='exception'and frame.f_code.co_name=='step'and frame.f_code.co_filename.endswith('/engine.py'):traceback.print_exception(*arg)
    return trace
   sys.settrace(trace)
  try:self.e.worker.step()
  finally:sys.settrace(None)
 def finish(self):
  for _ in range(250):
   row=self.e.row()
   if row['state']not in('RUNNING','QUEUED'):return row
   self.tick()
  self.fail('same-job report did not finish')
 def ready(self):
  row=self.finish();self.assertEqual(row['state'],'READY',row.get('error'));self.assertIsNone(row.get('error'));return row
 def context(self):
  req=[c for c in self.e.transport.calls if c.operation=='model_answer'][-1]
  return json.loads(req.body['messages'][-1]['content'].split('\n',1)[1])['compound_parameter_context'][0]
 def provider_ops(self):return [r.operation for r in self.e.transport.calls if r.store_id]
 def test_filled_parameters_one_query_no_coefficient_collection(self):
  self.filled();before=list(CurrentParameter.objects.order_by('key').values());self.start();self.ready()
  self.assertEqual(self.provider_ops(),['ozon_orders']);self.assertEqual(list(CurrentParameter.objects.order_by('key').values()),before)
  self.assertEqual(self.context()['estimates']['estimated_forward_last_delivery']['value'],'400')
  self.assertEqual(self.context()['estimates']['estimated_retained_units']['value'],'3.6')
  self.assertEqual(Query.objects.count(),1)
  with self.e.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
 def test_absent_both_fill_via_real_rpc_then_same_report(self):
  self.start();self.ready();self.assertEqual(CurrentParameter.objects.count(),2);self.assertEqual(OwnerCommand.objects.count(),2)
  self.assertEqual(CurrentParameter.objects.get(key='loss_rate').value,'0.5');self.assertEqual(CurrentParameter.objects.get(key='delivery_mean').value,'20')
  self.assertEqual(self.context()['estimates']['estimated_forward_last_delivery']['value'],'80')
  ops=[r.operation for r in self.e.transport.calls];self.assertEqual(ops.count('template_select'),1);self.assertEqual(ops.count('model_answer'),1);self.assertEqual(ops.count('ozon_orders'),1)
  with self.e.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
 def test_one_absent_only_that_producer_runs(self):
  self.e.save('0');self.start();self.ready();self.assertNotIn('read.ozon.returns_list',self.provider_ops());self.assertIn('read.ozon.finance_balance',self.provider_ops());self.assertEqual(CurrentParameter.objects.get(key='loss_rate').value,'0')
 def test_zero_uses_saved_value_without_producer(self):
  self.e.save('0');self.delivery('0');self.start();self.ready();self.assertEqual(self.provider_ops(),['ozon_orders']);self.assertEqual(self.context()['estimates']['estimated_retained_units']['value'],'4')
 def test_final_result_not_stored_as_past_coefficient_snapshot(self):
  self.e.save('0.083721');self.delivery('101.612345');self.start();row=self.ready()
  for data in [Query.objects.get().continuation,strict_json(row['plan']),strict_json(row['result'])]:
   raw=json.dumps(data);self.assertNotIn('0.083721',raw);self.assertNotIn('101.612345',raw);self.assertNotIn(self.e.token,raw)
 def test_revision_change_before_final_model_rebinds_without_source_repeat(self):
  self.filled();self.start()
  for _ in range(80):
   self.tick();row=self.e.row()
   if row['progress']and '_answer_pending'in strict_json(row['progress']):break
  else:self.fail('no final-answer checkpoint')
  self.e.save('0.25',1);self.ready();self.assertEqual(self.provider_ops(),['ozon_orders']);self.assertEqual(self.context()['estimates']['estimated_retained_units']['value'],'3')
 def test_revision_change_during_model_response_discards_stale_answer(self):
  self.filled();self.start();changed=[]
  def change(request):
   if request.operation=='model_answer'and not changed:changed.append(True);self.e.save('0.25',1)
  self.e.transport.on_call=change;self.ready();self.assertEqual(sum(x.operation=='model_answer'for x in self.e.transport.calls),2);self.assertEqual(self.provider_ops(),['ozon_orders']);self.assertEqual(self.context()['estimates']['estimated_retained_units']['value'],'3')
 def test_manual_fill_during_source_collection_wins(self):
  self.delivery();self.start();changed=[]
  def change(request):
   if request.operation=='read.ozon.returns_list'and not changed:changed.append(True);self.e.save('0.2')
  self.e.transport.on_call=change;self.ready();self.assertEqual(CurrentParameter.objects.get(key='loss_rate').value,'0.2');self.assertEqual(self.context()['estimates']['estimated_retained_units']['value'],'3.2')
 def test_lost_fill_ack_replays_commit_not_sources(self):
  self.delivery();self.start();old=self.e.native_authority._exchange;lost=[]
  def lose(raw):
   result=old(raw);data=json.loads(raw)
   if data.get('operation')=='parameter_collection'and data['payload'].get('method')=='report_fill'and not lost:lost.append(True);raise TimeoutError('synthetic lost reply')
   return result
  with patch.object(self.e.native_authority,'_exchange',lose):self.ready()
  self.assertTrue(lost);self.assertEqual(CurrentParameter.objects.get(key='loss_rate').revision,1);self.assertEqual(self.provider_ops().count('read.ozon.report_postings_create'),2)
 def test_cancelled_report_cannot_fill_later(self):
  self.start();self.tick();q=Query.objects.get();q.state='CANCELLED';q.save(update_fields=['state']);row=self.finish();self.assertEqual(row['state'],'FAILED');self.assertFalse(CurrentParameter.objects.exists())
 def test_revoked_session_stops_before_collection(self):
  self.start();self.e.session.revoked_at=timezone.now();self.e.session.save();row=self.finish();self.assertEqual(row['state'],'FAILED');self.assertFalse(CurrentParameter.objects.exists());self.assertEqual(self.provider_ops(),[])
 def test_revoked_entitlement_stops_current_and_missing(self):
  self.filled();self.start();AccessAdjustment.objects.create(id=uuid.uuid4(),grant=self.e.grant,cutoff=self.e.grant.starts_at,actor_id=uuid.uuid4(),reason='SYNTHETIC')
  row=self.finish();self.assertEqual(row['state'],'FAILED');self.assertEqual(self.provider_ops(),[])
 def test_no_model_chosen_arbitrary_parameter_or_formula(self):
  self.e.transport.selection['invocations'][0]['input']['parameters']={'delivery_mean':'1'};self.start();row=self.finish();self.assertEqual(self.provider_ops(),[]);self.assertFalse(CurrentParameter.objects.exists())
 def test_default_coefficient_year_independent_from_report_day(self):
  self.e.transport.selection=selection([TID],store='native-store',inputs={'period':{'from':'2026-11-13','to':'2026-11-13'}});self.start()
  for _ in range(10):
   self.tick();q=Query.objects.get()
   if q.continuation.get(rpc.KEY):break
  else:self.fail('no dependency admission')
  node=next(iter(q.continuation[rpc.KEY].values()));periods=[x['plan']['parameter_period']for x in node['dependencies'].values()]
  self.assertTrue(periods);self.assertTrue(all(x['actual']=={'from':'2025-11-14','to':'2026-11-13'}and not x['explicit']for x in periods));self.assertEqual(node['descriptor']['input']['period'],{'from':'2026-11-13','to':'2026-11-13'})
 def test_disabled_compound_flag_does_not_grant_writes(self):
  with override_settings(OWNER_PARAMETER_COMPOUNDS_ENABLED=False):
   self.start();row=self.finish()
  self.assertEqual(self.provider_ops(),[]);self.assertFalse(CurrentParameter.objects.exists())
 def test_restart_same_job_does_not_repeat_received_sources(self):
  self.delivery();self.start()
  for _ in range(40):
   self.tick()
   if 'read.ozon.report_postings_create'in self.provider_ops():break
  self.e.worker=Worker(self.e.engine,self.e.transport);self.ready();self.assertEqual(self.provider_ops().count('read.ozon.report_postings_create'),2);self.assertEqual(Query.objects.count(),1)
 def test_program_lane_recalculation_has_new_revision_identity(self):
  self.filled();self.e.engine.program_answers=True;self.start();keys=[];contexts=[]
  def program(worker,row,messages,data,**kw):
   keys.append(kw['generation']);contexts.append(deepcopy(data['compound_parameter_context']))
   if len(keys)==1:self.e.save('0.25',1)
   kw['on_complete']({'content':'Тестовый ответ на проверенных данных.','finish_reason':'stop'})
  with patch('model_program.selected',return_value=True),patch('model_program.run',side_effect=program):self.ready()
  self.assertEqual(len(keys),2);self.assertNotEqual(keys[0],keys[1]);self.assertEqual(self.provider_ops(),['ozon_orders']);self.assertEqual(contexts[-1][0]['estimates']['estimated_retained_units']['value'],'3')
 def test_program_resume_cannot_relabel_old_output_after_parameter_edit(self):
  from repository import Deferred
  self.filled();self.e.engine.program_answers=True;self.start();keys=[];calls=[]
  def program(worker,row,messages,data,**kw):
   keys.append(kw['generation']);calls.append(deepcopy(data['compound_parameter_context']))
   if len(keys)==1:
    with self.e.repo.connection(True)as connection:
     latest=self.e.repo._owned(connection,row['id'],row['owner']);progress=strict_json(latest['progress']);progress['_program_started']=True
     connection.execute('UPDATE jobs SET progress=? WHERE id=?',(canonical_json(progress),row['id']))
    self.e.save('0.25',1);raise Deferred(self.e.clock()+1)
   kw['on_complete']({'content':'Восстановленный или новый тестовый ответ.','finish_reason':'stop'})
  with patch('model_program.selected',return_value=True),patch('model_program.run',side_effect=program):self.ready()
  self.assertEqual(len(keys),3);self.assertEqual(keys[0],keys[1]);self.assertNotEqual(keys[1],keys[2]);self.assertEqual(self.provider_ops(),['ozon_orders'])
 def test_forged_private_reference_rejected(self):
  self.start();self.tick()
  with self.assertRaises(Exception):self.e.engine.parameter_intent_authority.call({'method':'report_refresh','reference':'r8:forged'})
  self.assertFalse(CurrentParameter.objects.exists())
 def test_dry_compile_does_not_create_dependencies_or_source_calls(self):
  from template_catalog import compile_selection
  self.start();row=self.e.row();plan=strict_json(row['plan']);before=Query.objects.get().continuation
  compile_selection(self.e.engine,plan,self.e.transport.selection)
  self.assertEqual(Query.objects.get().continuation,before);self.assertEqual(self.e.transport.calls,[]);self.assertFalse(CurrentParameter.objects.exists())

 def test_revoked_session_after_binding_prevents_report_source(self):
  self.filled();self.start();self.tick();self.tick()
  self.assertTrue(Query.objects.get().continuation.get(rpc.KEY));self.assertEqual(self.provider_ops(),[])
  self.e.session.revoked_at=timezone.now();self.e.session.save();row=self.finish()
  self.assertEqual(row['state'],'FAILED');self.assertEqual(self.provider_ops(),[])
 def test_cancel_after_binding_prevents_report_source(self):
  self.filled();self.start();self.tick();self.tick();q=Query.objects.get();q.state='CANCELLED';q.save(update_fields=['state'])
  row=self.finish();self.assertEqual(row['state'],'FAILED');self.assertEqual(self.provider_ops(),[])
