"""Finite approved current S03 boundary: 3e91 admin + dd2 web/API/IdP, synthetic only."""
import os,sys,pathlib,json,datetime,hashlib,shutil,time,re,subprocess,importlib.util,contextlib,fcntl,urllib.request
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright,expect
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');M=D/'mixed-20261105e001';E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');ADMIN='https://alisa-admin-stage.octoport.ru';WEB='https://alisa-stage.octoport.ru';IDP='https://id-stage.octoport.ru';A='alisa-3e91b1aa5d405d0e';P='alisa-dd2b59b99b00b7e4'
spec=importlib.util.spec_from_file_location('mixed_helpers',D/'smoke-r3.py');H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
OUT=E/'AL_S03_CURRENT_MIXED_SMOKE_20261105.json';rec={'scope':'CURRENT_S03_STAFF_BOUNDARY_ONLY','bindings':{'admin':A,'web':P,'platform':P,'identity':P},'status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def check(n,ok):
 rec['cases'].append({'case':n,'passed':bool(ok)});OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec['cases'][-1]),flush=True)
 if not ok:raise RuntimeError(n)
H.check=check
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  while b:=f.read(1048576):h.update(b)
 return h.hexdigest()
def real_mail():return H.sql('identity',"SELECT id,attempts,sent_at,error_code,lease_until FROM accounts_identitymail WHERE lower(recipient) NOT LIKE %s ORDER BY id",['%@example.invalid'])
def mailhash(rows):return hashlib.sha256(json.dumps(rows,default=str).encode()).hexdigest()
def wait_sink(email,since):
 assert email.endswith('@example.invalid')
 for _ in range(450):
  row=H.sql('identity','SELECT sent_at FROM accounts_identitymail WHERE recipient=%s AND created_at>=%s ORDER BY created_at DESC LIMIT 1',[email,since])
  if row and row[0][0] is not None:return H.letter(email)
  time.sleep(.2)
 raise RuntimeError('Synthetic_sink_timer_delivery_timeout')
def fresh_customer(page,email,secret):
 assert email.endswith('@example.invalid');page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click();page.wait_for_url(re.compile(re.escape(IDP)+r'/accounts/'))
 if page.get_by_role('button',name='Продолжить вход по коду').count():page.get_by_role('button',name='Продолжить вход по коду').click()
 field=page.locator('input[name=login],input[name=email]').first;expect(field).to_be_visible();field.fill(email);since=datetime.datetime.now(datetime.timezone.utc);page.locator('form').filter(has=field).locator('button[type=submit]').first.click();expect(page.locator('input[name=code]')).to_be_visible();page.locator('input[name=code]').fill(wait_sink(email,since));page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
 if urlsplit(page.url).netloc=='id-stage.octoport.ru':
  expect(page.locator('input[name=code]')).to_be_visible();value=H.totp(secret);H.PRIVATE.append(value);page.locator('input[name=code]').fill(value);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
 expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=20000)
