import copy
import http.server
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
import uuid
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from shared_http import read_response
from store_checker import Checker, error_code, loads, validate, safe_result
from store_check_ipc import Server, child_check


def message(kind='WB'):
    return {'schema_version': 'rt_check_v1', 'operation': 'check_store',
        'pins': {'environment': 'dev', 'product_id': 'alisa_market', 'tenant_id': str(uuid.uuid4()),
            'store_id': str(uuid.uuid4()), 'request_id': str(uuid.uuid4()), 'provider': 'WB' if kind == 'WB' else 'OZON',
            'kind': kind, 'store_revision': 1, 'credential_revision': 1},
        'credential': {'WB': {'token': 'owned-fixture-token-123456'},
            'SELLER': {'client_id': '00123', 'api_key': 'owned-fixture-key-123456'},
            'PERFORMANCE': {'client_id': 'fixture-perf', 'client_secret': 'owned-fixture-secret-123456'}}[kind]}


class Fixture(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.serve()

    def do_POST(self):
        self.serve()

    def serve(self):
        self.server.calls.append((self.command, self.path, dict(self.headers)))
        length = int(self.headers.get('Content-Length', '0'))
        self.server.bodies.append(self.rfile.read(length))
        body = self.server.body
        self.send_response(self.server.status)
        if self.server.status == 302:
            self.send_header('Location', 'https://must-not-receive-key.invalid/redirect')
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class HTTPSChecks(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='rt-check-ca-')
        root = Path(cls.temp.name); key = root/'server.key'; cert = root/'server.crt'
        subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
            '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost', '-keyout', str(key), '-out', str(cert)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True, timeout=15)
        key.chmod(0o600)
        cls.context = ssl.create_default_context(cafile=str(cert))
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); tls.load_cert_chain(cert, key)
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
        cls.server.socket = tls.wrap_socket(cls.server.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True); cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.thread.join(timeout=2); cls.temp.cleanup()

    def setUp(self):
        self.server.calls = []; self.server.bodies = []; self.server.status = 200
        self.server.body = json.dumps({'sid': str(uuid.uuid4()), 'name': 'Never returned', 'tin': 'private-fixture'}).encode()
        self.destinations = []

    def exchange(self, request, **options):
        self.destinations.append(request.full_url)
        # Test-only routing to a real loopback TLS server with an explicitly trusted
        # private CA. Product endpoint selection and headers remain observable.
        routed = urllib.request.Request('https://localhost:'+str(self.server.server_port)+request.selector,
            data=request.data, headers=dict(request.header_items()), method=request.get_method())
        return read_response(routed, ssl_context=self.context, **options)

    def checker(self, qualified=False):
        return Checker(enabled=['WB', 'SELLER', 'PERFORMANCE'], seller_binding_qualified=qualified, exchange=self.exchange)

    def test_wb_identity_is_authenticated_response_sid(self):
        value = message(); result = self.checker().check(value, 'dev')
        self.assertEqual(result, {'code': 'CONNECTED', 'identity': 'wb:sid:'+loads(self.server.body)['sid'], 'capabilities': ['WB']})
        self.assertEqual(self.destinations, ['https://common-api.wildberries.ru/api/v1/seller-info'])
        self.assertEqual(self.server.calls[0][2]['Authorization'], value['credential']['token'])
        self.assertNotIn('private-fixture', json.dumps(result))

    def test_wb_malformed_or_missing_sid_never_uses_jwt_name_or_tin(self):
        for body in [{'sid': 'not-a-uuid', 'tin': '123'}, {'sid': 123}, {'name': 'same-shop'}, {'sid': str(uuid.uuid1())}]:
            self.server.body = json.dumps(body).encode()
            self.assertEqual(self.checker().check(message(), 'dev'), {'code': 'IDENTITY_NOT_VERIFIED'})

    def test_seller_info_is_single_read_only_post_with_pair_headers(self):
        value = message('SELLER'); self.server.body = json.dumps({'company': {'name': 'Shop', 'country': 'RU', 'currency': 'RUB', 'inn': 'private'}}).encode()
        result = self.checker(qualified=True).check(value, 'dev')
        self.assertEqual(result['identity'], 'ozon:client:123')
        self.assertEqual(self.destinations, ['https://api-seller.ozon.ru/v1/seller/info'])
        self.assertEqual(self.server.calls[0][0:2], ('POST', '/v1/seller/info'))
        self.assertEqual(self.server.calls[0][2]['Client-Id'], '00123')
        self.assertEqual(self.server.bodies, [b'{}'])

    def test_seller_identity_does_not_promote_without_binding_qualification(self):
        self.server.body = json.dumps({'company': {'name': 'Shop', 'country': 'RU', 'currency': 'RUB', 'inn': '123'}}).encode()
        self.assertEqual(self.checker().check(message('SELLER'), 'dev'), {'code': 'IDENTITY_NOT_VERIFIED'})

    def test_seller_legal_details_alone_are_not_cabinet_identity(self):
        self.server.body = b'{"company":{"inn":"123","ogrn":"456"}}'
        self.assertEqual(self.checker(True).check(message('SELLER'), 'dev'), {'code': 'IDENTITY_NOT_VERIFIED'})

    def test_performance_token_never_proves_link_to_seller(self):
        self.server.body = b'{"access_token":"fixture-token-with-unverified-sub","token_type":"Bearer","expires_in":3600}'
        value = message('PERFORMANCE'); result = self.checker(True).check(value, 'dev')
        self.assertEqual(result, {'code': 'IDENTITY_NOT_VERIFIED'})
        self.assertEqual(self.destinations, ['https://api-performance.ozon.ru/api/client/token'])
        self.assertEqual(loads(self.server.bodies[0])['grant_type'], 'client_credentials')

    def test_statuses_are_distinct_and_no_upstream_text_is_returned(self):
        for status, code in [(401, 'AUTH_DENIED'), (402, 'PROVIDER_PLAN_REQUIRED'), (403, 'CHECK_UNAVAILABLE'), (429, 'RATE_LIMITED'), (503, 'PROVIDER_UNAVAILABLE')]:
            self.server.status = status; self.server.body = b'{"message":"owned-fixture-token-123456"}'
            self.assertEqual(self.checker().check(message(), 'dev'), {'code': code})

    def test_seller_403_is_not_always_auth_or_role(self):
        for status, text, expected in [(404, 'Invalid Api-Key, fixture', 'AUTH_DENIED'),
                (403, 'Api-Key is deactivated, fixture', 'AUTH_DENIED'),
                (403, 'Api-Key is missing a required role for a method', 'SCOPE_MISSING'),
                (403, 'Api-Key is restricted to specific IP addresses', 'CHECK_UNAVAILABLE'),
                (403, 'Offer not signed', 'CHECK_UNAVAILABLE'), (403, 'unknown-new-reason', 'CHECK_UNAVAILABLE')]:
            self.server.status = status; self.server.body = json.dumps({'message': text}).encode()
            self.assertEqual(self.checker().check(message('SELLER'), 'dev'), {'code': expected})

    def test_wb_403_does_not_guess_a_scope_from_status_or_message(self):
        self.server.status = 403
        for body in [{}, {'message':'missing scope'}, {'message':'blocked user'}, {'message':'subscription required'}]:
            self.server.body = json.dumps(body).encode()
            self.assertEqual(self.checker().check(message(), 'dev'), {'code':'CHECK_UNAVAILABLE'})

    def test_ozon_402_does_not_claim_a_plan_requirement_without_provider_contract(self):
        self.server.status = 402; self.server.body = b'{}'
        for kind in ['SELLER', 'PERFORMANCE']:
            self.assertEqual(self.checker().check(message(kind), 'dev'), {'code':'CHECK_UNAVAILABLE'})

    def test_redirect_is_not_followed_and_secret_is_not_forwarded(self):
        self.server.status = 302; self.server.body = b'{}'
        self.assertEqual(self.checker().check(message(), 'dev'), {'code': 'CHECK_UNAVAILABLE'})
        self.assertEqual(len(self.server.calls), 1)

    def test_response_limit_and_duplicate_json_fail_closed(self):
        for body in [b'x'*65537, b'{"sid":"one","sid":"two"}', b'{"sid":NaN}', b'not-json']:
            self.server.body = body
            self.assertIn(self.checker().check(message(), 'dev')['code'], {'PROVIDER_UNAVAILABLE', 'IDENTITY_NOT_VERIFIED'})

    def test_tls_verification_is_not_disabled(self):
        request = urllib.request.Request('https://localhost:'+str(self.server.server_port)+'/')
        with self.assertRaises(urllib.error.URLError):
            read_response(request, timeout=1, limit=100)

    def test_no_enabled_kinds_means_no_network(self):
        result = Checker(exchange=self.exchange).check(message(), 'dev')
        self.assertEqual(result, {'code': 'CHECK_UNAVAILABLE'}); self.assertEqual(self.server.calls, [])

    def test_invalid_payload_cannot_choose_endpoint_or_inject_headers(self):
        variants = []
        for field in ['url', 'host', 'path', 'transport']:
            value = message(); value[field] = 'https://other.invalid'; variants.append(value)
        value = message(); value['credential']['token'] += '\r\nX: injected'; variants.append(value)
        value = message(); value['pins']['credential_revision'] = True; variants.append(value)
        value = message(); value['pins']['product_id'] = 'foreign'; variants.append(value)
        for value in variants:
            with self.assertRaises((ValueError, TypeError)):self.checker().check(value, 'dev')
        self.assertEqual(self.server.calls, [])


