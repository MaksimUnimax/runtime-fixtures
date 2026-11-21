"""Finite approved actual S03 -> prior compatible code -> same S03 rehearsal."""
import os,sys,pathlib,json,datetime,subprocess,time,hashlib,urllib.request,urllib.error,uuid,base64,fcntl,contextlib,importlib.util
from urllib.parse import urlsplit,parse_qs,urlencode
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');B=pathlib.Path('/opt/alisa-platform/stage');R='alisa-3e91b1aa5d405d0e';REL=B/'releases'/R;C=pathlib.Path('/etc/alisa-platform/stage');V=pathlib.Path('/etc/nginx/sites-available/alisa-platform-stage.conf');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');WEB='https://alisa-stage.octoport.ru';IDP='https://id-stage.octoport.ru';ADMIN='https://alisa-admin-stage.octoport.ru'
spec=importlib.util.spec_from_file_location('installed_smoke_helpers',D/'smoke-r3.py');H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
rec={'scope':'ACTUAL_AUTHORIZED_STAGE_S03_PRIOR_CODE_SAME_S03_ROLLBACK','release':R,'artifact_sha256':'b9eb8f011482d3921c9bb32f98c2c4751aaf3bacf7fdcb101d2fc9ba9f6a8b21','status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()};OUT=E/'AL_S03_INSTALLED_ROLLBACK_20261105.json'
def check(n,ok):
 rec['cases'].append({'case':n,'passed':bool(ok)});OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec['cases'][-1]),flush=True)
 if not ok:raise RuntimeError(n)
def cfg(n):return H.cfg(n)
def cmd(*args,env=None,inp=None):return subprocess.run(list(map(str,args)),env=env,input=inp,capture_output=True,check=True,timeout=50)
def envwrite(n,d):
 p=C/(n+'.env');tmp=C/('.s03-return-'+n);assert not tmp.exists();tmp.write_text(''.join(k+'='+v+'\n' for k,v in d.items()));tmp.chmod(0o600);os.replace(tmp,p)
def point(n,target):
 temp=B/('.s03-return-'+n);assert not temp.exists();temp.symlink_to(B/'releases'/target);os.replace(temp,B/n)
def restart():cmd('systemctl','daemon-reload');cmd('systemctl','restart','alisa-platform@stage','alisa-identity@stage','alisa-admin@stage')
def ingress(opened):V.write_text((D/('admin-vhost-open.conf' if opened else 'admin-vhost-closed.conf')).read_text());cmd('nginx','-t');cmd('systemctl','reload','nginx')
def health(versions):
 result={}
 for n,port in [('web',18100),('platform',18102),('identity',18103),('admin',18101)]:
  for _ in range(75):
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=2) as response:value=json.load(response)
    if value['release']==versions[n] and value['status']=='READY':result[n]=value;break
   except OSError:pass
   time.sleep(.2)
  else:raise RuntimeError('Health_'+n)
 return result
def request(url,data=None,headers=None,no_redirect=False):
 class Stop(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args,**kwargs):return None
 opener=urllib.request.build_opener(Stop()) if no_redirect else urllib.request.build_opener()
 try:response=opener.open(urllib.request.Request(url,data=data,headers=headers or {}),timeout=8)
 except urllib.error.HTTPError as e:response=e
 with response:return response.status,response.read(),dict(response.headers)
def psql(component,name,expected):
 p=D/name;check(name+'_exact_hash',hashlib.sha256(p.read_bytes()).hexdigest()==expected);d=cfg(component);env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8',**{a:d[b] for a,b in [('PGHOST','ALISA_DB_HOST'),('PGPORT','ALISA_DB_PORT'),('PGDATABASE','ALISA_DB_NAME'),('PGUSER','ALISA_DB_USER'),('PGPASSWORD','ALISA_DB_PASSWORD')]}};out=cmd('/usr/lib/postgresql/16/bin/psql','--no-password','--set','ON_ERROR_STOP=1','--file',p,env=env);(D/(name+'.receipt.txt')).write_bytes(out.stdout)
