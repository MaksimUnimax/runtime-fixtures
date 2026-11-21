"""One private, metered image artifact for an illustration action in a chat turn."""
import asyncio
import base64
import binascii
from decimal import Decimal, ROUND_CEILING
import hashlib
import re
import time
from uuid import uuid4

import httpx
from starlette.exceptions import HTTPException
from starlette.responses import Response, JSONResponse
from starlette.routing import Route

from .. import coins
from ..chat_connections import scope_for
from ..storage import Scope
from .registry import attached

PLUGIN = "illustrations"
ACTION = "create_image"
SCHEMA = """CREATE TABLE IF NOT EXISTS plugin_illustrations(
    id TEXT PRIMARY KEY, chat TEXT NOT NULL REFERENCES chats ON DELETE CASCADE,
    operation_id TEXT NOT NULL UNIQUE REFERENCES usage_operations,
    attempt TEXT NOT NULL UNIQUE REFERENCES coin_attempts, mime TEXT, content BLOB)"""


def grant_scope(db,token):
    row=db.execute("""SELECT o.actor_id,o.workspace_id,o.chat_id,o.operation_id,c.cap,r.fx_e4
        FROM usage_grants g JOIN usage_operations o USING(operation_id) JOIN coin_orders c USING(operation_id)
        JOIN coin_ruble_orders r USING(operation_id)
        WHERE g.token_hash=? AND g.expires_at>unixepoch() AND c.closed=0 AND o.source='chat.turn'""",
        (hashlib.sha256(token.encode()).hexdigest(),)).fetchone()
    if not row or not attached(db,Scope(*row[:3]),PLUGIN):
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
        grant_scope(router.identity._db,token)
    fields=await req.json()
    prompt=fields.get("prompt") if isinstance(fields,dict) else None
    if not isinstance(prompt,str) or not 0<len(prompt.strip())<=4000:
        raise HTTPException(400,"Укажите описание иллюстрации.")
    await router.models()
    if not router.available():
        raise HTTPException(503,"Нет связи с OpenRouter.")
    chat,art,attempt,model=reserve(router,token,prompt)
    if attempt:
        try:
            while True:
                r=await router.http.post("https://openrouter.ai/api/v1/images",headers=router.headers,
                                json={"model":model,"prompt":prompt,"n":1},timeout=110)
                if r.status_code!=429:
                    break
                try:
                    await router.wait_limit(token,req,r.headers.get("retry-after"))
                    with router.identity._lock:
                        grant_scope(router.identity._db,token)
                except (HTTPException,asyncio.CancelledError):
                    router.settle(attempt,None,{"cost":0,"prompt_tokens":0,"completion_tokens":0})
                    raise
        except (httpx.ProxyError,httpx.ConnectError) as exc:
            router.settle(attempt,None,{"cost":0,"prompt_tokens":0,"completion_tokens":0})
            raise HTTPException(503,"Нет связи с роутером OpenRouter.") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(503,"Ответ генератора прервался. Запрос на сверке.") from exc
        if not r.is_success:
            if r.status_code in (400,401,402,403,404,422):
                router.settle(attempt,None,{"cost":0,"prompt_tokens":0,"completion_tokens":0})
            raise HTTPException(502,"Генератор не вернул иллюстрацию.")
        try:
            data=r.json(parse_float=Decimal)
            router.settle(attempt,data.get("id"),data.get("usage"))
            mime,raw=picture(data["data"][0]["b64_json"])
        except (ValueError,TypeError,KeyError,IndexError,binascii.Error) as exc:
            raise HTTPException(502,"Не удалось подтвердить файл изображения.") from exc
        with router.identity._write() as db:
            db.execute("UPDATE plugin_illustrations SET mime=?,content=? WHERE id=?",(mime,raw,art))
            grant_scope(db,token)
    return JSONResponse({"url":f"/api/chats/{chat}/illustrations/{art}"})


def routes(get_token):
    async def image(req):
        with req.app.state.identity._lock:
            db=req.app.state.identity._db
            scope=scope_for(db,get_token(req,allow_cookie=True),req.path_params["chat_id"])
            row=db.execute("SELECT mime,content FROM plugin_illustrations WHERE chat=? AND id=? AND content IS NOT NULL",
                          (scope.chat_id,req.path_params["id"])).fetchone()
        if not row:
            raise HTTPException(404)
        return Response(row[1],media_type=row[0],headers={"X-Content-Type-Options":"nosniff"})
    return [Route("/api/chats/{chat_id}/illustrations/{id}",image)]
