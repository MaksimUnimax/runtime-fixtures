"""Only coordination behavior: no product builds, browser or live DB."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from work_queue import claim_task, load_board, role_work, validate_task_scope, assert_no_ready_work, add_task
from publication_guard import validate_main_receipt
from ci_gate import REQUIRED


class SharedOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "controllers").mkdir()
        for role in "ABC":
            (self.root / (role + ".json")).write_text(json.dumps({"status": "RUNNING"}))
        self.tasks = [
            {"id": "backend", "role": "B", "plan": "B04", "state": "READY", "requires": [],
             "paths": ["apps/api/src/auth.ts", "packages/server/migrations/next.sql"],
             "acceptance": ["isolated auth"], "result": "tested auth"},
            {"id": "extension", "role": "A", "plan": "A04", "state": "READY", "requires": [],
             "paths": ["apps/extension/runtime.js"], "acceptance": ["installed flow"], "result": "tested flow"},
        ]
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        (self.root / "controllers/work-board.json").write_text(json.dumps({"version": 1, "revision": 0, "tasks": self.tasks}))

    def test_a_claims_backend_and_migration_without_b_or_controller(self):
        claim_task(self.root, "A", "backend")
        task = load_board(self.root)["tasks"][0]
        self.assertEqual((task["role"], task["state"]), ("A", "IN_PROGRESS"))
        validate_task_scope(self.root, "A", task["paths"])
        with self.assertRaisesRegex(RuntimeError, "TASK_SCOPE_VIOLATION"):
            validate_task_scope(self.root, "B", task["paths"])

    def test_c_claims_extension_without_a_handoff(self):
        claim_task(self.root, "C", "extension")
        validate_task_scope(self.root, "C", ["apps/extension/runtime.js"])

    def test_only_one_concurrent_claim_wins(self):
        def take(role):
            try:
                claim_task(self.root, role, "backend")
                return True
            except RuntimeError:
                return False
        with ThreadPoolExecutor(max_workers=2) as pool:
            result = list(pool.map(take, ("A", "C")))
        self.assertEqual(result.count(True), 1)

    def test_no_stealing_active_work_but_pending_result_does_not_stop_independent_work(self):
        claim_task(self.root, "B", "backend")
        before = (self.root / "controllers/work-board.json").read_bytes()
        with self.assertRaisesRegex(RuntimeError, "NO_CLAIMABLE"):
            claim_task(self.root, "C", "backend")
        self.assertEqual((self.root / "controllers/work-board.json").read_bytes(), before)
        claim_task(self.root, "B", "extension")
        validate_task_scope(self.root, "B", ["apps/api/src/auth.ts", "apps/extension/runtime.js"])

    def test_conflicting_paths_skip_but_independent_roadmap_continues(self):
        self.tasks.append(dict(self.tasks[0], id="same-file", role="C"))
        self.save()
        claim_task(self.root, "B", "backend")
        with self.assertRaisesRegex(RuntimeError, "NO_CLAIMABLE"):
            claim_task(self.root, "A", "same-file")
        event = claim_task(self.root, "A")
        self.assertEqual(event["task"], "extension")

    def test_parent_child_reservation_and_unknown_legacy_scope_fail_closed(self):
        for paths in (["apps/api"], None):
            self.tasks[0].update(state="IN_PROGRESS")
            if paths is None:
                self.tasks[0].pop("paths", None)
            else:
                self.tasks[0]["paths"] = paths
            self.tasks[1]["paths"] = ["apps/api/src/other.ts"]
            self.save()
            with self.assertRaisesRegex(RuntimeError, "NO_CLAIMABLE"):
                claim_task(self.root, "A", "extension")

    def test_stop_rejects_claim_and_scope_is_exact_even_with_broad_ownership(self):
        (self.root / "A.json").write_text('{"status":"STOPPED"}')
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            claim_task(self.root, "A", "backend")
        with self.assertRaisesRegex(RuntimeError, "TASK_SCOPE_VIOLATION"):
            validate_task_scope(self.root, "B", ["apps/api/src/auth.ts"])

    def test_other_roles_ready_task_prevents_waiting(self):
        with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
            assert_no_ready_work(self.root, "C")

    def test_operator_unavailable_or_no_manual_acceptance_does_not_gate_claim(self):
        (self.root / "operator").mkdir()
        (self.root / "operator/state.json").write_text('{"status":"PREPARED_NOT_STARTED","last_delivery_id":null}')
        event = claim_task(self.root, "C", "backend")
        self.assertEqual(event["state"], "IN_PROGRESS")
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["id"], "extension")

    def test_any_role_adds_approved_cross_component_result(self):
        task = dict(self.tasks[0], id="c-auth", role="C", basis="SPEC auth remainder")
        add_task(self.root, "C", task)
        self.assertEqual(load_board(self.root)["tasks"][-1]["plan"], "B04")
        for path in ["apps/site/index.ts", "tests/regression/imported/frozen.js"]:
            with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
                add_task(self.root, "C", dict(task, id="bad", paths=[path]))


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.head, self.base = "a" * 40, "b" * 40
        self.now = 10000
        self.ready = {"role": "A", "head": self.head, "base": self.base, "evidence": "tested exact package",
                      "ci": {"status": "PASS", "head": self.head, "branch": "work/a-extension", "checked_at": self.now,
                             "runs": [{"name": name, "status": "completed", "conclusion": "success"} for name in REQUIRED]}}
        (self.root / "A.json").write_text('{"status":"RUNNING"}')
        self.save()

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        (self.root / "main-ready-A.json").write_text(json.dumps(self.ready))

    def test_a_can_publish_and_receipt_not_shared_with_b(self):
        validate_main_receipt(self.root, "A", self.head, self.base, "work/a-extension", self.now)
        (self.root / "B.json").write_text('{"status":"RUNNING"}')
        with self.assertRaisesRegex(RuntimeError, "EXACT_ROLE"):
            validate_main_receipt(self.root, "B", self.head, self.base, "work/b-backend", self.now)

    def test_stop_after_ready_receipt_prevents_push(self):
        (self.root / "A.json").write_text('{"status":"STOPPED"}')
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            validate_main_receipt(self.root, "A", self.head, self.base, "work/a-extension", self.now)

    def test_stale_head_or_base_rejected(self):
        for head, base in [(self.base, self.base), (self.head, self.head)]:
            with self.assertRaisesRegex(RuntimeError, "EXACT_ROLE"):
                validate_main_receipt(self.root, "A", head, base, "work/a-extension", self.now)

    def test_missing_failed_stale_or_wrong_branch_ci_rejected(self):
        original = copy.deepcopy(self.ready)
        for change in (
            lambda d: d["ci"]["runs"].pop(),
            lambda d: d["ci"]["runs"][0].update(conclusion="failure"),
            lambda d: d["ci"].update(checked_at=self.now-1801),
            lambda d: d["ci"].update(branch="work/b-backend"),
            lambda d: d["ci"].update(head=self.base),
        ):
            self.ready = copy.deepcopy(original)
            change(self.ready)
            self.save()
            with self.assertRaisesRegex(RuntimeError, "MAIN_"):
                validate_main_receipt(self.root, "A", self.head, self.base, "work/a-extension", self.now)


if __name__ == "__main__":
    unittest.main()
