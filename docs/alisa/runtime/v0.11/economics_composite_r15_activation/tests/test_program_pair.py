"""Pairing guard and failure ordering; disposable files, never live services."""
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch
import os
import stat
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import program_pair as p


class FileObserver:
    def __init__(self, root):
        self.root = root
        self.calls = []
        self.changed = None
        self.units = {}
        self.files = {}
        for name in p.FILES:
            path = root / name
            path.write_bytes(('fixture:' + name).encode())
            path.chmod(0o444)
            self.files[name] = p.digest(path.read_bytes())
        self.unit_root = root.parent / 'units'
        self.unit_root.mkdir(mode=0o700)
        self.unit_hashes = {}
        for name in p.UNIT_FILES:
            f = self.unit_root / name
            f.write_bytes(('unit:' + name).encode())
            f.chmod(0o644)
            self.unit_hashes[name] = p.digest(f.read_bytes())
        for query, fragment in p.UNIT_QUERIES.items():
            v = {'LoadState': 'loaded', 'FragmentPath': '/etc/systemd/system/' + fragment,
                 'DropInPaths': '', 'NeedDaemonReload': 'no'}
            if query == 'alisa-program.socket':
                v.update(ActiveState='active', SubState='listening', Accept='yes',
                         Listen='/run/alisa-program/runner.sock (Stream)', SocketUser='alice-market',
                         SocketGroup='alice-lab', SocketMode='0600')
            else:
                suffix = ' --sweep' if query == 'alisa-program-cleanup.service' else ''
                v['ExecStart'] = ('{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 -B '
                                 + str(root) + '/program_broker.py' + suffix
                                 + ' ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; }')
            self.units[query] = v
        self.unit_reads = 0
        root.chmod(0o555)

    def resolve(self, path):
        if path.startswith('/etc/systemd/system/'):
            return self.unit_root / Path(path).name
        return Path(path)

    def identity(self, path, *, immutable, directory):
        actual = self.resolve(path)
        s = actual.lstat()
        if directory:
            p.need(stat.S_ISDIR(s.st_mode), 'PROGRAM_PAIR_TYPE')
        else:
            p.need(stat.S_ISREG(s.st_mode) and s.st_nlink == 1, 'PROGRAM_PAIR_TYPE')
        p.need(not s.st_mode & (0o222 if immutable else 0o022), 'PROGRAM_PAIR_MODE')
        return [s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_size, s.st_mtime_ns, s.st_ctime_ns]

    def file(self, path):
        self.calls.append(('read', path))
        return self.resolve(path).read_bytes()

    def names(self, root):
        return [x.name for x in Path(root).iterdir()]

    def unit(self, name):
        self.calls.append(('show', name))
        self.unit_reads += 1
        v = deepcopy(self.units[name])
        if self.changed is not None:
            self.changed(self, name)
        return v


class PairGuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='r15-pair-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / 'program'
        self.root.mkdir(mode=0o700)
        self.o = FileObserver(self.root)
        self.addCleanup(lambda: self.root.chmod(0o700))
        for key, value in [('ROOT', str(self.root)), ('FILES', self.o.files),
                           ('UNIT_FILES', self.o.unit_hashes)]:
            context = patch.object(p, key, value)
            context.start()
            self.addCleanup(context.stop)

    def check(self):
        return p.inspect_pair(self.o, p.CLIENT_SHA256)

    def block(self, code):
        with self.assertRaises(p.PairBlocked) as err:
            self.check()
        self.assertEqual(err.exception.code, code)

    def test_full_pair_uses_only_reads_and_systemctl_show(self):
        state = self.check()
        self.assertEqual(len(state['files']), 7)
        self.assertEqual(len(state['unit_files']), 3)
        self.assertEqual(self.o.unit_reads, 6)
        self.assertEqual({kind for kind, _ in self.o.calls}, {'read', 'show'})

    def test_wrong_consumer_fails_before_observation(self):
        with self.assertRaises(p.PairBlocked) as err:
            p.inspect_pair(self.o, 'f'*64)
        self.assertEqual(err.exception.code, 'PROGRAM_PAIR_CONSUMER')
        self.assertEqual(self.o.calls, [])

    def test_all_payload_files_are_pinned_not_just_manifest(self):
        for name in list(p.FILES):
            f = self.root/name
            raw = f.read_bytes()
            f.chmod(0o644); f.write_bytes(raw+b'changed'); f.chmod(0o444)
            self.block('PROGRAM_PAIR_FILE')
            f.chmod(0o644); f.write_bytes(raw); f.chmod(0o444)

    def test_each_unit_definition_is_pinned(self):
        for name in p.UNIT_FILES:
            f = self.o.unit_root/name
            raw = f.read_bytes(); f.write_bytes(raw+b'changed')
            self.block('PROGRAM_PAIR_UNIT_FILE')
            f.write_bytes(raw)

    def test_pyc_or_other_extra_file_blocks(self):
        self.root.chmod(0o755)
        (self.root/'program_broker.pyc').write_bytes(b'extra')
        self.root.chmod(0o555)
        self.block('PROGRAM_PAIR_INVENTORY')

    def test_missing_file_does_not_fall_back(self):
        self.root.chmod(0o755)
        (self.root/'program_broker.py').unlink()
        self.root.chmod(0o555)
        self.block('PROGRAM_PAIR_INVENTORY')

    def test_symlink_in_place_of_pinned_file_refused(self):
        f = self.root/'program_broker.py'; target = self.root.parent/'borrowed'
        target.write_bytes(f.read_bytes()); target.chmod(0o444)
        self.root.chmod(0o755); f.unlink(); f.symlink_to(target); self.root.chmod(0o555)
        self.block('PROGRAM_PAIR_TYPE')

    def test_writable_file_refused(self):
        (self.root/'program_broker.py').chmod(0o644)
        self.block('PROGRAM_PAIR_MODE')

    def test_hardlinked_payload_refused(self):
        os.link(self.root/'program_broker.py', self.root.parent/'alias')
        self.block('PROGRAM_PAIR_TYPE')

    def test_loaded_old_broker_refused_even_with_correct_files(self):
        self.o.units[p.PROBE_UNIT]['ExecStart'] = self.o.units[p.PROBE_UNIT]['ExecStart'].replace(
            str(self.root), '/opt/alisa-program/releases/old')
        self.block('PROGRAM_PAIR_COMMAND')

    def test_stale_cleanup_command_refused(self):
        u = self.o.units['alisa-program-cleanup.service']
        u['ExecStart'] = u['ExecStart'].replace(' --sweep', '')
        self.block('PROGRAM_PAIR_COMMAND')

    def test_override_or_unloaded_or_pending_reload_refused(self):
        for field, bad in [('DropInPaths', '/etc/systemd/system/x.conf'), ('NeedDaemonReload', 'yes'),
                           ('LoadState', 'not-found'), ('FragmentPath', '/run/foreign.service')]:
            old = self.o.units[p.PROBE_UNIT][field]
            self.o.units[p.PROBE_UNIT][field] = bad
            self.block('PROGRAM_PAIR_LOADED_UNIT')
            self.o.units[p.PROBE_UNIT][field] = old

    def test_socket_identity_admission_and_endpoint_preserved(self):
        u = self.o.units['alisa-program.socket']
        for field, bad in [('ActiveState','inactive'), ('SubState','dead'), ('Accept','no'),
                           ('Listen','/run/other.sock (Stream)'), ('SocketMode','0666'),
                           ('SocketUser','root'), ('SocketGroup','root')]:
            old = u[field];u[field] = bad
            self.block('PROGRAM_PAIR_SOCKET');u[field] = old

    def test_same_bytes_replaced_between_samples_is_detected(self):
        def replace(o, name):
            if o.unit_reads != 3:return
            f=self.root/'program_results.py';raw=f.read_bytes()
            self.root.chmod(0o755)
            n=self.root/'replacement';n.write_bytes(raw);n.chmod(0o444);os.replace(n,f)
            self.root.chmod(0o555)
        self.o.changed = replace
        self.block('PROGRAM_PAIR_CHANGED')

    def test_unavailable_dependency_does_not_emit_exception_details(self):
        with patch.object(self.o,'file',side_effect=PermissionError('private material')):
            self.block('PROGRAM_PAIR_UNAVAILABLE')


class PhaseHost:
    def __init__(self, fail=None, restore=True):
        self.fail=fail;self.restore=restore;self.events=[];self.marker=False
    def action(self, event):
        self.events.append(event)
        if event==self.fail:raise RuntimeError('injected')
    def check_plan_and_window(self):self.action('initial_check')
    def backup(self):self.action('backup')
    def fence_socket_and_cleanup(self):self.action('fence')
    def require_admission_fence(self):self.action('confirm_fence')
    def require_idle_and_locks(self):self.action('idle_locks')
    def verify_old_and_candidate(self):self.action('verify_inputs')
    def publish_immutable_pair(self):self.action('publish')
    def switch_owned_units(self):self.action('switch')
    def reload_and_verify_new(self):self.action('reload_verify')
    def check_window_and_fences(self):self.action('final_fences')
    def mark_admission_possible(self):self.marker=True;self.action('marker')
    def release_and_start_socket(self):self.action('start_socket')
    def verify_installed_pair(self):self.action('verify_installed')
    def restore_before_admission(self):self.action('restore');return self.restore
    def record(self,status):self.action('record:'+status)


