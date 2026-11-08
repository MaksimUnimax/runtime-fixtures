"""Bounded runtime cutover; additive SQLite upgrade and code-only rollback."""
import contextlib,fcntl,hashlib,importlib.util,json,os,shutil,signal,sqlite3,stat,subprocess,sys,tempfile,time
from pathlib import Path as P
sys.dont_write_bytecode=True;os.umask(0o077)
D=P('/var/lib/alisa-platform/stage/rollout-backups/audit-06f3-20261108')
OLD=P('/opt/alice-market/releases/20261106-store-check-6098-r1');NEW=OLD.parent/'alisa-runtime-06f3c053e7719290'
CHECKER=P('/opt/alice-market/checker-releases/rt-check-5dff6e8883e25ac4')
CONFIG=P('/etc/alice-market/market-runtime.json');DB=P('/var/lib/alice-market/state.sqlite3')
ARGS=' --socket /run/alice-market/store-check.sock --allowed-uid 993 --environment stage --enable-kind WB --enable-kind SELLER --enable-kind PERFORMANCE --seller-binding-qualified'
UNITS=['alice-market.service','alisa-store-check.service']
DROPS={UNITS[0]:P('/etc/systemd/system/alice-market.service.d/zzzzzzzzzzzzzzzzz-audit-20261108.conf'),UNITS[1]:P('/etc/systemd/system/alisa-store-check.service.d/zzzz-audit-20261108.conf')}
NEW_ARGS={UNITS[0]:f'/usr/bin/python3 -B {NEW}/runtime.py --config {CONFIG}',UNITS[1]:f'/usr/bin/python3 -B {NEW}/store_check_ipc.py'+ARGS}
OLD_ARGS={UNITS[0]:f'/usr/bin/python3 -B {OLD}/runtime.py --config {CONFIG}',UNITS[1]:f'/usr/bin/python3 -B {CHECKER}/store_check_ipc.py'+ARGS}
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
PROPS='User,Group,Environment,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,TasksMax,TimeoutStopUSec,KillMode,BindsTo,PartOf'
rec={'scope':'INSTALLED_RUNTIME_CODE_AND_ADDITIVE_SQLITE_COLUMNS_NOT_LIVE_NUMERIC_ACCEPTANCE','status':'FAILED','cases':[]};made={};stopped=False;profiles={};old_pointers={}
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(n,v):
 rec['cases'].append({'case':n,'passed':bool(v)})
 if not v:raise RuntimeError(n)
def cmd(a,timeout=45):return subprocess.run(list(map(str,a)),capture_output=True,check=True,timeout=timeout).stdout.decode()
def prop(u,n):return cmd(['systemctl','show',u,'--value','--property='+n],timeout=5).strip()
def argv(u):
 raw=prop(u,'ExecStart');return raw.split('argv[]=',1)[1].split(' ;',1)[0]
def profile(u):return hashlib.sha256(cmd(['systemctl','show',u,'--property='+PROPS]).encode()).hexdigest()
def pointers():
 b=P('/opt/alisa-platform/stage');return {n:str((b/n).resolve())for n in ['site-current','web-current','admin-current','identity-current','current']}
def ro(path):
 c=sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True,timeout=2);c.execute('PRAGMA query_only=ON');return c
def ensure_idle():
 with contextlib.closing(ro(DB))as c:
  check('no_queued_running_jobs',c.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0)
  check('no_sending_provider_call',c.execute("SELECT count(*) FROM calls WHERE state='SENDING'").fetchone()[0]==0)
def admit_backup():
 with contextlib.closing(ro(DB))as c:logical=c.execute('PRAGMA page_count').fetchone()[0]*c.execute('PRAGMA page_size').fetchone()[0]
 logical=max(logical,DB.stat().st_size)
 rec['logical_database_bytes']=logical
 check('disk_inode_backup_reserve',shutil.disk_usage('/').free>=3072*1048576+16*1048576+logical*3 and os.statvfs('/').f_favail>=200000)
def socket_meta(n):
 p=P('/run/alice-market')/n;s=p.lstat();check('unix_socket_'+n,stat.S_ISSOCK(s.st_mode));return [s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode)]
