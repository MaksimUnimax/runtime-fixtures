"""Statistics access, token accounting and durable signup settings."""
import json
import tempfile
import unittest
from pathlib import Path
from decimal import Decimal
from unittest.mock import patch

from starlette.testclient import TestClient

from platform_core import coins
from platform_core.admin_statistics import read_statistics
from platform_core.chat_api import create_app


class Statistics(unittest.TestCase):
    def setUp(self):
        work = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.client = self.enterContext(TestClient(create_app(work / "identity.sqlite3", work / "chat"),
                                                   base_url="https://example.test"))
        self.store = self.client.app.state.identity
        self.password = "Private fixture password"
        self.store.create_account("administrator", self.password)
        self.store.set_admin("administrator", True)
        self.store.create_account("<old-account>", self.password)
        self.owner = self.store.login("administrator", self.password)
        self.user = self.store.login("<old-account>", self.password)

    def use(self, token):
        self.client.cookies.set("__Host-harness_session", token, path="/")

    def post(self, path, payload, origin="https://example.test"):
        return self.client.post(path, headers={"Origin":origin}, data=payload, follow_redirects=False)

    def test_admin_setting_applies_to_future_registrations_only(self):
        page = "/admin/statistics"
        self.assertEqual(self.client.get(page).status_code, 401)
        self.use(self.user)
        self.assertEqual(self.client.get(page).status_code, 403)
        self.assertEqual(self.post(page, {"amount":"2"}).status_code, 403)
        self.use(self.owner)
        current = self.client.get(page)
        self.assertEqual(current.status_code, 200)
        self.assertIn("&lt;old-account&gt;", current.text)
        self.assertIn('value="10"', current.text)
        self.assertEqual(self.post(page, {"amount":"2"}, "https://other.test").status_code, 403)
        self.assertEqual(self.post(page, {"amount":"-1"}).status_code, 400)
        self.assertEqual(self.post(page, {"amount":"3.25"}).status_code, 303)
        self.assertEqual(self.client.get("/api/signup-bonus").json(), {"coins":"3.25"})

        access = self.client.app.state.account_access
        out = {}
        access.mail = lambda email, code: out.update({email:code})
        guest, _ = self.store.start_guest()
        email = "first@example.test"
        stage = access.registration(guest, "first", self.password, email, "127.0.0.1")
        result = access.advance(stage["challenge"], out[email], guest)
        self.assertEqual(self.store.wallet(result["token"], balance_only=True)["available"], "3.25")
        self.assertEqual(self.store.wallet(self.user, balance_only=True)["available"], "10")

        self.assertEqual(self.post(page, {"amount":"0"}).status_code, 303)
        self.store.create_account("future-user", self.password)
        new = self.store.login("future-user", self.password)
        self.assertEqual(self.store.wallet(new, balance_only=True)["available"], "0")
        self.assertEqual(self.client.get("/api/signup-bonus").json(), {"coins":"0"})
        self.assertIn("future-user", self.client.get(page, params={"q":"FUTURE"}).text)

    def test_counts_authenticated_time_credits_and_recorded_provider_usage(self):
        activity = "/api/account/activity"
        self.assertEqual(self.post(activity, {"seconds":"15", "session":"x"}).status_code, 401)
        self.use(self.user)
        session = self.client.get(activity).json()["session"]
        valid = {"seconds":"15","session":session}
        self.assertEqual(self.post(activity, {**valid,"seconds":"21"}).status_code, 400)
        self.assertEqual(self.post(activity, {**valid,"session":"0"*32}).status_code, 401)
        with patch("platform_core.admin_statistics.time", side_effect=[100,100,107]):
            for _ in range(3):
                self.assertEqual(self.post(activity, valid).status_code, 204)
        scope = self.store.create_user_chat(self.user)
        usage = json.dumps({"input_tokens":20, "cache_creation_input_tokens":3,
                            "cache_read_input_tokens":5, "output_tokens":15})
        with self.store._write() as db:
            coins.grant(db, "local-operator", "manual", scope.workspace_id, "2", "Тест")
            coins.grant(db, "yookassa", "paid", scope.workspace_id, "4", "Покупка монет")
            db.execute("""INSERT INTO coin_checkouts(id,workspace_id,request_key,quantity,total,provider_id,status)
                          VALUES('paid-order',?,'checkout',4,'4.80','paid','succeeded'),
                                ('pending',?,'pending',9,'10.80','pending','pending')""",
                       (scope.workspace_id, scope.workspace_id))
            db.execute("INSERT INTO usage_operations VALUES('operation',?,?,?,'chat.turn','run')",
                       (scope.actor_id, scope.workspace_id, scope.chat_id))
            db.execute("""INSERT INTO coin_orders(operation_id,workspace_id,cap,markup,coins_per_usd,closed)
                          VALUES('operation',?,0,0,1,1)""", (scope.workspace_id,))
            db.execute("""INSERT INTO coin_attempts(attempt_id,operation_id,bound,charge,model,started_ms,
                          rate_version,period,usage_json) VALUES('attempt','operation',0,?,'test',0,'openrouter-v1','test',?)""",
                       (coins.UNIT, usage))
        users, total, _, _, _, _ = read_statistics(self.store, self.owner, "old-account", 1)
        row, = users
        self.assertEqual(total, 2)
        self.assertEqual((row["seconds"], row["paid"], row["manual"], row["bonus"], row["available"]),
                         (22, 4*coins.UNIT, 2*coins.UNIT, 10*coins.UNIT, 15*coins.UNIT))
        self.assertEqual(row["rubles"].as_tuple(), Decimal("4.80").as_tuple())
        self.assertEqual(row["meters"]["OpenRouter"], {"input":23,"cache":5,"output":15,"coins":"1"})
