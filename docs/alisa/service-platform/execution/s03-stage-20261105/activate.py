"""Finite owner-approved S03 migration/config/component activation."""
import os,sys,pathlib,json,datetime,subprocess,secrets,base64,hashlib,re,shutil,time,urllib.request,urllib.error,contextlib,fcntl,io
os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');R='alisa-3e91b1aa5d405d0e';REL=B/'releases'/R;D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');C=pathlib.Path('/etc/alisa-platform/stage');V=pathlib.Path('/etc/nginx/sites-available/alisa-platform-stage.conf')
sys.path.append(str(REL/'.venv/lib/python3.12/site-packages'));import psycopg
rec={'record_type':'AUTHORIZED_S03_STAGE_MIGRATION_ACTIVATION','release':R,'status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
def check(n,ok):
 rec['cases'].append({'case':n,'passed':bool(ok)})
 if not ok:raise RuntimeError(n)
def cfg(n):return dict(l.split('=',1) for l in (C/(n+'.env')).read_text().splitlines() if l and not l.startswith('#'))
def write_env(n,d):
 p=C/(n+'.env');tmp=C/('.s03-'+n+'.tmp');assert not tmp.exists();tmp.write_text(''.join(k+'='+v+'\n' for k,v in d.items()));tmp.chmod(0o600);os.replace(tmp,p)
def sql(c,q,args=()):
 d=cfg(c)
 with psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],autocommit=True) as con:
  cur=con.execute(q,args);return cur.fetchall() if cur.description else []