class IPCChecks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='rt-check-ipc-')
        self.path = Path(self.temp.name)/'check.sock'; self.servers = []

    def tearDown(self):
        for server, thread in self.servers:
            server.shutdown(); server.server_close(); thread.join(timeout=2)
        self.temp.cleanup()

    def server(self, uid=None, runner=child_check):
        server = Server(self.path, allowed_uid=os.getuid() if uid is None else uid, environment='dev', runner=runner)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        self.servers.append((server, thread)); return server

    def call(self, value):
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(3); client.connect(str(self.path)); client.sendall(json.dumps(value).encode()+b'\n')
            return client.recv(32768)

    def test_actual_peer_bound_ipc_and_isolated_child_no_external_call(self):
        self.server(); value = message(); result = loads(self.call(value))
        self.assertEqual(result['pins'], value['pins'])
        self.assertEqual(result['result'], {'code': 'CHECK_UNAVAILABLE'})
        self.assertNotIn(value['credential']['token'].encode(), json.dumps(result).encode())

    def test_untrusted_uid_is_closed_before_read_or_child(self):
        called = []
        self.server(uid=os.getuid()+1, runner=lambda *a, **kw: called.append(True))
        try:response = self.call(message())
        except (ConnectionResetError, BrokenPipeError):response = b''
        self.assertEqual(response, b''); self.assertEqual(called, [])

    def test_cross_environment_or_product_cannot_dispatch(self):
        called = []; self.server(runner=lambda *a, **kw: called.append(True))
        for field, value in [('environment', 'prod'), ('product_id', 'foreign')]:
            item = message(); item['pins'][field] = value
            result = loads(self.call(item)); self.assertEqual(result['pins'], {})
        self.assertEqual(called, [])

    def test_existing_socket_is_preserved_and_not_unlinked(self):
        self.path.write_text('owned-fixture-preserve')
        with self.assertRaises(ValueError):self.server()
        self.assertEqual(self.path.read_text(), 'owned-fixture-preserve')

    def test_group_or_world_writable_parent_is_rejected_before_bind(self):
        for mode in [0o770, 0o707]:
            self.path.parent.chmod(mode)
            with patch('store_check_ipc.socketserver.ThreadingUnixStreamServer.__init__') as bind:
                with self.assertRaises(ValueError):self.server()
                bind.assert_not_called()
            self.assertFalse(self.path.exists())
        self.path.parent.chmod(0o700)

    def test_newline_limit_and_malformed_json_do_not_reflect_payload(self):
        self.server()
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
            client.settimeout(2); client.connect(str(self.path)); client.sendall(b'{"secret":"owned-fixture-private"}\n')
            result = client.recv(32768)
        self.assertNotIn(b'owned-fixture-private', result)

    def test_child_credentials_are_stdin_not_argv_or_environment(self):
        value = message(); raw = json.dumps(value).encode()+b'\n'; pins = value['pins']
        from unittest.mock import MagicMock
        child = MagicMock(); child.returncode = 0; child.__enter__.return_value = child
        child.communicate.return_value = (json.dumps({'schema_version':'rt_check_v1','pins':pins,'result':{'code':'CHECK_UNAVAILABLE'}}).encode(), None)
        with patch('store_check_ipc.subprocess.Popen', return_value=child) as called:
            child_check(raw, pins, environment='dev', enabled=(), seller_binding_qualified=False, timeout=.1)
        self.assertNotIn(value['credential']['token'], repr(called.call_args))
        self.assertEqual(child.communicate.call_args.args[0], raw)

    def test_timed_out_child_is_killed_and_reaped(self):
        value = message(); raw = json.dumps(value).encode()+b'\n'
        from unittest.mock import MagicMock
        child = MagicMock(); child.__enter__.return_value = child
        child.communicate.side_effect = [subprocess.TimeoutExpired('owned-worker', .01), (b'', None)]
        with patch('store_check_ipc.subprocess.Popen', return_value=child):
            result = child_check(raw, value['pins'], environment='dev', enabled=(), seller_binding_qualified=False, timeout=.01)
        self.assertEqual(result, {'code':'TIMEOUT'}); child.kill.assert_called_once(); self.assertEqual(child.communicate.call_count, 2)

    def test_malformed_connected_worker_result_cannot_cross_ipc(self):
        self.server(runner=lambda *a, **kw:{'code':'CONNECTED','identity':'unsafe\nvalue','capabilities':['WB']})
        self.assertEqual(loads(self.call(message()))['result'], {'code':'CHECK_UNAVAILABLE'})


if __name__ == '__main__':unittest.main()
