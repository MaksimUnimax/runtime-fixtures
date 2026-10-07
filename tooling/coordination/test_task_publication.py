"""Guarded route regressions using disposable Git remotes; no network or live board."""
import copy
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import task_publication as route
from ci_gate import REQUIRED
from disk_lifecycle import Registry as DiskLifecycleRegistry


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"GIT_CONFIG_GLOBAL": str(self.root / "missing-global-config"),
            "GIT_CONFIG_NOSYSTEM": "1", "PYTHONDONTWRITEBYTECODE": "1"})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.control = self.root / "control"
        (self.control / "controllers").mkdir(parents=True)
        (self.control / "logs").mkdir()
        self.source = self.root / "source"
        self.source.mkdir()
        self.git(self.source, "init", "-b", "main")
        self.git(self.source, "config", "user.name", "Fixture")
        self.git(self.source, "config", "user.email", "fixture@example.invalid")
        self.git(self.source, "config", "extensions.worktreeConfig", "true")
        repo_root = Path(__file__).resolve().parents[2]
        fixture_sources = dict(route._bundle_source_files(repo_root))
        fixture_sources.update(route._completion_bundle_source_files(repo_root))
        for name, path in fixture_sources.items():
            target = self.source / "tooling/coordination" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        (self.source / ".gitignore").write_text("__pycache__/\n")
        policy = self.source / "docs/development/coordination/OWNERSHIP.json"
        policy.parent.mkdir(parents=True)
        policy.write_text(json.dumps({"roles": {"C": {"path": str(self.root / "fixed-C"),
            "branch": "work/c-integration", "allow": ["**"], "deny": ["secret/**"]}}}))
        (self.source / "product.txt").write_text("before\n")
        self.git(self.source, "add", ".")
        self.git(self.source, "commit", "-m", "fixture base")
        self.base = route._head(self.source)
        self.fixed = self.root / "fixed-C"
        self.git(
            self.source, "worktree", "add", "-b", "work/c-integration",
            str(self.fixed), self.base,
        )
        self.remote = self.root / "remote.git"
        self.git(self.source, "init", "--bare", str(self.remote))
        self.git(self.source, "remote", "add", "origin", str(self.remote))
        self.git(self.source, "push", "origin", "main")
        self.work = self.root / "candidate"
        self.git(self.source, "worktree", "add", "-b", "candidate", str(self.work), self.base)
        (self.work / "product.txt").write_text("after\n")
        self.git(self.work, "add", "product.txt")
        self.git(self.work, "commit", "-m", "reviewed change")
        self.head = route._head(self.work)
        self.task = {"id": "CONTROLLER-TASK-PUBLICATION-ROUTE", "role": "C", "plan": "C00",
            "state": "IN_PROGRESS", "requires": [], "result": "bounded reviewed fixture",
            "paths": ["product.txt"], "acceptance": ["exact proof"]}
        self.board = {"version": 1, "revision": 1, "tasks": [self.task]}
        self.save_board()
        (self.control / "C.json").write_text('{"status":"RUNNING"}')
        self.review = self.control / "logs/review.json"
        self.write_review()

    def git(self, cwd, *args):
        return subprocess.check_output(["git", "-C", str(cwd), *args],
            stderr=subprocess.PIPE, text=True).strip()

    def save_board(self):
        (self.control / "controllers/work-board.json").write_text(json.dumps(self.board))

    def mark_task_blocked(self):
        receipt = self.control / "logs/review-drift-blocker.json"
        receipt.write_text('{"kind":"fixture-blocker","reason":"review evidence drift"}')
        self.task.update(
            state="BLOCKED",
            blocked_reason="review evidence drift after task-ref publication",
            blocked_receipt=str(receipt),
        )
        self.save_board()

    def mark_task_in_progress(self):
        self.task["state"] = "IN_PROGRESS"
        self.task.pop("blocked_reason", None)
        self.task.pop("blocked_receipt", None)
        self.save_board()

    def write_review(self, manifest_sha=None):
        value = route.make_review_receipt(self.task["id"], self.head, route._tree(self.work),
            self.base, ["product.txt"], route._full_diff_sha(self.work, self.base, self.head),
            "independent fixture reviewer", ["bounded fixture evidence"], manifest_sha,
            route._task_fingerprint(self.task))
        self.review.write_text(json.dumps(value))

    def register(self, **kwargs):
        return route.register_candidate(self.control, "C", self.task["id"], self.work,
            self.base, str(self.review), route._sha_file(self.review), self.source,
            route._head(self.source), route._tree(self.source), **kwargs)

    def ci(self, reg):
        return {"status": "PASS", "head": self.head, "branch": reg["core"]["task_branch"],
            "checked_at": time.time(), "runs": [{"name": name, "id": i + 1,
                "status": "completed", "conclusion": "success"} for i, name in enumerate(REQUIRED)]}

    def strict_route_authority(self, candidate_sha):
        import work_queue
        task = {
            "id": "ROUTE-AUTHORITY", "role": "C", "plan": "C00", "state": "IN_PROGRESS",
            "requires": [], "result": "Accepted publication route source",
            "paths": ["tooling/coordination/task_publication.py"],
            "acceptance": ["Exact accepted route publication evidence"],
        }
        review = {"path": str(self.control / "logs/authority-review.json"), "sha256": "a" * 64}
        task_ref = "refs/heads/controller/task-publication/c/ROUTE-AUTHORITY/test"
        task_branch = task_ref.removeprefix("refs/heads/")
        completion_bundle, completion_bundle_sha = route._install_completion_bundle(
            self.control, self.source, candidate_sha, route._tree(self.source)
        )
        core = {
            "role": "C", "task_id": task["id"], "task_paths": task["paths"],
            "changed_paths": task["paths"], "candidate_head": candidate_sha,
            "candidate_tree": route._tree(self.source), "base_sha": "e" * 40,
            "task_fingerprint": work_queue._publication_task_fingerprint(task),
            "review": review, "bundle_manifest_sha256": "1" * 64,
            "task_ref": task_ref, "task_branch": task_branch,
            "completion_bundle_path": str(completion_bundle),
            "completion_bundle_manifest_sha256": completion_bundle_sha,
            "remote": "origin", "push_target": str(self.remote),
        }
        registration_id = route._sha_bytes(route._canonical_bytes(core))
        publication = self.control / "controllers/task-publication"
        ready_path = publication / "ready" / registration_id / "5.json"
        ready_path.parent.mkdir(parents=True, exist_ok=True)
        ready = {
            "kind": "octoport.task-publication-ready", "version": 1,
            "registration_id": registration_id, "registration_sha256": registration_id,
            "registration_state_version": 2, "task_id": task["id"], "role": "C",
            "task_fingerprint": core["task_fingerprint"], "candidate_head": candidate_sha,
            "candidate_tree": core["candidate_tree"], "base_sha": core["base_sha"],
            "task_ref": task_ref, "task_branch": task_branch, "review": review,
            "bundle_manifest_sha256": core["bundle_manifest_sha256"],
            "ci": {"status": "PASS", "head": candidate_sha, "branch": task_branch, "checked_at": 1,
                   "runs": [{"name": name, "id": i + 1, "status": "completed", "conclusion": "success"}
                            for i, name in enumerate(work_queue.PUBLICATION_REQUIRED_CI)]},
            "created_at": "2026-10-02T00:00:00Z",
        }
        ready_raw = (json.dumps(ready, ensure_ascii=False, indent=2) + "\n").encode()
        ready_path.write_bytes(ready_raw)
        ready_descriptor = {"path": str(ready_path.resolve()), "sha256": route._sha_bytes(ready_raw)}
        history = publication / "states" / registration_id
        history.mkdir(parents=True, exist_ok=True)
        state2 = {
            "kind": "octoport.task-publication-registration", "version": 1,
            "registration_id": registration_id, "registration_sha256": registration_id,
            "core": core, "state": "READY", "state_version": 2,
            "previous_state_sha256": "0" * 64, "ready_receipt": ready_descriptor,
            "task_ref_cleanup_status": None, "created_at": "2026-10-02T00:00:00Z",
            "updated_at": "2026-10-02T00:00:01Z",
        }
        state2_raw = (json.dumps(state2, ensure_ascii=False, indent=2) + "\n").encode()
        (history / "2.json").write_bytes(state2_raw)
        state3 = dict(state2, state="PUBLISHED", state_version=3,
                      previous_state_sha256=route._sha_bytes(state2_raw),
                      task_ref_cleanup_status="DELETED", updated_at="2026-10-02T00:00:02Z")
        state3_raw = (json.dumps(state3, ensure_ascii=False, indent=2) + "\n").encode()
        (history / "3.json").write_bytes(state3_raw)
        close_path = publication / "close" / registration_id / "receipt.json"
        close_path.parent.mkdir(parents=True, exist_ok=True)
        close = {"kind": "octoport.task-publication-close", "version": 1,
                 "registration_id": registration_id, "state_before": "PUBLISHED",
                 "created_at": "2026-10-02T00:00:03Z"}
        close_raw = (json.dumps(close, ensure_ascii=False, indent=2) + "\n").encode()
        close_path.write_bytes(close_raw)
        close_descriptor = {"path": str(close_path.resolve()), "sha256": route._sha_bytes(close_raw)}
        state4 = dict(state3, state="CLOSED", state_version=4,
                      previous_state_sha256=route._sha_bytes(state3_raw),
                      close_receipt=close_descriptor, updated_at="2026-10-02T00:00:03Z")
        state4_raw = (json.dumps(state4, ensure_ascii=False, indent=2) + "\n").encode()
        (history / "4.json").write_bytes(state4_raw)
        registrations = publication / "registrations"
        registrations.mkdir(parents=True, exist_ok=True)
        (registrations / f"{registration_id}.json").write_bytes(state4_raw)
        completion_path = self.control / "logs/route-authority-completion.json"
        completion = {
            "kind": "octoport.work-queue-completion", "version": 1,
            "task_id": task["id"], "candidate_sha": candidate_sha, "verdict": "PASS",
            "review": {"verdict": "PASS", "evidence": ["independent route review"]},
            "checks": [{"name": "route publication", "verdict": "PASS", "evidence": ["route run"]}],
        }
        completion_path.write_text(json.dumps(completion))
        snapshot = {
            "registration_id": registration_id, "candidate_sha": candidate_sha,
            "task_id": task["id"], "role": "C", "task_paths": task["paths"],
            "ready_receipt": str(ready_path.resolve()), "ready_sha256": ready_descriptor["sha256"],
            "close_receipt": str(close_path.resolve()), "close_sha256": close_descriptor["sha256"],
            "task_ref_cleanup_status": "DELETED",
        }
        task.update(
            state="DONE", completion_receipt=str(completion_path.resolve()),
            completion_receipt_format=1, completion_candidate_sha=candidate_sha,
            completion_receipt_snapshot=completion,
            completion_publication_registration=registration_id,
            completion_publication_snapshot=snapshot,
        )
        self.board["tasks"].append(task)
        self.save_board()
        return task

    def blocker_fixture(self, *, role="C", stopped=False):
        candidate = "c" * 40
        receipt = self.control / "logs/blocker-successor-completion.json"
        completion = {
            "kind": "octoport.work-queue-completion", "version": 1,
            "task_id": "ACCEPTED-SUCCESSOR", "candidate_sha": candidate,
            "verdict": "PASS",
            "review": {"verdict": "PASS", "evidence": ["independent successor review"]},
            "checks": [{"name": "accepted", "verdict": "PASS", "evidence": ["exact result"]}],
        }
        receipt.write_text(json.dumps(completion))
        old = {
            "id": "OLD-BLOCKED", "role": role, "plan": "C00", "state": "BLOCKED",
            "requires": [], "result": "Historical failed attempt", "paths": ["old.txt"],
            "acceptance": ["preserve historical state"], "blocked_reason": "superseded attempt",
            "blocked_receipt": str(self.control / "logs/old-blocker.json"),
        }
        Path(old["blocked_receipt"]).write_text('{"blocked":true}')
        successor = {
            "id": "ACCEPTED-SUCCESSOR", "role": role, "plan": "C00", "state": "DONE",
            "requires": [], "result": "Accepted successor", "paths": ["successor.txt"],
            "acceptance": ["strict completion"],
            "completion_receipt": str(receipt.resolve()), "completion_receipt_format": 1,
            "completion_candidate_sha": candidate, "completion_receipt_snapshot": completion,
        }
        self.board["tasks"].extend([old, successor])
        self.save_board()
        (self.control / f"{role}.json").write_text(
            json.dumps({"status": "STOPPED" if stopped else "RUNNING"})
        )
        return old, successor, receipt

    def run_blocker_broker(self, route_head, old, successor, receipt, *, cwd=None):
        bundle = route._completion_bundle_dir(self.control, route_head)
        return subprocess.run(
            [
                sys.executable, "-B", str(bundle / "task_publication.py"),
                "--control-root", str(self.control), "resolve-blocker",
                "--route-source-root", str(self.source),
                "--task", old["id"], "--successor", successor["id"],
                "--receipt", str(receipt),
            ],
            cwd=str(cwd or self.fixed), env=os.environ.copy(), text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False,
        )

    def prepared(self, reg, kind="TASK_REF", consume=True):
        old = self.base if kind == "MAIN" else (self.head if kind == "CLEANUP_TASK_REF" else route.ZERO_OID)
        ref = "refs/heads/main" if kind == "MAIN" else reg["core"]["task_ref"]
        target = route.ZERO_OID if kind == "CLEANUP_TASK_REF" else self.head
        with route._role_and_coord_locks(self.control, "C"):
            reg, lease = route._prepare_push_locked(self.control, reg, kind, old, ref, target, 120)
        source = route._lease_path(self.control, reg["registration_id"], "armed", lease["nonce"])
        if consume:
            self.assertTrue(route._rename_noreplace(source,
                route._lease_path(self.control, reg["registration_id"], "consumed", lease["nonce"])))
        attempt_path = route._attempt_path(self.control, reg["registration_id"], lease["nonce"])
        attempt = route._load_json(attempt_path)
        attempt.update(pid=999999999, proc_start_time="1", wait_outcome="EXITED", exit_code=0)
        route._attempt_update(attempt_path, attempt)
        return reg, lease, attempt

    def set_remote(self, ref, oid):
        # Own disposable bare remote only, used for deterministic fault injection.
        if oid == route.ZERO_OID:
            self.git(self.source, "--git-dir", str(self.remote), "update-ref", "-d", ref)
        else:
            self.git(self.work, "push", "origin", f"{oid}:refs/heads/fixture-objects")
            self.git(self.source, "--git-dir", str(self.remote), "update-ref", ref, oid)

    def advance_remote_main_disjoint(self, label="ready-base-drift"):
        advance = self.root / f"advance-{label}"
        self.git(
            self.source,
            "worktree",
            "add",
            "-b",
            f"advance-{label}",
            str(advance),
            self.base,
        )
        (advance / f"{label}.txt").write_text("disjoint main advance\n")
        self.git(advance, "add", f"{label}.txt")
        self.git(advance, "commit", "-m", f"advance main for {label}")
        advanced = route._head(advance)
        self.git(advance, "push", "origin", "HEAD:refs/heads/main")
        return advanced

    def manifest(self, schema="C"):
        evidence = self.control / "logs/source-review.txt"
        evidence.write_text("Fixture independently accepted source")
        blocker = self.control / "logs/preservation.json"
        blocker.write_text('{"preserved":true}')
        patch_file = self.control / "logs/source.patch"
        patch_file.write_bytes(subprocess.check_output(["git", "-C", str(self.work), "diff",
            "--binary", "--full-index", self.base, self.head]))
        row = {"task_id": self.task["id"], "eligibility": "ACCEPTED_SOURCE_EVIDENCE_FOR_FRESH_RECONSTRUCTION",
            "source_base": self.base, "source_head": self.head, "source_tree": route._tree(self.work),
            "source_head_parents": [self.base], "ordered_source_chain": [self.head],
            "changed_paths": ["product.txt"], "exact_task_paths": ["product.txt"],
            "full_binary_diff_sha256": route._full_diff_sha(self.work, self.base, self.head),
            "preserved_patch_path": str(patch_file)}
        if schema == "A":
            row.update(preserved_patch_sha256_recorded=route._sha_file(patch_file),
                preserved_patch_sha256_readback=route._sha_file(patch_file),
                independent_review_path=str(evidence), independent_review_sha256=route._sha_file(evidence),
                blocker_record=str(blocker), blocker_record_sha256=route._sha_file(blocker))
        else:
            row.update(preserved_patch_sha256=route._sha_file(patch_file),
                independent_review_evidence=[{"path": str(evidence), "sha256": route._sha_file(evidence)}],
                blocker_or_preservation_record=str(blocker), blocker_or_preservation_sha256=route._sha_file(blocker),
                same_path_drift_to_manifest_main=False)
        path = self.control / "logs/manifest.json"
        value = {"kind": "octoport.task-publication-accepted-source-manifest", "version": 1, "accepted": [row]}
        path.write_text(json.dumps(value))
        return path, value

    def supersede_evidence(self, reg, verdict="SUPERSEDED", successor=None):
        support = self.control / "logs/supersede-support.json"
        support.write_text(json.dumps({
            "kind": "fixture-ci-or-successor-evidence",
            "candidate_sha": reg["core"]["candidate_head"],
            "verdict": verdict,
        }))
        value = route.make_supersede_evidence(
            reg,
            verdict,
            "Exact fixture candidate failed review/CI or was replaced by a reviewed successor.",
            [{"path": str(support), "sha256": route._sha_file(support)}],
            successor or ("a" * 40 if verdict == "SUPERSEDED" else None),
        )
        path = self.control / "logs/supersede.json"
        path.write_text(json.dumps(value))
        return path, value, support

    def review_drift_evidence(self, reg, *, observed=None, successor=None):
        support = self.control / "logs/review-drift-support.json"
        support.write_text(json.dumps({
            "kind": "fixture-review-drift-recovery",
            "candidate_sha": reg["core"]["candidate_head"],
            "classification": "EVIDENCE_PATH_BYTES_DRIFT_AFTER_TASK_REF_PUBLICATION",
        }))
        value = {
            "kind": "octoport.task-publication-review-drift-retirement-evidence",
            "version": 1,
            "registration_id": reg["registration_id"],
            "task_id": reg["core"]["task_id"],
            "candidate_sha": reg["core"]["candidate_head"],
            "candidate_tree": reg["core"]["candidate_tree"],
            "task_ref": reg["core"]["task_ref"],
            "classification": "EVIDENCE_PATH_BYTES_DRIFT_AFTER_TASK_REF_PUBLICATION",
            "expected_review": dict(reg["core"]["review"]),
            "observed_review_sha256": observed or route._sha_file(self.review),
            "reason": "The registered review path changed bytes after exact task-ref publication; retire only that exact temporary ref.",
            "successor_sha": successor,
            "evidence": [{"path": str(support), "sha256": route._sha_file(support)}],
        }
        path = self.control / "logs/review-drift-retirement.json"
        path.write_text(json.dumps(value))
        return path, value, support

    def supersede(self, reg, evidence_path):
        return route.supersede_registration(
            self.control,
            reg["registration_id"],
            str(evidence_path),
            route._sha_file(evidence_path),
            self.source,
            self.base,
            route._tree(self.source),
        )

    def test_project_deploy_alias_normalizes_to_https_query(self):
        expected = ("github", "MaksimUnimax/runtime-fixtures")
        for target in (
            "github-seller-agents:MaksimUnimax/runtime-fixtures.git",
            "github-seller-agents:MaksimUnimax/runtime-fixtures",
        ):
            with self.subTest(target=target):
                self.assertEqual(route._remote_repository_identity(target), expected)
                self.assertEqual(
                    route._canonical_remote_query_target(target),
                    "https://github.com/MaksimUnimax/runtime-fixtures.git",
                )

        for target in (
            "github-seller-agents:",
            "github-seller-agents:MaksimUnimax",
            "github-seller-agents:/runtime-fixtures.git",
            "github-seller-agents:MaksimUnimax/.git",
            "github-seller-agents:MaksimUnimax/..",
            "github-seller-agents:MaksimUnimax/runtime-fixtures?query",
            "github-seller-agents:MaksimUnimax/runtime-fixtures#fragment",
            "github-seller-agents:MaksimUnimax/runtime-fixtures\\suffix",
            "github-seller-agents:MaksimUnimax/runtime-fixtures:extra",
            "github-seller-agents:MaksimUnimax/runtime-fixtures/extra",
            "foreign-alias:MaksimUnimax/runtime-fixtures.git",
            "github-seller-agents:MaksimUnimax/runtime fixtures.git",
        ):
            with self.subTest(target=target):
                with self.assertRaisesRegex(
                    RuntimeError, "TRUSTED_ROUTE_REMOTE_IDENTITY_INVALID"
                ):
                    route._remote_repository_identity(target)

    def test_trusted_route_resolves_blocker_from_divergent_canonical_branch(self):
        self.strict_route_authority(self.base)
        old, successor, receipt = self.blocker_fixture()
        (self.fixed / "divergent.txt").write_text("canonical C WIP history stays independent\n")
        self.git(self.fixed, "add", "divergent.txt")
        self.git(self.fixed, "commit", "-m", "diverge canonical C branch")
        self.assertNotEqual(route._head(self.fixed), self.base)

        proc = self.run_blocker_broker(self.base, old, successor, receipt)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["resolution_status"], "RESOLVED")
        self.assertEqual(result["route_source_head"], self.base)
        board = route._load_board(self.control)
        current = next(row for row in board["tasks"] if row["id"] == old["id"])
        self.assertEqual(current["state"], "BLOCKED")
        self.assertEqual(current["blocker_resolution"]["status"], "RESOLVED")
        self.assertEqual(current["blocker_resolution"]["successor_task"], successor["id"])
        self.assertEqual(current["blocker_resolution"]["receipt"], str(receipt.resolve()))

    def test_trusted_route_resolves_blocker_for_divergent_a_role(self):
        fixed_a = self.root / "fixed-A"
        policy_path = self.source / "docs/development/coordination/OWNERSHIP.json"
        policy = json.loads(policy_path.read_text())
        policy["roles"]["A"] = {
            "path": str(fixed_a), "branch": "work/a-extension",
            "allow": ["**"], "deny": ["secret/**"],
        }
        policy_path.write_text(json.dumps(policy))
        self.git(self.source, "add", str(policy_path.relative_to(self.source)))
        self.git(self.source, "commit", "-m", "fixture A role")
        route_head = route._head(self.source)
        self.git(self.source, "push", "origin", "main")
        self.git(
            self.source, "worktree", "add", "-b", "work/a-extension",
            str(fixed_a), route_head,
        )
        self.strict_route_authority(route_head)
        old, successor, receipt = self.blocker_fixture(role="A")
        (fixed_a / "a-local.txt").write_text("divergent A history\n")
        self.git(fixed_a, "add", "a-local.txt")
        self.git(fixed_a, "commit", "-m", "diverge canonical A branch")

        proc = self.run_blocker_broker(
            route_head, old, successor, receipt, cwd=fixed_a
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["resolution_status"], "RESOLVED")
        self.assertEqual(result["role_location"], str(fixed_a.resolve()))
        current = next(
            row for row in route._load_board(self.control)["tasks"]
            if row["id"] == old["id"]
        )
        self.assertEqual(current["state"], "BLOCKED")
        self.assertEqual(current["blocker_resolution"]["owner"], "A")

    def test_trusted_route_delegates_invalid_receipt_fail_closed(self):
        self.strict_route_authority(self.base)
        old, successor, _receipt = self.blocker_fixture()
        wrong = self.control / "logs/wrong-successor-receipt.json"
        wrong.write_text('{"wrong":true}')
        board_path = self.control / "controllers/work-board.json"
        before = board_path.read_bytes()

        proc = self.run_blocker_broker(self.base, old, successor, wrong)
        self.assertEqual(proc.returncode, 1, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertIn("WORK_QUEUE_BLOCKER_RESOLUTION_RECEIPT_INVALID", result["error"])
        self.assertEqual(board_path.read_bytes(), before)

    def test_trusted_route_rejects_noncurrent_remote_main_before_mutation(self):
        (self.source / "later.txt").write_text("not pushed\n")
        self.git(self.source, "add", "later.txt")
        self.git(self.source, "commit", "-m", "local route advance")
        route_head = route._head(self.source)
        self.strict_route_authority(route_head)
        old, successor, receipt = self.blocker_fixture()
        board_path = self.control / "controllers/work-board.json"
        before = board_path.read_bytes()

        proc = self.run_blocker_broker(route_head, old, successor, receipt)
        self.assertEqual(proc.returncode, 1, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["error"], "TRUSTED_ROUTE_NOT_CURRENT_REMOTE_MAIN")
        self.assertEqual(board_path.read_bytes(), before)

    def test_trusted_route_rechecks_remote_main_immediately_before_writer(self):
        self.strict_route_authority(self.base)
        old, successor, receipt = self.blocker_fixture()
        authority = route._trusted_current_main_route_authority(
            self.control, self.source
        )
        board_path = self.control / "controllers/work-board.json"
        before = board_path.read_bytes()
        with (
            patch.object(
                route, "_trusted_current_main_route_authority",
                return_value=authority,
            ),
            patch.object(
                route, "_select_execution_completion_bundle",
                return_value=(
                    Path(authority["completion_bundles"][0]["path"]),
                    authority["completion_bundles"][0]["sha256"],
                ),
            ),
            patch.object(
                route, "_require_canonical_role_location",
                return_value=self.fixed,
            ),
            patch.object(
                route, "_authority_remote_oid_target",
                return_value="f" * 40,
            ) as remote,
            patch.object(route, "_run_canonical_blocker_resolution") as writer,
        ):
            with self.assertRaisesRegex(
                RuntimeError, "TRUSTED_ROUTE_NOT_CURRENT_REMOTE_MAIN"
            ):
                route.resolve_blocker_via_trusted_route(
                    self.control,
                    self.source,
                    old["id"],
                    successor["id"],
                    str(receipt),
                )
        remote.assert_called_once_with(
            authority["query_target"], "refs/heads/main"
        )
        writer.assert_not_called()
        self.assertEqual(board_path.read_bytes(), before)

    def test_trusted_route_remote_main_ignores_route_local_url_rewrite(self):
        self.strict_route_authority(self.base)
        old, successor, receipt = self.blocker_fixture()
        board_path = self.control / "controllers/work-board.json"
        before = board_path.read_bytes()

        foreign = self.root / "foreign-authority.git"
        self.git(self.source, "init", "--bare", str(foreign))
        self.git(
            self.source, "push", str(foreign),
            f"{self.base}:refs/heads/main",
        )
        self.set_remote("refs/heads/main", self.head)
        self.git(
            self.source, "config",
            f"url.{foreign}.insteadOf", str(self.remote),
        )

        # This reproduces the reviewed R2 defect: a repository-local rewrite
        # can make the old -C route_root read see the accepted SHA.
        self.assertEqual(
            route._remote_oid_target(
                self.source, str(self.remote), "refs/heads/main",
                env=route.sanitized_git_authority_env(),
            ),
            self.base,
        )

        proc = self.run_blocker_broker(self.base, old, successor, receipt)
        self.assertEqual(proc.returncode, 1, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["error"], "TRUSTED_ROUTE_NOT_CURRENT_REMOTE_MAIN")
        self.assertEqual(board_path.read_bytes(), before)
        current = next(
            row for row in route._load_board(self.control)["tasks"]
            if row["id"] == old["id"]
        )
        self.assertNotIn("blocker_resolution", current)

    def test_trusted_route_rejects_hidden_authority_bytes_before_mutation(self):
        self.strict_route_authority(self.base)
        old, successor, receipt = self.blocker_fixture()
        board_path = self.control / "controllers/work-board.json"
        cases = (
            ("tooling/coordination/control.py", "--assume-unchanged"),
            ("tooling/coordination/task_publication.py", "--skip-worktree"),
        )
        for index, (relative, flag) in enumerate(cases):
            with self.subTest(relative=relative, flag=flag):
                if index:
                    self.git(self.source, "update-index", "--no-assume-unchanged", cases[index - 1][0])
                    self.git(self.source, "update-index", "--no-skip-worktree", cases[index - 1][0])
                    self.git(self.source, "checkout", "--", cases[index - 1][0])
                self.git(self.source, "update-index", flag, relative)
                target = self.source / relative
                target.write_bytes(target.read_bytes() + b"\n# hidden route poison\n")
                self.assertEqual(
                    self.git(self.source, "status", "--porcelain=v1", "--untracked-files=all"), ""
                )
                before = board_path.read_bytes()
                proc = self.run_blocker_broker(self.base, old, successor, receipt)
                self.assertEqual(proc.returncode, 1, proc.stderr)
                result = json.loads(proc.stdout)
                self.assertEqual(
                    result["error"], "QUEUE_COMPLETE_ROUTE_SOURCE_BYTES_DRIFT:" + relative
                )
                self.assertEqual(board_path.read_bytes(), before)

    def test_trusted_route_stopped_owner_fails_without_board_mutation(self):
        self.strict_route_authority(self.base)
        old, successor, receipt = self.blocker_fixture(stopped=True)
        board_path = self.control / "controllers/work-board.json"
        before = board_path.read_bytes()

        proc = self.run_blocker_broker(self.base, old, successor, receipt)
        self.assertEqual(proc.returncode, 1, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertIn("STOPPED", result["error"])
        self.assertEqual(board_path.read_bytes(), before)

    def test_real_git_hook_task_main_cleanup_close(self):
        reg = self.register()
        self.assertEqual(reg["core"]["full_diff_sha256"], route._full_diff_sha(self.work, self.base, self.head))
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.assertEqual(reg["state"], "TASK_REF_PUBLISHED")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        self.assertEqual(reg["state"], "PUBLISHED")
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), self.head)
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        self.assertEqual(reg["task_ref_cleanup_status"], "DELETED")
        self.assertEqual(route.close_registration(self.control, reg["registration_id"])["state"], "CLOSED")
        self.assertEqual(route._config_values(self.work, "core.hooksPath"), {"present": False, "values": []})

    def test_git_authority_environment_is_minimal_and_ignores_caller_injection(self):
        poisoned = {
            "KEEP_ME": "yes", "PATH": "/tmp/fake-bin", "LD_PRELOAD": "/tmp/evil.so",
            "PYTHONPATH": "/tmp/evil-python", "PYTHONHOME": "/tmp/evil-home",
            "GIT_SSH_COMMAND": "ssh -F fixture", "GIT_DIR": "/tmp/evil-dir",
            "GIT_WORK_TREE": "/tmp/evil-worktree", "GIT_COMMON_DIR": "/tmp/evil-common",
            "GIT_INDEX_FILE": "/tmp/evil-index", "GIT_OBJECT_DIRECTORY": "/tmp/evil-objects",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES": "/tmp/evil-alternates",
            "GIT_NAMESPACE": "evil", "GIT_SHALLOW_FILE": "/tmp/evil-shallow",
            "GIT_REPLACE_REF_BASE": "refs/evil/", "GIT_CONFIG": "/tmp/evil-config",
            "GIT_CONFIG_PARAMETERS": "'core.worktree=/tmp/evil'", "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.worktree", "GIT_CONFIG_VALUE_0": "/tmp/evil",
        }
        env = route.sanitized_git_authority_env(poisoned)
        self.assertEqual(set(env), {
            "PATH", "LC_ALL", "LANG", "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_SYSTEM",
            "GIT_CONFIG_GLOBAL", "GIT_NO_REPLACE_OBJECTS",
        })
        for key in poisoned:
            if key != "PATH":
                self.assertNotIn(key, env)
        self.assertEqual(env["PATH"], route.AUTHORITY_PATH)
        self.assertNotEqual(env["PATH"], poisoned["PATH"])
        self.assertEqual(env["GIT_CONFIG_NOSYSTEM"], "1")
        self.assertEqual(env["GIT_CONFIG_SYSTEM"], os.devnull)
        self.assertEqual(env["GIT_CONFIG_GLOBAL"], os.devnull)
        self.assertEqual(env["GIT_NO_REPLACE_OBJECTS"], "1")
        self.assertEqual(env["LC_ALL"], "C")
        self.assertEqual(env["LANG"], "C")

    def test_authority_git_uses_absolute_binary_not_caller_path(self):
        expected = self.git(self.source, "rev-parse", "HEAD")
        fake_bin = self.root / "fake-bin"
        fake_bin.mkdir()
        marker = self.root / "fake-git-called"
        fake_git = fake_bin / "git"
        fake_git.write_text(
            "#!/bin/sh\n"
            "printf called > \"$FAKE_GIT_MARKER\"\n"
            "printf fake-authority\n"
        )
        fake_git.chmod(0o755)
        with patch.dict(os.environ, {
            "PATH": str(fake_bin), "FAKE_GIT_MARKER": str(marker),
            "LD_PRELOAD": "/tmp/evil-loader.so", "PYTHONPATH": "/tmp/evil-python",
            "GIT_DIR": "/tmp/evil-dir",
        }, clear=False):
            self.assertEqual(route._authority_git(self.source, "rev-parse", "HEAD"), expected)
        self.assertFalse(marker.exists())
        self.assertEqual(route.AUTHORITY_GIT_BIN, "/usr/bin/git")

    def test_complete_queue_bootstraps_from_clean_exact_candidate_identity_after_original_path(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        reg = route.close_registration(self.control, reg["registration_id"])
        bootstrap = self.root / "bootstrap-exact-candidate"
        self.git(self.source, "worktree", "add", "--detach", str(bootstrap), self.head)
        receipt = self.control / "logs/completion.json"
        receipt.write_text('{"fixture":"completion"}')
        completion_entrypoint = Path(reg["core"]["completion_bundle_path"]) / "task_publication.py"
        with (
            patch.object(route, "__file__", str(completion_entrypoint)),
            patch.object(route, "_run_canonical_queue_completion", return_value={"state": "DONE"}) as boundary,
        ):
            result = route.complete_queue_registration(
                self.control, reg["registration_id"], str(receipt), "published",
                route_source_root=bootstrap,
            )
        self.assertNotEqual(bootstrap.resolve(), Path(reg["core"]["worktree_path"]).resolve())
        self.assertEqual(result["route_authority"], "REGISTRATION_CANDIDATE_SOURCE")
        self.assertEqual(result["publication_candidate"], self.head)
        self.assertEqual(result["route_source_head"], self.head)
        self.assertEqual(result["role_location"], str(self.fixed.resolve()))
        boundary.assert_called_once_with(
            self.control,
            bootstrap.resolve(),
            self.fixed.resolve(),
            "C",
            self.task["id"],
            receipt.resolve(),
            "published",
            reg["registration_id"],
            Path(reg["core"]["completion_bundle_path"]).resolve(),
            reg["core"]["completion_bundle_manifest_sha256"],
        )

    def test_complete_queue_real_bundle_entrypoint_reaches_receipt_boundary(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        reg = route.close_registration(self.control, reg["registration_id"])
        bootstrap = self.root / "bootstrap-real-bundle-entrypoint"
        self.git(self.source, "worktree", "add", "--detach", str(bootstrap), self.head)

        registry = DiskLifecycleRegistry(self.control)
        registry.seed_baseline()
        registry.declare_none(
            "C", self.task["id"],
            "Real immutable completion-bundle entrypoint positive fixture",
        )
        board_path = self.control / "controllers/work-board.json"
        before_board = board_path.read_bytes()
        before_completion = registry.completion_record("C", self.task["id"])
        completion_entrypoint = (
            Path(reg["core"]["completion_bundle_path"]) / "task_publication.py"
        )
        missing_receipt = self.control / "logs/missing-positive-boundary.json"
        proc = subprocess.run(
            [
                sys.executable, "-B", str(completion_entrypoint),
                "--control-root", str(self.control),
                "complete-queue",
                "--registration", reg["registration_id"],
                "--receipt", str(missing_receipt),
                "--summary", "reach post-authority receipt boundary",
                "--route-source-root", str(bootstrap),
            ],
            cwd=str(self.fixed),
            env=os.environ.copy(),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
        self.assertEqual(proc.returncode, 1, proc.stderr)
        result = json.loads(proc.stdout)
        self.assertEqual(result["status"], "BLOCKED")
        self.assertEqual(result["error"], "QUEUE_COMPLETE_RECEIPT_INVALID")
        self.assertEqual(board_path.read_bytes(), before_board)
        self.assertEqual(
            registry.completion_record("C", self.task["id"]),
            before_completion,
        )

    def test_complete_queue_real_bundle_rejects_hidden_worktree_bytes_before_mutation(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        reg = route.close_registration(self.control, reg["registration_id"])
        receipt = self.control / "logs/completion-hidden-bytes.json"
        receipt.write_text('{"fixture":"completion"}')
        completion_entrypoint = (
            Path(reg["core"]["completion_bundle_path"]) / "task_publication.py"
        )

        registry = DiskLifecycleRegistry(self.control)
        registry.seed_baseline()
        registry.declare_none(
            "C", self.task["id"],
            "Hidden working-tree byte authority real-entrypoint fixture",
        )
        board_path = self.control / "controllers/work-board.json"

        cases = (
            ("tooling/coordination/control.py", "--assume-unchanged"),
            ("tooling/coordination/task_publication.py", "--skip-worktree"),
        )
        for index, (relative, index_flag) in enumerate(cases):
            with self.subTest(relative=relative, index_flag=index_flag):
                bootstrap = self.root / f"bootstrap-hidden-real-{index}"
                self.git(
                    self.source, "worktree", "add", "--detach",
                    str(bootstrap), self.head,
                )
                self.git(bootstrap, "update-index", index_flag, relative)
                target = bootstrap / relative
                target.write_bytes(
                    target.read_bytes() + b"\n# hidden working-tree poison\n"
                )
                self.assertEqual(
                    self.git(
                        bootstrap, "status", "--porcelain=v1",
                        "--untracked-files=all",
                    ),
                    "",
                    "fixture must reproduce status-clean hidden tracked bytes",
                )
                self.assertEqual(route._head(bootstrap), self.head)
                self.assertEqual(route._tree(bootstrap), reg["core"]["candidate_tree"])

                before_board = board_path.read_bytes()
                before_completion = registry.completion_record(
                    "C", self.task["id"]
                )
                proc = subprocess.run(
                    [
                        sys.executable, "-B", str(completion_entrypoint),
                        "--control-root", str(self.control),
                        "complete-queue",
                        "--registration", reg["registration_id"],
                        "--receipt", str(receipt),
                        "--summary", "must not mutate",
                        "--route-source-root", str(bootstrap),
                    ],
                    cwd=str(self.fixed),
                    env=os.environ.copy(),
                    text=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    timeout=30,
                    check=False,
                )
                self.assertEqual(proc.returncode, 1, proc.stderr)
                result = json.loads(proc.stdout)
                self.assertEqual(result["status"], "BLOCKED")
                self.assertEqual(
                    result["error"],
                    "QUEUE_COMPLETE_ROUTE_SOURCE_BYTES_DRIFT:" + relative,
                )
                self.assertEqual(board_path.read_bytes(), before_board)
                self.assertEqual(
                    registry.completion_record("C", self.task["id"]),
                    before_completion,
                )

    def test_queue_source_authority_rejects_tampered_ready_before_policy_trust(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        reg = route.close_registration(self.control, reg["registration_id"])
        ready_path = Path(reg["ready_receipt"]["path"])
        ready = json.loads(ready_path.read_text())
        ready["ci"]["runs"][0]["conclusion"] = "failure"
        ready_path.write_text(json.dumps(ready))
        bootstrap = self.root / "bootstrap-tampered-ready"
        self.git(self.source, "worktree", "add", "--detach", str(bootstrap), self.head)
        with self.assertRaisesRegex(RuntimeError, "SOURCE_PUBLICATION_INVALID"):
            route.validate_queue_completion_source_authority(
                self.control, reg["registration_id"], bootstrap, "C", self.task["id"]
            )

    def test_queue_source_authority_rejects_same_tree_different_commit_without_done_authority(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        reg = route.close_registration(self.control, reg["registration_id"])
        descendant = self.root / "same-tree-descendant"
        self.git(self.source, "worktree", "add", "--detach", str(descendant), self.head)
        self.git(descendant, "config", "user.name", "Fixture")
        self.git(descendant, "config", "user.email", "fixture@example.invalid")
        self.git(descendant, "commit", "--allow-empty", "-m", "different identity")
        self.assertEqual(route._tree(descendant), reg["core"]["candidate_tree"])
        self.assertNotEqual(route._head(descendant), reg["core"]["candidate_head"])
        with self.assertRaisesRegex(RuntimeError, "ROUTE_SOURCE_NOT_ACCEPTED"):
            route.validate_queue_completion_source_authority(
                self.control, reg["registration_id"], descendant, "C", self.task["id"]
            )

    def test_queue_source_authority_rejects_self_authored_checkout_before_policy_use(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        reg = route.close_registration(self.control, reg["registration_id"])
        attacker = self.root / "self-authored-route"
        attacker.mkdir()
        self.git(attacker, "init", "-b", "work/c-integration")
        self.git(attacker, "config", "user.name", "Fixture")
        self.git(attacker, "config", "user.email", "fixture@example.invalid")
        for name in ("control.py", "task_publication.py"):
            target = attacker / "tooling/coordination" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(Path(__file__).with_name(name), target)
        policy = attacker / "docs/development/coordination/OWNERSHIP.json"
        policy.parent.mkdir(parents=True, exist_ok=True)
        policy.write_text(json.dumps({"roles": {"C": {
            "path": str(attacker), "branch": "work/c-integration",
            "allow": ["**"], "deny": [],
        }}}))
        self.git(attacker, "add", ".")
        self.git(attacker, "commit", "-m", "self authored policy")
        with self.assertRaisesRegex(RuntimeError, "ROUTE_SOURCE_NOT_ACCEPTED"):
            route.validate_queue_completion_source_authority(
                self.control, reg["registration_id"], attacker, "C", self.task["id"]
            )

    def test_canonical_queue_completion_runs_control_from_role_cwd(self):
        proof = self.control / "logs/completion-real.json"
        proof.write_text("{}")
        completion_bundle, completion_bundle_sha = route._install_completion_bundle(
            self.control, self.source, self.base, route._tree(self.source)
        )
        completed = subprocess.CompletedProcess(
            ["control.py"], 0, stdout=json.dumps({"state": "DONE"}), stderr=""
        )
        with (
            patch.object(route.Path, "resolve", autospec=True) as resolve,
            patch.object(route, "_git", return_value="tooling/coordination/control.py"),
            patch.object(route.subprocess, "run", return_value=completed) as run,
        ):
            def resolved(path, *args, **kwargs):
                value = Path(path)
                if str(value) in {str(self.control), "/root/octoport-control"}:
                    return Path("/root/octoport-control")
                return value.absolute()
            resolve.side_effect = resolved
            result = route._run_canonical_queue_completion(
                self.control,
                self.source,
                self.fixed,
                "C",
                self.task["id"],
                proof,
                "published fixture",
                "a" * 64,
                completion_bundle,
                completion_bundle_sha,
            )
        self.assertEqual(result, {"state": "DONE"})
        command = run.call_args.args[0]
        self.assertEqual(run.call_args.kwargs["cwd"], str(self.fixed))
        self.assertEqual(command[1], "-B")
        self.assertEqual(command[2], str(completion_bundle / "control.py"))
        child_env = run.call_args.kwargs["env"]
        expected_env = route.sanitized_git_authority_env()
        expected_env.update({
            "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(self.source.resolve()),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": str(completion_bundle.resolve()),
            "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": completion_bundle_sha,
        })
        self.assertEqual(child_env, expected_env)
        self.assertFalse(any(key.startswith(("LD_", "PYTHON")) for key in child_env))
        self.assertEqual(
            command[command.index("--publication-registration") + 1],
            "a" * 64,
        )

    def test_complete_queue_rejects_registration_before_close(self):
        reg = self.register()
        receipt = self.control / "logs/completion.json"
        receipt.write_text('{"fixture":"completion"}')
        with self.assertRaisesRegex(RuntimeError, "REGISTRATION_NOT_CLOSED"):
            route.complete_queue_registration(
                self.control, reg["registration_id"], str(receipt), "published",
                route_source_root=self.work,
            )

    def test_complete_queue_accepts_other_strict_published_route_source(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        reg = route.close_registration(self.control, reg["registration_id"])

        authority = self.strict_route_authority(self.base)
        receipt = self.control / "logs/completion-other-route.json"
        receipt.write_text('{"fixture":"completion"}')
        authority_bundle = route._completion_bundle_dir(self.control, self.base)
        with (
            patch.object(route, "__file__", str(authority_bundle / "task_publication.py")),
            patch.object(route, "_run_canonical_queue_completion", return_value={"state": "DONE"}) as boundary,
        ):
            result = route.complete_queue_registration(
                self.control, reg["registration_id"], str(receipt), "published",
                route_source_root=self.source,
            )
        self.assertEqual(result["route_authority"], ["ROUTE-AUTHORITY"])
        self.assertEqual(result["route_source_head"], self.base)
        boundary.assert_called_once()

    def test_complete_queue_requires_canonical_role_location_before_writer(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        reg = route.close_registration(self.control, reg["registration_id"])
        receipt = self.control / "logs/completion-wrong-location.json"
        receipt.write_text('{"fixture":"completion"}')
        self.git(self.fixed, "checkout", "-b", "wrong-role-location")
        completion_entrypoint = Path(reg["core"]["completion_bundle_path"]) / "task_publication.py"
        with (
            patch.object(route, "__file__", str(completion_entrypoint)),
            patch.object(route, "_run_canonical_queue_completion") as boundary,
        ):
            with self.assertRaisesRegex(RuntimeError, "QUEUE_COMPLETE_ROLE_LOCATION_INVALID"):
                route.complete_queue_registration(
                    self.control, reg["registration_id"], str(receipt), "published",
                    route_source_root=self.work,
                )
        boundary.assert_not_called()

    def test_complete_queue_rejects_unaccepted_other_route_source(self):
        reg = self.register()
        reg = route._state_transition(
            self.control, reg["registration_id"], {"REGISTERED"}, "PUBLISHED",
            {"task_ref_cleanup_status": "DELETED"},
        )
        reg = route.close_registration(self.control, reg["registration_id"])
        receipt = self.control / "logs/completion.json"
        receipt.write_text('{"fixture":"completion"}')
        with self.assertRaisesRegex(RuntimeError, "SOURCE_PUBLICATION_INVALID"):
            route.complete_queue_registration(
                self.control, reg["registration_id"], str(receipt), "published",
                route_source_root=self.source,
            )

    def test_registration_idempotence_and_clean_source_binding(self):
        reg = self.register()
        self.assertEqual(self.register()["registration_id"], reg["registration_id"])
        (self.source / "tooling/coordination/task_publication.py").write_text("poison")
        with self.assertRaisesRegex(RuntimeError, "ROUTE_SOURCE_CLEAN_REQUIRED"):
            self.register()

    def test_global_config_absence_values_and_parse_errors(self):
        self.assertEqual(route._global_config_digest(), route._sha_bytes(b""))
        path = Path(os.environ["GIT_CONFIG_GLOBAL"])
        path.write_text("[fixture]\nempty =\nflag\nmulti = first\nmulti = second\n")
        exact = subprocess.check_output(["git", "config", "--global", "--null", "--list"])
        self.assertEqual(route._global_config_digest(), route._sha_bytes(exact))
        path.write_text("[invalid\n")
        with self.assertRaisesRegex(RuntimeError, "GLOBAL_CONFIG_DIGEST_FAILED"):
            route._global_config_digest()

    def test_real_publication_reads_migrated_v2_board_through_committed_bundle(self):
        import work_queue
        import work_board_v2
        import work_board_v2_migrate as migrate
        self.board["updated_at"] = "2026-10-02T00:00:00Z"
        self.save_board()
        raw = (self.control / "controllers/work-board.json").read_bytes()
        reader = Path(work_queue.__file__).resolve()
        readers = {name: reader for name in ("A", "B", "C", "ORG")}
        now = dt.datetime.now(dt.timezone.utc)
        grant = {
            "id": "publication-fixture", "status": "GRANTED", "authority": migrate.AUTHORITY_KIND,
            "issued_at": (now - dt.timedelta(seconds=1)).isoformat(),
            "expires_at": (now + dt.timedelta(minutes=5)).isoformat(),
            "corrected_scope_sha256": migrate.SCOPE_SHA256,
            "source_candidate_sha": self.git(Path(migrate.__file__).resolve().parents[2], "rev-parse", "HEAD"),
            "work_queue_sha256": route._sha_file(reader),
            "work_board_v2_sha256": route._sha_file(Path(work_board_v2.__file__)),
            "migrate_sha256": route._sha_file(Path(migrate.__file__)),
            "expected_v1_revision": 1, "expected_v1_sha256": route._sha_bytes(raw),
            "reader_sha256": {name: route._sha_file(reader) for name in readers}, "single_use": True,
        }
        authority = self.control / "authorizations/CONTROLLER-WORK-BOARD-V2-MIGRATION-publication-fixture.json"
        authority.parent.mkdir()
        authority.write_text(json.dumps(grant))
        authority.chmod(0o600)
        migrate.migrate(self.control, authority, readers, 1, route._sha_bytes(raw), executing_role="C")
        self.assertEqual(work_queue.load_board(self.control)["version"], 2)
        reg = self.register()
        self.assertTrue((Path(reg["core"]["bundle_path"]) / "work_board_v2.py").is_file())
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        self.assertEqual(reg["state"], "PUBLISHED")
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), self.head)
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        route.close_registration(self.control, reg["registration_id"])

    def test_source_identity_and_missing_committed_helper_reject_before_config(self):
        target = self.source / "tooling/coordination/task_publication.py"
        self.git(self.source, "rm", str(target))
        self.git(self.source, "commit", "-m", "remove helper")
        target.write_text("untracked replacement")
        with self.assertRaisesRegex(RuntimeError, "ROUTE_SOURCE_CLEAN_REQUIRED"):
            self.register()
        self.assertFalse(route._config_values(self.work, "core.hooksPath")["present"])

    def test_wrong_route_commit_and_poisoned_bundle(self):
        with self.assertRaisesRegex(RuntimeError, "ROUTE_SOURCE_IDENTITY"):
            route._install_bundle(self.control, self.source, self.head, route._tree(self.source))
        bundle, digest = route._install_bundle(self.control, self.source, self.base, route._tree(self.source))
        (bundle / "ci_gate.py").write_text("poison")
        with self.assertRaisesRegex(RuntimeError, "BUNDLE_FILE_HASH"):
            self.register()

    def test_stop_scope_review_and_candidate_drift(self):
        reg = self.register()
        with self.subTest("stop"):
            (self.control / "C.json").write_text('{"status":"STOPPED"}')
            with self.assertRaisesRegex(RuntimeError, "STOPPED"):
                route._push_operation(self.control, reg["registration_id"], "TASK_REF")
            (self.control / "C.json").write_text('{"status":"RUNNING"}')
        for key, value in [("paths", ["other.txt"]), ("result", "changed"), ("claimed_at", "changed")]:
            old = copy.deepcopy(self.task)
            self.task[key] = value
            self.save_board()
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, "TASK_FINGERPRINT"):
                route._validate_registration_identity(self.control, reg)
            self.task.clear(); self.task.update(old); self.save_board()
        self.review.write_text("{}");
        with self.assertRaisesRegex(RuntimeError, "REVIEW_HASH"):
            route._validate_registration_identity(self.control, reg)

    def test_both_frozen_manifest_schemas_and_source_validation(self):
        for schema in ["A", "C"]:
            path, original = self.manifest(schema)
            row = route._manifest_entry(self.control, str(path), route._sha_file(path), self.task["id"], self.work)["entry"]
            self.assertEqual(row["source_head"], self.head)
            for key, value in [("eligibility", "DENY"), ("source_tree", "f" * 40),
                    ("ordered_source_chain", []), ("source_head_parents", []),
                    ("full_binary_diff_sha256", "f" * 64), ("changed_paths", ["other.txt"])]:
                changed = copy.deepcopy(original); changed["accepted"][0][key] = value
                path.write_text(json.dumps(changed))
                with self.subTest(schema=schema, key=key), self.assertRaises((RuntimeError, subprocess.SubprocessError)):
                    route._manifest_entry(self.control, str(path), route._sha_file(path), self.task["id"], self.work)

    def test_reconstruction_is_exact_and_same_path_drift_rejected(self):
        path, value = self.manifest("A")
        fresh = self.root / "fresh"
        self.git(self.source, "worktree", "add", "-b", "fresh", str(fresh), self.base)
        result = route.reconstruct_from_manifest(self.control, str(path), route._sha_file(path),
            self.task["id"], fresh, self.base, "fresh accepted reconstruction")
        self.assertEqual(result["candidate_tree"], route._tree(self.work))
        for flag in [None, True, False]:
            row = copy.deepcopy(value["accepted"][0])
            if flag is not None: row["same_path_drift_to_manifest_main"] = flag
            with self.subTest(flag=flag), self.assertRaisesRegex(RuntimeError, "SOURCE_PATH_DRIFT"):
                route._check_reconstruction_base(row, self.work, self.head)

    def test_stale_manifest_review_and_missing_evidence_reject(self):
        path, value = self.manifest()
        digest = route._sha_file(path)
        with self.assertRaisesRegex(RuntimeError, "REVIEW_IDENTITY.*accepted_manifest"):
            self.register(manifest_path=str(path), manifest_sha=digest)
        self.write_review(digest)
        reg = self.register(manifest_path=str(path), manifest_sha=digest)
        Path(value["accepted"][0]["independent_review_evidence"][0]["path"]).write_text("changed")
        with self.assertRaisesRegex(RuntimeError, "ACCEPTED_REVIEW_HASH"):
            route._validate_registration_identity(self.control, reg)

    def test_ci_exact_five_and_version_bound_ready(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        for mutation in ["missing", "sha", "branch", "expired"]:
            ci = self.ci(reg)
            if mutation == "missing": ci["runs"].pop()
            if mutation == "sha": ci["head"] = self.base
            if mutation == "branch": ci["branch"] = "other"
            if mutation == "expired": ci["checked_at"] = 1
            with self.subTest(mutation=mutation), self.assertRaises(RuntimeError):
                route.mark_ready(self.control, reg["registration_id"], ci)
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        stale = copy.deepcopy(reg); stale["state_version"] += 2
        with self.assertRaisesRegex(RuntimeError, "registration_state_version"):
            route._validate_ready_receipt(self.control, stale)

    def blocked_source(self):
        self.task["id"] = "C-ACCEPTED-SOURCE"
        self.task.update(state="BLOCKED", claimed_at="2026-10-02T00:00:00Z",
            blocked_reason="Publication waits for CONTROLLER-TASK-PUBLICATION-ROUTE")
        path, value = self.manifest()
        self.task["blocked_receipt"] = value["accepted"][0]["blocker_or_preservation_record"]
        done = copy.deepcopy(self.task)
        done.update(id="CONTROLLER-TASK-PUBLICATION-ROUTE", state="DONE",
            paths=["route.py"], completion_receipt=str(self.control / "logs/legacy-route-proof"))
        done.pop("blocked_reason"); done.pop("blocked_receipt")
        self.board["tasks"].append(done)
        self.save_board()
        return path, value

    def test_unblock_uses_normal_writer_and_preserves_exact_task_identity(self):
        path, value = self.blocked_source()
        before = copy.deepcopy(self.task)
        result = route.unblock_from_manifest(self.control, "C", self.task["id"],
            str(path), route._sha_file(path), self.work)
        board = route._load_board(self.control)
        task = route._task_from_board(board, self.task["id"])
        self.assertEqual(task["state"], "IN_PROGRESS")
        self.assertEqual(task["unblock_receipt"], result["receipt"])
        for key in ["role", "claimed_at", "requires", "paths", "result"]:
            self.assertEqual(task[key], before[key])
        events = (self.control / "controllers/work-board-events.jsonl").read_text().splitlines()
        self.assertEqual(len(events), 1)
        self.assertEqual(json.loads(events[0])["task"], self.task["id"])

    def test_unblock_rejects_wrong_blocker_and_writer_race_without_transition(self):
        import work_queue
        path, value = self.blocked_source()
        original = copy.deepcopy(self.task)
        for key, bad in [("blocked_receipt", ""), ("blocked_receipt", str(self.root / "outside")),
                ("blocked_reason", "unrelated blocker"), ("paths", ["wrong.txt"])]:
            self.task[key] = bad; self.save_board()
            before = (self.control / "controllers/work-board.json").read_bytes()
            with self.subTest(key=key, bad=bad), self.assertRaises(RuntimeError):
                route.unblock_from_manifest(self.control, "C", self.task["id"],
                    str(path), route._sha_file(path), self.work)
            self.assertEqual((self.control / "controllers/work-board.json").read_bytes(), before)
            self.assertFalse((self.control / "controllers/work-board-events.jsonl").exists())
            self.task.clear(); self.task.update(original); self.save_board()
        real_advance = work_queue.advance_task
        def raced(*args, **kwargs):
            self.task["result"] = "concurrent task edit"
            self.save_board()
            return real_advance(*args, **kwargs)
        with patch.object(work_queue, "advance_task", side_effect=raced), self.assertRaisesRegex(
                RuntimeError, "WORK_QUEUE_TASK_DRIFT"):
            route.unblock_from_manifest(self.control, "C", self.task["id"],
                str(path), route._sha_file(path), self.work)
        self.assertEqual(route._task_from_board(route._load_board(self.control), self.task["id"])["state"], "BLOCKED")
        self.assertFalse((self.control / "controllers/work-board-events.jsonl").exists())

    def test_consumed_non_target_never_retries_even_late_target(self):
        reg = self.register()
        reg, lease, attempt = self.prepared(reg)
        failed = route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(failed["state"], "FAILED")
        # Copy objects without using the registered route or a live remote.
        subprocess.run(["git", "--git-dir", str(self.remote), "fetch", str(self.work), self.head],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.git(self.source, "--git-dir", str(self.remote), "update-ref", reg["core"]["task_ref"], self.head)
        self.assertEqual(route.recover_registration(self.control, reg["registration_id"])["state"], "FAILED")

    def test_cancelled_main_requires_new_ready(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        old_ready = copy.deepcopy(reg["ready_receipt"])
        reg, lease, attempt = self.prepared(reg, "MAIN", consume=False)
        reg = route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(reg["state"], "TASK_REF_PUBLISHED")
        self.assertIsNone(reg["ready_receipt"])
        with self.assertRaises(RuntimeError):
            route._push_operation(self.control, reg["registration_id"], "MAIN")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        self.assertNotEqual(reg["ready_receipt"], old_ready)

    def test_unknown_process_consumed_or_cancelled_never_succeeds(self):
        reg = self.register()
        reg, lease, attempt = self.prepared(reg)
        path = route._attempt_path(self.control, reg["registration_id"], lease["nonce"])
        attempt["proc_start_time"] = None; route._attempt_update(path, attempt)
        self.assertEqual(route.recover_registration(self.control, reg["registration_id"])["state"], "FAILED")

    def test_settlement_recovery_preserves_bytes_and_rejects_later_remote_drift(self):
        reg = self.register()
        reg, lease, attempt = self.prepared(reg)
        settlement = route._immutable_settlement(self.control, reg, lease, "consumed", attempt,
            route.ZERO_OID, "FAILED", "CONSUMED_NON_TARGET_AMBIGUOUS")
        path = route._settlement_path(self.control, reg["registration_id"], lease["nonce"])
        before = path.read_bytes()
        with patch.object(route, "_remote_oid", return_value=self.head):
            reg = route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(reg["state"], "FAILED")
        self.assertEqual(path.read_bytes(), before)
        self.assertEqual(reg["last_settlement_outcome"], "POST_SETTLEMENT_REMOTE_DRIFT")

    def test_target_settlement_cannot_commit_after_remote_drift(self):
        reg = self.register()
        reg, lease, attempt = self.prepared(reg)
        route._immutable_settlement(self.control, reg, lease, "consumed", attempt,
            self.head, "TASK_REF_PUBLISHED", "CONSUMED_TARGET")
        self.assertEqual(route.recover_registration(self.control, reg["registration_id"])["state"], "FAILED")

    def test_settlement_tamper_fails_and_state_is_unchanged(self):
        reg = self.register()
        reg, lease, attempt = self.prepared(reg)
        route._immutable_settlement(self.control, reg, lease, "consumed", attempt,
            route.ZERO_OID, "FAILED", "CONSUMED_NON_TARGET_AMBIGUOUS")
        path = route._settlement_path(self.control, reg["registration_id"], lease["nonce"])
        row = json.loads(path.read_text()); row["settlement_outcome"] = "TASK_REF_PUBLISHED"
        path.write_text(json.dumps(row))
        with self.assertRaisesRegex(RuntimeError, "SETTLEMENT_HASH"):
            route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(route._read_registration(self.control, reg["registration_id"])[0]["state"], "PUSHING_TASK_REF")

    def test_full_identity_drift_before_settlement_blocks_success(self):
        reg = self.register()
        reg, lease, attempt = self.prepared(reg)
        self.task["result"] = "changed"; self.save_board()
        with patch.object(route, "_remote_oid", return_value=self.head):
            result = route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(result["state"], "FAILED")
        self.assertIn("IDENTITY_DRIFT", result["last_settlement_outcome"])

    def test_lease_deadline_boot_and_cancel_consume_race(self):
        lease = {"boot_id": "boot", "deadline_boottime_ns": 100}
        with patch.object(route, "_boot_id", return_value="boot"):
            with patch.object(route, "_boottime_ns", return_value=99): route._validate_lease_time(lease)
            for clock in [100, 101]:
                with patch.object(route, "_boottime_ns", return_value=clock), self.assertRaisesRegex(RuntimeError, "EXPIRED"):
                    route._validate_lease_time(lease)
        with patch.object(route, "_boot_id", return_value="other"), self.assertRaisesRegex(RuntimeError, "BOOT"):
            route._validate_lease_time(lease)
        source = self.root / "armed"; source.write_text("nonce")
        consumed = self.root / "consumed"; cancelled = self.root / "cancelled"
        self.assertTrue(route._rename_noreplace(source, consumed))
        self.assertFalse(route._rename_noreplace(source, cancelled))
        self.assertFalse(cancelled.exists())

    def test_hook_denies_cancelled_nonce_and_mismatched_remote_tuple(self):
        reg = self.register()
        reg, lease, attempt = self.prepared(reg, consume=False)
        env = dict(os.environ, OCTOPORT_PUBLICATION_CONTROL_ROOT=str(self.control),
            OCTOPORT_PUBLICATION_REGISTRATION_ID=reg["registration_id"],
            OCTOPORT_PUBLICATION_NONCE=lease["nonce"], OCTOPORT_PUBLICATION_KIND="TASK_REF",
            OCTOPORT_PUBLICATION_BUNDLE_MANIFEST_SHA256=reg["core"]["bundle_manifest_sha256"])
        hook = str(Path(reg["core"]["bundle_path"]) / "hooks/pre-push")
        row = f"HEAD {self.head} {reg['core']['task_ref']} {self.base}\n"
        p = subprocess.run([hook, "origin", str(self.remote)], cwd=self.work, env=env,
            input=row, capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0); self.assertIn("REMOTE_CAS", p.stderr)
        route.recover_registration(self.control, reg["registration_id"])
        row = f"HEAD {self.head} {reg['core']['task_ref']} {route.ZERO_OID}\n"
        p = subprocess.run([hook, "origin", str(self.remote)], cwd=self.work, env=env,
            input=row, capture_output=True, text=True)
        self.assertNotEqual(p.returncode, 0)
        self.assertEqual(route._remote_oid(self.work, "origin", reg["core"]["task_ref"]), route.ZERO_OID)

    def test_state_snapshot_tamper_is_detected(self):
        reg = self.register()
        path = route._registration_path(self.control, reg["registration_id"])
        value = json.loads(path.read_text()); value["state"] = "PUBLISHED"
        path.write_text(json.dumps(value))
        with self.assertRaisesRegex(RuntimeError, "STATE_HASH"):
            route.recover_registration(self.control, reg["registration_id"])

    def test_close_restores_empty_and_multivalue_and_preserves_unrelated(self):
        hooks = {"present": True, "values": [""]}
        urls = {"present": True, "values": ["", "first", "second"]}
        route._set_config_values(self.work, "core.hooksPath", hooks)
        route._set_config_values(self.work, "remote.origin.pushurl", urls)
        reg = self.register(pushurl=str(self.remote))
        self.git(self.work, "config", "--worktree", "unrelated.keep", "yes")
        reg = route._state_transition(self.control, reg["registration_id"], {"REGISTERED"}, "REVOKED")
        route.close_registration(self.control, reg["registration_id"])
        self.assertEqual(route._config_values(self.work, "core.hooksPath"), hooks)
        self.assertEqual(route._config_values(self.work, "remote.origin.pushurl"), urls)
        self.assertEqual(self.git(self.work, "config", "--worktree", "unrelated.keep"), "yes")

    def test_close_blocks_same_key_drift_and_retained_ref_generation_not_reused(self):
        reg = self.register()
        old_ref = reg["core"]["task_ref"]
        route._state_transition(self.control, reg["registration_id"], {"REGISTERED"}, "REVOKED")
        self.git(self.work, "config", "--worktree", "core.hooksPath", "changed")
        with self.assertRaisesRegex(RuntimeError, "SAME_KEY_DRIFT"):
            route.close_registration(self.control, reg["registration_id"])
        route._set_config_values(self.work, "core.hooksPath", reg["installed_config"]["core.hooksPath"])
        route.close_registration(self.control, reg["registration_id"])
        self.assertNotEqual(self.register()["core"]["task_ref"], old_ref)

    def test_consumed_main_non_target_and_repeat_recovery_are_terminal(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg, lease, attempt = self.prepared(reg, "MAIN")
        reg = route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(reg["state"], "FAILED")
        before = route._registration_path(self.control, reg["registration_id"]).read_bytes()
        with patch.object(route, "_remote_oid", return_value=self.head):
            self.assertEqual(route.recover_registration(self.control, reg["registration_id"]), reg)
        self.assertEqual(route._registration_path(self.control, reg["registration_id"]).read_bytes(), before)

    def test_cancel_then_crash_before_cas_recovers_once(self):
        reg = self.register()
        reg, lease, attempt = self.prepared(reg, consume=False)
        source = route._lease_path(self.control, reg["registration_id"], "armed", lease["nonce"])
        route._rename_noreplace(source, route._lease_path(self.control, reg["registration_id"], "cancelled", lease["nonce"]))
        reg = route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(reg["state"], "REGISTERED")
        path = Path(reg["last_settlement"]); before = path.read_bytes()
        self.assertEqual(route.recover_registration(self.control, reg["registration_id"]), reg)
        self.assertEqual(path.read_bytes(), before)

    def test_every_revalidated_identity_prevents_cancelled_main_retry(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg, lease, attempt = self.prepared(reg, "MAIN", consume=False)
        # Full validator is separately exercised against real task/review/bundle
        # mutations. Here inject its error at the formerly missing settlement call.
        with patch.object(route, "_validate_registration_identity", side_effect=route.PublicationError("IMMUTABLE_DRIFT")):
            reg = route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(reg["state"], "FAILED")
        self.assertIn("IMMUTABLE_DRIFT", reg["last_settlement_outcome"])

    def test_cleanup_absent_and_foreign_preserve_main_success(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg = route._push_operation(self.control, reg["registration_id"], "MAIN")
        ref = reg["core"]["task_ref"]
        self.git(self.source, "--git-dir", str(self.remote), "update-ref", ref, self.base)
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        self.assertEqual(reg["state"], "PUBLISHED")
        self.assertEqual(reg["task_ref_cleanup_status"], "FOREIGN_RETAINED")
        self.assertEqual(route._remote_oid(self.work, "origin", ref), self.base)
        self.git(self.source, "--git-dir", str(self.remote), "update-ref", "-d", ref)
        reg = route._push_operation(self.control, reg["registration_id"], "CLEANUP_TASK_REF")
        self.assertEqual(reg["task_ref_cleanup_status"], "ALREADY_ABSENT")

    def test_supersede_registered_cancelled_remote_unchanged_closes_without_remote_mutation(self):
        reg = self.register()
        reg = route._state_transition(
            self.control,
            reg["registration_id"],
            {"REGISTERED"},
            "REGISTERED",
            {"last_settlement_outcome": "CANCELLED_REMOTE_UNCHANGED"},
            expected_version=reg["state_version"],
        )
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        ref = reg["core"]["task_ref"]
        main_before = route._remote_oid(self.work, "origin", "refs/heads/main")
        prior_hooks = reg["core"]["prior_config"]["core.hooksPath"]

        with patch.object(route, "_run_supersede_send_pack") as send_pack:
            result = self.supersede(reg, evidence_path)

        send_pack.assert_not_called()
        self.assertEqual(result["state"], "CLOSED")
        self.assertEqual(result["task_ref_cleanup_status"], "ALREADY_ABSENT")
        self.assertEqual(route._remote_oid(self.work, "origin", ref), route.ZERO_OID)
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), main_before)
        self.assertEqual(route._config_values(self.work, "core.hooksPath"), prior_hooks)
        close = json.loads(Path(result["close_receipt"]["path"]).read_text())
        self.assertEqual(close["state_before"], "REVOKED")
        before = route._registration_path(self.control, reg["registration_id"]).read_bytes()
        self.assertEqual(self.supersede(result, evidence_path)["state"], "CLOSED")
        self.assertEqual(
            route._registration_path(self.control, reg["registration_id"]).read_bytes(),
            before,
        )

    def test_supersede_registered_requires_cancelled_remote_unchanged_and_absent_ref(self):
        reg = self.register()
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        with self.assertRaisesRegex(
            RuntimeError, "SUPERSEDE_REGISTERED_CANCELLED_REMOTE_UNCHANGED_REQUIRED"
        ):
            self.supersede(reg, evidence_path)

        reg = route._state_transition(
            self.control,
            reg["registration_id"],
            {"REGISTERED"},
            "REGISTERED",
            {"last_settlement_outcome": "CANCELLED_REMOTE_UNCHANGED"},
            expected_version=reg["state_version"],
        )
        ref = reg["core"]["task_ref"]
        self.git(self.source, "--git-dir", str(self.remote), "update-ref", ref, self.base)
        with self.assertRaisesRegex(RuntimeError, "SUPERSEDE_REGISTERED_TASK_REF_PRESENT"):
            self.supersede(reg, evidence_path)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "REGISTERED")
        self.assertEqual(route._remote_oid(self.work, "origin", ref), self.base)

    def test_supersede_registered_never_started_base_drift_closes_without_remote_mutation(self):
        reg = self.register()
        advanced_main = self.advance_remote_main_disjoint("registered-never-started")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        ref = reg["core"]["task_ref"]
        main_before = route._remote_oid(self.work, "origin", "refs/heads/main")
        with patch.object(route, "_run_supersede_send_pack") as send_pack:
            result = self.supersede(reg, evidence_path)
        send_pack.assert_not_called()
        self.assertEqual(result["state"], "CLOSED")
        self.assertEqual(result["task_ref_cleanup_status"], "ALREADY_ABSENT")
        self.assertEqual(route._remote_oid(self.work, "origin", ref), route.ZERO_OID)
        self.assertEqual(
            route._remote_oid(self.work, "origin", "refs/heads/main"), main_before
        )
        retirement = result["registered_base_drift_retirement"]
        self.assertEqual(
            retirement["outcome"], "NEVER_PUBLISHED_CONFIRMED_ABSENT"
        )
        self.assertEqual(retirement["registered_base"], self.base)
        self.assertEqual(retirement["observed_remote_main"], advanced_main)
        self.assertTrue(retirement["task_ref_absent"])
        self.assertEqual(retirement["event_count"], 1)
        self.assertRegex(retirement["event_journal_sha256"], r"^[0-9a-f]{64}$")
        before = route._registration_path(
            self.control, reg["registration_id"]
        ).read_bytes()
        self.assertEqual(self.supersede(result, evidence_path)["state"], "CLOSED")
        self.assertEqual(
            route._registration_path(
                self.control, reg["registration_id"]
            ).read_bytes(),
            before,
        )

    def test_supersede_registered_never_started_base_drift_recovers_close_crash(self):
        reg = self.register()
        self.advance_remote_main_disjoint("registered-never-started-crash")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        with patch.object(
            route, "close_registration", side_effect=RuntimeError("close crash")
        ):
            with self.assertRaisesRegex(RuntimeError, "close crash"):
                self.supersede(reg, evidence_path)
        current, _ = route._read_registration(
            self.control, reg["registration_id"]
        )
        self.assertEqual(current["state"], "REVOKED")
        self.assertEqual(
            current["registered_base_drift_retirement"]["outcome"],
            "NEVER_PUBLISHED_CONFIRMED_ABSENT",
        )
        with patch.object(route, "_run_supersede_send_pack") as send_pack:
            result = self.supersede(current, evidence_path)
        send_pack.assert_not_called()
        self.assertEqual(result["state"], "CLOSED")

    def test_supersede_registered_never_started_rejects_metadata(self):
        reg = self.register()
        self.advance_remote_main_disjoint("registered-never-started-metadata")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        previous = None
        values = (
            ("current_nonce", "nonce"),
            ("current_lease_sha256", "a" * 64),
            ("current_push_kind", "TASK_REF"),
            ("last_settlement", {"path": "/tmp/settlement"}),
            ("last_settlement_outcome", "FAILED"),
        )
        for key, value in values:
            updates = {key: value}
            if previous is not None:
                updates[previous] = None
            reg = route._state_transition(
                self.control,
                reg["registration_id"],
                {"REGISTERED"},
                "REGISTERED",
                updates,
                expected_version=reg["state_version"],
            )
            with self.subTest(key=key):
                with self.assertRaisesRegex(
                    RuntimeError, f"NEVER_STARTED_METADATA_PRESENT:{key}"
                ):
                    self.supersede(reg, evidence_path)
            previous = key

    def test_supersede_registered_never_started_rejects_local_history(self):
        reg = self.register()
        self.advance_remote_main_disjoint("registered-never-started-history")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        rid = reg["registration_id"]
        for namespace in ("armed", "consumed", "cancelled"):
            with self.subTest(namespace=namespace):
                path = route._lease_dir(self.control, rid, namespace)
                path.mkdir(parents=True, exist_ok=True)
                marker = path / "history.json"
                marker.write_text("{}")
                expected = (
                    "SUPERSEDE_ARMED_LEASE_PRESENT"
                    if namespace == "armed"
                    else "NEVER_STARTED_LEASE_HISTORY"
                )
                with self.assertRaisesRegex(RuntimeError, expected):
                    self.supersede(reg, evidence_path)
                marker.unlink()
        for kind in ("attempts", "settlements"):
            with self.subTest(kind=kind):
                path = route._root_dir(self.control) / kind / rid
                path.mkdir(parents=True, exist_ok=True)
                marker = path / "history.json"
                marker.write_text("{}")
                with self.assertRaisesRegex(
                    RuntimeError, "NEVER_STARTED_.*_PRESENT"
                ):
                    self.supersede(reg, evidence_path)
                marker.unlink()

    def test_supersede_registered_never_started_rejects_event_history(self):
        reg = self.register()
        self.advance_remote_main_disjoint("registered-never-started-events")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        events = route._events_path(self.control, reg["registration_id"])
        original = events.read_bytes()
        event = json.loads(original)
        mismatched = dict(event, candidate="0" * 40)
        cases = (
            original + b"{}\n",
            b"{\n",
            route._canonical_bytes(mismatched),
        )
        try:
            for raw in cases:
                with self.subTest(raw=raw[:20]):
                    events.write_bytes(raw)
                    with self.assertRaisesRegex(
                        RuntimeError, "NEVER_STARTED_EVENT_HISTORY_INVALID"
                    ):
                        self.supersede(reg, evidence_path)
        finally:
            events.write_bytes(original)

    def test_supersede_registered_never_started_rejects_present_or_foreign_ref(self):
        reg = self.register()
        self.advance_remote_main_disjoint("registered-never-started-ref")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        ref = reg["core"]["task_ref"]
        self.git(
            self.source,
            "--git-dir",
            str(self.remote),
            "fetch",
            str(self.work),
            self.head,
        )
        for oid in (self.head, self.base):
            with self.subTest(oid=oid):
                self.git(
                    self.source,
                    "--git-dir",
                    str(self.remote),
                    "update-ref",
                    ref,
                    oid,
                )
                with self.assertRaisesRegex(
                    RuntimeError, "SUPERSEDE_REGISTERED_TASK_REF_PRESENT"
                ):
                    self.supersede(reg, evidence_path)
                current, _ = route._read_registration(
                    self.control, reg["registration_id"]
                )
                self.assertEqual(current["state"], "REGISTERED")
        self.git(
            self.source,
            "--git-dir",
            str(self.remote),
            "update-ref",
            "-d",
            ref,
        )

    def test_supersede_registered_never_started_rejects_remote_main_unavailable(self):
        reg = self.register()
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        with patch.object(
            route, "_remote_oid_target", return_value=route.ZERO_OID
        ):
            with self.assertRaisesRegex(
                RuntimeError, "SUPERSEDE_REGISTERED_REMOTE_MAIN_UNAVAILABLE"
            ):
                self.supersede(reg, evidence_path)

    def test_supersede_registered_never_started_remote_lookup_errors_leave_state_unchanged(self):
        reg = self.register()
        advanced_main = self.advance_remote_main_disjoint(
            "registered-never-started-lookup-error"
        )
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        scenarios = (
            (
                "remote-main",
                route.PublicationError("GIT_FAILED: injected remote-main lookup"),
            ),
            (
                "task-ref",
                [
                    advanced_main,
                    route.PublicationError("GIT_FAILED: injected task-ref lookup"),
                ],
            ),
        )
        for name, side_effect in scenarios:
            with self.subTest(name=name):
                with (
                    patch.object(
                        route, "_remote_oid_target", side_effect=side_effect
                    ),
                    patch.object(route, "_run_supersede_send_pack") as send_pack,
                ):
                    with self.assertRaisesRegex(RuntimeError, "GIT_FAILED"):
                        self.supersede(reg, evidence_path)
                current, _ = route._read_registration(
                    self.control, reg["registration_id"]
                )
                self.assertEqual(current["state"], "REGISTERED")
                self.assertEqual(current["state_version"], reg["state_version"])
                send_pack.assert_not_called()

    def test_supersede_ready_after_base_drift_deletes_exact_ref_without_main_mutation(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        advanced_main = self.advance_remote_main_disjoint("ready-exact")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        ref = reg["core"]["task_ref"]

        with self.assertRaisesRegex(RuntimeError, "REMOTE_MAIN_BASE_DRIFT"):
            route._push_operation(self.control, reg["registration_id"], "MAIN")
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "READY")
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), advanced_main)
        self.assertEqual(route._remote_oid(self.work, "origin", ref), self.head)

        result = self.supersede(current, evidence_path)
        self.assertEqual(result["state"], "CLOSED")
        self.assertEqual(result["task_ref_cleanup_status"], "DELETED")
        self.assertIsNone(result["ready_receipt"])
        self.assertEqual(
            result["ready_base_drift_retirement"],
            {
                "registered_base": self.base,
                "observed_remote_main": advanced_main,
                "observed_at": result["superseded_at"],
            },
        )
        self.assertEqual(route._remote_oid(self.work, "origin", ref), route.ZERO_OID)
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), advanced_main)

    def test_supersede_ready_base_drift_absent_or_foreign_ref_never_deletes_foreign(self):
        for disposition in ["absent", "foreign"]:
            with self.subTest(disposition=disposition):
                self.git(
                    self.source,
                    "--git-dir",
                    str(self.remote),
                    "update-ref",
                    "refs/heads/main",
                    self.base,
                )
                self.git(self.source, "update-ref", "refs/remotes/origin/main", self.base)
                reg = self.register()
                reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
                reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
                advanced_main = self.advance_remote_main_disjoint(f"ready-{disposition}")
                evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
                ref = reg["core"]["task_ref"]
                if disposition == "absent":
                    self.set_remote(ref, route.ZERO_OID)
                    expected_ref = route.ZERO_OID
                else:
                    self.git(
                        self.source,
                        "--git-dir",
                        str(self.remote),
                        "update-ref",
                        ref,
                        self.base,
                    )
                    expected_ref = self.base

                with patch.object(route, "_run_supersede_send_pack") as send_pack:
                    result = self.supersede(reg, evidence_path)

                send_pack.assert_not_called()
                self.assertEqual(result["state"], "CLOSED")
                self.assertEqual(
                    result["task_ref_cleanup_status"],
                    "ALREADY_ABSENT" if disposition == "absent" else "FOREIGN_RETAINED",
                )
                self.assertIsNone(result["ready_receipt"])
                self.assertEqual(route._remote_oid(self.work, "origin", ref), expected_ref)
                self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), advanced_main)

    def test_supersede_ready_hook_rechecks_remote_main_after_lease_before_delete(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        advanced_main = self.advance_remote_main_disjoint("ready-hook-main")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        captured = {}

        def stop_before_send(root, current, lease, timeout_seconds):
            captured["reg"] = current
            captured["lease"] = lease
            raise RuntimeError("fixture-stop-before-send")

        with patch.object(route, "_run_supersede_send_pack", side_effect=stop_before_send):
            with self.assertRaisesRegex(RuntimeError, "fixture-stop-before-send"):
                self.supersede(reg, evidence_path)

        current = captured["reg"]
        lease = captured["lease"]
        self.assertEqual(current["state"], "SUPERSEDING_TASK_REF")
        self.assertEqual(
            route._lease_namespace(
                self.control, current["registration_id"], lease["nonce"]
            )[0],
            "armed",
        )
        self.git(
            self.source,
            "--git-dir",
            str(self.remote),
            "update-ref",
            "refs/heads/main",
            self.head,
        )
        bundle = current["supersede_bundle"]
        env = dict(
            os.environ,
            OCTOPORT_PUBLICATION_CONTROL_ROOT=str(self.control),
            OCTOPORT_PUBLICATION_REGISTRATION_ID=current["registration_id"],
            OCTOPORT_PUBLICATION_NONCE=lease["nonce"],
            OCTOPORT_PUBLICATION_KIND="SUPERSEDE_TASK_REF",
            OCTOPORT_PUBLICATION_BUNDLE_MANIFEST_SHA256=bundle["sha256"],
        )
        hook = str(Path(bundle["path"]) / "hooks/pre-push")
        row = (
            f"(delete) {route.ZERO_OID} {lease['remote_ref']} "
            f"{lease['expected_remote_old_oid']}\n"
        )
        proc = subprocess.run(
            [hook, current["core"]["push_target"], current["core"]["push_target"]],
            cwd=self.work,
            env=env,
            input=row,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("SUPERSEDE_READY_REMOTE_MAIN_DRIFT", proc.stderr)
        self.assertEqual(
            route._lease_namespace(
                self.control, current["registration_id"], lease["nonce"]
            )[0],
            "armed",
        )
        self.assertEqual(
            route._remote_oid_target(
                self.work, current["core"]["push_target"], current["core"]["task_ref"]
            ),
            self.head,
        )
        self.assertEqual(
            route._remote_oid_target(
                self.work, current["core"]["push_target"], "refs/heads/main"
            ),
            self.head,
        )
        self.assertEqual(
            current["ready_base_drift_retirement"]["observed_remote_main"],
            advanced_main,
        )

    def test_supersede_ready_hook_rechecks_config_after_lease_before_delete(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        self.advance_remote_main_disjoint("ready-hook-config")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        captured = {}

        def stop_before_send(root, current, lease, timeout_seconds):
            captured["reg"] = current
            captured["lease"] = lease
            raise RuntimeError("fixture-stop-before-send")

        with patch.object(route, "_run_supersede_send_pack", side_effect=stop_before_send):
            with self.assertRaisesRegex(RuntimeError, "fixture-stop-before-send"):
                self.supersede(reg, evidence_path)

        current = captured["reg"]
        lease = captured["lease"]
        self.git(
            self.work, "config", "--worktree", "core.hooksPath", "drifted-after-lease"
        )
        bundle = current["supersede_bundle"]
        env = dict(
            os.environ,
            OCTOPORT_PUBLICATION_CONTROL_ROOT=str(self.control),
            OCTOPORT_PUBLICATION_REGISTRATION_ID=current["registration_id"],
            OCTOPORT_PUBLICATION_NONCE=lease["nonce"],
            OCTOPORT_PUBLICATION_KIND="SUPERSEDE_TASK_REF",
            OCTOPORT_PUBLICATION_BUNDLE_MANIFEST_SHA256=bundle["sha256"],
        )
        hook = str(Path(bundle["path"]) / "hooks/pre-push")
        row = (
            f"(delete) {route.ZERO_OID} {lease['remote_ref']} "
            f"{lease['expected_remote_old_oid']}\n"
        )
        proc = subprocess.run(
            [hook, current["core"]["push_target"], current["core"]["push_target"]],
            cwd=self.work,
            env=env,
            input=row,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("ROUTE_CONFIG_SAME_KEY_DRIFT:core.hooksPath", proc.stderr)
        self.assertEqual(
            route._lease_namespace(
                self.control, current["registration_id"], lease["nonce"]
            )[0],
            "armed",
        )
        self.assertEqual(
            route._remote_oid_target(
                self.work, current["core"]["push_target"], current["core"]["task_ref"]
            ),
            self.head,
        )

    def test_supersede_ready_requires_real_base_drift_and_rejects_candidate_main(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        with self.assertRaisesRegex(RuntimeError, "SUPERSEDE_READY_REMOTE_MAIN_UNCHANGED"):
            self.supersede(reg, evidence_path)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "READY")
        self.assertIsNotNone(current["ready_receipt"])

        self.git(
            self.source,
            "--git-dir",
            str(self.remote),
            "update-ref",
            "refs/heads/main",
            self.head,
        )
        with self.assertRaisesRegex(RuntimeError, "SUPERSEDE_READY_CANDIDATE_IS_MAIN"):
            self.supersede(current, evidence_path)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "READY")
        self.assertEqual(route._remote_oid(self.work, "origin", current["core"]["task_ref"]), self.head)
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), self.head)

    def test_supersede_ready_config_drift_fails_before_task_ref_mutation(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        advanced_main = self.advance_remote_main_disjoint("ready-config-drift")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        ref = reg["core"]["task_ref"]
        self.git(self.work, "config", "--worktree", "core.hooksPath", "drifted-ready-route")

        with self.assertRaisesRegex(RuntimeError, "ROUTE_CONFIG_SAME_KEY_DRIFT:core.hooksPath"):
            self.supersede(reg, evidence_path)

        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "READY")
        self.assertIsNotNone(current["ready_receipt"])
        self.assertEqual(route._remote_oid(self.work, "origin", ref), self.head)
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), advanced_main)

    def test_supersede_ready_revalidates_config_at_deletion_boundary(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        advanced_main = self.advance_remote_main_disjoint("ready-config-boundary")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        ref = reg["core"]["task_ref"]
        original = route._validate_ready_retirement_config
        calls = 0

        def revalidate(current):
            nonlocal calls
            calls += 1
            if calls == 1:
                return original(current)
            raise route.PublicationError("ROUTE_CONFIG_SAME_KEY_DRIFT:core.hooksPath")

        with (
            patch.object(route, "_validate_ready_retirement_config", side_effect=revalidate),
            patch.object(route, "_run_supersede_send_pack") as send_pack,
        ):
            with self.assertRaisesRegex(
                RuntimeError, "ROUTE_CONFIG_SAME_KEY_DRIFT:core.hooksPath"
            ):
                self.supersede(reg, evidence_path)

        send_pack.assert_not_called()
        self.assertEqual(calls, 2)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "TASK_REF_PUBLISHED")
        self.assertIsNone(current["ready_receipt"])
        self.assertEqual(route._remote_oid(self.work, "origin", ref), self.head)
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), advanced_main)
        self.assertTrue(route._no_armed_leases(self.control, reg["registration_id"]))

    def test_supersede_ready_revalidates_remote_main_at_deletion_boundary(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        advanced_main = self.advance_remote_main_disjoint("ready-main-boundary")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        ref = reg["core"]["task_ref"]
        original_install = route._install_bundle

        def drift_main(*args, **kwargs):
            self.git(
                self.source,
                "--git-dir",
                str(self.remote),
                "update-ref",
                "refs/heads/main",
                self.head,
            )
            return original_install(*args, **kwargs)

        with (
            patch.object(route, "_install_bundle", side_effect=drift_main),
            patch.object(route, "_run_supersede_send_pack") as send_pack,
        ):
            with self.assertRaisesRegex(RuntimeError, "SUPERSEDE_READY_REMOTE_MAIN_DRIFT"):
                self.supersede(reg, evidence_path)

        send_pack.assert_not_called()
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "TASK_REF_PUBLISHED")
        self.assertIsNone(current["ready_receipt"])
        self.assertEqual(current["ready_base_drift_retirement"]["observed_remote_main"], advanced_main)
        self.assertEqual(route._remote_oid(self.work, "origin", ref), self.head)
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), self.head)
        self.assertTrue(route._no_armed_leases(self.control, reg["registration_id"]))

    def test_supersede_exact_ref_ignores_successor_task_fingerprint_and_is_idempotent(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        evidence_path, value, support = self.supersede_evidence(reg)
        old_state = route._root_dir(self.control) / "states" / reg["registration_id"] / f"{reg['state_version']}.json"
        old_state_bytes = old_state.read_bytes()
        old_settlement = Path(reg["last_settlement"])
        old_settlement_bytes = old_settlement.read_bytes()
        main_before = route._remote_oid(self.work, "origin", "refs/heads/main")
        self.task["result"] = "reviewed successor changed the live task fingerprint"
        self.save_board()
        result = self.supersede(reg, evidence_path)
        self.assertEqual(result["state"], "CLOSED")
        self.assertEqual(result["task_ref_cleanup_status"], "DELETED")
        self.assertEqual(route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]), route.ZERO_OID)
        self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), main_before)
        self.assertEqual(result["supersede_evidence"]["sha256"], route._sha_file(evidence_path))
        self.assertEqual(old_state.read_bytes(), old_state_bytes)
        self.assertEqual(old_settlement.read_bytes(), old_settlement_bytes)
        before = route._registration_path(self.control, reg["registration_id"]).read_bytes()
        self.assertEqual(self.supersede(result, evidence_path)["state"], "CLOSED")
        self.assertEqual(route._registration_path(self.control, reg["registration_id"]).read_bytes(), before)

    def test_supersede_absent_or_foreign_ref_records_truth_without_replacing_ref(self):
        for disposition in ["absent", "foreign"]:
            with self.subTest(disposition=disposition):
                reg = self.register()
                reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
                evidence_path, _, _ = self.supersede_evidence(reg)
                ref = reg["core"]["task_ref"]
                if disposition == "absent":
                    self.set_remote(ref, route.ZERO_OID)
                else:
                    # The base object already exists in the disposable bare remote
                    # from setUp. Inject only the foreign ref state; do not try to
                    # publish it through the guarded candidate hook under test.
                    self.git(self.source, "--git-dir", str(self.remote), "update-ref", ref, self.base)
                result = self.supersede(reg, evidence_path)
                self.assertEqual(result["state"], "CLOSED")
                expected = "ALREADY_ABSENT" if disposition == "absent" else "FOREIGN_RETAINED"
                self.assertEqual(result["task_ref_cleanup_status"], expected)
                self.assertEqual(
                    route._remote_oid_target(self.work, reg["core"]["push_target"], ref),
                    route.ZERO_OID if disposition == "absent" else self.base,
                )
                self.assertEqual(route._remote_oid(self.work, "origin", "refs/heads/main"), self.base)

    def test_supersede_deletes_exact_ref_but_close_preserves_route_config_drift(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        evidence_path, _, _ = self.supersede_evidence(reg)
        self.git(self.work, "config", "--worktree", "core.hooksPath", "changed-by-successor")
        with self.assertRaisesRegex(RuntimeError, "SAME_KEY_DRIFT"):
            self.supersede(reg, evidence_path)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "REVOKED")
        self.assertEqual(current["task_ref_cleanup_status"], "DELETED")
        self.assertEqual(route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]), route.ZERO_OID)
        self.assertEqual(route._config_values(self.work, "core.hooksPath")["values"], ["changed-by-successor"])
        route._set_config_values(self.work, "core.hooksPath", reg["installed_config"]["core.hooksPath"])
        self.assertEqual(route.close_registration(self.control, reg["registration_id"])["state"], "CLOSED")

    def test_close_allows_append_only_normal_branch_tracking_sections(self):
        reg = self.register()
        reg = route._state_transition(
            self.control, reg["registration_id"], {"REGISTERED"}, "REVOKED"
        )
        self.git(self.work, "config", "branch.later-worktree.remote", "origin")
        self.git(
            self.work, "config", "branch.later-worktree.merge", "refs/heads/main"
        )
        self.git(self.work, "config", "branch.second-worktree.remote", "origin")
        self.git(
            self.work, "config", "branch.second-worktree.merge", "refs/heads/main"
        )
        self.assertNotEqual(
            route._common_config_digest(self.work), reg["core"]["common_config_sha256"]
        )
        self.assertTrue(
            route._common_config_matches_registered(
                self.work, reg["core"]["common_config_sha256"]
            )
        )
        self.assertEqual(
            route.close_registration(self.control, reg["registration_id"])["state"],
            "CLOSED",
        )

    def test_close_rejects_branch_suffix_with_nontracking_key(self):
        reg = self.register()
        reg = route._state_transition(
            self.control, reg["registration_id"], {"REGISTERED"}, "REVOKED"
        )
        self.git(self.work, "config", "branch.later-worktree.remote", "origin")
        self.git(
            self.work, "config", "branch.later-worktree.merge", "refs/heads/main"
        )
        self.git(
            self.work, "config", "branch.later-worktree.pushRemote", "unexpected"
        )
        self.assertFalse(
            route._common_config_matches_registered(
                self.work, reg["core"]["common_config_sha256"]
            )
        )
        with self.assertRaisesRegex(RuntimeError, "COMMON_CONFIG_DRIFT"):
            route.close_registration(self.control, reg["registration_id"])

    def test_close_rejects_empty_branch_tracking_values(self):
        reg = self.register()
        reg = route._state_transition(
            self.control, reg["registration_id"], {"REGISTERED"}, "REVOKED"
        )
        for key in ["remote", "merge"]:
            with self.subTest(key=key):
                other = "merge" if key == "remote" else "remote"
                other_value = "refs/heads/main" if other == "merge" else "origin"
                self.git(self.work, "config", f"branch.empty-{key}.{other}", other_value)
                self.git(self.work, "config", f"branch.empty-{key}.{key}", "")
                self.assertFalse(
                    route._common_config_matches_registered(
                        self.work, reg["core"]["common_config_sha256"]
                    )
                )
                with self.assertRaisesRegex(RuntimeError, "COMMON_CONFIG_DRIFT"):
                    route.close_registration(self.control, reg["registration_id"])
                self.git(
                    self.work, "config", "--remove-section", f"branch.empty-{key}"
                )
        self.assertEqual(
            route.close_registration(self.control, reg["registration_id"])["state"],
            "CLOSED",
        )

    def test_close_rejects_preexisting_common_config_edit_before_safe_branch_suffix(self):
        self.git(self.work, "config", "octoport.fixture", "before")
        reg = self.register()
        reg = route._state_transition(
            self.control, reg["registration_id"], {"REGISTERED"}, "REVOKED"
        )
        self.git(self.work, "config", "octoport.fixture", "after")
        self.git(self.work, "config", "branch.later-worktree.remote", "origin")
        self.git(
            self.work, "config", "branch.later-worktree.merge", "refs/heads/main"
        )
        self.assertFalse(
            route._common_config_matches_registered(
                self.work, reg["core"]["common_config_sha256"]
            )
        )
        with self.assertRaisesRegex(RuntimeError, "COMMON_CONFIG_DRIFT"):
            route.close_registration(self.control, reg["registration_id"])

    def test_supersede_ignores_local_url_rewrite_for_transport_then_close_blocks_on_drift(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        evidence_path, _, _ = self.supersede_evidence(reg)
        foreign = self.root / "foreign.git"
        self.git(self.source, "init", "--bare", str(foreign))
        self.git(self.source, "push", str(foreign), f"{self.head}:{reg['core']['task_ref']}")
        main_before = route._remote_oid(self.work, "origin", "refs/heads/main")
        self.git(
            self.work, "config", f"url.{foreign}.pushInsteadOf", str(self.remote)
        )
        # Direct send-pack uses the immutable captured target and therefore deletes
        # only the original stale task ref. Ordinary close remains fail-closed on
        # the changed common config and leaves the registration REVOKED.
        with self.assertRaisesRegex(RuntimeError, "COMMON_CONFIG_DRIFT"):
            self.supersede(reg, evidence_path)
        original = subprocess.run(
            ["git", "--git-dir", str(self.remote), "rev-parse", "--verify", reg["core"]["task_ref"]],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.assertNotEqual(original.returncode, 0)
        self.assertEqual(
            self.git(self.source, "--git-dir", str(foreign), "rev-parse", reg["core"]["task_ref"]),
            self.head,
        )
        self.assertEqual(
            self.git(self.source, "--git-dir", str(self.remote), "rev-parse", "refs/heads/main"),
            main_before,
        )
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "REVOKED")
        self.assertEqual(current["task_ref_cleanup_status"], "DELETED")

    def test_direct_send_pack_ignores_local_insteadof_rewrite(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        ref = reg["core"]["task_ref"]
        target = reg["core"]["push_target"]
        foreign = self.root / "foreign-insteadof.git"
        self.git(self.source, "init", "--bare", str(foreign))
        main_before = self.git(
            self.source, "--git-dir", str(self.remote), "rev-parse", "refs/heads/main"
        )
        self.git(self.work, "config", f"url.{foreign}.insteadOf", str(self.remote))
        proc = subprocess.run(
            [
                "git", "-C", str(self.work), "-c", "core.sshCommand=ssh", "send-pack",
                "--helper-status", f"--force-with-lease={ref}:{self.head}", target, f":{ref}",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=route._supersede_transport_env(),
        )
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        original = subprocess.run(
            ["git", "--git-dir", str(self.remote), "rev-parse", "--verify", ref],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        redirected = subprocess.run(
            ["git", "--git-dir", str(foreign), "rev-parse", "--verify", ref],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.assertNotEqual(original.returncode, 0)
        self.assertNotEqual(redirected.returncode, 0)
        self.assertEqual(
            self.git(self.source, "--git-dir", str(self.remote), "rev-parse", "refs/heads/main"),
            main_before,
        )

    def test_supersede_transport_ignores_new_global_pushinstead_and_preserves_foreign(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        evidence_path, _, _ = self.supersede_evidence(reg)
        foreign = self.root / "global-foreign.git"
        self.git(self.source, "init", "--bare", str(foreign))
        self.git(self.source, "push", str(foreign), f"{self.head}:{reg['core']['task_ref']}")
        global_config = Path(os.environ["GIT_CONFIG_GLOBAL"])
        subprocess.check_call([
            "git", "config", "--file", str(global_config),
            f"url.{foreign}.pushInsteadOf", str(self.remote),
        ])
        # The supersede transport deliberately ignores changed global Git config,
        # so deletion reaches the immutable captured target.  Ordinary close then
        # refuses to restore route config because the global config digest drifted.
        with self.assertRaisesRegex(RuntimeError, "GLOBAL_CONFIG_DRIFT"):
            self.supersede(reg, evidence_path)
        original = subprocess.run(
            ["git", "--git-dir", str(self.remote), "rev-parse", "--verify", reg["core"]["task_ref"]],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
        )
        self.assertNotEqual(original.returncode, 0)
        self.assertEqual(
            self.git(self.source, "--git-dir", str(foreign), "rev-parse", reg["core"]["task_ref"]),
            self.head,
        )
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "REVOKED")
        self.assertEqual(current["task_ref_cleanup_status"], "DELETED")

    def test_supersede_recovery_after_dead_child_needs_no_config_lock_reclamation(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        evidence_path, _, _ = self.supersede_evidence(reg)
        evidence = route._validate_supersede_evidence(
            self.control, reg, str(evidence_path), route._sha_file(evidence_path)
        )
        bundle, bundle_sha = route._install_bundle(
            self.control, self.source, self.base, route._tree(self.source)
        )
        with route._role_and_coord_locks(self.control, "C"):
            reg, lease = route._prepare_supersede_push_locked(
                self.control, reg, evidence, bundle, bundle_sha, 120
            )
        armed = route._lease_path(
            self.control, reg["registration_id"], "armed", lease["nonce"]
        )
        self.assertTrue(route._rename_noreplace(
            armed,
            route._lease_path(self.control, reg["registration_id"], "consumed", lease["nonce"]),
        ))
        attempt_path = route._attempt_path(self.control, reg["registration_id"], lease["nonce"])
        attempt = route._load_json(attempt_path)
        attempt.update(pid=999999999, proc_start_time="1", wait_outcome="EXITED", exit_code=0)
        route._attempt_update(attempt_path, attempt)
        self.git(
            self.source, "--git-dir", str(self.remote), "update-ref", "-d", reg["core"]["task_ref"]
        )
        result = route.recover_registration(self.control, reg["registration_id"])
        self.assertEqual(result["state"], "REVOKED")
        self.assertEqual(result["task_ref_cleanup_status"], "DELETED")
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            route.ZERO_OID,
        )

    def test_supersede_does_not_reclaim_foreign_git_config_lock(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        evidence_path, _, _ = self.supersede_evidence(reg)
        common = Path(self.git(self.work, "rev-parse", "--git-common-dir"))
        if not common.is_absolute():
            common = (self.work / common).resolve()
        lock_path = common / "config.lock"
        raw = "foreign git config lock\n"
        lock_path.write_text(raw)
        try:
            result = self.supersede(reg, evidence_path)
            self.assertTrue(lock_path.exists())
            self.assertEqual(lock_path.read_text(), raw)
            self.assertEqual(result["state"], "CLOSED")
            self.assertEqual(result["task_ref_cleanup_status"], "DELETED")
            self.assertEqual(
                route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
                route.ZERO_OID,
            )
        finally:
            lock_path.unlink(missing_ok=True)

    def test_process_identity_read_error_is_unknown_not_dead(self):
        with patch.object(Path, "read_text", side_effect=PermissionError("denied")):
            self.assertIsNone(route._process_alive(12345, "7"))

    def test_review_drift_retirement_deletes_only_exact_task_ref_and_closes(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        main_before = self.git(self.source, "--git-dir", str(self.remote), "rev-parse", "refs/heads/main")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, _, _ = self.review_drift_evidence(reg, successor="a" * 40)
        result = self.supersede(reg, evidence_path)
        self.assertEqual(result["state"], "CLOSED")
        self.assertEqual(result["task_ref_cleanup_status"], "DELETED")
        self.assertTrue(result["supersede_evidence"]["review_drift_retirement"])
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            route.ZERO_OID,
        )
        self.assertEqual(
            self.git(self.source, "--git-dir", str(self.remote), "rev-parse", "refs/heads/main"),
            main_before,
        )

    def test_normal_supersede_still_rejects_drifted_registered_review(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        evidence_path, _, _ = self.supersede_evidence(reg, verdict="FAIL")
        self.review.write_text('{"drifted_after_task_ref":true}')
        with self.assertRaisesRegex(RuntimeError, "REVIEW_HASH_MISMATCH"):
            self.supersede(reg, evidence_path)
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.head,
        )

    def test_review_drift_retirement_requires_real_exact_hash_drift_and_blocked_task(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        matching_path, _, _ = self.review_drift_evidence(reg)
        with self.assertRaisesRegex(RuntimeError, "REVIEW_DRIFT_NOT_PRESENT"):
            self.supersede(reg, matching_path)

        self.review.write_text('{"drifted_after_task_ref":true}')
        correct_path, correct, _ = self.review_drift_evidence(reg)
        wrong_observed = copy.deepcopy(correct)
        wrong_observed["observed_review_sha256"] = "f" * 64
        correct_path.write_text(json.dumps(wrong_observed))
        with self.assertRaisesRegex(RuntimeError, "REVIEW_DRIFT_OBSERVED_HASH_MISMATCH"):
            self.supersede(reg, correct_path)

        wrong_expected = copy.deepcopy(correct)
        wrong_expected["expected_review"] = dict(wrong_expected["expected_review"])
        wrong_expected["expected_review"]["sha256"] = "e" * 64
        correct_path.write_text(json.dumps(wrong_expected))
        with self.assertRaisesRegex(RuntimeError, "REVIEW_DRIFT_EXPECTED_REVIEW_MISMATCH"):
            self.supersede(reg, correct_path)

        correct_path.write_text(json.dumps(correct))
        self.mark_task_in_progress()
        with self.assertRaisesRegex(RuntimeError, "REVIEW_DRIFT_TASK_MUST_BE_BLOCKED"):
            self.supersede(reg, correct_path)
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.head,
        )

    def test_review_drift_retirement_requires_exact_schema_and_integer_version(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, value, _ = self.review_drift_evidence(reg)

        cases = [
            ("extra key", dict(value, unexpected_field="forbidden"),
             "REVIEW_DRIFT_EVIDENCE_SCHEMA_INVALID"),
            ("boolean version", dict(value, version=True),
             "REVIEW_DRIFT_EVIDENCE_VERSION_INVALID"),
            ("string version", dict(value, version="1"),
             "REVIEW_DRIFT_EVIDENCE_VERSION_INVALID"),
        ]
        for label, invalid, error in cases:
            with self.subTest(label=label):
                evidence_path.write_text(json.dumps(invalid))
                with self.assertRaisesRegex(RuntimeError, error):
                    self.supersede(reg, evidence_path)

        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "TASK_REF_PUBLISHED")
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.head,
        )

    def test_review_drift_retirement_requires_supporting_evidence(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, value, _ = self.review_drift_evidence(reg)
        value["evidence"] = []
        evidence_path.write_text(json.dumps(value))
        with self.assertRaisesRegex(RuntimeError, "SUPERSEDE_SUPPORTING_EVIDENCE_REQUIRED"):
            self.supersede(reg, evidence_path)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "TASK_REF_PUBLISHED")
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.head,
        )

    def test_review_drift_retirement_rejects_wrong_or_missing_registered_review_path(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, value, _ = self.review_drift_evidence(reg)

        wrong_path = copy.deepcopy(value)
        wrong_path["expected_review"] = dict(wrong_path["expected_review"])
        wrong_path["expected_review"]["path"] = str(self.control / "logs/wrong-review.json")
        evidence_path.write_text(json.dumps(wrong_path))
        with self.assertRaisesRegex(RuntimeError, "REVIEW_DRIFT_EXPECTED_REVIEW_MISMATCH"):
            self.supersede(reg, evidence_path)

        evidence_path.write_text(json.dumps(value))
        self.review.unlink()
        with self.assertRaisesRegex(RuntimeError, "CONTROL_EVIDENCE_REQUIRED"):
            self.supersede(reg, evidence_path)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "TASK_REF_PUBLISHED")
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.head,
        )

    def test_review_drift_retirement_rejects_ready_board_state(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.task["state"] = "READY"
        self.save_board()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, _, _ = self.review_drift_evidence(reg)
        with self.assertRaisesRegex(RuntimeError, "REVIEW_DRIFT_TASK_MUST_BE_BLOCKED"):
            self.supersede(reg, evidence_path)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "TASK_REF_PUBLISHED")
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.head,
        )

    def test_review_drift_retirement_requires_task_ref_published_registration(self):
        reg = self.register()
        self.mark_task_blocked()
        self.review.write_text('{"drifted_before_task_ref":true}')
        evidence_path, _, _ = self.review_drift_evidence(reg)
        with self.assertRaisesRegex(RuntimeError, "REVIEW_DRIFT_RETIREMENT_PRESTATE_INVALID"):
            self.supersede(reg, evidence_path)
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "REGISTERED")

    def test_review_drift_retirement_closes_when_exact_task_ref_is_already_absent(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, _, _ = self.review_drift_evidence(reg)
        self.git(
            self.source, "--git-dir", str(self.remote), "update-ref", "-d", reg["core"]["task_ref"]
        )
        result = self.supersede(reg, evidence_path)
        self.assertEqual(result["state"], "CLOSED")
        self.assertEqual(result["task_ref_cleanup_status"], "ALREADY_ABSENT")
        self.assertEqual(self.supersede(result, evidence_path)["state"], "CLOSED")

    def test_review_drift_retirement_closed_replay_does_not_depend_on_later_board_state(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, _, _ = self.review_drift_evidence(reg)
        result = self.supersede(reg, evidence_path)
        self.assertEqual(result["state"], "CLOSED")
        self.mark_task_in_progress()
        replay = self.supersede(result, evidence_path)
        self.assertEqual(replay["state"], "CLOSED")
        self.assertEqual(replay["supersede_evidence"]["sha256"], route._sha_file(evidence_path))

    def test_review_drift_retirement_rejects_foreign_ref_and_dirty_candidate(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, _, _ = self.review_drift_evidence(reg)
        self.git(
            self.source, "--git-dir", str(self.remote), "update-ref",
            reg["core"]["task_ref"], self.base,
        )
        with self.assertRaisesRegex(RuntimeError, "REVIEW_DRIFT_RETIREMENT_FOREIGN_TASK_REF"):
            self.supersede(reg, evidence_path)
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.base,
        )
        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "TASK_REF_PUBLISHED")

        self.git(
            self.source, "--git-dir", str(self.remote), "update-ref",
            reg["core"]["task_ref"], self.head,
        )
        (self.work / "product.txt").write_text("dirty candidate\n")
        with self.assertRaisesRegex(RuntimeError, "WORKTREE_DIRTY"):
            self.supersede(reg, evidence_path)
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.head,
        )

    def test_review_drift_retirement_config_drift_fails_before_task_ref_mutation(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, _, _ = self.review_drift_evidence(reg)
        ref = reg["core"]["task_ref"]
        self.git(self.work, "config", "--worktree", "core.hooksPath", "drifted-review-route")

        with self.assertRaisesRegex(RuntimeError, "ROUTE_CONFIG_SAME_KEY_DRIFT:core.hooksPath"):
            self.supersede(reg, evidence_path)

        current, _ = route._read_registration(self.control, reg["registration_id"])
        self.assertEqual(current["state"], "TASK_REF_PUBLISHED")
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], ref),
            self.head,
        )

    def test_review_drift_retirement_preserves_manifest_binding(self):
        manifest_path, _ = self.manifest()
        self.write_review(route._sha_file(manifest_path))
        reg = self.register(manifest_path=str(manifest_path), manifest_sha=route._sha_file(manifest_path))
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        self.mark_task_blocked()
        self.review.write_text('{"drifted_after_task_ref":true}')
        evidence_path, _, _ = self.review_drift_evidence(reg)
        manifest_path.write_text(manifest_path.read_text() + "\n")
        with self.assertRaisesRegex(RuntimeError, "ACCEPTED_MANIFEST_HASH_MISMATCH"):
            self.supersede(reg, evidence_path)
        self.assertEqual(
            route._remote_oid_target(self.work, reg["core"]["push_target"], reg["core"]["task_ref"]),
            self.head,
        )

    def test_supersede_rejects_evidence_drift_and_armed_lease_then_preserves_evidence(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        evidence_path, value, support = self.supersede_evidence(reg, verdict="FAIL")
        support_before = support.read_bytes()
        changed = copy.deepcopy(value); changed["candidate_sha"] = self.base
        evidence_path.write_text(json.dumps(changed))
        with self.assertRaisesRegex(RuntimeError, "SUPERSEDE_EVIDENCE_IDENTITY"):
            self.supersede(reg, evidence_path)
        evidence_path.write_text(json.dumps(value))
        armed = route._lease_dir(self.control, reg["registration_id"], "armed")
        armed.mkdir(parents=True, exist_ok=True)
        blocker = armed / "fixture.json"; blocker.write_text("{}")
        with self.assertRaisesRegex(RuntimeError, "SUPERSEDE_ARMED_LEASE_PRESENT"):
            self.supersede(reg, evidence_path)
        blocker.unlink()
        result = self.supersede(reg, evidence_path)
        self.assertEqual(result["state"], "CLOSED")
        self.assertEqual(support.read_bytes(), support_before)
        self.assertEqual(result["supersede_evidence"]["sha256"], route._sha_file(evidence_path))

    def test_simultaneous_cancel_and_consume_have_one_winner(self):
        from concurrent.futures import ThreadPoolExecutor
        source = self.root / "nonce"; source.write_text("immutable lease")
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda name: route._rename_noreplace(source, self.root / name),
                ["cancelled", "consumed"]))
        self.assertEqual(sum(results), 1)
        self.assertEqual(sum((self.root / name).exists() for name in ["cancelled", "consumed"]), 1)

    def test_hook_rechecks_stop_bundle_and_main_ready_before_consume(self):
        reg = self.register()
        reg = route._push_operation(self.control, reg["registration_id"], "TASK_REF")
        reg = route.mark_ready(self.control, reg["registration_id"], self.ci(reg))
        reg, lease, attempt = self.prepared(reg, "MAIN", consume=False)
        env = dict(os.environ, OCTOPORT_PUBLICATION_CONTROL_ROOT=str(self.control),
            OCTOPORT_PUBLICATION_REGISTRATION_ID=reg["registration_id"],
            OCTOPORT_PUBLICATION_NONCE=lease["nonce"], OCTOPORT_PUBLICATION_KIND="MAIN",
            OCTOPORT_PUBLICATION_BUNDLE_MANIFEST_SHA256=reg["core"]["bundle_manifest_sha256"])
        hook = str(Path(reg["core"]["bundle_path"]) / "hooks/pre-push")
        row = f"HEAD {self.head} refs/heads/main {self.base}\n"
        for vector in ["stop", "ready", "bundle"]:
            changed = (self.control / "C.json" if vector == "stop" else
                Path(reg["ready_receipt"]["path"]) if vector == "ready" else
                Path(reg["core"]["bundle_path"]) / "ci_gate.py")
            original = changed.read_bytes()
            changed.write_bytes(b'{"status":"STOPPED"}' if vector == "stop" else original + b"\n")
            p = subprocess.run([hook, "origin", str(self.remote)], cwd=self.work, env=env,
                input=row, capture_output=True, text=True)
            changed.write_bytes(original)
            with self.subTest(vector=vector):
                self.assertNotEqual(p.returncode, 0)
                self.assertEqual(route._lease_namespace(self.control, reg["registration_id"], lease["nonce"])[0], "armed")

    def test_close_crash_after_one_key_restore_can_finish_without_overwriting_drift(self):
        self.git(self.work, "config", "--worktree", "remote.origin.pushurl", "prior")
        reg = self.register(pushurl=str(self.remote))
        reg = route._state_transition(self.control, reg["registration_id"], {"REGISTERED"}, "REVOKED")
        real = route._set_config_values
        def interrupt(worktree, key, value):
            real(worktree, key, value)
            if key == "core.hooksPath": raise OSError("simulated close interruption")
        with patch.object(route, "_set_config_values", side_effect=interrupt), self.assertRaises(OSError):
            route.close_registration(self.control, reg["registration_id"])
        self.assertEqual(route.close_registration(self.control, reg["registration_id"])["state"], "CLOSED")
        self.assertEqual(route._config_values(self.work, "remote.origin.pushurl")["values"], ["prior"])



