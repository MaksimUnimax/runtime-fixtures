"""Finite code-only cutover of web/admin/platform; preserve Identity and all config."""
import contextlib,fcntl,hashlib,json,os,pwd,shutil,signal,subprocess,sys,time,urllib.request
from pathlib import Path as P
import psycopg
sys.dont_write_bytecode=True;os.umask(0o077)
B=P('/opt/alisa-platform/stage');D=P('/var/lib/alisa-platform/stage/rollout-backups/audit-06f3-20261108');C=P('/etc/alisa-platform/stage')
R='alisa-06f3c053e7719290';REL=B/'releases'/R
EXPECTED={'site-current':'alisa-5dff6e8883e25ac4','web-current':'alisa-5dff6e8883e25ac4','admin-current':'alisa-73180172646b7012','identity-current':'alisa-7afaf646b9b35a58','current':'alisa-482ed11832b666af'}
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
COMP={'platform':'site-current','web':'web-current','admin':'admin-current'}
PROPERTIES='User,Group,Environment,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,TasksMax,TimeoutStopUSec,KillMode,WorkingDirectory'
rec={'scope':'INSTALLED_CODE_ONLY_SMOKE_NOT_OWNER_MFA_OR_NUMERIC_ACCEPTANCE','status':'FAILED','cases':[]};changed=False;guard=None;config_hashes={};profiles={};identity_pid=None
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(n,v):
 rec['cases'].append({'case':n,'passed':bool(v)})
 if not v:raise RuntimeError(n)
def cmd(a,e=None,timeout=45):return subprocess.run(list(map(str,a)),env=e,capture_output=True,check=True,timeout=timeout).stdout.decode()
def pointers():return {n:(B/n).resolve().name for n in EXPECTED}
def profile(c):
 unit='alisa-'+c+'@stage.service'
 static=cmd(['systemctl','show',unit,'--property='+PROPERTIES])
 launch=cmd(['systemctl','show',unit,'--value','--property=ExecStart']).strip()
 # Exclude systemd's restart timestamps, exit code and recorded child PID.
 fields=launch.split(' ;')
 check('parse_static_launch_'+c,len(fields)>=4 and fields[0].startswith('{ path=') and fields[1].startswith(' argv[]=') and fields[2].startswith(' ignore_errors='))
 return hashlib.sha256((static+'\n'+' ;'.join(fields[:3])).encode()).hexdigest()
def cfg(n):return dict(l.split('=',1) for l in (C/(n+'.env')).read_text().splitlines()if l and not l.startswith('#'))
def pid(c):return int(cmd(['systemctl','show','alisa-'+c+'@stage.service','--property=MainPID','--value']).strip())
def point(n,r):
 p=B/('.audit-06f3-'+n);check('unused_pointer_temp',not p.exists() and not p.is_symlink());p.symlink_to(B/'releases'/r);os.replace(p,B/n)
def health(expected):
 values={};deadline=time.monotonic()+35
 for c,port in [('web',18100),('admin',18101),('platform',18102),('identity',18103)]:
  while time.monotonic()<deadline:
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2)as f:v=json.load(f)
    if v.get('status')=='READY' and v.get('release')==expected[c]:values[c]={'status':v['status'],'release':v['release']};break
   except (OSError,ValueError):pass
   time.sleep(.2)
  else:raise RuntimeError('health_'+c)
 return values
def authority(db):
 with db.cursor()as cur:
  cur.execute('SELECT id,subject,role,active,revision,permissions FROM staff_staffmember ORDER BY id')
  return hashlib.sha256(json.dumps(cur.fetchall(),default=str,sort_keys=True).encode()).hexdigest()
