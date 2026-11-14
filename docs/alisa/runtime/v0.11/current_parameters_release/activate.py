"""Finite R5 switch on the exact active S11 baseline; additive migration only.

Uses pinned existing release helpers and the common flock, not a new controller.
--check never switches services or migrates. --apply requires its own exact
checks again; a concurrent source change blocks rather than being overwritten.
"""
from pathlib import Path
from datetime import datetime,timezone
import fcntl,hashlib,importlib.util,json,os,sqlite3,stat,subprocess,sys,time
ROOT=Path('/root/alisa-parameters-install-20261114-r5')
SOURCE='1d572aebf6b05b88ae5c233ae4313284add03e45'
BASES=[Path('/opt/alisa-platform/stage/releases/alisa-question-catalog-d4eb0ccf798fbb45'),Path('/opt/alice-market/releases/alisa-question-catalog-d4eb0ccf798fbb45'),Path('/opt/alisa-platform/stage/releases/alisa-cabinet-catalog-d4eb0ccf798fbb45')]
TARGETS=[BASES[0].parent/('alisa-parameters-'+SOURCE[:16]),BASES[1].parent/('alisa-parameters-'+SOURCE[:16]),BASES[2].parent/('alisa-cabinet-parameters-'+SOURCE[:16])]
NATIVE_POINTER=Path('/opt/alice-market/releases/current');WEB_POINTER=Path('/opt/alisa-platform/stage/web-current')
CONFIG=Path('/etc/alice-market/market-runtime.json')
SOURCE_SELECTORS=[Path('/etc/systemd/system')/(u+'.service.d')/('z'*64+'-question-catalog.conf')for u in ['alisa-platform@stage','alisa-runtime-authority-stage']]+[Path('/etc/systemd/system/alisa-account-cleanup@stage.service.d/zzzzzzzzzzzzzzzzzzzz-alice-link-r1.conf')]
SOURCE_RELEASES=[BASES[0],BASES[0],Path('/opt/alisa-platform/stage/releases/alisa-template-clarification-81579c18d4725c7f')]
SELECTORS=[Path('/etc/systemd/system')/(u+'.service.d')/('z'*72+'-parameters-r5-release.conf')for u in ['alisa-platform@stage','alisa-runtime-authority-stage','alisa-account-cleanup@stage']]
FLAGS=[Path('/etc/systemd/system/'+u+'.service.d/zzzzzzzzzzzzzzzzzzzzzzzz-parameters-r5.conf')for u in ['alisa-platform@stage','alisa-runtime-authority-stage','alisa-web@stage']]
FLAG_BYTES=b'[Service]\nEnvironment=ALISA_OWNER_PARAMETERS_ENABLED=1\nEnvironment=ALISA_OWNER_PARAMETER_COLLECTION_ENABLED=1\n'
BACKENDS=['alisa-runtime-authority-stage.service','alisa-platform@stage.service'];WEB_UNIT='alisa-web@stage.service';NATIVE_UNIT='alice-market.service'
PAIR_SOURCE=Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a/pair_helpers.py')
CORE_SOURCE=PAIR_SOURCE.with_name('install.py')
HELPER_HASHES={'core':'f8e68d5e0ad7502c8bd31f7c859a44921ba904f3265f8607e0f4091d2e596307','pair':'194b45ba797b053544bff9db84a1e933da62db34dba6e55835121f66eb2f8fb9'}

def need(ok,code):
 if not ok:raise RuntimeError(code)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(*args,**kwargs):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=45,**kwargs).stdout.strip()
