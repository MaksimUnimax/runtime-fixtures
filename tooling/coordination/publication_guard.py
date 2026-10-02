"""Validate publication evidence without granting live deployment authority."""
import json
import time
from pathlib import Path
from ci_gate import REQUIRED


def validate_ci_payload(ci, head, branch, now=None, max_age_seconds=1800):
    if not isinstance(ci, dict):
        raise RuntimeError("MAIN_FRESH_EXACT_CI_REQUIRED")
    age = (time.time() if now is None else now) - ci.get("checked_at", 0)
    if (
        ci.get("status") != "PASS"
        or ci.get("head") != head
        or ci.get("branch") != branch
        or age < 0
        or age > max_age_seconds
    ):
        raise RuntimeError("MAIN_FRESH_EXACT_CI_REQUIRED")
    runs = ci.get("runs", [])
    if (
        not isinstance(runs, list)
        or len(runs) != len(REQUIRED)
        or {r.get("name") for r in runs} != set(REQUIRED)
        or any(
            r.get("status") != "completed" or r.get("conclusion") != "success"
            for r in runs
        )
    ):
        raise RuntimeError("MAIN_ALL_FIVE_CI_REQUIRED")
    return ci


def validate_main_receipt(control_root, role, head, base, branch, now=None):
    """Validate the legacy fixed-role main-ready receipt."""
    root = Path(control_root)
    state_path = root / (role + ".json")
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    if state.get("status") == "STOPPED":
        raise RuntimeError("STOPPED: no publication permitted")
    if state.get("status") not in {"RUNNING", "WAITING_INPUT"}:
        raise RuntimeError("MAIN_ROLE_STATE_UNVERIFIED")
    path = root / ("main-ready-" + role + ".json")
    ready = json.loads(path.read_text()) if path.exists() else {}
    if (
        ready.get("role") != role
        or ready.get("head") != head
        or ready.get("base") != base
        or not ready.get("evidence")
    ):
        raise RuntimeError("MAIN_EXACT_ROLE_HEAD_BASE_RECEIPT_REQUIRED")
    validate_ci_payload(ready.get("ci", {}), head, branch, now=now)
    return ready
