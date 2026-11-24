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
from platform_core.operation_grants import issue_grant, revoke_grant
from platform_core.coin_review import resolve


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
        if self.reply=='signed':
            packets=[
                {'id':'gen-signed','choices':[{'delta':{'reasoning_details':[{'type':'reasoning.encrypted','data':'fixture-signature','index':0}]}}]},
                {'id':'gen-signed','choices':[{'delta':{'tool_calls':[{'index':0,'id':'tool-1','function':{'name':'lookup','arguments':'{}'}}]},'finish_reason':'tool_calls'}]},
            ]
            return httpx.Response(200,headers={'Content-Type':'text/event-stream'},
                                  text=''.join('data: '+json.dumps(v)+'\n\n' for v in packets)+'data: [DONE]\n\n')
        if self.reply=='error-with-id':
            return httpx.Response(200,headers={'Content-Type':'text/event-stream'},text='data: {"id":"gen-error","error":{"code":502}}\n\n')
        if self.reply=='price-conflict':
            return httpx.Response(200,json={'id':'gen-conflict','usage':{'cost':'0.002','prompt_tokens':10,'completion_tokens':2},
                    'choices':[{'message':{'role':'assistant','content':'ok'},'finish_reason':'stop'}]})
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

    @unittest.skipUnless(os.environ.get('HARNESS_NODE_MODULES'),'requires pinned native Harness')
    def test_cancelled_turn_reports_cancellation_on_replay_and_allows_new_message(self):
        self.reply='cancel'
        url='/api/chats/'+self.chat
        def send(rid):
            return self.client.post(url+'/turns',headers=self.headers,json={'requestId':rid,'text':'Fixture question'})
        with ThreadPoolExecutor(1) as pool:
            waiting=pool.submit(send,'cancel-native')
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                turn=self.state.progress.turns.get((self.scope,'cancel-native'))
                if turn and turn.stage=='model_wait':
                    break
                time.sleep(.02)
            self.client.post(url+'/progress/cancel-native/cancel',headers=self.headers).raise_for_status()
            result=waiting.result(timeout=6)
        self.assertEqual((result.status_code,result.json()['error']),(409,'model_wait_cancelled'))
        self.assertEqual(send('cancel-native').json()['error'],'model_wait_cancelled')
        self.assertEqual(len(self.seen),1)
        self.assertEqual(send('new-after-cancel').status_code,200)
        self.assertEqual(len(self.seen),2)

    @unittest.skipUnless(os.environ.get('HARNESS_NODE_MODULES'),'requires pinned native Harness')
    def test_cancel_after_accepted_tool_preserves_uncertainty_and_does_not_replay(self):
        url='/api/chats/'+self.chat
        self.client.post('/api/plugins',headers=self.headers,json={'plugin':'illustrations','installed':True}).raise_for_status()
        self.client.post(url+'/plugins',headers=self.headers,json={'plugin':'illustrations','enabled':True}).raise_for_status()
        self.client.post(url+'/plugins/illustrations/model',headers=self.headers,json={'model':'maker/illustrator','effort':'auto'}).raise_for_status()
        calls=[]
        def upstream(req):
            if not req.url.path.endswith('/chat/completions'):
                return self.upstream(req)
            calls.append(req)
            if len(calls)>2:
                return httpx.Response(429,headers={'Retry-After':'30'})
            call={'id':'draw','type':'function','function':{'name':'create_illustration','arguments':'{"prompt":"a circle"}'}}
            if len(calls)==1:
                self.assertNotIn('create_illustration',[t['function']['name'] for t in json.loads(req.content)['tools']])
                call={'id':'open','type':'function','function':{'name':'octoport_use','arguments':json.dumps({'action':'create_illustration','query':'circle'})}}
            return httpx.Response(200,json={'id':'gen-accepted-'+str(len(calls)),'usage':{'cost':0,'prompt_tokens':10,'completion_tokens':2},
                'choices':[{'finish_reason':'tool_calls','message':{'role':'assistant','content':'','tool_calls':[call]}}]})
        http=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        self.addCleanup(self.client.portal.call,http.aclose)
        def send():
            return self.client.post(url+'/turns',headers=self.headers,json={'requestId':'cancel-after-tool','text':'Draw a circle'})
        with patch.object(self.router,'http',http), ThreadPoolExecutor(1) as pool:
            pending=pool.submit(send)
            deadline=time.monotonic()+12
            while time.monotonic()<deadline:
                live=self.state.progress.turns.get((self.scope,'cancel-after-tool'))
                if live and live.stage=='model_wait':
                    break
                time.sleep(.02)
            self.client.post(url+'/progress/cancel-after-tool/cancel',headers=self.headers).raise_for_status()
            self.assertEqual(pending.result(timeout=6).json()['error'],'turn_unconfirmed')
            self.assertEqual(send().json()['error'],'turn_unconfirmed')
        self.assertEqual((len(calls),self.image_calls),(3,1))

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
            post('/api/plugins',{'plugin':plugin,'installed':True})
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

    def test_positive_receipt_on_free_tariff_waits_for_review_at_zero_user_cost(self):
        self.reply='price-conflict'
        self.state.identity.set_admin('owner',True)
        grant=self.grant()
        self.assertEqual(self.complete(grant).status_code,200)
        revoke_grant(self.path,grant.token)
        wallet=self.client.get('/api/admin/accounts/owner/wallet',headers=self.headers).json()
        self.assertEqual((wallet['reserved'],wallet['available']),('0','0'))
        row=wallet['charges'][0]
        self.assertTrue(row['pending'])
        self.assertTrue(row['meter']['attempts'][0]['needsReview'])
        self.assertEqual(row['meter']['attempts'][0]['providerUsd'],'0.002')
        with self.state.identity._lock:
            attempt=self.state.identity._db.execute('SELECT attempt_id FROM coin_attempts').fetchone()[0]
        for _ in range(2):
            resolve(self.path,attempt,'0.002','provider-statement')
        row=self.client.get('/api/admin/accounts/owner/wallet',headers=self.headers).json()['charges'][0]
        self.assertFalse(row['pending'])
        self.assertFalse(row['meter']['attempts'][0]['needsReview'])
        self.assertEqual((row['coins'],row['meter']['providerUsd']),('0','0.002'))

    def test_positive_receipt_above_nonzero_reservation_caps_customer_charge(self):
        self.reply='price-conflict'
        grant=self.grant()
        with self.state.identity._write() as db:
            db.execute("INSERT INTO coin_attempts(attempt_id,operation_id,bound,model,started_ms,rate_version,period) VALUES('paid-cap',?,1000000000,?,0,'openrouter-v1','provider')",(grant.operation_id,self.model))
        self.router.settle('paid-cap','gen-expensive',{'cost':'0.002','prompt_tokens':10,'completion_tokens':2})
        self.assertIsNone(self.attempts()[0][1])
        revoke_grant(self.path,grant.token)
        for _ in range(2):
            resolve(self.path,'paid-cap','0.002','provider-statement')
        with self.state.identity._lock:
            charge,note=self.state.identity._db.execute("SELECT charge,evidence FROM coin_attempts WHERE attempt_id='paid-cap'").fetchone()
        self.assertEqual((charge,note),(1000000000,'openrouter-reviewed-usd:0.002:provider-statement'))

    def test_local_capacity_wait_keeps_one_provider_attempt(self):
        grant=self.grant()
        self.router.total=32
        waited=[]
        async def capacity_released(token,request,delay):
            waited.append(delay)
            self.router.total=0
        with patch.object(self.router,'wait_limit',capacity_released):
            self.assertEqual(self.complete(grant).status_code,200)
        self.assertEqual((waited,len(self.seen),len(self.attempts()),self.router.total),([1],1,1,0))

    def test_admin_health_persists_last_success_and_reports_provider_refusal(self):
        self.state.identity.set_admin('owner',True)
        self.complete(self.grant()).raise_for_status()
        def health():
            return self.client.get('/api/admin/provider-keys',headers=self.headers).json()['openrouter']['health']
        success=health()
        self.assertGreater(success['catalogAt'],0)
        self.assertGreater(success['generatedAt'],0)
        failing=httpx.AsyncClient(transport=httpx.MockTransport(lambda req:httpx.Response(402)))
        self.addCleanup(self.client.portal.call,failing.aclose)
        with patch.object(self.router,'http',failing):
            refused=self.complete(self.grant())
        self.assertEqual(refused.headers['x-octoport-reason'],'provider_balance')
        self.assertIn('средств',health()['detail'])
        self.assertEqual(health()['generatedAt'],success['generatedAt'])
        with patch.object(self.router,'key','different-key'):
            self.assertEqual(health(),{})

    def test_local_capacity_serves_older_eligible_waiter_first(self):
        self.router.total=32
        grant=self.grant()
        def ask(label):
            return self.complete(grant,[{'role':'user','content':label}])
        with ThreadPoolExecutor(2) as pool:
            first=pool.submit(ask,'first')
            limit=time.monotonic()+3
            while len(self.router.waiters)<1 and time.monotonic()<limit:
                time.sleep(.01)
            second=pool.submit(ask,'second')
            limit=time.monotonic()+3
            while len(self.router.waiters)<2 and time.monotonic()<limit:
                time.sleep(.01)
            self.assertEqual(len(self.router.waiters),2)
            self.router.total=31
            self.assertEqual((first.result(5).status_code,second.result(5).status_code),(200,200))
        self.assertEqual([x['messages'][0]['content'] for x in self.seen],['first','second'])

    def test_stream_error_keeps_provider_id_for_reconciliation(self):
        self.reply='error-with-id'
        self.assertEqual(self.complete(self.grant()).status_code,502)
        self.assertEqual(self.attempts()[0][3],'gen-error')
        self.assertIsNone(self.attempts()[0][1])

    def test_stream_keeps_ordered_reasoning_for_tool_continuation(self):
        self.reply='signed'
        response=self.complete(self.grant())
        self.assertEqual(response.status_code,200)
        msg=response.json()['message']
        self.assertEqual(msg['reasoning_details'],[{'type':'reasoning.encrypted','data':'fixture-signature','index':0}])
        self.assertEqual(msg['content'],'')

    def test_session_expiry_prevents_next_provider_attempt(self):
        grant=self.grant()
        self.state.identity.logout(self.token)
        self.assertEqual(self.complete(grant).status_code,403)
        self.assertEqual(self.seen,[])

    def test_stored_image_reopens_when_provider_is_unavailable(self):
        base='/api/chats/'+self.chat+'/plugins'
        for path,params in [('/api/plugins',{'plugin':'illustrations','installed':True}),
                            (base,{'plugin':'illustrations','enabled':True}),
                            (base+'/illustrations/model',{'model':'maker/illustrator','effort':'auto'})]:
            self.client.post(path,json=params,headers=self.headers).raise_for_status()
        grant=self.grant()
        def draw():
            return httpx.post(self.state.worker.env['HARNESS_ROUTER_LOCAL']+'/illustrate',
                              json={'prompt':'A circle'},headers={'x-operation':grant.token},trust_env=False)
        one=draw()
        one.raise_for_status()
        with patch.object(self.router,'http',None):
            two=draw()
            self.assertEqual(two.status_code,200)
            self.assertEqual(two.json(),one.json())
        self.assertEqual(self.image_calls,1)

    def test_failed_image_tariff_refresh_never_uses_old_paid_price(self):
        saved = self.router.catalog['maker/illustrator']
        saved.update(free=False, imagePrice=('0.02','0','0','0',0))
        failed = httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(503)))
        self.addCleanup(self.client.portal.call, failed.aclose)
        async def refresh():
            return await self.router.models(current_tariff=True)
        with patch.object(self.router, 'http', failed):
            self.assertEqual(self.client.portal.call(refresh), {})
        self.assertIn('maker/illustrator', self.router.catalog)

    def test_reconciliation_reaches_attempts_after_fifty_missing_receipts(self):
        grant=self.grant()
        with self.state.identity._write() as db:
            for i in range(51):
                generation='gen-fixture' if i==50 else 'missing-'+str(i)
                db.execute("""INSERT INTO coin_attempts(attempt_id,operation_id,bound,model,started_ms,rate_version,period,provider_id)
                            VALUES(?,?,1000000000,?,0,'openrouter-v1','provider',?)""",
                           (str(i),grant.operation_id,self.model,generation))
        for _ in range(2):
            self.client.portal.call(self.router.reconcile_once)
        self.assertEqual(self.attempts()[-1][1],960000000)

    @unittest.skipUnless(os.environ.get('HARNESS_NODE_MODULES'),'requires pinned native Harness')
    def test_native_tool_roundtrip_preserves_signature_and_streams_visible_text_once(self):
        base='/api/chats/'+self.chat
        for path,params in [('/api/plugins',{'plugin':'illustrations','installed':True}),
                            (base+'/plugins',{'plugin':'illustrations','enabled':True}),
                            (base+'/plugins/illustrations/model',{'model':'maker/illustrator','effort':'auto'})]:
            self.client.post(path,json=params,headers=self.headers).raise_for_status()
        signature=[{'type':'reasoning.encrypted','data':'opaque-control','index':0}]
        calls=[]
        def handler(req):
            if not req.url.path.endswith('/chat/completions'):
                return self.upstream(req)
            payload=json.loads(req.content)
            calls.append(payload)
            if len(calls)==1:
                delta={'tool_calls':[{'index':0,'type':'function','id':'open','function':{'name':'octoport_use',
                    'arguments':json.dumps({'action':'create_illustration','query':'circle'})}}]}
                reason='tool_calls'
            elif len(calls)==2:
                delta={'tool_calls':[{'index':0,'type':'function','id':'draw-1','function':{'name':'create_illustration','arguments':'{"prompt":"blue circle"}'}}],
                       'reasoning_details':signature}
                reason='tool_calls'
            else:
                delta={'content':'Готово'}
                reason='stop'
            data={'id':'gen-native-'+str(len(calls)),'choices':[{'delta':delta,'finish_reason':reason}],
                  'usage':{'cost':0,'prompt_tokens':10,'completion_tokens':2}}
            return httpx.Response(200,headers={'Content-Type':'text/event-stream'},text='data: '+json.dumps(data)+'\n\ndata: [DONE]\n\n')
        upstream=httpx.AsyncClient(transport=httpx.MockTransport(handler))
        self.addCleanup(self.client.portal.call,upstream.aclose)
        with patch.object(self.router,'http',upstream):
            result=self.client.post(base+'/turns',headers=self.headers,json={'requestId':'signed-roundtrip','text':'Draw a blue circle.'})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json()['text'],'Готово')
        self.assertEqual(len(calls),3)
        reply=next(row for row in calls[2]['messages'] if row.get('tool_calls') and row['tool_calls'][0]['id']=='draw-1')
        self.assertEqual(reply['reasoning_details'],signature)
        self.assertEqual(self.image_calls,1)
        self.assertNotIn('opaque-control',self.client.get(base+'/events',headers=self.headers).text)
        self.assertEqual(self.state.progress.turns[(self.scope,'signed-roundtrip')].text,'Готово')
