"""Public password/email flow of an existing own example.invalid fixture; no DB access."""
import json,os,re,shutil,signal,subprocess,sys,time
from pathlib import Path as P
from email import policy
from email.parser import BytesParser
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
sys.dont_write_bytecode=True;os.umask(0o077)
D=P('/var/lib/alisa-platform/stage/rollout-backups/direct-login-20261108')
FIXTURE=P('/var/lib/alisa-platform/stage/rollout-backups/auth-navigation-20261108/fixture.private.json')
WEB='https://alisa.octoport.ru';ISSUER='https://id.octoport.ru';OUT=D/'browser.json';FLOOR=3072*1048576
record={'status':'FAILED','scope':'INSTALLED_PUBLIC_LOGIN_OWN_EXISTING_FIXTURE_ONLY','cases':[],'navigation':[],
        'direct_database_writes':0,'marketplace_calls':0,'owner_browser_flow':'NOT_RUN'}
def check(name,ok):
 record['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise ValueError(name)
def mail_code(email,after):
 deadline=time.monotonic()+75
 while time.monotonic()<deadline:
  for p in P('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml'):
   if p.stat().st_mtime<after:continue
   msg=BytesParser(policy=policy.default).parsebytes(p.read_bytes())
   if email not in str(msg.get('To','')):continue
   text=msg.get_body(preferencelist=('plain',)).get_content()if msg.is_multipart()else msg.get_content()
   match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',text)
   if match:return match.group(1)
  time.sleep(.5)
 raise TimeoutError()
def run():
 temporary=P(os.environ.get('TMPDIR','/')).resolve()
 check('private_tmpfs_browser_storage',str(temporary).startswith('/run/alisa-direct-login-browser-')
       and P(os.environ.get('HOME','/')).resolve()==temporary
       and subprocess.check_output(['stat','-f','-c','%T',str(temporary)],text=True).strip()=='tmpfs')
 check('tmpfs_capacity',shutil.disk_usage(temporary).free>=128*1048576)
 check('root_disk_and_memory_reserve',shutil.disk_usage('/').free>=FLOOR+1048576
       and next(int(x.split()[1])for x in P('/proc/meminfo').read_text().splitlines()if x.startswith('MemAvailable:'))>=2560*1024)
 s=FIXTURE.lstat();check('private_existing_fixture',s.st_uid==0 and s.st_mode&0o777==0o600 and not FIXTURE.is_symlink())
 fixture=json.loads(FIXTURE.read_text());email=fixture['email'];password=fixture['password']
 check('own_reserved_test_mailbox',email.startswith('auth-ux-')and email.endswith('@example.invalid'))
 check('bounded_test_mail_sink',len(list(P('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml')))<195)
 with sync_playwright()as p:
  browser=p.chromium.launch(headless=True)
  try:
   context=browser.new_context(ignore_https_errors=False,service_workers='block')
   allowed={WEB,ISSUER}
   def origin(url):
    u=urlsplit(url);return u.scheme+'://'+u.netloc
   def allow_request(route):
    if origin(route.request.url)in allowed:route.continue_()
    else:record['out_of_scope_request_blocked']=True;route.abort()
   context.route('**/*',allow_request)
   page=context.new_page();page.set_default_timeout(15000)
   def navigation(frame):
    if frame!=page.main_frame:return
    if frame.url=='about:blank':return
    if origin(frame.url)not in allowed:
     record['out_of_scope_main_frame']=True
     raise ValueError('OUT_OF_SCOPE_NAVIGATION')
    u=urlsplit(frame.url);record['navigation'].append(u.netloc+u.path)
   page.on('framenavigated',navigation)
   def require_origin(expected):
    check('approved_origin_before_sensitive_step',origin(page.url)==expected
          and not record.get('out_of_scope_main_frame')and not record.get('out_of_scope_request_blocked'))
   def front_door():
    page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check()
    page.get_by_role('button',name='Войти или создать кабинет',exact=True).click()
    page.wait_for_url(re.compile(re.escape(ISSUER)+r'/accounts/'))
    require_origin(ISSUER)
    expect(page.locator('input[name=login]')).to_be_visible();expect(page.locator('input[name=password]')).to_be_visible()
    check('direct_login_has_no_intermediate_confirmation',not page.get_by_role('button',name='Продолжить вход в кабинет',exact=True).count()
          and not page.get_by_role('heading',name='Подтвердите вход в кабинет',exact=True).count())
   def authenticate(negative_code=False):
    require_origin(ISSUER)
    page.locator('input[name=login]').fill(email);page.locator('input[name=password]').fill(password)
    require_origin(ISSUER)
    sent=time.time();page.locator('form').filter(has=page.locator('input[name=password]')).locator('button[type=submit]').click()
    expect(page.locator('input[name=code]')).to_be_visible();require_origin(ISSUER);code=mail_code(email,sent)
    if negative_code:
     require_origin(ISSUER)
     page.locator('input[name=code]').fill('AAAA-AAAA'if code!='AAAA-AAAA'else'BBBB-BBBB')
     page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
     expect(page.locator('input[name=code]')).to_be_visible()
     require_origin(ISSUER)
     check('wrong_email_code_cannot_open_cabinet',page.request.get(WEB+'/api/account/me').status==401)
    require_origin(ISSUER);page.locator('input[name=code]').fill(code);del code
    page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
    expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
    require_origin(WEB)
    response=page.request.get(WEB+'/api/account/me')
    check('native_login_reaches_own_existing_cabinet',response.status==200 and response.json()['profile']['email']==email)
    return response.json()['profile']
   # Start with an empty browser; existing fixture password and a genuinely
   # delivered code establish both sessions without copying any prior session.
   front_door();first=authenticate()
   product=next(c['value']for c in context.cookies()if c['name']=='__Host-alisa_session')
   page.goto(WEB+'/login')
   check('valid_product_session_still_opens_cabinet',urlsplit(page.url).path=='/app'
         and next(c['value']for c in context.cookies()if c['name']=='__Host-alisa_session')==product)
   identity=next(c['value']for c in context.cookies()if c['name']=='__Host-alisa_identity')
   context.clear_cookies(name='__Host-alisa_session');front_door()
   check('retained_identity_opens_password_form_directly',urlsplit(page.url).path=='/accounts/reauthenticate/'
      and page.locator('form').filter(has=page.locator('input[name=password]')).get_attribute('action')=='/accounts/reauthenticate/')
   check('rendering_form_preserves_native_sso',next(c['value']for c in context.cookies()if c['name']=='__Host-alisa_identity')==identity)
   check('no_old_success_flash',not any(re.search(r'Успешный вход|Successfully signed in|Адрес .* подтверждён',v)
         for v in page.get_by_role('status').all_inner_texts()))
   second=authenticate(negative_code=True)
   check('direct_reentry_preserves_same_customer_and_tenant',all(first[k]==second[k]for k in ['customer_id','tenant_id','email']))
   check('fresh_product_session_after_reentry',next(c['value']for c in context.cookies()if c['name']=='__Host-alisa_session')!=product)
   state=json.dumps(context.storage_state());check('bounded_own_private_state',len(state.encode())<=65536)
   with(D/'browser-state.private.json').open('x')as f:f.write(state)
   check('mandatory_root_disk_reserve',shutil.disk_usage('/').free>=FLOOR)
  finally:browser.close()
 record.update(status='PASS',native_password_and_delivered_email_flows=2,temporary_storage='PRIVATE_TMPFS')
def interrupted(*_):raise InterruptedError()
signal.signal(signal.SIGTERM,interrupted)
if OUT.exists():raise SystemExit('Existing evidence retained')
try:run()
except Exception as e:
 record['error_type']=type(e).__name__
 tb=e.__traceback__
 while tb:
  if tb.tb_frame.f_code.co_filename==__file__:record['error_line']=tb.tb_lineno
  tb=tb.tb_next
finally:
 with OUT.open('x')as f:json.dump(record,f,indent=2)
 print(json.dumps(record))
sys.exit(0 if record['status']=='PASS'else 1)
