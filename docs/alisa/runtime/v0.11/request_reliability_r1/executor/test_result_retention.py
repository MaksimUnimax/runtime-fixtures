import json,os,tempfile,time,unittest
from pathlib import Path
from unittest.mock import patch
from program_results import Results,TTL

class Retention(unittest.TestCase):
    def test_long_started_marker_survives_until_completed(self):
        with tempfile.TemporaryDirectory()as temp:
            r=Results(temp);key='a'*64
            with patch('program_results.time.time',return_value=100.):r.start(key,'binding','b'*32)
            with patch('program_results.time.time',return_value=100.+2*TTL):
                self.assertEqual(r.read(key,'binding')['state'],'started')
                result=r.complete(key,'binding','result after a long session')
                self.assertEqual(r.read(key,'binding')['content'],result['content'])
    def test_sweep_preserves_active_and_recoverable_workspaces_only(self):
        with tempfile.TemporaryDirectory()as temp:
            r=Results(temp)
            for i in (1,2,3):
                key=str(i)*64;r.start(key,'binding',str(i)*32);os.utime(r.path(key),(1,1))
            r.sweep(keep_started=lambda name:name in ('1'*32,'2'*32))
            self.assertEqual(sorted(p.stem for p in Path(temp).glob('*.json')),['1'*64,'2'*64])
    def test_sweep_removes_only_expired_pending_writes(self):
        with tempfile.TemporaryDirectory()as temp:
            r=Results(temp);old=Path(temp)/'.pending-old';fresh=Path(temp)/'.pending-fresh'
            old.write_text('old');fresh.write_text('fresh');os.utime(old,(1,1))
            r.sweep();self.assertFalse(old.exists());self.assertTrue(fresh.exists())
if __name__=='__main__':unittest.main()

class SweepSerialization(unittest.TestCase):
    def test_busy_executor_skips_cleanup(self):
        import program_broker
        with tempfile.TemporaryFile()as lock,patch('builtins.open',return_value=lock),patch('program_broker.fcntl.flock',side_effect=BlockingIOError),patch('program_broker._sweep_locked')as sweep:
            program_broker.sweep();sweep.assert_not_called()
