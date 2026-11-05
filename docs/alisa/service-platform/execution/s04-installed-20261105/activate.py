"""Apply only the additive S04 schema, capability and three code pointers."""
import os,sys,pathlib,json,hashlib,subprocess,datetime,time,urllib.request,shutil,re
import psycopg
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s04-access-20261105');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');C=pathlib.Path('/etc/alisa-platform/stage');R='alisa-c8666516683e7b2b';REL=B/'releases'/R;BEFORE=D/'before';OUT=E/'AL_S04_ACTIVATION_20261105.json'
rec={'scope':'S04_ADDITIVE_SCHEMA_AND_CURRENT_SITE_ACTIVATION','status':'RUNNING','cases':[],'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()};mutated=False;guard=None
def check(name,ok):
 rec['cases'].append({'case':name,'passed':bool(ok)});OUT.write_text(json.dumps(rec,indent=2))
 if not ok:raise RuntimeError(name)
def cfg(n):return dict(l.split('=',1) for l in (C/(n+'.env')).read_text().splitlines() if l and not l.startswith('#'))
def command(args,env=None,timeout=60):return subprocess.run(list(map(str,args)),env=env,capture_output=True,check=True,timeout=timeout)
def env(d):return {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',**d}
def connect(d):return psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],connect_timeout=3)
def mark(rows):return hashlib.sha256(json.dumps(rows,default=str).encode()).hexdigest()
def pointers():return {n:(B/n).resolve().name for n in ['admin-current','web-current','site-current','identity-current','current']}
def point(name,release):
 p=B/('.s04-'+name);assert not p.exists();p.symlink_to(B/'releases'/release);os.replace(p,B/name)
def write_platform(raw):
 p=C/'.s04-platform.tmp';assert not p.exists();p.write_bytes(raw);p.chmod(0o600);os.replace(p,C/'platform.env')
def health(expected):
 values={}
 for comp,port in [('web',18100),('admin',18101),('platform',18102),('identity',18103)]:
  for _ in range(100):
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health/ready',timeout=2) as response:v=json.load(response)
    if v.get('release')==expected[comp] and v.get('status')=='READY':values[comp]=v;break
   except OSError:pass
   time.sleep(.2)
  else:raise RuntimeError('health_'+comp)
 return values
def verify_payload(root,m):
 files={};links={}
 for p in root.rglob('*'):
  rel=p.relative_to(root)
  if rel.parts[0]=='.venv':continue
  if p.is_symlink():links[str(rel)]=os.readlink(p)
  elif p.is_file() and str(rel)!='manifest.json':files[str(rel)]=hashlib.sha256(p.read_bytes()).hexdigest()
 return files==m['files'] and links==m['links'] and all((root/n).resolve().is_relative_to(root.resolve()) for n in links)
