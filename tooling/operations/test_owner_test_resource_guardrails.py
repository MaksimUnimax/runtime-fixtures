from __future__ import annotations

import copy
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import owner_test_resource_guardrails as guardrails

REPO = Path(__file__).resolve().parents[2]
TEMPLATES = REPO / "infra/production/systemd"


class OwnerTestResourceGuardrailsTest(unittest.TestCase):
    def test_exact_source_candidate(self) -> None:
        result = guardrails.candidate_plan(TEMPLATES)
        self.assertEqual(result["status"], "SOURCE_CANDIDATE_VALID")
        self.assertEqual(result["scope"], "OWNER_TEST_SAFETY_GUARDRAIL_ONLY")
        self.assertFalse(result["liveMutationPerformed"])
        self.assertFalse(result["systemdMutationPerformed"])
        self.assertFalse(result["cgroupMutationPerformed"])
        self.assertFalse(result["productionCapacityClaim"])
        self.assertFalse(result["representativeConcurrencyClaim"])
        self.assertFalse(result["finalResourceCeilingClaim"])
        self.assertEqual(result["unresolvedDirectives"], ["MemoryHigh", "CPUQuota"])
        self.assertEqual(result["services"]["api"]["memoryMax"], "1G")
        self.assertEqual(result["services"]["worker"]["memoryMax"], "900M")
        self.assertEqual(result["services"]["portal"]["memoryMax"], "700M")
        self.assertEqual(
            {role: item["tasksMax"] for role, item in result["services"].items()},
            {"api": 128, "worker": 128, "portal": 128},
        )
        burst = result["evidence"]["synchronizedBurstDiagnostic"]
        self.assertFalse(burst["representativeConcurrencyClaim"])
        self.assertFalse(burst["productionCapacityClaim"])
        self.assertFalse(burst["ranUnderTheseMemoryMaxValues"])

    def _copy_templates(self, directory: Path) -> None:
        for spec in guardrails.SERVICES.values():
            name = str(spec["template"])
            (directory / name).write_bytes((TEMPLATES / name).read_bytes())

    def test_missing_or_extra_service_template_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._copy_templates(root)
            (root / "seller-agents-owner-test-api-resource.conf.in").unlink()
            with self.assertRaisesRegex(
                guardrails.ResourceGuardrailError, "SERVICE_TEMPLATE_SET_INVALID"
            ):
                guardrails.validate_template_set(root)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._copy_templates(root)
            (root / "seller-agents-owner-test-extra-resource.conf.in").write_text(
                "[Service]\nMemoryMax=1G\nTasksMax=128\n"
            )
            with self.assertRaisesRegex(
                guardrails.ResourceGuardrailError, "SERVICE_TEMPLATE_SET_INVALID"
            ):
                guardrails.validate_template_set(root)

    def test_extra_symlink_service_template_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._copy_templates(root)
            (root / "seller-agents-owner-test-extra-resource.conf.in").symlink_to(
                root / "seller-agents-owner-test-api-resource.conf.in"
            )
            with self.assertRaisesRegex(
                guardrails.ResourceGuardrailError, "SERVICE_TEMPLATE_SET_INVALID"
            ):
                guardrails.validate_template_set(root)

    def test_changed_memory_or_tasks_value_fails_closed(self) -> None:
        base = (TEMPLATES / "seller-agents-owner-test-worker-resource.conf.in").read_text()
        for old, new in (("MemoryMax=900M", "MemoryMax=899M"), ("TasksMax=128", "TasksMax=127")):
            with self.subTest(new=new):
                with self.assertRaisesRegex(
                    guardrails.ResourceGuardrailError,
                    "TEMPLATE_RESOURCE_VALUES_INVALID",
                ):
                    guardrails.validate_template("worker", base.replace(old, new))

    def test_duplicate_directive_fails_closed(self) -> None:
        text = "[Service]\nMemoryMax=1G\nTasksMax=128\nTasksMax=128\n"
        with self.assertRaisesRegex(
            guardrails.ResourceGuardrailError, "TEMPLATE_DIRECTIVE_DUPLICATE"
        ):
            guardrails.validate_template("api", text)

    def test_unapproved_resource_directive_fails_closed(self) -> None:
        base = "[Service]\nMemoryMax=1G\nTasksMax=128\n"
        for line in (
            "MemoryHigh=900M",
            "CPUQuota=200%",
            "CPUWeight=100",
            "RuntimeMaxSec=600",
            "TasksAccounting=yes",
        ):
            with self.subTest(line=line):
                with self.assertRaisesRegex(
                    guardrails.ResourceGuardrailError,
                    "TEMPLATE_RESOURCE_DIRECTIVE_NOT_APPROVED",
                ):
                    guardrails.validate_template("api", base + line + "\n")

    def test_wrong_section_and_noncanonical_role_fail_closed(self) -> None:
        with self.assertRaisesRegex(
            guardrails.ResourceGuardrailError, "TEMPLATE_SECTION_INVALID"
        ):
            guardrails.validate_template(
                "portal", "[Unit]\nMemoryMax=700M\nTasksMax=128\n"
            )
        with self.assertRaisesRegex(
            guardrails.ResourceGuardrailError, "SERVICE_ROLE_INVALID"
        ):
            guardrails.validate_template(
                "admin", "[Service]\nMemoryMax=700M\nTasksMax=128\n"
            )

    def test_accepted_evidence_is_below_exact_guardrails(self) -> None:
        checked = guardrails.validate_evidence_binding()
        for entry in checked.values():
            for role, observed in entry["services"].items():
                spec = guardrails.SERVICES[role]
                self.assertLess(observed["rssBytesMax"], spec["memoryMaxBytes"])
                self.assertLess(observed["highWaterBytesMax"], spec["memoryMaxBytes"])
                self.assertLess(observed["taskCountMax"], spec["tasksMax"])

    def test_evidence_schema_level_and_extra_claims_fail_closed(self) -> None:
        evidence = copy.deepcopy(guardrails.ACCEPTED_EVIDENCE)
        evidence["functional"]["evidenceLevel"] = "PRODUCTION_CAPACITY_PROOF"
        with self.assertRaisesRegex(
            guardrails.ResourceGuardrailError, "EVIDENCE_LEVEL_INVALID"
        ):
            guardrails.validate_evidence_binding(evidence)

        for field in ("representativeConcurrencyClaim", "finalResourceCeilingClaim"):
            evidence = copy.deepcopy(guardrails.ACCEPTED_EVIDENCE)
            evidence["functional"][field] = True
            with self.subTest(field=field):
                with self.assertRaisesRegex(
                    guardrails.ResourceGuardrailError,
                    "EVIDENCE_ENTRY_FIELDS_INVALID",
                ):
                    guardrails.validate_evidence_binding(evidence)

        evidence = copy.deepcopy(guardrails.ACCEPTED_EVIDENCE)
        evidence["functional"]["services"]["api"]["capacityHeadroomClaim"] = True
        with self.assertRaisesRegex(
            guardrails.ResourceGuardrailError, "EVIDENCE_METRIC_FIELDS_INVALID"
        ):
            guardrails.validate_evidence_binding(evidence)

    def test_evidence_equal_or_above_guardrail_fails_closed(self) -> None:
        for metric, code, limit in (
            ("rssBytesMax", "EVIDENCE_RSS_NOT_BELOW_GUARDRAIL", 1_073_741_824),
            ("highWaterBytesMax", "EVIDENCE_HWM_NOT_BELOW_GUARDRAIL", 1_073_741_824),
            ("taskCountMax", "EVIDENCE_TASKS_NOT_BELOW_GUARDRAIL", 128),
        ):
            evidence = copy.deepcopy(guardrails.ACCEPTED_EVIDENCE)
            evidence["functional"]["services"]["api"][metric] = limit
            with self.subTest(metric=metric):
                with self.assertRaisesRegex(guardrails.ResourceGuardrailError, code):
                    guardrails.validate_evidence_binding(evidence)

    def test_evidence_boundary_integer_types_fail_closed(self) -> None:
        for value in (True, 1.0):
            evidence = copy.deepcopy(guardrails.ACCEPTED_EVIDENCE)
            evidence["sequential100"]["concurrency"] = value
            with self.subTest(field="concurrency", value=value):
                with self.assertRaisesRegex(
                    guardrails.ResourceGuardrailError,
                    "SEQUENTIAL_EVIDENCE_BOUNDARY_INVALID",
                ):
                    guardrails.validate_evidence_binding(evidence)

        evidence = copy.deepcopy(guardrails.ACCEPTED_EVIDENCE)
        evidence["synchronizedBurstDiagnostic"]["stages"] = [True, 2, 4, 8, 16, 32, 64, 100]
        with self.assertRaisesRegex(
            guardrails.ResourceGuardrailError,
            "BURST_EVIDENCE_BOUNDARY_INVALID",
        ):
            guardrails.validate_evidence_binding(evidence)

        for field, value in (
            ("cycles", 227.0),
            ("requestsPerCycle", 8.0),
            ("totalRequests", 1816.0),
            ("maxSynchronizedCycleCount", 100.0),
        ):
            evidence = copy.deepcopy(guardrails.ACCEPTED_EVIDENCE)
            evidence["synchronizedBurstDiagnostic"][field] = value
            with self.subTest(field=field):
                with self.assertRaisesRegex(
                    guardrails.ResourceGuardrailError,
                    "BURST_EVIDENCE_BOUNDARY_INVALID",
                ):
                    guardrails.validate_evidence_binding(evidence)

    def test_burst_nonclaims_are_fail_closed(self) -> None:
        for field, value in (
            ("representativeConcurrencyClaim", True),
            ("productionCapacityClaim", True),
            ("ranUnderTheseMemoryMaxValues", True),
        ):
            evidence = copy.deepcopy(guardrails.ACCEPTED_EVIDENCE)
            evidence["synchronizedBurstDiagnostic"][field] = value
            with self.subTest(field=field):
                with self.assertRaises(guardrails.ResourceGuardrailError):
                    guardrails.validate_evidence_binding(evidence)

    def test_cli_is_validation_only(self) -> None:
        result = subprocess.run(
            [
                sys.executable,
                str(Path(guardrails.__file__)),
                "--template-dir",
                str(TEMPLATES),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('"liveMutationPerformed": false', result.stdout)
        self.assertIn('"productionCapacityClaim": false', result.stdout)


if __name__ == "__main__":
    unittest.main()
