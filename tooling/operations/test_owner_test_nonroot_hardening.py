from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import owner_test_nonroot_hardening as hardening

REPO = Path(__file__).resolve().parents[2]
TEMPLATES = REPO / "infra/production/systemd"


class OwnerTestNonrootHardeningTest(unittest.TestCase):
    def test_positive_candidate_uses_exact_proven_sandbox(self) -> None:
        result = hardening.candidate_plan(
            TEMPLATES,
            maintenance_credential_file=hardening.ACCEPTED_MAINTENANCE_PATH,
        )
        self.assertEqual(result["status"], "SOURCE_CANDIDATE_VALID")
        self.assertFalse(result["liveMutationPerformed"])
        self.assertFalse(result["credentialContentsRead"])
        self.assertEqual(result["resourceLimits"], "UNRESOLVED_NOT_RENDERED")
        self.assertEqual(result["networkPolicy"], "UNCHANGED_NOT_RENDERED")
        self.assertFalse(result["releaseTreeWritable"])
        self.assertEqual(
            result["services"]["api"]["stateDirectory"],
            "octoport-owner-test-api",
        )
        self.assertIsNone(result["services"]["worker"]["stateDirectory"])
        self.assertIsNone(result["services"]["portal"]["stateDirectory"])

        for role in hardening.SERVICES:
            text = hardening.render_service(role, template_dir=TEMPLATES)
            self.assertIn("UMask=0077", text)
            self.assertIn("NoNewPrivileges=yes", text)
            self.assertIn("PrivateTmp=yes", text)
            self.assertIn("ProtectSystem=strict", text)
            self.assertIn("ProtectHome=yes", text)
            self.assertIn("CapabilityBoundingSet=", text)
            self.assertIn("AmbientCapabilities=", text)
            self.assertNotIn("@SERVICE_", text)
            for forbidden in hardening.FORBIDDEN_DIRECTIVES:
                self.assertNotIn(forbidden + "=", text)
    def test_api_private_state_is_exact_and_others_have_no_persistent_write(self) -> None:
        api = hardening.render_service("api", template_dir=TEMPLATES)
        worker = hardening.render_service("worker", template_dir=TEMPLATES)
        portal = hardening.render_service("portal", template_dir=TEMPLATES)
        self.assertIn("StateDirectory=octoport-owner-test-api", api)
        self.assertIn("StateDirectoryMode=0700", api)
        for text in (worker, portal):
            self.assertNotIn("StateDirectory=", text)
            self.assertNotIn("StateDirectoryMode=", text)
        for text in (api, worker, portal):
            self.assertNotIn("ReadWritePaths=", text)
            self.assertNotIn("/opt/", text)

    def test_current_root_maintenance_destination_blocks_apply(self) -> None:
        with self.assertRaisesRegex(
            hardening.HardeningCandidateError,
            "MAINTENANCE_STORAGE_INCOMPATIBLE_WITH_PROTECT_HOME",
        ):
            hardening.candidate_plan(
                TEMPLATES,
                maintenance_credential_file="/root/octoport-control/credentials/maintenance.json",
            )

    def test_other_maintenance_destination_fails_closed(self) -> None:
        with self.assertRaisesRegex(
            hardening.HardeningCandidateError,
            "MAINTENANCE_STORAGE_PATH_NOT_ACCEPTED",
        ):
            hardening.validate_maintenance_path("/tmp/maintenance.json")

    def test_no_active_maintenance_path_is_compatible(self) -> None:
        result = hardening.candidate_plan(
            TEMPLATES,
            maintenance_credential_file=None,
        )
        self.assertEqual(
            result["maintenanceStorage"]["status"],
            "NO_ACTIVE_CREDENTIAL_PATH",
        )

    def test_empty_maintenance_path_is_not_no_active_proof(self) -> None:
        for value in ("", "   "):
            with self.subTest(value=value):
                with self.assertRaisesRegex(
                    hardening.HardeningCandidateError,
                    "MAINTENANCE_STORAGE_PATH_EMPTY",
                ):
                    hardening.validate_maintenance_path(value)

    def test_maintenance_path_with_surrounding_whitespace_fails_closed(self) -> None:
        for value in (
            f" {hardening.ACCEPTED_MAINTENANCE_PATH}",
            f"{hardening.ACCEPTED_MAINTENANCE_PATH} ",
            f" {hardening.ACCEPTED_MAINTENANCE_PATH} ",
        ):
            with self.subTest(value=value):
                with self.assertRaisesRegex(
                    hardening.HardeningCandidateError,
                    "MAINTENANCE_STORAGE_PATH_NOT_ACCEPTED",
                ):
                    hardening.validate_maintenance_path(value)

    def test_root_empty_malformed_and_noncanonical_identity_fail(self) -> None:
        cases = [
            ("root", "root", "SERVICE_USER_INVALID"),
            ("", "octoport-owner-test-api", "SERVICE_USER_INVALID"),
            ("bad user", "bad user", "SERVICE_USER_INVALID"),
            ("octoport-other", "octoport-other", "SERVICE_IDENTITY_NOT_CANONICAL"),
        ]
        for user, group, code in cases:
            identities = hardening.canonical_identities()
            identities["api"] = {"user": user, "group": group}
            with self.subTest(user=user, group=group):
                with self.assertRaisesRegex(hardening.HardeningCandidateError, code):
                    hardening.validate_identities(identities)

    def test_shared_identity_fails_closed(self) -> None:
        identities = hardening.canonical_identities()
        identities["worker"] = dict(identities["api"])
        with self.assertRaisesRegex(
            hardening.HardeningCandidateError,
            "SERVICE_IDENTITY_SHARED",
        ):
            hardening.validate_identities(identities)

    def test_explicit_empty_identity_map_does_not_use_defaults(self) -> None:
        with self.assertRaisesRegex(
            hardening.HardeningCandidateError,
            "SERVICE_SET_INVALID",
        ):
            hardening.candidate_plan(
                TEMPLATES,
                maintenance_credential_file=hardening.ACCEPTED_MAINTENANCE_PATH,
                identities={},
            )
        with self.assertRaisesRegex(
            hardening.HardeningCandidateError,
            "SERVICE_SET_INVALID",
        ):
            hardening.render_service(
                "api",
                template_dir=TEMPLATES,
                identities={},
            )

    def test_template_resource_network_or_write_widening_is_rejected(self) -> None:
        base = (
            TEMPLATES / "seller-agents-owner-test-worker-hardening.conf.in"
        ).read_text()
        for line in (
            "MemoryMax=1G",
            "TasksMax=128",
            "CPUQuota=200%",
            "ReadWritePaths=/opt/octoport",
            "IPAddressDeny=any",
            "Environment=SECRET=not-a-real-secret",
        ):
            with self.subTest(line=line):
                with self.assertRaisesRegex(
                    hardening.HardeningCandidateError,
                    "TEMPLATE_FORBIDDEN_DIRECTIVE",
                ):
                    hardening.validate_template("worker", base + line + "\n")

    def test_unknown_template_directive_fails_closed(self) -> None:
        base = (
            TEMPLATES / "seller-agents-owner-test-portal-hardening.conf.in"
        ).read_text()
        with self.assertRaisesRegex(
            hardening.HardeningCandidateError,
            "TEMPLATE_DIRECTIVES_INVALID",
        ):
            hardening.validate_template("portal", base + "PrivateDevices=yes\n")
    def test_cli_is_validation_only_and_current_path_returns_blocked(self) -> None:
        command = [
            sys.executable,
            str(Path(hardening.__file__)),
            "--template-dir",
            str(TEMPLATES),
            "--maintenance-credential-file",
            "/root/octoport-control/credentials/maintenance.json",
        ]
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn(
            "MAINTENANCE_STORAGE_INCOMPATIBLE_WITH_PROTECT_HOME",
            result.stdout,
        )
        self.assertEqual(result.stderr, "")

    def test_cli_requires_explicit_maintenance_state(self) -> None:
        command = [
            sys.executable,
            str(Path(hardening.__file__)),
            "--template-dir",
            str(TEMPLATES),
        ]
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn(
            "one of the arguments --maintenance-credential-file "
            "--no-active-maintenance-credential is required",
            result.stderr,
        )

    def test_cli_empty_maintenance_file_argument_fails_closed(self) -> None:
        command = [
            sys.executable,
            str(Path(hardening.__file__)),
            "--template-dir",
            str(TEMPLATES),
            "--maintenance-credential-file",
            "",
        ]
        result = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("MAINTENANCE_STORAGE_PATH_EMPTY", result.stdout)

    def test_renderer_does_not_require_writable_repo(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            copied = Path(directory)
            for spec in hardening.SERVICES.values():
                source = TEMPLATES / str(spec["template"])
                target = copied / str(spec["template"])
                target.write_bytes(source.read_bytes())
            for item in copied.iterdir():
                item.chmod(0o444)
            result = hardening.candidate_plan(
                copied,
                maintenance_credential_file=hardening.ACCEPTED_MAINTENANCE_PATH,
            )
            self.assertEqual(result["status"], "SOURCE_CANDIDATE_VALID")


if __name__ == "__main__":
    unittest.main()
