"""Canonical helper identity and disposable descriptor/fault boundaries.

The separate privileged CI gate proves actual root-to-nobody execution. These
tests inject child outcomes to check every parent failure path without requiring
privilege or touching an installed file.
"""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import os
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import activate as a
c = a.c


class VersionProbe(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r15-version-probe-', dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        owner = patch.object(a, 'OWNER_UID', os.getuid())
        owner.start()
        self.addCleanup(owner.stop)
        canonical = self.root/c.VERSION_SYNC_FILE
        raw = (HERE/c.VERSION_SYNC_FILE).read_bytes()
        self.assertEqual(c.digest(raw), c.VERSION_SYNC_SHA)
        canonical.write_bytes(raw)
        canonical.chmod(0o444)
        self.sync = a.load_module('r15_test_canonical_sync', canonical, c.VERSION_SYNC_SHA)
        self.native = self.root/'native'
        self.native.mkdir()
        files = {'runtime_port.py': b'def current_versions(): return {}\n',
                 'adjacent.json': b'{"value":1}\n'}
        for name, raw in files.items():
            (self.native/name).write_bytes(raw)
            (self.native/name).chmod(0o444)
        self.manifest = {'schema': 'alice-read-surface-release/v1', 'artifact_id': self.native.name,
                         'source_commit': '1'*40, 'files': {n: c.digest(v) for n, v in files.items()}}
        self.manifest_raw = c.encoded(self.manifest)
        (self.native/'manifest.json').write_bytes(self.manifest_raw)
        (self.native/'manifest.json').chmod(0o444)
        self.native.chmod(0o555)
        self.addCleanup(self.native.chmod, 0o755)
        self.checked, self.fd = [], None

    def verify(self):
        self.checked.append(True)
        c.need((self.native/'manifest.json').read_bytes() == self.manifest_raw, 'FIXTURE_MANIFEST_CHANGED')
        self.sync.validate_release(self.native, releases=self.native.parent, owner_uid=os.getuid())

    def child(self, args, **kwargs):
        self.assertEqual(args[:3], ['/usr/bin/python3', '-I', '-B'])
        self.assertEqual(len(kwargs['pass_fds']), 1)
        self.fd = kwargs['pass_fds'][0]
        self.assertEqual(kwargs['cwd'], '/proc/self/fd/'+str(self.fd))
        self.assertIn(repr(kwargs['cwd']), args[-1])
        self.assertTrue(kwargs['close_fds'])
        self.assertEqual(kwargs['extra_groups'], [])
        self.assertEqual(kwargs['user'], a.pwd.getpwnam('nobody').pw_uid)
        self.assertEqual(kwargs['group'], a.pwd.getpwnam('nobody').pw_gid)
        self.assertEqual(kwargs['timeout'], 8)
        self.assertIs(kwargs['preexec_fn'], self.sync.limits)
        self.assertEqual(set(kwargs['env']), {'PATH', 'LANG', 'HOME', 'PYTHONDONTWRITEBYTECODE'})
        self.assertEqual(os.fstat(self.fd).st_ino, self.native.stat().st_ino)
        kwargs['stdout'].write(b'{"catalog_bundle_hash":"fixture"}\n')
        return SimpleNamespace(returncode=0)

    def assert_closed(self):
        self.assertIsNotNone(self.fd)
        with self.assertRaises(OSError): os.fstat(self.fd)

    def test_fourth_tool_is_exact_canonical_and_installed_baseline_is_separate(self):
        self.assertEqual(set(c.TOOL_FILES), {'activate.py', 'activation_contract.py',
                                          'readiness.py', 'runtime_versions_sync.py', 'program_pair.py'})
        self.assertEqual(c.digest((HERE/c.VERSION_SYNC_FILE).read_bytes()),
                         '10421a4ec0000a5e26ecc92e5fbeed0a31f48133698a84b92935b04700615dd4')
        self.assertEqual(c.HELPERS[str(c.SYNC)],
                         'b57ebf6be29b05d08955b043cc3036592cf768016d4fcf18ac6ff67b1d63cee0')
        self.assertNotEqual(HERE/c.VERSION_SYNC_FILE, c.SYNC)

    def test_missing_fourth_source_blocks_before_executing_local_modules(self):
        tools = self.root/'tools'
        tools.mkdir()
        for name in c.TOOL_FILES:
            if name != c.VERSION_SYNC_FILE: (tools/name).write_bytes((HERE/name).read_bytes())
        with patch.object(a, 'HERE', tools), self.assertRaises(FileNotFoundError): a._raw_tools()

    def test_changed_fourth_source_blocks_cli_and_sampler_before_execution(self):
        tools = self.root/'tools'
        tools.mkdir()
        raw = {n: (HERE/n).read_bytes() for n in c.TOOL_FILES}
        for name, value in raw.items(): (tools/name).write_bytes(value)
        pin = c.canonical_hash({n: c.digest(v) for n, v in raw.items()})
        (tools/c.VERSION_SYNC_FILE).write_bytes(b'raise RuntimeError("FOURTH_FILE_EXECUTED")\n')
        direct = subprocess.run([sys.executable, '-I', '-B', str(tools/'activate.py'),
                                 '--tool-sha256', pin, '--help'], capture_output=True, timeout=10)
        self.assertEqual(direct.returncode, 2)
        self.assertIn(b'TOOL_IDENTITY', direct.stdout)
        self.assertNotIn(b'FOURTH_FILE_EXECUTED', direct.stderr)
        with patch.object(a, 'HERE', tools): code = a.sampler_code('invalid', '', pin)
        sampler = subprocess.run([sys.executable, '-I', '-B', '-c', code], capture_output=True, timeout=10)
        self.assertNotEqual(sampler.returncode, 0)
        self.assertNotIn(b'FOURTH_FILE_EXECUTED', sampler.stderr)

    def test_missing_pair_source_blocks_before_any_local_module_execution(self):
        tools = self.root/'pair-tools-missing'
        tools.mkdir()
        for name in c.TOOL_FILES:
            if name != 'program_pair.py':
                (tools/name).write_bytes((HERE/name).read_bytes())
        with patch.object(a, 'HERE', tools), self.assertRaises(FileNotFoundError):
            a._raw_tools()

    def test_changed_pair_source_blocks_cli_and_sampler_before_execution(self):
        tools = self.root/'pair-tools-changed'
        tools.mkdir()
        raw = {name: (HERE/name).read_bytes() for name in c.TOOL_FILES}
        for name, value in raw.items():
            (tools/name).write_bytes(value)
        pin = c.canonical_hash({name: c.digest(value) for name, value in raw.items()})
        (tools/'program_pair.py').write_bytes(b'raise RuntimeError("PAIR_FILE_EXECUTED")\n')
        direct = subprocess.run([sys.executable, '-I', '-B', str(tools/'activate.py'),
                                 '--tool-sha256', pin, '--help'], capture_output=True, timeout=10)
        self.assertEqual(direct.returncode, 2)
        self.assertIn(b'TOOL_IDENTITY', direct.stdout)
        self.assertNotIn(b'PAIR_FILE_EXECUTED', direct.stderr)
        with patch.object(a, 'HERE', tools):
            code = a.sampler_code('invalid', '', pin)
        sampler = subprocess.run([sys.executable, '-I', '-B', '-c', code], capture_output=True, timeout=10)
        self.assertNotEqual(sampler.returncode, 0)
        self.assertNotIn(b'PAIR_FILE_EXECUTED', sampler.stderr)

    def test_descriptor_compute_validates_before_and_after_then_closes(self):
        with patch.object(a.subprocess, 'run', side_effect=self.child):
            self.assertEqual(a.compute_versions_from_fd(self.native, self.sync, self.verify),
                             {'catalog_bundle_hash': 'fixture'})
        self.assertEqual(len(self.checked), 2)
        self.assert_closed()

    def test_child_failure_timeout_and_oversized_output_close_descriptor(self):
        for kind in ('failure', 'timeout', 'oversized'):
            with self.subTest(kind=kind):
                self.checked, self.fd = [], None
                def child(args, **kwargs):
                    result = self.child(args, **kwargs)
                    if kind == 'failure': return SimpleNamespace(returncode=7)
                    if kind == 'timeout': raise subprocess.TimeoutExpired(args, 8)
                    kwargs['stdout'].seek(0)
                    kwargs['stdout'].write(b'x'*8193)
                    return result
                with patch.object(a.subprocess, 'run', side_effect=child), self.assertRaises(c.Blocked) as error:
                    a.compute_versions_from_fd(self.native, self.sync, self.verify)
                self.assertEqual(error.exception.code, 'VERSION_SCHEMA' if kind == 'oversized' else 'COMPUTE_UNAVAILABLE')
                self.assertEqual(len(self.checked), 2)
                self.assert_closed()

    def test_payload_mutation_after_child_is_refused_by_full_manifest_gate(self):
        def child(args, **kwargs):
            result = self.child(args, **kwargs)
            target = self.native/'adjacent.json'
            target.chmod(0o644)
            target.write_bytes(b'{"value":2}\n')
            target.chmod(0o444)
            return result
        with patch.object(a.subprocess, 'run', side_effect=child), self.assertRaises(self.sync.Blocked) as error:
            a.compute_versions_from_fd(self.native, self.sync, self.verify)
        self.assertEqual(error.exception.code, 'SOURCE_MISMATCH')
        self.assert_closed()

    def test_path_replacement_cannot_redirect_held_descriptor(self):
        held = self.root/'held-native'
        self.addCleanup(lambda: held.chmod(0o755) if held.exists() else None)
        def child(args, **kwargs):
            result = self.child(args, **kwargs)
            self.native.rename(held)
            self.native.mkdir(mode=0o555)
            return result
        with patch.object(a.subprocess, 'run', side_effect=child), self.assertRaises(c.Blocked) as error:
            a.compute_versions_from_fd(self.native, self.sync, self.verify)
        self.assertEqual(error.exception.code, 'VERSION_ROOT_CHANGED')
        self.assert_closed()

    def test_symlink_or_writable_root_is_refused_before_child(self):
        link = self.root/'alias'
        link.symlink_to(self.native, target_is_directory=True)
        for root in (link, self.native):
            if root == self.native: root.chmod(0o755)
            with self.subTest(root=root.name), patch.object(a.subprocess, 'run') as child, self.assertRaises(c.Blocked):
                a.compute_versions_from_fd(root, self.sync, self.verify)
            child.assert_not_called()

    def test_expected_versions_rejects_any_root_outside_two_frozen_coordinates(self):
        host = object.__new__(a.LiveHost)
        host.bundle, host.targets = self.root/'bundle', {'native': self.root/'published'}
        host.helper_guard = lambda: None
        with self.assertRaises(c.Blocked) as error: host.expected_versions(self.native)
        self.assertEqual(error.exception.code, 'VERSION_SOURCE_SCOPE')

    def test_sync_check_executes_private_canonical_in_check_mode_with_common_lock(self):
        host = object.__new__(a.LiveHost)
        host.helper_guard = lambda: None
        host.targets = {'native': self.native}
        host.desired = {'versions': b'expected'}
        host.expected_versions = lambda root: b'expected' if root == self.native else None
        with tempfile.TemporaryFile() as lock:
            host.lock_stream = lock
            with patch.object(a, 'run', return_value=b'{"status":"UNCHANGED"}') as runner:
                host.sync_check()
            args, kwargs = runner.call_args
            self.assertEqual(args[:4], ('/usr/bin/python3', '-I', '-B', str(HERE/c.VERSION_SYNC_FILE)))
            self.assertNotIn(str(c.SYNC), args)
            self.assertIn('--check', args)
            self.assertEqual(kwargs['pass_fds'], (lock.fileno(),))

    def test_canonical_check_rejects_changed_manifest_even_with_identical_metadata(self):
        sync = self.sync
        current = dict(runtime_contract_version='runtime-v1', task_schema_version='task-v1',
                       task_schema_sha256='a'*64, registry_hash='b'*64, catalog_bundle_hash='c'*64,
                       query_language='query-v1', projection='projection-v1', port_build='fixture')
        config = self.root/'config.json'
        versions = self.root/'versions.json'
        config.write_text(json.dumps({'runtime_port': {'enabled': True, 'catalog_release_id': 'fixture'}}))
        old = {**current, 'catalog_bundle_hash': 'd'*64, 'catalog_release_id': 'fixture'}
        versions.write_bytes(c.encoded(old))
        original = sync.read_file
        _, before = original(self.native/'manifest.json', sync.MAX_FILE, os.getuid(), single_link=False)
        def read(path, *args, **kwargs):
            raw, metadata = original(path, *args, **kwargs)
            return (raw, before) if path == self.native/'manifest.json' else (raw, metadata)
        def calculate(_):
            path = self.native/'manifest.json'
            path.chmod(0o644)
            path.write_bytes(c.encoded({**self.manifest, 'source_commit': '2'*40}))
            path.chmod(0o444)
            return current
        prior = versions.read_bytes()
        with patch.object(sync, 'read_file', side_effect=read), self.assertRaises(sync.Blocked) as error:
            sync.publish(self.native, config, versions, check=True, calculate=calculate,
                         releases=self.native.parent, owner_uid=os.getuid())
        self.assertEqual(error.exception.code, 'SOURCE_CHANGED')
        self.assertEqual(versions.read_bytes(), prior)


if __name__ == '__main__': unittest.main()
