"""Owner requirement: no numeric usage cap; preserve real access/backoff/safety."""
from pathlib import Path
from dataclasses import asdict,replace
from datetime import date
from copy import deepcopy
from unittest.mock import patch
import importlib.util,json,tempfile,unittest
from test_runtime import Clock,SCOPE,TODAY
from test_read_surface import Universal as OriginalFixture
from engine import Engine,Worker,validate_model_budget,CallError
from repository import Repository,Deferred
from providers import Request
from semantics import Rejected,canonical_json,fingerprint
from universal_reads import ReadSurface,planner_context,result,worker_step,pin_read_source,SYSTEM
from quota_transition import migrate_waiting
import read_surface as rs

POLICY={'enabled':True,'pin':rs.PIN,'max_model_steps':None,'max_provider_calls':None}
class NoArtificialLimits(unittest.TestCase):
 setUp=OriginalFixture.setUp
 tearDown=OriginalFixture.tearDown
 ask=OriginalFixture.ask
 finish=OriginalFixture.finish
 direct=OriginalFixture.direct
 def test_live_model_policy_is_null_not_100(self):
  self.assertEqual(self.engine.model_budget,{'schema':'alice-model-budget/v2','daily_calls':None,'min_interval_seconds':0})
 def test_cannot_silently_reintroduce_numeric_model_allowance(self):
  for n in (20,100,1000000000):
   with self.assertRaises(Rejected):validate_model_budget({'schema':'alice-model-budget/v2','daily_calls':n,'min_interval_seconds':0})
 def test_generic_source_has_no_day_or_invented_interval_quota(self):
  _,interval,daily=rs.quota('ozon','ozon_actions_list');self.assertEqual(interval,0);self.assertIsNone(daily)
 def test_known_source_pacing_preserved_without_daily_cap(self):
  from http_transport import MATRICES
  matches=[]
  for alias,row in rs.CATALOG['providers']['ozon']['operations'].items():
   same=[m.recipe(k)for k,m in MATRICES.items()if m.recipe(k)['url']==row['wire_url']and m.recipe(k)['method']==row['method']]
   if same:
    _,interval,daily=rs.quota('ozon',alias);self.assertEqual(interval,max(s['interval']for s in same));self.assertIsNone(daily);matches.append(alias)
  self.assertTrue(matches)
 def test_101_model_calls_same_day_no_reset(self):
  a=self.ask();row=self.repo.claim();before=self.repo.call_count()
  for _ in range(101):
   event=self.repo.reserve(row['id'],row['owner'],'model:deepseek-flash',0,None);self.repo.received(event,{'status':200})
  self.assertEqual(self.repo.call_count(),before+101)
 def test_worker_ignores_old_daily_request_allowance(self):
  a=self.ask();row=self.repo.claim();calls=[]
  class Fake:
   def execute(self,*a):calls.append(1);return {},{'status':200}
  worker=Worker(self.engine,Fake());request=Request('deepseek_read_plan','model:deepseek-flash','',{},0,1)
  for _ in range(25):worker._call(row,request)
  self.assertEqual(len(calls),25);self.assertEqual(self.repo.call_count(),25)
 def test_provider_retry_after_still_blocks(self):
  a=self.ask();row=self.repo.claim();self.repo.defer_source('source:provider',self.clock()+30)
  with self.assertRaises(Deferred):self.repo.reserve(row['id'],row['owner'],'source:provider',0,None)
  self.assertEqual(self.repo.call_count(),0)
 def test_no_budget_instruction_in_prompt(self):
  self.assertNotIn('Максимум12',SYSTEM);self.assertNotIn('и20 чтений',SYSTEM)
 def test_general_plan_accepts_null_step_limits(self):self.assertEqual(self.reads.settings()['max_model_steps'],None)
 def test_remaining_read_count_not_sent_to_model(self):
  p=self.reads.plan(self.scope,'акции',date(2026,11,8),self.clock());context=planner_context(p,{'calls':[]})
  self.assertNotIn('remaining_reads',context);self.assertIsNone(context['application_call_limit'])
 def test_step_13_can_finish(self):
  a=self.ask();call={'operation':'ozon_actions_list','store_id':'oz1','params':{},'data':{'result':[{'title':'Тест','participating_products_count':3}]}}
  progress={'calls':[call],'steps':12,'pending':None,'discovery':None,'feedback':None}
  with self.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=?WHERE id=?',(canonical_json(progress),a['job_id']))
  self.decisions=self.decisions[-1:];self.clock.advance(2);self.worker.step();r=self.repo.get('A',a['job_id']);self.assertEqual(r['state'],'READY',r['error'])
 def test_provider_read_21_is_not_blocked(self):
  a=self.ask();calls=[{'operation':'some_read','store_id':'oz1','params':{'offset':i},'data':{'x':i}}for i in range(20)]
  progress={'calls':calls,'steps':30,'pending':{'store_id':'oz1','operation':'ozon_actions_list','params':{}},'discovery':None,'feedback':None}
  with self.repo.connection(True)as c:c.execute('UPDATE jobs SET progress=?WHERE id=?',(canonical_json(progress),a['job_id']))
  for _ in range(2):self.clock.advance(2);self.worker.step()
  r=self.repo.get('A',a['job_id']);self.assertEqual(r['state'],'QUEUED',r['error']);self.assertEqual(len(json.loads(r['progress'])['calls']),21);self.assertEqual(self.physical,['read.ozon.ozon_actions_list'])
 def test_result_accepts_more_than_20_sources(self):
  plan=self.reads.plan(self.scope,'акции',date(2026,11,8),self.clock());calls=[{'store_id':'oz1','operation':'read','data':{'n':n}}for n in range(21)]
  data={'calls':calls,'decision':{'action':'finish','facts':[{'label':'Последнее значение','expr':{'$path':['calls',20,'data','n']}}],'coverage':'selected'}}
  self.assertTrue(result(plan,data,'2026-11-08 10:00 UTC')['complete'])
 def test_more_than_40_source_refs_keep_auth(self):
  a=self.ask();row=self.repo.claim()
  for n in range(41):self.repo.pin_source_reference(row['id'],row['owner'],{'store_id':'oz1','source':'ozon:cabinet-oz-1:read'+str(n),'revision':'access1'})
  plan=json.loads(self.repo.get('A',a['job_id'])['plan']);self.assertEqual(len(plan['read_source_refs']),41);self.assertTrue(self.engine.authorized(plan))
 def test_source_denial_after_40_refs_still_blocks(self):
  a=self.ask();row=self.repo.claim()
  for n in range(41):self.repo.pin_source_reference(row['id'],row['owner'],{'store_id':'oz1','source':'ozon:cabinet-oz-1:read'+str(n),'revision':'access1'})
  plan=json.loads(self.repo.get('A',a['job_id'])['plan']);self.repo.deny('ozon:cabinet-oz-1:read40','access1');self.assertFalse(self.engine.authorized(plan))
 def test_more_than_20_queued_requests(self):
  for n in range(25):
   a=self.engine.submit_method('A','oz1','seller_actions_list',{'limit':1,'offset':n},'many-'+str(n),TODAY,'no-quota-session');self.assertEqual(a['state'],'QUEUED')
  with self.repo.connection()as c:self.assertEqual(c.execute("SELECT count(*)FROM jobs WHERE state='QUEUED'").fetchone()[0],25)
 def test_no_numeric_row_admission_quotas(self):
  import retention
  for name in ['MAX_RECEIPTS','MAX_TENANT_RECEIPTS','MAX_JOBS','MAX_UNKNOWN']:self.assertFalse(hasattr(retention,name))
 def test_storage_byte_protection_still_present(self):
  import retention
  with patch.object(retention,'MAX_USED_BYTES',0):self.assertEqual(self.ask()['error'],'STORAGE_CAPACITY')
 def test_identical_no_progress_loop_stops_by_state_not_count(self):
  a=self.ask();decision={'action':'discover','platform':'ozon','cluster':'prices_promotions','query':'nothing-synthetic','offset':0};self.decisions=[deepcopy(decision)for _ in range(8)]
  r=self.finish(a);self.assertEqual(r['state'],'FAILED');self.assertEqual(r['error'],'READ_NO_PROGRESS');self.assertLess(len(self.physical),8)
 def seed_old_wait(self):
  a=self.ask();old=deepcopy(self.policy);old.update(pin='old-authorized-pin',max_model_steps=12,max_provider_calls=20)
  r=self.repo.get('A',a['job_id']);p=json.loads(r['plan']);p['universal_read']={'pin':old['pin'],'policy_hash':fingerprint(old)};due=self.clock()+86400
  with self.repo.connection(True)as c:
   c.execute('UPDATE jobs SET plan=?,due=?WHERE id=?',(canonical_json(p),due,r['id']))
   for _ in range(20):c.execute("INSERT INTO calls(jid,source,at,state,http)VALUES(?,'model:deepseek-flash',?,'RECEIVED',200)",(r['id'],self.clock()))
  return a,old,p
 def test_existing_quota_wait_released_without_erasing_ledger(self):
  a,old,plan=self.seed_old_wait();before=self.repo.call_count();receipt=migrate_waiting(self.repo,lambda _:self.scope,old,self.policy,20,self.clock());r=self.repo.get('A',a['job_id']);self.assertEqual(r['due'],self.clock());self.assertEqual(self.repo.call_count(),before);self.assertTrue(receipt['changed'][0]['daily_wait_removed']);p=json.loads(r['plan']);p.pop('universal_read');plan.pop('universal_read');self.assertEqual(p,plan)
 def test_wait_upgrade_preserves_real_provider_backoff(self):
  a,old,p=self.seed_old_wait();self.repo.defer_source('model:deepseek-flash',self.clock()+90);migrate_waiting(self.repo,lambda _:self.scope,old,self.policy,20,self.clock());self.assertEqual(self.repo.get('A',a['job_id'])['due'],self.clock()+90)
 def test_wait_upgrade_does_not_resume_cancelled_job(self):
  a,old,p=self.seed_old_wait()
  with self.repo.connection(True)as c:c.execute("UPDATE jobs SET state='CANCELLED'WHERE id=?",(a['job_id'],))
  r=migrate_waiting(self.repo,lambda _:self.scope,old,self.policy,20,self.clock());self.assertEqual(r['changed'],[]);self.assertEqual(self.repo.get('A',a['job_id'])['state'],'CANCELLED')
 def test_wait_upgrade_denies_changed_rights(self):
  a,old,p=self.seed_old_wait();self.scope=replace(self.scope,revision='revoked');r=migrate_waiting(self.repo,lambda _:self.scope,old,self.policy,20,self.clock());self.assertEqual(r['changed'],[]);self.assertEqual(len(r['skipped']),1)
 def test_wait_upgrade_idempotent(self):
  a,old,p=self.seed_old_wait();migrate_waiting(self.repo,lambda _:self.scope,old,self.policy,20,self.clock());r=migrate_waiting(self.repo,lambda _:self.scope,old,self.policy,20,self.clock());self.assertEqual(r['changed'],[])
 def test_wait_upgrade_rejects_inflight_work(self):
  a,old,p=self.seed_old_wait()
  with self.repo.connection(True)as c:c.execute('UPDATE jobs SET due=?WHERE id=?',(self.clock(),a['job_id']))
  self.repo.claim()
  with self.assertRaises(Rejected):migrate_waiting(self.repo,lambda _:self.scope,old,self.policy,20,self.clock())

# Reusing fixture methods above must not duplicate the original test class.
del OriginalFixture
if __name__=='__main__':
 r=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(NoArtificialLimits));print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'external_calls':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
