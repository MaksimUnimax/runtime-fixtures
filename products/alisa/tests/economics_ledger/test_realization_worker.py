"""Actual registered requests/Worker receipts and calculation; fake remote replies.

The parent test drives the new source component inside one existing job. This
is not a newly registered full economics template or a live-owner test.
"""
from copy import deepcopy
from dataclasses import replace
from datetime import date,datetime,timezone
from pathlib import Path
from unittest.mock import patch
import unittest,tempfile,subprocess,json,os,shutil
from engine import Engine,Worker,CallError
from repository import Repository,Deferred
from semantics import fingerprint,canonical_json,strict_json,Rejected
from model_answer import Settings
from protected_reads import ProtectedPayload
from parameter_source_runtime import _token
from parameter_support import economics_cohort as eco
from economics_ledger.test_realization import source,packet
from economics_cohort import fixtures
from test_runtime import Clock,SCOPE
from test_template_only import Transport as BaseTransport,selection
import realization_source_runtime as leaf

class Transport(BaseTransport):
 def __init__(self):
  super().__init__();self.selection=selection(['B01.ordered_units']);self.failure=None;self.revoker=None;self.plain=False;self.mismatch=False;self.bad_bytes=False;self.shift_body=False
 def execute(self,request,store):
  if request.operation not in ('read.ozon.finance_realization_posting','read.ozon.finance_realization_v2'):return super().execute(request,store)
  self.calls.append(request)
  if self.revoker:self.revoker()
  if self.failure:
   error=self.failure;self.failure=None;raise error
  kind='POSTING'if request.operation.endswith('finance_realization_posting')else'MONTHLY'
  data=source()
  if self.mismatch and kind=='MONTHLY':data['header']['number']='changed-monthly-document'
  body=packet(data,kind)['body']
  if self.bad_bytes:body=b'{}'
  out=ProtectedPayload({'no_raw_to_model':True},body,'application/json')
  if self.plain:out={'header':{},'rows':[]}
  return out,{'status':200,'bytes':len(body)+int(self.shift_body),'elapsed_ms':1}

