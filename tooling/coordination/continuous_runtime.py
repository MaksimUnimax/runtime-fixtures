#!/usr/bin/env python3
"""Opt-in durable A/B/C coordinator. No deployment starts merely by installing it."""
import argparse
import json
import os
from pathlib import Path
import signal
import secrets
import subprocess
import sys
import time
from datetime import datetime, timezone

import resource_runner
import work_queue
from continuous_adapter import candidate_identity, run_entry
from continuous_state import (LAUNCHERS, MODEL, ROLES, add_job, atomic_json, birth,
                           check_mode, config, db, digest, encode, event, git,
                           lock, read_json, requirements, root, rules_snapshot,
                           transition, validate_task)


def check(cfg, login=False):
    check_mode(cfg)
    requirements(cfg)
    rules_snapshot(cfg)
    for name in ("validate_board", "register_acceptance", "bind_candidate"):
        if not hasattr(work_queue, name):
            raise RuntimeError("RUNTIME_QUEUE_PROOF_REVISION_REQUIRED: " + name)
    if not Path("/sys/fs/cgroup/cgroup.controllers").is_file() or not Path("/run/systemd/system").is_dir():
        raise RuntimeError("CGROUP_V2_SYSTEMD_REQUIRED")
    status = {}
    for role in cfg["enabled_roles"]:
        if not Path(LAUNCHERS[role]).is_file():
            raise RuntimeError("SUBSCRIPTION_LAUNCHER_MISSING: " + role)
        status[role] = "CONFIGURED_NOT_CHECKED"
        if login:
            env = os.environ.copy()
            for key in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"):
                env.pop(key, None)
            p = subprocess.run([LAUNCHERS[role], "login", "status"], env=env,
                               capture_output=True, text=True, timeout=15)
            status[role] = "CHATGPT_SUBSCRIPTION" if not p.returncode and "Logged in using ChatGPT" in p.stdout + p.stderr else "BLOCKED"
    return {"status": "PREREQUISITES_CHECKED", "model": MODEL, "capacity": 3,
            "profiles": status, "epoch": cfg["epoch"], "project_ready": False,
            "integration_enabled": cfg.get("integration_enabled", False)}


def initialize(cfg):
    check(cfg)
    conn = db(cfg)
    old = conn.execute("SELECT value FROM meta WHERE key='configuration'").fetchone()
    # Deployment changes require an explicit new epoch; silence never grants authority.
    identity = digest(encode(cfg))
    if old:
        if old[0] != identity:
            conn.close()
            raise RuntimeError("RUNTIME_CONFIG_CHANGED_NEW_EPOCH_REQUIRED")
        return conn
    board = Path(cfg["control_root"]) / "controllers/work-board.json"
    if digest(board.read_bytes()) != cfg["migration_board_sha256"]:
        conn.close()
        raise RuntimeError("RUNTIME_MIGRATION_BOARD_MISMATCH: reconcile before activation")
    verified = work_queue.validate_board(cfg["control_root"])
    if verified.get("migration_required"):
        conn.close()
        raise RuntimeError("RUNTIME_BOARD_PROOF_MIGRATION_REQUIRED")
    conn.execute("INSERT INTO meta VALUES('configuration',?)", (identity,))
    event(conn, "initialized", epoch=cfg["epoch"], model=MODEL, capacity=3)
    return conn


def identity_live(pid, started):
    return bool(pid and started and birth(pid) == started)


