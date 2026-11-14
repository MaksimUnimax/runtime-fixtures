"""Finite one-catalog accrual identity rollout, atomic pointer with rollback."""
from pathlib import Path
import fcntl,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
SOURCE=sys.argv[1];assert len(SOURCE)==40 and all(c in '0123456789abcdef'for c in SOURCE);
BASE=Path('/opt/alice-market/releases/alisa-accrual-cardinality-r1-20261114');CAND=Path('/opt/alice-market/candidates/alisa-accrual-day-speech-20261114');DEST=Path('/opt/alice-market/releases/alisa-accrual-day-speech-r1-20261114');POINTER=Path('/opt/alice-market/releases/current');CONFIG=Path('/etc/alice-market/market-runtime.json');TESTS=Path('/opt/alice-market/candidates/accrual-day-speech-tests-20261114')
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
 p=POINTER.with_name('current.accrual-day-speech-next');assert not p.exists()and not p.is_symlink();p.symlink_to(target);os.replace(p,POINTER)
with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert POINTER.resolve()==BASE,'BASE_CHANGED'
 assert sha(BASE/'manifest.json')=='a59d14e432f37bb1e4018e1404e442148df6fe3b8649093bbd03d81b4bba72ae'
 assert sha(CAND/'template_catalog.json')=='e4f0c38566fc49dabe82ff9fcd3c665dbf8b66c6a72cb2758e0039de85973ff8'
 assert sha(TESTS/'test_accrual_cardinality_context.py')=='8dfbd8b45bd936f8e760cf92f8b96d4d743887eb9b6d89b460a08bc145a8b6cc'
 assert 'Ran 147 tests'in (TESTS/'focused-final.log').read_text()and '\nOK\n'in (TESTS/'focused-final.log').read_text(),'CHECKS_NOT_PASS'
 assert active()==0,'ACTIVE_JOB_OR_CLARIFICATION'
 assert not DEST.exists(),'RELEASE_EXISTS'
 base_manifest=json.loads((BASE/'manifest.json').read_text())
 assert base_manifest['template_clarification_source']=='81579c18d4725c7f0a6603c8abbf703668863e36'
 for n,h in base_manifest['files'].items():assert sha(BASE/n)==h,('BASE_SOURCE_CHANGED',n)
 changed=[n for n,h in base_manifest['files'].items()if sha(CAND/n)!=h];assert changed==['template_catalog.json'],changed
 config_sha=sha(CONFIG)
 shutil.copytree(BASE,DEST,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__'))
 for name in ('template_catalog.json',):
  (DEST/name).unlink();shutil.copy2(CAND/name,DEST/name)
 m=json.loads((DEST/'manifest.json').read_text());m.update(artifact_id=DEST.name,source_commit=SOURCE,source_kind='exact_installed_base_plus_accrual_daily_speech_note',base_source_commit='cb35d89752ab6f866617278fa772b179205e9127',accrual_cardinality_source='cb35d89752ab6f866617278fa772b179205e9127',parallel_source_commit='81579c18d4725c7f0a6603c8abbf703668863e36',base_release=BASE.name,base_manifest_sha256=sha(BASE/'manifest.json'));m['files']={str(p.relative_to(DEST)):sha(p)for p in sorted(DEST.rglob('*'))if p.is_file()and p.name!='manifest.json'};pending=DEST/'manifest.next.json';pending.write_text(json.dumps(m,indent=2)+'\n');os.replace(pending,DEST/'manifest.json')
 assert sha(BASE/'manifest.json')=='a59d14e432f37bb1e4018e1404e442148df6fe3b8649093bbd03d81b4bba72ae'
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
  assert cmd('systemctl','is-active','alice-market')=='active'and sha(CONFIG)==config_sha
 except BaseException:
  cmd('systemctl','stop','alice-market');pointer(BASE);cmd('systemctl','start','alice-market');raise
 record={'status':'INSTALLED','source':SOURCE,'release':DEST.name,'base':BASE.name,'changed_payload_files':['template_catalog.json'],'catalog_sha256':sha(DEST/'template_catalog.json'),'config_unchanged':True,'preflight':preflight,'versions_preflight':versions,'checked_tests':147,'independent_review':'APPROVED'}
 (TESTS/'INSTALLED.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
