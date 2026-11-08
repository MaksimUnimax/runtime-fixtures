"""Exact baseline, small additive install; no DB/schema, secret output, or platform rebuild."""
import contextlib, fcntl, hashlib, http.client, json, os, pwd, shutil, signal, sqlite3, subprocess, sys, time
from pathlib import Path
sys.dont_write_bytecode=True
SOURCE=Path(__file__).parent
ROOT=Path('/opt/alisa-station/releases/station-auto-r1')
BASE=Path('/opt/alice-market/releases/alisa-runtime-promotions-r1-20261108')
RUNTIME=BASE.parent/'alisa-runtime-promotions-station-r1-20261108'
LAB=Path('/opt/alice-lab/releases/20261103-market-dialogue-r4/alice_lab.py')
NGINX=Path('/etc/nginx/sites-enabled/alisa-platform-stage.conf')
INCLUDE=Path('/etc/nginx/alisa-station-location.conf')
ENV=Path('/etc/alisa-station')
UNIT=Path('/etc/systemd/system/alisa-station.service')
DROPS={
 'alice-market':Path('/etc/systemd/system/alice-market.service.d/zzzzzzzzzzzzzzzzzzz-station-r1.conf'),
 'alice-lab-web':Path('/etc/systemd/system/alice-lab-web.service.d/zz-station-r1.conf')}
STATE=Path('/var/lib/alisa-station')
RECEIPT=Path('/run/alisa-station-install-r1.json')
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
OLD={'alice-market':f'/usr/bin/python3 -B {BASE}/runtime.py --config /etc/alice-market/market-runtime.json',
     'alice-lab-web':f'/usr/bin/python3 -B {LAB} serve'}
NEW={'alice-market':f'/usr/bin/python3 -B {RUNTIME}/runtime.py --config /etc/alice-market/market-runtime.json',
     'alice-lab-web':f'/usr/bin/python3 -B {ROOT}/alice_lab.py serve'}
receipt={'status':'FAILED','checks':[],'physical_acceptance':False};cutover=False;nginx_before=None;nginx_after=None

def run(args,timeout=40):
 return subprocess.run([str(x) for x in args],capture_output=True,check=True,timeout=timeout).stdout.decode()
def prop(unit,name):return run(['systemctl','show',unit,'--value','--property='+name],5).strip()
def argv(unit):return prop(unit,'ExecStart').split('argv[]=',1)[1].split(' ;',1)[0]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def check(name,ok):
 receipt['checks'].append({'check':name,'passed':bool(ok)})
 if not ok:raise RuntimeError(name)
def write(path,content,mode=0o644):
 with path.open('x') as f:f.write(content);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),mode)
def tree_hash(root):
 return hashlib.sha256(json.dumps({str(p.relative_to(root)):sha(p) for p in root.rglob('*') if p.is_file() and '__pycache__' not in p.parts},sort_keys=True).encode()).hexdigest()
def idle():
 with contextlib.closing(sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True)) as c:
  check('runtime_idle',c.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0)
  check('no_provider_send',c.execute("SELECT count(*) FROM calls WHERE state='SENDING'").fetchone()[0]==0)
def health(path,host,port=443,method='GET',headers=None):
 conn=http.client.HTTPSConnection('127.0.0.1',port,timeout=5,context=__import__('ssl')._create_unverified_context())
 try:
  conn.request(method,path,headers={'Host':host,**(headers or {})});response=conn.getresponse();response.read();return response.status
 finally:conn.close()
