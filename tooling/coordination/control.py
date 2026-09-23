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
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
CONTROL = Path("/root/octoport-control")
NODE = "/root/.nvm/versions/node/v24.20.0/bin"
PERIOD = 4 * 3600


def now_text():
    return datetime.now(timezone.utc).isoformat()


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def policy():
    return json.loads((ROOT / "docs/development/coordination/OWNERSHIP.json").read_text())


def require_location(role):
    spec = policy()["roles"][role]
    if str(ROOT) != spec["path"] or git("branch", "--show-current") != spec["branch"]:
        raise RuntimeError("ROLE_LOCATION_MISMATCH: use the assigned worktree and branch")


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
            state["status"] = "RUNNING"
            state.setdefault("review_clock", now)
        elif action == "pause":
            state["status"] = "STOPPED"
        elif action == "resume":
            if not args.receipt:
                raise RuntimeError("A direct owner/controller instruction receipt is required")
            state["status"] = "RUNNING"
            state["resume_receipt"] = args.receipt
            state.setdefault("review_clock", now)
        elif action == "waiting":
            if state["status"] == "STOPPED":
                raise RuntimeError("STOPPED: waiting cannot clear an explicit pause")
            state["status"] = "WAITING_INPUT"
        elif action == "checkpoint":
            state.update(task=args.task or state.get("task"), result=args.summary, next=args.next)
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
        state.update(updated_at=now_text(), head=git("rev-parse", "HEAD"))
        state["resources"] = resource_runner.snapshot(ROOT)
        write_json(path, state)
        return state


def controller_notices(role):
    notices = []
    for path in sorted((CONTROL / "controller-notices").glob(role + "-*.json")):
        item = json.loads(path.read_text())
        if item.get("role") == role and item.get("status") != "CLOSED":
            notices.append(item)
    return notices


def require_running(role):
    path = CONTROL / (role + ".json")
    state = json.loads(path.read_text()) if path.exists() else {}
    if state.get("status") == "STOPPED":
        raise RuntimeError("STOPPED: no new work permitted")


def scope_guard(role, base=None):
    spec = policy()["roles"][role]
    changed = git("diff", "--name-only", base or "HEAD").splitlines()
    changed += git("ls-files", "--others", "--exclude-standard").splitlines()
    bad = sorted({p for p in changed if p and (
        not any(fnmatch.fnmatchcase(p, x) for x in spec["allow"])
        or any(fnmatch.fnmatchcase(p, x) for x in spec["deny"])
    )})
    if bad:
        raise RuntimeError("OWNERSHIP_VIOLATION: " + ", ".join(bad))
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
        "guard", "submit", "ready-main", "ensure-db", "heavy", "resources"])
    parser.add_argument("--summary", default="")
    parser.add_argument("--task", default="")
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
    require_location(args.role)
    if args.action == "heavy":
        return heavy(args.role, command, args.db, args.profile, args.memory_mib, args.timeout_seconds)
    if args.action == "resources":
        print(json.dumps(resource_runner.snapshot(ROOT)))
        return 0
    if args.action == "ensure-db":
        cfg = database(args.role)
        print(json.dumps({k: v for k, v in cfg.items() if k != "password"}))
    elif args.action == "guard":
        print(json.dumps({"allowed_files": scope_guard(args.role, args.base)}))
    elif args.action == "ready-main":
        if args.role != "C" or not args.summary or not args.base:
            raise RuntimeError("MAIN_READY_REQUIRES_C_BASE_AND_VALIDATION_EVIDENCE")
        require_running("C")
        if git("status", "--porcelain") or args.base != git("rev-parse", "origin/main"):
            raise RuntimeError("MAIN_READY_REQUIRES_CLEAN_HEAD_AND_FETCHED_BASE")
        ci = subprocess.run([sys.executable, str(ROOT / "tooling/coordination/ci_gate.py"), "--sha", git("rev-parse", "HEAD"), "--branch", git("branch", "--show-current")], text=True, capture_output=True, timeout=90)
        if ci.returncode:
            raise RuntimeError("CURRENT_CANDIDATE_CI_NOT_GREEN: " + ci.stdout.strip())
        ci_evidence = json.loads(ci.stdout)
        receipt = {"ci": ci_evidence, "head": git("rev-parse", "HEAD"), "tree": git("rev-parse", "HEAD^{tree}"),
                   "base": args.base, "evidence": args.summary, "recorded_at": now_text()}
        write_json(CONTROL / "main-ready.json", receipt)
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
        print(json.dumps(state, ensure_ascii=False, indent=2))
        if state["review_pending"]:
            print("НУЖЕН КОНТРОЛЬ [" + args.role + "]: " + state.get("review_reason", "review pending") + "; независимая работа разрешена")
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
