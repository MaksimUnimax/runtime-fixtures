"""Persisted lifecycle checks: a new resume cannot revive stale STOP instructions."""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("resume_control", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class ResumeCheckpointTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.args = argparse.Namespace(receipt="fresh-owner-receipt", task="", summary="", next="")
        self.old = {"role": "C", "status": "STOPPED", "task": "C_STOPPED_OWNER",
                    "result": "Prior verified progress; STOP requested", "next": "Remain STOPPED",
                    "head": "b" * 40, "stopped_at": "2026-09-29T11:04:25+00:00",
                    "stop_reason": "direct owner STOP", "updated_at": "old-checkpoint",
                    "review_pending": True, "owner_requests": ["legitimate browser session"],
                    "review_receipt": "keep-reviewed-evidence", "resume_receipt": "old-receipt",
                    "consumed_resume_receipts": ["old-receipt"], "accepted": {"source": "preserve"}}
        self.path = self.root / "C.json"
        self.path.write_text(json.dumps(self.old))
        self.patches = [patch.object(control, "CONTROL", self.root),
                        patch.object(control, "git", return_value="a" * 40),
                        patch.object(control.resource_runner, "snapshot", return_value={})]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()
        self.tmp.cleanup()

    def resume(self):
        control.update_state("C", "resume", self.args)
        return json.loads(self.path.read_text())

    def test_current_checkpoint_no_longer_orders_old_stop(self):
        state = self.resume()
        self.assertEqual(state["status"], "RUNNING")
        self.assertEqual(state["task"], "RECONCILE_AFTER_RESUME")
        self.assertNotEqual(state["next"], self.old["next"])
        self.assertEqual(state["checkpoint_status"], "RECONCILIATION_REQUIRED")
        self.assertTrue(state["resumed_at"])
        self.assertNotIn("stop_reason", state)
        self.assertNotIn("stopped_at", state)

    def test_archive_preserves_previous_progress_and_stop_evidence(self):
        state = self.resume()
        prior = state["resume_history"][-1]["previous_checkpoint"]
        for key in ("task", "result", "next", "head", "stopped_at", "stop_reason", "updated_at", "status"):
            self.assertEqual(prior[key], self.old[key])
        for key in ("owner_requests", "review_pending", "review_receipt", "accepted"):
            self.assertEqual(state[key], self.old[key])

    def test_later_stop_survives_repeated_receipt_byte_for_byte(self):
        self.resume()
        self.args.summary = "new later STOP"
        control.update_state("C", "pause", self.args)
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "RESUME_RECEIPT_ALREADY_USED"):
            control.update_state("C", "resume", self.args)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(json.loads(before)["status"], "STOPPED")

    def test_missing_receipt_does_not_rewrite_state(self):
        before = self.path.read_bytes()
        self.args.receipt = ""
        with self.assertRaises(RuntimeError):
            control.update_state("C", "resume", self.args)
        self.assertEqual(self.path.read_bytes(), before)

    def test_fresh_checkpoint_clears_reconciliation_only(self):
        self.resume()
        self.args.task = "C02"
        self.args.summary = "Fresh release evidence"
        self.args.next = "Signed readback"
        state = control.update_state("C", "checkpoint", self.args)
        saved = json.loads(self.path.read_text())
        self.assertEqual(saved["checkpoint_status"], "CURRENT")
        self.assertEqual(saved["task"], "C02")
        self.assertEqual(saved["result"], "Fresh release evidence")
        self.assertEqual(saved["owner_requests"], self.old["owner_requests"])
        self.assertEqual(saved["status"], "RUNNING")
        self.assertEqual(saved["resume_history"], state["resume_history"])

    def test_history_accumulates_without_reusing_authority(self):
        self.resume()
        self.args.summary = "second STOP"
        control.update_state("C", "pause", self.args)
        self.args.receipt = "second-fresh-owner-receipt"
        state = self.resume()
        self.assertEqual(len(state["resume_history"]), 2)
        self.assertEqual(state["resume_history"][1]["previous_checkpoint"]["stop_reason"], "second STOP")
        self.assertEqual(state["consumed_resume_receipts"], ["old-receipt", "fresh-owner-receipt", "second-fresh-owner-receipt"])

    def test_checkpoint_cannot_resume_a_later_stop(self):
        self.resume()
        self.args.summary = "later STOP"
        control.update_state("C", "pause", self.args)
        self.args.summary = "safe saved progress"
        state = control.update_state("C", "checkpoint", self.args)
        self.assertEqual(state["status"], "STOPPED")
        self.assertEqual(state["stop_reason"], "later STOP")


if __name__ == "__main__":
    unittest.main()