class LegacyCommonConfigEvidenceShapeTests(unittest.TestCase):
    """Pure parsing regressions, not live bind/close or reviewer authentication."""

    @staticmethod
    def evidence():
        hashes = ["target_registration_id", "target_core_sha256",
                  "registered_common_config_sha256", "global_config_sha256",
                  "anchor_state_sha256", "anchor_close_receipt_sha256",
                  "current_common_config_sha256", "remote_identity_sha256",
                  "push_identity_sha256", "pushurl_identity_sha256"]
        value = {key: "a" * 64 for key in hashes}
        value.update({key: "c" * 40 for key in ["candidate_sha", "candidate_tree",
                     "base_sha", "anchor_candidate_sha", "current_main_sha"]})
        value.update(kind="octoport.legacy-common-config-close-evidence", version=1,
                     task_id="B06-LEGACY-RETIREMENT", role="B",
                     task_ref="refs/heads/controller/task-publication/b/fixture",
                     anchor_registration_id="b" * 64, anchor_state_version=10,
                     fixed_role_config_sha256={role: "d" * 64 for role in "ABC"},
                     review={"reviewer_role": "A", "reviewer_identity": "A fixture reviewer",
                             "independence_basis": "Separate test reviewer; not live authority",
                             "verdict": "PASS", "findings": {key: [] for key in ["P0", "P1", "P2"]}})
        return value

    def reject(self, value):
        with self.assertRaisesRegex(route.PublicationError,
                                    "^LEGACY_COMMON_CONFIG_EVIDENCE_SCHEMA_INVALID$"):
            route._legacy_common_config_evidence_shape(value)

    def test_valid_shape_is_detached_without_changing_input(self):
        value = self.evidence()
        before = copy.deepcopy(value)
        parsed = route._legacy_common_config_evidence_shape(value)
        self.assertEqual(parsed, before)
        parsed["review"]["findings"]["P1"].append("changed returned copy")
        self.assertEqual(value, before)

    def test_missing_identity_field_is_rejected(self):
        for key in self.evidence():
            with self.subTest(key=key):
                value = self.evidence(); del value[key]; self.reject(value)

    def test_unknown_or_raw_config_fields_are_rejected(self):
        for key in ["remote_url", "pushurl", "config_values", "credentials"]:
            with self.subTest(key=key):
                value = self.evidence(); value[key] = "PRIVATE_SENTINEL"; self.reject(value)

    def test_boolean_and_unsupported_schema_versions_are_rejected(self):
        for version in [True, False, 0, 2, "1", None]:
            with self.subTest(version=version):
                value = self.evidence(); value["version"] = version; self.reject(value)

    def test_invalid_anchor_state_version_is_rejected(self):
        for version in [True, 0, -1, "10", None]:
            with self.subTest(version=version):
                value = self.evidence(); value["anchor_state_version"] = version; self.reject(value)

    def test_malformed_hash_and_oid_fields_are_rejected(self):
        for key, original in self.evidence().items():
            if isinstance(original, str) and len(original) in {40, 64}:
                for replacement in [original.upper(), original[:-1], None, [], "PRIVATE_SENTINEL"]:
                    with self.subTest(key=key, replacement=replacement):
                        value = self.evidence(); value[key] = replacement; self.reject(value)

    def test_zero_current_main_is_rejected(self):
        value = self.evidence(); value["current_main_sha"] = "0" * 40; self.reject(value)

    def test_same_anchor_and_target_are_rejected(self):
        value = self.evidence(); value["anchor_registration_id"] = value["target_registration_id"]; self.reject(value)

    def test_target_core_must_match_registration_id(self):
        value = self.evidence(); value["target_core_sha256"] = "e" * 64; self.reject(value)

    def test_all_three_fixed_role_hashes_are_required(self):
        for replacement in [{"A": "d" * 64}, {role: "bad" for role in "ABC"}, []]:
            with self.subTest(replacement=replacement):
                value = self.evidence(); value["fixed_role_config_sha256"] = replacement; self.reject(value)

    def test_role_values_are_strings_from_known_set(self):
        for replacement in [[], {}, None, "ROOT", ""]:
            with self.subTest(replacement=replacement):
                value = self.evidence(); value["role"] = replacement; self.reject(value)
                value = self.evidence(); value["review"]["reviewer_role"] = replacement; self.reject(value)

    def test_required_labels_are_bounded_and_control_free(self):
        for replacement in ["", " ", "value\nline", "x" * 2048, None]:
            with self.subTest(replacement=replacement):
                value = self.evidence(); value["task_id"] = replacement; self.reject(value)
                value = self.evidence(); value["review"]["independence_basis"] = replacement; self.reject(value)

    def test_non_branch_task_ref_is_rejected(self):
        value = self.evidence(); value["task_ref"] = "refs/tags/release"; self.reject(value)

    def test_rework_and_findings_cannot_look_like_pass(self):
        value = self.evidence(); value["review"]["verdict"] = "REWORK_REQUIRED"; self.reject(value)
        for key in ["P0", "P1", "P2"]:
            value = self.evidence(); value["review"]["findings"][key] = ["finding"]; self.reject(value)
        value = self.evidence(); value["review"]["findings"]["P0"] = (); self.reject(value)

    def test_unknown_review_and_findings_fields_are_rejected(self):
        value = self.evidence(); value["review"]["raw_config"] = "PRIVATE_SENTINEL"; self.reject(value)
        value = self.evidence(); value["review"]["findings"]["OTHER"] = []; self.reject(value)

    def test_error_never_echoes_rejected_value(self):
        value = self.evidence(); value["global_config_sha256"] = "PRIVATE_SENTINEL"
        try:
            route._legacy_common_config_evidence_shape(value)
        except route.PublicationError as error:
            self.assertNotIn("PRIVATE_SENTINEL", str(error))
        else:
            self.fail("Malformed evidence was accepted")

    def test_non_object_input_is_rejected(self):
        for value in [None, [], "PRIVATE_SENTINEL", True]:
            with self.subTest(value=value):
                self.reject(value)



