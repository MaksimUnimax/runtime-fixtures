"""Verification through the same browser and bearer routes used by the deployed app."""
import base64
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from time import time
from unittest import TestCase
from unittest.mock import patch

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.hashes import SHA1
from cryptography.hazmat.primitives.twofactor.hotp import HOTP
from starlette.testclient import TestClient

from platform_core.access_bootstrap import assign
from platform_core.account_access import AccountAccess, AccessError, REMEMBER_SECONDS
from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.identity import AuthenticationError, _SESSION_SECONDS, _secret_digest

ORIGIN = "https://octo.example"
HEADERS = {"origin":ORIGIN}
PASSWORD = "test passphrase for Octoport"


class AccountAccessTest(TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(TemporaryDirectory()))
        self.db = self.root / "accounts.sqlite3"
        self.client = self.enterContext(TestClient(create_app(self.db, self.root/"chats"), base_url=ORIGIN, follow_redirects=False))
        self.store = self.client.app.state.identity
        self.svc = self.client.app.state.account_access
        self.now = int(time())
        self.svc.clock = lambda: self.now
        self.mail = []
        self.svc.mail = lambda address,code: self.mail.append((address,code))
        self.key = self.root / "fernet"
        self.key.write_bytes(Fernet.generate_key())
        self.svc.keyfile = self.key

    def login(self, name, remember=False):
        return self.client.post("/api/login", json={"login":name,"password":PASSWORD,"remember":remember})

    def advance(self, handle, value):
        return self.client.post("/api/login/verify", json={"challenge":handle,"value":value})

    def post(self, path, **fields):
        return self.client.post(path, data=fields, headers=HEADERS)

    def last_code(self):
        return self.mail[-1][1]

    def app_code(self, key):
        return HOTP(base64.b32decode(key), 6, SHA1()).generate(self.now//30).decode()

    def signup(self, name="member", remember=False):
        self.post("/guest/session")
        result = self.post("/register", login=name, password=PASSWORD, email=name+"@example.test",
                           **({"remember":"on"} if remember else {}))
        self.assertEqual(result.headers["location"],"/auth/verify")
        self.assertEqual(self.store._db.execute("SELECT COUNT(*) FROM identity_accounts WHERE login=?", (name,)).fetchone()[0],0)
        self.assertNotIn("__Host-harness_session", self.client.cookies)
        return self.post("/auth/verify", value=self.last_code())

    def test_email_registration_remember_and_preference(self):
        result = self.signup(remember=True)
        self.assertIn(f"Max-Age={REMEMBER_SECONDS}", result.headers["set-cookie"])
        self.assertTrue(result.headers["location"].startswith("/app/chats/"))
        self.assertEqual(self.client.get("/api/wallet/balance").json()["available"], "10")
        setting = "/api/profile/security"
        self.assertTrue(self.client.get(setting).json()["enabled"])
        self.assertEqual(self.post(setting,current="incorrect",enabled="false").status_code,400)
        self.assertTrue(self.client.get(setting).json()["enabled"])
        self.assertFalse(self.post(setting,current=PASSWORD,enabled="false").json()["enabled"])
        self.post("/logout")
        self.assertEqual(self.post("/login",login="member",password=PASSWORD).headers["location"],"/app/")
        self.assertTrue(self.post(setting,current=PASSWORD,enabled="true").json()["enabled"])
        self.post("/logout")
        self.now+=61
        self.assertEqual(self.post("/login",login="member",password=PASSWORD).headers["location"],"/auth/verify")
        self.assertFalse(self.client.get("/api/session/status").json()["authenticated"])
        accepted=self.post("/auth/verify",value=self.last_code())
        cookie=next(x for x in accepted.headers.get_list("set-cookie") if x.startswith("__Host-harness_session="))
        self.assertNotIn("Max-Age", cookie)
        self.assertTrue(self.client.get("/api/session/status").json()["authenticated"])

    def test_admin_bootstrap_role_toggle_and_replay(self):
        self.store.create_account("boss",PASSWORD)
        self.store.set_admin("boss",True)
        self.assertEqual(self.login("boss").status_code,403)
        with self.store._write() as db:
            assign(db,"boss","boss@example.test")
        first=self.login("boss",True)
        self.assertEqual(first.status_code,202)
        handle=first.json()["challenge"]
        self.assertEqual(first.json()["stage"],"email")
        setup=self.advance(handle,self.last_code())
        key=setup.json()["setup_key"]
        self.assertNotIn("token",setup.json())
        code=self.app_code(key)
        with ThreadPoolExecutor(2) as pool:
            futures=[pool.submit(self.advance,handle,code) for _ in range(2)]
        statuses=[f.result().status_code for f in futures]
        self.assertEqual(sorted(statuses),[200,401])
        token=futures[statuses.index(200)].result().json()["token"]
        self.assertTrue(self.store.is_admin(token))
        self.assertEqual(self.store._db.execute("SELECT expires_at FROM identity_sessions WHERE digest=?",(_secret_digest(token),)).fetchone()[0],self.now+_SESSION_SECONDS)
        self.assertNotEqual(self.store._db.execute("SELECT seed FROM access_contacts").fetchone()[0],key.encode())
        with self.assertRaises(AccessError) as denied:
            self.svc.configure(token,PASSWORD,False)
        self.assertEqual(denied.exception.status,403)
        self.now+=61
        email=self.login("boss",True).json()
        self.assertEqual(email["stage"],"email")
        next_step=self.advance(email["challenge"],self.last_code()).json()
        self.assertEqual(next_step["stage"],"totp")
        self.assertEqual(self.advance(next_step["challenge"],code).status_code,401)
        self.assertEqual(self.advance(next_step["challenge"],self.app_code(key)).status_code,200)
        self.store.set_admin("boss",False)
        with self.assertRaises(AuthenticationError):
            self.store.validate_session(token)
        self.now+=61
        self.assertEqual(self.login("boss").json()["stage"],"email")

    def test_old_account_keeps_store_chat_and_fresh_code_window(self):
        self.store.create_account("old-name",PASSWORD)
        original=self.store.login("old-name",PASSWORD)
        chat=self.store.create_user_chat(original)
        self.post("/login",login="old-name",password=PASSWORD)
        self.assertIn("Привяжите почту", self.client.get("/auth/verify").text)
        self.now+=540
        self.post("/auth/verify",value="old@example.test")
        self.now+=540
        self.assertEqual(self.post("/auth/verify",value=self.last_code()).status_code,303)
        new=self.client.cookies["__Host-harness_session"]
        self.assertEqual(self.store.resolve_chat(new,chat.chat_id),chat)

    def test_expired_and_wrong_codes_do_not_create_account(self):
        self.post("/guest/session")
        self.post("/register",login="new",password=PASSWORD,email="new@example.test")
        wrong="000001" if self.last_code()=="000000" else "000000"
        for _ in range(5):
            self.assertEqual(self.post("/auth/verify",value=wrong).status_code,401)
        self.assertEqual(self.post("/auth/verify",value=self.last_code()).status_code,429)
        self.now+=601
        self.assertEqual(self.post("/auth/verify",value=self.last_code()).status_code,401)
        self.assertEqual(self.store._db.execute("SELECT COUNT(*) FROM identity_accounts").fetchone()[0],0)

    def test_resend_failure_retains_previous_code(self):
        self.post("/guest/session")
        self.post("/register",login="new",password=PASSWORD,email="new@example.test")
        self.assertEqual(self.post("/auth/resend").status_code,429)
        self.now+=61
        with patch.object(self.svc,"mail",side_effect=OSError):
            self.assertEqual(self.post("/auth/resend").status_code,503)
        self.assertEqual(self.post("/auth/verify",value=self.last_code()).status_code,303)

    def test_password_change_clears_persistent_sign_in(self):
        self.signup(remember=True)
        old=self.client.cookies["__Host-harness_session"]
        result=self.post("/api/profile/password",current=PASSWORD,password="new test passphrase",confirmation="new test passphrase")
        renewed=self.client.cookies["__Host-harness_session"]
        self.assertNotEqual(renewed,old)
        self.assertNotIn("Max-Age=",result.headers["set-cookie"])
        expiry=self.store._db.execute("SELECT expires_at FROM identity_sessions WHERE digest=?",
                                     (_secret_digest(renewed),)).fetchone()[0]
        self.assertAlmostEqual(expiry, int(time())+_SESSION_SECONDS, delta=3)
        with self.assertRaises(AuthenticationError):
            self.store.validate_session(old)

    def test_remembered_session_survives_next_day_and_ends_at_deadline(self):
        first = self.signup(remember=True)
        self.assertTrue(first.headers["location"].startswith("/app/chats/"))
        token = self.client.cookies["__Host-harness_session"]
        reopened = TestClient(self.client.app,base_url=ORIGIN,follow_redirects=False,
                              cookies={"__Host-harness_session":token})
        self.addCleanup(reopened.close)
        with patch("platform_core.identity.time",return_value=self.now+_SESSION_SECONDS+1):
            self.assertTrue(reopened.get("/api/session/status").json()["authenticated"])
        with patch("platform_core.identity.time",return_value=self.now+REMEMBER_SECONDS):
            self.assertFalse(reopened.get("/api/session/status").json()["authenticated"])
        self.post("/logout")
        with self.assertRaises(AuthenticationError):
            self.store.validate_session(token)

    def test_role_promotion_revokes_user_session_and_pending_login(self):
        self.signup()
        previous=self.client.cookies["__Host-harness_session"]
        self.now+=61
        handle=self.login("member").json()["challenge"]
        self.store.set_admin("member",True)
        with self.assertRaises(AuthenticationError):
            self.store.validate_session(previous)
        self.assertEqual(self.advance(handle,self.last_code()).status_code,401)
        self.now+=61
        handle=self.login("member").json()["challenge"]
        self.assertEqual(self.advance(handle,self.last_code()).json()["stage"],"setup")

    def test_first_migration_revokes_only_admin_sessions_once(self):
        with RegistrationStore(self.root/"legacy.sqlite3") as legacy:
            legacy.create_account("old-admin",PASSWORD)
            legacy.create_account("user",PASSWORD)
            legacy.set_admin("old-admin",True)
            privileged=legacy.login("old-admin",PASSWORD)
            ordinary=legacy.login("user",PASSWORD)
            AccountAccess(legacy)
            with self.assertRaises(AuthenticationError):
                legacy.validate_session(privileged)
            legacy.validate_session(ordinary)
            current=legacy.login("old-admin",PASSWORD)
            AccountAccess(legacy)
            legacy.validate_session(current)
