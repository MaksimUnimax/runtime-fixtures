"""Exact reviewed CI overlay. No OAuth, DB writes, native-core/web/identity/admin restart."""
import ast,base64,contextlib,fcntl,gzip,hashlib,json,os,pathlib,pwd,grp,secrets,shutil,signal,stat,subprocess,sys,time,uuid,urllib.request
P=pathlib.Path;sys.dont_write_bytecode=True;os.umask(0o077)
SOURCE='8e1a695d71f1004b03564570b880a915efdb539e'
D=P('/var/lib/alisa-platform/stage/rollout-backups/s05-native-pair-20261108')
B=P('/opt/alisa-platform/stage');API=B/'releases'/('alisa-native-pair-'+SOURCE[:16])
CHECKER=P('/opt/alice-market/checker-releases')/('native-pair-'+SOURCE[:16])
BIND=P('/etc/alisa-store-check/native-pair')
DROP=P('/etc/systemd/system/alisa-store-check.service.d/zzzzzz-native-pair-20261108.conf')
UNIT='alisa-store-check.service';APIUNIT='alisa-platform@stage.service';FLOOR=3072*1048576
FILES={'store_checker.py':'a9b8abe8ac37d43c35eae19ab9b3114feaf158b72e80e7485d982add9cfc77a1',
 'native_store_binding.py':'30664db61e047927c9dafd2b16fd70d3d1ba662ee3ea59ce539d4e1e32045347',
 'service.py':'af1f1db37d3aa36951af59a0657ae4766b0c471812fd2567d29485bdaf355dc1',
 'adapter.py':'5739007ed991ada634cf4c498de3310db807ca2a004ebb5d45c0db75d379f8d8'}
OLD_SERVICE='61d0c2174403ddf032666a09667469f681b63d9c3d3f36c49065a87264d69a2b'
OLD_ADAPTER='0f6e63e26a3c2c871122da920363f41d6d0caf56e839dc5947ffa87c8fe98200'
SERVICE='services/platform/src/alisa_platform/stores/service.py'
ADAPTER='services/platform/src/alisa_platform/runtime_adapter/store_check.py'
PROFILE='User,Group,NoNewPrivileges,ProtectSystem,ProtectHome,MemoryMax,MemorySwapMax,TasksMax,TimeoutStopUSec,KillMode,RestrictAddressFamilies,ReadWritePaths'
PROTECTED=['alice-market.service','alice-lab-worker.service','alisa-web@stage.service','alisa-identity@stage.service','alisa-admin@stage.service']
record={'scope':'EXISTING_NATIVE_PAIR_CHECKER_AND_TWO_API_FILES_ONLY','status':'FAILED','cases':[]}
def check(name,ok):
 record['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def sha(b):return hashlib.sha256(b).hexdigest()
def command(args,timeout=20):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=timeout).stdout.strip()
def secure(path):
 for p in [*reversed(path.parents),path]:
  s=p.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise RuntimeError('UNTRUSTED_DIRECTORY')
def fresh(path,body,mode=0o600):
 with path.open('xb') as f:f.write(body);f.flush();os.fsync(f.fileno())
 path.chmod(mode)
def mkdir(path,mode=0o755):path.mkdir(parents=True,exist_ok=False);path.chmod(mode)
def sparse_plan(source,relative,changes):
 if relative in changes:return [('file',relative)]
 if not any(n.startswith(relative+'/') for n in changes):return [('reference',relative)]
 result=[('directory',relative)]
 for p in sorted((source/relative).iterdir()):
  if p.name=='__pycache__':continue
  result+=sparse_plan(source,str(P(relative)/p.name),changes)
 return result
def snapshot():
 return {'pointers':{n:os.readlink(B/n) for n in ['web-current','site-current','identity-current','admin-current','current']},
  'protected':{u:command(['systemctl','show',u,'-p','MainPID,InvocationID,ActiveState']) for u in PROTECTED},
  'env_hashes':{n:sha((P('/etc/alisa-platform/stage')/(n+'.env')).read_bytes()) for n in ['web','platform','identity','admin','platform-migration','identity-migration']},
  'checker_launch':command(['systemctl','show',UNIT,'-p','MainPID,InvocationID,WorkingDirectory,ExecStart']),
  'api_launch':command(['systemctl','show',APIUNIT,'-p','MainPID,InvocationID,WorkingDirectory,ExecStart,User,Group,SupplementaryGroups']),
  'checker_profile':command(['systemctl','show',UNIT,'-p',PROFILE]),
  'checker_inaccessible':command(['systemctl','show',UNIT,'-p','InaccessiblePaths','--value'])}
