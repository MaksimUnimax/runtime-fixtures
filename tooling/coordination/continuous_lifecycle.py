"""Bounded capacity recovery and final integrated-leaf archival."""
import contextlib
import fcntl
import json
from pathlib import Path
import subprocess

import resource_runner
import work_queue
from continuous_state import check_mode, digest, encode, event, git, lock, root, transition


def readmit_capacity(cfg, conn):
    """Only re-admit a pre-execution resource denial after the real gate clears."""
    rows = conn.execute("SELECT * FROM jobs WHERE state='BLOCKED' AND reason='RESOURCE_ADMISSION_WAIT'").fetchall()
    for row in rows:
        try:
            check_mode(cfg, row["role"])
            if any(json.loads(x[0]).get("token") == row["token"] for x in conn.execute(
                    "SELECT data FROM events WHERE job=? AND event='codex_launch_intent'", (row["id"],))):
                continue
            with lock(root(cfg) / "locks" / (row["id"] + ".lock")), lock(Path(cfg["control_root"]) / ("codex-" + row["role"] + ".lock")):
                with (Path(cfg["control_root"]) / "heavy.lock").open("a+") as legacy:
                    fcntl.flock(legacy, fcntl.LOCK_SH | fcntl.LOCK_NB)
                    jobs = Path(cfg["control_root"]) / "resource-jobs"
                    active = resource_runner.active_jobs(jobs)
                    resources = resource_runner.snapshot(Path(json.loads(row["spec"])["worktree"]))
                    budget = resource_runner.effective_budget(jobs, "general", None)
                    if resource_runner.admission(resources, active, budget, row["role"]):
                        continue
                # The runner will atomically recheck admission before execution.
                transition(conn, row["id"], "READY", "RESOURCE_CAPACITY_NOW_ADMISSIBLE")
                event(conn, "capacity_readmitted", row["id"], token=row["token"], budget=budget)
        except (BlockingIOError, RuntimeError, OSError):
            continue


def related_jobs(conn, author_id, integration_id):
    selected = []
    for row in conn.execute("SELECT * FROM jobs"):
        spec = json.loads(row["spec"])
        if (row["id"] in {author_id, integration_id} or spec.get("author_job") == author_id
                or spec.get("integration_job") == integration_id):
            selected.append(row)
    return selected


