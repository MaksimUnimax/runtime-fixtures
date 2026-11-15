"""Finite, pinned customer web/platform/identity rollout. No migrations or grants."""
import fcntl
import ctypes
import errno
import hashlib
import json
import os
import re
import signal
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.request
from pathlib import Path

SOURCE = '8b8b919993c3812898e14367c161aa4cf9fcf6e6'
TAR_SHA = '3635cda397ba95f4df21b37901844e30ad4561c0671b82623a4089363ba6a6f6'
STAGE = Path('/opt/alisa-platform/stage')
ROOT = Path('/root/alisa-login-catalog-install-20261115')
PAYLOAD = Path('/dev/shm/alisa-login-catalog-8b8b9199-20261115/platform/alisa-8b8b919993c38128')
BASE = STAGE/'releases/alisa-cabinet-parameters-1d572aebf6b05b88'
PLATFORM_BASE = STAGE/'releases/alisa-parameters-1d572aebf6b05b88'
IDENTITY_BASE = STAGE/'releases/alisa-direct-login-3a1d3885250d8aa1'
APP = STAGE/'releases/alisa-customer-catalog-8b8b919993c38128'
IDENTITY = STAGE/'releases/alisa-customer-identity-8b8b919993c38128'
WEB_LINK = STAGE/'web-current'
IDENTITY_LINK = STAGE/'identity-current'
WEB = 'alisa-web@stage.service'
PLATFORM = 'alisa-platform@stage.service'
IDP = 'alisa-identity@stage.service'
PRESERVE = ['alice-market.service', 'alisa-runtime-authority-stage.service',
            'alisa-admin@stage.service', 'alisa-station.service',
            'alisa-store-check.service', 'alisa-smtp-sandbox-stage.service']
DROP = Path('/etc/systemd/system')/(PLATFORM+'.d')/('z'*80+'-customer-catalog.conf')
LOCK = Path('/run/lock/alisa-stage-rollout.lock')
PINS = {
    BASE: '66e237cee602f98ba4a0b5486b012edd0a9e22e7859b75212cd470d7120335dd',
    PLATFORM_BASE: '1c9911c9615309c66056588cdb28458beb57ce54abc3f577278606cd83736a21',
    IDENTITY_BASE: 'de72847f71c6145b54d008ea46d3f18b111a28a3ecdf179bcb7cd6ce786f0e5e',
    STAGE/'releases/alisa-06f3c053e7719290': '2a5c430bde4bc5fd8593958481d3cfd79baf9552b178ffdd1ced6175526166c9',
    Path('/opt/alice-market/releases/alisa-parameters-1d572aebf6b05b88'): '20c5afddbc8f07c86e72a33676d4475c4b23b7c0316bc73f814e51dc5a60e95e',
}
ENV_FILES = ['web.env', 'platform.env', 'identity.env', 'runtime-link.env',
             'alice-link.env', 'query-insights.env', 'question-catalog.env']


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(path):
    h = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024*1024), b''):
            h.update(block)
    return h.hexdigest()


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True, timeout=45)
    need(result.returncode == 0, 'COMMAND_FAILED_'+Path(args[0]).name)
    return result.stdout.strip()


def prop(unit, name):
    return run('systemctl', 'show', unit, '--value', '-p', name)


