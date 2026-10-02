"""Small shared outcome queue. It records work; it grants no live authority."""
import fcntl
import fnmatch
import hashlib
import importlib.util
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
PUBLICATION_REQUIRED_CI = (
    "Server CI",
    "Extension CI",
    "Extension I1-C1 client",
    "Documentation CI",
    "Coordination and release safety",
)
_V2_MODULE = None


def _v2():
    global _V2_MODULE
    if _V2_MODULE is None:
        path = Path(__file__).with_name("work_board_v2.py")
        spec = importlib.util.spec_from_file_location("octoport_work_board_v2", path)
        if spec is None or spec.loader is None:
            raise RuntimeError("WORK_BOARD_V2_SOURCE_UNAVAILABLE")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _V2_MODULE = module
    return _V2_MODULE


def _prepare_storage_write(root):
    module = _v2()
    if module.storage_version(root) == 2:
        module.recover_queue_transaction(root)


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


def _canonical_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def _sha_bytes(raw):
    return hashlib.sha256(raw).hexdigest()


def _publication_task_fingerprint(task):
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


def _publication_json(path, *, cap=262144):
    raw = Path(path).read_bytes()
    if len(raw) > cap:
        raise RuntimeError("WORK_QUEUE_PUBLICATION_EVIDENCE_INVALID")
    try:
        value = _strict_json_object(raw)
    except (ValueError, TypeError):
        raise RuntimeError("WORK_QUEUE_PUBLICATION_EVIDENCE_INVALID") from None
    return value, raw


def _publication_snapshot_shape_valid(task):
    registration_id = task.get("completion_publication_registration")
    snapshot = task.get("completion_publication_snapshot")
    if registration_id is None and snapshot is None:
        return True
    expected = {
        "registration_id", "candidate_sha", "task_id", "role", "task_paths",
        "ready_receipt", "ready_sha256", "close_receipt", "close_sha256",
        "task_ref_cleanup_status",
    }
    return (
        isinstance(registration_id, str)
        and re.fullmatch(r"[0-9a-f]{64}", registration_id) is not None
        and isinstance(snapshot, dict)
        and set(snapshot) == expected
        and isinstance(snapshot.get("task_paths"), list)
        and all(isinstance(path, str) and path for path in snapshot["task_paths"])
        and all(
            isinstance(snapshot.get(key), str) and snapshot[key].strip()
            for key in (
                "registration_id", "candidate_sha", "task_id", "role",
                "ready_receipt", "ready_sha256", "close_receipt", "close_sha256",
                "task_ref_cleanup_status",
            )
        )
        and re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", snapshot["candidate_sha"]) is not None
        and re.fullmatch(r"[0-9a-f]{64}", snapshot["ready_sha256"]) is not None
        and re.fullmatch(r"[0-9a-f]{64}", snapshot["close_sha256"]) is not None
    )


def _publication_snapshot_valid(task):
    if not _publication_snapshot_shape_valid(task):
        return False
    registration_id = task.get("completion_publication_registration")
    snapshot = task.get("completion_publication_snapshot")
    if registration_id is None:
        return True
    if not (
        snapshot["registration_id"] == registration_id
        and snapshot["candidate_sha"] == task.get("completion_candidate_sha")
        and snapshot["task_id"] == task.get("id")
        and snapshot["role"] == task.get("role")
        and snapshot["task_paths"] == task.get("paths")
        and snapshot["task_ref_cleanup_status"] in {"DELETED", "ALREADY_ABSENT"}
    ):
        return False
    try:
        ready_path = Path(snapshot["ready_receipt"]).resolve()
        publication = ready_path.parents[2]
        if publication.name != "task-publication" or publication.parent.name != "controllers":
            return False
        root = publication.parent.parent
        completion_receipt = Path(task.get("completion_receipt", "")).resolve()
        relative_receipt = completion_receipt.relative_to(root.resolve())
        if not relative_receipt.parts or relative_receipt.parts[0] not in {"logs", "controllers", "artifacts"}:
            return False
        candidate, current_snapshot = _publication_completion_candidate(
            root, task.get("role"), task, registration_id, allow_done=True
        )
    except (RuntimeError, OSError, ValueError, IndexError, KeyError, TypeError):
        return False
    return candidate == task.get("completion_candidate_sha") and current_snapshot == snapshot


