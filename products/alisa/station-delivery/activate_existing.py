"""Resume the exact staged candidate after a successful rollback of early readiness."""
import contextlib,fcntl,hashlib,json,shutil,time
from pathlib import Path
import install as I

def ready(path,host,wanted):
 statuses=[];until=time.monotonic()+12
 while time.monotonic()<until:
  try:
   status=I.health(path,host);statuses.append(status)
   if status==wanted:return statuses
  except (OSError,TimeoutError):statuses.append('starting')
  time.sleep(.15)
 raise RuntimeError('http_not_ready_'+str(statuses[-5:]))

def main():
 previous=json.loads(I.RECEIPT.read_text())
 I.check('previous_tests_pass',any(c['check']=='installed_baseline_31_tests' and c['passed'] for c in previous['checks']))
 I.check('previous_rollback_completed',previous.get('rollback')=='OWN_OVERRIDES_REMOVED_CURRENT_BASELINE_RESTORED_NO_DB_RESTORE')
 I.check('baseline_unchanged',all(I.argv(u)==v for u,v in I.OLD.items()) and I.tree_hash(I.BASE)==previous['baseline_tree_sha256'])
 I.check('staged_files_exact',all(I.sha(p)==I.sha(I.SOURCE/p.name) for p in I.ROOT.iterdir() if p.is_file() and p.name!='manifest.json'))
 I.check('overlay_manifest_exact',all(I.sha(I.RUNTIME/p)==h for p,h in json.loads((I.RUNTIME/'manifest.json').read_text())['files'].items()))
 I.check('no_override_collision',not any(p.exists() for p in I.DROPS.values()))
 I.check('reserve',shutil.disk_usage('/').free>=3072*1048576)
 I.idle()
 I.nginx_before=I.NGINX.read_text();needle=' server_name alisa-admin.octoport.ru;'
 I.check('admin_route_new',I.nginx_before.count(needle)==1 and 'include /etc/nginx/alisa-station-location.conf;' not in I.nginx_before)
 I.nginx_after=I.nginx_before.replace(needle,needle+'\n include /etc/nginx/alisa-station-location.conf;')
 I.cutover=True
 I.run(['systemctl','stop','alice-lab-web']);I.idle();I.run(['systemctl','stop','alice-market']);I.idle()
 I.check('stopped_baseline_current',all(I.argv(u)==v for u,v in I.OLD.items()) and I.tree_hash(I.BASE)==previous['baseline_tree_sha256'])
 for unit,path in I.DROPS.items():
  wd=I.RUNTIME if unit=='alice-market' else I.ROOT
  I.write(path,f'[Service]\nWorkingDirectory={wd}\nExecStart=\nExecStart={I.NEW[unit]}\n')
 I.run(['systemctl','daemon-reload']);I.check('exact_launch',all(I.argv(u)==a for u,a in I.NEW.items()))
 I.run(['systemctl','start','alice-market','alisa-station','alice-lab-web'])
 I.check('nginx_unchanged_before_write',I.NGINX.read_text()==I.nginx_before)
 I.NGINX.write_text(I.nginx_after);I.run(['nginx','-t']);I.run(['systemctl','reload','nginx'])
 I.receipt['http_readiness_statuses']=ready('/admin/station/','alisa-admin.octoport.ru',303)
 I.check('admin_auth_wall',True)
 I.check('cross_origin_denied',I.health('/admin/station/api','alisa-admin.octoport.ru',method='POST',headers={'Origin':'https://invalid.test'})==403)
 I.receipt['lab_readiness_statuses']=ready('/healthz','alice-lab.octoport.ru',200)
 I.check('services_active',all(I.prop(u,'ActiveState')=='active' for u in [*I.NEW,'alisa-station']))
 old=I.prop('alisa-station','MainPID');I.run(['systemctl','restart','alisa-station'])
 ready('/admin/station/','alisa-admin.octoport.ru',303)
 I.check('restart_socket_and_http_ready',I.prop('alisa-station','MainPID')!=old and Path('/run/alisa-station/ingress.sock').exists())
 state=json.loads((I.STATE/'state.json').read_text())
 I.check('settings_persisted',state['settings']['interval_seconds']==10 and state['settings']['enabled'] is True and state['settings']['manual_command']=='результат')
 I.check('reserve_retained',shutil.disk_usage('/').free>=3072*1048576)
 I.run(['systemctl','enable','alisa-station'])
 I.receipt.update(status='INSTALLED_SYNTHETIC_PASS',tests_passed=31,baseline=str(I.BASE),baseline_tree_sha256=previous['baseline_tree_sha256'],runtime=str(I.RUNTIME),url='https://alisa-admin.octoport.ru/admin/station/',code_sha256={p.name:I.sha(p) for p in I.ROOT.iterdir() if p.is_file()},physical_acceptance=False)

if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for name in I.LOCKS:
   f=stack.enter_context(open('/run/lock/'+name,'a'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as e:
   I.receipt['error']=str(e) if isinstance(e,RuntimeError) else type(e).__name__
   try:I.receipt['rollback']=I.rollback()
   except Exception as nested:I.receipt['rollback_error']=type(nested).__name__
  I.RECEIPT.write_text(json.dumps(I.receipt,ensure_ascii=False,indent=2)+'\n');print(json.dumps(I.receipt,ensure_ascii=False))
  raise SystemExit(0 if I.receipt['status']=='INSTALLED_SYNTHETIC_PASS' else 1)
