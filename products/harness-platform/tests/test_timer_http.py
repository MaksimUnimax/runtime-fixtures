from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from uuid import uuid4

from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.user_plugins.timer import store


class TimerHTTP(unittest.TestCase):
    def setUp(self):
        path = Path(self.enterContext(TemporaryDirectory()))
        self.client = self.enterContext(TestClient(create_app(path / "identity.db", path / "chats"),
                                                   base_url="https://example.test"))
        self.identity = self.client.app.state.identity
        for login in ("timer-owner", "timer-neighbour"):
            self.identity.create_account(login, "fixture-password")
        self.token = self.identity.login("timer-owner", "fixture-password")
        self.owner = {"Authorization": "Bearer " + self.token}
        self.other = {"Authorization": "Bearer " + self.identity.login("timer-neighbour", "fixture-password")}
        self.scope = self.identity.create_user_chat(self.token)
        self.plugins = "/api/chats/" + self.scope.chat_id + "/plugins"
        self.url = self.plugins + "/timer"

    def post(self, suffix, payload):
        return self.client.post(self.url + suffix, json=payload, headers=self.owner)

    def enable(self):
        self.client.post("/api/plugins", json={"plugin": "timer", "installed": True},
                         headers=self.owner).raise_for_status()
        self.client.post(self.plugins, json={"plugin": "timer", "enabled": True},
                         headers=self.owner).raise_for_status()

    def test_catalog_and_chat_scope(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)
        self.assertEqual(self.client.get(self.url, headers=self.owner).status_code, 403)
        self.enable()
        listing = self.client.get(self.plugins, headers=self.owner).json()["plugins"]
        timer, = [p for p in listing if p["id"] == "timer"]
        self.assertTrue(timer["installed"] and timer["enabled"])
        self.assertEqual(self.client.get(self.url, headers=self.other).status_code, 404)
        self.assertEqual(self.client.get(self.url, headers=self.owner).json()["events"], [])

    def test_user_cannot_inject_preview_or_confirm_an_old_revision(self):
        self.enable()
        params = {"requestId": uuid4().hex, "kind": "action", "text": "При наличии склада создать одну поставку"}
        self.assertEqual(self.post("/drafts", {**params, "plan": {}}).status_code, 400)
        dirty = self.post("/drafts", params).json()
        key = dirty["id"]
        url = "/drafts/" + key
        self.assertEqual(self.post(url+"/confirm", {"revision": 1, "receipt": "made-up"}).status_code, 409)
        self.post(url+"/refine", {"revision": 1, "text": "Только Москва"}).raise_for_status()
        with self.identity._write() as db:
            receipt = store.record_preview(db, self.scope, key, 2, {"kind":"interval", "zone":"UTC", "every_us":37000000},
                {"steps":[{"templateId":"fixture.warehouse"}]}, "Появился склад в выбранном кластере.")
        params = {"revision": 2, "receipt": receipt}
        event = self.post(url+"/confirm", params).json()
        self.assertEqual(self.post(url+"/confirm", params).json()["id"], event["id"])
        self.post("/events/"+event["id"]+"/pause", {}).raise_for_status()
        self.assertEqual(self.client.get(self.url, headers=self.owner).json()["events"][0]["status"], "paused")
        self.post("/events/"+event["id"]+"/resume", {}).raise_for_status()
        self.post("/events/"+event["id"]+"/delete", {}).raise_for_status()
        self.assertEqual(self.client.get(self.url, headers=self.owner).json()["events"], [])
