"""Complete re-entry checks after verified actual rollback; no replayed migrations/keys."""
import os,sys,pathlib,json,datetime,subprocess,urllib.request,urllib.error,time,hashlib,importlib.util,fcntl,contextlib
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');B=pathlib.Path('/opt/alisa-platform/stage');R='alisa-3e91b1aa5d405d0e';ADMIN='https://alisa-admin-stage.octoport.ru';WEB='https://alisa-stage.octoport.ru'
spec=importlib.util.spec_from_file_location('s03_helpers',D/'smoke-r3.py');H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
OUT=E/'AL_S03_INSTALLED_REENTRY_20261105.json';rec={'scope':'ACTUAL_STAGE_S03_FRESH_MFA_REENTRY_AFTER_RECORDED_ROLLBACK','release':R,'status':'RUNNING','cases':[],'previous_attempt':'AL_S03_INSTALLED_ROLLBACK_20261105.json','started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def check(n,ok):
 rec['cases'].append({'case':n,'passed':bool(ok)});print(json.dumps(rec['cases'][-1]),flush=True)
 if not ok:raise RuntimeError(n)
def request(path,body,token):
 req=urllib.request.Request('http://127.0.0.1:18102/api/v1/staff/'+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
 try:response=urllib.request.urlopen(req,timeout=8)
 except urllib.error.HTTPError as e:response=e
 with response:return response.status
def run():
 assert not OUT.exists();pw=browser=None
 try:
  prior=json.loads((E/'AL_S03_INSTALLED_ROLLBACK_20261105.json').read_text());check('actual_old_code_and_same_s03_recorded',prior['prior_code_health']['platform']['release']=='alisa-6ae348354b3db0d3' and prior['same_s03_health']['admin']['release']==R and prior['waited_code_ttl_seconds']>60)
  data=json.loads((D/'synthetic-fixture.json').read_text());H.PRIVATE=data['private_values'];old_token=data['owner_session_token'];old_flow=data['rollback_pending_flow'];expected={n:dict(l.split('=',1) for l in (D/'after'/(n+'.env')).read_text().splitlines() if l and not l.startswith('#')) for n in ['platform','identity','admin']}
  check('same_s03_pointers_and_flags_enabled',all((B/n).resolve().name==R for n in ['site-current','identity-current','admin-current']) and all(H.cfg(n).get('ALISA_STAFF_ENABLED')=='1' for n in ['platform','identity','admin']))
  for _ in range(30):
   try:
    with urllib.request.urlopen(ADMIN+'/login',timeout=4) as response:ready=response.status==200
    if ready:break
   except OSError:ready=False
   time.sleep(.2)
  check('public_admin_ingress_ready_on_fresh_tls_connection',ready)
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});ctx=browser.new_context(storage_state=str(D/'synthetic-owner-browser-state.json'));page=ctx.new_page();page.set_default_timeout(15000)
  H.bff_login(page,H.totp(data['owner_secret']));check('fresh_native_mfa_login_after_real_rollback',True)
  current=next(c['value'] for c in ctx.cookies() if c['name']=='__Host-alisa_staff');row=H.sql('platform','SELECT mfa_type,revoked_at FROM staff_staffsession WHERE token_hash=%s',[hashlib.sha256(current.encode()).hexdigest()]);check('new_current_staff_session_has_actual_totp_evidence',len(row)==1 and row[0]==('totp',None))
  authority=H.cfg('platform')['ALISA_STAFF_SERVICE_TOKEN'];check('old_staff_token_remains_revoked',request('me',{'session_token':old_token},authority)==401);check('old_staff_flow_remains_consumed',request('auth/flows/consume',{'flow_ref':old_flow},authority)==400)
  check('same_customer_tenant_identity_profile_and_one_owner',H.sql('platform',"SELECT count(*) FROM staff_staffmember WHERE product_id='alisa_market' AND role='OWNER'")[0][0]==1 and H.sql('platform','SELECT display_name FROM accounts_customer WHERE id=%s',[data['owner_customer']])[0][0]=='S03 Test Owner' and str(H.sql('platform','SELECT tenant_id FROM accounts_membership WHERE customer_id=%s',[data['owner_customer']])[0][0])==data['owner_tenant'] and H.sql('identity','SELECT count(*) FROM accounts_subject WHERE id=%s AND person_id=%s',[data['owner_subject'],data['owner_person']])[0][0]==1)
  baseline=json.loads((D/'before/database-baseline.json').read_text());check('old_web_probe_clients_exact_after_reentry',json.loads(json.dumps(H.sql('identity',"SELECT row_to_json(c) FROM allauth_idp_oidc_client c WHERE id<>'alisa_admin_stage' ORDER BY id"),default=str))==baseline['identity']['clients']);check('same_new_keys_retained',all(H.cfg(n)==expected[n] for n in expected))
  check('web_shared_pointers_and_config_preserved',(B/'web-current').resolve().name=='alisa-e82003211bdcd687' and (B/'current').resolve().name=='alisa-77d0f8ee2643ef65' and pathlib.Path('/etc/alisa-platform/stage/web.env').read_bytes()==(D/'before/etc/alisa-platform/stage/web.env').read_bytes())
  page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('same_customer_browser_profile_after_reentry',page.locator('input[name=display_name]').input_value()=='S03 Test Owner')
  ctx.storage_state(path=str(D/'synthetic-owner-browser-state.json'));data['owner_session_token']=current;H.PRIVATE.append(current);data['private_values']=H.PRIVATE;(D/'synthetic-fixture.json').write_text(json.dumps(data));rec['status']='PASS'
 except Exception as ex:
  rec['status']='FAILED';rec['error_type']=type(ex).__name__;rec['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:rec['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  if browser:browser.close()
  if pw:pw.stop()
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec))
 return rec['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
