"""Guarded route regressions using disposable Git remotes; no network or live board."""
import copy
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import unittest
from unittest.mock import patch

import task_publication as route
from ci_gate import REQUIRED


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
        for name, path in route._bundle_source_files(Path(__file__).resolve().parents[2]).items():
            target = self.source / "tooling/coordination" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        control_source = Path(__file__).with_name("control.py")
        control_target = self.source / "tooling/coordination/control.py"
        control_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(control_source, control_target)
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
        core = {
            "role": "C", "task_id": task["id"], "task_paths": task["paths"],
            "changed_paths": task["paths"], "candidate_head": candidate_sha,
            "candidate_tree": route._tree(self.source), "base_sha": "e" * 40,
            "task_fingerprint": work_queue._publication_task_fingerprint(task),
            "review": review, "bundle_manifest_sha256": "1" * 64,
            "task_ref": task_ref, "task_branch": task_branch,
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

    def test_git_authority_environment_strips_repository_config_and_object_selectors(self):
        poisoned = {
            "KEEP_ME": "yes", "GIT_SSH_COMMAND": "ssh -F fixture",
            "GIT_DIR": "/tmp/evil-dir", "GIT_WORK_TREE": "/tmp/evil-worktree",
            "GIT_COMMON_DIR": "/tmp/evil-common", "GIT_INDEX_FILE": "/tmp/evil-index",
            "GIT_OBJECT_DIRECTORY": "/tmp/evil-objects",
            "GIT_ALTERNATE_OBJECT_DIRECTORIES": "/tmp/evil-alternates",
            "GIT_NAMESPACE": "evil", "GIT_SHALLOW_FILE": "/tmp/evil-shallow",
            "GIT_REPLACE_REF_BASE": "refs/evil/", "GIT_CONFIG": "/tmp/evil-config",
            "GIT_CONFIG_PARAMETERS": "'core.worktree=/tmp/evil'", "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "core.worktree", "GIT_CONFIG_VALUE_0": "/tmp/evil",
        }
        env = route.sanitized_git_authority_env(poisoned)
        for key in poisoned:
            if key not in {"KEEP_ME", "GIT_SSH_COMMAND"}:
                self.assertNotIn(key, env)
        self.assertEqual(env["KEEP_ME"], "yes")
        self.assertEqual(env["GIT_SSH_COMMAND"], "ssh -F fixture")
        self.assertEqual(env["GIT_CONFIG_NOSYSTEM"], "1")
        self.assertEqual(env["GIT_CONFIG_SYSTEM"], os.devnull)
        self.assertEqual(env["GIT_CONFIG_GLOBAL"], os.devnull)
        self.assertEqual(env["GIT_NO_REPLACE_OBJECTS"], "1")
        self.assertEqual(env["LC_ALL"], "C")

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
        with patch.object(
            route, "_run_canonical_queue_completion", return_value={"state": "DONE"}
        ) as boundary:
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
        control_script = self.source / "tooling/coordination/control.py"
        control_script.write_text("# fixture control source\n")
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
            )
        self.assertEqual(result, {"state": "DONE"})
        command = run.call_args.args[0]
        self.assertEqual(run.call_args.kwargs["cwd"], str(self.fixed))
        self.assertEqual(command[1], str(self.source / "tooling/coordination/control.py"))
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
        with patch.object(
            route, "_run_canonical_queue_completion", return_value={"state": "DONE"}
        ) as boundary:
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
        with patch.object(route, "_run_canonical_queue_completion") as boundary:
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


if __name__ == "__main__":
    unittest.main()
