"""Governed reader rollout with inode-bound rollback and semantic readback."""
from __future__ import annotations
import ast
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
TRANSITION_CONTRACT_KIND = "octoport.work-board-reader-transition-contract"
TRANSITION_CONTRACT_VERSION = 1
TRANSITION_CONTRACT_POLICY = "resolved-blocker-tombstone-hydration-v1"

# Independent owner/release authority has not yet installed a reviewed immutable
# helper source. Never infer this triple from a caller, environment or mutable
# origin/main. The accepted publisher source must pin (commit, tree, V2 blob).
MODULE_ONLY_ACCEPTED_SOURCE_TRUST_ANCHOR = None

class _ReceiptPublicationUncertain(RuntimeError):
    """Exact rollout receipt may already have been published; never roll back blindly."""
MODULE_ONLY_V2_SOURCE_PATH = "tooling/coordination/work_board_v2.py"


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
    """Do not remove or move a public pathname without an inode-bound primitive."""
    target = Path(target)
    scratch = Path(scratch_dir)
    parent = _path(target.parent, directory=True)
    sdir = _path(scratch, directory=True)
    if parent.st_dev != sdir.st_dev:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_SCRATCH_FILESYSTEM_MISMATCH")
    try:
        current = target.lstat()
    except FileNotFoundError:
        return
    if installed_identity is None:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_UNPROVEN")
    if (current.st_dev, current.st_ino) != tuple(installed_identity):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_DRIFT")
    # Linux pathname rename/unlink cannot atomically require an expected inode.
    # Keep the installed object and require explicit reconciliation rather than
    # temporarily moving a replacement and claiming that a later restore is safe.
    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_RECONCILIATION_REQUIRED")


def _atomic_core(path: Path, raw: bytes, mode: int, *, scratch_dir: Path | None = None,
                 replace_existing: bool = True):
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
        if replace_existing:
            os.replace(tmp, path)
        else:
            # During rollback an untrusted replacement may have appeared
            # after the rollout-owned inode was quarantined. Never clobber it.
            _rename_noreplace(tmp, path)
        placed = _path(path)
        if (placed.st_dev, placed.st_ino) != owned_identity:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TEMP_IDENTITY_DRIFT")
        v2._fsync_dir(path.parent)
        # Transfer numeric FD ownership before close: an error may be
        # reported after Linux has already released (and reused) that number.
        closing_fd, fd = fd, None
        os.close(closing_fd)
        return owned_identity
    except Exception:
        if fd is not None:
            # This path has not attempted the final close yet.
            closing_fd, fd = fd, None
            try: os.close(closing_fd)
            except OSError: pass
        # Never unlink a pathname after a separate identity check: another
        # process could replace that name between check and unlink. Failed
        # writes remain in the control-root scratch area for explicit cleanup.
        raise

def _atomic(path: Path, raw: bytes, mode: int, *, scratch_dir: Path | None = None):
    """Original two-file installer API; preserve existing scoped injection hooks."""
    return _atomic_core(path, raw, mode, scratch_dir=scratch_dir,
                        replace_existing=True)


def _atomic_noreplace(path: Path, raw: bytes, mode: int, *,
                      scratch_dir: Path | None = None):
    """Dedicated rollback restore, never replaces a newly occupied pathname."""
    return _atomic_core(path, raw, mode, scratch_dir=scratch_dir,
                        replace_existing=False)


