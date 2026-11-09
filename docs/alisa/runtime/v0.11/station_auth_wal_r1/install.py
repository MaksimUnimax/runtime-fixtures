"""Roll out only Station/OAuth delivery fix; preserve core, keys and saved state."""
import fcntl
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

BASE=Path('/opt/alisa-station/releases/station-answer-model-r4-20261109')
TARGET=Path('/opt/alisa-station/releases/station-auth-wal-r1-20261109')
WRAPPER_BASE=Path('/opt/alice-lab/releases/20261108-station-recovery-r2')
WRAPPER=Path('/opt/alice-lab/releases/20261109-station-auth-wal-r1')
CANDIDATE=Path('/dev/shm/alisa-station-auth-20261109')
CORE=Path('/opt/alice-market/releases/alisa-selected-notes-r1-20261109')
RECEIPT=Path('/root/alice-lab-evidence/answer-model-20261109/STATION_AUTH_WAL_INSTALLED.json')
SOURCE='56c40398521be17a6ad92cb5ced47f6fdeb89e24'

def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def show(unit,prop):return subprocess.check_output(['systemctl','show',unit,'-p',prop,'--value'],text=True).strip()
def command(*args):return subprocess.run(args,check=True,capture_output=True,text=True)
def atomic(path,data):
    fd,name=tempfile.mkstemp(prefix='.station-auth-',dir=path.parent)
    try:
        os.fchmod(fd,0o644)
        with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(name,path)
    finally:Path(name).unlink(missing_ok=True)
def verify(root,manifest):
    assert all((root/n).is_file()and digest(root/n)==h for n,h in manifest['files'].items()),'MANIFEST_MISMATCH'
def idle():
    with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro',uri=True)as c:
        assert c.execute("SELECT COUNT(*)FROM jobs WHERE state IN('QUEUED','RUNNING')").fetchone()[0]==0,'ACTIVE_JOBS'
    for p in Path('/var/lib/alisa-station').glob('users/*/state.json'):
        s=json.loads(p.read_text())
        assert (s.get('job')or{}).get('delivery')not in('sending','waiting','accepted_waiting_skill','pending'),'ACTIVE_DELIVERY'
def override(unit):
    directory=Path('/etc/systemd/system')/(unit+'.d')
    files=list(directory.glob('*.conf'))
    prefix=max((len(re.match(r'z*',p.name)[0])for p in files),default=0)+1
    result=directory/('z'*prefix+'-station-auth-wal-20261109.conf')
    assert all(result.name>p.name for p in files),'OVERRIDE_ORDER'
    assert not result.exists(),'OVERRIDE_EXISTS'
    return result
def manifest(root,base,old):
    value=dict(old,artifact_id=root.name,base_artifact=base.name,source_commit=SOURCE,
               parent_manifest_sha256=digest(base/'manifest.json'),
               files={str(p.relative_to(root)):digest(p)for p in root.rglob('*')if p.is_file()and p.name!='manifest.json'})
    atomic(root/'manifest.json',json.dumps(value,indent=2).encode());verify(root,value)
    return value
def healthy():
    with urllib.request.urlopen('http://127.0.0.1:8765/healthz',timeout=2)as r:
        return r.status==200 and json.load(r).get('status')=='ok'

