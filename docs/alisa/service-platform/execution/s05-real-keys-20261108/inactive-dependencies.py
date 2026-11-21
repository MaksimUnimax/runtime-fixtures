"""Finite inactive dependency-code dedup. No archives, data or active inodes."""
import os,errno,sys,pathlib,json,hashlib,stat,collections,datetime,gzip,shutil,fcntl,contextlib,uuid
sys.dont_write_bytecode=True;os.umask(0o077)
if sys.argv[1:] not in [['plan'],['apply']]:raise SystemExit('Expected explicit plan or apply')
B=pathlib.Path('/opt/alisa-platform/stage');D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s05-real-keys-20261108');PLAN=sys.argv[1:]==['plan'];OUT=D/('inactive-c866-dependencies-plan.json' if PLAN else 'inactive-c866-dependencies.json')
OWN=['alisa-d9918bcb3695b432','alisa-3e763ad761fac377','alisa-29c99f6d9d00f19e','alisa-61007bf870cf4f65','alisa-8d680f775c8ccdf2','alisa-6ae348354b3db0d3','alisa-140150ba526b6c3d','alisa-51d2a57db66647e0','alisa-e82003211bdcd687','alisa-dd2b59b99b00b7e4','alisa-07290e7c17f556bf','alisa-3e91b1aa5d405d0e','alisa-0f22ffbc3cd17bdb','alisa-b8a5d56e2e132ce5']
PROCESS_INODES=set()
def inventory_error(error):
 if error.errno not in {errno.ENOENT,errno.ESRCH}:raise RuntimeError('process_inventory_unreadable_live_entry') from None
def active():
 result={p.resolve().name for p in B.iterdir() if p.is_symlink()}
 def reference(value,path=None):
  prefix=str(B/'releases')+'/'
  if not value.startswith(prefix):return
  result.add(value[len(prefix):].split('/')[0])
  if path is not None:
   try:st=path.stat();PROCESS_INODES.add((st.st_dev,st.st_ino))
   except OSError as error:inventory_error(error)
 for index,proc in enumerate(pathlib.Path('/proc').iterdir()):
  if index>8192:raise RuntimeError('process_inventory_limit')
  if not proc.name.isdigit():continue
  for leaf in ['cwd','exe']:
   try:reference(os.readlink(proc/leaf),proc/leaf)
   except OSError as error:inventory_error(error)
  try:
   for value in (proc/'cmdline').read_bytes().decode(errors='replace').split('\0'):reference(value)
  except OSError as error:inventory_error(error)
  try:
   for number,fd in enumerate((proc/'fd').iterdir()):
    if number>16384:raise RuntimeError('process_fd_inventory_limit')
    try:reference(os.readlink(fd),fd)
    except OSError as error:inventory_error(error)
  except OSError as error:inventory_error(error)
  try:
   with (proc/'maps').open() as mapped:
    for number,line in enumerate(mapped):
     if number>131072:raise RuntimeError('process_mapping_inventory_limit')
     fields=line.split(maxsplit=5)
     if len(fields)<6:continue
     reference(fields[5].strip())
     if fields[5].strip().startswith(str(B/'releases')+'/') and int(fields[4]):
      major,minor=fields[3].split(':');PROCESS_INODES.add((os.makedev(int(major,16),int(minor,16)),int(fields[4])))
  except OSError as error:inventory_error(error)
 return result
def pointer_active():return {p.resolve().name for p in B.iterdir() if p.is_symlink()}

TARGET=B/'releases/alisa-c8666516683e7b2b'
record={'scope':'OWN_INACTIVE_C866_DEPENDENCIES_NO_ACTIVE_INODES','status':'FAILED','applied_links':0,'paths_removed':0,'active_inodes_touched':0,'cases':[]}
META=D/'inactive-c866-dependencies.metadata.private.json.gz'
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while block:=f.read(1048576):h.update(block)
 return h.hexdigest()
def check(n,v):
 record['cases'].append({'case':n,'passed':bool(v)})
 if not v:raise RuntimeError(n)
