from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from uuid import uuid4

from starlette.testclient import TestClient
from tests.auth_fixture import email_opted_out

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore

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

    def signin(self):
        email_opted_out(self.client.app.state.identity, "test@example.org")
        self.client.post("/login", data={"login":"TEST@example.org", "password":"password"}, headers=HEADERS)

    def post(self, **fields):
        return self.client.post(self.url, data={**self.form, **fields}, headers=HEADERS)

    def test_no_merchant_and_session_boundaries(self):
        with patch("platform_core.checkout.merchant", return_value=None):
            self.assertFalse(self.client.get("/api/coins/quote?coins=2").json()["enabled"])
            self.assertEqual(self.post().status_code, 401)
            self.signin()
            self.assertEqual(self.post().status_code, 503)
            self.assertEqual(self.client.post(self.url, data=self.form).status_code, 403)
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
            event = {"object":{"id":pay_id,"metadata":{"order":order},"status":"succeeded"}}
            self.assertEqual(self.client.post("/api/coins/yookassa", json=event).status_code, 200)
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "10")
            state = "succeeded"
            for _ in range(2):
                self.assertEqual(self.client.post("/api/coins/yookassa", json=event).status_code, 200)
            self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "13")
            self.assertEqual(self.post().json()["status"], "succeeded")
