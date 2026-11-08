"""Finite additive move of personal Station connection to authenticated site cabinet."""
import contextlib,fcntl,hashlib,json,os,shutil,subprocess,sys,time
from pathlib import Path
sys.dont_write_bytecode=True
SRC=Path('/run/alisa-station-r2');DEST=Path('/opt/alisa-station/releases/station-auto-r2')
OLD=Path('/opt/alisa-station/releases/station-auto-r1')
BASE=Path('/etc/nginx/sites-enabled/alisa-platform-stage.conf')
INCLUDE=Path('/etc/nginx/alisa-station-site-location.conf')
ENV=Path('/etc/alisa-station/site.env')
DROP=Path('/etc/systemd/system/alisa-station.service.d/99-site-r2.conf')
STATE=Path('/var/lib/alisa-station/state.json')
RECEIPT=Path('/run/alisa-station-site-r2.json')
OLD_COMMAND=f'/usr/bin/python3 -B {OLD}/service.py --state /var/lib/alisa-station --key /run/credentials/alisa-station.service/station-key'
NEW_COMMAND=f'/usr/bin/python3 -B {DEST}/service.py --state /var/lib/alisa-station --key /run/credentials/alisa-station.service/station-key'
checks=[];created=False;nginx_before='';nginx_after='';status='FAILED'
def run(args,timeout=40):return subprocess.run([str(a) for a in args],capture_output=True,check=True,timeout=timeout).stdout.decode()
def prop(name):return run(['systemctl','show','alisa-station','--value','--property='+name],5).strip()
def argv():return prop('ExecStart').split('argv[]=',1)[1].split(' ;',1)[0]
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(label,ok):
 checks.append({'check':label,'passed':bool(ok)})
 if not ok:raise RuntimeError(label)
def write(path,value,mode=0o644):
 with path.open('x') as f:f.write(value);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),mode)
def health(host,path,method='GET',origin=None):
 import http.client
 c=http.client.HTTPSConnection('127.0.0.1',timeout=3,context=__import__('ssl')._create_unverified_context())
 try:
  c.request(method,path,headers={'Host':host,**({'Origin':origin} if origin else {})});r=c.getresponse();r.read();return r.status,r.getheader('Location')
 finally:c.close()
def await_health(host,path,wanted):
 deadline=time.monotonic()+12
 while time.monotonic()<deadline:
  try:
   status,_=health(host,path)
   if status==wanted:return True
  except (OSError,TimeoutError):pass
  time.sleep(.15)
 return False