def atomic(path, raw, mode=0o600):
    temp = path.with_name('.'+path.name+'.customer-catalog-new')
    need(not temp.exists() and not temp.is_symlink(), 'TEMP_EXISTS')
    try:
        with temp.open('xb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        temp.chmod(mode)
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def atomic_copy(path, source, digest):
    """One MiB buffer, independent of the admitted file size."""
    temp = path.with_name('.'+path.name+'.customer-catalog-new')
    need(not temp.exists() and not temp.is_symlink(), 'TEMP_EXISTS')
    try:
        with source.open('rb') as src, temp.open('xb') as dst:
            while block := src.read(1024*1024):
                dst.write(block)
            dst.flush()
            os.fsync(dst.fileno())
        need(sha(temp) == digest, 'COPY_HASH')
        temp.chmod(0o644)
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def record(name, value):
    atomic(ROOT/name, (json.dumps(value, indent=2)+'\n').encode())


def safe(name):
    p = Path(name)
    return type(name) is str and not p.is_absolute() and '..' not in p.parts and str(p) == name


def manifest(root):
    value = json.loads((root/'manifest.json').read_text())
    need(not set(value['files']) & set(value.get('links', {})), 'MANIFEST_OVERLAP')
    for name, digest in value['files'].items():
        p = root/name
        need(safe(name) and not p.is_symlink() and p.resolve().is_relative_to(root) and sha(p) == digest, 'FILE_HASH')
    for name, dest in value.get('links', {}).items():
        p = root/name
        need(safe(name) and p.is_symlink() and os.readlink(p) == dest and p.resolve().is_relative_to(root), 'FILE_LINK')
    return value


def exact_tree(root, value, extra=()):
    leaves = set(value['files']) | set(value.get('links', {})) | {'manifest.json'} | set(extra)
    directories = {str(p) for name in leaves for p in Path(name).parents if str(p) != '.'}
    seen = set()
    pending = [root]
    while pending:
        directory = pending.pop()
        with os.scandir(directory) as entries:
            for entry in entries:
                name = str(Path(entry.path).relative_to(root))
                need(name in leaves or name in directories, 'UNDECLARED_RELEASE_ENTRY')
                need(name not in seen and len(seen) < len(leaves)+len(directories), 'RELEASE_TREE_BOUND')
                seen.add(name)
                if entry.is_dir(follow_symlinks=False):
                    need(name in directories, 'RELEASE_ENTRY_TYPE')
                    pending.append(Path(entry.path))
                else:
                    need(name in leaves and (entry.is_file(follow_symlinks=False) or entry.is_symlink()), 'RELEASE_ENTRY_TYPE')
    need(seen == leaves | directories, 'RELEASE_TREE_MISSING')


def candidate_manifest(root, base, ownership=None):
    value = manifest(root)
    extra = {'.venv'}
    need((root/'.venv').is_symlink() and os.readlink(root/'.venv') == str(base/'.venv') and
         (root/'.venv').resolve() == (base/'.venv').resolve(), 'CANDIDATE_VENV')
    if ownership is not None:
        marker = root/'.customer-catalog-preparation.json'
        need(not marker.is_symlink() and json.loads(marker.read_text()) == ownership, 'PREPARATION_OWNER')
        extra.add(marker.name)
    exact_tree(root, value, extra)
    return value


def package_manifest(payload, archive, digest):
    need(sha(archive) == digest, 'PACKAGE_TAR_HASH')
    with tarfile.open(archive, 'r:gz') as package:
        entry = package.getmember(payload.name+'/manifest.json')
        need(entry.isfile() and 0 < entry.size <= 2*1024*1024, 'PACKAGE_MANIFEST_BOUND')
        raw = package.extractfile(entry).read(2*1024*1024+1)
    need((payload/'manifest.json').read_bytes() == raw, 'PACKAGE_MANIFEST_CHANGED')
    value = manifest(payload)
    need(value == json.loads(raw), 'PACKAGE_MANIFEST_CHANGED')
    exact_tree(payload, value)
    return value


def static(unit):
    result = {k: prop(unit, k) for k in ['WorkingDirectory', 'DropInPaths', 'EnvironmentFiles']}
    start = prop(unit, 'ExecStart')
    match = re.search(r'argv\[\]=(.*?) ; ignore_errors=', start)
    need(match, 'UNIT_COMMAND_SHAPE')
    result['argv'] = match[1]
    result['drop_hashes'] = {p: sha(p) for p in result['DropInPaths'].split()}
    return result


def protected():
    return {'pins': {str(p): sha(p/'manifest.json') for p in PINS},
            'units': {u: static(u) for u in PRESERVE},
            'links': {n: str((STAGE/n).resolve()) for n in ['admin-current', 'current']},
            'native': str(Path('/opt/alice-market/releases/current').resolve()),
            'environment_hashes': {n: sha(Path('/etc/alisa-platform/stage')/n) for n in ENV_FILES}}


def active(units):
    need(all(prop(u, 'ActiveState') == 'active' for u in units), 'SERVICE_INACTIVE')


def idle():
    v = json.loads(Path('/etc/alice-market/market-runtime.json').read_text())
    with sqlite3.connect(Path(v['database']).as_uri()+'?mode=ro', uri=True, timeout=2) as db:
        need(db.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0] == 0, 'ACTIVE_JOBS')


def reserve(extra=0, inodes=0):
    disk = os.statvfs(STAGE)
    need(disk.f_bavail*disk.f_frsize > 3*1024**3+extra and disk.f_favail > 200000+inodes, 'RESOURCE_RESERVE')


def drop_bytes():
    return ('[Service]\nWorkingDirectory='+str(APP)+'\nExecStart=\nExecStart='+str(APP/'.venv/bin/python')+' '+str(APP/'infra/launch.py')+' platform\n').encode()


