import argparse
import subprocess
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

import work_queue
from work_queue import load_board, role_work, assert_no_ready_work, advance_task, compact_state, board_snapshot, status_work, add_task, current_worktree_head
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

    def completion(self, task_id="b-auth", candidate_sha=None, verdict="PASS", review_verdict="PASS", check_verdict="PASS"):
        value = {
            "kind": "octoport.work-queue-completion", "version": 1,
            "task_id": task_id, "candidate_sha": candidate_sha or current_worktree_head(),
            "verdict": verdict,
            "review": {"verdict": review_verdict, "evidence": ["independent review record"]},
            "checks": [{"name": "focused checks", "verdict": check_verdict, "evidence": ["run record"]}],
        }
        self.receipt.write_text(json.dumps(value))
        return value

    def publication(
        self, candidate_sha=None, *, core_role="B", core_task_id="b-auth",
        core_paths=None, cleanup="DELETED", current_state="CLOSED",
        previous_state="PUBLISHED", close_state="PUBLISHED",
        ready_status="PASS", omit_run=None, duplicate_run_id=False,
    ):
        candidate = candidate_sha or ("c" * 40)
        task_paths = list(core_paths if core_paths is not None else ["apps/api/src/auth.ts"])
        task_ref = "refs/heads/controller/task-publication/b/b-auth/test"
        task_branch = "controller/task-publication/b/b-auth/test"
        live_task = next(row for row in self.board["tasks"] if row["id"] == "b-auth")
        live_task["state"] = "IN_PROGRESS"
        self.save()
        registered_task = dict(live_task)
        registered_task["state"] = "IN_PROGRESS"
        task_fingerprint = work_queue._publication_task_fingerprint(registered_task)
        review = {"path": str(self.root / "logs/review.json"), "sha256": "a" * 64}
        core = {
            "role": core_role,
            "task_id": core_task_id,
            "task_paths": task_paths,
            "changed_paths": task_paths,
            "candidate_head": candidate,
            "candidate_tree": "d" * 40,
            "base_sha": "e" * 40,
            "task_fingerprint": task_fingerprint,
            "review": review,
            "bundle_manifest_sha256": "1" * 64,
            "task_ref": task_ref,
            "task_branch": task_branch,
        }
        registration_id = work_queue._sha_bytes(work_queue._canonical_bytes(core))
        publication = self.root / "controllers/task-publication"
        ready_path = publication / "ready" / registration_id / "5.json"
        ready_path.parent.mkdir(parents=True, exist_ok=True)
        runs = [
            {"name": name, "id": index + 1, "status": "completed", "conclusion": "success"}
            for index, name in enumerate(work_queue.PUBLICATION_REQUIRED_CI)
            if name != omit_run
        ]
        if duplicate_run_id and len(runs) >= 2:
            runs[1]["id"] = runs[0]["id"]
        ready = {
            "kind": "octoport.task-publication-ready",
            "version": 1,
            "registration_id": registration_id,
            "registration_sha256": registration_id,
            "registration_state_version": 2,
            "task_id": core_task_id,
            "role": core_role,
            "task_fingerprint": core["task_fingerprint"],
            "candidate_head": candidate,
            "candidate_tree": core["candidate_tree"],
            "base_sha": core["base_sha"],
            "task_ref": task_ref,
            "task_branch": task_branch,
            "review": review,
            "bundle_manifest_sha256": core["bundle_manifest_sha256"],
            "ci": {
                "status": ready_status,
                "head": candidate,
                "branch": task_branch,
                "checked_at": 1,
                "runs": runs,
            },
            "created_at": "2026-10-02T00:00:00Z",
        }
        ready_raw = (json.dumps(ready, ensure_ascii=False, indent=2) + "\n").encode()
        ready_path.write_bytes(ready_raw)
        ready_descriptor = {
            "path": str(ready_path.resolve()),
            "sha256": hashlib.sha256(ready_raw).hexdigest(),
        }

        close_path = publication / "close" / registration_id / "receipt.json"
        close_path.parent.mkdir(parents=True, exist_ok=True)
        close = {
            "kind": "octoport.task-publication-close",
            "version": 1,
            "registration_id": registration_id,
            "state_before": close_state,
            "created_at": "2026-10-02T00:00:03Z",
        }
        close_raw = (json.dumps(close, ensure_ascii=False, indent=2) + "\n").encode()
        close_path.write_bytes(close_raw)
        close_descriptor = {
            "path": str(close_path.resolve()),
            "sha256": hashlib.sha256(close_raw).hexdigest(),
        }

        ready_state = {
            "kind": "octoport.task-publication-registration",
            "version": 1,
            "registration_id": registration_id,
            "registration_sha256": registration_id,
            "core": core,
            "state": "READY",
            "state_version": 2,
            "previous_state_sha256": "0" * 64,
            "ready_receipt": ready_descriptor,
            "task_ref_cleanup_status": None,
            "created_at": "2026-10-02T00:00:00Z",
            "updated_at": "2026-10-02T00:00:01Z",
        }
        history = publication / "states" / registration_id
        history.mkdir(parents=True, exist_ok=True)
        ready_state_raw = (json.dumps(ready_state, ensure_ascii=False, indent=2) + "\n").encode()
        (history / "2.json").write_bytes(ready_state_raw)

        previous = dict(ready_state)
        previous.update(
            state=previous_state,
            state_version=3,
            previous_state_sha256=hashlib.sha256(ready_state_raw).hexdigest(),
            task_ref_cleanup_status=cleanup,
            updated_at="2026-10-02T00:00:02Z",
        )
        previous_raw = (json.dumps(previous, ensure_ascii=False, indent=2) + "\n").encode()
        (history / "3.json").write_bytes(previous_raw)

        current = dict(previous)
        current.update(
            state=current_state,
            state_version=4,
            previous_state_sha256=hashlib.sha256(previous_raw).hexdigest(),
            close_receipt=close_descriptor,
            updated_at="2026-10-02T00:00:03Z",
        )
        current_raw = (json.dumps(current, ensure_ascii=False, indent=2) + "\n").encode()
        (history / "4.json").write_bytes(current_raw)
        registrations = publication / "registrations"
        registrations.mkdir(parents=True, exist_ok=True)
        (registrations / f"{registration_id}.json").write_bytes(current_raw)
        return registration_id, candidate

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

    def _prepare_new_sealed_resource_done(self):
        import hashlib

        record_path = self.root / "disk-task-completions/B--b-auth.json"
        record_path.parent.mkdir()
        record = {
            "version": 1, "role": "B", "task": "b-auth",
            "state": "SEALED", "history": [{"state": "SEALING"}, {"state": "SEALED"}],
        }
        raw = json.dumps(record, ensure_ascii=False).encode()
        record_path.write_bytes(raw)
        task = self.board["tasks"][0]
        task.update(
            state="DONE",
            completion_receipt=str(self.receipt),
            completion_receipt_format=1,
            completion_candidate_sha="a" * 40,
            completion_resource_required=True,
            completion_resource_seal_snapshot={
                "version": 1, "control_root":str(self.root.resolve()),
                "role":"B", "task_id":"b-auth",
                "seal_record_sha256":hashlib.sha256(raw).hexdigest(),
                "delegation_inventory_version":1,
                "delegation_inventory_attested":True,
                "foreign_allocation_count":0,
                "delegated_publication_registration":None,
            },
        )
        self.save()
        return task, record_path, record

    @staticmethod
    def _passing_strict_receipt():
        return {"verdict":"PASS", "review":{"verdict":"PASS"},
                "checks":[{"verdict":"PASS"}]}

    def test_new_done_requires_actual_sealed_resource_in_role_work_and_task_view(self):
        import work_queue

        task, path, record = self._prepare_new_sealed_resource_done()
        with patch.object(work_queue, "_completion_receipt", return_value=self._passing_strict_receipt()):
            self.assertIn("b-auth", work_queue._BoardEvaluation(self.board, root=self.root).done)
            self.assertNotIn("b-auth", work_queue._BoardEvaluation(self.board).done)
            self.assertEqual(next(x for x in role_work(self.root, "A")["tasks"]
                                  if x["id"] == "a-client")["state"], "READY")
            record["state"] = "SEALING"
            path.write_text(json.dumps(record))
            self.assertNotIn("b-auth", work_queue._BoardEvaluation(self.board, root=self.root).done)
            self.assertTrue(work_queue.task_view(self.board, task, root=self.root)["completion_invalidated"])
            self.assertEqual(next(x for x in role_work(self.root, "A")["tasks"]
                                  if x["id"] == "a-client")["state"], "BLOCKED")

    def test_new_sealed_done_rejects_forged_persisted_control_root(self):
        import work_queue

        task, _path, _record = self._prepare_new_sealed_resource_done()
        task["completion_resource_seal_snapshot"]["control_root"] = "/forged/untrusted"
        self.save()
        with patch.object(work_queue, "_completion_receipt", return_value=self._passing_strict_receipt()):
            self.assertNotIn("b-auth", work_queue._BoardEvaluation(self.board, root=self.root).done)
            self.assertEqual(next(x for x in role_work(self.root, "A")["tasks"]
                                  if x["id"] == "a-client")["state"], "BLOCKED")

    def test_historical_untagged_done_remains_accepted(self):
        import work_queue

        source = self.board["tasks"][0]
        source.update(state="DONE", completion_receipt=str(self.receipt),
                      completion_receipt_format=1, completion_candidate_sha="a" * 40)
        self.save()
        with patch.object(work_queue, "_completion_receipt", return_value=self._passing_strict_receipt()):
            self.assertIn("b-auth", work_queue._BoardEvaluation(self.board, root=self.root).done)
            self.assertEqual(next(x for x in role_work(self.root, "A")["tasks"]
                                  if x["id"] == "a-client")["state"], "READY")

    def test_installed_resource_lock_disallows_direct_unguarded_done(self):
        (self.root / "resource-admission.lock").touch()
        initial = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_RESOURCE_GUARD_REQUIRED"):
            advance_task(self.root, "B", "b-auth", "DONE", str(self.receipt))
        self.assertEqual(self.path.read_bytes(), initial)

    def _r7_real_v2_initial_generation(self, root):
        """Create native V2 disk files only in the caller's admitted test root."""
        import hashlib
        import work_queue

        v2 = work_queue._v2()
        (root / "controllers").mkdir(parents=True)
        (root / "logs").mkdir()
        for role in "ABC":
            (root / (role + ".json")).write_text(json.dumps({
                "role": role, "status": "RUNNING",
            }))
        board = copy.deepcopy(self.board)
        board.update(revision=4, updated_at="2026-10-08T00:00:00+00:00")
        before_raw = (json.dumps(board, ensure_ascii=False, indent=2) + "\n").encode()
        (root / "controllers/work-board.json").write_bytes(before_raw)
        generated = v2.build_generation_from_v1(root, board)
        v2._paths(root, create=True)
        v2._write_drafts(root, generated["drafts"])
        core = generated["core"]
        hot = dict(core, generation_id=v2._generation_id(core),
                   last_operation_id="0" * 64)
        original_sha = hashlib.sha256(before_raw).hexdigest()
        migration_id = v2._semantic_sha({
            "schema_version": 1,
            "pre_v1_sha256": original_sha,
            "new_generation_id": hot["generation_id"],
            "authority_id": "C00-R7-ISOLATED-NATIVE-UNIT-NO_LIVE_AUTH",
        })
        _opid, candidate, tx = v2._make_migration_tx(
            original_sha, board["revision"], hot, v2._canonical_bytes(hot),
            migration_id,
        )
        tx["state"] = "COMMITTED"
        v2._write_journal(root, tx, initial=True)
        v2.install_hot_generation(root, candidate)
        self.assertEqual(v2.load_state(root)["logical"]["revision"], 4)
        return v2, board

    def test_r7_real_child_sigkill_v2_recovery_is_journal_certified(self):
        """Bounded kill of disposable child only, then independent V2 recovery."""
        import fcntl
        import hashlib
        import os
        import signal
        import subprocess
        import sys
        import disk_lifecycle
        import work_queue

        v2_faults = (
            ("after_data_durable", "ROLLED_BACK"),
            ("after_hot_replace_before_hot_published", "COMMITTED"),
        )
        # Child obtains the genuine native locks and commits with R7's
        # resource-aware queue writer. The injected process kills ITSELF.
        child_source = """
import hashlib, json, os, signal, sys
from contextlib import contextmanager
from pathlib import Path
from unittest.mock import patch
import disk_lifecycle, work_queue

root = Path(sys.argv[1])
point = sys.argv[2]
receipt = root / 'logs/b-auth-pass.json'
reg = disk_lifecycle.Registry(root)
@contextmanager
def resource_completion(previous, task):
    if previous != 'READY' or task.get('id') != 'b-auth':
        raise RuntimeError('UNEXPECTED_TEST_TASK_STATE')
    reg.record_completion_state('B', 'b-auth', 'SEALING')
    reg.record_completion_state('B', 'b-auth', 'SEALED')
    seal = reg.completion_path('B', 'b-auth')
    task.update(
        completion_resource_required=True,
        completion_resource_seal_snapshot={
            'version': 1, 'control_root': str(root.resolve()),
            'role': 'B', 'task_id': 'b-auth',
            'seal_record_sha256': hashlib.sha256(seal.read_bytes()).hexdigest(),
            'delegation_inventory_version': 1,
            'delegation_inventory_attested': True,
            'foreign_allocation_count': 0,
            'delegated_publication_registration': None,
        },
    )
    yield
def terminate_only_this_child(at):
    if at == point:
        os.kill(os.getpid(), signal.SIGKILL)
with patch.object(work_queue._v2(), '_fault',
                  side_effect=terminate_only_this_child):
    work_queue.advance_task(
        root, 'B', 'b-auth', 'DONE', str(receipt),
        completion_guard=resource_completion,
        resource_lock=reg.locked,
    )
raise RuntimeError('EXPECTED_SIGKILL_WAS_NOT_TRIGGERED')
"""
        for point, expected in v2_faults:
            with self.subTest(point=point):
                root = self.root / ("r7-sigkill-" + point)
                v2, initial = self._r7_real_v2_initial_generation(root)
                receipt = root / "logs/b-auth-pass.json"
                receipt.write_text(json.dumps({
                    "kind": work_queue.COMPLETION_KIND, "version": 1,
                    "task_id": "b-auth",
                    "candidate_sha": work_queue.current_worktree_head(),
                    "verdict": "PASS",
                    "review": {"verdict": "PASS", "evidence": ["isolated"]},
                    "checks": [{
                        "name": "native-kill", "verdict": "PASS",
                        "evidence": ["disposable-process-only"],
                    }],
                }))
                environment = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
                execution = subprocess.run(
                    [sys.executable, "-B", "-c", child_source, str(root), point],
                    cwd=str(Path(work_queue.__file__).resolve().parent),
                    env=environment, capture_output=True, text=True, timeout=10,
                )
                self.assertEqual(execution.returncode, -signal.SIGKILL,
                                 execution.stderr[-300:])
                reg = disk_lifecycle.Registry(root)
                seal = reg.completion_path("B", "b-auth")
                self.assertEqual(reg.completion_record("B", "b-auth")["state"],
                                 "SEALED")
                seal_sha = hashlib.sha256(seal.read_bytes()).hexdigest()
                with (root / "B.lock").open("a+") as role_lock:
                    fcntl.flock(role_lock, fcntl.LOCK_EX)
                    with (root / "controllers/coordination.lock").open("a+") as cl:
                        fcntl.flock(cl, fcntl.LOCK_EX)
                        with reg.locked():
                            result = v2.recover_queue_transaction(root)
                self.assertIsNotNone(result)
                self.assertEqual(result["state"], expected)
                board = work_queue.load_board(root)
                self.assertEqual(
                    board["revision"], initial["revision"] + int(expected == "COMMITTED"))
                done = work_queue._BoardEvaluation(board, root=root).done
                self.assertEqual("b-auth" in done, expected == "COMMITTED")
                consumer = next(
                    row for row in work_queue.role_work(root, "A")["tasks"]
                    if row["id"] == "a-client")
                self.assertEqual(
                    consumer["state"], "READY" if expected == "COMMITTED" else "BLOCKED")
                self.assertEqual(hashlib.sha256(seal.read_bytes()).hexdigest(),
                                 seal_sha)
                events = root / "controllers/work-board-events.jsonl"
                before = len(events.read_bytes().splitlines()) if events.exists() else 0
                self.assertEqual(before, int(expected == "COMMITTED"))
                with (root / "B.lock").open("a+") as role_lock:
                    fcntl.flock(role_lock, fcntl.LOCK_EX)
                    with (root / "controllers/coordination.lock").open("a+") as cl:
                        fcntl.flock(cl, fcntl.LOCK_EX)
                        with reg.locked():
                            self.assertIsNone(v2.recover_queue_transaction(root))
                after = len(events.read_bytes().splitlines()) if events.exists() else 0
                self.assertEqual(after, before)

    def test_r7_actual_v2_fault_points_preserve_seal_and_exact_recovery(self):
        """Actual on-disk V2 journaling; not a simulated process/power loss."""
        import fcntl
        import hashlib
        from contextlib import contextmanager
        import disk_lifecycle
        import work_queue

        class InjectedCrash(BaseException):
            pass

        points = (
            ("after_prepared", "ROLLED_BACK"),
            ("after_data_durable", "ROLLED_BACK"),
            ("after_hot_replace_before_hot_published", "COMMITTED"),
            ("after_event_append_before_event_durable", "COMMITTED"),
            ("after_event_durable_before_commit", "COMMITTED"),
        )
        for point, expected in points:
            with self.subTest(point=point):
                root = self.root / ("r7-native-" + point)
                v2, baseline = self._r7_real_v2_initial_generation(root)
                receipt = root / "logs" / "b-auth-pass.json"
                receipt.write_text(json.dumps({
                    "kind": work_queue.COMPLETION_KIND, "version": 1,
                    "task_id": "b-auth",
                    "candidate_sha": work_queue.current_worktree_head(),
                    "verdict": "PASS",
                    "review": {"verdict": "PASS", "evidence": ["isolated"]},
                    "checks": [{
                        "name": "isolated-v2", "verdict": "PASS",
                        "evidence": ["actual disk"],
                    }],
                }))
                reg = disk_lifecycle.Registry(root)

                @contextmanager
                def completion_guard(previous, task):
                    self.assertEqual(previous, "READY")
                    self.assertEqual(task["id"], "b-auth")
                    reg.record_completion_state("B", "b-auth", "SEALING")
                    reg.record_completion_state("B", "b-auth", "SEALED")
                    seal = reg.completion_path("B", "b-auth")
                    task.update(
                        completion_resource_required=True,
                        completion_resource_seal_snapshot={
                            "version": 1,
                            "control_root": str(root.resolve()),
                            "role": "B",
                            "task_id": "b-auth",
                            "seal_record_sha256": hashlib.sha256(
                                seal.read_bytes()).hexdigest(),
                            "delegation_inventory_version": 1,
                            "delegation_inventory_attested": True,
                            "foreign_allocation_count": 0,
                            "delegated_publication_registration": None,
                        },
                    )
                    yield

                def inject(at):
                    if at == point:
                        raise InjectedCrash(point)

                with patch.object(v2, "_fault", side_effect=inject):
                    with self.assertRaises(InjectedCrash):
                        work_queue.advance_task(
                            root, "B", "b-auth", "DONE", str(receipt),
                            completion_guard=completion_guard,
                            resource_lock=reg.locked,
                        )
                seal = reg.completion_path("B", "b-auth")
                seal_sha = hashlib.sha256(seal.read_bytes()).hexdigest()
                self.assertEqual(reg.completion_record("B", "b-auth")["state"],
                                 "SEALED")
                with self.assertRaisesRegex(
                    ValueError, "TASK_DISK_LIFECYCLE_ALREADY_COMPLETED"
                ):
                    reg.require_task_not_completed("B", "b-auth")

                with (root / "B.lock").open("a+") as role_lock:
                    fcntl.flock(role_lock, fcntl.LOCK_EX)
                    with (root / "controllers/coordination.lock").open("a+") as coord_lock:
                        fcntl.flock(coord_lock, fcntl.LOCK_EX)
                        with reg.locked():
                            tx = v2.recover_queue_transaction(root)
                self.assertIsNotNone(tx)
                self.assertEqual(tx["state"], expected)
                post = work_queue.load_board(root)
                self.assertEqual(post["revision"],
                                 baseline["revision"] + int(expected == "COMMITTED"))
                producer = next(x for x in post["tasks"] if x["id"] == "b-auth")
                self.assertEqual(producer["state"],
                                 "DONE" if expected == "COMMITTED" else "READY")
                evaluated = work_queue._BoardEvaluation(post, root=root)
                self.assertEqual("b-auth" in evaluated.done,
                                 expected == "COMMITTED")
                consumer = next(x for x in work_queue.role_work(root, "A")["tasks"]
                                if x["id"] == "a-client")
                self.assertEqual(consumer["state"],
                                 "READY" if expected == "COMMITTED" else "BLOCKED")
                self.assertEqual(hashlib.sha256(seal.read_bytes()).hexdigest(),
                                 seal_sha)
                if expected == "COMMITTED":
                    # Completed V2 journal does not override a broken seal:
                    # actual rooted consumers must quarantine the dependent.
                    true_record = seal.read_bytes()
                    tampered = json.loads(true_record)
                    tampered["state"] = "SEALING"
                    seal.write_text(json.dumps(tampered))
                    invalid = work_queue.load_board(root)
                    self.assertNotIn(
                        "b-auth", work_queue._BoardEvaluation(invalid, root=root).done)
                    dependent = next(
                        x for x in work_queue.role_work(root, "A")["tasks"]
                        if x["id"] == "a-client")
                    self.assertEqual(dependent["state"], "BLOCKED")
                    seal.write_bytes(true_record)
                    self.assertIn(
                        "b-auth", work_queue._BoardEvaluation(
                            work_queue.load_board(root), root=root).done)
                events = root / "controllers/work-board-events.jsonl"
                count = len(events.read_bytes().splitlines()) if events.exists() else 0
                self.assertEqual(count, int(expected == "COMMITTED"))
                with (root / "B.lock").open("a+") as role_lock:
                    fcntl.flock(role_lock, fcntl.LOCK_EX)
                    with (root / "controllers/coordination.lock").open("a+") as coord_lock:
                        fcntl.flock(coord_lock, fcntl.LOCK_EX)
                        with reg.locked():
                            self.assertIsNone(v2.recover_queue_transaction(root))
                count_again = (len(events.read_bytes().splitlines())
                               if events.exists() else 0)
                self.assertEqual(count_again, count)

    def test_real_v2_foreign_sealed_rework_cannot_commit_in_progress(self):
        """A broken DONE proof never turns a foreign SEALED lease into WIP."""
        from contextlib import contextmanager
        import disk_lifecycle
        import work_queue

        root = self.root / "p2-real-v2-foreign-rework"
        v2, _baseline = self._r7_real_v2_initial_generation(root)
        reg = disk_lifecycle.Registry(root)
        passed = root / "logs/b-auth-pass.json"
        candidate_sha = work_queue.current_worktree_head()
        passed.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND, "version": 1,
            "task_id": "b-auth", "candidate_sha": candidate_sha,
            "verdict": "PASS",
            "review": {"verdict": "PASS", "evidence": ["disposable"]},
            "checks": [{"name": "native", "verdict": "PASS", "evidence": ["isolated"]}],
        }))

        @contextmanager
        def sealed_done(previous, updated):
            self.assertEqual(previous, "READY")
            reg.record_completion_state("B", "b-auth", "SEALING")
            reg.record_completion_state("B", "b-auth", "SEALED")
            seal = reg.completion_path("B", "b-auth")
            updated.update(
                completion_resource_required=True,
                completion_resource_seal_snapshot={
                    "version": 1, "control_root": str(root.resolve()),
                    "role": "B", "task_id": "b-auth",
                    "seal_record_sha256": hashlib.sha256(
                        seal.read_bytes()
                    ).hexdigest(),
                    "delegation_inventory_version": 1,
                    "delegation_inventory_attested": True,
                    "foreign_allocation_count": 0,
                    "delegated_publication_registration": None,
                },
            )
            yield

        work_queue.advance_task(
            root, "B", "b-auth", "DONE", str(passed),
            completion_guard=sealed_done, resource_lock=reg.locked,
        )
        self.assertIn(
            "b-auth", work_queue._BoardEvaluation(
                work_queue.load_board(root), root=root
            ).done,
        )

        # A valid JSON completion record with changed bytes invalidates
        # the old snapshot. The record is still SEALED, so ordinary rework
        # must NOT clear it or persist an inconsistent IN_PROGRESS row.
        seal = reg.completion_path("B", "b-auth")
        seal.write_bytes(seal.read_bytes() + b" ")
        self.assertEqual(reg.completion_record("B", "b-auth")["state"], "SEALED")
        self.assertNotIn(
            "b-auth", work_queue._BoardEvaluation(
                work_queue.load_board(root), root=root
            ).done,
        )
        negative = root / "logs/b-auth-rework.json"
        negative.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND, "version": 1,
            "task_id": "b-auth", "candidate_sha": candidate_sha,
            "verdict": "REWORK_REQUIRED",
            "review": {"verdict": "REWORK_REQUIRED", "evidence": ["broken seal"]},
            "checks": [{"name": "seal", "verdict": "FAIL", "evidence": ["bytes changed"]}],
        }))

        controllers = root / "controllers"
        before = {
            str(p.relative_to(controllers)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in controllers.rglob("*") if p.is_file()
        }
        journal = v2.load_state(root)["logical"]
        revision = journal["revision"]
        with patch.object(
            disk_lifecycle.Registry, "rows",
            return_value=[{"task": "b-auth", "role": "CONTROLLER"}],
        ):
            with self.assertRaisesRegex(
                RuntimeError, "CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED"
            ):
                control.advance_queue_task(
                    "B", "b-auth", "IN_PROGRESS", str(negative),
                    "reviewed rework", control_root=root,
                )
        after = {
            str(p.relative_to(controllers)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in controllers.rglob("*") if p.is_file()
        }
        self.assertEqual(after, before)
        current = work_queue.load_board(root)
        self.assertEqual(current["revision"], revision)
        task = next(x for x in current["tasks"] if x["id"] == "b-auth")
        self.assertEqual(task["state"], "DONE")
        self.assertEqual(reg.completion_record("B", "b-auth")["state"], "SEALED")

    def test_native_resource_lock_also_guards_mutating_v2_recovery(self):
        from contextlib import contextmanager
        import work_queue
        import fcntl

        resource_held = {"value": False, "recover_called": False}

        @contextmanager
        def resource_lock():
            for lock_name in ("B.lock", "controllers/coordination.lock"):
                with (self.root / lock_name).open("a+") as lock:
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            resource_held["value"] = True
            try:
                yield
            finally:
                resource_held["value"] = False

        def mutating_recovery(_control):
            self.assertTrue(resource_held["value"])
            resource_held["recover_called"] = True

        with patch.object(work_queue, "_prepare_storage_write", side_effect=mutating_recovery):
            advance_task(self.root, "B", "b-auth", "IN_PROGRESS", resource_lock=resource_lock)
        self.assertTrue(resource_held["recover_called"])
        self.assertFalse(resource_held["value"])

    def test_resource_lock_refusal_aborts_before_v2_recovery(self):
        from contextlib import contextmanager
        import work_queue

        @contextmanager
        def no_admission():
            raise RuntimeError("RESOURCE_LOCK_UNAVAILABLE")
            yield  # pragma: no cover - generator context

        before = self.path.read_bytes()
        with patch.object(work_queue, "_prepare_storage_write") as recover:
            with self.assertRaisesRegex(RuntimeError, "RESOURCE_LOCK_UNAVAILABLE"):
                advance_task(self.root, "B", "b-auth", "IN_PROGRESS", resource_lock=no_admission)
            recover.assert_not_called()
        self.assertEqual(self.path.read_bytes(), before)

    def test_completion_guard_requires_preflight_resource_lock_pair(self):
        from contextlib import contextmanager

        @contextmanager
        def late_only(_previous, _task):
            yield

        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_RESOURCE_LOCK_REQUIRED_BEFORE_RECOVERY"):
            advance_task(self.root, "B", "b-auth", "IN_PROGRESS", completion_guard=late_only)
        self.assertEqual(self.path.read_bytes(), before)

    def test_completion_guard_lock_order_and_no_premature_commit(self):
        from contextlib import contextmanager, nullcontext
        import fcntl

        transitions = []

        @contextmanager
        def native_guard(previous_state, updated):
            self.assertEqual(previous_state, "READY")
            self.assertEqual(updated["id"], "b-auth")
            for lock_name in ("B.lock", "controllers/coordination.lock"):
                with (self.root / lock_name).open("a+") as lock:
                    # A second descriptor cannot take the same flock while
                    # native advance_task holds its role / coordination lock.
                    with self.assertRaises(BlockingIOError):
                        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            transitions.append("RESOURCE_GUARD_ENTERED")
            yield
            transitions.append("RESOURCE_GUARD_EXITED")

        result = advance_task(
            self.root, "B", "b-auth", "IN_PROGRESS",
            completion_guard=native_guard, resource_lock=nullcontext,
        )
        self.assertEqual(transitions, [
            "RESOURCE_GUARD_ENTERED", "RESOURCE_GUARD_EXITED",
        ])
        self.assertEqual(
            next(x for x in load_board(self.root)["tasks"] if x["id"] == "b-auth")["state"],
            "IN_PROGRESS",
        )
        self.assertIsInstance(result, dict)

    def test_completion_guard_failure_prevents_board_commit(self):
        from contextlib import contextmanager, nullcontext

        @contextmanager
        def denied_guard(_previous, _updated):
            raise RuntimeError("RESOURCE_ATTESTATION_FAIL_CLOSED")
            yield  # pragma: no cover - contextmanager shape only

        initial = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "RESOURCE_ATTESTATION_FAIL_CLOSED"):
            advance_task(
                self.root, "B", "b-auth", "IN_PROGRESS",
                completion_guard=denied_guard, resource_lock=nullcontext,
            )
        self.assertEqual(self.path.read_bytes(), initial)

    def test_completion_releases_consumer_without_controller(self):
        self.assertEqual(next(t for t in role_work(self.root, "A")["tasks"] if t["id"] == "a-client")["state"], "BLOCKED")
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        self.completion()
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

    def test_expected_task_mismatch_leaves_board_and_events_unchanged(self):
        expected = copy.deepcopy(self.board["tasks"][0])
        expected["result"] = "stale task snapshot"
        events = self.root / "controllers/work-board-events.jsonl"
        before_board = self.path.read_bytes()
        before_events = events.read_bytes() if events.exists() else None
        with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_TASK_DRIFT"):
            advance_task(self.root, "B", "b-auth", "IN_PROGRESS", expected_task=expected)
        self.assertEqual(self.path.read_bytes(), before_board)
        self.assertEqual(events.read_bytes() if events.exists() else None, before_events)

    def test_valid_paths_accepts_literal_next_dynamic_segments(self):
        self.assertTrue(work_queue.valid_paths([
            "apps/portal/app/api/control-plane/[...path]/route.test.ts",
            "apps/portal/app/[lang]/[[...slug]]/page.tsx",
        ]))
        for invalid in [
            "apps/portal/app/api/control-plane/*/route.test.ts",
            "apps/portal/app/api/control-plane/[...path/route.test.ts",
            "apps/portal/app/api/control-plane/[path]]/route.test.ts",
            "apps/portal/app/api/control-plane/pre[path]/route.test.ts",
            "apps/portal/app/api/control-plane/[?path]/route.test.ts",
        ]:
            with self.subTest(path=invalid):
                self.assertFalse(work_queue.valid_paths([invalid]))

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

    def test_completion_requires_strict_pass_and_rejects_ambiguous_verdicts(self):
        candidates = [
            "{",  # malformed JSON
            json.dumps({"status": "PASS", "result": "contains PASS"}),
        ]
        for bad_version in (True, 1.0, "1"):
            candidates.append(json.dumps({
                "kind": "octoport.work-queue-completion", "version": bad_version,
                "task_id": "b-auth", "candidate_sha": current_worktree_head(),
                "verdict": "PASS",
                "review": {"verdict": "PASS", "evidence": ["review"]},
                "checks": [{"name": "unit", "verdict": "PASS", "evidence": ["run"]}],
            }))
        for verdict, review, check in [("FAIL", "PASS", "PASS"),
                                       ("REWORK_REQUIRED", "PASS", "PASS"),
                                       ("PASS", "PASSING", "PASS"),
                                       ("PASS", "PASS", "NOT_PASS")]:
            candidates.append(json.dumps({
                "kind": "octoport.work-queue-completion", "version": 1,
                "task_id": "b-auth", "candidate_sha": current_worktree_head(),
                "verdict": verdict,
                "review": {"verdict": review, "evidence": ["review"]},
                "checks": [{"name": "unit", "verdict": check, "evidence": ["run"]}],
            }))
        for raw in candidates:
            with self.subTest(receipt=raw):
                self.receipt.write_text(raw)
                advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
                before = self.path.read_bytes()
                with self.assertRaisesRegex(RuntimeError, "STRICT_PASS_RECEIPT_REQUIRED"):
                    advance_task(self.root, "B", "b-auth", "DONE", str(self.receipt))
                self.assertEqual(self.path.read_bytes(), before)
                self.board = json.loads(before)
                self.board["tasks"][0]["state"] = "READY"
                self.save()


    def test_strict_done_rejects_non_integer_format_marker(self):
        self.completion()
        receipt = str(self.receipt.resolve())
        for marker in (True, 1.0, "1"):
            with self.subTest(marker=marker):
                board = copy.deepcopy(self.board)
                board["tasks"][0].update(
                    state="DONE", completion_receipt=receipt,
                    completion_receipt_format=marker,
                    completion_candidate_sha=current_worktree_head(),
                )
                self.path.write_text(json.dumps(board))
                consumer = next(t for t in role_work(self.root, "A")["tasks"] if t["id"] == "a-client")
                self.assertEqual(consumer["state"], "BLOCKED")
                own = next(t for t in role_work(self.root, "B")["tasks"] if t["id"] == "b-auth")
                self.assertTrue(own["completion_invalidated"])
        self.save()

    def test_completion_receipt_is_bound_to_task_and_candidate(self):
        for task_id, candidate in [("other-task", current_worktree_head()),
                                   ("b-auth", "f" * 40)]:
            with self.subTest(task_id=task_id, candidate=candidate):
                self.completion(task_id=task_id, candidate_sha=candidate)
                advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
                with self.assertRaisesRegex(RuntimeError, "STRICT_PASS_RECEIPT_REQUIRED"):
                    advance_task(self.root, "B", "b-auth", "DONE", str(self.receipt))
                self.board = json.loads(self.path.read_text())
                self.board["tasks"][0]["state"] = "READY"
                self.save()

    def test_isolated_publication_done_uses_closed_published_candidate(self):
        registration, candidate = self.publication()
        self.completion(candidate_sha=candidate)
        advance_task(
            self.root, "B", "b-auth", "DONE", str(self.receipt),
            publication_registration=registration,
        )
        task = next(row for row in load_board(self.root)["tasks"] if row["id"] == "b-auth")
        self.assertEqual(task["completion_candidate_sha"], candidate)
        self.assertNotEqual(candidate, current_worktree_head())
        self.assertEqual(task["completion_publication_registration"], registration)
        self.assertEqual(task["completion_publication_snapshot"]["task_ref_cleanup_status"], "DELETED")
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "READY")

    def test_isolated_publication_done_allows_truthful_blocked_finalization_state(self):
        registration, candidate = self.publication()
        blocker = self.root / "logs/blocker.json"
        blocker.write_text('{"reason":"post-publication finalization"}')
        advance_task(self.root, "B", "b-auth", "BLOCKED", str(blocker), "post-publication finalization")
        self.completion(candidate_sha=candidate)
        advance_task(
            self.root, "B", "b-auth", "DONE", str(self.receipt),
            publication_registration=registration,
        )
        task = next(row for row in load_board(self.root)["tasks"] if row["id"] == "b-auth")
        self.assertEqual(task["state"], "DONE")
        self.assertEqual(task["completion_candidate_sha"], candidate)

    def test_isolated_publication_done_rejects_post_registration_result_drift(self):
        registration, candidate = self.publication()
        self.board = json.loads(self.path.read_text())
        task = next(row for row in self.board["tasks"] if row["id"] == "b-auth")
        task["result"] = "Changed acceptance outcome after publication"
        self.save()
        self.completion(candidate_sha=candidate)
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "PUBLICATION_TASK_BINDING_INVALID"):
            advance_task(
                self.root, "B", "b-auth", "DONE", str(self.receipt),
                publication_registration=registration,
            )
        self.assertEqual(self.path.read_bytes(), before)

    def test_isolated_publication_registration_is_done_only(self):
        registration, _candidate = self.publication()
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "PUBLICATION_COMPLETION_DONE_ONLY"):
            advance_task(
                self.root, "B", "b-auth", "IN_PROGRESS",
                publication_registration=registration,
            )
        self.assertEqual(self.path.read_bytes(), before)

    def test_isolated_publication_completion_rejects_untrusted_evidence(self):
        cases = [
            ("registration-not-closed", {"current_state": "REVOKED"}, "REGISTRATION"),
            ("predecessor-not-published", {"previous_state": "REVOKED"}, "STATE_CHAIN"),
            ("wrong-task", {"core_task_id": "other-task"}, "TASK_BINDING"),
            ("wrong-role", {"core_role": "A"}, "TASK_BINDING"),
            ("wrong-paths", {"core_paths": ["apps/api/src/other.ts"]}, "TASK_BINDING"),
            ("foreign-ref", {"cleanup": "FOREIGN_RETAINED"}, "TASK_BINDING"),
            ("ci-blocked", {"ready_status": "BLOCKED"}, "READY"),
            ("ci-missing", {"omit_run": "Server CI"}, "READY"),
            ("ci-duplicate-run-id", {"duplicate_run_id": True}, "READY"),
            ("close-not-published", {"close_state": "REVOKED"}, "CLOSE"),
        ]
        for name, options, error in cases:
            with self.subTest(name=name):
                registration, candidate = self.publication(**options)
                self.completion(candidate_sha=candidate)
                before = self.path.read_bytes()
                with self.assertRaisesRegex(RuntimeError, f"PUBLICATION_.*{error}|PUBLICATION_{error}"):
                    advance_task(
                        self.root, "B", "b-auth", "DONE", str(self.receipt),
                        publication_registration=registration,
                    )
                self.assertEqual(self.path.read_bytes(), before)

    def test_isolated_publication_snapshot_tamper_invalidates_done_without_breaking_board(self):
        registration, candidate = self.publication()
        self.completion(candidate_sha=candidate)
        advance_task(
            self.root, "B", "b-auth", "DONE", str(self.receipt),
            publication_registration=registration,
        )
        board = load_board(self.root)
        task = next(row for row in board["tasks"] if row["id"] == "b-auth")
        task["completion_publication_snapshot"]["candidate_sha"] = "9" * 40
        self.board = board
        self.save()
        own = next(row for row in role_work(self.root, "B")["tasks"] if row["id"] == "b-auth")
        self.assertTrue(own["completion_invalidated"])
        consumer = next(row for row in role_work(self.root, "A")["tasks"] if row["id"] == "a-client")
        self.assertEqual(consumer["state"], "BLOCKED")

    def test_isolated_publication_evidence_tamper_after_done_invalidates_completion(self):
        registration, candidate = self.publication()
        self.completion(candidate_sha=candidate)
        advance_task(
            self.root, "B", "b-auth", "DONE", str(self.receipt),
            publication_registration=registration,
        )
        task = next(row for row in load_board(self.root)["tasks"] if row["id"] == "b-auth")
        snapshot = task["completion_publication_snapshot"]
        publication = self.root / "controllers/task-publication"
        evidence = [
            ("ready", Path(snapshot["ready_receipt"])),
            ("close", Path(snapshot["close_receipt"])),
            ("registration", publication / "registrations" / f"{registration}.json"),
            ("closed-state", publication / "states" / registration / "4.json"),
            ("published-state", publication / "states" / registration / "3.json"),
        ]
        for name, path in evidence:
            with self.subTest(name=name):
                accepted = path.read_bytes()
                if name == "ready":
                    path.unlink()
                else:
                    path.write_bytes(accepted + b" ")
                own = next(row for row in role_work(self.root, "B")["tasks"] if row["id"] == "b-auth")
                self.assertTrue(own["completion_invalidated"])
                consumer = next(row for row in role_work(self.root, "A")["tasks"] if row["id"] == "a-client")
                self.assertEqual(consumer["state"], "BLOCKED")
                path.write_bytes(accepted)
                consumer = next(row for row in role_work(self.root, "A")["tasks"] if row["id"] == "a-client")
                self.assertEqual(consumer["state"], "READY")

    def test_publication_bound_successor_evidence_tamper_realerts_resolved_blocker(self):
        blocked_receipt = self.root / "logs/old-blocked-publication.json"
        blocked_receipt.write_text('{"reason":"superseded"}')
        old = {
            "id": "old-attempt", "role": "B", "plan": "B04", "state": "BLOCKED",
            "requires": [], "result": "Historical attempt", "paths": ["tooling/old.py"],
            "blocked_reason": "Superseded", "blocked_receipt": str(blocked_receipt),
        }
        self.board["tasks"].insert(0, old)
        self.save()
        registration, candidate = self.publication()
        self.completion(candidate_sha=candidate)
        advance_task(
            self.root, "B", "b-auth", "DONE", str(self.receipt),
            publication_registration=registration,
        )
        work_queue.resolve_blocker(self.root, "B", "old-attempt", "b-auth", str(self.receipt))
        board = load_board(self.root)
        self.assertFalse(any(row["task_id"] == "old-attempt" for row in work_queue.blocker_attention(board)))
        successor = next(row for row in board["tasks"] if row["id"] == "b-auth")
        ready = Path(successor["completion_publication_snapshot"]["ready_receipt"])
        accepted = ready.read_bytes()
        ready.unlink()
        stale = role_work(self.root, "B")
        old_view = next(row for row in stale["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(old_view["resolution_status"], "STALE_RESOLUTION")
        alert = next(row for row in stale["owner_attention"] if row["task_id"] == "old-attempt")
        self.assertEqual(alert["resolution_status"], "STALE_RESOLUTION")
        ready.write_bytes(accepted)

    def test_later_negative_receipt_stops_satisfying_dependencies(self):
        self.completion()
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        advance_task(self.root, "B", "b-auth", "DONE", str(self.receipt))
        self.completion(verdict="REWORK_REQUIRED", review_verdict="REWORK_REQUIRED")
        consumer = next(t for t in role_work(self.root, "A")["tasks"] if t["id"] == "a-client")
        self.assertEqual(consumer["state"], "BLOCKED")
        self.assertEqual(consumer["waiting_for"], ["b-auth"])
        with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
            assert_no_ready_work(self.root, "B")

    def test_invalidated_completion_reopens_with_negative_receipt_and_history(self):
        self.completion()
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        advance_task(self.root, "B", "b-auth", "DONE", str(self.receipt))
        original_path = str(self.receipt.resolve())
        self.completion(verdict="FAIL", review_verdict="FAIL", check_verdict="FAIL")
        with self.assertRaisesRegex(RuntimeError, "REOPEN_REWORK_RECEIPT_REQUIRED"):
            advance_task(self.root, "B", "b-auth", "IN_PROGRESS", str(self.receipt))
        self.receipt = self.root / "logs/rework.json"
        self.completion(task_id="b-auth", verdict="REWORK_REQUIRED", review_verdict="REWORK_REQUIRED")
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS", str(self.receipt))
        task = load_board(self.root)["tasks"][0]
        self.assertEqual(task["state"], "IN_PROGRESS")
        self.assertEqual(task["completion_receipt"], original_path)
        self.assertEqual(task["completion_history"][0]["receipt"], original_path)
        self.assertEqual(task["completion_history"][0]["format"], 1)
        self.assertEqual(task["completion_history"][0]["receipt_snapshot"]["verdict"], "PASS")
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["waiting_for"], ["b-auth"])

    def test_legacy_done_receipt_remains_historical_and_satisfies_dependency(self):
        self.receipt.write_text('{"result":"legacy source-only receipt"}')
        self.board["tasks"][0].update(state="DONE", completion_receipt=str(self.receipt.resolve()))
        self.save()
        consumer = next(t for t in role_work(self.root, "A")["tasks"] if t["id"] == "a-client")
        self.assertEqual(consumer["state"], "READY")
        self.assertNotIn("completion_receipt_format", load_board(self.root)["tasks"][0])

    def test_legacy_done_can_be_explicitly_reopened_with_history(self):
        self.receipt.write_text('{"result":"legacy source-only receipt"}')
        old_path = str(self.receipt.resolve())
        self.board["tasks"][0].update(state="DONE", completion_receipt=old_path)
        self.save()
        self.receipt = self.root / "logs/legacy-rework.json"
        self.completion(verdict="REWORK_REQUIRED", review_verdict="REWORK_REQUIRED")
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS", str(self.receipt))
        task = load_board(self.root)["tasks"][0]
        self.assertEqual(task["state"], "IN_PROGRESS")
        self.assertEqual(task["completion_receipt"], old_path)
        self.assertEqual(task["completion_history"][0]["receipt"], old_path)

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

    def test_v1_exact_byte_cap_accepts_262144_and_rejects_262145(self):
        board = copy.deepcopy(self.board)
        board["tasks"] = [copy.deepcopy(board["tasks"][0])]
        board["tasks"][0]["result"] = "x"
        current = len(
            (json.dumps(board, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        )
        board["tasks"][0]["result"] += "x" * (262144 - current)
        accepted = work_queue._validated_board_text(self.root, board)
        self.assertEqual(len(accepted.encode("utf-8")), 262144)
        board["tasks"][0]["result"] += "x"
        with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID: size"):
            work_queue._validated_board_text(self.root, board)

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

    def test_resolved_historical_blocker_tracks_strict_successor_and_realerts_on_invalidation(self):
        blocked_receipt = self.root / "logs/old-blocked.json"
        blocked_receipt.write_text('{"reason":"superseded"}')
        successor_receipt = self.root / "logs/successor.json"
        self.receipt = successor_receipt
        self.board = {"version": 1, "revision": 12, "tasks": [
            {"id": "old-attempt", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
             "result": "Historical failed attempt", "paths": ["tooling/old.py"],
             "blocked_reason": "Superseded by corrected successor", "blocked_receipt": str(blocked_receipt),
             "blocker_resolution": {"owner": "CONTROLLER", "next_action": "Find corrected successor",
                                    "unblock_when": "Accepted successor exists", "status": "UNRESOLVED"}},
            {"id": "accepted-successor", "role": "B", "plan": "C00", "state": "IN_PROGRESS", "requires": [],
             "result": "Accepted corrected result", "paths": ["tooling/new.py"]},
            {"id": "consumer", "role": "A", "plan": "C00", "state": "READY", "requires": ["old-attempt"],
             "result": "Must still wait for actual dependency", "paths": ["tooling/consumer.py"]},
        ]}
        self.save()
        self.completion("accepted-successor")
        advance_task(self.root, "B", "accepted-successor", "DONE", str(successor_receipt))
        result = work_queue.resolve_blocker(
            self.root, "B", "old-attempt", "accepted-successor", str(successor_receipt)
        )
        self.assertEqual(result["resolution_status"], "RESOLVED")
        board = load_board(self.root)
        old = next(row for row in board["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(old["state"], "BLOCKED")
        self.assertEqual(old["blocker_resolution"]["successor_task"], "accepted-successor")
        self.assertEqual(old["blocker_resolution"]["successor_candidate_sha"], current_worktree_head())
        self.assertFalse(any(row["task_id"] == "old-attempt" for row in work_queue.blocker_attention(board)))
        consumer = next(row for row in role_work(self.root, "A")["tasks"] if row["id"] == "consumer")
        self.assertEqual(consumer["state"], "BLOCKED")
        revision = board["revision"]
        repeated = work_queue.resolve_blocker(
            self.root, "B", "old-attempt", "accepted-successor", str(successor_receipt)
        )
        self.assertTrue(repeated["idempotent"])
        self.assertEqual(load_board(self.root)["revision"], revision)

        accepted = json.loads(successor_receipt.read_text())
        value = copy.deepcopy(accepted)
        value["review"]["evidence"] = ["different still-PASS review evidence"]
        successor_receipt.write_text(json.dumps(value))
        stale = role_work(self.root, "B")
        old_view = next(row for row in stale["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(old_view["resolution_status"], "STALE_RESOLUTION")
        old_alert = next(row for row in stale["owner_attention"] if row["task_id"] == "old-attempt")
        self.assertEqual(old_alert["resolution_status"], "STALE_RESOLUTION")
        self.assertIn("successor", old_alert["reason"])
        self.assertIn("Повторно принять", old_alert["next_action"])

        successor_receipt.write_text(json.dumps(accepted))
        restored = role_work(self.root, "B")
        restored_view = next(row for row in restored["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(restored_view["resolution_status"], "RESOLVED")
        value = copy.deepcopy(accepted)
        value["verdict"] = "FAIL"
        successor_receipt.write_text(json.dumps(value))
        stale = role_work(self.root, "B")
        old_view = next(row for row in stale["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(old_view["resolution_status"], "STALE_RESOLUTION")

    def test_blocker_resolution_rejects_wrong_owner_plan_receipt_and_legacy_done(self):
        blocked_receipt = self.root / "logs/old-blocked.json"
        blocked_receipt.write_text('{"reason":"superseded"}')
        successor_receipt = self.root / "logs/successor.json"
        other_receipt = self.root / "logs/other.json"
        other_receipt.write_text('{"unrelated":true}')
        self.receipt = successor_receipt
        self.board = {"version": 1, "revision": 20, "tasks": [
            {"id": "old-attempt", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
             "result": "Historical failed attempt", "paths": ["tooling/old.py"],
             "blocked_reason": "Superseded", "blocked_receipt": str(blocked_receipt)},
            {"id": "wrong-plan-successor", "role": "B", "plan": "B04", "state": "IN_PROGRESS", "requires": [],
             "result": "Different plan result", "paths": ["tooling/new.py"]},
        ]}
        self.save()
        self.completion("wrong-plan-successor")
        advance_task(self.root, "B", "wrong-plan-successor", "DONE", str(successor_receipt))
        with self.assertRaisesRegex(RuntimeError, "OWNER_OR_STATE"):
            work_queue.resolve_blocker(self.root, "A", "old-attempt", "wrong-plan-successor", str(successor_receipt))
        with self.assertRaisesRegex(RuntimeError, "SUCCESSOR_NOT_ACCEPTED"):
            work_queue.resolve_blocker(self.root, "B", "old-attempt", "wrong-plan-successor", str(successor_receipt))

        board = load_board(self.root)
        successor = next(row for row in board["tasks"] if row["id"] == "wrong-plan-successor")
        successor["plan"] = "C00"
        self.board = board
        self.save()

        accepted = json.loads(successor_receipt.read_text())
        changed = copy.deepcopy(accepted)
        changed["checks"][0]["evidence"] = ["different still-PASS run evidence"]
        successor_receipt.write_text(json.dumps(changed))
        with self.assertRaisesRegex(RuntimeError, "SUCCESSOR_NOT_ACCEPTED"):
            work_queue.resolve_blocker(self.root, "B", "old-attempt", "wrong-plan-successor", str(successor_receipt))
        successor_receipt.write_text(json.dumps(accepted))

        with self.assertRaisesRegex(RuntimeError, "RESOLUTION_RECEIPT_INVALID"):
            work_queue.resolve_blocker(self.root, "B", "old-attempt", "wrong-plan-successor", str(other_receipt))

        legacy = self.root / "logs/legacy.json"
        legacy.write_text('{"legacy":true}')
        board = load_board(self.root)
        successor = next(row for row in board["tasks"] if row["id"] == "wrong-plan-successor")
        successor.pop("completion_receipt_format", None)
        successor.pop("completion_candidate_sha", None)
        successor.pop("completion_receipt_snapshot", None)
        successor["completion_receipt"] = str(legacy)
        self.board = board
        self.save()
        with self.assertRaisesRegex(RuntimeError, "SUCCESSOR_NOT_ACCEPTED"):
            work_queue.resolve_blocker(self.root, "B", "old-attempt", "wrong-plan-successor", str(legacy))

    def test_resolved_blocker_cannot_be_rebound_to_different_accepted_successor(self):
        blocked_receipt = self.root / "logs/old-blocked.json"
        blocked_receipt.write_text('{"reason":"superseded"}')
        self.board = {"version": 1, "revision": 30, "tasks": [
            {"id": "old-attempt", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
             "result": "Historical failed attempt", "paths": ["tooling/old.py"],
             "blocked_reason": "Superseded", "blocked_receipt": str(blocked_receipt)},
            {"id": "successor-one", "role": "B", "plan": "C00", "state": "IN_PROGRESS", "requires": [],
             "result": "First accepted successor", "paths": ["tooling/one.py"]},
            {"id": "successor-two", "role": "B", "plan": "C00", "state": "IN_PROGRESS", "requires": [],
             "result": "Second accepted successor", "paths": ["tooling/two.py"]},
        ]}
        self.save()
        receipts = {}
        for task_id in ("successor-one", "successor-two"):
            receipt = self.root / "logs" / f"{task_id}.json"
            receipt.write_text(json.dumps({
                "kind": work_queue.COMPLETION_KIND, "version": 1, "task_id": task_id,
                "candidate_sha": current_worktree_head(), "verdict": "PASS",
                "review": {"verdict": "PASS", "evidence": ["independent review"]},
                "checks": [{"name": "focused", "verdict": "PASS", "evidence": ["test run"]}],
            }))
            receipts[task_id] = receipt
            advance_task(self.root, "B", task_id, "DONE", str(receipt))
        work_queue.resolve_blocker(
            self.root, "B", "old-attempt", "successor-one", str(receipts["successor-one"])
        )
        with self.assertRaisesRegex(RuntimeError, "RESOLUTION_ALREADY_SET"):
            work_queue.resolve_blocker(
                self.root, "B", "old-attempt", "successor-two", str(receipts["successor-two"])
            )

    def test_historical_blocker_resolution_statuses_remain_readable_but_actionable(self):
        for metadata in [
            {
                "owner": "CONTROLLER",
                "status": "RESOLVED_FOR_THIS_OWNER_TEST_RELEASE",
                "evidence": "/root/octoport-control/logs/controller/publication.json",
            },
            {
                "owner": "CONTROLLER",
                "status": "PUBLICATION_ROUTE_REQUIRED",
                "next_action": "Publish through the reviewed route",
                "unblock_when": "Exact candidate is accepted",
            },
        ]:
            with self.subTest(status=metadata["status"]):
                board = copy.deepcopy(self.board)
                task = board["tasks"][0]
                task.update(
                    state="BLOCKED",
                    blocked_reason="Historical blocker metadata",
                    blocked_receipt=str(self.receipt.resolve()),
                    blocker_resolution=metadata,
                )
                self.path.write_text(json.dumps(board))
                loaded = load_board(self.root)
                loaded_task = next(row for row in loaded["tasks"] if row["id"] == "b-auth")
                self.assertEqual(loaded_task["blocker_resolution"]["status"], metadata["status"])
                view = next(row for row in role_work(self.root, "B")["tasks"] if row["id"] == "b-auth")
                self.assertEqual(view["resolution_status"], metadata["status"])
                self.assertTrue(any(row["task_id"] == "b-auth" for row in work_queue.blocker_attention(loaded)))
        self.save()

    def test_malformed_resolved_blocker_metadata_is_rejected(self):
        self.board["tasks"][0]["state"] = "BLOCKED"
        self.board["tasks"][0]["blocked_reason"] = "historical"
        self.board["tasks"][0]["blocker_resolution"] = {
            "status": "RESOLVED", "owner": "B", "next_action": "none", "unblock_when": "done"
        }
        self.save()
        with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID"):
            load_board(self.root)

    def test_role_work_reuses_strict_validation_once_per_task_and_fails_closed(self):
        count = 24
        tasks = []
        for index in range(count):
            tasks.append({
                "id": f"strict-{index}", "role": "B", "plan": "B04", "state": "DONE",
                "requires": [], "result": "accepted result", "paths": [f"tooling/{index}.py"],
                "completion_receipt_format": work_queue.COMPLETION_VERSION,
                "completion_receipt": str(self.root / "logs/tampered.json"),
                "completion_candidate_sha": "a" * 40,
            })
        # Invalid evidence must remain invalid through the optimized role and owner paths.
        (self.root / "logs/tampered.json").write_text('{"verdict":"PASS"}')
        self.board = {"version": 1, "revision": 2, "tasks": tasks}
        self.save()
        original = work_queue._completion_receipt
        with patch.object(work_queue, "_completion_receipt", wraps=original) as read_receipt:
            result = role_work(self.root, "B")
        self.assertEqual(read_receipt.call_count, count)
        self.assertEqual(len(result["tasks"]), count)
        self.assertTrue(all(row["state"] == "BLOCKED" for row in result["tasks"]))
        self.assertTrue(all(row["completion_invalidated"] for row in result["tasks"]))

    def test_task_view_direct_call_keeps_fail_closed_completion_check(self):
        task = {
            "id": "tampered", "role": "B", "plan": "B04", "state": "DONE", "requires": [],
            "result": "result", "paths": ["tooling/tampered.py"],
            "completion_receipt_format": work_queue.COMPLETION_VERSION,
            "completion_receipt": str(self.root / "logs/tampered.json"),
            "completion_candidate_sha": "a" * 40,
        }
        (self.root / "logs/tampered.json").write_text('{"verdict":"PASS"}')
        view = work_queue.task_view({"tasks": [task]}, task)
        self.assertEqual(view["state"], "BLOCKED")
        self.assertTrue(view["completion_invalidated"])


    def test_semantic_active_count_uses_task_view_and_one_evaluation_per_board(self):
        board = copy.deepcopy(self.board)
        invalidated = {
            "id": "invalidated-done", "role": "B", "plan": "B04", "state": "DONE", "requires": [],
            "result": "Strict completion invalidated", "paths": ["tooling/invalidated.py"],
            "completion_receipt_format": work_queue.COMPLETION_VERSION,
            "completion_receipt": str(self.root / "logs/missing-strict.json"),
            "completion_candidate_sha": "a" * 40,
            "completion_receipt_snapshot": {"verdict": "PASS"},
        }
        legacy = {
            "id": "legacy-done", "role": "B", "plan": "B04", "state": "DONE", "requires": [],
            "result": "Legacy completion remains historical", "paths": ["tooling/legacy.py"],
            "completion_receipt": str(self.receipt),
        }
        board["tasks"].extend([invalidated, legacy])
        with patch.object(work_queue, "_BoardEvaluation", wraps=work_queue._BoardEvaluation) as evaluation:
            self.assertEqual(work_queue._semantic_active_count(board), 3)
        # Root argument is deliberate: R7 strict provenance extends the
        # preexisting single-evaluation semantic active-count contract.
        evaluation.assert_called_once_with(board, root=None)

        with patch.object(work_queue, "_BoardEvaluation", wraps=work_queue._BoardEvaluation) as evaluation:
            work_queue._enforce_semantic_active_transition(board, board)
        self.assertEqual(evaluation.call_count, 2)


class EvidenceProvenanceTests(unittest.TestCase):
    """Source-free RESULT tasks cannot inherit an unrelated role worktree HEAD."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        # An exception in setUp skips tearDown, but unittest still executes
        # registered cleanups. Register temporary cleanup immediately, before
        # any Git commands or process-global monkeypatch is installed.
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / "controllers").mkdir()
        self.dir = self.root / "logs/B/observed-runtime"
        self.dir.mkdir(parents=True)
        for role in "ABC":
            (self.root / (role + ".json")).write_text(
                json.dumps({"role": role, "status": "RUNNING", "task": "evidence"}))
        self.task = {
            "id": "b-observe", "role": "B", "plan": "B04", "state": "READY",
            "requires": [], "result": "Record exact read-only ordinary auth currentity",
            "paths": ["logs/B/observed-runtime/RESULT.json"],
            "evidence_only": True,
            "execution_class": "OPERATIONAL_EVIDENCE",
            "source_publication_authorized": False,
            "outcome_kind": "OPERATIONAL_OBSERVATION",
        }
        self.boardfile = self.root / "controllers/work-board.json"
        self.boardfile.write_text(json.dumps({
            "version": 1, "revision": 1, "tasks": [self.task]}))
        # GitHub Actions uses a shallow checkout of the task-ref and need not
        # expose origin/main. A unit test MUST NOT add that ref to the source
        # worktree or relax production ancestry checks. Build an independent
        # short-lived Git object store with its own explicit accepted main ref.
        repo = Path(work_queue.__file__).resolve().parents[2]
        self.source_repo = self.root / "accepted-source-git"
        # TEST-ONLY private key: independent issuance is synthetic here.
        # The real public signer must be separately approved in published Git,
        # never provisioned by a task author or copied into product logs.
        self.review_private_key = self.root / "unit-only-reviewer"
        self.review_principal = "A:reviewer-unit-fixture"
        subprocess.run(
            ["/usr/bin/ssh-keygen", "-t", "ed25519", "-f",
             str(self.review_private_key), "-N", "", "-q",
             "-C", "Octoport synthetic unit-only reviewer"],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["git", "init", "-q", str(self.source_repo)], check=True,
            capture_output=True,
        )
        source_paths = (
            "tooling/coordination/work_queue.py",
            "tooling/coordination/control.py",
        )
        for source_path in source_paths:
            original_entry = subprocess.check_output(
                ["git", "-C", str(repo), "ls-tree", "HEAD", "--", source_path],
                text=True,
            ).strip()
            self.assertRegex(
                original_entry, r"^100644 blob [0-9a-f]{40}\t",
            )
            raw = subprocess.check_output(
                ["git", "-C", str(repo), "show", "HEAD:" + source_path],
            )
            dest = self.source_repo / source_path
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(raw)
        trust_path = work_queue.EVIDENCE_TRUSTED_SIGNERS_PATH
        trust = self.source_repo / trust_path
        trust.parent.mkdir(parents=True, exist_ok=True)
        public_parts = self.review_private_key.with_suffix(".pub").read_text().split()
        trust.write_text(
            self.review_principal + " " + public_parts[0] + " "
            + public_parts[1] + "\n",
        )
        subprocess.run(
            ["git", "-C", str(self.source_repo), "add", "--",
             *source_paths, trust_path],
            check=True, capture_output=True,
        )
        subprocess.run(
            ["git", "-C", str(self.source_repo),
             "-c", "user.name=Octoport Test Fixture",
             "-c", "user.email=octoport-test@example.invalid",
             "-c", "commit.gpgsign=false",
             "commit", "-q", "-m", "Accepted source provenance fixture"],
            check=True, capture_output=True,
        )
        self.source = subprocess.check_output(
            ["git", "-C", str(self.source_repo), "rev-parse", "HEAD"],
            text=True,
        ).strip()
        self.tree = subprocess.check_output(
            ["git", "-C", str(self.source_repo), "rev-parse", "HEAD^{tree}"],
            text=True,
        ).strip()
        self.blob = subprocess.check_output(
            ["git", "-C", str(self.source_repo), "rev-parse",
             self.source + ":tooling/coordination/work_queue.py"],
            text=True,
        ).strip()
        self.trust_blob = subprocess.check_output(
            ["git", "-C", str(self.source_repo), "rev-parse",
             self.source + ":" + work_queue.EVIDENCE_TRUSTED_SIGNERS_PATH],
            text=True,
        ).strip()
        subprocess.run(
            ["git", "-C", str(self.source_repo), "update-ref",
             "refs/remotes/origin/main", self.source],
            check=True, capture_output=True,
        )
        self.real_repo_resolver = work_queue._evidence_source_repo
        self._source_repo_patch = patch.object(
            work_queue, "_evidence_source_repo",
            return_value=self.source_repo,
        )
        # Install cleanup before start: even a failing partial setup cannot
        # leave global work_queue._evidence_source_repo patched.
        self.addCleanup(self._source_repo_patch.stop)
        self._source_repo_patch.start()
        # Pin the accepted source in the independently installed verifier.
        # This test-only source SHA does not provision a production key.
        self._anchor_patch = patch.object(
            work_queue, "EVIDENCE_ACCEPTED_SOURCE_TRUST_ANCHOR",
            (self.source, self.tree, self.trust_blob),
        )
        self.addCleanup(self._anchor_patch.stop)
        self._anchor_patch.start()
        self.result = self.dir / "RESULT.json"
        self.result.write_text('{"bounded":"read-only"}\n')
        self.review = self.dir / "REVIEW.md"
        self.review.write_text(
            "Verdict: PASS\nReview b-observe result_sha256="
            + hashlib.sha256(self.result.read_bytes()).hexdigest() + "\n")
        self.manifest = self.dir / "MANIFEST.json"
        self.manifest_value = {
            "kind": work_queue.EVIDENCE_MANIFEST_KIND, "version": work_queue.EVIDENCE_MANIFEST_VERSION,
            "task_id": "b-observe", "role": "B",
            "source_commit": self.source, "source_tree": self.tree,
            "source_blobs": [
                {"path": work_queue.EVIDENCE_TRUSTED_SIGNERS_PATH,
                 "blob_sha": self.trust_blob},
                {"path": "tooling/coordination/work_queue.py", "blob_sha": self.blob},
            ],
            "result_path": "logs/B/observed-runtime/RESULT.json",
            "result_sha256": hashlib.sha256(self.result.read_bytes()).hexdigest(),
            "review_path": "logs/B/observed-runtime/REVIEW.md",
            "review_sha256": hashlib.sha256(self.review.read_bytes()).hexdigest(),
            "reviewer_principal": self.review_principal,
            "review_signature_path": "logs/B/observed-runtime/REVIEW.sig",
            "review_signature_sha256": "0" * 64,
        }
        self.signature = self.dir / "REVIEW.sig"
        signed = subprocess.run(
            ["/usr/bin/ssh-keygen", "-Y", "sign", "-f",
             str(self.review_private_key), "-n",
             work_queue.EVIDENCE_SIGNATURE_NAMESPACE],
            input=work_queue._evidence_review_signed_payload(self.manifest_value),
            capture_output=True, check=True,
        )
        self.signature.write_bytes(signed.stdout)
        self.manifest_value["review_signature_sha256"] = hashlib.sha256(
            self.signature.read_bytes()).hexdigest()
        self.update_manifest()
        self.receipt = self.dir / "COMPLETION.json"
        self.receipt.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND, "version": 1,
            "task_id": "b-observe", "candidate_sha": self.source,
            "verdict": "PASS", "review": {
                "verdict": "PASS", "evidence": ["independent exact read-only review"],
            },
            "checks": [{
                "name": "manifest and result provenance",
                "verdict": "PASS", "evidence": ["accepted source blob and file hashes"],
            }],
        }))

    def tearDown(self):
        # Three rollout consumers manually construct this TestCase and call
        # tearDown directly. The unittest runner's later doCleanups() does not
        # run in that path, so release all registered mocks BEFORE deleting
        # their source Git fixture. Normal unittest runs see an empty cleanup
        # stack on their standard post-tearDown doCleanups() call.
        self.doCleanups()

    def update_manifest(self):
        self.manifest.write_text(json.dumps(self.manifest_value))

    def start(self):
        work_queue.advance_task(self.root, "B", "b-observe", "IN_PROGRESS")

    def finish(self):
        with patch.object(work_queue, "current_worktree_head",
                          return_value="f" * 40):
            return work_queue.advance_task(
                self.root, "B", "b-observe", "DONE", str(self.receipt),
                evidence_provenance=str(self.manifest))

    def done(self):
        return next(t for t in work_queue.load_board(self.root)["tasks"]
                    if t["id"] == "b-observe")

    def test_no_externally_installed_issuer_anchor_rejects_signed_result(self):
        # The project's current real signer source has not been accepted.
        # Synthetic reviewer keys belong ONLY in this disposable fixture.
        self.start()
        previous = self.boardfile.read_bytes()
        with patch.object(work_queue, "EVIDENCE_ACCEPTED_SOURCE_TRUST_ANCHOR", None):
            with self.assertRaisesRegex(
                RuntimeError, "EVIDENCE_REVIEW_ISSUER_UNTRUSTED"
            ):
                self.finish()
        self.assertEqual(previous, self.boardfile.read_bytes())
        self.assertEqual(self.done()["state"], "IN_PROGRESS")

    def test_moving_local_origin_main_with_self_issued_key_cannot_create_trust(self):
        # The original signed source is accepted by the source-only test
        # fixture. The role B author now forges a DIFFERENT Git commit with
        # its own reviewer public key, independently signed-looking principal,
        # and advances only its mutable local origin/main ref. An unchanged
        # deployed verifier must reject this new source despite valid SSH
        # signature, Git blobs and local ancestry.
        original_source = self.source
        forged_key = self.root / "author-controlled-reviewer"
        subprocess.run(
            ["/usr/bin/ssh-keygen", "-t", "ed25519", "-f",
             str(forged_key), "-N", "", "-q",
             "-C", "synthetic source-ref adversarial fixture"],
            capture_output=True, check=True,
        )
        forged_principal = "A:forged-attacker-unit"
        public = forged_key.with_suffix(".pub").read_text().split()
        trusted = self.source_repo / work_queue.EVIDENCE_TRUSTED_SIGNERS_PATH
        trusted.write_text(
            forged_principal + " " + public[0] + " " + public[1] + chr(10)
        )
        subprocess.run(
            ["git", "-C", str(self.source_repo), "add", "--",
             work_queue.EVIDENCE_TRUSTED_SIGNERS_PATH],
            capture_output=True, check=True,
        )
        subprocess.run(
            ["git", "-C", str(self.source_repo),
             "-c", "user.name=Untrusted Test Author",
             "-c", "user.email=untrusted-test@example.invalid",
             "-c", "commit.gpgsign=false", "commit", "-q",
             "-m", "Forge a new local source with an author-controlled signer"],
            capture_output=True, check=True,
        )
        forged_source = subprocess.check_output(
            ["git", "-C", str(self.source_repo), "rev-parse", "HEAD"],
            text=True,
        ).strip()
        self.assertNotEqual(forged_source, original_source)
        forged_tree = subprocess.check_output(
            ["git", "-C", str(self.source_repo), "rev-parse", "HEAD^{tree}"],
            text=True,
        ).strip()
        trust_blob = subprocess.check_output(
            ["git", "-C", str(self.source_repo), "rev-parse",
             forged_source + ":" + work_queue.EVIDENCE_TRUSTED_SIGNERS_PATH],
            text=True,
        ).strip()
        self.manifest_value["source_commit"] = forged_source
        self.manifest_value["source_tree"] = forged_tree
        self.manifest_value["reviewer_principal"] = forged_principal
        for blob in self.manifest_value["source_blobs"]:
            if blob["path"] == work_queue.EVIDENCE_TRUSTED_SIGNERS_PATH:
                blob["blob_sha"] = trust_blob
        forged_signature = subprocess.run(
            ["/usr/bin/ssh-keygen", "-Y", "sign", "-f", str(forged_key),
             "-n", work_queue.EVIDENCE_SIGNATURE_NAMESPACE],
            input=work_queue._evidence_review_signed_payload(self.manifest_value),
            capture_output=True, check=True,
        ).stdout
        self.signature.write_bytes(forged_signature)
        self.manifest_value["review_signature_sha256"] = hashlib.sha256(
            forged_signature,
        ).hexdigest()
        self.update_manifest()
        # The strict source-bound completion receipt is role-author-editable;
        # it can be made consistent with the forged source as well.
        forged_receipt = json.loads(self.receipt.read_text())
        forged_receipt["candidate_sha"] = forged_source
        self.receipt.write_text(json.dumps(forged_receipt))
        subprocess.run(
            ["git", "-C", str(self.source_repo), "update-ref",
             "refs/remotes/origin/main", forged_source],
            capture_output=True, check=True,
        )
        self.start()
        before = self.boardfile.read_bytes()
        with self.assertRaisesRegex(
            RuntimeError, "EVIDENCE_REVIEW_ISSUER_UNTRUSTED"
        ):
            self.finish()
        self.assertEqual(self.boardfile.read_bytes(), before)
        self.assertEqual(self.done()["state"], "IN_PROGRESS")

    def test_self_authored_role_local_pass_must_not_qualify_as_independent_review(self):
        # Previous manifest v1 may contain an apparently successful,
        # self-created REVIEW.md and exactly matching result/review hashes.
        self.manifest_value["version"] = 1
        for key in ("reviewer_principal", "review_signature_path",
                    "review_signature_sha256"):
            self.manifest_value.pop(key)
        self.update_manifest()
        self.start()
        pre_board = self.boardfile.read_bytes()
        with self.assertRaisesRegex(
            RuntimeError, "EVIDENCE_REVIEW_ISSUER_UNTRUSTED"
        ):
            self.finish()
        self.assertEqual(self.boardfile.read_bytes(), pre_board)
        self.assertEqual(self.done()["state"], "IN_PROGRESS")

    def test_forged_review_principal_cannot_use_an_independent_signature(self):
        # A role B author cannot relabel A's signed review as a B-owned
        # reviewer identity, even though all other source blobs are accepted.
        self.manifest_value["reviewer_principal"] = "B:role-author"
        self.update_manifest()
        self.start()
        with self.assertRaisesRegex(
            RuntimeError, "EVIDENCE_REVIEW_ISSUER_UNTRUSTED"
        ):
            self.finish()
        self.assertEqual(self.done()["state"], "IN_PROGRESS")

    def test_review_signature_from_an_untrusted_signer_cannot_pass(self):
        # This is a synthetic attacker key, not the fixture's published one.
        other = self.root / "untrusted-fixture-key"
        subprocess.run(
            ["/usr/bin/ssh-keygen", "-t", "ed25519", "-f",
             str(other), "-N", "", "-q"],
            capture_output=True, check=True,
        )
        forged = subprocess.run(
            ["/usr/bin/ssh-keygen", "-Y", "sign", "-f", str(other),
             "-n", work_queue.EVIDENCE_SIGNATURE_NAMESPACE],
            input=work_queue._evidence_review_signed_payload(
                self.manifest_value),
            capture_output=True, check=True,
        )
        self.signature.write_bytes(forged.stdout)
        self.manifest_value["review_signature_sha256"] = hashlib.sha256(
            forged.stdout).hexdigest()
        self.update_manifest()
        self.start()
        with self.assertRaisesRegex(
            RuntimeError, "EVIDENCE_REVIEW_ISSUER_UNTRUSTED"
        ):
            self.finish()
        self.assertEqual(self.done()["state"], "IN_PROGRESS")

    def test_successful_evidence_only_done_pins_accepted_source_not_role_head(self):
        self.start()
        self.finish()
        done = self.done()
        self.assertEqual(done["completion_candidate_sha"], self.source)
        self.assertNotEqual(done["completion_candidate_sha"], "f" * 40)
        self.assertEqual(done["completion_evidence_snapshot"]["source_commit"], self.source)
        self.assertEqual(done["state"], "DONE")
        self.assertTrue(work_queue._strict_completion_valid(done, root=self.root))
        self.assertEqual(work_queue.task_view(work_queue.load_board(self.root), done, root=self.root)["state"], "DONE")
        self.assertNotIn("completion_publication_registration", done)

    def test_result_review_and_manifest_tampering_invalidates_done(self):
        self.start()
        self.finish()
        for file in (self.result, self.review, self.signature, self.manifest):
            original = file.read_bytes()
            with self.subTest(file=file.name):
                file.write_bytes(original + b"\nTAMPER")
                self.assertFalse(work_queue._strict_completion_valid(self.done(), root=self.root))
                view = work_queue.task_view(work_queue.load_board(self.root), self.done(), root=self.root)
                self.assertEqual(view["state"], "BLOCKED")
                self.assertTrue(view["completion_invalidated"])
                file.write_bytes(original)
                self.assertTrue(work_queue._strict_completion_valid(self.done(), root=self.root))

    def test_independent_signature_cannot_drop_source_blob_without_resigning(self):
        # The approved Git tree and signer key alone are insufficient when
        # the role can rewrite which blobs the operational result claims.
        self.manifest_value["source_blobs"] = [
            blob for blob in self.manifest_value["source_blobs"]
            if blob["path"] == work_queue.EVIDENCE_TRUSTED_SIGNERS_PATH
        ]
        self.update_manifest()
        self.start()
        before = self.boardfile.read_bytes()
        with self.assertRaisesRegex(
            RuntimeError, "EVIDENCE_REVIEW_ISSUER_UNTRUSTED"
        ):
            self.finish()
        self.assertEqual(self.boardfile.read_bytes(), before)
        self.assertEqual(self.done()["state"], "IN_PROGRESS")

    def test_detached_review_signature_cannot_be_replayed_for_a_new_result(self):
        # Changing BOTH RESULT and the apparent PASS text/hashes cannot
        # reuse the previously independent cryptographic signature.
        self.result.write_text('{"bounded":"different-result"}\n')
        changed_hash = hashlib.sha256(self.result.read_bytes()).hexdigest()
        self.review.write_text(
            "Verdict: PASS\nReview b-observe result_sha256="
            + changed_hash + "\n")
        self.manifest_value["result_sha256"] = changed_hash
        self.manifest_value["review_sha256"] = hashlib.sha256(
            self.review.read_bytes()).hexdigest()
        self.update_manifest()
        self.start()
        with self.assertRaisesRegex(
            RuntimeError, "EVIDENCE_REVIEW_ISSUER_UNTRUSTED"
        ):
            self.finish()
        self.assertEqual(self.done()["state"], "IN_PROGRESS")

    def test_source_task_can_never_use_evidence_shortcut(self):
        self.task.pop("evidence_only")
        self.task.pop("execution_class")
        self.task.pop("source_publication_authorized")
        self.task["paths"] = ["apps/api/src/auth.ts"]
        self.boardfile.write_text(json.dumps({
            "version": 1, "revision": 1, "tasks": [self.task]}))
        self.start()
        before = self.boardfile.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "EVIDENCE_SCOPE_INVALID"):
            work_queue.advance_task(self.root, "B", "b-observe", "DONE",
                str(self.receipt), evidence_provenance=str(self.manifest))
        self.assertEqual(before, self.boardfile.read_bytes())

    def test_evidence_only_requires_manifest_and_disallows_publication_mixing(self):
        self.start()
        for extra in ({}, {"publication_registration": "a" * 64,
                           "evidence_provenance": str(self.manifest)}):
            with self.subTest(extra=extra):
                with self.assertRaisesRegex(RuntimeError, "EVIDENCE_"):
                    work_queue.advance_task(self.root, "B", "b-observe", "DONE",
                                            str(self.receipt), **extra)
        self.assertEqual(self.done()["state"], "IN_PROGRESS")

    def test_forged_different_control_root_cannot_keep_done_valid(self):
        from shutil import copytree
        self.start()
        self.finish()
        with tempfile.TemporaryDirectory() as alt:
            other = Path(alt)
            copytree(self.dir, other / "logs/B/observed-runtime")
            forged = copy.deepcopy(self.done())
            snapshot = forged["completion_evidence_snapshot"]
            snapshot["control_root"] = str(other.resolve())
            snapshot["manifest_path"] = str(
                other / "logs/B/observed-runtime/MANIFEST.json")
            self.assertTrue(work_queue._evidence_snapshot_valid(
                forged, expected_root=other))
            self.boardfile.write_text(json.dumps({
                "version": 1, "revision": 3, "tasks": [forged]}))
            # The board reader must use self.root, NOT the forged root.
            own = work_queue.role_work(self.root, "B")["tasks"][0]
            self.assertEqual(own["state"], "BLOCKED")
            self.assertTrue(own["completion_invalidated"])
            self.assertFalse(work_queue._strict_completion_valid(
                forged, root=self.root))

    def test_independent_review_must_bind_task_result_hash_and_pass(self):
        self.start()
        self.review.write_text("Unrelated reviewed output says PASS")
        self.manifest_value["review_sha256"] = hashlib.sha256(
            self.review.read_bytes()).hexdigest()
        self.update_manifest()
        with self.assertRaisesRegex(RuntimeError, "REVIEW_NOT_BOUND"):
            self.finish()

    def test_legacy_done_with_evidence_only_marker_cannot_skip_strict_snapshot(self):
        self.start()
        task = self.done()
        task.update(state="DONE", completion_receipt=str(self.receipt))
        self.boardfile.write_text(json.dumps({"version": 1, "revision": 4, "tasks": [task]}))
        self.assertFalse(work_queue._strict_completion_valid(task, root=self.root))
        self.assertEqual(work_queue.task_view(work_queue.load_board(self.root), task, root=self.root)["state"], "BLOCKED")

    def test_result_symlink_is_rejected_even_with_matching_bytes(self):
        self.start()
        ordinary = self.dir / "retained-result.json"
        self.result.rename(ordinary)
        self.result.symlink_to(ordinary)
        with self.assertRaisesRegex(RuntimeError, "EVIDENCE_FILE_INVALID"):
            self.finish()

if __name__ == "__main__":
    unittest.main()
