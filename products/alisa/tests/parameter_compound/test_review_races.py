"""Reproduce the independent review's real two-transaction session race.

Synthetic accounts only, own PostgreSQL and actual private authority RPC. Session
changes commit on a different connection, not as part of the rejected transaction.
"""
import importlib.util,unittest
if importlib.util.find_spec('parameter_report_runtime') is None:
 raise unittest.SkipTest('Requires explicit isolated parameter-report native fixture')
from contextvars import ContextVar
from copy import deepcopy
from datetime import timedelta
from threading import Thread
from unittest.mock import patch
from django.test import TransactionTestCase
from django.utils import timezone
from django.db import connections
from alisa_platform.accounts.models import WebSession
from alisa_platform.owner_data import parameter_report_rpc as rpc
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from semantics import Rejected,strict_json
from . import test_worker as existing

class SessionLockRace(TransactionTestCase):
 def setUp(self):
  self.flow=existing.Compound('test_filled_parameters_one_query_no_coefficient_collection')
  self.flow.setUp();self.e=self.flow.e
 def tearDown(self):self.flow.tearDown()
 def bound(self):
  self.flow.filled();self.flow.start()
  for _ in range(20):
   self.flow.tick();row=self.e.row();progress=strict_json(row['progress'])if row['progress']else{}
   state=progress.get('fragment_progress')or{}
   if state.get('reference'):return state['reference']
  self.fail('No signed report reference')
 def mutate_on_other_connection(self,fields):
  result=[]
  def writer():
   try:
    with connections['default'].cursor()as c:c.execute("SET statement_timeout='3000ms'")
    result.append(WebSession.objects.filter(pk=self.e.session.pk).update(**fields))
   except Exception as error:result.append(type(error).__name__)
   finally:connections.close_all()
  thread=Thread(target=writer,name='owned-session-revocation-race');thread.start();thread.join(5)
  self.assertFalse(thread.is_alive(),'Own revoke transaction blocked unexpectedly')
  self.assertEqual(result,[1]);self.e.session.refresh_from_db()
 def raced_call(self,payload,fields):
  original=rpc.principal_current;fired=[]
  def validate(proof,pins):
   original(proof,pins)
   if not fired:
    fired.append(True);self.mutate_on_other_connection(fields)
  with patch.object(rpc,'principal_current',validate):
   with self.assertRaises(Rejected)as caught:self.e.engine.parameter_intent_authority.call(payload)
  self.assertEqual(fired,[True]);self.assertEqual(caught.exception.code,'AUTH_REQUIRED')
 def test_revoke_after_check_before_lock_blocks_refresh(self):
  reference=self.bound();before=list(CurrentParameter.objects.order_by('key').values())
  self.raced_call({'method':'report_refresh','reference':reference},{'revoked_at':timezone.now()})
  self.assertIsNotNone(self.e.session.revoked_at);self.assertEqual(list(CurrentParameter.objects.order_by('key').values()),before)
 def test_token_rotation_after_check_before_lock_blocks_current(self):
  reference=self.bound()
  self.raced_call({'method':'report_current','reference':reference},{'token_hash':'f'*64})
 def test_expiry_after_check_before_lock_blocks_fence(self):
  reference=self.bound();current=self.e.engine.parameter_intent_authority.call({'method':'report_refresh','reference':reference})
  self.raced_call({'method':'report_fence','reference':reference,'checkpoint':current['checkpoint']},
                  {'expires_at':timezone.now()-timedelta(seconds=1)})
 def test_revoke_in_commit_window_prevents_current_parameter_write(self):
  self.flow.delivery();self.flow.start();method=ContextVar('own-review-race-method',default=None);fired=[]
  dispatch=rpc.dispatch;validate=rpc.principal_current
  def tagged(authority,payload):
   token=method.set(payload.get('method'))
   try:return dispatch(authority,payload)
   finally:method.reset(token)
  def race(proof,pins):
   validate(proof,pins)
   if method.get()=='report_fill'and not fired:
    fired.append(True);self.mutate_on_other_connection({'revoked_at':timezone.now()})
  with patch.object(rpc,'dispatch',tagged),patch.object(rpc,'principal_current',race):
   row=self.flow.finish()
  self.assertEqual(fired,[True]);self.assertEqual(row['state'],'FAILED');self.assertFalse(CurrentParameter.objects.filter(key='loss_rate').exists())
  self.assertEqual(CurrentParameter.objects.get(key='delivery_mean').value,'100')
  self.assertEqual(OwnerCommand.objects.count(),1)
