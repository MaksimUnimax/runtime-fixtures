from pathlib import Path
import fcntl,os,stat,time,json,shutil
root=Path('/root/alice-lab-evidence/answer-model-20261109')
before=shutil.disk_usage('/')
removed=[];kept=[]
apt=Path('/var/lib/apt/lists')
assert apt.is_dir()and not apt.is_symlink()
fd=os.open(apt/'lock',os.O_RDWR)
try:
 fcntl.lockf(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 for p in apt.iterdir():
  if p.name=='lock'or p.is_dir()or p.is_symlink():continue
  st=p.stat()
  if stat.S_ISREG(st.st_mode):
   removed.append({'category':'apt_downloaded_index','path':str(p),'bytes':st.st_size,'allocated':st.st_blocks*512})
   p.unlink()
finally:os.close(fd)
cache=Path('/root/.npm/_cacache')
assert not cache.is_symlink()
open_paths=set()
for proc in Path('/proc').iterdir():
 if not proc.name.isdigit()or int(proc.name)==os.getpid():continue
 try:
  for link in(proc/'fd').iterdir():
   try:
    value=os.readlink(link)
    if value.startswith(str(cache)+'/'):open_paths.add(value)
   except OSError:pass
 except OSError:pass
if cache.is_dir():
 for p in cache.rglob('*'):
  if p.is_file()and not p.is_symlink():
   st=p.stat()
   if time.time()-st.st_mtime<86400 or str(p)in open_paths:kept.append(str(p));continue
   removed.append({'category':'npm_download_cache','path':str(p),'bytes':st.st_size,'allocated':st.st_blocks*512})
   p.unlink()
after=shutil.disk_usage('/')
proof={'phase':'regenerable_package_cache','before':{'total':before.total,'used':before.used,'free':before.free},'after':{'total':after.total,'used':after.used,'free':after.free},'freed_bytes_measured':after.free-before.free,'files_removed':len(removed),'removed':removed,'fresh_or_open_cache_files_preserved':len(kept),'running_npx_installation_preserved':True,'installed_packages_databases_credentials_reports_unchanged':True}
p=root/'DISK_CLEANUP_CACHE_20261114.json';p.write_text(json.dumps(proof,indent=2)+'\n');p.chmod(0o600)
print(json.dumps({k:v for k,v in proof.items()if k!='removed'},ensure_ascii=False))
