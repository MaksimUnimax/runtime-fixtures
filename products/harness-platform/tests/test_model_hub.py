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
from platform_core.model_hub import Hub, CATALOG, provider_http
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

    def test_provider_traffic_uses_the_explicit_router(self):
        async def check():
            requests = []

            async def reject(reader, writer):
                request = await reader.readuntil(b"\r\n\r\n")
                requests.append(request.splitlines()[0])
                writer.write(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
                await writer.drain()
                writer.close()
                await writer.wait_closed()

            async with await asyncio.start_server(reject, "127.0.0.1", 0) as proxy:
                address = proxy.sockets[0].getsockname()
                with patch.dict(os.environ, {"HARNESS_MODEL_EGRESS_PROXY": f"http://{address[0]}:{address[1]}"}):
                    async with provider_http(timeout=3) as client:
                        self.assertFalse(await self.hub.refresh(client))
            self.assertEqual(requests, [b"CONNECT openrouter.ai:443 HTTP/1.1"])

        asyncio.run(check())

    def test_required_router_with_empty_address_cannot_send_directly(self):
        with patch.dict(os.environ, {"HARNESS_MODEL_EGRESS_REQUIRED": "1", "HARNESS_MODEL_EGRESS_PROXY": " "}):
            with self.assertRaisesRegex(RuntimeError, "require an outbound router"):
                provider_http(timeout=3)

    def test_alternatives_dedup_rotation_and_encryption(self):
        self.discover({"data":[model(GEMMA),model(GEMMA)]})
        self.assertEqual(self.hub.dashboard()["missing"]["cloudflare"],[GEMMA])
        for secret in ("fixture-cloudflare-secret-a","fixture-cloudflare-secret-b"):
            self.hub.save_key("cloudflare","main",secret)
        result = self.hub.dashboard()
        self.assertEqual(result["missing"],{"google":[GEMMA]})
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
                         billing="renewing_free_quota",customer_use=True,access="public_free",provider="new-company",provider_name="New Company") for mid in batch]
            return hub_research.validate({"results":rows},batch)
        self.assertTrue(hub_research.run(self.hub,review))
        self.assertEqual(self.hub.dashboard()["missing"]["new-company"],ids[4:])
        self.hub.save_key("new-company","test","example-test-key-1")
        self.assertEqual(self.hub.dashboard()["missing"],{})
        self.assertTrue(hub_research.run(self.hub,lambda _: self.fail("checked too soon")))

    def test_enrollment_survives_refresh_and_tracks_alternative_suppliers(self):
        mid = "dots-studio/dots-3-note-preview:free"
        self.discover({"data":[model(mid)]})
        def audit(batch):
            suppliers = [("dots-studio","Dots Studio","dots.ai"),("atlas-cloud","AtlasCloud","atlascloud.ai"),
                         ("new-company","New Company","example.org"),("other-company","Other Company","example.net")]
            rows = [dict(model=mid, finding="Direct API", source="https://"+domain+"/terms",
                         billing="renewing_free_quota",customer_use=True,access="public_free",provider=key,provider_name=name) for key,name,domain in suppliers]
            return hub_research.validate({"results":rows}, batch)
        self.assertTrue(hub_research.run(self.hub,audit))
        self.hub.save_key("new-company","test","synthetic-test-key")
        self.discover({"data":[model(mid)]})
        data = Hub(self.hub.path).dashboard()
        self.assertEqual(data["missing"],{"other-company":[mid]})
        self.assertEqual(len(data["models"][0]["findings"]),4)
        excluded = {row["id"] for row in data["enrollment"] if row["kind"]=="excluded" and not row["url"]}
        self.assertEqual(excluded,{"atlas","dots","mistral","nvidia","liquid-ai"})
        self.assertNotIn("atlas-cloud",data["providers"])
        self.assertIn("groq",data["providers"])
        with self.assertRaises(ValueError):
            self.hub.save_key("nvidia","pilot","synthetic-trial-key")
        self.assertEqual(self.hub.dashboard()["missing"],{"other-company":[mid]})
        with self.hub.database() as db:
            db.execute("UPDATE research SET checked=1")
            db.execute("UPDATE research_attempts SET attempted=1")
        self.assertFalse(hub_research.run(self.hub,lambda batch: [audit(batch)[0]]))
        self.assertEqual(self.hub.dashboard()["missing"],{"other-company":[mid]})
        with self.hub.database() as db:
            db.execute("UPDATE research_attempts SET attempted=1")
        def changed(batch):
            return [(*row[:3], "paid" if row[4].endswith("-company") else row[3], *row[4:]) for row in audit(batch)]
        self.assertTrue(hub_research.run(self.hub,changed))
        data = self.hub.dashboard()
        self.assertEqual(data["missing"],{})
        self.assertEqual(data["models"][0]["status"],"excluded")

    def test_research_separates_provider_products_and_trial_rights(self):
        mid = "nvidia/nemotron:free"
        record = dict(model=mid,finding="Direct API",source="https://build.nvidia.com/model",
                      billing="renewing_free_quota",customer_use=True,access="public_free",provider="nvidia",provider_name="NVIDIA")
        def validate(**changes):
            return hub_research.validate({"results":[record | changes]},[mid])[0]
        self.assertEqual(validate()[3],"conditional")
        self.assertEqual(validate(source="https://openrouter.ai/example")[3],"unknown")
        self.assertEqual(validate(provider="google",source="https://docs.cloud.google.com/example",access="paid")[4],"google-vertex")

    def test_limited_free_quota_keeps_known_key_candidate(self):
        self.discover({"data":[model(GEMMA)]})
        def review(batch):
            return [(GEMMA,"Бесплатно в пределах квоты","https://developers.cloudflare.com/workers-ai/platform/pricing/",
                     "public_free","cloudflare","Cloudflare")]
        self.assertTrue(hub_research.run(self.hub,review))
        self.assertIn("cloudflare",self.hub.dashboard()["missing"])

    def test_registration_requires_a_free_business_offer_and_respects_supplier_exclusions(self):
        mid = "nvidia/new-model:free"
        self.discover({"data":[model(mid)]})
        def review(batch):
            offers = [
                ("nv-build","NVIDIA","build.nvidia.com","zero_rate",True),
                ("liquidai","Liquid","console.liquid.ai","zero_rate",True),
                ("mistralai","La Plateforme","console.mistral.ai","zero_rate",True),
                ("launch","Launch Credits","credits.example","signup_credit",True),
                ("pilot","Testing Only","test.example","zero_rate",False),
                ("paid","Paid API","paid.example","metered",True),
                ("trial","Time Limited Trial","trial.example","trial",True),
                ("real-host","Independent Host","host.example","zero_rate",True)]
            rows = [dict(model=mid, finding="Условия тарифа", source="https://"+host+"/terms", access="public_free",
                         provider=provider, provider_name=name, billing=billing, customer_use=rights)
                    for provider,name,host,billing,rights in offers]
            return hub_research.validate({"results":rows},batch)
        self.assertTrue(hub_research.run(self.hub,review))
        self.discover({"data":[model(mid)]})
        state = Hub(self.hub.path).dashboard()
        self.assertEqual(state["missing"],{"real-host":[mid]})
        self.assertEqual({r["id"] for r in state["enrollment"] if r["url"]},{"zai","groq","google","cloudflare"})
        self.assertFalse({"nvidia","liquid-ai","mistral","launch","pilot","paid","trial"} & state["providers"].keys())
        with self.hub.database() as db:
            db.execute("UPDATE research_revision SET version='legacy'")
        self.assertNotIn("real-host",self.hub.dashboard()["providers"])
        self.assertEqual(self.hub.dashboard()["missing"],{})

    def test_zero_price_promotion_expires_even_without_another_catalog_refresh(self):
        mid = "new/promo:free"
        self.discover({"data":[model(mid)]})
        row = dict(model=mid, finding="Акция", source="https://promo.example/terms", access="public_free",
                   provider="promo",provider_name="Promo",billing="promo_zero_rate",customer_use=True)
        self.assertEqual(hub_research.validate({"results":[row]},[mid])[0][3],"conditional")
        row["ends_at"] = "2099-05-01T00:00:00+00:00"
        self.assertTrue(hub_research.run(self.hub,lambda batch: hub_research.validate({"results":[row]},batch)))
        self.assertEqual(self.hub.dashboard()["missing"],{"promo":[mid]})
        with self.hub.database() as db:
            db.execute("UPDATE research_expiry SET expires=1")
        state = self.hub.dashboard()
        self.assertEqual(state["missing"],{})
        self.assertNotIn("promo",state["registration_providers"])
        with self.assertRaises(ValueError):
            self.hub.save_key("promo","new","synthetic-promo-key")

    def test_legacy_trial_key_can_rotate_without_becoming_a_registration(self):
        with self.hub.database() as db:
            db.execute("INSERT INTO hub_keys VALUES('old-mistral','mistral','Original',X'00')")
        self.hub.save_key("mistral","Original","new-synthetic-secret")
        state = self.hub.dashboard()
        self.assertEqual([key["id"] for key in state["keys"]],["old-mistral"])
        self.assertNotIn("mistral",state["registration_providers"])
        with self.assertRaises(ValueError):
            self.hub.save_key("mistral","Additional","new-synthetic-secret")

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
            with self.hub.database() as conn:
                conn.execute("INSERT INTO hub_keys VALUES('existing-dots','dots','pilot',X'00')")
            result = http.post(url+"/keys",json={"provider":"dots","label":"pilot","key":"dummy-sample-dots"}, headers=headers)
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()["keys"][0]["label"],"pilot")
            self.assertNotIn("dummy-sample",result.text)
            dots_key = result.json()["keys"][0]["id"]
            cloudflare = {"provider":"cloudflare","label":"main","key":"dummy-cloudflare-token"}
            before = http.post(url+"/keys",json=cloudflare,headers=headers).json()["keys"][0]
            account = {"account_id":"a"*32}
            account_path = url+"/keys/"+before["id"]+"/cloudflare-account"
            self.assertFalse(before["account_configured"])
            self.assertEqual(http.post(account_path,json=account,headers={"Authorization":"Bearer "+member}).status_code,403)
            self.assertEqual(http.post(account_path,json={"account_id":"123"},headers=headers).status_code,400)
            self.assertEqual(http.post(url+"/keys/"+dots_key+"/cloudflare-account",json=account,headers=headers).status_code,400)
            result = http.post(account_path,json=account,headers=headers)
            self.assertEqual(result.status_code,200)
            self.assertTrue(result.json()["keys"][0]["account_configured"])
            self.assertNotIn(account["account_id"],result.text)
            with self.hub.database() as conn:
                old_token = conn.execute("SELECT sealed FROM hub_keys WHERE id=?", (before["id"],)).fetchone()[0]
            cloudflare["key"] = "dummy-rotated-cloudflare-token"
            rotated = http.post(url+"/keys",json=cloudflare,headers=headers).json()["keys"][0]
            self.assertFalse(rotated["account_configured"])
            with self.assertRaisesRegex(ValueError, "изменился во время проверки"):
                self.hub.save_cloudflare_account(before["id"], account["account_id"], expected_sealed=old_token)
            self.assertEqual(http.get("/api/admin/provider-keys",headers=headers).json().keys(),{"deepseek","openrouter"})
            http.cookies.set("__Host-harness_session",admin)
            self.assertIn('href="/admin/model-hub"',http.get("/admin").text)
            self.assertIn("Ключи хаба",http.get("/admin/model-hub").text)
            self.assertEqual(http.post(account_path,json=account).status_code,403)
            self.assertEqual(http.post(url+"/keys",json={"provider":"dots","label":"pilot","key":"other-dummy-key"}).status_code,403)

if __name__ == "__main__":
    unittest.main()
