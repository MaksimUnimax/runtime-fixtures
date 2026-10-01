"""Focused bounded lifecycle regressions; SQLite and flock are real."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import continuous_lifecycle as lifecycle
import continuous_state as state


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.control = Path(self.tmp.name)
        self.cfg = {"epoch": "test", "control_root": str(self.control), "repo": str(self.control), "enabled_roles": ["A", "B", "C"]}
        state.atomic_json(self.control / "controllers/runtime-mode.json", {"mode": "continuous-runtime", "epoch": "test", "roles": ["A", "B", "C"], "authorization_receipt": "test"})
        for role in state.ROLES:
            state.atomic_json(self.control / (role + ".json"), {"status": "RUNNING"})
        self.conn = state.db(self.cfg); self.addCleanup(self.conn.close)

    def author(self):
        path = self.control / "worktrees/A/runtime-author"; path.mkdir(parents=True)
        state.add_job(self.conn, "author", "A", "implement", {"task": {"id": "task", "requirement_id": "A01", "paths": ["source.py"]}, "worktree": str(path)})

    def admission(self, reason=None):
        return patch.multiple(lifecycle.resource_runner, snapshot=lambda _: {"available": 100},
            active_jobs=lambda _: [], effective_budget=lambda *args: 512, admission=lambda *args: reason)

    def test_capacity_wait_rechecks_gate_and_only_then_readmits_once(self):
        self.author(); state.transition(self.conn, "author", "BLOCKED", "RESOURCE_ADMISSION_WAIT")
        with self.admission("MEMORY_CAPACITY_REVIEW_REQUIRED"):
            lifecycle.readmit_capacity(self.cfg, self.conn); lifecycle.readmit_capacity(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs").fetchone()[0], "BLOCKED")
        with self.admission():
            lifecycle.readmit_capacity(self.cfg, self.conn); lifecycle.readmit_capacity(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs").fetchone()[0], "READY")
        self.assertEqual(self.conn.execute("SELECT count(*) FROM events WHERE event='capacity_readmitted'").fetchone()[0], 1)

    def test_capacity_wait_never_replays_launched_attempt(self):
        self.author(); state.transition(self.conn, "author", "BLOCKED", "RESOURCE_ADMISSION_WAIT")
        state.event(self.conn, "codex_launch_intent", "author", token=0)
        with self.admission():
            lifecycle.readmit_capacity(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs").fetchone()[0], "BLOCKED")

    def test_legacy_heavy_lock_keeps_capacity_waiting(self):
        self.author(); state.transition(self.conn, "author", "BLOCKED", "RESOURCE_ADMISSION_WAIT")
        with state.lock(self.control / "heavy.lock"), self.admission():
            lifecycle.readmit_capacity(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs").fetchone()[0], "BLOCKED")

    def final(self):
        self.author(); state.transition(self.conn, "author", "INTEGRATED")
        receipt = self.control / "controllers/receipt.json"; state.atomic_json(receipt, {"result": "PASS"})
        candidate = {"sha": "a" * 40, "tree": "b" * 40, "diff_sha256": "c" * 64}
        self.task = {"id": "task", "paths": ["source.py"], "candidate": candidate, "completion_receipt": str(receipt)}
        self.receipt_sha = state.digest(receipt.read_bytes())
        state.add_job(self.conn, "integration", "C", "integrate", {"author_job": "author", "task_id": "task", "candidate": candidate, "receipt": str(receipt)})
        state.transition(self.conn, "integration", "DONE", result={"head": "d" * 40, "remote_readback": "d" * 40})
        self.reference = {"id": "task", "candidate": candidate, "event_id": "archive:stable", "receipt_sha256": self.receipt_sha, "authority_id": "integration"}

    def archive(self, *args, **kwargs):
        claim = kwargs["archive_verifier"](self.task, self.receipt_sha)
        self.assertEqual(claim["integration"], "INTEGRATED")
        self.assertEqual(claim["authority_id"], "integration")
        return {"archived": [self.reference]}

    def test_final_archive_consumed_once_and_retained_for_planner(self):
        self.final()
        with patch.object(lifecycle.work_queue, "archive_done", side_effect=self.archive) as archive, patch.object(lifecycle.work_queue, "archived_task", return_value=self.reference):
            lifecycle.archive_integrated(self.cfg, self.conn); lifecycle.archive_integrated(self.cfg, self.conn)
        self.assertEqual(archive.call_count, 1)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM events WHERE event='queue_archive_consumed'").fetchone()[0], 1)
        self.assertEqual(json.loads(self.conn.execute("SELECT value FROM meta WHERE key='coverage:A01'").fetchone()[0])["candidate"], self.task["candidate"])

    def test_final_archive_retry_recovers_after_queue_side_commit(self):
        self.final()
        with patch.object(lifecycle.work_queue, "archive_done", side_effect=[OSError("append failed"), {"already_archived": ["task"]}]), patch.object(lifecycle.work_queue, "archived_task", return_value=self.reference):
            lifecycle.archive_integrated(self.cfg, self.conn); lifecycle.archive_integrated(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM events WHERE event='queue_archive_consumed'").fetchone()[0], 1)

    def test_pending_resource_group_prevents_archive(self):
        self.final()
        with patch.object(lifecycle.work_queue, "archive_done") as archive:
            lifecycle.archive_integrated(self.cfg, self.conn, {"A"})
        archive.assert_not_called()

    def test_manual_scope_claim_prevents_final_archive(self):
        self.final()
        self.conn.execute("INSERT INTO claims VALUES('claim','A','owner','base',?,'token','ACTIVE',0)", (state.encode(["source.py"]),))
        with patch.object(lifecycle.work_queue, "archive_done", side_effect=self.archive), patch.object(lifecycle.work_queue, "archived_task", return_value=self.reference):
            lifecycle.archive_integrated(self.cfg, self.conn)
        self.assertIsNone(self.conn.execute("SELECT value FROM meta WHERE key='archive:integration'").fetchone())

    def test_cleanup_retains_parent_or_dirty_worktrees(self):
        self.final(); self.conn.execute("INSERT INTO meta VALUES('archive:integration','{}')")
        with patch.object(lifecycle, "git", return_value=" M source.py") as git:
            lifecycle.cleanup_final_worktrees(self.cfg, self.conn)
        self.assertTrue((self.control / "worktrees/A/runtime-author").exists())
        self.assertFalse(any("remove" in c.args for c in git.call_args_list))


if __name__ == "__main__":
    unittest.main()
