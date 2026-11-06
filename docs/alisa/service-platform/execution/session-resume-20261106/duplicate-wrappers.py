import pathlib,zipfile,hashlib,json,os,datetime,fcntl,contextlib,sys
os.umask(0o077)
B=pathlib.Path('/var/lib/alisa-platform/stage/artifacts');OUT=B.parent/'evidence/ALISA_SESSION_RESUME_DUPLICATE_WRAPPERS_20261106.json'
names=['s01-8d-qualified.zip','61007bf8-qualified.zip','3e763ad7-qualified.zip','alisa-6ae348354b3db0d3.tar.zip']
def sha(data):return hashlib.sha256(data).hexdigest()
r={'scope':'EXACT_DUPLICATE_WRAPPERS_ONLY','removed':[],'skipped':[],'retained_archives':[],'utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
with contextlib.ExitStack() as stack:
 for name in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
  f=stack.enter_context(open('/run/lock/'+name,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 r['free_before']=os.statvfs(B).f_bavail*os.statvfs(B).f_frsize
 for name in names:
  p=B/name
  if not p.is_file() or p.is_symlink():r['skipped'].append(name);continue
  with zipfile.ZipFile(p) as z:
   ms=z.namelist()
   if len(ms)!=2 or any('/' in x for x in ms) or not any(x.endswith('.tar.gz') for x in ms) or not any(x.endswith('.tar.gz.sha256') for x in ms):r['skipped'].append(name);continue
   if any(not (B/x).is_file() or (B/x).is_symlink() or (B/x).read_bytes()!=z.read(x) for x in ms):r['skipped'].append(name);continue
   tar=next(x for x in ms if x.endswith('.tar.gz'))
   if (B/(tar+'.sha256')).read_text().split()[0]!=sha((B/tar).read_bytes()):raise RuntimeError('retained checksum mismatch')
   r['retained_archives'].append({'archive':tar,'sha256':sha((B/tar).read_bytes()),'wrapper':name,'wrapper_sha256':sha(p.read_bytes()),'wrapper_bytes':p.stat().st_size})
  if '--apply' in sys.argv:p.unlink();r['removed'].append(name)
 r['free_after']=os.statvfs(B).f_bavail*os.statvfs(B).f_frsize
 r['status']='APPLIED' if '--apply' in sys.argv else 'PLANNED'
 OUT.write_text(json.dumps(r,indent=2));print(json.dumps(r))