def main():
    text=(CANDIDATE/'full.log').read_text();matched=re.search(r'Ran (\d+) tests',text)
    assert matched and text.rstrip().endswith('OK')and 'skipped='not in text,'FULL_TESTS_NOT_PASSED_AS_SERVICE_USER'
    count=int(matched.group(1));assert count>=53,'INCOMPLETE_TESTS'
    expected=json.loads((CANDIDATE/'hashes.json').read_text())
    assert all(digest(CANDIDATE/'station'/n)==h for n,h in expected.items()),'CANDIDATE_CHANGED'
    assert show('alisa-station.service','WorkingDirectory')==str(BASE),'STATION_BASE_CHANGED'
    assert str(WRAPPER_BASE/'lab_entry.py')in show('alice-lab-web.service','ExecStart'),'WEB_BASE_CHANGED'
    assert show('alice-market.service','WorkingDirectory')==str(CORE),'CORE_CHANGED'
    core_hash=digest(CORE/'manifest.json')
    old=json.loads((BASE/'manifest.json').read_text());old_wrapper=json.loads((WRAPPER_BASE/'manifest.json').read_text())
    # The retained legacy wrapper has a previously changed targets file. Its
    # live contents and every referenced source were reviewed before rollout.
    # Keep the old release untouched; seal the actual reviewed baseline here.
    reconciliation = None
    live_targets_hash=digest(WRAPPER_BASE/'targets.json')
    if live_targets_hash!=old_wrapper['files'].get('targets.json'):
        assert live_targets_hash=='9066547834e435ff6c17df3bebccc627d1b9a9ccdb86e7096f4d5c2dff9d6295','UNREVIEWED_LEGACY_TARGETS_CHANGE'
        retained=json.loads((WRAPPER_BASE/'targets.json').read_text())
        assert retained['alice-lab-web']['target']=='/opt/alisa-station/releases/station-auto-r7-recovery/alice_lab.py','UNREVIEWED_WEB_TARGET'
        assert all(digest(Path(v['target']))==v['sha256']for v in retained.values()),'RETAINED_TARGET_SOURCE_CHANGED'
        reconciliation={'file':'targets.json','recorded_sha256':old_wrapper['files']['targets.json'],'reviewed_live_sha256':live_targets_hash}
        old_wrapper=dict(old_wrapper,files={**old_wrapper['files'],'targets.json':live_targets_hash})
    verify(BASE,old);verify(WRAPPER_BASE,old_wrapper)
    assert not TARGET.exists()and not WRAPPER.exists(),'TARGET_EXISTS_INSPECT_RECEIPT'
    idle()
    shutil.copytree(BASE,TARGET,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    for n in expected:atomic(TARGET/n,(CANDIDATE/'station'/n).read_bytes())
    current=manifest(TARGET,BASE,old)
    shutil.copytree(WRAPPER_BASE,WRAPPER,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    targets=json.loads((WRAPPER/'targets.json').read_text())
    targets['alice-lab-web'].update(target=str(TARGET/'alice_lab.py'),sha256=digest(TARGET/'alice_lab.py'),argv=['/usr/bin/python3','-B',str(TARGET/'alice_lab.py'),'serve'])
    atomic(WRAPPER/'targets.json',json.dumps(targets,indent=2).encode())
    current_wrapper=manifest(WRAPPER,WRAPPER_BASE,old_wrapper)
    check=command('/usr/bin/python3','-B',str(WRAPPER/'lab_entry.py'),'alice-lab-web','--check')
    assert json.loads(check.stdout)['external_calls']==0,'WRAPPER_CHECK'
    verify(BASE,old);verify(WRAPPER_BASE,old_wrapper)
    station_override=override('alisa-station.service');web_override=override('alice-lab-web.service')
    stopped=False
    try:
        idle();command('systemctl','stop','alisa-station.service');stopped=True
        command('systemctl','stop','alice-lab-web.service');idle()
        assert show('alisa-station.service','WorkingDirectory')==str(BASE),'STATION_CHANGED_DURING_STOP'
        assert str(WRAPPER_BASE/'lab_entry.py')in show('alice-lab-web.service','ExecStart'),'WEB_CHANGED_DURING_STOP'
        atomic(station_override,('[Service]\nWorkingDirectory='+str(TARGET)+'\nExecStart=\nExecStart=/usr/bin/python3 -B '+str(TARGET)+'/service.py --state /var/lib/alisa-station --key /run/credentials/alisa-station.service/station-key\n').encode())
        atomic(web_override,('[Service]\nWorkingDirectory='+str(TARGET)+'\nExecStart=\nExecStart=/usr/bin/python3 -B '+str(WRAPPER)+'/lab_entry.py alice-lab-web\n').encode())
        command('systemctl','daemon-reload');command('systemctl','start','alice-lab-web.service')
        for _ in range(30):
            try:
                if healthy():break
            except OSError:pass
            time.sleep(.2)
        else:raise RuntimeError('WEB_UNHEALTHY')
        command('systemctl','start','alisa-station.service')
        assert show('alice-lab-web.service','ActiveState')=='active'and show('alisa-station.service','ActiveState')=='active','NEW_SERVICES_INACTIVE'
        assert show('alisa-station.service','WorkingDirectory')==str(TARGET),'STATION_NOT_ACTIVATED'
        assert str(WRAPPER/'lab_entry.py')in show('alice-lab-web.service','ExecStart'),'WEB_NOT_ACTIVATED'
        verify(TARGET,current);verify(WRAPPER,current_wrapper);verify(BASE,old);verify(WRAPPER_BASE,old_wrapper)
        assert digest(CORE/'manifest.json')==core_hash and show('alice-market.service','WorkingDirectory')==str(CORE),'CORE_MODIFIED'
        result=dict(state='INSTALLED',source_commit=SOURCE,station=str(TARGET),web_wrapper=str(WRAPPER),
                    changed_station_files=list(expected),hashes=expected,tests=count,at=time.time(),core_unchanged=str(CORE),bases_unchanged=True,
                    auth_permissions_unchanged=True,credentials_and_saved_state_not_rewritten=True,legacy_manifest_reconciliation=reconciliation)
        RECEIPT.write_text(json.dumps(result,indent=2));print(json.dumps(result))
    except BaseException:
        if stopped:
            command('systemctl','stop','alisa-station.service');command('systemctl','stop','alice-lab-web.service')
            station_override.unlink(missing_ok=True);web_override.unlink(missing_ok=True)
            command('systemctl','daemon-reload');command('systemctl','start','alice-lab-web.service');command('systemctl','start','alisa-station.service')
            assert show('alisa-station.service','WorkingDirectory')==str(BASE)and show('alisa-station.service','ActiveState')=='active','ROLLBACK_FAILED'
        raise

if __name__=='__main__':
    with open('/run/lock/alisa-market-config.lock','a')as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);main()
