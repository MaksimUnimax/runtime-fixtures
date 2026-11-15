"""Reproduce pinned source fixture for tests. Not an installed-release builder."""
from pathlib import Path
from hashlib import sha256
import argparse,importlib.util,json,tarfile,shutil
ROOT=Path(__file__).resolve().parents[2]
REPO=ROOT.parents[1]

def build(target):
 target=target.resolve()
 if not str(target).startswith('/dev/shm/alisa-parameter-ci-')or target.exists():raise RuntimeError('NEW_ISOLATED_TEST_NATIVE_REQUIRED')
 source=Path(__file__).with_name('native_fixture');manifest=json.loads((source/'MANIFEST.json').read_text());archive=source/'qualified_core_source.tar.gz'
 if sha256(archive.read_bytes()).hexdigest()!=manifest['archive_sha256']:raise RuntimeError('NATIVE_FIXTURE_ARCHIVE_HASH')
 with tarfile.open(archive,'r:gz')as tar:
  members=tar.getmembers()
  if len(members)!=len(manifest['files'])or {m.name for m in members}!=set(manifest['files']):raise RuntimeError('NATIVE_FIXTURE_INVENTORY')
  data={}
  for member in members:
   p=Path(member.name)
   if not member.isfile()or p.is_absolute()or'..'in p.parts:raise RuntimeError('NATIVE_FIXTURE_PATH')
   value=tar.extractfile(member).read()
   if sha256(value).hexdigest()!=manifest['files'][member.name]:raise RuntimeError('NATIVE_FIXTURE_FILE_HASH')
   data[member.name]=value
 for name,expected in manifest['verified_r4_baseline'].items():
  if sha256(data[name]).hexdigest()!=expected:raise RuntimeError('R4_PIN_MISMATCH')
 target.mkdir(mode=0o700,parents=False)
 for name,value in data.items():
  p=target/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(value)
 platform=ROOT/'services/platform/src/alisa_platform/owner_data'
 for version in ('current_parameters_r4','current_parameters_r5','current_parameters_r8'):
  path=REPO/'docs/alisa/runtime/v0.11'/version/'prepare_candidate.py'
  spec=importlib.util.spec_from_file_location('test_prepare_'+version,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  if version=='current_parameters_r5':module.prepare(target)
  else:module.prepare(target,platform)
 leaf=REPO/'docs/alisa/runtime/v0.11/economics_ledger_r11/accrual_source_runtime.py'
 shutil.copy2(leaf,target/leaf.name);shutil.copy2(platform/'economics_accruals.py',target/'parameter_support/economics_accruals.py')
 flow=REPO/'docs/alisa/runtime/v0.11/economics_flow_r13'
 for name in ('realization_source_runtime.py','realization_source_catalog.json'):shutil.copy2(flow/name,target/name)
 for name in ('economics_realization.py','economics_cohort.py','economics_cohort_catalog.json'):shutil.copy2(platform/name,target/'parameter_support'/name)
 path=REPO/'docs/alisa/runtime/v0.11/economics_period_r14/prepare_candidate.py'
 spec=importlib.util.spec_from_file_location('test_prepare_period_r14',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.prepare(target,platform)
 hashes={str(p.relative_to(target)):sha256(p.read_bytes()).hexdigest()for p in target.rglob('*')if p.is_file()and '__pycache__'not in p.parts}
 return {'status':'REPRODUCED_SOURCE_TEST_FIXTURE','files':hashes,'production_deployed':False,'archive_sha256':manifest['archive_sha256']}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--receipt',type=Path,required=True);a=p.parse_args()
 result=build(a.output);a.receipt.parent.mkdir(parents=True,exist_ok=True);a.receipt.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':result['status'],'files':len(result['files'])}))
