"""Finite exact core cutover and private checker unit; no platform DB/config."""
import contextlib,fcntl,grp,hashlib,json,os,pathlib,pwd,re,shutil,sqlite3,stat,subprocess,sys,tempfile,time
sys.dont_write_bytecode=True;os.umask(0o077)
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s05-stores-20261106');OUT=D/'core-activation-r3.json'
OLD=pathlib.Path('/opt/alice-market/releases/20261105-v010-number-reason-r1');NEW=OLD.parent/'20261106-store-check-6098-r1'
SYSTEM=pathlib.Path('/etc/systemd/system');UNIT=SYSTEM/'alisa-store-check.service';DROP=SYSTEM/'alice-market.service.d/zzzzzzzzzzzzzzzz-s05-store-check.conf';PDROP=SYSTEM/'alisa-platform@stage.service.d/s05-store-check.conf'
CORE_DROP=f'[Service]\nWorkingDirectory={NEW}\nExecStart=\nExecStart=/usr/bin/python3 -B {NEW}/runtime.py --config /etc/alice-market/market-runtime.json\n'
PLATFORM_DROP='[Service]\nSupplementaryGroups=alisa-store-check\n'
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
rec={'scope':'CURRENT_CORE_AND_PRIVATE_CHECKER_ACTIVATION_NO_PLATFORM_DB_OR_CONFIG','status':'FAILED','cases':[]};made=[];changed=False
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def check(n,v):
 rec['cases'].append({'case':n,'passed':bool(v)})
 if not v:raise RuntimeError(n)
def command(*args):return subprocess.run(list(map(str,args)),capture_output=True,check=True,timeout=60)
def cwd():return command('systemctl','show','alice-market.service','--value','--property=WorkingDirectory').stdout.decode().strip()
def pointers():return {n:pathlib.Path('/opt/alisa-platform/stage',n).resolve().name for n in ['web-current','site-current','admin-current','identity-current','current']}
PROPERTIES='User,Group,Environment,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,TasksMax,TimeoutStopUSec,KillMode'
def profile(unit):return dict(l.split('=',1) for l in command('systemctl','show',unit,'--property='+PROPERTIES).stdout.decode().splitlines() if '=' in l)
def actual(unit,directory,uid):
 pid=int(command('systemctl','show',unit,'--value','--property=MainPID').stdout)
 check(unit+'_actual_pid',pid>0 and pathlib.Path('/proc',str(pid),'cwd').resolve()==directory and int(next(l.split()[1] for l in pathlib.Path('/proc',str(pid),'status').read_text().splitlines() if l.startswith('Uid:')))==uid and unit in pathlib.Path('/proc',str(pid),'cgroup').read_text())
 return pid
def argv(unit):
 raw=command('systemctl','show',unit,'--value','--property=ExecStart').stdout.decode();match=re.search(r'argv\[\]=(.*?) ;',raw);return match.group(1) if match else None
