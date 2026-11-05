"""Approved S03 feature rollback/re-entry; 07290 web/API/IdP code and mail stay fixed."""
import os,sys,pathlib,json,datetime,time,hashlib,subprocess,urllib.request,urllib.error,re,importlib.util,contextlib,fcntl
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright,expect
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');M=D/'mixed-07290-20261105f001';E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');A='alisa-3e91b1aa5d405d0e';P='alisa-07290e7c17f556bf';F='alisa-e82003211bdcd687';RP=B/'releases'/P;V=pathlib.Path('/etc/nginx/sites-available/alisa-platform-stage.conf');C=pathlib.Path('/etc/alisa-platform/stage');ADMIN='https://alisa-admin-stage.octoport.ru';WEB='https://alisa-stage.octoport.ru';IDP='https://id-stage.octoport.ru'
spec=importlib.util.spec_from_file_location('current_helpers',D/'smoke-r3.py');H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
OUT=E/'AL_S03_CURRENT_07290_ROLLBACK_20261105.json';rec={'scope':'CURRENT_S03_STAFF_FEATURE_ROLLBACK_REENTRY_NOT_07290_MAIL_ROLLBACK','bindings':{'admin':A,'web':P,'platform':P,'identity':P},'status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def check(n,ok):
 rec['cases'].append({'case':n,'passed':bool(ok)});OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec['cases'][-1]),flush=True)
 if not ok:raise RuntimeError(n)
H.check=check
def cfg(n):return H.cfg(n)
def command(*args,env=None,inp=None):return subprocess.run(list(map(str,args)),env=env,input=inp,capture_output=True,check=True,timeout=50)
def current(admin=A):return (B/'current').resolve().name=='alisa-77d0f8ee2643ef65' and (B/'admin-current').resolve().name==admin and all((B/n).resolve().name==P for n in ['web-current','site-current','identity-current'])
def health(admin=A):
 result={}
 for n,port,target in [('web',18100,P),('platform',18102,P),('identity',18103,P),('admin',18101,admin)]:
  for _ in range(75):
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=2) as r:v=json.load(r)
    if v['release']==target and v['status']=='READY':result[n]=v;break
   except OSError:pass
   time.sleep(.2)
  else:raise RuntimeError('Health_'+n)
 return result
