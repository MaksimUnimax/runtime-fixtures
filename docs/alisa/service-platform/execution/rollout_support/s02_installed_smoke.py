"""Finite authorized installed S02 smoke. Own stage and synthetic fixtures only."""
import os,sys,pathlib,json,datetime,uuid,re,time,hashlib,subprocess,urllib.request,urllib.error,base64,fcntl,contextlib
from urllib.parse import urlsplit,parse_qs,urlencode
from email.parser import BytesParser
from email import policy
import psycopg
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');R='alisa-6ae348354b3db0d3';REL=B/'releases'/R;BACK=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s02-6ae348354b3db0d3');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');WEB='https://alisa-stage.octoport.ru';IDP='https://id-stage.octoport.ru';RUN=uuid.uuid4().hex[:12];CASES=[];PRIVATE=[]
sys.path.append(str(REL/'.venv/lib/python3.12/site-packages'))
import jwt

def cfg(n):return dict(l.split('=',1) for l in (pathlib.Path('/etc/alisa-platform/stage')/(n+'.env')).read_text().splitlines() if l and not l.startswith('#') and '=' in l)
CFG={c:cfg(c) for c in ['platform','identity','web']}
assert CFG['platform']['ALISA_DB_NAME']=='alisa_stage_platform' and CFG['identity']['ALISA_DB_NAME']=='alisa_stage_identity'
def db(c):
 d=CFG[c];return psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],connect_timeout=3,autocommit=True)
def sql(c,q,args=()):
 with db(c) as con:
  cur=con.execute(q,args);return cur.fetchall() if cur.description else []
def check(n,ok,**safe):
 CASES.append({'case':n,'passed':bool(ok),**safe});print(json.dumps(CASES[-1]),flush=True)
 if not ok:raise RuntimeError('CHECK_FAILED:'+n)
def command(*args):return subprocess.run(list(args),capture_output=True,text=True,check=True,timeout=30)
def request(url,method='GET',data=None,headers=None):
 req=urllib.request.Request(url,method=method,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json',**(headers or {})})
 try:r=urllib.request.urlopen(req,timeout=10)
 except urllib.error.HTTPError as e:r=e
 with r:return r.status,r.read(),dict(r.headers)
def drain(c):command('systemctl','start','alisa-'+('identity-mail' if c=='identity' else 'lead-mail')+'@stage.service')
def letter(email,code=True):
 for p in sorted(pathlib.Path('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml'),key=lambda p:p.stat().st_mtime,reverse=True):
  m=BytesParser(policy=policy.default).parsebytes(p.read_bytes())
  if email not in str(m.get('To','')):continue
  body=m.get_body(preferencelist=('plain',)).get_content()
  if code:
   match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',body)
   if match:PRIVATE.append(match[1]);return match[1]
  else:
   match=re.search(r'https://[^\s]+/join/confirm#[^\s]+',body)
   if match:PRIVATE.extend(v[0] for v in parse_qs(urlsplit(match[0]).fragment).values());return match[0]
 raise RuntimeError('Private synthetic mail missing')
def open_identity(page):
 page.goto(WEB);page.locator('footer a[href="/login"]').click();page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click();page.wait_for_url(re.compile(re.escape(IDP)+'/accounts/'))
def register(page,email,callbacks):
 open_identity(page);page.locator('a[href*="/accounts/signup/"]').first.click();page.locator('input[name=email]').fill(email);page.locator('input[name=privacy]').check();page.locator('input[name=service]').check();page.locator('form').filter(has=page.locator('input[name=email]')).locator('button[type=submit]').first.click();expect(page.locator('input[name=code]')).to_be_visible();drain('identity')
 refs=[c['value'] for c in page.context.cookies() if c['name']=='__Host-alisa_login'];urls=[];page.on('request',lambda r:urls.append(r.url) if r.url.startswith(WEB+'/auth/callback?') else None)
 page.locator('input[name=code]').fill(letter(email));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=20000)
 if refs and urls:callbacks.append((urls[-1],refs[-1]));PRIVATE.extend(v[0] for v in parse_qs(urlsplit(urls[-1]).query).values())

