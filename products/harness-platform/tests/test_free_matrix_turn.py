"""Zero-coin seller -> native tool loop -> matrix -> WB/Ozon HTTP -> same free model."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.provider_keys import save


@unittest.skipUnless(os.getenv("HARNESS_NODE_MODULES"), "requires pinned native Harness")
class FreeMatrixTurn(unittest.TestCase):
    def test_both_marketplaces_one_free_route_and_replay(self):
        self.matrix_run()

    def test_direct_hub_fails_over_only_on_final_stage(self):
        self.matrix_run(direct=True)

    def test_direct_hub_resumes_after_all_providers_fail(self):
        self.matrix_run(direct=True,outage=True)

    def matrix_run(self,direct=False,outage=False):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (root/"vault").write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ, {
            "HARNESS_OPENROUTER_ENABLED":"0" if direct else "1","HARNESS_HUB_INFERENCE":"1" if direct else "0","HARNESS_PROVIDER_KEYS_DIR":str(root/"keys"),
            "HARNESS_INTEGRATIONS_KEY_FILE":str(root/"vault"),
            "HARNESS_MODEL_GATEWAY_URL":"http://127.0.0.1:9","HARNESS_OFFLINE_MODEL":"0"}))
        save(root/"keys","openrouter","fixture-model-key")
        db=root/"identity.sqlite3"
        with RegistrationStore(db) as identity:
            identity.create_account("matrix-free-qa","fixture-pass")
            auth={"Authorization":"Bearer "+identity.login("matrix-free-qa","fixture-pass")}
        app=create_app(db,root/"chats",composition_module="tests.fixtures.marketplace_http_fixture")
        client=self.enterContext(TestClient(app))
        chat=client.post("/api/chats",headers=auth).json()["chatId"]
        ids=[]
        for provider,fields in [("ozon",{"api_key":"only-fixture-ozon","client_id":"fixture-id"}),
                                ("wb",{"token":"only-fixture-wb"})]:
            added=client.post("/api/integrations",headers=auth,json={"provider":provider,"name":provider,
                              "fields":fields,"chatId":chat})
            added.raise_for_status()
            ids.append(added.json()["id"])
        model="qa/tool-model:free"
        calls=[]
        if direct:
            runtime=app.state.model_router.hub
            model="hub:auto"
            from platform_core import hub_direct
            for provider_name in ("google","atlas"):
                app.state.model_hub.save_key(provider_name,provider_name,"fixture-direct-"+provider_name)
            def healthy():
                with app.state.model_hub.database() as hdb:
                    for k in hdb.execute("SELECT id,provider FROM hub_keys"):
                        mid="gemma-4-26b-a4b-it" if k["provider"]=="google" else "dots-studio/dots-3-note-prev-free"
                        hdb.execute("INSERT OR REPLACE INTO hub_control VALUES(?,1,unixepoch()+600)",(k["id"],))
                        hdb.execute("INSERT OR REPLACE INTO hub_health VALUES(?,?,unixepoch(),0,'ok',?)",(k["id"],mid,3 if k["provider"]=="google" else 2))
            healthy()
            attempts=[]
            async def generate(http,spec,key,req,timeout):
                stage="final" if req["messages"][-1]["role"]=="tool" else "select"
                attempts.append((stage,spec["provider"]))
                if stage=="final" and (spec["provider"]=="google" or (outage and len(attempts)==3)):
                    raise hub_direct.Refused("HTTP 503")
                body={**req,"model":spec["model"]}
                mocked=provider(httpx.Request("POST","https://fixture.invalid/api/v1/chat/completions",json=body)).json()
                return mocked["choices"][0],mocked["usage"]
            self.enterContext(patch.object(hub_direct,"call",generate))
        def provider(req):
            if req.url.path.endswith("/models/user"):
                return httpx.Response(200,json={"data":[{"id":model,"name":"QA","supported_parameters":["tools"],
                    "architecture":{"output_modalities":["text"]},"pricing":{"prompt":"0","completion":"0"}}]})
            self.assertEqual(req.url.path,"/api/v1/chat/completions")
            body=json.loads(req.content)
            self.assertNotIn("only-fixture-",req.content.decode())
            if not direct:
                self.assertEqual(body["model"],model)
                self.assertEqual(body["provider"]["max_price"],{"prompt":0,"completion":0,"request":0})
            calls.append(body)
            if len(calls)==1:
                name=next(t["function"]["name"] for t in body["tools"] if t["function"]["name"].endswith("marketplace_report"))
                args={"selections":[{"templateId":"B01.ordered_units","connectionId":cid,
                       "input":{"period":{"from":"2026-11-19","to":"2026-11-19"}}} for cid in ids]}
                message={"role":"assistant","content":"","tool_calls":[{"id":"orders","type":"function",
                         "function":{"name":name,"arguments":json.dumps(args)}}]}
                finish="tool_calls"
            else:
                self.assertEqual(len(calls),2)
                result=next(m for m in body["messages"] if m["role"]=="tool")
                self.assertEqual(result["tool_call_id"],"orders")
                for marker in ("13","29","gemma-4-26b-a4b-it" if direct else model,"wb_orders","ozon_orders"):
                    self.assertIn(marker,result["content"])
                message={"role":"assistant","content":"WB 13, Ozon 29"}
                finish="stop"
            return httpx.Response(200,json={"id":"qa-gen-"+str(len(calls)),
                "usage":{"cost":0,"prompt_tokens":125,"completion_tokens":12},
                "choices":[{"finish_reason":finish,"message":message}]})
        http=httpx.AsyncClient(transport=httpx.MockTransport(provider))
        self.addCleanup(client.portal.call,http.aclose)
        app.state.model_router.http=http
        chosen=client.post("/api/model-settings",headers=auth,json={"model":model})
        self.assertEqual(chosen.json()["model"],model)
        turn={"text":"Сколько заказано на WB и Ozon за 19 ноября?","requestId":"matrix-free-report"}
        if outage:
            failed=client.post(f"/api/chats/{chat}/turns",headers=auth,json=turn)
            self.assertEqual(failed.status_code,503,failed.text)
            healthy()
        for _ in range(2):
            result=client.post(f"/api/chats/{chat}/turns",headers=auth,json=turn)
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()["text"],"WB 13, Ozon 29")
        self.assertEqual(len(calls),2)
        if direct:
            self.assertEqual([stage for stage,p in attempts].count("select"),1)
            self.assertEqual(attempts[-1],("final","atlas"))
            self.assertEqual(len(runtime.summary()["switches"]),1)
        wallet=client.get("/api/wallet",headers=auth).json()
        self.assertEqual((wallet["available"],wallet["reserved"]),("0","0"))
        self.assertEqual([(v["coins"],v["pending"]) for v in wallet["charges"]],[("0",False)])

    def test_public_chat_sends_only_the_literal_question(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (root/"vault").write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ, {
            "HARNESS_HUB_INFERENCE":"1","HARNESS_OPENROUTER_ENABLED":"0",
            "HARNESS_INTEGRATIONS_KEY_FILE":str(root/"vault"),"HARNESS_MODEL_HUB_DATABASE":str(root/"hub.db"),
            "HARNESS_MODEL_GATEWAY_URL":"http://127.0.0.1:9","HARNESS_OFFLINE_MODEL":"0"}))
        db=root/"identity.sqlite3"
        with RegistrationStore(db) as identity:
            identity.create_account("public-qa","fixture-pass")
            auth={"Authorization":"Bearer "+identity.login("public-qa","fixture-pass")}
        app=create_app(db,root/"chats")
        client=self.enterContext(TestClient(app))
        chat=client.post("/api/chats",headers=auth).json()["chatId"]
        hub=app.state.model_hub
        hub.save_key("google","fixture","fixture-google-key")
        with hub.database() as hdb:
            hdb.execute("INSERT INTO hub_text_health SELECT id,'gemma-4-26b-a4b-it',unixepoch(),0,'ok' FROM hub_keys")
        client.post("/api/model-settings",headers=auth,json={"model":"hub:public"}).raise_for_status()
        question="Сколько будет 17 плюс 6?"
        bodies=[]
        async def answer(http,spec,key,request,timeout):
            bodies.append(request)
            if len(bodies)==1:
                raise hub_direct.Refused("HTTP 503",1)
            return {"message":{"role":"assistant","content":"23"},"finish_reason":"stop"},{}
        from platform_core import hub_direct
        with patch.object(hub_direct,"call",answer):
            failed=client.post(f"/api/chats/{chat}/turns",headers=auth,json={"text":question,"requestId":"q"})
            self.assertEqual(failed.status_code,503)
            self.assertTrue(failed.json()["resume"])
            with hub.database() as hdb:
                hdb.execute("UPDATE hub_text_health SET reason='ok',retry=0,checked=unixepoch()")
            turn=client.post(f"/api/chats/{chat}/turns",headers=auth,json={"text":question,"requestId":"q"})
        self.assertEqual(turn.status_code,200,turn.text)
        self.assertEqual(turn.json()["text"],"23")
        self.assertEqual(bodies,[{"messages":[{"role":"user","content":question}],"max_tokens":4096}]*2)
