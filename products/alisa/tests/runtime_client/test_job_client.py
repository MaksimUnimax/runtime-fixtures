"""Platform client against the original offline RT-JOB queue and Unix server.

ALISA_RT_JOB_TEST_SOURCE must point to the verified RT-JOB-R01.1 package.
Authority/provider are synthetic; no production configuration is imported.
"""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import socket
import socketserver
import sys
import threading
import time
import unittest
from unittest.mock import patch
from uuid import uuid4

SOURCE = Path(os.environ['ALISA_RT_JOB_TEST_SOURCE']).resolve()
SCHEMA_HASH = '08b4b6c708c5ae1d5387dbd593fde7ea40c9f671efdad8b9aacbcab9bd683d34'
if hashlib.sha256((SOURCE / 'runtime_task_v1.schema.json').read_bytes()).hexdigest() != SCHEMA_HASH:
    raise RuntimeError('Wrong RT-JOB input')
manifest = (SOURCE / 'MANIFEST.json').read_bytes()
if hashlib.sha256(manifest).hexdigest() != '41229162f2d886cfea4300e4b33d8f72e57fc31d586e30312923471a945773da':
    raise RuntimeError('Wrong RT-JOB manifest')
for name, digest in json.loads(manifest).items():
    path = SOURCE / name
    if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError('Modified RT-JOB input')
sys.path[:0] = [str(SOURCE), str(SOURCE / 'tests')]
from test_runtime_port import Setup, uid
from runtime_port_contract import utc
from runtime_port_ipc import Gateway, dispatch, error_response
from semantics import Rejected
from alisa_platform.runtime_adapter.job_client import RuntimeClient, RuntimeFailure, MAX_RESPONSE


class PlatformAuthority:
    """Fixture only. A real issuer/mapping is a separate integration prerequisite."""
    def __init__(self, case):
        self.case, self.revoked, self.after = case, False, None

    def prepare(self, operation):
        ctx = deepcopy(self.case.ctx)
        ctx['not_after'] = utc(self.case.clock() + 120)
        return self.case.auth.issue(ctx)

    def current(self, context, operation):
        return not self.revoked


