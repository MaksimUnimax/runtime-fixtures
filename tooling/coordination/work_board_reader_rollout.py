"""Governed two-file reader rollout with exact rollback and semantic readback."""
from __future__ import annotations
import fcntl
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
import sys
from pathlib import Path
import work_board_v2 as v2

ROLES = ("A", "B", "C", "ORG")
HEX64 = re.compile(r"^[0-9a-f]{64}$")


def _sha(raw): return hashlib.sha256(raw).hexdigest()

def _read(path, limit=2 * 1024 * 1024): return v2._read_nofollow(Path(path), limit)

def _path(path, *, directory=False, missing=False):
    path = Path(path)
    try: info = path.lstat()
    except FileNotFoundError:
        if missing: return None
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PATH_INVALID") from None
    if stat.S_ISLNK(info.st_mode) or (not stat.S_ISDIR(info.st_mode) if directory else not stat.S_ISREG(info.st_mode)):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PATH_INVALID")
    if not directory and info.st_nlink != 1: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PATH_INVALID")
    return info

def _atomic(path: Path, raw: bytes, mode: int):
    path = Path(path)
    tmp = path.with_name("." + path.name + ".rollout.tmp")
    _path(path, missing=True); _path(tmp, missing=True)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
    try:
        view = memoryview(raw)
        while view:
            n = os.write(fd, view)
            if n <= 0: raise OSError("short write")
            view = view[n:]
        os.fsync(fd)
    finally: os.close(fd)
    try:
        os.replace(tmp, path)
        v2._fsync_dir(path.parent)
    except Exception:
        try:
            info = _path(tmp)
            if info.st_nlink == 1 and _read(tmp) == raw:
                tmp.unlink(); v2._fsync_dir(tmp.parent)
        except (OSError, RuntimeError):
            pass
        raise

def _module(path: Path, label: str):
    spec = importlib.util.spec_from_file_location("octoport_rollout_" + label, path)
    if spec is None or spec.loader is None: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_IMPORT_FAILED")
    module = importlib.util.module_from_spec(spec)
    prior = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = prior
    return module

