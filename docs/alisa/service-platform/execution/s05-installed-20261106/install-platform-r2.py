"""Finite inactive copy of exact CI payload; platform-only locked environment."""
import contextlib,datetime,fcntl,hashlib,io,json,math,os,pathlib,shutil,subprocess,sys,tarfile,urllib.parse,urllib.request,zipfile
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s05-stores-20261106')
SOURCE='6098b31384ae23a43fb869abd3e67f165bc644fa';R='alisa-'+SOURCE[:16];OUT=D/'platform-install-r2.json'
ZIP_SHA='618170ea88f09c88143c302b938d5d5477b0ce982a7277fa9656d5c57e659c16';TAR_SHA='dfbc0e8550b25a23266e1b801547c7fb291b7d9b7d49b7728d7d71baf886e2d3';MANIFEST_SHA='a181fef7c03637badef896f9a2a675f40d533a4ad767dbc9b23426769378578c'
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
rec={'scope':'INACTIVE_PLATFORM_PACKAGE_COPY_NO_ACTIVATION','status':'FAILED','source_sha':SOURCE,'cases':[]}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(name,value):
 rec['cases'].append({'case':name,'passed':bool(value)})
 if not value:raise RuntimeError(name)
def pointers():return {n:(B/n).resolve().name for n in ['web-current','site-current','admin-current','identity-current','current']}
def main():
 check('new_receipt_and_target',not OUT.exists() and not (B/'releases'/R).exists())
 old=pointers();rec['before_pointers']=old
 growth=math.ceil((51800794+135704576+78680064)*1.15)+16*1048576
 rec['maximum_growth_bytes']=growth;rec['free_before']=shutil.disk_usage(B).free
 check('physical_disk_and_inode_reserve',rec['free_before']>=3072*1048576+growth and os.statvfs(B).f_favail>=210000)
 check('memory_reserve',next(int(l.split()[1]) for l in pathlib.Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))>=1536*1024)
 inp=D/'artifact-input.private.json';check('root_private_input',inp.stat().st_uid==0 and inp.stat().st_mode&0o777==0o600)
 incoming=json.loads(inp.read_text());url=urllib.parse.urlsplit(incoming['download_url'])
 check('private_input_https',url.scheme=='https' and url.hostname.endswith('.oaiusercontent.com') and url.port in {None,443} and not url.username and not url.password)
 # The original ZIP is hashed in RAM; no second large on-disk archive is created.
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 with opener.open(incoming['download_url'],timeout=40) as response:raw=response.read(51724612)
 check('exact_ci_zip',len(raw)==51724611 and hashlib.sha256(raw).hexdigest()==ZIP_SHA)
 tarpath=D/(R+'.tar.gz')
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  check('exact_zip_members',set(z.namelist())=={R+'.tar.gz',R+'.tar.gz.sha256'})
  with z.open(R+'.tar.gz') as src,tarpath.open('xb') as dst:shutil.copyfileobj(src,dst,1048576)
  check('checksum_sidecar',z.read(R+'.tar.gz.sha256').decode().split()[0]==TAR_SHA)
 del raw
 check('exact_tar',tarpath.stat().st_size==51800794 and digest(tarpath)==TAR_SHA)
 target=B/'releases'/R
 with tarfile.open(tarpath) as t:
  check('single_owned_root',{m.name.split('/')[0] for m in t.getmembers()}=={R})
  manifest_bytes=t.extractfile(R+'/manifest.json').read();m=json.loads(manifest_bytes)
  check('exact_manifest',hashlib.sha256(manifest_bytes).hexdigest()==MANIFEST_SHA and m['source_sha']==SOURCE and m['artifact_id']==R)
  old_umask=os.umask(0o022)
  try:t.extractall(B/'releases',filter='data')
  finally:os.umask(old_umask)
 files={};links={}
 for p in target.rglob('*'):
  name=str(p.relative_to(target))
  if p.is_symlink():links[name]=os.readlink(p)
  elif p.is_file() and name!='manifest.json':files[name]=digest(p)
 check('full_payload_and_links',files==m['files'] and links==m['links'] and len(files)==4451 and len(links)==42 and all((target/n).resolve().is_relative_to(target.resolve()) for n in links))
 # Identity stays on its own current pointer and does not use this environment.
 clean={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1','PIP_NO_CACHE_DIR':'1'}
 old_umask=os.umask(0o022)
 try:
  with (D/'platform-install.private.log').open('xb') as log:
   subprocess.run(['/usr/bin/python3','-B','-m','venv',str(target/'.venv')],env=clean,stdout=log,stderr=log,check=True,timeout=40)
   subprocess.run([str(target/'.venv/bin/python'),'-B','-m','pip','install','--no-compile','--no-index','--find-links',str(target/'wheels'),'--require-hashes','-r',str(target/'services/platform/requirements.lock')],env=clean,stdout=log,stderr=log,check=True,timeout=90)
   subprocess.run([str(target/'.venv/bin/python'),'-B','-m','pip','check'],env=clean,stdout=log,stderr=log,check=True,timeout=20)
 finally:os.umask(old_umask);(D/'platform-install.private.log').chmod(0o600)
 check('all_pointers_unchanged',pointers()==old)
 rec['free_after']=shutil.disk_usage(B).free;check('disk_reserve_retained',rec['free_after']>=3072*1048576)
 rec['status']='PASS'
if __name__=='__main__':
 if OUT.exists():raise SystemExit('Existing outcome is preserved; inspect before resume')
 with contextlib.ExitStack() as stack:
  for name in LOCKS:
   f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as error:rec['error_type']=type(error).__name__
  finally:rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(rec,indent=2)+'\n');print(json.dumps(rec))
 sys.exit(0 if rec['status']=='PASS' else 1)
