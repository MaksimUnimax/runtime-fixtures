"""Check the public request boundary without needing the upstream Node modules."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from starlette.testclient import TestClient

from tests.auth_fixture import email_opted_out

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore


class RequestBoundaryTests(unittest.TestCase):
    def test_server_owns_scope_and_rejects_malformed_payloads_before_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            db = Path(directory) / "state.sqlite3"
            with IdentityStore(db) as identity:
                identity.create_account("owner", "A password for the HTTP test")
            with TestClient(create_app(db, Path(directory) / "history")) as client:
                credentials = {"login": "owner", "password": "A password for the HTTP test"}
                email_opted_out(client.app.state.identity, credentials["login"])
                response = client.post("/api/login", json=credentials)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
                token = response.json()["token"]
                auth = {"Authorization": f"Bearer {token}"}
                chat = client.post("/api/chats", headers=auth).json()["chatId"]
                with IdentityStore(db) as identity:
                    scope = identity.resolve_chat(token, chat)
                url = f"/api/chats/{chat}/messages"
                payload = {"requestId": "retry_01", "text": "Сообщение"}
                with patch("platform_core.chat_api.ChatWorker.request", new_callable=AsyncMock) as worker:
                    worker.return_value = dict(role="user", **payload)
                    response = client.post(url, json=payload, headers=auth)
                    self.assertEqual(response.status_code, 200, response.text)
                    worker.assert_awaited_once_with(scope, "append", **payload)
                    worker.reset_mock()
                    for body in (dict(actorId="override", **payload), dict(workspaceId="override", **payload),
                                 dict(role="assistant", **payload), {"requestId": [], "text": "x"},
                                 {"requestId": "ok", "text": "\ud800"}, {"requestId": "ok", "text": " "}):
                        response = client.post(url, content=json.dumps(body),
                                               headers={**auth, "Content-Type": "application/json"})
                        self.assertEqual(response.status_code, 400, response.text)
                    oversized = client.post(url, json={**payload, "text": "x" * 65536}, headers=auth)
                    self.assertEqual(oversized.status_code, 413)
                    self.assertEqual(client.post(url, content="x", headers=auth).status_code, 415)
                    self.assertEqual(client.get(url).status_code, 401)
                    worker.assert_not_awaited()
