#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import time
from collections.abc import Callable, Sequence
from decimal import Decimal, InvalidOperation
from typing import Any

UNITS = (
    "seller-agents-owner-test-api.service",
    "seller-agents-owner-test-worker.service",
    "seller-agents-owner-test-portal.service",
)

CONFIG_PROPERTIES = (
    "ActiveState",
    "SubState",
    "User",
    "Group",
    "DynamicUser",
    "NoNewPrivileges",
    "PrivateTmp",
    "ProtectSystem",
    "ProtectHome",
    "MemoryHigh",
    "MemoryMax",
    "CPUQuotaPerSecUSec",
    "TasksMax",
    "WorkingDirectory",
)
COUNTER_PROPERTIES = (
    "MemoryCurrent",
    "TasksCurrent",
    "CPUUsageNSec",
)
PROPERTIES = CONFIG_PROPERTIES + COUNTER_PROPERTIES
INFINITE_VALUE = "infinity"
SYSTEMD_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]{0,63}")
ACTIVE_STATES = {
    "active",
    "inactive",
    "activating",
    "deactivating",
    "failed",
    "reloading",
    "maintenance",
}
SERVICE_SUB_STATES = {
    "running",
    "exited",
    "dead",
    "failed",
    "start-pre",
    "start",
    "start-post",
    "stop",
    "stop-watchdog",
    "stop-sigterm",
    "stop-sigkill",
    "stop-post",
    "final-watchdog",
    "final-sigterm",
    "final-sigkill",
    "auto-restart",
    "cleaning",
    "condition",
    "reload",
}
CPU_QUOTA_TOKEN = re.compile(r"(\d+(?:\.\d+)?)(us|ms|s|min|h)")
CPU_UNIT_USEC = {
    "us": Decimal(1),
    "ms": Decimal(1_000),
    "s": Decimal(1_000_000),
    "min": Decimal(60_000_000),
    "h": Decimal(3_600_000_000),
}


class HardeningAuditError(RuntimeError):
    pass


Runner = Callable[..., subprocess.CompletedProcess[str]]


def _command(unit: str) -> list[str]:
    if unit not in UNITS:
        raise HardeningAuditError("UNIT_NOT_ALLOWED")
    command = ["systemctl", "show", unit, "--no-pager"]
    for prop in PROPERTIES:
        command.extend(["--property", prop])
    return command


