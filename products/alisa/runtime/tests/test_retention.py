import json,os,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from test_runtime import Clock,TODAY,SCOPE,FakeTransport
from repository import Repository,Deferred
from engine import Engine,Worker
from semantics import Rejected,fingerprint
import retention,artifact_retention,lab_retention

class RetentionTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'state.sqlite3';self.clock=Clock()
  self.repo=Repository(self.path,self.clock);self.engine=Engine(self.repo,lambda _:SCOPE);self.transport=FakeTransport();self.worker=Worker(self.engine,self.transport);self.i=0
 def tearDown(self):self.temp.cleanup()
 def ask(self,q,seq=None,conv='retention-session'):
  self.i+=1;seq=self.i if seq is None else seq
  return self.engine.safe_submit('A',q,conv+str(seq),fingerprint(q),TODAY,conversation_id=conv,message_id=seq)
 def row(self,sql,args=()):
  with self.repo.connection() as c:return c.execute(sql,args).fetchone()
 def runsql(self,sql,args=()):
  with self.repo.connection(True) as c:c.execute(sql,args)
 def pending(self):
  r=self.row('SELECT pending FROM dialogue_context WHERE conversation=?',('retention-session',));return json.loads(r[0]) if r and r[0] else None
 def ready(self):
  r=self.ask('сводка заказов за вчера на озоне');self.worker.step();self.assertEqual(self.repo.get('A',r['job_id'])['state'],'READY');return r['job_id']
 def clean(self):return retention.sweep(self.repo)
 def test_schema_is_repeatable(self):
  retention.install(self.repo);Repository(self.path,self.clock);self.assertTrue(self.row("SELECT name FROM sqlite_master WHERE name='inbox_age'"))
 def test_pending_not_deleted_early(self):
  self.ask('продажи за вчера');p=self.pending();self.clock.advance(899);self.clean();self.assertEqual(p,self.pending())
 def test_absolute_expiry_no_new_message(self):
  self.ask('продажи за вчера');self.clock.advance(850);self.ask('помощь');self.clock.advance(51);self.assertEqual(self.clean()['expired_pending'],1);self.assertIsNone(self.pending())
 def test_completed_context_removed(self):
  self.ask('продажи за вчера');self.ask('заказанные');self.assertIsNone(self.pending())
 def test_cancelled_context_removed(self):
  self.ask('продажи за вчера');self.ask('отмена');self.assertIsNone(self.pending())
 def test_pending_period_survives_maintenance(self):
  self.ask('продажи за вчера');self.clean();a=self.ask('заказанные');p=json.loads(self.repo.get('A',a['job_id'])['plan']);self.assertEqual(p['period']['from'],'2026-11-02')
 def test_context_expires_not_revives(self):
  self.ask('продажи за вчера');self.clock.advance(901);self.clean();self.assertEqual(self.ask('заказанные')['error'],'CLARIFICATION_MISSING')
 def test_no_renewal_from_result(self):
  self.ask('продажи за вчера');self.clock.advance(800);self.ask('результат');self.clock.advance(101);self.clean();self.assertIsNone(self.pending())
 def test_ready_payload_and_all_copies_removed(self):
  jid=self.ready();self.ask('результат');self.clock.advance(901);self.clean();r=self.repo.get('A',jid)
  self.assertEqual(r['state'],'EXPIRED');self.assertEqual(r['draft'],'{}')
  for key in ('plan','result','progress'):self.assertIsNone(r[key])
  for table in ('dialogue_receipts','control_inbox'):
   with self.repo.connection() as c:
    for reply,plan in c.execute('SELECT reply,plan FROM '+table):self.assertEqual(reply,'{}');self.assertIsNone(plan)
 def test_unexpired_report_preserved(self):
  jid=self.ready();before=self.repo.get('A',jid);self.clock.advance(100);self.clean();self.assertEqual(before,self.repo.get('A',jid))
 def test_queued_payload_preserved(self):
  jid=self.ask('сводка заказов за вчера на озоне')['job_id'];self.clock.advance(90001);self.clean();r=self.repo.get('A',jid);self.assertEqual(r['state'],'QUEUED');self.assertTrue(r['plan'])
 def test_running_payload_preserved(self):
  self.ask('сводка заказов за вчера на озоне');r=self.repo.claim();self.clock.advance(901);self.clean();x=self.row('SELECT draft,plan,state FROM jobs WHERE id=?',(r['id'],));self.assertTrue(x[1]);self.assertEqual(x[2],'RUNNING')
 def test_unknown_retains_safety_key_not_content(self):
  a=self.ask('сводка заказов за вчера на озоне');r=self.repo.claim();self.repo.fail(r['id'],r['owner'],'UNKNOWN_TEST',unknown=True);key=self.repo.get('A',a['job_id'])['key'];self.clock.advance(901);self.clean()
  x=self.repo.get('A',a['job_id']);self.assertEqual(x['state'],'UNKNOWN');self.assertEqual(x['key'],key);self.assertIsNone(x['plan']);self.assertEqual(x['draft'],'{}')
  r=self.ask('сводка заказов за вчера на озоне');self.assertEqual(r['job_id'],a['job_id']);self.assertEqual(r['state'],'UNKNOWN');self.assertEqual(self.repo.call_count(),0)
 def test_unknown_survives_day_without_payload(self):
  self.ask('сводка заказов за вчера на озоне');r=self.repo.claim();self.repo.fail(r['id'],r['owner'],'X',True);self.clock.advance(100000);self.clean();self.assertEqual(self.repo.get('A',r['id'])['state'],'UNKNOWN')
 def test_closed_jobs_and_orphans_deleted(self):
  jid=self.ready();self.clock.advance(100000);self.clean();self.assertIsNone(self.row('SELECT id FROM jobs WHERE id=?',(jid,)))
  for table in ('slots','pointers','inbox','inbox_age','dialogue_receipts','control_inbox'):self.assertEqual(self.row('SELECT count(*) FROM '+table)[0],0)
 def test_alias_recent_reference_preserved(self):
  jid=self.ready();self.clock.advance(100000)
  self.runsql("INSERT INTO jobs(id,tenant,key,state,draft,plan,created,updated,due,alias) VALUES('alias','A','alias-key','ALIASED','{}',NULL,?,?,?,?)",(self.clock(),self.clock(),self.clock(),jid))
  self.clean();self.assertIsNotNone(self.row('SELECT id FROM jobs WHERE id=?',(jid,)))
  self.clock.advance(100000)
  for _ in range(3):self.clean()
  self.assertIsNone(self.row('SELECT id FROM jobs WHERE id=?',(jid,)))
 def test_recent_ingress_to_old_job_retains_dedup(self):
  jid=self.ready();self.clock.advance(80000);self.runsql("INSERT INTO inbox VALUES('A','later',?,?)",('0'*64,jid));self.runsql("INSERT INTO inbox_age VALUES('A','later',?)",(self.clock(),));self.clock.advance(10000);self.clean();self.assertIsNotNone(self.row('SELECT id FROM jobs WHERE id=?',(jid,)))
 def test_migration_age_is_conservative(self):
  self.ready();self.runsql('DELETE FROM inbox_age');self.clock.advance(100000);self.clean();self.assertEqual(self.row('SELECT created FROM inbox_age')[0],self.clock());self.assertEqual(self.row('SELECT count(*) FROM inbox')[0],1)
 def test_recent_quota_and_revocation_untouched(self):
  jid=self.ready();self.repo.deny('synthetic','v1');self.clock.advance(86401);self.clean();self.assertEqual(self.repo.call_count(),1);self.assertTrue(self.repo.denied('synthetic','v1'))
 def test_ledger_expires_after_margin(self):
  self.ready();self.clock.advance(90001);self.clean();self.assertEqual(self.repo.call_count(),0)
 def test_inflight_ledger_not_purged(self):
  self.ask('сводка заказов за вчера на озоне');r=self.repo.claim();self.repo.reserve(r['id'],r['owner'],'unit-source',1,10);self.clock.advance(100000);self.clean();self.assertEqual(self.repo.call_count(),1)
 def test_unknown_ledger_keeps_rolling_budget(self):
  self.ask('сводка заказов за вчера на озоне');r=self.repo.claim();i=self.repo.reserve(r['id'],r['owner'],'unit-source',1,1);self.repo.failed_call(i,unknown=True);self.repo.reschedule(r['id'],r['owner']);self.clock.advance(901);self.clean();r=self.repo.claim()
  with self.assertRaises(Deferred):self.repo.reserve(r['id'],r['owner'],'unit-source',1,1)
 def test_old_result_control_replay_blocked(self):
  self.ready();self.ask('результат',99);self.clock.advance(901);self.clean();self.assertEqual(self.ask('результат',99)['error'],'RESULT_EXPIRED')
 def test_same_context_replay_does_not_refresh_expiry(self):
  self.ask('продажи за вчера',0);expires=self.pending()['expires_at'];self.clock.advance(500);self.ask('продажи за вчера',0);self.assertEqual(self.pending()['expires_at'],expires)
 def test_no_provider_from_maintenance(self):
  self.ask('продажи за вчера');self.clock.advance(100000);self.clean();self.assertEqual(self.repo.call_count(),0);self.assertEqual(self.transport.calls,[])
 def test_bounded_batch(self):
  for i in range(9):self.ask('продажи за вчера',0,'conversation'+str(i))
  self.clock.advance(901);counts=retention.sweep(self.repo,2);self.assertEqual(counts['expired_pending'],2);self.assertLessEqual(max(counts.values()),2)
 def test_no_unbounded_replay_history(self):
  for i in range(10):self.ask('помощь',i)
  self.clock.advance(100000);self.clean();self.assertEqual(self.row('SELECT count(*) FROM dialogue_receipts')[0],0)
 def test_capacity_refuses_without_erasing_pending(self):
  self.ask('продажи за вчера');p=self.pending()
  with patch.object(retention,'MAX_USED_BYTES',0):self.assertEqual(self.ask('помощь')['error'],'STORAGE_CAPACITY')
  self.assertEqual(p,self.pending())
 def test_receipt_capacity_refuses_before_side_effect(self):
  with patch.object(retention,'MAX_TENANT_RECEIPTS',0):self.assertEqual(self.ask('сводка заказов за вчера')['error'],'STORAGE_CAPACITY')
  self.assertIsNone(self.repo.get('A'))
 def test_unknown_capacity_refuses_new_job(self):
  with patch.object(retention,'MAX_UNKNOWN',0):self.assertEqual(self.ask('сводка заказов за вчера')['error'],'STORAGE_CAPACITY')
  self.assertIsNone(self.repo.get('A'))
 def test_replay_works_at_capacity(self):
  q='продажи за вчера';a=self.ask(q,0)
  with patch.object(retention,'MAX_USED_BYTES',0):self.assertEqual(self.ask(q,0),a)
 def test_invalid_batch(self):
  for n in (0,True,1001):
   with self.assertRaises(ValueError):retention.sweep(self.repo,n)
 def test_incremental_compaction(self):
  with sqlite3.connect(self.path) as c:
   c.execute('PRAGMA auto_vacuum=INCREMENTAL');c.execute('VACUUM');c.execute('CREATE TABLE filler(x BLOB)');c.execute('INSERT INTO filler VALUES(zeroblob(2000000))');c.commit();c.execute('DROP TABLE filler');c.commit()
   # Compare main-file sizes only after publishing the fixture WAL. SQLite
   # versions differ in automatic checkpoint timing; pending WAL is not compacted data.
   self.assertEqual(c.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()[0],0)
  before=self.path.stat().st_size
  r=retention.maintain(self.path);self.assertEqual(r['database']['auto_vacuum'],2);self.assertLess(self.path.stat().st_size,before)
 def test_existing_mode_zero_does_not_run_full_vacuum(self):
  self.assertEqual(retention.maintain(self.path)['database']['auto_vacuum'],0)
 def test_atomic_cleanup_failure_rolls_back(self):
  self.ask('продажи за вчера');self.clock.advance(901);p=self.pending()
  with self.repo.connection(True) as c:c.execute('DROP TABLE control_inbox')
  with self.assertRaises(sqlite3.OperationalError):self.clean()
  self.assertEqual(self.pending(),p)
 def test_file_not_created_by_maintenance(self):
  missing=Path(self.temp.name)/'missing.db'
  with self.assertRaises(sqlite3.OperationalError):retention.maintain(missing)
  self.assertFalse(missing.exists())

class EventMeaningTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.repo=Repository(Path(self.temp.name)/'db');self.e=Engine(self.repo,lambda _:SCOPE)
 def tearDown(self):self.temp.cleanup()
 def ask(self,q,n):return self.e.safe_submit('A',q,str(n),fingerprint(q),TODAY,conversation_id='event-test-session',message_id=n)
 def seed(self):self.ask('Дай продажи за вчера',0);self.ask('выкупы',1)
 def test_exact_owner_phrase_event_not_cohort(self):
  self.seed();r=self.ask('Все что выкупили вчера блядь!!!',2);self.assertEqual(r['error'],'EVENT_BUYOUTS_NOT_ENABLED');self.assertIn('2026-11-02',r['text']);self.assertIn('уточнение принято',r['text']);self.assertEqual(self.repo.call_count(),0)
 def test_result_after_event_not_wrong_report(self):
  self.seed();self.ask('все что выкупили вчера',2);self.assertEqual(self.ask('результат',3)['error'],'EVENT_BUYOUTS_NOT_ENABLED')
 def test_explicit_switch_after_event(self):
  self.seed();self.ask('все что выкупили вчера',2);r=self.ask('заказанные',3);self.assertEqual(r['state'],'QUEUED');p=json.loads(self.repo.get('A',r['job_id'])['plan']);self.assertEqual(p['metrics'],['ordered_revenue','ordered_units'])
 def test_event_with_no_pending(self):
  r=self.ask('все что выкупили вчера',0);self.assertEqual(r['error'],'EVENT_BUYOUTS_NOT_ENABLED');self.assertIn('2026-11-02',r['text'])
 def test_explicit_cohort_remains_valid(self):
  r=self.ask('сводка выкупов по заказам за вчера на wb',0);self.assertEqual(r['state'],'QUEUED')
 def test_actual_event_not_sent_as_finance(self):
  self.seed();self.ask('по дате события',2);self.assertIsNone(self.repo.get('A'))

