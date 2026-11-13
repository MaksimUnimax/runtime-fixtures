"""Finite current-store preference rollout. One additive table; three backend files."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/root/alisa-s09-voice-install-d11a9f2a-20261110/preference-a6d5e19a')
BASE = Path('/opt/alisa-platform/stage/releases/alisa-voice-selection-be0995ebb00e4649')
APP = BASE.parent / 'alisa-store-default-a6d5e19a87577d87'
SOURCE = 'a6d5e19a87577d876cdc811988df954682d4428b'
FILES = {'services/platform/src/alisa_platform/queries/models.py': 'fb66bb2c03f2032acdceb679c48ded790a25f5d1317b684e8b473f3aa43c4e85', 'services/platform/src/alisa_platform/queries/voice_dialogue.py': '8adc7c323fd61963bb6369865ed0f104f590afb39b391791499d9cacd708fce8', 'services/platform/src/alisa_platform/queries/migrations/0003_voicestorepreference.py': 'eaa24eba9bd504659a70961f1b117aa2c9a3bdbf173669a78d1b4fd1655539aa'}
OLD_FILES = {'services/platform/src/alisa_platform/queries/models.py': '7007ee4bca558b5b18e7c4f10df4243a2bbcde723dfbcce83852af501c6ca751', 'services/platform/src/alisa_platform/queries/voice_dialogue.py': 'af7ee2040eac0b00e3fa2934ff857ce658570cdbcb0ec96073541231075ab855'}
BASE_MANIFEST = 'fef0d541d42e1ca3b36c0a74f86d8f151d15bc52eb4a541a2d189dd655c346e7'
MIGRATION_HELPER = 'deb218dc4bc1da19bc14c60c4f203993d743ea556ffc492df6bc9b5cf290b1d1'
UNITS = ['alisa-platform@stage.service', 'alisa-runtime-authority-stage.service']
OTHERS = ['alice-market.service', 'alisa-web@stage.service', 'alisa-admin@stage.service',
          'alisa-identity@stage.service', 'alisa-station.service', 'alisa-store-check.service',
          'alisa-smtp-sandbox-stage.service']
CLEAN = 'alisa-account-cleanup@stage.service'
TIMER = 'alisa-account-cleanup@stage.timer'
PATHS = [Path('/etc/systemd/system/alisa-platform@stage.service.d/zzzzzzzzzzzzzzzzzzzzz-report-archive.conf'),
         Path('/etc/systemd/system/alisa-runtime-authority-stage.service.d/z-report-archive.conf'),
         Path('/etc/systemd/system/alisa-account-cleanup@stage.service.d/zzzzzzzzzzzzzzzzzzzz-alice-link-r1.conf')]


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=45).stdout.strip()


def prop(unit, key):
    return command('systemctl', 'show', unit, '--value', '--property=' + key)


def atomic(path, raw, mode):
    temp = path.with_name(path.name + '.collision-new')
    need(not temp.exists(), 'TEMP_EXISTS')
    previous = path.stat() if path.exists() else None
    try:
        with temp.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
            if previous:
                os.fchown(stream.fileno(), previous.st_uid, previous.st_gid)
        temp.chmod(mode)
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def record(name, value):
    atomic(ROOT / name, (json.dumps(value, indent=2) + '\n').encode(), 0o600)


def reserve():
    disk = os.statvfs('/opt')
    need(disk.f_bavail * disk.f_frsize > 3 * 1024**3 and disk.f_favail > 200000, 'RESOURCE_RESERVE')


def validate(path):
    manifest = json.loads((path / 'manifest.json').read_text())
    for name, digest in manifest['files'].items():
        p = path / name
        need(not Path(name).is_absolute() and '..' not in Path(name).parts and
             not p.is_symlink() and p.resolve().is_relative_to(path) and sha(p) == digest, 'FILE_HASH')
    for name, target in manifest.get('links', {}).items():
        p = path / name
        need(not Path(name).is_absolute() and '..' not in Path(name).parts and
             p.is_symlink() and os.readlink(p) == target and p.resolve().is_relative_to(path), 'LINK_HASH')
    return manifest


def current_base():
    need(sha(BASE / 'manifest.json') == BASE_MANIFEST and all(sha(BASE / name) == digest for name, digest in OLD_FILES.items()), 'BASE_MOVED')
    need(prop(UNITS[0], 'WorkingDirectory') == str(BASE) and
         prop(UNITS[1], 'WorkingDirectory') == str(BASE / 'services/platform'), 'ACTIVE_BASE_MOVED')
    need(all(prop(u, 'ActiveState') == 'active' for u in UNITS + [TIMER]), 'SERVICE_INACTIVE')


def prepare():
    reserve()
    need(not APP.exists() and not (ROOT / 'PREPARED.json').exists(), 'ALREADY_PREPARED')
    current_base()
    original = validate(BASE)
    need(all(sha(ROOT / 'payload' / name) == digest for name, digest in FILES.items()), 'PAYLOAD_CHANGED')
    selectors = []
    for path in PATHS:
        text = path.read_text()
        need(str(BASE) in text, 'SELECTOR_BASE')
        selectors.append({'path': str(path), 'sha256': sha(path)})
    shutil.copytree(BASE, APP, symlinks=True, copy_function=os.link)
    try:
        for name in FILES:
            target = APP / name
            target.parent.mkdir(parents=True, exist_ok=True)
            atomic(target, (ROOT / 'payload' / name).read_bytes(), 0o644)
        manifest = json.loads(json.dumps(original))
        manifest.update(artifact_id=APP.name, source_sha=SOURCE, base_release=BASE.name,
                        base_manifest_sha256=BASE_MANIFEST, voice_patch_source_sha=SOURCE)
        manifest['files'].update(FILES)
        for name, digest in manifest['files'].items():
            if '/migrations/' in name and name.endswith('.py') and not name.endswith('/__init__.py'):
                manifest['migrations'][name] = digest
        manifest['schema_compatibility']['platform_queries'] = ['0001_initial', '0002_voicedialogue', '0003_voicestorepreference']
        atomic(APP / 'manifest.json', (json.dumps(manifest, indent=2) + '\n').encode(), 0o644)
        validate(APP)
        current_base()
        reserve()
        record('SELECTORS.json', selectors)
        record('PREPARED.json', {'source': SOURCE, 'manifest_sha256': sha(APP / 'manifest.json'),
                                'changed_files': list(FILES), 'live_database_changes': False})
    except BaseException:
        shutil.rmtree(APP)  # Only this newly-created inactive candidate.
        raise


def plan():
    reserve()
    current_base()
    original, candidate = validate(BASE), validate(APP)
    receipt = json.loads((ROOT / 'PREPARED.json').read_text())
    need(receipt['source'] == SOURCE and sha(APP / 'manifest.json') == receipt['manifest_sha256'], 'CANDIDATE_MOVED')
    need(candidate['source_sha'] == SOURCE and all(sha(APP / name) == digest for name, digest in FILES.items()), 'PATCH_MOVED')
    need(set(original['files']) | set(FILES) == set(candidate['files']) and original.get('links') == candidate.get('links'), 'SCOPE_CHANGED')
    need(({p for p in original['files'] if original['files'][p] != candidate['files'][p]} | (set(candidate['files']) - set(original['files']))) == set(FILES), 'SCOPE_CHANGED')
    rows = []
    expected = json.loads((ROOT / 'SELECTORS.json').read_text())
    need([row['path'] for row in expected] == [str(p) for p in PATHS], 'SELECTOR_SCOPE')
    for path, saved in zip(PATHS, expected):
        need(sha(path) == saved['sha256'], 'SELECTOR_MOVED')
        old = path.read_bytes()
        need(str(BASE).encode() in old, 'SELECTOR_BASE')
        new = old.decode().replace(str(BASE), str(APP)).replace(BASE.name, APP.name).encode()
        rows.append({'path': path, 'old': old, 'new': new, 'mode': path.stat().st_mode & 0o777})
    return rows


def ready():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(20):
        try:
            with opener.open('http://127.0.0.1:18102/health/ready', timeout=2) as response:
                need(response.status == 200 and json.loads(response.read(4096))['release'] == APP.name, 'PLATFORM_HEALTH')
            raw = command('curl', '--silent', '--show-error', '--fail', '--max-time', '3', '--unix-socket',
                          '/run/alisa-runtime-rpc/authority/authority.sock', 'http://localhost/health/ready')
            need(json.loads(raw)['release'] == APP.name, 'AUTHORITY_HEALTH')
            return
        except Exception:
            if attempt == 19:
                raise RuntimeError('BACKEND_NOT_READY') from None
            time.sleep(.5)


def apply(rows):
    backup = ROOT / 'backup'
    backup.mkdir(mode=0o700)
    before = {u: {key: prop(u, key) for key in ['MainPID', 'WorkingDirectory', 'ActiveState']} for u in OTHERS}
    need(all(row['ActiveState'] == 'active' for row in before.values()), 'OTHER_SERVICE_INACTIVE')
    for i, row in enumerate(rows):
        (backup / (str(i) + '.conf')).write_bytes(row['old'])
    record('BEFORE.json', before)
    migration(True)
    changed = False
    try:
        for row in rows:
            need(row['path'].read_bytes() == row['old'], 'SELECTOR_MOVED_BEFORE_WRITE')
            atomic(row['path'], row['new'], row['mode'])
            changed = True
        command('systemctl', 'daemon-reload')
        for unit in UNITS:
            command('systemctl', 'restart', unit)
        ready()
        for attempt in range(40):
            if prop(CLEAN, 'ActiveState') not in {'active', 'activating', 'deactivating'}:
                break
            time.sleep(.5)
        else:
            raise RuntimeError('CLEANUP_BUSY')
        command('systemctl', 'start', CLEAN)
        need(prop(CLEAN, 'Result') == 'success' and prop(CLEAN, 'ExecMainStatus') == '0' and
             prop(TIMER, 'ActiveState') == 'active', 'CLEANUP_FAILED')
        need(all(all(prop(u, key) == value for key, value in row.items()) for u, row in before.items()), 'OTHER_SERVICE_CHANGED')
        reserve()
        record('ACTIVATED.json', {'status': 'INSTALLED_TECHNICAL_CHECKS_PASS', 'source': SOURCE,
                                 'release': APP.name, 'manifest_sha256': sha(APP / 'manifest.json'),
                                 'changed_files': list(FILES), 'restarted_only': UNITS,
                                 'other_services_unchanged': True, 'cleanup': 'PASS',
                                 'live_database_changes': True, 'migration': ['queries', '0003_voicestorepreference'], 'live_owner': 'NOT_PERFORMED'})
    except BaseException:
        if changed:
            for row in rows:
                need(row['path'].read_bytes() in [row['old'], row['new']], 'ROLLBACK_LATER_WRITER')
            for row in rows:
                if row['path'].read_bytes() == row['new']:
                    atomic(row['path'], row['old'], row['mode'])
            command('systemctl', 'daemon-reload')
            failures = []
            for unit in UNITS:
                try:
                    command('systemctl', 'restart', unit)
                except Exception:
                    failures.append(unit)
            record('ROLLED_BACK.json', {'status': 'ROLLBACK_NEEDS_ATTENTION' if failures else 'ROLLED_BACK',
                                       'restart_failures': failures, 'additive_preference_table_retained': True})
            need(not failures, 'ROLLBACK_RESTART_FAILED')
        raise


def migration(apply=False):
    need(sha(ROOT / 'migrate.py') == MIGRATION_HELPER, 'MIGRATION_HELPER_CHANGED')
    args = ['--apply'] if apply else []
    command(str(APP / '.venv/bin/python'), str(ROOT / 'migrate.py'), *args)
    if apply:
        receipt = json.loads((ROOT / 'MIGRATED.json').read_text())
        need(receipt['migration'] == ['queries', '0003_voicestorepreference'], 'MIGRATION_SCOPE')


if __name__ == '__main__':
    try:
        need(os.geteuid() == 0 and sys.argv[1:] in [['--prepare'], ['--check'], ['--apply']], 'ARGUMENTS')
        with Path('/run/lock/alisa-stage-rollout.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            if sys.argv[1] == '--prepare':
                prepare()
            else:
                rows = plan()
                migration(False)
                if sys.argv[1] == '--apply':
                    apply(rows)
            print(json.dumps({'status': 'PASS', 'operation': sys.argv[1]}))
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) and str(error).replace('_', '').isalnum() else type(error).__name__
        print(json.dumps({'status': 'BLOCKED', 'code': code}))
        raise SystemExit(1)
