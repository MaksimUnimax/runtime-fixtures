#!/usr/bin/env python3
"""Inspect-only v1 -> v2 migration with exact single-use apply authority."""
from __future__ import annotations
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import math
import os
import re
import stat
import subprocess
from pathlib import Path
import work_board_v2 as v2

HEX64 = re.compile(r"^[0-9a-f]{64}$")
SCOPE_SHA256 = "afa7e3d8f7e98854bf621890bc8f278f418b201123377dc6de4ff035aa6ea6eb"
AUTHORITY_KIND = "CONTROLLER_COORDINATION_MIGRATION"
AUTH_CAP = 131072


def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _strict(raw: bytes):
    return v2._strict_object(raw)


def _role_float(raw: str):
    value = float(raw)
    if not math.isfinite(value):
        raise ValueError("non-finite role-state number")
    return value


def _write_exclusive(path: Path, raw: bytes):
    v2._ensure_dir(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        view = memoryview(raw)
        while view:
            n = os.write(fd, view)
            if n <= 0:
                raise OSError("short write")
            view = view[n:]
        os.fsync(fd)
    finally:
        os.close(fd)
    v2._fsync_dir(path.parent)


def _hash_file(path: Path, limit=2 * 1024 * 1024):
    return _sha(v2._read_nofollow(path, limit))


def _safe_reader(path: Path):
    path = Path(path)
    if not path.is_absolute():
        raise RuntimeError("WORK_BOARD_V2_READER_PATH_INVALID")
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise RuntimeError("WORK_BOARD_V2_READER_PATH_INVALID")
    return path


def _readers(readers: dict[str, Path], expected: dict[str, str], expected_helper_sha: str):
    if set(readers) != {"A", "B", "C", "ORG"} or set(expected) != set(readers):
        raise RuntimeError("WORK_BOARD_V2_READER_SET_INVALID")
    result = {}
    for role, path in sorted(readers.items()):
        path = _safe_reader(path)
        digest = _hash_file(path)
        if not isinstance(expected[role], str) or not HEX64.fullmatch(expected[role]) or digest != expected[role]:
            raise RuntimeError("WORK_BOARD_V2_READER_HASH_MISMATCH")
        helper = _safe_reader(path.with_name("work_board_v2.py"))
        helper_digest = _hash_file(helper)
        if helper_digest != expected_helper_sha:
            raise RuntimeError("WORK_BOARD_V2_READER_HELPER_HASH_MISMATCH")
        result[role] = {"path": str(path), "sha256": digest, "helper_path": str(helper), "helper_sha256": helper_digest}
    return result


def _load_reader(path: Path, role: str):
    name = f"octoport_work_board_v2_reader_{role}_{os.getpid()}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("WORK_BOARD_V2_READER_IMPORT_FAILED")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _validate_readers(root: Path, readers: dict[str, Path], revision: int, expected_ids: list[str]):
    results = {}
    for role, path in sorted(readers.items()):
        module = _load_reader(path, role)
        board = module.load_board(root)
        if board.get("version") != 2 or board.get("revision") != revision or [t.get("id") for t in board.get("tasks", [])] != expected_ids:
            raise RuntimeError("WORK_BOARD_V2_POST_SWITCH_READER_MISMATCH")
        results[role] = {"revision": revision, "task_count": len(expected_ids), "snapshot": module.board_snapshot(root)}
    if len({row["snapshot"]["sha256"] for row in results.values()}) != 1:
        raise RuntimeError("WORK_BOARD_V2_POST_SWITCH_READER_MISMATCH")
    return results


def _authority(root: Path, authority: Path, readers: dict[str, Path], expected_revision: int, expected_sha: str):
    root = Path(root)
    root_info = root.lstat()
    if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
        raise RuntimeError("WORK_BOARD_V2_CONTROL_ROOT_INVALID")
    root = root.resolve()
    authority = Path(authority)
    expected_parent = (root / "authorizations").resolve()
    if authority.parent.resolve() != expected_parent or not re.fullmatch(r"CONTROLLER-WORK-BOARD-V2-MIGRATION-[A-Za-z0-9._-]+\.json", authority.name):
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_PATH_INVALID")
    info = authority.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > AUTH_CAP or info.st_nlink != 1:
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_FILE_INVALID")
    grant = _strict(v2._read_nofollow(authority, AUTH_CAP))
    required = {"id", "status", "authority", "issued_at", "expires_at", "corrected_scope_sha256",
                "source_candidate_sha", "work_queue_sha256", "work_board_v2_sha256", "migrate_sha256",
                "expected_v1_revision", "expected_v1_sha256", "reader_sha256", "single_use"}
    if (set(grant) != required or grant.get("status") != "GRANTED"
            or grant.get("authority") != AUTHORITY_KIND or grant.get("single_use") is not True
            or not isinstance(grant.get("id"), str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", grant["id"])
            or authority.name != "CONTROLLER-WORK-BOARD-V2-MIGRATION-" + grant["id"] + ".json"):
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_INVALID")
    try:
        issued = dt.datetime.fromisoformat(grant["issued_at"].replace("Z", "+00:00"))
        expires = dt.datetime.fromisoformat(grant["expires_at"].replace("Z", "+00:00"))
        now = dt.datetime.now(dt.timezone.utc)
        if issued.tzinfo is None or expires.tzinfo is None or issued > now or expires <= now or expires <= issued:
            raise ValueError
    except (TypeError, ValueError):
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_EXPIRED_OR_INVALID") from None
    used = root / "controllers/work-board-v2-migration-receipts" / (grant["id"] + ".json")
    if os.path.lexists(used):
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_ALREADY_USED")
    if grant["corrected_scope_sha256"] != SCOPE_SHA256:
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_SCOPE_MISMATCH")
    if grant["expected_v1_revision"] != expected_revision or grant["expected_v1_sha256"] != expected_sha:
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_INPUT_MISMATCH")
    repo = Path(__file__).resolve().parents[2]
    try:
        candidate = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], check=True, capture_output=True, text=True, timeout=5).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        raise RuntimeError("WORK_BOARD_V2_SOURCE_CANDIDATE_UNAVAILABLE") from None
    if grant["source_candidate_sha"] != candidate:
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_SOURCE_MISMATCH")
    hashes = {
        "work_queue_sha256": _hash_file(Path(__file__).with_name("work_queue.py")),
        "work_board_v2_sha256": _hash_file(Path(__file__).with_name("work_board_v2.py")),
        "migrate_sha256": _hash_file(Path(__file__)),
    }
    if any(grant[key] != value for key, value in hashes.items()):
        raise RuntimeError("WORK_BOARD_V2_AUTHORITY_SOURCE_MISMATCH")
    readers_receipt = _readers(readers, grant["reader_sha256"], hashes["work_board_v2_sha256"])
    return grant, readers_receipt, used