class ArtifactTests(unittest.TestCase):
 def setUp(self):self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)/'evidence';self.root.mkdir();self.now=200000
 def tearDown(self):self.temp.cleanup()
 def file(self,name,age=100000,size=10):
  p=self.root/name;p.parent.mkdir(exist_ok=True,parents=True);p.write_bytes(b'x'*size);os.utime(p,(self.now-age,self.now-age));return p
 def test_only_data_allowlist(self):
  old=self.file('folder/state-before.sqlite3');probe=self.file('ozon_snapshot.json');source=self.file('source-snapshot.zip');doc=self.file('report.md');key=self.file('credentials.json')
  r=artifact_retention.prune([self.root],self.now);self.assertEqual(r['deleted_files'],2);self.assertFalse(old.exists());self.assertFalse(probe.exists());self.assertTrue(all(x.exists() for x in (source,doc,key)))
 def test_new_rollback_preserved_under_pressure(self):
  p=self.file('state-before.sqlite3',age=30,size=100);r=artifact_retention.prune([self.root],self.now,max_bytes=10);self.assertTrue(p.exists());self.assertTrue(r['over_budget'])
 def test_capacity_evicts_oldest_eligible(self):
  a=self.file('wb_a.json',age=5000);b=self.file('wb_b.json',age=4000);r=artifact_retention.prune([self.root],self.now,max_bytes=10);self.assertFalse(a.exists());self.assertTrue(b.exists())
 def test_symlink_file_not_followed(self):
  p=self.file('outside.txt');q=self.root/'wb_link.json';q.symlink_to(p);artifact_retention.prune([self.root],self.now);self.assertTrue(p.exists());self.assertTrue(q.is_symlink())
 def test_symlink_directory_not_followed(self):
  other=Path(self.temp.name)/'other';other.mkdir();p=other/'wb_data.json';p.write_text('private');os.utime(p,(0,0));(self.root/'link').symlink_to(other,target_is_directory=True);artifact_retention.prune([self.root],self.now);self.assertTrue(p.exists())
 def test_hardlink_not_removed(self):
  p=self.file('wb_private.json');q=self.root/'second';os.link(p,q);artifact_retention.prune([self.root],self.now);self.assertTrue(p.exists())
 def test_probe_root_age(self):
  probe=Path(self.temp.name)/'probe-reports';probe.mkdir();p=probe/'old.json';p.write_text('{}');os.utime(p,(0,0));artifact_retention.prune([probe],self.now);self.assertFalse(p.exists())
 def test_bounded_file_deletes(self):
  for i in range(7):self.file('wb_'+str(i)+'.json')
  with patch.object(artifact_retention,'MAX_REMOVALS',2):self.assertEqual(artifact_retention.prune([self.root],self.now)['deleted_files'],2)

class LabRetentionTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.path=Path(self.temp.name)/'lab.sqlite';self.clock=Clock()
  with sqlite3.connect(self.path) as c:
   c.executescript('''CREATE TABLE tokens(hash TEXT PRIMARY KEY,account TEXT,kind TEXT,expires REAL,revoked INT);CREATE TABLE forms(nonce TEXT,params TEXT,expires REAL);CREATE TABLE codes(hash TEXT,account TEXT,expires REAL,used INT);CREATE TABLE replies(k TEXT PRIMARY KEY,request_hash TEXT,response TEXT,created REAL);CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,created REAL);CREATE TABLE llm_jobs(id TEXT PRIMARY KEY,question TEXT,result TEXT,status TEXT,created REAL,finished REAL);CREATE TABLE llm_daily(date TEXT PRIMARY KEY,attempts INT,reserved_usd REAL,spent_usd REAL);''')
  self.repo=retention.MaintenanceRepository(self.path,self.clock)
 def tearDown(self):self.temp.cleanup()
 def sql(self,q,args=()):
  with self.repo.connection(True) as c:return c.execute(q,args).fetchall()
 def test_tokens_only_expired(self):
  for name,expiry in [('expired',self.clock()-1),('live',self.clock()+100),('refresh',self.clock()+10000)]:self.sql('INSERT INTO tokens VALUES(?,?,?,?,0)',(name,'A',name,expiry))
  lab_retention.sweep(self.repo);self.assertEqual({r[0] for r in self.sql('SELECT hash FROM tokens')},{'live','refresh'})
 def test_stale_forms_codes_only(self):
  self.sql("INSERT INTO forms VALUES('n','{}',?)",(self.clock()-1,));self.sql("INSERT INTO codes VALUES('n','A',?,0)",(self.clock()+1,));lab_retention.sweep(self.repo);self.assertEqual(self.sql('SELECT count(*) FROM forms')[0][0],0);self.assertEqual(self.sql('SELECT count(*) FROM codes')[0][0],1)
 def test_stale_reply_redacted_not_reexecuted(self):
  self.sql("INSERT INTO replies VALUES('r','h','private',?)",(self.clock()-1000,));lab_retention.sweep(self.repo);r=self.sql('SELECT k,request_hash,response FROM replies')[0];self.assertEqual(r[:2],('r','h'));self.assertNotIn('private',r[2]);self.assertIn('истёк',r[2])
 def test_day_old_reply_deleted(self):
  self.sql("INSERT INTO replies VALUES('r','h','private',?)",(self.clock()-100000,));lab_retention.sweep(self.repo);self.assertFalse(self.sql('SELECT * FROM replies'))
 def test_active_models_not_changed(self):
  for state in ('running','queued'):self.sql('INSERT INTO llm_jobs VALUES(?,?,?,?,?,NULL)',(state,'private',None,state,self.clock()-100000))
  lab_retention.sweep(self.repo);self.assertEqual(len(self.sql("SELECT id FROM llm_jobs WHERE question='private'")),2)
 def test_terminal_model_no_question_or_result(self):
  self.sql("INSERT INTO llm_jobs VALUES('a','private','data','ready',?,?)",(self.clock()-2000,self.clock()-1000));lab_retention.sweep(self.repo);self.assertEqual(self.sql('SELECT question,result,status FROM llm_jobs')[0],('',None,'expired'))
 def test_unknown_not_requeued_or_forgotten(self):
  self.sql("INSERT INTO llm_jobs VALUES('a','private',NULL,'unknown',?,NULL)",(self.clock()-100000,));lab_retention.sweep(self.repo);self.assertEqual(self.sql('SELECT question,status FROM llm_jobs')[0],('','unknown'))
 def test_budget_counters_today_preserved(self):
  for d in ('2026-10-01','2026-11-02','2026-11-03'):self.sql('INSERT INTO llm_daily VALUES(?,1,1,1)',(d,))
  lab_retention.sweep(self.repo);self.assertEqual({r[0] for r in self.sql('SELECT date FROM llm_daily')},{'2026-11-02','2026-11-03'})

if __name__=='__main__':unittest.main()