def prop(u,k):return run('systemctl','show',u,'-p',k,'--value')
def load(name,path,digest):
 need(sha(path)==digest,'RELEASE_HELPER_CHANGED');spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def read_managed(path):
 # Never confuse an absent file with a dangling symlink or follow another
 # writer's link. The shared rollout lock remains required for all writers.
 try:info=path.lstat()
 except FileNotFoundError:return None
 need(stat.S_ISREG(info.st_mode),'MANAGED_PATH_NOT_REGULAR')
 try:fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 except FileNotFoundError:return None
 try:
  opened=os.fstat(fd)
  need(stat.S_ISREG(opened.st_mode)and(opened.st_dev,opened.st_ino)==(info.st_dev,info.st_ino),'MANAGED_PATH_NOT_REGULAR')
  with os.fdopen(fd,'rb',closefd=False)as stream:return stream.read()
 finally:os.close(fd)

def selector_overlays():
 # Read the exact active S11 definitions and the separately retained cleanup
 # release. Publish only our own later drop-ins, never edit the other agent's.
 originals={};result={}
 for source,base,target in zip(SOURCE_SELECTORS,SOURCE_RELEASES,SELECTORS):
  raw=read_managed(source)
  need(raw is not None and str(base).encode()in raw,'SELECTOR_SOURCE_BASE_MISMATCH')
  originals[source]=raw
  result[target]=raw.replace(str(base).encode(),str(TARGETS[0]).encode()).replace(base.name.encode(),TARGETS[0].name.encode())
 return originals,result

def helpers():
 c=load('parameter_core',CORE_SOURCE,HELPER_HASHES['core']);m=load('parameter_pair',PAIR_SOURCE,HELPER_HASHES['pair'])
 for module in (c,m):
  for key,value in {'ROOT':ROOT,'SOURCE':SOURCE,'BASE':BASES[0],'APP':TARGETS[0],'NATIVE_BASE':BASES[1],'NATIVE':TARGETS[1],'CURRENT':NATIVE_POINTER}.items():setattr(module,key,value)
 c.WEB_BASE=BASES[2];c.WEB_APP=TARGETS[2];c.WEB=WEB_POINTER
 return c,m

def record(c,name,value):c.atomic(ROOT/name,(json.dumps(value,indent=2)+'\n').encode())

def snapshot():
 cfg=json.loads(CONFIG.read_text())
 with sqlite3.connect('file:'+cfg['database']+'?mode=ro',uri=True)as db:
  busy=db.execute("SELECT COUNT(*)FROM jobs WHERE state IN('QUEUED','RUNNING')").fetchone()[0]
  retained=db.execute('SELECT COUNT(*)FROM jobs WHERE expires>?',(time.time(),)).fetchone()[0]
 deliveries=[]
 for p in Path('/var/lib/alisa-station/users').glob('*/state.json'):
  job=json.loads(p.read_text()).get('job')
  if job is not None:deliveries.append(job.get('delivery'))
 need(busy==0,'ACTIVE_RUNTIME_JOBS');need(retained==0,'UNEXPIRED_RUNTIME_JOBS')
 need(all(x=='responded_to_skill'for x in deliveries),'UNDELIVERED_VOICE_ANSWER')
 result=json.loads(run(str(TARGETS[0]/'.venv/bin/python'),'-B',str(ROOT/'migration.py'),'--state'))
 need(result['active_web_queries']==0,'ACTIVE_WEB_QUERIES')
 return {'active_jobs':busy,'unexpired_jobs':retained,'undelivered_voice_answers':0,'active_web_queries':0}

