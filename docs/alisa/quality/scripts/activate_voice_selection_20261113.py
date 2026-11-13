"""Finite authorized voice-state rollout; no native/web/admin or key changes."""
import fcntl,hashlib,importlib.util,json,os,shutil,subprocess,sys,time,urllib.request
from pathlib import Path
ROOT=Path('/root/alisa-s09-voice-install-d11a9f2a-20261110')
BASE=Path('/opt/alisa-platform/stage/releases/alisa-query-insights-f4127277e9c25557')
APP=BASE.parent/'alisa-voice-selection-ac5557cd456ab364'
OLD_CLEANUP=BASE.parent/'alisa-s07-queries-7cdf71a974643f47'
BACKUP=ROOT/'activation-backup-20261113'
UNITS=['alisa-platform@stage.service','alisa-runtime-authority-stage.service']
CLEAN_UNIT='alisa-account-cleanup@stage.service'
TIMER='alisa-account-cleanup@stage.timer'
PATHS=[Path('/etc/systemd/system/alisa-platform@stage.service.d/zzzzzzzzzzzzzzzzzzzzz-report-archive.conf'),
       Path('/etc/systemd/system/alisa-runtime-authority-stage.service.d/z-report-archive.conf'),
       Path('/etc/systemd/system/alisa-account-cleanup@stage.service.d/zzzzzzzzzzzzzzzzzzzz-alice-link-r1.conf')]
EXPECTED_MANIFEST='4069054526175c134692c6458e3ccf25694271f3472710b4002ae2ec7b86a5e5'
MIGRATE_SHA='1c0706830fc8a8579328536d7d263ccb2ae299d7a20229966b66d83de0a2ae56'
def need(value,code):
    if not value:raise RuntimeError(code)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def command(*args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=50).stdout.strip()
def prop(unit,key):return command('systemctl','show',unit,'--value','--property='+key)
def atomic(path,raw,mode):
    temp=path.with_name(path.name+'.voice-20261113-new');need(not temp.exists(),'TEMP_EXISTS')
    previous=path.stat() if path.exists() else None
    try:
        with temp.open('xb') as stream:
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
            if previous:os.fchown(stream.fileno(),previous.st_uid,previous.st_gid)
        temp.chmod(mode);os.replace(temp,path)
    finally:
        if temp.exists():temp.unlink()
