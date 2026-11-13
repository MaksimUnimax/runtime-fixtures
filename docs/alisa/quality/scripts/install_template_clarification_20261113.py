"""Finite three-component update from exact qualified deltas, with one rollback."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a')
PAYLOAD = Path('/run/alisa-s09-clarification-payload-d11a9f2a')
SOURCE = '81579c18d4725c7f0a6603c8abbf703668863e36'
BASE = Path('/opt/alisa-platform/stage/releases/alisa-store-enrollment-592cc8bb006a4991')
APP = BASE.parent / ('alisa-template-clarification-' + SOURCE[:16])
NATIVE_BASE = Path('/opt/alice-market/releases/alisa-product-registry-count-r1-20261113')
NATIVE = NATIVE_BASE.parent / ('alisa-template-clarification-' + SOURCE[:16])
CURRENT = NATIVE_BASE.parent / 'current'
WEB_BASE = BASE.parent / 'alisa-cabinet-pages-1c9512728d2582bb'
WEB_APP = BASE.parent / ('alisa-cabinet-clarification-' + SOURCE[:16])
WEB = BASE.parent.parent / 'web-current'
WEB_VENV = BASE.parent / 'alisa-cabinet-multi-store-b481fbe9480ef13e/.venv'
BASE_SHA = '9373ffa589af852e2fef523fbd76d2d5d2e502eaa07720806d10a37f1cc71206'
NATIVE_SHA = '8a031bf7ab83904db83e57d8812db930efad315d02de2740437e3b07c1611ad2'
WEB_SHA = '07040de43b1b067052b83a9a397c0cc0f823186ba1eb84bbffee981545ff2b2c'
CORE_SHA = '82fa30057708d8f80900def2dc14e61f08d93c1605c5e5da9111d66b30e04dee'
PAIR_SHA = '194b45ba797b053544bff9db84a1e933da62db34dba6e55835121f66eb2f8fb9'
PROJECTION = Path('/etc/alisa-store-check/native-pair/scope.json')
VERSIONS = Path('/etc/alisa-platform/stage/runtime-versions.json')
LINK_ENV = Path('/etc/alisa-platform/stage/runtime-link.env')
SYNC = Path('/usr/local/libexec/alisa/runtime_versions_sync.py')
SELECTORS = [Path('/etc/systemd/system/alisa-platform@stage.service.d/zzzzzzzzzzzzzzzzzzzzz-report-archive.conf'),
    Path('/etc/systemd/system/alisa-runtime-authority-stage.service.d/z-report-archive.conf'),
    Path('/etc/systemd/system/alisa-account-cleanup@stage.service.d/zzzzzzzzzzzzzzzzzzzz-alice-link-r1.conf')]
BACKEND = ['alisa-runtime-authority-stage.service', 'alisa-platform@stage.service']
NATIVE_UNIT = 'alice-market.service'
CHECKER_UNIT = 'alisa-store-check.service'
WEB_UNIT = 'alisa-web@stage.service'
CLEAN = 'alisa-account-cleanup@stage.service'
OTHERS = ['alisa-admin@stage.service', 'alisa-identity@stage.service',
          'alisa-station.service', 'alisa-smtp-sandbox-stage.service']
ALL_UNITS = BACKEND + [NATIVE_UNIT, CHECKER_UNIT, WEB_UNIT] + OTHERS


def need(ok, code):
    if not ok: raise RuntimeError(code)


def sha(p): return hashlib.sha256(p.read_bytes()).hexdigest()


def run(*args, **kw):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=45, **kw).stdout.strip()


def prop(unit, key): return run('systemctl', 'show', unit, '--value', '-p', key)


def atomic(path, raw, mode=0o600):
    temp = path.with_name('.' + path.name + '.clarification-new')
    need(not temp.exists() and not temp.is_symlink(), 'TEMP_EXISTS')
    previous = path.stat() if path.exists() else None
    try:
        with temp.open('xb') as stream:
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            if previous: os.fchown(stream.fileno(), previous.st_uid, previous.st_gid)
        temp.chmod(mode); os.replace(temp, path)
    finally:
        if temp.exists(): temp.unlink()


def record(name, value): atomic(ROOT / name, (json.dumps(value, indent=2) + '\n').encode())


def reserve(extra=0, inodes=0):
    disk = os.statvfs('/opt')
    need(disk.f_bavail * disk.f_frsize > 3 * 1024**3 + extra and disk.f_favail > 200000 + inodes,
         'RESOURCE_RESERVE')


def safe(name):
    return type(name) is str and str(Path(name)) == name and not Path(name).is_absolute() and '..' not in Path(name).parts


def manifest(root):
    value = json.loads((root / 'manifest.json').read_text())
    need(not set(value['files']) & set(value.get('links', {})), 'MANIFEST_OVERLAP')
    for name, digest in value['files'].items():
        p = root / name
        need(safe(name) and not p.is_symlink() and p.resolve().is_relative_to(root) and sha(p) == digest, 'SOURCE_HASH')
    for name, target in value.get('links', {}).items():
        p = root / name
        need(safe(name) and p.is_symlink() and os.readlink(p) == target and p.resolve().is_relative_to(root), 'SOURCE_LINK')
    return value


def pair():
    """Reuse only the pinned, already reviewed owner-generation/version helpers."""
    path = ROOT / 'pair_helpers.py'; need(sha(path) == PAIR_SHA, 'PAIR_HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location('clarification_pair_helpers', path)
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    for name in ['ROOT', 'SOURCE', 'BASE', 'APP', 'NATIVE_BASE', 'NATIVE', 'CURRENT']:
        setattr(m, name, globals()[name])
    return m


def plan():
    value = json.loads((ROOT / 'PLAN.json').read_text())
    need(value['source'] == SOURCE and value['native_core_manifest'] == CORE_SHA, 'PLAN_SOURCE')
    need(set(value['platform_files']) == {
        'services/platform/src/alisa_platform/' + n for n in ['queries/models.py', 'queries/service.py',
        'queries/views.py', 'queries/voice.py', 'queries/voice_dialogue.py',
        'queries/migrations/0004_query_continuation.py', 'runtime_adapter/job_client.py']}, 'PLATFORM_SCOPE')
    need(set(value['native_files']) == {'template_clarification.py', 'tests/test_template_clarification_extension.py',
        'template_runtime.py', 'template_protocol.py', 'runtime_port.py', 'runtime_port_ipc.py',
        'repository.py', 'query_gap_terminal.py', 'tests/test_retention.py', 'tests/test_request_reliability.py'}, 'NATIVE_SCOPE')
    web = value['web_manifest']
    need(web['source_sha'] == SOURCE and web['artifact_id'] == WEB_APP.name, 'WEB_SOURCE')
    package = value['package_manifest']
    need(package['source_sha'] == SOURCE and value['platform_files'] ==
         {n: package['files'][n] for n in value['platform_files']}, 'PACKAGE_PLATFORM_SOURCE')
    need(web['files'] == {n: h for n, h in package['files'].items()
         if n.startswith('ui/web/') or n == 'infra/launch.py'} and web.get('links', {}) ==
         {n: h for n, h in package.get('links', {}).items() if n.startswith('ui/web/')}, 'PACKAGE_WEB_SOURCE')
    need(all(safe(n) and (n.startswith('ui/web/') or n == 'infra/launch.py')
         for n in [*web['files'], *web.get('links', {})]), 'WEB_SCOPE')
    need(sha(ROOT / 'pair_helpers.py') == PAIR_SHA and sha(ROOT / 'migrate.py') == value['migration_helper'], 'HELPER_CHANGED')
    for name, digest in value['payload'].items():
        p = PAYLOAD / name
        need(safe(name) and not p.is_symlink() and p.resolve().is_relative_to(PAYLOAD) and sha(p) == digest, 'PAYLOAD_CHANGED')
    return value


def base_check():
    reserve()
    need(CURRENT.is_symlink() and CURRENT.resolve() == NATIVE_BASE and
         WEB.is_symlink() and WEB.resolve() == WEB_BASE, 'BASE_SELECTOR_MOVED')
    need(sha(BASE / 'manifest.json') == BASE_SHA and sha(NATIVE_BASE / 'manifest.json') == NATIVE_SHA and
         sha(WEB_BASE / 'manifest.json') == WEB_SHA, 'BASE_MANIFEST_MOVED')
    need(prop(BACKEND[1], 'WorkingDirectory') == str(BASE) and
         prop(BACKEND[0], 'WorkingDirectory') == str(BASE / 'services/platform'), 'BACKEND_MOVED')
    need(Path(prop(WEB_UNIT, 'WorkingDirectory')).resolve() == WEB_BASE, 'WEB_MOVED')
    need(Path('/proc/' + prop(NATIVE_UNIT, 'MainPID') + '/cwd').resolve() == NATIVE_BASE, 'NATIVE_PROCESS_MOVED')
    need((BASE / '.venv').is_dir() and not (BASE / '.venv').is_symlink()
         and (WEB_BASE / '.venv').resolve() == WEB_VENV, 'BASE_DEPENDENCIES_CHANGED')
    need(all(prop(u, 'ActiveState') == 'active' for u in ALL_UNITS), 'SERVICE_INACTIVE')
    return manifest(BASE), manifest(NATIVE_BASE), manifest(WEB_BASE)


def copy_release(source, target, old, new, kind):
    target.mkdir(mode=0o755)
    for name, digest in new['files'].items():
        p = target / name; p.parent.mkdir(parents=True, exist_ok=True)
        if old['files'].get(name) == digest: os.link(source / name, p)
        else: atomic(p, (PAYLOAD / kind / name).read_bytes(), 0o644)
    for name, dest in new.get('links', {}).items():
        p = target / name; p.parent.mkdir(parents=True, exist_ok=True); p.symlink_to(dest)
    if kind == 'platform': (target / '.venv').symlink_to(BASE / '.venv', target_is_directory=True)
    if kind == 'web': (target / '.venv').symlink_to(WEB_VENV, target_is_directory=True)
    atomic(target / 'manifest.json', (json.dumps(new, indent=2) + '\n').encode(), 0o644)
    manifest(target)


def candidate_manifests(value, old):
    platform, native, web = [json.loads(json.dumps(x)) for x in old]
    platform.update(artifact_id=APP.name, source_sha=SOURCE, base_release=BASE.name,
        base_manifest_sha256=BASE_SHA, template_clarification_source=SOURCE, dependency_base=str(BASE / '.venv'))
    platform['files'].update(value['platform_files'])
    platform['migrations'].update({n: h for n, h in value['platform_files'].items() if '/migrations/' in n})
    platform['schema_compatibility']['platform_queries'] = ['0001_initial', '0002_voicedialogue',
        '0003_voicestorepreference', '0004_query_continuation']
    core_path = PAYLOAD / 'native/CURRENT_CORE_MANIFEST.json'; need(sha(core_path) == CORE_SHA, 'CORE_CHANGED')
    core = json.loads(core_path.read_text())
    expected = {n: h for n, h in native['files'].items() if n != 'CURRENT_CORE_MANIFEST.json'}
    expected.update(value['native_files']); need(core['files'] == expected, 'NATIVE_UNTOUCHED_FILES_CHANGED')
    native.update(artifact_id=NATIVE.name, source_commit=SOURCE, base_release=NATIVE_BASE.name,
        base_manifest_sha256=NATIVE_SHA, parallel_source_commit=native.get('source_commit'), template_clarification_source=SOURCE)
    native['files'] = {**core['files'], 'CURRENT_CORE_MANIFEST.json': CORE_SHA}
    web = value['web_manifest']; need(web['locks'] == old[2]['locks'], 'WEB_DEPENDENCIES_CHANGED')
    return platform, native, web


def budget(old, new):
    total = inodes = 0
    for kind, previous, candidate in zip(['platform', 'native', 'web'], old, new):
        directories = {str(p) for n in [*candidate['files'], *candidate.get('links', {})]
                       for p in Path(n).parents if str(p) != '.'}
        changed = [n for n, h in candidate['files'].items() if previous['files'].get(n) != h]
        total += sum((PAYLOAD / kind / n).stat().st_size for n in changed)
        total += len(directories) * 8192 + len(candidate['files']) * 512 + 4 * 1024**2
        inodes += len(directories) + len(candidate['files']) + len(candidate.get('links', {})) + 3
    return total, inodes


def prepare(value):
    old = base_check(); need(not any(p.exists() for p in [APP, NATIVE, WEB_APP]) and
        not (ROOT / 'PREPARED.json').exists(), 'CANDIDATE_EXISTS')
    new = candidate_manifests(value, old); extra, inodes = budget(old, new); reserve(extra, inodes)
    created = []
    try:
        for source, target, a, b, kind in zip([BASE, NATIVE_BASE, WEB_BASE], [APP, NATIVE, WEB_APP],
                old, new, ['platform', 'native', 'web']):
            created.append(target); copy_release(source, target, a, b, kind)
        saved = {str(p): {'sha256': sha(p), 'mode': p.stat().st_mode & 0o777}
                 for p in SELECTORS + [VERSIONS, PROJECTION, LINK_ENV]}
        record('SELECTORS.json', saved); base_check(); reserve()
        record('PREPARED.json', {'source': SOURCE, 'manifests': {str(p): sha(p / 'manifest.json')
            for p in [APP, NATIVE, WEB_APP]}, 'budget_bytes': extra, 'live_database_changes': False,
            'live_service_changes': False, 'dependency_bases': [str(BASE / '.venv'), str(WEB_VENV)]})
    except BaseException:
        for p in reversed(created):
            if p.exists(): shutil.rmtree(p)
        raise


def migration(apply=False):
    args = ['--apply'] if apply else []
    run(str(APP / '.venv/bin/python'), '-B', str(ROOT / 'migrate.py'), *args)


def check(value):
    bases = base_check(); wanted = candidate_manifests(value, bases)
    prepared = json.loads((ROOT / 'PREPARED.json').read_text())
    need(prepared['source'] == SOURCE, 'PREPARED_SOURCE')
    for p, expected in zip([APP, NATIVE, WEB_APP], wanted):
        need(sha(p / 'manifest.json') == prepared['manifests'][str(p)], 'CANDIDATE_CHANGED')
        need(manifest(p) == expected, 'CANDIDATE_PLAN_MISMATCH')
    need((APP / '.venv').is_symlink() and os.readlink(APP / '.venv') == str(BASE / '.venv') and
         (WEB_APP / '.venv').is_symlink() and os.readlink(WEB_APP / '.venv') == str(WEB_VENV), 'DEPENDENCY_REFERENCE_CHANGED')
    saved = json.loads((ROOT / 'SELECTORS.json').read_text())
    need(set(saved) == {str(p) for p in SELECTORS + [VERSIONS, PROJECTION, LINK_ENV]}, 'SELECTOR_SCOPE')
    for name, row in saved.items(): need(sha(Path(name)) == row['sha256'], 'SELECTOR_MOVED')
    pair().expected_version_bytes(NATIVE); migration(); return saved


def pointer(path, target):
    temp = path.with_name(path.name + '.clarification-new')
    need(not temp.exists() and not temp.is_symlink(), 'LINK_TEMP_EXISTS')
    temp.symlink_to(str(target)); os.replace(temp, path)


def ready(app=APP, web=WEB_APP):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(30):
        try:
            for port, target in [(18102, app), (18100, web)]:
                with opener.open('http://127.0.0.1:' + str(port) + '/health/ready', timeout=2) as response:
                    need(response.status == 200 and json.loads(response.read(8192))['release'] == target.name, 'HEALTH_RELEASE')
            data = json.loads(run('curl', '--silent', '--show-error', '--fail', '--max-time', '3', '--unix-socket',
                '/run/alisa-runtime-rpc/authority/authority.sock', 'http://localhost/health/ready'))
            need(data['release'] == app.name and all(prop(u, 'ActiveState') == 'active' for u in ALL_UNITS), 'SERVICE_HEALTH')
            return
        except Exception:
            if attempt == 29: raise RuntimeError('HEALTH_FAILED') from None
            time.sleep(.5)


def cleanup_probe():
    for _ in range(40):
        if prop(CLEAN, 'ActiveState') not in ['active', 'activating', 'deactivating']: break
        time.sleep(.5)
    else: raise RuntimeError('CLEANUP_BUSY')
    run('systemctl', 'start', CLEAN)
    need(prop(CLEAN, 'Result') == 'success' and prop(CLEAN, 'ExecMainStatus') == '0', 'CLEANUP_FAILED')


def rollback(old, expected, modes, original, lock):
    for p in SELECTORS + [VERSIONS, PROJECTION, LINK_ENV]:
        need(p.read_bytes() in [old[p], expected.get(p, old[p])], 'ROLLBACK_LATER_WRITER')
    need(CURRENT.resolve() in [NATIVE, NATIVE_BASE] and WEB.resolve() in [WEB_APP, WEB_BASE], 'ROLLBACK_LATER_SELECTOR')
    failures = []
    def attempt(label, action):
        try: action()
        except BaseException: failures.append(label)
    for p in SELECTORS + [VERSIONS]: attempt(str(p), lambda p=p: atomic(p, old[p], modes[str(p)]['mode']))
    attempt('native_pointer', lambda: pointer(CURRENT, NATIVE_BASE))
    attempt('web_pointer', lambda: pointer(WEB, WEB_BASE))
    m = pair(); attempt('versions', lambda: m.sync(NATIVE_BASE, lock))
    attempt('reload', lambda: run('systemctl', 'daemon-reload'))
    attempt('native', lambda: run('systemctl', 'restart', NATIVE_UNIT))
    attempt('owner_pair', lambda: m.refresh_projection(original))
    for u in BACKEND + [WEB_UNIT]: attempt(u, lambda u=u: run('systemctl', 'restart', u))
    attempt('health', lambda: ready(BASE, WEB_BASE))
    record('ROLLED_BACK.json', {'status': 'ROLLBACK_NEEDS_ATTENTION' if failures else 'ROLLED_BACK',
        'failures': failures, 'additive_column_and_default_retained': True})
    return failures


def activate(value, saved, lock):
    need(not (ROOT / 'backup').exists() and not (ROOT / 'ACTIVATED.json').exists(), 'ALREADY_STARTED')
    m = pair(); original = m.projection_data(); before = {u: {k: prop(u, k) for k in ['MainPID', 'WorkingDirectory']}
        for u in OTHERS}; old = {Path(n): Path(n).read_bytes() for n in saved}
    expected = {p: old[p] for p in old}
    for p in SELECTORS:
        need(str(BASE) in old[p].decode(), 'SELECTOR_BASE')
        expected[p] = old[p].decode().replace(str(BASE), str(APP)).replace(BASE.name, APP.name).encode()
    expected[VERSIONS] = m.expected_version_bytes(NATIVE)
    (ROOT / 'backup').mkdir(mode=0o700)
    for i, (p, raw) in enumerate(old.items()): atomic(ROOT / 'backup' / str(i), raw)
    record('BACKUP_INDEX.json', [str(p) for p in old])
    migration(True); changed = False
    try:
        for p in SELECTORS:
            need(p.read_bytes() == old[p], 'SELECTOR_MOVED')
            changed = True; atomic(p, expected[p], saved[str(p)]['mode'])
        run('systemctl', 'daemon-reload')
        # Keep an old application from receiving the new NEEDS_INPUT state while
        # its parser is still loaded; start the new application after new pins.
        for u in BACKEND: run('systemctl', 'stop', u)
        pointer(CURRENT, NATIVE); m.sync(NATIVE, lock); run('systemctl', 'restart', NATIVE_UNIT)
        m.refresh_projection(original, on_write=lambda raw: expected.update({PROJECTION: raw}))
        for u in BACKEND: run('systemctl', 'start', u)
        pointer(WEB, WEB_APP); run('systemctl', 'restart', WEB_UNIT)
        ready(); cleanup_probe(); m.projection_data(); reserve()
        need(all(all(prop(u, k) == v for k, v in row.items()) for u, row in before.items()), 'OTHER_SERVICE_CHANGED')
        record('ACTIVATED.json', {'status': 'INSTALLED_TECHNICAL_CHECKS_PASS', 'source': SOURCE,
            'platform_release': APP.name, 'native_release': NATIVE.name, 'web_release': WEB_APP.name,
            'restarted': BACKEND + [NATIVE_UNIT, CHECKER_UNIT, WEB_UNIT], 'other_four_unchanged': True,
            'live_owner': 'NOT_PERFORMED', 'model_or_marketplace_calls': 0, 'migration': ['queries', '0004_query_continuation']})
    except BaseException:
        if changed: rollback(old, expected, saved, original, lock)
        raise


if __name__ == '__main__':
    try:
        need(os.geteuid() == 0 and sys.argv[1:] in [['--prepare'], ['--check'], ['--apply']], 'ARGUMENTS')
        with Path('/run/lock/alisa-stage-rollout.lock').open('a') as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB); value = plan()
            if sys.argv[1:] == ['--prepare']: prepare(value)
            else:
                saved = check(value)
                if sys.argv[1:] == ['--apply']: activate(value, saved, lock)
        print(json.dumps({'status': 'PASS', 'operation': sys.argv[1]}))
    except Exception as error:
        code = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        print(json.dumps({'status': 'BLOCKED', 'code': code})); raise SystemExit(1)
