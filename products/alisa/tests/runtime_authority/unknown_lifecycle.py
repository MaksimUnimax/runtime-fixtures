#!/usr/bin/env python3
"""Bounded SOURCE qualification of the pinned native UNKNOWN lifecycle.

No live runtime, provider, socket, staff API or installed configuration is used.
The provider, clock and authority are explicitly synthetic. See the companion
scope document; this does not complete AL-N16-03 or AL-T08-03.
"""
from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
from dataclasses import asdict
from hashlib import sha256
import importlib
import io
import json
import os
from pathlib import Path
import re
import resource
import shutil
import signal
import sqlite3
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
from types import ModuleType
from uuid import uuid4

REPO = Path(__file__).resolve().parents[4]
SOURCE_COMMIT = "a4f9746191db765b6498acede3764db5225b3a22"
ARCHIVE = "products/alisa/tests/current_parameters/native_fixture/qualified_core_source.tar.gz"
ARCHIVE_SHA256 = "d1b5a3e0a18749c45025c56c7c74fe32bdb979d788e10f2d416ebd35bd311309"
ARCHIVE_BYTES = 707221
INPUT_SHA256 = {'products/alisa/tests/current_parameters/native_fixture/MANIFEST.json': '44e238b9a03fe5351fabd5a3afe030a53af5d3edf7225f0795478681b2948c55', 'docs/alisa/runtime/v0.11/current_parameters_r4/prepare_candidate.py': '4e769ff756cb0fd68353c83301245b3a9c659147be5168842626304e99fdc321', 'docs/alisa/runtime/v0.11/current_parameters_r4/BASELINE_RUNTIME.json': 'df90f0c20ca595e64badbf2170fba2eef4d470acb61452676958c91f076bf1da', 'docs/alisa/runtime/v0.11/current_parameters_r4/CANDIDATE_HASHES.json': 'c427fcc88d7eba0ca34825b194333bf2965f339d8e90604d1ed99631391e81a4', 'docs/alisa/runtime/v0.11/current_parameters_r5/prepare_candidate.py': 'e79c31d843dc23ae5b00931a8e9edd3cfcaffad3bd20d8230545b3d9bf794bd8', 'docs/alisa/runtime/v0.11/current_parameters_r5/BASELINE_RUNTIME.json': '07d4f648e8a296f10db197f3bad235cd276bcda79c3f8f87346f9db08b86a523', 'docs/alisa/runtime/v0.11/current_parameters_r5/CANDIDATE_HASHES.json': 'e249f92e93b002710404be879adc1458e9fa77059e73fe9c22ecfc6267000960', 'docs/alisa/runtime/v0.11/current_parameters_r4/parameter_source_runtime.py': 'df577cb9c101cd81696cb41ca91335c3b172b514a20df61701fb3f1687f9d40c', 'docs/alisa/runtime/v0.11/current_parameters_r5/parameter_collection_runtime.py': '3f6a175999196f400ae66baf26fa3810806563d13143530b7d99a21fda1be728', 'products/alisa/services/platform/src/alisa_platform/owner_data/parameter_catalog.json': 'a67e52b0f13937250ed27ca1a2c93c95f6cae20f9356481109babb590f2c2aae', 'products/alisa/services/platform/src/alisa_platform/owner_data/parameter_contract.py': '3f700e14f0c95986a46e517d011754a1b38866daba08cf25d082a38b3d90c950', 'products/alisa/services/platform/src/alisa_platform/owner_data/parameter_producers.json': 'd5fe2dfed11ff53dfc5b94013168b8642a5fe2b4dd9734015ac61148f4aa6aac', 'products/alisa/services/platform/src/alisa_platform/owner_data/parameter_producers.py': 'f87f67640131e517c75905d134e5080a8ecc2b360791a69238653c54fd6a93d9'}
CURRENT_CORE_SHA256 = {'engine.py': 'da352a4024dda12c4e7a808f94718f4fc4b4ff57bb6e19c093a6135f2aff85bc', 'legacy_voice.py': '14d4b6b416a0a7bdcc65bab09da484202de213668d9d21e693d805a095af4dd8', 'parameter_collection_runtime.py': '3f6a175999196f400ae66baf26fa3810806563d13143530b7d99a21fda1be728', 'reader_state.py': '0d76d683ac78b10363401d449e9b958936c0aca8c0c12dcacc7275e291006edf', 'repository.py': '17c510e5ddccc8deca022d30b9fef814d83af950a4ef2d791fab13b795805404', 'request_recovery.py': 'ad9ce1249949723fe9bd013b804de24a473fd9bc61609584e32748520f917af5', 'retention.py': '3b88035e38e52da3a313ee1802ed5a0cfcd7799c9674c468dda6578d8926718c', 'runtime.py': 'c3f8f3c0f3fef84bba26564e85cad706434e11cde571cdf26c3af8addad4c4d5', 'runtime_port.py': '560569756de0992aebfe6e23385c992652c6f16c25b0ec6e575c1c3e229a00a9', 'template_clarification.py': '0af1d23eeb5f54a988c5b4cd5f3c51d8910695e6598e6eb9ae8472f4961148dc'}
PREFIX = "alisa-unknown-source-"
PRIVATE_SENTINEL = "SYNTHETIC_PRIVATE_TRANSPORT_DETAIL_7f3c"
NETWORK_ATTEMPTS = []
CHILDREN = []
CHECKS = []
CHILD_OBSERVATIONS = []
QUERY = "Сколько товаров заказали и на какую сумму 2 ноября 2026 на Озоне?"
STANDARD_QUERY = "сводка заказов за октябрь 2026 на озоне"