class LegacyCommonConfigEvidenceIdentityTests(unittest.TestCase):
    """Pure observed-identity contract; never access real registrations or Git."""

    def setUp(self):
        import copy
        import task_publication
        self.copy = copy.deepcopy
        self.publication = task_publication
        value = {
            "kind": task_publication.LEGACY_COMMON_CONFIG_EVIDENCE_KIND,
            "version": 1, "target_registration_id": "a" * 64,
            "target_core_sha256": "a" * 64,
            "registered_common_config_sha256": "b" * 64,
            "global_config_sha256": "c" * 64,
            "anchor_registration_id": "d" * 64,
            "anchor_state_sha256": "e" * 64,
            "anchor_close_receipt_sha256": "f" * 64,
            "current_common_config_sha256": "1" * 64,
            "remote_identity_sha256": "2" * 64,
            "push_identity_sha256": "3" * 64,
            "pushurl_identity_sha256": "4" * 64,
            "candidate_sha": "a" * 40, "candidate_tree": "b" * 40,
            "base_sha": "c" * 40, "anchor_candidate_sha": "d" * 40,
            "current_main_sha": "e" * 40,
            "task_id": "C00-LEGACY-SYNTHETIC", "role": "B",
            "task_ref": "refs/heads/synthetic/legacy", "anchor_state_version": 7,
            "fixed_role_config_sha256": {r: "5" * 64 for r in "ABC"},
            "review": {"reviewer_role": "A", "reviewer_identity": "synthetic reviewer A",
                       "independence_basis": "Separate fixture author and reviewer",
                       "verdict": "PASS", "findings": {"P0": [], "P1": [], "P2": []}},
        }
        observed = {k: self.copy(v) for k, v in value.items()
                    if k not in {"kind", "version"}}
        observed.update({
            "target_created_at": "2026-10-01T10:00:00Z",
            "anchor_created_at": "2026-10-02T10:00:00+00:00",
            "anchor_state": "CLOSED",
            "anchor_common_config_sha256": value["current_common_config_sha256"],
            "anchor_global_config_sha256": value["global_config_sha256"],
            "anchor_fixed_role_config_sha256": self.copy(value["fixed_role_config_sha256"]),
            "anchor_remote_identity_sha256": value["remote_identity_sha256"],
            "anchor_push_identity_sha256": value["push_identity_sha256"],
            "anchor_pushurl_identity_sha256": value["pushurl_identity_sha256"],
            "anchor_close_receipt_valid": True, "anchor_is_ancestor_of_main": True,
            "reviewer_independence_verified": True, "ordinary_common_matches": False,
        })
        self.value, self.observed = value, observed

    def validate(self):
        return self.publication._legacy_common_config_evidence_identity(self.value, self.observed)

    def rejects(self, code):
        with self.assertRaisesRegex(self.publication.PublicationError, "^" + code + "$"):
            self.validate()

    def test_exact_independently_observed_identity_passes(self):
        self.assertEqual(self.validate(), self.value)

    def test_each_identity_mismatch_fails(self):
        original = self.copy(self.observed)
        for key in set(self.value) - {"kind", "version"}:
            with self.subTest(key=key):
                self.observed = self.copy(original)
                current = self.observed[key]
                if isinstance(current, dict):
                    self.observed[key]["A"] = "9" * 64
                elif isinstance(current, int):
                    self.observed[key] += 1
                else:
                    self.observed[key] = "different"
                self.rejects("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")

    def test_missing_observation_is_not_inferred_from_evidence(self):
        original = self.copy(self.observed)
        for key in original:
            with self.subTest(key=key):
                self.observed = self.copy(original)
                del self.observed[key]
                self.rejects("LEGACY_COMMON_CONFIG_OBSERVATION_INVALID")

    def test_extra_observation_fields_are_rejected(self):
        self.observed["unexpected"] = "not accepted"
        self.rejects("LEGACY_COMMON_CONFIG_OBSERVATION_INVALID")

    def test_non_object_observation_is_rejected(self):
        for value in (None, [], True, "not an observation"):
            with self.subTest(value=value):
                self.observed = value
                self.rejects("LEGACY_COMMON_CONFIG_OBSERVATION_INVALID")

    def test_boolean_cannot_match_integer_anchor_version(self):
        self.value["anchor_state_version"] = 1
        self.observed["anchor_state_version"] = True
        self.rejects("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")

    def test_non_closed_anchor_is_rejected(self):
        for state in ("REVOKED", "PUBLISHED", "READY", "CLOSED ", None):
            with self.subTest(state=state):
                self.observed["anchor_state"] = state
                self.rejects("LEGACY_COMMON_CONFIG_ANCHOR_NOT_CLOSED")

    def test_required_facts_are_exact_booleans_not_truthy_values(self):
        original = self.copy(self.observed)
        for key in ("anchor_close_receipt_valid", "anchor_is_ancestor_of_main",
                    "reviewer_independence_verified"):
            for value in (False, None, 1, "true"):
                with self.subTest(key=key, value=value):
                    self.observed = self.copy(original)
                    self.observed[key] = value
                    self.rejects("LEGACY_COMMON_CONFIG_OBSERVATION_UNVERIFIED")

    def test_ordinary_match_or_unknown_does_not_use_bridge(self):
        for value in (True, None, 0, "false"):
            with self.subTest(value=value):
                self.observed["ordinary_common_matches"] = value
                self.rejects("LEGACY_COMMON_CONFIG_BRIDGE_NOT_REQUIRED")

    def test_anchor_configuration_and_transport_must_match(self):
        original = self.copy(self.observed)
        keys = ("anchor_common_config_sha256", "anchor_global_config_sha256",
                "anchor_fixed_role_config_sha256", "anchor_remote_identity_sha256",
                "anchor_push_identity_sha256", "anchor_pushurl_identity_sha256")
        for key in keys:
            with self.subTest(key=key):
                self.observed = self.copy(original)
                if isinstance(self.observed[key], dict):
                    self.observed[key]["C"] = "9" * 64
                else:
                    self.observed[key] = "9" * 64
                self.rejects("LEGACY_COMMON_CONFIG_ANCHOR_IDENTITY_MISMATCH")

    def test_anchor_must_be_strictly_later(self):
        for time in ("2026-10-01T10:00:00Z", "2026-09-30T10:00:00Z"):
            with self.subTest(time=time):
                self.observed["anchor_created_at"] = time
                self.rejects("LEGACY_COMMON_CONFIG_ANCHOR_ORDER_INVALID")

    def test_utc_offsets_are_compared_as_instants(self):
        self.observed["target_created_at"] = "2026-10-01T12:00:00+02:00"
        self.observed["anchor_created_at"] = "2026-10-01T10:00:01Z"
        self.assertEqual(self.validate(), self.value)
        self.observed["anchor_created_at"] = "2026-10-01T10:00:00Z"
        self.rejects("LEGACY_COMMON_CONFIG_ANCHOR_ORDER_INVALID")

    def test_naive_timestamps_are_rejected(self):
        original = self.copy(self.observed)
        for key in ("target_created_at", "anchor_created_at"):
            with self.subTest(key=key):
                self.observed = self.copy(original)
                self.observed[key] = "2026-10-01T10:00:00"
                self.rejects("LEGACY_COMMON_CONFIG_ANCHOR_ORDER_INVALID")

    def test_malformed_timestamp_error_does_not_expose_value(self):
        original = self.copy(self.observed)
        for value in (None, 123, {}, "private-input-must-not-appear", "2026-99-99"):
            with self.subTest(value=value):
                self.observed = self.copy(original)
                self.observed["anchor_created_at"] = value
                self.rejects("LEGACY_COMMON_CONFIG_ANCHOR_ORDER_INVALID")

    def test_result_is_detached_from_both_inputs(self):
        original_value, original_observed = self.copy(self.value), self.copy(self.observed)
        result = self.validate()
        result["fixed_role_config_sha256"]["A"] = "9" * 64
        result["review"]["findings"]["P1"].append("test-only")
        self.assertEqual(self.value, original_value)
        self.assertEqual(self.observed, original_observed)

    def test_failure_does_not_change_inputs(self):
        self.observed["anchor_state"] = "REVOKED"
        original_value, original_observed = self.copy(self.value), self.copy(self.observed)
        self.rejects("LEGACY_COMMON_CONFIG_ANCHOR_NOT_CLOSED")
        self.assertEqual(self.value, original_value)
        self.assertEqual(self.observed, original_observed)

    def test_evidence_schema_is_checked_before_observations(self):
        self.value["review"]["verdict"] = "REWORK_REQUIRED"
        self.observed = {}
        self.rejects("LEGACY_COMMON_CONFIG_EVIDENCE_SCHEMA_INVALID")

    def test_changed_evidence_reviewer_provenance_rejected_with_true_flag(self):
        original = self.copy(self.value)
        for key, changed in (("reviewer_role", "CONTROLLER"),
                             ("reviewer_identity", "different reviewer"),
                             ("independence_basis", "different independence basis")):
            with self.subTest(key=key):
                self.value = self.copy(original)
                self.value["review"][key] = changed
                self.assertIs(self.observed["reviewer_independence_verified"], True)
                self.rejects("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")

    def test_changed_observed_reviewer_provenance_is_not_ignored(self):
        original = self.copy(self.observed)
        for key, changed in (("reviewer_role", "CONTROLLER"),
                             ("reviewer_identity", "different reviewer"),
                             ("independence_basis", "different independence basis")):
            with self.subTest(key=key):
                self.observed = self.copy(original)
                self.observed["review"][key] = changed
                self.rejects("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")

    def test_matching_review_metadata_does_not_replace_independence_check(self):
        self.observed["reviewer_independence_verified"] = False
        self.rejects("LEGACY_COMMON_CONFIG_OBSERVATION_UNVERIFIED")

    def test_missing_observed_review_is_not_inferred_from_boolean(self):
        self.observed.pop("review")
        self.rejects("LEGACY_COMMON_CONFIG_OBSERVATION_INVALID")

    def test_observed_review_verdict_and_findings_must_match(self):
        original = self.copy(self.observed)
        for field, changed in (("verdict", "REWORK_REQUIRED"),
                               ("findings", {"P0": [], "P1": ["unresolved"], "P2": []})):
            with self.subTest(field=field):
                self.observed = self.copy(original)
                self.observed["review"][field] = changed
                self.rejects("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")

    def test_observed_review_wrong_type_and_extra_fields_are_rejected(self):
        original = self.copy(self.observed)
        for changed in (None, [], True, "PASS", dict(self.value["review"], extra=True)):
            with self.subTest(kind=type(changed).__name__):
                self.observed = self.copy(original)
                self.observed["review"] = changed
                self.rejects("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")

    def test_matched_new_reviewer_provenance_is_detached(self):
        review = self.copy(self.value["review"])
        review.update(reviewer_role="C", reviewer_identity="independent fixture C")
        self.value["review"] = self.copy(review)
        self.observed["review"] = self.copy(review)
        returned = self.validate()
        returned["review"]["reviewer_identity"] = "result-only change"
        self.assertEqual(self.value["review"], review)
        self.assertEqual(self.observed["review"], review)



