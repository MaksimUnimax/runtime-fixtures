"""Finite inactive backend composition; never changes services or a database."""
import hashlib,json,os,shutil,sys
from pathlib import Path
ROOT=Path('/root/alisa-s09-voice-install-d11a9f2a-20261110')
BASE=Path('/opt/alisa-platform/stage/releases/alisa-query-insights-f4127277e9c25557')
APP=BASE.parent/'alisa-voice-selection-ac5557cd456ab364'
SOURCE='ac5557cd456ab364c0b19fb3a86b86083bc46f8a'
PREFIX='services/platform/src/alisa_platform/'
OLD={
 'queries/voice.py':'7012d80314a559ddad1c6a15388948609c08271870aeebbc91c75c7136f286c7',
 'queries/service.py':'a8ca53cb0bd89ed6173ec98a18967915cf9373fff3c609bdda83370295aa32e5',
 'queries/models.py':'28ee3f5c2c78be84c2e29f15bf1d4f9076821092f518ff1fa82bc23527cedd3c',
 'queries/management/commands/queries_cleanup.py':'76c343d4be5fbea65fa12b97146678a929f81874e0dd65e9dad52fb17058d4b6',
 'runtime_adapter/job_client.py':'6688dad043e98f9f988ad422ebe6883a1d36f9f4dd114de789f717d8eb6f77ae'}
NEW={'queries/voice_dialogue.py','queries/migrations/0002_voicedialogue.py'}
def need(ok,code):
 if not ok:raise RuntimeError(code)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def validate(root,manifest):
 for name,digest in manifest['files'].items():
  p=root/name
  need(not Path(name).is_absolute() and '..' not in Path(name).parts and p.is_file()
       and not p.is_symlink() and p.resolve().is_relative_to(root.resolve()) and sha(p)==digest,'RELEASE_HASH')
 for name,target in manifest.get('links',{}).items():
  p=root/name
  need(not Path(name).is_absolute() and '..' not in Path(name).parts and p.is_symlink()
       and os.readlink(p)==target and p.resolve().is_relative_to(root.resolve()),'RELEASE_LINK')
def main():
 need(os.geteuid()==0 and not APP.exists(),'PREPARE_SCOPE')
 disk=os.statvfs('/opt');need(disk.f_bavail*disk.f_frsize>3*1024**3+32*1024**2 and disk.f_favail>220000,'DISK_RESERVE')
 payload=json.loads((ROOT/'PAYLOAD.json').read_text())
 need(payload['source']==SOURCE and set(payload['files'])==set(OLD)|NEW,'PAYLOAD_SCOPE')
 base_bytes=(BASE/'manifest.json').read_bytes();base_sha=hashlib.sha256(base_bytes).hexdigest()
 original=json.loads(base_bytes);validate(BASE,original)
 for name,digest in OLD.items():need(sha(BASE/(PREFIX+name))==digest,'LIVE_SOURCE_MOVED')
 for name in NEW:need(not (BASE/(PREFIX+name)).exists(),'NEW_FILE_COLLISION')
 for name,digest in payload['files'].items():
  p=ROOT/'payload'/name;need(p.is_file() and not p.is_symlink() and sha(p)==digest,'PAYLOAD_HASH')
 shutil.copytree(BASE,APP,symlinks=True,copy_function=os.link)
 try:
  need(sha(BASE/'manifest.json')==base_sha,'LIVE_MANIFEST_MOVED');validate(BASE,original)
  for name,digest in payload['files'].items():
   target=APP/(PREFIX+name);target.parent.mkdir(parents=True,exist_ok=True)
   temp=target.with_name(target.name+'.voice-new')
   with temp.open('xb') as f:f.write((ROOT/'payload'/name).read_bytes());f.flush();os.fsync(f.fileno())
   temp.chmod(0o644);os.replace(temp,target)
  manifest=json.loads(json.dumps(original));manifest.update(artifact_id=APP.name,source_sha=SOURCE,
   components=['platform'],base_release=BASE.name,base_manifest_sha256=base_sha,
   voice_scope='PLATFORM_ONLY_REVIEWED_SOURCE_COMPOSITION')
  for name,digest in payload['files'].items():manifest['files'][PREFIX+name]=digest
  temp=APP/'manifest.voice-new.json';temp.write_text(json.dumps(manifest,indent=2)+'\n');temp.chmod(0o644)
  os.replace(temp,APP/'manifest.json');APP.chmod(0o755);validate(APP,manifest)
  disk=os.statvfs('/opt');need(disk.f_bavail*disk.f_frsize>3*1024**3 and disk.f_favail>200000,'FINAL_DISK_RESERVE')
  need(sha(BASE/'manifest.json')==base_sha,'LIVE_MANIFEST_MOVED')
  receipt={'status':'INACTIVE_BACKEND_PREPARED','source':SOURCE,'candidate':str(APP),
   'manifest_sha256':sha(APP/'manifest.json'),'changed_source_files':7,
   'base_manifest_sha256':base_sha,'live_services_changed':False,'live_database_changes':False}
  (ROOT/'PREPARED.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt))
 except BaseException:
  # This exact newly-created inactive directory is our only cleanup scope.
  shutil.rmtree(APP);raise
if __name__=='__main__':
 try:main()
 except Exception as error:print(json.dumps({'status':'BLOCKED','error_type':type(error).__name__}));raise SystemExit(1)
