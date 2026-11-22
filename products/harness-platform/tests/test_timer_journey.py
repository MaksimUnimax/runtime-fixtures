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
        keyfile=self.path/"fixture-vault"
        keyfile.write_bytes(os.urandom(32))
        self.enterContext(patch.dict(os.environ,{"HARNESS_INTEGRATIONS_KEY_FILE":str(keyfile)}))
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
        self.choice["plan"]["notify"]="goal"  # Regular reports must reach their chat every time.
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

    def test_real_registered_template_is_replayed_with_fresh_store_data(self):
        from platform_core.chat_connections import attach
        from platform_core.user_plugins.registry import WB
        from platform_core.user_plugins.store import write_value
        self.enable()
        created=self.client.post("/api/integrations",json={"provider":"wb","name":"QA склад",
            "fields":{"token":"isolated-fixture-token"}},headers=self.headers)
        created.raise_for_status()
        cid=created.json()["id"]
        args={"selections":[{"templateId":"wb.saved_coefficients","connectionId":cid}]}
        self.choice["plan"]["steps"]=[{"tool":"marketplace_report","args":args}]
        with self.state.identity._write() as db:
            attach(db,self.scope,cid,True)
            write_value(db,cid,"","loss","12","manual",None,None,None,None,plugin=WB)
        preview=self.turn("Каждый час покажи коэффициенты магазина")
        self.assertIn("wb.saved_coefficients",preview)
        self.assertIn('"value": "12"',preview)
        self.turn("Да")
        event,=self.events()
        with self.state.identity._write() as db:
            db.execute("UPDATE user_plugin_values SET value='16' WHERE cid=? AND metric='loss'",(cid,))
        self.due(event["id"])
        def actual():
            return next((m["text"] for m in self.history() if m["requestId"].startswith("timer.")),None)
        self.assertIn('"value": "16"',self.until(actual))

    def test_wb_supply_through_registered_matrix_with_fixture_provider(self):
        import sys
        from platform_core.chat_connections import attach
        from platform_core.marketplace_matrix import action_templates, plugin, read_templates, worker
        from platform_core.user_plugins.timer import authorization, source
        template="action.wb.post_api_v3_supplies"
        if template not in getattr(action_templates,"EDITS",{}):
            self.skipTest("This build has no executable WB FBS supply adapter")
        self.enable()
        cid=self.client.post("/api/integrations",json={"provider":"wb","name":"Fixture WB",
            "fields":{"token":"isolated-fixture-token"}},headers=self.headers).json()["id"]
        with self.state.identity._write() as db:
            attach(db,self.scope,cid,True)
        self.choice["kind"]="action"
        self.choice["plan"]["action"]={"when":{"path":[0,"localTime"],"op":"nonempty"},
            "mode":"once","templateId":template,"connectionId":cid,"params":{"name":"Тест таймера"},
            "command":"Создай поставку FBS с названием Тест таймера"}
        runtime=self.state.timers.runtime
        original_source,original_invoke=runtime.source,plugin.invoke
        calls=[]
        def provider(authority,connection,card,route,**kwargs):
            self.assertEqual(card["id"],template)
            calls.append((route[0],json.loads(route[2])))
            return {"id":"WB-GI-17001"},{"status":201,"elapsed_ms":1}
        def matrix(packet, timeout):
            if packet.get("readTemplate",{}).get("action")!="edit":
                return original_invoke(packet,timeout)
            with authorization.matrix_request(packet):
                return read_templates.execute(packet,self.path)
        async def scoped_source(scope,grant,key,question,op,tool=None,args=None,run=None):
            if op!="write":
                return await original_source(scope,grant,key,question,op,tool,args,run)
            turn={"question":question,"requestId":key,"token":grant.token,"deadline":int(time.time()*1000)+60000,
                  "databasePath":str(self.state.worker.database_path)}
            with patch.dict(os.environ),patch.object(plugin,"invoke",matrix),patch.object(read_templates,"supplemental_send",provider):
                return source.call({"scope":[scope.actor_id,scope.workspace_id,scope.chat_id],
                    "op":op,"args":args,"tool":tool,"run":run,"turn":turn})
        with patch.object(sys,"path",list(sys.path)),patch.object(runtime,"source",scoped_source):
            worker.unpack(self.path/"compiler")
            self.assertIn("Предпросмотр",self.turn("Каждый час проверь время и создай одну поставку с названием Тест таймера",{"kind":"action"}))
            self.assertEqual(calls,[])
            self.assertIn("Таймер сохранён",self.turn("Да"))
            event,=self.events()
            self.due(event["id"])
            def finished():
                rows=self.client.get(self.route+"/plugins/timer/events/"+event["id"]+"/history",headers=self.headers).json()["runs"]
                return rows and rows[0]["message"]
            result=self.until(finished)
            self.assertIn("WB-GI-17001",result)
            self.assertEqual(calls,[("POST",{"name":"Тест таймера"})])
            self.assertEqual(self.events()[0]["status"],"completed")

    def test_single_use_authorization_and_recovery(self):
        from platform_core.chat_connections import attach
        from platform_core.operation_grants import issue_grant, revoke_grant
        from platform_core.user_plugins.registry import requires_edit_confirmation
        from platform_core.user_plugins.timer import authorization, store
        self.enable()
        cid=self.client.post("/api/integrations",json={"provider":"wb","name":"QA",
            "fields":{"token":"isolated-fixture-token"}},headers=self.headers).json()["id"]
        owner=self.scope
        run=uuid4().hex
        rid="timer.run."+run
        args={"connectionId":cid,"action":"edit","templateId":"fixture.supply","params":{"name":"QA"}}
        grant=issue_grant(self.state.worker.database_path,owner,source="chat.turn",run_key=rid,
                          direct_fallback="fixture-model")
        packet={"actor":owner.actor_id,"workspace":owner.workspace_id,"chat":owner.chat_id,
                "turn":{"requestId":rid,"token":grant.token},"readTemplate":args}
        with self.state.identity._write() as db:
            attach(db,owner,cid,True)
            d=store.start(db,owner,"action","Проверка границы")
            proof=store.record_preview(db,owner,d["id"],1,RULE,REPORT["plan"],"Предпросмотр")
            e=store.confirm(db,owner,d["id"],1,proof)
            db.execute("INSERT INTO timer_runs(id,event,revision,due,state,write_args) VALUES(?,?,1,1,'prepared',?)",
                       (run,e["id"],store.encoded(args)))
            jobs.verify_write(db,owner,run,args)
            def required():
                return requires_edit_confirmation(db,owner.workspace_id,owner.chat_id,"wildberries")
            self.assertTrue(required())
            for changed in ({"actor":"unrelated"},{"chat":"unrelated"},{"turn":{"requestId":rid,"token":"bad"}},
                            {"readTemplate":dict(args,params={"name":"other"})}):
                with authorization.matrix_request({**packet,**changed}), self.assertRaises(PermissionError):
                    required()
            with authorization.matrix_request(packet):
                self.assertFalse(required())
                with self.assertRaises(PermissionError):
                    required()
            self.assertTrue(required())
        revoke_grant(self.state.worker.database_path,grant.token)
        self.client.__exit__(None,None,None)
        self.create_app()
        self.runtime_fixture()
        self.until(lambda:self.events()[0]["status"]=="paused")
        rows=self.client.get(self.route+"/plugins/timer/events/"+e["id"]+"/history",headers=self.headers).json()["runs"]
        self.assertEqual([r["outcome"] for r in rows],["unknown"])
        response=self.client.post(self.route+"/plugins/timer/events/"+e["id"]+"/resume",json={},headers=self.headers)
        self.assertEqual(response.status_code,409)

    def test_edge_fires_again_only_after_condition_clears(self):
        self.enable()
        state={"eligible":False}
        writes=[]
        self.choice["kind"]="action"
        self.choice["plan"].update({"steps":[{"tool":"marketplace_read","args":{"action":"read","connectionId":"fixture",
            "templateId":"fixture.stock","params":{}}}],"action":{"when":{"path":[0,"eligible"],"op":"eq","value":True},
            "connectionId":"fixture","params":{},"command":"Выполнить действие","mode":"edge","templateId":"fixture.action"}})
        async def fixture(scope,grant,key,question,op,tool=None,args=None,run=None):
            if op=="write":
                with self.state.identity._write() as db:
                    jobs.verify_write(db,scope,run,args)
                writes.append(run)
                return {"ok":True,"state":"accepted","result":"Готово"}
            return dict(state)
        rt=self.state.timers.runtime
        with patch.object(rt,"source",fixture),patch.object(rt,"verify_action",return_value=None):
            self.assertIn("Предпросмотр",self.turn("Каждый час проверь наличие",{"kind":"action"}))
            self.turn("Да")
            event,=self.events()
            history=self.route+"/plugins/timer/events/"+event["id"]+"/history"
            for idx,eligible in enumerate([True,True,False,True],start=1):
                state["eligible"]=eligible
                self.due(event["id"])
                def finished():
                    rows=self.client.get(history,headers=self.headers).json()["runs"]
                    return len(rows)==idx and rows[0]["state"]=="done"
                self.until(finished)
            self.assertEqual(len(set(writes)),2)
            self.assertEqual([r["outcome"] for r in self.client.get(history,headers=self.headers).json()["runs"]],
                             ["changed","skip","skip","changed"])

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
