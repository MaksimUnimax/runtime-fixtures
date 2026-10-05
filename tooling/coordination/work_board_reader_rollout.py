"""Governed two-file reader rollout with exact rollback and semantic readback."""
from __future__ import annotations
import ctypes
import errno
import fcntl
import hashlib
import importlib.util
import inspect
import json
import os
import re
import secrets
import stat
import subprocess
import sys
from pathlib import Path
import work_board_v2 as v2

ROLES = ("A", "B", "C", "ORG")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
SEMANTIC_TRANSITION_KIND = "octoport.work-board-reader-semantic-transition"
SEMANTIC_TRANSITION_VERSION = 1
SAFE_PROOF_TOP = {"logs", "controllers", "artifacts"}


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

def _rename_noreplace(source: Path, target: Path):
    """Atomically rename without replacing an existing target."""
    source = Path(source)
    target = Path(target)
    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_RENAME_NOREPLACE_UNAVAILABLE")
    renameat2.argtypes = [
        ctypes.c_int, ctypes.c_char_p,
        ctypes.c_int, ctypes.c_char_p,
        ctypes.c_uint,
    ]
    renameat2.restype = ctypes.c_int
    at_fdcwd = -100
    rename_noreplace = 1
    result = renameat2(
        at_fdcwd, os.fsencode(source),
        at_fdcwd, os.fsencode(target),
        rename_noreplace,
    )
    if result == 0:
        return
    code = ctypes.get_errno()
    if code == errno.ENOENT:
        raise FileNotFoundError(code, os.strerror(code), str(source))
    if code == errno.EEXIST:
        raise FileExistsError(code, os.strerror(code), str(target))
    raise OSError(code, os.strerror(code), str(source))


def _rollback_prior_missing(
    target: Path,
    installed_identity,
    *,
    scratch_dir: Path,
):
    """Restore an originally absent target without unlinking an untrusted pathname."""
    target = Path(target)
    scratch = Path(scratch_dir)
    _path(scratch, directory=True)
    target_parent = _path(target.parent, directory=True)
    scratch_info = _path(scratch, directory=True)
    if target_parent.st_dev != scratch_info.st_dev:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_SCRATCH_FILESYSTEM_MISMATCH")

    if installed_identity is None:
        try:
            target.lstat()
        except FileNotFoundError:
            return
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_UNPROVEN")

    quarantine = scratch / (
        f".{target.name}.rollback.{os.getpid()}.{secrets.token_hex(8)}.preserved"
    )
    _path(quarantine, missing=True)
    try:
        _rename_noreplace(target, quarantine)
    except FileNotFoundError:
        return

    moved = quarantine.lstat()
    moved_identity = (moved.st_dev, moved.st_ino)
    if moved_identity != tuple(installed_identity):
        # The pathname was replaced by another actor. Put that object back only
        # if the original name is still free; never overwrite/delete it.
        try:
            _rename_noreplace(quarantine, target)
        except FileExistsError:
            # Both objects survive: the replacement stays quarantined and the
            # newly occupied target is untouched. Manual reconciliation is needed.
            pass
        v2._fsync_dir(target.parent)
        v2._fsync_dir(scratch)
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_DRIFT")

    # The exact rollout-owned inode is now out of the target namespace. Keep it
    # in control-root scratch as failure evidence instead of unlinking a pathname.
    v2._fsync_dir(target.parent)
    v2._fsync_dir(scratch)


