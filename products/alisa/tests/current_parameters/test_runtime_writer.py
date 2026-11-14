"""Actual Worker+SQLite -> actual owner-data writer+PostgreSQL, synthetic IO.

The intent object is an explicit TEST FIXTURE for an already admitted web command;
not a shipped production voice authorizer or an expansion of reports:read.
"""
from pathlib import Path
from datetime import date,datetime,timezone,timedelta
from copy import deepcopy
import json,sys,uuid
from django.test import TestCase
from django.db import transaction
from django.utils import timezone as djtime
from alisa_platform.owner_data import parameter_service as service
from alisa_platform.owner_data.service import actor_store
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from current_parameters.test_parameters import Fixture as DBFixture,AREA
import importlib.util,unittest
if importlib.util.find_spec('parameter_source_runtime')is None or importlib.util.find_spec('test_parameter_worker')is None:
 raise unittest.SkipTest('Requires the explicit qualified R4 runtime fixture; use PARAMETER_TEST_RUNTIME_ROOT')
from test_parameter_worker import Fixture as RuntimeFixture,PERIOD,TODAY,Transport,selection
from semantics import Scope,Store,fingerprint,canonical_json,strict_json
import parameter_source_runtime as runtime

class AdmittedWebIntent:
 def __init__(self,test,request='r1'):
  self.t=test;self.cmd=test.command('replace_calculated');self.ref='TEST-ADMITTED-'+self.cmd['command_id'];self.request=request
  self.target={'tenant_id':str(test.tenant.pk),'store_id':str(test.store.pk),'provider':'OZON','scope':deepcopy(AREA)}
  self.period={'requested':deepcopy(PERIOD),'actual':deepcopy(PERIOD),'explicit':True,'short_history':False}
  self.question='Рассчитай и сохрани коэффициент потерь на Озоне за октябрь';self.request_identity=fingerprint([request,fingerprint(self.question)])
  self.revoked=False;self.received=False;self.after_save_fail=False;self.commits=0
 def describe(self,root,key,target,period,mode):
  if root.get('request_identity')!=self.request_identity or key!='loss_rate'or target!=self.target or period!=self.period or mode!='replace_calculated':raise service.Rejected('PARAMETER_WRITE_INTENT_REQUIRED')
  return {'intent_ref':self.ref,'expected_revision':self.cmd['expected_revision'],'mode':mode}
 def current(self,intent,target,period):
  if self.revoked or intent!={'intent_ref':self.ref,'expected_revision':self.cmd['expected_revision'],'mode':'replace_calculated'}or target!=self.target or period!=self.period:return False
  with transaction.atomic():
   actor,store=actor_store(self.t.token,self.cmd['store_id']);return str(actor.tenant_id)==self.target['tenant_id']
 def commit(self,intent,target,period,envelope,verify,jid):
  if not self.current(intent,target,period):raise service.Rejected('PARAMETER_WRITE_INTENT_REVOKED')
  try:value=service.commit_calculated(self.t.token,self.cmd,envelope,period,verify_sources=verify)
  except Exception as exc:
   print('TEST_PLATFORM_COMMIT_FAILURE',type(exc).__name__,getattr(exc,'code','NO_TYPED_CODE'),flush=True)
   from semantics import Rejected
   raise Rejected(getattr(exc,'code','TEST_PLATFORM_COMMIT_ERROR'))from None
  self.received=True;self.commits+=1
  if self.after_save_fail:
   self.after_save_fail=False
   raise SystemExit('SYNTHETIC_CRASH_AFTER_PG_COMMIT')
  effective=value['effective'];return {'parameter':'loss_rate','saved':True,'value':effective['value'],'unit':effective['unit'],'mode':'replace_calculated','collected_at':effective['collected_at'],'calculated_at':effective['calculated_at'],'revision':value['revision']}