def inspect(c,m):
 prepared=json.loads((ROOT/'PREPARED.json').read_text());need(prepared['source']==SOURCE,'PREPARED_SOURCE')
 for root,digest in prepared['bases'].items():need(sha(Path(root)/'manifest.json')==digest,'BASE_MANIFEST_MOVED');c.manifest(Path(root))
 for root,digest in prepared['manifests'].items():need(sha(Path(root)/'manifest.json')==digest,'CANDIDATE_MOVED');c.manifest(Path(root))
 need(NATIVE_POINTER.resolve()==BASES[1]and WEB_POINTER.resolve()==BASES[2],'WAIT_FOR_S11_OR_BASE_CHANGED')
 need(prop(BACKENDS[1],'WorkingDirectory')==str(BASES[0])and prop(BACKENDS[0],'WorkingDirectory')==str(BASES[0]/'services/platform'),'PLATFORM_BASE_CHANGED')
 need(Path('/proc/'+prop(NATIVE_UNIT,'MainPID')+'/cwd').resolve()==BASES[1],'NATIVE_PROCESS_BASE_CHANGED')
 need(all(prop(u,'ActiveState')=='active'for u in c.ALL_UNITS),'SERVICE_INACTIVE')
 need(not any(p.exists()or p.is_symlink()for p in FLAGS+SELECTORS),'PARAMETER_FLAGS_OR_SELECTORS_ALREADY_PRESENT')
 selector_overlays()
 need(prop(c.CLEAN,'ActiveState')not in ['active','activating','deactivating'],'CLEANUP_BUSY')
 state=snapshot();c.reserve()
 migration=json.loads(run(str(TARGETS[0]/'.venv/bin/python'),'-B',str(ROOT/'migration.py'),'--check'));need(migration['status']=='MIGRATION_PREFLIGHT','MIGRATION_PREFLIGHT')
 versions=m.expected_version_bytes(TARGETS[1]);old_projection=m.projection_data()
 # Compute only the non-secret release pin, as the existing unprivileged user.
 code="import parameter_source_runtime as p;print(p.PIN)"
 pin=run('/usr/sbin/runuser','-u','nobody','--','/usr/bin/env','-i','PYTHONPATH='+str(TARGETS[1]),'PYTHONDONTWRITEBYTECODE=1','/usr/bin/python3','-B','-c',code)
 need(len(pin)==64 and set(pin)<=set('0123456789abcdef'),'INVALID_RELEASE_PIN')
 cfg=json.loads(CONFIG.read_text());policy=cfg.get('parameter_sources');need(policy is None or type(policy)is dict and set(policy)=={'enabled'}and policy['enabled']is False,'PARAMETER_POLICY_ALREADY_ENABLED')
 newcfg=json.loads(json.dumps(cfg));newcfg['parameter_sources']={'enabled':True,'pin':pin}
 # A feature flag must not silently change the owner-source binding material.
 module=m.native_module()
 for binding in old_projection['bindings']:
  material=module.root_json(Path('/run/credentials/alice-market.service')/binding['credential_name'],32768)
  context=module.native_context(newcfg,material,binding,environment=old_projection['environment'],product_id=old_projection['product_id'],generation=old_projection['native_generation'])
  need(module.hmac.compare_digest(module.mac(bytes.fromhex(old_projection['mac_key']),'native-owner-source-v1',context),binding['source_hmac']),'OWNER_BINDING_WOULD_CHANGE')
 return state,migration,versions,old_projection,(json.dumps(newcfg,indent=2)+'\n').encode()

