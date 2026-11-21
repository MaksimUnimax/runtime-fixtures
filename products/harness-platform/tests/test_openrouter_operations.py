import asyncio
import base64
import json
import os
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import patch

import httpx
from starlette.exceptions import HTTPException
from starlette.testclient import TestClient

from platform_core import model_choices
from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.identity import _secret_digest
from platform_core.model_router import ModelRouter, egress_client
from platform_core.operation_grants import issue_grant


class RouterOperations(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        key = root / 'fixture-key'
        key.write_text('local-fixture-only')
        self.enterContext(patch.dict(os.environ, {
            'HARNESS_OPENROUTER_ENABLED':'1', 'HARNESS_OPENROUTER_KEY_FILE':str(key),
            'HARNESS_MODEL_GATEWAY_URL':'http://127.0.0.1:9', 'HARNESS_OFFLINE_MODEL':'0',
            'OPENROUTER_PROXY_URL':'', 'HARNESS_RUB_PER_USD':'80'}))
        self.path = root / 'accounts.db'
        with RegistrationStore(self.path) as st:
            st.create_account('owner', 'fixture-password')
            token = st.login('owner', 'fixture-password')
        self.token=token
        self.client=self.enterContext(TestClient(create_app(self.path, root/'chats')))
        self.headers={'Authorization':'Bearer '+token}
        self.state=self.client.app.state
        self.router=self.state.model_router
        self.chat=self.client.post('/api/chats',headers=self.headers).json()['chatId']
        self.scope=self.state.identity.resolve_chat(token,self.chat)
        self.seen=[]
        self.model='~maker/model'
        self.price='0'
        self.reply='ok'
        self.image_calls=0
        self.router.http=httpx.AsyncClient(transport=httpx.MockTransport(self.upstream))
        self.addCleanup(self.client.portal.call,self.router.http.aclose)
        self.choose()

    def upstream(self, req):
        if req.url.path.endswith('/models/user'):
            images=[{'id':'maker/'+name,'architecture':{'output_modalities':['image']},'pricing':{'image':'0','prompt':'0','completion':'0'}} for name in ('illustrator','illustrator-b','unsupported')]
            return httpx.Response(200,json={'data':[*images,{'id':self.model,'architecture':{'output_modalities':['text']},
                'supported_parameters':['tools','reasoning'],'pricing':{'prompt':self.price,'completion':self.price}}]})
        if req.url.path.endswith('/images/models'):
            return httpx.Response(200,json={'data':[{'id':'maker/illustrator'},{'id':'maker/illustrator-b'}]})
        if req.url.path.endswith('/images'):
            self.image_calls+=1
            if self.reply=='image-rejected':
                return httpx.Response(422)
            png=base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
            return httpx.Response(200,json={'usage':{'cost':0,'prompt_tokens':9,'completion_tokens':11},'data':[{'b64_json':png}]})
        if req.url.path.endswith('/generation'):
            return httpx.Response(200,json={'data':{'id':'gen-fixture','total_cost':'0.000012',
                'native_tokens_prompt':100,'native_tokens_cached':40,'native_tokens_completion':3}})
        body=json.loads(req.content)
        self.seen.append(body)
        if self.reply in ('retry','cancel') and len(self.seen)==1:
            return httpx.Response(429,headers={'Retry-After':'10' if self.reply=='cancel' else '1'})
        if self.reply=='lost':
            return httpx.Response(200,headers={'Content-Type':'text/event-stream'},content=b'data: {"id":"gen-fixture","choices":[]}\n\n')
        return httpx.Response(200,json={'id':'gen-fixture','usage':{'cost':0,'prompt_tokens':10,'completion_tokens':2},
            'choices':[{'message':{'role':'assistant','content':'ok'},'finish_reason':'stop'}]})

    def choose(self):
        r=self.client.post('/api/model-settings',json={'model':self.model,'revision':0},headers=self.headers)
        self.assertEqual(r.status_code,200,r.text)

    def grant(self):
        return issue_grant(self.path,self.scope,source='chat.turn',run_key='check',bind_model=self.router.bind,
                           session_digest=_secret_digest(self.token))

    def complete(self,grant,messages=None):
        return httpx.post(self.state.worker.env['HARNESS_ROUTER_LOCAL']+'/complete',timeout=10,trust_env=False,
                          headers={'x-operation':grant.token},json={'messages':messages if messages is not None else [{'role':'user','content':'test'}]})

    def attempts(self):
        with self.state.identity._lock:
            return self.state.identity._db.execute('SELECT bound,charge,usage_json,provider_id FROM coin_attempts').fetchall()

    def test_no_proxy_and_invalid_proxy_never_choose_direct_http(self):
        for value in ('','not a URL','http://127.0.0.1','https://one.invalid:443/path'):
            with patch.dict(os.environ,{'OPENROUTER_PROXY_URL':value}):
                self.assertIsNone(egress_client())

    def test_zero_balance_retry_same_operation_and_attempt(self):
        self.reply='retry'
        messages=[
            {'role':'user','content':'Read the saved value.'},
            {'role':'assistant','tool_calls':[{'id':'read-1','type':'function',
             'function':{'name':'read_value','arguments':'{}'}}]},
            {'role':'tool','tool_call_id':'read-1','content':'12.34'},
        ]
        start=time.monotonic()
        self.assertEqual(self.complete(self.grant(),messages).status_code,200)
        self.assertGreaterEqual(time.monotonic()-start,1)
        self.assertEqual(self.seen[0],self.seen[1])
        self.assertEqual(self.seen[1]['messages'],messages)
        self.assertEqual(len(self.attempts()),1)
        self.assertEqual(self.attempts()[0][:2],(0,0))

    def test_saved_free_tariff_may_not_become_paid(self):
        self.price='0.000001'
        self.router.expires=0
        self.client.portal.call(self.router.models)
        with self.assertRaises(HTTPException) as caught:self.grant()
        self.assertEqual(caught.exception.status_code,503)
        self.assertFalse(self.seen)

    def test_user_can_cancel_confirmed_limit(self):
        self.reply='cancel'
        live,_=self.state.progress.begin(self.scope,'check')
        grant=self.grant()
        with ThreadPoolExecutor(1) as pool:
            result=pool.submit(self.complete,grant)
            deadline=time.monotonic()+3
            while live.stage!='model_wait' and time.monotonic()<deadline:
                time.sleep(.02)
            self.assertEqual(live.stage,'model_wait')
            self.assertEqual(self.client.post('/api/chats/'+self.chat+'/progress/check/cancel',headers=self.headers).status_code,200)
            self.assertEqual(result.result(timeout=4).status_code,409)
        self.assertEqual(len(self.seen),1)
        self.assertEqual(self.attempts()[0][:2],(0,0))

    def test_interrupted_stream_reconciled_once_without_replaying(self):
        self.price='0.000001'
        self.router.expires=0
        self.choose()
        st=self.state.identity
        st.set_paid('owner',True)
        st.grant_coins('owner','100','fund-test','fixture')
        self.reply='lost'
        self.assertEqual(self.complete(self.grant()).status_code,502)
        self.assertIsNone(self.attempts()[0][1])
        self.assertEqual(self.attempts()[0][3],'gen-fixture')
        restarted=ModelRouter(self.state.identity,self.router.http,self.router.key)
        self.client.portal.call(restarted.reconcile_once)
        before=self.attempts()
        self.client.portal.call(self.router.reconcile_once)
        self.assertEqual(self.attempts(),before)
        self.assertEqual(len(self.seen),1)
        self.assertEqual(before[0][1],960000000)
        self.assertEqual(json.loads(before[0][2]),dict(input_tokens=60,cache_read_input_tokens=40,
                         cache_creation_input_tokens=0,output_tokens=3))

    def test_image_choice_is_independent_and_attachment_is_idempotent(self):
        url='/api/chats/'+self.chat+'/plugins'
        def post(path,body):
            r=self.client.post(path,headers=self.headers,json=body)
            self.assertEqual(r.status_code,200,r.text)
            return r.json()
        for plugin in ('illustrations','wildberries'):
            post(url,{'plugin':plugin,'enabled':True})
        image=url+'/illustrations'
        offered=self.client.get(image+'?models=1',headers=self.headers).json()['models']
        self.assertEqual({m['id'] for m in offered},{'maker/illustrator','maker/illustrator-b'})
        for mid in ('maker/illustrator','maker/illustrator-b'):
            post(image+'/model',{'model':mid,'effort':'auto'})
        self.assertEqual(self.client.get(url+'/wildberries',headers=self.headers).json()['model'],'')
        self.assertEqual(self.client.get('/api/model-settings',headers=self.headers).json()['model'],self.model)
        self.state.identity.set_admin('owner',True)
        post('/api/admin/chat-default',{'model':self.model,'effort':'high'})
        post('/api/model-settings',{'model':'direct','revision':1})
        self.assertEqual(self.client.get(image,headers=self.headers).json()['model'],'maker/illustrator-b')
        post('/api/model-settings',{'model':'default','revision':1})
        grant=self.grant()
        def draw(g):
            return httpx.post(self.state.worker.env['HARNESS_ROUTER_LOCAL']+'/illustrate',trust_env=False,
                              headers={'x-operation':g.token},json={'prompt':'Draw a blue circle'})
        one=draw(grant)
        self.assertEqual(one.status_code,200,one.text)
        self.assertEqual(draw(grant).json(),one.json())
        self.assertEqual(self.image_calls,1)
        self.assertEqual(len(self.attempts()),1)
        self.assertEqual(self.client.get(one.json()['url'],headers=self.headers).headers['content-type'],'image/png')
        grant=issue_grant(self.path,self.scope,source='chat.turn',run_key='image-failure',bind_model=self.router.bind)
        self.reply='image-rejected'
        self.assertEqual(draw(grant).status_code,502)
        self.assertEqual(draw(grant).status_code,409)
        self.assertEqual(self.image_calls,2)
        self.assertEqual(self.attempts()[-1][1],0)
        self.assertEqual(self.complete(grant).status_code,200)

    def test_publication_pins_effort_and_rejects_stale_personal_save(self):
        self.state.identity.set_admin('owner',True)
        admin=self.client.post('/api/admin/chat-default',headers=self.headers,json={'model':self.model,'effort':'low'})
        self.assertEqual(admin.status_code,200,admin.text)
        stale=self.client.post('/api/model-settings',headers=self.headers,json={'model':'direct','revision':0})
        self.assertEqual(stale.status_code,409)
        current=self.client.get('/api/model-settings',headers=self.headers).json()
        self.assertTrue(current['inherited'])
        self.assertEqual(self.complete(self.grant()).status_code,200)
        self.assertEqual((self.seen[0]['model'],self.seen[0]['reasoning']), (self.model,{'effort':'low'}))

    def test_chat_list_opens_while_model_catalogue_is_waiting(self):
        started,release=threading.Event(),threading.Event()
        async def slow_catalog(req):
            started.set()
            await asyncio.to_thread(release.wait,5)
            return self.upstream(req)
        original=self.router.http
        self.router.http=httpx.AsyncClient(transport=httpx.MockTransport(slow_catalog))
        self.addCleanup(self.client.portal.call,self.router.http.aclose)
        self.addCleanup(setattr,self.router,'http',original)
        self.router.expires=self.router.next_manual=0
        with ThreadPoolExecutor(2) as pool:
            loading=pool.submit(self.client.get,'/api/model-settings?refresh=1',headers=self.headers)
            try:
                self.assertTrue(started.wait(2))
                response=pool.submit(self.client.get,'/api/chats',headers=self.headers).result(timeout=2)
                self.assertIn(self.chat,response.json())
                self.assertFalse(loading.done())
            finally:
                release.set()
            self.assertEqual(loading.result(timeout=3).status_code,200)