class WorkerFlow(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name);self.clock=Clock();self.clock.now=datetime(2026,12,6,10,tzinfo=timezone.utc).timestamp();self.scope=SCOPE
  self.repo=Repository(self.path/'state.db',self.clock);self.engine=Engine(self.repo,lambda t:self.scope,answer_settings=Settings(self.path/'answer.json'),template_mode=True)
  self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.output=None;self.saved=None;self.permission=True;self.finish_crash=False
  original=subprocess.run
  def run(command,*a,**kw):
   if type(command)is list and command[0]=='/usr/local/bin/node':command=[os.environ.get('ALISA_TEST_NODE')or shutil.which('node')or'/root/alisa-owner-toolchain/node-v24.22.1-linux-x64/bin/node',*command[1:]]
   return original(command,*a,**kw)
  self.node=patch('subprocess.run',run);self.node.start()
  q='Сколько заказано на Озоне за ноябрь?';reply=self.engine.safe_submit('A',q,'r13-source',fingerprint(q),date(2026,12,6),conversation_id='r13-document-source-tests',message_id=1)
  self.assertIn('job_id',reply,reply);self.jid=reply['job_id'];self.worker.step();row=self.repo.get('A',self.jid);self.root=strict_json(row['plan']);self.desc=leaf.descriptor(self.root,'oz1',11,2026)
 def tearDown(self):self.node.stop();self.tmp.cleanup()
 def once(self):
  now=self.repo.get('A',self.jid);self.clock.advance(max(2,now['due']-self.clock()+1));row=self.repo.claim();self.assertIsNotNone(row);progress=strict_json(row['progress'])if row['progress']else{}
  def save(packed):
   progress['_realization']=packed;self.saved=packed;self.repo.reschedule(row['id'],row['owner'],progress)
  def complete(out,packed):
   if self.finish_crash:raise SystemExit('SYNTHETIC_CRASH_BEFORE_PARENT_COMPLETE')
   self.output=out;self.saved=packed;self.repo.complete_answer(row['id'],row['owner'],{'complete':True,'data':{'documents':out.checkpoint()},'pages':['Verified source; not full economics.']})
  try:leaf.step(self.worker,row,self.root,self.desc,progress.get('_realization'),authorize=lambda:self.permission,save_progress=save,on_complete=complete)
  except Deferred as error:self.repo.reschedule(row['id'],row['owner'],until=error.until)
 def finish(self):
  for _ in range(8):
   if self.output is not None:return self.output
   self.once()
  self.fail('did not finish source workflow')
 def count(self):return len([c for c in self.transport.calls if c.store_id])
 def test_two_existing_reads_use_one_job_and_ledger(self):
  out=self.finish();self.assertEqual(out.posting.data['row_count'],1);self.assertEqual(self.count(),2)
  with self.repo.connection()as c:
   self.assertEqual(c.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
   rows=c.execute("SELECT state,http FROM calls WHERE source NOT LIKE 'model:%'").fetchall();self.assertEqual([tuple(x)for x in rows],[('RECEIVED',200),('RECEIVED',200)])
 def test_no_model_per_document(self):
  before=len([c for c in self.transport.calls if c.source.startswith('model:')]);self.finish();self.assertEqual(len([c for c in self.transport.calls if c.source.startswith('model:')]),before)
 def test_exact_registered_params_not_report_order_date(self):
  self.finish();self.assertTrue(all(c.body=={'params':{'month':11,'year':2026}}for c in self.transport.calls if c.store_id))
 def test_raw_source_encrypted_and_cleared_after_completion(self):
  self.once();row=self.repo.get('A',self.jid);self.assertIn('cipher',row['progress']);self.assertNotIn('synthetic-redacted-header',row['progress']);self.assertNotIn('Synthetic item',row['progress']);self.finish();self.assertIsNone(self.repo.get('A',self.jid)['progress'])
 def test_restart_after_first_receipt_does_not_repeat_first_call(self):
  self.once();self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(self.count(),2)
 def test_restart_after_both_receipts_only_rebuilds_pair(self):
  self.once();self.once();self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(self.count(),2)
 def test_parent_crash_after_source_complete_does_not_refetch(self):
  self.once();self.once();self.finish_crash=True
  with self.assertRaises(SystemExit):self.once()
  self.finish_crash=False;self.clock.advance(125);self.worker=Worker(self.engine,self.transport);self.finish();self.assertEqual(self.count(),2)
 def test_429_uses_existing_retry_policy(self):
  self.transport.failure=CallError('HTTP_429',status=429,retry_at=0);self.finish();self.assertEqual(self.count(),3)
 def test_unknown_read_uses_existing_repeat_safe_policy_not_fake_success(self):
  self.transport.failure=CallError('NETWORK_OUTCOME_UNKNOWN',unknown=True)
  self.once();self.assertEqual(self.count(),1);self.assertIsNone(self.saved);self.assertIsNone(self.output)
  row=self.repo.get('A',self.jid);self.assertGreater(row['due'],self.clock())
  self.finish();self.assertEqual(self.count(),3)
  with self.repo.connection()as c:
   self.assertEqual(c.execute("SELECT COUNT(*)FROM calls WHERE source NOT LIKE 'model:%'AND state='RECEIVED'").fetchone()[0],2)
 def test_permission_revoked_before_second_source_blocks_send(self):
  self.once();self.permission=False
  with self.assertRaises(Rejected)as error:self.once()
  self.assertEqual(error.exception.code,'REALIZATION_REPORT_REVOKED');self.assertEqual(self.count(),1)
 def test_permission_revoked_inside_response_blocks_checkpoint(self):
  self.transport.revoker=lambda:setattr(self,'permission',False)
  with self.assertRaises(Rejected):self.once()
  self.assertIsNone(self.saved);self.assertIsNone(self.output)
 def test_scope_revision_changed_before_send(self):
  self.once();self.scope=replace(self.scope,revision='revoked')
  with self.assertRaises(Rejected):self.once()
  self.assertEqual(self.count(),1)
 def test_plain_projected_reply_not_exact_source_bytes(self):
  self.transport.plain=True
  with self.assertRaises(Rejected)as error:self.once()
  self.assertEqual(error.exception.code,'REALIZATION_PROTECTED_BODY_REQUIRED')
 def test_incomplete_document_not_saved_or_retried_as_success(self):
  self.transport.bad_bytes=True
  with self.assertRaises(Rejected):self.once()
  self.assertIsNone(self.saved);self.assertEqual(self.count(),1)
 def test_pair_document_mismatch_not_silently_latest(self):
  self.transport.mismatch=True;self.once();self.once()
  with self.assertRaises(Rejected)as error:self.once()
  self.assertEqual(error.exception.code,'REALIZATION_DOCUMENT_MISMATCH');self.assertEqual(self.count(),2)
 def test_receipt_http_tamper_refused_on_restore(self):
  self.once();self.once()
  with self.repo.connection(True)as c:c.execute("UPDATE calls SET http=500 WHERE source NOT LIKE 'model:%'")
  with self.assertRaises(Rejected)as error:self.once()
  self.assertEqual(error.exception.code,'REALIZATION_RECEIPT_REJECTED')
 def test_wrong_receipt_byte_count_not_trusted(self):
  self.transport.shift_body=True
  with self.assertRaises(Rejected)as error:self.once()
  self.assertEqual(error.exception.code,'REALIZATION_RECEIPT_REJECTED')
 def test_receipt_from_other_job_refused(self):
  self.once();self.once()
  with self.repo.connection(True)as c:c.execute("UPDATE calls SET jid='other-job'WHERE source NOT LIKE 'model:%'")
  with self.assertRaises(Rejected):self.once()
 def test_new_descriptor_cannot_open_old_progress(self):
  self.once();self.desc=leaf.descriptor(self.root,'oz1',10,2026)
  with self.assertRaises(Rejected)as error:self.once()
  self.assertEqual(error.exception.code,'REALIZATION_PROGRESS_INTEGRITY')
 def test_bit_flip_of_progress_refused(self):
  self.once();row=self.repo.get('A',self.jid);p=strict_json(row['progress']);x=p['_realization']['cipher'];p['_realization']['cipher']=('A'if x[0]!='A'else'B')+x[1:]
  with self.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=?WHERE id=?',(canonical_json(p),self.jid))
  with self.assertRaises(Rejected):self.once()
 def test_open_month_refused_before_any_request(self):
  self.desc=leaf.descriptor(self.root,'oz1',12,2026)
  with self.assertRaises(Rejected)as error:self.once()
  self.assertEqual(error.exception.code,'REALIZATION_MONTH_NOT_CLOSED');self.assertEqual(self.count(),0)
 def test_foreign_store_cannot_be_described(self):
  with self.assertRaises(Rejected):leaf.descriptor(self.root,'foreign',11,2026)
 def test_restore_after_revoke_does_not_return_old_snapshot(self):
  self.once();self.once();self.permission=False;row=self.repo.get('A',self.jid)
  with self.assertRaises(Rejected):leaf.restore(self.worker,row,self.root,self.desc,self.saved,authorize=lambda:self.permission)
 def test_restore_can_rebind_calculation_without_new_calls(self):
  self.once();self.once();row=self.repo.get('A',self.jid);a=leaf.restore(self.worker,row,self.root,self.desc,self.saved,authorize=lambda:True);b=leaf.restore(self.worker,row,self.root,self.desc,self.saved,authorize=lambda:True)
  self.assertEqual(a.checkpoint(),b.checkpoint());self.assertEqual(self.count(),2)
 def test_same_worker_source_into_existing_financial_calculator(self):
  pair=self.finish();row=self.repo.get('A',self.jid);order=fixtures.order(posting=_token(self.repo,row,'posting','p1'))
  target=self.desc['scope'];bundle=fixtures.bundle(rows=[order],target=target)
  # Other source packets are explicitly synthetic attestations, not inferred
  # complete by the document source. No owner numbers are read from production.
  known={n:eco.c.CANON(v)for n,v in bundle.items()};qualified=eco.qualify(bundle,target,fixtures.PERIOD,verify=lambda n,v,t,p:known[n]==eco.c.CANON(v),realization=pair)
  self.assertEqual(qualified.rows[0]['inputs']['commission_original'],'150')
  key=eco.c.CANON(eco.key(order));out=eco.calculate(qualified,{key:'250'},{key:{'loss_rate':'0.2','delivery_mean':'100'}},fixtures.unknown())
  self.assertEqual(out['scenarios']['with_loss']['totals']['commission'],'120');self.assertEqual(out['scenarios']['without_loss']['totals']['commission'],'150');self.assertEqual(out['scenarios']['with_loss']['totals']['acquiring'],'34.8')
  self.assertEqual(self.count(),2);self.assertIsNone(out['scenarios']['with_loss']['after_declared_owner_inputs'])
 def test_descriptor_without_current_parent_permission_is_not_authority(self):
  row=self.repo.get('A',self.jid)
  with self.assertRaises(Rejected)as error:leaf.restore(self.worker,row,self.root,self.desc,{},authorize=None)
  self.assertEqual(error.exception.code,'REALIZATION_REPORT_AUTHORITY_REQUIRED')
