import asyncio
from datetime import date
from decimal import Decimal
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from starlette.testclient import TestClient
from starlette.exceptions import HTTPException

from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.marketplace_matrix import coefficient_templates as templates, plugin as matrix, wb_coefficients as wb
from platform_core.operation_grants import issue_grant, revoke_grant


class CoefficientTests(unittest.IsolatedAsyncioTestCase):
    async def test_order_and_logistics_units_and_pagination(self):
        period=date(2026,10,1)
        details=[
            dict(rrdId=1,rrDate="2026-10-01",nmId=10,currency="RUB",bonusTypeName="К клиенту при продаже",deliveryService="10"),
            dict(rrdId=2,rrDate="2026-10-01",nmId=10,currency="RUB",bonusTypeName="От клиента при отмене",deliveryService="36",returnAmount=2),
            dict(rrdId=3,rrDate="2026-10-01",nmId=12,currency="RUB",bonusTypeName="К клиенту при отмене",deliveryService="80")]
        async def read(key,payload):
            if key=="orders":
                return {"data":{"products":[{"product":{"nmId":10},"statistic":{"selected":{
                    "period":payload["selectedPeriod"],"orderCount":10,"cancelCount":3}}}]}}
            self.assertIn(payload["rrdId"],(0,3))
            return details if not payload["rrdId"] else []
        for key,expected in [("loss",30),("forward",1),("reverse",18)]:
            result,_=await wb.calculate(read,key,period,period,"10")
            self.assertEqual(Decimal(result),expected)
        with self.assertRaises(wb.DataError):
            await wb.calculate(read,"reverse",period,period,"12")

    def test_commission_signed_corrections_and_tariff_dates(self):
        def row(op,p,forpay,acq):
            return dict(sellerOperName=op,docTypeName=op,srid="a",deliveryMethod="FBS",officeName="Склад поставщика",
                        subjectName="Обереги",orderDt="2026-10-01",retailPriceWithDisc=p,forPay=forpay,acquiringFee=acq)
        rows=[row("Продажа",100,60,2),row("Возврат",50,30,1),row("Коррекция продаж",0,1,0)]
        a,b,_=wb.offset(rows)
        self.assertEqual(a/b,Decimal(3))
        rows[0]["orderDt"]="2020-01-01"
        with self.assertRaises(wb.DataError):
            wb.offset(rows)

    async def test_catalogue_reads_last_page(self):
        pages=[]
        async def read(_,payload):
            cursor=payload["settings"]["cursor"];pages.append(cursor)
            start=cursor.get("nmID",0)
            cards=[dict(nmID=i,vendorCode=str(i),title="Товар") for i in range(start+1,101 if not start else 102)]
            return {"cards":cards,"cursor":{"total":len(cards),"nmID":cards[-1]["nmID"],"updatedAt":"t"}}
        self.assertEqual(len(await wb.products(read)),101)
        self.assertEqual(pages[1]["nmID"],100)


