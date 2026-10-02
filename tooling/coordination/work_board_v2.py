"""Durable v2 work-board storage. Queue policy stays in work_queue.py."""
from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import stat
from pathlib import Path

VERSION = 2
NODE_VERSION = 1
ARCHIVE_VERSION = 1
HOT_CAP_BYTES = 262144
NODE_CAP_BYTES = 262144
ARCHIVE_CAP_BYTES = 524288
ACTIVE_TASK_CAP = 100
COMPLETED_CURRENT_CAP = 100000
ARCHIVE_GENERATION_CAP = 200000
DONE_STORAGE_CAP_BYTES = 536870912
EVENT_LOG_CAP_BYTES = 67108864
EVENT_LINE_CAP_BYTES = 65536
JOURNAL_CAP_BYTES = 131072
JOURNAL_COUNT_CAP = 4096
JOURNAL_ENTRY_CAP = 4097
JOURNAL_DIR_CAP_BYTES = 67108864
JOURNAL_REWRITE_RESERVE_BYTES = 131072
COMPLETION_RECEIPT_CAP_BYTES = 65536
HEX64 = re.compile(r"^[0-9a-f]{64}$")
PLAN_IDS = {f"{role}{number:02d}" for role, numbers in (("A", range(1, 7)), ("B", range(1, 8)), ("C", range(0, 8))) for number in numbers}
ACTIVE_STATES = {"READY", "IN_PROGRESS", "BLOCKED"}
TX_STATES = {"PREPARED", "DATA_DURABLE", "HOT_PUBLISHED", "EVENT_DURABLE", "COMMITTED", "ROLLED_BACK"}

def _fault(_point: str) -> None:
    """No-op fault seam; tests replace this with deterministic crash points."""
    return None

def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result

def _reject_constant(_value):
    raise ValueError("non-finite number")

def _check_json_types(value):
    if isinstance(value, float):
        raise ValueError("float not allowed")
    if isinstance(value, dict):
        if not all(isinstance(k, str) for k in value):
            raise ValueError("object key must be a string")
        for item in value.values():
            _check_json_types(item)
    elif isinstance(value, list):
        for item in value:
            _check_json_types(item)

def _semantic_bytes(value) -> bytes:
    _check_json_types(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")

def _canonical_bytes(value) -> bytes:
    return _semantic_bytes(value) + b"\n"

def _pretty_bytes(value) -> bytes:
    _check_json_types(value)
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")

def _sha(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()

def _semantic_sha(value) -> str:
    return _sha(_semantic_bytes(value))

def _strict_object(raw: bytes):
    value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_reject_constant)
    if not isinstance(value, dict):
        raise ValueError("JSON object required")
    _check_json_types(value)
    return value

def _strict_file(raw: bytes, limit: int):
    if len(raw) > limit or not raw.endswith(b"\n") or raw.endswith(b"\n\n"):
        raise RuntimeError("WORK_BOARD_V2_CANONICAL_FILE_INVALID")
    try:
        value = _strict_object(raw[:-1])
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("WORK_BOARD_V2_CANONICAL_FILE_INVALID") from error
    if _canonical_bytes(value) != raw:
        raise RuntimeError("WORK_BOARD_V2_CANONICAL_FILE_INVALID")
    return value

def _fsync_dir(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)

def _ensure_dir(path: Path, mode: int = 0o700) -> None:
    path = Path(path)
    if not path.is_absolute():
        raise RuntimeError("WORK_BOARD_V2_FIXED_ROOT_INVALID")
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            try:
                current.mkdir(mode=mode)
                _fsync_dir(current.parent)
            except FileExistsError:
                pass
            info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise RuntimeError("WORK_BOARD_V2_FIXED_ROOT_UNSAFE")

def _regular_lstat(path: Path, missing_ok: bool = False):
    try:
        info = Path(path).lstat()
    except FileNotFoundError:
        if missing_ok:
            return None
        raise
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise RuntimeError("WORK_BOARD_V2_STORAGE_NOT_REGULAR")
    return info

def _read_nofollow(path: Path, limit: int | None = None) -> bytes:
    # Opening a FIFO must not block before fstat can reject it. This flag has
    # no effect on regular files, the only supported storage objects.
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(path, flags)
    except FileNotFoundError:
        raise
    except OSError as error:
        raise RuntimeError("WORK_BOARD_V2_STORAGE_UNREADABLE") from error
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise RuntimeError("WORK_BOARD_V2_STORAGE_NOT_REGULAR")
        if limit is not None and info.st_size > limit:
            raise RuntimeError("WORK_BOARD_V2_STORAGE_OVERSIZE")
        chunks = []
        remaining = None if limit is None else limit + 1
        while True:
            amount = 65536 if remaining is None else min(65536, remaining)
            if amount <= 0:
                break
            part = os.read(fd, amount)
            if not part:
                break
            chunks.append(part)
            if remaining is not None:
                remaining -= len(part)
        raw = b"".join(chunks)
        if limit is not None and len(raw) > limit:
            raise RuntimeError("WORK_BOARD_V2_STORAGE_OVERSIZE")
        return raw
    finally:
        os.close(fd)

def _atomic_write(path: Path, raw: bytes, mode: int = 0o600, *, temp_path: Path | None = None) -> None:
    path = Path(path)
    _ensure_dir(path.parent)
    current = _regular_lstat(path, missing_ok=True)
    if current is not None and current.st_nlink != 1:
        raise RuntimeError("WORK_BOARD_V2_STORAGE_HARDLINK")
    temporary = Path(temp_path) if temp_path else path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(8)}.tmp")
    if temporary.parent != path.parent:
        raise RuntimeError("WORK_BOARD_V2_TEMP_PATH_INVALID")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temporary, flags, mode)
    try:
        view = memoryview(raw)
        while view:
            count = os.write(fd, view)
            if count <= 0:
                raise OSError("short write")
            view = view[count:]
        os.fsync(fd)
    except Exception:
        os.close(fd)
        try:
            temporary.unlink()
            _fsync_dir(temporary.parent)
        except OSError:
            pass
        raise
    else:
        os.close(fd)
    os.replace(temporary, path)
    _fsync_dir(path.parent)

def _paths(root: Path, *, create: bool = False):
    root = Path(root)
    try:
        root_info = root.lstat()
    except OSError as error:
        raise RuntimeError("WORK_BOARD_V2_CONTROL_ROOT_INVALID") from error
    if stat.S_ISLNK(root_info.st_mode) or not stat.S_ISDIR(root_info.st_mode):
        raise RuntimeError("WORK_BOARD_V2_CONTROL_ROOT_INVALID")
    controllers = root / "controllers"
    done = controllers / "work-board-done"
    nodes = done / "nodes"
    rows = done / "rows"
    migrations = done / "migrations"
    transactions = controllers / "work-board-v2-transactions"
    for directory in (controllers, done, nodes, rows, migrations, transactions):
        if create:
            _ensure_dir(directory)
        else:
            try:
                info = directory.lstat()
            except OSError as error:
                raise RuntimeError("WORK_BOARD_V2_STORAGE_UNREADABLE") from error
            if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
                raise RuntimeError("WORK_BOARD_V2_FIXED_ROOT_UNSAFE")
    return {
        "hot": controllers / "work-board.json",
        "events": controllers / "work-board-events.jsonl",
        "done": done,
        "nodes": nodes,
        "rows": rows,
        "migrations": migrations,
        "migration": controllers / "work-board-v2-migration.json",
        "transactions": transactions,
    }

def _task_digest(identifier: str) -> str:
    return _sha(identifier.encode("utf-8"))

def _file_content_path(directory: Path, name: str) -> Path:
    if not re.fullmatch(r"[0-9a-f]{64}\.json", name):
        raise RuntimeError("WORK_BOARD_V2_PATH_INVALID")
    return directory / name

