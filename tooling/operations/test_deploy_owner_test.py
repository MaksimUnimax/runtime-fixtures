#!/usr/bin/env python3
"""Failure injection only: no Docker, systemd, network or live credentials."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

TARGET = Path(os.environ.get("OCTOPORT_DEPLOY_TEST_TARGET",
    str(Path(__file__).with_name("deploy_owner_test.py"))))
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
        apply_dir = deploy.EVID / "apply-fixture"
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
    def test_failed_stop_attempts_remaining_units_and_never_claims_quiescence(self):
        def stop(args, **kwargs):
            if args[-1] == deploy.UNITS[-1]:
                raise RuntimeError("SYSTEMCTL_FAILED")
        def state(unit, prop):
            return "active" if unit == deploy.UNITS[-1] else "inactive"
        with patch.object(deploy, "run", side_effect=stop) as command:
            with patch.object(deploy, "unit_prop", side_effect=state):
                with self.assertRaisesRegex(RuntimeError, "PRODUCT_UNITS_NOT_QUIESCED"):
                    deploy.stop_product_units()
        self.assertEqual([call.args[0][-1] for call in command.call_args_list],
                         list(reversed(deploy.UNITS)))



if __name__ == "__main__":
    unittest.main()