def _rollback_prior_existing(
    target: Path, prior_raw: bytes, prior_mode: int, prior_sha256: str,
    installed_identity, installed_sha256: str, *, scratch_dir: Path,
    preimage_path: Path | None = None,
):
    """Restore bytes only through a descriptor bound to the installed owned inode."""
    target = Path(target)
    scratch = Path(scratch_dir)
    parent = _path(target.parent, directory=True)
    sdir = _path(scratch, directory=True)
    if parent.st_dev != sdir.st_dev:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_SCRATCH_FILESYSTEM_MISMATCH")
    if _sha(prior_raw) != prior_sha256:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_PRIOR_HASH_MISMATCH")
    if installed_identity is None:
        current = _file_state(target)
        if (current["exists"] and current["sha256"] == prior_sha256
                and current["mode"] == prior_mode):
            return
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_UNPROVEN")

    # Rollback may itself be interrupted after a partial write. It must never
    # be the only surviving custodian of the original WIP bytes.
    if preimage_path is None:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_CUSTODY_REQUIRED")
    preimage_info = _path(preimage_path)
    if (stat.S_IMODE(preimage_info.st_mode) != 0o600
            or _sha(_read(preimage_path)) != prior_sha256):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_CUSTODY_MISMATCH")

    fd = None
    try:
        fd = os.open(target, os.O_RDWR | getattr(os, "O_NOFOLLOW", 0))
        opened = os.fstat(fd)
        identity = (opened.st_dev, opened.st_ino)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                or identity != tuple(installed_identity)
                or stat.S_IMODE(opened.st_mode) != prior_mode):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_DRIFT")

        def read_owned():
            os.lseek(fd, 0, os.SEEK_SET)
            chunks = []
            size = 0
            while True:
                chunk = os.read(fd, 65536)
                if not chunk:
                    return b"".join(chunks)
                size += len(chunk)
                if size > 2 * 1024 * 1024:
                    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_DRIFT")
                chunks.append(chunk)

        if _sha(read_owned()) != installed_sha256:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_DRIFT")
        checked = os.fstat(fd)
        current = _path(target)
        if ((checked.st_mtime_ns, checked.st_ctime_ns, checked.st_size)
                != (opened.st_mtime_ns, opened.st_ctime_ns, opened.st_size)
                or (current.st_dev, current.st_ino) != identity
                or checked.st_nlink != 1):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_DRIFT")
        # Subsequent pathname replacement cannot redirect these writes to the
        # replacement inode. No public rename, unlink or path-based overwrite.
        os.lseek(fd, 0, os.SEEK_SET)
        view = memoryview(prior_raw)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise OSError("short rollback write")
            view = view[count:]
        os.ftruncate(fd, len(prior_raw))
        os.fchmod(fd, prior_mode)
        os.fsync(fd)
        if (_sha(read_owned()) != prior_sha256
                or stat.S_IMODE(os.fstat(fd).st_mode) != prior_mode):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_READBACK_FAILED")
        current = _path(target)
        if (current.st_dev, current.st_ino) != identity:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_OWNERSHIP_DRIFT")
        v2._fsync_dir(target.parent)
    finally:
        if fd is not None:
            closing_fd, fd = fd, None
            os.close(closing_fd)


