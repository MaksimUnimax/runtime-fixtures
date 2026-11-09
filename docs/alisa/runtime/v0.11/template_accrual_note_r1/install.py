"""Scoped runtime rollout. Unchanged release files share storage, never writes."""
import fcntl,hashlib,json,os,re,shutil,sqlite3,subprocess,tempfile,time
from pathlib import Path
BASE=Path('/opt/alice-market/releases/alisa-model-token-cost-r1-20261109')
TARGET=Path('/opt/alice-market/releases/alisa-accrual-note-r1-20261109')
CANDIDATE=Path('/dev/shm/alisa-accrual-note-20261109')
RECEIPT=Path('/root/alice-lab-evidence/answer-model-20261109/OZON_ACCRUAL_NOTE_INSTALLED.json')
SOURCE='f527f33b37b23eeda4fe933628c7ce9c44ba4c2e'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def show(prop):return subprocess.check_output(['systemctl','show','alice-market.service','-p',prop,'--value'],text=True).strip()
def command(*args):subprocess.run(args,check=True,capture_output=True,text=True)
def empty_queue():
 with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True)as c:
  assert c.execute("SELECT COUNT(*)FROM jobs WHERE state IN('QUEUED','RUNNING')").fetchone()[0]==0,'ACTIVE_JOBS'
def atomic(path,data):
 fd,name=tempfile.mkstemp(prefix='.model-token-cost-',dir=path.parent)
 try:
  os.fchmod(fd,0o644)
  with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(name,path)
 finally:Path(name).unlink(missing_ok=True)
def verify(root,manifest):
 assert all((root/n).is_file()and digest(root/n)==h for n,h in manifest['files'].items()),'MANIFEST_MISMATCH'
def main():
 expected=json.loads((CANDIDATE/'hashes.json').read_text())
 log=(CANDIDATE/'focused.log').read_text();matched=re.search(r'Ran (\d+) tests',log)
 assert matched and log.rstrip().endswith('OK'),'TEMPLATE_TESTS_NOT_PASSED'
 test_count=int(matched.group(1));assert test_count>=70,'INCOMPLETE_TEMPLATE_SUITE'
 assert show('WorkingDirectory')==str(BASE),'ACTIVE_BASE_CHANGED'
 original=json.loads((BASE/'manifest.json').read_text());verify(BASE,original)
 assert not TARGET.exists(),'TARGET_ALREADY_EXISTS_INSPECT_RECEIPT'
 assert all(digest(CANDIDATE/'runtime'/n)==h for n,h in expected.items()),'CANDIDATE_CHANGED'
 empty_queue()
 # Both directories are on the same filesystem. Replacing owned files detaches
 # them from shared inodes; no shared file is ever opened for writing.
 shutil.copytree(BASE,TARGET,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
 for n in expected:atomic(TARGET/n,(CANDIDATE/'runtime'/n).read_bytes())
 manifest=dict(original,artifact_id=TARGET.name,base_artifact=BASE.name,source_commit=SOURCE,
   parent_manifest_sha256=digest(BASE/'manifest.json'),files={str(p.relative_to(TARGET)):digest(p)for p in TARGET.rglob('*')if p.is_file()and p.name!='manifest.json'})
 atomic(TARGET/'manifest.json',json.dumps(manifest,indent=2).encode());verify(TARGET,manifest);verify(BASE,original)
 subprocess.run(['runuser','-u','alice-market','--','/usr/bin/python3','-B','/opt/alice-market/releases/runtime-policy-guard-20261108/check.py','--release',str(TARGET),'--config','/etc/alice-market/market-runtime.json'],check=True)
 directory=Path('/etc/systemd/system/alice-market.service.d')
 latest=max(directory.glob('*.conf'),key=lambda p:p.name)
 override=directory/(latest.stem+'z-accrual-note.conf');assert not override.exists(),'OVERRIDE_EXISTS'
 empty_queue();stopped=False
 try:
  command('systemctl','stop','alice-market.service');stopped=True;empty_queue()
  assert show('WorkingDirectory')==str(BASE),'BASE_CHANGED_DURING_STOP'
  atomic(override,('[Service]\nWorkingDirectory='+str(TARGET)+'\nExecStart=\nExecStart=/usr/bin/python3 -B '+str(TARGET)+'/runtime.py --config /etc/alice-market/market-runtime.json\n').encode())
  command('systemctl','daemon-reload');command('systemctl','start','alice-market.service')
  assert show('ActiveState')=='active'and show('WorkingDirectory')==str(TARGET),'NEW_RUNTIME_INACTIVE'
  verify(BASE,original);verify(TARGET,manifest)
  result=dict(state='INSTALLED',source_commit=SOURCE,base=str(BASE),runtime=str(TARGET),changed=list(expected),hashes=expected,base_unchanged=True,at=time.time(),tests=test_count,targeted_tests=test_count)
  RECEIPT.write_text(json.dumps(result,indent=2));print(json.dumps(result))
 except BaseException:
  if stopped:
   override.unlink(missing_ok=True);command('systemctl','daemon-reload');command('systemctl','restart','alice-market.service')
   assert show('ActiveState')=='active'and show('WorkingDirectory')==str(BASE),'ROLLBACK_FAILED'
  raise
if __name__=='__main__':
 with open('/run/lock/alisa-market-config.lock','a')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);main()
