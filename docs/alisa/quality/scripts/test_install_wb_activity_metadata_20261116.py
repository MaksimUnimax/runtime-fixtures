"""Portable failure boundaries for the finite WB metadata deployment."""
import ast
import ctypes
import errno
import importlib.util
import json
import os
import re
from pathlib import Path
from copy import deepcopy
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('install_wb_activity_metadata_20261116.py')
spec = importlib.util.spec_from_file_location('wb_metadata_rollout', SOURCE)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)


class MetadataScope(unittest.TestCase):
    def setUp(self):
        self.catalog = {'templates': {key: {'id': key, 'version': 1,
            'input_policy': {'time_axis': 'order_period'}, 'steps': [{'unchanged': True}]}
            for key in m.IDS}}
        self.catalog['templates'].update({'parameter.'+str(n): {'opaque': [n, {'future': True}]}
                                         for n in range(86)})
        self.catalog['mode'] = {'preserved': True}
        self.blocks = {'entries': [{'id': key, 'time_axis': 'order_period'} for key in m.IDS] +
                       [{'id': 'B04.buyout_units_cohort', 'time_axis': 'order_period'}]}

    def changes(self):
        catalog, blocks = deepcopy(self.catalog), deepcopy(self.blocks)
        for key in m.IDS:
            catalog['templates'][key]['version'] = 2
            catalog['templates'][key]['input_policy']['time_axis'] = 'analytics_period'
        for row in blocks['entries']:
            if row['id'] in m.IDS: row['time_axis'] = 'analytics_period'
        return {'template_catalog.json': json.dumps(catalog), 'base_blocks.json': json.dumps(blocks)}

    def test_only_the_two_version_and_axis_fields_are_admitted(self):
        before = deepcopy(self.catalog)
        m.metadata_guard(self.blocks, self.catalog, self.changes())
        self.assertEqual(self.catalog, before)

    def test_changed_execution_is_rejected(self):
        changes = self.changes(); value = json.loads(changes['template_catalog.json'])
        value['templates']['B14.card_views']['steps'].append({'new_api': True})
        changes['template_catalog.json'] = json.dumps(value)
        with self.assertRaisesRegex(RuntimeError, 'METADATA_EXECUTION_CHANGED'):
            m.metadata_guard(self.blocks, self.catalog, changes)

    def test_saved_parameter_or_other_definition_cannot_change(self):
        changes = self.changes(); value = json.loads(changes['template_catalog.json'])
        value['templates']['parameter.1']['opaque'] = 'changed'
        changes['template_catalog.json'] = json.dumps(value)
        with self.assertRaisesRegex(RuntimeError, 'METADATA_EXECUTION_CHANGED'):
            m.metadata_guard(self.blocks, self.catalog, changes)

    def test_order_cohort_axis_cannot_change(self):
        changes = self.changes(); value = json.loads(changes['base_blocks.json'])
        value['entries'][-1]['time_axis'] = 'analytics_period'
        changes['base_blocks.json'] = json.dumps(value)
        with self.assertRaisesRegex(RuntimeError, 'METADATA_EXECUTION_CHANGED'):
            m.metadata_guard(self.blocks, self.catalog, changes)

    def test_extra_file_is_rejected(self):
        changes = self.changes(); changes['engine.py'] = 'not admitted'
        with self.assertRaisesRegex(RuntimeError, 'METADATA_SCOPE'):
            m.metadata_guard(self.blocks, self.catalog, changes)

    def test_wrong_template_count_is_rejected(self):
        del self.catalog['templates']['parameter.1']
        with self.assertRaisesRegex(RuntimeError, 'TEMPLATE_COUNT'):
            m.metadata_guard(self.blocks, self.catalog, self.changes())

    def test_future_version_is_not_downgraded(self):
        self.catalog['templates']['B14.card_views']['version'] = 3
        with self.assertRaisesRegex(RuntimeError, 'METADATA_BASE_MOVED'):
            m.metadata_guard(self.blocks, self.catalog, self.changes())


class NativeRollbackBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.base, self.app = self.root/'native-base', self.root/'native-app'
        self.webbase, self.webapp = self.root/'web-base', self.root/'web-app'
        for p in [self.base, self.app, self.webbase, self.webapp]: p.mkdir()
        self.current, self.web = self.root/'native-current', self.root/'web-current'
        self.current.symlink_to(self.base); self.web.symlink_to(self.webbase)
        primitives = Path(__file__).with_name('install_customer_catalog_20261115.py')
        names = {'need', 'sha', 'path_state', 'rename_no_replace', 'replace_selection', 'run', 'exact_tree', 'safe'}
        tree = ast.parse(primitives.read_text())
        pg = {'os': os, 'ctypes': ctypes, 'errno': errno, 'Path': Path,
              're': re, 'subprocess': types.SimpleNamespace(run=lambda *a, **k:
                  types.SimpleNamespace(returncode=0, stdout=''))}
        import hashlib
        pg['hashlib'] = hashlib
        exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                     and n.name in names], type_ignores=[]), str(primitives), 'exec'), pg)
        self.events = []; self.protected = {'six_services': 'same'}
        self.actual = dict(self.protected)
        self.native_active = True; self.fail_stop = self.fail_sync = self.fail_projection = False
        def run(*args):
            self.events.append(args)
            if args == ('systemctl', 'stop', m.UNIT):
                if not self.fail_stop: self.native_active = False
            elif args == ('systemctl', 'start', m.UNIT): self.native_active = True
        def atomic(path, raw, mode=0o600):
            path = Path(path); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
        self.real_tree = pg['exact_tree']
        self.h = types.SimpleNamespace(path_state=pg['path_state'], replace_selection=pg['replace_selection'],
            run=run, prop=lambda unit, key: 'active' if self.native_active else 'inactive',
            atomic=atomic, active=lambda units: self.assertTrue(self.native_active))
        self.versions, self.projection = self.root/'versions.json', self.root/'scope.json'
        self.versions.write_bytes(b'new-versions'); self.projection.write_bytes(b'old-projection')
        def sync(target, lock):
            self.events.append(('sync', target.name))
            if self.fail_sync: raise RuntimeError('SYNC_FAILED')
            self.versions.write_bytes(b'old-versions' if target == self.base else b'new-versions')
        def refresh(original, on_write=None):
            self.events.append(('refresh',))
            if self.fail_projection: raise RuntimeError('PROJECTION_FAILED')
            raw = b'refreshed-projection'; self.projection.write_bytes(raw)
            if on_write: on_write(raw)
        self.pair = types.SimpleNamespace(VERSIONS=self.versions, PROJECTION=self.projection,
            sync=sync, refresh_projection=refresh, projection_data=lambda: {'synthetic': True},
            expected_version_bytes=lambda root: b'new-versions')
        self.plan = {'protected': self.protected, 'native_selector': self.h.path_state(self.current),
                     'web_selector': self.h.path_state(self.web)}
        self.current.unlink(); self.current.symlink_to(self.app)
        self.owned = self.h.path_state(self.current)
        patcher = patch.multiple(m, ROOT=self.root, CURRENT=self.current, NATIVE_BASE=self.base,
            NATIVE=self.app, WEB_BASE=self.webbase, WEB_LINK=self.web)
        patcher.start(); self.addCleanup(patcher.stop)
        self.capture_patch = patch.object(m, 'capture', lambda utility: dict(self.actual))
        self.capture_patch.start(); self.addCleanup(self.capture_patch.stop)
        q = patch.object(m, 'queue', lambda: {'unknown': sorted(m.UNKNOWN), 'max_call_id': 4, 'at': 1})
        q.start(); self.addCleanup(q.stop)
        np = patch.object(m, 'native_process', lambda h, root: self.events.append(('process', root.name)))
        np.start(); self.addCleanup(np.stop)

    def restore(self):
        return m.rollback(self.plan, object(), self.h, self.pair, {'synthetic': True}, self.owned,
            {m.digest(b'new-versions'), m.digest(b'old-versions')}, {m.digest(b'old-projection')}, object())

    def test_rollback_restores_pointer_versions_and_owner_generation_in_order(self):
        self.restore()
        self.assertEqual(self.current.resolve(), self.base)
        self.assertEqual(self.versions.read_bytes(), b'old-versions')
        self.assertLess(self.events.index(('sync', self.base.name)),
                        self.events.index(('systemctl', 'start', m.UNIT)))
        self.assertLess(self.events.index(('systemctl', 'start', m.UNIT)),
                        self.events.index(('refresh',)))
        self.assertTrue((self.root/'ROLLED_BACK.json').exists())
        self.assertFalse(any(event[0] == 'systemctl' and event[-1] in m.KEEP for event in self.events))

    def test_foreign_selector_prevents_every_rollback_mutation(self):
        foreign = self.root/'foreign'; foreign.mkdir()
        self.current.unlink(); self.current.symlink_to(foreign)
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_SELECTOR_MOVED'): self.restore()
        self.assertEqual(self.events, []); self.assertEqual(self.current.resolve(), foreign)

    def test_foreign_versions_prevent_stopping_native(self):
        self.versions.write_bytes(b'foreign')
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_MUTABLE_MOVED'): self.restore()
        self.assertEqual(self.events, [])

    def test_foreign_projection_prevents_stopping_native(self):
        self.projection.write_bytes(b'foreign')
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_MUTABLE_MOVED'): self.restore()
        self.assertEqual(self.events, [])

    def test_changed_protected_services_prevent_mutation(self):
        self.actual['six_services'] = 'later writer'
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_PROTECTED_MOVED'): self.restore()
        self.assertEqual(self.events, [])

    def test_unresolved_web_selection_requires_review(self):
        self.web.unlink(); self.web.symlink_to(self.webapp)
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_WEB_REQUIRES_REVIEW'): self.restore()
        self.assertEqual(self.events, [])

    def test_same_target_foreign_web_selector_blocks_rollback_before_mutation(self):
        original = self.h.path_state(self.web)
        replacement = self.root/'foreign-web'
        replacement.symlink_to(self.webbase)
        replacement.replace(self.web)
        self.assertNotEqual(self.h.path_state(self.web), original)
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_WEB_REQUIRES_REVIEW'):
            self.restore()
        self.assertEqual(self.events, [])

    def test_failed_stop_never_replaces_selector_or_syncs(self):
        self.fail_stop = True
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_STOP_UNRESOLVED'): self.restore()
        self.assertEqual(self.current.resolve(), self.app)
        self.assertFalse(any(event[0] == 'sync' for event in self.events))

    def test_foreign_selector_during_stop_without_owned_selection_never_syncs_or_starts(self):
        self.current.unlink(); self.current.symlink_to(self.base)
        self.plan['native_selector'] = self.h.path_state(self.current)
        foreign = self.root/'foreign'; foreign.mkdir()
        original_run = self.h.run
        def change_during_stop(*args):
            original_run(*args)
            if args == ('systemctl', 'stop', m.UNIT):
                replacement = self.root/'later-native'
                replacement.symlink_to(foreign); replacement.replace(self.current)
        with patch.object(self.h, 'run', side_effect=change_during_stop):
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_SELECTOR_MOVED'):
                m.rollback(self.plan, object(), self.h, self.pair, {'synthetic': True}, None,
                    {m.digest(b'new-versions'), m.digest(b'old-versions')},
                    {m.digest(b'old-projection')}, object())
        self.assertEqual(self.current.resolve(), foreign)
        self.assertFalse(any(e[0] == 'sync' or e[:2] == ('systemctl','start') for e in self.events))

    def test_foreign_versions_during_stop_never_syncs_or_starts(self):
        original_run = self.h.run
        def change_during_stop(*args):
            original_run(*args)
            if args == ('systemctl', 'stop', m.UNIT): self.versions.write_bytes(b'foreign')
        with patch.object(self.h, 'run', side_effect=change_during_stop):
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_MUTABLE_MOVED'): self.restore()
        self.assertEqual(self.current.resolve(), self.app)
        self.assertFalse(any(e[0] == 'sync' or e[:2] == ('systemctl','start') for e in self.events))

    def test_foreign_selector_during_sync_never_starts_native(self):
        original_sync = self.pair.sync
        foreign = self.root/'foreign'; foreign.mkdir()
        def change_during_sync(*args):
            original_sync(*args)
            replacement=self.root/'later-native'
            replacement.symlink_to(foreign); replacement.replace(self.current)
        with patch.object(self.pair, 'sync', side_effect=change_during_sync):
            with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_SELECTOR_MOVED'): self.restore()
        self.assertEqual(self.current.resolve(), foreign)
        self.assertFalse(any(e[:2] == ('systemctl','start') for e in self.events))

    def test_failed_version_sync_never_starts_native(self):
        self.fail_sync = True
        with self.assertRaisesRegex(RuntimeError, 'SYNC_FAILED'): self.restore()
        self.assertFalse(any(event[:2] == ('systemctl', 'start') for event in self.events))

    def test_projection_failure_does_not_start_other_services(self):
        self.fail_projection = True
        with self.assertRaisesRegex(RuntimeError, 'PROJECTION_FAILED'): self.restore()
        self.assertFalse(any(event[0] == 'systemctl' and event[-1] in m.KEEP for event in self.events))

    def test_moved_queue_prevents_native_stop(self):
        with patch.object(m, 'queue', side_effect=RuntimeError('QUEUE_MOVED')):
            with self.assertRaisesRegex(RuntimeError, 'QUEUE_MOVED'): self.restore()
        self.assertEqual(self.events, [])

    def test_cas_native_selection_cannot_overwrite_a_later_writer(self):
        foreign = self.root/'foreign'; foreign.mkdir()
        self.current.unlink(); self.current.symlink_to(foreign)
        with self.assertRaises(RuntimeError):
            m.select(self.h, self.current, self.base, self.owned)
        self.assertEqual(self.current.resolve(), foreign)

    def run_apply(self, fail_web=False, move_selector=False, fail_web_after_select=False):
        self.current.unlink(); self.current.symlink_to(self.base)
        self.versions.write_bytes(b'old-versions')
        self.plan['native_selector'] = self.h.path_state(self.current)
        webroot = self.root/'web'
        def prepare():
            if fail_web: raise RuntimeError('WEB_PREPARE_FAILED')
            (webroot/'PLAN.json').write_text('{}')
        def apply(expected, on_restore=None):
            self.web.unlink(); self.web.symlink_to(self.webapp)
            if fail_web_after_select:
                restored = m.select(self.h, self.web, self.webbase, self.h.path_state(self.web))
                on_restore(restored)
                raise RuntimeError('WEB_HEALTH_FAILED')
            if move_selector:
                foreign = self.root/'foreign'; foreign.mkdir()
                self.current.unlink(); self.current.symlink_to(foreign)
        web = types.SimpleNamespace(ROOT=webroot, APP=self.webapp, prepare=prepare, apply=apply,
            secure=lambda path: m.need(path.is_dir() and not path.is_symlink(), 'UNTRUSTED_DIRECTORY'))
        with patch.object(m, 'checked', return_value=(self.plan, object(), self.h, self.pair)), \
             patch.object(m, 'module', return_value=web), \
             patch.object(m, 'metadata_read', return_value={'count': 88}):
            return m.apply('synthetic-plan', object())

    def test_web_symlink_is_rejected_before_native_transition(self):
        foreign = self.root/'foreign'; foreign.mkdir()
        root = self.root/'web'; root.symlink_to(foreign)
        web = types.SimpleNamespace(ROOT=root, secure=lambda path: None)
        with self.assertRaisesRegex(RuntimeError, 'WEB_STATE_EXISTS'): m.make_web_directory(web)
        self.assertEqual(self.events, [])
        self.assertFalse((foreign/'PLAN.json').exists())

    def test_existing_real_web_directory_is_not_adopted(self):
        root = self.root/'web'; root.mkdir()
        web = types.SimpleNamespace(ROOT=root, secure=lambda path: None)
        with self.assertRaisesRegex(RuntimeError, 'WEB_STATE_EXISTS'): m.make_web_directory(web)
        self.assertEqual(self.events, [])

    def test_replaced_web_directory_is_rejected_before_prepare(self):
        root = self.root/'web'
        web = types.SimpleNamespace(ROOT=root, secure=lambda path: m.need(not path.is_symlink(), 'UNTRUSTED_DIRECTORY'))
        stamp = m.make_web_directory(web)
        root.rename(self.root/'old-owned-web'); root.mkdir()
        with self.assertRaisesRegex(RuntimeError, 'WEB_DIRECTORY_MOVED'): m.same_web_directory(web, stamp)

    def test_checked_native_tree_rejects_unmanifested_code(self):
        (self.app/'ok.py').write_bytes(b'pass')
        (self.app/'stray.py').write_bytes(b'not admitted')
        (self.app/'manifest.json').write_text('{}')
        self.plan.update(source=m.SOURCE, installer_sha='installer', web_installer_sha=m.WEB_SHA,
            web_selector=self.h.path_state(self.web), native_manifest=m.CANDIDATE_PIN,
            changing_pids={unit: {key: self.h.prop(unit,key) for key in ['MainPID','InvocationID']}
                           for unit in [m.UNIT,m.CHECKER,m.WEB]},
            versions_sha=m.digest(b'new-versions'))
        self.plan['native_selector'] = self.h.path_state(self.current)
        (self.root/'PLAN.json').write_text(json.dumps(self.plan))
        self.h.manifest = lambda root: {'files': {'ok.py': m.digest(b'pass')}}
        self.h.exact_tree = self.real_tree
        self.h.reserve = lambda: None
        utility = types.SimpleNamespace(secure=lambda root: None)
        real_sha = m.sha
        def pinned(path):
            path = Path(path)
            if path == self.root/'PLAN.json': return 'plan'
            if path == Path(m.__file__): return 'installer'
            if path == m.WEB_DRIVER: return m.WEB_SHA
            if path == self.app/'manifest.json': return m.CANDIDATE_PIN
            return real_sha(path)
        with patch.object(m,'helpers',return_value=(utility,self.h,self.pair)), patch.object(m,'sha',side_effect=pinned):
            with self.assertRaises(RuntimeError): m.checked('plan')
        self.assertEqual(self.events, [])

    def test_web_preparation_failure_restores_native_without_replaying_work(self):
        with self.assertRaisesRegex(RuntimeError, 'WEB_PREPARE_FAILED'):
            self.run_apply(fail_web=True)
        self.assertEqual(self.current.resolve(), self.base)
        self.assertEqual(self.web.resolve(), self.webbase)
        self.assertTrue((self.root/'ROLLED_BACK.json').exists())
        self.assertFalse((self.root/'APPLIED.json').exists())

    def test_web_owned_rollback_identity_allows_native_rollback(self):
        before = self.h.path_state(self.web)
        with self.assertRaisesRegex(RuntimeError, 'WEB_HEALTH_FAILED'):
            self.run_apply(fail_web_after_select=True)
        self.assertEqual(self.current.resolve(), self.base)
        self.assertEqual(self.web.resolve(), self.webbase)
        self.assertNotEqual(self.h.path_state(self.web), before)
        self.assertTrue((self.root/'ROLLED_BACK.json').exists())

    def test_setup_backup_failure_never_stops_or_restarts_services(self):
        original_atomic = self.h.atomic
        def fail_backup(path, raw, mode=0o600):
            if Path(path).name == 'rollback-projection.json':
                raise OSError('SETUP_WRITE_FAILED')
            original_atomic(path, raw, mode)
        with patch.object(self.h, 'atomic', side_effect=fail_backup):
            with self.assertRaisesRegex(OSError, 'SETUP_WRITE_FAILED'):
                self.run_apply()
        self.assertEqual(self.events, [])
        self.assertEqual(self.current.resolve(), self.base)
        result = json.loads((self.root/'SETUP_FAILED.json').read_text())
        self.assertEqual(result['status'], 'SETUP_FAILED_NO_SERVICE_TRANSITION')
        self.assertFalse((self.root/'ROLLED_BACK.json').exists())

    def test_success_keeps_new_native_and_web_and_records_outcome(self):
        self.run_apply()
        self.assertEqual(self.current.resolve(), self.app)
        self.assertEqual(self.web.resolve(), self.webapp)
        value = json.loads((self.root/'APPLIED.json').read_text())
        self.assertTrue(value['protected_six_unchanged'])
        self.assertEqual(value['status'], 'INSTALLED_TECHNICAL_PASS')

    def test_late_foreign_native_selector_is_never_rolled_back_blindly(self):
        with self.assertRaisesRegex(RuntimeError, 'ROLLBACK_REQUIRES_REVIEW'):
            self.run_apply(move_selector=True)
        self.assertEqual(self.current.resolve().name, 'foreign')
        self.assertTrue((self.root/'ROLLBACK_BLOCKED.json').exists())
        self.assertEqual(sum(event == ('systemctl', 'stop', m.UNIT) for event in self.events), 1)


if __name__ == '__main__':
    unittest.main()