class QueueToCurrentDB(DBFixture,RuntimeFixture,TestCase):
 def setUp(self):
  DBFixture.create(self);self.db_store=self.store;RuntimeFixture.setup(self)
  self.scope=Scope(str(self.tenant.pk),'acl1',(Store(str(self.db_store.pk),'ozon','synthetic-existing-store','access1','recipe1','RUB'),))
  self.clock.now=(djtime.now()-timedelta(minutes=5)).timestamp();self.bound=AdmittedWebIntent(self);self.engine.parameter_intent_authority=self.bound
  self.transport.selection=selection(['parameter.loss_rate.v1'],store=str(self.db_store.pk),inputs={'period':PERIOD,'parameter_mode':'replace_calculated'})
 def tearDown(self):RuntimeFixture.close(self)
 def ask_bound(self,request='r1'):
  self.seq+=1;q=self.bound.question
  answer=self.engine.safe_submit(str(self.tenant.pk),q,request,fingerprint(q),TODAY,conversation_id='parameter-existing-owner',message_id=self.seq)
  # The existing dialogue adapter derives the internal request identity. Bind
  # the admitted original request to its returned owned job, not to model input.
  if request==self.bound.request and 'job_id'in answer:
   row=self.repo.get(str(self.tenant.pk),answer['job_id'])
   self.bound.request_identity=strict_json(row['plan'])['request_identity']
  return answer
 def finish_bound(self,a):
  self.assertIn('job_id',a,a)
  for _ in range(120):
   row=self.repo.get(str(self.tenant.pk),a['job_id'])
   if row['state']not in('QUEUED','RUNNING'):return row
   self.clock.advance(max(1,row['due']-self.clock()+1))
   import os
   if os.environ.get('PARAMETER_TEST_TRACE')=='1':
    def trace(frame,event,arg):
     if event=='exception'and frame.f_code.co_name=='step'and frame.f_code.co_filename.endswith('/engine.py'):
      import traceback
      traceback.print_exception(*arg)
     return trace
    sys.settrace(trace)
   try:self.worker.step()
   finally:sys.settrace(None)
  self.fail('did not finish')
 def test_selector_worker_actual_sources_to_single_postgres_value(self):
  r=self.finish_bound(self.ask_bound());self.assertIsNone(r['error']);self.assertEqual(CurrentParameter.objects.count(),1);value=CurrentParameter.objects.get();self.assertEqual(value.value,'0.5');self.assertEqual(value.origin,'calculated');self.assertIsNotNone(value.calculated_at)
  self.assertEqual(OwnerCommand.objects.count(),1);a=next(c for c in self.transport.calls if c.operation=='model_answer');ctx=json.loads(a.body['messages'][-1]['content'].split('\n',1)[1]);self.assertTrue(ctx['parameter_context'][0]['result']['saved'])
 def test_no_secret_or_previous_value_in_model_context(self):
  self.finish_bound(self.ask_bound());payload=' '.join(canonical_json(c.body)for c in self.transport.calls if c.source.startswith('model:'))
  self.assertNotIn(self.token,payload);self.assertNotIn('PRIVATE BUYER',payload);self.assertNotIn('ORDER-PRIVATE',payload)
 def test_new_question_cannot_reuse_other_write_intent(self):
  r=self.finish_bound(self.ask_bound('different-request'));self.assertTrue(r['error']);self.assertEqual(CurrentParameter.objects.count(),0);self.assertFalse(any(c.store_id for c in self.transport.calls))
 def test_manual_change_while_collecting_wins(self):
  a=self.ask_bound();self.worker.step();self.save('0.08');r=self.finish_bound(a);self.assertTrue(r['error']);self.assertEqual(CurrentParameter.objects.get().value,'0.08');self.assertEqual(OwnerCommand.objects.count(),1)
 def test_revoked_web_authority_prevents_write(self):
  a=self.ask_bound();self.worker.step();self.bound.revoked=True;r=self.finish_bound(a);self.assertTrue(r['error']);self.assertEqual(CurrentParameter.objects.count(),0)
 def test_receipts_do_not_keep_old_coefficient(self):
  self.finish_bound(self.ask_bound());self.save('0.12',1)
  self.assertEqual(CurrentParameter.objects.count(),1);self.assertEqual(CurrentParameter.objects.get().value,'0.12');self.assertEqual(CurrentParameter.objects.get().evidence,{})
  for receipt in OwnerCommand.objects.all():self.assertNotIn('value',receipt.result);self.assertNotIn('evidence',receipt.result)

 def test_restart_after_pg_commit_does_not_recollect_or_write_twice(self):
  from engine import Worker
  self.bound.after_save_fail=True;a=self.ask_bound()
  with self.assertRaises(SystemExit):self.finish_bound(a)
  self.assertEqual(CurrentParameter.objects.count(),1);self.assertEqual(OwnerCommand.objects.count(),1)
  calls=sum(bool(c.store_id)for c in self.transport.calls)
  self.clock.advance(125);self.worker=Worker(self.engine,self.transport)
  r=self.finish_bound(a);self.assertIsNone(r['error']);self.assertEqual(CurrentParameter.objects.get().revision,1)
  self.assertEqual(OwnerCommand.objects.count(),1);self.assertEqual(sum(bool(c.store_id)for c in self.transport.calls),calls)
