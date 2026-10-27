#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path
import sys
import unittest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import four_root_owner_test_units as units  # noqa: E402
import verify_owner_test_release as verifier  # noqa: E402

SHA = "a" * 40
RELEASE = f"/opt/octoport/ops-releases/{SHA}"
USERS = {
    "api": ("octoport-api", "octoport-api"),
    "worker": ("octoport-worker", "octoport-worker"),
    "portal": ("octoport-portal", "octoport-portal"),
}


class FourRootUnitContractTest(unittest.TestCase):
    def test_service_set_and_entries_match_release_verifier(self):
        contracts = units.contracts(RELEASE)
        self.assertEqual(set(contracts), set(verifier.SERVICE_ENTRIES))
        for role, contract in contracts.items():
            expected_entry, expected_cwd = verifier.SERVICE_ENTRIES[role]
            self.assertIn(f"{RELEASE}/{expected_entry}", contract.exec_argv)
            expected_working = RELEASE if expected_cwd == "." else f"{RELEASE}/{expected_cwd}"
            self.assertEqual(contract.working_directory, expected_working)
        self.assertEqual(
            contracts["api"].exec_argv,
            (
                f"{RELEASE}/.runtime/node",
                f"{RELEASE}/apps/api/node_modules/tsx/dist/cli.mjs",
                f"{RELEASE}/apps/api/dist/main.js",
            ),
        )
        self.assertEqual(
            contracts["worker"].exec_argv,
            (
                f"{RELEASE}/.runtime/node",
                f"{RELEASE}/apps/worker/node_modules/tsx/dist/cli.mjs",
                f"{RELEASE}/apps/worker/dist/main.js",
            ),
        )

    def test_render_all_four_units_binds_compiled_entries(self):
        rendered = units.render_and_validate(RELEASE, service_users=USERS)
        self.assertEqual(set(rendered), {"api", "worker", "portal", "admin"})
        self.assertIn(
            f"ExecStart={RELEASE}/.runtime/node "
            f"{RELEASE}/apps/api/node_modules/tsx/dist/cli.mjs "
            f"{RELEASE}/apps/api/dist/main.js",
            rendered["api"],
        )
        self.assertIn(
            f"ExecStart={RELEASE}/.runtime/node "
            f"{RELEASE}/apps/worker/node_modules/tsx/dist/cli.mjs "
            f"{RELEASE}/apps/worker/dist/main.js",
            rendered["worker"],
        )
        for text in rendered.values():
            self.assertNotIn("/src/main.ts", text)
            self.assertNotIn("@RELEASE_DIR@", text)
        self.assertNotIn("/tsx/", rendered["portal"])
        self.assertNotIn("/tsx/", rendered["admin"])

    def test_monitor_credential_scope_is_api_only(self):
        contracts = units.contracts(RELEASE)
        self.assertEqual(
            contracts["api"].environment_files,
            (units.PRODUCT_ENV, units.MONITOR_ENV),
        )
        self.assertEqual(contracts["worker"].environment_files, (units.PRODUCT_ENV,))
        self.assertEqual(contracts["portal"].environment_files, (units.PORTAL_ENV,))
        self.assertEqual(contracts["admin"].environment_files, ())
        rendered = units.render_and_validate(RELEASE, service_users=USERS)
        self.assertIn(str(units.MONITOR_ENV), rendered["api"])
        for role in ("worker", "portal", "admin"):
            self.assertNotIn(str(units.MONITOR_ENV), rendered[role])

    def test_api_and_worker_are_explicit_nonroot_admin_is_dynamic(self):
        rendered = units.render_and_validate(RELEASE, service_users=USERS)
        for role in ("api", "worker", "portal"):
            user, group = USERS[role]
            self.assertIn(f"User={user}", rendered[role])
            self.assertIn(f"Group={group}", rendered[role])
        self.assertIn("DynamicUser=yes", rendered["admin"])

    def test_renderer_rejects_literal_root_identity(self):
        contract = units.contracts(RELEASE)["api"]
        for user, group in (
            ("root", "octoport-api"),
            ("octoport-api", "root"),
        ):
            with self.subTest(user=user, group=group):
                with self.assertRaisesRegex(
                    units.FourRootUnitError, "FOUR_ROOT_ROOT_SERVICE_FORBIDDEN"
                ):
                    units.render_template(
                        contract,
                        release_dir=RELEASE,
                        service_user=user,
                        service_group=group,
                    )

    def test_rejects_numeric_root_identity_drift(self):
        contract = units.contracts(RELEASE)["api"]
        text = units.render_template(
            contract,
            release_dir=RELEASE,
            service_user="octoport-api",
            service_group="octoport-api",
        )
        for old, new in (
            ("User=octoport-api", "User=0"),
            ("Group=octoport-api", "Group=0"),
            ("User=octoport-api", "User= 0"),
            ("Group=octoport-api", "Group=0 "),
        ):
            with self.subTest(new=new):
                with self.assertRaisesRegex(
                    units.FourRootUnitError, "FOUR_ROOT_ROOT_SERVICE_FORBIDDEN"
                ):
                    units.validate_rendered(contract, text.replace(old, new))

    def test_rejects_unpinned_release_and_missing_identity(self):
        with self.assertRaisesRegex(
            units.FourRootUnitError, "FOUR_ROOT_RELEASE_DIR_INVALID"
        ):
            units.contracts("/opt/octoport/ops-releases/current")
        with self.assertRaisesRegex(
            units.FourRootUnitError, "FOUR_ROOT_SERVICE_IDENTITY_REQUIRED"
        ):
            units.render_and_validate(RELEASE, service_users={})

    def test_template_drift_is_detected(self):
        contract = units.contracts(RELEASE)["api"]
        text = units.render_template(
            contract,
            release_dir=RELEASE,
            service_user="octoport-api",
            service_group="octoport-api",
        )
        with self.assertRaisesRegex(
            units.FourRootUnitError, "FOUR_ROOT_EXECSTART_MISMATCH"
        ):
            units.validate_rendered(
                contract,
                text.replace("apps/api/dist/main.js", "apps/api/src/main.ts"),
            )
        with self.assertRaisesRegex(
            units.FourRootUnitError, "FOUR_ROOT_ENVIRONMENT_SCOPE_MISMATCH"
        ):
            units.validate_rendered(
                contract,
                text.replace(
                    "EnvironmentFile=/etc/seller-agents-owner-test/api-monitor.env\n",
                    "",
                ),
            )


if __name__ == "__main__":
    unittest.main()
