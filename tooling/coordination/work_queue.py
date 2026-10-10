"""Small shared outcome queue. It records work; it grants no live authority."""
import fcntl
import fnmatch
from contextlib import nullcontext
import hashlib
import importlib.util
import json
import os
import re
import stat
import subprocess
from datetime import datetime, timezone
from pathlib import Path

STATES = {"READY", "IN_PROGRESS", "BLOCKED", "DONE"}
PLAN_IDS = {f"{r}{i:02d}" for r, span in (("A", range(1, 7)), ("B", range(1, 8)), ("C", range(8))) for i in span}
COMPLETION_KIND = "octoport.work-queue-completion"
COMPLETION_VERSION = 1
EVIDENCE_MANIFEST_KIND = "octoport.work-queue-evidence-provenance"
EVIDENCE_MANIFEST_VERSION = 2
EVIDENCE_TRUSTED_SIGNERS_PATH = "docs/development/coordination/INDEPENDENT_EVIDENCE_REVIEW_SIGNERS"
EVIDENCE_SIGNATURE_NAMESPACE = "octoport-operational-evidence-review"
# Independently accepted Git source trust root. This immutable triple is
# installed only through an independently reviewed product source release.
# No real signer source has been authorized: None MUST fail closed.
# Never derive this from editable origin/main, a manifest, logs, or env.
EVIDENCE_ACCEPTED_SOURCE_TRUST_ANCHOR = None
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



def _evidence_task_scope(task):
    """Only explicit read-only results may avoid SOURCE candidate/CI attribution."""
    role = task.get("role")
    paths = task.get("paths")
    return (task.get("evidence_only") is True
            and task.get("execution_class") == "OPERATIONAL_EVIDENCE"
            and task.get("source_publication_authorized") is False
            and task.get("outcome_kind") == "OPERATIONAL_OBSERVATION"
            and role in {"A", "B", "C"}
            and not any(k in task for k in (
                "publication_registration", "completion_publication_registration",
                "completion_publication_snapshot"))
            and task.get("outcome_kind") not in {
                "SOURCE_PUBLICATION", "OWNER_INSTALLABLE_DELIVERY",
                "DEPLOYMENT", "PRODUCTION",
            }
            and type(paths) is list and len(paths) == 1
            and isinstance(paths[0], str)
            and re.fullmatch(r"logs/" + role + r"/[A-Za-z0-9_./-]+/RESULT\.json",
                             paths[0]) is not None
            and ".." not in Path(paths[0]).parts
            and valid_paths(paths))


def _evidence_file(root, relative, prefix, *, max_bytes=65536):
    """Read one bounded regular file inside the exact control-root evidence tree."""
    if (type(relative) is not str or not relative.startswith(prefix)
            or relative.startswith("/") or ".." in Path(relative).parts
            or not re.fullmatch(r"[A-Za-z0-9_./-]+", relative)):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_FILE_INVALID")
    base = Path(root).resolve()
    path = base / relative
    descriptors = []
    try:
        # Open every component relative to a no-follow directory descriptor.
        # A symlink or component-swap cannot redirect the read to private data.
        parent = os.open(base, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        descriptors.append(parent)
        parts = Path(relative).parts
        for part in parts[:-1]:
            parent = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                             dir_fd=parent)
            descriptors.append(parent)
        fd = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=parent)
        descriptors.append(fd)
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise RuntimeError("WORK_QUEUE_EVIDENCE_FILE_INVALID")
        with os.fdopen(os.dup(fd), "rb") as source:
            data = source.read(max_bytes + 1)
        if len(data) > max_bytes:
            raise RuntimeError("WORK_QUEUE_EVIDENCE_FILE_INVALID")
    except OSError:
        raise RuntimeError("WORK_QUEUE_EVIDENCE_FILE_INVALID") from None
    finally:
        for fd in reversed(descriptors):
            os.close(fd)
    return path, data


def _evidence_git(repo, *command):
    # Untrusted GIT_*, LD_* and PATH values may not provide fake source
    # provenance. Read only the local checked-out Git object store via the
    # trusted absolute Git binary and a bounded, minimal environment.
    environment = {
        "PATH": "/usr/bin:/bin",
        "HOME": "/nonexistent",
        "XDG_CONFIG_HOME": "/nonexistent",
        "LC_ALL": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": "/dev/null",
    }
    try:
        result = subprocess.run(["/usr/bin/git", "-C", str(repo), *command],
                                env=environment, capture_output=True,
                                text=True, timeout=5)
    except (OSError, subprocess.SubprocessError):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_INVALID") from None
    if result.returncode:
        raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_INVALID")
    return result.stdout.strip()


