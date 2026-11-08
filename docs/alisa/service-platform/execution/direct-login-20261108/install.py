"""Exact-CI Identity overlay. Preserve current API, stores, native core and web."""
import ast,base64,contextlib,fcntl,gzip,hashlib,json,os,shutil,signal,stat,subprocess,sys,time,urllib.request
from pathlib import Path as P
sys.dont_write_bytecode=True;os.umask(0o077)
SOURCE='3a1d3885250d8aa1a51f6e7df3f9d1c3db50b281'
D=P('/var/lib/alisa-platform/stage/rollout-backups/direct-login-20261108')
B=P('/opt/alisa-platform/stage');TARGET=B/'releases'/('alisa-direct-login-'+SOURCE[:16]);UNIT='alisa-identity@stage.service';FLOOR=3072*1048576
PREFIX='services/identity/src/octoport_identity/'
FILES={PREFIX+'protocol/customer.py':('64c9dce30258aa3094e9d3fd2f4f3f28c3d0777e4193814ca3675a8a4f03849c','5c7d54847a592ede33118ecb661e1350a3415a56c3bbf8ca58eb125ba74d2f9e'),
 PREFIX+'protocol/views.py':('85a3beefc925dba7861873190cad585c7242e3c6cb47f5c565e3fcc1728636cb','ac2f32b2f8bec82cac092ddfe5f891f038f8cb80bc4c0dcb0173468f4c2d0f13'),
 PREFIX+'accounts/templates/account/login.html':('f9d8c97c5f8759f09021db818afee4a6bfba90070a9d23bddd5263f6b8192f13','13dc4bd5402feca93e697d59e0fea9ee729c9b6466a93589f74c2ad66904f150')}
PROTECTED=['alice-market.service','alisa-store-check.service','alisa-platform@stage.service','alisa-web@stage.service','alisa-admin@stage.service']
record={'status':'FAILED','scope':'IDENTITY_DIRECT_CUSTOMER_LOGIN_ONLY','cases':[]}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def check(name,ok):
 record['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise ValueError(name)
def command(args,timeout=25):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=timeout).stdout.strip()
def secure(path):
 for p in [*reversed(path.parents),path]:
  s=p.lstat()
  if not stat.S_ISDIR(s.st_mode)or s.st_uid!=0 or s.st_mode&0o022:raise ValueError('UNTRUSTED_DIRECTORY')
def fresh(path,raw,mode=0o600):
 with path.open('xb')as f:f.write(raw);f.flush();os.fsync(f.fileno())
 path.chmod(mode)
def profile():
 value=command(['systemctl','show',UNIT,'-p','User,Group,WorkingDirectory,ExecStart,EnvironmentFiles,SupplementaryGroups,NoNewPrivileges,ProtectSystem,ProtectHome,MemoryMax,MemorySwapMax,TasksMax,TimeoutStopUSec,KillMode'])
 return '\n'.join(line.split(' ; ignore_errors=',1)[0]if line.startswith('ExecStart=')else line for line in value.splitlines())
def snapshot():
 return {'pointers':{n:os.readlink(B/n)for n in ['site-current','web-current','identity-current','admin-current','current']},
  'protected':{u:command(['systemctl','show',u,'-p','MainPID,InvocationID,ActiveState'])for u in PROTECTED},
  'identity':command(['systemctl','show',UNIT,'-p','MainPID,InvocationID,ActiveState']),
  'profile':profile(),'environment_hashes':{n:sha((P('/etc/alisa-platform/stage')/(n+'.env')).read_bytes())for n in ['web','identity','admin','platform','identity-migration','platform-migration']}}
