"""Finite reversible installation of the reviewed source; no live provider calls."""
import argparse,fcntl,hashlib,json,os,re,shutil,sqlite3,subprocess,time
from pathlib import Path
CANDIDATE=Path('/opt/alice-market/candidates/alisa-request-reliability-20261113')
CORE_OLD=Path('/opt/alice-market/releases/alisa-program-answer-r1-20261111')
CORE=Path('/opt/alice-market/releases/alisa-request-reliability-r1-20261113')
EXEC_OLD=Path('/opt/alisa-program/releases/20261111-r1')
EXEC=Path('/opt/alisa-program/releases/20261113-reliability-r1')
STATION_OLD=Path('/opt/alisa-station/releases/station-ack-eta-r2-20261110')
STATION=Path('/opt/alisa-station/releases/station-request-economics-r1-20261113')
POINTER=Path('/opt/alice-market/releases/current')
BACKUP=Path('/root/alisa-reliability-rollout-backup-20261113')
UNIT=Path('/etc/systemd/system/alice-market.service')
DROP=Path(str(UNIT)+'.d')
BROKER_UNIT=Path('/etc/systemd/system/alisa-program@.service')
CLEANUP_UNIT=Path('/etc/systemd/system/alisa-program-cleanup.service')
CONFIG=Path('/etc/alice-market/market-runtime.json')
PROPERTIES=['User','Group','UMask','NoNewPrivileges','PrivateTmp','ProtectHome','ProtectSystem','ReadWritePaths','RestrictSUIDSGID','LockPersonality','MemoryMax','TasksMax','TimeoutStopUSec','LoadCredential','CapabilityBoundingSet','ProtectKernelTunables','ProtectKernelModules','ProtectControlGroups','Environment','EnvironmentFiles','Restart','RestartUSec']

def command(*args):return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT,timeout=150).strip()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def props(unit):return dict(line.split('=',1)for line in command('systemctl','show',unit,*['--property='+p for p in PROPERTIES]).splitlines())
def counts():
    config=json.loads(CONFIG.read_text());db=sqlite3.connect('file:'+config['database']+'?mode=ro',uri=True)
    try:return {'active_jobs':db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0], 'model_dispatches':db.execute("SELECT COUNT(*) FROM calls WHERE source LIKE 'model:%' AND dispatched IS NOT NULL").fetchone()[0]}
    finally:db.close()
def manifest(root,source,schema,artifact):
    files={str(p.relative_to(root)):digest(p)for p in sorted(root.rglob('*'))if p.is_file()and p!=root/'manifest.json'}
    (root/'manifest.json').write_text(json.dumps({'schema':schema,'artifact_id':artifact,'source_commit':source,'files':files},indent=2)+'\n')
    return files

