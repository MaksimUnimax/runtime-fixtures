import hashlib, http.client, importlib.util, json, os, sqlite3, sys, tempfile, threading, types, unittest
from pathlib import Path
from unittest.mock import patch
import service
from test_delivery import Cipher,Client
ROOT=Path(__file__).parent

class BoundaryTests(unittest.TestCase):
 def test_admin_http_qr_auth_origin(self):
  with tempfile.TemporaryDirectory() as d:
   core=service.Registry(d,Cipher());device=core.site('a'*8+'-0000-4000-8000-000000000001');device.qr='https://passport.yandex.ru/auth?test=synthetic';device.qr_until=service.time.time()+100
   server=service.ThreadingHTTPServer(('127.0.0.1',0),service.AdminHandler);server.delivery=core
   t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
   try:
    with patch.object(service,'staff_profile',return_value={'id':'owner'}),patch.object(service,'site_profile',return_value={'customer_id':'a'*8+'-0000-4000-8000-000000000001'}):
     c=http.client.HTTPConnection('127.0.0.1',server.server_port)
     c.request('GET',service.SITE_BASE+'qr.svg',headers={'Host':'alisa.octoport.ru'});r=c.getresponse();data=r.read();self.assertEqual(r.status,200);self.assertIn(b'<svg',data);self.assertEqual(r.getheader('Cache-Control'),'no-store')
     c.request('POST',service.BASE+'api',body='{"action":"status"}',headers={'Host':'alisa-admin.octoport.ru','Origin':'https://evil.invalid','Content-Type':'application/json'});r=c.getresponse();r.read();self.assertEqual(r.status,403)
    with patch.object(service,'staff_profile',side_effect=service.Fault('login_required')):
     c.request('GET',service.BASE,headers={'Host':'alisa-admin.octoport.ru'});r=c.getresponse();r.read();self.assertEqual(r.status,303);self.assertEqual(r.getheader('Location'),'/login')
    c.close()
   finally:server.shutdown();server.server_close();t.join()
 def load_lab(self,d):
  fake=types.ModuleType('deepseek_lab');fake.init=lambda:None
  spec=importlib.util.spec_from_file_location('test_lab_transport',ROOT/'alice_lab.py');lab=importlib.util.module_from_spec(spec)
  bridge_spec=importlib.util.spec_from_file_location('candidate_bridge',ROOT/'alice_bridge.py');bridge=importlib.util.module_from_spec(bridge_spec);bridge_spec.loader.exec_module(bridge)
  previous_path=list(sys.path)
  try:
   with patch.dict(sys.modules,deepseek_lab=fake,alice_bridge=bridge),patch.dict(os.environ,LAB_LOG_KEY='l'*40,LAB_OAUTH_CLIENT_SECRET='s'*40,LAB_TEST_PASSWORD='p'*20,LAB_DB=d+'/lab.db'):
    spec.loader.exec_module(lab)
  finally:sys.path[:]=previous_path
  lab.init();return lab
 def body(self,command,mid=0):
  return {'version':'1.0','session':{'skill_id':'e1efec78-63de-43b0-87b9-0fb6ee0ed5fe','session_id':'session','message_id':mid,'application':{'application_id':'station'}},'request':{'type':'SimpleUtterance','command':command},'meta':{}}
 def test_exit_cancels_through_real_wrapper(self):
  sys.path.insert(0,str(ROOT.parent/'audit-runtime'))
  with tempfile.TemporaryDirectory() as d:
   lab=self.load_lab(d)
   with patch.object(lab,'auth_token',return_value='A'),patch.object(lab.station_client,'call',return_value={}) as call:
    code,answer,_=lab.skill(self.body('выход'));self.assertEqual(code,200);self.assertTrue(answer['response']['end_session']);self.assertEqual(call.call_args.args[0]['command'],'выход')
 def test_empty_launch_greeting_help_not_mixed(self):
  with tempfile.TemporaryDirectory() as d:
   lab=self.load_lab(d)
   with patch.object(lab,'auth_token',return_value='A'):
    code,answer,_=lab.skill(self.body(''));self.assertEqual(answer['response']['text'],'Привет')
 def test_bypassed_manual_commands_forbidden(self):
  import alice_bridge
  for phrase in alice_bridge.LEGACY:
   with self.assertRaises(service.Fault,msg=phrase):service.validate_settings(dict(service.DEFAULTS,manual_command=phrase))
 def test_session_persistence(self):
  import http.cookiejar
  with tempfile.TemporaryDirectory() as d:
   core=service.Delivery(d,Cipher(),Client())
   cookie=http.cookiejar.Cookie(0,'Session_id','synthetic',None,False,'.yandex.ru',True,True,'/',True,True,None,True,None,None,{})
   core.client.jar.set_cookie(cookie);core.state['connected']=True;core.save_session();core.save()
   fresh=service.Delivery(d,Cipher(),Client())
   self.assertTrue(fresh.state['connected']);self.assertEqual(list(fresh.client.jar)[0].value,'synthetic')
   self.assertNotIn('synthetic',(Path(d)/'state.json').read_text());self.assertEqual((Path(d)/'session.enc').stat().st_mode&0o777,0o600)