class LegacyCommonConfigBindingTransitionTests(unittest.TestCase):
    """In-memory bind/rebind policy only; no registration or Git side effects."""

    def setUp(self):
        import copy
        import task_publication
        fixture = LegacyCommonConfigEvidenceIdentityTests()
        fixture.setUp()
        self.copy = copy.deepcopy
        self.publication = task_publication
        self.value, self.observed = fixture.value, fixture.observed
        self.reference = {"path": "/root/octoport-control/logs/B/legacy-fixture.json", "sha256": "6" * 64}
        self.facts = {"state": "TASK_REF_PUBLISHED", "task_ref_oid": self.value["candidate_sha"],
                      "no_armed_lease": True, "worktree_clean": True, "installed_keys_match": True,
                      "close_intent_exists": False, "close_receipt_exists": False}
        self.authority = None

    def transition(self):
        return self.publication._legacy_common_config_binding_transition(
            self.value, self.observed, self.reference, self.authority, self.facts)

    def reject(self, code):
        before = self.copy([self.value, self.observed, self.reference, self.authority, self.facts])
        with self.assertRaisesRegex(self.publication.PublicationError, "^" + code + "$"):
            self.transition()
        self.assertEqual(before, [self.value, self.observed, self.reference, self.authority, self.facts])

    def initial(self):
        result = self.transition()
        self.assertTrue(result["changed"])
        self.authority = result["authority"]
        return self.copy(self.authority)

    def next_epoch(self, number=7):
        self.facts.update(state="REVOKED", task_ref_oid="0" * 40)
        updates = {"anchor_registration_id": str(number) * 64,
                   "anchor_state_sha256": str(number) * 64,
                   "anchor_close_receipt_sha256": str(number) * 64,
                   "anchor_candidate_sha": str(number) * 40,
                   "current_main_sha": str(number) * 40,
                   "current_common_config_sha256": str(number) * 64}
        self.value.update(updates)
        self.observed.update(self.copy(updates))
        self.observed.update(anchor_common_config_sha256=self.value["current_common_config_sha256"],
                             anchor_created_at=f"2026-10-0{number - 4}T10:00:00Z")
        self.reference = {"path": f"/root/octoport-control/logs/B/legacy-{number}.json", "sha256": str(number) * 64}

    def test_initial_bind_is_detached_and_does_not_mutate_inputs(self):
        before = self.copy([self.value, self.observed, self.reference, self.facts])
        result = self.transition()
        self.assertTrue(result["changed"])
        self.assertEqual(result["authority"]["history"], [])
        self.assertEqual(before, [self.value, self.observed, self.reference, self.facts])
        result["authority"]["current"]["identity"]["review"]["reviewer_identity"] = "changed output"
        self.assertEqual(self.value["review"]["reviewer_identity"], before[0]["review"]["reviewer_identity"])

    def test_exact_replay_preserves_authority_and_signals_no_write(self):
        original = self.initial()
        result = self.transition()
        self.assertFalse(result["changed"])
        self.assertEqual(result["authority"], original)
        result["authority"]["history"].append({})
        self.assertEqual(self.authority, original)

    def test_initial_absent_ref_allowed_in_close_states(self):
        for state in ("TASK_REF_PUBLISHED", "PUBLISHED", "REVOKED", "FAILED"):
            with self.subTest(state=state):
                self.facts.update(state=state, task_ref_oid="0" * 40)
                self.assertTrue(self.transition()["changed"])

    def test_initial_registered_ready_closed_and_unknown_rejected(self):
        for state in ("REGISTERED", "READY", "CLOSED", "UNKNOWN", None, 1):
            with self.subTest(state=state):
                self.facts["state"] = state
                self.reject("LEGACY_COMMON_CONFIG_BIND_STATE_INVALID")

    def test_foreign_ref_rejected_in_all_bind_states(self):
        for state in ("TASK_REF_PUBLISHED", "PUBLISHED", "REVOKED", "FAILED"):
            with self.subTest(state=state):
                self.facts.update(state=state, task_ref_oid="f" * 40)
                self.reject("LEGACY_COMMON_CONFIG_BIND_TASK_REF_PRESENT")

    def test_close_states_reject_exact_candidate_ref(self):
        for state in ("PUBLISHED", "REVOKED", "FAILED"):
            with self.subTest(state=state):
                self.facts["state"] = state
                self.reject("LEGACY_COMMON_CONFIG_BIND_TASK_REF_PRESENT")

    def test_invalid_or_unverified_guard_values_rejected(self):
        original = self.copy(self.facts)
        for key in ("no_armed_lease", "worktree_clean", "installed_keys_match"):
            for value in (False, 1, "true", None):
                with self.subTest(key=key, value=value):
                    self.facts = self.copy(original)
                    self.facts[key] = value
                    self.reject("LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED")

    def test_close_intent_or_receipt_blocks_initial_and_replay(self):
        original = self.copy(self.facts)
        for initial in (False, True):
            if initial:
                self.facts = self.copy(original)
                self.initial()
            for key in ("close_intent_exists", "close_receipt_exists"):
                with self.subTest(initial=initial, key=key):
                    self.facts = self.copy(original)
                    self.facts[key] = True
                    self.reject("LEGACY_COMMON_CONFIG_BIND_CLOSE_STARTED")

    def test_rebind_appends_old_identity_and_preserves_all_history(self):
        original = self.initial()
        self.next_epoch()
        result = self.transition()
        self.assertTrue(result["changed"])
        self.assertEqual(result["authority"]["history"], [original["current"]])
        self.assertEqual(self.authority, original)
        self.authority = result["authority"]
        previous = self.copy(self.authority)
        self.next_epoch(8)
        result = self.transition()
        self.assertEqual(result["authority"]["history"], [original["current"], previous["current"]])
        self.assertEqual(self.authority, previous)

    def test_different_binding_allowed_only_in_revoked_state(self):
        self.initial()
        self.next_epoch()
        for state in ("TASK_REF_PUBLISHED", "PUBLISHED", "FAILED"):
            with self.subTest(state=state):
                self.facts["state"] = state
                self.reject("LEGACY_COMMON_CONFIG_REBIND_STATE_INVALID")

    def test_rebind_rejects_stable_target_and_security_identity_drift(self):
        self.initial()
        self.next_epoch()
        value, observed = self.copy(self.value), self.copy(self.observed)
        for key in ("candidate_sha", "candidate_tree", "base_sha", "task_id", "task_ref",
                    "registered_common_config_sha256", "global_config_sha256", "remote_identity_sha256",
                    "push_identity_sha256", "pushurl_identity_sha256", "fixed_role_config_sha256"):
            with self.subTest(key=key):
                self.value, self.observed = self.copy(value), self.copy(observed)
                changed = {r: "9" * 64 for r in "ABC"} if key == "fixed_role_config_sha256" else (
                    "refs/heads/different" if key == "task_ref" else "C00-DIFFERENT" if key == "task_id"
                    else "9" * len(value[key]))
                self.value[key] = self.copy(changed)
                self.observed[key] = self.copy(changed)
                anchor_key = "anchor_" + key
                if key in {"global_config_sha256", "fixed_role_config_sha256", "remote_identity_sha256", "push_identity_sha256", "pushurl_identity_sha256"}:
                    self.observed[anchor_key] = self.copy(changed)
                self.reject("LEGACY_COMMON_CONFIG_REBIND_IDENTITY_DRIFT")

    def test_rebind_requires_distinct_later_anchor(self):
        original = self.initial()
        self.next_epoch()
        self.value["anchor_registration_id"] = original["current"]["identity"]["anchor_registration_id"]
        self.observed["anchor_registration_id"] = self.value["anchor_registration_id"]
        self.reject("LEGACY_COMMON_CONFIG_REBIND_ANCHOR_INVALID")

    def test_rebind_rejects_anchor_not_later_than_prior_binding(self):
        self.initial()
        self.next_epoch()
        self.observed["anchor_created_at"] = "2026-10-02T09:00:00Z"
        self.reject("LEGACY_COMMON_CONFIG_REBIND_ANCHOR_INVALID")

    def test_rebind_rejects_started_close(self):
        self.initial()
        self.next_epoch()
        self.facts["close_intent_exists"] = True
        self.reject("LEGACY_COMMON_CONFIG_BIND_CLOSE_STARTED")

    def test_reviewer_binding_and_independence_remain_mandatory(self):
        self.value["review"]["reviewer_identity"] = "changed evidence reviewer"
        self.reject("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")
        self.observed["review"] = self.copy(self.value["review"])
        self.observed["reviewer_independence_verified"] = False
        self.reject("LEGACY_COMMON_CONFIG_OBSERVATION_UNVERIFIED")

    def test_invalid_reference_rejected_without_echoing_payload(self):
        good = self.copy(self.reference)
        for bad in ({}, {"path": "https://invalid.example/secret", "sha256": "6" * 64},
                    {"path": "relative/file", "sha256": "6" * 64},
                    {"path": "/control/../secret", "sha256": "6" * 64},
                    {"path": good["path"], "sha256": "not-a-hash"},
                    {"path": good["path"], "sha256": "6" * 64, "extra": "secret"}):
            with self.subTest(bad=bad):
                self.reference = bad
                self.reject("LEGACY_COMMON_CONFIG_BIND_EVIDENCE_REFERENCE_INVALID")

    def test_malformed_facts_are_rejected(self):
        good = self.copy(self.facts)
        self.facts.pop("worktree_clean")
        self.reject("LEGACY_COMMON_CONFIG_BIND_FACTS_INVALID")
        self.facts = dict(good, unexpected=True)
        self.reject("LEGACY_COMMON_CONFIG_BIND_FACTS_INVALID")

    def test_malformed_ref_oid_rejected(self):
        for value in (None, True, "a" * 39, "F" * 40, "a" * 41):
            with self.subTest(value=value):
                self.facts["task_ref_oid"] = value
                self.reject("LEGACY_COMMON_CONFIG_BIND_REF_INVALID")

    def test_malformed_authority_rejected(self):
        good = self.initial()
        for bad in (False, {}, {"current": good["current"]},
                    {"current": good["current"], "history": None},
                    {"current": good["current"], "history": [{}]},
                    dict(good, unexpected=True)):
            with self.subTest(bad=bad):
                self.authority = bad
                self.reject("LEGACY_COMMON_CONFIG_BIND_AUTHORITY_INVALID")

    def test_history_cannot_contain_different_target_identity(self):
        good = self.initial()
        old = self.copy(good["current"])
        old["identity"]["task_id"] = "OTHER-HISTORICAL-TARGET"
        self.authority["history"].append(old)
        self.reject("LEGACY_COMMON_CONFIG_BIND_AUTHORITY_INVALID")

    def test_observed_reviewer_can_change_only_with_exact_new_review(self):
        self.initial()
        self.next_epoch()
        self.value["review"]["reviewer_role"] = "C"
        self.value["review"]["reviewer_identity"] = "C independent reviewer"
        self.observed["review"] = self.copy(self.value["review"])
        self.assertTrue(self.transition()["changed"])

    def test_replay_does_not_skip_fresh_identity_checks(self):
        self.initial()
        self.observed["anchor_close_receipt_valid"] = False
        self.reject("LEGACY_COMMON_CONFIG_OBSERVATION_UNVERIFIED")


