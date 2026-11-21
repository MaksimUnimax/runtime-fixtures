"""Ozon account plugin acceptance. Marketplace HTTP and the model are controlled here."""
import json
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx

from platform_core.marketplace_matrix import coefficient_templates, ozon_coefficients as ozon
from platform_core.user_plugins import registry
import test_wildberries_plugin as wb_fixture


class ProductCatalogue(unittest.IsolatedAsyncioTestCase):
    async def test_all_pages_and_product_source_skus(self):
        async def read(name, request):
            if name == "cards":
                product = 2 if request["last_id"] else 1
                return {"result": {"items": [{"product_id": product}], "total": 2, "last_id": str(product)}}
            product = int(request["product_id"][0])
            return {"items": [{"id": product, "offer_id": str(product), "name": "Товар",
                               "sku": product, "sources": [{"sku": product}, {"sku": product+100}]}]}
        rows = await ozon.products(read)
        self.assertEqual({r[0] for r in rows}, {"1", "2", "101", "102"})

    async def test_partial_or_repeated_catalogue_rejected(self):
        async def incomplete(name, request):
            return {"result":{"items":[{"product_id":1}],"total":2,"last_id":"x"}} if name=="cards" else {"items":[]}
        with self.assertRaises(ozon.DataError):
            await ozon.products(incomplete)
        async def repeated(name, request):
            return (await incomplete(name,request)) if name=="cards" else {"items":[{"id":1,"sku":1,"name":"A","offer_id":"A"}]}
        with self.assertRaises(ozon.DataError):
            await ozon.products(repeated)


