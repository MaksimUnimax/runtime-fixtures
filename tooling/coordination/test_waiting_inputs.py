import argparse
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from waiting_gate import PLAN_IDS

spec = importlib.util.spec_from_file_location("control_input_test", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class WaitingInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.checked = datetime.now(timezone.utc) - timedelta(minutes=10)
        self.head = "b" * 40
        self.receipt = self.root / "queue.json"

    def prepare(self, role="B"):
        self.role = role
        self.state = self.root / (role + ".json")
        self.state.write_text(json.dumps({"role": role, "status": "RUNNING",
                                        "owner_requests": ["preserve"], "review_pending": True}))
        self.data = {"version": 1, "role": role, "head": self.head,
                     "checked_at": self.checked.isoformat(), "work_board": {"exists": False, "sha256": None},
                     "entries": [{"id": k, "plan": k, "state": "DONE",
                                  "outcome": "source complete", "evidence": ["exact-receipt"]}
                                 for k in sorted(PLAN_IDS[role])]}
        self.receipt.write_text(json.dumps(self.data))

    def input(self, relative, old=False):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if relative.startswith("controller-notices/"):
            role = path.name.split("-", 1)[0]
            path.write_text(json.dumps({"role": role, "status": "OPEN"}))
        else:
            path.write_text("{}")
        if old:
            stamp = self.checked.timestamp() - 1
            os.utime(path, (stamp, stamp))
        return path

    def waiting(self):
        args = argparse.Namespace(receipt=str(self.receipt), summary="", task="", next="")
        with patch.object(control, "CONTROL", self.root), patch.object(control, "git", side_effect=lambda *args: "" if args == ("status", "--porcelain") else self.head), patch.object(control.resource_runner, "snapshot", return_value={}):
            return control.update_state(self.role, "waiting", args)

    def assert_rejected_unchanged(self):
        before = self.state.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "WAITING_QUEUE_INPUT_CHANGED"):
            self.waiting()
        self.assertEqual(self.state.read_bytes(), before)

    def test_notice_after_scan_rejects_old_receipt_without_state_write(self):
        self.prepare()
        self.input("controller-notices/B-new-review.json")
        self.assert_rejected_unchanged()

    def test_directed_handoff_after_scan_rejects_old_receipt(self):
        self.prepare()
        self.input("peer-handoffs/B/C-B-next.request.json")
        self.assert_rejected_unchanged()

    def test_integrator_sees_new_foreign_candidate_inbox(self):
        self.prepare("C")
        self.input("inbox/A-exact.json")
        self.assert_rejected_unchanged()

    def test_own_intake_result_change_requires_rescan(self):
        self.prepare()
        self.input("inbox/B-exact.json")
        self.assert_rejected_unchanged()

    def test_unrelated_role_does_not_block_wait(self):
        self.prepare()
        self.input("controller-notices/A-new.json")
        self.input("peer-handoffs/C/A-C.request.json")
        self.input("inbox/A-exact.json")
        self.assertEqual(self.waiting()["status"], "WAITING_INPUT")

    def test_old_inputs_and_fresh_rescan_allow_wait(self):
        self.prepare()
        self.input("controller-notices/B-old.json", old=True)
        self.assertEqual(self.waiting()["status"], "WAITING_INPUT")
        self.input("controller-notices/B-new.json")
        self.assert_rejected_unchanged()
        self.data["checked_at"] = datetime.now(timezone.utc).isoformat()
        self.receipt.write_text(json.dumps(self.data))
        self.assertEqual(self.waiting()["status"], "WAITING_INPUT")

    def test_scan_io_error_is_not_accepted_as_no_new_input(self):
        self.prepare()
        before = self.state.read_bytes()
        with patch("waiting_gate.Path.glob", side_effect=PermissionError("fixture denied")):
            with self.assertRaisesRegex(RuntimeError, "WAITING_QUEUE_INPUT_SCAN_FAILED"):
                self.waiting()
        self.assertEqual(self.state.read_bytes(), before)

    def test_new_notice_never_clears_stop(self):
        self.prepare()
        self.state.write_text(json.dumps({"role": "B", "status": "STOPPED"}))
        self.input("controller-notices/B-new.json")
        before = self.state.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            self.waiting()
        self.assertEqual(self.state.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