class LegacyCommonConfigCloseCheckpointTests(unittest.TestCase):
    """Pure intent identity only: no close permission, filesystem or Git use."""

    def setUp(self):
        self.fixture = LegacyCommonConfigBindingTransitionTests()
        self.fixture.setUp()
        self.fixture.initial()
        self.publication = self.fixture.publication
        self.copy = self.fixture.copy

    def checkpoint(self, frozen=None):
        f = self.fixture
        return self.publication._legacy_common_config_close_checkpoint(
            f.value, f.observed, f.reference, f.authority, frozen)

    def reject(self, code, frozen=None):
        f = self.fixture
        before = self.copy([f.value, f.observed, f.reference, f.authority, frozen])
        with self.assertRaisesRegex(self.publication.PublicationError, '^' + code + '$'):
            self.checkpoint(frozen)
        self.assertEqual(before, [f.value, f.observed, f.reference, f.authority, frozen])

    def next_binding(self):
        self.fixture.next_epoch()
        self.fixture.authority = self.fixture.transition()['authority']

    def test_checkpoint_is_hash_bound_and_detached(self):
        result = self.checkpoint()
        self.assertEqual(result['kind'], 'octoport.legacy-common-config-close-checkpoint')
        self.assertEqual(result['version'], 1)
        self.assertEqual(result['target_registration_id'], self.fixture.value['target_registration_id'])
        self.assertEqual(result['evidence'], self.fixture.reference)
        for name, value in result.items():
            if name.endswith('_sha256'):
                self.assertRegex(value, '^[0-9a-f]{64}$')
        result['evidence']['path'] = '/changed'
        self.assertNotEqual(result['evidence'], self.fixture.reference)

    def test_exact_replay_is_byte_equivalent_and_preserves_inputs(self):
        f = self.fixture
        before = self.copy([f.value, f.observed, f.reference, f.authority])
        frozen = self.checkpoint()
        self.assertEqual(self.checkpoint(frozen), frozen)
        self.assertEqual(before, [f.value, f.observed, f.reference, f.authority])

    def test_dictionary_order_does_not_change_checkpoint(self):
        frozen = self.checkpoint()
        reversed_order = dict(reversed(list(frozen.items())))
        self.assertEqual(self.checkpoint(reversed_order), frozen)

    def test_bool_is_not_checkpoint_version_one(self):
        frozen = self.checkpoint()
        frozen['version'] = True
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT', frozen)

    def test_extra_checkpoint_field_rejected(self):
        frozen = self.checkpoint()
        frozen['unbound'] = True
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT', frozen)

    def test_missing_checkpoint_field_rejected(self):
        frozen = self.checkpoint()
        del frozen['binding_history_sha256']
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT', frozen)

    def test_wrong_checkpoint_types_rejected(self):
        for frozen in (False, 1, [], 'checkpoint'):
            with self.subTest(frozen=frozen):
                self.reject('LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT', frozen)

    def test_changed_evidence_reference_rejected(self):
        for key, value in [('path', '/different/evidence.json'), ('sha256', '9' * 64)]:
            self.setUp()
            with self.subTest(key=key):
                self.fixture.reference[key] = value
                self.reject('LEGACY_COMMON_CONFIG_CLOSE_BINDING_MISMATCH')

    def test_invalid_reference_path_or_digest_rejected(self):
        for key, value in [('path', 'relative.json'), ('path', '/root/../escape'),
                           ('path', '/root/file\n'), ('sha256', 'not-a-hash')]:
            self.setUp()
            with self.subTest(key=key, value=value):
                self.fixture.reference[key] = value
                self.reject('LEGACY_COMMON_CONFIG_CLOSE_AUTHORITY_INVALID')

    def test_current_evidence_identity_mismatch_rejected(self):
        self.fixture.authority['current']['identity']['review']['reviewer_identity'] = 'Other valid reviewer'
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_BINDING_MISMATCH')

    def test_reviewer_drift_not_masked_by_true_flag(self):
        self.fixture.value['review']['reviewer_identity'] = 'Changed unobserved reviewer'
        self.reject('LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH')

    def test_independence_false_rejected_on_replay(self):
        frozen = self.checkpoint()
        self.fixture.observed['reviewer_independence_verified'] = False
        self.reject('LEGACY_COMMON_CONFIG_OBSERVATION_UNVERIFIED', frozen)

    def test_anchor_time_mismatch_rejected(self):
        self.fixture.authority['current']['anchor_created_at'] = '2026-10-03T10:00:00Z'
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_BINDING_MISMATCH')

    def test_rebind_requires_a_new_checkpoint(self):
        frozen = self.checkpoint()
        self.next_binding()
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT', frozen)
        self.assertNotEqual(self.checkpoint(), frozen)

    def test_history_mutation_after_checkpoint_rejected(self):
        self.next_binding()
        frozen = self.checkpoint()
        self.fixture.authority['history'][0]['evidence']['sha256'] = '9' * 64
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT', frozen)

    def test_invalid_authority_shapes_rejected(self):
        for authority in (None, [], {}, {'current': {}, 'history': []},
                          {'current': {}, 'history': {}},
                          {'current': {}, 'history': [], 'extra': True}):
            self.setUp()
            with self.subTest(authority=authority):
                self.fixture.authority = authority
                self.reject('LEGACY_COMMON_CONFIG_CLOSE_AUTHORITY_INVALID')

    def test_malformed_historical_binding_rejected(self):
        self.next_binding()
        self.fixture.authority['history'][0]['identity']['extra'] = 'unbound'
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_AUTHORITY_INVALID')

    def test_frozen_reference_is_not_a_permission_grant(self):
        from unittest.mock import patch
        import builtins
        with patch.object(builtins, 'open', side_effect=AssertionError('file I/O forbidden')):
            with patch.object(self.publication, '_state_transition', side_effect=AssertionError('mutation forbidden')):
                with patch.object(self.publication, '_read_registration', side_effect=AssertionError('observation forbidden')):
                    frozen = self.checkpoint()
                    self.assertEqual(self.checkpoint(frozen), frozen)
        self.assertNotIn('verdict', frozen)
        self.assertNotIn('permission', frozen)
        self.assertNotIn('restore', frozen)

    def test_raw_review_and_configuration_not_copied_to_checkpoint(self):
        f = self.fixture
        marker = 'PRIVATE_PROVENANCE_VALUE_MUST_NOT_APPEAR'
        f.value['review']['reviewer_identity'] = marker
        f.value['review']['independence_basis'] = marker
        f.observed['review'] = self.copy(f.value['review'])
        f.authority['current']['identity'] = self.copy(f.value)
        serialized = json.dumps(self.checkpoint(), sort_keys=True)
        self.assertNotIn(marker, serialized)
        for field in ('reviewer_identity', 'independence_basis', 'installed', 'prior', 'final'):
            self.assertNotIn('"' + field + '"', serialized)

    def test_current_and_history_hashes_cover_entire_canonical_bindings(self):
        self.next_binding()
        f = self.fixture
        frozen = self.checkpoint()
        for key, payload in [('binding_current_sha256', f.authority['current']),
                             ('binding_history_sha256', f.authority['history']),
                             ('authority_sha256', f.authority)]:
            self.assertEqual(frozen[key], self.publication._sha_bytes(self.publication._canonical_bytes(payload)))
        self.assertEqual(frozen['anchor_state_version'], f.value['anchor_state_version'])
        self.assertEqual(frozen['anchor_close_receipt_sha256'], f.value['anchor_close_receipt_sha256'])

    def test_changed_anchor_terminal_identity_rejected_after_freeze(self):
        frozen = self.checkpoint()
        f = self.fixture
        for target in (f.value, f.observed, f.authority['current']['identity']):
            target['anchor_state_sha256'] = '8' * 64
        self.reject('LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT', frozen)

    def test_returned_checkpoint_does_not_alias_frozen(self):
        frozen = self.checkpoint()
        result = self.checkpoint(frozen)
        result['evidence']['path'] = '/different'
        self.assertNotEqual(result, frozen)
        self.assertEqual(frozen['evidence'], self.fixture.reference)