class PairRolloutTests(unittest.TestCase):
    def test_broker_admission_only_after_exact_validation_and_durable_marker(self):
        h=PhaseHost();self.assertEqual(p.rollout_pair(h),'PROGRAM_PAIR_TECHNICAL_PASS')
        self.assertLess(h.events.index('final_fences'),h.events.index('marker'))
        self.assertLess(h.events.index('marker'),h.events.index('start_socket'))
        self.assertNotIn('restore',h.events)

    def test_initial_or_backup_failure_does_not_stop_anything(self):
        for fail in ('initial_check','backup'):
            h=PhaseHost(fail)
            with self.assertRaises(RuntimeError):p.rollout_pair(h)
            self.assertNotIn('fence',h.events)
            self.assertNotIn('restore',h.events)

    def test_failed_or_partial_fence_never_enters_rollback(self):
        for fail in ('fence', 'confirm_fence'):
            h = PhaseHost(fail)
            self.assertEqual(p.rollout_pair(h), 'PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW')
            self.assertNotIn('restore', h.events)
            self.assertNotIn('switch', h.events)
            self.assertNotIn('start_socket', h.events)

    def test_each_pre_admission_failure_uses_guarded_restore(self):
        for fail in ('idle_locks','verify_inputs','publish','switch','reload_verify','final_fences'):
            with self.subTest(fail=fail):
                h=PhaseHost(fail)
                self.assertEqual(p.rollout_pair(h),'PROGRAM_PAIR_PRE_ADMISSION_RESTORED')
                self.assertIn('restore',h.events)
                self.assertNotIn('start_socket',h.events)

    def test_later_writer_refuses_rollback(self):
        h=PhaseHost('switch',restore=False)
        self.assertEqual(p.rollout_pair(h),'PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW')
        self.assertNotIn('start_socket',h.events)

    def test_marker_write_or_fsync_uncertainty_never_automatically_restores(self):
        h=PhaseHost('marker')
        self.assertEqual(p.rollout_pair(h),'PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW')
        self.assertNotIn('restore',h.events)
        self.assertNotIn('start_socket',h.events)

    def test_every_post_marker_failure_is_no_downgrade(self):
        for fail in ('start_socket','verify_installed','record:PROGRAM_PAIR_TECHNICAL_PASS'):
            h=PhaseHost(fail)
            self.assertEqual(p.rollout_pair(h),'PROGRAM_PAIR_RECOVERY_REQUIRES_REVIEW')
            self.assertNotIn('restore',h.events)




class R15IntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import activate
        cls.a = activate

    def test_pairing_module_is_inside_verified_tool_closure(self):
        self.assertIn('program_pair.py', self.a.c.TOOL_FILES)
        self.assertEqual(set(self.a._raw_tools()), set(self.a.c.TOOL_FILES))

    def test_actual_host_converts_pair_error_to_bounded_activation_code(self):
        a = self.a
        host = object.__new__(a.LiveHost)
        host.bundle = Path('/private/fixture')
        with patch.object(a, 'regular', return_value=b'client'), patch.object(
                a.program_pair, 'inspect_pair', side_effect=a.program_pair.PairBlocked('PROGRAM_PAIR_FILE')):
            with self.assertRaises(a.c.Blocked) as err:
                host.program_pair()
        self.assertEqual(err.exception.code, 'PROGRAM_PAIR_FILE')

    def test_native_start_rechecks_pair_before_any_unit_start_validation(self):
        a = self.a
        host = object.__new__(a.LiveHost)
        host.program_pair = lambda: {'pair': 'changed'}
        seen = []
        host.unit_files_unchanged = lambda value: seen.append(value)
        with self.assertRaises(a.c.Blocked) as err:
            host.validate_start('native', {'before': {'program_pair': {'pair': 'expected'}}})
        self.assertEqual(err.exception.code, 'PROGRAM_PAIR_CHANGED')
        self.assertEqual(seen, [])

    def test_protected_checks_pair_before_any_other_component(self):
        a = self.a
        host = object.__new__(a.LiveHost)
        host.program_pair = lambda: {'pair': 'changed'}
        with patch.object(a, 'path_state', side_effect=AssertionError('must not reach')):
            with self.assertRaises(a.c.Blocked) as err:
                host.protected({'before': {'program_pair': {'pair': 'expected'}}})
        self.assertEqual(err.exception.code, 'PROGRAM_PAIR_CHANGED')

    def test_source_input_pins_were_not_silently_requalified(self):
        a = self.a
        self.assertEqual(a.c.PRODUCT, '1964d60f9a7598fefa2e10a0affcda0cce0f1f34')
        self.assertEqual(a.c.SOURCE_INDEX, '3b6bee51f233398d46c15646b3435edf147ee19e9cdf7abe74ae8908472dc26b')


if __name__ == '__main__':
    unittest.main(verbosity=2)
