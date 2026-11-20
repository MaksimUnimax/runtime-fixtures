"""Explicit grants to use account connections in individual Harness conversations."""
import asyncio
import json
import os
from pathlib import Path

import httpx
from cryptography.exceptions import InvalidTag
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

def scope_for(db,token,chat):
    actor,ws=_principal(db,token)
    scope=Scope(actor,ws,chat)
    if not _owns_chat(db,scope):
        raise HTTPException(404,"Чат недоступен")
    return scope

def attach(db,scope,cid,enabled):
    row=db.execute("SELECT provider,encrypted FROM account_integrations WHERE id=? AND workspace=?",(cid,scope.workspace_id)).fetchone()
    if not row:
        raise HTTPException(404,"Подключение недоступно")
    if enabled:
        unseal(scope.workspace_id,row[0],cid,row[1])
        db.execute("INSERT OR IGNORE INTO chat_integrations VALUES(?,?)",(scope.chat_id,cid))
    else:
        db.execute("DELETE FROM chat_integrations WHERE chat_id=? AND connection_id=?",(scope.chat_id,cid))

class UnreadableCredentials(HTTPException):
    def __init__(self):
        super().__init__(409,"Сервер не может прочитать сохранённые ключи. Обновите ключи подключения.")

class VaultUnavailable(HTTPException):
    def __init__(self):
        super().__init__(503,"Хранилище ключей временно недоступно.")

def vault_cipher():
    try:
        return AESGCM(Path(os.environ["HARNESS_INTEGRATIONS_KEY_FILE"]).read_bytes())
    except (KeyError, OSError, ValueError):
        raise VaultUnavailable() from None

def unseal(ws,provider,cid,blob):
    cipher=vault_cipher()
    try:
        clear=cipher.decrypt(blob[:12],blob[12:],json.dumps([ws,provider,cid]).encode())
    except (InvalidTag,ValueError):
        raise UnreadableCredentials() from None
    return json.loads(clear)

def connection_access(ws,provider,cid,blob,status):
    try:
        fields=unseal(ws,provider,cid,blob)
    except UnreadableCredentials:
        return "reauthorize", []
    except VaultUnavailable:
        return "vault_unavailable", []
    if provider=="ozon":
        return status, [label for key,label in (("api_key","Ozon Seller"),("performance_secret","Ozon Performance")) if key in fields]
    return status, {"wb":["Wildberries API"],"wordstat":["Яндекс Вордстат"]}.get(provider,[])

def snapshot(db,scope):
    if not _owns_chat(db,scope):
        raise PermissionError("Chat unavailable")
    rows=db.execute("""SELECT c.id,c.name,c.provider,c.status,g.connection_id IS NOT NULL,c.encrypted,c.version
        FROM account_integrations c LEFT JOIN chat_integrations g ON g.connection_id=c.id AND g.chat_id=?
        WHERE c.workspace=? ORDER BY c.name,c.id""",(scope.chat_id,scope.workspace_id))
    result=[]
    for cid,name,provider,status,attached,blob,version in rows:
        status,kinds=connection_access(scope.workspace_id,provider,cid,blob,status)
        result.append(dict(id=cid,name=name,provider=provider,status=status,attached=bool(attached),access=kinds,version=version))
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

def read_service(provider, fields, action, args):
    from .integrations import probe
    if action == "check":
        async def verify():
            async with httpx.AsyncClient(timeout=9, trust_env=False) as client:
                return await probe(client, provider, fields)
        return {"checks": asyncio.run(verify())}
    if action != "wordstat" or provider != "wordstat":
        raise PermissionError("Unsupported connection operation")
    with httpx.Client(timeout=12, trust_env=False, follow_redirects=False) as client:
        response = client.post("https://api.wordstat.yandex.net/v1/topRequests",
                               json={"phrase": args["phrase"]},
                               headers={"Authorization": "Bearer " + fields["token"]})
        if not response.is_success:
            return {"ok": False, "httpStatus": response.status_code, "reason": {
                401: "Сервис отклонил ключ", 403: "Недостаточно прав на отчёт или требуется подписка",
                429: "Достигнут лимит запросов сервиса"}.get(response.status_code, "Сервис не вернул отчёт")}
        return {"topRequests": [{"phrase": item["phrase"], "count": item["count"]}
                                for item in response.json()["topRequests"][:50]]}


# Entrypoints live only in the privately scoped MCP subprocess.
class ChatTools:
    def __init__(self,store,scope):
        self.store,self.scope=store,scope

    def tools(self):
        db=self.store._db
        with self.store._lock:
            if not db.execute("SELECT 1 FROM sqlite_master WHERE name='chat_integrations'").fetchone(): return ()
            entries=[r for r in snapshot(db,self.scope) if r["attached"] and r["access"]]
        specs=[
          ("check_store_access","Проверить подключение магазина или сервиса сейчас.","check",entries,{}),
          ("wordstat_keywords","Частотность и популярные поисковые фразы Яндекс Вордстат.","wordstat",
             [r for r in entries if r["provider"]=="wordstat"],{"phrase":{"type":"string","minLength":1,"maxLength":200}})]
        from .marketplace_matrix.plugin import capability
        matrix = capability(entries)
        result = [matrix] if matrix else []
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
                if action not in ("check", provider): raise PermissionError()
                return read_service(provider,fields,action,args)
            result.append(Capability(name,description,schema,handler))
        return tuple(result)
