"""Disposable SOURCE tests; never opens the live Easyscript registry.

The operational SOURCE enables the reviewed writer. Compatibility patches
affect only imported modules and roots created by TemporaryDirectory.
"""
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import work_board_v2 as v2
import work_queue
import work_board_reader_rollout as rollout


class Crash(BaseException):
    pass


class BoundedWorkingTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        v2._paths(self.root, create=True)
        (self.root / "controllers/coordination.lock").touch()
        for role in "ABC":
            (self.root / (role + ".json")).write_text(json.dumps({"role": role, "status": "RUNNING"}))
        self.repo = self.root / "repo"
        docs = self.repo / "docs/development/coordination"
        docs.mkdir(parents=True)
        (docs / "OWNERSHIP.json").write_text(json.dumps({"roles": {
            r: {"allow": ["apps/extension/*"], "deny": []} for r in "ABC"}}))
        (docs / "PLAN.md").write_text("| A04 | Existing test outcome |\n")
        self.addCleanup(patch.stopall)
        # Use the real native admission API with this exact candidate module.
        patch.object(work_queue, "_V2_MODULE", v2).start()

    def ready(self, identifier, payload=0):
        return {"id": identifier, "role": "A", "plan": "A04", "state": "READY",
                "requires": [], "result": "bounded storage regression",
                "paths": ["apps/extension/" + identifier + ".js"],
                "basis": "existing approved requirement", "acceptance": ["round trip"],
                "evidence_description": "x" * payload}

    def resolved(self, identifier, payload=0):
        return dict(self.ready(identifier, payload), state="BLOCKED", blocked_reason="historical",
                    blocker_resolution={"status": "RESOLVED", "owner": "A", "next_action": "preserved",
                                        "unblock_when": "exact successor accepted", "successor_task": "accepted-successor",
                                        "successor_candidate_sha": "a" * 40, "receipt": str(self.root / "completion.json"),
                                        "resolved_at": "2026-10-11T11:40:00Z"})

    def successor(self):
        path = self.root / "completion.json"
        receipt = {"kind": work_queue.COMPLETION_KIND, "version": 1, "task_id": "accepted-successor",
                   "candidate_sha": "a" * 40, "verdict": "PASS",
                   "review": {"verdict": "PASS", "evidence": ["isolated fixture review"]},
                   "checks": [{"name": "isolated fixture", "verdict": "PASS", "evidence": ["fixture"]}]}
        path.write_text(json.dumps(receipt))
        task = dict(self.ready("accepted-successor"), state="DONE", completion_receipt=str(path),
                    completion_receipt_format=1, completion_candidate_sha="a" * 40,
                    completion_receipt_snapshot=work_queue._completion_receipt(str(path), "accepted-successor", "a" * 40))
        self.assertTrue(work_queue._strict_blocker_successor_valid(task, root=self.root))
        return task

    def logical(self, tasks, revision=1):
        return {"version": 2, "revision": revision, "updated_at": "2026-10-11T11:40:00Z", "tasks": tasks}

    def seed(self, tasks, bounded=True):
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", bounded):
            generation = v2._prepare_generation(self.root, self.logical(tasks))
        core = generation["core"]
        hot = dict(core, generation_id=v2._generation_id(core), last_operation_id="0" * 64)
        _operation, raw, tx = v2._make_migration_tx("a" * 64, 1, hot, b"", "b" * 64)
        v2._write_drafts_for_generation(self.root, generation)
        v2._atomic_write(v2._paths(self.root)["hot"], raw)
        tx["state"] = "COMMITTED"
        v2._write_journal(self.root, tx, initial=True)
        self.assertEqual(v2.load_logical_board(self.root), self.logical(tasks))

    def snapshots(self):
        return {str(p.relative_to(self.root)): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in (self.root / "controllers").rglob("*") if p.is_file()}

    def events(self):
        p = self.root / "controllers/work-board-events.jsonl"
        return p.read_bytes().splitlines() if p.exists() else []

    def test_enabled_source_default_and_legacy_counterexample_stays_red(self):
        self.assertTrue(v2.WORKING_INDEX_WRITES_ENABLED)
        self.assertTrue(v2.COMPACT_RESOLVED_WRITES_ENABLED)
        self.assertFalse(v2.RESOLVED_COLD_INDEX_WRITES_ENABLED)
        tasks = [self.ready(f"active-{i}") for i in range(30)] + [self.resolved(f"old-{i}") for i in range(1000)]
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", False):
            generation = v2._prepare_generation(self.root, self.logical(tasks, 2))
        self.assertNotIn("working_root_hash", generation["core"])
        previous = {"hot": {"generation_id": "0" * 64}, "logical": {"revision": 1}, "hot_sha256": "1" * 64}
        with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID: size"):
            v2._build_queue_tx(previous, generation, {"action": "ADD", "role": "A", "task": "active-29"})

    def test_history_and_large_active_payload_do_not_expand_hot(self):
        measured = []
        for count in (0, 100, 1000, 10000):
            tasks = [self.ready(f"active-{i}", 16384) for i in range(100)]
            tasks += [self.resolved(f"old-{i}", 256) for i in range(count)]
            with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", True):
                generated = v2._prepare_generation(self.root, self.logical(tasks, 2))
            hot = dict(generated["core"], generation_id=v2._generation_id(generated["core"]), last_operation_id="0" * 64)
            raw = v2._canonical_bytes(hot)
            v2._validate_hot(hot)
            self.assertEqual(hot["tasks"], [])
            self.assertLess(len(raw), 1024)
            self.assertTrue(all(len(data) <= (v2.NODE_CAP_BYTES if kind == "nodes" else v2.ARCHIVE_CAP_BYTES)
                                for (kind, _), data in generated["drafts"].items()))
            measured.append(len(raw))
        self.assertLessEqual(max(measured) - min(measured), 2)

    def test_literal_source_retries_same_native_add_after_legacy_size_refusal(self):
        successor = self.successor()
        original = None
        for count in range(500, 1001, 10):
            rows = [self.ready(f"active-{i}", 128) for i in range(30)]
            rows += [self.resolved(f"old-{i}") for i in range(count)] + [successor]
            with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", False):
                generated = v2._prepare_generation(self.root, self.logical(rows))
            hot = dict(generated["core"], generation_id=v2._generation_id(generated["core"]),
                       last_operation_id="0" * 64)
            size = len(v2._canonical_bytes(hot))
            if size > v2.HOT_CAP_BYTES - 1024:
                break
            original = rows
        self.assertIsNotNone(original)
        self.seed(original, bounded=False)
        prior = self.snapshots()
        task = self.ready("literal-source-native-add", 32768)
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", False):
            with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID: size"):
                work_queue.add_task(self.root, "A", task, repo_root=self.repo)
        self.assertEqual(self.snapshots(), prior)
        script = """
import json,sys
from pathlib import Path
import work_board_v2 as v2
import work_queue
assert v2.WORKING_INDEX_WRITES_ENABLED is True
assert v2.COMPACT_RESOLVED_WRITES_ENABLED is True
assert v2.RESOLVED_COLD_INDEX_WRITES_ENABLED is False
work_queue.add_task(Path(sys.argv[1]), 'A', json.loads(sys.argv[3]), repo_root=Path(sys.argv[2]))
"""
        completed = subprocess.run([sys.executable, "-B", "-c", script,
                                    str(self.root), str(self.repo), json.dumps(task)],
                                   cwd=Path(v2.__file__).parent, capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        logical = v2.load_logical_board(self.root)
        self.assertEqual(logical["tasks"][:-1], original)
        for key, value in task.items():
            self.assertEqual(logical["tasks"][-1][key], value)
        after = self.snapshots()
        for name, digest in prior.items():
            if "work-board-done/" in name:
                self.assertEqual(after[name], digest)
        self.assertEqual(len(self.events()), 1)
        self.assertLess((self.root / "controllers/work-board.json").stat().st_size, 1024)

    def test_native_add_claim_large_payload_history_and_duplicate_claim(self):
        original = [self.ready(f"active-{i}", 8192) for i in range(99)]
        original += [self.resolved(f"old-{i}", 128) for i in range(1000)]
        original.append(self.successor())
        self.seed(original)
        preserved = self.snapshots()
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", True):
            work_queue.add_task(self.root, "A", self.ready("new-one", 16384), repo_root=self.repo)
            work_queue.claim_task(self.root, "A", "new-one")
            before_repeat = self.snapshots()
            work_queue.claim_task(self.root, "A", "new-one")
            self.assertEqual(before_repeat, self.snapshots())
        logical = v2.load_logical_board(self.root)
        self.assertEqual(logical["tasks"][:-1], original)
        self.assertEqual(logical["tasks"][-1]["state"], "IN_PROGRESS")
        after = self.snapshots()
        for name, digest in preserved.items():
            if "/work-board-done/" in "/" + name:
                self.assertEqual(after[name], digest)
        self.assertEqual(len(self.events()), 2)
        self.assertLess((self.root / "controllers/work-board.json").stat().st_size, 1024)
        before = self.snapshots()
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", True):
            with self.assertRaises(RuntimeError):
                work_queue.add_task(self.root, "A", self.ready("over-cap"), repo_root=self.repo)
        self.assertEqual(before, self.snapshots())

    def test_disabled_writer_refuses_indexed_board_without_mutation(self):
        self.seed([self.ready("one")])
        before = self.snapshots()
        board = v2.load_logical_board(self.root)
        board["revision"] += 1
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", False):
            with self.assertRaisesRegex(RuntimeError, "WORKING_WRITER_DISABLED"):
                v2.commit_logical_board(self.root, board, {"action": "ADD", "role": "A", "task": "one"})
        self.assertEqual(before, self.snapshots())

    def test_legacy_to_bounded_transaction_preserves_existing_immutable_history(self):
        tasks = [self.ready("active")] + [self.resolved(f"old-{i}", 1000) for i in range(20)] + [self.successor()]
        self.seed(tasks, bounded=False)
        old_files = self.snapshots()
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", True):
            work_queue.add_task(self.root, "A", self.ready("added"), repo_root=self.repo)
        self.assertEqual(v2.load_logical_board(self.root)["tasks"][:-1], tasks)
        after = self.snapshots()
        for name, digest in old_files.items():
            if "work-board-done/" in name:
                self.assertEqual(after[name], digest)

    def test_every_transaction_fault_recovers_once_with_full_rows(self):
        points = ("after_prepared", "after_data_durable", "after_hot_replace_before_hot_published",
                  "after_hot_published", "after_event_append_before_event_durable", "after_event_durable_before_commit")
        for point in points:
            with self.subTest(point=point), tempfile.TemporaryDirectory() as directory:
                previous_root = self.root
                self.root = Path(directory)
                v2._paths(self.root, create=True)
                self.seed([self.ready("one", 8192), self.resolved("old", 4096)])
                baseline = v2.load_logical_board(self.root)
                target = copy.deepcopy(baseline)
                target["revision"] += 1
                target["tasks"][0]["state"] = "IN_PROGRESS"
                def fault(name):
                    if name == point:
                        raise Crash(name)
                with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", True), patch.object(v2, "_fault", fault):
                    with self.assertRaises(Crash):
                        v2.commit_logical_board(self.root, target, {"action": "CLAIM", "role": "A", "task": "one"})
                result = v2.recover_queue_transaction(self.root)
                committed = point not in ("after_prepared", "after_data_durable")
                self.assertEqual(result["state"], "COMMITTED" if committed else "ROLLED_BACK")
                self.assertEqual(v2.load_logical_board(self.root), target if committed else baseline)
                self.assertEqual(len(self.events()), int(committed))
                before = self.snapshots()
                self.assertIsNone(v2.recover_queue_transaction(self.root))
                self.assertEqual(self.snapshots(), before)
                self.root = previous_root

    def test_missing_tampered_symlinked_row_fails_closed(self):
        self.seed([self.ready("one")])
        state = v2.load_state(self.root)
        entry = v2._read_trie(self.root, state["hot"]["working_root_hash"], 1, "working")[0]
        path = state["paths"]["rows"] / (entry["archive_sha256"] + ".json")
        raw = path.read_bytes()
        for action in ("missing", "tamper", "symlink"):
            with self.subTest(action=action):
                path.unlink()
                if action == "tamper":
                    path.write_bytes(raw.replace(b"bounded", b"changed"))
                if action == "symlink":
                    other = self.root / "outside.json"
                    other.write_bytes(raw)
                    path.symlink_to(other)
                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    v2.load_state(self.root)
                if path.exists() or path.is_symlink():
                    path.unlink()
                path.write_bytes(raw)

    def test_mixed_roots_partial_roots_and_journal_root_tamper_rejected(self):
        self.seed([self.ready("one")])
        hot = v2.load_state(self.root)["hot"]
        for bad in (dict(hot, tasks=[self.ready("hidden")]),
                    dict(hot, resolved_blocker_root_hash=None, resolved_blocker_count=0),
                    {k: v for k, v in hot.items() if k != "working_count"}):
            with self.assertRaises(RuntimeError):
                v2._validate_hot(bad)
        tx_path = self.root / "controllers/work-board-v2-transactions" / (hot["last_operation_id"] + ".json")
        tx = json.loads(tx_path.read_text())
        tx["working_root_hash"] = "f" * 64
        tx_path.write_bytes(v2._canonical_bytes(tx))
        with self.assertRaisesRegex(RuntimeError, "TRANSACTION_OUTPUT_MISMATCH"):
            v2.load_state(self.root)

    def test_legacy_quota_neutral_overcap_rows_can_be_stored_without_guard_change(self):
        rows = [self.ready(f"legacy-{i}") for i in range(101)]
        self.seed(rows)
        self.assertEqual(v2.load_logical_board(self.root)["tasks"], rows)
        self.assertEqual(v2.ACTIVE_TASK_CAP, 100)

    def test_reader_only_rollout_cannot_enable_new_writer(self):
        raw = Path(v2.__file__).read_bytes().replace(b"COMPACT_RESOLVED_WRITES_ENABLED = True",
                                                  b"COMPACT_RESOLVED_WRITES_ENABLED = False")
        raw = raw.replace(b"WORKING_INDEX_WRITES_ENABLED = True", b"WORKING_INDEX_WRITES_ENABLED = False")
        self.assertTrue(rollout._module_only_writer_flags_off(raw))
        self.assertFalse(rollout._module_only_writer_flags_off(raw.replace(
            b"WORKING_INDEX_WRITES_ENABLED = False", b"WORKING_INDEX_WRITES_ENABLED = True")))
        self.assertFalse(rollout._module_only_writer_flags_off(raw + b"\nif True:\n    WORKING_INDEX_WRITES_ENABLED = True\n"))

    def test_done_archive_survives_reopen_and_new_completion(self):
        successor = self.successor()
        self.seed([successor, self.ready("active")])
        original = self.snapshots()
        first = v2.load_state(self.root)
        old_history = copy.deepcopy(first["archive_history"])
        reopened = copy.deepcopy(first["logical"])
        reopened["revision"] += 1
        reopened["tasks"][0] = self.ready("accepted-successor")
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", True):
            v2.commit_logical_board(self.root, reopened, {"action": "ADVANCE", "role": "A", "task": "accepted-successor"})
            after_reopen = v2.load_state(self.root)
            self.assertEqual(after_reopen["archive_history"], old_history)
            completed = copy.deepcopy(after_reopen["logical"])
            completed["revision"] += 1
            completed["tasks"][0] = successor
            v2.commit_logical_board(self.root, completed, {"action": "ADVANCE", "role": "A", "task": "accepted-successor"})
        final = v2.load_state(self.root)
        self.assertEqual(len(final["archive_history"]), 2)
        self.assertEqual(final["logical"]["tasks"][0], successor)
        after = self.snapshots()
        for name, digest in original.items():
            if "work-board-done/" in name:
                self.assertEqual(after[name], digest)

    def test_native_stop_remains_enforced(self):
        self.seed([self.ready("one")])
        (self.root / "A.json").write_text(json.dumps({"role": "A", "status": "STOPPED"}))
        before = self.snapshots()
        with patch.object(v2, "WORKING_INDEX_WRITES_ENABLED", True):
            with self.assertRaisesRegex(RuntimeError, "STOPPED"):
                work_queue.claim_task(self.root, "A", "one")
            with self.assertRaisesRegex(RuntimeError, "STOPPED"):
                work_queue.add_task(self.root, "A", self.ready("two"), repo_root=self.repo)
        self.assertEqual(before, self.snapshots())


if __name__ == "__main__":
    unittest.main()
