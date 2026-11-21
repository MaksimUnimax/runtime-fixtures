"""One private, metered image artifact for an illustration action in a chat turn."""
import asyncio
import base64
import binascii
import contextlib
import json
from decimal import Decimal, ROUND_CEILING
import hashlib
import re
import time
from uuid import uuid4

import httpx
from starlette.exceptions import HTTPException
from starlette.responses import Response, JSONResponse
from starlette.routing import Route

from .. import router_status, router_recovery, coins
from ..chat_connections import scope_for
from ..storage import Scope
from ..operation_grants import active_chat_grant
from .registry import attached

PLUGIN = "illustrations"
ACTION = "create_image"
SCHEMA = """CREATE TABLE IF NOT EXISTS plugin_illustrations(
    id TEXT PRIMARY KEY, chat TEXT NOT NULL REFERENCES chats ON DELETE CASCADE,
    operation_id TEXT NOT NULL UNIQUE REFERENCES usage_operations,
    attempt TEXT NOT NULL UNIQUE REFERENCES coin_attempts, mime TEXT, content BLOB)"""


def grant_scope(db,token):
    digest=hashlib.sha256(token.encode()).hexdigest()
    row=db.execute("""SELECT o.actor_id,o.workspace_id,o.chat_id,o.operation_id,c.cap,r.fx_e4
        FROM usage_grants g JOIN usage_operations o USING(operation_id) JOIN coin_orders c USING(operation_id)
        JOIN coin_ruble_orders r USING(operation_id)
        WHERE g.token_hash=? AND g.expires_at>unixepoch() AND c.closed=0 AND o.source='chat.turn'""",
        (digest,)).fetchone()
    if not row or not active_chat_grant(db,digest) or not attached(db,Scope(*row[:3]),PLUGIN):
        raise HTTPException(403,"Подключите плагин иллюстраций в этом чате.")
    return row


def settings_model(db,workspace):
    row=db.execute("SELECT model,free FROM plugin_action_models WHERE workspace=? AND plugin=? AND action=?",
                   (workspace,PLUGIN,ACTION)).fetchone()
    return tuple(row) if row else ("",False)


def reserve(router,token,prompt):
    with router.identity._write() as db:
        _,workspace,chat,operation,cap,fx=grant_scope(db,token)
        existing=db.execute("SELECT id,content IS NOT NULL FROM plugin_illustrations WHERE operation_id=?",(operation,)).fetchone()
        if existing:
            if not existing[1]:
                raise HTTPException(409,"Иллюстрация уже обрабатывается или ожидает сверки.")
            return chat,existing[0],None,None
        model,was_free=settings_model(db,workspace)
        item=router.catalog.get(model,{})
        if not item.get("image") or (was_free and not item.get("free")):
            raise HTTPException(409,"Выберите доступную модель в настройках плагина «Иллюстрации».")
        bound=0
        if not item["free"]:
            if not db.execute("SELECT 1 FROM workspace_paid_model_access WHERE workspace_id=?",(workspace,)).fetchone():
                raise HTTPException(402,"Для иллюстрации нужен доступный баланс.")
            used=db.execute("SELECT COALESCE(SUM(COALESCE(charge,bound)),0) FROM coin_attempts WHERE operation_id=?",(operation,)).fetchone()[0]
            # A zero-cost chat can call a separately paid action only from a paid wallet.
            room=min(coins.balances(db,workspace)[0],cap-used)
            estimate=item.get("imagePrice")
            if not estimate or room<=0:
                raise HTTPException(402,"Не удалось зарезервировать стоимость иллюстрации.")
            price,token_price,input_price,request_price,max_tokens=estimate
            upper=(Decimal(price)+Decimal(request_price)+Decimal(token_price)*max_tokens
                   +Decimal(input_price)*(len(prompt.encode())+64))
            if upper<=0:
                raise HTTPException(409,"Стоимость изображения у этой модели не подтверждена.")
            bound=int((upper*fx*coins.UNIT/10000).to_integral_value(rounding=ROUND_CEILING))
            if bound>room:
                raise HTTPException(402,"Недостаточно средств для резерва по выбранной модели изображений.")
        aid,art=uuid4().hex,uuid4().hex
        db.execute("""INSERT INTO coin_attempts(attempt_id,operation_id,bound,model,started_ms,rate_version,period)
                    VALUES(?,?,?,?,?,'openrouter-v1','plugin.illustrations.create_image')""",
                   (aid,operation,bound,model,int(time.time()*1000)))
        db.execute("INSERT INTO plugin_illustrations(id,chat,operation_id,attempt) VALUES(?,?,?,?)",(art,chat,operation,aid))
        return chat,art,aid,model


def picture(value):
    raw=base64.b64decode(value,validate=True)
    for prefix,mime in ((b'\x89PNG\r\n\x1a\n','image/png'),(b'\xff\xd8\xff','image/jpeg')):
        if raw.startswith(prefix):
            return mime,raw
    if raw.startswith(b'RIFF') and raw[8:12]==b'WEBP':
        return 'image/webp',raw
    raise ValueError("Unsupported image format")


