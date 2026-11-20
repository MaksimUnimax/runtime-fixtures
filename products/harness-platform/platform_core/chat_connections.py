"""Explicit grants to use account connections in individual Harness conversations."""
import asyncio
from datetime import date, datetime, timedelta
from decimal import Decimal
from email.utils import parsedate_to_datetime
import time
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from .catalog import Capability
from .identity import _principal
from .storage import Scope, _owns_chat

SCHEMA = """CREATE TABLE IF NOT EXISTS chat_integrations(chat_id TEXT NOT NULL REFERENCES chats ON DELETE CASCADE,
    connection_id TEXT NOT NULL REFERENCES account_integrations(id) ON DELETE CASCADE,
    PRIMARY KEY(chat_id,connection_id))"""
MOSCOW=ZoneInfo("Europe/Moscow")

def scope_for(db,token,chat):
    actor,ws=_principal(db,token)
    scope=Scope(actor,ws,chat)
    if not _owns_chat(db,scope):
        raise HTTPException(404,"Чат недоступен")
    return scope

def attach(db,scope,cid,enabled):
    if not db.execute("SELECT 1 FROM account_integrations WHERE id=? AND workspace=?",(cid,scope.workspace_id)).fetchone():
        raise HTTPException(404,"Подключение недоступно")
    if enabled:
        db.execute("INSERT OR IGNORE INTO chat_integrations VALUES(?,?)",(scope.chat_id,cid))
    else:
        db.execute("DELETE FROM chat_integrations WHERE chat_id=? AND connection_id=?",(scope.chat_id,cid))

def unseal(ws,provider,cid,blob):
    cipher=AESGCM(Path(os.environ["HARNESS_INTEGRATIONS_KEY_FILE"]).read_bytes())
    return json.loads(cipher.decrypt(blob[:12],blob[12:],json.dumps([ws,provider,cid]).encode()))

def snapshot(db,scope):
    if not _owns_chat(db,scope):
        raise PermissionError("Chat unavailable")
    rows=db.execute("""SELECT c.id,c.name,c.provider,c.status,g.connection_id IS NOT NULL,c.encrypted
        FROM account_integrations c LEFT JOIN chat_integrations g ON g.connection_id=c.id AND g.chat_id=?
        WHERE c.workspace=? ORDER BY c.name,c.id""",(scope.chat_id,scope.workspace_id))
    result=[]
    for cid,name,provider,status,attached,blob in rows:
        kinds=[]
        if provider=="ozon" and attached:
            fields=unseal(scope.workspace_id,provider,cid,blob)
            if "api_key" in fields: kinds.append("Ozon Seller")
            if "performance_secret" in fields: kinds.append("Ozon Performance")
        elif provider in ("wb","wordstat"):
            kinds=["WB Статистика" if provider=="wb" else "Яндекс Вордстат"]
        result.append(dict(id=cid,name=name,provider=provider,status=status,attached=bool(attached),access=kinds))
    return result

def routes(token_for,body):
    async def connections(req):
        token=token_for(req,allow_cookie=True)
        identity=req.app.state.identity
        data=await body(req,"connectionId","enabled") if req.method=="POST" else None
        with identity._write() as db:
            scope=scope_for(db,token,req.path_params["chat_id"])
            if data is not None:
                if type(data["enabled"]) is not bool or not isinstance(data["connectionId"],str):
                    raise ValueError("Invalid connection grant")
                attach(db,scope,data["connectionId"],data["enabled"])
            return JSONResponse({"connections":snapshot(db,scope)})
    return [Route("/api/chats/{chat_id}/integrations",connections,methods=["GET","POST"])]

def calendar_day(value):
    today=datetime.now(MOSCOW).date()
    if value in ("today","сегодня"): return today.isoformat()
    if value in ("yesterday","вчера"): return (today-timedelta(days=1)).isoformat()
    return date.fromisoformat(value).isoformat()

def ozon_analytics(client, fields, day):
    headers={"Client-Id":fields["client_id"],"Api-Key":fields["api_key"]}
    body={"date_from":day,"date_to":day,"dimension":["day"],"metrics":["ordered_units","revenue"],"limit":100,"offset":0}
    for attempt in range(3):
        result=client.post("https://api-seller.ozon.ru/v1/analytics/data",headers=headers,json=body)
        if result.status_code!=429 or attempt==2:
            return result
        retry=result.headers.get("Retry-After")
        delay=1.1*(attempt+1)
        if retry is not None:
            try:
                delay=float(retry) if retry.isdecimal() else parsedate_to_datetime(retry).timestamp()-time.time()
            except (ValueError,TypeError,OverflowError):
                return result
            if delay>3:
                return result
        time.sleep(max(delay,0.1))


WB_REPORTS = {
    "orders": "https://statistics-api.wildberries.ru/api/v1/supplier/orders",
    "sales": "https://statistics-api.wildberries.ru/api/v1/supplier/sales",
}


def wb_orders(day, rows):
    by_order = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("date"), str) or row["date"][:10] != day:
            raise ValueError("Unexpected WB order date")
        srid, cancelled = row.get("srid"), row.get("isCancel")
        if not isinstance(srid, str) or not srid.strip() or type(cancelled) is not bool:
            raise ValueError("Missing WB order identity or cancellation status")
        if srid in by_order and by_order[srid] != cancelled:
            raise ValueError("Conflicting WB order statuses")
        by_order[srid] = cancelled
    return {"source":"WB Статистика, заказы","day":day,"orderedUnits":len(by_order),
            "cancelledOfOrderedUnits":sum(by_order.values()),
            "meaning":"Заказанные единицы по дате оформления, включая отменённые. Отмены указаны среди этих заказов. Выкупы именно этих заказов требуют сверки по srid. Разница с числом продаж за день не показывает, сколько заказов в пути."}


