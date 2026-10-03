#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Mapping


SCHEMA_VERSION = "octoport-offsite-backup-policy-v1"
PENDING = "OWNER_DECISION_PENDING"
RECORDED = "OWNER_DECISION_RECORDED"
DESTINATION_CLASS = "OFF_HOST_MOUNTED_FILESYSTEM"
DESTINATION_REFERENCE = "OWNER_SELECTED_OFFHOST_DESTINATION_1"
RUNTIME_ACCESS = "EXISTING_MOUNTED_FILESYSTEM_BACKUP"

RETENTION = {
    "model": "KEEP_VERIFIED_SUCCESSFUL_COUNT",
    "keepSuccessful": 7,
    "schedule": "DAILY_PERSISTENT",
    "randomizedDelayMinutes": 30,
    "accuracyMinutes": 5,
}

REQUIRED_RESTORE_GATES = [
    "ARCHIVE_HASH_AND_BYTES_VERIFIED",
    "PG_RESTORE_LIST_VERIFIED",
    "SELECTED_DESTINATION_ARCHIVE_READBACK_VERIFIED",
    "DISPOSABLE_DATABASE_RESTORE_VERIFIED",
    "MIGRATION_JOURNAL_READBACK_VERIFIED",
    "PROTECTED_STATE_INVARIANTS_VERIFIED",
    "APPLICATION_HEALTH_AND_BOOTSTRAP_VERIFIED",
    "COMPATIBLE_ROLLBACK_FLOOR_VERIFIED",
    "BACKUP_AGE_WITHIN_RECORDED_RPO_VERIFIED",
    "MEASURED_RESTORE_DURATION_WITHIN_RECORDED_RTO_VERIFIED",
]

FORBIDDEN_KEY_FRAGMENTS = (
    "password",
    "token",
    "secret",
    "credential",
    "databaseurl",
    "database_url",
    "otp",
    "cookie",
    "accesskey",
    "access_key",
    "secretkey",
    "secret_key",
    "connectionstring",
    "connection_string",
    "dsn",
)

class PolicyError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _fail(code: str) -> None:
    raise PolicyError(code)


def _object_without_duplicate_keys(
    pairs: list[tuple[str, Any]],
) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            _fail("POLICY_JSON_DUPLICATE_KEY")
        result[key] = value
    return result


