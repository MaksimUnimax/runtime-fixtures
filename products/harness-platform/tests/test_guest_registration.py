import os
import re
import secrets
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from unittest import TestCase, skipUnless
from unittest.mock import patch

from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.guest_registration import GuestLimit, MAX_GUEST_TURNS, RegistrationConflict, RegistrationStore
from platform_core.identity import AuthenticationError, ChatUnavailable, IdentityStore


PASSWORD = "Guest registration test password"
ORIGIN = "https://harness.example"
HEADERS = {"Origin": ORIGIN}


class GuestRegistrationTests(TestCase):
    def setUp(self):
        root = Path(self.enterContext(TemporaryDirectory()))
        self.path = root / "identity.sqlite3"
        self.journals = root / "journals"
        # An installation with previously provisioned accounts upgrades in place.
        with IdentityStore(self.path) as legacy:
            legacy.create_account("existing", PASSWORD)
        self.store = self.enterContext(RegistrationStore(self.path))

    def test_concurrent_replay_and_revocation(self):
        guest, chat = self.store.start_guest()
        recovery = self.store.guest_recovery(guest)
        with self.assertRaises(AuthenticationError):
            self.store.register(guest, "new", PASSWORD, secrets.token_urlsafe(32))
        self.store.guest_turn(guest, chat, "first", "Моя история")
        original = self.store.guest_history(guest, chat)
        other = self.enterContext(RegistrationStore(self.path))
        barrier = Barrier(2)

        def submit(store):
            barrier.wait(timeout=10)
            return store.register(guest, "New", PASSWORD, recovery)

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.map(submit, [self.store, other])
        token, saved_chat = first
        self.assertEqual(first, second)
        self.assertEqual(saved_chat, chat)
        self.assertEqual(self.store.list_chats(token), [chat])
        self.assertEqual(self.store.claimed_history(self.store.resolve_chat(token, chat)), original)
        with sqlite3.connect(self.path) as db:
            self.assertEqual([db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in
                              ("identity_accounts", "workspaces", "identity_sessions", "guest_turns")], [2, 2, 1, 1])
        with self.assertRaises(AuthenticationError):
            self.store.guest_turn(guest, chat, "after", "another")
        with self.assertRaises(AuthenticationError):
            self.store.guest_history(guest, chat)
        with self.assertRaises(RegistrationConflict):
            self.store.register(guest, "other", PASSWORD, recovery)
        self.store.logout(token)
        with self.assertRaises(AuthenticationError):
            self.store.register(guest, "new", PASSWORD, recovery)
        self.store.reset_password("new", recovery, PASSWORD + " revised")
        with self.assertRaises(RegistrationConflict):
            self.store.register(guest, "new", PASSWORD, recovery)
        independent = self.store.login("new", PASSWORD + " revised")
        self.assertEqual(self.store.list_chats(independent), [chat])

    def test_draft_isolation_limit_expiry_and_name_collision(self):
        token, chat = self.store.start_guest()
        recovery = self.store.guest_recovery(token)
        other, _ = self.store.start_guest()
        with self.assertRaises(ChatUnavailable):
            self.store.guest_history(other, chat)
        for i in range(MAX_GUEST_TURNS):
            self.store.guest_turn(token, chat, str(i), f"Текст {i}")
        self.store.guest_turn(token, chat, "0", "Текст 0")
        with self.assertRaises(RegistrationConflict):
            self.store.guest_turn(token, chat, "0", "Изменение")
        with self.assertRaises(GuestLimit):
            self.store.guest_turn(token, chat, "more", "Ещё")
        with self.assertRaises(RegistrationConflict):
            self.store.register(token, "existing", PASSWORD, recovery)
        self.assertEqual(len(self.store.guest_history(token, chat)), MAX_GUEST_TURNS)
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE guest_chats SET expires_at=0 WHERE chat_id=?", (chat,))
        with self.assertRaises(AuthenticationError):
            self.store.register(token, "unused", PASSWORD, recovery)
        self.store.start_guest()
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT count(*) FROM guest_turns").fetchone()[0], 0)

    def client(self):
        return TestClient(create_app(self.path, self.journals), base_url=ORIGIN, follow_redirects=False)

    def test_guest_form_and_retry_after_lost_registration_response(self):
        with self.client() as client, self.client() as replay:
            self.assertEqual(client.post("/guest/start").status_code, 403)
            started = client.post("/guest/start", headers=HEADERS)
            self.assertEqual(started.status_code, 303)
            path = started.headers["location"]
            chat = path.rsplit("/", 1)[1]
            cookie = started.headers["set-cookie"].lower()
            for flag in ("__host-harness_guest=", "httponly", "secure", "samesite=strict"):
                self.assertIn(flag, cookie)
            replay.cookies.update(client.cookies)
            self.assertEqual(client.post("/guest/start", headers=HEADERS).headers["location"], path)
            for endpoint in ("/api/chats", f"/api/chats/{chat}/tools", f"/api/chats/{chat}/events"):
                self.assertEqual(client.get(endpoint).status_code, 401)
            fields = {"request_id": "key", "text": "<b>история</b>"}
            turn = f"/guest/chats/{chat}/turns"
            self.assertEqual(client.post(turn, data=fields).status_code, 403)
            for _ in range(2):
                self.assertEqual(client.post(turn, data=fields, headers=HEADERS).status_code, 303)
            html = client.get(path).text
            self.assertEqual(html.count("&lt;b&gt;история&lt;/b&gt;"), 1)
            code = re.search(r'name="recovery" readonly value="([\w-]+)"', client.get("/register").text)[1]
            form = dict(login="form-owner", password=PASSWORD, recovery=code)
            self.assertEqual(client.post("/register", data=form).status_code, 403)
            busy = client.post("/register", data={**form, "login": "existing"}, headers=HEADERS)
            self.assertEqual(busy.status_code, 409)
            self.assertIn(code, busy.text)
            registered = client.post("/register", data=form, headers=HEADERS)
            self.assertEqual((registered.status_code, registered.headers["location"]), (303, path))
            token = client.cookies.get("__Host-harness_session")
            self.assertTrue(token)
            self.assertNotIn("__Host-harness_guest", client.cookies)
            self.assertEqual(replay.post(turn, data=fields, headers=HEADERS).status_code, 401)
            repeated = replay.post("/register", data=form, headers=HEADERS)
            self.assertEqual((repeated.status_code, repeated.headers["location"]), (303, path))
            self.assertEqual(replay.cookies.get("__Host-harness_session"), token)
            self.assertEqual(replay.get("/api/chats").json(), [chat])

    @skipUnless(os.environ.get("HARNESS_NODE_MODULES"), "requires native Harness")
    def test_native_retry_and_restart_preserve_messages_and_context(self):
        guest, chat = self.store.start_guest()
        for key, question in [("one", "Как получить инструменты?"), ("two", "Как сохранить историю?")]:
            self.store.guest_turn(guest, chat, key, question)
        original = self.store.guest_history(guest, chat)
        token, _ = self.store.register(guest, "owner", PASSWORD, self.store.guest_recovery(guest))
        base = f"/api/chats/{chat}"
        auth = {"Authorization": "Bearer " + token}
        self.enterContext(patch.dict(os.environ, {"HARNESS_OFFLINE_MODEL": "1"}))
        expected = [(t["requestId"], role, t[item]) for t in original
                    for role, item in (("user", "text"), ("assistant", "answer"))]
        with self.client() as first:
            # A write can be the first operation after signup, ahead of any history reads.
            response = first.post(base + "/turns", headers=auth, json={"requestId": "three", "text": "Продолжай"})
            self.assertEqual(response.status_code, 200, response.text)
            answer = response.json()["text"]
            self.assertIn("ход 3", answer)
            self.assertIn("Предыдущее сообщение: Как сохранить историю?", answer)
        with self.client() as restarted:
            result = restarted.get(base + "/messages", headers=auth)
            self.assertEqual(result.status_code, 200, result.text)
            messages = [(m["requestId"], m["role"], m["text"]) for m in result.json()]
            self.assertEqual(messages, expected + [("three", "user", "Продолжай"), ("three", "assistant", answer)])
            events = restarted.get(base + "/events?limit=2&before=2", headers=auth).json()["events"]
            self.assertEqual([e["time"] for e in events if e["type"] == "user/message"], [t["at"] for t in original])
