import asyncio
import hashlib
import hmac
import json
import sqlite3
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from starlette.testclient import TestClient

from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core import telegram_api as tg
from platform_core.user_plugins.telegram_delivery import PLUGIN, report_text

ORIGIN = "https://octoport.ru"
CFG = tg.Config("123", "test-secret", "123:test-only")
HEAD = {"Origin": ORIGIN}


def events(answer="Продажи за вчера — 12.", success=True):
    return [
        {"type":"assistant/message","data":{"message":{"content":[{"type":"tool-call","id":"call1",
            "name":"mcp__platform__marketplace_report"}]}}},
        {"type":"tool/result","data":{"message":{"toolCallId":"call1","role":"tool","content":[{"type":"text",
            "text":json.dumps({"result":{"ok":success,"answer":"12"}})}]}}},
        {"type":"assistant/message","data":{"message":{"content":[{"type":"text","text":answer}]}}},
        {"type":"turn/end","data":{"reason":{"kind":"completed"}}},
    ]


class TelegramReports(TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.path, self.journals = root/"db", root/"chats"
        self.enterContext(patch.object(tg.Config, "load", return_value=CFG))
        with RegistrationStore(self.path) as ident:
            for i in ("one","two"):
                ident.create_account(i,"test-pass")
            self.token = ident.login("one","test-pass")
            self.other = ident.login("two","test-pass")
            self.scope = ident.create_user_chat(self.token)
            self.foreign = ident.create_user_chat(self.other)
        # Drive one delivery pass deterministically; no real Telegram service or credentials.
        self.enterContext(patch("platform_core.user_plugins.telegram_delivery.Delivery.run", lambda _: asyncio.Event().wait()))
        self.client = self.enterContext(TestClient(create_app(self.path,self.journals),base_url=ORIGIN))
        self.client.cookies.set("__Host-harness_session",self.token)
        self.base = "/api/chats/"+self.scope.chat_id+"/plugins"
        self.url = self.base+"/"+PLUGIN
        self.toggle(True)

    def toggle(self, enabled):
        if enabled:
            self.post("/api/plugins", {"plugin":PLUGIN,"installed":True}).raise_for_status()
        self.client.post(self.base,headers=HEAD,json={"plugin":PLUGIN,"enabled":enabled}).raise_for_status()

    def post(self,path,body=None):
        return self.client.post(path,headers=HEAD,json=body or {})

    def start(self):
        result=self.post("/api/integrations/telegram/connect")
        result.raise_for_status()
        query=parse_qs(urlsplit(result.json()["url"]).query)
        self.assertEqual(query["scope"],["openid profile telegram:bot_access"])
        self.assertEqual(query["code_challenge_method"],["S256"])
        return query

    def bind(self):
        query=self.start()
        with patch.object(tg,"verified_user",AsyncMock(return_value=884)),patch.object(tg,"send",AsyncMock(return_value=1)):
            self.post("/api/telegram/complete",{"state":query["state"][0],"code":"example"}).raise_for_status()

    def test_signed_login_session_ownership_and_one_use(self):
        query=self.start()
        body={"state":query["state"][0],"code":"example"}
        self.client.cookies.set("__Host-harness_session",self.other)
        self.assertEqual(self.post("/api/telegram/complete",body).status_code,409)
        self.assertEqual(self.client.get(self.url).status_code,404)
        self.client.cookies.set("__Host-harness_session",self.token)
        self.assertEqual(self.post(self.url+"/enable",{"chat_id":884}).status_code,400)
        self.assertEqual(self.client.post(self.url+"/pause",json={}).status_code,403)
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        jwk=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key())); jwk["kid"]="fixture"
        claims={"id":884,"sub":"9000000000001884","iss":tg.ISSUER,"aud":CFG.bot,"nonce":query["nonce"][0],
                "iat":int(time.time()),"exp":int(time.time())+120}
        def provider(req):
            if req.url.path=="/token":
                from base64 import urlsafe_b64encode
                form=parse_qs(req.content.decode())
                challenge=urlsafe_b64encode(hashlib.sha256(form["code_verifier"][0].encode()).digest()).rstrip(b"=").decode()
                self.assertEqual(challenge,query["code_challenge"][0])
                return httpx.Response(200,json={"id_token":jwt.encode(claims,key,algorithm="RS256",headers={"kid":"fixture"})})
            return httpx.Response(200,json={"keys":[jwk]})
        async def verify(_http,*args):
            async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
                return await real_verify(http,*args)
        real_verify=tg.verified_user
        with patch.object(tg,"verified_user",verify),patch.object(tg,"send",AsyncMock(return_value=1)) as sender:
            self.post("/api/telegram/complete",body).raise_for_status()
            sender.assert_awaited_once_with(
                CFG, 884, "Проверка доставки прошла успешно. Бот Октопорта готов присылать отчёты в этот чат."
            )
            self.assertEqual(self.post("/api/telegram/complete",body).status_code,409)
        self.assertFalse(self.client.get(self.url).json()["subscribed"])
        self.post(self.url+"/enable").raise_for_status()
        self.assertTrue(self.client.get(self.url).json()["subscribed"])
        self.toggle(False); self.toggle(True)
        self.assertFalse(self.client.get(self.url).json()["subscribed"])
        self.assertTrue(self.client.get(self.url).json()["linked"])
        self.post("/api/integrations/telegram/disconnect").raise_for_status()
        self.assertFalse(self.client.get(self.url).json()["linked"])

    def test_binding_is_available_without_an_installed_plugin(self):
        self.post("/api/plugins",{"plugin":PLUGIN,"installed":False}).raise_for_status()
        self.bind()
        account = self.client.get("/api/integrations").json()
        self.assertTrue(account["telegram"]["linked"])
        self.assertIn("telegram", account["providers"])
        self.toggle(True)
        self.post(self.url+"/enable").raise_for_status()
        self.post("/api/plugins",{"plugin":PLUGIN,"installed":False}).raise_for_status()
        self.toggle(True)
        status=self.client.get(self.url).json()
        self.assertTrue(status["linked"])
        self.assertFalse(status["subscribed"])

    def test_widget_checks_signature_time_session_and_single_use(self):
        cfg = tg.Config("123", None, "123:unit-test", username="ExampleBot")
        self.client.app.state.telegram.config = cfg

        def begin():
            response = self.post("/api/integrations/telegram/connect")
            response.raise_for_status()
            link = response.json()["url"]
            params = parse_qs(urlsplit(link).query)
            self.assertEqual(params["widget"], ["1"])
            page = self.client.get(link)
            self.assertEqual(page.status_code, 200)
            self.assertIn('data-telegram-login="ExampleBot"', page.text)
            self.assertIn('data-request-access="write"', page.text)
            self.assertIn('data-auth-url="/telegram/return?state=' + params["state"][0], page.text)
            embed = self.client.get(link+"&embed=1")
            self.assertIn("frame-ancestors 'self'", embed.headers["Content-Security-Policy"])
            self.assertIn("frame-ancestors 'none'", page.headers["Content-Security-Policy"])
            self.assertIn('&amp;embed=1',embed.text)
            self.assertIn('integrity="sha384-',embed.text)
            self.assertNotIn('<h1>',embed.text)
            return params["state"][0]

        def profile(stamp):
            signed = f"auth_date={stamp}\nfirst_name=Ирина\nid=884".encode()
            key = hashlib.sha256(cfg.token.encode()).digest()
            return {"auth_date": stamp, "id": 884, "first_name": "Ирина",
                    "hash": hmac.digest(key, signed, "sha256").hex()}

        state = begin()
        now = int(time.time())
        user = profile(now)
        with patch.object(tg, "send", AsyncMock(return_value=9)) as delivery:
            for rejected in (dict(user, id=900), profile(now - 700), profile(now + 100)):
                response = self.post("/api/telegram/complete", {"state":state, "user":rejected})
                self.assertEqual(response.status_code, 400)
            self.client.cookies.set("__Host-harness_session", self.other)
            self.assertEqual(self.post("/api/telegram/complete", {"state":state, "user":user}).status_code,409)
            self.client.cookies.set("__Host-harness_session", self.token)
            delivery.assert_not_awaited()
            success = self.post("/api/telegram/complete", {"state":state, "user":user})
            self.assertEqual(success.json(), {"linked":True})
            self.assertFalse(self.client.get(self.url).json()["subscribed"])
            self.post("/api/integrations/telegram/disconnect").raise_for_status()
            self.assertEqual(self.post("/api/telegram/complete", {"state":begin(), "user":user}).status_code,409)
            self.assertEqual(delivery.await_count, 1)
            self.assertEqual(delivery.await_args.args[1], 884)

    def test_declined_or_revoked_link_never_subscribes(self):
        query=self.start()
        with patch.object(tg,"verified_user",AsyncMock(return_value=884)),patch.object(tg,"send",AsyncMock(side_effect=tg.DeliveryError("blocked"))):
            self.assertEqual(self.post("/api/telegram/complete",{"state":query["state"][0],"code":"x"}).status_code,409)
        self.assertFalse(self.client.get(self.url).json()["linked"])
        query=self.start()
        self.post("/api/integrations/telegram/disconnect").raise_for_status()
        self.assertEqual(self.post("/api/telegram/complete",{"state":query["state"][0],"code":"x"}).status_code,409)

    def test_same_recipient_cannot_replace_another_workspaces_binding(self):
        self.bind()
        self.client.cookies.set("__Host-harness_session",self.other)
        self.base = "/api/chats/"+self.foreign.chat_id+"/plugins"
        self.url = self.base+"/"+PLUGIN
        self.toggle(True)
        query = self.start()
        with patch.object(tg,"verified_user",AsyncMock(return_value=884)),patch.object(tg,"send",AsyncMock()) as sender:
            result = self.post("/api/telegram/complete",{"state":query["state"][0],"code":"fixture"})
        self.assertEqual(result.status_code,409)
        sender.assert_not_awaited()
        self.assertFalse(self.client.get(self.url).json()["linked"])
        self.client.cookies.set("__Host-harness_session",self.token)
        own = "/api/chats/"+self.scope.chat_id+"/plugins/"+PLUGIN
        self.assertTrue(self.client.get(own).json()["linked"])

    def test_plugins_share_only_their_accounts_confirmed_recipient(self):
        missing = self.post(self.url+"/enable")
        self.assertEqual(missing.status_code,409)
        self.assertIn("Добавьте интеграцию Telegram", missing.json()["error"])
        for action in ("connect", "disconnect"):
            self.assertEqual(self.post(self.url+"/"+action).status_code,404)
        self.assertEqual(self.client.post("/api/integrations/telegram/connect",json={}).status_code,403)
        self.bind()
        self.post(self.url+"/enable").raise_for_status()
        integration = self.client.app.state.telegram
        with patch.object(tg, "send", AsyncMock(return_value=77)) as send:
            self.assertEqual(self.client.portal.call(integration.send,self.scope.workspace_id,"Тест таймера"),77)
            send.assert_awaited_once_with(CFG,884,"Тест таймера")
            self.client.cookies.set("__Host-harness_session",self.other)
            self.assertFalse(self.client.get("/api/integrations").json()["telegram"]["linked"])
            self.post("/api/integrations/telegram/disconnect").raise_for_status()
            with self.assertRaises(tg.DeliveryError):
                self.client.portal.call(integration.send,self.foreign.workspace_id,"Чужой отчёт")
            self.client.cookies.set("__Host-harness_session",self.token)
            self.assertTrue(self.client.get(self.url).json()["subscribed"])
            self.post("/api/integrations/telegram/disconnect").raise_for_status()
            self.assertFalse(self.client.get(self.url).json()["subscribed"])
            with self.assertRaises(tg.DeliveryError):
                self.client.portal.call(integration.send,self.scope.workspace_id,"После отключения")
            self.assertEqual(send.await_count,1)

    def test_old_blocked_send_cannot_remove_fresh_consent_for_same_user(self):
        from threading import Event
        from concurrent.futures import ThreadPoolExecutor
        self.bind()
        started, release = Event(), Event()
        async def slow_rejection(*args):
            started.set()
            await asyncio.to_thread(release.wait, 8)
            raise tg.DeliveryError("blocked")
        integration = self.client.app.state.telegram
        with ThreadPoolExecutor(max_workers=1) as pool, patch.object(tg,"send",slow_rejection):
            future=pool.submit(self.client.portal.call,integration.send,self.scope.workspace_id,"Первый отчёт")
            try:
                self.assertTrue(started.wait(4))
                self.post("/api/integrations/telegram/disconnect").raise_for_status()
                self.bind()
            finally:
                release.set()
            with self.assertRaises(tg.DeliveryError):
                future.result(timeout=5)
        self.assertTrue(self.client.get("/api/integrations").json()["telegram"]["linked"])

    def test_upgrade_keeps_existing_recipient_and_report_cursor(self):
        from platform_core.telegram_integration import TelegramIntegration
        self.bind()
        self.post(self.url+"/enable").raise_for_status()
        with sqlite3.connect(self.path) as db:
            db.execute("UPDATE telegram_subscriptions SET cursor=17,status='unknown'")
            db.execute("""CREATE TRIGGER telegram_uninstall AFTER DELETE ON entitlements
                WHEN OLD.plugin_id='telegram-reports' BEGIN
                DELETE FROM telegram_recipients WHERE workspace=OLD.workspace_id; END""")
        state = self.client.app.state
        TelegramIntegration(state.identity, CFG, state.http)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("SELECT cursor,status FROM telegram_subscriptions").fetchone(),(17,"unknown"))
        self.post("/api/plugins",{"plugin":PLUGIN,"installed":False}).raise_for_status()
        self.assertTrue(self.client.get("/api/integrations").json()["telegram"]["linked"])
        new_chat = state.identity.create_user_chat(self.token)
        self.base = "/api/chats/"+new_chat.chat_id+"/plugins"
        self.url = self.base+"/"+PLUGIN
        self.toggle(True)
        self.assertTrue(self.client.get(self.url).json()["linked"])
        self.assertFalse(self.client.get(self.url).json()["subscribed"])
        self.post(self.url+"/enable").raise_for_status()

    def test_invalid_signature_audience_nonce_and_declined_scope(self):
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        unrelated=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        public=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()))
        public["kid"]="fixture"
        claims={"id":884,"sub":"opaque","iss":tg.ISSUER,"aud":CFG.bot,"nonce":"nonce",
                "iat":int(time.time()),"exp":int(time.time())+120}
        from starlette.exceptions import HTTPException
        for changes,signer,scopes in (({},unrelated,tg.SCOPES),({"nonce":"other"},key,tg.SCOPES),
                                      ({"aud":"other"},key,tg.SCOPES),({},key,"openid profile")):
            token=jwt.encode({**claims,**changes},signer,algorithm="RS256",headers={"kid":"fixture"})
            async def verify():
                def provider(req):
                    if req.url.path=="/token":
                        return httpx.Response(200,json={"id_token":token,"scope":scopes})
                    return httpx.Response(200,json={"keys":[public]})
                async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
                    return await tg.verified_user(http,CFG,"code","verifier","nonce")
            with self.assertRaises(HTTPException):
                asyncio.run(verify())

    def test_reports_start_at_subscription_and_retry_only_confirmed_rate_limit(self):
        self.journals.mkdir(exist_ok=True)
        journal=self.journals/"native-chats.sqlite3"
        scope=self.scope
        digest=hashlib.sha256(json.dumps([scope.actor_id,scope.workspace_id,scope.chat_id],separators=(",",":")).encode()).hexdigest()
        with sqlite3.connect(journal) as db:
            db.execute("CREATE TABLE native_batches(scope_key,revision INTEGER,action,events,PRIMARY KEY(scope_key,revision))")
            db.execute("INSERT INTO native_batches VALUES(?,0,'turn',?)",(digest,json.dumps(events("old"))))
        self.bind()
        self.post(self.url+"/enable").raise_for_status()
        def append(revision,items):
            with sqlite3.connect(journal) as db:
                db.execute("INSERT INTO native_batches VALUES(?,?,'turn',?)",(digest,revision,json.dumps(items)))
        def drive():
            with sqlite3.connect(self.path) as db:
                row=db.execute("""SELECT ?,workspace,chat,cursor,generation FROM telegram_subscriptions""",(scope.actor_id,)).fetchone()
            self.client.portal.call(self.client.app.state.telegram_reports.process,row)
        append(1,events("failure",False)); append(2,events("Отчёт 2")); append(3,events("Отчёт 3"))
        sender=AsyncMock(side_effect=[tg.DeliveryError("limited",60),5,tg.DeliveryError("unknown")])
        with patch.object(tg,"send",sender):
            drive(); drive()
            self.assertEqual(sender.await_count,1)
            self.assertEqual(self.client.get(self.url).json()["status"],"limited")
            with sqlite3.connect(self.path) as db:
                db.execute("UPDATE telegram_subscriptions SET retry_at=0")
            drive(); drive()
            self.assertEqual(self.client.get(self.url).json()["status"],"unknown")
            self.assertEqual([c.args[2] for c in sender.await_args_list],["Отчёт 2","Отчёт 2","Отчёт 3"])
            self.assertEqual({c.args[1] for c in sender.await_args_list},{884})
        append(4,events("Отчёт 4"))
        self.post(self.url+"/resume").raise_for_status()
        with patch.object(tg,"send",AsyncMock(return_value=6)) as next_send:
            drive()
            self.assertEqual([c.args[2] for c in next_send.await_args_list], ["Отчёт 4"])
        self.post(self.url+"/pause").raise_for_status()
        self.assertFalse(self.client.get(self.url).json()["subscribed"])

    def test_report_filter_and_long_text_delivery(self):
        self.assertEqual(report_text(events()),"Продажи за вчера — 12.")
        for modified in (events()[:-1], events("api_key=example1234567"), events(success=False), events()[2:]):
            self.assertIsNone(report_text(modified))
        connection=MagicMock()
        connection.getresponse.return_value=SimpleNamespace(status=200,read=lambda limit:
            b'{"ok":true,"result":{"message_id":13,"chat":{"id":884,"type":"private"}}}')
        with patch("http.client.HTTPSConnection",return_value=connection):
            tg._post(CFG,884,"Я"*4100)
        method,path,payload,headers=connection.request.call_args.args
        self.assertTrue(path.endswith("/sendDocument"))
        self.assertIn("multipart/form-data",headers["Content-Type"])
        self.assertIn(b"octoport-report.txt",payload)
        self.assertIn(("Я"*4100).encode(),payload)
        with patch("http.client.HTTPSConnection",return_value=connection) as connect:
            tg._post(tg.Config("123","s","123:test",18999),884,"Короткий отчёт")
        connect.assert_called_once_with("127.0.0.1",18999,timeout=12)
        connection.set_tunnel.assert_called_once_with("api.telegram.org",443)
        self.assertTrue(connection.request.call_args.args[1].endswith("/sendMessage"))
