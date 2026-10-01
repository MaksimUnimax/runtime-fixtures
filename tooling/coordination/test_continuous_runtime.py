"""Real SQLite/locks and bounded scheduler fault cases; no subscription calls."""
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import sys
from unittest.mock import Mock, patch

import continuous_adapter as adapter
import continuous_runtime as runtime
import continuous_state as state
import continuous_integration as integration
from datetime import datetime, timezone, timedelta


def verdict(kind="PASS", identity=None):
    return {"verdict": kind, "summary": "observed result", "candidate_sha": "",
            "candidate_tree": "", "diff_sha256": "", "checks": [], "findings": [],
            "tasks_json": "[]", "remaining": ["unverified installed boundary"], **(identity or {})}


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.control = Path(self.tmp.name)
        (self.control / "controllers").mkdir()
        for role in state.ROLES:
            state.atomic_json(self.control / (role + ".json"), {"status": "RUNNING"})
        state.atomic_json(self.control / "controllers/runtime-mode.json", {
            "mode": "continuous-runtime", "epoch": "test", "roles": ["A", "B", "C"],
            "authorization_receipt": "owner-exact-authorization"})
        self.cfg = {"version": 1, "epoch": "test", "control_root": str(self.control),
                    "enabled_roles": ["A", "B", "C"], "repo": str(self.control),
                    "config_path": str(self.control / "config.json"), "planner_interval_seconds": 60}
        self.conn = state.db(self.cfg)
        self.addCleanup(self.conn.close)
        managed = patch.object(adapter, "require_managed_job")
        managed.start(); self.addCleanup(managed.stop)

    def add(self, identifier="one", role="A", kind="implement", **spec):
        details = {"task": {"id": identifier, "paths": [identifier + ".py"]}, "base": "a" * 40,
                   "rules": {}, "worktree": str(self.control / identifier), "epoch": "test", **spec}
        state.add_job(self.conn, identifier, role, kind, details)
        return self.conn.execute("SELECT * FROM jobs WHERE id=?", (identifier,)).fetchone()

    def test_state_survives_restart(self):
        self.add()
        state.transition(self.conn, "one", "UNKNOWN", "crash")
        with state.db(self.cfg) as reopened:
            self.assertEqual(reopened.execute("SELECT state FROM jobs").fetchone()[0], "UNKNOWN")

    def test_conflicting_job_id_rejected(self):
        self.add()
        with self.assertRaisesRegex(RuntimeError, "CONFLICT"):
            self.add(task={"id": "different", "paths": ["other.py"]})

    def test_later_stop_cannot_be_cleared_by_start(self):
        state.atomic_json(self.control / "A.json", {"status": "STOPPED"})
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            state.check_mode(self.cfg, "A")
        self.assertEqual(state.read_json(self.control / "A.json")["status"], "STOPPED")

    def test_epoch_change_rejected(self):
        self.cfg["epoch"] = "stale"
        with self.assertRaisesRegex(RuntimeError, "CUTOVER_MISMATCH"):
            state.check_mode(self.cfg, "A")

    def test_missing_role_state_fails_closed(self):
        (self.control / "A.json").unlink()
        with self.assertRaises(OSError):
            state.check_mode(self.cfg, "A")

    def test_global_stop(self):
        marker = state.read_json(self.control / "controllers/runtime-mode.json")
        marker["stopped"] = True
        state.atomic_json(self.control / "controllers/runtime-mode.json", marker)
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            state.check_mode(self.cfg, "B")

    def test_old_runner_and_mutating_controls_rejected(self):
        for action in ("start", "resume", "checkpoint", "queue-add", "heavy", "codex-child", "submit"):
            with self.subTest(action=action), self.assertRaisesRegex(RuntimeError, "RUNTIME_OWNS_ROLE"):
                state.legacy_write_guard(self.control, "A", action)
        for action in ("status", "pause", "resources"):
            state.legacy_write_guard(self.control, "A", action)

    def test_profile_busy_never_launches_codex(self):
        self.add()
        self.conn.execute("UPDATE jobs SET state='STARTING',token=1 WHERE id='one'")
        with state.lock(self.control / "codex-A.lock"), patch.object(adapter.subprocess, "Popen") as launch:
            self.assertEqual(adapter.run_entry(self.cfg, "one", 1), 75)
            launch.assert_not_called()
        self.assertEqual(self.conn.execute("SELECT state FROM jobs").fetchone()[0], "READY")

    def test_stale_entry_token_never_launches(self):
        self.add()
        self.conn.execute("UPDATE jobs SET state='STARTING',token=2 WHERE id='one'")
        with patch.object(adapter, "rules_snapshot", return_value={}), patch.object(adapter.subprocess, "Popen") as launch:
            self.assertEqual(adapter.run_entry(self.cfg, "one", 1), 77)
            launch.assert_not_called()

    def test_entry_registered_before_login(self):
        self.add()
        self.conn.execute("UPDATE jobs SET state='STARTING',token=1 WHERE id='one'")
        def login(*args, **kwargs):
            row = self.conn.execute("SELECT * FROM jobs WHERE id='one'").fetchone()
            self.assertEqual(row["state"], "RUNNING")
            self.assertEqual(row["entry_pid"], os.getpid())
            self.assertEqual(row["entry_birth"], state.birth(os.getpid()))
            return Mock(returncode=1, stdout="", stderr="not logged in")
        with patch.object(adapter, "rules_snapshot", return_value={}), patch.object(adapter.subprocess, "run", side_effect=login), patch.object(adapter.subprocess, "Popen") as launch:
            self.assertEqual(adapter.run_entry(self.cfg, "one", 1), 78)
            launch.assert_not_called()
        self.assertEqual(self.conn.execute("SELECT state FROM jobs").fetchone()[0], "BLOCKED")

    def test_rule_change_blocks_execution(self):
        self.add()
        self.conn.execute("UPDATE jobs SET state='STARTING',token=1 WHERE id='one'")
        with patch.object(adapter, "rules_snapshot", return_value={"AGENTS.md": "changed"}), patch.object(adapter.subprocess, "Popen") as launch:
            self.assertEqual(adapter.run_entry(self.cfg, "one", 1), 1)
            launch.assert_not_called()

    def test_recovery_keeps_live_pid_birth(self):
        self.add()
        self.conn.execute("UPDATE jobs SET state='RUNNING',entry_pid=?,entry_birth=?", (os.getpid(), state.birth(os.getpid())))
        runtime.recover(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs WHERE id='one'").fetchone()[0], "RUNNING")

    def test_recovery_does_not_replay_unknown_writer(self):
        self.add()
        self.conn.execute("UPDATE jobs SET state='RUNNING',entry_pid=99999999,entry_birth='x'")
        with patch.object(runtime, "freeze_candidate", side_effect=RuntimeError("dirty unknown")):
            runtime.recover(self.cfg, self.conn)
            runtime.recover(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs WHERE id='one'").fetchone()[0], "UNKNOWN")
        self.assertEqual(self.conn.execute("SELECT count(*) FROM jobs WHERE kind='implement'").fetchone()[0], 1)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM jobs WHERE kind='reconcile_review'").fetchone()[0], 1)

    def test_recovery_waits_for_profile_lock(self):
        self.add()
        self.conn.execute("UPDATE jobs SET state='RUNNING'")
        with state.lock(self.control / "codex-A.lock"):
            runtime.recover(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs").fetchone()[0], "RUNNING")

    def test_recovery_waits_for_dedicated_worker_lock(self):
        self.add()
        self.conn.execute("UPDATE jobs SET state='STARTING'")
        with state.lock(state.root(self.cfg) / "locks/one.lock"):
            runtime.recover(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs").fetchone()[0], "STARTING")

    def test_stale_review_identity_fails(self):
        identity = {"candidate_sha": "a" * 40, "candidate_tree": "b" * 40, "diff_sha256": "c" * 64}
        result = verdict("ACCEPT", identity)
        result["checks"] = [{"name": "inspect", "exit_code": 0, "evidence": "checked code"}]
        adapter.validate_result("review", result, {"identity": identity})
        result["candidate_sha"] = "d" * 40
        with self.assertRaisesRegex(RuntimeError, "CANDIDATE_MISMATCH"):
            adapter.validate_result("review", result, {"identity": identity})

    def test_review_accept_requires_real_explicit_checks(self):
        identity = {"candidate_sha": "a" * 40, "candidate_tree": "b" * 40, "diff_sha256": "c" * 64}
        with self.assertRaisesRegex(RuntimeError, "PASSED_CHECKS"):
            adapter.validate_result("review", verdict("ACCEPT", identity), {"identity": identity})
        with self.assertRaisesRegex(RuntimeError, "EXPLICIT_VERDICT"):
            adapter.validate_result("review", verdict("PASS", identity), {"identity": identity})

    def test_author_cannot_self_accept(self):
        with self.assertRaisesRegex(RuntimeError, "AUTHOR_CANNOT_ACCEPT"):
            adapter.validate_result("implement", verdict("ACCEPT"), {})

    def test_duplicate_json_keys_fail_closed(self):
        path = self.control / "duplicate.json"; path.write_text('{"state":"STOPPED","state":"RUNNING"}')
        with self.assertRaisesRegex(RuntimeError, "DUPLICATE"):
            state.read_json(path)

    def test_fifo_prevents_review_flood_feature_starvation(self):
        self.add("feature")
        self.conn.execute("UPDATE jobs SET created=1 WHERE id='feature'")
        for number in range(20):
            self.add("hotfix-review-" + str(number), kind="review")
        with patch.object(runtime, "prepare"), patch.object(runtime.subprocess, "Popen", return_value=Mock(pid=123)) as launch:
            children = runtime.launch(self.cfg, self.conn)
        self.assertEqual(len(children), 1)
        self.assertIn("feature", launch.call_args.args[0])

    def test_free_profile_can_review_no_permanent_reviewer_slot(self):
        self.add("busy-B", role="B")
        self.conn.execute("UPDATE jobs SET state='RUNNING'")
        self.assertEqual(runtime.other_role(self.cfg, "A"), "C")

    def test_no_repeated_planner_on_identical_inputs(self):
        requirements = {"A01": {"id": "A01", "role": "A"}}
        with patch.object(runtime, "requirements", return_value=requirements), patch.object(runtime.work_queue, "role_work", return_value={"tasks": []}), patch.object(runtime.work_queue, "load_board", return_value={"tasks": []}), patch.object(runtime, "git", return_value="a" * 40), patch.object(runtime, "rules_snapshot", return_value={}):
            runtime.schedule_planners(self.cfg, self.conn)
            self.conn.execute("UPDATE jobs SET state='IDLE_RECONCILIATION',created=?", (time.time() - 1000,))
            runtime.schedule_planners(self.cfg, self.conn)
        self.assertEqual(self.conn.execute("SELECT count(*) FROM jobs WHERE kind='plan'").fetchone()[0], 1)

    def test_no_project_readiness_inferred_from_empty_or_done_jobs(self):
        self.assertFalse(runtime.snapshot(self.cfg, self.conn)["project_ready"])
        self.add(); state.transition(self.conn, "one", "DONE")
        self.assertFalse(runtime.snapshot(self.cfg, self.conn)["project_ready"])

    def test_claim_protects_paths_until_owner_release(self):
        with patch.object(runtime, "git", return_value="a" * 40):
            result = runtime.manual_claim(self.cfg, self.conn, "C", "controller", "a" * 40, ["tooling/example.py"])
            self.assertEqual((Path(result["token_file"]).stat().st_mode & 0o777), 0o600)
            with self.assertRaisesRegex(RuntimeError, "ALREADY_CLAIMED"):
                runtime.manual_claim(self.cfg, self.conn, "C", "other", "a" * 40, ["tooling/example.py"])
            runtime.release_claim(self.cfg, self.conn, result["token_file"])
            runtime.manual_claim(self.cfg, self.conn, "C", "other", "a" * 40, ["tooling/example.py"])

    def test_claim_rejects_active_runtime_scope(self):
        self.add()
        with patch.object(runtime, "git", return_value="a" * 40), self.assertRaisesRegex(RuntimeError, "ALREADY_CLAIMED"):
            runtime.manual_claim(self.cfg, self.conn, "C", "controller", "a" * 40, ["one.py"])

    def test_unknown_reserves_paths(self):
        self.add(); state.transition(self.conn, "one", "UNKNOWN")
        self.assertIn("one.py", runtime.paths_reserved(self.conn))

    def test_unaccepted_review_callback_fails(self):
        self.add(kind="review")
        with self.assertRaisesRegex(RuntimeError, "TRUSTED_REVIEW_REQUIRED"):
            runtime.accepted_verifier(self.cfg, self.conn, "one")({}, {}, "x")

    def check_fixture(self, command):
        worktree = self.control / "source"; worktree.mkdir()
        (worktree / "source.py").write_text("answer = 1\n")
        directory = self.control / "logs"; directory.mkdir()
        spec = {"worktree": str(worktree), "task": {"paths": ["source.py"], "required_checks": ["actual"]}}
        self.cfg["check_catalog"] = {"actual": {"argv": [sys.executable, "-c", command],
            "environment": {"capability": "python-stdlib"}}}
        return spec, directory

    def test_collector_rejects_check_that_mutates_source(self):
        spec, directory = self.check_fixture("from pathlib import Path; Path('source.py').write_text('answer=2')")
        with patch.object(adapter, "source_inputs", return_value={"x": "a" * 64}), patch.object(adapter.continuous_environment, "ensure_environment", return_value={"status": "READY", "execution_env": {}, "evidence": {}}), self.assertRaisesRegex(RuntimeError, "CHECK_MUTATED_SOURCE"):
            adapter.run_checks(self.cfg, {"id": "job", "role": "A", "token": 1}, spec, directory)
        self.assertFalse((directory / "trusted-checks.json").exists())

    def test_collector_records_actual_nonzero_exit(self):
        spec, directory = self.check_fixture("raise SystemExit(7)")
        with patch.object(adapter, "source_inputs", return_value={"x": "a" * 64}), patch.object(adapter.continuous_environment, "ensure_environment", return_value={"status": "READY", "execution_env": {}, "evidence": {}}), self.assertRaisesRegex(adapter.CheckFailure, "TRUSTED_CHECK_FAILED"):
            adapter.run_checks(self.cfg, {"id": "job", "role": "A", "token": 1}, spec, directory)
        receipt = state.read_json(directory / "trusted-checks.json")
        self.assertEqual(receipt["checks"][0]["exit_code"], 7)
        self.assertEqual(receipt["collector"], "SUPERVISOR_SUBPROCESS")

    def test_controller_metadata_requires_live_claim_token(self):
        with patch.object(runtime, "git", return_value="a" * 40):
            claim = runtime.manual_claim(self.cfg, self.conn, "A", "controller", "a" * 40, ["controller-review-A.json"])
        state.legacy_write_guard(self.control, "A", "reviewed", claim["token_file"])
        runtime.release_claim(self.cfg, self.conn, claim["token_file"])
        with self.assertRaisesRegex(RuntimeError, "TOKEN_INVALID"):
            state.legacy_write_guard(self.control, "A", "reviewed", claim["token_file"])

    def test_stopped_role_can_claim_but_old_claim_cannot_resume_later_stop(self):
        state.atomic_json(self.control / "A.json", {"status": "STOPPED", "stopped_at": datetime.now(timezone.utc).isoformat()})
        with patch.object(runtime, "git", return_value="a" * 40):
            claim = runtime.manual_claim(self.cfg, self.conn, "A", "controller", "a" * 40, ["controller-review-A.json"])
        state.legacy_write_guard(self.control, "A", "resume", claim["token_file"])
        state.atomic_json(self.control / "A.json", {"status": "STOPPED", "stopped_at": (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()})
        with self.assertRaisesRegex(RuntimeError, "FRESH_CLAIM_REQUIRED"):
            state.legacy_write_guard(self.control, "A", "resume", claim["token_file"])
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            state.check_mode(self.cfg, "A")

    def test_source_snapshot_includes_executable_bit(self):
        path = self.control / "source.py"; path.write_text("x = 1\n"); path.chmod(0o644)
        before = adapter.source_snapshot(self.control, ["source.py"])
        path.chmod(0o755)
        self.assertNotEqual(before, adapter.source_snapshot(self.control, ["source.py"]))

    def test_missing_check_is_explicit_local_block(self):
        with self.assertRaisesRegex(RuntimeError, "TRUSTED_CHECK_NOT_CONFIGURED"):
            adapter.source_inputs(self.cfg, {"required_checks": ["missing"]})

    def integration_fixture(self):
        author = self.add(task={"id": "task", "paths": ["source.py"]})
        state.transition(self.conn, "one", "ACCEPTED")
        spec = {"task_id": "task", "candidate": {"sha": "a" * 40}, "base": "b" * 40,
                "author_job": "one", "rules": {}, "epoch": "test", "receipt": "receipt"}
        state.add_job(self.conn, "integrate-one", "C", "integrate", spec)
        return self.conn.execute("SELECT * FROM jobs WHERE id='integrate-one'").fetchone(), spec

    def test_main_advance_enqueues_new_immutable_integration(self):
        row, spec = self.integration_fixture()
        with patch.object(integration, "git", return_value="c" * 40), patch.object(integration, "rules_snapshot", return_value={}):
            integration.failure_handoff(self.cfg, self.conn, row, spec, "REMOTE_MAIN_CHANGED_NEW_INTEGRATION_REQUIRED")
            integration.failure_handoff(self.cfg, self.conn, row, spec, "REMOTE_MAIN_CHANGED_NEW_INTEGRATION_REQUIRED")
        next_job = self.conn.execute("SELECT * FROM jobs WHERE kind='integrate' AND state='READY'").fetchall()
        self.assertEqual(len(next_job), 1)
        self.assertEqual(json.loads(next_job[0]["spec"])["candidate"], spec["candidate"])
        self.assertEqual(self.conn.execute("SELECT state FROM jobs WHERE id='one'").fetchone()[0], "ACCEPTED")

    def test_ci_failure_is_consumed_author_rework(self):
        row, spec = self.integration_fixture()
        task = {"id": "task", "paths": ["source.py"], "state": "DONE", "proof_generation": 1}
        def reopen(*args):
            task.update(state="IN_PROGRESS", proof_generation=2)
        with patch.object(integration, "git", return_value="c" * 40), patch.object(integration, "rules_snapshot", return_value={}), patch.object(integration.work_queue, "load_board", return_value={"tasks": [task]}), patch.object(integration.work_queue, "reopen_task", side_effect=reopen):
            integration.failure_handoff(self.cfg, self.conn, row, spec, "EXACT_CANDIDATE_CI_FAILED")
            integration.failure_handoff(self.cfg, self.conn, row, spec, "EXACT_CANDIDATE_CI_FAILED")
        next_job = self.conn.execute("SELECT * FROM jobs WHERE kind='implement' AND state='READY'").fetchall()
        self.assertEqual(len(next_job), 1)
        repair = json.loads(next_job[0]["spec"])
        self.assertEqual(repair["task"]["proof_generation"], 2)
        self.assertEqual(repair["seed_candidate"], spec["candidate"]["sha"])
        self.assertEqual(repair["base"], "c" * 40)
        self.assertEqual(self.conn.execute("SELECT state FROM jobs WHERE id='one'").fetchone()[0], "SUPERSEDED")


if __name__ == "__main__":
    unittest.main()
