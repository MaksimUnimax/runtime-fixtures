import importlib.util
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('runtime_versions_sync',ROOT/'infra/runtime_versions_sync.py')
sync=importlib.util.module_from_spec(spec);spec.loader.exec_module(sync)

class RuntimeVersions(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='alisa-pins-',dir=Path.home());self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.releases=self.root/'releases';self.source=self.releases/'runtime-v1'
        self.source.mkdir(parents=True);(self.source/'read_surface_data').mkdir()
        (self.source/'runtime_port.py').write_text('def current_versions(): return {}\n')
        (self.source/'read_surface_data/catalog.json').write_text('{}')
        self.manifest={'schema':'alice-read-surface-release/v1','artifact_id':'runtime-v1','source_commit':'1'*40,
            'files':{n:hashlib.sha256((self.source/n).read_bytes()).hexdigest()for n in ['runtime_port.py','read_surface_data/catalog.json']}}
        self.write_manifest()
        self.config=self.root/'native.json';self.config.write_text(json.dumps({'runtime_port':{'enabled':True,'catalog_release_id':'catalog-v1'}}));self.config.chmod(0o640)
        self.versions=self.root/'versions.json'
        self.old={'runtime_contract_version':'runtime_port_v1','task_schema_version':'runtime_task_v1',
            'task_schema_sha256':'a'*64,'registry_hash':'b'*64,'catalog_bundle_hash':'c'*64,
            'query_language':'language-v1','projection':'projection-v1','port_build':'port-v1','catalog_release_id':'catalog-v1'}
        self.versions.write_text(json.dumps(self.old));self.versions.chmod(0o640)
        self.current={k:v for k,v in self.old.items()if k!='catalog_release_id'};self.current['catalog_bundle_hash']='d'*64
    def write_manifest(self): (self.source/'manifest.json').write_text(json.dumps(self.manifest))
    def publish(self,**kw):
        return sync.publish(self.source,self.config,self.versions,releases=self.releases,owner_uid=os.getuid(),
                            calculate=kw.pop('calculate',lambda _:dict(self.current)),**kw)
    def blocked(self,code,callback=None):
        with self.assertRaises(sync.Blocked)as error:(callback or self.publish)()
        self.assertEqual(error.exception.code,code)
    def test_update_changes_only_bundle_hash_and_preserves_mode_and_owner(self):
        before=self.versions.stat();self.assertEqual(self.publish()['status'],'UPDATED')
        value=json.loads(self.versions.read_text());self.assertEqual({k for k in value if value[k]!=self.old[k]},{'catalog_bundle_hash'})
        after=self.versions.stat();self.assertEqual(stat.S_IMODE(after.st_mode),0o640);self.assertEqual((before.st_uid,before.st_gid),(after.st_uid,after.st_gid))
    def test_unchanged_does_not_replace_file(self):
        self.current['catalog_bundle_hash']=self.old['catalog_bundle_hash'];before=self.versions.stat()
        self.assertEqual(self.publish()['status'],'UNCHANGED');self.assertEqual(self.versions.stat().st_ino,before.st_ino)
    def test_check_is_read_only_when_update_required(self):
        before=self.versions.read_bytes();self.assertEqual(self.publish(check=True)['status'],'UPDATE_REQUIRED');self.assertEqual(self.versions.read_bytes(),before)
    def test_all_other_version_fields_require_explicit_compatible_release(self):
        for field in sync.FIELDS-{'catalog_bundle_hash','catalog_release_id'}:
            with self.subTest(field=field):
                original=self.current[field];self.current[field]='f'*64 if field in sync.HASHES else 'changed-v2'
                self.blocked('CONTRACT_CHANGED');self.current[field]=original
        self.assertEqual(json.loads(self.versions.read_text()),self.old)
    def test_catalog_binding_change_is_not_automatically_admitted(self):
        self.config.write_text(json.dumps({'runtime_port':{'enabled':True,'catalog_release_id':'other'}}))
        self.blocked('CATALOG_BINDING_CHANGED')
    def test_disabled_port_does_not_touch_versions(self):
        self.config.write_text(json.dumps({'runtime_port':{'enabled':False}}));self.versions.unlink()
        self.assertEqual(self.publish(),{'status':'DISABLED'});self.assertFalse(self.versions.exists())
    def test_source_checksum_failure_keeps_old_pins(self):
        (self.source/'runtime_port.py').write_text('changed source')
        self.blocked('SOURCE_MISMATCH');self.assertEqual(json.loads(self.versions.read_text()),self.old)
    def test_unlisted_python_module_is_not_admitted(self):
        (self.source/'unlisted.py').write_text('raise RuntimeError()')
        self.blocked('SOURCE_MISMATCH')
    def test_unlisted_read_surface_data_is_not_admitted(self):
        (self.source/'read_surface_data/new.json').write_text('{}');self.blocked('SOURCE_MISMATCH')
    def test_source_outside_release_root_is_denied(self):
        self.blocked('UNTRUSTED_RELEASE',lambda:sync.validate_release(self.source,releases=self.root,owner_uid=os.getuid()))
    def test_release_identity_mismatch_is_denied(self):
        self.manifest['artifact_id']='other';self.write_manifest();self.blocked('UNTRUSTED_RELEASE')
    def test_manifest_without_source_commit_is_denied(self):
        self.manifest.pop('source_commit');self.write_manifest();self.blocked('UNTRUSTED_RELEASE')
    def test_traversal_in_manifest_is_denied_before_read(self):
        self.manifest['files']['../private']='a'*64;self.write_manifest();self.blocked('UNTRUSTED_RELEASE')
    def test_symlink_source_is_denied(self):
        p=self.source/'runtime_port.py';p.unlink();p.symlink_to(self.config)
        with self.assertRaises((sync.Blocked,OSError)):self.publish()
    def test_group_writable_source_is_denied(self):
        (self.source/'runtime_port.py').chmod(0o664);self.blocked('UNTRUSTED_FILE')
    def test_group_writable_parent_is_denied(self):
        self.source.chmod(0o770);self.blocked('UNTRUSTED_PATH')
    def test_source_change_during_computation_is_denied(self):
        def calculate(_): (self.source/'runtime_port.py').write_text('new concurrent source');return dict(self.current)
        self.blocked('SOURCE_CHANGED',lambda:self.publish(calculate=calculate))
    def test_new_source_file_during_computation_is_denied(self):
        def calculate(_): (self.source/'injected.py').write_text('pass');return dict(self.current)
        self.blocked('SOURCE_MISMATCH',lambda:self.publish(calculate=calculate))
    def test_manifest_change_during_computation_is_denied(self):
        def calculate(_): self.manifest['source_commit']='2'*40;self.write_manifest();return dict(self.current)
        self.blocked('SOURCE_CHANGED',lambda:self.publish(calculate=calculate))
    def test_concurrent_config_change_is_preserved(self):
        replacement=b'{"runtime_port":{"enabled":false}}'
        def calculate(_): self.config.write_bytes(replacement);return dict(self.current)
        self.blocked('CONFIG_CHANGED',lambda:self.publish(calculate=calculate));self.assertEqual(self.config.read_bytes(),replacement)
    def test_concurrent_versions_change_is_preserved(self):
        changed={**self.old,'catalog_bundle_hash':'e'*64}
        def calculate(_): self.versions.write_text(json.dumps(changed));return dict(self.current)
        self.blocked('CONFIG_CHANGED',lambda:self.publish(calculate=calculate));self.assertEqual(json.loads(self.versions.read_text()),changed)
    def test_duplicate_json_keys_are_denied(self):
        self.config.write_text('{"runtime_port":null,"runtime_port":null}');self.blocked('INVALID_JSON')
    def test_nonfinite_json_is_denied(self):
        self.config.write_text('{"runtime_port":NaN}');self.blocked('INVALID_JSON')
    def test_computation_missing_or_extra_fields_is_denied(self):
        self.current['unexpected']='unknown';self.blocked('VERSION_SCHEMA')
    def test_malformed_hash_is_denied(self):
        self.current['catalog_bundle_hash']='invalid';self.blocked('VERSION_SCHEMA')

if __name__=='__main__':unittest.main()
