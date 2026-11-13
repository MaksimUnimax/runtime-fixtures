"""Offline failure checks for the finite rollout; no service, DB or network IO."""
import hashlib
import hmac
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('enrollment_install',Path(__file__).with_name('install_runtime_store_enrollment_20261113.py'))
install=importlib.util.module_from_spec(spec);spec.loader.exec_module(install)


class RolloutChecks(unittest.TestCase):
    def test_atomic_patch_preserves_shared_rollback_inode(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);base=root/'base';base.write_bytes(b'base')
            candidate=root/'candidate';os.link(base,candidate)
            install.atomic(candidate,b'new',0o640)
            self.assertEqual(base.read_bytes(),b'base');self.assertEqual(candidate.read_bytes(),b'new')
            self.assertNotEqual(base.stat().st_ino,candidate.stat().st_ino)

    def test_atomic_does_not_overwrite_unexpected_temp_file(self):
        with tempfile.TemporaryDirectory()as folder:
            path=Path(folder)/'config';path.write_bytes(b'keep')
            (path.parent/'.config.enrollment-new').write_bytes(b'foreign')
            with self.assertRaisesRegex(RuntimeError,'TEMP_EXISTS'):install.atomic(path,b'new')
            self.assertEqual(path.read_bytes(),b'keep')

    def test_projection_changed_pair_is_not_signed(self):
        def mac(key,domain,value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
        old={'pid':100,'uid':996};new={'pid':101,'uid':996}
        context=lambda config,material,row,**kw:{'material':material,'generation':kw['generation']}
        original={'native_generation':old,'mac_key':'00'*32,'environment':'stage','product_id':'alisa_market',
            'bindings':[{'credential_name':'ozon','source_hmac':mac(None,None,{'material':'old','generation':old})}]}
        module=SimpleNamespace(process_generation=lambda pid:new,root_json=lambda path,limit:'config'if str(path).endswith('market-runtime.json')else'changed',
            native_context=context,mac=mac,hmac=hmac)
        with patch.object(install,'native_module',return_value=module),patch.object(install,'prop',return_value='101'),\
                patch.object(install,'atomic')as write,patch.object(install,'run')as command:
            with self.assertRaisesRegex(RuntimeError,'OWNER_PAIR_CHANGED_DURING_RESTART'):install.refresh_projection(original)
            write.assert_not_called();command.assert_not_called()

    def test_projection_refresh_preserves_original_and_restarts_checker(self):
        def mac(key,domain,value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
        old={'pid':100,'uid':996};new={'pid':101,'uid':996}
        original={'native_generation':old,'mac_key':'00'*32,'environment':'stage','product_id':'alisa_market',
            'bindings':[{'credential_name':'ozon','source_hmac':mac(None,None,{'material':'same','generation':old})}]}
        module=SimpleNamespace(process_generation=lambda pid:new,root_json=lambda path,limit:'config'if str(path).endswith('market-runtime.json')else'same',
            native_context=lambda config,material,row,**kw:{'material':material,'generation':kw['generation']},mac=mac,hmac=hmac)
        with tempfile.TemporaryDirectory()as folder:
            projection=Path(folder)/'scope.json';projection.write_text(json.dumps(original));before=projection.read_bytes()
            with patch.object(install,'PROJECTION',projection),patch.object(install,'native_module',return_value=module),\
                    patch.object(install,'prop',return_value='101'),patch.object(install,'run')as command:
                install.refresh_projection(original)
                command.assert_called_once_with('systemctl','restart',install.CHECK_UNIT)
            self.assertEqual(original['native_generation'],old)
            self.assertNotEqual(projection.read_bytes(),before)
            self.assertEqual(json.loads(projection.read_text())['native_generation'],new)

    def test_projection_ownership_is_recorded_before_failing_checker_restart(self):
        old={'pid':100,'uid':996};new={'pid':101,'uid':996}
        original={'native_generation':old,'mac_key':'00'*32,'environment':'stage',
            'product_id':'alisa_market','bindings':[]}
        module=SimpleNamespace(process_generation=lambda pid:new,root_json=lambda path,limit:{})
        captured=[]
        with tempfile.TemporaryDirectory()as folder:
            path=Path(folder)/'scope.json';path.write_text('{}')
            with patch.object(install,'PROJECTION',path),patch.object(install,'native_module',return_value=module),\
                    patch.object(install,'prop',return_value='101'),patch.object(install,'run',side_effect=RuntimeError('checker failed')):
                with self.assertRaisesRegex(RuntimeError,'checker failed'):
                    install.refresh_projection(original,on_write=captured.append)
            self.assertEqual(captured,[path.read_bytes()])

    def test_recovery_attempts_second_backend_after_first_restart_failure(self):
        calls=[]
        def command(*args,**kwargs):
            calls.append(args)
            if args==('systemctl','restart',install.PLATFORM_UNITS[0]):raise RuntimeError('first failed')
        old={p:b'old'for p in install.SELECTORS+[install.LINK_ENV,install.VERSIONS]}
        saved={str(p):{'mode':0o600}for p in old}
        with patch.object(install,'atomic'),patch.object(install,'symlink'),patch.object(install,'sync'),\
                patch.object(install,'refresh_projection',side_effect=RuntimeError('checker failed')),\
                patch.object(install,'run',side_effect=command),patch.object(install,'record')as report:
            failures=install.recover(old,saved,{},None)
        self.assertIn(('systemctl','restart',install.PLATFORM_UNITS[1]),calls)
        self.assertIn(install.PLATFORM_UNITS[0],failures)
        self.assertIn('owner_pair_and_checker',failures)
        self.assertEqual(report.call_args.args[1]['status'],'ROLLBACK_NEEDS_ATTENTION')

    def test_sync_reuses_existing_lock_descriptor(self):
        lock=SimpleNamespace(fileno=lambda:7)
        with patch.object(install,'run',return_value='{"status":"UPDATED"}')as command:
            install.sync(Path('/candidate'),lock)
        self.assertEqual(command.call_args.kwargs,{'pass_fds':(7,)})
        self.assertEqual(command.call_args.args[-2:],('--lock-fd','7'))

    def test_symlink_switch_keeps_old_release(self):
        with tempfile.TemporaryDirectory()as folder:
            root=Path(folder);old=root/'old';old.mkdir();new=root/'new';new.mkdir()
            current=root/'current';current.symlink_to(old.name)
            with patch.object(install,'CURRENT',current):install.symlink(new)
            self.assertEqual(current.resolve(),new);self.assertTrue(old.is_dir())


if __name__=='__main__':unittest.main()
