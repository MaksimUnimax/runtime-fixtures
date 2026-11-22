import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.provider_balances import BalanceMonitor
from platform_core.telegram_api import Config, DeliveryError


class AdminBalanceAlerts(unittest.TestCase):
    prefix = "/api/admin/provider-balances"
    origin = {"Origin": "https://example.test"}

    def test_alert_episode_rate_test_delivery_and_admin_reconnect(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        value = {"deepseek": ("0.10", "3.50"), "openrouter": ("0.25", "0")}

        async def fetch(_monitor, provider):
            usd, yuan = value[provider]
            return [{"currency": "USD", "amount": usd}, {"currency": "CNY", "amount": yuan}], None

        cfg = Config(bot="12345", secret=None, token="fixture-not-a-live-token", username="fixture_bot")
        self.enterContext(patch("platform_core.telegram_api.Config.load", return_value=cfg))
        self.enterContext(patch.object(BalanceMonitor, "fetch", fetch))
        client = self.enterContext(TestClient(create_app(root/"identity.sqlite3", root/"chat"),
                                              base_url="https://example.test"))
        identity = client.app.state.identity
        identity.create_account("owner", "Fixture passphrase")
        identity.create_account("seller", "Fixture passphrase")
        identity.set_admin("owner", True)
        seller = identity.login("seller", "Fixture passphrase")
        client.cookies.set("__Host-harness_session", seller, path="/")
        self.assertEqual(client.post(self.prefix + "/telegram-connect", json={}, headers=self.origin).status_code, 403)
        self.assertEqual(client.post(self.prefix + "/telegram-test", headers=self.origin).status_code, 403)
        owner = identity.login("owner", "Fixture passphrase")
        client.cookies.set("__Host-harness_session", owner, path="/")

        def post(action, **kwargs):
            return client.post(self.prefix + "/" + action, headers=self.origin, **kwargs)

        self.assertEqual(post("telegram-test").status_code, 409)
        self.assertIn("Переподключить Telegram", post("telegram-test").json()["error"])
        self.assertEqual(post("alert-settings", json={"thresholdUsd": "1.00", "cnyPerUsd": "7"}).status_code, 200)
        with identity._write() as db:
            ws = db.execute("SELECT workspace_id FROM identity_accounts WHERE login='owner'").fetchone()[0]
            db.execute("INSERT INTO telegram_recipients VALUES(?,?,?)", (ws, cfg.bot, 42))
        telegram = client.app.state.telegram
        sender = self.enterContext(patch.object(telegram, "send", new_callable=AsyncMock))
        settings = client.get(self.prefix).json()["telegramAlerts"]
        self.assertEqual((settings["enabled"], settings["thresholdUsd"], settings["cnyPerUsd"]), (True, "1.00", "7"))
        self.assertEqual(post("alert-settings", json={"thresholdUsd": "0", "cnyPerUsd": "7"}).status_code, 400)
        self.assertEqual(post("alert-settings", json={"thresholdUsd": "1", "cnyPerUsd": "bad"}).status_code, 400)
        self.assertEqual(post("refresh").status_code, 200)
        self.assertEqual(sender.await_count, 1)
        workspace, text = sender.await_args.args
        self.assertEqual(workspace, ws)
        self.assertIn("DeepSeek: 0.6000 USD", text)
        self.assertIn("OpenRouter: 0.2500 USD", text)
        self.assertEqual(post("refresh").status_code, 200)
        self.assertEqual(sender.await_count, 1)
        value["deepseek"] = ("0.10", "7.00")
        self.assertEqual(post("refresh").status_code, 200)
        value["deepseek"] = ("0.10", "1.40")
        self.assertEqual(post("refresh").status_code, 200)
        self.assertEqual(sender.await_count, 2)
        self.assertIn("DeepSeek: 0.3000 USD", sender.await_args.args[1])
        self.assertNotIn("OpenRouter", sender.await_args.args[1])

        result = post("telegram-test")
        self.assertEqual(result.status_code, 200)
        self.assertIn("DeepSeek: 0.10 USD + 1.40 CNY", sender.await_args.args[1])
        self.assertIn("OpenRouter: 0.25 USD", sender.await_args.args[1])
        self.assertEqual(sender.await_count, 3)
        sender.side_effect = DeliveryError("blocked")
        error = post("telegram-test")
        self.assertEqual(error.status_code, 409)
        self.assertIn("Переподключить Telegram", error.json()["error"])
        connect = post("telegram-connect", json={})
        self.assertEqual(connect.status_code, 200)
        self.assertIn("/telegram/return?widget=1", connect.json()["url"])
        with identity._lock:
            stored = identity._db.execute("SELECT threshold,cny_per_usd FROM provider_balance_alert_settings").fetchone()
        self.assertEqual(stored, ("1.00", "7"))