if __name__=='__main__':unittest.main()

class SiteBoundaryTests(unittest.TestCase):
 def test_two_site_accounts_are_isolated(self):
  from test_delivery import Cipher
  with tempfile.TemporaryDirectory() as d:
   users=service.Registry(d,Cipher())
   a=users.site('a'*8+'-0000-4000-8000-000000000001')
   b=users.site('b'*8+'-0000-4000-8000-000000000002')
   a.state['connected']=True;a.save()
   self.assertFalse(b.state['connected']);self.assertIsNot(a.client,b.client)
   with self.assertRaises(service.Fault):b.admin('status',{},'a'*8+'-0000-4000-8000-000000000001')
   changed=dict(service.DEFAULTS,enabled=False)
   users.admin('settings',{'revision':users.policy.state['revision'],'settings':changed},'staff')
   self.assertFalse(a.state['settings']['enabled']);self.assertFalse(b.state['settings']['enabled'])
   with self.assertRaises(service.Fault):users.admin('qr',{},'staff')
 def test_site_and_admin_auth_are_distinct(self):
  from io import BytesIO
  with tempfile.TemporaryDirectory() as d:
   core=service.Registry(d,Cipher());server=service.ThreadingHTTPServer(('127.0.0.1',0),service.AdminHandler);server.delivery=core
   thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   try:
    with patch.object(service,'site_profile',return_value={'customer_id':'a'*8+'-0000-4000-8000-000000000001','role':'OWNER_CLIENT'}),patch.object(service,'staff_profile',return_value={'id':'staff','role':'OWNER'}):
     c=http.client.HTTPConnection('127.0.0.1',server.server_port)
     for host,path,needle in [('alisa.octoport.ru','/app/station/','Моя колонка'),('alisa-admin.octoport.ru','/admin/station/','Общие настройки')]:
      c.request('GET',path,headers={'Host':host});r=c.getresponse();body=r.read().decode();self.assertEqual(r.status,200);self.assertIn(needle,body)
     c.request('POST','/admin/station/api',body='{"action":"qr"}',headers={'Host':'alisa-admin.octoport.ru','Origin':service.ORIGIN,'Content-Type':'application/json'});r=c.getresponse();r.read();self.assertEqual(r.status,403)
     c.request('POST','/app/station/api',body=json.dumps({'action':'settings','revision':core.policy.state['revision'],'settings':dict(service.DEFAULTS,enabled=False)}),headers={'Host':'alisa.octoport.ru','Origin':service.SITE_ORIGIN,'Content-Type':'application/json'});r=c.getresponse();r.read();self.assertEqual(r.status,403);self.assertTrue(core.policy.state['settings']['enabled'])
     c.close()
   finally:server.shutdown();server.server_close();thread.join()
 def test_customer_session_checks_real_contract(self):
  from io import BytesIO
  value={'profile':{'customer_id':'a'*8+'-0000-4000-8000-000000000001','role':'OWNER_CLIENT'}}
  class Opener:
   def open(self,*args,**kwargs):return BytesIO(json.dumps(value).encode())
  with patch.dict(service.os.environ,ALISA_PLATFORM_URL='http://127.0.0.1:18102',ALISA_AUTH_SERVICE_TOKEN='a'*32),patch.object(service.urllib.request,'build_opener',return_value=Opener()):
   self.assertEqual(service.site_profile('__Host-alisa_session='+'x'*43)['customer_id'],value['profile']['customer_id'])

class RegistryFailureTests(unittest.TestCase):
 def test_disable_crash_reopen_enable_never_replays(self):
  with tempfile.TemporaryDirectory() as d:
   users=service.Registry(d,Cipher());who='a'*8+'-0000-4000-8000-000000000001';child=users.site(who)
   child.state['job']={'delivery':'waiting','created':child.clock(),'tenant':'A','token_hash':'a'*64,'conversation':'source-id','jid':'job','next_at':0,'message':0};child.save()
   users.policy.configure({'revision':users.policy.state['revision'],'settings':dict(service.DEFAULTS,enabled=False)})
   restored=service.Registry(d,Cipher());self.assertEqual(restored.site(who).state['job']['delivery'],'manual')
   restored.admin('settings',{'revision':restored.policy.state['revision'],'settings':dict(service.DEFAULTS,enabled=True)},'staff')
   self.assertEqual(restored.site(who).state['job']['delivery'],'manual')
 def test_pair_guess_limit_before_lookup(self):
  with tempfile.TemporaryDirectory() as d:
   users=service.Registry(d,Cipher());device=users.site('a'*8+'-0000-4000-8000-000000000001')
   device.pair_hash=hashlib.sha256(b'1'*24).hexdigest();device.pair_until=device.clock()+180
   identity={'op':'before','tenant':'A','application':'app','token_hash':'a'*64}
   for i in (2,3,4,5,6,7):users.ingress(dict(identity,command='привязать колонку '+str(i)*24))
   self.assertEqual(users.pair_fail[('A','app')][1],5)
   self.assertIsNone(device.state['binding'])