class QualificationError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise QualificationError(code)


def digest(data):
    return sha256(data).hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()


def regular_bytes(path, limit=8 * 1024 * 1024):
    before = path.lstat()
    need(stat.S_ISREG(before.st_mode) and before.st_size <= limit, "INPUT_FILE_SHAPE")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        opened = os.fstat(fd)
        need((opened.st_dev, opened.st_ino) == (before.st_dev, before.st_ino), "INPUT_MOVED")
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(limit + 1)
        after = os.fstat(fd)
        current = path.lstat()
        identity = lambda st: (st.st_dev, st.st_ino, st.st_size, st.st_mtime_ns, st.st_ctime_ns)
        need(identity(before) == identity(after) == identity(current), "INPUT_MOVED")
        need(len(data) == before.st_size <= limit, "INPUT_LENGTH")
        return data
    finally:
        os.close(fd)


def repo_input(relative):
    part = Path(relative)
    need(not part.is_absolute() and ".." not in part.parts, "INPUT_PATH")
    path = REPO
    for component in part.parts:
        path = path / component
        need(not path.is_symlink(), "INPUT_SYMLINK")
    return path


def input_gate():
    raw = {name: regular_bytes(repo_input(name)) for name in INPUT_SHA256}
    for name, expected in INPUT_SHA256.items():
        need(digest(raw[name]) == expected, "SOURCE_INPUT_PIN")
    archive = regular_bytes(repo_input(ARCHIVE))
    need(len(archive) == ARCHIVE_BYTES and digest(archive) == ARCHIVE_SHA256, "ARCHIVE_PIN")
    manifest = json.loads(raw["products/alisa/tests/current_parameters/native_fixture/MANIFEST.json"])
    need(manifest["archive_sha256"] == ARCHIVE_SHA256 and manifest["archive_bytes"] == ARCHIVE_BYTES,
         "ARCHIVE_MANIFEST")
    expected = dict(manifest["files"])
    for version in ("current_parameters_r4", "current_parameters_r5"):
        expected.update(json.loads(raw["docs/alisa/runtime/v0.11/" + version +
                                       "/CANDIDATE_HASHES.json"])["files"])
    expected["parameter_support/__init__.py"] = digest(b"")
    need(all(expected.get(name) == pin for name, pin in CURRENT_CORE_SHA256.items()), "CORE_EXPECTATION_PIN")
    return raw, archive, manifest, expected


def verify_native(native, expected):
    need(native.is_dir() and not native.is_symlink(), "NATIVE_ROOT")
    files = {}
    for path in native.rglob("*"):
        need(not path.is_symlink(), "NATIVE_SYMLINK")
        if path.is_file():
            files[path.relative_to(native).as_posix()] = digest(regular_bytes(path))
        else:
            need(path.is_dir(), "NATIVE_SPECIAL_FILE")
    need(files == expected, "NATIVE_INVENTORY_OR_PIN")
    need(all(files.get(name) == pin for name, pin in CURRENT_CORE_SHA256.items()), "CURRENT_CORE_PIN")
    return digest(encode(files))


def build_fixture(native, raw, archive, manifest, expected):
    need(not native.exists(), "FIXTURE_ALREADY_EXISTS")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as bundle:
        members = bundle.getmembers()
        need(len(members) == len(manifest["files"]) and
             {entry.name for entry in members} == set(manifest["files"]), "ARCHIVE_INVENTORY")
        data = {}
        for entry in members:
            path = Path(entry.name)
            need(entry.isfile() and not path.is_absolute() and ".." not in path.parts, "ARCHIVE_PATH")
            need(entry.size <= 8 * 1024 * 1024, "ARCHIVE_MEMBER_SIZE")
            stream = bundle.extractfile(entry)
            need(stream is not None, "ARCHIVE_MEMBER")
            value = stream.read(entry.size + 1)
            need(len(value) == entry.size and digest(value) == manifest["files"][entry.name],
                 "ARCHIVE_MEMBER_PIN")
            data[entry.name] = value
    need(sum(map(len, data.values())) <= 16 * 1024 * 1024, "FIXTURE_SIZE")
    for name, expected_pin in manifest["verified_r4_baseline"].items():
        need(digest(data[name]) == expected_pin, "R4_INPUT_PIN")
    native.mkdir(mode=0o700)
    for name, value in data.items():
        path = native / name
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.write_bytes(value)
    # These are existing exact additive fixture overlays, executed only after all
    # their source/data pins were checked. Later R8/R11/R13/R14/R15 are not applied.
    for version in ("current_parameters_r4", "current_parameters_r5"):
        relative = "docs/alisa/runtime/v0.11/" + version + "/prepare_candidate.py"
        module = ModuleType("unknown_fixture_" + version)
        module.__file__ = str(repo_input(relative))
        exec(compile(raw[relative], module.__file__, "exec"), module.__dict__)
        if version == "current_parameters_r4":
            module.prepare(native, repo_input("products/alisa/services/platform/src/alisa_platform/owner_data"))
        else:
            module.prepare(native)
        for name, pin in json.loads(raw["docs/alisa/runtime/v0.11/" + version +
                                        "/CANDIDATE_HASHES.json"])["files"].items():
            need(digest(regular_bytes(native / name)) == pin, "OVERLAY_OUTPUT_PIN")
    source_pin = verify_native(native, expected)
    input_gate()  # Refuse a concurrent input change around the exact overlays.
    for path in native.rglob("*"):
        path.chmod(0o555 if path.is_dir() else 0o444)
    native.chmod(0o555)
    return source_pin


