"""Bounded tests of the actual backup installer preflight fragments.

Only the configuration parser and PostgreSQL-client version checks are executed;
no live PostgreSQL, systemd, /etc files, backup destinations, privileged host
modification, or secrets.
"""

from __future__ import annotations

import re
import shlex
import subprocess
import tempfile
import unittest
from pathlib import Path


INSTALLER = (
    Path(__file__).resolve().parents[2]
    / "infra/production/scripts/install-octoport-postgres-backup.sh"
)
REQUIRED_KEYS = (
    "OCTOPORT_BACKUP_DESTINATION",
    "OCTOPORT_BACKUP_DESTINATION_MOUNT",
    "OCTOPORT_DB_DATA_PATH",
    "OCTOPORT_DB_DATA_MOUNT",
    "OCTOPORT_BACKUP_MIN_FREE_BYTES",
)
VALID_VALUES = (
    "/mnt/test-backups/snapshots",
    "/mnt/test-backups",
    "/mnt/test-db/data",
    "/mnt/test-db",
    "1073741824",
)


def actual_installer_parser() -> str:
    source = INSTALLER.read_text()
    start = source.index("readarray -t parsed_paths < <(") if (
        "readarray -t parsed_paths < <(" in source
    ) else source.index('parsed_paths_output="$(')
    end = source.index('\nBACKUP_DESTINATION="${parsed_paths[0]}"', start)
    return source[start:end]


def replace_python_with(fragment: str, shell_command: str) -> str:
    pattern = r'^  BACKUP_ENV="\$\{BACKUP_ENV\}" python3 - <<\x27PY\x27\n.*?^PY$'
    changed, count = re.subn(
        pattern, "  " + shell_command, fragment, count=1, flags=re.MULTILINE | re.DOTALL
    )
    if count != 1:
        raise AssertionError("unable to replace only the isolated Python parser")
    return changed