def rollback(c,m,before,ours,old_projection,lock):
 # Restore independent components, but restart only after their own configuration
 # and selector have been verified. Receipt failures never interrupt recovery.
 failures=[];skipped=[];conflicts=[];restored={}
 def attempt(label,fn):
  try:fn();return True
  except BaseException:failures.append(label);return False
 for p,old in before.items():
  try:
   actual=read_managed(p)
   if actual not in(old,ours.get(p,old)):conflicts.append(p)
  except BaseException:conflicts.append(p);failures.append('read:'+str(p))
 def known(pointer,choices):
  try:return pointer.resolve()in choices
  except BaseException:failures.append('read_selector:'+str(pointer));return False
 native_known=known(NATIVE_POINTER,(BASES[1],TARGETS[1]));web_known=known(WEB_POINTER,(BASES[2],TARGETS[2]))
 attempt('recovery_start_receipt',lambda:record(c,'RECOVERY_STARTED.json',{'conflicts':[str(p)for p in conflicts],'native_selector_known':native_known,'web_selector_known':web_known,'additive_table_retained':True}))
 def restore(p,old):
  need(read_managed(p)in(old,ours.get(p,old)),'RECOVERY_LATER_WRITER')
  if old is None:p.unlink(missing_ok=True)
  else:c.atomic(p,old,p.stat().st_mode&0o777)
  need(read_managed(p)==old,'RECOVERY_FILE_READBACK')
 for p,old in before.items():
  restored[p]=False
  if p in SOURCE_SELECTORS:
   restored[p]=p not in conflicts
   continue
  if p==m.PROJECTION or p in conflicts:continue
  restored[p]=attempt(str(p),lambda p=p,old=old:restore(p,old))
 def pointer(path,target):
  c.pointer(path,target);need(path.resolve()==target,'RECOVERY_SELECTOR_READBACK')
 native_restored=native_known and attempt('native_pointer',lambda:pointer(NATIVE_POINTER,BASES[1]))
 web_restored=web_known and attempt('web_pointer',lambda:pointer(WEB_POINTER,BASES[2]))
 if not native_restored:skipped.append('native_selector_not_restored')
 if not web_restored:skipped.append('web_selector_not_restored')
 reload_ok=attempt('daemon_reload',lambda:run('systemctl','daemon-reload'))
 native_ready=native_restored and restored.get(CONFIG,False)and restored.get(m.VERSIONS,False)and reload_ok
 if native_ready:
  versions_ok=attempt('version_sync',lambda:m.sync(BASES[1],lock))
  native_started=versions_ok and attempt('native_restart',lambda:run('systemctl','restart',NATIVE_UNIT))
  if native_started and m.PROJECTION not in conflicts:attempt('owner_projection_refresh',lambda:m.refresh_projection(old_projection))
  elif not native_started:skipped.append('native_restart_or_version_sync_failed')
  else:skipped.append('owner_binding_later_writer_requires_recheck')
 else:skipped.append('native_configuration_not_restored')
 for u,selector,flag,source in [(BACKENDS[0],SELECTORS[1],FLAGS[1],SOURCE_SELECTORS[1]),(BACKENDS[1],SELECTORS[0],FLAGS[0],SOURCE_SELECTORS[0])]:
  if reload_ok and restored.get(selector,False)and restored.get(flag,False)and restored.get(source,False):attempt(u,lambda u=u:run('systemctl','restart',u))
  else:skipped.append(u+'_configuration_not_restored')
 if reload_ok and web_restored and restored.get(FLAGS[2],False):attempt(WEB_UNIT,lambda:run('systemctl','restart',WEB_UNIT))
 else:skipped.append('web_configuration_not_restored')
 if not conflicts and not skipped and not failures:attempt('health',lambda:c.ready(BASES[0],BASES[2]))
 receipt={'status':'ROLLBACK_NEEDS_ATTENTION'if conflicts or skipped or failures else'ROLLED_BACK',
     'conflicts_not_overwritten':[str(p)for p in conflicts],'failures':failures,'skipped_unsafe_restarts':skipped,
     'unaffected_service_recovery_attempted':True,'additive_current_parameter_table_retained':True}
 attempt('recovery_final_receipt',lambda:record(c,'ROLLED_BACK.json',receipt))
 if failures:receipt['status']='ROLLBACK_NEEDS_ATTENTION'
 try:print(json.dumps({'recovery':receipt}),file=sys.stderr,flush=True)
 except BaseException:pass
 need(not(conflicts or skipped or failures),'ROLLBACK_NEEDS_ATTENTION')

