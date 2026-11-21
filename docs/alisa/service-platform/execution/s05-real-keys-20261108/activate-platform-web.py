"""Activate the exact checked web/API components; no migrations or private config edits."""
import contextlib,fcntl,hashlib,json,os,pathlib,re,shutil,signal,stat,subprocess,sys,time,urllib.error,urllib.request
sys.dont_write_bytecode=True;os.umask(0o077)
P=pathlib.Path;B=P('/opt/alisa-platform/stage');C=P('/etc/alisa-platform/stage');D=P('/var/lib/alisa-platform/stage/rollout-backups/s05-real-keys-20261108')
SOURCE='5dff6e8883e25ac464d6e8c64e4ab5a7280c70f7';R='alisa-'+SOURCE[:16];TARGET=B/'releases'/R
EXPECTED={'web-current':'alisa-7afaf646b9b35a58','site-current':'alisa-6098b31384ae23a4','identity-current':'alisa-7afaf646b9b35a58','admin-current':'alisa-73180172646b7012','current':'alisa-482ed11832b666af'}
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
COMPONENTS=[('site-current','alisa-platform@stage.service','platform',18102),('web-current','alisa-web@stage.service','web',18100)]
record={'scope':'OWN_WEB_AND_PLATFORM_POINTERS_RESTART_ONLY_NO_ENV_DB_MIGRATION_CORE_IDENTITY_ADMIN_CHANGES','status':'FAILED','cases':[]};changed=[]
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
def check(name,ok):
 record['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def command(args):return subprocess.check_output(args,text=True,timeout=25).strip()
def pointers():return {n:(B/n).resolve().name for n in EXPECTED}
def configs():return {n:sha((C/(n+'.env')).read_bytes()) for n in ['web','platform','identity','admin','platform-migration','identity-migration']}
def profile(unit):
 props=command(['systemctl','show',unit,'-p','User,Group,WorkingDirectory,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,TasksMax,TimeoutStopUSec,KillMode'])
 launch=re.findall(r'path=([^ ;}]+) ; argv\[\]=(.*?) ;',command(['systemctl','show',unit,'-p','ExecStart']))
 if len(launch)!=1:raise RuntimeError('Invalid launch profile')
 return sha(json.dumps({'properties':props,'launch':launch},sort_keys=True).encode())
def protected():return {u:command(['systemctl','show',u,'-p','MainPID,InvocationID,ActiveState']) for u in ['alice-market.service','alice-lab-web.service','alice-lab-worker.service','alice-lab-llm.service','alisa-identity@stage.service','alisa-admin@stage.service','alisa-store-check.service']}
def selected(n):return n=='infra/launch.py' or n.startswith(('ui/web/','services/platform/'))
def secure(path):
 for p in [*reversed(path.parents),path]:
  s=p.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_gid!=0 or s.st_mode&0o022:raise RuntimeError('Untrusted directory chain')
def point(name,release):
 p=B/('.s05-real-keys-'+name)
 if p.exists() or p.is_symlink():raise RuntimeError('Previous temporary pointer retained')
 p.symlink_to(B/'releases'/release);os.replace(p,B/name)
def ready(port,release):
 deadline=time.monotonic()+20
 while time.monotonic()<deadline:
  try:
   with opener.open('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as r:d=json.load(r)
   if d.get('status')=='READY' and d.get('release')==release:return True
  except OSError:pass
  time.sleep(.2)
 return False
def request(path,data=None):
 raw=None if data is None else json.dumps(data).encode()
 headers={} if raw is None else {'Content-Type':'application/json','Origin':'https://alisa.octoport.ru'}
 try:r=opener.open(urllib.request.Request('https://alisa.octoport.ru'+path,data=raw,headers=headers),timeout=5)
 except urllib.error.HTTPError as e:r=e
 with r:return r.status,r.read(131072),r.headers.get('Location')
def main():
 secure(B/'releases');secure(D);secure(TARGET)
 check('private_namespace',stat.S_IMODE(D.stat().st_mode)==0o700)
 installed=json.loads((D/'install-platform-web.json').read_text())
 check('exact_successful_install',installed['status']=='PASS' and installed['source_sha']==SOURCE and installed['manifest_sha256']=='74fc1baa3513550ad463b69984bf5a239e0f58294126cbab9b155cf700afcbc8')
 manifest=json.loads((TARGET/'manifest.json').read_text())
 check('exact_manifest',sha((TARGET/'manifest.json').read_bytes())==installed['manifest_sha256'] and manifest['source_sha']==SOURCE)
 check('exact_selected_payload',all(sha((TARGET/n).read_bytes())==h for n,h in manifest['files'].items() if selected(n)) and all((TARGET/n).is_symlink() and os.readlink(TARGET/n)==v for n,v in manifest['links'].items() if selected(n)))
 check('expected_current_pointers',pointers()==EXPECTED)
 record['before_pointers']=pointers();before_config=configs();before_protected=protected();profiles={u:profile(u) for _,u,_,_ in COMPONENTS}
 check('private_config_metadata',all((C/(n+'.env')).stat().st_uid==0 and stat.S_IMODE((C/(n+'.env')).stat().st_mode)==0o600 for n in before_config))
 for name,unit,component,port in COMPONENTS:
  launch=command(['systemctl','show',unit,'-p','ExecStart,WorkingDirectory'])
  check(component+'_fixed_pointer_launcher',('argv[]='+str(B/name/'.venv/bin/python')+' '+str(B/name/'infra/launch.py')+' '+component+' ;') in launch and ('WorkingDirectory='+str(B/name)) in launch)
  check(component+'_ready_before',ready(port,EXPECTED[name]))
  changed.append(name);point(name,R);command(['systemctl','restart',unit])
  check(component+'_ready_after',ready(port,R))
  pid=int(command(['systemctl','show',unit,'--value','-p','MainPID']))
  check(component+'_actual_process_directory',P('/proc',str(pid),'cwd').resolve()==(TARGET/'ui/web/apps/web' if component=='web' else TARGET))
  check(component+'_service_profile_preserved',profile(unit)==profiles[unit])
 check('other_pointers_preserved',all(pointers()[n]==value for n,value in EXPECTED.items() if n not in changed))
 check('private_configs_and_other_services_preserved',configs()==before_config and protected()==before_protected)
 status,body,_=request('/api/account/stores');check('anonymous_store_list_requires_login',status==401 and json.loads(body)=={'code':'AUTHENTICATION_REQUIRED'})
 status,body,_=request('/api/account/stores',{'action':'create','command_id':str(__import__('uuid').uuid4()),'provider':'WB','name':'anonymous-must-not-create','voice_alias':'','credential':{'token':'anonymous-fixture-must-not-dispatch'}})
 check('anonymous_store_write_requires_login',status==401 and json.loads(body)=={'code':'AUTHENTICATION_REQUIRED'})
 status,_,where=request('/app/stores');check('store_page_requires_login',status==307 and where=='/login')
 status,body,_=request('/health/ready');check('public_https_exact_new_web',status==200 and json.loads(body).get('release')==R)
 status,body,_=request('/login');check('password_login_is_preserved',status==200 and 'пароль' in body.decode().lower())
 check('disk_reserve',shutil.disk_usage(B).free>=3072*1048576 and os.statvfs(B).f_favail>=200000)
 record.update(status='PASS',active_pointers=pointers(),source_sha=SOURCE,owner_session_used=False,live_customer_store_changed_by_script=False)
def recover():
 results=[]
 for name,unit,component,port in reversed(COMPONENTS):
  if name not in changed:continue
  if pointers()[name]!=R:results.append({'component':component,'result':'EXTERNAL_POINTER_PRESERVED'});continue
  point(name,EXPECTED[name]);command(['systemctl','restart',unit]);results.append({'component':component,'restored_ready':ready(port,EXPECTED[name])})
 return results
if __name__=='__main__':
 def interrupted(*_):raise InterruptedError('Bounded activation interrupted')
 signal.signal(signal.SIGTERM,interrupted)
 out=D/'activate-platform-web.json'
 if out.exists() or out.is_symlink():raise SystemExit('Previous outcome retained')
 with contextlib.ExitStack() as stack:
  for name in LOCKS:
   f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as e:
   record['error_type']=type(e).__name__
   try:record['recovery']=recover()
   except Exception as recovery:record['recovery_error_type']=type(recovery).__name__
  finally:
   with out.open('x') as f:json.dump(record,f,indent=2)
   out.chmod(0o600);print(json.dumps(record))
 sys.exit(0 if record['status']=='PASS' else 1)
