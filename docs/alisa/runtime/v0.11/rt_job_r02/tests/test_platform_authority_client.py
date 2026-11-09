"""Private authority wire, nonce/MAC/schema and peer-bound transport checks."""
from dataclasses import asdict
import hashlib
import hmac
import json
import os
from pathlib import Path
import socketserver
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from semantics import canonical_json, Rejected
from test_runtime import SCOPE
from platform_authority_client import PlatformAuthorityClient, SCHEMA, PRODUCT, scope_shape

SECRET='fixture_service_credential_123456789012345678901'


class Wire(unittest.TestCase):
    def setUp(self):
        self.client=PlatformAuthorityClient('/not-used/private.sock',expected_uid=os.getuid(),
            service_token=SECRET,service_id='fixture-platform')
        self.change=lambda reply:reply
        self.status=200
        self.count=0
        self.client._exchange=self.exchange

    def exchange(self,raw):
        self.count+=1;request=json.loads(raw)
        value={'schema':SCHEMA,'product_id':PRODUCT,'request_id':request['request_id'],
               'ok':True,'data':asdict(SCOPE)}
        value['data']['stores']=[asdict(s)for s in SCOPE.stores]
        value=self.change(value)
        mac=hmac.new(SECRET.encode(),canonical_json(value).encode(),hashlib.sha256).hexdigest()
        return self.status,canonical_json({'payload':value,'mac':mac}).encode()

    def denied(self,action,code='DEPENDENCY_UNAVAILABLE'):
        with self.assertRaises(Rejected)as error:action()
        self.assertEqual(error.exception.code,code)
        self.assertNotIn(SECRET,str(error.exception))

    def test_resolve_converts_exact_signed_scope(self):self.assertEqual(self.client.resolve({},'execute'),SCOPE)
    def test_wrong_nonce(self):
        self.change=lambda v:{**v,'request_id':'00000000-0000-0000-0000-000000000000'}
        self.denied(lambda:self.client.resolve({},'execute'));self.assertEqual(self.count,1)
    def test_wrong_product(self):
        self.change=lambda v:{**v,'product_id':'octoport'}
        self.denied(lambda:self.client.resolve({},'execute'))
    def test_wrong_schema(self):
        self.change=lambda v:{**v,'schema':'other'}
        self.denied(lambda:self.client.resolve({},'execute'))
    def test_unknown_payload_field(self):
        self.change=lambda v:{**v,'extra':True}
        self.denied(lambda:self.client.resolve({},'execute'))
    def test_bool_success_not_truthy(self):
        self.change=lambda v:{**v,'ok':1}
        self.denied(lambda:self.client.resolve({},'execute'))
    def test_signed_error_is_preserved(self):
        self.status=503
        self.change=lambda v:{k:x for k,x in {**v,'ok':False,'code':'DEPENDENCY_UNAVAILABLE'}.items()if k!='data'}
        self.denied(lambda:self.client.resolve({},'execute'))
    def test_signed_access_denial_is_preserved(self):
        self.status=403
        self.change=lambda v:{k:x for k,x in {**v,'ok':False,'code':'ACCESS_REQUIRED'}.items()if k!='data'}
        self.denied(lambda:self.client.resolve({},'execute'),'ACCESS_REQUIRED')
    def test_signed_denial_with_success_http_is_invalid(self):
        self.change=lambda v:{k:x for k,x in {**v,'ok':False,'code':'ACCESS_REQUIRED'}.items()if k!='data'}
        self.denied(lambda:self.client.resolve({},'execute'))
    def test_unknown_error_code_is_dependency_failure(self):
        self.status=503
        self.change=lambda v:{k:x for k,x in {**v,'ok':False,'code':'PRIVATE_ERROR'}.items()if k!='data'}
        self.denied(lambda:self.client.resolve({},'execute'))
    def test_success_with_error_status_is_invalid(self):
        self.status=503;self.denied(lambda:self.client.resolve({},'execute'))
    def test_invalid_mac(self):
        exchange=self.client._exchange
        def corrupt(raw):
            status,body=exchange(raw);v=json.loads(body);v['mac']='a'*64
            return status,json.dumps(v).encode()
        self.client._exchange=corrupt;self.denied(lambda:self.client.resolve({},'execute'))
    def test_duplicate_json_key(self):
        self.client._exchange=lambda _:(200,b'{"payload":{},"payload":{},"mac":"abc"}')
        self.denied(lambda:self.client.resolve({},'execute'))
    def test_extra_scope_key(self):self.denied(lambda:scope_shape({**asdict(SCOPE),'secret':'private'}))
    def test_duplicate_store(self):
        value=asdict(SCOPE);value['stores']=[asdict(SCOPE.stores[0])]*2
        self.denied(lambda:scope_shape(value))
    def test_oversize_request_never_sends(self):
        self.denied(lambda:self.client.resolve({'opaque':'x'*131072},'execute'));self.assertEqual(self.count,0)
    def test_wrong_service_never_sends(self):
        self.denied(lambda:self.client.verify('fixture-ticket','foreign-service'),'AUTH_REQUIRED');self.assertEqual(self.count,0)
    def test_invalid_verified_claims_are_dependency_error(self):
        self.denied(lambda:self.client.verify('fixture-ticket','fixture-platform'))
    def test_unknown_action_never_sends(self):
        self.denied(lambda:self.client.resolve({},'write'),'VALIDATION_FAILED');self.assertEqual(self.count,0)
    def test_bad_configuration_does_not_disclose_value(self):
        with self.assertRaises(ValueError)as e:
            PlatformAuthorityClient('/tmp/any.sock',expected_uid=0,service_token='private bad token',service_id='x')
        self.assertNotIn('private bad token',str(e.exception))


