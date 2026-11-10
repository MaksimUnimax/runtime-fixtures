"""Run the installed official Harness against a synthetic local provider.

No model credentials, paid inference, marketplace calls or production changes.
OS namespace and UID firewall restrictions are exercised by the real executor.
"""
from pathlib import Path
from threading import Thread
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone
import fcntl
import json
import os
import pwd
import secrets
import shutil
import subprocess
import sys
import time

from qa_gateway import Gateway

ROOT = Path("/opt/alisa-dsh-lab/20261110-r1")
BASE = Path("/var/lib/alisa-dsh-lab")
EVIDENCE = Path("/root/alice-lab-evidence/dsh-lab-20261110")
FIREWALL = "alisa_dsh_lab"

def write_job(path, content, user):
    path.write_text(content)
    os.chown(path, user.pw_uid, user.pw_gid)
    os.chmod(path, 0o600)

def prepare_rootfs():
    path = BASE / "rootfs"
    path.mkdir(exist_ok=True)
    path.chmod(0o755)
    for name in ["usr", "opt", "opt/alisa-dsh-lab", "opt/alisa-dsh-lab/20261110-r1",
                 "workspace", "tmp", "proc", "dev", "etc"]:
        (path / name).mkdir(parents=True, exist_ok=True)
        (path / name).chmod(0o755)
    for name, target in [("bin", "usr/bin"), ("sbin", "usr/sbin"), ("lib", "usr/lib"), ("lib64", "usr/lib64")]:
        item = path / name
        if not item.exists() and not item.is_symlink():
            item.symlink_to(target)
    user = pwd.getpwnam("alisa-dsh-lab")
    (path / "etc/passwd").write_text(
        "root:x:0:0:root:/root:/usr/sbin/nologin\n"
        f"alisa-dsh-lab:x:{user.pw_uid}:{user.pw_gid}:Isolated DSH:/workspace/home:/usr/sbin/nologin\n")
    (path / "etc/group").write_text(f"root:x:0:\nalisa-dsh-lab:x:{user.pw_gid}:\n")
    (path / "etc/nsswitch.conf").write_text("passwd: files\ngroup: files\nhosts: files\n")
    for item in (path / "etc").iterdir():
        item.chmod(0o644)
    return path

def start_firewall(uid):
    existing = subprocess.run(["nft", "list", "table", "inet", FIREWALL], capture_output=True)
    if existing.returncode == 0:
        raise RuntimeError("Existing lab firewall must be inspected before another run")
    rules = f"""table inet {FIREWALL} {{
 chain output {{
  type filter hook output priority 0; policy accept;
  meta skuid {uid} ip daddr 127.0.0.1 tcp dport 33191 counter accept
  meta skuid {uid} counter reject
 }}
}}
"""
    subprocess.run(["nft", "-f", "-"], input=rules, text=True, check=True)

def unit_command(job, rootfs, unit):
    return [
        "systemd-run", "--unit=" + unit, "--wait", "--pipe",
        "--property=User=alisa-dsh-lab",
        "--property=RootDirectory=" + str(rootfs),
        "--property=WorkingDirectory=/workspace",
        "--property=BindReadOnlyPaths=/usr " + str(ROOT) + " " + str(job / "input.json") + ":/workspace/input.json",
        "--property=BindPaths=" + str(job) + ":/workspace",
        "--property=MountAPIVFS=yes",
        "--property=PrivateDevices=yes",
        "--property=ProtectSystem=strict",
        "--property=TemporaryFileSystem=/tmp:rw,nodev,nosuid,size=64M,mode=1777",
        "--property=ReadWritePaths=/workspace /tmp",
        "--property=NoNewPrivileges=yes",
        "--property=CapabilityBoundingSet=",
        "--property=RestrictSUIDSGID=yes",
        "--property=ProtectProc=invisible",
        "--property=RuntimeMaxSec=180",
        "--property=MemoryMax=1024M",
        "--property=CPUQuota=100%",
        "--property=MemorySwapMax=0",
        "--property=MemoryAccounting=yes",
        "--property=TasksMax=128",
        "--property=KillMode=control-group",
        "--property=TimeoutStopSec=5s",
        "--property=SendSIGKILL=yes",
        "--property=OOMPolicy=stop",
        "/usr/bin/env", "-i", "PATH=/usr/local/bin:/usr/bin:/bin",
        "HOME=/workspace/home", "DSH_HOME=/workspace/home", "LANG=C.UTF-8",
        "PYTHONDONTWRITEBYTECODE=1",
        str(ROOT / ".venv/bin/python"), str(ROOT / "worker.py"),
    ]

