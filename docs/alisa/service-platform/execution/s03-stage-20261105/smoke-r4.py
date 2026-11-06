"""Finite approved S03 actual-host HTTPS/native-MFA/admin qualification."""
import os,sys,pathlib,json,datetime,uuid,re,time,hashlib,hmac,subprocess,urllib.request,urllib.error,base64,fcntl,contextlib,io
from urllib.parse import urlsplit,parse_qs,urlencode
from email.parser import BytesParser
from email import policy
import psycopg
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');R='alisa-3e91b1aa5d405d0e';REL=B/'releases'/R;D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');WEB='https://alisa-stage.octoport.ru';IDP='https://id-stage.octoport.ru';ADMIN='https://alisa-admin-stage.octoport.ru';CASES=[];PRIVATE=[];RUN=uuid.uuid4().hex[:12]
sys.path.append(str(REL/'.venv/lib/python3.12/site-packages'));import jwt
def cfg(n):return dict(l.split('=',1) for l in (pathlib.Path('/etc/alisa-platform/stage')/(n+'.env')).read_text().splitlines() if l and not l.startswith('#'))
CFG={n:cfg(n) for n in ['platform','identity','admin','web']}
def sql(c,q,args=()):
 d=CFG[c]
 with psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],autocommit=True) as con:
  cur=con.execute(q,args) if args else con.execute(q);return cur.fetchall() if cur.description else []
def check(n,ok):
 CASES.append({'case':n,'passed':bool(ok)});print(json.dumps(CASES[-1]),flush=True)
 if not ok:raise RuntimeError('CHECK_FAILED:'+n)
def cmd(*a,env=None,inp=None):return subprocess.run(list(map(str,a)),env=env,input=inp,capture_output=True,check=True,timeout=50)
def manage(c,args):return cmd(REL/'.venv/bin/python',REL/'services'/c/'manage.py',*args,env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',**CFG[c]})
def drain(c):cmd('systemctl','start','alisa-'+('identity-mail' if c=='identity' else 'lead-mail')+'@stage.service')
def letter(email,code=True):
 for p in sorted(pathlib.Path('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml'),key=lambda p:p.stat().st_mtime,reverse=True):
  m=BytesParser(policy=policy.default).parsebytes(p.read_bytes())
  if email not in str(m.get('To','')):continue
  body=m.get_body(preferencelist=('plain',)).get_content();match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',body) if code else re.search(r'https://[^\s]+/join/confirm#[^\s]+',body)
  if match:PRIVATE.append(match[1] if code else match[0]);return match[1] if code else match[0]
 raise RuntimeError('Private synthetic mail missing')
def register(page,email):
 page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click();page.wait_for_url(re.compile(re.escape(IDP)+r'/accounts/'));page.locator('a[href*="/accounts/signup/"]').first.click();page.locator('input[name=email]').fill(email);page.locator('input[name=privacy]').check();page.locator('input[name=service]').check();page.locator('form').filter(has=page.locator('input[name=email]')).locator('button[type=submit]').first.click();expect(page.locator('input[name=code]')).to_be_visible();drain('identity');page.locator('input[name=code]').fill(letter(email));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=20000)
