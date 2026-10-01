"""Atomic operator candidate records. No builds, execution, or live authority."""
import argparse
import fcntl
import hashlib
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

ROLES = {"A", "B", "C"}
STATES = {"PREPARING", "READY_FOR_OPERATOR", "WITHDRAWN"}
IDENTITY = ("candidate_id", "version", "source_sha", "artifact_path",
            "artifact_sha256", "artifact_bytes", "browser", "environment",
            "work_item_id")


def _read(path):
    return json.loads(Path(path).read_text())


def _write(path, value):
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def _validate(record, check_bytes=False):
    if not isinstance(record, dict):
        raise ValueError("CANDIDATE_OBJECT_REQUIRED")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}", record.get("candidate_id", "")):
        raise ValueError("CANDIDATE_ID_INVALID")
    if record.get("responsible_role") not in ROLES or not record.get("work_item_id"):
        raise ValueError("DELIVERY_OWNER_AND_TASK_REQUIRED")
    if record.get("readiness") not in STATES:
        raise ValueError("CANDIDATE_READINESS_INVALID")
    if not re.fullmatch(r"[0-9a-f]{64}", record.get("artifact_sha256", "")):
        raise ValueError("ARTIFACT_HASH_REQUIRED")
    if not re.fullmatch(r"[0-9a-f]{40}", record.get("source_sha", "")):
        raise ValueError("SOURCE_SHA_REQUIRED")
    for key in ("version", "browser", "environment", "artifact_path"):
        if not isinstance(record.get(key), str) or not record[key].strip():
            raise ValueError("CANDIDATE_IDENTITY_INCOMPLETE")
    if type(record.get("artifact_bytes")) is not int or record["artifact_bytes"] <= 0:
        raise ValueError("ARTIFACT_SIZE_REQUIRED")
    for key in ("evidence_refs", "checked_scenarios", "limitations"):
        if not isinstance(record.get(key), list) or not all(isinstance(x, str) for x in record[key]):
            raise ValueError("CANDIDATE_LIST_INVALID:" + key)
    if check_bytes:
        path = Path(record["artifact_path"])
        if not path.is_absolute() or path.stat().st_size != record["artifact_bytes"]:
            raise ValueError("ARTIFACT_SIZE_MISMATCH")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
        if digest.hexdigest() != record["artifact_sha256"]:
            raise ValueError("ARTIFACT_HASH_MISMATCH")


def inspect(root):
    directory = Path(root) / "operator/candidates"
    active = {}
    for path in sorted(directory.glob("*.json")):
        record = _read(path)
        if record.get("readiness") == "WITHDRAWN":
            continue
        _validate(record)
        key = record["artifact_sha256"]
        if key in active:
            raise ValueError("DUPLICATE_ACTIVE_ARTIFACT:" + key)
        active[key] = record
    return list(active.values())




def _has_active_artifact_duplicate(root, current_path, artifact_sha256):
    directory = Path(root) / "operator/candidates"
    current_path = Path(current_path)
    for candidate_path in sorted(directory.glob("*.json")):
        if candidate_path == current_path:
            continue
        candidate = _read(candidate_path)
        if candidate.get("readiness") == "WITHDRAWN":
            continue
        if candidate.get("artifact_sha256") != artifact_sha256:
            continue
        _validate(candidate)
        return True
    return False

def _locked(root):
    directory = Path(root) / "operator"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "candidates").mkdir(exist_ok=True)
    lock = (directory / "records.lock").open("a+")
    fcntl.flock(lock, fcntl.LOCK_EX)
    return lock


def register(root, actor, proposal):
    """Re-registration returns the canonical record; never resets its status."""
    _validate(proposal, check_bytes=True)
    if actor not in ROLES or proposal["responsible_role"] != actor:
        raise ValueError("DELIVERY_OWNER_MISMATCH")
    with _locked(root):
        records = inspect(root)
        for existing in records:
            if existing["artifact_sha256"] == proposal["artifact_sha256"]:
                if any(existing[k] != proposal[k] for k in ("version", "source_sha", "artifact_bytes")):
                    raise ValueError("ARTIFACT_IDENTITY_CONFLICT")
                return existing
        for historical in (Path(root) / "operator/candidates").glob("*.json"):
            previous = _read(historical)
            if previous.get("artifact_sha256") == proposal["artifact_sha256"] and previous.get("readiness") == "WITHDRAWN":
                raise ValueError("WITHDRAWN_ARTIFACT_REQUIRES_NEW_REVIEW")
        if proposal["readiness"] != "PREPARING":
            raise ValueError("NEW_CANDIDATE_REQUIRES_REVIEW_TRANSITION")
        path = Path(root) / "operator/candidates" / (proposal["candidate_id"] + ".json")
        if path.exists():
            raise ValueError("CANDIDATE_ID_ALREADY_USED")
        _write(path, proposal)
        return proposal