def request(url,body=None,headers=None):
 class Stop(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 try:r=urllib.request.build_opener(Stop()).open(urllib.request.Request(url,data=body,headers=headers or {}),timeout=8)
 except urllib.error.HTTPError as ex:r=ex
 with r:return r.status,r.read(),dict(r.headers)
def real_mail():return H.sql('identity',"SELECT id,attempts,sent_at,error_code,lease_until FROM accounts_identitymail WHERE lower(recipient) NOT LIKE %s ORDER BY id",['%@example.invalid'])
def mailhash(rows):return hashlib.sha256(json.dumps(rows,default=str).encode()).hexdigest()
def staff_flag(n,value,original):
 d=cfg(n);check(n+'_no_nonstaff_config_drift',{k:v for k,v in d.items() if k!='ALISA_STAFF_ENABLED'}=={k:v for k,v in original[n].items() if k!='ALISA_STAFF_ENABLED'});d['ALISA_STAFF_ENABLED']=value;p=C/(n+'.env');tmp=C/('.s03-current-'+n);assert not tmp.exists();tmp.write_text(''.join(k+'='+v+'\n' for k,v in d.items()));tmp.chmod(0o600);os.replace(tmp,p)
def restart():command('systemctl','restart','alisa-platform@stage','alisa-identity@stage','alisa-admin@stage')
def point_admin(target):
 assert target in [A,F];temp=B/'.s03-current-admin';assert not temp.exists();temp.symlink_to(B/'releases'/target);os.replace(temp,B/'admin-current');command('systemctl','restart','alisa-admin@stage')
def ingress(opened):
 expected=(M/('vhost-closed.conf' if opened else 'vhost-open.conf')).read_bytes();check('only_expected_own_vhost_changed',V.read_bytes()==expected);V.write_bytes((M/('vhost-open.conf' if opened else 'vhost-closed.conf')).read_bytes());command('nginx','-t');command('systemctl','reload','nginx')
def public_ready(admin):
 for _ in range(50):
  try:
   with urllib.request.urlopen(ADMIN+'/health/ready',timeout=3) as response:v=json.load(response)
   if v.get('release')==admin and v.get('status')=='READY':return True
  except OSError:pass
  time.sleep(.2)
 return False
def psql(component,name,sha):
 p=D/name;check(name+'_exact_hash',hashlib.sha256(p.read_bytes()).hexdigest()==sha);d=cfg(component);env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8',**{x:d[y] for x,y in [('PGHOST','ALISA_DB_HOST'),('PGPORT','ALISA_DB_PORT'),('PGDATABASE','ALISA_DB_NAME'),('PGUSER','ALISA_DB_USER'),('PGPASSWORD','ALISA_DB_PASSWORD')]}};out=command('/usr/lib/postgresql/16/bin/psql','--no-password','--set','ON_ERROR_STOP=1','--file',p,env=env);(M/(name+'.receipt.txt')).write_bytes(out.stdout)
def run():
 assert not OUT.exists();pw=browser=None
 try:
  check('current_mixed_smoke_passed',json.loads((E/'AL_S03_CURRENT_07290_SMOKE_20261105.json').read_text())['status']=='PASS');check('bound_current_tuple_before_mutation',current())
  data=json.loads((M/'fixture.json').read_text());H.PRIVATE=data['private_values'];old_token=data['owner_session_token'];original={n:dict(l.split('=',1) for l in (M/(n+'.env')).read_text().splitlines() if l and not l.startswith('#')) for n in ['web','platform','identity','admin']};check('all_current_config_snapshots_exact',all((C/(n+'.env')).read_bytes()==(M/(n+'.env')).read_bytes() for n in original))
  original_real=real_mail();rec['real_mail_before']={'rows':len(original_real),'fingerprint':mailhash(original_real)}
  client=H.sql('identity',"SELECT id,type,secret,redirect_uris FROM allauth_idp_oidc_client WHERE id='alisa_admin_stage'")[0];subs=H.sql('identity',"SELECT id,person_id FROM accounts_subject WHERE client_id='alisa_admin_stage' ORDER BY id");snap={'id':client[0],'type':client[1],'secret':client[2],'redirect':client[3],'subjects':[[str(x) for x in row] for row in subs]};(M/'client-preserved.json').write_text(json.dumps(snap))
  with urllib.request.urlopen(IDP+'/.well-known/openid-configuration',timeout=5) as response:meta=json.load(response)
  check('fresh_native_bearer_valid_before_suspend',request(meta['userinfo_endpoint'],headers={'Authorization':'Bearer '+data['mixed_native_access']})[0]==200)
  text=(M/'vhost-open.conf').read_text();blocks=list(re.finditer(r'server \{.*?(?=\nserver \{|\Z)',text,re.S));block=next(x for x in blocks if 'server_name alisa-admin-stage.octoport.ru;' in x.group());closed=block.group().replace('server_name alisa-admin-stage.octoport.ru;','server_name alisa-admin-stage.octoport.ru;\n return 503;');(M/'vhost-closed.conf').write_text(text[:block.start()]+closed+text[block.end():])
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});ctx=browser.new_context(storage_state=str(M/'owner-browser-state.json'));pending=browser.new_context();response=pending.request.post(ADMIN+'/auth/start',form={'return_to':'/admin'},headers={'Origin':ADMIN},max_redirects=0);check('actual_pending_flow_current_combo',response.status==303);old_flow=next(c['value'] for c in pending.cookies() if c['name']=='__Host-alisa_staff_login');data['current_pending_flow']=old_flow;(M/'fixture.json').write_text(json.dumps(data));webcookies='; '.join(c['name']+'='+c['value'] for c in ctx.cookies() if c['domain']=='alisa-stage.octoport.ru');browser.close();browser=None
  ingress(False)
  for n in ['admin','platform','identity']:staff_flag(n,'0',original)
  restart();rec['disabled_health']=health();check('staff_off_tuple_and_flags',current() and all(cfg(n)['ALISA_STAFF_ENABLED']=='0' for n in ['platform','identity','admin']))
  authorize,_,_,_=H.direct_authorize(meta);check('native_admin_authorize_closed',request(authorize)[0]==403);headers={'Content-Type':'application/json','Authorization':'Bearer '+original['platform']['ALISA_STAFF_SERVICE_TOKEN']};check('staff_api_closed',request('http://127.0.0.1:18102/api/v1/staff/me',b'{}',headers)[0]==404)
  psql('platform','platform-close.sql','d084c24e10df3448431fb55bf9c40a018fe7b91ae2e6374375439b7ecb5efe96');check('owned_staff_sessions_and_flows_zero_payloads',H.sql('platform',"SELECT count(*) FROM staff_staffsession WHERE product_id='alisa_market' AND (revoked_at IS NULL OR encrypted_payload<>'')")[0][0]==0 and H.sql('platform',"SELECT count(*) FROM staff_staffauthflow WHERE product_id='alisa_market' AND (consumed_at IS NULL OR encrypted_payload<>'')")[0][0]==0)
  psql('identity','identity-suspend.sql','cc059d09e8deecef1652844b8aa4523d473340e6d870380fb7ac97a96e7c1558');command('systemctl','restart','alisa-identity@stage');health();psql('identity','identity-suspend.sql','cc059d09e8deecef1652844b8aa4523d473340e6d870380fb7ac97a96e7c1558')
  check('admin_grants_empty_tokens_zero_flags_off',H.sql('identity',"SELECT grant_types,response_types FROM allauth_idp_oidc_client WHERE id='alisa_admin_stage'")[0]==('','') and H.sql('identity',"SELECT count(*) FROM allauth_idp_oidc_token WHERE client_id='alisa_admin_stage'")[0][0]==0 and all(cfg(n)['ALISA_STAFF_ENABLED']=='0' for n in ['platform','identity','admin']));check('old_native_bearer_revoked',request(meta['userinfo_endpoint'],headers={'Authorization':'Bearer '+data['mixed_native_access']})[0]==401);check('native_authorize_still_closed_after_drain',request(authorize)[0]==403)
  env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',**cfg('identity')};ttl=int(command(RP/'.venv/bin/python',RP/'services/identity/manage.py','shell','--command','from allauth.idp.oidc import app_settings;print(app_settings.AUTHORIZATION_CODE_EXPIRES_IN)',env=env).stdout.decode().strip().splitlines()[-1]);check('actual_07290_native_code_ttl_60',ttl==60);drained=time.monotonic();status,body,_=request(WEB+'/api/account/me',headers={'Cookie':webcookies});check('current_customer_session_works_staff_off',status==200 and data['owner_customer'].encode() in body and data['owner_tenant'].encode() in body)
  while time.monotonic()-drained<=ttl+1:time.sleep(.5)
  rec['waited_code_ttl_seconds']=round(time.monotonic()-drained,3);check('native_code_ttl_elapsed',time.monotonic()-drained>ttl)
  check('tuple_still_current_before_fallback',current());point_admin(F);rec['feature_fallback_health']=health(F);ingress(True);check('closed_shell_public_ready',public_ready(F));check('only_admin_pointer_changed_for_fallback',current(F));check('fallback_admin_has_no_staff_start_route',request(ADMIN+'/auth/start',b'return_to=%2Fadmin',{'Origin':ADMIN,'Content-Type':'application/x-www-form-urlencoded'})[0]==404)
  status,body,_=request(WEB+'/api/account/me',headers={'Cookie':webcookies});check('07290_customer_profile_works_during_admin_fallback',status==200 and data['owner_customer'].encode() in body and b'S03 Test Owner' in body);check('no_real_mail_enqueued_or_submitted_before_restore',real_mail()==original_real)
  ingress(False);point_admin(A);health();check('same_admin_code_reentered_closed',current() and cfg('admin')['ALISA_STAFF_ENABLED']=='0')
  restore="import json,sys;from django.db import transaction;from allauth.idp.oidc.models import Client,Token;from octoport_identity.accounts.models import Subject;v=json.load(sys.stdin)\nwith transaction.atomic():\n c=Client.objects.select_for_update().get(pk=v['id']);assert c.id=='alisa_admin_stage' and c.type==v['type'] and c.secret==v['secret'] and c.redirect_uris==v['redirect'] and c.grant_types==c.response_types=='' and not Token.objects.filter(client=c).exists();assert [[str(x) for x in r] for r in Subject.objects.filter(client=c).order_by('id').values_list('id','person_id')]==v['subjects'];c.grant_types='authorization_code';c.response_types='code';c.save(update_fields=['grant_types','response_types'])\nprint('ADMIN_CAPABILITIES_RESTORED')"
  check('staff_flags_and_mail_guard_before_native_restore',all(cfg(n)['ALISA_STAFF_ENABLED']=='0' for n in ['platform','identity','admin']) and real_mail()==original_real);out=command(RP/'.venv/bin/python',RP/'services/identity/manage.py','shell','--command',restore,env=env,inp=json.dumps(snap).encode());check('only_preserved_native_admin_capabilities_restored',b'ADMIN_CAPABILITIES_RESTORED' in out.stdout)
  for n in ['identity','platform']:staff_flag(n,'1',original)
  command('systemctl','restart','alisa-identity@stage','alisa-platform@stage');staff_flag('admin','1',original);command('systemctl','restart','alisa-admin@stage');rec['reenabled_health']=health();ingress(True);check('public_same_admin_fresh_tls_ready',public_ready(A))
  browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});ctx=browser.new_context(storage_state=str(M/'owner-browser-state.json'));page=ctx.new_page();page.set_default_timeout(15000);H.bff_login(page,H.totp(data['owner_secret']));check('current_mixed_fresh_totp_after_feature_rollback',True);token=next(c['value'] for c in ctx.cookies() if c['name']=='__Host-alisa_staff');H.PRIVATE.append(token);check('current_session_has_actual_totp',H.sql('platform','SELECT mfa_type,revoked_at FROM staff_staffsession WHERE token_hash=%s',[hashlib.sha256(token.encode()).hexdigest()])[0]==('totp',None));check('prior_staff_token_stays_revoked',request('http://127.0.0.1:18102/api/v1/staff/me',json.dumps({'session_token':old_token}).encode(),headers)[0]==401);check('prior_pending_flow_stays_consumed',request('http://127.0.0.1:18102/api/v1/staff/auth/flows/consume',json.dumps({'flow_ref':old_flow}).encode(),headers)[0]==400)
  check('same_owner_subject_customer_tenant_profile',H.sql('platform',"SELECT count(*) FROM staff_staffmember WHERE product_id='alisa_market' AND role='OWNER' AND active")[0][0]==1 and H.sql('platform','SELECT display_name FROM accounts_customer WHERE id=%s',[data['owner_customer']])[0][0]=='S03 Test Owner' and str(H.sql('platform','SELECT tenant_id FROM accounts_membership WHERE customer_id=%s',[data['owner_customer']])[0][0])==data['owner_tenant'] and H.sql('identity','SELECT count(*) FROM accounts_subject WHERE id=%s AND person_id=%s',[data['owner_subject'],data['owner_person']])[0][0]==1)
  # Restore exact captured bytes after verifying no nonstaff setting changed.
  for n in ['platform','identity','admin']:
   check(n+'_current_full_settings_preserved',cfg(n)==original[n]);p=C/(n+'.env');p.write_bytes((M/(n+'.env')).read_bytes());p.chmod(0o600)
  check('all_current_config_bytes_web_and_dropin_preserved',all((C/(n+'.env')).read_bytes()==(M/(n+'.env')).read_bytes() for n in original) and pathlib.Path('/etc/systemd/system/alisa-admin@stage.service.d/s03-release.conf').read_bytes()==(M/'admin-dropin.conf').read_bytes());check('final_current_tuple_and_real_mail_unchanged',current() and real_mail()==original_real)
  ctx.storage_state(path=str(M/'owner-browser-after.json'));data['owner_session_token']=token;data['private_values']=H.PRIVATE;(M/'fixture-after.json').write_text(json.dumps(data));rec['real_mail_after']={'rows':len(real_mail()),'fingerprint':mailhash(real_mail())};rec['status']='PASS'
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
  for name in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+name,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
