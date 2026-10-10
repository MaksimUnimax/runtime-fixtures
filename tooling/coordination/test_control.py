import argparse
import contextlib
import importlib.util
import json
import io
import hashlib
from types import SimpleNamespace
import os
import shutil
import subprocess
import sys
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from contextlib import nullcontext

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

    def _attested_v1_test_status(self):
        """Unit-only V1 producer overlay, AFTER real current inventory checks."""
        native = control.DiskLifecycleRegistry.status_locked

        def attested(registry, role=None, task=None, complete=False):
            actual = native(registry, role, task, complete=complete)
            if not complete:
                return actual
            return dict(
                actual,
                delegation_inventory_version=1,
                delegation_inventory_attested=True,
                foreign_allocation_count=0,
                delegated_publication_registration=None,
            )

        return attested

    def _guarded_mock_queue_writer(self, *, before="IN_PROGRESS",
                                  fail_after_guard=None, spoof_role=None):
        """Exercise real R7 callbacks; only queue persistence is mocked."""
        def write(target, role, task, state, receipt, summary, **kwargs):
            self.assertEqual(target, self.root)
            self.assertIn("completion_guard", kwargs)
            self.assertIn("resource_lock", kwargs)
            updated_task = {"id": task, "role": spoof_role or role}
            with kwargs["resource_lock"]():
                with kwargs["completion_guard"](before, updated_task):
                    if fail_after_guard is not None:
                        raise RuntimeError(fail_after_guard)
            return {"state": state}

        return write

    def _capacity_fixture(self, revision=5):
        folder = self.root / "controllers"
        folder.mkdir(exist_ok=True)
        path = folder / "work-board.json"
        raw = json.dumps(
            {"revision": revision, "tasks": [
                {"id": "q1", "state": "READY"},
                {"id": "q2", "state": "BLOCKED"},
                {"id": "q3", "state": "IN_PROGRESS"},
            ]},
            separators=(",", ":"),
        ).encode()
        path.write_bytes(raw)
        return path, raw

    def test_queue_capacity_reports_exact_observed_hot_without_writing(self):
        file, original = self._capacity_fixture()
        result = control.observed_queue_hot_capacity(self.root)
        self.assertEqual(result["board_revision"], 5)
        self.assertEqual(result["hot_bytes"], len(original))
        self.assertEqual(result["hot_cap_bytes"], 262144)
        self.assertEqual(result["headroom_bytes"], 262144 - len(original))
        self.assertEqual(result["task_state_counts"], {
            "READY": 1, "IN_PROGRESS": 1, "BLOCKED": 1, "DONE": 0,
        })
        self.assertEqual(
            result["observed_hot_sha256"], hashlib.sha256(original).hexdigest()
        )
        self.assertFalse(result["mutation_performed"])
        self.assertEqual(result["authority"], "OBSERVED_ONLY_NOT_QUEUE_ADMISSION")
        self.assertEqual(file.read_bytes(), original)
        self.assertEqual(sorted(x.name for x in file.parent.iterdir()), ["work-board.json"])

    def test_queue_capacity_cli_route_never_writes_role_or_board_state(self):
        file, raw = self._capacity_fixture(revision=77)
        role_file = self.root / "C.json"
        role_bytes = b'{"role":"C","status":"RUNNING","task":"C00"}\n'
        role_file.write_bytes(role_bytes)
        stdout = io.StringIO()
        with patch.object(control, "require_location"):
            with patch.object(sys, "argv", ["control.py", "C", "queue-capacity"]):
                with contextlib.redirect_stdout(stdout):
                    self.assertEqual(control.main(), 0)
        message = json.loads(stdout.getvalue())
        self.assertEqual(message["board_revision"], 77)
        self.assertFalse(message["mutation_performed"])
        self.assertEqual(message["authority"], "OBSERVED_ONLY_NOT_QUEUE_ADMISSION")
        self.assertEqual(file.read_bytes(), raw)
        self.assertEqual(role_file.read_bytes(), role_bytes)

    def test_queue_capacity_accepts_exact_byte_limit_and_refuses_oversize(self):
        file, body = self._capacity_fixture(revision=42)
        full = body + b" " * (262144 - len(body))
        self.assertEqual(len(full), 262144)
        file.write_bytes(full)
        result = control.observed_queue_hot_capacity(self.root)
        self.assertEqual(result["hot_bytes"], 262144)
        self.assertEqual(result["headroom_bytes"], 0)
        file.write_bytes(full + b" ")
        with self.assertRaisesRegex(RuntimeError, "SOURCE_INVALID"):
            control.observed_queue_hot_capacity(self.root)
        self.assertEqual(file.read_bytes(), full + b" ")

    def test_queue_capacity_rejects_symlink_nonfile_and_invalid_schema(self):
        file, _ = self._capacity_fixture()
        external = self.root / "never-open-target.json"
        external.write_text('{"revision":4,"tasks":[]}')
        file.unlink()
        file.symlink_to(external)
        with self.assertRaisesRegex(RuntimeError, "SOURCE_UNAVAILABLE"):
            control.observed_queue_hot_capacity(self.root)
        self.assertEqual(external.read_text(), '{"revision":4,"tasks":[]}')
        file.unlink()
        file.mkdir()
        with self.assertRaisesRegex(RuntimeError, "SOURCE_INVALID"):
            control.observed_queue_hot_capacity(self.root)
        file.rmdir()
        deep = (
            b'{"revision":1,"tasks":[],"extra":'
            + b"[" * 1200 + b"0" + b"]" * 1200 + b"}"
        )
        self.assertLess(len(deep), 262144)
        for raw in (
            b"not json",
            b'{"revision":true,"tasks":[]}',
            b'{"revision":1,"tasks":[{"state":"FAKE"}]}',
            b'{"revision":1,"tasks":[{"state":[]}]}',
            b'{"revision":1,"tasks":[{"state":{}}]}',
            deep,
        ):
            file.write_bytes(raw)
            with self.assertRaisesRegex(RuntimeError, "SCHEMA_INVALID"):
                control.observed_queue_hot_capacity(self.root)
            self.assertEqual(file.read_bytes(), raw)


    def test_queue_capacity_depth_limit_is_independent_of_python_recursion_limit(self):
        file, _ = self._capacity_fixture()
        raw = b'{"revision":1,"tasks":[],"extra":' + b"[" * 1200 + b"0" + b"]" * 1200 + b"}"
        file.write_bytes(raw)
        previous = sys.getrecursionlimit()
        try:
            sys.setrecursionlimit(10000)
            with self.assertRaisesRegex(RuntimeError, "SCHEMA_INVALID"):
                control.observed_queue_hot_capacity(self.root)
        finally:
            sys.setrecursionlimit(previous)
        self.assertEqual(file.read_bytes(), raw)

    def test_queue_capacity_ignores_structural_brackets_inside_escaped_strings(self):
        file, _ = self._capacity_fixture()
        value = {
            "revision": 8, "tasks": [],
            "note": '[{' * 2000 + r'\"quoted\\value[{}]',
        }
        raw = json.dumps(value).encode()
        file.write_bytes(raw)
        result = control.observed_queue_hot_capacity(self.root)
        self.assertEqual(result["board_revision"], 8)
        self.assertEqual(result["hot_bytes"], len(raw))
        self.assertEqual(file.read_bytes(), raw)

    def test_queue_capacity_rejects_symlinked_controllers_directory(self):
        file, original = self._capacity_fixture()
        directory = file.parent
        actual = self.root / "untrusted-controllers-target"
        directory.rename(actual)
        directory.symlink_to(actual, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "SOURCE_UNAVAILABLE"):
            control.observed_queue_hot_capacity(self.root)
        self.assertEqual((actual / "work-board.json").read_bytes(), original)
        directory.unlink()
        actual.rename(directory)
        self.assertEqual(
            control.observed_queue_hot_capacity(self.root)["board_revision"], 5
        )
        self.assertEqual(file.read_bytes(), original)

    def test_queue_capacity_refuses_changed_source_identity(self):
        file, raw = self._capacity_fixture()
        actual = os.stat(file, follow_symlinks=False)
        fields = ("st_dev", "st_ino", "st_size", "st_mtime_ns",
                  "st_ctime_ns", "st_mode")
        fake = SimpleNamespace(**{x: getattr(actual, x) for x in fields})
        fake.st_ino += 1
        with patch.object(control.os, "stat", return_value=fake):
            with self.assertRaisesRegex(RuntimeError, "SOURCE_DRIFT"):
                control.observed_queue_hot_capacity(self.root)
        self.assertEqual(file.read_bytes(), raw)

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
        with patch.object(control, "advance_task",
                          side_effect=self._guarded_mock_queue_writer()) as advance:
            with self.assertRaisesRegex(RuntimeError, "ARTIFACT_INVENTORY_MISSING"):
                control.advance_queue_task(
                    "A", "TASK-DISK-GATE", "DONE", "receipt.json", "done")
        advance.assert_called_once()
        self.assertIsNone(
            control.DiskLifecycleRegistry(self.root).completion_record(
                "A", "TASK-DISK-GATE"))

    def test_current_main_without_v1_issuer_attestation_fails_closed(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none(
            "A", "TASK-DISK-NO-V1",
            "Read-only task created no temporary outputs")
        # Exercise a truly pre-V1 status, including when native source
        # already emits the four accepted issuer attestation fields.
        native_status_locked = control.DiskLifecycleRegistry.status_locked

        def missing_v1_attestation(registry, role=None, task=None, complete=False):
            current = native_status_locked(registry, role, task, complete=complete)
            if not complete:
                return current
            without_issuer = dict(current)
            for field in (
                "delegation_inventory_version", "delegation_inventory_attested",
                "foreign_allocation_count", "delegated_publication_registration",
            ):
                without_issuer.pop(field, None)
            return without_issuer

        with (
            patch.object(control.DiskLifecycleRegistry, "status_locked",
                         new=missing_v1_attestation),
            patch.object(control, "advance_task",
                         side_effect=self._guarded_mock_queue_writer()),
        ):
            with self.assertRaisesRegex(
                RuntimeError, "CROSS_ROLE_RESOURCE_INVENTORY_ATTESTATION_REQUIRED"
            ):
                control.advance_queue_task(
                    "A", "TASK-DISK-NO-V1", "DONE",
                    "receipt.json", "done")
        self.assertIsNone(
            registry.completion_record("A", "TASK-DISK-NO-V1"))

    def test_done_accepts_closed_no_output_inventory_and_seals_future_allocations(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none(
            "A", "TASK-DISK-GATE",
            "Read-only task created no temporary outputs")
        with (
            patch.object(control.DiskLifecycleRegistry, "status_locked",
                         new=self._attested_v1_test_status()),
            patch.object(control, "advance_task",
                         side_effect=self._guarded_mock_queue_writer()) as advance,
        ):
            result = control.advance_queue_task(
                "A", "TASK-DISK-GATE", "DONE", "receipt.json", "done")
        self.assertEqual(result, {"state": "DONE"})
        advance.assert_called_once()
        self.assertEqual(
            registry.completion_record("A", "TASK-DISK-GATE")["state"], "SEALED")
        (self.root / "A.json").write_text(json.dumps({"status": "RUNNING"}))
        with self.assertRaisesRegex(ValueError,
                                    "TASK_DISK_LIFECYCLE_ALREADY_COMPLETED"):
            registry.begin(
                "A", "TASK-DISK-GATE", "Late output after task completion",
                [str(self.root / "worktrees" / "A" / "late-output")], 16, 1)

    def test_done_allows_current_hold_then_reopen_unseals_future_allocations(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        (self.root / "A.json").write_text(json.dumps({"status": "RUNNING"}))
        item = registry.begin(
            "A", "TASK-DISK-HELD",
            "Temporary source retained for a named reviewer",
            [str(self.root / "worktrees" / "A" / "task-disk-held")], 16, 1)
        registry.change(
            item["id"], "A", "hold",
            "Reviewer still consumes the exact temporary source",
            "Independent reviewer TASK-DISK-HELD", 1)
        with (
            patch.object(control.DiskLifecycleRegistry, "status_locked",
                         new=self._attested_v1_test_status()),
            patch.object(control, "advance_task",
                         side_effect=self._guarded_mock_queue_writer()),
        ):
            self.assertEqual(
                control.advance_queue_task(
                    "A", "TASK-DISK-HELD", "DONE", "receipt.json", "done"),
                {"state": "DONE"})
        self.assertEqual(
            registry.completion_record("A", "TASK-DISK-HELD")["state"], "SEALED")
        # The separate native queue tests validate the negative rework
        # receipt; this mock checks only resource postcommit release.
        with patch.object(
            control, "advance_task",
            side_effect=self._guarded_mock_queue_writer(before="DONE")
        ):
            self.assertEqual(
                control.advance_queue_task(
                    "A", "TASK-DISK-HELD", "IN_PROGRESS",
                    "rework.json", "reopen"),
                {"state": "IN_PROGRESS"})
        self.assertEqual(
            registry.completion_record("A", "TASK-DISK-HELD")["state"], "REOPENED")
        followup = registry.begin(
            "A", "TASK-DISK-HELD",
            "New temporary output after explicit task reopen",
            [str(self.root / "worktrees" / "A" / "task-disk-held-followup")],
            16, 1)
        self.assertEqual(followup["state"], "OPEN")

    def test_precommit_done_failure_does_not_invent_resource_reopen(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none(
            "A", "TASK-DISK-FAIL",
            "Read-only task created no temporary outputs")
        # Failure before the native writer invokes the guard has never
        # created a resource seal; no stale board readback is invented.
        with patch.object(control, "advance_task",
                          side_effect=RuntimeError("strict receipt failed")):
            with self.assertRaisesRegex(RuntimeError, "strict receipt failed"):
                control.advance_queue_task(
                    "A", "TASK-DISK-FAIL", "DONE", "receipt.json", "done")
        self.assertIsNone(
            registry.completion_record("A", "TASK-DISK-FAIL"))

    def test_postcommit_done_failure_keeps_durable_sealed_state(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none(
            "A", "TASK-DISK-POST",
            "Read-only task created no temporary outputs")
        with (
            patch.object(control.DiskLifecycleRegistry, "status_locked",
                         new=self._attested_v1_test_status()),
            patch.object(
                control, "advance_task",
                side_effect=self._guarded_mock_queue_writer(
                    fail_after_guard="event append failed")),
        ):
            with self.assertRaisesRegex(RuntimeError, "event append failed"):
                control.advance_queue_task(
                    "A", "TASK-DISK-POST", "DONE", "receipt.json", "done")
        # R7 writes a durable SEALED record immediately before V2 commit.
        # A failed event append must not silently REOPEN its resource.
        self.assertEqual(
            registry.completion_record("A", "TASK-DISK-POST")["state"], "SEALED")
        with self.assertRaisesRegex(
            ValueError, "TASK_DISK_LIFECYCLE_ALREADY_COMPLETED"
        ):
            registry.declare_none(
                "A", "TASK-DISK-POST",
                "Late read-only declaration after uncertain DONE")

    def test_foreign_role_task_identity_rejected_before_seal(self):
        registry = control.DiskLifecycleRegistry(self.root)
        registry.seed_baseline()
        registry.declare_none(
            "A", "TASK-DISK-ROLE",
            "Read-only task created no temporary outputs")
        with patch.object(
            control, "advance_task",
            side_effect=self._guarded_mock_queue_writer(spoof_role="B"),
        ):
            with self.assertRaisesRegex(
                RuntimeError, "WORK_QUEUE_RESOURCE_TASK_IDENTITY_MISMATCH"
            ):
                control.advance_queue_task(
                    "A", "TASK-DISK-ROLE", "DONE", "receipt.json", "done")
        self.assertIsNone(
            registry.completion_record("A", "TASK-DISK-ROLE"))

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
        registry.declare_none(
            "C", "TASK-PUBLISHED",
            "Published isolated task has no remaining temp outputs")
        registration = "a" * 64
        with (
            patch.object(control.DiskLifecycleRegistry, "status_locked",
                         new=self._attested_v1_test_status()),
            patch.object(control, "advance_task",
                         side_effect=self._guarded_mock_queue_writer()) as advance,
        ):
            result = control.advance_queue_task(
                "C", "TASK-PUBLISHED", "DONE", "receipt.json", "done",
                registration)
        self.assertEqual(result, {"state": "DONE"})
        advance.assert_called_once()
        self.assertEqual(
            advance.call_args.kwargs["publication_registration"], registration)
        self.assertIn("resource_lock", advance.call_args.kwargs)
        self.assertIn("completion_guard", advance.call_args.kwargs)
        self.assertEqual(
            registry.completion_record("C", "TASK-PUBLISHED")["state"],
            "SEALED")

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
        route_root = self.root / "accepted-route"
        route_root.mkdir()
        completion_bundle = self.root / "completion-bundle"
        authority = {"role_path": str(fixed), "role_branch": "work/c-integration"}
        env = {
            "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(route_root),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": str(completion_bundle),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": "c" * 64,
        }
        with (
            contextlib.chdir(fixed),
            patch.dict(os.environ, env, clear=False),
            patch.object(
                control, "validate_queue_completion_source_authority",
                return_value=authority,
            ) as source_authority,
            patch.object(
                control, "_select_execution_completion_bundle",
                return_value=(completion_bundle.resolve(), "c" * 64),
            ),
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
            self.root, registration, route_root.resolve(), "C", "published-task"
        )
        advance.assert_called_once_with(
            "C", "published-task", "DONE",
            "/root/octoport-control/logs/C/completion.json",
            "published", registration,
            evidence_provenance="",
        )

    def test_queue_task_cli_rejects_publication_registration_outside_canonical_cwd(self):
        registration = "b" * 64
        attacker = self.publication_role_fixture("attacker-C")
        route_root = self.root / "accepted-route-negative"
        route_root.mkdir()
        completion_bundle = self.root / "completion-bundle-negative"
        authority = {
            "role_path": str(self.root / "trusted-C"),
            "role_branch": "work/c-integration",
        }
        env = {
            "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(route_root),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": str(completion_bundle),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": "c" * 64,
        }
        with (
            contextlib.chdir(attacker),
            patch.dict(os.environ, env, clear=False),
            patch.object(
                control, "validate_queue_completion_source_authority",
                return_value=authority,
            ),
            patch.object(
                control, "_select_execution_completion_bundle",
                return_value=(completion_bundle.resolve(), "c" * 64),
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

            completion_bundle = self.root / "arbitrary-entrypoint-bundle"
            completion_env = {
                "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(attacker),
                "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": str(completion_bundle),
                "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": "c" * 64,
            }
            with (
                contextlib.chdir(fixed),
                patch.dict(os.environ, completion_env, clear=False),
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
                "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(attacker),
                "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": reg["core"]["completion_bundle_path"],
                "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": reg["core"]["completion_bundle_manifest_sha256"],
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

    def test_exact_candidate_control_entrypoint_passes_with_poisoned_caller_env(self):
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
            receipt = publication.control / "logs/completion-poisoned-positive.json"
            receipt.write_text(json.dumps({
                "kind": "octoport.work-queue-completion", "version": 1,
                "task_id": publication.task["id"], "candidate_sha": publication.head,
                "verdict": "PASS", "review": {"verdict": "PASS", "evidence": ["fixture"]},
                "checks": [{"name": "fixture", "verdict": "PASS", "evidence": ["fixture"]}],
            }))
            registry = control.DiskLifecycleRegistry(publication.control)
            registry.seed_baseline()
            registry.declare_none("C", publication.task["id"], "Exact candidate poisoned environment fixture")

            fake_bin = self.root / "positive-fake-bin"
            fake_bin.mkdir()
            marker = self.root / "positive-fake-git-invoked"
            fake_git = fake_bin / "git"
            fake_git.write_text(
                "#!/bin/sh\n"
                "printf called > \"$FAKE_GIT_MARKER\"\n"
                "exit 9\n"
            )
            fake_git.chmod(0o755)
            completion_bundle = Path(reg["core"]["completion_bundle_path"]).resolve()
            poisoned = {
                "PATH": str(fake_bin), "FAKE_GIT_MARKER": str(marker),
                "GIT_DIR": "/tmp/forged-dir", "GIT_WORK_TREE": str(publication.work),
                "GIT_INDEX_FILE": "/tmp/forged-index", "GIT_OBJECT_DIRECTORY": "/tmp/objects",
                "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.worktree",
                "GIT_CONFIG_VALUE_0": str(publication.work), "LD_PRELOAD": "/tmp/evil-loader.so",
                "PYTHONPATH": "/tmp/evil-python", "PYTHONHOME": "/tmp/evil-home",
                "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(publication.work),
                "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": str(completion_bundle),
                "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": reg["core"]["completion_bundle_manifest_sha256"],
            }
            with (
                patch.dict(os.environ, poisoned, clear=False),
                contextlib.chdir(publication.fixed),
                patch.object(control, "__file__", str(completion_bundle / "control.py")),
                patch.object(control, "ROOT", publication.work),
                patch.object(control, "CONTROL", publication.control),
                patch.object(control.DiskLifecycleRegistry, "status_locked",
                             new=self._attested_v1_test_status()),
                patch.object(control.sys, "argv", [
                    "control.py", "C", "queue-task", "--task", publication.task["id"],
                    "--task-state", "DONE", "--receipt", str(receipt),
                    "--summary", "published exact candidate",
                    "--publication-registration", reg["registration_id"],
                ]),
            ):
                self.assertEqual(control.main(), 0)

            self.assertFalse(marker.exists(), "caller PATH selected fake git for authority")
            board = route._load_board(publication.control)
            task = next(row for row in board["tasks"] if row["id"] == publication.task["id"])
            self.assertEqual(task["state"], "DONE")
            self.assertEqual(task["completion_candidate_sha"], publication.head)
            self.assertEqual(task["completion_publication_registration"], reg["registration_id"])
            self.assertEqual(registry.completion_record("C", publication.task["id"])["state"], "SEALED")
        finally:
            publication.doCleanups()

    def test_forged_path_fake_git_cannot_authorize_real_control_entrypoint(self):
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
            receipt = publication.control / "logs/completion-forged-path.json"
            receipt.write_text(json.dumps({
                "kind": "octoport.work-queue-completion", "version": 1,
                "task_id": publication.task["id"], "candidate_sha": publication.head,
                "verdict": "PASS", "review": {"verdict": "PASS", "evidence": ["fixture"]},
                "checks": [{"name": "fixture", "verdict": "PASS", "evidence": ["fixture"]}],
            }))
            registry = control.DiskLifecycleRegistry(publication.control)
            registry.seed_baseline()
            registry.declare_none("C", publication.task["id"], "Forged PATH real entrypoint fixture")
            board_path = publication.control / "controllers/work-board.json"
            before_board = board_path.read_bytes()
            before_completion = registry.completion_record("C", publication.task["id"])

            attacker = self.root / "fake-git-source"
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

            fake_bin = self.root / "fake-path-bin"
            fake_bin.mkdir()
            marker = self.root / "fake-git-invoked"
            fake_git = fake_bin / "git"
            fake_git.write_text(
                "#!/bin/sh\n"
                "printf '%s\n' \"$*\" >> \"$FAKE_GIT_MARKER\"\n"
                "case \"$*\" in\n"
                "  *'rev-parse --show-toplevel'*) printf '%s\n' \"$FAKE_GIT_ROOT\" ;;\n"
                "  *'branch --show-current'*) printf '%s\n' \"$FAKE_GIT_BRANCH\" ;;\n"
                "  *'rev-parse HEAD^{tree}'*) printf '%s\n' \"$FAKE_GIT_TREE\" ;;\n"
                "  *'rev-parse HEAD'*) printf '%s\n' \"$FAKE_GIT_HEAD\" ;;\n"
                "  *'status --porcelain=v1 --untracked-files=all'*) exit 0 ;;\n"
                "  *'ls-files --error-unmatch'*) for last do :; done; printf '%s\n' \"$last\" ;;\n"
                "  *) exit 0 ;;\n"
                "esac\n"
            )
            fake_git.chmod(0o755)
            tree = publication.git(publication.work, "rev-parse", "HEAD^{tree}")
            forged = {
                "PATH": str(fake_bin), "FAKE_GIT_MARKER": str(marker),
                "FAKE_GIT_ROOT": str(attacker), "FAKE_GIT_BRANCH": "candidate",
                "FAKE_GIT_HEAD": publication.head, "FAKE_GIT_TREE": tree,
                "GIT_DIR": "/tmp/forged-dir", "GIT_WORK_TREE": str(attacker),
                "GIT_INDEX_FILE": "/tmp/forged-index", "GIT_OBJECT_DIRECTORY": "/tmp/objects",
                "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "core.worktree",
                "GIT_CONFIG_VALUE_0": str(attacker), "LD_PRELOAD": "/tmp/evil-loader.so",
                "PYTHONPATH": "/tmp/evil-python",
                "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(attacker),
                "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": reg["core"]["completion_bundle_path"],
                "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": reg["core"]["completion_bundle_manifest_sha256"],
            }
            with (
                patch.dict(os.environ, forged, clear=False),
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

            self.assertFalse(marker.exists(), "caller PATH selected fake git for authority")
            self.assertEqual(board_path.read_bytes(), before_board)
            self.assertEqual(registry.completion_record("C", publication.task["id"]), before_completion)
        finally:
            publication.doCleanups()

    def test_publication_role_branch_check_ignores_forged_git_environment(self):
        fixed = self.publication_role_fixture("wrong-branch-C", branch="wrong-branch")
        forger = self.publication_role_fixture("branch-forger-C", branch="work/c-integration")
        route_root = self.root / "branch-route"
        route_root.mkdir()
        completion_bundle = self.root / "branch-bundle"
        authority = {"role_path": str(fixed), "role_branch": "work/c-integration"}
        forged_env = {
            "GIT_DIR": str((forger / ".git").resolve()),
            "GIT_WORK_TREE": str(fixed),
            "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(route_root),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": str(completion_bundle),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": "c" * 64,
        }
        with (
            contextlib.chdir(fixed),
            patch.dict(os.environ, forged_env, clear=False),
            patch.object(control, "validate_queue_completion_source_authority", return_value=authority),
            patch.object(
                control, "_select_execution_completion_bundle",
                return_value=(completion_bundle.resolve(), "c" * 64),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "ROLE_LOCATION_MISMATCH"):
                control.require_publication_queue_location("C", "published-task", "b" * 64)

    def test_unaccepted_control_source_blocks_before_publication_queue_mutation(self):
        attacker = self.publication_role_fixture("self-authorized-C")
        completion_bundle = self.root / "unaccepted-bundle"
        env = {
            "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(attacker),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": str(completion_bundle),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": "c" * 64,
        }
        with (
            contextlib.chdir(attacker),
            patch.dict(os.environ, env, clear=False),
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


    def _configure_mock_native_resource_seal(self, registry, events):
        # Preserve the actual record bytes used by the writer's attestation.
        seal_path = self.root / "C--C00-SAFETY.json"
        registry.completion_path.return_value = seal_path
        registry.completion_record.side_effect = (
            lambda _role, _task: {"state": "SEALED"} if seal_path.exists() else None
        )

        def persist_state(role, task, state):
            events.append(state)
            if state == "SEALED":
                seal_path.write_text(json.dumps({
                    "version": 1, "role": role, "task": task,
                    "state": state, "history": [{"state": "SEALING"}, {"state": "SEALED"}],
                }))
        registry.record_completion_state.side_effect = persist_state

    def test_resource_seal_precedes_native_queue_commit(self):
        events = []
        with patch.object(control, "DiskLifecycleRegistry") as factory:
            registry = factory.return_value
            registry.locked.return_value = nullcontext()
            self._configure_mock_native_resource_seal(registry, events)
            registry.status_locked.return_value = {
                "delegation_inventory_version": 1,
                "delegation_inventory_attested": True,
                "foreign_allocation_count": 0,
                "delegated_publication_registration": None,
            }

            def queue_writer(_root, role, task, state, receipt, summary, **kwargs):
                self.assertEqual(set(kwargs), {"completion_guard", "resource_lock"})
                with kwargs["resource_lock"](), kwargs["completion_guard"]("IN_PROGRESS", {"id": task, "role": role, "state": state}):
                    events.append("QUEUE_PERSIST")
                    self.assertTrue(kwargs.get("completion_guard") is not None)
                return {"accepted": True}

            with patch.object(control, "advance_task", side_effect=queue_writer):
                result = control.advance_queue_task("C", "C00-SAFETY", "DONE", "/proof", "accepted", control_root=self.root)
            self.assertTrue(result["accepted"])
            self.assertEqual(events, ["SEALING", "SEALED", "QUEUE_PERSIST"])

    def test_native_v1_attestation_rejects_boolean_count_and_wrong_issuer(self):
        with patch.object(control, "DiskLifecycleRegistry") as factory:
            registry = factory.return_value
            registry.locked.return_value = nullcontext()
            registry.completion_record.return_value = None
            registry.status_locked.return_value = {
                "delegation_inventory_version": 1,
                "delegation_inventory_attested": True,
                "foreign_allocation_count": True,
                "delegated_publication_registration": "a" * 64,
            }
            def queue_writer(_root, role, task, state, receipt, summary, **kwargs):
                with kwargs["resource_lock"](), kwargs["completion_guard"]("IN_PROGRESS", {"id": task, "role": role, "state": state}):
                    self.fail("Boolean inventory must not reach persistence")

            with patch.object(control, "advance_task", side_effect=queue_writer):
                with self.assertRaisesRegex(RuntimeError, "CROSS_ROLE_RESOURCE_INVENTORY_ATTESTATION_REQUIRED"):
                    control.advance_queue_task("C", "C00-SAFETY", "DONE", "/proof", "accepted",
                                               publication_registration="a" * 64, control_root=self.root)
            registry.record_completion_state.assert_not_called()
            registry.status_locked.return_value["foreign_allocation_count"] = 1
            with patch.object(control, "advance_task", side_effect=queue_writer):
                with self.assertRaisesRegex(RuntimeError, "CROSS_ROLE_PUBLICATION_REGISTRATION_MISMATCH"):
                    control.advance_queue_task("C", "C00-SAFETY", "DONE", "/proof", "accepted",
                                               publication_registration="b" * 64, control_root=self.root)
            registry.record_completion_state.assert_not_called()

    def test_foreign_attested_publisher_binds_guard_before_native_commit(self):
        """A registered CONTROLLER issuer must match the DONE caller."""
        events = []
        with patch.object(control, "DiskLifecycleRegistry") as factory:
            registry = factory.return_value
            registry.locked.return_value = nullcontext()
            self._configure_mock_native_resource_seal(registry, events)
            registry.status_locked.return_value = {
                "delegation_inventory_version": 1,
                "delegation_inventory_attested": True,
                "foreign_allocation_count": 1,
                "delegated_publication_registration": "a" * 64,
            }

            def writer(_root, role, task, state, receipt, summary, **kwargs):
                with kwargs["resource_lock"](), kwargs["completion_guard"](
                    "IN_PROGRESS", {"id": task, "role": role, "state": state}
                ):
                    events.append("V2_COMMIT")
                return {"state": state}

            with patch.object(control, "advance_task", side_effect=writer):
                for provided in ("b" * 64, ""):
                    with self.subTest(provided=provided), self.assertRaisesRegex(
                        RuntimeError, "CROSS_ROLE_PUBLICATION_REGISTRATION_MISMATCH"
                    ):
                        control.advance_queue_task(
                            "C", "C00-SAFETY", "DONE", "/accepted", "test",
                            publication_registration=provided, control_root=self.root,
                        )
                    self.assertEqual(events, [])
                    registry.record_completion_state.assert_not_called()
                    self.assertFalse((self.root / "C--C00-SAFETY.json").exists())
                # Positive callback shape only, not a published registration.
                result = control.advance_queue_task(
                    "C", "C00-SAFETY", "DONE", "/accepted", "test",
                    publication_registration="a" * 64, control_root=self.root,
                )
            self.assertEqual(result["state"], "DONE")
            self.assertEqual(events, ["SEALING", "SEALED", "V2_COMMIT"])

    def test_foreign_sealed_rework_denied_before_native_queue_persist(self):
        """Reject a foreign resource before writing IN_PROGRESS to V2."""
        persisted = []
        task = {
            "id": "C00-SAFETY", "role": "C", "state": "IN_PROGRESS",
            "completion_resource_required": True,
            "completion_resource_seal_snapshot": {"marker": "keep"},
        }
        with patch.object(control, "DiskLifecycleRegistry") as factory:
            registry = factory.return_value
            registry.locked.return_value = nullcontext()
            registry.completion_record.return_value = {"state": "SEALED"}
            registry.rows.return_value = [
                {"task": "C00-SAFETY", "role": "CONTROLLER"}
            ]

            def writer(_root, role, ident, state, receipt, summary, **kwargs):
                with kwargs["resource_lock"](), kwargs["completion_guard"](
                    "DONE", task
                ):
                    persisted.append("V2_COMMIT")
                return {"state": state}

            with patch.object(control, "advance_task", side_effect=writer):
                with self.assertRaisesRegex(
                    RuntimeError, "CROSS_ROLE_REOPEN_JOURNAL_AUTHORITY_REQUIRED"
                ):
                    control.advance_queue_task(
                        "C", "C00-SAFETY", "IN_PROGRESS", "/negative", "rework",
                        control_root=self.root,
                    )
            self.assertEqual(persisted, [])
            self.assertIs(task["completion_resource_required"], True)
            self.assertEqual(
                task["completion_resource_seal_snapshot"], {"marker": "keep"}
            )
            registry.record_completion_state.assert_not_called()
            registry.reopen_if_completion_locked.assert_not_called()
            self.assertEqual(
                registry.completion_record("C", "C00-SAFETY")["state"], "SEALED"
            )

    def test_ambiguous_v2_exception_leaves_resource_sealed(self):
        events = []
        with patch.object(control, "DiskLifecycleRegistry") as factory:
            registry = factory.return_value
            registry.locked.return_value = nullcontext()
            self._configure_mock_native_resource_seal(registry, events)
            registry.status_locked.return_value = {
                "delegation_inventory_version": 1,
                "delegation_inventory_attested": True,
                "foreign_allocation_count": 0,
                "delegated_publication_registration": None,
            }

            def queue_writer(_root, role, task, state, receipt, summary, **kwargs):
                with kwargs["resource_lock"](), kwargs["completion_guard"]("IN_PROGRESS", {"id": task, "role": role, "state": state}):
                    events.append("V2_AMBIGUOUS")
                    raise OSError("V2_FAIL_AFTER_HOT_REPLACE")

            with patch.object(control, "advance_task", side_effect=queue_writer):
                with self.assertRaisesRegex(RuntimeError, "DISK_LIFECYCLE_INCOMPLETE"):
                    control.advance_queue_task("C", "C00-SAFETY", "DONE", "/proof", "accepted", control_root=self.root)
            self.assertEqual(events, ["SEALING", "SEALED", "V2_AMBIGUOUS"])
            self.assertNotIn("REOPENED", events)

    def test_abandoned_sealed_in_progress_cannot_be_noop_reopened(self):
        with patch.object(control, "DiskLifecycleRegistry") as factory:
            registry = factory.return_value
            registry.locked.return_value = nullcontext()
            registry.completion_record.return_value = {"state": "SEALED"}

            def queue_writer(_root, role, task, state, receipt, summary, **kwargs):
                with kwargs["resource_lock"](), kwargs["completion_guard"]("IN_PROGRESS", {"id": task, "role": role, "state": state}):
                    self.fail("No-op IN_PROGRESS with SEALED must not reach persistence")

            with patch.object(control, "advance_task", side_effect=queue_writer):
                with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_RESOURCE_JOURNAL_RECOVERY_REQUIRED"):
                    control.advance_queue_task("C", "C00-SAFETY", "IN_PROGRESS", "", "", control_root=self.root)
            registry.reopen_if_completion_locked.assert_not_called()

    def test_valid_same_role_negative_rework_unseals_only_after_commit(self):
        events = []
        with patch.object(control, "DiskLifecycleRegistry") as factory:
            registry = factory.return_value
            registry.locked.return_value = nullcontext()
            registry.completion_record.return_value = {"state": "SEALED"}
            registry.rows.return_value = [{"role": "C", "task": "C00-SAFETY"}]
            registry.reopen_if_completion_locked.side_effect = lambda role, task: events.append("REOPENED")

            def queue_writer(_root, role, task, state, receipt, summary, **kwargs):
                with kwargs["resource_lock"](), kwargs["completion_guard"]("DONE", {"id": task, "role": role, "state": state}):
                    events.append("QUEUE_COMMITTED")

            with patch.object(control, "advance_task", side_effect=queue_writer):
                control.advance_queue_task("C", "C00-SAFETY", "IN_PROGRESS", "/negative", "rework", control_root=self.root)
            self.assertEqual(events, ["QUEUE_COMMITTED", "REOPENED"])


    def test_native_evidence_only_provenance_cli_is_forwarded(self):
        with (patch.object(control, "require_location") as location,
              patch.object(control, "advance_queue_task",
                           return_value={"state": "DONE"}) as writer,
              patch.object(control.sys, "argv", [
                  "control.py", "C", "queue-task", "--task", "c-evidence",
                  "--task-state", "DONE", "--receipt", "/root/isolated.json",
                  "--evidence-provenance", "/root/isolated-manifest.json",
              ])):
            self.assertEqual(control.main(), 0)
        location.assert_called_once_with("C")
        writer.assert_called_once()
        self.assertEqual(writer.call_args.args[:3],
                         ("C", "c-evidence", "DONE"))
        self.assertEqual(writer.call_args.kwargs,
                         {"evidence_provenance": "/root/isolated-manifest.json"})

    def test_native_evidence_and_publication_cannot_share_queue_command(self):
        with (patch.object(control, "require_location") as location,
              patch.object(control, "require_publication_queue_location") as publication,
              patch.object(control.sys, "argv", [
                  "control.py", "C", "queue-task", "--task", "c-evidence",
                  "--task-state", "DONE", "--publication-registration", "a" * 64,
                  "--evidence-provenance", "/root/untrusted-manifest.json",
              ])):
            with self.assertRaisesRegex(
                RuntimeError, "WORK_QUEUE_EVIDENCE_SOURCE_PUBLISH_CONFLICT"
            ):
                control.main()
        location.assert_not_called()
        publication.assert_not_called()

    def test_native_advance_queue_evidence_pair_rejected_before_disk(self):
        with patch.object(control, "DiskLifecycleRegistry") as registry:
            with self.assertRaisesRegex(
                RuntimeError, "WORK_QUEUE_EVIDENCE_SOURCE_PUBLISH_CONFLICT"
            ):
                control.advance_queue_task(
                    "C", "c-evidence", "DONE", "/receipt", "accepted",
                    publication_registration="a" * 64,
                    control_root=self.root,
                    evidence_provenance="/logs/c-evidence/manifest.json",
                )
            with self.assertRaisesRegex(
                RuntimeError, "WORK_QUEUE_EVIDENCE_COMPLETION_DONE_ONLY"
            ):
                control.advance_queue_task(
                    "C", "c-evidence", "IN_PROGRESS", "", "work",
                    control_root=self.root,
                    evidence_provenance="/logs/c-evidence/manifest.json",
                )
        registry.assert_not_called()

    def test_native_advance_queue_evidence_keeps_atomic_resource_guards(self):
        with (patch.object(control, "DiskLifecycleRegistry") as registry,
              patch.object(control, "advance_task", return_value={"accepted": True})
              as writer):
            result = control.advance_queue_task(
                "C", "c-evidence", "DONE", "/proof", "accepted",
                control_root=self.root,
                evidence_provenance="/logs/c-evidence/manifest.json",
            )
        self.assertEqual(result, {"accepted": True})
        registry.assert_called_once()
        self.assertEqual(writer.call_args.kwargs["evidence_provenance"],
                         "/logs/c-evidence/manifest.json")
        self.assertIn("completion_guard", writer.call_args.kwargs)
        self.assertEqual(writer.call_args.kwargs["resource_lock"],
                         registry.return_value.locked)
        self.assertNotIn("publication_registration", writer.call_args.kwargs)

if __name__ == "__main__":
    unittest.main()