def network_guard(event, arguments):
    if event.startswith("socket.") or event in ("urllib.Request", "http.client.connect"):
        NETWORK_ATTEMPTS.append(event)
        raise QualificationError("NETWORK_FORBIDDEN")


def limits(seconds):
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_AS, (256 * 1024 * 1024, 256 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_CPU, (45, 45))
    resource.setrlimit(resource.RLIMIT_FSIZE, (16 * 1024 * 1024, 16 * 1024 * 1024))
    resource.setrlimit(resource.RLIMIT_NOFILE, (128, 128))
    def deadline(signum, frame):
        raise QualificationError("WALL_DEADLINE")
    signal.signal(signal.SIGALRM, deadline)
    signal.alarm(seconds)


def load_core(native, expected):
    verify_native(native, expected)
    need("repository" not in sys.modules and "engine" not in sys.modules, "PRODUCT_ALREADY_IMPORTED")
    sys.path[:0] = [str(native), str(native / "tests")]
    names = ("repository", "engine", "semantics", "runtime_port", "runtime_port_contract",
             "reader_state", "retention", "template_clarification", "legacy_voice",
             "model_answer", "test_runtime", "test_runtime_port_r01_contract", "test_template_only")
    modules = {name: importlib.import_module(name) for name in names}
    for name, module in modules.items():
        need(Path(module.__file__).resolve().is_relative_to(native), "PRODUCT_IMPORT_SOURCE")
    verify_native(native, expected)
    return modules


def write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as stream:
            stream.write(data)
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def journal(path, operation=None):
    need(path.is_file() and not path.is_symlink(), "JOURNAL_OWNER")
    with sqlite3.connect(path, timeout=2) as connection:
        connection.execute("PRAGMA synchronous=FULL")
        if operation is not None:
            need(operation in ("ozon_orders", "template_select", "template_verify", "model_answer",
                               "synthetic_unsafe_dispatch"), "JOURNAL_OPERATION")
            connection.execute("INSERT INTO sent(operation) VALUES(?)", (operation,))
        rows = connection.execute("SELECT operation,count(*) FROM sent GROUP BY operation").fetchall()
    return dict(rows)


def make_journal(path):
    need(not path.exists(), "JOURNAL_EXISTS")
    with sqlite3.connect(path, timeout=2) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=FULL")
        connection.execute("CREATE TABLE sent(sequence INTEGER PRIMARY KEY,operation TEXT NOT NULL)")


def transport(modules, path, *, template=False, mode="ok"):
    base = modules["test_template_only"].Transport if template else modules["test_runtime"].FakeTransport
    class SyntheticTransport(base):
        def execute(self, request, store):
            journal(path, request.operation)
            if request.operation == "ozon_orders":
                if mode == "lost":
                    raise RuntimeError(PRIVATE_SENTINEL)
                if mode == "crash":
                    need(not NETWORK_ATTEMPTS, "NETWORK_ATTEMPT")
                    os._exit(73)
            return super().execute(request, store)
    return SyntheticTransport()


def rows(repo, query, values=()):
    with repo.connection() as connection:
        return [tuple(row) for row in connection.execute(query, values)]


def job(repo, jid):
    with repo.connection() as connection:
        row = connection.execute("SELECT * FROM jobs WHERE id=?", (jid,)).fetchone()
        need(row is not None, "JOB_MISSING")
        return dict(row)


def expect_rejected(modules, code, action):
    try:
        action()
    except modules["semantics"].Rejected as error:
        need(error.code == code, "UNEXPECTED_REJECTION_CODE")
    else:
        raise QualificationError("MISSING_REJECTION")


def record(name, **observations):
    CHECKS.append({"case": name, "status": "PASS", **observations})


