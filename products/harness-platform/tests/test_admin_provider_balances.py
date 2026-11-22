import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.provider_balances import BalanceMonitor


class BalanceAPI(unittest.TestCase):
    path = "/api/admin/provider-balances"

    def test_settings_and_refresh_are_admin_only_and_interval_persists(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        origin = {"Origin": "https://example.test"}

        async def fake_balances(_monitor, provider):
            return [{"currency": "USD", "amount": "0.01" if provider == "deepseek" else "2.50"}], None

        with patch.object(BalanceMonitor, "fetch", fake_balances):
            with TestClient(create_app(root/"identity.sqlite3", root/"chat"), base_url="https://example.test") as client:
                identity = client.app.state.identity
                for login in ("owner", "seller"):
                    identity.create_account(login, "Fixture passphrase")
                identity.set_admin("owner", True)
                owner = identity.login("owner", "Fixture passphrase")
                seller = identity.login("seller", "Fixture passphrase")
                self.assertEqual(client.get(self.path).status_code, 401)
                client.cookies.set("__Host-harness_session", seller, path="/")
                self.assertEqual(client.get(self.path).status_code, 403)
                self.assertEqual(client.post(self.path + "/refresh", headers=origin).status_code, 403)
                client.cookies.set("__Host-harness_session", owner, path="/")
                self.assertEqual(client.get(self.path).json()["intervalMinutes"], 60)
                self.assertIn('id="balance-heading"', client.get("/admin").text)
                wrong_origin = {"Origin": "https://foreign.test"}
                self.assertEqual(client.post(self.path + "/refresh", headers=wrong_origin).status_code, 403)
                data = client.post(self.path + "/refresh", headers=origin).json()
                self.assertEqual(data["providers"]["openrouter"]["amounts"], [{"currency": "USD", "amount": "2.50"}])
                self.assertTrue(data["providers"]["deepseek"]["updatedAt"])
                for invalid in (False, 0, -1, 1.5, "17"):
                    response = client.post(self.path + "/settings", json={"intervalMinutes": invalid}, headers=origin)
                    self.assertEqual(response.status_code, 400)
                saved = client.post(self.path + "/settings", json={"intervalMinutes": 17}, headers=origin)
                self.assertEqual(saved.json()["intervalMinutes"], 17)
            with TestClient(create_app(root/"identity.sqlite3", root/"chat"), base_url="https://example.test") as client:
                client.cookies.set("__Host-harness_session", owner, path="/")
                self.assertEqual(client.get(self.path).json()["intervalMinutes"], 17)


class BalanceRefresh(unittest.IsolatedAsyncioTestCase):
    async def test_background_refresh_uses_provider_endpoints_and_keeps_last_success(self):
        calls = []
        unavailable = False

        def handle(request):
            calls.append((request.url.host, request.url.path))
            if request.url.host == "api.deepseek.com":
                self.assertEqual(request.headers["Authorization"], "Bearer fixture-deepseek")
                return httpx.Response(200, json={"balance_infos": [
                    {"currency": "USD", "total_balance": "0.10"},
                    {"currency": "CNY", "total_balance": "0.00"},
                ]})
            self.assertEqual(request.headers["Authorization"], "Bearer fixture-openrouter")
            if unavailable:
                return httpx.Response(503)
            return httpx.Response(200, json={"data": {"total_credits": 0.3, "total_usage": 0.1}})

        async def wait_for_refresh(monitor, expected):
            async with asyncio.timeout(2):
                while monitor.last_check != expected:
                    await asyncio.sleep(0.005)

        tick = 100.0
        with tempfile.TemporaryDirectory() as temp, RegistrationStore(Path(temp)/"identity.sqlite3") as identity:
            async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as http:
                router = SimpleNamespace(http=http, credential=lambda: "fixture-openrouter")
                with patch("platform_core.provider_balances.monotonic", lambda: tick), patch(
                    "platform_core.provider_balances.provider_keys.read", return_value="fixture-deepseek"
                ):
                    monitor = BalanceMonitor(identity, http, router)
                    try:
                        await wait_for_refresh(monitor, tick)
                        self.assertEqual(set(calls), {
                            ("api.deepseek.com", "/user/balance"), ("openrouter.ai", "/api/v1/credits"),
                        })
                        self.assertEqual(len(calls), 2)
                        self.assertEqual(monitor.rows["deepseek"]["amounts"][1]["amount"], "0.00")
                        self.assertEqual(monitor.rows["openrouter"]["amounts"][0]["amount"], "0.2")
                        updated = monitor.rows["openrouter"]["updatedAt"]
                        tick += 59 * 60
                        monitor.wake.set()
                        await asyncio.sleep(0.015)
                        self.assertEqual(len(calls), 2)
                        unavailable = True
                        tick += 60
                        monitor.wake.set()
                        await wait_for_refresh(monitor, tick)
                        self.assertEqual(len(calls), 4)
                        self.assertEqual(monitor.rows["openrouter"]["updatedAt"], updated)
                        self.assertEqual(monitor.rows["openrouter"]["amounts"][0]["amount"], "0.2")
                        self.assertIn("503", monitor.rows["openrouter"]["error"])
                    finally:
                        await monitor.close()
