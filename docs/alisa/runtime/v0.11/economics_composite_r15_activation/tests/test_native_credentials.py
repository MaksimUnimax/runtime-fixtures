"""Credential descriptor faults and full accepted HMAC/generation coupling.

Local filesystem fixtures use the current uid and an explicitly mocked read-only
mount bit. native_credential_gate.py separately proves real systemd credentials,
private namespaces, non-root native processes and restarts without those mocks.
"""
from copy import deepcopy
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch
import errno
import os
import stat
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import activate as a
c = a.c
BINDING_SHA = '30664db61e047927c9dafd2b16fd70d3d1ba662ee3ea59ce539d4e1e32045347'


def accepted_binding():
    raw = (HERE/'tests/fixtures/native_store_binding.py').read_bytes()
    assert c.digest(raw) == BINDING_SHA
    module = ModuleType('r15_test_accepted_binding')
    # Only JSON decoding is supplied by the test. The accepted full context,
    # HMAC, process generation and ownership reader execute the exact source.
    with patch.dict(sys.modules, {'store_checker': SimpleNamespace(loads=c.strict_json)}):
        exec(compile(raw, 'accepted_native_store_binding.py', 'exec'), module.__dict__)
    return module


def owner_fixture(binding, generation):
    material = {'seller_client_id': '11', 'seller_api_key': 'synthetic-seller',
                'performance_client_id': 'synthetic-client', 'performance_client_secret': 'synthetic-secret'}
    row = {'tenant_id': 'fixture-tenant', 'store_id': 'fixture-store', 'native_account': 'fixture-account',
           'native_store': 'fixture-native', 'credential_name': 'fixture.json',
           'identity': 'ozon:client:11', 'source_hmac': ''}
    config = {'execution_enabled': True, 'runtime_port': {'socket': '/run/fixture.sock'},
              'accounts': {'fixture-account': {'active': True,
                            'stores': [{'id': 'fixture-native', 'platform': 'ozon'}]}},
              'credential_bindings': {'fixture-native': 'fixture.json'},
              'qualifications': {operation: {'status': 'READ_ONLY_CANARY', 'evidence_ref': 'synthetic-only'}
                                 for operation in ('ozon_ads_token', 'ozon_ads_daily')}}
    data = {'schema_version': 'native_owner_store_binding_v1', 'environment': 'fixture',
            'product_id': 'alisa_market', 'mac_key': '11'*32, 'native_generation': generation,
            'bindings': [row]}
    context = binding.native_context(config, material, row, environment=data['environment'],
                                     product_id=data['product_id'], generation=generation)
    row['source_hmac'] = binding.mac(bytes.fromhex(data['mac_key']), 'native-owner-source-v1', context)
    return config, data, material