def prepare(source):
    assert re.fullmatch('[0-9a-f]{40}',source)
    regression=json.loads((CANDIDATE/'regression-final.json').read_text())
    assert regression['status']=='PASS'and regression['live_provider_calls']==0
    assert 'PASS: real broker/Harness;'in (CANDIDATE/'native-final.log').read_text()
    expected=json.loads((CANDIDATE/'deployment/candidate-source.json').read_text())
    for name,sha in expected['files'].items():assert digest(CANDIDATE/name)==sha,('CANDIDATE_CHANGED',name)
    for name,sha in regression['tested_files'].items():assert digest(CANDIDATE/'core'/name)==sha,('TESTED_SOURCE_CHANGED',name)
    assert digest(CORE_OLD/'manifest.json')==expected['base_core_manifest_sha256'],'LIVE_BASE_CHANGED'
    old=json.loads((CORE_OLD/'manifest.json').read_text())
    for name,sha in old['files'].items():assert digest(CORE_OLD/name)==sha,('LIVE_SOURCE_CHANGED',name)
    sdk=json.loads((CANDIDATE/'deployment/sdk-manifest.json').read_text())
    for name,sha in sdk['files'].items():assert digest(Path('/opt/alisa-dsh-lab/20261110-r1')/name)==sha,('SDK_CHANGED',name)
    baseline=json.loads((CANDIDATE/'deployment/systemd-baseline.json').read_text())
    assert set(baseline)=={str(UNIT),*(str(p)for p in DROP.glob('*.conf'))},'UNIT_PATHS_CHANGED'
    for name,content in baseline.items():assert Path(name).read_text()==content,('UNIT_CHANGED',name)
    for name in ['app-admin.js','index-admin.html']:
        assert digest(STATION_OLD/name)==digest(Path('/root/alisa-system-review-20261113/station')/name),('STATION_ASSET_CHANGED',name)
    for destination in [CORE,EXEC,STATION]:assert not destination.exists(),('RELEASE_EXISTS',str(destination))
    shutil.copytree(CANDIDATE/'core',CORE,ignore=shutil.ignore_patterns('__pycache__','.git'))
    shutil.copytree(CANDIDATE/'executor',EXEC,ignore=shutil.ignore_patterns('__pycache__','.git'))
    shutil.copytree(STATION_OLD,STATION,ignore=shutil.ignore_patterns('__pycache__','.git'))
    for name in ['app-admin.js','index-admin.html']:shutil.copy2(CANDIDATE/'station'/name,STATION/name)
    manifests={}
    for root,schema in [(CORE,'alice-read-surface-release/v1'),(EXEC,'alisa-official-program-executor/v2'),(STATION,'alisa-station-release/v1')]:
        manifests[str(root)]=manifest(root,source,schema,root.name)
    for root in [CORE,EXEC,STATION]:
        for p in [root,*root.rglob('*')]:os.chown(p,0,0);p.chmod(0o755 if p.is_dir()else 0o644)
    policy=command('/usr/bin/python3','-B','/opt/alice-market/releases/runtime-policy-guard-20261108/check.py','--release',str(CORE),'--config',str(CONFIG))
    versions=command('/usr/bin/python3','-I','-B','/usr/local/libexec/alisa/runtime_versions_sync.py','--source',str(CORE),'--check')
    station_drop=Path(command('systemctl','show','alisa-station','--property=DropInPaths','--value').split()[-1])
    assert str(STATION_OLD)in station_drop.read_text(),'STATION_VERSION_CHANGED'
    receipt={'source_commit':source,'core':str(CORE),'executor':str(EXEC),'station':str(STATION),'station_dropin':str(station_drop),
      'manifests':{path:digest(Path(path)/'manifest.json')for path in manifests},'config_sha256':digest(CONFIG),
      'unit_sha256':{str(path):digest(path)for path in [BROKER_UNIT,CLEANUP_UNIT,station_drop]},
      'security':{unit:props(unit)for unit in ['alice-market','alisa-station']},'preflight':{'policy':policy,'versions':versions},'before':counts()}
    (CANDIDATE/'deployment/prepared.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps({'prepared':True,'source_commit':source,'preflight':receipt['preflight'],'before':receipt['before']}))

def restore(receipt):
    for path in [UNIT,BROKER_UNIT,CLEANUP_UNIT,Path(receipt['station_dropin'])]:shutil.copy2(BACKUP/'files'/str(path).lstrip('/'),path)
    if (BACKUP/'dropins').exists():
        expected={p.name for p in (BACKUP/'dropins').glob('*.conf')}
        DROP.mkdir(exist_ok=True)
        assert {p.name for p in DROP.glob('*.conf')}<=expected,'UNEXPECTED_NEW_DROPINS'
        # Restore both untouched and partly removed baseline files. A failure
        # before mutation must be just as recoverable as one after reload.
        for path in (BACKUP/'dropins').iterdir():shutil.copy2(path,DROP/path.name)
    if POINTER.is_symlink()and POINTER.resolve()==CORE:POINTER.unlink()
    command('systemctl','daemon-reload')
    for unit in ['alisa-program.socket','alisa-program-cleanup.timer','alice-market','alisa-station']:command('systemctl','restart',unit)

def activate():
    receipt=json.loads((CANDIDATE/'deployment/prepared.json').read_text())
    assert digest(CONFIG)==receipt['config_sha256'],'CONFIG_CHANGED'
    for path,sha in receipt['unit_sha256'].items():assert digest(Path(path))==sha,('UNIT_CHANGED',path)
    assert counts()['active_jobs']==0,'ACTIVE_JOBS'
    assert not command('systemctl','list-units','--all','--state=active,activating,deactivating','--plain','--no-legend','alisa-program-run-*'),'ACTIVE_EXECUTOR'
    assert not BACKUP.exists()and not POINTER.exists(),'ROLLOUT_ALREADY_STARTED'
    baseline=json.loads((CANDIDATE/'deployment/systemd-baseline.json').read_text())
    for path,content in baseline.items():assert Path(path).read_text()==content,('UNIT_CHANGED',path)
    for root,sha in receipt['manifests'].items():
        assert digest(Path(root)/'manifest.json')==sha
        for name,expected in json.loads((Path(root)/'manifest.json').read_text())['files'].items():assert digest(Path(root)/name)==expected
    BACKUP.mkdir(mode=0o700)
    for path in [UNIT,BROKER_UNIT,CLEANUP_UNIT,Path(receipt['station_dropin'])]:
        target=BACKUP/'files'/str(path).lstrip('/');target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(path,target)
    shutil.copytree(DROP,BACKUP/'dropins')
    (BACKUP/'prepared.json').write_text(json.dumps(receipt,indent=2)+'\n')
    try:
        for unit in ['alisa-program-cleanup.timer','alisa-program.socket','alisa-station','alice-market']:command('systemctl','stop',unit)
        assert counts()['active_jobs']==0,'JOB_ARRIVED_DURING_QUIESCE'
        assert not command('systemctl','list-units','--all','--state=active,activating,deactivating','--plain','--no-legend','alisa-program-run-*'),'EXECUTOR_STILL_ACTIVE'
        POINTER.symlink_to(CORE)
        shutil.copy2(CANDIDATE/'deployment/alice-market.service',UNIT)
        for p in DROP.glob('*.conf'):p.unlink()
        for p in [BROKER_UNIT,CLEANUP_UNIT]:p.write_text(p.read_text().replace(str(EXEC_OLD),str(EXEC)))
        station_drop=Path(receipt['station_dropin']);station_drop.write_text(station_drop.read_text().replace(str(STATION_OLD),str(STATION)))
        # Required mountpoint inside the immutable executor rootfs, no permission change.
        (Path('/var/lib/alisa-program/rootfs')/str(EXEC).lstrip('/')).mkdir(parents=True,exist_ok=True)
        command('systemctl','daemon-reload')
        for unit,before in receipt['security'].items():assert props(unit)==before,('HARDENING_CHANGED',unit)
        for unit in ['alice-market','alisa-station','alisa-program.socket','alisa-program-cleanup.timer']:command('systemctl','start',unit)
        for _ in range(30):
            if all(command('systemctl','is-active',u)=='active'for u in ['alice-market','alisa-station','alisa-program.socket','alisa-program-cleanup.timer']):break
            time.sleep(.2)
        for unit,target in [('alice-market',CORE),('alisa-station',STATION)]:
            assert command('systemctl','is-active',unit)=='active'
            pid=int(command('systemctl','show',unit,'--property=MainPID','--value'))
            assert pid>0 and Path('/proc/'+str(pid)+'/cwd').resolve()==target,('WRONG_PROCESS_RELEASE',unit)
        assert Path('/run/alisa-program/runner.sock').is_socket()
        assert digest(CONFIG)==receipt['config_sha256'],'CONFIG_CHANGED'
        receipt.update(installed=True,after=counts(),at_utc=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),core_dropins_remaining=len(list(DROP.glob('*.conf'))),hardening_preserved=True)
        (CANDIDATE/'deployment/installed.json').write_text(json.dumps(receipt,indent=2)+'\n')
        print(json.dumps({k:v for k,v in receipt.items()if k not in ['security','manifests','preflight','config_sha256']}))
    except BaseException:
        restore(receipt);raise

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','activate','rollback']);parser.add_argument('--source');args=parser.parse_args()
    assert os.geteuid()==0
    with open('/run/lock/alisa-runtime-recovery.lock','a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if args.action=='prepare':prepare(args.source)
        elif args.action=='activate':activate()
        else:restore(json.loads((BACKUP/'prepared.json').read_text()))