class PluginFlow(unittest.TestCase):
    def setUp(self):
        self.root=Path(self.enterContext(tempfile.TemporaryDirectory()))
        key=self.root/"key";key.write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ,{"HARNESS_INTEGRATIONS_KEY_FILE":str(key),"HARNESS_MODEL_GATEWAY_URL":"http://127.0.0.1:9","HARNESS_OFFLINE_MODEL":"0"}))
        self.db=self.root/"test.sqlite"
        with RegistrationStore(self.db) as identity:
            identity.create_account("owner","test-password")
            identity.create_account("other","test-password")
            identity.grant_coins("owner","25","test","fixture")
            self.token=identity.login("owner","test-password")
            self.scope=identity.create_user_chat(self.token)
            self.other_scope=identity.create_user_chat(self.token)
            self.other={"Authorization":"Bearer "+identity.login("other","test-password")}
        self.client=self.enterContext(TestClient(create_app(self.db,self.root/"journals")))
        self.headers={"Authorization":"Bearer "+self.token}
        self.base="/api/chats/"+self.scope.chat_id+"/plugins"
        self.url=self.base+"/wildberries"
        self.cid=self.post("/api/integrations",dict(provider="wb",name="Первый",fields={"token":"fixture"}))["id"]
        self.calls=[]
        def provider(req):
            self.calls.append(req.url.path)
            if req.url.path.endswith("/cards/list"):
                return httpx.Response(200,json={"cards":[{"nmID":12,"vendorCode":"BLUE","title":"Синий"}],"cursor":{"total":1}})
            if req.url.path=="/v1/messages":
                self.assertTrue(req.headers["x-api-key"])
                return httpx.Response(200,json={"content":[{"type":"tool_use","name":"run_matrix_template","input":{"templateId":"wb.coefficient.loss"}}]})
            data=json.loads(req.content)
            return httpx.Response(200,json={"data":{"products":[{"product":{"nmId":12},"statistic":{
                "selected":{"period":data["selectedPeriod"],"orderCount":20,"cancelCount":2}}}]}})
        self.client.app.state.http=httpx.AsyncClient(transport=httpx.MockTransport(provider))

    def post(self,url,data):
        response=self.client.post(url,headers=self.headers,json=data)
        response.raise_for_status()
        return response.json()

    def wait(self,job):
        for _ in range(100):
            data=self.client.get(self.url,params={"cid":self.cid},headers=self.headers).json()
            item=next(j for j in data["jobs"] if j["id"]==job)
            if item["state"]!="running":
                self.assertEqual(item["state"],"done",item["message"])
                return data
            time.sleep(.02)
        self.fail("operation timed out")

    def test_backoff_resumes_and_does_not_replay_a_paid_request(self):
        self.post(self.base,{"plugin":"wildberries","enabled":True})
        self.wait(self.post(self.url+"/store",{"cid":self.cid})["job"])
        original=self.client.app.state.http.post
        reads=0
        async def rate_limited(url,**kwargs):
            nonlocal reads
            if "sales-funnel" in url:
                reads+=1
                if reads==1:
                    return httpx.Response(429,headers={"Retry-After":"1"})
            return await original(url,**kwargs)
        options=dict(cid=self.cid,sku="",metric="loss",since="2026-10-01",until="2026-10-01",revision=None,requestId=uuid4().hex)
        with patch.object(self.client.app.state.http,"post",side_effect=rate_limited):
            job=self.post(self.url+"/calculate",options)["job"]
            result=self.wait(job)
            self.assertEqual(result["values"]["loss"]["value"],"10")
            self.assertEqual(self.post(self.url+"/calculate",options)["job"],job)
        self.assertEqual(reads,2)
        self.assertEqual(self.calls.count("/v1/messages"),1)

    def test_ordinary_connection_opt_in_matrix_scope_and_calculation(self):
        self.assertFalse(self.client.get(self.base,headers=self.headers).json()["plugins"][0]["enabled"])
        self.post("/api/chats/"+self.scope.chat_id+"/integrations",dict(connectionId=self.cid,enabled=True))
        self.assertTrue(self.client.get(self.base,headers=self.headers).json()["plugins"][0]["enabled"])
        self.assertEqual(self.client.get(self.base,headers=self.other).status_code,404)
        data=self.wait(self.post(self.url+"/refresh",{"cid":self.cid})["job"])
        self.assertEqual(data["products"][0]["sku"],"12")
        self.wait(self.post(self.url+"/calculate",dict(cid=self.cid,sku="",metric="loss",revision=None,since="2026-10-01",until="2026-10-01"))["job"])
        self.assertIn("/v1/messages",self.calls)
        def save(sku,metric,value):
            self.post(self.url+"/save",dict(cid=self.cid,sku=sku,metric=metric,value=value,revision=None))
        save("12","loss","0");save("","forward","12.5");save("","reverse","36");save("","commission","3.2")
        stale=self.client.post(self.url+"/save",headers=self.headers,json=dict(cid=self.cid,sku="12",metric="loss",value="1",revision=None))
        self.assertEqual(stale.status_code,409)
        item=dict(templateId=templates.PROJECT,connectionId=self.cid,input={"plugin_inputs":{"sku":"12","quantity":10,"sellerPrice":100,"officialRate":30}})
        grant=issue_grant(self.db,self.scope,source="chat.turn",run_key="plugin-fixture",direct_fallback="test")
        try:
            turn={"token":grant.token,"databasePath":str(self.db),"requestId":"plugin-fixture","deadline":int(time.time()*1000)+30000}
            with patch.dict(os.environ,{"HARNESS_MATRIX_TURN":json.dumps(turn)}):
                schema=matrix.capability([{"id":self.cid,"provider":"wb","access":["Wildberries API"]},
                                          {"id":"o","provider":"ozon","access":["Ozon Seller"]}])
                schema.validate({"selections":[item]})
                lookup={"templateId":templates.SAVED,"connectionId":self.cid}
                schema.validate({"selections":[lookup]})
                self.assertEqual(schema.handler(self.scope,{"selections":[lookup]})["reports"][0]["coefficients"]["forward"]["value"],"12.5")
                schema.validate({"selections":[{"templateId":templates.OZON_SAVED,"connectionId":"o"}]})
                with self.assertRaises(ValueError):
                    schema.validate({"selections":[{"templateId":templates.PROJECT,"connectionId":self.cid}]})
                with self.assertRaises(ValueError):
                    schema.validate({"selections":[{**item,"connectionId":"o"}]})
                result=schema.handler(self.scope,{"selections":[item]})["reports"][0]
                self.assertEqual(result["coefficients"]["loss"]["scope"],"артикул")
                self.assertEqual(result["coefficients"]["forward"]["scope"],"магазин")
                self.assertEqual(Decimal(result["forecast"]["Комиссия после потерь, ₽"]),332)
                with self.assertRaises(PermissionError):
                    schema.handler(self.other_scope,{"selections":[item]})
                self.post(self.base,{"plugin":"wildberries","enabled":False})
                self.assertEqual(self.client.get(self.url,headers=self.headers).status_code,403)
                with self.assertRaises(HTTPException):
                    schema.handler(self.scope,{"selections":[item]})
                self.post(self.base,{"plugin":"wildberries","enabled":True})
                stored=self.client.get(self.url,params={"cid":self.cid,"sku":"12"},headers=self.headers).json()
                self.assertTrue(stored["stores"][0]["selected"])
                self.assertEqual(stored["values"]["loss"]["value"],"0")
        finally:
            revoke_grant(self.db,grant.token)