def inspect(root: Path):
    root = Path(root)
    hot_path = root / "controllers/work-board.json"
    raw = v2._read_nofollow(hot_path, v2.HOT_CAP_BYTES)
    board = _strict(raw)
    if board.get("version") != 1 or type(board.get("revision")) is not int or not isinstance(board.get("tasks"), list):
        raise RuntimeError("WORK_BOARD_V2_MIGRATION_INPUT_INVALID")
    import work_queue
    work_queue._validate_logical_board(board, enforce_v1_count=True)
    generated = v2.build_generation_from_v1(root, board)
    # Inspect/preflight has no writes: count candidate immutable bytes alongside existing fixed-root files if present.
    done = root / "controllers/work-board-done"
    if done.exists():
        v2._check_done_capacity(root, generated["drafts"])
    return {"mode": "INSPECT_ONLY", "v1_revision": board["revision"], "v1_sha256": _sha(raw),
            "task_count": len(board["tasks"]), "candidate_active_count": len(generated["core"]["tasks"]),
            "candidate_sidecar_count": len(generated["drafts"]), "candidate_generation_core_sha256": v2._semantic_sha(generated["core"])}


def _migration_record(root: Path):
    path = Path(root) / "controllers/work-board-v2-migration.json"
    if not os.path.lexists(path):
        return None
    return v2._strict_file(v2._read_nofollow(path, v2.JOURNAL_CAP_BYTES), v2.JOURNAL_CAP_BYTES)


