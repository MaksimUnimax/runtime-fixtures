"""Disposable filesystem and effect-fault tests, never installed readiness.

The state-machine fake cannot be selected through the production CLI. The real
builder source-index regression reads only the frozen checkout's source files.
"""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import importlib.util
import json
import os
import py_compile
import stat
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import activate as a
c = a.c
readiness = a.readiness


def coordination():
    return {'schema': 'alisa-r15-maintenance-coordination/v1', 'source_commit': c.PRODUCT,
            'activation_plan_sha256': 'a'*64, 'tool_sha256': 'b'*64, 'prepared_sha256': 'c'*64,
            'nonce': 'd'*32, 'issued_at': 1000, 'expires_at': 1200,
            'coordination': 'OWNER_BROWSER_AND_VOICE_WINDOW_CONFIRMED'}


class FakeHost:
    def __init__(self, failure=None, *, busy_after=False, unknown_after=False):
        self.events, self.failure = [], failure
        self.busy_after, self.unknown_after = busy_after, unknown_after
        self.failed = False
        self.prepared_hash = 'c'*64
        self.desired = {name: ('new-'+name).encode() for name in
                        ('flags', 'platform_selector', 'authority_selector', 'config', 'versions')}
        self.targets = {role: Path('/opt/r15-'+role) for role in c.ROLES}
        self.actual = {name: 'old-'+name for name in (*self.desired, 'native_pointer', 'projection')}
        self.intent = {'before': deepcopy(self.actual), 'ours': deepcopy(self.actual),
                       'admission_possible': False}
        self.old_starts = []
        self.admitted = False

    def event(self, label):
        self.events.append(label)
        if label == self.failure and not self.failed:
            self.failed = True
            raise c.Blocked('INJECTED_FAILURE')

    def check_plan(self, _): self.event('check')
    def backup(self, _): self.event('backup')
    def fence(self, role): self.event('fence:'+role)
    def stop(self, role): self.event('stop:'+role)
    def counts(self):
        self.event('counts')
        if self.admitted and self.busy_after:
            raise readiness.Blocked('READINESS_BUSY')
        if self.admitted and self.unknown_after:
            raise readiness.Blocked('READINESS_UNAVAILABLE')
        return {}
    def verify_frozen(self, _): self.event('frozen')
    def require_fences(self): self.event('require_fences')
    def change(self, name, **_):
        self.event('before_change:'+name)
        self.actual[name] = self.intent['ours'][name] = 'new-'+name
        self.event('after_change:'+name)
    def sync_check(self): self.event('sync_check')
    def verify_publications(self, _): self.event('verify_publications')
    def protected(self, _): self.event('protected')
    def component_state(self, name): return self.actual[name]
    def reload(self): self.event('reload')
    def admission_marker(self):
        self.event('marker_write')
        self.event('marker_fsync')
        self.intent['admission_possible'] = True
    def release(self, role): self.event('release:'+role)
    def start(self, role):
        self.admitted = True
        self.event('new_start:'+role)
    def ready(self, role, _): self.event('ready:'+role)
    def validate_start(self, role, _): self.event('validate_start:'+role)
    def refresh(self): self.event('refresh')
    def post_switch(self, _): self.event('post_switch')
    def record(self, name, _): self.event('record:'+name)
    def recover_pre_admission(self, _):
        self.event('recover')
        self.actual = deepcopy(self.intent['before'])
        self.old_starts.extend(c.START_ORDER)
        return 'PRE_ADMISSION_RESTORED'


def execute(host):
    return a.apply(host, {}, coordination(), plan_hash='a'*64, tool_pin='b'*64, now=1050)


class PhaseFaults(unittest.TestCase):
    def test_complete_order_preserves_separate_roles_and_checks_before_web(self):
        host = FakeHost()
        self.assertEqual(execute(host)['status'], 'INSTALLED_TECHNICAL_CHECKS_PASS')
        self.assertEqual([x for x in host.events if x.startswith('stop:')],
                         ['stop:'+x for x in c.STOP_ORDER])
        self.assertEqual([x for x in host.events if x.startswith('new_start:')],
                         ['new_start:'+x for x in c.START_ORDER])
        self.assertLess(host.events.index('counts'), host.events.index('before_change:flags'))
        self.assertLess(host.events.index('marker_fsync'), host.events.index('release:native'))
        self.assertLess(host.events.index('post_switch'), host.events.index('release:web'))
        self.assertNotIn('recover', host.events)

    def test_each_pre_admission_fault_restores_before_any_new_start(self):
        points = (['fence:'+r for r in c.STOP_ORDER]+['stop:'+r for r in c.STOP_ORDER]
                  +['counts', 'frozen']+['after_change:'+n for n in
                    ('flags', 'platform_selector', 'authority_selector', 'config', 'native_pointer', 'versions')]
                  +['sync_check', 'verify_publications', 'protected', 'reload', 'marker_write', 'marker_fsync'])
        for point in points:
            with self.subTest(point=point):
                host = FakeHost(point)
                self.assertEqual(execute(host)['status'], 'PRE_ADMISSION_RESTORED')
                self.assertFalse(any(x.startswith('new_start:') for x in host.events))
                self.assertEqual(host.actual, host.intent['before'])

    def test_initial_validation_or_backup_fault_has_no_service_effects(self):
        for point in ('check', 'backup'):
            with self.subTest(point=point):
                host = FakeHost(point)
                with self.assertRaises(c.Blocked): execute(host)
                self.assertFalse(any(x.startswith(('fence:', 'stop:', 'before_change:')) for x in host.events))

    def test_partial_new_native_start_then_error_does_not_auto_downgrade(self):
        host = FakeHost('new_start:native', busy_after=True)
        result = execute(host)
        self.assertEqual(result['status'], 'ROLLBACK_BLOCKED_BUSY')
        self.assertNotIn('recover', host.events)
        self.assertEqual(host.actual['config'], 'new-config')
        index = host.events.index('new_start:native')
        self.assertFalse(any(x.startswith(('stop:', 'before_change:', 'fence:')) for x in host.events[index+1:]))

    def test_zero_after_admission_is_not_an_admission_fence(self):
        for point in ('release:native', 'ready:native', 'refresh', 'new_start:authority',
                      'ready:platform', 'post_switch', 'new_start:web', 'record:ACTIVATED'):
            with self.subTest(point=point):
                host = FakeHost(point)
                self.assertEqual(execute(host)['status'], 'RECOVERY_REQUIRES_REVIEW')
                self.assertNotIn('recover', host.events)

    def test_unknown_readiness_is_not_reported_as_proven_busy_or_idle(self):
        host = FakeHost('new_start:web', unknown_after=True)
        self.assertEqual(execute(host)['status'], 'RECOVERY_REQUIRES_REVIEW')
        self.assertNotIn('recover', host.events)

    def test_config_drift_after_successful_sync_check_blocks_versions_and_start(self):
        host = FakeHost()
        old = host.sync_check
        def changed():
            old()
            host.actual['config'] = 'later-writer'
        host.sync_check = changed
        self.assertEqual(execute(host)['status'], 'PRE_ADMISSION_RESTORED')
        self.assertNotIn('before_change:versions', host.events)
        self.assertNotIn('new_start:native', host.events)

    def test_candidate_drift_after_sync_is_checked_before_versions(self):
        host = FakeHost('verify_publications')
        self.assertEqual(execute(host)['status'], 'PRE_ADMISSION_RESTORED')
        self.assertNotIn('before_change:versions', host.events)
        self.assertNotIn('new_start:native', host.events)

    def test_real_admission_marker_write_or_fsync_failure_does_not_set_memory_marker(self):
        host = object.__new__(a.LiveHost)
        host.intent = {'admission_possible': False}
        for failure in (OSError('write'), OSError('fsync')):
            host.record = lambda *_: (_ for _ in ()).throw(failure)
            with self.assertRaises(OSError): host.admission_marker()
            self.assertFalse(host.intent['admission_possible'])


