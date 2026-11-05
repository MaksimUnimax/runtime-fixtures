"""Finite S03 reserve recovery. Preserve all paths/bytes; only inactive owned copies."""
import os,sys,pathlib,json,hashlib,stat,collections,datetime,fcntl,contextlib,gzip,uuid,shutil
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');ROOT=B/'releases';D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');OUT=pathlib.Path('/var/lib/alisa-platform/stage/evidence/AL_S03_INACTIVE_VENDOR_DEDUP_R2_20261105.json')
OWN=['alisa-3e763ad761fac377','alisa-29c99f6d9d00f19e','alisa-61007bf870cf4f65','alisa-8d680f775c8ccdf2','alisa-6ae348354b3db0d3','alisa-140150ba526b6c3d','alisa-51d2a57db66647e0','alisa-e82003211bdcd687']
record={'scope':'S03_DISK_RESERVE_INACTIVE_OWN_VENDOR_DEDUP','status':'RUNNING','started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'disk_free_before_mib':shutil.disk_usage(B).free//1048576,'cases':[],'applied_links':0,'archives_or_version_paths_removed':0,'active_inodes_touched':0,'mtime_note':'Inactive target mtimes intentionally follow canonical. Restore individual original timestamps only after breaking/copying the hardlink. Original metadata preserved in private gzip receipt.'}
def check(n,ok):
 record['cases'].append({'case':n,'passed':bool(ok)})
 if not ok:raise RuntimeError(n)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while block:=f.read(1048576):h.update(block)
 return h.hexdigest()
def active():return {p.resolve().name for p in B.iterdir() if p.is_symlink()}
def verify(name,m):
 r=ROOT/name
 for rel,h in m['files'].items():
  p=r/rel
  if not p.is_file() or p.is_symlink() or not p.resolve().is_relative_to(r.resolve()) or digest(p)!=h:raise RuntimeError('Manifest verification failed')
 for rel,target in m['links'].items():
  p=r/rel
  if not p.is_symlink() or os.readlink(p)!=target:raise RuntimeError('Link verification failed')
def run():
 assert not OUT.exists();manifests={};groups=collections.defaultdict(list);inode_count=collections.Counter();active_inodes=set();operations=[]
 try:
  check('owned_targets_all_inactive',not set(OWN)&active())
  # A process using an old release excludes it even without a current pointer.
  busy=set()
  for proc in pathlib.Path('/proc').iterdir():
   if not proc.name.isdigit():continue
   try:text=os.readlink(proc/'cwd')+' '+(proc/'cmdline').read_bytes().decode(errors='replace')
   except (OSError,ProcessLookupError):continue
   for name in OWN:
    if str(ROOT/name) in text:busy.add(name)
  check('no_process_uses_target_release',not busy)
  for name in active():
   p=ROOT/name/'manifest.json'
   if not p.exists():continue
   m=json.loads(p.read_text())
   for rel in m['files']:
    f=ROOT/name/rel
    if f.is_file() and not f.is_symlink():s=f.stat();active_inodes.add((s.st_dev,s.st_ino))
  for name in OWN:
   root=ROOT/name;check(name+'_regular_release_directory',not root.is_symlink() and root.is_dir());m=json.loads((root/'manifest.json').read_text());check(name+'_manifest_identity',m['artifact_id']==name);verify(name,m);manifests[name]=m
   for rel,h in m['files'].items():
    if not (rel.startswith('ui/') and '/node_modules/' in rel):continue
    p=root/rel;s=p.stat();key=(h,s.st_size,stat.S_IMODE(s.st_mode),s.st_uid,s.st_gid,s.st_dev);groups[key].append((p,s));inode_count[(s.st_dev,s.st_ino)]+=1
  check('all_target_manifests_verified_before',True)
  for key,items in groups.items():
   eligible=[(p,s) for p,s in items if (s.st_dev,s.st_ino) not in active_inodes and s.st_nlink==inode_count[(s.st_dev,s.st_ino)]]
   if len(eligible)<2:continue
   canonical,cs=eligible[0];seen={(cs.st_dev,cs.st_ino)}
   for p,s in eligible[1:]:
    inode=(s.st_dev,s.st_ino)
    if inode in seen:continue
    seen.add(inode)
    if s.st_nlink!=1:continue
    operations.append({'canonical':str(canonical),'target':str(p),'sha256':key[0],'size':s.st_size,'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'mtime_before_ns':s.st_mtime_ns,'canonical_mtime_ns':cs.st_mtime_ns,'old_inode':s.st_ino,'device':s.st_dev,'allocated_bytes':s.st_blocks*512})
  check('nonzero_dedup_candidate_set',bool(operations))
  with gzip.open(D/'inactive-vendor-before-metadata-r2.json.gz','wt') as f:json.dump(operations,f)
  record['planned_links']=len(operations);record['expected_reclaimed_mib']=round(sum(x['allocated_bytes'] for x in operations)/1048576,3);OUT.write_text(json.dumps(record,indent=2))
  for index,item in enumerate(operations):
   if index%100==0:check_active=not set(OWN)&active();assert check_active
   p=pathlib.Path(item['target']);canonical=pathlib.Path(item['canonical']);s=p.stat();cs=canonical.stat();key=(s.st_dev,s.st_ino)
   assert key not in active_inodes and (cs.st_dev,cs.st_ino) not in active_inodes
   assert s.st_ino==item['old_inode'] and s.st_dev==item['device'] and s.st_nlink==1
   assert (stat.S_IMODE(s.st_mode),s.st_uid,s.st_gid,s.st_size)==(stat.S_IMODE(cs.st_mode),cs.st_uid,cs.st_gid,cs.st_size)==(item['mode'],item['uid'],item['gid'],item['size'])
   assert digest(canonical)==digest(p)==item['sha256']
   temp=p.with_name('.s03-dedup-'+uuid.uuid4().hex);os.link(canonical,temp,follow_symlinks=False);os.replace(temp,p);record['applied_links']+=1
  check('all_planned_links_applied',record['applied_links']==len(operations))
  for name,m in manifests.items():verify(name,m)
  check('all_target_manifest_bytes_and_links_unchanged_after',True);check('targets_still_inactive',not set(OWN)&active());record['disk_free_after_mib']=shutil.disk_usage(B).free//1048576;record['actual_free_gain_mib']=record['disk_free_after_mib']-record['disk_free_before_mib'];check('reserve_plus_100mib_test_growth_restored',record['disk_free_after_mib']>=3172);record['status']='PASS'
 except Exception as ex:
  record['status']='FAILED';record['error_type']=type(ex).__name__;record['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
 finally:
  record['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(record,indent=2));print(json.dumps(record))
 return record['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for name in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+name,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
