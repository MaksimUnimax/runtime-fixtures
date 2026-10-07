#!/usr/bin/env python3
"""Guarded publication route for explicitly registered isolated task candidates.

This module is deliberately fail-closed.  It does not infer role/task authority
from a directory or branch name.  An isolated worktree may publish only through
an immutable registration, exact reviewed route bundle, single-ref normal Git
push, consumed/cancelled lease state machine, exact-five CI receipt and remote
readback.

The normal fixed A/B/C publication route remains in hooks/pre-push and
publication_guard.py.  This module is the additive isolated-candidate route.
"""
from __future__ import annotations

import argparse
import ctypes
import errno
import fcntl
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import subprocess
import sys
import time
from typing import Any, Iterable

from publication_guard import validate_ci_payload

ZERO_OID = "0" * 40
REGISTRATION_VERSION = 1
REVIEW_VERSION = 1
LEASE_VERSION = 1
SETTLEMENT_VERSION = 1
READY_VERSION = 1
DEFAULT_LEASE_SECONDS = 120
OPEN_STATES = {
    "REGISTERED",
    "PUSHING_TASK_REF",
    "TASK_REF_PUBLISHED",
    "READY",
    "PUBLISHING_MAIN",
    "PUBLISHED",
    "CLEANING_TASK_REF",
    "SUPERSEDING_TASK_REF",
    "REVOKED",
    "FAILED",
}
TRANSIENT_STATES = {
    "TASK_REF": "PUSHING_TASK_REF",
    "MAIN": "PUBLISHING_MAIN",
    "CLEANUP_TASK_REF": "CLEANING_TASK_REF",
    "SUPERSEDE_TASK_REF": "SUPERSEDING_TASK_REF",
}
PRE_PUSH_STATES = {
    "TASK_REF": "REGISTERED",
    "MAIN": "READY",
    "CLEANUP_TASK_REF": "PUBLISHED",
}
SUCCESS_STATES = {
    "TASK_REF": "TASK_REF_PUBLISHED",
    "MAIN": "PUBLISHED",
}
BUNDLE_RELATIVE_FILES = (
    "task_publication.py",
    "publication_guard.py",
    "ci_gate.py",
    "hooks/pre-push",
)
COMPLETION_BUNDLE_RELATIVE_FILES = (
    "task_publication.py",
    "control.py",
    "publication_guard.py",
    "ci_gate.py",
    "work_queue.py",
    "work_board_v2.py",
    "disk_lifecycle.py",
    "resource_runner.py",
    "waiting_gate.py",
    "notice_delivery.py",
)
SAFE_CONTROL_TOP = {"logs", "controllers", "artifacts"}
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{16,128}$")
SAFE_TASK_SLUG_RE = re.compile(r"[^A-Za-z0-9._-]+")
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA64_RE = re.compile(r"^[0-9a-f]{64}$")


class PublicationError(RuntimeError):
    """A fail-closed publication route error."""


def _control_root(value: str | os.PathLike[str] | None = None) -> Path:
    return Path(value or os.environ.get("OCTOPORT_PUBLICATION_CONTROL_ROOT") or
                os.environ.get("OCTOPORT_CONTROL_ROOT", "/root/octoport-control")).resolve()


def _canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode()


def _sha_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _sha_file(path: Path) -> str:
    return _sha_bytes(path.read_bytes())


def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def _atomic_write_bytes(path: Path, raw: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}-{secrets.token_hex(4)}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        view = memoryview(raw)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(tmp, path)
    os.chmod(path, mode)
    _fsync_dir(path.parent)


def _atomic_write_json(path: Path, value: Any, mode: int = 0o600) -> None:
    _atomic_write_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode(), mode)


def _create_once_bytes(path: Path, raw: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + f".tmp-{os.getpid()}-{secrets.token_hex(8)}")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        view = memoryview(raw)
        while view:
            written = os.write(fd, view)
            view = view[written:]
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        # Publish complete, fsynced bytes atomically, without replacing evidence.
        if not _rename_noreplace(tmp, path):
            raise PublicationError(f"IMMUTABLE_FILE_EXISTS:{path}")
    finally:
        tmp.unlink(missing_ok=True)


def _create_once_json(path: Path, value: Any, mode: int = 0o600) -> None:
    _create_once_bytes(path, (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode(), mode)


def _load_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError, TypeError) as error:
        raise PublicationError(f"JSON_INVALID:{path}") from error
    if not isinstance(value, dict):
        raise PublicationError(f"JSON_OBJECT_REQUIRED:{path}")
    return value


def _under_control(root: Path, path: Path) -> bool:
    try:
        rel = path.resolve().relative_to(root)
    except (OSError, ValueError):
        return False
    return bool(rel.parts) and rel.parts[0] in SAFE_CONTROL_TOP


def _require_control_evidence(root: Path, path: str | os.PathLike[str]) -> Path:
    resolved = Path(path).resolve()
    if not resolved.is_file() or not _under_control(root, resolved):
        raise PublicationError("CONTROL_EVIDENCE_REQUIRED")
    return resolved


AUTHORITY_GIT_BIN = "/usr/bin/git"
AUTHORITY_PATH = "/usr/bin:/bin"


def sanitized_git_authority_env(base: dict[str, str] | None = None) -> dict[str, str]:
    """Build a minimal environment for Git/process authority checks.

    Caller environment is intentionally not inherited: repository/config/object
    selectors, executable lookup, dynamic-loader and interpreter injection are
    all outside the authority boundary. ``base`` exists only so regressions can
    prove poisoned caller values are ignored.
    """
    _ = base
    return {
        "PATH": AUTHORITY_PATH,
        "LC_ALL": "C",
        "LANG": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_NO_REPLACE_OBJECTS": "1",
    }


def _authority_git(worktree: Path, *args: str) -> str:
    return _git(
        worktree, *args, env=sanitized_git_authority_env(),
        executable=AUTHORITY_GIT_BIN,
    )


