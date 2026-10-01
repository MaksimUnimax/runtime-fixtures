"""Cooperative gate for isolated C integration copies; no live authority."""
import json
from pathlib import Path
import sqlite3

from continuous_state import check_mode, config, read_json, root


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
    return {**context, "ready_path": str(root(cfg) / "integrations" / identifier / "main-ready.json")}


def ready_path(repo, control=Path("/root/octoport-control")):
    context = integration_context(repo, control)
    return Path(context["ready_path"]) if context else Path(control) / "main-ready.json"
