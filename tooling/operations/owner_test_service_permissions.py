#!/usr/bin/env python3
"""Read-only owner-test service permission rehearsal with disposable child writes."""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

VERIFY = Path(__file__).with_name("verify_ops_release.py")
SETPRIV = Path("/usr/bin/setpriv")
TEST_UID = 65534
TEST_GID = 65534
RELEASE_RE = re.compile(r"^(/opt/octoport/ops-releases/([0-9a-f]{40}))(?:/.*)?$")
RELEASE_TOKEN_RE = re.compile(
    r"/opt/octoport/ops-releases/[0-9a-f]{40}(?:/[^\s;{}]+)?"
)

UNIT_CONFIG = {
    "api": {
        "unit": "seller-agents-owner-test-api.service",
        "env": Path("/etc/seller-agents-owner-test/api.env"),
        "envLabel": "API_ENV",
    },
    "worker": {
        "unit": "seller-agents-owner-test-worker.service",
        "env": Path("/etc/seller-agents-owner-test/api.env"),
        "envLabel": "API_ENV",
    },
    "portal": {
        "unit": "seller-agents-owner-test-portal.service",
        "env": Path("/etc/seller-agents-owner-test/portal.env"),
        "envLabel": "PORTAL_ENV",
    },
}

class ProbeError(RuntimeError):
    pass

def fail(code: str) -> None:
    raise ProbeError(code)

def effective_bits(mode: int, owner_uid: int, owner_gid: int, uid: int, gid: int) -> int:
    if owner_uid == uid:
        return (mode >> 6) & 0o7
    if owner_gid == gid:
        return (mode >> 3) & 0o7
    return mode & 0o7

def parse_working_directory(value: str) -> tuple[Path, str, Path]:
    match = RELEASE_RE.fullmatch(value.strip())
    if not match:
        fail("WORKING_DIRECTORY_NOT_PINNED_RELEASE")
    return Path(match.group(1)), match.group(2), Path(value.strip())

def parse_environment_files(value: str) -> list[Path]:
    paths = [Path(item) for item in re.findall(r"/[^\s;{}()]+\.env", value)]
    if not paths:
        fail("ENVIRONMENT_FILE_PATH_MISSING")
    return paths

def parse_execstart(value: str, expected_sha: str) -> tuple[Path, list[Path]]:
    binary_match = re.search(r"(?:^|[;{]\s*)path=(/[^\s;{}]+)", value)
    if not binary_match:
        fail("EXECSTART_BINARY_MISSING")
    binary = Path(binary_match.group(1))
    refs: list[Path] = []
    for raw in RELEASE_TOKEN_RE.findall(value):
        path = Path(raw)
        if path not in refs:
            refs.append(path)
    if not refs or binary not in refs:
        fail("EXECSTART_RELEASE_PATHS_MISSING")
    for path in refs:
        match = RELEASE_RE.fullmatch(str(path))
        if not match or match.group(2) != expected_sha:
            fail("EXECSTART_RELEASE_SHA_MISMATCH")
    return binary, refs

def validate_protected_metadata(
    *, mode: int, owner_uid: int, owner_gid: int, uid: int, gid: int, regular: bool
) -> None:
    if not regular:
        fail("PROTECTED_CONFIG_NOT_REGULAR")
    if owner_uid != 0 or owner_gid != 0:
        fail("PROTECTED_CONFIG_NOT_ROOT_OWNED")
    if mode != 0o600:
        fail("PROTECTED_CONFIG_MODE_INVALID")
    if effective_bits(mode, owner_uid, owner_gid, uid, gid) != 0:
        fail("PROTECTED_CONFIG_VISIBLE_TO_SERVICE")

def validate_protected_file(path: Path, uid: int, gid: int) -> dict[str, object]:
    metadata = path.lstat()
    validate_protected_metadata(
        mode=stat.S_IMODE(metadata.st_mode),
        owner_uid=metadata.st_uid,
        owner_gid=metadata.st_gid,
        uid=uid,
        gid=gid,
        regular=stat.S_ISREG(metadata.st_mode),
    )
    return {"rootOwned": True, "mode": "0600", "serviceAccessBits": 0}

def _inside(root: Path, target: Path) -> bool:
    return target == root or root in target.parents

def scan_release_tree(root: Path, uid: int, gid: int) -> dict[str, int]:
    canonical = root.resolve(strict=True)
    counts = {"files": 0, "directories": 0, "symlinks": 0}
    stack = [canonical]
    while stack:
        path = stack.pop()
        metadata = path.lstat()
        mode = stat.S_IMODE(metadata.st_mode)
        if stat.S_ISLNK(metadata.st_mode):
            target = path.resolve(strict=True)
            if not _inside(canonical, target):
                fail("RELEASE_SYMLINK_ESCAPE")
            counts["symlinks"] += 1
            continue
        bits = effective_bits(mode, metadata.st_uid, metadata.st_gid, uid, gid)
        if bits & 0o2:
            fail("RELEASE_WRITABLE_BY_SERVICE")
        if stat.S_ISDIR(metadata.st_mode):
            if (bits & 0o5) != 0o5:
                fail("RELEASE_DIRECTORY_NOT_READABLE")
            counts["directories"] += 1
            with os.scandir(path) as entries:
                stack.extend(Path(entry.path) for entry in entries)
        elif stat.S_ISREG(metadata.st_mode):
            if (bits & 0o4) == 0:
                fail("RELEASE_FILE_NOT_READABLE")
            counts["files"] += 1
        else:
            fail("RELEASE_ENTRY_TYPE_INVALID")
    return counts

