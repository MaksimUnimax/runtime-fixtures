import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import frozen_python_check as check


class FrozenPythonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.state = {"status": "RUNNING", "task": "A_EXACT_CHECK_R1", "head": "a" * 40,
                      "resume_receipt": "owner-once", "checkpoint_status": "CURRENT", "checkpoint_id": "1" * 32}
        self.save()
        self.source = self.root / "helper.py"
        self.source.write_text('print("ORIGINAL")\n')
        self.bundle = self.root / "run1"
        self.expected = check.read_checkpoint(self.root, "A")[0]

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        (self.root / "A.json").write_text(json.dumps(self.state))

    def run_check(self, **kwargs):
        return check.run_check(self.root, "A", self.expected, self.source,
                               kwargs.pop("bundle", self.bundle), **kwargs)

    def test_exact_source_output_and_result_are_bound(self):
        self.source.write_text('import os, pathlib\nprint("ORIGINAL")\npathlib.Path(os.environ["OCTOPORT_EVIDENCE_DIR"], "result.json").write_text("{}")\n')
        result = self.run_check()
        self.assertEqual(result["execution_status"], "EXIT_ZERO")
        self.assertFalse(result["product_acceptance"])
        self.assertIn("result.json", result["files"])
        self.assertEqual(check.verify(self.bundle)["status"], "VERIFIED_BYTES")

    def test_late_original_overwrite_does_not_change_executed_source(self):
        real_run = subprocess.run
        def racing_run(*args, **kwargs):
            self.source.write_text('print("LATE_DIFFERENT_CHECK")\n')
            return real_run(*args, **kwargs)
        with patch.object(check.subprocess, "run", side_effect=racing_run):
            self.run_check()
        self.assertEqual((self.bundle / "stdout.log").read_text().strip(), "ORIGINAL")
        self.assertEqual((self.bundle / "source.py").read_text(), 'print("ORIGINAL")\n')
        self.assertEqual(check.verify(self.bundle)["status"], "VERIFIED_BYTES")

    def test_same_task_new_directory_cannot_repeat(self):
        self.run_check()
        with self.assertRaisesRegex(ValueError, "TASK_ALREADY_CLAIMED"):
            self.run_check(bundle=self.root / "another-dir")
        self.assertFalse((self.root / "another-dir").exists())

    def test_stop_waiting_and_changed_task_reject_before_execution(self):
        for field, value in [("status", "STOPPED"), ("status", "WAITING_INPUT"),
                             ("task", "DIFFERENT"), ("resume_receipt", "new-owner")]:
            old = self.state[field]
            self.state[field] = value
            self.save()
            with patch.object(check.subprocess, "run") as child:
                with self.assertRaisesRegex(ValueError, "CHECKPOINT_CHANGED"):
                    self.run_check()
                child.assert_not_called()
            self.state[field] = old
        self.assertFalse(self.bundle.exists())

    def test_volatile_status_timestamp_does_not_invalidate_same_task(self):
        self.state.update(updated_at="new polling time", review_pending=True)
        self.save()
        self.assertEqual(self.run_check()["execution_status"], "EXIT_ZERO")

    def test_broken_chunk_syntax_is_rejected_before_claim_or_execution(self):
        self.source.write_text('print("one")print("two")')
        with patch.object(check.subprocess, "run") as child:
            with self.assertRaises(SyntaxError):
                self.run_check()
            child.assert_not_called()
        self.assertFalse(self.bundle.exists())

    def test_existing_bundle_with_old_result_is_never_reused(self):
        self.bundle.mkdir()
        (self.bundle / "result.json").write_text('{"status":"PASS"}')
        with patch.object(check.subprocess, "run") as child:
            with self.assertRaises(FileExistsError):
                self.run_check()
            child.assert_not_called()

    def test_unknown_and_failure_outcome_are_not_success_or_replayable(self):
        self.source.write_text('raise SystemExit(9)')
        result = self.run_check()
        self.assertEqual(result["execution_status"], "EXIT_NONZERO")
        self.assertEqual(result["exit_code"], 9)
        with self.assertRaisesRegex(ValueError, "TASK_ALREADY_CLAIMED"):
            self.run_check(bundle=self.root / "retry")

    def test_timeout_has_durable_unknown_receipt(self):
        self.source.write_text('import time; time.sleep(3)')
        self.assertEqual(self.run_check(timeout=.05)["execution_status"], "TIMEOUT_NOT_REPLAYABLE")
        self.assertEqual(check.verify(self.bundle)["execution_status"], "TIMEOUT_NOT_REPLAYABLE")

    def test_modified_evidence_cannot_be_used_as_original_result(self):
        self.run_check()
        for name in ("source.py", "stdout.log", "manifest.json"):
            path = self.bundle / name
            before = path.read_bytes()
            os.chmod(path, 0o600)
            path.write_bytes(before + b" ")
            with self.assertRaisesRegex(ValueError, "EVIDENCE_CHANGED"):
                check.verify(self.bundle)
            path.write_bytes(before)

    def test_symlink_source_is_rejected(self):
        self.source.unlink()
        target = self.root / "other.py"
        target.write_text('print("not accepted")')
        self.source.symlink_to(target)
        with self.assertRaisesRegex(ValueError, "REGULAR_BOUNDED_SOURCE_REQUIRED"):
            self.run_check()

    def test_cli_uses_new_bundle_and_compact_result(self):
        tool = str(Path(check.__file__))
        args = [sys.executable, "-B", tool, "run", "--root", str(self.root), "--role", "A",
                "--expected", self.expected, "--source", str(self.source), "--bundle", str(self.bundle)]
        result = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["execution_status"], "EXIT_ZERO")
        self.assertNotIn("ORIGINAL", result.stdout)
        verify = subprocess.run([sys.executable, "-B", tool, "verify", "--bundle", str(self.bundle)],
                                capture_output=True, text=True)
        self.assertEqual(verify.returncode, 0, verify.stderr)


if __name__ == "__main__":
    unittest.main()
