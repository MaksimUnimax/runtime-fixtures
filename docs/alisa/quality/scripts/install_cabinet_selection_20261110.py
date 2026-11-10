"""One finite web-only release; no runtime/DB/admin configuration changes."""
import fcntl,hashlib,json,os,shutil,signal,subprocess,sys,tarfile,time,urllib.request,zipfile
from pathlib import Path
ROOT=Path('/root/alisa-s09-install-d11a9f2a-20261110')
SOURCE='b481fbe9480ef13e746628f73ef3ccb3f477b258'
ORIGINAL='alisa-'+SOURCE[:16]
CANDIDATE=Path('/opt/alisa-platform/stage/releases/alisa-cabinet-multi-store-'+SOURCE[:16])
OLD=Path('/opt/alisa-platform/stage/releases/alisa-query-insights-f4127277e9c25557')
WEB=Path('/opt/alisa-platform/stage/web-current')
OLD_MANIFEST='b5c200d250155424618aad5230fb3e276cd8e551545c82ad00a22bc20ef143e5'
UNIT='alisa-web@stage.service'
def need(ok,code):
    if not ok:raise RuntimeError(code)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(*args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=30).stdout.strip()
def record(name,data):
    path=ROOT/name;tmp=path.with_suffix('.new')
    with tmp.open('x')as f:json.dump(data,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
    tmp.chmod(0o600);os.replace(tmp,path)
def validate(root,manifest):
    for name,digest in manifest['files'].items():
        need(not Path(name).is_absolute()and'..'not in Path(name).parts and str(Path(name))==name,'PAYLOAD_PATH')
        p=root/name;need(p.resolve().is_relative_to(root.resolve())and p.is_file()and not p.is_symlink()and sha(p)==digest,'PAYLOAD_HASH')
    for name,target in manifest.get('links',{}).items():
        need(not Path(name).is_absolute()and'..'not in Path(name).parts and str(Path(name))==name,'PAYLOAD_PATH')
        p=root/name;need(p.is_symlink()and os.readlink(p)==target and p.resolve().is_relative_to(root.resolve()),'PAYLOAD_LINK')
def prepare():
    need(not CANDIDATE.exists(),'CANDIDATE_EXISTS')
    need(shutil.disk_usage('/opt').free>3*1024**3+400*1024**2,'DISK_HEADROOM')
    request=json.loads((ROOT/'package-request.json').read_text());need(request['source_sha']==SOURCE,'WRONG_SOURCE')
    archive=ROOT/'qualified-package.zip'
    with urllib.request.urlopen(request['url'],timeout=35)as response,archive.open('xb')as output:
        total=0
        while chunk:=response.read(1024*1024):
            total+=len(chunk);need(total<=80*1024**2,'PACKAGE_SIZE');output.write(chunk)
    need(sha(archive)==request['zip_sha256'],'ZIP_HASH')
    tarpath=ROOT/(ORIGINAL+'.tar.gz')
    with zipfile.ZipFile(archive)as package:
        need(package.getinfo(tarpath.name).file_size<=80*1024**2,'TAR_SIZE')
        tarpath.write_bytes(package.read(tarpath.name))
    need(sha(tarpath)==request['tar_sha256'],'TAR_HASH')
    with tarfile.open(tarpath)as package:
        members=package.getmembers();need(len(members)<=16000 and sum(max(0,m.size)for m in members)<=200*1024**2,'PAYLOAD_SIZE')
        need(all(m.name==ORIGINAL or m.name.startswith(ORIGINAL+'/')for m in members),'ARCHIVE_ROOT')
        package.extractall(ROOT/'staged',filter='data')
    staged=ROOT/'staged'/ORIGINAL;manifest=json.loads((staged/'manifest.json').read_text())
    need(manifest['source_sha']==SOURCE,'MANIFEST_SOURCE');validate(staged,manifest)
    need(manifest['locks']==json.loads((OLD/'manifest.json').read_text())['locks'],'DEPENDENCIES_CHANGED')
    CANDIDATE.mkdir(mode=0o755)
    files={n:d for n,d in manifest['files'].items()if n.startswith('ui/web/')or n=='infra/launch.py'}
    links={n:t for n,t in manifest.get('links',{}).items()if n.startswith('ui/web/')}
    need('ui/web/apps/web/server.js'in files and'infra/launch.py'in files,'WEB_PAYLOAD')
    for name in files:
        target=CANDIDATE/name;target.parent.mkdir(parents=True,exist_ok=True);os.link(staged/name,target)
    for name,target in links.items():
        path=CANDIDATE/name;path.parent.mkdir(parents=True,exist_ok=True);path.symlink_to(target)
    manifest.update(artifact_id=CANDIDATE.name,files=files,links=links,components=['web'],qualified_artifact_id=ORIGINAL,
                    qualified_tar_sha256=request['tar_sha256'],base_web_release=OLD.name)
    (CANDIDATE/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    shutil.copytree(OLD/'.venv',CANDIDATE/'.venv',symlinks=True,copy_function=os.link)
    validate(CANDIDATE,manifest);(ROOT/'package-request.json').unlink();shutil.rmtree(ROOT/'staged')
    record('PREPARED.json',{'status':'INACTIVE_WEB_PREPARED','source_sha':SOURCE,'zip_sha256':request['zip_sha256'],
        'tar_sha256':request['tar_sha256'],'candidate':str(CANDIDATE),'manifest_sha256':sha(CANDIDATE/'manifest.json'),
        'verified_web_files':len(files),'live_services_changed':False,'database_changes':False})
def pointer(target):
    tmp=WEB.with_name('web-current.s09-new');tmp.symlink_to(target);os.replace(tmp,WEB)
def health(expected):
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for _ in range(15):
        try:
            with opener.open('http://127.0.0.1:18100/health/ready',timeout=3)as response:
                data=json.load(response)
                if response.status==200 and data.get('release')==expected.name:return data
        except(OSError,ValueError):pass
        time.sleep(1)
    raise RuntimeError('WEB_NOT_READY')
def activate():
    with Path('/run/lock/alisa-stage-rollout.lock').open('r+')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        need(not(ROOT/'ACTIVATED.json').exists(),'ALREADY_ACTIVATED')
        need(WEB.is_symlink()and WEB.resolve()==OLD,'WEB_MOVED')
        need(Path(run('systemctl','show',UNIT,'--value','-p','WorkingDirectory')).resolve()==OLD,'SELECTOR_MOVED')
        need(run('systemctl','show',UNIT,'--value','-p','ActiveState')=='active','WEB_NOT_ACTIVE')
        need(sha(OLD/'manifest.json')==OLD_MANIFEST,'BASE_CHANGED')
        prepared=json.loads((ROOT/'PREPARED.json').read_text());need(sha(CANDIDATE/'manifest.json')==prepared['manifest_sha256'],'CANDIDATE_CHANGED')
        validate(CANDIDATE,json.loads((CANDIDATE/'manifest.json').read_text()))
        record('BEFORE.json',{'web_old_target':str(OLD),'web_new_target':str(CANDIDATE),'only_restarted_unit':UNIT,
                              'database_changes':False,'runtime_or_admin_changes':False})
        try:
            pointer(CANDIDATE);run('systemctl','restart',UNIT);proof=health(CANDIDATE)
            need(run('systemctl','show',UNIT,'--value','-p','ActiveState')=='active','WEB_NOT_ACTIVE')
            record('ACTIVATED.json',{'status':'WEB_ACTIVATED','source_sha':SOURCE,'web_health':proof,
                'only_restarted_unit':UNIT,'database_changes':False,'runtime_or_admin_changes':False})
        except BaseException:
            need(WEB.is_symlink()and WEB.resolve()in[OLD,CANDIDATE],'ROLLBACK_POINTER_MOVED')
            if WEB.resolve()==CANDIDATE:pointer(OLD)
            run('systemctl','restart',UNIT);health(OLD)
            record('ROLLED_BACK.json',{'status':'WEB_ROLLED_BACK','database_changes':False});raise
if __name__=='__main__':
    def interrupted(signum,frame):raise RuntimeError('INTERRUPTED')
    signal.signal(signal.SIGTERM,interrupted)
    try:
        need(os.geteuid()==0 and sys.argv[1:]in[['--prepare'],['--activate']],'ARGUMENTS')
        prepare()if sys.argv[1:]==['--prepare']else activate()
        print(json.dumps({'status':'PREPARED'if sys.argv[1:]==['--prepare']else'ACTIVATED'}))
    except Exception as e:print(json.dumps({'status':'BLOCKED','error_type':type(e).__name__}));raise SystemExit(1)
