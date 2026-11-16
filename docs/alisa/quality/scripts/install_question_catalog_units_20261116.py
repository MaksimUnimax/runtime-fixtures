"""Pinned web-only catalog period rollout using the already reviewed S11 installer primitives."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

sys.dont_write_bytecode = True
os.umask(0o022)
SOURCE = '0e00c848d3a4ad58a7ee99568b91b564f338e01c'
TAR_SHA = '9129abbe6536fced504cf567fb132b7113eedfefb65f16175ecf335bde42d97f'
STAGE = Path('/opt/alisa-platform/stage')
ROOT = Path('/root/alisa-catalog-units-install-20261116')
PAYLOAD = Path('/dev/shm/alisa-catalog-units-0e00c848/payload/alisa-0e00c848d3a4ad58')
TAR = PAYLOAD.parents[1]/'alisa-0e00c848d3a4ad58.tar.gz'
BASE = STAGE/'releases/alisa-catalog-period-dea0498f51980cdc'
APP = STAGE/'releases/alisa-catalog-units-0e00c848d3a4ad58'
DRIVER = Path('/root/alisa-login-catalog-install-20261115/install.py')
DRIVER_SHA = '73a13e0d510901aed20b0aace60387720769f184e6b2c5c653b60dcb1b3b7862'
HELPER = Path('/usr/local/libexec/alisa/query_gap_publish.py')
HELPER_SHA = 'dc750adf6818a5cce92d6bccd95b1cfa3e441da6f1406cef41900892b5cdacd2'
WEB = 'alisa-web@stage.service'
PINS = {
    BASE: 'f9724dfdad8eb8b197863e83b658bdeeb9002a942409babd94bb05e2a6cef42f',
    STAGE/'releases/alisa-customer-catalog-8b8b919993c38128': '0d77e7f22c595538869775231a79ce854456fb8d758a81d0aa87d602ba2d445b',
    STAGE/'releases/alisa-customer-identity-8b8b919993c38128': '643ae257974690a9f67be9739cfd1c696e1e5e25ecf76912b38d4c6e105db4d9',
    STAGE/'releases/alisa-question-catalog-d4eb0ccf798fbb45': 'f9d8ecee64f779b569975f6685b7b775bb0b5c22b8df83bad3ce6dc05780d579',
    STAGE/'releases/alisa-parameters-1d572aebf6b05b88': '1c9911c9615309c66056588cdb28458beb57ce54abc3f577278606cd83736a21',
    Path('/opt/alice-market/releases/alisa-parameters-1d572aebf6b05b88'): '20c5afddbc8f07c86e72a33676d4475c4b23b7c0316bc73f814e51dc5a60e95e',
}


EFFECTIVE_BASES = {
    'alisa-platform@stage.service': STAGE/'releases/alisa-customer-catalog-8b8b919993c38128',
    'alisa-identity@stage.service': STAGE/'releases/alisa-customer-identity-8b8b919993c38128',
    'alisa-admin@stage.service': STAGE/'releases/alisa-question-catalog-d4eb0ccf798fbb45',
    'alisa-runtime-authority-stage.service': STAGE/'releases/alisa-parameters-1d572aebf6b05b88/services/platform',
    'alice-market.service': Path('/opt/alice-market/releases/alisa-parameters-1d572aebf6b05b88'),
}
STAFF_PINS = {
    STAGE/'releases/alisa-question-catalog-d4eb0ccf798fbb45/services/platform/src/alisa_platform/staff/policy.py': '1b3b930fe33231b61493c646b23f361576154509e0ad92b392df791ef542bd4f',
    STAGE/'releases/alisa-question-catalog-d4eb0ccf798fbb45/services/platform/src/alisa_platform/staff/views.py': 'c5e8ccc53d7641969db6b51947c2b0883b1cc35042a7889bb9fa06c62cb1f7be',
}

def sha(p):
    with Path(p).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def need(ok, code):
    if not ok:
        raise RuntimeError(code)

need(sha(DRIVER) == DRIVER_SHA, 'REVIEWED_DRIVER_CHANGED')
spec = importlib.util.spec_from_file_location('reviewed_s11_driver', DRIVER)
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
h.ROOT, h.BASE, h.APP, h.PINS = ROOT, BASE, APP, PINS
h.PRESERVE = [h.PLATFORM, h.IDP] + h.PRESERVE

def secure(path):
    for p in [*reversed(path.parents), path]:
        s = p.lstat()
        need(p.is_dir() and not p.is_symlink() and s.st_uid == s.st_gid == 0
             and not s.st_mode & 0o022, 'UNTRUSTED_DIRECTORY')

def capture():
    value = h.protected()
    value['pids'] = {u: {k: h.prop(u, k) for k in ['MainPID', 'InvocationID']}
                     for u in h.PRESERVE}
    value['identity'] = str(h.IDENTITY_LINK.resolve(strict=True))
    value['helper_sha'] = sha(HELPER)
    need(value['helper_sha'] == HELPER_SHA, 'PUBLISHER_CHANGED')
    value['effective_bases'] = {}
    for unit, expected in EFFECTIVE_BASES.items():
        actual = Path(h.prop(unit, 'WorkingDirectory')).resolve(strict=True)
        need(actual == expected.resolve(strict=True), 'EFFECTIVE_RELEASE_CHANGED')
        value['effective_bases'][unit] = str(actual)
    value['staff_hashes'] = {str(p): sha(p) for p in STAFF_PINS}
    need(value['staff_hashes'] == {str(p): d for p, d in STAFF_PINS.items()}, 'STAFF_CHANGED')
    return value

def read_plan(expected):
    p = ROOT/'PLAN.json'
    need(sha(p) == expected, 'PLAN_CHANGED')
    v = json.loads(h.bounded(p))
    need(v['source'] == SOURCE and v['installer_sha'] == sha(__file__), 'PLAN_SOURCE')
    need(v['protected'] == capture() and v['web_static'] == h.static(WEB), 'BASE_CHANGED')
    need(sha(BASE/'manifest.json') == PINS[BASE], 'BASE_PIN')
    need(h.path_state(h.WEB_LINK) == tuple(v['web_selector_state']), 'SELECTOR_CHANGED')
    h.candidate_manifest(APP, BASE)
    need(sha(APP/'manifest.json') == v['candidate_manifest'], 'CANDIDATE_CHANGED')
    h.reserve()
    h.idle()
    return v

def baseline_tree(root, value):
    # Live root-run Python checks leave bytecode caches. Never copy these into the candidate.
    extra = {'.venv'}
    for name in value['files']:
        if not name.startswith('services/platform/') or not name.endswith('.py'):
            continue
        source = Path(name)
        cache = root/source.parent/'__pycache__'
        if not cache.exists() and not cache.is_symlink():
            continue
        st = cache.lstat()
        need(cache.is_dir() and not cache.is_symlink() and st.st_uid == st.st_gid == 0
             and not st.st_mode & 0o022, 'UNTRUSTED_RUNTIME_CACHE')
        extra.add(str(cache.relative_to(root)))
        p = cache/(source.stem+'.cpython-312.pyc')
        if p.exists() or p.is_symlink():
            st = p.lstat()
            need(p.is_file() and not p.is_symlink() and st.st_uid == st.st_gid == 0
                 and not st.st_mode & 0o022 and 0 < st.st_size <= 256*1024,
                 'UNTRUSTED_RUNTIME_CACHE')
            extra.add(str(p.relative_to(root)))
    h.exact_tree(root, value, extra)


def prepare():
    secure(STAGE)
    need(h.WEB_LINK.is_symlink() and h.WEB_LINK.resolve(strict=True) == BASE, 'WEB_BASE')
    need(h.IDENTITY_LINK.resolve(strict=True) == STAGE/'releases/alisa-customer-identity-8b8b919993c38128', 'IDENTITY_BASE')
    need(not APP.exists() and not (ROOT/'PLAN.json').exists(), 'CANDIDATE_EXISTS')
    h.reserve()
    h.idle()
    h.active([WEB]+h.PRESERVE)
    for p, digest in PINS.items():
        secure(p)
        need(sha(p/'manifest.json') == digest, 'PIN_CHANGED')
    before = capture()
    web_static = h.static(WEB)
    selector_state = h.path_state(h.WEB_LINK)
    old = h.manifest(BASE)
    baseline_tree(BASE, old)
    package = h.package_manifest(PAYLOAD, TAR, TAR_SHA)
    need(package['source_sha'] == SOURCE, 'PACKAGE_SOURCE')
    need(package['locks'] == old['locks'] and package['contracts'] == old['contracts'],
         'INTERFACE_OR_DEPENDENCY_CHANGE')
    files = {n:d for n,d in old['files'].items() if not n.startswith('ui/web/')}
    files.update({n:d for n,d in package['files'].items() if n.startswith('ui/web/')})
    links = {n:d for n,d in old.get('links', {}).items() if not n.startswith('ui/web/')}
    links.update({n:d for n,d in package.get('links', {}).items() if n.startswith('ui/web/')})
    need(any(n.startswith('ui/web/') for n in files), 'WEB_MISSING')
    pool = {d: BASE/n for n,d in old['files'].items()}
    sources = {n: (PAYLOAD if n.startswith('ui/web/') else BASE)/n for n in files}
    unique = {d:sources[n].stat().st_size for n,d in files.items() if d not in pool}
    extra = sum(unique.values()) + 16*1024**2
    h.reserve(extra, 2*(len(files)+len(links)))
    value = json.loads(json.dumps(old))
    value.update(files=files, links=links, artifact_id=APP.name,
                 web_source_sha=SOURCE, web_qualified_tar_sha256=TAR_SHA,
                 base_release=BASE.name, base_manifest_sha256=PINS[BASE])
    h.materialize(BASE, APP, value, sources, pool)
    h.candidate_manifest(APP, BASE)
    need(capture() == before and h.static(WEB) == web_static
         and h.path_state(h.WEB_LINK) == selector_state, 'BASE_CHANGED_DURING_PREPARE')
    h.record('PLAN.json', {'source':SOURCE, 'installer_sha':sha(__file__),
                          'protected':before, 'web_static':web_static, 'web_selector_state':selector_state,
                          'candidate_manifest':sha(APP/'manifest.json'),
                          'new_unique_bytes':sum(unique.values()), 'reserve_bytes':extra})
    h.reserve()
    print(json.dumps({'prepared':True, 'plan_sha256':sha(ROOT/'PLAN.json'),
                      'new_unique_bytes':sum(unique.values())}), flush=True)

def select(target, expected):
    temp = STAGE/'.catalog-period-web-current'
    need(h.path_state(temp) is None, 'SELECTOR_TEMP_EXISTS')
    temp.symlink_to(target)
    staged = h.path_state(temp)
    try:
        need(temp.is_symlink() and staged[-1] == str(target), 'STAGED_SELECTOR_CHANGED')
        h.replace_selection(h.WEB_LINK, temp, expected, staged)
        return staged
    finally:
        if h.path_state(temp) == staged:
            temp.unlink()

def apply(expected):
    plan = read_plan(expected)
    need(h.WEB_LINK.resolve(strict=True) == BASE, 'WEB_BASE')
    h.record('BEFORE.json', plan)
    installed = None
    try:
        installed = select(APP, tuple(plan['web_selector_state']))
        h.run('systemctl', 'restart', WEB)
        h.ready_web(False)
        h.active([WEB]+h.PRESERVE)
        need(capture() == plan['protected'] and h.static(WEB) == plan['web_static'],
             'PROTECTED_CHANGED')
        need(h.path_state(h.WEB_LINK) == installed, 'WEB_SELECTOR_CHANGED_AFTER_START')
        h.reserve()
        h.record('APPLIED.json', {'source':SOURCE, 'web':str(APP),
                                 'manifest_sha256':sha(APP/'manifest.json'),
                                 'protected_unchanged':True,
                                 'web_health':'READY', 'web_main_pid':h.prop(WEB,'MainPID')})
        print('APPLIED_WEB_ONLY', flush=True)
    except BaseException:
        status = {'web_rolled_back':False, 'protected_unchanged':False}
        try:
            if installed is not None and h.path_state(h.WEB_LINK) == installed:
                select(BASE, installed)
                h.run('systemctl', 'restart', WEB)
            h.ready_web(True)
            status['web_rolled_back'] = h.WEB_LINK.resolve() == BASE
            h.active(h.PRESERVE)
            status['protected_unchanged'] = capture() == plan['protected']
        finally:
            status['web_target'] = str(h.WEB_LINK.resolve())
            h.record('FAILED.json', status)
        need(status['web_rolled_back'] and status['protected_unchanged'], 'ROLLBACK_INCOMPLETE')
        raise

def main():
    need(os.geteuid() == 0, 'ROOT_REQUIRED')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    secure(ROOT)
    with h.LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
        if sys.argv[1:] == ['prepare']:
            prepare()
        else:
            need(len(sys.argv) == 3 and sys.argv[1] == 'apply', 'USAGE')
            apply(sys.argv[2])

if __name__ == '__main__':
    main()
