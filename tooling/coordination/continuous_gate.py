"""Cooperative gate for isolated C integration copies; no live authority."""
import json
from pathlib import Path
import sqlite3

from continuous_state import MODEL, check_mode, config, read_json, root, digest, encode


def integration_context(repo, control=Path("/root/octoport-control")):
    repo = Path(repo).resolve()
    marker = Path(control) / "controllers/runtime-mode.json"
    if not marker.exists() or not repo.name.startswith("runtime-integration-"):
        return None
    mode = read_json(marker)
    cfg = config(mode.get("config_path", str(Path(control) / "runtime/config.json")))
    check_mode(cfg, "C")
    identifier = repo.name.removeprefix("runtime-integration-")
    if repo != Path(control) / "worktrees/C" / ("runtime-integration-" + identifier):
        raise RuntimeError("RUNTIME_INTEGRATION_PATH_INVALID")
    context = read_json(root(cfg) / "integrations" / identifier / "context.json")
    with sqlite3.connect("file:" + str(root(cfg) / "state.sqlite") + "?mode=ro", uri=True) as conn:
        row = conn.execute("SELECT role,kind,state,spec,result FROM jobs WHERE id=?", (identifier,)).fetchone()
    if not row or row[0:2] != ("C", "integrate") or row[2] not in {"MERGED", "CI_PENDING", "MAIN_PENDING", "INTEGRATING"}:
        raise RuntimeError("RUNTIME_INTEGRATION_JOB_NOT_ACTIVE")
    spec, saved = json.loads(row[3]), json.loads(row[4])
    if (context.get("epoch") != cfg["epoch"] or context.get("job") != identifier
            or context.get("path") != str(repo) or context.get("branch") != saved.get("branch")
            or context.get("candidate") != spec.get("candidate") or saved.get("worktree") != str(repo)):
        raise RuntimeError("RUNTIME_INTEGRATION_CONTEXT_MISMATCH")
    accepted = False
    review_id = saved.get("context_review_job")
    if review_id:
        with sqlite3.connect("file:" + str(root(cfg) / "state.sqlite") + "?mode=ro", uri=True) as conn:
            peer = conn.execute("SELECT role,kind,state,spec,result,token FROM jobs WHERE id=?", (review_id,)).fetchone()
        if peer and peer[1:3] == ("integration_review", "DONE"):
            peer_spec, verdict = json.loads(peer[3]), json.loads(peer[4])
            receipt = read_json(root(cfg) / "jobs" / review_id / "adapter-receipt.json")
            accepted = (peer[0] not in {"C", peer_spec["source_author"]}
                        and peer_spec["integration_job"] == identifier
                        and peer_spec["identity"]["candidate_sha"] == saved.get("head")
                        and peer_spec["epoch"] == cfg["epoch"] and verdict["verdict"] == "ACCEPT"
                        and receipt.get("model") == MODEL and receipt.get("role") == peer[0]
                        and receipt.get("job") == review_id and receipt.get("kind") == "integration_review"
                        and receipt.get("worktree") == peer_spec.get("worktree")
                        and receipt.get("token") == peer[5] and receipt.get("adapter_status") == "RESULT_VALIDATED"
                        and receipt.get("result_sha256") == digest(encode(verdict)))
    return {**context, "review_accepted": accepted,
            "ready_path": str(root(cfg) / "integrations" / identifier / "main-ready.json")}


def ready_path(repo, control=Path("/root/octoport-control")):
    context = integration_context(repo, control)
    return Path(context["ready_path"]) if context else Path(control) / "main-ready.json"
