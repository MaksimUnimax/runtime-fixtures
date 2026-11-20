"""Optional OpenRouter transport. Direct DeepSeek has no dependency on this endpoint."""
import asyncio
import contextlib
import hashlib
import json
import os
import re
import socket
import time
from decimal import Decimal, InvalidOperation, ROUND_CEILING
from pathlib import Path
from uuid import uuid4

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from . import coins, provider_keys
from .identity import _principal

BASE = "https://openrouter.ai/api/v1"
MODEL = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.:-]+")
TABLES = (
    "CREATE TABLE IF NOT EXISTS model_preferences(workspace TEXT PRIMARY KEY REFERENCES workspaces, model TEXT NOT NULL)",
    """CREATE TABLE IF NOT EXISTS operation_routes(operation_id TEXT PRIMARY KEY REFERENCES usage_operations,
       model TEXT NOT NULL, input_rate TEXT NOT NULL, output_rate TEXT NOT NULL, request_rate TEXT NOT NULL)""",
)

def amount(raw):
    if isinstance(raw, bool) or raw is None:
        raise ValueError("Missing amount")
    try:
        d = Decimal(str(raw))
        if not d.is_finite() or not 0 <= d <= 1000:
            raise ValueError("Invalid amount")
        return d
    except InvalidOperation as exc:
        raise ValueError("Invalid amount") from exc

def catalog_rows(data):
    models = {}
    for row in data["data"]:
        try:
            model, price = row["id"], row["pricing"]
            if (not MODEL.fullmatch(model) or model.startswith("openrouter/") or ":free" in model
                    or "tools" not in row.get("supported_parameters", [])
                    or row["architecture"].get("output_modalities") != ["text"]):
                continue
            rates = [amount(price[k]) for k in ("prompt","completion")] + [amount(price.get("request",0))]
            if not all(rates[:2]) or any(amount(price.get(k,0)) > rates[0] for k in ("input_cache_read","input_cache_write")):
                continue
            models[model] = {"id":model,"name":row["name"],"family":model.split("/",1)[0],
                             "rates":[str(r) for r in rates]}
        except (KeyError, ValueError, TypeError):
            continue
    if not models:
        raise ValueError("Empty catalog")
    return models

