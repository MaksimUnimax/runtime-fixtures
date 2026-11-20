"""Authenticated archived-report turns through the installed Harness, including retries."""
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from zipfile import ZipFile

from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore
from report_archive.plugin import PLUGIN_ID, archive_path


FIXTURES = Path(__file__).resolve().parents[1] / "acceptance/archive_chat/fixtures"
DAY = "2001-02-03"


@unittest.skipUnless(os.environ.get("HARNESS_NODE_MODULES"), "requires pinned native Harness")
class ArchiveChatScopeTest(unittest.TestCase):
    def test_report_turn_is_owned_replayable_and_revocable(self):
        directory = self.enterContext(TemporaryDirectory())
        self.enterContext(patch.dict(os.environ, {
            "HARNESS_OFFLINE_MODEL": "1", "HARNESS_OFFLINE_ADAPTER": "archive_chat",
        }))
        db = Path(directory) / "accounts.sqlite3"
        journals = Path(directory) / "journals"
        store = self.enterContext(IdentityStore(db))
        credentials = {"login": "sample-first", "password": "Synthetic test password 01"}
        other = {**credentials, "login": "sample-second"}
        for data in (credentials, other):
            store.create_account(data["login"], data["password"])

        def service():
            return TestClient(create_app(db, journals, composition_module="report_archive.plugin"))

        def open_chat(client, account):
            login = client.post("/api/login", json=account)
            self.assertEqual(login.status_code, 200, login.text)
            token = login.json()["token"]
            headers = {"Authorization": f"Bearer {token}"}
            new = client.post("/api/chats", headers=headers)
            self.assertEqual(new.status_code, 201, new.text)
            chat_id = new.json()["chatId"]
            return headers, f"/api/chats/{chat_id}", store.resolve_chat(token, chat_id)

        def history(client, headers, path):
            response = client.get(path + "/messages", headers=headers)
            self.assertEqual(response.status_code, 200, response.text)
            return response.json()

        def assert_unavailable(response):
            self.assertIn(response.status_code, (404, 503), response.text)
            self.assertIn(response.json(), ({"error": "unavailable"}, {"error": "worker_unavailable"}))

        payload = {"requestId": "archive-read", "text": f"Покажи архивный отчёт за {DAY}"}
        with service() as client:
            owner, owner_path, scope = open_chat(client, credentials)
            second, second_path, _ = open_chat(client, other)
            store.set_entitlement(scope.workspace_id, PLUGIN_ID, True)
            store.set_enabled(scope, PLUGIN_ID, True)
            path = archive_path(Path(str(db) + ".reports"), scope.workspace_id, DAY)
            path.parent.mkdir(parents=True)
            sources = FIXTURES / "input"
            with ZipFile(path, "w") as archive:
                for file in sorted(sources.rglob("*.json")):
                    archive.write(file, file.relative_to(sources))

            foreign = client.post(owner_path + "/turns", headers=second, json=payload)
            self.assertEqual(foreign.status_code, 404, foreign.text)
            self.assertEqual(foreign.json(), {"error": "Chat unavailable"})
            denied = client.post(second_path + "/turns", headers=second, json=payload)
            assert_unavailable(denied)
            self.assertEqual(history(client, second, second_path), [])

            response = client.post(owner_path + "/turns", headers=owner, json=payload)
            self.assertEqual(response.status_code, 200, response.text)
            reply = response.json()
            self.assertEqual(json.loads(reply["text"]), json.loads((FIXTURES / "expected.json").read_text()))
            self.assertEqual(reply["role"], "assistant")
            self.assertEqual(reply["requestId"], payload["requestId"])
            first_history = history(client, owner, owner_path)

            replay = client.post(owner_path + "/turns", headers=owner, json=payload)
            self.assertEqual(replay.status_code, 200, replay.text)
            self.assertEqual(replay.json(), reply)
            self.assertEqual(history(client, owner, owner_path), first_history)

            store.set_entitlement(scope.workspace_id, PLUGIN_ID, False)
            denied = client.post(owner_path + "/turns", headers=owner,
                                 json={**payload, "requestId": "after-revocation"})
            assert_unavailable(denied)

        with service() as restarted:
            self.assertEqual(history(restarted, second, second_path), [])
            self.assertEqual(history(restarted, owner, owner_path), first_history)
            self.assertEqual(first_history, [dict(payload, role="user"), reply])
