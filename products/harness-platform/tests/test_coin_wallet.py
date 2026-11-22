"""Exercise the prepaid account through the signed-in routes, native agent and scoped gateway."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import os
import sqlite3
import time
import unittest
from unittest.mock import patch

from platform_core.coin_review import resolve
from platform_core.identity import IdentityStore
import test_metered_chat_e2e as metered


@unittest.skipUnless(os.environ.get("HARNESS_NODE_MODULES"), "requires native Harness")
class CoinWallet(unittest.TestCase):
    setUp = metered.MeteredChatAcceptance.setUp
    client = metered.MeteredChatAcceptance.client
    actor = metered.MeteredChatAcceptance.actor

    def test_admin_grant_concurrent_turn_and_exact_debit(self):

        with self.client() as c, IdentityStore(self.db) as store:
            store.create_account("buyer", self.password)
            # Represent an existing account created before signup credit was introduced.
            with sqlite3.connect(self.db) as fixture:
                fixture.execute("""DELETE FROM coin_grants WHERE issuer='signup' AND workspace_id=(
                    SELECT workspace_id FROM identity_accounts WHERE login='buyer')""")
            admin, _, _ = self.actor(c, "owner-a")
            user, chat, _ = self.actor(c, "buyer")
            wallet = lambda: c.get("/api/wallet", headers=user).json()
            grant = {"login":"buyer","amount":"3","requestId":"test","reason":"pilot"}
            path = "/api/admin/coin-grants"
            self.assertEqual(c.post(path, headers=user, json=grant).status_code, 403)
            self.assertEqual(c.post(path, json=grant).status_code, 401)
            self.assertEqual(wallet()["available"], "0")
            store.set_paid("buyer", True)
            base = f"/api/chats/{chat}/turns"
            body = {"requestId":"r1","text":"delayed coin fixture"}
            self.assertEqual(c.post(base, headers=user, json=body).status_code, 402)
            pricing = "/api/admin/coin-pricing"
            self.assertEqual(c.post(pricing, headers=user, json={"markupPercent":"90"}).status_code,403)
            self.assertEqual(wallet()["salePrice"]["rubPerCoin"],"1.2")
            self.assertEqual(c.post(pricing,headers=admin,json={"markupPercent":"37.5"}).json()["rubPerCoin"],"1.375")
            self.assertEqual(wallet()["salePrice"]["markupPercent"],"37.5")
            for _ in range(2):
                self.assertEqual(c.post(path,headers=admin,json=grant).status_code, 200)
            self.assertEqual(wallet()["available"],"3")
            self.assertEqual(c.post(path,headers=admin,json={**grant,"amount":"4"}).status_code,400)
            chat2 = c.post("/api/chats", headers=user).json()["chatId"]
            with ThreadPoolExecutor(max_workers=1) as pool:
                active = pool.submit(c.post, base,headers=user,json=body)
                deadline = time.monotonic()+18
                while not self.journal.exists():
                    self.assertLess(time.monotonic(),deadline)
                    time.sleep(.03)
                held = wallet()
                self.assertGreater(Decimal(held["reserved"]),0)
                self.assertEqual(Decimal(held["available"])+Decimal(held["reserved"]),3)
                denied = c.post(f"/api/chats/{chat2}/turns",headers=user,json={"text":"second","requestId":"r2","maxCoins":"0.0000001"})
                self.assertEqual(denied.status_code,402)
                self.assertEqual(active.result(timeout=20).status_code,200)
            self.assertEqual(c.post(base,headers=user,json=body).status_code,200)
            got = wallet()
            # USD 0.000009 at 80 RUB/USD. The purchase markup does not affect usage.
            self.assertEqual((got["available"],got["reserved"]),("2.99928","0"))
            self.assertEqual(len(got["charges"]),1)
            self.assertEqual(got["charges"][0]["coins"],"0.00072")
            self.assertNotIn("meter", got["charges"][0])
            audit = "/api/admin/accounts/buyer/wallet"
            self.assertEqual(c.get(audit).status_code, 401)
            self.assertEqual(c.get(audit, headers=user).status_code, 403)
            self.assertEqual(c.get("/api/admin/accounts/absent/wallet", headers=user).status_code, 403)
            self.assertEqual(c.get("/api/admin/accounts/absent/wallet", headers=admin).status_code, 404)
            record, = c.get(audit, headers=admin).json()["charges"]
            self.assertNotIn("chatId", record)
            self.assertNotIn("requestId", record)
            self.assertEqual(record["meter"]["providerUsd"], "0.000009")
            self.assertEqual(record["meter"]["attempts"][0]["usage"]["input_tokens"], 10)
            store.set_admin("owner-a", False)
            self.assertEqual(c.get(audit, headers=admin).status_code, 403)
        with self.client() as c:
            self.assertEqual(c.get("/api/wallet",headers=user).json()["available"],"2.99928")

    def test_unknown_keeps_hold_until_evidence_and_small_budget_retries(self):
        with self.client() as c:
            user, chat, _ = self.actor(c,"owner-a")
            url = f"/api/chats/{chat}/turns"
            first = {"requestId":"low","text":"normal"}
            # The envelope cannot fund this model step. No external request occurred.
            self.assertEqual(c.post(url,headers=user,json={**first,"maxCoins":"0.001"}).status_code,402)
            self.assertFalse(self.journal.exists())
            self.assertEqual(c.post(url,headers=user,json=first).status_code,200)
            unknown = {"requestId":"unknown","text":"uncertain fixture"}
            self.assertEqual(c.post(url,headers=user,json=unknown).status_code,409)
        with sqlite3.connect(self.db) as db:
            attempt, = db.execute("SELECT attempt_id FROM coin_attempts WHERE charge IS NULL").fetchone()
        with self.client() as c:
            def wallet(): return c.get("/api/wallet",headers=user).json()
            self.assertGreater(Decimal(wallet()["reserved"]),0)
            self.assertEqual(c.post(url,headers=user,json=unknown).status_code,409)
            for _ in range(2):
                resolve(self.db, attempt, "0.00003", "provider-reference")
            self.assertEqual(wallet()["reserved"],"0")
            self.assertEqual(wallet()["available"],"9.99688")
            with self.assertRaises(ValueError):
                resolve(self.db,attempt,"0","different")
