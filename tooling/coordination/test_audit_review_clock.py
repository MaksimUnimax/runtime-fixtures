import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import audit_check


class ReviewClockTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.marker = "2026-09-30T01:32:34+00:00"
        self.epoch = 1790731954.0
        for role in "ABC":
            self.save(role, {"role": role, "status": "STOPPED", "review_clock": self.epoch,
                             "controller_reviewed_at": self.marker, "owner_requests": ["keep"],
                             "review_pending": False, "task": "preserve", "next": "preserve"})

    def tearDown(self):
        self.tmp.cleanup()

    def save(self, role, state):
        (self.root / (role + ".json")).write_text(json.dumps(state))

    def change(self, role, **values):
        state = json.loads((self.root / (role + ".json")).read_text())
        state.update(values)
        self.save(role, state)

    def test_current_clock_is_not_an_issue(self):
        self.assertEqual(audit_check.review_clock_issues(self.root), {})

    def test_completed_marker_with_old_clock_is_rejected(self):
        self.change("B", review_clock=self.epoch - 7200)
        self.assertEqual(audit_check.review_clock_issues(self.root),
                         {"B": "COMPLETED_REVIEW_DID_NOT_RESET_CLOCK"})
        with self.assertRaisesRegex(ValueError, "REVIEW_CLOCK_NOT_RECONCILED"):
            audit_check.check_review_clock_holds(self.root, {})

    def test_nested_marker_is_checked_independently(self):
        self.change("B", controller_reviewed_at=None, review_clock=1,
                    last_closed_controller_review={"at": self.marker})
        self.assertIn("B", audit_check.review_clock_issues(self.root))

    def test_new_pending_request_is_not_erased_or_mistaken_for_old_clock(self):
        self.change("A", review_pending=True, review_reason="new exact regression")
        before = (self.root / "A.json").read_bytes()
        self.assertEqual(audit_check.review_clock_issues(self.root), {})
        self.assertEqual((self.root / "A.json").read_bytes(), before)

    def test_missing_state_and_invalid_values_fail_closed(self):
        for clock in [True, float("nan"), float("inf"), "not a clock", None]:
            self.change("B", review_clock=clock)
            self.assertEqual(audit_check.review_clock_issues(self.root)["B"], "REVIEW_STATE_UNVERIFIED")
        (self.root / "C.json").unlink()
        self.assertEqual(audit_check.review_clock_issues(self.root)["C"], "REVIEW_STATE_UNVERIFIED")

    def test_naive_time_cannot_silently_choose_machine_timezone(self):
        self.change("B", controller_reviewed_at="2026-09-30T01:32:34")
        self.assertEqual(audit_check.review_clock_issues(self.root)["B"], "REVIEW_STATE_UNVERIFIED")

    def test_unresolved_hold_must_be_exact_and_explained(self):
        self.change("B", review_clock=1)
        self.assertIn("B", audit_check.check_review_clock_holds(
            self.root, {"review_clock_holds": {"B": "Exact new review remains unresolved."}}))
        for holds in [{"A": "wrong role"}, {"B": ""}, {"B": 5}]:
            with self.assertRaises(ValueError):
                audit_check.check_review_clock_holds(self.root, {"review_clock_holds": holds})

    def test_check_does_not_mutate_stop_or_other_state(self):
        self.change("B", review_clock=1)
        before = {role: (self.root / (role + ".json")).read_bytes() for role in "ABC"}
        audit_check.review_clock_issues(self.root)
        self.assertEqual(before, {role: (self.root / (role + ".json")).read_bytes() for role in "ABC"})

    def test_standard_reviewed_then_status_prevents_false_recurrence(self):
        path = Path(__file__).with_name("control.py")
        spec = importlib.util.spec_from_file_location("review_clock_control", path)
        control = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(control)
        self.change("B", status="WAITING_INPUT", review_clock=1, review_pending=True,
                    review_requested_at="2026-09-29T00:00:00Z")
        args = argparse.Namespace(receipt="independent-review.json", summary="", next="", task="")
        with patch.object(control, "CONTROL", self.root), \
             patch.object(control, "git", return_value="a" * 40), \
             patch.object(control.resource_runner, "snapshot", return_value={}):
            control.update_state("B", "reviewed", args)
            actual = control.update_state("B", "status", args)
        self.assertFalse(actual["review_pending"])
        self.assertEqual(actual["status"], "WAITING_INPUT")
        self.assertEqual(actual["owner_requests"], ["keep"])
        self.assertEqual(audit_check.review_clock_issues(self.root), {})


if __name__ == "__main__":
    unittest.main()
