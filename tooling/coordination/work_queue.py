"""Small shared outcome queue. It records work; it grants no live authority."""
import fcntl
import fnmatch
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

STATES = {"READY", "IN_PROGRESS", "BLOCKED", "DONE"}
PLAN_IDS = {f"{r}{i:02d}" for r, span in (("A", range(1, 7)), ("B", range(1, 8)), ("C", range(8))) for i in span}


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
    done = {t["id"] for t in board["tasks"] if t["state"] == "DONE"}
    waiting = [x for x in task["requires"] if x not in done]
    state = task["state"]
    if waiting:
        state = "BLOCKED"
    elif state == "BLOCKED" and task["requires"] and not task.get("blocked_reason"):
        state = "READY"
    conflicts = task_conflicts(board, task) if state == "READY" else []
    if conflicts:
        state = "BLOCKED"
    return {key: task.get(key) for key in (
        "id", "role", "plan", "result", "paths", "acceptance", "blocked_reason"
    )} | {"state": state, "waiting_for": waiting, "conflicts": conflicts}


def role_work(root, role):
    board = load_board(root)
    rows = []
    for task in board["tasks"]:
        if task["state"] == "DONE":
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
    ready = [t["id"] for t in role_work(root, role)["tasks"] if t["state"] in {"READY", "IN_PROGRESS"}]
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
        t["state"] in {"READY", "IN_PROGRESS"} for t in result["tasks"]))
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
            if task is None or task["role"] != role or task["state"] == "DONE":
                raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
            view = next(t for t in role_work(root, role)["tasks"] if t["id"] == identifier)
            if state in {"IN_PROGRESS", "DONE"} and view["waiting_for"]:
                raise RuntimeError("WORK_QUEUE_DEPENDENCY_PENDING")
            if state == "IN_PROGRESS":
                if task_conflicts(board, task):
                    raise RuntimeError("WORK_QUEUE_SCOPE_CONFLICT_OR_ACTIVE_TASK")
            if state == "BLOCKED" and (not reason.strip() or not receipt.strip()):
                raise RuntimeError("WORK_QUEUE_BLOCKER_AND_EVIDENCE_REQUIRED")
            if state in {"DONE", "BLOCKED"} or (state == "IN_PROGRESS" and view["state"] == "BLOCKED"):
                proof = Path(receipt).resolve()
                try:
                    relative = proof.relative_to(root.resolve())
                except ValueError:
                    raise RuntimeError("WORK_QUEUE_RECEIPT_OUTSIDE_CONTROL") from None
                if not proof.is_file() or relative.parts[0] not in {"logs", "controllers", "artifacts"}:
                    raise RuntimeError("WORK_QUEUE_COMPLETION_RECEIPT_REQUIRED")
                if state == "DONE":
                    task["completion_receipt"] = str(proof)
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
