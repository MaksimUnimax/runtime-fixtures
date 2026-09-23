#!/usr/bin/env python3
"""Capacity admission and lifecycle for owned test jobs; never a host cleanup tool."""
import fcntl
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import uuid

MIB = 1024 * 1024
RESERVE_MIB = 1024
PROFILES = {"focused": 512, "browser": 1536, "integration": 2048,
            "build": 3072, "e2e": 4096, "general": 2048}
CGROUP = Path("/sys/fs/cgroup")
UNIT_PATTERN = re.compile(r"octoport-test-[abc]-[0-9a-f]{32}\.service")


def atomic_json(path, value):
    temp = path.with_suffix(".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write("\n")
    os.replace(temp, path)


def process_identity(pid):
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return None if fields[0] == "Z" else fields[19]
    except (FileNotFoundError, ProcessLookupError):
        return None


def snapshot(directory):
    mem = {k: int(v.strip().split()[0]) * 1024 for k, v in
           (line.split(":", 1) for line in Path("/proc/meminfo").read_text().splitlines())}
    disk = os.statvfs(directory)
    pressure = Path("/proc/pressure/memory")
    full = 0.0
    if pressure.exists():
        for line in pressure.read_text().splitlines():
            if line.startswith("full "):
                full = float(dict(item.split("=") for item in line.split()[1:])["avg10"])
    return {"at": time.time(), "total_mib": mem["MemTotal"] // MIB,
            "available_mib": mem["MemAvailable"] // MIB,
            "swap_used_mib": (mem["SwapTotal"] - mem["SwapFree"]) // MIB,
            "memory_full_avg10": full,
            "disk_free_mib": disk.f_bavail * disk.f_frsize // MIB,
            "inodes_free": disk.f_favail, "load": list(os.getloadavg())}


def systemctl(*args):
    return subprocess.run(["systemctl", *args], capture_output=True, text=True, timeout=20)


def unit_properties(unit):
    if not UNIT_PATTERN.fullmatch(unit):
        raise RuntimeError("INVALID_OWNED_UNIT")
    result = systemctl("show", unit, "--property=LoadState,ActiveState,ControlGroup,Result,ExecMainStatus,MemoryCurrent")
    if result.returncode:
        raise RuntimeError("SYSTEMD_STATE_UNAVAILABLE")
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def group_path(properties):
    value = properties.get("ControlGroup", "")
    if not value:
        return None
    path = CGROUP / value.lstrip("/")
    if ".." in path.parts or not path.is_relative_to(CGROUP):
        raise RuntimeError("INVALID_CGROUP_PATH")
    return path


def _group_metrics(properties):
    path = group_path(properties)
    if not path or not path.exists():
        return {"current_mib": 0, "committed_mib": 0, "peak_bytes": 0, "populated": False, "oom_kill": 0}
    def number(name):
        p = path / name
        return int(p.read_text().strip()) if p.exists() else 0
    events = dict(line.split() for line in (path / "cgroup.events").read_text().splitlines())
    memory_events = dict(line.split() for line in (path / "memory.events").read_text().splitlines())
    memory_stat = dict(line.split() for line in (path / "memory.stat").read_text().splitlines())
    return {"current_mib": math.ceil(number("memory.current") / MIB),
            # MemAvailable includes reclaimable cache: never count cache as funded growth.
            "committed_mib": int(memory_stat.get("anon", 0)) // MIB,
            "peak_bytes": number("memory.peak"),
            "populated": events.get("populated") == "1",
            "oom_kill": int(memory_events.get("oom_kill", 0))}


def group_metrics(properties):
    try:
        return _group_metrics(properties)
    except FileNotFoundError:
        path = group_path(properties)
        if path and path.exists():
            raise
        return {"current_mib": 0, "committed_mib": 0, "peak_bytes": 0,
                "populated": False, "oom_kill": 0}


def active_jobs(jobs):
    """Retire only records whose exact unit is empty; never signal an old job."""
    active = []
    for path in sorted(jobs.glob("*/receipt.json")):
        item = json.loads(path.read_text())
        if item.get("state") == "FINISHED":
            continue
        props = unit_properties(item["unit"])
        metrics = group_metrics(props)
        owner_alive = process_identity(item["owner_pid"]) == item["owner_start"]
        starting = owner_alive and time.time() - item["created_at"] < 30
        busy = props.get("ActiveState") in ("active", "activating", "deactivating", "reloading")
        if busy or metrics["populated"] or starting:
            active.append(dict(item, current_mib=metrics["committed_mib"]))
        else:
            item.update(state="FINISHED", result="OWNER_LOST_OR_RECONCILED",
                        finished_at=time.time(), cleanup_verified=True)
            atomic_json(path, item)
            # Payload is this runner's private transport, not user evidence.
            (path.parent / "payload.json").unlink(missing_ok=True)
    return active


def admission(resources, active, requested, role, with_db=False):
    if with_db and any(job["role"] == role and job.get("with_db") for job in active):
        return "ROLE_TEST_DATABASE_BUSY"
    if resources["disk_free_mib"] < 512 or resources["inodes_free"] < 1000:
        return "DISK_CAPACITY_REVIEW_REQUIRED"
    if resources["memory_full_avg10"] >= 5:
        return "MEMORY_PRESSURE_RETRY_LATER"
    outstanding = sum(max(0, job["memory_mib"] - job["current_mib"]) for job in active)
    if resources["available_mib"] - outstanding - RESERVE_MIB < requested:
        return "MEMORY_CAPACITY_REVIEW_REQUIRED"
    return None


def effective_budget(jobs, profile, requested):
    """Learn upwards from measured near-cap peaks; never silently lower a budget."""
    floor = PROFILES[profile]
    observed = []
    for path in jobs.glob("*/receipt.json"):
        item = json.loads(path.read_text())
        if item.get("profile") == profile and item.get("state") == "FINISHED":
            observed.append(item)
    # A recent comparable OOM is evidence that the previous budget was insufficient.
    for item in sorted(observed, key=lambda x: x.get("created_at", 0))[-20:]:
        peak = item.get("peak_bytes", 0) / MIB
        if peak:
            floor = max(floor, math.ceil(peak * 1.15))
        if item.get("oom_kill", 0) or item.get("systemd_result") == "oom-kill":
            floor = max(floor, math.ceil(item["memory_mib"] * 1.25))
    # Explicit estimates can be smaller for a genuinely narrower task; recorded for review.
    return requested if requested is not None else floor


def run(role, command, cwd, env, control, profile="general", memory_mib=None,
        timeout_seconds=3600, with_db=False):
    if role not in ("A", "B", "C") or profile not in PROFILES or not command:
        raise RuntimeError("INVALID_RESOURCE_JOB")
    if memory_mib is not None and (not isinstance(memory_mib, int) or memory_mib < 64):
        raise RuntimeError("MEMORY_BUDGET_MINIMUM_64_MIB")
    if not 1 <= timeout_seconds <= 14400:
        raise RuntimeError("RUNTIME_BOUND_REQUIRED_1_TO_14400_SECONDS")
    if not (CGROUP / "cgroup.controllers").exists() or not Path("/run/systemd/system").is_dir():
        raise RuntimeError("CGROUP_V2_SYSTEMD_REQUIRED: no unsupervised fallback")
    control = Path(control)
    control.mkdir(mode=0o700, parents=True, exist_ok=True)
    jobs = control / "resource-jobs"
    jobs.mkdir(mode=0o700, exist_ok=True)
    # Shared compatibility lock: new jobs may overlap; an old exclusive runner may not.
    with (control / "heavy.lock").open("a+") as legacy:
        try:
            fcntl.flock(legacy, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            print("RESOURCE_WAIT: LEGACY_HEAVY_RUNNING", flush=True)
            return 75
        with (control / "resource-admission.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            active = active_jobs(jobs)
            resources = snapshot(cwd)
            budget = effective_budget(jobs, profile, memory_mib)
            reason = admission(resources, active, budget, role, with_db)
            if reason:
                wait = {"status": "RESOURCE_WAIT", "reason": reason,
                      "requested_mib": budget, "reserve_mib": RESERVE_MIB,
                      "resources": resources, "active_jobs": len(active),
                      "additional_mib": max(0, budget + RESERVE_MIB + sum(
                          max(0, job["memory_mib"] - job["current_mib"]) for job in active)
                          - resources["available_mib"])}
                atomic_json(control / ("resource-wait-" + role + ".json"), wait)
                print(json.dumps(wait), flush=True)
                return 75
            job_id = uuid.uuid4().hex
            directory = jobs / job_id
            directory.mkdir(mode=0o700)
            unit = f"octoport-test-{role.lower()}-{job_id}.service"
            receipt = {"id": job_id, "role": role, "unit": unit,
                       "owner_pid": os.getpid(), "owner_start": process_identity(os.getpid()),
                       "created_at": time.time(), "state": "STARTING", "profile": profile,
                       "memory_mib": budget, "explicit_memory": memory_mib is not None,
                       "timeout_seconds": timeout_seconds, "with_db": with_db,
                       "before": resources, "peak_bytes": 0, "oom_kill": 0}
            atomic_json(directory / "receipt.json", receipt)
            atomic_json(directory / "payload.json", {"command": command, "cwd": str(cwd),
                        "env": env, "owner_pid": receipt["owner_pid"],
                        "owner_start": receipt["owner_start"]})
            # Never place argv/environment secrets in unit properties or the receipt.
            invocation = ["systemd-run", "--quiet", "--wait", "--pipe", "--service-type=exec",
                          "--unit=" + unit, "--property=KillMode=control-group",
                          "--property=TimeoutStopSec=5s", "--property=SendSIGKILL=yes",
                          "--property=OOMPolicy=stop", "--property=MemoryAccounting=yes",
                          "--property=MemoryMax=" + str(budget * MIB),
                          "--property=MemorySwapMax=0", "--property=TasksMax=1024",
                          "--property=RuntimeMaxSec=" + str(timeout_seconds),
                          sys.executable, str(Path(__file__).resolve()), "--worker", str(directory)]
            try:
                child = subprocess.Popen(invocation)
            except BaseException:
                (directory / "payload.json").unlink(missing_ok=True)
                receipt.update(state="FINISHED", result="LAUNCH_FAILED", cleanup_verified=True)
                atomic_json(directory / "receipt.json", receipt)
                raise
            atomic_json(control / ("resource-wait-" + role + ".json"),
                        {"status": "ADMITTED", "at": time.time(), "unit": unit})
        print(json.dumps({"status": "RESOURCE_JOB_STARTED", "unit": unit,
                          "memory_mib": budget, "profile": profile}), flush=True)
        previous = {}
        cancelled = []
        def stop(signum, _frame):
            cancelled.append(signum)
            systemctl("stop", "--no-block", unit)
        for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
            previous[signum] = signal.signal(signum, stop)
        props = {}
        metrics = {"populated": True}
        try:
            while child.poll() is None:
                props = unit_properties(unit)
                metrics = group_metrics(props)
                receipt["peak_bytes"] = max(receipt["peak_bytes"], metrics["peak_bytes"], metrics["current_mib"] * MIB)
                receipt["oom_kill"] = max(receipt["oom_kill"], metrics["oom_kill"])
                time.sleep(0.2)
            code = child.returncode
        finally:
            # Exact new unit only: also catches daemonized/setsid descendants.
            systemctl("stop", unit)
            props = unit_properties(unit)
            metrics = group_metrics(props)
            receipt["cleanup_verified"] = not metrics["populated"]
            receipt["systemd_result"] = props.get("Result", "unknown")
            receipt["systemd_exit"] = props.get("ExecMainStatus", "unknown")
            receipt["finished_at"] = time.time()
            receipt["state"] = "FINISHED" if receipt["cleanup_verified"] else "CLEANUP_FAILED"
            receipt["after"] = snapshot(cwd)
            result_file = directory / "worker-result.json"
            if result_file.exists():
                receipt.update(json.loads(result_file.read_text()))
            atomic_json(directory / "receipt.json", receipt)
            if receipt["cleanup_verified"]:
                (directory / "payload.json").unlink(missing_ok=True)
            for signum, handler in previous.items():
                signal.signal(signum, handler)
        if not receipt["cleanup_verified"]:
            raise RuntimeError("OWN_JOB_CLEANUP_FAILED: record retained; no broad cleanup")
        if receipt["oom_kill"] or receipt["systemd_result"] == "oom-kill":
            code = 137
            receipt["classification"] = "ENVIRONMENT_RESOURCE_LIMIT"
        elif cancelled:
            code = 128 + cancelled[0]
            receipt["classification"] = "CANCELLED"
        elif receipt.get("worker_reason") == "OWNER_LOST":
            code = 125
            receipt["classification"] = "OWNER_LOST"
        elif receipt["systemd_result"] == "timeout":
            receipt["classification"] = "ENVIRONMENT_TIMEOUT"
        else:
            receipt["classification"] = "COMMAND_RESULT"
        receipt["exit_code"] = code
        atomic_json(directory / "receipt.json", receipt)
        systemctl("reset-failed", unit)
        print(json.dumps({"status": "RESOURCE_JOB_FINISHED", "unit": unit,
                          "exit_code": code, "peak_mib": math.ceil(receipt["peak_bytes"] / MIB),
                          "classification": receipt["classification"], "cleanup_verified": True}), flush=True)
        return code


def worker(directory):
    """Keep ownership alive even if the controller is killed; systemd owns teardown."""
    directory = Path(directory)
    payload = json.loads((directory / "payload.json").read_text())
    (directory / "payload.json").unlink()
    child = None
    reason = "COMMAND_EXIT"
    code = 125
    try:
        if process_identity(payload["owner_pid"]) != payload["owner_start"]:
            reason = "OWNER_LOST"
            return code
        child = subprocess.Popen(payload["command"], cwd=payload["cwd"], env=payload["env"])
        while child.poll() is None:
            if process_identity(payload["owner_pid"]) != payload["owner_start"]:
                reason = "OWNER_LOST"
                return code
            time.sleep(0.2)
        code = child.returncode
        return code if code >= 0 else 128 - code
    finally:
        atomic_json(directory / "worker-result.json", {"command_exit_code": code,
                    "worker_reason": reason})
        # Exiting the unit's main process makes systemd stop the ENTIRE cgroup.


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--worker":
        sys.exit(worker(sys.argv[2]))
    raise SystemExit("Use control.py ROLE heavy or ROLE resources")
