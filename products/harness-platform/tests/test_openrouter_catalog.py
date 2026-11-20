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


class OpenRouterCatalog(unittest.TestCase):
    def setUp(self):
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.keys = root / 'keys'
        self.enterContext(patch.dict(os.environ, {
            'HARNESS_OPENROUTER_ENABLED': '1',
            'HARNESS_PROVIDER_KEYS_DIR': str(self.keys),
            'HARNESS_MODEL_GATEWAY_URL': 'http://127.0.0.1:9',
        }))
        provider_keys.save(self.keys, 'openrouter', 'catalog-fixture-a')
        database = root / 'accounts.db'
        with RegistrationStore(database) as accounts:
            accounts.create_account('catalog-owner', 'fixture-pass')
            self.headers = {'Authorization': 'Bearer ' + accounts.login('catalog-owner', 'fixture-pass')}
        self.client = self.enterContext(TestClient(create_app(database, root / 'chats')))
        self.router = self.client.app.state.model_router
        self.upstream = []
        self.status = 200
        self.rows = [{'id': 'maker/chat', 'name': 'Chat', 'architecture': {'output_modalities': ['text']},
                      'supported_parameters': ['tools'], 'pricing': {'prompt': '0.00001', 'completion': '0.00002'}}]
        self.router.http = httpx.AsyncClient(transport=httpx.MockTransport(self.provider))
        self.addCleanup(self.client.portal.call, self.router.http.aclose)

    def provider(self, request):
        self.assertEqual(str(request.url), BASE + '/models/user')
        self.upstream.append(request.headers['Authorization'])
        return httpx.Response(self.status, json={'data': self.rows} if self.status == 200 else {'error': 'provider detail'})

    def settings(self, model=None):
        if model is None:
            response = self.client.get('/api/model-settings', headers=self.headers)
        else:
            response = self.client.post('/api/model-settings', headers=self.headers, json={'model': model})
        response.raise_for_status()
        self.assertNotIn('catalog-fixture', response.text)
        return response.json()

    def test_rotation_revocation_and_recovery(self):
        self.assertEqual(self.settings()['models'], [{'id': 'maker/chat', 'family': 'maker', 'name': 'Chat'}])
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
        def rotate(request):
            result = self.provider(request)
            provider_keys.save(self.keys, 'openrouter', 'catalog-fixture-c')
            return result
        with patch.object(self.router.http, '_transport', httpx.MockTransport(rotate)):
            self.assertEqual(self.settings()['models'], [])
        self.assertEqual(self.settings()['models'][0]['id'], 'maker/chat')
        self.assertEqual(self.upstream, ['Bearer catalog-fixture-a', 'Bearer catalog-fixture-c'])