class PortFixture:
    def __init__(self, modules, root, *, create):
        self.modules, self.root = modules, root
        if create:
            root.mkdir(mode=0o700)
            make_journal(root / "sent.sqlite")
        self.clock = modules["test_runtime"].Clock()
        self.repo = modules["repository"].Repository(root / "jobs.sqlite", self.clock)
        self.authority = modules["test_runtime_port_r01_contract"].FakeAuthority(self.clock)
        self.settings = modules["model_answer"].Settings(root / "answer.json")
        self.engine = modules["engine"].Engine(self.repo, lambda _: self.authority.scope,
                                              answer_settings=self.settings, template_mode=True)
        self.port = modules["runtime_port"].RuntimePort(
            self.engine, self.authority, catalog_release_id="fixture-catalog", service_id="fixture-platform")
        self.peer = modules["runtime_port"].Peer("fixture-platform", modules["runtime_port_contract"].PRODUCT)
        if create:
            context = {"tenant_id": str(uuid4()), "actor_id": str(uuid4()), "store_scope": sorted([
                {"store_id": str(uuid4()), "credential_revision": 1, "scope_revision": 1},
                {"store_id": str(uuid4()), "credential_revision": 1, "scope_revision": 1}],
                key=lambda value: value["store_id"]), "security_revision": 1, "access_revision": 1,
                "business_timezone": "Europe/Moscow", "catalog_release_id": "fixture-catalog",
                "runtime_contract_version": "runtime_port_v1", "execution_ticket": "synthetic-placeholder",
                "not_after": modules["runtime_port_contract"].utc(self.clock() + 3600)}
            self.context = self.authority.issue(context)
            self.task = {"schema_version": "runtime_task_v1", "request_id": str(uuid4()),
                         "logical_query_id": str(uuid4()), "trace_id": str(uuid4()),
                         "context": deepcopy(self.context), "query_input": {"kind": "utterance", "text": QUERY}}
            self.receipt = self.port.submit(self.task, self.peer)
            self.jid = rows(self.repo, "SELECT jid FROM rt_job_refs WHERE ref=?",
                            (self.receipt["job_ref"],))[0][0]
            original = job(self.repo, self.jid)
            self.admission = {key: original[key] for key in ("draft", "plan", "key")}
            write_new(root / "case.json", encode({"context": self.context, "task": self.task,
                                               "receipt": self.receipt, "jid": self.jid,
                                               "admission": self.admission}))
        else:
            saved = json.loads(regular_bytes(root / "case.json", 128 * 1024))
            self.context = self.authority.issue(saved["context"])
            self.task, self.receipt, self.jid, self.admission = (
                saved[key] for key in ("task", "receipt", "jid", "admission"))
            self.task = deepcopy(self.task)
            self.task["context"] = deepcopy(self.context)

    def step_until_terminal(self, mode="ok"):
        worker = self.modules["engine"].Worker(
            self.engine, transport(self.modules, self.root / "sent.sqlite", template=True, mode=mode))
        for _ in range(12):
            current = self.repo.get("A", self.jid)
            if current["state"] not in ("QUEUED", "RUNNING"):
                return current
            self.clock.advance(max(0, current["due"] - self.clock()) + 1)
            worker.step()
        raise QualificationError("WORKER_BOUND")


def own_root(path, *, child=False):
    need(path.parent == Path("/tmp") and re.fullmatch(PREFIX + r"[a-z0-9_]{8}", path.name),
         "OWNED_ROOT_PATH")
    info = path.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and
         stat.S_IMODE(info.st_mode) == 0o700, "OWNED_ROOT_METADATA")
    owner = json.loads(regular_bytes(path / "owner.json", 4096))
    need(owner == {"pid": os.getppid() if child else os.getpid(),
                   "script_sha256": digest(regular_bytes(Path(__file__)))}, "OWNED_ROOT_TOKEN")


def child_call(root, case, expected_return):
    own_root(root)
    with tempfile.TemporaryFile() as output:
        process = subprocess.Popen(
            [sys.executable, "-I", "-B", str(Path(__file__).resolve()),
             "--child", case, "--owned-root", str(root)],
            stdin=subprocess.DEVNULL, stdout=output, stderr=output,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"}, close_fds=True,
            start_new_session=True)
        CHILDREN.append(process)
        try:
            result = process.wait(timeout=10)
        except BaseException:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=2)
            raise
        output.seek(0, 2)
        size = output.tell()
        observation = {"case": case, "exit_status": result, "output_bytes": size, "reaped": process.poll() is not None}
        if size and size <= 2048:
            output.seek(0)
            try:
                failure = json.loads(output.read())
                if type(failure) is dict and re.fullmatch(r"[A-Z_]{1,80}", failure.get("code", "")):
                    observation["failure_code"] = failure["code"]
            except (ValueError, UnicodeError):
                pass
        CHILD_OBSERVATIONS.append(observation)
        need(result == expected_return and size == 0, "CHILD_OUTCOME")


def simple_fixture(modules, root, *, create):
    if create:
        root.mkdir(mode=0o700)
        make_journal(root / "sent.sqlite")
    clock = modules["test_runtime"].Clock()
    repo = modules["repository"].Repository(root / "jobs.sqlite", clock)
    engine = modules["engine"].Engine(repo, lambda _: modules["test_runtime"].SCOPE)
    if create:
        answer = engine.submit("A", STANDARD_QUERY, "synthetic-original",
                               modules["semantics"].fingerprint(STANDARD_QUERY), modules["test_runtime"].TODAY)
        write_new(root / "case.json", encode({"jid": answer["job_id"]}))
    jid = json.loads(regular_bytes(root / "case.json", 4096))["jid"]
    return clock, repo, engine, jid