def run_command(args: list[str]) -> str:
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode != 0:
        fail("READ_ONLY_COMMAND_FAILED")
    return result.stdout.strip()

def unit_prop(unit: str, prop: str) -> str:
    return run_command(["systemctl", "show", "-p", prop, "--value", unit])

def verify_release(root: Path, expected_sha: str) -> None:
    result = subprocess.run(
        ["python3", str(VERIFY), str(root)], text=True, capture_output=True
    )
    if result.returncode != 0:
        fail("RELEASE_VERIFY_FAILED")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError:
        fail("RELEASE_VERIFY_OUTPUT_INVALID")
    if value.get("status") != "PASS" or value.get("sourceSha") != expected_sha:
        fail("RELEASE_VERIFY_IDENTITY_MISMATCH")

def snapshot_units() -> tuple[dict[str, dict[str, object]], dict[str, dict[str, str]]]:
    internal: dict[str, dict[str, object]] = {}
    public: dict[str, dict[str, str]] = {}
    for role, config in UNIT_CONFIG.items():
        unit = str(config["unit"])
        active = unit_prop(unit, "ActiveState")
        sub = unit_prop(unit, "SubState")
        restarts = unit_prop(unit, "NRestarts")
        user = unit_prop(unit, "User")
        group = unit_prop(unit, "Group")
        root, release_sha, working = parse_working_directory(
            unit_prop(unit, "WorkingDirectory")
        )
        env_paths = parse_environment_files(unit_prop(unit, "EnvironmentFiles"))
        expected_env = Path(config["env"])
        if env_paths != [expected_env]:
            fail("ENVIRONMENT_FILE_SCOPE_MISMATCH")
        binary, exec_paths = parse_execstart(unit_prop(unit, "ExecStart"), release_sha)
        if active != "active" or sub != "running":
            fail("OWNER_TEST_UNIT_NOT_RUNNING")
        identity = (
            "ROOT_OR_UNSET" if user in {"", "root"} and group in {"", "root"}
            else "EXPLICIT_NON_ROOT"
        )
        internal[role] = {
            "unit": unit,
            "active": active,
            "sub": sub,
            "restarts": restarts,
            "root": root,
            "releaseSha": release_sha,
            "working": working,
            "env": expected_env,
            "binary": binary,
            "execPaths": exec_paths,
        }
        public[role] = {
            "currentIdentity": identity,
            "releaseSha": release_sha,
            "environmentLabel": str(config["envLabel"]),
        }
    return internal, public

CHILD_CODE = r"""
import json, os, pathlib, sys
payload=json.loads(sys.argv[1])
result={
 "nonRoot": os.geteuid()!=0,
 "supplementaryGroupsCleared": len(os.getgroups())==0,
 "workingDirectoriesAccessible": True,
 "execPathsAccessible": True,
 "protectedConfigReadDenied": True,
 "protectedConfigWriteOpenDenied": True,
 "disposableWritesPassed": True,
}
for unit in payload["units"]:
    try:
        os.chdir(unit["working"])
    except Exception:
        result["workingDirectoriesAccessible"]=False
    for path in unit["execPaths"]:
        p=pathlib.Path(path)
        needed=os.R_OK | (os.X_OK if path==unit["binary"] else 0)
        if not os.access(p, needed):
            result["execPathsAccessible"]=False
for path in payload["protected"]:
    try:
        with open(path,"rb") as stream:
            stream.read(0)
        result["protectedConfigReadDenied"]=False
    except PermissionError:
        pass
    except Exception:
        result["protectedConfigReadDenied"]=False
    try:
        fd=os.open(path, os.O_WRONLY)
        os.close(fd)
        result["protectedConfigWriteOpenDenied"]=False
    except PermissionError:
        pass
    except Exception:
        result["protectedConfigWriteOpenDenied"]=False
for path in payload["writable"]:
    try:
        probe=pathlib.Path(path)/"probe"
        probe.write_text("ok")
        if probe.read_text()!="ok":
            result["disposableWritesPassed"]=False
        probe.unlink()
    except Exception:
        result["disposableWritesPassed"]=False
print(json.dumps(result, separators=(",",":")))
"""

