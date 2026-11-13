"""Finite dataset-selector metadata rollout, atomic pointer with rollback."""
from pathlib import Path
import fcntl,hashlib,json,os,shutil,sqlite3,subprocess,sys,time
SOURCE=sys.argv[1];assert len(SOURCE)==40 and all(c in '0123456789abcdef'for c in SOURCE);
BASE=Path('/opt/alice-market/releases/alisa-offer-price-speech-r1-20261113');CAND=Path('/opt/alice-market/candidates/alisa-dataset-selector-metadata-20261113');DEST=Path('/opt/alice-market/releases/alisa-dataset-selector-metadata-r1-20261113');POINTER=Path('/opt/alice-market/releases/current');CONFIG=Path('/etc/alice-market/market-runtime.json');TESTS=Path('/opt/alice-market/candidates/dataset-selector-metadata-tests-20261113')
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def cmd(*args):return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,timeout=100).strip()
def active():
 with sqlite3.connect('file:'+json.loads(CONFIG.read_text())['database']+'?mode=ro',uri=True)as c:
  count=c.execute("SELECT count(*)FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]
  # READY clarification is still a live continuation pinned to the old catalog.
  for raw, in c.execute("SELECT result FROM jobs WHERE state='READY' AND expires>? AND result IS NOT NULL",(time.time(),)):
   result=json.loads(raw);value=result.get('clarification')if type(result)is dict else None
   if type(value)is dict and value.get('schema_version')=='runtime_clarification_v1':count+=1
  return count
def pointer(target):
 p=POINTER.with_name('current.dataset-selector-next');assert not p.exists()and not p.is_symlink();p.symlink_to(target);os.replace(p,POINTER)
with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 assert POINTER.resolve()==BASE,'BASE_CHANGED'
 assert sha(BASE/'manifest.json')=='e96351d5629fd0dc1a4b84dea9622101e8343bc0ac7fe5de64bb5d7cacc3a21f'
 for name,digest in {'template_catalog.py': 'c305877a6fe03a256dfd8a60a2b2c6ddda365fbdbdc257a2dfdacb563473aeb8', 'template_protocol.py': '0c3f913288cf019349992d3ab36e2d64aeaa214eb2dbb28644e776b80e645965', 'template_catalog.json': '7a8f48ae71cc7939df6b50a76465d52f7124b54b5b78108bb2151f3ed84c42c2'}.items():assert sha(CAND/name)==digest
 assert sha(TESTS/'test_dataset_selector_metadata.py')=='cd3a912fd3a319ac671e4c92f6365c9463b443ff85b800f91a3a362a792faf98'
 assert 'Ran 145 tests'in (TESTS/'focused-final.log').read_text()and '\nOK\n'in (TESTS/'focused-final.log').read_text(),'CHECKS_NOT_PASS'
 assert active()==0,'ACTIVE_JOB_OR_CLARIFICATION'
 assert not DEST.exists(),'RELEASE_EXISTS'
 base_manifest=json.loads((BASE/'manifest.json').read_text())
 for n,h in base_manifest['files'].items():assert sha(BASE/n)==h,('BASE_SOURCE_CHANGED',n)
 changed=[n for n,h in base_manifest['files'].items()if sha(CAND/n)!=h];assert sorted(changed)==['template_catalog.json','template_catalog.py','template_protocol.py'],changed
 config_sha=sha(CONFIG)
 shutil.copytree(BASE,DEST,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__'))
 for name in ('template_catalog.json','template_catalog.py','template_protocol.py'):
  (DEST/name).unlink();shutil.copy2(CAND/name,DEST/name)
 m=json.loads((DEST/'manifest.json').read_text());m.update(artifact_id=DEST.name,source_commit=SOURCE,source_kind='exact_installed_base_plus_dataset_selector_metadata',base_source_commit='9112595562f1546979ecf7191367d3c1c2ed821c',parallel_source_commit='81579c18d4725c7f0a6603c8abbf703668863e36',base_release=BASE.name,base_manifest_sha256=sha(BASE/'manifest.json'));m['files']={str(p.relative_to(DEST)):sha(p)for p in sorted(DEST.rglob('*'))if p.is_file()and p.name!='manifest.json'};pending=DEST/'manifest.next.json';pending.write_text(json.dumps(m,indent=2)+'\n');os.replace(pending,DEST/'manifest.json')
 assert sha(BASE/'manifest.json')=='e96351d5629fd0dc1a4b84dea9622101e8343bc0ac7fe5de64bb5d7cacc3a21f'
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
 record={'status':'INSTALLED','source':SOURCE,'release':DEST.name,'base':BASE.name,'changed_payload_files':['template_catalog.json','template_catalog.py','template_protocol.py'],'catalog_sha256':sha(DEST/'template_catalog.json'),'config_unchanged':True,'preflight':preflight,'versions_preflight':versions,'checked_tests':145,'independent_review':'APPROVED'}
 (TESTS/'INSTALLED.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
