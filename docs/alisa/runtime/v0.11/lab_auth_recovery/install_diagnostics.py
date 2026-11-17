"""One finite diagnostic-only web release. No credential, grant or DB writes."""
from pathlib import Path
from copy import deepcopy
import hashlib,json,os,shutil,sqlite3,subprocess,sys,time

ROOT=Path('/root/alisa-column-acceptance-20261117')
BASELINE=ROOT/'AUTH_DIAGNOSTIC_BASELINE.json'
BASELINE_SHA='5fc2070a2e4a0d65bd5b1224e182a258c34f1c489c0c07299db2bc562126b5c8'
SOURCE=Path(__file__).with_name('alice_lab.py')
SOURCE_SHA='9d11c4af39cd2876b096b551cc239c146982c054ec78dab8a180d8d4eb517785'
NONCE=os.urandom(8).hex()
NEW_BASE=Path('/opt/alisa-station/releases/station-auth-reasons-9d11c4af-20261117-'+NONCE)
NEW_ENTRY=Path('/opt/alice-lab/releases/20261117-auth-reasons-9d11c4af-'+NONCE)
DROP=Path('/etc/systemd/system/alice-lab-web.service.d')/(128*'z'+'-auth-reasons-20261117.conf')
UNIT='alice-lab-web.service'
ATTEMPT=ROOT/('auth-diagnostic-install-'+NONCE)
sys.path.insert(0,'/usr/local/libexec/alisa-r15-activation-7b0cdab47871a302')
import activate as a

def need(ok,code):
    if not ok:raise RuntimeError(code)

def sha(raw):return hashlib.sha256(raw).hexdigest()

def prop(unit,key):return subprocess.check_output(['systemctl','show',unit,'--value','-p',key],text=True,timeout=10).strip()

def files(root):
    result={}
    for p in sorted(root.rglob('*')):
        if '__pycache__'in p.parts:continue
        need(not p.is_symlink(),'SOURCE_LINK_CHANGED')
        if p.is_file():result[str(p.relative_to(root))]=sha(p.read_bytes())
    return result

def record(name,data):a.write_new(ATTEMPT/(name+'.json'),(json.dumps(data,sort_keys=True,indent=2)+'\n').encode())

def freeze(root):
    for p in root.rglob('*'):
        p.chmod(0o555 if p.is_dir()else 0o444)
    root.chmod(0o555)

def healthy():
    raw=subprocess.check_output(['curl','--silent','--show-error','--fail','--max-time','3',
                                 'http://127.0.0.1:8765/healthz'],timeout=5)
    return json.loads(raw).get('status')=='ok'

def main():
    need(a.tool_hash()=='7b0cdab47871a30218848d3392e262f731d6852c7c017188adfe9d35159adb99','LOCK_HELPER_CHANGED')
    need(os.geteuid()==0 and sha(BASELINE.read_bytes())==BASELINE_SHA,'BASELINE_CHANGED')
    baseline=json.loads(BASELINE.read_text());need(sha(SOURCE.read_bytes())==SOURCE_SHA,'SOURCE_CHANGED')
    need(not NEW_BASE.exists()and not NEW_ENTRY.exists()and a.path_state(DROP)is None,'ATTEMPT_EXISTS')
    ATTEMPT.mkdir(mode=0o700)
    with a.lock():
        old=baseline['unit'];before=old['properties']
        def verify_original():
            need(all(prop(UNIT,k)==v for k,v in before.items()),'UNIT_CHANGED')
            need(all(sha(Path(p).read_bytes())==v for p,v in old['sources'].items()),'UNIT_SOURCE_CHANGED')
            for role in ('base','entry'):
                need(files(Path(baseline[role]['root']))==baseline[role]['files'],'SOURCE_TREE_CHANGED')
        verify_original()
        old_static=a.unit_static(UNIT)
        conn=sqlite3.connect('file:/var/lib/alice-lab/lab.sqlite3?mode=ro',uri=True)
        try:
            need(conn.execute('SELECT count(*)FROM forms WHERE expires>?',(time.time(),)).fetchone()[0]==0,'OWNER_FORM_ACTIVE')
        finally:conn.close()
        need(shutil.disk_usage('/opt').free>3*1024**3+2*1024**2,'DISK_RESERVE')
        protected={u:{k:prop(u,k)for k in ['MainPID','InvocationID','ActiveState']}
                   for u in ['alice-market.service','alisa-station.service','alisa-platform@stage.service']}
        record('DIAGNOSTIC_INSTALL_INTENT',{'source_sha256':SOURCE_SHA,'unit':UNIT,'base':str(NEW_BASE),
            'entry':str(NEW_ENTRY),'dropin':str(DROP),'protected':protected,'diagnostic_only':True})
        # Each preparation gets separate, initially unselected coordinates.
        # Interrupted copies remain evidence and cannot block another reviewed
        # attempt from the same unchanged baseline or be mistaken for a release.
        try:
            prepare(baseline)
        except BaseException:
            record('DIAGNOSTIC_PREPARATION_STOPPED',{'status':'NOT_SELECTED','base':str(NEW_BASE),
                'entry':str(NEW_ENTRY),'selector_absent':a.path_state(DROP)is None,
                'safe_next_attempt':'New unique inactive paths; reverify exact unchanged live baseline'})
            raise
        verify_original()
        for unit,props in protected.items():need(all(prop(unit,k)==v for k,v in props.items()),'PROTECTED_SERVICE_CHANGED')
        need(healthy(),'OLD_HEALTH_FAILED')
        raw=('[Service]\nWorkingDirectory='+str(NEW_BASE)+'\nExecStart=\nExecStart=/usr/bin/python3 -B '+str(NEW_ENTRY/'lab_entry.py')+' alice-lab-web\n').encode()
        staged=DROP.with_name('.'+DROP.name+'.new-'+NONCE)
        a.write_new(staged,raw,mode=0o644);ours=a.path_state(staged)
        expected=deepcopy(old_static);expected['WorkingDirectory']=str(NEW_BASE)
        expected['DropInPaths']+=' '+str(DROP)
        expected['source_hashes'][str(DROP)]=sha(raw)
        expected['command']={'path':sha(b'/usr/bin/python3'),
            'argv':sha(('/usr/bin/python3 -B '+str(NEW_ENTRY/'lab_entry.py')+' alice-lab-web').encode())}
        try:
            a.replace_managed(DROP,staged,None,ours,nonce=NONCE)
            record('DIAGNOSTIC_SELECTOR_PUBLISHED',{'state':ours,'source':SOURCE_SHA})
            subprocess.run(['systemctl','daemon-reload'],check=True,timeout=20)
            need(a.unit_static(UNIT)==expected,'SELECTOR_NOT_EFFECTIVE')
            subprocess.run(['systemctl','restart',UNIT],check=True,timeout=30)
            ready(NEW_BASE,expected)
            need(a.path_state(DROP)==ours,'SELECTOR_CHANGED')
            for unit,props in protected.items():need(all(prop(unit,k)==v for k,v in props.items()),'PROTECTED_SERVICE_CHANGED')
            record('DIAGNOSTIC_INSTALLED',{'status':'INSTALLED_TECHNICAL_PASS','pid':prop(UNIT,'MainPID'),
                'release':str(NEW_BASE),'source_sha256':SOURCE_SHA,'credentials_changed':False,
                'permissions_changed':False,'database_written_by_installer':False})
            print(json.dumps({'status':'INSTALLED_TECHNICAL_PASS','receipt':str(ATTEMPT)}))
        except BaseException:
            # Restore only when the currently loaded definition is still either
            # our exact new definition or the exact old cached definition.
            need(a.path_state(DROP)==ours,'RECOVERY_SELECTOR_NOT_OWNED')
            need(a.unit_static(UNIT)in(old_static,expected),'RECOVERY_UNIT_CHANGED')
            need(all(sha(Path(p).read_bytes())==v for p,v in old['sources'].items()),'RECOVERY_SOURCE_CHANGED')
            a.replace_managed(DROP,None,ours,None,nonce=os.urandom(16).hex())
            subprocess.run(['systemctl','daemon-reload'],check=True,timeout=20)
            need(a.unit_static(UNIT)==old_static,'OLD_SELECTOR_NOT_EFFECTIVE')
            subprocess.run(['systemctl','restart',UNIT],check=True,timeout=30)
            ready(Path(baseline['base']['root']),old_static)
            record('DIAGNOSTIC_RESTORED',{'status':'OLD_CODE_RESTORED','healthy':True})
            raise