class Canary(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"synthetic canary")

def main():
    os.umask(0o077)
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    lock = open("/run/lock/alisa-dsh-lab.lock", "a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    user = pwd.getpwnam("alisa-dsh-lab")
    stamp = datetime.now(timezone.utc).strftime("%H%M%S")
    name = "smoke-" + stamp
    job = BASE / "jobs" / name
    job.mkdir(parents=True, exist_ok=False)
    os.chown(job, user.pw_uid, user.pw_gid)
    (BASE / "foreign-canary.txt").write_text("Synthetic foreign-job canary")
    rootfs = prepare_rootfs()
    token = secrets.token_hex(32)
    write_job(job / "local-transport-token", token, user)
    write_job(job / "input.json", json.dumps({"rows": [
        {"value": value, "padding": "X" * 70000} for value in [3, 7, 11]]}), user)
    write_job(job / "request.json", json.dumps({
        "session_id": name, "system_prompt": "You are a calculation assistant.",
        "prompt": "Execute the requested calculation on /workspace/input.json and report the result."}), user)
    gateway = Gateway(token, EVIDENCE / (name + "-gateway.json"), maximum=2)
    canary = ThreadingHTTPServer(("127.0.0.1", 33192), Canary)
    for server in [gateway, canary]:
        Thread(target=server.serve_forever, daemon=True).start()
    firewall_started = False
    try:
        start_firewall(user.pw_uid)
        firewall_started = True
        unit = "alisa-dsh-" + name
        result = subprocess.run(unit_command(job, rootfs, unit), capture_output=True, text=True, timeout=200)
        (EVIDENCE / (name + "-worker.log")).write_text(result.stdout + result.stderr)
        stats = subprocess.run(["systemctl", "show", unit, "-p", "Result", "-p", "ExecMainStatus",
            "-p", "MemoryPeak", "-p", "CPUUsageNSec"], capture_output=True, text=True).stdout
        rules = subprocess.run(["nft", "list", "table", "inet", FIREWALL], capture_output=True, text=True).stdout
        payload = {"mode": "OFFLINE_SYNTHETIC", "paid_calls": 0, "unit": unit,
            "exit_code": result.returncode, "stats": stats, "firewall": rules,
            "gateway_attempts": gateway.attempts, "job": str(job)}
        if (job / "result.private.json").exists():
            payload["worker_result"] = json.loads((job / "result.private.json").read_text())
        worker = payload.get("worker_result", {})
        payload["passed"] = (
            result.returncode == 0
            and worker.get("finish_reason") in (None, "completed", "stop")
            and bool(worker.get("final_response", "").strip())
            and len(gateway.attempts) == 2
            and all(x.get("status") == "SYNTHETIC_RESPONSE" and x.get("http_status") == 200 for x in gateway.attempts)
            and "synthetic_tool_continuation" in gateway.attempts[-1]
        )
        target = EVIDENCE / (name + "-result.json")
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"result": str(target), "exit_code": result.returncode,
                          "synthetic_calls": len(gateway.attempts), "paid_calls": 0}))
        if not payload["passed"]:
            print((result.stdout + result.stderr)[-6000:])
            return 1
        return 0
    finally:
        for server in [gateway, canary]:
            server.shutdown()
            server.server_close()
        if firewall_started:
            subprocess.run(["nft", "delete", "table", "inet", FIREWALL], check=True)
        # Native runtime startup extracts ~83 MiB into each isolated home.
        # Evidence has already been copied out; keep no completed smoke homes.
        if "unit" in locals():
            state = subprocess.run(["systemctl", "show", unit, "-p", "ActiveState", "--value"],
                                   capture_output=True, text=True).stdout.strip()
            if state in {"active", "activating", "deactivating", "reloading"}:
                raise RuntimeError("Do not remove a running worker's job directory")
        shutil.rmtree(job)

if __name__ == "__main__":
    sys.exit(main())
