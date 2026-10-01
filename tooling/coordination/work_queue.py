"""Small shared outcome queue. It records work; it grants no live authority."""
import fcntl
import fnmatch
import hashlib
import json
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

STATES = {"READY", "IN_PROGRESS", "BLOCKED", "DONE"}
PLAN_IDS = {f"{r}{i:02d}" for r, span in (("A", range(1, 7)), ("B", range(1, 8)), ("C", range(8))) for i in span}
COMPLETION_KIND = "octoport.work-queue-completion"
COMPLETION_VERSION = 1
COMPLETION_VERDICTS = {"PASS", "FAIL", "REWORK_REQUIRED"}


def current_worktree_head():
    """Return this source worktree's HEAD; role-state heads are not authoritative."""
    repo = Path(__file__).resolve().parents[2]
    try:
        head = subprocess.run(
            ["git", "-C", str(repo), "rev-parse", "HEAD"],
            check=True, capture_output=True, text=True, timeout=5,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        raise RuntimeError("WORK_QUEUE_CURRENT_HEAD_UNAVAILABLE") from None
    if not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", head):
        raise RuntimeError("WORK_QUEUE_CURRENT_HEAD_INVALID")
    return head


def _strict_json_object(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("duplicate key")
            result[key] = value
        return result
    value = json.loads(raw, object_pairs_hook=pairs)
    if not isinstance(value, dict):
        raise ValueError("object required")
    return value


def _completion_receipt(path, identifier, candidate_sha):
    """Read and validate the exact, task- and candidate-bound receipt schema."""
    try:
        with Path(path).open("rb") as source:
            raw = source.read(65537)
        if len(raw) > 65536:
            return None
        receipt = _strict_json_object(raw)
        if set(receipt) != {"kind", "version", "task_id", "candidate_sha", "verdict", "review", "checks"}:
            return None
        if (receipt["kind"] != COMPLETION_KIND or type(receipt["version"]) is not int
                or receipt["version"] != COMPLETION_VERSION
                or receipt["task_id"] != identifier or receipt["candidate_sha"] != candidate_sha
                or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", str(receipt["candidate_sha"]))
                or receipt["verdict"] not in COMPLETION_VERDICTS):
            return None
        review = receipt["review"]
        if (not isinstance(review, dict) or set(review) != {"verdict", "evidence"}
                or review["verdict"] not in COMPLETION_VERDICTS
                or not isinstance(review["evidence"], list) or not review["evidence"]
                or not all(isinstance(item, str) and item.strip() for item in review["evidence"])):
            return None
        checks = receipt["checks"]
        if not isinstance(checks, list) or not checks:
            return None
        for check in checks:
            if (not isinstance(check, dict) or set(check) != {"name", "verdict", "evidence"}
                    or not isinstance(check["name"], str) or not check["name"].strip()
                    or check["verdict"] not in COMPLETION_VERDICTS
                    or not isinstance(check["evidence"], list) or not check["evidence"]
                    or not all(isinstance(item, str) and item.strip() for item in check["evidence"])):
                return None
        return receipt
    except (OSError, ValueError, TypeError, KeyError):
        return None


def _receipt_passes(receipt):
    return (receipt is not None and receipt["verdict"] == "PASS"
            and receipt["review"]["verdict"] == "PASS"
            and all(check["verdict"] == "PASS" for check in receipt["checks"]))


def _strict_completion_valid(task):
    if "completion_receipt_format" not in task:
        # Pre-gate board rows are historical until explicitly reopened.
        return True
    if (type(task.get("completion_receipt_format")) is not int
            or task.get("completion_receipt_format") != COMPLETION_VERSION):
        return False
    receipt = _completion_receipt(task.get("completion_receipt", ""), task["id"],
                                  task.get("completion_candidate_sha", ""))
    return _receipt_passes(receipt)


def _task_satisfies_dependencies(task):
    return task["state"] == "DONE" and _strict_completion_valid(task)


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
            board = json.loads(raw)
        else:
            board = candidate
        tasks = board["tasks"]
        if board["version"] != 1 or not isinstance(board.get("revision"), int) or board["revision"] < 0 or not isinstance(tasks, list) or len(tasks) > 100:
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
            if task.get("plan") not in PLAN_IDS:
                raise ValueError("plan")
            if not isinstance(task.get("requires"), list) or not all(isinstance(x, str) for x in task["requires"]):
                raise ValueError("requires")
            if not isinstance(task.get("result"), str) or not task["result"].strip():
                raise ValueError("result")
            if task["state"] == "DONE" and not task.get("completion_receipt"):
                raise ValueError("completion receipt")
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


def valid_paths(paths):
    return (isinstance(paths, list) and bool(paths) and all(
        isinstance(p, str) and p.strip() == p and p not in {"", "."}
        and not Path(p).is_absolute() and ".." not in Path(p).parts
        and str(Path(p)) == p and not any(x in p for x in "*?[")
        for p in paths))


def paths_overlap(left, right):
    return left == right or left.startswith(right + "/") or right.startswith(left + "/")


def task_conflicts(board, task):
    paths = task.get("paths")
    if not valid_paths(paths):
        return ["TASK_PATHS_REQUIRED"]
    conflicts = []
    for other in board["tasks"]:
        if other["id"] == task["id"] or other["state"] != "IN_PROGRESS":
            continue
        if not valid_paths(other.get("paths")) or any(
            paths_overlap(a, b) for a in paths for b in other["paths"]
        ):
            conflicts.append(other["id"])
    return conflicts


def task_view(board, task):
    done = {t["id"] for t in board["tasks"] if _task_satisfies_dependencies(t)}
    waiting = [x for x in task["requires"] if x not in done]
    state = task["state"]
    completion_invalidated = task["state"] == "DONE" and not _strict_completion_valid(task)
    if completion_invalidated:
        state = "BLOCKED"
    if waiting:
        state = "BLOCKED"
    elif state == "BLOCKED" and task["requires"] and not task.get("blocked_reason") and not completion_invalidated:
        state = "READY"
    conflicts = task_conflicts(board, task) if state == "READY" else []
    if conflicts:
        state = "BLOCKED"
    return {key: task.get(key) for key in (
        "id", "role", "plan", "result", "paths", "acceptance", "blocked_reason"
    )} | {"state": state, "waiting_for": waiting, "conflicts": conflicts,
         "completion_invalidated": completion_invalidated}


def role_work(root, role):
    board = load_board(root)
    rows = []
    for task in board["tasks"]:
        if task["state"] == "DONE" and _strict_completion_valid(task):
            continue
        view = task_view(board, task)
        # All claimable work is visible, regardless of its original author.
        if task["role"] == role or view["state"] == "READY":
            rows.append(view)
    return {"revision": board.get("revision", 0), "tasks": rows}


def validate_task_scope(root, role, paths):
    board = load_board(root)
    active = [t for t in board["tasks"] if t["role"] == role and t["state"] == "IN_PROGRESS"]
    allowed = {p for t in active if valid_paths(t.get("paths")) for p in t["paths"]}
    missing = [p for p in paths if p not in allowed]
    if missing:
        raise RuntimeError("TASK_SCOPE_VIOLATION: claim exact paths before editing: " + ", ".join(missing))
    for task in active:
        conflicts = task_conflicts(board, task)
        if conflicts:
            raise RuntimeError("TASK_SCOPE_CONFLICT: " + ",".join(conflicts))


def write_board(root, board, event):
    now = datetime.now(timezone.utc).isoformat()
    board["revision"] = board.get("revision", 0) + 1
    board["updated_at"] = now
    load_board(root, candidate=board)
    encoded = json.dumps(board, ensure_ascii=False, indent=2) + "\n"
    if len(encoded.encode()) > 262144:
        raise RuntimeError("WORK_QUEUE_INVALID: size")
    path = root / "controllers/work-board.json"
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(encoded)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    event = dict(event, at=now, revision=board["revision"])
    with (root / "controllers/work-board-events.jsonl").open("a") as output:
        output.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def claim_task(root, role, identifier=""):
    root = Path(root)
    with (root / (role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        if json.loads((root / (role + ".json")).read_text()).get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no queue claim permitted")
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            board = load_board(root)
            active = [t for t in board["tasks"] if t["role"] == role and t["state"] == "IN_PROGRESS"]
            if any(t["id"] == identifier for t in active):
                return {"role": role, "task": identifier, "state": "IN_PROGRESS", "revision": board["revision"]}
            choices = [t for t in board["tasks"] if (not identifier or t["id"] == identifier)
                       and task_view(board, t)["state"] == "READY"]
            if not choices:
                raise RuntimeError("WORK_QUEUE_NO_CLAIMABLE_TASK: no available result; do not steal active work")
            task = choices[0]
            previous = task["role"]
            task.update(role=role, state="IN_PROGRESS", claimed_at=datetime.now(timezone.utc).isoformat())
            return write_board(root, board, {"action": "CLAIM", "role": role,
                "task": task["id"], "previous_role": previous, "state": "IN_PROGRESS"})


def assert_no_ready_work(root, role):
    ready = [t["id"] for t in role_work(root, role)["tasks"]
             if t["state"] in {"READY", "IN_PROGRESS"} or t.get("completion_invalidated")]
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
        t["state"] in {"READY", "IN_PROGRESS"} or t.get("completion_invalidated") for t in result["tasks"]))
    return result


def advance_task(root, role, identifier, state, receipt="", reason=""):
    root = Path(root)
    if state not in {"IN_PROGRESS", "BLOCKED", "DONE"}:
        raise RuntimeError("WORK_QUEUE_TRANSITION_INVALID")
    # Same lock order for every writer; no operation waits for a test under lock.
    with (root / (role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        role_state = json.loads((root / (role + ".json")).read_text())
        if role_state.get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no queue transition permitted")
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            board = load_board(root)
            task = next((t for t in board["tasks"] if t["id"] == identifier), None)
            if task is None or task["role"] != role:
                raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
            invalidated_done = task["state"] == "DONE" and not _strict_completion_valid(task)
            legacy_done = task["state"] == "DONE" and "completion_receipt_format" not in task
            if task["state"] == "DONE" and not (state == "IN_PROGRESS" and (invalidated_done or legacy_done)):
                raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
            if task["state"] != "DONE" and state == "IN_PROGRESS" and invalidated_done:
                raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
            view = task_view(board, task)
            if state in {"IN_PROGRESS", "DONE"} and view["waiting_for"]:
                raise RuntimeError("WORK_QUEUE_DEPENDENCY_PENDING")
            if state == "IN_PROGRESS":
                if task_conflicts(board, task):
                    raise RuntimeError("WORK_QUEUE_SCOPE_CONFLICT_OR_ACTIVE_TASK")
                if invalidated_done or legacy_done:
                    candidate_sha = current_worktree_head()
                    try:
                        proof = Path(receipt).resolve()
                        relative = proof.relative_to(root.resolve())
                    except (ValueError, OSError):
                        raise RuntimeError("WORK_QUEUE_RECEIPT_OUTSIDE_CONTROL") from None
                    if not proof.is_file() or not relative.parts or relative.parts[0] not in {"logs", "controllers", "artifacts"}:
                        raise RuntimeError("WORK_QUEUE_COMPLETION_RECEIPT_REQUIRED")
                    if proof == Path(task.get("completion_receipt", "")).resolve():
                        raise RuntimeError("WORK_QUEUE_REOPEN_REWORK_RECEIPT_REQUIRED")
                    negative = _completion_receipt(proof, identifier, candidate_sha)
                    if (negative is None or negative["verdict"] not in {"FAIL", "REWORK_REQUIRED"}
                            or (negative["review"]["verdict"] not in {"FAIL", "REWORK_REQUIRED"}
                                and not any(c["verdict"] in {"FAIL", "REWORK_REQUIRED"} for c in negative["checks"]))):
                        raise RuntimeError("WORK_QUEUE_REOPEN_REWORK_RECEIPT_REQUIRED")
                    history = task.setdefault("completion_history", [])
                    history.append({
                        "receipt": task.get("completion_receipt"),
                        "format": task.get("completion_receipt_format", "legacy"),
                        "candidate_sha": task.get("completion_candidate_sha"),
                        "receipt_snapshot": task.get("completion_receipt_snapshot"),
                    })
                    task["reopen_receipt"] = str(proof)
                    task["reopen_candidate_sha"] = candidate_sha
            if state == "BLOCKED" and (not reason.strip() or not receipt.strip()):
                raise RuntimeError("WORK_QUEUE_BLOCKER_AND_EVIDENCE_REQUIRED")
            if state in {"DONE", "BLOCKED"} or (state == "IN_PROGRESS" and view["state"] == "BLOCKED"):
                proof = Path(receipt).resolve() if receipt else None
                try:
                    relative = proof.relative_to(root.resolve()) if proof else None
                except ValueError:
                    raise RuntimeError("WORK_QUEUE_RECEIPT_OUTSIDE_CONTROL") from None
                if not proof or not proof.is_file() or not relative.parts or relative.parts[0] not in {"logs", "controllers", "artifacts"}:
                    raise RuntimeError("WORK_QUEUE_COMPLETION_RECEIPT_REQUIRED")
                if state == "DONE":
                    candidate_sha = current_worktree_head()
                    acceptance = _completion_receipt(proof, identifier, candidate_sha)
                    if not _receipt_passes(acceptance):
                        raise RuntimeError("WORK_QUEUE_STRICT_PASS_RECEIPT_REQUIRED")
                    task["completion_receipt"] = str(proof)
                    task["completion_receipt_format"] = COMPLETION_VERSION
                    task["completion_candidate_sha"] = candidate_sha
                    task["completion_receipt_snapshot"] = acceptance
                elif state == "IN_PROGRESS":
                    task["unblock_receipt"] = str(proof)
            if state == "BLOCKED":
                if not reason.strip() or not receipt.strip():
                    raise RuntimeError("WORK_QUEUE_BLOCKER_AND_EVIDENCE_REQUIRED")
                task["blocked_reason"] = reason
                task["blocked_receipt"] = receipt
            elif state == "IN_PROGRESS":
                task.pop("blocked_reason", None)
                task.pop("blocked_receipt", None)
            previous = task["state"]
            now = datetime.now(timezone.utc).isoformat()
            task.update(state=state, updated_at=now)
            board["revision"] = board.get("revision", 0) + 1
            board["updated_at"] = now
            path = root / "controllers/work-board.json"
            temporary = path.with_name(path.name + ".tmp")
            temporary.write_text(json.dumps(board, ensure_ascii=False, indent=2) + "\n")
            os.chmod(temporary, 0o600)
            os.replace(temporary, path)
            event = {"at": now, "role": role, "task": identifier, "before": previous,
                     "state": state, "receipt": receipt, "revision": board["revision"]}
            with (root / "controllers/work-board-events.jsonl").open("a") as output:
                output.write(json.dumps(event, ensure_ascii=False) + "\n")
            return event


def add_task(root, role, task, repo_root=None):
    """A dialogue decomposes any approved PLAN outcome without controller handoff."""
    root = Path(root)
    if not isinstance(task, dict) or task.get("role") != role or task.get("state") != "READY":
        raise RuntimeError("WORK_QUEUE_ADD_OWNER_OR_STATE_INVALID")
    if not all(isinstance(task.get(k), list) and task[k] and all(isinstance(x, str) and x.strip() for x in task[k]) for k in ("paths", "acceptance")):
        raise RuntimeError("WORK_QUEUE_PATHS_AND_ACCEPTANCE_REQUIRED")
    if not valid_paths(task["paths"]):
        raise RuntimeError("WORK_QUEUE_PATHS_INVALID")
    if not isinstance(task.get("basis"), str) or not task["basis"].strip():
        raise RuntimeError("WORK_QUEUE_UNFINISHED_REQUIREMENT_REQUIRED")
    repo = Path(repo_root) if repo_root is not None else Path(__file__).resolve().parents[2]
    ownership = json.loads((repo / "docs/development/coordination/OWNERSHIP.json").read_text())["roles"]
    def owned(path, owner):
        spec = ownership[owner]
        return any(fnmatch.fnmatchcase(path, x) for x in spec["allow"]) and not any(fnmatch.fnmatchcase(path, x) for x in spec["deny"])
    for path in task["paths"]:
        if any(x in path for x in "*?[") or not owned(path, role):
            raise RuntimeError("WORK_QUEUE_OWNERSHIP_VIOLATION: self-add requires exact approved paths")
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
