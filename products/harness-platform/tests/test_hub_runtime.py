import asyncio
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from platform_core import hub_direct as direct
from platform_core.hub_runtime import Runtime,AUTO,PUBLIC
from platform_core.model_hub import Hub


class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        root=Path(self.enterContext(tempfile.TemporaryDirectory()))
        (root/"vault").write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ,HARNESS_INTEGRATIONS_KEY_FILE=str(root/"vault")))
        self.hub=Hub(root/"hub.sqlite3")
        # Existing Atlas credential from a release that accepted its registration.
        with self.hub.database() as db:
            db.execute("INSERT INTO hub_keys VALUES('existing-atlas','atlas','atlas',X'00')")
        for p in ("google","atlas"):
            self.hub.save_key(p,p,"fixture-secret-"+p)
        self.runtime=Runtime(self.hub,None)
        self.ids={k["provider"]:k["id"] for k in self.hub.dashboard()["keys"]}
        self.google=self.ids["google"];self.atlas=self.ids["atlas"]
        self.g="gemma-4-31b-it";self.a="dots-studio/dots-3-note-prev-free"
        self.seed(self.google,self.g,3)
        self.seed(self.atlas,self.a,2)

    def seed(self,k,model,power):
        with self.hub.database() as db:
            db.execute("INSERT OR REPLACE INTO hub_health VALUES(?,?,unixepoch(),0,'ok',?)",(k,model,power))

    async def test_public_projection_private_filter_and_ranked_failover(self):
        calls=[]
        async def call(http,s,k,request,timeout):
            calls.append((s["provider"],request))
            if s["provider"]=="google":raise direct.Refused("HTTP 429",120)
            return {"message":{"content":"ok"},"finish_reason":"stop"},{}
        req={"messages":[{"role":"system","content":"private"},{"role":"user","content":"public"}],
             "tools":[{"type":"function"}],"max_tokens":128}
        with patch.object(direct,"call",call):
            await self.runtime.complete("p",PUBLIC,req)
            self.assertEqual([p for p,_ in calls],["google","atlas"])
            self.assertTrue(all(r["messages"]==[req["messages"][-1]] and "tools" not in r for _,r in calls))
            self.assertEqual(self.runtime.summary()["switches"][0]["reason"],"HTTP 429")
            calls.clear()
            await self.runtime.complete("account",AUTO,req)
            self.assertEqual(calls,[("atlas",req)])
        self.assertTrue(next(r for r in self.runtime.status() if r["model"]==self.g)["retry"]>time.time())

    def test_shared_slots_rotation_and_disable(self):
        g2="gemma-4-26b-a4b-it";self.seed(self.google,g2,2)
        self.assertIsNotNone(self.runtime._acquire("1",PUBLIC,set()))
        self.assertIsNotNone(self.runtime._acquire("2",PUBLIC,set()))
        self.assertIsNone(self.runtime._acquire("3",PUBLIC,{(self.atlas,self.a)}))
        self.hub.key_control(self.google,"disable")
        self.hub.save_key("google","google","rotated-fixture-secret")
        self.assertFalse(any(r["enabled"] for r in self.runtime.status() if r["key"]==self.google))

    async def test_nonzero_unknown_and_unusable_do_not_dispatch(self):
        key=None
        with self.hub.database() as db:key=dict(db.execute("SELECT * FROM hub_keys WHERE id=?",(self.atlas,)).fetchone())
        for rates in ({"prompt":0,"completion":0},{"prompt":0,"completion":0,"request":0,"new":0.01}):
            seen=[]
            def sender(req):
                seen.append(req.method)
                return httpx.Response(200,json={"data":[{"id":self.a,"pricing":rates}]})
            async with httpx.AsyncClient(transport=httpx.MockTransport(sender)) as http:
                with self.assertRaises(direct.Refused):
                    await direct.call(http,self.runtime.routes[("atlas",self.a)],key,direct.PROBE,5)
            self.assertEqual(seen,["GET"])

    async def test_zai_pricing_requires_a_unique_free_row_and_expected_columns(self):
        header = "> | Model | Input | Cached Input | Cached Input Storage | Output |"
        row = "> | GLM-4.7-Flash | Free | Free | Free | Free |"
        spec = self.runtime.routes["zai", "glm-4.7-flash"]
        for data, allowed in [(header+"\n"+row, True), (header+"\n"+row.replace("Free","$1",1), False),
                              (header+"\n"+row+"\n"+row, False), (row, False),
                              (header+"\n"+row+"\n"+row.lstrip("> |").replace("Free","$1",1), False),
                              (header+"\n"+row+"\n"+row.replace("GLM-4.7-Flash","**GLM-4.7-Flash**"), False),
                              (header+"\n"+row.replace("Flash","FlashX"), False)]:
            async with httpx.AsyncClient(transport=httpx.MockTransport(
                    lambda req: httpx.Response(200,text=data))) as http:
                if allowed:
                    self.assertEqual(await direct.tariff(http,spec,{}),spec["url"])
                else:
                    with self.assertRaises(direct.Refused):
                        await direct.tariff(http,spec,{})
        with self.assertRaisesRegex(direct.Refused,"платные инструменты"):
            await direct.call(None,spec,{},{"tools":[{"type":"web_search"}]},1)

    def test_unverified_private_route_unavailable_even_if_public_model_is_stronger(self):
        self.hub.key_control(self.atlas,"disable")
        self.assertNotIn(AUTO,self.runtime.catalog())
        self.assertIn(PUBLIC,self.runtime.catalog())
        self.assertIsNone(self.runtime._acquire("private",AUTO,set()))

    async def test_zai_overload_preserves_other_models_but_quota_limit_pauses_account(self):
        model = "glm-4.7-flash"
        alternative = "glm-4.5-flash"
        self.hub.save_key("zai", "test", "fixture-secret-zai")
        self.hub.save_key("zai", "second", "fixture-second-zai")
        with self.hub.database() as db:
            key = db.execute("SELECT id FROM hub_keys WHERE provider='zai' AND label='test'").fetchone()[0]
        self.seed(key, alternative, 2)
        async def tariff(*args):
            return "https://api.z.ai/api/paas/v4"
        for code, reason, usable in [
                ("1305", direct.ZAI_TEMPORARY_OVERLOAD, True), (1305, direct.ZAI_TEMPORARY_OVERLOAD, True),
                ("1302", "HTTP 429", False), ("1308", "HTTP 429", False), (None, "HTTP 429", False)]:
            def sender(req):
                return httpx.Response(429, json={"error": {"code": code}}, headers={"Retry-After": "8"})
            async with httpx.AsyncClient(transport=httpx.MockTransport(sender)) as http:
                runtime = Runtime(self.hub, http)
                with patch.object(direct, "tariff", tariff):
                    await runtime.probe_text(key, model)
            routes = {r["model"]: r for r in runtime.status() if r["key"]==key}
            self.assertEqual(routes[model]["text_reason"], reason)
            self.assertEqual(routes[alternative]["public_ready"], usable)
            self.assertTrue(all(runtime._acquire("", AUTO, set(), (row["key"],model)) is None
                                for row in runtime.status() if row["model"]==model))
            with self.hub.database() as db:
                db.execute("DELETE FROM hub_text_health WHERE key_id=? AND model=?", (key,model))
                db.execute("DELETE FROM hub_cooldown")

    async def test_text_health_admits_public_questions_without_admitting_a_report(self):
        self.hub.key_control(self.atlas,"disable")
        with self.hub.database() as db:
            db.execute("DELETE FROM hub_health")
        async def correct(http,spec,key,request,timeout):
            self.assertNotIn("tools",request)
            return {"message":{"content":"23"},"finish_reason":"stop"},{}
        with patch.object(direct,"call",correct):
            await self.runtime.probe_text(self.google,self.g)
        self.assertIn(PUBLIC,self.runtime.catalog())
        self.assertNotIn(AUTO,self.runtime.catalog())
        self.assertIsNone(self.runtime._acquire("private",AUTO,set()))
