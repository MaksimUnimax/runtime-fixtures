#!/usr/bin/env python3
"""Failure injection only: no Docker, systemd, network or live credentials."""
import importlib.util
import json
import os
import sys
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from contextlib import ExitStack
from unittest.mock import patch

TARGET = Path(os.environ.get("OCTOPORT_DEPLOY_TEST_TARGET",
    str(Path(__file__).with_name("deploy_owner_test.py"))))
sys.path.insert(0, str(TARGET.parent))
spec = importlib.util.spec_from_file_location("deployment_under_test", TARGET)
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeploymentFailures(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.events = []
        self.schema = "old"
        self.app = "old"
        self.fail_migration = False
        self.fail_restore = False
        self.fail_readback = False
        self.fail_candidate = False
        self.fail_stop = False
        self.fail_backup = False
        self.fail_old_health = False
        self.fail_floor = False
        self.started = False
        self.backup = self.root / "fresh.dump"
        self.backup.write_bytes(b"disposable fake backup")
        replacements = {
            "EVID": self.root / "evidence", "BACKUPS": self.root / "backups",
            "preflight": lambda: {"status": "PREFLIGHT_PASS"},
            "verify_release": lambda path, expected: {"status": "PASS", "sourceSha": expected},
            "verify_candidate_dropins": lambda: None,
            "database_url": lambda: "postgres://fixture@localhost/fixture",
            "snapshot_dropins": lambda path: path.mkdir(),
            "database_creation_meta": lambda *_: {"encoding": "UTF8", "collate": "C", "ctype": "C"},
            "unit_prop": self.unit_prop,
            "stop_product_units": self.stop,
            "start_product_units": self.start,
            "backup_live": self.backup_live,
            "restore_isolated": lambda *_: {"before": 22, "after": 40},
            "migrate": self.migrate,
            "docker_psql_scalar": self.scalar,
            "check_migration_prefix": self.prefix,
            "restore_live_backup": self.restore,
            "restore_dropins": self.old_dropins,
            "write_dropins": self.write_dropins,
            "wait_runtime": self.health,
            "run": self.forbidden_io,
        }
        for name, value in replacements.items():
            p = patch.object(deploy, name, value)
            p.start()
            self.addCleanup(p.stop)
        p = patch.dict(os.environ, {"OCTOPORT_OWNER_DEPLOY_AUTHORIZATION": deploy.AUTH})
        p.start()
        self.addCleanup(p.stop)

    def forbidden_io(self, *args, **kwargs):
        raise AssertionError("UNMOCKED_EXTERNAL_IO")

    def unit_prop(self, unit, prop):
        if unit in deploy.MONITOR_UNITS:
            if prop == "ActiveState": return "active"
            if prop == "SubState": return "running"
            if prop == "NRestarts": return "0"
            if prop == "ExecStart":
                return "{ path=/monitor ; argv[]=/monitor --run ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; pid=0 ; code=(null) ; status=0/0 }"
        if prop == "ActiveState":
            return "active" if self.started else "inactive"
        if prop == "SubState":
            return "running" if self.started else "dead"
        return "unchanged"

    def stop(self):
        self.events.append(("stop", self.app, self.schema))
        if self.fail_stop:
            raise RuntimeError("STOP_FAILED")
        self.started = False

    def start(self):
        self.events.append(("start", self.app, self.schema))
        self.started = True

    def backup_live(self, *_):
        if self.fail_backup:
            raise RuntimeError("BACKUP_FAILED")
        return self.backup

    def migrate(self, *_):
        self.events.append(("migrate", self.app, self.schema))
        self.schema = "new"
        if self.fail_migration:
            raise RuntimeError("MIGRATION_FAILED")

    def scalar(self, *_):
        if self.fail_readback:
            raise RuntimeError("DATABASE_READBACK_LOST")
        return "40"

    def prefix(self, url, expected):
        if self.fail_readback:
            raise RuntimeError("DATABASE_READBACK_LOST")
        self.assertEqual(self.schema, "new" if expected == 40 else "old")
        return {"status": "PASS_PREFIX", "applied": expected}

    def restore(self, *_):
        self.events.append(("restore", self.app, self.schema))
        if self.fail_restore:
            raise RuntimeError("RESTORE_FAILED")
        self.schema = "old"
        return 22

    def old_dropins(self, *_):
        self.app = "old"

    def write_dropins(self, release):
        self.app = "candidate" if release == deploy.CANDIDATE_REL else "floor"

    def health(self, *_):
        self.events.append(("health", self.app, self.schema))
        if (self.app == "candidate" and self.fail_candidate
                or self.app == "old" and self.fail_old_health
                or self.app == "floor" and self.fail_floor):
            raise RuntimeError("HEALTH_FAILED")
        return {"ready": 200}

    def apply_failure(self):
        with self.assertRaises(Exception):
            deploy.apply()
        receipts = list(deploy.EVID.glob("apply-*/receipt.json"))
        self.assertEqual(len(receipts), 1)
        return json.loads(receipts[0].read_text())

    def assert_no_unsafe_start(self):
        self.assertNotIn(("start", "old", "new"), self.events)

    def seed_forward_monitor_failure(self, error="MONITOR_UNIT_CHANGED"):
        self.schema = "new"
        self.app = "candidate"
        self.started = False
        deploy.EVID.mkdir(parents=True, exist_ok=True)
        stamp = "20260928T111855095131Z"
        apply_dir = deploy.EVID / ("apply-" + stamp)
        apply_dir.mkdir()
        receipt_path = apply_dir / "receipt.json"
        monitor = {
            unit: {
                "active": "active",
                "sub": "running",
                "exec": "{ path=/monitor ; argv[]=/monitor --run ; ignore_errors=no ; start_time=[Mon 2026-09-28 10:48:08 MSK] ; stop_time=[n/a] ; pid=1234 ; code=(null) ; status=0/0 }",
            }
            for unit in deploy.MONITOR_UNITS
        }
        receipt = {
            "status": "FAILED",
            "stamp": stamp,
            "error": error,
            "candidate": deploy.CANDIDATE,
            "phase": "CANDIDATE_PASS",
            "schemaState": "FORWARD_VERIFIED",
            "recoveryRequired": True,
            "liveMigrationCount": 40,
            "candidateHealth": {"live": 200, "ready": 200, "portal": 200, "workerReady": True},
            "preflight": {"monitorUnits": monitor},
        }
        receipt_path.write_text(json.dumps(receipt))
        deploy.FORWARD_RECOVERY_SOURCE_RECEIPT_SHA256 = deploy.sha256(receipt_path)
        (deploy.EVID / "deployment-state.json").write_text(json.dumps({
            "candidate": deploy.CANDIDATE,
            "phase": "CANDIDATE_PASS",
            "schemaState": "FORWARD_VERIFIED",
            "recoveryRequired": True,
            "receipt": str(receipt_path),
        }))
        return receipt_path

    def test_readback_loss_after_migration_never_restarts_old_app(self):
        self.fail_readback = True
        self.apply_failure()
        self.assert_no_unsafe_start()

    def test_failed_backup_restore_never_restarts_old_app(self):
        self.fail_migration = True
        self.fail_restore = True
        self.apply_failure()
        self.assert_no_unsafe_start()

    def test_success_has_durable_completed_receipt(self):
        result = deploy.apply()
        self.assertEqual(result["status"], "APPLY_PASS")
        self.assertEqual(result["schemaState"], "FORWARD_VERIFIED")
        self.assertFalse(result["recoveryRequired"])
        self.assertEqual(self.app, "candidate")
        state = json.loads((deploy.EVID / "deployment-state.json").read_text())
        self.assertFalse(state["recoveryRequired"])
        self.assert_no_unsafe_start()

    def test_migration_failure_with_verified_restore_recovers_old_app(self):
        self.fail_migration = True
        result = self.apply_failure()
        self.assertTrue(result["previousUnitsRestored"])
        self.assertEqual(result["schemaState"], "LEGACY_VERIFIED")
        self.assertFalse(result["recoveryRequired"])
        self.assertIn(("health", "old", "old"), self.events)
        self.assert_no_unsafe_start()

    def test_unknown_schema_blocks_a_second_apply(self):
        self.fail_migration = self.fail_restore = True
        result = self.apply_failure()
        self.assertTrue(result["recoveryRequired"])
        self.assertTrue(result["productQuiesced"])
        before = list(self.events)
        with self.assertRaisesRegex(RuntimeError, "OWNER_DEPLOY_RECOVERY_REQUIRED"):
            deploy.apply()
        self.assertEqual(before, self.events)

    def test_candidate_failure_uses_compatible_floor_without_database_restore(self):
        self.fail_candidate = True
        result = deploy.apply()
        self.assertEqual(result["status"], "APP_ROLLBACK_FLOOR_PASS")
        self.assertEqual(self.app, "floor")
        self.assertEqual(self.schema, "new")
        self.assertFalse(any(e[0] == "restore" for e in self.events))
        self.assert_no_unsafe_start()

    def test_failed_floor_is_quiesced_and_blocks_replay(self):
        self.fail_candidate = self.fail_floor = True
        result = self.apply_failure()
        self.assertTrue(result["recoveryRequired"])
        self.assertTrue(result["productQuiesced"])
        self.assertFalse(self.started)
        self.assert_no_unsafe_start()

    def test_stop_failure_during_floor_recovery_never_switches_floor(self):
        def candidate_failure(*args):
            self.fail_stop = True
            raise RuntimeError("CANDIDATE_FAILED")
        with patch.object(deploy, "wait_runtime", candidate_failure):
            result = self.apply_failure()
        self.assertEqual(self.app, "candidate")
        self.assertTrue(result["recoveryRequired"])
        self.assertIn("quiesceError", result)
        self.assert_no_unsafe_start()

    def test_backup_failure_recovers_healthy_previous_units(self):
        self.fail_backup = True
        result = self.apply_failure()
        self.assertFalse(result["recoveryRequired"])
        self.assertTrue(result["previousUnitsRestored"])
        self.assertFalse(any(e[0] == "migrate" for e in self.events))

    def test_failed_previous_health_is_not_reported_as_recovered(self):
        self.fail_backup = self.fail_old_health = True
        result = self.apply_failure()
        self.assertTrue(result["recoveryRequired"])
        self.assertNotIn("previousUnitsRestored", result)
        self.assertFalse(self.started)

    def test_interruption_at_migration_boundary_is_fenced(self):
        def interrupt(*args):
            self.schema = "new"
            raise KeyboardInterrupt()
        with patch.object(deploy, "migrate", interrupt):
            with self.assertRaises(KeyboardInterrupt):
                deploy.apply()
        state = json.loads((deploy.EVID / "deployment-state.json").read_text())
        self.assertTrue(state["recoveryRequired"])
        self.assertEqual(state["schemaState"], "UNKNOWN")
        self.assertFalse(self.started)
        self.assert_no_unsafe_start()

    def test_missing_owner_authority_has_no_side_effects(self):
        with patch.dict(os.environ, {"OCTOPORT_OWNER_DEPLOY_AUTHORIZATION": ""}):
            with self.assertRaisesRegex(RuntimeError, "OWNER_DEPLOY_AUTHORIZATION_REQUIRED"):
                deploy.apply()
        self.assertFalse(deploy.EVID.exists())
        self.assertEqual(self.events, [])

    def test_concurrent_apply_fails_before_preflight(self):
        with deploy.deployment_guard():
            with self.assertRaisesRegex(RuntimeError, "OWNER_DEPLOY_ALREADY_RUNNING"):
                deploy.apply()
        self.assertEqual(self.events, [])

    def test_unfinished_or_malformed_journal_needs_recovery(self):
        deploy.EVID.mkdir()
        state = deploy.EVID / "deployment-state.json"
        for value in ('broken', '{}', '[]', '{"recoveryRequired":true}'):
            with self.subTest(value=value):
                state.write_text(value)
                with self.assertRaisesRegex(RuntimeError, "OWNER_DEPLOY_RECOVERY_REQUIRED"):
                    deploy.apply()
        self.assertEqual(self.events, [])

    def test_mutation_intent_is_on_disk_before_migration(self):
        def inspect(*args):
            state = json.loads((deploy.EVID / "deployment-state.json").read_text())
            self.assertTrue(state["recoveryRequired"])
            self.assertEqual(state["schemaState"], "UNKNOWN")
            self.assertEqual(state["phase"], "LIVE_MIGRATION")
            self.migrate()
        with patch.object(deploy, "migrate", inspect):
            deploy.apply()

    def test_receipt_write_failure_before_stop_prevents_mutation(self):
        with patch.object(deploy, "write_json_durable", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                deploy.apply()
        self.assertEqual(self.events, [])

    def test_failure_receipt_hides_untrusted_error_text(self):
        with patch.object(deploy, "migrate", side_effect=RuntimeError("postgres://secret:value@host")):
            result = self.apply_failure()
        self.assertEqual(result["error"], "RuntimeError")
        self.assertNotIn("secret", json.dumps(result))

    def test_rollback_cli_is_nonzero_even_when_floor_recovers(self):
        with patch.object(deploy, "apply", return_value={"status": "APP_ROLLBACK_FLOOR_PASS"}):
            with patch.object(deploy.sys, "argv", ["deploy_owner_test.py", "apply"]):
                with self.assertRaises(SystemExit) as exit_result:
                    deploy.main()
        self.assertEqual(exit_result.exception.code, 2)

    def test_monitor_runtime_exec_metadata_change_is_not_configuration_change(self):
        reads = {unit: 0 for unit in deploy.MONITOR_UNITS}

        def state(unit, prop):
            if unit in deploy.MONITOR_UNITS:
                if prop == "ActiveState": return "active"
                if prop == "SubState": return "running"
                if prop == "NRestarts": return "0"
                if prop == "ExecStart":
                    reads[unit] += 1
                    runtime = (
                        "start_time=[Mon 2026-09-28 10:48:08 MSK] ; pid=1234"
                        if reads[unit] == 1
                        else "start_time=[n/a] ; pid=0"
                    )
                    return (
                        "{ path=/monitor ; argv[]=/monitor --run ; ignore_errors=no ; "
                        + runtime
                        + " ; stop_time=[n/a] ; code=(null) ; status=0/0 }"
                    )
            return self.unit_prop(unit, prop)

        with patch.object(deploy, "unit_prop", side_effect=state):
            result = deploy.apply()
        self.assertEqual(result["status"], "APPLY_PASS")
        self.assertFalse(result["recoveryRequired"])
        self.assertTrue(result["monitorUnchanged"])

    def test_monitor_command_change_still_fails_closed(self):
        reads = {unit: 0 for unit in deploy.MONITOR_UNITS}

        def state(unit, prop):
            if unit in deploy.MONITOR_UNITS:
                if prop == "ActiveState": return "active"
                if prop == "SubState": return "running"
                if prop == "NRestarts": return "0"
                if prop == "ExecStart":
                    reads[unit] += 1
                    command = "/monitor --run" if reads[unit] == 1 else "/monitor --changed"
                    return (
                        "{ path=/monitor ; argv[]=" + command
                        + " ; ignore_errors=no ; start_time=[n/a] ; stop_time=[n/a] ; "
                        "pid=0 ; code=(null) ; status=0/0 }"
                    )
            return self.unit_prop(unit, prop)

        with patch.object(deploy, "unit_prop", side_effect=state):
            result = self.apply_failure()
        self.assertEqual(result["error"], "MONITOR_UNIT_CHANGED")
        self.assertTrue(result["recoveryRequired"])
        self.assertTrue(result["productQuiesced"])
        self.assertFalse(self.started)

    def test_forward_recovery_restarts_only_proven_candidate_and_clears_fence(self):
        source = self.seed_forward_monitor_failure()
        result = deploy.recover_forward()
        self.assertEqual(result["status"], "FORWARD_RECOVERY_PASS")
        self.assertFalse(result["recoveryRequired"])
        self.assertTrue(result["monitorUnchanged"])
        self.assertTrue(self.started)
        self.assertEqual(self.app, "candidate")
        self.assertEqual(self.schema, "new")
        self.assertEqual(result["sourceReceipt"], str(source.resolve()))
        state = json.loads((deploy.EVID / "deployment-state.json").read_text())
        self.assertFalse(state["recoveryRequired"])
        self.assertEqual(state["phase"], "FORWARD_RECOVERY_PASS")

    def test_forward_recovery_rejects_non_monitor_failure_without_start(self):
        self.seed_forward_monitor_failure(error="POST_SWITCH_HEALTH_FAILED")
        with self.assertRaisesRegex(RuntimeError, "FORWARD_RECOVERY_RECEIPT_NOT_ELIGIBLE"):
            deploy.recover_forward()
        self.assertFalse(self.started)
        self.assertEqual(self.events, [])
        state = json.loads((deploy.EVID / "deployment-state.json").read_text())
        self.assertTrue(state["recoveryRequired"])

    def test_forward_recovery_rejects_fabricated_evidence_receipt(self):
        source = self.seed_forward_monitor_failure()
        fabricated = deploy.EVID / "fabricated-receipt.json"
        fabricated.write_text(source.read_text())
        state_path = deploy.EVID / "deployment-state.json"
        state = json.loads(state_path.read_text())
        state["receipt"] = str(fabricated)
        state_path.write_text(json.dumps(state))
        with self.assertRaisesRegex(RuntimeError, "OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID"):
            deploy.recover_forward()
        self.assertFalse(self.started)
        self.assertEqual(self.events, [])
        self.assertTrue(json.loads(state_path.read_text())["recoveryRequired"])

    def test_forward_recovery_rejects_modified_canonical_receipt(self):
        source = self.seed_forward_monitor_failure()
        source.write_text(source.read_text() + "\n")
        with self.assertRaisesRegex(RuntimeError, "OWNER_DEPLOY_RECOVERY_RECEIPT_INVALID"):
            deploy.recover_forward()
        self.assertFalse(self.started)
        self.assertEqual(self.events, [])
        state = json.loads((deploy.EVID / "deployment-state.json").read_text())
        self.assertTrue(state["recoveryRequired"])

    def test_forward_recovery_health_failure_requiesces_and_keeps_fence(self):
        self.seed_forward_monitor_failure()
        self.fail_candidate = True
        with self.assertRaisesRegex(RuntimeError, "HEALTH_FAILED"):
            deploy.recover_forward()
        self.assertFalse(self.started)
        state = json.loads((deploy.EVID / "deployment-state.json").read_text())
        self.assertTrue(state["recoveryRequired"])
        self.assertEqual(state["phase"], "FORWARD_RECOVERY_FAILED")
        receipt = json.loads(Path(state["receipt"]).read_text())
        self.assertTrue(receipt["productQuiesced"])
        self.assertEqual(receipt["error"], "HEALTH_FAILED")

    def test_forward_recovery_prestart_proof_failure_requiesces_active_units(self):
        self.seed_forward_monitor_failure()
        self.started = True
        with patch.object(deploy, "check_migration_prefix", side_effect=RuntimeError("PREFIX_PROOF_FAILED")):
            with self.assertRaisesRegex(RuntimeError, "PREFIX_PROOF_FAILED"):
                deploy.recover_forward()
        self.assertFalse(self.started)
        state = json.loads((deploy.EVID / "deployment-state.json").read_text())
        self.assertTrue(state["recoveryRequired"])
        self.assertEqual(state["phase"], "FORWARD_RECOVERY_FAILED")
        receipt = json.loads(Path(state["receipt"]).read_text())
        self.assertTrue(receipt["productQuiesced"])
        self.assertEqual(receipt["error"], "PREFIX_PROOF_FAILED")

    def test_process_death_leaves_durable_fence_after_lock_is_released(self):
        import signal
        child = os.fork()
        if child == 0:
            try:
                def die(*args):
                    os.kill(os.getpid(), signal.SIGKILL)
                with patch.object(deploy, "migrate", die):
                    deploy.apply()
            finally:
                os._exit(99)
        _, status = os.waitpid(child, 0)
        self.assertTrue(os.WIFSIGNALED(status))
        self.assertEqual(os.WTERMSIG(status), signal.SIGKILL)
        state = json.loads((deploy.EVID / "deployment-state.json").read_text())
        self.assertTrue(state["recoveryRequired"])
        self.assertEqual(state["schemaState"], "UNKNOWN")
        with self.assertRaisesRegex(RuntimeError, "OWNER_DEPLOY_RECOVERY_REQUIRED"):
            deploy.apply()
        self.assertEqual(self.events, [])



class QuiesceBoundary(unittest.TestCase):
    def inactive_state(self, unit, prop):
        if prop == "LoadState": return "masked"
        if prop == "ActiveState": return "inactive"
        if prop == "SubState": return "dead"
        if prop == "MainPID": return "0"
        if prop == "ControlGroup": return ""
        return "unchanged"

    def test_failed_mask_attempts_remaining_units_and_never_claims_quiescence(self):
        failed = deploy.UNITS[-1]
        def mask(args, **kwargs):
            if args[-1] == failed:
                raise RuntimeError("SYSTEMCTL_FAILED")
        def state(unit, prop):
            if prop == "LoadState":
                return "loaded" if unit == failed else "masked"
            return self.inactive_state(unit, prop)
        with patch.object(deploy, "run", side_effect=mask) as command:
            with patch.object(deploy, "unit_prop", side_effect=state):
                with self.assertRaisesRegex(RuntimeError, "PRODUCT_UNITS_NOT_QUIESCED"):
                    deploy.stop_product_units()
        self.assertEqual([call.args[0][-1] for call in command.call_args_list],
                         list(reversed(deploy.UNITS)))

    def test_inactive_but_live_main_pid_is_not_quiesced(self):
        def state(unit, prop):
            if prop == "MainPID" and unit == deploy.UNITS[0]: return "4321"
            return self.inactive_state(unit, prop)
        with patch.object(deploy, "run", return_value=None):
            with patch.object(deploy, "unit_prop", side_effect=state):
                with self.assertRaisesRegex(RuntimeError, "PRODUCT_UNITS_NOT_QUIESCED"):
                    deploy.stop_product_units()

    def test_live_cgroup_child_is_not_quiesced(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            group=root/"system.slice"/"seller-agents-owner-test-api.service"
            group.mkdir(parents=True)
            (group/"cgroup.procs").write_text("4321\n")
            def state(unit, prop):
                if prop == "ControlGroup" and unit == deploy.UNITS[0]:
                    return "/system.slice/seller-agents-owner-test-api.service"
                return self.inactive_state(unit, prop)
            with patch.object(deploy, "CGROUP_ROOT", root):
                with patch.object(deploy, "run", return_value=None):
                    with patch.object(deploy, "unit_prop", side_effect=state):
                        with self.assertRaisesRegex(RuntimeError, "PRODUCT_UNITS_NOT_QUIESCED"):
                            deploy.stop_product_units()

    def test_existing_cgroup_without_process_file_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            group=root/"system.slice"/"seller-agents-owner-test-api.service"
            group.mkdir(parents=True)
            def state(unit, prop):
                if prop == "ControlGroup" and unit == deploy.UNITS[0]:
                    return "/system.slice/seller-agents-owner-test-api.service"
                return self.inactive_state(unit, prop)
            with patch.object(deploy, "CGROUP_ROOT", root):
                with patch.object(deploy, "run", return_value=None):
                    with patch.object(deploy, "unit_prop", side_effect=state):
                        with self.assertRaisesRegex(RuntimeError, "PRODUCT_UNIT_CGROUP_UNREADABLE"):
                            deploy.stop_product_units()

    def test_cgroup_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root=Path(directory)
            group=root/"system.slice"/"seller-agents-owner-test-api.service"
            group.parent.mkdir(parents=True)
            group.symlink_to(Path(outside), target_is_directory=True)
            def state(unit, prop):
                if prop == "ControlGroup" and unit == deploy.UNITS[0]:
                    return "/system.slice/seller-agents-owner-test-api.service"
                return self.inactive_state(unit, prop)
            with patch.object(deploy, "CGROUP_ROOT", root):
                with patch.object(deploy, "run", return_value=None):
                    with patch.object(deploy, "unit_prop", side_effect=state):
                        with self.assertRaisesRegex(RuntimeError, "PRODUCT_UNIT_CGROUP_UNREADABLE"):
                            deploy.stop_product_units()

    def test_cgroup_path_replacement_after_directory_open_cannot_redirect_read(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryDirectory() as outside:
            root=Path(directory)
            group=root/"system.slice"/"seller-agents-owner-test-api.service"
            group.mkdir(parents=True)
            (group/"cgroup.procs").write_text("")
            outside_group=Path(outside)
            (outside_group/"cgroup.procs").write_text("4321\n")
            old_group=group.with_name(group.name+".opened")
            swapped=False
            real_open=os.open
            def pinned_open(path, flags, mode=0o777, *, dir_fd=None):
                nonlocal swapped
                if path == "cgroup.procs" and dir_fd is not None and not swapped:
                    group.rename(old_group)
                    group.symlink_to(outside_group, target_is_directory=True)
                    swapped=True
                return real_open(path, flags, mode, dir_fd=dir_fd)
            def state(unit, prop):
                if prop == "ControlGroup" and unit == deploy.UNITS[0]:
                    return "/system.slice/seller-agents-owner-test-api.service"
                return self.inactive_state(unit, prop)
            with patch.object(deploy, "CGROUP_ROOT", root):
                with patch.object(deploy.os, "open", side_effect=pinned_open):
                    with patch.object(deploy, "run", return_value=None):
                        with patch.object(deploy, "unit_prop", side_effect=state):
                            result=deploy.stop_product_units()
            self.assertTrue(swapped)
            self.assertEqual(result[deploy.UNITS[0]]["cgroupPids"], [])

    def test_missing_cgroup_after_stop_is_allowed_and_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            def state(unit, prop):
                if prop == "ControlGroup" and unit == deploy.UNITS[0]:
                    return "/system.slice/seller-agents-owner-test-api.service"
                return self.inactive_state(unit, prop)
            with patch.object(deploy, "CGROUP_ROOT", root):
                with patch.object(deploy, "run", return_value=None):
                    with patch.object(deploy, "unit_prop", side_effect=state):
                        result=deploy.stop_product_units()
        self.assertEqual(result[deploy.UNITS[0]]["load"], "masked")
        self.assertEqual(result[deploy.UNITS[0]]["mainPid"], "0")
        self.assertEqual(result[deploy.UNITS[0]]["cgroupPids"], [])

    def test_empty_existing_cgroup_is_recorded(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            group=root/"system.slice"/"seller-agents-owner-test-api.service"
            group.mkdir(parents=True)
            (group/"cgroup.procs").write_text("")
            def state(unit, prop):
                if prop == "ControlGroup" and unit == deploy.UNITS[0]:
                    return "/system.slice/seller-agents-owner-test-api.service"
                return self.inactive_state(unit, prop)
            with patch.object(deploy, "CGROUP_ROOT", root):
                with patch.object(deploy, "run", return_value=None):
                    with patch.object(deploy, "unit_prop", side_effect=state):
                        result=deploy.stop_product_units()
        self.assertEqual(result[deploy.UNITS[0]]["cgroupPids"], [])

    def test_start_unmasks_all_units_before_any_start(self):
        masked=set(deploy.UNITS)
        commands=[]
        def command(args, **kwargs):
            commands.append(tuple(args))
            if args[1:3] == ["unmask", "--runtime"]:
                masked.discard(args[-1])
            if args[1] == "start" and masked:
                raise AssertionError("START_BEFORE_ALL_UNMASKED")
        def state(unit, prop):
            if prop == "LoadState":
                return "masked" if unit in masked else "loaded"
            return "unchanged"
        with patch.object(deploy, "run", side_effect=command):
            with patch.object(deploy, "unit_prop", side_effect=state):
                deploy.start_product_units()
        self.assertEqual([x[-1] for x in commands[:len(deploy.UNITS)]], deploy.UNITS)
        self.assertTrue(all(x[1] == "unmask" for x in commands[:len(deploy.UNITS)]))
        self.assertTrue(all(x[1] == "start" for x in commands[len(deploy.UNITS):]))




class LegacyArchiveInputStreamingTests(unittest.TestCase):
    """Synthetic only: no Docker, PostgreSQL, systemd, network or real credentials."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="octoport-b-pgstream-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.archive = self.root / "fake-archive.dump"
        self.archive.write_bytes(b"synthetic pg_restore stdin fixture")

    def test_run_streams_file_descriptor_without_full_bytes_read(self):
        observations = {}

        def fake_process(args, **kwargs):
            source = kwargs.get("stdin")
            self.assertIsNotNone(source)
            self.assertFalse(source.closed)
            self.assertIsNone(kwargs.get("input"))
            observations["sample"] = source.read()
            observations["source"] = source
            return deploy.subprocess.CompletedProcess(args, 0, stdout=b"", stderr=b"")

        with patch.object(deploy.subprocess, "run", side_effect=fake_process):
            with patch.object(
                Path, "read_bytes", side_effect=AssertionError("FULL_BACKUP_READ")
            ) as full_read:
                result = deploy.run(
                    ["docker", "exec", "-i", "synthetic-container", "pg_restore"],
                    stdin_file=self.archive,
                    timeout=8,
                )
            full_read.assert_not_called()
        self.assertEqual(result.returncode, 0)
        self.assertEqual(observations["sample"], b"synthetic pg_restore stdin fixture")
        self.assertTrue(observations["source"].closed)

    def test_real_finite_child_receives_archive_bytes_from_file(self):
        # This is a local Python echo child, not docker, a database or a service.
        child = deploy.run(
            [deploy.sys.executable, "-B", "-c",
             "import sys; sys.stdout.buffer.write(sys.stdin.buffer.read())"],
            stdin_file=self.archive, timeout=5,
        )
        self.assertEqual(child.returncode, 0)
        self.assertEqual(child.stdout, b"synthetic pg_restore stdin fixture")

    def test_unavailable_archive_fails_before_starting_child(self):
        missing = self.root / "missing.dump"
        with patch.object(deploy.subprocess, "run") as started:
            with self.assertRaises(FileNotFoundError):
                deploy.run(["not-started"], stdin_file=missing)
            started.assert_not_called()

    def test_docker_pg_passes_file_stdin_with_interactive_flag(self):
        with patch.object(deploy, "run", return_value=None) as command:
            deploy.docker_pg(["pg_restore", "--list"], stdin_file=self.archive, timeout=60)
        self.assertEqual(
            command.call_args.args[0][:4],
            ["docker", "exec", "-i", deploy.DB_CONTAINER],
        )
        self.assertEqual(command.call_args.kwargs["stdin_file"], self.archive)
        self.assertIsNone(command.call_args.kwargs["input_bytes"])

    def test_run_rejects_ambiguous_stdin_before_any_subprocess(self):
        with patch.object(deploy.subprocess, "run") as launched:
            with self.assertRaisesRegex(RuntimeError, "RUN_STDIN_AMBIGUOUS"):
                deploy.run(["unused"], input_bytes=b"bytes", stdin_file=self.archive)
            launched.assert_not_called()

    def test_backup_live_streams_its_pg_restore_archive_check(self):
        events = []

        def fake_docker(args, **kwargs):
            events.append((list(args), dict(kwargs)))
            if args[0] == "pg_dump":
                kwargs["stdout_file"].write_bytes(b"synthetic dump")
            return deploy.subprocess.CompletedProcess(args, 0, stdout=b"", stderr=b"")

        with patch.object(deploy, "BACKUPS", self.root / "backups"):
            with patch.object(deploy, "docker_pg", side_effect=fake_docker):
                with patch.object(
                    Path, "read_bytes", side_effect=AssertionError("FULL_BACKUP_READ")
                ) as full_read:
                    result = deploy.backup_live("fixture", "fixture_db", "safe")
                full_read.assert_not_called()
        self.assertEqual(len(events), 2)
        self.assertEqual(events[0][0][0], "pg_dump")
        self.assertEqual(events[1][0][:2], ["pg_restore", "--list"])
        self.assertEqual(events[1][1].get("stdin_file"), result)
        self.assertNotIn("input_bytes", events[1][1])

    def test_isolated_restore_streams_archive_and_retains_cleanup(self):
        events = []

        def fake_docker(args, **kwargs):
            events.append((list(args), dict(kwargs)))
            return deploy.subprocess.CompletedProcess(args, 0, stdout=b"", stderr=b"")

        def prefix(url, count):
            return {"applied": count}

        with patch.object(deploy, "docker_pg", side_effect=fake_docker):
            with patch.object(deploy, "check_migration_prefix", side_effect=prefix):
                with patch.object(deploy, "migrate", return_value=None):
                    with patch.object(
                        Path, "read_bytes", side_effect=AssertionError("FULL_BACKUP_READ")
                    ) as full_read:
                        result = deploy.restore_isolated(
                            "fixture", "postgres://fixture@127.0.0.1/fixture",
                            self.archive, "20261017T040000Z",
                        )
                    full_read.assert_not_called()
        self.assertEqual((result["before"], result["after"]), (22, 40))
        self.assertEqual([x[0][0] for x in events],
                         ["createdb", "pg_restore", "dropdb"])
        self.assertEqual(events[1][1].get("stdin_file"), self.archive)
        self.assertEqual(events[-1][0][:3], ["dropdb", "--if-exists", "--force"])

    def test_legacy_rollback_restores_from_stream_without_full_read(self):
        events = []

        def fake_docker(args, **kwargs):
            events.append((list(args), dict(kwargs)))
            return deploy.subprocess.CompletedProcess(args, 0, stdout=b"", stderr=b"")

        with patch.object(deploy, "docker_pg", side_effect=fake_docker):
            with patch.object(deploy, "docker_psql_scalar", return_value="22"):
                with patch.object(
                    Path, "read_bytes", side_effect=AssertionError("FULL_BACKUP_READ")
                ) as full_read:
                    count = deploy.restore_live_backup(
                        "fixture", "fixture_db", self.archive,
                        {"encoding": "UTF8", "collate": "C", "ctype": "C"},
                    )
                full_read.assert_not_called()
        self.assertEqual(count, 22)
        self.assertEqual([x[0][0] for x in events],
                         ["dropdb", "createdb", "pg_restore"])
        self.assertEqual(events[2][1].get("stdin_file"), self.archive)
        self.assertNotIn("input_bytes", events[2][1])


class NativeServerOperationsCoverage(unittest.TestCase):
    def test_server_ci_targets_actual_ops_sources_and_runs_their_tests(self):
        workflow = (
            Path(__file__).resolve().parents[2] / ".github/workflows/server-ci.yml"
        ).read_text()
        self.assertIn("  pull_request:\n    paths:\n", workflow)
        pr_paths = workflow.split("  pull_request:\n    paths:\n", 1)[1].split(
            "\n  push:\n", 1
        )[0]
        for relative in (
            "tooling/operations/verify_ops_release.py",
            "tooling/operations/test_verify_ops_release.py",
            "tooling/operations/deploy_owner_test.py",
            "tooling/operations/test_deploy_owner_test.py",
        ):
            with self.subTest(path=relative):
                self.assertIn('      - "' + relative + '"', pr_paths)
        for name in ("test_verify_ops_release.py", "test_deploy_owner_test.py"):
            with self.subTest(test=name):
                self.assertIn(
                    "python3 -B -m unittest discover -s tooling/operations "
                    "-p '" + name + "' -v",
                    workflow,
                )
        # The verifier is intentionally root-only; exercise actual root-owned
        # fixtures on the disposable CI runner without passing workflow secrets.
        self.assertIn(
            "sudo -n env -i HOME=/tmp PATH=/usr/bin:/bin /usr/bin/python3 -B "
            "-m unittest discover -s tooling/operations "
            "-p 'test_verify_ops_release.py' -v",
            workflow,
        )


class CurrentMigrationSettlementTests(unittest.TestCase):
    def apply_case(self):
        case=CurrentApplyEngineTests("test_success_migrates_before_switch_and_records_target")
        case.setUp();self.addCleanup(case.doCleanups)
        return case

    def recovery_case(self, schema="UNKNOWN"):
        case=CurrentCrashRecoveryTests("test_identity_mismatch_fails_before_quiesce")
        case.setUp();self.addCleanup(case.doCleanups)
        case.write_state(schema)
        return case

    def test_timeout_surviving_child_delayed_commit_never_admits_baseline(self):
        # A real owned disposable child models the surviving tsx migration
        # process. Its file is a synthetic committed ledger, not a PostgreSQL DB.
        import subprocess,sys,time
        case=self.apply_case()
        evidence=case.root/"apply-surviving-child";evidence.mkdir()
        journal=case.root/"deployment-state.json"
        ledger=case.root/"committed-prefix";ledger.write_text("17")
        release=case.root/"allow-child-commit"
        child_code=(
            "import sys,time;from pathlib import Path;"
            "ledger=Path(sys.argv[1]);gate=Path(sys.argv[2]);"
            "deadline=time.monotonic()+5\n"
            "while not gate.exists() and time.monotonic()<deadline:time.sleep(.01)\n"
            "if not gate.exists():sys.exit(2)\n"
            "ledger.write_text('50')\n"
        )
        child=subprocess.Popen([sys.executable,"-c",child_code,str(ledger),str(release)],
                               stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        def timed_out(*args):
            self.assertIsNone(child.poll())
            raise subprocess.TimeoutExpired(["owned-synthetic-tsx-parent"],.01)
        try:
            with case.patches(),patch.object(deploy,"migrate",side_effect=timed_out):
                with self.assertRaises(subprocess.TimeoutExpired):
                    deploy.current_apply_engine(
                        candidate_release=case.release,expected_source_sha="a"*40,
                        expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                        evidence_root=case.root,journal=journal,evidence_dir=evidence)
            self.assertEqual(ledger.read_text(),"17")
            self.assertIsNone(child.poll(),"child really survives the reported timeout")
            saved=json.loads(journal.read_text())
            events_before_commit=list(case.events)
        finally:
            release.touch()
            try:child.wait(timeout=6)
            finally:
                if child.poll() is None:child.kill();child.wait(timeout=2)
        self.assertEqual(child.returncode,0)
        self.assertEqual(ledger.read_text(),"50","old committed prefix was not settlement")
        self.assertTrue(saved["recoveryRequired"])
        self.assertEqual(saved["schemaState"],"UNKNOWN")
        self.assertFalse(any(e[0] in ("fence-allow","restore-units","fence-remove","start") for e in events_before_commit))

    def test_old_prefix_after_crash_does_not_settle_original_run(self):
        case=self.recovery_case();events=[]
        before={p:p.read_bytes() for p in (case.journal,case.evidence/"receipt.json")}
        with case.patch_common(events),patch.object(deploy,"current_restore_live_backup") as restore:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                case.recover_forward_target()
        restore.assert_not_called()
        self.assertEqual(events,[])
        self.assertEqual(before,{p:p.read_bytes() for p in before})

    def test_legacy_predeploy_projection_without_settlement_never_restarts(self):
        case=self.recovery_case("PREDEPLOY_VERIFIED");events=[]
        for p in (case.journal,case.evidence/"receipt.json"):
            value=json.loads(p.read_text());value.pop("migrationSettlement",None)
            value.update(phase="BASELINE_START_REQUESTED",applicationMayHaveWritten=True)
            p.write_text(json.dumps(value))
        with case.patch_common(events):
            with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                case.recover_forward_target()
        self.assertEqual(events,[])


    def test_success_completion_is_durable_before_first_candidate_start(self):
        case=self.apply_case();evidence=case.root/"apply-completed";evidence.mkdir()
        journal=case.root/"deployment-state.json"
        seen=[]
        def start(plan):
            records=[json.loads(p.read_text()) for p in (journal,evidence/"receipt.json")]
            self.assertEqual(records[0]["migrationSettlement"],records[1]["migrationSettlement"])
            for value in records:
                self.assertEqual(value["migrationSettlement"]["outcome"],"COMPLETED")
                self.assertEqual(value["schemaState"],"CANDIDATE_VERIFIED")
            seen.append(True)
        with case.patches(),patch.object(deploy,"current_start_product_units",side_effect=start):
            result=deploy.current_apply_engine(
                candidate_release=case.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=case.root,journal=journal,evidence_dir=evidence)
        self.assertEqual(result["status"],"APPLY_PASS")
        self.assertEqual(seen,[True])

    def test_torn_missing_or_invalid_completion_never_admits_forward_target(self):
        cases=[
            ("both",None,None),("journal",None,None),("receipt",None,None),
            ("both","protocol",True),("both","protocol",2),
            ("both","intentId","invalid"),("journal","intentId","e"*32),
            ("both","outcome","UNCONFIRMED"),("journal","outcome","UNCONFIRMED"),
            ("receipt","outcome","UNCONFIRMED"),("both","outcome","NOT_STARTED"),
            ("both","extra","unrecognized"),
        ]
        for which,key,value in cases:
            with self.subTest(record=which,key=key,value=value):
                case=self.recovery_case("CANDIDATE_VERIFIED");events=[]
                paths=[case.journal,case.evidence/"receipt.json"]
                selected=paths if which=="both" else [paths[0 if which=="journal" else 1]]
                for p in selected:
                    payload=json.loads(p.read_text())
                    if key is None:payload.pop("migrationSettlement")
                    else:payload["migrationSettlement"][key]=value
                    p.write_text(json.dumps(payload))
                before={p:p.read_bytes() for p in paths}
                with case.patch_common(events),patch.object(deploy,"current_validate_base_units") as validate:
                    with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                        case.recover_forward_target()
                validate.assert_not_called()
                self.assertEqual(events,[])
                self.assertEqual(before,{p:p.read_bytes() for p in paths})

    def test_loss_before_completed_record_cannot_be_repaired_from_target_prefix(self):
        case=self.apply_case();evidence=case.root/"apply-completed-write-loss";evidence.mkdir()
        journal=case.root/"deployment-state.json"
        real_write=deploy.write_json_durable
        class PowerLoss(BaseException):pass
        def crash(path,value):
            if value.get("migrationSettlement",{}).get("outcome")=="COMPLETED":
                raise PowerLoss("completion not durable")
            return real_write(path,value)
        with case.patches(),patch.object(deploy,"write_json_durable",side_effect=crash):
            with self.assertRaises(PowerLoss):
                deploy.current_apply_engine(
                    candidate_release=case.release,expected_source_sha="a"*40,
                    expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                    evidence_root=case.root,journal=journal,evidence_dir=evidence)
        self.assertEqual(case.prefix,50)
        for p in (journal,evidence/"receipt.json"):
            value=json.loads(p.read_text())
            self.assertEqual(value["schemaState"],"UNKNOWN")
            self.assertEqual(value["migrationSettlement"]["outcome"],"UNCONFIRMED")
        before={p:p.read_bytes() for p in (journal,evidence/"receipt.json")}
        events_before=list(case.events)
        with case.patches():
            with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                deploy.current_recover_engine(
                    candidate_release=case.release,expected_source_sha="a"*40,
                    expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                    evidence_root=case.root,journal=journal)
        self.assertEqual(before,{p:p.read_bytes() for p in before})
        self.assertEqual(case.events,events_before)

class CurrentFourServiceSourcePlanTests(unittest.TestCase):
    """Pure source contract only: no systemd, DB, network or credentials."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="octoport-four-plan-")
        self.addCleanup(self.temp.cleanup)
        self.release = Path(self.temp.name) / ("a" * 40)
        journal = self.release / "packages/server/db/drizzle/meta"
        journal.mkdir(parents=True)
        (journal / "_journal.json").write_text(json.dumps({
            "entries": [
                {"idx": 0, "tag": "0000_first"},
                {"idx": 1, "tag": "0001_second"},
                {"idx": 2, "tag": "0061_latest"},
            ]
        }))

    def test_migration_target_is_derived_from_packaged_journal(self):
        self.assertEqual(
            deploy.migration_target_from_verified_release(self.release),
            {"count": 3, "latestIndex": 2, "latestTag": "0061_latest"},
        )

    def test_migration_target_rejects_gaps_duplicates_and_symlink(self):
        journal = self.release / deploy.MIGRATION_JOURNAL
        bad = [
            {"entries": [{"idx": 1, "tag": "bad"}]},
            {"entries": [{"idx": 0, "tag": "same"}, {"idx": 1, "tag": "same"}]},
            {"entries": []},
        ]
        for value in bad:
            with self.subTest(value=value):
                journal.write_text(json.dumps(value))
                with self.assertRaisesRegex(RuntimeError, "MIGRATION_JOURNAL_INVALID"):
                    deploy.migration_target_from_verified_release(self.release)
        journal.unlink()
        target = self.release / "outside.json"
        target.write_text(json.dumps({"entries": [{"idx": 0, "tag": "ok"}]}))
        journal.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError, "MIGRATION_JOURNAL_INVALID"):
            deploy.migration_target_from_verified_release(self.release)

    def test_four_service_plan_uses_compiled_entries_env_scope_and_identity_authority(self):
        canonical = Path("/opt/octoport/ops-releases") / ("a" * 40)
        with patch.object(
            deploy,
            "migration_target_from_verified_release",
            return_value={"count": 3, "latestIndex": 2, "latestTag": "0061_latest"},
        ):
            plan = deploy.four_service_source_plan(canonical)
        self.assertEqual(set(plan["services"]), {"api", "worker", "portal", "admin"})
        api = plan["services"]["api"]
        worker = plan["services"]["worker"]
        admin = plan["services"]["admin"]
        self.assertTrue(api["execArgv"][-1].endswith("/apps/api/dist/main.js"))
        self.assertTrue(worker["execArgv"][-1].endswith("/apps/worker/dist/main.js"))
        self.assertNotIn("/src/main.ts", " ".join(api["execArgv"] + worker["execArgv"]))
        self.assertEqual(
            api["environmentFiles"],
            [
                "/etc/seller-agents-owner-test/api.env",
                "/etc/seller-agents-owner-test/api-monitor.env",
            ],
        )
        self.assertEqual(worker["environmentFiles"], ["/etc/seller-agents-owner-test/api.env"])
        self.assertEqual(admin["environmentFiles"], [])
        self.assertEqual(admin["identity"], {"mode": "DYNAMIC_USER"})
        identities = deploy.canonical_identities()
        self.assertEqual(api["identity"]["user"], identities["api"]["user"])
        self.assertEqual(plan["migrationTarget"]["count"], 3)
        self.assertFalse(plan["liveMutationPerformed"])


    def test_verified_current_source_plan_requires_exact_package_identity(self):
        canonical = Path("/opt/octoport/ops-releases") / ("a" * 40)
        verified = {
            "status": "PASS_SOURCE_PACKAGE_ONLY",
            "sourceSha": "a" * 40,
            "sourceTree": "b" * 40,
            "services": ["admin", "api", "portal", "worker"],
        }
        source_plan = {
            "status": "SOURCE_PLAN_PASS",
            "release": str(canonical),
            "services": {
                role: {"unit": f"seller-agents-owner-test-{role}.service"}
                for role in ("api", "worker", "portal", "admin")
            },
            "migrationTarget": {"count": 50, "latestIndex": 49, "latestTag": "0061_latest"},
            "liveMutationPerformed": False,
        }
        with patch.object(deploy, "verify_owner_test_release", return_value=verified) as gate:
            with patch.object(deploy, "four_service_source_plan", return_value=source_plan):
                result = deploy.verified_current_source_plan(
                    canonical,
                    expected_source_sha="a" * 40,
                    expected_source_tree="b" * 40,
                    expected_inventory_sha256="c" * 64,
                )
        gate.assert_called_once()
        self.assertEqual(result["status"], "CURRENT_FOUR_SERVICE_SOURCE_PLAN_PASS")
        self.assertEqual(result["migrationTarget"]["count"], 50)
        self.assertFalse(result["liveMutationPerformed"])
        self.assertFalse(result["databaseReadPerformed"])
        self.assertFalse(result["secretMaterialRead"])

        wrong = dict(verified, sourceSha="d" * 40)
        with patch.object(deploy, "verify_owner_test_release", return_value=wrong):
            with patch.object(deploy, "four_service_source_plan", return_value=source_plan):
                with self.assertRaisesRegex(RuntimeError, "CURRENT_PACKAGE_IDENTITY_MISMATCH"):
                    deploy.verified_current_source_plan(
                        canonical,
                        expected_source_sha="a" * 40,
                        expected_source_tree="b" * 40,
                        expected_inventory_sha256="c" * 64,
                    )

class CurrentMigrationPrefixWiringTests(unittest.TestCase):
    def test_generic_prefix_checker_uses_exact_release_runtime_and_env(self):
        release = Path("/opt/octoport/ops-releases") / ("a" * 40)
        completed = deploy.subprocess.CompletedProcess(
            ["node"], 0, stdout=b'{"status":"PASS_PREFIX","applied":17,"latest":"x"}\n', stderr=b""
        )
        with patch.object(deploy, "run", return_value=completed) as command:
            value = deploy.check_migration_prefix_for_release(
                release, "postgres://fixture@localhost/db"
            )
        self.assertEqual(value["applied"], 17)
        args = command.call_args.args[0]
        kwargs = command.call_args.kwargs
        self.assertEqual(args[0], str(release / ".runtime/node"))
        self.assertEqual(args[1], str(release / deploy.TSX))
        self.assertEqual(kwargs["cwd"], str(release))
        self.assertEqual(kwargs["env"]["OCTOPORT_RELEASE_ROOT"], str(release))
        self.assertEqual(kwargs["env"]["DATABASE_URL"], "postgres://fixture@localhost/db")

    def test_generic_prefix_checker_fails_on_wrong_expected_count(self):
        release = Path("/opt/octoport/ops-releases") / ("a" * 40)
        completed = deploy.subprocess.CompletedProcess(
            ["node"], 0, stdout=b'{"status":"PASS_PREFIX","applied":17}\n', stderr=b""
        )
        with patch.object(deploy, "run", return_value=completed):
            with self.assertRaisesRegex(RuntimeError, "MIGRATION_PREFIX_COUNT_INVALID"):
                deploy.check_migration_prefix_for_release(
                    release, "postgres://fixture@localhost/db", expected_count=18
                )

    def test_checker_source_has_no_pinned_legacy_release(self):
        source = Path(deploy.__file__).with_name("check_owner_test_migration_prefix.ts").read_text()
        self.assertIn("OCTOPORT_RELEASE_ROOT", source)
        self.assertIn("pathToFileURL", source)
        self.assertIn("realpath(release)", source)
        self.assertIn("lstat(path)", source)
        self.assertIn('"/opt/octoport/ops-releases"', source)
        self.assertNotIn("62024d192a8572c11aafab91653330d1f996699f", source)


class CurrentFourServiceRuntimeSwitchTests(unittest.TestCase):
    def plan(self):
        root="/opt/octoport/ops-releases/"+"a"*40
        services={}
        for role in ("api","worker","portal","admin"):
            services[role]={
                "unit":f"seller-agents-owner-test-{role}.service",
                "workingDirectory":root if role in ("api","worker") else f"{root}/apps/{role}",
                "execArgv":[f"{root}/.runtime/node",f"{root}/apps/{role}/dist/main.js"],
                "environmentFiles":[],
                "identity":{"mode":"DYNAMIC_USER" if role=="admin" else "STATIC_CANONICAL"},
            }
        return {"services":services,"adminBuildBasePath":""}

    def test_current_units_and_dropins_cover_four_compiled_services(self):
        plan=self.plan()
        self.assertEqual(
            deploy.current_units(plan),
            tuple(f"seller-agents-owner-test-{r}.service" for r in ("api","worker","portal","admin")),
        )
        for role in plan["services"]:
            text=deploy.current_unit_dropin(plan,role)
            self.assertIn("WorkingDirectory=",text)
            self.assertIn("ExecStart=",text)
            self.assertNotIn("/src/main.ts",text)
        self.assertIn("admin.service.d",str(deploy.current_dropin_paths(plan)["admin"]))

    def test_start_unmasks_all_four_before_any_start(self):
        plan=self.plan(); masked=set(deploy.current_units(plan)); calls=[]
        def command(args,**kwargs):
            calls.append(tuple(args))
            if args[1:3]==["unmask","--runtime"]: masked.discard(args[-1])
            if args[1]=="start" and masked: raise AssertionError("START_BEFORE_ALL_UNMASKED")
            return deploy.subprocess.CompletedProcess(args,0,stdout=b"",stderr=b"")
        def prop(unit,name):
            if name=="LoadState": return "masked" if unit in masked else "loaded"
            return "unchanged"
        with patch.object(deploy,"run",side_effect=command), patch.object(deploy,"unit_prop",side_effect=prop):
            deploy.current_start_product_units(plan)
        units=deploy.current_units(plan)
        self.assertEqual([x[-1] for x in calls[:len(units)]],list(units))
        self.assertEqual([x[-1] for x in calls[len(units):]],list(units))

    def test_current_health_requires_all_four_and_admin_login(self):
        plan=self.plan()
        def prop(unit,name):
            if name=="ActiveState": return "active"
            if name=="SubState": return "running"
            raise AssertionError((unit,name))
        def http(url):
            self.assertTrue(
                url.endswith("/health/live") or url.endswith("/health/ready")
                or url=="http://127.0.0.1:3100/login"
                or url=="http://127.0.0.1:3101/login"
            )
            return (200,"")
        completed=deploy.subprocess.CompletedProcess(["journalctl"],0,stdout=b"Worker ready\n",stderr=b"")
        with patch.object(deploy,"unit_prop",side_effect=prop),              patch.object(deploy,"env_value",return_value="3000"),              patch.object(deploy,"http_status",side_effect=http),              patch.object(deploy,"run",return_value=completed):
            result=deploy.current_wait_runtime(plan,"now")
        self.assertEqual(result["admin"],200)
        self.assertTrue(result["workerReady"])

    def test_current_loaded_plan_rejects_wrong_exec_or_workdir(self):
        plan=self.plan(); role="api"; item=plan["services"][role]
        def good(unit,name):
            source=next(v for v in plan["services"].values() if v["unit"]==unit)
            if name=="WorkingDirectory": return source["workingDirectory"]
            if name=="ExecStart":
                return "{ path="+source["execArgv"][0]+" ; argv[]="+" ".join(source["execArgv"])+" ; ignore_errors=no ; }"
            raise AssertionError(name)
        with patch.object(deploy,"unit_prop",side_effect=good):
            result=deploy.current_verify_loaded_plan(plan)
        self.assertEqual(set(result),{"api","worker","portal","admin"})
        def bad(unit,name):
            if unit==item["unit"] and name=="WorkingDirectory": return "/wrong"
            return good(unit,name)
        with patch.object(deploy,"unit_prop",side_effect=bad):
            with self.assertRaisesRegex(RuntimeError,"CURRENT_LOADED_WORKING_DIRECTORY_MISMATCH"):
                deploy.current_verify_loaded_plan(plan)
        def extra(unit,name):
            value=good(unit,name)
            if unit==item["unit"] and name=="ExecStart":
                return value.replace(" ; ignore_errors=no", " --unexpected ; ignore_errors=no")
            return value
        with patch.object(deploy,"unit_prop",side_effect=extra):
            with self.assertRaisesRegex(RuntimeError,"CURRENT_LOADED_EXECSTART_MISMATCH"):
                deploy.current_verify_loaded_plan(plan)


class CurrentRollbackBaselineTests(unittest.TestCase):
    def plan(self):
        root="/opt/octoport/ops-releases/"+"a"*40
        return {"services":{
            role:{
                "unit":f"seller-agents-owner-test-{role}.service",
                "workingDirectory":root,
                "execArgv":[f"{root}/.runtime/node",f"{root}/{role}.js"],
            }
            for role in ("api","worker","portal","admin")
        }}

    def test_dropin_snapshot_restore_preserves_present_and_absent(self):
        plan=self.plan()
        root=Path(tempfile.mkdtemp(prefix="octoport-dropin-baseline-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(root,ignore_errors=True))
        drop_root=root/"systemd"; backup=root/"backup"
        original=deploy.CURRENT_DROPIN_ROOT
        deploy.CURRENT_DROPIN_ROOT=drop_root
        try:
            paths=deploy.current_dropin_paths(plan)
            paths["api"].parent.mkdir(parents=True)
            paths["api"].write_text("old-api")
            os.chmod(paths["api"],0o640)
            with patch.object(deploy,"run",return_value=deploy.subprocess.CompletedProcess([],0,stdout=b"",stderr=b"")):
                manifest=deploy.current_snapshot_dropins(plan,backup)
                self.assertTrue(manifest["api"]["present"])
                self.assertFalse(manifest["admin"]["present"])
                for path in paths.values():
                    path.parent.mkdir(parents=True,exist_ok=True)
                    path.write_text("candidate")
                    os.chmod(path,0o644)
                deploy.current_restore_dropins(plan,backup)
            self.assertEqual(paths["api"].read_text(),"old-api")
            self.assertEqual(os.stat(paths["api"]).st_mode & 0o777,0o640)
            self.assertFalse(paths["admin"].exists())
            self.assertFalse(paths["worker"].exists())
            self.assertFalse(paths["portal"].exists())
        finally:
            deploy.CURRENT_DROPIN_ROOT=original

    def test_unit_state_restore_preserves_inactive_and_masked(self):
        plan=self.plan(); units=deploy.current_units(plan)
        baseline={
            units[0]:{"load":"loaded","active":"active","sub":"running"},
            units[1]:{"load":"loaded","active":"inactive","sub":"dead"},
            units[2]:{"load":"masked","active":"inactive","sub":"dead"},
            units[3]:{"load":"loaded","active":"active","sub":"running"},
        }
        state={unit:dict(value) for unit,value in baseline.items()}
        calls=[]
        def command(args,**kwargs):
            calls.append(tuple(args))
            unit=args[-1]
            if args[1:3]==["unmask","--runtime"]:
                state[unit]["load"]="loaded"
            elif args[1]=="start":
                state[unit]["active"]="active";state[unit]["sub"]="running"
            return deploy.subprocess.CompletedProcess(args,0,stdout=b"",stderr=b"")
        def prop(unit,name):
            return {"LoadState":"load","ActiveState":"active","SubState":"sub"}[name] and state[unit][{"LoadState":"load","ActiveState":"active","SubState":"sub"}[name]]
        with patch.object(deploy,"current_stop_product_units",side_effect=lambda _plan: [
            state[u].update(load="masked",active="inactive",sub="dead") for u in units
        ]), patch.object(deploy,"run",side_effect=command), patch.object(deploy,"unit_prop",side_effect=prop):
            deploy.current_restore_unit_states(plan,baseline)
        self.assertEqual(state[units[0]]["active"],"active")
        self.assertEqual(state[units[1]]["active"],"inactive")
        self.assertEqual(state[units[2]]["load"],"masked")
        self.assertEqual(state[units[3]]["active"],"active")


class CurrentApplyEngineTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="octoport-current-apply-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.release=Path("/opt/octoport/ops-releases")/("a"*40)
        self.plan={
            "sourceSha":"a"*40,
            "sourceTree":"b"*40,
            "trustedInventorySha256":"c"*64,
            "migrationTarget":{"count":50,"latestIndex":49,"latestTag":"0061_latest"},
            "services":{
                role:{
                    "unit":f"seller-agents-owner-test-{role}.service",
                    "workingDirectory":str(self.release),
                    "execArgv":[str(self.release/".runtime/node"),str(self.release/f"{role}.js")],
                }
                for role in ("api","worker","portal","admin")
            },
            "adminBuildBasePath":"",
        }
        self.events=[]
        self.prefix=17
        self.backup=self.root/"fresh.dump";self.backup.write_bytes(b"backup")
        self.baseline={
            unit:{"load":"loaded","active":"active","sub":"running"}
            for unit in deploy.current_units(self.plan)
        }

    def patches(self, *, health_error=None, migrate_error=None):
        def check(release,url,expected_count=None):
            self.events.append(("prefix",self.prefix,expected_count))
            if expected_count is not None and self.prefix!=expected_count:
                raise RuntimeError("PREFIX_MISMATCH")
            return {"status":"PASS_PREFIX","applied":self.prefix}
        def migrate(release,url):
            self.events.append(("migrate",self.prefix))
            self.prefix=50
            if migrate_error: raise RuntimeError(migrate_error)
        def restore(*args,**kwargs):
            self.events.append(("restore-db",self.prefix))
            self.prefix=17
            return 17
        def health(plan,started):
            self.events.append(("health",self.prefix))
            if health_error: raise RuntimeError(health_error)
            return {"live":200,"ready":200,"portal":200,"admin":200,"workerReady":True}
        replacements={
            "verified_current_source_plan":lambda *a,**k:self.plan,
            "current_validate_base_units":lambda plan:{"validated":True},
            "current_install_reboot_fence":lambda plan,**kwargs:self.events.append(("fence-install",self.prefix)),
            "current_prepare_recovery_fence":lambda plan:self.events.extend((("fence-block",self.prefix),("fence-install",self.prefix))),
            "current_enable_fenced_start":lambda:self.events.append(("fence-allow",self.prefix)),
            "current_disable_fenced_start":lambda:self.events.append(("fence-block",self.prefix)),
            "current_remove_reboot_fence":lambda plan:self.events.append(("fence-remove",self.prefix)),
            "current_verify_backup_receipt":lambda info:self.backup,
            "database_url":lambda:"postgres://fixture@localhost/db",
            "db_identity":lambda url:("fixture","pw","db",None),
            "check_migration_prefix_for_release":check,
            "current_capture_unit_states":lambda plan:self.baseline,
            "current_snapshot_dropins":lambda plan,path:(path.mkdir(parents=True),deploy.write_json_durable(path/"manifest.json",{r:{"present":False} for r in plan["services"]}))[1],
            "database_creation_meta":lambda *_:{"encoding":"UTF8","collate":"C","ctype":"C"},
            "current_stop_product_units":lambda plan:self.events.append(("stop",self.prefix)) or {},
            "backup_live":lambda *_:self.events.append(("backup",self.prefix)) or self.backup,
            "current_restore_isolated":lambda *a,**k:self.events.append(("isolated",self.prefix,k["expected_target"])) or {"before":17,"after":50},
            "migrate":migrate,
            "current_write_dropins":lambda plan:self.events.append(("write-dropins",self.prefix)),
            "current_start_product_units":lambda plan:self.events.append(("start",self.prefix)),
            "current_wait_runtime":health,
            "current_verify_loaded_plan":lambda plan:self.events.append(("loaded",self.prefix)) or {"ok":True},
            "current_restore_live_backup":restore,
            "current_restore_dropins":lambda plan,path:self.events.append(("restore-dropins",self.prefix)),
            "current_restore_unit_states":lambda plan,baseline:self.events.append(("restore-units",self.prefix)),
        }
        stack=ExitStack()
        for name,value in replacements.items():
            stack.enter_context(patch.object(deploy,name,value))
        return stack

    def test_success_migrates_before_switch_and_records_target(self):
        evidence=self.root/"apply-success";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        with self.patches():
            result=deploy.current_apply_engine(
                candidate_release=self.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=self.root,journal=journal,evidence_dir=evidence
            )
        self.assertEqual(result["status"],"APPLY_PASS")
        self.assertFalse(result["recoveryRequired"])
        self.assertEqual(result["predeployPrefix"],17)
        self.assertEqual(result["candidateTarget"],50)
        names=[e[0] for e in self.events]
        self.assertLess(names.index("backup"),names.index("migrate"))
        self.assertLess(names.index("migrate"),names.index("write-dropins"))
        self.assertLess(names.index("write-dropins"),names.index("start"))
        self.assertLess(names.index("start"),names.index("health"))



    def test_replay_protocol_is_durable_before_first_migration(self):
        evidence=self.root/"apply-protocol";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        def migrate(release,url):
            for path in (journal,evidence/"receipt.json"):
                saved=json.loads(path.read_text())
                self.assertEqual(saved["baselineRecoveryProtocol"],1)
                self.assertEqual(saved["migrationSettlement"]["outcome"],"UNCONFIRMED")
                self.assertEqual(saved["migrationSettlement"]["protocol"],1)
                self.assertEqual(saved["trustedInventorySha256"],"c"*64)
                self.assertRegex(saved["migrationSettlement"]["intentId"],r"^[0-9a-f]{32}$")
                self.assertIs(saved["applicationMayHaveWritten"],False)
                self.assertEqual(saved["schemaState"],"UNKNOWN")
                self.assertEqual(saved["phase"],"LIVE_MIGRATION")
            self.prefix=50
        with self.patches(),patch.object(deploy,"migrate",side_effect=migrate):
            deploy.current_apply_engine(
                candidate_release=self.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=self.root,journal=journal,evidence_dir=evidence,
            )


    def test_migration_error_retains_database_ownership_acl_and_rows(self):
        evidence=self.root/"apply-preserved-metadata";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        retained={"owner":"original_owner","acl":["transfer_runtime:SELECT"],"settings":["search_path=public"],"rows":["existing-session"]}
        before=json.loads(json.dumps(retained))
        def failed_migration(*args):
            # The pending migration transaction rolled back; original prefix remains.
            raise RuntimeError("MIGRATION_FAILED")
        def destructive_restore(*args,**kwargs):
            retained.update(owner="restore_user",acl=[],settings=[],rows=[])
            return 17
        with self.patches(),patch.object(deploy,"migrate",side_effect=failed_migration), \
             patch.object(deploy,"current_restore_live_backup",side_effect=destructive_restore) as restore:
            with self.assertRaisesRegex(RuntimeError,"MIGRATION_FAILED"):
                deploy.current_apply_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                    expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                    evidence_root=self.root,journal=journal,evidence_dir=evidence,
                )
        restore.assert_not_called()
        self.assertEqual(retained,before)
        self.assertNotIn(("restore-units",17),self.events)
        self.assertTrue(json.loads(journal.read_text())["recoveryRequired"])
        self.assertEqual(json.loads(journal.read_text())["migrationSettlement"]["outcome"],"UNCONFIRMED")


    def test_committed_migration_error_retains_candidate_schema_for_forward_recovery(self):
        evidence=self.root/"apply-commit-response-loss";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        with self.patches(migrate_error="COMMIT_RESPONSE_LOST"), \
             patch.object(deploy,"current_restore_live_backup") as restore:
            with self.assertRaisesRegex(RuntimeError,"COMMIT_RESPONSE_LOST"):
                deploy.current_apply_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                    expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                    evidence_root=self.root,journal=journal,evidence_dir=evidence,
                )
        restore.assert_not_called()
        self.assertEqual(self.prefix,50)
        self.assertNotIn(("restore-units",50),self.events)
        saved=json.loads(journal.read_text())
        self.assertEqual(saved["schemaState"],"UNKNOWN")
        self.assertTrue(saved["recoveryRequired"])
        self.assertEqual(saved["migrationSettlement"]["outcome"],"UNCONFIRMED")
        self.assertEqual(json.loads((evidence/"receipt.json").read_text())["rollbackError"],"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED")


    def test_auto_recovery_unknown_history_keeps_fence_without_database_replay(self):
        evidence=self.root/"apply-unconfirmed-prefix";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        calls=0
        def prefix(*args,**kwargs):
            nonlocal calls
            calls+=1
            if calls==1:return {"status":"PASS_PREFIX","applied":17}
            raise RuntimeError("HISTORY_READBACK_LOST")
        with self.patches(migrate_error="MIGRATION_FAILED"), \
             patch.object(deploy,"check_migration_prefix_for_release",side_effect=prefix), \
             patch.object(deploy,"current_restore_live_backup") as restore:
            with self.assertRaisesRegex(RuntimeError,"MIGRATION_FAILED"):
                deploy.current_apply_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                    expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                    evidence_root=self.root,journal=journal,evidence_dir=evidence,
                )
        restore.assert_not_called()
        self.assertFalse(any(e[0] in ("restore-units","fence-allow","start") for e in self.events))
        saved=json.loads(journal.read_text())
        self.assertEqual(saved["schemaState"],"UNKNOWN")
        self.assertTrue(saved["recoveryRequired"])

    def test_post_start_failure_preserves_new_device_session_rows(self):
        evidence=self.root/"apply-new-session";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        retained=[]
        def start(plan):
            self.events.append(("start-with-write",self.prefix))
            self.assertTrue(json.loads(journal.read_text())["applicationMayHaveWritten"])
            retained.append({"device":"synthetic-new-device","session":"synthetic-new-session"})
        def destructive_restore(*args,**kwargs):
            self.events.append(("restore-db",self.prefix))
            retained.clear()
            self.prefix=17
            return 17
        with self.patches(health_error="HEALTH_FAILED"), \
             patch.object(deploy,"current_start_product_units",side_effect=start), \
             patch.object(deploy,"current_restore_live_backup",side_effect=destructive_restore):
            with self.assertRaisesRegex(RuntimeError,"HEALTH_FAILED"):
                deploy.current_apply_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                    expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                    evidence_root=self.root,journal=journal,evidence_dir=evidence,
                )
        self.assertEqual(retained,[{"device":"synthetic-new-device","session":"synthetic-new-session"}])
        self.assertNotIn("restore-db",[e[0] for e in self.events])
        self.assertNotIn("restore-units",[e[0] for e in self.events])
        state=json.loads(journal.read_text())
        self.assertTrue(state["recoveryRequired"])
        self.assertTrue(state["applicationMayHaveWritten"])
        self.assertEqual(state["schemaState"],"CANDIDATE_VERIFIED")
        self.assertEqual(self.prefix,50)

    def test_health_failure_after_start_requires_forward_recovery(self):
        evidence=self.root/"apply-health-fail";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        with self.patches(health_error="HEALTH_FAILED"):
            with self.assertRaisesRegex(RuntimeError,"HEALTH_FAILED"):
                deploy.current_apply_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=self.root,journal=journal,evidence_dir=evidence
                )
        names=[e[0] for e in self.events]
        self.assertNotIn("restore-db",names)
        self.assertNotIn("restore-dropins",names)
        self.assertNotIn("restore-units",names)
        state=json.loads(journal.read_text())
        self.assertTrue(state["recoveryRequired"])
        self.assertTrue(state["applicationMayHaveWritten"])
        self.assertEqual(state["schemaState"],"CANDIDATE_VERIFIED")

    def test_prefix_ahead_fails_before_mutation(self):
        self.prefix=51
        evidence=self.root/"apply-ahead";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        with self.patches():
            with self.assertRaisesRegex(RuntimeError,"CURRENT_PREDEPLOY_PREFIX_AHEAD_OF_CANDIDATE"):
                deploy.current_apply_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=self.root,journal=journal,evidence_dir=evidence
                )
        self.assertEqual([e[0] for e in self.events],["prefix"])

    def test_noop_schema_health_failure_does_not_restore_database(self):
        self.prefix=50
        evidence=self.root/"apply-noop";evidence.mkdir()
        journal=self.root/"deployment-state.json"
        with self.patches(health_error="HEALTH_FAILED"):
            with self.assertRaisesRegex(RuntimeError,"HEALTH_FAILED"):
                deploy.current_apply_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=self.root,journal=journal,evidence_dir=evidence
                )
        self.assertNotIn("restore-db",[e[0] for e in self.events])
        self.assertIn("restore-units",[e[0] for e in self.events])


