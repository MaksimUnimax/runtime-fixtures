#!/usr/bin/env python3
"""Real Django/model/signer authority qualification on an owned disposable DB."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
import argparse
from datetime import timedelta
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import socket
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'services/platform/src'))
from django.conf import settings
if settings.configured:
    raise RuntimeError('Separate authority qualification process required')
# BindingFile deliberately requires every ancestor to be owned by root or the
# declared fixture uid. The CI browser qualifier runs as root from a runner-owned
# checkout, so its private fixture files must use a root-owned ancestor chain.
TEMP = tempfile.TemporaryDirectory(prefix='s07-authority-', dir=Path.home() if os.geteuid()==0 else ROOT)
PRIVATE = Path(TEMP.name)
if (os.environ.get('ALISA_AUTHORITY_CORE_TEST_ALLOW') != '1' or
        os.environ.get('ALISA_DB_NAME') != 'alisa_s07_authority_platform' or
        os.environ.get('ALISA_DB_USER') != 'alisa_s07_authority_platform_runtime' or
        os.environ.get('ALISA_DB_HOST') != '127.0.0.1' or os.environ.get('ALISA_DB_PORT') != '55480'):
    raise RuntimeError('Owned disposable authority PostgreSQL required')
os.environ['DJANGO_SETTINGS_MODULE'] = 'alisa_platform.config.settings'
import django
django.setup()
from django.core import signing
from django.core.management import call_command
from django.db import connection, connections, transaction, DatabaseError
from django.test import RequestFactory, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from alisa_platform.accounts.models import Customer, Tenant, Membership, AuthFlow, WebSession
from alisa_platform.accounts.views import digest as token_digest
from alisa_platform.alice_link.models import AliceLink, TokenFamily
from alisa_platform.entitlements.models import AccessGrant, AccessLedger, AccessAdjustment, AccessNotification
from alisa_platform.stores.models import Store, CredentialRevision, VaultSecret
from alisa_platform.runtime_adapter.authority import RuntimeAuthority, SALT, pins, digest
from alisa_platform.runtime_adapter.bindings import BindingFile
from alisa_platform.runtime_adapter.job_client import RuntimeFailure, encode
from alisa_platform.runtime_adapter import authority_rpc


def uid(): return str(uuid.uuid4())


class AuthorityFixture(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix='case-', dir=PRIVATE)
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / 'bindings.json'
        self.actor = Customer.objects.create(email='authority-' + secrets.token_hex(8) + '@example.invalid')
        self.tenant = Tenant.objects.create()
        Membership.objects.create(customer=self.actor, tenant=self.tenant)
        self.web_token = secrets.token_urlsafe(32)
        now = timezone.now()
        flow = AuthFlow.objects.create(secret_hash=token_digest(secrets.token_urlsafe(32)),
            encrypted_payload='', expires_at=now + timedelta(minutes=10))
        self.session = WebSession.objects.create(customer=self.actor, tenant=self.tenant, flow=flow,
            token_hash=token_digest(self.web_token), encrypted_payload='', security_revision=1,
            expires_at=now + timedelta(days=1))
        self.ledger = AccessLedger.objects.create(tenant=self.tenant)
        self.grant = AccessGrant.objects.create(tenant=self.tenant, source='GIFT', source_id=uuid.uuid4(),
            days=7, starts_at=now - timedelta(hours=1), ends_at=now + timedelta(days=6),
            actor_id=uuid.uuid4(), reason='INITIAL_TEST')
        self.store = Store.objects.create(tenant=self.tenant, provider='OZON', name='Fixture',
                                         verified_identity='ozon:client:fixture')
        self.credentials = []
        for kind in ['SELLER', 'PERFORMANCE']:
            secret = VaultSecret.objects.create(tenant=self.tenant, store=self.store, kind=kind,
                revision=1, key_version='fixture', ciphertext='fixture-not-decrypted')
            row = CredentialRevision.objects.create(tenant=self.tenant, store=self.store, kind=kind,
                revision=1, secret=secret, status='ACTIVE', check_code='CONNECTED_NATIVE_OWNER' if kind == 'PERFORMANCE' else 'CONNECTED')
            self.credentials.append(row)
        self.document = {'schema': 'alisa-runtime-bindings/v1', 'environment': 'dev',
            'service_id': 'fixture-platform', 'catalog_release_id': 'fixture-catalog', 'tenants': [{
                'tenant_id': str(self.tenant.pk), 'runtime_tenant': 'native-tenant', 'revision': 'native-access-1',
                'stores': [{'store_id': str(self.store.pk), 'provider': 'OZON',
                    'verified_identity': self.store.verified_identity, 'credential_revision': 7,
                    'credentials': [{'kind': row.kind, 'id': str(row.pk), 'revision': row.revision} for row in self.credentials],
                    'runtime_store': {'id': 'native-store', 'platform': 'ozon', 'identity': 'native-cabinet',
                        'access_revision': 'native-store-access-1', 'source_revision': 'native-credentials-1', 'currency': 'RUB'}}]}]}
        self.write()
        self.authority = RuntimeAuthority(BindingFile(str(self.path), owner_uid=os.getuid()),
            service_id='fixture-platform', catalog_release_id='fixture-catalog')
        self.authorizer = self.authority.for_session(self.web_token, [str(self.store.pk)])
        self.factory = RequestFactory()

    def write(self):
        self.path.write_text(json.dumps(self.document)); self.path.chmod(0o600)

    def context(self): return self.authorizer.prepare('submit')

    def deny(self, code, action):
        with self.assertRaises(RuntimeFailure) as error: action()
        self.assertEqual(error.exception.code, code)
        return error.exception

    def issue_alice(self):
        link = AliceLink.objects.create(customer=self.actor, tenant=self.tenant, client_id=settings.ALICE_CLIENT_ID,
            security_revision=self.actor.security_revision, authorized_at=timezone.now())
        token = 'as6_' + secrets.token_urlsafe(32)
        family = TokenFamily.objects.create(link=link, revision=link.revision, access_hash=token_digest(token),
            refresh_hash=token_digest(secrets.token_urlsafe(32)), access_expires_at=timezone.now() + timedelta(minutes=10),
            refresh_expires_at=timezone.now() + timedelta(days=14))
        return self.authority.for_alice(token, [str(self.store.pk)]), link, family, token

    def rpc(self, operation='verify', payload=None, **changes):
        body = {'schema': 'runtime_authority_v1', 'request_id': uid(), 'service_id': 'fixture-platform',
                'operation': operation, 'payload': payload or {'ticket': self.context()['execution_ticket']}}
        body.update(changes)
        request = self.factory.post('/internal/runtime/authority', data=json.dumps(body), content_type='application/json',
            HTTP_AUTHORIZATION='Bearer ' + settings.RUNTIME_AUTHORITY_TOKEN)
        with patch.object(authority_rpc, 'configured_authority', return_value=self.authority):
            response = authority_rpc.check(request)
        value = json.loads(response.content)
        if 'payload' in value:
            expected = hmac.new(settings.RUNTIME_AUTHORITY_TOKEN.encode(), encode(value['payload']), hashlib.sha256).hexdigest()
            self.assertEqual(value['mac'], expected)
            expected_id = body['request_id'] if set(body) == {'schema', 'request_id', 'service_id', 'operation', 'payload'} else None
            self.assertEqual(value['payload']['request_id'], expected_id)
        return response, value


class AuthorityChecks(AuthorityFixture):
    def test_concurrent_grant_and_notification_do_not_deadlock_authority(self):
        ledger_held, authority_at_ledger = threading.Event(), threading.Event()
        def grant_writer():
            try:
                with transaction.atomic():
                    with connection.cursor() as cursor: cursor.execute("SET LOCAL lock_timeout='5s'")
                    ledger = AccessLedger.objects.select_for_update().get(pk=self.ledger.pk)
                    ledger_held.set()
                    if not authority_at_ledger.wait(5): raise AssertionError('Authority did not reach ledger')
                    now = timezone.now()
                    grant = AccessGrant.objects.create(tenant=self.tenant, source='GIFT', source_id=uuid.uuid4(),
                        days=1, starts_at=now, ends_at=now + timedelta(days=1), actor_id=uuid.uuid4(), reason='CONCURRENT_TEST')
                    AccessNotification.objects.create(event_id=uuid.uuid4(), customer=self.actor, grant=grant, kind='GRANTED')
                    ledger.revision += 1; ledger.save(update_fields=['revision'])
                return 'COMMITTED'
            finally: connections.close_all()
        def authority_reader():
            def observed(execute, sql, params, many, context):
                if 'entitlements_accessledger' in sql.lower() and 'FOR UPDATE' in sql:
                    authority_at_ledger.set()
                return execute(sql, params, many, context)
            try:
                with connection.execute_wrapper(observed):
                    result = self.authority.state(str(self.actor.pk), str(self.tenant.pk), [str(self.store.pk)])
                return result[0]['access_revision']
            finally: connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:
            writer = pool.submit(grant_writer)
            self.assertTrue(ledger_held.wait(5))
            reader = pool.submit(authority_reader)
            self.assertEqual(writer.result(timeout=12), 'COMMITTED')
            self.assertEqual(reader.result(timeout=12), self.ledger.revision + 1)

    def test_valid_ticket_binding_outage_stays_dependency_error_in_rpc(self):
        ticket = self.context()['execution_ticket']; self.path.unlink()
        self.deny('DEPENDENCY_UNAVAILABLE', lambda: self.authority.verify(ticket, 'fixture-platform'))
        response, value = self.rpc(payload={'ticket': ticket})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(value['payload']['code'], 'DEPENDENCY_UNAVAILABLE')

    def test_valid_ticket_database_outage_is_not_auth_failure(self):
        ticket = self.context()['execution_ticket']
        with patch.object(self.authority, 'resolve', side_effect=DatabaseError('fixture-private-database-error')):
            error = self.deny('DEPENDENCY_UNAVAILABLE', lambda: self.authority.verify(ticket, 'fixture-platform'))
            self.assertNotIn('fixture-private', str(error))

    def test_principal_database_outage_during_prepare_is_dependency_error(self):
        with patch.object(self.authorizer.principal, 'current', side_effect=DatabaseError('fixture-private-database-error')):
            self.deny('DEPENDENCY_UNAVAILABLE', self.context)

    def test_principal_database_outage_during_current_is_dependency_error(self):
        context = self.context()
        with patch.object(self.authorizer.principal, 'current', side_effect=DatabaseError('fixture-private-database-error')):
            self.deny('DEPENDENCY_UNAVAILABLE', lambda: self.authorizer.current(context, 'read_result'))

    def test_real_session_ticket_and_explicit_native_mapping(self):
        ctx = self.context(); claims = self.authority.verify(ctx['execution_ticket'], 'fixture-platform')
        self.assertEqual(claims['actor_id'], str(self.actor.pk))
        scope = self.authority.resolve(pins(ctx), 'execute')
        self.assertEqual(scope['tenant'], 'native-tenant')
        self.assertEqual(scope['stores'][0]['id'], 'native-store')
        self.assertNotEqual(scope['tenant'], str(self.tenant.pk))
        self.assertTrue(self.authorizer.current(ctx, 'read_result'))

    def test_raw_session_and_bearer_are_not_in_ticket(self):
        ctx = self.context(); decoded = signing.loads(ctx['execution_ticket'], salt=SALT)
        self.assertNotIn(self.web_token, json.dumps(decoded))
        alice, _, _, token = self.issue_alice()
        ac = alice.prepare('submit'); self.assertNotIn(token, json.dumps(signing.loads(ac['execution_ticket'], salt=SALT)))

    def test_no_vault_decryption_or_secret_query(self):
        with CaptureQueriesContext(connection) as queries: self.context()
        sql = '\n'.join(row['sql'].lower() for row in queries)
        self.assertNotIn('stores_vaultsecret', sql); self.assertNotIn('ciphertext', sql)

    def test_wrong_session_denied(self):
        authorizer = self.authority.for_session(secrets.token_urlsafe(32), [str(self.store.pk)])
        self.deny('AUTH_REQUIRED', lambda: authorizer.prepare('submit'))

    def test_logout_revokes_admission_and_reader_not_durable_product_rights(self):
        ctx = self.context(); self.session.revoked_at = timezone.now(); self.session.save()
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ctx['execution_ticket'], 'fixture-platform'))
        self.assertFalse(self.authorizer.current(ctx, 'read_result'))
        self.assertEqual(self.authority.resolve(pins(ctx), 'execute')['tenant'], 'native-tenant')

    def test_expired_session_cannot_issue_ticket(self):
        self.session.expires_at = timezone.now() - timedelta(seconds=1); self.session.save()
        self.deny('AUTH_REQUIRED', self.context)

    def test_blocked_account_denies_existing_pins(self):
        ctx = self.context(); self.actor.is_active = False; self.actor.save()
        self.deny('ACCOUNT_BLOCKED', lambda: self.authority.resolve(pins(ctx), 'execute'))

    def test_changed_security_revision_denies_existing_pins(self):
        ctx = self.context(); self.actor.security_revision += 1; self.actor.save()
        self.deny('PERMISSION_DENIED', lambda: self.authority.resolve(pins(ctx), 'execute'))

    def test_removed_membership_denies(self):
        ctx = self.context(); Membership.objects.filter(customer=self.actor).update(role='OTHER')
        self.deny('PERMISSION_DENIED', lambda: self.authority.resolve(pins(ctx), 'execute'))

    def test_other_tenant_not_authorized_by_uuid(self):
        ctx = self.context(); ctx['tenant_id'] = str(Tenant.objects.create().pk)
        self.deny('PERMISSION_DENIED', lambda: self.authority.resolve(pins(ctx), 'read_result'))

    def test_revoked_grant_denies_even_without_revision_change(self):
        ctx = self.context()
        AccessAdjustment.objects.create(id=uuid.uuid4(), grant=self.grant, cutoff=self.grant.starts_at,
            actor_id=uuid.uuid4(), reason='TEST_REVOKE')
        self.deny('ACCESS_REQUIRED', lambda: self.authority.resolve(pins(ctx), 'execute'))

    def test_changed_ledger_revision_invalidates_old_pins(self):
        ctx = self.context(); self.ledger.revision += 1; self.ledger.save()
        self.deny('PERMISSION_DENIED', lambda: self.authority.resolve(pins(ctx), 'read_result'))

    def test_missing_access_ledger_has_no_implicit_revision(self):
        self.ledger.delete(); self.deny('ACCESS_REQUIRED', self.context)

    def test_disabled_store_denied(self):
        ctx = self.context(); self.store.status = 'DISABLED'; self.store.save()
        self.deny('PERMISSION_DENIED', lambda: self.authority.resolve(pins(ctx), 'execute'))

    def test_store_revision_change_denied(self):
        ctx = self.context(); self.store.revision += 1; self.store.save()
        self.deny('PERMISSION_DENIED', lambda: self.authority.resolve(pins(ctx), 'execute'))

    def test_foreign_store_not_silently_omitted(self):
        self.deny('NOT_FOUND', lambda: self.authority.state(str(self.actor.pk), str(self.tenant.pk), [uid()]))

    def test_revoked_or_unverified_credentials_denied(self):
        ctx = self.context(); row = self.credentials[0]; row.status = 'REVOKED'; row.save()
        self.deny('CREDENTIAL_REVOKED', lambda: self.authority.resolve(pins(ctx), 'execute'))

    def test_failed_credential_check_denied(self):
        self.credentials[0].check_code = 'AUTH_DENIED'; self.credentials[0].save()
        self.deny('CREDENTIAL_REVOKED', self.context)

    def test_replaced_credential_id_does_not_reuse_old_mapping(self):
        self.document['tenants'][0]['stores'][0]['credentials'][0]['id'] = uid(); self.write()
        self.deny('CREDENTIAL_REVOKED', self.context)

    def test_changed_mapping_invalidates_previously_issued_ticket(self):
        ctx = self.context()
        self.document['tenants'][0]['stores'][0]['runtime_store']['id'] = 'different-native-store'; self.write()
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ctx['execution_ticket'], 'fixture-platform'))
        self.assertFalse(self.authorizer.current(ctx, 'read_result'))

    def test_identity_label_cannot_create_mapping(self):
        self.document['tenants'][0]['stores'][0]['store_id'] = uid(); self.write()
        self.deny('CAPABILITY_UNAVAILABLE', self.context)

    def test_protected_file_missing_world_writable_symlink_and_wrong_uid_denied(self):
        self.path.chmod(0o666); self.deny('DEPENDENCY_UNAVAILABLE', self.context)
        self.path.chmod(0o600)
        original = self.authority.bindings.owner_uid; self.authority.bindings.owner_uid += 1
        self.deny('DEPENDENCY_UNAVAILABLE', self.context); self.authority.bindings.owner_uid = original
        real = self.path.with_name('real.json'); self.path.rename(real); self.path.symlink_to(real)
        self.deny('DEPENDENCY_UNAVAILABLE', self.context)

    def test_mapping_wrong_environment_service_catalog_and_unknown_fields_denied(self):
        for key in ['environment', 'service_id', 'catalog_release_id', 'extra']:
            with self.subTest(key=key):
                old = deepcopy(self.document); self.document[key] = 'incorrect'; self.write()
                self.deny('DEPENDENCY_UNAVAILABLE', self.context)
                self.document = old
        self.write()

    def test_duplicate_mapping_json_and_store_ids_denied(self):
        self.path.write_text('{"schema":1,"schema":2}'); self.path.chmod(0o600)
        self.deny('DEPENDENCY_UNAVAILABLE', self.context)
        self.document['tenants'][0]['stores'].append(deepcopy(self.document['tenants'][0]['stores'][0])); self.write()
        self.deny('DEPENDENCY_UNAVAILABLE', self.context)

    def test_signature_service_and_environment_are_pinned(self):
        ctx = self.context()
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ctx['execution_ticket'] + 'x', 'fixture-platform'))
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ctx['execution_ticket'], 'other-service'))
        with override_settings(ALISA_ENV='prod'):
            self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ctx['execution_ticket'], 'fixture-platform'))

    def test_expired_and_future_dated_signed_claims_denied(self):
        value = signing.loads(self.context()['execution_ticket'], salt=SALT)
        value['claims']['not_after'] = (timezone.now() - timedelta(seconds=1)).isoformat().replace('+00:00', 'Z')
        ticket = signing.dumps(value, salt=SALT)
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ticket, 'fixture-platform'))
        value['issued_at'] = int(time.time()) + 30
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(signing.dumps(value, salt=SALT), 'fixture-platform'))

    def test_timestamp_signer_expiry_is_enforced(self):
        value = signing.loads(self.context()['execution_ticket'], salt=SALT)
        earlier = time.time() - 121
        with patch('django.core.signing.time.time', return_value=earlier): ticket = signing.dumps(value, salt=SALT)
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ticket, 'fixture-platform'))

    def test_alice_oauth_grant_and_unlink_use_existing_library_validation(self):
        authorizer, link, _, _ = self.issue_alice(); ctx = authorizer.prepare('submit')
        self.assertTrue(authorizer.current(ctx, 'read_result'))
        link.revoked_at = timezone.now(); link.revision += 1; link.save()
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ctx['execution_ticket'], 'fixture-platform'))
        self.assertFalse(authorizer.current(ctx, 'read_result'))

    def test_refresh_replacement_invalidates_prior_ticket_principal_proof(self):
        authorizer, _, family, _ = self.issue_alice(); ctx = authorizer.prepare('submit')
        family.access_hash = token_digest('as6_' + secrets.token_urlsafe(32)); family.save()
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ctx['execution_ticket'], 'fixture-platform'))

    def test_disabled_skill_boundary_revokes_skill_admission_and_reader(self):
        authorizer, _, _, _ = self.issue_alice(); ctx = authorizer.prepare('submit')
        with override_settings(ALICE_LINK_ENABLED=False):
            self.deny('AUTH_REQUIRED', lambda: authorizer.prepare('submit'))
            self.deny('AUTH_REQUIRED', lambda: self.authority.verify(ctx['execution_ticket'], 'fixture-platform'))
            self.assertFalse(authorizer.current(ctx, 'read_result'))

    def test_skill_client_change_denies_old_grant_and_ticket(self):
        authorizer, _, _, _ = self.issue_alice(); ctx = authorizer.prepare('submit')
        with override_settings(ALICE_CLIENT_ID='other-client'):
            for action in [lambda: authorizer.prepare('submit'),
                           lambda: self.authority.verify(ctx['execution_ticket'], 'fixture-platform')]:
                with self.subTest(action=action): self.deny('AUTH_REQUIRED', action)

    def test_shape_valid_untrusted_ticket_never_authorizes(self):
        self.deny('AUTH_REQUIRED', lambda: self.authority.verify('shape-only-not-signed', 'fixture-platform'))

    def test_rpc_verify_and_resolve_return_signed_nonce_bound_results(self):
        response, value = self.rpc(); self.assertEqual(response.status_code, 200)
        self.assertTrue(value['payload']['ok'])
        response, value = self.rpc('resolve', {'pins': pins(self.context()), 'action': 'execute'})
        self.assertEqual(value['payload']['data']['tenant'], 'native-tenant')

    def test_rpc_denial_is_signed_without_echoing_private_input(self):
        response, value = self.rpc(payload={'ticket': 'fixture-private-input-not-for-errors'})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('fixture-private-input', json.dumps(value))
        self.assertFalse(value['payload']['ok'])

    def test_rpc_wrong_service_and_unknown_fields_are_denied(self):
        response, _ = self.rpc(service_id='other'); self.assertEqual(response.status_code, 422)
        response, _ = self.rpc(unexpected='fixture-secret'); self.assertEqual(response.status_code, 422)

    def test_rpc_wrong_service_credential_and_browser_origin_denied(self):
        request = self.factory.post('/internal/runtime/authority', data='{}', content_type='application/json',
            HTTP_AUTHORIZATION='Bearer ' + settings.AUTH_SERVICE_TOKEN)
        self.assertEqual(authority_rpc.check(request).status_code, 401)
        request = self.factory.post('/internal/runtime/authority', data='{}', content_type='application/json',
            HTTP_AUTHORIZATION='Bearer ' + settings.RUNTIME_AUTHORITY_TOKEN, HTTP_ORIGIN='https://example.invalid')
        self.assertEqual(authority_rpc.check(request).status_code, 422)

    def test_rpc_oversize_duplicate_and_bad_json_denied(self):
        for raw in ['x' * 131073, '{"schema":1,"schema":2}', '{"n":NaN}']:
            request = self.factory.post('/internal/runtime/authority', data=raw, content_type='application/json',
                HTTP_AUTHORIZATION='Bearer ' + settings.RUNTIME_AUTHORITY_TOKEN)
            self.assertEqual(authority_rpc.check(request).status_code, 422)

    def test_feature_off_has_no_database_effect(self):
        with override_settings(RUNTIME_AUTHORITY_ENABLED=False):
            with CaptureQueriesContext(connection) as queries:
                request = self.factory.post('/internal/runtime/authority', data='{}', content_type='application/json')
                self.assertEqual(authority_rpc.check(request).status_code, 404)
                self.deny('CAPABILITY_UNAVAILABLE', self.context)
            self.assertEqual(len(queries), 0)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    original = socket.socket.connect
    def no_network(peer, address):
        if peer.family == socket.AF_INET and address == ('127.0.0.1', 55480):
            return original(peer, address)
        raise AssertionError('External network is forbidden in authority core qualification')
    try:
        with patch.object(socket.socket, 'connect', no_network), patch('socket.getaddrinfo', side_effect=AssertionError('DNS forbidden')):
            suite = unittest.defaultTestLoader.loadTestsFromTestCase(AuthorityChecks)
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps({'scope': 'S07_DISPOSABLE_POSTGRES_AUTHORITY_NOT_INSTALLED',
            'status': 'PASS' if result.wasSuccessful() else 'FAILED', 'tests_run': result.testsRun,
            'failures': len(result.failures), 'errors': len(result.errors)}, indent=2) + '\n')
        sys.exit(0 if result.wasSuccessful() else 1)
    finally:
        connections.close_all(); TEMP.cleanup()