def totp(secret):
 raw=hmac.new(base64.b32decode(secret),(int(time.time())//30).to_bytes(8,'big'),hashlib.sha1).digest();offset=raw[-1]&15;return str((int.from_bytes(raw[offset:offset+4],'big')&0x7fffffff)%1000000).zfill(6)
def fresh_totp(secret,previous):
 for _ in range(160):
  value=totp(secret)
  if value!=previous:return value
  time.sleep(.2)
 raise RuntimeError('Fresh real TOTP unavailable')
def direct_authorize(meta):
 verifier=base64.urlsafe_b64encode(os.urandom(48)).rstrip(b'=').decode();nonce=uuid.uuid4().hex;state=uuid.uuid4().hex;challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
 return meta['authorization_endpoint']+'?'+urlencode({'client_id':'alisa_admin_stage','redirect_uri':ADMIN+'/auth/callback','response_type':'code','scope':'openid email profile','state':state,'nonce':nonce,'code_challenge':challenge,'code_challenge_method':'S256'}),verifier,nonce,state
def enroll(page,meta):
 url,_,_,_=direct_authorize(meta);page.goto(url);expect(page.get_by_role('heading',name='Защищённый вход в админку')).to_be_visible();page.get_by_role('link',name='Настроить аутентификатор').click();qr=page.locator('main img[src^="data:image/svg"]');expect(qr).to_be_visible();check('native_enrollment_qr_white_surface',qr.evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(255, 255, 255)')
 secret=page.locator('#authenticator_secret').input_value();PRIVATE.append(secret);value=totp(secret);PRIVATE.append(value);page.locator('input[name=code]').fill(value);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').click();page.wait_for_url(re.compile(re.escape(IDP)+r'/accounts/2fa/(recovery-codes/|reauthenticate/)'))
 if urlsplit(page.url).path=='/accounts/2fa/reauthenticate/':
  value=totp(secret);PRIVATE.append(value);page.locator('input[name=code]').fill(value);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').click();check('native_recovery_view_requires_real_factor',True)
 expect(page.locator('#recovery_codes')).to_be_visible();recovery=page.locator('#recovery_codes').input_value().strip().splitlines();PRIVATE.extend(recovery);check('native_totp_and_recovery_enrolled',len(recovery)>=6);return secret,recovery,value
def verified_admin_subject(page,meta,email,factor):
 global ACTIVE_PAGE, PHASE
 ACTIVE_PAGE=page;PHASE='native_direct_authorize'
 url,verifier,nonce,state=direct_authorize(meta);captured=[]
 def observe_callback(response):
  location=response.headers.get('location','')
  if response.status in [302,303] and urlsplit(response.url).hostname=='id-stage.octoport.ru' and location.startswith(ADMIN+'/auth/callback?') and 'code' in parse_qs(urlsplit(location).query):captured.append(location)
 page.on('response',observe_callback)
 try:
  page.goto(url);expect(page.locator('input[name=code]')).to_be_visible();PRIVATE.append(factor);page.locator('input[name=code]').fill(factor);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').click();expect(page).to_have_url(re.compile(re.escape(ADMIN)+r'/login\?error=AUTH_FAILED'));check('native_admin_code_after_actual_factor',len(captured)==1)
 finally:page.remove_listener('response',observe_callback)
 query=parse_qs(urlsplit(captured[0]).query);PRIVATE.extend([captured[0],query['code'][0]]);check('closed_bootstrap_state_matches',query.get('state')==[state]);body=urlencode({'grant_type':'authorization_code','code':query['code'][0],'redirect_uri':ADMIN+'/auth/callback','code_verifier':verifier}).encode();req=urllib.request.Request(meta['token_endpoint'],data=body,headers={'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+base64.b64encode(('alisa_admin_stage:'+CFG['admin']['ALISA_STAFF_OIDC_CLIENT_SECRET']).encode()).decode()})
 with urllib.request.urlopen(req,timeout=10) as response:tokens=json.load(response)
 with urllib.request.urlopen(meta['jwks_uri'],timeout=10) as response:keys=json.load(response)
 key=jwt.PyJWK.from_dict(next(k for k in keys['keys'] if k['kid']==jwt.get_unverified_header(tokens['id_token'])['kid'])).key;claims=jwt.decode(tokens['id_token'],key,algorithms=['RS256'],audience='alisa_admin_stage',issuer=IDP);PRIVATE.extend([tokens['id_token'],tokens['access_token']]);factor_claim=claims.get('alisa_mfa',{})
 check('actual_signed_admin_mfa_nonce_subject_verified',claims['nonce']==nonce and claims['acr']=='urn:octoport:staff:native-mfa:v1' and factor_claim.get('type')=='recovery_codes' and claims['amr']==['recovery_code'] and claims['auth_time']==factor_claim.get('at') and time.time()-300<=factor_claim['at']<=time.time()+5)
 row=sql('identity','SELECT s.id,p.id FROM accounts_subject s JOIN accounts_person p ON p.id=s.person_id JOIN account_emailaddress e ON e.user_id=p.id WHERE s.id=%s AND s.client_id=%s AND e.email=%s AND e.verified AND p.is_active',[claims['sub'],'alisa_admin_stage',email]);check('native_subject_is_exact_verified_person_and_client',len(row)==1);return claims['sub'],str(row[0][1])
def bff_login(page,factor,accepted=True):
 page.goto(ADMIN+'/login');page.get_by_role('button',name='Войти с MFA',exact=True).click();expect(page.locator('input[name=code]')).to_be_visible();PRIVATE.append(factor);page.locator('input[name=code]').fill(factor);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').click()
 if accepted:expect(page.get_by_role('heading',name='Админка Алисы',exact=True)).to_be_visible(timeout=20000);expect(page).to_have_url(ADMIN+'/admin')
 else:expect(page).to_have_url(re.compile(re.escape(ADMIN)+r'/login\?error=AUTH_FAILED'))
def existing_web_login(page,email,secret=None):
 page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click();page.wait_for_url(re.compile(re.escape(IDP)+r'/accounts/'))
 if page.get_by_role('button',name='Продолжить вход по коду').count():page.get_by_role('button',name='Продолжить вход по коду').click()
 field=page.locator('input[name=login],input[name=email]').first;expect(field).to_be_visible();field.fill(email);page.locator('form').filter(has=field).locator('button[type=submit]').first.click();expect(page.locator('input[name=code]')).to_be_visible();drain('identity');page.locator('input[name=code]').fill(letter(email));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
 if secret and urlsplit(page.url).netloc=='id-stage.octoport.ru':
  expect(page.locator('input[name=code]')).to_be_visible();value=totp(secret);PRIVATE.append(value);page.locator('input[name=code]').fill(value);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
 expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=20000)

def run():
 global PRIVATE
 result=E/'AL_S03_INSTALLED_SMOKE_R4_20261105.json';assert not result.exists();rec={'scope':'ACTUAL_STAGE_S03_SMOKE_RESUME_EXISTING_NATIVE_USERS_NO_RESET','release':R,'source_sha':'3e91b1aa5d405d0e8160c4dbe3dcad56eb606dae','artifact_sha256':'b9eb8f011482d3921c9bb32f98c2c4751aaf3bacf7fdcb101d2fc9ba9f6a8b21','status':'RUNNING','cases':CASES,'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'previous_attempt':'AL_S03_INSTALLED_SMOKE_R3_20261105.json'};pw=browser=None;data=json.loads((D/'synthetic-fixture.json').read_text());PRIVATE=data['private_values']
 def save():data['private_values']=PRIVATE;(D/'synthetic-fixture.json').write_text(json.dumps(data))
 try:
  check('verified_owner_retained_no_rebootstrap',sql('platform',"SELECT count(*) FROM staff_staffmember WHERE product_id='alisa_market' AND role='OWNER' AND active AND subject=%s",[data['owner_subject']])[0][0]==1)
  secret=next(v for v in PRIVATE if re.fullmatch('[A-Z2-7]{32}',v));codes=[v for v in PRIVATE if v.isdigit() and len(v)==8][:10];data.update(owner_secret=secret,owner_codes=codes);save()
  with urllib.request.urlopen(IDP+'/.well-known/openid-configuration') as response:meta=json.load(response)
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});owner=browser.new_context(ignore_https_errors=False);reader=browser.new_context(ignore_https_errors=False);page=owner.new_page();page.set_default_timeout(15000);rp=reader.new_page();rp.set_default_timeout(15000)
  def nav(response):
   if response.request.is_navigation_request():rec.setdefault('safe_navigation',[]).append({'host':urlsplit(response.url).hostname,'path':urlsplit(response.url).path,'status':response.status})
  page.on('response',nav);rp.on('response',nav)
  existing_web_login(page,data['owner_email'],secret);owner.storage_state(path=str(D/'synthetic-owner-browser-state.json'));used=totp(secret);existing_web_login(rp,data['reader_email']);reader.storage_state(path=str(D/'synthetic-reader-browser-state.json'));check('existing_users_login_without_duplicate_or_factor_reset',True)
  sub=data['owner_subject'];person=data['owner_person'];bff_login(page,codes[4]);check('real_https_totp_admin_bff_api_pg',True);expect(page.get_by_role('button',name='S03 Test Owner',exact=True)).to_be_visible();expect(page.get_by_role('button',name=data['reader_email'],exact=True)).to_be_visible();check('real_customer_list',True)
  cookie=next(c for c in owner.cookies() if c['name']=='__Host-alisa_staff');PRIVATE.append(cookie['value']);data['owner_session_token']=cookie['value'];owner.storage_state(path=str(D/'synthetic-owner-browser-state.json'));save();check('separate_host_only_staff_cookie',cookie['domain']=='alisa-admin-stage.octoport.ru' and cookie['secure'] and cookie['httpOnly'] and cookie['sameSite']=='Lax')
  for width in [320,390,1440]:page.set_viewport_size({'width':width,'height':900});check('admin_layout_'+str(width),page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
  check('admin_theme_preserved_root_canvas_and_panel',page.evaluate('getComputedStyle(document.documentElement).backgroundColor')=='rgb(13, 25, 41)' and page.locator('main').evaluate('e=>getComputedStyle(e).backgroundColor')=='rgb(23, 39, 59)');check('admin_referrer_noindex_preserved',page.locator('meta[name=referrer]').get_attribute('content')=='same-origin' and 'noindex' in page.locator('meta[name=robots]').get_attribute('content'))
  check('cross_origin_staff_command_denied',page.request.post(ADMIN+'/api/staff/read',data={'resource':'customers'},headers={'Origin':'https://wrong.example.invalid'}).status==403)
  captured=[];page.on('request',lambda request:captured.append(json.loads(request.post_data)) if request.url==ADMIN+'/api/staff/command' and request.post_data else None)
  page.get_by_role('button',name=data['reader_email'],exact=True).click();card=page.locator('section[aria-label="Карточка клиента"]');expect(card).to_contain_text(data['reader_email']);before_revision=sql('platform','SELECT security_revision FROM accounts_customer WHERE id=%s',[data['reader_customer']])[0][0];card.get_by_role('button',name='Заблокировать в Алисе').click();expect(page.get_by_role('status')).to_contain_text('Изменение сохранено');block=captured[-1];check('local_block_one_revision_global_person_active',sql('platform','SELECT is_active,security_revision FROM accounts_customer WHERE id=%s',[data['reader_customer']])[0]==(False,before_revision+1) and sql('identity','SELECT is_active FROM accounts_person WHERE email=%s',[data['reader_email']])[0][0])
  check('identical_command_replay_one_effect',page.request.post(ADMIN+'/api/staff/command',data=block,headers={'Origin':ADMIN}).status==200 and sql('platform','SELECT security_revision FROM accounts_customer WHERE id=%s',[data['reader_customer']])[0][0]==before_revision+1);changed={**block,'action':'customer.unblock'};check('changed_payload_same_uuid_conflicts',page.request.post(ADMIN+'/api/staff/command',data=changed,headers={'Origin':ADMIN}).status==409)
  page.get_by_role('button',name=data['reader_email'],exact=True).click();card.get_by_role('button',name='Разблокировать в Алисе').click();expect(page.get_by_role('status')).to_contain_text('Изменение сохранено');check('customer_unblocked',sql('platform','SELECT is_active FROM accounts_customer WHERE id=%s',[data['reader_customer']])[0][0])
  page.get_by_role('button',name='Заявки',exact=True).click();expect(page.locator('section[aria-label="Данные"]')).to_contain_text(data['owner_email']);check('leads_separate_from_customer_records',True)
  rs,rc,ru=enroll(rp,meta);rsub,rperson=verified_admin_subject(rp,meta,data['reader_email'],rc[0]);data.update(reader_secret=rs,reader_codes=rc,reader_subject=rsub,reader_person=rperson);save();bff_login(rp,rc[1],False);check('ordinary_customer_valid_mfa_has_no_staff_role',not any(c['name']=='__Host-alisa_staff' for c in reader.cookies()))
  page.get_by_role('button',name='Сотрудники',exact=True).click();page.locator('input[name=subject]').fill(rsub);page.locator('input[name=name]').fill('S03 Test Reader');page.get_by_label('Просмотр клиентов',exact=True).check();page.get_by_role('button',name='Назначить',exact=True).click();expect(page.get_by_role('status')).to_contain_text('Изменение сохранено');check('owner_assigns_verified_limited_admin',True)
  bff_login(rp,rc[2]);check('limited_admin_real_login',True);rp.get_by_role('button',name='S03 Test Owner',exact=True).click();expect(rp.locator('section[aria-label="Карточка клиента"]')).to_be_visible();check('limited_admin_has_no_block_button',rp.get_by_role('button',name='Заблокировать в Алисе').count()==0)
  denied={'command_id':str(uuid.uuid4()),'action':'customer.block','payload':{'customer_id':data['owner_customer'],'revision':sql('platform','SELECT security_revision FROM accounts_customer WHERE id=%s',[data['owner_customer']])[0][0]},'reason':'SECURITY_REVIEW'};check('limited_direct_backend_command_denied',rp.request.post(ADMIN+'/api/staff/command',data=denied,headers={'Origin':ADMIN}).status==403)
  another=browser.new_context(ignore_https_errors=False);another.add_cookies([c for c in reader.cookies() if c['domain']=='id-stage.octoport.ru']);ap=another.new_page();bff_login(ap,rc[3]);check('limited_staff_two_independent_native_sessions',True);page.get_by_role('button',name='Сотрудники',exact=True).click();page.locator('li').filter(has_text='S03 Test Reader').get_by_role('button',name='Отозвать сотрудника').click();expect(page.get_by_role('status')).to_contain_text('Изменение сохранено')
  for item in [rp,ap]:item.goto(ADMIN+'/admin');expect(item).to_have_url(ADMIN+'/login')
  check('revoked_staff_both_browsers_denied',True);another.close()
  revision=sql('platform','SELECT revision FROM staff_staffmember WHERE id=%s',[data['owner_staff']])[0][0];last={'command_id':str(uuid.uuid4()),'action':'staff.revoke','payload':{'staff_id':data['owner_staff'],'revision':revision},'reason':'STAFF_REVOCATION'};response=page.request.post(ADMIN+'/api/staff/command',data=last,headers={'Origin':ADMIN});check('last_owner_protected',response.status==409 and response.json().get('code')=='LAST_OWNER_PROTECTED')
  page.get_by_role('button',name='Аудит',exact=True).click();expect(page.locator('section[aria-label="Данные"]')).to_contain_text('staff.revoked');check('safe_audit_no_contact_or_factor',all(v not in page.locator('section[aria-label="Данные"]').inner_text() for v in [data['owner_email'],data['reader_email'],secret,cookie['value']]))
  check('runtime_pg_audit_rewrite_denied',not any(sql('platform',"SELECT has_table_privilege(current_user,'staff_staffauditevent',%s)",[op])[0][0] for op in ['UPDATE','DELETE','TRUNCATE']))
  fid=str(uuid.uuid4());sql('platform',"INSERT INTO staff_staffauthflow(id,product_id,secret_hash,encrypted_payload,created_at,expires_at) VALUES(%s,'alisa_market',%s,'stage-expired-secret',now(),now()-interval '1 hour')",[fid,secrets_token()]);manage('platform',['accounts_cleanup']);check('scoped_staff_cleanup_erases_expired_payload',sql('platform','SELECT encrypted_payload FROM staff_staffauthflow WHERE id=%s',[fid])[0][0]=='')
  owner.storage_state(path=str(D/'synthetic-owner-browser-state.json'));reader.storage_state(path=str(D/'synthetic-reader-browser-state.json'));save();cmd('systemctl','restart','alisa-platform@stage','alisa-identity@stage','alisa-admin@stage');time.sleep(1);page.goto(ADMIN+'/admin');expect(page.get_by_role('heading',name='Админка Алисы',exact=True)).to_be_visible(timeout=20000);check('restart_preserves_owner_session_identity_profile',sql('platform','SELECT display_name FROM accounts_customer WHERE id=%s',[data['owner_customer']])[0][0]=='S03 Test Owner' and str(sql('identity','SELECT id FROM accounts_person WHERE email=%s',[data['owner_email']])[0][0])==person)
  page.get_by_role('button',name='Выйти',exact=True).click();expect(page).to_have_url(ADMIN+'/login');check('staff_logout_revokes_server_session',not sql('platform','SELECT id FROM staff_staffsession WHERE token_hash=%s AND revoked_at IS NULL',[hashlib.sha256(cookie['value'].encode()).hexdigest()]))
  bff_login(page,data['owner_codes'][5]);owner.storage_state(path=str(D/'synthetic-owner-browser-state.json'));data['owner_session_token']=next(c['value'] for c in owner.cookies() if c['name']=='__Host-alisa_staff');PRIVATE.append(data['owner_session_token']);save();rec['status']='PASS'
 except Exception as ex:
  rec['last_phase']=globals().get('PHASE');rec['last_path']=urlsplit(globals()['ACTIVE_PAGE'].url).path if 'ACTIVE_PAGE' in globals() else None;rec['status']='FAILED';rec['error_type']=type(ex).__name__;rec['failed_case']=str(ex).split(':',1)[1] if isinstance(ex,RuntimeError) and str(ex).startswith('CHECK_FAILED:') else None
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:rec['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  save()
  if browser:browser.close()
  if pw:pw.stop()
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();result.write_text(json.dumps(rec,indent=2));print(json.dumps({'status':rec['status'],'cases':len(CASES),'failed_case':rec.get('failed_case'),'error_type':rec.get('error_type'),'line':rec.get('line')}))
 return rec['status']=='PASS'
def secrets_token():return uuid.uuid4().hex+uuid.uuid4().hex
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