def _atomic(path: Path, raw: bytes, mode: int, *, scratch_dir: Path | None = None):
    path = Path(path)
    scratch = Path(scratch_dir) if scratch_dir is not None else path.parent
    _path(path, missing=True)
    _path(scratch, directory=True)
    target_parent = _path(path.parent, directory=True)
    scratch_info = _path(scratch, directory=True)
    if target_parent.st_dev != scratch_info.st_dev:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_SCRATCH_FILESYSTEM_MISMATCH")
    tmp = scratch / (
        f".{path.name}.rollout.{os.getpid()}.{secrets.token_hex(8)}.tmp"
    )
    _path(tmp, missing=True)
    fd = None
    owned_identity = None
    try:
        fd = os.open(
            tmp,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        opened = os.fstat(fd)
        owned_identity = (opened.st_dev, opened.st_ino)
        os.fchmod(fd, mode)
        view = memoryview(raw)
        while view:
            n = os.write(fd, view)
            if n <= 0: raise OSError("short write")
            view = view[n:]
        os.fsync(fd)
        current = _path(tmp)
        if (current.st_dev, current.st_ino) != owned_identity:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TEMP_IDENTITY_DRIFT")
        os.replace(tmp, path)
        placed = _path(path)
        if (placed.st_dev, placed.st_ino) != owned_identity:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TEMP_IDENTITY_DRIFT")
        v2._fsync_dir(path.parent)
        os.close(fd); fd = None
        return owned_identity
    except Exception:
        if fd is not None:
            try: os.close(fd)
            except OSError: pass
        # Never unlink a pathname after a separate identity check: another
        # process could replace that name between check and unlink. Failed
        # writes remain in the control-root scratch area for explicit cleanup.
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

def _completion_receipt_identity(args, kwargs):
    """Use the exact small receipt-call arguments when they are safely hashable."""
    try:
        identity = (tuple(args), tuple(sorted(kwargs.items())))
        hash(identity)
        return identity
    except (TypeError, ValueError):
        return None


def _semantic_value_identity(value):
    """Bind cached validation to the exact in-memory JSON value."""
    try:
        raw = json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
    except (TypeError, ValueError):
        return None
    return hashlib.sha256(raw).hexdigest()


def _semantic(module, root: Path):
    binding_before = _board_binding(root)
    board = module.load_board(root)
    if board.get("version") not in {1, 2}:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_VERSION_UNSUPPORTED")
    board_identity_before = _semantic_value_identity(board)
    if board_identity_before is None:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_IDENTITY_INVALID")
    tasks = board["tasks"]
    board_tasks_by_id = {
        task.get("id"): task for task in tasks
        if isinstance(task, dict) and isinstance(task.get("id"), str)
    }
    board_task_identity = {
        identifier: _semantic_value_identity(task)
        for identifier, task in board_tasks_by_id.items()
    }
    # Older readers repeatedly validate the same immutable evidence as they
    # derive task views, role work and blocker attention. Memoize only inside
    # this exact board/event-bound semantic evaluation and restore every
    # patched reader function even if a downstream projection raises.
    namespace = getattr(module.task_view, "__globals__", {})
    saved = {}
    revalidations = []
    try:
        for name in ("_completion_receipt", "_publication_snapshot_valid"):
            original = namespace.get(name)
            if not callable(original):
                continue
            saved[name] = original
            cache = {}
            calls = {}
            revalidations.append((name, original, cache, calls))

            def memoized(
                *args,
                __original=original,
                __cache=cache,
                __calls=calls,
                __name=name,
                **kwargs,
            ):
                if __name == "_publication_snapshot_valid":
                    task = args[0] if args and isinstance(args[0], dict) else None
                    identifier = task.get("id") if task is not None else None
                    expected_identity = board_task_identity.get(identifier)
                    current_identity = (
                        _semantic_value_identity(task) if task is not None else None
                    )
                    # Reuse only an exact task value from the immutable board
                    # bound to this _semantic call. A changed/copy-drifted task
                    # bypasses the cache and uses the original validator.
                    identity = (
                        ("publication", identifier, current_identity)
                        if expected_identity is not None
                        and current_identity == expected_identity
                        else None
                    )
                else:
                    identity = _completion_receipt_identity(args, kwargs)
                if identity is None:
                    return __original(*args, **kwargs)
                if identity not in __cache:
                    __cache[identity] = __original(*args, **kwargs)
                    __calls[identity] = (args, dict(kwargs))
                return __cache[identity]

            namespace[name] = memoized

        evaluation_type = getattr(module, "_BoardEvaluation", None)
        evaluation = evaluation_type(board) if callable(evaluation_type) else None
        task_view = module.task_view
        accepts_evaluation = False
        if evaluation is not None:
            try:
                parameters = inspect.signature(task_view).parameters.values()
                accepts_evaluation = any(
                    p.name == "evaluation" or p.kind == p.VAR_KEYWORD
                    for p in parameters
                )
            except (TypeError, ValueError):
                accepts_evaluation = False
        if accepts_evaluation:
            task_views = [
                task_view(board, task, evaluation=evaluation) for task in tasks
            ]
        else:
            task_views = [task_view(board, task) for task in tasks]
        value = {
            "board": board,
            "task_views": task_views,
            "role_work": {role: module.role_work(root, role) for role in "ABC"},
            "blocker_attention": module.blocker_attention(board),
            "snapshots": {role: module.board_snapshot(root) for role in "ABC"},
            "status": {role: module.status_work(root, role) for role in "ABC"},
        }
        if _semantic_value_identity(board) != board_identity_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_IN_MEMORY_BOARD_CHANGED")
        if _board_binding(root) != binding_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_OR_EVENT_CHANGED")

        # Cached PASS/FAIL cannot outlive the evidence bytes that produced it.
        # Re-run each distinct cached validation once before returning. This
        # keeps validation O(distinct evidence) while preserving fail-closed
        # behavior if a receipt/publication artifact changes mid-evaluation.
        for _name, original, cache, calls in revalidations:
            for identity, (args, kwargs) in calls.items():
                if original(*args, **kwargs) != cache[identity]:
                    raise RuntimeError(
                        "WORK_BOARD_V2_ROLLOUT_VALIDATION_EVIDENCE_CHANGED"
                    )
        if _semantic_value_identity(board) != board_identity_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_IN_MEMORY_BOARD_CHANGED")
        if _board_binding(root) != binding_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_OR_EVENT_CHANGED")
        return value
    finally:
        for name, original in saved.items():
            namespace[name] = original

def _file_state(path: Path):
    info = _path(path, missing=True)
    if info is None: return {"exists": False, "raw": None, "mode": None, "sha256": None}
    raw = _read(path)
    return {"exists": True, "raw": raw, "mode": stat.S_IMODE(info.st_mode), "sha256": _sha(raw)}

def _raw_hash(path: Path):
    if not os.path.lexists(path): return None
    return _sha(_read(path, 64 * 1024 * 1024))

def _semantic_digest(value):
    return _sha(v2._canonical_bytes(value))

def _board_binding(root: Path):
    board_path = Path(root) / "controllers/work-board.json"
    event_path = Path(root) / "controllers/work-board-events.jsonl"
    raw = _read(board_path, 64 * 1024 * 1024)
    try:
        board = json.loads(raw)
    except (ValueError, TypeError):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_INVALID") from None
    revision = board.get("revision") if isinstance(board, dict) else None
    if type(revision) is not int or revision < 0:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_INVALID")
    return {
        "revision": revision,
        "snapshot": {"exists": True, "sha256": _sha(raw)},
        "events_sha256": _raw_hash(event_path),
    }

def _proof_path(root: Path, path: Path):
    resolved = Path(path).resolve()
    try:
        relative = resolved.relative_to(Path(root).resolve())
    except ValueError:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_OUTSIDE_CONTROL") from None
    if not relative.parts or relative.parts[0] not in SAFE_PROOF_TOP:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_OUTSIDE_CONTROL")
    _path(resolved)
    return resolved

def _load_transition_proof(root: Path, path: Path, expected_sha: str):
    if not HEX64.fullmatch(str(expected_sha)):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_HASH_INVALID")
    resolved = _proof_path(root, path)
    raw = _read(resolved, 1024 * 1024)
    if _sha(raw) != expected_sha:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_HASH_MISMATCH")
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_INVALID") from None
    if not isinstance(value, dict):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_INVALID")
    return value, resolved

def _reader_prior(candidate_sha, expected_queue_sha, expected_module_sha, role):
    return {
        "prior_sha256": {
            "work_queue": expected_queue_sha[role],
            "work_board_v2": expected_module_sha[role],
        },
        "candidate_sha256": dict(candidate_sha),
    }

def semantic_transition_proof(control_root: Path, candidates: dict[str, Path],
                              reader_dirs: dict[str, Path],
                              expected_queue_sha: dict[str, str],
                              expected_module_sha: dict[str, str | None], *,
                              rollout_id: str):
    """Build the exact read-only semantic transition value for independent review."""
    root = Path(control_root)
    if (set(candidates) != {"work_queue", "work_board_v2"} or set(reader_dirs) != set(ROLES)
        or set(expected_queue_sha) != set(ROLES) or set(expected_module_sha) != set(ROLES)):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_READER_SET_INVALID")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", rollout_id):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ID_INVALID")
    candidate_raw = {}
    for name, path in candidates.items():
        _path(path); candidate_raw[name] = _read(path)
    candidate_sha = {name: _sha(raw) for name, raw in candidate_raw.items()}
    dirs = {role: Path(reader_dirs[role]) for role in ROLES}
    before_semantics = {}
    for role, directory in dirs.items():
        _path(directory, directory=True)
        queue = directory / "work_queue.py"
        helper = directory / "work_board_v2.py"
        if _file_state(queue)["sha256"] != expected_queue_sha[role]:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_QUEUE_SOURCE_MISMATCH")
        if _file_state(helper)["sha256"] != expected_module_sha[role]:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_MODULE_MISMATCH")
        before_semantics[role] = _semantic(_module(queue, role + "_proof_before"), root)
    candidate_semantic = _semantic(_module(Path(candidates["work_queue"]), "proof_candidate"), root)
    readers = {}
    changed = False
    for role in ROLES:
        row = _reader_prior(candidate_sha, expected_queue_sha, expected_module_sha, role)
        row["before_semantic_sha256"] = _semantic_digest(before_semantics[role])
        row["after_semantic_sha256"] = _semantic_digest(candidate_semantic)
        changed = changed or row["before_semantic_sha256"] != row["after_semantic_sha256"]
        readers[role] = row
    if not changed:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_NO_SEMANTIC_CHANGE")
    return {
        "kind": SEMANTIC_TRANSITION_KIND,
        "schema_version": SEMANTIC_TRANSITION_VERSION,
        "rollout_id": rollout_id,
        "board": _board_binding(root),
        "readers": readers,
    }