class Responder(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    def __init__(self, path, callback):
        self.callback, self.calls = callback, []
        super().__init__(str(path), ResponseHandler)
        os.chmod(path, 0o600)


class ResponseHandler(socketserver.StreamRequestHandler):
    def handle(self):
        request = json.loads(self.rfile.readline(262145))
        self.server.calls.append(request['operation'])
        response = self.server.callback(request)
        if response is None: return
        if isinstance(response, tuple) and response[0] == 'trickle':
            try:
                for char in response[1]:
                    self.wfile.write(bytes([char])); self.wfile.flush(); time.sleep(.01)
            except OSError: pass
            return
        raw = response if isinstance(response, bytes) else json.dumps(response).encode() + b'\n'
        try: self.wfile.write(raw)
        except OSError: pass


class ClientTests(Setup):
    def setUp(self):
        super().setUp()
        original_connect = socket.socket.connect
        def unix_only(peer, address):
            if peer.family != socket.AF_UNIX: raise AssertionError('External network forbidden')
            return original_connect(peer, address)
        guard = patch.object(socket.socket, 'connect', unix_only)
        guard.start(); self.addCleanup(guard.stop)
        dns = patch('socket.getaddrinfo', side_effect=AssertionError('DNS forbidden'))
        dns.start(); self.addCleanup(dns.stop)
        self.path = self.root / 'runtime.sock'
        self.authorizer = PlatformAuthority(self)
        self.server = Gateway(str(self.path), self.port, allowed_uid=os.getuid(), service_id='fixture-platform')
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()
        self.client = self.new_client()

    def new_client(self, **options):
        return RuntimeClient(str(self.path), os.getuid(), self.port.versions_for(self.peer),
                             self.authorizer, clock=self.clock, **options)

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=2)
        super().tearDown()

    def ids(self):
        return dict(request_id=uid(), logical_query_id=uid(), trace_id=uid())

    def accepted(self, **ids):
        return self.client.submit('сводка заказов за октябрь 2026 на озоне', **(ids or self.ids()))

    def replace_server(self, callback):
        self.server.shutdown(); self.server.server_close(); self.thread.join(timeout=2)
        self.path.unlink()
        self.server = Responder(self.path, callback)
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
        self.thread.start()

    def actual_reply(self, request):
        try:
            return {'ok': True, 'data': dispatch(self.port, self.peer, request)}
        except Rejected as e:
            return error_response(e.code)

    def failure(self, code, call, *, outcome=None):
        with self.assertRaises(RuntimeFailure) as raised: call()
        self.assertEqual(raised.exception.code, code)
        self.assertFalse(raised.exception.retryable)
        if outcome: self.assertEqual(raised.exception.outcome, outcome)
        return raised.exception

    def test_versions_and_capabilities_use_real_peer(self):
        self.assertEqual(self.client.current_versions(), self.port.versions_for(self.peer))
        self.assertEqual(self.client.capabilities()['query_input_kinds'], ['utterance'])

    def test_one_report_shared_ref_without_recalculation(self):
        ids = self.ids(); first = self.accepted(**ids)
        self.assertEqual(self.accepted(**ids)['job_ref'], first['job_ref'])
        self.assertEqual(self.count('jobs'), 1)
        self.finish(first)
        calls = len(self.transport.calls)
        value = self.client.read_result(first['job_ref'])
        self.assertTrue(value['complete'])
        self.assertEqual(self.client.read_result(first['job_ref']), value)
        self.assertEqual(len(self.transport.calls), calls)
        self.assertEqual(self.count('jobs'), 1)

    def test_changed_body_same_request_is_rejected(self):
        ids = self.ids(); self.accepted(**ids)
        self.failure('IDEMPOTENCY_CONFLICT', lambda: self.client.submit('заказы за вчера на озоне', **ids), outcome='REJECTED')
        self.assertEqual(self.count('jobs'), 1)

    def test_lost_accept_response_is_unknown_then_same_id_recovers(self):
        lost = []
        def response(request):
            answer = self.actual_reply(request)
            if request['operation'] == 'submit' and not lost:
                lost.append(answer); return None
            return answer
        self.replace_server(response)
        ids = self.ids()
        self.failure('DEPENDENCY_UNAVAILABLE', lambda: self.accepted(**ids), outcome='UNKNOWN')
        self.assertEqual(self.server.calls.count('submit'), 1)
        self.assertEqual(self.count('jobs'), 1)
        receipt = self.accepted(**ids)
        self.assertEqual(receipt, lost[0]['data'])
        self.assertEqual(self.count('jobs'), 1)

    def test_error_envelope_after_durable_submit_remains_unknown(self):
        lost = []
        def response(request):
            answer = self.actual_reply(request)
            if request['operation'] == 'submit' and not lost:
                lost.append(answer); return error_response('DEPENDENCY_UNAVAILABLE')
            return answer
        self.replace_server(response); ids = self.ids()
        self.failure('DEPENDENCY_UNAVAILABLE', lambda: self.accepted(**ids), outcome='UNKNOWN')
        self.assertEqual(self.count('jobs'), 1)
        self.assertEqual(self.server.calls.count('submit'), 1)
        self.assertEqual(self.accepted(**ids), lost[0]['data'])
        self.assertEqual(self.count('jobs'), 1)

    def test_error_envelope_after_durable_cancel_remains_unknown(self):
        receipt = self.accepted(); lost = []
        def response(request):
            answer = self.actual_reply(request)
            if request['operation'] == 'cancel' and not lost:
                lost.append(answer); return error_response('DEPENDENCY_UNAVAILABLE')
            return answer
        self.replace_server(response); rid = uid()
        self.failure('DEPENDENCY_UNAVAILABLE', lambda: self.client.cancel(receipt['job_ref'], request_id=rid), outcome='UNKNOWN')
        self.assertEqual(self.server.calls.count('cancel'), 1)
        self.assertEqual(self.client.cancel(receipt['job_ref'], request_id=rid), lost[0]['data'])

    def test_result_expiring_during_final_authority_check_is_not_released(self):
        receipt = self.accepted(); self.finish(receipt)
        with self.repo.connection(True) as conn:
            conn.execute('UPDATE jobs SET expires=? WHERE id=?', (self.clock() + 1, self.inner_id(receipt)))
        checks = []
        def current(context, operation):
            checks.append(operation)
            if len(checks) == 2: self.clock.advance(2)
            return True
        calls = len(self.transport.calls)
        with patch.object(self.authorizer, 'current', side_effect=current):
            self.failure('RESULT_EXPIRED', lambda: self.client.read_result(receipt['job_ref']))
        self.assertEqual(len(self.transport.calls), calls)

    def test_dependency_in_final_authority_check_is_not_permission_denial(self):
        receipt = self.accepted(); self.finish(receipt); checks = []
        def current(context, operation):
            checks.append(operation)
            if len(checks) == 2: raise RuntimeFailure('DEPENDENCY_UNAVAILABLE')
            return True
        with patch.object(self.authorizer, 'current', side_effect=current):
            self.failure('DEPENDENCY_UNAVAILABLE', lambda: self.client.read_result(receipt['job_ref']))

    def test_dependency_after_acceptance_keeps_mutation_unknown(self):
        checks = []
        def current(context, operation):
            checks.append(operation)
            if len(checks) == 2: raise RuntimeFailure('DEPENDENCY_UNAVAILABLE')
            return True
        with patch.object(self.authorizer, 'current', side_effect=current):
            self.failure('DEPENDENCY_UNAVAILABLE', self.accepted, outcome='UNKNOWN')
        self.assertEqual(self.count('jobs'), 1)

    def test_unexpected_authority_outage_before_call_is_dependency_error(self):
        with patch.object(self.authorizer, 'prepare', side_effect=TimeoutError('fixture-private')):
            self.failure('DEPENDENCY_UNAVAILABLE', self.accepted, outcome='NOT_SENT')
        self.assertEqual(self.count('jobs'), 0)

    def test_revoked_runtime_authority_denies_even_valid_ticket(self):
        receipt = self.accepted(); self.auth.revoked = True
        self.failure('ACCESS_REQUIRED', lambda: self.client.status(receipt['job_ref']), outcome='REJECTED')

    def test_platform_revocation_before_call_never_submits(self):
        self.authorizer.revoked = True
        self.failure('PERMISSION_DENIED', self.accepted)
        self.assertEqual(self.count('jobs'), 0)

    def test_platform_revocation_during_read_prevents_release(self):
        receipt = self.accepted(); self.finish(receipt)
        def response(request):
            answer = self.actual_reply(request)
            if request['operation'] == 'read_result': self.authorizer.revoked = True
            return answer
        self.replace_server(response)
        self.failure('PERMISSION_DENIED', lambda: self.client.read_result(receipt['job_ref']), outcome='REJECTED')

    def test_expired_result_is_not_recomputed(self):
        receipt = self.accepted(); self.finish(receipt)
        self.clock.advance(86400)
        calls = len(self.transport.calls)
        self.failure('RESULT_EXPIRED', lambda: self.client.read_result(receipt['job_ref']), outcome='REJECTED')
        self.assertEqual(len(self.transport.calls), calls)

    def test_cancel_is_scoped_to_ref_and_request_id(self):
        receipt = self.accepted(); cancel_id = uid()
        answer = self.client.cancel(receipt['job_ref'], request_id=cancel_id)
        self.assertTrue(answer['cancelled'])
        self.assertEqual(self.client.cancel(receipt['job_ref'], request_id=cancel_id), answer)
        self.assertEqual(self.client.status(receipt['job_ref'])['state'], 'CANCELLED')

    def test_foreign_ref_is_not_found(self):
        self.failure('NOT_FOUND', lambda: self.client.status(uid()), outcome='REJECTED')

    def test_other_actor_cannot_read_existing_ref(self):
        receipt = self.accepted(); self.ctx['actor_id'] = uid()
        self.failure('NOT_FOUND', lambda: self.client.status(receipt['job_ref']), outcome='REJECTED')

    def test_changed_credential_revision_revokes_prior_ref(self):
        receipt = self.accepted()
        self.ctx['store_scope'][0]['credential_revision'] += 1
        self.failure('PERMISSION_DENIED', lambda: self.client.status(receipt['job_ref']), outcome='REJECTED')

    def test_wrong_uid_and_world_writable_parent_fail_before_send(self):
        self.client.uid += 1
        self.failure('AUTH_REQUIRED', self.accepted)
        self.client.uid -= 1; self.root.chmod(0o777)
        try: self.failure('AUTH_REQUIRED', self.accepted)
        finally: self.root.chmod(0o700)
        self.assertEqual(self.count('jobs'), 0)

    def test_process_binding_change_requires_new_handshake(self):
        self.client.current_versions(); self.client._pid = -1
        self.failure('CATALOG_INCOMPATIBLE', self.accepted)
        self.assertEqual(self.count('jobs'), 0)

    def test_version_drift_prevents_submit(self):
        def response(request):
            answer = self.actual_reply(request)
            if request['operation'] == 'current_versions': answer['data']['catalog_bundle_hash'] = 'a' * 64
            return answer
        self.replace_server(response)
        self.failure('CATALOG_INCOMPATIBLE', self.accepted)
        self.assertNotIn('submit', self.server.calls)

    def test_malformed_responses_do_not_retry_mutation(self):
        malformed = [b'{"ok":true,"ok":false}\n', b'{"ok":NaN}\n', b'not-json\n',
                     b'{"ok":true,"data":{"secret":"fixture-private"}}\n', b'x' * (MAX_RESPONSE + 1)]
        for raw in malformed:
            with self.subTest(raw_length=len(raw)):
                def response(request):
                    if request['operation'] == 'submit': return raw
                    return self.actual_reply(request)
                self.replace_server(response); self.client = self.new_client()
                error = self.failure('DEPENDENCY_UNAVAILABLE', self.accepted, outcome='UNKNOWN')
                self.assertNotIn('fixture-private', str(error))
                self.assertEqual(self.server.calls.count('submit'), 1)

    def test_whole_exchange_deadline_does_not_reset_per_byte(self):
        def response(request):
            if request['operation'] == 'submit': return ('trickle', json.dumps(self.actual_reply(request)).encode() + b'\n')
            return self.actual_reply(request)
        self.replace_server(response); self.client = self.new_client(timeout=.04)
        started = time.monotonic()
        self.failure('DEPENDENCY_UNAVAILABLE', self.accepted, outcome='UNKNOWN')
        self.assertLess(time.monotonic() - started, .13)
        self.assertEqual(self.server.calls.count('submit'), 1)

    def test_wrong_result_ref_is_not_exposed(self):
        receipt = self.accepted(); self.finish(receipt)
        def response(request):
            answer = self.actual_reply(request)
            if request['operation'] == 'read_result': answer['data']['job_ref'] = uid()
            return answer
        self.replace_server(response)
        self.failure('DEPENDENCY_UNAVAILABLE', lambda: self.client.read_result(receipt['job_ref']))

    def test_invalid_context_is_rejected_without_network_effect(self):
        original = self.authorizer.prepare
        for field, value in [('security_revision', True), ('access_revision', 0),
                             ('business_timezone', 'UTC'), ('not_after', utc(self.clock() - 1))]:
            with self.subTest(field=field):
                self.authorizer.prepare = lambda op, f=field, v=value: {**original(op), f: v}
                with self.assertRaises(RuntimeFailure): self.accepted()
        self.authorizer.prepare = original
        self.assertEqual(self.count('jobs'), 0)

    def test_missing_authority_has_no_permissive_fallback(self):
        with self.assertRaises(RuntimeFailure):
            RuntimeClient(str(self.path), os.getuid(), self.port.versions_for(self.peer), None)


if __name__ == '__main__': unittest.main(verbosity=2)
