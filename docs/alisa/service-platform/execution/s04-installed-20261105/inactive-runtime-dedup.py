"""Finite inactive dependency-code dedup. No archives, data or active inodes."""
import os,errno,sys,pathlib,json,hashlib,stat,collections,datetime,gzip,shutil,fcntl,contextlib,uuid
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s04-access-20261105');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');OUT=E/'AL_S04_INACTIVE_RUNTIME_DEDUP_20261105.json'
OWN=['alisa-3e763ad761fac377','alisa-29c99f6d9d00f19e','alisa-61007bf870cf4f65','alisa-8d680f775c8ccdf2','alisa-6ae348354b3db0d3','alisa-140150ba526b6c3d','alisa-51d2a57db66647e0','alisa-e82003211bdcd687','alisa-dd2b59b99b00b7e4','alisa-07290e7c17f556bf','alisa-3e91b1aa5d405d0e','alisa-0f22ffbc3cd17bdb','alisa-b8a5d56e2e132ce5']
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
record={'scope':'S04_RESERVE_INACTIVE_OWN_RUNTIME_LIBRARY_CODE_ONLY','status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'applied_links':0,'archives_or_version_paths_removed':0,'active_inodes_touched':0,'metadata_note':'Inactive dependency target mtime follows canonical; source/target nlink and ctime plus parent directory times change. ctime is not restorable. Before/after file metadata retained privately.'}
def check(n,ok):
 record['cases'].append({'case':n,'passed':bool(ok)})
 if not ok:raise RuntimeError(n)
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1048576):h.update(b)
 return h.hexdigest()
def facts(st):return {k:getattr(st,k) for k in ['st_dev','st_ino','st_uid','st_gid','st_mode','st_size','st_nlink','st_mtime_ns','st_ctime_ns']}
def run():
 assert not OUT.exists();ops=[];canonical_before={};mhash={}
 try:
  check('root_and_metadata_reserve',os.geteuid()==0 and shutil.disk_usage(B).free//1048576>=3088)
  protected=active();active_inodes=set(PROCESS_INODES)
  for name in protected:
   root=B/'releases'/name
   if not root.is_dir():continue
   for p in root.rglob('*'):
    if p.is_file() and not p.is_symlink():st=p.stat();active_inodes.add((st.st_dev,st.st_ino))
  check('complete_active_and_process_inode_inventory',True)
  groups=collections.defaultdict(list);count=collections.Counter();targets=[]
  for name in OWN:
   root=B/'releases'/name
   if name in protected or not root.is_dir():continue
   check(name+'_owned_inactive_namespace',not root.is_symlink() and json.loads((root/'manifest.json').read_text())['artifact_id']==name);mhash[name]=digest(root/'manifest.json')
   site=root/'.venv/lib/python3.12/site-packages'
   if not site.is_dir():continue
   targets.append(name)
   for p in site.rglob('*'):
    if not p.is_file() or p.is_symlink() or not p.resolve().is_relative_to(root.resolve()):continue
    st=p.stat()
    if st.st_uid!=0 or (st.st_dev,st.st_ino) in active_inodes:continue
    sha=digest(p);key=(sha,st.st_size,stat.S_IMODE(st.st_mode),st.st_uid,st.st_gid,st.st_dev);groups[key].append((p,st));count[(st.st_dev,st.st_ino)]+=1
  check('nonempty_owned_inactive_library_scope',bool(targets));record['target_releases']=targets
  for key,items in groups.items():
   eligible=[(p,st) for p,st in items if st.st_nlink==count[(st.st_dev,st.st_ino)]]
   if len(eligible)<2:continue
   src,ss=eligible[0];seen={(ss.st_dev,ss.st_ino)}
   for p,st in eligible[1:]:
    inode=(st.st_dev,st.st_ino)
    if inode in seen:continue
    seen.add(inode)
    if st.st_nlink!=1:continue
    ops.append({'source':str(src),'target':str(p),'sha256':key[0],'before':facts(st),'allocated_bytes':st.st_blocks*512})
    canonical_before.setdefault(str(src),facts(ss))
  check('nonzero_safe_identical_dependencies',bool(ops));record['planned_links']=len(ops);record['disk_before_mib']=shutil.disk_usage(B).free//1048576
  private={'operations':ops,'canonical_before':canonical_before}
  with gzip.open(D/'runtime-dedup-metadata.private.json.gz','wt') as f:json.dump(private,f)
  OUT.write_text(json.dumps(record,indent=2))
  for number,op in enumerate(ops):
   p,src=pathlib.Path(op['target']),pathlib.Path(op['source']);st,ss=p.stat(),src.stat()
   if number%500==0:
    current=active();check('targets_still_inactive_'+str(number),not set(targets)&current)
    active_inodes.update(PROCESS_INODES)
    for name in current:
     root=B/'releases'/name
     if not root.is_dir():continue
     for file in root.rglob('*'):
      if file.is_file() and not file.is_symlink():observed=file.stat();active_inodes.add((observed.st_dev,observed.st_ino))
   if (st.st_dev,st.st_ino) in active_inodes or (ss.st_dev,ss.st_ino) in active_inodes:raise RuntimeError('active_inode_detected')
   if st.st_nlink!=1 or st.st_ino!=op['before']['st_ino'] or st.st_dev!=op['before']['st_dev']:raise RuntimeError('target_drift')
   if (st.st_size,stat.S_IMODE(st.st_mode),st.st_uid,st.st_gid)!=(ss.st_size,stat.S_IMODE(ss.st_mode),ss.st_uid,ss.st_gid):raise RuntimeError('metadata_mismatch')
   if digest(p)!=op['sha256'] or digest(src)!=op['sha256']:raise RuntimeError('content_drift')
   temp=p.with_name('.s04-runtime-link-'+uuid.uuid4().hex);os.link(src,temp,follow_symlinks=False);os.replace(temp,p);record['applied_links']+=1
  for op in ops:
   p=pathlib.Path(op['target']);check_ok=digest(p)==op['sha256'];op['after']=facts(p.stat())
   if not check_ok:raise RuntimeError('post_dedup_content_mismatch')
  private['canonical_after']={n:facts(pathlib.Path(n).stat()) for n in canonical_before}
  check('original_dependency_bytes_modes_owners_preserved',all(all(op['before'][k]==op['after'][k] for k in ['st_size','st_mode','st_uid','st_gid']) for op in ops))
  check('release_manifests_untouched',all(digest(B/'releases'/n/'manifest.json')==h for n,h in mhash.items()))
  check('all_planned_links_applied',record['applied_links']==len(ops));record['disk_after_mib']=shutil.disk_usage(B).free//1048576
  record['gain_mib']=record['disk_after_mib']-record['disk_before_mib'];record['installation_admission']='NOT_GRANTED_REQUIRES_FRESH_EXACT_PACKAGE_BUDGET';record['status']='PASS'
 except Exception as error:
  record['status']='FAILED';record['error_type']=type(error).__name__;record['failed_case']=str(error) if isinstance(error,RuntimeError) else None
 finally:
  if ops:
   with gzip.open(D/'runtime-dedup-metadata.private.json.gz','wt') as f:json.dump({'operations':ops,'canonical_before':canonical_before,'canonical_after':{n:facts(pathlib.Path(n).stat()) for n in canonical_before}},f)
   record['metadata_sha256']=digest(D/'runtime-dedup-metadata.private.json.gz')
  record['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(record,indent=2));print(json.dumps(record))
 return record['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for name in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+name,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