def ready():
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}));result={}
 for port in [18100,18101,18102,18103]:
  with op.open('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2)as r:result[str(port)]=json.loads(r.read(32768))
 return result
def plan(source,relative,changes):
 if relative in changes:return [('file',relative)]
 if not any(n.startswith(relative+'/')for n in changes):return [('reference',relative)]
 result=[('directory',relative)]
 for p in sorted((source/relative).iterdir()):
  if p.name!='__pycache__':result+=plan(source,str(P(relative)/p.name),changes)
 return result
def verify(target,files):return all(sha((target/n).read_bytes())==h for n,h in files.items())
def prepare():
 before=snapshot();check('all_four_components_ready',all(v.get('status')=='READY'for v in ready().values()))
 check('identity_uses_current_pointer',str(B/'identity-current/infra/launch.py')in before['profile'])
 old=(B/'identity-current').resolve();secure(old);secure(B/'releases')
 check('exact_three_installed_preimages',all(sha((old/n).read_bytes())==h[0]for n,h in FILES.items()))
 with gzip.open(D/'payload.json.gz','rb')as f:raw=f.read(262145)
 check('bounded_payload',len(raw)<=262144);payload=json.loads(raw)
 check('exact_qualified_source',payload['source_sha']==SOURCE and payload['tree_sha']=='0db793d11bc1d9820eee10fd9bfd5e06d0d1f53e'
       and payload['ci']=={'platform':42468265071,'documentation':42468265001,'identity_probe':42468265010}and payload['conclusion']=='success')
 values={n:base64.b64decode(payload['files'][n])for n in FILES}
 check('exact_three_ci_file_hashes',all(sha(values[n])==h[1]for n,h in FILES.items()))
 oldm=json.loads((old/'manifest.json').read_text());newm=payload['manifest']
 check('unchanged_dependencies_and_schema',newm['source_sha']==SOURCE and all(newm[k]==oldm[k]for k in ['locks','migrations','schema_compatibility']))
 # The separately installed S05 checker contract changed after this Identity
 # baseline; this overlay neither installs nor consumes that runtime contract.
 excluded='contracts/runtime/store-check-v1.md'
 check('unchanged_identity_and_other_contracts',{k:v for k,v in newm['contracts'].items()if k!=excluded}=={k:v for k,v in oldm['contracts'].items()if k!=excluded})
 names=[n for n in oldm['files']if n.startswith('services/identity/')or n=='infra/launch.py']
 check('actual_current_identity_materialization',verify(old,{n:oldm['files'][n]for n in names}))
 check('only_three_identity_changes',set(n for n in newm['files']if n.startswith('services/identity/')or n=='infra/launch.py')==set(names)
       and all(newm['files'][n]==(FILES[n][1]if n in FILES else oldm['files'][n])for n in names))
 changes=set(FILES)|{'infra/launch.py'};operations=plan(old,'services/identity',changes)+plan(old,'infra',changes)
 budget=sum((((old/n).stat().st_size+8191)//4096*4096 if kind=='file'else 4096)for kind,n in operations)+131072
 check('physical_reserve_and_inode_budget',shutil.disk_usage('/').free>=FLOOR+budget+524288 and os.statvfs('/').f_favail>=200000)
 check('fresh_owned_release',not TARGET.exists()and not TARGET.is_symlink())
 TARGET.mkdir(mode=0o755);references={}
 for kind,n in operations:
  p=TARGET/n;p.parent.mkdir(parents=True,exist_ok=True)
  for parent in [p.parent,*p.parent.parents]:
   if parent==TARGET.parent:break
   parent.chmod(0o755)
  if kind=='directory':p.mkdir(exist_ok=True);p.chmod(0o755)
  elif kind=='reference':p.symlink_to(old/n);references[n]=str(old/n)
  else:fresh(p,values[n]if n in FILES else(old/n).read_bytes(),stat.S_IMODE((old/n).stat().st_mode))
 (TARGET/'.venv').symlink_to(old/'.venv')
 for n in FILES:
  if n.endswith('.py'):ast.parse((TARGET/n).read_text())
 manifest={k:oldm[k]for k in ['schema','locks','migrations','contracts','schema_compatibility']}
 manifest.update(artifact_id=TARGET.name,source_sha=SOURCE,overlay_base=str(old),base_manifest_sha256=sha((old/'manifest.json').read_bytes()),
  overlay_references=references,files={n:sha((TARGET/n).read_bytes())for n in names},links={},scope='IDENTITY_PYTHON_AND_LOGIN_TEMPLATE_ONLY_NO_MIGRATION')
 fresh(TARGET/'manifest.json',json.dumps(manifest,indent=2).encode(),0o644)
 check('prepared_overlay_matches_qualified_identity',verify(TARGET,{n:newm['files'][n]for n in names}))
 check('running_components_unchanged',snapshot()==before)
 fresh(D/'prepared.private.json',json.dumps({'before':before,'old':str(old),'files':manifest['files'],'manifest_sha256':sha((TARGET/'manifest.json').read_bytes())}).encode())
 check('reserve_after_prepare',shutil.disk_usage('/').free>=FLOOR+262144)
 record.update(status='PASS',phase='PREPARED_NOT_ACTIVATED',source_sha=SOURCE,identity_files=len(names),changed_product_files=3,physical_budget=budget,free_bytes=shutil.disk_usage('/').free)
def activate():
 p=json.loads((D/'prepared.private.json').read_text());before=p['before']
 check('prepared_components_and_bytes_still_current',snapshot()==before and sha((TARGET/'manifest.json').read_bytes())==p['manifest_sha256']and verify(TARGET,p['files']))
 check('activation_reserve',shutil.disk_usage('/').free>=FLOOR+262144)
 temp=B/'identity-current.direct-login';changed=False
 try:
  check('fresh_owned_pointer_temp',not temp.exists()and not temp.is_symlink());temp.symlink_to(TARGET);changed=True;os.replace(temp,B/'identity-current')
  command(['systemctl','restart',UNIT]);deadline=time.monotonic()+18
  while True:
   try:
    health=ready()
    if all(v.get('status')=='READY'for v in health.values())and health['18103'].get('release')==TARGET.name:break
   except OSError:pass
   if time.monotonic()>deadline:raise ValueError('IDENTITY_READINESS_TIMEOUT')
   time.sleep(.2)
  pid=command(['systemctl','show',UNIT,'-p','MainPID','--value'])
  check('actual_identity_process_uses_overlay',P('/proc/'+pid+'/cwd').resolve()==TARGET)
  after=snapshot()
  check('all_other_components_and_private_configuration_preserved',after['protected']==before['protected']and after['environment_hashes']==before['environment_hashes']
    and after['profile']==before['profile']and all(after['pointers'][n]==v for n,v in before['pointers'].items()if n!='identity-current'))
  check('mandatory_free_reserve',shutil.disk_usage('/').free>=FLOOR)
  record.update(status='PASS',phase='INSTALLED',source_sha=SOURCE,identity_release=TARGET.name,readiness={k:v.get('status')for k,v in health.items()},
   database_migrations=0,customer_database_mutations=0,marketplace_configuration_changes=0,owner_browser_flow='NOT_RUN',free_bytes=shutil.disk_usage('/').free)
 except BaseException:
  if changed and(B/'identity-current').resolve()==TARGET:
   rollback=B/'identity-current.direct-login-rollback';rollback.symlink_to(p['old']);os.replace(rollback,B/'identity-current')
   subprocess.run(['systemctl','restart',UNIT],capture_output=True,timeout=30)
  if temp.is_symlink()and temp.resolve()==TARGET:temp.unlink()
  record['recovery']='OWN_IDENTITY_POINTER_RESTORED_PREVIOUS_RELEASE_RETAINED';raise
if __name__=='__main__':
 def interrupted(*_):raise InterruptedError()
 signal.signal(signal.SIGTERM,interrupted);secure(D);phase=sys.argv[1]if len(sys.argv)==2 else'';check('allowed_phase',phase in {'prepare','activate'})
 out=D/(phase+'.json');check('fresh_receipt',not out.exists())
 with contextlib.ExitStack()as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:(prepare if phase=='prepare'else activate)()
  except BaseException as e:record['error_type']=type(e).__name__
  finally:fresh(out,json.dumps(record,indent=2).encode());print(json.dumps(record))
 sys.exit(0 if record['status']=='PASS'else 1)
