"""Exact checker-only overlay; reuse the core's physical shared HTTP primitive."""
import contextlib,fcntl,hashlib,io,json,os,pathlib,re,shutil,signal,stat,subprocess,sys,tarfile,urllib.request,uuid,zipfile
sys.dont_write_bytecode=True;os.umask(0o077)
P=pathlib.Path;D=P('/var/lib/alisa-platform/stage/rollout-backups/s05-real-keys-20261108');B=P('/opt/alisa-platform/stage')
SOURCE='5dff6e8883e25ac464d6e8c64e4ab5a7280c70f7';R='alisa-'+SOURCE[:16]
CORE=P('/opt/alice-market/releases/20261106-store-check-6098-r1');ROOT=P('/opt/alice-market/checker-releases');TARGET=ROOT/('rt-check-'+SOURCE[:16])
DROP=P('/etc/systemd/system/alisa-store-check.service.d/s05-seller-qualified.conf');UNIT='alisa-store-check.service'
SUFFIX=' --socket /run/alice-market/store-check.sock --allowed-uid 993 --environment stage --enable-kind WB --enable-kind SELLER --enable-kind PERFORMANCE --seller-binding-qualified'
def override(folder):return ('[Service]\nExecStart=\nExecStart=/usr/bin/python3 -B '+str(folder)+'/store_check_ipc.py'+SUFFIX+'\n').encode()
OLD=override(CORE);NEW=override(TARGET)
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
record={'scope':'CHECKER_OVERLAY_ONLY_SINGLE_PHYSICAL_HTTP_NO_DB_CONFIG_IMPORT_CORE_RESTART','status':'FAILED','cases':[]};changed=False
def check(name,ok):
 record['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def command(args):return subprocess.check_output(args,text=True,timeout=25).strip()
def secure(path):
 for p in [*reversed(path.parents),path]:
  s=p.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=s.st_gid or s.st_uid!=0 or s.st_mode&0o022:raise RuntimeError('Untrusted directory chain')
def pointers():return {n:(B/n).resolve().name for n in ['web-current','site-current','identity-current','admin-current','current']}
def protected():return {u:command(['systemctl','show',u,'-p','MainPID,InvocationID,ActiveState']) for u in ['alice-market.service','alisa-platform@stage.service','alisa-web@stage.service','alisa-identity@stage.service','alisa-admin@stage.service']}
def configs():return {n:sha((P('/etc/alisa-platform/stage')/(n+'.env')).read_bytes()) for n in ['web','platform','identity','admin','platform-migration','identity-migration']}
def profile():
 pre=command(['systemctl','show',UNIT,'-p','ExecStartPre'])
 check('pinned_root_prestart',('argv[]=/usr/bin/python3 -B '+str(CORE)+'/store-check-permissions.py ;') in pre and sha((CORE/'store-check-permissions.py').read_bytes())=='e63b20c9079a986120b90daa4dac5edf2ced63516be3f6bb577fd653b7b96905')
 return command(['systemctl','show',UNIT,'-p','User,Group,WorkingDirectory,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,MemorySwapMax,TasksMax,TimeoutStopUSec,KillMode,RestrictAddressFamilies,PrivateTmp'])
def private_json(name):
 p=D/name;s=p.lstat();check('private_'+name,stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600)
 return json.loads(p.read_text())
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None
def point(raw):
 temp=DROP.with_name('s05-checker-overlay.conf.tmp')
 with temp.open('xb') as f:f.write(raw)
 temp.chmod(0o644);os.replace(temp,DROP)
CHILD="""import sys,json
sys.path.insert(0,'/opt/alisa-platform/stage/site-current/services/platform/src')
from alisa_platform.runtime_adapter.store_check import check_store
v=json.load(sys.stdin);r=check_store(v['pins'],v['credential']);out={'code':r['code']}
if r['code']=='CONNECTED':out['identity_matches']=r['identity']==v['expected_identity'] if v['pins']['kind']=='SELLER' else r['identity'].startswith('wb:sid:')
print(json.dumps(out))
"""
def live_ipc():
 env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1','DJANGO_SETTINGS_MODULE':'alisa_platform.config.settings'}
 for line in P('/etc/alisa-platform/stage/platform.env').read_text().splitlines():
  if line and not line.startswith('#'):
   k,sep,v=line.partition('=')
   if not sep:raise ValueError()
   env[k]=v
 oz=json.loads(P('/etc/alice-lab/marketplaces/ozon.json').read_text());wb=json.loads(P('/etc/alice-lab/marketplaces/wb.json').read_text())
 seller={'client_id':str(oz['seller_client_id']),'api_key':oz['seller_api_key']}
 cases=[('seller_actual','SELLER',seller,'CONNECTED'),('seller_wrong_client','SELLER',{**seller,'client_id':str(int(seller['client_id'])+1)},'AUTH_DENIED'),('seller_wrong_key','SELLER',{**seller,'api_key':str(uuid.uuid4())},'AUTH_DENIED'),('performance_actual','PERFORMANCE',{'client_id':oz['performance_client_id'],'client_secret':oz['performance_client_secret']},'AUTHENTICATED_UNLINKED'),('wb_actual','WB',{'token':wb['seller_token']},'CONNECTED')]
 results=[]
 for name,kind,credential,expected in cases:
  pins={'environment':'stage','product_id':'alisa_market','tenant_id':str(uuid.uuid4()),'store_id':str(uuid.uuid4()),'request_id':str(uuid.uuid4()),'provider':'WB' if kind=='WB' else 'OZON','kind':kind,'credential_revision':1,'store_revision':1}
  payload={'pins':pins,'credential':credential,'expected_identity':'ozon:client:'+str(int(seller['client_id']))}
  p=subprocess.run([str(B/'site-current/.venv/bin/python'),'-I','-B','-c',CHILD],env=env,input=json.dumps(payload),capture_output=True,text=True,timeout=8,user=993,group=985,extra_groups=[982],cwd=CORE)
  check(name+'_child_completed',p.returncode==0)
  result=json.loads(p.stdout);check(name+'_installed_adapter_socket_real_provider',result['code']==expected and (expected!='CONNECTED' or result.get('identity_matches') is True));results.append({'case':name,**result})
 record['real_installed_ipc']=results
def main():
 global changed
 secure(D);secure(CORE);secure(ROOT.parent);secure(DROP.parent)
 check('private_namespace',stat.S_IMODE(D.stat().st_mode)==0o700)
 check('expected_new_platform_and_web_active',pointers()['site-current']==pointers()['web-current']==R)
 check('own_qualified_dropin_exact',DROP.is_file() and not DROP.is_symlink() and DROP.stat().st_uid==0 and not DROP.stat().st_mode&0o022 and DROP.read_bytes()==OLD)
 check('checker_launch_still_original',('argv[]=/usr/bin/python3 -B '+str(CORE)+'/store_check_ipc.py'+SUFFIX+' ;') in command(['systemctl','show',UNIT,'-p','ExecStart']))
 before_services=protected();before_pointers=pointers();before_configs=configs();before_profile=profile()
 pins=private_json('package-binding.json')['packages']['runtime'];incoming=private_json('runtime-input.private.json')
 url=__import__('urllib.parse',fromlist=['urlsplit']).urlsplit(incoming['download_url'])
 check('fixed_https_artifact_transport',url.scheme=='https' and url.hostname.endswith('.oaiusercontent.com') and url.port in {None,443} and not url.username and not url.password)
 check('bounded_runtime_artifact',0<pins['zip_size']<1048576 and 0<pins['tar_size']<1048576)
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 with opener.open(incoming['download_url'],timeout=15) as r:raw=r.read(pins['zip_size']+1)
 check('exact_ci_zip',len(raw)==pins['zip_size'] and sha(raw)==pins['zip_sha256'])
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  name=TARGET.name+'.tar.gz';check('exact_bounded_zip_members',set(z.namelist())=={name,name+'.sha256'} and len(z.infolist())==2 and z.getinfo(name).file_size==pins['tar_size'] and z.getinfo(name+'.sha256').file_size<256)
  data=z.read(name);check('exact_sidecar',z.read(name+'.sha256').decode().split()[0]==pins['tar_sha256'])
 check('exact_runtime_tar',len(data)==pins['tar_size'] and sha(data)==pins['tar_sha256'])
 check('new_overlay_and_resource_reserve',not TARGET.exists() and not TARGET.is_symlink() and shutil.disk_usage(CORE).free>=3072*1048576+1048576 and os.statvfs(CORE).f_favail>=200000)
 with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as t:
  members=t.getmembers();check('bounded_unique_regular_source_paths',len(members)==8 and len({m.name for m in members})==8 and all(m.isfile() and len(P(m.name).parts)==2 and P(m.name).parts[0]==TARGET.name and '..' not in P(m.name).parts for m in members))
  manifest_raw=t.extractfile(TARGET.name+'/manifest.json').read();manifest=json.loads(manifest_raw)
  check('exact_source_manifest',sha(manifest_raw)==pins['manifest_sha256'] and manifest['source_sha']==SOURCE and manifest['schema_version']=='rt_check_package_v1')
  payload={P(m.name).name:t.extractfile(m).read() for m in members if P(m.name).name!='manifest.json'}
  check('all_payload_hashes',{n:sha(raw) for n,raw in payload.items()}==manifest['files'])
  check('physical_core_transport_identical',sha((CORE/'shared_http.py').read_bytes())==manifest['files']['shared_http.py']=='da3ecbb2ceb2671adda1fd8a4cab7ea4331eb1cd43b0b6a1f70dc9cb12ec34cb')
  if not ROOT.exists():ROOT.mkdir(mode=0o700);ROOT.chmod(0o755)
  secure(ROOT);check('release_parent_traversable',stat.S_IMODE(ROOT.stat().st_mode)==0o755)
  TARGET.mkdir(mode=0o700);TARGET.chmod(0o755)
  for name,raw in {**payload,'manifest.json':manifest_raw}.items():
   if name=='shared_http.py':continue
   with (TARGET/name).open('xb') as f:f.write(raw)
   (TARGET/name).chmod(0o644)
  (TARGET/'shared_http.py').symlink_to(CORE/'shared_http.py')
 check('overlay_exact_bytes_and_single_physical_transport',all(sha((TARGET/n).read_bytes())==h for n,h in manifest['files'].items()) and (TARGET/'shared_http.py').resolve()==(CORE/'shared_http.py').resolve())
 readable="import sys,pathlib;sys.path.insert(0,"+repr(str(TARGET))+");import store_check_ipc,store_check_worker;pathlib.Path("+repr(str(TARGET/'manifest.json'))+").read_bytes();print('SOURCE_READABLE')"
 inspected=subprocess.run(['/usr/bin/python3','-I','-B','-c',readable],env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},cwd=CORE,user=996,group=982,extra_groups=[],capture_output=True,text=True,timeout=5)
 check('exact_checker_source_imports_as_actual_uid',inspected.returncode==0 and inspected.stdout.strip()=='SOURCE_READABLE' and stat.S_IMODE(TARGET.stat().st_mode)==0o755)
 with (D/'checker-overlay-prepared.json').open('x') as f:json.dump({'source_sha':SOURCE,'manifest_sha256':pins['manifest_sha256'],'status':'PREPARED','shared_http_materialization':'SYMLINK_TO_SAME_PINNED_PHYSICAL_CORE_FILE'},f)
 with (D/'checker-qualified-before.conf').open('xb') as f:f.write(OLD)
 changed=True;point(NEW);command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT])
 check('checker_active',command(['systemctl','is-active',UNIT])=='active')
 check('new_exact_launch',('argv[]=/usr/bin/python3 -B '+str(TARGET)+'/store_check_ipc.py'+SUFFIX+' ;') in command(['systemctl','show',UNIT,'-p','ExecStart']))
 check('same_service_sandbox_uid_limits',profile()==before_profile)
 live_ipc()
 check('core_and_other_services_configs_pointers_preserved',protected()==before_services and pointers()==before_pointers and configs()==before_configs)
 check('disk_reserve_retained',shutil.disk_usage(CORE).free>=3072*1048576)
 record.update(status='PASS',source_sha=SOURCE,shared_http_single_physical_file=True,customer_database_changed=False)
if __name__=='__main__':
 def interrupted(*_):raise InterruptedError('Bounded activation interrupted')
 signal.signal(signal.SIGTERM,interrupted)
 out=D/'install-checker-overlay.json'
 if out.exists() or out.is_symlink():raise SystemExit('Previous outcome retained')
 with contextlib.ExitStack() as stack:
  for name in LOCKS:
   f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as e:
   record['error_type']=type(e).__name__
   if changed and DROP.read_bytes()==NEW:
    point(OLD);command(['systemctl','daemon-reload']);command(['systemctl','restart',UNIT]);record['recovery']='OWN_QUALIFIED_CHECKER_LAUNCH_RESTORED'
  finally:
   with out.open('x') as f:json.dump(record,f,indent=2)
   out.chmod(0o600);print(json.dumps(record))
 sys.exit(0 if record['status']=='PASS' else 1)