def _publication_completion_candidate(root, role, task, registration_id, *, allow_done=False):
    if not isinstance(registration_id, str) or re.fullmatch(r"[0-9a-f]{64}", registration_id) is None:
        raise RuntimeError("WORK_QUEUE_PUBLICATION_REGISTRATION_INVALID")
    publication = Path(root) / "controllers/task-publication"
    reg_path = publication / "registrations" / f"{registration_id}.json"
    try:
        reg, reg_raw = _publication_json(reg_path)
        core = reg["core"]
        version = reg["state_version"]
        if (
            reg.get("kind") != "octoport.task-publication-registration"
            or reg.get("version") != 1
            or reg.get("registration_id") != registration_id
            or reg.get("registration_sha256") != registration_id
            or not isinstance(core, dict)
            or _sha_bytes(_canonical_bytes(core)) != registration_id
            or type(version) is not int
            or version < 2
            or reg.get("state") != "CLOSED"
        ):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_REGISTRATION_INVALID")

        history = publication / "states" / registration_id
        current_state_path = history / f"{version}.json"
        previous_state_path = history / f"{version - 1}.json"
        if current_state_path.read_bytes() != reg_raw:
            raise RuntimeError("WORK_QUEUE_PUBLICATION_STATE_CHAIN_INVALID")
        previous, previous_raw = _publication_json(previous_state_path)
        if (
            _sha_bytes(previous_raw) != reg.get("previous_state_sha256")
            or previous.get("state") != "PUBLISHED"
            or previous.get("state_version") != version - 1
            or previous.get("registration_id") != registration_id
            or previous.get("core") != core
        ):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_STATE_CHAIN_INVALID")

        candidate = core.get("candidate_head")
        if (
            core.get("task_id") != task.get("id")
            or core.get("role") != role
            or core.get("task_paths") != task.get("paths")
            or not isinstance(candidate, str)
            or re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", candidate) is None
            or not isinstance(core.get("task_ref"), str)
            or not isinstance(core.get("task_branch"), str)
            or reg.get("task_ref_cleanup_status") not in {"DELETED", "ALREADY_ABSENT"}
        ):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_TASK_BINDING_INVALID")
        allowed_task_states = {"IN_PROGRESS", "BLOCKED", "DONE"} if allow_done else {"IN_PROGRESS", "BLOCKED"}
        if task.get("state") not in allowed_task_states:
            raise RuntimeError("WORK_QUEUE_PUBLICATION_TASK_BINDING_INVALID")
        registered_task = dict(task)
        registered_task["state"] = "IN_PROGRESS"
        if _publication_task_fingerprint(registered_task) != core.get("task_fingerprint"):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_TASK_BINDING_INVALID")

        ready_descriptor = reg.get("ready_receipt")
        if not isinstance(ready_descriptor, dict) or set(ready_descriptor) != {"path", "sha256"}:
            raise RuntimeError("WORK_QUEUE_PUBLICATION_READY_INVALID")
        ready_path = Path(ready_descriptor["path"]).resolve()
        expected_ready_dir = (publication / "ready" / registration_id).resolve()
        if ready_path.parent != expected_ready_dir or not re.fullmatch(r"[1-9][0-9]*\.json", ready_path.name):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_READY_INVALID")
        ready, ready_raw = _publication_json(ready_path)
        if _sha_bytes(ready_raw) != ready_descriptor["sha256"]:
            raise RuntimeError("WORK_QUEUE_PUBLICATION_READY_INVALID")
        ci = ready.get("ci")
        runs = ci.get("runs") if isinstance(ci, dict) else None
        ready_version = ready.get("registration_state_version")
        if (
            ready.get("kind") != "octoport.task-publication-ready"
            or ready.get("version") != 1
            or ready.get("registration_id") != registration_id
            or ready.get("registration_sha256") != registration_id
            or type(ready_version) is not int
            or ready_version < 1
            or ready_version >= version
            or ready.get("task_id") != task.get("id")
            or ready.get("role") != role
            or ready.get("candidate_head") != candidate
            or ready.get("candidate_tree") != core.get("candidate_tree")
            or ready.get("base_sha") != core.get("base_sha")
            or ready.get("task_ref") != core.get("task_ref")
            or ready.get("task_branch") != core.get("task_branch")
            or ready.get("task_fingerprint") != core.get("task_fingerprint")
            or ready.get("review") != core.get("review")
            or ready.get("bundle_manifest_sha256") != core.get("bundle_manifest_sha256")
            or not isinstance(ci, dict)
            or ci.get("status") != "PASS"
            or ci.get("head") != candidate
            or ci.get("branch") != core.get("task_branch")
            or not isinstance(runs, list)
            or len(runs) != len(PUBLICATION_REQUIRED_CI)
        ):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_READY_INVALID")
        ready_state, _ready_state_raw = _publication_json(history / f"{ready_version}.json")
        if (
            ready_state.get("registration_id") != registration_id
            or ready_state.get("state") != "READY"
            or ready_state.get("state_version") != ready_version
            or ready_state.get("core") != core
            or ready_state.get("ready_receipt") != ready_descriptor
        ):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_READY_INVALID")
        by_name = {row.get("name"): row for row in runs if isinstance(row, dict)}
        if set(by_name) != set(PUBLICATION_REQUIRED_CI):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_READY_INVALID")
        run_ids = []
        for name in PUBLICATION_REQUIRED_CI:
            row = by_name[name]
            if (
                type(row.get("id")) is not int
                or row["id"] <= 0
                or row.get("status") != "completed"
                or row.get("conclusion") != "success"
            ):
                raise RuntimeError("WORK_QUEUE_PUBLICATION_READY_INVALID")
            run_ids.append(row["id"])
        if len(set(run_ids)) != len(PUBLICATION_REQUIRED_CI):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_READY_INVALID")

        close_descriptor = reg.get("close_receipt")
        if not isinstance(close_descriptor, dict) or set(close_descriptor) != {"path", "sha256"}:
            raise RuntimeError("WORK_QUEUE_PUBLICATION_CLOSE_INVALID")
        close_path = Path(close_descriptor["path"]).resolve()
        expected_close = (publication / "close" / registration_id / "receipt.json").resolve()
        if close_path != expected_close:
            raise RuntimeError("WORK_QUEUE_PUBLICATION_CLOSE_INVALID")
        close, close_raw = _publication_json(close_path)
        if (
            _sha_bytes(close_raw) != close_descriptor["sha256"]
            or close.get("kind") != "octoport.task-publication-close"
            or close.get("version") != 1
            or close.get("registration_id") != registration_id
            or close.get("state_before") != "PUBLISHED"
        ):
            raise RuntimeError("WORK_QUEUE_PUBLICATION_CLOSE_INVALID")
    except (OSError, KeyError, TypeError, ValueError):
        raise RuntimeError("WORK_QUEUE_PUBLICATION_EVIDENCE_INVALID") from None

    snapshot = {
        "registration_id": registration_id,
        "candidate_sha": candidate,
        "task_id": task["id"],
        "role": role,
        "task_paths": task["paths"],
        "ready_receipt": str(ready_path),
        "ready_sha256": ready_descriptor["sha256"],
        "close_receipt": str(close_path),
        "close_sha256": close_descriptor["sha256"],
        "task_ref_cleanup_status": reg["task_ref_cleanup_status"],
    }
    return candidate, snapshot