def _evidence_source_repo(root):
    """Select Git object provenance from the trusted reader deployment path.

    A/B/C install the reader inside their own Git worktree. The operational
    organization reader is deliberately outside Git. Only its exact managed
    location may consult the accepted sibling main worktree; no receipt,
    manifest or caller-supplied Git path can change this selection.
    """
    root = Path(root).resolve()
    module = Path(__file__).resolve()
    installed_org_reader = root / "controllers/organization/tools/work_queue.py"
    if module == installed_org_reader:
        return root.parent / "octoport-main"
    role_repo = module.parents[2]
    if module == role_repo / "tooling/coordination/work_queue.py":
        return role_repo
    raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_INVALID")


def _evidence_review_signed_payload(manifest):
    """The independently signed tuple cannot be replayed onto another task."""
    identity = {
        "kind": "octoport.independent-operational-evidence-review",
        "version": 1,
        "task_id": manifest["task_id"],
        "role": manifest["role"],
        "source_commit": manifest["source_commit"],
        "source_tree": manifest["source_tree"],
        # These claims are author-editable in MANIFEST.json, so include
        # their entire ordered identity in the independent signature.
        "source_blobs": manifest["source_blobs"],
        "result_path": manifest["result_path"],
        "result_sha256": manifest["result_sha256"],
        "review_path": manifest["review_path"],
        "review_sha256": manifest["review_sha256"],
        "review_signature_path": manifest["review_signature_path"],
        "reviewer_principal": manifest["reviewer_principal"],
        "verdict": "PASS",
    }
    return _canonical_bytes(identity)