def read_service(provider,fields,action,args):
    from .integrations import probe
    if action=="check":
        async def verify():
            async with httpx.AsyncClient(timeout=9,trust_env=False) as client:
                return await probe(client,provider,fields)
        return {"checks":asyncio.run(verify())}
    with httpx.Client(timeout=12,trust_env=False,follow_redirects=False) as client:
        if action=="wordstat":
            r=client.post("https://api.wordstat.yandex.net/v1/topRequests",json={"phrase":args["phrase"]},
                          headers={"Authorization":"Bearer "+fields["token"]})
        else:
            day=calendar_day(args["day"])
            if action=="ozon":
                r=ozon_analytics(client,fields,day)
            else:
                report=args.get("report","sales")
                r=client.get(WB_REPORTS[report],
                    headers={"Authorization":fields["token"]},params={"dateFrom":day,"flag":1})
        if not r.is_success:
            return {"ok":False,"httpStatus":r.status_code,"reason":{
                401:"Сервис отклонил ключ",403:"Недостаточно прав на отчёт или требуется подписка",
                429:"Достигнут лимит запросов сервиса"}.get(r.status_code,"Сервис не вернул отчёт")}
        data=r.json()
        if action=="wordstat":
            return {"topRequests":[{"phrase":i["phrase"],"count":i["count"]} for i in data["topRequests"][:50]]}
        if action=="ozon":
            rows=data["result"]["data"]
            if not isinstance(rows,list): raise ValueError("Invalid analytics")
            if not rows: return {"day":day,"source":"Ozon Seller Analytics","status":"Нет строк в отчёте за дату"}
            if any(len(i["metrics"])!=2 or i["dimensions"][0]["id"]!=day for i in rows): raise ValueError("Unexpected Ozon date or metrics")
            return {"day":day,"source":"Ozon Seller Analytics","orderedUnits":sum(int(i["metrics"][0]) for i in rows),
                    "orderedRevenue":str(sum(Decimal(str(i["metrics"][1])) for i in rows)),
                    "meaning":"Количество и стоимость заказанных товаров. Это данные заказов, не выкупов и не выплат."}
        if not isinstance(data,list): raise ValueError("Unexpected WB report")
        if report=="orders":
            return wb_orders(day,data)
        if any(not str(i["saleID"]).startswith(("S","R")) for i in data):
            raise ValueError("Unexpected sales report")
        sales=sum(i["saleID"].startswith("S") for i in data)
        return {"day":day,"source":"WB Статистика, продажи и возвраты","soldUnits":sales,"returnedUnits":len(data)-sales}

# Entrypoints live only in the privately scoped MCP subprocess.
class ChatTools:
    def __init__(self,store,scope):
        self.store,self.scope=store,scope

    def tools(self):
        db=self.store._db
        with self.store._lock:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='chat_integrations'").fetchone(): return ()
            entries=[r for r in snapshot(db,self.scope) if r["attached"]]
        specs=[
          ("check_store_access","Проверить подключение магазина или сервиса сейчас.","check",entries,{}),
          ("ozon_daily_orders","Заказы и сумма заказанных товаров Ozon за день по данным Seller Analytics.","ozon",
             [r for r in entries if "Ozon Seller" in r["access"]],{"day":{"type":"string","description":"yesterday, today или YYYY-MM-DD, Москва"}}),
          ("wb_statistics_report","Дневная статистика Wildberries. Выбери отчёт orders для оформленных заказов и отмен среди них, sales для продаж и возвратов.","wb",
             [r for r in entries if r["provider"]=="wb"],{
                 "report":{"type":"string","enum":list(WB_REPORTS)},
                 "day":{"type":"string","description":"yesterday, today или YYYY-MM-DD, Москва"}}),
          ("wb_daily_sales","Количество продаж и возвратов WB за день.","wb",[r for r in entries if r["provider"]=="wb"],
             {"day":{"type":"string","description":"yesterday, today или YYYY-MM-DD, Москва"}}),
          ("wordstat_keywords","Частотность и популярные поисковые фразы Яндекс Вордстат.","wordstat",
             [r for r in entries if r["provider"]=="wordstat"],{"phrase":{"type":"string","minLength":1,"maxLength":200}})]
        result=[]
        for name,description,action,allowed,props in specs:
            if not allowed: continue
            properties={"connectionId":{"type":"string","enum":[r["id"] for r in allowed]},**props}
            schema={"type":"object","properties":properties,"required":list(properties),"additionalProperties":False}
            def handler(scope,args,action=action):
                cid=args["connectionId"]
                with self.store._lock:
                    if not _owns_chat(db,scope): raise PermissionError()
                    row=db.execute("""SELECT c.provider,c.encrypted FROM account_integrations c
                         JOIN chat_integrations g ON c.id=g.connection_id WHERE g.chat_id=? AND c.workspace=? AND c.id=?""",
                         (scope.chat_id,scope.workspace_id,cid)).fetchone()
                    if not row: raise PermissionError()
                    provider,blob=row
                    fields=unseal(scope.workspace_id,provider,cid,blob)
                if action not in ("check",provider) or (action=="ozon" and "api_key" not in fields): raise PermissionError()
                return read_service(provider,fields,action,args)
            result.append(Capability(name,description,schema,handler))
        return tuple(result)
