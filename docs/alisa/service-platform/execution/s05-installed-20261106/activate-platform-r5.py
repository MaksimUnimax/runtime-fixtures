"""Finite stores-only schema/vault rollout; preserve current Identity and admin."""
import contextlib,fcntl,grp,hashlib,json,os,pathlib,pwd,re,shutil,stat,subprocess,sys,time,urllib.request
import psycopg
from cryptography.fernet import Fernet
sys.dont_write_bytecode=True;os.umask(0o077)
B=pathlib.Path('/opt/alisa-platform/stage');D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s05-stores-20261106');C=pathlib.Path('/etc/alisa-platform/stage')
R='alisa-6098b31384ae23a4';REL=B/'releases'/R;OUT=D/'platform-activation.json';BEFORE=D/'activation-before'
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
rec={'scope':'STORES_ADDITIVE_SCHEMA_VAULT_AND_WEB_PLATFORM_ACTIVATION_NOT_LIVE_PROVIDER','status':'FAILED','cases':[]};guard=None;old=None;original=None;newraw=None;mutated=False
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(n,v):
 rec['cases'].append({'case':n,'passed':bool(v)})
 if not v:raise RuntimeError(n)
def cfg(n):return dict(l.split('=',1) for l in (C/(n+'.env')).read_text().splitlines() if l and not l.startswith('#'))
def env(d):return {'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','LANG':'C.UTF-8','PYTHONDONTWRITEBYTECODE':'1',**d}
def command(args,e=None,timeout=60):return subprocess.run(list(map(str,args)),env=e,capture_output=True,check=True,timeout=timeout)
def connect(d):return psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],connect_timeout=3)
def mark(rows):return hashlib.sha256(json.dumps(rows,default=str).encode()).hexdigest()
PROPERTIES='User,Group,Environment,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,TasksMax,TimeoutStopUSec,KillMode'
def profile(unit):return dict(l.split('=',1) for l in command(['systemctl','show',unit,'--property='+PROPERTIES]).stdout.decode().splitlines() if '=' in l)
def argv(unit):
 raw=command(['systemctl','show',unit,'--value','--property=ExecStart']).stdout.decode();m=re.search(r'argv\[\]=(.*?) ;',raw);return m.group(1) if m else None
def actual(unit,directory,uid):
 pid=int(command(['systemctl','show',unit,'--value','--property=MainPID']).stdout)
 check(unit+'_actual_process',pid>0 and pathlib.Path('/proc',str(pid),'cwd').resolve()==directory and int(next(l.split()[1] for l in pathlib.Path('/proc',str(pid),'status').read_text().splitlines() if l.startswith('Uid:')))==uid and unit in pathlib.Path('/proc',str(pid),'cgroup').read_text())
def pointers():return {n:(B/n).resolve().name for n in ['web-current','site-current','admin-current','identity-current','current']}
def point(n,r):
 p=B/('.s05-'+n);assert not p.exists() and not p.is_symlink();p.symlink_to(B/'releases'/r);os.replace(p,B/n)
def write_config(raw):
 p=C/'.s05-platform.tmp';assert not p.exists();p.write_bytes(raw);p.chmod(0o600);os.replace(p,C/'platform.env')
def health(expected):
 result={}
 for comp,port in [('web',18100),('platform',18102),('admin',18101),('identity',18103)]:
  for _ in range(60):
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as response:r=json.load(response)
    if r.get('status')=='READY' and r.get('release')==expected[comp]:result[comp]=r;break
   except OSError:pass
   time.sleep(.2)
  else:raise RuntimeError('health_'+comp)
 return result