def main():
 check('fresh_receipt_and_reserve',not OUT.exists() and shutil.disk_usage(B).free>=3072*1048576+1048576)
 check('private_root_backup_parent',not D.is_symlink() and D.stat().st_uid==D.stat().st_gid==0 and stat.S_IMODE(D.stat().st_mode)==0o700 and not META.exists() and not META.is_symlink())
 protected=active();check('target_inactive',TARGET.name not in protected and not TARGET.is_symlink())
 check('exact_owned_inactive_target_manifest',digest(TARGET/'manifest.json')=='3287fa567545e9598a04e4ba57f7a484814e45195f6cd724bb0532c24b6606f5')
 for name in protected:
  root=B/'releases'/name
  if not root.is_dir():continue
  for p in root.rglob('*'):
   if p.is_file() and not p.is_symlink():s=p.stat();PROCESS_INODES.add((s.st_dev,s.st_ino))
 counts=collections.Counter();canon={}
 for name in OWN:
  if name in protected:continue
  root=B/'releases'/name
  if not root.is_dir() or root.is_symlink():continue
  check(name+'_own_manifest',json.loads((root/'manifest.json').read_text())['artifact_id']==name)
  for p in root.rglob('*'):
   if not p.is_file() or p.is_symlink():continue
   st=p.stat();counts[(st.st_dev,st.st_ino)]+=1
  canon[name]=root
 operations=[];gain=0
 def selected(p):
  n=str(p.relative_to(TARGET))
  return n.startswith('wheels/') or n.startswith('.venv/lib/python3.12/site-packages/') or (n.startswith('ui/') and '/node_modules/' in n)
 for p in sorted(TARGET.rglob('*')):
  if not p.is_file() or p.is_symlink() or not selected(p) or not p.resolve().is_relative_to(TARGET.resolve()):continue
  st=p.stat();key=(st.st_dev,st.st_ino)
  if st.st_size<32768 or st.st_nlink!=1 or st.st_uid!=0 or key in PROCESS_INODES:continue
  rel=p.relative_to(TARGET)
  for root in canon.values():
   src=root/rel
   if not src.is_file() or src.is_symlink() or not src.resolve().is_relative_to(root.resolve()):continue
   ss=src.stat();sk=(ss.st_dev,ss.st_ino)
   if sk in PROCESS_INODES or ss.st_nlink!=counts[sk] or (st.st_dev,st.st_size,st.st_mode,st.st_uid,st.st_gid)!=(ss.st_dev,ss.st_size,ss.st_mode,ss.st_uid,ss.st_gid):continue
   if os.listxattr(src)!=os.listxattr(p) or any(os.getxattr(src,x)!=os.getxattr(p,x) for x in os.listxattr(p)):continue
   sha=digest(p)
   if digest(src)!=sha:continue
   operations.append({'source':str(src),'target':str(p),'sha256':sha,'before':{'dev':st.st_dev,'ino':st.st_ino,'uid':st.st_uid,'gid':st.st_gid,'mode':st.st_mode,'size':st.st_size,'mtime_ns':st.st_mtime_ns,'ctime_ns':st.st_ctime_ns},'source_before':{'ino':ss.st_ino,'nlink':ss.st_nlink,'mtime_ns':ss.st_mtime_ns,'ctime_ns':ss.st_ctime_ns},'blocks':st.st_blocks*512});gain+=st.st_blocks*512;break
  if gain>=64*1048576:break
 if PLAN:
  record.update(status='PLAN_ONLY',planned_gain=gain,planned_links=len(operations),enough_gain=gain>=16*1048576,free_before=shutil.disk_usage(B).free)
  return
 check('enough_identical_inactive_owned_dependencies',gain>=16*1048576)
 fd=os.open(META,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
 with os.fdopen(fd,'wb') as raw:
  with gzip.GzipFile(fileobj=raw,mode='wb') as compressed:compressed.write(json.dumps(operations).encode())
 record['free_before']=shutil.disk_usage(B).free;record['planned_gain']=gain
 expected_links={}
 for op in operations:
  st=pathlib.Path(op['source']).stat();expected_links[(st.st_dev,st.st_ino)]=st.st_nlink
 for index,op in enumerate(operations):
  now=active();check('target_sources_still_inactive_'+str(index),TARGET.name not in now and not {pathlib.Path(o['source']).relative_to(B/'releases').parts[0] for o in operations}&now)
  p,src=pathlib.Path(op['target']),pathlib.Path(op['source']);st,ss=p.stat(),src.stat()
  check('safe_inodes_'+str(index),(st.st_dev,st.st_ino)==(op['before']['dev'],op['before']['ino']) and st.st_nlink==1 and (st.st_dev,st.st_ino) not in PROCESS_INODES and (ss.st_dev,ss.st_ino) not in PROCESS_INODES and ss.st_ino==op['source_before']['ino'] and ss.st_nlink==expected_links[(ss.st_dev,ss.st_ino)])
  check('equal_bytes_metadata_'+str(index),digest(p)==digest(src)==op['sha256'] and (st.st_mode,st.st_uid,st.st_gid,st.st_size)==(ss.st_mode,ss.st_uid,ss.st_gid,ss.st_size))
  temp=p.with_name('.s05-identical-'+uuid.uuid4().hex);os.link(src,temp,follow_symlinks=False);os.replace(temp,p);record['applied_links']+=1
  expected_links[(ss.st_dev,ss.st_ino)]+=1
 m=json.loads((TARGET/'manifest.json').read_text())
 check('complete_package_files_and_links_preserved',all(digest(TARGET/n)==h for n,h in m['files'].items()) and all(os.readlink(TARGET/n)==v for n,v in m['links'].items()))
 check('all_dependency_bytes_preserved',all(digest(pathlib.Path(o['target']))==o['sha256'] for o in operations))
 record['free_after']=shutil.disk_usage(B).free;record['status']='PASS';record['metadata_note']='Only identical inactive dependency code was linked. Paths/bytes/mode/owner preserved. New target mtime follows canonical; source and target nlink/ctime change. Original metadata retained privately.'
 record['concurrency_boundary']='Existing five rollout locks and one current author; complete process inventory immediately before each link. A residual process-start race after inspection remains; file bytes are identical and immutable.'
def secure_chain(path):
 for p in [*reversed(path.parents),path]:
  s=p.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_gid!=0 or s.st_mode&0o022:raise SystemExit('Untrusted directory chain')
if __name__=='__main__':
 secure_chain(B/'releases');secure_chain(D)
 if stat.S_IMODE(D.lstat().st_mode)!=0o700:raise SystemExit('Private namespace required')
 if OUT.exists() or OUT.is_symlink():raise SystemExit('Existing outcome retained; inspect before resume')
 with contextlib.ExitStack() as stack:
  directory_fd=os.open(D,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);stack.callback(os.close,directory_fd)
  for name in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as error:record['error_type']=type(error).__name__
  finally:
   fd=os.open(OUT.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory_fd)
   with os.fdopen(fd,'w') as output:output.write(json.dumps(record,indent=2)+'\n')
   print(json.dumps(record))
 sys.exit(0 if record['status'] in {'PASS','PLAN_ONLY'} else 1)

