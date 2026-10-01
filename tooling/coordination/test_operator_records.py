import copy
import hashlib
import json
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import operator_records as records


class CandidateRecordsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.artifact = self.root / "candidate.zip"
        self.artifact.write_bytes(b"immutable test package")
        self.record = dict(candidate_id="candidate-C", version="0.2.11",
            source_sha="a" * 40, artifact_path=str(self.artifact),
            artifact_sha256=hashlib.sha256(self.artifact.read_bytes()).hexdigest(),
            artifact_bytes=self.artifact.stat().st_size, browser="opera",
            environment="PREPRODUCTION", responsible_role="C", work_item_id="delivery",
            readiness="PREPARING", evidence_refs=[], checked_scenarios=[],
            limitations=["full live scenario pending"],
            delivery_scope=["ordinary-login", "installed-start"])
        records.register(self.root, "C", self.record)

    def review(self, verdict="PASS", **changes):
        evidence = self.root / "installed-result.json"
        evidence.write_text('{"verdict":"PASS","scope":"fixture"}')
        decision = dict(verdict=verdict, artifact_sha256=self.record["artifact_sha256"],
            author_role="C", reviewer_role="A", delivery_scope=self.record["delivery_scope"],
            evidence_refs=[{"path": str(evidence), "sha256": hashlib.sha256(evidence.read_bytes()).hexdigest()}])
        decision.update(changes)
        path = self.root / "review.json"
        path.write_text(json.dumps(decision))
        return path

    def ready(self):
        record = dict(self.record, readiness="READY_FOR_OPERATOR")
        return records.update(self.root, "C", record, self.review())

    def test_concurrent_registration_reuses_one_artifact(self):
        def register(i):
            value = dict(self.record, candidate_id="other-" + str(i), responsible_role="A")
            return records.register(self.root, "A", value)["candidate_id"]
        with ThreadPoolExecutor(max_workers=4) as pool:
            self.assertEqual(set(pool.map(register, range(12))), {"candidate-C"})
        self.assertEqual(len(records.inspect(self.root)), 1)

    def test_old_case_duplicate_cannot_downgrade_ready(self):
        self.ready()
        duplicate = dict(self.record, candidate_id="controller-duplicate", responsible_role="A")
        result = records.register(self.root, "A", duplicate)
        self.assertEqual(result["readiness"], "READY_FOR_OPERATOR")
        self.assertEqual(result["responsible_role"], "C")

    def test_new_registration_cannot_claim_ready(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaisesRegex(ValueError, "REQUIRES_REVIEW"):
                records.register(root, "C", dict(self.record, readiness="READY_FOR_OPERATOR"))

    def test_foreign_author_cannot_reset_or_accept(self):
        with self.assertRaisesRegex(ValueError, "ONLY_DELIVERY_OWNER"):
            records.update(self.root, "A", self.record)

    def test_ready_requires_matching_independent_scope_review(self):
        record = dict(self.record, readiness="READY_FOR_OPERATOR")
        for change in [{"verdict": "FAIL"}, {"artifact_sha256": "b" * 64},
                       {"reviewer_role": "C"}, {"delivery_scope": ["popup-only"]},
                       {"evidence_refs": []}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                records.update(self.root, "C", record, self.review(**change))

    def test_local_fixture_proof_does_not_accept_store_bytes(self):
        with self.assertRaisesRegex(ValueError, "REVIEW_ARTIFACT_MISMATCH"):
            records.update(self.root, "C", dict(self.record, readiness="READY_FOR_OPERATOR"),
                           self.review(artifact_sha256="f" * 64))

    def test_downgrade_requires_exact_negative_evidence(self):
        ready = self.ready()
        proposed = dict(ready, readiness="PREPARING")
        with self.assertRaisesRegex(ValueError, "EXACT_REVIEW"):
            records.update(self.root, "C", proposed)
        result = records.update(self.root, "C", proposed, self.review("REWORK_REQUIRED"))
        self.assertEqual(result["readiness"], "PREPARING")
        self.assertEqual(len(result["transition_history"]), 2)

    def test_changed_package_is_rejected(self):
        self.artifact.write_bytes(b"different")
        with self.assertRaisesRegex(ValueError, "ARTIFACT_"):
            records.update(self.root, "C", self.record)

    def test_same_hash_cannot_change_version_or_source(self):
        with self.assertRaisesRegex(ValueError, "IDENTITY_CONFLICT"):
            records.register(self.root, "C", dict(self.record, candidate_id="different", version="0.2.12"))

    def test_existing_evidence_cannot_disappear(self):
        value = dict(self.record, checked_scenarios=["popup"], evidence_refs=["existing.json"])
        records.update(self.root, "C", value)
        with self.assertRaisesRegex(ValueError, "EVIDENCE_MUST_BE_PRESERVED"):
            records.update(self.root, "C", self.record)

    def test_changed_review_evidence_is_rejected(self):
        path = self.review()
        (self.root / "installed-result.json").write_text("changed")
        with self.assertRaisesRegex(ValueError, "EVIDENCE_HASH"):
            records.update(self.root, "C", dict(self.record, readiness="READY_FOR_OPERATOR"), path)

    def test_review_history_survives_source_mutation_and_removal(self):
        path = self.review()
        original = path.read_bytes()
        evidence = self.root / "installed-result.json"
        evidence_hash = hashlib.sha256(evidence.read_bytes()).hexdigest()
        result = records.update(self.root, "C",
            dict(self.record, readiness="READY_FOR_OPERATOR"), path)
        path.write_text('{"verdict":"FAIL"}')
        evidence.unlink()
        stored = records.inspect(self.root)[0]["transition_history"][-1]["review_snapshot"]
        self.assertEqual(stored["review_sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(stored["verdict"], "PASS")
        self.assertEqual(stored["delivery_scope"], self.record["delivery_scope"])
        self.assertEqual(stored["evidence_refs"][0]["sha256"], evidence_hash)
        path.unlink()
        self.assertEqual(records.inspect(self.root)[0]["transition_history"],
                         result["transition_history"])

    def test_legacy_conflicting_active_records_fail_closed(self):
        other = dict(self.record, candidate_id="legacy-duplicate")
        directory = self.root / "operator/candidates"
        (directory / "legacy-duplicate.json").write_text(json.dumps(other))
        with self.assertRaisesRegex(ValueError, "DUPLICATE_ACTIVE_ARTIFACT"):
            records.inspect(self.root)

    def test_withdrawal_cannot_be_just_another_card(self):
        with self.assertRaisesRegex(ValueError, "EXACT_REVIEW"):
            records.update(self.root, "C", dict(self.record, readiness="WITHDRAWN"))
        records.update(self.root, "C", dict(self.record, readiness="WITHDRAWN"), self.review("FAIL"))
        with self.assertRaisesRegex(ValueError, "WITHDRAWN"):
            records.register(self.root, "C", dict(self.record, candidate_id="revive"))


if __name__ == "__main__":
    unittest.main()