def _strict_completion_valid(task):
    if "completion_receipt_format" not in task:
        # Pre-gate board rows are historical until explicitly reopened.
        return True
    if (type(task.get("completion_receipt_format")) is not int
            or task.get("completion_receipt_format") != COMPLETION_VERSION):
        return False
    receipt = _completion_receipt(task.get("completion_receipt", ""), task["id"],
                                  task.get("completion_candidate_sha", ""))
    return _receipt_passes(receipt) and _publication_snapshot_valid(task)


def _task_satisfies_dependencies(task):
    return task["state"] == "DONE" and _strict_completion_valid(task)


def _strict_blocker_successor_valid(task):
    if (task.get("state") != "DONE"
            or type(task.get("completion_receipt_format")) is not int
            or task.get("completion_receipt_format") != COMPLETION_VERSION
            or not isinstance(task.get("completion_receipt_snapshot"), dict)):
        return False
    current = _completion_receipt(
        task.get("completion_receipt", ""), task["id"], task.get("completion_candidate_sha", "")
    )
    return (_strict_completion_valid(task)
            and current == task["completion_receipt_snapshot"])


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
    try:
        version = json.loads(raw).get("version")
    except (ValueError, TypeError, AttributeError):
        raise RuntimeError("WORK_QUEUE_INVALID: repair controllers/work-board.json; no waiting proof") from None
    if version == 2:
        try:
            return _v2().board_snapshot(Path(root), raw)
        except RuntimeError:
            raise RuntimeError("WORK_QUEUE_INVALID: repair controllers/work-board.json; no waiting proof") from None
    return {"exists": True, "sha256": hashlib.sha256(raw).hexdigest()}


