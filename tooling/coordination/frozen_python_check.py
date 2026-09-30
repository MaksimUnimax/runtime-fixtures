"""One-shot temporary Python checks with frozen source and checkpoint claims.

Not a sandbox or a product-acceptance oracle. Browser/server/heavy helpers MUST
run inside the existing resource supervisor. Claims survive failures: a retry
needs a new explicit task checkpoint, never an automatic replay of unknown work.
"""
import argparse
import ast
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys

FIELDS = ("status", "task", "head", "resume_receipt", "checkpoint_status", "checkpoint_id")


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_checkpoint(root, role):
    if role not in ("A", "B", "C"):
        raise ValueError("INVALID_ROLE")
    state = json.loads((root / (role + ".json")).read_text())
    selected = {key: state.get(key) for key in FIELDS}
    if not isinstance(selected["task"], str) or not selected["task"]:
        raise ValueError("TASK_ID_REQUIRED")
    checkpoint_id = selected["checkpoint_id"]
    if (not isinstance(checkpoint_id, str)
            or re.fullmatch(r"[0-9a-f]{32}", checkpoint_id) is None
            or selected["checkpoint_status"] != "CURRENT"):
        raise ValueError("CHECKPOINT_ID_REQUIRED: take a fresh ordinary checkpoint")
    return sha(json.dumps(selected, sort_keys=True).encode()), selected


def create(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as stream:
        stream.write(data)


def run_check(root, role, expected, source, bundle, timeout=60, arguments=()):
    if role not in ("A", "B", "C"):
        raise ValueError("INVALID_ROLE")
    root, source, bundle = Path(root), Path(source), Path(bundle).absolute()
    if timeout <= 0 or timeout > 3600:
        raise ValueError("INVALID_TIMEOUT")
    if not source.is_file() or source.is_symlink() or source.stat().st_size > 1024 * 1024:
        raise ValueError("REGULAR_BOUNDED_SOURCE_REQUIRED")
    code = source.read_bytes()
    if len(code) > 1024 * 1024:
        raise ValueError("SOURCE_TOO_LARGE")
    ast.parse(code.decode("utf-8"), filename=str(source))
    with (root / (role + ".lock")).open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        actual, checkpoint = read_checkpoint(root, role)
        if actual != expected or checkpoint["status"] != "RUNNING":
            raise ValueError("CHECKPOINT_CHANGED_OR_NOT_RUNNING")
        # Exclusive task claim also blocks a second caller using another bundle.
        claims = root / "controllers/execution-claims" / role
        claims.mkdir(parents=True, exist_ok=True, mode=0o700)
        claim = claims / (actual + ".json")
        if claim.exists():
            raise ValueError("TASK_ALREADY_CLAIMED_NO_REPLAY")
        bundle.mkdir(mode=0o700, parents=False, exist_ok=False)
        manifest = {"role": role, "checkpoint": actual, "state": checkpoint,
                    "source_sha256": sha(code), "original_source": str(source),
                    "bundle": str(bundle.resolve()), "arguments": list(arguments)}
        encoded = (json.dumps(manifest, sort_keys=True) + "\n").encode()
        create(claim, encoded)
        create(bundle / "manifest.json", encoded)
        create(bundle / "source.py", code)
    env = os.environ.copy()
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["OCTOPORT_EVIDENCE_DIR"] = str(bundle.resolve())
    launcher = "import sys; p=sys.argv[1]; sys.argv=sys.argv[1:]; exec(compile(sys.stdin.buffer.read(),p,'exec'),{'__name__':'__main__','__file__':p})"
    status, exit_code = "UNKNOWN_NOT_REPLAYABLE", None
    with (bundle / "stdout.log").open("xb") as out, (bundle / "stderr.log").open("xb") as err:
        try:
            child = subprocess.run(
                [sys.executable, "-B", "-c", launcher, str(bundle / "source.py"), *arguments],
                input=code, stdout=out, stderr=err, env=env, timeout=timeout, check=False,
            )
            exit_code = child.returncode
            status = "EXIT_ZERO" if exit_code == 0 else "EXIT_NONZERO"
        except subprocess.TimeoutExpired:
            status = "TIMEOUT_NOT_REPLAYABLE"
        except OSError:
            status = "START_FAILED_NOT_REPLAYABLE"
    files = {}
    for name in ("manifest.json", "source.py", "stdout.log", "stderr.log", "result.json"):
        path = bundle / name
        if not path.exists() and name == "result.json":
            continue
        if path.is_symlink() or not path.is_file():
            raise ValueError("INVALID_EVIDENCE_FILE")
        files[name] = sha(path.read_bytes())
        os.chmod(path, 0o400)
    if files["source.py"] != sha(code):
        raise ValueError("SNAPSHOT_CHANGED_DURING_EXECUTION")
    receipt = {"at": datetime.now(timezone.utc).isoformat(), "execution_status": status,
               "exit_code": exit_code, "executed_source_sha256": sha(code),
               "files": files, "product_acceptance": False,
               "limits": "Single Python entrypoint only; dependencies/package identity require separate evidence. Heavy process cleanup belongs to existing supervisor."}
    create(bundle / "execution.json", (json.dumps(receipt, indent=2) + "\n").encode())
    os.chmod(bundle / "execution.json", 0o400)
    return receipt


def verify(bundle):
    bundle = Path(bundle)
    receipt = json.loads((bundle / "execution.json").read_text())
    manifest = json.loads((bundle / "manifest.json").read_text())
    allowed = {"manifest.json", "source.py", "stdout.log", "stderr.log", "result.json"}
    names = set(receipt["files"])
    if not allowed - {"result.json"} <= names or not names <= allowed:
        raise ValueError("INVALID_EVIDENCE_MANIFEST")
    for name, digest in receipt["files"].items():
        path = bundle / name
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise ValueError("EVIDENCE_CHANGED: " + name)
    if not receipt["executed_source_sha256"] == receipt["files"]["source.py"] == manifest["source_sha256"]:
        raise ValueError("EXECUTED_SOURCE_MISMATCH")
    return {"status": "VERIFIED_BYTES", "execution_status": receipt["execution_status"],
            "product_acceptance": False, "executed_source_sha256": receipt["executed_source_sha256"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("snapshot", "run", "verify"))
    parser.add_argument("--root", type=Path, default=Path("/root/octoport-control"))
    parser.add_argument("--role", choices=("A", "B", "C"))
    parser.add_argument("--expected")
    parser.add_argument("--source", type=Path)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--timeout", type=int, default=60)
    args = parser.parse_args()
    if args.mode == "snapshot":
        digest, state = read_checkpoint(args.root, args.role)
        print(json.dumps({"checkpoint": digest, "state": state}))
    elif args.mode == "verify":
        print(json.dumps(verify(args.bundle)))
    else:
        result = run_check(args.root, args.role, args.expected, args.source, args.bundle, args.timeout)
        print(json.dumps({"execution_status": result["execution_status"], "product_acceptance": False,
                          "bundle": str(args.bundle), "source_sha256": result["executed_source_sha256"]}))
        return 0 if result["exit_code"] == 0 else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
