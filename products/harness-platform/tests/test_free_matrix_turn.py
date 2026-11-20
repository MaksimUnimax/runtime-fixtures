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
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        (root/"vault").write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ, {
            "HARNESS_OPENROUTER_ENABLED":"1","HARNESS_PROVIDER_KEYS_DIR":str(root/"keys"),
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
        def provider(req):
            if req.url.path.endswith("/models/user"):
                return httpx.Response(200,json={"data":[{"id":model,"name":"QA","supported_parameters":["tools"],
                    "architecture":{"output_modalities":["text"]},"pricing":{"prompt":"0","completion":"0"}}]})
            self.assertEqual(req.url.path,"/api/v1/chat/completions")
            body=json.loads(req.content)
            self.assertNotIn("only-fixture-",req.content.decode())
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
                for marker in ("13","29",model,"wb_orders","ozon_orders"):
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
        for _ in range(2):
            result=client.post(f"/api/chats/{chat}/turns",headers=auth,json=turn)
            self.assertEqual(result.status_code,200,result.text)
            self.assertEqual(result.json()["text"],"WB 13, Ozon 29")
        self.assertEqual(len(calls),2)
        wallet=client.get("/api/wallet",headers=auth).json()
        self.assertEqual((wallet["available"],wallet["reserved"]),("0","0"))
        self.assertEqual([(v["coins"],v["pending"]) for v in wallet["charges"]],[("0",False)])
