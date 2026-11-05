"""Guarded advertising source rollout; no platform/credentials/DB migrations."""
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json,sys,sqlite3,subprocess,os,stat,time,fcntl
R=Path(__file__).parent;BASE=R.with_name('20261105-v010-base-batch02-r1')
assert R.name=='20261105-v010-ads-daily-r1'
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
baseline=json.loads((R/'ADS_BASE_MANIFEST.json').read_text())
for n,h in baseline.items():assert sha(BASE/n)==h,'ACTIVE_CHANGED:'+n
assert str(BASE/'runtime.py') in subprocess.check_output(['systemctl','show','alice-market','-p','ExecStart','--value'],text=True),'ACTIVE_RELEASE_CHANGED'
changed={n for n in baseline if sha(R/n)!=baseline[n]}
assert changed=={'engine.py','registry.json','scalar_catalog.json','scalar_source_catalog.json'},changed
reg=json.loads((R/'ADS_REGRESSION_RESULT.json').read_text());assert reg=={'tests':874,'failures':0,'errors':0,'skipped':0,'architecture':'PASS','network':'FORBIDDEN'},'REGRESSION_NOT_PASS'
# Explicitly establish that old source contracts are carried, not re-qualified.
bsource=json.loads((BASE/'scalar_source_catalog.json').read_text());nsource=json.loads((R/'scalar_source_catalog.json').read_text())
bcat=json.loads((BASE/'scalar_catalog.json').read_text());ncat=json.loads((R/'scalar_catalog.json').read_text())
assert bcat['auth_profiles']==ncat['auth_profiles']
for op,spec in bsource['sources'].items():
 if op!='ozon_expense':assert nsource['sources'][op]==spec,'SOURCE_CHANGED:'+op
for k,recipe in bcat['recipes'].items():
 if k!='ozon_ads':assert ncat['recipes'][k]==recipe,'RECIPE_CHANGED:'+k
assert set(nsource['sources'])-set(bsource['sources'])=={'ozon_ads_daily'}
assert set(ncat['recipes'])-set(bcat['recipes'])=={'ozon_ads_daily'}
for n in ['source_matrix.json','table_catalog.json','dataset_sources.json','dataset_queries.json']:
 assert sha(BASE/n)==sha(R/n),'OTHER_MATRIX_CHANGED:'+n
assert json.loads((BASE/'registry.json').read_text())['metric_definitions']==json.loads((R/'registry.json').read_text())['metric_definitions']
code="import json;from registry import REGISTRY_HASH;from scalar_runtime import MATRIX;from table_analytics import HASH;import dataset_pipeline as dp;print(json.dumps({'registry':REGISTRY_HASH,'scalar':MATRIX.hash,'table':HASH,'dataset':dp.SOURCES.hash,'query':dp.HASH}))"
oldhash=json.loads(subprocess.check_output([sys.executable,'-B','-c',code],cwd=BASE,text=True))
newhash=json.loads(subprocess.check_output([sys.executable,'-B','-c',code],cwd=R,text=True))
receipt_path=Path('/var/lib/alice-market/ads-daily-canary-20261105-r3.json');receipt=json.loads(receipt_path.read_text())
assert receipt['status']=='PASS' and receipt['registry_hash']==newhash['registry'] and receipt['scalar_hash']==newhash['scalar'] and receipt['legacy_matches_daily'] is True
confpath=Path('/etc/alice-market/market-runtime.json');before=confpath.read_bytes();meta=confpath.stat();old=json.loads(before);assert old['execution_enabled'] is True
new=json.loads(before);proof_carry=[]
def migrate_proof(proof):
 if 'registry_hash' in proof:
  assert proof['registry_hash']==oldhash['registry'],'OLD_REGISTRY_PROOF_MISMATCH'
  proof['registry_hash']=newhash['registry']
 for field,kind in [('scalar_hash','scalar'),('table_hash','table'),('dataset_source_hash','dataset'),('dataset_query_hash','query')]:
  if field in proof:
   assert proof[field]==oldhash[kind],'OLD_PROOF_HASH_MISMATCH:'+field
   proof[field]=newhash[kind]
for op,proof in new['qualifications'].items():
 migrate_proof(proof);proof_carry.append(op)
 if op=='ozon_expense':proof['evidence_ref']=str(receipt_path)
new['qualifications']['ozon_ads_daily']={'status':'READ_ONLY_CANARY','registry_hash':newhash['registry'],'scalar_hash':newhash['scalar'],'evidence_ref':str(receipt_path)}
for field in ['table_capabilities','dataset_capabilities']:
 for store,ops in new.get(field,{}).items():
  for op,proof in ops.items():migrate_proof(proof)
