"""Finite worker-crash qualification against an explicitly pinned native snapshot.

All accounts, SQLite rows, API data, broker replies and HTTP are synthetic.
The only permitted sockets are this test's Unix broker and loopback HTTP peer.
This tests the worker/program protocol; it does not qualify a real executor.
"""
from __future__ import annotations
import argparse
from contextlib import ExitStack
import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time

STALE_MODES = ("stale_generation", "stale_lost_ack")
LOST_ACK_MODES = ("lost_ack", "stale_lost_ack")
RETAINED_MODES = ("retained", "promoted", "lost_ack", *STALE_MODES)
PROGRAM_KEYS = ("_program_started", "_program_started_at", "_program_recovery_at",
                "_program_request_binding", "_compound_answer_fences", "_compound_answer_generation")


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def snapshot(root, pins_path, section="native"):
    pins = json.loads(pins_path.read_text())[section]
    assert pins and all(isinstance(k, str) and isinstance(v, str) for k, v in pins.items())
    for name, expected in pins.items():
        path = root / name
        assert not Path(name).is_absolute() and ".." not in Path(name).parts
        assert path.resolve().is_relative_to(root) and not path.is_symlink()
        assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, name
    return {"files": len(pins), "digest": hashlib.sha256(
        json.dumps(pins, sort_keys=True, separators=(",", ":")).encode()).hexdigest()}


def network_guard(case, broker, port):
    def audit(event, args):
        allowed = True
        if event == "socket.connect":
            address = args[1]
            allowed = (address == broker or
                       isinstance(address, tuple) and address[:2] == ("127.0.0.1", port))
        elif event == "socket.getaddrinfo":
            allowed = args[0] == "127.0.0.1" and args[1] == port
        if not allowed:
            (case / "FORBIDDEN_NETWORK").touch()
            raise AssertionError("NON_FIXTURE_NETWORK_FORBIDDEN")
    sys.addaudithook(audit)



def recovery_broker(cfg, case):
    """Run exact broker.serve, injecting only private paths and fixture peer UID."""
    import builtins
    import importlib.util
    from types import SimpleNamespace
    producer = Path(cfg["producer_root"])
    sys.path.insert(0, str(producer))
    import program_results
    spec = importlib.util.spec_from_file_location("qualified_broker", producer / "program_broker.py")
    broker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(broker)
    trace = {"requests": [], "fresh_start_attempts": 0, "executor_attempts": 0,
             "ack_after_ready": False, "fixture_peer_lookup": True}
    def save_trace():
        write_json(case / "broker_trace.json", trace)
    def forbidden_start(*args, **kwargs):
        trace["fresh_start_attempts"] += 1
        save_trace()
        raise AssertionError("RECOVERY_MUST_NOT_START_PAID_WORK")
    def forbidden_executor(*args, **kwargs):
        trace["executor_attempts"] += 1
        save_trace()
        raise AssertionError("RECOVERY_MUST_NOT_RUN_EXECUTOR")
    def fixture_open(path, *args, **kwargs):
        assert str(path) == "/run/lock/alisa-program.lock"
        return builtins.open(case / "producer-state" / "broker.lock", *args, **kwargs)
    def fixture_user(name):
        assert name == "alice-market"
        return SimpleNamespace(pw_uid=os.getuid())
    class ObservedJSON:
        def __getattr__(self, name):
            return getattr(json, name)
        def loads(self, value, *args, **kwargs):
            parsed = json.loads(value, *args, **kwargs)
            if isinstance(parsed, dict) and "protocol" in parsed:
                trace["requests"].append(parsed)
            elif isinstance(parsed, dict) and parsed.get("kind") == "ack":
                trace["requests"].append(parsed)
                seed = json.loads((case / "seed.json").read_text())
                assert Path(seed["db"]).resolve().is_relative_to(case)
                with sqlite3.connect("file:" + seed["db"] + "?mode=ro", uri=True) as db:
                    row = db.execute("SELECT state,result,progress FROM jobs WHERE id=?",
                                     (seed["job"],)).fetchone()
                    trace["ack_after_ready"] = row[0] == "READY"
                    progress = json.loads(row[2]) if row[2] else {}
                    trace["ack_after_stale_discard"] = (
                        row[0] == "QUEUED" and not row[1]
                        and all(key not in progress for key in PROGRAM_KEYS)
                        and progress.get("_answer_api_data") == {"blob": "x" * 11000})
            save_trace()
            return parsed
    os.set_blocking(0, True)  # socket activation presents a blocking connection
    broker.BASE = case / "producer-state"
    broker.open = fixture_open
    broker.pwd = SimpleNamespace(getpwnam=fixture_user)
    broker.active = lambda name: False  # no real service lookup for a synthetic workspace
    broker.subprocess = SimpleNamespace(run=forbidden_executor, Popen=forbidden_executor)
    broker.json = ObservedJSON()
    program_results.Results.start = forbidden_start
    broker.serve()
    trace["serve_returned"] = True
    save_trace()