def _evidence_verify_issuer(repo, manifest, role, signature):
    """Signer allowlist must be from the already accepted Git source, not logs."""
    principal = manifest["reviewer_principal"]
    if (type(principal) is not str
            or re.fullmatch(r"[ABC]:[A-Za-z0-9_.@+-]{1,64}", principal) is None
            or principal.split(":", 1)[0] == role):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_REVIEW_ISSUER_UNTRUSTED")
    trust_path = EVIDENCE_TRUSTED_SIGNERS_PATH
    trust_blob = next(
        (blob["blob_sha"] for blob in manifest["source_blobs"]
         if blob["path"] == trust_path), None)
    if trust_blob is None:
        raise RuntimeError("WORK_QUEUE_EVIDENCE_REVIEW_ISSUER_UNTRUSTED")
    # A role author can create a self-signed Git commit and change its local
    # origin/main. Only an independently installed accepted source triple
    # grants reviewer public-key authority; local ancestry alone cannot.
    anchor = EVIDENCE_ACCEPTED_SOURCE_TRUST_ANCHOR
    if (type(anchor) is not tuple or len(anchor) != 3
            or any(type(value) is not str for value in anchor)
            or anchor != (manifest["source_commit"], manifest["source_tree"],
                          trust_blob)):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_REVIEW_ISSUER_UNTRUSTED")
    # The immutable accepted Git source pins the public signers blob.
    # No role-local or user-supplied allowlist is a trust root.
    entry = manifest["source_commit"] + ":" + trust_path
    try:
        length = int(_evidence_git(repo, "cat-file", "-s", entry))
        if not 1 <= length <= 8192:
            raise ValueError("unexpected review signers size")
        keys = _evidence_git(repo, "cat-file", "-p", entry).encode()
        if not keys or len(keys) > length:
            raise ValueError("review signers missing")
        keys += b"\n"
        if (len(signature) > 8192
                or not signature.startswith(b"-----BEGIN SSH SIGNATURE-----")
                or not hasattr(os, "memfd_create")):
            raise ValueError("invalid detached signature or verifier")
        signers_fd = os.memfd_create("octoport-published-review-signers", os.MFD_CLOEXEC)
        sig_fd = os.memfd_create("octoport-detached-review-signature", os.MFD_CLOEXEC)
        try:
            os.write(signers_fd, keys)
            os.write(sig_fd, signature)
            os.lseek(signers_fd, 0, os.SEEK_SET)
            os.lseek(sig_fd, 0, os.SEEK_SET)
            verified = subprocess.run(
                [
                    "/usr/bin/ssh-keygen", "-Y", "verify",
                    "-f", f"/proc/self/fd/{signers_fd}", "-I", principal,
                    "-n", EVIDENCE_SIGNATURE_NAMESPACE,
                    "-s", f"/proc/self/fd/{sig_fd}",
                ],
                input=_evidence_review_signed_payload(manifest),
                pass_fds=(signers_fd, sig_fd), capture_output=True, timeout=5,
                env={"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "LC_ALL": "C"},
            )
            if verified.returncode:
                raise ValueError("untrusted reviewer signature")
        finally:
            os.close(signers_fd)
            os.close(sig_fd)
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_REVIEW_ISSUER_UNTRUSTED") from None
    return principal, trust_blob


def _evidence_completion_candidate(root, role, task, manifest_path):
    """Opt-in accepted-source snapshot. Never authorizes a code publication."""
    root = Path(root)
    if task.get("role") != role or not _evidence_task_scope(task):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_SCOPE_INVALID")
    try:
        if Path(manifest_path).is_symlink():
            raise RuntimeError("WORK_QUEUE_EVIDENCE_MANIFEST_INVALID")
        absolute = Path(manifest_path).resolve()
        relative = absolute.relative_to(root.resolve()).as_posix()
    except (TypeError, OSError, ValueError):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_MANIFEST_INVALID") from None
    manifest_file, raw = _evidence_file(root, relative, f"logs/{role}/",
                                         max_bytes=32768)
    try:
        manifest = _strict_json_object(raw)
    except (ValueError, TypeError):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_MANIFEST_INVALID") from None
    if manifest.get("version") != EVIDENCE_MANIFEST_VERSION:
        # v1 hash-only PASS is not an independently issued review.
        raise RuntimeError("WORK_QUEUE_EVIDENCE_REVIEW_ISSUER_UNTRUSTED")
    if set(manifest) != {
        "kind", "version", "task_id", "role", "source_commit", "source_tree",
        "source_blobs", "result_path", "result_sha256", "review_path", "review_sha256",
        "reviewer_principal", "review_signature_path", "review_signature_sha256",
    }:
        raise RuntimeError("WORK_QUEUE_EVIDENCE_MANIFEST_INVALID")
    sha40 = r"[0-9a-f]{40}"
    sha64 = r"[0-9a-f]{64}"
    source = manifest.get("source_commit")
    tree = manifest.get("source_tree")
    if (manifest.get("kind") != EVIDENCE_MANIFEST_KIND
            or type(manifest.get("version")) is not int
            or manifest["version"] != EVIDENCE_MANIFEST_VERSION
            or manifest.get("task_id") != task.get("id")
            or manifest.get("role") != role
            or type(source) is not str or re.fullmatch(sha40, source) is None
            or type(tree) is not str or re.fullmatch(sha40, tree) is None
            or manifest.get("result_path") != task["paths"][0]
            or type(manifest.get("result_sha256")) is not str
            or re.fullmatch(sha64, manifest["result_sha256"]) is None
            or type(manifest.get("review_sha256")) is not str
            or re.fullmatch(sha64, manifest["review_sha256"]) is None
            or type(manifest.get("review_signature_sha256")) is not str
            or re.fullmatch(sha64, manifest["review_signature_sha256"]) is None
            or not isinstance(manifest.get("source_blobs"), list)
            or not 1 <= len(manifest["source_blobs"]) <= 32):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_MANIFEST_INVALID")
    names = []
    for blob in manifest["source_blobs"]:
        if (type(blob) is not dict or set(blob) != {"path", "blob_sha"}
                or type(blob["path"]) is not str
                or re.fullmatch(r"[A-Za-z0-9_./-]+", blob["path"]) is None
                or blob["path"].startswith("/")
                or ".." in Path(blob["path"]).parts
                or type(blob["blob_sha"]) is not str
                or re.fullmatch(sha40, blob["blob_sha"]) is None):
            raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_INVALID")
        names.append(blob["path"])
    if names != sorted(set(names)):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_INVALID")
    result_file, result_raw = _evidence_file(root, manifest["result_path"],
                                              f"logs/{role}/", max_bytes=65536)
    review_file, review_raw = _evidence_file(root, manifest.get("review_path"),
                                              f"logs/{role}/", max_bytes=65536)
    signature_file, signature_raw = _evidence_file(
        root, manifest.get("review_signature_path"), f"logs/{role}/",
        max_bytes=8192,
    )
    if (result_file == review_file or result_file == manifest_file
            or review_file == manifest_file
            or signature_file in {result_file, review_file, manifest_file}
            or not manifest["review_path"].endswith((".json", ".md"))
            or not manifest["review_signature_path"].endswith(".sig")
            or hashlib.sha256(result_raw).hexdigest() != manifest["result_sha256"]
            or hashlib.sha256(review_raw).hexdigest() != manifest["review_sha256"]
            or hashlib.sha256(signature_raw).hexdigest() != manifest["review_signature_sha256"]):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_DRIFT")
    try:
        review_text = review_raw.decode("utf-8")
    except UnicodeDecodeError:
        raise RuntimeError("WORK_QUEUE_EVIDENCE_REVIEW_NOT_BOUND") from None
    verdicts = []
    for line in review_text.splitlines():
        match = re.fullmatch(
            r"(?:#{1,3}\s*)?(?:Вердикт|Verdict)\s*:\s*(PASS|FAIL|REWORK_REQUIRED)",
            line.strip(), flags=re.IGNORECASE)
        if match is not None:
            verdicts.append(match.group(1).upper())
    if (manifest["task_id"] not in review_text
            or manifest["result_sha256"] not in review_text
            or verdicts != ["PASS"]):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_REVIEW_NOT_BOUND")
    repo = _evidence_source_repo(root)
    if (_evidence_git(repo, "cat-file", "-t", source) != "commit"
            or _evidence_git(repo, "rev-parse", source + "^{tree}") != tree):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_INVALID")
    # Additional ancestry check only; mutable origin/main is NOT a root.
    _evidence_git(repo, "merge-base", "--is-ancestor", source, "origin/main")
    for blob in manifest["source_blobs"]:
        git_entry = source + ":" + blob["path"]
        entry = _evidence_git(repo, "ls-tree", source, "--", blob["path"])
        # The Git blob object type alone also accepts symlink mode 120000.
        acceptable = {
            f"100644 blob {blob['blob_sha']}\t{blob['path']}",
            f"100755 blob {blob['blob_sha']}\t{blob['path']}",
        }
        if (entry not in acceptable
                or _evidence_git(repo, "cat-file", "-t", git_entry) != "blob"
                or _evidence_git(repo, "rev-parse", git_entry) != blob["blob_sha"]):
            raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_INVALID")
    reviewer, trust_blob = _evidence_verify_issuer(
        repo, manifest, role, signature_raw)
    snapshot = {
        "evidence_schema_version": EVIDENCE_MANIFEST_VERSION,
        "reviewer_principal": reviewer,
        "signer_trust_blob_sha": trust_blob,
        "review_signature_sha256": manifest["review_signature_sha256"],
        "control_root": str(root.resolve()),
        "manifest_path": str(manifest_file),
        "manifest_sha256": hashlib.sha256(raw).hexdigest(),
        "source_commit": source,
        "result_sha256": manifest["result_sha256"],
        "review_sha256": manifest["review_sha256"],
    }
    return source, snapshot


def _evidence_snapshot_valid(task, expected_root=None):
    snapshot = task.get("completion_evidence_snapshot")
    if snapshot is None:
        return task.get("evidence_only") is not True
    if (task.get("evidence_only") is not True
            or task.get("completion_publication_registration") is not None
            or task.get("completion_publication_snapshot") is not None
            or type(snapshot) is not dict
            or set(snapshot) != {
                "evidence_schema_version", "reviewer_principal",
                "signer_trust_blob_sha", "review_signature_sha256",
                "control_root", "manifest_path", "manifest_sha256", "source_commit",
                "result_sha256", "review_sha256",
            }
            or snapshot.get("evidence_schema_version") != EVIDENCE_MANIFEST_VERSION):
        return False
    try:
        if expected_root is None:
            return False
        root = Path(expected_root).resolve()
        if snapshot["control_root"] != str(root):
            return False
        path = Path(snapshot["manifest_path"]).resolve()
        if not path.is_relative_to(root / "logs"):
            return False
        source, current = _evidence_completion_candidate(
            root, task.get("role"), task, str(path))
        return (source == task.get("completion_candidate_sha")
                and current == snapshot)
    except (RuntimeError, OSError, ValueError, TypeError, KeyError, StopIteration):
        return False


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


def _resource_seal_snapshot_shape_valid(task):
    snap = task.get("completion_resource_seal_snapshot")
    return (task.get("completion_resource_required") is True
            and type(snap) is dict
            and set(snap) == {
                "version", "control_root", "role", "task_id",
                "seal_record_sha256", "delegation_inventory_version",
                "delegation_inventory_attested", "foreign_allocation_count",
                "delegated_publication_registration",
            })


def _resource_seal_snapshot_valid(task, root=None):
    """Fail closed for new governed DONE, without rewriting historical DONE.

    The caller supplies root; a persisted control_root never selects a trusted
    location. This function reads only a canonical atomic resource seal and
    never invokes mutating V2 recovery or acquires locks in reverse order.
    """
    marker = task.get("completion_resource_required")
    snapshot = task.get("completion_resource_seal_snapshot")
    if marker is None and snapshot is None:
        return True  # Exactly the pre-resource-gate historical rows.
    if (marker is not True or type(snapshot) is not dict or root is None
            or task.get("state") != "DONE"):
        return False
    fields = {
        "version", "control_root", "role", "task_id",
        "seal_record_sha256", "delegation_inventory_version",
        "delegation_inventory_attested", "foreign_allocation_count",
        "delegated_publication_registration",
    }
    if set(snapshot) != fields:
        return False
    role, identifier = task.get("role"), task.get("id")
    if (role not in {"A", "B", "C"}
            or not isinstance(identifier, str)
            or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", identifier) is None):
        return False
    count = snapshot.get("foreign_allocation_count")
    issuer = snapshot.get("delegated_publication_registration")
    if (type(snapshot.get("version")) is not int or snapshot["version"] != 1
            or snapshot.get("role") != role or snapshot.get("task_id") != identifier
            or type(snapshot.get("delegation_inventory_version")) is not int
            or snapshot["delegation_inventory_version"] != 1
            or snapshot.get("delegation_inventory_attested") is not True
            or type(count) is not int or count < 0
            or not isinstance(snapshot.get("seal_record_sha256"), str)
            or re.fullmatch(r"[0-9a-f]{64}", snapshot["seal_record_sha256"]) is None):
        return False
    if count == 0:
        if issuer is not None:
            return False
    elif (not isinstance(issuer, str)
          or re.fullmatch(r"[0-9a-f]{64}", issuer) is None
          or issuer != task.get("completion_publication_registration")):
        return False
    try:
        control_root = Path(root).resolve()
        if snapshot.get("control_root") != str(control_root):
            return False
        directory = control_root / "disk-task-completions"
        if directory.is_symlink():
            return False
        target = directory / (role + "--" + identifier + ".json")
        fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            raw = stream.read(65537)
        if len(raw) > 65536 or hashlib.sha256(raw).hexdigest() != snapshot["seal_record_sha256"]:
            return False
        record = _strict_json_object(raw)
        history = record.get("history")
        return (
            type(record.get("version")) is int and record["version"] == 1
            and record.get("role") == role and record.get("task") == identifier
            and record.get("state") == "SEALED"
            and isinstance(history, list) and bool(history)
            and isinstance(history[-1], dict) and history[-1].get("state") == "SEALED"
        )
    except (OSError, TypeError, ValueError, KeyError):
        return False


def _strict_completion_valid(task, root=None):
    if "completion_receipt_format" not in task:
        return (task.get("evidence_only") is not True
                and "completion_resource_required" not in task
                and "completion_resource_seal_snapshot" not in task)
    if (type(task.get("completion_receipt_format")) is not int
            or task.get("completion_receipt_format") != COMPLETION_VERSION):
        return False
    receipt = _completion_receipt(task.get("completion_receipt", ""), task["id"],
                                  task.get("completion_candidate_sha", ""))
    return (_receipt_passes(receipt) and _publication_snapshot_valid(task)
            and _evidence_snapshot_valid(task, expected_root=root)
            and _resource_seal_snapshot_valid(task, root))


def _task_satisfies_dependencies(task, root=None):
    return task["state"] == "DONE" and _strict_completion_valid(task, root)


class _BoardEvaluation:
    """Validation memo scoped to one immutable in-memory board evaluation."""
    def __init__(self, board, root=None):
        self.board = board
        self.root = Path(root).resolve() if root is not None else None
        self._strict = {}
        self._receipts = {}
        self._blocker_successors = {}
        self.done = frozenset(
            task["id"] for task in board["tasks"]
            if task["state"] == "DONE" and self.strict_completion_valid(task)
        )

    def receipt(self, task):
        key = id(task)
        if key not in self._receipts:
            self._receipts[key] = _completion_receipt(
                task.get("completion_receipt", ""), task["id"],
                task.get("completion_candidate_sha", ""),
            )
        return self._receipts[key]

    def strict_completion_valid(self, task):
        key = id(task)
        if key not in self._strict:
            if "completion_receipt_format" not in task:
                valid = (task.get("evidence_only") is not True
                         and "completion_resource_required" not in task
                         and "completion_resource_seal_snapshot" not in task)
            elif (type(task.get("completion_receipt_format")) is not int
                    or task.get("completion_receipt_format") != COMPLETION_VERSION):
                valid = False
            else:
                valid = (_receipt_passes(self.receipt(task))
                         and _publication_snapshot_valid(task)
                         and _evidence_snapshot_valid(task, expected_root=self.root)
                         and _resource_seal_snapshot_valid(task, self.root))
            self._strict[key] = valid
        return self._strict[key]

    def strict_blocker_successor_valid(self, task):
        key = id(task)
        if key not in self._blocker_successors:
            valid = (
                task.get("state") == "DONE"
                and type(task.get("completion_receipt_format")) is int
                and task.get("completion_receipt_format") == COMPLETION_VERSION
                and isinstance(task.get("completion_receipt_snapshot"), dict)
                and self.strict_completion_valid(task)
                and self.receipt(task) == task["completion_receipt_snapshot"]
            )
            self._blocker_successors[key] = valid
        return self._blocker_successors[key]


def _strict_blocker_successor_valid(task, root=None):
    if (task.get("state") != "DONE"
            or type(task.get("completion_receipt_format")) is not int
            or task.get("completion_receipt_format") != COMPLETION_VERSION
            or not isinstance(task.get("completion_receipt_snapshot"), dict)):
        return False
    current = _completion_receipt(
        task.get("completion_receipt", ""), task["id"], task.get("completion_candidate_sha", "")
    )
    return (_strict_completion_valid(task, root)
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
        if "evidence_only" in task and type(task["evidence_only"]) is not bool:
            raise ValueError("evidence-only marker")
        if task.get("evidence_only") is True and (
                task.get("execution_class") != "OPERATIONAL_EVIDENCE"
                or task.get("source_publication_authorized") is not False):
            raise ValueError("evidence-only classified task")
        if task.get("evidence_only") is True and not _evidence_task_scope(task):
            raise ValueError("evidence-only scope")
        evidence = task.get("completion_evidence_snapshot")
        if evidence is not None and (
                task["state"] != "DONE"
                or task.get("evidence_only") is not True
                or type(evidence) is not dict
                or set(evidence) not in (
                    {
                        "control_root", "manifest_path", "manifest_sha256",
                        "source_commit", "result_sha256", "review_sha256",
                    },
                    {
                        "evidence_schema_version", "reviewer_principal",
                        "signer_trust_blob_sha", "review_signature_sha256",
                        "control_root", "manifest_path", "manifest_sha256",
                        "source_commit", "result_sha256", "review_sha256",
                    },
                )):
            raise ValueError("evidence completion provenance shape")
        # Live evidence hash drift is handled by task_view/strict validation,
        # not by rejecting the entire shared board and all unrelated tasks.
        if task["state"] == "DONE" and not task.get("completion_receipt"):
            raise ValueError("completion receipt")
        if ("completion_resource_required" in task
                or "completion_resource_seal_snapshot" in task):
            if task["state"] != "DONE" or not _resource_seal_snapshot_shape_valid(task):
                raise ValueError("resource completion evidence")
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


def _valid_blocker_resolution(board, task, evaluation=None):
    resolution = task.get("blocker_resolution")
    if not isinstance(resolution, dict) or resolution.get("status") != "RESOLVED":
        return False
    successor_id = resolution.get("successor_task")
    if not isinstance(successor_id, str) or not successor_id or successor_id == task.get("id"):
        return False
    successor = next((row for row in board["tasks"] if row.get("id") == successor_id), None)
    if (successor is None or successor.get("plan") != task.get("plan")
            or not (evaluation.strict_blocker_successor_valid(successor) if evaluation
                    else _strict_blocker_successor_valid(successor))):
        return False
    return (resolution.get("successor_candidate_sha") == successor.get("completion_candidate_sha")
            and resolution.get("receipt") == successor.get("completion_receipt"))


def task_view(board, task, evaluation=None, root=None):
    evaluation = evaluation or _BoardEvaluation(board, root=root)
    done = evaluation.done
    waiting = [x for x in task["requires"] if x not in done]
    state = task["state"]
    completion_invalidated = task["state"] == "DONE" and not evaluation.strict_completion_valid(task)
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
        "RESOLVED" if _valid_blocker_resolution(board, task, evaluation)
        else "STALE_RESOLUTION" if resolution.get("status") == "RESOLVED"
        else resolution.get("status")
    )
    return {key: task.get(key) for key in (
        "id", "role", "plan", "result", "paths", "acceptance", "blocked_reason"
    )} | {"state": state, "waiting_for": waiting, "conflicts": conflicts,
         "completion_invalidated": completion_invalidated,
         "resolution_status": resolution_status,
         "successor_task": resolution.get("successor_task")}



def blocker_attention(board, root=None):
    """Derived unresolved outcomes; neither a second queue nor a permission request."""
    return _blocker_attention(board, _BoardEvaluation(board, root=root))


def _blocker_attention(board, evaluation):
    alerts = []
    for task in board["tasks"]:
        view = task_view(board, task, evaluation)
        if view["state"] != "BLOCKED":
            continue
        resolution = task.get("blocker_resolution", {})
        if not isinstance(resolution, dict):
            resolution = {}
        if _valid_blocker_resolution(board, task, evaluation):
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
    evaluation = _BoardEvaluation(board, root=root)
    rows = []
    for task in board["tasks"]:
        if task["state"] == "DONE" and evaluation.strict_completion_valid(task):
            continue
        view = task_view(board, task, evaluation)
        # All claimable work is visible, regardless of its original author.
        if task["role"] == role or view["state"] == "READY":
            rows.append(view)
    return {"revision": board.get("revision", 0), "tasks": rows,
            "owner_attention": _blocker_attention(board, evaluation)}


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


def _semantic_active_count(board, root=None):
    """Count live work from one immutable board evaluation and task_view authority."""
    evaluation = _BoardEvaluation(board, root=root)
    active_states = _v2().ACTIVE_STATES
    count = 0
    for task in board["tasks"]:
        view = task_view(board, task, evaluation)
        if view["state"] in active_states and view["resolution_status"] != "RESOLVED":
            count += 1
    return count


def _enforce_semantic_active_transition(pre_board, post_board, root=None):
    cap = _v2().ACTIVE_TASK_CAP
    pre_count = _semantic_active_count(pre_board, root)
    post_count = _semantic_active_count(post_board, root)
    if (pre_count <= cap and post_count > cap) or (pre_count > cap and post_count > pre_count):
        raise RuntimeError("WORK_QUEUE_SEMANTIC_ACTIVE_TASK_CAP")


def _persist_board(root, board, event):
    if board.get("version") == 2:
        try:
            _validate_logical_board(board, enforce_v1_count=False)
        except (ValueError, KeyError, TypeError, AttributeError):
            raise RuntimeError("WORK_QUEUE_INVALID: logical v2 candidate") from None
        pre_board = load_board(root)
        _enforce_semantic_active_transition(pre_board, board, root)
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
                       and task_view(board, t, root=root)["state"] == "READY"]
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
                    or not _strict_blocker_successor_valid(successor, root)):
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
                if (_valid_blocker_resolution(board, task, _BoardEvaluation(board, root=root))
                        and existing.get("successor_task") == successor_id
                        and existing.get("receipt") == str(proof)):
                    return {"action": "RESOLVE_BLOCKER", "role": role, "task": identifier,
                            "state": "BLOCKED", "resolution_status": "RESOLVED",
                            "successor_task": successor_id, "revision": board["revision"],
                            "idempotent": True, "owner_attention": blocker_attention(board, root=root)}
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
            return dict(persisted, owner_attention=blocker_attention(board, root=root))


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
                 publication_registration="", evidence_provenance="",
                 completion_guard=None, resource_lock=None):
    root = Path(root)
    if state not in {"IN_PROGRESS", "BLOCKED", "DONE"}:
        raise RuntimeError("WORK_QUEUE_TRANSITION_INVALID")
    if publication_registration and state != "DONE":
        raise RuntimeError("WORK_QUEUE_PUBLICATION_COMPLETION_DONE_ONLY")
    if completion_guard is not None and resource_lock is None:
        # A late-only guard cannot protect mutating V2 recovery preflight.
        raise RuntimeError("WORK_QUEUE_RESOURCE_LOCK_REQUIRED_BEFORE_RECOVERY")
    if (state == "DONE" and os.path.lexists(root / "resource-admission.lock")
            and (completion_guard is None or resource_lock is None)):
        # Installed coordination has a native resource lifecycle. Direct
        # unguarded queue writes must not invent a strict DONE outside it.
        raise RuntimeError("WORK_QUEUE_RESOURCE_GUARD_REQUIRED")
    if evidence_provenance and state != "DONE":
        raise RuntimeError("WORK_QUEUE_EVIDENCE_COMPLETION_DONE_ONLY")
    if evidence_provenance and publication_registration:
        raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_PUBLISH_CONFLICT")
    # Same lock order for every writer; no operation waits for a test under lock.
    with (root / (role + ".lock")).open("a+") as role_lock:
        fcntl.flock(role_lock, fcntl.LOCK_EX)
        role_state = json.loads((root / (role + ".json")).read_text())
        if role_state.get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no queue transition permitted")
        with (root / "controllers/coordination.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            # Native queue recovery is potentially mutating. It must run
            # after role+coordination and inside resource admission lock,
            # not before the later completion callback.
            resource_scope = resource_lock() if resource_lock is not None else nullcontext()
            with resource_scope:
                _prepare_storage_write(root)
                board = load_board(root)
                task = next((t for t in board["tasks"] if t["id"] == identifier), None)
                if task is None or task["role"] != role:
                    raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
                if expected_task is not None and task != expected_task:
                    raise RuntimeError("WORK_QUEUE_TASK_DRIFT")
                invalidated_done = task["state"] == "DONE" and not _strict_completion_valid(task, root)
                legacy_done = task["state"] == "DONE" and "completion_receipt_format" not in task
                if task["state"] == "DONE" and not (state == "IN_PROGRESS" and (invalidated_done or legacy_done)):
                    raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
                if task["state"] != "DONE" and state == "IN_PROGRESS" and invalidated_done:
                    raise RuntimeError("WORK_QUEUE_TASK_OWNER_OR_STATE_INVALID")
                view = task_view(board, task, root=root)
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
                        evidence_snapshot = None
                        if evidence_provenance:
                            candidate_sha, evidence_snapshot = _evidence_completion_candidate(
                                root, role, task, evidence_provenance)
                        elif publication_registration:
                            if task.get("evidence_only") is True:
                                raise RuntimeError("WORK_QUEUE_EVIDENCE_SOURCE_PUBLISH_CONFLICT")
                            candidate_sha, publication_snapshot = _publication_completion_candidate(
                                root, role, task, publication_registration)
                        else:
                            if task.get("evidence_only") is True:
                                raise RuntimeError("WORK_QUEUE_EVIDENCE_PROVENANCE_REQUIRED")
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
                        if evidence_snapshot is not None:
                            task["completion_evidence_snapshot"] = evidence_snapshot
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
                # External resource integrity must be committed under the same
                # native role -> coordination -> resource lock order. The callback
                # cannot be invoked before the task, issuer and receipt gates pass.
                guard = (completion_guard(previous, task)
                         if completion_guard is not None else nullcontext())
                with guard:
                    if (state == "DONE"
                            and os.path.lexists(root / "resource-admission.lock")
                            and not _resource_seal_snapshot_valid(task, root)):
                        raise RuntimeError("WORK_QUEUE_RESOURCE_SEAL_ATTESTATION_REQUIRED")
                    persisted = _persist_board(root, board, event)
            # Derived readers may themselves inspect resource provenance.
            # They cannot re-acquire an already held resource flock.
            return dict(persisted, owner_attention=blocker_attention(board, root=root))


def add_task(root, role, task, repo_root=None):
    """A dialogue decomposes any approved PLAN outcome without controller handoff."""
    root = Path(root)
    if not isinstance(task, dict) or task.get("role") != role or task.get("state") != "READY":
        raise RuntimeError("WORK_QUEUE_ADD_OWNER_OR_STATE_INVALID")
    if not all(isinstance(task.get(k), list) and task[k] and all(isinstance(x, str) and x.strip() for x in task[k]) for k in ("paths", "acceptance")):
        raise RuntimeError("WORK_QUEUE_PATHS_AND_ACCEPTANCE_REQUIRED")
    if not valid_paths(task["paths"]):
        raise RuntimeError("WORK_QUEUE_PATHS_INVALID")
    if "evidence_only" in task and type(task["evidence_only"]) is not bool:
        raise RuntimeError("WORK_QUEUE_EVIDENCE_MARKER_INVALID")
    if task.get("evidence_only") is True and (
            task.get("execution_class") != "OPERATIONAL_EVIDENCE"
            or task.get("source_publication_authorized") is not False):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_CLASSIFICATION_REQUIRED")
    if task.get("evidence_only") is True and not _evidence_task_scope(task):
        raise RuntimeError("WORK_QUEUE_EVIDENCE_SCOPE_INVALID")
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