def _validate_logical_board(board, *, enforce_v1_count):
    tasks = board["tasks"]
    version = board.get("version")
    if (version not in {1, 2} or not isinstance(board.get("revision"), int)
            or board["revision"] < 0 or not isinstance(tasks, list)
            or (enforce_v1_count and len(tasks) > 100)):
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
        if task.get("completion_publication_registration") is not None or task.get("completion_publication_snapshot") is not None:
            if task["state"] != "DONE" or not _publication_snapshot_shape_valid(task):
                raise ValueError("publication completion evidence")
        if task["state"] == "BLOCKED" and not task["requires"] and not task.get("blocked_reason"):
            raise ValueError("external blocker")
        resolution = task.get("blocker_resolution")
        if resolution is not None:
            # blocker_resolution predates this governed successor mechanism and
            # historical rows contain other nonterminal status labels. Keep
            # those readable; only the new exact RESOLVED form is schema-bound.
            if (not isinstance(resolution, dict)
                    or not isinstance(resolution.get("status"), str)
                    or not resolution["status"].strip()):
                raise ValueError("blocker resolution")
            if resolution["status"] == "RESOLVED" and (
                not all(isinstance(resolution.get(key), str) and resolution[key].strip()
                        for key in ("owner", "next_action", "unblock_when", "successor_task",
                                    "successor_candidate_sha", "receipt", "resolved_at"))
                or not re.fullmatch(r"(?:[0-9a-f]{40}|[0-9a-f]{64})", resolution["successor_candidate_sha"])
            ):
                raise ValueError("blocker resolution")
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


def load_board(root, candidate=None):
    path = Path(root) / "controllers/work-board.json"
    if candidate is None and not path.exists():
        return {"version": 1, "revision": 0, "tasks": []}
    try:
        if candidate is not None:
            board = candidate
            return _validate_logical_board(board, enforce_v1_count=board.get("version") == 1)
        with path.open("rb") as source:
            raw = source.read(262145)
        if len(raw) > 262144:
            raise ValueError("size")
        parsed = json.loads(raw)
        if parsed.get("version") == 2:
            board = _v2().load_logical_board(Path(root), raw)
            return _validate_logical_board(board, enforce_v1_count=False)
        return _validate_logical_board(parsed, enforce_v1_count=True)
    except (OSError, ValueError, KeyError, TypeError, AttributeError, RuntimeError):
        raise RuntimeError("WORK_QUEUE_INVALID: repair controllers/work-board.json; no waiting proof") from None