def recover(cfg, conn):
    for row in conn.execute("SELECT * FROM jobs WHERE state IN ('STARTING','RUNNING')").fetchall():
        if identity_live(row["entry_pid"], row["entry_birth"]):
            continue
        try:
            with lock(root(cfg) / "locks" / (row["id"] + ".lock")):
                # The entry can outlive a killed worker briefly inside its cgroup.
                # Shared lock excludes the old runner too; no second writer starts.
                with lock(Path(cfg["control_root"]) / ("codex-" + row["role"] + ".lock")):
                    transition(conn, row["id"], "UNKNOWN", "SUPERVISOR_LOST_NO_AUTOMATIC_REPLAY")
        except BlockingIOError:
            continue
    for row in conn.execute("SELECT * FROM jobs WHERE state='UNKNOWN' AND kind='implement'").fetchall():
        identifier = "reconcile-" + row["id"]
        if conn.execute("SELECT 1 FROM jobs WHERE id=?", (identifier,)).fetchone():
            continue
        try:
            check_mode(cfg, row["role"])
            identity = freeze_candidate(cfg, row, {})
            _, reviewer, spec = review_spec(cfg, row, identity, {
                "outcome": "UNKNOWN: do not authorize a write replay or claim success",
                "task": json.loads(row["spec"])["task"],
                "logs": str(root(cfg) / "jobs" / row["id"]),
                "requested_result": "Inspect preserved source, logs and exact identity. Identify provable safe next actions and unresolved external effects."})
            spec["worktree"] = str(worktree_path(cfg, reviewer, identifier))
            add_job(conn, identifier, reviewer, "reconcile_review", spec)
        except (RuntimeError, OSError, subprocess.SubprocessError) as error:
            # Persist a single local blockage; do not rerun preservation every tick.
            add_job(conn, identifier, other_role(cfg, row["role"]), "reconcile_review", {"author_job": row["id"]})
            transition(conn, identifier, "BLOCKED", "PRESERVATION_REQUIRES_INSPECTION: " + str(error)[:200])


def worktree_path(cfg, role, job):
    return Path(cfg["control_root"]) / "worktrees" / role / ("runtime-" + job)


def make_worktree(cfg, role, job, base):
    target = worktree_path(cfg, role, job)
    if target.exists():
        raise RuntimeError("RUNTIME_WORKTREE_ALREADY_EXISTS_RECONCILE_REQUIRED")
    target.parent.mkdir(parents=True, exist_ok=True)
    git(cfg["repo"], "worktree", "add", "-b", "exec/" + role + "/runtime-" + job, str(target), base)
    return str(target)


def other_role(cfg, author):
    choices = [r for r in cfg["enabled_roles"] if r != author]
    if not choices:
        raise RuntimeError("RUNTIME_INDEPENDENT_REVIEW_PROFILE_REQUIRED")
    with db(cfg) as conn:
        pending = {r: conn.execute("SELECT count(*) FROM jobs WHERE role=? AND state IN ('READY','STARTING','RUNNING')", (r,)).fetchone()[0] for r in choices}
    return min(choices, key=lambda r: pending[r])


def paths_reserved(conn):
    reserved = set()
    # Accepted but unintegrated candidates reserve paths to avoid parallel stale edits.
    for row in conn.execute("SELECT spec FROM jobs WHERE kind='implement' AND state NOT IN ('INTEGRATED','ABANDONED')"):
        reserved.update(json.loads(row[0]).get("task", {}).get("paths", []))
    for row in conn.execute("SELECT paths FROM claims WHERE state='ACTIVE'"):
        reserved.update(json.loads(row[0]))
    return reserved


def enqueue(cfg, conn):
    board = work_queue.validate_board(cfg["control_root"])
    if board.get("migration_required"):
        event(conn, "board_migration_required", invalidated=board.get("invalidated", []))
    existing = {json.loads(r[0]).get("task", {}).get("id") for r in conn.execute("SELECT spec FROM jobs WHERE kind='implement'")}
    reserved = paths_reserved(conn)
    for role in cfg["enabled_roles"]:
        try:
            check_mode(cfg, role)
        except RuntimeError:
            continue
        available = {t["id"] for t in work_queue.role_work(cfg["control_root"], role)["tasks"] if t["state"] == "READY"}
        tasks = [t for t in board["board"]["tasks"] if t["role"] == role and t["id"] in available]
        for task in tasks:
            if task["id"] in existing or set(task.get("paths", [])) & reserved:
                continue
            validate_task(cfg, task)
            if not task.get("boundary") or not task.get("required_checks"):
                event(conn, "task_proof_contract_missing", task["id"])
                continue
            base = git(cfg["repo"], "rev-parse", cfg.get("base_ref", "origin/main") + "^{commit}")
            identifier = "exec-" + digest(task["id"] + ":" + str(task.get("proof_generation", 0)))[:20]
            spec = {"task": task, "base": base, "rules": rules_snapshot(cfg),
                    "worktree": str(worktree_path(cfg, role, identifier)), "epoch": cfg["epoch"]}
            conn.execute("BEGIN IMMEDIATE")
            try:
                if set(task["paths"]) & paths_reserved(conn):
                    conn.rollback(); continue
                add_job(conn, identifier, role, "implement", spec)
                conn.commit()
            except BaseException:
                conn.rollback(); raise
            reserved.update(task["paths"])


