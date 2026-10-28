"""Offline fault controls for the browser proof, not browser acceptance."""
import copy
import tempfile
import unittest
from contextlib import contextmanager, nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import browser_transfer_vault_restart as proof


class BrowserVaultProofTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="vault-proof-controls-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "manifest.json").write_text(
            '{"background":{"service_worker":"worker.js"}}')
        (self.root / "worker.js").write_text("/* inert fixture */")
        self.args = SimpleNamespace(runtime=self.root, label="offline-controls", executable=None)
        self.active = {
            "requestId": proof.REQUEST, "accountId": proof.ACCOUNT,
            "recipientDeviceId": proof.RECIPIENT, "sessionId": proof.SESSION,
            "sourceDeviceId": proof.SOURCE, "phase": "ACTIVE",
            "selectedStoreIds": ["fixture"], "expiresAt": "2099-01-01T00:00:00Z",
            "packetId": None, "result": None, "publicKeySpki": "fixture-public",
        }
        self.pending = {**self.active, "phase": "IMPORTED_PENDING_ACK",
                        "packetId": proof.PACKET,
                        "result": {"importState": "IMPORTED", "results": [{"storeId": "fixture", "kind": "IMPORTED"}]}}

    def exercise(self, *, active_change=None, pending_change=None, close_failure=None):
        opened, closed, profiles = [], [], []

        @contextmanager
        def fixture_worker(pw, profile, options, runtime, entry, expected_id=None):
            number = len(opened)
            opened.append(number)
            profiles.append(profile)
            self.assertEqual(expected_id, None if number == 0 else "a" * 32)
            try:
                yield number, "a" * 32
            finally:
                closed.append(number)
                if close_failure == number:
                    raise RuntimeError("owned context close failed")

        def evaluate(number, source, values):
            if number == 0:
                return {"envelope": "inert", "expiresAt": self.active["expiresAt"],
                        "publicKeySpki": self.active["publicKeySpki"],
                        "activeMetadata": copy.deepcopy(self.active)}
            if number == 1:
                active = copy.deepcopy(self.active)
                if active_change:
                    active_change(active)
                return {"activeMetadata": active, "metadata": copy.deepcopy(self.pending)}
            result = copy.deepcopy(self.pending)
            if pending_change:
                pending_change(result)
            return result

        with patch.object(proof, "sync_playwright", return_value=nullcontext(object())), \
             patch.object(proof, "opened_worker", fixture_worker), \
             patch.object(proof, "evaluate", evaluate):
            try:
                result = proof.run(self.args)
            finally:
                self.assertEqual(closed, opened, "failed proof closes every opened owned context")
                self.assertEqual(len(set(profiles)), 1, "restarts use one owned persistent profile")
        self.assertEqual(len(opened), 3)
        self.assertEqual(result["status"], "PASS")
        self.assertFalse(result["apiRelayAndCatalogAcceptance"])
        self.assertFalse(result["installedOwnerAcceptance"])

    def test_healthy_control_keeps_claims_scoped(self):
        self.exercise()

    def test_changed_active_identity_is_not_accepted(self):
        for field in ("accountId", "recipientDeviceId", "sessionId", "sourceDeviceId"):
            with self.subTest(field=field), self.assertRaises(AssertionError):
                self.exercise(active_change=lambda row: row.update({field: "changed"}))

    def test_changed_pending_fields_are_not_accepted(self):
        for field, value in (("phase", "ACTIVE"), ("packetId", "P2"),
                             ("expiresAt", "2099-02-01T00:00:00Z"),
                             ("selectedStoreIds", ["foreign-store"]),
                             ("result", {"importState": "IMPORTED", "results": []})):
            with self.subTest(field=field), self.assertRaises(AssertionError):
                self.exercise(pending_change=lambda row: row.update({field: value}))

    def test_each_failed_browser_close_prevents_pass(self):
        for number in range(3):
            with self.subTest(number=number), self.assertRaisesRegex(RuntimeError, "close failed"):
                self.exercise(close_failure=number)

    def test_real_opened_worker_closes_on_selection_failure(self):
        closed = []
        context = SimpleNamespace(close=lambda: closed.append(True))
        pw = SimpleNamespace(chromium=SimpleNamespace(launch_persistent_context=lambda *a, **k: context))
        with patch.object(proof, "worker", side_effect=RuntimeError("identity mismatch")):
            with self.assertRaisesRegex(RuntimeError, "identity mismatch"):
                with proof.opened_worker(pw, "owned", {}, self.root, "worker.js"):
                    self.fail("selection failure reached consumer")
        self.assertEqual(closed, [True])

    def test_symlink_preflight_never_launches_browser(self):
        outside = self.root / "outside.js"
        outside.write_text("/* inert */")
        worker = self.root / "worker.js"
        worker.unlink()
        worker.symlink_to(outside)
        with patch.object(proof, "sync_playwright") as launch:
            with self.assertRaisesRegex(RuntimeError, "symlink"):
                proof.run(self.args)
            launch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
