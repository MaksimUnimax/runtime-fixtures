"""Atomic operator candidate records. No builds, execution, or live authority."""
import argparse
import fcntl
import hashlib
import json
import os
import re
import zipfile
from urllib.parse import urlsplit
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


def _packaged_target(record):
    """Read the inert JSON build header, never execute code from the archive."""
    try:
        with zipfile.ZipFile(record["artifact_path"]) as archive:
            for name in ("manifest.json", "service_worker.js"):
                if archive.namelist().count(name) != 1 or archive.getinfo(name).file_size > 16 * 1024 * 1024:
                    raise ValueError("ambiguous or oversized package member")
            manifest = json.loads(archive.read("manifest.json"))
            source = archive.read("service_worker.js").decode("utf-8")
        prefix = "globalThis.__SELLER_AGENTS_PACKAGED_CONFIG__="
        if not source.startswith(prefix):
            raise ValueError("packaged target missing")
        encoded, end = json.JSONDecoder().raw_decode(source[len(prefix):])
        if not isinstance(encoded, str) or not source[len(prefix) + end:].startswith(";"):
            raise ValueError("invalid packaged target")
        target = json.loads(encoded)
        origin = urlsplit(target["controlApiOrigin"])
        if target["extensionVersion"] != record["version"] or manifest["version"] != record["version"] or target["environment"] != record["environment"] or target["contractVersion"] not in {"control_plane_v2", "control_plane_v3"} or origin.scheme != "https" or not origin.netloc or origin.username or origin.password or origin.path or origin.query or origin.fragment:
            raise ValueError("package target mismatch")
        return target
    except (OSError, ValueError, KeyError, TypeError, UnicodeError, zipfile.BadZipFile):
        raise ValueError("RELEASE_ACCEPTANCE_PACKAGED_TARGET_INVALID") from None


def _release_acceptance(record, review_path):
    """Require reviewed target-server and installed evidence before manual delivery.

    This binds recorded evidence; it neither creates live authority nor performs
    authentication. Independent review still evaluates the underlying results.
    """
    ref = record.get("release_acceptance")
    if not isinstance(ref, dict) or set(ref) != {"path", "sha256"}:
        raise ValueError("RELEASE_ACCEPTANCE_REQUIRED")
    path = Path(ref.get("path", ""))
    if not path.is_absolute() or not re.fullmatch(r"[0-9a-f]{64}", ref.get("sha256", "")):
        raise ValueError("RELEASE_ACCEPTANCE_REFERENCE_INVALID")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != ref["sha256"]:
        raise ValueError("RELEASE_ACCEPTANCE_HASH_MISMATCH")
    proof = json.loads(raw)
    if not isinstance(proof, dict) or proof.get("kind") != "octoport.operator-release-acceptance" or proof.get("schema_version") != 1 or proof.get("verdict") != "PASS":
        raise ValueError("RELEASE_ACCEPTANCE_INVALID")
    for key in ("artifact_sha256", "source_sha", "version", "environment"):
        if proof.get(key) != record.get(key):
            raise ValueError("RELEASE_ACCEPTANCE_IDENTITY_MISMATCH:" + key)
    packaged = _packaged_target(record)
    if proof.get("contract_version") != packaged["contractVersion"] or proof.get("control_api_origin") != packaged["controlApiOrigin"]:
        raise ValueError("RELEASE_ACCEPTANCE_TARGET_MISMATCH")
    if proof.get("delivery_scope") != record.get("delivery_scope") or proof.get("browser") != record.get("browser"):
        raise ValueError("RELEASE_ACCEPTANCE_SCOPE_MISMATCH")
    try:
        checked_at = datetime.fromisoformat(proof["checked_at"].replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - checked_at).total_seconds()
    except (KeyError, TypeError, AttributeError, ValueError):
        raise ValueError("RELEASE_ACCEPTANCE_TIME_INVALID") from None
    if not 0 <= age <= 24 * 60 * 60:
        raise ValueError("RELEASE_ACCEPTANCE_STALE")
    review = _read(review_path)
    reviewed = review.get("evidence_refs", [])
    if ref not in reviewed:
        raise ValueError("RELEASE_ACCEPTANCE_NOT_REVIEWED")
    checks = proof.get("checks")
    required = {"server_catalog", "installed_authentication", "installed_start"}
    if not isinstance(checks, dict) or set(checks) != required:
        raise ValueError("RELEASE_ACCEPTANCE_CHECKS_REQUIRED")
    for name in sorted(required):
        result = checks[name]
        if not isinstance(result, dict) or result.get("status") != "PASS":
            raise ValueError("RELEASE_ACCEPTANCE_CHECK_FAILED:" + name)
        evidence = result.get("evidence")
        if not isinstance(evidence, dict) or set(evidence) != {"path", "sha256"} or evidence not in reviewed:
            raise ValueError("RELEASE_ACCEPTANCE_CHECK_NOT_REVIEWED:" + name)
        if not isinstance(evidence.get("path"), str) or not Path(evidence["path"]).is_absolute():
            raise ValueError("RELEASE_ACCEPTANCE_CHECK_REFERENCE_INVALID:" + name)
        if hashlib.sha256(Path(evidence["path"]).read_bytes()).hexdigest() != evidence.get("sha256"):
            raise ValueError("RELEASE_ACCEPTANCE_CHECK_HASH_MISMATCH:" + name)
    catalog = checks["server_catalog"]
    if catalog.get("target_contract_version") != packaged["contractVersion"] or catalog.get("control_api_origin") != packaged["controlApiOrigin"] or catalog.get("target_version") != record["version"] or catalog.get("target_artifact_sha256") != record["artifact_sha256"] or catalog.get("release_present") is not True or catalog.get("extension_status") not in {"SUPPORTED", "UPDATE_RECOMMENDED"} or catalog.get("browser_status") != "SUPPORTED" or catalog.get("profile_status") != "RESOLVED":
        raise ValueError("RELEASE_ACCEPTANCE_CATALOG_INCOMPATIBLE")
    auth = checks["installed_authentication"]
    if auth.get("control_plane") != "TARGET_SERVER" or auth.get("method") != "NORMAL_DEVICE_FLOW" or auth.get("authenticated") is not True:
        raise ValueError("RELEASE_ACCEPTANCE_REAL_AUTH_REQUIRED")
    start = checks["installed_start"]
    if start.get("exact_installed_artifact") is not True or start.get("work_allowed") is not True or start.get("start_outcome") != "STARTED" or start.get("finish_outcome") != "FINISHED":
        raise ValueError("RELEASE_ACCEPTANCE_INSTALLED_START_REQUIRED")
    return {"path": str(path), "sha256": ref["sha256"], "checked_at": proof["checked_at"]}


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
                "delivery_scope", "backend_revision_or_contract", "checked_scenarios", "limitations",
                "release_acceptance", "fixes_feedback_ids"))
            if previous != target or material_change:
                decision = _decision(review_path, proposal, actor, {"PASS"})
                decision["release_acceptance"] = _release_acceptance(proposal, review_path)
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
