"""Deterministic worker-start observer contract; no real browser or provider."""
from pathlib import Path
import importlib.util
import unittest

SOURCE = Path(__file__).resolve().with_name("browser_application.py")
spec = importlib.util.spec_from_file_location("octo_browser_application_worker", SOURCE)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Worker:
    url = "chrome-extension://synthetic/background.js"


class FakeContext:
    def __init__(self, worker, initial_blank=0):
        self.worker = worker
        self.initial_blank = initial_blank
        self.observations = 0
        self.events = 0

    @property
    def service_workers(self):
        self.observations += 1
        return [] if self.observations <= self.initial_blank or self.worker is None else [self.worker]

    def wait_for_event(self, event, timeout=None):
        self.events += 1
        raise AssertionError("MISSED_SERVICEWORKER_EVENT")


class WorkerDiscoveryContract(unittest.TestCase):
    def test_existing_worker_observed(self):
        worker = Worker()
        ctx = FakeContext(worker)
        self.assertIs(module.discover_service_worker(ctx, timeout=.1), worker)
        self.assertEqual(ctx.events, 0)

    def test_worker_visible_after_initial_snapshot_without_new_event(self):
        worker = Worker()
        ctx = FakeContext(worker, initial_blank=1)
        self.assertIs(module.discover_service_worker(ctx, timeout=.3), worker)
        self.assertEqual(ctx.events, 0)

    def test_missing_worker_still_fails_closed(self):
        ctx = FakeContext(None)
        with self.assertRaises(AssertionError):
            module.discover_service_worker(ctx, timeout=.01)


class FakePage:
    def wait_for_timeout(self, milliseconds):
        assert milliseconds == 150


class FakeSession:
    def __init__(self, fail=False):
        self.callbacks = {}
        self.fail = fail
        self.detached = False

    def on(self, event, callback):
        self.callbacks[event] = callback

    def send(self, method):
        if self.fail:
            raise RuntimeError("SENSITIVE_DIAGNOSTIC_ERROR_MUST_NOT_LEAK")
        if method == "Target.getTargets":
            return {"targetInfos": [
                {"type": "page", "targetId": "private", "url": "https://private/token"},
                {"type": "service_worker", "targetId": "privateWorker",
                 "url": "chrome-extension://private/service_worker.js"},
                {"type": "background_page", "url": "chrome-extension://private/bg.html"},
            ]}
        assert method == "ServiceWorker.enable"
        self.callbacks["ServiceWorker.workerRegistrationUpdated"]({
            "registrations": [
                {"scopeURL": "chrome-extension://private/", "isDeleted": False},
                {"scopeURL": "chrome-extension://private/old", "isDeleted": True},
            ]})
        self.callbacks["ServiceWorker.workerVersionUpdated"]({
            "versions": [{"runningStatus": "running", "scriptURL": "private"},
                         {"runningStatus": "stopped", "scriptURL": "private"}]})
        self.callbacks["ServiceWorker.workerErrorReported"]({
            "errorMessage": "SENSITIVE_INTERNAL_ERROR"})
        return {}

    def detach(self):
        self.detached = True


class FakeDiagnosticContext:
    def __init__(self, with_page=True, fail=False):
        self.service_workers = []
        self.pages = [FakePage()] if with_page else []
        self.session = FakeSession(fail=fail)
        self.cdp_sessions_created = 0

    def new_cdp_session(self, page):
        assert page is self.pages[0]
        self.cdp_sessions_created += 1
        return self.session


class WorkerStartupDiagnosticsContract(unittest.TestCase):
    def test_cdp_counters_are_bounded_and_do_not_serialize_urls_or_error_details(self):
        context = FakeDiagnosticContext()
        result = module.snapshot_worker_startup_diagnostics(context)
        self.assertEqual(result["playwright_worker_count"], 0)
        self.assertEqual(result["existing_page_count"], 1)
        self.assertEqual(result["cdp_worker_targets"], 1)
        self.assertEqual(result["cdp_background_targets"], 1)
        self.assertEqual(result["registered"], 2)
        self.assertEqual(result["deleted"], 1)
        self.assertEqual(result["worker_versions"], 2)
        self.assertEqual(result["worker_running"], 1)
        self.assertEqual(result["worker_errors"], 1)
        self.assertEqual(result["cdp_status"], "COUNTS_OBSERVED")
        self.assertTrue(context.session.detached)
        self.assertNotIn("private", str(result))
        self.assertNotIn("SENSITIVE", str(result))

    def test_missing_page_does_not_create_new_page_or_fake_worker(self):
        context = FakeDiagnosticContext(with_page=False)
        result = module.snapshot_worker_startup_diagnostics(context)
        self.assertEqual(result["cdp_status"], "NO_EXISTING_PAGE")
        self.assertEqual(result["existing_page_count"], 0)
        self.assertEqual(context.cdp_sessions_created, 0)

    def test_cdp_failure_returns_error_class_without_sensitive_text(self):
        context = FakeDiagnosticContext(fail=True)
        result = module.snapshot_worker_startup_diagnostics(context)
        self.assertEqual(result["cdp_status"], "UNAVAILABLE")
        self.assertEqual(result["cdp_error_class"], "RuntimeError")
        self.assertTrue(context.session.detached)
        self.assertNotIn("SENSITIVE", str(result))


if __name__ == "__main__":
    unittest.main()