def materialize(base, target, value, sources, pool, ownership=None):
    target.mkdir(mode=0o755)
    if ownership is not None:
        atomic(target/'.customer-catalog-preparation.json', (json.dumps(ownership)+'\n').encode(), 0o644)
    for name, digest in value['files'].items():
        dst = target/name
        dst.parent.mkdir(parents=True, exist_ok=True)
        if digest in pool:
            need(sha(pool[digest]) == digest, 'DEDUP_SOURCE_CHANGED')
            os.link(pool[digest], dst)
        else:
            src = sources[name]
            need(sha(src) == digest, 'PAYLOAD_CHANGED')
            atomic_copy(dst, src, digest)
    for name, dest in value.get('links', {}).items():
        dst = target/name
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.symlink_to(dest)
    (target/'.venv').symlink_to(base/'.venv', target_is_directory=True)
    atomic(target/'manifest.json', (json.dumps(value, indent=2)+'\n').encode(), 0o644)
    manifest(target)


def prepare():
    reserve()
    idle()
    active([WEB, PLATFORM, IDP]+PRESERVE)
    need(not any(p.exists() for p in [APP, IDENTITY, ROOT/'PLAN.json', ROOT/'PREPARING.json', DROP]), 'CANDIDATE_EXISTS')
    need(WEB_LINK.is_symlink() and WEB_LINK.resolve() == BASE and IDENTITY_LINK.is_symlink() and IDENTITY_LINK.resolve() == IDENTITY_BASE, 'BASE_SELECTOR')
    for p, digest in PINS.items():
        need(sha(p/'manifest.json') == digest, 'BASE_PIN')
    before = protected()
    units = {u: static(u) for u in [WEB, PLATFORM, IDP]}
    need(Path(units[PLATFORM]['WorkingDirectory']).resolve() == PLATFORM_BASE, 'PLATFORM_BASE')
    tar = PAYLOAD.parents[1]/'alisa-8b8b919993c38128.tar.gz'
    package = package_manifest(PAYLOAD, tar, TAR_SHA)
    need(package['source_sha'] == SOURCE, 'PACKAGE_SOURCE')
    old = {p: manifest(p) for p in [BASE, PLATFORM_BASE, IDENTITY_BASE]}
    for service, base in [('platform', BASE), ('identity', IDENTITY_BASE)]:
        lock = 'services/'+service+'/requirements.lock'
        need(package['locks'][lock] == old[base]['locks'][lock], 'DEPENDENCY_CHANGE')
        prefix = 'services/'+service+'/'
        need({n:h for n,h in package['migrations'].items() if n.startswith(prefix)} ==
             {n:h for n,h in old[base]['migrations'].items() if n.startswith(prefix)}, 'MIGRATION_CHANGE')
    pool = {}
    for base, m in old.items():
        for n, h in m['files'].items():
            pool.setdefault(h, base/n)
    targets = []
    for base, target, kind in [(BASE, APP, 'app'), (IDENTITY_BASE, IDENTITY, 'identity')]:
        value = json.loads(json.dumps(old[base]))
        selected = {n:h for n,h in package['files'].items() if
                    (kind == 'app' and (n.startswith(('ui/web/', 'services/platform/', 'contracts/')) or n == 'infra/launch.py')) or
                    (kind == 'identity' and n == 'services/identity/src/octoport_identity/protocol/customer.py')}
        links = {n:d for n,d in package.get('links', {}).items() if kind == 'app' and n.startswith('ui/web/')}
        sources = {n: base/n for n in value['files']}
        sources.update({n: PAYLOAD/n for n in selected})
        value['files'].update(selected)
        value.setdefault('links', {}).update(links)
        for n in selected:
            value['links'].pop(n, None)
        for n in links:
            value['files'].pop(n, None)
        value.update(artifact_id=target.name, source_sha=SOURCE, base_release=base.name,
                     base_manifest_sha256=PINS[base], customer_catalog_source=SOURCE,
                     qualified_tar_sha256=TAR_SHA)
        if kind == 'app':
            value['contracts'] = package['contracts']
        targets.append((base, target, value, sources))
    unique = {h: sources[n].stat().st_size for _,_,m,sources in targets for n,h in m['files'].items() if h not in pool}
    count = sum(len(m['files'])+len(m.get('links', {})) for _,_,m,_ in targets)
    extra = sum(unique.values()) + 16*1024**2
    reserve(extra, count*2)
    ownership = {'source': SOURCE, 'installer_sha256': sha(__file__), 'nonce': os.urandom(16).hex(),
                 'targets': [str(APP), str(IDENTITY)]}
    record('PREPARING.json', {'ownership': ownership, 'protected': before, 'units': units})
    for base, target, value, sources in targets:
        materialize(base, target, value, sources, pool, ownership)
        candidate_manifest(target, base, ownership)
    need(protected() == before and {u: static(u) for u in units} == units, 'BASE_CHANGED_DURING_PREPARE')
    record('PLAN.json', {'source': SOURCE, 'installer_sha256': sha(__file__), 'protected': before,
                       'units': units, 'candidates': {str(p): sha(p/'manifest.json') for p in [APP, IDENTITY]},
                       'ownership': ownership, 'budget_bytes': extra, 'new_unique_bytes': sum(unique.values()), 'migrations': []})
    reserve()
    print(json.dumps({'prepared': True, 'plan_sha256': sha(ROOT/'PLAN.json'), 'new_unique_bytes': sum(unique.values())}))