def recover_migration(root: Path):
    root = Path(root)
    record = _migration_record(root)
    if not record or record.get("state") not in {"PREPARED", "SWITCHING"}:
        return record
    paths = v2._paths(root)
    raw = v2._read_nofollow(paths["migrations"] / (record["pre_v1_sha256"] + ".json"), v2.HOT_CAP_BYTES)
    if _sha(raw) != record["pre_v1_sha256"]:
        raise RuntimeError("WORK_BOARD_V2_V1_ARCHIVE_HASH_MISMATCH")
    v2._atomic_write(paths["hot"], raw)
    opid = record.get("operation_id")
    if isinstance(opid, str) and HEX64.fullmatch(opid):
        txpath = paths["transactions"] / (opid + ".json")
        if os.path.lexists(txpath):
            txraw = v2._read_nofollow(txpath, v2.JOURNAL_CAP_BYTES)
            tx = v2._strict_file(txraw, v2.JOURNAL_CAP_BYTES)
            if tx["state"] not in {"COMMITTED", "ROLLED_BACK"}:
                tx["state"] = "ROLLED_BACK"
                v2._write_journal(root, tx)
    record["state"] = "ROLLED_BACK"
    record["rollback"] = {"exact_v1_restored": True}
    v2._atomic_write(Path(root) / "controllers/work-board-v2-migration.json", v2._canonical_bytes(record))
    if _sha(v2._read_nofollow(paths["hot"], v2.HOT_CAP_BYTES)) != record["pre_v1_sha256"]:
        raise RuntimeError("WORK_BOARD_V2_V1_RESTORE_FAILED")
    return record


