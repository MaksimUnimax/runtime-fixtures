"""Disposable file/command-boundary proofs for the finite two-service rollout."""
import importlib.util
import json
from pathlib import Path
import tempfile
import os
import socket
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

PATH = Path(__file__).with_name('install_legacy_voice_clarification_20261114.py')
spec = importlib.util.spec_from_file_location('legacy_install', PATH)
install = importlib.util.module_from_spec(spec); spec.loader.exec_module(install)


class Checks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        root = self.root = Path(self.temp.name)
        self.patches = []
        for name, value in {
            'ROOT': root/'operator', 'PAYLOAD': root/'payload', 'OLD_ROOT': root/'old-operator',
            'NATIVE_BASE': root/'native-old', 'STATION_BASE': root/'station-old',
            'DROP': root/'station-override.conf', 'VERSIONS': root/'versions',
            'PROJECTION': root/'projection', 'LINK_ENV': root/'link-env'}.items():
            manager = patch.object(install, name, value); manager.start(); self.patches.append(manager)
        self.addCleanup(lambda: [p.stop() for p in reversed(self.patches)])
        install.ROOT.mkdir(); install.OLD_ROOT.mkdir(); install.NATIVE_BASE.mkdir(); install.STATION_BASE.mkdir()
        self.new = root/'native-new'; self.new.mkdir()
        self.current = root/'current'; self.current.symlink_to(install.NATIVE_BASE)
        install.VERSIONS.write_bytes(install.NATIVE_BASE.name.encode())
        install.PROJECTION.write_text('{"generation":"original"}')
        install.LINK_ENV.write_bytes(b'unchanged synthetic authorization config')
        self.events = []; self.fail_new_start = False; self.later_writer = False
        self.states = {u: 'active' for u in install.OTHER+[install.NATIVE_UNIT, install.STATION_UNIT, install.CHECKER_UNIT]}
        def atomic(path, raw, mode=0o600):
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw); path.chmod(mode)
        def pointer(path, target):
            path.unlink(); path.symlink_to(target); self.events.append(('pointer', str(target)))
        def prop(unit, key):
            if key == 'ActiveState': return self.states[unit]
            if key == 'WorkingDirectory': return 'unchanged-'+unit
            if key == 'MainPID': return '1234'
            raise AssertionError(key)
        def run(*args):
            self.events.append(tuple(args))
            if args[:3] == ('systemctl', '--no-block', 'stop'):
                self.states[args[3]] = 'inactive'
            if args[:2] == ('systemctl', 'start'):
                unit = args[2]
                if unit == install.NATIVE_UNIT and self.current.resolve() == self.new and self.fail_new_start:
                    self.fail_new_start = False
                    if self.later_writer:
                        other = root/'other-writer'; other.mkdir(); pointer(self.current, other)
                    raise RuntimeError('SYNTHETIC_NATIVE_START_FAILURE')
                self.states[unit] = 'active'
            return ''
        def refresh(original, on_write=None):
            value = {**original, 'generation': self.current.resolve().name}
            raw = json.dumps(value).encode(); atomic(install.PROJECTION, raw)
            self.events.append(('owner_pair', self.current.resolve().name))
            if on_write is not None: on_write(raw)
        pair = SimpleNamespace(projection_data=lambda: json.loads(install.PROJECTION.read_text()),
            expected_version_bytes=lambda source: source.name.encode(),
            sync=lambda source, lock: atomic(install.VERSIONS, source.name.encode()),
            refresh_projection=refresh)
        self.m = SimpleNamespace(NATIVE=self.new, CURRENT=self.current, atomic=atomic, pointer=pointer,
            prop=prop, run=run, pair=lambda:pair, record=lambda n,v:atomic(install.ROOT/n,(json.dumps(v)+'\n').encode()),
            reserve=lambda *a:None)
        (self.new/'manifest.json').write_text('{}')
        self.value = {'source':'1'*40}
        self.target = install.station_target(self.value); self.target.mkdir()
        (self.target/'manifest.json').write_text('{}')

    def activate(self):
        with patch.object(install, 'checked'), patch.object(install, 'ready'):
            return install.activate(self.m, self.value, None)

    def test_success_preserves_authorization_config_and_changes_two_selectors(self):
        self.activate()
        self.assertEqual(self.current.resolve(), self.new)
        self.assertEqual(install.DROP.read_bytes(), install.drop_bytes(self.target))
        self.assertEqual(install.LINK_ENV.read_bytes(), b'unchanged synthetic authorization config')
        receipt = json.loads((install.ROOT/'ACTIVATED.json').read_text())
        self.assertEqual(receipt['database_migrations'], [])
        self.assertEqual(receipt['new_accounts_links_grants'], 0)
        self.assertEqual(self.events[0], ('systemctl','--no-block','stop',install.STATION_UNIT))
        self.assertEqual(self.events[1], ('systemctl','--no-block','stop',install.NATIVE_UNIT))

    def test_native_start_failure_restores_both_services_and_old_generation_scope(self):
        self.fail_new_start = True
        with self.assertRaisesRegex(RuntimeError, 'SYNTHETIC_NATIVE_START_FAILURE'):
            self.activate()
        self.assertEqual(self.current.resolve(), install.NATIVE_BASE)
        self.assertFalse(install.DROP.exists())
        self.assertEqual(install.VERSIONS.read_bytes(), install.NATIVE_BASE.name.encode())
        self.assertEqual(json.loads(install.PROJECTION.read_text())['generation'], install.NATIVE_BASE.name)
        self.assertEqual(self.states[install.NATIVE_UNIT], 'active')
        self.assertEqual(self.states[install.STATION_UNIT], 'active')
        self.assertEqual(json.loads((install.ROOT/'ROLLED_BACK.json').read_text())['status'], 'ROLLED_BACK')
        self.assertFalse((install.ROOT/'ACTIVATED.json').exists())

    def test_later_writer_is_preserved_instead_of_overwritten_by_rollback(self):
        self.fail_new_start = self.later_writer = True
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_LATER_WRITER'):
            self.activate()
        self.assertEqual(self.current.resolve().name, 'other-writer')
        self.assertTrue(install.DROP.exists())
        self.assertFalse((install.ROOT/'ROLLED_BACK.json').exists())

    def test_already_draining_stop_is_observed_without_duplicate_command(self):
        states = iter(['deactivating','deactivating','inactive'])
        self.m.prop = lambda *a: next(states)
        with patch.object(install.time, 'sleep'):
            install.stop_unit(self.m, install.NATIVE_UNIT)
        self.assertEqual(self.events, [])

    def test_mutated_payload_is_rejected_before_any_service_command(self):
        native = {'engine.py','runtime.py','dialogue.py','template_runtime.py','template_clarification.py',
                  'legacy_voice.py','CURRENT_CORE_MANIFEST.json','tests/test_legacy_voice_clarification.py'}
        station = {'service.py','station_authority.py'}
        value = {'source':'1'*40, 'native_files':{}, 'station_files':{}}
        for kind, names in [('native',native),('station',station)]:
            for name in names:
                path = install.PAYLOAD/kind/name; path.parent.mkdir(parents=True,exist_ok=True); path.write_text('fixture')
                value[kind+'_files'][name] = install.sha(path)
        (install.ROOT/'PLAN.json').write_text(json.dumps(value))
        (install.PAYLOAD/'station/service.py').write_text('changed after review')
        with self.assertRaisesRegex(RuntimeError, 'PAYLOAD_CHANGED'):
            install.load_plan()
        self.assertEqual(self.events, [])

    def test_unlisted_core_file_change_is_rejected(self):
        (install.PAYLOAD/'native').mkdir(parents=True)
        (install.PAYLOAD/'native/CURRENT_CORE_MANIFEST.json').write_text(json.dumps({'files':{'foreign.py':'bad'}}))
        value = {'source':'1'*40,'native_files':{},'station_files':{}}
        with self.assertRaisesRegex(RuntimeError, 'UNTOUCHED_NATIVE_FILES_CHANGED'):
            install.candidates(self.m,value,[{'files':{'unchanged.py':'good'}},{'files':{}}])
        self.assertEqual(self.events, [])

    def test_failed_prepare_preserves_partial_candidate_for_review(self):
        (self.new/'manifest.json').unlink(); self.new.rmdir(); self.target.joinpath('manifest.json').unlink(); self.target.rmdir()
        helper = install.OLD_ROOT/'pair_helpers.py'; helper.write_text('synthetic source')
        self.m.PAIR_SHA = install.sha(helper)
        def failed_copy(base, dest, *args):
            dest.mkdir(); (dest/'retained-evidence').write_text('partial')
            raise RuntimeError('COPY_FAILED')
        self.m.copy_release = failed_copy
        value = dict(self.value, native_files={}, station_files={})
        with patch.object(install, 'base_check', return_value=({},{})), patch.object(install, 'candidates', return_value=({},{})):
            with self.assertRaisesRegex(RuntimeError, 'COPY_FAILED'):
                install.prepare(self.m,value)
        self.assertTrue((self.new/'retained-evidence').exists())
        self.assertTrue((install.ROOT/'PREPARE_FAILED.json').exists())


    def ready_environment(self):
        # Exercise the real ready()/ready_once() path; only the child command
        # and HTTP boundary use doubles. All services are already active.
        install.VERSIONS.write_text('{}')
        self.m.NATIVE = Path.cwd()
        def prop(unit, key):
            if key == 'ActiveState':return self.states[unit]
            if key == 'WorkingDirectory':return str(self.target)
            if key == 'MainPID':return str(os.getpid())
            raise AssertionError(key)
        self.m.prop = prop
        manager = patch.object(install, 'AUTH_DIR', self.root/'sockets')
        manager.start();self.addCleanup(manager.stop)
        def sockets():
            install.AUTH_DIR.mkdir(mode=0o710)
            for name, mode in [('authorization.sock',0o660),('ingress.sock',0o700)]:
                sock=socket.socket(socket.AF_UNIX);sock.bind(str(install.AUTH_DIR/name))
                self.addCleanup(sock.close);(install.AUTH_DIR/name).chmod(mode)
        self.make_sockets = sockets
        self.sleep_calls=[]
        def delayed(_):
            self.sleep_calls.append(True)
            if not install.AUTH_DIR.exists():sockets()
        opener=SimpleNamespace(open=lambda *a,**k:SimpleNamespace(
            __enter__=lambda x:x,__exit__=lambda *a:None,status=200))
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):pass
        opener.open=lambda *a,**k:Response()
        managers=[
            patch.object(install.time,'sleep',side_effect=delayed),
            patch.object(install.subprocess,'run',side_effect=lambda args,**kw:
                SimpleNamespace(returncode=0,stdout='PASS' if args[0]=='/usr/bin/python3' else '{}')),
            patch.object(install.urllib.request,'build_opener',return_value=opener)]
        for manager in managers:manager.start();self.addCleanup(manager.stop)

    def test_active_service_waits_for_late_socket(self):
        self.ready_environment()
        install.ready(self.m,self.value)
        self.assertEqual(len(self.sleep_calls),1)
        self.assertTrue((install.AUTH_DIR/'authorization.sock').exists())
        self.assertEqual(self.events,[])


    def test_restrictive_umask_modes_wait_for_final_chmod(self):
        self.ready_environment();self.make_sockets()
        install.AUTH_DIR.chmod(0o700)
        (install.AUTH_DIR/'authorization.sock').chmod(0o700)
        def finish_chmod(_):
            self.sleep_calls.append(True)
            install.AUTH_DIR.chmod(0o710)
            (install.AUTH_DIR/'authorization.sock').chmod(0o660)
        with patch.object(install.time,'sleep',side_effect=finish_chmod):
            install.ready(self.m,self.value)
        self.assertEqual(len(self.sleep_calls),1)
        self.assertEqual(self.events,[])

    def test_wrong_socket_acl_fails_immediately(self):
        self.ready_environment();self.make_sockets()
        (install.AUTH_DIR/'authorization.sock').chmod(0o666)
        with self.assertRaisesRegex(RuntimeError,'SOCKET_MODE'):
            install.ready(self.m,self.value)
        self.assertEqual(self.sleep_calls,[])

    def test_confirmed_authority_denial_does_not_retry(self):
        self.ready_environment();self.make_sockets()
        with patch.object(install.subprocess,'run',return_value=SimpleNamespace(returncode=1,stdout='')):
            with self.assertRaisesRegex(RuntimeError,'CORE_UID_STATION_AUTHORITY'):
                install.ready(self.m,self.value)
        self.assertEqual(self.sleep_calls,[])

    def test_temporary_authority_connection_failure_is_retried(self):
        self.ready_environment();self.make_sockets()
        values=iter([SimpleNamespace(returncode=75,stdout=''),
                     SimpleNamespace(returncode=0,stdout='PASS'),
                     SimpleNamespace(returncode=0,stdout='{}')])
        with patch.object(install.subprocess,'run',side_effect=lambda *a,**k:next(values)):
            install.ready(self.m,self.value)
        self.assertEqual(len(self.sleep_calls),1)

    def test_readiness_deadline_is_bounded(self):
        with patch.object(install,'ready_once',side_effect=FileNotFoundError), \
             patch.object(install.time,'monotonic',side_effect=[0,31]), \
             patch.object(install.time,'sleep') as sleep:
            with self.assertRaisesRegex(RuntimeError,'READINESS_TIMEOUT'):
                install.ready(self.m,self.value)
        sleep.assert_not_called()

    def test_version_mismatch_is_not_treated_as_temporary(self):
        self.ready_environment();self.make_sockets()
        values=iter([SimpleNamespace(returncode=0,stdout='PASS'),
                     SimpleNamespace(returncode=0,stdout='{"catalog":"wrong"}')])
        with patch.object(install.subprocess,'run',side_effect=lambda *a,**k:next(values)):
            with self.assertRaisesRegex(RuntimeError,'VERSION_HANDSHAKE'):
                install.ready(self.m,self.value)
        self.assertEqual(self.sleep_calls,[])


if __name__ == '__main__':
    unittest.main()