def _preserve_rollout_preimages(receipt: Path, changes, *, board_sha256, events_sha256):
    """Persist complete recovery custody before touching any public reader."""
    recovery = receipt.parent / (receipt.stem + ".recovery")
    # An interrupted/failed rollout owns this id permanently until explicit
    # authoritative reconciliation. Never reuse or overwrite its custody.
    os.mkdir(recovery, 0o700)
    _path(recovery, directory=True)
    v2._fsync_dir(receipt.parent)
    records = []
    for item in changes:
        if item["exists"]:
            preimage = recovery / (item["role"] + "-" + item["name"] + ".prior")
            _atomic_noreplace(preimage, item["raw"], 0o600, scratch_dir=recovery)
            if _sha(_read(preimage)) != item["sha256"]:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_CUSTODY_MISMATCH")
            item["preimage_path"] = str(preimage)
        else:
            item["preimage_path"] = None
        records.append({key: value for key, value in item.items()
                        if key not in {"raw", "installed_identity"}})
    manifest = {
        "schema_version": 1, "rollout_id": receipt.stem,
        "state": "RECOVERY_CUSTODY_PREPARED",
        "automatic_recovery_authorized": False,
        "board_sha256": board_sha256, "events_sha256": events_sha256,
        "prior": records,
    }
    manifest_raw = v2._canonical_bytes(manifest)
    manifest_path = recovery / "manifest.json"
    _atomic_noreplace(manifest_path, manifest_raw, 0o600, scratch_dir=recovery)
    if _read(manifest_path) != manifest_raw:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_CUSTODY_MISMATCH")
    return {"path": str(manifest_path), "sha256": _sha(manifest_raw)}


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
        for name in (
            "_completion_receipt", "_publication_snapshot_valid",
            "_evidence_snapshot_valid", "_resource_seal_snapshot_valid",
        ):
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
                if __name in {
                    "_publication_snapshot_valid", "_evidence_snapshot_valid",
                    "_resource_seal_snapshot_valid",
                }:
                    task = args[0] if args and isinstance(args[0], dict) else None
                    identifier = task.get("id") if task is not None else None
                    expected_identity = board_task_identity.get(identifier)
                    current_identity = (
                        _semantic_value_identity(task) if task is not None else None
                    )
                    # Exact task value only. Evidence validation also binds to
                    # the actual reader control root, never a snapshot path.
                    root_identity = None
                    if __name in {
                        "_evidence_snapshot_valid", "_resource_seal_snapshot_valid",
                    }:
                        key = (
                            "expected_root" if __name == "_evidence_snapshot_valid"
                            else "root"
                        )
                        candidate_root = (
                            kwargs[key] if key in kwargs else
                            args[1] if len(args) > 1 else None
                        )
                        if candidate_root is not None:
                            try:
                                root_identity = str(Path(candidate_root).resolve())
                            except (OSError, ValueError, TypeError):
                                root_identity = None
                    identity = (
                        ("evidence", identifier, current_identity, root_identity)
                        if __name == "_evidence_snapshot_valid"
                        and root_identity is not None
                        and expected_identity is not None
                        and current_identity == expected_identity
                        else ("resource-seal", identifier, current_identity, root_identity)
                        if __name == "_resource_seal_snapshot_valid"
                        and root_identity is not None
                        and expected_identity is not None
                        and current_identity == expected_identity
                        else ("publication", identifier, current_identity)
                        if __name == "_publication_snapshot_valid"
                        and expected_identity is not None
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

        def accepts_keyword(callback, name):
            # Historical immutable readers may not declare the newer root
            # argument. Dispatch based on the exact signature; never absorb
            # a TypeError from inside a validator as a compatibility fallback.
            try:
                return any(
                    p.name == name or p.kind == p.VAR_KEYWORD
                    for p in inspect.signature(callback).parameters.values()
                )
            except (TypeError, ValueError):
                return False

        evaluation_type = getattr(module, "_BoardEvaluation", None)
        if callable(evaluation_type):
            evaluation_kwargs = (
                {"root": root} if accepts_keyword(evaluation_type, "root") else {}
            )
            evaluation = evaluation_type(board, **evaluation_kwargs)
        else:
            evaluation = None
        task_view = module.task_view
        view_kwargs = {}
        if evaluation is not None and accepts_keyword(task_view, "evaluation"):
            view_kwargs["evaluation"] = evaluation
        if accepts_keyword(task_view, "root"):
            view_kwargs["root"] = root
        task_views = [
            task_view(board, task, **view_kwargs) for task in tasks
        ]
        attention_callback = getattr(module, "blocker_attention", None)
        if callable(attention_callback):
            attention_kwargs = (
                {"root": root}
                if accepts_keyword(attention_callback, "root")
                else {}
            )
            attention = attention_callback(board, **attention_kwargs)
        else:
            # Pre-blocker-attention v1 readers cannot describe unresolved
            # blockers. Permit only boards containing no blocked tasks;
            # otherwise fail closed before any reader installation.
            if any(row.get("state") == "BLOCKED" for row in tasks):
                raise RuntimeError(
                    "WORK_BOARD_V2_ROLLOUT_LEGACY_BLOCKER_ATTENTION_REQUIRED")
            attention = []
        value = {
            "board": board,
            "task_views": task_views,
            "role_work": {role: module.role_work(root, role) for role in "ABC"},
            "blocker_attention": attention,
            "snapshots": {role: module.board_snapshot(root) for role in "ABC"},
            "status": {role: module.status_work(root, role) for role in "ABC"},
        }
        if _semantic_value_identity(board) != board_identity_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_IN_MEMORY_BOARD_CHANGED")
        if _board_binding(root) != binding_before:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_BOARD_OR_EVENT_CHANGED")

        # Cached PASS/FAIL cannot outlive receipt, publication, evidence, or
        # versioned resource-seal bytes. Recheck the real native-root resource
        # seal after deriving every consumer; the work-board/event binding
        # alone does not cover disk-task-completions.
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

def _strict_sha_map(value):
    return (
        isinstance(value, dict)
        and set(value) == {"work_queue", "work_board_v2"}
        and all(isinstance(item, str) and HEX64.fullmatch(item) for item in value.values())
    )

def _transition_contract_policy_valid(prior_sha256, candidate_sha256):
    common_queue = prior_sha256["A"]["work_queue"]
    return (
        all(prior_sha256[role]["work_queue"] == common_queue for role in ROLES)
        and candidate_sha256["work_queue"] != common_queue
        and all(
            prior_sha256[role]["work_board_v2"] == candidate_sha256["work_board_v2"]
            for role in "ABC"
        )
        and prior_sha256["ORG"]["work_board_v2"] != candidate_sha256["work_board_v2"]
    )

def build_transition_contract(rollout_id, prior_sha256, candidate_sha256):
    """Return the sole supported, strict source-bound transition contract."""
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", str(rollout_id)):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ID_INVALID")
    if (not isinstance(prior_sha256, dict) or set(prior_sha256) != set(ROLES)
            or not _strict_sha_map(candidate_sha256)):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_INVALID")
    readers = {}
    normalized_prior = {}
    for role in ROLES:
        prior = prior_sha256[role]
        if not _strict_sha_map(prior):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_INVALID")
        normalized_prior[role] = dict(prior)
        readers[role] = {
            "prior_sha256": dict(prior),
            "candidate_sha256": dict(candidate_sha256),
        }
    if not _transition_contract_policy_valid(normalized_prior, candidate_sha256):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_INVALID")
    return {"kind": TRANSITION_CONTRACT_KIND, "schema_version": TRANSITION_CONTRACT_VERSION,
            "rollout_id": rollout_id, "policy": TRANSITION_CONTRACT_POLICY, "readers": readers}

