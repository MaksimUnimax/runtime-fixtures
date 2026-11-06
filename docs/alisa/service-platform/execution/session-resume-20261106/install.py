"""Finite admin+identity activation; preserve deployed S04 and original native factors."""
import os,sys,pathlib,json,hashlib,tarfile,datetime,contextlib,fcntl,subprocess,time,urllib.request,uuid,importlib.util
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');P=pathlib.Path('/dev/shm/alisa-session-resume-73180172')
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/session-resume-73180172')
OUT=pathlib.Path('/var/lib/alisa-platform/stage/evidence/ALISA_ADMIN_SESSION_RESUME_INSTALL_20261106.json')
SOURCE='73180172646b7012f1df8026ee8e3b43e8829ce0';NEW='alisa-'+SOURCE[:16]
OLDI='alisa-1432dcc21a07b90b';OLDUI='alisa-c8666516683e7b2b'
EXPECTED={'current':'alisa-482ed11832b666af','identity-current':OLDI,'admin-current':OLDUI,'web-current':OLDUI,'site-current':OLDUI}
TAR=P/'package'/f'{NEW}.tar.gz';SHA='db04b26d521a141cff933b54003700e73152b94d5df4dcc3e2463c44cf4ec2e5'
r={'scope':'ADMIN_IDENTITY_ONLY_SESSION_RESUME','status':'RUNNING','source_sha':SOURCE,'artifact_sha256':SHA,'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':[],'no_database_or_mfa_factor_mutations':True}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while x:=f.read(1048576):h.update(x)
 return h.hexdigest()
def check(name,ok):
 r['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def pointers():return {p.name:p.resolve().name for p in B.iterdir() if p.is_symlink()}
def free():return os.statvfs(B).f_bavail*os.statvfs(B).f_frsize
def resources():
 v=os.statvfs(B);mem={k:int(v.split()[0])*1024 for k,v in (x.split(':',1) for x in pathlib.Path('/proc/meminfo').read_text().splitlines()) if k in ['MemAvailable']}
 return {'disk_free_bytes':free(),'free_inodes':v.f_favail,'memory_available_bytes':mem['MemAvailable']}
def config_hashes():return {str(p):digest(p) for p in pathlib.Path('/etc/alisa-platform').rglob('*') if p.is_file() and not p.is_symlink()}
def pid(unit):return subprocess.check_output(['systemctl','show',unit,'-p','MainPID','--value'],text=True).strip()
PROTECTED=['alisa-web@stage.service','alisa-platform@stage.service','alisa-smtp-sandbox-stage.service']
def pids():return {x:pid(x) for x in PROTECTED}
def ready():
 d={}
 for component,port in [('web',18100),('admin',18101),('platform',18102),('identity',18103)]:
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=4) as f:d[component]=json.load(f)
 return d
def await_ready(want):
 for _ in range(35):
  try:
   d=ready()
   if all(d[c].get('release')==v and d[c].get('component')==c and d[c].get('environment')=='stage' for c,v in want.items()):return d
  except (OSError,ValueError):pass
  time.sleep(1)
 raise RuntimeError('component_readiness')
def switch(name,release):
 p=B/('.session-resume-'+uuid.uuid4().hex);p.symlink_to(B/'releases'/release);os.replace(p,B/name)