def migrate_locked(root: Path, authority: Path, readers: dict[str, Path], expected_revision: int, expected_sha256: str, executing_role: str = "C"):
    root = Path(root)
    authority = Path(authority)
    prefix = "CONTROLLER-WORK-BOARD-V2-MIGRATION-"
    if authority.name.startswith(prefix) and authority.name.endswith(".json"):
        authority_id = authority.name[len(prefix):-5]
        if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", authority_id):
            used = root / "controllers/work-board-v2-migration-receipts" / (authority_id + ".json")
            if os.path.lexists(used):
                raise RuntimeError("WORK_BOARD_V2_AUTHORITY_ALREADY_USED")
    hot_path = root / "controllers/work-board.json"
    raw = v2._read_nofollow(hot_path, v2.HOT_CAP_BYTES)
    input_sha = _sha(raw)
    if input_sha != expected_sha256:
        raise RuntimeError("WORK_BOARD_V2_MIGRATION_INPUT_SHA_MISMATCH")
    board = _strict(raw)
    if board.get("version") != 1 or board.get("revision") != expected_revision:
        raise RuntimeError("WORK_BOARD_V2_MIGRATION_INPUT_INVALID")
    import work_queue
    work_queue._validate_logical_board(board, enforce_v1_count=True)
    grant, reader_receipt, applied_receipt = _authority(root, authority, readers, expected_revision, input_sha)
    if executing_role not in {"A", "B", "C"}:
        raise RuntimeError("WORK_BOARD_V2_EXECUTING_ROLE_INVALID")
    try:
        # Role state is an existing control.py document, not canonical v2
        # storage. Its heartbeat/lease timestamps legitimately use floats.
        role_state = json.loads(
            v2._read_nofollow(root / (executing_role + ".json"), 2 * 1024 * 1024),
            object_pairs_hook=v2._pairs, parse_constant=v2._reject_constant, parse_float=_role_float,
        )
        if not isinstance(role_state, dict):
            raise RuntimeError("WORK_BOARD_V2_EXECUTING_ROLE_STATE_INVALID")
    except FileNotFoundError:
        raise RuntimeError("WORK_BOARD_V2_EXECUTING_ROLE_STATE_INVALID") from None
    if role_state.get("status") == "STOPPED":
        raise RuntimeError("STOPPED: no migration permitted")
    if role_state.get("status") not in {"RUNNING", "WAITING_INPUT"}:
        raise RuntimeError("WORK_BOARD_V2_EXECUTING_ROLE_STATE_INVALID")
    previous_record = _migration_record(root)
    if previous_record and previous_record.get("state") in {"PREPARED", "SWITCHING"}:
        raise RuntimeError("WORK_BOARD_V2_MIGRATION_RECOVERY_REQUIRED")

    generated = v2.build_generation_from_v1(root, board)
    archive_drafts = dict(generated["drafts"])
    archive_drafts[("migrations", input_sha + ".json")] = raw
    done_root = root / "controllers/work-board-done"
    if done_root.exists():
        v2._check_done_capacity(root, archive_drafts)
    elif sum(len(value) for value in archive_drafts.values()) > v2.DONE_STORAGE_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_DONE_STORAGE_CAPACITY")

    core = generated["core"]
    hot = dict(core, generation_id=v2._generation_id(core), last_operation_id="0" * 64)
    migration_id = v2._semantic_sha({"schema_version": 1, "pre_v1_sha256": input_sha,
                                     "new_generation_id": hot["generation_id"],
                                     "authority_id": grant["id"]})
    opid, new_raw, tx = v2._make_migration_tx(input_sha, expected_revision, hot, v2._canonical_bytes(hot), migration_id)
    if len(new_raw) > v2.HOT_CAP_BYTES:
        raise RuntimeError("WORK_QUEUE_INVALID: size")
    v2._check_event_log(root)
    txraw = v2._journal_text(tx)
    directory, journals, temps, total = v2._tx_scan(root, create=True)
    if temps or opid in journals or len(journals) + 1 > v2.JOURNAL_COUNT_CAP or len(journals) + 2 > v2.JOURNAL_ENTRY_CAP or total + len(txraw) + v2.JOURNAL_REWRITE_RESERVE_BYTES > v2.JOURNAL_DIR_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_CAPACITY")

    paths = v2._paths(root, create=True)
    pre_archive = paths["migrations"] / (input_sha + ".json")
    if os.path.lexists(pre_archive):
        if v2._read_nofollow(pre_archive, v2.HOT_CAP_BYTES) != raw:
            raise RuntimeError("WORK_BOARD_V2_MIGRATION_ARCHIVE_MISMATCH")
    else:
        v2._put_immutable(paths["migrations"], input_sha + ".json", raw, v2.HOT_CAP_BYTES)
    v2._write_drafts(root, generated["drafts"])
    v2._check_done_capacity(root)
    v2.validate_hot_candidate(root, new_raw)
    record = {"schema_version": 1, "state": "PREPARED", "migration_id": migration_id,
              "operation_id": opid, "authority_id": grant["id"], "pre_v1_sha256": input_sha,
              "pre_v1_revision": expected_revision, "new_hot_sha256": _sha(new_raw),
              "new_generation_id": hot["generation_id"], "readers": reader_receipt, "post_switch": None}
    record_path = root / "controllers/work-board-v2-migration.json"
    v2._atomic_write(record_path, v2._canonical_bytes(record))
    v2._fault("migration_after_prepared")
    v2._write_journal(root, tx, initial=True)
    tx["state"] = "DATA_DURABLE"
    v2._write_journal(root, tx)
    record["state"] = "SWITCHING"
    v2._atomic_write(record_path, v2._canonical_bytes(record))
    try:
        v2.install_hot_generation(root, new_raw)
        v2._fault("migration_after_hot_before_readback")
        tx["state"] = "HOT_PUBLISHED"
        v2._write_journal(root, tx)
        pending_state = v2._load_state(root, new_raw, require_committed=False)
        expected_logical = {"version": 2, "revision": board["revision"], "updated_at": board.get("updated_at", ""), "tasks": board["tasks"]}
        if pending_state["logical"] != expected_logical:
            raise RuntimeError("WORK_BOARD_V2_MIGRATION_PENDING_LOGICAL_MISMATCH")
        post = {}
        for role, path in sorted(readers.items()):
            module = _load_reader(path, role)
            core = module._v2()
            state = core._load_state(root, new_raw, require_committed=False)
            if state["logical"] != expected_logical:
                raise RuntimeError("WORK_BOARD_V2_POST_SWITCH_READER_MISMATCH")
            post[role] = {"revision": expected_revision, "task_count": len(board["tasks"]),
                          "snapshot": core._snapshot_from_state(state), "validation": "PENDING_GENERATION_INTERNAL_READBACK"}
        if len({value["snapshot"]["sha256"] for value in post.values()}) != 1:
            raise RuntimeError("WORK_BOARD_V2_POST_SWITCH_READER_MISMATCH")
        tx["state"] = "COMMITTED"
        v2._write_journal(root, tx)
        record["post_switch"] = post
        record["state"] = "COMMITTED"
        v2._atomic_write(record_path, v2._canonical_bytes(record))
        applied = {"schema_version": 1, "authority_id": grant["id"], "result": "COMMITTED",
                   "migration_id": migration_id, "pre_v1_sha256": input_sha,
                   "new_hot_sha256": _sha(new_raw), "generation_id": hot["generation_id"],
                   "operation_id": opid}
        _write_exclusive(applied_receipt, v2._canonical_bytes(applied))
        return record
    except Exception as error:
        try:
            committed_record = _migration_record(root)
        except Exception:
            raise RuntimeError("WORK_BOARD_V2_MIGRATION_COMMIT_STATE_UNCERTAIN: preserve candidate and reconcile") from None
        if committed_record and committed_record.get("state") == "COMMITTED" and committed_record.get("operation_id") == opid:
            raise RuntimeError("WORK_BOARD_V2_MIGRATION_COMMITTED_RECEIPT_OR_READBACK_FAILURE: preserve committed generation") from None
        v2._atomic_write(paths["hot"], raw)
        tx["state"] = "ROLLED_BACK"
        v2._write_journal(root, tx)
        record["state"] = "ROLLED_BACK"
        record["rollback"] = {"error_type": type(error).__name__, "exact_v1_restored": True}
        v2._atomic_write(record_path, v2._canonical_bytes(record))
        applied = {"schema_version": 1, "authority_id": grant["id"], "result": "ROLLED_BACK",
                   "migration_id": migration_id, "pre_v1_sha256": input_sha,
                   "exact_v1_restored": _sha(v2._read_nofollow(paths["hot"], v2.HOT_CAP_BYTES)) == input_sha}
        _write_exclusive(applied_receipt, v2._canonical_bytes(applied))
        raise


