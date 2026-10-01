"""Small shared outcome queue. It records work; it grants no live authority."""
import fcntl
import fnmatch
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

STATES = {"READY", "IN_PROGRESS", "BLOCKED", "DONE"}


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
            if task.get("plan") not in {f"{role}{i:02d}" for i in (range(1, 7) if role == "A" else range(1, 8) if role == "B" else range(8))}:
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


def role_work(root, role):
    board = load_board(root)
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
        rows.append({key: task.get(key) for key in ("id", "plan", "result", "paths", "acceptance", "blocked_reason")} | {
            "state": state, "waiting_for": waiting_for,
        })
    return {"revision": board.get("revision", 0), "tasks": rows}


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
    """A role decomposes its own approved PLAN without waiting for a controller."""
    root = Path(root)
    if not isinstance(task, dict) or task.get("role") != role or task.get("state") != "READY":
        raise RuntimeError("WORK_QUEUE_ADD_OWNER_OR_STATE_INVALID")
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
