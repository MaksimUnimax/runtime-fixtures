"""C-only isolated integration, through existing ready-main and push gates."""
import json
from pathlib import Path
import subprocess
import sys
import time

import ci_gate
import work_queue
from continuous_state import (add_job, atomic_json, check_mode, digest, event, git,
                              root, rules_snapshot, transition)
from continuous_adapter import candidate_identity
from continuous_gate import integration_context


def integration_receipt_valid(cfg, spec):
    board = work_queue.validate_board(cfg["control_root"])["board"]
    task = next((x for x in board["tasks"] if x["id"] == spec["task_id"]), None)
    if task is None or task["state"] != "DONE" or task.get("candidate") != spec["candidate"]:
        raise RuntimeError("RUNTIME_INTEGRATION_PROOF_NOT_ACCEPTED")
    return task


def authority(cfg, spec):
    check_mode(cfg, "C")
    if spec["epoch"] != cfg["epoch"] or spec["rules"] != rules_snapshot(cfg):
        raise RuntimeError("RUNTIME_INTEGRATION_RULES_REVIEW_REQUIRED")


def prepare(cfg, conn, row, spec, task):
    authority(cfg, spec)
    git(cfg["repo"], "fetch", "origin", "main")
    base = git(cfg["repo"], "rev-parse", "origin/main")
    if subprocess.run(["git", "merge-base", "--is-ancestor", spec["base"], base], cwd=cfg["repo"], capture_output=True).returncode:
        raise RuntimeError("RUNTIME_REVIEWED_BASE_NOT_ANCESTOR_OF_MAIN")
    candidate = spec["candidate"]["sha"]
    if git(cfg["repo"], "rev-parse", candidate + "^{tree}") != spec["candidate"]["tree"]:
        raise RuntimeError("RUNTIME_INTEGRATION_CANDIDATE_TREE_MISMATCH")
    changed = git(cfg["repo"], "diff", "--name-only", spec["base"], candidate, "--").splitlines()
    if not set(changed).issubset(set(task["paths"])):
        raise RuntimeError("RUNTIME_INTEGRATION_SCOPE_MISMATCH")
    if digest(subprocess.check_output(["git", "diff", "--binary", "--no-ext-diff", spec["base"], candidate, "--"], cwd=cfg["repo"])) != spec["candidate"]["diff_sha256"]:
        raise RuntimeError("RUNTIME_INTEGRATION_DIFF_MISMATCH")
    target = Path(cfg["control_root"]) / "worktrees/C" / ("runtime-integration-" + row["id"])
    branch = "controller/runtime-" + row["id"]
    saved = {"base": base, "branch": branch, "worktree": str(target), "candidate": candidate}
    transition(conn, row["id"], "INTEGRATING", "MERGE_INTENT_PRESERVED_ON_CRASH", saved)
    atomic_json(root(cfg) / "integrations" / row["id"] / "context.json", {
        "job": row["id"], "epoch": cfg["epoch"], "path": str(target), "branch": branch, "candidate": spec["candidate"]})
    git(cfg["repo"], "worktree", "add", "-b", branch, str(target), base)
    authority(cfg, spec)
    git(target, "merge", "--no-edit", "--no-ff", candidate)
    saved["head"] = git(target, "rev-parse", "HEAD")
    if git(target, "status", "--porcelain"):
        raise RuntimeError("RUNTIME_INTEGRATION_DIRTY_AFTER_MERGE")
    author = conn.execute("SELECT role FROM jobs WHERE id=?", (spec["author_job"],)).fetchone()[0]
    reviewers = [r for r in cfg["enabled_roles"] if r not in {author, "C"}]
    if not reviewers:
        raise RuntimeError("RUNTIME_MERGED_CONTEXT_INDEPENDENT_REVIEWER_REQUIRED")
    review_id = "context-" + row["id"]
    reviewer = reviewers[0]
    add_job(conn, review_id, reviewer, "integration_review", {
        "integration_job": row["id"], "author": "C", "source_author": author,
        "identity": candidate_identity(target, base), "base": base,
        "payload": {"task": task, "source_candidate": spec["candidate"], "source_base": spec["base"],
                    "instruction": "Review exact merged context and all changed requirements/consumer boundaries; source acceptance alone does not accept this merged tree."},
        "rules": rules_snapshot(cfg), "epoch": cfg["epoch"],
        "worktree": str(Path(cfg["control_root"]) / "worktrees" / reviewer / ("runtime-" + review_id))})
    saved["context_review_job"] = review_id
    transition(conn, row["id"], "MERGED", result=saved)
    return saved


def failure_handoff(cfg, conn, row, spec, reason):
    transition(conn, row["id"], "REWORK", reason)
    atomic_json(root(cfg) / "integrations" / row["id"] / "rework.json", {
        "job": row["id"], "task_id": spec["task_id"], "candidate": spec["candidate"],
        "state": "REWORK", "reason": reason, "author_job": spec["author_job"]})