def run():
 RESULT=E/'AL_S02_INSTALLED_SMOKE_20261105.json'
 if RESULT.exists():raise RuntimeError('Existing smoke receipt: inspect outcome before rerun')
 rec={'record_type':'EXACT_INSTALLED_S02_STAGE_SMOKE','release':R,'source_sha':'6ae348354b3db0d3cdcdac03c7fcc7dd3ca0eb36','artifact_sha256':'4848fc3e0975d4b3fb347e7b0f5634c44ad81d01a31690263a3bf31cfb83136c','started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'cases':CASES,'status':'RUNNING','fixture_run_id':RUN}
 RESULT.write_text(json.dumps(rec,indent=2));p=None;browser=None;context=None
 try:
  assert (B/'site-current').resolve()==REL and (B/'identity-current').resolve()==REL
  for c in ['platform','identity']:
   check(c+'_runtime_has_no_ddl',not sql(c,"SELECT has_schema_privilege(current_user,'public','CREATE')")[0][0])
   d=CFG[c];denied=False
   try:psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname='alisa_stage_'+('identity' if c=='platform' else 'platform'),user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],connect_timeout=3).close()
   except psycopg.OperationalError:denied=True
   check(c+'_foreign_database_denied',denied)
  check('own_api_without_auth_denied',request('http://127.0.0.1:18102/api/v1/account/me','POST',{'session_token':'x'*43})[0]==401)
  meta=json.loads(request(IDP+'/.well-known/openid-configuration')[1]);check('real_https_fixed_issuer_s256',meta['issuer']==IDP and meta['code_challenge_methods_supported']==['S256'])
  p=sync_playwright().start();browser=p.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});context=browser.new_context(ignore_https_errors=False);page=context.new_page();page.set_default_timeout(15000)
  page.goto(WEB+'/app');expect(page).to_have_url(re.compile('/login'));check('anonymous_private_home_closed',True)
  check('start_requires_consents',page.request.post(WEB+'/auth/start',form={},headers={'Origin':WEB}).status==422)
  check('cross_origin_denied',page.request.post(WEB+'/auth/start',form={'service':'on','privacy':'on'},headers={'Origin':'https://wrong.example.invalid'}).status==403)
  nojs=browser.new_context(java_script_enabled=False);np=nojs.new_page();np.goto(WEB+'/join');check('no_js_contact_not_in_query',np.locator('form').get_attribute('method')=='post' and np.get_by_role('button',name='Отправить тестовую заявку').is_disabled());nojs.close()
  email='s02-'+RUN+'@example.invalid';PRIVATE.append(email)
  page.goto(WEB+'/join');page.locator('input[name=email]').fill(email);page.locator('input[name=service]').check();page.get_by_role('button',name='Отправить тестовую заявку').click();expect(page.get_by_role('status')).to_contain_text('Заявка сохранена');drain('platform');page.goto(letter(email,False));page.get_by_role('button',name='Подтвердить контакт').click();expect(page.get_by_role('status')).to_contain_text('Контакт подтверждён');check('real_bff_api_pg_sandbox_lead_confirmation',True)
  callbacks=[];register(page,email,callbacks);check('real_https_browser_email_code_bff_api_pg_cabinet',True)
  first=sql('platform','SELECT m.customer_id,m.tenant_id FROM accounts_membership m JOIN accounts_customer c ON m.customer_id=c.id WHERE c.email=%s',[email])[0]
  check('one_customer_tenant_identity_link',len(sql('platform','SELECT id FROM accounts_customer WHERE email=%s',[email]))==1 and len(sql('platform','SELECT id FROM accounts_identitylink WHERE customer_id=%s',[first[0]]))==1)
  check('owner_client_no_grants',sql('platform','SELECT role FROM accounts_membership WHERE customer_id=%s',[first[0]])[0][0]=='OWNER_CLIENT')
  check('durable_product_consents',sql('platform','SELECT count(*) FROM accounts_consentrecord WHERE customer_id=%s',[first[0]])[0][0]==2)
  check('confirmed_lead_handoff',sql('platform','SELECT count(*) FROM accounts_leadlink WHERE customer_id=%s',[first[0]])[0][0]==1)
  person=sql('identity','SELECT id FROM accounts_person WHERE email=%s',[email])[0][0];check('stable_person_and_identity_consents',sql('identity','SELECT count(*) FROM accounts_identityconsent WHERE person_id=%s',[person])[0][0]==2)
  page.locator('input[name=display_name]').fill('Тестовый пользователь S02');page.get_by_role('button',name='Сохранить профиль').click();expect(page.locator('input[name=display_name]')).to_have_value('Тестовый пользователь S02');page.reload();expect(page.locator('input[name=display_name]')).to_have_value('Тестовый пользователь S02');check('profile_persists_and_empty_shop',page.get_by_text('Подключённых магазинов пока нет.').is_visible())
  page.locator('section[aria-label=Магазины]').screenshot(path=str(E/'AL_S02_EMPTY_STATE_20261105.png'))
  cookie=next(c for c in context.cookies() if c['name']=='__Host-alisa_session');PRIVATE.append(cookie['value']);check('host_only_secure_httponly_session',cookie['domain']=='alisa-stage.octoport.ru' and cookie['secure'] and cookie['httpOnly'] and cookie['sameSite']=='Lax')
  check('no_tokens_in_browser_storage','eyJ' not in page.evaluate('JSON.stringify(localStorage)+JSON.stringify(sessionStorage)'))
  replay=browser.new_context();url,ref=callbacks[0];replay.add_cookies([{'name':'__Host-alisa_login','value':ref,'url':WEB,'secure':True,'httpOnly':True}]);resp=replay.request.get(url);check('callback_replay_safe_no_session','ALREADY_HANDLED_OR_EXPIRED' in resp.url and replay.request.get(WEB+'/api/account/me').status==401);replay.close()
  second=browser.new_context();sp=second.new_page();email2='s02-'+RUN+'-second@example.invalid';PRIVATE.append(email2);second.add_cookies([{'name':'__Host-alisa_handoff','value':str(sql('platform','SELECT s.id FROM leads_submission s JOIN leads_lead l ON s.lead_id=l.id WHERE l.email=%s',[email])[0][0]),'url':WEB,'secure':True,'httpOnly':True}]);register(sp,email2,[])
  check('second_client_isolated',sp.get_by_text(email2,exact=True).is_visible() and not sp.get_by_text(email,exact=True).count())
  second_tenant=sql('platform','SELECT m.tenant_id FROM accounts_membership m JOIN accounts_customer c ON c.id=m.customer_id WHERE c.email=%s',[email2])[0][0]
  check('foreign_handoff_does_not_link',sql('platform','SELECT count(*) FROM accounts_leadlink WHERE customer_id<>%s',[first[0]])[0][0]==0)
  check('tenant_spoof_denied',page.request.post(WEB+'/api/account/profile',data={'display_name':'bad','tenant_id':str(second_tenant)},headers={'Origin':WEB}).status==422 and page.request.get(WEB+'/api/account/me?tenant_id='+str(second_tenant)).status==422)
  foreign=browser.new_context();foreign.add_cookies([{'name':'octoport_session','value':'synthetic-foreign-cookie','url':WEB,'secure':True}]);check('foreign_cookie_denied',foreign.request.get(WEB+'/api/account/me').status==401);foreign.close()
  check('foreign_return_to_denied',page.request.post(WEB+'/auth/start',form={'service':'on','privacy':'on','return_to':'https://wrong.example.invalid'},headers={'Origin':WEB}).status==422)
  check('external_identity_reauth_target_denied',page.request.get(IDP+'/accounts/reauthenticate/?'+urlencode({'next':'https://wrong.example.invalid'}),max_redirects=0).status==400)
  nonce=uuid.uuid4().hex;state=uuid.uuid4().hex;verifier=base64.urlsafe_b64encode(os.urandom(48)).rstrip(b'=').decode();challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode();authurl=meta['authorization_endpoint']+'?'+urlencode({'client_id':'alisa_compatibility_stage','redirect_uri':WEB+'/oidc-probe/callback','response_type':'code','scope':'openid email','state':state,'nonce':nonce,'code_challenge':challenge,'code_challenge_method':'S256'})
  page.goto(authurl);page.locator('button[name=action][value=grant]').click();page.wait_for_url(re.compile('/oidc-probe/callback'));values=parse_qs(urlsplit(page.url).query);check('second_rp_state_preserved',values.get('state')==[state]);bs=dict(l.split('=',1) for l in (BACK/'bootstrap.env').read_text().splitlines());form=urlencode({'grant_type':'authorization_code','code':values['code'][0],'redirect_uri':WEB+'/oidc-probe/callback','code_verifier':verifier}).encode();req=urllib.request.Request(meta['token_endpoint'],data=form,headers={'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+base64.b64encode(('alisa_compatibility_stage:'+bs['ALISA_PROBE_OIDC_CLIENT_SECRET']).encode()).decode()})
  with urllib.request.urlopen(req,timeout=10) as res:tokens=json.load(res)
  keys=json.loads(request(meta['jwks_uri'])[1]);kid=jwt.get_unverified_header(tokens['id_token'])['kid'];key=jwt.PyJWK.from_dict(next(k for k in keys['keys'] if k['kid']==kid)).key;claims=jwt.decode(tokens['id_token'],key,algorithms=['RS256'],audience='alisa_compatibility_stage',issuer=IDP);check('second_rp_valid_identity_only',claims['nonce']==nonce and claims['email']==email);PRIVATE.extend([tokens['id_token'],tokens['access_token'],*values.get('code',[])])
  forged=browser.new_context();forged.add_cookies([{'name':'__Host-alisa_session','value':tokens['id_token'],'url':WEB,'secure':True}]);check('second_rp_has_no_product_access',forged.request.get(WEB+'/api/account/me').status==401);forged.close()
  check('pairwise_subjects_same_person',sql('identity','SELECT count(DISTINCT id) FROM accounts_subject WHERE person_id=%s',[person])[0][0]==2)
  page.goto(WEB+'/app');page.get_by_role('button',name='Выйти из кабинета').click();expect(page).to_have_url(re.compile('/login'));check('logout_revokes_server_session',not sql('platform','SELECT id FROM accounts_websession WHERE token_hash=%s AND revoked_at IS NULL',[hashlib.sha256(cookie['value'].encode()).hexdigest()]))
  open_identity(page)
  if page.get_by_role('button',name='Продолжить вход по коду').count():page.get_by_role('button',name='Продолжить вход по коду').click()
  f=page.locator('input[name=login],input[name=email]').first;expect(f).to_be_visible();f.fill(email);page.locator('form').filter(has=f).locator('button[type=submit]').first.click();expect(page.locator('input[name=code]')).to_be_visible();drain('identity');page.locator('input[name=code]').fill(letter(email));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=20000)
  check('repeat_login_same_person_customer_tenant',sql('platform','SELECT m.customer_id,m.tenant_id FROM accounts_membership m JOIN accounts_customer c ON c.id=m.customer_id WHERE c.email=%s',[email])[0]==first and sql('identity','SELECT id FROM accounts_person WHERE email=%s',[email])[0][0]==person)
  command('systemctl','restart','alisa-platform@stage.service','alisa-identity@stage.service');time.sleep(1);page.reload();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=20000);check('restart_preserves_profile_session_ids',page.get_by_text(email,exact=True).is_visible() and sql('platform','SELECT id FROM accounts_tenant WHERE id=%s',[first[1]])[0][0]==first[1])
  context.storage_state(path=str(BACK/'synthetic-browser-state.json'));second.storage_state(path=str(BACK/'synthetic-second-browser-state.json'))
  (BACK/'synthetic-fixture.json').write_text(json.dumps({'run':RUN,'email':email,'email2':email2,'person_id':str(person),'customer_id':str(first[0]),'tenant_id':str(first[1]),'probe_authorize_url':authurl,'private_values':PRIVATE}))
  rec['status']='PASS';rec['customer_id']=str(first[0]);rec['tenant_id']=str(first[1]);rec['person_id']=str(person)
 except Exception as ex:
  rec['status']='FAILED';rec['error_type']=type(ex).__name__
  if isinstance(ex,RuntimeError) and str(ex).startswith('CHECK_FAILED:'):rec['failed_case']=str(ex).split(':',1)[1]
  if 'page' in locals():rec['last_browser_path']=urlsplit(page.url).path
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:rec['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  if browser:browser.close()
  if p:p.stop()
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();rec['case_count']=len(CASES);RESULT.write_text(json.dumps(rec,indent=2));print(json.dumps({'status':rec['status'],'cases':len(CASES),'failed_case':rec.get('failed_case'),'error_type':rec.get('error_type'),'line':rec.get('line')}),flush=True)
 return rec['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