class LegacyCommonConfigTargetFactsTests(unittest.TestCase):
    """Collector wiring with mocked Git/config/ref I/O, never a live authority."""

    def setUp(self):
        import copy
        import subprocess
        import task_publication
        from unittest import mock
        self.copy = copy.deepcopy
        self.p = task_publication
        self.root = Path('/synthetic-control')
        self.worktree = Path('/synthetic-worktree')
        self.record = {
            'registration_id': 'a' * 64, 'state': 'TASK_REF_PUBLISHED',
            'core': {'worktree_path': str(self.worktree), 'candidate_head': 'b' * 40,
                     'task_ref': 'refs/heads/controller/task-publication/b/fixture',
                     'push_target': 'https://github.com/example/fixture.git'},
            'installed_config': {
                'owned_keys': ['core.hooksPath', 'remote.origin.pushurl'],
                'core.hooksPath': {'present': True, 'values': ['/synthetic-hooks']},
                'remote.origin.pushurl': {'present': True, 'values': ['synthetic-target']},
            },
        }
        def patch(obj, name, **kwargs):
            manager = mock.patch.object(obj, name, autospec=True, **kwargs)
            value = manager.start()
            self.addCleanup(manager.stop)
            return value
        self.leases = patch(self.p, '_no_armed_leases', return_value=True)
        self.config = patch(self.p, '_config_values', side_effect=lambda w, k: self.copy(self.record['installed_config'][k]))
        self.remote = patch(self.p, '_supersede_remote_state', return_value='b' * 40)
        self.env = patch(self.p, 'sanitized_git_authority_env', return_value={'PINNED': 'test'})
        self.git = patch(self.p.subprocess, 'run', return_value=subprocess.CompletedProcess([], 0, '', ''))
        self.exists = patch(Path, 'exists', return_value=False)
        self.symlink = patch(Path, 'is_symlink', return_value=False)
        self.writer = patch(self.p, '_state_transition')
        self.set_config = patch(self.p, '_set_config_values')

    def collect(self):
        return self.p._legacy_common_config_target_facts(self.root, self.record)

    def reject(self, code):
        with self.assertRaisesRegex(self.p.PublicationError, '^' + code + '$'):
            self.collect()
        self.writer.assert_not_called()
        self.set_config.assert_not_called()

    def test_success_reads_real_interfaces_without_writes(self):
        before = self.copy(self.record)
        result = self.collect()
        self.assertEqual(result, {'state': 'TASK_REF_PUBLISHED', 'task_ref_oid': 'b' * 40,
            'no_armed_lease': True, 'worktree_clean': True, 'installed_keys_match': True,
            'close_intent_exists': False, 'close_receipt_exists': False})
        self.assertEqual(self.record, before)
        self.remote.assert_called_once_with(self.worktree, self.record['core']['push_target'],
            self.record['core']['task_ref'], 'b' * 40)
        self.assertEqual(self.git.call_count, 2)
        self.writer.assert_not_called()
        self.set_config.assert_not_called()

    def test_allowed_terminal_states_require_absent_ref(self):
        for state in ('PUBLISHED', 'REVOKED', 'FAILED'):
            with self.subTest(state=state):
                self.record['state'] = state
                self.remote.return_value = self.p.ZERO_OID
                self.assertEqual(self.collect()['state'], state)

    def test_invalid_states_fail_before_any_probe(self):
        for state in ('REGISTERED', 'READY', 'CLOSED', None, 1):
            with self.subTest(state=state):
                self.record['state'] = state
                self.reject('LEGACY_COMMON_CONFIG_BIND_STATE_INVALID')
        self.git.assert_not_called()
        self.remote.assert_not_called()

    def test_armed_or_unverified_lease_fails_before_git(self):
        for value in (False, None, 1):
            with self.subTest(value=value):
                self.leases.return_value = value
                self.reject('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED')
        self.git.assert_not_called()
        self.remote.assert_not_called()

    def test_existing_close_intent_or_receipt_fails_before_git(self):
        for name in ('intent.json', 'receipt.json'):
            with self.subTest(name=name):
                self.exists.side_effect = lambda p: p.name == name
                self.reject('LEGACY_COMMON_CONFIG_BIND_CLOSE_STARTED')
        self.git.assert_not_called()
        self.remote.assert_not_called()

    def test_dangling_close_marker_is_also_a_started_close(self):
        self.symlink.return_value = True
        self.reject('LEGACY_COMMON_CONFIG_BIND_CLOSE_STARTED')
        self.git.assert_not_called()
        self.remote.assert_not_called()

    def test_git_failure_has_only_sanitized_code(self):
        self.git.return_value.returncode = 128
        self.git.return_value.stderr = 'must-not-appear-secret'
        self.reject('LEGACY_COMMON_CONFIG_GIT_OBSERVATION_FAILED')
        self.remote.assert_not_called()

    def test_git_timeout_fails_closed(self):
        self.git.side_effect = self.p.subprocess.TimeoutExpired('secret-command', 30)
        self.reject('LEGACY_COMMON_CONFIG_GIT_OBSERVATION_FAILED')
        self.remote.assert_not_called()

    def test_dirty_worktree_fails_before_remote(self):
        self.git.return_value.stdout = ' M a-file\n'
        self.reject('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED')
        self.remote.assert_not_called()

    def test_git_environment_is_pinned_and_shell_is_not_used(self):
        self.collect()
        for call in self.git.call_args_list:
            self.assertEqual(call.args[0][0], self.p.AUTHORITY_GIT_BIN)
            self.assertEqual(call.args[0][1:3], ['-C', str(self.worktree)])
            self.assertEqual(call.kwargs['env'], {'PINNED': 'test'})
            self.assertEqual(call.kwargs['cwd'], '/')
            self.assertFalse(call.kwargs.get('shell', False))
            self.assertEqual(call.kwargs['timeout'], 30)

    def test_owned_config_drift_fails_before_remote(self):
        self.config.side_effect = lambda w, k: {'present': False, 'values': []}
        self.reject('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED')
        self.remote.assert_not_called()

    def test_invalid_owned_keys_fail_before_config_read(self):
        for keys in ([], ['core.hooksPath', 'core.hooksPath'], ['url.secret.insteadOf'], 'core.hooksPath'):
            with self.subTest(keys=keys):
                self.record['installed_config']['owned_keys'] = keys
                self.reject('LEGACY_COMMON_CONFIG_TARGET_SNAPSHOT_INVALID')
        self.config.assert_not_called()
        self.remote.assert_not_called()

    def test_foreign_or_disallowed_present_ref_fails(self):
        self.remote.return_value = 'c' * 40
        self.reject('LEGACY_COMMON_CONFIG_BIND_TASK_REF_PRESENT')
        self.record['state'] = 'REVOKED'
        self.remote.return_value = 'b' * 40
        self.reject('LEGACY_COMMON_CONFIG_BIND_TASK_REF_PRESENT')

    def test_unverified_remote_result_is_not_an_absent_ref(self):
        for value in (None, '', False, 'secret:failed', 'x' * 40):
            with self.subTest(value=value):
                self.remote.return_value = value
                self.reject('LEGACY_COMMON_CONFIG_REF_OBSERVATION_FAILED')

    def test_remote_exception_is_sanitized(self):
        self.remote.side_effect = self.p.PublicationError('secret remote details')
        self.reject('LEGACY_COMMON_CONFIG_REF_OBSERVATION_FAILED')

    def test_post_probe_worktree_drift_does_not_return_facts(self):
        import subprocess
        self.git.side_effect = [subprocess.CompletedProcess([], 0, '', ''),
                               subprocess.CompletedProcess([], 0, ' M late', '')]
        self.reject('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED')
        self.remote.assert_called_once()

    def test_post_probe_close_start_is_rejected(self):
        self.exists.side_effect = [False, False, True]
        self.reject('LEGACY_COMMON_CONFIG_BIND_CLOSE_STARTED')
        self.remote.assert_called_once()

    def test_post_probe_lease_is_rechecked(self):
        self.leases.side_effect = [True, False]
        self.reject('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED')
        self.remote.assert_called_once()

    def test_missing_or_relative_snapshot_is_rejected(self):
        self.record['core']['worktree_path'] = 'relative/worktree'
        self.reject('LEGACY_COMMON_CONFIG_TARGET_SNAPSHOT_INVALID')
        self.record.pop('core')
        self.reject('LEGACY_COMMON_CONFIG_TARGET_SNAPSHOT_INVALID')
        self.git.assert_not_called()

    def test_installed_values_must_have_exact_safe_shape(self):
        for malformed in ({'present': 1, 'values': []}, {'present': True, 'values': 'secret'},
                          {'present': True, 'values': [], 'extra': 'secret'}):
            with self.subTest(malformed=malformed):
                self.record['installed_config']['core.hooksPath'] = malformed
                self.reject('LEGACY_COMMON_CONFIG_TARGET_SNAPSHOT_INVALID')
        self.remote.assert_not_called()

    def test_absent_task_ref_is_valid_for_initial_binding(self):
        self.remote.return_value = self.p.ZERO_OID
        self.assertEqual(self.collect()['task_ref_oid'], self.p.ZERO_OID)

class LegacyCommonConfigAnchorSnapshotTests(unittest.TestCase):
    """Real receipt-file observations; registration reader is a pinned test double."""

    def setUp(self):
        import copy
        import tempfile
        import hashlib
        from unittest.mock import patch
        import task_publication
        self.p = task_publication
        self.copy, self.patch, self.hashlib = copy.deepcopy, patch, hashlib
        self.tmp = tempfile.TemporaryDirectory(prefix='legacy-anchor-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.value = LegacyCommonConfigEvidenceShapeTests.evidence()
        self.target = {'registration_id': self.value['target_registration_id'],
                       'created_at': '2026-10-01T00:00:00Z'}
        self.anchor_id = self.value['anchor_registration_id']
        self.close_dir = self.root/'controllers/task-publication/close'/self.anchor_id
        self.close_dir.mkdir(parents=True)
        self.path = self.close_dir/'receipt.json'
        prior = {k: {'present': False, 'values': []} for k in ('core.hooksPath','remote.origin.pushurl')}
        installed = {k: {'present': True, 'values': ['fixture-only-'+k]} for k in prior}
        self.anchor = {'registration_id': self.anchor_id, 'registration_sha256': self.anchor_id,
                       'state': 'CLOSED', 'state_version': 10,
                       'created_at': '2026-10-02T00:00:00Z', 'updated_at': '2026-10-03T00:00:00Z',
                       'core': {'candidate_head': self.value['anchor_candidate_sha'],
                                'common_config_sha256': 'e'*64, 'global_config_sha256': 'f'*64,
                                'fixed_role_config_sha256': {k: 'd'*64 for k in 'ABC'},
                                'remote': 'origin',
                                'push_target': 'https://github.com/example/repo.git',
                                'pushurl_override': None,
                                'prior_config': prior},
                       'installed_config': dict(installed, owned_keys=list(prior))}
        self.receipt = {'kind': 'octoport.task-publication-close', 'version': 1,
                        'registration_id': self.anchor_id, 'state_before': 'PUBLISHED',
                        'before': self.copy(installed), 'installed': self.copy(installed),
                        'final': self.copy(prior), 'worktree_config_sha256_after': '5'*64,
                        'created_at': '2026-10-03T00:00:00Z'}
        self.pin()

    def pin(self, raw=None):
        if raw is None:
            raw = json.dumps(self.receipt).encode()
        self.path.write_bytes(raw)
        digest = self.hashlib.sha256(raw).hexdigest()
        self.anchor['close_receipt'] = {'path': str(self.path), 'sha256': digest}
        self.value['anchor_close_receipt_sha256'] = digest
        self.value['anchor_state_sha256'] = self.hashlib.sha256(self.p._canonical_bytes(self.anchor)).hexdigest()

    def observe(self, side_effect=None):
        pinned = (self.copy(self.anchor), self.value['anchor_state_sha256'])
        with self.patch.object(self.p, '_read_registration', side_effect=side_effect, return_value=pinned):
            return self.p._legacy_common_config_anchor_snapshot(self.root, self.target, self.value)

    def rejects(self):
        with self.assertRaisesRegex(self.p.PublicationError, '^LEGACY_COMMON_CONFIG_'):
            self.observe()

    def test_real_receipt_observed_and_detached(self):
        before = self.path.read_bytes()
        observed = self.observe()
        self.assertTrue(observed['anchor_close_receipt_valid'])
        self.assertEqual(observed['anchor_state_sha256'], self.value['anchor_state_sha256'])
        self.assertEqual(observed['anchor_candidate_sha'], self.value['anchor_candidate_sha'])
        observed['anchor_fixed_role_config_sha256']['A'] = '9'*64
        self.assertEqual(self.anchor['core']['fixed_role_config_sha256']['A'], 'd'*64)
        self.assertEqual(self.path.read_bytes(), before)

    def test_does_not_grant_unobserved_authority(self):
        observed = self.observe()
        for key in ('review', 'reviewer_independence_verified', 'anchor_is_ancestor_of_main',
                    'current_main_sha', 'ordinary_common_matches', 'permission'):
            self.assertNotIn(key, observed)
        encoded = json.dumps(observed)
        self.assertNotIn('fixture-only-', encoded)
        self.assertNotIn('reviewer_identity', encoded)

    def test_no_state_or_transport_operation(self):
        with self.patch.object(self.p, '_state_transition', side_effect=AssertionError('writer forbidden')), \
             self.patch.object(self.p.subprocess, 'run', side_effect=AssertionError('transport forbidden')):
            self.observe()

    def test_anchor_state_and_version_fail_closed(self):
        original = self.copy(self.anchor)
        for field, value in [('state','PUBLISHED'),('state_version',True),('state_version',11),
                             ('registration_id','f'*64),('registration_sha256','f'*64)]:
            with self.subTest(field=field, value=value):
                self.anchor = self.copy(original); self.anchor[field] = value
                self.rejects()

    def test_target_identity_and_order(self):
        self.target['registration_id'] = 'f'*64
        self.rejects()
        self.target['registration_id'] = self.value['target_registration_id']
        for date in ['2026-10-02T00:00:00Z','2026-10-04T00:00:00Z','2026-10-01','bad',None]:
            with self.subTest(date=date):
                self.target['created_at'] = date;self.rejects()

    def test_anchor_candidate_mismatch(self):
        self.anchor['core']['candidate_head'] = 'd'*40
        self.rejects()

    def test_config_hashes_must_be_well_formed(self):
        for name in ['common_config_sha256','global_config_sha256']:
            original = self.anchor['core'][name]
            self.anchor['core'][name] = 'not-a-hash';self.rejects()
            self.anchor['core'][name] = original
        self.anchor['core']['fixed_role_config_sha256'].pop('A');self.rejects()

    def test_canonical_path_required(self):
        self.anchor['close_receipt']['path'] = str(self.root/'other.json')
        self.rejects()

    def test_receipt_leaf_symlink_rejected(self):
        other = self.root/'other.json';other.write_bytes(self.path.read_bytes())
        self.path.unlink();self.path.symlink_to(other)
        self.rejects()

    def test_receipt_parent_symlink_rejected(self):
        moved = self.close_dir.with_name('moved')
        self.close_dir.rename(moved);self.close_dir.symlink_to(moved, target_is_directory=True)
        self.rejects()

    def test_receipt_missing_and_directory_rejected(self):
        self.path.unlink();self.rejects()
        self.path.mkdir();self.rejects()

    def test_actual_receipt_hash_mismatch(self):
        self.path.write_bytes(self.path.read_bytes()+b' ')
        self.rejects()

    def test_pinned_receipt_reference_hash_mismatch(self):
        self.anchor['close_receipt']['sha256'] = '0'*64
        self.rejects()

    def test_validly_rehashed_semantically_wrong_receipt_rejected(self):
        original = self.copy(self.receipt)
        for field, value in [('kind','other'),('version',True),('registration_id','e'*64),
                             ('state_before','READY'),('created_at','2026-10-01T00:00:00Z'),
                             ('created_at','2026-10-04T00:00:00Z'),('worktree_config_sha256_after','bad')]:
            with self.subTest(field=field, value=value):
                self.receipt = self.copy(original);self.receipt[field] = value;self.pin();self.rejects()

    def test_restored_config_must_match_captured_prior(self):
        self.receipt['final']['core.hooksPath'] = {'present':True,'values':['incorrect']}
        self.pin();self.rejects()

    def test_installed_receipt_config_must_match_registration(self):
        self.receipt['installed']['core.hooksPath']['values'] = ['incorrect']
        self.pin();self.rejects()

    def test_impossible_absent_config_with_values_rejected(self):
        self.receipt['final']['core.hooksPath']['values'] = ['unexpected']
        self.anchor['core']['prior_config']['core.hooksPath']['values'] = ['unexpected']
        self.pin();self.rejects()

    def test_partial_restore_before_snapshot_remains_valid(self):
        self.receipt['before']['core.hooksPath'] = self.copy(self.receipt['final']['core.hooksPath'])
        self.pin();self.observe()

    def test_duplicate_json_keys_nonfinite_invalid_utf8_rejected(self):
        raws = [b'{"kind":"x","kind":"y"}', b'{"x":NaN}', b'\xff', b'{}', b'[]']
        for raw in raws:
            with self.subTest(raw=raw):
                self.pin(raw);self.rejects()

    def test_oversized_regular_receipt_rejected(self):
        self.pin(b' ' * 65537);self.rejects()

    def test_extra_receipt_fields_rejected(self):
        self.receipt['unexpected'] = True;self.pin();self.rejects()

    def test_anchor_drift_after_receipt_read_rejected(self):
        before = (self.copy(self.anchor),self.value['anchor_state_sha256'])
        changed = self.copy(self.anchor);changed['state_version'] += 1
        with self.assertRaisesRegex(self.p.PublicationError,'ANCHOR_SNAPSHOT_DRIFT'):
            self.observe(side_effect=[before,(changed,'9'*64)])

    def test_receipt_replacement_after_read_rejected(self):
        count = [0]
        def read(*args):
            count[0] += 1
            if count[0] == 2:
                replacement = self.path.with_name('replacement')
                replacement.write_bytes(self.path.read_bytes());replacement.replace(self.path)
            return self.copy(self.anchor),self.value['anchor_state_sha256']
        with self.assertRaisesRegex(self.p.PublicationError,'ANCHOR_SNAPSHOT_DRIFT'):
            self.observe(side_effect=read)



    def test_parent_binding_change_before_leaf_open_is_rejected(self):
        """Exercise a controlled path change inside this disposable fixture."""
        original_open = self.p.os.open
        changed = []
        detached = self.root / 'detached-anchor'
        def checked_open(path, flags, *args, **kwargs):
            if Path(path).name == 'receipt.json' and not changed:
                self.close_dir.rename(detached)
                self.close_dir.symlink_to(detached, target_is_directory=True)
                changed.append(True)
            return original_open(path, flags, *args, **kwargs)
        with self.patch.object(self.p.os, 'open', side_effect=checked_open):
            self.rejects()
        self.assertEqual(changed, [True])

    def test_parent_replaced_by_regular_directory_before_leaf_is_rejected(self):
        original_open = self.p.os.open
        raw = self.path.read_bytes()
        changed = []
        def checked_open(path, flags, *args, **kwargs):
            if Path(path).name == 'receipt.json' and not changed:
                self.close_dir.rename(self.root / 'detached-anchor')
                self.close_dir.mkdir()
                self.path.write_bytes(raw)
                changed.append(True)
            return original_open(path, flags, *args, **kwargs)
        with self.patch.object(self.p.os, 'open', side_effect=checked_open):
            self.rejects()
        self.assertEqual(changed, [True])

    def test_parent_binding_rechecked_after_registration_readback(self):
        calls = []
        def reader(*args):
            calls.append(True)
            if len(calls) == 2:
                detached = self.root / 'detached-anchor'
                self.close_dir.rename(detached)
                self.close_dir.symlink_to(detached, target_is_directory=True)
            return self.copy(self.anchor), self.value['anchor_state_sha256']
        with self.assertRaisesRegex(self.p.PublicationError, 'ANCHOR_SNAPSHOT_DRIFT'):
            self.observe(side_effect=reader)

    def test_every_directory_component_and_leaf_use_pinned_descriptors(self):
        original_open = self.p.os.open
        calls = []
        def checked_open(path, flags, *args, **kwargs):
            descriptor = original_open(path, flags, *args, **kwargs)
            calls.append((str(path), flags, kwargs.get('dir_fd'), descriptor))
            return descriptor
        with self.patch.object(self.p.os, 'open', side_effect=checked_open):
            self.observe()
        self.assertEqual([item[0] for item in calls],
                         [str(self.root), 'controllers', 'task-publication',
                          'close', self.anchor_id, 'receipt.json'])
        for name, flags, parent, descriptor in calls:
            self.assertTrue(flags & self.p.os.O_NOFOLLOW)
            self.assertTrue(flags & self.p.os.O_CLOEXEC)
            if name != str(self.root):
                self.assertIsInstance(parent, int)
            if name != 'receipt.json':
                self.assertTrue(flags & self.p.os.O_DIRECTORY)
            with self.assertRaises(OSError):
                self.p.os.fstat(descriptor)

    def test_opened_descriptors_closed_when_receipt_schema_fails(self):
        self.receipt['version'] = True
        self.pin()
        original_open = self.p.os.open
        opened = []
        def checked_open(*args, **kwargs):
            descriptor = original_open(*args, **kwargs)
            opened.append(descriptor)
            return descriptor
        with self.patch.object(self.p.os, 'open', side_effect=checked_open):
            self.rejects()
        self.assertGreaterEqual(len(opened), 6)
        for descriptor in opened:
            with self.assertRaises(OSError):
                self.p.os.fstat(descriptor)

    def test_intermediate_directory_binding_change_is_rejected(self):
        original_open = self.p.os.open
        publication = self.root / 'controllers' / 'task-publication'
        changed = []
        def checked_open(path, flags, *args, **kwargs):
            if Path(path).name == 'receipt.json' and not changed:
                detached = self.root / 'detached-publication'
                publication.rename(detached)
                publication.symlink_to(detached, target_is_directory=True)
                changed.append(True)
            return original_open(path, flags, *args, **kwargs)
        with self.patch.object(self.p.os, 'open', side_effect=checked_open):
            self.rejects()
        self.assertEqual(changed, [True])

    def pin_v2_receipt(self):
        """Actual receipt file; the existing registration double remains explicit."""
        fixture = LegacyCommonConfigEvidenceIdentityTests()
        fixture.setUp()
        fixture.value['target_registration_id'] = self.anchor_id
        fixture.value['target_core_sha256'] = self.anchor_id
        fixture.observed.update(target_registration_id=self.anchor_id,
                                target_core_sha256=self.anchor_id,
                                target_created_at=self.anchor['created_at'],
                                anchor_created_at='2026-10-02T12:00:00Z')
        reference = {'path': str(self.root/'logs/A/independent-evidence.json'),
                     'sha256': '1'*64}
        authority = {'current': {'evidence': reference, 'identity': fixture.value,
                                'anchor_created_at': fixture.observed['anchor_created_at']},
                     'history': []}
        checkpoint = self.p._legacy_common_config_close_checkpoint(
            fixture.value, fixture.observed, reference, authority)
        self.anchor['legacy_common_config_authority'] = authority
        self.receipt = self.p._legacy_common_config_redacted_close_receipt(
            self.anchor, self.receipt, checkpoint)
        self.pin()

    def test_v2_real_file_observer_accepts_value_free_receipt(self):
        self.pin_v2_receipt()
        result = self.observe()
        self.assertIs(result['anchor_close_receipt_valid'], True)
        self.assertEqual(self.receipt['version'], 2)
        self.assertNotIn('fixture-only-', self.path.read_text())
        self.assertNotIn('fixture-only-', json.dumps(result))
        self.assertNotIn('reviewer_identity', json.dumps(result))

    def test_v2_real_file_all_close_states_remain_artifact_only(self):
        self.pin_v2_receipt()
        for state in ('REVOKED', 'FAILED', 'PUBLISHED'):
            with self.subTest(state=state):
                self.receipt['state_before'] = state
                self.pin()
                result = self.observe()
                self.assertIs(result['anchor_close_receipt_valid'], True)
                self.assertNotIn('completion_valid', result)
                self.assertNotIn('publication_authority', result)

    def test_v2_real_file_preserves_partial_restore(self):
        key = 'core.hooksPath'
        self.receipt['before'][key] = self.copy(self.receipt['final'][key])
        self.pin_v2_receipt()
        self.assertIs(self.observe()['anchor_close_receipt_valid'], True)

    def test_v2_rehashed_wrong_config_digest_is_rejected(self):
        self.pin_v2_receipt()
        self.receipt['config_sha256']['final']['core.hooksPath'] = '0'*64
        self.pin()
        self.rejects()

    def test_v2_rehashed_checkpoint_drift_is_rejected(self):
        self.pin_v2_receipt()
        self.receipt['legacy_checkpoint']['binding_history_sha256'] = '0'*64
        self.pin()
        self.rejects()

    def test_v2_real_file_missing_journal_authority_is_rejected(self):
        self.pin_v2_receipt()
        del self.anchor['legacy_common_config_authority']
        self.pin()
        self.rejects()

    def test_v2_real_file_changed_journal_history_is_rejected(self):
        self.pin_v2_receipt()
        authority = self.anchor['legacy_common_config_authority']
        authority['history'].append(self.copy(authority['current']))
        self.pin()
        self.rejects()

    def test_v2_rehashed_raw_config_fields_are_rejected(self):
        self.pin_v2_receipt()
        self.receipt['installed'] = {'unsafe': 'NOT_A_CONFIGURATION_VALUE'}
        self.pin()
        self.rejects()

    def test_v2_real_file_duplicate_json_fields_are_rejected(self):
        self.pin_v2_receipt()
        raw = json.dumps(self.receipt).encode()
        self.pin(raw[:-1] + b', "version": 2}')
        self.rejects()

    def test_v2_real_file_replacement_at_registration_readback_is_rejected(self):
        self.pin_v2_receipt()
        pinned = (self.copy(self.anchor), self.value['anchor_state_sha256'])
        count = 0
        def readback(*args):
            nonlocal count
            count += 1
            if count == 2:
                replacement = self.close_dir/'receipt-replacement.json'
                replacement.write_bytes(self.path.read_bytes())
                replacement.replace(self.path)
            return self.copy(pinned)
        with self.assertRaisesRegex(self.p.PublicationError, '^LEGACY_COMMON_CONFIG_'):
            self.observe(side_effect=readback)
        self.assertEqual(count, 2)

    def test_v2_real_file_registration_readback_drift_is_rejected(self):
        self.pin_v2_receipt()
        first = (self.copy(self.anchor), self.value['anchor_state_sha256'])
        second = (self.copy(self.anchor), '0'*64)
        with self.assertRaisesRegex(self.p.PublicationError, '^LEGACY_COMMON_CONFIG_'):
            self.observe(side_effect=[first, second])



class LegacyCommonConfigEvidenceSnapshotTests(unittest.TestCase):
    """Descriptor-only mocked I/O; no host files, Git or live authority."""

    def setUp(self):
        import copy
        import json
        import stat
        from types import SimpleNamespace
        import task_publication as publication
        self.publication = publication
        self.copy = copy.deepcopy
        self.value = LegacyCommonConfigEvidenceShapeTests.evidence()
        self.raw = json.dumps(self.value).encode('utf-8')
        self.root = Path('/synthetic/control')
        self.path = str(self.root/'logs'/'review.json')
        self.digest = publication._sha_bytes(self.raw)
        self.stat = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_dev=1, st_ino=30,
                                    st_size=len(self.raw), st_mtime_ns=1, st_ctime_ns=1)
        self.directory = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_dev=1,
                                         st_ino=20, st_size=4096, st_mtime_ns=1, st_ctime_ns=1)

    def call(self, *, raw=None, digest=None, path=None, opens=None, fstats=None, stats=None):
        import io
        from unittest.mock import patch
        stream = io.BytesIO(self.raw if raw is None else raw)
        def read_fd(fd, count):
            return stream.read(count)
        def default_stat(path, **kwargs):
            return self.stat if str(path) == 'review.json' else self.directory
        with patch.object(self.publication.os, 'open', side_effect=opens or [10, 11, 12]) as opened, \
             patch.object(self.publication.os, 'close') as closed, \
             patch.object(self.publication.os, 'read', side_effect=read_fd) as read, \
             patch.object(self.publication.os, 'fstat', side_effect=fstats or [self.directory, self.directory, self.stat, self.stat]), \
             patch.object(self.publication.os, 'stat', side_effect=stats or default_stat):
            try:
                result = self.publication._legacy_common_config_evidence_snapshot(
                    self.root, self.path if path is None else path,
                    self.digest if digest is None else digest)
            finally:
                self.open_calls = list(opened.call_args_list)
                self.closed = [c.args[0] for c in closed.call_args_list]
                self.read_calls = list(read.call_args_list)
            return result

    def reject(self, **kwargs):
        with self.assertRaisesRegex(self.publication.PublicationError, '^LEGACY_COMMON_CONFIG_EVIDENCE_FILE_'):
            self.call(**kwargs)

    def test_valid_hash_bound_snapshot(self):
        result = self.call()
        self.assertEqual(result['reference'], {'path': self.path, 'sha256': self.digest})
        self.assertEqual(result['evidence'], self.value)
        self.assertEqual(self.closed, [12, 11, 10])
        self.assertEqual(set(result), {'reference', 'evidence'})

    def test_detached_snapshot(self):
        result = self.call()
        result['evidence']['review']['reviewer_identity'] = 'changed'
        self.assertNotEqual(result['evidence'], self.value)

    def test_no_follow_and_directory_relative_open(self):
        import os
        self.call()
        self.assertTrue(all(call.args[1] & os.O_NOFOLLOW for call in self.open_calls))
        self.assertEqual(self.open_calls[1].kwargs['dir_fd'], 10)
        self.assertEqual(self.open_calls[2].kwargs['dir_fd'], 11)
        self.assertTrue(self.open_calls[2].args[1] & os.O_NONBLOCK)

    def test_wrong_hash_rejected(self):
        self.reject(digest='b' * 64)
        self.assertEqual(self.closed, [12, 11, 10])

    def test_invalid_reference_rejected_before_open(self):
        for value in ['', 'relative.json', '/synthetic/other/review.json',
                      '/synthetic/control/../outside.json', self.path + '\x00',
                      '/synthetic/control/logs//review.json']:
            with self.subTest(path=value):
                self.reject(path=value)
                self.assertEqual(self.open_calls, [])

    def test_malformed_digest_rejected_before_open(self):
        for digest in ['', True, 'a' * 63, 'A' * 64, None]:
            with self.subTest(digest=digest):
                # None is the call helper's default; use the entrypoint directly.
                if digest is None:
                    with self.assertRaises(self.publication.PublicationError):
                        self.publication._legacy_common_config_evidence_snapshot(self.root, self.path, digest)
                else:
                    self.reject(digest=digest)
                    self.assertEqual(self.open_calls, [])

    def test_open_failure_closes_prior_descriptors(self):
        for opens, expected in [([OSError('unavailable')], []),
                                ([10, OSError('unavailable')], [10]),
                                ([10, 11, OSError('unavailable')], [11, 10])]:
            with self.subTest(opens=len(opens)):
                self.reject(opens=opens)
                self.assertEqual(self.closed, expected)

    def test_symlink_leaf_rejected(self):
        import stat
        bad = self.copy(self.stat); bad.st_mode = stat.S_IFLNK | 0o777
        self.reject(fstats=[self.directory, self.directory, bad])
        self.assertEqual(self.read_calls, [])

    def test_non_regular_files_rejected(self):
        import stat
        for mode in [stat.S_IFIFO, stat.S_IFDIR, stat.S_IFSOCK, stat.S_IFCHR]:
            with self.subTest(mode=mode):
                bad = self.copy(self.stat); bad.st_mode = mode
                self.reject(fstats=[self.directory, self.directory, bad])
                self.assertEqual(self.read_calls, [])

    def test_empty_and_oversized_file_rejected_before_read(self):
        for size in [0, 65537]:
            with self.subTest(size=size):
                bad=self.copy(self.stat);bad.st_size=size
                self.reject(fstats=[self.directory,self.directory,bad])
                self.assertEqual(self.read_calls, [])

    def test_truncated_read_rejected(self):
        self.reject(raw=self.raw[:-1], digest=self.publication._sha_bytes(self.raw[:-1]))

    def test_replaced_leaf_rejected(self):
        bad=self.copy(self.stat);bad.st_ino+=1
        self.reject(stats=[self.directory, self.directory, bad])

    def test_file_mutation_during_read_rejected(self):
        for field in ['st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_ino']:
            with self.subTest(field=field):
                bad=self.copy(self.stat);setattr(bad,field,getattr(bad,field)+1)
                self.reject(fstats=[self.directory,self.directory,self.stat,bad])

    def test_directory_replacement_rejected(self):
        bad=self.copy(self.directory);bad.st_ino+=1
        self.reject(stats=[self.directory,bad])

    def test_root_replacement_rejected(self):
        bad=self.copy(self.directory);bad.st_ino+=1
        self.reject(stats=[bad])

    def test_invalid_json_and_encoding_rejected(self):
        for raw in [b'{', b'\xff', b'{"x":NaN}', b'{"x":Infinity}', b'{"x":-Infinity}']:
            with self.subTest(raw=raw):
                self.stat.st_size=len(raw)
                self.reject(raw=raw,digest=self.publication._sha_bytes(raw))

    def test_duplicate_top_level_and_nested_fields_rejected(self):
        import json
        raw=json.dumps(self.value).encode()
        variants=[raw.replace(b'"version": 1',b'"version": 1, "version": 1'),
                  raw.replace(b'"verdict": "PASS"',b'"verdict": "PASS", "verdict": "PASS"')]
        for payload in variants:
            with self.subTest(size=len(payload)):
                self.assertNotEqual(payload,raw)
                self.stat.st_size=len(payload)
                self.reject(raw=payload,digest=self.publication._sha_bytes(payload))

    def test_wrong_evidence_schema_rejected(self):
        payload=b'{"kind":"not-legacy-evidence"}'
        self.stat.st_size=len(payload)
        self.reject(raw=payload,digest=self.publication._sha_bytes(payload))

    def test_file_read_error_closes_all_descriptors(self):
        from unittest.mock import patch
        with patch.object(self.publication.os,'open',side_effect=[10,11,12]), \
             patch.object(self.publication.os,'fstat',side_effect=[self.directory,self.directory,self.stat]), \
             patch.object(self.publication.os,'read',side_effect=OSError('private value')), \
             patch.object(self.publication.os,'close') as closed:
            with self.assertRaisesRegex(self.publication.PublicationError,'^LEGACY_COMMON_CONFIG_EVIDENCE_FILE_INVALID$'):
                self.publication._legacy_common_config_evidence_snapshot(self.root,self.path,self.digest)
            self.assertEqual([x.args[0] for x in closed.call_args_list],[12,11,10])

    def test_hash_match_is_not_a_review_or_bind_permission(self):
        result=self.call()
        self.assertNotIn('reviewer_independence_verified',result)
        self.assertNotIn('authority',result)
        self.assertNotIn('anchor_close_receipt_valid',result)

    def test_error_message_contains_no_input_or_file_content(self):
        raw=b'PRIVATE_SENTINEL_0955'
        self.stat.st_size=len(raw)
        try:
            self.call(raw=raw,digest=self.publication._sha_bytes(raw))
        except self.publication.PublicationError as exc:
            self.assertNotIn('PRIVATE_SENTINEL',str(exc))
            self.assertNotIn(self.path,str(exc))
        else:
            self.fail('Invalid private content accepted')