def main():
 global changed
 check('inactive_core_prepared',json.loads((D/'core-prepare.json').read_text())['status']=='PASS')
 m=json.loads((NEW/'S05_INTEGRATION_MANIFEST.json').read_text());check('new_exact_core_manifest',all(digest(NEW/n)==h for n,h in m['files'].items()))
 q=json.loads((D/'integrated-core-qualification.json').read_text());check('exact_integrated_core_qualified',q['status']=='PASS' and q['tests_run']==1035 and q['private_network'] and q['integration_manifest_sha256']==digest(NEW/'S05_INTEGRATION_MANIFEST.json'))
 check('old_exact_core_manifest',all(digest(OLD/n)==h for n,h in m['original_files'].items()) and cwd()==str(OLD))
 inherited=profile('alice-market.service');check('exact_old_launch_and_identity',argv('alice-market.service')==f'/usr/bin/python3 -B {OLD}/runtime.py --config /etc/alice-market/market-runtime.json' and inherited['User']=='alice-market' and inherited['Group']=='alice-lab')
 actual('alice-market.service',OLD,996);(D/'core-effective-before-r3.private.json').write_text(json.dumps(inherited,indent=2))
 check('runtime_platform_uids',pwd.getpwnam('alice-market').pw_uid==996 and pwd.getpwnam('alisa-platform-stage').pw_uid==993)
 check('fresh_free_reserve',shutil.disk_usage('/opt').free>=3072*1048576+8*1048576 and os.statvfs('/opt').f_favail>=200000)
 before=pointers();rec['before_pointers']=before
 check('own_pointers_expected_foreign_versions_snapshotted',all(before[n]==r for n,r in {'web-current':'alisa-c8666516683e7b2b','site-current':'alisa-c8666516683e7b2b','current':'alisa-482ed11832b666af'}.items()) and all(pathlib.Path('/opt/alisa-platform/stage',n).is_symlink() and pathlib.Path('/opt/alisa-platform/stage',n).resolve().parent==pathlib.Path('/opt/alisa-platform/stage/releases').resolve() for n in ['admin-current','identity-current']))
 check('owned_new_unit_and_overrides_absent',all(not p.exists() and not p.is_symlink() for p in [UNIT,DROP,PDROP]))
 check('owned_systemd_parents_secure',all(p.parent.is_dir() and not p.parent.is_symlink() and p.parent.stat().st_uid==0 and not p.parent.stat().st_mode&0o022 for p in [UNIT,DROP,PDROP]))
 check('new_socket_absent',not pathlib.Path('/run/alice-market/store-check.sock').exists())
 check('pinned_unit_source',digest(D/'alisa-store-check.service')=='ef2583094d15b9690ded07e905018a13ba5a8f3c66ae19d667013b58ce502c2a')
 check('pinned_root_helper',digest(NEW/'store-check-permissions.py')=='e63b20c9079a986120b90daa4dac5edf2ced63516be3f6bb577fd653b7b96905')
 with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True,timeout=2) as db:
  db.execute('PRAGMA query_only=ON');check('no_queued_or_running_jobs',db.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0)
 gw=pathlib.Path('/run/alice-market/gateway.sock').stat();gw_meta=(gw.st_uid,gw.st_gid,stat.S_IMODE(gw.st_mode))
 try:grp.getgrnam('alisa-store-check');raise RuntimeError('Unknown existing checker group')
 except KeyError:pass
 for path,data in [(UNIT,(D/'alisa-store-check.service').read_text()),(DROP,CORE_DROP),(PDROP,PLATFORM_DROP)]:
  fd,temp=tempfile.mkstemp(prefix='.s05-own-',dir=path.parent)
  try:
   with os.fdopen(fd,'w') as f:f.write(data);f.flush();os.fsync(f.fileno());os.fchmod(f.fileno(),0o644)
   made.append((path,data));os.link(temp,path)
  finally:pathlib.Path(temp).unlink()
 command('groupadd','--system','alisa-store-check');rec['created_group_gid']=grp.getgrnam('alisa-store-check').gr_gid
 (D/'core-unit-files.before.private.json').write_text(json.dumps({'old_directory':str(OLD),'new_files':{str(p):s for p,s in made}}))
 command('systemctl','daemon-reload');command('systemctl','enable','alisa-store-check.service');changed=True
 command('systemctl','restart','alice-market.service')
 for _ in range(60):
  p=pathlib.Path('/run/alice-market/store-check.sock')
  if p.exists() and command('systemctl','is-active','alice-market.service').stdout.strip()==b'active' and command('systemctl','is-active','alisa-store-check.service').stdout.strip()==b'active':break
  time.sleep(.2)
 else:raise RuntimeError('Checker readiness deadline')
 check('exact_active_core_directory',cwd()==str(NEW))
 check('exact_new_launch_and_inherited_properties',argv('alice-market.service')==f'/usr/bin/python3 -B {NEW}/runtime.py --config /etc/alice-market/market-runtime.json' and profile('alice-market.service')==inherited)
 actual('alice-market.service',NEW,996)
 check('checker_unit_active',command('systemctl','is-active','alisa-store-check.service').stdout.strip()==b'active')
 sock=p.stat();check('socket_owner_group_mode',stat.S_ISSOCK(sock.st_mode) and sock.st_uid==996 and sock.st_gid==rec['created_group_gid'] and stat.S_IMODE(sock.st_mode)==0o660)
 gw=pathlib.Path('/run/alice-market/gateway.sock').stat();check('gateway_access_metadata_preserved',(gw.st_uid,gw.st_gid,stat.S_IMODE(gw.st_mode))==gw_meta)
 check('all_platform_pointers_preserved',pointers()==before)
 check('exact_integrated_source_still_present',all(digest(NEW/n)==h for n,h in m['files'].items()))
 check('old_core_source_unchanged',all(digest(OLD/n)==h for n,h in m['original_files'].items()))
 rec['active_core_directory']=str(NEW);rec['inherited_profile_sha256']=hashlib.sha256(json.dumps(inherited,sort_keys=True).encode()).hexdigest();rec['installed_unit_hashes']={str(p):digest(p) for p,s in made};rec['integration_manifest_sha256']=digest(NEW/'S05_INTEGRATION_MANIFEST.json');rec['status']='PASS'
def recover():
 # Only our new bytes may be removed; unknown changes are preserved.
 if any(not p.exists() or p.read_text()!=s for p,s in made):return 'UNKNOWN_EXTERNAL_CHANGE_PRESERVED'
 if changed and cwd() not in {str(OLD),str(NEW)}:return 'UNKNOWN_CORE_CHANGE_PRESERVED'
 if UNIT.exists():command('systemctl','disable','--now','alisa-store-check.service')
 for p,s in reversed(made):p.unlink()
 command('systemctl','daemon-reload')
 if changed:command('systemctl','restart','alice-market.service')
 return 'OWN_NEW_FILES_REMOVED_OLD_CORE_RESTORED_GROUP_RETAINED'
if __name__=='__main__':
 if OUT.exists():raise SystemExit('Existing activation outcome preserved; inspect before resume')
 with contextlib.ExitStack() as stack:
  for name in LOCKS:
   f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  try:main()
  except Exception as error:
   rec['error_type']=type(error).__name__
   if made:
    try:rec['recovery']=recover()
    except Exception as recovery:rec['recovery_error_type']=type(recovery).__name__
  finally:OUT.write_text(json.dumps(rec,indent=2)+'\n');print(json.dumps(rec))
 sys.exit(0 if rec['status']=='PASS' else 1)
