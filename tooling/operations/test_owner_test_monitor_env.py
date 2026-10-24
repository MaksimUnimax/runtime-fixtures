from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "owner_test_monitor_env", HERE / "owner_test_monitor_env.py"
)
assert SPEC and SPEC.loader
monitor = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = monitor
SPEC.loader.exec_module(monitor)


class MonitorEnvProvisionerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="octoport-monitor-env-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        os.chmod(self.root, 0o700)
        self.uid = os.getuid()
        self.gid = os.getgid()
        self.shared = self.root / "api.env"
        self.shared.write_text(
            "DATABASE_URL=postgres://product-secret@example.invalid/db\n",
            encoding="utf-8",
        )
        os.chmod(self.shared, 0o600)
        self.binding = {
            "authorizationId": "synthetic-authority",
            "sourceSha": "a" * 40,
            "sourceTree": "b" * 40,
            "trustedInventorySha256": "c" * 64,
        }
        self.provisioner = monitor.MonitorEnvProvisioner(
            self.binding,
            self.root,
            owner_uid=self.uid,
            owner_gid=self.gid,
        )
        self.payload = {
            "MONITOR_HEALTH_READ_DATABASE_URL": (
                "postgres://octoport_monitor_pilot:%25secret@example.invalid/"
                "octoport_monitor_pilot?sslmode=require"
            ),
            "MONITOR_HEALTH_READ_EXPECTED_ROLE": "octoport_monitor_pilot",
        }

    def state(self):
        return self.root / ".api-monitor.env.rollback-state.json"

    def test_install_absent_is_private_exact_bound_and_rollback_removes_target(self):
        result = self.provisioner.install(self.payload)
        self.assertEqual(result["status"], "MONITOR_ENV_INSTALL_PASS")
        self.assertEqual(result["previous"], "ABSENT")
        self.assertEqual(result["keys"], list(monitor.MONITOR_KEYS))
        self.assertNotIn("%25secret", json.dumps(result))
        target = self.root / "api-monitor.env"
        self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        self.assertEqual(target.stat().st_uid, self.uid)
        self.assertEqual(target.stat().st_gid, self.gid)
        self.assertEqual(
            [line.split("=", 1)[0] for line in target.read_text().splitlines()],
            list(monitor.MONITOR_KEYS),
        )
        state = json.loads(self.state().read_text())
        self.assertEqual(state["authorizationId"], self.binding["authorizationId"])
        self.assertEqual(state["sourceSha"], self.binding["sourceSha"])
        self.assertEqual(state["previous"], {"kind": "ABSENT"})
        self.assertEqual(
            state["installedSha256"],
            monitor.hashlib.sha256((self.root / "api-monitor.env").read_bytes()).hexdigest(),
        )
        rollback = self.provisioner.rollback()
        self.assertEqual(rollback["status"], "MONITOR_ENV_ROLLBACK_PASS")
        self.assertEqual(rollback["restored"], "ABSENT")
        self.assertFalse(target.exists())
        self.assertFalse(self.state().exists())

    def test_existing_private_target_is_restored_byte_for_byte_from_bound_state(self):
        target = self.root / "api-monitor.env"
        previous = b"OLD_PRIVATE_SENTINEL=keep-exact\n"
        target.write_bytes(previous)
        os.chmod(target, 0o600)
        result = self.provisioner.install(self.payload)
        self.assertEqual(result["previous"], "PRESENT")
        state = json.loads(self.state().read_text())
        self.assertEqual(state["previous"]["kind"], "PRESENT")
        self.assertNotIn("keep-exact", self.state().read_text())
        self.provisioner.rollback()
        self.assertEqual(target.read_bytes(), previous)
        self.assertFalse(self.state().exists())

    def test_commit_discards_state_without_exposing_secret(self):
        self.provisioner.install(self.payload)
        result = self.provisioner.commit()
        self.assertEqual(result["status"], "MONITOR_ENV_COMMIT_PASS")
        self.assertNotIn("secret", json.dumps(result).lower())
        self.assertFalse(self.state().exists())
        self.assertTrue((self.root / "api-monitor.env").exists())

    def test_commit_rejects_same_keys_with_changed_installed_bytes(self):
        self.provisioner.install(self.payload)
        target = self.root / "api-monitor.env"
        installed_bytes = target.read_bytes()
        changed = dict(self.payload)
        changed["MONITOR_HEALTH_READ_DATABASE_URL"] = (
            "postgres://octoport_monitor_pilot:changed@example.invalid/"
            "octoport_monitor_pilot?sslmode=require"
        )
        target.write_bytes(monitor.render_monitor_env(changed))
        os.chmod(target, 0o600)
        with self.assertRaisesRegex(
            monitor.MonitorEnvError, "MONITOR_ENV_READBACK_INVALID"
        ):
            self.provisioner.commit()
        self.assertTrue(self.state().exists())
        target.write_bytes(installed_bytes)
        os.chmod(target, 0o600)
        self.provisioner.rollback()

    def test_rollback_rejects_changed_installed_bytes_and_retains_state(self):
        self.provisioner.install(self.payload)
        target = self.root / "api-monitor.env"
        changed = dict(self.payload)
        changed["MONITOR_HEALTH_READ_DATABASE_URL"] = (
            "postgres://octoport_monitor_pilot:changed@example.invalid/"
            "octoport_monitor_pilot?sslmode=require"
        )
        changed_bytes = monitor.render_monitor_env(changed)
        target.write_bytes(changed_bytes)
        os.chmod(target, 0o600)
        with self.assertRaisesRegex(
            monitor.MonitorEnvError, "MONITOR_ENV_ROLLBACK_TARGET_MISMATCH"
        ):
            self.provisioner.rollback()
        self.assertEqual(target.read_bytes(), changed_bytes)
        self.assertTrue(self.state().exists())

    def test_rollback_rejects_missing_installed_target_and_retains_state(self):
        self.provisioner.install(self.payload)
        target = self.root / "api-monitor.env"
        target.unlink()
        with self.assertRaisesRegex(
            monitor.MonitorEnvError, "MONITOR_ENV_REQUIRED_FILE_MISSING"
        ):
            self.provisioner.rollback()
        self.assertFalse(target.exists())
        self.assertTrue(self.state().exists())

    def test_transaction_identity_mismatch_blocks_commit_and_rollback(self):
        self.provisioner.install(self.payload)
        other = monitor.MonitorEnvProvisioner(
            {**self.binding, "sourceSha": "d" * 40},
            self.root,
            owner_uid=self.uid,
            owner_gid=self.gid,
        )
        for action in (other.commit, other.rollback):
            with self.assertRaisesRegex(
                monitor.MonitorEnvError, "MONITOR_ENV_ROLLBACK_STATE_INVALID"
            ):
                action()
        self.assertTrue(self.state().exists())
        self.provisioner.rollback()

    def test_shared_api_env_monitor_key_leak_fails_before_snapshot(self):
        self.shared.write_text(
            "DATABASE_URL=postgres://product.invalid/db\n"
            "MONITOR_HEALTH_READ_EXPECTED_ROLE=should-not-be-here\n",
            encoding="utf-8",
        )
        os.chmod(self.shared, 0o600)
        with self.assertRaisesRegex(
            monitor.MonitorEnvError, "MONITOR_ENV_KEY_LEAK_IN_SHARED_API_ENV"
        ):
            self.provisioner.install(self.payload)
        self.assertFalse((self.root / "api-monitor.env").exists())
        self.assertFalse(self.state().exists())

    def test_payload_requires_exact_pair_role_and_monitor_database_identity(self):
        cases = [
            {},
            {"MONITOR_HEALTH_READ_DATABASE_URL": "x"},
            {**self.payload, "EXTRA": "x"},
            {**self.payload, "MONITOR_HEALTH_READ_DATABASE_URL": "x\ny"},
            {**self.payload, "MONITOR_HEALTH_READ_EXPECTED_ROLE": "bad-role!"},
            {
                **self.payload,
                "MONITOR_HEALTH_READ_EXPECTED_ROLE": "octoport_monitor_reader",
                "MONITOR_HEALTH_READ_DATABASE_URL": (
                    "postgres://octoport_monitor_reader@example.invalid/"
                    "octoport_monitor_pilot"
                ),
            },
            {
                **self.payload,
                "MONITOR_HEALTH_READ_DATABASE_URL": (
                    "postgres://other@example.invalid/octoport_monitor_pilot"
                ),
            },
            {
                **self.payload,
                "MONITOR_HEALTH_READ_DATABASE_URL": (
                    "postgres://octoport_monitor_pilot@example.invalid/product_db"
                ),
            },
            {
                **self.payload,
                "MONITOR_HEALTH_READ_DATABASE_URL": (
                    "https://octoport_monitor_pilot@example.invalid/octoport_monitor_pilot"
                ),
            },
        ]
        for case in cases:
            with self.subTest(case=case):
                with self.assertRaisesRegex(
                    monitor.MonitorEnvError, "MONITOR_ENV_INPUT_INVALID"
                ):
                    monitor.render_monitor_env(case)

    def test_transaction_pending_prevents_second_install(self):
        self.provisioner.install(self.payload)
        with self.assertRaisesRegex(
            monitor.MonitorEnvError, "MONITOR_ENV_TRANSACTION_PENDING"
        ):
            self.provisioner.install(self.payload)
        self.provisioner.rollback()

    def test_post_write_readback_failure_rolls_back_absent_target(self):
        target = self.root / "api-monitor.env"
        with patch.object(
            monitor,
            "_verify_target",
            side_effect=monitor.MonitorEnvError("MONITOR_ENV_READBACK_INVALID"),
        ):
            with self.assertRaisesRegex(
                monitor.MonitorEnvError, "MONITOR_ENV_READBACK_INVALID"
            ):
                self.provisioner.install(self.payload)
        self.assertFalse(target.exists())
        self.assertFalse(self.state().exists())

    def test_commit_rejects_monitor_key_added_to_shared_env(self):
        self.provisioner.install(self.payload)
        self.shared.write_text(
            "DATABASE_URL=postgres://product.invalid/db\n"
            "MONITOR_HEALTH_READ_DATABASE_URL=must-not-leak\n",
            encoding="utf-8",
        )
        os.chmod(self.shared, 0o600)
        with self.assertRaisesRegex(
            monitor.MonitorEnvError, "MONITOR_ENV_KEY_LEAK_IN_SHARED_API_ENV"
        ):
            self.provisioner.commit()
        self.assertTrue(self.state().exists())
        self.shared.write_text("DATABASE_URL=x\n", encoding="utf-8")
        os.chmod(self.shared, 0o600)
        self.provisioner.rollback()

    def test_symlink_target_is_rejected_without_following(self):
        outside = self.root / "outside"
        outside.write_text("do-not-touch", encoding="utf-8")
        target = self.root / "api-monitor.env"
        target.symlink_to(outside)
        with self.assertRaisesRegex(monitor.MonitorEnvError, "MONITOR_ENV_FILE_INVALID"):
            self.provisioner.install(self.payload)
        self.assertEqual(outside.read_text(), "do-not-touch")
        self.assertTrue(target.is_symlink())

    def test_wrong_mode_existing_target_is_rejected(self):
        target = self.root / "api-monitor.env"
        target.write_text("OLD=1\n", encoding="utf-8")
        os.chmod(target, 0o640)
        with self.assertRaisesRegex(monitor.MonitorEnvError, "MONITOR_ENV_FILE_INVALID"):
            self.provisioner.install(self.payload)
        self.assertFalse(self.state().exists())

    def test_shared_env_is_required_private_and_duplicate_keys_fail_closed(self):
        os.chmod(self.shared, 0o644)
        with self.assertRaisesRegex(monitor.MonitorEnvError, "MONITOR_ENV_FILE_INVALID"):
            self.provisioner.install(self.payload)
        os.chmod(self.shared, 0o600)
        self.shared.write_text("DATABASE_URL=x\nDATABASE_URL=y\n", encoding="utf-8")
        with self.assertRaisesRegex(monitor.MonitorEnvError, "MONITOR_ENV_FORMAT_INVALID"):
            self.provisioner.install(self.payload)

    def test_render_escapes_quote_and_backslash_without_new_keys(self):
        payload = dict(self.payload)
        payload["MONITOR_HEALTH_READ_DATABASE_URL"] = (
            'postgres://octoport_monitor_pilot:p%5Cq%22@example.invalid/'
            'octoport_monitor_pilot?x=\\\\"'
        )
        rendered = monitor.render_monitor_env(payload)
        self.assertEqual(monitor._env_key_names(rendered), list(monitor.MONITOR_KEYS))
        self.assertEqual(rendered.count(b"\n"), 2)

    def test_authority_requires_exact_apply_source_identity_and_private_file(self):
        authority = self.root / "authority.json"
        value = {
            "status": "AUTHORIZED",
            "scope": "B05_CURRENT_FOUR_SERVICE_DEPLOY",
            "authorizationId": self.binding["authorizationId"],
            "allowedModes": ["apply", "recover"],
            "sourceSha": self.binding["sourceSha"],
            "sourceTree": self.binding["sourceTree"],
            "trustedInventorySha256": self.binding["trustedInventorySha256"],
        }
        authority.write_text(json.dumps(value), encoding="utf-8")
        os.chmod(authority, 0o600)
        observed = monitor.require_apply_authority(
            expected_source_sha=self.binding["sourceSha"],
            expected_source_tree=self.binding["sourceTree"],
            expected_inventory_sha256=self.binding["trustedInventorySha256"],
            path=authority,
            owner_uid=self.uid,
        )
        self.assertEqual(observed, self.binding)
        with self.assertRaisesRegex(
            monitor.MonitorEnvError, "MONITOR_ENV_AUTHORIZATION_INVALID"
        ):
            monitor.require_apply_authority(
                expected_source_sha="d" * 40,
                expected_source_tree=self.binding["sourceTree"],
                expected_inventory_sha256=self.binding["trustedInventorySha256"],
                path=authority,
                owner_uid=self.uid,
            )
        os.chmod(authority, 0o640)
        with self.assertRaisesRegex(
            monitor.MonitorEnvError, "MONITOR_ENV_AUTHORIZATION_INVALID"
        ):
            monitor.require_apply_authority(
                expected_source_sha=self.binding["sourceSha"],
                expected_source_tree=self.binding["sourceTree"],
                expected_inventory_sha256=self.binding["trustedInventorySha256"],
                path=authority,
                owner_uid=self.uid,
            )


if __name__ == "__main__":
    unittest.main()