def _load_transition_contract(root, path, expected_sha, rollout_id, candidate_sha,
                              expected_queue_sha, expected_module_sha):
    if not HEX64.fullmatch(str(expected_sha)):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_HASH_INVALID")
    resolved = _proof_path(root, path)
    raw = _read(resolved, 1024 * 1024)
    if _sha(raw) != expected_sha:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_HASH_MISMATCH")
    def pairs(items):
        result = {}
        for key, item in items:
            if key in result: raise ValueError("duplicate key")
            result[key] = item
        return result
    try: value = json.loads(raw, object_pairs_hook=pairs, parse_constant=lambda _x: (_ for _ in ()).throw(ValueError("constant")))
    except (ValueError, TypeError): raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_INVALID") from None
    if not isinstance(value, dict) or set(value) != {"kind", "schema_version", "rollout_id", "policy", "readers"}:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_INVALID")
    if (value.get("kind") != TRANSITION_CONTRACT_KIND or type(value.get("schema_version")) is not int
        or value["schema_version"] != TRANSITION_CONTRACT_VERSION or value.get("rollout_id") != rollout_id
        or value.get("policy") != TRANSITION_CONTRACT_POLICY or not isinstance(value.get("readers"), dict)
        or set(value["readers"]) != set(ROLES)):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_MISMATCH")
    prior = {}
    for role in ROLES:
        row = value["readers"][role]
        if not isinstance(row, dict) or set(row) != {"prior_sha256", "candidate_sha256"}:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_INVALID")
        if (not _strict_sha_map(row.get("prior_sha256"))
                or not _strict_sha_map(row.get("candidate_sha256"))):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_INVALID")
        prior[role] = row["prior_sha256"]
        if row["candidate_sha256"] != candidate_sha:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_MISMATCH")
        expected = {"work_queue": expected_queue_sha[role], "work_board_v2": expected_module_sha[role]}
        if row["prior_sha256"] != expected:
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_MISMATCH")
    if not _transition_contract_policy_valid(prior, candidate_sha):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_MISMATCH")
    return value, resolved