def _valid_literal_path_segment(segment):
    if "[" not in segment and "]" not in segment:
        return True
    return re.fullmatch(
        r"(?:\[[A-Za-z0-9_-]+\]|\[\.\.\.[A-Za-z0-9_-]+\]|\[\[\.\.\.[A-Za-z0-9_-]+\]\])",
        segment,
    ) is not None


def valid_paths(paths):
    return (isinstance(paths, list) and bool(paths) and all(
        isinstance(p, str) and p.strip() == p and p not in {"", "."}
        and not Path(p).is_absolute() and ".." not in Path(p).parts
        and str(Path(p)) == p and not any(x in p for x in "*?")
        and all(_valid_literal_path_segment(part) for part in Path(p).parts)
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


def _valid_blocker_resolution(board, task):
    resolution = task.get("blocker_resolution")
    if not isinstance(resolution, dict) or resolution.get("status") != "RESOLVED":
        return False
    successor_id = resolution.get("successor_task")
    if not isinstance(successor_id, str) or not successor_id or successor_id == task.get("id"):
        return False
    successor = next((row for row in board["tasks"] if row.get("id") == successor_id), None)
    if (successor is None or successor.get("plan") != task.get("plan")
            or not _strict_blocker_successor_valid(successor)):
        return False
    return (resolution.get("successor_candidate_sha") == successor.get("completion_candidate_sha")
            and resolution.get("receipt") == successor.get("completion_receipt"))


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
    resolution = task.get("blocker_resolution") if isinstance(task.get("blocker_resolution"), dict) else {}
    resolution_status = (
        "RESOLVED" if _valid_blocker_resolution(board, task)
        else "STALE_RESOLUTION" if resolution.get("status") == "RESOLVED"
        else resolution.get("status")
    )
    return {key: task.get(key) for key in (
        "id", "role", "plan", "result", "paths", "acceptance", "blocked_reason"
    )} | {"state": state, "waiting_for": waiting, "conflicts": conflicts,
         "completion_invalidated": completion_invalidated,
         "resolution_status": resolution_status,
         "successor_task": resolution.get("successor_task")}



def blocker_attention(board):
    """Derived unresolved outcomes; neither a second queue nor a permission request."""
    alerts = []
    for task in board["tasks"]:
        view = task_view(board, task)
        if view["state"] != "BLOCKED":
            continue
        resolution = task.get("blocker_resolution", {})
        if not isinstance(resolution, dict):
            resolution = {}
        if _valid_blocker_resolution(board, task):
            continue
        stale_resolution = view.get("resolution_status") == "STALE_RESOLUTION"
        reason = (
            f"Прежний blocker был помечен RESOLVED через successor {view.get('successor_task')}, но его strict completion больше не действует."
            if stale_resolution else task.get("blocked_reason") or (
                "Приёмка результата недействительна" if view["completion_invalidated"] else
                "Не завершены необходимые задачи: " + ", ".join(view["waiting_for"]) if view["waiting_for"] else
                "Заняты файлы: " + ", ".join(view["conflicts"]))
        )
        alerts.append({
            "task_id": task["id"], "outcome": task.get("result", ""), "author": task["role"],
            "reason": reason, "evidence": task.get("blocked_receipt"),
            "resolver": resolution.get("owner", "CONTROLLER"),
            "next_action": (
                "Повторно принять exact successor, уже записанный в blocker_resolution; queue-resolve-blocker не перепривязывает RESOLVED к другому successor."
                if stale_resolution else resolution.get("next_action", "Контроллер должен установить причину и допустимый следующий шаг.")
            ),
            "unblock_when": (
                "Указанный в blocker_resolution exact successor снова имеет валидную strict completion."
                if stale_resolution else resolution.get("unblock_when", "Условие снятия препятствия ещё не установлено.")
            ),
            "resolution_status": view.get("resolution_status") or resolution.get("status", "UNRESOLVED"),
            "delivery_priority": task.get("outcome_kind") == "OWNER_INSTALLABLE_DELIVERY",
            "immediate_chat_notice_required": True,
            "notice_instruction": "Сразу сообщи владельцу в текущем чате: что остановилось, причина, кто устраняет и следующий шаг. Запись JSON не является сообщением. Независимую работу продолжай.",
        })
    return sorted(alerts, key=lambda a: (not a["delivery_priority"], a["task_id"]))


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
    return {"revision": board.get("revision", 0), "tasks": rows,
            "owner_attention": blocker_attention(board)}


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


def _validated_board_text(root, board):
    if board.get("version") != 1:
        raise RuntimeError("WORK_BOARD_V2_LOGICAL_SERIALIZATION_FORBIDDEN")
    load_board(root, candidate=board)
    encoded = json.dumps(board, ensure_ascii=False, indent=2) + "\n"
    if len(encoded.encode("utf-8")) > 262144:
        raise RuntimeError("WORK_QUEUE_INVALID: size")
    return encoded


def _persist_board(root, board, event):
    if board.get("version") == 2:
        try:
            _validate_logical_board(board, enforce_v1_count=False)
        except (ValueError, KeyError, TypeError, AttributeError):
            raise RuntimeError("WORK_QUEUE_INVALID: logical v2 candidate") from None
        return _v2().commit_logical_board(root, board, event)
    encoded = _validated_board_text(root, board)
    path = root / "controllers/work-board.json"
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(encoded, encoding="utf-8")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
    with (root / "controllers/work-board-events.jsonl").open("a") as output:
        output.write(json.dumps(event, ensure_ascii=False) + "\n")
    return event


def write_board(root, board, event):
    now = datetime.now(timezone.utc).isoformat()
    board["revision"] = board.get("revision", 0) + 1
    board["updated_at"] = now
    event = dict(event, at=now, revision=board["revision"])
    return _persist_board(root, board, event)


def claim_task(root, role, identifier=""):
    root = Path(root)
    with (root / (role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        if json.loads((root / (role + ".json")).read_text()).get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no queue claim permitted")
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            _prepare_storage_write(root)
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


def resolve_blocker(root, role, identifier, successor_id, receipt):
    root = Path(root)
    if not isinstance(successor_id, str) or not successor_id or successor_id == identifier:
        raise RuntimeError("WORK_QUEUE_BLOCKER_SUCCESSOR_REQUIRED")
    with (root / (role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        if json.loads((root / (role + ".json")).read_text()).get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no blocker resolution permitted")
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            _prepare_storage_write(root)
            board = load_board(root)
            task = next((row for row in board["tasks"] if row["id"] == identifier), None)
            if task is None or task["role"] != role or task["state"] != "BLOCKED":
                raise RuntimeError("WORK_QUEUE_BLOCKER_OWNER_OR_STATE_INVALID")
            successor = next((row for row in board["tasks"] if row["id"] == successor_id), None)
            if (successor is None or successor["id"] == task["id"]
                    or successor.get("plan") != task.get("plan")
                    or not _strict_blocker_successor_valid(successor)):
                raise RuntimeError("WORK_QUEUE_BLOCKER_SUCCESSOR_NOT_ACCEPTED")
            try:
                proof = Path(receipt).resolve()
                relative = proof.relative_to(root.resolve())
                successor_receipt = Path(successor.get("completion_receipt", "")).resolve()
            except (ValueError, OSError):
                raise RuntimeError("WORK_QUEUE_BLOCKER_RESOLUTION_RECEIPT_INVALID") from None
            if (not proof.is_file() or not relative.parts
                    or relative.parts[0] not in {"logs", "controllers", "artifacts"}
                    or proof != successor_receipt):
                raise RuntimeError("WORK_QUEUE_BLOCKER_RESOLUTION_RECEIPT_INVALID")
            existing = task.get("blocker_resolution")
            if isinstance(existing, dict) and existing.get("status") == "RESOLVED":
                if (_valid_blocker_resolution(board, task)
                        and existing.get("successor_task") == successor_id
                        and existing.get("receipt") == str(proof)):
                    return {"action": "RESOLVE_BLOCKER", "role": role, "task": identifier,
                            "state": "BLOCKED", "resolution_status": "RESOLVED",
                            "successor_task": successor_id, "revision": board["revision"],
                            "idempotent": True, "owner_attention": blocker_attention(board)}
                raise RuntimeError("WORK_QUEUE_BLOCKER_RESOLUTION_ALREADY_SET")
            now = datetime.now(timezone.utc).isoformat()
            task["blocker_resolution"] = {
                "owner": role,
                "next_action": f"Историческая BLOCKED-попытка сохранена; действующий результат — {successor_id}.",
                "unblock_when": f"Уже выполнено принятым successor {successor_id}.",
                "status": "RESOLVED",
                "successor_task": successor_id,
                "successor_candidate_sha": successor["completion_candidate_sha"],
                "receipt": str(proof),
                "resolved_at": now,
            }
            task["updated_at"] = now
            persisted = write_board(root, board, {
                "action": "RESOLVE_BLOCKER", "role": role, "task": identifier,
                "state": "BLOCKED", "resolution_status": "RESOLVED",
                "successor_task": successor_id, "receipt": str(proof),
            })
            return dict(persisted, owner_attention=blocker_attention(board))


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
    result["action_required"] = bool(dirty or result.get("error") or result.get("waiting_invalidated") or result.get("owner_attention") or any(
        t["state"] in {"READY", "IN_PROGRESS"} or t.get("completion_invalidated") for t in result["tasks"]))
    return result


def advance_task(root, role, identifier, state, receipt="", reason="", *, expected_task=None,
                 publication_registration=""):
    root = Path(root)
    if state not in {"IN_PROGRESS", "BLOCKED", "DONE"}:
        raise RuntimeError("WORK_QUEUE_TRANSITION_INVALID")
    if publication_registration and state != "DONE":
        raise RuntimeError("WORK_QUEUE_PUBLICATION_COMPLETION_DONE_ONLY")
    # Same lock order for every writer; no operation waits for a test under lock.
    with (root / (role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        role_state = json.loads((root / (role + ".json")).read_text())
        if role_state.get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no queue transition permitted")
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            _prepare_storage_write(root)
            board = load_board(root)
            task = next((t for t in board["tasks"] if t["id"] == identifier), None)
            if task is None or task["role"] != role:
                raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
            if expected_task is not None and task != expected_task:
                raise RuntimeError("WORK_QUEUE_TASK_DRIFT")
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
                    publication_snapshot = None
                    if publication_registration:
                        candidate_sha, publication_snapshot = _publication_completion_candidate(
                            root, role, task, publication_registration
                        )
                    else:
                        candidate_sha = current_worktree_head()
                    acceptance = _completion_receipt(proof, identifier, candidate_sha)
                    if not _receipt_passes(acceptance):
                        raise RuntimeError("WORK_QUEUE_STRICT_PASS_RECEIPT_REQUIRED")
                    task["completion_receipt"] = str(proof)
                    task["completion_receipt_format"] = COMPLETION_VERSION
                    task["completion_candidate_sha"] = candidate_sha
                    task["completion_receipt_snapshot"] = acceptance
                    if publication_snapshot is not None:
                        task["completion_publication_registration"] = publication_registration
                        task["completion_publication_snapshot"] = publication_snapshot
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
            event = {"at": now, "role": role, "task": identifier, "before": previous,
                     "state": state, "receipt": receipt, "revision": board["revision"]}
            persisted = _persist_board(root, board, event)
            return dict(persisted, owner_attention=blocker_attention(board))


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
        if any(x in path for x in "*?") or not owned(path, role):
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
            _prepare_storage_write(root)
            board = load_board(root)
            task = dict(task)
            task["created_at"] = datetime.now(timezone.utc).isoformat()
            board["tasks"].append(task)
            board["revision"] += 1
            board["updated_at"] = task["created_at"]
            event = {"at": task["created_at"], "role": role, "task": task["id"], "action": "ADD", "revision": board["revision"]}
            return _persist_board(root, board, event)


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
