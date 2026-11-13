"""Finite, exact-source deployment; preserves concurrent native and login changes."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/root/alisa-s09-enrollment-install-20261113-d11a9f2a')
SOURCE = '592cc8bb006a4991a876c875cd497701791a5593'
BASE = Path('/opt/alisa-platform/stage/releases/alisa-store-default-a6d5e19a87577d87')
APP = BASE.parent / ('alisa-store-enrollment-' + SOURCE[:16])
NATIVE_BASE = Path('/opt/alice-market/releases/alisa-request-reliability-r1-20261113')
NATIVE = NATIVE_BASE.parent / ('alisa-store-enrollment-' + SOURCE[:16])
CURRENT = NATIVE_BASE.parent / 'current'
LINK_ENV = Path('/etc/alisa-platform/stage/runtime-link.env')
PROJECTION = Path('/etc/alisa-store-check/native-pair/scope.json')
VERSIONS = Path('/etc/alisa-platform/stage/runtime-versions.json')
SYNC = Path('/usr/local/libexec/alisa/runtime_versions_sync.py')
CHECKER = Path('/opt/alice-market/checker-releases/native-pair-8e1a695d71f1004b')
PLATFORM_UNITS = ['alisa-runtime-authority-stage.service', 'alisa-platform@stage.service']
NATIVE_UNIT = 'alice-market.service'
CHECK_UNIT = 'alisa-store-check.service'
OTHERS = ['alisa-web@stage.service','alisa-admin@stage.service','alisa-identity@stage.service',
          'alisa-station.service','alisa-smtp-sandbox-stage.service']
CLEAN = 'alisa-account-cleanup@stage.service'
SELECTORS = [Path('/etc/systemd/system/alisa-platform@stage.service.d/zzzzzzzzzzzzzzzzzzzzz-report-archive.conf'),
    Path('/etc/systemd/system/alisa-runtime-authority-stage.service.d/z-report-archive.conf'),
    Path('/etc/systemd/system/alisa-account-cleanup@stage.service.d/zzzzzzzzzzzzzzzzzzzz-alice-link-r1.conf')]


def need(value, code):
    if not value: raise RuntimeError(code)


def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=45, **kwargs).stdout.strip()


def prop(unit, name): return run('systemctl','show',unit,'--value','--property='+name)


def atomic(path, raw, mode=0o600):
    temp = path.with_name('.' + path.name + '.enrollment-new')
    need(not temp.exists(), 'TEMP_EXISTS')
    previous = path.stat() if path.exists() else None
    try:
        with temp.open('xb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            if previous: os.fchown(stream.fileno(), previous.st_uid, previous.st_gid)
        temp.chmod(mode); os.replace(temp, path)
    finally:
        if temp.exists(): temp.unlink()


def record(name, value): atomic(ROOT / name, (json.dumps(value,indent=2)+'\n').encode())


def reserve():
    stat = os.statvfs('/opt')
    need(stat.f_bavail*stat.f_frsize > 3*1024**3 and stat.f_favail > 200000, 'RESOURCE_RESERVE')


def manifest(root):
    value = json.loads((root/'manifest.json').read_text())
    for name,digest in value['files'].items():
        path = root/name
        need(not Path(name).is_absolute() and '..' not in Path(name).parts and
             not path.is_symlink() and path.resolve().is_relative_to(root) and sha(path)==digest,'SOURCE_HASH')
    for name,target in value.get('links',{}).items():
        path=root/name
        need(path.is_symlink() and os.readlink(path)==target and path.resolve().is_relative_to(root),'SOURCE_LINK')
    return value


def plan():
    value=json.loads((ROOT/'PLAN.json').read_text()); need(value['source']==SOURCE,'PLAN_SOURCE')
    return value


def base_check(value):
    reserve()
    need(CURRENT.is_symlink() and CURRENT.resolve()==NATIVE_BASE,'NATIVE_MOVED')
    need(sha(BASE/'manifest.json')==value['platform_base_manifest'] and
         sha(NATIVE_BASE/'manifest.json')==value['native_base_manifest'],'BASE_MOVED')
    manifest(BASE); manifest(NATIVE_BASE)
    need(prop(PLATFORM_UNITS[1],'WorkingDirectory')==str(BASE) and
         prop(PLATFORM_UNITS[0],'WorkingDirectory')==str(BASE/'services/platform'),'PLATFORM_MOVED')
    pid=prop(NATIVE_UNIT,'MainPID')
    need(Path('/proc/'+pid+'/cwd').resolve()==NATIVE_BASE,'NATIVE_PROCESS_MOVED')
    need(all(prop(u,'ActiveState')=='active' for u in PLATFORM_UNITS+[NATIVE_UNIT,CHECK_UNIT]+OTHERS),'SERVICE_INACTIVE')
    for path,digest in value['payload'].items(): need(sha(ROOT/'payload'/path)==digest,'PAYLOAD_CHANGED')
    need(sha(ROOT/'migrate.py')==value['migration_helper'] and sha(SYNC)==value['version_sync_helper'],'HELPER_CHANGED')


def prepare(value):
    base_check(value)
    need(not APP.exists() and not NATIVE.exists() and not (ROOT/'PREPARED.json').exists(),'CANDIDATE_EXISTS')
    original=manifest(BASE); shutil.copytree(BASE,APP,symlinks=True,copy_function=os.link)
    try:
        for name,digest in value['platform_files'].items():
            path=APP/name;path.parent.mkdir(parents=True,exist_ok=True)
            atomic(path,(ROOT/'payload'/name).read_bytes(),0o644)
            need(sha(path)==digest,'PLATFORM_PATCH_HASH')
        original.update(artifact_id=APP.name,source_sha=SOURCE,base_release=BASE.name,
            base_manifest_sha256=value['platform_base_manifest'],store_enrollment_source=SOURCE)
        original['files'].update(value['platform_files'])
        for name,digest in value['platform_files'].items():
            if '/migrations/' in name: original['migrations'][name]=digest
        original['schema_compatibility']['platform_stores']=['0001_initial','0002_runtime_bindings']
        atomic(APP/'manifest.json',(json.dumps(original,indent=2)+'\n').encode(),0o644)
        shutil.copytree(NATIVE_BASE,NATIVE,copy_function=os.link)
        spec=importlib.util.spec_from_file_location('store_overlay',ROOT/'payload/build_overlay.py')
        builder=importlib.util.module_from_spec(spec);spec.loader.exec_module(builder)
        generated=builder.sources(NATIVE)
        need(set(generated)==set(value['native_files']),'NATIVE_PATCH_SCOPE')
        for name,text in generated.items():
            atomic(NATIVE/name,text.encode(),0o644)
            need(sha(NATIVE/name)==value['native_files'][name],'NATIVE_PATCH_HASH')
        atomic(NATIVE/'CURRENT_CORE_MANIFEST.json',(ROOT/'payload/CURRENT_CORE_MANIFEST.json').read_bytes(),0o644)
        core=json.loads((NATIVE/'CURRENT_CORE_MANIFEST.json').read_text())
        native_manifest=manifest(NATIVE_BASE)
        native_manifest.update(artifact_id=NATIVE.name,source_commit=SOURCE,base_release=NATIVE_BASE.name,
            base_manifest_sha256=value['native_base_manifest'],parallel_source_commit=native_manifest['source_commit'])
        native_manifest['files']=dict(core['files'])
        native_manifest['files']['CURRENT_CORE_MANIFEST.json']=sha(NATIVE/'CURRENT_CORE_MANIFEST.json')
        atomic(NATIVE/'manifest.json',(json.dumps(native_manifest,indent=2)+'\n').encode(),0o644)
        manifest(APP);manifest(NATIVE)
        saved={str(p):{'sha256':sha(p),'mode':p.stat().st_mode&0o777}for p in SELECTORS+[LINK_ENV,PROJECTION,VERSIONS]}
        record('SELECTORS.json',saved);base_check(value);reserve()
        record('PREPARED.json',{'source':SOURCE,'platform_manifest':sha(APP/'manifest.json'),
            'native_manifest':sha(NATIVE/'manifest.json'),'native_core_manifest':sha(NATIVE/'CURRENT_CORE_MANIFEST.json'),
            'live_database_changes':False,'live_service_changes':False})
    except BaseException:
        shutil.rmtree(APP)
        if NATIVE.exists(): shutil.rmtree(NATIVE)
        raise


def check(value):
    base_check(value); manifest(APP);manifest(NATIVE)
    prepared=json.loads((ROOT/'PREPARED.json').read_text())
    need(prepared['source']==SOURCE and sha(APP/'manifest.json')==prepared['platform_manifest'] and
         sha(NATIVE/'manifest.json')==prepared['native_manifest'],'CANDIDATE_CHANGED')
    saved=json.loads((ROOT/'SELECTORS.json').read_text())
    for name,row in saved.items(): need(sha(Path(name))==row['sha256'],'SELECTOR_MOVED')
    run(str(APP/'.venv/bin/python'),str(ROOT/'migrate.py'))
    return saved


def native_module():
    sys.path.insert(0,str(CHECKER));import native_store_binding
    return native_store_binding


def projection_data():
    module=native_module();data=module.root_json(PROJECTION,65536)
    need(module.process_generation(data['native_generation']['pid'])==data['native_generation'],'NATIVE_GENERATION_MOVED')
    config=module.root_json(Path('/etc/alice-market/market-runtime.json'),1048576)
    key=bytes.fromhex(data['mac_key'])
    for row in data['bindings']:
        material=module.root_json(Path('/run/credentials/alice-market.service')/row['credential_name'],32768)
        context=module.native_context(config,material,row,environment=data['environment'],product_id=data['product_id'],generation=data['native_generation'])
        need(module.hmac.compare_digest(module.mac(key,'native-owner-source-v1',context),row['source_hmac']),'OWNER_PAIR_MOVED')
    return data


def refresh_projection(original,on_write=None):
    module=native_module();data=json.loads(json.dumps(original))
    generation=module.process_generation(int(prop(NATIVE_UNIT,'MainPID')))
    need(generation['uid']==original['native_generation']['uid'],'NATIVE_UID_CHANGED')
    data['native_generation']=generation
    config=module.root_json(Path('/etc/alice-market/market-runtime.json'),1048576)
    for row in data['bindings']:
        material=module.root_json(Path('/run/credentials/alice-market.service')/row['credential_name'],32768)
        previous=module.native_context(config,material,row,environment=data['environment'],product_id=data['product_id'],generation=original['native_generation'])
        need(module.hmac.compare_digest(module.mac(bytes.fromhex(data['mac_key']),'native-owner-source-v1',previous),row['source_hmac']),'OWNER_PAIR_CHANGED_DURING_RESTART')
        context=module.native_context(config,material,row,environment=data['environment'],product_id=data['product_id'],generation=generation)
        row['source_hmac']=module.mac(bytes.fromhex(data['mac_key']),'native-owner-source-v1',context)
    raw=(json.dumps(data,indent=2)+'\n').encode()
    atomic(PROJECTION,raw,PROJECTION.stat().st_mode&0o777)
    if on_write is not None:on_write(raw)
    run('systemctl','restart',CHECK_UNIT)


def symlink(target):
    temp=CURRENT.with_name('current.enrollment-new');need(not temp.exists(),'LINK_TEMP_EXISTS')
    temp.symlink_to(target.name);os.replace(temp,CURRENT)


def sync(root,lock):
    result=json.loads(run('/usr/bin/python3','-I','-B',str(SYNC),'--source',str(root),'--lock-fd',str(lock.fileno()),pass_fds=(lock.fileno(),)))
    need(result['status']in {'UPDATED','UNCHANGED'},'VERSION_SYNC_FAILED')


def expected_version_bytes(root):
    # Know our exact publication before starting a subprocess: it may publish
    # successfully even when its caller subsequently sees a process failure.
    spec=importlib.util.spec_from_file_location('installed_version_sync',SYNC)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    old=module.version_shape(json.loads(VERSIONS.read_text()))
    new=module.version_shape({**module.compute(root),'catalog_release_id':old['catalog_release_id']})
    need({k for k in old if old[k]!=new[k]}<={'catalog_bundle_hash'},'CONTRACT_CHANGED')
    return (json.dumps(new,indent=2)+'\n').encode()


def recover(old,saved,original,lock):
    failures=[]
    def attempt(label,action):
        try:action()
        except BaseException:failures.append(label)
    for path in SELECTORS+[LINK_ENV,VERSIONS]:
        attempt(str(path),lambda path=path:atomic(path,old[path],saved[str(path)]['mode']))
    attempt('native_selector',lambda:symlink(NATIVE_BASE))
    attempt('native_versions',lambda:sync(NATIVE_BASE,lock))
    attempt('daemon_reload',lambda:run('systemctl','daemon-reload'))
    attempt(NATIVE_UNIT,lambda:run('systemctl','restart',NATIVE_UNIT))
    attempt('owner_pair_and_checker',lambda:refresh_projection(original))
    for unit in PLATFORM_UNITS:
        attempt(unit,lambda unit=unit:run('systemctl','restart',unit))
    record('ROLLED_BACK.json',{'status':'ROLLBACK_NEEDS_ATTENTION'if failures else'ROLLED_BACK',
        'failures':failures,'additive_tables_retained':True})
    return failures


def ready():
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(30):
        try:
            with opener.open('http://127.0.0.1:18102/health/ready',timeout=2)as response:
                need(response.status==200 and json.loads(response.read(4096))['release']==APP.name,'PLATFORM_HEALTH')
            raw=run('curl','--silent','--show-error','--fail','--max-time','3','--unix-socket',
                '/run/alisa-runtime-rpc/authority/authority.sock','http://localhost/health/ready')
            need(json.loads(raw)['release']==APP.name,'AUTHORITY_HEALTH')
            need(all(prop(u,'ActiveState')=='active'for u in PLATFORM_UNITS+[NATIVE_UNIT,CHECK_UNIT]+OTHERS),'SERVICE_INACTIVE')
            return
        except Exception:
            if attempt==29: raise RuntimeError('HEALTH_FAILED')from None
            time.sleep(.5)


def apply(value,saved,lock):
    need(not (ROOT/'backup').exists(),'BACKUP_EXISTS');(ROOT/'backup').mkdir(mode=0o700)
    original=projection_data()
    before={u:{k:prop(u,k)for k in ['MainPID','WorkingDirectory']}for u in OTHERS}
    old={Path(name):Path(name).read_bytes()for name in saved}
    for i,(path,raw)in enumerate(old.items()): atomic(ROOT/'backup'/str(i),raw)
    record('BACKUP_INDEX.json',[str(p)for p in old])
    run(str(APP/'.venv/bin/python'),str(ROOT/'migrate.py'),'--apply')
    changed=False
    expected={'versions':expected_version_bytes(NATIVE),'projection':old[PROJECTION]}
    new_env=old[LINK_ENV].rstrip(b'\n')+b'\nALISA_RUNTIME_AUTO_BINDINGS_ENABLED=1\n'
    try:
        for path in SELECTORS:
            need(sha(path)==saved[str(path)]['sha256'],'SELECTOR_MOVED')
            text=old[path].decode();need(str(BASE)in text,'SELECTOR_BASE')
            atomic(path,text.replace(str(BASE),str(APP)).replace(BASE.name,APP.name).encode(),saved[str(path)]['mode']);changed=True
        need(sha(LINK_ENV)==saved[str(LINK_ENV)]['sha256'],'ENV_MOVED')
        need(not any(line.startswith('ALISA_RUNTIME_AUTO_BINDINGS_ENABLED=')for line in old[LINK_ENV].decode().splitlines()),'FLAG_ALREADY_SET')
        atomic(LINK_ENV,new_env,saved[str(LINK_ENV)]['mode'])
        symlink(NATIVE);sync(NATIVE,lock)
        run('systemctl','daemon-reload');run('systemctl','restart',NATIVE_UNIT)
        refresh_projection(original,on_write=lambda raw:expected.update(projection=raw))
        for unit in PLATFORM_UNITS: run('systemctl','restart',unit)
        ready()
        for attempt in range(40):
            if prop(CLEAN,'ActiveState')not in {'active','activating','deactivating'}:break
            time.sleep(.5)
        else: raise RuntimeError('CLEANUP_BUSY')
        run('systemctl','start',CLEAN)
        need(prop(CLEAN,'Result')=='success' and prop(CLEAN,'ExecMainStatus')=='0','CLEANUP_FAILED')
        need(all(all(prop(u,k)==v for k,v in row.items())for u,row in before.items()),'OTHER_SERVICE_CHANGED')
        projection_data();reserve()
        record('ACTIVATED.json',{'status':'INSTALLED_TECHNICAL_CHECKS_PASS','source':SOURCE,
            'platform_release':APP.name,'native_release':NATIVE.name,'restarted':PLATFORM_UNITS+[NATIVE_UNIT,CHECK_UNIT],
            'parallel_native_source_preserved':value['parallel_native_source'],'other_five_services_unchanged':True,
            'live_owner':'NOT_PERFORMED','live_database_changes':True,'live_service_changes':True})
    except BaseException:
        if changed:
            # Never overwrite a later writer during rollback.
            for path in SELECTORS:
                need(path.read_bytes()in [old[path],old[path].decode().replace(str(BASE),str(APP)).replace(BASE.name,APP.name).encode()],'ROLLBACK_LATER_WRITER')
            need(CURRENT.resolve()in [NATIVE,NATIVE_BASE],'ROLLBACK_NATIVE_MOVED')
            need(LINK_ENV.read_bytes()in [old[LINK_ENV],new_env] and
                 VERSIONS.read_bytes()in [old[VERSIONS],expected['versions']] and
                 PROJECTION.read_bytes()in [old[PROJECTION],expected['projection']],'ROLLBACK_LATER_WRITER')
            recover(old,saved,original,lock)
        raise


if __name__=='__main__':
    try:
        need(os.geteuid()==0 and sys.argv[1:]in [['--prepare'],['--check'],['--apply']],'ARGUMENTS')
        with Path('/run/lock/alisa-stage-rollout.lock').open('a')as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            value=plan()
            if sys.argv[1]=='--prepare': prepare(value)
            else:
                saved=check(value)
                if sys.argv[1]=='--apply':apply(value,saved,lock)
        print(json.dumps({'status':'PASS','operation':sys.argv[1]}))
    except Exception as error:
        code=str(error)if isinstance(error,RuntimeError)and str(error).replace('_','').isalnum()else type(error).__name__
        print(json.dumps({'status':'BLOCKED','code':code}));raise SystemExit(1)
