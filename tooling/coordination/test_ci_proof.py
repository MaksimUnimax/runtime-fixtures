"""Regression checks for evidence identity, conservative scope and failed proofs."""
import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
import tempfile
import unittest

import ci_proof

NOW = datetime(2026, 9, 29, 10, 0, tzinfo=timezone.utc)
WORKFLOW = "server-ci.yml"


class API:
    def __init__(self, run, jobs):
        self.run = run
        self.response = jobs

    def runs(self, sha, workflow):
        return [self.run]

    def jobs(self, run):
        return self.response


class ProofTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self.tmp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Proof test")
        self.git("config", "user.email", "test@example.invalid")
        self.git("config", "core.hooksPath", str(self.repo / "empty-hooks"))
        self.write("README.md", "before")
        self.commit()
        self.before = self.git("rev-parse", "HEAD")
        self.write("README.md", "after")
        self.commit()
        self.head = self.git("rev-parse", "HEAD")
        self.env = {"GITHUB_REPOSITORY": ci_proof.REPOSITORY, "GITHUB_EVENT_NAME": "push",
                    "GITHUB_SHA": self.head, "GITHUB_REF": "refs/heads/main",
                    "GITHUB_RUN_ID": "200"}
        self.event = {"after": self.head, "before": self.before}
        self.run = {"id": 100, "run_attempt": 1, "head_sha": self.head,
                    "head_branch": "work/c-integration", "event": "push",
                    "path": ".github/workflows/" + WORKFLOW, "name": "Server CI",
                    "status": "completed", "conclusion": "success",
                    "updated_at": NOW.isoformat(),
                    "repository": {"full_name": ci_proof.REPOSITORY},
                    "head_repository": {"full_name": ci_proof.REPOSITORY}}
        self.jobs = {"total_count": 1, "jobs": [
            {"name": "server", "head_sha": self.head, "run_attempt": 1,
             "status": "completed", "conclusion": "success"}]}
        self.api = API(self.run, self.jobs)

    def tearDown(self):
        self.tmp.cleanup()

    def git(self, *args):
        return subprocess.run(["git", "-C", str(self.repo), *args], check=True,
                              capture_output=True, text=True).stdout.strip()

    def write(self, name, text):
        p = self.repo / name
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")

    def plan(self):
        return ci_proof.safe_plan(self.repo, self.event, self.env, WORKFLOW, self.api, NOW)

    def assertFull(self):
        self.assertTrue(self.plan()["fullTests"])

    def test_exact_successful_c_sha_can_be_reused_on_main(self):
        result = self.plan()
        self.assertFalse(result["fullTests"])
        self.assertEqual(result["reason"], "EXACT_STREAM_PUSH_FULL_PROOF")
        self.assertEqual(result["proof"]["sha"], self.head)

    def test_each_stream_exact_full_proof_can_be_reused_on_main(self):
        for branch in ci_proof.STREAM_BRANCHES:
            with self.subTest(branch=branch):
                self.run["head_branch"] = branch
                result = self.plan()
                self.assertFalse(result["fullTests"])
                self.assertEqual(result["proof"]["branch"], branch)
                self.assertEqual(result["proof"]["sha"], self.head)

    def test_a_and_b_prose_only_changes_can_reuse_full_parent_proof(self):
        for branch in ("work/a-extension", "work/b-backend"):
            with self.subTest(branch=branch):
                self.env["GITHUB_REF"] = "refs/heads/" + branch
                self.run.update(head_sha=self.before, head_branch=branch)
                self.jobs["jobs"][0]["head_sha"] = self.before
                result = self.plan()
                self.assertFalse(result["fullTests"])
                self.assertEqual(result["reason"], "PROSE_ONLY_WITH_FULL_PARENT_PROOF")

    def test_stream_name_prefix_does_not_authorize_another_branch(self):
        for branch in ("work/a-extension-untrusted", "work/b-backend/other"):
            with self.subTest(branch=branch):
                self.env["GITHUB_REF"] = "refs/heads/" + branch
                self.run.update(head_sha=self.before, head_branch=branch)
                self.jobs["jobs"][0]["head_sha"] = self.before
                self.assertFull()

    def test_newer_failed_other_stream_does_not_hide_behind_old_green(self):
        failed = dict(self.run, id=101, head_branch="work/b-backend", conclusion="failure")
        self.api.runs = lambda *_: [self.run, failed]
        self.assertFull()

    def test_controller_branch_does_not_reuse_same_head_without_parent_proof(self):
        self.env["GITHUB_REF"] = "refs/heads/controller/test"
        self.assertFull()

    def test_receipt_only_change_reuses_full_parent_checks(self):
        self.run.update(head_sha=self.before, head_branch="main")
        self.jobs["jobs"][0]["head_sha"] = self.before
        result = self.plan()
        self.assertFalse(result["fullTests"])
        self.assertEqual(result["reason"], "PROSE_ONLY_WITH_FULL_PARENT_PROOF")

    def test_product_delta_cannot_inherit_parent_pass(self):
        self.run.update(head_sha=self.before, head_branch="main")
        self.jobs["jobs"][0]["head_sha"] = self.before
        self.write("apps/api/src/main.ts", "changed")
        self.commit()
        self.env["GITHUB_SHA"] = self.event["after"] = self.git("rev-parse", "HEAD")
        self.assertFull()

    def test_different_workflow_fork_failed_pending_or_future_run_cannot_reuse(self):
        mutations = [
            ("path", ".github/workflows/other.yml"), ("event", "pull_request"),
            ("head_branch", "untrusted"), ("status", "in_progress"),
            ("conclusion", "failure"), ("id", 201),
            ("repository", {"full_name": "other/repo"}),
            ("head_repository", {"full_name": "fork/repo"}),
            ("updated_at", (NOW - timedelta(hours=7)).isoformat()),
            ("updated_at", (NOW + timedelta(minutes=1)).isoformat()),
            ("head_sha", "a" * 40),
        ]
        original = copy.deepcopy(self.run)
        for key, value in mutations:
            with self.subTest(key=key, value=value):
                self.run.clear()
                self.run.update(copy.deepcopy(original))
                self.run[key] = value
                self.assertFull()

    def test_skipped_reused_wrong_attempt_or_incomplete_jobs_cannot_reuse(self):
        for key, value in [("conclusion", "skipped"), ("conclusion", "failure"),
                           ("status", "in_progress"), ("head_sha", "a" * 40),
                           ("run_attempt", 2), ("name", "other")]:
            with self.subTest(key=key, value=value):
                response = copy.deepcopy(self.jobs)
                response["jobs"][0][key] = value
                self.api.response = response
                self.assertFull()
        self.api.response = {"total_count": 2, "jobs": self.jobs["jobs"]}
        self.assertFull()
        self.api.response = {"total_count": 0, "jobs": []}
        self.assertFull()

    def test_newer_failed_attempt_does_not_fall_back_to_old_green(self):
        failed = dict(self.run, id=101, conclusion="failure")
        self.api.runs = lambda *_: [self.run, failed]
        self.assertFull()

    def test_unknown_api_or_event_runs_full(self):
        def offline(*_):
            raise OSError("offline")
        self.api.runs = offline
        self.assertFull()
        self.env["GITHUB_EVENT_NAME"] = "workflow_dispatch"
        self.assertFull()

    def test_after_identity_mismatch_and_new_branch_default_full(self):
        self.event["after"] = "a" * 40
        self.assertFull()
        self.event["after"] = self.head
        self.event["before"] = "0" * 40
        self.env["GITHUB_REF"] = "refs/heads/controller/new"
        self.assertFull()

    def test_missing_history_and_symlink_changes_do_not_inherit_pass(self):
        self.run.update(head_sha=self.before, head_branch="main")
        self.jobs["jobs"][0]["head_sha"] = self.before
        self.event["before"] = "a" * 40
        self.assertFull()
        self.event["before"] = self.before
        (self.repo / "README.md").unlink()
        (self.repo / "README.md").symlink_to("runtime.json")
        self.commit()
        self.env["GITHUB_SHA"] = self.event["after"] = self.git("rev-parse", "HEAD")
        self.assertFull()


if __name__ == "__main__":
    unittest.main()
