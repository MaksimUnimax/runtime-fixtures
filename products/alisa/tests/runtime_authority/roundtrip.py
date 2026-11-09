#!/usr/bin/env python3
"""DB-backed authority + pinned R01.1 queue/worker/Unix IPC; fake provider only.

The Scope conversion is a qualification fixture, not an installed runtime bridge.
"""
import argparse
from datetime import timedelta
import hashlib
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

from checks import (AuthorityFixture, AuthFlow, WebSession, AccessAdjustment, connections,
                    timezone, token_digest, uid, TEMP)
from alisa_platform.runtime_adapter.job_client import RuntimeClient, RuntimeFailure

SOURCE = Path(os.environ['ALISA_RT_JOB_TEST_SOURCE']).resolve()
manifest = (SOURCE / 'MANIFEST.json').read_bytes()
if hashlib.sha256(manifest).hexdigest() != '41229162f2d886cfea4300e4b33d8f72e57fc31d586e30312923471a945773da':
    raise RuntimeError('Wrong RT-JOB manifest')
for name, expected in json.loads(manifest).items():
    path = SOURCE / name
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError('Modified RT-JOB input')
sys.path[:0] = [str(SOURCE), str(SOURCE / 'tests')]
from test_runtime import Clock, FakeTransport
from repository import Repository
from engine import Engine, Worker
from semantics import Scope, Store, Rejected
from runtime_port import RuntimePort, Peer
from runtime_port_ipc import Gateway


class AuthorityBridge:
    def __init__(self, authority): self.authority = authority

    def verify(self, ticket, service_id):
        try: return self.authority.verify(ticket, service_id)
        except RuntimeFailure as failure: raise Rejected(failure.code) from None

    def resolve(self, pins, action):
        try:
            scope = self.authority.resolve(pins, action)
            return Scope(scope['tenant'], scope['revision'], tuple(Store(**s) for s in scope['stores']))
        except RuntimeFailure as failure: raise Rejected(failure.code) from None


class ClosingGateway(Gateway):
    def process_request_thread(self, request, address):
        try: super().process_request_thread(request, address)
        finally: connections.close_all()


