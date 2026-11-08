"""Install exact qualified artifacts into new inactive immutable release paths."""
import contextlib,fcntl,hashlib,io,json,math,os,shutil,stat,subprocess,sys,tarfile,urllib.parse,urllib.request,zipfile
from pathlib import Path as P
sys.dont_write_bytecode=True;os.umask(0o077)
SOURCE='06f3c053e77192907821005aa4aae5cc1e8aee63'
B=P('/opt/alisa-platform/stage');D=P('/var/lib/alisa-platform/stage/rollout-backups/audit-06f3-20261108')
R='alisa-'+SOURCE[:16];RR='alisa-runtime-'+SOURCE[:16]
TARGETS={R:B/'releases'/R,RR:P('/opt/alice-market/releases')/RR}
EXPECTED={'site-current':'alisa-5dff6e8883e25ac4','web-current':'alisa-5dff6e8883e25ac4','admin-current':'alisa-73180172646b7012','identity-current':'alisa-7afaf646b9b35a58','current':'alisa-482ed11832b666af'}
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
rec={'scope':'EXACT_CI_INACTIVE_PACKAGE_INSTALL_NO_SERVICE_DB_CONFIG_MUTATION','source_sha':SOURCE,'status':'FAILED','cases':[]}
def sha(b):return hashlib.sha256(b).hexdigest()
def digest(p):
 with p.open('rb')as f:return hashlib.file_digest(f,'sha256').hexdigest()
def check(n,v):
 rec['cases'].append({'case':n,'passed':bool(v)})
 if not v:raise RuntimeError(n)
def secure(p):
 for q in [*reversed(p.parents),p]:
  s=q.lstat();check('secure_directory_'+str(q),stat.S_ISDIR(s.st_mode) and s.st_uid==s.st_gid==0 and not s.st_mode&0o022)
