"""Native login of an existing own synthetic customer; no staff/grant mutation."""
import os,sys,pathlib,json,datetime,importlib.util,urllib.parse,time,re
from playwright.sync_api import sync_playwright,expect
sys.dont_write_bytecode=True;os.umask(0o077)
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s04-access-20261105');OLD=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');OUT=E/'AL_S04_CUSTOMER_READBACK_20261105.json';WEB='https://alisa.octoport.ru';IDP='https://id.octoport.ru';ADMIN='https://alisa-admin.octoport.ru'
spec=importlib.util.spec_from_file_location('own_helpers',OLD/'smoke-r3.py');H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
rec={'scope':'INSTALLED_CUSTOMER_READBACK_ONLY_NO_STAFF_GRANT_TEST','status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'manual_owner_grant_test':'NOT_RUN_AUTHORITY_HANDED_OVER'}
def check(n,ok):
 rec['cases'].append({'case':n,'passed':bool(ok)});OUT.write_text(json.dumps(rec,indent=2))
 if not ok:raise RuntimeError(n)
def run():
 assert not OUT.exists();pw=browser=None
 try:
  check('activation_passed',json.loads((E/'AL_S04_ACTIVATION_20261105.json').read_text())['status']=='PASS')
  f=json.loads((OLD/'synthetic-fixture.json').read_text());H.PRIVATE=f['private_values'];check('only_existing_own_invalid_contact',f['owner_email'].endswith('@example.invalid'))
  check('same_existing_synthetic_customer',H.sql('platform','SELECT count(*) FROM accounts_customer WHERE id=%s AND email=%s',[f['owner_customer'],f['owner_email']])[0][0]==1)
  observed=[]
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});ctx=browser.new_context();page=ctx.new_page();page.set_default_timeout(20000)
  def guard(request):
   if request.method!='POST' or urllib.parse.urlsplit(request.url).hostname!='id.octoport.ru':return
   q=urllib.parse.parse_qs(request.post_data or '');values=q.get('email',[])+q.get('login',[]);observed.append(all(v==f['owner_email'] for v in values) and '/signup/' not in urllib.parse.urlsplit(request.url).path)
  page.on('request',guard);page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click();page.wait_for_url(re.compile(re.escape(IDP)+r'/accounts/'))
  if page.get_by_role('button',name='Продолжить вход по коду').count():page.get_by_role('button',name='Продолжить вход по коду').click()
  field=page.locator('input[name=login],input[name=email]').first;expect(field).to_be_visible();field.fill(f['owner_email']);since=datetime.datetime.now(datetime.timezone.utc);page.locator('form').filter(has=field).locator('button[type=submit]').first.click();expect(page.locator('input[name=code]')).to_be_visible()
  for _ in range(450):
   rows=H.sql('identity','SELECT sent_at FROM accounts_identitymail WHERE recipient=%s AND created_at>=%s ORDER BY created_at DESC LIMIT 1',[f['owner_email'],since])
   if rows and rows[0][0] is not None:break
   time.sleep(.2)
  else:raise RuntimeError('own_sink_timer_timeout')
  page.locator('input[name=code]').fill(H.letter(f['owner_email']));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
  if urllib.parse.urlsplit(page.url).hostname=='id.octoport.ru':
   value=H.totp(f['owner_secret']);H.PRIVATE.append(value);expect(page.locator('input[name=code]')).to_be_visible();page.locator('input[name=code]').fill(value);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
  expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('canonical_customer_native_login',True)
  profile=page.request.get(WEB+'/api/account/me').json()['profile'];check('same_customer_tenant_after_canonical_login',profile['customer_id']==f['owner_customer'] and profile['tenant_id']==f['owner_tenant'])
  page.get_by_role('link',name='Посмотреть срок и историю доступа').click();expect(page.get_by_role('heading',name='Доступ к Алисе',exact=True)).to_be_visible();check('access_link_opens_actual_customer_page',True)
  response=page.request.get(WEB+'/api/account/access');data=response.json()['access'];check('actual_authenticated_access_api',response.status==200 and data['product_id']=='alisa_market')
  names={'NOT_PROVISIONED':'Доступ ещё не выдан','ACTIVE':'Доступ действует','SCHEDULED':'Доступ запланирован','EXPIRED':'Срок доступа истёк','REVOKED':'Доступ отозван'};expect(page.get_by_role('heading',name=names[data['status']],exact=True)).to_be_visible();check('page_matches_current_ledger_status',True)
  check('untrusted_customer_scope_rejected',page.request.get(WEB+'/api/account/access?tenant_id=other').status==422)
  check('customer_has_no_automatic_staff_authority',page.request.post(ADMIN+'/api/staff/access',data={'action':'batches'},headers={'Origin':ADMIN}).status==403)
  check('all_identity_posts_own_synthetic_no_signup',bool(observed) and all(observed));check('real_owner_not_replaced_by_test',H.sql('platform',"SELECT count(*) FROM staff_staffmember WHERE product_id='alisa_market' AND role='OWNER' AND active AND subject=%s",[f['owner_subject']])[0][0]==0)
  ctx.storage_state(path=str(D/'customer-browser-state.private.json'));rec['access_status']=data['status'];rec['history_count']=len(data['history']);rec['status']='PASS'
 except Exception as error:
  rec['status']='FAILED';rec['error_type']=type(error).__name__;rec['failed_case']=str(error) if isinstance(error,RuntimeError) else None
  tb=error.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:rec['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  if browser:browser.close()
  if pw:pw.stop()
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec))
 return rec['status']=='PASS'
if __name__=='__main__':sys.exit(0 if run() else 1)
