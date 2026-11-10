"""Finite S08 rollout with a shared lock, exact bases and conditional rollback."""
import fcntl,hashlib,importlib.util,json,os,shutil,signal,sqlite3,subprocess,sys,time,urllib.request
from pathlib import Path
ROOT=Path('/root/alisa-s08-install-d11a9f2a-20261110')
BACKUP=Path('/var/lib/alisa-platform/stage/rollout-backups/s08-query-insights-20261110-d11a9f2a')
PLATFORM=Path('/opt/alisa-platform/stage/releases/alisa-query-insights-f4127277e9c25557')
NATIVE=Path('/opt/alice-market/releases/alisa-query-insights-r1-20261110')
OLD_PLATFORM=Path('/opt/alisa-platform/stage/releases/alisa-report-archive-ab21d8fa3a940259')
OLD_ADMIN=Path('/opt/alisa-platform/stage/releases/alisa-admin-session-r1-20261108')
FEATURE=Path('/etc/alisa-platform/stage/query-insights.env')
PUBLISHER=Path('/usr/local/libexec/alisa/query_gap_publish.py')
RETENTION=Path('/etc/systemd/system/alice-market-retention.service.d/62-query-insights.conf')
WEB=Path('/opt/alisa-platform/stage/web-current')
VERSIONS=Path('/etc/alisa-platform/stage/runtime-versions.json')
UNITS=['alisa-platform@stage.service','alisa-runtime-authority-stage.service','alice-market.service','alisa-web@stage.service','alisa-admin@stage.service']
SELECTORS={
 'alisa-platform@stage.service':'-report-archive.conf',
 'alisa-runtime-authority-stage.service':'z-report-archive.conf',
 'alice-market.service':'-alisa-runtime-current.conf',
 'alisa-admin@stage.service':'-staff-session-r1.conf'}
def need(value,code):
    if not value:raise RuntimeError(code)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def command(*args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=50).stdout.strip()
def cwd(u):return str(Path(command('systemctl','show',u,'--value','-p','WorkingDirectory')).resolve())
def state(u):return command('systemctl','show',u,'--value','-p','ActiveState')
def atomic(p,raw,mode=0o644):
    p.parent.mkdir(parents=True,exist_ok=True);tmp=p.with_name(p.name+'.s08-new')
    previous=p.stat()if p.exists()else None
    with tmp.open('xb')as f:
        f.write(raw);f.flush();os.fsync(f.fileno())
        if previous:os.fchown(f.fileno(),previous.st_uid,previous.st_gid)
    tmp.chmod(mode);os.replace(tmp,p)
def receipt(name,data):atomic(ROOT/name,(json.dumps(data,indent=2)+'\n').encode(),0o600)
def busy():
    with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True,timeout=2)as c:
        return c.execute("SELECT count(*)FROM jobs WHERE state IN('RUNNING','QUEUED')").fetchone()[0]
def request(port,path):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open('http://127.0.0.1:'+str(port)+path,timeout=3)as r:return r.status,json.loads(r.read(4096))
    except urllib.error.HTTPError as e:return e.code,{}
def ready(port):
    for _ in range(15):
        try:
            status,data=request(port,'/health/ready')
            if status==200 and data.get('release')==PLATFORM.name:return data
        except (OSError,ValueError):pass
        time.sleep(1)
    raise RuntimeError('HEALTH_NOT_READY')