class ModelRouter:
    def __init__(self, identity, http, key):
        self.identity, self.http, self.key = identity, http, key
        self.catalog, self.expires, self.refresh = {}, 0, asyncio.Lock()
        self.active, self.total = {}, 0
        with identity._write() as db:
            for sql in TABLES:
                db.execute(sql)

    async def models(self):
        if time.monotonic() >= self.expires:
            async with self.refresh:
                if time.monotonic() >= self.expires:
                    try:
                        res = await self.http.get(BASE+"/models",timeout=8)
                        res.raise_for_status()
                        self.catalog = catalog_rows(res.json())
                        self.expires = time.monotonic()+600
                    except (httpx.HTTPError,ValueError,TypeError,KeyError):
                        self.expires = time.monotonic()+30
        return self.catalog

    def preference(self, token, model=None):
        with self.identity._write() as db:
            _, ws = _principal(db,token)
            if model is not None:
                if model != "direct" and (not isinstance(model,str) or model not in self.catalog):
                    raise HTTPException(400,"Модель недоступна")
                db.execute("INSERT INTO model_preferences VALUES(?,?) ON CONFLICT(workspace) DO UPDATE SET model=excluded.model",(ws,model))
            row = db.execute("SELECT model FROM model_preferences WHERE workspace=?",(ws,)).fetchone()
            return row[0] if row else "direct"

    def uses_router(self, workspace):
        with self.identity._lock:
            return self.identity._db.execute("SELECT 1 FROM model_preferences WHERE workspace=? AND model!='direct'",(workspace,)).fetchone() is not None

    def bind(self, db, scope, operation):
        row = db.execute("SELECT model FROM operation_routes WHERE operation_id=?",(operation,)).fetchone()
        if row:
            return None if row[0]=="direct" else row[0]
        pref = db.execute("SELECT model FROM model_preferences WHERE workspace=?",(scope.workspace_id,)).fetchone()
        model = pref[0] if pref else "direct"
        rates = ["0"]*3
        if not self.available():
            model = "direct"
        if model != "direct":
            if model not in self.catalog:
                raise HTTPException(503,"Каталог модели недоступен. Выберите DeepSeek в настройках.")
            rates = self.catalog[model]["rates"]
        db.execute("INSERT INTO operation_routes VALUES(?,?,?,?,?)",(operation, model,*rates))
        return None if model=="direct" else model

    def reserve(self, grant, request):
        digest = hashlib.sha256(grant.encode()).hexdigest()
        with self.identity._write() as db:
            row = db.execute("""SELECT o.operation_id,o.workspace_id,o.cap,r.fx_e4,m.model,m.input_rate,m.output_rate,m.request_rate
                FROM usage_grants g JOIN coin_orders o USING(operation_id) JOIN coin_ruble_orders r USING(operation_id)
                JOIN operation_routes m USING(operation_id) JOIN workspace_paid_model_access p USING(workspace_id)
                WHERE g.token_hash=? AND g.expires_at>unixepoch() AND o.closed=0 AND m.model!='direct'""",(digest,)).fetchone()
            if not row:
                raise HTTPException(403)
            op,ws,cap,fx,model,ir,orr,rr = row
            if self.total >= 32 or self.active.get(ws,0)>=2:
                raise HTTPException(429)
            used, = db.execute("SELECT COALESCE(SUM(COALESCE(charge,bound)),0) FROM coin_attempts WHERE operation_id=?",(op,)).fetchone()
            available = min(cap-used,coins.balances(db,ws)[0])
            ir,orr,rr = map(Decimal,(ir,orr,rr))
            scale = Decimal(fx)*coins.UNIT/10000
            base = (len(json.dumps(request,ensure_ascii=False).encode()) + 1024 + 32*len(request["messages"]))*ir + rr
            max_out = min(4096,int((available/scale-base)//orr))
            if max_out < 1:
                db.execute("UPDATE coin_orders SET budget_hit=1 WHERE operation_id=?",(op,))
                return None
            bound = int(((base+max_out*orr)*scale).to_integral_value(rounding=ROUND_CEILING))
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
            if charge > row[0]:
                return
            counts = {"input_tokens":prompt-cache,"cache_read_input_tokens":cache,
                      "cache_creation_input_tokens":0,"output_tokens":out}
            db.execute("UPDATE coin_attempts SET charge=?,usage_json=?,evidence=? WHERE attempt_id=? AND charge IS NULL",
                       (charge,json.dumps(counts),"openrouter-usd:"+str(cost),aid))

    async def reconcile(self):
        while True:
            await asyncio.sleep(30)
            with self.identity._lock:
                rows = self.identity._db.execute("""SELECT attempt_id,provider_id FROM coin_attempts
                    WHERE rate_version='openrouter-v1' AND charge IS NULL AND provider_id IS NOT NULL
                    ORDER BY started_ms LIMIT 50""").fetchall()
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

    def available(self):
        return bool(provider_keys.read("openrouter") or self.key)

    @property
    def headers(self):
        key=provider_keys.read("openrouter") or self.key
        if not key:
            raise HTTPException(503,"OpenRouter не настроен")
        return {"Authorization":"Bearer "+key}

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
            r = await self.http.post(BASE+"/chat/completions",headers=self.headers,json=request,timeout=90)
            if r.status_code in (400,401,402,403,404,422,429):
                self.settle(aid,None,{"cost":"0","prompt_tokens":0,"completion_tokens":0})
            if not r.is_success:
                raise HTTPException(502)
            data = r.json(parse_float=Decimal)
            self.settle(aid,data.get("id"),data.get("usage"))
            choice = data["choices"][0]
            return JSONResponse({"message":choice["message"],"finish_reason":choice["finish_reason"]})
        except (httpx.HTTPError,KeyError,IndexError,ValueError,TypeError):
            raise HTTPException(502) from None
        finally:
            self.total-=1
            self.active[ws]-=1
            if not self.active[ws]:
                del self.active[ws]

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
    router = ModelRouter(identity,http,key)
    app = Starlette(routes=[Route("/complete",router.complete,methods=["POST"])])
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

def routes(get_token,body):
    async def models(req):
        router = req.app.state.model_router
        token = get_token(req,allow_cookie=True)
        req.app.state.identity.validate_session(token)
        if router is None or not router.available():
            return JSONResponse({"enabled":False,"model":"direct","models":[]})
        catalog = await router.models()
        selected = None
        if req.method=="POST":
            selected=(await body(req,"model"))["model"]
            if not isinstance(selected,str):
                raise ValueError("Invalid model")
        return JSONResponse({"enabled":True,"model":router.preference(token,selected),"models":[
            {k:m[k] for k in ("id","family","name")} for m in catalog.values()]})
    return [Route("/api/model-settings",models,methods=["GET","POST"])]