def schedule_planners(cfg, conn):
    reqs = requirements(cfg)
    for role in cfg["enabled_roles"]:
        try:
            check_mode(cfg, role)
        except RuntimeError:
            continue
        if conn.execute("SELECT 1 FROM jobs WHERE role=? AND state IN ('READY','STARTING','RUNNING','RESULT')", (role,)).fetchone():
            continue
        previous = conn.execute("SELECT created FROM jobs WHERE role=? AND kind='plan' ORDER BY created DESC LIMIT 1", (role,)).fetchone()
        if previous and time.time() - previous[0] < cfg.get("planner_interval_seconds", 1800):
            continue
        task_view = work_queue.role_work(cfg["control_root"], role)
        own = [r for r in reqs.values() if r["role"] == role]
        if not own:
            continue
        # Snapshot all existing tasks and durable outcomes, including UNKNOWN/rework.
        board = work_queue.load_board(cfg["control_root"])
        history = [{"id": r["id"], "kind": r["kind"], "state": r["state"],
                    "reason": r["reason"], "result": json.loads(r["result"]) if r["result"] else None}
                   for r in conn.execute("SELECT * FROM jobs WHERE kind NOT IN ('plan','plan_review') ORDER BY created DESC LIMIT 100")]
        identifier = "plan-" + role + "-" + str(time.time_ns())
        base = git(cfg["repo"], "rev-parse", cfg.get("base_ref", "origin/main") + "^{commit}")
        input_digest = digest(encode({"requirements": own, "board": board, "base": base,
                                     "outcomes": history, "rules": rules_snapshot(cfg)}))
        if any(json.loads(r[0]).get("input_digest") == input_digest for r in conn.execute("SELECT spec FROM jobs WHERE role=? AND kind='plan'", (role,))):
            continue
        spec = {"requirements": own, "queue": board, "outcomes": history, "role_view": task_view,
                "reserved_paths": sorted(paths_reserved(conn)), "base": base, "rules": rules_snapshot(cfg),
                "worktree": str(worktree_path(cfg, role, identifier)), "epoch": cfg["epoch"], "input_digest": input_digest}
        add_job(conn, identifier, role, "plan", spec)


def prepare(cfg, row):
    spec = json.loads(row["spec"])
    path = Path(spec["worktree"])
    if path.exists():
        with db(cfg) as conn:
            launched = conn.execute("SELECT 1 FROM events WHERE job=? AND event='codex_launch_intent'", (row["id"],)).fetchone()
        expected = spec.get("identity", {}).get("candidate_sha") or spec["base"]
        if launched or path.resolve() != path or git(path, "rev-parse", "HEAD") != expected or git(path, "status", "--porcelain"):
            raise RuntimeError("RUNTIME_UNCLAIMED_WORKTREE_EXISTS")
        return
    make_worktree(cfg, row["role"], row["id"], spec.get("identity", {}).get("candidate_sha") or spec["base"])


def launch(cfg, conn):
    children = []
    busy = {r[0] for r in conn.execute("SELECT role FROM jobs WHERE state IN ('STARTING','RUNNING')")}
    # Oldest ready job first: a continuous review/hotfix stream cannot starve a feature.
    for row in conn.execute("SELECT * FROM jobs WHERE state='READY' AND kind IN ('implement','review','plan','plan_review','reconcile_review') ORDER BY created,id").fetchall():
        if row["role"] in busy:
            continue
        try:
            check_mode(cfg, row["role"])
            with lock(Path(cfg["control_root"]) / ("codex-" + row["role"] + ".lock")):
                pass
            prepare(cfg, row)
        except BlockingIOError:
            continue
        except (RuntimeError, OSError, subprocess.SubprocessError) as error:
            transition(conn, row["id"], "BLOCKED", str(error)[:250])
            continue
        token = row["token"] + 1
        conn.execute("UPDATE jobs SET state='STARTING',token=?,attempts=attempts+1,updated=? WHERE id=?", (token, time.time(), row["id"]))
        event(conn, "worker_launch_intent", row["id"], token=token)
        directory = root(cfg) / "jobs" / row["id"]
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        with (directory / "supervisor.log").open("ab") as output:
            os.chmod(directory / "supervisor.log", 0o600)
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--config", cfg["config_path"],
                                      "worker", "--job", row["id"], "--token", str(token)],
                                     stdin=subprocess.DEVNULL, stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        children.append(child)
        busy.add(row["role"])
    return children


