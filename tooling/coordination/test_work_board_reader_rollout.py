import hashlib
import json
import os
import shutil
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

    def _run(self, rid="r1"):
        return rollout.rollout(self.root, self.candidates, self.dirs, self.queue_hashes, self.module_prior, rollout_id=rid)

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
