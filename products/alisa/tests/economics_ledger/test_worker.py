"""Actual Worker._call/SQLite receipt seam; not a live user-template dispatch.

Only provider replies are fake. The parent test driver selects a source leaf;
this does not claim the full economics source graph is registered or activated.
"""
from pathlib import Path
from copy import deepcopy
from dataclasses import replace
from datetime import date,datetime,timezone
from unittest.mock import patch
import unittest,tempfile,json,subprocess
from engine import Engine,Worker,CallError
from repository import Repository,Deferred
from semantics import fingerprint,strict_json,Rejected
from model_answer import Settings
from test_runtime import Clock,SCOPE
from test_template_only import Transport as BaseTransport,selection
import accrual_source_runtime as leaf
from economics_ledger.test_accruals import record

class Transport(BaseTransport):
 def __init__(self):super().__init__();self.selection=selection(['B01.ordered_units']);self.repeat=False;self.fail_next=False;self.revoker=None
 def execute(self,request,store):
  if request.operation!='read.ozon.finance_accrual_by_day':return super().execute(request,store)
  self.calls.append(request)
  if self.revoker:self.revoker()
  if self.fail_next:self.fail_next=False;raise CallError('HTTP_429',status=429,retry_at=0)
  params=request.body['params'];data={'accruals':[record(1 if not params['last_id']else 2,day=params['date'])],'last_id':'next'if not params['last_id']or self.repeat else''}
  return data,{'status':200,'elapsed_ms':1,'bytes':100}

class WorkerReceiptSeam(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name);self.clock=Clock();self.clock.now=datetime(2026,11,14,6,tzinfo=timezone.utc).timestamp();self.scope=SCOPE
  self.repo=Repository(self.path/'test.db',self.clock);self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=Settings(self.path/'answer.json'),template_mode=True)
  self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.output=None
  original=subprocess.run
  def run(cmd,*args,**kw):
   if type(cmd)is list and cmd[0]=='/usr/local/bin/node':cmd=[(__import__('os').environ.get('ALISA_TEST_NODE') or __import__('shutil').which('node') or '/root/alisa-owner-toolchain/node-v24.22.1-linux-x64/bin/node'),*cmd[1:]]
   return original(cmd,*args,**kw)
  self.node=patch('subprocess.run',run);self.node.start()
  q='Сколько товаров заказали вчера на Озоне?';a=self.engine.safe_submit('A',q,'source-observation',fingerprint(q),date(2026,11,14),conversation_id='r11-test',message_id=1)
  self.assertIn('job_id',a,a);self.jid=a['job_id'];self.worker.step();row=self.repo.get('A',self.jid);self.root=strict_json(row['plan']);self.desc=leaf.descriptor(self.root,'oz1',{'from':'2026-11-13','to':'2026-11-13'})
 def tearDown(self):self.node.stop();self.temp.cleanup()
 def once(self):
  current=self.repo.get('A',self.jid);self.clock.advance(max(2,current['due']-self.clock()+1));row=self.repo.claim();self.assertIsNotNone(row)
  progress=strict_json(row['progress'])if row['progress']else{}
  def save(packed):progress['_observed_fees']=packed;self.repo.reschedule(row['id'],row['owner'],progress)
  def complete(out):
   self.output=out;self.repo.complete_answer(row['id'],row['owner'],{'complete':True,'data':out.summary(),'pages':['Observed source only; forecast not qualified.']})
  try:leaf.step(self.worker,row,self.root,self.desc,progress.get('_observed_fees'),save_progress=save,on_complete=complete)
  except Deferred as error:self.repo.reschedule(row['id'],row['owner'],until=error.until)
 def finish(self):
  for _ in range(10):
   if self.output is not None:return self.output
   self.once()
  self.fail('source leaf did not finish')
 def test_actual_registered_request_and_received_ledger(self):
  out=self.finish();self.assertEqual(out.data['records'],2)
  with self.repo.connection()as c:
   events=c.execute("SELECT state,http FROM calls WHERE source NOT LIKE 'model:%'").fetchall();self.assertEqual(len(events),2);self.assertTrue(all(tuple(e)==('RECEIVED',200)for e in events))
  self.assertFalse(out.data['original_economics_ready'])
 def test_existing_job_not_new_queue_or_second_job(self):
  self.finish()
  with self.repo.connection()as c:self.assertEqual(c.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
 def test_source_leaf_does_not_request_extra_model_per_page(self):
  before=sum(c.source.startswith('model:')for c in self.transport.calls);self.finish();self.assertEqual(sum(c.source.startswith('model:')for c in self.transport.calls),before)
 def test_progress_encrypted_and_cleared_after_success(self):
  self.once();row=self.repo.get('A',self.jid);self.assertIn('cipher',row['progress']);self.assertNotIn('PRIVATE-POSTING',row['progress']);self.finish();self.assertIsNone(self.repo.get('A',self.jid)['progress'])
 def test_recreated_worker_resumes_same_page_cursor(self):
  self.once();self.worker=Worker(self.engine,self.transport);self.finish();calls=[c for c in self.transport.calls if c.store_id];self.assertEqual([c.body['params']['last_id']for c in calls],['','next'])
 def test_shared_retry_policy_429_does_not_spawn_new_job(self):
  self.transport.fail_next=True;self.finish();self.assertEqual(len([c for c in self.transport.calls if c.store_id]),3)
 def test_revocation_blocks_next_send(self):
  self.once();before=len(self.transport.calls);self.scope=replace(self.scope,revision='revoked')
  with self.assertRaises(Rejected):self.once()
  self.assertEqual(len(self.transport.calls),before)
 def test_revocation_during_response_not_saved_as_success(self):
  self.transport.revoker=lambda:setattr(self,'scope',replace(self.scope,revision='revoked'))
  with self.assertRaises(Rejected):self.once()
  self.assertIsNone(self.output)
 def test_repeat_cursor_rejected_after_received(self):
  self.transport.repeat=True;self.once()
  with self.assertRaises(Rejected)as e:self.once()
  self.assertEqual(e.exception.code,'ACCRUAL_CURSOR_NO_PROGRESS')
 def test_receipt_tamper_denied_at_finalization(self):
  self.once();self.once()
  with self.repo.connection(True)as c:c.execute("UPDATE calls SET http=500 WHERE source NOT LIKE 'model:%'")
  with self.assertRaises(Rejected)as e:self.once()
  self.assertEqual(e.exception.code,'ACCRUAL_RECEIPT_REJECTED')
 def test_changed_descriptor_cannot_decrypt_old_state(self):
  self.once();self.desc=leaf.descriptor(self.root,'oz1',{'from':'2026-11-12','to':'2026-11-13'})
  with self.assertRaises(Rejected)as e:self.once()
  self.assertEqual(e.exception.code,'ACCRUAL_PROGRESS_INTEGRITY')
 def test_foreign_store_target_denied(self):
  with self.assertRaises(Rejected):leaf.descriptor(self.root,'foreign',self.desc['period'])
 def test_encrypted_state_bitflip_denied(self):
  self.once();row=self.repo.get('A',self.jid);p=strict_json(row['progress']);cipher=p['_observed_fees']['cipher'];p['_observed_fees']['cipher']=('B'if cipher[0]!='B'else'A')+cipher[1:]
  with self.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=?WHERE id=?',(json.dumps(p),self.jid))
  with self.assertRaises(Rejected)as e:self.once()
  self.assertEqual(e.exception.code,'ACCRUAL_PROGRESS_INTEGRITY')
