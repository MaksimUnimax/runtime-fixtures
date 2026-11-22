"""Real HTTP, billed grant issuance, native chat journal and restart; substitute network providers only."""
import copy
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import httpx
from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.telegram_api import DeliveryError
from platform_core.user_plugins.timer import jobs, recipe


RULE={"kind":"interval","zone":"Asia/Qyzylorda","every_us":3_600_000_000}
REPORT={"kind":"report","schedule":RULE,"plan":{"steps":[{"tool":"clock","args":{}}],
        "format":"Местная дата","telegram":False,"notify":"all"}}


@unittest.skipUnless(os.getenv("HARNESS_NODE_MODULES"),"requires the native Harness installation")
class TimerJourney(unittest.TestCase):
    def setUp(self):
        self.path=Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.enterContext(patch.dict(os.environ,{"HARNESS_MODEL_GATEWAY_URL":"http://127.0.0.1:9",
            "HARNESS_OFFLINE_MODEL":"0","HARNESS_OPENROUTER_ENABLED":"0"}))
        self.create_app()
        identity=self.state.identity
        identity.create_account("timer-customer","temporary-password")
        identity.grant_coins("timer-customer","60","timer-seed","test balance")
        self.token=identity.login("timer-customer","temporary-password")
        self.scope=identity.create_user_chat(self.token)
        self.route="/api/chats/"+self.scope.chat_id
        self.headers={"Authorization":"Bearer "+self.token}
        self.choice=copy.deepcopy(REPORT)
        self.plans=0
        self.renders=0
        self.runtime_fixture()
        self.addCleanup(lambda:self.client.__exit__(None,None,None))

    def create_app(self):
        self.client=TestClient(create_app(self.path/"account.db",self.path/"chats"))
        self.client.__enter__()
        self.state=self.client.app.state

    def runtime_fixture(self):
        def gateway(req):
            data=json.loads(req.content)
            if data.get("tools"):
                self.plans+=1
                blocks=[{"type":"tool_use","id":"call","name":"timer_plan","input":self.choice}]
            else:
                self.renders+=1
                facts=json.loads(data["messages"][0]["content"].split("\n",1)[1])["facts"]
                blocks=[{"type":"text","text":"По данным источника: "+json.dumps(facts,ensure_ascii=False)}]
            return httpx.Response(200,json={"content":blocks})
        self.state.http=httpx.AsyncClient(transport=httpx.MockTransport(gateway))

    def enable(self):
        for url,body in (("/api/plugins",{"installed":True}),(self.route+"/plugins",{"enabled":True})):
            self.client.post(url,headers=self.headers,json={"plugin":"timer",**body}).raise_for_status()

    def turn(self,text,hint=None,rid=None):
        data={"requestId":rid or uuid4().hex,"text":text,"timeZone":"Asia/Qyzylorda"}
        if hint is not None:
            data["timer"]=hint
        r=self.client.post(self.route+"/turns",json=data,headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)
        return r.json()["text"]

    def events(self):
        return self.client.get(self.route+"/plugins/timer",headers=self.headers).json()["events"]

    def history(self):
        return self.client.get(self.route+"/messages",headers=self.headers).json()

    def due(self,eid):
        with self.state.identity._write() as db:
            db.execute("UPDATE timer_events SET next_us=? WHERE id=?",(jobs.now_us()-1,eid))

    def until(self,fn):
        end=time.monotonic()+15
        while time.monotonic()<end:
            value=fn()
            if value:
                return value
            time.sleep(.08)
        self.fail("Timed out waiting for timer worker")

    def test_chat_only_install_refine_confirm_run_and_restart(self):
        self.assertIn("Установите",self.turn("Каждый час присылай мне местную дату"))
        self.enable()
        self.assertIn("Вас устраивает",self.turn("Готово"))
        self.assertEqual(self.events(),[])
        self.assertIn("Вас устраивает",self.turn("Да, но добавь время"))
        self.assertEqual(self.events(),[])
        rid=uuid4().hex
        accepted=self.turn("Да",rid=rid)
        self.assertIn("Таймер сохранён",accepted)
        self.assertEqual(self.turn("Да",rid=rid),accepted)
        event,=self.events()
        self.client.__exit__(None,None,None)
        self.create_app()
        self.runtime_fixture()
        self.due(event["id"])
        self.until(lambda:any(m["requestId"].startswith("timer.") for m in self.history()))
        messages=[m for m in self.history() if m["requestId"].startswith("timer.")]
        self.assertEqual([m["role"] for m in messages],["assistant"])
        self.assertIn("localTime",messages[0]["text"])
        self.assertEqual((self.plans,self.renders),(2,3))

    def test_conditional_create_once_and_retry_only_telegram(self):
        self.enable()
        self.choice={"kind":"action","schedule":RULE,"plan":{"steps":[{"tool":"marketplace_read","args":
            {"action":"read","connectionId":"fixture","templateId":"fixture.stock","params":{}}}],
            "action":{"when":{"path":[0,"warehouses"],"op":"nonempty"},"mode":"once","templateId":"fixture.supply",
            "connectionId":"fixture","params":{"name":"Тестовая поставка"},"command":"Создать одну поставку"},
            "format":"Склад и номер поставки","telegram":True,"notify":"changes"}}
        writes=[]
        sends=[]
        async def vendor(scope,grant,key,question,op,tool=None,args=None,run=None):
            if op=="write":
                with self.state.identity._write() as db:
                    jobs.verify_write(db,scope,run,args)
                writes.append(args)
                return {"ok":True,"state":"accepted","result":"Создана тестовая поставка №17."}
            return {"warehouses":["Москва"]}
        async def delivery(ws,text):
            sends.append(text)
            if len(sends)==1:
                raise DeliveryError("limited",1)
        rt=self.state.timers.runtime
        with patch.object(rt,"source",vendor),patch.object(rt,"verify_action",return_value=None),patch.object(
                self.state.telegram,"status",return_value={"linked":True}),patch.object(self.state.telegram,"send",delivery):
            self.assertIn("Предпросмотр",self.turn("Каждый час проверить склад и создать одну поставку",{"kind":"action"}))
            self.assertEqual((writes,sends),([],[]))
            self.turn("Да")
            event,=self.events()
            self.due(event["id"])
            self.until(lambda:len(sends)==2)
            self.assertEqual(len(writes),1)
            self.assertIn("№17",sends[0])
            self.assertEqual(sends[0],sends[1])
            self.assertEqual(self.events()[0]["status"],"completed")
            self.assertEqual(len([m for m in self.history() if m["requestId"].startswith("timer.")]),1)


class Boundaries(unittest.TestCase):
    def test_one_step_and_directions(self):
        a={"when":{"path":[0,"spend"],"op":"gt","value":2000},"params":{"sku":42},
           "adjust":{"current":[0,"bid"],"by":-1,"min":3,"max":5,"field":"bid","encoding":"integer"}}
        check=lambda spend,bid:recipe.decision(a,[{"spend":spend,"bid":bid}])[1]
        self.assertIsNone(check(2000,5))
        self.assertEqual(check(2001,5),{"sku":42,"bid":4})
        self.assertEqual(check(2001,4),{"sku":42,"bid":3})
        self.assertIsNone(check(2001,3.5))
        a["adjust"]["by"]=1
        self.assertEqual(check(2001,4),{"sku":42,"bid":5})
        self.assertIsNone(check(2001,5))