def main():
 global cutover,nginx_before,nginx_after
 check('root',os.geteuid()==0)
 check('reserve',shutil.disk_usage('/').free>3072*1048576+700000)
 check('fresh_baseline',all(argv(u)==a for u,a in OLD.items()))
 check('gateway_pin',sha(BASE/'local_gateway.py')==sha(SOURCE/'gateway_original.py'))
 check('lab_pin',sha(LAB)==sha(SOURCE/'lab_original.py'))
 check('new_paths',not any(p.exists() for p in [ROOT,RUNTIME,ENV,STATE,UNIT,INCLUDE,*DROPS.values()]))
 manifest=json.loads((SOURCE/'manifest.json').read_text())
 check('candidate_hashes',all(sha(SOURCE/n)==v for n,v in manifest.items()))
 idle()
 baseline_hash=tree_hash(BASE);receipt['baseline_tree_sha256']=baseline_hash
 # Tests on the CURRENT matrix/runtime, disposable database only, in RAM.
 testenv=dict(os.environ,PYTHONPATH=str(BASE)+':'+str(SOURCE),ALISA_TEST_RUNTIME=str(BASE),TMPDIR='/run',PYTHONDONTWRITEBYTECODE='1')
 result=subprocess.run(['/usr/bin/python3','-B','-m','unittest','test_delivery','test_boundaries','test_runtime_delivery'],cwd=SOURCE,env=testenv,capture_output=True,timeout=40)
 receipt['test_output']=result.stderr.decode()[-2000:];check('installed_baseline_31_tests',result.returncode==0)
 uid=pwd.getpwnam('alice-lab').pw_uid;gid=pwd.getpwnam('alice-lab').pw_gid
 ROOT.mkdir(parents=True)
 files=['service.py','transport.py','qrcodegen.py','station_client.py','station_status.py','local_gateway.py','alice_bridge.py','alice_lab.py','index.html','app.js','style.css','THIRD_PARTY.md','README.md','manifest.json']
 for name in files:shutil.copyfile(SOURCE/name,ROOT/name);(ROOT/name).chmod(0o644)
 shutil.copytree(BASE,RUNTIME,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__'))
 for name in ['local_gateway.py','station_status.py']:
  (RUNTIME/name).unlink(missing_ok=True);shutil.copyfile(SOURCE/name,RUNTIME/name);(RUNTIME/name).chmod(0o644)
 manifest_path=RUNTIME/'manifest.json'
 old_manifest_hash=sha(manifest_path) if manifest_path.exists() else None
 manifest_path.unlink(missing_ok=True)
 runtime_manifest={'schema_version':'alisa_station_runtime_overlay_v1','base_release':str(BASE),'base_manifest_sha256':old_manifest_hash,
                   'files':{str(p.relative_to(RUNTIME)):sha(p) for p in RUNTIME.rglob('*') if p.is_file()},'contains_private_config_or_keys':False}
 write(manifest_path,json.dumps(runtime_manifest,sort_keys=True,indent=2)+'\n')
 ENV.mkdir(mode=0o700);STATE.mkdir(mode=0o700);os.chown(STATE,uid,gid)
 lines=Path('/etc/alisa-platform/stage/admin.env').read_text().splitlines()
 relevant=[x for x in lines if x.startswith(('ALISA_PLATFORM_URL=','ALISA_STAFF_SERVICE_TOKEN='))]
 check('staff_env_exact_keys',len(relevant)==2)
 write(ENV/'admin.env','\n'.join(relevant)+'\n',0o600)
 from cryptography.fernet import Fernet
 write(ENV/'session.key',Fernet.generate_key().decode()+'\n',0o600)
 write(UNIT,f'''[Unit]
Description=Alisa owner Station automatic report delivery
After=network-online.target alice-market.service alisa-platform@stage.service
Wants=network-online.target
[Service]
Type=simple
User=alice-lab
Group=alice-lab
WorkingDirectory={ROOT}
ExecStart=/usr/bin/python3 -B {ROOT}/service.py --state {STATE} --key %d/station-key
EnvironmentFile={ENV}/admin.env
LoadCredential=station-key:{ENV}/session.key
RuntimeDirectory=alisa-station
RuntimeDirectoryMode=0700
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
ProtectHome=yes
ProtectSystem=strict
ReadWritePaths={STATE} /run/alisa-station
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
CapabilityBoundingSet=
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryMax=96M
TasksMax=32
Restart=on-failure
RestartSec=3
TimeoutStopSec=10
[Install]
WantedBy=multi-user.target
''')
 write(INCLUDE,'''location ^~ /admin/station/ {
 proxy_pass http://127.0.0.1:8777;
 proxy_set_header Host $host;
 proxy_set_header X-Forwarded-Proto https;
 proxy_read_timeout 35s;
 proxy_send_timeout 10s;
 access_log off;
}
''')
 nginx_before=NGINX.read_text();needle=' server_name alisa-admin.octoport.ru;'
 check('admin_host_unique',nginx_before.count(needle)==1)
 nginx_after=nginx_before.replace(needle,needle+'\n include /etc/nginx/alisa-station-location.conf;')
 # Preserve independent service security profiles and the latest marketplace release.
 before_profiles={u:hashlib.sha256(run(['systemctl','show',u,'-p','User','-p','Group','-p','LoadCredential','-p','ReadWritePaths','-p','ProtectSystem']).encode()).hexdigest() for u in OLD}
 check('baseline_still_current',all(argv(u)==a for u,a in OLD.items()) and tree_hash(BASE)==baseline_hash)
 cutover=True
 run(['systemctl','stop','alice-lab-web']);idle();run(['systemctl','stop','alice-market']);idle()
 check('stopped_baseline_still_current',all(argv(u)==a for u,a in OLD.items()) and tree_hash(BASE)==baseline_hash)
 for u,path in DROPS.items():
  wd=RUNTIME if u=='alice-market' else ROOT
  write(path,f'[Service]\nWorkingDirectory={wd}\nExecStart=\nExecStart={NEW[u]}\n')
 run(['systemctl','daemon-reload']);check('exact_override',all(argv(u)==a for u,a in NEW.items()))
 run(['systemctl','start','alice-market','alisa-station','alice-lab-web'])
 deadline=time.monotonic()+15
 while time.monotonic()<deadline:
  if Path('/run/alisa-station/ingress.sock').exists() and Path('/run/alice-market/gateway.sock').exists():break
  time.sleep(.1)
 check('services_active',all(prop(u,'ActiveState')=='active' for u in [*NEW,'alisa-station']))
 check('security_profiles_preserved',all(hashlib.sha256(run(['systemctl','show',u,'-p','User','-p','Group','-p','LoadCredential','-p','ReadWritePaths','-p','ProtectSystem']).encode()).hexdigest()==before_profiles[u] for u in OLD))
 NGINX.write_text(nginx_after);run(['nginx','-t']);run(['systemctl','reload','nginx'])
 check('admin_auth_wall',health('/admin/station/','alisa-admin.octoport.ru')==303)
 check('cross_origin_denied',health('/admin/station/api','alisa-admin.octoport.ru',method='POST',headers={'Origin':'https://invalid.test'})==403)
 check('lab_health',health('/healthz','alice-lab.octoport.ru')==200)
 # Restart the new service proves socket lifecycle and persistence without a Yandex login.
 old_pid=prop('alisa-station','MainPID');run(['systemctl','restart','alisa-station'])
 deadline=time.monotonic()+10
 while time.monotonic()<deadline and not Path('/run/alisa-station/ingress.sock').exists():time.sleep(.1)
 check('restart_socket_ready',prop('alisa-station','ActiveState')=='active' and prop('alisa-station','MainPID')!=old_pid and Path('/run/alisa-station/ingress.sock').exists())
 state=json.loads((STATE/'state.json').read_text());check('defaults_survive_restart',state['settings']['interval_seconds']==10 and state['settings']['manual_command']=='результат' and state['settings']['enabled'] is True)
 check('reserve_retained',shutil.disk_usage('/').free>=3072*1048576)
 run(['systemctl','enable','alisa-station'])
 receipt.update(status='INSTALLED_SYNTHETIC_PASS',runtime=str(RUNTIME),baseline=str(BASE),url='https://alisa-admin.octoport.ru/admin/station/',code_sha256={n:sha(ROOT/n) for n in files},physical_acceptance=False)

def rollback():
 if not cutover:return 'NO_CUTOVER'
 if any(argv(u) not in (OLD[u],NEW[u]) for u in OLD):
  # Do not stop a foreign replacement. Remove only our exact layer and restart
  # any service left inactive by this failed cutover using its current config.
  for u,path in DROPS.items():
   if path.exists() and NEW[u] in path.read_text():path.unlink()
  run(['systemctl','daemon-reload'])
  for u in OLD:
   if prop(u,'ActiveState') in ('inactive','failed'):run(['systemctl','start',u])
  return 'FOREIGN_RUNTIME_CHANGE_PRESERVED_CURRENT_SERVICE_AVAILABILITY_RESTORED'
 run(['systemctl','stop','alisa-station','alice-lab-web','alice-market'])
 for u,path in DROPS.items():
  if path.exists() and NEW[u] in path.read_text():path.unlink()
 if nginx_after and NGINX.read_text()==nginx_after:NGINX.write_text(nginx_before);run(['nginx','-t']);run(['systemctl','reload','nginx'])
 run(['systemctl','daemon-reload']);run(['systemctl','start','alice-market','alice-lab-web'])
 return 'OWN_OVERRIDES_REMOVED_CURRENT_BASELINE_RESTORED_NO_DB_RESTORE'

if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for name in LOCKS:
   f=stack.enter_context(open('/run/lock/'+name,'a'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as e:
   receipt['error']=str(e) if isinstance(e,RuntimeError) else type(e).__name__
   try:receipt['rollback']=rollback()
   except Exception as nested:receipt['rollback_error']=type(nested).__name__
  RECEIPT.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n')
  print(json.dumps(receipt,ensure_ascii=False))
  sys.exit(0 if receipt['status']=='INSTALLED_SYNTHETIC_PASS' else 1)