class UnixWire(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory(prefix='s07-auth-')
        self.path=Path(self.folder.name)/'authority.sock'
        self.requests=[];self.mode='normal'
        outer=self
        class Handler(socketserver.StreamRequestHandler):
            def handle(self):
                try:
                    header=[]
                    while True:
                        line=self.rfile.readline(8192)
                        if line==b'\r\n':break
                        if not line:return
                        header.append(line)
                    length=int(next(l.split(b':',1)[1]for l in header if l.lower().startswith(b'content-length:')))
                    body=self.rfile.read(length);request=json.loads(body);outer.requests.append(request)
                    outer.assertIn(('Authorization: Bearer '+SECRET+'\r\n').encode(),header)
                    payload={'schema':SCHEMA,'product_id':PRODUCT,'request_id':request['request_id'],'ok':True,
                             'data':{'tenant':SCOPE.tenant,'revision':SCOPE.revision,'stores':[asdict(s)for s in SCOPE.stores]}}
                    mac=hmac.new(SECRET.encode(),canonical_json(payload).encode(),hashlib.sha256).hexdigest()
                    raw=canonical_json({'payload':payload,'mac':mac}).encode()
                    head=f'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {len(raw)}\r\n\r\n'.encode()
                    if outer.mode=='trickle':
                        for byte in head+raw:
                            self.wfile.write(bytes([byte]));self.wfile.flush();time.sleep(.01)
                    else:self.wfile.write(head+raw)
                except (BrokenPipeError,ConnectionResetError):pass
        self.server=socketserver.ThreadingUnixStreamServer(str(self.path),Handler)
        self.server.daemon_threads=True;self.path.chmod(0o660)
        self.thread=threading.Thread(target=self.server.serve_forever,kwargs={'poll_interval':.01},daemon=True);self.thread.start()
        self.client=PlatformAuthorityClient(str(self.path),expected_uid=os.getuid(),service_token=SECRET,service_id='fixture-platform')

    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join(2);self.folder.cleanup()
    def denied(self):
        with self.assertRaises(Rejected)as e:self.client.resolve({},'execute')
        self.assertEqual(e.exception.code,'DEPENDENCY_UNAVAILABLE')
    def test_actual_unix_http_peer_and_hmac(self):
        self.assertEqual(self.client.resolve({},'execute'),SCOPE);self.assertEqual(len(self.requests),1)
    def test_bad_socket_uid_never_sends(self):
        self.client.uid+=1;self.denied();self.assertEqual(self.requests,[])
    def test_writable_parent_never_sends(self):
        Path(self.folder.name).chmod(0o777)
        try:self.denied();self.assertEqual(self.requests,[])
        finally:Path(self.folder.name).chmod(0o700)
    def test_symlink_socket_never_sends(self):
        link=Path(self.folder.name)/'link.sock';link.symlink_to(self.path);self.client.path=str(link)
        self.denied();self.assertEqual(self.requests,[])
    def test_whole_exchange_deadline(self):
        self.mode='trickle';self.client.timeout=.08;start=time.monotonic()
        self.denied();self.assertLess(time.monotonic()-start,.3);self.assertEqual(len(self.requests),1)
