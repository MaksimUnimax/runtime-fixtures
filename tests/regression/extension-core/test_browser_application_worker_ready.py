"""Deterministic worker-start observer contract; no real browser or provider."""
from pathlib import Path
import importlib.util
import unittest
from unittest.mock import patch
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError

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
        # No new event: a later snapshot may still expose an existing worker.
        assert event == "serviceworker" and timeout > 0
        raise PlaywrightTimeoutError("NO_NEW_SERVICEWORKER_EVENT")


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


class DispatchClock:
    def __init__(self):
        self.value = 0.0
        self.sleeps = 0

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.sleeps += 1
        self.value += seconds


class DispatchGatedContext:
    """Cached properties do not dispatch: only the sync wait runs driver events."""
    def __init__(self, clock, mode):
        self.clock, self.mode = clock, mode
        self.worker = Worker()
        self.visible = []
        self.waits = []

    @property
    def service_workers(self):
        return list(self.visible)

    def wait_for_event(self, event, timeout=None):
        assert event == "serviceworker" and timeout > 0
        self.waits.append(timeout)
        self.clock.value += min(timeout / 1000, 0.005)
        if self.mode == "closed":
            raise RuntimeError("CONTEXT_CLOSED")
        if self.mode in ("event", "missed_event"):
            self.visible = [self.worker]
        if self.mode in ("event", "unlisted_event"):
            return self.worker
        self.clock.value += max(0, timeout / 1000 - 0.005)
        raise PlaywrightTimeoutError("NO_NEW_SERVICEWORKER_EVENT")


class SynchronousDispatchContract(unittest.TestCase):
    def discover(self, context, timeout=0.25):
        with patch.object(module.time, "monotonic", context.clock.now), \
             patch.object(module.time, "sleep", context.clock.sleep):
            return module.discover_service_worker(context, timeout=timeout)

    def test_queued_worker_requires_driver_event_dispatch(self):
        ctx = DispatchGatedContext(DispatchClock(), "event")
        self.assertIs(self.discover(ctx), ctx.worker)
        self.assertGreater(len(ctx.waits), 0)
        self.assertEqual(ctx.clock.sleeps, 0)

    def test_snapshot_is_rechecked_after_missed_event_timeout(self):
        ctx = DispatchGatedContext(DispatchClock(), "missed_event")
        self.assertIs(self.discover(ctx), ctx.worker)
        self.assertEqual(ctx.clock.sleeps, 0)

    def test_missing_worker_keeps_one_deadline_and_fails_closed(self):
        ctx = DispatchGatedContext(DispatchClock(), "never")
        with self.assertRaisesRegex(AssertionError, "Timed out waiting for browser state"):
            self.discover(ctx)
        self.assertTrue(ctx.waits)
        self.assertTrue(all(0 < wait <= 100 for wait in ctx.waits))
        self.assertAlmostEqual(sum(ctx.waits), 250)
        self.assertEqual(ctx.clock.sleeps, 0)

    def test_event_without_current_worker_does_not_become_success(self):
        ctx = DispatchGatedContext(DispatchClock(), "unlisted_event")
        with self.assertRaises(AssertionError):
            self.discover(ctx, timeout=0.02)
        self.assertTrue(ctx.waits)
        self.assertLessEqual(ctx.clock.value, 0.0200001)

    def test_non_timeout_driver_error_is_not_swallowed(self):
        ctx = DispatchGatedContext(DispatchClock(), "closed")
        with self.assertRaisesRegex(RuntimeError, "CONTEXT_CLOSED"):
            self.discover(ctx)
        self.assertEqual(len(ctx.waits), 1)

    def test_zero_budget_does_not_disable_playwright_timeout(self):
        ctx = DispatchGatedContext(DispatchClock(), "event")
        with self.assertRaises(AssertionError):
            self.discover(ctx, timeout=0)
        self.assertEqual(ctx.waits, [])


if __name__ == "__main__":
    unittest.main()