class CurrentBaseUnitContractTests(unittest.TestCase):
    def plan(self):
        root="/opt/octoport/ops-releases/"+"a"*40
        identities=deploy.canonical_identities()
        return {"services":{
            "api":{"unit":"seller-agents-owner-test-api.service","environmentFiles":[
                "/etc/seller-agents-owner-test/api.env",
                "/etc/seller-agents-owner-test/api-monitor.env"],
                "identity":{"mode":"STATIC_CANONICAL",**identities["api"]}},
            "worker":{"unit":"seller-agents-owner-test-worker.service","environmentFiles":[
                "/etc/seller-agents-owner-test/api.env"],
                "identity":{"mode":"STATIC_CANONICAL",**identities["worker"]}},
            "portal":{"unit":"seller-agents-owner-test-portal.service","environmentFiles":[
                "/etc/seller-agents-owner-test/portal.env"],
                "identity":{"mode":"STATIC_CANONICAL",**identities["portal"]}},
            "admin":{"unit":"seller-agents-owner-test-admin.service","environmentFiles":[],
                "identity":{"mode":"DYNAMIC_USER"}},
        }}

    def test_base_units_require_exact_env_and_identity_contract(self):
        plan=self.plan(); values={}
        for role,item in plan["services"].items():
            env=" ".join(f"{x} (ignore_errors=no)" for x in item["environmentFiles"])
            identity=item["identity"]
            values[item["unit"]]={
                "LoadState":"loaded",
                "NeedDaemonReload":"no","DropInPaths":"",
                "EnvironmentFiles":env,
                "DynamicUser":"yes" if identity["mode"]=="DYNAMIC_USER" else "no",
                "User":"" if identity["mode"]=="DYNAMIC_USER" else identity["user"],
                "Group":"" if identity["mode"]=="DYNAMIC_USER" else identity["group"],
            }
        with patch.object(deploy,"unit_prop",side_effect=lambda unit,name:values[unit][name]):
            checked=deploy.current_validate_base_units(plan)
        self.assertEqual(set(checked),{"api","worker","portal","admin"})
        self.assertEqual(len(checked["api"]["environmentFiles"]),2)
        self.assertEqual(checked["admin"]["identityMode"],"DYNAMIC_USER")

        values["seller-agents-owner-test-worker.service"]["EnvironmentFiles"] += (
            " /etc/seller-agents-owner-test/api-monitor.env (ignore_errors=no)"
        )
        with patch.object(deploy,"unit_prop",side_effect=lambda unit,name:values[unit][name]):
            with self.assertRaisesRegex(RuntimeError,"CURRENT_BASE_ENVIRONMENT_SCOPE_MISMATCH:worker"):
                deploy.current_validate_base_units(plan)


    def test_later_entrypoint_overrides_rejected_before_target_mutation(self):
        plan=self.plan()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            for role in plan['services']:
                for directive in ('ExecStart=', 'WorkingDirectory=/old-release'):
                    with self.subTest(role=role,directive=directive):
                        override=root/'50-r3-0216.conf'
                        override.write_text('[Service]\n'+directive+'\n')
                        props={'NeedDaemonReload':'no','DropInPaths':str(override)}
                        with patch.object(deploy,'unit_prop',side_effect=lambda u,n:props[n]), \
                             patch.object(deploy,'run') as action:
                            with self.assertRaisesRegex(RuntimeError,'CURRENT_BASE_ENTRYPOINT_OVERRIDDEN:'+role):
                                deploy.current_validate_runtime_overrides(plan,role)
                            action.assert_not_called()
                        self.assertEqual(override.read_text(),'[Service]\n'+directive+'\n')

    def test_unrelated_late_hardening_and_earlier_entrypoint_are_preserved(self):
        plan=self.plan()
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            early=root/'05-old.conf'; early.write_text('[Service]\nExecStart=/old\n')
            late=root/'60-hardening.conf'; late.write_text('[Service]\nUser=fixture\nReadWritePaths=/owned\n')
            props={'NeedDaemonReload':'no','DropInPaths':str(early)+' '+str(late)}
            with patch.object(deploy,'unit_prop',side_effect=lambda u,n:props[n]):
                deploy.current_validate_runtime_overrides(plan,'api')
            self.assertIn('User=fixture',late.read_text())

    def test_unloaded_or_unreadable_dropin_state_is_not_accepted(self):
        plan=self.plan()
        cases=[({'NeedDaemonReload':'yes'},'CURRENT_BASE_UNIT_RELOAD_REQUIRED'),
               ({'NeedDaemonReload':'no','DropInPaths':'/missing/50-override.conf'},'CURRENT_BASE_DROPIN_INVALID'),
               ({'NeedDaemonReload':'no','DropInPaths':'relative.conf'},'CURRENT_BASE_DROPIN_INVALID')]
        for props,expected in cases:
            with self.subTest(props=props),patch.object(deploy,'unit_prop',side_effect=lambda u,n:props[n]):
                with self.assertRaisesRegex(RuntimeError,expected+':api'):
                    deploy.current_validate_runtime_overrides(plan,'api')

    def test_systemd_logical_entrypoint_lines_rejected_for_every_role(self):
        # Match systemd's logical-line boundary, including comments skipped
        # inside a continuation and a first UTF-8 BOM after the section line.
        cases = {
            'split-cwd': '[Service]\nWorkingDirectory\\\n=/var/tmp\n',
            'split-exec': '[Service]\nExecStart\\\n=/bin/true\n',
            'continued-comments': '[Service]\nWorkingDirectory\\\n # comment\\\n ; ignored\n =/var/tmp\n',
            'multiple-continuations': '[Service]\nExecStart\\\n\\\n =/bin/true\n',
            'crlf': '[Service]\r\nWorkingDirectory\\\r\n=/var/tmp\r\n',
            'bom-first-directive': '[Service]\n\ufeffWorkingDirectory=/var/tmp\n',
            'bom-split-directive': '\ufeff[Service]\nExecStart\\\n=/bin/true\n',
            'comment-cannot-hide-directive': '[Service]\n# ignored\\\nExecStart=/bin/true\n',
            'even-backslashes-end-line': '[Service]\nEnvironment=FIXTURE=two\\\\\nWorkingDirectory=/var/tmp\n',
            'continued-eof': '[Service]\nWorkingDirectory=/var/tmp\\',
        }
        plan = self.plan()
        with tempfile.TemporaryDirectory() as temp:
            override = Path(temp)/'50-runtime.conf'
            for role in plan['services']:
                for name, text in cases.items():
                    with self.subTest(role=role, case=name):
                        original = text.encode('utf-8')
                        override.write_bytes(original)
                        props = {'NeedDaemonReload':'no', 'DropInPaths':str(override)}
                        with patch.object(deploy,'unit_prop',side_effect=lambda u,n:props[n]), \
                             patch.object(deploy,'run') as action:
                            with self.assertRaisesRegex(RuntimeError,'CURRENT_BASE_ENTRYPOINT_OVERRIDDEN:'+role):
                                deploy.current_validate_runtime_overrides(plan,role)
                            action.assert_not_called()
                        self.assertEqual(override.read_bytes(),original)

    def test_systemd_benign_logical_lines_preserve_hardening_and_comments(self):
        cases = {
            'hardening': '[Service]\nNoNewPrivileges=yes\nReadWritePaths=/owned\\\n /other\n',
            'hardening-comments': '[Service]\nReadWritePaths=/owned\\\n# comment\\\n ; ignored\n /other\n',
            'environment-value-not-directive': '[Service]\nEnvironment=FIXTURE=value\\\nWorkingDirectory=/inert\n',
            'comments': '[Service]\n # WorkingDirectory\\\n ; ExecStart=/inert\nNoNewPrivileges=yes\n',
            'blank-ends-continuation': '[Service]\nWorkingDirectory\\\n\n=/var/tmp\n',
            'escaped-backslash-not-continuation': '[Service]\nEnvironment=FIXTURE=two\\\\\nNoNewPrivileges=yes\n',
            'whitespace-after-backslash': '[Service]\nWorkingDirectory\\ \n=/var/tmp\n',
            'continued-benign-eof': '[Service]\nReadWritePaths=/owned\\',
        }
        with tempfile.TemporaryDirectory() as temp:
            override = Path(temp)/'60-hardening.conf'
            for name, text in cases.items():
                with self.subTest(case=name):
                    original = text.encode('utf-8')
                    override.write_bytes(original)
                    props = {'NeedDaemonReload':'no', 'DropInPaths':str(override)}
                    with patch.object(deploy,'unit_prop',side_effect=lambda u,n:props[n]), \
                         patch.object(deploy,'run') as action:
                        deploy.current_validate_runtime_overrides(self.plan(),'api')
                        action.assert_not_called()
                    self.assertEqual(override.read_bytes(),original)

    def test_systemd_nul_is_invalid_instead_of_hiding_an_entrypoint(self):
        with tempfile.TemporaryDirectory() as temp:
            override = Path(temp)/'50-runtime.conf'
            original = b'[Service]\n\x00WorkingDirectory=/var/tmp\n'
            override.write_bytes(original)
            props = {'NeedDaemonReload':'no', 'DropInPaths':str(override)}
            with patch.object(deploy,'unit_prop',side_effect=lambda u,n:props[n]), \
                 patch.object(deploy,'run') as action:
                with self.assertRaisesRegex(RuntimeError,'CURRENT_BASE_DROPIN_INVALID:api'):
                    deploy.current_validate_runtime_overrides(self.plan(),'api')
                action.assert_not_called()
            self.assertEqual(override.read_bytes(),original)

    def test_continued_entrypoint_blocks_apply_before_any_target_mutation(self):
        case = CurrentApplyEngineTests('test_success_migrates_before_switch_and_records_target')
        case.setUp()
        self.addCleanup(case.doCleanups)
        override = case.root/'50-runtime.conf'
        original = b'[Service]\nWorkingDirectory\\\n=/var/tmp\n'
        override.write_bytes(original)
        props = {'NeedDaemonReload':'no', 'DropInPaths':str(override)}
        evidence = case.root/'apply-rejected'
        evidence.mkdir()
        with case.patches(), \
             patch.object(deploy,'current_validate_base_units',side_effect=lambda plan:deploy.current_validate_runtime_overrides(plan,'api')), \
             patch.object(deploy,'unit_prop',side_effect=lambda u,n:props[n]), \
             patch.object(deploy,'run') as action:
            with self.assertRaisesRegex(RuntimeError,'CURRENT_BASE_ENTRYPOINT_OVERRIDDEN:api'):
                deploy.current_apply_engine(
                    candidate_release=case.release,expected_source_sha='a'*40,
                    expected_source_tree='b'*40,expected_inventory_sha256='c'*64,
                    evidence_root=case.root,journal=case.root/'deployment-state.json',
                    evidence_dir=evidence,
                )
            action.assert_not_called()
        self.assertEqual([event[0] for event in case.events],['prefix'])
        self.assertEqual(list(evidence.iterdir()),[])
        self.assertFalse((case.root/'deployment-state.json').exists())
        self.assertEqual(override.read_bytes(),original)


class CurrentMigrationRollbackTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="octoport-current-migration-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.archive=self.root/"backup.dump";self.archive.write_bytes(b"x")
        self.release=Path("/opt/octoport/ops-releases")/("a"*40)

    def test_isolated_restore_uses_actual_predeploy_and_candidate_target(self):
        events=[]
        def docker(args,**kwargs):
            events.append((list(args),dict(kwargs)))
            return deploy.subprocess.CompletedProcess(args,0,stdout=b"",stderr=b"")
        counts=iter([17,50])
        with patch.object(deploy,"docker_pg",side_effect=docker),              patch.object(deploy,"check_migration_prefix_for_release",
                          side_effect=lambda *a,**k:{"applied":next(counts)}),              patch.object(deploy,"migrate",return_value=None):
            result=deploy.current_restore_isolated(
                "u","postgres://u@localhost/db",self.archive,"20261024T000000Z",
                self.release,expected_before=17,expected_target=50,
            )
        self.assertEqual((result["before"],result["after"]),(17,50))
        self.assertEqual([x[0][0] for x in events],["createdb","pg_restore","dropdb"])

    def test_current_destructive_restore_is_disabled_before_database_io(self):
        with patch.object(deploy,"docker_pg") as command, patch.object(deploy,"check_migration_prefix_for_release") as check:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_DESTRUCTIVE_RESTORE_DISABLED"):
                deploy.current_restore_live_backup(
                    "u","db","postgres://u@localhost/db",self.archive,
                    {"encoding":"UTF8","collate":"C","ctype":"C"},self.release,expected_prefix=17,
                )
        command.assert_not_called()
        check.assert_not_called()

    def test_migration_failure_retains_rolled_back_database_before_unit_baseline(self):
        case=CurrentApplyEngineTests("test_success_migrates_before_switch_and_records_target")
        case.setUp()
        try:
            evidence=case.root/"apply-migration-fail";evidence.mkdir()
            journal=case.root/"deployment-state.json"
            with case.patches(),patch.object(deploy,"migrate",side_effect=RuntimeError("MIGRATION_FAILED")):
                with case.assertRaisesRegex(RuntimeError,"MIGRATION_FAILED"):
                    deploy.current_apply_engine(
                        candidate_release=case.release,expected_source_sha="a"*40,
                        expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                        evidence_root=case.root,journal=journal,evidence_dir=evidence,
                    )
            names=[e[0] for e in case.events]
            case.assertNotIn("restore-db",names)
            case.assertNotIn(("restore-units",17),case.events)
            case.assertEqual(json.loads(journal.read_text())["schemaState"],"UNKNOWN")
            case.assertTrue(json.loads(journal.read_text())["recoveryRequired"])
        finally:
            case.doCleanups()

    def test_package_verification_failure_prevents_all_external_mutation(self):
        plan={"migrationTarget":{"count":50},"services":{}}
        evidence=self.root/"apply-invalid";evidence.mkdir()
        with patch.object(deploy,"verified_current_source_plan",
                          side_effect=RuntimeError("PACKAGE_INVALID")),              patch.object(deploy,"database_url") as db:
            with self.assertRaisesRegex(RuntimeError,"PACKAGE_INVALID"):
                deploy.current_apply_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                    expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                    evidence_root=self.root,journal=self.root/"deployment-state.json",
                    evidence_dir=evidence,
                )
            db.assert_not_called()


class CurrentCrashRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="octoport-current-recovery-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.release=Path("/opt/octoport/ops-releases")/("a"*40)
        self.plan={
            "sourceSha":"a"*40,"sourceTree":"b"*40,"trustedInventorySha256":"c"*64,
            "migrationTarget":{"count":50,"latestTag":"0061"},
            "services":{
                role:{"unit":f"seller-agents-owner-test-{role}.service"}
                for role in ("api","worker","portal","admin")
            },
        }
        self.baseline={
            f"seller-agents-owner-test-{role}.service":
                {"load":"loaded","active":"active","sub":"running"}
            for role in ("api","worker","portal","admin")
        }
        self.evidence=self.root/"apply-x";self.evidence.mkdir()
        (self.evidence/"dropins-before").mkdir()
        self.backup=self.root/"backup.dump";self.backup.write_bytes(b"x")
        self.journal=self.root/"deployment-state.json"

    def write_state(self, schema, *, backup=True):
        receipt={
            "candidateSourceSha":"a"*40,"candidateSourceTree":"b"*40,
            "trustedInventorySha256":"c"*64,
            "predeployPrefix":17,"candidateTarget":50,
            "baselineUnits":self.baseline,
            "databaseMeta":{"encoding":"UTF8","collate":"C","ctype":"C"},
            "baselineRecoveryProtocol":1,
            "migrationSettlement":{"protocol":1,"intentId":"d"*32,
                "outcome":{"UNKNOWN":"UNCONFIRMED","PREDEPLOY_VERIFIED":"NOT_STARTED","CANDIDATE_VERIFIED":"COMPLETED"}[schema]},
            "phase":{"UNKNOWN":"LIVE_MIGRATION","PREDEPLOY_VERIFIED":"QUIESCED","CANDIDATE_VERIFIED":"SWITCHING_APPLICATION"}[schema],
            "schemaState":schema,"applicationMayHaveWritten":False,
        }
        if backup:
            receipt["backup"]={"path":str(self.backup),"sha256":"d"*64,"bytes":1}
        (self.evidence/"receipt.json").write_text(json.dumps(receipt))
        self.journal.write_text(json.dumps({
            "phase":receipt["phase"],"schemaState":schema,"recoveryRequired":True,
            "migrationSettlement":dict(receipt["migrationSettlement"]),
            "baselineRecoveryProtocol":1,"applicationMayHaveWritten":False,
            **{k:receipt[k] for k in ("candidateSourceSha","candidateSourceTree","trustedInventorySha256","predeployPrefix","candidateTarget")},
            "receipt":str(self.evidence/"receipt.json"),
        }))

    def patch_common(self, events):
        stack=ExitStack()
        stack.enter_context(patch.object(deploy,"verified_current_source_plan",return_value=self.plan))
        stack.enter_context(patch.object(deploy,"database_url",return_value="postgres://fixture@localhost/db"))
        stack.enter_context(patch.object(deploy,"check_migration_prefix_for_release",
                                         return_value={"status":"PASS_PREFIX","applied":17}))
        stack.enter_context(patch.object(deploy,"current_install_reboot_fence",side_effect=lambda plan,**kwargs:events.append("fence-install")))
        # Engine tests replace the complete filesystem boundary. The real
        # prepare helper now owns one lock across allowance cleanup + install;
        # its actual filesystem ordering is covered by CurrentRebootFenceSafetyTests.
        stack.enter_context(patch.object(deploy,"current_prepare_recovery_fence",
                                        side_effect=lambda plan:events.extend(("fence-block","fence-install"))))
        stack.enter_context(patch.object(deploy,"current_enable_fenced_start",side_effect=lambda:events.append("fence-allow")))
        stack.enter_context(patch.object(deploy,"current_disable_fenced_start",side_effect=lambda:events.append("fence-block")))
        stack.enter_context(patch.object(deploy,"current_remove_reboot_fence",side_effect=lambda plan:events.append("fence-remove")))
        stack.enter_context(patch.object(deploy,"current_verify_backup_receipt",return_value=self.backup))
        stack.enter_context(patch.object(deploy,"current_stop_product_units",
                                         side_effect=lambda plan:events.append("stop") or {}))
        stack.enter_context(patch.object(deploy,"current_restore_dropins",
                                         side_effect=lambda plan,path:events.append("dropins")))
        stack.enter_context(patch.object(deploy,"current_restore_unit_states",
                                         side_effect=lambda plan,state:events.append("units")))
        return stack


    def test_unknown_recovery_retains_existing_ownership_acl_and_rows(self):
        self.write_state("UNKNOWN");events=[]
        retained={"owner":"original_owner","acl":["transfer_runtime:SELECT"],"rows":["existing-session"]}
        before=json.loads(json.dumps(retained))
        def destructive_restore(*args,**kwargs):
            retained.update(owner="restore_user",acl=[],rows=[])
            return 17
        with self.patch_common(events),patch.object(deploy,"current_restore_live_backup",side_effect=destructive_restore) as restore:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                self.recover_forward_target()
        restore.assert_not_called()
        self.assertEqual(retained,before)
        self.assertEqual(events,[])

    def test_unknown_schema_never_uses_prefix_as_migration_settlement(self):
        self.write_state("UNKNOWN");events=[]
        with self.patch_common(events),patch.object(deploy,"check_migration_prefix_for_release") as read:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                self.recover_forward_target()
        read.assert_not_called()
        self.assertEqual(events,[])
        self.assertTrue(json.loads(self.journal.read_text())["recoveryRequired"])

    def test_predeploy_verified_recovery_skips_database_restore(self):
        self.write_state("PREDEPLOY_VERIFIED",backup=False);events=[]
        with self.patch_common(events),              patch.object(deploy,"current_restore_live_backup") as restore:
            result=deploy.current_recover_engine(
                candidate_release=self.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=self.root,journal=self.journal,
            )
        restore.assert_not_called()
        self.assertEqual(
            events,
            ["fence-block","fence-install","stop","dropins","fence-allow","units","fence-remove"],
        )
        self.assertEqual(result["schemaState"],"PREDEPLOY_VERIFIED")

    def test_unknown_schema_refuses_before_any_additional_history_query(self):
        self.write_state("UNKNOWN",backup=False);events=[]
        with self.patch_common(events),patch.object(deploy,"check_migration_prefix_for_release",side_effect=RuntimeError("HISTORY_READBACK_LOST")) as read:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                self.recover_forward_target()
        read.assert_not_called()
        self.assertEqual(events,[])
        self.assertTrue(json.loads(self.journal.read_text())["recoveryRequired"])

    def test_unknown_recovery_does_not_upgrade_even_visible_target_prefix(self):
        self.write_state("UNKNOWN");events=[]
        before={p:p.read_bytes() for p in (self.journal,self.evidence/"receipt.json")}
        with self.patch_common(events),patch.object(deploy,"check_migration_prefix_for_release",return_value={"status":"PASS_PREFIX","applied":50}) as read:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                self.recover_forward_target()
        read.assert_not_called()
        self.assertEqual(events,[])
        self.assertEqual(before,{p:p.read_bytes() for p in before})

    def test_unresolved_retained_prefix_cannot_restore_or_start_baseline(self):
        for count in (0,18,49,51,True,None):
            with self.subTest(count=count):
                self.evidence=self.root/("apply-unresolved-"+str(count));self.evidence.mkdir()
                (self.evidence/"dropins-before").mkdir()
                self.write_state("UNKNOWN");events=[]
                with self.patch_common(events), \
                     patch.object(deploy,"check_migration_prefix_for_release",return_value={"status":"PASS_PREFIX","applied":count}), \
                     patch.object(deploy,"current_restore_live_backup") as restore:
                    with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                        self.recover_forward_target()
                restore.assert_not_called()
                self.assertNotIn("units",events)
                self.assertNotIn("dropins",events)
                self.assertNotIn("fence-allow",events)
                self.assertTrue(json.loads(self.journal.read_text())["recoveryRequired"])


    def test_completed_receipt_with_unconfirmed_journal_cannot_restart(self):
        self.write_state("CANDIDATE_VERIFIED");events=[]
        payload=json.loads(self.journal.read_text())
        payload["migrationSettlement"]["outcome"]="UNCONFIRMED"
        self.journal.write_text(json.dumps(payload))
        before={p:p.read_bytes() for p in (self.journal,self.evidence/"receipt.json")}
        with self.patch_common(events):
            with self.assertRaisesRegex(RuntimeError,"CURRENT_MIGRATION_SETTLEMENT_UNCONFIRMED"):
                self.recover_forward_target()
        self.assertEqual(events,[])
        self.assertEqual(before,{p:p.read_bytes() for p in before})

    def test_identity_mismatch_fails_before_quiesce(self):
        self.write_state("UNKNOWN")
        receipt=json.loads((self.evidence/"receipt.json").read_text())
        receipt["candidateSourceSha"]="f"*40
        (self.evidence/"receipt.json").write_text(json.dumps(receipt))
        with patch.object(deploy,"verified_current_source_plan",return_value=self.plan),              patch.object(deploy,"current_stop_product_units") as stop:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_RECOVERY_IDENTITY_MISMATCH"):
                deploy.current_recover_engine(
                    candidate_release=self.release,expected_source_sha="a"*40,
                    expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                    evidence_root=self.root,journal=self.journal,
                )
            stop.assert_not_called()


    def test_baseline_partial_start_and_power_loss_preserve_rows_on_retry(self):
        for crash in (False, True):
            with self.subTest(power_loss=crash):
                # Separate apply evidence: a completed previous deployment must
                # not be rewritten into an unrelated UNKNOWN recovery attempt.
                self.evidence=self.root/("apply-baseline-"+str(crash))
                self.evidence.mkdir();(self.evidence/"dropins-before").mkdir()
                self.write_state("PREDEPLOY_VERIFIED");events=[];rows=[];restores=[]
                crashed=False;starts=0
                real_write=deploy.write_json_durable
                class PowerLoss(BaseException):
                    pass
                def durable(path,value):
                    if crashed: raise PowerLoss("POWER_LOSS")
                    return real_write(path,value)
                def restore(*args,**kwargs):
                    restores.append("restore");rows.clear();return 17
                def start(plan,baseline):
                    nonlocal crashed,starts
                    starts+=1;rows.append("session-"+str(starts))
                    for path in (self.journal,self.evidence/"receipt.json"):
                        saved=json.loads(path.read_text())
                        self.assertTrue(saved["applicationMayHaveWritten"])
                        self.assertEqual(saved["schemaState"],"PREDEPLOY_VERIFIED")
                        self.assertEqual(saved["phase"],"BASELINE_START_REQUESTED")
                    if starts==1:
                        if crash:
                            crashed=True
                            raise PowerLoss("POWER_LOSS")
                        raise RuntimeError("PARTIAL_BASELINE_START")
                with self.patch_common(events) as stack:
                    stack.enter_context(patch.object(deploy,"database_url",return_value="postgres://u@localhost/db"))
                    stack.enter_context(patch.object(deploy,"db_identity",return_value=("u","p","db",None)))
                    stack.enter_context(patch.object(deploy,"check_migration_prefix_for_release",return_value={"status":"PASS_PREFIX","applied":17}))
                    stack.enter_context(patch.object(deploy,"current_restore_live_backup",side_effect=restore))
                    stack.enter_context(patch.object(deploy,"current_restore_unit_states",side_effect=start))
                    with patch.object(deploy,"write_json_durable",side_effect=durable):
                        with self.assertRaises(PowerLoss if crash else RuntimeError):
                            self.recover_forward_target()
                    crashed=False
                    self.recover_forward_target()
                self.assertEqual(rows,["session-1","session-2"])
                self.assertEqual(restores,[])
        attempts=list(self.root.glob("apply-baseline-*/baseline-recovery-*.json"))
        self.assertEqual(len(attempts),4)
        self.assertEqual(sum(json.loads(p.read_text())["status"]=="CURRENT_RECOVERY_PASS" for p in attempts),2)

    def test_automatic_baseline_power_loss_preserves_rows_on_recovery(self):
        case=CurrentApplyEngineTests("test_success_migrates_before_switch_and_records_target")
        case.setUp()
        self.addCleanup(case.doCleanups)
        evidence=case.root/"apply-baseline-power-loss";evidence.mkdir()
        journal=case.root/"deployment-state.json"
        rows=[];restores=[];crashed=False;starts=0
        real_write=deploy.write_json_durable
        class PowerLoss(BaseException):
            pass
        def durable(path,value):
            if crashed: raise PowerLoss("POWER_LOSS")
            return real_write(path,value)
        def restore(*args,**kwargs):
            restores.append("restore");rows.clear();case.prefix=17;return 17
        def start(plan,baseline):
            nonlocal crashed,starts
            starts+=1;rows.append("baseline-session-"+str(starts))
            for path in (journal,evidence/"receipt.json"):
                saved=json.loads(path.read_text())
                self.assertTrue(saved["applicationMayHaveWritten"])
                self.assertEqual(saved["schemaState"],"PREDEPLOY_VERIFIED")
                self.assertEqual(saved["phase"],"BASELINE_START_REQUESTED")
            if starts==1:
                crashed=True
                raise PowerLoss("POWER_LOSS")
        with case.patches(), \
             patch.object(deploy,"current_restore_isolated",side_effect=RuntimeError("ISOLATED_VALIDATION_FAILED")), \
             patch.object(deploy,"current_restore_live_backup",side_effect=restore), \
             patch.object(deploy,"current_restore_unit_states",side_effect=start):
            with patch.object(deploy,"write_json_durable",side_effect=durable):
                with self.assertRaises(PowerLoss):
                    deploy.current_apply_engine(
                        candidate_release=case.release,expected_source_sha="a"*40,
                        expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                        evidence_root=case.root,journal=journal,evidence_dir=evidence,
                    )
            crashed=False
            deploy.current_recover_engine(
                candidate_release=case.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=case.root,journal=journal,
            )
        self.assertEqual(rows,["baseline-session-1","baseline-session-2"])
        self.assertEqual(restores,[])

    def baseline_started_state(self):
        self.forward_state()
        for path in (self.evidence/"receipt.json",self.journal):
            value=json.loads(path.read_text())
            value.update(schemaState="PREDEPLOY_VERIFIED",phase="BASELINE_START_REQUESTED")
            value["migrationSettlement"]["outcome"]="NOT_STARTED"
            path.write_text(json.dumps(value))

    def test_baseline_retry_checks_retained_prefix_without_dump_replay(self):
        self.baseline_started_state();events=[]
        with self.patch_common(events), \
             patch.object(deploy,"check_migration_prefix_for_release",side_effect=RuntimeError("MIGRATION_HASH_MISMATCH")), \
             patch.object(deploy,"current_restore_live_backup") as restore:
            with self.assertRaisesRegex(RuntimeError,"MIGRATION_HASH_MISMATCH"):
                self.recover_forward_target()
        restore.assert_not_called()
        self.assertNotIn("units",events)
        self.assertNotIn("dropins",events)
        self.assertTrue(json.loads(self.journal.read_text())["applicationMayHaveWritten"])

    def test_baseline_retry_rejects_torn_or_unbound_records_before_mutation(self):
        cases=[
            ("receipt","schemaState","UNKNOWN","CURRENT_BASELINE_SCHEMA_UNCONFIRMED"),
            ("journal","schemaState","UNKNOWN","CURRENT_FORWARD_SCHEMA_UNCONFIRMED"),
            ("journal","candidateSourceSha","f"*40,"CURRENT_BASELINE_ORIGIN_UNCONFIRMED"),
        ]
        for name,key,value,error in cases:
            with self.subTest(record=name,field=key):
                self.baseline_started_state();events=[]
                path=self.journal if name=="journal" else self.evidence/"receipt.json"
                payload=json.loads(path.read_text());payload[key]=value;path.write_text(json.dumps(payload))
                with self.patch_common(events),patch.object(deploy,"current_restore_live_backup") as restore:
                    with self.assertRaisesRegex(RuntimeError,error):
                        self.recover_forward_target()
                restore.assert_not_called()
                self.assertEqual(events,[])

    def test_baseline_retry_cannot_substitute_a_different_source(self):
        self.baseline_started_state();events=[]
        self.plan.update(sourceSha="d"*40,sourceTree="e"*40,trustedInventorySha256="f"*64)
        with self.patch_common(events),patch.object(deploy,"current_restore_live_backup") as restore:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_RECOVERY_IDENTITY_MISMATCH"):
                self.recover_forward_target()
        restore.assert_not_called()
        self.assertEqual(events,[])


    def test_old_baseline_crash_without_final_receipt_never_replays_dump(self):
        # Persisted 780979e3 state: baseline already wrote, then process loss
        # prevented BOTH the final recovery file and any original-state update.
        self.write_state("UNKNOWN");events=[];rows=["device-after-old-start","session-after-old-start"]
        for path in (self.evidence/"receipt.json",self.journal):
            payload=json.loads(path.read_text())
            payload.update(phase="LIVE_MIGRATION",schemaState="UNKNOWN",applicationMayHaveWritten=False)
            payload.pop("baselineRecoveryProtocol",None)
            path.write_text(json.dumps(payload))
        self.assertFalse((self.evidence/"recovery.json").exists())
        before={path:path.read_bytes() for path in (self.journal,self.evidence/"receipt.json")}
        def restore(*args,**kwargs):
            rows.clear()
            return 17
        with self.patch_common(events), \
             patch.object(deploy,"db_identity",return_value=("u","p","db",None)), \
             patch.object(deploy,"current_restore_live_backup",side_effect=restore) as restore_mock:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_BASELINE_REPLAY_UNCONFIRMED"):
                self.recover_forward_target()
        restore_mock.assert_not_called()
        self.assertEqual(rows,["device-after-old-start","session-after-old-start"])
        self.assertEqual(events,[])
        self.assertEqual(before,{path:path.read_bytes() for path in before})


    def test_unconfirmed_or_conflicting_replay_protocol_never_mutates(self):
        cases=[
            ("both","baselineRecoveryProtocol",None),
            ("journal","baselineRecoveryProtocol",None),
            ("receipt","baselineRecoveryProtocol",None),
            ("both","baselineRecoveryProtocol",0),
            ("both","baselineRecoveryProtocol",True),
            ("both","baselineRecoveryProtocol","1"),
            ("both","baselineRecoveryProtocol",2),
            ("journal","applicationMayHaveWritten",None),
            ("receipt","applicationMayHaveWritten",None),
            ("journal","candidateSourceSha","f"*40),
            ("journal","predeployPrefix",16),
            ("receipt","schemaState","PREDEPLOY_VERIFIED"),
            ("receipt","phase","PRE"),
        ]
        for record,key,value in cases:
            with self.subTest(record=record,key=key,value=value):
                self.write_state("UNKNOWN");events=[]
                paths=[self.journal,self.evidence/"receipt.json"]
                selected=paths if record=="both" else [paths[0 if record=="journal" else 1]]
                for path in selected:
                    payload=json.loads(path.read_text())
                    if value is None: payload.pop(key,None)
                    else: payload[key]=value
                    path.write_text(json.dumps(payload))
                before={p:p.read_bytes() for p in paths}
                with self.patch_common(events),patch.object(deploy,"current_restore_live_backup") as restore:
                    with self.assertRaisesRegex(RuntimeError,"CURRENT_BASELINE_REPLAY_UNCONFIRMED"):
                        self.recover_forward_target()
                restore.assert_not_called()
                self.assertEqual(events,[])
                self.assertEqual(before,{p:p.read_bytes() for p in paths})

    def test_legacy_failed_recovery_does_not_authorize_dump_replay(self):
        self.write_state("UNKNOWN");events=[]
        (self.evidence/"recovery.json").write_text(json.dumps({"status":"FAILED","schemaState":"UNKNOWN"}))
        with self.patch_common(events),patch.object(deploy,"current_restore_live_backup") as restore:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_BASELINE_REPLAY_UNCONFIRMED"):
                self.recover_forward_target()
        restore.assert_not_called()
        self.assertEqual(events,[])

    def test_previous_recovery_symlink_is_not_followed(self):
        self.write_state("UNKNOWN");events=[]
        outside=self.root/"unrelated-record.json"
        outside.write_text(json.dumps({"applicationMayHaveWritten":False}))
        (self.evidence/"recovery.json").symlink_to(outside)
        with self.patch_common(events),patch.object(deploy,"current_restore_live_backup") as restore:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_BASELINE_REPLAY_UNCONFIRMED"):
                self.recover_forward_target()
        restore.assert_not_called()
        self.assertEqual(events,[])

    def test_baseline_journal_write_failure_never_starts_or_replays_dump(self):
        self.write_state("PREDEPLOY_VERIFIED");events=[]
        real_write=deploy.write_json_durable
        def fail_start_journal(path,value):
            if path==self.journal and value.get("phase")=="BASELINE_START_REQUESTED":
                raise OSError("JOURNAL_WRITE_FAILED")
            return real_write(path,value)
        with self.patch_common(events), \
             patch.object(deploy,"db_identity",return_value=("u","p","db",None)), \
             patch.object(deploy,"current_restore_live_backup",return_value=17) as restore:
            with patch.object(deploy,"write_json_durable",side_effect=fail_start_journal):
                with self.assertRaisesRegex(OSError,"JOURNAL_WRITE_FAILED"):
                    self.recover_forward_target()
            self.assertNotIn("units",events)
            self.assertNotIn("fence-allow",events)
            self.assertEqual(self.recover_forward_target()["status"],"CURRENT_RECOVERY_PASS")
            restore.assert_not_called()

    def forward_state(self, *, legacy=False):
        self.write_state("CANDIDATE_VERIFIED")
        path=self.evidence/"receipt.json"
        receipt=json.loads(path.read_text())
        receipt["phase"]="SWITCHING_APPLICATION" if legacy else "APPLICATION_START_REQUESTED"
        if not legacy:
            receipt["applicationMayHaveWritten"]=True
        path.write_text(json.dumps(receipt))
        state=json.loads(self.journal.read_text())
        state.update({k:receipt[k] for k in (
            "candidateSourceSha","candidateSourceTree","predeployPrefix","candidateTarget",
        )})
        state["phase"]=receipt["phase"]
        if not legacy:
            state["applicationMayHaveWritten"]=True
        self.journal.write_text(json.dumps(state))
        self.forward_rows=["retained-new-session"]

    def forward_patches(self, events, *, health_error=None, prefix_error=None, start_error=None):
        stack=self.patch_common(events)
        def prefix(release,url,expected_count=None):
            events.append(("prefix",str(release),expected_count))
            if prefix_error: raise RuntimeError(prefix_error)
            return {"status":"PASS_PREFIX","applied":50}
        def start(plan):
            events.append("start-forward")
            self.forward_rows.append("write-during-forward-start")
            # Intent must be durable before starting even the first service.
            recorded=json.loads(self.journal.read_text())
            self.assertTrue(recorded["applicationMayHaveWritten"])
            self.assertTrue(Path(recorded["lastRecoveryReceipt"]).is_file())
            if start_error: raise RuntimeError(start_error)
        def health(*args):
            events.append("health-forward")
            if health_error: raise RuntimeError(health_error)
            return {"ready":True}
        def forbidden(*args,**kwargs):
            raise AssertionError("forward recovery must not migrate or restore DB/baseline")
        stack.enter_context(patch.object(deploy,"current_validate_base_units",side_effect=lambda plan:events.append("base-contract") or {}))
        stack.enter_context(patch.object(deploy,"database_url",return_value="postgres://fixture@localhost/db"))
        stack.enter_context(patch.object(deploy,"check_migration_prefix_for_release",side_effect=prefix))
        stack.enter_context(patch.object(deploy,"current_write_dropins",side_effect=lambda plan:events.append(("forward-target",plan["sourceSha"]))))
        stack.enter_context(patch.object(deploy,"current_start_product_units",side_effect=start))
        stack.enter_context(patch.object(deploy,"current_wait_runtime",side_effect=health))
        stack.enter_context(patch.object(deploy,"current_verify_loaded_plan",return_value={"exact":True}))
        for name in ("current_restore_live_backup","migrate","current_restore_dropins","current_restore_unit_states"):
            stack.enter_context(patch.object(deploy,name,side_effect=forbidden))
        return stack

    def recover_forward_target(self):
        return deploy.current_recover_engine(
            candidate_release=Path("/opt/octoport/ops-releases")/self.plan["sourceSha"],
            expected_source_sha=self.plan["sourceSha"],expected_source_tree=self.plan["sourceTree"],
            expected_inventory_sha256=self.plan["trustedInventorySha256"],
            evidence_root=self.root,journal=self.journal,
        )

    def test_post_start_recovery_keeps_rows_and_restarts_exact_current_target(self):
        self.forward_state();events=[]
        with self.forward_patches(events):
            result=self.recover_forward_target()
        self.assertEqual(result["status"],"CURRENT_FORWARD_RECOVERY_PASS")
        self.assertFalse(result["databaseRestored"])
        self.assertEqual(self.forward_rows,["retained-new-session","write-during-forward-start"])
        state=json.loads(self.journal.read_text())
        self.assertFalse(state["recoveryRequired"])
        self.assertEqual(state["schemaState"],"CANDIDATE_VERIFIED")
        self.assertIn(("prefix",str(self.release),50),events)

    def test_post_start_recovery_can_use_separately_authorized_same_schema_floor(self):
        self.forward_state();events=[]
        self.plan.update(sourceSha="d"*40,sourceTree="e"*40,trustedInventorySha256="f"*64)
        with self.forward_patches(events):
            result=self.recover_forward_target()
        self.assertEqual(result["originSourceSha"],"a"*40)
        self.assertEqual(result["candidateSourceSha"],"d"*40)
        self.assertIn(("forward-target","d"*40),events)
        self.assertIn(("prefix","/opt/octoport/ops-releases/"+"d"*40,50),events)
        self.assertEqual(self.forward_rows[0],"retained-new-session")

    def test_forward_recovery_rejects_different_schema_before_mutation(self):
        self.forward_state();events=[]
        self.plan["migrationTarget"]["count"]=49
        with self.forward_patches(events):
            with self.assertRaisesRegex(RuntimeError,"CURRENT_FORWARD_SCHEMA_TARGET_MISMATCH"):
                self.recover_forward_target()
        self.assertEqual(events,[])
        self.assertEqual(self.forward_rows,["retained-new-session"])

    def test_forward_recovery_prefix_mismatch_preserves_rows_and_quiescence(self):
        self.forward_state();events=[]
        with self.forward_patches(events,prefix_error="MIGRATION_HASH_MISMATCH"):
            with self.assertRaisesRegex(RuntimeError,"MIGRATION_HASH_MISMATCH"):
                self.recover_forward_target()
        self.assertNotIn("start-forward",events)
        self.assertEqual(self.forward_rows,["retained-new-session"])
        state=json.loads(self.journal.read_text())
        self.assertTrue(state["recoveryRequired"])
        self.assertEqual(state["candidateSourceSha"],"a"*40)
        self.assertEqual(state["receipt"],str(self.evidence/"receipt.json"))
        self.assertEqual(json.loads(Path(state["lastRecoveryReceipt"]).read_text())["status"],"FAILED")

    def test_forward_recovery_health_or_partial_start_failure_keeps_every_write(self):
        for stage in ("health","start"):
            with self.subTest(stage=stage):
                self.forward_state();events=[]
                opts={"health_error":"FORWARD_FAILED"} if stage=="health" else {"start_error":"FORWARD_FAILED"}
                with self.forward_patches(events,**opts):
                    with self.assertRaisesRegex(RuntimeError,"FORWARD_FAILED"):
                        self.recover_forward_target()
                self.assertEqual(self.forward_rows,["retained-new-session","write-during-forward-start"])
                self.assertTrue(json.loads(self.journal.read_text())["recoveryRequired"])
                self.assertGreaterEqual(events.count("stop"),2)
        self.assertEqual(len(list(self.evidence.glob("forward-recovery-*.json"))),2)

    def test_legacy_switching_receipt_is_conservatively_forward_only(self):
        self.forward_state(legacy=True);events=[]
        with self.forward_patches(events):
            result=self.recover_forward_target()
        self.assertEqual(result["status"],"CURRENT_FORWARD_RECOVERY_PASS")
        self.assertEqual(self.forward_rows[0],"retained-new-session")

    def test_possible_write_with_unknown_schema_never_restores_dump(self):
        self.forward_state();events=[]
        state=json.loads(self.journal.read_text());state["schemaState"]="UNKNOWN"
        self.journal.write_text(json.dumps(state))
        with self.forward_patches(events):
            with self.assertRaisesRegex(RuntimeError,"CURRENT_FORWARD_SCHEMA_UNCONFIRMED"):
                self.recover_forward_target()
        self.assertEqual(events,[])

    def test_malformed_start_marker_in_either_record_fails_before_mutation(self):
        for name in ("receipt", "journal"):
            with self.subTest(record=name):
                self.forward_state();events=[]
                path=self.evidence/"receipt.json" if name=="receipt" else self.journal
                value=json.loads(path.read_text());value["applicationMayHaveWritten"]="true"
                path.write_text(json.dumps(value))
                with self.forward_patches(events):
                    with self.assertRaisesRegex(RuntimeError,"CURRENT_RECOVERY_STATE_INVALID"):
                        self.recover_forward_target()
                self.assertEqual(events,[])

    def test_forward_recovery_rejects_unconfirmed_original_source_binding(self):
        self.forward_state();events=[]
        state=json.loads(self.journal.read_text());state["candidateSourceSha"]="f"*40
        self.journal.write_text(json.dumps(state))
        with self.forward_patches(events):
            with self.assertRaisesRegex(RuntimeError,"CURRENT_FORWARD_ORIGIN_UNCONFIRMED"):
                self.recover_forward_target()
        self.assertEqual(events,[])



class CurrentRebootFenceSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="octoport-fence-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.plan={"services":{
            role:{"unit":f"seller-agents-owner-test-{role}.service"}
            for role in ("api","worker","portal","admin")
        }}
        self.old_root=deploy.CURRENT_DROPIN_ROOT
        self.old_allow=deploy.CURRENT_FENCE_ALLOW
        deploy.CURRENT_DROPIN_ROOT=self.root/"systemd"
        deploy.CURRENT_FENCE_ALLOW=self.root/"run"/"allow"
        deploy.CURRENT_FENCE_ALLOW.parent.mkdir()
        self.addCleanup(setattr,deploy,"CURRENT_DROPIN_ROOT",self.old_root)
        self.addCleanup(setattr,deploy,"CURRENT_FENCE_ALLOW",self.old_allow)

    def test_persistent_fence_blocks_until_ephemeral_allow_and_explicit_remove(self):
        completed=deploy.subprocess.CompletedProcess([],0,stdout=b"",stderr=b"")
        with patch.object(deploy,"run",return_value=completed):
            deploy.current_install_reboot_fence(self.plan)
            paths=deploy.current_fence_paths(self.plan)
            self.assertEqual(len(paths),4)
            for path in paths.values():
                self.assertTrue(path.is_file())
                self.assertEqual(
                    path.read_text(),
                    "[Unit]\nConditionPathExists="+str(deploy.CURRENT_FENCE_ALLOW)+"\n",
                )
            self.assertFalse(deploy.CURRENT_FENCE_ALLOW.exists())
            deploy.current_enable_fenced_start()
            self.assertTrue(deploy.CURRENT_FENCE_ALLOW.is_file())
            deploy.current_disable_fenced_start()
            self.assertFalse(deploy.CURRENT_FENCE_ALLOW.exists())
            # Simulated reboot: /run allow remains absent while persistent /etc-like fences remain.
            self.assertTrue(all(path.exists() for path in paths.values()))
            deploy.current_remove_reboot_fence(self.plan)
            self.assertTrue(all(not path.exists() for path in paths.values()))

    def test_recovery_clears_stale_allow_and_accepts_existing_persistent_fence(self):
        completed=deploy.subprocess.CompletedProcess([],0,stdout=b"",stderr=b"")
        with patch.object(deploy,"run",return_value=completed):
            deploy.current_install_reboot_fence(self.plan)
            deploy.current_enable_fenced_start()
            self.assertTrue(deploy.CURRENT_FENCE_ALLOW.exists())
            deploy.current_prepare_recovery_fence(self.plan)
            self.assertFalse(deploy.CURRENT_FENCE_ALLOW.exists())
            self.assertTrue(all(path.is_file() for path in deploy.current_fence_paths(self.plan).values()))

    def test_symlinked_dropin_parent_is_rejected(self):
        outside=self.root/"outside";outside.mkdir()
        unit_dir=deploy.CURRENT_DROPIN_ROOT/"seller-agents-owner-test-api.service.d"
        unit_dir.parent.mkdir(parents=True)
        unit_dir.symlink_to(outside,target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,"CURRENT_PATH_SYMLINK_FORBIDDEN"):
            deploy.current_install_reboot_fence(self.plan)


class CurrentEvidenceAndBackupSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="octoport-evidence-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.evidence=self.root/"apply-safe";self.evidence.mkdir()
        self.journal=self.root/"deployment-state.json"

    def test_evidence_paths_must_be_direct_children_of_trusted_root(self):
        deploy.current_validate_evidence_paths(self.root,self.journal,self.evidence)
        outside=self.root.parent/"outside-state.json"
        with self.assertRaisesRegex(RuntimeError,"CURRENT_EVIDENCE_PATH_INVALID"):
            deploy.current_validate_evidence_paths(self.root,outside,self.evidence)

    def test_symlinked_evidence_directory_is_rejected(self):
        target=self.root/"real";target.mkdir()
        link=self.root/"apply-link";link.symlink_to(target,target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,"CURRENT_EVIDENCE_PATH_INVALID"):
            deploy.current_validate_evidence_paths(self.root,self.journal,link)

    def test_backup_receipt_checks_containment_mode_size_and_digest(self):
        backups=self.root/"backups";backups.mkdir(mode=0o700)
        old=deploy.BACKUPS;deploy.BACKUPS=backups
        self.addCleanup(setattr,deploy,"BACKUPS",old)
        path=backups/"owner-test-safe.dump";path.write_bytes(b"backup-bytes");os.chmod(path,0o600)
        info={"path":str(path),"bytes":path.stat().st_size,"sha256":deploy.sha256(path)}
        real_stat=Path.stat
        def synthetic_stat(candidate, *args, **kwargs):
            value=real_stat(candidate,*args,**kwargs)
            if candidate==path:
                return SimpleNamespace(
                    st_uid=0,st_gid=0,st_mode=value.st_mode,st_size=value.st_size
                )
            return value
        with patch.object(Path,"stat",new=synthetic_stat):
            self.assertEqual(deploy.current_verify_backup_receipt(info),path)
            wrong=dict(info,sha256="0"*64)
            with self.assertRaisesRegex(RuntimeError,"CURRENT_RECOVERY_BACKUP_INVALID"):
                deploy.current_verify_backup_receipt(wrong)
        outside=self.root/"outside.dump";outside.write_bytes(b"backup-bytes");os.chmod(outside,0o600)
        wrong_path=dict(info,path=str(outside))
        with self.assertRaisesRegex(RuntimeError,"CURRENT_RECOVERY_BACKUP_INVALID"):
            deploy.current_verify_backup_receipt(wrong_path)


class CurrentOperationGuardTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="octoport-current-guard-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.evidence=self.root/"apply-test";self.evidence.mkdir()
        self.journal=self.root/"deployment-state.json"
        self.release=Path("/opt/octoport/ops-releases")/("a"*40)

    def invoke(self):
        return deploy.current_apply_engine(
            candidate_release=self.release,expected_source_sha="a"*40,
            expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
            evidence_root=self.root,journal=self.journal,evidence_dir=self.evidence,
        )

    def test_recovery_required_journal_blocks_before_package_or_mutation(self):
        self.journal.write_text(json.dumps({"recoveryRequired":True}))
        with patch.object(deploy,"verified_current_source_plan") as verify,              patch.object(deploy,"current_stop_product_units") as stop:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_RECOVERY_REQUIRED"):
                self.invoke()
            verify.assert_not_called();stop.assert_not_called()

    def test_malformed_journal_blocks_before_package_or_mutation(self):
        self.journal.write_text("{")
        with patch.object(deploy,"verified_current_source_plan") as verify:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_RECOVERY_REQUIRED"):
                self.invoke()
            verify.assert_not_called()

    def test_concurrent_lock_blocks_apply(self):
        lock=self.root/"apply.lock"
        fd=os.open(lock,os.O_CREAT|os.O_RDWR,0o600)
        try:
            deploy.fcntl.flock(fd,deploy.fcntl.LOCK_EX|deploy.fcntl.LOCK_NB)
            with self.assertRaisesRegex(RuntimeError,"CURRENT_APPLY_ALREADY_RUNNING"):
                self.invoke()
        finally:
            deploy.fcntl.flock(fd,deploy.fcntl.LOCK_UN);os.close(fd)

class CurrentCliAuthorityTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix="octoport-current-cli-")
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.release=Path("/opt/octoport/ops-releases")/("a"*40)
        self.sha="a"*40
        self.tree="b"*40
        self.inventory="c"*64
        self.old_authority=deploy.CURRENT_AUTHORITY_FILE
        deploy.CURRENT_AUTHORITY_FILE=self.root/"authority.json"
        self.addCleanup(setattr,deploy,"CURRENT_AUTHORITY_FILE",self.old_authority)

    def argv(self, mode):
        return [
            mode,
            "--candidate-release",str(self.release),
            "--source-sha",self.sha,
            "--source-tree",self.tree,
            "--inventory-sha256",self.inventory,
        ]

    def write_authority(self, *, modes=("apply","recover"), sha=None):
        value={
            "status":"AUTHORIZED",
            "scope":"B05_CURRENT_FOUR_SERVICE_DEPLOY",
            "authorizationId":"synthetic-test-authority",
            "allowedModes":list(modes),
            "sourceSha":self.sha if sha is None else sha,
            "sourceTree":self.tree,
            "trustedInventorySha256":self.inventory,
        }
        deploy.CURRENT_AUTHORITY_FILE.write_text(json.dumps(value))
        os.chmod(deploy.CURRENT_AUTHORITY_FILE,0o600)

    def root_owned_authority_metadata(self):
        real_stat=Path.stat
        authority=deploy.CURRENT_AUTHORITY_FILE
        def synthetic_stat(path, *args, **kwargs):
            value=real_stat(path,*args,**kwargs)
            if path==authority:
                return SimpleNamespace(
                    st_uid=0,st_gid=0,st_mode=value.st_mode,st_size=value.st_size
                )
            return value
        return patch.object(Path,"stat",new=synthetic_stat)

    def test_current_plan_is_read_only_route_without_live_authority(self):
        expected={
            "status":"CURRENT_FOUR_SERVICE_SOURCE_PLAN_PASS",
            "sourceSha":self.sha,
            "sourceTree":self.tree,
        }
        with patch.object(deploy,"verified_current_source_plan",return_value=expected) as plan:
            with patch.object(deploy,"current_require_cli_authority") as authority:
                result=deploy.current_cli(self.argv("current-plan"))
        self.assertEqual(result,expected)
        authority.assert_not_called()
        plan.assert_called_once_with(
            self.release,
            expected_source_sha=self.sha,
            expected_source_tree=self.tree,
            expected_inventory_sha256=self.inventory,
        )
        self.assertFalse(deploy.CURRENT_AUTHORITY_FILE.exists())

    def test_current_apply_requires_separate_authority_before_evidence_or_engine(self):
        evidence=self.root/"evidence"
        with patch.object(deploy,"current_apply_engine") as engine,              patch.object(deploy,"current_trusted_evidence_root") as trusted:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_DEPLOY_AUTHORIZATION_REQUIRED"):
                deploy.current_cli(self.argv("current-apply"))
        engine.assert_not_called()
        trusted.assert_not_called()
        self.assertFalse(evidence.exists())

    def test_current_apply_rejects_authority_bound_to_other_source(self):
        evidence=self.root/"evidence"
        self.write_authority(sha="d"*40)
        with self.root_owned_authority_metadata(),              patch.object(deploy,"current_apply_engine") as engine,              patch.object(deploy,"current_trusted_evidence_root") as trusted:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_DEPLOY_AUTHORIZATION_INVALID"):
                deploy.current_cli(self.argv("current-apply"))
        engine.assert_not_called()
        trusted.assert_not_called()
        self.assertFalse(evidence.exists())

    def test_current_apply_routes_exact_identity_after_authority(self):
        evidence=self.root/"evidence"
        self.write_authority(modes=("apply",))
        expected={"status":"APPLY_PASS","recoveryRequired":False}
        def trusted_root(*,create):
            self.assertTrue(create)
            evidence.mkdir(mode=0o700)
            return evidence
        with self.root_owned_authority_metadata(),              patch.object(deploy,"current_trusted_evidence_root",side_effect=trusted_root) as trusted,              patch.object(deploy,"current_apply_engine",return_value=expected) as engine:
            result=deploy.current_cli(self.argv("current-apply"))
        trusted.assert_called_once_with(create=True)
        self.assertEqual(result["authorizationId"],"synthetic-test-authority")
        self.assertEqual(result["authorityMode"],"apply")
        kwargs=engine.call_args.kwargs
        self.assertEqual(kwargs["candidate_release"],self.release)
        self.assertEqual(kwargs["expected_source_sha"],self.sha)
        self.assertEqual(kwargs["expected_source_tree"],self.tree)
        self.assertEqual(kwargs["expected_inventory_sha256"],self.inventory)
        self.assertEqual(kwargs["evidence_root"],evidence)
        self.assertEqual(kwargs["journal"],evidence/"deployment-state.json")
        self.assertTrue(kwargs["evidence_dir"].parent==evidence)
        self.assertTrue(kwargs["evidence_dir"].name.startswith("apply-"))

    def test_current_recover_routes_existing_evidence_only_with_recover_authority(self):
        evidence=self.root/"evidence";evidence.mkdir(mode=0o700)
        self.write_authority(modes=("recover",))
        expected={"status":"CURRENT_RECOVERY_PASS","recoveryRequired":False}
        with self.root_owned_authority_metadata(),              patch.object(deploy,"current_trusted_evidence_root",return_value=evidence) as trusted,              patch.object(deploy,"current_recover_engine",return_value=expected) as engine:
            result=deploy.current_cli(self.argv("current-recover"))
        trusted.assert_called_once_with(create=False)
        self.assertEqual(result["authorityMode"],"recover")
        engine.assert_called_once_with(
            candidate_release=self.release,
            expected_source_sha=self.sha,
            expected_source_tree=self.tree,
            expected_inventory_sha256=self.inventory,
            evidence_root=evidence,
            journal=evidence/"deployment-state.json",
        )



    def test_trusted_evidence_root_is_fixed_under_control_root(self):
        old=deploy.CURRENT_EVIDENCE_ROOT
        deploy.CURRENT_EVIDENCE_ROOT=self.root/"attacker-selected"
        try:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_EVIDENCE_ROOT_INVALID"):
                deploy.current_trusted_evidence_root(create=False)
        finally:
            deploy.CURRENT_EVIDENCE_ROOT=old
    def test_authority_file_must_be_root_owned_regular_0600(self):
        self.write_authority()
        os.chmod(deploy.CURRENT_AUTHORITY_FILE,0o644)
        with self.root_owned_authority_metadata():
            with self.assertRaisesRegex(RuntimeError,"CURRENT_DEPLOY_AUTHORIZATION_INVALID"):
                deploy.current_require_cli_authority(
                    "apply",
                    expected_source_sha=self.sha,
                    expected_source_tree=self.tree,
                    expected_inventory_sha256=self.inventory,
                )


class CurrentSchemaPauseTests(unittest.TestCase):
    def make_case(self):
        case=CurrentApplyEngineTests("test_success_migrates_before_switch_and_records_target")
        case.setUp();self.addCleanup(case.doCleanups)
        self.case=case
        self.evidence=case.root/"apply-paused";self.evidence.mkdir()
        self.journal=case.root/"deployment-state.json"
        return case

    def apply(self):
        c=self.case
        return deploy.current_apply_engine(
            candidate_release=c.release,expected_source_sha="a"*40,
            expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
            evidence_root=c.root,journal=self.journal,evidence_dir=self.evidence,
            pause_after_migration=True)

    def test_prepared_schema_retains_fence_and_requires_explicit_forward_resume(self):
        c=self.make_case()
        with c.patches():
            prepared=self.apply()
        self.assertEqual(prepared["status"],"CURRENT_SCHEMA_PREPARED")
        self.assertTrue(prepared["recoveryRequired"])
        self.assertFalse(prepared["applicationMayHaveWritten"])
        for p in (self.journal,self.evidence/"receipt.json"):
            value=json.loads(p.read_text())
            self.assertEqual(value["phase"],"SCHEMA_PREPARED")
            self.assertEqual(value["schemaState"],"CANDIDATE_VERIFIED")
            self.assertEqual(value["migrationSettlement"]["outcome"],"COMPLETED")
            self.assertTrue(value["pauseAfterMigration"])
        self.assertFalse(any(e[0] in ("write-dropins","fence-allow","start","restore-units","fence-remove") for e in c.events))
        before=list(c.events)
        with c.patches(),patch.object(deploy,"migrate",side_effect=AssertionError("never repeat migration")):
            resumed=deploy.current_recover_engine(
                candidate_release=c.release,expected_source_sha="a"*40,
                expected_source_tree="b"*40,expected_inventory_sha256="c"*64,
                evidence_root=c.root,journal=self.journal)
        self.assertEqual(resumed["status"],"CURRENT_FORWARD_RECOVERY_PASS")
        self.assertFalse(resumed["databaseRestored"])
        self.assertEqual(c.prefix,50)
        self.assertEqual([e for e in c.events if e[0]=="migrate"],[e for e in before if e[0]=="migrate"])
        self.assertTrue(any(e[0]=="start" for e in c.events[len(before):]))

    def test_second_apply_cannot_repeat_prepared_migration(self):
        c=self.make_case()
        with c.patches():self.apply()
        before=list(c.events)
        with c.patches(),patch.object(deploy,"verified_current_source_plan") as plan:
            with self.assertRaisesRegex(RuntimeError,"RECOVERY"):
                self.apply()
        plan.assert_not_called()
        self.assertEqual(c.events,before)

    def test_failed_migration_is_not_a_prepared_schema(self):
        c=self.make_case()
        with c.patches(migrate_error="MIGRATION_FAILED"):
            with self.assertRaisesRegex(RuntimeError,"MIGRATION_FAILED"):
                self.apply()
        saved=json.loads(self.journal.read_text())
        self.assertEqual(saved["schemaState"],"UNKNOWN")
        self.assertEqual(saved["migrationSettlement"]["outcome"],"UNCONFIRMED")
        self.assertTrue(saved["recoveryRequired"])
        self.assertFalse(any(e[0] in ("fence-allow","start","restore-units","fence-remove") for e in c.events))

    def test_already_applied_schema_requires_no_staging_pause(self):
        c=self.make_case();c.prefix=50
        with c.patches():
            with self.assertRaisesRegex(RuntimeError,"CURRENT_SCHEMA_PAUSE_REQUIRES_PENDING_MIGRATIONS"):
                self.apply()
        self.assertTrue(all(e[0]=="prefix" for e in c.events))
        self.assertFalse(self.journal.exists())

    def test_pause_checkpoint_loss_keeps_unconfirmed_state_and_never_starts(self):
        c=self.make_case();real_write=deploy.write_json_durable
        class PowerLoss(BaseException):pass
        def fail_completion(path,value):
            if value.get("migrationSettlement",{}).get("outcome")=="COMPLETED":
                raise PowerLoss("completion lost")
            return real_write(path,value)
        with c.patches(),patch.object(deploy,"write_json_durable",side_effect=fail_completion):
            with self.assertRaises(PowerLoss):self.apply()
        self.assertEqual(json.loads(self.journal.read_text())["schemaState"],"UNKNOWN")
        self.assertFalse(any(e[0] in ("fence-allow","start","restore-units","fence-remove") for e in c.events))

    def test_cli_pause_retains_apply_authority_and_exact_identity(self):
        c=CurrentCliAuthorityTests("test_current_apply_routes_exact_identity_after_authority")
        c.setUp();self.addCleanup(c.doCleanups)
        argv=c.argv("current-apply")+["--pause-after-migration"]
        with patch.object(deploy,"current_apply_engine") as engine,patch.object(deploy,"current_trusted_evidence_root") as root:
            with self.assertRaisesRegex(RuntimeError,"CURRENT_DEPLOY_AUTHORIZATION_REQUIRED"):
                deploy.current_cli(argv)
        engine.assert_not_called();root.assert_not_called()
        c.write_authority(modes=("apply",))
        evidence=c.root/"prepared";evidence.mkdir()
        with c.root_owned_authority_metadata(),patch.object(deploy,"current_trusted_evidence_root",return_value=evidence),patch.object(deploy,"current_apply_engine",return_value={"status":"CURRENT_SCHEMA_PREPARED","recoveryRequired":True}) as engine:
            result=deploy.current_cli(argv)
        self.assertEqual(result["authorityMode"],"apply")
        self.assertTrue(engine.call_args.kwargs["pause_after_migration"])
        self.assertEqual(engine.call_args.kwargs["expected_source_sha"],c.sha)
        self.assertTrue(result["recoveryRequired"])

    def test_cli_pause_is_not_valid_for_plan_or_recover(self):
        import io
        c=CurrentCliAuthorityTests("test_current_plan_is_read_only_route_without_live_authority")
        c.setUp();self.addCleanup(c.doCleanups)
        for mode in ("current-plan","current-recover"):
            with self.subTest(mode=mode),patch("sys.stderr",new=io.StringIO()),patch.object(deploy,"current_require_cli_authority") as authority:
                with self.assertRaises(SystemExit):
                    deploy.current_cli(c.argv(mode)+["--pause-after-migration"])
                authority.assert_not_called()


