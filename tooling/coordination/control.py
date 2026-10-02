#!/usr/bin/env python3
"""Local coordination guard. Operational checks, not an OS security sandbox."""
import argparse
import contextlib
import fcntl
import fnmatch
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import sys
import time
import resource_runner
from waiting_gate import validate_waiting_receipt
from notice_delivery import read_controller_notices
from work_queue import status_work, compact_state, advance_task, add_task, claim_task, resolve_blocker, validate_task_scope, load_board
from disk_lifecycle import Registry as DiskLifecycleRegistry
from task_publication import validate_queue_completion_source_authority
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
CONTROL = Path("/root/octoport-control")
NODE = "/root/.nvm/versions/node/v24.20.0/bin"
PERIOD = 4 * 3600


def now_text():
    return datetime.now(timezone.utc).isoformat()


def display_review_reason(state):
    return state.get("review_reason") or "review pending"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def policy():
    return json.loads((ROOT / "docs/development/coordination/OWNERSHIP.json").read_text())


def require_location(role):
    spec = policy()["roles"][role]
    if str(ROOT) != spec["path"] or git("branch", "--show-current") != spec["branch"]:
        raise RuntimeError("ROLE_LOCATION_MISMATCH: use the assigned worktree and branch")


def require_publication_queue_location(role, task, registration_id):
    """Bind publication-backed queue mutation to an accepted source and role cwd."""
    try:
        authority = validate_queue_completion_source_authority(
            CONTROL, registration_id, ROOT, role, task
        )
        expected_path = authority["role_path"]
        expected_branch = authority["role_branch"]
        location = Path.cwd().resolve()
        top = Path(subprocess.check_output(
            ["git", "-C", str(location), "rev-parse", "--show-toplevel"],
            text=True,
        ).strip()).resolve()
        branch = subprocess.check_output(
            ["git", "-C", str(location), "branch", "--show-current"],
            text=True,
        ).strip()
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError, RuntimeError):
        raise RuntimeError("ROLE_LOCATION_MISMATCH: use accepted publication source and assigned role worktree/branch") from None
    if str(location) != expected_path or top != location or branch != expected_branch:
        raise RuntimeError("ROLE_LOCATION_MISMATCH: use accepted publication source and assigned role worktree/branch")


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


