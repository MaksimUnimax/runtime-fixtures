import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from starlette.testclient import TestClient

from platform_core import provider_keys
from platform_core.chat_api import create_app
from platform_core.guest_registration import RegistrationStore
from platform_core.model_router import BASE
from platform_core.operation_grants import PaidAccessRequired, issue_grant, revoke_grant
from starlette.exceptions import HTTPException


class OpenRouterCatalog(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.keys = root / 'keys'
        self.enterContext(patch.dict(os.environ, {
            'HARNESS_OPENROUTER_ENABLED': '1',
            'HARNESS_OFFLINE_MODEL': '0',
            'HARNESS_PROVIDER_KEYS_DIR': str(self.keys),
            'HARNESS_MODEL_GATEWAY_URL': 'http://127.0.0.1:9',
        }))
        provider_keys.save(self.keys, 'openrouter', 'catalog-fixture-a')
        self.database = database = root / 'accounts.db'
        with RegistrationStore(database) as accounts:
            accounts.create_account('catalog-owner', 'fixture-pass')
            self.headers = {'Authorization': 'Bearer ' + accounts.login('catalog-owner', 'fixture-pass')}
        self.client = self.enterContext(TestClient(create_app(database, root / 'chats')))
        self.router = self.client.app.state.model_router
        self.upstream = []
        self.status = 200
        self.rotate_after_request = False
        self.rows = [{'id': 'maker/chat', 'name': 'Chat', 'architecture': {'output_modalities': ['text']},
                      'supported_parameters': ['tools'], 'pricing': {'prompt': '0.00001', 'completion': '0.00002'}}]
        self.router.http = httpx.AsyncClient(transport=httpx.MockTransport(self.provider))
        self.addCleanup(self.client.portal.call, self.router.http.aclose)

    def provider(self, request):
        if request.url.path.endswith('/chat/completions'):
            self.assertIn(self.status,(404,429))
            return httpx.Response(self.status,json={'error':'fixture refusal'})
        self.assertEqual(str(request.url), BASE + '/models/user')
        self.upstream.append(request.headers['Authorization'])
        if self.rotate_after_request:
            self.rotate_after_request = False
            provider_keys.save(self.keys, 'openrouter', 'catalog-fixture-c')
        return httpx.Response(self.status, json={'data': self.rows} if self.status == 200 else {'error': 'provider detail'})

    def settings(self, model=None):
        if model is None:
            response = self.client.get('/api/model-settings', headers=self.headers)
        else:
            response = self.client.post('/api/model-settings', headers=self.headers, json={'model': model})
        response.raise_for_status()
        self.assertNotIn('catalog-fixture', response.text)
        return response.json()

    def test_free_catalogue_and_price_consent(self):
        paid = self.rows[0]
        zero = {'prompt':'0.0','completion':'0','request':'0'}
        self.rows.extend([
            {**paid,'id':'maker/promo','pricing':zero},
            {**paid,'id':'maker/advertised:free','pricing':{**zero,'input_cache_write':'0.01'}},
            {**paid,'id':'maker/flat:free','pricing':{**zero,'request':'0.10'}},
            {**paid,'id':'openrouter/free','pricing':zero},
            {**paid,'id':'maker/no-tools:free','pricing':zero,'supported_parameters':[]},
        ])
        self.assertEqual({m['id'] for m in self.settings()['models'] if m['free']},{'maker/promo'})
        self.settings('maker/promo')
        self.rows[1]={**paid,'id':'maker/promo'}
        self.router.expires=0
        self.assertTrue(self.settings()['freeUnavailable'])
        scope=self.client.app.state.identity.create_user_chat(self.headers['Authorization'][7:])
        with self.assertRaises(HTTPException):
            issue_grant(self.database,scope,source='chat.turn',run_key='reprice',bind_model=self.router.bind)
        self.assertFalse(self.settings('maker/promo')['freeUnavailable'])
        with self.assertRaises(PaidAccessRequired):
            issue_grant(self.database,scope,source='chat.turn',run_key='paid',bind_model=self.router.bind)

    def test_zero_wallet_pins_all_model_calls_and_never_grants_paid_access(self):
        self.rows.append({**self.rows[0],'id':'maker/chat:free','pricing':{'prompt':'0','completion':'0'}})
        self.settings('maker/chat:free')
        identity=self.client.app.state.identity
        token=self.headers['Authorization'][7:]
        scope=identity.create_user_chat(token)
        grant=issue_grant(self.database,scope,source='chat.turn',run_key='matrix',bind_model=self.router.bind)
        self.settings('direct')  # The active tool loop keeps its original route.
        for messages in ([{'role':'user','content':'orders'}],[{'role':'tool','tool_call_id':'report','content':'29'}]):
            req={'messages':messages}
            _,aid=self.router.reserve(grant.token,req)
            self.assertEqual(req['model'],'maker/chat:free')
            self.assertEqual(req['provider']['max_price'],{'prompt':0,'completion':0,'request':0})
            self.router.settle(aid,'fixture-gen',{'cost':'0','prompt_tokens':14,'completion_tokens':4})
        revoke_grant(self.database,grant.token)
        wallet=identity.wallet(token)
        self.assertEqual((wallet['available'],wallet['reserved']),('0','0'))
        self.assertEqual([(r['coins'],r['pending']) for r in wallet['charges']],[('0',False)])
        with self.assertRaises(PaidAccessRequired):
            issue_grant(self.database,scope,source='chat.turn',run_key='next',bind_model=self.router.bind)
        self.assertEqual(identity._db.execute('SELECT count(*) FROM workspace_paid_model_access').fetchone()[0],0)

    def test_anomalous_provider_invoice_is_recorded_at_zero_customer_charge(self):
        self.rows[0]['pricing']={'prompt':'0','completion':'0'}
        model=self.rows[0]['id']
        self.settings(model)
        identity=self.client.app.state.identity
        scope=identity.create_user_chat(self.headers['Authorization'][7:])
        grant=issue_grant(self.database,scope,source='chat.turn',run_key='anomaly',bind_model=self.router.bind)
        _,attempt=self.router.reserve(grant.token,{'messages':[]})
        with self.assertLogs('platform_core.model_router',level='ERROR'):
            self.router.settle(attempt,'receipt',{'cost':'0.01','prompt_tokens':2,'completion_tokens':1})
        revoke_grant(self.database,grant.token)
        self.assertEqual(tuple(identity._db.execute('SELECT charge,evidence FROM coin_attempts').fetchone()),
                         (0,'openrouter-free-price-mismatch:0.01'))
        self.assertEqual(identity._db.execute('SELECT closed FROM coin_orders').fetchone()[0],1)

    def test_disabling_router_does_not_bill_the_direct_model(self):
        self.rows[0]['pricing']={'prompt':'0','completion':'0'}
        self.settings(self.rows[0]['id'])
        identity=self.client.app.state.identity
        identity.grant_coins('catalog-owner','1','test-credit','test')
        scope=identity.create_user_chat(self.headers['Authorization'][7:])
        with patch.dict(os.environ,{'HARNESS_OPENROUTER_ENABLED':'0'}):
            with TestClient(create_app(self.database,self.database.parent/'chats')) as off:
                self.assertTrue(off.get('/api/wallet',headers=self.headers).json()['modelChoice'])
                self.assertTrue(off.get('/api/model-settings',headers=self.headers).json()['freeUnavailable'])
                from platform_core.operation_grants import FreeModelUnavailable
                with self.assertRaises(FreeModelUnavailable):
                    issue_grant(self.database,scope,source='chat.turn',run_key='no-implicit-fallback')
                off.post('/api/model-settings',headers=self.headers,json={'model':'direct'}).raise_for_status()
                self.assertFalse(off.get('/api/wallet',headers=self.headers).json()['modelChoice'])

    @unittest.skipUnless(os.getenv("HARNESS_NODE_MODULES"),"requires pinned native Harness")
    def test_free_provider_denials_reach_the_chat_without_a_paid_retry(self):
        self.rows[0]['pricing']={'prompt':'0','completion':'0'}
        self.settings(self.rows[0]['id'])
        chat=self.client.post('/api/chats',headers=self.headers).json()['chatId']
        for status,expected in [(429,429),(404,503)]:
            self.status=status
            response=self.client.post(f'/api/chats/{chat}/turns',headers=self.headers,
                         json={'requestId':f'refusal-{status}','text':'Проверка'})
            self.assertEqual(response.status_code,expected,response.text)
            self.assertIn('бесплатн',response.json()['error'].lower())
        wallet=self.client.get('/api/wallet',headers=self.headers).json()
        self.assertEqual([entry['coins'] for entry in wallet['charges']],['0','0'])

    def test_rotation_revocation_and_recovery(self):
        self.assertEqual(self.settings()['models'], [{'id': 'maker/chat', 'family': 'maker', 'name': 'Chat', 'free': False}])
        self.assertEqual(self.settings('maker/chat')['model'], 'maker/chat')
        self.assertEqual(self.upstream, ['Bearer catalog-fixture-a'])
        provider_keys.save(self.keys, 'openrouter', 'catalog-fixture-b')
        self.status = 403
        denied = self.settings()
        self.assertEqual(denied['models'], [])
        self.assertEqual(denied['model'], 'maker/chat')
        self.assertIn('403', denied['catalogMessage'])
        self.assertEqual(self.settings('direct')['model'], 'direct')
        self.assertEqual(self.upstream, ['Bearer catalog-fixture-a', 'Bearer catalog-fixture-b'])
        self.status = 200
        self.router.expires = 0
        self.assertEqual(self.settings('maker/chat')['catalogMessage'], '')
        self.assertEqual(self.upstream[-1], 'Bearer catalog-fixture-b')

    def test_transient_error_empty_catalog_and_rejected_key(self):
        initial = self.settings()
        self.status = 503
        self.router.expires = 0
        stale = self.settings()
        self.assertEqual(stale['models'], initial['models'])
        self.assertIn('503', stale['catalogMessage'])
        self.status = 401
        self.router.expires = 0
        denied = self.settings()
        self.assertEqual(denied['models'], [])
        self.assertIn('401', denied['catalogMessage'])
        self.status, self.rows = 200, []
        self.router.expires = 0
        empty = self.settings()
        self.assertEqual(empty['models'], [])
        self.assertIn('нет подходящих моделей', empty['catalogMessage'])

    def test_inflight_rotation_discards_old_result(self):
        self.rotate_after_request = True
        self.assertEqual(self.settings()['models'], [])
        self.assertEqual(self.settings()['models'][0]['id'], 'maker/chat')
        self.assertEqual(self.upstream, ['Bearer catalog-fixture-a', 'Bearer catalog-fixture-c'])
