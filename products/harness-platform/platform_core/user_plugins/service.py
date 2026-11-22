import asyncio
from dataclasses import asdict
from datetime import date, datetime
from email.utils import parsedate_to_datetime
import time
import re
import logging
from uuid import uuid4
from zoneinfo import ZoneInfo

import httpx
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from .. import chat_defaults
from ..chat_connections import attach, scope_for
from ..identity import AuthenticationError, _principal, _secret_digest
from .store import adapter, now, values, valid_sku, write_value
from . import illustrations, model
from ..marketplace_matrix import ozon_retry, store_currency
from ..marketplace_matrix import wb_coefficients as wb
from .registry import CATALOG, CATEGORIES, WB, OZON, attached, store_row

JOBS = """CREATE TABLE IF NOT EXISTS user_plugin_jobs(
    id TEXT PRIMARY KEY, chat TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
    plugin TEXT NOT NULL, cid TEXT NOT NULL, sku TEXT NOT NULL, metric TEXT NOT NULL,
    state TEXT NOT NULL, message TEXT NOT NULL, started TEXT NOT NULL, since TEXT, until TEXT,
    FOREIGN KEY(plugin,cid) REFERENCES user_plugin_stores ON DELETE CASCADE)"""


def retry_delay(headers):
    for name in ("Retry-After","X-Ratelimit-Retry","X-Ratelimit-Reset"):
        value=headers.get(name)
        if value:
            try:
                seconds=float(value) if value.isdecimal() else parsedate_to_datetime(value).timestamp()-time.time()
                return max(1,seconds)
            except (ValueError,TypeError,OverflowError):
                pass
    return 60