class OzonFlow(unittest.TestCase):
    post = wb_fixture.PluginFlow.post
    def setUp(self):
        wb_fixture.PluginFlow.setUp(self)
        self.url = self.base+"/ozon"
        self.cid = self.post("/api/integrations",dict(provider="ozon",name="Ozon 1",
                             fields={"api_key":"test-key","client_id":"123"}))["id"]
        self.calls = []
        def provider(req):
            self.calls.append(req.url.path)
            if req.url.path.endswith("/product/list"):
                return httpx.Response(200,json={"result":{"total":1,"last_id":"","items":[{"product_id":7}]}})
            if req.url.path.endswith("/product/info/list"):
                return httpx.Response(200,json={"items":[{"id":7,"sku":17,"offer_id":"sku-a","name":"Товар"}]})
            if req.url.path=="/v1/messages":
                template=json.loads(req.content)["tools"][0]["input_schema"]["properties"]["templateId"]["enum"][0]
                return httpx.Response(200,json={"content":[{"type":"tool_use","name":"run_matrix_template",
                                                            "input":{"templateId":template}}]})
            self.fail(req.url.path)
        self.client.app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(provider))

    def wait(self, job, sku="", state="done", cid=None):
        for _ in range(200):
            value=self.client.get(self.url,params={"cid":cid or self.cid,"sku":sku},headers=self.headers).json()
            row=next(i for i in value["jobs"] if i["id"]==job)
            if row["state"]!="running":
                self.assertEqual(row["state"],state,row["message"])
                return value
            time.sleep(.02)
        self.fail("Job timed out")

    def test_store_scope_and_performance_guidance(self):
        self.post(self.base,{"plugin":"ozon","enabled":True})
        self.assertFalse(self.client.get(self.base,headers=self.headers).json()["plugins"][0]["enabled"])
        second=self.post("/api/integrations",dict(provider="ozon",name="Реклама",fields={
            "performance_id":"perf","performance_secret":"test"}))["id"]
        self.wait(self.post(self.url+"/store",{"cid":self.cid})["job"])
        collision=self.client.post("/api/integrations",headers=self.headers,json=dict(provider="ozon",name="Ozon 1",
                                 fields={"api_key":"new-key","client_id":"456"}))
        self.assertEqual(collision.status_code,409)
        previous=list(self.calls)
        state=self.wait(self.post(self.url+"/store",{"cid":second})["job"],state="failed",cid=second)
        self.assertEqual(len(state["stores"]),2)
        self.assertIn("Seller API",state["jobs"][0]["message"])
        self.assertEqual(previous,self.calls)
        self.assertEqual(self.client.get(self.url,headers=self.other).status_code,404)
        self.assertEqual(self.client.post(self.url+"/save",headers=self.headers,json={
            "cid":self.cid,"sku":"18","metric":"loss","value":"0","revision":None}).status_code,400)

    def test_model_and_reasoning_are_independent_between_plugins(self):
        self.post(self.base,{"plugin":"wildberries","enabled":True})
        self.post(self.base,{"plugin":"ozon","enabled":True})
        models={"alpha":{"id":"alpha","efforts":["off","high"]},
                "beta":{"id":"beta","efforts":["low","high"]}}
        with patch("platform_core.user_plugins.service.chat_defaults.available_models",return_value=models):
            self.post(self.base+"/wildberries/model",{"model":"alpha","effort":"high"})
            self.post(self.url+"/model",{"model":"beta","effort":"low"})
        def preference(url):
            row=self.client.get(url,headers=self.headers).json()
            return row["model"],row["effort"]
        self.assertEqual(preference(self.url),("beta","low"))
        self.assertEqual(preference(self.base+"/wildberries"),("alpha","high"))
        self.post(self.url+"/model",{"model":"","effort":""})
        self.assertEqual(preference(self.url),("",""))
        self.assertEqual(preference(self.base+"/wildberries"),("alpha","high"))

    def test_migration_existing_chats_and_deliberate_disconnect(self):
        self.post("/api/chats/"+self.scope.chat_id+"/integrations",{"connectionId":self.cid,"enabled":True})
        self.wait(self.post(self.url+"/refresh",{"cid":self.cid})["job"])
        with self.client.app.state.identity._write() as db:
            db.execute("delete from chat_plugins where plugin_id='ozon'")
            db.execute("delete from entitlements where plugin_id='ozon'")
            db.execute("delete from user_plugin_migrations where plugin='ozon'")
            registry.install(db)
            self.assertTrue(registry.attached(db,self.scope,"ozon"))
            db.execute("delete from chat_plugins where plugin_id='ozon'")
            registry.install(db)
            self.assertFalse(registry.attached(db,self.scope,"ozon"))

    def test_catalogue_429_resumes_original_request(self):
        self.post(self.base,{"plugin":"ozon","enabled":True})
        original=self.client.app.state.http.post
        requests=[]
        async def limited(url,**kwargs):
            if url.endswith("/product/list"):
                requests.append(kwargs["json"].copy())
                if len(requests)==1:
                    return httpx.Response(429,headers={"Retry-After":"1"})
            return await original(url,**kwargs)
        with patch.object(self.client.app.state.http,"post",side_effect=limited):
            result=self.wait(self.post(self.url+"/store",{"cid":self.cid})["job"])
        self.assertEqual(result["products"][0]["sku"],"17")
        self.assertEqual(requests,[requests[0]]*2)
        self.assertNotIn("/v1/messages",self.calls)

    def test_annual_job_idempotency_no_overwrite_and_saved_projection(self):
        self.post("/api/chats/"+self.scope.chat_id+"/integrations",{"connectionId":self.cid,"enabled":True})
        self.wait(self.post(self.url+"/refresh",{"cid":self.cid})["job"])
        request=dict(cid=self.cid,sku="",metric="forward",since="2025-11-20",until="2026-11-19",
                     revision=None,requestId=uuid4().hex)
        def execute(packet,unused):
            selection=packet["selections"][0]
            self.assertTrue(packet["turn"]["resumeRateLimits"])
            self.assertEqual(selection["templateId"],"parameter.delivery_mean.v1")
            d=selection["input"]["period"]
            self.assertEqual(d,{"from":request["since"],"to":request["until"]})
            return {"public":{"ok":True},"coefficient":{"parameter":"delivery_mean","unit":"RUB/ordered_unit",
                "sku":"","store":self.cid,"period":d,"value":"15.5","inputs":{"ordered_units":"2",
                "forward_delivery":"30","last_delivery":"1"},"controls":{},"collected_at":"2026-11-21"}}
        with patch("platform_core.marketplace_matrix.plugin.invoke",side_effect=execute) as run:
            job=self.post(self.url+"/calculate",request)["job"]
            store=self.wait(job)
            self.assertEqual(store["values"]["forward"]["value"],"15.5")
            self.assertEqual(self.post(self.url+"/calculate",request)["job"],job)
            self.assertEqual(run.call_count,1)
            self.assertEqual(self.calls.count("/v1/messages"),1)
        base=dict(cid=self.cid,sku="17",metric="loss",value="0",revision=None)
        self.post(self.url+"/save",base)
        self.assertEqual(self.client.post(self.url+"/save",headers=self.headers,json=base).status_code,409)
        self.assertEqual(self.client.post(self.url+"/save",headers=self.headers,json={**base,"value":"101"}).status_code,400)
        with self.client.app.state.identity._lock:
            rows=coefficient_templates.report(self.client.app.state.identity._db,self.scope,{
                "templateId":coefficient_templates.OZON_PROJECT,"connectionId":self.cid,
                "input":{"plugin_inputs":{"sku":"17","quantity":10}}})
        self.assertEqual(rows["forecast"]["Прямая и последняя доставка, ₽"],"155.0")
        self.assertEqual(rows["coefficients"]["loss"]["scope"],"артикул")
        self.assertEqual(rows["coefficients"]["forward"]["scope"],"магазин")
        self.post(self.base,{"plugin":"ozon","enabled":False})
        with self.client.app.state.identity._write() as db:
            registry.install(db)
            self.assertFalse(registry.attached(db,self.scope,"ozon"))
        self.post(self.base,{"plugin":"ozon","enabled":True})
        restored=self.client.get(self.url,params={"cid":self.cid,"sku":"17"},headers=self.headers).json()
        self.assertEqual(restored["values"]["loss"]["value"],"0")
