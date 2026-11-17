"""Actual loopback HTTP route tests, run only in an isolated network namespace.
No owner identity, stored credential, marketplace or public endpoint is used.
"""
import http.server
import json
import os
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import station_oauth

IDENTITY={'owner':'11111111-1111-1111-1111-111111111111',
          'platform_tenant':'22222222-2222-2222-2222-222222222222','native_tenant':'synthetic-shop'}
TOKEN='as6_synthetic_access_not_a_real_token'
SECRET='synthetic-private-service-only-'+'x'*32

class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def do_POST(self):
        if self.path!='/api/v1/account/alice':
            self.send_error(404);return
        if self.headers.get('Authorization')!='Bearer '+SECRET:
            self.send_error(401);return
        data=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.server.observed.append((self.path,data['action']))
        kind=self.server.mode
        if kind=='redirect':
            self.send_response(307);self.send_header('Location','http://127.0.0.1:18102/not-allowed')
            self.send_header('Content-Length','0');self.end_headers();return
        if kind=='rejected':self.send_error(403);return
        if kind=='drip_headers':
            # Multiple individually fast header fragments must not reset
            # the single 1.5s whole-operation deadline.
            parts=[b'HTTP/1.1 200 OK\r\n',
                   b'Content-Type: application/json\r\n',
                   b'X-Fragment: 1\r\n',b'X-Fragment: 2\r\n',
                   b'X-Fragment: 3\r\n',b'X-Fragment: 4\r\n',
                   b'Content-Length: 2\r\n',b'Connection: close\r\n\r\n',b'{}']
            for part in parts:
                try:self.wfile.write(part);self.wfile.flush()
                except (BrokenPipeError,ConnectionResetError):break
                time.sleep(.30)
            return
        if data['action']=='legacy_station_identity':value={'identity':IDENTITY,'environment':'synthetic','release':'test'}
        else:value={'current':self.server.current,'environment':'synthetic','release':'test'}
        raw=json.dumps(value).encode()
        if kind=='duplicate':raw=b'{"current":false,"current":true}'
        if kind=='malformed':raw=b'not-json'
        self.send_response(200);self.send_header('Content-Type','text/plain' if kind=='wrong_type' else 'application/json')
        self.send_header('Content-Length',str(5000 if kind=='large' else len(raw)+4 if kind=='truncated' else len(raw)))
        self.send_header('Connection','close');self.end_headers()
        if kind=='stall':time.sleep(1.8)
        try:
            if kind=='drip_body':
                step=max(1,len(raw)//9)
                for start in range(0,len(raw),step):
                    self.wfile.write(raw[start:start+step]);self.wfile.flush()
                    time.sleep(.27)
            else:self.wfile.write(raw)
        except (BrokenPipeError,ConnectionResetError):pass

class Transport(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if os.environ.get('ALISA_ISOLATED_OAUTH_HTTP_TEST')!='1':raise RuntimeError('PRIVATE_TEST_NETWORK_REQUIRED')
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',18102),Handler)
        cls.server.daemon_threads=True
        cls.thread=threading.Thread(target=cls.server.serve_forever,kwargs={'poll_interval':.01})
        cls.thread.start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join(3)
        if cls.thread.is_alive():raise AssertionError('Test server not collected')
    def setUp(self):
        self.server.mode='normal';self.server.current=True;self.server.observed=[]
        self.env=patch.dict(os.environ,{'ALISA_PLATFORM_URL':'http://127.0.0.1:18102','ALISA_AUTH_SERVICE_TOKEN':SECRET},clear=True)
        self.env.start();self.addCleanup(self.env.stop)
    def test_owner_hits_existing_authorization_endpoint_not_coefficient_route(self):
        self.assertEqual(station_oauth.owner(TOKEN),IDENTITY)
        self.assertEqual(self.server.observed,[('/api/v1/account/alice','legacy_station_identity')])
    def test_current_access_hash_is_checked_over_real_http(self):
        self.assertTrue(station_oauth.current(IDENTITY['owner'],'synthetic-shop','a'*64))
        self.assertEqual(self.server.observed,[('/api/v1/account/alice','legacy_station_token_current')])
    def test_revocation_false_is_not_an_available_identity(self):
        self.server.current=False
        self.assertFalse(station_oauth.current(IDENTITY['owner'],'synthetic-shop','a'*64))
    def test_redirect_is_not_followed(self):
        self.server.mode='redirect'
        with self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
        self.assertEqual(len(self.server.observed),1)
    def test_permission_denial_has_no_retry(self):
        self.server.mode='rejected'
        self.assertFalse(station_oauth.current(IDENTITY['owner'],'synthetic-shop','a'*64))
        self.assertEqual(len(self.server.observed),1)
    def test_duplicate_json_key_refuses_instead_of_last_value_wins(self):
        self.server.mode='duplicate'
        self.assertFalse(station_oauth.current(IDENTITY['owner'],'synthetic-shop','a'*64))
    def test_size_is_bounded_before_reading_body(self):
        self.server.mode='large'
        with self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
    def test_malformed_or_truncated_response_is_not_success(self):
        for mode in ('malformed','truncated'):
            self.server.mode=mode
            with self.subTest(mode=mode),self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
    def test_unknown_target_url_refused_without_connection(self):
        for base in ('http://example.invalid','https://127.0.0.1:18102','http://127.0.0.1:18102/extra','http://127.0.0.1:80'):
            with patch.dict(os.environ,{'ALISA_PLATFORM_URL':base}),self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
        self.assertEqual(self.server.observed,[])
    def test_private_transport_cannot_issue_token_or_write_parameter(self):
        for action in ('token','grant','turn','set_manual','approve'):
            with self.subTest(action=action),self.assertRaises(ValueError):station_oauth.platform({'action':action})
        self.assertEqual(self.server.observed,[])
    def test_missing_private_service_configuration_fails_closed(self):
        with patch.dict(os.environ,{'ALISA_AUTH_SERVICE_TOKEN':''}),self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
        self.assertEqual(self.server.observed,[])
    def test_trickled_response_headers_obey_one_absolute_deadline(self):
        self.server.mode='drip_headers';start=time.monotonic()
        with self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
        elapsed=time.monotonic()-start
        self.assertLess(elapsed,1.65,'Header bytes must not reset the total budget')
        self.assertEqual(len(self.server.observed),1)

    def test_trickled_body_obeys_one_absolute_deadline(self):
        self.server.mode='drip_body';start=time.monotonic()
        with self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
        elapsed=time.monotonic()-start
        self.assertLess(elapsed,1.65,'Body bytes must not reset the total budget')
        self.assertEqual(len(self.server.observed),1)

    def test_fully_buffered_reply_after_deadline_is_not_authorized(self):
        # The server may send bytes immediately yet the final JSON decode
        # may exceed the absolute deadline. This is not a valid late grant.
        def deliberately_slow_json_decode(data,**kwargs):
            time.sleep(1.55)
            return json.loads(data,**kwargs)
        wrapped=SimpleNamespace(dumps=json.dumps,loads=deliberately_slow_json_decode)
        with patch.object(station_oauth,'json',wrapped):
            with self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
        self.assertEqual(len(self.server.observed),1)

    def test_content_type_is_required_for_private_oauth_response(self):
        self.server.mode='wrong_type'
        with self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
        self.assertEqual(len(self.server.observed),1)

    def test_slow_response_has_finite_budget_without_retry(self):
        self.server.mode='stall';start=time.monotonic()
        with self.assertRaises(station_oauth.InvalidOAuth):station_oauth.owner(TOKEN)
        self.assertLess(time.monotonic()-start,2.5)
        self.assertEqual(len(self.server.observed),1)

if __name__=='__main__':unittest.main()
