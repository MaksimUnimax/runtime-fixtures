"""Fault injection for code-only rollout. No real systemd, DB or /etc access."""
import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import activate_install as deploy

class InstallationSafety(unittest.TestCase):
    def check_failure(self, drift=False, fail_rollback=False, late_job=False):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);calls=[];created=[]
            receipt={'config_sha256':'config','source_hashes':{'runtime/engine.py':'source'},'source_commit':'fixture','old_pin':'old','new_pin':'new'}
            (root/'PREPARED_R8.json').write_text(json.dumps(receipt))
            def digest(path):return 'config' if str(path).startswith('/etc/')else ('drift' if drift else 'source')
            def override(unit,text):
                p=root/(unit+'.conf');p.write_text(text);created.append(p);return p
            failed=False
            def command(*args):
                nonlocal failed
                calls.append(args)
                if args==('systemctl','restart','alice-market.service') and not late_job and (not failed or fail_rollback):
                    failed=True;raise RuntimeError('injected')
            def show(unit,prop):
                if prop=='ActiveState':return 'active'
                return str(deploy.BASE if unit=='alice-market.service'else deploy.STATION)
            # Unit fixtures validate rollback, not filesystem package assembly.
            original_path_read=Path.read_text
            def read_text(path,*args,**kwargs):
                if str(path).endswith('/manifest.json'):return '{"files":{}}'
                if path==deploy.CONFIG:return json.dumps({'read_surface':{'pin':'old'if late_job else'new'}})
                return original_path_read(path,*args,**kwargs)
            connection=MagicMock();connection.__enter__.return_value.execute.return_value.fetchone.return_value=(0,)
            if late_job:connection.__enter__.return_value.execute.return_value.fetchone.side_effect=[(0,),(1,)]
            with patch.object(Path,'read_text',read_text),patch.object(deploy,'ROOT',root),patch.object(deploy,'set_pin',return_value='config')as pins,patch.object(deploy,'digest',side_effect=digest),patch.object(deploy,'override',side_effect=override),patch.object(deploy,'show',side_effect=show),patch.object(deploy,'command',side_effect=command),patch.object(deploy.sqlite3,'connect',return_value=connection):
                with self.assertRaises((AssertionError,RuntimeError)):deploy.main()
            if late_job:pins.assert_not_called()
            if drift:
                self.assertEqual(created,[]);self.assertEqual(calls,[])
            else:
                self.assertIn(('systemctl','restart','alisa-station.service'),calls)
                record=json.loads((root/'ROLLED_BACK_R8.json').read_text())
                self.assertEqual(record['state'],'ROLLBACK_FAILED' if fail_rollback else 'ROLLED_BACK')
                self.assertFalse(created[0].exists());self.assertFalse(created[1].exists())
                self.assertTrue(created[2].exists())

    def test_new_job_after_first_gate_resumes_old_base_without_pin_change(self):self.check_failure(late_job=True)
    def test_drift_is_rejected_before_any_override_or_restart(self):self.check_failure(drift=True)
    def test_both_services_restore_after_activation_failure(self):self.check_failure()
    def test_failed_market_rollback_still_attempts_station_and_records_failure(self):self.check_failure(fail_rollback=True)

    def test_pin_is_visible_after_post_replace_fsync_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'config.json';path.write_text('{"read_surface":{"pin":"old"},"other":7}')
            import os
            original=os.fsync;seen=[]
            def fail_directory(fd):
                seen.append(fd)
                if len(seen)==2:raise OSError('injected_directory_fsync')
                original(fd)
            with patch.object(deploy,'CONFIG',path):
                with patch('os.fsync',side_effect=fail_directory):
                    with self.assertRaises(OSError):deploy.set_pin('old','new')
                self.assertEqual(json.loads(path.read_text())['read_surface']['pin'],'new')
                deploy.set_pin('new','old')
                self.assertEqual(json.loads(path.read_text()),{'read_surface':{'pin':'old'},'other':7})

    def test_policy_switch_preserves_other_fields_and_rejects_stale_pin(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'config.json'
            original={'read_surface':{'pin':'old','enabled':True,'max_model_steps':None},'bindings':{'store':'unchanged'}}
            path.write_text(json.dumps(original));path.chmod(0o640)
            with patch.object(deploy,'CONFIG',path):
                deploy.set_pin('old','new')
                expected=json.loads(json.dumps(original));expected['read_surface']['pin']='new'
                self.assertEqual(json.loads(path.read_text()),expected)
                with self.assertRaises(AssertionError):deploy.set_pin('old','unwanted')
                self.assertEqual(json.loads(path.read_text()),expected)
                deploy.set_pin('new','old')
                self.assertEqual(json.loads(path.read_text()),original)
            self.assertEqual(path.stat().st_mode&0o777,0o640)
            self.assertEqual(list(Path(directory).glob('.model-usage-policy-*')),[])

if __name__=='__main__':unittest.main()
