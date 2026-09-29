import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("audit_check", Path(__file__).with_name("audit_check.py"))
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditCompletionTests(unittest.TestCase):
    def setUp(self):
        self.registry = {"revision": 5, "records": [
            {"id": "ORG-001", "title": "Example", "status": "FIX_PARTIAL",
             "recurrences_after_prior_fix": 2},
        ]}
        self.comparison = {"registry_revision": 5, "at": "now", "since": "before", "records": [
            {"id": "ORG-001", "verdict": "CONTINUES", "historical_after_fix": 2,
             "previous_measure": "Written only", "why": "Not yet applied",
             "action": "Implemented", "remaining": "Independent integration",
             "evidence": "test receipt", "applied_now": False},
        ]}

    def test_complete_report_includes_repeat_and_unapplied_result(self):
        text = audit.render(self.registry, self.comparison)
        self.assertIn("повторов после прежней меры: 2", text)
        self.assertIn("Применение заявленного действия подтверждено: нет", text)

    def test_missing_record_cannot_complete(self):
        self.comparison["records"] = []
        with self.assertRaisesRegex(ValueError, "INCOMPLETE_COMPARISON"):
            audit.render(self.registry, self.comparison)

    def test_duplicate_record_cannot_complete(self):
        self.comparison["records"] *= 2
        with self.assertRaisesRegex(ValueError, "INCOMPLETE_COMPARISON"):
            audit.render(self.registry, self.comparison)

    def test_previous_repeats_cannot_disappear(self):
        self.comparison["records"][0]["historical_after_fix"] = 0
        with self.assertRaisesRegex(ValueError, "RECURRENCE_COUNT_MISMATCH"):
            audit.render(self.registry, self.comparison)

    def test_stale_registry_cannot_complete(self):
        self.registry["revision"] += 1
        with self.assertRaisesRegex(ValueError, "STALE_REGISTRY"):
            audit.render(self.registry, self.comparison)

    def test_unapplied_fix_cannot_be_declared_complete(self):
        self.comparison["records"][0]["all_fixed"] = True
        with self.assertRaisesRegex(ValueError, "UNPROVEN_CLOSURE"):
            audit.render(self.registry, self.comparison)

    def test_empty_explanation_rejected(self):
        for key in ("previous_measure", "why", "action", "remaining", "evidence"):
            candidate = copy.deepcopy(self.comparison)
            candidate["records"][0][key] = ""
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, "MISSING_EXPLANATION"):
                audit.render(self.registry, candidate)


if __name__ == "__main__":
    unittest.main()
