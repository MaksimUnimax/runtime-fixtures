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


if __name__ == "__main__":
    unittest.main()
