import hashlib, http.client, importlib.util, json, os, sqlite3, sys, tempfile, threading, types, unittest
from pathlib import Path
from unittest.mock import patch
import service
from test_delivery import Cipher,Client
ROOT=Path(__file__).parent

class BoundaryTests(unittest.TestCase):
 def test_admin_http_qr_auth_origin(self):
  with tempfile.TemporaryDirectory() as d:
   core=service.Delivery(d,Cipher(),Client());core.qr='https://passport.yandex.ru/auth?test=synthetic';core.qr_until=service.time.time()+100
   server=service.ThreadingHTTPServer(('127.0.0.1',0),service.AdminHandler);server.delivery=core
   t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
   try:
    with patch.object(service,'staff_profile',return_value={'id':'owner'}):
     c=http.client.HTTPConnection('127.0.0.1',server.server_port)
     c.request('GET',service.BASE+'qr.svg',headers={'Host':'alisa-admin.octoport.ru'});r=c.getresponse();data=r.read();self.assertEqual(r.status,200);self.assertIn(b'<svg',data);self.assertEqual(r.getheader('Cache-Control'),'no-store')
     c.request('POST',service.BASE+'api',body='{"action":"status"}',headers={'Host':'alisa-admin.octoport.ru','Origin':'https://evil.invalid','Content-Type':'application/json'});r=c.getresponse();r.read();self.assertEqual(r.status,403)
    with patch.object(service,'staff_profile',side_effect=service.Fault('login_required')):
     c.request('GET',service.BASE,headers={'Host':'alisa-admin.octoport.ru'});r=c.getresponse();r.read();self.assertEqual(r.status,303);self.assertEqual(r.getheader('Location'),'/login')
    c.close()
   finally:server.shutdown();server.server_close();t.join()
 def load_lab(self,d):
  fake=types.ModuleType('deepseek_lab');fake.init=lambda:None
  spec=importlib.util.spec_from_file_location('test_lab_transport',ROOT/'alice_lab.py');lab=importlib.util.module_from_spec(spec)
  with patch.dict(sys.modules,deepseek_lab=fake),patch.dict(os.environ,LAB_LOG_KEY='l'*40,LAB_OAUTH_CLIENT_SECRET='s'*40,LAB_TEST_PASSWORD='p'*20,LAB_DB=d+'/lab.db'):
   spec.loader.exec_module(lab)
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
