import copy
import datetime as dt
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import work_board_v2 as v2
import work_board_v2_migrate as migrate
import work_queue


class Crash(BaseException):
    pass


class WorkBoardV2Tests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "controllers").mkdir()
        (self.root / "logs").mkdir()
        (self.root / "authorizations").mkdir()
        for role in "ABC":
            (self.root / f"{role}.json").write_text(json.dumps({"role": role, "status": "RUNNING"}))
        self.reader = Path(work_queue.__file__).resolve()
        self.readers = {role: self.reader for role in ("A", "B", "C", "ORG")}

    def tearDown(self):
        self.tmp.cleanup()

    def v1(self, tasks, revision=4):
        board = {"version": 1, "revision": revision, "updated_at": "2026-10-02T00:00:00+00:00", "tasks": tasks}
        raw = (json.dumps(board, ensure_ascii=False, indent=2) + "\n").encode()
        (self.root / "controllers/work-board.json").write_bytes(raw)
        return board, raw

    def ready(self, task_id="a-one", requires=()):
        return {"id": task_id, "role": "A", "plan": "A04", "state": "READY", "requires": list(requires),
                "result": "A bounded task", "paths": [f"apps/extension/{task_id}.js"]}

    def done(self, task_id="b-done"):
        path = self.root / "logs" / f"{task_id}.json"
        path.write_text('{"legacy":true}')
        return {"id": task_id, "role": "B", "plan": "B04", "state": "DONE", "requires": [],
                "result": "Historical row", "paths": ["apps/api/old.js"], "completion_receipt": str(path)}

    def publication(self, task, candidate="c" * 40):
        role = task["role"]
        task_id = task["id"]
        task_paths = task["paths"]
        task_ref = f"refs/heads/controller/task-publication/{role.lower()}/{task_id}/test"
        task_branch = task_ref.removeprefix("refs/heads/")
        review = {"path": str(self.root / "logs/review.json"), "sha256": "a" * 64}
        core = {
            "role": role,
            "task_id": task_id,
            "task_paths": task_paths,
            "changed_paths": task_paths,
            "candidate_head": candidate,
            "candidate_tree": "d" * 40,
            "base_sha": "e" * 40,
            "task_fingerprint": work_queue._publication_task_fingerprint(
                dict(task, state="IN_PROGRESS")
            ),
            "review": review,
            "bundle_manifest_sha256": "1" * 64,
            "task_ref": task_ref,
            "task_branch": task_branch,
        }
        registration_id = work_queue._sha_bytes(work_queue._canonical_bytes(core))
        publication = self.root / "controllers/task-publication"

        ready_path = publication / "ready" / registration_id / "5.json"
        ready_path.parent.mkdir(parents=True, exist_ok=True)
        ready = {
            "kind": "octoport.task-publication-ready",
            "version": 1,
            "registration_id": registration_id,
            "registration_sha256": registration_id,
            "registration_state_version": 2,
            "task_id": task_id,
            "role": role,
            "task_fingerprint": core["task_fingerprint"],
            "candidate_head": candidate,
            "candidate_tree": core["candidate_tree"],
            "base_sha": core["base_sha"],
            "task_ref": task_ref,
            "task_branch": task_branch,
            "review": review,
            "bundle_manifest_sha256": core["bundle_manifest_sha256"],
            "ci": {
                "status": "PASS",
                "head": candidate,
                "branch": task_branch,
                "checked_at": 1,
                "runs": [
                    {"name": name, "id": i + 1, "status": "completed", "conclusion": "success"}
                    for i, name in enumerate(work_queue.PUBLICATION_REQUIRED_CI)
                ],
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
            "state_before": "PUBLISHED",
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

        published = dict(ready_state)
        published.update(
            state="PUBLISHED",
            state_version=3,
            previous_state_sha256=hashlib.sha256(ready_state_raw).hexdigest(),
            task_ref_cleanup_status="DELETED",
            updated_at="2026-10-02T00:00:02Z",
        )
        published_raw = (json.dumps(published, ensure_ascii=False, indent=2) + "\n").encode()
        (history / "3.json").write_bytes(published_raw)

        closed = dict(published)
        closed.update(
            state="CLOSED",
            state_version=4,
            previous_state_sha256=hashlib.sha256(published_raw).hexdigest(),
            close_receipt=close_descriptor,
            updated_at="2026-10-02T00:00:03Z",
        )
        closed_raw = (json.dumps(closed, ensure_ascii=False, indent=2) + "\n").encode()
        (history / "4.json").write_bytes(closed_raw)
        registrations = publication / "registrations"
        registrations.mkdir(parents=True, exist_ok=True)
        (registrations / f"{registration_id}.json").write_bytes(closed_raw)
        return registration_id, candidate

    def grant(self, raw, *, authority_id="test-001", alter=None):
        now = dt.datetime.now(dt.timezone.utc)
        hashes = {role: hashlib.sha256(self.reader.read_bytes()).hexdigest() for role in self.readers}
        repo = Path(work_queue.__file__).resolve().parents[2]
        try:
            head = __import__("subprocess").run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
        except Exception:
            head = "0" * 40
        value = {
            "id": authority_id, "status": "GRANTED", "authority": migrate.AUTHORITY_KIND,
            "issued_at": (now - dt.timedelta(seconds=1)).isoformat(),
            "expires_at": (now + dt.timedelta(hours=1)).isoformat(),
            "corrected_scope_sha256": migrate.SCOPE_SHA256, "source_candidate_sha": head,
            "work_queue_sha256": hashlib.sha256(Path(work_queue.__file__).read_bytes()).hexdigest(),
            "work_board_v2_sha256": hashlib.sha256(Path(v2.__file__).read_bytes()).hexdigest(),
            "migrate_sha256": hashlib.sha256(Path(migrate.__file__).read_bytes()).hexdigest(),
            "expected_v1_revision": 4, "expected_v1_sha256": hashlib.sha256(raw).hexdigest(),
            "reader_sha256": hashes, "single_use": True,
        }
        if alter:
            value.update(alter)
        path = self.root / "authorizations" / f"CONTROLLER-WORK-BOARD-V2-MIGRATION-{authority_id}.json"
        path.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
        path.chmod(0o600)
        return path

    def migrate(self, tasks):
        board, raw = self.v1(tasks)
        grant = self.grant(raw)
        result = migrate.migrate(self.root, grant, self.readers, board["revision"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(result["state"], "COMMITTED")
        return board, raw, result

    def _add_ready_task(self, task_id):
        task = self.ready(task_id)
        task.update(acceptance=["bounded"], basis="approved plan remainder")
        return work_queue.add_task(
            self.root, "A", task,
            repo_root=Path(work_queue.__file__).resolve().parents[2],
        )

    def _completion_receipt(self, task_id, verdict="PASS"):
        receipt = self.root / "logs" / f"{task_id}-{verdict.lower()}.json"
        receipt.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND,
            "version": work_queue.COMPLETION_VERSION,
            "task_id": task_id,
            "candidate_sha": work_queue.current_worktree_head(),
            "verdict": verdict,
            "review": {"verdict": verdict, "evidence": ["independent review"]},
            "checks": [{"name": "focused", "verdict": verdict, "evidence": ["run"]}],
        }))
        return receipt

    def _strict_done(self, task_id):
        work_queue.advance_task(self.root, "A", task_id, "IN_PROGRESS")
        receipt = self._completion_receipt(task_id)
        work_queue.advance_task(self.root, "A", task_id, "DONE", str(receipt))
        return next(row for row in work_queue.load_board(self.root)["tasks"] if row["id"] == task_id)

    def _rework_receipt(self, task_id):
        receipt = self.root / "logs" / f"{task_id}-rework.json"
        receipt.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND,
            "version": work_queue.COMPLETION_VERSION,
            "task_id": task_id,
            "candidate_sha": work_queue.current_worktree_head(),
            "verdict": "REWORK_REQUIRED",
            "review": {"verdict": "REWORK_REQUIRED", "evidence": ["repair required"]},
            "checks": [{"name": "focused", "verdict": "REWORK_REQUIRED", "evidence": ["run"]}],
        }))
        return receipt

    def _semantic_count(self):
        board = work_queue.load_board(self.root)
        return work_queue._semantic_active_count(board)

    def test_migration_preserves_order_and_keeps_done_out_of_hot(self):
        tasks = [self.ready("a-first", ["b-done"]), self.done(), self.ready("c-last")]
        board, raw, receipt = self.migrate(tasks)
        state = v2.load_state(self.root)
        hot = json.loads((self.root / "controllers/work-board.json").read_text())
        self.assertEqual([t["id"] for t in state["logical"]["tasks"]], ["a-first", "b-done", "c-last"])
        self.assertEqual([t["id"] for t in hot["tasks"]], ["a-first", "c-last"])
        self.assertEqual(hot["completed_count"], 1)
        self.assertEqual(hot["archive_history_count"], 1)
        self.assertEqual(v2.board_snapshot(self.root), receipt["post_switch"]["A"]["snapshot"])
        self.assertTrue((self.root / "controllers/work-board-done/migrations" / (hashlib.sha256(raw).hexdigest()+".json")).is_file())

    def test_v2_isolated_publication_done_persists_candidate_and_leaves_hot_board(self):
        task = self.ready("a-isolated")
        self.migrate([task])
        work_queue.advance_task(self.root, "A", task["id"], "IN_PROGRESS")
        live_task = next(row for row in work_queue.load_board(self.root)["tasks"] if row["id"] == task["id"])
        registration, candidate = self.publication(live_task)
        receipt = self.root / "logs/a-isolated-completion.json"
        receipt.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND,
            "version": work_queue.COMPLETION_VERSION,
            "task_id": task["id"],
            "candidate_sha": candidate,
            "verdict": "PASS",
            "review": {"verdict": "PASS", "evidence": ["independent review"]},
            "checks": [{"name": "focused", "verdict": "PASS", "evidence": ["run"]}],
        }))
        work_queue.advance_task(
            self.root, "A", task["id"], "DONE", str(receipt),
            publication_registration=registration,
        )
        logical = work_queue.load_board(self.root)
        done = next(row for row in logical["tasks"] if row["id"] == task["id"])
        self.assertEqual(done["state"], "DONE")
        self.assertEqual(done["completion_candidate_sha"], candidate)
        self.assertEqual(done["completion_publication_registration"], registration)
        hot = json.loads((self.root / "controllers/work-board.json").read_text())
        self.assertEqual(hot["tasks"], [])
        self.assertEqual(hot["completed_count"], 1)

    def test_v2_publication_evidence_tamper_rehydrates_done_as_invalidated(self):
        task = self.ready("a-isolated-invalidated")
        self.migrate([task])
        work_queue.advance_task(self.root, "A", task["id"], "IN_PROGRESS")
        live_task = next(row for row in work_queue.load_board(self.root)["tasks"] if row["id"] == task["id"])
        registration, candidate = self.publication(live_task)
        receipt = self.root / "logs/a-isolated-invalidated-completion.json"
        receipt.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND,
            "version": work_queue.COMPLETION_VERSION,
            "task_id": task["id"],
            "candidate_sha": candidate,
            "verdict": "PASS",
            "review": {"verdict": "PASS", "evidence": ["independent review"]},
            "checks": [{"name": "focused", "verdict": "PASS", "evidence": ["run"]}],
        }))
        work_queue.advance_task(
            self.root, "A", task["id"], "DONE", str(receipt),
            publication_registration=registration,
        )
        done = next(row for row in work_queue.load_board(self.root)["tasks"] if row["id"] == task["id"])
        close = Path(done["completion_publication_snapshot"]["close_receipt"])
        accepted = close.read_bytes()
        close.write_bytes(accepted + b" ")
        invalidated = next(row for row in work_queue.role_work(self.root, "A")["tasks"] if row["id"] == task["id"])
        self.assertEqual(invalidated["state"], "BLOCKED")
        self.assertTrue(invalidated["completion_invalidated"])
        close.write_bytes(accepted)
        self.assertFalse(any(row["id"] == task["id"] for row in work_queue.role_work(self.root, "A")["tasks"]))

    def test_all_readers_validate_same_committed_generation(self):
        _board, _raw, result = self.migrate([self.ready(), self.done()])
        self.assertEqual(set(result["post_switch"]), {"A", "B", "C", "ORG"})
        self.assertEqual(len({x["snapshot"]["sha256"] for x in result["post_switch"].values()}), 1)

    def test_inspect_default_is_read_only(self):
        _board, raw = self.v1([self.ready()])
        before = sorted(str(p.relative_to(self.root)) for p in self.root.rglob("*"))
        report = migrate.inspect(self.root)
        after = sorted(str(p.relative_to(self.root)) for p in self.root.rglob("*"))
        self.assertEqual(report["mode"], "INSPECT_ONLY")
        self.assertEqual(hashlib.sha256((self.root / "controllers/work-board.json").read_bytes()).hexdigest(), hashlib.sha256(raw).hexdigest())
        self.assertEqual(before, after)

    def test_missing_or_mismatched_authority_has_zero_writes(self):
        _board, raw = self.v1([self.ready()])
        self.grant(raw, alter={"work_queue_sha256": "0"*64})
        before = (self.root / "controllers/work-board.json").read_bytes()
        done = self.root / "controllers/work-board-done"
        for authority in [self.root / "authorizations/missing.json", self.root / "authorizations/CONTROLLER-WORK-BOARD-V2-MIGRATION-test-001.json"]:
            with self.subTest(authority=authority.name), self.assertRaises(RuntimeError):
                migrate.migrate(self.root, authority, self.readers, 4, hashlib.sha256(raw).hexdigest())
            self.assertEqual((self.root / "controllers/work-board.json").read_bytes(), before)
            self.assertFalse(done.exists())

    def test_reused_authority_rejected(self):
        board, raw = self.v1([self.ready()])
        authority = self.grant(raw)
        migrate.migrate(self.root, authority, self.readers, 4, hashlib.sha256(raw).hexdigest())
        with self.assertRaisesRegex(RuntimeError, "ALREADY_USED"):
            migrate.migrate(self.root, authority, self.readers, 4, hashlib.sha256(raw).hexdigest())

    def test_stopped_role_blocks_apply_before_writes(self):
        _board, raw = self.v1([self.ready()])
        authority = self.grant(raw)
        (self.root / "C.json").write_text('{"status":"STOPPED"}')
        before = (self.root / "controllers/work-board.json").read_bytes()
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            migrate.migrate(self.root, authority, self.readers, 4, hashlib.sha256(raw).hexdigest())
        self.assertEqual((self.root / "controllers/work-board.json").read_bytes(), before)
        self.assertFalse((self.root / "controllers/work-board-done").exists())

    def test_existing_role_state_fractional_timestamps_remain_compatible(self):
        (self.root / "C.json").write_text(json.dumps({"role": "C", "status": "RUNNING",
            "review_clock": 1790918735.1846023}))
        before = (self.root / "C.json").read_bytes()
        self.migrate([self.ready()])
        self.assertEqual((self.root / "C.json").read_bytes(), before)
        self.assertEqual(v2.load_state(self.root)["logical"]["version"], 2)
        with self.assertRaisesRegex(ValueError, "float not allowed"):
            v2._strict_object(b'{"revision": 1.5}')

    def test_nonfinite_role_state_numbers_reject_before_migration_writes(self):
        _board, raw = self.v1([self.ready()])
        authority = self.grant(raw)
        (self.root / "controllers/coordination.lock").touch()
        before = self._capacity_snapshot()
        for value in ("NaN", "Infinity", "-Infinity", "1e999"):
            with self.subTest(value=value):
                (self.root / "C.json").write_text('{"status":"RUNNING","review_clock":' + value + '}')
                with self.assertRaisesRegex(ValueError, "non-finite"):
                    migrate.migrate(self.root, authority, self.readers, 4, hashlib.sha256(raw).hexdigest())
                self.assertEqual(self._capacity_snapshot(), before)

    def test_sidecar_split_and_tamper_fail_closed(self):
        entries = []
        for i in range(2000):
            key = f"task-{i:04d}"
            entries.append({"id": key, "role": "A", "plan": "A04", "result": "Done",
                            "requires": [], "ordinal": i, "completion_class": "LEGACY_UNVERIFIED",
                            "completion_receipt": "/control/logs/legacy.json", "completion_generation": 1,
                            "archive_entry_id": "a"*64, "archive_sha256": "b"*64})
        root_hash, count, drafts = v2._trie_drafts(entries, "completed", cap=50000)
        self.assertEqual(count, len(entries))
        self.assertTrue(any(b'"kind":"internal"' in raw for raw in drafts.values()))
        v2._paths(self.root, create=True)
        for (directory, filename), raw in drafts.items():
            path = self.root / "controllers/work-board-done" / directory / filename
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
        self.assertEqual(len(v2._read_trie(self.root, root_hash, count, "completed")), count)
        node = next((self.root / "controllers/work-board-done/nodes").iterdir())
        node.write_bytes(node.read_bytes() + b" ")
        with self.assertRaises(RuntimeError):
            v2._read_trie(self.root, root_hash, count, "completed")

    def test_noncanonical_json_and_duplicate_keys_rejected(self):
        for raw in [b'{"x":1,"x":2}\n', b'{ "x":1}\n', b'{"x":1}\n\n']:
            with self.subTest(raw=raw), self.assertRaises(RuntimeError):
                v2._strict_file(raw, 100)

    def _authority_bytes(self):
        result = {}
        for base in (self.root / "controllers/work-board.json", self.root / "controllers/work-board-events.jsonl",
                     self.root / "controllers/work-board-v2-transactions", self.root / "controllers/work-board-done"):
            if not base.exists():
                result[str(base.relative_to(self.root))] = None
                continue
            if base.is_file():
                result[str(base.relative_to(self.root))] = base.read_bytes()
                continue
            for item in sorted(base.rglob("*")):
                if item.is_file(): result[str(item.relative_to(self.root))] = item.read_bytes()
        return result

    def test_v2_candidate_missing_dependency_rejected_before_any_write(self):
        self.migrate([self.ready()])
        board = v2.load_state(self.root)["logical"]
        board["revision"] += 1
        board["tasks"][0]["requires"] = ["missing-task"]
        before = self._authority_bytes()
        with self.assertRaisesRegex(RuntimeError, "logical v2 candidate"):
            work_queue._persist_board(self.root, board, {"action": "INVALID", "role": "A", "task": "a-one"})
        self.assertEqual(self._authority_bytes(), before)

    def test_completed_generations_survive_real_reopen_and_second_done(self):
        legacy = self.done("b-cycle")
        self.migrate([legacy])
        old_state = v2.load_state(self.root)
        old_entry = old_state["completed_entries"]["b-cycle"]
        negative = self.root / "logs/rework.json"
        negative.write_text(json.dumps({"kind": work_queue.COMPLETION_KIND, "version": 1, "task_id": "b-cycle",
            "candidate_sha": work_queue.current_worktree_head(), "verdict": "FAIL",
            "review": {"verdict": "FAIL", "evidence": ["rework required"]},
            "checks": [{"name": "focused", "verdict": "FAIL", "evidence": ["rework required"]}]}))
        work_queue.advance_task(self.root, "B", "b-cycle", "IN_PROGRESS", str(negative))
        reopened = v2.load_state(self.root)["logical"]["tasks"][0]
        self.assertEqual(reopened["state"], "IN_PROGRESS")
        strict = self.root / "logs/pass.json"
        strict.write_text(json.dumps({"kind": work_queue.COMPLETION_KIND, "version": 1, "task_id": "b-cycle",
            "candidate_sha": work_queue.current_worktree_head(), "verdict": "PASS",
            "review": {"verdict": "PASS", "evidence": ["review"]},
            "checks": [{"name": "focused", "verdict": "PASS", "evidence": ["run"]}]}))
        work_queue.advance_task(self.root, "B", "b-cycle", "DONE", str(strict))
        current = v2.load_state(self.root)
        new_entry = current["completed_entries"]["b-cycle"]
        self.assertEqual(old_entry["completion_generation"], 1)
        self.assertEqual(new_entry["completion_generation"], 2)
        self.assertNotEqual(old_entry["archive_entry_id"], new_entry["archive_entry_id"])
        self.assertEqual(current["hot"]["archive_history_count"], 2)

    def test_crash_after_hot_before_event_recovers_exactly_once(self):
        self.migrate([self.ready()])
        before = v2.load_state(self.root)["logical"]
        changed = copy.deepcopy(before)
        changed["revision"] += 1
        changed["updated_at"] = "2026-10-02T00:02:00+00:00"
        changed["tasks"][0]["state"] = "IN_PROGRESS"
        event = {"at": changed["updated_at"], "role": "A", "task": "a-one", "before": "READY",
                 "state": "IN_PROGRESS", "receipt": "", "revision": changed["revision"]}
        def crash(point):
            if point == "after_hot_published":
                raise Crash()
        with patch.object(v2, "_fault", crash), self.assertRaises(Crash):
            v2.commit_logical_board(self.root, changed, event)
        with self.assertRaisesRegex(RuntimeError, "RECOVERY_REQUIRED"):
            v2.load_state(self.root)
        v2.recover_queue_transaction(self.root)
        self.assertEqual(v2.load_state(self.root)["logical"]["revision"], changed["revision"])
        lines = (self.root / "controllers/work-board-events.jsonl").read_bytes().splitlines()
        self.assertEqual(len(lines), 1)
        v2.recover_queue_transaction(self.root)
        self.assertEqual(len((self.root / "controllers/work-board-events.jsonl").read_bytes().splitlines()), 1)

    def test_migration_failure_after_hot_restores_exact_noncanonical_v1(self):
        board, raw = self.v1([self.ready()])
        authority = self.grant(raw)
        def crash(point):
            if point == "migration_after_hot_before_readback": raise Crash()
        with patch.object(v2, "_fault", crash), self.assertRaises(Crash):
            migrate.migrate(self.root, authority, self.readers, board["revision"], hashlib.sha256(raw).hexdigest())
        self.assertNotEqual((self.root / "controllers/work-board.json").read_bytes(), raw)
        with self.assertRaisesRegex(RuntimeError, "RECOVERY_REQUIRED"):
            v2.load_state(self.root)
        recovered = v2.recover_migration(self.root)
        self.assertEqual(recovered["state"], "ROLLED_BACK")
        self.assertEqual((self.root / "controllers/work-board.json").read_bytes(), raw)
        tx_files = list((self.root / "controllers/work-board-v2-transactions").glob("*.json"))
        self.assertEqual(len(tx_files), 1)
        self.assertEqual(json.loads(tx_files[0].read_text())["state"], "ROLLED_BACK")

    def test_applied_receipt_failure_after_global_commit_does_not_rollback(self):
        board, raw = self.v1([self.ready()])
        authority = self.grant(raw, authority_id="receipt-failure")
        with patch.object(migrate, "_write_exclusive", side_effect=OSError("receipt storage failure")):
            with self.assertRaisesRegex(RuntimeError, "COMMITTED_RECEIPT_OR_READBACK_FAILURE"):
                migrate.migrate(self.root, authority, self.readers, board["revision"], hashlib.sha256(raw).hexdigest())
        self.assertEqual(json.loads((self.root / "controllers/work-board-v2-migration.json").read_text())["state"], "COMMITTED")
        self.assertEqual(json.loads((self.root / "controllers/work-board.json").read_text())["version"], 2)
        self.assertEqual(v2.load_state(self.root)["logical"]["revision"], board["revision"])

    def _fault_fixture(self, root: Path, action: str):
        self.root = root
        (root / "controllers").mkdir(parents=True)
        (root / "logs").mkdir()
        (root / "authorizations").mkdir()
        for role in "ABC":
            (root / f"{role}.json").write_text(json.dumps({"role": role, "status": "RUNNING"}))
            (root / f"{role}.lock").touch()
        (root / "controllers/coordination.lock").touch()
        initial = [self.done("b-reopen")] if action == "reopen" else [self.ready("a-base")]
        board, raw = self.v1(initial)
        authority = self.grant(raw, authority_id="matrix-" + action)
        migrate.migrate(root, authority, self.readers, board["revision"], hashlib.sha256(raw).hexdigest())
        if action == "done":
            work_queue.claim_task(root, "A", "a-base")
        return board

    def test_writer_fault_matrix_claim_add_block_done_reopen(self):
        points = ("after_data_durable", "after_hot_published", "after_event_append_before_event_durable")
        for action in ("claim", "add", "block", "done", "reopen"):
            for point in points:
                with self.subTest(action=action, point=point):
                    case_root = self.root / (action + "-" + point)
                    self._fault_fixture(case_root, action)
                    baseline = v2.load_state(case_root)["logical"]
                    event_path = case_root / "controllers/work-board-events.jsonl"
                    before_events = len(event_path.read_bytes().splitlines()) if event_path.exists() else 0
                    receipt = case_root / "logs/evidence.json"
                    if action == "done":
                        value = {"kind": work_queue.COMPLETION_KIND, "version": 1, "task_id": "a-base",
                                 "candidate_sha": work_queue.current_worktree_head(), "verdict": "PASS",
                                 "review": {"verdict": "PASS", "evidence": ["review"]},
                                 "checks": [{"name": "focused", "verdict": "PASS", "evidence": ["run"]}]}
                        task_id, role, target_state, reason = "a-base", "A", "DONE", ""
                    elif action == "reopen":
                        value = {"kind": work_queue.COMPLETION_KIND, "version": 1, "task_id": "b-reopen",
                                 "candidate_sha": work_queue.current_worktree_head(), "verdict": "FAIL",
                                 "review": {"verdict": "FAIL", "evidence": ["rework"]},
                                 "checks": [{"name": "focused", "verdict": "FAIL", "evidence": ["rework"]}]}
                        task_id, role, target_state, reason = "b-reopen", "B", "IN_PROGRESS", ""
                    else:
                        value = {"evidence": "scoped local"}
                        task_id, role, target_state, reason = "a-base", "A", ("IN_PROGRESS" if action == "claim" else "BLOCKED"), "External gate"
                    receipt.write_text(json.dumps(value))
                    def inject(name):
                        if name == point: raise Crash(name)
                    with patch.object(work_queue._v2(), "_fault", inject), self.assertRaises(Crash):
                        if action == "claim": work_queue.claim_task(case_root, role, task_id)
                        elif action == "add":
                            work_queue.add_task(case_root, "A", {"id": "a-added", "role": "A", "plan": "A04", "state": "READY",
                                "requires": [], "result": "Added", "paths": ["apps/extension/a-added.js"],
                                "acceptance": ["focused check"], "basis": "approved plan remainder"},
                                repo_root=Path(work_queue.__file__).resolve().parents[2])
                        else: work_queue.advance_task(case_root, role, task_id, target_state, str(receipt), reason)
                    tx = v2.recover_queue_transaction(case_root)
                    self.assertIn(tx["state"], {"ROLLED_BACK", "COMMITTED"})
                    after_events = len(event_path.read_bytes().splitlines()) if event_path.exists() else 0
                    expected_commit = point != "after_data_durable"
                    self.assertEqual(after_events - before_events, 1 if expected_commit else 0)
                    after = v2.load_state(case_root)["logical"]
                    if not expected_commit:
                        self.assertEqual(after, baseline)
                    else:
                        self.assertEqual(after["revision"], baseline["revision"] + 1)
                    v2.recover_queue_transaction(case_root)
                    self.assertEqual(len(event_path.read_bytes().splitlines()) if event_path.exists() else 0, after_events)

    def test_torn_exact_event_suffix_recovers_without_duplicate(self):
        self.migrate([self.ready()])
        before = v2.load_state(self.root)["logical"]
        changed = copy.deepcopy(before); changed["revision"] += 1; changed["updated_at"] = "2026-10-02T00:03:00+00:00"
        changed["tasks"][0]["state"] = "IN_PROGRESS"
        event = {"at": changed["updated_at"], "role": "A", "task": "a-one", "before": "READY",
                 "state": "IN_PROGRESS", "receipt": "", "revision": changed["revision"]}
        with patch.object(v2, "_fault", lambda point: (_ for _ in ()).throw(Crash()) if point == "after_hot_published" else None):
            with self.assertRaises(Crash): v2.commit_logical_board(self.root, changed, event)
        tx_path = next(
            path for path in (self.root / "controllers/work-board-v2-transactions").glob("*.json")
            if json.loads(path.read_text()).get("operation_kind") == "QUEUE"
        )
        tx = json.loads(tx_path.read_text())
        line = v2._canonical_bytes(tx["event"])
        (self.root / "controllers/work-board-events.jsonl").write_bytes(line[:23])
        v2.recover_queue_transaction(self.root)
        self.assertEqual((self.root / "controllers/work-board-events.jsonl").read_bytes(), line)
        v2.recover_queue_transaction(self.root)
        self.assertEqual((self.root / "controllers/work-board-events.jsonl").read_bytes(), line)

    def _capacity_snapshot(self):
        # Stream hashes: the orphan-cap fixture is sparse and must not allocate
        # a 512 MiB Python bytes object merely to prove zero mutation.
        result = {}
        for item in sorted((self.root / "controllers").rglob("*")):
            if item.is_file():
                with item.open("rb") as stream:
                    digest = hashlib.file_digest(stream, "sha256").hexdigest()
                result[str(item.relative_to(self.root))] = (item.stat().st_size, digest)
        return result

    def _next_claim(self):
        previous = v2.load_state(self.root)
        board = copy.deepcopy(previous["logical"])
        board["revision"] += 1
        board["tasks"][0]["state"] = "IN_PROGRESS"
        event = {"action": "CLAIM", "role": "A", "task": "a-one", "revision": board["revision"]}
        generated = v2._prepare_generation(self.root, board, previous)
        return previous, board, event, generated

    def _fill_event_bytes(self, size):
        empty = v2._canonical_bytes({"padding": ""})
        remaining = size
        with (self.root / "controllers/work-board-events.jsonl").open("wb") as stream:
            while remaining:
                length = min(remaining, v2.EVENT_LINE_CAP_BYTES)
                if 0 < remaining - length < len(empty):
                    length -= len(empty)
                self.assertGreaterEqual(length, len(empty))
                stream.write(v2._canonical_bytes({"padding": "x" * (length - len(empty))}))
                remaining -= length

    def test_actual_event_total_exact_64mib_and_plus_one_zero_mutation(self):
        self.migrate([self.ready()])
        previous, board, event, generated = self._next_claim()
        _hot, _raw, tx = v2._build_queue_tx(previous, generated, event)
        line_size = len(v2._canonical_bytes(tx["event"]))
        self.assertEqual(v2.EVENT_LOG_CAP_BYTES, 64 * 1024 * 1024)
        self._fill_event_bytes(v2.EVENT_LOG_CAP_BYTES - line_size + 1)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "EVENT_LOG_CAPACITY"):
            v2.commit_logical_board(self.root, board, event)
        self.assertEqual(self._capacity_snapshot(), before)
        self._fill_event_bytes(v2.EVENT_LOG_CAP_BYTES - line_size)
        v2.commit_logical_board(self.root, board, event)
        self.assertEqual((self.root / "controllers/work-board-events.jsonl").stat().st_size, v2.EVENT_LOG_CAP_BYTES)
        self.assertEqual(v2.load_state(self.root)["logical"], board)

    def _filler_journal(self, previous, generated, number, size=None):
        event = {"action": "FIXTURE", "role": "C", "task": f"capacity-{number:06d}", "padding": ""}
        _hot, _raw, tx = v2._build_queue_tx(previous, generated, event)
        tx["state"] = "COMMITTED"
        if size is not None:
            event["padding"] = "x" * (size - len(v2._canonical_bytes(tx)))
            _hot, _raw, tx = v2._build_queue_tx(previous, generated, event)
            tx["state"] = "COMMITTED"
        raw = v2._journal_text(tx)
        if size is not None: self.assertEqual(len(raw), size)
        path = self.root / "controllers/work-board-v2-transactions" / (tx["operation_id"] + ".json")
        path.write_bytes(raw)
        return path

    def test_actual_hot_256kib_exact_and_plus_one_before_journal(self):
        self.migrate([self.ready()])
        previous, board, event, generated = self._next_claim()
        _hot, raw, _tx = v2._build_queue_tx(previous, generated, event)
        self.assertEqual(v2.HOT_CAP_BYTES, 256 * 1024)
        board["tasks"][0]["result"] += "x" * (v2.HOT_CAP_BYTES - len(raw) + 1)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID: size"):
            v2.commit_logical_board(self.root, board, event)
        self.assertEqual(self._capacity_snapshot(), before)
        board["tasks"][0]["result"] = board["tasks"][0]["result"][:-1]
        v2.commit_logical_board(self.root, board, event)
        self.assertEqual((self.root / "controllers/work-board.json").stat().st_size, v2.HOT_CAP_BYTES)

    def test_actual_active_count_100_and_101_rejection(self):
        self.migrate([self.ready(f"a-{number}") for number in range(99)])
        def add(number):
            return work_queue.add_task(self.root, "A", dict(self.ready(f"a-{number}"), acceptance=["bounded"], basis="approved plan remainder"), repo_root=Path(work_queue.__file__).resolve().parents[2])
        add(99)
        self.assertEqual(len(v2.load_state(self.root)["hot"]["tasks"]), 100)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "SEMANTIC_ACTIVE_TASK_CAP"): add(100)
        self.assertEqual(self._capacity_snapshot(), before)

    def test_actual_event_line_64kib_exact_and_plus_one(self):
        self.migrate([self.ready()])
        previous, board, event, generated = self._next_claim()
        event["padding"] = ""
        _hot, _raw, tx = v2._build_queue_tx(previous, generated, event)
        event["padding"] = "x" * (v2.EVENT_LINE_CAP_BYTES - len(v2._canonical_bytes(tx["event"])) + 1)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "EVENT_LINE_CAPACITY"):
            v2.commit_logical_board(self.root, board, event)
        self.assertEqual(self._capacity_snapshot(), before)
        event["padding"] = event["padding"][:-1]
        v2.commit_logical_board(self.root, board, event)
        self.assertEqual((self.root / "controllers/work-board-events.jsonl").stat().st_size, 65536)

    def test_maximum_v1_row_wraps_below_archive_cap_and_oversize_leaf_refuses(self):
        row = self.done()
        _board, raw = self.v1([row])
        row["result"] += "x" * (v2.HOT_CAP_BYTES - len(raw))
        board, raw = self.v1([row])
        self.assertEqual(len(raw), v2.HOT_CAP_BYTES)
        drafts = {}
        entry, _history = v2._make_archive(self.root, row, 0, 1, drafts)
        self.assertEqual(len(drafts), 1)
        wrapper = next(iter(drafts.values()))
        self.assertLessEqual(len(wrapper), v2.ARCHIVE_CAP_BYTES)
        self.assertEqual(v2._strict_file(wrapper, v2.ARCHIVE_CAP_BYTES)["row"], row)
        before = self._capacity_snapshot()
        # The separate index-node cap still applies. An unsplittable metadata
        # entry must refuse before sidecar publication, never exceed the cap.
        with self.assertRaisesRegex(RuntimeError, "COMPLETED_CAPACITY"):
            v2.build_generation_from_v1(self.root, board)
        self.assertEqual(self._capacity_snapshot(), before)

    def test_authority_exact_128kib_and_plus_one(self):
        board, raw = self.v1([self.ready()])
        authority = self.grant(raw)
        grant = authority.read_bytes()
        (self.root / "controllers/coordination.lock").touch()
        authority.write_bytes(grant + b" " * (migrate.AUTH_CAP - len(grant) + 1))
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "AUTHORITY_FILE_INVALID"):
            migrate.migrate(self.root, authority, self.readers, 4, hashlib.sha256(raw).hexdigest())
        self.assertEqual(self._capacity_snapshot(), before)
        authority.write_bytes(grant + b" " * (migrate.AUTH_CAP - len(grant)))
        migrate.migrate(self.root, authority, self.readers, 4, hashlib.sha256(raw).hexdigest())
        self.assertEqual(v2.load_state(self.root)["logical"]["tasks"], board["tasks"])

    def test_fifo_storage_rejects_without_waiting_for_a_writer(self):
        os.mkfifo(self.root / "controllers/work-board.json")
        script = "import sys; from pathlib import Path; import work_board_v2 as v2\ntry: v2.storage_version(Path(sys.argv[1]))\nexcept RuntimeError as e:\n assert str(e) == 'WORK_BOARD_V2_STORAGE_NOT_REGULAR'\nelse: raise AssertionError('FIFO accepted')\n"
        result = subprocess.run([sys.executable, "-c", script, str(self.root)], cwd=Path(v2.__file__).parent,
                                capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_actual_journal_4095_to_4096_then_new_operation_rejects(self):
        self.migrate([self.ready()])
        previous, board, event, generated = self._next_claim()
        self.assertEqual(v2.JOURNAL_COUNT_CAP, 4096)
        for number in range(4094): self._filler_journal(previous, generated, number)
        self.assertEqual(len(list((self.root / "controllers/work-board-v2-transactions").iterdir())), 4095)
        v2.commit_logical_board(self.root, board, event)
        self.assertEqual(len(list((self.root / "controllers/work-board-v2-transactions").iterdir())), 4096)
        board = copy.deepcopy(board); board["revision"] += 1; board["tasks"][0]["state"] = "BLOCKED"
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "TRANSACTION_CAPACITY"):
            v2.commit_logical_board(self.root, board, dict(event, action="BLOCK", revision=board["revision"]))
        self.assertEqual(self._capacity_snapshot(), before)

    def test_actual_journal_64mib_admission_peak_includes_full_rewrite_reserve(self):
        self.migrate([self.ready()])
        previous, board, event, generated = self._next_claim()
        _hot, _raw, tx = v2._build_queue_tx(previous, generated, event)
        directory = self.root / "controllers/work-board-v2-transactions"
        existing = sum(path.stat().st_size for path in directory.iterdir())
        self.assertEqual(v2.JOURNAL_DIR_CAP_BYTES, 64 * 1024 * 1024)
        self.assertEqual(v2.JOURNAL_REWRITE_RESERVE_BYTES, 128 * 1024)
        target = v2.JOURNAL_DIR_CAP_BYTES - len(v2._journal_text(tx)) - v2.JOURNAL_REWRITE_RESERVE_BYTES
        remaining = target - existing
        number = 0
        while remaining > 65536:
            size = 65536 if remaining - 65536 >= 4096 else 61440
            self._filler_journal(previous, generated, number, size)
            number += 1; remaining -= size
        last = self._filler_journal(previous, generated, number, remaining + 1)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "TRANSACTION_CAPACITY"):
            v2.commit_logical_board(self.root, board, event)
        self.assertEqual(self._capacity_snapshot(), before)
        last.unlink()
        self._filler_journal(previous, generated, number, remaining)
        self.assertEqual(sum(path.stat().st_size for path in directory.iterdir()) + len(v2._journal_text(tx)) + v2.JOURNAL_REWRITE_RESERVE_BYTES, v2.JOURNAL_DIR_CAP_BYTES)
        v2.commit_logical_board(self.root, board, event)
        self.assertEqual(v2.load_state(self.root)["logical"], board)

    def test_actual_done_physical_cap_counts_sparse_unreferenced_file(self):
        self.migrate([self.ready()])
        _previous, board, event, _generated = self._next_claim()
        size, _files = v2._walk_done(self.root)
        orphan = self.root / "controllers/work-board-done/rows" / ("f" * 64 + ".json")
        self.assertEqual(v2.DONE_STORAGE_CAP_BYTES, 512 * 1024 * 1024)
        with orphan.open("wb") as stream: stream.truncate(v2.DONE_STORAGE_CAP_BYTES - size + 1)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "DONE_STORAGE_CAPACITY"):
            v2.commit_logical_board(self.root, board, event)
        self.assertEqual(self._capacity_snapshot(), before)
        with orphan.open("r+b") as stream: stream.truncate(v2.DONE_STORAGE_CAP_BYTES - size)
        v2.commit_logical_board(self.root, board, event)
        self.assertEqual(v2.load_state(self.root)["logical"], board)

    def test_all_normal_writers_reject_event_plus_one_before_any_mutation(self):
        base = self.root
        for action in ("claim", "add", "block", "done", "reopen"):
            with self.subTest(action=action):
                self._fault_fixture(base / ("capacity-" + action), action)
                receipt = self.root / "logs/boundary-receipt.json"
                task_id, role = ("b-reopen", "B") if action == "reopen" else ("a-base", "A")
                verdict = "FAIL" if action == "reopen" else "PASS"
                receipt.write_text(json.dumps({"kind": work_queue.COMPLETION_KIND, "version": 1,
                    "task_id": task_id, "candidate_sha": work_queue.current_worktree_head(), "verdict": verdict,
                    "review": {"verdict": verdict, "evidence": ["boundary fixture"]},
                    "checks": [{"name": "boundary", "verdict": verdict, "evidence": ["fixture"]}]}))
                def call_action():
                    if action == "claim": return work_queue.claim_task(self.root, role, task_id)
                    if action == "add":
                        return work_queue.add_task(self.root, "A", dict(self.ready("a-added"), acceptance=["bounded"], basis="approved plan remainder"), repo_root=Path(work_queue.__file__).resolve().parents[2])
                    return work_queue.advance_task(self.root, role, task_id, {"block": "BLOCKED", "done": "DONE", "reopen": "IN_PROGRESS"}[action], str(receipt), "capacity fixture")
                class FixedClock:
                    @staticmethod
                    def now(_tz=None):
                        return dt.datetime(2026, 10, 2, 12, 0, 0, 123456, tzinfo=dt.timezone.utc)
                def run():
                    with patch.object(work_queue, "datetime", FixedClock):
                        return call_action()
                captured = {}
                def capture(root, board, event):
                    captured.update(board=copy.deepcopy(board), event=copy.deepcopy(event))
                    raise Crash()
                with patch.object(work_queue, "_persist_board", capture), self.assertRaises(Crash): run()
                core = work_queue._v2()
                previous = core.load_state(self.root)
                generated = core._prepare_generation(self.root, captured["board"], previous)
                _hot, _raw, tx = core._build_queue_tx(previous, generated, captured["event"])
                event_path = self.root / "controllers/work-board-events.jsonl"
                prior_size = event_path.stat().st_size if event_path.exists() else 0
                exact = prior_size + len(core._canonical_bytes(tx["event"]))
                before = self._capacity_snapshot()
                # Only the measured total is reduced; normal writer policy,
                # receipt validation, generation, locks and persistence run.
                with patch.object(core, "EVENT_LOG_CAP_BYTES", exact - 1):
                    with self.assertRaisesRegex(RuntimeError, "EVENT_LOG_CAPACITY"): run()
                self.assertEqual(self._capacity_snapshot(), before)
                with patch.object(core, "EVENT_LOG_CAP_BYTES", exact): run()
                self.assertEqual(event_path.stat().st_size, exact)

    def _resolve_blocker_fixture(self):
        blocked_receipt = self.root / "logs/old-blocked.json"
        blocked_receipt.write_text('{"reason":"historical superseded attempt"}')
        old = {"id": "old-attempt", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
               "result": "Historical failed attempt", "paths": ["tooling/old.py"],
               "blocked_reason": "Superseded", "blocked_receipt": str(blocked_receipt)}
        successor = {"id": "accepted-successor", "role": "B", "plan": "C00", "state": "IN_PROGRESS", "requires": [],
                     "result": "Accepted successor", "paths": ["tooling/new.py"]}
        self.migrate([old, successor])
        receipt = self.root / "logs/successor-completion.json"
        receipt.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND, "version": 1,
            "task_id": "accepted-successor", "candidate_sha": work_queue.current_worktree_head(),
            "verdict": "PASS", "review": {"verdict": "PASS", "evidence": ["independent review"]},
            "checks": [{"name": "focused", "verdict": "PASS", "evidence": ["test run"]}],
        }))
        work_queue.advance_task(self.root, "B", "accepted-successor", "DONE", str(receipt))
        resolved = work_queue.resolve_blocker(
            self.root, "B", "old-attempt", "accepted-successor", str(receipt)
        )
        return old, successor, receipt, resolved

    def test_resolved_blocker_persists_in_v2_and_realerts_if_successor_invalidates(self):
        _old, _successor, receipt, resolved = self._resolve_blocker_fixture()
        self.assertEqual(resolved["resolution_status"], "RESOLVED")
        state = v2.load_state(self.root)
        logical = state["logical"]
        old_row = next(row for row in logical["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(old_row["state"], "BLOCKED")
        self.assertEqual(old_row["blocker_resolution"]["successor_task"], "accepted-successor")
        self.assertFalse(any(row["task_id"] == "old-attempt" for row in work_queue.blocker_attention(logical)))
        hot = json.loads((self.root / "controllers/work-board.json").read_text())
        hot_old = next(row for row in hot["tasks"] if row["id"] == "old-attempt")
        self.assertTrue(v2._is_resolved_blocker_tombstone(hot_old))
        self.assertEqual(hot_old["state"], "BLOCKED")
        self.assertEqual(hot_old["role"], old_row["role"])
        self.assertEqual(hot_old["plan"], old_row["plan"])
        self.assertEqual(hot_old["requires"], old_row["requires"])
        self.assertEqual(hot_old["result"], "R")
        self.assertEqual(hot_old["blocked_reason"], "R")
        self.assertEqual(hot_old["blocked_receipt"], old_row["blocked_receipt"])
        self.assertEqual(hot_old["blocker_resolution"], old_row["blocker_resolution"])
        self.assertRegex(hot_old["resolved_archive_sha256"], r"^[0-9a-f]{64}$")
        archive = self.root / "controllers/work-board-done/rows" / (
            hot_old["resolved_archive_sha256"] + ".json"
        )
        self.assertTrue(archive.is_file())
        wrapper = json.loads(archive.read_text())
        self.assertEqual(wrapper["kind"], "resolved_blocker")
        self.assertEqual(wrapper["row"], old_row)
        self.assertFalse(any(row["id"] == "accepted-successor" for row in hot["tasks"]))

        value = json.loads(receipt.read_text())
        value["checks"][0]["verdict"] = "FAIL"
        receipt.write_text(json.dumps(value))
        stale = work_queue.role_work(self.root, "B")
        old_view = next(row for row in stale["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(old_view["resolution_status"], "STALE_RESOLUTION")
        self.assertTrue(any(row["task_id"] == "old-attempt" for row in stale["owner_attention"]))

    def test_indexed_cold_history_root_roundtrip_and_writer_disabled_preserve(self):
        old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        previous = v2.load_state(self.root)
        original = next(t for t in previous["logical"]["tasks"] if t["id"] == old["id"])
        self.assertNotIn("resolved_blocker_root_hash", previous["hot"])
        with patch.object(work_queue._v2(), "RESOLVED_COLD_INDEX_WRITES_ENABLED", True):
            work_queue.add_task(
                self.root, "A",
                dict(self.ready("cold-first"), basis="C00 P1 root-count",
                     acceptance=["all archived identity remains"]),
                repo_root=Path(work_queue.__file__).resolve().parents[2],
            )
        indexed = v2.load_state(self.root)
        self.assertEqual(indexed["hot"]["resolved_blocker_count"], 1)
        self.assertRegex(indexed["hot"]["resolved_blocker_root_hash"], r"^[0-9a-f]{64}$")
        self.assertFalse(any(t["id"] == old["id"] for t in indexed["hot"]["tasks"]))
        self.assertEqual(
            next(t for t in indexed["logical"]["tasks"] if t["id"] == old["id"]),
            original,
        )
        entries = v2._read_trie(
            self.root, indexed["hot"]["resolved_blocker_root_hash"],
            indexed["hot"]["resolved_blocker_count"], "resolved_blocker",
        )
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["id"], old["id"])
        self.assertEqual(entries[0]["ordinal"], previous["ordinals"][old["id"]])
        self.assertEqual(entries[0]["row_sha256"], v2._semantic_sha(original))
        self.assertEqual(
            v2._read_indexed_resolved_blocker(indexed["paths"], entries[0]),
            (original, previous["ordinals"][old["id"]]),
        )
        journal = v2._transaction_for_operation(
            self.root, indexed["hot"]["last_operation_id"],
        )
        self.assertEqual(
            journal["resolved_blocker_root_hash"],
            indexed["hot"]["resolved_blocker_root_hash"],
        )
        self.assertEqual(journal["resolved_blocker_count"], 1)
        self.assertEqual(journal["state"], "COMMITTED")
        self.assertFalse(work_queue.blocker_attention(indexed["logical"], root=self.root))

        # Once an indexed generation is seen it must not be silently
        # inflated by a different source-controlled writer flag.
        self.assertIs(work_queue._v2().RESOLVED_COLD_INDEX_WRITES_ENABLED, False)
        work_queue.add_task(
            self.root, "A",
            dict(self.ready("cold-followup"), basis="C00 cold generation",
                 acceptance=["no hot reinflation"]),
            repo_root=Path(work_queue.__file__).resolve().parents[2],
        )
        followup = v2.load_state(self.root)
        self.assertEqual(followup["hot"]["resolved_blocker_count"], 1)
        self.assertEqual(
            followup["hot"]["resolved_blocker_root_hash"],
            indexed["hot"]["resolved_blocker_root_hash"],
        )
        self.assertFalse(any(t["id"] == old["id"] for t in followup["hot"]["tasks"]))
        self.assertEqual(
            next(t for t in followup["logical"]["tasks"] if t["id"] == old["id"]),
            original,
        )

    def test_indexed_cold_history_stale_successor_realerts_unchanged_hot(self):
        old, successor, receipt, _resolved = self._resolve_blocker_fixture()
        with patch.object(work_queue._v2(), "RESOLVED_COLD_INDEX_WRITES_ENABLED", True):
            work_queue.add_task(
                self.root, "A",
                dict(self.ready("cold-stale"), basis="C00 invalidate source",
                     acceptance=["preserve re-alert evidence"]),
                repo_root=Path(work_queue.__file__).resolve().parents[2],
            )
        state = v2.load_state(self.root)
        full = next(t for t in state["logical"]["tasks"] if t["id"] == old["id"])
        self.assertEqual(state["hot"]["resolved_blocker_count"], 1)
        self.assertFalse(any(t["id"] == old["id"] for t in state["hot"]["tasks"]))
        self.assertFalse(any(x["task_id"] == old["id"] for x in work_queue.blocker_attention(state["logical"], root=self.root)))
        original_hot = state["hot_sha256"]
        original_revision = state["logical"]["revision"]
        original_index_root = state["hot"]["resolved_blocker_root_hash"]
        value = json.loads(receipt.read_text())
        value["checks"][0]["verdict"] = "FAIL"
        receipt.write_text(json.dumps(value))
        view = work_queue.role_work(self.root, "B")
        stale = next(t for t in view["tasks"] if t["id"] == old["id"])
        self.assertEqual(stale["resolution_status"], "STALE_RESOLUTION")
        self.assertEqual(stale["state"], "BLOCKED")
        attention = next(t for t in view["owner_attention"] if t["task_id"] == old["id"])
        self.assertEqual(attention["evidence"], full["blocked_receipt"])
        self.assertEqual(attention["resolution_status"], "STALE_RESOLUTION")
        self.assertIn(successor["id"], attention["reason"])
        self.assertIn("Повторно принять exact successor", attention["next_action"])
        current = v2.load_state(self.root)
        self.assertEqual(current["hot_sha256"], original_hot)
        self.assertEqual(current["logical"]["revision"], original_revision)
        self.assertEqual(current["hot"]["resolved_blocker_root_hash"], original_index_root)
        self.assertEqual(
            next(t for t in current["logical"]["tasks"] if t["id"] == old["id"]),
            full,
        )
        self.assertNotIn(old["id"], current["completed_entries"])
        self.assertNotIn(old["id"], work_queue._BoardEvaluation(current["logical"], root=self.root).done)

    def test_indexed_cold_history_growth_has_bounded_hot_and_tamper_fails(self):
        old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        before = v2.load_state(self.root)
        original = next(t for t in before["logical"]["tasks"] if t["id"] == old["id"])
        def projected(extra):
            logical = copy.deepcopy(before["logical"])
            logical["revision"] += 1
            for index in range(extra):
                row = copy.deepcopy(original)
                row["id"] = f"cold-history-{index:05d}"
                row["paths"] = [f"tooling/coordination/cold-{index:05d}.py"]
                logical["tasks"].append(row)
            with patch.object(v2, "RESOLVED_COLD_INDEX_WRITES_ENABLED", True):
                generated = v2._prepare_generation(self.root, logical, before)
            self.assertEqual(generated["core"]["resolved_blocker_count"], extra + 1)
            self.assertFalse(any(
                item["id"] in {old["id"]} | {f"cold-history-{k:05d}" for k in range(extra)}
                for item in generated["core"]["tasks"]
            ))
            return v2._canonical_bytes(generated["core"]), generated
        small, _ = projected(4)
        large, large_gen = projected(90)
        self.assertLess(len(large) - len(small), 20)
        self.assertLess(len(large), v2.HOT_CAP_BYTES)
        self.assertTrue(any(key[0] == "nodes" for key in large_gen["drafts"]))
        self.assertTrue(any(key[0] == "rows" for key in large_gen["drafts"]))
        # A physical one-record commit tests the authenticated root/count and
        # archive lookup, then independently forged hot input must fail.
        with patch.object(work_queue._v2(), "RESOLVED_COLD_INDEX_WRITES_ENABLED", True):
            work_queue.add_task(
                self.root, "A",
                dict(self.ready("cold-corruption"), basis="C00 archive integrity",
                     acceptance=["source hash rejection"]),
                repo_root=Path(work_queue.__file__).resolve().parents[2],
            )
        accepted = v2.load_state(self.root)
        forged = copy.deepcopy(accepted["hot"])
        forged["resolved_blocker_count"] += 1
        forged["generation_id"] = v2._generation_id(v2._hot_core(forged))
        with self.assertRaisesRegex(RuntimeError, "TRIE_COUNT_MISMATCH"):
            v2._load_state(self.root, v2._canonical_bytes(forged), require_committed=False)
        index_path = accepted["paths"]["nodes"] / (
            accepted["hot"]["resolved_blocker_root_hash"] + ".json"
        )
        archived_index = index_path.read_bytes()
        index_path.write_bytes(archived_index + b" ")
        with self.assertRaisesRegex(RuntimeError, "HASH_MISMATCH"):
            v2.load_state(self.root)
        index_path.write_bytes(archived_index)
        self.assertEqual(v2.load_state(self.root)["logical"], accepted["logical"])

    def test_indexed_cold_history_recover_faulted_v2_journal(self):
        old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        original = next(
            row for row in v2.load_state(self.root)["logical"]["tasks"]
            if row["id"] == old["id"]
        )
        for point, expected in (
            ("after_data_durable", "ROLLED_BACK"),
            ("after_hot_replace_before_hot_published", "COMMITTED"),
            ("after_event_append_before_event_durable", "COMMITTED"),
        ):
            with self.subTest(point=point):
                previous = v2.load_state(self.root)
                event_file = self.root / "controllers/work-board-events.jsonl"
                count_before = len(event_file.read_bytes().splitlines())
                new_id = "cold-fault-" + point
                task = dict(
                    self.ready(new_id), basis="C00 indexed journal crash recovery",
                    acceptance=["exact cold root and event binding"],
                )

                def crash(at):
                    if at == point:
                        raise Crash(point)

                with patch.object(work_queue._v2(), "RESOLVED_COLD_INDEX_WRITES_ENABLED", True):
                    with patch.object(work_queue._v2(), "_fault", side_effect=crash):
                        with self.assertRaises(Crash):
                            work_queue.add_task(
                                self.root, "A", task,
                                repo_root=Path(work_queue.__file__).resolve().parents[2],
                            )
                recovered = v2.recover_queue_transaction(self.root)
                self.assertEqual(recovered["state"], expected)
                after = v2.load_state(self.root)
                committed = expected == "COMMITTED"
                self.assertEqual(
                    after["logical"]["revision"],
                    previous["logical"]["revision"] + int(committed),
                )
                self.assertEqual(
                    len(event_file.read_bytes().splitlines()),
                    count_before + int(committed),
                )
                self.assertEqual(
                    any(row["id"] == new_id for row in after["logical"]["tasks"]),
                    committed,
                )
                self.assertIsNone(v2.recover_queue_transaction(self.root))
                hydrated = next(
                    row for row in after["logical"]["tasks"] if row["id"] == old["id"]
                )
                self.assertEqual(hydrated, original)
                if committed:
                    self.assertEqual(after["hot"]["resolved_blocker_count"], 1)
                    self.assertFalse(any(
                        row["id"] == old["id"] for row in after["hot"]["tasks"]
                    ))
                    journal = v2._transaction_for_operation(
                        self.root, after["hot"]["last_operation_id"]
                    )
                    self.assertEqual(
                        journal["resolved_blocker_root_hash"],
                        after["hot"]["resolved_blocker_root_hash"],
                    )
                    self.assertEqual(journal["resolved_blocker_count"], 1)
                else:
                    self.assertNotIn("resolved_blocker_root_hash", after["hot"])

    def test_indexed_cold_history_refuses_duplicate_identity_and_metadata_spoof(self):
        old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        with patch.object(work_queue._v2(), "RESOLVED_COLD_INDEX_WRITES_ENABLED", True):
            work_queue.add_task(
                self.root, "A",
                dict(self.ready("cold-unique-task"), basis="C00 strict identity",
                     acceptance=["no duplicate cold/live IDs or ordinals"]),
                repo_root=Path(work_queue.__file__).resolve().parents[2],
            )
        state = v2.load_state(self.root)
        cold_id = old["id"]
        cold_ordinal = state["ordinals"][cold_id]
        self.assertEqual(state["hot"]["resolved_blocker_count"], 1)
        self.assertFalse(any(row["id"] == cold_id for row in state["hot"]["tasks"]))
        for attack in ("duplicate_id", "duplicate_ordinal"):
            with self.subTest(attack=attack):
                forged = copy.deepcopy(state["hot"])
                hot_task = next(row for row in forged["tasks"]
                                if row["id"] == "cold-unique-task")
                if attack == "duplicate_id":
                    hot_task["id"] = cold_id
                else:
                    hot_task["_ordinal"] = cold_ordinal
                forged["generation_id"] = v2._generation_id(v2._hot_core(forged))
                with self.assertRaisesRegex(RuntimeError, "WORK_BOARD_V2_DUPLICATE_ID"):
                    v2._load_state(
                        self.root, v2._canonical_bytes(forged),
                        require_committed=False,
                    )

        entries = v2._read_trie(
            self.root, state["hot"]["resolved_blocker_root_hash"],
            state["hot"]["resolved_blocker_count"], "resolved_blocker",
        )
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        for key, value in (
            ("role", "A" if entry["role"] != "A" else "B"),
            ("plan", "B04" if entry["plan"] != "B04" else "C00"),
            ("requires", ["forged"]),
            ("row_sha256", "0" * 64),
            ("blocked_receipt", "/wrong/receipt"),
        ):
            with self.subTest(forged_key=key):
                forged = copy.deepcopy(entry)
                forged[key] = value
                with self.assertRaises(RuntimeError):
                    v2._read_indexed_resolved_blocker(state["paths"], forged)
        forged = dict(entry, unexpected_source_authority=True)
        with self.assertRaisesRegex(RuntimeError, "RESOLVED_INDEX_ENTRY_INVALID"):
            v2._read_indexed_resolved_blocker(state["paths"], forged)
        self.assertEqual(v2.load_state(self.root)["logical"], state["logical"])

    def test_marker2_resolved_blocker_successor_invalidation_realerts_original(self):
        old, successor, receipt, resolved = self._resolve_blocker_fixture()
        self.assertEqual(resolved["resolution_status"], "RESOLVED")
        original = next(
            task for task in v2.load_state(self.root)["logical"]["tasks"]
            if task["id"] == old["id"]
        )
        assert original["state"] == "BLOCKED"
        with patch.object(work_queue._v2(), "COMPACT_RESOLVED_WRITES_ENABLED", True):
            work_queue.add_task(
                self.root, "A",
                dict(self.ready("marker2-realert"), basis="C00 P2 archive re-alert",
                     acceptance=["old original blocker evidence preserved"]),
                repo_root=Path(work_queue.__file__).resolve().parents[2],
            )
        indexed = v2.load_state(self.root)
        marker = next(t for t in indexed["hot"]["tasks"] if t["id"] == old["id"])
        self.assertEqual(marker["resolved_cold_ref_schema"], 2)
        self.assertEqual(marker["blocker_resolution"], {"status": "RESOLVED"})
        archived = next(t for t in indexed["logical"]["tasks"] if t["id"] == old["id"])
        self.assertEqual(archived, original)
        self.assertEqual(archived["blocked_receipt"], str(self.root / "logs/old-blocked.json"))
        self.assertFalse(any(x["task_id"] == old["id"] for x in work_queue.blocker_attention(indexed["logical"], root=self.root)))
        original_hot_sha = indexed["hot_sha256"]
        original_revision = indexed["logical"]["revision"]
        original_archive_sha = marker["resolved_archive_sha256"]
        value = json.loads(receipt.read_text())
        value["checks"][0]["verdict"] = "FAIL"
        receipt.write_text(json.dumps(value))
        after = work_queue.role_work(self.root, "B")
        row = next(t for t in after["tasks"] if t["id"] == old["id"])
        self.assertEqual(row["state"], "BLOCKED")
        self.assertEqual(row["resolution_status"], "STALE_RESOLUTION")
        self.assertEqual(row["successor_task"], successor["id"])
        alert = next(t for t in after["owner_attention"] if t["task_id"] == old["id"])
        self.assertEqual(alert["evidence"], original["blocked_receipt"])
        self.assertEqual(alert["resolution_status"], "STALE_RESOLUTION")
        self.assertIn(successor["id"], alert["reason"])
        self.assertIn("Повторно принять exact successor", alert["next_action"])
        self.assertFalse(any(x["task_id"] == old["id"] for x in work_queue.blocker_attention(indexed["logical"], root=self.root) if x["resolution_status"] == "RESOLVED"))
        final = v2.load_state(self.root)
        self.assertEqual(final["logical"]["revision"], original_revision)
        self.assertEqual(final["hot_sha256"], original_hot_sha)
        compact = next(t for t in final["hot"]["tasks"] if t["id"] == old["id"])
        self.assertEqual(compact["resolved_archive_sha256"], original_archive_sha)
        self.assertEqual(next(t for t in final["logical"]["tasks"] if t["id"] == old["id"]), original)
        self.assertFalse(any(t["id"] == old["id"] for t in final["completed_entries"].values()))
        self.assertNotIn(old["id"], work_queue._BoardEvaluation(final["logical"], root=self.root).done)

    def test_resolved_blocker_archive_missing_tampered_or_semantically_wrong_fails_closed(self):
        _old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        hot = json.loads((self.root / "controllers/work-board.json").read_text())
        tombstone = next(row for row in hot["tasks"] if row["id"] == "old-attempt")
        archive = self.root / "controllers/work-board-done/rows" / (
            tombstone["resolved_archive_sha256"] + ".json"
        )
        accepted = archive.read_bytes()
        archive.unlink()
        with self.assertRaisesRegex(RuntimeError, "CONTENT_MISSING"):
            v2.load_state(self.root)

        archive.write_bytes(accepted.replace(b'"resolved_blocker"', b'"resolved_blockerX"', 1))
        with self.assertRaisesRegex(RuntimeError, "HASH_MISMATCH"):
            v2.load_state(self.root)

        wrapper = json.loads(accepted)
        wrapper["row"]["state"] = "READY"
        wrapper["row_sha256"] = v2._semantic_sha(wrapper["row"])
        wrong = v2._canonical_bytes(wrapper)
        wrong_sha = hashlib.sha256(wrong).hexdigest()
        wrong_path = archive.parent / (wrong_sha + ".json")
        wrong_path.write_bytes(wrong)
        wrong_tombstone = dict(tombstone, resolved_archive_sha256=wrong_sha)
        with self.assertRaisesRegex(RuntimeError, "RESOLVED_BLOCKER_ARCHIVE_MISMATCH"):
            v2._read_resolved_blocker_archive(v2._paths(self.root), wrong_tombstone)

    def test_old_v2_full_resolved_blocker_hot_row_remains_readable_and_compacts_next_generation(self):
        _old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        state = v2.load_state(self.root)
        hot = copy.deepcopy(state["hot"])
        logical_old = next(row for row in state["logical"]["tasks"] if row["id"] == "old-attempt")
        index = next(i for i, row in enumerate(hot["tasks"]) if row["id"] == "old-attempt")
        ordinal = hot["tasks"][index]["_ordinal"]
        full = dict(logical_old, _ordinal=ordinal)
        hot["tasks"][index] = full
        hot["generation_id"] = v2._generation_id(v2._hot_core(hot))
        old_style_raw = v2._canonical_bytes(hot)

        loaded = v2._load_state(self.root, old_style_raw, require_committed=False)
        loaded_old = next(row for row in loaded["logical"]["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(loaded_old, logical_old)

        board = copy.deepcopy(loaded["logical"])
        board["revision"] += 1
        board["updated_at"] = "2026-10-04T00:01:00+00:00"
        generated = v2._prepare_generation(self.root, board, loaded)
        generated_old = next(row for row in generated["core"]["tasks"] if row["id"] == "old-attempt")
        self.assertTrue(v2._is_resolved_blocker_tombstone(generated_old))
        self.assertEqual(generated_old["result"], "R")
        self.assertEqual(generated_old["blocked_reason"], "R")
        self.assertEqual(generated_old["blocker_resolution"], logical_old["blocker_resolution"])
        self.assertIn(("rows", generated_old["resolved_archive_sha256"] + ".json"), generated["drafts"])

    def test_compat_tombstone_keeps_old_reader_policy_and_pointer_across_old_writer_shape(self):
        _old, _successor, receipt, _resolved = self._resolve_blocker_fixture()
        state = v2.load_state(self.root)
        logical = copy.deepcopy(state["logical"])
        full_old = next(row for row in logical["tasks"] if row["id"] == "old-attempt")
        hot = json.loads((self.root / "controllers/work-board.json").read_text())
        compat_hot = next(row for row in hot["tasks"] if row["id"] == "old-attempt")
        ordinal = compat_hot["_ordinal"]
        compat_logical = dict(compat_hot)
        compat_logical.pop("_ordinal")

        index = next(i for i, row in enumerate(logical["tasks"]) if row["id"] == "old-attempt")
        logical["tasks"][index] = compat_logical
        work_queue._validate_logical_board(logical, enforce_v1_count=False)
        old_view = work_queue.task_view(logical, compat_logical)
        self.assertEqual(old_view["state"], "BLOCKED")
        self.assertEqual(old_view["resolution_status"], "RESOLVED")
        self.assertFalse(any(row["task_id"] == "old-attempt" for row in work_queue.blocker_attention(logical)))

        old_writer_hot_row = dict(compat_logical, _ordinal=ordinal)
        self.assertTrue(v2._is_resolved_blocker_tombstone(old_writer_hot_row))
        self.assertEqual(
            v2._read_resolved_blocker_archive(v2._paths(self.root), old_writer_hot_row),
            full_old,
        )

        value = json.loads(receipt.read_text())
        value["checks"][0]["verdict"] = "FAIL"
        receipt.write_text(json.dumps(value))
        stale_view = work_queue.task_view(logical, compat_logical)
        self.assertEqual(stale_view["resolution_status"], "STALE_RESOLUTION")
        attention = next(row for row in work_queue.blocker_attention(logical) if row["task_id"] == "old-attempt")
        self.assertEqual(attention["evidence"], full_old["blocked_receipt"])
        self.assertIn("accepted-successor", attention["reason"])

    def test_compact_v2_resolved_blocker_roundtrip_and_inactive_default(self):
        old, _next, _receipt, _resolved = self._resolve_blocker_fixture()
        before = v2.load_state(self.root)
        original = next(t for t in before["logical"]["tasks"] if t["id"] == old["id"])
        prior = next(t for t in before["hot"]["tasks"] if t["id"] == old["id"])
        self.assertTrue(v2._is_resolved_blocker_tombstone(prior))
        self.assertNotIn("resolved_cold_ref_schema", prior)
        archive_sha = prior["resolved_archive_sha256"]
        archive = self.root / "controllers/work-board-done/rows" / (archive_sha + ".json")
        immutable = archive.read_bytes()
        root_id = before["hot"]["generation_id"]

        def new_ready(suffix):
            return dict(
                self.ready("versioned-" + suffix),
                basis="bounded C00 archive compatibility",
                acceptance=["preserve immutable blocker metadata"],
            )

        work_queue.add_task(
            self.root, "A", new_ready("default"),
            repo_root=Path(work_queue.__file__).resolve().parents[2],
        )
        default = v2.load_state(self.root)
        disabled = next(t for t in default["hot"]["tasks"] if t["id"] == old["id"])
        self.assertNotIn("resolved_cold_ref_schema", disabled)
        self.assertEqual(disabled["blocker_resolution"], original["blocker_resolution"])

        with patch.object(work_queue._v2(), "COMPACT_RESOLVED_WRITES_ENABLED", True):
            work_queue.add_task(
                self.root, "A", new_ready("compact"),
                repo_root=Path(work_queue.__file__).resolve().parents[2],
            )
        compact = v2.load_state(self.root)
        tombstone = next(t for t in compact["hot"]["tasks"] if t["id"] == old["id"])
        self.assertEqual(tombstone["resolved_cold_ref_schema"], 2)
        self.assertEqual(tombstone["blocker_resolution"], {"status": "RESOLVED"})
        self.assertEqual(tombstone["resolved_archive_sha256"], archive_sha)
        self.assertEqual(tombstone["blocked_receipt"], original["blocked_receipt"])
        self.assertEqual(
            next(t for t in compact["logical"]["tasks"] if t["id"] == old["id"]),
            original,
        )
        self.assertEqual(archive.read_bytes(), immutable)
        self.assertNotEqual(compact["hot"]["generation_id"], root_id)
        self.assertLessEqual(len(compact["hot_raw"]), v2.HOT_CAP_BYTES)

        # Retain compact rows once issued even with the writer gate disabled;
        # a rollback to dual-reader code must not re-inflate HOT on the next ADD.
        work_queue.add_task(
            self.root, "A", new_ready("preserved"),
            repo_root=Path(work_queue.__file__).resolve().parents[2],
        )
        kept = v2.load_state(self.root)
        last = next(t for t in kept["hot"]["tasks"] if t["id"] == old["id"])
        self.assertEqual(last["resolved_cold_ref_schema"], 2)
        self.assertEqual(last["resolved_archive_sha256"], archive_sha)
        self.assertEqual(archive.read_bytes(), immutable)

    def test_versioned_compact_blocker_tamper_and_missing_archive_fail_closed(self):
        old, _next, _receipt, _resolved = self._resolve_blocker_fixture()
        with patch.object(work_queue._v2(), "COMPACT_RESOLVED_WRITES_ENABLED", True):
            work_queue.add_task(
                self.root, "A",
                dict(self.ready("compact-adversarial"), basis="source",
                     acceptance=["strict archive"]),
                repo_root=Path(work_queue.__file__).resolve().parents[2],
            )
        state = v2.load_state(self.root)
        index = next(i for i, t in enumerate(state["hot"]["tasks"]) if t["id"] == old["id"])
        trusted = state["hot"]["tasks"][index]
        self.assertEqual(trusted["resolved_cold_ref_schema"], 2)
        archive = state["paths"]["rows"] / (trusted["resolved_archive_sha256"] + ".json")
        expected_archive = archive.read_bytes()

        def forged(**changes):
            changed = copy.deepcopy(state["hot"])
            changed["tasks"][index].update(changes)
            changed["generation_id"] = v2._generation_id(v2._hot_core(changed))
            return v2._canonical_bytes(changed)

        mutations = [
            {"resolved_cold_ref_schema": True},
            {"resolved_cold_ref_schema": 3},
            {"blocker_resolution": {"status": "RESOLVED", "owner": "forged"}},
            {"resolved_archive_sha256": "0" * 64},
            {"role": "A" if trusted["role"] != "A" else "B"},
            {"blocked_receipt": "/forged/receipt"},
            {"untrusted_owner": "C"},
        ]
        for change in mutations:
            with self.subTest(change=change), self.assertRaises(RuntimeError):
                v2._load_state(self.root, forged(**change), require_committed=False)

        missing = copy.deepcopy(state["hot"])
        missing["tasks"][index].pop("resolved_archive_sha256")
        missing["generation_id"] = v2._generation_id(v2._hot_core(missing))
        with self.assertRaisesRegex(RuntimeError, "TOMBSTONE_INVALID"):
            v2._read_hot_once(self.root, v2._canonical_bytes(missing))

        archive.unlink()
        with self.assertRaisesRegex(RuntimeError, "CONTENT_MISSING"):
            v2.load_state(self.root)
        archive.write_bytes(expected_archive.replace(b'"resolved_blocker"', b'"broken_archive"', 1))
        with self.assertRaisesRegex(RuntimeError, "HASH_MISMATCH"):
            v2.load_state(self.root)
        archive.write_bytes(expected_archive)
        self.assertEqual(v2.load_state(self.root)["logical"], state["logical"])

    def test_compact_resolved_blocker_native_journal_crash_recovery(self):
        old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        baseline = v2.load_state(self.root)
        old_tombstone = next(t for t in baseline["hot"]["tasks"] if t["id"] == old["id"])
        archive_id = old_tombstone["resolved_archive_sha256"]
        archive = baseline["paths"]["rows"] / (archive_id + ".json")
        original_archive = archive.read_bytes()

        for point, expected in (
            ("after_data_durable", "ROLLED_BACK"),
            ("after_hot_replace_before_hot_published", "COMMITTED"),
        ):
            with self.subTest(point=point):
                pre = v2.load_state(self.root)
                extra = dict(
                    self.ready("compacted-" + point),
                    basis="C00 native crash fixture",
                    acceptance=["atomic compact HOT"],
                )

                def failure(at):
                    if at == point:
                        raise Crash(point)

                with patch.object(work_queue._v2(), "COMPACT_RESOLVED_WRITES_ENABLED", True):
                    with patch.object(work_queue._v2(), "_fault", side_effect=failure):
                        with self.assertRaises(Crash):
                            work_queue.add_task(
                                self.root, "A", extra,
                                repo_root=Path(work_queue.__file__).resolve().parents[2],
                            )
                outcome = v2.recover_queue_transaction(self.root)
                self.assertEqual(outcome["state"], expected)
                actual = v2.load_state(self.root)
                present = any(t["id"] == extra["id"] for t in actual["logical"]["tasks"])
                self.assertEqual(present, expected == "COMMITTED")
                self.assertEqual(
                    actual["revision"] if "revision" in actual else actual["logical"]["revision"],
                    pre["logical"]["revision"] + int(expected == "COMMITTED"),
                )
                tombstone = next(t for t in actual["hot"]["tasks"] if t["id"] == old["id"])
                self.assertEqual(
                    "resolved_cold_ref_schema" in tombstone,
                    expected == "COMMITTED",
                )
                self.assertEqual(tombstone["resolved_archive_sha256"], archive_id)
                self.assertEqual(archive.read_bytes(), original_archive)
                self.assertIsNone(v2.recover_queue_transaction(self.root))

    def test_malformed_resolved_blocker_tombstone_shape_is_rejected(self):
        _old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        raw = (self.root / "controllers/work-board.json").read_bytes()
        hot = json.loads(raw)
        row = next(item for item in hot["tasks"] if item["id"] == "old-attempt")
        row["extra"] = "not allowed"
        core = v2._hot_core(hot)
        hot["generation_id"] = v2._generation_id(core)
        tampered = v2._canonical_bytes(hot)
        with self.assertRaisesRegex(RuntimeError, "RESOLVED_BLOCKER_TOMBSTONE_INVALID"):
            v2._read_hot_once(self.root, tampered)

    def test_unresolved_nonexact_ready_and_in_progress_rows_stay_full_in_hot(self):
        blocked_receipt = self.root / "logs/historical-blocked.json"
        blocked_receipt.write_text('{"reason":"historical"}')
        tasks = [
            {
                "id": "unresolved", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
                "result": "Unresolved", "paths": ["tooling/unresolved.py"],
                "blocked_reason": "Still blocked", "blocked_receipt": str(blocked_receipt),
            },
            {
                "id": "nonexact", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
                "result": "Historical", "paths": ["tooling/nonexact.py"],
                "blocked_reason": "Historical", "blocked_receipt": str(blocked_receipt),
                "blocker_resolution": {
                    "owner": "CONTROLLER",
                    "status": "RESOLVED_FOR_THIS_OWNER_TEST_RELEASE",
                    "evidence": "/root/octoport-control/logs/controller/publication.json",
                },
            },
            self.ready("ready-row"),
            dict(self.ready("in-progress-row"), state="IN_PROGRESS"),
        ]
        self.migrate(tasks)
        hot = json.loads((self.root / "controllers/work-board.json").read_text())
        by_id = {row["id"]: row for row in hot["tasks"]}
        for identifier in ("unresolved", "nonexact", "ready-row", "in-progress-row"):
            self.assertNotIn("resolved_archive_sha256", by_id[identifier])
        self.assertEqual(by_id["unresolved"]["blocked_reason"], "Still blocked")
        self.assertEqual(
            by_id["nonexact"]["blocker_resolution"]["status"],
            "RESOLVED_FOR_THIS_OWNER_TEST_RELEASE",
        )
        self.assertEqual(by_id["ready-row"]["state"], "READY")
        self.assertEqual(by_id["in-progress-row"]["state"], "IN_PROGRESS")

    def test_resolved_blocker_archive_hash_stable_across_unrelated_queue_mutation(self):
        _old, _successor, _receipt, _resolved = self._resolve_blocker_fixture()
        before = json.loads((self.root / "controllers/work-board.json").read_text())
        old_before = next(row for row in before["tasks"] if row["id"] == "old-attempt")
        archive_sha = old_before["resolved_archive_sha256"]
        archive_path = self.root / "controllers/work-board-done/rows" / (archive_sha + ".json")
        accepted = archive_path.read_bytes()

        work_queue.add_task(
            self.root,
            "A",
            dict(
                self.ready("a-unrelated"),
                acceptance=["bounded"],
                basis="approved plan remainder",
            ),
            repo_root=Path(work_queue.__file__).resolve().parents[2],
        )
        after = json.loads((self.root / "controllers/work-board.json").read_text())
        old_after = next(row for row in after["tasks"] if row["id"] == "old-attempt")
        self.assertEqual(old_after["resolved_archive_sha256"], archive_sha)
        self.assertEqual(archive_path.read_bytes(), accepted)
        self.assertEqual(
            len(list((self.root / "controllers/work-board-done/rows").glob(archive_sha + ".json"))),
            1,
        )

    def test_resolved_blocker_sidecar_crash_before_hot_publish_rolls_back_then_reuses_archive(self):
        blocked_receipt = self.root / "logs/old-blocked.json"
        blocked_receipt.write_text('{"reason":"historical superseded attempt"}')
        old = {"id": "old-attempt", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
               "result": "Historical failed attempt", "paths": ["tooling/old.py"],
               "blocked_reason": "Superseded", "blocked_receipt": str(blocked_receipt)}
        successor = {"id": "accepted-successor", "role": "B", "plan": "C00", "state": "IN_PROGRESS", "requires": [],
                     "result": "Accepted successor", "paths": ["tooling/new.py"]}
        self.migrate([old, successor])
        receipt = self.root / "logs/successor-completion.json"
        receipt.write_text(json.dumps({
            "kind": work_queue.COMPLETION_KIND, "version": 1,
            "task_id": "accepted-successor", "candidate_sha": work_queue.current_worktree_head(),
            "verdict": "PASS", "review": {"verdict": "PASS", "evidence": ["review"]},
            "checks": [{"name": "focused", "verdict": "PASS", "evidence": ["run"]}],
        }))
        work_queue.advance_task(self.root, "B", "accepted-successor", "DONE", str(receipt))
        baseline = v2.load_state(self.root)["logical"]

        def crash(point):
            if point == "after_data_durable":
                raise Crash(point)

        with patch.object(work_queue._v2(), "_fault", crash), self.assertRaises(Crash):
            work_queue.resolve_blocker(
                self.root, "B", "old-attempt", "accepted-successor", str(receipt)
            )
        recovered = v2.recover_queue_transaction(self.root)
        self.assertEqual(recovered["state"], "ROLLED_BACK")
        self.assertEqual(v2.load_state(self.root)["logical"], baseline)

        work_queue.resolve_blocker(
            self.root, "B", "old-attempt", "accepted-successor", str(receipt)
        )
        hot = json.loads((self.root / "controllers/work-board.json").read_text())
        tombstone = next(row for row in hot["tasks"] if row["id"] == "old-attempt")
        archive = self.root / "controllers/work-board-done/rows" / (
            tombstone["resolved_archive_sha256"] + ".json"
        )
        self.assertTrue(archive.is_file())
        self.assertEqual(
            next(row for row in v2.load_state(self.root)["logical"]["tasks"] if row["id"] == "old-attempt")[
                "blocker_resolution"
            ]["status"],
            "RESOLVED",
        )

    def test_current_like_36_resolved_blockers_reduce_hot_by_more_than_100kib(self):
        tasks = []
        for number in range(36):
            tasks.append({
                "id": f"resolved-{number:02d}",
                "role": "B",
                "plan": "C00",
                "state": "BLOCKED",
                "requires": [],
                "result": "x" * 3500 + str(number),
                "paths": [f"tooling/historical-{number:02d}.py"],
                "blocked_reason": "Historical superseded attempt",
                "blocked_receipt": f"/root/octoport-control/logs/historical-{number:02d}.json",
                "blocker_resolution": {
                    "owner": "CONTROLLER",
                    "next_action": "Historical attempt preserved",
                    "unblock_when": "Accepted successor remains valid",
                    "status": "RESOLVED",
                    "successor_task": f"successor-{number:02d}",
                    "successor_candidate_sha": "a" * 40,
                    "receipt": f"/root/octoport-control/logs/successor-{number:02d}.json",
                    "resolved_at": "2026-10-04T00:00:00+00:00",
                },
            })
        board, raw, _receipt = self.migrate(tasks)
        state = v2.load_state(self.root)
        hot_raw = (self.root / "controllers/work-board.json").read_bytes()
        self.assertEqual(state["logical"]["tasks"], board["tasks"])
        self.assertGreater(len(raw) - len(hot_raw), 100 * 1024)
        hot = json.loads(hot_raw)
        self.assertEqual(len(hot["tasks"]), 36)
        self.assertTrue(all(v2._is_resolved_blocker_tombstone(row) for row in hot["tasks"]))
        self.assertEqual(len(list((self.root / "controllers/work-board-done/rows").glob("*.json"))), 36)

    def test_v2_preserves_historical_non_successor_blocker_resolution_metadata(self):
        blocked_receipt = self.root / "logs/historical-blocked.json"
        blocked_receipt.write_text('{"reason":"historical"}')
        task = {
            "id": "historical-blocker", "role": "B", "plan": "C00", "state": "BLOCKED",
            "requires": [], "result": "Historical blocker", "paths": ["tooling/historical.py"],
            "blocked_reason": "Historical route still requires attention",
            "blocked_receipt": str(blocked_receipt),
            "blocker_resolution": {
                "owner": "CONTROLLER",
                "status": "RESOLVED_FOR_THIS_OWNER_TEST_RELEASE",
                "evidence": "/root/octoport-control/logs/controller/publication.json",
            },
        }
        self.migrate([task])
        state = v2.load_state(self.root)
        logical = work_queue.load_board(self.root)
        row = next(item for item in logical["tasks"] if item["id"] == "historical-blocker")
        self.assertEqual(row["blocker_resolution"]["status"], "RESOLVED_FOR_THIS_OWNER_TEST_RELEASE")
        view = next(item for item in work_queue.role_work(self.root, "B")["tasks"] if item["id"] == "historical-blocker")
        self.assertEqual(view["resolution_status"], "RESOLVED_FOR_THIS_OWNER_TEST_RELEASE")
        self.assertTrue(any(item["task_id"] == "historical-blocker" for item in work_queue.blocker_attention(state["logical"])))


    def test_v2_storage_accepts_101_full_rows_under_hot_byte_cap(self):
        self.migrate([self.ready("storage-base")])
        previous = v2.load_state(self.root)
        board = copy.deepcopy(previous["logical"])
        board["revision"] += 1
        board["updated_at"] = "2026-10-07T00:00:00+00:00"
        board["tasks"].extend(self.ready(f"storage-{number:03d}") for number in range(100))
        event = {"action": "DIRECT_STORAGE_FIXTURE", "role": "A", "task": "storage-base", "revision": board["revision"]}
        v2._prepare_generation(self.root, board, previous)
        v2.commit_logical_board(self.root, board, event)
        hot_raw = (self.root / "controllers/work-board.json").read_bytes()
        hot = json.loads(hot_raw)
        v2._validate_hot(hot)
        self.assertEqual(len(hot["tasks"]), 101)
        self.assertLessEqual(len(hot_raw), v2.HOT_CAP_BYTES)
        self.assertEqual(len(v2.load_state(self.root)["logical"]["tasks"]), 101)

    def test_invalidated_done_quota_neutral_reopen_materializes_101_full_rows(self):
        tasks = [self.ready(f"repair-other-{number:02d}") for number in range(99)]
        tasks.append(self.ready("repair-strict"))
        self.migrate(tasks)
        self._strict_done("repair-strict")
        self.assertEqual(self._semantic_count(), 99)
        self._add_ready_task("repair-extra")
        self.assertEqual(self._semantic_count(), 100)
        hot_path = self.root / "controllers/work-board.json"
        self.assertEqual(len(json.loads(hot_path.read_text())["tasks"]), 100)

        done = next(row for row in work_queue.load_board(self.root)["tasks"] if row["id"] == "repair-strict")
        close = Path(done["completion_receipt"])
        accepted_close = close.read_bytes()
        close.write_bytes(accepted_close + b"x")
        board = work_queue.load_board(self.root)
        self.assertEqual(self._semantic_count(), 101)
        self.assertEqual(len(json.loads(hot_path.read_text())["tasks"]), 100)
        self.assertTrue(next(row for row in work_queue.role_work(self.root, "A")["tasks"]
                             if row["id"] == "repair-strict")["completion_invalidated"])

        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "SEMANTIC_ACTIVE_TASK_CAP"):
            self._add_ready_task("repair-forbidden")
        self.assertEqual(self._capacity_snapshot(), before)

        history_before = next(row for row in board["tasks"] if row["id"] == "repair-strict").get("completion_history", [])
        receipt = self._rework_receipt("repair-strict")
        work_queue.advance_task(self.root, "A", "repair-strict", "IN_PROGRESS", str(receipt))
        after = work_queue.load_board(self.root)
        strict = next(row for row in after["tasks"] if row["id"] == "repair-strict")
        self.assertEqual(strict["state"], "IN_PROGRESS")
        self.assertEqual(len(strict["completion_history"]), len(history_before) + 1)
        self.assertEqual(strict["completion_history"][-1]["format"], work_queue.COMPLETION_VERSION)
        self.assertEqual(strict["completion_history"][-1]["receipt_snapshot"]["verdict"], "PASS")
        self.assertEqual(strict["reopen_receipt"], str(receipt.resolve()))
        self.assertEqual(self._semantic_count(), 101)
        hot = json.loads(hot_path.read_text())
        self.assertEqual(len(hot["tasks"]), 101)
        self.assertLessEqual(hot_path.stat().st_size, v2.HOT_CAP_BYTES)

    def test_invalidated_done_add_boundary_98_other_active_reaches_100(self):
        tasks = [self.ready(f"boundary-98-{number:02d}") for number in range(98)]
        tasks.append(self.ready("boundary-98-strict"))
        self.migrate(tasks)
        self._strict_done("boundary-98-strict")
        done = next(row for row in work_queue.load_board(self.root)["tasks"] if row["id"] == "boundary-98-strict")
        close = Path(done["completion_receipt"])
        close.write_bytes(close.read_bytes() + b"x")
        self.assertEqual(self._semantic_count(), 99)
        self._add_ready_task("boundary-98-add")
        self.assertEqual(self._semantic_count(), 100)

    def test_invalidated_done_add_boundary_99_other_active_rejects_atomically(self):
        tasks = [self.ready(f"boundary-99-{number:02d}") for number in range(99)]
        tasks.append(self.ready("boundary-99-strict"))
        self.migrate(tasks)
        self._strict_done("boundary-99-strict")
        done = next(row for row in work_queue.load_board(self.root)["tasks"] if row["id"] == "boundary-99-strict")
        close = Path(done["completion_receipt"])
        close.write_bytes(close.read_bytes() + b"x")
        self.assertEqual(self._semantic_count(), 100)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "SEMANTIC_ACTIVE_TASK_CAP"):
            self._add_ready_task("boundary-99-forbidden")
        self.assertEqual(self._capacity_snapshot(), before)

    def test_legacy_done_reopen_at_100_fails_without_board_or_event_mutation(self):
        tasks = [self.ready(f"legacy-other-{number:02d}") for number in range(99)]
        tasks.append(self.done("legacy-cap-done"))
        self.migrate(tasks)
        self._add_ready_task("legacy-cap-extra")
        self.assertEqual(self._semantic_count(), 100)
        receipt = self._rework_receipt("legacy-cap-done")
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "SEMANTIC_ACTIVE_TASK_CAP"):
            work_queue.advance_task(self.root, "B", "legacy-cap-done", "IN_PROGRESS", str(receipt))
        self.assertEqual(self._capacity_snapshot(), before)

    def test_semantic_101_blocked_to_in_progress_is_quota_neutral(self):
        self.migrate([self.ready("blocked-base")])
        previous = v2.load_state(self.root)
        board = copy.deepcopy(previous["logical"])
        board["revision"] += 1
        board["updated_at"] = "2026-10-07T00:00:00+00:00"
        board["tasks"].extend(self.ready(f"blocked-other-{number:03d}") for number in range(99))
        blocked = self.ready("blocked-neutral")
        blocked.update(state="BLOCKED", blocked_reason="External condition", blocked_receipt="/logs/blocked.json")
        board["tasks"].append(blocked)
        event = {"action": "DIRECT_STORAGE_FIXTURE", "role": "A", "task": "blocked-neutral", "revision": board["revision"]}
        v2.commit_logical_board(self.root, board, event)
        self.assertEqual(self._semantic_count(), 101)
        receipt = self._rework_receipt("blocked-neutral")
        work_queue.advance_task(self.root, "A", "blocked-neutral", "IN_PROGRESS", str(receipt))
        saved = work_queue.load_board(self.root)
        self.assertEqual(self._semantic_count(), 101)
        self.assertEqual(next(row for row in saved["tasks"] if row["id"] == "blocked-neutral")["state"], "IN_PROGRESS")

    def test_over_cap_reduction_succeeds_then_worsening_add_is_atomic(self):
        self.migrate([self.ready("over-cap-done")])
        previous = v2.load_state(self.root)
        board = copy.deepcopy(previous["logical"])
        board["revision"] += 1
        board["updated_at"] = "2026-10-07T00:00:00+00:00"
        board["tasks"][0]["state"] = "IN_PROGRESS"
        board["tasks"].extend(self.ready(f"over-cap-{number:03d}") for number in range(101))
        event = {"action": "DIRECT_STORAGE_FIXTURE", "role": "A", "task": "over-cap-done", "revision": board["revision"]}
        v2.commit_logical_board(self.root, board, event)
        self.assertEqual(self._semantic_count(), 102)
        receipt = self._completion_receipt("over-cap-done")
        work_queue.advance_task(self.root, "A", "over-cap-done", "DONE", str(receipt))
        self.assertEqual(self._semantic_count(), 101)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "SEMANTIC_ACTIVE_TASK_CAP"):
            self._add_ready_task("over-cap-forbidden")
        self.assertEqual(self._capacity_snapshot(), before)

    def test_stale_resolution_98_other_active_adds_to_100(self):
        tasks = [self.ready(f"stale-98-{number:02d}") for number in range(98)]
        stale = self.ready("stale-98-blocker")
        stale.update(state="BLOCKED", blocked_reason="Historical blocker", blocked_receipt="/logs/stale.json")
        stale["blocker_resolution"] = {
            "owner": "CONTROLLER", "next_action": "Preserve history",
            "unblock_when": "Accepted successor remains valid", "status": "RESOLVED",
            "successor_task": "missing-successor", "successor_candidate_sha": "a" * 40,
            "receipt": "/logs/missing-successor.json", "resolved_at": "2026-10-07T00:00:00+00:00",
        }
        tasks.append(stale)
        self.migrate(tasks)
        stale_view = next(row for row in work_queue.role_work(self.root, "A")["tasks"]
                          if row["id"] == "stale-98-blocker")
        self.assertEqual(stale_view["resolution_status"], "STALE_RESOLUTION")
        self.assertEqual(self._semantic_count(), 99)
        self._add_ready_task("stale-98-add")
        self.assertEqual(self._semantic_count(), 100)

    def test_stale_resolution_99_other_active_add_rejects_atomically(self):
        tasks = [self.ready(f"stale-99-{number:02d}") for number in range(99)]
        stale = self.ready("stale-99-blocker")
        stale.update(state="BLOCKED", blocked_reason="Historical blocker", blocked_receipt="/logs/stale.json")
        stale["blocker_resolution"] = {
            "owner": "CONTROLLER", "next_action": "Preserve history",
            "unblock_when": "Accepted successor remains valid", "status": "RESOLVED",
            "successor_task": "missing-successor", "successor_candidate_sha": "a" * 40,
            "receipt": "/logs/missing-successor.json", "resolved_at": "2026-10-07T00:00:00+00:00",
        }
        tasks.append(stale)
        self.migrate(tasks)
        self.assertEqual(self._semantic_count(), 100)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "SEMANTIC_ACTIVE_TASK_CAP"):
            self._add_ready_task("stale-99-forbidden")
        self.assertEqual(self._capacity_snapshot(), before)

    def test_add_from_semantic_100_rejects_without_board_or_event_mutation(self):
        self.migrate([self.ready(f"full-{number:03d}") for number in range(100)])
        self.assertEqual(self._semantic_count(), 100)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "SEMANTIC_ACTIVE_TASK_CAP"):
            self._add_ready_task("full-forbidden")
        self.assertEqual(self._capacity_snapshot(), before)

    def test_receipt_tamper_activates_invalidated_successor_and_stale_blocker_plus_two(self):
        blocked_receipt = self.root / "logs/old-attempt-blocked.json"
        blocked_receipt.write_text('{"reason":"historical superseded attempt"}')
        old = {
            "id": "old-attempt", "role": "B", "plan": "C00", "state": "BLOCKED", "requires": [],
            "result": "Historical failed attempt", "paths": ["tooling/old-attempt.py"],
            "blocked_reason": "Superseded", "blocked_receipt": str(blocked_receipt),
        }
        successor = {
            "id": "accepted-successor", "role": "B", "plan": "C00", "state": "IN_PROGRESS", "requires": [],
            "result": "Accepted successor", "paths": ["tooling/accepted-successor.py"],
        }
        tasks = [self.ready(f"combined-other-{number:02d}") for number in range(98)]
        tasks.extend([old, successor])
        self.migrate(tasks)
        receipt = self._completion_receipt("accepted-successor")
        work_queue.advance_task(self.root, "B", "accepted-successor", "DONE", str(receipt))
        work_queue.resolve_blocker(self.root, "B", "old-attempt", "accepted-successor", str(receipt))
        self.assertEqual(self._semantic_count(), 98)

        value = json.loads(receipt.read_text())
        value["checks"][0]["verdict"] = "FAIL"
        receipt.write_text(json.dumps(value))
        board = work_queue.load_board(self.root)
        views = {row["id"]: row for row in work_queue.role_work(self.root, "B")["tasks"]}
        self.assertTrue(views["accepted-successor"]["completion_invalidated"])
        self.assertEqual(views["old-attempt"]["resolution_status"], "STALE_RESOLUTION")
        self.assertEqual(self._semantic_count(), 100)
        before = self._capacity_snapshot()
        with self.assertRaisesRegex(RuntimeError, "SEMANTIC_ACTIVE_TASK_CAP"):
            self._add_ready_task("combined-forbidden")
        self.assertEqual(self._capacity_snapshot(), before)


if __name__ == "__main__":
    unittest.main()
