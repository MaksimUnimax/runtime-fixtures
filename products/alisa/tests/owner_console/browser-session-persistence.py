"""Actual Secure/HttpOnly customer cookie survives a Chromium profile restart."""
from pathlib import Path
from http.server import HTTPServer,BaseHTTPRequestHandler
import json,ssl,tempfile,threading,time,subprocess
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[4]
record=json.loads((ROOT/'session-cookie.log').read_text().strip().splitlines()[-1]);assert record['status']=='PASS'
header=record['synthetic_cookie'];observed=[]
class H(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):
  self.send_response(200)
  if self.path=='/login-fixture':self.send_header('Set-Cookie',header)
  if self.path=='/logout-fixture':self.send_header('Set-Cookie','__Host-alisa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0')
  self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(b'<html><body>synthetic session fixture</body></html>')
server=HTTPServer(('127.0.0.1',0),H);tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(ROOT/'private-source-transfer/cert.pem',ROOT/'private-source-transfer/key.pem');server.socket=tls.wrap_socket(server.socket,server_side=True)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();base=f'https://127.0.0.1:{server.server_port}'
with tempfile.TemporaryDirectory(prefix='session-persistent-profile-')as directory,sync_playwright()as pw:
 ctx=pw.chromium.launch_persistent_context(directory,headless=True,ignore_https_errors=True,args=['--no-sandbox']);page=ctx.new_page();page.goto(base+'/login-fixture')
 cookies=ctx.cookies();c=next(c for c in cookies if c['name']=='__Host-alisa_session');assert c['httpOnly']and c['secure']and c['sameSite']=='Lax';assert 2591900<c['expires']-time.time()<=2592001;assert 'SYNTHETIC_SESSION'not in page.evaluate('document.cookie');ctx.close()
 ctx=pw.chromium.launch_persistent_context(directory,headless=True,ignore_https_errors=True,args=['--no-sandbox']);page=ctx.new_page();page.goto(base+'/return-after-restart');c=next(c for c in ctx.cookies()if c['name']=='__Host-alisa_session');assert c['value']=='SYNTHETIC_SESSION';page.goto(base+'/logout-fixture');assert not any(c['name']=='__Host-alisa_session'for c in ctx.cookies());ctx.close()
server.shutdown();server.server_close();thread.join(timeout=5)
result={'status':'PASS','checks':7,'browser':'Chromium persistent profile','actual_cookie_helper_used':True,'profile_restart_keeps_cookie':True,'logout_removes_cookie':True,'duration_seconds':2592000,'real_login':False,'real_user_cookies':False,'external_network':0}
(ROOT/'session-browser-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
