"""Durable state for the opt-in server runtime. No model output grants authority."""
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import time

ROLES = ("A", "B", "C")
MODEL = "gpt-6-luna"
LAUNCHERS = {"A": "/root/.nvm/versions/node/v22.22.2/bin/codex",
             "B": "/usr/local/bin/codex2", "C": "/usr/local/bin/codex3"}
RULES = ("AGENTS.md", "docs/development/coordination/PROTOCOL.md",
         "docs/development/coordination/PLAN.md", "docs/product/SPEC.md",
         "docs/development/coordination/OWNERSHIP.json",
         "docs/development/coordination/RESOURCE_POLICY.md",
         "docs/development/coordination/DELIVERY_FLOW_POLICY.md",
         "docs/development/coordination/UNATTENDED_CONTINUATION_POLICY.md")


def encode(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(value if isinstance(value, bytes) else value.encode()).hexdigest()


def read_json(path, limit=1048576):
    with Path(path).open("rb") as source:
        raw = source.read(limit + 1)
    if len(raw) > limit:
        raise RuntimeError("RUNTIME_INPUT_TOO_LARGE")
    def unique(items):
        result = {}
        for key, value in items:
            if key in result:
                raise RuntimeError("RUNTIME_DUPLICATE_JSON_KEY")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp-" + str(os.getpid()))
    fd = os.open(temp, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(fd, "w") as out:
            out.write(encode(value) + "\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temp.unlink(missing_ok=True)


@contextlib.contextmanager
def lock(path, blocking=False):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    handle = path.open("a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | (0 if blocking else fcntl.LOCK_NB))
        yield handle
    finally:
        handle.close()


def birth(pid):
    try:
        return Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def git(repo, *args):
    return subprocess.check_output(["git", *args], cwd=repo, text=True,
                                   stderr=subprocess.PIPE, timeout=60).strip()


def config(path):
    p = Path(path).resolve()
    cfg = read_json(p)
    if cfg.get("version") != 1 or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", cfg.get("epoch", "")):
        raise RuntimeError("RUNTIME_CONFIG_VERSION_OR_EPOCH_INVALID")
    for key in ("control_root", "repo", "requirements"):
        value = Path(cfg.get(key, ""))
        if not value.is_absolute() or value.resolve() != value or not value.exists():
            raise RuntimeError("RUNTIME_CONFIG_PATH_INVALID: " + key)
    if set(cfg.get("enabled_roles", [])) - set(ROLES) or not cfg.get("enabled_roles"):
        raise RuntimeError("RUNTIME_CONFIG_ROLES_INVALID")
    if not 1 <= cfg.get("poll_seconds", 10) <= 60:
        raise RuntimeError("RUNTIME_POLL_BOUND_INVALID")
    if not 60 <= cfg.get("planner_interval_seconds", 1800) <= 86400:
        raise RuntimeError("RUNTIME_PLANNER_INTERVAL_INVALID")
    if not 1 <= cfg.get("job_timeout_seconds", 3600) <= 14400:
        raise RuntimeError("RUNTIME_TIMEOUT_INVALID")
    if not re.fullmatch(r"[0-9a-f]{64}", cfg.get("migration_board_sha256", "")):
        raise RuntimeError("RUNTIME_MIGRATION_SNAPSHOT_REQUIRED")
    cfg["config_path"] = str(p)
    return cfg


def root(cfg):
    return Path(cfg["control_root"]) / "controllers/runtime" / cfg["epoch"]


def db(cfg):
    directory = root(cfg)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    conn = sqlite3.connect(directory / "state.sqlite", isolation_level=None, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA synchronous=FULL")
    conn.execute("PRAGMA busy_timeout=10000")
    conn.executescript("""
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,role TEXT NOT NULL,kind TEXT NOT NULL,
        state TEXT NOT NULL,spec TEXT NOT NULL,created REAL NOT NULL,updated REAL NOT NULL,
        token INTEGER NOT NULL DEFAULT 0,entry_pid INTEGER,entry_birth TEXT,result TEXT,
        reason TEXT,attempts INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY,at REAL NOT NULL,
        job TEXT,event TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,role TEXT,owner TEXT,base TEXT,
        paths TEXT,token_sha256 TEXT,state TEXT,created REAL);
    """)
    return conn


def event(conn, name, job=None, **data):
    conn.execute("INSERT INTO events(at,job,event,data) VALUES(?,?,?,?)",
                 (time.time(), job, name, encode(data)))


def add_job(conn, identifier, role, kind, spec):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,119}", identifier) or role not in ROLES:
        raise RuntimeError("RUNTIME_JOB_ID_OR_ROLE_INVALID")
    existing = conn.execute("SELECT * FROM jobs WHERE id=?", (identifier,)).fetchone()
    if existing:
        if (existing["role"], existing["kind"], existing["spec"]) != (role, kind, encode(spec)):
            raise RuntimeError("RUNTIME_JOB_ID_CONFLICT")
        return False
    now = time.time()
    conn.execute("INSERT INTO jobs(id,role,kind,state,spec,created,updated) VALUES(?,?,?,'READY',?,?,?)",
                 (identifier, role, kind, encode(spec), now, now))
    event(conn, "queued", identifier, role=role, kind=kind)
    return True


def transition(conn, job, state, reason=None, result=None):
    conn.execute("UPDATE jobs SET state=?,reason=?,result=COALESCE(?,result),updated=? WHERE id=?",
                 (state, reason, None if result is None else encode(result), time.time(), job))
    event(conn, state.lower(), job, reason=reason)


def check_mode(cfg, role=None):
    control = Path(cfg["control_root"])
    marker = read_json(control / "controllers/runtime-mode.json")
    if (marker.get("mode") != "continuous-runtime" or marker.get("epoch") != cfg["epoch"]
            or set(marker.get("roles", [])) != set(cfg["enabled_roles"])
            or not marker.get("authorization_receipt")):
        raise RuntimeError("RUNTIME_CUTOVER_MISMATCH")
    if marker.get("stopped"):
        raise RuntimeError("STOPPED: runtime cutover STOP")
    if role is not None:
        if role not in cfg["enabled_roles"]:
            raise RuntimeError("RUNTIME_ROLE_DISABLED")
        state = read_json(control / (role + ".json"))
        if state.get("status") == "STOPPED":
            raise RuntimeError("STOPPED: no new work permitted")
        if state.get("status") not in {"READY", "RUNNING", "WAITING_INPUT"}:
            raise RuntimeError("RUNTIME_ROLE_STATE_UNKNOWN")
    return marker


def rules_snapshot(cfg):
    repo = Path(cfg["repo"])
    return {path: digest((repo / path).read_bytes()) for path in RULES}


def requirements(cfg):
    data = read_json(cfg["requirements"])
    result = {}
    for row in data.get("requirements", []):
        identifier = row.get("id", "")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", identifier) or identifier in result:
            raise RuntimeError("RUNTIME_REQUIREMENT_ID_INVALID")
        if row.get("role") not in ROLES or not row.get("acceptance"):
            raise RuntimeError("RUNTIME_REQUIREMENT_INVALID")
        path = Path(row.get("source", ""))
        if path.is_absolute() or ".." in path.parts or not str(path).startswith("docs/"):
            raise RuntimeError("RUNTIME_REQUIREMENT_SOURCE_INVALID")
        raw = (Path(cfg["repo"]) / path).read_text()
        if not row.get("quote") or row["quote"] not in raw or digest(raw) != row.get("source_sha256"):
            raise RuntimeError("RUNTIME_REQUIREMENT_SOURCE_CHANGED")
        plan = (Path(cfg["repo"]) / "docs/development/coordination/PLAN.md").read_text()
        if not any(line.startswith("| " + row.get("plan", "") + " |") for line in plan.splitlines()):
            raise RuntimeError("RUNTIME_REQUIREMENT_PLAN_INVALID")
        if not row["plan"].startswith(row["role"]):
            raise RuntimeError("RUNTIME_REQUIREMENT_PLAN_OWNER_INVALID")
        result[identifier] = row
    if not result:
        raise RuntimeError("RUNTIME_REQUIREMENTS_EMPTY")
    return result


def validate_task(cfg, task):
    if task.get("boundary") not in (None, "SOURCE"):
        raise RuntimeError("RUNTIME_COLLECTOR_CAPABILITY_NOT_AVAILABLE: SOURCE only")
    req = requirements(cfg).get(task.get("requirement_id"))
    if not req or (task.get("role"), task.get("plan")) != (req["role"], req["plan"]):
        raise RuntimeError("RUNTIME_TASK_REQUIREMENT_MISMATCH")
    if task.get("state") != "READY" or not task.get("basis"):
        raise RuntimeError("RUNTIME_TASK_BASIS_REQUIRED")
    if any(not isinstance(task.get(k), list) or not task[k] for k in ("paths", "acceptance")):
        raise RuntimeError("RUNTIME_TASK_SCOPE_REQUIRED")
    import fnmatch
    policy = read_json(Path(cfg["repo"]) / "docs/development/coordination/OWNERSHIP.json")["roles"]
    def owned(path, role):
        p = policy[role]
        return any(fnmatch.fnmatchcase(path, x) for x in p["allow"]) and not any(fnmatch.fnmatchcase(path, x) for x in p["deny"])
    for path in task["paths"]:
        if (not isinstance(path, str) or not path or Path(path).is_absolute() or ".." in Path(path).parts
                or any(x in Path(path).parts for x in (".git", "node_modules", ".env"))
                or any(x in path for x in "*?[\0") or not owned(path, task["role"])
                or (task["role"] == "C" and any(owned(path, r) for r in "AB"))):
            raise RuntimeError("RUNTIME_TASK_OWNERSHIP_VIOLATION")
    return req


def legacy_write_guard(control, role, action, claim_file=None):
    """Cutover gate for old writers; status/STOP remain available."""
    path = Path(control) / "controllers/runtime-mode.json"
    if not path.exists() or action in {"status", "pause", "resources"}:
        return
    marker = read_json(path)
    if marker.get("mode") == "continuous-runtime" and role in marker.get("roles", []):
        metadata_actions = {"reviewed", "request-review", "request-owner", "owner-done", "checkpoint", "resume"}
        if claim_file and action in metadata_actions:
            proof = read_json(claim_file)
            database = Path(control) / "controllers/runtime" / marker["epoch"] / "state.sqlite"
            with sqlite3.connect("file:" + str(database) + "?mode=ro", uri=True) as conn:
                claim = conn.execute("SELECT role,token_sha256,state FROM claims WHERE id=?", (proof.get("id"),)).fetchone()
            if (claim and claim[0] == role and claim[1] == digest(proof.get("token", ""))
                    and claim[2] == "ACTIVE" and proof.get("epoch") == marker["epoch"]):
                return
            raise RuntimeError("RUNTIME_CLAIM_OWNER_TOKEN_INVALID")
        raise RuntimeError("RUNTIME_OWNS_ROLE: use the runtime queue; legacy writes are disabled")
