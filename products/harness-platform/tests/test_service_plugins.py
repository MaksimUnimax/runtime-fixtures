import json
import os
import selectors
import subprocess
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.model_router import BASE

class ServicePlugins(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.db = self.root / "data.db"
        master = self.root / "vault"
        master.write_bytes(os.urandom(32))
        key = self.root / "router"
        key.write_text("fake-provider-fixture")
        self.enterContext(patch.dict(os.environ, {"HARNESS_INTEGRATIONS_KEY_FILE":str(master),
            "HARNESS_OPENROUTER_KEY_FILE":str(key),"HARNESS_OPENROUTER_ENABLED":"1",
            "HARNESS_MODEL_GATEWAY_URL":"http://127.0.0.1:9","HARNESS_OFFLINE_MODEL":"0","HARNESS_RUB_PER_USD":"80"}))
        with RegistrationStore(self.db) as identity:
            for name in ("owner","other"):
                identity.create_account(name,"test-pass")
            identity.grant_coins("owner","50","seed","test grant")
            identity.set_admin("owner",True)
            token=identity.login("owner","test-pass")
            self.headers={"Authorization":"Bearer "+token}
            self.chat=identity.create_user_chat(token).chat_id
            self.other={"Authorization":"Bearer "+identity.login("other","test-pass")}

    def client(self):
        return TestClient(create_app(self.db,self.root/"chats"))

    def test_admin_rotates_independent_provider_keys(self):
        from platform_core import provider_keys
        directory=self.root/"provider-keys"
        with patch.dict(os.environ,{"HARNESS_PROVIDER_KEYS_DIR":str(directory)}), self.client() as client:
            route="/api/admin/provider-keys"
            for provider,key in (("deepseek","sk-direct-test-first"),("openrouter","sk-or-owner-test"),("deepseek","sk-direct-test-second")):
                self.assertEqual(client.post(route+"/"+provider,headers=self.other,json={"key":key}).status_code,403)
                result=client.post(route+"/"+provider,headers=self.headers,json={"key":key})
                self.assertTrue(result.json()[provider]["configured"])
                self.assertNotIn(key,result.text)
            self.assertEqual(provider_keys.read("deepseek"),"sk-direct-test-second")
            self.assertEqual(client.app.state.model_router.headers["Authorization"],"Bearer sk-or-owner-test")
            self.assertEqual((directory/"deepseek").stat().st_mode & 0o777,0o600)
            self.assertEqual(client.get(route,headers=self.other).status_code,403)
            self.assertNotIn("providerMeters",client.get("/api/wallet",headers=self.other).json())

    def test_connections_scope_checks_and_semantics(self):
        with self.client() as client:
            route="/api/integrations"
            self.assertEqual(client.get(route).status_code,401)
            data={"provider":"wordstat","name":"Seller","fields":{"token":"credential-fixture-value"}}
            cid=client.post(route,headers=self.headers,json=data).json()["id"]
            self.assertNotIn("credential-fixture-value",client.get(route,headers=self.headers).text)
            self.assertNotIn(b"credential-fixture-value",self.db.read_bytes())
            self.assertEqual(client.get(route,headers=self.other).json()["connections"],[])
            self.assertEqual(client.post(f"{route}/{cid}/check",headers=self.other).status_code,404)
            def provider(request):
                self.assertEqual(request.headers["Authorization"],"Bearer credential-fixture-value")
                self.assertEqual(request.url.host,"api.wordstat.yandex.net")
                body = [{"id":1,"label":"region"}] if request.url.path.endswith("getRegionsTree") else {"topRequests":[{"phrase":"оберег","count":123}]}
                return httpx.Response(200,json=body)
            client.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(provider))
            self.assertEqual(client.post(f"{route}/{cid}/check",headers=self.headers).json()["status"],"verified")
            self.assertEqual(client.post(f"{route}/{cid}/semantics",headers=self.headers,json={"phrase":"оберег"}).json()["rows"][0]["count"],123)
            self.assertEqual(client.post("/api/chats/"+self.chat+"/turns",headers=self.headers,
                json={"text":"token: credential-fixture-value","requestId":"secret"}).status_code,400)
            self.assertEqual(client.post(route,headers=self.headers,json=data).json()["id"],cid)
            self.assertEqual(len(client.get(route,headers=self.headers).json()["connections"]),1)

    @unittest.skipUnless(os.getenv("HARNESS_NODE_MODULES"),"requires native Harness")
    def test_real_harness_model_route_billing_replay_and_disable(self):
        seen=[]
        def provider(req):
            if str(req.url)==BASE+"/models":
                return httpx.Response(200,json={"data":[{"id":"maker/demo","name":"Demo","architecture":{"output_modalities":["text"]},
                    "supported_parameters":["tools"],"pricing":{"prompt":"0.000001","completion":"0.000003"}}]})
            self.assertEqual(str(req.url),BASE+"/chat/completions")
            self.assertEqual(req.headers["Authorization"],"Bearer fake-provider-fixture")
            body=json.loads(req.content)
            self.assertEqual(body["model"],"maker/demo")
            seen.append(body)
            return httpx.Response(200,json={"id":"gen-test","choices":[{"message":{"role":"assistant","content":"Ответ маршрутизатора"},
                "finish_reason":"stop"}],"usage":{"cost":0.00001,"prompt_tokens":6,"completion_tokens":2,
                "prompt_tokens_details":{"cached_tokens":2}}})
        with self.client() as client:
            router=client.app.state.model_router
            router.http=httpx.AsyncClient(transport=httpx.MockTransport(provider))
            settings="/api/model-settings"
            self.assertEqual(client.post(settings,headers=self.headers,json={"model":"maker/demo"}).json()["model"],"maker/demo")
            self.assertEqual(client.get(settings,headers=self.other).json()["model"],"direct")
            route="/api/chats/"+self.chat+"/turns"
            data={"requestId":"router-roundtrip","text":"Привет"}
            response=client.post(route,headers=self.headers,json=data)
            self.assertEqual(response.status_code,200,response.text)
            result=response.json()
            self.assertEqual(result["text"],"Ответ маршрутизатора")
            self.assertEqual(result["modelUsage"],{"providers":{"OpenRouter":{"input":4,"cache":2,"output":2}},"tokens":{"input":4,"cache":2,"output":2},"rub":"0.0008","coins":"0.0008","pending":False})
            self.assertEqual(client.post(route,headers=self.headers,json=data).json(),result)
            self.assertEqual(len(seen),1)
        gateway=subprocess.Popen(["node",str(Path(__file__).parent/"metered-chat-gateway.mjs"),str(self.db),
                str(self.root/"direct.jsonl")],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
        def close_gateway():
            gateway.stdin.close()
            try:
                gateway.wait(timeout=5)
            except subprocess.TimeoutExpired:
                gateway.kill()
                gateway.wait()
            gateway.stdout.close()
        self.addCleanup(close_gateway)
        with selectors.DefaultSelector() as ready:
            ready.register(gateway.stdout,selectors.EVENT_READ)
            self.assertTrue(ready.select(8))
        direct=gateway.stdout.readline().strip()
        self.assertTrue(direct.startswith("http://127.0.0.1:"))
        with patch.dict(os.environ,{"HARNESS_OPENROUTER_ENABLED":"0","HARNESS_MODEL_GATEWAY_URL":direct}), self.client() as client:
            self.assertIsNone(client.app.state.worker.router)
            self.assertFalse(client.get(settings,headers=self.headers).json()["enabled"])
            self.assertEqual(client.get("/api/chats/"+self.chat+"/messages",headers=self.headers).json()[-1]["modelUsage"],result["modelUsage"])
            self.assertEqual(client.get("/api/wallet",headers=self.headers).json()["available"],"49.9992")
            direct_reply=client.post(route,headers=self.headers,json={"requestId":"direct-after-disable","text":"direct again"})
            self.assertEqual(direct_reply.status_code,200,direct_reply.text)
            self.assertEqual(direct_reply.json()["text"],"answer to direct again")
            self.assertEqual(direct_reply.json()["modelUsage"]["coins"],"0.00072")
            self.assertEqual(len(seen),1)
