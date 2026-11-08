"""Exact-CI web/identity component install and guarded activation; no DB/config edits."""
import contextlib,fcntl,hashlib,io,json,math,os,re,shutil,stat,subprocess,sys,signal,tarfile,time,urllib.error,urllib.parse,urllib.request,zipfile
from pathlib import Path as P
sys.dont_write_bytecode=True
os.umask(0o077)
B=P('/opt/alisa-platform/stage');C=P('/etc/alisa-platform/stage')
D=P('/var/lib/alisa-platform/stage/rollout-backups/auth-navigation-20261108')
RESERVE=3072*1048576
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
record={'status':'FAILED','scope':'CUSTOMER_SESSION_NAVIGATION_AND_STALE_NOTICES_WEB_IDENTITY_ONLY','cases':[]}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
def check(name,ok):
 record['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def filehash(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def command(args,**kwargs):return subprocess.run(args,check=True,capture_output=True,timeout=45,**kwargs).stdout.decode().strip()
def secure(path):
 for p in [*reversed(path.parents),path]:
  s=p.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_gid!=0 or s.st_mode&0o022:raise RuntimeError('untrusted_directory_chain')
def pointers():
 result={}
 for n in ['web-current','identity-current','site-current','admin-current','current']:
  p=B/n;s=p.lstat();target=p.resolve(strict=True)
  if not stat.S_ISLNK(s.st_mode) or s.st_uid!=0 or target.parent!=(B/'releases').resolve() or not re.fullmatch('alisa-[0-9a-f]{16}',target.name):raise RuntimeError('untrusted_component_pointer')
  result[n]=target.name
 return result
def selected(n):return n=='infra/launch.py' or n.startswith(('ui/web/','services/identity/')) or n in {'ui/web','services/identity'}
def virtual_target(name,links):
 # Resolve the ARCHIVE's complete link graph, not the nonexistent destination.
 todo=list(P(name).parts);out=[];expansions=0
 while todo:
  part=todo.pop(0)
  if part=='.':continue
  if part=='..':
   if not out:raise RuntimeError('archive_link_escape')
   out.pop();continue
  out.append(part);key='/'.join(out)
  if key in links:
   out.pop();expansions+=1
   if expansions>100 or P(links[key]).is_absolute():raise RuntimeError('archive_link_cycle_or_absolute')
   todo=list(P(links[key]).parts)+todo
 return '/'.join(out)
def private_json(name):
 p=D/name;s=p.lstat()
 check('private_'+name,stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600)
 return json.loads(p.read_text())
def cfg_hashes():return {n:filehash(C/(n+'.env')) for n in ['web','identity','admin','platform','identity-migration','platform-migration']}
def private_env(name):
 p=C/(name+'.env');s=p.lstat()
 check('private_config_'+name,stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600)
 values={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'}
 for line in p.read_text().splitlines():
  if not line or line.startswith('#'):continue
  key,sep,value=line.partition('=')
  if not sep or not re.fullmatch('[A-Z][A-Z0-9_]*',key):raise RuntimeError('invalid_private_config')
  values[key]=value
 return values
def profile(unit):
 properties=command(['systemctl','show',unit,'-p','WorkingDirectory,User,Group,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,TasksMax,TimeoutStopUSec,KillMode'])
 # ExecStart also contains volatile pid/start_time/exit fields. Compare its
 # configured executable and argv, exactly as the existing web rollout does.
 launch=command(['systemctl','show',unit,'-p','ExecStart'])
 matches=re.findall(r'path=([^ ;}]+) ; argv\[\]=(.*?) ;',launch)
 if len(matches)!=1:raise RuntimeError('invalid_effective_launch')
 return sha(json.dumps({'properties':properties,'executable':matches[0][0],'argv':matches[0][1]},sort_keys=True).encode())
def protected():
 units=['alice-market.service','alice-lab-web.service','alice-lab-worker.service','alice-lab-llm.service','alisa-platform@stage.service','alisa-admin@stage.service','alisa-store-check.service']
 return {u:command(['systemctl','show',u,'-p','MainPID,InvocationID,ActiveState']) for u in units}
def ready(port,release):
 deadline=time.monotonic()+20
 while time.monotonic()<deadline:
  try:
   with opener.open('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as r:d=json.load(r)
   if d.get('status')=='READY' and d.get('release')==release:return True
  except OSError:pass
  time.sleep(.25)
 return False
def point(name,release):
 p=B/('.auth-navigation-'+name)
 if p.exists() or p.is_symlink():raise RuntimeError('existing_pointer_temp')
 p.symlink_to(B/'releases'/release);os.replace(p,B/name)
def verify_component(target,manifest):
 actual={};links={}
 for p in target.rglob('*'):
  n=str(p.relative_to(target))
  if n=='.venv' or n.startswith('.venv/'):continue
  if p.is_symlink():links[n]=os.readlink(p)
  elif p.is_file() and n!='manifest.json':actual[n]=filehash(p)
 check('exact_selected_component_files',actual=={n:h for n,h in manifest['files'].items() if selected(n)})
 check('exact_selected_component_links',links=={n:v for n,v in manifest.get('links',{}).items() if selected(n)})
 check('materialized_links_stay_in_component',all((target/n).resolve(strict=True).is_relative_to((target/'ui/web').resolve()) for n in links))
def prepare(pins,target,release):
 check('fresh_inactive_target',not target.exists() and not target.is_symlink())
 incoming=private_json('artifact-input.private.json');u=urllib.parse.urlsplit(incoming['download_url'])
 check('fixed_https_artifact_transport',u.scheme=='https' and u.hostname.endswith('.oaiusercontent.com') and u.port in {None,443} and not u.username and not u.password)
 check('bounded_artifact',0<pins['zip_size']<=64*1048576 and 0<pins['tar_size']<=64*1048576)
 check('reserve_before_install',shutil.disk_usage(B).free>=RESERVE+64*1048576 and os.statvfs(B).f_favail>=220000)
 check('memory_reserve',next(int(l.split()[1]) for l in P('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))>=1536*1024)
 with opener.open(incoming['download_url'],timeout=40) as r:raw=r.read(pins['zip_size']+1)
 check('exact_ci_zip',len(raw)==pins['zip_size'] and sha(raw)==pins['zip_sha256'])
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  check('exact_zip_members',len(z.infolist())==2 and set(z.namelist())=={release+'.tar.gz',release+'.tar.gz.sha256'})
  check('bounded_zip_expansion',z.getinfo(release+'.tar.gz').file_size==pins['tar_size'] and z.getinfo(release+'.tar.gz.sha256').file_size<256)
  tarraw=z.read(release+'.tar.gz');check('checksum_sidecar',z.read(release+'.tar.gz.sha256').decode().split()[0]==pins['tar_sha256'])
 del raw
 check('exact_ci_tar',len(tarraw)==pins['tar_size'] and sha(tarraw)==pins['tar_sha256'])
 before=pointers();check('expected_baseline',before==pins['baseline'])
 old_identity=B/'identity-current';old_web=B/'web-current';old_platform=B/'site-current'
 identity=json.loads((old_identity/'manifest.json').read_text());web=json.loads((old_web/'manifest.json').read_text());platform=json.loads((old_platform/'manifest.json').read_text())
 with tarfile.open(fileobj=io.BytesIO(tarraw),mode='r:gz') as t:
  members=t.getmembers()
  check('bounded_safe_unique_paths',len(members)<=12000 and len({m.name for m in members})==len(members) and all(m.name==str(P(m.name)) and not P(m.name).is_absolute() and '..' not in P(m.name).parts and m.name.split('/')[0]==release and (m.isdir() or m.isfile() or m.issym()) for m in members))
  rawmanifest=t.extractfile(release+'/manifest.json').read();m=json.loads(rawmanifest)
  check('exact_manifest',sha(rawmanifest)==pins['manifest_sha256'] and m['source_sha']==pins['source_sha'] and m['artifact_id']==release and m['schema']==1)
  check('unchanged_contracts_schema_dependencies',m['contracts']==platform['contracts'] and m['migrations']==platform['migrations'] and m['locks']==web['locks'] and m['locks']['services/identity/requirements.lock']==identity['locks']['services/identity/requirements.lock'] and m['files']['infra/launch.py']==identity['files']['infra/launch.py']==web['files']['infra/launch.py'])
  allowed={'services/identity/src/octoport_identity/'+n for n in ['accounts/templates/identity/reauthenticate_code.html','protocol/views.py']}
  oldfiles={n:h for n,h in identity['files'].items() if n.startswith('services/identity/') and n not in allowed}
  check('installed_admin_identity_fixes_preserved',all(m['files'].get(n)==h for n,h in oldfiles.items()) and all(n in identity['files'] or n in allowed for n in m['files'] if n.startswith('services/identity/')))
  files={};links={};chosen=[];size=0
  for member in members:
   n=str(P(member.name).relative_to(release))
   if member.issym():links[n]=member.linkname
   elif member.isfile() and n!='manifest.json':
    with t.extractfile(member) as f:files[n]=hashlib.file_digest(f,'sha256').hexdigest()
   if selected(n):
    chosen.append((member,n))
    if member.isfile():size+=member.size
  check('complete_package_before_selection',files==m['files'] and links==m['links'])
  check('no_archive_symlink_ancestors',all(not any(str(parent) in links for parent in P(str(P(member.name).relative_to(release))).parents) for member in members))
  check('archive_link_graph_stays_internal',all(virtual_target(n,links) and (not selected(n) or virtual_target(n,links).startswith('ui/web/')) for n in links))
  check('physical_payload_reserve',shutil.disk_usage(B).free>=RESERVE+math.ceil(size*1.2)+16*1048576)
  oldmask=os.umask(0o022)
  linked=0;written=0
  try:
   target.mkdir(mode=0o755)
   for member,n in chosen:
    p=target/n
    if member.isdir():p.mkdir(parents=True,exist_ok=True);continue
    p.parent.mkdir(parents=True,exist_ok=True)
    if member.issym():p.symlink_to(member.linkname);continue
    prior=old_web if n.startswith('ui/web/') else old_identity
    previous=prior/n;previous_manifest=web if prior==old_web else identity
    if previous_manifest['files'].get(n)==files[n] and previous.is_file() and not previous.is_symlink() and previous.resolve().is_relative_to(prior.resolve()) and previous.stat().st_uid==0 and not previous.stat().st_mode&0o022 and filehash(previous)==files[n]:
     os.link(previous,p);linked+=1
    else:
     with t.extractfile(member) as f,p.open('xb') as output:shutil.copyfileobj(f,output)
     p.chmod(0o755 if member.mode&0o111 else 0o644);written+=member.size
   (target/'manifest.json').write_bytes(rawmanifest);(target/'manifest.json').chmod(0o644)
   command(['/usr/bin/python3','-B','-m','venv','--without-pip',str(target/'.venv')],env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'})
   oldsite=old_identity/'.venv/lib/python3.12/site-packages';newsite=target/'.venv/lib/python3.12/site-packages'
   secure(oldsite.resolve())
   def link_dependency(src,dst):
    p=P(src);s=p.lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise RuntimeError('untrusted_admitted_dependency')
    os.link(src,dst);return dst
   check('no_external_dependency_links',all(not p.is_symlink() for p in oldsite.rglob('*')))
   shutil.copytree(oldsite,newsite,copy_function=link_dependency,dirs_exist_ok=True)
  finally:os.umask(oldmask)
 verify_component(target,m)
 smoke="import sys,importlib.metadata as m;import django,allauth,gunicorn,psycopg,cryptography;assert sys.version_info[:2]==(3,12);print({n:m.version(n) for n in ['Django','django-allauth','gunicorn','psycopg','cryptography']})"
 check('new_interpreter_admitted_dependencies',command([str(target/'.venv/bin/python'),'-I','-B','-c',smoke])==command([str(old_identity/'.venv/bin/python'),'-I','-B','-c',smoke]))
 env=private_env('identity');env['DJANGO_SETTINGS_MODULE']='octoport_identity.config.settings';env['ALISA_RELEASE']=release
 web_env=private_env('web')
 preflight="import sys;sys.path.insert(0,sys.argv[1]);import django;django.setup();from octoport_identity.protocol.customer import customer_client;from django.urls import reverse,resolve;from octoport_identity.protocol.customer import VerifiedLoginCodeView;client=customer_client();assert client is not None and client.id==sys.argv[2];assert resolve(reverse('account_confirm_login_code')).func.view_class is VerifiedLoginCodeView"
 command([str(target/'.venv/bin/python'),'-I','-B','-c',preflight,str(target/'services/identity/src'),web_env['ALISA_WEB_OIDC_CLIENT_ID']],env=env)
 check('installed_readonly_customer_client_and_native_route_preflight',True)
 check('no_other_payload',(target/'.venv/bin/python').is_file() and not (target/'ui/admin').exists() and not (target/'services/platform').exists() and not (target/'wheels').exists())
 check('no_activation_during_prepare',pointers()==before)
 check('fixed_reserve_retained',shutil.disk_usage(B).free>=RESERVE and os.statvfs(B).f_favail>=200000)
 record.update(status='PASS',phase='PREPARED_NOT_ACTIVATED',source_sha=pins['source_sha'],manifest_sha256=pins['manifest_sha256'],linked_payload_files=linked,new_payload_bytes=written,free_bytes=shutil.disk_usage(B).free)
def activate(pins,target,release):
 prepared=private_json('prepare.json');check('exact_prepared_component',prepared['status']=='PASS' and prepared['source_sha']==pins['source_sha'])
 m=json.loads((target/'manifest.json').read_text());check('manifest_binding',filehash(target/'manifest.json')==pins['manifest_sha256']);verify_component(target,m)
 before=pointers();check('baseline_still_exact',before==pins['baseline'])
 configs=cfg_hashes();profiles={u:profile(u) for u in ['alisa-web@stage.service','alisa-identity@stage.service']};others=protected()
 record['config_sha256_before']=configs;record['profile_sha256_before']=profiles
 check('before_readiness',all(ready(port,before[n]) for port,n in [(18100,'web-current'),(18103,'identity-current'),(18102,'site-current'),(18101,'admin-current')]))
 changed=False
 try:
  changed=True;point('identity-current',release);point('web-current',release)
  command(['systemctl','restart','alisa-identity@stage.service','alisa-web@stage.service'])
  check('new_readiness',ready(18103,release) and ready(18100,release))
  check('protected_services_unchanged',protected()==others)
  record['config_sha256_after']=cfg_hashes();record['profile_sha256_after']={u:profile(u) for u in profiles}
  check('configs_profiles_unchanged',record['config_sha256_after']==configs and record['profile_sha256_after']==profiles)
  check('only_two_pointers_changed',pointers()=={**before,'identity-current':release,'web-current':release})
  for url,needle in [('https://alisa.octoport.ru/login','Логин — ваша электронная почта'),('https://id.octoport.ru/accounts/login/','name="password"'),('https://id.octoport.ru/accounts/signup/','name="password2"')]:
   with opener.open(url,timeout=8) as r:body=r.read(262144).decode()
   check('public_form_'+str(len(record['cases'])),r.status==200 and needle in body and 'пароль не нужен' not in body)
  try:r=opener.open('https://alisa.octoport.ru/app/stores',timeout=5)
  except urllib.error.HTTPError as error:r=error
  with r:check('stores_still_private',r.status==307 and r.headers.get('Location')=='/login')
  check('disk_reserve_after_activation',shutil.disk_usage(B).free>=RESERVE)
  record.update(status='PASS',phase='ACTIVATED',source_sha=pins['source_sha'],pointers=pointers(),protected_services_preserved=True,configs_preserved=True,migrations_applied=[],live_owner_login='NOT_RUN')
 except Exception:
  # Unrelated drift is evidence, not a reason to leave our failed activation
  # running. Never restore config/other services; restore only owned pointers.
  owned=changed and all(pointers()[n] in {before[n],release} for n in ['web-current','identity-current'])
  if owned:
   # Restore both owned pointers immediately, then queue the native restarts.
   # Recovery must finish within the runner's mandatory five-second stop grace;
   # blocking health/restart waits belong to the subsequent read-only check.
   point('web-current',before['web-current']);point('identity-current',before['identity-current'])
   subprocess.run(['systemctl','--no-block','restart','alisa-identity@stage.service','alisa-web@stage.service'],check=True,capture_output=True,timeout=2)
   record['recovery']='OWN_WEB_IDENTITY_POINTERS_RESTORED_RESTART_QUEUED_VERIFY_REQUIRED'
  else:record['recovery']='NO_OWN_CHANGE' if not changed else 'EXTERNAL_WEB_OR_IDENTITY_POINTER_CHANGE_PRESERVED'
  raise
if __name__=='__main__':
 def interrupted(*_):raise InterruptedError('Bounded rollout interrupted')
 signal.signal(signal.SIGTERM,interrupted)
 secure(B/'releases');secure(D);secure(C)
 if stat.S_IMODE(D.stat().st_mode)!=0o700:raise SystemExit('Private namespace required')
 phase=sys.argv[1]
 if phase not in {'prepare','activate'}:raise SystemExit('Expected prepare or activate')
 out=D/(phase+'.json')
 if out.exists() or out.is_symlink():raise SystemExit('Previous outcome retained')
 with contextlib.ExitStack() as stack:
  for name in LOCKS:
   f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:
   pins=private_json('package-binding.json');source=pins['source_sha']
   check('qualified_exact_source',source=='85b88ebe532affe08ce93a4bd5cb3f53c833ba68' and pins['source_tree']=='17dd9e77f7afb3c6ca0134d47ddfb18c014c1e9b' and pins['ci_platform_run']==42444538075 and pins['ci_status']=='success' and pins['independent_source_review']=='APPROVED_SOURCE')
   release='alisa-'+source[:16];target=B/'releases'/release
   (prepare if phase=='prepare' else activate)(pins,target,release)
  except Exception as error:record['error_type']=type(error).__name__
  finally:
   with out.open('x') as f:json.dump(record,f,indent=2)
   print(json.dumps(record))
 sys.exit(0 if record['status']=='PASS' else 1)