def integrate_tick(cfg, conn):
    if not cfg.get("integration_enabled", False):
        return
    rows = conn.execute("SELECT * FROM jobs WHERE kind='integrate' AND state IN ('READY','INTEGRATING','MERGED','CI_PENDING','MAIN_PENDING') ORDER BY created").fetchall()
    started = False
    for row in rows:
        spec = json.loads(row["spec"])
        try:
            authority(cfg, spec)
            task = integration_receipt_valid(cfg, spec)
            saved = json.loads(row["result"]) if row["result"] else {}
            if row["state"] == "INTEGRATING":
                failure_handoff(cfg, conn, row, spec, "INTERRUPTED_MERGE_PRESERVED_NO_AUTOMATIC_REPLAY")
                continue
            if row["state"] == "READY":
                if started: continue
                started = True
                saved = prepare(cfg, conn, row, spec, task)
            target = Path(saved["worktree"])
            if git(target, "rev-parse", "HEAD") != saved["head"] or git(target, "status", "--porcelain"):
                raise RuntimeError("RUNTIME_INTEGRATION_FROZEN_HEAD_CHANGED")
            if row["state"] in {"READY", "MERGED"}:
                authority(cfg, spec)
                transition(conn, row["id"], "CI_PENDING", result=saved)
                git(target, "push", "origin", "HEAD:refs/heads/" + saved["branch"])
                continue
            if row["state"] == "CI_PENDING":
                last = conn.execute("SELECT at FROM events WHERE job=? AND event='ci_polled' ORDER BY seq DESC LIMIT 1", (row["id"],)).fetchone()
                if last and time.time() - last[0] < 60: continue
                event(conn, "ci_polled", row["id"])
                remote = git(target, "ls-remote", "origin", "refs/heads/" + saved["branch"]).split()
                if not remote:
                    authority(cfg, spec)
                    git(target, "push", "origin", "HEAD:refs/heads/" + saved["branch"])
                    continue
                if remote[0] != saved["head"]:
                    raise RuntimeError("RUNTIME_CANDIDATE_REMOTE_REF_CHANGED")
                proof = ci_gate.evaluate(ci_gate.fetch_runs(saved["head"]), saved["head"], saved["branch"])
                if proof["status"] != "PASS":
                    if any(x.get("status") == "completed" and x.get("conclusion") != "success" for x in proof["runs"]):
                        failure_handoff(cfg, conn, row, spec, "EXACT_CANDIDATE_CI_FAILED")
                    continue
                context = integration_context(target, Path(cfg["control_root"]))
                if not context["review_accepted"]:
                    review = conn.execute("SELECT state FROM jobs WHERE id=?", (saved["context_review_job"],)).fetchone()
                    if review and review[0] in {"REWORK", "BLOCKED", "UNKNOWN"}:
                        failure_handoff(cfg, conn, row, spec, "MERGED_CONTEXT_REVIEW_NOT_ACCEPTED")
                    continue
                git(target, "fetch", "origin", "main")
                if git(target, "rev-parse", "origin/main") != saved["base"]:
                    failure_handoff(cfg, conn, row, spec, "REMOTE_MAIN_CHANGED_NEW_INTEGRATION_REQUIRED")
                    continue
                # Call the existing validator: do not write a parallel main-ready receipt.
                authority(cfg, spec)
                result = subprocess.run([sys.executable, str(target / "tooling/coordination/control.py"), "C", "ready-main",
                    "--base", saved["base"], "--summary", "Independent runtime candidate " + spec["receipt"]],
                    cwd=target, text=True, capture_output=True, timeout=100)
                if result.returncode:
                    raise RuntimeError("RUNTIME_EXISTING_READY_MAIN_GATE_REJECTED")
                transition(conn, row["id"], "MAIN_PENDING", result=saved)
                continue
            if row["state"] == "MAIN_PENDING":
                remote = git(target, "ls-remote", "origin", "refs/heads/main").split()
                if remote and remote[0] == saved["head"]:
                    transition(conn, row["id"], "DONE", result=saved | {"remote_readback": remote[0]})
                    transition(conn, spec["author_job"], "INTEGRATED")
                    continue
                if not remote or remote[0] != saved["base"]:
                    failure_handoff(cfg, conn, row, spec, "REMOTE_MAIN_CHANGED_NEW_INTEGRATION_REQUIRED")
                    continue
                authority(cfg, spec)
                git(target, "push", "origin", "HEAD:refs/heads/main")
                actual = git(target, "ls-remote", "origin", "refs/heads/main").split()
                if not actual or actual[0] != saved["head"]:
                    raise RuntimeError("RUNTIME_MAIN_PUSH_OUTCOME_UNVERIFIED")
                transition(conn, row["id"], "DONE", result=saved | {"remote_readback": actual[0]})
                transition(conn, spec["author_job"], "INTEGRATED")
        except (OSError, subprocess.SubprocessError) as error:
            current = conn.execute("SELECT state FROM jobs WHERE id=?", (row["id"],)).fetchone()[0]
            if current in {"CI_PENDING", "MAIN_PENDING"}:
                event(conn, "integration_read_or_push_unverified", row["id"], error=type(error).__name__)
            else:
                failure_handoff(cfg, conn, row, spec, type(error).__name__)
        except (RuntimeError, ValueError, KeyError) as error:
            failure_handoff(cfg, conn, row, spec, str(error)[:250])
