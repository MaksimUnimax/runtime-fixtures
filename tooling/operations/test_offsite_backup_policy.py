from __future__ import annotations

import errno
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
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
    main,
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

    def test_invalid_decision_state_json_container_rejects_with_policy_error(self) -> None:
        for malformed in (
            [],
            {},
            ["OWNER_DECISION_PENDING"],
            {"value": "OWNER_DECISION_RECORDED"},
        ):
            with self.subTest(malformed=malformed):
                source = pending_policy()
                source["decisionState"] = malformed
                with self.assertRaisesRegex(
                    PolicyError, "POLICY_DECISION_STATE_INVALID"
                ):
                    validate_policy(source)

    def test_invalid_decision_state_cli_returns_bounded_error_json(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "invalid-policy.json"
            source = pending_policy()
            source["decisionState"] = []
            path.write_text(json.dumps(source))
            result = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(Path(__file__).with_name("offsite_backup_policy.py")),
                    str(path),
                ],
                capture_output=True,
                text=True,
                timeout=12,
                check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertEqual(
                json.loads(result.stderr),
                {"status": "FAIL", "code": "POLICY_DECISION_STATE_INVALID"},
            )
            self.assertNotIn("Traceback", result.stderr)

    def test_pending_owner_selected_requires_literal_boolean_false(self) -> None:
        for numeric_false in (0, 0.0):
            with self.subTest(value=numeric_false):
                value = pending_policy()
                value["destination"]["ownerSelected"] = numeric_false
                with self.assertRaisesRegex(PolicyError, "PENDING_OWNER_INPUT_PARTIAL"):
                    validate_policy(value)

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

    def test_parser_integer_conversion_value_error_is_bounded(self) -> None:
        # Newer Python JSON decoders can raise ValueError on oversized integers.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "policy.json"
            path.write_text(json.dumps(pending_policy()))
            with patch(
                "offsite_backup_policy.json.loads",
                side_effect=ValueError("synthetic huge integer digit limit"),
            ):
                with self.assertRaisesRegex(PolicyError, "POLICY_JSON_INVALID"):
                    load_policy(path)
            script = (
                "import sys\n"
                "from unittest.mock import patch\n"
                f"sys.path.insert(0, {str(Path(__file__).parent)!r})\n"
                "import offsite_backup_policy as module\n"
                "with patch.object(module.json, 'loads', side_effect=ValueError('synthetic digit-limit')):\n"
                "    raise SystemExit(module.main())\n"
            )
            cli = subprocess.run(
                [sys.executable, "-B", "-c", script, str(path)],
                capture_output=True, text=True, timeout=12, check=False,
            )
            self.assertEqual(cli.returncode, 1)
            self.assertEqual(cli.stdout, "")
            self.assertEqual(
                json.loads(cli.stderr),
                {"status": "FAIL", "code": "POLICY_JSON_INVALID"},
            )
            self.assertNotIn("Traceback", cli.stderr)

    def test_deeply_nested_input_guard_is_nonrecursive(self) -> None:
        # JSON input is bounded at 64KiB; nested objects still must not
        # turn a policy shape rejection into an unhandled RecursionError.
        deep: object = {"secretField": "synthetic-secret-value"}
        for _ in range(1500):
            deep = [deep]
        policy = pending_policy()
        policy["unexpected"] = deep
        with self.assertRaisesRegex(PolicyError, "POLICY_SECRET_FIELD_FORBIDDEN"):
            validate_policy(policy)

    def test_cyclic_python_policy_object_fails_closed(self) -> None:
        cyclic: list[object] = []
        cyclic.append(cyclic)
        policy = pending_policy()
        policy["unexpected"] = cyclic
        with self.assertRaisesRegex(PolicyError, "POLICY_SHAPE_INVALID"):
            validate_policy(policy)

    def test_retention_integer_contract_rejects_float_equivalence(self) -> None:
        for field, bad in (
            ("keepSuccessful", 7.0),
            ("randomizedDelayMinutes", 30.0),
            ("accuracyMinutes", 5.0),
        ):
            with self.subTest(field=field):
                value = recorded_policy()
                value["retention"][field] = bad
                with self.assertRaisesRegex(PolicyError, "RETENTION_CONTRACT_MISMATCH"):
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

    def test_invalid_utf8_is_bounded_json_error(self) -> None:
        self.assert_malformed_policy_bytes_fail_closed(
            bytes([0xFF, 0xFE]) + b'{"schemaVersion":"x"}',
        )

    def test_recursive_nesting_is_bounded_policy_error(self) -> None:
        # JSON decoder recursion thresholds vary by Python version and call
        # depth: some reject the nesting while others parse an invalid root.
        # Both must fail closed with structured errors, never a traceback.
        self.assert_malformed_policy_bytes_fail_closed(
            b"[" * 1500 + b"null" + b"]" * 1500,
            accepted_codes={"POLICY_JSON_INVALID", "POLICY_SHAPE_INVALID"},
        )
        # This smaller document must decode on all supported Python versions.
        # It exercises the valid-JSON / invalid-policy-shape branch explicitly.
        self.assert_malformed_policy_bytes_fail_closed(
            b"[" * 32 + b"null" + b"]" * 32,
            accepted_codes={"POLICY_SHAPE_INVALID"},
        )

    def assert_malformed_policy_bytes_fail_closed(
        self, payload: bytes, *,
        accepted_codes: set[str] | None = None,
    ) -> None:
        accepted_codes = accepted_codes or {"POLICY_JSON_INVALID"}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "invalid-policy.json"
            path.write_bytes(payload)
            with self.assertRaises(PolicyError) as error:
                load_policy(path)
            self.assertIn(error.exception.code, accepted_codes)
            result = subprocess.run(
                [
                    sys.executable,
                    "-B",
                    str(Path(__file__).with_name("offsite_backup_policy.py")),
                    str(path),
                ],
                capture_output=True,
                text=True,
                timeout=12,
                check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            diagnostic = json.loads(result.stderr)
            self.assertEqual(diagnostic["status"], "FAIL")
            self.assertIn(diagnostic["code"], accepted_codes)
            self.assertEqual(set(diagnostic), {"status", "code"})
            self.assertNotIn("Traceback", result.stderr)

    def test_oversized_regular_policy_never_reads_file_unbounded(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "oversized-policy.json"
            # A sparse regular file has the rejected logical size without
            # allocating the whole payload or putting real data in the fixture.
            with path.open("wb") as output:
                output.truncate(16 * 1024 * 1024)
            with patch.object(
                Path, "read_bytes", side_effect=AssertionError("FULL_FILE_READ_USED")
            ) as original_read:
                with self.assertRaisesRegex(
                    PolicyError, "POLICY_FILE_SIZE_INVALID"
                ):
                    load_policy(path)
            original_read.assert_not_called()

    def test_policy_file_size_exact_64k_boundary_and_cli(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "limit-policy.json"
            valid = json.dumps(pending_policy(), sort_keys=True).encode("utf-8")
            self.assertLess(len(valid), 65536)
            exact_limit = valid + b" " * (65536 - len(valid))
            path.write_bytes(exact_limit)
            self.assertEqual(load_policy(path)["status"], "OWNER_DECISION_REQUIRED")

            path.write_bytes(exact_limit + b" ")
            with self.assertRaisesRegex(PolicyError, "POLICY_FILE_SIZE_INVALID"):
                load_policy(path)
            script = Path(__file__).with_name("offsite_backup_policy.py")
            result = subprocess.run(
                [sys.executable, "-B", str(script), str(path)],
                capture_output=True,
                text=True,
                check=False,
                timeout=12,
            )
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, "")
            self.assertEqual(
                json.loads(result.stderr),
                {"status": "FAIL", "code": "POLICY_FILE_SIZE_INVALID"},
            )
            self.assertNotIn("Traceback", result.stderr)

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

    def test_symlink_swap_after_identity_snapshot_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            selected = root / "selected.json"
            alternate = root / "alternate.json"
            selected.write_text(json.dumps(pending_policy()))
            alternate.write_text(json.dumps(recorded_policy()))
            actual_lstat = Path.lstat
            swapped: list[bool] = []

            def swap_after_lstat(path, *args, **kwargs):
                checked = actual_lstat(path, *args, **kwargs)
                if path == selected and not swapped:
                    selected.unlink()
                    selected.symlink_to(alternate)
                    swapped.append(True)
                return checked

            with patch.object(Path, "lstat", autospec=True, side_effect=swap_after_lstat):
                with self.assertRaisesRegex(PolicyError, "POLICY_FILE_INVALID"):
                    load_policy(selected)
            self.assertTrue(swapped)
            self.assertTrue(selected.is_symlink())

    def test_regular_replacement_after_first_snapshot_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            selected = Path(folder) / "selected.json"
            replacement = Path(folder) / "replacement.json"
            selected.write_text(json.dumps(pending_policy()))
            replacement.write_text(json.dumps(recorded_policy()))
            actual_lstat = Path.lstat
            swapped: list[bool] = []

            def replace_after_first_snapshot(path, *args, **kwargs):
                checked = actual_lstat(path, *args, **kwargs)
                if path == selected and not swapped:
                    os.replace(replacement, selected)
                    swapped.append(True)
                return checked

            with patch.object(
                Path, "lstat", autospec=True, side_effect=replace_after_first_snapshot
            ):
                with self.assertRaisesRegex(PolicyError, "POLICY_FILE_INVALID"):
                    load_policy(selected)
            self.assertTrue(swapped)

    def test_fdopen_and_cleanup_failure_keep_cli_error_bounded(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            selected = Path(folder) / "selected.json"
            selected.write_text(json.dumps(pending_policy()))
            actual_close = os.close
            closed: list[int] = []
            errors = io.StringIO()

            def close_then_report_error(descriptor):
                actual_close(descriptor)
                closed.append(descriptor)
                raise OSError(errno.EIO, "synthetic close outcome error")

            with (
                patch.object(
                    os, "fdopen", side_effect=OSError(errno.EIO, "synthetic fdopen error")
                ),
                patch.object(os, "close", side_effect=close_then_report_error) as closer,
                patch.object(sys, "stderr", errors),
            ):
                result = main([str(selected)])
            self.assertEqual(result, 1)
            self.assertEqual(
                json.loads(errors.getvalue()),
                {"status": "FAIL", "code": "POLICY_FILE_UNREADABLE"},
            )
            closer.assert_called_once()
            self.assertEqual(len(closed), 1)
            with self.assertRaises(OSError) as missing:
                os.fstat(closed[0])
            self.assertEqual(missing.exception.errno, errno.EBADF)

    def test_regular_file_replacement_during_open_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            selected = root / "selected.json"
            replacement = root / "replacement.json"
            selected.write_text(json.dumps(pending_policy()))
            replacement.write_text(json.dumps(recorded_policy()))
            actual_open = os.open
            swapped: list[bool] = []

            def swap_before_os_open(path, flags, *args, **kwargs):
                if os.fspath(path) == os.fspath(selected) and not swapped:
                    os.replace(replacement, selected)
                    swapped.append(True)
                return actual_open(path, flags, *args, **kwargs)

            with patch.object(os, "open", side_effect=swap_before_os_open):
                with self.assertRaisesRegex(PolicyError, "POLICY_FILE_INVALID"):
                    load_policy(selected)
            self.assertTrue(swapped)

    def test_inplace_policy_mutation_between_metadata_and_open_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            selected = Path(folder) / "selected.json"
            selected.write_text(json.dumps(pending_policy()))
            before_size = selected.stat().st_size
            new_content = json.dumps(recorded_policy()) + " " * 13
            self.assertNotEqual(before_size, len(new_content))
            actual_open = os.open
            changed: list[bool] = []

            def mutate_same_inode(path, flags, *args, **kwargs):
                if os.fspath(path) == os.fspath(selected) and not changed:
                    selected.write_text(new_content)
                    changed.append(True)
                return actual_open(path, flags, *args, **kwargs)

            with patch.object(os, "open", side_effect=mutate_same_inode):
                with self.assertRaisesRegex(PolicyError, "POLICY_FILE_INVALID"):
                    load_policy(selected)
            self.assertTrue(changed)

    def test_symlink_inserted_at_descriptor_open_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            selected = root / "selected.json"
            alternate = root / "alternate.json"
            selected.write_text(json.dumps(pending_policy()))
            alternate.write_text(json.dumps(recorded_policy()))
            actual_open = os.open
            changed: list[bool] = []

            def swap_during_open(path, flags, *args, **kwargs):
                if os.fspath(path) == os.fspath(selected) and not changed:
                    selected.unlink()
                    selected.symlink_to(alternate)
                    changed.append(True)
                return actual_open(path, flags, *args, **kwargs)

            with patch.object(os, "open", side_effect=swap_during_open):
                with self.assertRaisesRegex(PolicyError, "POLICY_FILE_INVALID"):
                    load_policy(selected)
            self.assertTrue(changed)

    def test_fifo_inserted_at_descriptor_open_never_blocks(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            selected = Path(folder) / "selected.json"
            selected.write_text(json.dumps(pending_policy()))
            actual_open = os.open
            changed: list[bool] = []

            def fifo_during_open(path, flags, *args, **kwargs):
                if os.fspath(path) == os.fspath(selected) and not changed:
                    self.assertTrue(flags & os.O_NONBLOCK)
                    selected.unlink()
                    os.mkfifo(selected, 0o600)
                    changed.append(True)
                return actual_open(path, flags, *args, **kwargs)

            with patch.object(os, "open", side_effect=fifo_during_open):
                with self.assertRaisesRegex(PolicyError, "POLICY_FILE_INVALID"):
                    load_policy(selected)
            self.assertTrue(changed)

    def test_policy_descriptor_open_requires_nofollow_nonblocking(self) -> None:
        with tempfile.TemporaryDirectory() as folder:
            selected = Path(folder) / "selected.json"
            selected.write_text(json.dumps(pending_policy()))
            with patch.object(os, "open", wraps=os.open) as opener:
                self.assertEqual(load_policy(selected)["status"], "OWNER_DECISION_REQUIRED")
            opener.assert_called_once()
            flags = opener.call_args.args[1]
            self.assertTrue(flags & os.O_NOFOLLOW)
            self.assertTrue(flags & os.O_NONBLOCK)
            self.assertTrue(flags & os.O_CLOEXEC)

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