def _decision(path, record, actor, verdicts):
    if not path:
        raise ValueError("EXACT_REVIEW_REQUIRED")
    review_bytes = Path(path).read_bytes()
    value = json.loads(review_bytes)
    if not isinstance(value, dict) or value.get("verdict") not in verdicts:
        raise ValueError("REVIEW_VERDICT_INVALID")
    if value.get("artifact_sha256") != record["artifact_sha256"]:
        raise ValueError("REVIEW_ARTIFACT_MISMATCH")
    if value.get("author_role") != actor or value.get("reviewer_role") not in ROLES | {"CONTROLLER", "INDEPENDENT_CODEX"} or value["reviewer_role"] == actor:
        raise ValueError("INDEPENDENT_REVIEW_REQUIRED")
    scope = record.get("delivery_scope")
    if not isinstance(scope, list) or not scope or value.get("delivery_scope") != scope:
        raise ValueError("REVIEW_DELIVERY_SCOPE_MISMATCH")
    refs = value.get("evidence_refs")
    if not isinstance(refs, list) or not refs:
        raise ValueError("REVIEW_EVIDENCE_REQUIRED")
    for ref in refs:
        if not isinstance(ref, dict) or not isinstance(ref.get("path"), str):
            raise ValueError("REVIEW_EVIDENCE_INVALID")
        if hashlib.sha256(Path(ref["path"]).read_bytes()).hexdigest() != ref.get("sha256"):
            raise ValueError("REVIEW_EVIDENCE_HASH_MISMATCH")
    return {
        "review_sha256": hashlib.sha256(review_bytes).hexdigest(),
        "verdict": value["verdict"], "artifact_sha256": value["artifact_sha256"],
        "author_role": value["author_role"], "reviewer_role": value["reviewer_role"],
        "delivery_scope": list(scope),
        "evidence_refs": [{"path": r["path"], "sha256": r["sha256"]} for r in refs],
    }


def update(root, actor, proposal, review_path=None):
    _validate(proposal, check_bytes=True)
    with _locked(root):
        path = Path(root) / "operator/candidates" / (proposal["candidate_id"] + ".json")
        current = _read(path)
        if actor != current.get("responsible_role"):
            raise ValueError("ONLY_DELIVERY_OWNER_MAY_UPDATE")
        if any(proposal.get(k) != current.get(k) for k in IDENTITY):
            raise ValueError("CANDIDATE_IDENTITY_IMMUTABLE")
        if current["readiness"] == "WITHDRAWN":
            raise ValueError("WITHDRAWN_HISTORY_IMMUTABLE")
        previous, target = current["readiness"], proposal["readiness"]
        ownership_transfer = proposal.get("responsible_role") != current.get("responsible_role")
        if ownership_transfer:
            if target != previous:
                raise ValueError("OWNERSHIP_TRANSFER_MUST_BE_SEPARATE")
            if any(
                proposal.get(key) != value
                for key, value in current.items()
                if key not in {"responsible_role", "updated_at", "transition_history"}
            ) or any(
                key not in current and key != "updated_at"
                for key in proposal
            ):
                raise ValueError("OWNERSHIP_TRANSFER_MUTATION_FORBIDDEN")
        duplicate_recovery_withdrawal = (
            previous == "PREPARING"
            and target == "WITHDRAWN"
            and _has_active_artifact_duplicate(
                root, path, current["artifact_sha256"]
            )
        )
        if not duplicate_recovery_withdrawal:
            inspect(root)
        elif any(
            proposal.get(key) != value
            for key, value in current.items()
            if key not in {"readiness", "delivery_scope"}
        ) or any(key not in current and key != "delivery_scope" for key in proposal):
            raise ValueError("WITHDRAWAL_RECOVERY_MUTATION_FORBIDDEN")
        decision = None
        if target == "READY_FOR_OPERATOR":
            material_change = any(proposal.get(k) != current.get(k) for k in (
                "delivery_scope", "backend_revision_or_contract", "checked_scenarios", "limitations"))
            if previous != target or material_change:
                decision = _decision(review_path, proposal, actor, {"PASS"})
        if target == "WITHDRAWN":
            decision = _decision(
                review_path,
                proposal if duplicate_recovery_withdrawal else current,
                actor,
                {"FAIL", "REWORK_REQUIRED"},
            )
        elif previous == "READY_FOR_OPERATOR" and target != previous:
            decision = _decision(review_path, current, actor, {"FAIL", "REWORK_REQUIRED"})
        for key in ("evidence_refs", "checked_scenarios"):
            if not set(current[key]).issubset(proposal[key]):
                raise ValueError("ACCEPTED_EVIDENCE_MUST_BE_PRESERVED")
        merged = dict(current, **proposal)
        merged["transition_history"] = current.get("transition_history", [])
        if previous != target or decision is not None or ownership_transfer:
            transition = {
                "previous": previous, "next": target, "actor": actor,
                "review_path": str(review_path) if review_path else None,
                "recorded_at": datetime.now(timezone.utc).isoformat(),
                "review_snapshot": decision}
            if ownership_transfer:
                transition["owner_transfer"] = {
                    "previous": current["responsible_role"],
                    "next": proposal["responsible_role"],
                }
            merged["transition_history"] = merged["transition_history"] + [transition]
        _write(path, merged)
        return merged


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["inspect", "register", "update"])
    parser.add_argument("--root", default="/root/octoport-control")
    parser.add_argument("--actor", choices=sorted(ROLES))
    parser.add_argument("--input")
    parser.add_argument("--review")
    args = parser.parse_args()
    try:
        if args.action == "inspect":
            records = inspect(args.root)
        else:
            if not args.input or not args.actor:
                raise ValueError("ACTOR_AND_INPUT_REQUIRED")
            function = register if args.action == "register" else update
            extra = {} if args.action == "register" else {"review_path": args.review}
            records = [function(args.root, args.actor, _read(args.input), **extra)]
        print(json.dumps([{"candidate_id": r["candidate_id"], "owner": r["responsible_role"],
                           "readiness": r["readiness"], "sha256": r["artifact_sha256"]} for r in records]))
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(2, "CANDIDATE_RECORD_REJECTED:" + str(error) + "\n")


if __name__ == "__main__":
    main()