class Service:
    def __init__(self,state):
        self.state=state
        self.tasks={}
        with state.identity._write() as db:
            db.execute(JOBS)
            # This deployment runs one ASGI worker. A stopped task made no partial coefficient writes.
            db.execute("""UPDATE user_plugin_jobs SET state='failed',message='Сервис перезапустился. Запустите расчёт ещё раз.'
                          WHERE state='running'""")

    def sync_added(self,token,cid,chat):
        with self.state.identity._write() as db:
            scope=scope_for(db,token,chat)
            row=db.execute("SELECT plugin,catalog_at FROM user_plugin_stores WHERE cid=?",(cid,)).fetchone()
            if row and row[1] is None:
                self.begin(db,scope,token,CATALOG[row[0]],cid,"","cards",None,None)

    async def close(self):
        tasks=list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks,return_exceptions=True)

    def begin(self,db,scope,token,plugin,cid,sku,metric,period,revision,request_id=None):
        current=store_row(db,scope,plugin,cid)
        valid_sku(db,cid,sku,plugin)
        dates=tuple(day.isoformat() for day in period) if period else (None,None)
        if request_id is not None:
            if not isinstance(request_id,str) or not re.fullmatch(r"[0-9a-f]{32}",request_id):
                raise HTTPException(400,"Не удалось распознать запрос.")
            prior=db.execute("SELECT chat,cid,sku,metric,since,until FROM user_plugin_jobs WHERE id=?",(request_id,)).fetchone()
            if prior:
                if prior!=(scope.chat_id,cid,sku,metric,*dates):
                    raise HTTPException(409,"Запрос уже использован.")
                return request_id
        if metric!="cards" and values(db,cid,sku,plugin).get(metric,{}).get("revision")!=revision:
            raise HTTPException(409,"Значение уже изменилось. Обновите настройки.")
        duplicate=db.execute("""SELECT id,since,until FROM user_plugin_jobs WHERE chat=? AND plugin=? AND cid=? AND sku=?
            AND metric=? AND state='running'""",(scope.chat_id,plugin.id,cid,sku,metric)).fetchone()
        if duplicate:
            if duplicate[1:]!=dates:
                raise HTTPException(409,"Расчёт за другой период уже выполняется.")
            return duplicate[0]
        jid=request_id or uuid4().hex
        db.execute("INSERT INTO user_plugin_jobs VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                   (jid,scope.chat_id,plugin.id,cid,sku,metric,"running","Загружаем карточки товаров…" if metric=="cards" else "Выбираем источники…",now(),*dates))
        pref=db.execute("SELECT model,effort FROM user_plugin_models WHERE workspace=? AND plugin=?",(scope.workspace_id,plugin.id)).fetchone()
        self.tasks[jid]=asyncio.create_task(self.run(scope,token,plugin,cid,sku,metric,period,revision,current,jid,pref))
        self.tasks[jid].add_done_callback(lambda _:self.tasks.pop(jid,None))
        return jid

    async def run(self,scope,token,plugin,cid,sku,metric,period,revision,original,jid,pref):
        identity=self.state.identity
        platform=adapter(plugin)
        def guard_db(db):
            bound=scope_for(db,token,scope.chat_id)
            if bound!=scope or store_row(db,bound,plugin,cid)!=original:
                raise HTTPException(409,"Доступ к магазину изменился.")
        def guard():
            with identity._lock:
                guard_db(identity._db)
        def progress(message,status="running"):
            with identity._write() as db:
                db.execute("UPDATE user_plugin_jobs SET state=?,message=? WHERE id=?",(status,message,jid))
        async def read(source,body):
            retry = None
            number = 0
            while True:
                guard()
                provider,version,fields=self.state.integrations.open(token,cid)
                if provider!=plugin.provider or version!=original[0]:
                    raise HTTPException(409,"Подключение изменилось.")
                url = platform.sources()[source]
                if retry:
                    progress(retry.sending(number))
                resp=await self.state.http.post(url,headers=platform.headers(fields),json=body,timeout=55)
                if resp.status_code!=429:
                    break
                if plugin == OZON:
                    now_s = time.time()
                    retry = ozon_retry.plan(url, store_currency.retry_time(resp.headers, now_s), now_s)
                    number += 1
                    progress(retry.waiting(number))
                    delay = retry.due - now_s
                else:
                    delay=retry_delay(resp.headers)
                    progress(plugin.title+" ограничил частоту запросов. Продолжим автоматически.")
                until=time.monotonic()+delay
                while (remaining:=until-time.monotonic())>0:
                    await asyncio.sleep(min(remaining,15))
                    guard()
            if resp.status_code in (401,403):
                raise wb.DataError(plugin.title+" отклонил доступ. Проверьте права ключа на нужный отчёт.")
            if resp.status_code==204 and source=="finance":
                return []
            if not resp.is_success:
                raise wb.DataError(plugin.title+" не выдал запрошенный отчёт. Проверьте доступ и выбранный период.")
            return await asyncio.to_thread(resp.json)
        try:
            if metric=="cards":
                rows=await platform.products(read)
                with identity._write() as db:
                    guard_db(db)
                    db.execute("DELETE FROM user_plugin_products WHERE plugin=? AND cid=?",(plugin.id,cid))
                    db.executemany("INSERT INTO user_plugin_products VALUES(?,?,?,?,?)",((plugin.id,cid,*row) for row in rows))
                    db.execute("UPDATE user_plugin_stores SET catalog_at=? WHERE plugin=? AND cid=?",(now(),plugin.id,cid))
            else:
                progress("Получаем отчёты "+plugin.title+"…")
                def schemes(db):
                    return dict(db.execute("SELECT office,scheme FROM user_plugin_warehouse_schemes WHERE plugin=? AND cid=?",(plugin.id,cid)))
                with identity._lock:
                    overrides=schemes(identity._db) if metric=="commission" else {}
                async with model.choose_templates(self.state,scope,_secret_digest(token),jid,metric,pref,guard,plugin) as (grant,plan):
                    if plugin==OZON:
                        value,basis=await platform.calculate(scope,cid,metric,period,sku,grant,jid,self.state.worker.database_path)
                    else:
                        value,basis=await platform.calculate(read,metric,*period,sku,templates=plan,overrides=overrides)
                with identity._write() as db:
                    guard_db(db)
                    valid_sku(db,cid,sku,plugin)
                    if metric=="commission" and overrides!=schemes(db):
                        raise HTTPException(409,"Схемы складов изменились. Запустите расчёт ещё раз.")
                    write_value(db,cid,sku,metric,value,"calculated",*(d.isoformat() for d in period),
                                {**basis,"model":grant.model or grant.direct_model,"templates":list(plan)},revision,plugin)
            progress("Готово.","done")
        except (HTTPException,wb.DataError) as exc:
            progress(str(exc.detail if isinstance(exc,HTTPException) else exc),"failed")
        except AuthenticationError:
            progress("Сеанс завершён. Войдите и повторите операцию.","failed")
        except (httpx.HTTPError,ValueError,TypeError,KeyError,OSError,ArithmeticError) as exc:
            logging.getLogger(__name__).warning("Plugin job failed plugin=%s metric=%s cause=%s",
                                                plugin.id,metric,type(exc).__name__)
            progress("Не удалось подтвердить данные источника. Сохранённые значения доступны.","failed")
        except Exception:
            progress("Не удалось завершить операцию. Повторите запрос.","failed")
            raise


def routes(get_token,body):
    base="/api/chats/{chat_id}/plugins"
    path=base+"/{plugin_id}"
    def snapshot(db, workspace, chat=None):
        installed = {row[0] for row in db.execute(
            "SELECT plugin_id FROM entitlements WHERE workspace_id=?", (workspace,))}
        enabled = {row[0] for row in db.execute(
            "SELECT plugin_id FROM chat_plugins WHERE workspace_id=? AND chat_id=?", (workspace, chat))}
        return {"categories": CATEGORIES, "plugins": [
            {**asdict(p), "installed": p.id in installed, "enabled": p.id in enabled}
            for p in CATALOG.values()]}

    def cancel_jobs(db, tasks, workspace, key, chat=None):
        jobs = db.execute("""UPDATE user_plugin_jobs SET state='failed', message='Плагин отключён.'
            WHERE plugin=? AND state='running' AND chat IN
            (SELECT chat_id FROM chats WHERE workspace_id=? AND (? IS NULL OR chat_id=?))
            RETURNING id""", (key, workspace, chat, chat)).fetchall()
        for (jid,) in jobs:
            if jid in tasks:
                tasks[jid].cancel()

    async def catalog(req):
        token = get_token(req, allow_cookie=True)
        chat = req.path_params.get("chat_id")
        field = "enabled" if chat else "installed"
        data = await body(req, "plugin", field) if req.method == "POST" else None
        identity = req.app.state.identity
        with (identity._write() if data is not None else identity._lock):
            db = identity._db
            workspace = scope_for(db, token, chat).workspace_id if chat else _principal(db, token)[1]
            if data is not None:
                key = data["plugin"]
                if not isinstance(key, str) or key not in CATALOG or type(data[field]) is not bool:
                    raise HTTPException(400, "Выберите плагин из каталога.")
                if chat:
                    if data[field]:
                        if not db.execute("SELECT 1 FROM entitlements WHERE workspace_id=? AND plugin_id=?",
                                          (workspace, key)).fetchone():
                            raise HTTPException(409, "Сначала установите плагин в каталоге.")
                        db.execute("INSERT OR IGNORE INTO chat_plugins VALUES(?,?,?)", (workspace, chat, key))
                    else:
                        db.execute("DELETE FROM chat_plugins WHERE workspace_id=? AND chat_id=? AND plugin_id=?",
                                   (workspace, chat, key))
                elif data[field]:
                    db.execute("INSERT OR IGNORE INTO entitlements VALUES(?,?)", (workspace, key))
                else:
                    db.execute("DELETE FROM entitlements WHERE workspace_id=? AND plugin_id=?", (workspace, key))
                if not data[field]:
                    cancel_jobs(db, req.app.state.plugins.tasks, workspace, key, chat)
            return JSONResponse(snapshot(db, workspace, chat))

    async def settings(req):
        plugin=CATALOG.get(req.path_params["plugin_id"])
        if not plugin:
            raise HTTPException(404,"Плагин недоступен.")
        state=req.app.state
        token=get_token(req,allow_cookie=True)
        chat=req.path_params["chat_id"]
        action=req.path_params.get("action")
        keys={"store":("cid",),"disconnect":("cid",),"scheme":("cid","office","scheme"),"refresh":("cid",),"save":("cid","sku","metric","value","revision"),
              "calculate":("cid","sku","metric","since","until","revision"),"model":("model","effort")}
        if action and (action not in keys or (action=="scheme" and plugin!=WB)):
            raise HTTPException(404)
        data=await body(req,*keys[action],optional=(("requestId",) if action=="calculate" else ())) if action else {}
        cid=data.get("cid",req.query_params.get("cid",""))
        sku=data.get("sku",req.query_params.get("sku",""))
        if not isinstance(cid,str) or not isinstance(sku,str):
            raise HTTPException(400,"Выберите магазин и артикул.")
        with state.identity._lock:
            scope=scope_for(state.identity._db,token,chat)
            if not attached(state.identity._db,scope,plugin.id):
                raise HTTPException(403,"Подключите плагин к этому чату.")
        image_plugin = plugin.id == illustrations.PLUGIN
        action_name = illustrations.ACTION if image_plugin else "calculate"
        if image_plugin and (cid or sku or action not in (None,"model")):
            raise HTTPException(400,"У плагина нет такой настройки.")
        data_model=data.get("model")
        if req.query_params.get("models")=="1" or (action=="model" and data_model):
            available,notice=await chat_defaults.choice_catalog(state,direct=not image_plugin)
            capability="image" if image_plugin else "chat"
            available={k:m for k,m in available.items() if m.get(capability)}
            if not action:
                return JSONResponse({"models":list(available.values()),"catalogMessage":notice})
            if not isinstance(data_model,str) or data_model not in available or data["effort"] not in available[data_model]["efforts"]:
                raise HTTPException(400,"Выберите доступную модель и степень рассуждения.")
        with state.identity._write() as db:
            scope=scope_for(db,token,chat)
            if not attached(db,scope,plugin.id):
                raise HTTPException(403,"Плагин отключён.")
            if action=="model":
                db.execute("DELETE FROM plugin_action_models WHERE workspace=? AND plugin=? AND action=?",(scope.workspace_id,plugin.id,action_name))
                if data_model:
                    db.execute("INSERT INTO plugin_action_models VALUES(?,?,?,?,?,?)",(scope.workspace_id,plugin.id,action_name,data_model,data["effort"],int(available[data_model].get("free",False))))
                db.execute("DELETE FROM user_plugin_models WHERE workspace=? AND plugin=?",(scope.workspace_id,plugin.id))
                if data["model"]:
                    db.execute("INSERT INTO user_plugin_models VALUES(?,?,?,?)",(scope.workspace_id,plugin.id,data["model"],data["effort"]))
            if image_plugin:
                selected,_=illustrations.settings_model(db,scope.workspace_id)
                return JSONResponse({"model":selected,"effort":"auto"})
            platform=adapter(plugin)
            if action=="store":
                if not db.execute("SELECT 1 FROM account_integrations WHERE workspace=? AND id=? AND provider=?",(scope.workspace_id,cid,plugin.provider)).fetchone():
                    raise HTTPException(404,"Магазин "+plugin.title+" недоступен.")
                attach(db,scope,cid,True)
                db.execute("INSERT OR IGNORE INTO user_plugin_stores VALUES(?,?,?,NULL)",(plugin.id,cid,uuid4().hex))
            if cid:
                store_row(db,scope,plugin,cid)
                valid_sku(db,cid,sku,plugin)
            elif action and action!="model":
                raise HTTPException(400,"Выберите магазин.")
            if action=="scheme":
                office,scheme=data["office"],data["scheme"]
                if not isinstance(office,str) or not 1<=len(office.strip())<=160 or scheme not in ("","FBW","FBS"):
                    raise HTTPException(400,"Укажите название склада из отчёта и схему доставки.")
                db.execute("DELETE FROM user_plugin_warehouse_schemes WHERE plugin=? AND cid=? AND office=?",(plugin.id,cid,office.strip()))
                if scheme:
                    db.execute("INSERT INTO user_plugin_warehouse_schemes VALUES(?,?,?,?)",(plugin.id,cid,office.strip(),scheme))
            if action=="disconnect":
                attach(db,scope,cid,False)
                return JSONResponse({"disconnected":True})
            if action in ("store","refresh"):
                return JSONResponse({"job":state.plugins.begin(db,scope,token,plugin,cid,"","cards",None,None)},status_code=202)
            if action in ("save","calculate"):
                metric=data["metric"]
                if not isinstance(metric,str) or metric not in platform.METRICS:
                    raise HTTPException(400,"Неизвестный показатель.")
                if action=="save":
                    try:
                        value=platform.validate(metric,data["value"])
                    except wb.DataError as exc:
                        raise HTTPException(400,str(exc)) from None
                    write_value(db,cid,sku,metric,value,"manual",None,None,None,data["revision"],plugin)
                else:
                    if not all(isinstance(data[k],str) for k in ("since","until")):
                        raise HTTPException(400,"Укажите даты начала и окончания.")
                    try:
                        start,end=date.fromisoformat(data["since"]),date.fromisoformat(data["until"])
                    except ValueError:
                        raise HTTPException(400,"Укажите корректные даты начала и окончания.") from None
                    today=datetime.now(ZoneInfo("Europe/Moscow")).date()
                    if not start<=end<today:
                        raise HTTPException(400,"Выберите завершившийся период.")
                    return JSONResponse({"job":state.plugins.begin(db,scope,token,plugin,cid,sku,metric,(start,end),data["revision"],data.get("requestId"))},status_code=202)
            stores=[dict(id=c,name=n,selected=bool(s and a),added=bool(s)) for c,n,s,a in db.execute("""
                SELECT c.id,c.name,p.cid,g.connection_id FROM account_integrations c
                LEFT JOIN user_plugin_stores p ON p.cid=c.id AND p.plugin=?
                LEFT JOIN chat_integrations g ON g.connection_id=c.id AND g.chat_id=?
                WHERE c.workspace=? AND c.provider=? ORDER BY c.name,c.id""",(plugin.id,chat,scope.workspace_id,plugin.provider))]
            pref=db.execute("SELECT model,effort FROM user_plugin_models WHERE workspace=? AND plugin=?",(scope.workspace_id,plugin.id)).fetchone()
            result={"stores":stores,"metrics":{k:{"title":v[0],"unit":v[1]} for k,v in platform.METRICS.items()},
                    "model":pref[0] if pref else "","effort":pref[1] if pref else ""}
            if cid:
                result["schemes"]=dict(db.execute("""SELECT office,scheme FROM user_plugin_warehouse_schemes
                    WHERE plugin=? AND cid=? ORDER BY office""",(plugin.id,cid)))
                stamp=db.execute("SELECT catalog_at FROM user_plugin_stores WHERE plugin=? AND cid=?",(plugin.id,cid)).fetchone()[0]
                result["catalogAt"]=stamp
                if not stamp or req.query_params.get("catalogAt")!=stamp:
                    result["products"]=[dict(sku=n,offer=o,title=t) for n,o,t in db.execute("""SELECT sku,offer,title
                        FROM user_plugin_products WHERE plugin=? AND cid=? ORDER BY title,sku""",(plugin.id,cid))]
                result["values"]=values(db,cid,sku,plugin)
                latest=db.execute("""SELECT id,metric,state,message FROM (
                    SELECT id,metric,state,message,row_number() OVER(PARTITION BY metric ORDER BY rowid DESC) AS n
                    FROM user_plugin_jobs WHERE chat=? AND plugin=? AND cid=? AND (sku=? OR metric='cards'))
                    WHERE n=1""",(chat,plugin.id,cid,sku))
                result["jobs"]=[dict(zip(("id","metric","state","message"),row)) for row in latest]
            return JSONResponse(result)
    return [Route("/api/plugins",catalog,methods=["GET","POST"]),Route(base,catalog,methods=["GET","POST"]),Route(path,settings),Route(path+"/{action}",settings,methods=["POST"])]
