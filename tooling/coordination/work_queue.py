"""Shared outcome queue; receipt v2 never grants deployment/live authority.

DONE requires an exact task/candidate/check contract, immutable byte digests and
an independent acceptance registered by a trusted runtime review verifier. The
verifier is injected trusted code, not a receipt field or CLI reviewer name. It
must authenticate its peer job/lease and collect actual evidence independently.
This is an operational guard on a shared root filesystem, not an OS sandbox
against malicious root/Python callers. SOURCE and live boundaries never imply
each other. Old DONE rows remain UNVERIFIED until explicitly revalidated.
"""
from contextlib import contextmanager
from copy import deepcopy
import fcntl
import fnmatch
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

STATES = {"READY", "IN_PROGRESS", "BLOCKED", "DONE", "UNVERIFIED"}
LEVELS = {"SOURCE", "PACKAGE", "INSTALLED_SYNTHETIC", "INSTALLED_LOCAL",
          "LIVE_OWNER", "LIVE", "DEPLOYMENT", "PRODUCTION"}
MAX_BYTES = 262144
MAX_ARCHIVE_BYTES = 1048576


def _digest(raw):
    return hashlib.sha256(raw).hexdigest()


def _scoped_bytes(root, filename):
    try:
        path = Path(filename).resolve(strict=True)
        relative = path.relative_to(Path(root).resolve())
        if relative.parts[0] not in {"logs", "controllers", "artifacts"} or not path.is_file():
            raise ValueError()
        with path.open("rb") as source:
            raw = source.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise ValueError()
        return path, raw
    except (OSError, ValueError, TypeError, IndexError, RuntimeError):
        raise RuntimeError("WORK_QUEUE_RECEIPT_REQUIRED: bounded file inside control") from None


