"""HTTP acceptance against the pinned native host and the real scoped MCP server."""

import os
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Barrier
from unittest.mock import patch

from starlette.testclient import TestClient

from tests.auth_fixture import email_opted_out

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore


@unittest.skipUnless(os.environ.get("HARNESS_NODE_MODULES"), "requires pinned native Harness")
class AccountChatAcceptance(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {"HARNESS_OFFLINE_MODEL": "1"}))
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.database = Path(directory.name) / "platform.sqlite3"
        self.journals = Path(directory.name) / "chats"
        self.password = "Initial test password 01"
        with IdentityStore(self.database) as store:
            self.recovery = store.create_account("first", self.password)
            store.create_account("second", self.password)

    def client(self):
        return TestClient(create_app(
            self.database, self.journals, composition_module="examples.reference_plugin",
        ))

    def login(self, client, handle, password=None):
        email_opted_out(client.app.state.identity, handle)
        response = client.post("/api/login", json={
            "login": handle, "password": password or self.password,
        })
        self.assertEqual(response.status_code, 200, response.text)
        return {"Authorization": "Bearer " + response.json()["token"]}

    def assert_json(self, response, expected):
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), expected)

    def parallel(self, *calls):
        ready = Barrier(len(calls))

        def run(call):
            ready.wait(timeout=10)
            return call()

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(run, calls))

    def test_parallel_chats_resume_in_the_same_service(self):
        with self.client() as client:
            first, second = self.parallel(
                lambda: self.login(client, "first"), lambda: self.login(client, "second"),
            )
            chats = []
            for user in (first, second):
                response = client.post("/api/chats", headers=user)
                self.assertEqual(response.status_code, 201, response.text)
                chats.append(response.json()["chatId"])
            self.assertNotEqual(*chats)
            paths = [f"/api/chats/{chat}" for chat in chats]

            with IdentityStore(self.database) as store:
                token = first["Authorization"].removeprefix("Bearer ")
                scope = store.resolve_chat(token, chats[0])
                store.set_entitlement(scope.workspace_id, "reference-text", True)
                store.set_enabled(scope, "reference-text", True)

            # Identical client request IDs are independent across chat owners.
            payloads = [{"requestId": "turn-1", "text": text} for text in ("первый", "второй")]
            expected = [dict(payload, role="user") for payload in payloads]
            first_messages, second_messages = [path + "/messages" for path in paths]

            def append_first():
                return client.post(first_messages, headers=first, json=payloads[0])

            replies = self.parallel(
                append_first, append_first,
                lambda: client.post(second_messages, headers=second, json=payloads[1]),
            )
            for reply, message in zip(replies, [expected[0], expected[0], expected[1]], strict=True):
                self.assert_json(reply, message)
            conflict = client.post(first_messages, headers=first, json=payloads[1])
            self.assertEqual(conflict.status_code, 409, conflict.text)

            granted, empty = self.parallel(
                lambda: client.get(paths[0] + "/tools", headers=first),
                lambda: client.get(paths[1] + "/tools", headers=second),
            )
            self.assert_json(granted, ["summarize_text"])
            self.assert_json(empty, [])
            tool = "/tools/summarize_text"
            arguments = {"arguments": {"text": "one   two"}}
            self.assert_json(client.post(paths[0] + tool, headers=first, json=arguments),
                             {"words": 2, "normalized": "one two"})
            refused = client.post(paths[1] + tool, headers=second, json=arguments)
            self.assertEqual(refused.status_code, 404, refused.text)
            unexpected_scope = dict(arguments, actorId=scope.actor_id, workspaceId=scope.workspace_id)
            self.assertEqual(client.post(paths[1] + tool, headers=second,
                                         json=unexpected_scope).status_code, 400)

            turns = [{"requestId": "native-turn", "text": text} for text in
                     ("First private prompt 913", "Second private prompt 827")]
            completed = self.parallel(
                lambda: client.post(paths[0] + "/turns", headers=first, json=turns[0]),
                lambda: client.post(paths[1] + "/turns", headers=second, json=turns[1]),
            )
            histories = []
            for i, response in enumerate(completed):
                self.assertEqual(response.status_code, 200, response.text)
                answer = response.json()
                self.assertEqual(answer["role"], "assistant")
                self.assertEqual(answer["requestId"], turns[i]["requestId"])
                self.assertTrue(answer["text"].strip())
                self.assertNotIn(turns[1 - i]["text"], answer["text"])
                histories.append([expected[i], dict(turns[i], role="user"), answer])
            self.assertNotEqual(histories[0][-1]["text"], histories[1][-1]["text"])

            for user, foreign in [(first, paths[1]), (second, paths[0])]:
                for method, route, body in [
                    ("GET", "/messages", None), ("POST", "/messages", payloads[0]),
                    ("GET", "/tools", None), ("POST", tool, arguments), ("POST", "/turns", turns[0]),
                ]:
                    denied = client.request(method, foreign + route, headers=user, json=body)
                    self.assertEqual(denied.status_code, 404, denied.text)
                    self.assertEqual(denied.json(), {"error": "Chat unavailable"})

            self.assertEqual(client.post("/api/logout", headers=first).status_code, 204)
            self.assertEqual(client.get(first_messages, headers=first).status_code, 401)

        # Closing the lifespan terminates the native host. The new ASGI application
        # opens the original DB and journal directory with a fresh worker process.
        with self.client() as client:
            restored = self.login(client, "first")
            other = self.login(client, "second")
            for i, (user, tools) in enumerate(((restored, ["summarize_text"]), (other, []))):
                self.assert_json(client.get("/api/chats", headers=user), [chats[i]])
                self.assert_json(client.get(paths[i] + "/messages", headers=user), histories[i])
                self.assert_json(client.get(paths[i] + "/tools", headers=user), tools)
            followups = [{"requestId": "continue", "text": text} for text in
                         ("First follow-up 619", "Second follow-up 278")]
            continued = self.parallel(
                lambda: client.post(paths[0] + "/turns", headers=restored, json=followups[0]),
                lambda: client.post(paths[1] + "/turns", headers=other, json=followups[1]),
            )
            for i, (user, response) in enumerate(zip((restored, other), continued, strict=True)):
                # The offline model counts the user messages it actually receives from Harness.
                answer = {"role": "assistant", "requestId": "continue",
                          "text": (f"Тестовая модель (ход 3): {followups[i]['text']}\n"
                                   f"Предыдущее сообщение: {turns[i]['text']}")}
                self.assert_json(response, answer)
                histories[i].extend([dict(followups[i], role="user"), answer])
                self.assert_json(client.get(paths[i] + "/messages", headers=user), histories[i])
                self.assert_json(client.get(paths[i] + "/messages?limit=1&offset=1", headers=user),
                                 histories[i][1:3])
            self.assertEqual(client.get(first_messages, headers=first).status_code, 401)
            recover = {"login": "first", "recovery": self.recovery,
                       "password": "Changed test password 02"}
            reset = client.post("/api/recover", json=recover)
            self.assertEqual(reset.status_code, 200, reset.text)
            self.assertNotEqual(reset.json()["recovery"], self.recovery)
            self.assertEqual(client.post("/api/recover", json=recover).status_code, 401)
            self.assertEqual(client.get(first_messages, headers=restored).status_code, 401)
            recovered = self.login(client, "first", recover["password"])
            self.assert_json(client.get(first_messages, headers=recovered), histories[0])
            self.assert_json(client.get(second_messages, headers=second), histories[1])