def _verify_transition_proof(proof, rollout_id, board_binding, candidate_sha,
                             expected_queue_sha, expected_module_sha,
                             before_semantics, candidate_semantic):
    if set(proof) != {"kind", "schema_version", "rollout_id", "board", "readers"}:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_INVALID")
    if (proof.get("kind") != SEMANTIC_TRANSITION_KIND
        or proof.get("schema_version") != SEMANTIC_TRANSITION_VERSION
        or proof.get("rollout_id") != rollout_id
        or proof.get("board") != board_binding
        or not isinstance(proof.get("readers"), dict)
        or set(proof["readers"]) != set(ROLES)):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_MISMATCH")
    after_digest = _semantic_digest(candidate_semantic)
    changed = False
    for role in ROLES:
        row = proof["readers"][role]
        expected_keys = {
            "prior_sha256", "candidate_sha256",
            "before_semantic_sha256", "after_semantic_sha256",
        }
        if not isinstance(row, dict) or set(row) != expected_keys:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_INVALID")
        expected_prior = _reader_prior(
            candidate_sha, expected_queue_sha, expected_module_sha, role
        )
        before_digest = _semantic_digest(before_semantics[role])
        if (row.get("prior_sha256") != expected_prior["prior_sha256"]
            or row.get("candidate_sha256") != expected_prior["candidate_sha256"]
            or row.get("before_semantic_sha256") != before_digest
            or row.get("after_semantic_sha256") != after_digest
            or not HEX64.fullmatch(str(row.get("before_semantic_sha256", "")))
            or not HEX64.fullmatch(str(row.get("after_semantic_sha256", "")))):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_MISMATCH")
        changed = changed or before_digest != after_digest
    if not changed:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_NO_SEMANTIC_CHANGE")
    return {role: candidate_semantic for role in ROLES}

