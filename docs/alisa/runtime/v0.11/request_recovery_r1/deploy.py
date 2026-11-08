"""Install reviewed recovery release; preserve current config and user state."""
from pathlib import Path
import subprocess,json,hashlib,sqlite3,shutil,fcntl,time,os
BASE=Path('/opt/alice-market/releases/alisa-runtime-business-read-r2-20261108')
NEW=BASE.with_name('alisa-request-recovery-r3-20261108')
STATION=Path('/opt/alisa-station/releases/station-auto-r7-recovery')
OLD_STATION=STATION.with_name('station-auto-r6-session')
OLD_LAB=Path('/opt/alice-lab/releases/20261108-station-session-r1')
LAB=OLD_LAB.with_name('20261108-station-recovery-r2')
STATE=Path('/var/lib/alice-market');BACKUP=STATE/'request-recovery-20261108'
def run(*args):return subprocess.check_output(args,text=True,timeout=45).strip()
def prop(unit,p):return run('systemctl','show',unit,'--value','-p',p)
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
units=['alice-market.service','alisa-station.service','alice-lab-web.service']
locks=[]
for name in ['alisa-stage-rollout.lock','alisa-runtime-recovery.lock']:
 f=open('/run/lock/'+name,'w');fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);locks.append(f)
assert prop(units[0],'WorkingDirectory')==str(BASE),'CONCURRENT_RUNTIME_CHANGE'
assert prop(units[1],'WorkingDirectory')==str(OLD_STATION),'CONCURRENT_STATION_CHANGE'
assert str(OLD_LAB/'lab_entry.py') in prop(units[2],'ExecStart'),'CONCURRENT_LAB_CHANGE'
log=Path('/tmp/alisa-recovery-r2-confirmed.log').read_text()
assert '\nOK\n' in log and 'FAILED (' not in log,'FULL_SUITE_NOT_PASSED'
changed={'engine.py','repository.py','http_transport.py','shared_http.py','request_recovery.py','tests/test_request_recovery.py','tests/test_runtime.py','tests/test_query_program.py','manifest.json'}
for p in BASE.rglob('*'):
 if p.is_file() and '__pycache__' not in str(p) and str(p.relative_to(BASE)) not in changed:
  assert digest(p)==digest(NEW/p.relative_to(BASE)), 'BASE_FILE_CHANGED:'+str(p.relative_to(BASE))
assert '\nOK\n' in Path('/tmp/alisa-recovery-r3-focused.log').read_text(), 'FOCUSED_SUITE_NOT_PASSED'
assert shutil.disk_usage('/').free>500*1024*1024
BACKUP.mkdir(mode=0o700,exist_ok=True)
before={u:{'workdir':prop(u,'WorkingDirectory'),'exec':prop(u,'ExecStart')}for u in units}
(BACKUP/'before.json').write_text(json.dumps(before,indent=2))
with sqlite3.connect('file:'+str(STATE/'state.sqlite3')+'?mode=ro',uri=True)as c:
 assert c.execute("select count(*)from jobs where state in ('QUEUED','RUNNING')").fetchone()[0]==0,'USER_WORK_IN_PROGRESS'
 with sqlite3.connect(BACKUP/'before.sqlite3')as dst:c.backup(dst)
shutil.copytree(OLD_LAB,LAB,dirs_exist_ok=False)
targets=json.loads((LAB/'targets.json').read_text());spec=targets['alice-lab-web'];spec['target']=str(STATION/'alice_lab.py');spec['sha256']=digest(STATION/'alice_lab.py')
(LAB/'targets.json').write_text(json.dumps(targets,indent=2))
for root in [NEW,STATION]:
 manifest={'artifact_id':root.name,'source_commit':'13b012877b6514d482485ae2d390a1285b66d649','files':{str(p.relative_to(root)):digest(p)for p in root.rglob('*')if p.is_file()and '__pycache__'not in str(p)and p.name!='manifest.json'}}
 (root/'manifest.json').write_text(json.dumps(manifest,indent=2))
 # New files are root-owned readable code, never credentials.
 for p in root.rglob('*'):
  if p.is_dir():p.chmod(0o755)
  elif '__pycache__'not in str(p):p.chmod(0o644)
dropins=[];stopped=False
try:
 for u in ['alice-lab-web.service','alisa-station.service','alice-market.service']:run('systemctl','stop',u)
 stopped=True
 with sqlite3.connect('file:'+str(STATE/'state.sqlite3')+'?mode=ro',uri=True)as c:
  assert c.execute("select count(*)from jobs where state in ('QUEUED','RUNNING')").fetchone()[0]==0,'CONCURRENT_USER_REQUEST'
 for u,wd,command in [(units[0],NEW,f'/usr/bin/python3 -B {NEW}/runtime.py --config /etc/alice-market/market-runtime.json'),(units[1],STATION,f'/usr/bin/python3 -B {STATION}/service.py --state /var/lib/alisa-station --key /run/credentials/alisa-station.service/station-key'),(units[2],STATION,f'/usr/bin/python3 -B {LAB}/lab_entry.py alice-lab-web')]:
  directory=Path('/etc/systemd/system')/(u+'.d');directory.mkdir(exist_ok=True)
  width=max([len(x.name)-len(x.name.lstrip('z'))for x in directory.glob('*.conf')]+[0])+1
  dest=directory/('z'*width+'-request-recovery-r2.conf');dest.write_text(f'[Service]\nWorkingDirectory={wd}\nExecStart=\nExecStart={command}\n');dropins.append(dest)
 run('systemctl','daemon-reload')
 for u in units:run('systemctl','start',u)
 time.sleep(2)
 assert all(prop(u,'ActiveState')=='active'for u in units),'SERVICE_NOT_ACTIVE'
 assert prop(units[0],'WorkingDirectory')==str(NEW)
 receipt={'status':'INSTALLED','units':{u:prop(u,'WorkingDirectory')for u in units},'at':time.time(),'code_rollback':'remove only these drop-ins and restart; keep additive DB column','dropins':list(map(str,dropins))}
 (BACKUP/'installed.json').write_text(json.dumps(receipt,indent=2));print(json.dumps(receipt),flush=True)
except BaseException:
 for p in dropins:p.unlink(missing_ok=True)
 run('systemctl','daemon-reload')
 for u in units:run('systemctl','restart',u)
 raise