def ready(expected,where):
 deadline=time.monotonic()+25
 while time.monotonic()<deadline:
  try:
   if all(prop(u,'ActiveState')=='active'and int(prop(u,'MainPID'))>0 for u in UNITS) and all((P('/run/alice-market')/s).exists()for s in ['gateway.sock','store-check.sock']):break
  except (subprocess.SubprocessError,ValueError):pass
  time.sleep(.2)
 else:raise RuntimeError('runtime_readiness')
 for u in UNITS:
  check('exact_launch_'+u,argv(u)==expected[u] and prop(u,'WorkingDirectory')==str(where))
  pid=prop(u,'MainPID');check('actual_runtime_pid_'+u,P('/proc',pid,'cwd').resolve()==where and int(next(l.split()[1]for l in P('/proc',pid,'status').read_text().splitlines()if l.startswith('Uid:')))==996)
def table_fingerprints(c):
 result={}
 for name, in c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall():
  cols=[x[1]for x in c.execute('PRAGMA table_info("'+name+'")')]
  rows=c.execute('SELECT '+','.join('"'+x+'"'for x in cols)+' FROM "'+name+'" ORDER BY rowid').fetchall()
  result[name]={'columns':cols,'hash':hashlib.sha256(json.dumps(rows,default=str).encode()).hexdigest()}
 return result
def main():
 global stopped,profiles,old_pointers
 check('install_and_native_qualification_pass',json.loads((D/'install.json').read_text())['status']=='PASS' and json.loads((D/'runtime-installed-qualification.json').read_text())['status']=='PASS')
 check('exact_runtime_manifest',digest(NEW/'manifest.json')=='44e3b6116ac3dd3963e734a031c297b41fa64f3b84b140339fe03c90797d757a')
 manifest=json.loads((NEW/'manifest.json').read_text());check('runtime_payload',all(digest(NEW/n)==h for n,h in manifest['files'].items()))
 check('exact_original_launch',all(argv(u)==OLD_ARGS[u] and prop(u,'WorkingDirectory')==str(OLD) and prop(u,'ActiveState')=='active'for u in UNITS))
 check('config_pin',digest(CONFIG)=='92702c1136ebd0d785ef2b1b76c9d7873761076478e568df739e7d4635b252b5' and json.loads(CONFIG.read_text())['database']==str(DB))
 check('new_override_paths',all(not p.exists()and not p.is_symlink() and p.parent.is_dir()and p.parent.stat().st_uid==0 and not p.parent.stat().st_mode&0o022 for p in DROPS.values()))
 admit_backup()
 profiles={u:profile(u)for u in UNITS};old_pointers=pointers();sockets={n:socket_meta(n)for n in ['gateway.sock','store-check.sock']}
 dbmeta=[DB.stat().st_uid,DB.stat().st_gid,stat.S_IMODE(DB.stat().st_mode)];ensure_idle()
 # Stop ingress to this runtime before taking its rollback snapshot. A raced-in
 # queued job aborts cutover and is resumed by the old code, never edited away.
 stopped=True;cmd(['systemctl','stop',*UNITS]);ensure_idle()
 check('units_stopped',all(prop(u,'ActiveState')=='inactive'for u in UNITS));admit_backup()
 backup=D/'runtime-before.private.sqlite3';clone=D/'runtime-upgrade-probe.private.sqlite3'
 check('new_backup_paths',not backup.exists()and not clone.exists())
 with contextlib.closing(ro(DB))as source,contextlib.closing(sqlite3.connect(backup))as dest:source.backup(dest)
 backup.chmod(0o600);shutil.copyfile(backup,clone);clone.chmod(0o600)
 with contextlib.closing(ro(clone))as c:before=table_fingerprints(c)
 sys.path.insert(0,str(NEW));from repository import Repository
 Repository(str(clone))
 with contextlib.closing(ro(clone))as c:
  for name,v in before.items():
   rows=c.execute('SELECT '+','.join('"'+x+'"'for x in v['columns'])+' FROM "'+name+'" ORDER BY rowid').fetchall()
   check('preserved_existing_table_'+name,hashlib.sha256(json.dumps(rows,default=str).encode()).hexdigest()==v['hash'])
  check('additive_job_columns',set(x[1]for x in c.execute('PRAGMA table_info(jobs)'))==set(before['jobs']['columns'])|{'dispatch_order','queue_order'})
 spec=importlib.util.spec_from_file_location('audit_legacy_repository',OLD/'repository.py');legacy=importlib.util.module_from_spec(spec);spec.loader.exec_module(legacy);legacy.Repository(str(clone))
 rec['backup_sha256']=digest(backup);rec['upgrade_probe_legacy_open']=True
 for u,p in DROPS.items():
  data=f'[Service]\nWorkingDirectory={NEW}\nExecStart=\nExecStart={NEW_ARGS[u]}\n'
  fd,temp=tempfile.mkstemp(prefix='.audit-06f3-',dir=p.parent)
  try:
   with os.fdopen(fd,'w')as f:f.write(data);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),0o644)
   s=P(temp).stat();made[str(p)]={'data':data,'device':s.st_dev,'inode':s.st_ino}
   os.link(temp,p)
  finally:P(temp).unlink()
 cmd(['systemctl','daemon-reload']);cmd(['systemctl','start',*UNITS]);ready(NEW_ARGS,NEW)
 check('security_profiles_preserved',all(profile(u)==h for u,h in profiles.items()))
 check('socket_metadata_preserved',all(socket_meta(n)==v for n,v in sockets.items()))
 check('config_and_platform_pointers_preserved',digest(CONFIG)=='92702c1136ebd0d785ef2b1b76c9d7873761076478e568df739e7d4635b252b5'and pointers()==old_pointers)
 check('database_metadata_preserved',[DB.stat().st_uid,DB.stat().st_gid,stat.S_IMODE(DB.stat().st_mode)]==dbmeta)
 with contextlib.closing(ro(DB))as c:check('live_additive_columns',{'dispatch_order','queue_order'}<=set(x[1]for x in c.execute('PRAGMA table_info(jobs)')))
 check('reserve_retained',shutil.disk_usage('/').free>=3072*1048576)
 rec['status']='PASS';rec['active_runtime']=str(NEW);rec['override_hashes']={n:hashlib.sha256(v['data'].encode()).hexdigest()for n,v in made.items()}