def run_child(case, root, modules):
    if case == "port-lost":
        fixture = PortFixture(modules, root / "port", create=False)
        current = fixture.step_until_terminal("lost")
        need(current["state"] == "UNKNOWN" and current["error"] == "UNEXPECTED_TRANSPORT_OUTCOME",
             "WORKER_UNKNOWN_CAUSE")
        need(journal(root / "port/sent.sqlite") == {"template_select": 1, "ozon_orders": 1},
             "WORKER_SEND_SEQUENCE")
        # The UNKNOWN commit is durable; no acceptance/outcome is returned to the
        # invoking process. This is distinct from an unsafe pre-receipt crash.
        need(not NETWORK_ATTEMPTS, "NETWORK_ATTEMPT")
        os._exit(75)
    clock, repo, engine, jid = simple_fixture(modules, root / case, create=False)
    if case == "unsafe":
        claimed = repo.claim()
        need(claimed["id"] == jid and claimed["resume_safe"] == 0, "UNSAFE_CLAIM")
        repo.reserve(jid, claimed["owner"], "synthetic-unsafe-contract", 0, None)
        journal(root / case / "sent.sqlite", "synthetic_unsafe_dispatch")
        need(not NETWORK_ATTEMPTS, "NETWORK_ATTEMPT")
        os._exit(73)
    need(case == "safe", "CHILD_CASE")
    modules["engine"].Worker(engine, transport(modules, root / case / "sent.sqlite", mode="crash")).step()
    raise QualificationError("CRASH_NOT_REACHED")


def port_checks(modules, root):
    original = PortFixture(modules, root / "port", create=True)
    child_call(root, "port-lost", 75)
    fixture = PortFixture(modules, root / "port", create=False)
    current = job(fixture.repo, fixture.jid)
    need(current["state"] == "UNKNOWN" and current["error"] == "UNEXPECTED_TRANSPORT_OUTCOME",
         "PERSISTED_UNKNOWN")
    need(current["resume_safe"] == 1, "PERSISTED_UNKNOWN_SAFE_BIT")
    need(rows(fixture.repo, "SELECT state,error_code FROM calls ORDER BY id") ==
         [("RECEIVED", None), ("UNKNOWN", "UNEXPECTED_TRANSPORT_OUTCOME")], "CALL_LEDGER_CAUSE")
    need(original.jid == fixture.jid and original.admission["key"] == current["key"], "REOPEN_IDENTITY")
    status = fixture.port.status(fixture.receipt["job_ref"], fixture.context, fixture.peer)
    need(status["state"] == "UNKNOWN" and status["code"] == "UNKNOWN_OUTCOME" and
         status["retryable"] is False, "PUBLIC_UNKNOWN_STATUS")
    text = fixture.engine.describe("A", fixture.repo.get("A", fixture.jid), deliver=False)
    need("неизвестен" in text and "автоматически" in text and
         PRIVATE_SENTINEL not in json.dumps(status) + text, "SAFE_REASON_PROJECTION")
    record("worker_lost_response_reopen", native_state="UNKNOWN", stored_code=current["error"],
           public_code=status["code"], synthetic_marketplace_sends=1, synthetic_selector_sends=1,
           submit_receipt_state=fixture.receipt["state"], private_detail_visible=False)

    before = job(fixture.repo, fixture.jid)
    sends = journal(root / "port/sent.sqlite")
    replay = fixture.port.submit(fixture.task, fixture.peer)
    need(replay == fixture.receipt and replay["state"] == "ACCEPTED", "ACCEPTANCE_REPLAY")
    same_logical = deepcopy(fixture.task)
    same_logical["request_id"] = str(uuid4())
    need(fixture.port.submit(same_logical, fixture.peer)["job_ref"] == replay["job_ref"], "LOGICAL_REPLAY")
    changed = deepcopy(fixture.task)
    changed["query_input"]["text"] = QUERY + " за другой период"
    expect_rejected(modules, "IDEMPOTENCY_CONFLICT", lambda: fixture.port.submit(changed, fixture.peer))
    expect_rejected(modules, "UNKNOWN_OUTCOME", lambda: fixture.port.read_result(
        replay["job_ref"], fixture.context, fixture.peer))
    cancel = fixture.port.cancel(replay["job_ref"], fixture.context, str(uuid4()), fixture.peer)
    need(cancel["state"] == "UNKNOWN" and cancel["cancelled"] is False, "UNKNOWN_CANCEL")
    clarification = {"schema_version": "runtime_clarification_task_v1", "context": fixture.context,
                     "request_id": str(uuid4()), "logical_query_id": fixture.task["logical_query_id"],
                     "trace_id": str(uuid4()), "job_ref": replay["job_ref"],
                     "expected_revision": "0" * 64, "answer": "за октябрь 2026"}
    expect_rejected(modules, "RESULT_EXPIRED", lambda: fixture.port.clarify(clarification, fixture.peer))
    need(job(fixture.repo, fixture.jid) == before and
         rows(fixture.repo, "SELECT count(*) FROM jobs") == [(1,)], "UNKNOWN_ACTION_MUTATION")
    worker = modules["engine"].Worker(fixture.engine, transport(
        modules, root / "port/sent.sqlite", template=True))
    need(worker.step() is False, "UNKNOWN_CLAIMED")
    fixture.clock.advance(121)
    need(fixture.repo.get("A", fixture.jid)["state"] == "UNKNOWN" and worker.step() is False,
         "UNKNOWN_SAFE_BIT_RECOVERED")
    need(journal(root / "port/sent.sqlite") == sends, "UNKNOWN_REDISPATCH")
    record("same_acceptance_cancel_clarify_no_replay", jobs=1, old_receipt="ACCEPTED",
           actual_state="UNKNOWN", cancelled=False, clarification_code="RESULT_EXPIRED",
           stored_resume_safe=1, new_synthetic_sends=0)

    # The same compiled/admitted key is a lower-level identity, not an assertion
    # that a new question/calendar date/request identity must remain blocked.
    fixture.clock.advance(modules["retention"].LEDGER_TTL + 1)
    modules["retention"].sweep(fixture.repo)
    tombstone = job(fixture.repo, fixture.jid)
    need(tombstone["state"] == "UNKNOWN" and tombstone["key"] == original.admission["key"] and
         tombstone["draft"] == "{}" and all(tombstone[key] is None for key in ("plan", "result", "progress")),
         "UNKNOWN_TOMBSTONE")
    need(rows(fixture.repo, "SELECT jid FROM slots") == [(fixture.jid,)], "UNKNOWN_SLOT")
    need(rows(fixture.repo, "SELECT count(*) FROM rt_job_refs") == [(0,)] and
         rows(fixture.repo, "SELECT count(*) FROM rt_job_receipts") == [(0,)] and
         rows(fixture.repo, "SELECT count(*) FROM calls") == [(0,)], "SEPARATE_RETENTION_WINDOWS")
    draft = modules["semantics"].strict_json(original.admission["draft"])
    draft["refresh"] = True
    plan = modules["semantics"].strict_json(original.admission["plan"])
    joined, outcome = fixture.repo.enqueue(
        "A", "synthetic-after-ttl", modules["semantics"].fingerprint("synthetic-after-ttl"),
        draft, plan, modules["semantics"].fingerprint(asdict(fixture.authority.scope)), update_pointer=False)
    need(joined["id"] == fixture.jid and joined["state"] == "UNKNOWN" and outcome == "JOIN", "TOMBSTONE_REFRESH")
    need(rows(fixture.repo, "SELECT count(*) FROM jobs") == [(1,)], "TOMBSTONE_EXTRA_JOB")
    need(worker.step() is False and journal(root / "port/sent.sqlite") == sends, "TTL_REDISPATCH")
    record("retention_and_exact_key_refresh", payload_redacted=True, tombstone_retained=True,
           slot_retained=True, port_refs=0, port_receipts=0, call_ledger=0,
           synthetic_sent_journal_retained=True, join_state="UNKNOWN", new_synthetic_sends=0)


