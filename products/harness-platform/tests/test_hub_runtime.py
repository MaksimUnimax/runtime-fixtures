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

    def test_unverified_private_route_unavailable_even_if_public_model_is_stronger(self):
        self.hub.key_control(self.atlas,"disable")
        self.assertNotIn(AUTO,self.runtime.catalog())
        self.assertIn(PUBLIC,self.runtime.catalog())
        self.assertIsNone(self.runtime._acquire("private",AUTO,set()))