def main():
 global guard,old,original,newraw,mutated
 check('exact_inactive_platform_installed',json.loads((D/'platform-install-r3.json').read_text())['status']=='PASS' and digest(REL/'manifest.json')=='a181fef7c03637badef896f9a2a675f40d533a4ad767dbc9b23426769378578c')
 m=json.loads((REL/'manifest.json').read_text());files={};links={}
 for p in REL.rglob('*'):
  n=p.relative_to(REL)
  if n.parts[0]=='.venv':continue
  if p.is_symlink():links[str(n)]=os.readlink(p)
  elif p.is_file() and str(n)!='manifest.json':files[str(n)]=digest(p)
 check('full_installed_payload_unchanged',files==m['files'] and links==m['links'])
 core=json.loads((D/'core-activation-r4.json').read_text());newcore=pathlib.Path('/opt/alice-market/releases/20261106-store-check-6098-r1')
 check('qualified_core_and_checker_active',core['status']=='PASS' and command(['systemctl','is-active','alisa-store-check.service']).stdout.strip()==b'active' and argv('alice-market.service')==f'/usr/bin/python3 -B {newcore}/runtime.py --config /etc/alice-market/market-runtime.json' and command(['systemctl','show','alice-market.service','--value','--property=WorkingDirectory']).stdout.decode().strip()==str(newcore))
 check('exact_active_core_units_and_profile',all(digest(pathlib.Path(p))==h for p,h in core['installed_unit_hashes'].items()) and digest(newcore/'S05_INTEGRATION_MANIFEST.json')==core['integration_manifest_sha256'] and hashlib.sha256(json.dumps(profile('alice-market.service'),sort_keys=True).encode()).hexdigest()==core['inherited_profile_sha256'])
 actual('alice-market.service',newcore,996)
 sock=pathlib.Path('/run/alice-market/store-check.sock').lstat();check('private_checker_socket',stat.S_ISSOCK(sock.st_mode) and sock.st_uid==996 and sock.st_gid==grp.getgrnam('alisa-store-check').gr_gid and stat.S_IMODE(sock.st_mode)==0o660)
 check('disk_and_inode_reserve',shutil.disk_usage(B).free>=3072*1048576+8*1048576 and os.statvfs(B).f_favail>=200000)
 old=pointers();rec['before_pointers']=old
 check('fresh_own_pointers_foreign_versions_snapshotted',all(old[n]==r for n,r in {'web-current':'alisa-c8666516683e7b2b','site-current':'alisa-c8666516683e7b2b','current':'alisa-482ed11832b666af'}.items()) and all((B/n).is_symlink() and (B/n).resolve().parent==(B/'releases').resolve() for n in ['admin-current','identity-current']))
 current_identity=json.loads((B/'identity-current/manifest.json').read_text());check('current_identity_auth_contracts_compatible',all(current_identity['contracts'][n]==m['contracts'][n] and digest(B/'identity-current'/n)==m['contracts'][n] for n in ['contracts/auth-flow-v1.json','contracts/auth-session-v1.json']))
 rec['health_before']=health({'web':old['web-current'],'platform':old['site-current'],'admin':old['admin-current'],'identity':old['identity-current']})
 inherited={}
 for comp,pointer in [('web','web-current'),('platform','site-current')]:
  value=command(['systemctl','show','alisa-'+comp+'@stage.service','--property=ExecStart,WorkingDirectory']).stdout.decode()
  check(comp+'_effective_own_pointer',str(B/pointer)+'/infra/launch.py' in value and 'WorkingDirectory='+str(B/pointer)+'\n' in value)
  unit='alisa-'+comp+'@stage.service';inherited[comp]=profile(unit);check(comp+'_effective_identity_and_environment',inherited[comp]['User']==inherited[comp]['Group']=='alisa-'+comp+'-stage' and str(C/(comp+'.env')) in inherited[comp]['EnvironmentFiles'] and not inherited[comp]['LoadCredential'] and argv(unit)==f'{B/pointer}/.venv/bin/python {B/pointer}/infra/launch.py {comp}')
  actual(unit,(B/pointer).resolve()/('ui/web' if comp=='web' else ''),pwd.getpwnam('alisa-'+comp+'-stage').pw_uid)
 check('private_backup_parent',D.stat().st_uid==0 and stat.S_IMODE(D.stat().st_mode)==0o700 and not D.is_symlink())
 BEFORE.mkdir(mode=0o700)
 for n in ['web','platform','admin','identity','platform-migration','identity-migration']:
  p=C/(n+'.env');check(n+'_private_root_config',p.stat().st_uid==0 and p.stat().st_mode&0o777==0o600);(BEFORE/p.name).write_bytes(p.read_bytes())
 original=(C/'platform.env').read_bytes();runtime=cfg('platform');migration=cfg('platform-migration')
 check('own_platform_roles',runtime['ALISA_DB_NAME']==migration['ALISA_DB_NAME']=='alisa_stage_platform' and runtime['ALISA_DB_USER']=='alisa_stage_platform_runtime' and migration['ALISA_DB_USER']=='alisa_stage_platform_migration')
 check('new_store_configuration_only',not set(runtime)&{'ALISA_STORES_ENABLED','ALISA_STORE_DATA_KEYS','ALISA_STORE_CHECK_SOCKET','ALISA_STORE_CHECK_UID'} and runtime.get('ALISA_ENTITLEMENTS_ENABLED')=='1')
 check('canonical_identity_unchanged',all(cfg(n).get('ALISA_IDENTITY_ISSUER')=='https://id.octoport.ru' and cfg(n).get('ALISA_CANONICAL_AUTH_ENABLED')=='1' for n in ['web','platform','admin']))
 guard=connect(runtime);cur=guard.cursor();cur.execute('SELECT pg_advisory_xact_lock(%s)',[int.from_bytes(hashlib.sha256(b'alisa_market:staff-owner').digest()[:8],'big',signed=True)])
 cur.execute('SELECT id,subject,role,active,revision,permissions FROM staff_staffmember ORDER BY id');authority=cur.fetchall();rec['authority_fingerprint_before']=mark(authority)
 cur.execute('SELECT app,name,applied FROM django_migrations ORDER BY app,name');before=set(cur.fetchall());check('stores_schema_not_applied',not any(r[0]=='stores' for r in before))
 pg={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8',**{n:migration[k] for n,k in [('PGHOST','ALISA_DB_HOST'),('PGPORT','ALISA_DB_PORT'),('PGDATABASE','ALISA_DB_NAME'),('PGUSER','ALISA_DB_USER'),('PGPASSWORD','ALISA_DB_PASSWORD')]}}
 with (BEFORE/'platform-schema.private.sql').open('wb') as output:subprocess.run(['/usr/lib/postgresql/16/bin/pg_dump','--schema-only','--no-password'],env=pg,stdout=output,stderr=subprocess.PIPE,check=True,timeout=30)
 e=env(migration);e['ALISA_STORES_ENABLED']='0';manage=[REL/'.venv/bin/python','-B',REL/'services/platform/manage.py']
 plan=command([*manage,'migrate','stores','--plan'],e);(D/'stores-migration-plan.private.log').write_bytes(plan.stdout)
 check('exact_stores_only_migration_plan',re.findall(r'(?m)^([a-z_]+\.[0-9]{4}[_a-z0-9]*)\s*$',plan.stdout.decode())==['stores.0001_initial'])
 applied=command([*manage,'migrate','stores','--noinput'],e);(D/'stores-migration-apply.private.log').write_bytes(applied.stdout)
 cur.execute('SELECT app,name,applied FROM django_migrations ORDER BY app,name');after=set(cur.fetchall());check('exact_additive_ledger_delta',before<=after and len(after-before)==1 and {(r[0],r[1]) for r in after-before}=={('stores','0001_initial')})
 for privilege in ['UPDATE','DELETE','TRUNCATE']:
  cur.execute('SELECT has_table_privilege(current_user,%s,%s)',['stores_storeaudit',privilege]);check('audit_'+privilege.lower()+'_denied',not cur.fetchone()[0])
 check('all_original_config_and_pointers_unchanged',pointers()==old and all((C/(n+'.env')).read_bytes()==(BEFORE/(n+'.env')).read_bytes() for n in ['web','platform','admin','identity']))
 newraw=original+(b'' if original.endswith(b'\n') else b'\n')+('ALISA_STORES_ENABLED=1\nALISA_STORE_DATA_KEYS='+Fernet.generate_key().decode()+'\nALISA_STORE_CHECK_SOCKET=/run/alice-market/store-check.sock\nALISA_STORE_CHECK_UID=996\n').encode()
 # Retain the private new keyring on every outcome, including capability rollback.
 (BEFORE/'platform-with-vault.private.env').write_bytes(newraw);write_config(newraw);mutated=True
 for n in ['web-current','site-current']:point(n,R)
 command(['systemctl','restart','alisa-platform@stage.service','alisa-web@stage.service'])
 rec['health']=health({'web':R,'platform':R,'admin':old['admin-current'],'identity':old['identity-current']})
 for comp in ['web','platform']:
  unit='alisa-'+comp+'@stage.service';check(comp+'_inherited_service_properties_preserved',profile(unit)==inherited[comp]);actual(unit,REL/('ui/web' if comp=='web' else ''),pwd.getpwnam('alisa-'+comp+'-stage').pw_uid)
 cur.execute('SELECT id,subject,role,active,revision,permissions FROM staff_staffmember ORDER BY id');check('staff_authority_unchanged',cur.fetchall()==authority)
 check('identity_admin_shared_pointers_preserved',all(pointers()[n]==old[n] for n in ['admin-current','identity-current','current']))
 check('all_nonstore_config_bytes_preserved',all((C/(n+'.env')).read_bytes()==(BEFORE/(n+'.env')).read_bytes() for n in ['web','admin','identity','platform-migration','identity-migration']) and (C/'platform.env').read_bytes()==newraw)
 pid=int(command(['systemctl','show','alisa-platform@stage.service','--value','--property=MainPID']).stdout);groups=next(l.split(':')[1].split() for l in pathlib.Path('/proc',str(pid),'status').read_text().splitlines() if l.startswith('Groups:'))
 check('platform_effective_private_socket_group',str(grp.getgrnam('alisa-store-check').gr_gid) in groups)
 check('disk_reserve_after_activation',shutil.disk_usage(B).free>=3072*1048576)
 guard.commit();guard.close();guard=None;rec['status']='PASS';rec['active_pointers']=pointers()
def recover():
 if not mutated:return 'NO_CODE_OR_CAPABILITY_CHANGE_ADDITIVE_SCHEMA_RETAINED'
 now=pointers();raw=(C/'platform.env').read_bytes()
 if not (all(now[n] in {old[n],R} for n in ['web-current','site-current']) and all(now[n]==old[n] for n in ['admin-current','identity-current','current']) and raw in {original,newraw}):return 'UNKNOWN_EXTERNAL_CHANGE_PRESERVED'
 if raw==newraw:write_config(original)
 for n in ['web-current','site-current']:
  if now[n]==R:point(n,old[n])
 command(['systemctl','restart','alisa-platform@stage.service','alisa-web@stage.service']);rec['recovery_health']=health({'web':old['web-current'],'platform':old['site-current'],'admin':old['admin-current'],'identity':old['identity-current']})
 return 'OWN_CODE_CONFIG_RESTORED_ADDITIVE_SCHEMA_AND_PRIVATE_KEYRING_RETAINED'
if __name__=='__main__':
 if OUT.exists() or BEFORE.exists():raise SystemExit('Existing outcome preserved; inspect before resume')
 with contextlib.ExitStack() as stack:
  for name in LOCKS:
   f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as error:
   rec['error_type']=type(error).__name__
   if guard:guard.rollback();guard.close();guard=None
   try:rec['recovery']=recover()
   except Exception as recovery:rec['recovery_error_type']=type(recovery).__name__
  finally:OUT.write_text(json.dumps(rec,indent=2)+'\n');print(json.dumps(rec))
 sys.exit(0 if rec['status']=='PASS' else 1)