class LegacyCommonConfigRedactedReceiptTests(unittest.TestCase):
    """Pure receipt compatibility; no Git, filesystem or runtime authority."""

    def setUp(self):
        import copy
        import task_publication as publication
        self.copy, self.p = copy.deepcopy, publication
        fixture = LegacyCommonConfigEvidenceIdentityTests()
        fixture.setUp()
        reference = {"path": "/control/logs/A/approved.json", "sha256": "1" * 64}
        authority = {"current": {"evidence": reference, "identity": fixture.value,
                                "anchor_created_at": fixture.observed["anchor_created_at"]}, "history": []}
        self.checkpoint = publication._legacy_common_config_close_checkpoint(
            fixture.value, fixture.observed, reference, authority)
        prior = {"core.hooksPath": {"present": False, "values": []},
                 "remote.origin.pushurl": {"present": True, "values": ["OLD_SECRET_A", "OLD_SECRET_B"]}}
        installed = {"core.hooksPath": {"present": True, "values": ["INSTALLED_SECRET"]},
                     "remote.origin.pushurl": {"present": True, "values": ["NEW_SECRET"]}}
        self.anchor = {"registration_id": fixture.value["target_registration_id"], "state": "CLOSED",
                       "created_at": "2026-10-01T00:00:00Z", "updated_at": "2026-10-07T11:00:00Z",
                       "core": {"prior_config": prior},
                       "installed_config": dict(installed, owned_keys=list(installed)),
                       "legacy_common_config_authority": authority}
        self.ordinary = {"kind": "octoport.task-publication-close", "version": 1,
                         "registration_id": self.anchor["registration_id"], "state_before": "REVOKED",
                         "before": self.copy(installed), "installed": self.copy(installed), "final": self.copy(prior),
                         "worktree_config_sha256_after": "2" * 64, "created_at": "2026-10-07T10:59:00Z"}

    def make(self):
        return self.p._legacy_common_config_redacted_close_receipt(
            self.anchor, self.ordinary, self.checkpoint)

    def validate(self, receipt):
        return self.p._legacy_common_config_validate_close_receipt(self.anchor, receipt)

    def test_new_format_is_readable_without_raw_config_values(self):
        receipt = self.make()
        self.assertEqual(receipt["version"], 2)
        self.validate(receipt)
        text = json.dumps(receipt)
        for secret in ["OLD_SECRET_A", "OLD_SECRET_B", "INSTALLED_SECRET", "NEW_SECRET", "synthetic reviewer A"]:
            self.assertNotIn(secret, text)
        self.assertNotIn("before", receipt)
        self.assertNotIn("installed", receipt)
        self.assertNotIn("final", receipt)

    def test_ordinary_receipt_stays_readable(self):
        self.validate(self.ordinary)
        self.anchor.pop("legacy_common_config_authority")
        self.validate(self.ordinary)

    def test_serialization_is_detached_and_deterministic(self):
        before = self.copy((self.anchor, self.ordinary, self.checkpoint))
        one, two = self.make(), self.make()
        self.assertEqual(one, two)
        one["legacy_checkpoint"]["evidence"]["path"] = "/changed"
        self.assertEqual(before, (self.anchor, self.ordinary, self.checkpoint))
        self.assertNotEqual(one, two)

    def test_partial_restore_is_valid_in_both_formats(self):
        self.ordinary["before"]["core.hooksPath"] = self.copy(self.ordinary["final"]["core.hooksPath"])
        self.validate(self.ordinary)
        self.validate(self.make())

    def test_config_order_absent_and_empty_remain_distinct(self):
        self.ordinary["final"]["remote.origin.pushurl"]["values"].reverse()
        with self.assertRaises(self.p.PublicationError): self.validate(self.ordinary)
        self.ordinary["final"] = self.copy(self.anchor["core"]["prior_config"])
        self.ordinary["final"]["core.hooksPath"] = {"present": True, "values": []}
        with self.assertRaises(self.p.PublicationError): self.make()

    def test_invalid_ordinary_config_is_not_hidden_by_hashing(self):
        for stage in ("before", "installed", "final"):
            for bad in ({"present": False, "values": ["NOT_ABSENT"]}, {"present": 1, "values": []},
                        {"present": True, "values": "not-list"}, {"present": True, "values": [], "extra": 1}):
                with self.subTest(stage=stage, bad=bad):
                    original = self.copy(self.ordinary)
                    self.ordinary[stage]["core.hooksPath"] = bad
                    with self.assertRaises(self.p.PublicationError): self.make()
                    self.ordinary = original

    def test_wrong_hashes_and_hash_maps_reject(self):
        for stage in ("before", "installed", "final"):
            for replacement in ("f" * 64, True, None, "invalid"):
                with self.subTest(stage=stage, replacement=replacement):
                    receipt = self.make()
                    receipt["config_sha256"][stage]["core.hooksPath"] = replacement
                    with self.assertRaises(self.p.PublicationError): self.validate(receipt)
        for key in ("extra", "missing"):
            receipt = self.make()
            if key == "extra": receipt["config_sha256"]["final"]["foreign"] = "f" * 64
            else: receipt["config_sha256"].pop("before")
            with self.assertRaises(self.p.PublicationError): self.validate(receipt)

    def test_versions_and_identity_are_exact(self):
        for version in (True, False, 0, 3, "2", 2.0):
            with self.subTest(version=version):
                receipt = self.make(); receipt["version"] = version
                with self.assertRaises(self.p.PublicationError): self.validate(receipt)
        for key, value in (("kind", "foreign"), ("registration_id", "f" * 64),
                           ("state_before", "READY"), ("state_before", []),
                           ("worktree_config_sha256_after", "not-a-hash")):
            receipt = self.make(); receipt[key] = value
            with self.assertRaises(self.p.PublicationError): self.validate(receipt)

    def test_mixed_or_extra_receipt_fields_reject(self):
        for key in ("before", "installed", "final", "extra"):
            receipt = self.make(); receipt[key] = {}
            with self.assertRaises(self.p.PublicationError): self.validate(receipt)
        receipt = self.make(); receipt.pop("legacy_checkpoint")
        with self.assertRaises(self.p.PublicationError): self.validate(receipt)

    def test_time_order_and_timezone_are_preserved(self):
        for value in (None, True, "2026-10-07T10:00:00", "2026-09-01T00:00:00Z", "2026-11-01T00:00:00Z"):
            for version in (1, 2):
                with self.subTest(value=value, version=version):
                    receipt = self.copy(self.ordinary) if version == 1 else self.make()
                    receipt["created_at"] = value
                    with self.assertRaises(self.p.PublicationError): self.validate(receipt)

    def test_frozen_checkpoint_drift_rejects(self):
        for key in self.checkpoint:
            receipt = self.make(); receipt["legacy_checkpoint"][key] = None
            with self.subTest(key=key):
                with self.assertRaises(self.p.PublicationError): self.validate(receipt)
        receipt = self.make(); receipt["legacy_checkpoint"]["version"] = True
        with self.assertRaises(self.p.PublicationError): self.validate(receipt)
        receipt = self.make(); receipt["legacy_checkpoint"]["extra"] = "injected"
        with self.assertRaises(self.p.PublicationError): self.validate(receipt)

    def test_authority_and_full_history_are_bound(self):
        receipt = self.make()
        authority = self.anchor["legacy_common_config_authority"]
        authority["history"].append(self.copy(authority["current"]))
        with self.assertRaises(self.p.PublicationError): self.validate(receipt)
        authority["history"].clear()
        authority["current"]["identity"]["review"]["reviewer_identity"] = "other reviewer"
        with self.assertRaises(self.p.PublicationError): self.validate(receipt)

    def test_missing_or_wrong_authority_cannot_accept_v2(self):
        receipt = self.make()
        for bad in (None, {}, {"current": {}, "history": []}, {"current": {}, "history": False}):
            self.anchor["legacy_common_config_authority"] = bad
            with self.assertRaises(self.p.PublicationError): self.validate(receipt)

    def test_error_does_not_echo_raw_configuration(self):
        self.ordinary["final"]["core.hooksPath"] = {"present": True, "values": ["DO_NOT_ECHO_SECRET"]}
        with self.assertRaises(self.p.PublicationError) as error: self.make()
        self.assertNotIn("DO_NOT_ECHO_SECRET", str(error.exception))

    def test_encoder_has_no_filesystem_or_state_effects(self):
        from unittest.mock import patch
        with patch("builtins.open", side_effect=AssertionError("unexpected filesystem")), \
                patch.object(self.p, "_state_transition", side_effect=AssertionError("unexpected state write")):
            self.validate(self.make())


if __name__ == "__main__":
    unittest.main()


class LegacyCommonConfigCloseConstructionTests(unittest.TestCase):
    """Creation before CLOSED and archival verification are different phases."""

    def setUp(self):
        import copy
        from unittest import mock
        from datetime import datetime, timezone
        fixture = LegacyCommonConfigRedactedReceiptTests()
        fixture.setUp()
        self.copy, self.p, self.mock = copy.deepcopy, fixture.p, mock
        self.registration = self.copy(fixture.anchor)
        self.registration['state'] = 'REVOKED'
        self.registration['updated_at'] = '2026-10-07T09:00:00Z'
        self.before = self.copy(fixture.ordinary['before'])
        self.after = self.copy(fixture.ordinary['final'])
        self.checkpoint = self.copy(fixture.checkpoint)
        self.digest = fixture.ordinary['worktree_config_sha256_after']
        self.instant = datetime(2026, 10, 7, 12, 0, 0, 654321, tzinfo=timezone.utc).timestamp()
        clock = mock.patch.object(self.p.time, 'time', return_value=self.instant)
        clock.start()
        self.addCleanup(clock.stop)

    def construct(self):
        return self.p._legacy_common_config_construct_close_receipt(
            self.registration, self.before, self.after, self.digest, self.checkpoint)

    def archive(self, receipt):
        closed = self.copy(self.registration)
        closed['state'] = 'CLOSED'
        closed['updated_at'] = receipt['created_at']
        self.p._legacy_common_config_validate_close_receipt(closed, receipt)

    def test_receipt_can_be_created_before_closed_state_is_recorded(self):
        receipt = self.construct()
        self.assertEqual(receipt['version'], 2)
        self.assertEqual(receipt['created_at'], '2026-10-07T12:00:00Z')
        self.assertEqual(self.registration['updated_at'], '2026-10-07T09:00:00Z')
        self.assertEqual(self.registration['state'], 'REVOKED')
        with self.assertRaises(self.p.PublicationError):
            self.p._legacy_common_config_validate_close_receipt(self.registration, receipt)
        self.archive(receipt)

    def test_inputs_and_registration_timestamps_are_never_rewritten(self):
        original = self.copy((self.registration, self.before, self.after, self.checkpoint))
        self.construct()
        self.assertEqual(original, (self.registration, self.before, self.after, self.checkpoint))

    def test_all_existing_close_prestates_are_observations_only(self):
        for state in ('PUBLISHED', 'REVOKED', 'FAILED'):
            with self.subTest(state=state):
                self.registration['state'] = state
                receipt = self.construct()
                self.assertEqual(receipt['state_before'], state)
                self.archive(receipt)

    def test_invalid_or_already_closed_state_is_rejected(self):
        for state in ('CLOSED', 'READY', 'REGISTERED', 'TASK_REF_PUBLISHED', None, True):
            with self.subTest(state=state):
                self.registration['state'] = state
                with self.assertRaises(self.p.PublicationError):
                    self.construct()

    def test_clock_before_last_registration_update_is_rejected(self):
        self.registration['updated_at'] = '2026-10-07T12:00:01Z'
        with self.assertRaises(self.p.PublicationError):
            self.construct()

    def test_reversed_registration_times_are_rejected(self):
        self.registration['created_at'] = '2026-10-07T10:00:00Z'
        with self.assertRaises(self.p.PublicationError):
            self.construct()

    def test_bad_or_naive_registration_timestamp_is_rejected(self):
        for key in ('created_at', 'updated_at'):
            original = self.registration[key]
            for value in ('bad time', '2026-10-07T08:00:00', True, None):
                with self.subTest(key=key, value=value):
                    self.registration[key] = value
                    with self.assertRaises(self.p.PublicationError):
                        self.construct()
            self.registration[key] = original

    def test_missing_registration_timestamp_is_rejected(self):
        self.registration.pop('updated_at')
        with self.assertRaises(self.p.PublicationError):
            self.construct()

    def test_clock_failure_is_sanitized_and_has_no_mutation(self):
        with self.mock.patch.object(self.p.time, 'time', side_effect=OSError('private-clock-detail')):
            with self.assertRaises(self.p.PublicationError) as raised:
                self.construct()
        self.assertNotIn('private-clock-detail', str(raised.exception))

    def test_future_receipt_is_still_rejected_by_archived_validator(self):
        receipt = self.construct()
        closed = self.copy(self.registration)
        closed['state'] = 'CLOSED'
        closed['updated_at'] = '2026-10-07T11:59:59Z'
        with self.assertRaises(self.p.PublicationError):
            self.p._legacy_common_config_validate_close_receipt(closed, receipt)

    def test_original_archived_converter_keeps_its_time_boundary(self):
        ordinary = {'kind': 'octoport.task-publication-close', 'version': 1,
                    'registration_id': self.registration['registration_id'], 'state_before': 'REVOKED',
                    'before': self.before, 'installed': self.before, 'final': self.after,
                    'worktree_config_sha256_after': self.digest, 'created_at': '2026-10-07T12:00:00Z'}
        with self.assertRaises(self.p.PublicationError):
            self.p._legacy_common_config_redacted_close_receipt(self.registration, ordinary, self.checkpoint)

    def test_partial_restore_is_compatible(self):
        self.before['core.hooksPath'] = self.copy(self.after['core.hooksPath'])
        self.archive(self.construct())

    def test_unrestored_final_config_is_rejected_without_values_in_error(self):
        self.after['remote.origin.pushurl']['values'] = ['PRIVATE_UNRESTORED_VALUE']
        with self.assertRaises(self.p.PublicationError) as raised:
            self.construct()
        self.assertNotIn('PRIVATE_UNRESTORED_VALUE', str(raised.exception))

    def test_foreign_before_config_is_rejected(self):
        self.before['core.hooksPath']['values'] = ['foreign']
        with self.assertRaises(self.p.PublicationError):
            self.construct()

    def test_invalid_config_digest_is_rejected(self):
        self.digest = 'not a digest'
        with self.assertRaises(self.p.PublicationError):
            self.construct()

    def test_checkpoint_drift_is_rejected(self):
        self.checkpoint['authority_sha256'] = '9' * 64
        with self.assertRaises(self.p.PublicationError):
            self.construct()

    def test_missing_authority_is_rejected(self):
        self.registration.pop('legacy_common_config_authority')
        with self.assertRaises(self.p.PublicationError):
            self.construct()

    def test_output_contains_no_configuration_or_reviewer_values(self):
        raw = json.dumps(self.construct())
        for forbidden in ('OLD_SECRET_A', 'OLD_SECRET_B', 'INSTALLED_SECRET', 'NEW_SECRET', 'synthetic reviewer A'):
            self.assertNotIn(forbidden, raw)

    def test_result_is_detached_from_all_inputs(self):
        receipt = self.construct()
        receipt['legacy_checkpoint']['evidence']['path'] = '/changed'
        self.assertNotEqual(receipt['legacy_checkpoint'], self.checkpoint)
        self.assertEqual(self.registration['updated_at'], '2026-10-07T09:00:00Z')

    def test_constructor_does_not_persist_or_restore_settings(self):
        with self.mock.patch.object(self.p, '_state_transition') as transition, \
                self.mock.patch.object(self.p, '_create_once_json') as persist, \
                self.mock.patch.object(self.p, '_set_config_values') as restore:
            self.construct()
            transition.assert_not_called()
            persist.assert_not_called()
            restore.assert_not_called()

    def test_seconds_precision_is_compatible_with_same_second_closed_state(self):
        receipt = self.construct()
        self.assertNotIn('.', receipt['created_at'])
        self.archive(receipt)



