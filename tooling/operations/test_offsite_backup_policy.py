from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from offsite_backup_policy import (
    DESTINATION_CLASS,
    DESTINATION_REFERENCE,
    PENDING,
    RECORDED,
    REQUIRED_RESTORE_GATES,
    RETENTION,
    RUNTIME_ACCESS,
    PolicyError,
    load_policy,
    validate_policy,
)


def pending_policy() -> dict:
    return {
        "schemaVersion": "octoport-offsite-backup-policy-v1",
        "decisionState": PENDING,
        "destination": {
            "destinationClass": None,
            "destinationReference": None,
            "runtimeAccess": RUNTIME_ACCESS,
            "ownerSelected": False,
            "hostFailureDomainIndependent": None,
            "sourceHostLossSurvivable": None,
        },
        "retention": dict(RETENTION),
        "objectives": {"rpoMinutes": None, "rtoMinutes": None},
        "restoreAcceptance": {
            "evidenceState": "NOT_RUN",
            "requiredGates": list(REQUIRED_RESTORE_GATES),
        },
    }


def recorded_policy() -> dict:
    value = pending_policy()
    value["decisionState"] = RECORDED
    value["destination"] = {
        "destinationClass": DESTINATION_CLASS,
        "destinationReference": DESTINATION_REFERENCE,
        "runtimeAccess": RUNTIME_ACCESS,
        "ownerSelected": True,
        "hostFailureDomainIndependent": True,
        "sourceHostLossSurvivable": True,
    }
    value["objectives"] = {"rpoMinutes": 1440, "rtoMinutes": 240}
    return value


REPO_ROOT = Path(__file__).resolve().parents[2]


