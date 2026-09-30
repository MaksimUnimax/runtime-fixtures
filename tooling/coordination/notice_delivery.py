"""Deliver role notices without silently losing an explicit recipient alias."""
import json


def read_controller_notices(directory, role):
    notices = []
    for path in sorted(directory.glob(role + "-*.json")):
        item = json.loads(path.read_text())
        if not isinstance(item, dict):
            raise ValueError(f"NOTICE_OBJECT_REQUIRED: {path.name}")
        if item.get("status") in ("CLOSED", "SUPERSEDED"):
            continue
        recipients = [item[key] for key in ("role", "to") if key in item]
        if not recipients or any(recipient != role for recipient in recipients):
            raise ValueError(f"NOTICE_RECIPIENT_MISMATCH: {path.name}; expected {role}")
        # Legacy controller messages used 'to'. Normalize the read projection
        # only; history on disk and explicit STOP state remain unchanged.
        notices.append({**item, "role": role})
    return notices
