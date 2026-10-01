import argparse
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from work_queue import load_board, role_work, assert_no_ready_work, advance_task, compact_state, board_snapshot, status_work, add_task
from waiting_gate import validate_waiting_receipt, PLAN_IDS

spec = importlib.util.spec_from_file_location("flow_control_test", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class WorkQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "controllers").mkdir()
        (self.root / "logs").mkdir()
        for role in "ABC":
            (self.root / (role + ".json")).write_text(json.dumps({
                "role": role, "status": "RUNNING", "task": "old", "review_pending": True,
                "owner_requests": ["Existing human gate"], "checkpoint_id": "keep-fence",
            }))
        self.board = {"version": 1, "revision": 1, "tasks": [
            {"id": "b-auth", "role": "B", "plan": "B04", "state": "READY", "requires": [], "result": "Ordinary isolated auth", "paths": ["apps/api/src/auth.ts"]},
            {"id": "a-client", "role": "A", "plan": "A04", "state": "BLOCKED", "requires": ["b-auth"], "result": "Installed client", "paths": ["apps/extension/runtime.js"]},
        ]}
        self.path = self.root / "controllers/work-board.json"
        self.save()
        self.receipt = self.root / "logs/result.json"
        self.receipt.write_text('{"result":"source-only"}')
        self.args = argparse.Namespace(receipt="", task="", summary="", next="")

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        self.path.write_text(json.dumps(self.board))

    def test_ready_work_blocks_old_all_blocked_plan_receipt(self):
        now = datetime.now(timezone.utc)
        receipt = {"version": 1, "role": "B", "head": "f" * 40, "checked_at": now.isoformat(), "work_board": board_snapshot(self.root),
                   "entries": [{"id": x, "plan": x, "state": "BLOCKED", "outcome": "Old wait",
                                "evidence": ["old.md"], "owner": "C", "blocked_action": "live",
                                "unblock_when": "auth", "independent_work_complete": True}
                               for x in sorted(PLAN_IDS["B"])]}
        file = self.root / "old-scan.json"
        file.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
            validate_waiting_receipt("B", str(file), "f" * 40, now, self.root)

    def test_completion_releases_consumer_without_controller(self):
        self.assertEqual(next(t for t in role_work(self.root, "A")["tasks"] if t["id"] == "a-client")["state"], "BLOCKED")
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        advance_task(self.root, "B", "b-auth", "DONE", str(self.receipt))
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "READY")
        with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
            assert_no_ready_work(self.root, "A")

    def test_dependency_failure_cannot_start_consumer(self):
        with self.assertRaisesRegex(RuntimeError, "DEPENDENCY_PENDING"):
            advance_task(self.root, "A", "a-client", "IN_PROGRESS")

    def test_other_role_cannot_change_task(self):
        with self.assertRaisesRegex(RuntimeError, "TASK_OWNER"):
            advance_task(self.root, "A", "b-auth", "IN_PROGRESS")

    def test_stop_preserves_board_and_checkpoint(self):
        f = self.root / "B.json"
        original = json.loads(f.read_text())
        original["status"] = "STOPPED"
        f.write_text(json.dumps(original))
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(json.loads(f.read_text()), original)

    def test_completion_needs_real_scoped_receipt(self):
        for receipt in ["", "/etc/passwd", str(self.root / "profiles/private.json")]:
            with self.subTest(receipt=receipt), self.assertRaises(RuntimeError):
                advance_task(self.root, "B", "b-auth", "DONE", receipt)

    def test_dependency_cycle_missing_and_duplicate_rejected(self):
        for mutate in [
            lambda d: d["tasks"][0].update(requires=["a-client"]),
            lambda d: d["tasks"][0].update(requires=["missing"]),
            lambda d: d["tasks"].append(copy.deepcopy(d["tasks"][0])),
        ]:
            board = copy.deepcopy(self.board)
            mutate(board)
            self.path.write_text(json.dumps(board))
            with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID"):
                load_board(self.root)

    def test_malformed_board_does_not_silently_allow_wait(self):
        for raw in ["[]", "{", "x" * 262145]:
            self.path.write_text(raw)
            with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID"):
                assert_no_ready_work(self.root, "B")

    def test_no_board_preserves_existing_plan_gate(self):
        self.path.unlink()
        self.assertEqual(role_work(self.root, "A")["tasks"], [])
        assert_no_ready_work(self.root, "A")

    def test_dirty_work_cannot_be_hidden_by_waiting(self):
        with patch.object(control, "CONTROL", self.root), patch.object(control, "validate_waiting_receipt", return_value={}), patch.object(control, "git", return_value=" M unfinished.py"):
            before = (self.root / "A.json").read_bytes()
            with self.assertRaisesRegex(RuntimeError, "WAITING_DIRTY_WORKTREE"):
                control.update_state("A", "waiting", self.args)
            self.assertEqual((self.root / "A.json").read_bytes(), before)

    def test_bad_board_never_prevents_stop(self):
        self.path.write_text("{")
        with patch.object(control, "CONTROL", self.root), patch.object(control, "git", return_value=""), patch.object(control.resource_runner, "snapshot", return_value={}):
            result = control.update_state("A", "pause", self.args)
            self.assertEqual(result["status"], "STOPPED")
            self.assertIn("WORK_QUEUE_INVALID", result["work_queue"]["error"])

    def test_compact_status_does_not_repeat_notice_bodies(self):
        state = {"role": "A", "status": "RUNNING", "controller_notices": [
            {"id": str(i), "created_at": f"2026-10-{i+1:02d}", "body": "x" * 3000}
            for i in range(20)]}
        result = compact_state(state)
        self.assertEqual(result["notice_count"], 20)
        self.assertEqual(len(result["latest_notices"]), 5)
        self.assertLess(len(json.dumps(result)), 1400)
        self.assertEqual(result["latest_notices"][0]["id"], "19")

    def test_queue_transition_does_not_clear_review_or_owner_gate(self):
        before = (self.root / "B.json").read_bytes()
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        self.assertEqual((self.root / "B.json").read_bytes(), before)

    def test_removed_board_invalidates_recorded_wait(self):
        proof = board_snapshot(self.root)
        self.path.unlink()
        result = status_work(self.root, "A", waiting_proof=proof)
        self.assertEqual(result["waiting_invalidated"], "WORK_BOARD_CHANGED_OR_REMOVED")
        self.assertTrue(result["action_required"])

    def test_fake_blocker_receipt_cannot_hide_ready_work(self):
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "RECEIPT_REQUIRED"):
            advance_task(self.root, "B", "b-auth", "BLOCKED", str(self.root / "logs/missing.json"), "external")
        self.assertEqual(self.path.read_bytes(), before)

    def test_board_delete_after_scan_rejects_wait_receipt(self):
        now = datetime.now(timezone.utc)
        scan = {"version": 1, "role": "C", "head": "a" * 40, "checked_at": now.isoformat(),
                "work_board": board_snapshot(self.root), "entries": [
                {"id": p, "plan": p, "state": "DONE", "outcome": "finished", "evidence": ["receipt"]}
                for p in sorted(PLAN_IDS["C"])]}
        file = self.root / "scan.json"
        file.write_text(json.dumps(scan))
        self.path.unlink()
        with self.assertRaisesRegex(RuntimeError, "WORK_BOARD_CHANGED_OR_MISSING_PROOF"):
            validate_waiting_receipt("C", str(file), "a" * 40, now, self.root)

    def test_role_defines_next_requirement_without_controller(self):
        task = {"id": "a-next", "role": "A", "plan": "A04", "state": "READY", "requires": [], "result": "Verify remaining acceptance criterion", "paths": ["tests/regression/extension-core/example.mjs"], "acceptance": ["Actual regression fails before fix"], "basis": "SPEC remaining recovery criterion"}
        add_task(self.root, "A", task)
        self.assertEqual(role_work(self.root, "A")["tasks"][-1]["state"], "READY")
        self.assertTrue(load_board(self.root)["tasks"][-1]["approved_plan_basis"].startswith("| A04 |"))
        with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
            assert_no_ready_work(self.root, "A")
        before = self.path.read_bytes()
        for changed in [dict(task, role="B"), dict(task, id="other", plan="Z99"), dict(task, id="other", basis=""), dict(task, id="other", paths=["apps/site/main.ts"]), dict(task, id="other", paths=["tests/**"]), dict(task, id="other", requires=["missing"]), task]:
            with self.assertRaises(RuntimeError):
                add_task(self.root, "A", changed)
            self.assertEqual(self.path.read_bytes(), before)

    def test_stopped_role_cannot_self_assign(self):
        path = self.root / "A.json"
        path.write_text(json.dumps({"status": "STOPPED"}))
        task = {"id": "a-next", "role": "A", "plan": "A04", "state": "READY", "requires": [], "result": "Check", "paths": ["tests/regression/extension-core/test.mjs"], "acceptance": ["pass"], "basis": "SPEC"}
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            add_task(self.root, "A", task)
        self.assertEqual(self.path.read_bytes(), before)

    def test_heartbeat_does_not_claim_new_checkpoint(self):
        with patch.object(control, "CONTROL", self.root), patch.object(control, "git", return_value=""), patch.object(control.resource_runner, "snapshot", return_value={}):
            first = control.update_state("A", "status", self.args)
            self.assertNotIn("last_checkpoint_at", first)
            self.assertIn("heartbeat_at", first)
            self.args.task = "actual task"
            checkpoint = control.update_state("A", "checkpoint", self.args)
            later = control.update_state("A", "status", self.args)
            self.assertEqual(later["last_checkpoint_at"], checkpoint["last_checkpoint_at"])

    def test_unblock_requires_new_scoped_evidence(self):
        advance_task(self.root, "B", "b-auth", "BLOCKED", str(self.receipt), "SMTP unavailable")
        with self.assertRaises(RuntimeError):
            advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS", str(self.receipt))
        self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "IN_PROGRESS")

    def test_blocker_needs_concrete_evidence(self):
        with self.assertRaisesRegex(RuntimeError, "BLOCKER_AND_EVIDENCE"):
            advance_task(self.root, "B", "b-auth", "BLOCKED")
        advance_task(self.root, "B", "b-auth", "BLOCKED", str(self.receipt), "Local SMTP test service absent")
        assert_no_ready_work(self.root, "B")


if __name__ == "__main__":
    unittest.main()