def run():
 assert not OUT.exists();pw=browser=None;data=json.loads((D/'synthetic-fixture.json').read_text());H.PRIVATE=data['private_values'];before=D/'before';after=D/'after';old_token=data['owner_session_token'];newcfg={n:cfg(n) for n in ['platform','identity','admin']}
 try:
  check('installed_smoke_previously_passed',json.loads((E/'AL_S03_INSTALLED_SMOKE_R4_20261105.json').read_text())['status']=='PASS')
  for p in [D,E]:check(p.name+'_private_root_directory',not p.is_symlink() and p.stat().st_uid==0 and p.stat().st_mode&0o777==0o700)
  check('approved_web_current_and_shared_preserved',(B/'web-current').resolve().name=='alisa-e82003211bdcd687' and (B/'current').resolve().name=='alisa-77d0f8ee2643ef65')
  client=H.sql('identity',"SELECT id,type,secret,redirect_uris FROM allauth_idp_oidc_client WHERE id='alisa_admin_stage'")[0];subjects=H.sql('identity',"SELECT id,person_id FROM accounts_subject WHERE client_id='alisa_admin_stage' ORDER BY id");snap={'id':client[0],'type':client[1],'secret':client[2],'redirect':client[3],'subjects':[[str(v) for v in row] for row in subjects]};(D/'admin-client-preserved.json').write_text(json.dumps(snap))
  baseline=json.loads((before/'database-baseline.json').read_text());old_clients=H.sql('identity',"SELECT row_to_json(c) FROM allauth_idp_oidc_client c WHERE id<>'alisa_admin_stage' ORDER BY id");check('preexisting_clients_still_exact',json.loads(json.dumps(old_clients,default=str))==baseline['identity']['clients'])
  with urllib.request.urlopen(IDP+'/.well-known/openid-configuration') as response:meta=json.load(response)
  native_access=next(data['private_values'][i+1] for i,v in enumerate(data['private_values'][:-1]) if v.startswith('eyJ') and v.count('.')==2);check('native_staff_bearer_valid_before_suspend',request(meta['userinfo_endpoint'],headers={'Authorization':'Bearer '+native_access})[0]==200)
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});ctx=browser.new_context(storage_state=str(D/'synthetic-owner-browser-state.json'));page=ctx.new_page();page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('web_profile_before_return',page.locator('input[name=display_name]').input_value()=='S03 Test Owner')
  pending=browser.new_context();response=pending.request.post(ADMIN+'/auth/start',form={'return_to':'/admin'},headers={'Origin':ADMIN},max_redirects=0);check('real_pending_admin_flow_created',response.status==303);old_flow=next(c['value'] for c in pending.cookies() if c['name']=='__Host-alisa_staff_login');data['rollback_pending_flow']=old_flow;pending.close();(D/'synthetic-fixture.json').write_text(json.dumps(data))
  ingress(False)
  for n in ['platform','identity','admin']:d=cfg(n);d['ALISA_STAFF_ENABLED']='0';envwrite(n,d)
  restart();health({'web':'alisa-e82003211bdcd687','platform':R,'identity':R,'admin':R});check('flags_off_and_s03_processes_drained',True)
  auth_url,_,_,_=H.direct_authorize(meta);check('closed_native_admin_authorize_denied',request(auth_url,no_redirect=True)[0]==403)
  staff_service=newcfg['platform']['ALISA_STAFF_SERVICE_TOKEN'];headers={'Content-Type':'application/json','Authorization':'Bearer '+staff_service};check('closed_backend_staff_endpoint_denied',request('http://127.0.0.1:18102/api/v1/staff/me',b'{}',headers)[0]==404)
  psql('platform','platform-close.sql','d084c24e10df3448431fb55bf9c40a018fe7b91ae2e6374375439b7ecb5efe96');check('all_own_staff_payloads_and_active_sessions_closed',H.sql('platform',"SELECT count(*) FROM staff_staffsession WHERE product_id='alisa_market' AND (revoked_at IS NULL OR encrypted_payload<>'')")[0][0]==0 and H.sql('platform',"SELECT count(*) FROM staff_staffauthflow WHERE product_id='alisa_market' AND (consumed_at IS NULL OR encrypted_payload<>'')")[0][0]==0)
  psql('identity','identity-suspend.sql','cc059d09e8deecef1652844b8aa4523d473340e6d870380fb7ac97a96e7c1558');cmd('systemctl','restart','alisa-identity@stage');health({'web':'alisa-e82003211bdcd687','platform':R,'identity':R,'admin':R});check('native_admin_code_issuance_still_denied_after_drain',request(auth_url,no_redirect=True)[0]==403);psql('identity','identity-suspend.sql','cc059d09e8deecef1652844b8aa4523d473340e6d870380fb7ac97a96e7c1558')
  check('dedicated_client_disabled_and_tokens_zero',H.sql('identity',"SELECT grant_types,response_types FROM allauth_idp_oidc_client WHERE id='alisa_admin_stage'")[0]==('','') and H.sql('identity',"SELECT count(*) FROM allauth_idp_oidc_token WHERE client_id='alisa_admin_stage'")[0][0]==0);check('prior_native_staff_token_revoked',request(meta['userinfo_endpoint'],headers={'Authorization':'Bearer '+native_access})[0]==401)
  identity_cfg=cfg('identity');ttlcode="from allauth.idp.oidc import app_settings;print(app_settings.AUTHORIZATION_CODE_EXPIRES_IN)";ttl=int(cmd(REL/'.venv/bin/python',REL/'services/identity/manage.py','shell','--command',ttlcode,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8',**identity_cfg}).stdout.decode().strip().splitlines()[-1]);check('actual_native_code_ttl_is_60',ttl==60);drained=time.monotonic();rec['phase']='WAIT_CODE_TTL';OUT.write_text(json.dumps(rec,indent=2))
  page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('customer_session_works_while_staff_closed',True)
  while time.monotonic()-drained<=ttl+1:time.sleep(.5)
  rec['waited_code_ttl_seconds']=round(time.monotonic()-drained,3);check('native_authorization_code_ttl_fully_elapsed',time.monotonic()-drained>ttl)
  drop=pathlib.Path('/etc/systemd/system/alisa-admin@stage.service.d/s03-release.conf');(D/'admin-s03-dropin.conf').write_bytes(drop.read_bytes());drop.unlink()
  for n in ['platform','identity','admin']:p=C/(n+'.env');p.write_bytes((before/'etc/alisa-platform/stage'/(n+'.env')).read_bytes());p.chmod(0o600)
  point('site-current','alisa-6ae348354b3db0d3');point('identity-current','alisa-e82003211bdcd687');point('admin-current','alisa-e82003211bdcd687');restart();rec['prior_code_health']=health({'web':'alisa-e82003211bdcd687','platform':'alisa-6ae348354b3db0d3','identity':'alisa-e82003211bdcd687','admin':'alisa-e82003211bdcd687'});ingress(True);check('actual_prior_compatible_versions_restored',True)
  page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('old_code_same_customer_tenant_profile',page.locator('input[name=display_name]').input_value()=='S03 Test Owner' and str(H.sql('platform','SELECT tenant_id FROM accounts_membership WHERE customer_id=%s',[data['owner_customer']])[0][0])==data['owner_tenant'])
  status,body,head=request(auth_url,no_redirect=True);check('prior_idp_disabled_admin_client_cannot_issue_code',status in [302,400,403] and 'code' not in parse_qs(urlsplit(head.get('Location','')).query))
  check('staff_schema_data_and_owner_retained_under_old_code',H.sql('platform',"SELECT count(*) FROM staff_staffmember WHERE product_id='alisa_market' AND role='OWNER' AND active")[0][0]==1 and str(H.sql('identity','SELECT id FROM accounts_person WHERE id=%s',[data['owner_person']])[0][0])==data['owner_person'])
  # Re-enable the same bytes without restoring a database or rotating keys.
  ingress(False)
  for n in ['platform','identity','admin']:d=newcfg[n].copy();d['ALISA_STAFF_ENABLED']='0';envwrite(n,d)
  for n in ['site-current','identity-current','admin-current']:point(n,R)
  drop.write_bytes((D/'admin-s03-dropin.conf').read_bytes());drop.chmod(0o644);restart();health({'web':'alisa-e82003211bdcd687','platform':R,'identity':R,'admin':R});check('same_s03_code_started_closed',True)
  restore="import json,sys;from django.db import transaction;from allauth.idp.oidc.models import Client,Token;from octoport_identity.accounts.models import Subject;v=json.load(sys.stdin)\nwith transaction.atomic():\n c=Client.objects.select_for_update().get(pk=v['id']);assert c.id=='alisa_admin_stage' and c.type==v['type'] and c.secret==v['secret'] and c.redirect_uris==v['redirect'] and c.grant_types==c.response_types=='' and not Token.objects.filter(client=c).exists();assert [[str(x) for x in r] for r in Subject.objects.filter(client=c).order_by('id').values_list('id','person_id')]==v['subjects'];c.grant_types='authorization_code';c.response_types='code';c.save(update_fields=['grant_types','response_types'])\nprint('ADMIN_CLIENT_CAPABILITIES_RESTORED')"
  out=cmd(REL/'.venv/bin/python',REL/'services/identity/manage.py','shell','--command',restore,env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8',**cfg('identity')},inp=json.dumps(snap).encode());check('only_preserved_admin_client_capabilities_restored',b'ADMIN_CLIENT_CAPABILITIES_RESTORED' in out.stdout)
  for n in ['identity','platform']:envwrite(n,newcfg[n])
  cmd('systemctl','restart','alisa-identity@stage','alisa-platform@stage');envwrite('admin',newcfg['admin']);cmd('systemctl','restart','alisa-admin@stage');rec['same_s03_health']=health({'web':'alisa-e82003211bdcd687','platform':R,'identity':R,'admin':R});ingress(True)
  H.bff_login(page,H.totp(data['owner_secret']));check('fresh_native_mfa_login_after_real_rollback',True)
  check('old_staff_token_remains_revoked',request('http://127.0.0.1:18102/api/v1/staff/me',json.dumps({'session_token':old_token}).encode(),headers)[0]==401);check('old_staff_flow_remains_consumed',request('http://127.0.0.1:18102/api/v1/staff/auth/flows/consume',json.dumps({'flow_ref':old_flow}).encode(),headers)[0]==400)
  check('same_ids_profile_and_one_owner_no_duplicate',H.sql('platform',"SELECT count(*) FROM staff_staffmember WHERE product_id='alisa_market' AND role='OWNER'")[0][0]==1 and H.sql('platform','SELECT display_name FROM accounts_customer WHERE id=%s',[data['owner_customer']])[0][0]=='S03 Test Owner' and H.sql('identity','SELECT count(*) FROM accounts_subject WHERE id=%s',[data['owner_subject']])[0][0]==1)
  check('old_web_probe_clients_retained_after_reentry',json.loads(json.dumps(H.sql('identity',"SELECT row_to_json(c) FROM allauth_idp_oidc_client c WHERE id<>'alisa_admin_stage' ORDER BY id"),default=str))==baseline['identity']['clients']);check('keys_exact_and_web_unchanged',all(cfg(n)==newcfg[n] for n in ['platform','identity','admin']) and (C/'web.env').read_bytes()==(before/'etc/alisa-platform/stage/web.env').read_bytes() and (B/'web-current').resolve().name=='alisa-e82003211bdcd687')
  ctx.storage_state(path=str(D/'synthetic-owner-browser-state.json'));data['owner_session_token']=next(c['value'] for c in ctx.cookies() if c['name']=='__Host-alisa_staff');H.PRIVATE.append(data['owner_session_token']);data['private_values']=H.PRIVATE;(D/'synthetic-fixture.json').write_text(json.dumps(data));rec['status']='PASS';rec['phase']='REENABLED_S03'
 except Exception as ex:
  rec['status']='FAILED';rec['error_type']=type(ex).__name__;rec['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:rec['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  if browser:browser.close()
  if pw:pw.stop()
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(rec,indent=2));print(json.dumps({'status':rec['status'],'cases':len(rec['cases']),'failed_case':rec.get('failed_case'),'error_type':rec.get('error_type'),'line':rec.get('line')}))
 return rec['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
