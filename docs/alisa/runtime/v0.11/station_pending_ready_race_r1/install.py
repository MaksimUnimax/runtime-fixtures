"""Finite one-file Station rollout; preserve settings, credentials and hardening."""
from pathlib import Path
import fcntl
import hashlib
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import time

SOURCE = sys.argv[1]
BASE = Path('/opt/alisa-station/releases/station-request-economics-r1-20261113')
CANDIDATE = Path('/opt/alisa-station/candidates/station-pending-ready-race-20261113')
DEST = Path('/opt/alisa-station/releases/station-pending-ready-race-r1-20261113')
TESTS = Path('/opt/alisa-station/candidates/pending-ready-race-tests-20261113')
DROPIN = Path('/etc/systemd/system/alisa-station.service.d/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz-ack-eta-r2-20261110.conf')
BASE_MANIFEST = 'c6d2dfebeed451cdb093075468dcd3b8b3328c6f3b65b3dff2aa9405f689a116'
BASE_SERVICE = '4d08b6328bc3a4187fdb540103bb518470bcfed2ab73a99bca1b0d5e46ad2fac'
CANDIDATE_SERVICE = 'bd52db81254164955a119310b743e8ebd3e69a03fd400d771653b8944482d89c'
DROPIN_SHA = '7c8f35b8fa99f5ba5be56fdbe2d24ab8df69f137df17396c91009af72aa6ecbe'
PROPERTIES = ('User', 'Group', 'UMask', 'NoNewPrivileges', 'PrivateTmp',
    'ProtectHome', 'ProtectSystem', 'ReadWritePaths', 'RestrictSUIDSGID',
    'LockPersonality', 'MemoryMax', 'TasksMax', 'TimeoutStopUSec', 'LoadCredential',
    'CapabilityBoundingSet', 'ProtectKernelTunables', 'ProtectKernelModules',
    'ProtectControlGroups', 'Environment', 'EnvironmentFiles', 'Restart', 'RestartUSec')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT, timeout=60).strip()


def properties():
    return command('systemctl', 'show', 'alisa-station', *('--property='+key for key in PROPERTIES))


def quiet():
    with sqlite3.connect('file:/var/lib/alice-market/state.sqlite3?mode=ro', uri=True) as conn:
        assert conn.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0] == 0, 'ACTIVE_JOB'
    for path in Path('/var/lib/alisa-station/users').glob('*/state.json'):
        state = json.loads(path.read_text())
        assert not state.get('uncertain'), 'DELIVERY_OUTCOME_UNKNOWN'
        assert (state.get('job') or {}).get('delivery') not in ('waiting', 'sending', 'accepted_waiting_skill'), 'ACTIVE_DELIVERY'