def module():
    spec=importlib.util.spec_from_file_location('s08_migration',ROOT/'migrate.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def rollback(changes):
    # Only revert bytes this invocation wrote. Never overwrite a later deployment.
    restore=[]
    for row in changes:
        p=Path(row['path'])
        digest=sha(p)if p.exists()else None
        if digest==row['new_sha256']:restore.append(row)
        else:need(digest==row['old_sha256'],'ROLLBACK_SELECTOR_MOVED')
    need(WEB.is_symlink()and WEB.resolve()in[PLATFORM,OLD_PLATFORM],'ROLLBACK_WEB_MOVED')
    command('systemctl','stop','alice-market.service')
    for row in restore:
        p=Path(row['path'])
        if row['old_file']is None:p.unlink()
        else:atomic(p,(BACKUP/row['old_file']).read_bytes(),row['old_mode'])
    if WEB.resolve()==PLATFORM:
        temporary=WEB.with_name('web-current.s08-rollback');temporary.symlink_to(OLD_PLATFORM);os.replace(temporary,WEB)
    command('systemctl','daemon-reload')
    failures=[]
    for u in UNITS:
        try:command('systemctl','restart',u)
        except Exception:failures.append(u)
    # Additive PG/SQLite objects and captured events are retained; no down migration.
    receipt('ROLLED_BACK.json',{'status':'ROLLBACK_NEEDS_ATTENTION'if failures else'ROLLED_BACK','restart_failures':failures,'additive_storage_retained':True,'services':{u:state(u)for u in UNITS}})
    need(not failures,'ROLLBACK_SERVICE_FAILURE')
def activate(apply=False):
    need(os.geteuid()==0,'ROOT_REQUIRED')
    with Path('/run/lock/alisa-stage-rollout.lock').open('r+')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        composed=json.loads((ROOT/'COMPOSED.json').read_text())
        need(not BACKUP.exists(),'EXISTING_ROLLOUT_REQUIRES_READBACK')
        for u,expected in composed['before_working_directories'].items():need(cwd(u)==expected and state(u)=='active','LIVE_BASE_MOVED')
        old_native=Path(composed['before_working_directories']['alice-market.service'])
        for p,key in [(old_native,'base_native'),(OLD_PLATFORM,'base_platform'),(OLD_ADMIN,'base_admin'),(PLATFORM,'platform'),(NATIVE,'native')]:
            need(sha(p/'manifest.json')==composed[key+'_manifest_sha256'],'MANIFEST_MOVED')
        for p in [PLATFORM,NATIVE]:
            for name,digest in json.loads((p/'manifest.json').read_text())['files'].items():need(sha(p/name)==digest,'RELEASE_BYTES_CHANGED')
        spec=importlib.util.spec_from_file_location('pin_sync','/usr/local/libexec/alisa/runtime_versions_sync.py');pins=importlib.util.module_from_spec(spec);spec.loader.exec_module(pins)
        # Already holding its normal rollout lock: check via the existing API.
        # The bundle digest includes code, including these new journal modules.
        # Existing admission permits only its compatible catalog hash to change.
        pin_result=pins.publish(NATIVE,Path('/etc/alice-market/market-runtime.json'),VERSIONS,check=True)
        need(pin_result['status']in['UNCHANGED','UPDATE_REQUIRED'],'CATALOG_PINS_NOT_CURRENT')
        need(shutil.disk_usage('/opt').free>3*1024**3,'DISK_HEADROOM');need(busy()==0,'ACTIVE_CUSTOMER_WORK')
        files={}
        for u,suffix in SELECTORS.items():
            paths=command('systemctl','show',u,'--value','-p','DropInPaths').split();matches=[p for p in paths if p.endswith(suffix)]
            need(len(matches)==1,'AMBIGUOUS_SELECTOR');p=Path(matches[0]);text=p.read_text()
            previous=old_native if u=='alice-market.service'else OLD_ADMIN if u=='alisa-admin@stage.service'else OLD_PLATFORM
            target=NATIVE if u=='alice-market.service'else PLATFORM
            need(str(previous)in text,'SELECTOR_MISMATCH')
            text=text.replace(str(previous),str(target))
            if u=='alisa-runtime-authority-stage.service':text=text.replace(OLD_PLATFORM.name,PLATFORM.name)
            if u in UNITS[:2]:text+='\nEnvironmentFile='+str(FEATURE)+'\n'
            files[p]=(text.encode(),0o644)
        for p in [FEATURE,PUBLISHER,RETENTION]:need(not p.exists(),'INSTALL_PATH_OCCUPIED')
        need(WEB.is_symlink()and WEB.resolve()==OLD_PLATFORM,'WEB_POINTER_MOVED')
        files[FEATURE]=(b'ALISA_QUERY_INSIGHTS_ENABLED=1\n',0o640)
        files[PUBLISHER]=((PLATFORM/'infra/query_gap_publish.py').read_bytes(),0o644)
        files[RETENTION]=(('''[Service]
LoadCredential=platform_authority:/etc/alice-market/runtime-authority.credential
ExecStartPre=-/usr/bin/timeout --signal=TERM --kill-after=2s 20 /usr/bin/python3 -I -B /usr/local/libexec/alisa/query_gap_publish.py --database /var/lib/alice-market/template-gaps.sqlite3 --state-database /var/lib/alice-market/state.sqlite3
''').encode(),0o644)
        if pin_result['status']=='UPDATE_REQUIRED':
            old=pins.version_shape(pins.decode(VERSIONS.read_bytes()));new={**pins.compute(NATIVE),'catalog_release_id':old['catalog_release_id']}
            need({k for k in old if old[k]!=new[k]}=={'catalog_bundle_hash'},'UNRELATED_PIN_CHANGE')
            files[VERSIONS]=((json.dumps(new,indent=2)+'\n').encode(),VERSIONS.stat().st_mode&0o777)
        m=module();m.run(False)
        receipt('ACTIVATION_PREFLIGHT.json',{'status':'PASS','candidate_files_verified':True,'catalog_pin_check':pin_result,'planned_paths':[str(p)for p in files],'web_current':str(WEB),'live_db_changes':False})
        if not apply:return
        BACKUP.mkdir(parents=True,mode=0o700);changes=[]
        for i,(p,(raw,mode))in enumerate(files.items()):
            old=None
            if p.exists():old=str(i)+'.conf';shutil.copy2(p,BACKUP/old)
            changes.append({'path':str(p),'old_file':old,'old_mode':p.stat().st_mode&0o777 if p.exists()else None,'old_sha256':sha(p)if p.exists()else None,'new_sha256':hashlib.sha256(raw).hexdigest()})
        receipt('ACTIVATION_PREPARED.json',{'changes':changes,'web_old_target':str(OLD_PLATFORM),'backup':str(BACKUP)})
        m.run(True)
        # Recheck at the last moment; stopping does not delete persisted requests.
        started_mutation=False
        try:
            need(busy()==0,'ACTIVE_CUSTOMER_WORK');command('systemctl','stop','alice-market.service')
            need(busy()==0,'CUSTOMER_WORK_ARRIVED')
            for row,(p,(raw,mode))in zip(changes,files.items()):
                started_mutation=True
                if p==VERSIONS:
                    pins.publish(NATIVE,Path('/etc/alice-market/market-runtime.json'),VERSIONS)
                    need(sha(p)==row['new_sha256'],'PINS_CHANGED_DURING_ACTIVATION')
                else:atomic(p,raw,mode)
            temporary=WEB.with_name('web-current.s08-new');temporary.symlink_to(PLATFORM);os.replace(temporary,WEB)
            command('systemctl','daemon-reload')
            for u in UNITS[:2]:command('systemctl','restart',u)
            ready(18102)
            command('systemctl','start','alice-market.service')
            for u in UNITS[3:]:command('systemctl','restart',u)
            health={str(p):ready(p)for p in [18100,18101,18102]}
            for u in UNITS:need(state(u)=='active','SERVICE_NOT_ACTIVE')
            expected={u:str(NATIVE)if u=='alice-market.service'else str(PLATFORM/'services/platform')if u=='alisa-runtime-authority-stage.service'else str(PLATFORM)for u in UNITS}
            for u,path in expected.items():need(cwd(u)==path,'WRONG_SELECTED_RELEASE')
            receipt('ACTIVATED.json',{'status':'ACTIVATED','source_sha':composed['source_sha'],'working_directories':expected,'health':health,'live_db_migration':'query_insights.0001_initial','model_or_marketplace_calls':0})
        except BaseException:
            if started_mutation:rollback(changes)
            else:command('systemctl','start','alice-market.service')
            raise
if __name__=='__main__':
    def interrupted(signum,frame):raise RuntimeError('INSTALL_INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted)
    try:
        need(sys.argv[1:]in[[],['--apply']],'ARGUMENTS');activate(sys.argv[1:]==['--apply'])
        print(json.dumps({'status':'ACTIVATED'if sys.argv[1:]else'PREFLIGHT_PASS'}))
    except Exception as e:print(json.dumps({'status':'BLOCKED','error_type':type(e).__name__}));raise SystemExit(1)
