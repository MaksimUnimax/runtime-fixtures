"""Fault injection for code-only rollout. No real systemd, DB or /etc access."""
import json, tempfile, unittest
from pathlib import Path
from unittest.mock import patch, MagicMock
import activate_install as deploy

class InstallationSafety(unittest.TestCase):
    def check_failure(self, drift=False, fail_rollback=False):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);calls=[];created=[]
            receipt={'config_sha256':'config','source_hashes':{'runtime/engine.py':'source'},'source_commit':'fixture'}
            (root/'PREPARED_R4.json').write_text(json.dumps(receipt))
            def digest(path):return 'config' if str(path).startswith('/etc/')else ('drift' if drift else 'source')
            def override(unit,text):
                p=root/(unit+'.conf');p.write_text(text);created.append(p);return p
            failed=False
            def command(*args):
                nonlocal failed
                calls.append(args)
                if args==('systemctl','restart','alice-market.service') and (not failed or fail_rollback):
                    failed=True;raise RuntimeError('injected')
            def show(unit,prop):
                if prop=='ActiveState':return 'active'
                return str(deploy.BASE if unit=='alice-market.service'else deploy.STATION)
            # Unit fixtures validate rollback, not filesystem package assembly.
            original_path_read=Path.read_text
            def read_text(path,*args,**kwargs):
                if str(path).endswith('/manifest.json'):return '{"files":{}}'
                return original_path_read(path,*args,**kwargs)
            connection=MagicMock();connection.__enter__.return_value.execute.return_value.fetchone.return_value=(0,)
            with patch.object(Path,'read_text',read_text),patch.object(deploy,'ROOT',root),patch.object(deploy,'digest',side_effect=digest),patch.object(deploy,'override',side_effect=override),patch.object(deploy,'show',side_effect=show),patch.object(deploy,'command',side_effect=command),patch.object(deploy.sqlite3,'connect',return_value=connection):
                with self.assertRaises((AssertionError,RuntimeError)):deploy.main()
            if drift:
                self.assertEqual(created,[]);self.assertEqual(calls,[])
            else:
                self.assertIn(('systemctl','restart','alisa-station.service'),calls)
                record=json.loads((root/'ROLLED_BACK_R4.json').read_text())
                self.assertEqual(record['state'],'ROLLBACK_FAILED' if fail_rollback else 'ROLLED_BACK')
                self.assertFalse(created[0].exists());self.assertFalse(created[1].exists())
                self.assertTrue(created[2].exists())

    def test_drift_is_rejected_before_any_override_or_restart(self):self.check_failure(drift=True)
    def test_both_services_restore_after_activation_failure(self):self.check_failure()
    def test_failed_market_rollback_still_attempts_station_and_records_failure(self):self.check_failure(fail_rollback=True)

if __name__=='__main__':unittest.main()