def _put_immutable(directory: Path, filename: str, raw: bytes, limit: int) -> str:
    if len(raw) > limit:
        raise RuntimeError("WORK_BOARD_V2_COMPLETED_CAPACITY")
    path = _file_content_path(directory, filename)
    existing = _regular_lstat(path, missing_ok=True)
    if existing is not None:
        if existing.st_nlink != 1:
            raise RuntimeError("WORK_BOARD_V2_STORAGE_HARDLINK")
        old = _read_nofollow(path, limit)
        if old != raw:
            raise RuntimeError("WORK_BOARD_V2_CONTENT_ADDRESS_COLLISION")
        return _sha(raw)
    _atomic_write(path, raw)
    if _read_nofollow(path, limit) != raw:
        raise RuntimeError("WORK_BOARD_V2_CONTENT_READBACK_MISMATCH")
    return _sha(raw)

def _read_immutable(directory: Path, filename: str, expected_sha: str, limit: int) -> bytes:
    path = _file_content_path(directory, filename)
    try:
        info = _regular_lstat(path)
        if info.st_nlink != 1:
            raise RuntimeError("WORK_BOARD_V2_STORAGE_HARDLINK")
        raw = _read_nofollow(path, limit)
    except FileNotFoundError:
        raise RuntimeError("WORK_BOARD_V2_CONTENT_MISSING") from None
    if _sha(raw) != expected_sha:
        raise RuntimeError("WORK_BOARD_V2_HASH_MISMATCH")
    value = _strict_file(raw, limit)
    if _canonical_bytes(value) != raw:
        raise RuntimeError("WORK_BOARD_V2_CANONICAL_FILE_INVALID")
    return raw

def _walk_done(root: Path) -> tuple[int, dict[Path, int]]:
    paths = _paths(Path(root))
    seen = {}
    total = 0
    expected = {"nodes", "rows", "migrations"}
    names = {item.name for item in paths["done"].iterdir()}
    if names != expected:
        raise RuntimeError("WORK_BOARD_V2_DONE_TREE_INVALID")
    for dirname in sorted(expected):
        directory = paths["done"] / dirname
        info = directory.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise RuntimeError("WORK_BOARD_V2_DONE_TREE_INVALID")
        for item in directory.iterdir():
            fi = item.lstat()
            if stat.S_ISLNK(fi.st_mode) or not stat.S_ISREG(fi.st_mode) or fi.st_nlink != 1:
                raise RuntimeError("WORK_BOARD_V2_DONE_TREE_INVALID")
            if not re.fullmatch(r"[0-9a-f]{64}\.json", item.name):
                raise RuntimeError("WORK_BOARD_V2_DONE_TREE_INVALID")
            total += fi.st_size
            seen[item] = fi.st_size
    return total, seen

def _check_done_capacity(root: Path, drafts: dict[tuple[str, str], bytes] | None = None) -> None:
    total, files = _walk_done(Path(root))
    for (directory, filename), raw in (drafts or {}).items():
        if directory not in {"nodes", "rows", "migrations"}:
            raise RuntimeError("WORK_BOARD_V2_PATH_INVALID")
        path = _file_content_path(Path(root) / "controllers/work-board-done" / directory, filename)
        if path in files:
            existing = _read_nofollow(path, max(len(raw), ARCHIVE_CAP_BYTES))
            if existing != raw:
                raise RuntimeError("WORK_BOARD_V2_CONTENT_ADDRESS_COLLISION")
        else:
            total += len(raw)
    if total > DONE_STORAGE_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_DONE_STORAGE_CAPACITY")

def _write_drafts(root: Path, drafts: dict[tuple[str, str], bytes]) -> None:
    paths = _paths(Path(root), create=True)
    for (directory, filename), raw in sorted(drafts.items()):
        cap = NODE_CAP_BYTES if directory == "nodes" else ARCHIVE_CAP_BYTES
        actual = _put_immutable(paths[directory], filename, raw, cap)
        expected = filename[:-5] if directory == "nodes" else None
        if expected and actual != expected:
            raise RuntimeError("WORK_BOARD_V2_HASH_MISMATCH")
        if _read_nofollow(paths[directory] / filename, cap) != raw:
            raise RuntimeError("WORK_BOARD_V2_CONTENT_READBACK_MISMATCH")
    _check_done_capacity(Path(root))

def _entry_identifier(entry: dict) -> str:
    identifier = entry.get("id") if "id" in entry else entry.get("archive_entry_id")
    if not isinstance(identifier, str) or not identifier:
        raise RuntimeError("WORK_BOARD_V2_COMPLETED_ENTRY_INVALID")
    return identifier

def _entry_digest(entry: dict) -> str:
    return _task_digest(_entry_identifier(entry))

def _trie_drafts(entries: list[dict], kind: str, cap: int) -> tuple[str | None, int, dict]:
    if not entries:
        return None, 0, {}
    drafts: dict[tuple[str, str], bytes] = {}
    def build(values, depth):
        values = sorted(values, key=lambda item: (_entry_digest(item), _entry_identifier(item)))
        prefix = _entry_digest(values[0])[:depth * 2]
        leaf = {"version": NODE_VERSION, "kind": "leaf", "tree": kind, "depth": depth,
                "count": len(values), "entries": values}
        if len(_canonical_bytes(leaf)) <= cap:
            raw = _canonical_bytes(leaf)
            digest = _sha(raw)
            drafts[("nodes", digest + ".json")] = raw
            return digest, "leaf", len(values)
        if depth >= 32:
            raise RuntimeError("WORK_BOARD_V2_COMPLETED_CAPACITY")
        groups = {}
        start = depth * 2
        for value in values:
            d = _entry_digest(value)
            if d[:start] != prefix:
                raise RuntimeError("WORK_BOARD_V2_TRIE_PREFIX_INVALID")
            groups.setdefault(d[start:start + 2], []).append(value)
        children = []
        for byte in sorted(groups):
            child_sha, child_kind, child_count = build(groups[byte], depth + 1)
            children.append({"byte": byte, "sha256": child_sha, "count": child_count, "kind": child_kind})
        if len(children) > 256:
            raise RuntimeError("WORK_BOARD_V2_COMPLETED_CAPACITY")
        node = {"version": NODE_VERSION, "kind": "internal", "tree": kind,
                "depth": depth, "count": len(values), "children": children}
        raw = _canonical_bytes(node)
        if len(raw) > cap:
            raise RuntimeError("WORK_BOARD_V2_COMPLETED_CAPACITY")
        digest = _sha(raw)
        drafts[("nodes", digest + ".json")] = raw
        return digest, "internal", len(values)
    root_sha, _root_kind, count = build(entries, 0)
    return root_sha, count, drafts