class ContractTests(unittest.TestCase):
    def test_coordination_is_fresh_exact_and_bound_to_all_three_identities(self):
        good = coordination()
        c.window(good, plan_hash='a'*64, tool_hash='b'*64, prepared_hash='c'*64, now=1050)
        changes = [('source_commit', '0'*40), ('activation_plan_sha256', 'e'*64),
                   ('tool_sha256', 'e'*64), ('prepared_sha256', 'e'*64),
                   ('issued_at', 1100), ('expires_at', 1401), ('expires_at', True),
                   ('coordination', 'IDLE'), ('nonce', '../path')]
        for key, value in changes:
            with self.subTest(key=key, value=value), self.assertRaises(c.Blocked):
                c.window({**good, key: value}, plan_hash='a'*64, tool_hash='b'*64,
                         prepared_hash='c'*64, now=1050)

    def test_only_three_policy_keys_change_no_new_caps_or_execution_fence(self):
        old = {'database': '/private/state.sqlite', 'execution_enabled': True,
               'parameter_sources': {'enabled': True, 'pin': 'a'*64},
               'arbitrary_accepted_key': {'scope': ['keep']},
               'parameter_compounds': {'enabled': False}}
        probe = dict(zip(c.POLICIES.values(), ('b'*64, 'c'*64, 'd'*64)))
        result = c.strict_json(c.policy_bytes(c.encoded(old), {'parameter_sources_pin': 'a'*64}, probe))
        self.assertEqual({k: v for k, v in result.items() if k not in c.POLICIES},
                         {k: v for k, v in old.items() if k not in c.POLICIES})
        for policy, key in c.POLICIES.items():
            self.assertEqual(result[policy], {'enabled': True, 'pin': probe[key]})
        with self.assertRaises(c.Blocked):
            c.policy_bytes(c.encoded({**old, 'economics_composites': {'enabled': True, 'pin': 'f'*64}}),
                           {'parameter_sources_pin': 'a'*64}, probe)

    def test_late_envfile_contains_exactly_two_flags_and_preserves_role_command(self):
        old, new = '/opt/base/old-platform', '/opt/new/new-platform'
        raw = ('[Service]\nWorkingDirectory='+old+'/services/platform\nExecStart=\n'
               'ExecStart='+old+'/.venv/bin/python -m alisa_platform.authority\n').encode()
        result = c.selector_bytes(raw, old, new, role='platform')
        self.assertEqual(result, raw.replace(old.encode(), new.encode())+
                         ('EnvironmentFile='+str(c.FLAG_FILE)+'\n').encode())
        self.assertEqual(c.FLAG_BYTES.splitlines(), [x.encode()+b'=1' for x in c.FLAGS])
        for extra in (b'User=root\n', b'ExecStart=/bin/sh\n', b'Environment=SECRET=value\n'):
            with self.subTest(extra=extra), self.assertRaises(c.Blocked):
                c.selector_bytes(raw+extra, old, new, role='platform')

    def test_public_results_contain_no_private_material_and_no_global_provider_claim(self):
        value = c.public_result('RECOVERY_REQUIRES_REVIEW')
        self.assertEqual(value['direct_provider_calls'], 0)
        self.assertNotIn('live_provider_calls', value)
        self.assertEqual(value['live_owner_acceptance'], 'NOT_RUN')
        with self.assertRaises(c.Blocked): c.public_result('BLOCKED', code='private value')

    def test_strict_json_rejects_duplicate_keys_and_nonfinite_values(self):
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}'):
            with self.subTest(raw=raw), self.assertRaises(c.Blocked): c.strict_json(raw)

    def test_actual_product_source_index_uses_frozen_builder_encoding(self):
        root = HERE.parents[4]
        source = root/'products/alisa/services/platform/src/alisa_platform'
        self.assertTrue(source.exists())
        release = HERE.with_name('economics_composite_r15_release')
        spec = importlib.util.spec_from_file_location('r15_actual_contract_for_activation_test', release/'release_contract.py')
        builder_contract = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder_contract)
        sources = {name: sha256((root/name).read_bytes()).hexdigest()
                   for name in sorted(builder_contract.SOURCE_FILES)}
        self.assertEqual(len(sources), 97)
        self.assertEqual(c.canonical_hash(sources), c.SOURCE_INDEX)
        self.assertEqual(sha256(builder_contract.encoded(sources)).hexdigest(), c.SOURCE_INDEX)
        self.assertNotEqual(sha256(json.dumps(sources, sort_keys=True, separators=(',', ':')).encode()).hexdigest(),
                            c.SOURCE_INDEX)