def restart():subprocess.run(['systemctl','restart','alisa-identity@stage.service','alisa-admin@stage.service'],check=True,timeout=45)
def run():
 changed=False;cfg=None;beforepids=None
 try:
  check('fresh_receipt',not OUT.exists());D.mkdir(parents=True,exist_ok=True)
  check('expected_component_pointers',pointers()==EXPECTED)
  r['resources_before']=resources();check('installation_disk_growth_reserve',free()>=3400*1048576)
  check('inode_memory_reserves',r['resources_before']['free_inodes']>200000 and r['resources_before']['memory_available_bytes']>=1536*1048576)
  cfg=config_hashes();beforepids=pids();before=ready()
  check('running_component_baselines',all(before[c]['release']==v for c,v in {'identity':OLDI,'admin':OLDUI,'web':OLDUI,'platform':OLDUI}.items()))
  (D/'before.json').write_text(json.dumps({'pointers':EXPECTED,'config_hashes':cfg,'protected_pids':beforepids,'ready':before},indent=2))
  check('qualified_tar_checksum',digest(TAR)==SHA)
  check('qualified_checksum_file',(TAR.with_name(TAR.name+'.sha256')).read_text().split()[0]==SHA)
  with tarfile.open(TAR) as t:m=json.load(t.extractfile(NEW+'/manifest.json'))
  check('exact_candidate_source',m['source_sha']==SOURCE and m['artifact_id']==NEW)
  baseline=json.loads((B/'releases'/OLDUI/'manifest.json').read_text())
  identity=json.loads((B/'releases'/OLDI/'manifest.json').read_text())
  check('contracts_locks_migrations_preserved',all(m[k]==baseline[k] for k in ['locks','contracts','migrations']))
  def files(man,prefix):return {k:v for k,v in man['files'].items() if k.startswith(prefix)}
  check('platform_component_bytes_preserved',files(m,'services/platform/')==files(baseline,'services/platform/'))
  delta={k for k in set(m['files'])|set(identity['files']) if k.startswith('services/identity/') and m['files'].get(k)!=identity['files'].get(k)}
  allowed={'services/identity/src/octoport_identity/protocol/views.py','services/identity/src/octoport_identity/protocol/mfa_forms.py','services/identity/src/octoport_identity/config/settings.py','services/identity/src/octoport_identity/accounts/templates/mfa/reauthenticate.html'}
  check('only_reviewed_identity_delta',delta==allowed)
  for f in (P/'qualification').glob('*.json'):
   q=json.loads(f.read_text());check('ci_'+f.name,all(x.get('passed') is True for x in q['cases']))
   if 'source_sha' in q:check('ci_source_'+f.name,q['source_sha']==SOURCE)
   if 'artifact_sha256' in q:check('ci_tar_'+f.name,q['artifact_sha256']==SHA)
  spec=importlib.util.spec_from_file_location('owned_release',B/'releases'/OLDI/'infra/release.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
  saved_umask=os.umask(0o022)
  try:installed=mod.install('stage',TAR,SHA)
  finally:os.umask(saved_umask)
  check('normal_immutable_install',installed==NEW)
  mod.installed_release(B,NEW);check('installed_full_manifest_verified',True)
  for unit in ['alisa-identity@stage.service','alisa-admin@stage.service']:
   user=subprocess.check_output(['systemctl','show',unit,'-p','User','--value'],text=True).strip()
   check('dedicated_runtime_user_'+unit,bool(user) and user!='root')
   code="import os,json,pathlib; r=pathlib.Path("+repr(str(B/'releases'/NEW))+");m=json.loads((r/'manifest.json').read_text());assert os.access(r,os.X_OK);assert all(os.access(r/x,os.R_OK) for x in m['files']);assert all(os.access(p,os.R_OK|(os.X_OK if p.is_dir() else 0)) for p in (r/'.venv').rglob('*'));import django,allauth"
   subprocess.run(['runuser','-u',user,'--',B/'releases'/NEW/'.venv/bin/python','-c',code],check=True,timeout=25)
   check('runtime_can_read_and_import_'+unit,True)
  check('preactivation_reserve',free()>=3072*1048576)
  check('pointers_still_baseline',pointers()==EXPECTED);check('config_unchanged_before_activation',config_hashes()==cfg)
  check('protected_processes_unchanged_before_activation',pids()==beforepids)
  changed=True;switch('identity-current',NEW);switch('admin-current',NEW);restart()
  r['ready']=await_ready({'identity':NEW,'admin':NEW,'web':OLDUI,'platform':OLDUI})
  desired=EXPECTED|{'identity-current':NEW,'admin-current':NEW}
  check('only_two_pointers_changed',pointers()==desired)
  check('all_config_bytes_unchanged',config_hashes()==cfg);check('protected_processes_unchanged',pids()==beforepids)
  r['resources_after']=resources();check('operating_disk_inode_memory_reserves',free()>=3072*1048576 and r['resources_after']['free_inodes']>200000 and r['resources_after']['memory_available_bytes']>=1024*1048576)
  r['status']='PASS'
 except Exception as e:
  r['status']='FAILED';r['error_type']=type(e).__name__;r['failed_case']=str(e) if isinstance(e,RuntimeError) else None
  if changed:
   switch('identity-current',OLDI);switch('admin-current',OLDUI);restart()
   r['rollback_ready']=await_ready({'identity':OLDI,'admin':OLDUI,'web':OLDUI,'platform':OLDUI});r['rollback']='TWO_CODE_POINTERS_ONLY'
 finally:
  r['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(r,indent=2));print(json.dumps(r))
 return r['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