class RoundtripChecks(AuthorityFixture):
    def setUp(self):
        super().setUp()
        self.socket_dir = tempfile.TemporaryDirectory(prefix='s07-ipc-')
        self.addCleanup(self.socket_dir.cleanup)
        self.clock = Clock(); self.clock.now = time.time()
        self.repo = Repository(Path(self.folder.name) / 'jobs.sqlite', self.clock)
        self.bridge = AuthorityBridge(self.authority)
        # All execution must flow through RuntimePort's current-policy guard.
        def no_legacy_scope(_): raise AssertionError('Legacy scope bypass')
        self.engine = Engine(self.repo, no_legacy_scope)
        self.port = RuntimePort(self.engine, self.bridge,
            service_id='fixture-platform', catalog_release_id='fixture-catalog')
        self.peer = Peer('fixture-platform', 'alisa_market')
        self.transport = FakeTransport(); self.worker = Worker(self.engine, self.transport)
        path = Path(self.socket_dir.name) / 'runtime.sock'
        self.gateway = ClosingGateway(str(path), self.port, allowed_uid=os.getuid(), service_id='fixture-platform')
        self.thread = threading.Thread(target=self.gateway.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()
        self.client = RuntimeClient(str(path), os.getuid(), self.port.versions_for(self.peer), self.authorizer,
                                    clock=self.clock)

    def tearDown(self):
        self.gateway.shutdown(); self.gateway.server_close(); self.thread.join(timeout=2)
        connections.close_all()

    def submit(self, query='сводка заказов за октябрь 2026 на озоне', **ids):
        return self.client.submit(query, **(ids or dict(request_id=uid(), logical_query_id=uid(), trace_id=uid())))

    def row(self, receipt):
        with self.repo.connection() as conn:
            return dict(conn.execute('SELECT j.* FROM jobs j JOIN rt_job_refs r ON r.jid=j.id WHERE r.ref=?',
                                     [receipt['job_ref']]).fetchone())

    def finish(self, receipt):
        for _ in range(8):
            if self.row(receipt)['state'] not in {'QUEUED', 'RUNNING'}: break
            self.worker.step(); self.clock.advance(3)
        self.assertEqual(self.row(receipt)['state'], 'READY')

    def test_session_to_real_queue_worker_and_repeated_read(self):
        receipt = self.submit(); self.finish(receipt)
        calls = len(self.transport.calls)
        result = self.client.read_result(receipt['job_ref'])
        self.assertTrue(result['complete'])
        self.assertEqual(self.client.read_result(receipt['job_ref']), result)
        self.assertEqual(len(self.transport.calls), calls)
        with self.repo.connection() as conn:
            raw = '\n'.join(str(tuple(row)) for table in ['jobs', 'rt_job_refs', 'rt_job_receipts']
                            for row in conn.execute('SELECT * FROM ' + table))
        self.assertNotIn(self.web_token, raw)
        self.assertNotIn('execution_ticket', raw)

    def test_alice_oauth_to_real_queue_and_result(self):
        authorizer, _, _, _ = self.issue_alice(); self.client.authorizer = authorizer
        receipt = self.submit(); self.finish(receipt)
        self.assertTrue(self.client.read_result(receipt['job_ref'])['complete'])

    def test_revocation_before_dispatch_makes_zero_provider_calls(self):
        receipt = self.submit()
        AccessAdjustment.objects.create(id=uid(), grant=self.grant, cutoff=self.grant.starts_at,
                                        actor_id=uid(), reason='FIXTURE_REVOKE')
        self.worker.step()
        self.assertEqual(len(self.transport.calls), 0)
        self.assertEqual(self.row(receipt)['state'], 'FAILED')

    def test_mapping_change_without_generation_bump_denies_dispatch(self):
        receipt = self.submit()
        self.document['tenants'][0]['stores'][0]['runtime_store']['id'] = 'other-native-id'; self.write()
        self.worker.step()
        self.assertEqual(len(self.transport.calls), 0)
        self.assertEqual(self.row(receipt)['state'], 'FAILED')

    def test_key_revocation_during_provider_call_prevents_result_release(self):
        receipt = self.submit()
        def revoke(request):
            if request.operation == 'deepseek_parse': return
            row = self.credentials[0]; row.status = 'REVOKED'; row.save()
        self.transport.on_call = revoke
        for _ in range(8):
            if self.row(receipt)['state'] not in {'QUEUED', 'RUNNING'}: break
            self.worker.step(); self.clock.advance(3)
        self.assertTrue(any(call.operation != 'deepseek_parse' for call in self.transport.calls))
        self.assertEqual(self.row(receipt)['state'], 'FAILED')
        self.deny('CREDENTIAL_REVOKED', lambda: self.client.read_result(receipt['job_ref']))

    def test_another_current_session_can_read_after_original_logout(self):
        receipt = self.submit()
        self.session.revoked_at = timezone.now(); self.session.save()
        self.finish(receipt)
        self.deny('AUTH_REQUIRED', lambda: self.client.read_result(receipt['job_ref']))
        token = secrets.token_urlsafe(32)
        flow = AuthFlow.objects.create(secret_hash=token_digest(secrets.token_urlsafe(32)), encrypted_payload='',
                                       expires_at=timezone.now() + timedelta(minutes=10))
        WebSession.objects.create(customer=self.actor, tenant=self.tenant, flow=flow, token_hash=token_digest(token),
            encrypted_payload='', security_revision=self.actor.security_revision, expires_at=timezone.now() + timedelta(days=1))
        self.client.authorizer = self.authority.for_session(token, [str(self.store.pk)])
        self.assertTrue(self.client.read_result(receipt['job_ref'])['complete'])

    def test_natural_ticket_expiry_does_not_cancel_accepted_job(self):
        receipt = self.submit(); self.clock.advance(121)
        self.finish(receipt)
        self.assertGreater(len(self.transport.calls), 0)
        self.assertEqual(self.row(receipt)['state'], 'READY')

    def test_same_request_is_durable_once_with_real_authority(self):
        ids = dict(request_id=uid(), logical_query_id=uid(), trace_id=uid())
        first = self.submit(**ids); self.assertEqual(self.submit(**ids), first)
        with self.repo.connection() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    original = socket.socket.connect
    def confined(peer, address):
        if peer.family == socket.AF_UNIX or (peer.family == socket.AF_INET and address == ('127.0.0.1', 55480)):
            return original(peer, address)
        raise AssertionError('External network forbidden')
    try:
        with patch.object(socket.socket, 'connect', confined), patch('socket.getaddrinfo', side_effect=AssertionError('DNS forbidden')):
            result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(RoundtripChecks))
        args.output.write_text(json.dumps({'scope': 'S07_POSTGRES_AUTHORITY_PINNED_R01_UNIX_NOT_INSTALLED',
            'status': 'PASS' if result.wasSuccessful() else 'FAILED', 'tests_run': result.testsRun,
            'failures': len(result.failures), 'errors': len(result.errors)}, indent=2) + '\n')
        sys.exit(0 if result.wasSuccessful() else 1)
    finally:
        connections.close_all(); TEMP.cleanup()
