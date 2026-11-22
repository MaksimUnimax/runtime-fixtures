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

    def test_server_sorts_before_pagination_and_default_limit_is_ten(self):
        page = "/admin/statistics"
        for number in range(10):
            self.store.create_account(f"extra-{number:02}", self.password)
        with self.store._write() as db:
            for name, seconds, bought, registered, activity in (
                ("administrator",17,"2",100,800),
                ("<old-account>",35,"12",300,200),
                ("extra-09",22,"5",200,500),
            ):
                actor, workspace = db.execute(
                    "SELECT actor_id,workspace_id FROM identity_accounts WHERE login=?", (name,)).fetchone()
                db.execute("UPDATE identity_registration_dates SET created=? WHERE actor_id=?", (registered,actor))
                db.execute("INSERT INTO identity_presence VALUES(?,?,?)", (actor,seconds,activity))
                coins.grant(db,"yookassa",actor,workspace,bought,"Покупка монет")
            db.execute("UPDATE identity_registration_dates SET created=10 WHERE actor_id NOT IN "
                       "(SELECT actor_id FROM identity_presence)")
        self.use(self.owner)
        first = self.client.get(page,params={"sort":"purchased","dir":"desc"})
        self.assertEqual(first.text.count('<th scope="row">'),10)
        self.assertLess(first.text.index("&lt;old-account&gt;"),first.text.index("extra-09"))
        self.assertIn("Страница 1 из 2",first.text)
        second = self.client.get(page,params={"sort":"purchased","dir":"desc","page":"2"})
        self.assertEqual(second.text.count('<th scope="row">'),2)
        self.assertIn("sort=purchased",second.text)
        for limit in (20,50,100):
            self.assertEqual(self.client.get(page,params={"limit":limit}).text.count('<th scope="row">'),12)
        for sort, first_user in (("registered","<old-account>"),("last_seen","administrator"),
                                  ("time","<old-account>"),("balance","<old-account>"),("purchased","<old-account>")):
            rows, *_ = read_statistics(self.store,self.owner,"",1,sort=sort,direction="desc")
            self.assertEqual(rows[0]["login"],first_user,sort)
        oldest, *_ = read_statistics(self.store,self.owner,"",1,sort="registered",direction="asc")
        self.assertEqual(oldest[0]["login"],"extra-00")
        self.assertEqual(self.client.get(page,params={"limit":1}).status_code,400)

    def test_transactional_removal_checks_identity_and_pending_work(self):
        scope = self.store.create_user_chat(self.user)
        with self.store._write() as db:
            administrator, = db.execute("SELECT actor_id FROM identity_admins").fetchone()
            db.execute("""INSERT INTO coin_checkouts(id,workspace_id,request_key,quantity,total,status)
                          VALUES('pending',?,'request',1,'1.20','pending')""",(scope.workspace_id,))
            db.execute("INSERT INTO usage_operations VALUES('op',?,?,?,'chat.turn','run')",
                       (scope.actor_id,scope.workspace_id,scope.chat_id))
            db.execute("""INSERT INTO coin_orders(operation_id,workspace_id,cap,markup,coins_per_usd,closed)
                          VALUES('op',?,0,0,1,1)""",(scope.workspace_id,))
            db.execute("""INSERT INTO coin_attempts(attempt_id,operation_id,bound,charge,model,started_ms,rate_version,period)
                          VALUES('attempt','op',0,0,'fixture',0,'deepseek','fixture')""")
        own_page = f"/admin/statistics/remove?account={administrator}"
        target = f"/admin/statistics/remove?account={scope.actor_id}&q=old&limit=20&sort=time&dir=desc"
        self.use(self.user)
        self.assertEqual(self.client.get(target).status_code,403)
        self.use(self.owner)
        self.assertEqual(self.client.get(own_page).status_code,403)
        self.assertIn("&lt;old-account&gt;",self.client.get(target).text)
        self.assertEqual(self.post(target,{"confirmation":"another"}).status_code,400)
        self.assertEqual(self.post(target,{"confirmation":"<old-account>"}, "https://other.test").status_code,403)
        self.assertEqual(self.post(target,{"confirmation":"<old-account>"}).status_code,409)
        with self.store._write() as db:
            self.assertIsNotNone(db.execute("SELECT 1 FROM identity_accounts WHERE actor_id=?",(scope.actor_id,)).fetchone())
            db.execute("UPDATE coin_checkouts SET status='canceled' WHERE id='pending'")
        response = self.post(target,{"confirmation":"<old-account>"})
        self.assertEqual(response.status_code,303,response.text)
        for item in ("limit=20","sort=time","dir=desc","removed=1"):
            self.assertIn(item,response.headers["location"])
        self.assertEqual(self.post(target,{"confirmation":"<old-account>"}).status_code,404)
        with self.store._lock:
            db = self.store._db
            self.assertIsNone(db.execute("SELECT 1 FROM identity_accounts WHERE actor_id=?",(scope.actor_id,)).fetchone())
            self.assertIsNone(db.execute("SELECT 1 FROM coin_checkouts WHERE workspace_id=?",(scope.workspace_id,)).fetchone())
            self.assertEqual(db.execute("SELECT COUNT(*) FROM coin_attempts").fetchone()[0],0)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM identity_admins").fetchone()[0],1)
            self.assertFalse(db.execute("PRAGMA foreign_key_check").fetchall())
        self.use(self.user)
        self.assertEqual(self.client.get("/api/profile/security").status_code,401)