def worker(cfg, identifier, token):
    with lock(root(cfg) / "locks" / (identifier + ".lock")):
        conn = db(cfg)
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (identifier,)).fetchone()
        if not row or row["state"] != "STARTING" or row["token"] != token:
            return 77
        check_mode(cfg, row["role"])
        spec = json.loads(row["spec"])
        event(conn, "worker_registered", identifier, pid=os.getpid(), birth=birth(os.getpid()), token=token)
        try:
            code = resource_runner.run(row["role"], [sys.executable, str(Path(__file__).resolve()),
                    "--config", cfg["config_path"], "entry", "--job", identifier, "--token", str(token)],
                    Path(spec["worktree"]), os.environ.copy(), Path(cfg["control_root"]),
                    profile="general", timeout_seconds=cfg.get("job_timeout_seconds", 3600))
            current = conn.execute("SELECT state FROM jobs WHERE id=?", (identifier,)).fetchone()[0]
            if current in {"STARTING", "RUNNING"}:
                transition(conn, identifier, "BLOCKED" if current == "STARTING" and code == 75 else "UNKNOWN",
                           "RESOURCE_ADMISSION_WAIT" if code == 75 else "RESOURCE_RUNNER_EXIT_WITHOUT_RESULT")
            return code
        except (RuntimeError, OSError, subprocess.SubprocessError) as error:
            transition(conn, identifier, "UNKNOWN", "SUPERVISOR_FAILURE: " + type(error).__name__)
            return 1
        finally:
            conn.close()


def freeze_candidate(cfg, row, result):
    spec = json.loads(row["spec"])
    worktree = Path(spec["worktree"])
    if git(worktree, "rev-parse", "HEAD") != spec["base"]:
        raise RuntimeError("RUNTIME_CHILD_CHANGED_GIT_HEAD")
    if git(worktree, "diff", "--cached", "--name-only"):
        raise RuntimeError("RUNTIME_CHILD_CHANGED_GIT_INDEX")
    changed = git(worktree, "diff", "--name-only", "HEAD", "--").splitlines()
    changed += git(worktree, "ls-files", "--others", "--exclude-standard").splitlines()
    if not set(changed).issubset(set(spec["task"]["paths"])):
        raise RuntimeError("RUNTIME_CHILD_SCOPE_VIOLATION")
    for relative in changed:
        path = worktree / relative
        if path.is_symlink() or not path.resolve().is_relative_to(worktree):
            raise RuntimeError("RUNTIME_CHILD_SYMLINK_REJECTED")
    if changed:
        git(worktree, "add", "--", *sorted(set(changed)))
        git(worktree, "commit", "-m", "runtime checkpoint NOT_ACCEPTED: " + spec["task"]["id"])
    identity = candidate_identity(worktree, spec.get("scope_base", spec["base"]))
    if git(worktree, "status", "--porcelain"):
        raise RuntimeError("RUNTIME_CANDIDATE_NOT_CLEAN")
    return identity


def review_spec(cfg, row, identity, payload):
    spec = json.loads(row["spec"])
    role = other_role(cfg, row["role"])
    identifier = "review-" + row["id"]
    return identifier, role, {"author_job": row["id"], "author": row["role"], "identity": identity,
            "base": spec.get("scope_base", spec["base"]), "payload": payload, "rules": rules_snapshot(cfg),
            "worktree": str(worktree_path(cfg, role, identifier)), "epoch": cfg["epoch"]}