class LegacyCommonConfigCurrentAuthorityObservationTests(unittest.TestCase):
    """Current authority observation with mocked external reads; never writes."""

    def setUp(self):
        import copy
        import subprocess
        from unittest import mock
        import task_publication as publication
        fixture = LegacyCommonConfigEvidenceIdentityTests()
        fixture.setUp()
        self.copy, self.p, self.mock = copy.deepcopy, publication, mock
        self.value, self.review = self.copy(fixture.value), self.copy(fixture.value["review"])
        self.worktree = Path("/synthetic/target")
        self.registration = {
            "registration_id": self.value["target_registration_id"],
            "created_at": fixture.observed["target_created_at"],
            "core": {
                "role": self.value["role"], "task_id": self.value["task_id"],
                "candidate_head": self.value["candidate_sha"],
                "candidate_tree": self.value["candidate_tree"], "base_sha": self.value["base_sha"],
                "task_ref": self.value["task_ref"], "worktree_path": str(self.worktree),
                "common_config_sha256": self.value["registered_common_config_sha256"],
                "global_config_sha256": self.value["global_config_sha256"],
                "fixed_role_config_sha256": self.copy(self.value["fixed_role_config_sha256"]),
                "remote": "origin", "push_target": "https://github.com/example/repo.git",
                "pushurl_override": None,
            },
        }
        self.anchor = {
            "anchor_registration_id": self.value["anchor_registration_id"],
            "anchor_state": "CLOSED", "anchor_state_version": self.value["anchor_state_version"],
            "anchor_state_sha256": self.value["anchor_state_sha256"],
            "anchor_candidate_sha": self.value["anchor_candidate_sha"],
            "anchor_created_at": fixture.observed["anchor_created_at"],
            "anchor_close_receipt_sha256": self.value["anchor_close_receipt_sha256"],
            "anchor_close_receipt_valid": True,
            "anchor_common_config_sha256": self.value["current_common_config_sha256"],
            "anchor_global_config_sha256": self.value["global_config_sha256"],
            "anchor_fixed_role_config_sha256": self.copy(self.value["fixed_role_config_sha256"]),
        }



class LegacyCommonConfigCurrentAuthorityObservationTests(unittest.TestCase):
    """Current authority observation with mocked external reads; never writes."""

    def setUp(self):
        import copy
        import subprocess
        from unittest import mock
        import task_publication as publication
        fixture = LegacyCommonConfigEvidenceIdentityTests()
        fixture.setUp()
        self.copy, self.p, self.mock = copy.deepcopy, publication, mock
        self.value, self.review = self.copy(fixture.value), self.copy(fixture.value["review"])
        self.worktree = Path("/synthetic/target")
        self.registration = {
            "registration_id": self.value["target_registration_id"],
            "created_at": fixture.observed["target_created_at"],
            "core": {
                "role": self.value["role"], "task_id": self.value["task_id"],
                "candidate_head": self.value["candidate_sha"],
                "candidate_tree": self.value["candidate_tree"], "base_sha": self.value["base_sha"],
                "task_ref": self.value["task_ref"], "worktree_path": str(self.worktree),
                "common_config_sha256": self.value["registered_common_config_sha256"],
                "global_config_sha256": self.value["global_config_sha256"],
                "fixed_role_config_sha256": self.copy(self.value["fixed_role_config_sha256"]),
                "remote": "origin", "push_target": "https://github.com/example/repo.git",
                "pushurl_override": None,
            },
        }
        self.anchor = {
            "anchor_registration_id": self.value["anchor_registration_id"],
            "anchor_state": "CLOSED", "anchor_state_version": self.value["anchor_state_version"],
            "anchor_state_sha256": self.value["anchor_state_sha256"],
            "anchor_candidate_sha": self.value["anchor_candidate_sha"],
            "anchor_created_at": fixture.observed["anchor_created_at"],
            "anchor_close_receipt_sha256": self.value["anchor_close_receipt_sha256"],
            "anchor_close_receipt_valid": True,
            "anchor_common_config_sha256": self.value["current_common_config_sha256"],
            "anchor_global_config_sha256": self.value["global_config_sha256"],
            "anchor_fixed_role_config_sha256": self.copy(self.value["fixed_role_config_sha256"]),
        }

        def patch(name, **kwargs):
            manager = mock.patch.object(self.p, name, autospec=True, **kwargs)
            value = manager.start(); self.addCleanup(manager.stop); return value
        self.common = patch("_common_config_digest", return_value=self.value["current_common_config_sha256"])
        self.global_digest = patch("_global_config_digest", return_value=self.value["global_config_sha256"])
        self.fixed = patch("_fixed_role_config_digests", return_value=self.copy(self.value["fixed_role_config_sha256"]))
        self.ownership = patch("_ownership", return_value=({"roles": {}}, "policy"))
        self.matcher = patch("_common_config_matches_registered", return_value=False)
        self.remote_main = patch("_authority_remote_oid_target", return_value=self.value["current_main_sha"])
        self.process = mock.patch.object(
            self.p.subprocess, "run", autospec=True,
            return_value=subprocess.CompletedProcess([], 0, "", "")
        )
        self.run = self.process.start(); self.addCleanup(self.process.stop)
        hashes = self.p._legacy_common_config_transport_hashes(self.registration["core"])
        self.value.update(hashes)
        self.anchor.update({
            "anchor_remote_identity_sha256": hashes["remote_identity_sha256"],
            "anchor_push_identity_sha256": hashes["push_identity_sha256"],
            "anchor_pushurl_identity_sha256": hashes["pushurl_identity_sha256"],
        })

    def observe(self):
        return self.p._legacy_common_config_current_observation(
            Path("/control"), self.registration, self.value, self.anchor, self.review)

    def reject(self, code):
        with self.assertRaisesRegex(self.p.PublicationError, "^" + code + "$"):
            self.observe()

    def test_success_is_complete_detached_observation(self):
        result = self.observe()
        self.assertEqual(result["review"], self.review)
        self.assertTrue(result["reviewer_independence_verified"])
        self.assertEqual(result["current_main_sha"], self.value["current_main_sha"])
        self.assertTrue(result["anchor_is_ancestor_of_main"])
        result["review"]["reviewer_identity"] = "changed result"
        self.assertNotEqual(result["review"], self.review)

    def test_same_role_reviewer_is_not_independent(self):
        self.review["reviewer_role"] = self.registration["core"]["role"]
        self.value["review"] = self.copy(self.review)
        self.reject("LEGACY_COMMON_CONFIG_REVIEW_NOT_INDEPENDENT")

    def test_observed_reviewer_must_match_evidence(self):
        self.review["reviewer_identity"] = "different observed reviewer"
        self.reject("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")

    def test_target_core_identity_drift_is_rejected(self):
        self.registration["core"]["candidate_head"] = "9" * 40
        self.reject("LEGACY_COMMON_CONFIG_TARGET_IDENTITY_MISMATCH")

    def test_current_common_global_and_fixed_drift_fail_closed(self):
        for mocker, bad in [
            (self.common, "8" * 64),
            (self.global_digest, "8" * 64),
            (self.fixed, {role: "8" * 64 for role in "ABC"}),
        ]:
            with self.subTest(mocker=mocker):
                original = mocker.return_value
                mocker.return_value = bad
                self.reject("LEGACY_COMMON_CONFIG_CURRENT_AUTHORITY_MISMATCH")
                mocker.return_value = original

    def test_ordinary_match_means_bridge_is_not_required(self):
        self.matcher.return_value = True
        self.reject("LEGACY_COMMON_CONFIG_BRIDGE_NOT_REQUIRED")

    def test_remote_main_must_be_exact_nonzero_evidence_value(self):
        self.remote_main.return_value = "8" * 40
        self.reject("LEGACY_COMMON_CONFIG_CURRENT_MAIN_MISMATCH")
        self.remote_main.return_value = self.p.ZERO_OID
        self.reject("LEGACY_COMMON_CONFIG_CURRENT_MAIN_MISMATCH")

    def test_anchor_transport_must_match_target_transport(self):
        self.anchor["anchor_push_identity_sha256"] = "8" * 64
        self.reject("LEGACY_COMMON_CONFIG_ANCHOR_TRANSPORT_MISMATCH")

    def test_anchor_lineage_must_be_proven(self):
        import subprocess
        self.run.return_value = subprocess.CompletedProcess([], 1, "", "")
        self.reject("LEGACY_COMMON_CONFIG_ANCHOR_LINEAGE_UNVERIFIED")
        self.run.return_value = subprocess.CompletedProcess([], 128, "", "private error")
        self.reject("LEGACY_COMMON_CONFIG_ANCHOR_LINEAGE_UNVERIFIED")

    def test_observer_never_writes_state_or_config(self):
        with self.mock.patch.object(self.p, "_state_transition") as state, \
                self.mock.patch.object(self.p, "_set_config_values") as config:
            self.observe()
            state.assert_not_called()
            config.assert_not_called()


class LegacyCommonConfigJournalApplyTests(unittest.TestCase):
    """Registration-journal CAS application only; no authority observation or live I/O."""

    def setUp(self):
        import copy
        from contextlib import nullcontext
        from unittest import mock
        import task_publication as publication
        fixture = LegacyCommonConfigBindingTransitionTests()
        fixture.setUp()
        initial = fixture.transition()["authority"]
        self.copy, self.p, self.mock = copy.deepcopy, publication, mock
        self.registration_id = fixture.value["target_registration_id"]
        self.current = {
            "registration_id": self.registration_id,
            "registration_sha256": self.registration_id,
            "state": "REVOKED",
            "state_version": 7,
            "core": {"role": "B"},
            "legacy_common_config_authority": self.copy(initial),
        }
        fixture.authority = self.copy(initial)
        fixture.next_epoch()
        self.next_authority = fixture.transition()["authority"]
        self.transition = {"changed": True, "authority": self.copy(self.next_authority)}
        self.read = mock.patch.object(
            self.p, "_read_registration",
            return_value=(self.copy(self.current), "f" * 64)
        ).start()
        self.addCleanup(mock.patch.stopall)
        self.locks = mock.patch.object(
            self.p, "_role_and_coord_locks", return_value=nullcontext()
        ).start()
        self.writer = mock.patch.object(
            self.p, "_state_transition",
            return_value=dict(self.current, state_version=8,
                              legacy_common_config_authority=self.copy(self.next_authority))
        ).start()
        self.set_config = mock.patch.object(self.p, "_set_config_values").start()

    _DEFAULT_RESULT = object()

    def apply(self, *, expected_version=7, expected_state="REVOKED",
              result=_DEFAULT_RESULT):
        return self.p._legacy_common_config_apply_binding_transition(
            Path("/control"), self.registration_id, expected_state,
            expected_version,
            self.transition if result is self._DEFAULT_RESULT else result)

    def reject(self, code, **kwargs):
        with self.assertRaisesRegex(self.p.PublicationError, "^" + code + "$"):
            self.apply(**kwargs)
        self.writer.assert_not_called()
        self.set_config.assert_not_called()

    def test_changed_transition_uses_same_state_and_exact_version_cas(self):
        result = self.apply()
        self.writer.assert_called_once()
        args = self.writer.call_args.args
        kwargs = self.writer.call_args.kwargs
        self.assertEqual(args[1], self.registration_id)
        self.assertEqual(args[2], {"REVOKED"})
        self.assertEqual(args[3], "REVOKED")
        self.assertEqual(args[4], {"legacy_common_config_authority": self.next_authority})
        self.assertEqual(kwargs["expected_version"], 7)
        self.assertEqual(result["state_version"], 8)
        self.set_config.assert_not_called()

    def test_exact_replay_returns_current_bytes_without_state_write(self):
        result = self.apply(result={
            "changed": False,
            "authority": self.copy(self.current["legacy_common_config_authority"]),
        })
        self.writer.assert_not_called()
        self.assertEqual(result, self.current)
        result["legacy_common_config_authority"]["history"].append({})
        self.assertEqual(self.current["legacy_common_config_authority"]["history"], [])

    def test_replay_authority_drift_is_rejected(self):
        bad = self.copy(self.current["legacy_common_config_authority"])
        bad["current"]["anchor_created_at"] = "2026-10-09T00:00:00Z"
        self.reject("LEGACY_COMMON_CONFIG_BIND_REPLAY_DRIFT",
                    result={"changed": False, "authority": bad})

    def test_state_or_version_drift_fails_before_writer(self):
        self.reject("LEGACY_COMMON_CONFIG_BIND_CAS_DRIFT", expected_state="FAILED")
        self.reject("LEGACY_COMMON_CONFIG_BIND_CAS_DRIFT", expected_version=8)

    def test_malformed_transition_is_rejected(self):
        for bad in (None, {}, {"changed": True}, {"changed": "yes", "authority": {}}):
            with self.subTest(bad=bad):
                self.reject("LEGACY_COMMON_CONFIG_BIND_TRANSITION_INVALID", result=bad)

    def test_initial_binding_must_start_with_empty_history(self):
        record = self.copy(self.current)
        record.pop("legacy_common_config_authority")
        self.read.return_value = (record, "f" * 64)
        bad = self.copy(self.next_authority)
        bad["history"] = [self.copy(bad["current"])]
        self.reject("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID",
                    result={"changed": True, "authority": bad})

    def test_rebind_must_append_previous_current_verbatim(self):
        bad = self.copy(self.next_authority)
        bad["history"][0]["anchor_created_at"] = "2026-10-09T00:00:00Z"
        self.reject("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID",
                    result={"changed": True, "authority": bad})

    def test_every_binding_must_target_same_registration(self):
        bad = self.copy(self.next_authority)
        bad["current"]["identity"]["target_registration_id"] = "9" * 64
        bad["current"]["identity"]["target_core_sha256"] = "9" * 64
        self.reject("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID",
                    result={"changed": True, "authority": bad})

    def test_writer_never_mutates_config_or_remote(self):
        remote = self.mock.patch.object(self.p, "_supersede_remote_state").start()
        main = self.mock.patch.object(self.p, "_authority_remote_oid_target").start()
        self.apply()
        self.set_config.assert_not_called()
        remote.assert_not_called()
        main.assert_not_called()


    def test_registration_identity_mismatch_fails_before_writer(self):
        bad = self.copy(self.current)
        bad["registration_sha256"] = "8" * 64
        self.read.return_value = (bad, "f" * 64)
        self.reject("LEGACY_COMMON_CONFIG_BIND_CAS_DRIFT")

    def test_rebind_stable_identity_drift_is_rejected(self):
        bad = self.copy(self.next_authority)
        bad["current"]["identity"]["global_config_sha256"] = "8" * 64
        self.reject("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID",
                    result={"changed": True, "authority": bad})

    def test_invalid_evidence_reference_is_rejected(self):
        bad = self.copy(self.next_authority)
        bad["current"]["evidence"]["path"] = "/control/../escape.json"
        self.reject("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID",
                    result={"changed": True, "authority": bad})

    def test_changed_true_cannot_rewrite_same_current(self):
        bad = self.copy(self.current["legacy_common_config_authority"])
        bad["history"] = [self.copy(bad["current"])]
        self.reject("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID",
                    result={"changed": True, "authority": bad})


class LegacyCommonConfigBindOrchestrationTests(unittest.TestCase):
    """One-lock bind orchestration with mocked observers; no live authority."""

    def setUp(self):
        import copy
        from contextlib import contextmanager
        from unittest import mock
        import task_publication as publication
        fixture = LegacyCommonConfigBindingTransitionTests()
        fixture.setUp()
        self.copy, self.p, self.mock = copy.deepcopy, publication, mock
        self.registration_id = fixture.value["target_registration_id"]
        self.evidence = self.copy(fixture.value)
        self.review_observation = self.copy(fixture.value["review"])
        self.reference = {"path": "/control/logs/reviewed-evidence.json", "sha256": "6" * 64}
        self.registration = {
            "registration_id": self.registration_id,
            "registration_sha256": self.registration_id,
            "state": "TASK_REF_PUBLISHED",
            "state_version": 4,
            "core": {"role": "B"},
        }
        self.anchor = {"anchor_registration_id": self.evidence["anchor_registration_id"]}
        self.observed = self.copy(fixture.observed)
        self.facts = self.copy(fixture.facts)
        self.planned = fixture.transition()
        self.result = dict(self.registration, state_version=5,
                           legacy_common_config_authority=self.copy(self.planned["authority"]))
        self.lock_active = False

        @contextmanager
        def locks(root, role):
            self.assertFalse(self.lock_active)
            self.lock_active = True
            try:
                yield
            finally:
                self.lock_active = False

        self.locks = mock.patch.object(self.p, "_role_and_coord_locks", side_effect=locks).start()
        self.addCleanup(mock.patch.stopall)
        self.read = mock.patch.object(
            self.p, "_read_registration",
            return_value=(self.copy(self.registration), "f" * 64)
        ).start()

        def inside(value):
            def effect(*args, **kwargs):
                self.assertTrue(self.lock_active)
                return self.copy(value)
            return effect

        self.snapshot = mock.patch.object(
            self.p, "_legacy_common_config_evidence_snapshot",
            side_effect=inside({"reference": self.reference, "evidence": self.evidence})
        ).start()
        self.anchor_read = mock.patch.object(
            self.p, "_legacy_common_config_anchor_snapshot",
            side_effect=inside(self.anchor)
        ).start()
        self.current = mock.patch.object(
            self.p, "_legacy_common_config_current_observation",
            side_effect=inside(self.observed)
        ).start()
        self.target = mock.patch.object(
            self.p, "_legacy_common_config_target_facts",
            side_effect=inside(self.facts)
        ).start()
        self.transition = mock.patch.object(
            self.p, "_legacy_common_config_binding_transition",
            side_effect=inside(self.planned)
        ).start()

        def writer_effect(*args, **kwargs):
            self.assertTrue(self.lock_active)
            return self.copy(self.result)
        self.writer = mock.patch.object(
            self.p, "_legacy_common_config_apply_binding_transition_locked",
            side_effect=writer_effect
        ).start()

    def bind(self):
        return self.p.bind_legacy_common_config_authority(
            Path("/control"), self.registration_id,
            self.reference["path"], self.reference["sha256"],
            self.review_observation)

    def test_all_observation_and_write_steps_share_one_lock(self):
        result = self.bind()
        self.assertEqual(result, self.result)
        self.locks.assert_called_once()
        self.snapshot.assert_called_once()
        self.anchor_read.assert_called_once()
        self.current.assert_called_once()
        self.target.assert_called_once()
        self.transition.assert_called_once()
        self.writer.assert_called_once()
        self.assertFalse(self.lock_active)

    def test_transition_receives_current_journal_and_fresh_facts(self):
        self.registration["legacy_common_config_authority"] = {"current": {}, "history": []}
        self.read.return_value = (self.copy(self.registration), "f" * 64)
        self.bind()
        args = self.transition.call_args.args
        self.assertEqual(args[0], self.evidence)
        self.assertEqual(args[1], self.observed)
        self.assertEqual(args[2], self.reference)
        self.assertEqual(args[3], self.registration["legacy_common_config_authority"])
        self.assertEqual(args[4], self.facts)

    def test_reviewer_observation_is_not_invented_by_orchestrator(self):
        self.evidence["review"]["reviewer_identity"] = "untrusted evidence-only change"
        self.bind()
        args = self.current.call_args.args
        self.assertEqual(args[4], self.review_observation)
        self.assertNotEqual(args[4], self.evidence["review"])

    def test_target_registration_mismatch_fails_before_anchor(self):
        bad = self.copy(self.evidence)
        bad["target_registration_id"] = "9" * 64
        bad["target_core_sha256"] = "9" * 64
        self.snapshot.side_effect = lambda *args, **kwargs: {
            "reference": self.copy(self.reference), "evidence": bad}
        with self.assertRaisesRegex(self.p.PublicationError,
                                    "^LEGACY_COMMON_CONFIG_TARGET_IDENTITY_MISMATCH$"):
            self.bind()
        self.anchor_read.assert_not_called()
        self.writer.assert_not_called()

    def test_registration_cas_identity_is_checked_under_lock(self):
        bad = self.copy(self.registration)
        bad["registration_sha256"] = "9" * 64
        self.read.return_value = (bad, "f" * 64)
        with self.assertRaisesRegex(self.p.PublicationError,
                                    "^LEGACY_COMMON_CONFIG_BIND_CAS_DRIFT$"):
            self.bind()
        self.snapshot.assert_not_called()
        self.writer.assert_not_called()

    def test_closed_registration_is_rejected_before_evidence_read(self):
        closed = self.copy(self.registration)
        closed["state"] = "CLOSED"
        self.read.return_value = (closed, "f" * 64)
        with self.assertRaisesRegex(self.p.PublicationError,
                                    "^LEGACY_COMMON_CONFIG_BIND_STATE_INVALID$"):
            self.bind()
        self.snapshot.assert_not_called()
        self.writer.assert_not_called()

    def test_no_direct_ref_config_or_queue_mutator(self):
        remote = self.mock.patch.object(self.p, "_run_supersede_send_pack").start()
        config = self.mock.patch.object(self.p, "_set_config_values").start()
        queue = self.mock.patch.object(self.p, "_load_board").start()
        self.bind()
        remote.assert_not_called()
        config.assert_not_called()
        queue.assert_not_called()


class LegacyCommonConfigCloseIntegrationTests(unittest.TestCase):
    """Mocked legacy close/crash integration; no live Git/config/remote access."""

    def setUp(self):
        import copy
        import json as json_module
        import tempfile
        from unittest import mock
        import task_publication as publication

        self.copy, self.json, self.p, self.mock = copy.deepcopy, json_module, publication, mock
        fixture = LegacyCommonConfigRedactedReceiptTests()
        fixture.setUp()
        self.checkpoint = self.copy(fixture.checkpoint)
        self.registration = self.copy(fixture.anchor)
        self.registration.update(
            registration_sha256=self.registration["registration_id"],
            state="REVOKED", state_version=7)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.worktree = Path(self.temp.name) / "work"
        self.close_root = Path(self.temp.name) / "close"
        self.worktree.mkdir()
        self.close_root.mkdir()
        self.receipt = self.close_root / "receipt.json"
        self.intent = self.close_root / "intent.json"
        self.registration["core"].update(
            role="B", worktree_path=str(self.worktree),
            candidate_head="a" * 40, task_ref="refs/heads/legacy-close",
            push_target="fixture-target")
        self.installed = self.copy(self.registration["installed_config"])
        self.prior = self.copy(self.registration["core"]["prior_config"])
        self.keys = list(self.installed["owned_keys"])
        self.values = {key: self.copy(self.installed[key]) for key in self.keys}

        def context(root, registration, frozen_checkpoint=None):
            if (frozen_checkpoint is not None
                    and self.p._canonical_bytes(frozen_checkpoint)
                    != self.p._canonical_bytes(self.checkpoint)):
                raise self.p.PublicationError(
                    "LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT")
            return {"checkpoint": self.copy(self.checkpoint)}

        self.context = mock.patch.object(
            self.p, "_legacy_common_config_close_context",
            side_effect=context).start()
        self.ref = mock.patch.object(
            self.p, "_legacy_common_config_ref_oid",
            return_value=self.p.ZERO_OID).start()
        self.clean = mock.patch.object(
            self.p, "_legacy_common_config_worktree_clean").start()
        self.digest = mock.patch.object(
            self.p, "_worktree_config_digest",
            return_value="9" * 64).start()
        self.get_config = mock.patch.object(
            self.p, "_config_values",
            side_effect=lambda worktree, key: self.copy(self.values[key])).start()
        self.set_config = mock.patch.object(
            self.p, "_set_config_values",
            side_effect=lambda worktree, key, value: self.values.__setitem__(
                key, self.copy(value))).start()
        self.transition = mock.patch.object(
            self.p, "_state_transition",
            side_effect=self._closed_registration).start()
        self.addCleanup(mock.patch.stopall)

    def _closed_registration(self, root, registration_id, expected_states,
                             new_state, updates=None, expected_version=None):
        result = self.copy(self.registration)
        result.update(state=new_state, state_version=expected_version + 1,
                      updated_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
        if updates:
            result.update(self.copy(updates))
        return result

    def close(self):
        return self.p._legacy_common_config_close_locked(
            Path("/control"), self.registration, self.worktree,
            self.installed, self.prior, self.keys, self.receipt, self.intent)

    def test_initial_close_writes_value_free_intent_and_v2_receipt(self):
        result = self.close()
        self.assertEqual(result["state"], "CLOSED")
        intent = self.json.loads(self.intent.read_text())
        receipt = self.json.loads(self.receipt.read_text())
        self.assertEqual(intent["kind"], "octoport.task-publication-legacy-close-intent")
        self.assertEqual(receipt["version"], 2)
        rendered = self.json.dumps([intent, receipt])
        for secret in ("OLD_SECRET_A", "OLD_SECRET_B", "INSTALLED_SECRET", "NEW_SECRET"):
            self.assertNotIn(secret, rendered)
        self.assertEqual(self.values, self.prior)
        self.assertEqual(self.ref.call_count, 2)
        self.assertEqual(self.clean.call_count, 2)
        self.assertEqual(self.context.call_count, 2)

    def test_present_task_ref_fails_before_intent_or_config_restore(self):
        self.ref.return_value = self.registration["core"]["candidate_head"]
        before = self.copy(self.values)
        with self.assertRaisesRegex(
                self.p.PublicationError,
                "^LEGACY_COMMON_CONFIG_TASK_REF_PRESENT$"):
            self.close()
        self.assertEqual(self.values, before)
        self.assertFalse(self.intent.exists())
        self.assertFalse(self.receipt.exists())
        self.set_config.assert_not_called()

    def test_crash_after_receipt_is_recoverable_with_same_checkpoint(self):
        self.transition.side_effect = RuntimeError("synthetic crash after receipt")
        with self.assertRaisesRegex(RuntimeError, "synthetic crash"):
            self.close()
        self.assertTrue(self.intent.is_file())
        self.assertTrue(self.receipt.is_file())
        self.assertEqual(self.values, self.prior)

        self.transition.side_effect = self._closed_registration
        result = self.close()
        self.assertEqual(result["state"], "CLOSED")
        self.assertEqual(self.values, self.prior)
        self.assertEqual(self.json.loads(self.receipt.read_text())["version"], 2)

    def test_checkpoint_drift_blocks_recovery_before_config_write(self):
        self.transition.side_effect = RuntimeError("synthetic crash after receipt")
        with self.assertRaises(RuntimeError):
            self.close()
        intent = self.json.loads(self.intent.read_text())
        intent["legacy_checkpoint"]["authority_sha256"] = "f" * 64
        self.intent.write_text(self.json.dumps(intent, sort_keys=True))
        self.set_config.reset_mock()
        with self.assertRaisesRegex(
                self.p.PublicationError,
                "^LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT$"):
            self.close()
        self.set_config.assert_not_called()

    def test_missing_legacy_authority_preserves_common_config_drift_failure(self):
        registration = self.copy(self.registration)
        registration.pop("legacy_common_config_authority")
        with self.assertRaisesRegex(self.p.PublicationError, "^COMMON_CONFIG_DRIFT$"):
            self.p._legacy_common_config_close_locked(
                Path("/control"), registration, self.worktree,
                self.installed, self.prior, self.keys, self.receipt, self.intent)

    def test_second_authority_revalidation_failure_does_not_strand_intent(self):
        self.context.side_effect = [
            {"checkpoint": self.copy(self.checkpoint)},
            self.p.PublicationError("LEGACY_COMMON_CONFIG_OBSERVATION_UNVERIFIED"),
        ]
        with self.assertRaisesRegex(
                self.p.PublicationError,
                "^LEGACY_COMMON_CONFIG_OBSERVATION_UNVERIFIED$"):
            self.close()
        self.assertFalse(self.intent.exists())
        self.assertFalse(self.receipt.exists())
        self.set_config.assert_not_called()

    def test_second_ref_drift_does_not_strand_intent(self):
        self.ref.side_effect = [
            self.p.ZERO_OID, self.registration["core"]["candidate_head"]]
        with self.assertRaisesRegex(
                self.p.PublicationError,
                "^LEGACY_COMMON_CONFIG_TASK_REF_PRESENT$"):
            self.close()
        self.assertFalse(self.intent.exists())
        self.assertFalse(self.receipt.exists())
        self.set_config.assert_not_called()

    def test_second_same_key_drift_does_not_get_overwritten(self):
        drift_key = self.keys[0]

        def clean_with_late_drift(worktree):
            if self.clean.call_count == 2:
                self.values[drift_key] = {"present": True, "values": ["NEW_SECRET"]}

        self.clean.side_effect = clean_with_late_drift
        with self.assertRaisesRegex(
                self.p.PublicationError,
                "^ROUTE_CONFIG_SAME_KEY_DRIFT:" + drift_key + "$"):
            self.close()
        self.assertEqual(
            self.values[drift_key], {"present": True, "values": ["NEW_SECRET"]})
        self.assertFalse(self.intent.exists())
        self.assertFalse(self.receipt.exists())
        self.set_config.assert_not_called()