def _json(raw):
    # Ambiguous duplicate keys must not change the meaning seen by a verifier.
    def unique(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def _candidate(candidate):
    if not isinstance(candidate, dict) or any(
        not isinstance(candidate.get(key), str) or not re.fullmatch(pattern, candidate[key])
        for key, pattern in (("sha", r"[a-f0-9]{40}"), ("tree", r"[a-f0-9]{40}"),
                             ("diff_sha256", r"[a-f0-9]{64}"))
    ) or ("artifact_sha256" in candidate and not re.fullmatch(r"[a-f0-9]{64}", str(candidate["artifact_sha256"]))):
        raise RuntimeError("WORK_QUEUE_CANDIDATE_INVALID")


def _contract(task):
    fields = ("id", "role", "plan", "result", "requires", "paths", "acceptance",
              "boundary", "required_checks", "candidate", "author", "proof_validity")
    data = {key: task.get(key) for key in fields}
    data["proof_generation"] = task.get("proof_generation", 0)
    return _digest(json.dumps(data, sort_keys=True, separators=(",", ":")).encode())


def _epoch(root):
    try:
        _, raw = _scoped_bytes(root, Path(root) / "controllers/runtime-mode.json")
        marker = _json(raw)
        if marker["mode"] != "continuous-runtime" or not isinstance(marker["epoch"], str) or not marker["epoch"]:
            raise ValueError()
        return marker["epoch"]
    except (RuntimeError, ValueError, KeyError, TypeError):
        raise RuntimeError("WORK_QUEUE_ACCEPTANCE_AUTHORITY_UNAVAILABLE") from None


def _time(value):
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        raise ValueError("timezone required")
    return parsed


def _receipt(root, task, filename, dependencies, *, trusted=True, now=None):
    """Validate bytes and bindings; only a trusted verifier establishes truth.

    Explicit SNAPSHOT policy allows expires_at=null; it binds named immutable
    input hashes, including environment_sha256 for a non-source assertion.
    CURRENT_STATE requires a concrete expiry. The claim's validity policy is
    declared on the task before work, not inferred from an evidence level.
    Epoch is still fenced: restart keeps the epoch, while rollout requires an
    explicit trusted rebind of preserved immutable evidence, never a stale
    writer replay or an unnecessary rerun of unchanged tests.
    """
    path, raw = _scoped_bytes(root, filename)
    digest = _digest(raw)
    try:
        receipt = _json(raw)
        _candidate(task.get("candidate"))
        checks = task.get("required_checks")
        if (task.get("boundary") not in LEVELS or not isinstance(checks, list)
                or not checks or len(set(checks)) != len(checks)
                or not all(isinstance(x, str) and x.strip() for x in checks)
                or not isinstance(task.get("author"), str) or not task["author"].strip()):
            raise ValueError("explicit candidate/boundary/check contract required")
        if task["boundary"] != "SOURCE" and "artifact_sha256" not in task["candidate"]:
            raise ValueError("non-source artifact digest required")
        validity = task.get("proof_validity")
        if not isinstance(validity, dict) or validity.get("kind") not in {"SNAPSHOT", "CURRENT_STATE"}:
            raise ValueError("explicit proof validity policy required")
        if validity["kind"] == "SNAPSHOT":
            inputs = validity.get("input_hashes")
            if (not isinstance(inputs, dict) or not inputs
                    or any(not isinstance(key, str) or not key.strip() or not isinstance(value, str)
                           or not re.fullmatch(r"[a-f0-9]{64}", value) for key, value in inputs.items())
                    or (task["boundary"] != "SOURCE" and "environment_sha256" not in inputs)):
                raise ValueError("snapshot input/environment hashes required")
        expected = {"version": 2, "task_id": task["id"], "candidate": task["candidate"],
                    "author": task["author"], "generation": task.get("proof_generation", 0),
                    "result": "PASS", "level": task["boundary"], "epoch": _epoch(root),
                    "dependencies": dependencies, "proof_validity": validity}
        if (type(receipt.get("generation")) is not int
                or any(receipt.get(key) != value for key, value in expected.items())):
            raise ValueError("task/candidate/result/level/generation/epoch/dependencies")
        now = now or datetime.now(timezone.utc)
        if _time(receipt["issued_at"]) > now:
            raise ValueError("future proof")
        expiry = receipt["expires_at"]
        if expiry is None:
            if validity["kind"] != "SNAPSHOT":
                raise ValueError("current-state evidence requires explicit expiry")
        elif not now < _time(expiry):
            raise ValueError("expired proof")
        review = receipt["review"]
        if (review["result"] != "ACCEPT" or review["candidate"] != task["candidate"]
                or not isinstance(review["reviewer"], str) or not review["reviewer"].strip()
                or review["reviewer"] == task["author"]):
            raise ValueError("independent exact-candidate review required")
        evidence = receipt["checks"]
        if not isinstance(evidence, list) or len(evidence) != len(checks):
            raise ValueError("complete checks required")
        if sorted(item["id"] for item in evidence) != sorted(checks):
            raise ValueError("check IDs differ")
        for item in evidence:
            if (item["result"] != "PASS" or item["candidate"] != task["candidate"]
                    or item["level"] != task["boundary"]):
                raise ValueError("failed/stale/wrong-level check")
            _, evidence_raw = _scoped_bytes(root, item["evidence_path"])
            if item["evidence_sha256"] != _digest(evidence_raw):
                raise ValueError("check evidence changed")
        if trusted:
            _, index_raw = _scoped_bytes(root, Path(root) / "controllers/work-acceptances.json")
            index = _json(index_raw)
            record = index["acceptances"][digest]
            if (index["version"] != 1 or record.get("revoked") is not False
                    or record.get("task_id") != task["id"]
                    or record.get("contract_sha256") != _contract(task)
                    or record.get("receipt_sha256") != digest
                    or record.get("epoch") != receipt["epoch"]
                    or record.get("reviewer") != review["reviewer"]
                    or record.get("candidate") != task["candidate"]
                    or record.get("level") != task["boundary"]
                    or record.get("proof_validity") != validity
                    or record.get("result") != "ACCEPT" or not record.get("review_job_id")):
                raise ValueError("trusted acceptance missing/revoked/stale")
        return {"path": str(path), "sha256": digest, "contract_sha256": _contract(task),
                "payload": receipt}
    except (ValueError, KeyError, TypeError, AttributeError, OverflowError, RuntimeError) as error:
        raise RuntimeError("WORK_QUEUE_RECEIPT_INVALID: " + str(error)) from None


def validate_board(root, candidate=None, now=None):
    """Read-only effective view. Never unlock a dependency from raw DONE text."""
    board = deepcopy(load_board(root, candidate))
    by_id = {task["id"]: task for task in board["tasks"]}
    visited, invalidated = set(), []

    def visit(task):
        if task["id"] in visited:
            return
        for identifier in task["requires"]:
            visit(by_id[identifier])
        visited.add(task["id"])
        if task["state"] != "DONE":
            return
        try:
            if any(by_id[x]["state"] != "DONE" for x in task["requires"]):
                raise RuntimeError("dependency no longer verified")
            dependencies = {x: by_id[x]["completion_receipt_sha256"] for x in task["requires"]}
            if not task.get("completion_receipt_sha256") or not task.get("completion_contract_sha256"):
                raise RuntimeError("legacy DONE requires explicit migration/review")
            proof = _receipt(root, task, task.get("completion_receipt"), dependencies, now=now)
            if (proof["sha256"] != task["completion_receipt_sha256"]
                    or proof["contract_sha256"] != task["completion_contract_sha256"]):
                raise RuntimeError("immutable completion binding changed")
        except RuntimeError as error:
            task.update(state="UNVERIFIED", verification_error=str(error))
            invalidated.append({"id": task["id"], "reason": str(error)})

    for task in board["tasks"]:
        visit(task)
    return {"board": board, "invalidated": invalidated,
            "migration_required": board["version"] == 1 or bool(invalidated)}


@contextmanager
def _locked_board(root, role):
    root = Path(root)
    if role not in {"A", "B", "C"}:
        raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
    with (root / (role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        if json.loads((root / (role + ".json")).read_text()).get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no queue transition permitted")
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            yield load_board(root)


def _write_board(root, board, event):
    root = Path(root)
    now = datetime.now(timezone.utc).isoformat()
    board["revision"] += 1
    board["updated_at"] = now
    encoded = json.dumps(board, ensure_ascii=False, indent=2) + "\n"
    if len(encoded.encode()) > MAX_BYTES:
        raise RuntimeError("WORK_QUEUE_INVALID: size")
    path = root / "controllers/work-board.json"
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w") as output:
        output.write(encoded)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    event.update(at=now, revision=board["revision"])
    with (root / "controllers/work-board-events.jsonl").open("a") as output:
        output.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def bind_candidate(root, role, identifier, candidate, author):
    """Supervisor pins actual committed candidate; never converts evidence levels."""
    _candidate(candidate)
    if not isinstance(author, str) or not author.strip():
        raise RuntimeError("WORK_QUEUE_AUTHOR_REQUIRED")
    with _locked_board(root, role) as board:
        task = next((t for t in board["tasks"] if t["id"] == identifier), None)
        if task is None or task["role"] != role or task["state"] == "DONE":
            raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
        if task.get("candidate") != candidate or task.get("author") != author:
            task["proof_generation"] = task.get("proof_generation", 0) + 1
        task.update(candidate=deepcopy(candidate), author=author)
        return _write_board(root, board, {"role": role, "task": identifier, "action": "BIND_CANDIDATE"})


def register_acceptance(root, identifier, receipt, *, review_verifier=None):
    """Trusted adapter hook; never expose review_verifier as caller JSON/text.

    verifier(task, payload, digest) must read its independently recorded peer
    execution, reject author/reviewer job reuse, verify exact SHA/tree/diff,
    evidence and configured epoch, and return the accepted binding. No shell,
    process execution, or unbounded network work belongs inside this short lock.
    """
    if not callable(review_verifier):
        raise RuntimeError("WORK_QUEUE_TRUSTED_REVIEW_VERIFIER_REQUIRED")
    initial = load_board(root)
    owner = next((t["role"] for t in initial["tasks"] if t["id"] == identifier), None)
    with _locked_board(root, owner) as board:
        task = next((t for t in board["tasks"] if t["id"] == identifier), None)
        if task is None or task["role"] != owner or task["state"] == "DONE":
            raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
        verified = validate_board(root, candidate=board)["board"]
        by_id = {t["id"]: t for t in verified["tasks"]}
        if any(by_id[x]["state"] != "DONE" for x in task["requires"]):
            raise RuntimeError("WORK_QUEUE_DEPENDENCY_PENDING")
        dependencies = {x: by_id[x]["completion_receipt_sha256"] for x in task["requires"]}
        proof = _receipt(root, task, receipt, dependencies, trusted=False)
        claim = review_verifier(deepcopy(task), deepcopy(proof["payload"]), proof["sha256"])
        expected = {"reviewer": proof["payload"]["review"]["reviewer"], "result": "ACCEPT",
                    "candidate": task["candidate"], "level": task["boundary"], "epoch": _epoch(root),
                    "proof_validity": task["proof_validity"]}
        if (not isinstance(claim, dict) or any(claim.get(k) != v for k, v in expected.items())
                or not isinstance(claim.get("review_job_id"), str) or not claim["review_job_id"].strip()):
            raise RuntimeError("WORK_QUEUE_TRUSTED_REVIEW_REJECTED")
        # Bind the bytes read before the verifier; a replacement cannot gain its acceptance.
        if _digest(_scoped_bytes(root, receipt)[1]) != proof["sha256"]:
            raise RuntimeError("WORK_QUEUE_RECEIPT_CHANGED")
        path = Path(root) / "controllers/work-acceptances.json"
        try:
            index = _json(_scoped_bytes(root, path)[1]) if path.exists() else {"version": 1, "acceptances": {}}
            if index["version"] != 1 or not isinstance(index["acceptances"], dict):
                raise ValueError()
        except (ValueError, KeyError, TypeError):
            raise RuntimeError("WORK_QUEUE_ACCEPTANCE_INDEX_INVALID") from None
        record = dict(expected, review_job_id=claim["review_job_id"], task_id=identifier,
                      receipt_sha256=proof["sha256"], contract_sha256=proof["contract_sha256"], revoked=False)
        if proof["sha256"] in index["acceptances"] and index["acceptances"][proof["sha256"]] != record:
            raise RuntimeError("WORK_QUEUE_ACCEPTANCE_IMMUTABLE")
        index["acceptances"][proof["sha256"]] = record
        encoded = json.dumps(index, sort_keys=True, indent=2) + "\n"
        if len(encoded.encode()) > MAX_BYTES:
            raise RuntimeError("WORK_QUEUE_ACCEPTANCE_INDEX_INVALID: size")
        temporary = path.with_name(path.name + ".tmp")
        temporary.write_text(encoded)
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
        return record


def revalidate_done(root, role):
    """Explicit migration/revalidation; historical receipts are retained, never promoted."""
    with _locked_board(root, role) as board:
        effective = validate_board(root, candidate=board)
        invalid = {t["id"]: t for t in effective["board"]["tasks"]
                   if t["role"] == role and t["state"] == "UNVERIFIED"}
        changed = []
        for task in board["tasks"]:
            if task["id"] in invalid and task["state"] == "DONE":
                task.update(state="UNVERIFIED", verification_error=invalid[task["id"]]["verification_error"])
                changed.append(task["id"])
        board["version"] = 2
        return _write_board(root, board, {"role": role, "action": "REVALIDATE_DONE", "invalidated": changed})


def _archive_directory(root, identifier):
    return Path(root) / "controllers/work-board-archive" / _digest(identifier.encode())


def _read_archive(path):
    try:
        with Path(path).open("rb") as source:
            raw = source.read(MAX_ARCHIVE_BYTES + 1)
        if len(raw) > MAX_ARCHIVE_BYTES:
            raise ValueError("size")
        result = _json(raw)
        if not isinstance(result, dict):
            raise ValueError("shape")
        return result
    except (OSError, ValueError, TypeError):
        raise RuntimeError("WORK_QUEUE_ARCHIVE_INVALID") from None


def _archive_reference(path, snapshot):
    task = snapshot["task"]
    return {"id": task["id"], "role": task["role"], "plan": task["plan"],
            "result": task["result"], "boundary": task["boundary"],
            "candidate": task["candidate"], "receipt_sha256": snapshot["proof"]["sha256"],
            "archive_path": str(path), "authority_id": snapshot["final_acceptance"]["authority_id"]}


def archived_task(root, identifier):
    """Canonical immutable result reference for planner/recovery, never live authority.

    A crash may leave an archive prepared while its task is still active. Such
    a snapshot is not reported as completed archival. Archive references are
    also recorded in the existing work-board-events log for incremental readers.
    """
    if any(t["id"] == identifier for t in load_board(root)["tasks"]):
        return None
    directory = _archive_directory(root, identifier)
    if not directory.exists():
        return None
    snapshots = []
    for number, path in enumerate(directory.iterdir()):
        if number >= 100:
            raise RuntimeError("WORK_QUEUE_ARCHIVE_INVALID: too many versions for task")
        if path.suffix != ".json":
            continue
        snapshot = _read_archive(path)
        if (snapshot.get("version") != 1 or snapshot["task"]["id"] != identifier
                or path.stem != snapshot["proof"]["sha256"]):
            raise RuntimeError("WORK_QUEUE_ARCHIVE_INVALID: identity")
        snapshots.append((snapshot["board_revision"], path, snapshot))
    if not snapshots:
        return None
    _, path, snapshot = max(snapshots, key=lambda item: item[0])
    return _archive_reference(path, snapshot)


def _archive_write(path, snapshot):
    """Publish once; fsync before the active board can lose its reference."""
    raw = (json.dumps(snapshot, sort_keys=True, indent=2) + "\n").encode()
    if len(raw) > MAX_ARCHIVE_BYTES:
        raise RuntimeError("WORK_QUEUE_ARCHIVE_INVALID: size")
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(".tmp")
    with temporary.open("wb") as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    os.chmod(temporary, 0o600)
    try:
        # Exclusive publication avoids silently replacing an earlier snapshot.
        os.link(temporary, path)
    except FileExistsError:
        old = _read_archive(path)
        if any(old.get(key) != snapshot.get(key) for key in ("task", "proof", "acceptances")):
            raise RuntimeError("WORK_QUEUE_ARCHIVE_IMMUTABLE") from None
    finally:
        temporary.unlink(missing_ok=True)
    for directory in (path.parent, path.parent.parent, path.parent.parent.parent):
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)


def _prune_archived_acceptances(root, board, archive_paths):
    """Remove only records already preserved in immutable archives, never evidence."""
    path = Path(root) / "controllers/work-acceptances.json"
    index = _json(_scoped_bytes(root, path)[1])
    active = json.dumps(board, sort_keys=True)
    removable = set()
    for archive in archive_paths:
        removable.update(_read_archive(archive)["acceptances"])
    for digest in removable:
        # Conservative: keep a digest referenced anywhere in remaining task data.
        if digest not in active:
            index["acceptances"].pop(digest, None)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(index, sort_keys=True, indent=2) + "\n")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def archive_done(root, role, identifiers, *, archive_verifier=None, limit=10):
    """Archive bounded verified leaves after trusted final/integrated confirmation.

    The caller holds its runtime coordinator serialization across this call so
    a lease cannot be allocated between verifier inspection and board mutation.
    verifier(task, receipt_sha256) reads durable peer/CI/integration/lease state;
    receipt text and a successful process exit are not final authority. Lock
    order remains role -> coordination; no external execution occurs here.
    Crash order: immutable snapshot -> board replacement -> index pruning. A
    retry recovers either side of board replacement without deleting evidence.
    """
    if (not callable(archive_verifier) or type(limit) is not int or not 1 <= limit <= 10
            or not isinstance(identifiers, list) or not 1 <= len(identifiers) <= limit
            or not all(isinstance(x, str) and x for x in identifiers)
            or len(set(identifiers)) != len(identifiers)):
        raise RuntimeError("WORK_QUEUE_ARCHIVE_REQUEST_INVALID")
    with _locked_board(root, role) as board:
        effective = validate_board(root, candidate=board)["board"]
        verified = {t["id"]: t for t in effective["tasks"]}
        by_id = {t["id"]: t for t in board["tasks"]}
        prepared, recovered = [], []
        for identifier in identifiers:
            task = by_id.get(identifier)
            if task is None:
                reference = archived_task(root, identifier)
                if reference is None or reference["role"] != role:
                    raise RuntimeError("WORK_QUEUE_ARCHIVE_TASK_UNKNOWN_OR_OWNER")
                recovered.append(reference)
                continue
            if task["role"] != role or verified[identifier]["state"] != "DONE":
                raise RuntimeError("WORK_QUEUE_ARCHIVE_NEEDS_VERIFIED_DONE")
            if any(identifier in other["requires"] for other in board["tasks"]):
                raise RuntimeError("WORK_QUEUE_ARCHIVE_DEPENDENCY_REFERENCED")
            digest = task["completion_receipt_sha256"]
            claim = archive_verifier(deepcopy(task), digest)
            if (not isinstance(claim, dict) or claim.get("state") != "FINAL"
                    or claim.get("integration") not in {"INTEGRATED", "NOT_REQUIRED"}
                    or claim.get("pending_review") is not False or claim.get("pending_ci") is not False
                    or claim.get("active_leases") != [] or claim.get("epoch") != _epoch(root)
                    or claim.get("candidate") != task["candidate"] or claim.get("receipt_sha256") != digest
                    or not isinstance(claim.get("authority_id"), str) or not claim["authority_id"].strip()):
                raise RuntimeError("WORK_QUEUE_ARCHIVE_FINAL_AUTHORITY_REQUIRED")
            dependencies = {x: verified[x]["completion_receipt_sha256"] for x in task["requires"]}
            proof = _receipt(root, task, task["completion_receipt"], dependencies)
            if proof["sha256"] != digest or proof["contract_sha256"] != task["completion_contract_sha256"]:
                raise RuntimeError("WORK_QUEUE_ARCHIVE_PROOF_CHANGED")
            index = _json(_scoped_bytes(root, Path(root) / "controllers/work-acceptances.json")[1])
            acceptances = {key: value for key, value in index["acceptances"].items()
                           if value.get("task_id") == identifier}
            snapshot = {"version": 1, "action": "ARCHIVE_DONE", "task": deepcopy(task),
                        "proof": proof, "acceptances": acceptances, "final_acceptance": deepcopy(claim),
                        "board_revision": board["revision"], "archived_at": datetime.now(timezone.utc).isoformat()}
            path = _archive_directory(root, identifier) / (digest + ".json")
            prepared.append((path, snapshot))
        # Validate the whole request before publishing any new archive snapshots.
        for path, snapshot in prepared:
            _archive_write(path, snapshot)
        references = [_archive_reference(path, _read_archive(path)) for path, _ in prepared] + recovered
        removed = {snapshot["task"]["id"] for _, snapshot in prepared}
        if removed:
            board["tasks"] = [t for t in board["tasks"] if t["id"] not in removed]
            _write_board(root, board, {"role": role, "action": "ARCHIVE_DONE", "archives": references})
        _prune_archived_acceptances(root, board, [r["archive_path"] for r in references])
        return {"archived": references, "revision": board["revision"], "already_archived": [r["id"] for r in recovered]}


def board_snapshot(root):
    path = Path(root) / "controllers/work-board.json"
    try:
        with path.open("rb") as source:
            raw = source.read(262145)
    except FileNotFoundError:
        return {"exists": False, "sha256": None}
    except OSError:
        raise RuntimeError("WORK_QUEUE_SNAPSHOT_UNREADABLE") from None
    if len(raw) > 262144:
        raise RuntimeError("WORK_QUEUE_INVALID: size")
    return {"exists": True, "sha256": hashlib.sha256(raw).hexdigest()}


def load_board(root, candidate=None):
    path = Path(root) / "controllers/work-board.json"
    if candidate is None and not path.exists():
        return {"version": 1, "revision": 0, "tasks": []}
    try:
        if candidate is None:
            with path.open("rb") as source:
                raw = source.read(262145)
            if len(raw) > 262144:
                raise ValueError("size")
            board = _json(raw)
        else:
            board = candidate
        tasks = board["tasks"]
        if board["version"] not in {1, 2} or type(board.get("revision")) is not int or board["revision"] < 0 or not isinstance(tasks, list) or len(tasks) > 100:
            raise ValueError("shape")
        by_id = {}
        for task in tasks:
            if not isinstance(task, dict):
                raise ValueError("task")
            identifier = task.get("id")
            if not isinstance(identifier, str) or not identifier or identifier in by_id:
                raise ValueError("id")
            role = task.get("role")
            if role not in {"A", "B", "C"} or task.get("state") not in STATES:
                raise ValueError("role/state")
            if task.get("plan") not in {f"{role}{i:02d}" for i in (range(1, 7) if role == "A" else range(1, 8) if role == "B" else range(8))}:
                raise ValueError("plan")
            if not isinstance(task.get("requires"), list) or not all(isinstance(x, str) for x in task["requires"]):
                raise ValueError("requires")
            if not isinstance(task.get("result"), str) or not task["result"].strip():
                raise ValueError("result")
            if type(task.get("proof_generation", 0)) is not int or task.get("proof_generation", 0) < 0:
                raise ValueError("proof generation")
            if task["state"] == "BLOCKED" and not task["requires"] and not task.get("blocked_reason"):
                raise ValueError("external blocker")
            by_id[identifier] = task
        visiting, visited = set(), set()

        def visit(identifier):
            if identifier not in by_id or identifier in visiting:
                raise ValueError("dependency missing/cycle")
            if identifier in visited:
                return
            visiting.add(identifier)
            for dependency in by_id[identifier]["requires"]:
                visit(dependency)
            visiting.remove(identifier)
            visited.add(identifier)

        for identifier in by_id:
            visit(identifier)
        return board
    except (OSError, ValueError, KeyError, TypeError):
        raise RuntimeError("WORK_QUEUE_INVALID: repair controllers/work-board.json; no waiting proof") from None


def role_work(root, role):
    validation = validate_board(root)
    board = validation["board"]
    done = {t["id"] for t in board["tasks"] if t["state"] == "DONE"}
    rows = []
    for task in board["tasks"]:
        if task["role"] != role or task["state"] == "DONE":
            continue
        waiting_for = [x for x in task["requires"] if x not in done]
        state = task["state"]
        if waiting_for:
            state = "BLOCKED"
        elif state == "BLOCKED" and task["requires"] and not task.get("blocked_reason"):
            state = "READY"
        rows.append({key: task.get(key) for key in ("id", "plan", "result", "paths", "acceptance", "blocked_reason",
                     "boundary", "required_checks", "candidate", "author", "proof_generation", "verification_error",
                     "proof_validity")} | {
            "state": state, "waiting_for": waiting_for,
        })
    return {"revision": board.get("revision", 0), "tasks": rows,
            "invalidated": validation["invalidated"], "migration_required": validation["migration_required"]}


def assert_no_ready_work(root, role):
    ready = [t["id"] for t in role_work(root, role)["tasks"] if t["state"] in {"READY", "IN_PROGRESS", "UNVERIFIED"}]
    if ready:
        raise RuntimeError("WAITING_WORK_QUEUE_AVAILABLE: " + ",".join(ready))


def status_work(root, role, dirty=False, waiting_proof=None):
    try:
        result = role_work(root, role)
        result["input_snapshot"] = board_snapshot(root)
        if waiting_proof is not None and waiting_proof != result["input_snapshot"]:
            result["waiting_invalidated"] = "WORK_BOARD_CHANGED_OR_REMOVED"
    except RuntimeError as error:
        result = {"tasks": [], "error": str(error)}
    result["dirty_worktree"] = bool(dirty)
    result["action_required"] = bool(dirty or result.get("error") or result.get("waiting_invalidated") or any(
        t["state"] in {"READY", "IN_PROGRESS", "UNVERIFIED"} for t in result["tasks"]))
    return result


def advance_task(root, role, identifier, state, receipt="", reason=""):
    if state not in {"IN_PROGRESS", "BLOCKED", "DONE"}:
        raise RuntimeError("WORK_QUEUE_TRANSITION_INVALID")
    with _locked_board(root, role) as board:
        task = next((t for t in board["tasks"] if t["id"] == identifier), None)
        if task is None or task["role"] != role:
            raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
        previous = task["state"]
        reopening = previous == "DONE" and state == "IN_PROGRESS" and bool(reason.strip())
        if previous == "DONE" and not reopening:
            raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID: explicit reopen reason required")
        effective = validate_board(root, candidate=board)["board"]
        by_id = {t["id"]: t for t in effective["tasks"]}
        waiting = [x for x in task["requires"] if by_id[x]["state"] != "DONE"]
        if state in {"IN_PROGRESS", "DONE"} and waiting and not reopening:
            raise RuntimeError("WORK_QUEUE_DEPENDENCY_PENDING")
        if state == "BLOCKED" and (not reason.strip() or not receipt.strip()):
            raise RuntimeError("WORK_QUEUE_BLOCKER_AND_EVIDENCE_REQUIRED")
        if state == "DONE":
            dependencies = {x: by_id[x]["completion_receipt_sha256"] for x in task["requires"]}
            proof = _receipt(root, task, receipt, dependencies)
            task.update(completion_receipt=proof["path"], completion_receipt_sha256=proof["sha256"],
                        completion_contract_sha256=proof["contract_sha256"])
            task.pop("verification_error", None)
        elif state == "BLOCKED":
            proof, _ = _scoped_bytes(root, receipt)
            task.update(blocked_reason=reason, blocked_receipt=str(proof))
        elif state == "IN_PROGRESS":
            if previous == "BLOCKED":
                proof, _ = _scoped_bytes(root, receipt)
                task["unblock_receipt"] = str(proof)
            if reopening or previous == "UNVERIFIED":
                task["proof_generation"] = task.get("proof_generation", 0) + 1
                task["previous_completion"] = {k: task.pop(k) for k in
                    ("completion_receipt", "completion_receipt_sha256", "completion_contract_sha256") if k in task}
                task["reopen_reason"] = reason or "unverified completion requires new acceptance"
            task.pop("verification_error", None)
            task.pop("blocked_reason", None)
            task.pop("blocked_receipt", None)
        task.update(state=state, updated_at=datetime.now(timezone.utc).isoformat())
        return _write_board(root, board, {"role": role, "task": identifier, "before": previous,
                                         "state": state, "receipt": receipt, "reason": reason})


def reopen_task(root, role, identifier, reason):
    if not isinstance(reason, str) or not reason.strip():
        raise RuntimeError("WORK_QUEUE_REOPEN_REASON_REQUIRED")
    return advance_task(root, role, identifier, "IN_PROGRESS", reason=reason)


def add_task(root, role, task, repo_root=None):
    """A role decomposes its own approved PLAN without waiting for a controller."""
    root = Path(root)
    if not isinstance(task, dict) or task.get("role") != role or task.get("state") != "READY":
        raise RuntimeError("WORK_QUEUE_ADD_OWNER_OR_STATE_INVALID")
    if not isinstance(task.get("id"), str) or not task["id"]:
        raise RuntimeError("WORK_QUEUE_INVALID: id")
    if not all(isinstance(task.get(k), list) and task[k] and all(isinstance(x, str) and x.strip() for x in task[k]) for k in ("paths", "acceptance")):
        raise RuntimeError("WORK_QUEUE_PATHS_AND_ACCEPTANCE_REQUIRED")
    if any(Path(x).is_absolute() or ".." in Path(x).parts for x in task["paths"]):
        raise RuntimeError("WORK_QUEUE_PATHS_INVALID")
    if not isinstance(task.get("basis"), str) or not task["basis"].strip():
        raise RuntimeError("WORK_QUEUE_UNFINISHED_REQUIREMENT_REQUIRED")
    repo = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[2]
    ownership = json.loads((repo / "docs/development/coordination/OWNERSHIP.json").read_text())["roles"]
    def owned(path, owner):
        spec = ownership[owner]
        return any(fnmatch.fnmatchcase(path, x) for x in spec["allow"]) and not any(fnmatch.fnmatchcase(path, x) for x in spec["deny"])
    for path in task["paths"]:
        if any(x in path for x in "*?[") or not owned(path, role) or (role == "C" and any(owned(path, x) for x in "AB")):
            raise RuntimeError("WORK_QUEUE_OWNERSHIP_VIOLATION: self-add requires exact owned paths; assigned exceptions use coordination")
    plan = (repo / "docs/development/coordination/PLAN.md").read_text()
    approved = next((row for row in plan.splitlines() if row.startswith("| " + str(task.get("plan")) + " |")), None)
    if approved is None:
        raise RuntimeError("WORK_QUEUE_APPROVED_PLAN_REQUIRED")
    task = dict(task, approved_plan_basis=approved)
    with (root / (role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        if json.loads((root / (role + ".json")).read_text()).get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no queue transition permitted")
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            board = load_board(root)
            if _archive_directory(root, task["id"]).exists():
                raise RuntimeError("WORK_QUEUE_ARCHIVED_ID_IMMUTABLE: use a new task ID")
            task = dict(task)
            task["created_at"] = datetime.now(timezone.utc).isoformat()
            board["tasks"].append(task)
            board["revision"] += 1
            board["updated_at"] = task["created_at"]
            load_board(root, candidate=board)
            encoded = json.dumps(board, ensure_ascii=False, indent=2) + "\n"
            if len(encoded.encode()) > 262144:
                raise RuntimeError("WORK_QUEUE_INVALID: size")
            path = root / "controllers/work-board.json"
            temporary = path.with_name(path.name + ".tmp")
            temporary.write_text(encoded)
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
            event = {"at": task["created_at"], "role": role, "task": task["id"], "action": "ADD", "revision": board["revision"]}
            with (root / "controllers/work-board-events.jsonl").open("a") as output:
                output.write(json.dumps(event, ensure_ascii=False) + "\n")
            return event


def compact_state(state):
    notices = sorted(state.get("controller_notices", []),
                     key=lambda x: str(x.get("created_at", "")), reverse=True)
    keys = ("role", "status", "task", "head", "updated_at", "review_pending",
            "review_reason", "review_receipt", "owner_requests", "work_queue",
            "last_checkpoint_at", "heartbeat_at", "waiting_since")
    result = {key: state.get(key) for key in keys}
    result.update(result=str(state.get("result", ""))[:800], next=str(state.get("next", ""))[:800],
                  notice_count=len(notices),
                  latest_notices=[{"id": n.get("id"), "created_at": n.get("created_at")} for n in notices[:5]],
                  full_state_path=f"/root/octoport-control/{state.get('role')}.json")
    return result
