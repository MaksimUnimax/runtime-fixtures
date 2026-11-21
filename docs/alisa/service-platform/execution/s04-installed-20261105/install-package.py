"""Exact isolated package copy using the existing, SHA-pinned release installer."""
import os,sys,pathlib,json,hashlib,tarfile,zipfile,urllib.request,urllib.parse,shutil,subprocess,datetime,math
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s04-access-20261105');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');OUT=E/'AL_S04_PACKAGE_INSTALL_20261105.json'
PIN_BINDING_SHA='253fee65c06f005e71e9acc76ecc374a251915009e7c50302f96263745353823'
rec={'scope':'S04_EXACT_PACKAGE_COPY_NO_ACTIVATION','status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'old_payload_or_runtime_files_modified':0,'archives_or_version_paths_removed':0}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1048576):h.update(b)
 return h.hexdigest()
def check(name,ok):
 rec['cases'].append({'case':name,'passed':bool(ok)});OUT.write_text(json.dumps(rec,indent=2))
 if not ok:raise RuntimeError(name)
def pointers():return {n:(B/n).resolve().name for n in ['admin-current','web-current','site-current','identity-current','current']}
def run():
 assert not OUT.exists()
 try:
  check('exact_reviewed_binding_file',digest(D/'ci-binding.json')==PIN_BINDING_SHA)
  binding=json.loads((D/'ci-binding.json').read_text());incoming=json.loads((D/'package-input.private.json').read_text());rec['binding']=binding
  check('input_binding_matches_reviewed_source',set(incoming)==set(binding)|{'download_url'} and all(incoming[k]==v for k,v in binding.items()) and binding['release']=='alisa-'+binding['source_sha'][:16])
  check('qualified_window_active',subprocess.check_output(['systemctl','is-active','alisa-s04-qualified-window-20261105g003'],text=True).strip()=='active')
  before=pointers();rec['before_pointers']=before;target=B/'releases'/binding['release'];check('new_release_absent',not target.exists())
  check('memory_and_inode_reserve',next(int(l.split()[1])//1024 for l in pathlib.Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))>=2048 and os.statvfs(B).f_favail>=220000)
  previous_venv=int(subprocess.check_output(['du','-s','--block-size=1',str(B/'web-current'/'.venv')],text=True).split()[0])
  required=math.ceil((binding['zip_bytes']+binding['tar_bytes']+binding['payload_allocated_bytes']+previous_venv*1.15)/1048576)+116
  rec['required_growth_mib']=required;rec['disk_before_mib']=shutil.disk_usage(B).free//1048576
  check('physical_reserve_archive_payload_runtime_and_growth',rec['disk_before_mib']>=3072+required)
  folder=D/binding['release'];check('new_private_download_namespace',not folder.exists());folder.mkdir(mode=0o700)
  url=urllib.parse.urlsplit(incoming['download_url']);check('admitted_artifact_https',url.scheme=='https' and url.hostname.endswith('.oaiusercontent.com') and not url.username and not url.password)
  archive=folder/'package.zip';size=0
  with urllib.request.urlopen(incoming['download_url'],timeout=40) as response,archive.open('wb') as output:
   while chunk:=response.read(1048576):
    size+=len(chunk)
    if size>binding['zip_bytes']:raise RuntimeError('oversized_archive')
    output.write(chunk)
  check('zip_bytes_and_sha',size==binding['zip_bytes'] and digest(archive)==binding['zip_sha256'])
  name=binding['release']+'.tar.gz';tarpath=folder/name
  with zipfile.ZipFile(archive) as z:
   check('exact_zip_file_set',set(z.namelist())=={name,name+'.sha256'})
   with z.open(name) as source,tarpath.open('wb') as output:shutil.copyfileobj(source,output,1048576)
   check('tar_checksum_file',z.read(name+'.sha256').decode().split()[0]==binding['tar_sha256'])
  check('tar_bytes_and_sha',tarpath.stat().st_size==binding['tar_bytes'] and digest(tarpath)==binding['tar_sha256'])
  with tarfile.open(tarpath) as t:
   members=t.getmembers();check('only_expected_tar_root',{m.name.split('/')[0] for m in members}=={binding['release']})
   raw=t.extractfile(binding['release']+'/manifest.json').read();m=json.loads(raw)
  check('exact_ci_manifest',hashlib.sha256(raw).hexdigest()==binding['manifest_sha256'] and m['artifact_id']==binding['release'] and m['source_sha']==binding['source_sha'] and len(m['files'])==binding['files'] and len(m['links'])==binding['links'])
  helper=(B/'current'/'infra/release.py').resolve();check('existing_installer_matches_qualified_code',digest(helper)==m['files']['infra/release.py'])
  check('runtime_requirements_unchanged',all(digest(B/'web-current'/p)==m['files'][p] for p in ['services/platform/requirements.lock','services/identity/requirements.lock']))
  check('pointers_unchanged_before_install',pointers()==before)
  # Only immutable, secret-free package code is created with public read/execute
  # permissions. Private input/archive/log files keep 0600 under root-only D.
  old_umask=os.umask(0o022)
  try:
   with (D/'package-install.private.log').open('wb') as log:
    subprocess.run(['/usr/bin/python3','-B',str(helper),'deploy','--env','stage','--artifact',str(tarpath),'--sha256',binding['tar_sha256']],env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1','PIP_NO_CACHE_DIR':'1'},stdout=log,stderr=log,check=True,timeout=180)
  finally:os.umask(old_umask);(D/'package-install.private.log').chmod(0o600)
  # Same verified installer exposes exhaustive file/link/venv verification.
  import runpy
  code=runpy.run_path(str(helper),run_name='verified_release_functions')
  check('exhaustive_installed_payload_matches_ci',code['installed_release'](B,binding['release'])==target and digest(target/'manifest.json')==binding['manifest_sha256'])
  check('all_current_pointers_preserved',pointers()==before)
  rec['disk_after_mib']=shutil.disk_usage(B).free//1048576;check('reserve_and_browser_growth_retained',rec['disk_after_mib']>=3172);rec['status']='PASS'
 except Exception as error:
  rec['status']='FAILED';rec['error_type']=type(error).__name__;rec['failed_case']=str(error) if isinstance(error,RuntimeError) else None
 finally:
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec))
 return rec['status']=='PASS'
if __name__=='__main__':sys.exit(0 if run() else 1)