class DescriptorFaults(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r15-credential-unit-', dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base/'native-root'
        self.creds = self.root/'run/credentials'/c.UNITS['native']
        self.creds.mkdir(parents=True)
        self.leaf = self.creds/'fixture.json'
        self.leaf.write_bytes(b'{"synthetic":true}\n')
        self.leaf.chmod(0o600)
        self.proc = self.base/'proc'
        (self.proc/'ns').mkdir(parents=True)
        (self.proc/'ns/mnt').write_bytes(b'namespace-metadata-only')
        (self.proc/'root').symlink_to(self.root, target_is_directory=True)
        self.binding = accepted_binding()
        self.generation = self.binding.process_generation(os.getpid())
        self.config = {'runtime_port': {'socket': '/run/fixture.sock'}}
        self.pair = SimpleNamespace(native_peer=lambda _: (os.getpid(), os.getuid()))
        self.original_open = os.open
        self.opened = []
        owner = patch.object(a, 'OWNER_UID', os.getuid())
        owner.start()
        self.addCleanup(owner.stop)

    def view(self, names=('fixture.json',)):
        return a.NativeCredentialView(self.binding, self.pair, self.generation, self.root, self.config, names)

    def redirect(self, path, flags, **kwargs):
        if path == '/proc/'+str(os.getpid()): path = self.proc
        fd = self.original_open(path, flags, **kwargs)
        self.opened.append(fd)
        return fd

    def filesystem(self):
        return patch.object(a.os, 'open', side_effect=self.redirect)

    def readonly(self):
        return patch.object(a.os, 'fstatvfs', return_value=SimpleNamespace(f_flag=os.ST_RDONLY))

    def closed(self, held):
        for fd in held:
            with self.assertRaises(OSError) as caught: os.fstat(fd)
            self.assertEqual(caught.exception.errno, errno.EBADF)

    def test_names_are_bounded_single_authorized_components(self):
        for names in ((), ('../x',), ('/x',), ('.',), ('..',), ('a/b',), ('nul\x00x',), ('x'*256,), ('x',)*129):
            with self.subTest(names=names), self.assertRaises(c.Blocked): self.view(names)
        with self.filesystem(), self.readonly(), patch.object(a.NativeCredentialView, '_generation_guard'):
            with self.view() as view:
                self.assertEqual(view.read('fixture.json'), {'synthetic': True})
                with self.assertRaises(c.Blocked): view.read('unlisted.json')
                held = list(view.fds)
                self.assertTrue(all(not os.get_inheritable(fd) for fd in held))
        self.closed(held)
        with self.assertRaisesRegex(c.Blocked, 'NATIVE_CREDENTIAL_SCOPE_CLOSED'): view.check()

    def test_wrong_mainpid_blocks_before_any_descriptor_or_credential_open(self):
        view = self.view()
        raw = ('MainPID='+str(os.getpid()+1)+'\nActiveState=active\nSubState=running\n').encode()
        with patch.object(a, 'run', return_value=raw), patch.object(a.os, 'open') as opened:
            with self.assertRaisesRegex(c.Blocked, 'NATIVE_GENERATION_MOVED'): view.__enter__()
            opened.assert_not_called()
        self.assertTrue(view.closed)

    def test_process_generation_cwd_and_socket_are_independent_fences(self):
        good = ('MainPID='+str(os.getpid())+'\nActiveState=active\nSubState=running\n').encode()
        view = self.view()
        original_resolve = Path.resolve
        def resolved(path, *args, **kwargs):
            if path == c.NATIVE_LINK or path == Path('/proc', str(os.getpid()), 'cwd'): return self.root
            return original_resolve(path, *args, **kwargs)
        with patch.object(a, 'run', return_value=good), patch.object(Path, 'resolve', resolved):
            view._generation_guard()
            with patch.object(self.binding, 'process_generation', return_value={**self.generation, 'start_ticks': 1}), \
                 self.assertRaisesRegex(c.Blocked, 'NATIVE_GENERATION_MOVED'): view._generation_guard()
            with patch.object(self.pair, 'native_peer', return_value=(os.getpid()+1, os.getuid())), \
                 self.assertRaisesRegex(c.Blocked, 'NATIVE_SOCKET_GENERATION_MOVED'): view._generation_guard()
        with patch.object(a, 'run', return_value=good), patch.object(Path, 'resolve', return_value=self.base), \
             self.assertRaisesRegex(c.Blocked, 'NATIVE_PROCESS_SOURCE_MOVED'): view._generation_guard()

    def test_readonly_mount_and_leaf_permissions_are_required(self):
        with self.filesystem(), patch.object(a.NativeCredentialView, '_generation_guard'), \
             patch.object(a.os, 'fstatvfs', return_value=SimpleNamespace(f_flag=0)):
            with self.assertRaisesRegex(c.Blocked, 'NATIVE_CREDENTIAL_DIRECTORY'): self.view().__enter__()
        self.closed(set(self.opened))
        self.leaf.chmod(0o660)
        with self.filesystem(), self.readonly(), patch.object(a.NativeCredentialView, '_generation_guard'):
            with self.view() as view:
                with self.assertRaisesRegex(c.Blocked, 'NATIVE_CREDENTIAL_FILE'): view.read('fixture.json')
                held = list(view.fds)
        self.closed(held)

    def test_ordinary_component_symlink_and_leaf_symlink_are_rejected(self):
        held = self.base/'held-credentials'
        self.creds.rename(held)
        self.creds.symlink_to(held, target_is_directory=True)
        with self.filesystem(), self.readonly(), patch.object(a.NativeCredentialView, '_generation_guard'):
            with self.assertRaises(OSError): self.view().__enter__()
        self.closed(set(self.opened))
        self.creds.unlink()
        held.rename(self.creds)
        self.leaf.unlink()
        self.leaf.symlink_to(self.proc/'ns/mnt')
        with self.filesystem(), self.readonly(), patch.object(a.NativeCredentialView, '_generation_guard'):
            with self.view() as view:
                with self.assertRaises(OSError): view.read('fixture.json')

    def test_old_credential_fd_is_rejected_even_when_root_inode_is_unchanged(self):
        before_root = self.root.stat().st_ino
        with self.filesystem(), self.readonly(), patch.object(a.NativeCredentialView, '_generation_guard'):
            view = self.view().__enter__()
            held = list(view.fds)
            try:
                old_dir = self.base/'old-store'
                self.creds.rename(old_dir)
                self.creds.mkdir()
                self.leaf.write_bytes(b'{"synthetic":false}\n')
                self.leaf.chmod(0o600)
                fd = self.original_open('fixture.json', os.O_RDONLY, dir_fd=view.anchor['credentials'])
                try: self.assertEqual(os.read(fd, 100), b'{"synthetic":true}\n')
                finally: os.close(fd)
                self.assertEqual(self.root.stat().st_ino, before_root)
                with self.assertRaisesRegex(c.Blocked, 'NATIVE_CREDENTIAL_VIEW_MOVED'): view.check()
            finally: view.close()
        self.closed(held)

    def test_byte_change_during_bounded_read_is_rejected_and_fds_close(self):
        original_read = os.read
        moved = False
        def changed(fd, size):
            nonlocal moved
            raw = original_read(fd, size)
            if raw.startswith(b'{"synthetic":') and not moved:
                moved = True
                self.leaf.write_bytes(b'{"synthetic":false}\n')
                self.leaf.chmod(0o600)
            return raw
        with self.filesystem(), self.readonly(), patch.object(a.NativeCredentialView, '_generation_guard'):
            with self.view() as view:
                held = list(view.fds)
                with patch.object(a.os, 'read', side_effect=changed), \
                     self.assertRaisesRegex(c.Blocked, 'NATIVE_CREDENTIAL_CHANGED'): view.read('fixture.json')
        self.closed(held)

    def test_generation_fault_on_exit_still_closes_every_anchor(self):
        with self.filesystem(), self.readonly(), patch.object(a.NativeCredentialView, '_generation_guard') as guard:
            view = self.view().__enter__()
            held = list(view.fds)
            guard.side_effect = c.Blocked('NATIVE_GENERATION_MOVED')
            with self.assertRaisesRegex(c.Blocked, 'NATIVE_GENERATION_MOVED'): view.__exit__(None, None, None)
        self.closed(held)


class HmacGenerationCoupling(unittest.TestCase):
    def setUp(self):
        self.binding = accepted_binding()
        self.old = {'pid': 101, 'start_ticks': 100, 'uid': 123,
                    'boot_id': '00000000-0000-0000-0000-000000000001'}
        self.new = {**self.old, 'pid': 202, 'start_ticks': 200}
        self.config, self.data, self.material = owner_fixture(self.binding, self.old)
        self.states = {'projection': {'mode': 0o600, 'identity': 'old'}, 'config': {'identity': 'config'}}
        self.pair = SimpleNamespace(native_module=lambda: self.binding,
            wait_native_generation=lambda module, uid: deepcopy(self.new))
        self.host = object.__new__(a.LiveHost)
        self.host.baseline = {'bases': {'native': {'root': '/opt/old'}}}
        self.host.targets = {'native': Path('/opt/new')}
        self.host.helper_guard = lambda: None
        self.host._projection_inputs = lambda expected_states=None: (self.pair, self.binding, deepcopy(self.data),
                                                deepcopy(self.config), deepcopy(self.states))
        self.host.old_projection = deepcopy(self.data)
        self.host.intent = {'ours': deepcopy(self.states)}
        self.writes, self.views = [], []
        self.host.change = lambda name, **kw: self.writes.append((name, kw))
        self.state_patch = patch.object(a, 'path_state', side_effect=lambda p:
            deepcopy(self.states['projection'] if p == c.PROJECTION else self.states['config']))
        self.state_patch.start()
        self.addCleanup(self.state_patch.stop)

    def view_type(self, fail_check=False):
        outer = self
        class View:
            def __init__(self, module, pair, generation, root, config, names):
                outer.views.append((deepcopy(generation), root))
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def read(self, name): return deepcopy(outer.material)
            def check(self):
                if fail_check: raise c.Blocked('NATIVE_GENERATION_MOVED')
        return View

    def test_initial_projection_and_candidate_use_exact_old_generation(self):
        candidate = {**self.config, 'parameter_compounds': {'enabled': True, 'pin': 'a'*64}}
        with patch.object(a, 'NativeCredentialView', self.view_type()):
            result = self.host.projection_data(Path('/opt/old'), expected=self.data,
                expected_config=self.config, candidate_config=candidate)
        self.assertEqual(result, self.data)
        self.assertEqual(self.views, [(self.old, Path('/opt/old'))])

    def test_projection_snapshot_mismatch_blocks_before_credential_scope(self):
        different = {**self.data, 'native_generation': self.new}
        with patch.object(a, 'NativeCredentialView') as view, self.assertRaisesRegex(c.Blocked, 'PROJECTION_RACE'):
            self.host.projection_data(Path('/opt/old'), expected=different)
        view.assert_not_called()

    def test_changed_candidate_owner_context_is_not_accepted(self):
        candidate = deepcopy(self.config)
        candidate['accounts']['fixture-account']['stores'][0]['extra'] = 'changed'
        with patch.object(a, 'NativeCredentialView', self.view_type()), \
             self.assertRaisesRegex(c.Blocked, 'OWNER_SOURCE_WOULD_CHANGE'):
            self.host.projection_data(Path('/opt/old'), candidate_config=candidate)

    def test_refresh_uses_new_material_old_previous_proof_then_new_generation(self):
        readback = Mock()
        self.host.projection_data = readback
        with patch.object(a, 'NativeCredentialView', self.view_type()), patch.object(a, 'run') as run:
            self.host.refresh()
        self.assertEqual(self.views, [(self.new, Path('/opt/new'))])
        self.assertEqual(len(self.writes), 1)
        name, kw = self.writes[0]
        self.assertEqual(name, 'projection')
        actual = c.strict_json(kw['raw'])
        expected_config, expected, _ = owner_fixture(self.binding, self.new)
        self.assertEqual(actual, expected)
        run.assert_called_once_with('systemctl', 'restart', c.CHECKER_UNIT)
        readback.assert_called_once_with(Path('/opt/new'), expected_states=self.states)
        self.assertEqual(self.host.old_projection, self.data)

    def test_new_material_must_confirm_old_hmac_before_any_reprojection(self):
        self.material['performance_client_secret'] = 'changed-synthetic-material'
        with patch.object(a, 'NativeCredentialView', self.view_type()), patch.object(a, 'run') as run, \
             self.assertRaisesRegex(c.Blocked, 'OWNER_PAIR_CHANGED_DURING_RESTART'):
            self.host.refresh()
        self.assertEqual(self.writes, [])
        run.assert_not_called()

    def test_generation_change_immediately_before_write_refuses_without_write(self):
        with patch.object(a, 'NativeCredentialView', self.view_type(fail_check=True)), patch.object(a, 'run') as run, \
             self.assertRaisesRegex(c.Blocked, 'NATIVE_GENERATION_MOVED'):
            self.host.refresh()
        self.assertEqual(self.writes, [])
        run.assert_not_called()

    def test_pre_admission_recovery_selects_exact_old_source_with_new_generation(self):
        self.host.projection_data = Mock()
        with patch.object(a, 'NativeCredentialView', self.view_type()), patch.object(a, 'run'):
            self.host.refresh(old=True)
        self.assertEqual(self.views, [(self.new, Path('/opt/old'))])
        self.host.projection_data.assert_called_once_with(Path('/opt/old'), expected_states=self.states)


if __name__ == '__main__':
    unittest.main()