def child(config_path, phase):
    cfg = json.loads(config_path.read_text())
    root, case = Path(cfg["native_root"]), config_path.parent
    network_guard(case, cfg["broker"], cfg["port"])
    if phase == "broker-recovery":
        recovery_broker(cfg, case)
        return
    if phase.startswith("outbox-"):
        sys.path.insert(0, cfg["producer_root"])
        from program_results import Results
        store = Results(case / "results")
        key, binding = "a" * 64, "b" * 64
        if phase == "outbox-write":
            store.start(key, binding)
            store.complete(key, binding, "Synthetic durable answer.")
            os._exit(23)  # no destructor/normal interpreter cleanup
        elif phase == "outbox-ack":
            saved = store.read(key, binding)
            assert saved["state"] == "complete" and saved["content"] == "Synthetic durable answer."
            assert hashlib.sha256(saved["content"].encode()).hexdigest() == saved["digest"]
            before = store.path(key).read_bytes()
            try:
                store.read(key, "c" * 64)
            except ValueError as exc:
                assert str(exc) == "job_binding"
            else:
                raise AssertionError("wrong binding accepted")
            assert store.path(key).read_bytes() == before
            store.ack(key, binding, saved["digest"])
            os._exit(24)
        elif phase == "outbox-read":
            saved = store.read(key, binding)
            assert saved["state"] == "acknowledged" and "content" not in saved
            assert store.read("d" * 64, binding) is None
            assert not list(store.root.glob(".pending-*"))
        elif phase == "outbox-tests":
            import unittest
            suite = unittest.defaultTestLoader.discover(cfg["producer_root"], pattern="test_result_retention.py")
            result = unittest.TextTestRunner(verbosity=2).run(suite)
            assert result.wasSuccessful() and result.testsRun == 4
        return
    sys.path[:0] = [str(root), str(root / "tests")]
    from unittest.mock import patch
    from engine import Engine, Worker
    from model_answer import Settings, PENDING, API_DATA
    from repository import Repository
    from semantics import Rejected, fingerprint
    from test_runtime import Clock, SCOPE, TODAY
    from test_template_only import Transport, Pilot
    from semantics import canonical_json, strict_json
    from universal_reads import ReadSurface
    import model_program
    import read_surface

    def generation_fixture(engine):
        """Inject source revision replies; keep real generation/fence/callback code."""
        import parameter_report_runtime as reports
        stack = ExitStack()
        if cfg["mode"] not in STALE_MODES:
            return stack
        revision = 1 if phase == "start" else 2
        reference = "r8:synthetic-report"
        class FixtureAuthority(reports.Authority):
            def __init__(self):
                pass
            def call(self, request):
                assert request["reference"] == reference
                if request["method"] == "report_current":
                    return {"current": True}
                assert request["method"] == "report_fence"
                if phase == "resume":
                    assert request["checkpoint"] == {"revision": 1}
                    write_json(case / "stale_fence.json", {
                        "original_checkpoint_checked": True, "current_revision": revision})
                    return {"current": False}
                assert phase == "regenerate" and request["checkpoint"] == {"revision": 2}
                write_json(case / "current_fence.json", {"revision": 2, "current": True})
                return {"current": True}
        def prepared(*args):
            value = ([{"fixture_revision": revision}], [(reference, {"revision": revision})])
            write_json(case / ("prepared_" + phase + ".json"), {
                "context": value[0], "fences": value[1]})
            return value
        engine.parameter_intent_authority = FixtureAuthority()
        stack.enter_context(patch("parameter_report_runtime.prepare_answer", prepared))
        return stack

    class WireTransport(Transport):
        model_source = "model:deepseek-flash"

        def execute_observed(self, request, store, on_dispatch):
            if request.operation != "model_answer_program":
                return super().execute_observed(request, store, on_dispatch)
            on_dispatch()
            conn = http.client.HTTPConnection("127.0.0.1", cfg["port"], timeout=12)
            try:
                body = json.dumps({"fixture": "program-model-call"}).encode()
                conn.request("POST", "/fixture", body, {"Content-Type": "application/json"})
                response = conn.getresponse()
                data = response.read(8192)
                assert response.status == 200
                return json.loads(data), {"status": 200, "bytes": len(data), "elapsed_ms": 1}
            finally:
                conn.close()

    actual_run = model_program.run
    def run_at_fixture(*args, **kwargs):
        if cfg["mode"] in STALE_MODES:
            write_json(case / ("dispatch_" + phase + ".json"), {
                "generation": kwargs["generation"],
                "source_facts_sha256": hashlib.sha256(canonical_json(args[3]["responses"]).encode()).hexdigest()})
        if cfg["mode"] in LOST_ACK_MODES and phase == "resume":
            callback = kwargs["on_complete"]
            def commit_then_exit(response):
                callback(response)
                os._exit(25)  # durable native callback succeeded; ACK not yet sent
            kwargs = dict(kwargs, on_complete=commit_then_exit)
        return actual_run(*args, **dict(kwargs, socket_path=cfg["broker"]))

    if phase == "start":
        flow = Pilot("test_simple_template_existing_source_and_normal_answer")
        flow.setUp()
        flow.engine.program_answers = True
        answer = flow.ask()
        for _ in range(20):
            row = flow.repo.get("A", answer["job_id"])
            flow.clock.advance(max(0, row["due"] - flow.clock()) + 1)
            flow.worker.step()
            row = flow.repo.get("A", answer["job_id"])
            progress = strict_json(row["progress"]) if row["progress"] else {}
            if PENDING in progress:
                break
        else:
            raise AssertionError("template did not reach answer boundary")
        progress[API_DATA] = {"blob": "x" * 11000}
        with flow.repo.connection(True) as db:
            db.execute("UPDATE jobs SET progress=? WHERE id=?",
                       (canonical_json(progress), row["id"]))
        assert Path(flow.repo.path).resolve().is_relative_to(case)
        seed = {"db": str(flow.repo.path), "settings": str(flow.settings.path),
                "job": answer["job_id"], "clock": flow.clock(),
                "lease": flow.repo.lease, "calls_before_program": flow.repo.call_count(),
                "conversation": "template-test-session"}
        write_json(case / "seed.json", seed)
        flow.transport = WireTransport()
        flow.worker = Worker(flow.engine, flow.transport)
        with generation_fixture(flow.engine), patch("model_program.run", run_at_fixture):
            flow.worker.step()
        raise AssertionError("START_WORKER_WAS_NOT_KILLED")

    seed = json.loads((case / "seed.json").read_text())
    assert Path(seed["db"]).resolve().is_relative_to(case)
    clock = Clock()
    clock.now = seed["clock"] + (1 if phase == "cancel" else seed["lease"] + (2 if phase == "regenerate" else 1))
    repo = Repository(seed["db"], clock)
    reads = ReadSurface(lambda: {"enabled": True, "pin": read_surface.PIN,
                                "max_model_steps": None, "max_provider_calls": None})
    engine = Engine(repo, lambda tenant: SCOPE, template_mode=True, read_surface=reads,
                    answer_settings=Settings(Path(seed["settings"])))
    engine.program_answers = True
    worker = Worker(engine, WireTransport())
    if phase == "cancel":
        with repo.reader_scope("A", seed["conversation"]):
            assert repo.cancel("A")
        write_json(case / "cancel.json", {"state": repo.get("A", seed["job"])["state"]})
        return
    if phase == "read-discarded":
        claimed = False  # inspect persisted state without admitting a new generation
    else:
        with generation_fixture(engine), patch("model_program.run", run_at_fixture):
            claimed = worker.step()
    row = repo.get("A", seed["job"])
    checks = {"same_job": row["id"] == seed["job"]}
    if phase == "regenerate":
        assert cfg["mode"] == "stale_lost_ack"
        checks["ready_with_current_answer"] = row["state"] == "READY" and "Synthetic revision two answer." in row["result"]
        checks["stale_answer_absent"] = "Synthetic retained answer." not in row["result"]
        with repo.reader_scope("A", seed["conversation"]):
            reply = engine.control("A", "результат")
        checks["current_answer_readable"] = "Synthetic revision two answer." in reply["text"]
        dispatched = {name: json.loads((case / ("dispatch_" + name + ".json")).read_text())
                      for name in ("start", "resume", "regenerate")}
        checks["old_generation_only_retrieved"] = dispatched["start"]["generation"] == dispatched["resume"]["generation"]
        checks["new_generation_identity"] = dispatched["regenerate"]["generation"] != dispatched["start"]["generation"]
        checks["same_source_facts"] = len({v["source_facts_sha256"] for v in dispatched.values()}) == 1
        checks["new_preparation_observed"] = json.loads((case / "prepared_regenerate.json").read_text()) == {
            "context": [{"fixture_revision": 2}], "fences": [["r8:synthetic-report", {"revision": 2}]]}
        checks["current_checkpoint_checked"] = json.loads((case / "current_fence.json").read_text()) == {"revision": 2, "current": True}
        checks["ready_not_claimed_again"] = not worker.step()
    elif cfg["mode"] in STALE_MODES:
        progress = strict_json(row["progress"])
        checks["stale_not_ready"] = row["state"] == "QUEUED" and not row["result"]
        checks["old_generation_cleared"] = all(key not in progress for key in PROGRAM_KEYS)
        checks["facts_and_pending_preserved"] = progress.get(API_DATA) == {"blob": "x" * 11000} and PENDING in progress
        checks["original_checkpoint_checked"] = json.loads((case / "stale_fence.json").read_text()) == {
            "original_checkpoint_checked": True, "current_revision": 2}
        checks["changed_preparation_observed"] = all(
            json.loads((case / ("prepared_" + prepared_phase + ".json")).read_text()) == {
                "context": [{"fixture_revision": revision}],
                "fences": [["r8:synthetic-report", {"revision": revision}]]}
            for prepared_phase, revision in (("start", 1), ("resume", 2)))
        before = json.loads((case / "before.json").read_text())
        try:
            repo.complete(seed["job"], before["owner"], {"complete": True, "pages": ["late"]})
            checks["old_owner_fenced"] = False
        except Rejected:
            checks["old_owner_fenced"] = True
        if phase == "read-discarded":
            checks["cold_discard_readback"] = True
    elif cfg["mode"] in RETAINED_MODES:
        checks["ready_from_retained_result"] = row["state"] == "READY"
        checks["expected_retained_answer"] = "Synthetic retained answer." in row["result"]
        if cfg["mode"] == "lost_ack":
            checks["ready_not_claimed_again"] = not claimed
            with repo.reader_scope("A", seed["conversation"]):
                reply = engine.control("A", "результат")
            checks["answer_read_without_recalculation"] = "Synthetic retained answer." in reply["text"]
    elif cfg["mode"] == "unknown":
        checks["unknown_without_result"] = row["state"] == "UNKNOWN" and not row["result"]
        with repo.reader_scope("A", seed["conversation"]):
            reply = engine.control("A", "статус отчета")
        checks["status_reads_unknown"] = "Исход обращения неизвестен" in reply["text"]
        checks["no_worker_claim_after_unknown"] = not worker.step()
    else:
        checks["cancelled_not_claimed"] = not claimed and row["state"] == "CANCELLED"
        before = json.loads((case / "before.json").read_text())
        try:
            repo.complete(seed["job"], before["owner"], {"complete": True, "pages": ["late"]})
            checks["late_owner_fenced"] = False
        except Rejected:
            checks["late_owner_fenced"] = True
        checks["cancelled_has_no_result"] = not row["result"]
    with repo.connection() as connection:
        model_rows = connection.execute(
            "SELECT count(*) FROM calls WHERE jid=? AND json_extract(model_context, '$.stage')='model_answer_program'", (seed["job"],)).fetchone()[0]
    expected_models = 2 if phase == "regenerate" else 1
    checks["expected_model_ledger_rows"] = model_rows == expected_models
    checks["no_source_recollection"] = repo.call_count() == seed["calls_before_program"] + expected_models
    write_json(case / ("regenerated.json" if phase == "regenerate" else "after.json"), {"checks": checks, "state": row["state"],
                                    "model_rows": model_rows, "all_passed": all(checks.values())})
    assert all(checks.values()), checks


