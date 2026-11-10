"""Install the qualified input encoder on the exact inspected runtime base."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time

BASE = Path('/opt/alice-market/releases/alisa-selector-prefix-cache-r3-20261110')
TARGET = Path('/opt/alice-market/releases/alisa-input-packing-v1-20261110')
CANDIDATE = Path('/dev/shm/alisa-input-packing-v1-20261110')
RECEIPT = Path('/root/alice-lab-evidence/answer-model-20261109/INPUT_PACKING_V1_INSTALLED.json')
CHANGED = ('model_answer.py', 'model_input_encoding.py', 'tests/test_model_input_encoding.py')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hashes(root):
    return {str(p.relative_to(root)): digest(p) for p in root.rglob('*')
            if p.is_file() and '__pycache__' not in str(p) and p.suffix != '.pyc'}


def show(prop):
    return subprocess.check_output(['systemctl', 'show', 'alice-market.service', '-p', prop, '--value'], text=True).strip()


def command(*args):
    subprocess.run(args, check=True, capture_output=True, text=True)


def empty_queue():
    with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro', uri=True) as db:
        assert db.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0] == 0, 'ACTIVE_JOBS'
    for path in Path('/var/lib/alisa-station/users').glob('*/state.json'):
        state = json.loads(path.read_text())
        assert (state.get('job') or {}).get('delivery') not in ('sending','pending','waiting','accepted_waiting_skill'), 'ACTIVE_DELIVERY'


def atomic(path, data):
    fd, name = tempfile.mkstemp(prefix='.input-packing-', dir=path.parent)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data); stream.flush(); os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def main(source):
    assert show('WorkingDirectory') == str(BASE), 'ACTIVE_BASE_CHANGED'
    before = json.loads((CANDIDATE/'base_hashes.json').read_text())
    assert hashes(BASE) == before, 'BASE_CHANGED'
    candidate = hashes(CANDIDATE/'runtime')
    assert {p for p in set(before)|set(candidate) if before.get(p)!=candidate.get(p)} == set(CHANGED), 'UNEXPECTED_DELTA'
    results = json.loads((CANDIDATE/'full_results.json').read_text())
    assert results['status']=='PASS' and results['failures']==results['errors']==results['skipped']==0, 'TEST_FAILURE'
    assert results['tested_files']==candidate, 'TESTED_FILES_CHANGED'
    review = json.loads((CANDIDATE/'qualification_review.json').read_text())
    assert review['status']=='PASS', 'LIVE_REVIEW_REQUIRED'
    assert all(candidate[name]==sha for name,sha in review['runtime_files'].items()), 'LIVE_CANDIDATE_CHANGED'
    assert not TARGET.exists(), 'TARGET_ALREADY_EXISTS'
    empty_queue()
    shutil.copytree(BASE,TARGET,copy_function=os.link,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    for name in CHANGED:atomic(TARGET/name,(CANDIDATE/'runtime'/name).read_bytes())
    manifest = json.loads((BASE/'manifest.json').read_text())
    manifest.update(artifact_id=TARGET.name, base_artifact=BASE.name, source_commit=source,
                    parent_manifest_sha256=digest(BASE/'manifest.json'))
    manifest['files'].update({name:digest(TARGET/name) for name in CHANGED})
    atomic(TARGET/'manifest.json',json.dumps(manifest,indent=2).encode())
    assert all(digest(TARGET/name)==sha for name,sha in manifest['files'].items()), 'TARGET_MANIFEST'
    assert {k:v for k,v in hashes(TARGET).items() if k!='manifest.json'} == {k:v for k,v in candidate.items() if k!='manifest.json'}, 'TARGET_NOT_TESTED_CANDIDATE'
    command('runuser','-u','alice-market','--','/usr/bin/python3','-B',
            '/opt/alice-market/releases/runtime-policy-guard-20261108/check.py',
            '--release',str(TARGET),'--config','/etc/alice-market/market-runtime.json')
    directory = Path('/etc/systemd/system/alice-market.service.d')
    latest = max(directory.glob('*.conf'),key=lambda p:p.name)
    override = directory/(latest.stem+'z-input-packing-v1.conf')
    assert not override.exists(), 'OVERRIDE_EXISTS'
    empty_queue()
    stopped = False
    try:
        command('systemctl','stop','alice-market.service');stopped=True
        empty_queue()
        assert show('WorkingDirectory')==str(BASE) and hashes(BASE)==before, 'BASE_CHANGED_DURING_STOP'
        atomic(override,('[Service]\nWorkingDirectory='+str(TARGET)+'\nExecStart=\nExecStart=/usr/bin/python3 -B '+str(TARGET)+'/runtime.py --config /etc/alice-market/market-runtime.json\n').encode())
        command('systemctl','daemon-reload');command('systemctl','start','alice-market.service')
        assert show('ActiveState')=='active' and show('WorkingDirectory')==str(TARGET), 'NEW_RUNTIME_INACTIVE'
        assert hashes(BASE)==before, 'BASE_WAS_CHANGED'
        result={'state':'INSTALLED','source_commit':source,'runtime':str(TARGET),'base':str(BASE),
                'changed':CHANGED,'tests':results['tests_run'],'base_unchanged':True,
                'threshold_characters':10000,'live_model_calls':2,'station_calls':0,'at':time.time()}
        atomic(RECEIPT,json.dumps(result,indent=2).encode());print(json.dumps(result))
    except BaseException:
        if stopped:
            # Never replay a v1 job through a legacy encoder during rollback.
            command('systemctl','stop','alice-market.service')
            try:
                empty_queue()
            except Exception:
                # A request may arrive between the queue check and stopping.
                # Keep the currently configured encoder and restore service.
                command('systemctl','daemon-reload')
                command('systemctl','start','alice-market.service')
                raise RuntimeError('ROLLBACK_DEFERRED_ACTIVE_WORK_SERVICE_RESTORED')
            override.unlink(missing_ok=True)
            command('systemctl','daemon-reload');command('systemctl','start','alice-market.service')
        raise


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source-commit',required=True);args=parser.parse_args()
    assert len(args.source_commit)==40 and all(c in '0123456789abcdef' for c in args.source_commit)
    with open('/run/lock/alisa-market-config.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        main(args.source_commit)
