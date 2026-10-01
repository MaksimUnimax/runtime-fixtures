"""Evidence gate for whole-stream waiting; does not schedule or grant authority."""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from work_queue import assert_no_ready_work, board_snapshot

PLAN_IDS = {
    "A": {f"A{i:02d}" for i in range(1, 7)},
    "B": {f"B{i:02d}" for i in range(1, 8)},
    "C": {f"C{i:02d}" for i in range(0, 8)},
}
ALL_PLAN_IDS = set().union(*PLAN_IDS.values())
PLAN_IDS = {role: set(ALL_PLAN_IDS) for role in "ABC"}
STATES = {"READY", "IN_PROGRESS", "BLOCKED", "DONE", "DEFERRED_BY_OWNER"}


def text(value):
    return isinstance(value, str) and bool(value.strip())


def validate_waiting_receipt(role, receipt, head, now=None, inputs_root=None):
    if not receipt:
        raise RuntimeError("WAITING_REQUIRES_QUEUE_RECEIPT: scan all PLAN tasks")
    path = Path(receipt)
    try:
        with path.open("rb") as source:
            raw = source.read(131073)
        if len(raw) > 131072:
            raise ValueError("too large")
        data = json.loads(raw)
    except (OSError, ValueError):
        raise RuntimeError("WAITING_QUEUE_RECEIPT_INVALID") from None
    if not isinstance(data, dict) or data.get("version") != 1 or data.get("role") != role:
        raise RuntimeError("WAITING_QUEUE_IDENTITY_INVALID")
    if data.get("head") != head:
        raise RuntimeError("WAITING_QUEUE_HEAD_STALE: rescan current code and handoffs")
    try:
        checked = datetime.fromisoformat(data["checked_at"])
        if checked.tzinfo is None:
            raise ValueError("timezone required")
        age = ((now or datetime.now(timezone.utc)) - checked).total_seconds()
    except (KeyError, TypeError, ValueError):
        raise RuntimeError("WAITING_QUEUE_TIME_INVALID") from None
    if not 0 <= age <= 1800:
        raise RuntimeError("WAITING_QUEUE_SCAN_STALE: refresh within 30 minutes")
    entries = data.get("entries")
    if not isinstance(entries, list) or not entries:
        raise RuntimeError("WAITING_QUEUE_ENTRIES_REQUIRED")
    covered, ids, ready = set(), set(), []
    for item in entries:
        if not isinstance(item, dict):
            raise RuntimeError("WAITING_QUEUE_ENTRY_INVALID")
        identifier, plan, state = item.get("id"), item.get("plan"), item.get("state")
        if not text(identifier) or identifier in ids or not text(plan) or plan not in PLAN_IDS[role] or not text(state) or state not in STATES:
            raise RuntimeError("WAITING_QUEUE_ENTRY_INVALID")
        if not text(item.get("outcome")):
            raise RuntimeError("WAITING_QUEUE_OUTCOME_REQUIRED")
        ids.add(identifier)
        covered.add(plan)
        if state in {"READY", "IN_PROGRESS"}:
            ready.append(identifier)
            continue
        evidence = item.get("evidence")
        if not isinstance(evidence, list) or not evidence or not all(text(x) for x in evidence):
            raise RuntimeError("WAITING_QUEUE_EVIDENCE_REQUIRED")
        if state == "BLOCKED":
            if not all(text(item.get(k)) for k in ("blocked_action", "owner", "unblock_when")):
                raise RuntimeError("WAITING_QUEUE_DEPENDENCY_REQUIRED")
            if item.get("independent_work_complete") is not True:
                raise RuntimeError("WAITING_INDEPENDENT_WORK_REMAINS: " + identifier)
    if covered != PLAN_IDS[role]:
        raise RuntimeError("WAITING_QUEUE_INCOMPLETE: " + ",".join(sorted(PLAN_IDS[role] - covered)))
    if ready:
        raise RuntimeError("WAITING_READY_TASKS_REMAIN: " + ",".join(ready))
    work_board = None
    if inputs_root is not None:
        work_board = board_snapshot(inputs_root)
        if data.get("work_board") != work_board:
            raise RuntimeError("WAITING_WORK_BOARD_CHANGED_OR_MISSING_PROOF")
        assert_no_ready_work(inputs_root, role)
        if board_snapshot(inputs_root) != work_board:
            raise RuntimeError("WAITING_WORK_BOARD_CHANGED_DURING_SCAN")
    input_count = validate_input_freshness(role, checked, inputs_root) if inputs_root is not None else None
    return {
        "input_files_checked": input_count, "work_board": work_board,
        "path": str(path.resolve()), "sha256": hashlib.sha256(raw).hexdigest(),
        "head": head, "checked_at": data["checked_at"], "entry_count": len(entries),
    }

def validate_input_freshness(role, checked, control_root):
    root = Path(control_root)
    groups = [
        (root / "controller-notices", role + "-*.json"),
        (root / "peer-handoffs" / role, "*.json"),
        (root / "inbox", "*.json"),
        (root / "operator" / "feedback", "*.json"),
    ]
    changed = []
    checked_count = 0
    try:
        board = root / "controllers/work-board.json"
        if board.exists() and board.stat().st_mtime > checked.timestamp():
            changed.append("controllers/work-board.json")
        for directory, pattern in groups:
            for path in directory.glob(pattern):
                stat = path.stat()
                checked_count += 1
                if stat.st_mtime > checked.timestamp():
                    changed.append(str(path.relative_to(root)))
    except OSError:
        raise RuntimeError("WAITING_QUEUE_INPUT_SCAN_FAILED: cannot prove unchanged inputs") from None
    if changed:
        raise RuntimeError("WAITING_QUEUE_INPUT_CHANGED: rescan current inputs: " +
                           ",".join(sorted(changed)[:5]))
    return checked_count