class OwnedFilesystem(unittest.TestCase):
    def setUp(self):
        # Using the existing home avoids a world-writable /tmp ancestor. No live
        # path or environment value is substituted in the production CLI.
        self.temp = tempfile.TemporaryDirectory(prefix='r15-activation-test-', dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.owner = patch.object(a, 'OWNER_UID', os.getuid())
        self.owner.start()
        self.addCleanup(self.owner.stop)

    def file(self, name, raw=b'old', mode=0o600):
        path = self.root/name
        path.write_bytes(raw)
        path.chmod(mode)
        return path

    def test_no_replace_retains_foreign_target_and_stage(self):
        old, staged = self.file('target'), self.file('stage', b'new')
        with self.assertRaises(c.Blocked): a.noreplace(staged, old)
        self.assertEqual(old.read_bytes(), b'old')
        self.assertEqual(staged.read_bytes(), b'new')

    def test_same_target_new_inode_is_not_ours(self):
        path, staged = self.file('target'), self.file('stage', b'new')
        expected, planned = a.path_state(path), a.path_state(staged)
        # Keep old inode allocated so a replacement cannot reuse it.
        path.rename(self.root/'old-held-by-other')
        self.file('target')
        with self.assertRaises(c.Blocked):
            a.replace_managed(path, staged, expected, planned, nonce='one')
        self.assertEqual(path.read_bytes(), b'old')
        self.assertTrue(staged.exists())

    def test_displaced_selector_is_restored_when_publication_fails(self):
        path, staged = self.file('target'), self.file('stage', b'new')
        expected, planned = a.path_state(path), a.path_state(staged)
        original = a.noreplace
        def fault(source, target):
            if source == staged: raise c.Blocked('INJECTED_FAILURE')
            return original(source, target)
        with patch.object(a, 'noreplace', side_effect=fault), self.assertRaises(c.Blocked):
            a.replace_managed(path, staged, expected, planned, nonce='two')
        self.assertEqual(a.path_state(path), expected)

    def test_foreign_occupant_after_displacement_is_never_deleted(self):
        path, staged = self.file('target'), self.file('stage', b'new')
        expected, planned = a.path_state(path), a.path_state(staged)
        original = a.noreplace
        def race(source, target):
            if source == staged:
                path.write_bytes(b'foreign')
            return original(source, target)
        with patch.object(a, 'noreplace', side_effect=race), self.assertRaises(c.Blocked):
            a.replace_managed(path, staged, expected, planned, nonce='three')
        self.assertEqual(path.read_bytes(), b'foreign')
        self.assertEqual((self.root/'.target.r15-held-three').read_bytes(), b'old')

    def test_old_inode_renamed_then_directory_fsync_failure_is_restored(self):
        path, staged = self.file('target'), self.file('stage', b'new')
        before, after = a.path_state(path), a.path_state(staged)
        original, calls = a.fsync_dir, []
        def fsync(folder):
            calls.append(folder)
            if len(calls) == 1: raise OSError('after old-to-held rename')
            return original(folder)
        with patch.object(a, 'fsync_dir', side_effect=fsync), self.assertRaises(OSError):
            a.replace_managed(path, staged, before, after, nonce='fsync-old')
        self.assertEqual(a.path_state(path), before)
        self.assertEqual(staged.read_bytes(), b'new')

    def test_new_inode_renamed_then_fsync_failure_keeps_exact_old_inode_for_recovery(self):
        path, staged = self.file('target'), self.file('stage', b'new')
        before, after = a.path_state(path), a.path_state(staged)
        original, calls = a.fsync_dir, []
        def fsync(folder):
            calls.append(folder)
            if len(calls) == 2: raise OSError('after staged-to-live rename')
            return original(folder)
        with patch.object(a, 'fsync_dir', side_effect=fsync), self.assertRaises(OSError):
            a.replace_managed(path, staged, before, after, nonce='fsync-new')
        held = self.root/'.target.r15-held-fsync-new'
        self.assertEqual(a.path_state(path), after)
        self.assertEqual(a.path_state(held), before)
        a.replace_managed(path, held, after, before, nonce='restore')
        self.assertEqual(a.path_state(path), before)

    def test_foreign_unmask_after_mutation_blocks_recovery_before_any_downgrade(self):
        host = object.__new__(a.LiveHost)
        host.intent = {'source_mutation_started': True}
        events = []
        host.record = lambda *_: events.append('receipt')
        host.require_fences = lambda: (_ for _ in ()).throw(c.Blocked('ADMISSION_FENCE_LOST'))
        # Any attempt to enumerate/write components would fail this assertion.
        host.components = None
        self.assertEqual(host.recover_pre_admission({}), 'RECOVERY_REQUIRES_REVIEW')
        self.assertEqual(events, ['receipt'])

    def test_managed_hardlink_and_symlink_regular_read_are_refused(self):
        path = self.file('target')
        os.link(path, self.root/'alias')
        with self.assertRaises(c.Blocked): a.path_state(path)
        link = self.root/'link'
        link.symlink_to(path)
        with self.assertRaises(OSError): a.regular(link)

    def test_pinned_loader_executes_verified_bytes_not_valid_stale_bytecode(self):
        path = self.file('helper.py', b'value = "old"\n', 0o644)
        stamp = path.stat().st_mtime_ns
        py_compile.compile(str(path), doraise=True)
        raw = b'value = "new"\n'
        path.write_bytes(raw)
        os.utime(path, ns=(stamp, stamp))
        module = a.load_module('r15_stale_helper_test', path, c.digest(raw))
        self.assertEqual(module.value, 'new')

    def test_pinned_loader_does_not_reread_path_after_hash(self):
        path = self.file('helper.py', b'value = "verified"\n', 0o644)
        raw = path.read_bytes()
        original = a.regular
        def race(p):
            result = original(p)
            p.write_bytes(b'value = "swapped"\n')
            return result
        with patch.object(a, 'regular', side_effect=race):
            module = a.load_module('r15_reread_test', path, c.digest(raw))
        self.assertEqual(module.value, 'verified')

    def test_real_sampler_command_bootstraps_source_even_with_stale_activate_cache(self):
        tools = self.root/'tools'
        tools.mkdir()
        originals = {name: (HERE/name).read_bytes() for name in c.TOOL_FILES}
        for name, raw in originals.items(): (tools/name).write_bytes(raw)
        path = tools/'activate.py'
        stamp = path.stat().st_mtime_ns
        poison = b'raise RuntimeError("STALE_ACTIVATE_EXECUTED")\n'
        path.write_bytes(poison+b'#'*(len(originals['activate.py'])-len(poison)))
        py_compile.compile(str(path), doraise=True)
        path.write_bytes(originals['activate.py'])
        os.utime(path, ns=(stamp, stamp))
        pin = c.canonical_hash({n: c.digest(raw) for n, raw in originals.items()})
        with patch.object(a, 'HERE', tools): code = a.sampler_code('invalid', '', pin)
        result = subprocess.run([sys.executable, '-I', '-B', '-c', code],
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(json.loads(result.stdout), {'status': 'BLOCKED'})
        self.assertNotIn(b'STALE_ACTIVATE_EXECUTED', result.stderr)
        # Changed source is refused before any local module can run.
        (tools/'readiness.py').write_bytes(b'raise RuntimeError("UNPINNED")\n')
        result = subprocess.run([sys.executable, '-I', '-B', '-c', code],
                                capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn(b'UNPINNED', result.stderr)

    def test_extra_stdlib_shadow_cannot_execute_before_tool_validation(self):
        tools = self.root/'public-tools'
        tools.mkdir()
        originals = {name: (HERE/name).read_bytes() for name in c.TOOL_FILES}
        for name, raw in originals.items(): (tools/name).write_bytes(raw)
        marker = self.root/'shadow-executed'
        (tools/'sqlite3.py').write_text('from pathlib import Path\nPath('+repr(str(marker))+').write_text("bad")\n')
        pin = c.canonical_hash({n: c.digest(v) for n, v in originals.items()})
        with patch.object(a, 'HERE', tools): code = a.sampler_code('invalid', '', pin)
        result = subprocess.run([sys.executable, '-I', '-B', '-c', code], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertFalse(marker.exists())
        result = subprocess.run([sys.executable, '-I', '-B', str(tools/'activate.py'),
                                 '--tool-sha256', pin, '--help'], capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertFalse(marker.exists())
        result = subprocess.run([sys.executable, '-B', str(tools/'activate.py'), '--help'],
                                capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 2)
        self.assertIn(b'ISOLATED_INTERPRETER_REQUIRED', result.stdout)
        self.assertFalse(marker.exists())

    def test_control_mask_precedes_etc_fragment_and_preserves_original_inode(self):
        host = object.__new__(a.LiveHost)
        host.nonce, host.attempt, host.event = 'mask', self.root, 0
        host.intent = {'fences': {}}
        etc = self.root/'etc'
        etc.mkdir()
        original = etc/c.UNITS['native']
        original.write_bytes(b'[Service]\nExecStart=/bin/true\n')
        before = a.path_state(original)
        control = self.root/'system.control'
        normal_runtime = self.root/'system'
        normal_runtime.mkdir()
        # Reproduce the actual ordering: control > administrator /etc > /run.
        def effective():
            for directory in (control, etc, normal_runtime):
                path = directory/c.UNITS['native']
                if os.path.lexists(path):
                    return 'masked' if path.is_symlink() and os.readlink(path) == '/dev/null' else 'loaded'
        with patch.object(c, 'FENCE_ROOT', control), patch.object(a, 'fence_environment', return_value=list(c.UNIT_PATHS)), \
             patch.object(a, 'run', return_value=b''), patch.object(a, 'prop', side_effect=lambda *_: effective()):
            host.fence('native')
            self.assertEqual(effective(), 'masked')
            self.assertEqual(a.path_state(original), before)
            self.assertTrue(host.intent['fence_directory']['created_by_attempt'])
            host.release('native')
            self.assertEqual(effective(), 'loaded')
            self.assertEqual(a.path_state(original), before)
        # The previous /run/system mask would lose to this explicit /etc file.
        (normal_runtime/c.UNITS['native']).symlink_to('/dev/null')
        self.assertEqual(effective(), 'loaded')

    def test_real_backup_and_projection_wrapper_preserve_scope_and_owner(self):
        host = object.__new__(a.LiveHost)
        host.nonce, host.attempt = 'abc', self.root
        path = self.file('projection', b'old')
        host.components = {'projection': path}
        host.intent = {'ours': {'projection': a.path_state(path)}}
        host.event = 0
        host.change('projection', raw=b'new')
        self.assertEqual(path.read_bytes(), b'new')
        self.assertEqual(host.intent['ours']['projection'], a.path_state(path))
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
        event = c.strict_json((self.root/'EVENT-0000.json').read_bytes())
        self.assertEqual(event['ours']['projection'], a.path_state(path))
        self.assertNotIn('new', (self.root/'EVENT-0000.json').read_text())

    def test_staged_intent_failure_keeps_live_file_and_prevents_publish(self):
        host = object.__new__(a.LiveHost)
        host.nonce, host.attempt = 'def', self.root
        path = self.file('config')
        host.components = {'config': path}
        host.intent = {'ours': {'config': a.path_state(path)}}
        host._intent = lambda: (_ for _ in ()).throw(OSError('fsync'))
        with self.assertRaises(OSError): host.change('config', raw=b'new')
        self.assertEqual(path.read_bytes(), b'old')

    def test_fence_loss_after_staging_refuses_pre_admission_publication(self):
        host = object.__new__(a.LiveHost)
        host.nonce, host.attempt, host.event = 'fence-loss', self.root, 0
        host.pre_admission_writes = True
        path = self.file('config')
        host.components = {'config': path}
        before = a.path_state(path)
        host.intent = {'ours': {'config': before}}
        checks = []
        def fences():
            checks.append(True)
            if len(checks) == 2: raise c.Blocked('ADMISSION_FENCE_LOST')
        host.require_fences = fences
        with self.assertRaises(c.Blocked) as error: host.change('config', raw=b'new')
        self.assertEqual(error.exception.code, 'ADMISSION_FENCE_LOST')
        self.assertEqual(a.path_state(path), before)
        self.assertTrue(host.intent['source_mutation_started'])

    def test_recovery_does_not_start_old_native_with_changed_unit_source(self):
        host, planned, events = self.recovery_fixture()
        def guard(unit):
            if unit['role'] == 'native': raise c.Blocked('UNIT_SOURCE_CHANGED_DURING_DRAIN')
        host.unit_files_unchanged = guard
        with patch.object(a, 'run', return_value=b''):
            self.assertEqual(host.recover_pre_admission(planned), 'PRE_ADMISSION_RECOVERY_INCOMPLETE')
        self.assertFalse(any(item.startswith(('release:', 'start:')) for item in events))

    def test_recovery_web_release_failure_prevents_start_web(self):
        host, planned, events = self.recovery_fixture()
        def release(role):
            events.append('release:'+role)
            if role == 'web': raise c.Blocked('ADMISSION_FENCE_LOST')
        host.release = release
        with patch.object(a, 'run', return_value=b''):
            self.assertEqual(host.recover_pre_admission(planned), 'PRE_ADMISSION_RECOVERY_INCOMPLETE')
        self.assertIn('start:platform', events)
        self.assertIn('release:web', events)
        self.assertNotIn('start:web', events)

    def recovery_fixture(self):
        host = object.__new__(a.LiveHost)
        host.nonce, host.attempt = 'recovery', self.root
        names = ('config', 'versions', 'projection', 'native_pointer', 'flags',
                 'platform_selector', 'authority_selector')
        host.components = {name: self.file(name) for name in names}
        before = {name: a.path_state(path) for name, path in host.components.items()}
        host.private_before = {name: path.read_bytes() for name, path in host.components.items()}
        host.intent = {'before': before, 'ours': deepcopy(before)}
        events = []
        host.record = lambda *_: None
        host.release = lambda role: events.append('release:'+role)
        host.start = lambda role: events.append('start:'+role)
        host.ready = lambda *args, **kwargs: None
        host.validate_start = lambda *args, **kwargs: None
        host.unit_files_unchanged = lambda _: None
        host.refresh = lambda *, old=False: self.assertTrue(old)
        host.protected = lambda _: None
        planned = {'before': {'units': {role: {'role': role} for role in c.UNITS}}}
        return host, planned, events

    def test_recovery_attempts_independent_components_after_receipt_failure(self):
        host = object.__new__(a.LiveHost)
        host.nonce, host.attempt = 'ghi', self.root
        names = ('config', 'versions', 'projection', 'native_pointer', 'flags',
                 'platform_selector', 'authority_selector')
        host.components = {name: self.file(name, ('old-'+name).encode()) for name in names}
        before = {name: a.path_state(path) for name, path in host.components.items()}
        host.private_before = {name: path.read_bytes() for name, path in host.components.items()}
        for name, path in host.components.items(): path.write_bytes(('ours-'+name).encode())
        ours = {name: a.path_state(path) for name, path in host.components.items()}
        host.intent = {'before': before, 'ours': ours}
        # A later writer changes exactly one component. Independent known files
        # must still recover even if both initial/final receipt writes fail.
        host.components['authority_selector'].write_bytes(b'foreign')
        host.record = lambda *_: (_ for _ in ()).throw(OSError('disk'))
        events = []
        host.release = lambda role: events.append('release:'+role)
        host.start = lambda role: events.append('start:'+role)
        host.ready = lambda *args, **kwargs: None
        host.validate_start = lambda *args, **kwargs: None
        host.unit_files_unchanged = lambda _: None
        host.refresh = lambda *, old=False: self.assertTrue(old)
        host.protected = lambda _: None
        with patch.object(a, 'run', return_value=b''):
            result = host.recover_pre_admission({'before': {'units': dict.fromkeys(c.UNITS, {})}})
        self.assertEqual(result, 'PRE_ADMISSION_RECOVERY_INCOMPLETE')
        self.assertEqual(host.components['config'].read_bytes(), b'old-config')
        self.assertEqual(host.components['platform_selector'].read_bytes(), b'old-platform_selector')
        self.assertEqual(host.components['authority_selector'].read_bytes(), b'foreign')
        self.assertIn('start:platform', events)
        self.assertNotIn('start:authority', events)
        self.assertNotIn('start:web', events)

    def test_publication_copies_independent_readonly_inodes_and_rejects_collision(self):
        source = self.root/'bundle'
        source.mkdir()
        payload = source/'runtime_port.py'
        payload.write_bytes(b'pass\n')
        payload.chmod(0o444)
        manifest = {'files': {'runtime_port.py': c.digest(payload.read_bytes())},
                    'links': {}, 'external_links': {}}
        manifest_raw = c.encoded(manifest)
        (source/'manifest.json').write_bytes(manifest_raw)
        (source/'manifest.json').chmod(0o444)
        source.chmod(0o555)
        self.addCleanup(source.chmod, 0o755)
        def verify(root, expected):
            self.assertEqual(c.digest((root/'manifest.json').read_bytes()), expected)
            value = c.strict_json((root/'manifest.json').read_bytes())
            for name, h in value['files'].items(): self.assertEqual(c.digest((root/name).read_bytes()), h)
            return value, len(payload.read_bytes())
        def hashes(root, _): return {p.name: c.digest(p.read_bytes()) for p in root.iterdir() if p.is_file()}
        def freeze(root):
            for p in root.iterdir(): p.chmod(0o444)
            root.chmod(0o555)
        builder = SimpleNamespace(verify_manifest=verify, file_hashes=hashes, freeze=freeze)
        prepared = {'candidates': {'native': {'manifest_sha256': c.digest(manifest_raw)}}}
        target = self.root/'candidate'
        entry = a.publish_role(builder, source, target, 'native', prepared)
        self.addCleanup(target.chmod, 0o755)
        self.assertEqual(entry['root'], str(target))
        self.assertNotEqual(payload.stat().st_ino, (target/'runtime_port.py').stat().st_ino)
        self.assertEqual(stat.S_IMODE((target/'runtime_port.py').stat().st_mode), 0o444)
        with self.assertRaises(c.Blocked): a.publish_role(builder, source, target, 'native', prepared)
        self.assertEqual(payload.read_bytes(), b'pass\n')


class RolloutLockFilesystem(unittest.TestCase):
    """Actual files/flock, with fixed /run paths mapped only inside the test.

    No production path/owner option is added. Root ownership is represented in
    returned metadata so the same disposable tests run on unprivileged CI.
    """
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r15-lock-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.root.chmod(0o755)
        self.run = self.root/'run'
        self.run.mkdir(mode=0o755)
        self.parent = self.run/'lock'
        self.parent.mkdir()
        self.parent.chmod(0o1777)
        self.target = self.parent/'alisa-stage-rollout.lock'
        self.target.write_bytes(b'existing shared lock\n')
        self.target.chmod(0o644)
        self.paths = {'/': self.root, '/run': self.run, '/run/lock': self.parent,
                      str(c.LOCK): self.target}
        self.overrides, self.fds, self.opens = {}, {}, []
        self.after_open = self.after_flock = None
        self.real_open, self.real_stat = os.open, os.stat
        self.real_lstat, self.real_fstat = os.lstat, os.fstat
        self.real_flock = a.fcntl.flock
        for owner, name, replacement in (
                (a.os, 'open', self.open), (a.os, 'stat', self.stat),
                (a.os, 'lstat', self.lstat), (a.os, 'fstat', self.fstat),
                (a.fcntl, 'flock', self.flock)):
            active = patch.object(owner, name, side_effect=replacement)
            active.start()
            self.addCleanup(active.stop)

    def logical(self, path, dir_fd=None):
        if isinstance(path, int):
            return None
        name = os.fspath(path)
        if name in self.paths:
            return name
        if dir_fd in self.fds and not os.path.isabs(name):
            return self.fds[dir_fd][0]+'/'+name
        return None

    def metadata(self, info, logical):
        if logical is None:
            return info
        values = {key: getattr(info, key) for key in
                  ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink')}
        values.update(st_uid=0, st_gid=0)
        values.update(self.overrides.get(logical, {}))
        return SimpleNamespace(**values)

    def stat(self, path, *, dir_fd=None, follow_symlinks=True):
        logical = self.logical(path, dir_fd)
        actual = self.paths.get(os.fspath(path), path) if not isinstance(path, int) else path
        info = self.real_stat(actual, dir_fd=dir_fd, follow_symlinks=follow_symlinks)
        return self.metadata(info, logical)

    def lstat(self, path, *, dir_fd=None):
        logical = self.logical(path, dir_fd)
        return self.metadata(self.real_lstat(self.paths.get(os.fspath(path), path),
                                             dir_fd=dir_fd), logical)

    def fstat(self, fd):
        info = self.real_fstat(fd)
        known = self.fds.get(fd)
        logical = known[0] if known and known[1:] == (info.st_dev, info.st_ino) else None
        return self.metadata(info, logical)

    def open(self, path, flags, mode=0o777, *, dir_fd=None):
        logical = self.logical(path, dir_fd)
        actual = self.paths.get(os.fspath(path), path)
        fd = self.real_open(actual, flags, mode, dir_fd=dir_fd)
        if logical is not None:
            info = self.real_fstat(fd)
            self.fds[fd] = (logical, info.st_dev, info.st_ino)
            self.opens.append((logical, flags, dir_fd))
            if self.after_open is not None:
                self.after_open(logical, fd)
        return fd

    def flock(self, fd, operation):
        result = self.real_flock(fd, operation)
        if self.after_flock is not None:
            hook, self.after_flock = self.after_flock, None
            hook(fd)
        return result

    def assert_closed(self):
        for fd in self.fds:
            with self.assertRaises(OSError):
                self.real_fstat(fd)

    def blocked(self, code='UNTRUSTED_LOCK'):
        with self.assertRaises(c.Blocked) as error:
            with a.lock():
                self.fail('untrusted lock yielded')
        if code is not None:
            self.assertEqual(error.exception.code, code)
        self.assert_closed()

    def replace_file(self):
        new = self.parent/'later-writer'
        new.write_bytes(b'later writer\n')
        new.chmod(0o644)
        os.replace(new, self.target)

    def replace_parent(self):
        self.parent.rename(self.run/'held-lock-directory')
        self.parent.mkdir()
        self.parent.chmod(0o1777)
        self.target.write_bytes(b'later directory\n')
        self.target.chmod(0o644)

    def test_existing_sticky_root_lock_holds_real_exclusion_and_preserves_bytes(self):
        before = self.target.lstat()
        with a.lock() as held:
            self.assertEqual(self.real_fstat(held.fileno()).st_ino, before.st_ino)
            other = self.real_open(self.target, os.O_RDWR)
            try:
                with self.assertRaises(BlockingIOError):
                    self.real_flock(other, a.fcntl.LOCK_EX | a.fcntl.LOCK_NB)
            finally:
                os.close(other)
        self.assert_closed()
        self.assertEqual(self.target.read_bytes(), b'existing shared lock\n')
        self.assertEqual(self.target.lstat().st_ino, before.st_ino)
        self.assertEqual(stat.S_IMODE(self.target.lstat().st_mode), 0o644)
        parent_open, file_open = self.opens
        self.assertTrue(parent_open[1] & os.O_DIRECTORY and parent_open[1] & os.O_NOFOLLOW)
        self.assertTrue(file_open[1] & os.O_RDWR and file_open[1] & os.O_NOFOLLOW)
        self.assertIsNotNone(file_open[2])
        self.assertFalse(any(flags & (os.O_CREAT | os.O_TRUNC) for _, flags, _ in self.opens))
        with self.target.open('r+b') as other:
            self.real_flock(other.fileno(), a.fcntl.LOCK_EX | a.fcntl.LOCK_NB)

    def test_safe_existing_parent_remains_supported_and_generic_guard_stays_strict(self):
        with self.assertRaises(c.Blocked):
            a.secure_dir(Path('/run/lock'))
        self.parent.chmod(0o755)
        a.secure_dir(Path('/run/lock'))
        with a.lock():
            pass
        self.assert_closed()

    def test_writable_parent_requires_exact_sticky_mode(self):
        for mode in (0o777, 0o775, 0o3777):
            with self.subTest(mode=oct(mode)):
                self.parent.chmod(mode)
                self.blocked()

    def test_root_ancestors_and_parent_require_root_uid_and_gid(self):
        for path in ('/', '/run', '/run/lock'):
            for key in ('st_uid', 'st_gid'):
                with self.subTest(path=path, key=key):
                    self.overrides = {path: {key: 999}}
                    self.blocked(code=None)
        self.overrides = {}

    def test_writable_run_ancestor_is_not_covered_by_sticky_exception(self):
        self.run.chmod(0o1777)
        self.blocked(code='UNTRUSTED_DIRECTORY')

    def test_symlink_parent_is_not_followed(self):
        held = self.run/'real-lock-directory'
        self.parent.rename(held)
        self.parent.symlink_to(held, target_is_directory=True)
        self.blocked()

    def test_symlink_file_is_not_followed(self):
        held = self.parent/'real-lock'
        self.target.rename(held)
        self.target.symlink_to(held)
        self.blocked()
        self.assertEqual(held.read_bytes(), b'existing shared lock\n')

    def test_missing_lock_is_never_created(self):
        self.target.unlink()
        self.blocked()
        self.assertFalse(self.target.exists())

    def test_foreign_file_uid_gid_and_group_world_writes_are_rejected(self):
        for key in ('st_uid', 'st_gid'):
            with self.subTest(key=key):
                self.overrides = {str(c.LOCK): {key: 999}}
                self.blocked()
        self.overrides = {}
        for mode in (0o664, 0o646):
            with self.subTest(mode=oct(mode)):
                self.target.chmod(mode)
                self.blocked()

    def test_hardlink_alias_is_rejected(self):
        os.link(self.target, self.parent/'alias')
        self.blocked()

    def test_file_replacement_during_open_is_detected_before_flock(self):
        def change(path, _fd):
            if path == str(c.LOCK):
                self.replace_file()
        self.after_open = change
        with patch.object(a.fcntl, 'flock') as acquire:
            self.blocked()
        acquire.assert_not_called()
        self.assertEqual(self.target.read_bytes(), b'later writer\n')

    def test_file_replacement_after_flock_is_detected_before_yield(self):
        self.after_flock = lambda _fd: self.replace_file()
        self.blocked()
        self.assertEqual(self.target.read_bytes(), b'later writer\n')

    def test_parent_replacement_during_open_is_detected(self):
        self.after_open = lambda path, _fd: self.replace_parent() if path == '/run/lock' else None
        self.blocked()
        self.assertEqual(self.target.read_bytes(), b'later directory\n')

    def test_parent_replacement_after_flock_is_detected(self):
        self.after_flock = lambda _fd: self.replace_parent()
        self.blocked()
        self.assertEqual(self.target.read_bytes(), b'later directory\n')

    def test_parent_or_file_permissions_changed_after_flock_are_rejected(self):
        for path, new_mode, old_mode in ((self.parent, 0o777, 0o1777), (self.target, 0o666, 0o644)):
            with self.subTest(path=path.name):
                self.after_flock = lambda _fd: path.chmod(new_mode)
                self.blocked()
                path.chmod(old_mode)

    def test_real_busy_lock_retains_existing_typed_refusal(self):
        with self.target.open('r+b') as other:
            self.real_flock(other.fileno(), a.fcntl.LOCK_EX | a.fcntl.LOCK_NB)
            self.blocked(code='ROLLOUT_BUSY')

    def test_unrelated_parent_activity_does_not_invalidate_held_directory(self):
        def unrelated(_fd):
            (self.parent/'another-users-directory').mkdir()
            (self.parent/'another-lock').write_bytes(b'unrelated\n')
        self.after_flock = unrelated
        with a.lock():
            pass
        self.assert_closed()

    def test_no_alternate_lock_path_receives_the_exception(self):
        with patch.object(c, 'LOCK', Path('/run/another-lock/alisa-stage-rollout.lock')):
            self.blocked()
        self.assertEqual(self.opens, [])


class InstalledAdapterBoundaries(unittest.TestCase):
    def test_fence_load_path_and_higher_priority_exact_or_template_shadow_fail_closed(self):
        good = ' '.join(c.UNIT_PATHS).encode()
        with patch.object(a, 'run', return_value=good), patch.object(a, 'optional_state', return_value=None):
            self.assertEqual(a.fence_environment(), list(c.UNIT_PATHS))
        for name in ('alice-market.service', 'alisa-platform@.service'):
            with self.subTest(name=name), patch.object(a, 'run', return_value=good), \
                 patch.object(a, 'optional_state', side_effect=lambda p: {'foreign': True} if p.name == name else None), \
                 self.assertRaises(c.Blocked):
                a.fence_environment()
        wrong = ' '.join(reversed(c.UNIT_PATHS)).encode()
        with patch.object(a, 'run', return_value=wrong), self.assertRaises(c.Blocked):
            a.fence_environment()

    def test_python_alias_must_resolve_to_pinned_interpreter(self):
        raw = b'approved python binary fixture'
        environment = {'python': {'path': '/usr/bin/python3.12', 'sha256': c.digest(raw)}}
        with patch.object(Path, 'resolve', return_value=Path('/usr/bin/python3.12')), \
             patch.object(a, 'regular', return_value=raw):
            a.interpreter_alias(environment)
        with patch.object(Path, 'resolve', return_value=Path('/usr/bin/python3.11')), \
             patch.object(a, 'regular') as reader, self.assertRaises(c.Blocked):
            a.interpreter_alias(environment)
        reader.assert_not_called()

    def test_native_binding_dependency_closure_overwrites_ambient_modules_in_order(self):
        host = object.__new__(a.LiveHost)
        host.pair = None
        host.helper_guard = lambda: None
        host.baseline = {'bases': {'native': {'root': '/opt/old-native'}}}
        host.targets = {'native': Path('/opt/new-native')}
        sources = {
            'shared_http': b'value="verified shared"\n',
            'store_checker': b'from shared_http import value\n',
            'native_store_binding': b'from store_checker import value\n',
            'r15_accepted_pair': b'pass\n',
        }
        order = []
        def load(name, path, _digest):
            order.append(name)
            return a._execute_bytes(name, path, sources[name])
        with patch.dict(sys.modules, {'shared_http': SimpleNamespace(value='ambient')}), \
             patch.object(a, 'load_module', side_effect=load):
            pair = host.helpers()
            self.assertEqual(pair.native_module().value, 'verified shared')
            sys.modules['native_store_binding'] = SimpleNamespace(value='later ambient')
            self.assertEqual(pair.native_module().value, 'verified shared')
        self.assertEqual(order, ['shared_http', 'store_checker', 'native_store_binding', 'r15_accepted_pair'])

    def test_sampler_uses_exact_principal_env_order_and_bounded_lifetime(self):
        host = object.__new__(a.LiveHost)
        host.tool_pin = 'f'*64
        host.sampling_units = {'postgres': {'User': 'alisa-platform-stage', 'Group': 'alisa-platform-stage',
                                            'DynamicUser': 'no'}}
        host.unit_files_unchanged = lambda _: None
        host.baseline = {'environment': {'venv_root': '/opt/accepted-venv', 'python': {'path': '/usr/bin/python3.12'}},
                         'bases': {'platform': {'root': '/opt/accepted-platform'}}}
        counts = dict.fromkeys(readiness.POSTGRES_KEYS, 0)
        with patch.object(a, 'public_tool_directory'), patch.object(a, 'tool_hash', return_value=host.tool_pin), \
             patch.object(a.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=123)), \
             patch.object(a, 'run', return_value=c.encoded({'status': 'COUNTED', 'counts': counts})) as command:
            self.assertEqual(host._sampler('postgres'), counts)
        argv = command.call_args.args
        for value in ('--property=TimeoutStopSec=5s', '--property=KillMode=control-group',
                      '--property=SendSIGKILL=yes', '--property=OOMPolicy=stop',
                      '--property=MemoryAccounting=yes', '--property=MemorySwapMax=0'):
            self.assertIn(value, argv)
        self.assertEqual([v.partition('=')[2] for v in argv if v.startswith('--property=EnvironmentFile=')],
                         ['EnvironmentFile='+p for p in c.ENV_FILES])
        self.assertIn('--property=User=alisa-platform-stage', argv)
        self.assertIn('--setenv=PGOPTIONS='+c.PGOPTIONS, argv)
        self.assertIn('-I', argv)
        self.assertEqual(command.call_args.kwargs['timeout'], 45)

    def test_sampler_cannot_shadow_a_native_busy_count_via_voice_result(self):
        host = object.__new__(a.LiveHost)
        host.tool_pin = 'f'*64
        host.sampling_units = {'voice': {'User': 'alice-lab', 'Group': 'alice-lab', 'DynamicUser': 'no'}}
        host.unit_files_unchanged = lambda _: None
        host.baseline = {'environment': {'python': {'path': '/usr/bin/python3.12'}}}
        raw = c.encoded({'status': 'COUNTED', 'counts': {'voice_undelivered': 0, 'native_active_jobs': 0}})
        with patch.object(a, 'public_tool_directory'), patch.object(a, 'tool_hash', return_value=host.tool_pin), \
             patch.object(a.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=124)), \
             patch.object(a, 'run', return_value=raw), self.assertRaises(c.Blocked) as error:
            host._sampler('voice')
        self.assertEqual(error.exception.code, 'SAMPLER_SCHEMA')

    def test_version_check_uses_inherited_lock_and_exact_expected_publication(self):
        host = object.__new__(a.LiveHost)
        host.helper_guard = lambda: None
        host.targets = {'native': Path('/opt/accepted-native')}
        host.lock_stream = SimpleNamespace(fileno=lambda: 43)
        host.desired = {'versions': b'exact expected bytes'}
        host.expected_versions = lambda _: host.desired['versions']
        with patch.object(a, 'run', return_value=b'{"status":"UPDATE_REQUIRED"}') as command:
            host.sync_check()
        self.assertEqual(command.call_args.kwargs['pass_fds'], (43,))
        self.assertIn('--check', command.call_args.args)
        self.assertIn('--lock-fd', command.call_args.args)
        self.assertEqual(command.call_args.args[-1], '43')
        host.expected_versions = lambda _: b'different'
        with patch.object(a, 'run', return_value=b'{"status":"UPDATE_REQUIRED"}'), self.assertRaises(c.Blocked):
            host.sync_check()

    def test_generation_refresh_rejects_foreign_projection_before_any_write(self):
        host = object.__new__(a.LiveHost)
        host.helper_guard = lambda: None
        host.old_projection = {'only': 'fixture'}
        states = {'projection': {'mode': 0o600}, 'config': {'identity': 'config'}}
        host.intent = {'ours': states}
        writes = []
        host.change = lambda *args, **kwargs: writes.append((args, kwargs))
        pair = SimpleNamespace(refresh_projection=lambda _: self.fail('shared writer called'))
        host._projection_inputs = lambda expected: (pair, None, {'foreign': 'projection'}, {}, states)
        with self.assertRaisesRegex(c.Blocked, 'PROJECTION_RACE'): host.refresh()
        self.assertFalse(writes)

    def test_post_switch_does_not_apply_old_live_prepared_verifier_to_new_roles(self):
        host = object.__new__(a.LiveHost)
        calls = []
        host.verify_publications = lambda _: calls.append('candidate')
        host.protected = lambda _: calls.append('protected')
        host.intent = {'ours': {'projection': {'own': 'mask'}, 'config': {'own': 'mask'}},
                       'fences': {'web': {'own': 'mask'}}}
        host.components = {'projection': c.PROJECTION, 'config': c.CONFIG}
        host.targets = {'native': Path('/opt/native')}
        host.projection_data = lambda root, **kwargs: calls.append('generation')
        host.unit_files_unchanged = lambda _: calls.append('web-source')
        planned = {'before': {'units': {'web': {'source_hashes': {}, 'environment_stats': {}}}}}
        with patch.object(a, 'prop', return_value='masked'), \
             patch.object(a, 'path_state', return_value={'own': 'mask'}), \
             patch.object(a, 'unit_static', side_effect=AssertionError('masked unit has no command')), \
             patch.object(a, 'reserve'):
            host.post_switch(planned)
        self.assertEqual(calls, ['candidate', 'protected', 'web-source', 'generation'])

    def test_new_process_flags_are_exact_without_returning_private_environment(self):
        host = object.__new__(a.LiveHost)
        stats = b'123 (python) '+b' '.join([b'S']+[b'0']*18+[b'123456']+[b'0']*30)
        valid = b'PRIVATE_TOKEN=do-not-return\0'+b'\0'.join(x.encode()+b'=1' for x in c.FLAGS)+b'\0'
        for raw, good in ((valid, True), (valid+c.FLAGS[0].encode()+b'=1\0', False),
                          (valid.replace(c.FLAGS[1].encode()+b'=1', c.FLAGS[1].encode()+b'=0'), False)):
            with self.subTest(good=good), patch.object(Path, 'read_bytes', return_value=stats), \
                 patch.object(a.os, 'open', return_value=88), patch.object(a.os, 'read', return_value=raw), \
                 patch.object(a.os, 'close'):
                if good:
                    self.assertIsNone(host.process_flags('123'))
                else:
                    with self.assertRaises(c.Blocked) as error: host.process_flags('123')
                    self.assertNotIn('do-not-return', str(error.exception))


if __name__ == '__main__':
    unittest.main()
