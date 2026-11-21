"""Switch only the web pointer and restart one service; no config or DB writes."""
import contextlib,fcntl,hashlib,json,os,pathlib,re,shutil,stat,subprocess,sys,time,urllib.error,urllib.request
sys.dont_write_bytecode=True;os.umask(0o077)
P=pathlib.Path;B=P('/opt/alisa-platform/stage');C=P('/etc/alisa-platform/stage');D=P('/var/lib/alisa-platform/stage/rollout-backups/s05-stores-20261106/dual-ozon-9b716ba6')
R='alisa-9b716ba6ffe18a45';TARGET=B/'releases'/R;OUT=D/'activate-web.json';UNIT='alisa-web@stage.service'
LOCKS=['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock','alisa-s03-rollout.lock']
record={'scope':'ONE_WEB_POINTER_AND_RESTART_NO_ENV_DB_CORE_IDENTITY_CHANGES','status':'FAILED','cases':[]};before=None;changed=False;configs=None;profile_before=None
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
def check(name,passed):
    record['cases'].append({'case':name,'passed':bool(passed)})
    if not passed:raise RuntimeError(name)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def command(args):return subprocess.run(args,check=True,capture_output=True,timeout=20).stdout.decode().strip()
def pointers():return {n:(B/n).resolve().name for n in ['web-current','site-current','admin-current','identity-current','current']}
def config_hashes():return {n:sha((C/(n+'.env')).read_bytes()) for n in ['web','platform','admin','identity','platform-migration','identity-migration']}
def secure_chain(path):
    for p in [*reversed(path.parents),path]:
        s=p.lstat()
        if not stat.S_ISDIR(s.st_mode) or s.st_uid!=0 or s.st_gid!=0 or s.st_mode&0o022:raise SystemExit('Untrusted directory chain')
def profile():return sha((command(['systemctl','show',UNIT,'--property=User,Group,WorkingDirectory,Environment,EnvironmentFiles,LoadCredential,SupplementaryGroups,NoNewPrivileges,ReadWritePaths,InaccessiblePaths,ProtectSystem,ProtectHome,UMask,MemoryMax,TasksMax,TimeoutStopUSec,KillMode'])+'\nLaunchIdentity='+json.dumps(launch_identity())).encode())
def launch_identity():
    value=command(['systemctl','show',UNIT,'--property=ExecStart'])
    matches=re.findall(r'path=([^ ;}]+) ; argv\[\]=(.*?) ;',value)
    if len(matches)!=1:raise RuntimeError('Invalid effective launch')
    return matches[0]
def point(release):
    temp=B/'.s05-dual-ozon-web-pointer'
    if temp.exists() or temp.is_symlink():raise RuntimeError('Existing pointer temp retained')
    temp.symlink_to(B/'releases'/release);os.replace(temp,B/'web-current')
def health(release):
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        try:
            with opener.open('http://127.0.0.1:18100/health/ready',timeout=min(2,max(.1,deadline-time.monotonic()))) as response:result=json.load(response)
            if result.get('status')=='READY' and result.get('release')==release:return {'status':result['status'],'release':result['release']}
        except OSError:pass
        time.sleep(.2)
    raise RuntimeError('Web readiness deadline')
def request(path,data=None):
    headers={'Origin':'https://alisa.octoport.ru','Content-Type':'application/json'} if data is not None else {}
    req=urllib.request.Request('https://alisa.octoport.ru'+path,data=None if data is None else json.dumps(data).encode(),headers=headers)
    try:response=opener.open(req,timeout=5)
    except urllib.error.HTTPError as error:response=error
    with response:return response.code,response.read(65536),response.headers.get('Location')
