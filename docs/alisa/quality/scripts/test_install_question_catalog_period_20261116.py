import ast
import ctypes
import errno
import hashlib
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('install_question_catalog_period_20261116.py')
tree = ast.parse(SOURCE.read_text())
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in {'select','apply','need','baseline_tree'}]

class RolloutBoundaries(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.stage = Path(self.temp.name)
        self.base, self.app = self.stage/'base', self.stage/'candidate'
        self.base.mkdir(); self.app.mkdir()
        self.web = self.stage/'web-current'; self.web.symlink_to(self.base)
        self.records, self.calls = {}, []
        self.protected = {'identity':'same', 'native':'same', 'publisher':'same'}
        self.actual = dict(self.protected)
        self.fail_health = False
        def ready(rollback):
            if not rollback and self.fail_health:
                raise RuntimeError('WEB_NOT_READY')
        primitive_source=Path(__file__).with_name('install_customer_catalog_20261115.py')
        primitive_tree=ast.parse(primitive_source.read_text())
        primitive_names={'need','sha','path_state','rename_no_replace','replace_selection','exact_tree','run'}
        def command(args,**kwargs):
            self.assertTrue(all(isinstance(x,str) for x in args), 'helper.run requires varargs')
            self.calls.append(tuple(args))
            return types.SimpleNamespace(returncode=0,stdout='')
        pg={'subprocess':types.SimpleNamespace(run=command),'os':os,'ctypes':ctypes,'errno':errno,'hashlib':hashlib,'Path':Path}
        exec(compile(ast.Module(body=[n for n in primitive_tree.body if isinstance(n,ast.FunctionDef) and n.name in primitive_names],type_ignores=[]),str(primitive_source),'exec'),pg)
        self.h = types.SimpleNamespace(
            path_state=pg['path_state'],replace_selection=pg['replace_selection'],exact_tree=pg['exact_tree'],
            WEB_LINK=self.web, PRESERVE=['native','identity'], run=pg['run'],
            ready_web=ready, active=lambda x:None, static=lambda x:{'same':True},
            reserve=lambda:None, prop=lambda *x:'42',
            record=lambda name,value:self.records.__setitem__(name,value))
        self.initial_selector=self.h.path_state(self.web)
        self.g = {'Path':Path,'os':os,'STAGE':self.stage,'BASE':self.base,'APP':self.app,'h':self.h,
                  'WEB':'web.service','SOURCE':'test','sha':lambda p:'digest',
                  'capture':lambda:dict(self.actual),
                  'read_plan':lambda expected:{'protected':self.protected,'web_static':{'same':True},'web_selector_state':list(self.initial_selector)}}
        exec(compile(ast.Module(body=functions,type_ignores=[]), str(SOURCE),'exec'),self.g)

    def test_atomic_selector(self):
        self.g['select'](self.app,self.initial_selector)
        self.assertEqual(self.web.resolve(),self.app)
        self.assertFalse((self.stage/'.catalog-period-web-current').is_symlink())

    def test_failed_replace_cleans_only_owned_temp(self):
        with patch.object(self.h,'replace_selection',side_effect=OSError('injected')):
            with self.assertRaises(OSError):self.g['select'](self.app,self.initial_selector)
        self.assertEqual(self.web.resolve(),self.base)
        self.assertFalse((self.stage/'.catalog-period-web-current').is_symlink())

    def test_foreign_replacement_not_removed(self):
        def fail(path,src,expected,staged):
            src.unlink(); src.symlink_to(self.base)
            raise OSError('injected foreign replacement')
        with patch.object(self.h,'replace_selection',side_effect=fail):
            with self.assertRaises(OSError):self.g['select'](self.app,self.initial_selector)
        self.assertEqual(os.readlink(self.stage/'.catalog-period-web-current'),str(self.base))
        self.assertEqual(self.web.resolve(),self.base)

    def test_failed_health_rolls_back_without_false_success(self):
        self.fail_health=True
        with self.assertRaisesRegex(RuntimeError,'WEB_NOT_READY'):self.g['apply']('plan')
        self.assertEqual(self.web.resolve(),self.base)
        self.assertNotIn('APPLIED.json',self.records)
        self.assertEqual(self.records['FAILED.json']['web_rolled_back'],True)
        self.assertEqual(self.records['FAILED.json']['protected_unchanged'],True)

    def test_protected_change_records_incomplete_rollback(self):
        self.actual['identity']='changed'
        with self.assertRaisesRegex(RuntimeError,'ROLLBACK_INCOMPLETE'):self.g['apply']('plan')
        self.assertEqual(self.web.resolve(),self.base)
        self.assertNotIn('APPLIED.json',self.records)
        self.assertEqual(self.records['FAILED.json']['protected_unchanged'],False)


    def test_changed_live_selector_is_not_overwritten(self):
        primitive=self.h.replace_selection
        def concurrent(path,src,expected,staged):
            path.unlink(); path.symlink_to(self.stage/'foreign')
            return primitive(path,src,expected,staged)
        with patch.object(self.h,'replace_selection',side_effect=concurrent):
            with self.assertRaisesRegex(RuntimeError,'SELECTOR_CHANGED'):
                self.g['select'](self.app,self.initial_selector)
        self.assertEqual(os.readlink(self.web),str(self.stage/'foreign'))

    def test_changed_staged_selector_is_not_installed(self):
        primitive=self.h.replace_selection
        def concurrent(path,src,expected,staged):
            src.unlink(); src.symlink_to(self.stage/'foreign')
            return primitive(path,src,expected,staged)
        with patch.object(self.h,'replace_selection',side_effect=concurrent):
            with self.assertRaisesRegex(RuntimeError,'STAGED_SELECTOR_CHANGED'):
                self.g['select'](self.app,self.initial_selector)
        self.assertEqual(self.web.resolve(),self.base)
        self.assertEqual(os.readlink(self.stage/'.catalog-period-web-current'),str(self.stage/'foreign'))


    def runtime_cache_fixture(self, trusted=True):
        root=self.stage/'cache-base';root.mkdir()
        p=root/'services/platform/src/example/models.py';p.parent.mkdir(parents=True)
        p.write_text('pass\n')
        (root/'manifest.json').write_text('{}')
        (root/'.venv').symlink_to(self.base)
        cache=p.parent/'__pycache__';cache.mkdir()
        (cache/'models.cpython-312.pyc').write_bytes(b'compiled-cache')
        # Model root-owned installed cache metadata inside this disposable fixture.
        # The CI runner itself is non-root; production ownership validation stays intact.
        original_lstat = Path.lstat
        def cache_lstat(path, *args, **kwargs):
            st = original_lstat(path, *args, **kwargs)
            if path == cache or path.parent == cache:
                values = list(st)
                values[4] = values[5] = 0 if trusted else 1000
                return os.stat_result(values)
            return st
        self.enterContext(patch.object(Path, 'lstat', cache_lstat))
        return root, {'files':{'services/platform/src/example/models.py':'digest'}}, cache

    def test_known_runtime_cache_is_recognized_but_not_in_manifest(self):
        root,value,cache=self.runtime_cache_fixture()
        self.g['baseline_tree'](root,value)
        self.assertEqual(list(value['files']),['services/platform/src/example/models.py'])

    def test_unexpected_old_preparation_marker_is_rejected(self):
        root,value,cache=self.runtime_cache_fixture()
        (root/'.customer-catalog-preparation.json').write_text('{}')
        with self.assertRaisesRegex(RuntimeError,'UNDECLARED_RELEASE_ENTRY'):
            self.g['baseline_tree'](root,value)

    def test_nonroot_runtime_cache_is_rejected(self):
        root,value,cache=self.runtime_cache_fixture(trusted=False)
        with self.assertRaisesRegex(RuntimeError,'UNTRUSTED_RUNTIME_CACHE'):
            self.g['baseline_tree'](root,value)

    def test_unknown_runtime_cache_is_rejected(self):
        root,value,cache=self.runtime_cache_fixture()
        (cache/'unknown.cpython-312.pyc').write_bytes(b'unknown')
        with self.assertRaisesRegex(RuntimeError,'UNDECLARED_RELEASE_ENTRY'):
            self.g['baseline_tree'](root,value)


    def test_apply_calls_actual_helper_run_with_string_arguments(self):
        self.g['apply']('plan')
        self.assertEqual(self.calls,[('systemctl','restart','web.service')])
        self.assertIn('APPLIED.json',self.records)
        self.assertTrue(self.records['APPLIED.json']['protected_unchanged'])


class EffectiveReleaseBoundary(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.identity = self.base/'identity'; self.identity.mkdir()
        self.admin = self.base/'admin'; self.admin.mkdir()
        self.old_admin = self.base/'old-admin'; self.old_admin.mkdir()
        self.stale_alias = self.base/'admin-current'; self.stale_alias.symlink_to(self.old_admin)
        self.staff = self.admin/'policy.py'; self.staff.write_text('session=30')
        self.helper = self.base/'publisher.py'; self.helper.write_text('publisher')
        self.cwd = self.admin
        self.h = types.SimpleNamespace(
            protected=lambda:{'links':{'admin-current':str(self.stale_alias.resolve())}},
            prop=lambda unit,key:str(self.cwd) if key=='WorkingDirectory' else 'unchanged',
            PRESERVE=['admin.service'],IDENTITY_LINK=self.identity)
        self.g = {
            'Path':Path,'h':self.h,'HELPER':self.helper,
            'HELPER_SHA':hashlib.sha256(self.helper.read_bytes()).hexdigest(),
            'sha':lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest(),
            'EFFECTIVE_BASES':{'admin.service':self.admin},
            'STAFF_PINS':{self.staff:hashlib.sha256(self.staff.read_bytes()).hexdigest()}}
        defs=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in {'capture','need'}]
        exec(compile(ast.Module(body=defs,type_ignores=[]),str(SOURCE),'exec'),self.g)

    def test_effective_admin_is_pinned_despite_stale_alias(self):
        value=self.g['capture']()
        self.assertEqual(value['effective_bases']['admin.service'],str(self.admin))
        self.assertEqual(value['links']['admin-current'],str(self.old_admin))

    def test_wrong_effective_admin_is_rejected(self):
        self.cwd=self.old_admin
        with self.assertRaisesRegex(RuntimeError,'EFFECTIVE_RELEASE_CHANGED'):
            self.g['capture']()

    def test_staff_session_overlay_drift_is_rejected(self):
        self.staff.write_text('session=1')
        with self.assertRaisesRegex(RuntimeError,'STAFF_CHANGED'):
            self.g['capture']()

    def test_publisher_drift_is_rejected(self):
        self.helper.write_text('different')
        with self.assertRaisesRegex(RuntimeError,'PUBLISHER_CHANGED'):
            self.g['capture']()

if __name__=='__main__':
    unittest.main()
