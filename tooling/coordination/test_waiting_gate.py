import argparse
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
import work_board_v2 as v2
import work_queue
from waiting_gate import validate_waiting_receipt, PLAN_IDS

spec = importlib.util.spec_from_file_location("control_queue_test", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class WaitingPolicyTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.path = self.root / "queue.json"
        self.now = datetime.now(timezone.utc)
        self.head = "a" * 40
        self.data = {
            "version": 1, "role": "A", "head": self.head,
            "checked_at": self.now.isoformat(),
            "entries": [
                {"id": p + "_remaining", "plan": p, "state": "BLOCKED",
                 "outcome": "Complete the remaining actual installed boundary",
                 "evidence": ["receipt/source-complete.md"],
                 "blocked_action": "Owner performs ordinary OTP",
                 "owner": "OWNER", "unblock_when": "Ordinary signed login is available",
                 "independent_work_complete": True}
                for p in sorted(PLAN_IDS["A"])
            ],
        }

    def tearDown(self):
        self.tmp.cleanup()

    def validate(self, data=None):
        self.path.write_text(json.dumps(data if data is not None else self.data))
        return validate_waiting_receipt("A", str(self.path), self.head, self.now)

    def test_complete_blocker_review_allows_bounded_wait(self):
        result = self.validate()
        self.assertEqual(result["entry_count"], 21)
        self.assertEqual(result["head"], self.head)
        self.assertEqual(len(result["sha256"]), 64)

    def test_ready_or_in_progress_work_prevents_global_wait(self):
        for state in ["READY", "IN_PROGRESS"]:
            with self.subTest(state=state):
                self.data["entries"][0]["state"] = state
                with self.assertRaisesRegex(RuntimeError, "WAITING_READY_TASKS_REMAIN"):
                    self.validate()

    def test_owner_gate_does_not_hide_available_independent_work(self):
        self.data["entries"][0]["independent_work_complete"] = False
        with self.assertRaisesRegex(RuntimeError, "WAITING_INDEPENDENT_WORK_REMAINS"):
            self.validate()

    def test_partial_plan_and_missing_evidence_are_rejected(self):
        for mutation, expected in [
            (lambda d: d["entries"].pop(), "INCOMPLETE"),
            (lambda d: d["entries"][0].update(evidence=[]), "EVIDENCE"),
            (lambda d: d["entries"][0].pop("unblock_when"), "DEPENDENCY"),
        ]:
            with self.subTest(expected=expected):
                d = copy.deepcopy(self.data)
                mutation(d)
                with self.assertRaisesRegex(RuntimeError, expected):
                    self.validate(d)

    def test_changed_code_or_stale_snapshot_cannot_justify_wait(self):
        for key, value, expected in [
            ("head", "b" * 40, "HEAD_STALE"),
            ("checked_at", (self.now - timedelta(minutes=31)).isoformat(), "SCAN_STALE"),
            ("checked_at", (self.now + timedelta(minutes=1)).isoformat(), "SCAN_STALE"),
            ("checked_at", "2026-09-28T12:00:00", "TIME_INVALID"),
            ("role", "B", "IDENTITY"),
        ]:
            with self.subTest(expected=expected):
                d = copy.deepcopy(self.data)
                d[key] = value
                with self.assertRaisesRegex(RuntimeError, expected):
                    self.validate(d)

    def test_missing_duplicate_and_malformed_receipts_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, "REQUIRES_QUEUE"):
            validate_waiting_receipt("A", "", self.head, self.now)
        self.data["entries"].append(copy.deepcopy(self.data["entries"][0]))
        with self.assertRaisesRegex(RuntimeError, "ENTRY_INVALID"):
            self.validate()
        for contents in ["[", "[]", "x" * 131073]:
            self.path.write_text(contents)
            with self.assertRaises(RuntimeError):
                validate_waiting_receipt("A", str(self.path), self.head, self.now)

    def test_all_roles_require_entire_shared_plan(self):
        for role, expected in [("A", 21), ("B", 21), ("C", 21)]:
            d = copy.deepcopy(self.data)
            d["role"] = role
            template = d["entries"][0]
            d["entries"] = [dict(template, id=p, plan=p) for p in sorted(PLAN_IDS[role])]
            self.path.write_text(json.dumps(d))
            self.assertEqual(validate_waiting_receipt(role, str(self.path), self.head, self.now)["entry_count"], expected)

    def test_rejected_wait_does_not_rewrite_state_or_clear_owner_request(self):
        args = argparse.Namespace(receipt="", task="", summary="Need owner OTP", next="")
        with patch.object(control, "CONTROL", self.root), patch.object(control, "git", return_value=self.head), patch.object(control.resource_runner, "snapshot", return_value={}):
            control.update_state("A", "request-owner", args)
            control.update_state("A", "start", args)
            before = (self.root / "A.json").read_bytes()
            with self.assertRaisesRegex(RuntimeError, "WAITING_REQUIRES_QUEUE"):
                control.update_state("A", "waiting", args)
            self.assertEqual((self.root / "A.json").read_bytes(), before)

    def test_repeat_transfer_prompt_cannot_restart_later_stop(self):
        args = argparse.Namespace(receipt="OWNER_TRANSFER_20260928_A", task="", summary="Owner STOP", next="")
        with patch.object(control, "CONTROL", self.root), patch.object(control, "git", return_value=self.head), patch.object(control.resource_runner, "snapshot", return_value={}):
            control.update_state("A", "pause", args)
            resumed = control.update_state("A", "resume", args)
            self.assertEqual(resumed["status"], "RUNNING")
            stopped = control.update_state("A", "pause", args)
            self.assertIn("stopped_at", stopped)
            before = (self.root / "A.json").read_bytes()
            with self.assertRaisesRegex(RuntimeError, "RESUME_RECEIPT_ALREADY_USED"):
                control.update_state("A", "resume", args)
            self.assertEqual((self.root / "A.json").read_bytes(), before)
            args.receipt = "OWNER_NEW_DIRECT_INSTRUCTION"
            self.assertEqual(control.update_state("A", "resume", args)["status"], "RUNNING")

    def _install_v2_waiting_board(self):
        control_root = self.root / "control"
        (control_root / "controllers").mkdir(parents=True)
        (control_root / "logs").mkdir()
        for role in "ABC":
            (control_root / f"{role}.json").write_text(
                json.dumps({"role": role, "status": "RUNNING"})
            )
        legacy_receipt = control_root / "logs" / "done.json"
        legacy_receipt.write_text('{"result":"legacy"}')
        board = {
            "version": 1,
            "revision": 9,
            "updated_at": self.now.isoformat(),
            "tasks": [
                {
                    "id": "done-dependency",
                    "role": "B",
                    "plan": "B04",
                    "state": "DONE",
                    "requires": [],
                    "result": "done",
                    "paths": ["apps/api/src/done.ts"],
                    "completion_receipt": str(legacy_receipt),
                },
                {
                    "id": "blocked-active",
                    "role": "A",
                    "plan": "A04",
                    "state": "BLOCKED",
                    "requires": [],
                    "result": "blocked",
                    "paths": ["apps/extension/blocked.js"],
                    "blocked_reason": "external gate",
                },
            ],
        }
        hot = control_root / "controllers" / "work-board.json"
        hot.write_text(json.dumps(board, ensure_ascii=False, indent=2) + "\n")
        generated = v2.build_generation_from_v1(control_root, board)
        v2._write_drafts(control_root, generated["drafts"])
        generated_hot = dict(generated["core"], generation_id=v2._generation_id(generated["core"]), last_operation_id="0" * 64)
        generated_hot_raw = v2._canonical_bytes(generated_hot)
        input_sha = v2._sha(hot.read_bytes())
        operation_id, generated_hot_raw, tx = v2._make_migration_tx(
            input_sha, board["revision"], generated_hot, generated_hot_raw, "b" * 64
        )
        v2._write_journal(control_root, tx, initial=True)
        tx["state"] = "COMMITTED"
        v2._write_journal(control_root, tx)
        v2.install_hot_generation(control_root, generated_hot_raw)
        return control_root

    def _full_waiting_receipt(self, role, snapshot, checked_at):
        return {
            "version": 1,
            "role": role,
            "head": self.head,
            "checked_at": checked_at.isoformat(),
            "work_board": snapshot,
            "entries": [
                {
                    "id": plan + "_waiting",
                    "plan": plan,
                    "state": "BLOCKED",
                    "outcome": "External gate",
                    "evidence": ["receipt/evidence.md"],
                    "blocked_action": "external",
                    "owner": "OWNER",
                    "unblock_when": "external input",
                    "independent_work_complete": True,
                }
                for plan in sorted(PLAN_IDS[role])
            ],
        }

    def test_v2_snapshot_shape_and_completed_authority_change_invalidates_waiting(self):
        control_root = self._install_v2_waiting_board()
        snapshot = work_queue.board_snapshot(control_root)
        self.assertEqual(set(snapshot), {"exists", "sha256"})
        self.assertTrue(snapshot["exists"])
        self.assertEqual(len(snapshot["sha256"]), 64)

        checked = datetime.now(timezone.utc)
        receipt = self._full_waiting_receipt("C", snapshot, checked)
        waiting = self.root / "v2-waiting.json"
        waiting.write_text(json.dumps(receipt))
        validated = validate_waiting_receipt(
            "C", str(waiting), self.head, checked, control_root
        )
        self.assertEqual(validated["work_board"], snapshot)

        state = v2.load_state(control_root)
        logical = copy.deepcopy(state["logical"])
        next_receipt = control_root / "logs" / "done-2.json"
        next_receipt.write_text('{"result":"legacy2"}')
        logical["tasks"].append(
            {
                "id": "done-dependency-2",
                "role": "B",
                "plan": "B04",
                "state": "DONE",
                "requires": [],
                "result": "done2",
                "paths": ["apps/api/src/done-2.ts"],
                "completion_receipt": str(next_receipt),
            }
        )
        logical["revision"] += 1
        logical["updated_at"] = datetime.now(timezone.utc).isoformat()
        v2.commit_logical_board(
            control_root, logical,
            {"action": "ADD", "role": "B", "task": "done-dependency-2"},
        )
        self.assertNotEqual(work_queue.board_snapshot(control_root), snapshot)
        with self.assertRaisesRegex(
            RuntimeError, "WAITING_WORK_BOARD_CHANGED_OR_MISSING_PROOF"
        ):
            validate_waiting_receipt(
                "C", str(waiting), self.head, datetime.now(timezone.utc), control_root
            )

    def test_v2_current_completed_sidecar_tamper_fails_waiting_closed(self):
        control_root = self._install_v2_waiting_board()
        snapshot = work_queue.board_snapshot(control_root)
        checked = datetime.now(timezone.utc)
        receipt = self._full_waiting_receipt("C", snapshot, checked)
        waiting = self.root / "v2-tampered-waiting.json"
        waiting.write_text(json.dumps(receipt))

        state = v2.load_state(control_root)
        root_sha = state["hot"]["completed_root_hash"]
        node = (
            control_root
            / "controllers"
            / "work-board-done"
            / "nodes"
            / f"{root_sha}.json"
        )
        node.write_bytes(node.read_bytes() + b" ")
        with self.assertRaises(RuntimeError):
            validate_waiting_receipt(
                "C", str(waiting), self.head, datetime.now(timezone.utc), control_root
            )

    def test_legacy_resume_receipt_is_not_reusable_after_stop(self):
        args = argparse.Namespace(receipt="old-authority", task="", summary="", next="")
        state = {"role": "B", "status": "STOPPED", "resume_receipt": args.receipt}
        (self.root / "B.json").write_text(json.dumps(state))
        with patch.object(control, "CONTROL", self.root):
            with self.assertRaisesRegex(RuntimeError, "RESUME_RECEIPT_ALREADY_USED"):
                control.update_state("B", "resume", args)
