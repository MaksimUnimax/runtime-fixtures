import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from uuid import uuid4

from starlette.testclient import TestClient
from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore
from platform_core.checkout import merchant, receipt_data

ORIGIN = "https://platform.test"
HEADERS = {"origin": ORIGIN}


class CheckoutTests(unittest.TestCase):
    def setUp(self):
        temp = self.enterContext(TemporaryDirectory())
        self.db = Path(temp) / "identity.sqlite3"
        with IdentityStore(self.db) as store:
            store.create_account("test@example.org", "password")
        self.client = self.enterContext(TestClient(create_app(self.db, Path(temp)/"chat"), base_url=ORIGIN))
        self.form = {"coins":"3", "total":"3.60", "key":str(uuid4())}
        self.url = "/api/coins/checkout"
        self.enterContext(patch.dict(os.environ, {
            "YOOKASSA_RECEIPT_PROVIDER": "yookassa",
            "YOOKASSA_VAT_CODE": "1",
            "YOOKASSA_PAYMENT_SUBJECT": "service",
            "YOOKASSA_PAYMENT_MODE": "full_payment",
        }))

    def signin(self):
        self.client.post("/login", data={"login":"TEST@example.org", "password":"password"}, headers=HEADERS)

    def post(self, **fields):
        return self.client.post(self.url, data={**self.form, **fields}, headers=HEADERS)

    def test_production_credential_is_fail_closed_and_receipts_validated(self):
        self.assertIsNone(merchant())
        self.assertEqual(receipt_data("test@example.org", 3, "3.60")["items"][0]["vat_code"], 1)
        with TemporaryDirectory() as directory:
            secret = "live_" + ("X" * 44)
            (Path(directory) / "yookassa-config").write_text(
                "Загруженный ключ:\n" + secret + "\nМагазин:\n1538006\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"YOOKASSA_SHOP_ID": "1538006",
                                         "CREDENTIALS_DIRECTORY": directory,
                                         "YOOKASSA_PAYMENTS_ENABLED": "1"}):
                self.assertEqual(merchant(), ("1538006", secret))
                with patch.dict(os.environ, {"YOOKASSA_RECEIPT_PROVIDER": "off"}):
                    self.assertIsNone(merchant())
                with patch.dict(os.environ, {"YOOKASSA_VAT_CODE": "99"}):
                    self.assertIsNone(merchant())
                with patch.dict(os.environ, {"YOOKASSA_SHOP_ID": "9999999"}):
                    self.assertIsNone(merchant())

    def test_no_merchant_and_session_boundaries(self):
        with patch("platform_core.checkout.merchant", return_value=None):
            self.assertFalse(self.client.get("/api/coins/quote?coins=2").json()["enabled"])
            self.assertEqual(self.post().status_code, 401)
            self.signin()
            self.assertEqual(self.post().status_code, 503)
            self.assertEqual(self.client.post(self.url, data=self.form).status_code, 403)
            self.assertEqual(self.client.post("/api/coins/reconcile",
                         data={"key": str(uuid4())}, headers=HEADERS).status_code, 404)
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "10")

    @patch("platform_core.checkout.merchant", return_value=("merchant", "fixture"))
    def test_provider_retry_replay_verified_credit_and_amount(self, auth):
        self.signin()
        pay_id = str(uuid4())
        hosted = "https://yoomoney.ru/checkout/example"
        order = None
        state = "pending"
        async def provider(method, path, _auth, **kwargs):
            nonlocal order
            if method == "POST":
                order = kwargs["headers"]["Idempotence-Key"]
                self.assertEqual(kwargs["json"]["metadata"]["order"], order)
                receipt = kwargs["json"]["receipt"]
                self.assertEqual(receipt["items"][0]["amount"]["value"], "3.60")
                self.assertEqual(receipt["customer"]["email"], "test@example.org")
            else:
                self.assertEqual(path, "/"+pay_id)
            return {"id":pay_id, "amount":{"value":"3.60","currency":"RUB"}, "test":False,
                    "recipient":{"account_id":"merchant"}, "metadata":{"order":order}, "status":state,
                    "paid":state=="succeeded", "confirmation":{"confirmation_url":hosted}}
        with patch("platform_core.checkout.provider", side_effect=provider) as remote:
            self.assertEqual(self.post(total="0.01").status_code, 409)
            self.assertEqual(self.post().json()["url"], hosted)
            self.assertEqual(self.post().json()["url"], hosted)
            self.assertEqual(remote.call_count, 1)
            reconcile = "/api/coins/reconcile"
            check = lambda: self.client.post(reconcile, data={"key": self.form["key"]}, headers=HEADERS)
            self.assertEqual(check().json()["status"], "pending")
            self.assertEqual(remote.call_count, 2)
            event = {"type":"notification","event":"payment.succeeded",
                     "object":{"id":pay_id,"metadata":{"order":order},"status":"succeeded"}}
            self.assertEqual(self.client.post("/api/coins/yookassa", json=event).status_code, 200)
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "10")
            state = "succeeded"
            # If the notification is lost, the customer can recover the paid order.
            self.assertEqual(check().json()["status"], "succeeded")
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "13")
            before = remote.call_count
            self.assertEqual(check().json()["status"], "succeeded")
            self.assertEqual(remote.call_count, before)
            for _ in range(2):
                self.assertEqual(self.client.post("/api/coins/yookassa", json=event).status_code, 200)
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "13")
            self.assertEqual(self.post().json()["status"], "succeeded")
            with IdentityStore(self.db) as store:
                store.create_account("other@example.org", "password")
            self.client.post("/login", data={"login":"other@example.org", "password":"password"}, headers=HEADERS)
            self.assertEqual(check().status_code, 404)


    @patch("platform_core.checkout.merchant", return_value=("merchant", "fixture"))
    def test_verified_full_refund_reverses_credits_and_replay_is_harmless(self, auth):
        self.signin()
        payment_id = str(uuid4())
        refund_id = str(uuid4())
        order_id = None
        refunded = False
        calls = []

        async def provider(method, path, _auth, **kwargs):
            nonlocal order_id
            calls.append((method, path, kwargs.get("resource", "payments")))
            if method == "POST":
                order_id = kwargs["headers"]["Idempotence-Key"]
            if kwargs.get("resource") == "refunds":
                self.assertEqual(path, "/" + refund_id)
                return {"id":refund_id, "payment_id":payment_id,
                        "status":"succeeded", "amount":{"value":"3.60","currency":"RUB"}}
            return {"id":payment_id, "amount":{"value":"3.60","currency":"RUB"},
                    "refunded_amount":{"value":"3.60" if refunded else "0.00","currency":"RUB"},
                    "test":False, "recipient":{"account_id":"merchant"},
                    "metadata":{"order":order_id}, "status":"succeeded", "paid":True}

        with patch("platform_core.checkout.provider", side_effect=provider):
            self.assertEqual(self.post().json()["status"], "succeeded")
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "13")
            refund_notice = {"type":"notification", "event":"refund.succeeded",
                             "object":{"id":refund_id, "payment_id":payment_id, "status":"succeeded"}}
            # A malicious or stale refund notice is not trusted without a matching
            # provider-side fully-refunded amount.
            self.assertEqual(self.client.post("/api/coins/yookassa", json=refund_notice).status_code, 409)
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "13")
            refunded = True
            for _ in range(2):
                self.assertEqual(self.client.post("/api/coins/yookassa", json=refund_notice).status_code, 200)
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "10")
            with self.client.app.state.identity._lock:
                db = self.client.app.state.identity._db
                self.assertEqual(db.execute("SELECT COUNT(*) FROM coin_refunds").fetchone()[0], 1)
                self.assertEqual(db.execute("SELECT status FROM coin_checkouts").fetchone()[0], "refunded")
            # A delayed success notification cannot restore revoked coins.
            success_notice = {"type":"notification", "event":"payment.succeeded",
                              "object":{"id":payment_id,"metadata":{"order":order_id}}}
            self.assertEqual(self.client.post("/api/coins/yookassa", json=success_notice).status_code, 200)
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "10")

    @patch("platform_core.checkout.merchant", return_value=("merchant", "fixture"))
    def test_live_pilot_is_admin_only_and_one_coin(self, auth):
        self.signin()
        with patch.dict(os.environ, {"YOOKASSA_PILOT_ONLY": "1"}):
            self.assertFalse(self.client.get("/api/coins/quote?coins=3").json()["enabled"])
            self.assertFalse(self.client.get("/api/coins/quote?coins=1").json()["enabled"])
            self.assertEqual(self.post().status_code, 403)