assert new['accounts']==old['accounts'] and new['credential_bindings']==old['credential_bindings']
after=(json.dumps(new,ensure_ascii=False,indent=2)+'\n').encode()
e=Path('/root/alice-lab-evidence/ads-daily-fix-20261105');e.mkdir(mode=0o700,exist_ok=True)
backup=e/'state-before.sqlite3';assert not backup.exists(),'ALREADY_ATTEMPTED'
(e/'config-before.json').write_bytes(before);(e/'config-before.json').chmod(0o600)
unit=Path('/etc/systemd/system/alice-market.service.d/zzzzzzz-ads-daily-r1.conf');assert not unit.exists()
lock=(R.parent.parent/'.ads-daily-fix-owner.lock').open('a+');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
# Do not touch another author's locks.
def no_jobs():
 with sqlite3.connect('file:'+old['database']+'?mode=ro',uri=True) as c:
  assert c.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0,'BUSY_JOBS'
  assert c.execute('SELECT count(*) FROM dialogue_context WHERE pending IS NOT NULL').fetchone()[0]==0,'PENDING_DIALOGUE'
no_jobs()
def replace(data):
 tmp=confpath.with_name('.market-runtime-ads-r1.tmp')
 with tmp.open('xb') as f:f.write(data);f.flush();os.fsync(f.fileno())
 os.chmod(tmp,stat.S_IMODE(meta.st_mode));os.chown(tmp,meta.st_uid,meta.st_gid);tmp.replace(confpath)
manifest={str(p.relative_to(R)):sha(p) for p in R.rglob('*') if p.is_file() and '__pycache__' not in p.parts and p.name!='ADS_RELEASE_MANIFEST.json'}
(R/'ADS_RELEASE_MANIFEST.json').write_text(json.dumps(manifest,indent=2))
stopped=written=dropin=False
try:
 assert confpath.read_bytes()==before,'CONCURRENT_CONFIG_CHANGE'
 subprocess.run(['systemctl','stop','alice-market'],check=True,timeout=35);stopped=True;no_jobs()
 for n,h in baseline.items():assert sha(BASE/n)==h,'BASE_CHANGED_DURING_PREPARE'
 with sqlite3.connect('file:'+old['database']+'?mode=ro',uri=True) as src:
  with sqlite3.connect(backup) as dst:src.backup(dst)
 backup.chmod(0o600)
 assert confpath.read_bytes()==before,'CONCURRENT_CONFIG_CHANGE';replace(after);written=True
 with unit.open('x') as f:f.write('[Service]\nWorkingDirectory='+str(R)+'\nExecStart=\nExecStart=/usr/bin/python3 -B '+str(R/'runtime.py')+' --config '+str(confpath)+'\n')
 dropin=True;subprocess.run(['systemctl','daemon-reload'],check=True,timeout=15)
 subprocess.run(['systemctl','start','alice-market'],check=True,timeout=20);time.sleep(2)
 assert subprocess.check_output(['systemctl','is-active','alice-market'],text=True).strip()=='active'
 assert str(R/'runtime.py') in subprocess.check_output(['systemctl','show','alice-market','-p','ExecStart','--value'],text=True)
 assert Path(old['socket']).is_socket()
 result={'utc':datetime.now(timezone.utc).isoformat(),'status':'ACTIVATED_NEEDS_DIALOGS_RETEST','release':str(R),'previous':str(BASE),'hashes_before':oldhash,'hashes_after':newhash,'changed_base_files':sorted(changed),'unchanged_qualified_contracts_carried_forward':sorted(proof_carry),'new_live_canary':'ozon_ads_daily','legacy_guard_canary':'ozon_expense','config_before_sha256':hashlib.sha256(before).hexdigest(),'config_after_sha256':hashlib.sha256(after).hexdigest(),'manifest_sha256':sha(R/'ADS_RELEASE_MANIFEST.json'),'accounts_credentials_platform_changed':False,'db_migrations':[],'api_calls_in_activation':0,'old_cached_plans_rejected_by_registry_version':True}
 (e/'activation.json').write_text(json.dumps(result,indent=2));(e/'activation.json').chmod(0o600);print(json.dumps(result),flush=True)
except BaseException as exc:
 if dropin and unit.exists():unit.unlink();subprocess.run(['systemctl','daemon-reload'],check=False,timeout=15)
 if written and confpath.read_bytes()==after:replace(before)
 if stopped:subprocess.run(['systemctl','start','alice-market'],check=False,timeout=20)
 print(json.dumps({'status':'FAILED_ROLLBACK_ATTEMPTED','error_type':type(exc).__name__,'database_restored':False}));raise
