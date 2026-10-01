import argparse
import copy
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

from work_queue import (load_board, role_work, assert_no_ready_work, advance_task, compact_state,
                        board_snapshot, status_work, add_task, bind_candidate,
                        register_acceptance, validate_board, revalidate_done, reopen_task,
                        archive_done, archived_task)
from waiting_gate import validate_waiting_receipt, PLAN_IDS

spec = importlib.util.spec_from_file_location("flow_control_test", Path(__file__).with_name("control.py"))
control = importlib.util.module_from_spec(spec)
spec.loader.exec_module(control)


class WorkQueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        (self.root / "controllers").mkdir()
        (self.root / "logs").mkdir()
        for role in "ABC":
            (self.root / (role + ".json")).write_text(json.dumps({
                "role": role, "status": "RUNNING", "task": "old", "review_pending": True,
                "owner_requests": ["Existing human gate"], "checkpoint_id": "keep-fence",
            }))
        self.board = {"version": 1, "revision": 1, "tasks": [
            {"id": "b-auth", "role": "B", "plan": "B04", "state": "READY", "requires": [], "result": "Ordinary isolated auth"},
            {"id": "a-client", "role": "A", "plan": "A04", "state": "BLOCKED", "requires": ["b-auth"], "result": "Installed client"},
        ]}
        self.path = self.root / "controllers/work-board.json"
        self.save()
        self.receipt = self.root / "logs/result.json"
        self.receipt.write_text('{"result":"source-only"}')
        self.args = argparse.Namespace(receipt="", task="", summary="", next="")

    def proof(self, task_id="b-auth", *, reviewer="peer-C", level="SOURCE", dependencies=None, validity="SNAPSHOT"):
        board = json.loads(self.path.read_text())
        task = next(t for t in board["tasks"] if t["id"] == task_id)
        task.update(boundary=level, required_checks=["regression"], author="author-" + task["role"],
                    candidate={"sha": "a" * 40, "tree": "b" * 40, "diff_sha256": "c" * 64})
        if level != "SOURCE":
            task["candidate"]["artifact_sha256"] = "d" * 64
        task["proof_validity"] = {"kind": validity}
        if validity == "SNAPSHOT":
            task["proof_validity"]["input_hashes"] = {"source_manifest_sha256": "e" * 64}
            if level != "SOURCE":
                task["proof_validity"]["input_hashes"]["environment_sha256"] = "f" * 64
        self.path.write_text(json.dumps(board))
        (self.root / "controllers/runtime-mode.json").write_text(json.dumps({"mode": "continuous-runtime", "epoch": "test-epoch"}))
        evidence = self.root / "logs" / (task_id + "-check.json")
        evidence.write_text('{"test_result":"PASS","actual_scope":"fixture"}')
        now = datetime.now(timezone.utc)
        receipt = {"version": 2, "task_id": task_id, "candidate": task["candidate"],
                   "author": task["author"], "generation": task.get("proof_generation", 0),
                   "result": "PASS", "level": level, "epoch": "test-epoch",
                   "proof_validity": task["proof_validity"],
                   "issued_at": now.isoformat(), "expires_at": None if validity == "SNAPSHOT"
                   else (now + timedelta(hours=1)).isoformat(),
                   "dependencies": dependencies or {},
                   "checks": [{"id": "regression", "result": "PASS", "candidate": task["candidate"],
                               "level": level, "evidence_path": str(evidence),
                               "evidence_sha256": hashlib.sha256(evidence.read_bytes()).hexdigest()}],
                   "review": {"reviewer": reviewer, "result": "ACCEPT", "candidate": task["candidate"]}}
        path = self.root / "logs" / (task_id + "-completion.json")
        path.write_text(json.dumps(receipt))
        return path, receipt

    @staticmethod
    def trusted_verifier(task, payload, digest):
        # Test double for independently recorded runtime peer-job authority;
        # production adapter must authenticate the job, never echo caller text.
        return {"reviewer": payload["review"]["reviewer"], "result": "ACCEPT",
                "candidate": task["candidate"], "level": task["boundary"],
                "epoch": "test-epoch", "review_job_id": "independent-peer-job",
                "proof_validity": task["proof_validity"]}

    @staticmethod
    def final_verifier(task, digest):
        return {"state": "FINAL", "integration": "INTEGRATED", "pending_review": False,
                "pending_ci": False, "active_leases": [], "epoch": "test-epoch",
                "candidate": task["candidate"], "receipt_sha256": digest,
                "authority_id": "final-" + task["id"]}

    def completed_chain(self):
        self.complete()
        digest = load_board(self.root)["tasks"][0]["completion_receipt_sha256"]
        self.complete("a-client", dependencies={"b-auth": digest})

    def complete(self, task_id="b-auth", **options):
        path, receipt = self.proof(task_id, **options)
        register_acceptance(self.root, task_id, str(path), review_verifier=self.trusted_verifier)
        role = next(t["role"] for t in load_board(self.root)["tasks"] if t["id"] == task_id)
        advance_task(self.root, role, task_id, "DONE", str(path))
        return path, receipt

    def tearDown(self):
        self.tmp.cleanup()

    def save(self):
        self.path.write_text(json.dumps(self.board))

    def test_ready_work_blocks_old_all_blocked_plan_receipt(self):
        now = datetime.now(timezone.utc)
        receipt = {"version": 1, "role": "B", "head": "f" * 40, "checked_at": now.isoformat(), "work_board": board_snapshot(self.root),
                   "entries": [{"id": x, "plan": x, "state": "BLOCKED", "outcome": "Old wait",
                                "evidence": ["old.md"], "owner": "C", "blocked_action": "live",
                                "unblock_when": "auth", "independent_work_complete": True}
                               for x in sorted(PLAN_IDS["B"])]}
        file = self.root / "old-scan.json"
        file.write_text(json.dumps(receipt))
        with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
            validate_waiting_receipt("B", str(file), "f" * 40, now, self.root)

    def test_completion_releases_consumer_without_controller(self):
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "BLOCKED")
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        self.complete()
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "READY")
        with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
            assert_no_ready_work(self.root, "A")

    def test_dependency_failure_cannot_start_consumer(self):
        with self.assertRaisesRegex(RuntimeError, "DEPENDENCY_PENDING"):
            advance_task(self.root, "A", "a-client", "IN_PROGRESS")

    def test_other_role_cannot_change_task(self):
        with self.assertRaisesRegex(RuntimeError, "TASK_OWNER"):
            advance_task(self.root, "A", "b-auth", "IN_PROGRESS")

    def test_stop_preserves_board_and_checkpoint(self):
        f = self.root / "B.json"
        original = json.loads(f.read_text())
        original["status"] = "STOPPED"
        f.write_text(json.dumps(original))
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(json.loads(f.read_text()), original)

    def test_completion_needs_real_scoped_receipt(self):
        for receipt in ["", "/etc/passwd", str(self.root / "profiles/private.json")]:
            with self.subTest(receipt=receipt), self.assertRaises(RuntimeError):
                advance_task(self.root, "B", "b-auth", "DONE", receipt)

    def test_dependency_cycle_missing_and_duplicate_rejected(self):
        for mutate in [
            lambda d: d["tasks"][0].update(requires=["a-client"]),
            lambda d: d["tasks"][0].update(requires=["missing"]),
            lambda d: d["tasks"].append(copy.deepcopy(d["tasks"][0])),
        ]:
            board = copy.deepcopy(self.board)
            mutate(board)
            self.path.write_text(json.dumps(board))
            with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID"):
                load_board(self.root)

    def test_malformed_board_does_not_silently_allow_wait(self):
        for raw in ["[]", "{", "x" * 262145]:
            self.path.write_text(raw)
            with self.assertRaisesRegex(RuntimeError, "WORK_QUEUE_INVALID"):
                assert_no_ready_work(self.root, "B")

    def test_no_board_preserves_existing_plan_gate(self):
        self.path.unlink()
        self.assertEqual(role_work(self.root, "A")["tasks"], [])
        assert_no_ready_work(self.root, "A")

    def test_dirty_work_cannot_be_hidden_by_waiting(self):
        with patch.object(control, "CONTROL", self.root), patch.object(control, "validate_waiting_receipt", return_value={}), patch.object(control, "git", return_value=" M unfinished.py"):
            before = (self.root / "A.json").read_bytes()
            with self.assertRaisesRegex(RuntimeError, "WAITING_DIRTY_WORKTREE"):
                control.update_state("A", "waiting", self.args)
            self.assertEqual((self.root / "A.json").read_bytes(), before)

    def test_bad_board_never_prevents_stop(self):
        self.path.write_text("{")
        with patch.object(control, "CONTROL", self.root), patch.object(control, "git", return_value=""), patch.object(control.resource_runner, "snapshot", return_value={}):
            result = control.update_state("A", "pause", self.args)
            self.assertEqual(result["status"], "STOPPED")
            self.assertIn("WORK_QUEUE_INVALID", result["work_queue"]["error"])

    def test_compact_status_does_not_repeat_notice_bodies(self):
        state = {"role": "A", "status": "RUNNING", "controller_notices": [
            {"id": str(i), "created_at": f"2026-10-{i+1:02d}", "body": "x" * 3000}
            for i in range(20)]}
        result = compact_state(state)
        self.assertEqual(result["notice_count"], 20)
        self.assertEqual(len(result["latest_notices"]), 5)
        self.assertLess(len(json.dumps(result)), 1400)
        self.assertEqual(result["latest_notices"][0]["id"], "19")

    def test_queue_transition_does_not_clear_review_or_owner_gate(self):
        before = (self.root / "B.json").read_bytes()
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        self.assertEqual((self.root / "B.json").read_bytes(), before)

    def test_removed_board_invalidates_recorded_wait(self):
        proof = board_snapshot(self.root)
        self.path.unlink()
        result = status_work(self.root, "A", waiting_proof=proof)
        self.assertEqual(result["waiting_invalidated"], "WORK_BOARD_CHANGED_OR_REMOVED")
        self.assertTrue(result["action_required"])

    def test_fake_blocker_receipt_cannot_hide_ready_work(self):
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "RECEIPT_REQUIRED"):
            advance_task(self.root, "B", "b-auth", "BLOCKED", str(self.root / "logs/missing.json"), "external")
        self.assertEqual(self.path.read_bytes(), before)

    def test_board_delete_after_scan_rejects_wait_receipt(self):
        now = datetime.now(timezone.utc)
        scan = {"version": 1, "role": "C", "head": "a" * 40, "checked_at": now.isoformat(),
                "work_board": board_snapshot(self.root), "entries": [
                {"id": p, "plan": p, "state": "DONE", "outcome": "finished", "evidence": ["receipt"]}
                for p in sorted(PLAN_IDS["C"])]}
        file = self.root / "scan.json"
        file.write_text(json.dumps(scan))
        self.path.unlink()
        with self.assertRaisesRegex(RuntimeError, "WORK_BOARD_CHANGED_OR_MISSING_PROOF"):
            validate_waiting_receipt("C", str(file), "a" * 40, now, self.root)

    def test_role_defines_next_requirement_without_controller(self):
        task = {"id": "a-next", "role": "A", "plan": "A04", "state": "READY", "requires": [], "result": "Verify remaining acceptance criterion", "paths": ["tests/regression/extension-core/example.mjs"], "acceptance": ["Actual regression fails before fix"], "basis": "SPEC remaining recovery criterion"}
        add_task(self.root, "A", task)
        self.assertEqual(role_work(self.root, "A")["tasks"][-1]["state"], "READY")
        self.assertTrue(load_board(self.root)["tasks"][-1]["approved_plan_basis"].startswith("| A04 |"))
        with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
            assert_no_ready_work(self.root, "A")
        before = self.path.read_bytes()
        for changed in [dict(task, role="B"), dict(task, id="other", plan="B04"), dict(task, id="other", basis=""), dict(task, id="other", paths=["apps/api/src/main.ts"]), dict(task, id="other", paths=["tests/**"]), dict(task, id="other", requires=["missing"]), task]:
            with self.assertRaises(RuntimeError):
                add_task(self.root, "A", changed)
            self.assertEqual(self.path.read_bytes(), before)

    def test_stopped_role_cannot_self_assign(self):
        path = self.root / "A.json"
        path.write_text(json.dumps({"status": "STOPPED"}))
        task = {"id": "a-next", "role": "A", "plan": "A04", "state": "READY", "requires": [], "result": "Check", "paths": ["tests/regression/extension-core/test.mjs"], "acceptance": ["pass"], "basis": "SPEC"}
        before = self.path.read_bytes()
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            add_task(self.root, "A", task)
        self.assertEqual(self.path.read_bytes(), before)

    def test_heartbeat_does_not_claim_new_checkpoint(self):
        with patch.object(control, "CONTROL", self.root), patch.object(control, "git", return_value=""), patch.object(control.resource_runner, "snapshot", return_value={}):
            first = control.update_state("A", "status", self.args)
            self.assertNotIn("last_checkpoint_at", first)
            self.assertIn("heartbeat_at", first)
            self.args.task = "actual task"
            checkpoint = control.update_state("A", "checkpoint", self.args)
            later = control.update_state("A", "status", self.args)
            self.assertEqual(later["last_checkpoint_at"], checkpoint["last_checkpoint_at"])

    def test_unblock_requires_new_scoped_evidence(self):
        advance_task(self.root, "B", "b-auth", "BLOCKED", str(self.receipt), "SMTP unavailable")
        with self.assertRaises(RuntimeError):
            advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS", str(self.receipt))
        self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "IN_PROGRESS")

    def test_blocker_needs_concrete_evidence(self):
        with self.assertRaisesRegex(RuntimeError, "BLOCKER_AND_EVIDENCE"):
            advance_task(self.root, "B", "b-auth", "BLOCKED")
        advance_task(self.root, "B", "b-auth", "BLOCKED", str(self.receipt), "Local SMTP test service absent")
        assert_no_ready_work(self.root, "B")

    def test_arbitrary_existing_receipt_does_not_complete_or_unlock(self):
        for payload in ({"result": "REWORK"}, {"result": "PASS", "sha": "wrong"},
                        {"tests": [{"exit_code": 1}]}, {"result": "source-only"}):
            with self.subTest(payload=payload):
                self.receipt.write_text(json.dumps(payload))
                before = self.path.read_bytes()
                with self.assertRaises(RuntimeError):
                    advance_task(self.root, "B", "b-auth", "DONE", str(self.receipt))
                self.assertEqual(before, self.path.read_bytes())
                self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "BLOCKED")

    def test_structured_receipt_alone_cannot_establish_authority(self):
        path, _ = self.proof()
        for verifier in (None, "controller", {"reviewer": "L2", "result": "ACCEPT"}):
            with self.subTest(verifier=verifier), self.assertRaisesRegex(RuntimeError, "TRUSTED_REVIEW_VERIFIER_REQUIRED"):
                register_acceptance(self.root, "b-auth", str(path), review_verifier=verifier)
        with self.assertRaises(RuntimeError):
            advance_task(self.root, "B", "b-auth", "DONE", str(path))
        self.assertFalse((self.root / "controllers/work-acceptances.json").exists())

    def test_rejected_or_wrong_peer_binding_cannot_establish_authority(self):
        path, _ = self.proof()
        for changes in ({"result": "REWORK"}, {"reviewer": "unknown"},
                        {"candidate": {"sha": "f" * 40}}, {"epoch": "old-epoch"},
                        {"level": "LIVE"}, {"review_job_id": ""}):
            def verifier(task, payload, digest):
                return dict(self.trusted_verifier(task, payload, digest), **changes)
            with self.subTest(changes=changes), self.assertRaises(RuntimeError):
                register_acceptance(self.root, "b-auth", str(path), review_verifier=verifier)

    def test_negative_receipt_contracts_are_rejected_before_trust(self):
        path, valid = self.proof()
        mutations = [
            lambda x: x.update(result="REWORK"),
            lambda x: x.update(task_id="a-client"),
            lambda x: x.update(version=1),
            lambda x: x.update(candidate=dict(x["candidate"], sha="f" * 40)),
            lambda x: x.update(generation=99),
            lambda x: x.update(level="LIVE_OWNER"),
            lambda x: x.update(epoch="old"),
            lambda x: x.update(checks=[]),
            lambda x: x["checks"][0].update(result="FAIL"),
            lambda x: x["checks"][0].update(candidate={"sha": "f" * 40}),
            lambda x: x["checks"][0].update(level="LIVE_OWNER"),
            lambda x: x["checks"][0].update(evidence_sha256="f" * 64),
            lambda x: x["review"].update(result="REWORK"),
            lambda x: x["review"].update(reviewer=x["author"]),
            lambda x: x["review"].update(candidate={"sha": "f" * 40}),
            lambda x: x.update(expires_at="2000-01-01T00:00:00+00:00"),
            lambda x: x.update(issued_at="2999-01-01T00:00:00+00:00"),
            lambda x: x.update(expires_at="2999-01-01T00:00:00"),
        ]
        for index, mutate in enumerate(mutations):
            value = copy.deepcopy(valid)
            mutate(value)
            path.write_text(json.dumps(value))
            with self.subTest(case=index), self.assertRaises(RuntimeError):
                register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)

    def test_source_cannot_close_explicit_installed_boundary(self):
        path, value = self.proof(level="INSTALLED_SYNTHETIC")
        value["level"] = "SOURCE"
        value["checks"][0]["level"] = "SOURCE"
        path.write_text(json.dumps(value))
        with self.assertRaises(RuntimeError):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)

    def test_missing_or_changed_completion_and_check_bytes_invalidate_done(self):
        for kind in ("completion-missing", "completion-changed", "check-missing", "check-changed"):
            with self.subTest(kind=kind):
                self.save()
                path, receipt = self.complete()
                affected = path if kind.startswith("completion") else Path(receipt["checks"][0]["evidence_path"])
                affected.unlink() if kind.endswith("missing") else affected.write_text('{"result":"REWORK"}')
                self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "UNVERIFIED")
                self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "BLOCKED")
                with self.assertRaisesRegex(RuntimeError, "DEPENDENCY_PENDING"):
                    advance_task(self.root, "A", "a-client", "IN_PROGRESS")
                with self.assertRaisesRegex(RuntimeError, "WAITING_WORK_QUEUE_AVAILABLE"):
                    assert_no_ready_work(self.root, "B")

    def test_changed_task_candidate_contract_or_epoch_invalidates_done(self):
        for field in ("candidate", "acceptance", "boundary", "epoch", "review-revoked"):
            with self.subTest(field=field):
                self.save()
                self.complete()
                board = load_board(self.root)
                if field == "candidate":
                    board["tasks"][0]["candidate"]["sha"] = "f" * 40
                elif field == "acceptance":
                    board["tasks"][0]["acceptance"] = ["new requirement"]
                elif field == "boundary":
                    board["tasks"][0]["boundary"] = "LIVE"
                elif field == "epoch":
                    (self.root / "controllers/runtime-mode.json").write_text('{"mode":"continuous-runtime","epoch":"new"}')
                else:
                    index_path = self.root / "controllers/work-acceptances.json"
                    index = json.loads(index_path.read_text())
                    digest = board["tasks"][0]["completion_receipt_sha256"]
                    index["acceptances"][digest]["revoked"] = True
                    index_path.write_text(json.dumps(index))
                self.path.write_text(json.dumps(board))
                self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "BLOCKED")
                self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "UNVERIFIED")

    def test_reopened_done_reblocks_transitive_done_and_old_receipt_cannot_replay(self):
        producer_path, _ = self.complete()
        digest = load_board(self.root)["tasks"][0]["completion_receipt_sha256"]
        self.complete("a-client", dependencies={"b-auth": digest})
        self.assertEqual(role_work(self.root, "A")["tasks"], [])
        reopen_task(self.root, "B", "b-auth", "new observed regression")
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "BLOCKED")
        effective = validate_board(self.root)
        self.assertEqual(effective["board"]["tasks"][1]["state"], "UNVERIFIED")
        with self.assertRaises(RuntimeError):
            advance_task(self.root, "B", "b-auth", "DONE", str(producer_path))
        self.complete()
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "UNVERIFIED")

    def test_legacy_done_is_unverified_before_explicit_migration(self):
        self.board["tasks"][0].update(state="DONE", completion_receipt=str(self.receipt))
        self.save()
        before = self.path.read_bytes()
        self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "UNVERIFIED")
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "BLOCKED")
        self.assertEqual(before, self.path.read_bytes())
        result = revalidate_done(self.root, "B")
        self.assertEqual(result["invalidated"], ["b-auth"])
        self.assertEqual(load_board(self.root)["tasks"][0]["state"], "UNVERIFIED")
        advance_task(self.root, "B", "b-auth", "IN_PROGRESS")
        self.assertEqual(load_board(self.root)["tasks"][0]["proof_generation"], 1)

    def test_revalidation_preserves_valid_done(self):
        self.complete()
        result = revalidate_done(self.root, "B")
        self.assertEqual(result["invalidated"], [])
        self.assertEqual(load_board(self.root)["tasks"][0]["state"], "DONE")

    def test_stop_protects_reopen_bind_register_and_migration(self):
        path, receipt = self.complete()
        (self.root / "B.json").write_text('{"status":"STOPPED"}')
        before = self.path.read_bytes()
        for action in (lambda: reopen_task(self.root, "B", "b-auth", "regression"),
                       lambda: bind_candidate(self.root, "B", "b-auth", receipt["candidate"], "author-B"),
                       lambda: register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier),
                       lambda: revalidate_done(self.root, "B")):
            with self.assertRaisesRegex(RuntimeError, "STOPPED"):
                action()
            self.assertEqual(before, self.path.read_bytes())

    def test_bind_candidate_requires_owner_and_fences_previous_candidate(self):
        path, receipt = self.proof()
        register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)
        with self.assertRaisesRegex(RuntimeError, "TASK_OWNER"):
            bind_candidate(self.root, "A", "b-auth", receipt["candidate"], "author-B")
        bind_candidate(self.root, "B", "b-auth", dict(receipt["candidate"], sha="f" * 40), "author-B")
        with self.assertRaises(RuntimeError):
            advance_task(self.root, "B", "b-auth", "DONE", str(path))

    def test_receipt_changed_during_trusted_review_cannot_gain_acceptance(self):
        path, _ = self.proof()
        def verifier(task, payload, digest):
            path.write_text('{"result":"FAIL"}')
            return self.trusted_verifier(task, payload, digest)
        with self.assertRaisesRegex(RuntimeError, "RECEIPT_CHANGED"):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=verifier)

    def test_missing_receipt_index_and_expiry_revalidate_as_unverified(self):
        path, receipt = self.complete(level="LIVE_OWNER", validity="CURRENT_STATE")
        future = datetime.now(timezone.utc) + timedelta(hours=2)
        self.assertEqual(validate_board(self.root, now=future)["board"]["tasks"][0]["state"], "UNVERIFIED")
        (self.root / "controllers/work-acceptances.json").unlink()
        self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "UNVERIFIED")
        self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "BLOCKED")

    def test_immutable_source_and_package_remain_done_without_age_rechecks(self):
        for level in ("SOURCE", "PACKAGE", "INSTALLED_LOCAL", "INSTALLED_SYNTHETIC"):
            with self.subTest(level=level):
                self.save()
                _, receipt = self.complete(level=level)
                self.assertIsNone(receipt["expires_at"])
                before = self.path.read_bytes()
                future = datetime.now(timezone.utc) + timedelta(days=3650)
                validation = validate_board(self.root, now=future)
                self.assertEqual(validation["board"]["tasks"][0]["state"], "DONE")
                self.assertEqual(validation["invalidated"], [])
                self.assertEqual(before, self.path.read_bytes())
                self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "READY")

    def test_expired_volatile_evidence_blocks_dependent_work(self):
        self.complete(level="DEPLOYMENT", validity="CURRENT_STATE")
        future = datetime.now(timezone.utc) + timedelta(hours=2)
        class FutureClock(datetime):
            @classmethod
            def now(cls, tz=None):
                return future
        with patch("work_queue.datetime", FutureClock):
            self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "UNVERIFIED")
            self.assertEqual(role_work(self.root, "A")["tasks"][0]["state"], "BLOCKED")
            with self.assertRaisesRegex(RuntimeError, "DEPENDENCY_PENDING"):
                advance_task(self.root, "A", "a-client", "IN_PROGRESS")

    def test_current_state_policy_requires_expiry_even_for_source(self):
        for level in ("SOURCE", "INSTALLED_LOCAL", "INSTALLED_SYNTHETIC", "LIVE", "LIVE_OWNER", "DEPLOYMENT", "PRODUCTION"):
            with self.subTest(level=level):
                path, receipt = self.proof(level=level, validity="CURRENT_STATE")
                receipt["expires_at"] = None
                path.write_text(json.dumps(receipt))
                with self.assertRaisesRegex(RuntimeError, "current-state evidence requires explicit expiry"):
                    register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)
        path, receipt = self.proof(level="SOURCE")
        del receipt["expires_at"]
        path.write_text(json.dumps(receipt))
        with self.assertRaises(RuntimeError):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)

    def test_nonexpiring_source_still_fences_epoch_changes_and_stale_writers(self):
        path, _ = self.complete()
        marker = self.root / "controllers/runtime-mode.json"
        marker.write_text('{"mode":"continuous-runtime","epoch":"new-rollout"}')
        self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "UNVERIFIED")
        revalidate_done(self.root, "B")
        with self.assertRaises(RuntimeError):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)

    def test_duplicate_keys_and_outside_check_evidence_fail_closed(self):
        path, receipt = self.proof()
        path.write_text(json.dumps(receipt)[:-1] + ',"result":"PASS"}')
        with self.assertRaises(RuntimeError):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)
        receipt["checks"][0]["evidence_path"] = "/etc/passwd"
        path.write_text(json.dumps(receipt))
        with self.assertRaises(RuntimeError):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)

    def test_external_symlink_and_oversized_receipt_rejected(self):
        path, _ = self.proof()
        path.unlink()
        path.symlink_to("/etc/passwd")
        with self.assertRaises(RuntimeError):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)

        path.unlink()
        path.write_text("x" * 262145)
        with self.assertRaises(RuntimeError):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)

    def test_validity_policy_and_exact_input_hashes_are_bound_to_trusted_review(self):
        path, receipt = self.proof(level="INSTALLED_LOCAL")
        before = load_board(self.root)
        mutations = [
            lambda task: task.pop("proof_validity"),
            lambda task: task["proof_validity"].update(kind="UNKNOWN"),
            lambda task: task["proof_validity"].update(input_hashes={}),
            lambda task: task["proof_validity"]["input_hashes"].pop("environment_sha256"),
            lambda task: task["proof_validity"]["input_hashes"].update(environment_sha256="bad"),
        ]
        for index, mutate in enumerate(mutations):
            board = copy.deepcopy(before)
            mutate(board["tasks"][0])
            self.path.write_text(json.dumps(board))
            with self.subTest(case=index), self.assertRaises(RuntimeError):
                register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)
        self.path.write_text(json.dumps(before))
        def wrong_policy(task, payload, digest):
            return dict(self.trusted_verifier(task, payload, digest), proof_validity={"kind": "CURRENT_STATE"})
        with self.assertRaisesRegex(RuntimeError, "TRUSTED_REVIEW_REJECTED"):
            register_acceptance(self.root, "b-auth", str(path), review_verifier=wrong_policy)
        register_acceptance(self.root, "b-auth", str(path), review_verifier=self.trusted_verifier)
        advance_task(self.root, "B", "b-auth", "DONE", str(path))
        board = load_board(self.root)
        board["tasks"][0]["proof_validity"]["input_hashes"]["environment_sha256"] = "a" * 64
        self.path.write_text(json.dumps(board))
        self.assertEqual(role_work(self.root, "B")["tasks"][0]["state"], "UNVERIFIED")

    def test_archive_preserves_proof_history_and_prunes_only_removed_leaf(self):
        self.completed_chain()
        board = load_board(self.root)
        producer, consumer = board["tasks"]
        receipt_path = Path(consumer["completion_receipt"])
        receipt_bytes = receipt_path.read_bytes()
        result = archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        reference = result["archived"][0]
        snapshot = json.loads(Path(reference["archive_path"]).read_text())
        self.assertEqual(snapshot["task"], consumer)
        self.assertEqual(snapshot["proof"]["sha256"], consumer["completion_receipt_sha256"])
        self.assertEqual(snapshot["proof"]["payload"]["dependencies"], {"b-auth": producer["completion_receipt_sha256"]})
        self.assertIn(consumer["completion_receipt_sha256"], snapshot["acceptances"])
        self.assertEqual(receipt_bytes, receipt_path.read_bytes())
        index = json.loads((self.root / "controllers/work-acceptances.json").read_text())
        self.assertNotIn(consumer["completion_receipt_sha256"], index["acceptances"])
        self.assertIn(producer["completion_receipt_sha256"], index["acceptances"])
        self.assertEqual([t["id"] for t in load_board(self.root)["tasks"]], ["b-auth"])
        self.assertEqual(archived_task(self.root, "a-client"), reference)
        self.assertIn('"ARCHIVE_DONE"', (self.root / "controllers/work-board-events.jsonl").read_text())
        archive_done(self.root, "B", ["b-auth"], archive_verifier=self.final_verifier)
        self.assertEqual(load_board(self.root)["tasks"], [])

    def test_archive_rejects_current_dependencies_invalid_done_and_unfinished_states(self):
        self.completed_chain()
        with self.assertRaisesRegex(RuntimeError, "DEPENDENCY_REFERENCED"):
            archive_done(self.root, "B", ["b-auth"], archive_verifier=self.final_verifier)
        valid = load_board(self.root)
        for state in ("READY", "IN_PROGRESS", "BLOCKED", "UNVERIFIED", "UNKNOWN", "FAILED"):
            board = copy.deepcopy(valid)
            board["tasks"][1]["state"] = state
            self.path.write_text(json.dumps(board))
            with self.subTest(state=state), self.assertRaises(RuntimeError):
                archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        self.path.write_text(json.dumps(valid))
        Path(valid["tasks"][1]["completion_receipt"]).write_text('{"result":"FAIL"}')
        with self.assertRaisesRegex(RuntimeError, "NEEDS_VERIFIED_DONE"):
            archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)

    def test_archive_requires_trusted_final_no_pending_ci_review_or_active_lease(self):
        self.completed_chain()
        before = self.path.read_bytes()
        for change in ({"state": "UNKNOWN"}, {"integration": "PENDING"}, {"pending_review": True},
                       {"pending_ci": True}, {"active_leases": ["lease:1"]}, {"epoch": "stale"},
                       {"authority_id": ""}, {"receipt_sha256": "a" * 64}, {"candidate": {}}):
            def verifier(task, digest):
                return dict(self.final_verifier(task, digest), **change)
            with self.subTest(change=change), self.assertRaisesRegex(RuntimeError, "FINAL_AUTHORITY_REQUIRED"):
                archive_done(self.root, "A", ["a-client"], archive_verifier=verifier)
            self.assertEqual(before, self.path.read_bytes())
        for verifier in (None, "ACCEPT", {"state": "FINAL"}):
            with self.assertRaisesRegex(RuntimeError, "REQUEST_INVALID"):
                archive_done(self.root, "A", ["a-client"], archive_verifier=verifier)

    def test_archive_request_bounds_owner_stop_and_replay(self):
        self.completed_chain()
        for ids, limit in (([], 10), (["a-client"] * 2, 10), ([str(i) for i in range(11)], 10), (["a-client"], 11)):
            with self.assertRaisesRegex(RuntimeError, "REQUEST_INVALID"):
                archive_done(self.root, "A", ids, archive_verifier=self.final_verifier, limit=limit)
        with self.assertRaisesRegex(RuntimeError, "NEEDS_VERIFIED_DONE"):
            archive_done(self.root, "B", ["a-client"], archive_verifier=self.final_verifier)
        (self.root / "A.json").write_text('{"status":"STOPPED"}')
        with self.assertRaisesRegex(RuntimeError, "STOPPED"):
            archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        (self.root / "A.json").write_text('{"status":"RUNNING"}')
        first = archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        before = self.path.read_bytes()
        archived_bytes = Path(first["archived"][0]["archive_path"]).read_bytes()
        replay = archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        self.assertEqual(replay["already_archived"], ["a-client"])
        self.assertEqual(replay["archived"], first["archived"])
        self.assertEqual(before, self.path.read_bytes())
        self.assertEqual(archived_bytes, Path(first["archived"][0]["archive_path"]).read_bytes())

    def test_archive_recovers_crash_after_snapshot_before_board_replace(self):
        self.completed_chain()
        before = self.path.read_bytes()
        with patch("work_queue._write_board", side_effect=RuntimeError("simulated crash")):
            with self.assertRaisesRegex(RuntimeError, "simulated crash"):
                archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        self.assertEqual(before, self.path.read_bytes())
        self.assertIsNone(archived_task(self.root, "a-client"))
        snapshots = list((self.root / "controllers/work-board-archive").glob("*/*.json"))
        self.assertEqual(len(snapshots), 1)
        snapshot_bytes = snapshots[0].read_bytes()
        result = archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        self.assertEqual(snapshot_bytes, snapshots[0].read_bytes())
        self.assertEqual(result["archived"][0]["id"], "a-client")

    def test_archive_recovers_crash_after_board_replace_before_index_prune(self):
        self.completed_chain()
        digest = load_board(self.root)["tasks"][1]["completion_receipt_sha256"]
        with patch("work_queue._prune_archived_acceptances", side_effect=RuntimeError("simulated crash")):
            with self.assertRaisesRegex(RuntimeError, "simulated crash"):
                archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        self.assertIsNotNone(archived_task(self.root, "a-client"))
        self.assertIn(digest, json.loads((self.root / "controllers/work-acceptances.json").read_text())["acceptances"])
        result = archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        self.assertEqual(result["already_archived"], ["a-client"])
        self.assertNotIn(digest, json.loads((self.root / "controllers/work-acceptances.json").read_text())["acceptances"])

    def test_archive_keeps_acceptance_still_referenced_by_remaining_task(self):
        self.completed_chain()
        board = load_board(self.root)
        digest = board["tasks"][1]["completion_receipt_sha256"]
        board["tasks"][0]["historical_receipt_sha256"] = digest
        self.path.write_text(json.dumps(board))
        archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        self.assertIn(digest, json.loads((self.root / "controllers/work-acceptances.json").read_text())["acceptances"])

    def test_archived_task_id_cannot_be_reused_to_obscure_result(self):
        self.completed_chain()
        archive_done(self.root, "A", ["a-client"], archive_verifier=self.final_verifier)
        task = {"id": "a-client", "role": "A", "plan": "A04", "state": "READY", "requires": [],
                "result": "another result", "paths": ["tests/regression/extension-core/test.mjs"],
                "acceptance": ["pass"], "basis": "SPEC next requirement"}
        with self.assertRaisesRegex(RuntimeError, "ARCHIVED_ID_IMMUTABLE"):
            add_task(self.root, "A", task)


if __name__ == "__main__":
    unittest.main()
