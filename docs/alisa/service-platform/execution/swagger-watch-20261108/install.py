"""Reviewed exact-CI Swagger-only install; no existing application restart/DB edit."""
import contextlib,fcntl,gzip,hashlib,io,json,os,pathlib,pwd,shutil,signal,socket,stat,subprocess,sys,time,urllib.error,urllib.request,zipfile
P=pathlib.Path;os.umask(0o077);sys.dont_write_bytecode=True
D=P('/var/lib/alisa-platform/stage/rollout-backups/swagger-watch-20261108')
B=P('/opt/alisa-swagger-watch');STATE=P('/var/lib/alisa-swagger-watch')
SOURCE='7cbe3059a83677aeb42a086898a48067918f16a2';RELEASE=SOURCE[:16]
RESERVE=3*1024**3
NGINX=P('/etc/nginx/sites-available/alisa-platform-stage.conf')
INCLUDE=P('/etc/nginx/alisa-swagger-watch-location.conf')
LINE=' include /etc/nginx/alisa-swagger-watch-location.conf;\n'
LOCATION='''location = /health/swagger {
 proxy_pass http://127.0.0.1:18104/health/swagger;
 proxy_connect_timeout 1s;
 proxy_read_timeout 3s;
 proxy_send_timeout 3s;
 proxy_buffering off;
 client_max_body_size 1k;
 limit_except GET { deny all; }
}
'''
UNITS=['alisa-swagger-watch.service','alisa-swagger-watch.timer','alisa-swagger-status.service']
PROTECTED=['alice-market.service','alice-lab-web.service','alice-lab-worker.service','alice-lab-llm.service','alisa-platform@stage.service','alisa-admin@stage.service','alisa-store-check.service','alisa-web@stage.service','alisa-identity@stage.service']
record={'scope':'ISOLATED_SWAGGER_ONLY_NO_EXISTING_PRODUCT_RESTART_OR_DB_MUTATION','status':'FAILED','cases':[]}
def check(name,value):
 record['cases'].append({'case':name,'passed':bool(value)})
 if not value:raise RuntimeError(name)
def sha(b):return hashlib.sha256(b).hexdigest()
def filehash(p):return sha(p.read_bytes())
def present(p):return p.exists() or p.is_symlink()
def command(args,timeout=20):return subprocess.run(args,capture_output=True,text=True,check=True,timeout=timeout).stdout.strip()
def secure(p):
 for x in [*reversed(p.parents),p]:
  s=x.lstat()
  if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_mode&0o022:raise RuntimeError('untrusted_directory')
def private_json(name):
 p=D/name;s=p.lstat();check('private_'+name,stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600);return json.loads(p.read_text())
def snapshot():
 root=P('/opt/alisa-platform/stage')
 return {'pointers':{n:os.readlink(root/n) for n in ['web-current','identity-current','site-current','admin-current','current']},'services':{u:command(['systemctl','show',u,'-p','MainPID,InvocationID,ActiveState']) for u in PROTECTED},'configs':{n:filehash(P('/etc/alisa-platform/stage')/(n+'.env')) for n in ['web','identity','admin','platform','identity-migration','platform-migration']},'nginx_sha256':filehash(NGINX)}
def write_new(path,body,mode=0o600):
 with path.open('xb') as f:f.write(body);f.flush();os.fsync(f.fileno())
 path.chmod(mode)
def replace(path,body,mode=0o644):
 temp=path.with_name(path.name+'.alisa-swagger-install')
 write_new(temp,body,mode);os.replace(temp,path)
