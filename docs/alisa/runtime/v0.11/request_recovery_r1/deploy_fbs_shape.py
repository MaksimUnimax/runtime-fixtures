"""Install the money/article parser without changing credentials or cached plans."""
from pathlib import Path
import subprocess, json, hashlib, sqlite3, shutil, fcntl, time, os, tempfile, argparse
BASE=Path('/opt/alice-market/releases/alisa-runtime-business-read-r4-20261108')
NEW=BASE.with_name('alisa-request-recovery-r5-20261108')
CONFIG=Path('/etc/alice-market/market-runtime.json')
BACKUP=Path('/var/lib/alice-market/fbs-shape-recovery-r5-final-20261108')
UNITS=['alice-market.service','alisa-station.service','alice-lab-web.service']

def run(*args):
    return subprocess.check_output(args, text=True, timeout=45).strip()

def prop(unit, name):
    value=run('systemctl','show',unit,'--value','-p',name)
    # systemd appends PID/start/stop/status metadata to ExecStart; compare the configured command only.
    return value.split(' ; ignore_errors=',1)[0] if name=='ExecStart' else value

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def pin(root):
    code="import sys;sys.path.insert(0,sys.argv[1]);from read_surface import PIN;print(PIN)"
    return run('/usr/bin/python3','-B','-c',code,str(root))

def atomic_config(data, mode, uid, gid):
    fd, temporary=tempfile.mkstemp(dir=CONFIG.parent, prefix='.fbs-config-')
    try:
        with os.fdopen(fd,'wb') as stream:
            os.fchmod(stream.fileno(),mode); os.fchown(stream.fileno(),uid,gid)
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary,CONFIG)
    finally:
        Path(temporary).unlink(missing_ok=True)

def inspect(db):
    with sqlite3.connect('file:'+db+'?mode=ro',uri=True) as c:
        assert c.execute("select count(*) from jobs where state in ('QUEUED','RUNNING')").fetchone()[0]==0,'ACTIVE_USER_WORK'
        # This narrowly scoped deployment does not rebind historical provenance.
        now=time.time()
        for table, predicate, parameters in [
            ('jobs',"state='READY' and expires>?",(now,)),
            ('dialogue_receipts',"created+900>? and (expires is null or expires>?)",(now,now)),
            ('control_inbox',"created+900>? and (expires is null or expires>?)",(now,now)),
        ]:
            rows=c.execute(f"select plan from {table} where {predicate}",parameters)
            assert not any('universal_read' in json.loads(row[0] or '{}') for row in rows),'UNEXPIRED_READ_BINDING:'+table

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--source-commit',required=True)
    args=parser.parse_args(); assert len(args.source_commit)==40
    locks=[]
    for name in ['alisa-stage-rollout.lock','alisa-runtime-recovery.lock']:
        lock=open('/run/lock/'+name,'w'); fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); locks.append(lock)
    assert prop(UNITS[0],'WorkingDirectory')==str(BASE),'CONCURRENT_RUNTIME_CHANGE'
    unchanged={u:{p:prop(u,p) for p in ['WorkingDirectory','ExecStart']} for u in UNITS[1:]}
    log=Path('/tmp/alisa-recovery-r5-full.log').read_text()
    assert '\nOK\n' in log and 'FAILED (' not in log,'FULL_SUITE_NOT_PASSED'
    changed={'read_surface.py','read_surface_data/catalog.json.gz','tests/test_money_article.py','tests/test_audit_deadline.py','manifest.json'}
    for path in BASE.rglob('*'):
        if path.is_file() and '__pycache__' not in str(path) and str(path.relative_to(BASE)) not in changed:
            assert digest(path)==digest(NEW/path.relative_to(BASE)),'CONCURRENT_BASE_FILE_CHANGE:'+str(path.relative_to(BASE))
    old=CONFIG.read_bytes(); stat=CONFIG.stat(); config=json.loads(old)
    assert config['read_surface']['pin']==pin(BASE),'CONFIG_PIN_MISMATCH'
    new_pin=pin(NEW); config['read_surface']['pin']=new_pin
    updated=(json.dumps(config,ensure_ascii=False,indent=2)+'\n').encode()
    assert shutil.disk_usage('/').free>500*1024*1024
    inspect(config['database'])
    BACKUP.mkdir(mode=0o700,exist_ok=False)
    (BACKUP/'config.before.json').write_bytes(old); (BACKUP/'config.before.json').chmod(0o600)
    manifest={'artifact_id':NEW.name,'source_commit':args.source_commit,'files':{str(p.relative_to(NEW)):digest(p) for p in NEW.rglob('*') if p.is_file() and '__pycache__' not in str(p) and p.name!='manifest.json'}}
    (NEW/'manifest.json').write_text(json.dumps(manifest,indent=2))
    for path in NEW.rglob('*'):
        if path.is_dir(): path.chmod(0o755)
        elif '__pycache__' not in str(path): path.chmod(0o644)
    dropin=None; wrote=False
    try:
        for unit in reversed(UNITS): run('systemctl','stop',unit)
        assert CONFIG.read_bytes()==old,'CONCURRENT_CONFIG_CHANGE'
        assert prop(UNITS[0],'WorkingDirectory')==str(BASE),'CONCURRENT_RUNTIME_CHANGE'
        for unit, properties in unchanged.items():
            assert all(prop(unit,p)==v for p,v in properties.items()),'CONCURRENT_COMPANION_CHANGE'
        inspect(config['database'])
        with sqlite3.connect('file:'+config['database']+'?mode=ro',uri=True) as source:
            with sqlite3.connect(BACKUP/'state.before.sqlite3') as target: source.backup(target)
        atomic_config(updated,stat.st_mode & 0o777,stat.st_uid,stat.st_gid); wrote=True
        directory=Path('/etc/systemd/system/alice-market.service.d')
        width=max([len(p.name)-len(p.name.lstrip('z')) for p in directory.glob('*.conf')]+[0])+1
        dropin=directory/('z'*width+'-fbs-money-article-r5.conf')
        dropin.write_text(f'[Service]\nWorkingDirectory={NEW}\nExecStart=\nExecStart=/usr/bin/python3 -B {NEW}/runtime.py --config {CONFIG}\n')
        run('systemctl','daemon-reload')
        for unit in UNITS: run('systemctl','start',unit)
        time.sleep(2)
        assert all(prop(u,'ActiveState')=='active' for u in UNITS),'SERVICE_NOT_ACTIVE'
        assert prop(UNITS[0],'WorkingDirectory')==str(NEW)
        assert json.loads(CONFIG.read_bytes())['read_surface']['pin']==new_pin
        receipt={'status':'INSTALLED','at':time.time(),'source_commit':args.source_commit,'runtime':str(NEW),'dropin':str(dropin),'active':UNITS,'pin_changed':True,'cached_plans_modified':False,'no_unexpired_universal_bindings_at_switch':True}
        (BACKUP/'installed.json').write_text(json.dumps(receipt,indent=2))
        print(json.dumps(receipt),flush=True)
    except BaseException:
        for unit in reversed(UNITS): run('systemctl','stop',unit)
        if dropin: dropin.unlink(missing_ok=True)
        if wrote:
            assert CONFIG.read_bytes()==updated,'CONCURRENT_CONFIG_CHANGE_DURING_ROLLBACK'
            atomic_config(old,stat.st_mode & 0o777,stat.st_uid,stat.st_gid)
        run('systemctl','daemon-reload')
        for unit in UNITS: run('systemctl','start',unit)
        raise

if __name__=='__main__': main()