def run():
 global mutated,guard
 assert not OUT.exists() and not BEFORE.exists();BEFORE.mkdir(mode=0o700);original=None;old=None;newraw=None
 try:
  check('exact_reviewed_binding_file',hashlib.sha256((D/'ci-binding.json').read_bytes()).hexdigest()=='253fee65c06f005e71e9acc76ecc374a251915009e7c50302f96263745353823')
  binding=json.loads((D/'ci-binding.json').read_text());receipt=json.loads((E/'AL_S04_PACKAGE_INSTALL_20261105.json').read_text());raw=(REL/'manifest.json').read_bytes();manifest=json.loads(raw)
  check('exact_package_installed',receipt['status']=='PASS' and all(receipt['binding'].get(k)==binding[k] for k in ['release','source_sha','tar_sha256','manifest_sha256']) and binding['source_sha']=='c8666516683e7b2bedc2c1a7d939e9e3c4489d38' and binding['tar_sha256']=='81c2bd21d8d9eec6e1a0094f8ecb384b394b1061cb3b7650497b9607ee51345e' and binding['manifest_sha256']=='3287fa567545e9598a04e4ba57f7a484814e45195f6cd724bb0532c24b6606f5' and manifest['artifact_id']==R==binding['release'] and manifest['source_sha']==binding['source_sha'] and hashlib.sha256(raw).hexdigest()==binding['manifest_sha256'] and len(manifest['files'])==binding['files']==4433 and len(manifest['links'])==binding['links']==42 and verify_payload(REL,manifest))
  check('qualified_window_active',command(['systemctl','is-active','alisa-s04-qualified-window-20261105g003']).stdout.strip()==b'active')
  old=pointers();rec['old_pointers']=old
  for component,allowed_pointers in [('web',{'web-current','site-current'}),('platform',{'web-current','site-current'}),('admin',{'admin-current'})]:
   effective=command(['systemctl','show','alisa-'+component+'@stage','-p','ExecStart']).stdout.decode()
   roots=re.findall(re.escape(str(B))+r'/([a-z-]+)/infra/launch.py',effective)
   check(component+'_effective_launch_uses_switched_pointer',len(roots)==1 and roots[0] in allowed_pointers)
   cwd=command(['systemctl','show','alisa-'+component+'@stage','--value','-p','WorkingDirectory']).stdout.decode().strip()
   allowed_cwd={str(B/n) for n in allowed_pointers|{'current'}}
   check(component+'_effective_working_directory_own_release',cwd in allowed_cwd and pathlib.Path(cwd).resolve().parent==(B/'releases').resolve())
  allowed={'482ed11832b666af17f879ae710fd43d2c321ce7'}
  check('all_five_pointers_in_exact_current_namespace',all((B/n).is_symlink() and (B/n).resolve().parent==(B/'releases').resolve() and (B/n).resolve().name=='alisa-482ed11832b666af' and json.loads((B/n/'manifest.json').read_text())['source_sha'] in allowed for n in old))
  check('canonical_site_and_current_admin_origin_preserved',cfg('web')['ALISA_PUBLIC_BASE_URL']=='https://alisa.octoport.ru' and cfg('web').get('ALISA_CANONICAL_SITE_ENABLED')=='1' and cfg('admin')['ALISA_ADMIN_BASE_URL']=='https://alisa-admin.octoport.ru')
  check('canonical_auth_flags_and_issuers_preserved',all(cfg(n).get('ALISA_CANONICAL_AUTH_ENABLED')=='1' and cfg(n).get('ALISA_IDENTITY_ISSUER')=='https://id.octoport.ru' for n in ['web','admin','platform']))
  for component in ['web','platform','admin','identity','platform-migration','identity-migration']:
   p=C/(component+'.env');check(component+'_private_root_config',p.stat().st_uid==0 and p.stat().st_mode&0o777==0o600);(BEFORE/p.name).write_bytes(p.read_bytes())
  original=(C/'platform.env').read_bytes();check('s04_capability_not_previously_enabled',cfg('platform').get('ALISA_ENTITLEMENTS_ENABLED','0')=='0')
  files=list(pathlib.Path('/etc/nginx/sites-enabled').glob('*'))+list(pathlib.Path('/etc/systemd/system').glob('alisa-*@stage.service.d/*.conf'));outside={str(p.resolve()):hashlib.sha256(p.resolve().read_bytes()).hexdigest() for p in files if p.is_file()};(BEFORE/'ingress-and-dropin-hashes.private.json').write_text(json.dumps(outside));(BEFORE/'pointers.private.json').write_text(json.dumps(old))
  runtime=cfg('platform');migration=cfg('platform-migration');check('only_own_platform_database_roles',runtime['ALISA_DB_NAME']==migration['ALISA_DB_NAME']=='alisa_stage_platform' and runtime['ALISA_DB_USER']=='alisa_stage_platform_runtime' and migration['ALISA_DB_USER']=='alisa_stage_platform_migration')
  # Keep the existing product staff mutation lock for this short code/schema
  # transition; this never changes authority and prevents handover races.
  guard=connect(runtime);cur=guard.cursor();key=int.from_bytes(hashlib.sha256(b'alisa_market:staff-owner').digest()[:8],'big',signed=True);cur.execute('SELECT pg_advisory_xact_lock(%s)',[key])
  cur.execute('SELECT id,subject,role,active,revision,permissions FROM staff_staffmember ORDER BY id');staff_before=cur.fetchall();rec['staff_authority_before_fingerprint']=mark(staff_before)
  cur.execute('SELECT app,name,applied FROM django_migrations ORDER BY app,name');migration_before=set(cur.fetchall());check('s04_schema_not_previously_applied',not any(r[0]=='entitlements' for r in migration_before))
  pg={k:v for k,v in env(migration).items() if not k.startswith('ALISA_')};pg.update({n:migration[k] for n,k in [('PGHOST','ALISA_DB_HOST'),('PGPORT','ALISA_DB_PORT'),('PGDATABASE','ALISA_DB_NAME'),('PGUSER','ALISA_DB_USER'),('PGPASSWORD','ALISA_DB_PASSWORD')]})
  with (BEFORE/'platform-schema.private.sql').open('wb') as output:
   result=subprocess.run(['/usr/lib/postgresql/16/bin/pg_dump','--schema-only','--no-password'],env=pg,stdout=output,stderr=subprocess.PIPE,check=True,timeout=30)
  mig_env=env(migration);mig_env['ALISA_ENTITLEMENTS_ENABLED']='0';manage=[REL/'.venv/bin/python',REL/'services/platform/manage.py']
  plan=command([*manage,'migrate','entitlements','--plan'],mig_env);(D/'migration-plan.private.log').write_bytes(plan.stdout)
  check('plan_exactly_new_access_migration',re.findall(r'(?m)^([a-z_]+\.[0-9]{4}[_a-z0-9]*)\s*$',plan.stdout.decode())==['entitlements.0001_initial'])
  applied=command([*manage,'migrate','entitlements','--noinput'],mig_env);(D/'migration-apply.private.log').write_bytes(applied.stdout)
  cur.execute("SELECT count(*) FROM django_migrations WHERE app='entitlements' AND name='0001_initial'");check('only_access_migration_applied',cur.fetchone()[0]==1)
  cur.execute('SELECT app,name,applied FROM django_migrations ORDER BY app,name');migration_after=set(cur.fetchall());check('exactly_one_additive_migration_ledger_delta',migration_before<=migration_after and len(migration_after-migration_before)==1 and {(r[0],r[1]) for r in migration_after-migration_before}=={('entitlements','0001_initial')})
  for table in ['accessgrant','accessadjustment','accesspreview']:
   for privilege in ['UPDATE','DELETE','TRUNCATE']:
    cur.execute('SELECT has_table_privilege(current_user,%s,%s)',['entitlements_'+table,privilege]);check(table+'_runtime_'+privilege.lower()+'_denied',not cur.fetchone()[0])
  cur.execute('SELECT count(*) FROM entitlements_accessgrant');check('migration_did_not_issue_customer_access',cur.fetchone()[0]==0)
  check('physical_reserve_before_activation',shutil.disk_usage(B).free//1048576>=3172)
  check('no_config_or_pointer_drift',pointers()==old and all((C/(n+'.env')).read_bytes()==(BEFORE/(n+'.env')).read_bytes() for n in ['web','platform','admin','identity']))
  lines=original.decode().splitlines(keepends=True);found=False;result=[]
  for line in lines:
   if line.startswith('ALISA_ENTITLEMENTS_ENABLED='):result.append('ALISA_ENTITLEMENTS_ENABLED=1\n');found=True
   else:result.append(line)
  newraw=(''.join(result)+('' if found else ('\n' if original and not original.endswith(b'\n') else '')+'ALISA_ENTITLEMENTS_ENABLED=1\n')).encode();write_platform(newraw);mutated=True
  for n in ['web-current','site-current','admin-current']:point(n,R)
  command(['systemctl','restart','alisa-platform@stage','alisa-web@stage','alisa-admin@stage'])
  rec['health']=health({'web':R,'platform':R,'admin':R,'identity':old['identity-current']})
  cur.execute('SELECT id,subject,role,active,revision,permissions FROM staff_staffmember ORDER BY id');check('all_staff_authority_unchanged',cur.fetchall()==staff_before)
  check('identity_and_shared_pointers_preserved',(B/'identity-current').resolve().name==old['identity-current'] and (B/'current').resolve().name==old['current'])
  check('all_ingress_and_dropins_unchanged',all(pathlib.Path(p).exists() and hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==h for p,h in outside.items()))
  check('all_noncapability_config_bytes_preserved',all((C/(n+'.env')).read_bytes()==(BEFORE/(n+'.env')).read_bytes() for n in ['web','admin','identity','platform-migration','identity-migration']) and (C/'platform.env').read_bytes()==newraw)
  for name,url in [('canonical','https://alisa.octoport.ru/health/ready'),('admin','https://alisa-admin.octoport.ru/health/ready')]:
   with urllib.request.urlopen(url,timeout=5) as response:value=json.load(response)
   check(name+'_fresh_public_ready',value.get('status')=='READY' and value.get('release')==R)
  guard.commit();guard.close();guard=None;(D/'active-pointers.private.json').write_text(json.dumps(pointers()));rec['status']='PASS'
 except Exception as error:
  rec['status']='FAILED';rec['error_type']=type(error).__name__;rec['failed_case']=str(error) if isinstance(error,RuntimeError) else None
  if guard:guard.rollback();guard.close();guard=None
  if original is not None and newraw is not None and old is not None:
   now=pointers();current_raw=(C/'platform.env').read_bytes()
   known=all(now[n] in {old[n],R} for n in ['web-current','site-current','admin-current']) and current_raw in {original,newraw}
   known=known and now['identity-current']==old['identity-current'] and now['current']==old['current']
   if known:
    if current_raw==newraw:write_platform(original)
    for n in ['web-current','site-current','admin-current']:
     if now[n]==R:point(n,old[n])
    command(['systemctl','restart','alisa-platform@stage','alisa-web@stage','alisa-admin@stage'])
    rec['recovery_health']=health({'web':old['web-current'],'platform':old['site-current'],'admin':old['admin-current'],'identity':old['identity-current']})
    rec['recovery']='SELF_OWNED_PARTIAL_CODE_CONFIG_RESTORED_ADDITIVE_SCHEMA_RETAINED'
   else:rec['recovery']='UNKNOWN_EXTERNAL_CHANGES_PRESERVED_REQUIRES_READBACK'
 finally:
  rec['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();OUT.write_text(json.dumps(rec,indent=2));print(json.dumps(rec))
 return rec['status']=='PASS'
if __name__=='__main__':sys.exit(0 if run() else 1)
