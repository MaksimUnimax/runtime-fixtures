#!/usr/bin/env python3
"""Private owner Alice lab: read-only marketplace queue; OAuth unchanged."""
import os, sys, json, time, secrets, hashlib, hmac, sqlite3, base64, html
import urllib.parse as U
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http import HTTPStatus
sys.path.append("/opt/alice-lab/releases/20261103-relink-r1")
import deepseek_lab as llm
sys.path.insert(0,"/opt/alice-market/releases/20261103-v09-dialogue-r7")
import alice_bridge as marketplace

VERSION="alice-lab-20261103-market-dialogue-r4"
SKILL=os.environ.get("ALICE_SKILL_ID","e1efec78-63de-43b0-87b9-0fb6ee0ed5fe")
DB=os.environ.get("LAB_DB","/var/lib/alice-lab/lab.sqlite3")
LOG=os.environ.get("LAB_LOG","/var/log/alice-lab/events.jsonl")
KEY=os.environ.get("LAB_LOG_KEY","")
CLIENT=os.environ.get("LAB_OAUTH_CLIENT_ID","dialogs-lab")
SECRET=os.environ.get("LAB_OAUTH_CLIENT_SECRET","")
PASS=os.environ.get("LAB_TEST_PASSWORD","")
LINK=os.environ.get("LINK_MODE","disabled")
REDIRECT="https://social.yandex.net/broker/redirect"
if len(KEY)<32 or len(SECRET)<32 or len(PASS)<12:
    raise RuntimeError("Missing LAB_LOG_KEY/OAUTH_CLIENT_SECRET/TEST_PASSWORD")
os.umask(0o077)

def now():return time.time()
def digest(s):return hashlib.sha256(s.encode()).hexdigest()
def hp(s):return hmac.new(KEY.encode(),str(s).encode(),hashlib.sha256).hexdigest()[:20]
def new():return secrets.token_urlsafe(32)
def db():
    c=sqlite3.connect(DB,timeout=5)
    c.row_factory=sqlite3.Row
    c.execute("PRAGMA busy_timeout=5000")
    c.execute("PRAGMA journal_mode=WAL")
    return c
def init():
    Path(DB).parent.mkdir(parents=True,exist_ok=True)
    with db() as c:c.executescript("""
    CREATE TABLE IF NOT EXISTS forms(nonce TEXT PRIMARY KEY, params TEXT NOT NULL, expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS codes(hash TEXT PRIMARY KEY, account TEXT NOT NULL, expires REAL NOT NULL, used INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY, account TEXT NOT NULL, kind TEXT NOT NULL, expires REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS replies(k TEXT PRIMARY KEY, request_hash TEXT NOT NULL, response TEXT NOT NULL, created REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, account TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL, started REAL, ready REAL, reminded TEXT, delivered INTEGER DEFAULT 0);
    """)
    os.chmod(DB,0o600)
    llm.init()
    marketplace.init_preview()

def auth_token(value):
    if not isinstance(value,str) or len(value)>2048:return None
    with db() as c:
        r=c.execute("SELECT account FROM tokens WHERE hash=? AND kind='access' AND revoked=0 AND expires>?",(digest(value),now())).fetchone()
    return r["account"] if r else None
def response(text, counter=0, end=False, linking=False):
    x={"response":{"text":text[:900],"tts":text[:900],"end_session":end},"session_state":{"counter":counter},"version":"1.0"}
    if linking and LINK=="nested":
        x["response"]["directives"]={"start_account_linking":{}}
    elif linking and LINK=="root":
        x={"start_account_linking":{},"version":"1.0"}
    return x
def log_event(category, data):
    rec={"utc":round(now(),3),"build":VERSION,"kind":category}
    rec.update(data)
    with open(LOG,"a",encoding="utf-8") as f:f.write(json.dumps(rec,ensure_ascii=False,separators=(",",":"))+"\n")

