import argparse
import contextlib
import importlib.util
import json
import os
import shutil
import subprocess
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

import test_work_queue as work_queue_test_module
import test_task_publication as task_publication_test_module

spec = importlib.util.spec_from_file_location("control", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)

class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.args = argparse.Namespace(receipt="", task="", summary="", next="")
        self.ctx = patch.object(control, "CONTROL", self.root)
        self.ctx.start()
        self.git = patch.object(control, "git", return_value="a" * 40)
        self.git.start()

    def tearDown(self):
        self.git.stop()
        self.ctx.stop()
        self.tmp.cleanup()

    def test_automatic_start_cannot_clear_stop(self):
        control.update_state("A", "pause", self.args)
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            control.update_state("A", "start", self.args)
        self.assertEqual(json.loads((self.root / "A.json").read_text())["status"], "STOPPED")

    def test_waiting_cannot_clear_stop(self):
        control.update_state("A", "pause", self.args)
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            control.update_state("A", "waiting", self.args)
        self.assertEqual(json.loads((self.root / "A.json").read_text())["status"], "STOPPED")

    def test_test_container_requires_exact_loopback_port_and_database_identity(self):
        import copy
        cfg = {"port":15541,"database":"octoport_a_test","password":"disposable-test-value"}
        info = {"Config":{"Labels":{"octoport.coordination":"2p1"},"Env":["POSTGRES_USER=octoport_test","POSTGRES_DB=octoport_a_test","POSTGRES_PASSWORD=disposable-test-value"]},"HostConfig":{"PortBindings":{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"15541"}]}},"NetworkSettings":{"Ports":{"5432/tcp":[{"HostIp":"127.0.0.1","HostPort":"15541"}]}}}
        control.validate_test_container(info,cfg)
        for change in ["configured_port", "active_port", "database"]:
            bad = copy.deepcopy(info)
            if change == "configured_port": bad["HostConfig"]["PortBindings"]["5432/tcp"][0]["HostPort"] = "5432"
            elif change == "active_port": bad["NetworkSettings"]["Ports"]["5432/tcp"][0]["HostIp"] = "0.0.0.0"
            else: bad["Config"]["Env"][1] = "POSTGRES_DB=production"
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError,"TEST_DB_"):
                control.validate_test_container(bad,cfg)

    def test_due_review_does_not_stop_independent_work(self):
        state = control.update_state("A", "start", self.args)
        state["review_clock"] = time.time() - control.PERIOD - 1
        control.write_json(self.root / "A.json", state)
        state = control.update_state("A", "status", self.args)
        self.assertTrue(state["review_pending"])
        self.assertEqual(state["status"], "RUNNING")
        control.require_running("A")

    def test_null_review_reason_has_safe_display_fallback(self):
        self.assertEqual(
            control.display_review_reason({"review_reason": None}),
            "review pending",
        )
        self.assertEqual(
            control.display_review_reason({"review_reason": "specific review"}),
            "specific review",
        )

    def test_owner_request_survives_checkpoint(self):
        self.args.summary = "Access to a test mailbox"
        control.update_state("B", "request-owner", self.args)
        self.args.summary = "Independent safe task finished"
        state = control.update_state("B", "checkpoint", self.args)
        self.assertEqual(state["owner_requests"], ["Access to a test mailbox"])

    def test_review_requires_receipt(self):
        with self.assertRaisesRegex(RuntimeError, "receipt"):
            control.update_state("C", "reviewed", self.args)

    def test_cross_role_edit_is_rejected(self):
        rules = {"roles":{"A":{"allow":["apps/extension/**"],"deny":[]}}}
        with patch.object(control, "policy", return_value=rules), patch.object(control, "git", side_effect=["apps/api/src/main.ts", ""]):
            with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
                control.scope_guard("A")

    def test_extension_owner_can_change_its_actual_browser_regressions_and_builders(self):
        names = "tests/regression/extension-core/client-i1/browser_c1_acceptance.py\ntooling/build/extension_composed.py\ntooling/checks/extension_i1.py"
        with patch.object(control, "git", side_effect=[names, ""]), patch.object(control, "validate_task_scope") as scope:
            scope.return_value = None
            self.assertEqual(len(control.scope_guard("A")), 3)
        with patch.object(control, "git", side_effect=["tests/regression/imported/frozen-source.js", ""]):
            with self.assertRaisesRegex(RuntimeError, "OWNERSHIP_VIOLATION"):
                control.scope_guard("A")

    def test_default_scope_base_prefers_accepted_merge_head_and_falls_back_to_head(self):
        completed = control.subprocess.CompletedProcess(
            ["git"], 0, stdout="c" * 40 + "\n", stderr=""
        )
        with patch.object(control.subprocess, "run", side_effect=[completed, completed]):
            self.assertEqual(control.default_scope_base(), "c" * 40)
        missing = control.subprocess.CompletedProcess(
            ["git"], 1, stdout="", stderr=""
        )
        with patch.object(control.subprocess, "run", return_value=missing):
            self.assertEqual(control.default_scope_base(), "HEAD")

    def test_scope_guard_uses_merge_head_as_default_base(self):
        rules = {"roles":{"A":{"allow":["apps/extension/**"],"deny":[]}}}
        merge_head = "b" * 40
        with (
            patch.object(control, "policy", return_value=rules),
            patch.object(control, "default_scope_base", return_value=merge_head),
            patch.object(control, "git", side_effect=["apps/extension/runtime.js", ""]) as mocked_git,
        ):
            self.assertEqual(
                control.scope_guard("A"),
                ["apps/extension/runtime.js"],
            )
            self.assertEqual(
                mocked_git.call_args_list[0].args,
                ("diff", "--name-only", merge_head),
            )

    def test_explicit_scope_base_overrides_merge_detection(self):
        rules = {"roles":{"A":{"allow":["apps/extension/**"],"deny":[]}}}
        with (
            patch.object(control, "policy", return_value=rules),
            patch.object(control, "default_scope_base") as default_base,
            patch.object(control, "git", side_effect=["apps/extension/runtime.js", ""]) as mocked_git,
        ):
            self.assertEqual(
                control.scope_guard("A", "origin/main"),
                ["apps/extension/runtime.js"],
            )
            default_base.assert_not_called()
            self.assertEqual(
                mocked_git.call_args_list[0].args,
                ("diff", "--name-only", "origin/main"),
            )

    def test_done_requires_registered_disk_lifecycle_inventory_before_board_mutation(self):
        with patch.object(control, "advance_task") as advance:
            with self.assertRaisesRegex(RuntimeError, "ARTIFACT_INVENTORY_MISSING"):
                control.advance_queue_task("A", "TASK-DISK-GATE", "DONE", "receipt.json", "done")
            advance.assert_not_called()

    def test_done_accepts_closed_no_output_inventory_and_seals_future_allocations(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none("A", "TASK-DISK-GATE", "Read-only task created no temporary outputs")
        with patch.object(control, "advance_task", return_value={"state": "DONE"}) as advance:
            result = control.advance_queue_task("A", "TASK-DISK-GATE", "DONE", "receipt.json", "done")
        self.assertEqual(result, {"state": "DONE"})
        advance.assert_called_once_with(self.root, "A", "TASK-DISK-GATE", "DONE", "receipt.json", "done")
        self.assertEqual(registry.completion_record("A", "TASK-DISK-GATE")["state"], "SEALED")
        (self.root / "A.json").write_text(json.dumps({"status": "RUNNING"}))
        with self.assertRaisesRegex(ValueError, "TASK_DISK_LIFECYCLE_ALREADY_COMPLETED"):
            registry.begin(
                "A", "TASK-DISK-GATE", "Late output after task completion",
                [str(self.root / "worktrees" / "A" / "late-output")], 16, 1,
            )

    def test_done_allows_current_hold_then_reopen_unseals_future_allocations(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        (self.root / "A.json").write_text(json.dumps({"status": "RUNNING"}))
        item = registry.begin(
            "A", "TASK-DISK-HELD", "Temporary source retained for a named reviewer",
            [str(self.root / "worktrees" / "A" / "task-disk-held")], 16, 1,
        )
        registry.change(
            item["id"], "A", "hold",
            "Reviewer still consumes the exact temporary source",
            "Independent reviewer TASK-DISK-HELD", 1,
        )
        with patch.object(control, "advance_task", return_value={"state": "DONE"}):
            self.assertEqual(
                control.advance_queue_task("A", "TASK-DISK-HELD", "DONE", "receipt.json", "done"),
                {"state": "DONE"},
            )
        self.assertEqual(registry.completion_record("A", "TASK-DISK-HELD")["state"], "SEALED")
        with patch.object(control, "advance_task", return_value={"state": "IN_PROGRESS"}):
            self.assertEqual(
                control.advance_queue_task("A", "TASK-DISK-HELD", "IN_PROGRESS", "rework.json", "reopen"),
                {"state": "IN_PROGRESS"},
            )
        self.assertEqual(registry.completion_record("A", "TASK-DISK-HELD")["state"], "REOPENED")
        followup = registry.begin(
            "A", "TASK-DISK-HELD", "New temporary output after explicit task reopen",
            [str(self.root / "worktrees" / "A" / "task-disk-held-followup")], 16, 1,
        )
        self.assertEqual(followup["state"], "OPEN")

    def test_precommit_done_failure_reopens_only_after_non_done_board_readback(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none("A", "TASK-DISK-FAIL", "Read-only task created no temporary outputs")
        board = {"tasks": [{"id": "TASK-DISK-FAIL", "role": "A", "state": "IN_PROGRESS"}]}
        with (
            patch.object(control, "advance_task", side_effect=RuntimeError("strict receipt failed")),
            patch.object(control, "load_board", return_value=board),
        ):
            with self.assertRaisesRegex(RuntimeError, "strict receipt failed"):
                control.advance_queue_task("A", "TASK-DISK-FAIL", "DONE", "receipt.json", "done")
        failed = registry.completion_record("A", "TASK-DISK-FAIL")
        self.assertEqual(failed["state"], "REOPENED")
        self.assertEqual([row["state"] for row in failed["history"]], ["SEALING", "REOPENED"])

    def test_postcommit_done_failure_keeps_fail_closed_sealing_state(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none("A", "TASK-DISK-POST", "Read-only task created no temporary outputs")
        board = {"tasks": [{"id": "TASK-DISK-POST", "state": "DONE"}]}
        with (
            patch.object(control, "advance_task", side_effect=RuntimeError("event append failed")),
            patch.object(control, "load_board", return_value=board),
        ):
            with self.assertRaisesRegex(RuntimeError, "event append failed"):
                control.advance_queue_task("A", "TASK-DISK-POST", "DONE", "receipt.json", "done")
        failed = registry.completion_record("A", "TASK-DISK-POST")
        self.assertEqual(failed["state"], "SEALING")
        with self.assertRaisesRegex(ValueError, "TASK_DISK_LIFECYCLE_ALREADY_COMPLETED"):
            registry.declare_none("A", "TASK-DISK-POST", "Late read-only declaration after uncertain DONE")

    def test_failed_done_readback_for_other_role_keeps_sealing(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none("A", "TASK-DISK-ROLE", "Read-only task created no temporary outputs")
        board = {"tasks": [{"id": "TASK-DISK-ROLE", "role": "B", "state": "IN_PROGRESS"}]}
        with (
            patch.object(control, "advance_task", side_effect=RuntimeError("board writer failed")),
            patch.object(control, "load_board", return_value=board),
        ):
            with self.assertRaisesRegex(RuntimeError, "board writer failed"):
                control.advance_queue_task("A", "TASK-DISK-ROLE", "DONE", "receipt.json", "done")
        self.assertEqual(registry.completion_record("A", "TASK-DISK-ROLE")["state"], "SEALING")

    def test_queue_resolve_blocker_cli_delegates_exact_identity(self):
        with (
            patch.object(control, "require_location"),
            patch.object(control, "resolve_blocker", return_value={"resolution_status": "RESOLVED"}) as resolve,
            patch.object(control.sys, "argv", [
                "control.py", "B", "queue-resolve-blocker",
                "--task", "old-attempt", "--successor", "accepted-successor",
                "--receipt", "/root/octoport-control/logs/B/successor.json",
            ]),
        ):
            self.assertEqual(control.main(), 0)
        resolve.assert_called_once_with(
            self.root, "B", "old-attempt", "accepted-successor",
            "/root/octoport-control/logs/B/successor.json",
        )

    def test_done_passes_publication_registration_after_disk_gate(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none("C", "TASK-PUBLISHED", "Published isolated task has no remaining temp outputs")
        registration = "a" * 64
        with patch.object(control, "advance_task", return_value={"state": "DONE"}) as advance:
            result = control.advance_queue_task(
                "C", "TASK-PUBLISHED", "DONE", "receipt.json", "done", registration
            )
        self.assertEqual(result, {"state": "DONE"})
        advance.assert_called_once_with(
            self.root, "C", "TASK-PUBLISHED", "DONE", "receipt.json", "done",
            publication_registration=registration,
        )
        self.assertEqual(registry.completion_record("C", "TASK-PUBLISHED")["state"], "SEALED")

    def publication_role_fixture(self, name="fixed-C", branch="work/c-integration"):
        fixed = self.root / name
        fixed.mkdir()
        subprocess.run(
            ["git", "-C", str(fixed), "init", "-b", branch],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        # Deliberately write caller-owned policy too.  The publication location
        # guard must ignore it and trust control.policy() from the accepted
        # route source instead.
        caller_policy = fixed / "docs/development/coordination/OWNERSHIP.json"
        caller_policy.parent.mkdir(parents=True)
        caller_policy.write_text(json.dumps({
            "roles": {"C": {"path": str(fixed), "branch": branch}}
        }))
        return fixed

    def test_queue_task_cli_passes_publication_registration_through_accepted_source_and_canonical_cwd(self):
        registration = "b" * 64
        fixed = self.publication_role_fixture()
        authority = {"role_path": str(fixed), "role_branch": "work/c-integration"}
        with (
            contextlib.chdir(fixed),
            patch.object(
                control, "validate_queue_completion_source_authority",
                return_value=authority,
            ) as source_authority,
            patch.object(control, "advance_queue_task", return_value={"state": "DONE"}) as advance,
            patch.object(control.sys, "argv", [
                "control.py", "C", "queue-task",
                "--task", "published-task", "--task-state", "DONE",
                "--receipt", "/root/octoport-control/logs/C/completion.json",
                "--summary", "published",
                "--publication-registration", registration,
            ]),
        ):
            self.assertEqual(control.main(), 0)
        source_authority.assert_called_once_with(
            self.root, registration, control.ROOT, "C", "published-task"
        )
        advance.assert_called_once_with(
            "C", "published-task", "DONE",
            "/root/octoport-control/logs/C/completion.json",
            "published", registration,
        )

    def test_queue_task_cli_rejects_publication_registration_outside_canonical_cwd(self):
        registration = "b" * 64
        attacker = self.publication_role_fixture("attacker-C")
        authority = {
            "role_path": str(self.root / "trusted-C"),
            "role_branch": "work/c-integration",
        }
        with (
            contextlib.chdir(attacker),
            patch.object(
                control, "validate_queue_completion_source_authority",
                return_value=authority,
            ),
            patch.object(control, "advance_queue_task") as advance,
            patch.object(control.sys, "argv", [
                "control.py", "C", "queue-task",
                "--task", "published-task", "--task-state", "DONE",
                "--receipt", "/root/octoport-control/logs/C/completion.json",
                "--summary", "published",
                "--publication-registration", registration,
            ]),
        ):
            with self.assertRaisesRegex(RuntimeError, "ROLE_LOCATION_MISMATCH"):
                control.main()
        advance.assert_not_called()

    def test_arbitrary_committed_control_entrypoint_rejected_before_board_or_disk_mutation(self):
        queue_fixture = work_queue_test_module.WorkQueueTests(methodName="runTest")
        queue_fixture.setUp()
        try:
            registration, candidate = queue_fixture.publication(candidate_sha="c" * 40)
            queue_fixture.completion(candidate_sha=candidate)
            registry = control.DiskLifecycleRegistry(queue_fixture.root)
            registry.seed_baseline()
            registry.declare_none("B", "b-auth", "Disposable publication completion fixture")
            before_board = queue_fixture.path.read_bytes()
            before_completion = registry.completion_record("B", "b-auth")

            fixed = self.root / "canonical-B"
            subprocess.run(
                ["git", "-C", str(fixed.parent), "init", "-b", "work/b-backend", str(fixed)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            attacker = self.root / "attacker-source"
            subprocess.run(
                ["git", "init", "-b", "attacker-route", str(attacker)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            )
            subprocess.run(["git", "-C", str(attacker), "config", "user.name", "Fixture"], check=True)
            subprocess.run(["git", "-C", str(attacker), "config", "user.email", "fixture@example.invalid"], check=True)
            coordination = attacker / "tooling/coordination"
            coordination.mkdir(parents=True)
            for name in ("control.py", "task_publication.py"):
                shutil.copyfile(Path(__file__).with_name(name), coordination / name)
            policy = attacker / "docs/development/coordination/OWNERSHIP.json"
            policy.parent.mkdir(parents=True)
            policy.write_text(json.dumps({"roles": {"B": {
                "path": str(fixed), "branch": "work/b-backend",
                "allow": ["**"], "deny": [],
            }}}))
            (attacker / "attacker-marker.txt").write_text("not the publication candidate\n")
            subprocess.run(["git", "-C", str(attacker), "add", "."], check=True)
            subprocess.run(["git", "-C", str(attacker), "commit", "-m", "self-authored route source"],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            with (
                contextlib.chdir(fixed),
                patch.object(control, "ROOT", attacker),
                patch.object(control, "CONTROL", queue_fixture.root),
                patch.object(control.sys, "argv", [
                    "control.py", "B", "queue-task",
                    "--task", "b-auth", "--task-state", "DONE",
                    "--receipt", str(queue_fixture.receipt),
                    "--summary", "must not mutate",
                    "--publication-registration", registration,
                ]),
            ):
                with self.assertRaisesRegex(RuntimeError, "ROLE_LOCATION_MISMATCH"):
                    control.main()

            self.assertEqual(queue_fixture.path.read_bytes(), before_board)
            self.assertEqual(registry.completion_record("B", "b-auth"), before_completion)
        finally:
            queue_fixture.tearDown()

    def test_forged_git_environment_cannot_authorize_arbitrary_control_source(self):
        publication = task_publication_test_module.PublicationTests(methodName="runTest")
        publication.setUp()
        try:
            route = task_publication_test_module.route
            reg = publication.register()
            reg = route._push_operation(publication.control, reg["registration_id"], "TASK_REF")
            reg = route.mark_ready(publication.control, reg["registration_id"], publication.ci(reg))
            reg = route._push_operation(publication.control, reg["registration_id"], "MAIN")
            reg = route._push_operation(publication.control, reg["registration_id"], "CLEANUP_TASK_REF")
            reg = route.close_registration(publication.control, reg["registration_id"])
            receipt = publication.control / "logs/completion-forged-env.json"
            receipt.write_text(json.dumps({
                "kind": "octoport.work-queue-completion", "version": 1,
                "task_id": publication.task["id"], "candidate_sha": publication.head,
                "verdict": "PASS", "review": {"verdict": "PASS", "evidence": ["fixture"]},
                "checks": [{"name": "fixture", "verdict": "PASS", "evidence": ["fixture"]}],
            }))
            registry = control.DiskLifecycleRegistry(publication.control)
            registry.seed_baseline()
            registry.declare_none("C", publication.task["id"], "Forged Git environment regression fixture")
            board_path = publication.control / "controllers/work-board.json"
            before_board = board_path.read_bytes()
            before_completion = registry.completion_record("C", publication.task["id"])

            attacker = self.root / "forged-source-root"
            attacker.mkdir()
            tracked = subprocess.check_output(
                ["git", "-C", str(publication.work), "ls-files"], text=True
            ).splitlines()
            for name in tracked:
                source = publication.work / name
                target = attacker / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
            policy = attacker / "docs/development/coordination/OWNERSHIP.json"
            policy.write_text(json.dumps({"roles": {"C": {
                "path": str(attacker), "branch": "candidate", "allow": ["**"], "deny": [],
            }}}))
            git_dir = subprocess.check_output(
                ["git", "-C", str(publication.work), "rev-parse", "--absolute-git-dir"], text=True
            ).strip()
            index_path = Path(subprocess.check_output(
                ["git", "-C", str(publication.work), "rev-parse", "--git-path", "index"], text=True
            ).strip())
            if not index_path.is_absolute():
                index_path = (publication.work / index_path).resolve()
            forged_index = self.root / "forged-index"
            shutil.copyfile(index_path, forged_index)
            forged_env = {
                "GIT_DIR": git_dir,
                "GIT_WORK_TREE": str(attacker),
                "GIT_INDEX_FILE": str(forged_index),
                "GIT_CONFIG_COUNT": "1",
                "GIT_CONFIG_KEY_0": "core.worktree",
                "GIT_CONFIG_VALUE_0": str(attacker),
            }
            with patch.dict(os.environ, forged_env, clear=False):
                subprocess.run(
                    ["git", "update-index", "--skip-worktree", "docs/development/coordination/OWNERSHIP.json"],
                    cwd=attacker, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                with (
                    contextlib.chdir(attacker),
                    patch.object(control, "ROOT", attacker),
                    patch.object(control, "CONTROL", publication.control),
                    patch.object(control.sys, "argv", [
                        "control.py", "C", "queue-task", "--task", publication.task["id"],
                        "--task-state", "DONE", "--receipt", str(receipt),
                        "--summary", "must not mutate", "--publication-registration", reg["registration_id"],
                    ]),
                ):
                    with self.assertRaisesRegex(RuntimeError, "ROLE_LOCATION_MISMATCH"):
                        control.main()

            self.assertEqual(board_path.read_bytes(), before_board)
            self.assertEqual(registry.completion_record("C", publication.task["id"]), before_completion)
        finally:
            publication.doCleanups()

    def test_publication_role_branch_check_ignores_forged_git_environment(self):
        fixed = self.publication_role_fixture("wrong-branch-C", branch="wrong-branch")
        forger = self.publication_role_fixture("branch-forger-C", branch="work/c-integration")
        authority = {"role_path": str(fixed), "role_branch": "work/c-integration"}
        forged_env = {
            "GIT_DIR": str((forger / ".git").resolve()),
            "GIT_WORK_TREE": str(fixed),
        }
        with (
            contextlib.chdir(fixed),
            patch.dict(os.environ, forged_env, clear=False),
            patch.object(control, "validate_queue_completion_source_authority", return_value=authority),
        ):
            with self.assertRaisesRegex(RuntimeError, "ROLE_LOCATION_MISMATCH"):
                control.require_publication_queue_location("C", "published-task", "b" * 64)

    def test_unaccepted_control_source_blocks_before_publication_queue_mutation(self):
        attacker = self.publication_role_fixture("self-authorized-C")
        with (
            contextlib.chdir(attacker),
            patch.object(
                control, "validate_queue_completion_source_authority",
                side_effect=RuntimeError("QUEUE_COMPLETE_ROUTE_SOURCE_NOT_ACCEPTED"),
            ) as source_authority,
            patch.object(control, "advance_queue_task") as advance,
        ):
            with self.assertRaisesRegex(RuntimeError, "ROLE_LOCATION_MISMATCH"):
                control.require_publication_queue_location(
                    "C", "published-task", "b" * 64
                )
        source_authority.assert_called_once()
        advance.assert_not_called()

    def test_busy_heavy_slot_does_not_start_a_command(self):
        import fcntl
        with (self.root / "heavy.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(control.subprocess, "Popen") as child:
                self.assertEqual(control.heavy("C", ["must-not-run"], False), 75)
                child.assert_not_called()

if __name__ == "__main__":
    unittest.main()