def replace_config(raw, metadata):
    pending = DROPIN.with_name(DROPIN.name+'.pending-ready-next')
    fd = os.open(pending, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(pending, metadata.st_uid, metadata.st_gid)
        os.chmod(pending, metadata.st_mode & 0o777)
        os.replace(pending, DROPIN)
    finally:
        pending.unlink(missing_ok=True)


with open('/run/lock/alisa-runtime-recovery.lock', 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    assert len(SOURCE) == 40 and all(char in '0123456789abcdef' for char in SOURCE)
    assert command('systemctl', 'is-active', 'alisa-station') == 'active'
    assert command('systemctl', 'show', 'alisa-station', '--property=WorkingDirectory', '--value') == str(BASE)
    assert sha(BASE/'manifest.json') == BASE_MANIFEST and sha(BASE/'service.py') == BASE_SERVICE
    assert sha(CANDIDATE/'service.py') == CANDIDATE_SERVICE
    assert sha(TESTS/'test_pending_ready_transition.py') == '787b77cfef961e5cceb0bfff2a9293b41fc975d242eac9ff6d5d98626b2d7dd4'
    assert sha(DROPIN) == DROPIN_SHA and not DROPIN.is_symlink()
    log = (TESTS/'focused.log').read_text()
    assert 'Ran 67 tests' in log and '\nOK\n' in log, 'CHECKS_NOT_PASS'
    assert not DEST.exists(), 'RELEASE_EXISTS'
    quiet()
    before_properties = properties()
    manifest = json.loads((BASE/'manifest.json').read_text())
    assert all(sha(BASE/name) == digest for name, digest in manifest['files'].items())
    assert [name for name, digest in manifest['files'].items() if sha(CANDIDATE/name) != digest] == ['service.py']
    before_config = DROPIN.read_bytes()
    metadata = DROPIN.stat()
    lines = before_config.decode().splitlines(keepends=True)
    changed = 0
    for index, line in enumerate(lines):
        if line.startswith(('WorkingDirectory=', 'ExecStart=')) and str(BASE) in line:
            lines[index] = line.replace(str(BASE), str(DEST))
            changed += 1
    assert changed == 2, 'UNIT_PATHS_CHANGED'
    after_config = ''.join(lines).encode()
    backup = TESTS/'station-dropin.before.conf'
    assert not backup.exists()
    backup.write_bytes(before_config)
    backup.chmod(0o600)
    shutil.copytree(BASE, DEST, copy_function=os.link, ignore=shutil.ignore_patterns('__pycache__'))
    (DEST/'service.py').unlink()
    shutil.copy2(CANDIDATE/'service.py', DEST/'service.py')
    manifest.update(artifact_id=DEST.name, source_commit=SOURCE,
        base_release=BASE.name, base_manifest_sha256=BASE_MANIFEST,
        source_kind='exact_base_plus_pending_terminal_delivery_race_fix')
    manifest['files'] = {str(path.relative_to(DEST)): sha(path)
        for path in sorted(DEST.rglob('*')) if path.is_file() and path.name != 'manifest.json'}
    pending_manifest = DEST/'manifest.next.json'
    pending_manifest.write_text(json.dumps(manifest, indent=2)+'\n')
    os.replace(pending_manifest, DEST/'manifest.json')
    original = json.loads((BASE/'manifest.json').read_text())
    assert sha(BASE/'manifest.json') == BASE_MANIFEST
    assert all(sha(BASE/name) == digest for name, digest in original['files'].items())
    try:
        command('systemctl', 'stop', 'alisa-station')
        quiet()
        assert sha(DROPIN) == DROPIN_SHA
        replace_config(after_config, metadata)
        command('systemctl', 'daemon-reload')
        assert properties() == before_properties, 'HARDENING_CHANGED'
        command('systemctl', 'start', 'alisa-station')
        for _ in range(25):
            pid = int(command('systemctl', 'show', 'alisa-station', '--property=MainPID', '--value'))
            if pid > 0 and Path('/proc/'+str(pid)+'/cwd').resolve() == DEST:
                break
            time.sleep(.2)
        else:
            raise RuntimeError('NEW_RELEASE_NOT_ACTIVE')
        assert command('systemctl', 'is-active', 'alisa-station') == 'active'
        assert sha(DROPIN) == hashlib.sha256(after_config).hexdigest()
        assert properties() == before_properties
    except BaseException:
        command('systemctl', 'stop', 'alisa-station')
        current_config = DROPIN.read_bytes()
        if current_config == after_config:
            replace_config(before_config, metadata)
        command('systemctl', 'daemon-reload')
        command('systemctl', 'start', 'alisa-station')
        raise
    record = {'status': 'INSTALLED', 'source_commit': SOURCE, 'release': DEST.name,
        'changed_payload_files': ['service.py'], 'service_sha256': sha(DEST/'service.py'),
        'native_tests': 67, 'test_user': 'alice-lab', 'independent_review': 'APPROVED',
        'credentials_and_hardening_unchanged': True, 'settings_not_modified': True}
    (TESTS/'INSTALLED.json').write_text(json.dumps(record, indent=2)+'\n')
    print(json.dumps(record))
