from pathlib import Path
import fcntl,hashlib,json,os,stat,shutil
CURRENT=Path('/opt/alice-market/releases/current')
OWN_OLD=[Path('/opt/alice-market/releases')/n for n in ('alisa-finance-scope-r1-20261113','alisa-sales-selection-r1-20261113','alisa-orders-buyouts-r1-20261113','alisa-speech-context-r1-20261113','alisa-accrual-contracts-r1-20261113','alisa-wb-finance-contracts-r1-20261113')]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 BASE=CURRENT.resolve()
 current=json.loads((BASE/'manifest.json').read_text());assert all(sha(BASE/n)==h for n,h in current['files'].items())
 before=shutil.disk_usage(BASE).free;count=0
 for old in OWN_OLD:
  assert old.is_dir()and not old.is_symlink()and old!=BASE
  manifest=(old/'manifest.json').read_bytes();m=json.loads(manifest);assert all(sha(old/n)==h for n,h in m['files'].items())
  for n,h in m['files'].items():
   if n not in current['files']or current['files'][n]!=h:continue
   source=BASE/n;target=old/n;a=source.lstat();b=target.lstat()
   if not stat.S_ISREG(a.st_mode)or not stat.S_ISREG(b.st_mode)or a.st_ino==b.st_ino or b.st_nlink!=1:continue
   if (a.st_dev,a.st_uid,a.st_gid,stat.S_IMODE(a.st_mode),a.st_size)!=(b.st_dev,b.st_uid,b.st_gid,stat.S_IMODE(b.st_mode),b.st_size):continue
   tmp=target.with_name(target.name+'.own-dedup-next');assert not tmp.exists()and not tmp.is_symlink();os.link(source,tmp);os.replace(tmp,target);count+=1
  assert (old/'manifest.json').read_bytes()==manifest and all(sha(old/n)==h for n,h in m['files'].items())
 assert all(sha(BASE/n)==h for n,h in current['files'].items())
 assert Path('/opt/alice-market/releases/current').resolve()==BASE,'CURRENT_CHANGED'
 print(json.dumps({'unchanged_immutable_files_deduplicated':count,'freed_bytes':shutil.disk_usage(BASE).free-before,'current_and_old_release_bytes_preserved':True,'free_bytes':shutil.disk_usage(BASE).free}))
