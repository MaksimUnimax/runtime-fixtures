"""Independent adversarial tests; temporary SQLite/flock fixtures, no Codex/live."""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import continuous_state as state
import continuous_adapter as adapter
import continuous_runtime as runtime


class RuntimeIndependent(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parents[2] / ".test-tmp"
        parent.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="independent-", dir=parent)
        self.addCleanup(self.tmp.cleanup)
        self.area = Path(self.tmp.name)
        self.control = self.area / "control"
        self.repo = self.area / "repo"
        self.repo.mkdir()
        self.cfg = {"control_root": str(self.control), "repo": str(self.repo),
                    "epoch": "independent", "enabled_roles": ["A", "B", "C"],
                    "requirements": str(self.area / "requirements.json")}
        self.marker = {"mode": "continuous-runtime", "epoch": "independent",
                       "roles": ["A", "B", "C"], "authorization_receipt": "fixture"}
        self.set_mode()
        for role in "ABC":
            state.atomic_json(self.control / (role + ".json"), {"status": "RUNNING"})
        self.req = {"id": "req-A", "role": "A", "plan": "A01",
                    "acceptance": ["criterion"]}
        state.atomic_json(self.cfg["requirements"], {"requirements": [self.req]})
        ownership = {"roles": {
            "A": {"allow": ["apps/a/**"], "deny": []},
            "B": {"allow": ["apps/b/**"], "deny": []},
            "C": {"allow": ["**"], "deny": []}}}
        state.atomic_json(self.repo / "docs/development/coordination/OWNERSHIP.json", ownership)
        self.conn = state.db(self.cfg)
        self.addCleanup(self.conn.close)

    def set_mode(self, **changes):
        self.marker.update(changes)
        state.atomic_json(self.control / "controllers/runtime-mode.json", self.marker)

    def add(self, identifier="job-A", role="A", kind="implement", spec=None,
            current="READY", token=0):
        state.add_job(self.conn, identifier, role, kind, spec or {})
        self.conn.execute("UPDATE jobs SET state=?,token=? WHERE id=?",
                          (current, token, identifier))
        self.conn.commit()
        return self.conn.execute("SELECT * FROM jobs WHERE id=?", (identifier,)).fetchone()

    def current(self, identifier="job-A"):
        return self.conn.execute("SELECT * FROM jobs WHERE id=?", (identifier,)).fetchone()

    def task(self, **changes):
        value = {"id": "task-A", "requirement_id": "req-A", "role": "A", "plan": "A01",
                 "state": "READY", "basis": "approved fixture",
                 "paths": ["apps/a/source.py"], "acceptance": ["criterion"],
                 "boundary": "SOURCE", "required_checks": ["unit"]}
        value.update(changes)
        return value

    def validate(self, task):
        with mock.patch.object(state, "requirements", return_value={"req-A": self.req}):
            return state.validate_task(self.cfg, task)

    def result(self, **changes):
        value = {"verdict": "ACCEPT", "summary": "fixture",
                 "candidate_sha": "a" * 40, "candidate_tree": "b" * 40,
                 "diff_sha256": "c" * 64, "checks": [
                     {"name": "unit", "exit_code": 0, "evidence": "/fixture/log"}],
                 "findings": [], "tasks_json": "", "remaining": []}
        value.update(changes)
        return value

    def review_spec(self):
        return {"identity": {k: v for k, v in self.result().items()
                             if k in ("candidate_sha", "candidate_tree", "diff_sha256")}}

    def test_stale_entry_cannot_reset_running_attempt_when_profile_busy(self):
        self.add(current="RUNNING", token=2)
        with state.lock(self.control / "codex-A.lock"):
            adapter.run_entry(self.cfg, "job-A", 1)
        self.assertEqual(("RUNNING", 2), (self.current()["state"], self.current()["token"]))

    def test_stale_entry_cannot_mutate_current_attempt_when_stop(self):
        self.add(current="RUNNING", token=2)
        self.set_mode(stopped=True)
        adapter.run_entry(self.cfg, "job-A", 1)
        self.assertEqual(("RUNNING", 2), (self.current()["state"], self.current()["token"]))

    def test_source_executor_rejects_live_evidence_request(self):
        with self.assertRaises(RuntimeError):
            self.validate(self.task(boundary="LIVE"))

    def test_allowed_filename_with_zero(self):
        self.validate(self.task(paths=["apps/a/version0.py"]))

    def test_traversal_scope_rejected(self):
        with self.assertRaises(RuntimeError):
            self.validate(self.task(paths=["apps/a/../../secret"]))

    def test_cross_owner_scope_rejected(self):
        with self.assertRaises(RuntimeError):
            self.validate(self.task(paths=["apps/b/source.py"]))

    def test_absolute_scope_rejected(self):
        with self.assertRaises(RuntimeError):
            self.validate(self.task(paths=["/tmp/source.py"]))

    def test_glob_scope_rejected(self):
        with self.assertRaises(RuntimeError):
            self.validate(self.task(paths=["apps/a/*.py"]))

    def test_unapproved_requirement_rejected(self):
        with self.assertRaises(RuntimeError):
            self.validate(self.task(requirement_id="invented"))

    def test_nonstring_check_name_rejected(self):
        value = self.result(checks=[{"name": ["unit"], "exit_code": 0, "evidence": "log"}])
        with self.assertRaises((RuntimeError, ValueError)):
            adapter.validate_result("review", value, self.review_spec())

    def test_nonstring_check_evidence_rejected(self):
        value = self.result(checks=[{"name": "unit", "exit_code": 0, "evidence": ["log"]}])
        with self.assertRaises((RuntimeError, ValueError)):
            adapter.validate_result("review", value, self.review_spec())

    def test_boolean_exit_code_rejected(self):
        value = self.result(checks=[{"name": "unit", "exit_code": False, "evidence": "log"}])
        with self.assertRaises((RuntimeError, ValueError)):
            adapter.validate_result("review", value, self.review_spec())

    def test_review_wrong_candidate_rejected(self):
        with self.assertRaises((RuntimeError, ValueError)):
            adapter.validate_result("review", self.result(candidate_sha="d"*40), self.review_spec())

    def test_accept_with_findings_rejected(self):
        with self.assertRaises((RuntimeError, ValueError)):
            adapter.validate_result("review", self.result(findings=["unfinished"]), self.review_spec())

    def test_author_cannot_self_accept(self):
        with self.assertRaises((RuntimeError, ValueError)):
            adapter.validate_result("implement", self.result(), {})

    def test_valid_exact_review_accepted(self):
        adapter.validate_result("review", self.result(), self.review_spec())

    def test_task_completion_not_project_acceptance(self):
        self.add(current="DONE")
        before = Path(self.cfg["requirements"]).read_bytes()
        self.assertIs(runtime.snapshot(self.cfg, self.conn)["project_ready"], False)
        self.assertEqual(before, Path(self.cfg["requirements"]).read_bytes())

    def test_empty_queue_not_project_acceptance(self):
        self.assertIs(runtime.snapshot(self.cfg, self.conn)["project_ready"], False)

    def test_global_stop_blocks_new_work(self):
        self.set_mode(stopped=True)
        with self.assertRaises(RuntimeError):
            state.check_mode(self.cfg, "A")

    def test_role_stop_is_local(self):
        state.atomic_json(self.control / "A.json", {"status": "STOPPED"})
        with self.assertRaises(RuntimeError):
            state.check_mode(self.cfg, "A")
        state.check_mode(self.cfg, "B")

    def test_wrong_epoch_blocks(self):
        self.set_mode(epoch="old")
        with self.assertRaises(RuntimeError):
            state.check_mode(self.cfg, "A")

    def test_legacy_writer_blocked(self):
        with self.assertRaises(RuntimeError):
            state.legacy_write_guard(self.control, "A", "submit")

    def test_legacy_stop_and_status_permitted(self):
        for action in ("pause", "status", "resources"):
            state.legacy_write_guard(self.control, "A", action)

    def test_duplicate_identical_job_is_idempotent(self):
        self.add()
        self.assertFalse(state.add_job(self.conn, "job-A", "A", "implement", {}))
        self.assertEqual(1, self.conn.execute("SELECT COUNT(*) FROM jobs").fetchone()[0])

    def test_duplicate_changed_job_rejected(self):
        self.add()
        with self.assertRaises(RuntimeError):
            state.add_job(self.conn, "job-A", "B", "implement", {})

    def check_fixture(self, code="print('checked')", timeout=3):
        import subprocess
        import sys
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        subprocess.run(["git", "-C", str(self.repo), "config", "user.email", "fixture@example.invalid"], check=True)
        subprocess.run(["git", "-C", str(self.repo), "config", "user.name", "Fixture"], check=True)
        (self.repo / "source.py").write_text("VALUE = 1\n")
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.repo), "commit", "-qm", "fixture"], check=True)
        self.cfg["check_catalog"] = {"unit": {
            "argv": [sys.executable, "-c", code], "timeout_seconds": timeout,
            "environment": {"capability": "python-stdlib"}}}
        spec = {"task": self.task(), "worktree": str(self.repo)}
        row = self.add(spec=spec, current="RUNNING", token=1)
        directory = state.root(self.cfg) / "jobs" / "job-A"
        directory.mkdir(parents=True)
        return row, spec, directory

    def test_trusted_check_records_actual_exit_and_bytes(self):
        row, spec, directory = self.check_fixture()
        adapter.run_checks(self.cfg, row, spec, directory)
        receipt = state.read_json(directory / "trusted-checks.json")
        self.assertEqual(0, receipt["checks"][0]["exit_code"])
        self.assertEqual("SOURCE", receipt["boundary"])
        check = receipt["checks"][0]
        self.assertEqual(state.digest(Path(check["log_path"]).read_bytes()), check["log_sha256"])
        self.assertEqual("checked\n", Path(check["log_path"]).read_text())

    def test_trusted_check_failure_not_model_pass(self):
        row, spec, directory = self.check_fixture("import sys; print('claimed PASS'); sys.exit(7)")
        with self.assertRaises(RuntimeError):
            adapter.run_checks(self.cfg, row, spec, directory)
        receipt = state.read_json(directory / "trusted-checks.json")
        self.assertEqual(7, receipt["checks"][0]["exit_code"])

    def test_trusted_check_timeout_is_bounded(self):
        import time
        row, spec, directory = self.check_fixture("import time; time.sleep(10)", timeout=1)
        started = time.monotonic()
        with self.assertRaises(RuntimeError):
            adapter.run_checks(self.cfg, row, spec, directory)
        self.assertLess(time.monotonic() - started, 5)

    def test_stop_prevents_trusted_command_effect(self):
        row, spec, directory = self.check_fixture(
            "from pathlib import Path; Path('effect').write_text('must not run')")
        self.set_mode(stopped=True)
        with self.assertRaises(RuntimeError):
            adapter.run_checks(self.cfg, row, spec, directory)
        self.assertFalse((self.repo / "effect").exists())

    def test_check_mutating_source_cannot_produce_valid_receipt(self):
        row, spec, directory = self.check_fixture(
            "from pathlib import Path; Path('source.py').write_text('VALUE = 2\\n')")
        with self.assertRaises(RuntimeError):
            adapter.run_checks(self.cfg, row, spec, directory)

    def test_absent_check_catalog_cannot_accept(self):
        row, spec, directory = self.check_fixture()
        self.cfg["check_catalog"] = {}
        with self.assertRaises(RuntimeError):
            adapter.run_checks(self.cfg, row, spec, directory)

    def test_unsupported_environment_does_not_execute(self):
        row, spec, directory = self.check_fixture(
            "from pathlib import Path; Path('effect').write_text('must not run')")
        self.cfg["check_catalog"]["unit"]["environment"]["capability"] = "unprepared-node"
        with self.assertRaises(RuntimeError):
            adapter.run_checks(self.cfg, row, spec, directory)
        self.assertFalse((self.repo / "effect").exists())

    def test_stale_review_generation_rejected_before_proof(self):
        task = self.task(proof_generation=2)
        author = self.add(spec={"task": task})
        review = {"author_job": author["id"], "generation": 1}
        with mock.patch.object(runtime.work_queue, "load_board", return_value={"tasks": [task]}):
            with self.assertRaisesRegex(RuntimeError, "GENERATION_CHANGED"):
                runtime.complete_task(self.cfg, self.conn, {"role": "B"}, review, {})

    def test_higher_boundary_cannot_receive_source_receipt(self):
        task = self.task(boundary="LIVE")
        author = self.add(spec={"task": task})
        with mock.patch.object(runtime.work_queue, "load_board", return_value={"tasks": [task]}):
            with self.assertRaisesRegex(RuntimeError, "CANNOT_PROVE_HIGHER_BOUNDARY"):
                runtime.complete_task(self.cfg, self.conn, {"role": "B"},
                                      {"author_job": author["id"]}, {})


if __name__ == "__main__":
    unittest.main()
