"""Pinned R5 preview/period web rollout using the already reviewed S11 installer primitives."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import stat
import shutil
import tempfile

sys.dont_write_bytecode = True
os.umask(0o022)
SOURCE = '3f2527482db8fd7edb240258fae814d38adc0f4f'
TAR_SHA = '6950fc60b22fd574991342c13a9803b145faa4b5f9cf60f915f7e6255c447927'
STAGE = Path('/opt/alisa-platform/stage')
ROOT = Path('/root/alisa-r5-bound-web-install-20261116')
PAYLOAD = Path('/dev/shm/alisa-r5-bound-3f252748/payload/platform/alisa-3f2527482db8fd7e')
TAR = PAYLOAD.parents[2]/'alisa-3f2527482db8fd7e.tar.gz'
BASE = STAGE/'releases/alisa-r5-preview-5e5e8cc8922342ca'
APP = STAGE/'releases/alisa-r5-bound-3f2527482db8fd7e'
DRIVER = Path('/root/alisa-login-catalog-install-20261115/install.py')
DRIVER_SHA = '73a13e0d510901aed20b0aace60387720769f184e6b2c5c653b60dcb1b3b7862'
HELPER = Path('/usr/local/libexec/alisa/query_gap_publish.py')
HELPER_SHA = 'dc750adf6818a5cce92d6bccd95b1cfa3e441da6f1406cef41900892b5cdacd2'
WEB = 'alisa-web@stage.service'
PINS = {
    BASE: '789db7da63a5b40f65adbe0441757ceece13a1faf6538ada000ca20323396655',
    STAGE/'releases/alisa-customer-catalog-8b8b919993c38128': '0d77e7f22c595538869775231a79ce854456fb8d758a81d0aa87d602ba2d445b',
    STAGE/'releases/alisa-customer-identity-8b8b919993c38128': '643ae257974690a9f67be9739cfd1c696e1e5e25ecf76912b38d4c6e105db4d9',
    STAGE/'releases/alisa-question-catalog-d4eb0ccf798fbb45': 'f9d8ecee64f779b569975f6685b7b775bb0b5c22b8df83bad3ce6dc05780d579',
    STAGE/'releases/alisa-bound-period-3f2527482db8fd7e': 'a799633b5defcc6a0a59f4eebe4c35a82b55672ed7c5f40a8d90d375a3727d16',
    Path('/opt/alice-market/releases/alisa-wb-activity-e0a10bb47fe1cd83'): 'fa078b54e2bf1b57ae3c55e7ffba2a832367a17755a9c24eeedf7bc0d70ddb29',
}


EFFECTIVE_BASES = {
    'alisa-platform@stage.service': STAGE/'releases/alisa-customer-catalog-8b8b919993c38128',
    'alisa-identity@stage.service': STAGE/'releases/alisa-customer-identity-8b8b919993c38128',
    'alisa-admin@stage.service': STAGE/'releases/alisa-question-catalog-d4eb0ccf798fbb45',
    'alisa-runtime-authority-stage.service': STAGE/'releases/alisa-bound-period-3f2527482db8fd7e/services/platform',
    'alice-market.service': Path('/opt/alice-market/releases/alisa-wb-activity-e0a10bb47fe1cd83'),
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

AUTHORITY_ARGV_SHA = '41938fad3bdbb9877f6704c7a3ebde35bbef7b263838b725a117caeec8ab7e6c'

def require_authority_source():
    argv = h.static('alisa-runtime-authority-stage.service')['argv']
    need(hashlib.sha256(argv.encode()).hexdigest() == AUTHORITY_ARGV_SHA, 'AUTHORITY_COMMAND_CHANGED')

def capture():
    require_authority_source()
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


PREPARATION_PLAN = 'PLAN.json'

def publish_record(name, value, expected=None, on_stage=None):
    path = ROOT/name
    raw = (json.dumps(value,indent=2)+'\n').encode()
    temp = ROOT/('.r5-receipt-'+os.urandom(16).hex())
    stream = None
    fd = None
    identity = None
    staged = None
    try:
        fd = os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        st = os.fstat(fd)
        identity = (st.st_dev,st.st_ino)
        stream = os.fdopen(fd,'wb')
        fd = None
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
        staged = h.path_state(temp)
        need(staged[:2] == identity and staged[-1] == hashlib.sha256(raw).hexdigest(),
             'STAGED_RECORD_CHANGED')
        if on_stage is not None:
            on_stage(staged)
        need(h.path_state(temp) == staged, 'STAGED_RECORD_CHANGED')
        if expected is None:
            h.rename_no_replace(temp,path)
        else:
            h.replace_selection(path,temp,expected,staged)
        need(h.path_state(path) == staged, 'PUBLISHED_RECORD_CHANGED')
        return staged
    finally:
        # Hold the original fd until cleanup, so its inode cannot be recycled.
        try:
            if identity is not None and (temp.exists() or temp.is_symlink()):
                st = temp.lstat()
                if (st.st_dev,st.st_ino) == identity and stat.S_ISREG(st.st_mode):
                    actual = h.path_state(temp)
                    if raw.startswith(temp.read_bytes()) and h.path_state(temp) == actual:
                        h.replace_selection(temp,None,actual)
        finally:
            if stream is not None:
                stream.close()
            elif fd is not None:
                os.close(fd)

def remove_owned(path, identity):
    st = path.lstat()
    need((st.st_dev,st.st_ino) == tuple(identity) and path.is_dir()
         and not path.is_symlink(), 'PREPARATION_OWNER_CHANGED')
    need(shutil.rmtree.avoids_symlink_attacks, 'FD_SAFE_CLEANUP_REQUIRED')
    shutil.rmtree(path)

def discard_owned(path, identity, held):
    need(not held.exists() and not held.is_symlink(), 'RECOVERY_NAME_OCCUPIED')
    st = path.lstat()
    need((st.st_dev,st.st_ino) == tuple(identity) and path.is_dir()
         and not path.is_symlink(), 'PREPARATION_OWNER_CHANGED')
    h.rename_no_replace(path,held)
    st = held.lstat()
    if (st.st_dev,st.st_ino) != tuple(identity):
        if not path.exists() and not path.is_symlink():
            h.rename_no_replace(held,path)
        raise RuntimeError('PREPARATION_OWNER_CHANGED')
    remove_owned(held,identity)

def recover_preparation():
    need(not (ROOT/PREPARATION_PLAN).exists() and not (ROOT/PREPARATION_PLAN).is_symlink(), 'PREPARATION_ALREADY_COMPLETE')
    need((ROOT/'PREPARING.json').is_file() and not (ROOT/'PREPARING.json').is_symlink(), 'FOREIGN_PREPARATION')
    proof = json.loads(h.bounded(ROOT/'PREPARING.json'))
    need(proof['source'] == SOURCE and proof['installer_sha'] == sha(__file__),
         'FOREIGN_PREPARATION')
    envelope = Path(proof['envelope'])
    need(envelope.parent == APP.parent and envelope.name.startswith('.r5-preparation-'),
         'PREPARATION_PATH')
    proof_path = ROOT/'PREPARING.json'
    proof_state = h.path_state(proof_path)
    # Cleanup itself may have been interrupted after detaching the private envelope.
    recovered = envelope.with_name(envelope.name+'-recovered')
    choices = [envelope,envelope.with_name(envelope.name+'-discarded'),recovered]
    present = [p for p in choices if p.exists() or p.is_symlink()]
    need(len(present) <= 1, 'RECOVERY_AMBIGUOUS')
    actual_envelope = present[0] if present else envelope
    if present:
        st = actual_envelope.lstat()
        need((st.st_dev,st.st_ino) == tuple(proof['envelope_identity']), 'PREPARATION_OWNER_CHANGED')
    need(h.WEB_LINK.resolve() != APP and Path(h.prop('alisa-runtime-authority-stage.service','WorkingDirectory')) != APP/'services/platform',
         'CANDIDATE_IN_USE')
    if APP.exists() or APP.is_symlink():
        need(proof.get('candidate_identity') is not None and actual_envelope.exists(), 'UNPROVEN_CANDIDATE')
        st = APP.lstat()
        need((st.st_dev,st.st_ino) == tuple(proof['candidate_identity']) and not APP.is_symlink(), 'PREPARATION_OWNER_CHANGED')
        h.candidate_manifest(APP,BASE)
        need(sha(APP/'manifest.json') == proof['candidate_manifest'], 'RECOVERY_CANDIDATE_CHANGED')
        discard_owned(APP,proof['candidate_identity'],actual_envelope/'published-recovery')
    if actual_envelope.exists() or actual_envelope.is_symlink():
        if actual_envelope == recovered:
            remove_owned(recovered,proof['envelope_identity'])
        else:
            discard_owned(actual_envelope,proof['envelope_identity'],recovered)
    saved = ROOT/('PREPARING.recovered-'+envelope.name+'.json')
    need(h.path_state(proof_path) == proof_state, 'PREPARATION_PROOF_CHANGED')
    h.rename_no_replace(proof_path,saved)
    if h.path_state(saved) != proof_state:
        if h.path_state(proof_path) is None:
            h.rename_no_replace(saved,proof_path)
        raise RuntimeError('PREPARATION_PROOF_CHANGED')
    h.record('PREPARATION_RECOVERED.json',{'source':SOURCE,'removed_only_owned_staging':True})

def stage_candidate(value, sources, pool, build_plan):
    need(not APP.exists() and not APP.is_symlink() and not (ROOT/PREPARATION_PLAN).exists()
         and not (ROOT/PREPARATION_PLAN).is_symlink(), 'CANDIDATE_EXISTS')
    need(not (ROOT/'PREPARING.json').exists() and not (ROOT/'PREPARING.json').is_symlink(), 'PREPARATION_RECOVERY_REQUIRED')
    envelope = Path(tempfile.mkdtemp(prefix='.r5-preparation-',dir=APP.parent))
    st = envelope.lstat()
    identity = (st.st_dev,st.st_ino)
    inner = envelope/APP.name
    child_identity = None
    plan_owned = None
    proof_state = None
    complete = False
    proof = {'source':SOURCE,'installer_sha':sha(__file__),'envelope':str(envelope),
             'envelope_identity':identity,'candidate_identity':None}
    try:
        # Persist the private envelope identity before materializing any release file.
        proof_state = publish_record('PREPARING.json',proof,proof_state)
        h.materialize(BASE,inner,value,sources,pool)
        h.candidate_manifest(inner,BASE)
        st = inner.lstat()
        child_identity = (st.st_dev,st.st_ino)
        proof.update(candidate_identity=child_identity,candidate_manifest=sha(inner/'manifest.json'))
        proof_state = publish_record('PREPARING.json',proof,proof_state)
        h.rename_no_replace(inner,APP)
        st = APP.lstat()
        need((st.st_dev,st.st_ino) == child_identity, 'PUBLISHED_CANDIDATE_CHANGED')
        plan = build_plan()
        h.reserve()
        def own_plan(state):
            nonlocal plan_owned
            plan_owned = state
        need(not (ROOT/PREPARATION_PLAN).exists() and not (ROOT/PREPARATION_PLAN).is_symlink(), 'PLAN_OCCUPIED')
        publish_record(PREPARATION_PLAN,plan,on_stage=own_plan)
        complete = True
    except BaseException:
        if child_identity is not None and (APP.exists() or APP.is_symlink()):
            st = APP.lstat()
            need((st.st_dev,st.st_ino) == child_identity and not APP.is_symlink(), 'PREPARATION_OWNER_CHANGED')
            h.candidate_manifest(APP,BASE)
            need(sha(APP/'manifest.json') == proof['candidate_manifest'], 'RECOVERY_CANDIDATE_CHANGED')
            discard_owned(APP,child_identity,envelope/'published-recovery')
        plan_path = ROOT/PREPARATION_PLAN
        if plan_path.exists() or plan_path.is_symlink():
            need(plan_owned is not None and h.path_state(plan_path) == plan_owned, 'FOREIGN_PLAN_RETAINED')
            saved = ROOT/(PREPARATION_PLAN+'.failed-'+envelope.name)
            expected = h.path_state(plan_path)
            h.rename_no_replace(plan_path,saved)
            need(h.path_state(saved) == expected, 'DISPLACED_PLAN_CHANGED')
        raise
    finally:
        # An interrupted process can use recover_preparation with the same proof.
        if envelope.exists() or envelope.is_symlink():
            discard_owned(envelope,identity,envelope.with_name(envelope.name+'-discarded'))

def prepare():
    need(not (ROOT/'PREPARING.json').exists() and not (ROOT/'PREPARING.json').is_symlink(), 'PREPARATION_RECOVERY_REQUIRED')
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
    def build_plan():
        need(capture() == before and h.static(WEB) == web_static
             and h.path_state(h.WEB_LINK) == selector_state, 'BASE_CHANGED_DURING_PREPARE')
        return {'source':SOURCE, 'installer_sha':sha(__file__),
                'protected':before, 'web_static':web_static, 'web_selector_state':selector_state,
                'candidate_manifest':sha(APP/'manifest.json'),
                'new_unique_bytes':sum(unique.values()), 'reserve_bytes':extra}
    stage_candidate(value,sources,pool,build_plan)
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

def apply(expected, on_restore=None):
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
            restored = tuple(plan['web_selector_state'])
            if installed is not None and h.path_state(h.WEB_LINK) == installed:
                restored = select(BASE, installed)
                if on_restore is not None:
                    on_restore(restored)
                h.run('systemctl', 'restart', WEB)
            h.ready_web(True)
            status['web_rolled_back'] = (h.path_state(h.WEB_LINK) == restored
                                         and h.WEB_LINK.resolve() == BASE)
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
        if sys.argv[1:] == ['recover-preparation']:
            recover_preparation()
        elif sys.argv[1:] == ['prepare']:
            prepare()
        else:
            need(len(sys.argv) == 3 and sys.argv[1] == 'apply', 'USAGE')
            apply(sys.argv[2])

if __name__ == '__main__':
    main()