def update_state(role, action, args):
    CONTROL.mkdir(mode=0o700, exist_ok=True)
    with (CONTROL / (role + ".lock")).open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = CONTROL / (role + ".json")
        state = json.loads(path.read_text()) if path.exists() else {
            "role": role, "status": "READY", "review_pending": False,
            "owner_requests": [], "task": role + "00" if role == "C" else role + "01"
        }
        now = time.time()
        if action == "start":
            if state["status"] == "STOPPED":
                raise RuntimeError("STOPPED: an automatic prompt cannot resume this stream")
            if state["status"] != "RUNNING":
                state.pop("checkpoint_id", None)
                state["checkpoint_status"] = "RECONCILIATION_REQUIRED"
            state["status"] = "RUNNING"
            state.pop("waiting_since", None)
            state.setdefault("review_clock", now)
        elif action == "pause":
            state["status"] = "STOPPED"
            state["stopped_at"] = now_text()
            state["stop_reason"] = args.summary
        elif action == "resume":
            if not args.receipt:
                raise RuntimeError("A direct owner/controller instruction receipt is required")
            consumed = state.setdefault("consumed_resume_receipts", [])
            if args.receipt in consumed or args.receipt == state.get("resume_receipt"):
                raise RuntimeError("RESUME_RECEIPT_ALREADY_USED: a later STOP needs a new direct instruction")
            resumed_at = now_text()
            previous_checkpoint = {
                key: state.get(key) for key in (
                    "status", "task", "result", "next", "head", "updated_at",
                    "stopped_at", "stop_reason", "resume_receipt", "checkpoint_id",
                )
            }
            state.setdefault("resume_history", []).append({
                "at": resumed_at,
                "receipt": args.receipt,
                "previous_checkpoint": previous_checkpoint,
            })
            state.update(
                status="RUNNING", resume_receipt=args.receipt, resumed_at=resumed_at,
                checkpoint_status="RECONCILIATION_REQUIRED",
                task="RECONCILE_AFTER_RESUME",
                result="Resume accepted; prior progress is preserved in resume_history, not a fresh result.",
                next="Read current code, notices, inbox and peer handoffs; preserve prior progress and checkpoint the actual task. No additional resume is required.",
            )
            state.pop("stopped_at", None)
            state.pop("stop_reason", None)
            state.pop("checkpoint_id", None)
            consumed.append(args.receipt)
            state.setdefault("review_clock", now)
        elif action == "waiting":
            if state["status"] == "STOPPED":
                raise RuntimeError("STOPPED: waiting cannot clear an explicit pause")
            state["waiting_review"] = validate_waiting_receipt(
                role, args.receipt, git("rev-parse", "HEAD"), inputs_root=CONTROL
            )
            if git("status", "--porcelain"):
                raise RuntimeError("WAITING_DIRTY_WORKTREE: finish or explicitly preserve current work before waiting")
            state["status"] = "WAITING_INPUT"
            state.setdefault("waiting_since", now_text())
        elif action == "checkpoint":
            state["last_checkpoint_at"] = now_text()
            state.update(task=args.task or state.get("task"), result=args.summary, next=args.next,
                         checkpoint_status="CURRENT", checkpoint_id=secrets.token_hex(16))
        elif action == "request-review":
            state.update(review_pending=True, review_reason=args.summary)
            state.setdefault("review_requested_at", now_text())
        elif action == "request-owner":
            if args.summary not in state["owner_requests"]:
                state["owner_requests"].append(args.summary)
        elif action == "reviewed":
            if not args.receipt:
                raise RuntimeError("Controller review receipt is required; do not self-accept")
            state.update(review_pending=False, review_clock=now, review_receipt=args.receipt)
            state.pop("review_requested_at", None)
            state.pop("review_reason", None)
        elif action == "owner-done":
            if not args.receipt or args.summary not in state["owner_requests"]:
                raise RuntimeError("Exact pending request and owner completion receipt required")
            state["owner_requests"].remove(args.summary)
            state["owner_receipt"] = args.receipt
        if state["status"] in ("RUNNING", "WAITING_INPUT") and now - state.get("review_clock", now) >= PERIOD:
            state["review_pending"] = True
            state.setdefault("review_reason", "4 hours since start/last controller review")
            state.setdefault("review_requested_at", now_text())
        state["controller_notices"] = controller_notices(role)
        state["work_queue"] = status_work(CONTROL, role, git("status", "--porcelain"),
            state.get("waiting_review", {}).get("work_board") if state["status"] == "WAITING_INPUT" else None)
        state["heartbeat_at"] = now_text()
        state.update(updated_at=now_text(), head=git("rev-parse", "HEAD"))
        state["resources"] = resource_runner.snapshot(ROOT)
        write_json(path, state)
        return state


def controller_notices(role):
    return read_controller_notices(CONTROL / "controller-notices", role)


def require_running(role):
    path = CONTROL / (role + ".json")
    state = json.loads(path.read_text()) if path.exists() else {}
    if state.get("status") == "STOPPED":
        raise RuntimeError("STOPPED: no new work permitted")


def advance_queue_task(role, task, task_state, receipt, summary, publication_registration="", control_root=None):
    if not task:
        raise RuntimeError("DISK_LIFECYCLE_TASK_REQUIRED")
    target_control = Path(control_root).resolve() if control_root is not None else CONTROL
    registry = DiskLifecycleRegistry(target_control)
    if task_state in {"DONE", "IN_PROGRESS"}:
        try:
            with registry.locked():
                if task_state == "DONE":
                    registry.status_locked(role, task, complete=True)
                    registry.record_completion_state(role, task, "SEALING")
                    try:
                        kwargs = ({"publication_registration": publication_registration}
                                  if publication_registration else {})
                        result = advance_task(target_control, role, task, task_state, receipt, summary, **kwargs)
                    except Exception:
                        try:
                            board = load_board(target_control)
                            current = next((row for row in board["tasks"] if row["id"] == task and row.get("role") == role), None)
                            if current is not None and current.get("state") != "DONE":
                                registry.record_completion_state(role, task, "REOPENED")
                        except Exception:
                            pass
                        raise
                    registry.record_completion_state(role, task, "SEALED")
                    return result
                result = advance_task(target_control, role, task, task_state, receipt, summary)
                registry.reopen_if_completion_locked(role, task)
                return result
        except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"DISK_LIFECYCLE_INCOMPLETE:{exc}") from exc
    return advance_task(target_control, role, task, task_state, receipt, summary)


