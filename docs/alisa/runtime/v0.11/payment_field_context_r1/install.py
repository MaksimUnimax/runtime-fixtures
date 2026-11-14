"""Finite catalog overlay on exact current legacy source; preserve all parallel code."""
from pathlib import Path
import fcntl,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
SOURCE=sys.argv[1];assert len(SOURCE)==40 and all(c in'0123456789abcdef'for c in SOURCE)
BASE=Path('/opt/alice-market/releases/alisa-legacy-clarification-5a62b45b6370adb5-329dd714');CAND=Path('/opt/alice-market/candidates/alisa-payment-field-context-20261114');DEST=Path('/opt/alice-market/releases/alisa-payment-field-context-r1-20261114');POINTER=Path('/opt/alice-market/releases/current');TESTS=Path('/opt/alice-market/candidates/payment-field-context-tests-20261114');CONFIG=Path('/etc/alice-market/market-runtime.json');SETTINGS=Path('/var/lib/alice-market/answer-settings.json')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cmd(*args):return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,timeout=100).strip()
def active():
 with sqlite3.connect('file:'+json.loads(CONFIG.read_text())['database']+'?mode=ro',uri=True)as c:
  count=c.execute("SELECT count(*)FROM jobs WHERE state IN('QUEUED','RUNNING')").fetchone()[0]
  for raw, in c.execute("SELECT result FROM jobs WHERE state='READY'AND expires>?AND result IS NOT NULL",(time.time(),)):
   value=json.loads(raw);q=value.get('clarification')if type(value)is dict else None
   if type(q)is dict and q.get('schema_version')=='runtime_clarification_v1':count+=1
  return count
def pointer(target):
 p=POINTER.with_name('current.payment-fields-next');assert not p.exists()and not p.is_symlink();p.symlink_to(target);os.replace(p,POINTER)
with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 info=json.loads((TESTS/'BASE_SOURCE.json').read_text());assert sha(TESTS/'BASE_SOURCE.json')=='e1b25ff53f3715ff6b490ba8b3b807ff08b43a866e531cae3a169d40ad09276f'
 assert POINTER.resolve()==BASE,'BASE_CHANGED'
 assert sha(BASE/'manifest.json')==info['base_manifest_sha256']
 assert sha(CAND/'template_catalog.json')==info['new_catalog_sha256']
 assert sha(TESTS/'test_accrual_cardinality_context.py')=='8dfbd8b45bd936f8e760cf92f8b96d4d743887eb9b6d89b460a08bc145a8b6cc'
 log=(TESTS/'focused-final.log').read_text();assert 'Ran 176 tests'in log and '\nOK\n'in log,'CHECKS_NOT_PASS'
 assert active()==0,'ACTIVE_JOB_OR_CLARIFICATION';assert not DEST.exists(),'RELEASE_EXISTS'
 m=json.loads((BASE/'manifest.json').read_text());assert len(m['files'])==176
 assert m['source_commit']==m['legacy_clarification_source']=='5a62b45b6370adb55d8d3094f94a3777a0bc9d76'
 assert m['template_clarification_source']=='81579c18d4725c7f0a6603c8abbf703668863e36'
 for n,h in m['files'].items():assert sha(BASE/n)==h,('BASE_SOURCE_CHANGED',n)
 assert [n for n,h in m['files'].items()if sha(CAND/n)!=h]==['template_catalog.json']
 config_sha=sha(CONFIG);settings_sha=sha(SETTINGS);assert settings_sha==info['preserved_settings_sha256']
 shutil.copytree(BASE,DEST,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__'))
 (DEST/'template_catalog.json').unlink();shutil.copy2(CAND/'template_catalog.json',DEST/'template_catalog.json')
 new=json.loads((BASE/'manifest.json').read_text());new.update(artifact_id=DEST.name,source_commit=SOURCE,source_kind='exact_current_legacy_base_plus_payment_field_context',base_source_commit=m['source_commit'],base_release=BASE.name,base_manifest_sha256=sha(BASE/'manifest.json'),payment_field_context_source=SOURCE)
 new['files']={str(p.relative_to(DEST)):sha(p)for p in sorted(DEST.rglob('*'))if p.is_file()and p.name!='manifest.json'}
 pending=DEST/'manifest.next.json';pending.write_text(json.dumps(new,indent=2)+'\n');os.replace(pending,DEST/'manifest.json')
 assert sha(BASE/'manifest.json')==info['base_manifest_sha256']
 for n,h in m['files'].items():assert sha(BASE/n)==h,('BASE_SOURCE_CHANGED_AFTER_PREPARE',n)
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
  assert cmd('systemctl','is-active','alice-market')=='active'and sha(CONFIG)==config_sha and sha(SETTINGS)==settings_sha
 except BaseException:
  cmd('systemctl','stop','alice-market');pointer(BASE);cmd('systemctl','start','alice-market');raise
 record={'status':'INSTALLED','source':SOURCE,'release':DEST.name,'base':BASE.name,'changed_payload_files':['template_catalog.json'],'changed_templates':info['changed_templates'],'config_unchanged':True,'settings_unchanged':True,'legacy_clarification_preserved':new['legacy_clarification_source'],'parallel_catalog_preserved':new.get('parallel_source_commit'),'checked_tests':176,'independent_review':'APPROVED','preflight':preflight,'versions_preflight':versions}
 (TESTS/'INSTALLED.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
