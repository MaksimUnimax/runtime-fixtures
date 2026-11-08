"""Normal public registration/navigation using one new owned example.invalid mailbox."""
import json,os,pathlib,re,secrets,shutil,sys,time,uuid
from email import policy
from email.parser import BytesParser
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
sys.dont_write_bytecode=True;os.umask(0o077)
P=pathlib.Path;D=P('/var/lib/alisa-platform/stage/rollout-backups/auth-navigation-20261108');WEB='https://alisa.octoport.ru';IDP='https://id.octoport.ru'
PHASE=sys.argv[1] if len(sys.argv)==2 else ''
if PHASE not in {'before','after'}:raise SystemExit('Expected before or after')
OUT=D/(PHASE+('-browser-r2.json' if PHASE=='before' else '-browser.json'));record={'scope':'INSTALLED_PUBLIC_BROWSER_OWN_EXAMPLE_INVALID_REGISTRATION_AND_SESSION_NAVIGATION','phase':PHASE,'status':'FAILED','cases':[],'navigation':[],'provider_calls':0}
def check(name,ok):
 record['cases'].append({'case':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def mailbox_code(email,after):
 deadline=time.monotonic()+75
 while time.monotonic()<deadline:
  for f in P('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml'):
   if f.stat().st_mtime<after:continue
   raw=f.read_bytes();msg=BytesParser(policy=policy.default).parsebytes(raw)
   if email not in str(msg.get('To','')):continue
   text=msg.get_body(preferencelist=('plain',)).get_content() if msg.is_multipart() else msg.get_content()
   match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',text)
   if match:return match.group(1)
  time.sleep(.5)
 raise RuntimeError('own_mailbox_delivery_deadline')
def run():
 check('disk_and_memory_reserve',shutil.disk_usage(D).free>=3072*1048576+80*1048576 and next(int(l.split()[1]) for l in P('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))>=2560*1024)
 private=D/'fixture.private.json'
 if PHASE=='before':
  check('available_private_sink',len(list(P('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml')))<195)
  if private.exists():
   previous=json.loads((D/'before-browser.json').read_text());check('retry_only_unsubmitted_own_fixture',previous['status']=='FAILED' and previous['navigation']==[])
   f=json.loads(private.read_text())
  else:
   f={'email':'auth-ux-'+uuid.uuid4().hex[:12]+'@example.invalid','password':secrets.token_urlsafe(24)}
   with private.open('x') as out:json.dump(f,out)
 else:f=json.loads(private.read_text())
 check('own_reserved_contact',f['email'].startswith('auth-ux-') and f['email'].endswith('@example.invalid'))
 with sync_playwright() as p:
  browser=p.chromium.launch(headless=True);ctx=browser.new_context(ignore_https_errors=False);page=ctx.new_page();page.set_default_timeout(15000)
  if PHASE=='after':ctx.add_cookies(json.loads((D/'browser-state.private.json').read_text())['cookies'])
  page.on('framenavigated',lambda frame:record['navigation'].append(urlsplit(frame.url).netloc+urlsplit(frame.url).path) if frame==page.main_frame and urlsplit(frame.url).netloc in {'alisa.octoport.ru','id.octoport.ru'} else None)
  if PHASE=='before':
   page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет',exact=True).click()
   page.locator('a[href*="/accounts/signup/"]').first.click()
   page.locator('input[name=email]').fill(f['email']);page.locator('input[name=password1]').fill(f['password']);page.locator('input[name=password2]').fill(f['password']);page.locator('input[name=privacy]').check();page.locator('input[name=service]').check()
   sent=time.time();page.locator('form').filter(has=page.locator('input[name=email]')).locator('button[type=submit]').first.click()
   expect(page.locator('input[name=code]')).to_be_visible()
   code=mailbox_code(f['email'],sent);page.locator('input[name=code]').fill(code);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click();del code
   expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('native_registration_password_and_delivered_email_reaches_cabinet',True)
  else:page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
  profile=page.request.get(WEB+'/api/account/me');check('own_cabinet_session_valid',profile.status==200 and profile.json()['profile']['email']==f['email'])
  header_login=page.locator('header').get_by_role('link',name='Войти',exact=True).count()
  page.goto(WEB+'/login');login_form=page.locator('form[action="/auth/start"]').count()
  record['observed']={'valid_session_header_shows_login':bool(header_login),'valid_session_login_page_shows_new_auth_form':bool(login_form),'login_destination':urlsplit(page.url).path}
  if PHASE=='after':
   check('verified_session_header_routes_to_cabinet',not header_login)
   check('verified_session_login_route_reuses_cabinet',not login_form and urlsplit(page.url).path=='/app')
  ctx.storage_state(path=str(D/'browser-state.private.json'));browser.close()
 record['status']='PASS'
if OUT.exists():raise SystemExit('Existing receipt retained')
try:run()
except Exception as e:
 record['error_type']=type(e).__name__
 trace=e.__traceback__
 while trace:
  if trace.tb_frame.f_code.co_filename==__file__:record['error_line']=trace.tb_lineno
  trace=trace.tb_next
 if isinstance(e,RuntimeError):record['failed_case']=str(e)
finally:
 with OUT.open('x') as f:json.dump(record,f,indent=2)
 OUT.chmod(0o600);print(json.dumps(record))
sys.exit(0 if record['status']=='PASS' else 1)
