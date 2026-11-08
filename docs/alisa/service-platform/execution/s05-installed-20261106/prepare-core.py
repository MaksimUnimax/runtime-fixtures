"""Prepare a new immutable core version; no current file or pointer edits."""
import hashlib,json,os,pathlib,shutil,sys
sys.dont_write_bytecode=True
B=pathlib.Path('/opt/alice-market');Q=B/'store-check-qualification/6098-current-core';C=B/'store-check-releases/rt-check-6098b31384ae23a4'
OLD=B/'releases/20261105-v010-number-reason-r1';NEW=B/'releases/20261106-store-check-6098-r1'
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s05-stores-20261106');OUT=D/'core-prepare.json'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if OUT.exists() or NEW.exists():raise SystemExit('Existing outcome or candidate preserved; inspect before resume')
rec={'scope':'PREPARED_NEW_CORE_VERSION_NOT_ACTIVE','status':'FAILED'}
try:
 original=json.loads((Q/'source-original-hashes.json').read_text());binding=json.loads((Q/'binding.json').read_text());cm=json.loads((C/'manifest.json').read_text())
 assert len(original)==69 and cm['source_sha']=='6098b31384ae23a43fb869abd3e67f165bc644fa'
 assert all(not pathlib.Path(n).is_absolute() and '..' not in pathlib.Path(n).parts and not (OLD/n).is_symlink() and digest(OLD/n)==sha for n,sha in original.items())
 assert digest(Q/'http_transport.py')==binding['after_sha256'] and digest(C/'shared_http.py')==binding['shared_http_sha256']
 assert all(digest(C/n)==sha for n,sha in cm['files'].items())
 assert digest(D/'store-check-permissions.py')=='e63b20c9079a986120b90daa4dac5edf2ced63516be3f6bb577fd653b7b96905'
 os.umask(0o022);NEW.mkdir(mode=0o755)
 for name in original:
  target=NEW/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(OLD/name,target);target.chmod(0o644)
 shutil.copyfile(Q/'http_transport.py',NEW/'http_transport.py')
 for name in ['shared_http.py','store_checker.py','store_check_ipc.py','store_check_worker.py']:shutil.copyfile(C/name,NEW/name)
 shutil.copyfile(D/'store-check-permissions.py',NEW/'store-check-permissions.py')
 assert all(digest(NEW/n)==sha for n,sha in original.items() if n!='http_transport.py')
 assert digest(NEW/'http_transport.py')==binding['after_sha256']
 files={str(p.relative_to(NEW)):digest(p) for p in NEW.rglob('*') if p.is_file()}
 manifest={'checker_source_sha':cm['source_sha'],'previous_core':str(OLD),'original_files':original,'files':files,'http_before':binding['before_sha256'],'http_after':binding['after_sha256'],'active':False}
 (NEW/'S05_INTEGRATION_MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n')
 assert all(digest(OLD/n)==sha for n,sha in original.items())
 rec.update(status='PASS',new_directory=str(NEW),file_count=len(files),active_core_unchanged=True,checker_source_sha=cm['source_sha'],integration_manifest_sha256=digest(NEW/'S05_INTEGRATION_MANIFEST.json'))
except Exception as error:rec['error_type']=type(error).__name__
OUT.write_text(json.dumps(rec,indent=2)+'\n');OUT.chmod(0o600);print(json.dumps(rec));sys.exit(0 if rec['status']=='PASS' else 1)