def ready(root,expected):
    deadline=time.monotonic()+15
    while True:
        try:
            need(healthy()and prop(UNIT,'ActiveState')=='active','HEALTH_FAILED')
            need(a.unit_static(UNIT)==expected,'PROCESS_INVOCATION_CHANGED')
            pid=prop(UNIT,'MainPID')
            need(pid.isdecimal()and int(pid)>1 and(Path('/proc')/pid/'cwd').resolve()==root,'PROCESS_SOURCE_CHANGED')
            return
        except Exception:
            if time.monotonic()>=deadline:raise
            time.sleep(.2)

def prepare(baseline):
        shutil.copytree(baseline['base']['root'],NEW_BASE,ignore=shutil.ignore_patterns('__pycache__','manifest.json'))
        # copytree inherits immutable source modes. Replace only the newly copied
        # leaf after making this own directory writable; old release untouched.
        NEW_BASE.chmod(0o755);leaf=NEW_BASE/'alice_lab.py';leaf.chmod(0o600);leaf.write_bytes(SOURCE.read_bytes())
        shutil.copytree(baseline['entry']['root'],NEW_ENTRY,ignore=shutil.ignore_patterns('__pycache__','manifest.json'))
        NEW_ENTRY.chmod(0o755);p=NEW_ENTRY/'targets.json';p.chmod(0o600);targets=json.loads(p.read_text())
        targets['alice-lab-web']['target']=str(leaf);targets['alice-lab-web']['sha256']=SOURCE_SHA
        targets['alice-lab-web']['argv']=['/usr/bin/python3','-B',str(leaf),'serve']
        p.write_text(json.dumps(targets,sort_keys=True,indent=2)+'\n')
        expected_base={k:v for k,v in baseline['base']['files'].items()if k!='manifest.json'}
        expected_base['alice_lab.py']=SOURCE_SHA
        need(files(NEW_BASE)==expected_base,'CANDIDATE_TREE_CHANGED')
        expected_entry={k:v for k,v in baseline['entry']['files'].items()if k!='manifest.json'}
        expected_entry['targets.json']=sha(p.read_bytes())
        need(files(NEW_ENTRY)==expected_entry,'ENTRY_TREE_CHANGED')
        for folder,index in [(NEW_BASE,expected_base),(NEW_ENTRY,expected_entry)]:
            a.write_new(folder/'manifest.json',(json.dumps({'schema':'lab-auth-diagnostics/v1',
                'baseline_sha256':BASELINE_SHA,'files':index},sort_keys=True,indent=2)+'\n').encode(),mode=0o444)
            freeze(folder)

if __name__=='__main__':main()
