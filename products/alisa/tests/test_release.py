"""Release failure handling on a private temporary filesystem, no host mutations."""
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('alisa_release',ROOT/'infra/release.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)

class ReleaseSwitchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='alisa-release-test-')
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        self.old='alisa-'+'1'*16; self.new='alisa-'+'2'*16
        for name in (self.old,self.new):
            root=self.base/'releases'/name
            (root/'.venv/bin').mkdir(parents=True)
            (root/'.venv/bin/python').touch()
            (root/'payload.txt').write_text('immutable fixture')
            checksum=hashlib.sha256((root/'payload.txt').read_bytes()).hexdigest()
            (root/'manifest.json').write_text(json.dumps({'artifact_id':name,'files':{'payload.txt':checksum}}))
        (self.base/'current').symlink_to(self.base/'releases'/self.old)
        self.base_patch=patch.object(release,'release_base',return_value=self.base)
        self.base_patch.start();self.addCleanup(self.base_patch.stop)

    def current(self):return (self.base/'current').resolve().name

    def test_invalid_configuration_preserves_current_before_any_service_change(self):
        with patch.object(release,'private_config',side_effect=RuntimeError('Invalid configuration')),patch.object(release,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'Invalid configuration'):
                release.switch('stage',self.new)
            self.assertEqual(self.current(),self.old)
            command.assert_not_called()

    def test_restart_failure_restores_previous_code_and_restarts_only_own_units(self):
        with patch.object(release,'private_config',return_value={'FOUNDATION_PROBE_ENABLED':'1'}),patch.object(release,'command',side_effect=[RuntimeError('restart failed'),None]) as command:
            with self.assertRaisesRegex(RuntimeError,'restart failed'):
                release.switch('stage',self.new)
            self.assertEqual(self.current(),self.old)
            expected=('systemctl','restart',*[f'alisa-{c}@stage.service' for c in ['platform','identity','web','admin','worker']])
            self.assertEqual([call.args for call in command.call_args_list],[expected,expected])

    def test_ready_release_activates_only_expected_components(self):
        ready={name:{'release':self.new} for name in ['platform','identity','web','admin']}
        with patch.object(release,'private_config',return_value={'FOUNDATION_PROBE_ENABLED':'0'}),patch.object(release,'command') as command,patch.object(release,'readback',return_value=ready):
            self.assertEqual(release.switch('stage',self.new),ready)
            self.assertEqual(self.current(),self.new)
            self.assertEqual(len(command.call_args_list),1)
            self.assertNotIn('alisa-worker@stage.service',command.call_args.args)

    def test_symlinked_release_cannot_escape_namespace(self):
        root=self.base/'releases'/('alisa-'+'3'*16)
        root.symlink_to(self.base/'releases'/self.new)
        with patch.object(release,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'own namespace'):
                release.switch('stage',root.name)
            self.assertEqual(self.current(),self.old);command.assert_not_called()

    def test_manifest_identity_must_match_selected_release(self):
        (self.base/'releases'/self.new/'manifest.json').write_text(json.dumps({'artifact_id':self.old}))
        with patch.object(release,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'identity mismatch'):
                release.switch('stage',self.new)
            self.assertEqual(self.current(),self.old);command.assert_not_called()

    def test_tampered_installed_bytes_are_rejected_before_switch(self):
        (self.base/'releases'/self.new/'payload.txt').write_text('changed')
        with patch.object(release,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'checksum mismatch'):
                release.switch('stage',self.new)
            self.assertEqual(self.current(),self.old);command.assert_not_called()

    def test_unlisted_payload_is_rejected_before_switch(self):
        (self.base/'releases'/self.new/'extra.py').write_text('print("unexpected")')
        with patch.object(release,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'file set mismatch'):
                release.switch('stage',self.new)
            self.assertEqual(self.current(),self.old);command.assert_not_called()

    def test_changed_internal_link_is_rejected_before_switch(self):
        root=self.base/'releases'/self.new
        (root/'alias').symlink_to('payload.txt')
        manifest=json.loads((root/'manifest.json').read_text());manifest['links']={'alias':'payload.txt'}
        (root/'manifest.json').write_text(json.dumps(manifest))
        (root/'alias').unlink();(root/'alias').symlink_to('manifest.json')
        with patch.object(release,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'file set mismatch'):
                release.switch('stage',self.new)
            self.assertEqual(self.current(),self.old);command.assert_not_called()

    def test_foreign_previous_pointer_is_rejected_before_any_service_change(self):
        foreign=self.base/'foreign'/self.old;foreign.mkdir(parents=True)
        current=self.base/'current';current.unlink();current.symlink_to(foreign)
        with patch.object(release,'command') as command:
            with self.assertRaisesRegex(RuntimeError,'Previous release'):
                release.switch('stage',self.new)
            self.assertEqual(current.resolve(),foreign);command.assert_not_called()

    def test_dangling_previous_pointer_is_rejected_before_any_service_change(self):
        current=self.base/'current';current.unlink();current.symlink_to(self.base/'releases'/('alisa-'+'4'*16))
        with patch.object(release,'command') as command:
            with self.assertRaises(FileNotFoundError):release.switch('stage',self.new)
            self.assertFalse(current.exists());self.assertTrue(current.is_symlink());command.assert_not_called()

if __name__=='__main__':unittest.main()
