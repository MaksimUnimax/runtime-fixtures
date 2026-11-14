"""Actual program-lane Unix protocol; the provider/model output remains synthetic."""
import importlib.util, unittest
if importlib.util.find_spec('parameter_report_runtime') is None:
 raise unittest.SkipTest('Requires the explicit isolated R8 runtime candidate; not an installed-feature assertion')

from pathlib import Path
from copy import deepcopy
from contextlib import contextmanager
from socketserver import UnixStreamServer,ThreadingMixIn,StreamRequestHandler
from threading import Thread
from unittest.mock import patch
from django.db import connections
from django.test import TransactionTestCase
import json,os
from parameter_compound import test_worker as worker_fixture
import model_program

class ProgramSocket(TransactionTestCase):
 setUp=worker_fixture.Compound.setUp
 tearDown=worker_fixture.Compound.tearDown
 start=worker_fixture.Compound.start
 delivery=worker_fixture.Compound.delivery
 filled=worker_fixture.Compound.filled
 tick=worker_fixture.Compound.tick
 finish=worker_fixture.Compound.finish
 ready=worker_fixture.Compound.ready
 provider_ops=worker_fixture.Compound.provider_ops

 @contextmanager
 def broker(self,disconnect_first=False,revoke_before_call=False):
  owner=self;requests=[];acks=[];failures=[];path=self.e.root/'program-test.sock'
  class Handler(StreamRequestHandler):
   def handle(self):
    try:
     request=json.loads(self.rfile.readline(524288));requests.append(request)
     if revoke_before_call:
      from django.utils import timezone
      owner.e.session.revoked_at=timezone.now();owner.e.session.save()
      self.wfile.write((json.dumps({'kind':'call','payload':{'messages':[]}})+'\n').encode());self.wfile.flush()
      line=self.rfile.readline(4096)
      if line:acks.append(json.loads(line))
      return
     if len(requests)==1:
      owner.e.save('0.25',1)
      if disconnect_first:return
     self.wfile.write((json.dumps({'kind':'complete','content':'Синтетический ответ исполнителя.','digest':'d'*64})+'\n').encode());self.wfile.flush()
     line=self.rfile.readline(4096)
     if line:acks.append(json.loads(line))
    except Exception as error:failures.append(type(error).__name__)
    finally:connections.close_all()
  class Server(ThreadingMixIn,UnixStreamServer):daemon_threads=True
  server=Server(str(path),Handler);os.chmod(path,0o600);thread=Thread(target=server.serve_forever,kwargs={'poll_interval':.01},daemon=True);thread.start()
  original=model_program.run
  def actual(*args,**kwargs):return original(*args,socket_path=str(path),**kwargs)
  try:
   with patch('model_program.selected',return_value=True),patch('model_program.run',side_effect=actual):yield requests,acks,failures
  finally:server.shutdown();server.server_close();thread.join(2)

 def test_actual_unix_lane_discards_stale_generation_and_acknowledges(self):
  self.filled();self.e.engine.program_answers=True;self.start()
  with self.broker()as(requests,acks,failures):self.ready()
  self.assertEqual(failures,[]);self.assertEqual(len(requests),2);self.assertNotEqual(requests[0]['job_id'],requests[1]['job_id'])
  self.assertEqual([r['resume_only']for r in requests],[False,False]);self.assertEqual(len(acks),2);self.assertEqual(self.provider_ops(),['ozon_orders'])
  new=json.loads(requests[-1]['document']);self.assertEqual(new['compound_parameter_context'][0]['estimates']['estimated_retained_units']['value'],'3')
 def test_actual_unix_lane_recovers_old_result_before_new_generation(self):
  self.filled();self.e.engine.program_answers=True;self.start()
  with self.broker(disconnect_first=True)as(requests,acks,failures):self.ready()
  self.assertEqual(failures,[]);self.assertEqual(len(requests),3);self.assertEqual(requests[0]['job_id'],requests[1]['job_id']);self.assertNotEqual(requests[1]['job_id'],requests[2]['job_id'])
  self.assertEqual([r['resume_only']for r in requests],[False,True,False]);self.assertEqual(len(acks),2);self.assertEqual(self.provider_ops(),['ozon_orders'])

 def test_plugin_call_after_session_revocation_is_not_dispatched(self):
  self.filled();self.e.engine.program_answers=True;self.start()
  with self.broker(revoke_before_call=True)as(requests,acks,failures):row=self.finish()
  self.assertEqual(row['state'],'FAILED');self.assertEqual(len(requests),1);self.assertEqual(acks,[])
  self.assertNotIn('model_answer_program',[c.operation for c in self.e.transport.calls]);self.assertEqual(self.provider_ops(),['ozon_orders'])