def _validate_leaf_entry(entry: dict, tree: str, prefix: str):
    if not isinstance(entry, dict):
        raise RuntimeError("WORK_BOARD_V2_COMPLETED_ENTRY_INVALID")
    identifier = _entry_identifier(entry)
    digest = _task_digest(identifier)
    if not digest.startswith(prefix):
        raise RuntimeError("WORK_BOARD_V2_COMPLETED_ENTRY_HASH_INVALID")
    if tree == "completed":
        common = {"id", "role", "plan", "result", "requires", "ordinal", "completion_class",
                  "completion_receipt", "completion_generation", "archive_entry_id", "archive_sha256"}
        optional = {"completion_receipt_format", "completion_candidate_sha"}
        if not common.issubset(entry) or set(entry) - common - optional:
            raise RuntimeError("WORK_BOARD_V2_COMPLETED_ENTRY_INVALID")
        strict = entry.get("completion_class") == "STRICT_V1"
        expected = common | (optional if strict else set())
        if set(entry) != expected:
            raise RuntimeError("WORK_BOARD_V2_COMPLETED_ENTRY_INVALID")
        if (entry.get("role") not in {"A", "B", "C"} or not isinstance(entry.get("plan"), str)
            or entry["plan"] not in PLAN_IDS
            or not isinstance(entry.get("result"), str) or not entry["result"].strip()
            or not isinstance(entry.get("requires"), list) or not all(isinstance(x, str) for x in entry["requires"])
            or not isinstance(entry.get("completion_receipt"), str) or not entry["completion_receipt"]
            or type(entry.get("ordinal")) is not int or entry["ordinal"] < 0
            or type(entry.get("completion_generation")) is not int or entry["completion_generation"] < 1
            or not HEX64.fullmatch(str(entry.get("archive_entry_id")))
            or not HEX64.fullmatch(str(entry.get("archive_sha256")))):
            raise RuntimeError("WORK_BOARD_V2_COMPLETED_ENTRY_INVALID")
        if strict:
            candidate = entry.get("completion_candidate_sha")
            if (entry.get("completion_receipt_format") != 1 or type(entry.get("completion_receipt_format")) is not int
                or not isinstance(candidate, str) or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", candidate)):
                raise RuntimeError("WORK_BOARD_V2_COMPLETED_ENTRY_INVALID")
        elif entry.get("completion_class") != "LEGACY_UNVERIFIED":
            raise RuntimeError("WORK_BOARD_V2_COMPLETED_ENTRY_INVALID")
    elif tree == "archive_history":
        expected = {"archive_entry_id", "archive_sha256", "archive_size", "task_id", "completion_generation"}
        if (set(entry) != expected or not HEX64.fullmatch(str(entry.get("archive_entry_id")))
            or not HEX64.fullmatch(str(entry.get("archive_sha256")))
            or type(entry.get("archive_size")) is not int or entry["archive_size"] < 1
            or not isinstance(entry.get("task_id"), str) or not entry["task_id"]
            or type(entry.get("completion_generation")) is not int or entry["completion_generation"] < 1):
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_HISTORY_ENTRY_INVALID")
    else:
        raise RuntimeError("WORK_BOARD_V2_NODE_INVALID")

def _read_trie(root: Path, root_sha: str | None, expected_count: int, tree: str) -> list[dict]:
    if root_sha is None:
        if expected_count != 0:
            raise RuntimeError("WORK_BOARD_V2_TRIE_COUNT_MISMATCH")
        return []
    if not HEX64.fullmatch(str(root_sha)) or type(expected_count) is not int or expected_count < 1:
        raise RuntimeError("WORK_BOARD_V2_TRIE_ROOT_INVALID")
    paths = _paths(Path(root))
    seen_nodes = set()
    def visit(digest, depth, prefix):
        if digest in seen_nodes or depth > 32:
            raise RuntimeError("WORK_BOARD_V2_NODE_CYCLE_OR_DEPTH")
        seen_nodes.add(digest)
        raw = _read_immutable(paths["nodes"], digest + ".json", digest, NODE_CAP_BYTES)
        node = _strict_file(raw, NODE_CAP_BYTES)
        if (node.get("version") != NODE_VERSION or node.get("tree") != tree
            or node.get("depth") != depth or type(node.get("count")) is not int
            or node.get("count") <= 0 or node.get("kind") not in {"leaf", "internal"}):
            raise RuntimeError("WORK_BOARD_V2_NODE_INVALID")
        if node["kind"] == "leaf":
            if set(node) != {"version", "kind", "tree", "depth", "count", "entries"} or not isinstance(node["entries"], list):
                raise RuntimeError("WORK_BOARD_V2_NODE_INVALID")
            if node["count"] != len(node["entries"]):
                raise RuntimeError("WORK_BOARD_V2_NODE_COUNT_MISMATCH")
            entries = node["entries"]
            keys = []
            for entry in entries:
                _validate_leaf_entry(entry, tree, prefix)
                keys.append(_entry_identifier(entry))
            if keys != sorted(keys, key=lambda key: (_task_digest(key), key)) or len(keys) != len(set(keys)):
                raise RuntimeError("WORK_BOARD_V2_NODE_ENTRY_ORDER")
            return entries
        if (set(node) != {"version", "kind", "tree", "depth", "count", "children"}
            or not isinstance(node["children"], list) or depth >= 32 or len(node["children"]) > 256):
            raise RuntimeError("WORK_BOARD_V2_NODE_INVALID")
        children = node["children"]
        byte_keys, values, subtotal = [], [], 0
        for child in children:
            if (not isinstance(child, dict) or set(child) != {"byte", "sha256", "count", "kind"}
                or not re.fullmatch(r"[0-9a-f]{2}", str(child.get("byte")))
                or not HEX64.fullmatch(str(child.get("sha256")))
                or child.get("kind") not in {"leaf", "internal"}
                or type(child.get("count")) is not int or child["count"] <= 0):
                raise RuntimeError("WORK_BOARD_V2_NODE_INVALID")
            byte_keys.append(child["byte"])
            items = visit(child["sha256"], depth + 1, prefix + child["byte"])
            if len(items) != child["count"]:
                raise RuntimeError("WORK_BOARD_V2_NODE_COUNT_MISMATCH")
            child_raw = _read_immutable(paths["nodes"], child["sha256"] + ".json", child["sha256"], NODE_CAP_BYTES)
            if _strict_file(child_raw, NODE_CAP_BYTES)["kind"] != child["kind"]:
                raise RuntimeError("WORK_BOARD_V2_NODE_KIND_MISMATCH")
            subtotal += len(items)
            values.extend(items)
        if byte_keys != sorted(set(byte_keys)) or subtotal != node["count"]:
            raise RuntimeError("WORK_BOARD_V2_NODE_COUNT_MISMATCH")
        return values
    values = visit(root_sha, 0, "")
    if len(values) != expected_count:
        raise RuntimeError("WORK_BOARD_V2_TRIE_COUNT_MISMATCH")
    keys = [_entry_identifier(value) for value in values]
    if len(keys) != len(set(keys)):
        raise RuntimeError("WORK_BOARD_V2_DUPLICATE_ID")
    return values

def _make_archive(root: Path, task: dict, ordinal: int, generation: int, drafts: dict):
    row = dict(task)
    row.pop("_ordinal", None)
    if row.get("state") != "DONE":
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_ROW_INVALID")
    row_sha = _semantic_sha(row)
    wrapper = {"schema_version": ARCHIVE_VERSION, "task_id": row["id"],
               "completion_generation": generation, "row_sha256": row_sha, "row": row}
    raw = _canonical_bytes(wrapper)
    if len(raw) > ARCHIVE_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_ROW_CAPACITY")
    archive_sha = _sha(raw)
    archive_id = _semantic_sha({"schema_version": ARCHIVE_VERSION, "task_id": row["id"],
                                "completion_generation": generation, "archive_sha256": archive_sha})
    drafts[("rows", archive_id + ".json")] = raw
    if "completion_receipt_format" not in row:
        if "completion_candidate_sha" in row:
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_CLASS_INVALID")
        classification = "LEGACY_UNVERIFIED"
        metadata = {}
    elif type(row.get("completion_receipt_format")) is int and row["completion_receipt_format"] == 1:
        candidate = row.get("completion_candidate_sha")
        if not isinstance(candidate, str) or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", candidate):
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_CLASS_INVALID")
        classification = "STRICT_V1"
        metadata = {"completion_receipt_format": 1, "completion_candidate_sha": candidate}
    else:
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_CLASS_INVALID")
    entry = {"id": row["id"], "role": row["role"], "plan": row["plan"], "result": row["result"],
             "requires": list(row["requires"]), "ordinal": ordinal, "completion_class": classification,
             "completion_receipt": row["completion_receipt"], **metadata,
             "completion_generation": generation, "archive_entry_id": archive_id, "archive_sha256": archive_sha}
    history = {"archive_entry_id": archive_id, "archive_sha256": archive_sha, "archive_size": len(raw),
               "task_id": row["id"], "completion_generation": generation}
    return entry, history

def _read_archive(paths, entry: dict) -> tuple[dict, int, int]:
    if not isinstance(entry, dict):
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_ENTRY_INVALID")
    archive_id = entry.get("archive_entry_id")
    if not HEX64.fullmatch(str(archive_id)):
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_ENTRY_INVALID")
    raw = _read_immutable(paths["rows"], archive_id + ".json", entry["archive_sha256"], ARCHIVE_CAP_BYTES)
    wrapper = _strict_file(raw, ARCHIVE_CAP_BYTES)
    if set(wrapper) != {"schema_version", "task_id", "completion_generation", "row_sha256", "row"}:
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_INVALID")
    row = wrapper["row"]
    if (wrapper["schema_version"] != ARCHIVE_VERSION or wrapper["task_id"] != entry["id"]
        or wrapper["completion_generation"] != entry["completion_generation"]
        or not isinstance(row, dict) or row.get("id") != entry["id"] or row.get("state") != "DONE"
        or _semantic_sha(row) != wrapper["row_sha256"]):
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_MISMATCH")
    if entry.get("completion_class") == "LEGACY_UNVERIFIED":
        expected_meta = {"completion_class": "LEGACY_UNVERIFIED"}
        if "completion_receipt_format" in row or "completion_candidate_sha" in row:
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_CLASS_MISMATCH")
    elif entry.get("completion_class") == "STRICT_V1":
        expected_meta = {"completion_class": "STRICT_V1"}
        if row.get("completion_receipt_format") != 1 or type(row.get("completion_receipt_format")) is not int:
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_CLASS_MISMATCH")
        expected_meta["completion_receipt_format"] = 1
        expected_meta["completion_candidate_sha"] = row.get("completion_candidate_sha")
    else:
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_CLASS_MISMATCH")
    for key in ("id", "role", "plan", "result", "requires", "completion_receipt"):
        if entry.get(key) != row.get(key):
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_METADATA_MISMATCH")
    if any(entry.get(key) != value for key, value in expected_meta.items()):
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_CLASS_MISMATCH")
    expected_id = _semantic_sha({"schema_version": ARCHIVE_VERSION, "task_id": entry["id"],
                                 "completion_generation": wrapper["completion_generation"],
                                 "archive_sha256": entry["archive_sha256"]})
    if expected_id != archive_id:
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_ID_MISMATCH")
    return row, int(entry["ordinal"]), len(raw)

def _generation_id(core: dict) -> str:
    return _semantic_sha({
        "schema_version": 1,
        "output_revision": core["revision"],
        "hot_core_sha256": _semantic_sha(core),
        "completed_root_hash": core["completed_root_hash"],
        "completed_count": core["completed_count"],
        "archive_history_root_hash": core["archive_history_root_hash"],
        "archive_history_count": core["archive_history_count"],
    })

def _hot_core(hot: dict) -> dict:
    return {key: hot[key] for key in ("version", "revision", "updated_at", "completed_root_hash",
                                      "completed_count", "archive_history_root_hash",
                                      "archive_history_count", "tasks")}

def _validate_hot(hot: dict) -> None:
    expected = {"version", "revision", "updated_at", "generation_id", "last_operation_id",
                "completed_root_hash", "completed_count", "archive_history_root_hash",
                "archive_history_count", "tasks"}
    if (not isinstance(hot, dict) or set(hot) != expected or hot.get("version") != VERSION
        or type(hot.get("revision")) is not int or hot["revision"] < 0
        or not isinstance(hot.get("updated_at"), str)
        or not HEX64.fullmatch(str(hot.get("generation_id")))
        or not HEX64.fullmatch(str(hot.get("last_operation_id")))
        or type(hot.get("completed_count")) is not int or not 0 <= hot["completed_count"] <= COMPLETED_CURRENT_CAP
        or type(hot.get("archive_history_count")) is not int or not 0 <= hot["archive_history_count"] <= ARCHIVE_GENERATION_CAP
        or not isinstance(hot.get("tasks"), list) or len(hot["tasks"]) > ACTIVE_TASK_CAP):
        raise RuntimeError("WORK_BOARD_V2_HOT_INVALID")
    for root_key, count_key in (("completed_root_hash", "completed_count"),
                                ("archive_history_root_hash", "archive_history_count")):
        root_sha = hot[root_key]
        if (root_sha is None) != (hot[count_key] == 0) or (root_sha is not None and not HEX64.fullmatch(str(root_sha))):
            raise RuntimeError("WORK_BOARD_V2_HOT_INVALID")
    ordinals, ids = set(), set()
    for task in hot["tasks"]:
        if not isinstance(task, dict) or task.get("state") not in ACTIVE_STATES:
            raise RuntimeError("WORK_BOARD_V2_ACTIVE_TASK_INVALID")
        ordinal, identifier = task.get("_ordinal"), task.get("id")
        if (type(ordinal) is not int or ordinal < 0 or not isinstance(identifier, str) or not identifier
            or ordinal in ordinals or identifier in ids):
            raise RuntimeError("WORK_BOARD_V2_ACTIVE_TASK_INVALID")
        ordinals.add(ordinal)
        ids.add(identifier)
    core = _hot_core(hot)
    if _generation_id(core) != hot["generation_id"]:
        raise RuntimeError("WORK_BOARD_V2_GENERATION_MISMATCH")

def storage_version(root: Path) -> int:
    path = Path(root) / "controllers/work-board.json"
    try:
        raw = _read_nofollow(path, HOT_CAP_BYTES)
    except FileNotFoundError:
        return 1
    try:
        value = _strict_object(raw)
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RuntimeError("WORK_BOARD_V2_HOT_INVALID") from error
    version = value.get("version")
    if type(version) is not int or version not in {1, VERSION}:
        raise RuntimeError("WORK_BOARD_V2_HOT_INVALID")
    return version

def _read_hot_once(root: Path, raw: bytes | None = None):
    path = Path(root) / "controllers/work-board.json"
    info = _regular_lstat(path)
    if info.st_nlink != 1:
        raise RuntimeError("WORK_BOARD_V2_STORAGE_HARDLINK")
    if raw is None:
        raw = _read_nofollow(path, HOT_CAP_BYTES)
    if not isinstance(raw, bytes) or len(raw) > HOT_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_HOT_INVALID")
    hot = _strict_file(raw, HOT_CAP_BYTES)
    _validate_hot(hot)
    return hot, raw

def _read_journal(root: Path, operation_id: str):
    if not HEX64.fullmatch(str(operation_id)):
        raise RuntimeError("WORK_BOARD_V2_OPERATION_ID_INVALID")
    paths = _paths(Path(root))
    filename = operation_id + ".json"
    raw = _read_immutable(paths["transactions"], filename, expected_sha=_sha(_read_nofollow(paths["transactions"] / filename, JOURNAL_CAP_BYTES)), limit=JOURNAL_CAP_BYTES)
    return _strict_file(raw, JOURNAL_CAP_BYTES)

def _validate_journal(tx: dict):
    required = {"schema_version", "operation_kind", "operation_id", "state",
                "input_generation_id", "input_revision", "input_hot_file_sha256",
                "output_generation_id", "output_revision", "hot_core_sha256",
                "completed_root_hash", "completed_count", "archive_history_root_hash",
                "archive_history_count", "final_hot_file_sha256", "event_core_sha256",
                "event", "event_file_sha256", "pre_event_size", "pre_event_exists"}
    if not isinstance(tx, dict) or tx.get("schema_version") != 1:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    expected_keys = required | ({"migration_id"} if tx.get("operation_kind") == "MIGRATION" else set())
    if set(tx) != expected_keys:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    if tx.get("operation_kind") not in {"QUEUE", "MIGRATION"} or tx.get("state") not in TX_STATES:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    if tx["operation_kind"] == "QUEUE" and "migration_id" in tx:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    if tx["operation_kind"] == "MIGRATION" and not HEX64.fullmatch(str(tx.get("migration_id", ""))):
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    for key in ("operation_id", "input_hot_file_sha256", "output_generation_id",
                "hot_core_sha256", "final_hot_file_sha256"):
        if not HEX64.fullmatch(str(tx.get(key, ""))):
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    if tx["input_generation_id"] is not None and not HEX64.fullmatch(str(tx["input_generation_id"])):
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    for key in ("input_revision", "output_revision", "completed_count", "archive_history_count"):
        if type(tx.get(key)) is not int or tx[key] < 0:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    if tx["operation_kind"] == "QUEUE":
        if (not isinstance(tx["event"], dict) or not HEX64.fullmatch(str(tx["event_core_sha256"]))
            or not HEX64.fullmatch(str(tx["event_file_sha256"]))
            or type(tx["pre_event_size"]) is not int or tx["pre_event_size"] < 0
            or type(tx["pre_event_exists"]) is not bool):
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
        event = tx["event"]
        if event.get("event_id") != "board-v2:" + tx["operation_id"]:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
        event_core = {k: v for k, v in event.items() if k != "event_id"}
        if _semantic_sha(event_core) != tx["event_core_sha256"] or _sha(_canonical_bytes(event)) != tx["event_file_sha256"]:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
        expected_id = _semantic_sha({
            "schema_version": 1, "input_generation_id": tx["input_generation_id"],
            "input_revision": tx["input_revision"], "output_generation_id": tx["output_generation_id"],
            "output_revision": tx["output_revision"], "action": event_core["action"],
            "role": event_core["role"], "task_id": event_core["task"],
            "event_core_sha256": tx["event_core_sha256"],
        })
        if expected_id != tx["operation_id"]:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    else:
        if any(tx[key] is not None for key in ("event_core_sha256", "event", "event_file_sha256", "pre_event_size", "pre_event_exists")):
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
        expected_id = _semantic_sha({
            "schema_version": 1, "operation_kind": "MIGRATION",
            "migration_id": tx.get("migration_id"),
            "input_hot_file_sha256": tx["input_hot_file_sha256"],
            "output_generation_id": tx["output_generation_id"],
            "output_revision": tx["output_revision"],
            "hot_core_sha256": tx["hot_core_sha256"],
        })
        if expected_id != tx["operation_id"]:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
    return tx

def _tx_scan(root: Path, *, create: bool = False):
    controllers = Path(root) / "controllers"
    directory = controllers / "work-board-v2-transactions"
    if create:
        _ensure_dir(directory)
    else:
        info = directory.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_DIRECTORY_INVALID")
    entries = list(directory.iterdir())
    journals = {}
    temps = {}
    total = 0
    for path in entries:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_DIRECTORY_INVALID")
        match = re.fullmatch(r"([0-9a-f]{64})\.json(\.tmp)?", path.name)
        if not match:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_DIRECTORY_INVALID")
        digest, temp = match.group(1), match.group(2)
        total += info.st_size
        if info.st_size > JOURNAL_CAP_BYTES:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_OVERSIZE")
        if temp:
            if digest in temps:
                raise RuntimeError("WORK_BOARD_V2_TRANSACTION_DIRECTORY_INVALID")
            temps[digest] = path
        else:
            if digest in journals:
                raise RuntimeError("WORK_BOARD_V2_TRANSACTION_DIRECTORY_INVALID")
            raw = _read_nofollow(path, JOURNAL_CAP_BYTES)
            tx = _strict_file(raw, JOURNAL_CAP_BYTES)
            _validate_journal(tx)
            if tx["operation_id"] != digest:
                raise RuntimeError("WORK_BOARD_V2_TRANSACTION_INVALID")
            journals[digest] = (path, raw, tx)
    if len(journals) > JOURNAL_COUNT_CAP or len(entries) > JOURNAL_ENTRY_CAP or total > JOURNAL_DIR_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_CAPACITY")
    return directory, journals, temps, total

def _write_journal(root: Path, tx: dict, *, initial: bool = False):
    _validate_journal(tx)
    paths = _paths(Path(root), create=True)
    directory, journals, temps, total = _tx_scan(Path(root), create=True)
    operation_id = tx["operation_id"]
    target = directory / (operation_id + ".json")
    temporary = directory / (operation_id + ".json.tmp")
    raw = _canonical_bytes(tx)
    if len(raw) > JOURNAL_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_OVERSIZE")
    if temporary.exists() or operation_id in temps:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_TEMP_EXISTS")
    if initial:
        if operation_id in journals or len(journals) + 1 > JOURNAL_COUNT_CAP or len(journals) + 2 > JOURNAL_ENTRY_CAP:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_CAPACITY")
        if total + len(raw) + JOURNAL_REWRITE_RESERVE_BYTES > JOURNAL_DIR_CAP_BYTES:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_CAPACITY")
    else:
        previous = journals.get(operation_id)
        if previous is None:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_MISSING")
        if len(journals) + 1 > JOURNAL_ENTRY_CAP or total + len(raw) > JOURNAL_DIR_CAP_BYTES:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_CAPACITY")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(temporary, flags, 0o600)
    try:
        view = memoryview(raw)
        while view:
            wrote = os.write(fd, view)
            if wrote <= 0:
                raise OSError("short write")
            view = view[wrote:]
        os.fsync(fd)
    finally:
        os.close(fd)
    os.replace(temporary, target)
    _fsync_dir(directory)
    if _read_nofollow(target, JOURNAL_CAP_BYTES) != raw:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_READBACK_FAILED")

def _clean_journal_temps(root: Path):
    directory, journals, temps, _total = _tx_scan(Path(root))
    if len(temps) > 1:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_TEMP_INVALID")
    for opid, path in temps.items():
        info = _regular_lstat(path)
        if info.st_nlink != 1:
            raise RuntimeError("WORK_BOARD_V2_TRANSACTION_TEMP_INVALID")
        if opid not in journals:
            try:
                hot_raw = _read_nofollow(Path(root) / "controllers/work-board.json", HOT_CAP_BYTES)
                hot = _strict_file(hot_raw, HOT_CAP_BYTES)
                if hot.get("last_operation_id") == opid:
                    raise RuntimeError("WORK_BOARD_V2_TRANSACTION_TEMP_INVALID")
            except FileNotFoundError:
                pass
        path.unlink()
        _fsync_dir(directory)
    return journals

def _check_event_log(root: Path, *, allow_torn_suffix: bool = False):
    path = Path(root) / "controllers/work-board-events.jsonl"
    info = _regular_lstat(path, missing_ok=True)
    if info is None:
        return b"", False
    if info.st_nlink != 1 or info.st_size > EVENT_LOG_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_CAPACITY")
    raw = _read_nofollow(path, EVENT_LOG_CAP_BYTES)
    torn = bool(raw and not raw.endswith(b"\n"))
    if torn and not allow_torn_suffix:
        raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_TORN")
    lines = raw.splitlines(keepends=True)
    if torn:
        lines = lines[:-1]
    for line in lines:
        if len(line) > EVENT_LINE_CAP_BYTES or not line.endswith(b"\n"):
            raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_INVALID")
        try:
            _strict_object(line[:-1])
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_INVALID") from error
    return raw, True

def _event_occurrences(raw: bytes, event_id: str):
    count = 0
    for line in raw.splitlines():
        if not line:
            continue
        try:
            value = _strict_object(line)
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_INVALID") from error
        if value.get("event_id") == event_id:
            count += 1
    return count

def _append_exact_event(root: Path, tx: dict):
    event_raw = _canonical_bytes(tx["event"])
    if _sha(event_raw) != tx["event_file_sha256"] or len(event_raw) > EVENT_LINE_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_EVENT_MISMATCH")
    path = Path(root) / "controllers/work-board-events.jsonl"
    raw, exists = _check_event_log(root, allow_torn_suffix=True)
    offset = tx["pre_event_size"]
    if len(raw) < offset:
        raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_MISMATCH")
    prefix, suffix = raw[:offset], raw[offset:]
    if len(prefix) != offset:
        raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_MISMATCH")
    if _event_occurrences(prefix, tx["event"]["event_id"]):
        raise RuntimeError("WORK_BOARD_V2_EVENT_DUPLICATE")
    if suffix == event_raw:
        return
    if suffix and not (len(suffix) < len(event_raw) and event_raw.startswith(suffix)):
        raise RuntimeError("WORK_BOARD_V2_EVENT_SUFFIX_MISMATCH")
    if suffix:
        flags = os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        try:
            os.ftruncate(fd, offset)
            os.fsync(fd)
        finally:
            os.close(fd)
        raw = raw[:offset]
    elif len(raw) != offset:
        raise RuntimeError("WORK_BOARD_V2_EVENT_SUFFIX_MISMATCH")
    if len(raw) + len(event_raw) > EVENT_LOG_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_CAPACITY")
    created = False
    if not exists:
        if offset != 0:
            raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_MISMATCH")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        created = True
    else:
        fd = os.open(path, os.O_WRONLY | os.O_APPEND | getattr(os, "O_NOFOLLOW", 0))
    try:
        view = memoryview(event_raw)
        while view:
            wrote = os.write(fd, view)
            if wrote <= 0:
                raise OSError("short write")
            view = view[wrote:]
        os.fsync(fd)
    finally:
        os.close(fd)
    if created:
        _fsync_dir(path.parent)
    after = _read_nofollow(path, EVENT_LOG_CAP_BYTES)
    if len(after) != offset + len(event_raw) or after[offset:] != event_raw:
        raise RuntimeError("WORK_BOARD_V2_EVENT_READBACK_FAILED")

def _transaction_for_operation(root: Path, operation_id: str):
    paths = _paths(Path(root))
    path = paths["transactions"] / (operation_id + ".json")
    raw = _read_nofollow(path, JOURNAL_CAP_BYTES)
    tx = _strict_file(raw, JOURNAL_CAP_BYTES)
    _validate_journal(tx)
    return tx

def _require_committed(root: Path, hot: dict, raw: bytes):
    if migration_pending(root):
        raise RuntimeError("WORK_QUEUE_RECOVERY_REQUIRED")
    tx = _transaction_for_operation(root, hot["last_operation_id"])
    if tx["state"] != "COMMITTED" or tx["final_hot_file_sha256"] != _sha(raw):
        raise RuntimeError("WORK_QUEUE_RECOVERY_REQUIRED")
    if tx["output_generation_id"] != hot["generation_id"] or tx["output_revision"] != hot["revision"]:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_OUTPUT_MISMATCH")

def _load_state(root: Path, hot_raw: bytes | None, *, require_committed: bool):
    paths = _paths(Path(root))
    hot, raw = _read_hot_once(Path(root), hot_raw)
    if require_committed:
        _require_committed(Path(root), hot, raw)
    current_entries = _read_trie(Path(root), hot["completed_root_hash"], hot["completed_count"], "completed")
    history_entries = _read_trie(Path(root), hot["archive_history_root_hash"], hot["archive_history_count"], "archive_history")
    history = {item["archive_entry_id"]: item for item in history_entries}
    if len(history) != len(history_entries):
        raise RuntimeError("WORK_BOARD_V2_ARCHIVE_HISTORY_DUPLICATE")
    completed = {}
    completed_rows = {}
    ordinals = {}
    used_ordinals = set()
    ids = set()
    for entry in current_entries:
        task_id = entry["id"]
        if task_id in ids or entry["ordinal"] in used_ordinals:
            raise RuntimeError("WORK_BOARD_V2_DUPLICATE_ID")
        ids.add(task_id)
        used_ordinals.add(entry["ordinal"])
        history_entry = history.get(entry["archive_entry_id"])
        if (history_entry is None or history_entry["task_id"] != task_id
            or history_entry["archive_sha256"] != entry["archive_sha256"]
            or history_entry["archive_size"] < 1
            or history_entry["completion_generation"] != entry["completion_generation"]):
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_HISTORY_MISMATCH")
        row, ordinal, archive_size = _read_archive(paths, entry)
        if ordinal != entry["ordinal"] or archive_size != history_entry["archive_size"]:
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_MISMATCH")
        completed[task_id] = entry
        completed_rows[task_id] = row
        ordinals[task_id] = ordinal
    rows = []
    for task in hot["tasks"]:
        clean = dict(task)
        ordinal = clean.pop("_ordinal")
        if clean["id"] in ids or ordinal in used_ordinals:
            raise RuntimeError("WORK_BOARD_V2_DUPLICATE_ID")
        ids.add(clean["id"])
        used_ordinals.add(ordinal)
        ordinals[clean["id"]] = ordinal
        rows.append((ordinal, clean))
    for task_id, row in completed_rows.items():
        rows.append((ordinals[task_id], row))
    rows.sort(key=lambda pair: pair[0])
    logical = {"version": VERSION, "revision": hot["revision"], "updated_at": hot["updated_at"],
               "tasks": [row for _ordinal, row in rows]}
    return {"paths": paths, "hot": hot, "hot_raw": raw, "hot_sha256": _sha(raw),
            "logical": logical, "ordinals": ordinals, "completed_entries": completed,
            "completed_rows": completed_rows, "archive_history": history}

def load_state(root: Path, hot_raw: bytes | None = None) -> dict:
    return _load_state(Path(root), hot_raw, require_committed=True)

def load_logical_board(root: Path, hot_raw: bytes | None = None) -> dict:
    return load_state(Path(root), hot_raw)["logical"]

def _snapshot_from_state(state: dict) -> dict:
    hot = state["hot"]
    descriptor = {"schema_version": 1, "final_hot_file_sha256": state["hot_sha256"],
                  "generation_id": hot["generation_id"], "completed_root_hash": hot["completed_root_hash"],
                  "completed_count": hot["completed_count"], "archive_history_root_hash": hot["archive_history_root_hash"],
                  "archive_history_count": hot["archive_history_count"]}
    return {"exists": True, "sha256": _semantic_sha(descriptor)}

def board_snapshot(root: Path, hot_raw: bytes | None = None) -> dict:
    return _snapshot_from_state(load_state(Path(root), hot_raw))

def _archive_existing(paths, entry):
    row, _ordinal, _size = _read_archive(paths, entry)
    wrapper = {"schema_version": ARCHIVE_VERSION, "task_id": row["id"],
               "completion_generation": entry["completion_generation"],
               "row_sha256": _semantic_sha(row), "row": row}
    raw = _canonical_bytes(wrapper)
    return raw

def _prepare_generation(root: Path, board: dict, previous_state: dict | None = None,
                        node_cap: int = NODE_CAP_BYTES):
    if not isinstance(board, dict) or board.get("version") != VERSION:
        raise RuntimeError("WORK_BOARD_V2_LOGICAL_VERSION_INVALID")
    revision, updated_at, tasks = board.get("revision"), board.get("updated_at"), board.get("tasks")
    if type(revision) is not int or revision < 0 or not isinstance(updated_at, str) or not isinstance(tasks, list):
        raise RuntimeError("WORK_BOARD_V2_LOGICAL_INVALID")
    previous_state = previous_state or {}
    old_ordinals = dict(previous_state.get("ordinals", {}))
    next_ordinal = max(old_ordinals.values(), default=-1) + 1
    old_current = dict(previous_state.get("completed_entries", {}))
    old_rows = dict(previous_state.get("completed_rows", {}))
    history = list(previous_state.get("archive_history", {}).values())
    max_gen = {}
    for item in history:
        max_gen[item["task_id"]] = max(max_gen.get(item["task_id"], 0), item["completion_generation"])
    drafts: dict[tuple[str, str], bytes] = {}
    assigned, active, current = {}, [], []
    seen_ids, seen_ordinals = set(), set()
    for incoming in tasks:
        if not isinstance(incoming, dict):
            raise RuntimeError("WORK_BOARD_V2_LOGICAL_INVALID")
        row = dict(incoming)
        row.pop("_ordinal", None)
        task_id = row.get("id")
        if not isinstance(task_id, str) or not task_id or task_id in seen_ids:
            raise RuntimeError("WORK_BOARD_V2_DUPLICATE_ID")
        seen_ids.add(task_id)
        ordinal = old_ordinals.get(task_id)
        if ordinal is None:
            ordinal = next_ordinal
            next_ordinal += 1
        if type(ordinal) is not int or ordinal < 0 or ordinal in seen_ordinals:
            raise RuntimeError("WORK_BOARD_V2_ORDINAL_INVALID")
        seen_ordinals.add(ordinal)
        assigned[task_id] = ordinal
        if row.get("state") in ACTIVE_STATES:
            row["_ordinal"] = ordinal
            active.append(row)
            continue
        if row.get("state") != "DONE":
            raise RuntimeError("WORK_BOARD_V2_LOGICAL_INVALID")
        prior = old_current.get(task_id)
        if prior and old_rows.get(task_id) == row and prior["ordinal"] == ordinal:
            current.append(prior)
            continue
        completion_history = row.get("completion_history", [])
        if not isinstance(completion_history, list):
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_ROW_INVALID")
        generation = max(max_gen.get(task_id, 0) + 1, len(completion_history) + 1, 1)
        if generation > ARCHIVE_GENERATION_CAP:
            raise RuntimeError("WORK_BOARD_V2_ARCHIVE_GENERATION_CAPACITY")
        current_entry, history_entry = _make_archive(Path(root), row, ordinal, generation, drafts)
        current.append(current_entry)
        history.append(history_entry)
        max_gen[task_id] = generation
    if len(active) > ACTIVE_TASK_CAP:
        raise RuntimeError("WORK_QUEUE_INVALID: task count")
    if len(current) > COMPLETED_CURRENT_CAP or len(history) > ARCHIVE_GENERATION_CAP:
        raise RuntimeError("WORK_BOARD_V2_COMPLETED_CAPACITY")
    for entry in history:
        _validate_leaf_entry(entry, "archive_history", "")
    completed_root, completed_count, current_drafts = _trie_drafts(current, "completed", node_cap)
    history_root, history_count, history_drafts = _trie_drafts(history, "archive_history", node_cap)
    drafts.update(current_drafts)
    drafts.update(history_drafts)
    active.sort(key=lambda row: row["_ordinal"])
    core = {
        "version": VERSION,
        "revision": revision,
        "updated_at": updated_at,
        "completed_root_hash": completed_root,
        "completed_count": completed_count,
        "archive_history_root_hash": history_root,
        "archive_history_count": history_count,
        "tasks": active,
    }
    return {"core": core, "drafts": drafts, "ordinals": assigned,
            "completed_entries": {item["id"]: item for item in current},
            "archive_history": {item["archive_entry_id"]: item for item in history}}

def build_generation_from_v1(root: Path, board: dict, node_cap: int = NODE_CAP_BYTES):
    if not isinstance(board, dict) or board.get("version") != 1 or not isinstance(board.get("tasks"), list):
        raise RuntimeError("WORK_BOARD_V2_MIGRATION_INPUT_INVALID")
    migrated = {"version": VERSION, "revision": board.get("revision"),
                "updated_at": board.get("updated_at", ""), "tasks": [dict(row) for row in board["tasks"]]}
    return _prepare_generation(Path(root), migrated, {}, node_cap=node_cap)

def _journal_text(tx: dict) -> bytes:
    _validate_journal(tx)
    raw = _canonical_bytes(tx)
    if len(raw) > JOURNAL_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_OVERSIZE")
    return raw

def _event_preflight(root: Path, event: dict):
    raw, exists = _check_event_log(root)
    if len(raw) > EVENT_LOG_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_CAPACITY")
    if _event_occurrences(raw, event["event_id"]):
        raise RuntimeError("WORK_BOARD_V2_EVENT_DUPLICATE")
    line = _canonical_bytes(event)
    if len(line) > EVENT_LINE_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_EVENT_LINE_CAPACITY")
    if len(raw) + len(line) > EVENT_LOG_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_EVENT_LOG_CAPACITY")
    return len(raw), exists, line

def _build_queue_tx(previous, generated, event_input):
    event_core = dict(event_input)
    event_core.pop("event_id", None)
    event_core.pop("generation_id", None)
    event_core.pop("operation_id", None)
    event_core["action"] = event_core.get("action") or "ADVANCE"
    event_core["generation_id"] = _generation_id(generated["core"])
    event_core_sha = _semantic_sha(event_core)
    action = event_core.get("action")
    role = event_core.get("role")
    task_id = event_core.get("task")
    if not all(isinstance(x, str) and x for x in (action, role, task_id)):
        raise RuntimeError("WORK_BOARD_V2_EVENT_INVALID")
    operation_id = _semantic_sha({
        "schema_version": 1, "input_generation_id": previous["hot"]["generation_id"],
        "input_revision": previous["logical"]["revision"],
        "output_generation_id": _generation_id(generated["core"]),
        "output_revision": generated["core"]["revision"], "action": action, "role": role,
        "task_id": task_id, "event_core_sha256": event_core_sha,
    })
    event = dict(event_core, event_id="board-v2:" + operation_id)
    event_raw = _canonical_bytes(event)
    event_offset, event_exists, _line = _event_preflight_root_placeholder(event, event_raw)
    hot = dict(generated["core"], generation_id=_generation_id(generated["core"]), last_operation_id=operation_id)
    hot_raw = _canonical_bytes(hot)
    if len(hot_raw) > HOT_CAP_BYTES:
        raise RuntimeError("WORK_QUEUE_INVALID: size")
    tx = {
        "schema_version": 1, "operation_kind": "QUEUE", "operation_id": operation_id,
        "state": "PREPARED", "input_generation_id": previous["hot"]["generation_id"],
        "input_revision": previous["logical"]["revision"], "input_hot_file_sha256": previous["hot_sha256"],
        "output_generation_id": hot["generation_id"], "output_revision": hot["revision"],
        "hot_core_sha256": _semantic_sha(generated["core"]),
        "completed_root_hash": hot["completed_root_hash"], "completed_count": hot["completed_count"],
        "archive_history_root_hash": hot["archive_history_root_hash"],
        "archive_history_count": hot["archive_history_count"],
        "final_hot_file_sha256": _sha(hot_raw), "event_core_sha256": event_core_sha,
        "event": event, "event_file_sha256": _sha(event_raw),
        "pre_event_size": event_offset, "pre_event_exists": event_exists,
    }
    return hot, hot_raw, tx

def _event_preflight_root_placeholder(event: dict, event_raw: bytes):
    # Offset/existence are replaced by commit_logical_board under the queue lock.
    return 0, False, event_raw

def _preflight_drafts(root: Path, generated: dict):
    _check_done_capacity(Path(root), generated["drafts"])

def _recover_event(root: Path, tx: dict):
    _append_exact_event(Path(root), tx)

def recover_queue_transaction(root: Path):
    root = Path(root)
    paths = _paths(root)
    if migration_pending(root):
        raise RuntimeError("WORK_BOARD_V2_MIGRATION_RECOVERY_REQUIRED")
    journals = _clean_journal_temps(root)
    nonterminal = [item[2] for item in journals.values() if item[2]["state"] not in {"COMMITTED", "ROLLED_BACK"}]
    if len(nonterminal) > 1:
        raise RuntimeError("WORK_QUEUE_RECOVERY_REQUIRED")
    if not nonterminal:
        return None
    tx = nonterminal[0]
    current_raw = _read_nofollow(paths["hot"], HOT_CAP_BYTES)
    current_sha = _sha(current_raw)
    if current_sha == tx["input_hot_file_sha256"]:
        if tx["operation_kind"] == "QUEUE":
            raw, _exists = _check_event_log(root)
            if len(raw) != tx["pre_event_size"] or _event_occurrences(raw, tx["event"]["event_id"]):
                raise RuntimeError("WORK_BOARD_V2_RECOVERY_MIXED_STATE")
        tx["state"] = "ROLLED_BACK"
        _write_journal(root, tx)
        return tx
    if current_sha != tx["final_hot_file_sha256"]:
        raise RuntimeError("WORK_QUEUE_RECOVERY_REQUIRED")
    _load_state(root, current_raw, require_committed=False)
    if tx["operation_kind"] == "QUEUE":
        _recover_event(root, tx)
    tx["state"] = "COMMITTED"
    _write_journal(root, tx)
    return tx

def _write_drafts_for_generation(root: Path, generated: dict):
    _preflight_drafts(root, generated)
    _write_drafts(root, generated["drafts"])
    _check_done_capacity(Path(root))

def commit_logical_board(root: Path, board: dict, event: dict):
    root = Path(root)
    recover_queue_transaction(root)
    previous = load_state(root)
    if board.get("revision") != previous["logical"]["revision"] + 1:
        raise RuntimeError("WORK_BOARD_V2_REVISION_MISMATCH")
    generated = _prepare_generation(root, board, previous)
    _preflight_drafts(root, generated)
    event_core = dict(event)
    event_core.pop("event_id", None)
    event_core.pop("generation_id", None)
    event_core.pop("operation_id", None)
    event_core["action"] = event_core.get("action") or "ADVANCE"
    # Build operation and hot before journal, then preflight event and exact journal.
    hot_core = generated["core"]
    event_core["generation_id"] = _generation_id(hot_core)
    event_core_sha = _semantic_sha(event_core)
    action, role, task_id = event_core.get("action"), event_core.get("role"), event_core.get("task")
    if not all(isinstance(x, str) and x for x in (action, role, task_id)):
        raise RuntimeError("WORK_BOARD_V2_EVENT_INVALID")
    output_generation = _generation_id(hot_core)
    operation_id = _semantic_sha({
        "schema_version": 1, "input_generation_id": previous["hot"]["generation_id"],
        "input_revision": previous["logical"]["revision"], "output_generation_id": output_generation,
        "output_revision": board["revision"], "action": action, "role": role, "task_id": task_id,
        "event_core_sha256": event_core_sha,
    })
    final_event = dict(event_core, event_id="board-v2:" + operation_id)
    event_raw = _canonical_bytes(final_event)
    pre_event_size, pre_event_exists, _ = _event_preflight(root, final_event)
    hot = dict(hot_core, generation_id=output_generation, last_operation_id=operation_id)
    hot_raw = _canonical_bytes(hot)
    if len(hot_raw) > HOT_CAP_BYTES:
        raise RuntimeError("WORK_QUEUE_INVALID: size")
    tx = {
        "schema_version": 1, "operation_kind": "QUEUE", "operation_id": operation_id,
        "state": "PREPARED", "input_generation_id": previous["hot"]["generation_id"],
        "input_revision": previous["logical"]["revision"], "input_hot_file_sha256": previous["hot_sha256"],
        "output_generation_id": output_generation, "output_revision": board["revision"],
        "hot_core_sha256": _semantic_sha(hot_core), "completed_root_hash": hot["completed_root_hash"],
        "completed_count": hot["completed_count"], "archive_history_root_hash": hot["archive_history_root_hash"],
        "archive_history_count": hot["archive_history_count"], "final_hot_file_sha256": _sha(hot_raw),
        "event_core_sha256": event_core_sha, "event": final_event, "event_file_sha256": _sha(event_raw),
        "pre_event_size": pre_event_size, "pre_event_exists": pre_event_exists,
    }
    tx_raw = _journal_text(tx)
    directory, journals, temps, total = _tx_scan(root, create=True)
    if temps:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_TEMP_EXISTS")
    if operation_id in journals or len(journals) + 1 > JOURNAL_COUNT_CAP or len(journals) + 2 > JOURNAL_ENTRY_CAP:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_CAPACITY")
    if total + len(tx_raw) + JOURNAL_REWRITE_RESERVE_BYTES > JOURNAL_DIR_CAP_BYTES:
        raise RuntimeError("WORK_BOARD_V2_TRANSACTION_CAPACITY")
    # Event, done-tree, hot and transaction caps are all checked before PREPARED.
    _write_journal(root, tx, initial=True)
    _fault("after_prepared")
    _write_drafts_for_generation(root, generated)
    tx["state"] = "DATA_DURABLE"
    _write_journal(root, tx)
    _fault("after_data_durable")
    _atomic_write(previous["paths"]["hot"], hot_raw)
    if _read_nofollow(previous["paths"]["hot"], HOT_CAP_BYTES) != hot_raw:
        raise RuntimeError("WORK_BOARD_V2_HOT_READBACK_FAILED")
    _fault("after_hot_replace_before_hot_published")
    tx["state"] = "HOT_PUBLISHED"
    _write_journal(root, tx)
    _fault("after_hot_published")
    _load_state(root, hot_raw, require_committed=False)
    _append_exact_event(root, tx)
    _fault("after_event_append_before_event_durable")
    tx["state"] = "EVENT_DURABLE"
    _write_journal(root, tx)
    _fault("after_event_durable_before_commit")
    tx["state"] = "COMMITTED"
    _write_journal(root, tx)
    return final_event

def migration_pending(root: Path) -> bool:
    path = Path(root) / "controllers/work-board-v2-migration.json"
    try:
        raw = _read_nofollow(path, JOURNAL_CAP_BYTES)
    except FileNotFoundError:
        return False
    value = _strict_file(raw, JOURNAL_CAP_BYTES)
    if (value.get("schema_version") != 1 or value.get("state") not in
        {"PREPARED", "SWITCHING", "COMMITTED", "ROLLED_BACK"}):
        raise RuntimeError("WORK_BOARD_V2_MIGRATION_JOURNAL_INVALID")
    return value["state"] in {"PREPARED", "SWITCHING"}

def install_hot_generation(root: Path, raw: bytes) -> None:
    """Internal migration helper: validate exact canonical hot bytes before replace."""
    hot, canonical = _read_hot_once(Path(root), raw)
    if canonical != raw:
        raise RuntimeError("WORK_BOARD_V2_HOT_INVALID")
    _atomic_write(Path(root) / "controllers/work-board.json", raw)

def exact_hot_bytes(root: Path) -> bytes:
    return _read_nofollow(Path(root) / "controllers/work-board.json", HOT_CAP_BYTES)

def prepare_migration_generation(root: Path, board: dict):
    """Return immutable sidecar drafts and generation core for a pinned v1 board."""
    migrated = {"version": VERSION, "revision": board["revision"],
                "updated_at": board.get("updated_at", ""), "tasks": [dict(row) for row in board["tasks"]]}
    return _prepare_generation(Path(root), migrated, None)

def _make_migration_tx(input_sha: str, input_revision: int, hot: dict, raw: bytes,
                       migration_id: str, pre_event_size: int = 0):
    core = _hot_core(hot)
    core_sha = _semantic_sha(core)
    opid = _semantic_sha({"schema_version": 1, "operation_kind": "MIGRATION",
                          "migration_id": migration_id, "input_hot_file_sha256": input_sha,
                          "output_generation_id": hot["generation_id"],
                          "output_revision": hot["revision"], "hot_core_sha256": core_sha})
    hot["last_operation_id"] = opid
    raw = _canonical_bytes(hot)
    return opid, raw, {
        "schema_version": 1, "operation_kind": "MIGRATION", "operation_id": opid,
        "migration_id": migration_id, "state": "PREPARED", "input_generation_id": None,
        "input_revision": input_revision, "input_hot_file_sha256": input_sha,
        "output_generation_id": hot["generation_id"], "output_revision": hot["revision"],
        "hot_core_sha256": core_sha, "completed_root_hash": hot["completed_root_hash"],
        "completed_count": hot["completed_count"], "archive_history_root_hash": hot["archive_history_root_hash"],
        "archive_history_count": hot["archive_history_count"], "final_hot_file_sha256": _sha(raw),
        "event_core_sha256": None, "event": None, "event_file_sha256": None,
        "pre_event_size": None, "pre_event_exists": None,
    }

def validate_hot_candidate(root: Path, raw: bytes):
    """Validate a non-published v2 candidate using the same sidecar readers."""
    return _load_state(Path(root), raw, require_committed=False)

def _read_migration_record(root: Path):
    path = Path(root) / "controllers/work-board-v2-migration.json"
    try:
        return _strict_file(_read_nofollow(path, JOURNAL_CAP_BYTES), JOURNAL_CAP_BYTES)
    except FileNotFoundError:
        return None

def recover_migration(root: Path):
    """Fail-closed recovery of an interrupted migration to its exact v1 archive."""
    root = Path(root)
    paths = _paths(root)
    migration = _read_migration_record(root)
    if not migration or migration.get("state") not in {"PREPARED", "SWITCHING"}:
        return migration
    pre_sha = migration.get("pre_v1_sha256")
    if not HEX64.fullmatch(str(pre_sha)):
        raise RuntimeError("WORK_BOARD_V2_MIGRATION_JOURNAL_INVALID")
    archive_path = _file_content_path(paths["migrations"], pre_sha + ".json")
    info = _regular_lstat(archive_path)
    if info.st_nlink != 1:
        raise RuntimeError("WORK_BOARD_V2_STORAGE_HARDLINK")
    archive = _read_nofollow(archive_path, HOT_CAP_BYTES)
    if _sha(archive) != pre_sha:
        raise RuntimeError("WORK_BOARD_V2_V1_ARCHIVE_HASH_MISMATCH")
    _atomic_write(paths["hot"], archive)
    operation_id = migration.get("operation_id")
    if isinstance(operation_id, str) and HEX64.fullmatch(operation_id):
        tx_path = paths["transactions"] / (operation_id + ".json")
        if os.path.lexists(tx_path):
            tx = _strict_file(_read_nofollow(tx_path, JOURNAL_CAP_BYTES), JOURNAL_CAP_BYTES)
            if tx["state"] not in {"COMMITTED", "ROLLED_BACK"}:
                tx["state"] = "ROLLED_BACK"
                _write_journal(root, tx)
    if _read_nofollow(paths["hot"], HOT_CAP_BYTES) != archive:
        raise RuntimeError("WORK_BOARD_V2_V1_RESTORE_FAILED")
    migration["state"] = "ROLLED_BACK"
    migration["rollback"] = {"exact_v1_restored": True}
    _atomic_write(Path(root) / "controllers/work-board-v2-migration.json", _canonical_bytes(migration))
    return migration