def run():
 assert not OUT.exists() and not M.exists();M.mkdir(mode=0o700);pw=browser=None;data=json.loads((D/'synthetic-fixture.json').read_text());H.PRIVATE=data['private_values'];post_guard=[]
 try:
  check('reserve_plus_growth_and_memory',shutil.disk_usage(B).free//1048576>=3172 and os.statvfs(B).f_favail>=200000 and next(int(l.split()[1])//1024 for l in pathlib.Path('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))>=2560)
  expected={'current':'alisa-77d0f8ee2643ef65','web-current':P,'site-current':P,'identity-current':P,'admin-current':A};check('exact_current_pointer_tuple',all((B/n).resolve().name==v for n,v in expected.items()))
  for name,source,count in [(A,'3e91b1aa5d405d0e8160c4dbe3dcad56eb606dae',4406),(P,'dd2b59b99b00b7e4c751f6f32034886245363d49',4408)]:
   root=B/'releases'/name;m=json.loads((root/'manifest.json').read_text());actual=set()
   for p in root.rglob('*'):
    rel=p.relative_to(root)
    if rel.parts[0]=='.venv':continue
    if p.is_file() and not p.is_symlink() and p!=root/'manifest.json':actual.add(str(rel))
   check(name+'_exact_manifest_files',m['source_sha']==source and len(m['files'])==count and actual==set(m['files']) and all(digest(root/n)==h for n,h in m['files'].items()) and all((root/n).is_symlink() and os.readlink(root/n)==v for n,v in m['links'].items()))
  package=E/'real-mail-package-dd2b59b9';check('dd2_ci_zip_and_tar_binding',digest(package/'package.zip')=='efb7aa9b0197399f52e39d30f4bc65fd84807073d554ad726ee48e6615587793' and digest(package/(P+'.tar.gz'))=='e19761ed8943c1d17f641ad07dcd474f62c7e9fbdf500f0c4c3905ee24f3f849')
  check('only_own_existing_synthetic_fixtures',all(data[k].endswith('@example.invalid') for k in ['owner_email','reader_email']) and H.sql('platform',"SELECT count(*) FROM staff_staffmember WHERE product_id='alisa_market'")[0][0]==2)
  members=H.sql('platform',"SELECT subject FROM staff_staffmember WHERE product_id='alisa_market'");check('staff_members_exact_own_subjects',{r[0] for r in members}=={data['owner_subject'],data['reader_subject']})
  for n in ['web','platform','identity','admin']:
   p=pathlib.Path('/etc/alisa-platform/stage')/(n+'.env');(M/(n+'.env')).write_bytes(p.read_bytes())
  v=pathlib.Path('/etc/nginx/sites-available/alisa-platform-stage.conf');(M/'vhost-open.conf').write_bytes(v.read_bytes());drop=pathlib.Path('/etc/systemd/system/alisa-admin@stage.service.d/s03-release.conf');(M/'admin-dropin.conf').write_bytes(drop.read_bytes());(M/'pointers.json').write_text(json.dumps(expected))
  baseline_real=real_mail();rec['real_mail_before']={'rows':len(baseline_real),'fingerprint':mailhash(baseline_real)};(M/'real-mail-before-private.json').write_text(json.dumps(baseline_real,default=str))
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});ctx=browser.new_context();page=ctx.new_page();page.set_default_timeout(15000)
  def inspect_request(request):
   if request.method!='POST' or urlsplit(request.url).hostname!='id-stage.octoport.ru':return
   values=parse_qs(request.post_data or '');contacts=values.get('login',[])+values.get('email',[]);post_guard.append(all(x in {data['owner_email'],data['reader_email']} and x.endswith('@example.invalid') for x in contacts) and '/signup/' not in urlsplit(request.url).path)
  page.on('request',inspect_request);fresh_customer(page,data['owner_email'],data['owner_secret']);check('fresh_customer_current_dd2_via_synthetic_sink',page.locator('input[name=display_name]').input_value()=='S03 Test Owner');used=H.totp(data['owner_secret'])
  with urllib.request.urlopen(IDP+'/.well-known/openid-configuration',timeout=5) as response:meta=json.load(response)
  sub,person=H.verified_admin_subject(page,meta,data['owner_email'],data['owner_codes'][6]);check('current_signed_subject_same_owner',sub==data['owner_subject'] and person==data['owner_person']);data['mixed_native_access']=H.PRIVATE[-1]
  H.bff_login(page,H.fresh_totp(data['owner_secret'],used));check('current_mixed_fresh_totp_bff_api_pg',True);cookie=next(c for c in ctx.cookies() if c['name']=='__Host-alisa_staff');H.PRIVATE.append(cookie['value']);check('current_staff_session_actual_totp',H.sql('platform','SELECT mfa_type,revoked_at FROM staff_staffsession WHERE token_hash=%s',[hashlib.sha256(cookie['value'].encode()).hexdigest()])[0]==('totp',None));check('dedicated_staff_cookie',cookie['domain']=='alisa-admin-stage.octoport.ru' and cookie['secure'] and cookie['httpOnly'])
  expect(page.get_by_role('button',name='S03 Test Owner',exact=True)).to_be_visible();check('current_real_customer_list',True)
  page.get_by_role('button',name='Сотрудники',exact=True).click();page.locator('input[name=subject]').fill(data['reader_subject']);page.locator('input[name=name]').fill('S03 Test Reader');page.get_by_label('Просмотр клиентов',exact=True).check();page.get_by_role('button',name='Назначить',exact=True).click();expect(page.get_by_role('status')).to_contain_text('Изменение сохранено');check('own_reader_limited_role_current_api',True)
  reader=browser.new_context(storage_state=str(D/'synthetic-reader-browser-state.json'));rp=reader.new_page();rp.set_default_timeout(15000);rp.on('request',inspect_request);H.bff_login(rp,H.totp(data['reader_secret']));check('limited_reader_current_native_totp_login',True)
  revision=H.sql('platform','SELECT security_revision FROM accounts_customer WHERE id=%s',[data['owner_customer']])[0][0];denied={'command_id':str(__import__('uuid').uuid4()),'action':'customer.block','payload':{'customer_id':data['owner_customer'],'revision':revision},'reason':'SECURITY_REVIEW'};check('current_limited_backend_write_denied',rp.request.post(ADMIN+'/api/staff/command',data=denied,headers={'Origin':ADMIN}).status==403)
  second=browser.new_context();second.add_cookies([c for c in reader.cookies() if c['domain']=='id-stage.octoport.ru']);sp=second.new_page();sp.on('request',inspect_request);H.bff_login(sp,data['reader_codes'][4]);check('two_independent_current_staff_sessions',True)
  page.get_by_role('button',name='Сотрудники',exact=True).click();page.locator('li').filter(has_text='S03 Test Reader').get_by_role('button',name='Отозвать сотрудника').click();expect(page.get_by_role('status')).to_contain_text('Изменение сохранено')
  for item in [rp,sp]:item.goto(ADMIN+'/admin');expect(item).to_have_url(ADMIN+'/login')
  check('current_staff_revocation_both_contexts',True);check('real_mail_not_enqueued_or_submitted',real_mail()==baseline_real);check('all_identity_contacts_synthetic_no_signup',bool(post_guard) and all(post_guard))
  ctx.storage_state(path=str(M/'owner-browser-state.json'));reader.storage_state(path=str(M/'reader-browser-state.json'));data['owner_session_token']=cookie['value'];data['private_values']=H.PRIVATE;(M/'fixture.json').write_text(json.dumps(data));rec['real_mail_after']={'rows':len(real_mail()),'fingerprint':mailhash(real_mail())};rec['status']='PASS'
 except Exception as ex:
  rec['status']='FAILED';rec['error_type']=type(ex).__name__;rec['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:rec['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  data['private_values']=H.PRIVATE;(M/'fixture-progress.json').write_text(json.dumps(data))
  if browser:browser.close()
  if pw:pw.stop()
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec))
 return rec['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
