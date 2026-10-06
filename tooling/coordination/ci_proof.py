#!/usr/bin/env python3
"""Reuse only fresh, full GitHub checks; unknown evidence runs full suites."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import urllib.parse
import urllib.request

from ci_impact import analyze

REPOSITORY = "MaksimUnimax/runtime-fixtures"
MAX_AGE_SECONDS = 6 * 3600
STREAM_BRANCHES = ("work/a-extension", "work/b-backend", "work/c-integration")
TASK_PUBLICATION_PREFIX = "controller/task-publication/"
WORKFLOWS = {
    "server-ci.yml": ("Server CI", {"server"}),
    "extension-ci.yml": ("Extension CI", {
        "Common core / source and package", "Baseline / ozon",
        "Baseline / wb-nodes", "Baseline / wb-browsers",
        "Common application / native Chromium fixture",
    }),
    "extension-i1-ci.yml": ("Extension I1-C1 client", {
        "client-i1", "Installed local API / portal / PostgreSQL acceptance",
    }),
}


def full(reason):
    return {"schemaVersion": 1, "fullTests": True, "reason": reason, "proof": None}


def exact_sha(value):
    return isinstance(value, str) and bool(re.fullmatch(r"[0-9a-f]{40}", value)) and value != "0" * 40


def trusted_branch(branch):
    return branch in ("main", *STREAM_BRANCHES) or (
        isinstance(branch, str) and branch.startswith("controller/"))


def reusable_main_source_branch(branch):
    return branch in STREAM_BRANCHES or (
        isinstance(branch, str) and branch.startswith(TASK_PUBLICATION_PREFIX))


def select_run(runs, sha, branch, workflow, current_run, now):
    name, _ = WORKFLOWS[workflow]
    candidates = [r for r in runs if r.get("head_sha") == sha
                  and r.get("head_branch") == branch
                  and r.get("event") == "push"
                  and r.get("path") == ".github/workflows/" + workflow
                  and r.get("name") == name]
    if not candidates:
        return None
    latest = max(candidates, key=lambda r: (r["id"], r.get("run_attempt", 1)))
    if (latest["id"] >= current_run or latest.get("status") != "completed"
            or latest.get("conclusion") != "success"
            or latest.get("repository", {}).get("full_name") != REPOSITORY
            or latest.get("head_repository", {}).get("full_name") != REPOSITORY):
        return None
    completed = datetime.fromisoformat(latest["updated_at"].replace("Z", "+00:00"))
    if not 0 <= (now - completed).total_seconds() <= MAX_AGE_SECONDS:
        return None
    return latest


def full_jobs(run, response, workflow):
    jobs = response.get("jobs", [])
    if response.get("total_count") != len(jobs):
        return False
    expected = WORKFLOWS[workflow][1]
    names = [j.get("name") for j in jobs]
    if not expected.issubset(names) or len(names) != len(set(names)):
        return False
    for job in jobs:
        if (job.get("head_sha") != run["head_sha"]
                or job.get("run_attempt") != run.get("run_attempt", 1)
                or job.get("status") != "completed"
                or job.get("conclusion") != "success"):
            return False
    return True


class GitHub:
    def get(self, suffix, query=None):
        url = "https://api.github.com/repos/" + REPOSITORY + suffix
        if query:
            url += "?" + urllib.parse.urlencode(query)
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "octoport-ci-proof"}
        token = os.environ.get("GH_TOKEN")
        if token:
            headers["Authorization"] = "Bearer " + token
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=15) as response:
            return json.load(response)

    def runs(self, sha, workflow):
        result = []
        for page in range(1, 4):
            data = self.get("/actions/workflows/" + workflow + "/runs",
                            {"head_sha": sha, "event": "push", "per_page": 100, "page": page})
            rows = data["workflow_runs"]
            result.extend(rows)
            if len(rows) < 100:
                return result
        raise ValueError("EVIDENCE_PAGINATION_LIMIT")

    def jobs(self, run):
        return self.get("/actions/runs/" + str(run["id"]) + "/attempts/"
                        + str(run.get("run_attempt", 1)) + "/jobs", {"per_page": 100})


def plan(repo, event, env, workflow, api, now):
    if (env.get("GITHUB_REPOSITORY") != REPOSITORY or env.get("GITHUB_EVENT_NAME") != "push"
            or workflow not in WORKFLOWS):
        return full("EVENT_NOT_ELIGIBLE")
    sha = env.get("GITHUB_SHA")
    branch = env.get("GITHUB_REF", "").removeprefix("refs/heads/")
    if not exact_sha(sha) or event.get("after") != sha or not trusted_branch(branch):
        return full("IDENTITY_NOT_ELIGIBLE")
    current_run = int(env["GITHUB_RUN_ID"])
    options = []
    run_cache = {}
    if branch == "main":
        run_cache[sha] = api.runs(sha, workflow)
        name, _ = WORKFLOWS[workflow]
        sources = [r for r in run_cache[sha] if r.get("head_sha") == sha
                   and reusable_main_source_branch(r.get("head_branch"))
                   and r.get("event") == "push"
                   and r.get("path") == ".github/workflows/" + workflow
                   and r.get("name") == name]
        # Do not hide a newer failing attempt behind an older green approved source.
        if sources:
            latest = max(sources, key=lambda r: (r["id"], r.get("run_attempt", 1)))
            reason = ("EXACT_STREAM_PUSH_FULL_PROOF"
                      if latest["head_branch"] in STREAM_BRANCHES
                      else "EXACT_TASK_PUBLICATION_PUSH_FULL_PROOF")
            options.append((sha, latest["head_branch"], reason))
    before = event.get("before")
    impact = analyze(repo, before, sha)
    if impact["impactClass"] == "PROSE_ONLY":
        options.append((before, branch, "PROSE_ONLY_WITH_FULL_PARENT_PROOF"))
    for source_sha, source_branch, reason in options:
        if source_sha not in run_cache:
            run_cache[source_sha] = api.runs(source_sha, workflow)
        run = select_run(run_cache[source_sha], source_sha, source_branch,
                         workflow, current_run, now)
        if run and full_jobs(run, api.jobs(run), workflow):
            return {
                "schemaVersion": 1, "fullTests": False, "reason": reason,
                "head": sha, "workflow": workflow,
                "proof": {"id": run["id"], "attempt": run.get("run_attempt", 1),
                          "sha": source_sha, "branch": source_branch,
                          "url": "https://github.com/" + REPOSITORY + "/actions/runs/" + str(run["id"])},
                "impact": impact,
            }
    return full("NO_FRESH_FULL_PROOF")


def safe_plan(*args):
    try:
        return plan(*args)
    except (OSError, ValueError, KeyError, TypeError, OverflowError):
        return full("EVIDENCE_UNVERIFIED_RUN_FULL")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workflow", choices=WORKFLOWS, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text())
        result = safe_plan(Path.cwd(), event, os.environ, args.workflow, GitHub(),
                           datetime.now(timezone.utc))
    except (OSError, ValueError, KeyError):
        result = full("EVENT_UNVERIFIED_RUN_FULL")
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    with open(os.environ["GITHUB_OUTPUT"], "a") as output:
        output.write("full_tests=" + str(result["fullTests"]).lower() + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