def main():
 global changed,guard,config_hashes,profiles,identity_pid
 check('inactive_install_pass',json.loads((D/'install.json').read_text())['status']=='PASS')
 check('expected_pointers',pointers()==EXPECTED)
 check('exact_manifest',digest(REL/'manifest.json')=='2a5c430bde4bc5fd8593958481d3cfd79baf9552b178ffdd1ced6175526166c9')
 m=json.loads((REL/'manifest.json').read_text());check('exact_payload',all(digest(REL/n)==h for n,h in m['files'].items()) and all(os.readlink(REL/n)==v for n,v in m['links'].items()))
 check('disk_inode_memory_reserve',shutil.disk_usage(B).free>=3072*1048576+8*1048576 and os.statvfs(B).f_favail>=200000 and next(int(l.split()[1])for l in P('/proc/meminfo').read_text().splitlines()if l.startswith('MemAvailable:'))>=1536*1024)
 rec['before_pointers']=pointers();rec['health_before']=health({'platform':EXPECTED['site-current'],'web':EXPECTED['web-current'],'admin':EXPECTED['admin-current'],'identity':EXPECTED['identity-current']})
 for c in COMP:
  unit='alisa-'+c+'@stage.service';s=cmd(['systemctl','show',unit,'--property=User,Group,ExecStart,WorkingDirectory'])
  check('own_launch_'+c,'User=alisa-'+c+'-stage\n' in s and 'Group=alisa-'+c+'-stage\n' in s and str(B/COMP[c])+'/infra/launch.py '+c in s and 'WorkingDirectory='+str(B/COMP[c])+'\n'in s)
 profiles={c:profile(c)for c in ['web','admin','platform','identity']};identity_pid=pid('identity')
 config_hashes={p.name:digest(p)for p in C.glob('*.env')};check('known_configs',all(n+'.env'in config_hashes for n in ['web','platform','admin','identity','platform-migration','identity-migration']))
 e={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',**cfg('platform-migration')}
 plan=cmd([REL/'.venv/bin/python','-B',REL/'services/platform/manage.py','migrate','--plan'],e)
 check('no_database_migration',plan.strip()=='Planned operations:\n  No planned migration operations.')
 runtime=cfg('platform');guard=psycopg.connect(host=runtime['ALISA_DB_HOST'],port=runtime['ALISA_DB_PORT'],dbname=runtime['ALISA_DB_NAME'],user=runtime['ALISA_DB_USER'],password=runtime['ALISA_DB_PASSWORD'],connect_timeout=3)
 with guard.cursor()as cur:
  cur.execute('SELECT pg_try_advisory_xact_lock(%s)',[int.from_bytes(hashlib.sha256(b'alisa_market:staff-owner').digest()[:8],'big',signed=True)]);check('staff_owner_lock',cur.fetchone()[0])
 before=authority(guard);rec['authority_fingerprint_before']=before
 check('unchanged_pre_cutover',pointers()==EXPECTED and all(digest(C/n)==h for n,h in config_hashes.items()))
 changed=True
 for pointer in COMP.values():point(pointer,R)
 cmd(['systemctl','restart','alisa-platform@stage.service'])
 cmd(['systemctl','restart','alisa-web@stage.service','alisa-admin@stage.service'])
 rec['health_after']=health({'platform':R,'web':R,'admin':R,'identity':EXPECTED['identity-current']})
 for c in COMP:
  p=pid(c);check('actual_release_process_'+c,p>0 and P('/proc',str(p),'cwd').resolve().is_relative_to(REL) and int(next(l.split()[1]for l in P('/proc',str(p),'status').read_text().splitlines()if l.startswith('Uid:')))==pwd.getpwnam('alisa-'+c+'-stage').pw_uid)
 check('service_security_profiles_unchanged',all(profile(c)==v for c,v in profiles.items()))
 check('identity_process_unchanged',pid('identity')==identity_pid)
 check('config_bytes_and_file_set_unchanged',{p.name:digest(p)for p in C.glob('*.env')}==config_hashes)
 check('staff_authority_unchanged',authority(guard)==before)
 check('pointers_expected_after',pointers()=={n:(R if n in COMP.values()else v)for n,v in EXPECTED.items()})
 check('disk_reserve_after',shutil.disk_usage(B).free>=3072*1048576)
 guard.commit();guard.close();guard=None;rec['status']='PASS';rec['active_pointers']=pointers()
def recover():
 if not changed:return 'NO_CUTOVER'
 now=pointers()
 if any(now[n]not in {v,R}for n,v in EXPECTED.items()if n in COMP.values())or any(now[n]!=v for n,v in EXPECTED.items()if n not in COMP.values())or {p.name:digest(p)for p in C.glob('*.env')}!=config_hashes or any(profile(c)!=v for c,v in profiles.items()):return 'EXTERNAL_CHANGE_PRESERVED'
 for n in COMP.values():
  if now[n]==R:point(n,EXPECTED[n])
 cmd(['systemctl','restart','alisa-platform@stage.service']);cmd(['systemctl','restart','alisa-web@stage.service','alisa-admin@stage.service'])
 rec['rollback_health']=health({'platform':EXPECTED['site-current'],'web':EXPECTED['web-current'],'admin':EXPECTED['admin-current'],'identity':EXPECTED['identity-current']})
 return 'PREVIOUS_CODE_RESTORED_NO_DATABASE_RESTORE'
if __name__=='__main__':
 out=D/'platform-activation.json'
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
   if guard:guard.rollback();guard.close();guard=None
   try:rec['recovery']=recover()
   except Exception as e:rec['recovery_error_type']=type(e).__name__
  finally:
   signal.alarm(0)
   with out.open('x')as f:json.dump(rec,f,indent=2)
   print(json.dumps({k:v for k,v in rec.items()if k!='cases'}))
 sys.exit(0 if rec['status']=='PASS'else 1)
