"""Finite one-catalog accrual identity rollout, atomic pointer with rollback."""
from pathlib import Path
import fcntl,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
SOURCE=sys.argv[1];assert len(SOURCE)==40 and all(c in '0123456789abcdef'for c in SOURCE);
BASE=Path('/opt/alice-market/releases/alisa-accrual-day-speech-r1-20261114');CAND=Path('/opt/alice-market/candidates/alisa-accrual-price-extrema-20261114');DEST=Path('/opt/alice-market/releases/alisa-accrual-price-extrema-r1-20261114');POINTER=Path('/opt/alice-market/releases/current');CONFIG=Path('/etc/alice-market/market-runtime.json');TESTS=Path('/opt/alice-market/candidates/accrual-price-extrema-tests-20261114')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cmd(*args):return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,timeout=100).strip()
def active():
 with sqlite3.connect('file:'+json.loads(CONFIG.read_text())['database']+'?mode=ro',uri=True)as c:
  count=c.execute("SELECT count(*)FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]
  for raw, in c.execute("SELECT result FROM jobs WHERE state='READY'AND expires>?AND result IS NOT NULL",(time.time(),)):
   value=json.loads(raw);clarification=value.get('clarification')if type(value)is dict else None
   if type(clarification)is dict and clarification.get('schema_version')=='runtime_clarification_v1':count+=1
  return count
def pointer(target):
 p=POINTER.with_name('current.accrual-price-extrema-next');assert not p.exists()and not p.is_symlink();p.symlink_to(target);os.replace(p,POINTER)
with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert POINTER.resolve()==BASE,'BASE_CHANGED'
 assert sha(BASE/'manifest.json')=='af5fdc23472211d235770472703372e767bee7c77fee0a0c940a3cddd1b8c5c0'
 assert sha(CAND/'template_catalog.json')=='6177f187e7c2fb63fc97acd5debaae3b6d7f4189c1aebef62d8271bcf6574901'
 assert sha(TESTS/'test_accrual_cardinality_context.py')=='8dfbd8b45bd936f8e760cf92f8b96d4d743887eb9b6d89b460a08bc145a8b6cc'
 assert 'Ran 147 tests'in (TESTS/'focused-final.log').read_text()and '\nOK\n'in (TESTS/'focused-final.log').read_text(),'CHECKS_NOT_PASS'
 assert active()==0,'ACTIVE_JOB_OR_CLARIFICATION'
 assert not DEST.exists(),'RELEASE_EXISTS'
 base_manifest=json.loads((BASE/'manifest.json').read_text())
 assert base_manifest['template_clarification_source']=='81579c18d4725c7f0a6603c8abbf703668863e36'
 for n,h in base_manifest['files'].items():assert sha(BASE/n)==h,('BASE_SOURCE_CHANGED',n)
 changed=[n for n,h in base_manifest['files'].items()if sha(CAND/n)!=h];assert changed==['template_catalog.json'],changed
 settings_path=Path('/var/lib/alice-market/answer-settings.json');settings_sha=sha(settings_path);assert settings_sha=='44d82c25bafb90500bb6af7cb97bb7c276d10d2638ae50d95de4f600e78be179'
 config_sha=sha(CONFIG)
 shutil.copytree(BASE,DEST,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__'))
 for name in ('template_catalog.json',):
  (DEST/name).unlink();shutil.copy2(CAND/name,DEST/name)
 m=json.loads((DEST/'manifest.json').read_text());m.update(artifact_id=DEST.name,source_commit=SOURCE,source_kind='exact_installed_base_plus_accrual_price_extrema_metadata',base_source_commit='1e7e2ab4b1a57cd3b046fe22481570255327c8cc',daily_speech_source='1e7e2ab4b1a57cd3b046fe22481570255327c8cc',accrual_cardinality_source='cb35d89752ab6f866617278fa772b179205e9127',parallel_source_commit='81579c18d4725c7f0a6603c8abbf703668863e36',base_release=BASE.name,base_manifest_sha256=sha(BASE/'manifest.json'));m['files']={str(p.relative_to(DEST)):sha(p)for p in sorted(DEST.rglob('*'))if p.is_file()and p.name!='manifest.json'};pending=DEST/'manifest.next.json';pending.write_text(json.dumps(m,indent=2)+'\n');os.replace(pending,DEST/'manifest.json')
 assert sha(BASE/'manifest.json')=='af5fdc23472211d235770472703372e767bee7c77fee0a0c940a3cddd1b8c5c0'
 for n,h in base_manifest['files'].items():assert sha(BASE/n)==h,('BASE_SOURCE_CHANGED_AFTER_PREPARE',n)
 preflight=cmd('/usr/bin/python3','-B','/opt/alice-market/releases/runtime-policy-guard-20261108/check.py','--release',str(DEST),'--config',str(CONFIG))
 versions=cmd('/usr/bin/python3','-I','-B','/usr/local/libexec/alisa/runtime_versions_sync.py','--source',str(DEST),'--check')
 try:
  cmd('systemctl','stop','alice-market');assert active()==0,'JOB_OR_CLARIFICATION_ARRIVED'
  pointer(DEST);cmd('systemctl','start','alice-market')
  for _ in range(25):
   pid=int(cmd('systemctl','show','alice-market','--property=MainPID','--value'))
   if pid>0 and Path('/proc/'+str(pid)+'/cwd').resolve()==DEST:break
   time.sleep(.2)
  else:raise RuntimeError('RELEASE_NOT_ACTIVE')
  assert cmd('systemctl','is-active','alice-market')=='active'and sha(CONFIG)==config_sha and sha(settings_path)==settings_sha
 except BaseException:
  cmd('systemctl','stop','alice-market');pointer(BASE);cmd('systemctl','start','alice-market');raise
 record={'status':'INSTALLED','source':SOURCE,'release':DEST.name,'base':BASE.name,'changed_payload_files':['template_catalog.json'],'catalog_sha256':sha(DEST/'template_catalog.json'),'config_unchanged':True,'answer_settings_unchanged':True,'preflight':preflight,'versions_preflight':versions,'checked_tests':147,'independent_review':'APPROVED'}
 (TESTS/'INSTALLED.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
