import fcntl,hashlib,json,os,shutil,subprocess
from pathlib import Path
ROOT=Path('/root/alisa-coefficient-station-delivery-20261117-independent')
receipt=json.loads((ROOT/'CANDIDATES_PREPARED.json').read_text())
parents={'native':Path('/opt/alice-market/releases'),'platform':Path('/opt/alisa-platform/stage/releases'),'station':Path('/opt/alisa-station/releases')}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def status():
 units=['alice-market.service','alisa-platform@stage.service','alisa-web@stage.service','alisa-runtime-authority-stage.service','alisa-admin@stage.service','alisa-identity@stage.service','alisa-station.service','alisa-store-check.service','alisa-smtp-sandbox-stage.service']
 return {u:subprocess.check_output(['systemctl','show',u,'-p','ActiveState','-p','MainPID'],text=True)for u in units}
def verify(root,m):
 for n,h in m['files'].items():assert not(root/n).is_symlink() and sha(root/n)==h,(str(root),n)
 for n,t in m.get('links',{}).items():assert str((root/n).readlink())==t,n
def save(n,data):
 with (ROOT/n).open('x')as f:json.dump(data,f,indent=2,sort_keys=True);f.write('\n')
before=status();baseline={k:sha(Path(v['root'])/'manifest.json')for k,v in json.loads((ROOT/'ASSEMBLY_INTENT.json').read_text())['bases'].items()}
s=os.statvfs(ROOT);assert s.f_bavail*s.f_frsize>3*1024**3+150*1024**2
with Path('/run/lock/alisa-stage-rollout.lock').open('a')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 targets={}
 for k,r in receipt['candidates'].items():
  source=Path(r['root']);target=parents[k]/source.name
  assert not target.exists(),'STAGED_ALREADY_EXISTS'
  assert sha(source/'manifest.json')==r['manifest_sha256'];m=json.loads((source/'manifest.json').read_text());verify(source,m)
  targets[k]=str(target)
 save('STAGING_INTENT.json',{'targets':targets,'scope':'immutable code only, no selectors/env/service/database changes','service_generations':before})
 for k,r in receipt['candidates'].items():
  source=Path(r['root']);target=Path(targets[k]);shutil.copytree(source,target,symlinks=True)
  assert sha(target/'manifest.json')==r['manifest_sha256'];verify(target,json.loads((target/'manifest.json').read_text()))
 native=Path(targets['native'])
 checks={}
 for label,args in [
  ('native_configuration',['/usr/bin/python3','-B',str(native/'runtime.py'),'--config','/etc/alice-market/market-runtime.json','--check']),
  ('runtime_version_publication',['/usr/bin/python3','-I','-B','/usr/local/libexec/alisa/runtime_versions_sync.py','--source',str(native),'--check','--lock-fd',str(lock.fileno())])]:
  p=subprocess.run(args,capture_output=True,text=True,timeout=20,pass_fds=(lock.fileno(),),env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'})
  checks[label]={'returncode':p.returncode,'stdout':p.stdout[:2000],'stderr':p.stderr[:1000]}
  assert p.returncode==0,(label,checks[label])
 after=status();assert before==after,'LIVE_GENERATION_MOVED'
 assert all(sha(Path(v['root'])/'manifest.json')==baseline[k]for k,v in json.loads((ROOT/'ASSEMBLY_INTENT.json').read_text())['bases'].items())
 save('STAGED_CHECKED.json',{'status':'IMMUTABLE_CANDIDATES_STAGED_CHECKED_NOT_ACTIVATED','source_head':receipt['source_head'],'targets':targets,'manifest_sha256':{k:v['manifest_sha256']for k,v in receipt['candidates'].items()},'checks':checks,'services_unchanged':True,'migrations_or_permission_changes':False,'next_author_step':'qualify bounded activation and rollback; independent review of procedure before apply'})
 print(json.dumps({'status':'PASS','checks':checks,'targets':targets,'live_services_unchanged':True}))