def recovery_checks(modules, root):
    for case in ("unsafe", "safe"):
        clock, repo, engine, jid = simple_fixture(modules, root / case, create=True)
        child_call(root, case, 73)
        interrupted = job(repo, jid)  # Direct SQL deliberately avoids recovery.
        safe = case == "safe"
        need(interrupted["state"] == "RUNNING" and interrupted["resume_safe"] == int(safe),
             "CRASH_RUNNING_STATE")
        need(rows(repo, "SELECT state FROM calls") == [("SENDING",)], "CRASH_RESERVATION")
        need(sum(journal(root / case / "sent.sqlite").values()) == 1, "CRASH_SENT_JOURNAL")
        clock.advance(121)
        recovered = repo.get("A", jid)
        expect_rejected(modules, "CLAIM_INVALID",
                        lambda: repo.mark_resume_safe(jid, interrupted["owner"], False))
        if not safe:
            need(recovered["state"] == "UNKNOWN" and recovered["error"] == "LEASE_EXPIRED",
                 "UNSAFE_RECOVERY")
            need(modules["engine"].Worker(engine, transport(modules, root / case / "sent.sqlite")).step()
                 is False, "UNSAFE_REDISPATCH")
            need(sum(journal(root / case / "sent.sqlite").values()) == 1, "UNSAFE_SENDS")
            record("unsafe_repository_crash", boundary="Repository.claim/reserve default unsafe",
                   recovered_state="UNKNOWN", stored_code="LEASE_EXPIRED",
                   synthetic_dispatch_markers=1, stale_owner_rejected=True)
        else:
            need(recovered["state"] == "QUEUED" and sum(journal(root / case / "sent.sqlite").values()) == 1,
                 "SAFE_RECOVERY_BEFORE_DISPATCH")
            # Observe the real new claim owner without replacing claim/retry code.
            class RecoveryTransport(modules["test_runtime"].FakeTransport):
                def execute(self, request, store):
                    running = job(repo, jid)
                    need(running["state"] == "RUNNING" and running["owner"] != interrupted["owner"],
                         "SAFE_NEW_OWNER")
                    expect_rejected(modules, "CLAIM_INVALID",
                                    lambda: repo.mark_resume_safe(jid, interrupted["owner"], False))
                    need(job(repo, jid) == running, "STALE_OWNER_MUTATED_NEW_CLAIM")
                    journal(root / case / "sent.sqlite", request.operation)
                    return super().execute(request, store)
            worker = modules["engine"].Worker(engine, RecoveryTransport())
            for _ in range(8):
                if repo.get("A", jid)["state"] not in ("QUEUED", "RUNNING"):
                    break
                clock.advance(62)
                worker.step()
            need(repo.get("A", jid)["state"] == "READY" and
                 journal(root / case / "sent.sqlite") == {"ozon_orders": 2}, "SAFE_NORMAL_COMPLETION")
            record("safe_worker_crash_positive_control", recovered_before_claim="QUEUED", final_state="READY",
                   synthetic_sends=2, stale_owner_rejected=True, new_owner_observed=True)


