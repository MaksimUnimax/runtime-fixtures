"""Whole job recovery: both templates and method-first planning."""
import json, unittest, time, urllib.error
from unittest.mock import patch
from dataclasses import replace
from test_runtime import FlowTests as F, SCOPE
from test_read_surface import Universal as U
from engine import Worker, CallError
from repository import Repository
from semantics import Rejected

class TemplateRecovery(unittest.TestCase):
 setUp=F.setUp;tearDown=F.tearDown;scope_for=F.scope_for;submit=F.submit
 def fail_once(self,error):
  a=self.submit();self.transport.failure=error;self.worker.step();r=self.repo.get('A',a['job_id'])
  self.assertEqual(r['state'],'QUEUED',r['error']);self.transport.failure=None
  self.clock.advance(r['due']-self.clock()+1);self.worker.step();r=self.repo.get('A',a['job_id'])
  self.assertEqual(r['state'],'READY',r['error']);self.assertIn('123.45',self.engine.control('A','результат')['text'])
 def test_500(self):self.fail_once(CallError('HTTP_500',status=500))
 def test_502(self):self.fail_once(CallError('HTTP_502',status=502))
 def test_503(self):self.fail_once(CallError('HTTP_503',status=503,retry_at=self.clock()+200))
 def test_504(self):self.fail_once(CallError('HTTP_504',status=504))
 def test_408(self):self.fail_once(CallError('HTTP_408',status=408))
 def test_425(self):self.fail_once(CallError('HTTP_425',status=425))
 def test_429(self):self.fail_once(CallError('HTTP_429',status=429))
 def test_network(self):self.fail_once(CallError('NETWORK_OUTCOME_UNKNOWN',unknown=True))
 def test_broken_json(self):self.fail_once(CallError('RESPONSE_JSON',status=200))
 def test_shared_429_blocks_other_job_without_header(self):
  self.submit();self.transport.failure=CallError('HTTP_429',status=429);self.worker.step()
  self.transport.failure=None;second=self.submit('сводка заказов за вчера на озоне');self.worker.step()
  self.assertEqual(len(self.transport.calls),1);self.assertGreater(self.repo.get('A',second['job_id'])['due'],self.clock())
 def test_failed_new_question_gets_new_job_same_receipt_stays(self):
  a=self.submit(rid='receipt');self.transport.failure=CallError('HTTP_400',status=400);self.worker.step()
  self.assertEqual(self.submit(rid='receipt')['job_id'],a['job_id'])
  b=self.submit();self.assertNotEqual(a['job_id'],b['job_id']);self.assertEqual(b['state'],'QUEUED')
 def test_restart_recovers_read_and_fences_old_owner(self):
  a=self.submit();old=self.repo.claim();req=__import__('providers').build(json.loads(old['plan']),json.loads(old['plan'])['stores'][0])
  self.worker._call(old,req,json.loads(old['plan'])['stores'][0]);self.clock.advance(121)
  repo=Repository(self.repo.path,clock=self.clock);new=repo.claim();self.assertEqual(new['id'],old['id']);self.assertNotEqual(new['owner'],old['owner'])
  with self.assertRaises(Rejected):repo.reschedule(old['id'],old['owner'])
  repo.reschedule(new['id'],new['owner']);self.worker.step();self.assertEqual(self.repo.get('A',a['job_id'])['state'],'READY')
 def test_cancel_during_backoff(self):
  self.submit();self.transport.failure=CallError('HTTP_503',status=503);self.worker.step();self.repo.cancel('A');self.clock.advance(200)
  self.assertFalse(self.worker.step());self.assertEqual(len(self.transport.calls),1)
 def test_revoke_during_backoff(self):
  self.submit();self.transport.failure=CallError('HTTP_503',status=503);self.worker.step();self.scope=replace(SCOPE,revision='revoked');self.clock.advance(200)
  self.worker.step();self.assertEqual(len(self.transport.calls),1);self.assertEqual(self.repo.get('A')['state'],'FAILED')
 def test_compiler_repairs_same_question(self):
  a=self.submit('Каков объем заказанных единиц за октябрь на озоне');self.transport.model_raw='{"broken":'
  self.worker.step();self.assertEqual(self.repo.get('A')['state'],'QUEUED');self.transport.model_raw=None
  self.worker.step();self.worker.step();self.assertEqual(self.repo.get('A')['state'],'READY')
  self.assertEqual(self.repo.get('A')['id'],a['job_id']);self.assertEqual(len(self.transport.calls),3)
  self.assertEqual(self.transport.calls[1].body['repair']['code'],'LLM_JSON')
 def test_compiler_unknown_metric_then_correct_same_job(self):
  a=self.submit('Каков объем заказанных единиц за октябрь на озоне')
  self.transport.model_raw=json.dumps({'expressions':[{'metric':'invented_metric'}],'fully_understood':True,'unsupported':False})
  self.worker.step();self.assertEqual(self.repo.get('A')['state'],'QUEUED');self.transport.model_raw=None
  self.worker.step();self.worker.step();self.assertEqual(self.repo.get('A')['state'],'READY')
  self.assertEqual(self.repo.get('A')['id'],a['job_id']);self.assertEqual(self.transport.calls[1].body['repair']['code'],'UNKNOWN_METRIC')
 def test_bad_credentials_remain_explicit(self):
  self.submit();self.transport.failure=CallError('HTTP_403',status=403);self.worker.step();self.assertEqual(self.repo.get('A')['state'],'FAILED')
  self.clock.advance(1000);self.assertFalse(self.worker.step())

class FreeQuestionRecovery(unittest.TestCase):
 setUp=U.setUp;tearDown=U.tearDown;ask=U.ask;finish=U.finish
 def inject(self,op,error):
  original=self.transport;seen=[]
  class T:
   def prepare(self,*a):return None
   def execute(s,req,store=None):
    if req.operation==op and not seen:seen.append(True);raise error
    return original.execute(req,store)
  self.worker=Worker(self.engine,T())
 def test_model_503_then_answer(self):
  self.inject('deepseek_read_plan',CallError('HTTP_503',status=503));a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error'])
 def test_market_timeout_then_answer(self):
  self.inject('read.ozon.ozon_actions_list',CallError('NETWORK_OUTCOME_UNKNOWN',unknown=True));a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error'])
 def test_model_envelope_then_answer(self):
  self.inject('deepseek_read_plan',CallError('MODEL_ENVELOPE',status=200));a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error'])
 def test_provider_429_then_answer(self):
  self.inject('read.ozon.ozon_actions_list',CallError('HTTP_429',status=429));a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error'])

class HTTPRecovery(unittest.TestCase):
 def test_429_broken_body_preserves_status_and_retry_after(self):
  from test_audit_deadline import server,request
  from shared_http import read_response
  def serve(conn):
   conn.recv(4096);conn.sendall(b'HTTP/1.1 429 Too Many Requests\r\nRetry-After: 121\r\nContent-Length: 500\r\n\r\nx');time.sleep(.3)
  with server(serve)as port:
   with self.assertRaises(urllib.error.HTTPError)as cm:read_response(request(port),timeout=.15)
   self.assertEqual(cm.exception.code,429);self.assertEqual(cm.exception.headers['Retry-After'],'121')

# Fixture classes must not be discovered twice.
del F,U
