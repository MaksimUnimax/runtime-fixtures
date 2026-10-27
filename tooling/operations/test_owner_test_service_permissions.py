#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path

SOURCE = Path(__file__).with_name("owner_test_service_permissions.py")
sys.path.insert(0, str(SOURCE.parent))
SPEC = importlib.util.spec_from_file_location("permissions", SOURCE)
assert SPEC and SPEC.loader
p = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(p)

SHA = "a" * 40
ROOT = Path("/opt/octoport/ops-releases") / SHA

class PermissionHelpersTest(unittest.TestCase):
    def test_working_directory_requires_pinned_release(self):
        root, sha, working = p.parse_working_directory(str(ROOT / "apps/portal"))
        self.assertEqual(root, ROOT)
        self.assertEqual(sha, SHA)
        self.assertEqual(working, ROOT / "apps/portal")
        with self.assertRaisesRegex(p.ProbeError, "WORKING_DIRECTORY_NOT_PINNED_RELEASE"):
            p.parse_working_directory("/srv/current")

    def test_working_directory_rejects_noncanonical_release_paths(self):
        for path in (
            str(ROOT) + "/../../../../etc",
            str(ROOT) + "/apps/../api",
            str(ROOT) + "/apps/./api",
            str(ROOT) + "/apps//api",
            str(ROOT) + "/",
        ):
            with self.subTest(path=path):
                with self.assertRaisesRegex(
                    p.ProbeError, "WORKING_DIRECTORY_NOT_PINNED_RELEASE"
                ):
                    p.parse_working_directory(path)

    def test_environment_files_consume_every_entry(self):
        value = (
            "/etc/seller-agents-owner-test/api.env (ignore_errors=no) "
            "/unexpected/extra-config (ignore_errors=yes)"
        )
        self.assertEqual(
            p.parse_environment_files(value),
            [
                Path("/etc/seller-agents-owner-test/api.env"),
                Path("/unexpected/extra-config"),
            ],
        )
        with self.assertRaisesRegex(p.ProbeError, "ENVIRONMENT_FILE_PATH_MISSING"):
            p.parse_environment_files("")
        self.assertEqual(p.parse_environment_files("", allow_empty=True), [])
        with self.assertRaisesRegex(p.ProbeError, "ENVIRONMENT_FILE_ENTRY_INVALID"):
            p.parse_environment_files(
                "/etc/seller-agents-owner-test/api.env (ignore_errors=no) trailing-junk"
            )

    def test_execstart_is_bound_to_expected_release(self):
        value = (
            "{ path=" + str(ROOT / ".runtime/node")
            + " ; argv[]=" + str(ROOT / ".runtime/node")
            + " " + str(ROOT / "apps/api/src/main.ts")
            + " ; ignore_errors=no ; }"
        )
        binary, refs = p.parse_execstart(value, SHA)
        self.assertEqual(binary, ROOT / ".runtime/node")
        self.assertEqual(
            refs,
            [ROOT / ".runtime/node", ROOT / "apps/api/src/main.ts"],
        )
        other = "b" * 40
        with self.assertRaisesRegex(p.ProbeError, "EXECSTART_RELEASE_SHA_MISMATCH"):
            p.parse_execstart(value, other)

    def test_execstart_rejects_noncanonical_release_paths(self):
        node = str(ROOT / ".runtime/node")
        for argument in (
            str(ROOT) + "/../../../../etc/passwd",
            str(ROOT) + "/apps/../api",
            str(ROOT) + "/apps/./api",
            str(ROOT) + "/apps//api",
        ):
            with self.subTest(argument=argument):
                command = (
                    "{ path=" + node + " ; argv[]=" + node + " " + argument
                    + " ; ignore_errors=no ; }"
                )
                with self.assertRaisesRegex(
                    p.ProbeError, "EXECSTART_RELEASE_PATH_NOT_CANONICAL"
                ):
                    p.parse_execstart(command, SHA)

        escaped_binary = str(ROOT) + "/../../../../bin/sh"
        command = (
            "{ path=" + escaped_binary + " ; argv[]=" + escaped_binary
            + " ; ignore_errors=no ; }"
        )
        with self.assertRaisesRegex(
            p.ProbeError, "EXECSTART_RELEASE_PATH_NOT_CANONICAL"
        ):
            p.parse_execstart(command, SHA)

    def test_effective_bits_choose_owner_group_other(self):
        self.assertEqual(p.effective_bits(0o754, 10, 20, 10, 99), 0o7)
        self.assertEqual(p.effective_bits(0o754, 10, 20, 99, 20), 0o5)
        self.assertEqual(p.effective_bits(0o754, 10, 20, 99, 98), 0o4)

    def test_protected_metadata_requires_root_0600_and_zero_service_bits(self):
        p.validate_protected_metadata(
            mode=0o600, owner_uid=0, owner_gid=0, uid=65534, gid=65534, regular=True
        )
        cases = [
            (0o640, 0, 0, True, "PROTECTED_CONFIG_MODE_INVALID"),
            (0o600, 1, 0, True, "PROTECTED_CONFIG_NOT_ROOT_OWNED"),
            (0o600, 0, 1, True, "PROTECTED_CONFIG_NOT_ROOT_OWNED"),
            (0o600, 0, 0, False, "PROTECTED_CONFIG_NOT_REGULAR"),
        ]
        for mode, uid, gid, regular, code in cases:
            with self.subTest(code=code):
                with self.assertRaisesRegex(p.ProbeError, code):
                    p.validate_protected_metadata(
                        mode=mode,
                        owner_uid=uid,
                        owner_gid=gid,
                        uid=65534,
                        gid=65534,
                        regular=regular,
                    )

    def make_tree(self):
        root = Path(tempfile.mkdtemp(prefix="octoport-permission-test-"))
        (root / "apps/api").mkdir(parents=True)
        (root / ".runtime").mkdir()
        (root / "apps/api/main.ts").write_text("export {}\n")
        (root / ".runtime/node").write_text("#!/bin/sh\n")
        os.chmod(root, 0o755)
        os.chmod(root / "apps", 0o755)
        os.chmod(root / "apps/api", 0o755)
        os.chmod(root / ".runtime", 0o755)
        os.chmod(root / "apps/api/main.ts", 0o644)
        os.chmod(root / ".runtime/node", 0o755)
        return root

    def test_release_tree_accepts_readonly_nonroot_shape(self):
        root = self.make_tree()
        try:
            (root / "apps/api/link.ts").symlink_to(root / "apps/api/main.ts")
            result = p.scan_release_tree(root, 65534, 65534)
            self.assertGreaterEqual(result["files"], 2)
            self.assertGreaterEqual(result["directories"], 4)
            self.assertEqual(result["symlinks"], 1)
        finally:
            import shutil
            shutil.rmtree(root)

    def test_release_tree_rejects_writable_entry(self):
        root = self.make_tree()
        try:
            os.chmod(root / "apps/api/main.ts", 0o646)
            with self.assertRaisesRegex(p.ProbeError, "RELEASE_WRITABLE_BY_SERVICE"):
                p.scan_release_tree(root, 65534, 65534)
        finally:
            import shutil
            shutil.rmtree(root)

    def test_release_tree_rejects_unreadable_entry(self):
        root = self.make_tree()
        try:
            os.chmod(root / "apps/api/main.ts", 0o640)
            with self.assertRaisesRegex(p.ProbeError, "RELEASE_FILE_NOT_READABLE"):
                p.scan_release_tree(root, 65534, 65534)
        finally:
            import shutil
            shutil.rmtree(root)

    def test_release_tree_rejects_escaping_symlink(self):
        root = self.make_tree()
        outside = Path(tempfile.mkstemp(prefix="octoport-permission-outside-")[1])
        try:
            (root / "escape").symlink_to(outside)
            with self.assertRaisesRegex(p.ProbeError, "RELEASE_SYMLINK_ESCAPE"):
                p.scan_release_tree(root, 65534, 65534)
        finally:
            import shutil
            shutil.rmtree(root)
            outside.unlink(missing_ok=True)


    def test_child_probe_checks_full_release_roots_and_fails_closed(self):
        root_a = Path("/opt/octoport/ops-releases") / ("a" * 40)
        root_b = Path("/opt/octoport/ops-releases") / ("b" * 40)
        units = {
            "api": {
                "root": root_a,
                "working": root_a / "apps/api",
                "binary": root_a / ".runtime/node",
                "execPaths": [root_a / ".runtime/node", root_a / "apps/api/src/main.ts"],
                "envs": (
                    Path("/etc/seller-agents-owner-test/api.env"),
                    Path("/etc/seller-agents-owner-test/api-monitor.env"),
                ),
            },
            "portal": {
                "root": root_b,
                "working": root_b / "apps/portal",
                "binary": root_b / ".runtime/node",
                "execPaths": [root_b / ".runtime/node", root_b / "apps/portal/server.js"],
                "envs": (Path("/etc/seller-agents-owner-test/portal.env"),),
            },
        }
        writable = {"api": Path("/tmp/disposable-api")}
        good = {
            "nonRoot": True,
            "supplementaryGroupsCleared": True,
            "releaseTreesAccessible": True,
            "releaseTreesWriteDenied": True,
            "workingDirectoriesAccessible": True,
            "execPathsAccessible": True,
            "protectedConfigReadDenied": True,
            "protectedConfigWriteOpenDenied": True,
            "disposableWritesPassed": True,
        }
        completed = subprocess.CompletedProcess(
            args=["setpriv"], returncode=0, stdout=json.dumps(good), stderr=""
        )
        with mock.patch.object(p.subprocess, "run", return_value=completed) as run:
            self.assertEqual(p.run_child_probe(units, writable), good)
            payload = json.loads(run.call_args.args[0][-1])
            self.assertEqual(
                payload["releaseRoots"], sorted([str(root_a), str(root_b)])
            )
        bad = dict(good, releaseTreesWriteDenied=False)
        failed = subprocess.CompletedProcess(
            args=["setpriv"], returncode=0, stdout=json.dumps(bad), stderr=""
        )
        with mock.patch.object(p.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(
                p.ProbeError, "NONROOT_PERMISSION_BOUNDARY_FAILED"
            ):
                p.run_child_probe(units, writable)

    def test_state_signature_uses_only_stability_fields(self):
        units = {
            "api": {
                "active": "active",
                "sub": "running",
                "restarts": "2",
                "releaseSha": SHA,
                "envs": (Path("/secret"),),
            }
        }
        self.assertEqual(
            p.state_signature(units),
            {"api": ("active", "running", "2", SHA)},
        )


    def test_snapshot_units_enforces_four_service_env_and_identity_contract(self):
        values = {}
        for role, config in p.UNIT_CONFIG.items():
            unit = config["unit"]
            root = ROOT
            wd = str(root / ("apps/admin" if role == "admin" else "apps/portal" if role == "portal" else ""))
            wd = wd.rstrip("/")
            envs = {
                "api": (
                    "/etc/seller-agents-owner-test/api.env (ignore_errors=no) "
                    "/etc/seller-agents-owner-test/api-monitor.env (ignore_errors=no)"
                ),
                "worker": "/etc/seller-agents-owner-test/api.env (ignore_errors=no)",
                "portal": "/etc/seller-agents-owner-test/portal.env (ignore_errors=no)",
                "admin": "",
            }[role]
            identities = p.canonical_identities()
            values[unit] = {
                "ActiveState": "active",
                "SubState": "running",
                "NRestarts": "0",
                "WorkingDirectory": wd,
                "EnvironmentFiles": envs,
                "DynamicUser": "yes" if role == "admin" else "no",
                "User": "" if role == "admin" else identities[role]["user"],
                "Group": "" if role == "admin" else identities[role]["group"],
                "ExecStart": "{ path=" + str(root / ".runtime/node") + " ; argv[]="
                + str(root / ".runtime/node") + " "
                + str(root / ("apps/admin/node_modules/next/dist/bin/next" if role == "admin" else
                              "apps/portal/node_modules/next/dist/bin/next" if role == "portal" else
                              f"apps/{role}/dist/main.js"))
                + " ; ignore_errors=no ; }",
            }
        def prop(unit, name):
            return values[unit][name]
        with mock.patch.object(p, "unit_prop", side_effect=prop):
            internal, public = p.snapshot_units()
        self.assertEqual(set(internal), {"api", "worker", "portal", "admin"})
        self.assertEqual(
            internal["api"]["envs"],
            (
                Path("/etc/seller-agents-owner-test/api.env"),
                Path("/etc/seller-agents-owner-test/api-monitor.env"),
            ),
        )
        self.assertEqual(internal["admin"]["envs"], ())
        self.assertEqual(public["admin"]["currentIdentity"], "DYNAMIC_USER")
        self.assertEqual(public["api"]["currentIdentity"], "EXPLICIT_NON_ROOT_CANONICAL")

    def test_snapshot_units_rejects_monitor_env_leak_and_identity_drift(self):
        identities = p.canonical_identities()
        base = {
            "ActiveState": "active",
            "SubState": "running",
            "NRestarts": "0",
            "WorkingDirectory": str(ROOT),
            "EnvironmentFiles": (
                "/etc/seller-agents-owner-test/api.env (ignore_errors=no) "
                "/etc/seller-agents-owner-test/api-monitor.env (ignore_errors=no)"
            ),
            "DynamicUser": "no",
            "User": identities["worker"]["user"],
            "Group": identities["worker"]["group"],
            "ExecStart": "{ path=" + str(ROOT / ".runtime/node") + " ; argv[]="
            + str(ROOT / ".runtime/node") + " " + str(ROOT / "apps/worker/dist/main.js")
            + " ; ignore_errors=no ; }",
        }
        def prop(unit, name):
            if unit == "seller-agents-owner-test-worker.service":
                return base[name]
            raise AssertionError(unit)
        original = p.UNIT_CONFIG
        p.UNIT_CONFIG = {"worker": original["worker"]}
        try:
            with mock.patch.object(p, "unit_prop", side_effect=prop):
                with self.assertRaisesRegex(p.ProbeError, "ENVIRONMENT_FILE_SCOPE_MISMATCH"):
                    p.snapshot_units()
            base["EnvironmentFiles"] = "/etc/seller-agents-owner-test/api.env (ignore_errors=no)"
            base["User"] = "octoport-wrong"
            with mock.patch.object(p, "unit_prop", side_effect=prop):
                with self.assertRaisesRegex(p.ProbeError, "SERVICE_IDENTITY_NOT_CANONICAL"):
                    p.snapshot_units()
        finally:
            p.UNIT_CONFIG = original

if __name__ == "__main__":
    unittest.main()