def exercise(script, root, output, mode, producer=None):
    case = output / mode
    case.mkdir(mode=0o700)
    sent, retained, release = threading.Event(), threading.Event(), threading.Event()
    stop = threading.Event()
    observed = {"http_requests": 0, "envelopes": [], "ack_after_ready": False,
                "actual_broker_processes": 0}
    store = None
    if producer:
        import importlib.util
        spec = importlib.util.spec_from_file_location("qualification_results", producer / "program_results.py")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        store = module.Results(case / "producer-state" / "results")
    failures = []
    native = None
    listener = socket.socket(socket.AF_UNIX)
    broker = str(case / "broker.sock")
    listener.bind(broker)
    listener.listen(2)
    listener.settimeout(.2)

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass
        def do_POST(self):
            body = self.rfile.read(int(self.headers["Content-Length"]))
            assert json.loads(body) == {"fixture": "program-model-call"}
            observed["http_requests"] += 1
            sent.set()
            if mode not in RETAINED_MODES:
                release.wait(15)
            data = json.dumps({"content": "Synthetic model reply.", "finish_reason": "stop"}).encode()
            try:
                self.send_response(200)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except (BrokenPipeError, ConnectionResetError):
                pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    port = server.server_port

    def actual_recovery(conn, first):
        with (case / "BROKER_PRIVATE.log").open("a") as log:
            result = subprocess.run(command + ["--phase", "broker-recovery"], env=env,
                                    stdin=conn, stdout=conn, stderr=log, timeout=12)
        assert result.returncode == 0, "actual broker failed"
        trace = json.loads((case / "broker_trace.json").read_text())
        expected = {"protocol": 3, **first, "resume_only": True}
        assert trace["requests"][0] == expected
        assert trace["serve_returned"] and not trace["fresh_start_attempts"] and not trace["executor_attempts"]
        observed["envelopes"].append({"protocol": 3, "keys": sorted(expected), "resume_only": True})
        observed["ack_after_ready"] = trace["ack_after_ready"]
        if mode == "stale_generation":
            observed["ack_after_stale_discard"] = trace.get("ack_after_stale_discard", False)
        value = store.read(first["job_id"], first["fingerprint"])
        observed["outbox_state"] = value["state"]
        if mode in ("retained", "promoted", "stale_generation"):
            assert value["state"] == "acknowledged" and "content" not in value
            assert len(trace["requests"]) == 2 and trace["requests"][1]["kind"] == "ack"
            if mode == "stale_generation":
                assert observed["ack_after_stale_discard"] and not observed["ack_after_ready"]
            if mode == "promoted":
                assert not (case / "producer-state" / "jobs" / ("e" * 32)).exists()
                observed["completed_workspace_promoted_and_removed"] = True
        elif mode in LOST_ACK_MODES:
            assert value["state"] == "complete" and value["content"] == "Synthetic retained answer."
            assert len(trace["requests"]) == 1 and not trace["ack_after_ready"]
            observed["unacknowledged_answer_retained"] = True
        else:
            assert value["state"] == "started" and len(trace["requests"]) == 1
        observed["actual_broker_processes"] += 1  # publish completion after every assertion

    def fresh_generation(conn, first):
        """Synthetic fresh producer; actual native generation/callback and Results IO."""
        assert mode == "stale_lost_ack" and observed["actual_broker_processes"] == 1
        old_bytes = store.path(first["job_id"]).read_bytes()
        with conn.makefile("rwb") as stream:
            envelope = json.loads(stream.readline(65537))
            assert set(envelope) == {"protocol", "job_id", "resume_only", "messages", "document", "model", "user_id"}
            assert envelope["protocol"] == 2 and envelope["resume_only"] is False
            assert envelope["job_id"] != first["job_id"]
            document = json.loads(envelope["document"])
            assert document["responses"] == {"blob": "x" * 11000}
            assert document["compound_parameter_context"] == [{"fixture_revision": 2}]
            fields = {k: envelope[k] for k in ("job_id", "user_id", "messages", "document", "model")}
            binding = hashlib.sha256(json.dumps(fields, ensure_ascii=False, sort_keys=True,
                                                separators=(",", ":")).encode()).hexdigest()
            assert binding != first["fingerprint"]
            observed["envelopes"].append({"protocol": 2, "keys": sorted(envelope), "resume_only": False})
            store.start(envelope["job_id"], binding)
            def send(value):
                stream.write((json.dumps(value) + "\n").encode())
                stream.flush()
            send({"kind": "call", "payload": {"model": "deepseek-flash", "messages": [],
                                               "stream": True, "max_tokens": 64}})
            value = json.loads(stream.readline(65537))
            assert value["kind"] == "response" and value["content"] == "Synthetic model reply."
            content = "Synthetic revision two answer."
            digest = hashlib.sha256(content.encode()).hexdigest()
            store.complete(envelope["job_id"], binding, content)
            send({"kind": "complete", "job_id": envelope["job_id"], "fingerprint": binding,
                  "content": content, "digest": digest})
            assert json.loads(stream.readline(65537)) == {"kind": "ack", "digest": digest}
            seed = json.loads((case / "seed.json").read_text())
            assert Path(seed["db"]).resolve().is_relative_to(case)
            with sqlite3.connect("file:" + seed["db"] + "?mode=ro", uri=True) as db:
                row = db.execute("SELECT state,result FROM jobs WHERE id=?", (seed["job"],)).fetchone()
                assert row[0] == "READY" and content in row[1] and "Synthetic retained answer." not in row[1]
            store.ack(envelope["job_id"], binding, digest)
            old = store.read(first["job_id"], first["fingerprint"])
            new = store.read(envelope["job_id"], binding)
            assert old["state"] == "complete" and old["content"] == "Synthetic retained answer."
            assert store.path(first["job_id"]).read_bytes() == old_bytes
            assert new["state"] == "acknowledged" and "content" not in new
            observed["new_generation"] = {"different_key_and_binding": True, "same_source_facts": True,
                "current_revision": 2, "ack_after_ready": True, "old_unacknowledged_result_unchanged": True,
                "old_outbox_state": old["state"], "new_outbox_state": new["state"],
                "fresh_producer_is_synthetic": True}

    def broker_loop():
        first = None
        while not stop.is_set():
            try:
                conn, _ = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            try:
                with conn:
                    conn.settimeout(15)
                    if first is not None and producer:
                        if mode == "stale_lost_ack" and observed["actual_broker_processes"]:
                            fresh_generation(conn, first)
                        else:
                            actual_recovery(conn, first)
                        continue
                    with conn.makefile("rwb") as stream:
                        raw = stream.readline(65537)
                        assert raw and len(raw) <= 65536
                        envelope = json.loads(raw)
                        observed["envelopes"].append({"protocol": envelope.get("protocol"),
                                                     "keys": sorted(envelope),
                                                     "resume_only": envelope.get("resume_only")})
                        def send(value):
                            stream.write((json.dumps(value) + "\n").encode())
                            stream.flush()
                        if first is None:
                            assert envelope["protocol"] == 2 and envelope["resume_only"] is False
                            fields = {k: envelope[k] for k in ("job_id", "user_id", "messages", "document", "model")}
                            binding = hashlib.sha256(json.dumps(fields, ensure_ascii=False, sort_keys=True,
                                                                separators=(",", ":")).encode()).hexdigest()
                            first = {"job_id": envelope["job_id"], "fingerprint": binding}
                            if store:
                                store.start(first["job_id"], binding, "e" * 32 if mode == "promoted" else None)
                            send({"kind": "call", "payload": {"model": "deepseek-flash", "messages": [],
                                                           "stream": True, "max_tokens": 64}})
                            line = stream.readline(65537)
                            if mode in RETAINED_MODES:
                                value = json.loads(line)
                                assert value["kind"] == "response" and value["content"] == "Synthetic model reply."
                                if store:
                                    if mode == "promoted":
                                        workspace = case / "producer-state" / "jobs" / ("e" * 32)
                                        workspace.mkdir(parents=True)
                                        write_json(workspace / "result.private.json", {
                                            "finish_reason": "stop", "final_response": "Synthetic retained answer."})
                                    else:
                                        store.complete(first["job_id"], binding, "Synthetic retained answer.")
                                retained.set()
                                release.wait(15)
                            else:
                                assert not line
                        else:
                            assert mode != "cancelled"
                            assert envelope == {"protocol": 3, **first, "resume_only": True}
                            if mode == "unknown":
                                send({"kind": "unknown"})
                            else:
                                content = "Synthetic retained answer."
                                digest = hashlib.sha256(content.encode()).hexdigest()
                                send({"kind": "complete", **first, "content": content, "digest": digest})
                                ack = json.loads(stream.readline(65537))
                                assert ack == {"kind": "ack", "digest": digest}
                                seed = json.loads((case / "seed.json").read_text())
                                with sqlite3.connect(seed["db"]) as db:
                                    observed["ack_after_ready"] = db.execute(
                                        "SELECT state FROM jobs WHERE id=?", (seed["job"],)).fetchone()[0] == "READY"
            except Exception as exc:
                if not stop.is_set():
                    failures.append(type(exc).__name__ + ": " + str(exc)[:200])

    threads = [threading.Thread(target=server.serve_forever, daemon=True),
               threading.Thread(target=broker_loop, daemon=True)]
    for thread in threads:
        thread.start()
    cfg = case / "config.json"
    write_json(cfg, {"native_root": str(root), "port": port, "broker": broker, "mode": mode,
                     "producer_root": str(producer) if producer else None})
    env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC",
           "PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": str(case)}
    command = [sys.executable, "-B", "-X", "pycache_prefix=" + str(case / "unused-pyc"),
               str(script), "--config", str(cfg)]
    before = None
    try:
        with (case / "PRIVATE.log").open("w") as log:
            native = subprocess.Popen(command + ["--phase", "start"], env=env, stdout=log, stderr=log)
            event = retained if mode in RETAINED_MODES else sent
            assert event.wait(20), "worker did not reach crash boundary"
            seed = json.loads((case / "seed.json").read_text())
            with sqlite3.connect(seed["db"]) as db:
                db.row_factory = sqlite3.Row
                row = db.execute("SELECT id,state,owner,progress,resume_safe FROM jobs WHERE id=?",
                                 (seed["job"],)).fetchone()
                calls = db.execute("SELECT state FROM calls WHERE jid=? AND json_extract(model_context, '$.stage')='model_answer_program'",
                                   (seed["job"],)).fetchall()
            progress = json.loads(row["progress"])
            before = {"owner": row["owner"], "state": row["state"], "resume_safe": row["resume_safe"],
                      "persisted_started": progress.get("_program_started"),
                      "persisted_binding": sorted(progress.get("_program_request_binding", {})),
                      "model_states": [x[0] for x in calls]}
            write_json(case / "before.json", before)
            assert before["state"] == "RUNNING" and before["persisted_started"]
            assert before["persisted_binding"] == ["fingerprint", "job_id"]
            assert before["model_states"] == (["RECEIVED"] if mode in RETAINED_MODES else ["SENDING"])
            if mode == "cancelled":
                subprocess.run(command + ["--phase", "cancel"], env=env, stdout=log,
                               stderr=log, timeout=10, check=True)
            assert native.poll() is None
            native.kill()
            assert native.wait(timeout=5) == -signal.SIGKILL
            release.set()
            resumed = subprocess.run(command + ["--phase", "resume"], env=env,
                                     stdout=log, stderr=log, timeout=15)
            expected_resume_exit = 25 if mode in LOST_ACK_MODES else 0
            assert resumed.returncode == expected_resume_exit, "resume child failed"
            ready_reader_exit = None
            if mode == "lost_ack":
                reader = subprocess.run(command + ["--phase", "read-ready"], env=env,
                                        stdout=log, stderr=log, timeout=15)
                ready_reader_exit = reader.returncode
                assert ready_reader_exit == 0, "cold READY reader failed"
            if mode in STALE_MODES:
                reader = subprocess.run(command + ["--phase", "read-discarded"], env=env,
                                        stdout=log, stderr=log, timeout=15)
                ready_reader_exit = reader.returncode
                assert ready_reader_exit == 0, "cold discard readback failed"
            after = json.loads((case / "after.json").read_text())
            # Wait for the protocol ACK after the durable callback, not a new model call.
            if mode in ("retained", "promoted"):
                deadline = time.monotonic() + 2
                while not observed["ack_after_ready"] and not failures and time.monotonic() < deadline:
                    stop.wait(.01)
            if producer and mode != "cancelled":
                deadline = time.monotonic() + 2
                while not observed["actual_broker_processes"] and not failures and time.monotonic() < deadline:
                    stop.wait(.01)
            assert not failures, failures
            assert observed["http_requests"] == 1 and after["all_passed"]
            assert len(observed["envelopes"]) == (1 if mode == "cancelled" else 2)
            assert mode not in ("retained", "promoted") or observed["ack_after_ready"]
            assert not (case / "FORBIDDEN_NETWORK").exists()
            if producer:
                assert observed["actual_broker_processes"] == (0 if mode == "cancelled" else 1)
            regenerated = None
            if mode == "stale_lost_ack":
                result = subprocess.run(command + ["--phase", "regenerate"], env=env,
                                        stdout=log, stderr=log, timeout=15)
                assert result.returncode == 0, "new generation failed"
                deadline = time.monotonic() + 2
                while "new_generation" not in observed and not failures and time.monotonic() < deadline:
                    stop.wait(.01)
                regenerated = json.loads((case / "regenerated.json").read_text())
                assert not failures and observed.get("new_generation") and regenerated["all_passed"], failures
                assert observed["http_requests"] == 2 and len(observed["envelopes"]) == 3
                assert observed["actual_broker_processes"] == 1 and not (case / "FORBIDDEN_NETWORK").exists()
            return {"mode": mode, "status": "PASS", "first_pid": native.pid,
                    "first_exit": -signal.SIGKILL, "resume_exit": resumed.returncode,
                    "ready_reader_exit": ready_reader_exit,
                    "before_model_state": before["model_states"][0],
                    "after": after, "regeneration": regenerated, "wire": observed, "external_attempts": 0}
    finally:
        if native is not None and native.poll() is None:
            native.kill()
            native.wait(timeout=5)
        release.set()
        stop.set()
        listener.close()
        server.shutdown()
        server.server_close()
        for thread in threads:
            thread.join(timeout=2)



