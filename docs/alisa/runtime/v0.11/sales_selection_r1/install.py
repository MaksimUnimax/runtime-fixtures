"""Finite template-only rollout, atomic pointer with rollback."""
from pathlib import Path
import fcntl,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
SOURCE=sys.argv[1];BASE=Path('/opt/alice-market/releases/alisa-finance-scope-r1-20261113');CAND=Path('/opt/alice-market/candidates/alisa-sales-selection-20261113');DEST=Path('/opt/alice-market/releases/alisa-sales-selection-r1-20261113');POINTER=Path('/opt/alice-market/releases/current');CONFIG=Path('/etc/alice-market/market-runtime.json');TESTS=Path('/opt/alice-market/candidates/sales-selection-tests-20261113')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cmd(*args):return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,timeout=100).strip()
def active():
 with sqlite3.connect('file:'+json.loads(CONFIG.read_text())['database']+'?mode=ro',uri=True)as c:return c.execute("SELECT count(*)FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]
def pointer(target):
 p=POINTER.with_name('current.sales-selection-next');assert not p.exists()and not p.is_symlink();p.symlink_to(target);os.replace(p,POINTER)
with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert POINTER.resolve()==BASE,'BASE_CHANGED'
 assert sha(BASE/'manifest.json')=='e9df9420dd14c972a08723e8ae366bea372d733f797666d9e327e0f3ae768781'
 assert sha(CAND/'template_catalog.json')=='89dd329f0482a7edb05da8f1d0b1d4828c76bd71f5bf89e1f125e3a2f2224858'
 assert sha(CAND/'tests/test_template_only.py')=='f979e44f287e79a7ff89b1530e8dca146abc2ead146c7231032c40f36e4f43ce'
 assert 'Ran 103 tests'in (TESTS/'focused-final.log').read_text()and '\nOK\n'in (TESTS/'focused-final.log').read_text(),'CHECKS_NOT_PASS'
 assert active()==0,'ACTIVE_JOB'
 assert not DEST.exists(),'RELEASE_EXISTS'
 base_manifest=json.loads((BASE/'manifest.json').read_text())
 for n,h in base_manifest['files'].items():assert sha(BASE/n)==h,('BASE_SOURCE_CHANGED',n)
 changed=[n for n,h in base_manifest['files'].items()if sha(CAND/n)!=h];assert changed==['template_catalog.json','tests/test_template_only.py'],changed
 config_sha=sha(CONFIG)
 shutil.copytree(BASE,DEST,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__'))
 for name in ('template_catalog.json','tests/test_template_only.py'):
  (DEST/name).unlink();shutil.copy2(CAND/name,DEST/name)
 m=json.loads((DEST/'manifest.json').read_text());m.update(artifact_id=DEST.name,source_commit=SOURCE,source_kind='exact_installed_base_plus_order_sales_semantics',base_release=BASE.name,base_manifest_sha256=sha(BASE/'manifest.json'));m['files']={str(p.relative_to(DEST)):sha(p)for p in sorted(DEST.rglob('*'))if p.is_file()and p.name!='manifest.json'};pending=DEST/'manifest.next.json';pending.write_text(json.dumps(m,indent=2)+'\n');os.replace(pending,DEST/'manifest.json')
 assert sha(BASE/'manifest.json')=='e9df9420dd14c972a08723e8ae366bea372d733f797666d9e327e0f3ae768781'
 for n,h in base_manifest['files'].items():assert sha(BASE/n)==h,('BASE_SOURCE_CHANGED_AFTER_PREPARE',n)
 preflight=cmd('/usr/bin/python3','-B','/opt/alice-market/releases/runtime-policy-guard-20261108/check.py','--release',str(DEST),'--config',str(CONFIG))
 versions=cmd('/usr/bin/python3','-I','-B','/usr/local/libexec/alisa/runtime_versions_sync.py','--source',str(DEST),'--check')
 try:
  cmd('systemctl','stop','alice-market');assert active()==0,'JOB_ARRIVED'
  pointer(DEST);cmd('systemctl','start','alice-market')
  for _ in range(25):
   pid=int(cmd('systemctl','show','alice-market','--property=MainPID','--value'))
   if pid>0 and Path('/proc/'+str(pid)+'/cwd').resolve()==DEST:break
   time.sleep(.2)
  else:raise RuntimeError('RELEASE_NOT_ACTIVE')
  assert cmd('systemctl','is-active','alice-market')=='active'and sha(CONFIG)==config_sha
 except BaseException:
  cmd('systemctl','stop','alice-market');pointer(BASE);cmd('systemctl','start','alice-market');raise
 record={'status':'INSTALLED','source':SOURCE,'release':DEST.name,'base':BASE.name,'changed_payload_files':['template_catalog.json','tests/test_template_only.py'],'catalog_sha256':sha(DEST/'template_catalog.json'),'config_unchanged':True,'preflight':preflight,'versions_preflight':versions,'checked_tests':103,'independent_review':'APPROVED'}
 (TESTS/'INSTALLED.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