def _structural_transition(root, candidate_v2):
    """Cheap hot-state/archive validation for the fixed ORG hydration policy."""
    state = candidate_v2._load_state(Path(root), None, require_committed=True)
    hot_rows = state["hot"]["tasks"]
    tombstones = [row for row in hot_rows if "resolved_archive_sha256" in row]
    if not tombstones:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_TOMBSTONE_REQUIRED")
    expected_archives = {}
    paths = candidate_v2._paths(Path(root))
    for tombstone in tombstones:
        if not candidate_v2._is_resolved_blocker_tombstone(tombstone):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_TOMBSTONE_INVALID")
        archived = candidate_v2._read_resolved_blocker_archive(paths, tombstone)
        if archived.get("state") != "BLOCKED" or archived.get("blocker_resolution", {}).get("status") != "RESOLVED":
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_ARCHIVE_INVALID")
        expected_archives[tombstone["id"]] = (archived, tombstone["resolved_archive_sha256"])
    # Use the logical view from this exact committed state read. Re-loading here
    # would create a second mutable-board window and the logical board also
    # contains completed rows in addition to the current hot rows.
    hydrated = {row.get("id"): row for row in state["logical"].get("tasks", [])}
    hot_ids = {row.get("id") for row in hot_rows}
    completed_ids = set(state.get("completed_rows", {}))
    if set(hydrated) != hot_ids | completed_ids:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_HYDRATION_MISMATCH")
    for row in hot_rows:
        identifier = row["id"]
        if identifier in expected_archives:
            if hydrated[identifier] != expected_archives[identifier][0]:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_HYDRATION_MISMATCH")
        else:
            clean = dict(row); clean.pop("_ordinal", None)
            if hydrated[identifier] != clean:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_HYDRATION_MISMATCH")
    digest_rows = sorted((identifier, sha) for identifier, (_row, sha) in expected_archives.items())
    return {
        "tombstone_count": len(tombstones),
        "hydrated_tombstones_sha256": _sha(candidate_v2._canonical_bytes(digest_rows)),
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

def _module_only_writer_flags_off(raw: bytes) -> bool:
    """Conservatively validate writer-off constants, not arbitrary Python trust.

    AST flags are only defense in depth; publisher acceptance must also pin
    reviewed source blob bytes, signer authority, and four-role readback.
    """
    try:
        tree = ast.parse(raw.decode("utf-8"))
    except (SyntaxError, UnicodeDecodeError, ValueError):
        return False
    flags = {"COMPACT_RESOLVED_WRITES_ENABLED", "RESOLVED_COLD_INDEX_WRITES_ENABLED"}
    observed = {}
    allowed_stores = set()
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            target, value = node.targets[0], node.value
        elif isinstance(node, ast.AnnAssign):
            target, value = node.target, node.value
        else:
            continue
        if isinstance(target, ast.Name) and target.id in flags:
            if target.id in observed:
                return False
            if not isinstance(value, ast.Constant) or value.value is not False:
                return False
            observed[target.id] = True
            allowed_stores.add(id(target))
    if set(observed) != flags:
        return False

    # Checking just top-level assignments would accept a later import-time
    # if-block, AugAssign, global binding, or globals()["FLAG"] mutation.
    # None is compatible with reader-only writer-disabled publication.
    unsafe_dynamic_calls = {
        "globals", "locals", "vars", "exec", "eval", "compile",
        "setattr", "delattr", "__import__",
    }
    for node in ast.walk(tree):
        if (isinstance(node, ast.Name) and node.id in flags
                and isinstance(node.ctx, (ast.Store, ast.Del))
                and id(node) not in allowed_stores):
            return False
        if isinstance(node, (ast.Global, ast.Nonlocal)) and flags.intersection(node.names):
            return False
        if (isinstance(node, ast.Constant) and isinstance(node.value, str)
                and node.value in flags):
            return False
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id in unsafe_dynamic_calls):
            return False
    return True


def _module_only_trusted_git_source(raw: bytes) -> bool:
    """Match the byte-for-byte helper to a separately accepted Git source.

    The immutable source triple is supplied by accepted publisher code only.
    It is intentionally None until an external authority provisions it; a
    caller-provided hash, origin/main, or AST scan is not an authorization.
    """
    identity = MODULE_ONLY_ACCEPTED_SOURCE_TRUST_ANCHOR
    if (type(identity) is not tuple or len(identity) != 3
            or any(type(v) is not str or re.fullmatch(r"[0-9a-f]{40}", v) is None
                   for v in identity)):
        return False
    commit, tree, blob = identity
    repo_source = Path(__file__).absolute()
    try:
        _path(repo_source)
        repo = repo_source.parents[2].resolve(strict=True)
        commands = (
            ("cat-file", "-t", commit),
            ("rev-parse", commit + "^{tree}"),
            ("ls-tree", commit, "--", MODULE_ONLY_V2_SOURCE_PATH),
            ("cat-file", "-t", blob),
            ("cat-file", "-p", blob),
        )
        values = []
        for args in commands:
            result = subprocess.run(
                ["/usr/bin/git", "-C", str(repo), *args],
                check=True, capture_output=True, timeout=6,
                env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent",
                     "LC_ALL": "C", "GIT_CONFIG_GLOBAL": "/dev/null",
                     "GIT_CONFIG_SYSTEM": "/dev/null"},
            )
            values.append(result.stdout)
        expected_entry = (
            f"100644 blob {blob}\t{MODULE_ONLY_V2_SOURCE_PATH}"
        ).encode("utf-8")
        return (
            values[0].strip() == b"commit"
            and values[1].strip() == tree.encode("ascii")
            and values[2].strip() == expected_entry
            and values[3].strip() == b"blob"
            and values[4] == raw
        )
    except (OSError, ValueError, subprocess.SubprocessError, RuntimeError):
        return False