class BackupInstallerConfigParserTests(unittest.TestCase):
    def run_parser(
        self, text: str, *,
        fragment: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="octoport-b05-parser-fixture-") as temp:
            env_path = Path(temp) / "backup.env"
            env_path.write_text(text)
            body = actual_installer_parser() if fragment is None else fragment
            script = (
                "set -Eeuo pipefail\n"
                'fail() { printf "BACKUP_CONFIG_REJECTED:%s\\n" "$*" >&2; exit 87; }\n'
                + body + "\n"
                'printf "VALUES_COUNT=%s\\n" "${#parsed_paths[@]}"\n'
                'printf "FIRST=%s\\n" "${parsed_paths[0]:-MISSING}"\n'
                'printf "LAST=%s\\n" "${parsed_paths[4]:-MISSING}"\n'
            )
            return subprocess.run(
                ["/bin/bash", "-c", script],
                capture_output=True,
                text=True,
                timeout=12,
                env={
                    "BACKUP_ENV": str(env_path),
                    "PATH": "/usr/local/bin:/usr/bin:/bin",
                    "LC_ALL": "C",
                },
                check=False,
            )

    def fixture(self, **overrides: str) -> str:
        values = dict(zip(REQUIRED_KEYS, VALID_VALUES))
        values.update(overrides)
        return "".join(f"{name}={values[name]}\n" for name in REQUIRED_KEYS)

    def assert_configuration_failure(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 87, result.stdout + result.stderr)
        self.assertIn(
            "BACKUP_CONFIG_REJECTED:backup destination configuration invalid",
            result.stderr,
        )
        self.assertNotIn("unbound variable", result.stderr)
        self.assertNotIn("VALUES_COUNT=", result.stdout)

    def test_invalid_minimum_byte_count_reports_configuration_error(self) -> None:
        result = self.run_parser(
            self.fixture(OCTOPORT_BACKUP_MIN_FREE_BYTES="not-an-integer")
        )
        self.assert_configuration_failure(result)

    def test_missing_required_key_rejects_even_with_partial_output(self) -> None:
        text = self.fixture()
        text = "\n".join(
            x for x in text.splitlines()
            if not x.startswith("OCTOPORT_DB_DATA_PATH=")
        ) + "\n"
        self.assert_configuration_failure(self.run_parser(text))

    def test_duplicate_config_key_rejects_instead_of_ignoring_parser_exit(self) -> None:
        text = self.fixture() + "OCTOPORT_BACKUP_DESTINATION=/mnt/duplicate\n"
        self.assert_configuration_failure(self.run_parser(text))

    def test_nonabsolute_path_rejects_instead_of_accepting_partial_output(self) -> None:
        text = self.fixture(OCTOPORT_DB_DATA_MOUNT="relative-path")
        self.assert_configuration_failure(self.run_parser(text))

    def test_empty_successful_parser_output_rejected_by_value_count(self) -> None:
        fragment = replace_python_with(actual_installer_parser(), ":")
        self.assert_configuration_failure(
            self.run_parser(self.fixture(), fragment=fragment)
        )

    def test_partial_output_failed_parser_is_rejected(self) -> None:
        fragment = replace_python_with(
            actual_installer_parser(),
            "/bin/bash -c 'printf \"/mnt/first\\n/mnt/second\\n\"; exit 7'",
        )
        self.assert_configuration_failure(
            self.run_parser(self.fixture(), fragment=fragment)
        )

    def test_quoted_path_containing_spaces_is_preserved_as_one_value(self) -> None:
        result = self.run_parser(
            self.fixture(
                OCTOPORT_BACKUP_DESTINATION='"/mnt/test backups/snapshots"',
            )
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("VALUES_COUNT=5", result.stdout)
        self.assertIn("FIRST=/mnt/test backups/snapshots", result.stdout)
        self.assertIn(f"LAST={VALID_VALUES[4]}", result.stdout)

    def test_successful_parser_with_six_values_is_rejected(self) -> None:
        fragment = replace_python_with(
            actual_installer_parser(),
            "/bin/bash -c 'printf \"/mnt/one\\n/mnt/two\\n/mnt/three\\n/mnt/four\\n/mnt/five\\n/mnt/six\\n\"'",
        )
        self.assert_configuration_failure(
            self.run_parser(self.fixture(), fragment=fragment)
        )

    def test_valid_five_values_preserve_config_contract(self) -> None:
        result = self.run_parser(self.fixture())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("VALUES_COUNT=5", result.stdout)
        self.assertIn(f"FIRST={VALID_VALUES[0]}", result.stdout)
        self.assertIn(f"LAST={VALID_VALUES[4]}", result.stdout)
        self.assertNotIn("BACKUP_CONFIG_REJECTED", result.stderr)


def actual_installer_client_version_fragment() -> str:
    source = INSTALLER.read_text()
    command_check = source.index(
        "for command_name in pg_dump pg_restore findmnt runuser systemd-analyze systemctl; do"
    )
    start = source.index("\ndone\n", command_check) + len("\ndone\n")
    end = source.index('\nid "${BACKUP_USER}"', start)
    # Execute only the installer preflight between command presence and identity
    # checks. Never execute its root, systemd, mount, or database operations.
    return source[start:end]


class BackupInstallerPostgresClientVersionTests(unittest.TestCase):
    def run_client_preflight(
        self,
        *,
        dump_version: str = "pg_dump (PostgreSQL) 18.0",
        restore_version: str = "pg_restore (PostgreSQL) 18.0",
        dump_exit: int = 0,
        restore_exit: int = 0,
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="octoport-b05-client-version-") as temp:
            bin_dir = Path(temp) / "bin"
            bin_dir.mkdir()
            for command, output, exit_code in (
                ("pg_dump", dump_version, dump_exit),
                ("pg_restore", restore_version, restore_exit),
            ):
                executable = bin_dir / command
                executable.write_text(
                    '#!/bin/sh\n'
                    'if [ "$1" != "--version" ]; then exit 96; fi\n'
                    + "printf '%s\\n' " + shlex.quote(output) + "\n"
                    + f"exit {exit_code}\n"
                )
                executable.chmod(0o755)
            script = (
                "set -Eeuo pipefail\n"
                'fail() { printf "BACKUP_CLIENT_REJECTED:%s\\n" "$*" >&2; exit 87; }\n'
                + actual_installer_client_version_fragment()
                + '\nprintf "CLIENT_VERSION_PREFLIGHT_PASSED\\n"\n'
            )
            return subprocess.run(
                ["/bin/bash", "-c", script],
                capture_output=True,
                text=True,
                timeout=8,
                env={
                    "PATH": str(bin_dir) + ":/usr/bin:/bin",
                    "LC_ALL": "C",
                },
                check=False,
            )

    def assert_client_rejected(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 87, result.stdout + result.stderr)
        self.assertIn("BACKUP_CLIENT_REJECTED:", result.stderr)
        self.assertNotIn("CLIENT_VERSION_PREFLIGHT_PASSED", result.stdout)

    def test_matching_pg18_clients_pass(self) -> None:
        result = self.run_client_preflight(
            dump_version="pg_dump (PostgreSQL) 18.0",
            restore_version="pg_restore (PostgreSQL) 18.3",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CLIENT_VERSION_PREFLIGHT_PASSED", result.stdout)

    def test_pg18_distro_patch_suffix_passes(self) -> None:
        result = self.run_client_preflight(
            dump_version="pg_dump (PostgreSQL) 18.1 (Ubuntu 18.1-1)",
            restore_version="pg_restore (PostgreSQL) 18.0",
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_older_pg_dump_is_rejected_before_installer_writes(self) -> None:
        result = self.run_client_preflight(dump_version="pg_dump (PostgreSQL) 17.9")
        self.assert_client_rejected(result)
        self.assertIn("pg_dump", result.stderr)

    def test_older_pg_restore_is_rejected_before_installer_writes(self) -> None:
        result = self.run_client_preflight(restore_version="pg_restore (PostgreSQL) 17.9")
        self.assert_client_rejected(result)
        self.assertIn("pg_restore", result.stderr)

    def test_unreviewed_newer_major_is_rejected(self) -> None:
        result = self.run_client_preflight(dump_version="pg_dump (PostgreSQL) 19.0")
        self.assert_client_rejected(result)

    def test_unexpected_version_output_is_rejected(self) -> None:
        result = self.run_client_preflight(dump_version="PostgreSQL 18.0")
        self.assert_client_rejected(result)

    def test_version_command_failure_is_rejected(self) -> None:
        result = self.run_client_preflight(restore_exit=3)
        self.assert_client_rejected(result)
        self.assertIn("pg_restore", result.stderr)


if __name__ == "__main__":
    unittest.main()