def record(name,data):atomic(ROOT/name,(json.dumps(data,indent=2)+'\n').encode(),0o600)
def migration():
    path=ROOT/'migrate.py';need(sha(path)==MIGRATE_SHA,'MIGRATION_HELPER_CHANGED')
    spec=importlib.util.spec_from_file_location('voice_migration',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def plan():
    need(os.geteuid()==0 and not BACKUP.exists(),'ROLLOUT_SCOPE_OR_ALREADY_STARTED')
    need(sha(APP/'manifest.json')==EXPECTED_MANIFEST,'CANDIDATE_MANIFEST_CHANGED')
    manifest=json.loads((APP/'manifest.json').read_text())
    for path,digest in manifest['files'].items():need(sha(APP/path)==digest,'CANDIDATE_FILES_CHANGED')
    for path,target in manifest.get('links',{}).items():
        p=APP/path;need(p.is_symlink() and os.readlink(p)==target and p.resolve().is_relative_to(APP),'CANDIDATE_LINK_CHANGED')
    need(sha(BASE/'manifest.json')==manifest['base_manifest_sha256'],'BASE_MANIFEST_CHANGED')
    expected=json.loads((ROOT/'ACTIVATION_BASE_20261113.json').read_text())['selectors'];rows=[]
    for index,path in enumerate(PATHS):
        need(path.is_file() and sha(path)==expected[str(path)]['sha256'],'SELECTOR_CHANGED')
        original=path.read_bytes();before=BASE if index<2 else OLD_CLEANUP
        need(str(before).encode() in original,'SELECTOR_BASE_MISSING')
        text=original.decode().replace(str(before),str(APP))
        if index<2:text=text.replace(BASE.name,APP.name)
        need(str(before) not in text,'SELECTOR_REPLACE_FAILED')
        rows.append({'path':str(path),'old_sha256':sha(path),'new_sha256':hashlib.sha256(text.encode()).hexdigest(),
                     'mode':path.stat().st_mode&0o777,'new_text':text})
    need(prop(UNITS[0],'WorkingDirectory')==str(BASE) and prop(UNITS[1],'WorkingDirectory')==str(BASE/'services/platform'),'ACTIVE_BASE_MOVED')
    need(all(prop(unit,'ActiveState')=='active' for unit in UNITS+[TIMER]),'REQUIRED_SERVICE_INACTIVE')
    # No owner sessions, grants or provider/model calls are made by this script.
    need(shutil.disk_usage('/opt').free>3*1024**3,'DISK_RESERVE')
    migration().run(False)
    record('ACTIVATION_CHECK_20261113.json',{'status':'PASS','candidate':str(APP),'planned_paths':[r['path'] for r in rows],
        'only_restarted_units':UNITS,'existing_cleanup_unit':CLEAN_UNIT,'native_web_admin_preserved':True})
    return rows
def ready():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(20):
        try:
            with opener.open('http://127.0.0.1:18102/health/ready',timeout=2) as response:
                value=json.loads(response.read(4096));need(response.status==200 and value.get('release')==APP.name,'PLATFORM_HEALTH')
            raw=command('curl','--silent','--show-error','--fail','--max-time','3','--unix-socket',
                '/run/alisa-runtime-rpc/authority/authority.sock','http://localhost/health/ready')
            authority=json.loads(raw);need(authority.get('release')==APP.name,'AUTHORITY_HEALTH')
            return {'platform':value,'authority':authority}
        except Exception:
            if attempt==19:raise RuntimeError('BACKEND_NOT_READY') from None
            time.sleep(.5)
def rollback(rows):
    # Additive table + new cleanup remain, keeping expired ciphertext removable.
    for index,row in enumerate(rows[:2]):
        p=Path(row['path']);actual=sha(p)
        need(actual in {row['old_sha256'],row['new_sha256']},'ROLLBACK_LATER_SELECTOR_MOVED')
        if actual==row['new_sha256']:atomic(p,(BACKUP/(str(index)+'.conf')).read_bytes(),row['mode'])
    command('systemctl','daemon-reload')
    failures=[]
    for unit in UNITS:
        try:command('systemctl','restart',unit)
        except Exception:failures.append(unit)
    record('ROLLED_BACK_20261113.json',{'status':'ROLLED_BACK' if not failures else 'ROLLBACK_NEEDS_ATTENTION',
        'restart_failures':failures,'additive_table_and_expiry_cleanup_retained':True})
    need(not failures,'ROLLBACK_RESTART_FAILED')
def run(apply=False):
    with Path('/run/lock/alisa-stage-rollout.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);rows=plan()
        if not apply:return
        BACKUP.mkdir(mode=0o700)
        for index,row in enumerate(rows):shutil.copy2(row['path'],BACKUP/(str(index)+'.conf'))
        record('ACTIVATION_PREPARED_20261113.json',{'changes':[{k:v for k,v in r.items() if k!='new_text'} for r in rows],'backup':str(BACKUP)})
        # The owner explicitly authorized this exact additive migration on13Nov.
        migration().run(True)
        migrated=json.loads((ROOT/'MIGRATED.json').read_text());need(migrated['migration']==['queries','0002_voicedialogue'],'MIGRATION_RECEIPT')
        changed=False
        try:
            for row in rows:
                p=Path(row['path']);need(sha(p)==row['old_sha256'],'SELECTOR_MOVED_BEFORE_WRITE')
                atomic(p,row['new_text'].encode(),row['mode']);changed=True
            command('systemctl','daemon-reload')
            for unit in UNITS:command('systemctl','restart',unit)
            health=ready()
            # Existing oneshot is serialized by systemd; do not kill a running cleanup.
            for attempt in range(65):
                if prop(CLEAN_UNIT,'ActiveState') not in {'active','activating','deactivating'}:break
                time.sleep(.5)
            else:raise RuntimeError('CLEANUP_STILL_BUSY')
            command('systemctl','start',CLEAN_UNIT)
            need(prop(CLEAN_UNIT,'Result')=='success' and prop(CLEAN_UNIT,'ExecMainStatus')=='0','CLEANUP_FAILED')
            need(prop(TIMER,'ActiveState')=='active','CLEANUP_TIMER_INACTIVE')
            need(shutil.disk_usage('/opt').free>3*1024**3,'FINAL_DISK_RESERVE')
            record('ACTIVATED_20261113.json',{'status':'VOICE_SELECTION_BACKEND_ACTIVATED','candidate':str(APP),
                'manifest_sha256':sha(APP/'manifest.json'),'health':health,'units':{u:prop(u,'ActiveState') for u in UNITS},
                'cleanup_result':'success','cleanup_timer_active':True,'live_database_changes':True,
                'native_web_admin_restarted':False,'owner_acceptance':'NOT_PERFORMED'})
        except BaseException:
            if changed:rollback(rows)
            raise
if __name__=='__main__':
    try:
        need(sys.argv[1:] in [[],['--apply']],'ARGUMENTS');run(sys.argv[1:]==['--apply'])
    except Exception as error:
        # Only fixed safe error codes, never a private config or response body.
        code=str(error) if isinstance(error,RuntimeError) and str(error).replace('_','').isalnum() else type(error).__name__
        print(json.dumps({'status':'BLOCKED','code':code}));raise SystemExit(1)
