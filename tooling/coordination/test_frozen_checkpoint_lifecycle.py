"""Persisted checkpoint transitions must fence late harmless Python checks."""
import argparse
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import control
import frozen_python_check as check


class CheckpointGenerationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        self.args = argparse.Namespace(receipt="", task="SAME_TASK", summary="N", next="next")
        state = {"status": "RUNNING", "task": "SAME_TASK", "head": "a" * 40,
                 "resume_receipt": "owner-once", "checkpoint_status": "CURRENT",
                 "review_clock": time.time(), "owner_requests": ["preserve-owner-request"]}
        (self.root / "A.json").write_text(json.dumps(state))
        for obj, key, value in [(control, "CONTROL", self.root),
                                (control, "git", lambda *a: "a" * 40),
                                (control.resource_runner, "snapshot", lambda *a: {})]:
            patcher = patch.object(obj, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.source = self.root / "check.py"
        self.source.write_text('print("harmless child")\n')
        self.bundle = self.root / "bundle"

    def checkpoint(self):
        return control.update_state("A", "checkpoint", self.args)

    def run_expected(self, digest):
        return check.run_check(self.root, "A", digest, self.source, self.bundle)

    def test_late_same_task_checkpoint_is_rejected_before_claim_bundle_child(self):
        self.checkpoint()
        digest, _ = check.read_checkpoint(self.root, "A")
        self.args.summary = "new evidence, same task/head/resume"
        self.checkpoint()
        with self.assertRaisesRegex(ValueError, "CHECKPOINT_CHANGED"):
            self.run_expected(digest)
        self.assertFalse(self.bundle.exists())
        self.assertFalse((self.root / "controllers/execution-claims").exists())

    def test_even_identical_checkpoint_payload_creates_new_generation(self):
        first = self.checkpoint()
        second = self.checkpoint()
        self.assertNotEqual(first.get("checkpoint_id"), second.get("checkpoint_id"))

    def test_status_polling_does_not_invalidate_fresh_checkpoint(self):
        first = self.checkpoint()
        digest, _ = check.read_checkpoint(self.root, "A")
        for _ in range(2):
            control.update_state("A", "status", self.args)
        self.assertEqual(first.get("checkpoint_id"), json.loads((self.root / "A.json").read_text()).get("checkpoint_id"))
        self.assertEqual(self.run_expected(digest)["execution_status"], "EXIT_ZERO")
        self.assertEqual(check.verify(self.bundle)["status"], "VERIFIED_BYTES")

    def test_missing_or_invalid_checkpoint_identity_fails_closed(self):
        for value in [None, "", "not-a-checkpoint", True, 1]:
            self.checkpoint()
            state = json.loads((self.root / "A.json").read_text())
            state["checkpoint_id"] = value
            (self.root / "A.json").write_text(json.dumps(state))
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "CHECKPOINT_ID_REQUIRED"):
                check.read_checkpoint(self.root, "A")

    def test_checkpoint_while_stopped_cannot_enable_execution(self):
        self.checkpoint()
        control.update_state("A", "pause", self.args)
        self.checkpoint()
        digest, state = check.read_checkpoint(self.root, "A")
        self.assertEqual(state["status"], "STOPPED")
        with self.assertRaisesRegex(ValueError, "CHECKPOINT_CHANGED"):
            self.run_expected(digest)
        self.assertFalse(self.bundle.exists())

    def test_resume_requires_new_checkpoint_before_runner(self):
        self.checkpoint()
        control.update_state("A", "pause", self.args)
        self.args.receipt = "new-owner-once"
        state = control.update_state("A", "resume", self.args)
        self.assertEqual(state["owner_requests"], ["preserve-owner-request"])
        with self.assertRaisesRegex(ValueError, "CHECKPOINT_ID_REQUIRED"):
            check.read_checkpoint(self.root, "A")
        self.checkpoint()
        digest, _ = check.read_checkpoint(self.root, "A")
        self.assertEqual(self.run_expected(digest)["execution_status"], "EXIT_ZERO")

    def test_newer_stop_survives_repeated_resume_receipt(self):
        self.checkpoint()
        self.args.receipt = "new-owner-once"
        control.update_state("A", "resume", self.args)
        control.update_state("A", "pause", self.args)
        before = (self.root / "A.json").read_bytes()
        with self.assertRaisesRegex(RuntimeError, "RESUME_RECEIPT_ALREADY_USED"):
            control.update_state("A", "resume", self.args)
        self.assertEqual((self.root / "A.json").read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