def _parse_show(stdout: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in stdout.splitlines():
        if "=" not in raw:
            raise HardeningAuditError("SYSTEMD_SHOW_LINE_INVALID")
        key, value = raw.split("=", 1)
        if key not in PROPERTIES or key in values:
            raise HardeningAuditError("SYSTEMD_SHOW_PROPERTY_INVALID")
        values[key] = value
    missing = [prop for prop in PROPERTIES if prop not in values]
    if missing:
        raise HardeningAuditError("SYSTEMD_SHOW_PROPERTY_MISSING")
    return values


def read_snapshot(
    unit: str,
    *,
    runner: Runner = subprocess.run,
) -> dict[str, str]:
    result = runner(
        _command(unit),
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if result.stderr:
        raise HardeningAuditError("SYSTEMD_SHOW_STDERR")
    return _parse_show(result.stdout)


def _counter(snapshot: dict[str, str], key: str) -> int:
    raw = snapshot.get(key, "")
    if not raw.isdigit():
        raise HardeningAuditError(f"{key.upper()}_INVALID")
    value = int(raw)
    if value < 0:
        raise HardeningAuditError(f"{key.upper()}_INVALID")
    return value


def _boolean(value: str, code: str) -> bool:
    normalized = value.strip().lower()
    if normalized not in {"yes", "no"}:
        raise HardeningAuditError(code)
    return normalized == "yes"


def _name(value: str, code: str, *, empty_allowed: bool) -> str:
    normalized = value.strip()
    if not normalized and empty_allowed:
        return ""
    if not SYSTEMD_NAME.fullmatch(normalized):
        raise HardeningAuditError(code)
    return normalized


def _finite_integer_limit(value: str, code: str) -> int | None:
    normalized = value.strip().lower()
    if normalized == INFINITE_VALUE:
        return None
    if not normalized.isdigit() or int(normalized) <= 0:
        raise HardeningAuditError(code)
    return int(normalized)


def _cpu_quota_usec(value: str) -> int | None:
    normalized = value.strip().lower()
    if normalized == INFINITE_VALUE:
        return None
    if not normalized:
        raise HardeningAuditError("CPU_QUOTA_INVALID")

    total = Decimal(0)
    position = 0
    matched = False
    for match in CPU_QUOTA_TOKEN.finditer(normalized):
        if normalized[position : match.start()].strip():
            raise HardeningAuditError("CPU_QUOTA_INVALID")
        matched = True
        try:
            total += Decimal(match.group(1)) * CPU_UNIT_USEC[match.group(2)]
        except (InvalidOperation, KeyError) as error:
            raise HardeningAuditError("CPU_QUOTA_INVALID") from error
        position = match.end()
    if not matched or normalized[position:].strip():
        raise HardeningAuditError("CPU_QUOTA_INVALID")
    if total <= 0 or total != total.to_integral_value():
        raise HardeningAuditError("CPU_QUOTA_INVALID")
    return int(total)


def _working_directory_class(value: str) -> str:
    if not value.startswith("/") or any(ord(char) < 32 for char in value):
        raise HardeningAuditError("WORKING_DIRECTORY_INVALID")
    if re.fullmatch(r"/opt/octoport/ops-releases/[0-9a-f]{40}(?:/.*)?", value):
        return "PINNED_OPS_RELEASE"
    if value.startswith("/root/"):
        return "ROOT_PRIVATE_PATH"
    return "OTHER_ABSOLUTE_PATH"


def normalize_configuration(snapshot: dict[str, str]) -> dict[str, Any]:
    active = snapshot["ActiveState"].strip().lower()
    sub = snapshot["SubState"].strip().lower()
    if active not in ACTIVE_STATES:
        raise HardeningAuditError("ACTIVE_STATE_INVALID")
    if sub not in SERVICE_SUB_STATES:
        raise HardeningAuditError("SUB_STATE_INVALID")
    dynamic = _boolean(snapshot["DynamicUser"], "DYNAMIC_USER_INVALID")
    user = _name(snapshot["User"], "SERVICE_USER_INVALID", empty_allowed=True)
    group = _name(snapshot["Group"], "SERVICE_GROUP_INVALID", empty_allowed=True)
    no_new_privileges = _boolean(
        snapshot["NoNewPrivileges"],
        "NO_NEW_PRIVILEGES_INVALID",
    )
    private_tmp = snapshot["PrivateTmp"].strip().lower()
    if private_tmp not in {"no", "yes", "disconnected"}:
        raise HardeningAuditError("PRIVATE_TMP_INVALID")
    protect_system = snapshot["ProtectSystem"].strip().lower()
    if protect_system not in {"no", "yes", "full", "strict"}:
        raise HardeningAuditError("PROTECT_SYSTEM_INVALID")
    protect_home = snapshot["ProtectHome"].strip().lower()
    if protect_home not in {"no", "yes", "read-only", "tmpfs"}:
        raise HardeningAuditError("PROTECT_HOME_INVALID")
    return {
        "activeState": active,
        "subState": sub,
        "identityClass": (
            "DYNAMIC"
            if dynamic
            else "ROOT_OR_UNSET"
            if user in {"", "root"}
            else "EXPLICIT_NON_ROOT"
        ),
        "groupConfigured": bool(group),
        "dynamicUser": dynamic,
        "noNewPrivileges": no_new_privileges,
        "privateTmp": private_tmp,
        "protectSystem": protect_system,
        "protectHome": protect_home,
        "memoryHighBytes": _finite_integer_limit(
            snapshot["MemoryHigh"],
            "MEMORY_HIGH_INVALID",
        ),
        "memoryMaxBytes": _finite_integer_limit(
            snapshot["MemoryMax"],
            "MEMORY_MAX_INVALID",
        ),
        "cpuQuotaPerSecUSec": _cpu_quota_usec(snapshot["CPUQuotaPerSecUSec"]),
        "tasksMax": _finite_integer_limit(snapshot["TasksMax"], "TASKS_MAX_INVALID"),
        "workingDirectoryClass": _working_directory_class(
            snapshot["WorkingDirectory"],
        ),
    }


def configuration_gaps(snapshot: dict[str, str]) -> list[str]:
    config = normalize_configuration(snapshot)
    gaps: list[str] = []
    if config["activeState"] != "active" or config["subState"] != "running":
        gaps.append("UNIT_NOT_RUNNING")
    if config["identityClass"] == "ROOT_OR_UNSET":
        gaps.append("SERVICE_IDENTITY_ROOT_OR_UNSET")
    if not config["dynamicUser"] and not config["groupConfigured"]:
        gaps.append("SERVICE_GROUP_UNSET")
    if not config["noNewPrivileges"]:
        gaps.append("NO_NEW_PRIVILEGES_DISABLED")
    if config["privateTmp"] == "no":
        gaps.append("PRIVATE_TMP_DISABLED")
    if config["protectSystem"] not in {"full", "strict"}:
        gaps.append("PROTECT_SYSTEM_WEAK")
    if config["protectHome"] == "no":
        gaps.append("PROTECT_HOME_WEAK")
    if config["memoryHighBytes"] is None:
        gaps.append("MEMORY_HIGH_UNBOUNDED")
    if config["memoryMaxBytes"] is None:
        gaps.append("MEMORY_MAX_UNBOUNDED")
    if config["cpuQuotaPerSecUSec"] is None:
        gaps.append("CPU_QUOTA_UNBOUNDED")
    if config["tasksMax"] is None:
        gaps.append("TASKS_MAX_UNBOUNDED")
    return gaps


def _stable_config(samples: Sequence[dict[str, str]]) -> dict[str, str]:
    if not samples:
        raise HardeningAuditError("SAMPLES_EMPTY")
    first = {key: samples[0][key] for key in CONFIG_PROPERTIES}
    for sample in samples[1:]:
        if any(sample[key] != first[key] for key in CONFIG_PROPERTIES):
            raise HardeningAuditError("UNIT_CONFIGURATION_CHANGED_DURING_AUDIT")
    return first


def summarize_samples(
    samples: Sequence[dict[str, str]],
    sample_times_ns: Sequence[int],
) -> dict[str, Any]:
    if len(samples) != len(sample_times_ns) or not samples:
        raise HardeningAuditError("SAMPLE_TIMELINE_INVALID")
    raw_config = _stable_config(samples)
    config = normalize_configuration(raw_config)
    memory_values = [_counter(sample, "MemoryCurrent") for sample in samples]
    task_values = [_counter(sample, "TasksCurrent") for sample in samples]
    cpu_values = [_counter(sample, "CPUUsageNSec") for sample in samples]
    if any(after < before for before, after in zip(cpu_values, cpu_values[1:])):
        raise HardeningAuditError("CPU_COUNTER_REGRESSED")

    average_cpu_percent: float | None = None
    elapsed_ns = sample_times_ns[-1] - sample_times_ns[0]
    if len(samples) > 1:
        if elapsed_ns <= 0:
            raise HardeningAuditError("SAMPLE_TIMELINE_INVALID")
        average_cpu_percent = round(
            (cpu_values[-1] - cpu_values[0]) * 100 / elapsed_ns,
            3,
        )

    return {
        "configuration": config,
        "observed": {
            "memoryCurrentMaxBytes": max(memory_values),
            "tasksCurrentMax": max(task_values),
            "cpuUsageStartNSec": cpu_values[0],
            "cpuUsageEndNSec": cpu_values[-1],
            "averageCpuPercent": average_cpu_percent,
        },
        "gaps": configuration_gaps(raw_config),
    }


def audit_units(
    *,
    samples: int = 3,
    interval_seconds: float = 1.0,
    runner: Runner = subprocess.run,
    sleeper: Callable[[float], None] = time.sleep,
    monotonic_ns: Callable[[], int] = time.monotonic_ns,
) -> dict[str, Any]:
    if not 1 <= samples <= 60:
        raise HardeningAuditError("SAMPLE_COUNT_INVALID")
    if not 0 <= interval_seconds <= 10:
        raise HardeningAuditError("SAMPLE_INTERVAL_INVALID")

    captured: dict[str, list[dict[str, str]]] = {unit: [] for unit in UNITS}
    sample_times: list[int] = []
    for index in range(samples):
        sample_times.append(monotonic_ns())
        for unit in UNITS:
            captured[unit].append(read_snapshot(unit, runner=runner))
        if index + 1 < samples:
            sleeper(interval_seconds)

    units = {
        unit: summarize_samples(captured[unit], sample_times)
        for unit in UNITS
    }
    gaps = [
        {"unit": unit, "code": code}
        for unit, summary in units.items()
        for code in summary["gaps"]
    ]
    return {
        "schema": "octoport-owner-test-runtime-hardening-audit-v1",
        "status": "HARDENING_GAPS_FOUND" if gaps else "HARDENING_BASELINE_PASS",
        "evidenceLevel": "READ_ONLY_HOST_OBSERVATION",
        "mutationPerformed": False,
        "secretMaterialRead": False,
        "samples": samples,
        "intervalSeconds": interval_seconds,
        "capacityProof": "NOT_PROVEN_SHORT_WINDOW",
        "capacityNote": (
            "Observed counters describe only this bounded window. "
            "They are not final Memory/CPU/Tasks limits and cannot authorize apply."
        ),
        "units": units,
        "gaps": gaps,
        "nextProofsRequired": [
            "representative workload envelope before choosing final resource ceilings",
            "non-root service identity and release/env/runtime-path permission rehearsal",
            "staging start/readiness/auth/bootstrap proof under proposed sandbox controls",
            "independent review and separate live authority before any unit mutation",
        ],
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Read-only owner-test systemd hardening preflight.",
    )
    parser.add_argument("--samples", type=int, default=3)
    parser.add_argument("--interval-seconds", type=float, default=1.0)
    return parser
def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        result = audit_units(
            samples=args.samples,
            interval_seconds=args.interval_seconds,
        )
    except (
        HardeningAuditError,
        OSError,
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
    ) as error:
        code = (
            str(error)
            if isinstance(error, HardeningAuditError)
            else "HARDENING_AUDIT_FAILED"
        )
        print(
            json.dumps(
                {
                    "schema": "octoport-owner-test-runtime-hardening-audit-v1",
                    "status": "FAIL",
                    "code": code,
                    "mutationPerformed": False,
                    "secretMaterialRead": False,
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
