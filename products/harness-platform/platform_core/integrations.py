"""Account-owned credentials and reviewed read-only provider methods."""
import json
import os
import re
from pathlib import Path
from uuid import uuid4

import httpx
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse
from starlette.routing import Route

from .identity import _principal
from . import chat_connections

PROVIDERS = {
    "ozon": {"title": "Ozon", "fields": {"client_id": "Client-Id продавца", "api_key": "Api-Key продавца",
             "performance_id": "Client ID Performance", "performance_secret": "Client Secret Performance"}},
    "wb": {"title": "Wildberries", "fields": {"token": "API-токен WB с доступом к нужным отчётам (например, «Аналитика» и «Статистика»)"}},
    "wordstat": {"title": "Яндекс Вордстат", "fields": {"token": "OAuth-токен с доступом к Wordstat"}},
}
KEY_GUIDES = {
    "Wildberries API": [
        "Владелец магазина открывает в профиле WB Partners раздел «Интеграции по API» и нажимает «Создать токен».",
        "Если Octoport есть в каталоге решений WB, выберите его и создайте сервисный токен. Для подключения вне каталога выберите базовый токен, укажите название Octoport, нужные категории отчётов и доступ «Только чтение». Для заказов и продаж нужна «Статистика».",
        "Скопируйте токен при создании. В Octoport нажмите «Подключения» над полем сообщения → «Добавить подключение» → «Wildberries».",
        "Введите название магазина, вставьте токен в поле «API-токен WB» и нажмите «Сохранить подключение». Магазин включится в этом чате.",
    ],
    "Ozon Seller": [
        "В Ozon Seller откройте настройки магазина, перейдите в «API-ключи» → Seller API и скопируйте Client ID продавца.",
        "Нажмите «Сгенерировать ключ», укажите название Octoport и выберите права чтения для нужных отчётов. Сгенерируйте и скопируйте ключ.",
        "В Octoport нажмите «Подключения» над полем сообщения → «Добавить подключение» → «Ozon». Введите название магазина.",
        "Вставьте Client ID в «Client-Id продавца», ключ в «Api-Key продавца» и нажмите «Сохранить подключение». Магазин включится в этом чате.",
    ],
    "Ozon Performance": [
        "В настройках Ozon откройте «API-ключи» → Performance API. Выберите сервисный аккаунт или создайте его.",
        "Откройте сервисный аккаунт, добавьте новый ключ и скопируйте Client ID и Client Secret.",
        "В Octoport нажмите «Подключения» над полем сообщения → «Добавить подключение» → «Ozon». Для существующего магазина укажите его прежнее название.",
        "Вставьте значения в «Client ID Performance» и «Client Secret Performance», затем нажмите «Сохранить подключение».",
    ],
}
SECRET_TEXT = re.compile(r'(?i)(?:["\']?(?:api[-_ ]?key|client[-_ ]?secret|performance_secret|oauth[-_ ]?(?:token|токен)|токен|token|ключ)["\']?\s*[:=]\s*["\']?[\w./+=-]{5,}|(?:eyJ[\w-]{8,}\.[\w-]+\.[\w-]+|y0_[\w-]{12,}))')
SCHEMA = """CREATE TABLE IF NOT EXISTS account_integrations(
    id TEXT PRIMARY KEY, workspace TEXT NOT NULL REFERENCES workspaces(workspace_id),
    provider TEXT NOT NULL, name TEXT NOT NULL, encrypted BLOB NOT NULL, version INTEGER NOT NULL,
    status TEXT NOT NULL, UNIQUE(workspace,provider,name))"""

def credentials(provider, fields):
    if not isinstance(provider,str) or provider not in PROVIDERS or not isinstance(fields, dict) or not fields.keys() <= PROVIDERS[provider]["fields"].keys():
        raise ValueError("Invalid integration fields")
    if any(not isinstance(v, str) or not v.isascii() or not v.isprintable() or not 1 <= len(v.strip()) <= 8192 for v in fields.values()):
        raise ValueError("Invalid credential")
    fields = {k: v.strip() for k, v in fields.items()}
    if provider == "ozon":
        if not fields or any((a in fields) != (b in fields) for a,b in
                (("client_id","api_key"),("performance_id","performance_secret"))):
            raise ValueError("Incomplete credential pair")
    elif set(fields) != {"token"}:
        raise ValueError("Missing token")
    return fields

