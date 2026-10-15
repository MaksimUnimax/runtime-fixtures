"""No browser launch: real loopback server and a refusal before Playwright entry."""
import http.server
import importlib.util
import json
from pathlib import Path
import socketserver
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import urllib.request

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from browser_fixture_shutdown import assert_http_fixture_stopped


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()

    def log_message(self, *args):
        pass


class CleanupTests(unittest.TestCase):
    def fixture(self):
        raw = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        raw.daemon_threads = False
        raw.block_on_close = True
        thread = threading.Thread(target=raw.serve_forever)
        thread.start()
        return SimpleNamespace(_server=raw, thread=thread)

    def stop(self, fixture):
        fixture._server.shutdown()
        fixture.thread.join(2)
        fixture._server.server_close()

    def test_no_requests_standard_sentinel(self):
        fixture = self.fixture()
        self.stop(fixture)
        self.assertIsInstance(fixture._server._threads, socketserver._NoThreads)
        assert_http_fixture_stopped(fixture)

    def test_real_request_standard_registry(self):
        fixture = self.fixture()
        try:
            urllib.request.urlopen("http://127.0.0.1:" + str(fixture._server.server_port), timeout=2).close()
        finally:
            self.stop(fixture)
        self.assertIsInstance(fixture._server._threads, socketserver._Threads)
        assert_http_fixture_stopped(fixture)

    def test_live_consumer_is_not_reported_stopped(self):
        gate = threading.Event()
        worker = threading.Thread(target=lambda: gate.wait(2))
        worker.start()
        registry = socketserver._Threads()
        registry.append(worker)
        raw = SimpleNamespace(daemon_threads=False, block_on_close=True, _threads=registry)
        fixture = SimpleNamespace(_server=raw, thread=SimpleNamespace(is_alive=lambda: False))
        try:
            with self.assertRaisesRegex(AssertionError, "REQUEST_THREAD_STILL_ACTIVE"):
                assert_http_fixture_stopped(fixture)
        finally:
            gate.set()
            worker.join(2)

    def test_unknown_registry_is_not_reported_stopped(self):
        fixture = SimpleNamespace(_server=SimpleNamespace(
            daemon_threads=False, block_on_close=True, _threads=object()),
            thread=SimpleNamespace(is_alive=lambda: False))
        with self.assertRaisesRegex(AssertionError, "REGISTRY_UNKNOWN"):
            assert_http_fixture_stopped(fixture)

    def early_refusal(self, shutdown_failure=False):
        spec = importlib.util.spec_from_file_location("browser_start_entry", HERE / "browser_start_entry.py")
        entry = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(entry)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = root / "input"
            runtime.mkdir()
            (runtime / "service_worker.js").write_text(
                "config-local-development\n"
                "MCowBQYDK2VwAyEAFG3DxyJOAU0cI1T50i6+tDUonQ74Qzw1Ra6USuEWYRg=\n"
                "69e2ddf7c78d4221d06b65be0212063b923e4e827c2e271385fef0d04cce85dc\n")
            output = root / "output"
            created = []
            real = entry.FirstBootstrapServer

            def create(private):
                server = real(private)
                created.append(server)
                if shutdown_failure:
                    stop = server.stop
                    def fail_after_stop():
                        stop()
                        raise RuntimeError("SYNTHETIC_STOP_UNPROVEN")
                    server.stop = fail_after_stop
                return server

            class RefusedBeforeBrowser:
                def __enter__(self):
                    raise RuntimeError("SYNTHETIC_BROWSER_START_REFUSED")
                def __exit__(self, *args):
                    return False

            try:
                with patch.object(sys, "argv", ["entry", "--runtime", str(runtime), "--output", str(output)]), \
                     patch.object(entry, "FirstBootstrapServer", side_effect=create), \
                     patch.object(entry, "sync_playwright", return_value=RefusedBeforeBrowser()):
                    with self.assertRaisesRegex(RuntimeError, "^SYNTHETIC_BROWSER_START_REFUSED$"):
                        entry.main()
                report = json.loads((output / "result.json").read_text())
                self.assertEqual(report["status"], "FAIL")
                self.assertEqual(report["error"], "SYNTHETIC_BROWSER_START_REFUSED")
                self.assertEqual(report["fixture_signing_key_removed"], not shutdown_failure)
                if shutdown_failure:
                    self.assertEqual(report["synthetic_shutdown_errors"], ["server_RuntimeError"])
                    self.assertEqual(report["fixture_signing_key_cleanup_deferred"], "SHUTDOWN_NOT_PROVEN")
                else:
                    self.assertNotIn("synthetic_shutdown_errors", report)
            finally:
                for server in created:
                    if server.thread.is_alive():
                        real.stop(server)
                    self.assertFalse(server.thread.is_alive())

    def test_early_refusal_preserves_primary_and_cleans_own_key(self):
        self.early_refusal()

    def test_true_cleanup_uncertainty_preserves_primary_and_defers_key(self):
        self.early_refusal(shutdown_failure=True)


if __name__ == "__main__":
    unittest.main()