def load(digest, activating=True):
    need(re.fullmatch('[a-f0-9]{64}', digest) and sha(ROOT/'PLAN.json') == digest, 'PLAN_CHANGED')
    value = json.loads((ROOT/'PLAN.json').read_text())
    need(value['source'] == SOURCE and value['installer_sha256'] == sha(__file__), 'INSTALLER_CHANGED')
    for p, h in value['candidates'].items():
        need(Path(p) in [APP, IDENTITY] and sha(Path(p)/'manifest.json') == h, 'CANDIDATE_CHANGED')
        if activating:
            candidate_manifest(Path(p), BASE if Path(p) == APP else IDENTITY_BASE, value['ownership'])
        else:
            # Rollback never executes the candidate. Keep its possible runtime
            # cache entries for inspection while still verifying admitted files.
            manifest(Path(p))
    return value


def stop(unit):
    if prop(unit, 'ActiveState') not in ['inactive', 'failed']:
        run('systemctl', '--no-block', 'stop', unit)
    deadline = time.monotonic()+90
    while prop(unit, 'ActiveState') not in ['inactive', 'failed']:
        need(time.monotonic() < deadline, 'STOP_UNRESOLVED')
        time.sleep(.25)
    need(prop(unit, 'MainPID') == '0' and prop(unit, 'ControlPID') == '0', 'PROCESS_STILL_PRESENT')
    group = prop(unit, 'ControlGroup')
    if group and (Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.events').exists():
        need('populated 0' in (Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.events').read_text(), 'CGROUP_STILL_PRESENT')


def path_state(path):
    if not path.exists() and not path.is_symlink():
        return None
    st = path.lstat()
    content = os.readlink(path) if path.is_symlink() else sha(path)
    return (st.st_dev, st.st_ino, st.st_mode, st.st_size, st.st_mtime_ns, content)


def rename_no_replace(source, destination):
    # Linux primitive: concurrent destination creation cannot be overwritten.
    libc = ctypes.CDLL(None, use_errno=True)
    fn = libc.renameat2
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    result = fn(-100, os.fsencode(source), -100, os.fsencode(destination), 1)
    if result:
        number = ctypes.get_errno()
        raise RuntimeError('SELECTOR_OCCUPIED' if number == errno.EEXIST else 'SELECTOR_RENAME_FAILED')


def replace_selection(path, staged, expected):
    held = path.with_name('.'+path.name+'.customer-catalog-held')
    need(path_state(held) is None, 'SELECTOR_RECOVERY_REQUIRED')
    need(path_state(path) == expected, 'SELECTOR_CHANGED')
    moved = False
    try:
        if expected is not None:
            rename_no_replace(path, held)
            moved = True
            need(path_state(held) == expected, 'DISPLACED_SELECTOR_CHANGED')
        if staged is not None:
            rename_no_replace(staged, path)
        if moved:
            held.unlink()
    except BaseException:
        # Keep a displaced selector if somebody has occupied the live name.
        # Never erase that concurrent value to restore ours.
        if moved and path_state(path) is None:
            rename_no_replace(held, path)
        raise


def select(link, target, expected):
    temp = link.with_name('.'+link.name+'.customer-catalog-new')
    need(path_state(temp) is None, 'SELECTOR_TEMP_EXISTS')
    temp.symlink_to(target)
    try:
        replace_selection(link, temp, expected)
    finally:
        if temp.is_symlink() and os.readlink(temp) == str(target):
            temp.unlink()


def health(port, target, host='127.0.0.1'):
    request = urllib.request.Request('http://127.0.0.1:'+str(port)+'/health/ready', headers={'Host': host})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(request, timeout=2) as response:
        need(response.status == 200 and json.loads(response.read(8192))['release'] == target.name, 'HEALTH_RELEASE')


def ready_pair(rollback):
    deadline = time.monotonic()+40
    while True:
        try:
            active([PLATFORM, IDP]+PRESERVE)
            health(18102, PLATFORM_BASE if rollback else APP)
            health(18103, IDENTITY_BASE if rollback else IDENTITY, 'id.octoport.ru')
            return
        except (OSError, RuntimeError):
            need(time.monotonic() < deadline, 'PAIR_NOT_READY')
            time.sleep(.3)


def ready_web(rollback):
    deadline = time.monotonic()+40
    while True:
        try:
            active([WEB])
            health(18100, BASE if rollback else APP)
            return
        except (OSError, RuntimeError):
            need(time.monotonic() < deadline, 'WEB_NOT_READY')
            time.sleep(.3)


def selection_guard():
    need(WEB_LINK.is_symlink() and WEB_LINK.resolve() in [BASE, APP], 'WEB_SELECTOR_MOVED')
    need(IDENTITY_LINK.is_symlink() and IDENTITY_LINK.resolve() in [IDENTITY_BASE, IDENTITY], 'IDENTITY_SELECTOR_MOVED')
    need(not DROP.exists() or (not DROP.is_symlink() and DROP.read_bytes() == drop_bytes()), 'DROP_MOVED')


def switch(rollback=False):
    # Web must be drained before either backend can change, including rollback.
    selection_guard()
    states = {p: path_state(p) for p in [WEB_LINK, IDENTITY_LINK, DROP]}
    stop(WEB)
    stop(PLATFORM)
    stop(IDP)
    need({p: path_state(p) for p in states} == states, 'SELECTOR_CHANGED_DURING_DRAIN')
    select(WEB_LINK, BASE if rollback else APP, states[WEB_LINK])
    select(IDENTITY_LINK, IDENTITY_BASE if rollback else IDENTITY, states[IDENTITY_LINK])
    if rollback:
        replace_selection(DROP, None, states[DROP])
    else:
        staged = DROP.with_name('.'+DROP.name+'.customer-catalog-new')
        need(path_state(staged) is None, 'DROP_TEMP_EXISTS')
        atomic(staged, drop_bytes(), 0o644)
        replace_selection(DROP, staged, states[DROP])
    run('systemctl', 'daemon-reload')
    run('systemctl', 'start', PLATFORM, IDP)
    ready_pair(rollback)
    run('systemctl', 'start', WEB)
    ready_web(rollback)


def apply(value, rollback=False):
    reserve()
    idle()
    need(protected() == value['protected'], 'PROTECTED_CHANGED')
    if not rollback:
        need({u: static(u) for u in value['units']} == value['units'], 'BASE_UNITS_CHANGED')
        need(WEB_LINK.resolve() == BASE and IDENTITY_LINK.resolve() == IDENTITY_BASE and not DROP.exists(), 'ALREADY_SELECTED')
    try:
        switch(rollback)
        need(protected() == value['protected'], 'PROTECTED_CHANGED')
        reserve()
        record('ROLLED_BACK.json' if rollback else 'ACTIVATED.json', {'source': SOURCE, 'installed': not rollback,
               'preserved_native_authority_admin': True, 'migrations': [], 'owner_browser': 'NOT_RUN'})
    except BaseException:
        # Never overwrite a concurrent foreign selector or changed base/config.
        need(protected() == value['protected'], 'ROLLBACK_PROTECTED_CHANGED')
        switch(True)
        record('ROLLED_BACK.json', {'source': SOURCE, 'installed': False, 'reason': 'ACTIVATION_FAILED'})
        raise


def main():
    need(os.geteuid() == 0, 'ROOT_REQUIRED')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1:] == ['prepare']:
            prepare()
        else:
            need(len(sys.argv) == 3 and sys.argv[1] in ['apply', 'rollback'], 'USAGE')
            apply(load(sys.argv[2], sys.argv[1] == 'apply'), sys.argv[1] == 'rollback')


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise RuntimeError('SIGNAL_'+str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'FAILED', 'error_type': type(error).__name__,
                          'code': str(error) if isinstance(error, RuntimeError) else 'OPERATION_FAILED'}))
        raise SystemExit(1)