async def create(router,req):
    token=req.headers.get("x-operation","")
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}",token):
        raise HTTPException(403)
    with router.identity._lock:
        db=router.identity._db
        _,_,chat,operation,_,_=grant_scope(db,token)
        stored=db.execute("SELECT id FROM plugin_illustrations WHERE operation_id=? AND content IS NOT NULL",(operation,)).fetchone()
    fields=await req.json()
    if not isinstance(fields,dict):
        raise HTTPException(400)
    resumed=fields.get("resumeAttempt")
    if resumed is not None:
        if not isinstance(resumed,str) or not re.fullmatch(r"[a-f0-9]{32}",resumed):
            raise HTTPException(400)
        parked=router_recovery.read_parked(router,token,resumed,owner=True)
        if not parked or "image" not in parked[1]:
            raise HTTPException(403)
        payload=parked[1]
        with router.identity._lock:
            db=router.identity._db
            row=db.execute("""SELECT i.id,w.checkpoint FROM plugin_illustrations i
                JOIN openrouter_waits w ON w.attempt=i.attempt WHERE i.attempt=? AND i.operation_id=?""",
                (resumed,operation)).fetchone()
        if not row:
            raise HTTPException(409)
        art,checkpoint=row[0],json.loads(row[1])
        attempt=resumed
        delay=parked[2]
    else:
        prompt=fields.get("prompt")
        if not isinstance(prompt,str) or not 0<len(prompt.strip())<=4000:
            raise HTTPException(400,"Укажите описание иллюстрации.")
        checkpoint=fields.get("checkpoint")
        if checkpoint is not None:
            if not router_recovery.valid_checkpoint(checkpoint) or not isinstance(fields.get("callId"),str):
                raise HTTPException(400)
            checkpoint={**checkpoint,"imageCall":fields["callId"]}
        if stored:
            return artifact(chat,stored[0])
        if not await router.models(current_tariff=True):
            raise HTTPException(503,"Не удалось получить актуальные тарифы OpenRouter. Повторите запрос позже.")
        chat,art,attempt,model=reserve(router,token,prompt)
        if not attempt:
            return artifact(chat,art)
        quote=router.catalog[model]
        payload={"image":{"model":model,"prompt":prompt,"n":1},"price":quote["imagePrice"],"free":quote["free"]}
        delay=None
    lease=contextlib.nullcontext(True) if resumed else router_recovery.ownership(router.database_path,attempt)
    with lease as owned:
        if not owned:
            raise HTTPException(409)
        return await render(router,req,token,chat,art,attempt,payload,checkpoint,delay,resumed is not None)


def artifact(chat,art):
    return JSONResponse({"url":f"/api/chats/{chat}/illustrations/{art}"})


async def render(router,req,token,chat,art,attempt,payload,checkpoint,delay,parked):
    from ..model_router import retry_seconds
    image=payload["image"]
    zero={"cost":0,"prompt_tokens":0,"completion_tokens":0}
    try:
        while True:
            if delay is not None:
                try:
                    if delay>0:
                        await router.wait_limit(token,req,delay)
                    catalog=await router.models(current_tariff=True)
                    current=catalog.get(image["model"],{})
                    if (not current.get("image") or current["free"]!=payload["free"]
                            or list(current["imagePrice"] or ())!=list(payload["price"] or ())):
                        raise HTTPException(409,"Тариф генератора изменился. Проверьте выбор в плагине.")
                    with router.identity._lock:
                        grant_scope(router.identity._db,token)
                    if parked and not router_recovery.read_parked(router,token,attempt,consume=True):
                        raise HTTPException(403)
                    parked=False
                except (HTTPException,asyncio.CancelledError) as error:
                    disconnected=isinstance(error,asyncio.CancelledError) or (error.headers or {}).get("X-Octoport-Wait")=="disconnected"
                    if parked and not disconnected:
                        router_recovery.close_rejected(router,attempt)
                    elif not parked:
                        router.settle(attempt,None,zero)
                    raise
            headers=router.headers
            r=await router.http.post("https://openrouter.ai/api/v1/images",headers=headers,json=image,timeout=110)
            if not r.is_success:
                router_status.note(router,headers["Authorization"][7:],"generation",router_status.refusal(r.status_code))
            if r.status_code!=429:
                break
            delay=retry_seconds(r.headers.get("retry-after"))
            parked=router_recovery.park(router,token,attempt,checkpoint,payload,delay)
    except (httpx.ProxyError,httpx.ConnectError) as exc:
        router.settle(attempt,None,zero)
        raise HTTPException(503,"Нет связи с роутером OpenRouter.") from exc
    except httpx.HTTPError as exc:
        raise HTTPException(503,"Ответ генератора прервался. Запрос на сверке.") from exc
    if not r.is_success:
        if r.status_code in (400,401,402,403,404,422):
            router.settle(attempt,None,zero)
        raise HTTPException(502,"Генератор не вернул иллюстрацию.")
    data=None
    try:
        data=r.json(parse_float=Decimal)
        mime,raw=picture(data["data"][0]["b64_json"])
    except (ValueError,TypeError,KeyError,IndexError,binascii.Error) as exc:
        if isinstance(data,dict):
            router.settle(attempt,data.get("id"),data.get("usage"))
        raise HTTPException(502,"Не удалось подтвердить файл изображения.") from exc
    with router.identity._write() as db:
        db.execute("UPDATE plugin_illustrations SET mime=?,content=? WHERE id=?",(mime,raw,art))
        db.execute("INSERT OR IGNORE INTO openrouter_stopped_outputs VALUES(?)",(art,))
        router.settle_in(db,attempt,data.get("id"),data.get("usage"))
    router_status.note(router,headers["Authorization"][7:],"generation","Изображение получено.",True)
    with router.identity._lock:
        grant_scope(router.identity._db,token)
    return artifact(chat,art)


def routes(get_token):
    async def image(req):
        with req.app.state.identity._lock:
            db=req.app.state.identity._db
            scope=scope_for(db,get_token(req,allow_cookie=True),req.path_params["chat_id"])
            row=db.execute("SELECT mime,content FROM plugin_illustrations WHERE chat=? AND id=? AND content IS NOT NULL",
                          (scope.chat_id,req.path_params["id"])).fetchone()
        if not row:
            raise HTTPException(404)
        return Response(row[1],media_type=row[0],headers={"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store"})
    return [Route("/api/chats/{chat_id}/illustrations/{id}",image)]
