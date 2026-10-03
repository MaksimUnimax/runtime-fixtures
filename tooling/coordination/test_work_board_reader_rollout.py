import copy
import hashlib
import json
import os
import shutil
import stat
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import work_board_reader_rollout as rollout
import work_queue


class ReaderRolloutTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "control"
        (self.root / "controllers").mkdir(parents=True)
        (self.root / "logs").mkdir()
        for role in "ABC":
            (self.root / f"{role}.json").write_text('{"status":"RUNNING"}')
            (self.root / f"{role}.lock").touch()
        (self.root / "controllers/coordination.lock").touch()
        board = {"version": 1, "revision": 1, "updated_at": "2026-10-02T00:00:00+00:00", "tasks": [
            {"id": "task-a", "role": "A", "plan": "A04", "state": "READY", "requires": [],
             "result": "Task", "paths": ["apps/extension/a.js"]}
        ]}
        (self.root / "controllers/work-board.json").write_text(json.dumps(board))
        self.candidate_queue = Path(work_queue.__file__).resolve()
        self.candidate_v2 = self.candidate_queue.with_name("work_board_v2.py")
        self.dirs = {}
        self.old_queue = subprocess.run(["git", "-C", str(self.candidate_queue.parents[2]), "show", "HEAD:tooling/coordination/work_queue.py"], check=True, capture_output=True).stdout
        self.old_queue_sha = hashlib.sha256(self.old_queue).hexdigest()
        self.repo_roots = {}
        for role in rollout.ROLES:
            repo = Path(self.tmp.name) / ("repo-" + role)
            directory = repo / "tooling/coordination"
            directory.mkdir(parents=True)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (directory / "work_queue.py").write_bytes(self.old_queue)
            self.dirs[role] = directory
            self.repo_roots[role] = repo
        self.candidates = {"work_queue": self.candidate_queue, "work_board_v2": self.candidate_v2}
        self.queue_hashes = {role: self.old_queue_sha for role in rollout.ROLES}
        self.module_prior = {role: None for role in rollout.ROLES}

    def tearDown(self):
        self.tmp.cleanup()

    def _run(self, rid="r1", transition=None):
        kwargs = {}
        if transition is not None:
            kwargs = {
                "semantic_transition_proof_path": transition[0],
                "semantic_transition_proof_sha256": transition[1],
            }
        return rollout.rollout(
            self.root, self.candidates, self.dirs,
            self.queue_hashes, self.module_prior,
            rollout_id=rid, **kwargs,
        )

    def _legacy_semantic_readers(self):
        legacy = self.old_queue + (
            b"\n# semantic transition fixture\n"
            b"def blocker_attention(board):\n"
            b"    return [{'task_id': 'legacy-alert', 'resolution_status': 'UNRESOLVED'}]\n"
        )
        for directory in self.dirs.values():
            (directory / "work_queue.py").write_bytes(legacy)
        digest = hashlib.sha256(legacy).hexdigest()
        self.queue_hashes = {role: digest for role in rollout.ROLES}
        return legacy

    def _transition(self, rid):
        value = rollout.semantic_transition_proof(
            self.root, self.candidates, self.dirs,
            self.queue_hashes, self.module_prior,
            rollout_id=rid,
        )
        path = self.root / "logs" / (rid + ".json")
        raw = rollout.v2._canonical_bytes(value)
        path.write_bytes(raw)
        return path, hashlib.sha256(raw).hexdigest(), value

    def test_atomic_failure_does_not_unlink_replaced_temp_path(self):
        target = Path(self.tmp.name) / "atomic-target.py"
        target.write_bytes(b"prior")
        target.chmod(0o640)
        real_open = rollout.os.open
        real_write = rollout.os.write
        captured = {}
        sabotaged = {"done": False}

        def capture_open(path, flags, mode=0o777, *args, **kwargs):
            fd = real_open(path, flags, mode, *args, **kwargs)
            captured["path"] = Path(path)
            return fd

        def replace_then_fail(fd, data):
            if not sabotaged["done"]:
                sabotaged["done"] = True
                temp = captured["path"]
                temp.unlink()
                temp.write_bytes(b"replacement-owned-elsewhere")
                raise OSError("injected write failure after temp replacement")
            return real_write(fd, data)

        with (
            patch.object(rollout.os, "open", capture_open),
            patch.object(rollout.os, "write", replace_then_fail),
        ):
            with self.assertRaisesRegex(OSError, "injected write failure"):
                rollout._atomic(target, b"candidate", 0o640)

        self.assertEqual(target.read_bytes(), b"prior")
        replacement = captured["path"]
        self.assertTrue(replacement.is_file())
        self.assertEqual(replacement.read_bytes(), b"replacement-owned-elsewhere")

    def test_atomic_replace_failure_retains_owned_scratch_without_unlink(self):
        target = Path(self.tmp.name) / "atomic-retained-target.py"
        target.write_bytes(b"prior")
        target.chmod(0o640)
        scratch = self.root / "controllers/work-board-reader-rollouts"
        scratch.mkdir(parents=True, exist_ok=True)

        with (
            patch.object(
                rollout.os, "replace",
                side_effect=OSError("injected replace failure after identity check"),
            ),
            patch.object(
                Path, "unlink",
                side_effect=AssertionError("failure cleanup must not unlink a pathname"),
            ),
        ):
            with self.assertRaisesRegex(OSError, "injected replace failure"):
                rollout._atomic(
                    target, b"candidate", 0o640, scratch_dir=scratch,
                )

        self.assertEqual(target.read_bytes(), b"prior")
        retained = list(scratch.glob(".atomic-retained-target.py.rollout.*.tmp"))
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0].read_bytes(), b"candidate")
        self.assertEqual(stat.S_IMODE(retained[0].stat().st_mode), 0o640)

    def test_semantic_snapshot_accepts_v2_logical_board(self):
        class V2Reader:
            @staticmethod
            def load_board(_root):
                return {
                    "version": 2, "revision": 7,
                    "updated_at": "2026-10-03T00:00:00+00:00",
                    "tasks": [],
                }

            @staticmethod
            def task_view(_board, task):
                return task

            @staticmethod
            def role_work(_root, role):
                return {"role": role, "tasks": [], "owner_attention": []}

            @staticmethod
            def blocker_attention(_board):
                return []

            @staticmethod
            def board_snapshot(_root):
                return {"exists": True, "sha256": "a" * 64}

            @staticmethod
            def status_work(_root, role):
                return {"role": role, "tasks": [], "action_required": False}

        value = rollout._semantic(V2Reader, self.root)
        self.assertEqual(value["board"]["version"], 2)
        self.assertEqual(value["blocker_attention"], [])
        self.assertEqual(set(value["role_work"]), set("ABC"))

    def test_rollout_installs_exact_pair_and_preserves_v1_semantics(self):
        result = self._run()
        self.assertEqual(result["result"], "COMMITTED")
        self.assertEqual(set(result["candidate_sha256"]), {"work_queue", "work_board_v2"})
        self.assertEqual(result["board_sha256_before"], result["board_sha256_after"])
        self.assertEqual(result["events_sha256_before"], result["events_sha256_after"])
        for directory in self.dirs.values():
            self.assertEqual(hashlib.sha256((directory / "work_queue.py").read_bytes()).hexdigest(), result["candidate_sha256"]["work_queue"])
            self.assertEqual(hashlib.sha256((directory / "work_board_v2.py").read_bytes()).hexdigest(), result["candidate_sha256"]["work_board_v2"])
        self.assertEqual(json.loads((self.root / "controllers/work-board.json").read_text())["version"], 1)
        for repo in self.repo_roots.values():
            self.assertFalse((repo / "tooling/coordination/__pycache__").exists())

    def test_reviewed_semantic_transition_installs_exact_expected_semantics(self):
        legacy = self._legacy_semantic_readers()
        path, digest, proof = self._transition("semantic-pass")
        self.assertTrue(any(
            row["before_semantic_sha256"] != row["after_semantic_sha256"]
            for row in proof["readers"].values()
        ))
        result = self._run("semantic-pass", (path, digest))
        self.assertEqual(result["result"], "COMMITTED")
        self.assertEqual(
            result["semantic_transition_proof"],
            {"path": str(path.resolve()), "sha256": digest},
        )
        self.assertEqual(
            result["role_state_sha256_before"],
            result["role_state_sha256_after"],
        )
        self.assertEqual(
            result["board_sha256_before"],
            result["board_sha256_after"],
        )
        self.assertEqual(
            result["events_sha256_before"],
            result["events_sha256_after"],
        )
        for role, directory in self.dirs.items():
            self.assertNotEqual((directory / "work_queue.py").read_bytes(), legacy)
            self.assertEqual(
                hashlib.sha256((directory / "work_queue.py").read_bytes()).hexdigest(),
                result["candidate_sha256"]["work_queue"],
            )
            self.assertEqual(
                result["reader_semantic_sha256_after"][role],
                proof["readers"][role]["after_semantic_sha256"],
            )

    def test_stale_board_semantic_transition_proof_rejects_before_install(self):
        legacy = self._legacy_semantic_readers()
        path, digest, _proof = self._transition("semantic-stale")
        board_path = self.root / "controllers/work-board.json"
        board = json.loads(board_path.read_text())
        board["revision"] += 1
        board["updated_at"] = "2026-10-02T00:00:01+00:00"
        board_path.write_text(json.dumps(board))
        before_states = {
            role: (self.root / f"{role}.json").read_bytes() for role in "ABC"
        }
        with self.assertRaisesRegex(RuntimeError, "TRANSITION_PROOF_MISMATCH"):
            self._run("semantic-stale", (path, digest))
        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), legacy)
            self.assertFalse((directory / "work_board_v2.py").exists())
        self.assertEqual(
            before_states,
            {role: (self.root / f"{role}.json").read_bytes() for role in "ABC"},
        )

    def test_tampered_semantic_transition_proof_rejects_before_install(self):
        legacy = self._legacy_semantic_readers()
        path, digest, _proof = self._transition("semantic-tamper")
        path.write_bytes(path.read_bytes() + b" ")
        with self.assertRaisesRegex(RuntimeError, "TRANSITION_PROOF_HASH_MISMATCH"):
            self._run("semantic-tamper", (path, digest))
        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), legacy)
            self.assertFalse((directory / "work_board_v2.py").exists())

    def test_unexpected_semantic_delta_rolls_back_exact_prior_readers(self):
        legacy = self._legacy_semantic_readers()
        a_queue = self.dirs["A"] / "work_queue.py"
        a_queue.chmod(0o640)
        self.assertEqual(stat.S_IMODE(a_queue.stat().st_mode), 0o640)
        path, digest, _proof = self._transition("semantic-rollback")
        board_path = self.root / "controllers/work-board.json"
        before_board = board_path.read_bytes()
        event_path = self.root / "controllers/work-board-events.jsonl"
        before_event = event_path.read_bytes() if event_path.exists() else None
        before_states = {
            role: (self.root / f"{role}.json").read_bytes() for role in "ABC"
        }
        original = rollout._semantic
        calls = {"n": 0}

        def inject(module, root):
            value = original(module, root)
            calls["n"] += 1
            # 4 baseline readers + 1 candidate proof check precede the first
            # installed-reader readback. Inject only after writes have begun.
            if calls["n"] == 6:
                value = copy.deepcopy(value)
                value["task_views"] = [{"unexpected": "task-view-delta"}]
                value["blocker_attention"] = [
                    {"task_id": "unexpected-after-install"}
                ]
            return value

        prior_umask = os.umask(0o077)
        try:
            with patch.object(rollout, "_semantic", inject):
                with self.assertRaisesRegex(RuntimeError, "rollback verified"):
                    self._run("semantic-rollback", (path, digest))
        finally:
            os.umask(prior_umask)
        self.assertEqual(stat.S_IMODE(a_queue.stat().st_mode), 0o640)
        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), legacy)
            self.assertFalse((directory / "work_board_v2.py").exists())
        self.assertEqual(board_path.read_bytes(), before_board)
        self.assertEqual(
            event_path.read_bytes() if event_path.exists() else None,
            before_event,
        )
        self.assertEqual(
            before_states,
            {role: (self.root / f"{role}.json").read_bytes() for role in "ABC"},
        )
        self.assertFalse(
            (self.root / "controllers/work-board-reader-rollouts/semantic-rollback.json").exists()
        )

    def test_queue_hash_mismatch_rejects_before_any_install(self):
        hashes = dict(self.queue_hashes, B="0" * 64)
        with self.assertRaisesRegex(RuntimeError, "QUEUE_SOURCE_MISMATCH"):
            rollout.rollout(self.root, self.candidates, self.dirs, hashes, self.module_prior, rollout_id="bad")
        self.assertTrue(all((directory / "work_queue.py").read_bytes() == self.old_queue for directory in self.dirs.values()))
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))

    def test_operational_org_reader_outside_git_is_supported_explicitly(self):
        shutil.rmtree(self.repo_roots["ORG"] / ".git")
        result = self._run("org-nonrepo")
        self.assertEqual(result["result"], "COMMITTED")
        self.assertEqual(result["git_status_before"]["ORG"], "ORG_OPERATIONAL_READER_OUTSIDE_GIT")
        self.assertEqual(result["git_status_before"]["ORG"], result["git_status_after"]["ORG"])

    def test_non_git_canonical_role_still_rejected(self):
        shutil.rmtree(self.repo_roots["A"] / ".git")
        with self.assertRaisesRegex(RuntimeError, "GIT_STATUS_UNAVAILABLE"):
            self._run("a-nonrepo")
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))

    def test_source_drift_while_waiting_for_locks_is_preserved(self):
        original_flock = rollout.fcntl.flock
        calls = {"n": 0}
        target = self.dirs["B"] / "work_queue.py"
        changed = self.old_queue + b"\n# intervening source change\n"
        def inject(fd, operation):
            original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                calls["n"] += 1
                if calls["n"] == 4:
                    target.write_bytes(changed)
        with patch.object(rollout.fcntl, "flock", inject):
            with self.assertRaisesRegex(RuntimeError, "QUEUE_SOURCE_MISMATCH"):
                self._run("source-drift")
        self.assertEqual(target.read_bytes(), changed)
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))

    def test_candidate_drift_while_waiting_for_locks_rejected_before_install(self):
        candidate = Path(self.tmp.name) / "candidate_queue.py"
        candidate.write_bytes(self.candidate_queue.read_bytes())
        self.candidates["work_queue"] = candidate
        original_flock = rollout.fcntl.flock
        calls = {"n": 0}
        def inject(fd, operation):
            original_flock(fd, operation)
            if operation == rollout.fcntl.LOCK_EX:
                calls["n"] += 1
                if calls["n"] == 4:
                    candidate.write_bytes(candidate.read_bytes() + b"\n# changed candidate\n")
        with patch.object(rollout.fcntl, "flock", inject):
            with self.assertRaisesRegex(RuntimeError, "CANDIDATE_DRIFT"):
                self._run("candidate-drift")
        self.assertTrue(all((directory / "work_queue.py").read_bytes() == self.old_queue for directory in self.dirs.values()))
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))

    def test_mid_rollout_failure_restores_both_exact_prior_files(self):
        status_before = {
            role: subprocess.run(
                ["git", "-C", str(repo), "status", "--porcelain=v1", "--untracked-files=all"],
                check=True, capture_output=True, text=True,
            ).stdout
            for role, repo in self.repo_roots.items()
        }
        real_replace = os.replace
        calls = {"n": 0}

        def fail_third(src, dst):
            calls["n"] += 1
            if calls["n"] == 3:
                raise OSError("injected second-target failure")
            return real_replace(src, dst)

        with patch.object(rollout.os, "replace", fail_third):
            with self.assertRaisesRegex(RuntimeError, "rollback verified"):
                self._run("fail")

        for directory in self.dirs.values():
            self.assertEqual((directory / "work_queue.py").read_bytes(), self.old_queue)
            self.assertFalse((directory / "work_board_v2.py").exists())
        self.assertFalse((self.root / "controllers/work-board-reader-rollouts/fail.json").exists())
        self.assertEqual(json.loads((self.root / "controllers/work-board.json").read_text())["version"], 1)
        status_after = {
            role: subprocess.run(
                ["git", "-C", str(repo), "status", "--porcelain=v1", "--untracked-files=all"],
                check=True, capture_output=True, text=True,
            ).stdout
            for role, repo in self.repo_roots.items()
        }
        self.assertEqual(status_after, status_before)
        scratch = self.root / "controllers/work-board-reader-rollouts"
        self.assertTrue(
            any(scratch.glob(".*.rollout.*.tmp")),
            "failed atomic write must retain evidence in control-root scratch",
        )

    def test_prior_missing_rollback_preserves_replacement_inode(self):
        victim = self.dirs["A"] / "work_board_v2.py"
        replacement_bytes = b"# external replacement must survive rollback\n"
        replacement_identity = {}
        board_before = (self.root / "controllers/work-board.json").read_bytes()
        event_path = self.root / "controllers/work-board-events.jsonl"
        events_before = event_path.read_bytes() if event_path.exists() else None
        role_state_before = {
            role: (self.root / f"{role}.json").read_bytes()
            for role in "ABC"
        }
        real_atomic = rollout._atomic
        calls = {"n": 0}

        def replace_then_fail(path, raw, mode, *, scratch_dir=None):
            calls["n"] += 1
            if calls["n"] == 3:
                replacement = self.root / "external-replacement.py"
                replacement.write_bytes(replacement_bytes)
                os.replace(replacement, victim)
                info = victim.stat()
                replacement_identity["value"] = (info.st_dev, info.st_ino)
                raise OSError("injected failure after replacement")
            return real_atomic(path, raw, mode, scratch_dir=scratch_dir)

        with patch.object(rollout, "_atomic", replace_then_fail):
            with self.assertRaisesRegex(
                RuntimeError,
                "WORK_BOARD_V2_ROLLOUT_ROLLBACK_FAILED",
            ):
                self._run("replacement-survives")

        self.assertTrue(victim.is_file())
        self.assertEqual(victim.read_bytes(), replacement_bytes)
        current = victim.stat()
        self.assertEqual(
            (current.st_dev, current.st_ino),
            replacement_identity["value"],
            "rollback must preserve the exact replacement inode",
        )
        self.assertEqual(
            (self.dirs["A"] / "work_queue.py").read_bytes(),
            self.old_queue,
        )
        self.assertEqual(
            (self.root / "controllers/work-board.json").read_bytes(),
            board_before,
        )
        self.assertEqual(
            event_path.read_bytes() if event_path.exists() else None,
            events_before,
        )
        self.assertEqual(
            {role: (self.root / f"{role}.json").read_bytes() for role in "ABC"},
            role_state_before,
        )

    def test_unexpected_existing_helper_refuses_before_any_target_change(self):
        old_helper = b"# unreviewed old helper\n"
        (self.dirs["A"] / "work_board_v2.py").write_bytes(old_helper)
        prior = dict(self.module_prior)
        prior["A"] = "f" * 64
        with self.assertRaisesRegex(RuntimeError, "PRIOR_MODULE_MISMATCH"):
            rollout.rollout(self.root, self.candidates, self.dirs, self.queue_hashes, prior, rollout_id="prior")
        self.assertEqual((self.dirs["A"] / "work_board_v2.py").read_bytes(), old_helper)
        for role in ("B", "C", "ORG"):
            self.assertEqual((self.dirs[role] / "work_queue.py").read_bytes(), self.old_queue)

    def test_only_executing_role_stop_blocks_rollout(self):
        (self.root / "A.json").write_text('{"status":"STOPPED"}')
        (self.root / "B.json").write_text('{"status":"STOPPED"}')
        (self.root / "C.json").write_text('{"status":"STOPPED"}')
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            self._run("stop-c")
        self.assertFalse(any((directory / "work_board_v2.py").exists() for directory in self.dirs.values()))


if __name__ == "__main__":
    unittest.main()