def run_child_probe(
    units: dict[str, dict[str, object]], writable: dict[str, Path]
) -> dict[str, bool]:
    payload = {
        "units": [
            {
                "working": str(value["working"]),
                "binary": str(value["binary"]),
                "execPaths": [str(item) for item in value["execPaths"]],
            }
            for value in units.values()
        ],
        "protected": sorted({str(value["env"]) for value in units.values()}),
        "writable": [str(path) for path in writable.values()],
    }
    result = subprocess.run(
        [
            str(SETPRIV),
            f"--reuid={TEST_UID}",
            f"--regid={TEST_GID}",
            "--clear-groups",
            "--no-new-privs",
            sys.executable,
            "-c",
            CHILD_CODE,
            json.dumps(payload, separators=(",", ":")),
        ],
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        fail("NONROOT_CHILD_PROBE_FAILED")
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError:
        fail("NONROOT_CHILD_OUTPUT_INVALID")
    required = {
        "nonRoot",
        "supplementaryGroupsCleared",
        "workingDirectoriesAccessible",
        "execPathsAccessible",
        "protectedConfigReadDenied",
        "protectedConfigWriteOpenDenied",
        "disposableWritesPassed",
    }
    if set(value) != required or not all(value.get(key) is True for key in required):
        fail("NONROOT_PERMISSION_BOUNDARY_FAILED")
    return value

def state_signature(units: dict[str, dict[str, object]]) -> dict[str, tuple[str, str, str, str]]:
    return {
        role: (
            str(value["active"]),
            str(value["sub"]),
            str(value["restarts"]),
            str(value["releaseSha"]),
        )
        for role, value in units.items()
    }

def run_live() -> dict[str, object]:
    if os.geteuid() != 0:
        fail("ROOT_SUPERVISOR_REQUIRED")
    if not SETPRIV.is_file():
        fail("SETPRIV_MISSING")
    before, public_units = snapshot_units()
    release_summaries: dict[str, dict[str, object]] = {}
    for value in before.values():
        sha = str(value["releaseSha"])
        if sha in release_summaries:
            continue
        root = Path(value["root"])
        verify_release(root, sha)
        release_summaries[sha] = {
            "verified": True,
            **scan_release_tree(root, TEST_UID, TEST_GID),
        }
    protected: dict[str, dict[str, object]] = {}
    for role, value in before.items():
        label = str(UNIT_CONFIG[role]["envLabel"])
        if label not in protected:
            protected[label] = validate_protected_file(
                Path(value["env"]), TEST_UID, TEST_GID
            )
    temp_root: Path | None = None
    cleanup_verified = False
    try:
        temp_root = Path(tempfile.mkdtemp(prefix="octoport-b05-permissions-", dir="/tmp"))
        writable: dict[str, Path] = {}
        for role in UNIT_CONFIG:
            target = temp_root / role
            target.mkdir(mode=0o700)
            os.chown(target, TEST_UID, TEST_GID)
            writable[role] = target
        os.chown(temp_root, TEST_UID, TEST_GID)
        os.chmod(temp_root, 0o700)
        child = run_child_probe(before, writable)
    finally:
        if temp_root is not None:
            shutil.rmtree(temp_root, ignore_errors=False)
            cleanup_verified = not temp_root.exists()
    if not cleanup_verified:
        fail("DISPOSABLE_CLEANUP_FAILED")
    after, _ = snapshot_units()
    if state_signature(after) != state_signature(before):
        fail("OWNER_TEST_UNIT_STATE_CHANGED")
    return {
        "schema": "octoport-owner-test-service-permissions-v1",
        "status": "PASS",
        "evidenceLevel": "READ_ONLY_HOST_PLUS_DISPOSABLE_PERMISSION_REHEARSAL",
        "identity": {
            "mode": "EXPLICIT_NON_ROOT_TEST",
            "supplementaryGroupsCleared": child["supplementaryGroupsCleared"],
        },
        "units": public_units,
        "releaseTrees": release_summaries,
        "protectedConfig": protected,
        "workingDirectoriesAccessible": child["workingDirectoriesAccessible"],
        "execPathsAccessible": child["execPathsAccessible"],
        "protectedConfigReadDenied": child["protectedConfigReadDenied"],
        "protectedConfigWriteOpenDenied": child["protectedConfigWriteOpenDenied"],
        "disposableWritesPassed": child["disposableWritesPassed"],
        "serviceStateStable": True,
        "cleanupVerified": True,
        "secretMaterialRead": False,
        "liveMutationPerformed": False,
        "disposableMutationPerformed": True,
        "capacityProof": "NOT_PROVEN",
        "finalServiceAccountCreated": False,
        "systemdHardeningApplied": False,
    }

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        result = run_live()
    except ProbeError as error:
        result = {"schema": "octoport-owner-test-service-permissions-v1", "status": "FAIL", "code": str(error)}
        print(json.dumps(result, sort_keys=True))
        return 1
    except Exception:
        result = {"schema": "octoport-owner-test-service-permissions-v1", "status": "FAIL", "code": "UNEXPECTED_FAILURE"}
        print(json.dumps(result, sort_keys=True))
        return 1
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        os.chmod(args.output, 0o600)
    print(json.dumps(result, sort_keys=True))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
