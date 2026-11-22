"""Authenticated HTTP turn -> real Harness -> scoped gateway -> local provider -> per-operation cost."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import selectors
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.identity import IdentityStore
from platform_core.operation_grants import initialize_grants

PRODUCT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(os.environ.get("HARNESS_NODE_MODULES"), "requires pinned native Harness")
class MeteredChatAcceptance(unittest.TestCase):
    def setUp(self):
        self.enterContext(patch.dict(os.environ, {"HARNESS_RUB_PER_USD":"80"}))
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.db = root / "platform.sqlite"
        self.journal = root / "usage.jsonl"
        self.chats = root / "chats"
        self.password = "Local fixture password 741"
        with IdentityStore(self.db) as store:
            for name in ("owner-a", "owner-b"):
                store.create_account(name, self.password)
                store.set_admin(name, True)
                store.grant_coins(name, "10", "test-credit-" + name, "Acceptance fixture")
        initialize_grants(self.db)
        gateway = subprocess.Popen(
            ["node", str(PRODUCT / "tests/metered-chat-gateway.mjs"), str(self.db), str(self.journal)],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        )
        def stop():
            gateway.stdin.close()
            try:
                gateway.wait(timeout=5)
            except subprocess.TimeoutExpired:
                gateway.kill()
                gateway.wait()
            gateway.stdout.close()
        self.addCleanup(stop)
        with selectors.DefaultSelector() as ready:
            ready.register(gateway.stdout, selectors.EVENT_READ)
            self.assertTrue(ready.select(8), "Gateway startup timed out")
        address = gateway.stdout.readline().strip()
        self.assertTrue(address.startswith("http://127.0.0.1:"))
        self.enterContext(patch.dict(os.environ, {"HARNESS_OFFLINE_MODEL": "0", "HARNESS_MODEL_GATEWAY_URL": address,
                                                  "HARNESS_USAGE_JOURNAL": str(self.journal)}))

    def client(self):
        return TestClient(create_app(self.db, self.chats, composition_module="examples.reference_plugin"))

    def actor(self, client, name):
        token = client.post("/api/login", json={"login": name, "password": self.password}).json()["token"]
        headers = {"Authorization": "Bearer " + token}
        chat = client.post("/api/chats", headers=headers).json()["chatId"]
        with IdentityStore(self.db) as store:
            scope = store.resolve_chat(token, chat)
        return headers, chat, scope

    def test_marketplace_chat_stream_commits_once_and_keeps_json_api(self):
        with tempfile.TemporaryDirectory() as directory:
            key = Path(directory) / "integrations.key"
            key.write_bytes(os.urandom(32))
            with patch.dict(os.environ, {"HARNESS_INTEGRATIONS_KEY_FILE": str(key)}), self.client() as client:
                headers, chat, _ = self.actor(client, "owner-a")
                integration = client.post("/api/integrations", headers=headers, json={
                    "provider": "ozon", "name": "Магазин Тест", "chatId": chat,
                    "fields": {"client_id": "fixture-id", "api_key": "fixture-secret"}})
                self.assertEqual(integration.status_code, 200, integration.text)
                url = f"/api/chats/{chat}/turns"
                payload = {"text": "browser fixture", "requestId": "marketplace-stream"}
                response = client.post(url, headers={**headers, "Accept": "application/x-ndjson"},
                                       json=payload)
                self.assertTrue(response.headers["Content-Type"].startswith("application/x-ndjson"))
                frames = [json.loads(line) for line in response.iter_lines()]
                self.assertEqual(frames[0], {"pending": True})
                self.assertEqual(frames[-1]["status"], 200, frames[-1])
                self.assertEqual(frames[-1]["body"]["text"], "answer to browser fixture")
                self.assertEqual(client.post(url, headers=headers, json=payload).json(), frames[-1]["body"])
                with sqlite3.connect(self.db) as conn:
                    attempts = conn.execute("SELECT count(*) FROM coin_attempts").fetchone()[0]
                self.assertEqual(attempts, 1)

    def report(self):
        folder = PRODUCT / "usage-reconciliation"
        run = subprocess.run([sys.executable, "reconcile.py", str(self.journal), "--tariffs", "tariffs.json",
                              "--by-operation"], cwd=folder, capture_output=True, text=True, check=False)
        self.assertIn(run.returncode, (0, 1), run.stderr)
        return json.loads(run.stdout)

    def test_admin_model_default_applies_to_existing_chats_and_persists(self):
        offered = [{"id": "deepseek-flash"}, {"id": "deepseek-v4-pro", "name": "DeepSeek Pro",
                    "effort": {"supported_levels": ["low", "high", "max"], "default_level": "high"}},
                   {"id": "unpriced-model"}]
        async def catalog(req):
            if req.url.path == "/health":
                self.assertNotIn("Authorization", req.headers)
                return httpx.Response(200, json={"models": ["deepseek-flash", "deepseek-v4-pro"]})
            self.assertEqual(str(req.url), "https://api.deepseek.com/models")
            self.assertEqual(req.headers["Authorization"], "Bearer fixture-catalog-key")
            return httpx.Response(200, json={"data": offered})
        def send(client, who, key):
            response = client.post(f"/api/chats/{who[1]}/turns", headers=who[0],
                                   json={"text": "model default test", "requestId": key})
            self.assertEqual(response.status_code, 200, response.text)

        with IdentityStore(self.db) as db:
            db.set_admin("owner-b", False)
        with self.client() as client, patch("platform_core.provider_keys.read", return_value="fixture-catalog-key"):
            client.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(catalog))
            admin, other = [self.actor(client, name) for name in ("owner-a", "owner-b")]
            url = "/api/admin/chat-default"
            models = "/api/admin/chat-models"
            self.assertEqual(client.get(models).status_code, 401)
            self.assertEqual(client.get(models, headers=other[0]).status_code, 403)
            options = client.get(models, headers=admin[0]).json()["models"]
            self.assertEqual([m["id"] for m in options], ["deepseek-flash", "deepseek-v4-pro"])
            self.assertEqual(client.get(url, headers=admin[0]).json(), {"model": "deepseek-flash", "effort": "high"})
            for who in (admin, other):
                send(client, who, "original")
            chosen = {"model": "deepseek-v4-pro", "effort": "low"}
            self.assertEqual(client.post(url, headers=other[0], json=chosen).status_code, 403)
            self.assertEqual(client.post(url, headers=admin[0], json={**chosen, "model":"unpriced-model"}).status_code, 400)
            self.assertEqual(client.post(url, headers=admin[0], json=chosen).json(), chosen)
            for who in (admin, other):
                send(client, who, "new-model")
            desired = {**chosen, "effort": "off"}
            self.assertEqual(client.post(url, headers=admin[0], json=desired).json(), desired)
            offered.clear()
            self.assertEqual(client.post(url, headers=admin[0], json=chosen).status_code, 400)
        with self.client() as restarted:
            self.assertEqual(restarted.get(url, headers=admin[0]).json(), desired)
            send(restarted, other, "new-model")  # replay across changed default
            send(restarted, other, "same-model-new-effort")
        completed = [row for row in map(json.loads, self.journal.read_text().splitlines()) if row.get("status")==200]
        self.assertEqual([(r["model"], r["thinking"], r["effort"]) for r in completed], [
            ("deepseek-flash", "enabled", "high"), ("deepseek-flash", "enabled", "high"),
            ("deepseek-v4-pro", "enabled", "low"), ("deepseek-v4-pro", "enabled", "low"),
            ("deepseek-v4-pro", "disabled", None)])

    def test_parallel_owners_model_tool_step_and_replay_after_restart(self):
        with self.client() as client:
            a, b = (self.actor(client, name) for name in ("owner-a", "owner-b"))
            with IdentityStore(self.db) as store:
                store.set_entitlement(a[2].workspace_id, "reference-text", True)
                store.set_enabled(a[2], "reference-text", True)
            def post(user, text):
                return client.post(f"/api/chats/{user[1]}/turns", headers=user[0],
                                   json={"requestId": "shared-id", "text": text})
            with ThreadPoolExecutor(max_workers=3) as pool:
                pending = [pool.submit(post, who, text) for who, text in
                           ((a, "tool fixture"), (b, "second fixture"), (a, "tool fixture"))]
                responses = [f.result(timeout=40) for f in pending]
            for response in responses:
                self.assertEqual(response.status_code, 200, response.text)
            first, second, duplicate = [r.json() for r in responses]
            wallet = client.get("/api/wallet", headers=a[0]).json()
            self.assertEqual(len(wallet["charges"]), 1)
            self.assertEqual(wallet["charges"][0]["coins"], "0.00216")
            self.assertEqual(len(wallet["charges"][0]["meter"]["attempts"]), 3)
            self.assertEqual(first, duplicate)
            self.assertEqual(first["modelUsage"], {"coins":"0.00216","rub":"0.00216","pending":False,
                "tokens":{"input":30,"cache":0,"output":15},"providers":{"DeepSeek":{"input":30,"cache":0,"output":15}}})
            self.assertEqual(first["text"], "tool result received")
            self.assertEqual(second["text"], "answer to second fixture")
            self.assertNotEqual(first["operationId"], second["operationId"])
            self.assertEqual(first["modelCost"], {"rub": "0.00216", "usd": "0.000027"})
            self.assertEqual(second["modelCost"]["rub"], "0.00072")
            self.assertEqual(post(a, "different").status_code, 409)
            denied = client.post(f"/api/chats/{a[1]}/turns", headers=b[0], json={"requestId": "x", "text": "other"})
            self.assertEqual(denied.status_code, 404)
        with self.client() as client:
            response = client.post(f"/api/chats/{a[1]}/turns", headers=a[0], json={"requestId": "shared-id", "text": "tool fixture"})
            self.assertEqual(response.json(), first)
            history = client.get(f"/api/chats/{a[1]}/messages", headers=a[0]).json()
            self.assertEqual(history[-1], first)
        report = self.report()
        self.assertEqual(report["status"], "complete")
        rows = {r["operation_id"]: r for r in report["attribution"]["operations"]}
        self.assertEqual(len(rows), 2)
        for user, answer, count, rub in ((a, first, 3, "0.00216"), (b, second, 1, "0.00072")):
            row = rows[answer["operationId"]]
            self.assertEqual((row["workspace_id"], row["unique_attempts"], row["total_rub"]),
                             (user[2].workspace_id, count, rub))
        with sqlite3.connect(self.db) as connection:
            self.assertEqual(connection.execute("SELECT count(*) FROM usage_grants").fetchone()[0], 0)

    def test_provider_sees_attach_and_revoke_after_a_previous_answer(self):
        vault=self.db.with_suffix(".key")
        vault.write_bytes(os.urandom(32))
        with patch.dict(os.environ,{"HARNESS_INTEGRATIONS_KEY_FILE":str(vault)}), self.client() as client:
            headers,chat,_=self.actor(client,"owner-a")
            url="/api/chats/"+chat
            def send(rid,prompt):
                response=client.post(url+"/turns",headers=headers,json={"requestId":rid,"text":prompt})
                self.assertEqual(response.status_code,200,response.text)
                return response.json()["text"]
            send("first","первое сообщение")
            ids=[]
            for index in (1,2):
                saved=client.post("/api/integrations",headers=headers,json={
                    "provider":"ozon","name":f"Магазин Тест {index}","chatId":chat,
                    "fields":{"client_id":"test-id","api_key":"private-sentinel"}})
                saved.raise_for_status()
                ids.append(saved.json()["id"])
                observed=json.loads(send("attach"+str(index),"inspect connections "+str(index)))
                self.assertEqual(observed,{"currentStore":True,"boundName":True,"freshUpdate":True,
                    "active":[],"allImmediate":True,"secretLeaked":False})
            for cid in ids:
                client.post(url+"/integrations",headers=headers,json={"connectionId":cid,"enabled":False}).raise_for_status()
            removed=json.loads(send("revoke","inspect connections removed"))
            self.assertEqual(removed,{"currentStore":False,"boundName":False,"freshUpdate":True,
                "active":[],"allImmediate":True,"secretLeaked":False})
            expected=["первое сообщение","inspect connections 1","inspect connections 2","inspect connections removed"]
            messages=client.get(url+"/messages",headers=headers).json()
            self.assertEqual([msg["text"] for msg in messages if msg["role"]=="user"],expected)
            events=client.get(url+"/events",headers=headers).json()["events"]
            self.assertEqual([e["data"]["content"][0]["text"] for e in events if e["type"]=="user/message"],expected)

    def test_uncertain_provider_result_is_not_redispatched(self):
        with self.client() as client:
            headers, chat, _ = self.actor(client, "owner-a")
            url = f"/api/chats/{chat}/turns"
            bad = {"requestId": "failed-id", "text": "uncertain fixture"}
            first = client.post(url, headers=headers, json=bad)
            self.assertEqual((first.status_code, first.json()["error"]), (409, "turn_unconfirmed"))
        with self.client() as client:
            again = client.post(url, headers=headers, json=bad)
            self.assertEqual((again.status_code, again.json()["error"]), (409, "turn_unconfirmed"))
            self.assertEqual(again.json()["operationId"], first.json()["operationId"])
            changed = client.post(url, headers=headers, json={**bad, "text": "changed"})
            self.assertEqual(changed.status_code, 409)
            self.assertEqual(client.get(f"/api/chats/{chat}/messages", headers=headers).json(), [])
            self.assertEqual(client.post(url, headers=headers, json={"requestId": "new-id", "text": "ok"}).status_code, 200)
        report = self.report()
        self.assertEqual(report["unique_attempts"], 2)
        self.assertEqual(report["status"], "partial")
        self.assertIsNone(report["total_rub"])
        failed, = [row for row in report["attribution"]["operations"]
                   if row["operation_id"] == first.json()["operationId"]]
        self.assertIsNone(failed["total_rub"])

    def test_worker_crash_after_admission_keeps_a_single_attempt(self):
        with self.client() as client:
            headers, chat, _ = self.actor(client, "owner-a")
            url = f"/api/chats/{chat}/turns"
            body = {"requestId": "interrupt-id", "text": "interrupt fixture"}
            with ThreadPoolExecutor(max_workers=1) as pool:
                in_flight = pool.submit(client.post, url, headers=headers, json=body)
                deadline = time.monotonic() + 10
                while not (self.journal.exists() and "admitted" in self.journal.read_text()):
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.05)
                # Kill only this test's native worker after the shared gateway admitted its call.
                client.portal.call(client.app.state.worker.process.kill)
                self.assertEqual(in_flight.result(timeout=10).status_code, 503)
            # While the original call might still be running the same ID is busy.
            self.assertEqual(client.post(url, headers=headers, json=body).json()["error"], "busy")
            with sqlite3.connect(self.chats / "native-chats.sqlite3") as db:
                db.execute("UPDATE native_model_dispatch SET active_until=0")
            self.assertEqual(client.post(url, headers=headers, json=body).json()["error"], "turn_unconfirmed")
            self.assertEqual(self.report()["unique_attempts"], 1)

    def test_payment_and_admin_membership_are_independent(self):
        with self.client() as client, IdentityStore(self.db) as store:
            store.create_account("visitor", self.password)
            headers, chat, _ = self.actor(client, "visitor")
            url = f"/api/chats/{chat}/turns"
            body = {"requestId": "first", "text": "ordinary"}
            for admin in (False, True):
                store.set_admin("visitor", admin)
                self.assertEqual(client.post(url, headers=headers, json=body).status_code, 402)
            self.assertFalse(self.journal.exists())
            store.set_admin("visitor", False)
            store.grant_coins("visitor", "10", "test-credit-visitor", "Acceptance fixture")
            response = client.post(url, headers=headers, json=body)
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("modelCost", response.json())
            store.set_paid("visitor", False)
            self.assertEqual(client.post(url, headers=headers, json=body).json(), response.json())
            denied = client.post(url, headers=headers, json={**body, "requestId": "second"})
            self.assertEqual((denied.status_code, denied.json()["error"]), (402, "payment_required"))
            self.assertEqual(self.report()["unique_attempts"], 1)

    def test_ordinary_chat_omits_internal_receipts_and_admin_role_is_live(self):
        with IdentityStore(self.db) as identity:
            identity.create_account("admin", self.password)  # A login name grants no role.
            identity.grant_coins("admin", "10", "test-credit-admin", "Acceptance fixture")
        with self.client() as client:
            headers, chat, _ = self.actor(client, "admin")
            base = f"/api/chats/{chat}"
            body = {"requestId": "private-receipt", "text": "ordinary"}
            private = {"operationId", "modelCost", "modelUsage", "adminCosts", "rub", "usd"}
            def ordinary(response):
                self.assertTrue(response.is_success or response.status_code == 409, response.text)
                for key in private:
                    self.assertNotIn('"' + key + '"', response.text)

            with patch.object(client.app.state.admin_costs, "for_operations", side_effect=AssertionError):
                ordinary(client.post(base + "/turns", headers=headers, json=body))
                ordinary(client.get(base + "/messages", headers=headers))
                ordinary(client.get(base + "/events?admin=true", headers=headers))
                ordinary(client.post(base + "/turns", headers=headers, json={
                    "requestId": "uncertain", "text": "uncertain fixture",
                }))

            cost = {"rub": "0.00072", "usd": "0.000009"}
            with IdentityStore(self.db) as identity:
                identity.set_admin("admin", True)
            admin = client.get(base + "/messages", headers=headers).json()
            self.assertEqual(admin[-1]["modelCost"], cost)
            self.assertEqual(client.post(base + "/turns", headers=headers, json=body).json(), admin[-1])
            other_headers, other_chat, _ = self.actor(client, "owner-b")
            self.assertEqual(client.get(f"/api/chats/{other_chat}/messages", headers=headers).status_code, 404)
            self.assertEqual(client.get(base + "/events", headers=other_headers).status_code, 404)
            with IdentityStore(self.db) as identity:
                identity.set_admin("admin", False)
            ordinary(client.get(base + "/events", headers=headers))
            ordinary(client.post(base + "/turns", headers=headers, json=body))
        self.assertEqual(self.report()["unique_attempts"], 2)