def _git_status(directory: Path, *, operational_org=False):
    try:
        probe = subprocess.run(["git", "-C", str(directory), "rev-parse", "--show-toplevel"], capture_output=True, text=True, timeout=5)
        if (operational_org and probe.returncode == 128
                and "not a git repository" in probe.stderr
                and not any(os.path.lexists(parent / ".git") for parent in (directory, *directory.parents))):
            return None, "ORG_OPERATIONAL_READER_OUTSIDE_GIT"
        probe.check_returncode()
        repo = probe.stdout.strip()
        status = subprocess.run(["git", "-C", repo, "status", "--porcelain=v1", "--untracked-files=all"], check=True, capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_GIT_STATUS_UNAVAILABLE") from None
    return Path(repo), status

def _unrelated_status(status: str, repo: Path, targets: set[Path]):
    if repo is None:
        return [status]
    result = []
    for line in status.splitlines():
        path = line[3:] if len(line) >= 4 else ""
        if (repo / path).resolve(strict=False) not in targets:
            result.append(line)
    return result

def _semantic(module, root: Path):
    board = module.load_board(root)
    if board.get("version") != 1: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_V1_SEMANTICS_MISMATCH")
    tasks = board["tasks"]
    return {
        "board": board,
        "task_views": [module.task_view(board, task) for task in tasks],
        "role_work": {role: module.role_work(root, role) for role in "ABC"},
        "blocker_attention": module.blocker_attention(board),
        "snapshots": {role: module.board_snapshot(root) for role in "ABC"},
        "status": {role: module.status_work(root, role) for role in "ABC"},
    }

def _file_state(path: Path):
    info = _path(path, missing=True)
    if info is None: return {"exists": False, "raw": None, "mode": None, "sha256": None}
    raw = _read(path)
    return {"exists": True, "raw": raw, "mode": stat.S_IMODE(info.st_mode), "sha256": _sha(raw)}

def _raw_hash(path: Path):
    if not os.path.lexists(path): return None
    return _sha(_read(path, 64 * 1024 * 1024))

def rollout(control_root: Path, candidates: dict[str, Path], reader_dirs: dict[str, Path],
            expected_queue_sha: dict[str, str], expected_module_sha: dict[str, str | None], *,
            rollout_id: str, executing_role: str = "C"):
    root = Path(control_root)
    if (set(candidates) != {"work_queue", "work_board_v2"} or set(reader_dirs) != set(ROLES)
        or set(expected_queue_sha) != set(ROLES) or set(expected_module_sha) != set(ROLES)
        or executing_role not in {"A", "B", "C"}):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_READER_SET_INVALID")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", rollout_id): raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ID_INVALID")
    candidate_raw = {}
    for name, path in candidates.items():
        _path(path); candidate_raw[name] = _read(path)
    candidate_sha = {name: _sha(raw) for name, raw in candidate_raw.items()}
    dirs = {role: Path(reader_dirs[role]) for role in ROLES}
    target_paths = {role: {name: dirs[role] / (name + ".py") for name in candidates} for role in ROLES}
    if len({str(path.resolve(strict=False)) for role in ROLES for path in target_paths[role].values()}) != 8:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TARGETS_OVERLAP")
    for role, directory in dirs.items():
        _path(directory, directory=True)
        if directory.resolve(strict=True) != directory.absolute(): raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PATH_INVALID")
        queue = target_paths[role]["work_queue"]
        _path(queue)
        if not HEX64.fullmatch(str(expected_queue_sha[role])) or _sha(_read(queue)) != expected_queue_sha[role]:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_QUEUE_SOURCE_MISMATCH")
        old_helper = target_paths[role]["work_board_v2"]
        state = _file_state(old_helper)
        if state["sha256"] != expected_module_sha[role]: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_MODULE_MISMATCH")
        if expected_module_sha[role] is not None and not HEX64.fullmatch(expected_module_sha[role]):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_EXPECTED_MODULE_HASH_INVALID")
    receipt = root / "controllers/work-board-reader-rollouts" / (rollout_id + ".json")
    if os.path.lexists(receipt): raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ALREADY_USED")
    status_before = {}
    repos, target_set = {}, set()
    for role, directory in dirs.items():
        repo, status = _git_status(directory, operational_org=role == "ORG"); repos[role] = repo; status_before[role] = status
        target_set.add(target_paths[role]["work_queue"].resolve(strict=False))
        target_set.add(target_paths[role]["work_board_v2"].resolve(strict=False))
    board_path = root / "controllers/work-board.json"
    event_path = root / "controllers/work-board-events.jsonl"
    board_before, event_before = _raw_hash(board_path), _raw_hash(event_path)
    locks, changes = [], []
    try:
        for role in "ABC":
            lock_path = root / (role + ".lock")
            fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
            fcntl.flock(fd, fcntl.LOCK_EX); locks.append(fd)
        fd = os.open(root / "controllers/coordination.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX); locks.append(fd)
        state_path = root / (executing_role + ".json")
        if not os.path.lexists(state_path):
            raise RuntimeError("WORK_BOARD_V2_EXECUTING_ROLE_STATE_INVALID")
        status = json.loads(_read(state_path)).get("status")
        if status == "STOPPED": raise RuntimeError("STOPPED: no reader rollout permitted")
        if status not in {"RUNNING", "WAITING_INPUT"}:
            raise RuntimeError("WORK_BOARD_V2_EXECUTING_ROLE_STATE_INVALID")
        # The authoritative preconditions are checked only after every lock.
        # A pre-lock observation cannot authorize overwriting intervening work.
        for name, path in candidates.items():
            _path(path)
            if _sha(_read(path)) != candidate_sha[name]:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_CANDIDATE_DRIFT")
        for role, directory in dirs.items():
            _path(directory, directory=True)
            if directory.resolve(strict=True) != directory.absolute():
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PATH_INVALID")
            if _file_state(target_paths[role]["work_queue"])["sha256"] != expected_queue_sha[role]:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_QUEUE_SOURCE_MISMATCH")
            if _file_state(target_paths[role]["work_board_v2"])["sha256"] != expected_module_sha[role]:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_MODULE_MISMATCH")
            repo, status = _git_status(directory, operational_org=role == "ORG")
            if repo != repos[role] or status != status_before[role]:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_GIT_STATUS_DRIFT")
        if _raw_hash(board_path) != board_before or _raw_hash(event_path) != event_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_OR_EVENT_CHANGED")
        baseline = {}
        for role in ROLES:
            before_mod = _module(target_paths[role]["work_queue"], role + "_before")
            baseline[role] = _semantic(before_mod, root)
        for role in ROLES:
            # Both files are an inseparable reader pair.
            for name in ("work_queue", "work_board_v2"):
                target = target_paths[role][name]
                prior = _file_state(target)
                changes.append({"role": role, "name": name, "target": str(target), **prior,
                                "new_sha256": candidate_sha[name]})
                mode = prior["mode"] if prior["exists"] else 0o644
                _atomic(target, candidate_raw[name], mode)
                if _sha(_read(target)) != candidate_sha[name]: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_READBACK_FAILED")
                compile(candidate_raw[name].decode("utf-8"), str(target), "exec")
            installed = _module(target_paths[role]["work_queue"], role + "_after")
            if _semantic(installed, root) != baseline[role]: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_SEMANTIC_MISMATCH")
        status_after = {}
        for role, directory in dirs.items():
            repo, status = _git_status(directory, operational_org=role == "ORG")
            if repo != repos[role] or _unrelated_status(status, repo, target_set) != _unrelated_status(status_before[role], repo, target_set):
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_UNRELATED_GIT_STATUS_DRIFT")
            status_after[role] = status
        if _raw_hash(board_path) != board_before or _raw_hash(event_path) != event_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_OR_EVENT_CHANGED")
        receipt_value = {"schema_version": 1, "rollout_id": rollout_id, "executing_role": executing_role,
                         "result": "COMMITTED", "candidate_sha256": candidate_sha,
                         "board_sha256_before": board_before, "board_sha256_after": _raw_hash(board_path),
                         "events_sha256_before": event_before, "events_sha256_after": _raw_hash(event_path),
                         "reader_semantics_before": baseline,
                         "git_status_before": status_before, "git_status_after": status_after,
                         "prior": [{key: value for key, value in item.items() if key != "raw"} for item in changes]}
        v2._atomic_write(receipt, v2._canonical_bytes(receipt_value))
        return receipt_value
    except Exception as error:
        if not changes: raise
        rollback_errors = []
        for item in reversed(changes):
            target = Path(item["target"])
            try:
                if not item["exists"]:
                    target.unlink(missing_ok=True); v2._fsync_dir(target.parent)
                else:
                    _atomic(target, item["raw"], item["mode"])
                    if _sha(_read(target)) != item["sha256"]: raise RuntimeError("rollback hash mismatch")
            except Exception as rollback_error: rollback_errors.append(type(rollback_error).__name__)
        if rollback_errors: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_FAILED: " + ",".join(rollback_errors)) from None
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_FAILED: " + str(error) + "; rollback verified") from None
    finally:
        for fd in reversed(locks):
            fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)
