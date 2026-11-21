"""Optional OpenRouter transport. Direct DeepSeek has no dependency on this endpoint."""
import asyncio
import contextlib
import hashlib
from urllib.parse import urlsplit
from email.utils import parsedate_to_datetime
import json
import os
import re
import socket
import time
from decimal import Decimal, ROUND_CEILING
from pathlib import Path
from uuid import uuid4

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from . import coins, provider_keys, model_choices
from .model_choices import catalog_rows, amount
from .operation_grants import extend_marketplace_wait, renew_marketplace_grant
from .identity import _principal
from .user_plugins import illustrations

BASE = "https://openrouter.ai/api/v1"
TABLES = (
    "CREATE TABLE IF NOT EXISTS model_preferences(workspace TEXT PRIMARY KEY REFERENCES workspaces, model TEXT NOT NULL)",
    """CREATE TABLE IF NOT EXISTS operation_routes(operation_id TEXT PRIMARY KEY REFERENCES usage_operations,
       model TEXT NOT NULL, input_rate TEXT NOT NULL, output_rate TEXT NOT NULL, request_rate TEXT NOT NULL)""",
)

def egress_client():
    address = os.getenv("OPENROUTER_PROXY_URL","").strip()
    try:
        proxy = urlsplit(address)
        if (proxy.scheme not in ("http","https") or not proxy.hostname or not proxy.port
                or proxy.path not in ("","/") or proxy.query or proxy.fragment or proxy.username or proxy.password):
            return None
        return httpx.AsyncClient(proxy=address, trust_env=False, follow_redirects=False)
    except (ValueError,httpx.InvalidURL):
        return None