def accepted_verifier(cfg, conn, review_id):
    def verify(task, payload, receipt_digest):
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (review_id,)).fetchone()
        if not row or row["kind"] != "review" or row["state"] not in {"RESULT", "DONE"}:
            raise RuntimeError("RUNTIME_TRUSTED_REVIEW_REQUIRED")
        spec, verdict = json.loads(row["spec"]), json.loads(row["result"])
        adapter = read_json(root(cfg) / "jobs" / review_id / "adapter-receipt.json")
        if (row["role"] == spec["author"] or row["role"] != adapter["role"] or adapter["model"] != MODEL
                or adapter["adapter_status"] != "RESULT_VALIDATED" or adapter["token"] != row["token"]
                or adapter["result_sha256"] != digest(encode(verdict)) or verdict["verdict"] != "ACCEPT"
                or payload["candidate"] != {"sha": spec["identity"]["candidate_sha"], "tree": spec["identity"]["candidate_tree"], "diff_sha256": spec["identity"]["diff_sha256"]}
                or spec["epoch"] != cfg["epoch"]):
            raise RuntimeError("RUNTIME_TRUSTED_REVIEW_MISMATCH")
        return {"reviewer": row["role"], "result": "ACCEPT", "candidate": payload["candidate"],
                "level": task["boundary"], "epoch": cfg["epoch"], "review_job_id": review_id}
    return verify


def complete_task(cfg, conn, row, spec, verdict):
    author = conn.execute("SELECT * FROM jobs WHERE id=?", (spec["author_job"],)).fetchone()
    authored = json.loads(author["spec"])
    board = work_queue.load_board(cfg["control_root"])
    task = next(t for t in board["tasks"] if t["id"] == authored["task"]["id"])
    if task["boundary"] != "SOURCE":
        raise RuntimeError("RUNTIME_SOURCE_COLLECTOR_CANNOT_PROVE_HIGHER_BOUNDARY")
    if task.get("proof_generation", 0) != spec.get("generation"):
        raise RuntimeError("RUNTIME_REVIEW_GENERATION_CHANGED")
    for key in ("role", "plan", "paths", "acceptance", "boundary", "required_checks", "requires", "result", "basis", "requirement_id"):
        if task.get(key) != authored["task"].get(key):
            raise RuntimeError("RUNTIME_TASK_CONTRACT_CHANGED_AFTER_AUTHOR")
    current = candidate_identity(authored["worktree"], authored.get("scope_base", authored["base"]))
    if current != spec["identity"] or git(authored["worktree"], "status", "--porcelain"):
        raise RuntimeError("RUNTIME_CANDIDATE_CHANGED_AFTER_REVIEW")
    candidate = {"sha": current["candidate_sha"], "tree": current["candidate_tree"], "diff_sha256": current["diff_sha256"]}
    dependencies = {}
    for identifier in task["requires"]:
        dependency = next(t for t in board["tasks"] if t["id"] == identifier)
        dependencies[identifier] = digest(Path(dependency["completion_receipt"]).read_bytes())
    # Review output is retained as evidence of an independent inspection, but it
    # cannot stand in for a requested product test. Every required check names a
    # separately existing evidence file, observed and approved by the reviewer.
    author_result = json.loads(author["result"])
    directory = root(cfg) / "jobs" / author["id"]
    collected = read_json(directory / "trusted-checks.json")
    if collected.get("collector", "SUPERVISOR_SUBPROCESS") != "SUPERVISOR_SUBPROCESS" or collected.get("token") != author["token"] or collected.get("job") != author["id"] or collected.get("boundary") != "SOURCE":
        raise RuntimeError("RUNTIME_TRUSTED_CHECK_BINDING_INVALID")
    checks = []
    for name in task["required_checks"]:
        check = next((x for x in collected["checks"] if x["id"] == name and x["exit_code"] == 0), None)
        if check is None:
            raise RuntimeError("RUNTIME_REQUIRED_CHECK_MISSING: " + name)
        evidence = directory / "trusted-checks.json"
        if (check["collector"] != "SUPERVISOR_SUBPROCESS" or check["argv_sha256"] != digest(encode(cfg["check_catalog"][name]["argv"]))
                or check["log_sha256"] != digest(Path(check["log_path"]).read_bytes())):
            raise RuntimeError("RUNTIME_CHECK_EVIDENCE_CHANGED_OR_NOT_OBSERVED")
        checks.append({"id": name, "result": "PASS", "candidate": candidate, "level": task["boundary"],
                       "evidence_path": str(evidence), "evidence_sha256": digest(evidence.read_bytes())})
    receipt = {"version": 2, "task_id": task["id"], "candidate": candidate, "author": author["role"],
               "generation": task.get("proof_generation", 0), "result": "PASS", "level": task["boundary"],
               "epoch": cfg["epoch"], "issued_at": datetime.now(timezone.utc).isoformat(),
               "expires_at": None if task["boundary"] in {"SOURCE", "PACKAGE"} else task.get("evidence_expires_at"),
               "checks": checks, "review": {"reviewer": row["role"], "result": "ACCEPT", "candidate": candidate},
               "proof_validity": task.get("proof_validity"),
               "dependencies": dependencies}
    path = root(cfg) / "jobs" / row["id"] / "completion-receipt.json"
    atomic_json(path, receipt)
    work_queue.register_acceptance(cfg["control_root"], task["id"], str(path),
                                   review_verifier=accepted_verifier(cfg, conn, row["id"]))
    work_queue.advance_task(cfg["control_root"], author["role"], task["id"], "DONE", receipt=str(path))
    transition(conn, author["id"], "ACCEPTED", result={**author_result, "candidate": candidate})
    # A durable C handoff is consumed by the same runtime without a chat wakeup.
    add_job(conn, "integrate-" + author["id"], "C", "integrate", {
        "author_job": author["id"], "task_id": task["id"], "candidate": candidate,
        "base": authored.get("scope_base", authored["base"]), "receipt": str(path), "epoch": cfg["epoch"], "rules": rules_snapshot(cfg)})


