"""Read-only actual S03 manifest/permissions/privacy/excluded-scope checks."""
import os,sys,pathlib,json,datetime,hashlib,subprocess,urllib.request,importlib.util
sys.dont_write_bytecode=True;os.umask(0o077)
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s03-3e91b1aa5d405d0e');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');B=pathlib.Path('/opt/alisa-platform/stage');R='alisa-3e91b1aa5d405d0e';REL=B/'releases'/R
M=D/'mixed-07290-20261105f001';P='alisa-07290e7c17f556bf'
spec=importlib.util.spec_from_file_location('final_helpers',D/'smoke-r3.py');H=importlib.util.module_from_spec(spec);spec.loader.exec_module(H)
rec={'scope':'CURRENT_MIXED_S03_STAFF_SCOPE_FINAL_BINDING_PRIVACY_RUNTIME','release':R,'status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()};OUT=E/'AL_S03_CURRENT_07290_FINAL_CHECKS_20261105.json'
def check(n,ok):
 rec['cases'].append({'case':n,'passed':bool(ok)})
 if not ok:raise RuntimeError(n)
def command(*args):return subprocess.run(list(args),capture_output=True,text=True,check=True,timeout=20).stdout
def run():
 assert not OUT.exists()
 try:
  check('actual_smoke_pass',json.loads((E/'AL_S03_CURRENT_07290_SMOKE_20261105.json').read_text())['status']=='PASS');check('actual_reentry_pass',json.loads((E/'AL_S03_CURRENT_07290_ROLLBACK_20261105.json').read_text())['status']=='PASS')
  m=json.loads((REL/'manifest.json').read_text());actual={};links={}
  for p in REL.rglob('*'):
   if p.relative_to(REL).parts[0]=='.venv':continue
   if p.is_symlink():links[str(p.relative_to(REL))]=os.readlink(p)
   elif p.is_file() and p!=REL/'manifest.json':actual[str(p.relative_to(REL))]=hashlib.sha256(p.read_bytes()).hexdigest()
  check('exact_installed_source_all_4406_hashes_and_42_links',m['source_sha']=='3e91b1aa5d405d0e8160c4dbe3dcad56eb606dae' and actual==m['files'] and links==m['links'] and len(actual)==4406 and len(links)==42)
  other=B/'releases'/P;om=json.loads((other/'manifest.json').read_text());ofiles={};olinks={}
  for p in other.rglob('*'):
   if p.relative_to(other).parts[0]=='.venv':continue
   if p.is_symlink():olinks[str(p.relative_to(other))]=os.readlink(p)
   elif p.is_file() and p!=other/'manifest.json':ofiles[str(p.relative_to(other))]=hashlib.sha256(p.read_bytes()).hexdigest()
  check('07290_exact_installed_4408_files_and_42_links',om['source_sha']=='07290e7c17f556bfe8e144fd766ee0163c0b88db' and ofiles==om['files'] and olinks==om['links'] and len(ofiles)==4408 and len(olinks)==42)
  import shutil
  rec['disk_free_mib']=shutil.disk_usage(B).free//1048576;check('disk_reserve_retained_after_tests',rec['disk_free_mib']>=3072 and os.statvfs(B).f_favail>=200000)
  for n in ['web','platform','identity','admin']:
   check(n+'_all_current_config_bytes_preserved',pathlib.Path('/etc/alisa-platform/stage',n+'.env').read_bytes()==(M/(n+'.env')).read_bytes())
  for p in M.iterdir():
   if p.is_file():check(p.name+'_root_private_current_snapshot',not p.is_symlink() and p.stat().st_uid==0 and p.stat().st_mode&0o777==0o600)
  data=json.loads((M/'fixture-after.json').read_text());secret_values=data['private_values']
  for n in ['web','admin','platform','identity','platform-migration','identity-migration']:
   p=pathlib.Path('/etc/alisa-platform/stage')/(n+'.env');check(n+'_private_root_config',not p.is_symlink() and p.stat().st_uid==0 and p.stat().st_mode&0o777==0o600)
  for p in [D,E,M]:check(p.name+'_root_private_directory',not p.is_symlink() and p.stat().st_uid==0 and p.stat().st_mode&0o777==0o700)
  for name in ['synthetic-fixture.json','synthetic-owner-browser-state.json','synthetic-reader-browser-state.json','verified-owner.json','admin-client-preserved.json']:
   p=D/name;check(name+'_private',not p.is_symlink() and p.stat().st_uid==0 and p.stat().st_mode&0o777==0o600)
  admin=H.cfg('admin');platform=H.cfg('platform');identity=H.cfg('identity');web=H.cfg('web')
  check('staff_client_key_service_authority_separate',admin['ALISA_STAFF_OIDC_CLIENT_ID']=='alisa_admin_stage' and len({admin['ALISA_STAFF_OIDC_CLIENT_SECRET'],admin['ALISA_STAFF_SESSION_KEY'],admin['ALISA_STAFF_SERVICE_TOKEN']})==3 and admin['ALISA_STAFF_SERVICE_TOKEN']==platform['ALISA_STAFF_SERVICE_TOKEN'] and all(v not in web.values() for v in [admin['ALISA_STAFF_OIDC_CLIENT_SECRET'],admin['ALISA_STAFF_SESSION_KEY'],admin['ALISA_STAFF_SERVICE_TOKEN']]))
  check('admin_config_no_database_or_web_private_material',not any(k.startswith('ALISA_DB_') or k.startswith('ALISA_WEB_OIDC_') for k in admin))
  check('closed_synthetic_private_mail_retained',platform['ALISA_LANDING_MODE']=='CLOSED' and identity['ALISA_SMTP_HOST']=='127.0.0.1' and identity['ALISA_SMTP_PORT']=='18225' and platform['FOUNDATION_PROBE_ENABLED']=='0')
  for n in ['platform','identity']:
   d=H.cfg(n);check(n+'_runtime_no_ddl',not H.sql(n,"SELECT has_schema_privilege(current_user,'public','CREATE')")[0][0]);denied=False
   try:H.psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname='alisa_stage_'+('identity' if n=='platform' else 'platform'),user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],connect_timeout=3).close()
   except H.psycopg.OperationalError as ex:denied=('permission denied for database' in str(ex).lower() and 'does not have connect privilege' in str(ex).lower())
   check(n+'_other_own_database_connect_denied_acl_and_native_fatal',denied and not H.sql(n,'SELECT has_database_privilege(current_user,%s,%s)',['alisa_stage_'+('identity' if n=='platform' else 'platform'),'CONNECT'])[0][0])
  factor_data=H.sql('identity','SELECT data FROM mfa_authenticator WHERE user_id=%s',[data['owner_person']]);check('native_factor_secret_encrypted_in_own_db',all(data['owner_secret'] not in json.dumps(row,default=str) for row in factor_data))
  audit=json.dumps(H.sql('platform',"SELECT action,reason,outcome,before,after FROM staff_staffauditevent WHERE product_id='alisa_market'"),default=str);check('audit_contains_no_contacts_or_factor_tokens',all(v not in audit for v in secret_values if len(v)>=8))
  before=D/'before';old_clients=json.loads((before/'database-baseline.json').read_text())['identity']['clients'];check('old_oidc_clients_exact',json.loads(json.dumps(H.sql('identity',"SELECT row_to_json(c) FROM allauth_idp_oidc_client c WHERE id<>'alisa_admin_stage' ORDER BY id"),default=str))==old_clients)
  v=pathlib.Path('/etc/nginx/sites-available/alisa-platform-stage.conf');check('own_vhost_exact_safe_open_configuration',v.read_bytes()==(M/'vhost-open.conf').read_bytes());foreign=json.loads((before/'excluded-vhost-hashes.json').read_text());check('all_excluded_nginx_files_unchanged',all(pathlib.Path(p).exists() and hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h for p,h in foreign.items()))
  rec['actual_https_readback']={}
  for n,url in [('web','https://alisa-stage.octoport.ru/health/ready'),('identity','https://id-stage.octoport.ru/health/ready'),('admin','https://alisa-admin-stage.octoport.ru/health/ready'),('platform','http://127.0.0.1:18102/health/ready')]:
   with urllib.request.urlopen(url,timeout=5) as response:value=json.load(response)
   rec['actual_https_readback'][n]=value;check(n+'_expected_ready_release',value['status']=='READY' and value['release']==(R if n=='admin' else P))
  check('web_shared_pointer_and_config_unchanged',(B/'web-current').resolve().name==P and (B/'current').resolve().name=='alisa-77d0f8ee2643ef65' and pathlib.Path('/etc/alisa-platform/stage/web.env').read_bytes()==(M/'web.env').read_bytes())
  for unit in ['alisa-web@stage.service','alisa-platform@stage.service','alisa-identity@stage.service','alisa-admin@stage.service','alisa-account-cleanup@stage.timer','alisa-identity-mail@stage.timer','alisa-lead-mail@stage.timer','alisa-probe-cleanup@stage.timer']:
   check(unit+'_active_enabled',command('systemctl','is-active',unit).strip()=='active' and command('systemctl','is-enabled',unit).strip()=='enabled')
  logs=command('journalctl','--since','2026-11-05 11:26:00 UTC','--no-pager','-o','cat','-u','alisa-web@stage','-u','alisa-platform@stage','-u','alisa-identity@stage','-u','alisa-admin@stage')
  for name in ['alisa-admin-stage.access.log','alisa-platform-identity-stage.access.log','alisa-platform-stage.access.log','error.log']:
   p=pathlib.Path('/var/log/nginx')/name
   if p.exists():logs+='\n'+p.read_text()
  check('own_ingress_and_service_logs_no_fixture_private_values',not any(v in logs for v in secret_values if len(v)>=8));check('logs_no_new_config_secrets',not any(v in logs for v in [admin['ALISA_STAFF_OIDC_CLIENT_SECRET'],admin['ALISA_STAFF_SESSION_KEY'],admin['ALISA_STAFF_SERVICE_TOKEN']]))
  check('qualification_window_active',command('systemctl','is-active','alisa-s03-qualified-window-20261105f002.service').strip()=='active')
  check('full_current_pointer_tuple',all((B/n).resolve().name==v for n,v in {'admin-current':R,'identity-current':P,'site-current':P,'web-current':P,'current':'alisa-77d0f8ee2643ef65'}.items()))
  unit_names=['alisa-s03-07290-smoke-20261105f001','alisa-s03-07290-rollback-20261105f001','alisa-s03-dedup-20261105e001','alisa-s03-current-smoke-20261105e001','alisa-s03-current-smoke-20261105e002','alisa-s03-current-rollback-20261105e001','alisa-s03-install-20261105d001','alisa-s03-install-20261105d002','alisa-s03-activate-20261105d001','alisa-s03-activate-20261105d002','alisa-s03-activate-20261105d003','alisa-s03-smoke-20261105d001','alisa-s03-smoke-20261105d002','alisa-s03-smoke-20261105d003','alisa-s03-smoke-20261105d004','alisa-s03-rollback-20261105d001','alisa-s03-reentry-20261105d001'];active=[]
  for unit in unit_names:
   out=command('systemctl','show',unit,'--property=MainPID,ControlGroup');kv=dict(line.split('=',1) for line in out.splitlines() if '=' in line);cg=pathlib.Path('/sys/fs/cgroup'+kv.get('ControlGroup',''))/'cgroup.procs';active.append(kv.get('MainPID','0')!='0' or bool(kv.get('ControlGroup') and cg.exists() and cg.read_text().strip()))
  check('all_own_previous_test_cgroups_finished',not any(active))
  current_real=H.sql('identity',"SELECT id,attempts,sent_at,error_code,lease_until FROM accounts_identitymail WHERE lower(recipient) NOT LIKE %s ORDER BY id",['%@example.invalid']);expected_real=json.loads((M/'real-mail-before-private.json').read_text());check('non_synthetic_mail_unchanged_from_before_current_smoke',json.loads(json.dumps(current_real,default=str))==expected_real);rec['non_synthetic_mail_fingerprint']=hashlib.sha256(json.dumps(current_real,default=str).encode()).hexdigest();rec['status']='PASS'
 except Exception as ex:
  rec['status']='FAILED';rec['error_type']=type(ex).__name__;rec['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:rec['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec))
 return rec['status']=='PASS'
if __name__=='__main__':sys.exit(0 if run() else 1)
