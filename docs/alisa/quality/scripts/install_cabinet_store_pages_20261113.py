"""Finite web-only update from a qualified package delta; no builds on Alisa."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request

ROOT=Path('/root/alisa-s09-pagination-install-20261113-d11a9f2a')
SOURCE='1c9512728d2582bb87c21f7a5c4ae49fba22e3c4'
BASE=Path('/opt/alisa-platform/stage/releases/alisa-cabinet-multi-store-b481fbe9480ef13e')
APP=BASE.parent/('alisa-cabinet-pages-'+SOURCE[:16])
WEB=BASE.parent.parent/'web-current'
BASE_MANIFEST='6b2611e8e1a4c3902ec7d4311f0dc49e994cd70511fa385d3d3616fd59b77b6d'
UNIT='alisa-web@stage.service'
OTHERS=['alice-market.service','alisa-store-check.service','alisa-platform@stage.service',
    'alisa-runtime-authority-stage.service','alisa-admin@stage.service','alisa-identity@stage.service',
    'alisa-station.service','alisa-smtp-sandbox-stage.service']


def need(ok,code):
    if not ok:raise RuntimeError(code)


def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()


def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=30).stdout.strip()


def prop(unit,name):return run('systemctl','show',unit,'--value','--property='+name)


def atomic(path,raw,mode=0o600):
    temp=path.with_name('.'+path.name+'.pages-new');need(not temp.exists(),'TEMP_EXISTS')
    try:
        with temp.open('xb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        temp.chmod(mode);os.replace(temp,path)
    finally:
        if temp.exists():temp.unlink()


def record(name,value):atomic(ROOT/name,(json.dumps(value,indent=2)+'\n').encode())


def reserve(extra=0,inodes=0):
    disk=os.statvfs('/opt')
    need(disk.f_bavail*disk.f_frsize>3*1024**3+extra and disk.f_favail>200000+inodes,'RESOURCE_RESERVE')


def allowed(name):
    return (type(name)is str and str(Path(name))==name and not Path(name).is_absolute()
        and '..'not in Path(name).parts and (name.startswith('ui/web/')or name=='infra/launch.py'))


def validate(root,manifest):
    need(type(manifest.get('files'))is dict and 1<=len(manifest['files'])<=10000,'MANIFEST_FILES')
    for name,digest in manifest['files'].items():
        path=root/name
        need(allowed(name)and not path.is_symlink()and path.resolve().is_relative_to(root)and sha(path)==digest,'PAYLOAD_HASH')
    for name,target in manifest.get('links',{}).items():
        path=root/name
        need(allowed(name)and type(target)is str and path.is_symlink()and os.readlink(path)==target
            and path.resolve().is_relative_to(root),'PAYLOAD_LINK')


def base_check():
    reserve();need(WEB.is_symlink()and WEB.resolve()==BASE,'WEB_MOVED')
    need(sha(BASE/'manifest.json')==BASE_MANIFEST,'BASE_CHANGED')
    need(prop(UNIT,'ActiveState')=='active'and Path(prop(UNIT,'WorkingDirectory')).resolve()==BASE,'WEB_SERVICE_MOVED')
    need((BASE/'.venv').is_dir()and not(BASE/'.venv').is_symlink(),'BASE_DEPENDENCIES_CHANGED')
    value=json.loads((BASE/'manifest.json').read_text());validate(BASE,value)
    return value


def prepare():
    base=base_check();need(not APP.exists()and not(ROOT/'PREPARED.json').exists(),'CANDIDATE_EXISTS')
    plan=json.loads((ROOT/'PLAN.json').read_text());manifest=plan['web_manifest']
    need(plan['source']==SOURCE and plan['base_manifest_sha256']==BASE_MANIFEST and
        manifest['source_sha']==SOURCE and manifest['artifact_id']==APP.name,'PLAN_SOURCE')
    need(manifest['locks']==base['locks'],'DEPENDENCIES_CHANGED')
    need(set(manifest['files'])&set(manifest.get('links',{}))==set(),'MANIFEST_OVERLAP')
    need(all(allowed(n)for n in [*manifest['files'],*manifest.get('links',{})])and
        'ui/web/apps/web/server.js'in manifest['files']and'infra/launch.py'in manifest['files'],'WEB_SCOPE')
    changed={n:h for n,h in manifest['files'].items()if base['files'].get(n)!=h}
    archive=ROOT/'web-delta.tar.gz';need(sha(archive)==plan['delta_sha256'],'DELTA_HASH')
    with tarfile.open(archive)as bundle:
        members=bundle.getmembers();need(len(members)==len(changed)and len({m.name for m in members})==len(members),'DELTA_MEMBERS')
        need({m.name for m in members}==set(changed)and all(m.isfile()and 0<=m.size<=16*1024**2 for m in members),'DELTA_SCOPE')
        directories={str(parent)for name in manifest['files']for parent in Path(name).parents if str(parent)!='.'}
        extra=sum(m.size for m in members)+len(directories)*8192+len(manifest['files'])*512+4*1024**2
        reserve(extra,len(manifest['files'])+len(directories))
        APP.mkdir(mode=0o755)
        try:
            by_name={m.name:m for m in members}
            for name,digest in manifest['files'].items():
                target=APP/name;target.parent.mkdir(parents=True,exist_ok=True)
                if name not in changed:os.link(BASE/name,target)
                else:
                    raw=bundle.extractfile(by_name[name]).read()
                    need(hashlib.sha256(raw).hexdigest()==digest,'DELTA_FILE_HASH')
                    atomic(target,raw,0o644)
            for name,target in manifest.get('links',{}).items():
                path=APP/name;path.parent.mkdir(parents=True,exist_ok=True);path.symlink_to(target)
            # The validated immutable base is retained for dependencies and rollback.
            (APP/'.venv').symlink_to(BASE/'.venv',target_is_directory=True)
            atomic(APP/'manifest.json',(json.dumps(manifest,indent=2)+'\n').encode(),0o644)
            validate(APP,manifest);base_check();reserve()
            record('PREPARED.json',{'status':'INACTIVE_WEB_PREPARED','source':SOURCE,
                'manifest_sha256':sha(APP/'manifest.json'),'delta_sha256':plan['delta_sha256'],
                'qualified_package_sha256':plan['qualified_package_sha256'],'changed_web_files':len(changed),
                'hardlinked_unchanged_files':len(manifest['files'])-len(changed),
                'dependency_environment':str(BASE/'.venv'),
                'database_changes':False,'live_services_changed':False})
        except BaseException:shutil.rmtree(APP);raise
    archive.unlink()  # Own transfer only; the qualified package remains in CI.


def check():
    base_check();receipt=json.loads((ROOT/'PREPARED.json').read_text())
    need(receipt['source']==SOURCE and sha(APP/'manifest.json')==receipt['manifest_sha256'],'CANDIDATE_CHANGED')
    manifest=json.loads((APP/'manifest.json').read_text())
    need(manifest['source_sha']==SOURCE and manifest['artifact_id']==APP.name,'CANDIDATE_SOURCE')
    need((APP/'.venv').is_symlink()and os.readlink(APP/'.venv')==str(BASE/'.venv'),
        'DEPENDENCY_REFERENCE_CHANGED')
    validate(APP,manifest)


def pointer(target):
    temp=WEB.with_name('web-current.pages-new');need(not temp.exists(),'LINK_TEMP_EXISTS')
    temp.symlink_to(target);os.replace(temp,WEB)


def health(expected):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(30):
        try:
            with opener.open('http://127.0.0.1:18100/health/ready',timeout=2)as response:
                data=json.loads(response.read(8192))
                if response.status==200 and data.get('release')==expected.name:return data
        except (OSError,ValueError):pass
        time.sleep(.5)
    raise RuntimeError('WEB_NOT_READY')


def activate():
    check();need(not(ROOT/'ACTIVATED.json').exists(),'ALREADY_ACTIVATED')
    before={u:{k:prop(u,k)for k in ['MainPID','WorkingDirectory','ActiveState']}for u in OTHERS}
    need(all(row['ActiveState']=='active'for row in before.values()),'OTHER_SERVICE_INACTIVE')
    old=os.readlink(WEB);record('BEFORE.json',{'web_target':old,'other_services':before})
    changed=False
    try:
        pointer(str(APP));changed=True;run('systemctl','restart',UNIT)
        health(APP)
        need(all(all(prop(u,k)==v for k,v in row.items())for u,row in before.items()),'OTHER_SERVICE_CHANGED')
        reserve();record('ACTIVATED.json',{'status':'INSTALLED_TECHNICAL_CHECKS_PASS','source':SOURCE,
            'release':APP.name,'only_restarted_unit':UNIT,'other_eight_services_unchanged':True,
            'database_changes':False,'native_or_platform_changes':False,'live_owner':'NOT_PERFORMED'})
    except BaseException:
        if changed:
            need(WEB.is_symlink()and WEB.resolve()in [BASE,APP],'ROLLBACK_POINTER_MOVED')
            pointer(old);run('systemctl','restart',UNIT);health(BASE)
            record('ROLLED_BACK.json',{'status':'ROLLED_BACK','only_restarted_unit':UNIT})
        raise


if __name__=='__main__':
    try:
        need(os.geteuid()==0 and sys.argv[1:]in [['--prepare'],['--check'],['--activate']],'ARGUMENTS')
        with Path('/run/lock/alisa-stage-rollout.lock').open('a')as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            {'--prepare':prepare,'--check':check,'--activate':activate}[sys.argv[1]]()
        print(json.dumps({'status':'PASS','operation':sys.argv[1]}))
    except Exception as error:
        code=str(error)if isinstance(error,RuntimeError)and str(error).replace('_','').isalnum()else type(error).__name__
        print(json.dumps({'status':'BLOCKED','code':code}));raise SystemExit(1)