def pointers():return {n:(B/n).resolve().name for n in EXPECTED}
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*a,**kw):return None
def main():
 check('expected_pointers',pointers()==EXPECTED)
 check('fresh_targets',all(not p.exists() and not p.is_symlink() for p in TARGETS.values()))
 for n in ['package-binding.json','artifact-input.private.json']:
  p=D/n;s=p.lstat();check('private_input_'+n,stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600)
 pins=json.loads((D/'package-binding.json').read_text());incoming=json.loads((D/'artifact-input.private.json').read_text())
 check('qualified_source_and_ci',pins['source_sha']==SOURCE and pins['source_tree']=='962e9e2426181f5f3f716a34b5dc64e6c22c4890' and pins['ci']=={'platform':42443251068,'documentation':42443251053,'conclusion':'success'})
 check('exact_zip_binding',pins['zip_size']==51976216 and pins['zip_sha256']=='7d574ccf3ff1afb1b0c1aae848a37e38d980f71c25d1bf345c15ad8fb1605182')
 check('memory_admission',next(int(l.split()[1]) for l in P('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))>=1792*1024)
 check('minimum_disk_inode_reserve',shutil.disk_usage(B).free>=3072*1048576+16*1048576 and os.statvfs(B).f_favail>=220000)
 u=urllib.parse.urlsplit(incoming['download_url']);check('trusted_download',u.scheme=='https' and u.hostname.endswith('.oaiusercontent.com') and u.port in {None,443} and not u.username and not u.password)
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 with opener.open(incoming['download_url'],timeout=45)as f:raw=f.read(pins['zip_size']+1)
 check('exact_zip',len(raw)==pins['zip_size'] and sha(raw)==pins['zip_sha256'])
 archives={};manifests={};reuse={};growth=96*1048576+16*1048576
 roots=[B/'releases'/n for n in sorted(set(EXPECTED.values()))]
 with zipfile.ZipFile(io.BytesIO(raw))as z:
  check('exact_zip_members',len(z.infolist())==4 and set(z.namelist())=={p+s for p in [R,RR]for s in ['.tar.gz','.tar.gz.sha256']})
  for prefix,target in TARGETS.items():
   n=prefix+'.tar.gz';pin=pins['archives'][n];check('bounded_expansion_'+prefix,z.getinfo(n).file_size==pin['size'] and pin['size']<=64*1048576 and z.getinfo(n+'.sha256').file_size<256)
   data=z.read(n);check('tar_hash_'+prefix,sha(data)==pin['sha256'] and z.read(n+'.sha256').decode().split()[0]==pin['sha256'])
   t=tarfile.open(fileobj=io.BytesIO(data),mode='r:gz');archives[prefix]=t;members=t.getmembers()
   check('safe_member_names_'+prefix,len(members)<=12000 and len({m.name for m in members})==len(members) and all(not P(m.name).is_absolute() and '..' not in P(m.name).parts and m.name.split('/')[0]==prefix and (m.isdir() or m.isfile() or m.issym()) and (m.issym() or not m.mode&0o022) for m in members))
   link_names={m.name for m in members if m.issym()}
   check('no_writes_through_package_symlinks_'+prefix,all(not any(str(p)in link_names for p in P(m.name).parents)for m in members))
   mb=t.extractfile(prefix+'/manifest.json').read();m=json.loads(mb);manifests[prefix]=m
   check('manifest_'+prefix,sha(mb)==pin['manifest_sha256'] and m['source_sha']==SOURCE)
   files={};links={}
   for item in members:
    name=str(P(item.name).relative_to(prefix))
    if item.isdir():growth+=4096;continue
    if item.issym():
     links[name]=item.linkname
     check('internal_symlink_'+name,not P(item.linkname).is_absolute() and (target/name).parent.joinpath(item.linkname).resolve().is_relative_to(target.resolve()))
     growth+=4096;continue
    with t.extractfile(item)as f:h=hashlib.file_digest(f,'sha256').hexdigest()
    if name!='manifest.json':files[name]=h
    shared=None
    if prefix==R and name!='manifest.json':
     for root in roots:
      source=root/name
      if not source.exists() or source.is_symlink() or not source.resolve().is_relative_to(root.resolve()):continue
      s=source.stat()
      if stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==item.mode and s.st_size==item.size and digest(source)==h:
       shared=source;break
    if shared:reuse[item.name]={'path':str(shared),'sha256':h,'mode':item.mode}
    else:growth+=math.ceil(item.size/4096)*4096
   check('full_payload_'+prefix,files==m['files'] and links==m.get('links',{}))
 pm=manifests[R];old=json.loads((B/'site-current/manifest.json').read_text())
 check('schema_and_platform_dependencies_unchanged',pm['migrations']==old['migrations'] and pm['schema_compatibility']==old['schema_compatibility'] and pm['locks']['services/platform/requirements.lock']==old['locks']['services/platform/requirements.lock'])
 check('identity_contracts_unchanged',all(pm['contracts'][n]==old['contracts'][n] for n in ['contracts/auth-flow-v1.json','contracts/auth-session-v1.json']))
 rec.update(maximum_growth_bytes=growth,free_before=shutil.disk_usage(B).free,reused_file_count=len(reuse))
 check('full_install_growth_reserve',rec['free_before']>=3072*1048576+growth)
 check('pointers_still_expected',pointers()==EXPECTED)
 os.umask(0o022)
 for prefix,target in TARGETS.items():
  target.mkdir(mode=0o755)
  for item in archives[prefix].getmembers():
   name=str(P(item.name).relative_to(prefix));p=target/name
   if item.isdir():p.mkdir(mode=0o755,parents=True,exist_ok=True);continue
   p.parent.mkdir(mode=0o755,parents=True,exist_ok=True)
   if item.issym():p.symlink_to(item.linkname);continue
   if item.name in reuse:
    v=reuse[item.name];source=P(v['path']);s=source.lstat()
    check('recheck_reused_file',stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==v['mode'] and digest(source)==v['sha256'])
    os.link(source,p,follow_symlinks=False)
   else:
    with archives[prefix].extractfile(item)as src,p.open('xb')as dst:shutil.copyfileobj(src,dst,1048576)
    p.chmod(item.mode)
  check('installed_payload_'+prefix,all(digest(target/n)==h for n,h in manifests[prefix]['files'].items()) and all(os.readlink(target/n)==v and (target/n).resolve(strict=True).is_relative_to(target.resolve()) for n,v in manifests[prefix].get('links',{}).items()))
 os.umask(0o077)
 target=TARGETS[R];bootstrap=B/'site-current/.venv/bin/python';clean={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1','PIP_NO_CACHE_DIR':'1'}
 old_umask=os.umask(0o022)
 try:
  with (D/'pip.private.log').open('xb')as log:
   for cmd,timeout in [(['/usr/bin/python3','-B','-m','venv','--without-pip',str(target/'.venv')],40),([str(bootstrap),'-B','-m','pip','--python',str(target/'.venv/bin/python'),'install','--no-compile','--no-index','--find-links',str(target/'wheels'),'--require-hashes','-r',str(target/'services/platform/requirements.lock')],90),([str(bootstrap),'-B','-m','pip','--python',str(target/'.venv/bin/python'),'check'],30)]:
    subprocess.run(cmd,env=clean,stdout=log,stderr=log,check=True,timeout=timeout)
 finally:os.umask(old_umask);(D/'pip.private.log').chmod(0o600)
 check('reused_source_bytes_unchanged',all(digest(P(v['path']))==v['sha256'] for v in reuse.values()))
 check('pointers_unchanged',pointers()==EXPECTED)
 rec['free_after']=shutil.disk_usage(B).free;check('retained_disk_inode_reserve',rec['free_after']>=3072*1048576 and os.statvfs(B).f_favail>=200000)
 (D/'reuse-map.json').write_text(json.dumps(reuse,indent=2)+'\n');rec['status']='PASS'
if __name__=='__main__':
 secure(D);secure(B/'releases');secure(P('/opt/alice-market/releases'))
 check('private_namespace',stat.S_IMODE(D.stat().st_mode)==0o700)
 out=D/'install.json'
 if out.exists() or out.is_symlink():raise SystemExit('Existing receipt preserved')
 with contextlib.ExitStack()as stack:
  for n in LOCKS:
   f=stack.enter_context(open('/run/lock/'+n));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as e:rec['error_type']=type(e).__name__
  finally:
   os.umask(0o077)
   with out.open('x')as f:json.dump(rec,f,indent=2)
   print(json.dumps({k:v for k,v in rec.items()if k!='cases'}))
 sys.exit(0 if rec['status']=='PASS'else 1)