def skill(body,auth_header=""):
    if not isinstance(body,dict) or body.get("version")!="1.0":return 400,{"error":"version"},{}
    s=body.get("session",{});q=body.get("request",{});meta=body.get("meta",{})
    if not all(isinstance(x,dict) for x in (s,q,meta)):return 400,{"error":"schema"},{}
    if s.get("skill_id")!=SKILL:return 403,{"error":"skill_id"},{}
    sid=s.get("session_id");mid=s.get("message_id")
    if not isinstance(sid,str) or type(mid) is not int or not 0<=mid<=99999999:return 400,{"error":"message_id"},{}
    u=s.get("user",{}) or {}
    if not isinstance(u,dict):return 400,{"error":"user"},{}
    token=u.get("access_token","") or ""
    bearer=auth_header[7:] if isinstance(auth_header,str) and auth_header.startswith("Bearer ") else ""
    if token and bearer and not hmac.compare_digest(str(token),str(bearer)):
        return 401,{"error":"conflicting_access_tokens"},{}
    token=token or bearer
    account=auth_token(token)
    command=q.get("command","")
    if not isinstance(command,str):return 400,{"error":"command"},{}
    cmd=" ".join(command.lower().replace("ё","е").strip().split())
    state=body.get("state",{}) or {}
    count=(state.get("session",{}) or {}).get("counter",0) if isinstance(state,dict) else 0
    try:count=min(100000,int(count)+1)
    except (TypeError,ValueError):count=1
    typ=q.get("type","")
    if q.get("original_utterance")=="ping" or typ=="ping":return 200,response("Лабораторный сервер доступен."),{"ping":True}
    kind="link_complete" if "account_linking_complete_event" in body else str(typ)
    reqkey=hp(SKILL+"|"+sid+"|"+str(mid)+"|"+kind)
    bodyhash=hmac.new(KEY.encode(),json.dumps(body,sort_keys=True,ensure_ascii=False).encode(),hashlib.sha256).hexdigest()
    session=hp(sid)
    if kind!="link_complete" and marketplace.handles(cmd):
        if not account:
            answer=response("Для проверки закрытого задания свяжите учебный аккаунт.",count,linking=("account_linking" in meta.get("interfaces",{})))
        else:
            answer=response(marketplace.preview_handle(account,cmd,reqkey,bodyhash,conversation_id=hp(SKILL+"|"+sid),message_id=mid),count)
        return 200,answer,{"market_live_canary":True,"account_hmac":hp(account) if account else None,"session_hmac":session,"message_id":mid,"has_token":bool(token)}
    with db() as c:
        c.execute("BEGIN IMMEDIATE")
        previous=c.execute("SELECT request_hash,response FROM replies WHERE k=?",(reqkey,)).fetchone()
        if previous:
            if previous["request_hash"]!=bodyhash:return 409,{"error":"changed_replay"},{"replayed":True}
            return 200,json.loads(previous["response"]),{"replayed":True}
        if kind=="link_complete":
            answer=response("Учебная связка завершена. Теперь можно запросить тестовый отчёт.",count)
        elif cmd in ("проверка связи","короткий тест"):
            answer=response("Связь с учебным сервером работает. Контрольное число сто двадцать три.",count)
        elif cmd=="состояние":
            answer=response("Счётчик текущей беседы: "+str(count)+".",count)
        elif cmd=="диагностика":
            answer=response("Это лаборатория. Токен "+("проверен" if account else ("передан, но не подтверждён" if token else "не передан"))+". Реальные магазины отключены.",count)
        elif cmd=="помощь" or cmd=="что ты умеешь" or cmd=="":
            answer=response("Доступны реальные проверочные отчёты по заказанным товарам и сумме заказов Ozon и Wildberries. Скажите: сводка заказов за октябрь 2026 на Озоне, затем: результат. ДРР, прибыль и выкупы пока не подключены.",count)
        elif cmd=="проверка авторизации":
            if account:answer=response("Учебный аккаунт привязан. Реальные магазины не подключены.",count)
            elif "account_linking" in meta.get("interfaces",{}) and LINK!="disabled":
                answer=response("Свяжите тестовый аккаунт.",count,linking=True)
            else:answer=response("Связка пока недоступна. Проверьте настройки и тестовый OAuth.",count)
        elif cmd in ("длинный тест","проверь отчет","прочитай отчет","повтори отчет","другой вопрос","отмени отчет"):
            if not account:
                answer=response("Для закрытого учебного отчёта сначала свяжите тестовый аккаунт.",count,linking=("account_linking" in meta.get("interfaces",{})))
            else:
                job=c.execute("SELECT * FROM jobs WHERE account=? ORDER BY created DESC LIMIT 1",(account,)).fetchone()
                if cmd=="длинный тест":
                    if job and job["status"] in ("queued","running"):
                        answer=response("Учебное задание уже идёт. Повтор не создаёт новое.",count)
                    else:
                        c.execute("INSERT INTO jobs(id,account,status,created) VALUES(?,?,?,?)",(new(),account,"queued",now()))
                        answer=response("Учебный отчёт сохранён. Время вычисления шесть секунд. Позже скажите: проверь отчёт.",count)
                elif cmd=="отмени отчет":
                    if job and job["status"] in ("queued","running"):
                        c.execute("UPDATE jobs SET status='cancelled' WHERE id=?",(job["id"],))
                    answer=response("Подготовка учебного отчёта отменена, если она ещё шла.",count)
                elif cmd=="другой вопрос":
                    text="На другой учебный вопрос: контрольный ответ получен."
                    if job and job["status"]=="ready" and not job["delivered"] and job["reminded"]!=session:
                        text+=" Также готов учебный отчёт. Скажите: прочитай отчёт."
                        c.execute("UPDATE jobs SET reminded=? WHERE id=?",(session,job["id"]))
                    answer=response(text,count)
                elif not job:answer=response("Пока нет заказанного учебного отчёта.",count)
                elif job["status"]=="ready":
                    answer=response("Учебный отчёт готов. Контрольное число сто двадцать три. Это не данные магазина.",count)
                    c.execute("UPDATE jobs SET delivered=1 WHERE id=?",(job["id"],))
                elif job["status"] in ("queued","running"):
                    answer=response("Учебный отчёт ещё готовится. Повторный расчёт не запускается.",count)
                else:answer=response("Задание не выполнено. Его статус: "+job["status"]+".",count)
        elif cmd=="проверка нейросети":
            answer=response("Модуль DeepSeek подключён к лаборатории. Сейчас режим "+("учебной эмуляции, без списаний." if llm.MODE=="mock" else "внешнего API, требующего ключ и бюджет.")+" Для теста требуется учебная авторизация.",count)
        elif cmd.startswith(("тест дипсика ","тест нейросети ")):
            if not account:
                answer=response("Сначала свяжите учебный аккаунт. Без авторизации запросы к модели не принимаются.",count,linking=("account_linking" in meta.get("interfaces",{})))
            else:
                question=cmd.split(" ",2)[2] if cmd.count(" ")>=2 else ""
                status,jid=llm.queue(account,question,c)
                if status in ("queued","existing"):
                    answer=response("Учебный разбор принят. Скажите: результат дипсика. Модель не имеет доступа к магазинам.",count)
                elif status=="budget":
                    answer=response("Дневной бюджет тестов модели исчерпан. Новые платные запросы не запускаются.",count)
                elif status=="not_ready":
                    answer=response("Ключ DeepSeek ещё не прошёл проверку. Платный вызов отключён.",count)
                else:
                    answer=response("Не могу принять такой учебный запрос. Используйте обычную фразу без ключей и паролей.",count)
        elif cmd=="результат дипсика":
            if not account:
                answer=response("Для получения сохранённого результата повторно свяжите учебный аккаунт.",count,linking=("account_linking" in meta.get("interfaces",{})))
            else:
                j=llm.latest(account,c)
                if not j:
                    answer=response("Пока нет запущенного разбора DeepSeek.",count)
                elif j["status"]=="ready":
                    p=json.loads(j["result"])
                    answer=response("Учебный разбор готов: показатель "+p["intent"]+", период "+p["period"]+", площадка "+p["marketplace"]+". Это не финансовый отчёт.",count)
                    llm.mark_delivered(account,j["id"],c)
                elif j["status"] in ("queued","running"):
                    answer=response("Нейросеть ещё обрабатывает учебный вопрос. Повторный вызов не запускаю.",count)
                else:
                    answer=response("Учебный разбор не получен. Статус "+j["status"]+". Повтор автоматически не запускаю.",count)
        elif cmd=="выход":
            answer=response("Завершаю учебный разговор. Сохранённые задания остаются.",count,end=True)
        else:
            answer=response("Это тестовый навык. Скажите: проверка связи, помощь или длинный тест.",count)
        c.execute("INSERT INTO replies(k,request_hash,response,created) VALUES(?,?,?,?)",(reqkey,bodyhash,json.dumps(answer,ensure_ascii=False),now()))
    view={"command_class":cmd if cmd in ("проверка связи","короткий тест","состояние","диагностика","помощь","что ты умеешь","длинный тест","проверь отчет","прочитай отчет","повтори отчет","другой вопрос","отмени отчет","выход","проверка авторизации") else "other",
          "user_hmac":hp(u.get("user_id","")) if u.get("user_id") else None,"session_hmac":session,
          "account_hmac":hp(account) if account else None,"message_id":mid,"has_token":bool(token),
          "interfaces":sorted((meta.get("interfaces") or {}).keys()),"nlu_intents":sorted((q.get("nlu") or {}).get("intents",{}).keys())}
    return 200,answer,view