def _exact_keys(value: Any, expected: set[str], code: str) -> Mapping[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        _fail(code)
    return value


def _normalized_key(value: str) -> str:
    return "".join(character for character in value.lower() if character.isalnum() or character == "_")


def _reject_forbidden_keys(value: Any) -> None:
    if isinstance(value, dict):
        for key, nested in value.items():
            if not isinstance(key, str):
                _fail("POLICY_KEY_INVALID")
            normalized = _normalized_key(key)
            if any(fragment in normalized for fragment in FORBIDDEN_KEY_FRAGMENTS):
                _fail("POLICY_SECRET_FIELD_FORBIDDEN")
            _reject_forbidden_keys(nested)
    elif isinstance(value, list):
        for nested in value:
            _reject_forbidden_keys(nested)


def _positive_int(value: Any, code: str) -> int:
    if type(value) is not int or value <= 0:
        _fail(code)
    return value


def _validate_retention(value: Any) -> None:
    retention = _exact_keys(value, set(RETENTION), "RETENTION_SHAPE_INVALID")
    for key, expected in RETENTION.items():
        if retention[key] != expected:
            _fail("RETENTION_CONTRACT_MISMATCH")


def _validate_restore_contract(value: Any) -> None:
    restore = _exact_keys(
        value,
        {"evidenceState", "requiredGates"},
        "RESTORE_CONTRACT_SHAPE_INVALID",
    )
    if restore["evidenceState"] != "NOT_RUN":
        _fail("RESTORE_EVIDENCE_STATE_INVALID")
    gates = restore["requiredGates"]
    if not isinstance(gates, list) or gates != REQUIRED_RESTORE_GATES:
        _fail("RESTORE_GATES_MISMATCH")
    if len(set(gates)) != len(gates):
        _fail("RESTORE_GATES_DUPLICATE")


def _validate_pending(destination: Mapping[str, Any], objectives: Mapping[str, Any]) -> dict[str, Any]:
    if destination != {
        "destinationClass": None,
        "destinationReference": None,
        "runtimeAccess": RUNTIME_ACCESS,
        "ownerSelected": False,
        "hostFailureDomainIndependent": None,
        "sourceHostLossSurvivable": None,
    }:
        _fail("PENDING_OWNER_INPUT_PARTIAL")
    if objectives != {"rpoMinutes": None, "rtoMinutes": None}:
        _fail("PENDING_OWNER_INPUT_PARTIAL")
    return {
        "status": "OWNER_DECISION_REQUIRED",
        "decisionState": PENDING,
        "destinationReady": False,
        "objectivesReady": False,
        "retentionContract": "SOURCE_BOUND",
        "restoreEvidence": "NOT_RUN",
        "productionAccepted": False,
    }


def _validate_recorded(destination: Mapping[str, Any], objectives: Mapping[str, Any]) -> dict[str, Any]:
    if destination["destinationClass"] != DESTINATION_CLASS:
        _fail("DESTINATION_NOT_OFF_HOST")
    if destination["runtimeAccess"] != RUNTIME_ACCESS:
        _fail("DESTINATION_RUNTIME_ACCESS_INVALID")
    if destination["ownerSelected"] is not True:
        _fail("DESTINATION_OWNER_SELECTION_REQUIRED")
    if destination["hostFailureDomainIndependent"] is not True:
        _fail("DESTINATION_NOT_OFF_HOST")
    if destination["sourceHostLossSurvivable"] is not True:
        _fail("DESTINATION_NOT_OFF_HOST")
    reference = destination["destinationReference"]
    if reference != DESTINATION_REFERENCE:
        _fail("DESTINATION_REFERENCE_INVALID")
    rpo = _positive_int(objectives["rpoMinutes"], "RPO_TARGET_INVALID")
    rto = _positive_int(objectives["rtoMinutes"], "RTO_TARGET_INVALID")
    return {
        "status": "READY_FOR_OFFSITE_REHEARSAL",
        "decisionState": RECORDED,
        "destinationReady": True,
        "objectivesReady": True,
        "destinationClass": DESTINATION_CLASS,
        "runtimeAccess": RUNTIME_ACCESS,
        "rpoMinutes": rpo,
        "rtoMinutes": rto,
        "retentionContract": "SOURCE_BOUND",
        "restoreEvidence": "NOT_RUN",
        "productionAccepted": False,
    }


def validate_policy(value: Any) -> dict[str, Any]:
    _reject_forbidden_keys(value)
    policy = _exact_keys(
        value,
        {
            "schemaVersion",
            "decisionState",
            "destination",
            "retention",
            "objectives",
            "restoreAcceptance",
        },
        "POLICY_SHAPE_INVALID",
    )
    if policy["schemaVersion"] != SCHEMA_VERSION:
        _fail("POLICY_SCHEMA_VERSION_INVALID")
    decision = policy["decisionState"]
    if decision not in {PENDING, RECORDED}:
        _fail("POLICY_DECISION_STATE_INVALID")

    destination = _exact_keys(
        policy["destination"],
        {
            "destinationClass",
            "destinationReference",
            "runtimeAccess",
            "ownerSelected",
            "hostFailureDomainIndependent",
            "sourceHostLossSurvivable",
        },
        "DESTINATION_SHAPE_INVALID",
    )
    objectives = _exact_keys(
        policy["objectives"],
        {"rpoMinutes", "rtoMinutes"},
        "OBJECTIVES_SHAPE_INVALID",
    )
    _validate_retention(policy["retention"])
    _validate_restore_contract(policy["restoreAcceptance"])

    if decision == PENDING:
        return _validate_pending(destination, objectives)
    return _validate_recorded(destination, objectives)


def load_policy(path: Path) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        _fail("POLICY_FILE_INVALID")
    try:
        raw = path.read_bytes()
    except OSError as error:
        raise PolicyError("POLICY_FILE_UNREADABLE") from error
    if not raw or len(raw) > 65536:
        _fail("POLICY_FILE_SIZE_INVALID")
    try:
        value = json.loads(raw, object_pairs_hook=_object_without_duplicate_keys)
    except json.JSONDecodeError as error:
        raise PolicyError("POLICY_JSON_INVALID") from error
    return validate_policy(value)


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print(json.dumps({"status": "FAIL", "code": "POLICY_PATH_REQUIRED"}), file=sys.stderr)
        return 2
    try:
        result = load_policy(Path(args[0]))
    except PolicyError as error:
        print(json.dumps({"status": "FAIL", "code": error.code}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
