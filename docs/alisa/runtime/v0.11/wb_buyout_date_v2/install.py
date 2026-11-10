"""Move the selected explanation to the selector field; retain all execution code."""
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

BASE = Path('/opt/alice-market/releases/alisa-wb-sales-purpose-v5-20261110')
TARGET = Path('/opt/alice-market/releases/alisa-wb-buyout-date-v2-20261110')
CANDIDATE = Path('/dev/shm/alisa-wb-buyout-date-v2-20261110')
RECEIPT = Path('/root/alice-lab-evidence/answer-model-20261109/WB_BUYOUT_DATE_V2_INSTALLED.json')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def show(prop):
    return subprocess.check_output(['systemctl', 'show', 'alice-market.service', '-p', prop, '--value'], text=True).strip()


def command(*args):
    subprocess.run(args, check=True, capture_output=True, text=True)


def empty_queue():
    with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro', uri=True) as db:
        assert db.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0] == 0, 'ACTIVE_JOBS'
    for station in Path('/var/lib/alisa-station/users').glob('*/state.json'):
        state = json.loads(station.read_text())
        delivery = (state.get('job') or {}).get('delivery')
        assert delivery not in ('sending', 'pending', 'waiting', 'accepted_waiting_skill'), 'ACTIVE_DELIVERY'


def atomic(path, data):
    fd, name = tempfile.mkstemp(prefix='.services-scope-', dir=path.parent)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def verify(root, manifest):
    assert all(digest(root / name) == value for name, value in manifest['files'].items()), 'MANIFEST_MISMATCH'


def main(source):
    patch = json.loads((CANDIDATE / 'template_patch.json').read_text())
    assert show('WorkingDirectory') == str(BASE), 'ACTIVE_BASE_CHANGED'
    manifest = json.loads((BASE / 'manifest.json').read_text())
    verify(BASE, manifest)
    assert digest(BASE / 'template_catalog.json') == patch['base_catalog_sha256'], 'CATALOG_BASE_CHANGED'
    catalog = CANDIDATE / 'runtime' / 'template_catalog.json'
    assert digest(catalog) == patch['new_catalog_sha256'], 'CANDIDATE_CHANGED'
    original = json.loads((BASE / 'template_catalog.json').read_text())
    revised = json.loads(catalog.read_text())
    expected = json.loads(json.dumps(original))
    for tid, entry in patch['entries'].items():
        expected['templates'][tid] = entry
    assert revised == expected, 'UNEXPECTED_CATALOG_DELTA'
    allowed = {'B02.wb_events': {'version', 'purpose'}, 'B04.buyout_units_cohort': {'version', 'purpose'}}
    assert set(patch['entries']) == set(allowed), 'UNEXPECTED_TEMPLATE'
    for tid, keys in allowed.items():
        old, new = original['templates'][tid], revised['templates'][tid]
        assert set(old) == set(new), 'TEMPLATE_SCHEMA_CHANGED'
        assert {key for key in old if old[key] != new[key]} == keys, 'EXECUTION_FIELDS_CHANGED'
    test_log = (CANDIDATE / 'focused.log').read_text()
    assert 'Ran 76 tests' in test_log and test_log.rstrip().endswith('OK'), 'TEMPLATE_SUITE_FAILED'
    assert not TARGET.exists(), 'TARGET_EXISTS_INSPECT_RECEIPT'
    empty_queue()
    shutil.copytree(BASE, TARGET, copy_function=os.link, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    atomic(TARGET / 'template_catalog.json', catalog.read_bytes())
    updated = dict(manifest, artifact_id=TARGET.name, base_artifact=BASE.name, source_commit=source,
                   parent_manifest_sha256=digest(BASE / 'manifest.json'),
                   files={**manifest['files'], 'template_catalog.json': patch['new_catalog_sha256']})
    atomic(TARGET / 'manifest.json', json.dumps(updated, indent=2).encode())
    verify(BASE, manifest)
    verify(TARGET, updated)
    command('runuser', '-u', 'alice-market', '--', '/usr/bin/python3', '-B',
            '/opt/alice-market/releases/runtime-policy-guard-20261108/check.py',
            '--release', str(TARGET), '--config', '/etc/alice-market/market-runtime.json')
    directory = Path('/etc/systemd/system/alice-market.service.d')
    latest = max(directory.glob('*.conf'), key=lambda path: path.name)
    override = directory / (latest.stem + 'z-wb-buyout-date-v2.conf')
    assert not override.exists(), 'OVERRIDE_EXISTS'
    empty_queue()
    stopped = False
    try:
        command('systemctl', 'stop', 'alice-market.service')
        stopped = True
        empty_queue()
        assert show('WorkingDirectory') == str(BASE), 'BASE_CHANGED_DURING_STOP'
        verify(BASE, manifest)
        atomic(override, ('[Service]\nWorkingDirectory=' + str(TARGET) + '\nExecStart=\nExecStart=/usr/bin/python3 -B ' + str(TARGET) + '/runtime.py --config /etc/alice-market/market-runtime.json\n').encode())
        command('systemctl', 'daemon-reload')
        command('systemctl', 'start', 'alice-market.service')
        assert show('ActiveState') == 'active' and show('WorkingDirectory') == str(TARGET), 'NEW_RUNTIME_INACTIVE'
        verify(BASE, manifest)
        verify(TARGET, updated)
        result = dict(state='INSTALLED', source_commit=source, runtime=str(TARGET), base=str(BASE),
                      changed=['template_catalog.json'], base_unchanged=True,
                      execution_files_unchanged=True, tests=76, at=time.time())
        atomic(RECEIPT, json.dumps(result, indent=2).encode())
        print(json.dumps(result))
    except BaseException:
        if stopped:
            override.unlink(missing_ok=True)
            command('systemctl', 'daemon-reload')
            command('systemctl', 'restart', 'alice-market.service')
            assert show('ActiveState') == 'active' and show('WorkingDirectory') == str(BASE), 'ROLLBACK_FAILED'
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-commit', required=True)
    args = parser.parse_args()
    assert len(args.source_commit) == 40 and all(c in '0123456789abcdef' for c in args.source_commit)
    with open('/run/lock/alisa-market-config.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        main(args.source_commit)