def recover():
 if not stopped:return 'NO_CUTOVER'
 for n,v in made.items():
  p=P(n)
  if p.exists()or p.is_symlink():
   s=p.lstat()
   if not stat.S_ISREG(s.st_mode)or(s.st_dev,s.st_ino)!=(v['device'],v['inode'])or p.read_text()!=v['data']:return 'EXTERNAL_CHANGE_PRESERVED'
 if any(argv(u)not in {OLD_ARGS[u],NEW_ARGS[u]}for u in UNITS)or any(profile(u)!=v for u,v in profiles.items())or digest(CONFIG)!='92702c1136ebd0d785ef2b1b76c9d7873761076478e568df739e7d4635b252b5' or pointers()!=old_pointers:return 'EXTERNAL_CHANGE_PRESERVED'
 cmd(['systemctl','stop',*UNITS])
 for n in made:
  if P(n).exists():P(n).unlink()
 cmd(['systemctl','daemon-reload']);cmd(['systemctl','start',*UNITS]);ready(OLD_ARGS,OLD)
 return 'OLD_CODE_RESTORED_ADDITIVE_COLUMNS_RETAINED_NO_DATABASE_RESTORE'
if __name__=='__main__':
 out=D/'runtime-activation.json'
 if out.exists()or out.is_symlink():raise SystemExit('Existing receipt preserved')
 with contextlib.ExitStack()as stack:
  for n in LOCKS:
   f=stack.enter_context(open('/run/lock/'+n));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  def interrupted(signum,frame):raise RuntimeError('CONTROLLED_DEPLOY_INTERRUPTION')
  for sig in [signal.SIGTERM,signal.SIGINT,signal.SIGALRM]:signal.signal(sig,interrupted)
  signal.alarm(180)
  try:main();signal.alarm(0)
  except Exception as e:
   signal.alarm(0)
   for sig in [signal.SIGTERM,signal.SIGINT]:signal.signal(sig,signal.SIG_IGN)
   rec['status']='FAILED';rec['error_type']=type(e).__name__
   try:rec['recovery']=recover()
   except Exception as e:rec['recovery_error_type']=type(e).__name__
  finally:
   signal.alarm(0)
   with out.open('x')as f:json.dump(rec,f,indent=2)
   print(json.dumps({k:v for k,v in rec.items()if k!='cases'}))
 sys.exit(0 if rec['status']=='PASS'else 1)