def ready():
 op=urllib.request.build_opener(urllib.request.ProxyHandler({}));out={}
 for port in [18100,18101,18102,18103]:
  with op.open('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as r:out[str(port)]=json.loads(r.read(32768)).get('status')=='READY'
 return out
def appenv():
 pid=command(['systemctl','show',APIUNIT,'-p','MainPID','--value'])
 e=dict(x.split('=',1) for x in P('/proc/'+pid+'/environ').read_bytes().decode().split('\0') if '=' in x)
 e['PYTHONDONTWRITEBYTECODE']='1';return e
def child(code,*,base,env,packet=None,identity=None):
 args=[str(base/'.venv/bin/python'),'-I','-B','-c',code]
 options={'env':env,'cwd':base,'capture_output':True,'text':True,'timeout':20}
 if identity:options.update(user=identity[0],group=identity[1],extra_groups=identity[2])
 p=subprocess.run(args,input=json.dumps(packet) if packet is not None else None,**options)
 check('bounded_private_child',p.returncode==0)
 return json.loads(p.stdout)
MAKE_PROJECTION=r'''import sys,os,json,hmac,secrets,uuid
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'services/platform/src'))
sys.path.insert(0,'/opt/alice-market/checker-releases/native-pair-8e1a695d71f1004b')
os.environ['DJANGO_SETTINGS_MODULE']='alisa_platform.config.settings'
import django;django.setup()
from django.conf import settings
from django.db import transaction,connection
from alisa_platform.stores.models import Store,CredentialRevision
from alisa_platform.stores import vault
from native_store_binding import native_context,mac,canonical,process_generation
config=json.loads(Path('/etc/alice-market/market-runtime.json').read_text())
material=json.loads(Path('/run/credentials/alice-market.service/ozon').read_text())
expected={'SELLER':{'client_id':str(material['seller_client_id']),'api_key':material['seller_api_key']},'PERFORMANCE':{'client_id':material['performance_client_id'],'client_secret':material['performance_client_secret']}}
identity='ozon:client:'+str(int(material['seller_client_id']))
source=[(a,s)for a,c in config['accounts'].items()if c.get('active')is True for s in c['stores']if s.get('platform')=='ozon'and config['credential_bindings'].get(s['id'])=='ozon']
if len(source)!=1:raise ValueError()
matches=[]
with transaction.atomic():
 with connection.cursor()as c:c.execute('SET TRANSACTION READ ONLY')
 for s in Store.objects.filter(provider='OZON',verified_identity=identity,status='ACTIVE')[:20]:
  pair={}
  for kind in ['SELLER','PERFORMANCE']:
   for r in CredentialRevision.objects.filter(store=s,tenant_id=s.tenant_id,kind=kind,status__in=['ACTIVE','PENDING']).select_related('secret').order_by('-revision')[:3]:
    if kind=='SELLER'and(r.status!='ACTIVE'or r.check_code!='CONNECTED'):continue
    if hmac.compare_digest(canonical(vault.open_secret(s,r,r.secret)),canonical(expected[kind])):pair[kind]=r;break
  if len(pair)==2:matches.append((s,pair['PERFORMANCE']))
if len(matches)!=1:raise ValueError()
s,r=matches[0];key=secrets.token_bytes(32)
import subprocess
pid=int(subprocess.check_output(['systemctl','show','alice-market.service','-p','MainPID','--value'],text=True))
generation=process_generation(pid)
row={'tenant_id':str(s.tenant_id),'store_id':str(s.pk),'native_account':source[0][0],'native_store':source[0][1]['id'],'credential_name':'ozon','identity':identity,'source_hmac':'pending'}
row['source_hmac']=mac(key,'native-owner-source-v1',native_context(config,material,row,environment=settings.ALISA_ENV,product_id='alisa_market',generation=generation))
projection={'schema_version':'native_owner_store_binding_v1','environment':settings.ALISA_ENV,'product_id':'alisa_market','mac_key':key.hex(),'native_generation':generation,'bindings':[row]}
pins={'environment':settings.ALISA_ENV,'product_id':'alisa_market','tenant_id':str(s.tenant_id),'store_id':str(s.pk),'request_id':str(uuid.uuid4()),'provider':'OZON','kind':'PERFORMANCE','credential_revision':r.revision,'store_revision':s.revision}
print(json.dumps({'projection':projection,'pins':pins}))'''
def prepare():
 before=snapshot();check('existing_services_ready',all(ready().values()))
 check('api_launch_follows_site_pointer',str(B/'site-current/infra/launch.py') in before['api_launch'])
 secure(B/'releases');secure(CHECKER.parent)
 oldapi=(B/'site-current').resolve();oldchecker=P(command(['systemctl','show',UNIT,'-p','WorkingDirectory','--value']))
 check('expected_unmodified_sources',sha((oldapi/SERVICE).read_bytes())==OLD_SERVICE and sha((oldapi/ADAPTER).read_bytes())==OLD_ADAPTER and sha((oldchecker/'store_checker.py').read_bytes())=='ce6973646121160fb6f3a428d4577c119037ef650ca618805eb44f74772cc5d1')
 with gzip.open(D/'payload.json.gz','rb') as f:raw=f.read(131073)
 check('bounded_compressed_source_payload',len(raw)<=131072)
 payload=json.loads(raw);check('exact_successful_ci',payload['source_sha']==SOURCE and payload['platform_ci']==42461710315 and payload['documentation_ci']==42461710338 and payload['ci_conclusion']=='success')
 files={n:base64.b64decode(payload['files'][n]) for n in FILES}
 check('all_four_ci_file_hashes',all(sha(files[n])==h for n,h in FILES.items()))
 oldmanifest=json.loads((oldapi/'manifest.json').read_text())
 names=[n for n in oldmanifest['files'] if n.startswith('services/platform/') or n=='infra/launch.py']
 check('exact_materialized_platform',all(sha((oldapi/n).read_bytes())==oldmanifest['files'][n] for n in names))
 changes={SERVICE,ADAPTER,'infra/launch.py'}
 plan=sparse_plan(oldapi,'services/platform',changes)+sparse_plan(oldapi,'infra',changes)
 # Existing immutable code/dependencies are referenced; only three API files
 # are copied. No active inode is hardlinked or modified.
 budget=sum((((oldapi/n).stat().st_size+8191)//4096*4096 if kind=='file' else 4096)for kind,n in plan)+196608
 check('physical_overlay_budget',shutil.disk_usage(B).free>=FLOOR+budget+1048576 and os.statvfs(B).f_favail>=200000)
 check('fresh_owned_namespaces',not API.exists() and not CHECKER.exists() and not BIND.exists() and not DROP.exists())
 mkdir(CHECKER)
 checker_before={}
 for p in oldchecker.iterdir():
  if p.suffix!='.py':continue
  checker_before[p.name]=sha(p.read_bytes())
  if p.is_symlink():(CHECKER/p.name).symlink_to(os.readlink(p))
  else:fresh(CHECKER/p.name,p.read_bytes(),0o644)
 for n in ['store_checker.py','native_store_binding.py']:
  p=CHECKER/n
  if p.exists()or p.is_symlink():p.unlink()
  fresh(p,files[n],0o644)
 mkdir(API)
 references={}
 for kind,n in plan:
  p=API/n
  p.parent.mkdir(parents=True,exist_ok=True)
  for directory in [p.parent,*p.parent.parents]:
   if directory==API.parent:break
   directory.chmod(0o755)
  if kind=='directory':p.mkdir(exist_ok=True);p.chmod(0o755)
  elif kind=='reference':p.symlink_to(oldapi/n);references[n]=str(oldapi/n)
  else:fresh(p,(oldapi/n).read_bytes(),stat.S_IMODE((oldapi/n).stat().st_mode))
 (API/'.venv').symlink_to(oldapi/'.venv')
 (API/SERVICE).write_bytes(files['service.py'])
 adapter=(oldapi/ADAPTER).read_text();needle="            if set(result) != {'code', 'identity', 'capabilities'}:\n                raise ValueError()"
 new="            fields = {'code', 'identity', 'capabilities'}\n            if 'identity_provenance' in result:\n                if pins['kind'] != 'PERFORMANCE' or result['identity_provenance'] != 'NATIVE_OWNER_CONFIGURED_PAIR':\n                    raise ValueError()\n                fields.add('identity_provenance')\n            if set(result) != fields:\n                raise ValueError()"
 check('single_declared_adapter_patch',adapter.count(needle)==1)
 (API/ADAPTER).write_text(adapter.replace(needle,new))
 check('foreign_catalog_preserved','catalog_cursor=None' in (API/ADAPTER).read_text())
 for n in [SERVICE,ADAPTER]:ast.parse((API/n).read_text())
 manifest={k:oldmanifest[k]for k in ['contracts','locks','migrations','schema_compatibility'] if k in oldmanifest}
 manifest.update(schema=1,artifact_id=API.name,source_sha=SOURCE,overlay_base=str(oldapi),base_manifest_sha256=sha((oldapi/'manifest.json').read_bytes()),files={n:sha((API/n).read_bytes()) for n in names},overlay_references=references,links={},scope='PLATFORM_PYTHON_ONLY_PRESERVE_CURRENT_CATALOG_NO_MIGRATION')
 fresh(API/'manifest.json',json.dumps(manifest,indent=2).encode(),0o644)
 values=child(MAKE_PROJECTION,base=API,env=appenv())
 BIND.parent.mkdir(exist_ok=True);secure(BIND.parent);mkdir(BIND,0o750)
 os.chown(BIND,0,grp.getgrnam('alisa-store-check').gr_gid)
 fresh(BIND/'scope.json',json.dumps(values['projection']).encode(),0o640);os.chown(BIND/'scope.json',0,grp.getgrnam('alisa-store-check').gr_gid)
 fresh(D/'pins.private.json',json.dumps(values['pins']).encode())
 check('prepare_preserves_running_components',snapshot()==before)
 prepared={'before':before,'oldapi':str(oldapi),'oldchecker':str(oldchecker),'checker_before':checker_before,'launch_before':command(['systemctl','show',UNIT,'-p','ExecStart','--value']),'source_sha':SOURCE,'budget':budget,'api_manifest_sha256':sha((API/'manifest.json').read_bytes()),'scope_sha256':sha((BIND/'scope.json').read_bytes())}
 fresh(D/'prepared.private.json',json.dumps(prepared).encode())
 check('post_prepare_reserve',shutil.disk_usage(B).free>=FLOOR+524288)
 record.update(status='PASS',phase='PREPARED_NOT_ACTIVATED',api_files=len(names),api_changed_files=3,api_referenced_bytes=sum((API/n).stat().st_size for n in names),physical_budget=budget,free_bytes=shutil.disk_usage(B).free)
PROBE=r'''import sys,json,os
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'services/platform/src'));os.environ['DJANGO_SETTINGS_MODULE']='alisa_platform.config.settings'
from alisa_platform.runtime_adapter.store_check import check_store
v=json.load(sys.stdin);r=check_store(v['pins'],v['credential'])
print(json.dumps({'code':r['code'],'identity_matches':r.get('identity')==v['identity'],'native_provenance':r.get('identity_provenance')=='NATIVE_OWNER_CONFIGURED_PAIR'}))'''
def activate():
 p=json.loads((D/'prepared.private.json').read_text());before=p['before']
 check('prepared_snapshot_still_current',snapshot()==before and sha((API/'manifest.json').read_bytes())==p['api_manifest_sha256'] and sha((BIND/'scope.json').read_bytes())==p['scope_sha256'])
 check('activation_reserve',shutil.disk_usage(B).free>=FLOOR+524288)
 launch=p['launch_before'];old=p['oldchecker']+'/store_check_ipc.py'
 check('expected_current_catalog_launch',old in launch and '--enable-catalog' in launch)
 # Preserve the exact active arguments, including another author's catalogue.
 argv=launch.split('argv[]=',1)[1].split(' ;',1)[0].replace(old,str(CHECKER/'store_check_ipc.py'),1)
 content='[Service]\nWorkingDirectory='+str(CHECKER)+'\nExecStart=\nExecStart='+argv+'\nSupplementaryGroups=alice-market\nBindReadOnlyPaths='+str(BIND)+':/run/alisa-native-binding/bindings\nBindReadOnlyPaths=/etc/alice-market:/run/alisa-native-binding/source\nBindReadOnlyPaths=/run/credentials/alice-market.service/ozon:/run/alisa-native-binding/credentials/ozon\nInaccessiblePaths=-/run/alisa-native-binding/source/market-runtime.before-enable.json\n'
 drop_inode=None;api_changed=False
 try:
  blocked=signal.pthread_sigmask(signal.SIG_BLOCK,{signal.SIGTERM,signal.SIGINT})
  try:
   fd=os.open(DROP,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
   st=os.fstat(fd);drop_inode=(st.st_dev,st.st_ino)
  finally:signal.pthread_sigmask(signal.SIG_SETMASK,blocked)
  with os.fdopen(fd,'wb') as f:f.write(content.encode());f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),0o644)
  command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT])
  check('checker_started',command(['systemctl','is-active',UNIT])=='active')
  current=snapshot();check('old_sandbox_preserved',current['checker_profile']==before['checker_profile'] and all(v in current['checker_inaccessible'].split() for v in before['checker_inaccessible'].split()))
  pins=json.loads((D/'pins.private.json').read_text());native=json.loads(P('/run/credentials/alice-market.service/ozon').read_text())
  packet={'pins':pins,'credential':{'client_id':native['performance_client_id'],'client_secret':native['performance_client_secret']},'identity':'ozon:client:'+str(int(native['seller_client_id']))}
  user=command(['systemctl','show',APIUNIT,'-p','User','--value']);group=command(['systemctl','show',APIUNIT,'-p','Group','--value'])
  extra=command(['systemctl','show',APIUNIT,'-p','SupplementaryGroups','--value']).split()
  identity=(pwd.getpwnam(user).pw_uid,grp.getgrnam(group).gr_gid,[grp.getgrnam(n).gr_gid for n in extra])
  check('actual_platform_peer_uid_retained','--allowed-uid '+str(identity[0]) in argv)
  result=child(PROBE,base=API,env=appenv(),packet=packet,identity=identity)
  check('real_owner_key_through_actual_peer_and_namespace',result=={'code':'CONNECTED','identity_matches':True,'native_provenance':True})
  record['real_owner_performance_ipc']=result
  temp=B/'site-current.native-pair';temp.symlink_to(API);api_changed=True;os.replace(temp,B/'site-current')
  command(['systemctl','restart',APIUNIT]);deadline=time.monotonic()+12
  while True:
   try:
    health=ready()
    if all(health.values()):break
   except Exception:pass
   if time.monotonic()>deadline:raise RuntimeError('READINESS_TIMEOUT')
   time.sleep(.2)
  api_pid=command(['systemctl','show',APIUNIT,'-p','MainPID','--value'])
  check('actual_api_process_uses_overlay',P('/proc/'+api_pid+'/cwd').resolve()==API)
  after=snapshot()
  check('all_other_services_and_configuration_preserved',after['protected']==before['protected'] and after['env_hashes']==before['env_hashes'] and all(after['pointers'][k]==v for k,v in before['pointers'].items() if k!='site-current'))
  check('foreign_checker_modules_preserved',all(sha((CHECKER/n).read_bytes())==h for n,h in p['checker_before'].items() if n!='store_checker.py'))
  check('mandatory_free_reserve',shutil.disk_usage(B).free>=FLOOR)
  record.update(status='PASS',phase='INSTALLED',source_sha=SOURCE,api_release=API.name,checker_release=CHECKER.name,readiness=health,customer_database_mutations=0,owner_browser_flow='NOT_RUN',free_bytes=shutil.disk_usage(B).free,
    checker_loaded_profile=command(['systemctl','show',UNIT,'-p',PROFILE+',BindReadOnlyPaths,InaccessiblePaths,SupplementaryGroups,MainPID,InvocationID']),api_invocation=command(['systemctl','show',APIUNIT,'-p','MainPID,InvocationID,ActiveState']))
 except BaseException:
  if api_changed and (B/'site-current').resolve()==API:
   temp=B/'site-current.native-pair-rollback';temp.symlink_to(p['oldapi']);os.replace(temp,B/'site-current');subprocess.run(['systemctl','restart',APIUNIT],capture_output=True,timeout=25)
  if drop_inode is not None and DROP.exists() and (DROP.lstat().st_dev,DROP.lstat().st_ino)==drop_inode:
   DROP.unlink();subprocess.run(['systemctl','daemon-reload'],capture_output=True,timeout=10);subprocess.run(['systemctl','restart',UNIT],capture_output=True,timeout=25)
  temp=B/'site-current.native-pair'
  if temp.is_symlink() and temp.resolve()==API:temp.unlink()
  record['recovery']='OWN_POINTER_AND_DROPIN_ROLLBACK_ATTEMPTED_OLD_RELEASES_RETAINED'
  raise
if __name__=='__main__':
 def interrupted(*_):raise InterruptedError('BOUNDED_INSTALL_INTERRUPTED')
 signal.signal(signal.SIGTERM,interrupted)
 secure(D);phase=sys.argv[1] if len(sys.argv)==2 else '';check('allowed_phase',phase in {'prepare','activate'})
 out=D/(phase+'.json');check('new_receipt',not out.exists())
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:(prepare if phase=='prepare' else activate)()
  except BaseException as e:record['error_type']=type(e).__name__
  finally:fresh(out,json.dumps(record,indent=2).encode());print(json.dumps(record))
 sys.exit(0 if record['status']=='PASS' else 1)
