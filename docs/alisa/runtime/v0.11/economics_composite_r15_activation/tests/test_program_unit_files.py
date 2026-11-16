"""Actual temporary-file switch/rollback, no live paths or systemd actions."""
from pathlib import Path
from unittest.mock import patch
import os
import fcntl
import stat
import subprocess
from contextlib import contextmanager
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
import activate as a


class ProgramUnitFiles(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='r15-program-files-', dir=Path.home())
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.units = self.root/'units'; self.units.mkdir()
        self.candidates = self.root/'candidates'; self.candidates.mkdir()
        self.attempt = self.root/'attempt'
        self.old = {}; self.new = {}; self.fenced = True; self.fence_reads = 0
        for name in a.ProgramPairUnitTransaction.BEFORE:
            self.old[name] = ('[Service]\nExecStart=/fixture/old/'+name+'\n').encode()
            self.new[name] = ('[Service]\nExecStart=/fixture/new/'+name+'\n').encode()
            (self.units/name).write_bytes(self.old[name]); (self.units/name).chmod(0o644)
            (self.candidates/name).write_bytes(self.new[name]); (self.candidates/name).chmod(0o444)
        contexts = [patch.object(a, 'OWNER_UID', os.getuid()),
                    patch.object(a.ProgramPairUnitTransaction, 'UNIT_ROOT', self.units),
                    patch.object(a.ProgramPairUnitTransaction, 'BEFORE', {n:a.c.digest(v) for n,v in self.old.items()}),
                    patch.object(a.program_pair, 'UNIT_FILES', {n:a.c.digest(v) for n,v in self.new.items()})]
        for context in contexts:
            context.start(); self.addCleanup(context.stop)

        lockroot = self.root/'locks'; lockroot.mkdir()
        self.stage_lock = lockroot/'alisa-stage-rollout.lock'
        self.program_lock = lockroot/'alisa-program.lock'
        self.stage_lock.write_bytes(b''); self.program_lock.write_bytes(b'')
        @contextmanager
        def actual_fixture_stage_lock():
            with self.stage_lock.open('r+b') as stream:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                yield stream
        def fixture_lock_state(info):
            a.c.need(stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
                     and info.st_nlink == 1 and not info.st_mode & 0o022, 'UNTRUSTED_LOCK')
            return a._lock_identity(info)
        for context in [patch.object(a.c, 'LOCK', self.stage_lock),
                        patch.object(a, 'lock', actual_fixture_stage_lock),
                        patch.object(a, '_lock_parent_state', lambda: a._lock_identity(lockroot.lstat())),
                        patch.object(a, '_lock_file_state', fixture_lock_state),
                        patch.object(a.ProgramPairExclusion, 'PROGRAM_LOCK', self.program_lock)]:
            context.start(); self.addCleanup(context.stop)
        self.exclusion = a.ProgramPairExclusion()
        self.exclusion.__enter__()
        self.addCleanup(self.exclusion.__exit__, None, None, None)

    def fence(self):
        self.fence_reads += 1
        a.c.need(self.fenced, 'TEST_ADMISSION_FENCE_LOST')

    def transaction(self):
        return a.ProgramPairUnitTransaction(self.attempt, self.candidates, self.fence, self.exclusion)

    def contents(self):
        return {n:(self.units/n).read_bytes() for n in self.old}

    def test_real_atomic_switch_and_cas_rollback_preserve_exact_bytes(self):
        t = self.transaction(); t.backup()
        self.assertEqual(self.contents(), self.old)
        t.switch(); self.assertEqual(self.contents(), self.new)
        self.assertTrue(t.restore()); self.assertEqual(self.contents(), self.old)
        self.assertGreaterEqual(self.fence_reads, 7)
        for name in self.old:
            self.assertEqual((self.attempt/(name+'.before')).read_bytes(), self.old[name])
        self.assertTrue((self.attempt/'RESTORE_RESULT.json').is_file())

    def test_switch_without_backup_cannot_write_a_unit(self):
        t=self.transaction()
        with self.assertRaises(a.c.Blocked):t.switch()
        self.assertEqual(self.contents(), self.old)

    def test_unknown_source_unit_refused_before_attempt_creation(self):
        name=next(iter(self.old)); (self.units/name).write_bytes(b'foreign')
        with self.assertRaises(a.c.Blocked):self.transaction()
        self.assertFalse(self.attempt.exists())
        self.assertEqual((self.units/name).read_bytes(), b'foreign')

    def test_unqualified_candidate_refused_before_attempt_creation(self):
        name=next(iter(self.new)); (self.candidates/name).chmod(0o644)
        (self.candidates/name).write_bytes(b'foreign')
        with self.assertRaises(a.c.Blocked):self.transaction()
        self.assertFalse(self.attempt.exists()); self.assertEqual(self.contents(), self.old)

    def test_existing_attempt_is_not_reused_after_unknown_outcome(self):
        t=self.transaction();t.backup()
        with self.assertRaises(a.c.Blocked):self.transaction()
        with self.assertRaises(a.c.Blocked):t.backup()
        self.assertEqual(self.contents(),self.old)

    def test_lost_fence_prevents_first_write_and_any_rollback(self):
        t=self.transaction();t.backup();self.fenced=False
        with self.assertRaises(a.c.Blocked):t.switch()
        self.assertEqual(self.contents(),self.old)
        # A changed owned component cannot be restored after fence loss.
        self.fenced=True;t.switch();self.fenced=False
        self.assertFalse(t.restore());self.assertEqual(self.contents(),self.new)

    def test_foreign_writer_before_switch_is_not_overwritten(self):
        t=self.transaction();t.backup();name=next(iter(self.old))
        (self.units/name).write_bytes(b'foreign-writer')
        with self.assertRaises(a.c.Blocked):t.switch()
        self.assertEqual((self.units/name).read_bytes(),b'foreign-writer')

    def test_foreign_writer_after_switch_is_kept_and_other_unit_restored(self):
        t=self.transaction();t.backup();t.switch();first,second=list(self.old)
        (self.units/first).write_bytes(b'later-writer')
        self.assertFalse(t.restore())
        self.assertEqual((self.units/first).read_bytes(),b'later-writer')
        self.assertEqual((self.units/second).read_bytes(),self.old[second])

    def test_same_bytes_from_a_different_writer_are_not_our_inode(self):
        t=self.transaction();t.backup();t.switch();name=next(iter(self.old))
        replacement=self.root/'replacement';replacement.write_bytes(self.new[name]);replacement.chmod(0o644)
        os.replace(replacement,self.units/name)
        self.assertFalse(t.restore())
        self.assertEqual((self.units/name).read_bytes(),self.new[name])

    def test_post_rename_fsync_failure_restores_retained_original_inode(self):
        t=self.transaction();t.backup();name=next(iter(self.old));path=self.units/name
        original_state=a.path_state(path);real=a.noreplace;fired=[]
        def fail_after_publish(source,target):
            real(source,target)
            if target==path and '.r15-new-' in source.name and not fired:
                fired.append(True);raise OSError('injected directory fsync failure')
        with patch.object(a,'noreplace',side_effect=fail_after_publish):
            with self.assertRaises(OSError):t.switch()
        self.assertTrue(fired)
        self.assertTrue(t.restore())
        self.assertEqual(a.path_state(path),original_state)
        self.assertEqual(self.contents(),self.old)

    def test_checkpoint_failure_before_publish_leaves_original_unit(self):
        t=self.transaction();t.backup()
        with patch.object(t,'checkpoint',side_effect=OSError('injected receipt failure')):
            with self.assertRaises(OSError):t.switch()
        self.assertEqual(self.contents(),self.old)
        self.assertTrue(t.restore());self.assertEqual(self.contents(),self.old)

    def test_restore_receipt_failure_does_not_stop_independent_file_restoration(self):
        t=self.transaction();t.backup();t.switch()
        with patch.object(t,'checkpoint',side_effect=OSError('injected receipt failure')):
            self.assertFalse(t.restore())
        self.assertEqual(self.contents(),self.old)


    def test_second_process_cannot_enter_shared_deployment_or_program_lock(self):
        code = ('import os,fcntl,sys;f=open(sys.argv[1],"r+b");'
                '\ntry:fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)'
                '\nexcept BlockingIOError:sys.exit(0)'
                '\nsys.exit(9)')
        for path in (self.stage_lock, self.program_lock):
            r = subprocess.run([sys.executable, '-I', '-B', '-c', code, str(path)],
                               capture_output=True, timeout=5)
            self.assertEqual(r.returncode, 0)

    def test_explicit_unlock_is_detected_without_silent_reacquisition(self):
        t=self.transaction();t.backup()
        fcntl.flock(self.exclusion._program_fd, fcntl.LOCK_UN)
        with self.assertRaises(a.c.Blocked) as err:t.switch()
        self.assertEqual(err.exception.code, 'PROGRAM_EXCLUSION_NOT_HELD')
        self.assertEqual(self.contents(), self.old)

    def test_replaced_lock_inode_is_refused_before_unit_mutation(self):
        t=self.transaction();t.backup()
        replacement=self.root/'new-lock';replacement.write_bytes(b'')
        os.replace(replacement,self.program_lock)
        self.assertEqual(os.fstat(self.exclusion._program_fd).st_nlink, 0)
        with self.assertRaises(a.c.Blocked) as err:t.switch()
        # The original held inode is now unlinked, so the stricter existing
        # nlink guard rejects it before the public-path identity comparison.
        self.assertEqual(err.exception.code, 'UNTRUSTED_LOCK')
        self.assertEqual(self.contents(),self.old)

    def test_closed_exclusion_is_not_accepted_or_reentered(self):
        self.exclusion.__exit__(None,None,None)
        with self.assertRaises(a.c.Blocked):self.transaction()
        with self.assertRaises(a.c.Blocked):self.exclusion.__enter__()


    def test_existing_transaction_cannot_backup_or_write_after_context_exit(self):
        transaction = self.transaction()
        self.exclusion.__exit__(None,None,None)
        for method in (transaction.backup, transaction.switch, transaction.restore):
            with self.assertRaises(a.c.Blocked) as err:method()
            self.assertEqual(err.exception.code, 'PROGRAM_EXCLUSION_NOT_HELD')
        self.assertFalse(self.attempt.exists())
        self.assertEqual(self.contents(),self.old)

    def test_fence_callback_cannot_release_locks_during_switch(self):
        transaction = self.transaction();transaction.backup()
        transaction.require_fence = lambda: self.exclusion.__exit__(None,None,None)
        with self.assertRaises(a.c.Blocked) as err:transaction.switch()
        self.assertEqual(err.exception.code, 'PROGRAM_EXCLUSION_IN_USE')
        self.exclusion.require()
        self.assertEqual(self.contents(),self.old)

    def test_other_thread_cannot_close_exclusion_mid_operation(self):
        import threading
        entered, closed = threading.Event(), threading.Event()
        errors = []
        def close():
            entered.set()
            try:self.exclusion.__exit__(None,None,None)
            except BaseException as error:errors.append(type(error).__name__)
            finally:closed.set()
        with self.exclusion.operation():
            thread=threading.Thread(target=close);thread.start()
            self.assertTrue(entered.wait(1))
            self.assertFalse(closed.wait(0.05))
            self.exclusion.require()
        thread.join(2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(errors, [])
        self.assertTrue(closed.is_set())
        with self.assertRaises(a.c.Blocked):self.exclusion.require()


if __name__ == '__main__':
    unittest.main(verbosity=2)
