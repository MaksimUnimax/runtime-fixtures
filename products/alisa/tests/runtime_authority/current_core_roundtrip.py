#!/usr/bin/env python3
"""Current core + production consumer + real Django authority over Unix HTTP.

Scope conversion, nonce and HMAC validation use the production consumer source.
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
import socketserver
from unittest.mock import patch

from checks import (AuthorityFixture, AuthFlow, WebSession, AccessAdjustment, connections,
                    timezone, token_digest, uid, TEMP)
from alisa_platform.runtime_adapter.job_client import RuntimeClient, RuntimeFailure

SOURCE = Path(os.environ['ALISA_RT_JOB_TEST_SOURCE']).resolve()
manifest = (SOURCE / 'CURRENT_CORE_MANIFEST.json').read_bytes()
if hashlib.sha256(manifest).hexdigest() != os.environ['ALISA_RT_JOB_MANIFEST_SHA256']:
    raise RuntimeError('Wrong current-core manifest')
for name, expected in json.loads(manifest)['files'].items():
    path = SOURCE / name
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise RuntimeError('Modified current-core input')
sys.path[:0] = [str(SOURCE), str(SOURCE / 'tests')]
from test_runtime import Clock, FakeTransport
from repository import Repository
from engine import Engine, Worker
from semantics import Scope, Store, Rejected
from runtime_port import RuntimePort, Peer
from runtime_port_ipc import Gateway


from platform_authority_client import PlatformAuthorityClient
from django.conf import settings
from alisa_platform.runtime_adapter import authority_rpc
from django.test import RequestFactory


class AuthorityHTTP(socketserver.ThreadingUnixStreamServer):
    daemon_threads=True
    def __init__(self,path,authority):
        self.authority=authority
        super().__init__(path,AuthorityHandler)
        os.chmod(path,0o660)


class AuthorityHandler(socketserver.StreamRequestHandler):
    def handle(self):
        try:
            line=self.rfile.readline(8192)
            if line!=b'POST /internal/runtime/authority HTTP/1.1\r\n':return
            headers={}
            while True:
                line=self.rfile.readline(8192)
                if line==b'\r\n':break
                key,_,value=line.partition(b':');headers[key.lower()]=value.strip()
            body=self.rfile.read(int(headers[b'content-length']))
            request=RequestFactory().post('/internal/runtime/authority',data=body,
                content_type='application/json',HTTP_AUTHORIZATION=headers[b'authorization'].decode())
            with patch.object(authority_rpc,'configured_authority',return_value=self.server.authority):
                response=authority_rpc.check(request)
            raw=response.content
            head=(f'HTTP/1.1 {response.status_code} Reply\r\nContent-Type: application/json\r\n'
                  f'Content-Length: {len(raw)}\r\nConnection: close\r\n\r\n').encode()
            self.wfile.write(head+raw)
        finally:connections.close_all()


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
        authority_path=Path(self.socket_dir.name)/'authority.sock'
        self.authority_http=AuthorityHTTP(str(authority_path),self.authority)
        self.authority_thread=threading.Thread(target=self.authority_http.serve_forever,kwargs={'poll_interval':.01},daemon=True)
        self.authority_thread.start()
        self.bridge=PlatformAuthorityClient(str(authority_path),expected_uid=os.getuid(),
            service_token=settings.RUNTIME_AUTHORITY_TOKEN,service_id='fixture-platform')
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
        self.authority_http.shutdown();self.authority_http.server_close();self.authority_thread.join(timeout=2)
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

    def test_browser_and_alice_read_same_durable_result_without_recompute(self):
        receipt=self.submit();self.finish(receipt)
        browser=self.client.read_result(receipt['job_ref'])
        calls=len(self.transport.calls)
        authorizer,_,_,_=self.issue_alice();self.client.authorizer=authorizer
        voice=self.client.read_result(receipt['job_ref'])
        self.assertEqual(voice,browser)
        self.assertEqual(len(self.transport.calls),calls)
        with self.repo.connection()as conn:
            self.assertEqual(conn.execute('SELECT count(*)FROM jobs').fetchone()[0],1)

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

    def test_model_answer_is_shared_by_session_and_alice_without_recompute(self):
        from model_answer import Settings
        from test_model_answer import Transport
        import model_usage
        self.engine.answer_settings = Settings(Path(self.socket_dir.name) / 'answer-settings.json')
        self.repo.answer_settings = self.engine.answer_settings
        self.transport = Transport(); self.worker = Worker(self.engine, self.transport)
        question = 'сводка заказов за октябрь 2026 на озоне'
        receipt = self.submit(question); self.finish(receipt)
        result = self.client.read_result(receipt['job_ref'])
        self.client.authorizer, _, _, _ = self.issue_alice()
        self.assertEqual(self.client.read_result(receipt['job_ref']), result)
        self.assertEqual(''.join(result['pages']), self.transport.answer)
        self.assertEqual(self.transport.answer_calls[0].body['messages'][1]['content'], question)
        self.assertEqual(len(self.transport.answer_calls), 1)
        self.assertEqual(model_usage.summary(self.repo)['attempts'], 1)


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
        args.output.write_text(json.dumps({'scope': 'S07_CURRENT_CORE_POSTGRES_REAL_AUTHORITY_HTTP_UNIX_NOT_INSTALLED',
            'status': 'PASS' if result.wasSuccessful() else 'FAILED', 'tests_run': result.testsRun,
            'failures': len(result.failures), 'errors': len(result.errors)}, indent=2) + '\n')
        sys.exit(0 if result.wasSuccessful() else 1)
    finally:
        connections.close_all(); TEMP.cleanup()
