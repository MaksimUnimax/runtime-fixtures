"""Focused bounded lifecycle regressions; SQLite and flock are real."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import contextlib

import continuous_lifecycle as lifecycle
import continuous_state as state
import continuous_runtime as runtime
import continuous_integration as integration


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
        self.conn.execute("UPDATE jobs SET token=2 WHERE id='author'")
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
        self.assertEqual(json.loads(self.conn.execute("SELECT value FROM meta WHERE key='coverage:A01:task'").fetchone()[0])["candidate"], self.task["candidate"])

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

    def test_cleanup_rechecks_new_claim_after_archive(self):
        self.final(); self.conn.execute("INSERT INTO meta VALUES('archive:integration','{}')")
        self.conn.execute("INSERT INTO claims VALUES('claim','A','owner','base',?,'token','ACTIVE',0)", (state.encode(["source.py"]),))
        with patch.object(lifecycle, "git", return_value="") as git:
            lifecycle.cleanup_final_worktrees(self.cfg, self.conn)
        git.assert_not_called()

    def test_cleanup_rechecks_new_active_job_after_archive(self):
        self.final(); self.conn.execute("INSERT INTO meta VALUES('archive:integration','{}')")
        self.conn.execute("UPDATE jobs SET state='RUNNING' WHERE id='author'")
        with patch.object(lifecycle, "git", return_value="") as git:
            lifecycle.cleanup_final_worktrees(self.cfg, self.conn)
        git.assert_not_called()

    def test_all_archived_leaves_remain_available_through_bounded_pages(self):
        for number in range(125):
            self.conn.execute("INSERT INTO meta VALUES(?,?)", ("coverage:A01:task" + str(number), state.encode({"id": "task" + str(number)})))
        first = lifecycle.coverage_page(self.cfg, self.conn, "A01")
        self.assertEqual(first["count"], 125)
        self.assertEqual(len(first["entries"]), 10)
        seen = set()
        for offset in range(0, 125, 10):
            seen.update(x["id"] for x in lifecycle.coverage_page(self.cfg, self.conn, "A01", offset)["entries"])
        self.assertEqual(len(seen), 125)
        self.assertTrue(first["lookup"]["read_only"])
        self.assertFalse(first["project_ready"])

    def test_integration_terminal_pair_rolls_back_if_second_write_crashes(self):
        self.final()
        state.transition(self.conn, "author", "ACCEPTED")
        state.transition(self.conn, "integration", "MAIN_PENDING")
        row = self.conn.execute("SELECT * FROM jobs WHERE id='integration'").fetchone()
        spec = json.loads(row["spec"]); saved = {"head": "d" * 40}
        def interrupted(conn, job, *args, **kwargs):
            if job == "author":
                raise SystemExit("crash before paired author write")
            state.transition(conn, job, *args, **kwargs)
        with patch.object(integration, "transition", side_effect=interrupted), self.assertRaises(SystemExit):
            integration.complete_integration(self.conn, row, spec, saved, saved["head"])
        self.assertEqual(self.conn.execute("SELECT state FROM jobs WHERE id='integration'").fetchone()[0], "MAIN_PENDING")
        self.assertEqual(self.conn.execute("SELECT state FROM jobs WHERE id='author'").fetchone()[0], "ACCEPTED")
        integration.complete_integration(self.conn, row, spec, saved, saved["head"])
        self.assertEqual(self.conn.execute("SELECT state FROM jobs WHERE id='author'").fetchone()[0], "INTEGRATED")

    def completion_fixture(self, crash):
        self.author()
        task = {"id": "task", "role": "A", "plan": "A01", "state": "READY", "paths": ["source.py"],
                "acceptance": ["check"], "result": "bounded", "basis": "approved", "requirement_id": "A01",
                "boundary": "SOURCE", "required_checks": ["check"], "requires": [], "proof_generation": 0,
                "proof_validity": {"kind": "SNAPSHOT", "input_hashes": {"source": "a" * 64}}}
        identity = {"candidate_sha": "a" * 40, "candidate_tree": "b" * 40, "diff_sha256": "c" * 64}
        candidate = {"sha": identity["candidate_sha"], "tree": identity["candidate_tree"], "diff_sha256": identity["diff_sha256"]}
        authored = {"task": task, "worktree": str(self.control / "worktrees/A/runtime-author"), "base": "d" * 40}
        self.conn.execute("UPDATE jobs SET spec=?,result='{}',state='REVIEW_PENDING' WHERE id='author'", (state.encode(authored),))
        spec = {"author_job": "author", "identity": identity, "generation": 0}
        state.add_job(self.conn, "review", "B", "review", spec); state.transition(self.conn, "review", "RESULT", result={"verdict": "ACCEPT"})
        row = self.conn.execute("SELECT * FROM jobs WHERE id='review'").fetchone()
        self.cfg["check_catalog"] = {"check": {"argv": ["python3", "check.py"]}}
        directory = state.root(self.cfg) / "jobs/author"; directory.mkdir(parents=True)
        log = directory / "check.log"; log.write_text("PASS\n")
        state.atomic_json(directory / "trusted-checks.json", {"collector": "SUPERVISOR_SUBPROCESS", "job": "author", "token": 0,
            "boundary": "SOURCE", "input_hashes": task["proof_validity"]["input_hashes"], "source_snapshot": "snapshot",
            "checks": [{"id": "check", "exit_code": 0, "collector": "SUPERVISOR_SUBPROCESS", "argv_sha256": state.digest(state.encode(self.cfg["check_catalog"]["check"]["argv"])),
                        "log_path": str(log), "log_sha256": state.digest(log.read_bytes())}]})
        fired = []
        def advance(*args, **kwargs):
            task.update(state="DONE", candidate=candidate, completion_receipt_sha256=state.digest(Path(kwargs["receipt"]).read_bytes()))
            if crash == "board" and not fired:
                fired.append(True); raise SystemExit("after durable boardDONE")
        def handoff(*args, **kwargs):
            if crash == "handoff" and not fired:
                fired.append(True); raise SystemExit("after authorACCEPTED before add_job")
            return state.add_job(*args, **kwargs)
        with contextlib.ExitStack() as mocks:
            for name, value in {"candidate_identity": lambda *a: identity, "git": lambda *a: "",
                                "source_inputs": lambda *a: task["proof_validity"]["input_hashes"], "source_snapshot": lambda *a: "snapshot",
                                "rules_snapshot": lambda *a: {}, "accepted_verifier": lambda *a: lambda *args: {}, "add_job": handoff}.items():
                mocks.enter_context(patch.object(runtime, name, side_effect=value))
            mocks.enter_context(patch.object(runtime.work_queue, "load_board", side_effect=lambda *a: {"tasks": [task]}))
            mocks.enter_context(patch.object(runtime.work_queue, "validate_board", side_effect=lambda *a: {"board": {"tasks": [task]}}))
            mocks.enter_context(patch.object(runtime.work_queue, "register_acceptance"))
            advance_mock = mocks.enter_context(patch.object(runtime.work_queue, "advance_task", side_effect=advance))
            with self.assertRaises(SystemExit):
                runtime.complete_task(self.cfg, self.conn, row, spec, {})
            receipt = state.root(self.cfg) / "jobs/review/completion-receipt.json"
            original = receipt.read_bytes()
            runtime.complete_task(self.cfg, self.conn, row, spec, {})
            self.assertEqual(receipt.read_bytes(), original)
            self.assertEqual(advance_mock.call_count, 1)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM jobs WHERE kind='integrate'").fetchone()[0], 1)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs WHERE id='author'").fetchone()[0], "ACCEPTED")

    def test_completion_recovers_after_durable_board_done(self):
        self.completion_fixture("board")

    def test_completion_recovers_after_author_before_handoff(self):
        self.completion_fixture("handoff")


if __name__ == "__main__":
    unittest.main()