class CurrentTerminalDurabilityTests(unittest.TestCase):
    def scenario(self, mode):
        if mode in ('apply','rollback'):
            case=CurrentApplyEngineTests()
            case.setUp();self.addCleanup(case.doCleanups)
            case.evidence=case.root/'apply-terminal';case.evidence.mkdir()
            case.journal=case.root/'deployment-state.json'
            if mode=='rollback':case.prefix=50
            patches=lambda:case.patches(health_error='HEALTH_FAILED' if mode=='rollback' else None)
            invoke=lambda:deploy.current_apply_engine(
                candidate_release=case.release,expected_source_sha='a'*40,
                expected_source_tree='b'*40,expected_inventory_sha256='c'*64,
                evidence_root=case.root,journal=case.journal,evidence_dir=case.evidence,
            )
        else:
            case=CurrentCrashRecoveryTests()
            case.setUp();self.addCleanup(case.doCleanups)
            case.events=[]
            if mode=='forward':
                case.forward_state()
                # Cleanup must bind the separately authorized destination, too.
                case.plan.update(sourceSha='d'*40,sourceTree='e'*40,trustedInventorySha256='f'*64)
                patches=lambda:case.forward_patches(case.events)
            else:
                case.write_state('PREDEPLOY_VERIFIED')
                patches=lambda:case.patch_common(case.events)
            invoke=case.recover_forward_target
        return case,patches,invoke

    def recover(self, case):
        return deploy.current_recover_engine(
            candidate_release=case.release,expected_source_sha=case.plan['sourceSha'],
            expected_source_tree=case.plan['sourceTree'],
            expected_inventory_sha256=case.plan['trustedInventorySha256'],
            evidence_root=case.root,journal=case.journal,
        )

    def forbid_operational_replay(self):
        stack=ExitStack()
        for name in (
            'database_url','check_migration_prefix_for_release','migrate','backup_live',
            'current_stop_product_units','current_start_product_units','current_write_dropins',
            'current_restore_dropins','current_restore_unit_states','current_restore_live_backup',
            'current_prepare_recovery_fence','current_enable_fenced_start',
            'current_disable_fenced_start','current_wait_runtime','current_verify_loaded_plan',
        ):
            stack.enter_context(patch.object(deploy,name,side_effect=AssertionError('OPERATIONAL_REPLAY:'+name)))
        return stack

    def test_all_terminal_paths_commit_receipt_and_journal_before_fence_removal(self):
        for mode in ('apply','rollback','forward','baseline'):
            with self.subTest(mode=mode):
                case,patches,invoke=self.scenario(mode)
                observations=[]
                def remove(plan):
                    state=json.loads(case.journal.read_text())
                    self.assertEqual(state['phase'],'TERMINAL_COMMITTED')
                    self.assertIs(state['recoveryRequired'],True)
                    self.assertEqual(state['trustedInventorySha256'],plan['trustedInventorySha256'])
                    path=Path(state['terminalIntent']['receipt'])
                    raw=path.read_bytes();receipt=json.loads(raw)
                    self.assertEqual(deploy.hashlib.sha256(raw).hexdigest(),state['terminalIntent']['sha256'])
                    self.assertEqual(receipt['terminalId'],state['terminalIntent']['id'])
                    self.assertIs(receipt['recoveryRequired'],False)
                    observations.append(receipt)
                with patches(),patch.object(deploy,'current_remove_reboot_fence',side_effect=remove):
                    if mode=='rollback':
                        with self.assertRaisesRegex(RuntimeError,'HEALTH_FAILED'):invoke()
                    else:invoke()
                self.assertEqual(len(observations),1)
                state=json.loads(case.journal.read_text())
                self.assertFalse(state['recoveryRequired'])
                self.assertFalse(state['fenceCleanupRequired'])
                self.assertEqual(json.loads(Path(state['receipt']).read_text()),observations[0])

    def test_split_commit_and_cleanup_failures_retry_only_cleanup_without_overwriting_success(self):
        real_write=deploy.write_json_durable
        for mode in ('apply','rollback','forward','baseline'):
            for fault in ('commit','cleanup','complete'):
                with self.subTest(mode=mode,fault=fault):
                    case,patches,invoke=self.scenario(mode)
                    at_failure=[]
                    def fail():
                        at_failure.append(list(case.events))
                        raise OSError('TERMINAL_IO_FAILURE')
                    def write(path,value):
                        if path==case.journal and (
                            (fault=='commit' and value.get('phase')=='TERMINAL_COMMITTED')
                            or (fault=='complete' and value.get('fenceCleanupRequired') is False)
                        ):fail()
                        return real_write(path,value)
                    def remove(plan):
                        if fault=='cleanup':fail()
                    with patches(),patch.object(deploy,'write_json_durable',side_effect=write), \
                         patch.object(deploy,'current_remove_reboot_fence',side_effect=remove):
                        with self.assertRaisesRegex(OSError,'TERMINAL_IO_FAILURE'):invoke()
                    self.assertEqual(case.events,at_failure[0])
                    state=json.loads(case.journal.read_text())
                    path=Path(state['terminalIntent']['receipt']);original=path.read_bytes()
                    self.assertIn(json.loads(original)['phase'],deploy.CURRENT_TERMINAL_PHASES)
                    with patches(),self.forbid_operational_replay(), \
                         patch.object(deploy,'current_remove_reboot_fence') as cleanup:
                        recovered=self.recover(case)
                    cleanup.assert_called_once_with(case.plan)
                    self.assertEqual(path.read_bytes(),original)
                    self.assertEqual(recovered,json.loads(original))
                    self.assertFalse(json.loads(case.journal.read_text())['recoveryRequired'])

    def test_crash_before_terminal_receipt_requires_reconciliation_without_replay(self):
        real_write=deploy.write_json_durable
        for mode in ('apply','rollback','forward','baseline'):
            with self.subTest(mode=mode):
                case,patches,invoke=self.scenario(mode)
                def write(path,value):
                    if 'terminalId' in value:raise OSError('TERMINAL_FILE_LOST')
                    return real_write(path,value)
                with patches(),patch.object(deploy,'write_json_durable',side_effect=write), \
                     patch.object(deploy,'current_remove_reboot_fence') as cleanup:
                    with self.assertRaisesRegex(OSError,'TERMINAL_FILE_LOST'):invoke()
                cleanup.assert_not_called()
                before=case.journal.read_bytes()
                with patches(),self.forbid_operational_replay(), \
                     patch.object(deploy,'current_remove_reboot_fence') as cleanup:
                    with self.assertRaisesRegex(RuntimeError,'CURRENT_TERMINAL_RECEIPT_UNCONFIRMED'):
                        self.recover(case)
                cleanup.assert_not_called();self.assertEqual(case.journal.read_bytes(),before)

    def test_terminal_cleanup_rejects_tampered_identity_receipt_and_path(self):
        real_write=deploy.write_json_durable
        for fault in ('inventory','tree','receipt','path','id'):
            with self.subTest(fault=fault):
                case,patches,invoke=self.scenario('apply')
                def write(path,value):
                    if path==case.journal and value.get('phase')=='TERMINAL_COMMITTED':
                        raise OSError('COMMIT_LOST')
                    return real_write(path,value)
                with patches(),patch.object(deploy,'write_json_durable',side_effect=write):
                    with self.assertRaisesRegex(OSError,'COMMIT_LOST'):invoke()
                state=json.loads(case.journal.read_text());intent=state['terminalIntent']
                if fault=='inventory':state['trustedInventorySha256']='d'*64
                elif fault=='tree':intent['candidateSourceTree']='f'*40
                elif fault=='receipt':Path(intent['receipt']).write_text('{}')
                elif fault=='path':intent['receipt']=str(case.root/'outside.json')
                else:intent['id']='e'*32
                real_write(case.journal,state);before=case.journal.read_bytes()
                with patches(),self.forbid_operational_replay(), \
                     patch.object(deploy,'current_remove_reboot_fence') as cleanup:
                    with self.assertRaises(RuntimeError):self.recover(case)
                cleanup.assert_not_called();self.assertEqual(case.journal.read_bytes(),before)

    def test_journal_inventory_must_match_original_receipt_before_any_recovery_action(self):
        for mode in ('baseline','forward'):
            for value in (None,'f'*64,'INVALID'):
                with self.subTest(mode=mode,value=value):
                    case,patches,_=self.scenario(mode)
                    state=json.loads(case.journal.read_text())
                    if value is None:state.pop('trustedInventorySha256')
                    else:state['trustedInventorySha256']=value
                    case.journal.write_text(json.dumps(state));before=case.journal.read_bytes()
                    with patches(),self.forbid_operational_replay(), \
                         patch.object(deploy,'current_remove_reboot_fence') as cleanup:
                        with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_IDENTITY_MISMATCH'):
                            self.recover(case)
                    cleanup.assert_not_called();self.assertEqual(case.journal.read_bytes(),before)

    def test_cleanup_does_not_remove_an_unrelated_fence_replacement(self):
        case=CurrentRebootFenceSafetyTests();case.setUp();self.addCleanup(case.doCleanups)
        with patch.object(deploy,'run') as run:
            deploy.current_install_reboot_fence(case.plan)
            paths=list(deploy.current_fence_paths(case.plan).values())
            paths[-1].write_text('[Unit]\nConditionPathExists=/different-owner\n')
            run.reset_mock()
            with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                deploy.current_remove_reboot_fence(case.plan)
            self.assertTrue(all(p.exists() for p in paths));run.assert_not_called()


class CurrentFenceOwnershipTests(unittest.TestCase):
    def setUp(self):
        self.case=CurrentRebootFenceSafetyTests()
        self.case.setUp();self.addCleanup(self.case.doCleanups)
        self.plan=self.case.plan
        self.run=patch.object(deploy,'run').start()
        self.addCleanup(patch.stopall)
        deploy.current_install_reboot_fence(self.plan)
        self.paths=list(deploy.current_fence_paths(self.plan).values())
        self.run.reset_mock()

    def replacement(self,path,content=b'foreign-owner\n'):
        source=path.with_name('foreign-publication')
        source.write_bytes(content);os.chmod(source,0o644)
        os.replace(source,path)

    def test_atomic_replacement_after_validation_never_deletes_foreign_bytes(self):
        real_sync=os.fsync
        target=self.paths[-1];injected=[]
        def sync(fd):
            if not injected:
                injected.append(True);self.replacement(target)
            return real_sync(fd)
        with patch.object(deploy.os,'fsync',side_effect=sync):
            with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                deploy.current_remove_reboot_fence(self.plan)
        self.assertEqual(injected,[True])
        self.assertEqual(target.read_bytes(),b'foreign-owner\n')
        self.assertTrue(all(p.exists() for p in self.paths))
        self.run.assert_not_called()
        # The captured foreign identity is not silently adopted on a retry.
        with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
            deploy.current_remove_reboot_fence(self.plan)
        self.assertEqual(target.read_bytes(),b'foreign-owner\n')

    def test_same_bytes_different_inode_after_validation_are_also_a_conflict(self):
        real_sync=os.fsync;target=self.paths[-1]
        before=target.stat().st_ino;data=target.read_bytes();injected=[]
        def sync(fd):
            if not injected:
                injected.append(True);self.replacement(target,data)
            return real_sync(fd)
        with patch.object(deploy.os,'fsync',side_effect=sync):
            with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                deploy.current_remove_reboot_fence(self.plan)
        self.assertEqual(target.read_bytes(),data)
        self.assertNotEqual(target.stat().st_ino,before)
        self.run.assert_not_called()

    def test_replacement_at_atomic_claim_is_restored_without_deletion(self):
        target=self.paths[0];real_rename=os.rename;injected=[]
        def rename(source,destination,*args,**kwargs):
            if Path(source)==target and not injected:
                injected.append(True);self.replacement(target)
            return real_rename(source,destination,*args,**kwargs)
        with patch.object(deploy.os,'rename',side_effect=rename):
            with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                deploy.current_remove_reboot_fence(self.plan)
        self.assertEqual(injected,[True]);self.assertEqual(target.read_bytes(),b'foreign-owner\n')
        self.run.assert_not_called()

    def test_new_public_path_during_private_unlink_is_never_unlinked(self):
        target=self.paths[0];real_unlink=Path.unlink;injected=[]
        def unlink(path,*args,**kwargs):
            if path.name=='entry' and not injected:
                injected.append(True);self.replacement(target)
            return real_unlink(path,*args,**kwargs)
        with patch.object(Path,'unlink',unlink):
            with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                deploy.current_remove_reboot_fence(self.plan)
        self.assertEqual(injected,[True]);self.assertEqual(target.read_bytes(),b'foreign-owner\n')
        self.run.assert_not_called()

    def test_conflicting_capture_and_new_path_preserve_both_objects(self):
        target=self.paths[0];real_rename=os.rename;captured=[]
        def rename(source,destination,*args,**kwargs):
            if Path(source)==target and not captured:
                self.replacement(target,b'foreign-before-claim\n')
                result=real_rename(source,destination,*args,**kwargs)
                captured.append(Path(destination))
                self.replacement(target,b'foreign-after-claim\n')
                return result
            return real_rename(source,destination,*args,**kwargs)
        with patch.object(deploy.os,'rename',side_effect=rename):
            with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                deploy.current_remove_reboot_fence(self.plan)
        self.assertEqual(captured[0].read_bytes(),b'foreign-before-claim\n')
        self.assertEqual(target.read_bytes(),b'foreign-after-claim\n')
        self.run.assert_not_called()

    def test_foreign_allow_is_not_removed_by_disable_recovery_or_terminal_cleanup(self):
        path=deploy.CURRENT_FENCE_ALLOW;path.write_bytes(b'other operation\n');os.chmod(path,0o600)
        for action in (deploy.current_disable_fenced_start,
                       lambda:deploy.current_prepare_recovery_fence(self.plan),
                       lambda:deploy.current_remove_reboot_fence(self.plan)):
            with self.subTest(action=action),self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                action()
            self.assertEqual(path.read_bytes(),b'other operation\n')
            self.assertTrue(all(p.exists() for p in self.paths))
        self.run.assert_not_called()

    def test_allow_replacement_between_validation_and_claim_is_preserved(self):
        deploy.current_enable_fenced_start();target=deploy.CURRENT_FENCE_ALLOW
        real_rename=os.rename;injected=[]
        def rename(source,destination,*args,**kwargs):
            if Path(source)==target and not injected:
                injected.append(True);self.replacement(target);os.chmod(target,0o600)
            return real_rename(source,destination,*args,**kwargs)
        with patch.object(deploy.os,'rename',side_effect=rename):
            with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                deploy.current_disable_fenced_start()
        self.assertEqual(injected,[True]);self.assertEqual(target.read_bytes(),b'foreign-owner\n')

    def test_installation_cannot_overwrite_concurrent_publisher(self):
        deploy.current_remove_reboot_fence(self.plan);self.run.reset_mock()
        target=self.paths[0];real_link=os.link;injected=[]
        def link(source,destination,*args,**kwargs):
            if Path(destination)==target and not injected:
                injected.append(True);self.replacement(target)
            return real_link(source,destination,*args,**kwargs)
        with patch.object(deploy.os,'link',side_effect=link):
            with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
                deploy.current_install_reboot_fence(self.plan)
        self.assertEqual(injected,[True]);self.assertEqual(target.read_bytes(),b'foreign-owner\n')
        self.run.assert_not_called()

    def test_all_supported_writers_share_one_nonblocking_kernel_lock(self):
        lock=deploy.CURRENT_DROPIN_ROOT/'.octoport-current-fence.lock'
        fd=os.open(lock,os.O_RDWR)
        try:
            deploy.fcntl.flock(fd,deploy.fcntl.LOCK_EX|deploy.fcntl.LOCK_NB)
            for action in (lambda:deploy.current_install_reboot_fence(self.plan),
                           deploy.current_enable_fenced_start,deploy.current_disable_fenced_start,
                           lambda:deploy.current_prepare_recovery_fence(self.plan),
                           lambda:deploy.current_remove_reboot_fence(self.plan)):
                with self.subTest(action=action),self.assertRaisesRegex(RuntimeError,'CURRENT_FENCE_WRITER_BUSY'):
                    action()
        finally:os.close(fd)
        self.assertTrue(all(p.exists() for p in self.paths));self.run.assert_not_called()

    def test_owned_cleanup_resumes_after_interruptions_without_operational_replay(self):
        class PowerLoss(BaseException):pass
        for phase in ('before-claim','after-claim','after-private-delete'):
            with self.subTest(phase=phase):
                real_rename=os.rename;real_unlink=Path.unlink;injected=[]
                def rename(source,destination,*args,**kwargs):
                    if Path(source)==self.paths[0] and not injected:
                        injected.append(True)
                        if phase=='before-claim':raise PowerLoss()
                        result=real_rename(source,destination,*args,**kwargs)
                        raise PowerLoss()
                    return real_rename(source,destination,*args,**kwargs)
                def unlink(path,*args,**kwargs):
                    result=real_unlink(path,*args,**kwargs)
                    if path.name=='entry' and not injected:
                        injected.append(True);raise PowerLoss()
                    return result
                mutation=patch.object(Path,'unlink',unlink) if phase=='after-private-delete' else patch.object(deploy.os,'rename',side_effect=rename)
                with mutation,self.assertRaises(PowerLoss):deploy.current_remove_reboot_fence(self.plan)
                self.assertEqual(injected,[True]);self.run.assert_not_called()
                deploy.current_remove_reboot_fence(self.plan)
                self.assertTrue(all(not p.exists() for p in self.paths))
                self.run.assert_called_once_with(['systemctl','daemon-reload'])
                deploy.current_install_reboot_fence(self.plan);self.run.reset_mock()

    def test_symlinked_private_claim_is_not_followed_or_restored(self):
        target=self.paths[0];outside=self.case.root/'outside';outside.mkdir()
        (outside/'entry').write_bytes(b'outside bytes\n')
        deploy._current_fence_claim(target).symlink_to(outside,target_is_directory=True)
        before=target.read_bytes()
        with self.assertRaisesRegex(RuntimeError,'CURRENT_RECOVERY_FENCE_CONFLICT'):
            deploy.current_remove_reboot_fence(self.plan)
        self.assertEqual(target.read_bytes(),before)
        self.assertEqual((outside/'entry').read_bytes(),b'outside bytes\n')
        self.run.assert_not_called()

    def test_repeated_cleanup_is_idempotent_and_does_not_recreate_allow(self):
        deploy.current_enable_fenced_start()
        deploy.current_remove_reboot_fence(self.plan)
        deploy.current_remove_reboot_fence(self.plan)
        self.assertFalse(deploy.CURRENT_FENCE_ALLOW.exists())
        self.assertTrue(all(not p.exists() for p in self.paths))
        self.assertEqual(self.run.call_count,2)


if __name__ == "__main__":
    unittest.main()
