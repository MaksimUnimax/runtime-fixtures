import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from platform_core import hub_research
from platform_core.model_hub import Hub, CATALOG
from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.identity import _principal

def model(mid):
    return {"id": mid, "name": mid, "pricing": {"prompt": "0", "completion": "0"},
            "architecture": {"output_modalities": ["text"]}, "supported_parameters": ["tools"]}

GEMMA = "google/gemma-4-26b-a4b-it:free"

class ModelHubTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.hub = Hub(self.root / "model-hub.sqlite3")
        vault = self.root / "master"
        vault.write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ, {"HARNESS_INTEGRATIONS_KEY_FILE": str(vault)}))

    def discover(self, payload, status=200):
        def handle(req):
            self.assertEqual(str(req.url), CATALOG)
            self.assertNotIn("Authorization", req.headers)
            return httpx.Response(status, json=payload)
        async def run():
            async with httpx.AsyncClient(transport=httpx.MockTransport(handle)) as client:
                return await self.hub.refresh(client)
        return asyncio.run(run())

    def test_refresh_failure_and_zero_matches(self):
        self.assertTrue(self.discover({"data":[dict(model(GEMMA),pricing={"prompt":"0","completion":"0","overrides":[]}), dict(model("example/tiered"),
            pricing={"prompt":"1","completion":"2","overrides":[{"utc_days":["sunday"],"prompt":"2"}]})]}))
        for data in ({"data":[]}, {"data":[{"id":"a/b","pricing":{}}]},
                     {"data":[dict(model(GEMMA),name={})]},
                     {"data":[dict(model(GEMMA),pricing={"prompt":{},"completion":"0"})]}):
            self.assertFalse(self.discover(data))
            self.assertEqual(self.hub.dashboard()["models"][0]["model"], GEMMA)
        self.assertFalse(self.discover({},503))
        self.assertEqual(self.hub.dashboard()["catalog"]["error"], "HTTP 503")
        self.assertTrue(self.discover({"data":[dict(model(GEMMA),pricing={"prompt":"1","completion":"1"})]}))
        self.assertEqual(self.hub.dashboard()["models"], [])

    def test_alternatives_dedup_rotation_and_encryption(self):
        self.discover({"data":[model(GEMMA),model(GEMMA)]})
        self.assertEqual(self.hub.dashboard()["missing"]["cloudflare"],[GEMMA])
        for secret in ("fixture-cloudflare-secret-a","fixture-cloudflare-secret-b"):
            self.hub.save_key("cloudflare","main",secret)
        result = self.hub.dashboard()
        self.assertEqual(result["missing"],{})
        self.assertEqual(len(result["keys"]),1)
        self.assertEqual(result["models"][0]["status"],"key_saved")
        self.assertNotIn("fixture-cloudflare",json.dumps(result))
        self.assertNotIn(b"fixture-cloudflare",self.hub.path.read_bytes())

    def test_new_provider_action_and_research_retry(self):
        ids = ["new/m"+str(i) for i in range(6)]
        self.discover({"data":[model(mid) for mid in ids]})
        def broken(_): raise ValueError("failure")
        self.assertFalse(hub_research.run(self.hub,broken))
        def review(batch):
            self.assertEqual(batch,ids[4:])
            rows = [dict(model=mid, finding="Бесплатный API с квотой", source="https://example.org/terms",
                         access="public_free",provider="new-company",provider_name="New Company") for mid in batch]
            return hub_research.validate({"results":rows},batch)
        self.assertTrue(hub_research.run(self.hub,review))
        self.assertEqual(self.hub.dashboard()["missing"]["new-company"],ids[4:])
        self.hub.save_key("new-company","test","example-test-key-1")
        self.assertEqual(self.hub.dashboard()["missing"],{})
        self.assertTrue(hub_research.run(self.hub,lambda _: self.fail("checked too soon")))

    def test_research_separates_provider_products_and_trial_rights(self):
        mid = "nvidia/nemotron:free"
        record = dict(model=mid,finding="Direct API",source="https://build.nvidia.com/model",
                      access="public_free",provider="nvidia",provider_name="NVIDIA")
        def validate(**changes):
            return hub_research.validate({"results":[record | changes]},[mid])[0]
        self.assertEqual(validate()[3],"conditional")
        self.assertEqual(validate(source="https://openrouter.ai/example")[3],"unknown")
        self.assertEqual(validate(provider="google",source="https://docs.cloud.google.com/example",access="paid")[4],"google-vertex")

    def test_admin_and_member_through_http(self):
        db = self.root / "identity.db"
        with RegistrationStore(db) as store:
            for name in ["operator","seller"]:
                store.create_account(name,"a-long-password")
            admin = store.login("operator","a-long-password")
            member = store.login("seller","a-long-password")
            with store._write() as conn:
                actor, _ = _principal(conn,admin)
                conn.execute("INSERT INTO identity_admins(actor_id) VALUES(?)",(actor,))
        with TestClient(create_app(db,self.root/"chats"),base_url="https://testserver") as http:
            url = "/api/admin/model-hub"
            for path in [url, "/admin/model-hub"]:
                self.assertIn(http.get(path).status_code,(401,403))
            self.assertEqual(http.get(url,headers={"Authorization":"Bearer "+member}).status_code,403)
            headers = {"Authorization":"Bearer "+admin}
            result = http.post(url+"/keys",json={"provider":"dots","label":"pilot","key":"dummy-sample-dots"}, headers=headers)
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()["keys"][0]["label"],"pilot")
            self.assertNotIn("dummy-sample",result.text)
            self.assertEqual(http.get("/api/admin/provider-keys",headers=headers).json().keys(),{"deepseek","openrouter"})
            http.cookies.set("__Host-harness_session",admin)
            self.assertIn('href="/admin/model-hub"',http.get("/admin").text)
            self.assertIn("Ключи хаба",http.get("/admin/model-hub").text)
            self.assertEqual(http.post(url+"/keys",json={"provider":"dots","label":"pilot","key":"other-dummy-key"}).status_code,403)

if __name__ == "__main__":
    unittest.main()
