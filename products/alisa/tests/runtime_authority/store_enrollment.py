#!/usr/bin/env python3
"""Real vault/enrollment/PG/Unix authority and synthetic HTTPS dispatch.

The HTTP boundary alone is replaced. No marketplace or model network is allowed.
"""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

from query_roundtrip import QueryChecks, QUESTION
from current_core_roundtrip import FakeTransport, Worker
from engine import CallError
import providers
from checks import uid, connections, TEMP, AccessAdjustment, timezone, transaction
from django.test import override_settings
from django.db import connection
from alisa_platform.runtime_adapter import authority_rpc, store_registry
from alisa_platform.runtime_adapter.authority import pins
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from alisa_platform.stores import service as stores
from alisa_platform.stores.models import (Store, CredentialRevision, VaultSecret,
    RuntimeTenantBinding, RuntimeStoreBinding)
from alisa_platform.queries import service as queries
from http_transport import HTTPTransport, SCALAR_SOURCES, SCALARS, REGISTRY_HASH
from semantics import Rejected
import http_transport
import platform_store_credentials as broker


class EnrollmentChecks(QueryChecks):
    def setUp(self):
        super().setUp()
        switch = override_settings(RUNTIME_AUTO_BINDINGS_ENABLED=True)
        switch.enable(); self.addCleanup(switch.disable)
        configured = patch.object(authority_rpc, 'configured_authority', return_value=self.authority)
        configured.start(); self.addCleanup(configured.stop)
        self.file_before = self.path.read_bytes()
        self.expected = {}; self.dispatched = []; self.before_dispatch = None
        self.http = HTTPTransport(self.folder.name, {}, {operation: {
            'status': 'READ_ONLY_CANARY', 'registry_hash': REGISTRY_HASH,
            'scalar_hash': SCALARS.hash, 'evidence_ref': 'owned-synthetic-fixture'
        } for operation in SCALAR_SOURCES.sources}, enabled=True)
        fixture = FakeTransport(); case = self
        class Transport:
            calls = fixture.calls
            def prepare(self, request, store):
                return None if request.source.startswith('model:') else case.http.prepare(request, store)
            def execute_observed(self, request, store, on_dispatch):
                if request.source.startswith('model:'):
                    on_dispatch(); return fixture.execute(request, store)
                def receive(http_request, **options):
                    # Check the actual outbound headers before counting a dispatch.
                    fields = {k.lower(): v for k, v in http_request.header_items()}
                    for name, secret in case.expected[store['id']].items():
                        case.assertEqual(fields.get(name.lower()), secret)
                    if case.before_dispatch: case.before_dispatch()
                    options['on_dispatch']()
                    case.dispatched.append((store['id'], request.operation))
                    value, _ = fixture.execute(request, store)
                    return json.dumps(value).encode(), 200
                with patch.object(http_transport, 'read_response', side_effect=receive):
                    return case.http.execute_observed(request, store, on_dispatch)
        self.transport = Transport(); self.worker = Worker(self.engine, self.transport)

    def command(self, store, action, **values):
        store.refresh_from_db()
        return stores.execute(self.web_token, {'action': action, 'command_id': uid(),
            'store_id': str(store.pk), 'expected_revision': store.revision, **values})

    def check(self, store, revision, identity=None, code='CONNECTED'):
        def provider(*_):
            self.assertFalse(connection.in_atomic_block)
            return {'code': code, 'identity': identity or store.verified_identity or
                ('ozon:client:' + str(store.pk) if store.provider == 'OZON' else 'wb:supplier:' + str(store.pk)),
                'capabilities': [revision.kind]}
        with patch.object(stores, 'check_store', side_effect=provider):
            return self.command(store, 'check', credential_id=str(revision.pk))

    def create(self, provider='OZON', suffix='first'):
        material = {'client_id': '12345', 'api_key': 'synthetic-key-' + suffix} if provider == 'OZON' else {
            'token': 'synthetic-wb-token-' + suffix}
        result, status = stores.execute(self.web_token, {'action': 'create', 'command_id': uid(),
            'provider': provider, 'name': 'Fixture ' + suffix, 'voice_alias': suffix, 'credential': material})
        self.assertEqual(status, 201)
        store = Store.objects.get(pk=result['store']['id'])
        revision = CredentialRevision.objects.get(store=store, status='PENDING')
        result, _ = self.check(store, revision)
        self.assertEqual(result['check_code'], 'CONNECTED')
        binding = RuntimeStoreBinding.objects.get(store=store)
        self.expected[binding.native_id] = {'Client-Id': material['client_id'], 'Api-Key': material['api_key']} if provider == 'OZON' else {'Authorization': material['token']}
        self.assertEqual(self.path.read_bytes(), self.file_before)
        return store, revision, binding

    def use(self, store):
        self.stores = [str(store.pk)]
        authorizer = self.authority.for_session(self.web_token, self.stores)
        context = authorizer.prepare('submit')
        return pins(context), self.authority.resolve(pins(context), 'execute')['stores'][0]

    def run_report(self, store):
        self.stores = [str(store.pk)]; self.qid = uid()
        question = QUESTION if store.provider == 'OZON' else 'сводка заказов за октябрь 2026 на вайлдберриз'
        self.assertEqual(queries.submit(self.principal, self.qid, self.stores, question)[1], 201)
        self.finish_query()
        return queries.read(self.principal, self.qid, result=True)['result']

    def test_new_seller_only_runs_real_transport_without_native_file_binding(self):
        store, _, binding = self.create()
        self.assertNotIn(str(store.pk), binding.native_id)
        self.assertEqual(self.run_report(store)['complete'], True)
        self.assertEqual(len(self.dispatched), 1)
        self.assertEqual(RuntimeTenantBinding.objects.get(tenant=self.tenant).native_tenant, 'native-tenant')

    def test_new_wb_runs_real_transport(self):
        store, _, _ = self.create('WB')
        self.assertTrue(self.run_report(store)['complete'])
        self.assertEqual(len(self.dispatched), 1)

    def test_tenant_absent_from_legacy_file_enrolls_and_runs(self):
        self.document['tenants'] = []; self.write(); self.file_before = self.path.read_bytes()
        store, _, _ = self.create()
        reference = RuntimeTenantBinding.objects.get(tenant=self.tenant).native_tenant
        self.assertTrue(reference.startswith('platform-'))
        self.assertNotIn(str(self.tenant.pk), reference)
        self.assertTrue(self.run_report(store)['complete'])

    def test_key_rotation_changes_dispatch_and_revokes_old_ciphertext(self):
        store, old, binding = self.create()
        old_pins, old_scope = self.use(store)
        material = {'client_id': '12345', 'api_key': 'synthetic-replacement-key'}
        self.command(store, 'credential', kind='SELLER', credential=material)
        new = CredentialRevision.objects.get(store=store, status='PENDING')
        # Pending bytes are never used, even while an older verified key works.
        current_pins, current_scope = self.use(store)
        before = self.bridge.credentials(current_pins, current_scope)
        self.assertEqual(before['seller_api_key'], 'synthetic-key-first')
        self.check(store, new)
        old.refresh_from_db(); self.assertEqual(old.status, 'REVOKED')
        self.assertEqual(VaultSecret.objects.get(pk=old.secret_id).ciphertext, '')
        self.expected[binding.native_id]['Api-Key'] = material['api_key']
        self.assertTrue(self.run_report(store)['complete'])
        self.deny('PERMISSION_DENIED', lambda: self.authority.resolve(old_pins, 'execute'))

    def test_wrong_identity_never_replaces_active_key(self):
        store, old, _ = self.create()
        self.command(store, 'credential', kind='SELLER', credential={'client_id': '999', 'api_key': 'synthetic-wrong-key'})
        new = CredentialRevision.objects.get(store=store, status='PENDING')
        result, _ = self.check(store, new, identity='ozon:client:somebody-else')
        self.assertEqual(result['check_code'], 'ACCOUNT_MISMATCH')
        old.refresh_from_db(); self.assertEqual(old.status, 'ACTIVE')
        self.assertTrue(self.run_report(store)['complete'])

    def test_failed_check_does_not_enroll(self):
        result, _ = stores.execute(self.web_token, {'action': 'create', 'command_id': uid(),
            'provider': 'WB', 'name': 'Rejected', 'voice_alias': '', 'credential': {'token': 'synthetic-rejected-token'}})
        store = Store.objects.get(pk=result['store']['id'])
        revision = CredentialRevision.objects.get(store=store)
        self.check(store, revision, code='INVALID_CREDENTIAL')
        self.assertFalse(RuntimeStoreBinding.objects.filter(store=store).exists())

    def test_same_confirmed_check_keeps_reference(self):
        store, revision, binding = self.create()
        self.check(store, revision)
        self.assertEqual(RuntimeStoreBinding.objects.get(store=store).native_id, binding.native_id)
        self.assertEqual(RuntimeStoreBinding.objects.filter(store=store).count(), 1)

    def test_unselected_new_store_does_not_invalidate_selected_scope(self):
        store, _, _ = self.create()
        claim, scope = self.use(store)
        self.create(suffix='second')
        self.assertEqual(self.authority.resolve(claim, 'execute')['stores'], [scope])

    def test_revoke_before_worker_has_zero_provider_dispatch(self):
        store, _, _ = self.create(); self.stores = [str(store.pk)]
        self.send(); self.command(store, 'revoke_credential', kind='SELLER')
        self.worker.step()
        self.assertEqual(self.dispatched, [])

    def test_revoke_after_secret_lookup_blocks_actual_dispatch(self):
        store, _, _ = self.create(); self.stores = [str(store.pk)]
        self.send()
        self.before_dispatch = lambda: self.command(store, 'revoke_credential', kind='SELLER')
        for _ in range(8): self.worker.step(); self.clock.advance(3)
        self.assertEqual(self.dispatched, [])

    def test_disable_denies_private_credentials(self):
        store, _, _ = self.create(); claim, scope = self.use(store)
        self.command(store, 'disable')
        with self.assertRaises(Rejected): self.bridge.credentials(claim, scope)

    def test_store_substitution_denied_by_private_rpc(self):
        first, _, _ = self.create(); claim, _ = self.use(first)
        second, _, _ = self.create(suffix='second'); _, substitute = self.use(second)
        with self.assertRaises(Rejected): self.bridge.credentials(claim, substitute)

    def test_feature_off_never_enrolls_or_reveals_dynamic_credentials(self):
        store, _, _ = self.create(); claim, scope = self.use(store)
        with override_settings(RUNTIME_AUTO_BINDINGS_ENABLED=False):
            with self.assertRaises(Rejected): self.bridge.credentials(claim, scope)
            self.check(store, CredentialRevision.objects.get(store=store, status='ACTIVE'))
        self.assertEqual(RuntimeStoreBinding.objects.filter(store=store).count(), 1)

    def test_dynamic_transport_without_accepted_job_context_is_denied(self):
        store, _, _ = self.create(); _, scope = self.use(store)
        with self.assertRaises(Rejected): self.http._store_credentials(scope)
        self.assertIsNone(broker._CURRENT.get())

    def test_missing_ad_key_is_local_refusal_with_zero_http(self):
        store, _, _ = self.create(); claim, scope = self.use(store)
        row = {'plan': json.dumps({'runtime_guard': {'pins': claim}, 'stores': [scope]}), 'draft': ''}
        request = providers.Request('ozon_ads_token', 'ozon:' + scope['identity'] + ':ozon_ads_token',
                                    scope['id'], {}, 1, 100)
        with broker.execution(self.engine, row, scope), patch.object(http_transport, 'read_response', side_effect=AssertionError('missing-key HTTP')):
            with self.assertRaises(CallError) as error: self.http.execute(request, scope)
        self.assertEqual(error.exception.code, 'CREDENTIAL_UNAVAILABLE')

    def test_context_is_reset_on_exception_and_does_not_cross_store(self):
        store, _, _ = self.create(); claim, scope = self.use(store)
        other = deepcopy(scope); other['id'] = 'another-store'
        row = {'plan': json.dumps({'runtime_guard': {'pins': claim}, 'stores': [scope]}), 'draft': ''}
        with self.assertRaisesRegex(ValueError, 'fixture'):
            with broker.execution(self.engine, row, scope):
                with self.assertRaises(Rejected): broker.resolve(other)
                self.assertIn('seller_api_key', broker.resolve(scope))
                raise ValueError('fixture')
        self.assertIsNone(broker._CURRENT.get())

    def test_no_secret_in_public_projection_or_durable_job(self):
        store, _, _ = self.create(); self.run_report(store)
        public = json.dumps(stores.projection(store))
        with self.repo.connection() as conn:
            persisted = '\n'.join(str(tuple(row)) for table in ('jobs', 'calls', 'rt_job_receipts')
                for row in conn.execute('SELECT * FROM ' + table))
        for secret in ('synthetic-key-first', self.web_token):
            self.assertNotIn(secret, public + persisted)
        self.assertNotIn('synthetic-key-first', self.path.read_text())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(); original = socket.socket.connect
    def confined(peer, address):
        if peer.family == socket.AF_UNIX or peer.family == socket.AF_INET and address == ('127.0.0.1', 55480):
            return original(peer, address)
        raise AssertionError('External network forbidden')
    try:
        suite = unittest.TestSuite(EnrollmentChecks(name) for name in EnrollmentChecks.__dict__ if name.startswith('test_'))
        with patch.object(socket.socket, 'connect', confined), patch('socket.getaddrinfo', side_effect=AssertionError('DNS forbidden')):
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        args.output.write_text(json.dumps({'scope': 'STORE_ENROLLMENT_PG_UNIX_SYNTHETIC_HTTPS_NOT_INSTALLED',
            'status': 'PASS' if result.wasSuccessful() else 'FAILED', 'tests_run': result.testsRun,
            'failures': len(result.failures), 'errors': len(result.errors)}, indent=2) + '\n')
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:
        connections.close_all(); TEMP.cleanup()
