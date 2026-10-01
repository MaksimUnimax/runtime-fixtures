"""Fixed subscription Codex adapter, executed only inside resource_runner cgroups."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import re
import continuous_environment

from continuous_state import (LAUNCHERS, MODEL, atomic_json, birth, check_mode, db,
                           digest, encode, event, git, lock, read_json, root,
                           rules_snapshot, transition, requirements)

SCHEMA = {
    "type": "object", "additionalProperties": False,
    "properties": {
        "verdict": {"type": "string", "enum": ["PASS", "ACCEPT", "REWORK", "BLOCKED"]},
        "summary": {"type": "string"},
        "candidate_sha": {"type": "string"},
        "candidate_tree": {"type": "string"},
        "diff_sha256": {"type": "string"},
        "checks": {"type": "array", "items": {
            "type": "object", "additionalProperties": False,
            "properties": {"name": {"type": "string"}, "exit_code": {"type": "integer"},
                           "evidence": {"type": "string"}},
            "required": ["name", "exit_code", "evidence"]}},
        "findings": {"type": "array", "items": {"type": "string"}},
        "tasks_json": {"type": "string"},
        "remaining": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "summary", "candidate_sha", "candidate_tree", "diff_sha256",
                 "checks", "findings", "tasks_json", "remaining"],
}
CONTRACT = """You are a bounded server execution child. Only gpt-6-luna is authorized.
Do not create other agents, change model, use API keys, or bypass sandbox/approval.
Do not stage, commit, push, change shared Git metadata or call parent control.py.
Do not touch active A/B/C parent worktrees, credentials, live services, production,
store publication, platform-denied operations, unrelated files, or historical cleanup.
STOP always wins. Read AGENTS.md and current task-relevant rules and contracts.
Any existing security/platform denial remains in force; another identity is no retry.
Perform only the exact assigned scope. No detached servers, browsers or worker pools.
Small bounded unit checks are allowed; request supervised heavy checks as BLOCKED.
Missing exact Node/pnpm/browser/dependencies/DB prerequisites are BLOCKED; do not link
shared node_modules or weaken tests. Report exact checks, output evidence, limitations.
Report JSON according to the output schema. Exit status alone is never acceptance.
Use empty strings/arrays for fields not relevant. Never declare whole project ready.
Evidence must distinguish SOURCE/PACKAGE/INSTALLED_SYNTHETIC/LIVE/DEPLOYMENT.
"""


class CheckFailure(RuntimeError):
    pass


def source_inputs(cfg, task):
    if any(identifier not in cfg.get("check_catalog", {}) for identifier in task.get("required_checks", [])):
        raise RuntimeError("RUNTIME_TRUSTED_CHECK_NOT_CONFIGURED")
    selected = {identifier: cfg["check_catalog"][identifier] for identifier in task["required_checks"]}
    return {"requirements_sha256": digest(encode(requirements(cfg)[task["requirement_id"]])),
            "rules_sha256": digest(encode(rules_snapshot(cfg))),
            "check_catalog_sha256": digest(encode(selected))}


def source_snapshot(worktree, paths):
    values = {}
    for relative in paths:
        path = Path(worktree) / relative
        if path.is_symlink() or not path.resolve().is_relative_to(Path(worktree)):
            raise RuntimeError("RUNTIME_SOURCE_SYMLINK_REJECTED")
        values[relative] = {"sha256": digest(path.read_bytes()), "executable": bool(path.stat().st_mode & 0o111)} if path.is_file() else "ABSENT"
    return digest(encode(values))


def require_managed_job(cfg, conn, job, role):
    cgroup = Path("/proc/self/cgroup").read_text()
    match = re.search(r"octoport-test-" + role.lower() + r"-([a-f0-9]+)\.service", cgroup)
    if not match:
        raise RuntimeError("RUNTIME_MANAGED_CGROUP_REQUIRED")
    receipt = read_json(Path(cfg["control_root"]) / "resource-jobs" / match[1] / "receipt.json")
    owners = [json.loads(r[0]) for r in conn.execute("SELECT data FROM events WHERE job=? AND event='worker_registered'", (job,))]
    if (receipt.get("role") != role or receipt.get("state") == "FINISHED"
            or not any(x["pid"] == receipt.get("owner_pid") and x["birth"] == receipt.get("owner_start") for x in owners)):
        raise RuntimeError("RUNTIME_MANAGED_CGROUP_OWNER_MISMATCH")


def candidate_identity(worktree, base, candidate=None):
    head = candidate or git(worktree, "rev-parse", "HEAD")
    return {"candidate_sha": head, "candidate_tree": git(worktree, "rev-parse", head + "^{tree}"),
            "diff_sha256": digest(subprocess.check_output(
                ["git", "diff", "--binary", "--no-ext-diff", base, head, "--"], cwd=worktree))}


def validate_result(kind, value, spec):
    if not isinstance(value, dict) or set(value) != set(SCHEMA["required"]):
        raise RuntimeError("RUNTIME_RESULT_SCHEMA_INVALID")
    for field in ("summary", "candidate_sha", "candidate_tree", "diff_sha256", "tasks_json"):
        if not isinstance(value[field], str):
            raise RuntimeError("RUNTIME_RESULT_SCHEMA_INVALID")
    if not value["summary"].strip() or value["verdict"] not in {"PASS", "ACCEPT", "REWORK", "BLOCKED"}:
        raise RuntimeError("RUNTIME_RESULT_VERDICT_INVALID")
    for field in ("findings", "remaining"):
        if not isinstance(value[field], list) or not all(isinstance(x, str) for x in value[field]):
            raise RuntimeError("RUNTIME_RESULT_SCHEMA_INVALID")
    if not isinstance(value["checks"], list):
        raise RuntimeError("RUNTIME_RESULT_CHECKS_INVALID")
    for check in value["checks"]:
        if (not isinstance(check, dict) or set(check) != {"name", "exit_code", "evidence"}
                or type(check["exit_code"]) is not int or not isinstance(check["name"], str)
                or not isinstance(check["evidence"], str) or not check["name"] or not check["evidence"]):
            raise RuntimeError("RUNTIME_RESULT_CHECKS_INVALID")
    if kind in {"review", "plan_review", "reconcile_review", "integration_review"}:
        if value["verdict"] not in {"ACCEPT", "REWORK", "BLOCKED"}:
            raise RuntimeError("RUNTIME_REVIEW_EXPLICIT_VERDICT_REQUIRED")
        for key in ("candidate_sha", "candidate_tree", "diff_sha256"):
            if value[key] != spec["identity"][key]:
                raise RuntimeError("RUNTIME_REVIEW_CANDIDATE_MISMATCH")
        if value["verdict"] == "ACCEPT" and (value["findings"] or not value["checks"]
                                              or any(x["exit_code"] != 0 for x in value["checks"])):
            raise RuntimeError("RUNTIME_REVIEW_ACCEPT_WITHOUT_PASSED_CHECKS")
    elif value["verdict"] not in {"PASS", "BLOCKED"}:
        raise RuntimeError("RUNTIME_AUTHOR_CANNOT_ACCEPT")
    return value


def prompt_for(cfg, row, spec):
    kind = row["kind"]
    text = CONTRACT + "\nJOB KIND: " + kind + "\nTRUSTED TASK DATA:\n" + encode(spec) + "\n"
    text += "Your actual tool output is captured in " + str(root(cfg) / "jobs" / row["id"] / "exec.log") + ". Report each required check name, observed exit code, and this log as evidence.\n"
    if kind == "implement":
        text += "Implement the exact task. Leave only assigned source changes. Do not write evidence files into unassigned repo paths. Report existing test logs as evidence.\n"
    elif kind in {"review", "reconcile_review", "integration_review"}:
        text += ("READ ONLY independent review. Inspect git diff from base to exact candidate; inspect code, requirements and recorded actual tests. "
                 "Verify scope, semantic requirement mapping, all acceptance criteria, absence of sensitive material and whether evidence actually exists. "
                 "Check commands/outputs independently where bounded. ACCEPT only exact candidate with sufficient boundary-specific evidence; "
                 "missing tests, unsupported claims or failed criteria mean REWORK/BLOCKED. Copy exact identity fields from trusted identity.\n")
    elif kind == "plan":
        text += ("READ ONLY planning. Map remaining approved requirement IDs to current code and existing evidence. "
                 "Propose at most three new exact owned-path tasks for concrete unproved gaps. Avoid completed/proven work, "
                 "already queued paths, repeated unchanged tests, adjacent product scope, or external denied actions. "
                 "tasks_json is a JSON array of full task objects including requirement_id, id, role, plan, state READY, "
                 "requires, result, paths, acceptance, basis, explicit boundary and required_checks. Empty tasks requires explicit remaining/blockers, never project ready.\n")
    else:
        text += ("READ ONLY independent planning review. Validate proposed task mapping against exact approved requirements and existing evidence; "
                 "check scope, missing prerequisites, busy paths, no redundant task or platform denial bypass. "
                 "ACCEPT only all proposed tasks; else REWORK. Copy exact trusted identity; do not rewrite the proposal.\n")
    return text + "\n" + CONTRACT


def run_entry(cfg, job, token):
    """Register before Codex launch; parent death cannot yield an untracked writer."""
    conn = db(cfg)
    row = conn.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
    if not row:
        return 77
    if row["token"] != token or row["state"] != "STARTING":
        conn.close()
        return 77
    def finish(state, reason=None, result=None):
        changed = conn.execute("UPDATE jobs SET state=?,reason=?,result=COALESCE(?,result),updated=? WHERE id=? AND token=? AND state IN ('STARTING','RUNNING') AND (entry_pid IS NULL OR entry_pid=?)",
            (state, reason, None if result is None else encode(result), time.time(), job, token, os.getpid())).rowcount
        if changed:
            event(conn, state.lower(), job, token=token, reason=reason)
    control = Path(cfg["control_root"])
    try:
        with lock(control / ("codex-" + row["role"] + ".lock")) as profile_lock:
            check_mode(cfg, row["role"])
            require_managed_job(cfg, conn, job, row["role"])
            spec = json.loads(row["spec"])
            if spec["rules"] != rules_snapshot(cfg):
                raise RuntimeError("RUNTIME_RULES_CHANGED_REPLAN_REQUIRED")
            conn.execute("BEGIN IMMEDIATE")
            current = conn.execute("SELECT * FROM jobs WHERE id=?", (job,)).fetchone()
            if current["state"] != "STARTING" or current["token"] != token or current["entry_pid"]:
                conn.rollback()
                return 77
            identity = birth(os.getpid())
            if identity is None:
                conn.rollback()
                raise RuntimeError("RUNTIME_PROCESS_IDENTITY_UNVERIFIED")
            conn.execute("UPDATE jobs SET state='RUNNING',entry_pid=?,entry_birth=?,updated=? WHERE id=?",
                         (os.getpid(), identity, time.time(), job))
            event(conn, "entry_registered", job, pid=os.getpid(), birth=identity, token=token)
            conn.commit()
            environment = os.environ.copy()
            for key in ("OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY"):
                environment.pop(key, None)
            login = subprocess.run([LAUNCHERS[row["role"]], "login", "status"], env=environment,
                                   text=True, capture_output=True, timeout=15)
            if login.returncode or "Logged in using ChatGPT" not in login.stdout + login.stderr:
                finish("BLOCKED", "CHATGPT_SUBSCRIPTION_LOGIN_REQUIRED")
                return 78
            worktree = Path(spec["worktree"])
            if worktree.resolve() != worktree or not worktree.is_dir():
                raise RuntimeError("RUNTIME_WORKTREE_INVALID")
            directory = root(cfg) / "jobs" / job
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            atomic_json(directory / "schema.json", SCHEMA)
            prompt_path = directory / "prompt.txt"
            prompt_path.write_text(prompt_for(cfg, row, spec))
            os.chmod(prompt_path, 0o600)
            result_path = directory / "result.json"
            if result_path.exists():
                raise RuntimeError("RUNTIME_RESULT_ALREADY_EXISTS")
            command = [LAUNCHERS[row["role"]], "exec", "-m", MODEL,
                       "-c", "features.multi_agent=false", "-s",
                       "workspace-write" if row["kind"] == "implement" else "read-only",
                       "-C", str(worktree), "--output-schema", str(directory / "schema.json"),
                       "-o", str(result_path), "-"]
            # A durable intent precedes Popen. This event means a later crash is UNKNOWN,
            # including the tiny boundary before the subprocess actually exists.
            with prompt_path.open() as source, (directory / "exec.log").open("wb") as log:
                os.chmod(directory / "exec.log", 0o600)
                with lock(control / (row["role"] + ".lock"), blocking=True):
                    check_mode(cfg, row["role"])
                    event(conn, "codex_launch_intent", job, model=MODEL, profile=row["role"], token=token)
                    child = subprocess.Popen(command, cwd=worktree, env=environment, stdin=source,
                                             stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
                                             pass_fds=(profile_lock.fileno(),))
                event(conn, "codex_started", job, pid=child.pid, birth=birth(child.pid), token=token)
                stop_reason = None
                while child.poll() is None:
                    try:
                        check_mode(cfg, row["role"])
                    except (RuntimeError, OSError, ValueError):
                        stop_reason = "STOP_OR_AUTHORITY_CHANGED"
                    if (directory / "exec.log").stat().st_size > 16 * 1024 * 1024:
                        stop_reason = "OUTPUT_LIMIT"
                    if stop_reason:
                        os.killpg(child.pid, signal.SIGTERM)
                        try:
                            child.wait(timeout=3)
                        except subprocess.TimeoutExpired:
                            os.killpg(child.pid, signal.SIGKILL)
                            child.wait()
                        break
                    time.sleep(0.25)
            if stop_reason or child.returncode:
                finish("UNKNOWN" if row["kind"] == "implement" else "BLOCKED", stop_reason or "CODEX_NONZERO_EXIT")
                return 1
            result = validate_result(row["kind"], read_json(result_path), spec)
            if row["kind"] == "implement" and result["verdict"] == "PASS":
                try:
                    run_checks(cfg, row, spec, directory)
                except CheckFailure:
                    result["summary"] += " [Supervisor: required checks failed; candidate is NOT_ACCEPTED.]"
            atomic_json(directory / "adapter-receipt.json", {
                "version": 1, "job": job, "token": token, "role": row["role"], "kind": row["kind"],
                "model": MODEL, "adapter_status": "RESULT_VALIDATED", "result_sha256": digest(encode(result)),
                "worktree": str(worktree), "exit_code": 0, "entry_pid": os.getpid(), "entry_birth": identity,
                "stdout_sha256": digest((directory / "exec.log").read_bytes()),
            })
            atomic_json(directory / "check-evidence.json", {"job": job, "role": row["role"],
                "adapter_exit_code": 0, "checks": result["checks"], "base": spec["base"],
                "stdout_path": str(directory / "exec.log"), "stdout_sha256": digest((directory / "exec.log").read_bytes()),
                "boundary": "MODEL_REPORTED_CHECKS_REQUIRING_INDEPENDENT_REVIEW"})
            finish("RESULT", result=result)
            return 0
    except BlockingIOError:
        launched = conn.execute("SELECT 1 FROM events WHERE job=? AND event='codex_launch_intent'", (job,)).fetchone()
        finish("UNKNOWN" if launched else "READY", "PROFILE_BUSY_BEFORE_LAUNCH")
        return 75
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        launched = conn.execute("SELECT 1 FROM events WHERE job=? AND event='codex_launch_intent'", (job,)).fetchone()
        finish("UNKNOWN" if launched and row["kind"] == "implement" else "BLOCKED", type(error).__name__ + ": " + str(error)[:250])
        return 1
    finally:
        conn.close()


def run_checks(cfg, row, spec, directory):
    """Trusted fixed catalogue argv, actual OS exit and bytes; no model test claims."""
    reports = []
    snapshot = source_snapshot(spec["worktree"], spec["task"]["paths"])
    inputs = source_inputs(cfg, spec["task"])
    for identifier in spec["task"].get("required_checks", []):
        check_mode(cfg, row["role"])
        check = cfg.get("check_catalog", {}).get(identifier)
        if not check:
            raise RuntimeError("RUNTIME_TRUSTED_CHECK_NOT_CONFIGURED")
        prepared = continuous_environment.ensure_environment(spec["worktree"], check.get("environment", {}), managed=True)
        if prepared["status"] != "READY":
            atomic_json(directory / "environment-blocked.json", prepared)
            raise RuntimeError("RUNTIME_ENVIRONMENT_BLOCKED: " + str(prepared["reason"]))
        argv = check["argv"]
        if not isinstance(argv, list) or not argv or not all(isinstance(x, str) and x and "\0" not in x for x in argv):
            raise RuntimeError("RUNTIME_TRUSTED_CHECK_ARGV_INVALID")
        output = directory / ("check-" + digest(identifier)[:16] + ".log")
        with output.open("wb") as log:
            os.chmod(output, 0o600)
            environment = {k: v for k, v in os.environ.items() if not k.startswith("PG") and k not in {
                "DATABASE_URL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY", "AZURE_OPENAI_API_KEY"}}
            environment["OCTOPORT_RUNTIME_CHECK_ROOT"] = str(directory / "checks")
            environment.update(prepared["execution_env"])
            environment["SA_NODE_BIN"] = str(continuous_environment.NODE_BIN)
            with lock(Path(cfg["control_root"]) / (row["role"] + ".lock"), blocking=True):
                check_mode(cfg, row["role"])
                child = subprocess.Popen(argv, cwd=spec["worktree"], stdout=log, stderr=subprocess.STDOUT,
                                         start_new_session=True, env=environment)
            deadline = time.monotonic() + min(int(check.get("timeout_seconds", 600)), 3600)
            while child.poll() is None:
                reason = None
                try:
                    check_mode(cfg, row["role"])
                except (RuntimeError, OSError, ValueError):
                    reason = "STOP"
                if time.monotonic() >= deadline or output.stat().st_size > 16 * 1024 * 1024:
                    reason = "CHECK_LIMIT"
                if reason:
                    os.killpg(child.pid, signal.SIGTERM)
                    try:
                        child.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        os.killpg(child.pid, signal.SIGKILL); child.wait()
                    raise RuntimeError("RUNTIME_TRUSTED_CHECK_" + reason)
                time.sleep(0.25)
        reports.append({"id": identifier, "argv_sha256": digest(encode(argv)), "exit_code": child.returncode,
                        "log_path": str(output), "log_sha256": digest(output.read_bytes()), "collector": "SUPERVISOR_SUBPROCESS",
                        "environment": prepared["evidence"]})
    if not reports:
        raise RuntimeError("RUNTIME_NO_TRUSTED_CHECKS")
    if snapshot != source_snapshot(spec["worktree"], spec["task"]["paths"]):
        raise RuntimeError("RUNTIME_CHECK_MUTATED_SOURCE")
    atomic_json(directory / "trusted-checks.json", {"version": 1, "job": row["id"], "token": row["token"],
                "model": MODEL, "role": row["role"], "boundary": "SOURCE", "checks": reports,
                "source_snapshot": snapshot, "input_hashes": inputs, "collector": "SUPERVISOR_SUBPROCESS"})
    if any(r["exit_code"] != 0 for r in reports):
        raise CheckFailure("RUNTIME_TRUSTED_CHECK_FAILED")
    return reports
