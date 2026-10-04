import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("maintenance_client", Path(__file__).with_name("maintenance-client.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
TOKEN = "octm_00000000-0000-4000-8000-000000000001_" + "a" * 43
NEXT = "octm_00000000-0000-4000-8000-000000000001_" + "b" * 43

class MaintenanceClientTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "credential.json"
        self.now = 2_000_000_000
        self.data = {"version": 1, "origin": module.ORIGIN, "token": TOKEN,
                     "expiresAt": module.iso(self.now + 86400 * 20),
                     "rotatedAt": module.iso(self.now - 86400 * 2)}
        module.save_private(self.path, self.data)

    def test_rotation_is_saved_before_command_and_does_not_need_portal_cookie(self):
        calls = []
        def send(method, path, token, body):
            calls.append((method, path, token, body))
            if path.endswith("/rotate"):
                self.assertIn("pendingNonce", json.loads(self.path.read_text()))
                return {"token": NEXT, "expiresAt": module.iso(self.now + 86400 * 30)}
            self.assertEqual(json.loads(self.path.read_text())["token"], NEXT)
            return {"ok": True}
        client = module.MaintenanceClient(self.path, send, lambda: self.now)
        self.assertEqual(client.request("GET", "/v1/admin/compatibility/policies"), {"ok": True})
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][2], NEXT)
        self.assertNotIn("pendingNonce", json.loads(self.path.read_text()))
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)

    def test_unknown_rotation_outcome_reuses_saved_nonce_and_never_sends_mutation(self):
        nonces = []
        def send(method, path, token, body):
            if path == "/v1/admin/me":
                raise module.MaintenanceError("HTTP_401")
            self.assertTrue(path.endswith("/rotate"))
            nonces.append(body["nonce"])
            raise module.MaintenanceError("REQUEST_OUTCOME_UNKNOWN")
        client = module.MaintenanceClient(self.path, send, lambda: self.now)
        for _ in range(2):
            with self.assertRaisesRegex(module.MaintenanceError, "UNKNOWN"):
                client.request("POST", "/v1/admin/compatibility/example", {})
        self.assertEqual(nonces[0], nonces[1])

    def test_does_not_automatically_replay_an_unknown_admin_mutation(self):
        self.data["rotatedAt"] = module.iso(self.now)
        module.save_private(self.path, self.data)
        calls = []
        def send(*args):
            calls.append(args)
            raise module.MaintenanceError("REQUEST_OUTCOME_UNKNOWN")
        with self.assertRaisesRegex(module.MaintenanceError, "UNKNOWN"):
            module.MaintenanceClient(self.path, send, lambda: self.now).request(
                "POST", "/v1/admin/compatibility/example", {})
        self.assertEqual(len(calls), 1)

    def test_rejects_other_origin_expired_file_loose_permissions_and_scope(self):
        def forbidden(*args):
            self.fail("Network must not be used")
        client = module.MaintenanceClient(self.path, forbidden, lambda: self.now)
        for path in ["/v1/admin/principals", "//other.example/x",
                     "/v1/admin/compatibility/../principals", "/v1/admin/compatibility/%2e"]:
            with self.assertRaises(module.MaintenanceError):
                client.request("GET", path)
        self.data["origin"] = "https://other.example"
        module.save_private(self.path, self.data)
        with self.assertRaises(module.MaintenanceError):
            client.request("GET", "/v1/admin/compatibility/policies")
        self.data["origin"] = module.ORIGIN
        self.data["expiresAt"] = module.iso(self.now)
        module.save_private(self.path, self.data)
        with self.assertRaisesRegex(module.MaintenanceError, "EXPIRED"):
            client.request("GET", "/v1/admin/compatibility/policies")
        os.chmod(self.path, 0o644)
        with self.assertRaisesRegex(module.MaintenanceError, "NOT_PRIVATE"):
            client.request("GET", "/v1/admin/compatibility/policies")

    def test_recovers_committed_rotation_after_replay_window_without_reissuing(self):
        import base64
        import hashlib
        import hmac
        nonce = "n" * 43
        self.data["pendingNonce"] = nonce
        module.save_private(self.path, self.data)
        digest = hmac.new(TOKEN.encode(),
            b"octoport/maintenance/rotate/v1\0" + nonce.encode(), hashlib.sha256).digest()
        expected = TOKEN[:42] + base64.urlsafe_b64encode(digest).decode().rstrip("=")
        calls = []
        def send(method, path, token, body):
            calls.append((method, path))
            self.assertEqual(token, expected)
            if path == "/v1/admin/me":
                return {"status": "authenticated", "roles": [],
                        "permissions": ["compatibility.read"],
                        "expiresAt": module.iso(self.now + 86400 * 25)}
            return {"ok": True}
        result = module.MaintenanceClient(self.path, send, lambda: self.now).request(
            "GET", "/v1/admin/compatibility/policies")
        self.assertEqual(result, {"ok": True})
        self.assertEqual(calls, [("GET", "/v1/admin/me"), ("GET", "/v1/admin/compatibility/policies")])
        self.assertEqual(json.loads(self.path.read_text())["token"], expected)
        self.assertNotIn("pendingNonce", json.loads(self.path.read_text()))

if __name__ == "__main__":
    unittest.main()