def main():
 global created,nginx_before,nginx_after,status
 check('root',os.geteuid()==0)
 check('old_active',prop('ActiveState')=='active' and argv()==OLD_COMMAND)
 check('new_paths',not any(p.exists() for p in [DEST,INCLUDE,ENV,DROP]))
 check('no_existing_connection',not json.loads(STATE.read_text())['connected'])
 check('reserve',shutil.disk_usage('/').free>=3072*1048576+550000)
 pin={p.name:sha(p) for p in SRC.iterdir() if p.is_file() and p.suffix in ('.py','.js','.css','.html','.md','.json')}
 check('source_present',all(n in pin for n in ['service.py','index-site.html','index-admin.html','app-admin.js','test_boundaries.py']))
 current=Path('/opt/alice-market/releases/alisa-runtime-promotions-station-r1-20261108')
 check('current_market_runtime', '/alisa-runtime-promotions-station-r1-20261108/' in run(['systemctl','show','alice-market','--value','--property=ExecStart'],5))
 testenv=dict(os.environ,PYTHONPATH=str(current)+':'+str(SRC),ALISA_TEST_RUNTIME=str(current),TMPDIR='/run',PYTHONDONTWRITEBYTECODE='1')
 test=subprocess.run(['/usr/bin/python3','-B','-m','unittest','test_delivery','test_boundaries','test_runtime_delivery'],cwd=SRC,env=testenv,capture_output=True,timeout=40)
 check('36_current_runtime_tests',test.returncode==0 and b'Ran 36 tests' in test.stderr)
 check('source_unchanged_after_tests',all(sha(SRC/n)==h for n,h in pin.items()))
 nginx_before=BASE.read_text();marker=' server_name alisa.octoport.ru;'
 check('site_nginx_marker',nginx_before.count(marker)==1 and 'alisa-station-site-location.conf' not in nginx_before)
 nginx_after=nginx_before.replace(marker,marker+'\n include /etc/nginx/alisa-station-site-location.conf;')
 web_lines=Path('/etc/alisa-platform/stage/web.env').read_text().splitlines()
 token_lines=[x for x in web_lines if x.startswith('ALISA_AUTH_SERVICE_TOKEN=')]
 check('account_service_key',len(token_lines)==1)
 check('fresh_pre_cutover',argv()==OLD_COMMAND and BASE.read_text()==nginx_before and not json.loads(STATE.read_text())['connected'])
 shutil.copytree(SRC,DEST,ignore=shutil.ignore_patterns('__pycache__','test_*.py','activate_*.py'))
 check('package_exact',all(sha(DEST/n)==v for n,v in pin.items() if (DEST/n).exists()))
 write(ENV,token_lines[0]+'\n',0o600)
 write(INCLUDE,'''location ^~ /app/station/ {
 proxy_pass http://127.0.0.1:8777;
 proxy_set_header Host $host;
 proxy_set_header X-Forwarded-Proto https;
 proxy_read_timeout 35s;
 proxy_send_timeout 10s;
 access_log off;
}
''')
 DROP.parent.mkdir(exist_ok=True)
 write(DROP,f'[Service]\nWorkingDirectory={DEST}\nExecStart=\nExecStart={NEW_COMMAND}\nEnvironmentFile={ENV}\n')
 created=True
 run(['systemctl','daemon-reload']);check('exact_new_launch',argv()==NEW_COMMAND)
 run(['systemctl','restart','alisa-station'])
 check('service_http_ready',await_health('alisa-admin.octoport.ru','/admin/station/',303))
 check('nginx_cas',BASE.read_text()==nginx_before)
 BASE.write_text(nginx_after);run(['nginx','-t']);run(['systemctl','reload','nginx'])
 check('site_auth_wall',await_health('alisa.octoport.ru','/app/station/',303))
 check('admin_auth_wall',await_health('alisa-admin.octoport.ru','/admin/station/',303))
 check('foreign_origin_denied',health('alisa.octoport.ru','/app/station/api','POST','https://invalid.test')[0]==403)
 check('settings_preserved',json.loads(STATE.read_text())['settings']['interval_seconds']==10)
 check('old_service_untouched',argv()==NEW_COMMAND and prop('ActiveState')=='active')
 check('disk_reserve',shutil.disk_usage('/').free>=3072*1048576)
 status='INSTALLED_SYNTHETIC_PASS'
def rollback():
 if not created:return 'NO_CUTOVER'
 if argv() not in (OLD_COMMAND,NEW_COMMAND):
  if prop('ActiveState') in ('inactive','failed'):run(['systemctl','start','alisa-station'])
  return 'FOREIGN_CHANGE_PRESERVED'
 if DROP.exists() and NEW_COMMAND in DROP.read_text():DROP.unlink()
 if nginx_after and BASE.read_text()==nginx_after:BASE.write_text(nginx_before);run(['nginx','-t']);run(['systemctl','reload','nginx'])
 run(['systemctl','daemon-reload']);run(['systemctl','restart','alisa-station'])
 return 'R1_RESTORED_NO_STATE_RESTORE'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for name in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+name,'a'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as e:
   error=str(e) if isinstance(e,RuntimeError) else type(e).__name__
   try:rollback_result=rollback()
   except Exception as inner:rollback_result='FAILED_'+type(inner).__name__
  result={'status':status,'checks':checks,'active_service':str(DEST) if status=='INSTALLED_SYNTHETIC_PASS' else str(OLD),'physical_owner_acceptance':False,'error':locals().get('error'),'rollback':locals().get('rollback_result')}
  RECEIPT.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps(result,ensure_ascii=False))
  sys.exit(0 if status=='INSTALLED_SYNTHETIC_PASS' else 1)
