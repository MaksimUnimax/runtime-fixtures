import copy,json,os,socket,tempfile,threading,unittest
from pathlib import Path
from datetime import datetime,timezone
from unittest.mock import patch
from semantics import Rejected,fingerprint
from repository import Repository
from engine import Engine,Worker
from local_gateway import Gateway,request
from runtime import Configuration,main
from registry import REGISTRY,REGISTRY_HASH,load_registry
from test_runtime import SCOPE,FakeTransport

class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.time_patch=patch('local_gateway.datetime');mock_time=self.time_patch.start();mock_time.now.return_value=datetime(2026,11,3,12,tzinfo=timezone.utc)
        self.tmp=tempfile.TemporaryDirectory();self.path=str(Path(self.tmp.name)/'gateway.sock')
        self.repo=Repository(str(Path(self.tmp.name)/'state.db'))
        def scoped(tenant):
            if tenant!='A':raise Rejected('TENANT_DENIED')
            return SCOPE
        self.engine=Engine(self.repo,scoped);self.transport=FakeTransport();self.worker=Worker(self.engine,self.transport)
        self.server=Gateway(self.path,self.engine,os.getuid())
        self.thread=threading.Thread(target=self.server.serve_forever,kwargs={'poll_interval':.01},daemon=True);self.thread.start()
    def tearDown(self):
        self.server.shutdown();self.server.server_close();self.thread.join();self.tmp.cleanup();self.time_patch.stop()
    def ask(self,q,rid='one',tenant='A'):return request(self.path,tenant,q,rid,fingerprint(q))
    def test_real_unix_socket_ingress(self):
        r=self.ask('сводка заказов за октябрь 2026 на озоне');self.assertEqual(r['state'],'QUEUED');self.assertEqual(self.transport.calls,[])
    def test_queue_worker_socket_readback(self):
        self.ask('сводка заказов за октябрь 2026 на озоне');self.worker.step();r=self.ask('результат','two');self.assertIn('123.45',r['text']);self.assertEqual(r['text'],r['tts'])
    def test_other_account_denied(self):self.assertEqual(self.ask('результат',tenant='B')['error'],'TENANT_DENIED')
    def test_unknown_payload_field(self):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
            s.connect(self.path);s.sendall(b'{"tenant":"A","secret":"do-not-use"}\n');r=json.loads(s.recv(4096))
        self.assertEqual(r['error'],'IPC_SCHEMA');self.assertEqual(self.repo.call_count(),0)
    def test_disallowed_peer_uid(self):
        self.server.allowed_uid=os.getuid()+10000
        self.assertEqual(self.ask('результат')['error'],'IPC_PEER_DENIED')
    def test_same_request_is_idempotent_over_socket(self):
        q='сводка заказов за октябрь 2026 на озоне';a=self.ask(q);b=self.ask(q);self.assertEqual(a['job_id'],b['job_id'])
    def test_no_socket_overwrite(self):
        with self.assertRaises(RuntimeError):Gateway(self.path,self.engine,os.getuid())
    def test_bad_json_no_queue(self):
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as s:
            s.connect(self.path);s.sendall(b'{"tenant":NaN}\n');r=json.loads(s.recv(4096))
        self.assertEqual(r['error'],'NONFINITE_JSON')

class RegistryTests(unittest.TestCase):
    def change(self,fn):
        d=copy.deepcopy(REGISTRY);fn(d)
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'r.json';p.write_text(json.dumps(d));return load_registry(p)
    def test_matrix_change_changes_key(self):
        _,h=self.change(lambda d:d['recipes']['ozon'].update(id='ozon.orders.v2'))
        self.assertNotEqual(h,REGISTRY_HASH)
    def test_endpoint_cannot_change_to_arbitrary_host(self):
        with self.assertRaises(ValueError):self.change(lambda d:d['recipes']['ozon'].update(url='https://example.invalid/'))
    def test_throttle_cannot_be_lowered(self):
        with self.assertRaises(ValueError):self.change(lambda d:d['recipes']['wb'].update(min_interval=1))
    def test_cache_policy_cannot_be_relaxed(self):
        with self.assertRaises(ValueError):self.change(lambda d:d.update(cache_policy='overlap'))
    def test_configuration_check_is_network_free(self):
        config=Path(__file__).parents[1]/'config.example.json'
        with patch('urllib.request.OpenerDirector.open',side_effect=AssertionError('network')):
            self.assertEqual(main(['--config',str(config),'--check']),0)
    def test_worker_disabled_by_default(self):
        config=Configuration(Path(__file__).parents[1]/'config.example.json')
        with self.assertRaises(Rejected) as ctx:config.ready()
        self.assertEqual(ctx.exception.code,'LIVE_DISABLED')

if __name__=='__main__':unittest.main()
