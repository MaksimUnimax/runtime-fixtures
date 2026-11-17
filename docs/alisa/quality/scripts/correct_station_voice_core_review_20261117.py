import fcntl,hashlib,importlib.util,json,subprocess,os
from pathlib import Path
R=Path('/root/alisa-coefficient-station-delivery-20261117-independent')
A=Path('/root/alisa-coefficient-station-prepare-20261117')
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def save(name,data):
 p=R/name
 with p.open('x')as f:json.dump(data,f,indent=2,sort_keys=True);f.write('\n')
source=A/'assemble_candidates.py';assert sha(source)=='9477ae87b6243c20545b5c95e27f0e9f5141c9b5d1862b3642b1da24d0f45c2c'
spec=importlib.util.spec_from_file_location('reviewed_closed_assembly',source);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
base=Path('/opt/alice-market/releases/alisa-economics-r15-native-cafb743c94672104')
pin='4e49ab8da6f88fce1c5672d2960b536f5043d1e942c28ef3e18117c1f33c86d7'
assert sha(base/'manifest.json')==pin
old=json.loads((base/'manifest.json').read_text())
private=json.loads((R/'CANDIDATES_PREPARED.json').read_text())['candidates']['native']
source_root=Path(private['root']);assert sha(source_root/'manifest.json')==private['manifest_sha256']
candidate_manifest=json.loads((source_root/'manifest.json').read_text())
delta=R/'core-corrected-delta-r2';assert not delta.exists();delta.mkdir(mode=0o700)
changes={}
for name in ('runtime_port_ipc.py','station_parameter_proxy.py','CURRENT_CORE_MANIFEST.json'):
 p=delta/name;p.write_bytes((source_root/name).read_bytes());p.chmod(0o444)
 changes[name]={'before':old['files'].get(name),'after':sha(p)}
core=json.loads((delta/'CURRENT_CORE_MANIFEST.json').read_text())
expected={**old['files'],**{n:h['after']for n,h in changes.items()}}
assert core['files']=={n:h for n,h in expected.items()if n!='CURRENT_CORE_MANIFEST.json'}
target=base.parent/'alisa-coefficient-station-native-485a2034ac0dc36f-core-r2'
assert not target.exists()
before=subprocess.check_output(['systemctl','show','alice-market.service','alisa-platform@stage.service','alisa-station.service','-p','ActiveState','-p','MainPID'],text=True)
save('CORE_CORRECTION_R2_INTENT.json',{'target':str(target),'base':str(base),'base_manifest_sha256':pin,'assembler_sha256':sha(source),'delta':changes,'service_state':before,'scope':'new inactive native candidate; no in-place edit, selector/service/env/database action'})
steps=[]
def record(value):
 steps.append(value);tmp=R/'CORE_CORRECTION_R2_STEPS.tmp';tmp.write_text(json.dumps(steps,indent=2)+'\n');os.replace(tmp,R/'CORE_CORRECTION_R2_STEPS.json')
with Path('/run/lock/alisa-stage-rollout.lock').open('a')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert Path('/opt/alice-market/releases/current').resolve()==base
 result=mod.assemble('native',base,target,pin,delta,changes,record)
 m=json.loads((target/'manifest.json').read_text());c=json.loads((target/'CURRENT_CORE_MANIFEST.json').read_text())
 assert c['files']=={n:h for n,h in m['files'].items()if n!='CURRENT_CORE_MANIFEST.json'}
 assert m['files']==candidate_manifest['files'],'PAYLOAD_DIFFERS_FROM_REVIEWED_PRIVATE'
 checks={}
 for label,args in [('native_config',['/usr/bin/python3','-B',str(target/'runtime.py'),'--config','/etc/alice-market/market-runtime.json','--check']),('versions',['/usr/bin/python3','-I','-B','/usr/local/libexec/alisa/runtime_versions_sync.py','--source',str(target),'--check','--lock-fd',str(lock.fileno())])]:
  p=subprocess.run(args,capture_output=True,text=True,timeout=20,pass_fds=(lock.fileno(),),env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1'})
  checks[label]={'returncode':p.returncode,'stdout':p.stdout[:2000],'stderr':p.stderr[:1000]};assert p.returncode==0,(label,checks[label])
 after=subprocess.check_output(['systemctl','show','alice-market.service','alisa-platform@stage.service','alisa-station.service','-p','ActiveState','-p','MainPID'],text=True)
 assert before==after and sha(base/'manifest.json')==pin
save('CORE_CORRECTION_R2_RESULT.json',{'status':'CORRECTED_IMMUTABLE_NATIVE_CANDIDATE_CHECKED_NOT_SELECTED','candidate':result,'core_equals_outer_except_self':True,'matches_independent_reviewed_payload':True,'checks':checks,'live_service_generations_unchanged':True,'new_migration_permission_or_coefficient':False,'remaining':'bounded activation/rollback qualification and independent delivery approval'})
print(json.dumps({'status':'PASS','candidate':result,'core_equals_outer_except_self':True,'checks':checks,'receipt_sha256':sha(R/'CORE_CORRECTION_R2_RESULT.json')}))