def legacy_and_independent_checks(modules, root):
    folder = root / "legacy"
    folder.mkdir(mode=0o700)
    make_journal(folder / "sent.sqlite")
    clock = modules["test_runtime"].Clock()
    repo = modules["repository"].Repository(folder / "jobs.sqlite", clock)
    settings = modules["model_answer"].Settings(folder / "answer.json")
    engine = modules["engine"].Engine(repo, lambda _: modules["test_runtime"].SCOPE,
                                     answer_settings=settings, template_mode=True)
    guard = {"schema": "station-clarification-authority/v1", "tenant": "A",
             "owner": "synthetic-owner", "application": "synthetic-app",
             "conversation": "synthetic-voice-session", "ticket": "synthetic-ticket"}
    class SyntheticStationAuthority:
        def admit(self, tenant, conversation, rid):
            need(tenant == "A" and conversation == guard["conversation"], "SYNTHETIC_STATION_SCOPE")
            return deepcopy(guard)
        def current(self, value, tenant):
            return tenant == "A" and value == guard
    engine.legacy_voice_authority = SyntheticStationAuthority()
    answer = engine.submit("A", QUERY, "synthetic-voice-1", modules["semantics"].fingerprint(QUERY),
                           modules["test_runtime"].TODAY, conversation_id=guard["conversation"], message_id=1)
    jid = answer["job_id"]
    worker = modules["engine"].Worker(engine, transport(modules, folder / "sent.sqlite",
                                                      template=True, mode="lost"))
    for _ in range(12):
        row = repo.get("A", jid)
        if row["state"] not in ("QUEUED", "RUNNING"):
            break
        clock.advance(max(0, row["due"] - clock()) + 1)
        worker.step()
    before = job(repo, jid)
    need(before["state"] == "UNKNOWN" and before["error"] == "UNEXPECTED_TRANSPORT_OUTCOME" and
         modules["semantics"].strict_json(before["plan"])["station_guard"] == guard, "LEGACY_UNKNOWN")
    need(journal(folder / "sent.sqlite") == {"template_select": 1, "ozon_orders": 1}, "LEGACY_SENT_CAUSE")
    with repo.reader_scope("A", guard["conversation"]), repo.connection(True) as connection:
        token = modules["legacy_voice"].SUBMISSION.set(deepcopy(guard))
        try:
            for command in ("за октябрь 2026", "отмени отчет", "результат"):
                need(modules["legacy_voice"].continue_selected(engine, connection, "A", command) is None,
                     "LEGACY_UNKNOWN_CONTINUATION")
        finally:
            modules["legacy_voice"].SUBMISSION.reset(token)
    need(job(repo, jid) == before and rows(repo, "SELECT count(*) FROM jobs") == [(1,)] and
         journal(folder / "sent.sqlite") == {"template_select": 1, "ozon_orders": 1}, "LEGACY_MUTATION")
    record("legacy_pending_branch", actual_station_guard=True, native_state="UNKNOWN",
           pending_continuations=0, new_synthetic_sends=0,
           scope="existing continue_selected branch, not Station IPC/authentication")

    # A separate admitted question is allowed. This is not a retry of the UNKNOWN.
    independent = engine.submit(
        "A", QUERY + " Отдельный новый запрос.", "synthetic-voice-independent",
        modules["semantics"].fingerprint("independent"), modules["test_runtime"].TODAY,
        conversation_id=guard["conversation"], message_id=2)
    need(independent["job_id"] != jid, "INDEPENDENT_IDENTITY")
    worker = modules["engine"].Worker(engine, transport(modules, folder / "sent.sqlite", template=True))
    for _ in range(12):
        row = repo.get("A", independent["job_id"])
        if row["state"] not in ("QUEUED", "RUNNING"):
            break
        clock.advance(max(0, row["due"] - clock()) + 1)
        worker.step()
    need(repo.get("A", independent["job_id"])["state"] == "READY" and
         job(repo, jid)["state"] == "UNKNOWN", "INDEPENDENT_PROGRESS")
    need(journal(folder / "sent.sqlite") == {"template_select": 2, "ozon_orders": 2, "model_answer": 1},
         "INDEPENDENT_SENDS")
    record("independent_work_positive_control", distinct_job=True, new_job_state="READY",
           original_job_state="UNKNOWN", synthetic_marketplace_sends_total=2)