def command(a,env=None):return subprocess.run(list(map(str,a)),env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=70)
def base_env(d):return {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',**d}
def point(n):
 t=B/('.s03-'+n);assert not t.exists();t.symlink_to(REL);os.replace(t,B/n)
def health():
 out={}
 for n,p,version in [('web',18100,'alisa-e82003211bdcd687'),('platform',18102,R),('identity',18103,R),('admin',18101,R)]:
  for _ in range(70):
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{p}/health/ready',timeout=2) as response:v=json.load(response)
    if v.get('release')==version and v.get('status')=='READY':out[n]=v;break
   except OSError:pass
   time.sleep(.2)
  else:raise RuntimeError('health_'+n)
 return out
def request(url,data,headers):
 try:r=urllib.request.urlopen(urllib.request.Request(url,data=data,headers=headers),timeout=6)
 except urllib.error.HTTPError as e:r=e
 with r:return r.status
def run():
 output=D/'activation-result.json';assert not output.exists()
 try:
  check('exact_install_previously_passed',json.loads((D/'install-retry-result.json').read_text())['status']=='PASS_INSTALLED_NOT_ACTIVATED')
  check('pointer_baseline_unchanged',(B/'site-current').resolve().name=='alisa-6ae348354b3db0d3' and all((B/n).resolve().name=='alisa-e82003211bdcd687' for n in ['web-current','identity-current','admin-current']))
  before=D/'before';check('config_fingerprints_unchanged',all((C/(n+'.env')).read_bytes()==(before/'etc/alisa-platform/stage'/(n+'.env')).read_bytes() for n in ['platform','identity','admin','web','platform-migration','identity-migration']))
  staff_secret=secrets.token_urlsafe(48);staff_service=secrets.token_urlsafe(48);staff_key=base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b'=').decode();web=cfg('web');platform=cfg('platform');identity=cfg('identity')
  check('staff_secrets_distinct',len({staff_secret,staff_service,staff_key})==3 and all(v not in web.values() and v not in platform.values() for v in [staff_secret,staff_service,staff_key]))
  platform.update(ALISA_STAFF_ENABLED='0',ALISA_STAFF_OIDC_CLIENT_ID='alisa_admin_stage',ALISA_STAFF_SERVICE_TOKEN=staff_service)
  identity.update(ALISA_STAFF_ENABLED='0',ALISA_STAFF_OIDC_CLIENT_ID='alisa_admin_stage',ALISA_STAFF_OIDC_REDIRECT_URI='https://alisa-admin-stage.octoport.ru/auth/callback')
  admin={'ALISA_ENV':'stage','ALISA_RELEASE':R,'ALISA_PLATFORM_URL':'http://127.0.0.1:18102','ALISA_ADMIN_BASE_URL':'https://alisa-admin-stage.octoport.ru','ALISA_IDENTITY_ISSUER':'https://id-stage.octoport.ru','ALISA_STAFF_ENABLED':'0','ALISA_STAFF_OIDC_CLIENT_ID':'alisa_admin_stage','ALISA_STAFF_OIDC_CLIENT_SECRET':staff_secret,'ALISA_STAFF_SESSION_KEY':staff_key,'ALISA_STAFF_SERVICE_TOKEN':staff_service}
  for n,v in [('platform',platform),('identity',identity),('admin',admin)]:write_env(n,v)
  after=D/'after';after.mkdir(mode=0o700)
  for n in ['platform','identity','admin']:shutil.copy2(C/(n+'.env'),after/(n+'-closed.env'))
  plan=command([REL/'.venv/bin/python',REL/'bin/alisa','migrate','--env','stage','--release',R,'--plan'],base_env({})).stdout.decode();(D/'migration-plan-before.txt').write_text(plan)
  planned=re.findall(r'^([a-z_]+\.\d{4}_[a-z_]+)\s*$',plan,re.M);check('only_staff_0001_planned',planned==['staff.0001_initial'])
  applied=command([REL/'.venv/bin/python',REL/'bin/alisa','migrate','--env','stage','--release',R,'--apply'],base_env({}));(D/'migration-apply.txt').write_bytes(applied.stdout)
  empty=command([REL/'.venv/bin/python',REL/'bin/alisa','migrate','--env','stage','--release',R,'--plan'],base_env({})).stdout.decode();check('repeat_migration_plan_empty',not re.findall(r'^[a-z_]+\.\d{4}_',empty,re.M))
  check('five_staff_tables',sql('platform',"SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'staff_%'")[0][0]==5)
  check('runtime_audit_append_only',sql('platform',"SELECT has_table_privilege(current_user,'staff_staffauditevent','INSERT'),has_table_privilege(current_user,'staff_staffauditevent','UPDATE'),has_table_privilege(current_user,'staff_staffauditevent','DELETE'),has_table_privilege(current_user,'staff_staffauditevent','TRUNCATE')")[0]==(True,False,False,False))
  baseline=json.loads((before/'database-baseline.json').read_text());check('identity_migrations_unchanged',[list(x) for x in sql('identity','SELECT app,name FROM django_migrations ORDER BY app,name')]==baseline['identity']['migrations'])
  old=V.read_text();blocks=list(re.finditer(r'server \{.*?(?=\nserver \{|\Z)',old,re.S));matches=[m for m in blocks if 'server_name alisa-admin-stage.octoport.ru;' in m.group()];check('one_own_admin_vhost',len(matches)==1);m=matches[0];body=m.group().replace('client_max_body_size 1k;','client_max_body_size 16k;').replace('server_name alisa-admin-stage.octoport.ru;','server_name alisa-admin-stage.octoport.ru;\n access_log /var/log/nginx/alisa-admin-stage.access.log alisa_platform_site_safe;');opened=old[:m.start()]+body+old[m.end():];closed=old[:m.start()]+body.replace('server_name alisa-admin-stage.octoport.ru;','server_name alisa-admin-stage.octoport.ru;\n return 503;')+old[m.end():]
  (D/'admin-vhost-open.conf').write_text(opened);(D/'admin-vhost-closed.conf').write_text(closed);V.write_text(closed);command(['nginx','-t']);command(['systemctl','reload','nginx'])
  drop=pathlib.Path('/etc/systemd/system/alisa-admin@stage.service.d/s03-release.conf');check('own_admin_dropin_absent',not drop.exists());drop.write_text('[Service]\nWorkingDirectory=/opt/alisa-platform/stage/admin-current\nExecStart=\nExecStart=/opt/alisa-platform/stage/admin-current/.venv/bin/python /opt/alisa-platform/stage/admin-current/infra/launch.py admin\n');drop.chmod(0o644)
  for n in ['site-current','identity-current','admin-current']:point(n)
  command(['systemctl','daemon-reload']);command(['systemctl','restart','alisa-platform@stage','alisa-identity@stage','alisa-admin@stage']);rec['closed_health']=health()
  check('closed_admin_start_denied',request('http://127.0.0.1:18101/auth/start',b'return_to=%2Fadmin',{'Host':'alisa-admin-stage.octoport.ru','Origin':'https://alisa-admin-stage.octoport.ru','Content-Type':'application/x-www-form-urlencoded'})==404)
  check('closed_platform_staff_api_denied',request('http://127.0.0.1:18102/api/v1/staff/me',b'{}',{'Host':'127.0.0.1','Content-Type':'application/json','Authorization':'Bearer '+staff_service})==404)
  boot=base_env(identity);oldboot=dict(l.split('=',1) for l in pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s02-6ae348354b3db0d3/bootstrap.env').read_text().splitlines() if l and not l.startswith('#'))
  boot.update({k:v for k,v in oldboot.items() if k.startswith(('ALISA_WEB_OIDC_','ALISA_PROBE_OIDC_'))});boot.update(ALISA_STAFF_ENABLED='1',ALISA_STAFF_OIDC_CLIENT_SECRET=staff_secret)
  (D/'bootstrap.env').write_text(''.join(k+'='+v+'\n' for k,v in boot.items()))
  command([REL/'.venv/bin/python',REL/'services/identity/manage.py','identity_clients','--apply'],boot)
  clients=sql('identity',"SELECT row_to_json(c) FROM allauth_idp_oidc_client c WHERE id<>'alisa_admin_stage' ORDER BY id");check('old_web_probe_clients_unchanged',json.loads(json.dumps(clients,default=str))==baseline['identity']['clients'])
  check('dedicated_admin_client_registered',sql('identity',"SELECT type,redirect_uris,grant_types,response_types FROM allauth_idp_oidc_client WHERE id='alisa_admin_stage'")[0]==('confidential','https://alisa-admin-stage.octoport.ru/auth/callback','authorization_code','code'))
  for n in ['identity','platform']:
   d=cfg(n);d['ALISA_STAFF_ENABLED']='1';write_env(n,d)
  command(['systemctl','restart','alisa-identity@stage','alisa-platform@stage']);health();admin['ALISA_STAFF_ENABLED']='1';write_env('admin',admin);command(['systemctl','restart','alisa-admin@stage']);rec['active_health']=health()
  V.write_text(opened);command(['nginx','-t']);command(['systemctl','reload','nginx'])
  for n in ['platform','identity','admin']:shutil.copy2(C/(n+'.env'),after/(n+'.env'))
  check('web_config_pointer_preserved',(C/'web.env').read_bytes()==(before/'etc/alisa-platform/stage/web.env').read_bytes() and (B/'web-current').resolve().name=='alisa-e82003211bdcd687')
  check('shared_current_preserved',(B/'current').resolve().name=='alisa-77d0f8ee2643ef65');check('admin_has_no_database_credentials',not any(k.startswith('ALISA_DB_') for k in cfg('admin')))
  rec['status']='PASS_ACTIVATED_PENDING_INSTALLED_SMOKE'
 except Exception as ex:
  rec['status']='FAILED';rec['error_type']=type(ex).__name__;rec['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:rec['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();output.write_text(json.dumps(rec,indent=2));print(json.dumps(rec))
 return rec['status']=='PASS_ACTIVATED_PENDING_INSTALLED_SMOKE'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