def main():
    global before,changed,configs,profile_before
    check('root_private_namespace',D.stat().st_uid==D.stat().st_gid==0 and stat.S_IMODE(D.stat().st_mode)==0o700 and not D.is_symlink())
    receipt=D/'install-web.json';s=receipt.lstat()
    check('root_private_regular_install_receipt',stat.S_ISREG(s.st_mode) and s.st_uid==s.st_gid==0 and stat.S_IMODE(s.st_mode)==0o600)
    installed=json.loads((D/'install-web.json').read_text())
    check('own_exact_component_installed',installed['status']=='PASS' and installed['source_sha']=='9b716ba6ffe18a459c476332daf22160fe069b96' and sha((TARGET/'manifest.json').read_bytes())==installed['manifest_sha256'])
    manifest=json.loads((TARGET/'manifest.json').read_text())
    check('exact_web_component_bytes',all(sha((TARGET/n).read_bytes())==h for n,h in manifest['files'].items() if n=='infra/launch.py' or n.startswith('ui/web/')) and all((TARGET/n).is_symlink() and os.readlink(TARGET/n)==value for n,value in manifest['links'].items() if n.startswith('ui/web/')))
    before=pointers();record['before_pointers']=before
    check('same_own_web_and_platform_predecessor',before['web-current']=='alisa-d9918bcb3695b432' and before['site-current']=='alisa-6098b31384ae23a4')
    configs=config_hashes();profile_before=profile()
    check('private_root_config_metadata',all((C/(n+'.env')).stat().st_uid==0 and stat.S_IMODE((C/(n+'.env')).stat().st_mode)==0o600 for n in configs))
    effective=command(['systemctl','show',UNIT,'--property=ExecStart,WorkingDirectory,User,Group'])
    check('existing_web_service_uses_own_pointer',f'{B}/web-current/.venv/bin/python {B}/web-current/infra/launch.py web' in effective and 'WorkingDirectory='+str(B/'web-current') in effective and 'User=alisa-web-stage' in effective and 'Group=alisa-web-stage' in effective)
    inherited_launch=launch_identity();check('exact_launcher_path_and_argv',inherited_launch==(str(B/'web-current/.venv/bin/python'),f'{B}/web-current/.venv/bin/python {B}/web-current/infra/launch.py web'))
    old_pid=int(command(['systemctl','show',UNIT,'--value','--property=MainPID']))
    node_exe=P('/proc',str(old_pid),'exe').resolve();node_stat=node_exe.stat()
    check('actual_node_executable_root_owned',node_stat.st_uid==0 and stat.S_ISREG(node_stat.st_mode) and not node_stat.st_mode&0o022)
    record['health_before']=health(before['web-current'])
    point(R);changed=True;command(['systemctl','restart',UNIT]);record['health_after']=health(R)
    pid=int(command(['systemctl','show',UNIT,'--value','--property=MainPID']))
    check('effective_web_pid_uid_cwd_cgroup',pid>0 and P('/proc',str(pid),'cwd').resolve()==TARGET/'ui/web/apps/web' and P('/proc',str(pid),'exe').resolve()==node_exe and next(l.split()[1] for l in P('/proc',str(pid),'status').read_text().splitlines() if l.startswith('Uid:'))=='995' and UNIT in P('/proc',str(pid),'cgroup').read_text())
    check('effective_launch_path_and_argv_preserved',launch_identity()==inherited_launch)
    check('service_profile_and_all_private_configs_preserved',profile()==profile_before and config_hashes()==configs)
    check('all_other_pointers_preserved',all(pointers()[n]==value for n,value in before.items() if n!='web-current'))
    check('own_web_pointer_exact',pointers()['web-current']==R)
    status,body,_=request('/api/account/stores');check('anonymous_store_list_requires_login',status==401 and json.loads(body)=={'code':'AUTHENTICATION_REQUIRED'})
    status,body,_=request('/api/account/stores',{'action':'create','command_id':'00000000-0000-4000-8000-000000000001','provider':'WB','name':'must-not-be-created','voice_alias':'','credential':{'token':'fixture:must-not-dispatch'}})
    check('anonymous_store_mutation_requires_login',status==401 and json.loads(body)=={'code':'AUTHENTICATION_REQUIRED'})
    status,_,location=request('/app/stores');check('private_page_still_requires_login',status==307 and location=='/login')
    status,body,_=request('/health/ready');check('public_https_exact_release',status==200 and json.loads(body).get('release')==R)
    with opener.open('http://127.0.0.1:18102/health/ready',timeout=3) as response:api=json.load(response)
    check('platform_still_previous_qualified_release',api.get('status')=='READY' and api.get('release')==before['site-current'])
    check('runtime_and_checker_still_active',command(['systemctl','is-active','alice-market.service'])=='active' and command(['systemctl','is-active','alisa-store-check.service'])=='active')
    check('physical_reserve_retained',shutil.disk_usage(B).free>=3072*1048576 and os.statvfs(B).f_favail>=200000)
    record.update(status='PASS',active_pointers=pointers(),inherited_profile_sha256=profile_before)
def recover():
    if not changed:return 'NO_ACTIVE_CHANGE'
    now=pointers()
    if now['web-current']!=R or any(now[n]!=before[n] for n in before if n!='web-current') or config_hashes()!=configs or profile()!=profile_before:return 'UNKNOWN_EXTERNAL_CHANGE_PRESERVED'
    point(before['web-current']);command(['systemctl','restart',UNIT]);record['recovery_health']=health(before['web-current']);return 'OWN_WEB_POINTER_RESTORED'
if __name__=='__main__':
    secure_chain(B/'releases');secure_chain(D)
    if stat.S_IMODE(D.lstat().st_mode)!=0o700:raise SystemExit('Private namespace required')
    if OUT.exists() or OUT.is_symlink():raise SystemExit('Previous outcome retained')
    with contextlib.ExitStack() as stack:
        directory_fd=os.open(D,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);stack.callback(os.close,directory_fd)
        for name in LOCKS:
            f=stack.enter_context(open('/run/lock/'+name));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
        try:main()
        except Exception as error:
            record['error_type']=type(error).__name__
            try:record['recovery']=recover()
            except Exception as recovery_error:record['recovery_error_type']=type(recovery_error).__name__
        finally:
            fd=os.open(OUT.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=directory_fd)
            with os.fdopen(fd,'w') as output:output.write(json.dumps(record,indent=2)+'\n')
            print(json.dumps(record))
    sys.exit(0 if record['status']=='PASS' else 1)