def cleanup(root):
    for process in CHILDREN:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=2)
    if root is not None and root.exists():
        own_root(root)
        for path in root.rglob("*"):
            if path.is_dir() and not path.is_symlink():
                path.chmod(0o700)
        root.chmod(0o700)
        shutil.rmtree(root)
    return {"temporary_tree_removed": root is None or not root.exists(),
            "children_reaped": all(process.poll() is not None for process in CHILDREN)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--child", choices=("port-lost", "unsafe", "safe"), help=argparse.SUPPRESS)
    parser.add_argument("--owned-root", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    need(sys.flags.isolated and sys.dont_write_bytecode, "REQUIRE_ISOLATED_NO_BYTECODE")
    need((args.child is None and args.output is not None and args.owned_root is None) or
         (args.child is not None and args.output is None and args.owned_root is not None), "CLI_SHAPE")
    limits(8 if args.child else 60)
    sys.addaudithook(network_guard)
    if args.child:
        root = args.owned_root
        own_root(root, child=True)
        _, _, _, expected = input_gate()
        modules = load_core(root / "native", expected)
        run_child(args.child, root, modules)
        raise QualificationError("CHILD_DID_NOT_EXIT")

    output = args.output.absolute()
    need(output.parent.is_dir() and not output.exists() and not output.is_symlink(), "OUTPUT_MUST_BE_NEW")
    root = None
    started = time.monotonic()
    proof = {"schema": "alisa-unknown-lifecycle-source/v1", "status": "FAIL",
             "source_commit": SOURCE_COMMIT, "script_sha256": digest(regular_bytes(Path(__file__))),
             "archive_sha256": ARCHIVE_SHA256, "input_sha256": INPUT_SHA256,
             "current_core_sha256": CURRENT_CORE_SHA256,
             "environment": {"python": sys.version.split()[0], "sqlite": sqlite3.sqlite_version,
                             "platform": sys.platform, "isolated": bool(sys.flags.isolated),
                             "bytecode_disabled": sys.dont_write_bytecode},
             "synthetic_boundaries": ["provider transport", "clock", "authority", "Station authority"],
             "production_actions": False, "ci_integrated": False,
             "limits": {"wall_seconds": 60, "child_wall_seconds": 10,
                        "address_space_bytes_per_process": 268435456,
                        "maximum_simultaneous_processes": 2,
                        "cpu_seconds_per_process": 45, "captured_output_bytes": 65536},
             "operator_endpoint_or_ui_tested": False,
             "full_acceptance_execution_by_this_qualifier": {
                 "AL-N16-03": "NOT_RUN", "AL-T08-03": "NOT_RUN"},
             "existing_roadmap_status_unmodified": True,
             "checks": CHECKS, "children": CHILD_OBSERVATIONS}
    with tempfile.TemporaryFile(mode="w+t", encoding="utf-8") as captured:
        try:
            with redirect_stdout(captured), redirect_stderr(captured):
                raw, archive, manifest, expected = input_gate()
                root = Path(tempfile.mkdtemp(prefix=PREFIX, dir="/tmp"))
                root.chmod(0o700)
                write_new(root / "owner.json", encode({"pid": os.getpid(),
                                                      "script_sha256": proof["script_sha256"]}))
                own_root(root)
                proof["fixture_files"] = len(expected)
                proof["fixture_manifest_sha256"] = build_fixture(root / "native", raw, archive, manifest, expected)
                modules = load_core(root / "native", expected)
                port_checks(modules, root)
                recovery_checks(modules, root)
                legacy_and_independent_checks(modules, root)
                need(len(CHECKS) == 7, "CASE_COUNT")
                need(not NETWORK_ATTEMPTS, "NETWORK_ATTEMPT")
                need(verify_native(root / "native", expected) == proof["fixture_manifest_sha256"],
                     "POST_SOURCE_PIN")
                input_gate()
                proof["status"] = "PASS"
        except Exception as error:
            proof["error_type"] = type(error).__name__
            proof["error_code"] = str(error) if isinstance(error, QualificationError) else "UNEXPECTED_FIXTURE_ERROR"
        finally:
            proof["cleanup"] = cleanup(root)
            need(all(proof["cleanup"].values()), "CLEANUP_FAILED")
            captured.seek(0, 2)
            proof["captured_output_bytes"] = captured.tell()
            if proof["captured_output_bytes"] > 65536:
                proof.update(status="FAIL", error_code="OUTPUT_BOUND")
            proof["network_attempts"] = len(NETWORK_ATTEMPTS)
            proof["elapsed_seconds"] = round(time.monotonic() - started, 3)
            signal.alarm(0)
    write_new(output, encode(proof))
    print(json.dumps({"status": proof["status"], "checks": len(CHECKS),
                      "receipt_sha256": digest(regular_bytes(output))}, sort_keys=True))
    return 0 if proof["status"] == "PASS" else 2


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        code = str(error) if isinstance(error, QualificationError) else "QUALIFICATION_UNAVAILABLE"
        if not re.fullmatch(r"[A-Z_]{1,80}", code):
            code = "QUALIFICATION_UNAVAILABLE"
        print(json.dumps({"status": "FAIL", "code": code, "error_type": type(error).__name__}))
        raise SystemExit(2)