def _authority_git_bytes(worktree: Path, *args: str) -> bytes:
    proc = subprocess.run(
        [AUTHORITY_GIT_BIN, "-C", str(worktree), *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=sanitized_git_authority_env(),
        check=False,
    )
    if proc.returncode:
        detail = proc.stderr.decode(errors="replace").strip()
        raise PublicationError(f"GIT_FAILED:{' '.join(args)}:{detail}")
    return proc.stdout


def _authority_clean(worktree: Path) -> bool:
    return not _authority_git(worktree, "status", "--porcelain=v1", "--untracked-files=all")


def _git(worktree: Path, *args: str, check: bool = True, input_text: str | None = None,
         env: dict[str, str] | None = None, executable: str = "git") -> str:
    command = [executable, "-C", str(worktree), *args]
    proc = subprocess.run(
        command,
        text=True,
        input=input_text,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=env,
        check=False,
    )
    if check and proc.returncode:
        raise PublicationError(f"GIT_FAILED:{' '.join(args)}:{proc.stderr.strip()}")
    return proc.stdout.strip()


def _git_lines(worktree: Path, *args: str) -> list[str]:
    text = _git(worktree, *args)
    return [line for line in text.splitlines() if line]


def _head(worktree: Path) -> str:
    return _git(worktree, "rev-parse", "HEAD")


def _tree(worktree: Path, rev: str = "HEAD") -> str:
    return _git(worktree, "rev-parse", f"{rev}^{{tree}}")


def _commit_parents(worktree: Path, rev: str) -> list[str]:
    line = _git(worktree, "show", "-s", "--format=%P", rev)
    return line.split() if line else []


def _clean(worktree: Path) -> bool:
    return not _git(worktree, "status", "--porcelain=v1", "--untracked-files=all")


def _diff_paths(worktree: Path, base: str, head: str) -> list[str]:
    return sorted(_git_lines(worktree, "diff", "--name-only", f"{base}..{head}"))


def _full_diff_sha(worktree: Path, base: str, head: str) -> str:
    raw = subprocess.check_output(
        ["git", "-C", str(worktree), "diff", "--binary", "--full-index", f"{base}..{head}"]
    )
    return _sha_bytes(raw)


def _patch_sha(worktree: Path, parent: str, head: str) -> str:
    raw = subprocess.check_output(
        ["git", "-C", str(worktree), "diff", "--binary", "--full-index", parent, head]
    )
    return _sha_bytes(raw)


def _merge_base_is_ancestor(worktree: Path, base: str, head: str) -> bool:
    return subprocess.call(
        ["git", "-C", str(worktree), "merge-base", "--is-ancestor", base, head],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    ) == 0


def _remote_oid(worktree: Path, remote: str, ref: str) -> str:
    targets = _git_lines(worktree, "remote", "get-url", "--push", "--all", remote)
    if len(targets) != 1:
        raise PublicationError("SINGLE_PUSH_TARGET_REQUIRED")
    return _remote_oid_target(worktree, targets[0], ref)


def _remote_oid_target(worktree: Path, target: str, ref: str,
                       env: dict[str, str] | None = None) -> str:
    output = _git(worktree, "ls-remote", target, ref, env=env)
    if not output:
        return ZERO_OID
    rows = [row.split() for row in output.splitlines() if row.strip()]
    exact = [row for row in rows if len(row) >= 2 and row[1] == ref]
    if len(exact) != 1 or not SHA40_RE.fullmatch(exact[0][0]):
        raise PublicationError(f"REMOTE_REF_READBACK_AMBIGUOUS:{ref}")
    return exact[0][0]


def _boot_id() -> str:
    value = Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    if not value:
        raise PublicationError("BOOT_ID_UNAVAILABLE")
    return value


def _boottime_ns() -> int:
    return time.clock_gettime_ns(time.CLOCK_BOOTTIME)


def _proc_start_time(pid: int) -> str | None:
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().split()
    except OSError:
        return None
    return fields[21] if len(fields) > 21 else None


def _process_alive(pid: int | None, start_time: str | None) -> bool | None:
    if not pid or not start_time:
        return None
    try:
        fields = Path(f"/proc/{pid}/stat").read_text().split()
    except FileNotFoundError:
        return False
    except OSError:
        return None
    if len(fields) <= 21:
        return None
    return fields[21] == start_time


def _safe_slug(value: str) -> str:
    slug = SAFE_TASK_SLUG_RE.sub("-", value).strip("-._")
    if not slug:
        raise PublicationError("TASK_SLUG_INVALID")
    return slug[:80]


def _root_dir(root: Path) -> Path:
    return root / "controllers/task-publication"


def _registration_path(root: Path, registration_id: str) -> Path:
    return _root_dir(root) / "registrations" / f"{registration_id}.json"


def _active_pointer_path(root: Path, worktree: Path) -> Path:
    key = _sha_bytes(str(worktree.resolve()).encode())
    return _root_dir(root) / "active" / f"{key}.json"


def _lease_dir(root: Path, registration_id: str, namespace: str) -> Path:
    return _root_dir(root) / "leases" / registration_id / namespace


def _lease_path(root: Path, registration_id: str, namespace: str, nonce: str) -> Path:
    return _lease_dir(root, registration_id, namespace) / f"{nonce}.json"


def _settlement_path(root: Path, registration_id: str, nonce: str) -> Path:
    return _root_dir(root) / "settlements" / registration_id / f"{nonce}.json"


def _attempt_path(root: Path, registration_id: str, nonce: str) -> Path:
    return _root_dir(root) / "attempts" / registration_id / f"{nonce}.json"


def _ready_dir(root: Path, registration_id: str) -> Path:
    return _root_dir(root) / "ready" / registration_id


def _events_path(root: Path, registration_id: str) -> Path:
    return _root_dir(root) / "events" / f"{registration_id}.jsonl"


def _close_dir(root: Path, registration_id: str) -> Path:
    return _root_dir(root) / "close" / registration_id


def _append_event(root: Path, registration_id: str, event: dict[str, Any]) -> None:
    path = _events_path(root, registration_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    row = dict(event, at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    try:
        raw = _canonical_bytes(row)
        os.write(fd, raw)
        os.fsync(fd)
    finally:
        os.close(fd)
    _fsync_dir(path.parent)


def _read_registration(root: Path, registration_id: str) -> tuple[dict[str, Any], str]:
    if not SHA64_RE.fullmatch(registration_id):
        raise PublicationError("REGISTRATION_ID_INVALID")
    path = _registration_path(root, registration_id)
    raw = path.read_bytes()
    value = json.loads(raw)
    if not isinstance(value, dict):
        raise PublicationError("REGISTRATION_INVALID")
    if value.get("registration_id") != registration_id or _sha_bytes(_canonical_bytes(value.get("core"))) != registration_id:
        raise PublicationError("REGISTRATION_CORE_HASH_MISMATCH")
    version = value.get("state_version")
    if type(version) is not int or version < 1:
        raise PublicationError("REGISTRATION_VERSION_INVALID")
    history = _root_dir(root) / "states" / registration_id
    if (history / f"{version}.json").read_bytes() != raw:
        raise PublicationError("REGISTRATION_STATE_HASH_MISMATCH")
    if version > 1 and _sha_file(history / f"{version - 1}.json") != value.get("previous_state_sha256"):
        raise PublicationError("REGISTRATION_STATE_CHAIN_MISMATCH")
    return value, _sha_bytes(raw)


def _persist_registration(root: Path, reg: dict[str, Any]) -> None:
    raw = (json.dumps(reg, ensure_ascii=False, indent=2) + "\n").encode()
    history = _root_dir(root) / "states" / reg["registration_id"] / f"{reg['state_version']}.json"
    if history.exists():
        if history.read_bytes() != raw:
            raise PublicationError("REGISTRATION_STATE_VERSION_REUSED")
    else:
        _create_once_bytes(history, raw)
    _atomic_write_bytes(_registration_path(root, reg["registration_id"]), raw)


def _state_transition(root: Path, registration_id: str, expected_states: Iterable[str],
                      new_state: str, updates: dict[str, Any] | None = None,
                      expected_version: int | None = None) -> dict[str, Any]:
    reg, old_sha = _read_registration(root, registration_id)
    if reg.get("state") not in set(expected_states):
        raise PublicationError(f"REGISTRATION_STATE_INVALID:{reg.get('state')}")
    if expected_version is not None and reg.get("state_version") != expected_version:
        raise PublicationError("REGISTRATION_STATE_VERSION_DRIFT")
    if reg.get("state") == "CLOSED":
        raise PublicationError("REGISTRATION_CLOSED")
    next_reg = dict(reg)
    next_reg["previous_state_sha256"] = old_sha
    next_reg["state"] = new_state
    next_reg["state_version"] = int(reg.get("state_version", 0)) + 1
    next_reg["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if updates:
        next_reg.update(updates)
    _persist_registration(root, next_reg)
    _append_event(root, registration_id, {
        "kind": "STATE",
        "from": reg.get("state"),
        "to": new_state,
        "version": next_reg["state_version"],
        "previous_state_sha256": old_sha,
    })
    return next_reg


def _load_board(root: Path) -> dict[str, Any]:
    # The versioned queue reader validates COMMITTED generations and history.
    from work_queue import load_board
    board = load_board(root)
    tasks = board.get("tasks")
    if not isinstance(tasks, list):
        raise PublicationError("WORK_BOARD_TASKS_REQUIRED")
    return board


def _task_from_board(board: dict[str, Any], task_id: str) -> dict[str, Any]:
    rows = [t for t in board.get("tasks", []) if isinstance(t, dict) and t.get("id") == task_id]
    if len(rows) != 1:
        raise PublicationError("TASK_EXACTLY_ONE_ACTIVE_RECORD_REQUIRED")
    return rows[0]


def _task_fingerprint(task: dict[str, Any]) -> str:
    identity = {
        "id": task.get("id"),
        "role": task.get("role"),
        "plan": task.get("plan"),
        "state": task.get("state"),
        "claimed_at": task.get("claimed_at"),
        "requires": task.get("requires"),
        "paths": task.get("paths"),
        "result": task.get("result"),
        "acceptance": task.get("acceptance"),
        "unblock_receipt": task.get("unblock_receipt"),
    }
    return _sha_bytes(_canonical_bytes(identity))


def _role_state(root: Path, role: str) -> dict[str, Any]:
    return _load_json(root / f"{role}.json")


def _require_role_running(root: Path, role: str) -> None:
    state = _role_state(root, role)
    if state.get("status") == "STOPPED":
        raise PublicationError("STOPPED: no publication permitted")
    if state.get("status") not in {"RUNNING", "WAITING_INPUT"}:
        raise PublicationError("ROLE_STATE_UNVERIFIED")


def _ownership(worktree: Path) -> tuple[dict[str, Any], str]:
    path = worktree / "docs/development/coordination/OWNERSHIP.json"
    value = _load_json(path)
    return value, _sha_file(path)


def _ownership_at_commit(worktree: Path, commit: str) -> tuple[dict[str, Any], str]:
    try:
        raw = _authority_git_bytes(
            worktree, "show", f"{commit}:docs/development/coordination/OWNERSHIP.json"
        )
        value = json.loads(raw)
    except (PublicationError, ValueError, TypeError) as error:
        raise PublicationError("OWNERSHIP_COMMITTED_POLICY_INVALID") from error
    if not isinstance(value, dict):
        raise PublicationError("OWNERSHIP_COMMITTED_POLICY_INVALID")
    return value, _sha_bytes(raw)


def _require_committed_worktree_bytes(
    worktree: Path, commit: str, relative_paths: Iterable[str],
) -> None:
    for relative in relative_paths:
        source_relative = (
            relative if relative.startswith("tooling/coordination/")
            else f"tooling/coordination/{relative}"
        )
        path = worktree / source_relative
        try:
            committed = _authority_git_bytes(
                worktree, "show", f"{commit}:{source_relative}"
            )
            current = path.read_bytes()
        except (OSError, PublicationError):
            raise PublicationError(
                f"QUEUE_COMPLETE_ROUTE_SOURCE_BYTES_DRIFT:{source_relative}"
            ) from None
        if current != committed:
            raise PublicationError(
                f"QUEUE_COMPLETE_ROUTE_SOURCE_BYTES_DRIFT:{source_relative}"
            )


def _path_owned(path: str, role: str, ownership: dict[str, Any]) -> bool:
    spec = ownership.get("roles", {}).get(role)
    if not isinstance(spec, dict):
        return False
    allow = spec.get("allow", [])
    deny = spec.get("deny", [])
    return any(fnmatch.fnmatchcase(path, pattern) for pattern in allow) and not any(
        fnmatch.fnmatchcase(path, pattern) for pattern in deny
    )


def _require_canonical_role_location(
    source_root: Path, role: str, ownership: dict[str, Any] | None = None,
) -> Path:
    """Resolve and preflight the canonical role location used for queue mutation."""
    if ownership is None:
        source_head = _authority_git(source_root, "rev-parse", "HEAD")
        ownership, _ownership_sha = _ownership_at_commit(source_root, source_head)
    spec = ownership.get("roles", {}).get(role)
    if not isinstance(spec, dict):
        raise PublicationError("QUEUE_COMPLETE_ROLE_LOCATION_INVALID")
    raw_path = spec.get("path")
    expected_branch = spec.get("branch")
    if (not isinstance(raw_path, str) or not raw_path.startswith("/")
            or not isinstance(expected_branch, str) or not expected_branch):
        raise PublicationError("QUEUE_COMPLETE_ROLE_LOCATION_INVALID")
    role_root = Path(raw_path)
    try:
        resolved_root = role_root.resolve(strict=True)
        top = Path(_authority_git(role_root, "rev-parse", "--show-toplevel")).resolve(strict=True)
        branch = _authority_git(role_root, "branch", "--show-current")
    except (OSError, subprocess.SubprocessError):
        raise PublicationError("QUEUE_COMPLETE_ROLE_LOCATION_INVALID") from None
    if str(resolved_root) != raw_path or top != resolved_root or branch != expected_branch:
        raise PublicationError("QUEUE_COMPLETE_ROLE_LOCATION_INVALID")
    return resolved_root


def validate_queue_completion_source_authority(
    root: Path,
    registration_id: str,
    route_root: Path,
    role: str,
    task_id: str,
) -> dict[str, Any]:
    """Prove the executing queue-completion source before any shared mutation.

    First use is allowed only from a clean checkout whose exact HEAD *and* tree
    equal the CLOSED registration candidate.  Later route sources must already
    be represented by a strict-valid publication-backed DONE row.  The source's
    OWNERSHIP policy is read only after that source identity is accepted.
    """
    reg, _ = _read_registration(root, registration_id)
    if reg.get("state") != "CLOSED":
        raise PublicationError(f"QUEUE_COMPLETE_REGISTRATION_NOT_CLOSED:{reg.get('state')}")
    if not _no_armed_leases(root, registration_id):
        raise PublicationError("QUEUE_COMPLETE_ARMED_LEASE_PRESENT")
    core = reg.get("core")
    if (
        not isinstance(core, dict)
        or core.get("role") != role
        or core.get("task_id") != task_id
    ):
        raise PublicationError("QUEUE_COMPLETE_SOURCE_TASK_ROLE_MISMATCH")

    from work_queue import _publication_completion_candidate, _strict_completion_valid
    board = _load_board(root)
    task = _task_from_board(board, task_id)
    if task.get("role") != role:
        raise PublicationError("QUEUE_COMPLETE_SOURCE_TASK_ROLE_MISMATCH")
    try:
        publication_candidate, _publication_snapshot = _publication_completion_candidate(
            root, role, task, registration_id
        )
    except RuntimeError as error:
        raise PublicationError(f"QUEUE_COMPLETE_SOURCE_PUBLICATION_INVALID:{error}") from None
    if publication_candidate != core.get("candidate_head"):
        raise PublicationError("QUEUE_COMPLETE_SOURCE_PUBLICATION_INVALID:CANDIDATE_MISMATCH")

    route_root = Path(route_root).resolve()
    try:
        if Path(_authority_git(route_root, "rev-parse", "--show-toplevel")).resolve() != route_root:
            raise PublicationError("QUEUE_COMPLETE_ROUTE_SOURCE_ROOT_INVALID")
        _authority_git(route_root, "ls-files", "--error-unmatch", "tooling/coordination/control.py")
        _authority_git(route_root, "ls-files", "--error-unmatch", "tooling/coordination/task_publication.py")
    except (OSError, subprocess.SubprocessError):
        raise PublicationError("QUEUE_COMPLETE_ROUTE_SOURCE_ROOT_INVALID") from None
    if not _authority_clean(route_root):
        raise PublicationError("QUEUE_COMPLETE_ROUTE_SOURCE_DIRTY")

    route_head = _authority_git(route_root, "rev-parse", "HEAD")
    route_tree = _authority_git(route_root, "rev-parse", "HEAD^{tree}")
    registration_candidate_source = (
        route_head == core.get("candidate_head")
        and route_tree == core.get("candidate_tree")
    )
    route_authority: str | list[str]
    completion_bundles: list[dict[str, str]] = []
    if registration_candidate_source:
        descriptor = _completion_bundle_descriptor(root, reg)
        if descriptor is None:
            raise PublicationError("QUEUE_COMPLETE_COMPLETION_BUNDLE_REQUIRED")
        bundle_path, bundle_sha = descriptor
        completion_bundles.append({
            "authority": "REGISTRATION_CANDIDATE_SOURCE",
            "path": str(bundle_path),
            "sha256": bundle_sha,
        })
        route_authority = "REGISTRATION_CANDIDATE_SOURCE"
    else:
        accepted: list[str] = []
        for candidate_task in board["tasks"]:
            if (
                candidate_task.get("state") != "DONE"
                or candidate_task.get("completion_candidate_sha") != route_head
                or not candidate_task.get("completion_publication_registration")
                or not _strict_completion_valid(candidate_task)
            ):
                continue
            try:
                authority_reg, _ = _read_registration(
                    root, candidate_task["completion_publication_registration"]
                )
                descriptor = _completion_bundle_descriptor(root, authority_reg)
            except (OSError, PublicationError, RuntimeError, ValueError, KeyError, TypeError):
                continue
            if descriptor is None:
                continue
            bundle_path, bundle_sha = descriptor
            accepted.append(candidate_task["id"])
            completion_bundles.append({
                "authority": candidate_task["id"],
                "path": str(bundle_path),
                "sha256": bundle_sha,
            })
        if not accepted:
            raise PublicationError("QUEUE_COMPLETE_ROUTE_SOURCE_NOT_ACCEPTED")
        route_authority = accepted

    _require_committed_worktree_bytes(
        route_root, route_head, COMPLETION_BUNDLE_RELATIVE_FILES
    )
    ownership, _ownership_sha = _ownership_at_commit(route_root, route_head)
    spec = ownership.get("roles", {}).get(role)
    if not isinstance(spec, dict):
        raise PublicationError("QUEUE_COMPLETE_ROLE_LOCATION_INVALID")
    role_path = spec.get("path")
    role_branch = spec.get("branch")
    if (
        not isinstance(role_path, str)
        or not role_path.startswith("/")
        or not isinstance(role_branch, str)
        or not role_branch
    ):
        raise PublicationError("QUEUE_COMPLETE_ROLE_LOCATION_INVALID")

    return {
        "registration": reg,
        "core": core,
        "route_root": route_root,
        "route_head": route_head,
        "route_tree": route_tree,
        "route_authority": route_authority,
        "role_path": role_path,
        "role_branch": role_branch,
        "ownership": ownership,
        "completion_bundles": completion_bundles,
    }


def _select_execution_completion_bundle(
    authority: dict[str, Any], executing_file: Path, expected_name: str,
) -> tuple[Path, str]:
    executing_file = Path(executing_file).resolve()
    matches: list[tuple[Path, str]] = []
    for descriptor in authority.get("completion_bundles", []):
        if not isinstance(descriptor, dict):
            continue
        path = Path(descriptor.get("path", "")).resolve()
        sha = descriptor.get("sha256")
        if not isinstance(sha, str):
            continue
        _verify_completion_bundle(path, sha)
        if executing_file == path / expected_name:
            matches.append((path, sha))
    if len(matches) != 1:
        raise PublicationError("QUEUE_COMPLETE_EXECUTION_BUNDLE_MISMATCH")
    return matches[0]


def _run_canonical_queue_completion(
    root: Path,
    route_root: Path,
    role_root: Path,
    role: str,
    task_id: str,
    proof: Path,
    summary: str,
    registration_id: str,
    completion_bundle: Path,
    completion_bundle_sha: str,
) -> dict[str, Any]:
    """Run the actual queue writer from the immutable completion bundle."""
    if root.resolve() != Path("/root/octoport-control").resolve():
        raise PublicationError("QUEUE_COMPLETE_CONTROL_ROOT_UNSUPPORTED")
    completion_bundle = completion_bundle.resolve()
    _verify_completion_bundle(completion_bundle, completion_bundle_sha)
    control_script = completion_bundle / "control.py"
    if not control_script.is_file():
        raise PublicationError("QUEUE_COMPLETE_CONTROL_SOURCE_INVALID")
    env = sanitized_git_authority_env()
    env.update({
        "OCTOPORT_PUBLICATION_ROUTE_SOURCE_ROOT": str(route_root.resolve()),
        "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE": str(completion_bundle),
        "OCTOPORT_PUBLICATION_COMPLETION_BUNDLE_SHA256": completion_bundle_sha,
    })
    command = [
        sys.executable,
        "-B",
        str(control_script),
        role,
        "queue-task",
        "--task",
        task_id,
        "--task-state",
        "DONE",
        "--receipt",
        str(proof),
        "--summary",
        summary,
        "--publication-registration",
        registration_id,
    ]
    try:
        proc = subprocess.run(
            command,
            cwd=str(role_root),
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        raise PublicationError("QUEUE_COMPLETE_ROLE_BOUNDARY_EXEC_FAILED") from None
    if proc.returncode != 0:
        detail = (proc.stdout.strip() or proc.stderr.strip())[-1000:]
        raise PublicationError(f"QUEUE_COMPLETE_ROLE_BOUNDARY_BLOCKED:{detail}")
    try:
        result = json.loads(proc.stdout)
    except (TypeError, ValueError):
        raise PublicationError("QUEUE_COMPLETE_ROLE_BOUNDARY_RESULT_INVALID") from None
    if not isinstance(result, dict):
        raise PublicationError("QUEUE_COMPLETE_ROLE_BOUNDARY_RESULT_INVALID")
    return result


def _remote_repository_identity(target: str) -> tuple[str, str]:
    """Normalize the same repository across trusted GitHub fetch/push URL forms."""
    value = str(target).strip()
    if not value:
        raise PublicationError("TRUSTED_ROUTE_REMOTE_IDENTITY_INVALID")
    if value.startswith("/"):
        return ("path", str(Path(value).resolve()))
    match = re.fullmatch(
        r"git@(?:github\.com|github-seller-agents):([^\s]+?)(?:\.git)?", value
    )
    if match:
        return ("github", match.group(1).removesuffix(".git"))
    match = re.fullmatch(
        r"github-seller-agents:"
        r"([A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?)/"
        r"([A-Za-z0-9._-]+)",
        value,
    )
    if match:
        owner = match.group(1)
        repository = match.group(2).removesuffix(".git")
        if repository and repository not in {".", ".."}:
            return ("github", f"{owner}/{repository}")
    match = re.fullmatch(
        r"https://github\.com/([^\s]+?)(?:\.git)?/?", value
    )
    if match:
        return ("github", match.group(1).removesuffix(".git"))
    match = re.fullmatch(
        r"ssh://git@(?:github\.com|github-seller-agents)/([^\s]+?)(?:\.git)?/?", value
    )
    if match:
        return ("github", match.group(1).removesuffix(".git"))
    raise PublicationError("TRUSTED_ROUTE_REMOTE_IDENTITY_INVALID")


def _canonical_remote_query_target(target: str) -> str:
    """Derive a read-only remote target from immutable registration identity."""
    kind, identity = _remote_repository_identity(target)
    if kind == "github":
        return f"https://github.com/{identity}.git"
    if kind == "path":
        return identity
    raise PublicationError("TRUSTED_ROUTE_REMOTE_IDENTITY_INVALID")


def _authority_remote_oid_target(target: str, ref: str) -> str:
    """Read a remote ref without entering any repository-local Git config."""
    query_target = _canonical_remote_query_target(target)
    proc = subprocess.run(
        [AUTHORITY_GIT_BIN, "ls-remote", query_target, ref],
        cwd="/",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=sanitized_git_authority_env(),
        check=False,
    )
    if proc.returncode:
        raise PublicationError(
            f"TRUSTED_ROUTE_REMOTE_READ_FAILED:{proc.stderr.strip()}"
        )
    rows = [row.split() for row in proc.stdout.splitlines() if row.strip()]
    if not rows:
        return ZERO_OID
    exact = [row for row in rows if len(row) >= 2 and row[1] == ref]
    if len(exact) != 1 or not SHA40_RE.fullmatch(exact[0][0]):
        raise PublicationError(f"REMOTE_REF_READBACK_AMBIGUOUS:{ref}")
    return exact[0][0]


def _trusted_current_main_route_authority(
    root: Path, route_root: Path,
) -> dict[str, Any]:
    """Bind an administrative queue broker to accepted current-main route bytes."""
    root = root.resolve()
    route_root = route_root.resolve()
    try:
        if Path(_authority_git(route_root, "rev-parse", "--show-toplevel")).resolve() != route_root:
            raise PublicationError("TRUSTED_ROUTE_SOURCE_ROOT_INVALID")
        route_head = _authority_git(route_root, "rev-parse", "HEAD")
        route_tree = _authority_git(route_root, "rev-parse", "HEAD^{tree}")
    except (OSError, subprocess.SubprocessError):
        raise PublicationError("TRUSTED_ROUTE_SOURCE_ROOT_INVALID") from None
    if not SHA40_RE.fullmatch(route_head) or not SHA40_RE.fullmatch(route_tree):
        raise PublicationError("TRUSTED_ROUTE_SOURCE_IDENTITY_INVALID")
    if not _authority_clean(route_root):
        raise PublicationError("TRUSTED_ROUTE_SOURCE_DIRTY")

    from work_queue import _strict_completion_valid
    board = _load_board(root)
    authorities: list[str] = []
    descriptors: dict[tuple[str, str], dict[str, str]] = {}
    push_targets: set[str] = set()
    for task in board["tasks"]:
        registration_id = task.get("completion_publication_registration")
        if (
            task.get("state") != "DONE"
            or task.get("completion_candidate_sha") != route_head
            or not registration_id
            or not _strict_completion_valid(task)
        ):
            continue
        try:
            reg, _ = _read_registration(root, registration_id)
            core = reg["core"]
            descriptor = _completion_bundle_descriptor(root, reg)
        except (OSError, PublicationError, RuntimeError, ValueError, KeyError, TypeError):
            continue
        if (
            reg.get("state") != "CLOSED"
            or core.get("candidate_head") != route_head
            or core.get("candidate_tree") != route_tree
            or descriptor is None
            or not isinstance(core.get("push_target"), str)
            or not core["push_target"]
        ):
            continue
        bundle_path, bundle_sha = descriptor
        authorities.append(task["id"])
        descriptors[(str(bundle_path), bundle_sha)] = {
            "authority": task["id"],
            "path": str(bundle_path),
            "sha256": bundle_sha,
        }
        push_targets.add(core["push_target"])
    if not authorities or not descriptors:
        raise PublicationError("TRUSTED_ROUTE_SOURCE_NOT_ACCEPTED")
    if len(push_targets) != 1:
        raise PublicationError("TRUSTED_ROUTE_REMOTE_IDENTITY_AMBIGUOUS")

    push_target = next(iter(push_targets))
    query_target = _canonical_remote_query_target(push_target)
    remote = _authority_remote_oid_target(query_target, "refs/heads/main")
    if remote != route_head:
        raise PublicationError("TRUSTED_ROUTE_NOT_CURRENT_REMOTE_MAIN")

    _require_committed_worktree_bytes(
        route_root, route_head, COMPLETION_BUNDLE_RELATIVE_FILES
    )
    ownership, _ownership_sha = _ownership_at_commit(route_root, route_head)
    return {
        "route_root": route_root,
        "route_head": route_head,
        "route_tree": route_tree,
        "route_authority": sorted(authorities),
        "completion_bundles": list(descriptors.values()),
        "ownership": ownership,
        "push_target": push_target,
        "query_target": query_target,
    }


_BLOCKER_CONTROL_RUNNER = (
    "import importlib.util,pathlib,sys;"
    "bundle=pathlib.Path(sys.argv[1]).resolve();"
    "role_root=pathlib.Path(sys.argv[2]).resolve();"
    "control_root=pathlib.Path(sys.argv[3]).resolve();"
    "argv=sys.argv[4:];"
    "sys.path.insert(0,str(bundle));"
    "spec=importlib.util.spec_from_file_location('octoport_blocker_control',bundle/'control.py');"
    "module=importlib.util.module_from_spec(spec);"
    "spec.loader.exec_module(module);"
    "module.ROOT=role_root;"
    "module.CONTROL=control_root;"
    "sys.argv=[str(role_root/'tooling/coordination/control.py'),*argv];"
    "raise SystemExit(module.main())"
)


def _run_canonical_blocker_resolution(
    root: Path, completion_bundle: Path, completion_bundle_sha: str,
    role_root: Path, role: str, task_id: str, successor_id: str, receipt: Path,
) -> dict[str, Any]:
    """Run the existing queue-resolve-blocker policy from immutable route code."""
    root = root.resolve()
    completion_bundle = completion_bundle.resolve()
    _verify_completion_bundle(completion_bundle, completion_bundle_sha)
    control_script = completion_bundle / "control.py"
    if not control_script.is_file():
        raise PublicationError("BLOCKER_RESOLUTION_CONTROL_SOURCE_INVALID")
    env = sanitized_git_authority_env()
    command = [
        sys.executable, "-B", "-c", _BLOCKER_CONTROL_RUNNER,
        str(completion_bundle), str(role_root.resolve()), str(root.resolve()),
        role, "queue-resolve-blocker",
        "--task", task_id,
        "--successor", successor_id,
        "--receipt", str(receipt.resolve()),
    ]
    try:
        proc = subprocess.run(
            command, cwd=str(role_root), env=env, text=True,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=30, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        raise PublicationError("BLOCKER_RESOLUTION_ROLE_BOUNDARY_EXEC_FAILED") from None
    if proc.returncode != 0:
        detail = (proc.stdout.strip() or proc.stderr.strip())[-1000:]
        raise PublicationError(f"BLOCKER_RESOLUTION_ROLE_BOUNDARY_BLOCKED:{detail}")
    try:
        result = json.loads(proc.stdout)
    except (TypeError, ValueError):
        raise PublicationError("BLOCKER_RESOLUTION_ROLE_BOUNDARY_RESULT_INVALID") from None
    if not isinstance(result, dict):
        raise PublicationError("BLOCKER_RESOLUTION_ROLE_BOUNDARY_RESULT_INVALID")
    return result


def _revalidate_trusted_route_remote_main(authority: dict[str, Any]) -> None:
    """Refresh remote main outside repository-local Git configuration."""
    remote = _authority_remote_oid_target(
        authority["query_target"], "refs/heads/main"
    )
    if remote != authority["route_head"]:
        raise PublicationError("TRUSTED_ROUTE_NOT_CURRENT_REMOTE_MAIN")


def resolve_blocker_via_trusted_route(
    root: Path, route_source_root: Path, task_id: str,
    successor_id: str, receipt: str,
) -> dict[str, Any]:
    """Broker the existing blocker policy through accepted current-main route code."""
    root = root.resolve()
    authority = _trusted_current_main_route_authority(root, route_source_root)
    board = _load_board(root)
    task = _task_from_board(board, task_id)
    role = task.get("role")
    if role not in {"A", "B", "C"}:
        raise PublicationError("BLOCKER_RESOLUTION_ROLE_INVALID")

    completion_bundle, completion_bundle_sha = _select_execution_completion_bundle(
        authority, Path(__file__), "task_publication.py"
    )
    role_location = _require_canonical_role_location(
        authority["route_root"], role, authority["ownership"]
    )
    proof = Path(receipt).resolve()
    _revalidate_trusted_route_remote_main(authority)
    result = _run_canonical_blocker_resolution(
        root, completion_bundle, completion_bundle_sha,
        role_location, role, task_id, successor_id, proof,
    )
    return dict(
        result,
        route_source_head=authority["route_head"],
        route_authority=authority["route_authority"],
        role_location=str(role_location),
        completion_bundle=str(completion_bundle),
        completion_bundle_manifest_sha256=completion_bundle_sha,
    )


def _config_values(worktree: Path, key: str) -> dict[str, Any]:
    proc = subprocess.run(
        ["git", "-C", str(worktree), "config", "--worktree", "--get-all", key],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise PublicationError(f"WORKTREE_CONFIG_READ_FAILED:{key}")
    present = proc.returncode == 0
    values = proc.stdout.splitlines() if present else []
    if present and proc.stdout.endswith("\n") and proc.stdout == "\n":
        values = [""]
    return {"present": present, "values": values}


def _set_config_values(worktree: Path, key: str, captured: dict[str, Any]) -> None:
    subprocess.run(
        ["git", "-C", str(worktree), "config", "--worktree", "--unset-all", key],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if captured.get("present"):
        values = captured.get("values", [])
        if not isinstance(values, list) or not values:
            values = [""]
        for value in values:
            proc = subprocess.run(
                ["git", "-C", str(worktree), "config", "--worktree", "--add", key, str(value)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                check=False,
            )
            if proc.returncode:
                raise PublicationError(f"WORKTREE_CONFIG_WRITE_FAILED:{key}")
    if _config_values(worktree, key) != {
        "present": bool(captured.get("present")),
        "values": captured.get("values", []) if captured.get("present") else [],
    }:
        raise PublicationError(f"WORKTREE_CONFIG_RESTORE_MISMATCH:{key}")


def _worktree_config_digest(worktree: Path) -> str:
    config_path = Path(_git(worktree, "rev-parse", "--git-path", "config.worktree"))
    if not config_path.is_absolute():
        config_path = worktree / config_path
    if not config_path.exists():
        return _sha_bytes(b"")
    proc = subprocess.run(
        ["git", "-C", str(worktree), "config", "--worktree", "--null", "--list"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise PublicationError("WORKTREE_CONFIG_DIGEST_FAILED")
    return _sha_bytes(proc.stdout)


def _global_config_digest() -> str:
    proc = subprocess.run(
        # Unlike --list, querying all keys reports an absent optional global
        # file as an empty configuration (exit 1), without hiding read errors.
        ["git", "config", "--global", "--null", "--get-regexp", ".*"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if proc.returncode not in {0, 1}:
        raise PublicationError("GLOBAL_CONFIG_DIGEST_FAILED")
    return _sha_bytes(proc.stdout)


def _common_config_path(worktree: Path) -> Path:
    common = Path(_git(worktree, "rev-parse", "--git-common-dir"))
    if not common.is_absolute():
        common = (worktree / common).resolve()
    return common / "config"


def _common_config_digest(worktree: Path) -> str:
    path = _common_config_path(worktree)
    return _sha_file(path) if path.is_file() else _sha_bytes(b"")


def _common_config_matches_registered(worktree: Path, expected_sha256: str) -> bool:
    """Allow only normal append-only branch tracking after registration.

    A normal git worktree add with a new branch appends a branch section to the
    common repository config. That bookkeeping is unrelated to this route's
    worktree-local hooksPath and pushurl, but the historical whole-file digest
    made older open registrations impossible to close after another worktree
    was created.

    Compatibility is deliberately byte-based and one-way: the current file must
    either match exactly or become the registered bytes after stripping only a
    suffix of complete branch sections whose non-empty keys are exactly remote
    and merge. Any other common-config edit remains fail-closed.
    """
    path = _common_config_path(worktree)
    raw = path.read_bytes() if path.is_file() else b""
    if _sha_bytes(raw) == expected_sha256:
        return True
    lines = raw.splitlines(keepends=True)
    while lines:
        headers = [
            index for index, line in enumerate(lines)
            if line.lstrip().startswith(b"[")
        ]
        if not headers:
            return False
        start = headers[-1]
        header = lines[start].strip()
        if re.fullmatch(br'\[branch "[^"\r\n]+"\]', header) is None:
            return False
        body = lines[start + 1:]
        for line in body:
            item = line.strip()
            if not item:
                continue
            if re.fullmatch(br"(?:remote|merge)\s*=\s*\S.*", item) is None:
                return False
        lines = lines[:start]
        if _sha_bytes(b"".join(lines)) == expected_sha256:
            return True
    return False


def _fixed_role_config_digests(ownership: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for role, spec in ownership.get("roles", {}).items():
        path = Path(spec.get("path", ""))
        if path.is_dir():
            result[role] = _worktree_config_digest(path)
    return result


def _route_config_snapshot(worktree: Path, remote: str) -> dict[str, Any]:
    return {
        "core.hooksPath": _config_values(worktree, "core.hooksPath"),
        f"remote.{remote}.pushurl": _config_values(worktree, f"remote.{remote}.pushurl"),
        "full_worktree_config_sha256": _worktree_config_digest(worktree),
    }


def _supersede_transport_env() -> dict[str, str]:
    """Return a predictable environment for the direct supersede transport."""
    env = dict(os.environ)
    for key in list(env):
        if (key in {"GIT_CONFIG", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS",
                    "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_GLOBAL",
                    "GIT_DIR", "GIT_WORK_TREE", "GIT_SSH", "GIT_SSH_COMMAND"}
                or key.startswith("GIT_CONFIG_KEY_") or key.startswith("GIT_CONFIG_VALUE_")):
            env.pop(key, None)
    env["GIT_CONFIG_NOSYSTEM"] = "1"
    env["GIT_CONFIG_SYSTEM"] = os.devnull
    env["GIT_CONFIG_GLOBAL"] = os.devnull
    # Preserve ~/.ssh/config host aliases and keys, but do not inherit a mutable
    # Git-level sshCommand or process-environment SSH wrapper.
    env["GIT_SSH_COMMAND"] = "ssh"
    env["LC_ALL"] = "C"
    return env


def _supersede_send_pack_probe(worktree: Path, target: str, ref: str,
                                expected_old: str) -> bool:
    """Probe one exact remote-ref expectation without mutating the remote."""
    proc = subprocess.run(
        ["git", "-C", str(worktree), "-c", "core.sshCommand=ssh", "send-pack",
         "--helper-status", "--dry-run", f"--force-with-lease={ref}:{expected_old}",
         target, f":{ref}"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=_supersede_transport_env(),
        check=False,
    )
    rows = [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    target_ok = f"ok {ref}"
    target_stale = f"error {ref} stale info"
    harmless_no_match = [row for row in rows if row.startswith("error ") and row.endswith(" no match")]
    unexpected = [
        row for row in rows
        if row not in {target_ok, target_stale} and row not in harmless_no_match
    ]
    if proc.returncode == 0 and target_ok in rows and target_stale not in rows and not unexpected:
        if sum(row.startswith("ok ") for row in rows) == 1:
            return True
    if proc.returncode != 0 and target_stale in rows and target_ok not in rows and not unexpected:
        if not any(row.startswith("ok ") for row in rows):
            return False
    raise PublicationError(
        "SUPERSEDE_REMOTE_PROBE_FAILED:"
        + _sha_bytes((proc.stdout + "\n" + proc.stderr).encode())
    )


def _supersede_remote_state(worktree: Path, target: str, ref: str,
                            candidate: str) -> str:
    if _supersede_send_pack_probe(worktree, target, ref, candidate):
        return candidate
    if _supersede_send_pack_probe(worktree, target, ref, ZERO_OID):
        return ZERO_OID
    return "FOREIGN_REF"


def _bundle_source_files(route_source_root: Path) -> dict[str, Path]:
    base = route_source_root / "tooling/coordination"
    files = {
        "task_publication.py": base / "task_publication.py",
        "publication_guard.py": base / "publication_guard.py",
        "ci_gate.py": base / "ci_gate.py",
        "work_queue.py": base / "work_queue.py",
        "hooks/pre-push": base / "hooks/pre-push",
    }
    if (base / "work_board_v2.py").exists():
        files["work_board_v2.py"] = base / "work_board_v2.py"
    return files


def _bundle_manifest_payload(route_source_root: Path, route_source_sha: str,
                             route_source_tree: str) -> dict[str, Any]:
    files = _bundle_source_files(route_source_root)
    for path in files.values():
        if not path.is_file():
            raise PublicationError(f"BUNDLE_SOURCE_FILE_MISSING:{path}")
        relative = str(path.relative_to(route_source_root))
        blob = subprocess.check_output(["git", "-C", str(route_source_root), "show", f"{route_source_sha}:{relative}"])
        if blob != path.read_bytes():
            raise PublicationError(f"BUNDLE_SOURCE_BLOB_DRIFT:{relative}")
    return {
        "kind": "octoport.task-publication-bundle",
        "version": 1,
        "route_source_sha": route_source_sha,
        "route_source_tree": route_source_tree,
        "files": {name: _sha_file(path) for name, path in sorted(files.items())},
    }


def _install_bundle(root: Path, route_source_root: Path, route_source_sha: str,
                    route_source_tree: str) -> tuple[Path, str]:
    if _head(route_source_root) != route_source_sha or _tree(route_source_root) != route_source_tree:
        raise PublicationError("ROUTE_SOURCE_IDENTITY_MISMATCH")
    if not _clean(route_source_root):
        raise PublicationError("ROUTE_SOURCE_CLEAN_REQUIRED")
    payload = _bundle_manifest_payload(route_source_root, route_source_sha, route_source_tree)
    bundle = _root_dir(root) / "bundles" / route_source_sha
    manifest = bundle / "manifest.json"
    source_files = _bundle_source_files(route_source_root)
    if bundle.exists():
        if not manifest.is_file():
            raise PublicationError("BUNDLE_EXISTING_MANIFEST_MISSING")
        existing = _load_json(manifest)
        if existing != payload:
            raise PublicationError("BUNDLE_EXISTING_IDENTITY_MISMATCH")
        _verify_bundle(bundle, _sha_file(manifest))
        return bundle, _sha_file(manifest)
    bundle.mkdir(parents=True, exist_ok=False)
    try:
        for name, source in source_files.items():
            target = bundle / name
            target.parent.mkdir(parents=True, exist_ok=True)
            # Read committed objects, never mutable checkout bytes after preflight.
            relative = str(source.relative_to(route_source_root))
            raw = subprocess.check_output(["git", "-C", str(route_source_root), "show", f"{route_source_sha}:{relative}"])
            target.write_bytes(raw)
            os.chmod(target, 0o755 if name == "hooks/pre-push" else 0o600)
            with target.open("rb") as handle:
                os.fsync(handle.fileno())
        _atomic_write_json(manifest, payload)
        _fsync_dir(bundle)
        _fsync_dir(bundle.parent)
    except Exception:
        shutil.rmtree(bundle, ignore_errors=True)
        raise
    return bundle, _sha_file(manifest)


def _verify_bundle(bundle: Path, expected_manifest_sha: str) -> dict[str, Any]:
    manifest = bundle / "manifest.json"
    if not manifest.is_file() or _sha_file(manifest) != expected_manifest_sha:
        raise PublicationError("BUNDLE_MANIFEST_HASH_MISMATCH")
    payload = _load_json(manifest)
    files = payload.get("files")
    if not isinstance(files, dict):
        raise PublicationError("BUNDLE_FILES_INVALID")
    allowed = set(BUNDLE_RELATIVE_FILES) | {"work_queue.py", "work_board_v2.py"}
    if not (set(BUNDLE_RELATIVE_FILES) | {"work_queue.py"}) <= set(files) or not set(files) <= allowed:
        raise PublicationError("BUNDLE_FILES_INVALID")
    for name, expected in files.items():
        path = bundle / name
        if not path.is_file() or _sha_file(path) != expected:
            raise PublicationError(f"BUNDLE_FILE_HASH_MISMATCH:{name}")
    return payload


def _completion_bundle_source_files(candidate_root: Path) -> dict[str, Path]:
    base = candidate_root / "tooling/coordination"
    return {name: base / name for name in COMPLETION_BUNDLE_RELATIVE_FILES}


def _completion_bundle_manifest_payload(
    candidate_root: Path, candidate_sha: str, candidate_tree: str,
) -> dict[str, Any]:
    files = _completion_bundle_source_files(candidate_root)
    hashes: dict[str, str] = {}
    for name, path in files.items():
        relative = str(path.relative_to(candidate_root))
        committed = _authority_git_bytes(candidate_root, "show", f"{candidate_sha}:{relative}")
        hashes[name] = _sha_bytes(committed)
    return {
        "kind": "octoport.task-publication-completion-bundle",
        "version": 1,
        "candidate_sha": candidate_sha,
        "candidate_tree": candidate_tree,
        "files": hashes,
    }


def _completion_bundle_dir(root: Path, candidate_sha: str) -> Path:
    if not SHA40_RE.fullmatch(candidate_sha):
        raise PublicationError("COMPLETION_BUNDLE_CANDIDATE_INVALID")
    return _root_dir(root) / "completion-bundles" / candidate_sha


def _install_completion_bundle(
    root: Path, candidate_root: Path, candidate_sha: str, candidate_tree: str,
) -> tuple[Path, str]:
    if _authority_git(candidate_root, "rev-parse", "HEAD") != candidate_sha:
        raise PublicationError("COMPLETION_BUNDLE_CANDIDATE_IDENTITY_MISMATCH")
    if _authority_git(candidate_root, "rev-parse", "HEAD^{tree}") != candidate_tree:
        raise PublicationError("COMPLETION_BUNDLE_CANDIDATE_IDENTITY_MISMATCH")
    payload = _completion_bundle_manifest_payload(
        candidate_root, candidate_sha, candidate_tree
    )
    bundle = _completion_bundle_dir(root, candidate_sha)
    manifest = bundle / "manifest.json"
    if bundle.exists():
        if not manifest.is_file() or _load_json(manifest) != payload:
            raise PublicationError("COMPLETION_BUNDLE_EXISTING_IDENTITY_MISMATCH")
        digest = _sha_file(manifest)
        _verify_completion_bundle(bundle, digest)
        return bundle, digest
    bundle.mkdir(parents=True, exist_ok=False)
    try:
        for name in COMPLETION_BUNDLE_RELATIVE_FILES:
            relative = f"tooling/coordination/{name}"
            raw = _authority_git_bytes(candidate_root, "show", f"{candidate_sha}:{relative}")
            target = bundle / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            os.chmod(target, 0o600)
            with target.open("rb") as handle:
                os.fsync(handle.fileno())
        _atomic_write_json(manifest, payload)
        _fsync_dir(bundle)
        _fsync_dir(bundle.parent)
    except Exception:
        shutil.rmtree(bundle, ignore_errors=True)
        raise
    digest = _sha_file(manifest)
    _verify_completion_bundle(bundle, digest)
    return bundle, digest


def _verify_completion_bundle(bundle: Path, expected_manifest_sha: str) -> dict[str, Any]:
    bundle = Path(bundle).resolve()
    manifest = bundle / "manifest.json"
    if (
        not SHA64_RE.fullmatch(str(expected_manifest_sha))
        or not manifest.is_file()
        or _sha_file(manifest) != expected_manifest_sha
    ):
        raise PublicationError("COMPLETION_BUNDLE_MANIFEST_HASH_MISMATCH")
    payload = _load_json(manifest)
    files = payload.get("files")
    if (
        payload.get("kind") != "octoport.task-publication-completion-bundle"
        or payload.get("version") != 1
        or not SHA40_RE.fullmatch(str(payload.get("candidate_sha", "")))
        or not SHA40_RE.fullmatch(str(payload.get("candidate_tree", "")))
        or not isinstance(files, dict)
        or set(files) != set(COMPLETION_BUNDLE_RELATIVE_FILES)
    ):
        raise PublicationError("COMPLETION_BUNDLE_MANIFEST_INVALID")
    if bundle != _completion_bundle_dir(
        _control_root_from_bundle(bundle), payload["candidate_sha"]
    ):
        raise PublicationError("COMPLETION_BUNDLE_PATH_INVALID")
    for name, expected in files.items():
        path = bundle / name
        if (
            not SHA64_RE.fullmatch(str(expected))
            or not path.is_file()
            or _sha_file(path) != expected
        ):
            raise PublicationError(f"COMPLETION_BUNDLE_FILE_HASH_MISMATCH:{name}")
    return payload


def _control_root_from_bundle(bundle: Path) -> Path:
    # .../controllers/task-publication/completion-bundles/<sha>
    try:
        root = bundle.parents[3]
    except IndexError:
        raise PublicationError("COMPLETION_BUNDLE_PATH_INVALID") from None
    if bundle.parent.name != "completion-bundles" or bundle.parent.parent.name != "task-publication":
        raise PublicationError("COMPLETION_BUNDLE_PATH_INVALID")
    return root


def _completion_bundle_descriptor(
    root: Path, reg: dict[str, Any],
) -> tuple[Path, str] | None:
    core = reg.get("core")
    if not isinstance(core, dict):
        return None
    raw_path = core.get("completion_bundle_path")
    raw_sha = core.get("completion_bundle_manifest_sha256")
    if raw_path is None and raw_sha is None:
        return None
    if not isinstance(raw_path, str) or not SHA64_RE.fullmatch(str(raw_sha or "")):
        raise PublicationError("COMPLETION_BUNDLE_DESCRIPTOR_INVALID")
    path = Path(raw_path).resolve()
    expected_path = _completion_bundle_dir(
        Path(root).resolve(), str(core.get("candidate_head", ""))
    ).resolve()
    if path != expected_path:
        raise PublicationError("COMPLETION_BUNDLE_PATH_INVALID")
    payload = _verify_completion_bundle(path, raw_sha)
    if (
        payload.get("candidate_sha") != core.get("candidate_head")
        or payload.get("candidate_tree") != core.get("candidate_tree")
    ):
        raise PublicationError("COMPLETION_BUNDLE_CANDIDATE_BINDING_MISMATCH")
    return path, raw_sha


def _review_identity(root: Path, review_path: str, review_sha: str,
                     task_id: str, candidate: str, candidate_tree: str,
                     base: str, changed_paths: list[str], full_diff_sha: str,
                     manifest_sha: str | None = None, task_fingerprint: str | None = None) -> dict[str, Any]:
    path = _require_control_evidence(root, review_path)
    if _sha_file(path) != review_sha:
        raise PublicationError("REVIEW_HASH_MISMATCH")
    review = _load_json(path)
    required = {
        "kind": "octoport.task-publication-review",
        "version": REVIEW_VERSION,
        "verdict": "PASS",
        "task_id": task_id,
        "candidate_sha": candidate,
        "candidate_tree": candidate_tree,
        "base_sha": base,
        "changed_paths": changed_paths,
        "full_diff_sha256": full_diff_sha,
        "accepted_manifest_sha256": manifest_sha,
        "task_fingerprint": task_fingerprint,
    }
    for key, expected in required.items():
        if review.get(key) != expected:
            raise PublicationError(f"REVIEW_IDENTITY_MISMATCH:{key}")
    if not review.get("reviewer") or not review.get("evidence"):
        raise PublicationError("INDEPENDENT_REVIEW_EVIDENCE_REQUIRED")
    return {"path": str(path), "sha256": review_sha}


def _manifest_entry(root: Path, manifest_path: str | None, manifest_sha: str | None,
                    task_id: str, worktree: Path | None = None) -> dict[str, Any] | None:
    if not manifest_path:
        return None
    path = _require_control_evidence(root, manifest_path)
    if not manifest_sha or _sha_file(path) != manifest_sha:
        raise PublicationError("ACCEPTED_MANIFEST_HASH_MISMATCH")
    manifest = _load_json(path)
    if manifest.get("kind") != "octoport.task-publication-accepted-source-manifest" or manifest.get("version") != 1:
        raise PublicationError("ACCEPTED_MANIFEST_SCHEMA_INVALID")
    entries = manifest.get("accepted")
    if not isinstance(entries, list):
        raise PublicationError("ACCEPTED_MANIFEST_ENTRIES_REQUIRED")
    rows = [row for row in entries if isinstance(row, dict) and row.get("task_id") == task_id]
    if len(rows) != 1:
        raise PublicationError("ACCEPTED_MANIFEST_EXACT_ENTRY_REQUIRED")
    row = dict(rows[0])
    if row.get("eligibility") != "ACCEPTED_SOURCE_EVIDENCE_FOR_FRESH_RECONSTRUCTION":
        raise PublicationError("ACCEPTED_MANIFEST_ENTRY_NOT_ELIGIBLE")
    for key in ("source_base", "source_head", "source_tree"):
        if not SHA40_RE.fullmatch(str(row.get(key, ""))):
            raise PublicationError("ACCEPTED_SOURCE_IDENTITY_REQUIRED:" + key)
    from work_queue import valid_paths
    if (not valid_paths(row.get("exact_task_paths")) or not valid_paths(row.get("changed_paths")) or
            not set(row["changed_paths"]) <= set(row["exact_task_paths"])):
        raise PublicationError("ACCEPTED_SOURCE_PATHS_INVALID")
    if not SHA64_RE.fullmatch(str(row.get("full_binary_diff_sha256", ""))):
        raise PublicationError("ACCEPTED_SOURCE_DIFF_HASH_REQUIRED")
    # Normalize the two existing, frozen A/C provenance schemas explicitly.
    if "preserved_patch_sha256_recorded" in row or "preserved_patch_sha256_readback" in row:
        if row.get("preserved_patch_sha256_recorded") != row.get("preserved_patch_sha256_readback"):
            raise PublicationError("ACCEPTED_PATCH_READBACK_MISMATCH")
        row["preserved_patch_sha256"] = row.get("preserved_patch_sha256_readback")
    patch = _require_control_evidence(root, row.get("preserved_patch_path", ""))
    if _sha_file(patch) != row.get("preserved_patch_sha256"):
        raise PublicationError("ACCEPTED_PATCH_HASH_MISMATCH")
    reviews = row.get("independent_review_evidence")
    if reviews is None and row.get("independent_review_path"):
        reviews = [{"path": row["independent_review_path"], "sha256": row.get("independent_review_sha256")}]
    if not isinstance(reviews, list) or not reviews:
        raise PublicationError("ACCEPTED_REVIEW_REQUIRED")
    for evidence in reviews:
        if not isinstance(evidence, dict):
            raise PublicationError("ACCEPTED_REVIEW_ENTRY_INVALID")
        ep = _require_control_evidence(root, evidence.get("path", ""))
        if _sha_file(ep) != evidence.get("sha256"):
            raise PublicationError("ACCEPTED_REVIEW_HASH_MISMATCH")
    row["independent_review_evidence"] = reviews
    blocker = row.get("blocker_or_preservation_record", row.get("blocker_record"))
    blocker_sha = row.get("blocker_or_preservation_sha256", row.get("blocker_record_sha256"))
    bp = _require_control_evidence(root, blocker or "")
    if _sha_file(bp) != blocker_sha:
        raise PublicationError("ACCEPTED_BLOCKER_HASH_MISMATCH")
    row["blocker_or_preservation_record"] = str(bp)
    row["blocker_or_preservation_sha256"] = blocker_sha
    if worktree is not None:
        if _tree(worktree, row["source_head"]) != row["source_tree"]:
            raise PublicationError("ACCEPTED_SOURCE_TREE_MISMATCH")
        if _commit_parents(worktree, row["source_head"]) != row.get("source_head_parents"):
            raise PublicationError("ACCEPTED_SOURCE_PARENT_MISMATCH")
        if not _merge_base_is_ancestor(worktree, row["source_base"], row["source_head"]):
            raise PublicationError("ACCEPTED_SOURCE_ANCESTRY_MISMATCH")
        chain = _git_lines(worktree, "rev-list", "--reverse", f"{row['source_base']}..{row['source_head']}")
        if chain != row.get("ordered_source_chain"):
            raise PublicationError("ACCEPTED_SOURCE_CHAIN_MISMATCH")
        if _diff_paths(worktree, row["source_base"], row["source_head"]) != sorted(row["changed_paths"]):
            raise PublicationError("ACCEPTED_SOURCE_CHANGED_PATHS_MISMATCH")
        if _full_diff_sha(worktree, row["source_base"], row["source_head"]) != row["full_binary_diff_sha256"]:
            raise PublicationError("ACCEPTED_SOURCE_DIFF_MISMATCH")
    return {"path": str(path), "sha256": manifest_sha, "entry": row}


def _check_reconstruction_base(row: dict[str, Any], worktree: Path, base: str) -> None:
    if row.get("same_path_drift_to_manifest_main") is True:
        raise PublicationError("RECONSTRUCTION_SOURCE_PATH_DRIFT")
    # Older A manifests lack the boolean: prove drift from actual Git objects,
    # including changes since the manifest was made, rather than trusting absence.
    drift = set(_diff_paths(worktree, row["source_base"], base)) & set(row["changed_paths"])
    if drift:
        raise PublicationError("RECONSTRUCTION_SOURCE_PATH_DRIFT:" + ",".join(sorted(drift)))


def unblock_from_manifest(root: Path, role: str, task_id: str, manifest_path: str,
                          manifest_sha: str, worktree: Path) -> dict[str, Any]:
    from work_queue import advance_task
    with _role_and_coord_locks(root, role):
        _require_role_running(root, role)
        manifest = _manifest_entry(root, manifest_path, manifest_sha, task_id, worktree)
        board = _load_board(root)
        from work_queue import task_view
        route = _task_from_board(board, "CONTROLLER-TASK-PUBLICATION-ROUTE")
        if task_view(board, route)["state"] != "DONE":
            raise PublicationError("PUBLICATION_ROUTE_NOT_ACCEPTED")
        task = _task_from_board(board, task_id)
        if task.get("role") != role or task.get("state") != "BLOCKED":
            raise PublicationError("UNBLOCK_BLOCKED_ROLE_REQUIRED")
        row = manifest["entry"]
        blocker = _require_control_evidence(root, task.get("blocked_receipt", ""))
        if (str(blocker) != row["blocker_or_preservation_record"] or
                _sha_file(blocker) != row["blocker_or_preservation_sha256"] or
                "CONTROLLER-TASK-PUBLICATION-ROUTE" not in str(task.get("blocked_reason", ""))):
            raise PublicationError("UNBLOCK_PUBLICATION_BLOCKER_REQUIRED")
        if sorted(task["paths"]) != sorted(row["exact_task_paths"]):
            raise PublicationError("UNBLOCK_TASK_PATHS_DRIFT")
        proof = {"kind": "octoport.task-publication-unblock", "version": 1,
            "task_id": task_id, "role": role, "prior_task": task,
            "prior_task_fingerprint": _task_fingerprint(task),
            "prior_board_revision": board["revision"],
            "prior_board_sha256": _sha_file(root / "controllers/work-board.json"),
            "manifest": {"path": manifest_path, "sha256": manifest_sha},
            "source_head": row["source_head"], "blocker_sha256": _sha_file(blocker),
            "reason": "PUBLICATION_ROUTE_AVAILABLE"}
        receipt = _root_dir(root) / "unblocks" / (_sha_bytes(_canonical_bytes(proof)) + ".json")
        if receipt.exists():
            if _load_json(receipt) != proof:
                raise PublicationError("UNBLOCK_RECEIPT_DRIFT")
        else:
            _create_once_json(receipt, proof)
    # Normal writer rechecks the exact prior task under its own writer locks.
    advance_task(root, role, task_id, "IN_PROGRESS", receipt=str(receipt), expected_task=task)
    with _role_and_coord_locks(root, role):
        after = _task_from_board(_load_board(root), task_id)
        if after.get("state") != "IN_PROGRESS" or after.get("blocked_reason") or after.get("blocked_receipt"):
            raise PublicationError("UNBLOCK_READBACK_FAILED")
        if after.get("unblock_receipt") != str(receipt):
            raise PublicationError("UNBLOCK_RECEIPT_READBACK_FAILED")
        for key in ("role", "claimed_at", "requires", "paths", "result"):
            if after.get(key) != task.get(key):
                raise PublicationError("UNBLOCK_TASK_IDENTITY_DRIFT")
        return {"receipt": str(receipt), "receipt_sha256": _sha_file(receipt),
                "task_fingerprint": _task_fingerprint(after)}


def reconstruct_from_manifest(root: Path, manifest_path: str, manifest_sha: str, task_id: str,
                              worktree: Path, base: str, message: str) -> dict[str, Any]:
    manifest = _manifest_entry(root, manifest_path, manifest_sha, task_id, worktree)
    assert manifest is not None
    row = manifest["entry"]
    worktree = worktree.resolve()
    if not worktree.is_dir() or not _clean(worktree):
        raise PublicationError("RECONSTRUCTION_WORKTREE_CLEAN_REQUIRED")
    if _head(worktree) != base:
        raise PublicationError("RECONSTRUCTION_BASE_HEAD_REQUIRED")
    _check_reconstruction_base(row, worktree, base)
    patch = Path(row["preserved_patch_path"]).resolve()
    if _sha_file(patch) != row["preserved_patch_sha256"]:
        raise PublicationError("RECONSTRUCTION_PATCH_HASH_MISMATCH")
    proc = subprocess.run(
        ["git", "-C", str(worktree), "apply", "--index", "--3way", str(patch)],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode:
        raise PublicationError(f"RECONSTRUCTION_PATCH_APPLY_FAILED:{proc.stderr.strip()}")
    changed = sorted(_git_lines(worktree, "diff", "--cached", "--name-only"))
    if changed != sorted(row.get("changed_paths", [])):
        raise PublicationError("RECONSTRUCTION_CHANGED_PATHS_MISMATCH")
    for path in changed:
        staged = _git(worktree, "ls-files", "--stage", "--", path).split()
        source = _git(worktree, "ls-tree", row["source_head"], "--", path).split()
        if (staged[:2] if staged else []) != ([source[0], source[2]] if source else []):
            raise PublicationError("RECONSTRUCTION_CONTENT_MISMATCH:" + path)
    proc = subprocess.run(
        ["git", "-C", str(worktree), "commit", "-m", message],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    if proc.returncode:
        raise PublicationError(f"RECONSTRUCTION_COMMIT_FAILED:{proc.stderr.strip()}")
    candidate = _head(worktree)
    parents = _commit_parents(worktree, candidate)
    if parents != [base]:
        raise PublicationError("RECONSTRUCTION_SINGLE_PARENT_REQUIRED")
    return {
        "task_id": task_id,
        "base": base,
        "candidate_head": candidate,
        "candidate_tree": _tree(worktree),
        "changed_paths": _diff_paths(worktree, base, candidate),
        "full_diff_sha256": _full_diff_sha(worktree, base, candidate),
        "manifest_sha256": manifest_sha,
        "source_head": row.get("source_head"),
    }


def _registration_request_identity(reg: dict[str, Any]) -> dict[str, Any]:
    core = reg["core"]
    return {
        "role": core["role"],
        "task_id": core["task_id"],
        "worktree_path": core["worktree_path"],
        "candidate_head": core["candidate_head"],
        "candidate_tree": core["candidate_tree"],
        "base_sha": core["base_sha"],
        "task_paths": core["task_paths"],
        "changed_paths": core["changed_paths"],
        "task_fingerprint": core["task_fingerprint"],
        "review": core["review"],
        "accepted_manifest": core.get("accepted_manifest"),
        "route_source_sha": core["route_source_sha"],
        "route_source_tree": core["route_source_tree"],
        "completion_bundle_path": core.get("completion_bundle_path"),
        "completion_bundle_manifest_sha256": core.get("completion_bundle_manifest_sha256"),
        "remote": core["remote"],
        "pushurl_override": core.get("pushurl_override"),
    }


def _register_candidate_locked(
    root: Path,
    role: str,
    task_id: str,
    worktree: Path,
    base: str,
    review_path: str,
    review_sha: str,
    route_source_root: Path,
    route_source_sha: str,
    route_source_tree: str,
    remote: str = "origin",
    pushurl: str | None = None,
    manifest_path: str | None = None,
    manifest_sha: str | None = None,
) -> dict[str, Any]:
    root = root.resolve()
    worktree = worktree.resolve()
    route_source_root = route_source_root.resolve()
    if role not in {"A", "B", "C"}:
        raise PublicationError("ROLE_INVALID")
    _require_role_running(root, role)
    board = _load_board(root)
    task = _task_from_board(board, task_id)
    if task.get("role") != role or task.get("state") != "IN_PROGRESS":
        raise PublicationError("TASK_IN_PROGRESS_ROLE_REQUIRED")
    task_paths = task.get("paths")
    if not isinstance(task_paths, list) or not task_paths:
        raise PublicationError("TASK_PATHS_REQUIRED")
    if not _clean(worktree):
        raise PublicationError("CANDIDATE_WORKTREE_CLEAN_REQUIRED")
    candidate = _head(worktree)
    candidate_tree = _tree(worktree)
    ownership, ownership_sha = _ownership_at_commit(worktree, candidate)
    fixed_path = Path(ownership["roles"][role]["path"]).resolve()
    if worktree == fixed_path:
        raise PublicationError("ISOLATED_WORKTREE_REQUIRED")
    if not SHA40_RE.fullmatch(base):
        raise PublicationError("BASE_SHA_REQUIRED")
    parents = _commit_parents(worktree, candidate)
    if parents != [base]:
        raise PublicationError("FRESH_SINGLE_PARENT_CANDIDATE_REQUIRED")
    if not _merge_base_is_ancestor(worktree, base, candidate):
        raise PublicationError("BASE_NOT_ANCESTOR")
    local_main = _git(worktree, "rev-parse", "refs/remotes/origin/main")
    if local_main != base:
        raise PublicationError("FRESH_ORIGIN_MAIN_BASE_REQUIRED")
    changed = _diff_paths(worktree, base, candidate)
    if not changed or any(path not in task_paths for path in changed):
        raise PublicationError("TASK_CHANGED_PATH_SCOPE_INVALID")
    if any(not _path_owned(path, role, ownership) for path in changed):
        raise PublicationError("OWNERSHIP_SCOPE_INVALID")
    full_diff_sha = _full_diff_sha(worktree, base, candidate)
    accepted_manifest = _manifest_entry(root, manifest_path, manifest_sha, task_id, worktree)
    if task_id != "CONTROLLER-TASK-PUBLICATION-ROUTE" and accepted_manifest is None:
        raise PublicationError("ACCEPTED_SOURCE_MANIFEST_REQUIRED")
    if accepted_manifest is not None:
        expected_paths = sorted(accepted_manifest["entry"].get("exact_task_paths", []))
        if sorted(task_paths) != expected_paths:
            raise PublicationError("ACCEPTED_MANIFEST_TASK_PATHS_DRIFT")
        row = accepted_manifest["entry"]
        _check_reconstruction_base(row, worktree, base)
        if changed != sorted(row["changed_paths"]):
            raise PublicationError("ACCEPTED_CANDIDATE_PATHS_MISMATCH")
        for path in changed:
            if _git(worktree, "ls-tree", candidate, "--", path) != _git(worktree, "ls-tree", row["source_head"], "--", path):
                raise PublicationError("ACCEPTED_CANDIDATE_CONTENT_MISMATCH:" + path)
    review = _review_identity(root, review_path, review_sha, task_id, candidate, candidate_tree,
        base, changed, full_diff_sha, manifest_sha, _task_fingerprint(task))
    bundle, bundle_manifest_sha = _install_bundle(
        root, route_source_root, route_source_sha, route_source_tree
    )
    completion_bundle, completion_bundle_manifest_sha = _install_completion_bundle(
        root, worktree, candidate, candidate_tree
    )
    # Current worktreeConfig capability is a prerequisite for isolated config.
    if _git(worktree, "config", "--get", "extensions.worktreeConfig", check=False).strip().lower() not in {"true", "1", "yes", "on"}:
        raise PublicationError("WORKTREE_CONFIG_EXTENSION_REQUIRED")

    pointer_path = _active_pointer_path(root, worktree)
    task_fingerprint = _task_fingerprint(task)
    request_identity = {
        "role": role,
        "task_id": task_id,
        "worktree_path": str(worktree),
        "candidate_head": candidate,
        "candidate_tree": candidate_tree,
        "base_sha": base,
        "task_paths": task_paths,
        "changed_paths": changed,
        "task_fingerprint": task_fingerprint,
        "review": review,
        "accepted_manifest": {
            "path": accepted_manifest["path"],
            "sha256": accepted_manifest["sha256"],
            "source_head": accepted_manifest["entry"].get("source_head"),
            "preserved_patch_sha256": accepted_manifest["entry"].get("preserved_patch_sha256"),
        } if accepted_manifest else None,
        "route_source_sha": route_source_sha,
        "route_source_tree": route_source_tree,
        "completion_bundle_path": str(completion_bundle),
        "completion_bundle_manifest_sha256": completion_bundle_manifest_sha,
        "remote": remote,
        "pushurl_override": pushurl,
    }
    if pointer_path.exists():
        pointer = _load_json(pointer_path)
        existing, _ = _read_registration(root, pointer.get("registration_id", ""))
        if existing.get("state") in OPEN_STATES and _registration_request_identity(existing) == request_identity:
            _verify_bundle(Path(existing["core"]["bundle_path"]), existing["core"]["bundle_manifest_sha256"])
            descriptor = _completion_bundle_descriptor(root, existing)
            if descriptor is None:
                raise PublicationError("COMPLETION_BUNDLE_DESCRIPTOR_REQUIRED")
            return existing
        raise PublicationError("WORKTREE_ALREADY_HAS_ACTIVE_REGISTRATION")

    from work_queue import validate_task_scope, task_view
    validate_task_scope(root, role, changed)
    if task_view(board, task)["waiting_for"]:
        raise PublicationError("TASK_DEPENDENCY_PENDING")
    push_targets = [pushurl] if pushurl is not None else _git_lines(worktree, "remote", "get-url", "--push", "--all", remote)
    if len(push_targets) != 1 or not push_targets[0]:
        raise PublicationError("SINGLE_PUSH_TARGET_REQUIRED")

    generation = secrets.token_hex(12)
    branch = f"controller/task-publication/{role.lower()}/{_safe_slug(task_id)}/{generation}"
    task_ref = f"refs/heads/{branch}"
    prior_config = _route_config_snapshot(worktree, remote)
    ownership_fixed_config = _fixed_role_config_digests(ownership)
    common_config_sha = _common_config_digest(worktree)
    global_config_sha = _global_config_digest()
    core = dict(
        request_identity,
        full_diff_sha256=full_diff_sha,
        generation=generation,
        task_branch=branch,
        task_ref=task_ref,
        publication_commit_parent=base,
        publication_commit_diff_sha256=_patch_sha(worktree, base, candidate),
        commit_chain=[candidate],
        ownership_policy_sha256=ownership_sha,
        bundle_path=str(bundle),
        bundle_manifest_sha256=bundle_manifest_sha,
        prior_config=prior_config,
        common_config_sha256=common_config_sha,
        global_config_sha256=global_config_sha,
        fixed_role_config_sha256=ownership_fixed_config,
        registered_board_revision=board.get("revision"),
        registered_board_sha256=_sha_file(root / "controllers/work-board.json"),
        push_target=push_targets[0],
    )
    registration_id = _sha_bytes(_canonical_bytes(core))
    reg = {
        "kind": "octoport.task-publication-registration",
        "version": REGISTRATION_VERSION,
        "registration_id": registration_id,
        "registration_sha256": registration_id,
        "core": core,
        "state": "REGISTERED",
        "state_version": 1,
        "previous_state_sha256": None,
        "current_nonce": None,
        "ready_receipt": None,
        "task_ref_cleanup_status": None,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    reg_path = _registration_path(root, registration_id)
    _persist_registration(root, reg)
    pointer = {
        "kind": "octoport.task-publication-active",
        "version": 1,
        "registration_id": registration_id,
        "registration_sha256": registration_id,
        "worktree_path": str(worktree),
        "generation": generation,
    }
    _create_once_json(pointer_path, pointer)

    # Install exact route-owned worktree-local config only after immutable registration exists.
    installed_hooks = {"present": True, "values": [str(bundle / "hooks")]}
    _set_config_values(worktree, "core.hooksPath", installed_hooks)
    installed_pushurl = prior_config[f"remote.{remote}.pushurl"]
    owned_keys = ["core.hooksPath"]
    if pushurl is not None:
        installed_pushurl = {"present": True, "values": [pushurl]}
        _set_config_values(worktree, f"remote.{remote}.pushurl", installed_pushurl)
        owned_keys.append(f"remote.{remote}.pushurl")
    installed = {
        "core.hooksPath": installed_hooks,
        f"remote.{remote}.pushurl": installed_pushurl,
        "owned_keys": owned_keys,
    }
    reg, old_hash = _read_registration(root, registration_id)
    updated = dict(reg)
    updated["previous_state_sha256"] = old_hash
    updated["state_version"] = 2
    updated["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    updated["installed_config"] = installed
    _persist_registration(root, updated)
    _append_event(root, registration_id, {
        "kind": "REGISTERED",
        "state": "REGISTERED",
        "version": 2,
        "candidate": candidate,
        "task_ref": task_ref,
        "bundle_manifest_sha256": bundle_manifest_sha,
    })
    return updated


def register_candidate(root: Path, role: str, *args, **kwargs) -> dict[str, Any]:
    with _role_and_coord_locks(root, role):
        return _register_candidate_locked(root, role, *args, **kwargs)


def _validate_registration_identity(root: Path, reg: dict[str, Any], *, require_clean: bool = True,
                                    require_remote_base: bool = False,
                                    require_task_ref: bool = False) -> dict[str, Any]:
    core = reg.get("core", {})
    registration_id = reg.get("registration_id")
    if not registration_id or reg.get("registration_sha256") != registration_id:
        raise PublicationError("REGISTRATION_IDENTITY_INVALID")
    if _sha_bytes(_canonical_bytes(core)) != registration_id:
        raise PublicationError("REGISTRATION_CORE_HASH_MISMATCH")
    role = core["role"]
    _require_role_running(root, role)
    board = _load_board(root)
    task = _task_from_board(board, core["task_id"])
    if task.get("role") != role or task.get("state") != "IN_PROGRESS":
        raise PublicationError("TASK_STATE_DRIFT")
    if _task_fingerprint(task) != core["task_fingerprint"]:
        raise PublicationError("TASK_FINGERPRINT_DRIFT")
    worktree = Path(core["worktree_path"]).resolve()
    pointer = _load_json(_active_pointer_path(root, worktree))
    if pointer.get("registration_id") != registration_id or pointer.get("registration_sha256") != registration_id:
        raise PublicationError("ACTIVE_POINTER_DRIFT")
    if pointer.get("worktree_path") != str(worktree) or pointer.get("generation") != core["generation"]:
        raise PublicationError("ACTIVE_POINTER_DRIFT")
    if require_clean and not _clean(worktree):
        raise PublicationError("WORKTREE_DIRTY")
    if _head(worktree) != core["candidate_head"] or _tree(worktree) != core["candidate_tree"]:
        raise PublicationError("CANDIDATE_IDENTITY_DRIFT")
    if _commit_parents(worktree, core["candidate_head"]) != [core["base_sha"]]:
        raise PublicationError("CANDIDATE_PARENT_DRIFT")
    changed = _diff_paths(worktree, core["base_sha"], core["candidate_head"])
    if changed != core["changed_paths"]:
        raise PublicationError("CHANGED_PATHS_DRIFT")
    if _full_diff_sha(worktree, core["base_sha"], core["candidate_head"]) != core["full_diff_sha256"]:
        raise PublicationError("FULL_DIFF_HASH_DRIFT")
    if _patch_sha(worktree, core["base_sha"], core["candidate_head"]) != core["publication_commit_diff_sha256"]:
        raise PublicationError("PUBLICATION_COMMIT_DIFF_DRIFT")
    ownership, ownership_sha = _ownership(worktree)
    if ownership_sha != core["ownership_policy_sha256"]:
        raise PublicationError("OWNERSHIP_POLICY_DRIFT")
    if any(not _path_owned(path, role, ownership) for path in changed):
        raise PublicationError("OWNERSHIP_SCOPE_DRIFT")
    from work_queue import validate_task_scope, task_view
    validate_task_scope(root, role, changed)
    if task_view(board, task)["waiting_for"]:
        raise PublicationError("TASK_DEPENDENCY_PENDING")
    review = core["review"]
    _review_identity(
        root, review["path"], review["sha256"], core["task_id"], core["candidate_head"],
        core["candidate_tree"], core["base_sha"], core["changed_paths"], core["full_diff_sha256"]
        , (core.get("accepted_manifest") or {}).get("sha256"), core["task_fingerprint"]
    )
    accepted = core.get("accepted_manifest")
    if accepted:
        manifest = _manifest_entry(root, accepted["path"], accepted["sha256"], core["task_id"], worktree)
        if manifest is None or manifest["entry"].get("source_head") != accepted.get("source_head"):
            raise PublicationError("ACCEPTED_MANIFEST_DRIFT")
        if manifest["entry"].get("preserved_patch_sha256") != accepted.get("preserved_patch_sha256"):
            raise PublicationError("ACCEPTED_PATCH_IDENTITY_DRIFT")
    bundle = Path(core["bundle_path"])
    _verify_bundle(bundle, core["bundle_manifest_sha256"])
    if _config_values(worktree, "core.hooksPath") != reg.get("installed_config", {}).get("core.hooksPath"):
        raise PublicationError("HOOKS_PATH_DRIFT")
    push_key = f"remote.{core['remote']}.pushurl"
    installed = reg.get("installed_config", {})
    if push_key in installed and _config_values(worktree, push_key) != installed[push_key]:
        raise PublicationError("PUSHURL_DRIFT")
    if _git_lines(worktree, "remote", "get-url", "--push", "--all", core["remote"]) != [core["push_target"]]:
        raise PublicationError("PUSH_TARGET_DRIFT")
    if require_remote_base and _remote_oid(worktree, core["remote"], "refs/heads/main") != core["base_sha"]:
        raise PublicationError("REMOTE_MAIN_BASE_DRIFT")
    if require_task_ref and _remote_oid(worktree, core["remote"], core["task_ref"]) != core["candidate_head"]:
        raise PublicationError("REMOTE_TASK_REF_DRIFT")
    return task


def _validate_supersede_registration_core_identity(
    root: Path, reg: dict[str, Any], *, require_clean: bool = True,
) -> dict[str, Any]:
    """Validate supersede identity except the mutable review evidence path bytes."""
    core = reg.get("core", {})
    registration_id = reg.get("registration_id")
    if not registration_id or reg.get("registration_sha256") != registration_id:
        raise PublicationError("REGISTRATION_IDENTITY_INVALID")
    if _sha_bytes(_canonical_bytes(core)) != registration_id:
        raise PublicationError("REGISTRATION_CORE_HASH_MISMATCH")
    worktree = Path(core["worktree_path"]).resolve()
    pointer = _load_json(_active_pointer_path(root, worktree))
    if pointer.get("registration_id") != registration_id or pointer.get("registration_sha256") != registration_id:
        raise PublicationError("ACTIVE_POINTER_DRIFT")
    if pointer.get("worktree_path") != str(worktree) or pointer.get("generation") != core["generation"]:
        raise PublicationError("ACTIVE_POINTER_DRIFT")
    if require_clean and not _clean(worktree):
        raise PublicationError("WORKTREE_DIRTY")
    if _head(worktree) != core["candidate_head"] or _tree(worktree) != core["candidate_tree"]:
        raise PublicationError("CANDIDATE_IDENTITY_DRIFT")
    if _commit_parents(worktree, core["candidate_head"]) != [core["base_sha"]]:
        raise PublicationError("CANDIDATE_PARENT_DRIFT")
    changed = _diff_paths(worktree, core["base_sha"], core["candidate_head"])
    if changed != core["changed_paths"]:
        raise PublicationError("CHANGED_PATHS_DRIFT")
    if _full_diff_sha(worktree, core["base_sha"], core["candidate_head"]) != core["full_diff_sha256"]:
        raise PublicationError("FULL_DIFF_HASH_DRIFT")
    if _patch_sha(worktree, core["base_sha"], core["candidate_head"]) != core["publication_commit_diff_sha256"]:
        raise PublicationError("PUBLICATION_COMMIT_DIFF_DRIFT")
    ownership, ownership_sha = _ownership(worktree)
    if ownership_sha != core["ownership_policy_sha256"]:
        raise PublicationError("OWNERSHIP_POLICY_DRIFT")
    if any(not _path_owned(path, core["role"], ownership) for path in changed):
        raise PublicationError("OWNERSHIP_SCOPE_DRIFT")
    accepted = core.get("accepted_manifest")
    if accepted:
        manifest = _manifest_entry(root, accepted["path"], accepted["sha256"], core["task_id"], worktree)
        if manifest is None or manifest["entry"].get("source_head") != accepted.get("source_head"):
            raise PublicationError("ACCEPTED_MANIFEST_DRIFT")
        if manifest["entry"].get("preserved_patch_sha256") != accepted.get("preserved_patch_sha256"):
            raise PublicationError("ACCEPTED_PATCH_IDENTITY_DRIFT")
    _verify_bundle(Path(core["bundle_path"]), core["bundle_manifest_sha256"])
    return {"worktree": worktree, "changed_paths": changed}


def _validate_supersede_registration_identity(
    root: Path, reg: dict[str, Any], *, require_clean: bool = True,
) -> dict[str, Any]:
    """Validate immutable registration/candidate identity and original review evidence."""
    result = _validate_supersede_registration_core_identity(root, reg, require_clean=require_clean)
    core = reg["core"]
    review = core["review"]
    _review_identity(
        root, review["path"], review["sha256"], core["task_id"], core["candidate_head"],
        core["candidate_tree"], core["base_sha"], core["changed_paths"], core["full_diff_sha256"],
        (core.get("accepted_manifest") or {}).get("sha256"), core["task_fingerprint"],
    )
    return result


def _validate_supersede_supporting_evidence(root: Path, value: dict[str, Any]) -> list[dict[str, str]]:
    evidence = value.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise PublicationError("SUPERSEDE_SUPPORTING_EVIDENCE_REQUIRED")
    normalized = []
    for item in evidence:
        if not isinstance(item, dict) or set(item) != {"path", "sha256"}:
            raise PublicationError("SUPERSEDE_SUPPORTING_EVIDENCE_INVALID")
        ep = _require_control_evidence(root, item.get("path", ""))
        sha = item.get("sha256")
        if not SHA64_RE.fullmatch(str(sha or "")) or _sha_file(ep) != sha:
            raise PublicationError("SUPERSEDE_SUPPORTING_EVIDENCE_HASH_MISMATCH")
        normalized.append({"path": str(ep), "sha256": sha})
    return normalized


def _validate_supersede_evidence(
    root: Path, reg: dict[str, Any], evidence_path: str | os.PathLike[str], evidence_sha: str,
) -> dict[str, Any]:
    path = _require_control_evidence(root, evidence_path)
    if not SHA64_RE.fullmatch(str(evidence_sha)) or _sha_file(path) != evidence_sha:
        raise PublicationError("SUPERSEDE_EVIDENCE_HASH_MISMATCH")
    value = _load_json(path)
    core = reg["core"]
    required = {
        "kind": "octoport.task-publication-supersede-evidence",
        "version": 1,
        "registration_id": reg["registration_id"],
        "task_id": core["task_id"],
        "candidate_sha": core["candidate_head"],
        "candidate_tree": core["candidate_tree"],
        "task_ref": core["task_ref"],
    }
    for key, expected in required.items():
        if value.get(key) != expected:
            raise PublicationError(f"SUPERSEDE_EVIDENCE_IDENTITY_MISMATCH:{key}")
    verdict = value.get("verdict")
    if verdict not in {"FAIL", "REWORK_REQUIRED", "SUPERSEDED"}:
        raise PublicationError("SUPERSEDE_EVIDENCE_VERDICT_REQUIRED")
    if not isinstance(value.get("reason"), str) or not value["reason"].strip():
        raise PublicationError("SUPERSEDE_EVIDENCE_REASON_REQUIRED")
    successor = value.get("successor_sha")
    if verdict == "SUPERSEDED":
        if not SHA40_RE.fullmatch(str(successor or "")) or successor == core["candidate_head"]:
            raise PublicationError("SUPERSEDE_SUCCESSOR_IDENTITY_REQUIRED")
    elif successor is not None and not SHA40_RE.fullmatch(str(successor)):
        raise PublicationError("SUPERSEDE_SUCCESSOR_IDENTITY_INVALID")
    normalized = _validate_supersede_supporting_evidence(root, value)
    return {
        "path": str(path), "sha256": evidence_sha, "verdict": verdict,
        "reason": value["reason"].strip(), "successor_sha": successor,
        "evidence": normalized,
    }


def _validate_review_drift_supersede_evidence(
    root: Path, reg: dict[str, Any], evidence_path: str | os.PathLike[str], evidence_sha: str,
    *, require_blocked_task: bool = True,
) -> dict[str, Any]:
    path = _require_control_evidence(root, evidence_path)
    if not SHA64_RE.fullmatch(str(evidence_sha)) or _sha_file(path) != evidence_sha:
        raise PublicationError("SUPERSEDE_EVIDENCE_HASH_MISMATCH")
    value = _load_json(path)
    core = reg["core"]
    required = {
        "kind": "octoport.task-publication-review-drift-retirement-evidence",
        "version": 1,
        "registration_id": reg["registration_id"],
        "task_id": core["task_id"],
        "candidate_sha": core["candidate_head"],
        "candidate_tree": core["candidate_tree"],
        "task_ref": core["task_ref"],
        "classification": "EVIDENCE_PATH_BYTES_DRIFT_AFTER_TASK_REF_PUBLICATION",
    }
    expected_keys = set(required) | {
        "expected_review",
        "observed_review_sha256",
        "reason",
        "successor_sha",
        "evidence",
    }
    if set(value) != expected_keys:
        raise PublicationError("REVIEW_DRIFT_EVIDENCE_SCHEMA_INVALID")
    if type(value.get("version")) is not int:
        raise PublicationError("REVIEW_DRIFT_EVIDENCE_VERSION_INVALID")
    for key, expected in required.items():
        if value.get(key) != expected:
            raise PublicationError(f"REVIEW_DRIFT_EVIDENCE_IDENTITY_MISMATCH:{key}")
    expected_review = value.get("expected_review")
    if expected_review != core.get("review"):
        raise PublicationError("REVIEW_DRIFT_EXPECTED_REVIEW_MISMATCH")
    observed = value.get("observed_review_sha256")
    if not SHA64_RE.fullmatch(str(observed or "")):
        raise PublicationError("REVIEW_DRIFT_OBSERVED_HASH_REQUIRED")
    review_path = _require_control_evidence(root, core["review"]["path"])
    actual = _sha_file(review_path)
    if actual != observed:
        raise PublicationError("REVIEW_DRIFT_OBSERVED_HASH_MISMATCH")
    if actual == core["review"]["sha256"]:
        raise PublicationError("REVIEW_DRIFT_NOT_PRESENT")
    if not isinstance(value.get("reason"), str) or not value["reason"].strip():
        raise PublicationError("SUPERSEDE_EVIDENCE_REASON_REQUIRED")
    successor = value.get("successor_sha")
    if successor is not None:
        if not SHA40_RE.fullmatch(str(successor)) or successor == core["candidate_head"]:
            raise PublicationError("REVIEW_DRIFT_SUCCESSOR_IDENTITY_INVALID")
    if require_blocked_task:
        board = _load_board(root)
        task = _task_from_board(board, core["task_id"])
        if task.get("role") != core["role"] or task.get("state") != "BLOCKED":
            raise PublicationError("REVIEW_DRIFT_TASK_MUST_BE_BLOCKED")
    normalized = _validate_supersede_supporting_evidence(root, value)
    return {
        "path": str(path), "sha256": evidence_sha, "verdict": "REWORK_REQUIRED",
        "reason": value["reason"].strip(), "successor_sha": successor,
        "evidence": normalized, "review_drift_retirement": True,
        "expected_review": dict(core["review"]), "observed_review_sha256": observed,
        "classification": required["classification"],
    }


def _validate_supersede_evidence_by_kind(
    root: Path, reg: dict[str, Any], evidence_path: str | os.PathLike[str], evidence_sha: str,
    *, require_blocked_task: bool = True,
) -> dict[str, Any]:
    path = _require_control_evidence(root, evidence_path)
    if not SHA64_RE.fullmatch(str(evidence_sha)) or _sha_file(path) != evidence_sha:
        raise PublicationError("SUPERSEDE_EVIDENCE_HASH_MISMATCH")
    kind = _load_json(path).get("kind")
    if kind == "octoport.task-publication-supersede-evidence":
        return _validate_supersede_evidence(root, reg, path, evidence_sha)
    if kind == "octoport.task-publication-review-drift-retirement-evidence":
        return _validate_review_drift_supersede_evidence(
            root, reg, path, evidence_sha, require_blocked_task=require_blocked_task
        )
    raise PublicationError("SUPERSEDE_EVIDENCE_KIND_INVALID")


def _validate_supersede_request(
    root: Path, reg: dict[str, Any], evidence_path: str | os.PathLike[str], evidence_sha: str,
    *, require_clean: bool = True,
) -> dict[str, Any]:
    path = _require_control_evidence(root, evidence_path)
    if not SHA64_RE.fullmatch(str(evidence_sha)) or _sha_file(path) != evidence_sha:
        raise PublicationError("SUPERSEDE_EVIDENCE_HASH_MISMATCH")
    kind = _load_json(path).get("kind")
    if kind == "octoport.task-publication-supersede-evidence":
        _validate_supersede_registration_identity(root, reg, require_clean=require_clean)
    elif kind == "octoport.task-publication-review-drift-retirement-evidence":
        _validate_supersede_registration_core_identity(root, reg, require_clean=require_clean)
        # Review-drift recovery deliberately skips only the mutated review bytes.
        # Route/common/global/fixed-role config must still match the immutable
        # registration before any task-ref retirement can be prepared.
        _validate_ready_retirement_config(reg)
    else:
        raise PublicationError("SUPERSEDE_EVIDENCE_KIND_INVALID")
    return _validate_supersede_evidence_by_kind(root, reg, path, evidence_sha)

def _role_and_coord_locks(root: Path, role: str):
    class Locks:
        def __enter__(self):
            self.role_file = (root / f"{role}.lock").open("a+")
            fcntl.flock(self.role_file, fcntl.LOCK_EX)
            self.coord_file = (root / "controllers/coordination.lock").open("a+")
            fcntl.flock(self.coord_file, fcntl.LOCK_EX)
            return self
        def release_coord(self):
            if getattr(self, "coord_file", None):
                fcntl.flock(self.coord_file, fcntl.LOCK_UN)
                self.coord_file.close()
                self.coord_file = None
        def reacquire_coord(self):
            if getattr(self, "coord_file", None) is None:
                self.coord_file = (root / "controllers/coordination.lock").open("a+")
                fcntl.flock(self.coord_file, fcntl.LOCK_EX)
        def __exit__(self, exc_type, exc, tb):
            if getattr(self, "coord_file", None):
                fcntl.flock(self.coord_file, fcntl.LOCK_UN)
                self.coord_file.close()
            fcntl.flock(self.role_file, fcntl.LOCK_UN)
            self.role_file.close()
    return Locks()


def _rename_noreplace(source: Path, target: Path) -> bool:
    target.parent.mkdir(parents=True, exist_ok=True)
    libc = ctypes.CDLL(None, use_errno=True)
    fn = getattr(libc, "renameat2", None)
    if fn is None:
        raise PublicationError("ATOMIC_NOREPLACE_UNAVAILABLE")
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    result = fn(
        -100, os.fsencode(source), -100, os.fsencode(target), 1  # RENAME_NOREPLACE
    )
    if result == 0:
        _fsync_dir(source.parent)
        _fsync_dir(target.parent)
        return True
    code = ctypes.get_errno()
    if code in {errno.ENOENT, errno.EEXIST}:
        return False
    raise PublicationError(f"ATOMIC_NOREPLACE_FAILED:{code}")


def _lease_namespace(root: Path, registration_id: str, nonce: str) -> tuple[str | None, Path | None]:
    found = []
    for namespace in ("armed", "consumed", "cancelled"):
        path = _lease_path(root, registration_id, namespace, nonce)
        if path.is_file():
            found.append((namespace, path))
    if len(found) > 1:
        raise PublicationError("LEASE_NAMESPACE_DUPLICATE")
    return found[0] if found else (None, None)


def _new_lease(reg: dict[str, Any], push_kind: str, expected_old: str, remote_ref: str,
               target_oid: str, ttl_seconds: int) -> dict[str, Any]:
    if push_kind not in TRANSIENT_STATES:
        raise PublicationError("PUSH_KIND_INVALID")
    now = _boottime_ns()
    nonce = secrets.token_hex(16)
    return {
        "kind": "octoport.task-publication-lease",
        "version": LEASE_VERSION,
        "registration_id": reg["registration_id"],
        "registration_sha256": reg["registration_sha256"],
        "registration_state_version_at_attempt": reg["state_version"] + 1,
        "nonce": nonce,
        "push_kind": push_kind,
        "remote_ref": remote_ref,
        "expected_remote_old_oid": expected_old,
        "target_oid": target_oid,
        "boot_id": _boot_id(),
        "issued_boottime_ns": now,
        "deadline_boottime_ns": now + int(ttl_seconds * 1_000_000_000),
        "issued_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "bundle_manifest_sha256": reg["core"]["bundle_manifest_sha256"],
        "task_fingerprint": reg["core"]["task_fingerprint"],
    }


def _lease_sha(path: Path) -> str:
    return _sha_file(path)


def _validate_lease_time(lease: dict[str, Any]) -> None:
    if lease.get("boot_id") != _boot_id():
        raise PublicationError("LEASE_BOOT_MISMATCH")
    now = _boottime_ns()
    deadline = lease.get("deadline_boottime_ns")
    if not isinstance(deadline, int) or now >= deadline:
        raise PublicationError("LEASE_EXPIRED")


def _attempt_update(path: Path, value: dict[str, Any]) -> None:
    _atomic_write_json(path, value)


def _prepare_push_locked(root: Path, reg: dict[str, Any], push_kind: str,
                         expected_old: str, remote_ref: str, target_oid: str,
                         ttl_seconds: int) -> tuple[dict[str, Any], dict[str, Any]]:
    expected_state = PRE_PUSH_STATES[push_kind]
    if reg.get("state") != expected_state:
        raise PublicationError(f"PUSH_PRESTATE_INVALID:{reg.get('state')}")
    _validate_registration_identity(
        root, reg, require_clean=True,
        require_remote_base=push_kind in {"TASK_REF", "MAIN"},
        require_task_ref=push_kind in {"MAIN", "CLEANUP_TASK_REF"},
    )
    lease = _new_lease(reg, push_kind, expected_old, remote_ref, target_oid, ttl_seconds)
    nonce = lease["nonce"]
    armed = _lease_path(root, reg["registration_id"], "armed", nonce)
    _create_once_json(armed, lease)
    lease_sha = _lease_sha(armed)
    transient = TRANSIENT_STATES[push_kind]
    next_reg = _state_transition(
        root, reg["registration_id"], {expected_state}, transient,
        {
            "current_nonce": nonce,
            "current_lease_sha256": lease_sha,
            "current_push_kind": push_kind,
        },
        expected_version=reg["state_version"],
    )
    attempt = {
        "kind": "octoport.task-publication-push-attempt",
        "version": 1,
        "registration_id": reg["registration_id"],
        "nonce": nonce,
        "push_kind": push_kind,
        "boot_id": lease["boot_id"],
        "pid": None,
        "process_group": None,
        "proc_start_time": None,
        "spawned_at": None,
        "wait_outcome": "PREPARED",
        "exit_code": None,
        "signal": None,
    }
    _create_once_json(_attempt_path(root, reg["registration_id"], nonce), attempt)
    return next_reg, lease


def _prepare_supersede_push_locked(
    root: Path,
    reg: dict[str, Any],
    evidence: dict[str, Any],
    bundle: Path,
    bundle_manifest_sha: str,
    ttl_seconds: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    if reg.get("state") != "TASK_REF_PUBLISHED":
        raise PublicationError(f"SUPERSEDE_PRESTATE_INVALID:{reg.get('state')}")
    if not _no_armed_leases(root, reg["registration_id"]):
        raise PublicationError("SUPERSEDE_ARMED_LEASE_PRESENT")
    ready_retirement = reg.get("ready_base_drift_retirement")
    if ready_retirement is not None:
        if not isinstance(ready_retirement, dict):
            raise PublicationError("SUPERSEDE_READY_RETIREMENT_RECORD_INVALID")
        # This is the final fail-closed boundary before a deletion lease exists.
        # READY authority was already cleared, but route/config or main drift now
        # leaves the exact task ref untouched and requires a fresh reconciliation.
        _validate_ready_retirement_config(reg)
        current_main = _remote_oid_target(
            Path(reg["core"]["worktree_path"]),
            reg["core"]["push_target"],
            "refs/heads/main",
            env=_supersede_transport_env(),
        )
        if current_main != ready_retirement.get("observed_remote_main"):
            raise PublicationError("SUPERSEDE_READY_REMOTE_MAIN_DRIFT")
    verified = _validate_supersede_request(
        root, reg, evidence["path"], evidence["sha256"], require_clean=True
    )
    if verified != evidence:
        raise PublicationError("SUPERSEDE_EVIDENCE_DRIFT")
    _verify_bundle(bundle, bundle_manifest_sha)
    lease = _new_lease(
        reg, "SUPERSEDE_TASK_REF", reg["core"]["candidate_head"],
        reg["core"]["task_ref"], ZERO_OID, ttl_seconds,
    )
    lease["execution_bundle_manifest_sha256"] = bundle_manifest_sha
    lease["supersede_evidence_sha256"] = evidence["sha256"]
    nonce = lease["nonce"]
    armed = _lease_path(root, reg["registration_id"], "armed", nonce)
    _create_once_json(armed, lease)
    lease_sha = _lease_sha(armed)
    next_reg = _state_transition(
        root, reg["registration_id"], {"TASK_REF_PUBLISHED"}, "SUPERSEDING_TASK_REF",
        {
            "current_nonce": nonce,
            "current_lease_sha256": lease_sha,
            "current_push_kind": "SUPERSEDE_TASK_REF",
            "supersede_evidence": evidence,
            "supersede_bundle": {"path": str(bundle), "sha256": bundle_manifest_sha},
        },
        expected_version=reg["state_version"],
    )
    attempt = {
        "kind": "octoport.task-publication-push-attempt",
        "version": 1,
        "registration_id": reg["registration_id"],
        "nonce": nonce,
        "push_kind": "SUPERSEDE_TASK_REF",
        "boot_id": lease["boot_id"],
        "pid": None,
        "process_group": None,
        "proc_start_time": None,
        "spawned_at": None,
        "wait_outcome": "PREPARED",
        "exit_code": None,
        "signal": None,
    }
    _create_once_json(_attempt_path(root, reg["registration_id"], nonce), attempt)
    return next_reg, lease


def _push_command(reg: dict[str, Any], push_kind: str) -> list[str]:
    core = reg["core"]
    remote = core["remote"]
    if push_kind == "TASK_REF":
        return ["git", "-C", core["worktree_path"], "push", "--porcelain", remote,
                f"HEAD:{core['task_ref']}"]
    if push_kind == "MAIN":
        return ["git", "-C", core["worktree_path"], "push", "--porcelain", remote,
                "HEAD:refs/heads/main"]
    if push_kind == "CLEANUP_TASK_REF":
        return ["git", "-C", core["worktree_path"], "push", "--porcelain", remote,
                f":{core['task_ref']}"]
    raise PublicationError("PUSH_KIND_INVALID")


def _run_git_push(root: Path, reg: dict[str, Any], lease: dict[str, Any],
                  timeout_seconds: int) -> dict[str, Any]:
    command = _push_command(reg, lease["push_kind"])
    forbidden = {"--force", "--force-with-lease", "--mirror"}
    if any(arg.startswith("+") or arg in forbidden for arg in command):
        raise PublicationError("FORBIDDEN_PUSH_ARGUMENT")
    # Every generated command ends in exactly one refspec.  Do not infer
    # refspecs from ':' elsewhere because an immutable SSH push URL may contain
    # a colon as well.
    if not command or ":" not in command[-1]:
        raise PublicationError("SINGLE_REFSPEC_REQUIRED")
    env = dict(os.environ)
    execution_bundle_sha = reg["core"]["bundle_manifest_sha256"]
    if not SHA64_RE.fullmatch(str(execution_bundle_sha or "")):
        raise PublicationError("EXECUTION_BUNDLE_IDENTITY_REQUIRED")
    env.update({
        "PYTHONDONTWRITEBYTECODE": "1",
        "OCTOPORT_PUBLICATION_CONTROL_ROOT": str(root),
        "OCTOPORT_PUBLICATION_REGISTRATION_ID": reg["registration_id"],
        "OCTOPORT_PUBLICATION_NONCE": lease["nonce"],
        "OCTOPORT_PUBLICATION_KIND": lease["push_kind"],
        "OCTOPORT_PUBLICATION_BUNDLE_MANIFEST_SHA256": execution_bundle_sha,
    })
    attempt_path = _attempt_path(root, reg["registration_id"], lease["nonce"])
    attempt = _load_json(attempt_path)
    proc = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        start_new_session=True,
    )
    attempt.update(
        pid=proc.pid,
        process_group=proc.pid,
        proc_start_time=_proc_start_time(proc.pid),
        spawned_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        wait_outcome="RUNNING",
    )
    _attempt_update(attempt_path, attempt)
    try:
        stdout, stderr = proc.communicate(timeout=timeout_seconds)
        outcome = "EXITED"
    except subprocess.TimeoutExpired:
        outcome = "TIMEOUT"
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, stderr = proc.communicate()
    attempt = _load_json(attempt_path)
    attempt.update(
        wait_outcome=outcome,
        exit_code=proc.returncode,
        signal=(-proc.returncode if proc.returncode is not None and proc.returncode < 0 else None),
        stdout_sha256=_sha_bytes((stdout or "").encode()),
        stderr_sha256=_sha_bytes((stderr or "").encode()),
    )
    _attempt_update(attempt_path, attempt)
    return attempt


def _consume_supersede_hook(root: Path, reg: dict[str, Any], lease: dict[str, Any]) -> None:
    bundle = reg.get("supersede_bundle", {})
    bundle_path = Path(bundle.get("path", ""))
    bundle_sha = bundle.get("sha256", "")
    _verify_bundle(bundle_path, bundle_sha)
    hook = bundle_path / "hooks/pre-push"
    if not hook.is_file():
        raise PublicationError("SUPERSEDE_HOOK_REQUIRED")
    core = reg["core"]
    env = _supersede_transport_env()
    env.update({
        "PYTHONDONTWRITEBYTECODE": "1",
        "OCTOPORT_PUBLICATION_CONTROL_ROOT": str(root),
        "OCTOPORT_PUBLICATION_REGISTRATION_ID": reg["registration_id"],
        "OCTOPORT_PUBLICATION_NONCE": lease["nonce"],
        "OCTOPORT_PUBLICATION_KIND": "SUPERSEDE_TASK_REF",
        "OCTOPORT_PUBLICATION_BUNDLE_MANIFEST_SHA256": bundle_sha,
    })
    row = f"(delete) {ZERO_OID} {lease['remote_ref']} {lease['expected_remote_old_oid']}\n"
    proc = subprocess.run(
        [str(hook), core["push_target"], core["push_target"]],
        cwd=core["worktree_path"],
        input=row,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        check=False,
    )
    if proc.returncode:
        raise PublicationError(
            "SUPERSEDE_HOOK_BLOCKED:"
            + _sha_bytes((proc.stdout + "\n" + proc.stderr).encode())
        )
    namespace, _ = _lease_namespace(root, reg["registration_id"], lease["nonce"])
    if namespace != "consumed":
        raise PublicationError("SUPERSEDE_HOOK_DID_NOT_CONSUME_LEASE")


def _run_supersede_send_pack(root: Path, reg: dict[str, Any], lease: dict[str, Any],
                             timeout_seconds: int) -> dict[str, Any]:
    if lease.get("push_kind") != "SUPERSEDE_TASK_REF":
        raise PublicationError("SUPERSEDE_PUSH_KIND_REQUIRED")
    _consume_supersede_hook(root, reg, lease)
    core = reg["core"]
    command = [
        "git", "-C", core["worktree_path"], "-c", "core.sshCommand=ssh", "send-pack",
        "--helper-status",
        f"--force-with-lease={lease['remote_ref']}:{lease['expected_remote_old_oid']}",
        core["push_target"], f":{lease['remote_ref']}",
    ]
    env = _supersede_transport_env()
    attempt_path = _attempt_path(root, reg["registration_id"], lease["nonce"])
    attempt = _load_json(attempt_path)
    proc = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        env=env,
        start_new_session=True,
    )
    attempt.update(
        pid=proc.pid,
        process_group=proc.pid,
        proc_start_time=_proc_start_time(proc.pid),
        spawned_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        wait_outcome="RUNNING",
    )
    _attempt_update(attempt_path, attempt)
    try:
        stdout, stderr = proc.communicate(timeout=timeout_seconds)
        outcome = "EXITED"
    except subprocess.TimeoutExpired:
        outcome = "TIMEOUT"
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            stdout, stderr = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            stdout, stderr = proc.communicate()
    attempt = _load_json(attempt_path)
    attempt.update(
        wait_outcome=outcome,
        exit_code=proc.returncode,
        signal=(-proc.returncode if proc.returncode is not None and proc.returncode < 0 else None),
        stdout_sha256=_sha_bytes((stdout or "").encode()),
        stderr_sha256=_sha_bytes((stderr or "").encode()),
    )
    _attempt_update(attempt_path, attempt)
    return attempt


def _immutable_settlement(root: Path, reg: dict[str, Any], lease: dict[str, Any],
                          lease_namespace: str, attempt: dict[str, Any],
                          remote_oid: str, outcome: str, reason: str) -> dict[str, Any]:
    nonce = lease["nonce"]
    lease_path = _lease_path(root, reg["registration_id"], lease_namespace, nonce)
    lease_sha = _sha_file(lease_path)
    settlement = {
        "kind": "octoport.task-publication-settlement",
        "version": SETTLEMENT_VERSION,
        "registration_id": reg["registration_id"],
        "registration_sha256": reg["registration_sha256"],
        "registration_state_version_at_attempt": lease["registration_state_version_at_attempt"],
        "nonce": nonce,
        "lease_sha256": lease_sha,
        "final_lease_namespace": lease_namespace,
        "push_kind": lease["push_kind"],
        "process_completion_class": attempt.get("wait_outcome"),
        "remote_ref": lease["remote_ref"],
        "expected_remote_old_oid": lease["expected_remote_old_oid"],
        "target_oid": lease["target_oid"],
        "remote_readback_oid_or_absent": remote_oid,
        "settlement_outcome": outcome,
        "reason": reason,
        "bundle_manifest_sha256": lease["bundle_manifest_sha256"],
        "task_fingerprint": lease["task_fingerprint"],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    path = _settlement_path(root, reg["registration_id"], nonce)
    digest_path = path.with_suffix(".sha256")
    if path.exists():
        existing = _load_json(path)
        if not digest_path.is_file() or digest_path.read_text().strip() != _sha_file(path):
            raise PublicationError("SETTLEMENT_HASH_MISMATCH")
        identity_keys = set(settlement) - {
            "created_at", "remote_readback_oid_or_absent", "settlement_outcome",
            "reason", "process_completion_class",
        }
        if any(existing.get(k) != settlement.get(k) for k in identity_keys):
            raise PublicationError("SETTLEMENT_IMMUTABLE_MISMATCH")
        # Existing observations/decisions are authoritative for this nonce.
        # A later remote value is checked separately, never used to rewrite them.
        return existing
    _create_once_json(path, settlement)
    _create_once_bytes(digest_path, (_sha_file(path) + "\n").encode())
    return settlement


def _settlement_decision(push_kind: str, lease_namespace: str, remote_oid: str,
                         expected_old: str, target: str) -> tuple[str, str]:
    if lease_namespace == "consumed":
        if push_kind in {"TASK_REF", "MAIN"}:
            if remote_oid == target:
                return SUCCESS_STATES[push_kind], "CONSUMED_TARGET"
            return "FAILED", "CONSUMED_NON_TARGET_AMBIGUOUS"
        if push_kind == "CLEANUP_TASK_REF":
            return "PUBLISHED", "CLEANUP_DELETED" if remote_oid == ZERO_OID else "CLEANUP_NON_ABSENT_AMBIGUOUS"
        if push_kind == "SUPERSEDE_TASK_REF":
            if remote_oid == ZERO_OID:
                return "REVOKED", "SUPERSEDE_DELETED"
            return "TASK_REF_PUBLISHED", "SUPERSEDE_NON_ABSENT_AMBIGUOUS"
    if lease_namespace == "cancelled":
        if push_kind == "TASK_REF":
            return ("REGISTERED", "CANCELLED_REMOTE_UNCHANGED") if remote_oid == expected_old else ("FAILED", "CANCELLED_REMOTE_CHANGED")
        if push_kind == "MAIN":
            return ("TASK_REF_PUBLISHED", "CANCELLED_REMOTE_UNCHANGED_FRESH_READY_REQUIRED") if remote_oid == expected_old else ("FAILED", "CANCELLED_REMOTE_CHANGED")
        if push_kind == "CLEANUP_TASK_REF":
            return "PUBLISHED", "CLEANUP_CANCELLED"
        if push_kind == "SUPERSEDE_TASK_REF":
            return (
                ("TASK_REF_PUBLISHED", "SUPERSEDE_CANCELLED_REMOTE_UNCHANGED")
                if remote_oid == expected_old
                else ("TASK_REF_PUBLISHED", "SUPERSEDE_CANCELLED_REMOTE_CHANGED")
            )
    raise PublicationError("LEASE_SETTLEMENT_STATE_INVALID")


def _attempt_settled(lease: dict[str, Any], attempt: dict[str, Any]) -> bool | None:
    if (attempt.get("registration_id") != lease["registration_id"] or
            attempt.get("nonce") != lease["nonce"] or
            attempt.get("push_kind") != lease["push_kind"] or
            attempt.get("boot_id") != lease["boot_id"] or
            type(attempt.get("pid")) is not int or not attempt.get("proc_start_time")):
        return None
    if attempt["boot_id"] != _boot_id():
        return True  # The recorded process cannot survive a reboot.
    alive = _process_alive(attempt["pid"], attempt["proc_start_time"])
    return None if alive is None else not alive


def _settle_after_push_locked(root: Path, reg: dict[str, Any], lease: dict[str, Any],
                              attempt: dict[str, Any]) -> dict[str, Any]:
    reg, _ = _read_registration(root, reg["registration_id"])
    nonce = lease["nonce"]
    namespace, path = _lease_namespace(root, reg["registration_id"], nonce)
    if namespace is None or path is None:
        raise PublicationError("LEASE_MISSING_AFTER_PUSH")
    if (reg.get("current_nonce") != nonce or _sha_file(path) != reg.get("current_lease_sha256") or
            lease.get("registration_id") != reg["registration_id"] or
            lease.get("registration_sha256") != reg["registration_sha256"] or
            lease.get("registration_state_version_at_attempt") != reg["state_version"] or
            lease.get("task_fingerprint") != reg["core"]["task_fingerprint"] or
            lease.get("bundle_manifest_sha256") != reg["core"]["bundle_manifest_sha256"]):
        raise PublicationError("SETTLEMENT_LEASE_IDENTITY_MISMATCH")
    if lease.get("push_kind") == "SUPERSEDE_TASK_REF":
        bundle = reg.get("supersede_bundle", {})
        evidence = reg.get("supersede_evidence", {})
        if (lease.get("execution_bundle_manifest_sha256") != bundle.get("sha256") or
                lease.get("supersede_evidence_sha256") != evidence.get("sha256")):
            raise PublicationError("SUPERSEDE_LEASE_IDENTITY_MISMATCH")
    settled = _attempt_settled(lease, attempt)
    if settled is False:
        raise PublicationError("PUSH_PROCESS_STILL_ALIVE")
    if namespace == "armed":
        if _rename_noreplace(path, _lease_path(root, reg["registration_id"], "cancelled", nonce)):
            namespace = "cancelled"
        else:
            namespace, path = _lease_namespace(root, reg["registration_id"], nonce)
            if namespace == "armed":
                raise PublicationError("LEASE_CANCEL_RACE_UNSETTLED")
    if settled is None:
        # No retry/success decision can be made from an unknown child identity.
        fallback = (
            "PUBLISHED" if lease["push_kind"] == "CLEANUP_TASK_REF"
            else "TASK_REF_PUBLISHED" if lease["push_kind"] == "SUPERSEDE_TASK_REF"
            else "FAILED"
        )
        return _state_transition(root, reg["registration_id"], {TRANSIENT_STATES[lease["push_kind"]]},
            fallback,
            {"current_nonce": None, "current_lease_sha256": None, "current_push_kind": None,
             "last_settlement_outcome": "PROCESS_IDENTITY_UNKNOWN_MANUAL"},
            expected_version=reg["state_version"])
    if lease["push_kind"] == "SUPERSEDE_TASK_REF":
        remote = _supersede_remote_state(
            Path(reg["core"]["worktree_path"]), reg["core"]["push_target"],
            lease["remote_ref"], reg["core"]["candidate_head"],
        )
    else:
        remote = _remote_oid(Path(reg["core"]["worktree_path"]), reg["core"]["remote"], lease["remote_ref"])
    outcome, reason = _settlement_decision(
        lease["push_kind"], namespace, remote, lease["expected_remote_old_oid"], lease["target_oid"])
    settlement = _immutable_settlement(root, reg, lease, namespace, attempt, remote, outcome, reason)
    next_state, reason = settlement["settlement_outcome"], settlement["reason"]
    try:
        if lease["push_kind"] == "SUPERSEDE_TASK_REF":
            evidence = reg.get("supersede_evidence", {})
            _validate_supersede_request(
                root, reg, evidence.get("path", ""), evidence.get("sha256", "")
            )
            bundle = reg.get("supersede_bundle", {})
            _verify_bundle(Path(bundle.get("path", "")), bundle.get("sha256", ""))
        else:
            _validate_registration_identity(root, reg,
                require_task_ref=lease["push_kind"] == "MAIN")
            if lease["push_kind"] == "MAIN":
                _validate_ready_receipt(root, reg)
    except (RuntimeError, OSError, ValueError, KeyError, TypeError) as error:
        next_state = (
            "PUBLISHED" if lease["push_kind"] == "CLEANUP_TASK_REF"
            else "TASK_REF_PUBLISHED" if lease["push_kind"] == "SUPERSEDE_TASK_REF"
            else "FAILED"
        )
        reason = "SETTLEMENT_IDENTITY_DRIFT:" + str(error)
    if lease["push_kind"] == "SUPERSEDE_TASK_REF":
        current_remote = _supersede_remote_state(
            Path(reg["core"]["worktree_path"]), reg["core"]["push_target"],
            lease["remote_ref"], reg["core"]["candidate_head"],
        )
    else:
        current_remote = _remote_oid(Path(reg["core"]["worktree_path"]), reg["core"]["remote"], lease["remote_ref"])
    if current_remote != settlement["remote_readback_oid_or_absent"]:
        next_state = (
            "PUBLISHED" if lease["push_kind"] == "CLEANUP_TASK_REF"
            else "TASK_REF_PUBLISHED" if lease["push_kind"] == "SUPERSEDE_TASK_REF"
            else "FAILED"
        )
        reason = "POST_SETTLEMENT_REMOTE_DRIFT"
    updates = {
        "current_nonce": None, "current_lease_sha256": None, "current_push_kind": None,
        "last_settlement": str(_settlement_path(root, reg["registration_id"], nonce)),
        "last_settlement_sha256": _sha_file(_settlement_path(root, reg["registration_id"], nonce)),
        "last_settlement_outcome": reason,
    }
    if lease["push_kind"] == "MAIN" and next_state == "TASK_REF_PUBLISHED":
        updates["ready_receipt"] = None
    if lease["push_kind"] == "CLEANUP_TASK_REF":
        updates["task_ref_cleanup_status"] = "DELETED" if reason == "CLEANUP_DELETED" else "FAILED"
    if lease["push_kind"] == "SUPERSEDE_TASK_REF":
        updates["task_ref_cleanup_status"] = "DELETED" if reason == "SUPERSEDE_DELETED" else "FAILED"
    return _state_transition(root, reg["registration_id"], {TRANSIENT_STATES[lease["push_kind"]]},
        next_state, updates, expected_version=reg["state_version"])


def _push_operation(root: Path, registration_id: str, push_kind: str,
                    ttl_seconds: int = DEFAULT_LEASE_SECONDS,
                    timeout_seconds: int = DEFAULT_LEASE_SECONDS) -> dict[str, Any]:
    reg, _ = _read_registration(root, registration_id)
    role = reg["core"]["role"]
    with _role_and_coord_locks(root, role) as locks:
        reg, _ = _read_registration(root, registration_id)
        core = reg["core"]
        worktree = Path(core["worktree_path"])
        if push_kind == "TASK_REF":
            expected_old, remote_ref, target = ZERO_OID, core["task_ref"], core["candidate_head"]
            if _remote_oid(worktree, core["remote"], remote_ref) != ZERO_OID:
                raise PublicationError("TASK_REF_MUST_BE_ABSENT")
        elif push_kind == "MAIN":
            expected_old, remote_ref, target = core["base_sha"], "refs/heads/main", core["candidate_head"]
            if _remote_oid(worktree, core["remote"], remote_ref) != expected_old:
                raise PublicationError("REMOTE_MAIN_BASE_DRIFT")
            if _remote_oid(worktree, core["remote"], core["task_ref"]) != target:
                raise PublicationError("REMOTE_TASK_REF_DRIFT")
            _validate_ready_receipt(root, reg)
        elif push_kind == "CLEANUP_TASK_REF":
            if reg.get("state") != "PUBLISHED" or not _no_armed_leases(root, registration_id):
                raise PublicationError("CLEANUP_PRESTATE_INVALID")
            _validate_registration_identity(root, reg)
            if _remote_oid(worktree, core["remote"], "refs/heads/main") != core["candidate_head"]:
                raise PublicationError("CLEANUP_MAIN_READBACK_DRIFT")
            remote_ref, target = core["task_ref"], ZERO_OID
            current = _remote_oid(worktree, core["remote"], remote_ref)
            if current == ZERO_OID:
                return _state_transition(root, registration_id, {"PUBLISHED"}, "PUBLISHED",
                    {"task_ref_cleanup_status": "ALREADY_ABSENT"}, expected_version=reg["state_version"])
            if current != core["candidate_head"]:
                return _state_transition(root, registration_id, {"PUBLISHED"}, "PUBLISHED",
                    {"task_ref_cleanup_status": "FOREIGN_RETAINED"}, expected_version=reg["state_version"])
            expected_old = core["candidate_head"]
        else:
            raise PublicationError("PUSH_KIND_INVALID")

        reg, lease = _prepare_push_locked(
            root, reg, push_kind, expected_old, remote_ref, target, ttl_seconds
        )
        locks.release_coord()
        attempt = _run_git_push(root, reg, lease, timeout_seconds)
        locks.reacquire_coord()
        return _settle_after_push_locked(root, reg, lease, attempt)


def _ready_payload(root: Path, reg: dict[str, Any], ci: dict[str, Any]) -> dict[str, Any]:
    core = reg["core"]
    return {
        "kind": "octoport.task-publication-ready",
        "version": READY_VERSION,
        "registration_id": reg["registration_id"],
        "registration_sha256": reg["registration_sha256"],
        "registration_state_version": reg["state_version"] + 1,
        "task_id": core["task_id"],
        "role": core["role"],
        "task_fingerprint": core["task_fingerprint"],
        "candidate_head": core["candidate_head"],
        "candidate_tree": core["candidate_tree"],
        "base_sha": core["base_sha"],
        "task_ref": core["task_ref"],
        "task_branch": core["task_branch"],
        "review": core["review"],
        "bundle_manifest_sha256": core["bundle_manifest_sha256"],
        "ci": ci,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _validate_ready_receipt(
    root: Path,
    reg: dict[str, Any],
    max_age_seconds: int = 1800,
    *,
    require_fresh_ci: bool = True,
) -> dict[str, Any]:
    ref = reg.get("ready_receipt")
    if not isinstance(ref, dict):
        raise PublicationError("READY_RECEIPT_REQUIRED")
    path = Path(ref.get("path", ""))
    if not path.is_file() or _sha_file(path) != ref.get("sha256"):
        raise PublicationError("READY_RECEIPT_HASH_MISMATCH")
    ready = _load_json(path)
    core = reg["core"]
    required = {
        "registration_id": reg["registration_id"],
        "registration_sha256": reg["registration_sha256"],
        "task_id": core["task_id"],
        "role": core["role"],
        "task_fingerprint": core["task_fingerprint"],
        "candidate_head": core["candidate_head"],
        "candidate_tree": core["candidate_tree"],
        "base_sha": core["base_sha"],
        "task_ref": core["task_ref"],
        "task_branch": core["task_branch"],
        "review": core["review"],
        "bundle_manifest_sha256": core["bundle_manifest_sha256"],
        "registration_state_version": reg["state_version"] - (1 if reg["state"] == "PUBLISHING_MAIN" else 0),
    }
    for key, expected in required.items():
        if ready.get(key) != expected:
            raise PublicationError(f"READY_RECEIPT_IDENTITY_MISMATCH:{key}")
    ci = ready.get("ci", {})
    if require_fresh_ci:
        validate_ci_payload(
            ci, core["candidate_head"], core["task_branch"],
            max_age_seconds=max_age_seconds,
        )
    else:
        checked_at = ci.get("checked_at", 0) if isinstance(ci, dict) else 0
        validate_ci_payload(
            ci, core["candidate_head"], core["task_branch"],
            now=checked_at, max_age_seconds=0,
        )
    return ready


def mark_ready(root: Path, registration_id: str, ci_payload: dict[str, Any]) -> dict[str, Any]:
    reg, _ = _read_registration(root, registration_id)
    role = reg["core"]["role"]
    with _role_and_coord_locks(root, role):
        reg, _ = _read_registration(root, registration_id)
        if reg.get("state") != "TASK_REF_PUBLISHED":
            raise PublicationError("READY_PRESTATE_INVALID")
        _validate_registration_identity(root, reg, require_remote_base=True, require_task_ref=True)
        validate_ci_payload(ci_payload, reg["core"]["candidate_head"], reg["core"]["task_branch"])
        ready = _ready_payload(root, reg, ci_payload)
        ready_path = _ready_dir(root, registration_id) / f"{reg['state_version'] + 1}.json"
        _create_once_json(ready_path, ready)
        ready_ref = {"path": str(ready_path), "sha256": _sha_file(ready_path)}
        return _state_transition(
            root, registration_id, {"TASK_REF_PUBLISHED"}, "READY",
            {"ready_receipt": ready_ref},
            expected_version=reg["state_version"],
        )


def evaluate_ci_from_bundle(reg: dict[str, Any]) -> dict[str, Any]:
    bundle = Path(reg["core"]["bundle_path"])
    script = bundle / "ci_gate.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--sha", reg["core"]["candidate_head"],
         "--branch", reg["core"]["task_branch"]],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False,
    )
    try:
        payload = json.loads(proc.stdout.strip().splitlines()[-1])
    except Exception as error:
        raise PublicationError("CI_GATE_OUTPUT_INVALID") from error
    if proc.returncode or payload.get("status") != "PASS":
        raise PublicationError(f"CI_GATE_BLOCKED:{payload}")
    return payload


def _cancel_or_fail_recovery(root: Path, reg: dict[str, Any], lease: dict[str, Any],
                             attempt: dict[str, Any]) -> dict[str, Any]:
    return _settle_after_push_locked(root, reg, lease, attempt)


def recover_registration(root: Path, registration_id: str) -> dict[str, Any]:
    reg, _ = _read_registration(root, registration_id)
    role = reg["core"]["role"]
    with _role_and_coord_locks(root, role):
        reg, _ = _read_registration(root, registration_id)
        state = reg.get("state")
        nonce = reg.get("current_nonce")
        if state not in TRANSIENT_STATES.values():
            return reg
        if not nonce:
            return _state_transition(
                root, registration_id, {state}, "FAILED",
                {"last_settlement_outcome": "TRANSIENT_WITHOUT_NONCE_MANUAL"},
                expected_version=reg["state_version"],
            )
        namespace, path = _lease_namespace(root, registration_id, nonce)
        if namespace is None:
            return _state_transition(
                root, registration_id, {state}, "FAILED",
                {"current_nonce": None, "last_settlement_outcome": "TRANSIENT_LEASE_MISSING_MANUAL"},
                expected_version=reg["state_version"],
            )
        lease = _load_json(path)
        attempt_path = _attempt_path(root, registration_id, nonce)
        if not attempt_path.is_file():
            return _state_transition(
                root, registration_id, {state}, "FAILED",
                {"current_nonce": None, "last_settlement_outcome": "ATTEMPT_RECORD_MISSING_MANUAL"},
                expected_version=reg["state_version"],
            )
        attempt = _load_json(attempt_path)
        return _cancel_or_fail_recovery(root, reg, lease, attempt)


def _no_armed_leases(root: Path, registration_id: str) -> bool:
    armed = _lease_dir(root, registration_id, "armed")
    return not armed.exists() or not any(armed.glob("*.json"))


def _registered_never_started_retirement_facts(
    root: Path, reg: dict[str, Any],
) -> dict[str, Any]:
    """Prove a REGISTERED publication attempt never started remote mutation."""
    registration_id = reg["registration_id"]
    core = reg["core"]
    for key in (
        "current_nonce", "current_lease_sha256", "current_push_kind",
        "last_settlement", "last_settlement_outcome",
    ):
        if reg.get(key) is not None:
            raise PublicationError(
                f"SUPERSEDE_REGISTERED_NEVER_STARTED_METADATA_PRESENT:{key}"
            )

    for namespace in ("armed", "consumed", "cancelled"):
        path = _lease_dir(root, registration_id, namespace)
        try:
            entries = list(path.iterdir()) if path.exists() else []
        except OSError as exc:
            raise PublicationError(
                f"SUPERSEDE_REGISTERED_NEVER_STARTED_LEASE_HISTORY_UNREADABLE:{namespace}"
            ) from exc
        if entries:
            raise PublicationError(
                f"SUPERSEDE_REGISTERED_NEVER_STARTED_LEASE_HISTORY:{namespace}"
            )

    for kind in ("attempts", "settlements"):
        path = _root_dir(root) / kind / registration_id
        try:
            entries = list(path.iterdir()) if path.exists() else []
        except OSError as exc:
            raise PublicationError(
                f"SUPERSEDE_REGISTERED_NEVER_STARTED_{kind.upper()}_UNREADABLE"
            ) from exc
        if entries:
            raise PublicationError(
                f"SUPERSEDE_REGISTERED_NEVER_STARTED_{kind.upper()}_PRESENT"
            )

    event_path = _events_path(root, registration_id)
    try:
        raw = event_path.read_bytes()
        lines = raw.splitlines(keepends=True)
        event = json.loads(raw)
    except (OSError, json.JSONDecodeError) as exc:
        raise PublicationError(
            "SUPERSEDE_REGISTERED_NEVER_STARTED_EVENT_HISTORY_INVALID"
        ) from exc
    expected_fields = {
        "at", "bundle_manifest_sha256", "candidate", "kind",
        "state", "task_ref", "version",
    }
    if (
        len(lines) != 1
        or lines[0] != raw
        or _canonical_bytes(event) != raw
        or type(event) is not dict
        or set(event) != expected_fields
        or event.get("kind") != "REGISTERED"
        or event.get("state") != "REGISTERED"
        or event.get("version") != 2
        or reg.get("state_version") != 2
        or event.get("candidate") != core["candidate_head"]
        or event.get("task_ref") != core["task_ref"]
        or event.get("bundle_manifest_sha256") != core["bundle_manifest_sha256"]
        or not isinstance(event.get("at"), str)
        or not event["at"].endswith("Z")
    ):
        raise PublicationError(
            "SUPERSEDE_REGISTERED_NEVER_STARTED_EVENT_HISTORY_INVALID"
        )
    return {
        "armed_lease_count": 0,
        "consumed_lease_count": 0,
        "cancelled_lease_count": 0,
        "attempt_count": 0,
        "settlement_count": 0,
        "event_count": 1,
        "event_journal_sha256": _sha_bytes(raw),
    }


def _validate_ready_retirement_config(reg: dict[str, Any]) -> None:
    """Fail closed on route/config drift before READY retirement mutates any ref."""
    core = reg["core"]
    worktree = Path(core["worktree_path"])
    installed = reg.get("installed_config", {})
    if not _common_config_matches_registered(worktree, core["common_config_sha256"]):
        raise PublicationError("COMMON_CONFIG_DRIFT")
    if _global_config_digest() != core["global_config_sha256"]:
        raise PublicationError("GLOBAL_CONFIG_DRIFT")
    ownership, _ = _ownership(worktree)
    if _fixed_role_config_digests(ownership) != core["fixed_role_config_sha256"]:
        raise PublicationError("FIXED_ROLE_CONFIG_DRIFT")
    for key in installed.get("owned_keys", []):
        if _config_values(worktree, key) != installed.get(key):
            raise PublicationError(f"ROUTE_CONFIG_SAME_KEY_DRIFT:{key}")


def supersede_registration(
    root: Path,
    registration_id: str,
    evidence_path: str,
    evidence_sha: str,
    route_source_root: Path,
    route_source_sha: str,
    route_source_tree: str,
    ttl_seconds: int = DEFAULT_LEASE_SECONDS,
    timeout_seconds: int = DEFAULT_LEASE_SECONDS,
) -> dict[str, Any]:
    """Retire a failed/superseded task-ref without touching main.

    The cleanup is bounded to the immutable registration's exact candidate/ref.
    A changed work-board task fingerprint is deliberately not authority here; the
    independent supersede evidence is.  Config restoration is delegated to the
    ordinary close path, so same-key/common/global/fixed-role drift remains
    fail-closed and is never overwritten by this command.
    """
    root = root.resolve()
    reg, _ = _read_registration(root, registration_id)
    role = reg["core"]["role"]
    should_close = False
    with _role_and_coord_locks(root, role) as locks:
        reg, _ = _read_registration(root, registration_id)
        stored = reg.get("supersede_evidence")
        if reg.get("state") in {"REVOKED", "CLOSED"}:
            if not isinstance(stored, dict):
                raise PublicationError("SUPERSEDE_TERMINAL_EVIDENCE_REQUIRED")
            verified = _validate_supersede_evidence_by_kind(
                root, reg, evidence_path, evidence_sha, require_blocked_task=False
            )
            if stored.get("path") != verified["path"] or stored.get("sha256") != verified["sha256"]:
                raise PublicationError("SUPERSEDE_EVIDENCE_DRIFT")
            if reg.get("state") == "CLOSED":
                return reg
            should_close = True
        else:
            state = reg.get("state")
            if state not in {"REGISTERED", "TASK_REF_PUBLISHED", "READY"}:
                raise PublicationError(f"SUPERSEDE_PRESTATE_INVALID:{state}")
            if not _no_armed_leases(root, registration_id):
                raise PublicationError("SUPERSEDE_ARMED_LEASE_PRESENT")
            evidence = _validate_supersede_request(
                root, reg, evidence_path, evidence_sha, require_clean=True
            )
            review_drift_retirement = bool(evidence.get("review_drift_retirement"))
            if review_drift_retirement and state != "TASK_REF_PUBLISHED":
                raise PublicationError("REVIEW_DRIFT_RETIREMENT_PRESTATE_INVALID")
            if state == "READY":
                # READY base-drift retirement is stricter than ordinary supersede:
                # no task-ref mutation is allowed while route/config identity drifts.
                _validate_ready_retirement_config(reg)
                # Retirement validates the immutable READY proof but intentionally
                # does not require CI to still be publication-fresh: this path can
                # only revoke stale publication authority and never writes main.
                _validate_ready_receipt(root, reg, require_fresh_ci=False)
            if stored and (stored.get("path") != evidence["path"] or stored.get("sha256") != evidence["sha256"]):
                raise PublicationError("SUPERSEDE_EVIDENCE_DRIFT")
            core = reg["core"]
            worktree = Path(core["worktree_path"])
            superseded_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            base_updates = {
                "supersede_evidence": evidence,
                "superseded_at": superseded_at,
            }
            if state == "READY":
                remote_main = _remote_oid_target(
                    worktree,
                    core["push_target"],
                    "refs/heads/main",
                    env=_supersede_transport_env(),
                )
                if remote_main == ZERO_OID:
                    raise PublicationError("SUPERSEDE_READY_REMOTE_MAIN_UNAVAILABLE")
                if remote_main == core["base_sha"]:
                    raise PublicationError("SUPERSEDE_READY_REMOTE_MAIN_UNCHANGED")
                if remote_main == core["candidate_head"]:
                    raise PublicationError("SUPERSEDE_READY_CANDIDATE_IS_MAIN")
                reg = _state_transition(
                    root,
                    registration_id,
                    {"READY"},
                    "TASK_REF_PUBLISHED",
                    dict(
                        base_updates,
                        ready_receipt=None,
                        ready_base_drift_retirement={
                            "registered_base": core["base_sha"],
                            "observed_remote_main": remote_main,
                            "observed_at": superseded_at,
                        },
                    ),
                    expected_version=reg["state_version"],
                )
                state = "TASK_REF_PUBLISHED"
            if state == "REGISTERED":
                if reg.get("last_settlement_outcome") == "CANCELLED_REMOTE_UNCHANGED":
                    current = _remote_oid(worktree, core["remote"], core["task_ref"])
                    if current != ZERO_OID:
                        raise PublicationError("SUPERSEDE_REGISTERED_TASK_REF_PRESENT")
                    reg = _state_transition(
                        root, registration_id, {"REGISTERED"}, "REVOKED",
                        dict(base_updates, task_ref_cleanup_status="ALREADY_ABSENT"),
                        expected_version=reg["state_version"],
                    )
                else:
                    never_started = _registered_never_started_retirement_facts(root, reg)
                    remote_main = _remote_oid_target(
                        worktree, core["push_target"], "refs/heads/main",
                        env=_supersede_transport_env(),
                    )
                    if remote_main == ZERO_OID:
                        raise PublicationError("SUPERSEDE_REGISTERED_REMOTE_MAIN_UNAVAILABLE")
                    if remote_main == core["base_sha"]:
                        raise PublicationError(
                            "SUPERSEDE_REGISTERED_CANCELLED_REMOTE_UNCHANGED_REQUIRED"
                        )
                    current = _remote_oid_target(
                        worktree, core["push_target"], core["task_ref"],
                        env=_supersede_transport_env(),
                    )
                    if current != ZERO_OID:
                        raise PublicationError("SUPERSEDE_REGISTERED_TASK_REF_PRESENT")
                    retirement = dict(
                        never_started,
                        outcome="NEVER_PUBLISHED_CONFIRMED_ABSENT",
                        registered_base=core["base_sha"],
                        observed_remote_main=remote_main,
                        observed_at=superseded_at,
                        task_ref_absent=True,
                    )
                    reg = _state_transition(
                        root, registration_id, {"REGISTERED"}, "REVOKED",
                        dict(
                            base_updates,
                            task_ref_cleanup_status="ALREADY_ABSENT",
                            registered_base_drift_retirement=retirement,
                        ),
                        expected_version=reg["state_version"],
                    )
                should_close = True
            else:
                current = _supersede_remote_state(
                    worktree, core["push_target"], core["task_ref"], core["candidate_head"]
                )
                if current == ZERO_OID:
                    reg = _state_transition(
                        root, registration_id, {"TASK_REF_PUBLISHED"}, "REVOKED",
                        dict(base_updates, task_ref_cleanup_status="ALREADY_ABSENT"),
                        expected_version=reg["state_version"],
                    )
                    should_close = True
                elif current != core["candidate_head"]:
                    if review_drift_retirement:
                        raise PublicationError("REVIEW_DRIFT_RETIREMENT_FOREIGN_TASK_REF")
                    reg = _state_transition(
                        root, registration_id, {"TASK_REF_PUBLISHED"}, "REVOKED",
                        dict(base_updates, task_ref_cleanup_status="FOREIGN_RETAINED"),
                        expected_version=reg["state_version"],
                    )
                    should_close = True
                else:
                    bundle, bundle_sha = _install_bundle(
                        root, route_source_root.resolve(), route_source_sha, route_source_tree
                    )
                    existing_bundle = reg.get("supersede_bundle")
                    if existing_bundle and (
                        existing_bundle.get("path") != str(bundle) or existing_bundle.get("sha256") != bundle_sha
                    ):
                        raise PublicationError("SUPERSEDE_BUNDLE_DRIFT")
                    reg, lease = _prepare_supersede_push_locked(
                        root, reg, evidence, bundle, bundle_sha, ttl_seconds
                    )
                    locks.release_coord()
                    try:
                        attempt = _run_supersede_send_pack(root, reg, lease, timeout_seconds)
                    finally:
                        locks.reacquire_coord()
                    reg = _settle_after_push_locked(root, reg, lease, attempt)
                    should_close = reg.get("state") == "REVOKED"
    if should_close:
        return close_registration(root, registration_id)
    return reg


LEGACY_COMMON_CONFIG_EVIDENCE_KIND = "octoport.legacy-common-config-close-evidence"
LEGACY_COMMON_CONFIG_EVIDENCE_VERSION = 1


def _legacy_common_config_evidence_shape(value: Any) -> dict[str, Any]:
    """Validate only the bounded, non-secret evidence shape; grant no authority.

    This pure check does not verify a reviewer, current registration/config/ref,
    anchor lineage, or a live permission. Bind/close must verify those separately
    under their locks before using any parsed evidence.
    """
    hashes = {
        "target_registration_id", "target_core_sha256",
        "registered_common_config_sha256", "global_config_sha256",
        "anchor_registration_id", "anchor_state_sha256",
        "anchor_close_receipt_sha256", "current_common_config_sha256",
        "remote_identity_sha256", "push_identity_sha256",
        "pushurl_identity_sha256",
    }
    oids = {"candidate_sha", "candidate_tree", "base_sha",
            "anchor_candidate_sha", "current_main_sha"}
    fields = hashes | oids | {
        "kind", "version", "task_id", "role", "task_ref",
        "fixed_role_config_sha256", "anchor_state_version", "review",
    }
    def invalid() -> None:
        # Never include the rejected value: it might contain accidental secrets.
        raise PublicationError("LEGACY_COMMON_CONFIG_EVIDENCE_SCHEMA_INVALID")

    def public_text(text: Any, maximum: int) -> bool:
        return (isinstance(text, str) and 0 < len(text) <= maximum
                and text == text.strip()
                and all(ord(char) >= 32 and ord(char) != 127 for char in text))

    if type(value) is not dict or set(value) != fields:
        invalid()
    if (value["kind"] != LEGACY_COMMON_CONFIG_EVIDENCE_KIND
            or type(value["version"]) is not int
            or value["version"] != LEGACY_COMMON_CONFIG_EVIDENCE_VERSION):
        invalid()
    for key in hashes:
        if not isinstance(value[key], str) or not SHA64_RE.fullmatch(value[key]):
            invalid()
    for key in oids:
        if (not isinstance(value[key], str) or not SHA40_RE.fullmatch(value[key])
                or value[key] == ZERO_OID):
            invalid()
    if (value["target_core_sha256"] != value["target_registration_id"]
            or value["anchor_registration_id"] == value["target_registration_id"]):
        invalid()
    if (not isinstance(value["role"], str)
            or value["role"] not in {"A", "B", "C"}
            or not public_text(value["task_id"], 512)
            or not public_text(value["task_ref"], 1024)
            or not value["task_ref"].startswith("refs/heads/")
            or type(value["anchor_state_version"]) is not int
            or value["anchor_state_version"] < 1):
        invalid()
    fixed = value["fixed_role_config_sha256"]
    if type(fixed) is not dict or set(fixed) != {"A", "B", "C"}:
        invalid()
    if any(not isinstance(item, str) or not SHA64_RE.fullmatch(item)
           for item in fixed.values()):
        invalid()
    review = value["review"]
    if type(review) is not dict or set(review) != {
        "reviewer_role", "reviewer_identity", "independence_basis", "verdict", "findings"
    }:
        invalid()
    if (not isinstance(review["reviewer_role"], str)
            or review["reviewer_role"] not in {"A", "B", "C", "CONTROLLER"}
            or not public_text(review["reviewer_identity"], 256)
            or not public_text(review["independence_basis"], 1024)
            or review["verdict"] != "PASS"):
        invalid()
    findings = review["findings"]
    if (type(findings) is not dict or set(findings) != {"P0", "P1", "P2"}
            or any(type(bucket) is not list or bucket for bucket in findings.values())):
        invalid()
    return json.loads(_canonical_bytes(value))


def _legacy_common_config_evidence_identity(value: Any, observed: Any) -> dict[str, Any]:
    """Compare parsed evidence to independently collected, exact observations.

    This is a pure consistency check, not an observation or permission grant.
    The bind/close integration must collect and revalidate these facts under
    its locks, including reviewer independence and real anchor/main lineage.
    No caller may substitute evidence-derived assertions for those facts.
    """
    from datetime import datetime

    evidence = _legacy_common_config_evidence_shape(value)
    # Reviewer provenance is part of the exact independently observed identity.
    # The separate boolean proves independence, not which review was checked.
    identity_fields = set(evidence) - {"kind", "version"}
    observation_fields = identity_fields | {
        "target_created_at", "anchor_created_at", "anchor_state",
        "anchor_common_config_sha256", "anchor_global_config_sha256",
        "anchor_fixed_role_config_sha256", "anchor_remote_identity_sha256",
        "anchor_push_identity_sha256", "anchor_pushurl_identity_sha256",
        "anchor_close_receipt_valid", "anchor_is_ancestor_of_main",
        "reviewer_independence_verified", "ordinary_common_matches",
    }
    if type(observed) is not dict or set(observed) != observation_fields:
        raise PublicationError("LEGACY_COMMON_CONFIG_OBSERVATION_INVALID")
    # In particular, True must not satisfy integer state version 1.
    if any(type(observed[key]) is not type(evidence[key])
           or observed[key] != evidence[key] for key in identity_fields):
        raise PublicationError("LEGACY_COMMON_CONFIG_IDENTITY_MISMATCH")
    if observed["anchor_state"] != "CLOSED":
        raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_NOT_CLOSED")
    for key in ("anchor_close_receipt_valid", "anchor_is_ancestor_of_main",
                "reviewer_independence_verified"):
        if observed[key] is not True:
            raise PublicationError("LEGACY_COMMON_CONFIG_OBSERVATION_UNVERIFIED")
    if observed["ordinary_common_matches"] is not False:
        raise PublicationError("LEGACY_COMMON_CONFIG_BRIDGE_NOT_REQUIRED")
    pairs = {
        "anchor_common_config_sha256": "current_common_config_sha256",
        "anchor_global_config_sha256": "global_config_sha256",
        "anchor_fixed_role_config_sha256": "fixed_role_config_sha256",
        "anchor_remote_identity_sha256": "remote_identity_sha256",
        "anchor_push_identity_sha256": "push_identity_sha256",
        "anchor_pushurl_identity_sha256": "pushurl_identity_sha256",
    }
    for anchor_key, current_key in pairs.items():
        if (type(observed[anchor_key]) is not type(evidence[current_key])
                or observed[anchor_key] != evidence[current_key]):
            raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_IDENTITY_MISMATCH")
    try:
        target_time = observed["target_created_at"]
        anchor_time = observed["anchor_created_at"]
        if not isinstance(target_time, str) or not isinstance(anchor_time, str):
            raise ValueError("timestamp type")
        target_time = datetime.fromisoformat(target_time.replace("Z", "+00:00"))
        anchor_time = datetime.fromisoformat(anchor_time.replace("Z", "+00:00"))
        if target_time.utcoffset() is None or anchor_time.utcoffset() is None:
            raise ValueError("timezone required")
        if anchor_time <= target_time:
            raise ValueError("anchor must be later")
    except (TypeError, ValueError, OverflowError):
        raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_ORDER_INVALID") from None
    # _evidence_shape returned an isolated copy, never a reference to input data.
    return evidence



def _legacy_common_config_binding_transition(
    value: Any, observed: Any, evidence_reference: Any,
    authority: Any, facts: Any,
) -> dict[str, Any]:
    """Plan a detached binding journal update from already observed facts.

    Pure policy only: this function performs no observation, I/O or grant of
    authority. The bind caller must collect and revalidate all inputs under
    the role/coordination locks before applying a changed result through the
    existing registration transition. Never populate observations from the
    submitted evidence. An unchanged result must not create a state version.
    """
    from datetime import datetime
    from pathlib import PurePosixPath

    identity = _legacy_common_config_evidence_identity(value, observed)
    fields = {"state", "task_ref_oid", "no_armed_lease", "worktree_clean",
              "installed_keys_match", "close_intent_exists", "close_receipt_exists"}
    if type(facts) is not dict or set(facts) != fields:
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_FACTS_INVALID")
    state = facts["state"]
    if type(state) is not str or state not in {"TASK_REF_PUBLISHED", "PUBLISHED", "REVOKED", "FAILED"}:
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_STATE_INVALID")
    if any(facts[key] is not True for key in ("no_armed_lease", "worktree_clean", "installed_keys_match")):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED")
    if any(facts[key] is not False for key in ("close_intent_exists", "close_receipt_exists")):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_CLOSE_STARTED")
    ref_oid = facts["task_ref_oid"]
    if type(ref_oid) is not str or not SHA40_RE.fullmatch(ref_oid):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_REF_INVALID")
    if ref_oid != ZERO_OID and not (state == "TASK_REF_PUBLISHED" and ref_oid == identity["candidate_sha"]):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_TASK_REF_PRESENT")

    def reference(item: Any) -> dict[str, str]:
        if type(item) is not dict or set(item) != {"path", "sha256"}:
            raise PublicationError("LEGACY_COMMON_CONFIG_BIND_EVIDENCE_REFERENCE_INVALID")
        path, digest = item["path"], item["sha256"]
        if (type(path) is not str or not 0 < len(path) <= 4096
                or not path.startswith("/") or path.startswith("//")
                or path != path.strip() or "\\" in path
                or any(ord(c) < 32 or ord(c) == 127 for c in path)
                or ".." in PurePosixPath(path).parts
                or type(digest) is not str or not SHA64_RE.fullmatch(digest)):
            raise PublicationError("LEGACY_COMMON_CONFIG_BIND_EVIDENCE_REFERENCE_INVALID")
        return {"path": path, "sha256": digest}

    def timestamp(text: Any):
        if type(text) is not str:
            raise ValueError("timestamp type")
        result = datetime.fromisoformat(text.replace("Z", "+00:00"))
        if result.utcoffset() is None:
            raise ValueError("timezone required")
        return result

    proposed = {"evidence": reference(evidence_reference), "identity": identity,
                "anchor_created_at": observed["anchor_created_at"]}
    if authority is None:
        return {"changed": True, "authority": {"current": proposed, "history": []}}

    stable = {"target_registration_id", "target_core_sha256", "task_id", "role",
              "candidate_sha", "candidate_tree", "base_sha", "task_ref",
              "registered_common_config_sha256", "global_config_sha256",
              "fixed_role_config_sha256", "remote_identity_sha256",
              "push_identity_sha256", "pushurl_identity_sha256"}
    try:
        if (type(authority) is not dict or set(authority) != {"current", "history"}
                or type(authority["history"]) is not list):
            raise ValueError("authority shape")
        sequence = [*authority["history"], authority["current"]]
        previous_time, anchors, validated = None, set(), []
        for binding in sequence:
            if type(binding) is not dict or set(binding) != {"evidence", "identity", "anchor_created_at"}:
                raise ValueError("binding shape")
            reference(binding["evidence"])
            historical = _legacy_common_config_evidence_shape(binding["identity"])
            at = timestamp(binding["anchor_created_at"])
            anchor_id = historical["anchor_registration_id"]
            if anchor_id in anchors or (previous_time is not None and at <= previous_time):
                raise ValueError("binding history order")
            if validated and any(historical[k] != validated[0][k] for k in stable):
                raise ValueError("binding history identity")
            anchors.add(anchor_id)
            previous_time = at
            validated.append(historical)
    except (KeyError, TypeError, ValueError, OverflowError, PublicationError):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_AUTHORITY_INVALID") from None

    from copy import deepcopy
    current = authority["current"]
    if current == proposed:
        return {"changed": False, "authority": deepcopy(authority)}
    if state != "REVOKED":
        raise PublicationError("LEGACY_COMMON_CONFIG_REBIND_STATE_INVALID")
    if any(identity[k] != current["identity"][k] for k in stable):
        raise PublicationError("LEGACY_COMMON_CONFIG_REBIND_IDENTITY_DRIFT")
    if (identity["anchor_registration_id"] in anchors
            or timestamp(proposed["anchor_created_at"]) <= previous_time):
        raise PublicationError("LEGACY_COMMON_CONFIG_REBIND_ANCHOR_INVALID")
    return {"changed": True, "authority": {
        "current": proposed,
        "history": [*deepcopy(authority["history"]), deepcopy(current)],
    }}


def _legacy_common_config_apply_binding_transition_locked(
    root: Path, registration_id: str, current: dict[str, Any], transition: Any,
) -> dict[str, Any]:
    """Apply a validated transition while the caller retains role+coord locks."""
    from copy import deepcopy
    from datetime import datetime
    from pathlib import PurePosixPath

    def invalid(code: str = "LEGACY_COMMON_CONFIG_BIND_TRANSITION_INVALID") -> None:
        raise PublicationError(code)

    if (type(registration_id) is not str or not SHA64_RE.fullmatch(registration_id)
            or type(current) is not dict
            or current.get("registration_id") != registration_id
            or current.get("registration_sha256") != registration_id
            or type(current.get("state")) is not str
            or current.get("state") not in {"TASK_REF_PUBLISHED", "PUBLISHED", "REVOKED", "FAILED"}
            or type(current.get("state_version")) is not int
            or current["state_version"] < 1):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_CAS_DRIFT")
    if (type(transition) is not dict or set(transition) != {"changed", "authority"}
            or type(transition["changed"]) is not bool):
        invalid()

    def reference(value: Any) -> dict[str, str]:
        if type(value) is not dict or set(value) != {"path", "sha256"}:
            invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
        path, digest = value["path"], value["sha256"]
        if (type(path) is not str or not 0 < len(path) <= 4096
                or not path.startswith("/") or path.startswith("//")
                or path != path.strip() or "\\" in path
                or ".." in PurePosixPath(path).parts
                or any(ord(char) < 32 or ord(char) == 127 for char in path)
                or type(digest) is not str or not SHA64_RE.fullmatch(digest)):
            invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
        return {"path": path, "sha256": digest}

    def normalize_authority(value: Any) -> dict[str, Any]:
        if (type(value) is not dict or set(value) != {"current", "history"}
                or type(value["history"]) is not list):
            invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
        sequence = [*value["history"], value["current"]]
        previous_time = None
        anchors: set[str] = set()
        normalized: list[dict[str, Any]] = []
        for binding in sequence:
            if (type(binding) is not dict
                    or set(binding) != {"evidence", "identity", "anchor_created_at"}):
                invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
            identity = _legacy_common_config_evidence_shape(binding["identity"])
            if identity["target_registration_id"] != registration_id:
                invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
            try:
                at_text = binding["anchor_created_at"]
                if type(at_text) is not str:
                    raise ValueError("timestamp")
                at = datetime.fromisoformat(at_text.replace("Z", "+00:00"))
                if at.utcoffset() is None:
                    raise ValueError("timezone")
            except (TypeError, ValueError, OverflowError):
                invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
            anchor_id = identity["anchor_registration_id"]
            if anchor_id in anchors or (previous_time is not None and at <= previous_time):
                invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
            anchors.add(anchor_id); previous_time = at
            normalized.append({
                "evidence": reference(binding["evidence"]),
                "identity": identity,
                "anchor_created_at": at_text,
            })
        if not normalized:
            invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
        stable = {
            "target_registration_id", "target_core_sha256", "task_id", "role",
            "candidate_sha", "candidate_tree", "base_sha", "task_ref",
            "registered_common_config_sha256", "global_config_sha256",
            "fixed_role_config_sha256", "remote_identity_sha256",
            "push_identity_sha256", "pushurl_identity_sha256",
        }
        first_identity = normalized[0]["identity"]
        if any(any(binding["identity"][key] != first_identity[key] for key in stable)
               for binding in normalized[1:]):
            invalid("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
        return {"current": normalized[-1], "history": normalized[:-1]}

    proposed = normalize_authority(transition["authority"])
    existing_raw = current.get("legacy_common_config_authority")
    existing = normalize_authority(existing_raw) if existing_raw is not None else None

    if transition["changed"] is False:
        if existing is None or _canonical_bytes(existing) != _canonical_bytes(proposed):
            raise PublicationError("LEGACY_COMMON_CONFIG_BIND_REPLAY_DRIFT")
        return deepcopy(current)

    if existing is None:
        if proposed["history"]:
            raise PublicationError("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")
    else:
        expected_history = [*existing["history"], existing["current"]]
        if (_canonical_bytes(proposed["history"]) != _canonical_bytes(expected_history)
                or _canonical_bytes(proposed["current"]) == _canonical_bytes(existing["current"])):
            raise PublicationError("LEGACY_COMMON_CONFIG_BIND_JOURNAL_INVALID")

    state, version = current["state"], current["state_version"]
    return _state_transition(
        root, registration_id, {state}, state,
        {"legacy_common_config_authority": proposed},
        expected_version=version,
    )


def _legacy_common_config_apply_binding_transition(
    root: Path, registration_id: str, expected_state: str,
    expected_version: int, transition: Any,
) -> dict[str, Any]:
    """Acquire role+coord locks then CAS-apply an already validated transition."""
    if (type(registration_id) is not str or not SHA64_RE.fullmatch(registration_id)
            or type(expected_state) is not str
            or expected_state not in {"TASK_REF_PUBLISHED", "PUBLISHED", "REVOKED", "FAILED"}
            or type(expected_version) is not int or expected_version < 1):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_TRANSITION_INVALID")
    first, _ = _read_registration(root, registration_id)
    try:
        role = first["core"]["role"]
    except (KeyError, TypeError):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_TRANSITION_INVALID") from None
    if role not in {"A", "B", "C"}:
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_TRANSITION_INVALID")
    with _role_and_coord_locks(root, role):
        current, _ = _read_registration(root, registration_id)
        if (current.get("registration_id") != registration_id
                or current.get("registration_sha256") != registration_id
                or current.get("state") != expected_state
                or current.get("state_version") != expected_version):
            raise PublicationError("LEGACY_COMMON_CONFIG_BIND_CAS_DRIFT")
        return _legacy_common_config_apply_binding_transition_locked(
            root, registration_id, current, transition)


def _legacy_common_config_close_checkpoint(
    value: Any, observed: Any, evidence_reference: Any, authority: Any,
    frozen_checkpoint: Any = None,
) -> dict[str, Any]:
    """Freeze non-secret close identity and reject drift on an intent replay.

    Pure serialization/consistency only, never a close permission or observer.
    The integration must independently validate evidence bytes, the complete
    journal and current authority under its locks, check state/ref/lease/config
    guards and use the same checkpoint in close intent and crash recovery.
    Existing history is fingerprinted, not re-authorized by this function.
    No configuration values or raw reviewer metadata enter the checkpoint.
    """
    from datetime import datetime
    from pathlib import PurePosixPath

    identity = _legacy_common_config_evidence_identity(value, observed)

    def reference(item: Any) -> dict[str, str]:
        if type(item) is not dict or set(item) != {"path", "sha256"}:
            raise ValueError("reference shape")
        path, digest = item["path"], item["sha256"]
        if (type(path) is not str or not 0 < len(path) <= 4096
                or not path.startswith("/") or path.startswith("//")
                or path != path.strip() or "\\" in path
                or any(ord(char) < 32 or ord(char) == 127 for char in path)
                or ".." in PurePosixPath(path).parts
                or type(digest) is not str or not SHA64_RE.fullmatch(digest)):
            raise ValueError("reference identity")
        return {"path": path, "sha256": digest}

    try:
        loaded_reference = reference(evidence_reference)
        if (type(authority) is not dict or set(authority) != {"current", "history"}
                or type(authority["history"]) is not list):
            raise ValueError("authority shape")
        for binding in [*authority["history"], authority["current"]]:
            if type(binding) is not dict or set(binding) != {"evidence", "identity", "anchor_created_at"}:
                raise ValueError("binding shape")
            reference(binding["evidence"])
            _legacy_common_config_evidence_shape(binding["identity"])
            anchor_time = binding["anchor_created_at"]
            if type(anchor_time) is not str or datetime.fromisoformat(anchor_time.replace("Z", "+00:00")).utcoffset() is None:
                raise ValueError("anchor timestamp")
    except (KeyError, TypeError, ValueError, OverflowError, PublicationError):
        raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_AUTHORITY_INVALID") from None

    current = authority["current"]
    if (current["evidence"] != loaded_reference
            or _canonical_bytes(current["identity"]) != _canonical_bytes(identity)
            or current["anchor_created_at"] != observed["anchor_created_at"]):
        raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_BINDING_MISMATCH")
    checkpoint = {
        "kind": "octoport.legacy-common-config-close-checkpoint",
        "version": 1,
        "target_registration_id": identity["target_registration_id"],
        "evidence": loaded_reference,
        "anchor_registration_id": identity["anchor_registration_id"],
        "anchor_state_version": identity["anchor_state_version"],
        "anchor_state_sha256": identity["anchor_state_sha256"],
        "anchor_close_receipt_sha256": identity["anchor_close_receipt_sha256"],
        "binding_current_sha256": _sha_bytes(_canonical_bytes(current)),
        "binding_history_sha256": _sha_bytes(_canonical_bytes(authority["history"])),
        "authority_sha256": _sha_bytes(_canonical_bytes(authority)),
    }
    if frozen_checkpoint is not None:
        try:
            matches = (type(frozen_checkpoint) is dict
                       and _canonical_bytes(frozen_checkpoint) == _canonical_bytes(checkpoint))
        except (TypeError, ValueError, OverflowError):
            matches = False
        if not matches:
            raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_CHECKPOINT_DRIFT")
    return json.loads(_canonical_bytes(checkpoint))


def _legacy_common_config_target_facts(
    root: Path, registration: dict[str, Any],
) -> dict[str, Any]:
    """Collect target guards; this is not a bind permission or journal writer.

    The caller must hold the role and coordination locks, pass the snapshot
    returned by the existing registration validator and retain those locks
    through evidence/anchor validation and the version-checked state write.
    Returned facts must never be cached or supplied by a CLI caller. This
    collector does not authenticate a reviewer or validate anchor lineage.
    The existing immutable-target dry-run probe performs no ref mutation.
    """
    try:
        identifier = registration['registration_id']
        core = registration['core']
        state = registration['state']
        installed = registration['installed_config']
        if (type(identifier) is not str or not SHA64_RE.fullmatch(identifier)
                or type(core) is not dict or type(installed) is not dict):
            raise ValueError('snapshot shape')
        worktree_text = core['worktree_path']
        candidate, task_ref, target = core['candidate_head'], core['task_ref'], core['push_target']
        if (type(worktree_text) is not str or not Path(worktree_text).is_absolute()
                or '..' in Path(worktree_text).parts
                or type(candidate) is not str or not SHA40_RE.fullmatch(candidate)
                or candidate == ZERO_OID or type(task_ref) is not str
                or not task_ref.startswith('refs/heads/')
                or type(target) is not str or not target):
            raise ValueError('target identity')
        keys = installed['owned_keys']
        if (type(keys) is not list or len(keys) != 2
                or any(type(key) is not str for key in keys)
                or set(keys) != {'core.hooksPath', 'remote.origin.pushurl'}):
            raise ValueError('owned keys')
        for key in keys:
            item = installed[key]
            if (type(item) is not dict or set(item) != {'present', 'values'}
                    or type(item['present']) is not bool or type(item['values']) is not list
                    or any(type(value) is not str for value in item['values'])):
                raise ValueError('installed values')
    except (KeyError, TypeError, ValueError):
        raise PublicationError('LEGACY_COMMON_CONFIG_TARGET_SNAPSHOT_INVALID') from None
    if type(state) is not str or state not in {'TASK_REF_PUBLISHED', 'PUBLISHED', 'REVOKED', 'FAILED'}:
        raise PublicationError('LEGACY_COMMON_CONFIG_BIND_STATE_INVALID')
    worktree = Path(worktree_text)
    close_root = Path(root) / 'controllers' / 'task-publication' / 'close' / identifier

    def local_guards() -> None:
        if _no_armed_leases(root, identifier) is not True:
            raise PublicationError('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED')
        for name in ('intent.json', 'receipt.json'):
            marker = close_root / name
            if marker.exists() or marker.is_symlink():
                raise PublicationError('LEGACY_COMMON_CONFIG_BIND_CLOSE_STARTED')
        try:
            result = subprocess.run(
                [AUTHORITY_GIT_BIN, '-C', str(worktree), 'status', '--porcelain', '--untracked-files=normal'],
                cwd='/', env=sanitized_git_authority_env(), capture_output=True,
                text=True, timeout=30, check=False,
            )
        except (OSError, subprocess.SubprocessError, UnicodeError):
            raise PublicationError('LEGACY_COMMON_CONFIG_GIT_OBSERVATION_FAILED') from None
        if result.returncode != 0 or type(result.stdout) is not str:
            raise PublicationError('LEGACY_COMMON_CONFIG_GIT_OBSERVATION_FAILED')
        if result.stdout.strip():
            raise PublicationError('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED')
        try:
            matches = all(_config_values(worktree, key) == installed[key] for key in keys)
        except (PublicationError, OSError, subprocess.SubprocessError, UnicodeError):
            raise PublicationError('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED') from None
        if not matches:
            raise PublicationError('LEGACY_COMMON_CONFIG_BIND_GUARD_UNVERIFIED')

    # Reject local failures before performing any transport observation.
    local_guards()
    try:
        ref_oid = _supersede_remote_state(worktree, target, task_ref, candidate)
    except (PublicationError, OSError, subprocess.SubprocessError, UnicodeError, ValueError):
        raise PublicationError('LEGACY_COMMON_CONFIG_REF_OBSERVATION_FAILED') from None
    if type(ref_oid) is not str or not SHA40_RE.fullmatch(ref_oid):
        raise PublicationError('LEGACY_COMMON_CONFIG_REF_OBSERVATION_FAILED')
    if ref_oid != ZERO_OID and not (state == 'TASK_REF_PUBLISHED' and ref_oid == candidate):
        raise PublicationError('LEGACY_COMMON_CONFIG_BIND_TASK_REF_PRESENT')
    # A network observation may take time. Never reuse the earlier local facts.
    local_guards()
    return {'state': state, 'task_ref_oid': ref_oid, 'no_armed_lease': True,
            'worktree_clean': True, 'installed_keys_match': True,
            'close_intent_exists': False, 'close_receipt_exists': False}


def _legacy_common_config_transport_hashes(core: Any) -> dict[str, str]:
    """Hash bounded canonical transport identity without exposing endpoint values."""
    try:
        if type(core) is not dict:
            raise ValueError("core shape")
        remote = core["remote"]
        push_target = core["push_target"]
        pushurl = core.get("pushurl_override")
        if (type(remote) is not str or not remote or remote != remote.strip()
                or any(ord(char) < 33 or ord(char) == 127 for char in remote)
                or type(push_target) is not str or not push_target
                or (pushurl is not None and (type(pushurl) is not str or not pushurl))):
            raise ValueError("transport shape")
        push_identity = _remote_repository_identity(push_target)
        pushurl_identity = None if pushurl is None else _remote_repository_identity(pushurl)
    except (KeyError, TypeError, ValueError, PublicationError):
        raise PublicationError("LEGACY_COMMON_CONFIG_TRANSPORT_IDENTITY_INVALID") from None

    def digest(label: str, value: Any) -> str:
        return _sha_bytes(_canonical_bytes({"kind": label, "value": value}))

    return {
        "remote_identity_sha256": digest("remote-name", remote),
        "push_identity_sha256": digest("push-target", push_identity),
        "pushurl_identity_sha256": digest("pushurl-override", pushurl_identity),
    }


def _legacy_common_config_current_observation(
    root: Path, registration: dict[str, Any], evidence: Any,
    anchor: Any, review_observation: Any,
) -> dict[str, Any]:
    """Collect current non-mutating authority facts; reviewer input is independently supplied."""
    from copy import deepcopy
    try:
        if type(registration) is not dict or type(registration.get("core")) is not dict:
            raise ValueError("registration shape")
        identifier = registration["registration_id"]
        core = registration["core"]
        if (type(identifier) is not str or not SHA64_RE.fullmatch(identifier)
                or core["role"] not in {"A", "B", "C"}
                or type(core["worktree_path"]) is not str):
            raise ValueError("target identity")
        worktree = Path(core["worktree_path"])
        if not worktree.is_absolute() or ".." in worktree.parts:
            raise ValueError("worktree path")
        target = {
            "target_registration_id": identifier,
            "target_core_sha256": identifier,
            "registered_common_config_sha256": core["common_config_sha256"],
            "global_config_sha256": core["global_config_sha256"],
            "candidate_sha": core["candidate_head"],
            "candidate_tree": core["candidate_tree"],
            "base_sha": core["base_sha"],
            "task_id": core["task_id"],
            "role": core["role"],
            "task_ref": core["task_ref"],
            "fixed_role_config_sha256": deepcopy(core["fixed_role_config_sha256"]),
        }
    except (KeyError, TypeError, ValueError):
        raise PublicationError("LEGACY_COMMON_CONFIG_TARGET_IDENTITY_INVALID") from None

    parsed = _legacy_common_config_evidence_shape(evidence)
    for key, actual in target.items():
        if parsed[key] != actual:
            raise PublicationError("LEGACY_COMMON_CONFIG_TARGET_IDENTITY_MISMATCH")

    transport = _legacy_common_config_transport_hashes(core)
    for key, actual in transport.items():
        if parsed[key] != actual:
            raise PublicationError("LEGACY_COMMON_CONFIG_TARGET_TRANSPORT_MISMATCH")
        if type(anchor) is not dict or anchor.get("anchor_" + key) != actual:
            raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_TRANSPORT_MISMATCH")

    if (type(review_observation) is not dict
            or review_observation.get("reviewer_role") == core["role"]):
        raise PublicationError("LEGACY_COMMON_CONFIG_REVIEW_NOT_INDEPENDENT")

    try:
        common = _common_config_digest(worktree)
        global_digest = _global_config_digest()
        ownership, _ = _ownership(worktree)
        fixed = _fixed_role_config_digests(ownership)
    except (OSError, subprocess.SubprocessError, PublicationError, KeyError, TypeError, ValueError):
        raise PublicationError("LEGACY_COMMON_CONFIG_CURRENT_AUTHORITY_UNAVAILABLE") from None
    if (common != parsed["current_common_config_sha256"]
            or global_digest != parsed["global_config_sha256"]
            or fixed != parsed["fixed_role_config_sha256"]):
        raise PublicationError("LEGACY_COMMON_CONFIG_CURRENT_AUTHORITY_MISMATCH")

    ordinary = _common_config_matches_registered(worktree, core["common_config_sha256"])
    try:
        current_main = _authority_remote_oid_target(core["push_target"], "refs/heads/main")
    except (OSError, subprocess.SubprocessError, PublicationError, ValueError):
        raise PublicationError("LEGACY_COMMON_CONFIG_CURRENT_MAIN_UNAVAILABLE") from None
    if (current_main == ZERO_OID or current_main != parsed["current_main_sha"]):
        raise PublicationError("LEGACY_COMMON_CONFIG_CURRENT_MAIN_MISMATCH")

    try:
        lineage = subprocess.run(
            [AUTHORITY_GIT_BIN, "-C", str(worktree), "merge-base", "--is-ancestor",
             parsed["anchor_candidate_sha"], current_main],
            cwd="/", env=sanitized_git_authority_env(), capture_output=True,
            text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_LINEAGE_UNVERIFIED") from None
    if lineage.returncode != 0:
        raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_LINEAGE_UNVERIFIED")

    try:
        observed = dict(target)
        observed.update(transport)
        observed.update({
            "anchor_registration_id": anchor["anchor_registration_id"],
            "anchor_state_version": anchor["anchor_state_version"],
            "anchor_state_sha256": anchor["anchor_state_sha256"],
            "anchor_close_receipt_sha256": anchor["anchor_close_receipt_sha256"],
            "anchor_candidate_sha": anchor["anchor_candidate_sha"],
            "current_main_sha": current_main,
            "current_common_config_sha256": common,
            "review": deepcopy(review_observation),
            "target_created_at": registration["created_at"],
            "anchor_created_at": anchor["anchor_created_at"],
            "anchor_state": anchor["anchor_state"],
            "anchor_common_config_sha256": anchor["anchor_common_config_sha256"],
            "anchor_global_config_sha256": anchor["anchor_global_config_sha256"],
            "anchor_fixed_role_config_sha256": deepcopy(anchor["anchor_fixed_role_config_sha256"]),
            "anchor_remote_identity_sha256": anchor["anchor_remote_identity_sha256"],
            "anchor_push_identity_sha256": anchor["anchor_push_identity_sha256"],
            "anchor_pushurl_identity_sha256": anchor["anchor_pushurl_identity_sha256"],
            "anchor_close_receipt_valid": anchor["anchor_close_receipt_valid"],
            "anchor_is_ancestor_of_main": True,
            "reviewer_independence_verified": True,
            "ordinary_common_matches": ordinary,
        })
    except (KeyError, TypeError):
        raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_SNAPSHOT_INVALID") from None
    _legacy_common_config_evidence_identity(parsed, observed)
    return json.loads(_canonical_bytes(observed))


def _legacy_common_config_evidence_snapshot(
    root: Path, evidence_path: str, evidence_sha256: str,
) -> dict[str, Any]:
    """Read exact bounded evidence bytes without granting review/bind authority.

    The managed control root is trusted. Directory-relative no-follow opens
    retain each path component; every binding is rechecked before returning.
    The future bind/close caller must still verify independent review, current
    target/anchor/config/ref facts and keep its locks through the state write.
    An expected file hash alone proves neither a reviewer nor permission.
    """
    import stat

    def invalid(code: str = 'LEGACY_COMMON_CONFIG_EVIDENCE_FILE_INVALID') -> None:
        raise PublicationError(code)
    try:
        root_path = Path(root)
        if (not root_path.is_absolute() or '..' in root_path.parts
                or type(evidence_path) is not str or not 0 < len(evidence_path) <= 4096
                or '\x00' in evidence_path or type(evidence_sha256) is not str
                or not SHA64_RE.fullmatch(evidence_sha256)):
            invalid('LEGACY_COMMON_CONFIG_EVIDENCE_FILE_PATH_INVALID')
        path = Path(evidence_path)
        if str(path) != evidence_path or '..' in path.parts:
            invalid('LEGACY_COMMON_CONFIG_EVIDENCE_FILE_PATH_INVALID')
        relative = path.relative_to(root_path)
        if not relative.parts:
            invalid('LEGACY_COMMON_CONFIG_EVIDENCE_FILE_PATH_INVALID')
    except (TypeError, ValueError):
        invalid('LEGACY_COMMON_CONFIG_EVIDENCE_FILE_PATH_INVALID')

    descriptors: list[int] = []
    bindings: list[tuple[int | None, str, Any]] = []
    directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
    def identity(info: Any) -> tuple[int, int]:
        return info.st_dev, info.st_ino
    def fingerprint(info: Any) -> tuple[int, ...]:
        return (*identity(info), info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    try:
        parent = os.open(str(root_path), directory_flags)
        descriptors.append(parent)
        root_info = os.fstat(parent)
        if not stat.S_ISDIR(root_info.st_mode):
            invalid()
        bindings.append((None, str(root_path), root_info))
        for component in relative.parts[:-1]:
            child = os.open(component, directory_flags, dir_fd=parent)
            descriptors.append(child)
            child_info = os.fstat(child)
            if not stat.S_ISDIR(child_info.st_mode):
                invalid()
            bindings.append((parent, component, child_info))
            parent = child
        descriptor = os.open(relative.name, os.O_RDONLY | os.O_NOFOLLOW |
                             os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
        descriptors.append(descriptor)
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 65536:
            invalid()
        raw = b''
        while len(raw) <= 65536:
            part = os.read(descriptor, 65537 - len(raw))
            if not part:
                break
            raw += part
        after = os.fstat(descriptor)
        if (len(raw) != before.st_size or len(raw) > 65536
                or fingerprint(before) != fingerprint(after)
                or _sha_bytes(raw) != evidence_sha256):
            invalid('LEGACY_COMMON_CONFIG_EVIDENCE_FILE_DRIFT')
        for parent_fd, name, original in bindings:
            current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
            if not stat.S_ISDIR(current.st_mode) or identity(current) != identity(original):
                invalid('LEGACY_COMMON_CONFIG_EVIDENCE_FILE_DRIFT')
        current = os.stat(relative.name, dir_fd=parent, follow_symlinks=False)
        if not stat.S_ISREG(current.st_mode) or fingerprint(current) != fingerprint(after):
            invalid('LEGACY_COMMON_CONFIG_EVIDENCE_FILE_DRIFT')
    except (OSError, UnicodeError, ValueError):
        invalid()
    finally:
        close_failed = False
        for descriptor in reversed(descriptors):
            try:
                os.close(descriptor)
            except OSError:
                close_failed = True
        if close_failed:
            invalid()

    def unique_pairs(items: Any) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, item in items:
            if key in result:
                invalid()
            result[key] = item
        return result
    try:
        parsed = json.loads(raw.decode('utf-8'), object_pairs_hook=unique_pairs,
                            parse_constant=lambda _: invalid())
        evidence = _legacy_common_config_evidence_shape(parsed)
    except (PublicationError, ValueError, UnicodeError, RecursionError, TypeError):
        invalid()
    return {'reference': {'path': evidence_path, 'sha256': evidence_sha256},
            'evidence': evidence}


def _legacy_common_config_receipt_checkpoint(
    registration: dict[str, Any], checkpoint: Any,
) -> None:
    """Validate an archived checkpoint against journal bytes, not live authority."""
    from datetime import datetime
    from pathlib import PurePosixPath
    try:
        authority = registration['legacy_common_config_authority']
        if (type(authority) is not dict or set(authority) != {'current', 'history'}
                or type(authority['history']) is not list):
            raise ValueError('authority shape')
        for binding in [*authority['history'], authority['current']]:
            if type(binding) is not dict or set(binding) != {'evidence', 'identity', 'anchor_created_at'}:
                raise ValueError('binding shape')
            identity = _legacy_common_config_evidence_shape(binding['identity'])
            if identity['target_registration_id'] != registration['registration_id']:
                raise ValueError('binding target')
            reference = binding['evidence']
            if type(reference) is not dict or set(reference) != {'path', 'sha256'}:
                raise ValueError('reference shape')
            path, digest = reference['path'], reference['sha256']
            if (type(path) is not str or not 0 < len(path) <= 4096
                    or not path.startswith('/') or path.startswith('//') or path != path.strip()
                    or '\\' in path or '..' in PurePosixPath(path).parts
                    or any(ord(char) < 32 or ord(char) == 127 for char in path)
                    or type(digest) is not str or not SHA64_RE.fullmatch(digest)):
                raise ValueError('reference identity')
            anchor_time = binding['anchor_created_at']
            if (type(anchor_time) is not str
                    or datetime.fromisoformat(anchor_time.replace('Z', '+00:00')).utcoffset() is None):
                raise ValueError('anchor timestamp')
        current = authority['current']; identity = current['identity']
        expected = {
            'kind': 'octoport.legacy-common-config-close-checkpoint', 'version': 1,
            'target_registration_id': identity['target_registration_id'], 'evidence': current['evidence'],
            'anchor_registration_id': identity['anchor_registration_id'],
            'anchor_state_version': identity['anchor_state_version'],
            'anchor_state_sha256': identity['anchor_state_sha256'],
            'anchor_close_receipt_sha256': identity['anchor_close_receipt_sha256'],
            'binding_current_sha256': _sha_bytes(_canonical_bytes(current)),
            'binding_history_sha256': _sha_bytes(_canonical_bytes(authority['history'])),
            'authority_sha256': _sha_bytes(_canonical_bytes(authority)),
        }
        if type(checkpoint) is not dict or _canonical_bytes(checkpoint) != _canonical_bytes(expected):
            raise ValueError('checkpoint mismatch')
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError, PublicationError):
        raise PublicationError('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID') from None


def _legacy_common_config_validate_close_receipt_payload(
    registration: dict[str, Any], receipt: Any,
) -> None:
    """Validate representation and captured config only, not time or authority."""
    def invalid() -> None:
        raise PublicationError('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID')
    def config_entry(value: Any) -> bool:
        return (type(value) is dict and set(value) == {'present', 'values'}
                and type(value['present']) is bool and type(value['values']) is list
                and all(type(v) is str for v in value['values'])
                and (value['present'] or not value['values']))
    try:
        if type(receipt) is not dict or type(receipt.get('version')) is not int:
            invalid()
        version = receipt['version']
        common = {'kind', 'version', 'registration_id', 'state_before',
                  'worktree_config_sha256_after', 'created_at'}
        extras = {'before', 'installed', 'final'} if version == 1 else {'config_sha256', 'legacy_checkpoint'}
        if (version not in (1, 2) or set(receipt) != common | extras
                or receipt['kind'] != 'octoport.task-publication-close'
                or receipt['registration_id'] != registration['registration_id']
                or type(receipt['state_before']) is not str
                or receipt['state_before'] not in {'PUBLISHED', 'REVOKED', 'FAILED'}
                or type(receipt['worktree_config_sha256_after']) is not str
                or not SHA64_RE.fullmatch(receipt['worktree_config_sha256_after'])):
            invalid()
        core, installed = registration['core'], registration['installed_config']
        keys = installed['owned_keys']
        if (type(keys) is not list or len(keys) != 2
                or any(type(k) is not str for k in keys)
                or set(keys) != {'core.hooksPath', 'remote.origin.pushurl'}):
            invalid()
        prior = {k: core['prior_config'][k] for k in keys}
        captured = {k: installed[k] for k in keys}
        if not all(config_entry(item) for item in [*prior.values(), *captured.values()]):
            invalid()
        if version == 1:
            for name in ('before', 'installed', 'final'):
                if type(receipt[name]) is not dict or set(receipt[name]) != set(keys):
                    invalid()
            for key in keys:
                if (not all(config_entry(receipt[name][key]) for name in ('before', 'installed', 'final'))
                        or receipt['final'][key] != prior[key] or receipt['installed'][key] != captured[key]
                        or receipt['before'][key] not in (prior[key], captured[key])):
                    invalid()
        else:
            values = receipt['config_sha256']
            if type(values) is not dict or set(values) != {'before', 'installed', 'final'}:
                invalid()
            for name in ('before', 'installed', 'final'):
                if (type(values[name]) is not dict or set(values[name]) != set(keys)
                        or any(type(v) is not str or not SHA64_RE.fullmatch(v) for v in values[name].values())):
                    invalid()
            for key in keys:
                old_hash = _sha_bytes(_canonical_bytes(prior[key]))
                installed_hash = _sha_bytes(_canonical_bytes(captured[key]))
                if (values['final'][key] != old_hash or values['installed'][key] != installed_hash
                        or values['before'][key] not in (old_hash, installed_hash)):
                    invalid()
            _legacy_common_config_receipt_checkpoint(registration, receipt['legacy_checkpoint'])
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
        invalid()


def _legacy_common_config_validate_close_receipt(
    registration: dict[str, Any], receipt: Any,
) -> None:
    """Validate a completed archive; a future observation is never an archive."""
    from datetime import datetime
    _legacy_common_config_validate_close_receipt_payload(registration, receipt)
    try:
        raw_times = [registration['created_at'], receipt['created_at'], registration['updated_at']]
        if any(type(value) is not str for value in raw_times):
            raise ValueError('timestamp type')
        created, closed, updated = [datetime.fromisoformat(value.replace('Z', '+00:00'))
                                    for value in raw_times]
        if any(value.utcoffset() is None for value in (created, closed, updated)):
            raise ValueError('timezone required')
        if not created <= closed <= updated:
            raise PublicationError('LEGACY_COMMON_CONFIG_ANCHOR_ORDER_INVALID')
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError):
        raise PublicationError('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID') from None


def _legacy_common_config_construct_close_receipt(
    registration: dict[str, Any], before: Any, after: Any,
    worktree_config_sha256_after: str, checkpoint: Any,
) -> dict[str, Any]:
    """Construct an unpersisted v2 observation before the CLOSED transition.

    This is not archival validation or authority to close. The caller must
    obtain before/after/config observations, validate current legacy authority
    under its locks, persist the exact intent and receipt, and use the normal
    version-checked journal transition. No registration timestamp is changed.
    Archived receipts must still pass _legacy_common_config_validate_close_receipt.
    """
    from datetime import datetime, timezone
    try:
        if (type(registration) is not dict or type(registration.get('state')) is not str
                or registration['state'] not in {'PUBLISHED', 'REVOKED', 'FAILED'}):
            raise ValueError('close prestate')
        raw_times = [registration['created_at'], registration['updated_at']]
        if any(type(value) is not str for value in raw_times):
            raise ValueError('timestamp type')
        created, updated = [datetime.fromisoformat(value.replace('Z', '+00:00'))
                            for value in raw_times]
        if any(value.utcoffset() is None for value in (created, updated)):
            raise ValueError('timezone required')
        # Journal state transitions use whole UTC seconds. Matching precision
        # permits a truthful receipt and CLOSED transition in the same second.
        observed = datetime.fromtimestamp(time.time(), timezone.utc).replace(microsecond=0)
        if not created <= updated <= observed:
            raise PublicationError('LEGACY_COMMON_CONFIG_CLOSE_OBSERVATION_ORDER_INVALID')
        installed = registration['installed_config']
        ordinary = {
            'kind': 'octoport.task-publication-close', 'version': 1,
            'registration_id': registration['registration_id'],
            'state_before': registration['state'],
            'before': before, 'installed': {key: installed[key] for key in installed['owned_keys']},
            'final': after, 'worktree_config_sha256_after': worktree_config_sha256_after,
            'created_at': observed.strftime('%Y-%m-%dT%H:%M:%SZ'),
        }
    except (KeyError, TypeError, ValueError, OverflowError, OSError):
        raise PublicationError('LEGACY_COMMON_CONFIG_CLOSE_OBSERVATION_INVALID') from None
    _legacy_common_config_validate_close_receipt_payload(registration, ordinary)
    _legacy_common_config_receipt_checkpoint(registration, checkpoint)
    result = {name: ordinary[name] for name in (
        'kind', 'registration_id', 'state_before', 'worktree_config_sha256_after', 'created_at')}
    result.update(version=2, config_sha256={
        name: {key: _sha_bytes(_canonical_bytes(value)) for key, value in ordinary[name].items()}
        for name in ('before', 'installed', 'final')
    }, legacy_checkpoint=checkpoint)
    return json.loads(_canonical_bytes(result))




def _legacy_common_config_redacted_close_receipt(
    registration: dict[str, Any], ordinary_receipt: Any, checkpoint: Any,
) -> dict[str, Any]:
    """Encode a verified close observation without raw config values.

    Pure format conversion only. The caller still owns observation, permission,
    immutable intent, safe persistence and recovery; this never rewrites a file.
    Registration timestamps must cover the completed close observation.
    """
    _legacy_common_config_validate_close_receipt(registration, ordinary_receipt)
    if ordinary_receipt['version'] != 1:
        raise PublicationError('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID')
    _legacy_common_config_receipt_checkpoint(registration, checkpoint)
    result = {name: ordinary_receipt[name] for name in (
        'kind', 'registration_id', 'state_before', 'worktree_config_sha256_after', 'created_at')}
    result.update(version=2, config_sha256={
        name: {key: _sha_bytes(_canonical_bytes(value)) for key, value in ordinary_receipt[name].items()}
        for name in ('before', 'installed', 'final')
    }, legacy_checkpoint=checkpoint)
    return json.loads(_canonical_bytes(result))


def _legacy_common_config_anchor_snapshot(
    root: Path, target_registration: dict[str, Any], value: Any,
) -> dict[str, Any]:
    """Read a pinned CLOSED anchor and its actual canonical close receipt.

    Call only while holding the existing role/coordination locks and after
    validating the target registration. No caller-supplied 'valid' flag is
    trusted. This observes terminal-artifact identity, not reviewer provenance,
    current configuration/transport compatibility, or Git ancestry; bind/close
    must verify those remaining facts separately before any state write.
    """
    import stat
    from datetime import datetime

    evidence = _legacy_common_config_evidence_shape(value)
    def invalid(code: str = 'LEGACY_COMMON_CONFIG_ANCHOR_SNAPSHOT_INVALID') -> None:
        raise PublicationError(code)
    def timestamp(raw: Any) -> datetime:
        if type(raw) is not str:
            invalid()
        try:
            parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
            if parsed.utcoffset() is None:
                invalid()
            return parsed
        except (ValueError, TypeError, OverflowError):
            invalid()
        raise AssertionError('unreachable')
    try:
        target_id = target_registration['registration_id']
        target_time = timestamp(target_registration['created_at'])
    except (KeyError, TypeError):
        invalid()
    if target_id != evidence['target_registration_id']:
        invalid()
    anchor_id = evidence['anchor_registration_id']
    try:
        anchor, state_sha = _read_registration(root, anchor_id)
    except (PublicationError, OSError, ValueError, TypeError):
        invalid('LEGACY_COMMON_CONFIG_ANCHOR_UNAVAILABLE')
    if type(anchor) is not dict:
        invalid()
    if (anchor.get('state') != 'CLOSED'
            or type(anchor.get('state_version')) is not int
            or anchor['state_version'] != evidence['anchor_state_version']
            or state_sha != evidence['anchor_state_sha256']
            or anchor.get('registration_id') != anchor_id
            or anchor.get('registration_sha256') != anchor_id):
        invalid()
    anchor_time = timestamp(anchor.get('created_at'))
    if anchor_time <= target_time:
        invalid('LEGACY_COMMON_CONFIG_ANCHOR_ORDER_INVALID')
    try:
        core, installed = anchor['core'], anchor['installed_config']
        fixed = core['fixed_role_config_sha256']
        if (type(core) is not dict or type(installed) is not dict
                or core['candidate_head'] != evidence['anchor_candidate_sha']
                or type(fixed) is not dict or set(fixed) != {'A', 'B', 'C'}):
            invalid()
        anchor_transport = _legacy_common_config_transport_hashes(core)
        for digest in [core['common_config_sha256'], core['global_config_sha256'], *fixed.values()]:
            if type(digest) is not str or not SHA64_RE.fullmatch(digest):
                invalid()
        keys = installed['owned_keys']
        if (type(keys) is not list or len(keys) != 2
                or any(type(key) is not str for key in keys)
                or set(keys) != {'core.hooksPath', 'remote.origin.pushurl'}):
            invalid()
        reference = anchor['close_receipt']
        if (type(reference) is not dict or set(reference) != {'path', 'sha256'}
                or reference['sha256'] != evidence['anchor_close_receipt_sha256']):
            invalid()
    except (KeyError, TypeError):
        invalid()
    canonical_root = Path(root).resolve()
    close_root = canonical_root / 'controllers' / 'task-publication' / 'close' / anchor_id
    receipt_path = close_root / 'receipt.json'
    if reference['path'] != str(receipt_path):
        invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_PATH_INVALID')
    # Keep the whole canonical directory chain pinned through schema checking
    # and the final registration readback, not just through the initial open.
    from contextlib import contextmanager

    @contextmanager
    def pinned_receipt_bytes():
        descriptors: list[int] = []
        bindings: list[tuple[int | None, str, Any]] = []
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC

        def identity(info: Any) -> tuple[int, int]:
            return info.st_dev, info.st_ino

        def fingerprint(info: Any) -> tuple[int, ...]:
            return (*identity(info), info.st_size, info.st_mtime_ns, info.st_ctime_ns)

        try:
            directory = os.open(str(canonical_root), directory_flags)
            descriptors.append(directory)
            root_info = os.fstat(directory)
            if not stat.S_ISDIR(root_info.st_mode):
                invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_PATH_INVALID')
            bindings.append((None, str(canonical_root), root_info))
            for component in ('controllers', 'task-publication', 'close', anchor_id):
                child = os.open(component, directory_flags, dir_fd=directory)
                descriptors.append(child)
                child_info = os.fstat(child)
                if not stat.S_ISDIR(child_info.st_mode):
                    invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_PATH_INVALID')
                bindings.append((directory, component, child_info))
                directory = child
            descriptor = os.open('receipt.json', os.O_RDONLY | os.O_NOFOLLOW |
                                 os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
            descriptors.append(descriptor)
            before = os.fstat(descriptor)
            if not stat.S_ISREG(before.st_mode) or not 0 < before.st_size <= 65536:
                invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID')
            raw = b''
            while len(raw) <= 65536:
                part = os.read(descriptor, 65537 - len(raw))
                if not part:
                    break
                raw += part
            after = os.fstat(descriptor)
            if (len(raw) != before.st_size or len(raw) > 65536
                    or fingerprint(before) != fingerprint(after)
                    or _sha_bytes(raw) != reference['sha256']):
                invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_DRIFT')

            def verify_bindings(code: str) -> None:
                try:
                    for parent_fd, name, original in bindings:
                        current = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
                        if not stat.S_ISDIR(current.st_mode) or identity(current) != identity(original):
                            invalid(code)
                    leaf = os.stat('receipt.json', dir_fd=directory, follow_symlinks=False)
                    if (not stat.S_ISREG(leaf.st_mode)
                            or fingerprint(leaf) != fingerprint(after)
                            or fingerprint(os.fstat(descriptor)) != fingerprint(after)):
                        invalid(code)
                except OSError:
                    invalid(code)

            verify_bindings('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_DRIFT')
            yield raw
            verify_bindings('LEGACY_COMMON_CONFIG_ANCHOR_SNAPSHOT_DRIFT')
        except (OSError, ValueError, UnicodeError):
            invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID')
        finally:
            close_failed = False
            for descriptor in reversed(descriptors):
                try:
                    os.close(descriptor)
                except OSError:
                    close_failed = True
            if close_failed:
                invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID')

    with pinned_receipt_bytes() as raw:
        def pairs(items: Any) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, item in items:
                if key in result:
                    invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID')
                result[key] = item
            return result
        try:
            receipt = json.loads(raw, object_pairs_hook=pairs,
                                 parse_constant=lambda _: invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID'))
        except (ValueError, UnicodeError, RecursionError):
            invalid('LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID')
        _legacy_common_config_validate_close_receipt(anchor, receipt)
        # Do not return a stale artifact after an intervening registration change.
        try:
            current, current_sha = _read_registration(root, anchor_id)
        except (PublicationError, OSError, ValueError, TypeError):
            invalid('LEGACY_COMMON_CONFIG_ANCHOR_UNAVAILABLE')
        if current_sha != state_sha or _canonical_bytes(current) != _canonical_bytes(anchor):
            invalid('LEGACY_COMMON_CONFIG_ANCHOR_SNAPSHOT_DRIFT')
        return {'anchor_registration_id': anchor_id, 'anchor_state': 'CLOSED',
                'anchor_state_version': anchor['state_version'], 'anchor_state_sha256': state_sha,
                'anchor_candidate_sha': core['candidate_head'], 'anchor_created_at': anchor['created_at'],
                'anchor_close_receipt_sha256': reference['sha256'], 'anchor_close_receipt_valid': True,
                'anchor_common_config_sha256': core['common_config_sha256'],
                'anchor_global_config_sha256': core['global_config_sha256'],
                'anchor_fixed_role_config_sha256': dict(fixed),
                'anchor_remote_identity_sha256': anchor_transport['remote_identity_sha256'],
                'anchor_push_identity_sha256': anchor_transport['push_identity_sha256'],
                'anchor_pushurl_identity_sha256': anchor_transport['pushurl_identity_sha256']}


def bind_legacy_common_config_authority(
    root: Path, registration_id: str, evidence_path: str, evidence_sha256: str,
    review_observation: Any,
) -> dict[str, Any]:
    """Bind/rebind close authority using a separately authenticated review observation.

    The caller must obtain review_observation independently from the evidence
    being bound. This function never derives reviewer provenance from
    evidence["review"] and is not yet exposed by the public CLI.
    """
    first, _ = _read_registration(root, registration_id)
    try:
        role = first["core"]["role"]
    except (KeyError, TypeError):
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_REGISTRATION_INVALID") from None
    if role not in {"A", "B", "C"}:
        raise PublicationError("LEGACY_COMMON_CONFIG_BIND_REGISTRATION_INVALID")

    with _role_and_coord_locks(root, role):
        registration, _ = _read_registration(root, registration_id)
        if (registration.get("registration_id") != registration_id
                or registration.get("registration_sha256") != registration_id):
            raise PublicationError("LEGACY_COMMON_CONFIG_BIND_CAS_DRIFT")
        state = registration.get("state")
        if state not in {"TASK_REF_PUBLISHED", "PUBLISHED", "REVOKED", "FAILED"}:
            raise PublicationError("LEGACY_COMMON_CONFIG_BIND_STATE_INVALID")

        snapshot = _legacy_common_config_evidence_snapshot(
            root, evidence_path, evidence_sha256)
        evidence = snapshot["evidence"]
        reference = snapshot["reference"]
        if evidence["target_registration_id"] != registration_id:
            raise PublicationError("LEGACY_COMMON_CONFIG_TARGET_IDENTITY_MISMATCH")

        anchor = _legacy_common_config_anchor_snapshot(root, registration, evidence)
        observed = _legacy_common_config_current_observation(
            root, registration, evidence, anchor, review_observation)
        facts = _legacy_common_config_target_facts(root, registration)
        transition = _legacy_common_config_binding_transition(
            evidence, observed, reference,
            registration.get("legacy_common_config_authority"), facts)
        return _legacy_common_config_apply_binding_transition_locked(
            root, registration_id, registration, transition)


def _legacy_common_config_close_context(
    root: Path, registration: dict[str, Any], frozen_checkpoint: Any = None,
) -> dict[str, Any]:
    """Revalidate persisted legacy authority for close without mutating state."""
    from copy import deepcopy
    try:
        authority = registration["legacy_common_config_authority"]
        current = authority["current"]
        reference = current["evidence"]
        persisted_identity = _legacy_common_config_evidence_shape(current["identity"])
        review_observation = deepcopy(persisted_identity["review"])
        if (type(reference) is not dict or set(reference) != {"path", "sha256"}
                or type(current.get("anchor_created_at")) is not str):
            raise ValueError("binding shape")
    except (KeyError, TypeError, ValueError, PublicationError):
        raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_AUTHORITY_INVALID") from None

    snapshot = _legacy_common_config_evidence_snapshot(
        root, reference["path"], reference["sha256"])
    if _canonical_bytes(snapshot["evidence"]) != _canonical_bytes(persisted_identity):
        raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_BINDING_MISMATCH")

    anchor = _legacy_common_config_anchor_snapshot(
        root, registration, snapshot["evidence"])
    observed = _legacy_common_config_current_observation(
        root, registration, snapshot["evidence"], anchor, review_observation)
    checkpoint = _legacy_common_config_close_checkpoint(
        snapshot["evidence"], observed, snapshot["reference"], authority,
        frozen_checkpoint=frozen_checkpoint)
    return {
        "snapshot": snapshot,
        "anchor": anchor,
        "observed": observed,
        "checkpoint": checkpoint,
    }


def _legacy_common_config_ref_oid(registration: dict[str, Any]) -> str:
    """Observe exact task-ref state for legacy close; never mutate the ref."""
    try:
        core = registration["core"]
        worktree = Path(core["worktree_path"])
        value = _supersede_remote_state(
            worktree, core["push_target"], core["task_ref"], core["candidate_head"])
    except (KeyError, TypeError, ValueError, OSError, subprocess.SubprocessError, PublicationError):
        raise PublicationError("LEGACY_COMMON_CONFIG_REF_OBSERVATION_FAILED") from None
    if type(value) is not str or not SHA40_RE.fullmatch(value):
        raise PublicationError("LEGACY_COMMON_CONFIG_REF_OBSERVATION_FAILED")
    return value


def _legacy_common_config_close_intent(
    registration: dict[str, Any], checkpoint: Any,
) -> dict[str, Any]:
    """Freeze value-free legacy close recovery identity."""
    try:
        installed = registration["installed_config"]
        prior = registration["core"]["prior_config"]
        keys = installed["owned_keys"]
        if (type(keys) is not list or len(keys) != 2
                or set(keys) != {"core.hooksPath", "remote.origin.pushurl"}):
            raise ValueError("owned keys")
        digests = {
            "prior": {key: _sha_bytes(_canonical_bytes(prior[key])) for key in keys},
            "installed": {key: _sha_bytes(_canonical_bytes(installed[key])) for key in keys},
        }
        value = {
            "kind": "octoport.task-publication-legacy-close-intent",
            "version": 1,
            "registration_id": registration["registration_id"],
            "registration_sha256": registration["registration_sha256"],
            "state_before": registration["state"],
            "state_version": registration["state_version"],
            "config_sha256": digests,
            "legacy_checkpoint": checkpoint,
        }
        _legacy_common_config_receipt_checkpoint(registration, checkpoint)
        return json.loads(_canonical_bytes(value))
    except (KeyError, TypeError, ValueError, OverflowError, RecursionError, PublicationError):
        raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_INTENT_INVALID") from None


def _legacy_common_config_worktree_clean(worktree: Path) -> None:
    try:
        result = subprocess.run(
            [AUTHORITY_GIT_BIN, "-C", str(worktree), "status", "--porcelain",
             "--untracked-files=normal"],
            cwd="/", env=sanitized_git_authority_env(), capture_output=True,
            text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.SubprocessError, UnicodeError):
        raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_GUARD_UNVERIFIED") from None
    if result.returncode != 0 or type(result.stdout) is not str or result.stdout.strip():
        raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_GUARD_UNVERIFIED")


def _legacy_common_config_close_locked(
    root: Path, registration: dict[str, Any], worktree: Path,
    installed: dict[str, Any], prior: dict[str, Any], owned_keys: list[str],
    close_receipt_path: Path, close_intent_path: Path,
) -> dict[str, Any]:
    """Close through persisted legacy authority; caller holds role+coord locks."""
    from copy import deepcopy
    registration_id = registration["registration_id"]
    if "legacy_common_config_authority" not in registration:
        raise PublicationError("COMMON_CONFIG_DRIFT")

    intent = None
    if close_intent_path.exists() or close_intent_path.is_symlink():
        if close_intent_path.is_symlink() or not close_intent_path.is_file():
            raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_INTENT_INVALID")
        try:
            intent = _load_json(close_intent_path)
            frozen = intent["legacy_checkpoint"]
        except (KeyError, TypeError, ValueError, OSError):
            raise PublicationError("LEGACY_COMMON_CONFIG_CLOSE_INTENT_INVALID") from None
    else:
        frozen = None

    context = _legacy_common_config_close_context(
        root, registration, frozen_checkpoint=frozen)
    checkpoint = context["checkpoint"]
    expected_intent = _legacy_common_config_close_intent(
        registration, checkpoint)
    if intent is not None and _canonical_bytes(intent) != _canonical_bytes(expected_intent):
        raise PublicationError("CLOSE_INTENT_DRIFT")

    _legacy_common_config_worktree_clean(worktree)
    if _legacy_common_config_ref_oid(registration) != ZERO_OID:
        raise PublicationError("LEGACY_COMMON_CONFIG_TASK_REF_PRESENT")

    before = {key: _config_values(worktree, key) for key in owned_keys}
    recovering = intent is not None
    for key in owned_keys:
        if (before[key] != installed[key]
                and not (recovering and before[key] == prior[key])):
            raise PublicationError(f"ROUTE_CONFIG_SAME_KEY_DRIFT:{key}")

    # Slow authority/ref observations happened above. Revalidate the exact
    # frozen binding and ref immediately before freezing the intent or mutating
    # config. A failed second observation therefore does not strand an intent.
    _legacy_common_config_close_context(
        root, registration, frozen_checkpoint=checkpoint)
    if _legacy_common_config_ref_oid(registration) != ZERO_OID:
        raise PublicationError("LEGACY_COMMON_CONFIG_TASK_REF_PRESENT")
    _legacy_common_config_worktree_clean(worktree)
    before = {key: _config_values(worktree, key) for key in owned_keys}
    for key in owned_keys:
        if (before[key] != installed[key]
                and not (recovering and before[key] == prior[key])):
            raise PublicationError(f"ROUTE_CONFIG_SAME_KEY_DRIFT:{key}")
    if intent is None:
        _create_once_json(close_intent_path, expected_intent)

    if close_receipt_path.exists() or close_receipt_path.is_symlink():
        if close_receipt_path.is_symlink() or not close_receipt_path.is_file():
            raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID")
        receipt = _load_json(close_receipt_path)
        _legacy_common_config_validate_close_receipt_payload(registration, receipt)
        if (receipt.get("version") != 2
                or _canonical_bytes(receipt.get("legacy_checkpoint"))
                   != _canonical_bytes(checkpoint)):
            raise PublicationError("LEGACY_COMMON_CONFIG_ANCHOR_RECEIPT_INVALID")
        for key in owned_keys:
            if _config_values(worktree, key) != prior[key]:
                raise PublicationError("CLOSE_RECEIPT_CONFIG_NOT_RESTORED")
    else:
        for key in owned_keys:
            _set_config_values(worktree, key, prior[key])
        after = {key: _config_values(worktree, key) for key in owned_keys}
        if any(after[key] != prior[key] for key in owned_keys):
            raise PublicationError("CLOSE_RECEIPT_CONFIG_NOT_RESTORED")
        receipt = _legacy_common_config_construct_close_receipt(
            registration, before, after, _worktree_config_digest(worktree),
            checkpoint)
        _create_once_json(close_receipt_path, receipt)

    # Validate the archive time boundary against the exact state-transition
    # second before committing CLOSED. _state_transition uses the same UTC
    # second precision and may only advance this timestamp.
    projected = deepcopy(registration)
    projected["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _legacy_common_config_validate_close_receipt(projected, receipt)
    return _state_transition(
        root, registration_id, {registration["state"]}, "CLOSED",
        {"close_receipt": {
            "path": str(close_receipt_path),
            "sha256": _sha_file(close_receipt_path),
        }},
        expected_version=registration["state_version"],
    )


def close_registration(root: Path, registration_id: str) -> dict[str, Any]:
    reg, _ = _read_registration(root, registration_id)
    role = reg["core"]["role"]
    with _role_and_coord_locks(root, role):
        reg, _ = _read_registration(root, registration_id)
        if reg.get("state") == "CLOSED":
            return reg
        if reg.get("state") not in {"PUBLISHED", "REVOKED", "FAILED"}:
            raise PublicationError("CLOSE_PRESTATE_INVALID")
        if not _no_armed_leases(root, registration_id):
            raise PublicationError("CLOSE_ARMED_LEASE_PRESENT")
        core = reg["core"]
        worktree = Path(core["worktree_path"])
        installed = reg.get("installed_config", {})
        prior = core["prior_config"]
        owned_keys = installed.get("owned_keys", [])
        close_root = _close_dir(root, registration_id)
        close_receipt_path = close_root / "receipt.json"
        close_intent_path = close_root / "intent.json"

        # Config/global drift checks before destructive restore. Normal creation
        # of later worktree branches may append only branch remote/merge
        # tracking sections; every other common-config change remains fail-closed.
        if not _common_config_matches_registered(worktree, core["common_config_sha256"]):
            next_reg = _legacy_common_config_close_locked(
                root, reg, worktree, installed, prior, owned_keys,
                close_receipt_path, close_intent_path)
            pointer = _active_pointer_path(root, worktree)
            if pointer.is_file():
                ptr = _load_json(pointer)
                if ptr.get("registration_id") != registration_id:
                    raise PublicationError("ACTIVE_POINTER_FOREIGN_ON_CLOSE")
                pointer.unlink()
                _fsync_dir(pointer.parent)
            return next_reg
        if _global_config_digest() != core["global_config_sha256"]:
            raise PublicationError("GLOBAL_CONFIG_DRIFT")
        ownership, _ = _ownership(worktree)
        if _fixed_role_config_digests(ownership) != core["fixed_role_config_sha256"]:
            raise PublicationError("FIXED_ROLE_CONFIG_DRIFT")

        # Idempotent crash recovery: if close receipt exists, only finalize when current
        # values already equal captured prior values.
        if close_receipt_path.exists():
            receipt = _load_json(close_receipt_path)
            for key in owned_keys:
                if _config_values(worktree, key) != prior[key]:
                    raise PublicationError("CLOSE_RECEIPT_CONFIG_NOT_RESTORED")
            next_reg = _state_transition(
                root, registration_id, {reg["state"]}, "CLOSED",
                {"close_receipt": {"path": str(close_receipt_path), "sha256": _sha_file(close_receipt_path)}},
                expected_version=reg["state_version"],
            )
        else:
            before = {key: _config_values(worktree, key) for key in owned_keys}
            intent = {"registration_id": registration_id, "registration_sha256": reg["registration_sha256"],
                "prior": {key: prior[key] for key in owned_keys},
                "installed": {key: installed[key] for key in owned_keys}}
            recovering_close = close_intent_path.exists()
            if recovering_close and _load_json(close_intent_path) != intent:
                raise PublicationError("CLOSE_INTENT_DRIFT")
            for key in owned_keys:
                if before[key] != installed[key] and not (recovering_close and before[key] == prior[key]):
                    raise PublicationError(f"ROUTE_CONFIG_SAME_KEY_DRIFT:{key}")
            if not recovering_close:
                _create_once_json(close_intent_path, intent)
            for key in owned_keys:
                _set_config_values(worktree, key, prior[key])
            after = {key: _config_values(worktree, key) for key in owned_keys}
            receipt = {
                "kind": "octoport.task-publication-close",
                "version": 1,
                "registration_id": registration_id,
                "state_before": reg["state"],
                "before": before,
                "installed": {key: installed[key] for key in owned_keys},
                "final": after,
                "worktree_config_sha256_after": _worktree_config_digest(worktree),
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }
            _create_once_json(close_receipt_path, receipt)
            next_reg = _state_transition(
                root, registration_id, {reg["state"]}, "CLOSED",
                {"close_receipt": {"path": str(close_receipt_path), "sha256": _sha_file(close_receipt_path)}},
                expected_version=reg["state_version"],
            )
        pointer = _active_pointer_path(root, worktree)
        if pointer.is_file():
            ptr = _load_json(pointer)
            if ptr.get("registration_id") != registration_id:
                raise PublicationError("ACTIVE_POINTER_FOREIGN_ON_CLOSE")
            pointer.unlink()
            _fsync_dir(pointer.parent)
        return next_reg


def complete_queue_registration(root: Path, registration_id: str, completion_receipt: str,
                                summary: str, route_source_root: Path) -> dict[str, Any]:
    registered, _ = _read_registration(root, registration_id)
    registered_core = registered.get("core", {})
    route_root = Path(route_source_root).resolve()
    authority = validate_queue_completion_source_authority(
        root,
        registration_id,
        route_root,
        registered_core.get("role"),
        registered_core.get("task_id"),
    )
    reg = authority["registration"]
    core = authority["core"]
    route_head = authority["route_head"]
    route_authority = authority["route_authority"]
    completion_bundle, completion_bundle_sha = _select_execution_completion_bundle(
        authority, Path(__file__), "task_publication.py"
    )

    role_location = _require_canonical_role_location(
        route_root, core["role"], authority["ownership"]
    )

    proof = Path(completion_receipt).resolve()
    try:
        relative = proof.relative_to(root.resolve())
    except ValueError:
        raise PublicationError("QUEUE_COMPLETE_RECEIPT_OUTSIDE_CONTROL") from None
    if (not proof.is_file() or not relative.parts
            or relative.parts[0] not in SAFE_CONTROL_TOP):
        raise PublicationError("QUEUE_COMPLETE_RECEIPT_INVALID")
    if not isinstance(summary, str) or not summary.strip():
        raise PublicationError("QUEUE_COMPLETE_SUMMARY_REQUIRED")

    result = _run_canonical_queue_completion(
        root,
        route_root,
        role_location,
        core["role"],
        core["task_id"],
        proof,
        summary,
        registration_id,
        completion_bundle,
        completion_bundle_sha,
    )
    return dict(
        result,
        publication_registration=registration_id,
        publication_candidate=core["candidate_head"],
        route_source_head=route_head,
        route_authority=route_authority,
        role_location=str(role_location),
        completion_bundle=str(completion_bundle),
        completion_bundle_manifest_sha256=completion_bundle_sha,
    )


def _hook_tuple(stdin: Iterable[str]) -> tuple[str, str, str, str]:
    rows = [line.strip().split() for line in stdin if line.strip()]
    if len(rows) != 1 or len(rows[0]) != 4:
        raise PublicationError("HOOK_SINGLE_REF_TUPLE_REQUIRED")
    return tuple(rows[0])  # type: ignore[return-value]


def hook_main(argv: list[str] | None = None, stdin: Iterable[str] | None = None) -> int:
    argv = list(sys.argv if argv is None else argv)
    stdin = sys.stdin if stdin is None else stdin
    try:
        root = _control_root()
        registration_id = os.environ.get("OCTOPORT_PUBLICATION_REGISTRATION_ID", "")
        nonce = os.environ.get("OCTOPORT_PUBLICATION_NONCE", "")
        push_kind = os.environ.get("OCTOPORT_PUBLICATION_KIND", "")
        expected_bundle_sha = os.environ.get("OCTOPORT_PUBLICATION_BUNDLE_MANIFEST_SHA256", "")
        if not registration_id or not nonce or push_kind not in TRANSIENT_STATES or not SHA64_RE.fullmatch(expected_bundle_sha):
            raise PublicationError("HOOK_ROUTE_ENV_REQUIRED")
        reg, _ = _read_registration(root, registration_id)
        core = reg["core"]
        worktree = Path(_git(Path.cwd(), "rev-parse", "--show-toplevel")).resolve()
        if worktree != Path(core["worktree_path"]).resolve():
            raise PublicationError("HOOK_WORKTREE_MISMATCH")
        pointer = _load_json(_active_pointer_path(root, worktree))
        if pointer.get("registration_id") != registration_id:
            raise PublicationError("HOOK_ACTIVE_POINTER_MISMATCH")
        if reg.get("state") != TRANSIENT_STATES[push_kind] or reg.get("current_nonce") != nonce:
            raise PublicationError("HOOK_REGISTRATION_STATE_MISMATCH")
        namespace, lease_path = _lease_namespace(root, registration_id, nonce)
        if namespace != "armed" or lease_path is None:
            raise PublicationError("HOOK_ARMED_LEASE_REQUIRED")
        lease = _load_json(lease_path)
        if _sha_file(lease_path) != reg.get("current_lease_sha256"):
            raise PublicationError("HOOK_LEASE_HASH_MISMATCH")
        if lease.get("registration_state_version_at_attempt") != reg.get("state_version"):
            raise PublicationError("HOOK_STATE_VERSION_MISMATCH")
        if lease.get("push_kind") != push_kind or lease.get("registration_sha256") != reg.get("registration_sha256"):
            raise PublicationError("HOOK_LEASE_IDENTITY_MISMATCH")
        _validate_lease_time(lease)
        if push_kind == "SUPERSEDE_TASK_REF":
            bundle = reg.get("supersede_bundle", {})
            evidence = reg.get("supersede_evidence", {})
            if (expected_bundle_sha != bundle.get("sha256") or
                    lease.get("execution_bundle_manifest_sha256") != expected_bundle_sha or
                    lease.get("supersede_evidence_sha256") != evidence.get("sha256")):
                raise PublicationError("HOOK_SUPERSEDE_BUNDLE_OR_EVIDENCE_DRIFT")
            bundle_path = Path(bundle.get("path", ""))
            _verify_bundle(bundle_path, expected_bundle_sha)
            if Path(__file__).resolve() != bundle_path / "task_publication.py":
                raise PublicationError("HOOK_EXECUTING_BUNDLE_MISMATCH")
            if (len(argv) != 3 or argv[2] != core["push_target"] or
                    argv[1] not in {core["remote"], core["push_target"]}):
                raise PublicationError("HOOK_PUSH_TARGET_MISMATCH")
            _validate_supersede_request(
                root, reg, evidence.get("path", ""), evidence.get("sha256", "")
            )
            ready_retirement = reg.get("ready_base_drift_retirement")
            if ready_retirement is not None:
                if not isinstance(ready_retirement, dict):
                    raise PublicationError("SUPERSEDE_READY_RETIREMENT_RECORD_INVALID")
                # Last irreversible boundary: a READY-originated retirement must
                # still have the exact route/config identity and the exact remote
                # main drift that justified revoking READY before this hook consumes
                # the deletion lease and send-pack can begin.
                _validate_ready_retirement_config(reg)
                current_main = _remote_oid_target(
                    worktree,
                    core["push_target"],
                    "refs/heads/main",
                    env=_supersede_transport_env(),
                )
                if current_main != ready_retirement.get("observed_remote_main"):
                    raise PublicationError("SUPERSEDE_READY_REMOTE_MAIN_DRIFT")
        else:
            if expected_bundle_sha != core["bundle_manifest_sha256"]:
                raise PublicationError("HOOK_BUNDLE_ENV_MISMATCH")
            _verify_bundle(Path(core["bundle_path"]), expected_bundle_sha)
            if Path(__file__).resolve() != Path(core["bundle_path"]) / "task_publication.py":
                raise PublicationError("HOOK_EXECUTING_BUNDLE_MISMATCH")
            if len(argv) != 3 or argv[1] != core["remote"] or argv[2] != core["push_target"]:
                raise PublicationError("HOOK_PUSH_TARGET_MISMATCH")
            _validate_registration_identity(root, reg)
            if push_kind == "MAIN":
                _validate_ready_receipt(root, reg)
            _require_role_running(root, core["role"])
            board = _load_board(root)
            task = _task_from_board(board, core["task_id"])
            if task.get("role") != core["role"] or task.get("state") != "IN_PROGRESS" or _task_fingerprint(task) != core["task_fingerprint"]:
                raise PublicationError("HOOK_TASK_FINGERPRINT_DRIFT")
        if not _clean(worktree) or _head(worktree) != core["candidate_head"] or _tree(worktree) != core["candidate_tree"]:
            raise PublicationError("HOOK_CANDIDATE_DRIFT")
        if _diff_paths(worktree, core["base_sha"], core["candidate_head"]) != core["changed_paths"]:
            raise PublicationError("HOOK_CHANGED_PATHS_DRIFT")

        local_ref, local_sha, remote_ref, remote_sha = _hook_tuple(stdin)
        if push_kind in {"CLEANUP_TASK_REF", "SUPERSEDE_TASK_REF"}:
            if local_sha != ZERO_OID:
                raise PublicationError("HOOK_CLEANUP_DELETE_LOCAL_SHA_REQUIRED")
        else:
            if local_sha != core["candidate_head"]:
                raise PublicationError("HOOK_LOCAL_SHA_MISMATCH")
            if local_ref not in {"HEAD", f"refs/heads/{_git(worktree, 'branch', '--show-current')}"}:
                raise PublicationError("HOOK_LOCAL_REF_MISMATCH")
        if remote_ref != lease["remote_ref"] or remote_sha != lease["expected_remote_old_oid"]:
            raise PublicationError("HOOK_REMOTE_CAS_MISMATCH")
        target = _lease_path(root, registration_id, "consumed", nonce)
        if not _rename_noreplace(lease_path, target):
            namespace, _ = _lease_namespace(root, registration_id, nonce)
            raise PublicationError(f"HOOK_LEASE_CONSUME_LOST:{namespace}")
        return 0
    except (PublicationError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"Octoport publication hook blocked: {error}", file=sys.stderr)
        return 1


def make_review_receipt(task_id: str, candidate: str, candidate_tree: str, base: str,
                        changed_paths: list[str], full_diff_sha: str, reviewer: str,
                        evidence: list[str], manifest_sha: str | None = None,
                        task_fingerprint: str | None = None) -> dict[str, Any]:
    return {
        "kind": "octoport.task-publication-review",
        "version": REVIEW_VERSION,
        "verdict": "PASS",
        "task_id": task_id,
        "candidate_sha": candidate,
        "candidate_tree": candidate_tree,
        "base_sha": base,
        "changed_paths": sorted(changed_paths),
        "full_diff_sha256": full_diff_sha,
        "reviewer": reviewer,
        "evidence": evidence,
        "accepted_manifest_sha256": manifest_sha,
        "task_fingerprint": task_fingerprint,
    }


def make_supersede_evidence(
    reg: dict[str, Any], verdict: str, reason: str, evidence: list[dict[str, str]],
    successor_sha: str | None = None,
) -> dict[str, Any]:
    core = reg["core"]
    return {
        "kind": "octoport.task-publication-supersede-evidence",
        "version": 1,
        "verdict": verdict,
        "registration_id": reg["registration_id"],
        "task_id": core["task_id"],
        "candidate_sha": core["candidate_head"],
        "candidate_tree": core["candidate_tree"],
        "task_ref": core["task_ref"],
        "reason": reason,
        "successor_sha": successor_sha,
        "evidence": evidence,
    }


def _json_print(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--control-root", default=os.environ.get("OCTOPORT_CONTROL_ROOT", "/root/octoport-control"))
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("reconstruct")
    p.add_argument("--manifest", required=True)
    p.add_argument("--manifest-sha", required=True)
    p.add_argument("--task", required=True)
    p.add_argument("--worktree", required=True)
    p.add_argument("--base", required=True)
    p.add_argument("--message", required=True)

    p = sub.add_parser("unblock")
    p.add_argument("--role", required=True)
    p.add_argument("--task", required=True)
    p.add_argument("--manifest", required=True)
    p.add_argument("--manifest-sha", required=True)
    p.add_argument("--worktree", required=True)

    p = sub.add_parser("register")
    p.add_argument("--role", required=True)
    p.add_argument("--task", required=True)
    p.add_argument("--worktree", required=True)
    p.add_argument("--base", required=True)
    p.add_argument("--review", required=True)
    p.add_argument("--review-sha", required=True)
    p.add_argument("--route-source-root", required=True)
    p.add_argument("--route-source-sha", required=True)
    p.add_argument("--route-source-tree", required=True)
    p.add_argument("--remote", default="origin")
    p.add_argument("--pushurl")
    p.add_argument("--manifest")
    p.add_argument("--manifest-sha")

    p = sub.add_parser("publish-task-ref")
    p.add_argument("--registration", required=True)
    p.add_argument("--ttl", type=int, default=DEFAULT_LEASE_SECONDS)
    p.add_argument("--timeout", type=int, default=DEFAULT_LEASE_SECONDS)

    p = sub.add_parser("ready")
    p.add_argument("--registration", required=True)
    p.add_argument("--ci-json")

    p = sub.add_parser("publish-main")
    p.add_argument("--registration", required=True)
    p.add_argument("--ttl", type=int, default=DEFAULT_LEASE_SECONDS)
    p.add_argument("--timeout", type=int, default=DEFAULT_LEASE_SECONDS)

    p = sub.add_parser("cleanup-ref")
    p.add_argument("--registration", required=True)
    p.add_argument("--ttl", type=int, default=DEFAULT_LEASE_SECONDS)
    p.add_argument("--timeout", type=int, default=DEFAULT_LEASE_SECONDS)

    p = sub.add_parser("supersede")
    p.add_argument("--registration", required=True)
    p.add_argument("--evidence", required=True)
    p.add_argument("--evidence-sha", required=True)
    p.add_argument("--route-source-root", required=True)
    p.add_argument("--route-source-sha", required=True)
    p.add_argument("--route-source-tree", required=True)
    p.add_argument("--ttl", type=int, default=DEFAULT_LEASE_SECONDS)
    p.add_argument("--timeout", type=int, default=DEFAULT_LEASE_SECONDS)

    p = sub.add_parser("recover")
    p.add_argument("--registration", required=True)

    p = sub.add_parser("close")
    p.add_argument("--registration", required=True)

    p = sub.add_parser("complete-queue")
    p.add_argument("--registration", required=True)
    p.add_argument("--receipt", required=True)
    p.add_argument("--summary", required=True)
    p.add_argument("--route-source-root", required=True)

    p = sub.add_parser("resolve-blocker")
    p.add_argument("--route-source-root", required=True)
    p.add_argument("--task", required=True)
    p.add_argument("--successor", required=True)
    p.add_argument("--receipt", required=True)

    p = sub.add_parser("show")
    p.add_argument("--registration", required=True)

    args = parser.parse_args(argv)
    root = _control_root(args.control_root)
    if args.command == "reconstruct":
        _json_print(reconstruct_from_manifest(
            root, args.manifest, args.manifest_sha, args.task,
            Path(args.worktree), args.base, args.message
        ))
    elif args.command == "unblock":
        _json_print(unblock_from_manifest(root, args.role, args.task, args.manifest,
            args.manifest_sha, Path(args.worktree)))
    elif args.command == "register":
        _json_print(register_candidate(
            root, args.role, args.task, Path(args.worktree), args.base,
            args.review, args.review_sha, Path(args.route_source_root),
            args.route_source_sha, args.route_source_tree, args.remote,
            args.pushurl, args.manifest, args.manifest_sha,
        ))
    elif args.command == "publish-task-ref":
        _json_print(_push_operation(root, args.registration, "TASK_REF", args.ttl, args.timeout))
    elif args.command == "ready":
        reg, _ = _read_registration(root, args.registration)
        ci = _load_json(Path(args.ci_json)) if args.ci_json else evaluate_ci_from_bundle(reg)
        _json_print(mark_ready(root, args.registration, ci))
    elif args.command == "publish-main":
        _json_print(_push_operation(root, args.registration, "MAIN", args.ttl, args.timeout))
    elif args.command == "cleanup-ref":
        _json_print(_push_operation(root, args.registration, "CLEANUP_TASK_REF", args.ttl, args.timeout))
    elif args.command == "supersede":
        _json_print(supersede_registration(
            root, args.registration, args.evidence, args.evidence_sha,
            Path(args.route_source_root), args.route_source_sha, args.route_source_tree,
            args.ttl, args.timeout,
        ))
    elif args.command == "recover":
        _json_print(recover_registration(root, args.registration))
    elif args.command == "close":
        _json_print(close_registration(root, args.registration))
    elif args.command == "complete-queue":
        _json_print(complete_queue_registration(
            root, args.registration, args.receipt, args.summary,
            Path(args.route_source_root),
        ))
    elif args.command == "resolve-blocker":
        _json_print(resolve_blocker_via_trusted_route(
            root, Path(args.route_source_root), args.task,
            args.successor, args.receipt,
        ))
    elif args.command == "show":
        _json_print(_read_registration(root, args.registration)[0])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (PublicationError, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"status": "BLOCKED", "error": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
