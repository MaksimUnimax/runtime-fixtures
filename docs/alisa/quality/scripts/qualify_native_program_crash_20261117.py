"""Finite worker-crash qualification against an explicitly pinned native snapshot.

All accounts, SQLite rows, API data, broker replies and HTTP are synthetic.
The only permitted sockets are this test's Unix broker and loopback HTTP peer.
This tests the worker/program protocol; it does not qualify a real executor.
"""
from __future__ import annotations
import argparse
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


def child(config_path, phase):
    cfg = json.loads(config_path.read_text())
    root, case = Path(cfg["native_root"]), config_path.parent
    network_guard(case, cfg["broker"], cfg["port"])
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
        with patch("model_program.run", run_at_fixture):
            flow.worker.step()
        raise AssertionError("START_WORKER_WAS_NOT_KILLED")

    seed = json.loads((case / "seed.json").read_text())
    assert Path(seed["db"]).resolve().is_relative_to(case)
    clock = Clock()
    clock.now = seed["clock"] + (1 if phase == "cancel" else seed["lease"] + 1)
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
    with patch("model_program.run", run_at_fixture):
        claimed = worker.step()
    row = repo.get("A", seed["job"])
    checks = {"same_job": row["id"] == seed["job"]}
    if cfg["mode"] == "retained":
        checks["ready_from_retained_result"] = row["state"] == "READY"
        checks["expected_retained_answer"] = "Synthetic retained answer." in row["result"]
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
    checks["single_model_ledger_row"] = model_rows == 1
    checks["no_new_ledger_rows"] = repo.call_count() == seed["calls_before_program"] + 1
    write_json(case / "after.json", {"checks": checks, "state": row["state"],
                                    "model_rows": model_rows, "all_passed": all(checks.values())})
    assert all(checks.values()), checks


def exercise(script, root, output, mode):
    case = output / mode
    case.mkdir(mode=0o700)
    sent, retained, release = threading.Event(), threading.Event(), threading.Event()
    stop = threading.Event()
    observed = {"http_requests": 0, "envelopes": [], "ack_after_ready": False}
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
            if mode != "retained":
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
                            send({"kind": "call", "payload": {"model": "deepseek-flash", "messages": [],
                                                           "stream": True, "max_tokens": 64}})
                            line = stream.readline(65537)
                            if mode == "retained":
                                value = json.loads(line)
                                assert value["kind"] == "response" and value["content"] == "Synthetic model reply."
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
    write_json(cfg, {"native_root": str(root), "port": port, "broker": broker, "mode": mode})
    env = {"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8", "TZ": "UTC",
           "PYTHONDONTWRITEBYTECODE": "1", "TMPDIR": str(case)}
    command = [sys.executable, "-B", "-X", "pycache_prefix=" + str(case / "unused-pyc"),
               str(script), "--config", str(cfg)]
    before = None
    try:
        with (case / "PRIVATE.log").open("w") as log:
            native = subprocess.Popen(command + ["--phase", "start"], env=env, stdout=log, stderr=log)
            event = retained if mode == "retained" else sent
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
            assert before["model_states"] == (["RECEIVED"] if mode == "retained" else ["SENDING"])
            if mode == "cancelled":
                subprocess.run(command + ["--phase", "cancel"], env=env, stdout=log,
                               stderr=log, timeout=10, check=True)
            assert native.poll() is None
            native.kill()
            assert native.wait(timeout=5) == -signal.SIGKILL
            release.set()
            resumed = subprocess.run(command + ["--phase", "resume"], env=env,
                                     stdout=log, stderr=log, timeout=15)
            assert resumed.returncode == 0, "resume child failed"
            after = json.loads((case / "after.json").read_text())
            # Wait for the protocol ACK after the durable callback, not a new model call.
            if mode == "retained":
                deadline = time.monotonic() + 2
                while not observed["ack_after_ready"] and not failures and time.monotonic() < deadline:
                    stop.wait(.01)
            assert not failures, failures
            assert observed["http_requests"] == 1 and after["all_passed"]
            assert len(observed["envelopes"]) == (1 if mode == "cancelled" else 2)
            assert mode != "retained" or observed["ack_after_ready"]
            assert not (case / "FORBIDDEN_NETWORK").exists()
            return {"mode": mode, "status": "PASS", "first_pid": native.pid,
                    "first_exit": -signal.SIGKILL, "resume_exit": resumed.returncode,
                    "before_model_state": before["model_states"][0],
                    "after": after, "wire": observed, "external_attempts": 0}
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
    parser.add_argument("--phase", choices=["start", "resume", "cancel", "outbox-write", "outbox-ack", "outbox-read", "outbox-tests"])
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
    output.mkdir(mode=0o700)
    cases = []
    record = {"scope": "AUTHOR_SYNTHETIC_WORKER_SIGKILL_PROGRAM_RECOVERY",
              "snapshot": checked, "python": sys.version.split()[0],
              "production_database_or_credentials_used": False,
              "real_provider_or_model_requests": 0,
              "real_executor_outbox_qualified": False, "cases": cases}
    try:
        for mode in ("unknown", "retained", "cancelled"):
            cases.append(exercise(Path(__file__).resolve(), root, output, mode))
        assert snapshot(root, args.pins) == checked
        record["snapshot_unchanged"] = True
        if producer:
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
