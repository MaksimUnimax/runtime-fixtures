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



    def test_current_owner_can_transfer_only_ownership_as_separate_update(self):
        transfer = dict(self.record, responsible_role="A")
        moved = records.update(self.root, "C", transfer)
        self.assertEqual(moved["responsible_role"], "A")
        history = moved["transition_history"][-1]
        self.assertEqual(history["owner_transfer"], {"previous": "C", "next": "A"})
        self.assertEqual(history["previous"], "PREPARING")
        self.assertEqual(history["next"], "PREPARING")
        with self.assertRaisesRegex(ValueError, "ONLY_DELIVERY_OWNER"):
            records.update(self.root, "C", moved)
        again = records.update(self.root, "A", moved)
        self.assertEqual(again["responsible_role"], "A")

    def test_ownership_transfer_cannot_change_scope_or_readiness(self):
        with self.assertRaisesRegex(ValueError, "OWNERSHIP_TRANSFER_MUTATION_FORBIDDEN"):
            records.update(
                self.root,
                "C",
                dict(self.record, responsible_role="A", limitations=["changed"]),
            )
        with self.assertRaisesRegex(ValueError, "OWNERSHIP_TRANSFER_MUST_BE_SEPARATE"):
            records.update(
                self.root,
                "C",
                dict(self.record, responsible_role="A", readiness="READY_FOR_OPERATOR"),
                self.review(),
            )

    def test_ownership_transfer_target_must_be_valid_role(self):
        with self.assertRaisesRegex(ValueError, "DELIVERY_OWNER_AND_TASK_REQUIRED"):
            records.update(self.root, "C", dict(self.record, responsible_role="Z"))

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



    def test_duplicate_preparing_records_can_be_withdrawn_sequentially(self):
        directory = self.root / "operator/candidates"
        duplicate_one = dict(self.record, candidate_id="duplicate-chrome")
        duplicate_two = dict(self.record, candidate_id="duplicate-yandex")
        duplicate_one.pop("delivery_scope")
        duplicate_two.pop("delivery_scope")
        (directory / "duplicate-chrome.json").write_text(json.dumps(duplicate_one))
        (directory / "duplicate-yandex.json").write_text(json.dumps(duplicate_two))
        with self.assertRaisesRegex(ValueError, "DUPLICATE_ACTIVE_ARTIFACT"):
            records.inspect(self.root)

        scope_one = ["signed-out-chrome-tracking-only"]
        proposal_one = dict(duplicate_one, readiness="WITHDRAWN", delivery_scope=scope_one)
        review_one = self.review("REWORK_REQUIRED", delivery_scope=scope_one)
        first = records.update(self.root, "C", proposal_one, review_one)
        self.assertEqual(first["readiness"], "WITHDRAWN")
        with self.assertRaisesRegex(ValueError, "DUPLICATE_ACTIVE_ARTIFACT"):
            records.inspect(self.root)

        scope_two = ["signed-out-yandex-tracking-only"]
        proposal_two = dict(duplicate_two, readiness="WITHDRAWN", delivery_scope=scope_two)
        review_two = self.review("REWORK_REQUIRED", delivery_scope=scope_two)
        second = records.update(self.root, "C", proposal_two, review_two)
        self.assertEqual(second["readiness"], "WITHDRAWN")
        active = records.inspect(self.root)
        self.assertEqual([item["candidate_id"] for item in active], ["candidate-C"])

    def test_duplicate_recovery_withdrawal_still_requires_owner_and_exact_review(self):
        directory = self.root / "operator/candidates"
        duplicate = dict(self.record, candidate_id="duplicate")
        duplicate.pop("delivery_scope")
        (directory / "duplicate.json").write_text(json.dumps(duplicate))
        proposal = dict(
            duplicate,
            readiness="WITHDRAWN",
            delivery_scope=["signed-out-tracking-only"],
        )
        with self.assertRaisesRegex(ValueError, "ONLY_DELIVERY_OWNER"):
            records.update(self.root, "A", proposal, self.review("REWORK_REQUIRED"))
        with self.assertRaisesRegex(ValueError, "REVIEW_DELIVERY_SCOPE_MISMATCH"):
            records.update(self.root, "C", proposal, self.review("REWORK_REQUIRED"))
        exact_review = self.review(
            "REWORK_REQUIRED",
            delivery_scope=proposal["delivery_scope"],
        )
        changed = dict(proposal, limitations=proposal["limitations"] + ["changed"])
        with self.assertRaisesRegex(ValueError, "WITHDRAWAL_RECOVERY_MUTATION_FORBIDDEN"):
            records.update(self.root, "C", changed, exact_review)



    def test_preparing_withdrawal_without_same_artifact_duplicate_does_not_bypass_inspect(self):
        directory = self.root / "operator/candidates"
        other_artifact = self.root / "other.zip"
        other_artifact.write_bytes(b"other immutable package")
        other_hash = hashlib.sha256(other_artifact.read_bytes()).hexdigest()
        other_base = dict(
            self.record,
            artifact_path=str(other_artifact),
            artifact_sha256=other_hash,
            artifact_bytes=other_artifact.stat().st_size,
        )
        (directory / "other-one.json").write_text(
            json.dumps(dict(other_base, candidate_id="other-one"))
        )
        (directory / "other-two.json").write_text(
            json.dumps(dict(other_base, candidate_id="other-two"))
        )
        proposal = dict(self.record, readiness="WITHDRAWN")
        with self.assertRaisesRegex(ValueError, "DUPLICATE_ACTIVE_ARTIFACT"):
            records.update(self.root, "C", proposal, self.review("REWORK_REQUIRED"))

    def test_duplicate_recovery_does_not_allow_ready_or_normal_update(self):
        directory = self.root / "operator/candidates"
        duplicate = dict(self.record, candidate_id="duplicate")
        (directory / "duplicate.json").write_text(json.dumps(duplicate))
        with self.assertRaisesRegex(ValueError, "DUPLICATE_ACTIVE_ARTIFACT"):
            records.update(self.root, "C", self.record)
        with self.assertRaisesRegex(ValueError, "DUPLICATE_ACTIVE_ARTIFACT"):
            records.update(
                self.root,
                "C",
                dict(self.record, readiness="READY_FOR_OPERATOR"),
                self.review(),
            )

    def test_withdrawal_cannot_be_just_another_card(self):
        with self.assertRaisesRegex(ValueError, "EXACT_REVIEW"):
            records.update(self.root, "C", dict(self.record, readiness="WITHDRAWN"))
        records.update(self.root, "C", dict(self.record, readiness="WITHDRAWN"), self.review("FAIL"))
        with self.assertRaisesRegex(ValueError, "WITHDRAWN"):
            records.register(self.root, "C", dict(self.record, candidate_id="revive"))


if __name__ == "__main__":
    unittest.main()