def default_scope_base():
    merge = subprocess.run(
        ["git", "rev-parse", "-q", "--verify", "MERGE_HEAD"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if merge.returncode == 1:
        return "HEAD"
    if merge.returncode != 0:
        raise RuntimeError("MERGE_STATE_UNVERIFIED: cannot determine scope")
    merge_head = merge.stdout.strip()
    accepted = subprocess.run(
        ["git", "merge-base", "--is-ancestor", merge_head, "origin/main"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if accepted.returncode == 0:
        # Importing accepted main: only the role's remaining local delta is new.
        return merge_head
    if accepted.returncode == 1:
        # Reviewing a new candidate: accepted first-parent changes are not new.
        return "HEAD"
    raise RuntimeError("MERGE_ANCESTRY_UNVERIFIED: refresh valid origin/main before retry")


def scope_guard(role, base=None):
    spec = policy()["roles"][role]
    changed = git("diff", "--name-only", base or default_scope_base()).splitlines()
    changed += git("ls-files", "--others", "--exclude-standard").splitlines()
    bad = sorted({p for p in changed if p and (
        not any(fnmatch.fnmatchcase(p, x) for x in spec["allow"])
        or any(fnmatch.fnmatchcase(p, x) for x in spec["deny"])
    )})
    if bad:
        raise RuntimeError("OWNERSHIP_VIOLATION: " + ", ".join(bad))
    if policy().get("taskBoundScope"):
        require_running(role)
        validate_task_scope(CONTROL, role, sorted(set(changed)))
    return sorted(set(changed))


def validate_test_container(info, cfg):
    expected_binding = [{"HostIp": "127.0.0.1", "HostPort": str(cfg["port"])}]
    if info.get("Config", {}).get("Labels", {}).get("octoport.coordination") != "2p1":
        raise RuntimeError("TEST_DB_LABEL_MISMATCH")
    if info.get("HostConfig", {}).get("PortBindings", {}).get("5432/tcp") != expected_binding:
        raise RuntimeError("TEST_DB_PORT_MAPPING_MISMATCH")
    if info.get("NetworkSettings", {}).get("Ports", {}).get("5432/tcp") != expected_binding:
        raise RuntimeError("TEST_DB_ACTIVE_PORT_MISMATCH")
    environment = dict(item.split("=", 1) for item in info.get("Config", {}).get("Env", []) if "=" in item)
    if environment.get("POSTGRES_USER") != "octoport_test" or environment.get("POSTGRES_DB") != cfg["database"] or environment.get("POSTGRES_PASSWORD") != cfg["password"]:
        raise RuntimeError("TEST_DB_CONTAINER_IDENTITY_MISMATCH")


def database(role):
    require_running(role)
    CONTROL.mkdir(mode=0o700, exist_ok=True)
    path = CONTROL / ("database-" + role + ".json")
    with (CONTROL / ("database-" + role + ".lock")).open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.exists():
            cfg = json.loads(path.read_text())
        else:
            cfg = {"container": "octoport-" + role.lower() + "-test-pg",
                   "port": {"A": 15541, "B": 15542, "C": 15543}[role],
                   "database": "octoport_" + role.lower() + "_test",
                   "password": secrets.token_urlsafe(24)}
            write_json(path, cfg)
        expected = {"container": "octoport-" + role.lower() + "-test-pg",
                    "port": {"A": 15541, "B": 15542, "C": 15543}[role],
                    "database": "octoport_" + role.lower() + "_test"}
        if any(cfg[k] != v for k, v in expected.items()):
            raise RuntimeError("TEST_DB_IDENTITY_MISMATCH")
        inspect = subprocess.run(["docker", "inspect", "--format",
            '{{index .Config.Labels "octoport.coordination"}}', cfg["container"]],
            text=True, capture_output=True)
        if inspect.returncode:
            result = subprocess.run(["docker", "run", "-d", "--name", cfg["container"],
                "--label", "octoport.coordination=2p1", "--memory", "256m", "--cpus", "1",
                "-p", "127.0.0.1:" + str(cfg["port"]) + ":5432",
                "-e", "POSTGRES_USER=octoport_test", "-e", "POSTGRES_PASSWORD=" + cfg["password"],
                "-e", "POSTGRES_DB=" + cfg["database"], "postgres:18.0"],
                text=True, capture_output=True)
            if result.returncode:
                raise RuntimeError("TEST_DB_CREATE_FAILED: inspect container/port; do not delete another service")
        elif inspect.stdout.strip() != "2p1":
            raise RuntimeError("TEST_DB_LABEL_MISMATCH")
        subprocess.run(["docker", "start", cfg["container"]], check=True, stdout=subprocess.DEVNULL)
        info = json.loads(subprocess.check_output(["docker", "inspect", cfg["container"]], text=True))[0]
        validate_test_container(info, cfg)
        for _ in range(20):
            result = subprocess.run(["docker", "exec", cfg["container"], "pg_isready",
                "-U", "octoport_test", "-d", cfg["database"]],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if result.returncode == 0:
                return cfg
            time.sleep(1)
        raise RuntimeError("TEST_DB_PREFLIGHT_FAILED")


def heavy(role, command, with_db, profile=None, memory_mib=None, timeout_seconds=3600):
    require_running(role)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise RuntimeError("Command required after --")
    CONTROL.mkdir(mode=0o700, exist_ok=True)
    # Respect an already running old wrapper during the migration.
    with (CONTROL / "heavy.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            print("RESOURCE_WAIT: LEGACY_HEAVY_RUNNING")
            return 75
        env = os.environ.copy()
        env["PATH"] = NODE + ":" + env.get("PATH", "")
        env.pop("DATABASE_URL", None)
        version = subprocess.check_output(["node", "--version"], env=env, text=True).strip()
        if version != "v24.20.0":
            raise RuntimeError("NODE_PREFLIGHT_FAILED: " + version)
        if not (ROOT / "node_modules").exists():
            raise RuntimeError("DEPENDENCIES_MISSING: install the frozen lockfile first")
        if with_db:
            cfg = database(role)
            env["DATABASE_URL"] = "postgresql://octoport_test:" + cfg["password"] + "@127.0.0.1:" + str(cfg["port"]) + "/" + cfg["database"]
        elif any(x in " ".join(command) for x in ("test:integration", "db:migrate")):
            raise RuntimeError("DATABASE_PREFLIGHT_REQUIRED: use --db, never a live DATABASE_URL")
        if profile is None:
            text = " ".join(command)
            profile = "e2e" if any(x in text for x in ("test:e2e", "playwright test")) else "integration" if "test:integration" in text else "general"
        return resource_runner.run(role, command, ROOT, env, CONTROL, profile,
                                   memory_mib, timeout_seconds, with_db)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("role", choices=["A", "B", "C"])
    parser.add_argument("action", choices=["status", "start", "pause", "resume", "waiting",
        "checkpoint", "request-review", "request-owner", "reviewed", "owner-done",
        "guard", "submit", "ready-main", "ensure-db", "heavy", "resources", "queue-task", "queue-add", "queue-claim", "queue-resolve-blocker"])
    parser.add_argument("--task-file")
    parser.add_argument("--compact", action="store_true")
    parser.add_argument("--task-state", choices=["IN_PROGRESS", "BLOCKED", "DONE"])
    parser.add_argument("--summary", default="")
    parser.add_argument("--task", default="")
    parser.add_argument("--successor", default="")
    parser.add_argument("--publication-registration", default="")
    parser.add_argument("--next", default="")
    parser.add_argument("--receipt", default="")
    parser.add_argument("--base")
    parser.add_argument("--db", action="store_true")
    parser.add_argument("--profile", choices=sorted(resource_runner.PROFILES))
    parser.add_argument("--memory-mib", type=int)
    parser.add_argument("--timeout-seconds", type=int, default=3600)
    # Explicit separator keeps command options out of the controller parser.
    argv = sys.argv[1:]
    split = argv.index("--") if "--" in argv else len(argv)
    args = parser.parse_args(argv[:split])
    command = argv[split + 1:]
    if args.action == "queue-task" and args.publication_registration:
        require_publication_queue_location(args.role, args.task, args.publication_registration)
    else:
        require_location(args.role)
    if args.action == "heavy":
        return heavy(args.role, command, args.db, args.profile, args.memory_mib, args.timeout_seconds)
    if args.action == "resources":
        print(json.dumps(resource_runner.snapshot(ROOT)))
        return 0
    if args.action == "queue-add":
        if not args.task_file:
            raise RuntimeError("WORK_QUEUE_TASK_FILE_REQUIRED")
        raw = Path(args.task_file).read_bytes()
        if len(raw) > 32768:
            raise RuntimeError("WORK_QUEUE_TASK_FILE_TOO_LARGE")
        try:
            task = json.loads(raw)
        except ValueError:
            raise RuntimeError("WORK_QUEUE_TASK_FILE_INVALID") from None
        print(json.dumps(add_task(CONTROL, args.role, task), ensure_ascii=False))
        return 0
    if args.action == "queue-claim":
        print(json.dumps(claim_task(CONTROL, args.role, args.task), ensure_ascii=False))
        return 0
    if args.action == "queue-resolve-blocker":
        print(json.dumps(resolve_blocker(CONTROL, args.role, args.task, args.successor, args.receipt), ensure_ascii=False))
        return 0
    if args.action == "queue-task":
        result = advance_queue_task(
            args.role, args.task, args.task_state, args.receipt, args.summary,
            args.publication_registration,
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    if args.action == "ensure-db":
        cfg = database(args.role)
        print(json.dumps({k: v for k, v in cfg.items() if k != "password"}))
    elif args.action == "guard":
        print(json.dumps({"allowed_files": scope_guard(args.role, args.base)}))
    elif args.action == "ready-main":
        if not args.summary or not args.base:
            raise RuntimeError("MAIN_READY_REQUIRES_BASE_AND_VALIDATION_EVIDENCE")
        require_running(args.role)
        if git("status", "--porcelain") or args.base != git("rev-parse", "origin/main"):
            raise RuntimeError("MAIN_READY_REQUIRES_CLEAN_HEAD_AND_FETCHED_BASE")
        scope_guard(args.role, args.base)
        ci = subprocess.run([sys.executable, str(ROOT / "tooling/coordination/ci_gate.py"), "--sha", git("rev-parse", "HEAD"), "--branch", git("branch", "--show-current")], text=True, capture_output=True, timeout=90)
        if ci.returncode:
            raise RuntimeError("CURRENT_CANDIDATE_CI_NOT_GREEN: " + ci.stdout.strip())
        ci_evidence = json.loads(ci.stdout)
        receipt = {"role": args.role, "ci": ci_evidence, "head": git("rev-parse", "HEAD"), "tree": git("rev-parse", "HEAD^{tree}"),
                   "base": args.base, "evidence": args.summary, "recorded_at": now_text()}
        require_running(args.role)
        write_json(CONTROL / ("main-ready-" + args.role + ".json"), receipt)
        print(json.dumps(receipt, ensure_ascii=False))
    elif args.action == "submit":
        require_running(args.role)
        if git("status", "--porcelain"):
            raise RuntimeError("CANDIDATE_REQUIRES_CLEAN_WORKTREE")
        if not args.summary:
            raise RuntimeError("CANDIDATE_REQUIRES_SUMMARY_AND_EVIDENCE")
        base = git("merge-base", "HEAD", "origin/main")
        files = scope_guard(args.role, base)
        head = git("rev-parse", "HEAD")
        receipt = {"role": args.role, "head": head, "base": base,
            "submitted_at": now_text(), "status": "READY_FOR_REVIEW",
            "summary": args.summary, "files": files}
        write_json(CONTROL / "inbox" / (args.role + "-" + head + ".json"), receipt)
        print(json.dumps(receipt, ensure_ascii=False))
    else:
        state = update_state(args.role, args.action, args)
        if args.compact:
            print(json.dumps(compact_state(state), ensure_ascii=False, indent=2))
            return 0
        print(json.dumps(state, ensure_ascii=False, indent=2))
        if state["review_pending"]:
            print("НУЖЕН КОНТРОЛЬ [" + args.role + "]: " + display_review_reason(state) + "; независимая работа разрешена")
        for notice in state.get("controller_notices", []):
            print("КОНТРОЛЛЕР [" + args.role + "]: " + json.dumps(notice, ensure_ascii=False))
        for item in state["owner_requests"]:
            print("НУЖНО ДЕЙСТВИЕ ВЛАДЕЛЬЦА [" + args.role + "]: " + item)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, subprocess.CalledProcessError) as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
