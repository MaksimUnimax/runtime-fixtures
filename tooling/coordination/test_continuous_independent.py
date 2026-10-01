"""Independent adversarial tests; temporary SQLite/flock fixtures, no Codex/live."""
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import continuous_state as state
import continuous_adapter as adapter
import continuous_runtime as runtime
import continuous_lifecycle as lifecycle


class RuntimeIndependent(unittest.TestCase):
    def setUp(self):
        parent = Path(__file__).resolve().parents[2] / ".test-tmp"
        parent.mkdir(exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix="independent-", dir=parent)
        self.addCleanup(self.tmp.cleanup)
        self.area = Path(self.tmp.name)
        self.control = self.area / "control"
        self.repo = self.control / "worktrees/A/fixture"
        self.repo.mkdir(parents=True)
        environment_root = mock.patch.object(adapter.continuous_environment, "CONTROL", self.control)
        environment_root.start()
        self.addCleanup(environment_root.stop)
        self.cfg = {"control_root": str(self.control), "repo": str(self.repo),
                    "epoch": "independent", "enabled_roles": ["A", "B", "C"],
                    "requirements": str(self.area / "requirements.json")}
        self.cfg["check_catalog"] = {"unit": {"argv": [sys.executable, "-c", "pass"],
                                              "environment": {"capability": "python-stdlib"}}}
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
        for path in state.RULES:
            target = self.repo / path
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text("fixture rule\n")
        (self.repo / "docs/product").mkdir(parents=True, exist_ok=True)
        spec_text = "| SA-WORK-01 | Approved independent fixture criterion |\n"
        (self.repo / "docs/product/SPEC.md").write_text(spec_text)
        (self.repo / "docs/development/coordination/PLAN.md").write_text("| A01 | fixture |\n")
        self.req.update(source="docs/product/SPEC.md", quote=spec_text.strip(),
                        plan_quote="| A01 | fixture |",
                        source_sha256=state.digest(spec_text))
        state.atomic_json(self.cfg["requirements"], {"requirements": [self.req]})
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
        (self.repo / "apps/a").mkdir(parents=True)
        (self.repo / "apps/a/source.py").write_text("VALUE = 1\n")
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
        with self.assertRaisesRegex(RuntimeError, "TRUSTED_CHECK_CHECK_LIMIT"):
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
            "from pathlib import Path; Path('apps/a/source.py').write_text('VALUE = 2\\n')")
        with self.assertRaisesRegex(RuntimeError, "CHECK_MUTATED_SOURCE"):
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

    def test_recovery_does_not_steal_live_entry(self):
        self.add(current="RUNNING", token=1)
        self.conn.execute("UPDATE jobs SET entry_pid=?,entry_birth=? WHERE id='job-A'",
                          (os.getpid(), state.birth(os.getpid())))
        self.conn.commit()
        runtime.recover(self.cfg, self.conn)
        self.assertEqual("RUNNING", self.current()["state"])

    def test_recovery_respects_physical_profile_lock(self):
        self.add(current="RUNNING", token=1)
        with state.lock(self.control / "codex-A.lock"):
            runtime.recover(self.cfg, self.conn)
        self.assertEqual("RUNNING", self.current()["state"])

    def test_recovery_respects_physical_job_lock(self):
        self.add(current="RUNNING", token=1)
        with state.lock(state.root(self.cfg) / "locks" / "job-A.lock"):
            runtime.recover(self.cfg, self.conn)
        self.assertEqual("RUNNING", self.current()["state"])

    def test_ambiguous_writer_not_replayed_and_block_is_local(self):
        self.add(current="RUNNING", token=1)
        self.add("job-B", role="B")
        state.event(self.conn, "codex_launch_intent", "job-A", token=1)
        with mock.patch.object(runtime, "freeze_candidate",
                               side_effect=RuntimeError("preserved unknown")) as freeze:
            with mock.patch.object(runtime.subprocess, "Popen") as launch:
                runtime.recover(self.cfg, self.conn)
                runtime.recover(self.cfg, self.conn)
                launch.assert_not_called()
                self.assertEqual(1, freeze.call_count)
        self.assertEqual("UNKNOWN", self.current()["state"])
        self.assertEqual("READY", self.current("job-B")["state"])
        self.assertEqual(1, self.conn.execute(
            "SELECT COUNT(*) FROM jobs WHERE kind='reconcile_review'").fetchone()[0])

    def review_receipt_fixture(self, role="B", author="A", adapter_changes=None):
        result = self.result()
        spec = self.review_spec()
        self.add("author-A", role=author, spec={"task": self.task()}, current="REVIEW_PENDING")
        spec.update(author=author, epoch=self.cfg["epoch"], author_job="author-A",
                    worktree=str(self.repo), generation=0,
                    task_contract_sha256=runtime.work_queue._contract(self.task()))
        row = self.add("review-A", role=role, kind="review", spec=spec,
                       current="RESULT", token=1)
        self.conn.execute("UPDATE jobs SET result=? WHERE id='review-A'", (state.encode(result),))
        self.conn.commit()
        self.conn.execute("UPDATE jobs SET entry_pid=?,entry_birth=? WHERE id='review-A'",
                          (os.getpid(), state.birth(os.getpid())))
        self.conn.commit()
        receipt = {"job": "review-A", "role": role, "model": state.MODEL,
                   "kind": "review", "worktree": str(self.repo),
                   "entry_pid": os.getpid(), "entry_birth": state.birth(os.getpid()),
                   "token": 1, "adapter_status": "RESULT_VALIDATED",
                   "result_sha256": state.digest(state.encode(result))}
        receipt.update(adapter_changes or {})
        state.atomic_json(state.root(self.cfg) / "jobs/review-A/adapter-receipt.json", receipt)
        return {"candidate": {"sha": result["candidate_sha"], "tree": result["candidate_tree"],
                              "diff_sha256": result["diff_sha256"]}}

    def test_self_peer_receipt_cannot_accept(self):
        payload = self.review_receipt_fixture(role="A", author="A")
        with self.assertRaises(RuntimeError):
            runtime.accepted_verifier(self.cfg, self.conn, "review-A")(self.task(), payload, "fixture")

    def test_review_adapter_wrong_token_rejected(self):
        payload = self.review_receipt_fixture(adapter_changes={"token": 0})
        with self.assertRaises(RuntimeError):
            runtime.accepted_verifier(self.cfg, self.conn, "review-A")(self.task(), payload, "fixture")

    def test_review_adapter_wrong_job_rejected(self):
        payload = self.review_receipt_fixture(adapter_changes={"job": "different-job"})
        with self.assertRaises(RuntimeError):
            runtime.accepted_verifier(self.cfg, self.conn, "review-A")(self.task(), payload, "fixture")

    def test_review_adapter_changed_result_rejected(self):
        payload = self.review_receipt_fixture(adapter_changes={"result_sha256": "0"*64})
        with self.assertRaises(RuntimeError):
            runtime.accepted_verifier(self.cfg, self.conn, "review-A")(self.task(), payload, "fixture")

    def test_exact_independent_peer_receipt_accepts(self):
        payload = self.review_receipt_fixture()
        result = runtime.accepted_verifier(self.cfg, self.conn, "review-A")(self.task(), payload, "fixture")
        self.assertEqual("B", result["reviewer"])

    def test_old_worker_result_cannot_corrupt_new_attempt(self):
        self.cfg["config_path"] = str(self.area / "config.json")
        self.add(spec={"worktree": str(self.repo)}, current="STARTING", token=1)
        def another_attempt(*args, **kwargs):
            self.conn.execute("UPDATE jobs SET state='STARTING',token=2 WHERE id='job-A'")
            self.conn.commit()
            return 0
        with mock.patch.object(runtime.resource_runner, "run", side_effect=another_attempt):
            runtime.worker(self.cfg, "job-A", 1)
        self.assertEqual(("STARTING", 2), (self.current()["state"], self.current()["token"]))

    def test_old_worker_exception_cannot_corrupt_new_attempt(self):
        self.cfg["config_path"] = str(self.area / "config.json")
        self.add(spec={"worktree": str(self.repo)}, current="STARTING", token=1)
        def another_attempt(*args, **kwargs):
            self.conn.execute("UPDATE jobs SET state='STARTING',token=2 WHERE id='job-A'")
            self.conn.commit()
            raise RuntimeError("old runner failed")
        with mock.patch.object(runtime.resource_runner, "run", side_effect=another_attempt):
            runtime.worker(self.cfg, "job-A", 1)
        self.assertEqual(("STARTING", 2), (self.current()["state"], self.current()["token"]))

    def test_launch_cannot_restart_while_previous_job_lease_held(self):
        self.cfg["config_path"] = str(self.area / "config.json")
        self.add()
        with state.lock(state.root(self.cfg) / "locks" / "job-A.lock"):
            with mock.patch.object(runtime, "prepare"):
                with mock.patch.object(runtime.subprocess, "Popen") as spawn:
                    runtime.launch(self.cfg, self.conn)
                    spawn.assert_not_called()
        self.assertEqual("READY", self.current()["state"])

    def scheduler_fixture(self):
        import time
        self.cfg["config_path"] = str(self.area / "config.json")
        now = time.time()
        self.add("normal", spec={"task": {"priority": "normal"}})
        self.conn.execute("UPDATE jobs SET created=? WHERE id='normal'", (now-10,))
        for i in range(4):
            name = "urgent-" + str(i)
            self.add(name, spec={"task": {"priority": "urgent"}})
            self.conn.execute("UPDATE jobs SET created=? WHERE id=?", (now+i, name))
        self.conn.commit()

    def one_dispatch(self):
        with mock.patch.object(runtime, "prepare"):
            with mock.patch.object(runtime.subprocess, "Popen"):
                runtime.launch(self.cfg, self.conn)
        rows = self.conn.execute("SELECT id FROM jobs WHERE state='STARTING'").fetchall()
        self.assertEqual(1, len(rows))
        identifier = rows[0]["id"]
        self.conn.execute("UPDATE jobs SET state='DONE' WHERE id=?", (identifier,))
        self.conn.commit()
        return identifier

    def test_urgent_dispatch_bounded_by_main_progress(self):
        self.scheduler_fixture()
        first = self.one_dispatch()
        second = self.one_dispatch()
        third = self.one_dispatch()
        self.assertTrue(first.startswith("urgent-"))
        self.assertTrue(second.startswith("urgent-"))
        self.assertEqual("normal", third)

    def test_oldest_aged_job_overrides_urgent_backlog(self):
        import time
        self.scheduler_fixture()
        self.conn.execute("UPDATE jobs SET created=? WHERE id='normal'", (time.time()-601,))
        self.conn.commit()
        self.assertEqual("normal", self.one_dispatch())

    def test_check_mutating_executable_bit_cannot_produce_valid_receipt(self):
        row, spec, directory = self.check_fixture(
            "from pathlib import Path; Path('apps/a/source.py').chmod(0o755)")
        with self.assertRaisesRegex(RuntimeError, "CHECK_MUTATED_SOURCE"):
            adapter.run_checks(self.cfg, row, spec, directory)

    def test_unrelated_spec_text_does_not_block_unchanged_clause(self):
        source = self.repo / "docs/product/SPEC.md"
        source.write_text(source.read_text() + "Unrelated appendix added\n")
        state.validate_task(self.cfg, self.task())

    def test_changed_clause_blocks_its_task_not_other_owner(self):
        source = self.repo / "docs/product/SPEC.md"
        original = source.read_text() + "| SA-B-01 | Independent B criterion |\n"
        source.write_text(original)
        self.req["source_sha256"] = state.digest(original)
        second = dict(self.req, id="req-B", role="B", plan="B01", quote="| SA-B-01 | Independent B criterion |",
                      plan_quote="| B01 | fixture |")
        state.atomic_json(self.cfg["requirements"], {"requirements": [self.req, second]})
        plan = self.repo / "docs/development/coordination/PLAN.md"
        plan.write_text(plan.read_text() + "| B01 | fixture |\n")
        source.write_text(original.replace("fixture criterion", "changed A criterion"))
        with self.assertRaises(RuntimeError):
            state.validate_task(self.cfg, self.task())
        task_b = self.task(id="task-B", requirement_id="req-B", role="B", plan="B01",
                           paths=["apps/b/source.py"])
        state.validate_task(self.cfg, task_b)

    def capacity_fixture(self):
        import contextlib
        row = self.add(spec={"worktree": str(self.repo)}, current="BLOCKED", token=2)
        self.conn.execute("UPDATE jobs SET reason='RESOURCE_ADMISSION_WAIT' WHERE id='job-A'")
        self.conn.commit()
        stack = contextlib.ExitStack()
        self.addCleanup(stack.close)
        mocks = {}
        for name, result in (("active_jobs", []), ("snapshot", {"fixture": True}),
                             ("effective_budget", {"fixture": True}), ("admission", None)):
            mocks[name] = stack.enter_context(mock.patch.object(
                lifecycle.resource_runner, name, return_value=result))
        return mocks

    def test_capacity_never_replays_any_prior_codex_intent(self):
        self.capacity_fixture()
        state.event(self.conn, "codex_launch_intent", "job-A", token=1)
        lifecycle.readmit_capacity(self.cfg, self.conn)
        self.assertEqual("BLOCKED", self.current()["state"])

    def test_capacity_rechecks_locks_admission_and_is_idempotent(self):
        mocks = self.capacity_fixture()
        for path in (self.control / "codex-A.lock", state.root(self.cfg) / "locks/job-A.lock"):
            with state.lock(path):
                lifecycle.readmit_capacity(self.cfg, self.conn)
            self.assertEqual("BLOCKED", self.current()["state"])
        mocks["active_jobs"].return_value = [{"role": "A", "fixture_live_group": True}]
        mocks["admission"].return_value = ["capacity occupied"]
        lifecycle.readmit_capacity(self.cfg, self.conn)
        self.assertEqual("BLOCKED", self.current()["state"])
        self.assertEqual(mocks["active_jobs"].return_value,
                         mocks["admission"].call_args.args[1])
        mocks["active_jobs"].return_value = []
        mocks["admission"].return_value = None
        lifecycle.readmit_capacity(self.cfg, self.conn)
        lifecycle.readmit_capacity(self.cfg, self.conn)
        self.assertEqual("READY", self.current()["state"])
        self.assertEqual(1, self.conn.execute(
            "SELECT COUNT(*) FROM events WHERE event='capacity_readmitted'").fetchone()[0])

    def integrated_fixture(self, archived=False):
        import subprocess
        _, authored, directory = self.check_fixture()
        base = state.git(self.repo, "rev-parse", "HEAD")
        copy = self.control / "worktrees/A/runtime-job-A"
        subprocess.run(["git", "-C", str(self.repo), "worktree", "add", "--detach",
                        str(copy), base], check=True, capture_output=True)
        authored["worktree"] = str(copy)
        self.conn.execute("UPDATE jobs SET state='INTEGRATED',spec=? WHERE id='job-A'",
                          (state.encode(authored),))
        candidate = {"sha": base, "tree": state.git(copy, "rev-parse", "HEAD^{tree}"),
                     "diff_sha256": state.digest("")}
        receipt = directory / "completion-receipt.json"
        state.atomic_json(receipt, {"fixture": "canonical queue is mocked, not this receipt's authority"})
        spec = {"author_job": "job-A", "task_id": "task-A",
                "candidate": candidate, "receipt": str(receipt)}
        self.add("integration-A", role="C", kind="integrate", spec=spec, current="DONE")
        self.conn.execute("UPDATE jobs SET result=? WHERE id='integration-A'",
                          (state.encode({"head": base, "remote_readback": base}),))
        reference = {"task_id": "task-A", "candidate": candidate,
                     "event_id": "stable-archive-event-A"}
        if archived:
            self.conn.execute("INSERT INTO meta VALUES(?,?)",
                              ("archive:integration-A", state.encode(reference)))
        self.conn.commit()
        task = self.task(candidate=candidate, completion_receipt=str(receipt))
        return copy, task, reference

    def add_scope_claim(self):
        import time
        self.conn.execute("INSERT INTO claims VALUES(?,?,?,?,?,?,'ACTIVE',?)",
                          ("claim-A", "A", "fixture", "base", state.encode(self.task()["paths"]),
                           state.digest("fixture-token"), time.time()))
        self.conn.commit()

    def test_cleanup_preserves_active_related_job(self):
        copy, _, _ = self.integrated_fixture(archived=True)
        self.add("late-review", role="B", kind="review",
                 spec={"author_job": "job-A"}, current="READY")
        lifecycle.cleanup_final_worktrees(self.cfg, self.conn)
        self.assertTrue(copy.is_dir(), "Clean source was removed while a related job was active")

    def test_cleanup_preserves_active_scope_claim(self):
        copy, _, _ = self.integrated_fixture(archived=True)
        self.add_scope_claim()
        lifecycle.cleanup_final_worktrees(self.cfg, self.conn)
        self.assertTrue(copy.is_dir(), "Clean source was removed despite an active claim")

    def test_cleanup_respects_current_stop(self):
        copy, _, _ = self.integrated_fixture(archived=True)
        state.atomic_json(self.control / "A.json", {"status": "STOPPED"})
        lifecycle.cleanup_final_worktrees(self.cfg, self.conn)
        self.assertTrue(copy.is_dir(), "STOP did not protect the retained worktree")

    def test_cleanup_only_final_clean_copy_once(self):
        copy, _, _ = self.integrated_fixture(archived=True)
        lifecycle.cleanup_final_worktrees(self.cfg, self.conn)
        lifecycle.cleanup_final_worktrees(self.cfg, self.conn)
        self.assertFalse(copy.exists())
        self.assertEqual(1, self.conn.execute(
            "SELECT COUNT(*) FROM events WHERE event='final_worktree_cleaned' AND job='job-A'"
        ).fetchone()[0])
        self.assertTrue(self.repo.is_dir())

    def canonical_archive_stub(self, task):
        def archive(control, role, ids, *, archive_verifier, limit):
            claim = archive_verifier(task, state.digest(Path(task["completion_receipt"]).read_bytes()))
            self.assertEqual("FINAL", claim["state"])
            self.assertEqual("INTEGRATED", claim["integration"])
            self.assertEqual([], claim["active_leases"])
            return {"fixture": "canonical queue boundary already verified"}
        return archive

    def test_archive_requires_final_readback_and_no_pending_jobs(self):
        _, task, reference = self.integrated_fixture()
        with mock.patch.object(lifecycle.work_queue, "archive_done",
                               side_effect=self.canonical_archive_stub(task)) as archive:
            with mock.patch.object(lifecycle.work_queue, "archived_task", return_value=reference):
                lifecycle.archive_integrated(self.cfg, self.conn, busy_roles=("A",))
                archive.assert_not_called()
                self.conn.execute("UPDATE jobs SET result=? WHERE id='integration-A'",
                                  (state.encode({"head": "x", "remote_readback": "y"}),))
                self.conn.commit()
                lifecycle.archive_integrated(self.cfg, self.conn)
                archive.assert_not_called()
                self.conn.execute("UPDATE jobs SET result=? WHERE id='integration-A'",
                                  (state.encode({"head": "x", "remote_readback": "x"}),))
                self.add("late-review", role="B", kind="review",
                         spec={"author_job": "job-A"}, current="READY")
                lifecycle.archive_integrated(self.cfg, self.conn)
                archive.assert_not_called()

    def test_archive_active_claim_prevents_consumption(self):
        _, task, reference = self.integrated_fixture()
        self.add_scope_claim()
        with mock.patch.object(lifecycle.work_queue, "archive_done",
                               side_effect=self.canonical_archive_stub(task)):
            with mock.patch.object(lifecycle.work_queue, "archived_task", return_value=reference):
                lifecycle.archive_integrated(self.cfg, self.conn)
        self.assertIsNone(self.conn.execute(
            "SELECT 1 FROM meta WHERE key='archive:integration-A'").fetchone())
        self.assertEqual(0, self.conn.execute(
            "SELECT COUNT(*) FROM events WHERE event='queue_archive_consumed'").fetchone()[0])

    def test_archive_recovery_consumes_stable_event_once(self):
        _, task, reference = self.integrated_fixture()
        with mock.patch.object(lifecycle.work_queue, "archive_done",
                               side_effect=self.canonical_archive_stub(task)) as archive:
            with mock.patch.object(lifecycle.work_queue, "archived_task",
                                   side_effect=[RuntimeError("crash after canonical replacement"),
                                                reference, reference]):
                lifecycle.archive_integrated(self.cfg, self.conn)
                self.assertIsNone(self.conn.execute(
                    "SELECT 1 FROM meta WHERE key='archive:integration-A'").fetchone())
                lifecycle.archive_integrated(self.cfg, self.conn)
                lifecycle.archive_integrated(self.cfg, self.conn)
        self.assertEqual(2, archive.call_count)
        self.assertEqual(1, self.conn.execute(
            "SELECT COUNT(*) FROM events WHERE event='queue_archive_consumed'").fetchone()[0])
        saved = [json.loads(row[0]) for row in self.conn.execute(
            "SELECT value FROM meta WHERE key LIKE 'coverage:%'")]
        self.assertTrue(any(reference == x for x in saved))

    def test_finalize_recovers_crash_after_durable_queue_done(self):
        import sqlite3
        class InjectedCrash(BaseException):
            pass
        row, authored, directory = self.check_fixture()
        base = state.git(self.repo, "rev-parse", "HEAD")
        identity = adapter.candidate_identity(self.repo, base)
        candidate = {"sha": identity["candidate_sha"], "tree": identity["candidate_tree"],
                     "diff_sha256": identity["diff_sha256"]}
        task = self.task(requires=[], result="fixture source outcome", candidate=candidate,
                         author="A", proof_generation=0)
        task["proof_validity"] = {"kind": "SNAPSHOT",
                                  "input_hashes": adapter.source_inputs(self.cfg, task)}
        authored.update(base=base, scope_base=base, task=task)
        adapter.run_checks(self.cfg, row, authored, directory)
        self.conn.execute("UPDATE jobs SET state='REVIEW_PENDING',spec=?,result=? WHERE id='job-A'",
                          (state.encode(authored), state.encode(self.result(verdict="PASS", **identity))))
        self.conn.commit()
        review_spec = {"author_job": "job-A", "author": "A", "identity": identity,
                       "worktree": str(self.repo), "epoch": self.cfg["epoch"], "generation": 0,
                       "task_contract_sha256": runtime.work_queue._contract(task)}
        self.add("review-A", role="B", kind="review", spec=review_spec,
                 current="RESULT", token=1)
        verdict = self.result(**identity)
        self.conn.execute("UPDATE jobs SET result=?,entry_pid=?,entry_birth=? WHERE id='review-A'",
                          (state.encode(verdict), os.getpid(), state.birth(os.getpid())))
        self.conn.commit()
        state.atomic_json(state.root(self.cfg) / "jobs/review-A/adapter-receipt.json",
                          {"job": "review-A", "kind": "review", "role": "B", "model": state.MODEL,
                           "token": 1, "adapter_status": "RESULT_VALIDATED",
                           "result_sha256": state.digest(state.encode(verdict)),
                           "worktree": str(self.repo), "entry_pid": os.getpid(),
                           "entry_birth": state.birth(os.getpid())})
        board_file = self.control / "fixture-board.json"
        state.atomic_json(board_file, {"tasks": [dict(task, state="ACTIVE")]})
        calls = {"advance": 0}
        def board(_control):
            return state.read_json(board_file)
        def register(_control, task_id, receipt, *, review_verifier):
            value = state.read_json(receipt)
            current = board(None)["tasks"][0]
            receipt_hash = state.digest(Path(receipt).read_bytes())
            if current["state"] == "DONE":
                self.assertEqual(current["completion_receipt_sha256"], receipt_hash,
                                 "Restart rewrote the already accepted exact receipt")
            review_verifier(current, value, receipt_hash)
        def advance(_control, role, task_id, next_state, *, receipt):
            value = board(None)
            current = value["tasks"][0]
            if current["state"] == "DONE":
                raise RuntimeError("DONE_TO_DONE_IS_NOT_A_VALID_TRANSITION")
            calls["advance"] += 1
            current.update(state="DONE", completion_receipt=receipt,
                           completion_receipt_sha256=state.digest(Path(receipt).read_bytes()))
            state.atomic_json(board_file, value)
            raise InjectedCrash("Queue replacement durable, runtime handoff not yet written")
        with mock.patch.object(runtime.work_queue, "load_board", side_effect=board), mock.patch.object(
                runtime.work_queue, "validate_board", side_effect=lambda *a, **k: {"board": board(None)}):
            with mock.patch.object(runtime.work_queue, "register_acceptance", side_effect=register):
                with mock.patch.object(runtime.work_queue, "advance_task", side_effect=advance):
                    with self.assertRaises(InjectedCrash):
                        runtime.finalize(self.cfg, self.conn)
                    self.assertEqual("DONE", board(None)["tasks"][0]["state"])
                    self.conn.execute("""CREATE TRIGGER fail_handoff_insert BEFORE INSERT ON jobs
                      WHEN NEW.kind='integrate'
                      BEGIN SELECT RAISE(ABORT, 'independent handoff insertion failure'); END""")
                    with self.assertRaises(sqlite3.DatabaseError):
                        runtime.finalize(self.cfg, self.conn)
                    self.assertEqual("REVIEW_PENDING", self.current()["state"])
                    self.assertEqual(0, self.conn.execute(
                        "SELECT COUNT(*) FROM jobs WHERE kind='integrate'").fetchone()[0])
                    self.conn.execute("DROP TRIGGER fail_handoff_insert")
                    runtime.finalize(self.cfg, self.conn)
                    runtime.finalize(self.cfg, self.conn)
        self.assertEqual(1, calls["advance"])
        self.assertEqual("ACCEPTED", self.current()["state"])
        self.assertEqual("DONE", self.current("review-A")["state"])
        self.assertEqual(1, self.conn.execute(
            "SELECT COUNT(*) FROM jobs WHERE kind='integrate'").fetchone()[0])

    def test_archived_coverage_retains_two_leaves_of_same_requirement(self):
        self.cfg["config_path"] = str(self.area / "fixture-config.json")
        _, first_task, first_ref = self.integrated_fixture()
        first_ref["id"] = first_task["id"]
        authored = json.loads(self.current()["spec"])
        second_task = dict(first_task, id="task-B")
        second_receipt = state.root(self.cfg) / "jobs/job-B/completion-receipt.json"
        state.atomic_json(second_receipt, {"fixture": "second canonical proof"})
        second_task["completion_receipt"] = str(second_receipt)
        authored["task"] = second_task
        self.add("job-B", role="A", spec=authored, current="INTEGRATED")
        second_spec = {"author_job": "job-B", "task_id": "task-B",
                       "candidate": second_task["candidate"], "receipt": str(second_receipt)}
        self.add("integration-B", role="C", kind="integrate", spec=second_spec, current="DONE")
        self.conn.execute("UPDATE jobs SET result=? WHERE id='integration-B'",
                          (state.encode({"head": "verified-main", "remote_readback": "verified-main"}),))
        self.conn.commit()
        second_ref = dict(first_ref, id="task-B", task_id="task-B",
                          event_id="stable-archive-event-B")
        refs = {"task-A": first_ref, "task-B": second_ref}
        tasks = {"task-A": first_task, "task-B": second_task}
        def archive(control, role, identifiers, *, archive_verifier, limit):
            task = tasks[identifiers[0]]
            archive_verifier(task, state.digest(Path(task["completion_receipt"]).read_bytes()))
            return {}
        with mock.patch.object(lifecycle.work_queue, "archive_done", side_effect=archive):
            with mock.patch.object(lifecycle.work_queue, "archived_task",
                                   side_effect=lambda _control, identifier: refs[identifier]):
                lifecycle.archive_integrated(self.cfg, self.conn)
                lifecycle.archive_integrated(self.cfg, self.conn)
        first = lifecycle.coverage_page(self.cfg, self.conn, requirement="req-A", offset=0, limit=1)
        second = lifecycle.coverage_page(self.cfg, self.conn, requirement="req-A", offset=1, limit=1)
        self.assertEqual(2, first["count"])
        self.assertEqual(2, second["count"])
        self.assertEqual({"task-A", "task-B"},
                         {first["entries"][0]["id"], second["entries"][0]["id"]})
        self.assertIs(first["lookup"]["read_only"], True)
        self.assertIs(first["project_ready"], False)

    def test_integration_terminal_pair_rolls_back_if_author_write_fails(self):
        import sqlite3
        import continuous_integration
        self.integrated_fixture()
        self.conn.execute("UPDATE jobs SET state='ACCEPTED' WHERE id='job-A'")
        self.conn.execute("UPDATE jobs SET state='MAIN_PENDING' WHERE id='integration-A'")
        self.conn.commit()
        row = self.current("integration-A")
        spec = json.loads(row["spec"])
        saved = {"head": "verified-main"}
        self.conn.execute("""CREATE TRIGGER fail_author_terminal BEFORE UPDATE ON jobs
          WHEN NEW.id='job-A' AND NEW.state='INTEGRATED'
          BEGIN SELECT RAISE(ABORT, 'independent injected terminal failure'); END""")
        with self.assertRaises(sqlite3.DatabaseError):
            continuous_integration.complete_integration(
                self.conn, row, spec, saved, "verified-main")
        self.assertFalse(self.conn.in_transaction)
        self.assertEqual("MAIN_PENDING", self.current("integration-A")["state"])
        self.assertEqual("ACCEPTED", self.current()["state"])
        self.conn.execute("DROP TRIGGER fail_author_terminal")
        with self.assertRaises(RuntimeError):
            continuous_integration.complete_integration(self.conn, row, spec, saved, "wrong-main")
        self.assertEqual("MAIN_PENDING", self.current("integration-A")["state"])
        continuous_integration.complete_integration(self.conn, row, spec, saved, "verified-main")
        self.assertEqual("DONE", self.current("integration-A")["state"])
        self.assertEqual("INTEGRATED", self.current()["state"])

    def test_stop_during_environment_preparation_prevents_check_spawn(self):
        row, spec, directory = self.check_fixture(
            "from pathlib import Path; Path('effect').write_text('must not execute')")
        prepare = adapter.continuous_environment.ensure_environment
        spawn = adapter.subprocess.Popen
        def prepare_then_stop(*args, **kwargs):
            result = prepare(*args, **kwargs)
            self.set_mode(stopped=True)
            return result
        with mock.patch.object(adapter.continuous_environment, "ensure_environment",
                               side_effect=prepare_then_stop):
            with mock.patch.object(adapter.subprocess, "Popen", wraps=spawn) as launched:
                with self.assertRaises(RuntimeError):
                    adapter.run_checks(self.cfg, row, spec, directory)
                self.assertEqual(0, launched.call_count, "Trusted check spawned after STOP")
        self.assertFalse((self.repo / "effect").exists())

    def test_plan_feedback_reworks_same_readonly_role_and_stops_after_three(self):
        for verdict_name in ("REWORK", "BLOCKED"):
            original = {"requirements": [self.req], "input_digest": "fixed-input-" + verdict_name,
                        "worktree": str(self.repo), "base": "a"*40, "rules": state.rules_snapshot(self.cfg)}
            author_id = "planner-" + verdict_name
            self.add(author_id, role="A", kind="plan", spec=original, current="REVIEW_PENDING")
            for attempt in range(1, 5):
                review_id = "plan-review-" + verdict_name + "-" + str(attempt)
                feedback = self.result(verdict=verdict_name, summary="exact feedback " + str(attempt))
                self.add(review_id, role="B", kind="plan_review",
                         spec={"author_job": author_id}, current="RESULT")
                self.conn.execute("UPDATE jobs SET result=? WHERE id=?",
                                  (state.encode(feedback), review_id))
                self.conn.commit()
                before = self.conn.execute("SELECT COUNT(*) FROM jobs WHERE kind='plan'").fetchone()[0]
                runtime.finalize(self.cfg, self.conn)
                runtime.finalize(self.cfg, self.conn)
                after = self.conn.execute("SELECT COUNT(*) FROM jobs WHERE kind='plan'").fetchone()[0]
                self.assertEqual(before + (1 if attempt <= 3 else 0), after)
                self.assertEqual(verdict_name, self.current(review_id)["state"])
                replacements = self.conn.execute(
                    "SELECT * FROM jobs WHERE kind='plan' AND state='READY'").fetchall()
                if attempt <= 3:
                    self.assertEqual(1, len(replacements))
                    replacement = replacements[0]
                    payload = json.loads(replacement["spec"])
                    self.assertEqual("A", replacement["role"])
                    self.assertEqual("plan", replacement["kind"])
                    self.assertEqual(original["input_digest"], payload["input_digest"])
                    self.assertEqual(original["requirements"], payload["requirements"])
                    self.assertEqual(feedback, payload["feedback"])
                    self.assertEqual(attempt, payload["rework_attempt"])
                    author_id = replacement["id"]
                    self.conn.execute("UPDATE jobs SET state='REVIEW_PENDING' WHERE id=?", (author_id,))
                    self.conn.commit()
                else:
                    self.assertEqual([], replacements)
            self.assertEqual(0, self.conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE kind='implement'").fetchone()[0])

    def test_duplicate_planned_contract_is_consumed_or_replanned_without_mutation(self):
        existing = self.task()
        for label, changes in (("identical", {}), ("path", {"paths": ["apps/a/different.py"]}),
                               ("basis", {"basis": "different approved claim"})):
            author_id = "duplicate-plan-" + label
            review_id = "duplicate-review-" + label
            proposed = dict(existing, **changes)
            self.add(author_id, role="A", kind="plan",
                     spec={"input_digest": "unchanged-inputs", "worktree": str(self.repo)},
                     current="REVIEW_PENDING")
            self.add(review_id, role="B", kind="plan_review",
                     spec={"author_job": author_id, "payload": {"tasks": [proposed]}},
                     current="RESULT")
            self.conn.execute("UPDATE jobs SET result=? WHERE id=?",
                              (state.encode(self.result()), review_id))
            self.conn.commit()
            before = self.conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE kind='plan' AND state='READY'").fetchone()[0]
            original_bytes = state.encode(existing)
            with mock.patch.object(runtime.work_queue, "load_board", return_value={"tasks": [existing]}):
                with mock.patch.object(runtime.work_queue, "add_task") as add_task:
                    runtime.finalize(self.cfg, self.conn)
                    runtime.finalize(self.cfg, self.conn)
                    add_task.assert_not_called()
            self.assertEqual(original_bytes, state.encode(existing))
            self.assertEqual("BLOCKED" if changes else "DONE", self.current(review_id)["state"])
            after = self.conn.execute(
                "SELECT COUNT(*) FROM jobs WHERE kind='plan' AND state='READY'").fetchone()[0]
            self.assertEqual(before + (1 if changes else 0), after)
            if changes:
                self.assertIn("CONTRACT_CONFLICT", self.current(review_id)["reason"])

    def test_peer_rework_releases_old_scope_only_after_durable_successor(self):
        spec = {"task": self.task(), "base": "a"*40, "worktree": str(self.repo)}
        self.add(spec=spec, current="REVIEW_PENDING")
        review = self.add("peer-rework", role="B", kind="review",
                          spec={"author_job": "job-A"}, current="RESULT")
        review_spec = {"author_job": "job-A", "identity": {"candidate_sha": "b"*40}}
        verdict = self.result(verdict="REWORK")
        runtime.enqueue_rework(self.cfg, self.conn, review, review_spec, verdict)
        successor = self.conn.execute(
            "SELECT * FROM jobs WHERE kind='implement' AND state='READY'").fetchone()
        self.assertIsNotNone(successor)
        self.assertEqual("SUPERSEDED", self.current()["state"])
        self.assertIn("apps/a/source.py", runtime.paths_reserved(self.conn))
        self.conn.execute("UPDATE jobs SET state='INTEGRATED' WHERE id=?", (successor["id"],))
        self.conn.commit()
        self.assertNotIn("apps/a/source.py", runtime.paths_reserved(self.conn))
        self.add("other-author", spec=spec, current="REVIEW_PENDING")
        another = self.add("other-peer", role="B", kind="review",
                           spec={"author_job": "other-author"}, current="RESULT")
        with mock.patch.object(runtime, "add_job", side_effect=RuntimeError("injected descriptor failure")):
            with self.assertRaises(RuntimeError):
                runtime.enqueue_rework(self.cfg, self.conn, another,
                                       {"author_job": "other-author", "identity": {"candidate_sha": "c"*40}},
                                       verdict)
        self.assertNotEqual("SUPERSEDED", self.current("other-author")["state"])
        self.assertIn("apps/a/source.py", runtime.paths_reserved(self.conn))


if __name__ == "__main__":
    unittest.main()
