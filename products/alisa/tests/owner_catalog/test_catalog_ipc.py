"""Real private Unix protocol path; provider exchange is a local fake."""
from pathlib import Path
import json,os,socket,sys,tempfile,threading,unittest,uuid
ROOT=Path(__file__).resolve().parents[2];sys.path.insert(0,str(ROOT/'runtime'))
from store_check_ipc import Server
class IPC(unittest.TestCase):
 def message(self,kind='SELLER',catalog=True):
  return {'schema_version':'rt_catalog_v1'if catalog else'rt_check_v1','operation':'product_catalog'if catalog else'check_store','pins':{'environment':'dev','product_id':'alisa_market','tenant_id':str(uuid.uuid4()),'store_id':str(uuid.uuid4()),'provider':'WB'if kind=='WB'else'OZON','kind':kind,'credential_revision':1,'store_revision':1,'request_id':str(uuid.uuid4())},'credential':{'token':'SYNTHETIC_TOKEN_123'}if kind=='WB'else{'client_id':'123','api_key':'SYNTHETIC_API_KEY_123'},**({'cursor':{}}if catalog else{})}
 def exchange(self,message,enabled=True,uid=None,result=None):
  calls=[]
  def fake(raw,pins,**kwargs):calls.append((json.loads(raw),kwargs));return result or {'code':'OK','items':[{'sku':'123','name':'Товар','offer_id':'ART'}],'cursor':{},'complete':True}
  with tempfile.TemporaryDirectory(prefix='owner-catalog-ipc-')as d:
   os.chmod(d,0o700);path=str(Path(d)/'check.sock')
   with Server(path,allowed_uid=os.getuid()if uid is None else uid,environment='dev',enabled=('SELLER','WB','PERFORMANCE'),runner=fake,enable_catalog=enabled)as server:
    thread=threading.Thread(target=server.serve_forever,kwargs={'poll_interval':.02},daemon=True);thread.start()
    try:
     with socket.socket(socket.AF_UNIX)as peer:
      peer.settimeout(2);peer.connect(path);peer.sendall(json.dumps(message).encode()+b'\n');data=bytearray()
      try:
       while not data.endswith(b'\n'):
        part=peer.recv(4096)
        if not part:break
        data.extend(part)
      except ConnectionResetError:pass
    finally:server.shutdown();thread.join(3)
  return json.loads(data)if data else None,calls
 def test_real_socket_pins_and_operation(self):
  m=self.message();r,c=self.exchange(m);self.assertEqual(r['pins'],m['pins']);self.assertEqual(r['schema_version'],'rt_catalog_v1');self.assertEqual(r['result']['code'],'OK');self.assertTrue(c[0][1]['enable_catalog'])
 def test_catalog_disabled_does_not_dispatch(self):
  r,c=self.exchange(self.message(),enabled=False);self.assertEqual(c,[]);self.assertEqual(r['result']['code'],'CHECK_UNAVAILABLE')
 def test_other_uid_denied(self):
  r,c=self.exchange(self.message(),uid=os.getuid()+10000);self.assertIsNone(r);self.assertEqual(c,[])
 def test_legacy_identity_check_stays_legacy(self):
  m=self.message(catalog=False);r,c=self.exchange(m,result={'code':'AUTH_DENIED'});self.assertEqual(r['schema_version'],'rt_check_v1');self.assertNotIn('enable_catalog',c[0][1]);self.assertEqual(r['result'],{'code':'AUTH_DENIED'})
 def test_bad_provider_result_not_forwarded(self):
  r,c=self.exchange(self.message(),result={'code':'OK','items':[],'cursor':{},'complete':True,'token':'PRIVATE'});self.assertEqual(r['result'],{'code':'CHECK_UNAVAILABLE'});self.assertNotIn('PRIVATE',json.dumps(r))
 def test_injected_url_not_dispatched(self):
  m=self.message();m['url']='https://outside.invalid';r,c=self.exchange(m);self.assertEqual(c,[])
 def test_legacy_unknown_operation_denied(self):
  m=self.message();m['operation']='finance';r,c=self.exchange(m);self.assertEqual(c,[])
 def test_wb_uses_same_peer_boundary(self):
  m=self.message('WB');r,c=self.exchange(m);self.assertEqual(r['result']['code'],'OK');self.assertEqual(c[0][0]['pins']['provider'],'WB')
if __name__=='__main__':
 result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(IPC));print(json.dumps({'status':'PASS'if result.wasSuccessful()else'FAIL','tests':result.testsRun,'provider_http':0,'local_unix_only':True}));raise SystemExit(0 if result.wasSuccessful()else 1)