def archive_integrated(cfg, conn, busy_roles=()):
    """Archive at most one independently accepted, integrated leaf each tick.

    SQLite serialization excludes runtime/manual claims across the canonical
    queue verifier. Its stable event ID is consumed idempotently, including a
    crash after board replacement but before the local consumption record.
    """
    for integration in conn.execute("SELECT * FROM jobs WHERE kind='integrate' AND state='DONE' ORDER BY updated").fetchall():
        key = "archive:" + integration["id"]
        spec = json.loads(integration["spec"])
        saved = json.loads(integration["result"] or "{}")
        if conn.execute("SELECT 1 FROM meta WHERE key=?", (key,)).fetchone():
            continue
        if not saved.get("head") or saved.get("remote_readback") != saved["head"]:
            continue
        author = conn.execute("SELECT * FROM jobs WHERE id=?", (spec["author_job"],)).fetchone()
        if not author or author["state"] != "INTEGRATED":
            continue
        related = related_jobs(conn, author["id"], integration["id"])
        if any(r["state"] in {"STARTING", "RUNNING", "RESULT", "READY", "CI_PENDING", "MAIN_PENDING", "MERGED", "INTEGRATING", "UNKNOWN"} or r["role"] in busy_roles for r in related):
            continue
        try:
            check_mode(cfg, author["role"])
            with contextlib.ExitStack() as locks:
                for row in related:
                    locks.enter_context(lock(root(cfg) / "locks" / (row["id"] + ".lock")))
                conn.execute("BEGIN IMMEDIATE")
                try:
                    def verify(task, receipt_sha):
                        paths = set(task["paths"])
                        if any(paths & set(json.loads(r[0])) for r in conn.execute("SELECT paths FROM claims WHERE state='ACTIVE'")):
                            raise RuntimeError("RUNTIME_ARCHIVE_ACTIVE_SCOPE_CLAIM")
                        if (task["candidate"] != spec["candidate"] or task["completion_receipt"] != spec["receipt"]
                                or digest(Path(spec["receipt"]).read_bytes()) != receipt_sha):
                            raise RuntimeError("RUNTIME_ARCHIVE_EXACT_PROOF_MISMATCH")
                        return {"state": "FINAL", "integration": "INTEGRATED", "pending_review": False,
                                "pending_ci": False, "active_leases": [], "epoch": cfg["epoch"],
                                "candidate": task["candidate"], "receipt_sha256": receipt_sha,
                                "authority_id": integration["id"]}
                    result = work_queue.archive_done(cfg["control_root"], author["role"], [spec["task_id"]], archive_verifier=verify, limit=1)
                    reference = work_queue.archived_task(cfg["control_root"], spec["task_id"])
                    if not reference or reference.get("candidate") != spec["candidate"]:
                        raise RuntimeError("RUNTIME_ARCHIVE_REFERENCE_MISMATCH")
                    event_key = "queue-event:" + reference["event_id"]
                    if not conn.execute("SELECT 1 FROM meta WHERE key=?", (event_key,)).fetchone():
                        event(conn, "queue_archive_consumed", integration["id"], event_id=reference["event_id"], archive=reference)
                        conn.execute("INSERT INTO meta VALUES(?,?)", (event_key, encode(reference)))
                    conn.execute("INSERT INTO meta VALUES(?,?)", (key, encode(reference)))
                    requirement = json.loads(author["spec"]).get("task", {}).get("requirement_id")
                    if requirement:
                        conn.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", ("coverage:" + requirement, encode(reference)))
                    conn.commit()
                except BaseException:
                    conn.rollback(); raise
            return
        except (BlockingIOError, RuntimeError, OSError, subprocess.SubprocessError) as error:
            reason = str(error)[:300]
            failure_key = "archive-blocked:" + integration["id"]
            previous = conn.execute("SELECT value FROM meta WHERE key=?", (failure_key,)).fetchone()
            if not previous or previous[0] != reason:
                event(conn, "archive_blocked", integration["id"], reason=reason)
                conn.execute("INSERT OR REPLACE INTO meta VALUES(?,?)", (failure_key, reason))


def cleanup_final_worktrees(cfg, conn, busy_roles=()):
    """Remove only clean runtime-owned copies of archived Git candidates."""
    for integration in conn.execute("SELECT * FROM jobs WHERE kind='integrate' AND state='DONE'").fetchall():
        if not conn.execute("SELECT 1 FROM meta WHERE key=?", ("archive:" + integration["id"],)).fetchone():
            continue
        spec = json.loads(integration["spec"])
        for row in related_jobs(conn, spec["author_job"], integration["id"]):
            key = "worktree-cleaned:" + row["id"]
            if row["role"] in busy_roles or conn.execute("SELECT 1 FROM meta WHERE key=?", (key,)).fetchone():
                continue
            descriptor = json.loads(row["spec"])
            path = Path(json.loads(row["result"] or "{}").get("worktree", "")) if row["kind"] == "integrate" else Path(descriptor.get("worktree", ""))
            expected = Path(cfg["control_root"]) / "worktrees" / row["role"] / (("runtime-integration-" if row["kind"] == "integrate" else "runtime-") + row["id"])
            if path != expected or path.resolve() != expected:
                continue
            try:
                with lock(root(cfg) / "locks" / (row["id"] + ".lock")):
                    if path.exists():
                        if git(path, "status", "--porcelain"):
                            continue
                        # No --force: dirty/untracked data and unknown copies stay.
                        git(cfg["repo"], "worktree", "remove", str(path))
                    conn.execute("INSERT INTO meta VALUES(?,?)", (key, str(path)))
                    event(conn, "final_worktree_cleaned", row["id"], path=str(path))
            except (BlockingIOError, RuntimeError, OSError, subprocess.SubprocessError):
                continue
