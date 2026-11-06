import os,sys,pathlib,json,datetime,subprocess,urllib.request,urllib.error,importlib.util,hashlib,shutil
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');P=pathlib.Path('/dev/shm/alisa-session-resume-73180172');OUT=pathlib.Path('/var/lib/alisa-platform/stage/evidence/ALISA_ADMIN_SESSION_RESUME_READBACK_20261106.json')
r={'record_type':'INSTALLED_ADMIN_SESSION_RESUME_READBACK','source_sha':'73180172646b7012f1df8026ee8e3b43e8829ce0','status':'RUNNING','checked_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'real_owner_factor_content_read_or_changed':False,'real_owner_login_operated':False,'mfa_or_session_reset':False,'checks':{}}
try:
 d=json.loads(pathlib.Path('/var/lib/alisa-platform/stage/evidence/ALISA_ADMIN_SESSION_RESUME_INSTALL_20261106.json').read_text());assert d['status']=='PASS'
 root=(B/'identity-current').resolve();assert root.name=='alisa-73180172646b7012'
 spec=importlib.util.spec_from_file_location('owned_release',root/'infra/release.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 env=dict(os.environ);env.update(mod.private_config('stage','identity'));env['PYTHONPATH']=str(root/'services/identity/src');env['DJANGO_SETTINGS_MODULE']='octoport_identity.config.settings';env['PYTHONDONTWRITEBYTECODE']='1'
 user=subprocess.check_output(['systemctl','show','alisa-identity@stage.service','-p','User','--value'],text=True).strip()
 child=pathlib.Path('/dev/shm/alisa-session-resume-readback-child.py').read_text()
 cp=subprocess.run(['runuser','-u',user,'--',root/'.venv/bin/python','-c',child],env=env,text=True,capture_output=True,timeout=25)
 if cp.returncode:
  r['loaded_check_exit']=cp.returncode
  r['loaded_check_stderr_present']=bool(cp.stderr)
  raise RuntimeError('loaded_code_check_failed')
 r['loaded_code']=json.loads(cp.stdout);r['checks']['loaded_code']=True
 class NoRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self,*args):return None
 op=urllib.request.build_opener(NoRedirect)
 r['anonymous_https']={}
 for name,url in [('admin_root','https://alisa-admin.octoport.ru/'),('admin_dashboard','https://alisa-admin.octoport.ru/admin'),('admin_login','https://alisa-admin.octoport.ru/login'),('identity_login','https://id.octoport.ru/accounts/login/'),('product','https://alisa.octoport.ru/')]:
  try:resp=op.open(urllib.request.Request(url,headers={'User-Agent':'Alisa-session-resume-readback'}),timeout=10)
  except urllib.error.HTTPError as e:resp=e
  body=resp.read().decode(errors='replace');status=resp.code;location=resp.headers.get('Location','')
  r['anonymous_https'][name]={'status':status,'location':location,'cache_control':resp.headers.get('Cache-Control','')}
  if name=='admin_root':assert status in [302,303,307,308] and location.endswith('/admin')
  elif name=='admin_dashboard':assert status in [302,303,307,308] and '/login' in location
  elif name=='admin_login':assert status==200 and '/auth/start' in body
  else:assert status==200
 r['checks']['canonical_anonymous_routes']=True
 r['ready']=mod.readback('stage')
 assert {k:v['release'] for k,v in r['ready'].items()}=={'web':'alisa-c8666516683e7b2b','platform':'alisa-c8666516683e7b2b','admin':root.name,'identity':root.name}
 r['checks']['component_versions']=True
 artifact=P/'package'/f'{root.name}.tar.gz';A=pathlib.Path('/var/lib/alisa-platform/stage/artifacts')
 assert shutil.disk_usage(B).free>=3072*1048576+artifact.stat().st_size+32*1048576
 for src in [artifact,artifact.with_name(artifact.name+'.sha256')]:
  target=A/src.name
  if target.exists():assert hashlib.sha256(target.read_bytes()).digest()==hashlib.sha256(src.read_bytes()).digest()
  else:shutil.copyfile(src,target)
 r['checks']['exact_archive_retained']=True
 r['disk_free_after_archive_bytes']=shutil.disk_usage(B).free;assert r['disk_free_after_archive_bytes']>=3072*1048576
 r['checks']['resource_reserve']=True
 r['status']='PASS'
except Exception as e:
 r['status']='FAILED';r['error_type']=type(e).__name__;r['failed_check']=str(e) if isinstance(e,RuntimeError) else None
finally:
 OUT.write_text(json.dumps(r,indent=2));print(json.dumps(r))
sys.exit(0 if r['status']=='PASS' else 1)
