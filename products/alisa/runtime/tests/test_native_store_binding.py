"""Owner/native proof and hostile candidate boundaries; no provider or customer data."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest
import urllib.error
import uuid
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import native_store_binding as binding
from store_checker import Checker, safe_result


class NativeBindingChecks(unittest.TestCase):
    def setUp(self):
        self.key = bytes(range(32))
        self.generation = {'pid': 41, 'start_ticks': 100, 'uid': os.geteuid(), 'boot_id': str(uuid.uuid4())}
        self.pins = {'environment': 'dev', 'product_id': 'alisa_market', 'tenant_id': str(uuid.uuid4()),
                     'store_id': str(uuid.uuid4()), 'request_id': str(uuid.uuid4()), 'provider': 'OZON',
                     'kind': 'PERFORMANCE', 'credential_revision': 1, 'store_revision': 1}
        self.material = {'seller_client_id': '123', 'seller_api_key': 'fixture-seller-key-only',
                         'performance_client_id': 'fixture-perf', 'performance_client_secret': 'fixture-performance-secret-only'}
        self.credential = {'client_id': self.material['performance_client_id'], 'client_secret': self.material['performance_client_secret']}
        self.config = {'execution_enabled': True, 'accounts': {'native-owner': {'active': True, 'stores': [
            {'id': 'native-store', 'platform': 'ozon', 'identity': 'native-private-account', 'access_revision': '1', 'source_revision': '1'}]}},
            'credential_bindings': {'native-store': 'ozon'},
            'qualifications': {name: {'status': 'READ_ONLY_CANARY', 'evidence_ref': 'fixture:existing-native-proof',
                                    'registry_hash': 'registry', 'scalar_hash': 'scalar'}
                               for name in ['ozon_ads_token', 'ozon_ads_daily']}}
        self.row = {'tenant_id': self.pins['tenant_id'], 'store_id': self.pins['store_id'],
                    'native_account': 'native-owner', 'native_store': 'native-store', 'credential_name': 'ozon',
                    'identity': 'ozon:client:123', 'source_hmac': 'unused'}
        ctx = binding.native_context(self.config, self.material, self.row, environment='dev', product_id='alisa_market', generation=self.generation)
        self.row['source_hmac'] = binding.mac(self.key, 'native-owner-source-v1', ctx)
        self.projection = {'schema_version': 'native_owner_store_binding_v1', 'environment': 'dev', 'product_id': 'alisa_market',
                           'mac_key': self.key.hex(), 'bindings': [self.row], 'native_generation': self.generation}

    def reader(self, path, _limit, **_options):
        return copy.deepcopy({binding.PROJECTION: self.projection, binding.CONFIG: self.config,
                              binding.CREDENTIALS/'ozon': self.material}[path])

    def resolve(self, pins=None, credential=None):
        with patch.object(binding, 'root_json', side_effect=self.reader), patch.object(binding, 'process_generation', return_value=copy.deepcopy(self.generation)):
            return binding.resolve(pins or self.pins, credential or self.credential)

    def test_restarted_native_service_cannot_reuse_pinned_credential_generation(self):
        with patch.object(binding, 'root_json', side_effect=self.reader), patch.object(binding, 'process_generation', return_value={**self.generation, 'start_ticks': 200}):
            self.assertIsNone(binding.resolve(self.pins, self.credential))

    def test_exact_existing_owner_pair_qualifies(self):
        self.assertEqual(self.resolve(), 'ozon:client:123')

    def test_each_scope_component_is_required(self):
        for field, value in [('environment', 'prod'), ('product_id', 'another_product'),
                             ('tenant_id', str(uuid.uuid4())), ('store_id', str(uuid.uuid4())),
                             ('provider', 'WB'), ('kind', 'SELLER')]:
            with self.subTest(field=field):
                self.assertIsNone(self.resolve({**self.pins, field: value}))

    def test_scope_edit_without_regeneration_is_not_a_proof(self):
        self.row['tenant_id'] = str(uuid.uuid4())
        self.assertIsNone(self.resolve({**self.pins, 'tenant_id': self.row['tenant_id']}))

    def test_client_id_or_secret_alone_never_qualifies(self):
        for field in ['client_id', 'client_secret']:
            with self.subTest(field=field):
                self.assertIsNone(self.resolve(credential={**self.credential, field: 'fixture-other-value'}))

    def test_rotated_native_keys_or_seller_identity_invalidate_projection(self):
        for field in self.material:
            original = self.material[field]
            self.material[field] = '456' if field == 'seller_client_id' else 'fixture-rotated-value'
            self.assertIsNone(self.resolve())
            self.material[field] = original

    def test_ambiguous_scope_fails_closed(self):
        self.projection['bindings'].append(copy.deepcopy(self.row))
        self.assertIsNone(self.resolve())

    def test_revoked_native_execution_or_account_fails_closed(self):
        self.config['execution_enabled'] = False
        self.assertIsNone(self.resolve())
        self.config['execution_enabled'] = True
        self.config['accounts']['native-owner']['active'] = False
        self.assertIsNone(self.resolve())

    def test_changed_native_reference_or_revision_fails_closed(self):
        self.config['credential_bindings']['native-store'] = 'different-credential'
        self.assertIsNone(self.resolve())
        self.config['credential_bindings']['native-store'] = 'ozon'
        self.config['accounts']['native-owner']['stores'][0]['access_revision'] = '2'
        self.assertIsNone(self.resolve())

    def test_missing_or_changed_advertising_qualification_fails_closed(self):
        for name in ['ozon_ads_token', 'ozon_ads_daily']:
            original = self.config['qualifications'][name]
            self.config['qualifications'][name] = {'status': 'NOT_VERIFIED'}
            self.assertIsNone(self.resolve())
            self.config['qualifications'][name] = {**original, 'evidence_ref': 'fixture:new-proof'}
            self.assertIsNone(self.resolve())
            self.config['qualifications'][name] = original

    def test_io_or_schema_failure_has_no_partial_success(self):
        for failure in [PermissionError(), FileNotFoundError(), ValueError()]:
            with patch.object(binding, 'root_json', side_effect=failure):
                self.assertIsNone(binding.resolve(self.pins, self.credential))
        self.projection['mac_key'] = 'invalid'
        self.assertIsNone(self.resolve())

    def check(self, *, valid_token=True, resolver=None, denied=False):
        def exchange(request, **options):
            self.assertEqual(request.full_url, 'https://api-performance.ozon.ru/api/client/token')
            if denied:
                raise urllib.error.HTTPError(request.full_url, 401, '', {}, None)
            return json.dumps({'access_token': 'fixture-issued-token-only' if valid_token else '',
                               'token_type': 'bearer', 'expires_in': 3600}).encode(), 200
        message = {'schema_version': 'rt_check_v1', 'operation': 'check_store',
                   'pins': self.pins, 'credential': self.credential}
        return Checker(enabled=['PERFORMANCE'], exchange=exchange,
                       native_binding_resolver=resolver or self.resolve).check(message, 'dev')

    def test_success_requires_accepted_token_response_and_explicit_provenance(self):
        result = self.check()
        self.assertEqual(result, {'code': 'CONNECTED', 'identity': 'ozon:client:123',
                                 'capabilities': ['PERFORMANCE'], 'identity_provenance': binding.PROVENANCE})
        for value in [self.material['seller_api_key'], self.material['performance_client_secret'],
                      self.key.hex(), 'fixture-issued-token-only']:
            self.assertNotIn(value, json.dumps(result))

    def test_bad_authentication_or_token_never_consults_binding(self):
        def forbidden(*_):
            self.fail('Binding cannot override failed provider authentication')
        self.assertEqual(self.check(valid_token=False, resolver=forbidden), {'code': 'IDENTITY_NOT_VERIFIED'})
        self.assertEqual(self.check(denied=True, resolver=forbidden), {'code': 'AUTH_DENIED'})

    def test_valid_unlisted_pair_stays_authenticated_unlinked(self):
        self.assertEqual(self.check(resolver=lambda *_: None), {'code': 'AUTHENTICATED_UNLINKED'})

    def test_provenance_rejected_for_other_channels_or_unknown_mode(self):
        result = self.check()
        self.assertTrue(safe_result(result, self.pins))
        self.assertFalse(safe_result(result, {**self.pins, 'kind': 'SELLER'}))
        self.assertFalse(safe_result({**result, 'identity_provenance': 'UNVERIFIED'}, self.pins))


if __name__ == '__main__':
    unittest.main()
