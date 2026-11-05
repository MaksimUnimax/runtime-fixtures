import os,sys,pathlib,json,hashlib,subprocess,datetime,urllib.request,re,contextlib,fcntl
os.umask(0o077);sys.dont_write_bytecode=True
BASE=pathlib.Path('/opt/alisa-platform/stage');R='alisa-6ae348354b3db0d3';REL=BASE/'releases'/R;BACK=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s02-6ae348354b3db0d3');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');CFGROOT=pathlib.Path('/etc/alisa-platform/stage');CASES=[]
def check(n,ok,**safe):
 CASES.append({'case':n,'passed':bool(ok),**safe});print(json.dumps(CASES[-1]),flush=True)
 if not ok:raise RuntimeError(n)
def command(*a):return subprocess.run(list(a),capture_output=True,text=True,check=True,timeout=30)
def cfg(n):return dict(l.split('=',1) for l in (CFGROOT/(n+'.env')).read_text().splitlines() if l and not l.startswith('#') and '=' in l)
def run():
 out=E/'AL_S02_INSTALLED_FINAL_CHECKS_20261105.json';assert not out.exists();r={'scope':'INSTALLED_EXACT_BYTES_LOG_PRIVACY_AND_EXCLUDED_COMPONENT_READBACK','release':R,'cases':CASES,'status':'RUNNING'}
 try:
  sys.path.insert(0,str(REL));from infra.release import installed_release
  check('installed_immutable_manifest_all_files',installed_release(BASE,R)==REL)
  check('retained_archive_exact_hash',hashlib.sha256((pathlib.Path('/var/lib/alisa-platform/stage/artifacts')/(R+'.tar.gz')).read_bytes()).hexdigest()=='4848fc3e0975d4b3fb347e7b0f5634c44ad81d01a31690263a3bf31cfb83136c')
  baseline=json.loads((BACK/'baseline.json').read_text())
  for p,digest in baseline['foreign_nginx'].items():check('unchanged_vhost_'+pathlib.Path(p).name,hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==digest)
  v=pathlib.Path('/etc/nginx/sites-available/alisa-platform-stage.conf').read_text();parts=re.split(r'(?m)(?=^server \{)',v);admin=next(p for p in parts if 'server_name alisa-admin-stage.octoport.ru;' in p);act=json.loads((E/'AL_S02_ACTIVATION_20261105.json').read_text());check('admin_vhost_exactly_preserved',hashlib.sha256(admin.encode()).hexdigest()==act['admin_vhost_sha256'])
  for unit,old in baseline['foreign_units'].items():
   if unit not in ['alice-lab-web.service','alice-lab-worker.service','alice-lab-llm.service','alice-market.service']:continue
   now=command('systemctl','show',unit,'--property=MainPID,InvocationID,ActiveState,ExecMainStartTimestampMonotonic').stdout;check('unchanged_process_'+unit,now==old)
  check('admin_private_config_preserved',hashlib.sha256((CFGROOT/'admin.env').read_bytes()).hexdigest()==baseline['files'][str(CFGROOT/'admin.env')]['sha256'])
  marker='s02-private-privacy-'+datetime.datetime.now().strftime('%H%M%S')+'@example.invalid'
  req=urllib.request.Request('https://alisa-stage.octoport.ru/?utm_source='+marker+'&utm_campaign=private',headers={'Referer':'https://example.invalid/private?contact='+marker})
  with urllib.request.urlopen(req,timeout=10) as response:check('privacy_probe_real_https_response',response.status==200)
  secrets=[marker];configs={c:cfg(c) for c in ['web','platform','identity']}
  for c,d in configs.items():
   secrets.extend(val for key,val in d.items() if re.search('PASSWORD|SECRET|TOKEN|DATA_KEYS|SIGNING|SESSION_KEY|ENGINEERING_AUTH',key) and len(val)>16)
  private=json.loads((BACK/'synthetic-fixture.json').read_text());secrets+=private['private_values']
  for n in ['synthetic-browser-state.json','synthetic-second-browser-state.json']:
   state=json.loads((BACK/n).read_text());secrets.extend(c['value'] for c in state['cookies'])
  pp=BACK/'private-policy-values.json'
  if pp.exists():secrets+=json.loads(pp.read_text())
  logs=[]
  for n in ['alisa-platform-stage.access.log','alisa-platform-identity-stage.access.log']:
   p=pathlib.Path('/var/log/nginx')/n;lines=p.read_text().splitlines();check('path_only_access_format_'+n,all((re.fullmatch(r'[A-Z]+ [^ ?]+ [0-9]{3}',l) or l=='- - 400') for l in lines if l));logs.append('\n'.join(lines))
  journal=command('journalctl','--since','2026-11-05 05:34:00 UTC','--no-pager','-o','cat',*sum((['-u','alisa-'+c+'@stage.service'] for c in ['web','platform','identity','identity-mail','account-cleanup']),[])).stdout;logs.append(journal)
  err=pathlib.Path('/var/log/nginx/error.log');own_errors=[]
  if err.exists():own_errors=[l for l in err.read_text().splitlines() if 'server: alisa-stage.octoport.ru' in l or 'server: id-stage.octoport.ru' in l]
  logs.extend(own_errors);text='\n'.join(logs)
  check('known_contacts_codes_cookies_keys_not_in_logs',all(s not in text for s in secrets if s))
  check('no_jwt_or_callback_query_in_logs',not re.search(r'eyJ[A-Za-z0-9_-]+\.|auth/callback\?|code=[A-Za-z0-9_-]{12}',text))
  check('utm_referrer_marker_not_logged',marker not in text)
  for c in ['web','platform','identity']:
   pid=int(command('systemctl','show','alisa-'+c+'@stage.service','--property=MainPID','--value').stdout);raw=pathlib.Path('/proc')/str(pid)/'environ';keys={b.split(b'=',1)[0].decode() for b in raw.read_bytes().split(b'\0') if b}
   if c=='web':check('web_has_no_database_or_identity_private_keys',not any(k.startswith('ALISA_DB_') for k in keys) and 'ALISA_IDENTITY_DATA_KEYS' not in keys and 'ALISA_IDENTITY_SIGNING_KEYS_B64' not in keys)
   if c=='platform':check('platform_has_no_identity_or_web_private_keys',not {'ALISA_IDENTITY_DATA_KEYS','ALISA_IDENTITY_SIGNING_KEYS_B64','ALISA_WEB_OIDC_CLIENT_SECRET','ALISA_WEB_SESSION_KEY'}&keys)
   if c=='identity':check('identity_has_no_product_client_secret_or_auth_token',not {'ALISA_WEB_OIDC_CLIENT_SECRET','ALISA_WEB_SESSION_KEY','ALISA_AUTH_SERVICE_TOKEN'}&keys)
  check('private_env_permissions',all((CFGROOT/(c+'.env')).stat().st_mode&0o077==0 for c in ['web','platform','identity','platform-migration','identity-migration']))
  check('runtime_technical_probe_disabled',all(configs[c].get('FOUNDATION_PROBE_ENABLED')=='0' for c in configs))
  check('engineering_worker_inactive',subprocess.run(['systemctl','is-active','alisa-worker@stage.service'],capture_output=True,text=True).stdout.strip()=='inactive')
  for c in ['identity-mail','account-cleanup']:check(c+'_timer_enabled_active',command('systemctl','is-enabled','alisa-'+c+'@stage.timer').stdout.strip()=='enabled' and command('systemctl','is-active','alisa-'+c+'@stage.timer').stdout.strip()=='active')
  check('new_pointer_and_shared_s00_current',all((BASE/n).resolve().name==R for n in ['site-current','identity-current']) and (BASE/'current').resolve().name=='alisa-77d0f8ee2643ef65')
  check('temporary_testing_proxy_and_dropins_absent','18243' not in v and '18240' not in v and not list(pathlib.Path('/etc/systemd/system').glob('alisa-*@stage.service.d/s02-egress-test.conf')) and not (BASE/'s02-test').exists())
  r['health']={}
  for c,port in [('web',18100),('platform',18102),('identity',18103),('admin',18101)]:
   with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=5) as response:d=json.load(response)
   check(c+'_exact_version',d.get('release')==(R if c!='admin' else 'alisa-77d0f8ee2643ef65') and d.get('status')=='READY');r['health'][c]=d
  r['known_private_values_scanned']=len(secrets);r['status']='PASS'
 except Exception as ex:r['status']='FAILED';r['error_type']=type(ex).__name__;r['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
 finally:r['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();r['case_count']=len(CASES);out.write_text(json.dumps(r,indent=2));print(json.dumps({'status':r['status'],'cases':len(CASES),'failed_case':r.get('failed_case'),'error_type':r.get('error_type')}))
 return r['status']=='PASS'
with contextlib.ExitStack() as stack:
 for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
  f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 sys.exit(0 if run() else 1)