def rollout(control_root: Path, candidates: dict[str, Path], reader_dirs: dict[str, Path],
            expected_queue_sha: dict[str, str], expected_module_sha: dict[str, str | None], *,
            rollout_id: str, executing_role: str = "C",
            semantic_transition_proof_path: Path | None = None,
            semantic_transition_proof_sha256: str | None = None):
    root = Path(control_root)
    if (set(candidates) != {"work_queue", "work_board_v2"} or set(reader_dirs) != set(ROLES)
        or set(expected_queue_sha) != set(ROLES) or set(expected_module_sha) != set(ROLES)
        or executing_role not in {"A", "B", "C"}):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_READER_SET_INVALID")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", rollout_id): raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ID_INVALID")
    transition_requested = (
        semantic_transition_proof_path is not None
        or semantic_transition_proof_sha256 is not None
    )
    if transition_requested and (
        semantic_transition_proof_path is None
        or semantic_transition_proof_sha256 is None
    ):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_PROOF_REQUIRED")
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
        role_state_before = {role: _raw_hash(root / (role + ".json")) for role in "ABC"}
        expected_after = baseline
        proof_path = None
        proof_sha = None
        if transition_requested:
            proof, proof_path = _load_transition_proof(
                root, semantic_transition_proof_path,
                semantic_transition_proof_sha256,
            )
            proof_sha = semantic_transition_proof_sha256
            candidate_semantic = _semantic(
                _module(Path(candidates["work_queue"]), "transition_candidate"),
                root,
            )
            expected_after = _verify_transition_proof(
                proof, rollout_id, _board_binding(root), candidate_sha,
                expected_queue_sha, expected_module_sha,
                baseline, candidate_semantic,
            )
            for name, path in candidates.items():
                _path(path)
                if _sha(_read(path)) != candidate_sha[name]:
                    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_CANDIDATE_DRIFT")
        receipt.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        _path(receipt.parent, directory=True)
        for role in ROLES:
            # Both files are an inseparable reader pair.
            for name in ("work_queue", "work_board_v2"):
                target = target_paths[role][name]
                prior = _file_state(target)
                change = {"role": role, "name": name, "target": str(target), **prior,
                          "new_sha256": candidate_sha[name]}
                changes.append(change)
                mode = prior["mode"] if prior["exists"] else 0o644
                change["installed_identity"] = _atomic(
                    target, candidate_raw[name], mode, scratch_dir=receipt.parent
                )
                installed_state = _file_state(target)
                if (
                    installed_state["sha256"] != candidate_sha[name]
                    or installed_state["mode"] != mode
                ):
                    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_READBACK_FAILED")
                compile(candidate_raw[name].decode("utf-8"), str(target), "exec")
            installed = _module(target_paths[role]["work_queue"], role + "_after")
            installed_semantic = _semantic(installed, root)
            if installed_semantic != expected_after[role]:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_SEMANTIC_MISMATCH")
        status_after = {}
        for role, directory in dirs.items():
            repo, status = _git_status(directory, operational_org=role == "ORG")
            if repo != repos[role] or _unrelated_status(status, repo, target_set) != _unrelated_status(status_before[role], repo, target_set):
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_UNRELATED_GIT_STATUS_DRIFT")
            status_after[role] = status
        if _raw_hash(board_path) != board_before or _raw_hash(event_path) != event_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_OR_EVENT_CHANGED")
        role_state_after = {role: _raw_hash(root / (role + ".json")) for role in "ABC"}
        if role_state_after != role_state_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLE_STATE_CHANGED")
        receipt_value = {"schema_version": 1, "rollout_id": rollout_id, "executing_role": executing_role,
                         "result": "COMMITTED", "candidate_sha256": candidate_sha,
                         "board_sha256_before": board_before, "board_sha256_after": _raw_hash(board_path),
                         "events_sha256_before": event_before, "events_sha256_after": _raw_hash(event_path),
                         "role_state_sha256_before": role_state_before,
                         "role_state_sha256_after": role_state_after,
                         "reader_semantics_before": baseline,
                         "reader_semantic_sha256_before": {
                             role: _semantic_digest(baseline[role]) for role in ROLES
                         },
                         "reader_semantic_sha256_after": {
                             role: _semantic_digest(expected_after[role]) for role in ROLES
                         },
                         "semantic_transition_proof": (
                             {"path": str(proof_path), "sha256": proof_sha}
                             if transition_requested else None
                         ),
                         "git_status_before": status_before, "git_status_after": status_after,
                         "prior": [{key: value for key, value in item.items()
                                    if key not in {"raw", "installed_identity"}}
                                   for item in changes]}
        v2._atomic_write(receipt, v2._canonical_bytes(receipt_value))
        return receipt_value
    except Exception as error:
        if not changes: raise
        rollback_errors = []
        for item in reversed(changes):
            target = Path(item["target"])
            try:
                if not item["exists"]:
                    _rollback_prior_missing(
                        target,
                        item.get("installed_identity"),
                        scratch_dir=receipt.parent,
                    )
                else:
                    _atomic(target, item["raw"], item["mode"], scratch_dir=receipt.parent)
                    restored = _file_state(target)
                    if (
                        restored["sha256"] != item["sha256"]
                        or restored["mode"] != item["mode"]
                    ):
                        raise RuntimeError("rollback hash/mode mismatch")
            except Exception as rollback_error: rollback_errors.append(type(rollback_error).__name__)
        if (changes and (
            _raw_hash(board_path) != board_before
            or _raw_hash(event_path) != event_before
            or ("role_state_before" in locals() and {
                role: _raw_hash(root / (role + ".json")) for role in "ABC"
            } != role_state_before)
        )):
            rollback_errors.append("shared-state-drift")
        if rollback_errors: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_FAILED: " + ",".join(rollback_errors)) from None
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_FAILED: " + str(error) + "; rollback verified") from None
    finally:
        for fd in reversed(locks):
            fcntl.flock(fd, fcntl.LOCK_UN); os.close(fd)