class OffsiteBackupPolicyTest(unittest.TestCase):
    def test_repository_template_is_pending_and_valid(self) -> None:
        result = load_policy(
            REPO_ROOT / "docs/product/readiness/OFFSITE_BACKUP_POLICY_TEMPLATE.json"
        )
        self.assertEqual(result["status"], "OWNER_DECISION_REQUIRED")

    def test_pending_template_is_valid_but_not_ready(self) -> None:
        result = validate_policy(pending_policy())
        self.assertEqual(result["status"], "OWNER_DECISION_REQUIRED")
        self.assertFalse(result["destinationReady"])
        self.assertFalse(result["objectivesReady"])
        self.assertFalse(result["productionAccepted"])
        self.assertEqual(result["restoreEvidence"], "NOT_RUN")

    def test_recorded_policy_is_ready_for_rehearsal_only(self) -> None:
        result = validate_policy(recorded_policy())
        self.assertEqual(result["status"], "READY_FOR_OFFSITE_REHEARSAL")
        self.assertEqual(result["destinationClass"], DESTINATION_CLASS)
        self.assertEqual(result["runtimeAccess"], RUNTIME_ACCESS)
        self.assertEqual(result["rpoMinutes"], 1440)
        self.assertEqual(result["rtoMinutes"], 240)
        self.assertFalse(result["productionAccepted"])
        self.assertEqual(result["restoreEvidence"], "NOT_RUN")

    def test_pending_policy_rejects_partial_owner_input(self) -> None:
        value = pending_policy()
        value["objectives"]["rpoMinutes"] = 1440
        with self.assertRaisesRegex(PolicyError, "PENDING_OWNER_INPUT_PARTIAL"):
            validate_policy(value)

    def test_same_host_or_non_offhost_destination_is_rejected(self) -> None:
        for key, replacement in (
            ("destinationClass", "SEPARATE_MOUNT_SAME_HOST"),
            ("hostFailureDomainIndependent", False),
            ("sourceHostLossSurvivable", False),
        ):
            with self.subTest(key=key):
                value = recorded_policy()
                value["destination"][key] = replacement
                with self.assertRaisesRegex(PolicyError, "DESTINATION_NOT_OFF_HOST"):
                    validate_policy(value)

    def test_destination_reference_is_fixed_nonsecret_alias(self) -> None:
        self.assertEqual(
            recorded_policy()["destination"]["destinationReference"],
            DESTINATION_REFERENCE,
        )
        for reference in (
            "",
            "/mnt/backup",
            "s3://provider-bucket",
            "AKIA1234567890EXAMPLE",
            "owner-ref-secret-token",
            "contains space",
            "x" * 65,
        ):
            with self.subTest(reference=reference):
                value = recorded_policy()
                value["destination"]["destinationReference"] = reference
                with self.assertRaisesRegex(
                    PolicyError, "DESTINATION_REFERENCE_INVALID"
                ):
                    validate_policy(value)

    def test_rpo_rto_require_positive_integers(self) -> None:
        for field, code in (
            ("rpoMinutes", "RPO_TARGET_INVALID"),
            ("rtoMinutes", "RTO_TARGET_INVALID"),
        ):
            for bad in (None, 0, -1, True, 1.5, "60"):
                with self.subTest(field=field, bad=bad):
                    value = recorded_policy()
                    value["objectives"][field] = bad
                    with self.assertRaisesRegex(PolicyError, code):
                        validate_policy(value)

    def test_retention_contract_is_exactly_existing_source_behavior(self) -> None:
        for field, bad in (
            ("keepSuccessful", 8),
            ("schedule", "HOURLY"),
            ("randomizedDelayMinutes", 0),
            ("accuracyMinutes", 1),
        ):
            with self.subTest(field=field):
                value = recorded_policy()
                value["retention"][field] = bad
                with self.assertRaisesRegex(
                    PolicyError, "RETENTION_CONTRACT_MISMATCH"
                ):
                    validate_policy(value)

    def test_restore_contract_rejects_missing_extra_or_reordered_gate(self) -> None:
        variants = []
        missing = recorded_policy()
        missing["restoreAcceptance"]["requiredGates"] = list(
            REQUIRED_RESTORE_GATES[:-1]
        )
        variants.append(missing)
        extra = recorded_policy()
        extra["restoreAcceptance"]["requiredGates"] = list(
            REQUIRED_RESTORE_GATES
        ) + ["UNKNOWN_GATE"]
        variants.append(extra)
        reordered = recorded_policy()
        reordered["restoreAcceptance"]["requiredGates"] = list(
            reversed(REQUIRED_RESTORE_GATES)
        )
        variants.append(reordered)
        for value in variants:
            with self.assertRaisesRegex(PolicyError, "RESTORE_GATES_MISMATCH"):
                validate_policy(value)

    def test_restore_evidence_cannot_be_predeclared_pass(self) -> None:
        value = recorded_policy()
        value["restoreAcceptance"]["evidenceState"] = "PASS"
        with self.assertRaisesRegex(
            PolicyError, "RESTORE_EVIDENCE_STATE_INVALID"
        ):
            validate_policy(value)

    def test_forbidden_secret_field_is_rejected_recursively(self) -> None:
        value = recorded_policy()
        value["destination"]["metadata"] = {"providerToken": "forbidden"}
        with self.assertRaisesRegex(PolicyError, "POLICY_SECRET_FIELD_FORBIDDEN"):
            validate_policy(value)

    def test_unknown_fields_fail_closed(self) -> None:
        value = recorded_policy()
        value["unexpected"] = "x"
        with self.assertRaisesRegex(PolicyError, "POLICY_SHAPE_INVALID"):
            validate_policy(value)

    def test_repository_template_is_pending_and_source_contract_matches(self) -> None:
        root = Path(__file__).resolve().parents[2]
        template = root / "docs/product/readiness/OFFSITE_BACKUP_POLICY_TEMPLATE.json"
        result = load_policy(template)
        self.assertEqual(result["status"], "OWNER_DECISION_REQUIRED")
        self.assertEqual(result["decisionState"], PENDING)
        self.assertFalse(result["productionAccepted"])

        helper = (root / "tooling/operations/backup_postgres_independent.py").read_text()
        self.assertIn('keep_successful: int = 7', helper)
        self.assertIn('"octoport-postgres-backup-v1"', helper)
        self.assertIn("verify_independent_mounts(", helper)
        self.assertIn("pg_restore", helper)

        timer = (root / "infra/production/systemd/octoport-postgres-backup.timer").read_text()
        for exact in (
            "OnCalendar=daily",
            "Persistent=yes",
            "RandomizedDelaySec=30m",
            "AccuracySec=5m",
        ):
            self.assertIn(exact, timer)

    def test_load_policy_rejects_duplicate_keys_before_validation(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "policy.json"
            raw = json.dumps(recorded_policy())
            raw = raw.replace(
                '"destinationReference": "OWNER_SELECTED_OFFHOST_DESTINATION_1"',
                '"destinationReference": "AKIA1234567890EXAMPLE", '
                '"destinationReference": "OWNER_SELECTED_OFFHOST_DESTINATION_1"',
                1,
            )
            path.write_text(raw)
            with self.assertRaisesRegex(PolicyError, "POLICY_JSON_DUPLICATE_KEY"):
                load_policy(path)

    def test_load_policy_rejects_symlink_and_accepts_regular_file(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            policy = root / "policy.json"
            policy.write_text(json.dumps(recorded_policy()))
            self.assertEqual(
                load_policy(policy)["status"], "READY_FOR_OFFSITE_REHEARSAL"
            )
            link = root / "policy-link.json"
            link.symlink_to(policy)
            with self.assertRaisesRegex(PolicyError, "POLICY_FILE_INVALID"):
                load_policy(link)


if __name__ == "__main__":
    unittest.main()