def enqueue_rework(cfg, conn, review_row, review_specification, verdict):
    author = conn.execute("SELECT * FROM jobs WHERE id=?", (review_specification["author_job"],)).fetchone()
    original = json.loads(author["spec"])
    generation = original.get("rework_attempt", 0) + 1
    transition(conn, author["id"], "REWORK", verdict["summary"])
    if generation > 3:
        event(conn, "rework_limit_requires_new_evidence", author["id"])
        return
    identifier = "fix-" + digest(author["id"] + ":" + review_row["id"])[:20]
    spec = dict(original, base=review_specification["identity"]["candidate_sha"],
                scope_base=original.get("scope_base", original["base"]),
                worktree=str(worktree_path(cfg, author["role"], identifier)),
                feedback=verdict, rework_attempt=generation, rules=rules_snapshot(cfg))
    add_job(conn, identifier, author["role"], "implement", spec)


def finalize(cfg, conn):
    for row in conn.execute("SELECT * FROM jobs WHERE state='RESULT' ORDER BY created").fetchall():
        try:
            check_mode(cfg, row["role"])
            result, spec = json.loads(row["result"]), json.loads(row["spec"])
            if row["kind"] == "reconcile_review":
                transition(conn, row["id"], "RECONCILIATION_REVIEWED", result["summary"])
                continue
            if result["verdict"] in {"REWORK", "BLOCKED"}:
                if result["verdict"] == "REWORK" and row["kind"] == "review":
                    enqueue_rework(cfg, conn, row, spec, result)
                transition(conn, row["id"], result["verdict"], result["summary"])
                continue
            if row["kind"] == "implement":
                identity = freeze_candidate(cfg, row, result)
                candidate = {"sha": identity["candidate_sha"], "tree": identity["candidate_tree"], "diff_sha256": identity["diff_sha256"]}
                work_queue.bind_candidate(cfg["control_root"], row["role"], spec["task"]["id"], candidate, row["role"])
                identifier, reviewer, review = review_spec(cfg, row, identity, {"task": spec["task"], "author_result": result})
                bound = next(t for t in work_queue.load_board(cfg["control_root"])["tasks"] if t["id"] == spec["task"]["id"])
                review["generation"] = bound.get("proof_generation", 0)
                review["trusted_checks"] = str(root(cfg) / "jobs" / row["id"] / "trusted-checks.json")
                add_job(conn, identifier, reviewer, "review", review)
                transition(conn, row["id"], "REVIEW_PENDING")
            elif row["kind"] == "review":
                complete_task(cfg, conn, row, spec, result)
                transition(conn, row["id"], "DONE")
            elif row["kind"] == "plan":
                tasks = json.loads(result["tasks_json"])
                if not isinstance(tasks, list) or len(tasks) > 3:
                    raise RuntimeError("RUNTIME_PLAN_TASK_LIMIT")
                for task in tasks:
                    validate_task(cfg, task)
                    if task["role"] != row["role"]:
                        raise RuntimeError("RUNTIME_PLAN_CANNOT_ASSIGN_PEER")
                if not tasks:
                    if not result["remaining"]:
                        raise RuntimeError("RUNTIME_PLAN_EMPTY_WITHOUT_GAP_ACCOUNTING")
                    transition(conn, row["id"], "IDLE_RECONCILIATION")
                    continue
                identity = candidate_identity(spec["worktree"], spec["base"])
                identity["diff_sha256"] = digest(encode(tasks))
                identifier, reviewer, review = review_spec(cfg, row, identity, {"tasks": tasks, "requirements": spec["requirements"]})
                add_job(conn, identifier, reviewer, "plan_review", review)
                transition(conn, row["id"], "REVIEW_PENDING")
            elif row["kind"] == "plan_review":
                for task in spec["payload"]["tasks"]:
                    validate_task(cfg, task)
                    if set(task["paths"]) & paths_reserved(conn):
                        raise RuntimeError("RUNTIME_PLANNED_PATHS_BECAME_BUSY")
                    board = work_queue.load_board(cfg["control_root"])
                    if not any(t["id"] == task["id"] for t in board["tasks"]):
                        work_queue.add_task(cfg["control_root"], task["role"], task, repo_root=cfg["repo"])
                transition(conn, spec["author_job"], "DONE")
                transition(conn, row["id"], "DONE")
        except (RuntimeError, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
            transition(conn, row["id"], "BLOCKED", str(error)[:250])


def snapshot(cfg, conn):
    rows = [{k: r[k] for k in ("id", "role", "kind", "state", "reason", "updated", "attempts")}
            for r in conn.execute("SELECT * FROM jobs ORDER BY created")]
    return {"epoch": cfg["epoch"], "model": MODEL, "capacity": 3, "project_ready": False,
            "status": "ACTIVE" if any(r["state"] in {"STARTING", "RUNNING"} for r in rows) else "IDLE_RECONCILIATION",
            "jobs": rows, "integration_enabled": cfg.get("integration_enabled", False)}


def manual_claim(cfg, conn, role, owner, base, paths):
    check_mode(cfg, role)
    if not owner or not isinstance(paths, list) or not paths or git(cfg["repo"], "rev-parse", base + "^{commit}") != base:
        raise RuntimeError("RUNTIME_MANUAL_CLAIM_INVALID")
    for path in paths:
        if (not isinstance(path, str) or not path or Path(path).is_absolute() or ".." in Path(path).parts
                or any(x in path for x in "*?[\0") or any(x in Path(path).parts for x in (".git", "node_modules"))):
            raise RuntimeError("RUNTIME_MANUAL_CLAIM_PATH_INVALID")
    conn.execute("BEGIN IMMEDIATE")
    try:
        if set(paths) & paths_reserved(conn):
            raise RuntimeError("RUNTIME_SCOPE_ALREADY_CLAIMED")
        identifier, token = "manual-" + secrets.token_hex(12), secrets.token_hex(32)
        conn.execute("INSERT INTO claims VALUES(?,?,?,?,?,?,'ACTIVE',?)",
                     (identifier, role, owner, base, encode(paths), digest(token), time.time()))
        event(conn, "manual_scope_claimed", identifier, role=role, owner=owner, base=base, paths=paths)
        conn.commit()
    except BaseException:
        conn.rollback(); raise
    token_path = root(cfg) / "claims" / (identifier + ".json")
    atomic_json(token_path, {"id": identifier, "token": token, "epoch": cfg["epoch"]})
    return {"id": identifier, "token_file": str(token_path), "paths": paths, "state": "ACTIVE"}


def release_claim(cfg, conn, token_file):
    proof = read_json(token_file)
    row = conn.execute("SELECT * FROM claims WHERE id=?", (proof.get("id"),)).fetchone()
    if not row or proof.get("epoch") != cfg["epoch"] or digest(proof.get("token", "")) != row["token_sha256"]:
        raise RuntimeError("RUNTIME_CLAIM_OWNER_TOKEN_INVALID")
    conn.execute("UPDATE claims SET state='RELEASED' WHERE id=?", (row["id"],))
    event(conn, "manual_scope_released", row["id"])
    return {"id": row["id"], "state": "RELEASED"}


def tick(cfg, conn):
    check_mode(cfg)
    recover(cfg, conn)
    finalize(cfg, conn)
    from continuous_integration import integrate_tick
    integrate_tick(cfg, conn)
    enqueue(cfg, conn)
    schedule_planners(cfg, conn)
    children = launch(cfg, conn)
    atomic_json(root(cfg) / "status.json", snapshot(cfg, conn))
    return children


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("check"); p.add_argument("--login", action="store_true")
    for command in ("status", "once", "serve"):
        sub.add_parser(command)
    p = sub.add_parser("add"); p.add_argument("--task-file", required=True)
    p = sub.add_parser("inspect"); p.add_argument("--job", required=True)
    p = sub.add_parser("reconcile"); p.add_argument("--job", required=True); p.add_argument("--receipt", required=True)
    p = sub.add_parser("claim"); p.add_argument("--role", choices=ROLES, required=True); p.add_argument("--owner", required=True); p.add_argument("--base", required=True); p.add_argument("--paths-file", required=True)
    p = sub.add_parser("release"); p.add_argument("--token-file", required=True)
    for command in ("worker", "entry"):
        p = sub.add_parser(command); p.add_argument("--job", required=True); p.add_argument("--token", type=int, required=True)
    args = parser.parse_args()
    cfg = config(args.config)
    if args.command == "check":
        print(encode(check(cfg, args.login))); return 0
    if args.command in {"worker", "entry"}:
        return (worker if args.command == "worker" else run_entry)(cfg, args.job, args.token)
    conn = initialize(cfg)
    if args.command == "claim":
        print(encode(manual_claim(cfg, conn, args.role, args.owner, args.base, read_json(args.paths_file)))); return 0
    if args.command == "release":
        print(encode(release_claim(cfg, conn, args.token_file))); return 0
    if args.command == "status":
        print(encode(snapshot(cfg, conn))); return 0
    if args.command == "inspect":
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (args.job,)).fetchone()
        print(encode(dict(row) if row else None)); return 0
    if args.command == "add":
        task = read_json(args.task_file); validate_task(cfg, task)
        check_mode(cfg, task["role"])
        print(encode(work_queue.add_task(cfg["control_root"], task["role"], task, repo_root=cfg["repo"]))); return 0
    if args.command == "reconcile":
        receipt = read_json(args.receipt)
        row = conn.execute("SELECT * FROM jobs WHERE id=?", (args.job,)).fetchone()
        if (not row or row["state"] != "UNKNOWN" or receipt.get("job") != args.job
                or receipt.get("epoch") != cfg["epoch"] or receipt.get("disposition") != "PRESERVED_ABANDONED"
                or not receipt.get("evidence") or not receipt.get("operator")):
            raise RuntimeError("RUNTIME_RECONCILIATION_CANNOT_CONVERT_UNKNOWN_TO_SUCCESS")
        transition(conn, args.job, "ABANDONED", "EXPLICIT_PRESERVED_ABANDONMENT")
        event(conn, "reconciled", args.job, receipt_sha256=digest(Path(args.receipt).read_bytes()))
        return 0
    with lock(root(cfg) / "daemon.lock"):
        stop = []
        signal.signal(signal.SIGTERM, lambda *_: stop.append(True))
        signal.signal(signal.SIGINT, lambda *_: stop.append(True))
        children = []
        while not stop:
            try:
                children.extend(tick(cfg, conn))
            except (RuntimeError, OSError, ValueError) as error:
                atomic_json(root(cfg) / "status.json", {"status": "BLOCKED", "reason": str(error)[:250], "project_ready": False})
                if args.command == "once":
                    raise
            children[:] = [p for p in children if p.poll() is None]
            if args.command == "once":
                break
            # Stop responsiveness is bounded without long blocking sleeps.
            for _ in range(cfg.get("poll_seconds", 10) * 4):
                if stop: break
                time.sleep(0.25)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(encode({"status": "BLOCKED", "reason": str(error)[:250], "project_ready": False}), file=sys.stderr)
        raise SystemExit(1)
