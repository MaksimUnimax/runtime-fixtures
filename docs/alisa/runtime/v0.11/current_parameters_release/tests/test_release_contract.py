import unittest,sys
from pathlib import Path
from copy import deepcopy
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import release_contract as g
H='a'*64;NEW='b'*64

def fixture():
 oldp={'artifact_id':'platform-old','source_sha':'0'*40,'locks':{'lock':H},'files':{n:H for n in g.PLATFORM_FILES if n!=g.MIGRATION},'migrations':{},'schema_compatibility':{'platform_owner_data':['0001_initial']}}
 oldp['files']['services/platform/UNCHANGED']=H
 oldn={'artifact_id':'native-old','source_commit':'c'*40,'files':{n:H for n in g.NATIVE_FILES if not n.startswith('parameter_')}}
 oldn['files'].update({'unchanged.py':H,'CURRENT_CORE_MANIFEST.json':H})
 oldw={'artifact_id':'web-old','locks':{'lock':H},'files':{'ui/web/old.js':H},'links':{}}
 core={'schema':'old-core','files':{n:h for n,h in oldn['files'].items()if n!='CURRENT_CORE_MANIFEST.json'}}
 p={'schema':'alisa-parameter-release-payload/v1','source':g.SOURCE,
    'expected_base_platform':{n:oldp['files'].get(n)for n in g.PLATFORM_FILES},
    'expected_base_native':{n:oldn['files'].get(n)for n in g.NATIVE_FILES},
    'files':{**{'platform/'+n:NEW for n in g.PLATFORM_FILES},**{'native/'+n:NEW for n in g.NATIVE_FILES},'web/ui/web/new.js':NEW,'web/infra/launch.py':H},
    'links':{},'locks':{'lock':H},'bases':{k:{'sha256':H}for k in ('platform','native','web')}}
 return p,oldp,oldn,oldw,core

class ReleaseContract(unittest.TestCase):
 def test_exact_scoped_merge_preserves_unmodified_files(self):
  p,a,b,c,core=fixture();out=g.manifests(p,a,b,c,core)
  self.assertEqual(out[0]['files']['services/platform/UNCHANGED'],H);self.assertEqual(out[1]['files']['unchanged.py'],H)
  self.assertEqual(out[0]['schema_compatibility']['platform_owner_data'],['0001_initial','0002_current_parameter_only'])
 def test_original_manifests_not_mutated(self):
  f=fixture();original=deepcopy(f);g.manifests(*f);self.assertEqual(f,original)
 def test_other_source_commit_refused(self):
  f=list(fixture());f[0]['source']='e'*40
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_additional_platform_edit_refused(self):
  f=list(fixture());f[0]['files']['platform/services/platform/rogue.py']=H
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_additional_native_edit_refused(self):
  f=list(fixture());f[0]['files']['native/oauth.py']=H
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_changed_platform_base_refused(self):
  f=list(fixture());f[1]['files']['services/platform/src/alisa_platform/config/settings.py']='e'*64
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_existing_new_table_module_not_overwritten(self):
  f=list(fixture());f[1]['files'][g.MIGRATION]=H
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_dependency_lock_change_refused(self):
  f=list(fixture());f[3]['locks']['lock']=NEW
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_core_manifest_disagrees_with_installed_manifest(self):
  f=list(fixture());f[4]['files']['unchanged.py']=NEW
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_path_traversal_refused(self):
  f=list(fixture());f[0]['files']['web/ui/web/../../escape']=H
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_absolute_path_refused(self):
  f=list(fixture());f[0]['files']['/etc/passwd']=H
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_manifest_file_link_collision_refused(self):
  f=list(fixture());f[0]['links']['web/ui/web/new.js']='safe'
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_link_escape_refused(self):
  f=list(fixture());f[0]['links']['web/ui/web/link']='../../../../../etc'
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_internal_dependency_link_allowed(self):
  f=list(fixture());f[0]['links']['web/ui/web/apps/web/module']='../../node_modules/foo';g.manifests(*f)
 def test_missing_native_file_refused(self):
  f=list(fixture());del f[0]['files']['native/engine.py']
  with self.assertRaises(g.ReleaseError):g.manifests(*f)
 def test_runtime_config_only_adds_parameter_flag(self):
  before={'secret_reference':'DO_NOT_PRINT','owner_bindings':{'x':'y'}};after=g.runtime_config(before,H)
  self.assertEqual({k:v for k,v in after.items()if k!='parameter_sources'},before)
 def test_numeric_false_is_not_permission_flag(self):
  with self.assertRaises(g.ReleaseError):g.runtime_config({'parameter_sources':{'enabled':0}},H)
 def test_invalid_activity_counters_refused(self):
  initial={'active_jobs':0,'active_web_queries':0,'undelivered_voice_answers':0,'unexpired_job_results':0,'base_matches':True}
  for value in (-1,False,'0',None):
   with self.subTest(value=value),self.assertRaises(g.ReleaseError):g.check_snapshot({**initial,'active_jobs':value})
 def test_existing_enabled_policy_not_overwritten(self):
  with self.assertRaises(g.ReleaseError):g.runtime_config({'parameter_sources':{'enabled':True,'pin':NEW}},H)
 def test_rollback_not_overwrite_later_writer(self):
  with self.assertRaises(g.ReleaseError):g.rollback_allowed({'config':'third'},{'config':'old'},{'config':'ours'})
 def test_rollback_accepts_ours_or_original(self):
  self.assertTrue(g.rollback_allowed({'config':'ours','version':'old'},{'config':'old','version':'old'},{'config':'ours','version':'new'}))
 def test_rollout_idle_and_delivery_guard(self):
  initial={'active_jobs':0,'active_web_queries':0,'undelivered_voice_answers':0,'unexpired_job_results':0,'base_matches':True};g.check_snapshot(initial)
  for key in ('active_jobs','active_web_queries','undelivered_voice_answers','unexpired_job_results'):
   with self.subTest(key=key),self.assertRaises(g.ReleaseError):g.check_snapshot({**initial,key:1})
 def test_latest_base_required(self):
  with self.assertRaises(g.ReleaseError):g.check_snapshot({'active_jobs':0,'active_web_queries':0,'undelivered_voice_answers':0,'unexpired_job_results':0,'base_matches':False})

if __name__=='__main__':unittest.main()