def ready():
 out={};opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
 for port in [18100,18101,18102,18103]:
  with opener.open('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as r:out[str(port)]=json.loads(r.read(32768)).get('status')=='READY'
 return out
def verify_package(pins):
 path=D/('package-'+RELEASE+'.zip');s=path.lstat();check('private_package',stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600)
 raw=path.read_bytes();check('exact_ci_zip',len(raw)==pins['zip_size'] and len(raw)<4*1024**2 and sha(raw)==pins['zip_sha256'])
 expected={'cli.mjs','watch.mjs','status.mjs','entry.sh','manifest.json','bundle-inputs.json',*UNITS}
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  check('bounded_exact_zip_members',len(z.infolist())==len(expected) and set(z.namelist())==expected and sum(x.file_size for x in z.infolist())<4*1024**2)
  m=json.loads(z.read('manifest.json'));check('manifest_binding',sha(z.read('manifest.json'))==pins['manifest_sha256'] and m['source_sha']==SOURCE and m['product_id']=='alisa_market' and m['llm_monitoring'] is False and set(m['files'])==expected-{'manifest.json'})
  files={n:z.read(n) for n in expected};check('all_payload_hashes',all(sha(files[n])==h for n,h in m['files'].items()))
 return files
def prepare(pins):
 files=verify_package(pins);before=snapshot()
 check('existing_components_ready',all(ready().values()))
 check('disk_and_memory_admission',shutil.disk_usage(D).free>=RESERVE+sum(map(len,files.values()))+44*1024**2 and next(int(l.split()[1]) for l in P('/proc/meminfo').read_text().splitlines() if l.startswith('MemAvailable:'))>=1536*1024)
 check('fresh_namespace',not present(B) and not present(STATE) and not present(INCLUDE) and all(not present(P('/etc/systemd/system')/u) for u in UNITS))
 try:pwd.getpwnam('alisa-swagger-watch');user_exists=True
 except KeyError:user_exists=False
 check('fresh_service_identity',not user_exists)
 with socket.socket() as s:check('dedicated_status_port_unused',s.connect_ex(('127.0.0.1',18104))!=0)
 B.mkdir(mode=0o755);B.chmod(0o755);(B/'releases').mkdir(mode=0o755);(B/'releases').chmod(0o755);target=B/'releases'/RELEASE;target.mkdir(mode=0o755);target.chmod(0o755)
 for name,body in files.items():write_new(target/name,body,0o755 if name=='entry.sh' else 0o644)
 for name in ['cli.mjs','watch.mjs','status.mjs']:command(['/usr/local/bin/node','--check',str(target/name)])
 command(['runuser','-u','nobody','--','/usr/local/bin/node','--check',str(target/'cli.mjs')])
 check('candidate_node_syntax',True)
 with gzip.GzipFile(fileobj=io.BytesIO(__import__('base64').b64decode((D/'owner-performance.gz.b64').read_text(),validate=True))) as g:owner=g.read(308374)
 check('exact_owner_public_document',len(owner)==308373 and sha(owner)=='c15c0e295a1feefca05a2f3db6c12c11a58bd128206f4e430ab3eea120e60c87')
 write_new(D/'owner-performance.json',owner)
 probe="import {readFile} from 'node:fs/promises';const w=await import(process.argv[1]);const b=await readFile(process.argv[2]);const d=w.documents().find(x=>x.key==='OZON_PERFORMANCE');const v=w.validateDocument(d,b);if(v.inventory.operationCount!==48)throw Error('OWNER_DOCUMENT');console.log(JSON.stringify({operations:v.inventory.operationCount,sha256:w.digest(b)}));"
 qualified=json.loads(command(['/usr/local/bin/node','--input-type=module','-e',probe,str(target/'watch.mjs'),str(D/'owner-performance.json')]))
 check('actual_owner_document_complete_validation',qualified['operations']==48)
 check('prepare_preserves_existing_components',snapshot()==before)
 write_new(D/'baseline.json',json.dumps(before).encode())
 record.update(status='PASS',phase='PREPARED_NOT_ACTIVATED',source_sha=SOURCE,payload_bytes=sum(map(len,files.values())),owner_document=qualified,free_bytes=shutil.disk_usage(D).free)
def activate(pins,resume=False,finalize=False):
 prepared=private_json('prepare.json');before=private_json('baseline.json');check('prepared_exact_source',prepared['status']=='PASS' and prepared['source_sha']==SOURCE)
 check('baseline_unchanged',snapshot()==before);files=verify_package(pins);target=B/'releases'/RELEASE
 check('inactive_payload_exact',all(filehash(target/n)==sha(b) for n,b in files.items()) and ((B/'current').is_symlink() and (B/'current').resolve()==target if resume else not present(B/'current')))
 review=private_json('owner-document-review.json');check('independently_reviewed_owner_document',filehash(D/'owner-document-review.json')=='7be99e1eaedafaceb3d66f4f377518522cd1429dae7616ff0b2d656ef70dd0cc' and review['verdict']=='STRUCTURALLY_ACCEPTABLE_AS_OWNER_SUPPLIED_REVIEW_CANDIDATE' and review['artifact']['sha256']=='c15c0e295a1feefca05a2f3db6c12c11a58bd128206f4e430ab3eea120e60c87')
 changed=False
 try:
  if resume:
   failed=private_json('activate-resume.json' if finalize else 'activate.json');check('known_partial_activation',failed['status']=='FAILED' and failed['error_type']==('JSONDecodeError' if finalize else 'CalledProcessError') and failed.get('recovery')=='OWN_INCLUDE_DETACHED_OWN_SERVICES_STOP_QUEUED_VERIFY_REQUIRED')
   account=pwd.getpwnam('alisa-swagger-watch');incoming=STATE/'incoming';owner=incoming/'performance.json'
   check('partial_service_identity_exact',account.pw_uid==987 and account.pw_gid==981 and account.pw_dir=='/nonexistent' and account.pw_shell=='/usr/sbin/nologin' and os.getgrouplist(account.pw_name,account.pw_gid)==[account.pw_gid])
   own=owner.lstat();check('partial_owner_input_regular_private',stat.S_ISREG(own.st_mode) and own.st_uid==account.pw_uid and stat.S_IMODE(own.st_mode)==0o600)
   expected_names={'incoming','.run.lock','state.json','blobs','inventories','diffs','public'} if finalize else {'incoming'}
   include_ok=INCLUDE.is_file() and not INCLUDE.is_symlink() and INCLUDE.read_text()==LOCATION if finalize else not present(INCLUDE)
   check('partial_state_exact',STATE.stat().st_uid==account.pw_uid and set(x.name for x in STATE.iterdir())==expected_names and set(x.name for x in incoming.iterdir())=={'performance.json'} and filehash(owner)==review['artifact']['sha256'] and include_ok)
   if finalize:
    index=STATE/'state.json';meta=index.lstat();check('reviewed_index_regular_private',stat.S_ISREG(meta.st_mode) and meta.st_uid==account.pw_uid and stat.S_IMODE(meta.st_mode)==0o600 and meta.st_size<1048576)
    state=json.loads(index.read_text());rows=state.get('documents',{});r=rows.get('OZON_PERFORMANCE',{})
    check('known_reviewed_only_state',state.get('product_id')=='alisa_market' and set(rows)=={'OZON_PERFORMANCE'} and r.get('current',{}).get('sha256')==review['artifact']['sha256'] and r.get('current',{}).get('origin')=='OWNER_SUPPLIED_REVIEWED' and 'candidate' not in r and 'last_automatic_success_at' not in r)
   check('partial_units_exact_and_inactive',all(filehash(P('/etc/systemd/system')/u)==sha(files[u]) and command(['systemctl','show',u,'-p','ActiveState','--value'])=='inactive' for u in UNITS))
   for directory in [B,B/'releases',target]:
    s=directory.lstat();check('owned_release_directory_'+directory.name,stat.S_ISDIR(s.st_mode) and s.st_uid==0 and not s.st_mode&0o022);directory.chmod(0o755)
   changed=True
  else:
   command(['useradd','--system','--user-group','--home-dir','/nonexistent','--shell','/usr/sbin/nologin','alisa-swagger-watch']);account=pwd.getpwnam('alisa-swagger-watch')
   STATE.mkdir(mode=0o755);os.chown(STATE,account.pw_uid,account.pw_gid)
   incoming=STATE/'incoming';incoming.mkdir(mode=0o700);os.chown(incoming,account.pw_uid,account.pw_gid)
   owner=incoming/'performance.json';write_new(owner,(D/'owner-performance.json').read_bytes());os.chown(owner,account.pw_uid,account.pw_gid)
   (B/'current').symlink_to(target);changed=True
   for unit in UNITS:write_new(P('/etc/systemd/system')/unit,files[unit],0o644)
  command(['runuser','-u','alisa-swagger-watch','--','/usr/local/bin/node','--check',str(target/'cli.mjs')]);check('actual_service_uid_can_load_candidate',True)
  launcher=str(B/'current/entry.sh')
  if not finalize:
   command(['runuser','-u','alisa-swagger-watch','--',launcher,'import','OZON_PERFORMANCE',str(owner)],timeout=45)
   status=json.loads(command(['runuser','-u','alisa-swagger-watch','--',launcher,'accept-reviewed','OZON_PERFORMANCE',review['artifact']['sha256']],timeout=45))
  else:status=json.loads(command(['runuser','-u','alisa-swagger-watch','--',launcher,'status']))
  perf=next(x for x in status['documents'] if x['key']=='OZON_PERFORMANCE');check('reviewed_document_without_false_freshness',perf['last_good']['origin']=='OWNER_SUPPLIED_REVIEWED' and not perf['fresh'] and perf['last_automatic_success_at'] is None)
  command(['systemctl','daemon-reload']);command(['systemctl','start','alisa-swagger-status.service'])
  op=urllib.request.build_opener(urllib.request.ProxyHandler({}));deadline=time.monotonic()+10
  while True:
   try:
    try:r=op.open('http://127.0.0.1:18104/health/swagger',timeout=2)
    except urllib.error.HTTPError as e:r=e
    with r:local=json.loads(r.read(131072))
    if local.get('product_id')=='alisa_market' and local.get('llm_monitoring') is False:break
   except (OSError,ValueError):pass
   if time.monotonic()>deadline:raise RuntimeError('status_not_ready')
   time.sleep(.2)
  check('read_only_status_running',True)
  old=NGINX.read_bytes();check('nginx_still_exact',sha(old)==before['nginx_sha256'] and old.count(b' server_name alisa.octoport.ru;\n')==1 and LINE.encode() not in old)
  if finalize:check('existing_own_route_backup_exact',(D/'nginx.before.conf').read_bytes()==old and INCLUDE.read_text()==LOCATION)
  else:write_new(D/'nginx.before.conf',old);write_new(INCLUDE,LOCATION.encode(),0o644)
  new=old.replace(b' server_name alisa.octoport.ru;\n',b' server_name alisa.octoport.ru;\n'+LINE.encode(),1)
  replace(NGINX,new);command(['nginx','-t']);command(['systemctl','reload','nginx'])
  # Reload is asynchronous: old workers can briefly return the prior Next 404.
  # Poll only this public read-only route, with a fixed total deadline.
  deadline=time.monotonic()+12;public={}
  while time.monotonic()<deadline:
   try:
    request=urllib.request.Request('https://alisa.octoport.ru/health/swagger',headers={'Connection':'close','Cache-Control':'no-cache'})
    try:r=op.open(request,timeout=2)
    except urllib.error.HTTPError as e:r=e
    with r:public=json.loads(r.read(131072))
    if public.get('scope')=='PUBLIC_OPENAPI_DOCUMENTS_ONLY' and public.get('product_id')=='alisa_market':break
   except (OSError,ValueError):pass
   time.sleep(.2)
  check('public_swagger_status_only',public['scope']=='PUBLIC_OPENAPI_DOCUMENTS_ONLY' and public['product_id']=='alisa_market' and public['llm_monitoring'] is False)
  after=snapshot();check('all_existing_product_services_and_configs_preserved',all(after[k]==before[k] for k in ['pointers','services','configs']))
  check('existing_components_still_ready',all(ready().values()))
  command(['systemctl','enable','--now','alisa-swagger-status.service','alisa-swagger-watch.timer']);command(['systemctl','start','--no-block','alisa-swagger-watch.service'])
  record.update(status='PASS',phase='ACTIVATED',source_sha=SOURCE,new_uid=account.pw_uid,new_gid=account.pw_gid,public_status_url='https://alisa.octoport.ru/health/swagger',nginx_before_sha256=sha(old),nginx_after_sha256=sha(new),existing_product_services_preserved=True,db_mutations=False,owner_login='NOT_RUN',profiles={u:command(['systemctl','show',u,'-p','InvocationID,RuntimeMaxUSec,TimeoutStartUSec,TimeoutStopUSec,MemoryMax,MemorySwapMax,TasksMax,KillMode,ActiveState,SubState']) for u in UNITS})
 except BaseException:
  if changed:
   # Only detach our own exact include; retain unrelated later edits.
   if NGINX.exists() and LINE.encode() in NGINX.read_bytes():replace(NGINX,NGINX.read_bytes().replace(LINE.encode(),b'',1))
   for directory,unit in [('timers.target.wants','alisa-swagger-watch.timer'),('multi-user.target.wants','alisa-swagger-status.service')]:
    link=P('/etc/systemd/system')/directory/unit
    if link.is_symlink() and link.resolve()==P('/etc/systemd/system')/unit:link.unlink()
   subprocess.run(['systemctl','--no-block','stop',*UNITS],capture_output=True,timeout=2)
   subprocess.run(['systemctl','--no-block','reload','nginx'],capture_output=True,timeout=2)
   record['recovery']='OWN_INCLUDE_DETACHED_OWN_SERVICES_STOP_QUEUED_VERIFY_REQUIRED'
  raise
def interrupted(*_):raise InterruptedError('bounded_install_interrupted')
if __name__=='__main__':
 signal.signal(signal.SIGTERM,interrupted);secure(D)
 phase=sys.argv[1] if len(sys.argv)==2 else '';check('allowed_phase',phase in {'prepare','activate','activate-resume','activate-finalize'})
 out=D/(phase+'.json');check('fresh_receipt',not out.exists());pins=private_json('package-binding.json')
 check('qualified_exact_candidate',pins['source_sha']==SOURCE and pins['source_review']=='PASS' and pins['swagger_ci_status']=='success' and pins['platform_ci_status']=='success' and pins['documentation_ci_status']=='success')
 with contextlib.ExitStack() as locks:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']:
   f=locks.enter_context(open('/run/lock/'+n));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:
   if phase=='prepare':prepare(pins)
   else:activate(pins,resume=phase in {'activate-resume','activate-finalize'},finalize=phase=='activate-finalize')
  except BaseException as e:record['error_type']=type(e).__name__;record['failed_case']=str(e) if isinstance(e,RuntimeError) else None
  finally:write_new(out,json.dumps(record,indent=2).encode());print(json.dumps(record))
 sys.exit(0 if record['status']=='PASS' else 1)
