from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import owner_test_runtime_hardening as hardening


def base_snapshot(**overrides: str) -> dict[str, str]:
    value = {
        "ActiveState": "active",
        "SubState": "running",
        "User": "root",
        "Group": "",
        "DynamicUser": "no",
        "NoNewPrivileges": "yes",
        "PrivateTmp": "yes",
        "ProtectSystem": "no",
        "ProtectHome": "no",
        "MemoryHigh": "infinity",
        "MemoryMax": "infinity",
        "CPUQuotaPerSecUSec": "infinity",
        "TasksMax": "19045",
        "WorkingDirectory": "/opt/octoport/ops-releases/example",
        "MemoryCurrent": "100000000",
        "TasksCurrent": "30",
        "CPUUsageNSec": "100000000",
    }
    value.update(overrides)
    return value
def show_text(snapshot: dict[str, str]) -> str:
    return "\n".join(f"{key}={snapshot[key]}" for key in hardening.PROPERTIES) + "\n"


class FakeRunner:
    def __init__(self, per_unit: dict[str, list[dict[str, str]]]) -> None:
        self.per_unit = per_unit
        self.calls: list[list[str]] = []
        self.index = {unit: 0 for unit in per_unit}

    def __call__(self, args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        self.calls.append(list(args))
        unit = args[2]
        position = self.index[unit]
        rows = self.per_unit[unit]
        snapshot = rows[min(position, len(rows) - 1)]
        self.index[unit] = position + 1
        return subprocess.CompletedProcess(args, 0, show_text(snapshot), "")


class HardeningAuditTest(unittest.TestCase):
    def test_root_unbounded_configuration_is_explicit(self) -> None:
        summary = hardening.summarize_samples([base_snapshot()], [1])
        gaps = set(summary["gaps"])
        self.assertIn("SERVICE_IDENTITY_ROOT_OR_UNSET", gaps)
        self.assertIn("SERVICE_GROUP_UNSET", gaps)
        self.assertIn("PROTECT_SYSTEM_WEAK", gaps)
        self.assertIn("PROTECT_HOME_WEAK", gaps)
        self.assertIn("MEMORY_HIGH_UNBOUNDED", gaps)
        self.assertIn("MEMORY_MAX_UNBOUNDED", gaps)
        self.assertIn("CPU_QUOTA_UNBOUNDED", gaps)
        self.assertNotIn("TASKS_MAX_UNBOUNDED", gaps)
    def test_finite_non_root_configuration_has_no_gaps(self) -> None:
        snapshot = base_snapshot(
            User="octoport-owner-test",
            Group="octoport-owner-test",
            ProtectSystem="strict",
            ProtectHome="yes",
            MemoryHigh="536870912",
            MemoryMax="805306368",
            CPUQuotaPerSecUSec="2s",
            TasksMax="256",
        )
        self.assertEqual(hardening.configuration_gaps(snapshot), [])
        self.assertEqual(hardening._cpu_quota_usec("500ms"), 500_000)
        self.assertEqual(hardening._cpu_quota_usec("1min 30s"), 90_000_000)
        self.assertEqual(hardening._cpu_quota_usec("1h30min"), 5_400_000_000)

    def test_validated_configuration_output_is_sanitized(self) -> None:
        user = "octoport-owner-test"
        working = "/opt/octoport/ops-releases/" + "a" * 40 + "/apps/portal"
        snapshot = base_snapshot(
            User=user,
            Group=user,
            ProtectSystem="strict",
            ProtectHome="yes",
            MemoryHigh="536870912",
            MemoryMax="805306368",
            CPUQuotaPerSecUSec="2s",
            TasksMax="256",
            WorkingDirectory=working,
        )
        config = hardening.summarize_samples([snapshot], [1])["configuration"]
        self.assertEqual(config["identityClass"], "EXPLICIT_NON_ROOT")
        self.assertEqual(config["workingDirectoryClass"], "PINNED_OPS_RELEASE")
        self.assertEqual(config["memoryHighBytes"], 536870912)
        self.assertEqual(config["memoryMaxBytes"], 805306368)
        self.assertEqual(config["cpuQuotaPerSecUSec"], 2_000_000)
        self.assertEqual(config["tasksMax"], 256)
        serialized = json.dumps(config)
        self.assertNotIn(user, serialized)
        self.assertNotIn(working, serialized)

    def test_unknown_security_and_resource_values_fail_closed(self) -> None:
        cases = [
            ("ActiveState", "bogus", "ACTIVE_STATE_INVALID"),
            ("SubState", "bogus", "SUB_STATE_INVALID"),
            ("DynamicUser", "maybe", "DYNAMIC_USER_INVALID"),
            ("NoNewPrivileges", "maybe", "NO_NEW_PRIVILEGES_INVALID"),
            ("PrivateTmp", "maybe", "PRIVATE_TMP_INVALID"),
            ("ProtectSystem", "magic", "PROTECT_SYSTEM_INVALID"),
            ("ProtectHome", "private", "PROTECT_HOME_INVALID"),
            ("User", "bad user", "SERVICE_USER_INVALID"),
            ("Group", "bad group", "SERVICE_GROUP_INVALID"),
            ("MemoryHigh", "invalid", "MEMORY_HIGH_INVALID"),
            ("MemoryMax", "0", "MEMORY_MAX_INVALID"),
            ("CPUQuotaPerSecUSec", "50%", "CPU_QUOTA_INVALID"),
            ("TasksMax", "all", "TASKS_MAX_INVALID"),
            ("WorkingDirectory", "relative/path", "WORKING_DIRECTORY_INVALID"),
        ]
        for key, value, code in cases:
            with self.subTest(key=key):
                with self.assertRaisesRegex(hardening.HardeningAuditError, code):
                    hardening.summarize_samples(
                        [base_snapshot(**{key: value})],
                        [1],
                    )

    def test_missing_or_unknown_show_property_fails_closed(self) -> None:
        valid = show_text(base_snapshot())
        missing = "\n".join(valid.splitlines()[:-1]) + "\n"
        with self.assertRaisesRegex(
            hardening.HardeningAuditError,
            "SYSTEMD_SHOW_PROPERTY_MISSING",
        ):
            hardening._parse_show(missing)
        with self.assertRaisesRegex(
            hardening.HardeningAuditError,
            "SYSTEMD_SHOW_PROPERTY_INVALID",
        ):
            hardening._parse_show(valid + "Environment=SECRET=value\n")

    def test_malformed_counter_fails_closed(self) -> None:
        with self.assertRaisesRegex(
            hardening.HardeningAuditError,
            "MEMORYCURRENT_INVALID",
        ):
            hardening.summarize_samples(
                [base_snapshot(MemoryCurrent="unknown")],
                [1],
            )
    def test_counter_regression_is_rejected(self) -> None:
        with self.assertRaisesRegex(
            hardening.HardeningAuditError,
            "CPU_COUNTER_REGRESSED",
        ):
            hardening.summarize_samples(
                [
                    base_snapshot(CPUUsageNSec="200000000"),
                    base_snapshot(CPUUsageNSec="100000000"),
                ],
                [0, 1_000_000_000],
            )

    def test_sampling_reports_only_observation_not_capacity_proof(self) -> None:
        first = base_snapshot()
        second = base_snapshot(
            MemoryCurrent="120000000",
            TasksCurrent="34",
            CPUUsageNSec="200000000",
        )
        runner = FakeRunner(
            {unit: [first, second] for unit in hardening.UNITS},
        )
        times = iter([0, 1_000_000_000])
        sleeps: list[float] = []
        result = hardening.audit_units(
            samples=2,
            interval_seconds=0.25,
            runner=runner,
            sleeper=sleeps.append,
            monotonic_ns=lambda: next(times),
        )
        self.assertEqual(result["status"], "HARDENING_GAPS_FOUND")
        self.assertEqual(result["capacityProof"], "NOT_PROVEN_SHORT_WINDOW")
        self.assertFalse(result["mutationPerformed"])
        self.assertFalse(result["secretMaterialRead"])
        self.assertEqual(sleeps, [0.25])
        for unit in hardening.UNITS:
            observed = result["units"][unit]["observed"]
            self.assertEqual(observed["memoryCurrentMaxBytes"], 120000000)
            self.assertEqual(observed["tasksCurrentMax"], 34)
            self.assertEqual(observed["averageCpuPercent"], 10.0)

    def test_only_allowlisted_systemctl_show_is_invoked(self) -> None:
        runner = FakeRunner(
            {unit: [base_snapshot()] for unit in hardening.UNITS},
        )
        hardening.audit_units(
            samples=1,
            interval_seconds=0,
            runner=runner,
            monotonic_ns=lambda: 1,
        )
        self.assertEqual(len(runner.calls), len(hardening.UNITS))
        forbidden = {
            "start",
            "stop",
            "restart",
            "daemon-reload",
            "set-property",
            "Environment",
            "EnvironmentFiles",
        }
        for command in runner.calls:
            self.assertEqual(command[:2], ["systemctl", "show"])
            self.assertIn(command[2], hardening.UNITS)
            self.assertTrue(forbidden.isdisjoint(command))

    def test_unit_name_and_sampling_bounds_are_fail_closed(self) -> None:
        with self.assertRaisesRegex(hardening.HardeningAuditError, "UNIT_NOT_ALLOWED"):
            hardening._command("other.service")
        with self.assertRaisesRegex(
            hardening.HardeningAuditError,
            "SAMPLE_COUNT_INVALID",
        ):
            hardening.audit_units(samples=0, interval_seconds=0)
        with self.assertRaisesRegex(
            hardening.HardeningAuditError,
            "SAMPLE_INTERVAL_INVALID",
        ):
            hardening.audit_units(samples=1, interval_seconds=11)

    def test_configuration_change_during_window_is_rejected(self) -> None:
        with self.assertRaisesRegex(
            hardening.HardeningAuditError,
            "UNIT_CONFIGURATION_CHANGED_DURING_AUDIT",
        ):
            hardening.summarize_samples(
                [
                    base_snapshot(),
                    base_snapshot(WorkingDirectory="/opt/changed"),
                ],
                [0, 1_000_000_000],
            )


if __name__ == "__main__":
    unittest.main()