def rollout(control_root: Path, candidates: dict[str, Path], reader_dirs: dict[str, Path],
            expected_queue_sha: dict[str, str], expected_module_sha: dict[str, str | None], *,
            rollout_id: str, executing_role: str = "C",
            semantic_transition_proof_path: Path | None = None,
            semantic_transition_proof_sha256: str | None = None,
            transition_contract_path: Path | None = None,
            transition_contract_sha256: str | None = None,
            module_only: bool = False):
    root = Path(control_root)
    if type(module_only) is not bool:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_MODE_INVALID")
    install_names = ("work_board_v2",) if module_only else ("work_queue", "work_board_v2")
    if (set(candidates) != set(install_names) or set(reader_dirs) != set(ROLES)
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
    contract_requested = transition_contract_path is not None or transition_contract_sha256 is not None
    if contract_requested and (transition_contract_path is None or transition_contract_sha256 is None):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_CONTRACT_REQUIRED")
    if contract_requested and transition_requested:
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_MODE_CONFLICT")
    if module_only and (contract_requested or transition_requested):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_MODULE_ONLY_TRANSITION_FORBIDDEN")
    candidate_raw = {}
    for name, path in candidates.items():
        _path(path); candidate_raw[name] = _read(path)
    candidate_sha = {name: _sha(raw) for name, raw in candidate_raw.items()}
    if module_only and not _module_only_writer_flags_off(candidate_raw["work_board_v2"]):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_MODULE_ONLY_WRITER_NOT_DISABLED")
    if module_only and not _module_only_trusted_git_source(candidate_raw["work_board_v2"]):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_MODULE_ONLY_SOURCE_NOT_TRUSTED")
    dirs = {role: Path(reader_dirs[role]) for role in ROLES}
    # Queue source is ALWAYS a verified reader dependency. In module-only
    # mode it is never an installation target (preserves each role's WIP).
    target_paths = {
        role: {name: dirs[role] / (name + ".py")
               for name in ("work_queue", "work_board_v2")}
        for role in ROLES
    }
    if len({str(target_paths[role][name].resolve(strict=False))
            for role in ROLES for name in install_names}) != len(ROLES) * len(install_names):
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
    recovery = receipt.parent / (receipt.stem + ".recovery")
    if os.path.lexists(recovery):
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_RECOVERY_ALREADY_USED")
    status_before = {}
    repos, target_set = {}, set()
    for role, directory in dirs.items():
        repo, status = _git_status(directory, operational_org=role == "ORG"); repos[role] = repo; status_before[role] = status
        for name in install_names:
            target_set.add(target_paths[role][name].resolve(strict=False))
    board_path = root / "controllers/work-board.json"
    event_path = root / "controllers/work-board-events.jsonl"
    board_before, event_before = _raw_hash(board_path), _raw_hash(event_path)
    locks, changes = [], []
    receipt_publication_started = False
    try:
        for role in "ABC":
            lock_path = root / (role + ".lock")
            fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
            locks.append(fd)
            fcntl.flock(fd, fcntl.LOCK_EX)
        fd = os.open(root / "controllers/coordination.lock", os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        locks.append(fd)
        fcntl.flock(fd, fcntl.LOCK_EX)
        # The pre-lock receipt check is a fail-fast only. Two callers may
        # both pass it before either acquires these four writer locks.
        if os.path.lexists(receipt):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ALREADY_USED")
        if os.path.lexists(recovery):
            raise RuntimeError("WORK_BOARD_V2_ROLLOUT_RECOVERY_ALREADY_USED")
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
        contract = None
        contract_path = None
        contract_sha = None
        structural_before = None
        if contract_requested:
            contract, contract_path = _load_transition_contract(
                root, transition_contract_path, transition_contract_sha256, rollout_id,
                candidate_sha, expected_queue_sha, expected_module_sha,
            )
            contract_sha = transition_contract_sha256
            # Exact source checks plus the narrow live structural invariant replace
            # whole-product semantic projections in this policy only.
            structural_before = _structural_transition(root, _module(Path(candidates["work_board_v2"]), "contract_v2_before"))
        else:
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
        # controllers is already required by the verified board. Do not
        # create an untracked recursive ancestor chain here. Persist the new
        # rollout-parent directory entry before any preimage or public write.
        _path(receipt.parent.parent, directory=True)
        receipt.parent.mkdir(mode=0o700, exist_ok=True)
        _path(receipt.parent, directory=True)
        v2._fsync_dir(receipt.parent.parent)
        # Capture every preimage and persist all custody before the first
        # install; a process death must not erase any original dirty/WIP file.
        for role in ROLES:
            for name in install_names:
                target = target_paths[role][name]
                prior = _file_state(target)
                info = _path(target, missing=True)
                if prior["exists"] != (info is not None):
                    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_CUSTODY_MISMATCH")
                changes.append({
                    "role": role, "name": name, "target": str(target), **prior,
                    "new_sha256": candidate_sha[name],
                    "prior_identity": [info.st_dev, info.st_ino] if info else None,
                })
        recovery_custody = _preserve_rollout_preimages(
            receipt, changes, board_sha256=board_before, events_sha256=event_before,
        )
        change_by_target = {item["target"]: item for item in changes}
        for role in ROLES:
            # Default rollout retains the accepted two-file pair. A separately
            # source-reviewed, flag-disabled module-only route can roll out a
            # compatible V2 helper without replacing a role's dirty queue.
            for name in install_names:
                target = target_paths[role][name]
                change = change_by_target[str(target)]
                current = _file_state(target)
                info = _path(target, missing=True)
                identity = [info.st_dev, info.st_ino] if info else None
                if (current["exists"] != change["exists"]
                        or current["sha256"] != change["sha256"]
                        or current["mode"] != change["mode"]
                        or identity != change["prior_identity"]):
                    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_PRIOR_CUSTODY_MISMATCH")
                mode = change["mode"] if change["exists"] else 0o644
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
            # The untouched queue source must still be the exact role-bound
            # source after writing its helper, not merely at preflight.
            if module_only and _file_state(target_paths[role]["work_queue"])["sha256"] != expected_queue_sha[role]:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_QUEUE_SOURCE_MISMATCH")
            if not contract_requested:
                installed = _module(target_paths[role]["work_queue"], role + "_after")
                installed_semantic = _semantic(installed, root)
                if installed_semantic != expected_after[role]:
                    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_SEMANTIC_MISMATCH")
        structural_after = None
        if contract_requested:
            for role in ROLES:
                for name in candidates:
                    if _file_state(target_paths[role][name])['sha256'] != candidate_sha[name]:
                        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_READBACK_FAILED")
            structural_after = _structural_transition(root, _module(target_paths["ORG"]["work_board_v2"], "contract_v2_after"))
            if structural_after != structural_before:
                raise RuntimeError("WORK_BOARD_V2_ROLLOUT_TRANSITION_STRUCTURE_DRIFT")
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
        # Source status can remain " M" while WIP bytes change again. At
        # final commit verify exact per-role source bytes, not git status alone,
        # so a late foreign edit cannot be silently accepted with new helper.
        if module_only:
            for role in ROLES:
                if _file_state(target_paths[role]["work_queue"])["sha256"] != expected_queue_sha[role]:
                    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_QUEUE_SOURCE_MISMATCH")
                if _file_state(target_paths[role]["work_board_v2"])["sha256"] != candidate_sha["work_board_v2"]:
                    raise RuntimeError("WORK_BOARD_V2_ROLLOUT_READBACK_FAILED")
        receipt_value = {"schema_version": 1, "rollout_id": rollout_id, "executing_role": executing_role,
                         # A helper-only rollout cannot certify current
                         # source bytes against non-cooperating OS writers.
                         # Only the old governed pair route publishes COMMITTED.
                         "result": (
                             "APPLIED_PENDING_SOURCE_CURRENTITY"
                             if module_only else "COMMITTED"
                         ),
                         "candidate_sha256": candidate_sha,
                         "recovery_custody": recovery_custody,
                         "installed_file_scope": list(install_names),
                         "board_sha256_before": board_before, "board_sha256_after": _raw_hash(board_path),
                         "events_sha256_before": event_before, "events_sha256_after": _raw_hash(event_path),
                         "role_state_sha256_before": role_state_before,
                         "role_state_sha256_after": role_state_after,
                         "reader_semantics_before": baseline if not contract_requested else None,
                         "reader_semantic_sha256_before": {
                             role: _semantic_digest(baseline[role]) for role in ROLES
                         } if not contract_requested else None,
                         "reader_semantic_sha256_after": {
                             role: _semantic_digest(expected_after[role]) for role in ROLES
                         } if not contract_requested else None,
                         "semantic_transition_proof": (
                             {"path": str(proof_path), "sha256": proof_sha}
                             if transition_requested else None
                         ),
                         "transition_contract": ({"path": str(contract_path), "sha256": contract_sha,
                                                  "structural_transition": structural_after}
                                                 if contract_requested else None),
                         "git_status_before": status_before, "git_status_after": status_after,
                         "prior": [{key: value for key, value in item.items()
                                    if key not in {"raw", "installed_identity"}}
                                   for item in changes]}
        if module_only:
            # This is NOT a release/installation acceptance receipt. The exact
            # per-role hash is a historical observation, not an atomic lease:
            # external privileged source edits can happen after its last read.
            receipt_value["source_currentity"] = {
                "level": "OBSERVED_ONLY_NO_EXCLUSIVE_WRITER_AUTHORITY",
                "observed_queue_sha256_by_role": dict(expected_queue_sha),
                "exclusive_source_revalidation_required": True,
                "exclusive_writer_authority_verified": False,
            }
        receipt_publication_started = True
        # A non-cooperating writer may ignore the role+coordination flock.
        # Never overwrite another receipt for this single-use rollout id.
        _atomic_noreplace(
            receipt, v2._canonical_bytes(receipt_value), 0o600,
            scratch_dir=receipt.parent,
        )
        return receipt_value
    except Exception as error:
        if isinstance(error, _ReceiptPublicationUncertain):
            raise
        if receipt_publication_started:
            # The final rename may be visible even if parent-directory fsync
            # failed. No automatic rollback may contradict a visible receipt.
            receipt_status = None
            try:
                expected_raw = v2._canonical_bytes(receipt_value)
                if _read(receipt, limit=len(expected_raw)) == expected_raw:
                    receipt_status = receipt_value.get("result")
            except (OSError, RuntimeError, ValueError):
                pass
            if receipt_status in {"COMMITTED", "APPLIED_PENDING_SOURCE_CURRENTITY"}:
                raise _ReceiptPublicationUncertain(
                    "WORK_BOARD_V2_ROLLOUT_RECEIPT_DURABILITY_UNCERTAIN_"
                    + receipt_status
                ) from error
            # Even a missing receipt cannot prove that rename never happened
            # in the presence of external non-cooperating writers. Preserve
            # current sources and require authoritative recovery/readback.
            raise _ReceiptPublicationUncertain(
                "WORK_BOARD_V2_ROLLOUT_RECEIPT_WRITE_RECOVERY_REQUIRED"
            ) from error
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
                    _rollback_prior_existing(
                        target, item["raw"], item["mode"], item["sha256"],
                        item.get("installed_identity"), item["new_sha256"],
                        scratch_dir=receipt.parent,
                        preimage_path=Path(item["preimage_path"]) if item.get("preimage_path") else None,
                    )
            except Exception as rollback_error:
                rollback_errors.append(str(rollback_error) or type(rollback_error).__name__)
        if (changes and (
            _raw_hash(board_path) != board_before
            or _raw_hash(event_path) != event_before
            or ("role_state_before" in locals() and {
                role: _raw_hash(root / (role + ".json")) for role in "ABC"
            } != role_state_before)
        )):
            rollback_errors.append("shared-state-drift")
        if rollback_errors: raise RuntimeError("WORK_BOARD_V2_ROLLOUT_ROLLBACK_FAILED: " + ",".join(rollback_errors) + "; install_error=" + str(error)) from None
        raise RuntimeError("WORK_BOARD_V2_ROLLOUT_FAILED: " + str(error) + "; rollback verified") from None
    finally:
        # Linux releases the advisory flock on the final close. Attempt to
        # close every owned descriptor, even when one close reports OSError.
        primary_error = sys.exc_info()[1]
        close_errors = []
        for fd in reversed(locks):
            try:
                os.close(fd)
            except OSError as close_error:
                close_errors.append(close_error)
        if close_errors:
            if primary_error is not None:
                # Do not mask the original rollback/provenance failure.
                if hasattr(primary_error, "add_note"):
                    primary_error.add_note("WORK_BOARD_V2_ROLLOUT_LOCK_CLOSE_FAILED")
            else:
                # Durable receipt may already have been committed. An error
                # after that point is NOT proof that installation rolled back.
                receipt_state = None
                if "receipt_value" in locals():
                    try:
                        expected_receipt_raw = v2._canonical_bytes(receipt_value)
                        if _read(receipt, limit=len(expected_receipt_raw)) == expected_receipt_raw:
                            receipt_state = receipt_value.get("result")
                    except (OSError, RuntimeError, ValueError):
                        pass
                if receipt_state in {"COMMITTED", "APPLIED_PENDING_SOURCE_CURRENTITY"}:
                    code = "WORK_BOARD_V2_ROLLOUT_POSTCOMMIT_CLEANUP_UNCERTAIN_" + receipt_state
                else:
                    code = "WORK_BOARD_V2_ROLLOUT_CLEANUP_UNCERTAIN_RECEIPT_NOT_VERIFIED"
                raise RuntimeError(code) from close_errors[0]
