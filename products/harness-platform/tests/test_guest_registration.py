import hashlib
import json
import os
import re
import secrets
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from time import monotonic
from unittest import TestCase, skipUnless
from unittest.mock import AsyncMock, patch

from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.chat_worker import ChatWorker
from platform_core.guest_registration import RegistrationConflict, RegistrationStore
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

    def test_upgrade_updates_chat_directions_and_preserves_edited_answers(self):
        with sqlite3.connect(str(self.path) + ".public-faq.sqlite3") as db:
            db.execute("UPDATE public_faq SET answer=? WHERE topic='history'", (
                "После регистрации этот разговор сохранится по прежней ссылке. На другом устройстве "
                "войдите под тем же логином и откройте чат в кабинете.",))
            db.execute("UPDATE public_faq SET answer='Ответ редактора' WHERE topic='signin'")
        with RegistrationStore(self.path) as upgraded:
            self.assertIn("выберите чат в боковом меню", upgraded.faq.answer("Как сохранить историю?"))
            self.assertEqual(upgraded.faq.answer("Как открыть мой кабинет?"), "Ответ редактора")

    def test_concurrent_replay_and_revocation(self):
        guest, chat = self.store.start_guest()
        recovery = self.store.guest_recovery(guest)
        with self.assertRaises(AuthenticationError):
            self.store.register(guest, "new", PASSWORD, secrets.token_urlsafe(32))
        self.store.guest_turn(guest, chat, "first", "Моя история")
        other = self.enterContext(RegistrationStore(self.path))
        barrier = Barrier(2)

        def submit(store):
            barrier.wait(timeout=10)
            return store.register(guest, "New", PASSWORD, recovery)

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.map(submit, [self.store, other])
        token, saved_chat = first
        self.assertEqual(self.store.wallet(token, balance_only=True)["available"], "10")
        self.assertEqual(first, second)
        self.assertEqual(saved_chat, chat)
        self.assertEqual(self.store.list_chats(token), [chat])
        self.assertTrue(self.store.has_claimed_guest_turns(self.store.resolve_chat(token, chat)))
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
        self.assertEqual(self.store.wallet(independent, balance_only=True)["available"], "10")

    def test_locked_worker_journal_keeps_owned_chat_accessible(self):
        guest, chat = self.store.start_guest()
        self.store.guest_turn(guest, chat, "draft", "Моя история")
        token, _ = self.store.register(guest, "owner", PASSWORD, self.store.guest_recovery(guest))
        other = self.store.login("existing", PASSWORD)
        foreign = self.store.create_user_chat(other).chat_id
        scope = self.store.resolve_chat(token, chat)
        key = hashlib.sha256(json.dumps([scope.actor_id, scope.workspace_id, chat],
                                        separators=(",", ":")).encode()).hexdigest()
        self.journals.mkdir()
        journal = self.journals / "native-chats.sqlite3"
        fallback = self.store.chat_activity(token, journal)[chat]
        self.assertIsInstance(fallback, int)
        latest = fallback + 60000
        with self.client() as client, sqlite3.connect(journal) as db:
            client.cookies.set("__Host-harness_session", token)
            db.execute("CREATE TABLE native_batches(scope_key TEXT, revision INTEGER, events TEXT)")
            db.execute("INSERT INTO native_batches VALUES(?, 1, ?)", (key, json.dumps([{"time": latest}])))
            db.commit()
            db.execute("BEGIN EXCLUSIVE")
            started = monotonic()
            self.assertEqual(self.store.chat_activity(token, journal), {chat: fallback})
            self.assertLess(monotonic() - started, 1)
            self.assertEqual(client.get(f"/app/chats/{chat}").status_code, 200)
            self.assertEqual(client.get(f"/app/chats/{foreign}").status_code, 404)
            with self.assertRaises(AuthenticationError):
                self.store.chat_activity("invalid", journal)
            db.rollback()
            self.assertEqual(self.store.chat_activity(token, journal), {chat: latest})

    def test_draft_isolation_pagination_expiry_and_name_collision(self):
        token, chat = self.store.start_guest()
        recovery = self.store.guest_recovery(token)
        other, _ = self.store.start_guest()
        with self.assertRaises(ChatUnavailable):
            self.store.guest_history(other, chat)
        for i in range(35):
            self.store.guest_turn(token, chat, str(i), f"Текст {i}")
        self.store.guest_turn(token, chat, "0", "Текст 0")
        with self.assertRaises(RegistrationConflict):
            self.store.guest_turn(token, chat, "0", "Изменение")
        latest, cursor = self.store.guest_page(token, chat, 2**63 - 1)
        older, end = self.store.guest_page(token, chat, cursor)
        self.assertIsNone(end)
        self.assertEqual([turn["text"] for turn in older + latest], [f"Текст {i}" for i in range(35)])
        with self.assertRaises(RegistrationConflict):
            self.store.register(token, "existing", PASSWORD, recovery)
        self.assertEqual(len(self.store.guest_history(token, chat)), 35)
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
            self.assertNotIn("<b>история</b>", html)
            self.assertEqual([t["text"] for t in client.get(f"/guest/chats/{chat}/events").json()["turns"]], [fields["text"]])
            self.assertNotIn("Код восстановления", client.get("/register").text)
            delivered = []
            client.app.state.account_access.mail = lambda email, code: delivered.append(code)
            form = dict(login="form-owner", password=PASSWORD, email="guest@example.test")
            self.assertEqual(client.post("/register", data=form).status_code, 403)
            busy = client.post("/register", data={**form, "login": "existing"}, headers=HEADERS)
            self.assertEqual(busy.status_code, 409)
            self.assertIn("Этот логин уже занят", busy.text)
            started = client.post("/register", data=form, headers=HEADERS)
            self.assertEqual(started.headers["location"], "/auth/verify")
            self.assertNotIn("__Host-harness_session", client.cookies)
            replay.cookies.update(client.cookies)
            proof = {"value": delivered.pop()}
            registered = client.post("/auth/verify", data=proof, headers=HEADERS)
            self.assertEqual((registered.status_code, registered.headers["location"]), (303, path))
            token = client.cookies.get("__Host-harness_session")
            self.assertTrue(token)
            self.assertNotIn("__Host-harness_guest", client.cookies)
            self.assertEqual(replay.post(turn, data=fields, headers=HEADERS).status_code, 401)
            repeated = replay.post("/auth/verify", data=proof, headers=HEADERS)
            self.assertEqual((repeated.status_code, repeated.headers["location"]), (303, path))
            self.assertEqual(replay.cookies.get("__Host-harness_session"), token)
            self.assertEqual(replay.get("/api/chats").json(), [chat])

    def test_memory_store_keeps_its_faq_in_memory(self):
        with RegistrationStore(":memory:") as store:
            token, chat = store.start_guest()
            store.guest_turn(token, chat, "hi", "Что ты умеешь?")
            self.assertIn("Сервис создан", store.guest_history(token, chat)[0]["answer"])

    def test_shared_service_faq_runs_without_credentials_or_external_dispatch(self):
        self.enterContext(patch.dict(os.environ, {"PATH": os.defpath}, clear=True))
        dispatch = self.enterContext(patch.object(ChatWorker, "request", new_callable=AsyncMock))
        dispatch.side_effect = AssertionError("A guest must never start the account worker")
        self.enterContext(patch("socket.socket.connect", side_effect=AssertionError("Unexpected network request")))
        with self.client() as a, self.client() as b:
            paths = [client.post("/guest/start", headers=HEADERS).headers["location"] for client in (a, b)]
            chats = [path.rsplit("/", 1)[1] for path in paths]
            self.assertNotEqual(*chats)
            questions = [
                ("Что ты умеешь?", "Сервис создан для продавцов"),
                ("Как зарегистрироваться?", "подтвердите регистрацию"),
                ("Сколько стоит?", "При покупке 1 монета стоит 1,20 ₽"),
                ("Заказов столько же, почему денег пришло меньше?", "Разбор своего магазина"),
                ("Что такое ДРР?", "Я отвечаю на вопросы о нашем сервисе"),
                ("Напиши стих про Ozon", "Я отвечаю на вопросы о нашем сервисе"),
                ("Посчитай прибыль на данных любого магазина", "Я отвечаю на вопросы о нашем сервисе"),
                ("Сколько стоит доставка на Ozon?", "Я отвечаю на вопросы о нашем сервисе"),
                ("Расскажи погоду и сколько стоит подписка", "Я отвечаю на вопросы о нашем сервисе"),
            ]
            for i, (question, expected) in enumerate(questions):
                result = a.post(f"/guest/chats/{chats[0]}/turns", headers=HEADERS,
                                data={"request_id": str(i), "text": question})
                self.assertEqual(result.status_code, 303)
                turn = self.store.guest_history(a.cookies.get("__Host-harness_guest"), chats[0])[-1]
                self.assertIn(expected, turn["answer"])
                if question != "Сколько стоит?":
                    self.assertNotIn("₽", turn["answer"])
            self.assertNotIn(questions[3][0], b.get(paths[1]).text)
            for endpoint in ("tools", "messages", "events"):
                self.assertEqual(a.get(f"/api/chats/{chats[0]}/{endpoint}").status_code, 401)
            self.assertEqual(a.post(f"/api/chats/{chats[0]}/tools/read_sales", headers=HEADERS,
                                    json={"arguments": {}}).status_code, 401)
            # A temporary published FAQ change reaches both visitors via the same public DB.
            with sqlite3.connect(str(self.path) + ".public-faq.sqlite3") as db:
                self.assertEqual(db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall(),
                                 [("public_faq",)])
                db.execute("UPDATE public_faq SET answer='Проверка опубликованного тарифа' WHERE topic='price'")
            for client, path, chat in zip((a, b), paths, chats):
                result = client.post(f"/guest/chats/{chat}/turns", headers=HEADERS,
                                     data={"request_id": "price", "text": "Сколько стоит ваш сервис?"})
                self.assertEqual(result.status_code, 303)
                self.assertEqual(client.get(f"/guest/chats/{chat}/events").json()["turns"][-1]["answer"], "Проверка опубликованного тарифа")
        dispatch.assert_not_awaited()

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