def cold_outbox(script, producer, output):
    """Exact installed Results code; cold processes, synthetic private storage."""
    case = output / "outbox"
    case.mkdir(mode=0o700)
    cfg = case / "config.json"
    write_json(cfg, {"native_root": str(producer), "producer_root": str(producer),
                     "broker": "", "port": -1})
    env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC",
           "PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": str(case)}
    exits = []
    with (case / "PRIVATE.log").open("w") as log:
        for phase, expected in [("outbox-write", 23), ("outbox-ack", 24),
                                ("outbox-read", 0), ("outbox-tests", 0)]:
            command = [sys.executable, "-B", "-X", "pycache_prefix=" + str(case / "unused-pyc"),
                       str(script), "--config", str(cfg), "--phase", phase]
            child_process = subprocess.run(command, env=env, stdout=log, stderr=log, timeout=15)
            exits.append({"phase": phase, "exit": child_process.returncode})
            assert child_process.returncode == expected, phase
    assert not (case / "FORBIDDEN_NETWORK").exists()
    return {"status": "PASS", "processes": exits, "complete_and_ack_survive_abrupt_exit": True,
            "wrong_binding_rejected_without_mutation": True, "ack_removes_content": True,
            "existing_retention_tests": 4, "external_attempts": 0,
            "actual_broker_serve_or_sdk_executed": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--native-root", type=Path)
    parser.add_argument("--pins", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--producer-root", type=Path)
    parser.add_argument("--real-recovery-broker", action="store_true")
    parser.add_argument("--only-case", choices=["unknown", "retained", "cancelled", "promoted", "lost_ack", *STALE_MODES])
    parser.add_argument("--phase", choices=["start", "resume", "read-ready", "read-discarded", "regenerate", "cancel", "broker-recovery", "outbox-write", "outbox-ack", "outbox-read", "outbox-tests"])
    parser.add_argument("--config", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if args.phase:
        child(args.config.resolve(), args.phase)
        return
    root, output = args.native_root.resolve(), args.output.resolve()
    checked = snapshot(root, args.pins)
    producer = args.producer_root.resolve() if args.producer_root else None
    producer_checked = snapshot(producer, args.pins, "producer") if producer else None
    assert not args.real_recovery_broker or producer is not None
    output.mkdir(mode=0o700)
    cases = []
    record = {"scope": "AUTHOR_SYNTHETIC_WORKER_SIGKILL_PROGRAM_RECOVERY",
              "snapshot": checked, "python": sys.version.split()[0],
              "production_database_or_credentials_used": False,
              "real_provider_or_model_requests": 0,
              "real_executor_outbox_qualified": False, "cases": cases}
    try:
        modes = ("unknown", "retained", "cancelled", "promoted", "lost_ack", *STALE_MODES) if args.real_recovery_broker else ("unknown", "retained", "cancelled")
        if args.only_case:
            assert args.only_case in modes, "case requires --real-recovery-broker"
            modes = (args.only_case,)
        for mode in modes:
            cases.append(exercise(Path(__file__).resolve(), root, output, mode,
                                  producer if args.real_recovery_broker else None))
        assert snapshot(root, args.pins) == checked
        record["snapshot_unchanged"] = True
        if producer:
            if args.real_recovery_broker:
                record["paired_actual_broker_recovery"] = True
                record["real_broker_fresh_work_or_sdk_executed"] = False
            else:
                record["outbox"] = cold_outbox(Path(__file__).resolve(), producer, output)
            assert snapshot(producer, args.pins, "producer") == producer_checked
            record["producer_snapshot"] = producer_checked
        record["status"] = "PASS"
    except Exception as exc:
        record["status"] = "FAIL"
        record["failure"] = type(exc).__name__ + ": " + str(exc)[:300]
        raise
    finally:
        write_json(output / "RESULT.json", record)
        print(json.dumps({k: v for k, v in record.items() if k != "cases"}), flush=True)


if __name__ == "__main__":
    main()
