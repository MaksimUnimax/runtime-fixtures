import os,sys,pathlib,json,re,time,base64,hashlib,datetime,subprocess,contextlib,fcntl,urllib.request
from urllib.parse import urlsplit,parse_qs,urlencode
os.umask(0o077)
REL=pathlib.Path('/opt/alisa-platform/stage/releases/alisa-6ae348354b3db0d3');BACK=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s02-6ae348354b3db0d3');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');WEB='https://alisa-stage.octoport.ru';IDP='https://id-stage.octoport.ru'
sys.path.append(str(REL/'.venv/lib/python3.12/site-packages'))
import jwt,psycopg
from cryptography.hazmat.primitives.asymmetric import rsa
from playwright.sync_api import sync_playwright,expect
sys.path.insert(0,str(E));from s02_owned_proxy import start_plain_proxy
CASES=[]
def check(n,ok):
 CASES.append({'case':n,'passed':bool(ok)});print(json.dumps(CASES[-1]),flush=True)
 if not ok:raise RuntimeError('CHECK_FAILED:'+n)
def cfg(c):return dict(l.split('=',1) for l in (pathlib.Path('/etc/alisa-platform/stage')/(c+'.env')).read_text().splitlines() if l and not l.startswith('#') and '=' in l)
def command(*a):return subprocess.run(list(a),check=True,capture_output=True,text=True,timeout=30)
def sql(q,args=()):
 d=cfg('platform')
 with psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],autocommit=True) as c:
  r=c.execute(q,args);return r.fetchall() if r.description else []
