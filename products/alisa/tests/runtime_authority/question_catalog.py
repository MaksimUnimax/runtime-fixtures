#!/usr/bin/env python3
"""Catalog over real disposable PostgreSQL and Unix IPC, with no execution."""
import argparse
import hashlib
import json
import os
import pwd
from pathlib import Path
import socket
import threading
import unittest
from unittest.mock import patch

from query_roundtrip import QueryChecks, connections, TEMP, uid, timezone, AccessAdjustment
from checks import settings
from datetime import timedelta
from django.test import override_settings
from alisa_platform.catalog import views, reader
from alisa_platform.queries.models import Query
from alisa_platform.staff.models import StaffMember, StaffSession, StaffAuthFlow, StaffAuditEvent
from alisa_platform.runtime_adapter.job_client import RuntimeClient
import question_catalog_extension
import runtime_port_ipc


class CatalogChecks(QueryChecks):
    def setUp(self):
        super().setUp()
        self.engine.template_mode = True
        previous = runtime_port_ipc.dispatch
        self.unwrapped_dispatch = previous
        question_catalog_extension.install()
        self.addCleanup(setattr, runtime_port_ipc, 'dispatch', previous)
        config = override_settings(QUESTION_CATALOG_ENABLED=True, STAFF_ENABLED=True,
            STAFF_CLIENT_ID='fixture-staff', STAFF_SERVICE_TOKEN='S'*48)
        config.enable(); self.addCleanup(config.disable)

    def customer(self, **changes):
        body = {'session_token': self.web_token, 'store_id': str(self.store.pk),
                'query': {'search': 'B01.ordered_units', 'kind': '', 'offset': 0}, **changes}
        request = self.factory.post('/api/v1/account/question-catalog', data=json.dumps(body),
            content_type='application/json', HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN)
        return views.customer(request)

    def no_execution(self):
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())
        with self.repo.connection() as c:
            self.assertEqual(c.execute('SELECT count(*) FROM jobs').fetchone()[0], 0)
        self.assertEqual(self.transport.calls, [])

    def test_current_session_gets_owned_store_projection_over_real_ipc(self):
        for _ in range(2):
            response = self.customer(); self.assertEqual(response.status_code, 200)
            value = json.loads(response.content)
            self.assertEqual(value['items'][0]['id'], 'B01.ordered_units')
            self.assertEqual(value['items'][0]['availability'],
                             [{'store_id': str(self.store.pk), 'status': 'ELIGIBLE'}])
            self.assertNotIn('sources', value['items'][0])
        self.no_execution()

    def test_production_attach_installs_catalog_without_manual_install(self):
        from engine import Engine
        from repository import Repository
        from runtime_port_service import attach, close
        root = Path(self.socket_dir.name)
        credential = root/'catalog-authority'
        credential.write_text(settings.RUNTIME_AUTHORITY_TOKEN); credential.chmod(0o600)
        user = pwd.getpwuid(os.getuid()).pw_name
        engine = Engine(Repository(root/'attach.sqlite', self.clock),
                        lambda _: (_ for _ in ()).throw(AssertionError('Legacy scope')))
        engine.template_mode = True
        configuration = {'runtime_port': {'enabled':True, 'socket':str(root/'attach.sock'),
            'allowed_user':user, 'service_id':'fixture-platform', 'catalog_release_id':'fixture-catalog',
            'authority_socket':str(self.authority_http.server_address), 'authority_user':user,
            'authority_credential':'catalog-authority'}}
        runtime_port_ipc.dispatch = self.unwrapped_dispatch
        gateway = attach(engine, configuration, str(root))
        thread = threading.Thread(target=gateway.serve_forever, kwargs={'poll_interval':.01}, daemon=True)
        thread.start()
        try:
            api = RuntimeClient(str(root/'attach.sock'), os.getuid(), self.client.versions,
                                self.authorizer, clock=self.clock)
            value = reader.read(api, scoped=True, query={'search':'B01.ordered_units','kind':'','offset':0})
            self.assertEqual(value['items'][0]['availability'][0]['status'], 'ELIGIBLE')
            with engine.repo.connection() as c:
                self.assertEqual(c.execute('SELECT count(*) FROM jobs').fetchone()[0], 0)
        finally:
            gateway.shutdown(); close(gateway); thread.join(timeout=2)
        self.no_execution()

    def test_unknown_store_does_not_fall_back_to_own_store(self):
        self.assertIn(self.customer(store_id=uid()).status_code, (403, 404))
        self.no_execution()

    def test_revoked_entitlement_denies_catalog_without_execution(self):
        AccessAdjustment.objects.create(id=uid(), grant=self.grant, cutoff=self.grant.starts_at,
                                        actor_id=uid(), reason='FIXTURE_REVOKE')
        self.assertEqual(self.customer().status_code, 403)
        self.no_execution()

    def test_revocation_during_read_discards_the_response(self):
        original = RuntimeClient._exchange
        def revoke(api, operation, *args, **kwargs):
            value = original(api, operation, *args, **kwargs)
            if operation == 'question_catalog':
                AccessAdjustment.objects.create(id=uid(), grant=self.grant, cutoff=self.grant.starts_at,
                                                actor_id=uid(), reason='FIXTURE_REVOKE')
            return value
        with patch.object(RuntimeClient, '_exchange', revoke):
            self.assertEqual(self.customer().status_code, 403)
        self.no_execution()

    def test_disabled_feature_closes_boundary_before_ipc(self):
        with override_settings(QUESTION_CATALOG_ENABLED=False), patch.object(views, 'read', side_effect=AssertionError('IPC')):
            self.assertEqual(self.customer().status_code, 404)
        self.no_execution()

    def staff_session(self, role='OWNER'):
        token = uid()+uid(); now = timezone.now()
        member = StaffMember.objects.create(issuer=settings.IDENTITY_ISSUER,
            client_id=settings.STAFF_CLIENT_ID, subject=uid(), name='Catalog fixture',
            role=role, permissions=[])
        flow = StaffAuthFlow.objects.create(secret_hash=hashlib.sha256(uid().encode()).hexdigest(),
            encrypted_payload='', expires_at=now+timedelta(minutes=10), consumed_at=now)
        StaffSession.objects.create(member=member, flow=flow, token_hash=hashlib.sha256(token.encode()).hexdigest(),
            revision=1, mfa_verified_at=now, mfa_type='totp', encrypted_payload='',
            expires_at=now+timedelta(minutes=50))
        return token, member

    def staff_read(self, token):
        request = self.factory.post('/api/v1/staff/question-catalog',
            data=json.dumps({'session_token':token}), content_type='application/json',
            HTTP_AUTHORIZATION='Bearer '+settings.STAFF_SERVICE_TOKEN)
        return views.staff(request)

    def staff_client(self, authorizer):
        return RuntimeClient(str(self.gateway.server_address), self.client.uid,
                             self.client.versions, authorizer, clock=self.clock)

    def test_owner_reads_metadata_without_user_store_ticket(self):
        token, member = self.staff_session()
        with patch.object(views, 'configured_client', side_effect=self.staff_client):
            response = self.staff_read(token)
        self.assertEqual(response.status_code, 200)
        self.assertIn('sources', json.loads(response.content)['items'][0])
        self.assertTrue(StaffAuditEvent.objects.filter(actor_id=member.pk, action='catalog.read').exists())
        self.no_execution()

    def test_staff_without_owner_permission_cannot_read_metadata(self):
        token, _ = self.staff_session('ADMIN')
        with patch.object(views, 'configured_client', side_effect=AssertionError('IPC')):
            self.assertEqual(self.staff_read(token).status_code, 403)
        self.no_execution()

    def test_staff_revocation_during_ipc_discards_metadata(self):
        token, member = self.staff_session(); original = reader.read
        def revoke(*args, **kwargs):
            result = original(*args, **kwargs)
            member.active = False; member.save(update_fields=['active'])
            return result
        with patch.object(views, 'configured_client', side_effect=self.staff_client), patch.object(views, 'read', revoke):
            self.assertEqual(self.staff_read(token).status_code, 403)
        self.assertFalse(StaffAuditEvent.objects.filter(actor_id=member.pk, action='catalog.read').exists())
        self.no_execution()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True); args = parser.parse_args()
    connect = socket.socket.connect
    def confined(peer, address):
        if peer.family == socket.AF_UNIX or peer.family == socket.AF_INET and address == ('127.0.0.1', 55480):
            return connect(peer, address)
        raise AssertionError('External network forbidden')
    try:
        suite = unittest.TestSuite(CatalogChecks(name) for name in CatalogChecks.__dict__ if name.startswith('test_'))
        with patch.object(socket.socket, 'connect', confined), patch('socket.getaddrinfo', side_effect=AssertionError('DNS forbidden')):
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        args.output.write_text(json.dumps({'scope':'S11_CATALOG_DISPOSABLE_PG_UNIX_NO_EXECUTION',
            'status':'PASS' if result.wasSuccessful() else 'FAILED', 'tests_run':result.testsRun,
            'failures':len(result.failures), 'errors':len(result.errors)}, indent=2)+'\n')
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:
        connections.close_all(); TEMP.cleanup()
