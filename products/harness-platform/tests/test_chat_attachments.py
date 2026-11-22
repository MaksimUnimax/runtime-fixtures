"""Exercise attachment ownership, model access and replay over real chat HTTP."""
import io
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from openpyxl import Workbook
from starlette.testclient import TestClient

from tests.auth_fixture import email_opted_out

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore
from platform_core.operation_grants import initialize_grants


@unittest.skipUnless(os.environ.get("HARNESS_NODE_MODULES"), "requires pinned native Harness")
class ChatAttachmentAcceptance(unittest.TestCase):
    def test_attachment_is_readable_and_retained_in_only_the_receiving_chat(self):
        self.enterContext(patch.dict(os.environ, {"HARNESS_OFFLINE_MODEL": "1", "HARNESS_OFFLINE_ADAPTER": "chat_attachments"}))
        directory = Path(self.enterContext(TemporaryDirectory()))
        database = directory / "account.sqlite3"
        with IdentityStore(database) as identity:
            for login in ("first", "second"):
                identity.create_account(login, "Test password 2026")
        initialize_grants(database)
        app = create_app(database, directory / "chats")
        with TestClient(app) as client:
            def account(login):
                email_opted_out(client.app.state.identity, login)
                response = client.post("/api/login", json={"login": login, "password": "Test password 2026"})
                return {"Authorization": "Bearer " + response.json()["token"]}

            def chat(headers):
                return client.post("/api/chats", headers=headers).json()["chatId"]

            first, second = account("first"), account("second")
            first_chat, next_chat, other_chat = chat(first), chat(first), chat(second)
            upload = "/api/session/uploadFileBinary"
            book = Workbook()
            book.active.append(["Маркер отчёта", 714598])
            source = io.BytesIO()
            book.save(source)
            headers = {**first, "Content-Type": "application/octet-stream"}
            for target, auth in ((first_chat, {}), (other_chat, headers)):
                response = client.post(upload, headers=auth, content=source.getvalue(), params={"sessionId": target})
                self.assertIn(response.status_code, (401, 404))
            response = client.post(upload, headers=headers, content=source.getvalue(),
                                   params={"sessionId": first_chat, "name": "отчёт.xlsx"})
            self.assertTrue(response.json().get("ok"), response.text)
            receipt = response.json()["value"]["receiptId"]
            path = f"/api/chats/{first_chat}"
            download = path + "/files/" + receipt
            self.assertEqual(client.get(download, headers=first).status_code, 404)
            wrong_scope = {"requestId": "read-1", "text": "Прочитай файл", "attachments": [receipt]}
            for target, auth in ((next_chat, first), (other_chat, second)):
                self.assertEqual(client.post(f"/api/chats/{target}/turns", headers=auth, json=wrong_scope).status_code, 404)
            payload = {**wrong_scope, "text": ""}
            answer = client.post(path + "/turns", headers=first, json=payload)
            self.assertEqual(answer.status_code, 200, answer.text)
            self.assertIn("714598", answer.json()["text"])
            retry = client.post(path + "/turns", headers=first, json=payload)
            self.assertEqual(retry.json(), answer.json())
            self.assertEqual(client.post(path + "/turns", headers=first, json=wrong_scope).status_code, 409)
            self.assertEqual(client.get(download, headers=second).status_code, 404)
            retrieval = client.get(download, headers=first)
            self.assertEqual(retrieval.content, source.getvalue())
            self.assertIn("attachment;", retrieval.headers["Content-Disposition"])
            events = client.get(path + "/events", headers=first).json()
            user = [row["data"] for row in events["events"] if row["type"] == "user/message"]
            self.assertEqual(len(user), 1)
            self.assertEqual(user[0]["content"][-1]["attachment"]["download"], download)
        with TestClient(create_app(database, directory / "chats")) as restarted:
            self.assertEqual(restarted.get(download, headers=first).content, source.getvalue())
            self.assertEqual(restarted.delete(path, headers=first).status_code, 200)
            self.assertEqual(restarted.get(download, headers=first).status_code, 404)