def run():
 RESULT=E/'AL_S02_INSTALLED_NEGATIVE_20261105.json';assert not RESULT.exists()
 result={'scope':'REAL_INSTALLED_BFF_NEGATIVE_HTTP','release':REL.name,'cases':CASES,'status':'RUNNING'}
 v=pathlib.Path('/etc/nginx/sites-available/alisa-platform-stage.conf');old=v.read_text();proxy=None;webproxy=None;browser=None;pw=None;changed=False
 try:
  private=json.loads((BACK/'synthetic-fixture.json').read_text());icfg=cfg('identity');key=json.loads(base64.b64decode(icfg['ALISA_IDENTITY_SIGNING_KEYS_B64']))[0]['pem'];bad=rsa.generate_private_key(public_exponent=65537,key_size=2048)
  with urllib.request.urlopen(IDP+'/.well-known/openid-configuration') as r:meta=json.load(r)
  token_path=urlsplit(meta['token_endpoint']).path;proxy=start_plain_proxy(18243,18103);webproxy=start_plain_proxy(18240,18100)
  marker=' server_name id-stage.octoport.ru;';assert old.count(marker)==1
  extra='\n location = '+token_path+' { proxy_pass http://127.0.0.1:18243; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; }'
  webmarker=' server_name alisa-stage.octoport.ru;';assert old.count(webmarker)==1
  webextra='\n location = /auth/callback { proxy_pass http://127.0.0.1:18240; proxy_set_header Host $host; proxy_set_header X-Forwarded-Proto https; }'
  v.write_text(old.replace(marker,marker+extra).replace(webmarker,webmarker+webextra));changed=True;command('nginx','-t');command('systemctl','reload','nginx')
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});storage=json.loads((BACK/'synthetic-browser-state.json').read_text());cookies=[c for c in storage['cookies'] if c['domain']=='id-stage.octoport.ru']
  before=sql('SELECT count(*) FROM accounts_customer')[0][0]
  for mode in ['state','issuer','audience','nonce','expiry','signature','pkce']:
   context=browser.new_context();context.add_cookies(cookies);page=context.new_page();page.set_default_timeout(15000);auths=[];mutated=[];page.on('request',lambda r:auths.append(r.url) if r.url.startswith(meta['authorization_endpoint']+'?') else None)
   page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click();page.wait_for_url(re.compile(re.escape(IDP)+'/accounts/'))
   values=parse_qs(urlsplit(auths[0]).query);values.pop('prompt',None);href=meta['authorization_endpoint']+'?'+urlencode({k:v[0] for k,v in values.items()})
   def alter(path,status,body):
    if path!=token_path or status!=200 or mode not in ['issuer','audience','nonce','expiry','signature']:return body
    data=json.loads(body);header=jwt.get_unverified_header(data['id_token']);claims=jwt.decode(data['id_token'],options={'verify_signature':False})
    if mode=='issuer':claims['iss']='https://wrong.example.invalid'
    if mode=='audience':claims['aud']='alisa_compatibility_stage'
    if mode=='nonce':claims['nonce']='wrong-synthetic-nonce'
    if mode=='expiry':claims['exp']=int(time.time())-120
    data['id_token']=jwt.encode(claims,bad if mode=='signature' else key,algorithm='RS256',headers={'kid':header['kid']});mutated.append(True);return json.dumps(data).encode()
   def alter_request(path,body):
    if path!=token_path or mode!='pkce':return body
    q=parse_qs(body.decode());q['code_verifier']=['wrong-verifier-'+'x'*40];mutated.append(True);return urlencode({k:v[0] for k,v in q.items()}).encode()
   proxy.response_hook=alter;proxy.request_hook=alter_request
   if mode=='state':
    def wrong_state(path):
     u=urlsplit(path)
     if u.path!='/auth/callback':return path
     q=parse_qs(u.query);q['state']=['wrong-synthetic-state'];mutated.append(True);return u._replace(query=urlencode({k:v[0] for k,v in q.items()})).geturl()
    webproxy.path_hook=wrong_state
   try:
    page.goto(href);check(mode+'_fixture_applied',bool(mutated));expect(page).to_have_url(re.compile('/login\\?error=AUTH_FAILED'));check('real_bff_rejects_'+mode,page.request.get(WEB+'/api/account/me').status==401)
   finally:webproxy.path_hook=None;proxy.response_hook=None;proxy.request_hook=None;context.close()
  check('negative_callbacks_create_no_customer',sql('SELECT count(*) FROM accounts_customer')[0][0]==before)
  context=browser.new_context(storage_state=str(BACK/'synthetic-browser-state.json'));page=context.new_page();page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
  command('systemctl','stop','alisa-platform@stage.service')
  try:check('actual_api_outage_reported',page.request.get(WEB+'/api/account/me').status==503)
  finally:command('systemctl','start','alisa-platform@stage.service')
  time.sleep(.8);page.reload();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('api_recovery_preserves_session',True)
  second=json.loads((BACK/'synthetic-second-browser-state.json').read_text());token=next(c['value'] for c in second['cookies'] if c['name']=='__Host-alisa_session');digest=hashlib.sha256(token.encode()).hexdigest();sql("UPDATE accounts_websession SET expires_at=now()-interval '1 second' WHERE token_hash=%s",[digest]);sc=browser.new_context(storage_state=str(BACK/'synthetic-second-browser-state.json'));check('expired_own_session_denied',sc.request.get(WEB+'/api/account/me').status==401);sc.close()
  command('systemctl','start','alisa-account-cleanup@stage.service');check('cleanup_clears_expired_own_payload',sql('SELECT encrypted_payload FROM accounts_websession WHERE token_hash=%s',[digest])[0][0]=='');check('cleanup_preserves_active_profile',page.request.get(WEB+'/api/account/me').status==200)
  result['status']='PASS'
 except Exception as ex:
  result['status']='FAILED';result['error_type']=type(ex).__name__
  if isinstance(ex,RuntimeError) and str(ex).startswith('CHECK_FAILED:'):result['failed_case']=str(ex).split(':',1)[1]
  if 'page' in locals():result['last_browser_path']=urlsplit(page.url).path
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:result['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  if browser:browser.close()
  if pw:pw.stop()
  if changed:v.write_text(old);command('nginx','-t');command('systemctl','reload','nginx')
  if proxy:proxy.shutdown();proxy.server_close()
  if webproxy:webproxy.shutdown();webproxy.server_close()
  result['temporary_token_proxy_removed']=v.read_text()==old;result['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();RESULT.write_text(json.dumps(result,indent=2));print(json.dumps({'status':result['status'],'cases':len(CASES),'line':result.get('line'),'failed_case':result.get('failed_case'),'error_type':result.get('error_type')}))
 return result['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