def worker():
    while True:
        with db() as c:
            c.execute("BEGIN IMMEDIATE")
            j=c.execute("SELECT id FROM jobs WHERE status='queued' ORDER BY created LIMIT 1").fetchone()
            if j:
                jid=j["id"];started=now()
                c.execute("UPDATE jobs SET status='running',started=? WHERE id=? AND status='queued'",(started,jid))
            else:jid=None
        if not jid:
            with db() as c:
                # Do not repeat a possibly completed external task after losing the worker.
                c.execute("UPDATE jobs SET status='unknown' WHERE status='running' AND started<?",(now()-180,))
                c.execute("DELETE FROM forms WHERE expires<?",(now()-60,))
                c.execute("DELETE FROM codes WHERE expires<?",(now()-60,))
                c.execute("DELETE FROM replies WHERE created<?",(now()-86400*2,))
                c.execute("DELETE FROM tokens WHERE expires<?",(now()-86400,))
            time.sleep(2)
            continue
        time.sleep(6)
        with db() as c:c.execute("UPDATE jobs SET status='ready',ready=? WHERE id=? AND status='running'",(now(),jid))

class Handler(BaseHTTPRequestHandler):
    server_version="AliceLab"
    def log_message(self,*a):pass
    def send(self,code,obj,headers=None,kind="application/json; charset=utf-8"):
        raw=json.dumps(obj,ensure_ascii=False).encode() if isinstance(obj,dict) else obj
        self.send_response(code)
        self.send_header("Content-Type",kind)
        self.send_header("Content-Length",str(len(raw)))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("X-Frame-Options","DENY")
        if headers:
            for k,v in headers.items():self.send_header(k,v)
        self.end_headers()
        try:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass
    def parseform(self):
        n=int(self.headers.get("Content-Length","0"))
        if n<=0 or n>16384:raise ValueError("form-length")
        return {k:v[0] for k,v in U.parse_qs(self.rfile.read(n).decode(),keep_blank_values=True).items()}
    def client_valid(self,form):
        name=form.get("client_id","")
        pwd=form.get("client_secret","")
        h=self.headers.get("Authorization","")
        if h.startswith("Basic "):
            try:name,pwd=base64.b64decode(h[6:]).decode().split(":",1)
            except Exception: return False
        return hmac.compare_digest(name,CLIENT) and hmac.compare_digest(pwd,SECRET)
    def do_GET(self):
        try:
            route=U.urlsplit(self.path); qs={k:v[0] for k,v in U.parse_qs(route.query).items()}
            if route.path=="/healthz":
                self.send(200,{"status":"ok","build":VERSION,"mode":"read-only-marketplace-canary-queue","oauth":"lab-only"});return
            if route.path=="/oauth/authorize":
                if qs.get("client_id")!=CLIENT or qs.get("redirect_uri")!=REDIRECT or qs.get("response_type")!="code" or not qs.get("state") or qs.get("scope","reports:read")!="reports:read":
                    self.send(400,{"error":"invalid_authorization_request"});return
                nonce=new()
                with db() as c:c.execute("INSERT INTO forms VALUES(?,?,?)",(digest(nonce),json.dumps(qs),now()+300))
                page=("""<!doctype html><html lang="ru"><meta charset="UTF-8"><title>Учебная связка Алисы</title><meta name="viewport" content="width=device-width,initial-scale=1"><body><main style="font:18px sans-serif;max-width:560px;margin:3rem auto"><h2>Учебный вход в лабораторию</h2><p>Только искусственные магазины. Не вводите настоящие пароли от Ozon/WB.</p><form method="post" action="/oauth/authorize"><input type="hidden" name="nonce" value="%s"><label>Учётная запись<select name="account"><option value="demo-a">Учебный A</option><option value="demo-b">Учебный B</option></select></label><p><label>Учебный пароль <input name="password" type="password" required autocomplete="off"></label></p><button type="submit">Разрешить тестовую связку</button></form></main></body></html>"""%html.escape(nonce,quote=True)).encode()
                self.send(200,page,kind="text/html; charset=utf-8");return
            self.send(404,{"error":"not_found"})
        except Exception:
            self.send(500,{"error":"lab_internal"})
    def do_POST(self):
        try:
            path=U.urlsplit(self.path).path
            if path=="/alice/webhook":
                n=int(self.headers.get("Content-Length","0"))
                if n<=0 or n>131072:self.send(413,{"error":"request_size"});return
                if self.headers.get_content_type()!="application/json":self.send(415,{"error":"content_type"});return
                self.connection.settimeout(3)
                raw=self.rfile.read(n)
                if len(raw)!=n:self.send(400,{"error":"incomplete"});return
                body=json.loads(raw)
                st=time.perf_counter();code,out,view=skill(body,self.headers.get("Authorization",""))
                log_event("webhook",{"http":code,"elapsed_ms":round((time.perf_counter()-st)*1000,2),"request_bytes":len(raw),"view":view})
                self.send(code,out);return
            if path=="/oauth/authorize":
                f=self.parseform()
                nonce=digest(f.get("nonce",""))
                with db() as c:
                    c.execute("BEGIN IMMEDIATE")
                    r=c.execute("SELECT params FROM forms WHERE nonce=? AND expires>?",(nonce,now())).fetchone()
                    if not r or f.get("account") not in ("demo-a","demo-b") or not hmac.compare_digest(f.get("password",""),PASS):
                        self.send(403,{"error":"invalid_demo_login"});return
                    c.execute("DELETE FROM forms WHERE nonce=?",(nonce,))
                    opts=json.loads(r["params"]);code=new()
                    c.execute("INSERT INTO codes VALUES(?,?,?,0)",(digest(code),f["account"],now()+120))
                loc=REDIRECT+"?"+U.urlencode({"code":code,"state":opts["state"],"client_id":CLIENT,"scope":"reports:read"})
                self.send(302,b"",{"Location":loc});log_event("oauth_authorized",{"account":hp(f["account"])});return
            if path in ("/oauth/token","/oauth/refresh"):
                f=self.parseform()
                if not self.client_valid(f):self.send(401,{"error":"invalid_client"},{"WWW-Authenticate":"Basic realm=\"AliceLab\""});return
                kind=f.get("grant_type","")
                if kind=="authorization_code":
                    if f.get("redirect_uri")!=REDIRECT or not f.get("code"):
                        self.send(400,{"error":"invalid_grant"});return
                    with db() as c:
                        c.execute("BEGIN IMMEDIATE")
                        r=c.execute("SELECT account FROM codes WHERE hash=? AND used=0 AND expires>?",(digest(f["code"]),now())).fetchone()
                        if not r:self.send(400,{"error":"invalid_grant"});return
                        c.execute("UPDATE codes SET used=1 WHERE hash=?",(digest(f["code"]),))
                        account=r["account"];refresh=new()
                        c.execute("INSERT INTO tokens VALUES(?,?,?,?,0)",(digest(refresh),account,"refresh",now()+86400*14))
                        access=new();c.execute("INSERT INTO tokens VALUES(?,?,?,?,0)",(digest(access),account,"access",now()+600))
                elif kind=="refresh_token":
                    with db() as c:
                        c.execute("BEGIN IMMEDIATE")
                        r=c.execute("SELECT account FROM tokens WHERE hash=? AND kind='refresh' AND revoked=0 AND expires>?",(digest(f.get("refresh_token","")),now())).fetchone()
                        if not r:self.send(400,{"error":"invalid_grant"});return
                        account=r["account"];refresh=f["refresh_token"]
                        access=new();c.execute("INSERT INTO tokens VALUES(?,?,?,?,0)",(digest(access),account,"access",now()+600))
                else:self.send(400,{"error":"unsupported_grant_type"});return
                self.send(200,{"access_token":access,"token_type":"Bearer","expires_in":600,"refresh_token":refresh,"scope":"reports:read"})
                log_event("oauth_token",{"account":hp(account),"grant":kind});return
            self.send(404,{"error":"not_found"})
        except (ValueError,UnicodeError,json.JSONDecodeError):
            self.send(400,{"error":"malformed_request"})
        except Exception:
            self.send(500,{"error":"lab_internal"})
def main():
    init()
    if len(sys.argv)>1 and sys.argv[1]=="worker":worker();return
    s=ThreadingHTTPServer(("127.0.0.1",int(os.environ.get("LAB_PORT","8765"))),Handler)
    s.daemon_threads=True;s.serve_forever()
if __name__=="__main__":main()