def migrate(root: Path, authority: Path, readers: dict[str, Path], expected_revision: int, expected_sha256: str, executing_role: str = "C"):
    root = Path(root)
    if executing_role not in {"A", "B", "C"}:
        raise RuntimeError("WORK_BOARD_V2_EXECUTING_ROLE_INVALID")
    with (root / (executing_role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            return migrate_locked(root, authority, readers, expected_revision, expected_sha256, executing_role)


def _parse_reader(values):
    result = {}
    for value in values:
        role, sep, raw_path = value.partition("=")
        if not sep or role not in {"A", "B", "C", "ORG"} or role in result:
            raise RuntimeError("WORK_BOARD_V2_READER_SET_INVALID")
        result[role] = Path(raw_path)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--reader", action="append", default=[])
    parser.add_argument("--authority")
    parser.add_argument("--apply", action="store_true", help="apply only with a valid single-use authority receipt")
    parser.add_argument("--executing-role", choices=("A", "B", "C"), default="C")
    args = parser.parse_args(argv)
    root = Path(args.root)
    try:
        readers = _parse_reader(args.reader)
        if not args.apply:
            print(json.dumps(inspect(root), sort_keys=True))
            return 0
        if not args.authority or set(readers) != {"A", "B", "C", "ORG"}:
            raise RuntimeError("WORK_BOARD_V2_AUTHORITY_REQUIRED")
        current_raw = v2._read_nofollow(root / "controllers/work-board.json", v2.HOT_CAP_BYTES)
        current = _strict(current_raw)
        result = migrate(root, Path(args.authority), readers, current.get("revision"), _sha(current_raw), args.executing_role)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (OSError, RuntimeError, ValueError, TypeError) as error:
        print(str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
