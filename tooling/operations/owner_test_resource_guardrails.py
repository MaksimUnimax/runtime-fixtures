#!/usr/bin/env python3
"""Validate the source-only owner-test finite resource guardrail candidate.

The exact limits below are staging safety guardrails already exercised by the
accepted non-root sandbox. They are deliberately not production capacity or
representative-concurrency claims. This module parses source files only and
performs no systemd/cgroup/service mutation.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
from pathlib import Path
from typing import Any


class ResourceGuardrailError(RuntimeError):
    pass


SERVICES: dict[str, dict[str, Any]] = {
    "api": {
        "template": "seller-agents-owner-test-api-resource.conf.in",
        "memoryMax": "1G",
        "memoryMaxBytes": 1_073_741_824,
        "tasksMax": 128,
    },
    "worker": {
        "template": "seller-agents-owner-test-worker-resource.conf.in",
        "memoryMax": "900M",
        "memoryMaxBytes": 943_718_400,
        "tasksMax": 128,
    },
    "portal": {
        "template": "seller-agents-owner-test-portal-resource.conf.in",
        "memoryMax": "700M",
        "memoryMaxBytes": 734_003_200,
        "tasksMax": 128,
    },
}

ACCEPTED_EVIDENCE: dict[str, Any] = {
    "functional": {
        "evidenceLevel": "DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE",
        "services": {
            "api": {"rssBytesMax": 433_680_384, "highWaterBytesMax": 433_836_032, "taskCountMax": 35},
            "worker": {"rssBytesMax": 382_681_088, "highWaterBytesMax": 383_545_344, "taskCountMax": 35},
            "portal": {"rssBytesMax": 200_798_208, "highWaterBytesMax": 200_798_208, "taskCountMax": 19},
        },
        "productionCapacityClaim": False,
    },
    "sequential100": {
        "evidenceLevel": "FIRST_WAVE_100_SEQUENTIAL_CYCLES",
        "services": {
            "api": {"rssBytesMax": 462_643_200, "highWaterBytesMax": 462_643_200, "taskCountMax": 23},
            "worker": {"rssBytesMax": 373_473_280, "highWaterBytesMax": 373_473_280, "taskCountMax": 23},
            "portal": {"rssBytesMax": 251_604_992, "highWaterBytesMax": 252_018_688, "taskCountMax": 19},
        },
        "concurrency": 1,
        "representativeConcurrencyClaim": False,
        "productionCapacityClaim": False,
    },
    "synchronizedBurstDiagnostic": {
        "evidenceLevel": "REQUEST_LEVEL_SYNCHRONIZED_BURST_DIAGNOSTIC",
        "services": {
            "api": {"rssBytesMax": 475_652_096, "highWaterBytesMax": 475_652_096, "taskCountMax": 23},
            "worker": {"rssBytesMax": 358_346_752, "highWaterBytesMax": 358_346_752, "taskCountMax": 23},
            "portal": {"rssBytesMax": 297_086_976, "highWaterBytesMax": 297_086_976, "taskCountMax": 19},
        },
        "stages": [1, 2, 4, 8, 16, 32, 64, 100],
        "cycles": 227,
        "requestsPerCycle": 8,
        "totalRequests": 1816,
        "maxSynchronizedCycleCount": 100,
        "representativeConcurrencyClaim": False,
        "productionCapacityClaim": False,
        "ranUnderTheseMemoryMaxValues": False,
    },
}

EVIDENCE_SOURCES = {
    "functional": "docs/development/coordination/receipts/C/B05_NONROOT_SERVICE_RESOURCE_ENVELOPE_2026-10-01.md",
    "sequential100": "docs/development/coordination/receipts/A/B05_FIRST_WAVE_SEQUENTIAL_RESOURCE_ENVELOPE_2026-10-01.md",
    "synchronizedBurstDiagnostic": "/root/octoport-control/logs/A/b05-first-wave-burst-staircase-20261001/run-r1/c05-three-service-rollback-evidence.json",
    "guardrailExercise": "/root/octoport-control/logs/B/b05-nonroot-systemd-sandbox-staging-rehearsal-r1-20261004/RESULT.json",
}

ALLOWED_DIRECTIVES = {"MemoryMax", "TasksMax"}
UNRESOLVED_DIRECTIVES = ("MemoryHigh", "CPUQuota")
SERVICE_EVIDENCE_FIELDS = {"rssBytesMax", "highWaterBytesMax", "taskCountMax"}
EVIDENCE_CONTRACTS = {
    "functional": {
        "fields": {"evidenceLevel", "services", "productionCapacityClaim"},
        "evidenceLevel": "DISPOSABLE_FUNCTIONAL_RESOURCE_ENVELOPE",
    },
    "sequential100": {
        "fields": {
            "evidenceLevel", "services", "concurrency",
            "representativeConcurrencyClaim", "productionCapacityClaim",
        },
        "evidenceLevel": "FIRST_WAVE_100_SEQUENTIAL_CYCLES",
    },
    "synchronizedBurstDiagnostic": {
        "fields": {
            "evidenceLevel", "services", "stages", "cycles", "requestsPerCycle",
            "totalRequests", "maxSynchronizedCycleCount",
            "representativeConcurrencyClaim", "productionCapacityClaim",
            "ranUnderTheseMemoryMaxValues",
        },
        "evidenceLevel": "REQUEST_LEVEL_SYNCHRONIZED_BURST_DIAGNOSTIC",
    },
}


def _parse_template(text: str) -> dict[str, str]:
    section: str | None = None
    saw_service = False
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") and line.endswith("]"):
            if line != "[Service]":
                raise ResourceGuardrailError("TEMPLATE_SECTION_INVALID")
            if saw_service:
                raise ResourceGuardrailError("TEMPLATE_SECTION_DUPLICATE")
            saw_service = True
            section = line
            continue
        if section != "[Service]" or "=" not in raw:
            raise ResourceGuardrailError("TEMPLATE_LINE_INVALID")
        key, value = raw.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key or key in values:
            raise ResourceGuardrailError("TEMPLATE_DIRECTIVE_DUPLICATE")
        if key not in ALLOWED_DIRECTIVES:
            raise ResourceGuardrailError("TEMPLATE_RESOURCE_DIRECTIVE_NOT_APPROVED")
        values[key] = value
    if not saw_service:
        raise ResourceGuardrailError("TEMPLATE_SERVICE_SECTION_MISSING")
    return values


def validate_template(role: str, text: str) -> dict[str, str]:
    spec = SERVICES.get(role)
    if spec is None:
        raise ResourceGuardrailError("SERVICE_ROLE_INVALID")
    values = _parse_template(text)
    expected = {
        "MemoryMax": str(spec["memoryMax"]),
        "TasksMax": str(spec["tasksMax"]),
    }
    if values != expected:
        raise ResourceGuardrailError("TEMPLATE_RESOURCE_VALUES_INVALID")
    return values


def validate_template_set(template_dir: Path) -> dict[str, dict[str, Any]]:
    if not template_dir.is_dir() or template_dir.is_symlink():
        raise ResourceGuardrailError("TEMPLATE_DIRECTORY_INVALID")
    expected_names = {str(spec["template"]) for spec in SERVICES.values()}
    observed_names = {
        path.name
        for path in template_dir.glob("seller-agents-owner-test-*-resource.conf.in")
    }
    if observed_names != expected_names:
        raise ResourceGuardrailError("SERVICE_TEMPLATE_SET_INVALID")
    result: dict[str, dict[str, Any]] = {}
    for role, spec in SERVICES.items():
        path = template_dir / str(spec["template"])
        if not path.is_file() or path.is_symlink():
            raise ResourceGuardrailError("SERVICE_TEMPLATE_PATH_INVALID")
        raw = path.read_text(encoding="utf-8")
        validate_template(role, raw)
        result[role] = {
            "template": path.name,
            "memoryMax": spec["memoryMax"],
            "memoryMaxBytes": spec["memoryMaxBytes"],
            "tasksMax": spec["tasksMax"],
            "templateSha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        }
    return result


def validate_evidence_binding(evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    checked = copy.deepcopy(ACCEPTED_EVIDENCE if evidence is None else evidence)
    if set(checked) != set(ACCEPTED_EVIDENCE):
        raise ResourceGuardrailError("EVIDENCE_SET_INVALID")
    for evidence_key, entry in checked.items():
        contract = EVIDENCE_CONTRACTS[evidence_key]
        if not isinstance(entry, dict):
            raise ResourceGuardrailError("EVIDENCE_ENTRY_INVALID")
        if set(entry) != contract["fields"]:
            raise ResourceGuardrailError("EVIDENCE_ENTRY_FIELDS_INVALID")
        if entry.get("evidenceLevel") != contract["evidenceLevel"]:
            raise ResourceGuardrailError("EVIDENCE_LEVEL_INVALID")
        if entry.get("productionCapacityClaim") is not False:
            raise ResourceGuardrailError("EVIDENCE_CAPACITY_CLAIM_INVALID")
        services = entry.get("services")
        if not isinstance(services, dict) or set(services) != set(SERVICES):
            raise ResourceGuardrailError("EVIDENCE_SERVICE_SET_INVALID")
        for role, observed in services.items():
            if not isinstance(observed, dict):
                raise ResourceGuardrailError("EVIDENCE_SERVICE_VALUE_INVALID")
            if set(observed) != SERVICE_EVIDENCE_FIELDS:
                raise ResourceGuardrailError("EVIDENCE_METRIC_FIELDS_INVALID")
            spec = SERVICES[role]
            for key in ("rssBytesMax", "highWaterBytesMax", "taskCountMax"):
                value = observed.get(key)
                if type(value) is not int or value <= 0:
                    raise ResourceGuardrailError("EVIDENCE_METRIC_INVALID")
            if observed["rssBytesMax"] >= spec["memoryMaxBytes"]:
                raise ResourceGuardrailError("EVIDENCE_RSS_NOT_BELOW_GUARDRAIL")
            if observed["highWaterBytesMax"] >= spec["memoryMaxBytes"]:
                raise ResourceGuardrailError("EVIDENCE_HWM_NOT_BELOW_GUARDRAIL")
            if observed["taskCountMax"] >= spec["tasksMax"]:
                raise ResourceGuardrailError("EVIDENCE_TASKS_NOT_BELOW_GUARDRAIL")
        if evidence_key == "sequential100":
            concurrency = entry.get("concurrency")
            if (
                type(concurrency) is not int
                or concurrency != 1
                or entry.get("representativeConcurrencyClaim") is not False
            ):
                raise ResourceGuardrailError("SEQUENTIAL_EVIDENCE_BOUNDARY_INVALID")
        if evidence_key == "synchronizedBurstDiagnostic":
            stages = entry.get("stages")
            cycles = entry.get("cycles")
            requests_per_cycle = entry.get("requestsPerCycle")
            total_requests = entry.get("totalRequests")
            max_synchronized_cycle_count = entry.get("maxSynchronizedCycleCount")
            if (
                type(stages) is not list
                or any(type(stage) is not int for stage in stages)
                or stages != [1, 2, 4, 8, 16, 32, 64, 100]
                or type(cycles) is not int
                or cycles != 227
                or type(requests_per_cycle) is not int
                or requests_per_cycle != 8
                or type(total_requests) is not int
                or total_requests != 1816
                or type(max_synchronized_cycle_count) is not int
                or max_synchronized_cycle_count != 100
                or entry.get("representativeConcurrencyClaim") is not False
                or entry.get("ranUnderTheseMemoryMaxValues") is not False
            ):
                raise ResourceGuardrailError("BURST_EVIDENCE_BOUNDARY_INVALID")
    return checked


def candidate_plan(template_dir: Path) -> dict[str, Any]:
    services = validate_template_set(template_dir)
    evidence = validate_evidence_binding()
    return {
        "status": "SOURCE_CANDIDATE_VALID",
        "scope": "OWNER_TEST_SAFETY_GUARDRAIL_ONLY",
        "liveMutationPerformed": False,
        "systemdMutationPerformed": False,
        "cgroupMutationPerformed": False,
        "productionCapacityClaim": False,
        "representativeConcurrencyClaim": False,
        "finalResourceCeilingClaim": False,
        "unresolvedDirectives": list(UNRESOLVED_DIRECTIVES),
        "services": services,
        "evidence": evidence,
        "evidenceSources": EVIDENCE_SOURCES,
        "nonClaims": [
            "No representative-user concurrency model is proven.",
            "Burst stage 100 is a request-level diagnostic, not 100 users.",
            "The burst diagnostic is not claimed to have run under these MemoryMax values.",
            "MemoryHigh and CPUQuota remain unresolved and absent.",
            "No live owner-test unit, cgroup, service or production configuration is changed.",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate source-only owner-test finite resource guardrails."
    )
    parser.add_argument(
        "--template-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "infra/production/systemd",
    )
    args = parser.parse_args()
    try:
        result = candidate_plan(args.template_dir)
    except ResourceGuardrailError as error:
        print(json.dumps({"status": "BLOCKED", "error": str(error)}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