class IntegrationStore:
    def __init__(self, identity):
        self.identity = identity
        with identity._write() as db:
            db.execute(SCHEMA)
            db.execute(chat_connections.SCHEMA)

    def _cipher(self):
        try:
            return AESGCM(Path(os.environ["HARNESS_INTEGRATIONS_KEY_FILE"]).read_bytes())
        except (KeyError, OSError, ValueError):
            raise HTTPException(503, "Хранилище ключей недоступно") from None

    def list(self, token):
        with self.identity._lock:
            db = self.identity._db
            _, ws = _principal(db, token)
            rows = db.execute("SELECT id,provider,name,status FROM account_integrations WHERE workspace=? ORDER BY name,id", (ws,))
            return {"providers": PROVIDERS, "keyGuides": KEY_GUIDES, "connections": [dict(zip(("id","provider","name","status"),row)) for row in rows]}

    def save(self, token, provider, name, fields, chatId=None):
        fields = credentials(provider, fields)
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or not name.isprintable():
            raise ValueError("Invalid connection name")
        name = name.strip()
        with self.identity._write() as db:
            _, ws = _principal(db, token)
            row = db.execute("SELECT id,encrypted FROM account_integrations WHERE workspace=? AND provider=? AND name=?", (ws,provider,name)).fetchone()
            cid = row[0] if row else uuid4().hex
            aad = json.dumps([ws,provider,cid]).encode()
            cipher = self._cipher()
            if row and provider == "ozon":
                previous = json.loads(cipher.decrypt(row[1][:12], row[1][12:], aad))
                fields = previous | fields
            nonce = os.urandom(12)
            sealed = nonce + cipher.encrypt(nonce,json.dumps(fields).encode(),aad)
            db.execute("""INSERT INTO account_integrations VALUES(?,?,?,?,?,1,'saved')
                ON CONFLICT(workspace,provider,name) DO UPDATE SET encrypted=excluded.encrypted,
                version=version+1,status='saved'""",(cid,ws,provider,name,sealed))
            if chatId is not None:
                scope=chat_connections.scope_for(db,token,chatId)
                chat_connections.attach(db,scope,cid,True)
        return {"id":cid, "status":"saved"}

    def open(self, token, cid):
        with self.identity._lock:
            db = self.identity._db
            _, ws = _principal(db, token)
            row = db.execute("SELECT provider,version,encrypted FROM account_integrations WHERE workspace=? AND id=?", (ws,cid)).fetchone()
            if not row:
                raise HTTPException(404,"Подключение не найдено")
            provider, version, sealed = row
            aad = json.dumps([ws,provider,cid]).encode()
            return provider, version, json.loads(self._cipher().decrypt(sealed[:12],sealed[12:],aad))

    def status(self, token, cid, version, status):
        with self.identity._write() as db:
            _, ws = _principal(db, token)
            if not db.execute("UPDATE account_integrations SET status=? WHERE id=? AND workspace=? AND version=?",
                              (status,cid,ws,version)).rowcount:
                raise HTTPException(409,"Ключи изменились. Повторите проверку.")

async def probe(client, provider, f):
    calls = []
    if provider == "ozon":
        if "client_id" in f:
            calls.append(("Seller", "POST","https://api-seller.ozon.ru/v1/roles",
                          {"headers":{"Client-Id":f["client_id"],"Api-Key":f["api_key"]},"json":{}}))
        if "performance_id" in f:
            calls.append(("Performance","POST","https://api-performance.ozon.ru/api/client/token",
                         {"json":{"client_id":f["performance_id"],"client_secret":f["performance_secret"],"grant_type":"client_credentials"}}))
    elif provider == "wb":
        calls.append(("Статистика","GET","https://statistics-api.wildberries.ru/ping",{"headers":{"Authorization":f["token"]}}))
    else:
        calls.append(("Wordstat","POST","https://api.wordstat.yandex.net/v1/getRegionsTree",{"headers":{"Authorization":"Bearer "+f["token"]},"json":{}}))
    results = {}
    for label, method, url, options in calls:
        try:
            reply = await client.request(method,url,**options)
            if reply.is_success:
                data = reply.json()
                passed = {"Seller":lambda: isinstance(data.get("roles"),list),
                          "Performance":lambda: bool(data.get("access_token")),
                          "Статистика":lambda: data.get("Status",data.get("status"))=="OK",
                          "Wordstat":lambda: bool(data) and (isinstance(data,list) or (isinstance(data,dict) and "error" not in data))}
                results[label] = "verified" if passed[label]() else "unconfirmed"
            else:
                results[label] = "denied" if reply.status_code in (401,403) else "unconfirmed"
        except (httpx.HTTPError,ValueError,TypeError,AttributeError):
            results[label] = "unconfirmed"
    return results

def routes(get_token, body):
    async def collection(req):
        token = get_token(req,allow_cookie=True)
        store = req.app.state.integrations
        if req.method == "GET":
            return JSONResponse(store.list(token))
        data = await body(req,"provider","name","fields",optional=("chatId",))
        return JSONResponse(store.save(token,**data))
    async def check(req):
        token = get_token(req,allow_cookie=True)
        store, cid = req.app.state.integrations, req.path_params["cid"]
        provider, version, fields = store.open(token,cid)
        results = await probe(req.app.state.http,provider,fields)
        status = "verified" if all(v=="verified" for v in results.values()) else "unconfirmed"
        store.status(token,cid,version,status)
        return JSONResponse({"status":status,"checks":results})
    async def semantics(req):
        token = get_token(req,allow_cookie=True)
        data = await body(req,"phrase")
        provider, _, fields = req.app.state.integrations.open(token,req.path_params["cid"])
        phrase = data["phrase"]
        if provider != "wordstat" or not isinstance(phrase,str) or not 1 <= len(phrase.strip()) <= 200:
            raise ValueError("Invalid phrase")
        try:
            r = await req.app.state.http.post("https://api.wordstat.yandex.net/v1/topRequests",
                    headers={"Authorization":"Bearer "+fields["token"]},json={"phrase":phrase})
            r.raise_for_status()
            rows = r.json()["topRequests"]
            return JSONResponse({"rows":[{"phrase":row["phrase"],"count":row["count"]} for row in rows[:100]]})
        except (httpx.HTTPError,KeyError,TypeError,ValueError):
            raise HTTPException(502,"Wordstat не вернул данные. Проверьте доступ и квоту.") from None
    return [Route("/api/integrations",collection,methods=["GET","POST"]),
            Route("/api/integrations/{cid}/check",check,methods=["POST"]),
            Route("/api/integrations/{cid}/semantics",semantics,methods=["POST"])]