def execute(apply=False):
 need(os.geteuid()==0,'ROOT_REQUIRED');c,m=helpers()
 with Path('/run/lock/alisa-stage-rollout.lock').open('a')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  state,migration,versions,projection,newcfg=inspect(c,m)
  check={'utc':datetime.now(timezone.utc).isoformat(),'status':'RELEASE_CHECK_PASS','source':SOURCE,'state':state,'migration':migration,'production_changes':False}
  record(c,'CHECKED.json',check)
  if not apply:print(json.dumps(check));return
  need(not(ROOT/'backup').exists()and not(ROOT/'ACTIVATED.json').exists(),'ALREADY_ATTEMPTED')
  paths=[*SELECTORS,*FLAGS,*SOURCE_SELECTORS,m.VERSIONS,m.PROJECTION,CONFIG]
  before={p:read_managed(p)for p in paths};ours=dict(before)
  source_selectors,overlays=selector_overlays()
  need(all(before[p]==raw for p,raw in source_selectors.items()),'SOURCE_SELECTOR_RACE')
  need(all(before[p]is None for p in SELECTORS),'OWN_SELECTOR_ALREADY_EXISTS')
  ours.update(overlays)
  ours.update({p:FLAG_BYTES for p in FLAGS});ours[m.VERSIONS]=versions;ours[CONFIG]=newcfg
  (ROOT/'backup').mkdir(mode=0o700)
  for i,(p,value)in enumerate(before.items()):
   if value is not None:c.atomic(ROOT/'backup'/str(i),value)
  record(c,'BACKUP_INDEX.json',[str(p)for p in before])
  others={u:{k:prop(u,k)for k in ['MainPID','WorkingDirectory']}for u in c.OTHERS}
  entered=False
  try:
   snapshot()
   # Freeze new web/native admissions and re-check persisted jobs. If a final
   # admission raced the first check, restart the old code without migration.
   entered=True
   for u in [WEB_UNIT,BACKENDS[1],BACKENDS[0],NATIVE_UNIT]:run('systemctl','stop',u)
   snapshot()
   need(all(read_managed(p)==raw for p,raw in source_selectors.items()),'OTHER_AGENT_SELECTOR_CHANGED')
   migrated=json.loads(run(str(TARGETS[0]/'.venv/bin/python'),'-B',str(ROOT/'migration.py'),'--apply'))
   need(migrated['status']=='MIGRATED','MIGRATION_FAILED')
   for p in SELECTORS+FLAGS+[CONFIG]:
    need(read_managed(p)==before[p],'CONFIG_CHANGED_DURING_SWITCH')
    p.parent.mkdir(parents=True,exist_ok=True);c.atomic(p,ours[p],p.stat().st_mode&0o777 if p.exists()else 0o644)
   c.pointer(NATIVE_POINTER,TARGETS[1]);c.pointer(WEB_POINTER,TARGETS[2]);m.sync(TARGETS[1],lock)
   run('systemctl','daemon-reload');run('systemctl','start',NATIVE_UNIT)
   m.refresh_projection(projection,on_write=lambda raw:ours.update({m.PROJECTION:raw}))
   for u in BACKENDS+[WEB_UNIT]:run('systemctl','start',u)
   c.ready(TARGETS[0],TARGETS[2]);c.cleanup_probe();m.projection_data();c.reserve()
   need(all(all(prop(u,k)==v for k,v in info.items())for u,info in others.items()),'UNRELATED_SERVICE_CHANGED')
   record(c,'ACTIVATED.json',{'utc':datetime.now(timezone.utc).isoformat(),'status':'INSTALLED_TECHNICAL_CHECKS_PASS','source':SOURCE,'platform':str(TARGETS[0]),'runtime':str(TARGETS[1]),'web':str(TARGETS[2]),'migration':migration['target'],'owner_data_preserved':True,'unrelated_service_pids_preserved':True,'live_provider_or_model_calls':0,'live_owner_acceptance':'NOT_RUN'})
   print((ROOT/'ACTIVATED.json').read_text())
  except BaseException:
   if entered:rollback(c,m,before,ours,projection,lock)
   raise

if __name__=='__main__':
 try:
  need(sys.argv[1:]in[['--check'],['--apply']],'ARGUMENTS');execute(sys.argv[1]=='--apply')
 except Exception as e:
  print(json.dumps({'status':'BLOCKED','code':str(e)if type(e)is RuntimeError else type(e).__name__}));raise SystemExit(1)
