import json
import threading
import unittest
import urllib.error
import urllib.request
from probe import (Probe, Fault, scenario_payload, greeting, Handler,
                   ThreadingHTTPServer, BASE, ORIGIN, TEST_COMMAND, TEST_TEXT, Yandex)


class Fake:
    def __init__(self):
        self.calls = []
        self.fail = None
    def devices(self):
        return [{'id': 'speaker-1', 'name': 'Моя колонка'}]
    def api(self, method, path, payload=None):
        self.calls.append((method,path,payload))
        if self.fail == len(self.calls):
            raise Fault('network_outcome_unknown')
        return {'status': 'ok', 'scenario_id': 'own-scenario'}


class Core(unittest.TestCase):
    def setUp(self):
        self.time = [100]
        self.f = Fake()
        self.p = Probe('a'*48, self.f, lambda: self.time[0])
        self.p.connected = True
        self.p.action('devices', {})
        self.p.action('select', {'device':'speaker-1'})
    def test_fixed_payload_only(self):
        for mode,expected in [('text',TEST_TEXT),('skill',TEST_COMMAND)]:
            self.assertIn(expected,json.dumps(scenario_payload('mine','trigger','speaker-1',mode),ensure_ascii=False))
        with self.assertRaises(Fault):scenario_payload('mine','trigger','speaker-1','arbitrary')
    def test_automatic_create_then_start_only_owned_id(self):
        self.p.action('test', {'mode':'text'})
        self.assertEqual([c[:2] for c in self.f.calls],[('POST','/m/v4/user/scenarios'),('POST','/m/user/scenarios/own-scenario/actions')])
        self.assertEqual(self.p.attempts[-1]['state'],'accepted_not_heard')
        self.time[0]+=13
        self.p.action('test',{'mode':'skill'})
        self.assertEqual(self.f.calls[-2][:2],('PUT','/m/v4/user/scenarios/own-scenario'))
        self.assertEqual(sum(c[1]=='/m/v4/user/scenarios' for c in self.f.calls),1)
    def test_unknown_create_no_repeat(self):
        self.f.fail = 1
        self.p.action('test', {'mode':'text'})
        self.time[0]+=13
        with self.assertRaises(Fault):self.p.action('test',{'mode':'text'})
        self.assertEqual(len(self.f.calls),1)
    def test_unknown_launch_no_repeat(self):
        self.f.fail = 2
        self.p.action('test',{'mode':'skill'})
        self.time[0]+=13
        with self.assertRaises(Fault):self.p.action('test',{'mode':'skill'})
        self.assertEqual(len(self.f.calls),2)
    def test_unlisted_device_denied(self):
        self.p.selected=None
        with self.assertRaises(Fault):self.p.action('select',{'device':'somebody-else'})
        self.assertEqual(self.f.calls,[])
    def test_no_switch_after_selection(self):
        with self.assertRaises(Fault):self.p.action('select',{'device':'speaker-1'})
    def test_expiry_denies_cookie_use(self):
        self.time[0]+=10801
        self.assertFalse(self.p.authorized('a'*48))
        with self.assertRaises(Fault):self.p.action('test',{'mode':'text'})
        self.assertEqual(self.f.calls,[])
    def test_rate_limit(self):
        self.p.action('test',{'mode':'text'})
        with self.assertRaises(Fault):self.p.action('test',{'mode':'text'})
        self.assertEqual(len(self.f.calls),2)
    def test_revoke_cancels_pending_generation(self):
        from unittest.mock import patch
        attempt={'state':'waiting','mode':'text'}
        generation=self.p.generation
        self.p.action('revoke',{})
        with patch('probe.time.sleep'):self.p.delayed(attempt,generation)
        self.assertEqual(attempt['state'],'cancelled')
        self.assertEqual(self.f.calls,[])
    def test_delayed_send_needs_no_followup(self):
        from unittest.mock import patch
        attempt={'state':'waiting','mode':'skill'}
        with patch('probe.time.sleep'):self.p.delayed(attempt,self.p.generation)
        self.assertEqual(attempt['state'],'accepted_not_heard')
        self.assertEqual(len(self.f.calls),2)
    def test_plain_greeting_and_no_fabrication(self):
        self.assertEqual(greeting(' Максим '),'Привет, Максим')
        for x in [None,'','user@example.com','<speaker>Максим',123]:
            self.assertEqual(greeting(x),'Привет')
    def test_devices_use_current_quasar_household_schema(self):
        y=Yandex()
        y.api=lambda *a:{'households':[{'all':[{'id':'s','name':'Колонка','quasar_info':{'device_id':'x'},'capabilities':[{}]}, {'id':'lamp','capabilities':[{}]}, {'id':'module','quasar_info':{},'capabilities':[]}]}]}
        self.assertEqual(y.devices(),[{'id':'s','name':'Колонка'}])
    def test_arbitrary_outbound_host_blocked(self):
        with self.assertRaises(Fault):Yandex().request('POST','https://example.com',{})
    def test_expiry_actively_clears_memory(self):
        self.p.qr='private-link'
        self.p.clear_expired()
        self.assertIsNone(self.p.qr)
        self.assertFalse(self.p.connected)
        self.assertIsNot(self.p.client,self.f)
        self.assertIsNone(self.p.selected)
    def test_qr_requires_authenticated_iot_identity(self):
        y=Yandex();y.track=({'track_id':'t'},{})
        values=iter([{'state':'otp_auth_finished','trackId':'t'},{'status':'ok'},{'storage':{'user':{'uid':None}}}])
        y.request=lambda *a,**k:next(values)
        with self.assertRaisesRegex(Fault,'qr_session_not_authenticated'):y.poll_qr()
    def test_qr_authenticated_iot_identity(self):
        y=Yandex();y.track=({'track_id':'t'},{})
        values=iter([{'state':'otp_auth_finished','trackId':'t'},{'status':'ok'},{'storage':{'user':{'uid':'123'}}}])
        y.request=lambda *a,**k:next(values)
        self.assertTrue(y.poll_qr())


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.server.probe=Probe('a'*48,Fake())
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        cls.url='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.thread.join()
    def post(self,origin=ORIGIN,token='a'*48,path='status',body=b'{}'):
        req=urllib.request.Request(self.url+BASE+'api/'+path,data=body,headers={'Origin':origin,'Authorization':'Bearer '+token,'Content-Type':'application/json'})
        try:r=urllib.request.urlopen(req)
        except urllib.error.HTTPError as e:r=e
        return r.code,json.loads(r.read())
    def test_no_access_without_capability(self):self.assertEqual(self.post(token='bad')[0],401)
    def test_cross_origin_denied(self):self.assertEqual(self.post(origin='https://evil.test')[0],403)
    def test_origin_required(self):self.assertEqual(self.post(origin='')[0],403)
    def test_public_page_contains_no_secret(self):
        with urllib.request.urlopen(self.url+BASE) as r:
            body=r.read();self.assertNotIn(b'a'*48,body);self.assertIn('frame-ancestors',r.headers['Content-Security-Policy'])
    def test_unknown_route_denied(self):self.assertEqual(self.post(path='arbitrary')[1]['error'],'unknown_action')
    def test_non_object_rejected(self):self.assertEqual(self.post(body=b'[]')[1]['error'],'json_required')
    def test_public_traversal_denied(self):
        with self.assertRaises(urllib.error.HTTPError):urllib.request.urlopen(self.url+BASE+'../probe.py')
    def test_authenticated_status_has_no_cookies(self):
        code,r=self.post();self.assertEqual(code,200);self.assertNotIn('cookie',json.dumps(r));self.assertFalse(r['connected'])
    def test_http_qr_rendering(self):
        from unittest.mock import patch
        with patch('probe.Yandex.start_qr',return_value='https://passport.yandex.ru/auth/magic?track=synthetic'):
            code,r=self.post(path='qr')
            self.assertEqual(code,200)
            self.assertIn('<svg',r['svg'])
            self.assertIn('passport.yandex.ru',r['link'])


if __name__=='__main__':unittest.main()
