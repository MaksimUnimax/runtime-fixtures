"""Exercise switch/rollback sequencing in a private filesystem; no service calls."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import tempfile,unittest,json,os,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import activate as a

class Activation(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.p=Path(self.tmp.name);self.root=self.p/'ops';self.root.mkdir()
  self.base=[self.p/('old'+str(i))for i in range(3)];self.new=[self.p/('new'+str(i))for i in range(3)]
  for p in self.base+self.new:p.mkdir()
  self.native=self.p/'native-current';self.native.symlink_to(self.base[1]);self.web=self.p/'web-current';self.web.symlink_to(self.base[2])
  self.selectors=[self.p/('selector'+str(i))for i in range(3)]
  self.source_selectors=[self.p/('source-selector'+str(i))for i in range(3)]
  self.source_bases=[self.base[0],self.base[0],self.p/'old-cleanup-release']
  for p,base in zip(self.source_selectors,self.source_bases):p.write_text('WorkingDirectory='+str(base)+'\n')
  self.flags=[self.p/('flag'+str(i))for i in range(3)]
  self.config=self.p/'config';self.config.write_text('OLD_CONFIG');self.versions=self.p/'versions';self.versions.write_text('OLD_VERSIONS');self.projection=self.p/'projection';self.projection.write_text('OLD_PROJECTION')
  self.before={**{p:p.read_bytes()for p in [self.config,self.versions,self.projection]+self.source_selectors},**{p:None for p in self.flags+self.selectors}};self.events=[];self.failure=None;self.failed=False;self.busy_after_stop=False;self.snapshots=0;self.table_created=False
  def atomic(p,raw,mode=0o600):p.parent.mkdir(exist_ok=True,parents=True);p.write_bytes(raw);p.chmod(mode)
  def pointer(p,target):
   if p.is_symlink():p.unlink()
   p.symlink_to(target)
  def ready(*args):self.events.append('health');self.inject('health')
  def cleanup():self.events.append('cleanup');self.inject('cleanup')
  self.core=SimpleNamespace(atomic=atomic,pointer=pointer,ready=ready,cleanup_probe=cleanup,reserve=lambda:None,OTHERS=['unrelated.service'])
  def sync(target,lock):self.events.append('sync');self.versions.write_text('NEW_VERSIONS'if target==self.new[1]else'OLD_VERSIONS')
  def refresh(old,on_write=None):
   value=b'NEW_PROJECTION'if self.native.resolve()==self.new[1]else b'OLD_REBOUND_PROJECTION'
   self.projection.write_bytes(value)
   if on_write:on_write(value)
   self.events.append('projection');self.inject('projection')
  self.pair=SimpleNamespace(VERSIONS=self.versions,PROJECTION=self.projection,sync=sync,refresh_projection=refresh,projection_data=lambda:{})
  self.patches=[]
  values={'ROOT':self.root,'BASES':self.base,'TARGETS':self.new,'NATIVE_POINTER':self.native,'WEB_POINTER':self.web,'CONFIG':self.config,'SELECTORS':self.selectors,'SOURCE_SELECTORS':self.source_selectors,'SOURCE_RELEASES':self.source_bases,'FLAGS':self.flags}
  for key,value in values.items():q=patch.object(a,key,value);q.start();self.patches.append(q)
  for key,value in [('helpers',lambda:(self.core,self.pair)),('inspect',lambda c,m:({}, {'target':['owner_data','0002_current_parameter_only']},b'NEW_VERSIONS',{},b'NEW_CONFIG')),('run',self.fake_run),('snapshot',self.snapshot),('prop',lambda u,k:'OLD_PID'if k=='MainPID'else'OLD_DIR')]:
   q=patch.object(a,key,value);q.start();self.patches.append(q)
  orig=Path.open
  def opened(p,*args,**kwargs):return orig(self.p/'rollout-lock'if str(p)=='/run/lock/alisa-stage-rollout.lock'else p,*args,**kwargs)
  q=patch.object(Path,'open',opened);q.start();self.patches.append(q)
 def tearDown(self):
  for p in reversed(self.patches):p.stop()
  self.tmp.cleanup()
 def inject(self,name):
  if name==self.failure and not self.failed:self.failed=True;raise RuntimeError('INJECTED_'+name)
 def fake_run(self,*args,**kwargs):
  if args[-1:] == ('--apply',):self.events.append('migrate');self.inject('migration');self.table_created=True;return json.dumps({'status':'MIGRATED'})
  if args[:2]==('systemctl','stop'):self.events.append('stop:'+args[2])
  if args[:2]in [('systemctl','start'),('systemctl','restart')]:
   self.events.append(args[1]+':'+args[2]);self.inject('native_start'if args[2]==a.NATIVE_UNIT else'backend_start')
  return ''
 def snapshot(self):
  self.snapshots+=1
  if self.busy_after_stop and self.snapshots==2:raise RuntimeError('ACTIVE_RUNTIME_JOBS')
  return {}
 def assert_old(self):
  self.assertEqual(self.native.resolve(),self.base[1]);self.assertEqual(self.web.resolve(),self.base[2])
  for p,raw in self.before.items():
   if p!=self.projection:self.assertEqual(p.read_bytes()if p.exists()else None,raw,p.name)
  self.assertTrue(all(not p.exists()for p in self.flags));self.assertTrue((self.root/'ROLLED_BACK.json').exists())
 def test_check_does_not_migrate_restart_or_enable(self):
  a.execute(False);self.assertEqual(self.events,[]);self.assertFalse(self.table_created);self.assertFalse((self.root/'backup').exists())
 def test_success_freezes_before_migration_then_restores_service(self):
  a.execute(True);self.assertTrue(self.table_created);self.assertEqual(self.native.resolve(),self.new[1]);self.assertEqual(self.config.read_bytes(),b'NEW_CONFIG');self.assertTrue((self.root/'ACTIVATED.json').exists())
  self.assertLess(self.events.index('stop:'+a.NATIVE_UNIT),self.events.index('migrate'));self.assertGreater(self.events.index('start:'+a.WEB_UNIT),self.events.index('projection'))
 def test_new_admission_race_resumes_old_without_migration(self):
  self.busy_after_stop=True
  with self.assertRaises(RuntimeError):a.execute(True)
  self.assertFalse(self.table_created);self.assert_old()
 def test_migration_failure_resumes_old_and_leaves_data(self):
  self.failure='migration'
  with self.assertRaises(RuntimeError):a.execute(True)
  self.assertFalse(self.table_created);self.assert_old()
 def test_native_start_failure_rolls_back_without_table_drop(self):
  self.failure='native_start'
  with self.assertRaises(RuntimeError):a.execute(True)
  self.assertTrue(self.table_created);self.assert_old()
 def test_projection_failure_rolls_back_and_rebinds_old_generation(self):
  self.failure='projection'
  with self.assertRaises(RuntimeError):a.execute(True)
  self.assertTrue(self.table_created);self.assert_old();self.assertEqual(self.projection.read_bytes(),b'OLD_REBOUND_PROJECTION')
 def test_platform_start_failure_restores_old_configuration(self):
  self.failure='backend_start'
  with self.assertRaises(RuntimeError):a.execute(True)
  self.assert_old()
 def test_health_failure_restores_services_not_database(self):
  self.failure='health'
  with self.assertRaises(RuntimeError):a.execute(True)
  self.assertTrue(self.table_created);self.assert_old()
 def test_cleanup_failure_restores_old_release(self):
  self.failure='cleanup'
  with self.assertRaises(RuntimeError):a.execute(True)
  self.assert_old()
 def test_failed_check_never_stops_service(self):
  with patch.object(a,'inspect',side_effect=RuntimeError('BASE_MOVED')):
   with self.assertRaises(RuntimeError):a.execute(True)
  self.assertEqual(self.events,[])
 def test_later_writer_not_overwritten_on_rollback(self):
  self.config.write_bytes(b'THIRD_PARTY')
  with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertEqual(self.config.read_bytes(),b'THIRD_PARTY');self.assertNotIn('restart:'+a.NATIVE_UNIT,self.events);self.assertIn('restart:'+a.WEB_UNIT,self.events)
  receipt=json.loads((self.root/'ROLLED_BACK.json').read_text());self.assertIn(str(self.config),receipt['conflicts_not_overwritten']);self.assertTrue(receipt['unaffected_service_recovery_attempted'])

 def test_foreign_platform_selector_preserved_other_services_recovered(self):
  self.selectors[0].write_text('OTHER_AGENT_RELEASE')
  with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertEqual(self.selectors[0].read_text(),'OTHER_AGENT_RELEASE')
  self.assertNotIn('restart:'+a.BACKENDS[1],self.events);self.assertIn('restart:'+a.WEB_UNIT,self.events)
  self.assertTrue((self.root/'ROLLED_BACK.json').exists())

 def test_unreadable_config_does_not_abort_other_recovery(self):
  original=a.read_managed
  def read(p):
   if p==self.config:raise OSError('synthetic read failure')
   return original(p)
  with patch.object(a,'read_managed',read):
   with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertIn('restart:'+a.WEB_UNIT,self.events);self.assertNotIn('restart:'+a.NATIVE_UNIT,self.events)
  self.assertEqual(self.config.read_bytes(),b'OLD_CONFIG')
 def test_receipt_write_failure_never_blocks_restarts(self):
  atomic=self.core.atomic
  def write(p,*args,**kwargs):
   if p.name in ('RECOVERY_STARTED.json','ROLLED_BACK.json'):raise OSError('synthetic full disk')
   return atomic(p,*args,**kwargs)
  self.core.atomic=write
  with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertIn('restart:'+a.NATIVE_UNIT,self.events);self.assertIn('restart:'+a.WEB_UNIT,self.events)
 def test_one_recovery_action_failure_does_not_skip_other_services(self):
  self.failure='native_start'
  with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertIn('restart:'+a.BACKENDS[0],self.events);self.assertIn('restart:'+a.WEB_UNIT,self.events)
  self.assertIn('native_restart',json.loads((self.root/'ROLLED_BACK.json').read_text())['failures'])

 def test_native_pointer_restore_failure_never_restarts_wrong_release(self):
  self.native.unlink();self.native.symlink_to(self.new[1]);original=self.core.pointer
  def pointer(path,target):
   if path==self.native:raise OSError('synthetic replace failure')
   original(path,target)
  self.core.pointer=pointer
  with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertEqual(self.native.resolve(),self.new[1]);self.assertNotIn('restart:'+a.NATIVE_UNIT,self.events)
  self.assertIn('restart:'+a.WEB_UNIT,self.events)
 def test_reload_failure_prevents_all_restarts(self):
  original=self.fake_run
  def command(*args,**kw):
   if args==('systemctl','daemon-reload'):raise RuntimeError('synthetic daemon reload failure')
   return original(*args,**kw)
  with patch.object(a,'run',command):
   with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertFalse(any(x.startswith('restart:')for x in self.events));self.assertTrue((self.root/'ROLLED_BACK.json').exists())
 def test_failed_config_restore_blocks_affected_native_only(self):
  self.config.write_bytes(b'OURS');ours={**self.before,self.config:b'OURS'};original=self.core.atomic
  def atomic(path,*args,**kwargs):
   if path==self.config:raise OSError('synthetic config write failure')
   return original(path,*args,**kwargs)
  self.core.atomic=atomic
  with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,ours,{},None)
  self.assertNotIn('restart:'+a.NATIVE_UNIT,self.events);self.assertIn('restart:'+a.WEB_UNIT,self.events)
 def test_write_without_correct_readback_never_restarts_backend(self):
  self.selectors[0].write_bytes(b'OURS');ours={**self.before,self.selectors[0]:b'OURS'};original=Path.unlink
  def unlink(path,*args,**kwargs):
   if path==self.selectors[0]:return
   return original(path,*args,**kwargs)
  with patch.object(Path,'unlink',unlink):
   with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,ours,{},None)
  self.assertNotIn('restart:'+a.BACKENDS[1],self.events);self.assertIn('restart:'+a.BACKENDS[0],self.events)

 def test_dangling_foreign_flag_symlink_is_preserved(self):
  self.flags[0].symlink_to(self.p/'missing-foreign-target')
  with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertTrue(self.flags[0].is_symlink());self.assertNotIn('restart:'+a.BACKENDS[1],self.events)
  self.assertIn('restart:'+a.WEB_UNIT,self.events)
 def test_matching_content_symlink_still_not_trusted(self):
  target=self.p/'foreign-config';target.write_bytes(b'OLD_CONFIG');self.config.unlink();self.config.symlink_to(target)
  with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  self.assertTrue(self.config.is_symlink());self.assertEqual(target.read_bytes(),b'OLD_CONFIG')
  self.assertNotIn('restart:'+a.NATIVE_UNIT,self.events)

 def test_foreign_fifo_cannot_block_independent_recovery(self):
  import signal
  os.mkfifo(self.flags[0],0o600)
  previous=signal.signal(signal.SIGALRM,lambda *args:(_ for _ in ()).throw(AssertionError('FIFO blocked rollback')))
  signal.alarm(2)
  try:
   with self.assertRaises(RuntimeError):a.rollback(self.core,self.pair,self.before,self.before,{},None)
  finally:signal.alarm(0);signal.signal(signal.SIGALRM,previous)
  self.assertTrue(self.flags[0].exists());self.assertIn('restart:'+a.WEB_UNIT,self.events)
  self.assertNotIn('restart:'+a.BACKENDS[1],self.events)

 def test_s11_source_selectors_are_never_modified(self):
  originals={p:p.read_bytes()for p in self.source_selectors};a.execute(True)
  self.assertEqual({p:p.read_bytes()for p in self.source_selectors},originals)
  self.assertTrue(all(str(self.new[0]).encode()in p.read_bytes()for p in self.selectors))
 def test_rollback_removes_only_own_release_overlays(self):
  originals={p:p.read_bytes()for p in self.source_selectors};self.failure='health'
  with self.assertRaises(RuntimeError):a.execute(True)
  self.assertTrue(all(not p.exists()for p in self.selectors))
  self.assertEqual({p:p.read_bytes()for p in self.source_selectors},originals)
 def test_late_other_agent_selector_change_prevents_migration(self):
  snapshot=self.snapshot
  def changed():
   result=snapshot()
   if self.snapshots==2:self.source_selectors[0].write_text('UNEXPECTED_LATER_RELEASE')
   return result
  with patch.object(a,'snapshot',changed):
   with self.assertRaises(RuntimeError):a.execute(True)
  self.assertFalse(self.table_created);self.assertEqual(self.source_selectors[0].read_text(),'UNEXPECTED_LATER_RELEASE')
  self.assertNotIn('restart:'+a.BACKENDS[1],self.events);self.assertIn('restart:'+a.WEB_UNIT,self.events)

if __name__=='__main__':unittest.main()
