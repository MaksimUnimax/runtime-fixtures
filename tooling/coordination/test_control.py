import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("control", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.args = argparse.Namespace(receipt="", task="", summary="", next="")
        self.ctx = patch.object(control, "CONTROL", self.root)
        self.ctx.start()
        self.git = patch.object(control, "git", return_value="a" * 40)
        self.git.start()

    def tearDown(self):
        self.git.stop()
        self.ctx.stop()
        self.tmp.cleanup()

    def test_automatic_start_cannot_clear_stop(self):
        control.update_state("A", "pause", self.args)
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            control.update_state("A", "start", self.args)
        self.assertEqual(json.loads((self.root / "A.json").read_text())["status"], "STOPPED")

    def test_due_review_does_not_stop_independent_work(self):
        state = control.update_state("A", "start", self.args)
        state["review_clock"] = time.time() - control.PERIOD - 1
        control.write_json(self.root / "A.json", state)
        state = control.update_state("A", "status", self.args)
        self.assertTrue(state["review_pending"])
        self.assertEqual(state["status"], "RUNNING")
        control.require_running("A")

    def test_owner_request_survives_checkpoint(self):
        self.args.summary = "Access to a test mailbox"
        control.update_state("B", "request-owner", self.args)
        self.args.summary = "Independent safe task finished"
        state = control.update_state("B", "checkpoint", self.args)
        self.assertEqual(state["owner_requests"], ["Access to a test mailbox"])

    def test_review_requires_receipt(self):
        with self.assertRaisesRegex(RuntimeError, "receipt"):
            control.update_state("C", "reviewed", self.args)

    def test_cross_role_edit_is_rejected(self):
        rules = {"roles":{"A":{"allow":["apps/extension/**"],"deny":[]}}}
        with patch.object(control, "policy", return_value=rules), patch.object(control, "git", side_effect=["apps/api/src/main.ts", ""]):
            with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
                control.scope_guard("A")

    def test_busy_heavy_slot_does_not_start_a_command(self):
        import fcntl
        with (self.root / "heavy.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(control.subprocess, "Popen") as child:
                self.assertEqual(control.heavy("C", ["must-not-run"], False), 75)
                child.assert_not_called()

if __name__ == "__main__":
    unittest.main()