class ModelRouter:
    def __init__(self, identity, http, key):
        self.identity, self.http, self.key = identity, http, key
        self.catalog, self.expires, self.refresh = {}, 0, asyncio.Lock()
        self.catalog_key = None
        self.loaded_at = None
        self.next_manual = 0
        self.catalog_message = ""
        self.active, self.total = {}, 0
        with identity._write() as db:
            for sql in (*TABLES,*model_choices.SCHEMA):
                db.execute(sql)

    async def models(self, refresh=False):
        async with self.refresh:
            if self.http is None or not self.credential():
                self.catalog = {}
                self.loaded_at = None
                self.catalog_message = "Настройте адрес роутера OpenRouter." if self.http is None else "Ключ OpenRouter ещё не настроен."
                return self.catalog
            headers = self.headers
            key_id = hashlib.sha256(headers["Authorization"].encode()).digest()
            if key_id != self.catalog_key:
                self.catalog_key, self.catalog, self.expires, self.loaded_at = key_id, {}, 0, None
            if time.monotonic() < self.expires and (not refresh or time.monotonic() < self.next_manual):
                return self.catalog

            self.next_manual = time.monotonic() + 3
            retry_after = 30
            try:
                response = await self.http.get(BASE + "/models/user", headers=headers, timeout=8)
                response.raise_for_status()
                self.catalog = catalog_rows(response.json())
                if any(row["image"] for row in self.catalog.values()):
                    try:
                        images = await self.http.get(BASE + "/images/models",headers=headers,timeout=8)
                        images.raise_for_status()
                        image_ids = {m["id"] for m in images.json()["data"]}
                    except (httpx.HTTPError,ValueError,TypeError,KeyError):
                        image_ids = set()
                    for row in self.catalog.values():
                        row["image"] = row["image"] and row["id"] in image_ids and bool(row["imagePrice"] or row["free"])
                self.loaded_at = int(time.time())
                self.catalog_message = "" if self.catalog else "У этого ключа OpenRouter нет подходящих моделей для чата с инструментами."
                retry_after = 60
            except httpx.HTTPStatusError as error:
                status = error.response.status_code
                if status in (401, 403):
                    self.catalog = {}
                self.catalog_message = {
                    401: "OpenRouter отклонил ключ сервиса (HTTP 401).",
                    403: "OpenRouter запретил серверу доступ к каталогу моделей (HTTP 403).",
                }.get(status, f"Не удалось обновить каталог OpenRouter (HTTP {status}).")
            except (httpx.RequestError, ValueError, TypeError, KeyError):
                self.catalog_message = "Не удалось получить каталог моделей OpenRouter."
            if self.catalog_message:
                self.catalog = {k:v for k,v in self.catalog.items() if not v["free"]}
            if headers["Authorization"] != "Bearer " + self.credential():
                self.catalog, self.expires, self.loaded_at = {}, 0, None
                self.catalog_message = "Ключ OpenRouter изменился. Обновите список моделей."
                return self.catalog
            self.expires = time.monotonic() + retry_after
            return self.catalog

    def uses_router(self, workspace):
        with self.identity._lock:
            return model_choices.selection(self.identity._db,workspace)[0] != "direct"

    def bind(self, db, scope, operation, override=None):
        row = db.execute("SELECT model,input_rate,output_rate,request_rate FROM operation_routes WHERE operation_id=?",(operation,)).fetchone()
        if row:
            return (None,False) if row[0]=="direct" else (row[0],not any(map(Decimal,row[1:])))
        model,effort,free,*_ = model_choices.selection(db,scope.workspace_id)
        if override is not None:
            model,effort,free = override
        rates = ["0"]*3
        if model != "direct":
            entry = self.catalog.get(model)
            if not self.available() or not entry or not entry["chat"] or (free and not entry["free"]):
                raise HTTPException(503,"Выбранная модель или её тариф сейчас недоступны. Обновите список моделей.")
            rates,free = entry["rates"],entry["free"]
        db.execute("INSERT INTO operation_routes VALUES(?,?,?,?,?)",(operation,model,*rates))
        db.execute("INSERT INTO operation_model_efforts VALUES(?,?)",(operation,effort))
        return (None,False) if model=="direct" else (model,free)

    def reserve(self, grant, request):
        digest = hashlib.sha256(grant.encode()).hexdigest()
        with self.identity._write() as db:
            row = db.execute("""SELECT o.operation_id,o.workspace_id,o.cap,r.fx_e4,m.model,m.input_rate,m.output_rate,m.request_rate,
                EXISTS(SELECT 1 FROM workspace_paid_model_access p WHERE p.workspace_id=o.workspace_id),e.effort
                FROM usage_grants g JOIN coin_orders o USING(operation_id) JOIN coin_ruble_orders r USING(operation_id)
                JOIN operation_routes m USING(operation_id) LEFT JOIN operation_model_efforts e USING(operation_id)
                WHERE g.token_hash=? AND g.expires_at>unixepoch() AND o.closed=0 AND m.model!='direct'""",(digest,)).fetchone()
            if not row:
                raise HTTPException(403)
            op,ws,cap,fx,model,ir,orr,rr,paid,effort = row
            if self.total >= 32 or self.active.get(ws,0)>=2:
                raise HTTPException(429)
            used, = db.execute("SELECT COALESCE(SUM(COALESCE(charge,bound)),0) FROM coin_attempts WHERE operation_id=?",(op,)).fetchone()
            available = min(cap-used,coins.balances(db,ws)[0])
            ir,orr,rr = map(Decimal,(ir,orr,rr))
            max_out,bound=4096,0
            if any((ir,orr,rr)):
                if not paid:
                    raise HTTPException(403)
                scale = Decimal(fx)*coins.UNIT/10000
                base = (len(json.dumps(request,ensure_ascii=False).encode()) + 1024 + 32*len(request["messages"]))*ir + rr
                max_out = min(4096,int((available/scale-base)//orr))
                if max_out < 1:
                    db.execute("UPDATE coin_orders SET budget_hit=1 WHERE operation_id=?",(op,))
                    return None
                bound = int(((base+max_out*orr)*scale).to_integral_value(rounding=ROUND_CEILING))
            if effort and effort != "auto":
                request["reasoning"]={"effort":effort}
            aid = uuid4().hex
            db.execute("""INSERT INTO coin_attempts(attempt_id,operation_id,bound,model,started_ms,rate_version,period)
                VALUES(?,?,?,?,?,'openrouter-v1','provider')""",(aid,op,bound,model,int(time.time()*1000)))
            request.update(model=model,max_tokens=max_out,provider={"require_parameters":True,
               "max_price":{"prompt":float(ir*1000000),"completion":float(orr*1000000),"request":float(rr)}})
            return ws,aid

    def settle(self, aid, generation, usage):
        with self.identity._write() as db:
            row = db.execute("""SELECT bound,fx_e4 FROM coin_attempts JOIN coin_ruble_orders USING(operation_id)
                WHERE attempt_id=? AND charge IS NULL AND rate_version='openrouter-v1'""",(aid,)).fetchone()
            if not row:
                return
            if isinstance(generation,str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,200}",generation):
                db.execute("UPDATE coin_attempts SET provider_id=? WHERE attempt_id=?",(generation,aid))
            try:
                cost = amount(usage["cost"])
                prompt,out = usage["prompt_tokens"],usage["completion_tokens"]
                cache = (usage.get("prompt_tokens_details") or {}).get("cached_tokens",0)
                if any(type(v) is not int or v<0 for v in (prompt,out,cache)) or cache>prompt:
                    return
            except (KeyError,TypeError,ValueError):
                return
            charge = int((cost*row[1]*coins.UNIT/10000).to_integral_value(rounding=ROUND_CEILING))
            if row[0] == 0:
                charge = 0
            if charge > row[0]:
                return
            counts = {"input_tokens":prompt-cache,"cache_read_input_tokens":cache,
                      "cache_creation_input_tokens":0,"output_tokens":out}
            db.execute("UPDATE coin_attempts SET charge=?,usage_json=?,evidence=? WHERE attempt_id=? AND charge IS NULL",
                       (charge,json.dumps(counts),"openrouter-usd:"+str(cost),aid))

    async def reconcile(self):
        while True:
            await asyncio.sleep(30)
            await self.reconcile_once()

    async def reconcile_once(self):
        with self.identity._lock:
            rows = self.identity._db.execute("""SELECT attempt_id,provider_id FROM coin_attempts
                WHERE rate_version='openrouter-v1' AND charge IS NULL AND provider_id IS NOT NULL
                ORDER BY started_ms LIMIT 50""").fetchall()
        if not self.available():
            return
        for aid,gid in rows:
            try:
                r = await self.http.get(BASE+"/generation",params={"id":gid},headers=self.headers,timeout=8)
                r.raise_for_status()
                d = r.json(parse_float=Decimal)["data"]
                if d.get("id") == gid:
                    self.settle(aid,gid,{"cost":d["total_cost"],"prompt_tokens":d["native_tokens_prompt"],
                        "completion_tokens":d["native_tokens_completion"],
                        "prompt_tokens_details":{"cached_tokens":d.get("native_tokens_cached") or 0}})
            except (httpx.HTTPError,KeyError,ValueError,TypeError):
                continue

    def credential(self):
        return provider_keys.read("openrouter") or self.key

    def available(self):
        return bool(self.credential()) and self.http is not None

    @property
    def headers(self):
        key=self.credential()
        if not key:
            raise HTTPException(503,"OpenRouter не настроен")
        return {"Authorization":"Bearer "+key}

    async def streamed_choice(self,response,aid,live):
        generation=None
        parts,calls=[],{}
        finish=None
        received_end=False
        async for line in response.aiter_lines():
            if not line.startswith("data:"): continue
            payload=line[5:].strip()
            if payload=="[DONE]":
                received_end=True
                break
            d=json.loads(payload,parse_float=Decimal)
            if "error" in d: raise ValueError("Provider stream failed")
            gid=d.get("id")
            if gid and not generation:
                generation=gid
                self.settle(aid,generation,None)
            if d.get("usage") is not None: self.settle(aid,generation,d["usage"])
            for choice in d.get("choices",[]):
                if choice.get("index",0)!=0: continue
                delta=choice.get("delta") or {}
                if delta.get("reasoning") and live and live.stage!="thinking":
                    live.set({"stage":"thinking"})
                if text:=delta.get("content"):
                    parts.append(text)
                    if live: live.set({"stage":"writing","text":text})
                for piece in delta.get("tool_calls") or []:
                    if live and live.stage!="tool": live.set({"stage":"tool"})
                    call=calls.setdefault(piece["index"],{"type":"function","id":"","function":{"name":"","arguments":""}})
                    if piece.get("id"): call["id"]=piece["id"]
                    for k in ("name","arguments"):
                        call["function"][k]+=(piece.get("function") or {}).get(k) or ""
                finish=choice.get("finish_reason") or finish
        if not received_end or finish not in ("stop","length","tool_calls"): raise ValueError("Incomplete stream")
        return {"message":{"role":"assistant","content":"".join(parts),"tool_calls":[calls[i] for i in sorted(calls)]},"finish_reason":finish}

    async def complete(self, req):
        token = req.headers.get("x-operation","")
        if not re.fullmatch(r"[A-Za-z0-9_-]{43}",token):
            raise HTTPException(403)
        raw = await req.body()
        if len(raw)>2_000_000:
            raise HTTPException(413)
        request = json.loads(raw)
        if not isinstance(request,dict) or not isinstance(request.get("messages"),list) or request.keys()-{"messages","tools"}:
            raise HTTPException(400)
        reservation = self.reserve(token,request)
        if reservation is None:
            raise HTTPException(402)
        ws,aid = reservation
        self.active[ws]=self.active.get(ws,0)+1
        self.total+=1
        try:
            live=None
            if hub:=getattr(self,"progress",None):
                from .storage import Scope
                with self.identity._lock:
                    row=self.identity._db.execute("""SELECT actor_id,workspace_id,chat_id,run_key FROM usage_operations
                        JOIN coin_attempts USING(operation_id) WHERE attempt_id=?""",(aid,)).fetchone()
                if row: live=hub.turns.get((Scope(*row[:3]),row[3]))
            request.update(stream=True,stream_options={"include_usage":True})
            while True:
                result,delay = await self.send_attempt(request,aid,live)
                if delay is None:
                    return result
                try:
                    await self.wait_limit(token,req,delay)
                except (HTTPException,asyncio.CancelledError):
                    self.settle(aid,None,{"cost":0,"prompt_tokens":0,"completion_tokens":0})
                    raise
        except (httpx.ProxyError,httpx.ConnectError):
            self.settle(aid,None,{"cost":0,"prompt_tokens":0,"completion_tokens":0})
            raise HTTPException(503,"Нет связи с роутером OpenRouter.") from None
        except (httpx.HTTPError,KeyError,IndexError,ValueError,TypeError):
            raise HTTPException(502) from None
        finally:
            self.total-=1
            self.active[ws]-=1
            if not self.active[ws]:
                del self.active[ws]

    async def wait_limit(self,token,request,delay):
        if not isinstance(delay,(int,float)):
            delay=retry_seconds(delay)
        digest=hashlib.sha256(token.encode()).hexdigest()
        now=int(time.time()*1000)
        with self.identity._lock:
            row=self.identity._db.execute("SELECT deadline_ms FROM marketplace_retry_windows WHERE token_hash=?",(digest,)).fetchone()
        deadline=(row and row[0]) or now+120000
        until=now+int(delay*1000)
        if not extend_marketplace_wait(self.database_path,digest,deadline,until,now):
            raise HTTPException(409,"Ожидание запроса завершено.")
        from .storage import Scope
        with self.identity._lock:
            row=self.identity._db.execute("""SELECT actor_id,workspace_id,chat_id,run_key FROM usage_grants
                JOIN usage_operations USING(operation_id) WHERE token_hash=?""",(digest,)).fetchone()
        hub=getattr(self,"progress",None)
        live=hub.turns.get((Scope(*row[:3]),row[3])) if row and hub else None
        cancel=asyncio.Event()
        if live:
            live.cancel_wait=cancel
            live.set({"stage":"model_wait"})
        try:
            while True:
                if cancel.is_set() or await request.is_disconnected() or not renew_marketplace_grant(self.database_path,digest,int(time.time())):
                    raise HTTPException(409,"Ожидание запроса отменено.")
                remaining=until/1000-time.time()
                if remaining<=0:
                    return
                try:
                    await asyncio.wait_for(cancel.wait(), min(remaining,3))
                except TimeoutError:
                    pass
        finally:
            if live:
                live.cancel_wait=None
                live.set({"stage":"tool"})

    async def send_attempt(self,request,aid,live):
        async with self.http.stream("POST",BASE+"/chat/completions",headers=self.headers,json=request,timeout=90) as r:
            if r.status_code == 429:
                delay = retry_seconds(r.headers.get("retry-after"))
                return None,delay
            if r.status_code in (400,401,402,403,404,422):
                self.settle(aid,None,{"cost":"0","prompt_tokens":0,"completion_tokens":0})
            if not r.is_success: raise HTTPException(502)
            if "text/event-stream" in r.headers.get("content-type",""):
                return JSONResponse(await self.streamed_choice(r,aid,live)),None
            await r.aread()
            data = r.json(parse_float=Decimal)
            self.settle(aid,data.get("id"),data.get("usage"))
            choice=data["choices"][0]
            if live and isinstance(choice["message"].get("content"),str):
                live.set({"stage":"writing","text":choice["message"]["content"]})
            return JSONResponse({"message":choice["message"],"finish_reason":choice["finish_reason"]}),None


def retry_seconds(value):
    try:
        if value and value.strip().isdigit():
            return max(1,int(value))
        if value:
            return max(1,parsedate_to_datetime(value).timestamp()-time.time())
    except (ValueError,TypeError,OverflowError):
        pass
    return 5


class LocalServer(uvicorn.Server):
    @contextlib.contextmanager
    def capture_signals(self):
        yield

@contextlib.asynccontextmanager
async def activate(identity, http, worker):
    path = os.getenv("HARNESS_OPENROUTER_KEY_FILE")
    if os.getenv("HARNESS_OPENROUTER_ENABLED","0")!="1" or not worker.gateway:
        yield None
        return
    try:
        key = Path(path).read_text().strip() if path else ""
    except (OSError,UnicodeError):
        key = ""
    if not key and not provider_keys.directory():
        yield None
        return
    http = egress_client()
    router = ModelRouter(identity,http,key)
    router.database_path = worker.database_path
    async def image_action(req):
        return await illustrations.create(router,req)
    app = Starlette(routes=[Route("/complete",router.complete,methods=["POST"]),Route("/illustrate",image_action,methods=["POST"])])
    server = LocalServer(uvicorn.Config(app,access_log=False,log_level="warning",lifespan="off"))
    with socket.socket() as sock:
        sock.bind(("127.0.0.1",0))
        sock.listen()
        task = asyncio.create_task(server.serve(sockets=[sock]))
        reconcile = asyncio.create_task(router.reconcile())
        worker.env["HARNESS_ROUTER_LOCAL"] = "http://127.0.0.1:"+str(sock.getsockname()[1])
        worker.router = router
        try:
            yield router
        finally:
            server.should_exit=True
            reconcile.cancel()
            await asyncio.gather(task,reconcile,return_exceptions=True)
            if http is not None:
                await http.aclose()

def routes(get_token,body):
    async def models(req):
        router = req.app.state.model_router
        token = get_token(req,allow_cookie=True)
        req.app.state.identity.validate_session(token)
        if router is None:
            return JSONResponse({"enabled":False,"model":"direct","models":[]})
        fields = await body(req,"model",optional=("revision",)) if req.method=="POST" else None
        catalog = await router.models(refresh=req.query_params.get("refresh")=="1")
        with router.identity._write() as db:
            _,workspace = _principal(db,token)
            if fields is not None:
                if not isinstance(fields["model"],str):
                    raise ValueError("Invalid model")
                model_choices.save_choice(db,workspace,fields["model"],fields.get("revision",0),catalog)
            model,effort,free,revision,inherited=model_choices.selection(db,workspace)
        choice_message=""
        confirm_tariff=False
        if model!="direct":
            entry=catalog.get(model,{})
            if not entry.get("chat"):
                choice_message="Выбранная модель сейчас недоступна. Обновите каталог или выберите другую модель."
            elif free and not entry.get("free"):
                confirm_tariff=True
                choice_message="Бесплатный тариф выбранной модели закончился. Выберите другую модель или подтвердите новый тариф."
        return JSONResponse({"enabled":router.available(),"model":model,"revision":revision,"inherited":inherited,
                "catalogAt":router.loaded_at,"catalogMessage":router.catalog_message,"choiceMessage":choice_message,"confirmTariff":confirm_tariff,
                "models":[{k:v for k,v in m.items() if k not in ("rates","imagePrice")} for m in catalog.values()]})
    return [Route("/api/model-settings",models,methods=["GET","POST"])]
