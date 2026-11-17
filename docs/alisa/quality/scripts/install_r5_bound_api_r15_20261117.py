"""Finite R5 cabinet API overlay on accepted R15; preserves authority/native/data."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import shutil
import tempfile
import time
import urllib.request

sys.dont_write_bytecode = True
SOURCE = '3f2527482db8fd7edb240258fae814d38adc0f4f'
TAR_SHA = '6950fc60b22fd574991342c13a9803b145faa4b5f9cf60f915f7e6255c447927'
ROOT = Path('/root/alisa-r5-api-r15-install-20261117')
PAYLOAD = Path('/dev/shm/alisa-r5-bound-3f252748/payload/platform/alisa-3f2527482db8fd7e')
TAR = PAYLOAD.parents[2]/'alisa-3f2527482db8fd7e.tar.gz'
BASE = Path('/opt/alisa-platform/stage/releases/alisa-economics-r15-platform-cafb743c94672104')
DEPENDENCY_BASE = Path('/opt/alisa-platform/stage/releases/alisa-store-enrollment-592cc8bb006a4991')
APP = BASE.parent/'alisa-r5-bound-api-r15-3f2527482db8fd7e'
BASE_SHA = '39af4f38c9042217ebb035807ee05a3351151aa0caf6428b6de4b33bdb480c39'
REVIEWED = Path('/root/alisa-r5-preview-web-install-20261116/install.py')
REVIEWED_SHA = '3e7729fc5d909cc3fe9702461734fc59a11c80eba6b0feabc09bc5396b9d0608'
UNIT = 'alisa-platform@stage.service'
OLD_SELECTOR = Path('/etc/systemd/system')/(UNIT+'.d')/('z'*88+'-economics-r15-release.conf')
OLD_SELECTOR_SHA = 'e186f980ac5ed41c2e22d6876851af1a89fe98e76ce64d73e50a30fafc3c84ad'
SELECTOR = OLD_SELECTOR.parent/('z'*96+'-bound-period.conf')
PREFIX = 'services/platform/src/alisa_platform/owner_data/'
CHANGED = tuple(PREFIX+n for n in ['parameter_service.py','parameter_collection.py','parameter_periods.py'])
UNCHANGED = tuple(PREFIX+n for n in ['parameter_contract.py','parameter_producers.py','parameter_catalog.json','parameter_producers.json'])


def need(ok, code):
    if not ok:
        raise RuntimeError(code)

def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream,'sha256').hexdigest()

need(sha(REVIEWED) == REVIEWED_SHA, 'REVIEWED_DRIVER_CHANGED')
spec = importlib.util.spec_from_file_location('reviewed_r5_web', REVIEWED)
w = importlib.util.module_from_spec(spec)
spec.loader.exec_module(w)
h = w.h
h.ROOT = ROOT
h.PRESERVE = [u for u in h.PRESERVE if u != UNIT]+[w.WEB]
w.EFFECTIVE_BASES = {u:p for u,p in w.EFFECTIVE_BASES.items() if u != UNIT}
w.PINS.clear()
w.PINS.update({
    w.APP: '789db7da63a5b40f65adbe0441757ceece13a1faf6538ada000ca20323396655',
    BASE.parent/'alisa-economics-r15-authority-cafb743c94672104': '8c0c364ebba9292817519cd15db4a4a6b105e5e4ab1b219f5a1faa36e5d10935',
    BASE.parent/'alisa-customer-identity-8b8b919993c38128': '643ae257974690a9f67be9739cfd1c696e1e5e25ecf76912b38d4c6e105db4d9',
    BASE.parent/'alisa-question-catalog-d4eb0ccf798fbb45': 'f9d8ecee64f779b569975f6685b7b775bb0b5c22b8df83bad3ce6dc05780d579',
    Path('/opt/alice-market/releases/alisa-economics-r15-native-cafb743c94672104'): '4e49ab8da6f88fce1c5672d2960b536f5043d1e942c28ef3e18117c1f33c86d7',
})
w.EFFECTIVE_BASES = {
    'alisa-runtime-authority-stage.service': BASE.parent/'alisa-economics-r15-authority-cafb743c94672104/services/platform',
    'alisa-identity@stage.service': BASE.parent/'alisa-customer-identity-8b8b919993c38128',
    'alisa-admin@stage.service': BASE.parent/'alisa-question-catalog-d4eb0ccf798fbb45',
    'alice-market.service': Path('/opt/alice-market/releases/alisa-economics-r15-native-cafb743c94672104'),
}
def require_authority_source():
    argv = h.static('alisa-runtime-authority-stage.service')['argv']
    need(hashlib.sha256(argv.encode()).hexdigest() == '25e7dbdbe178f82d27c754af7707ec439855538d979d8c7483c194626d2907a4', 'AUTHORITY_COMMAND_CHANGED')
w.require_authority_source = require_authority_source

def managed(path):
    w.secure(path.parent)
    st = path.lstat()
    need(stat.S_ISREG(st.st_mode) and st.st_uid == st.st_gid == 0
         and not st.st_mode & 0o022 and st.st_size <= 65536, 'UNTRUSTED_CONFIG')
    fd = os.open(path, os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        opened = os.fstat(fd)
        need((opened.st_dev,opened.st_ino) == (st.st_dev,st.st_ino), 'CONFIG_RACE')
        raw = os.read(fd,65537)
        need(len(raw) <= 65536, 'CONFIG_BOUND')
        need(h.path_state(path) == (st.st_dev,st.st_ino,st.st_mode,st.st_size,st.st_mtime_ns,
              hashlib.sha256(raw).hexdigest()), 'CONFIG_RACE')
        return raw
    finally:
        os.close(fd)

def inventory():
    paths = {Path(h.prop(UNIT,'FragmentPath')), OLD_SELECTOR}
    for top in ['/etc/systemd/system','/run/systemd/system','/usr/lib/systemd/system','/lib/systemd/system']:
        unit = Path(top)/UNIT
        if unit.exists() or unit.is_symlink():
            paths.add(unit)
        directory = Path(top)/(UNIT+'.d')
        if directory.exists() or directory.is_symlink():
            w.secure(directory)
            paths.update(directory.glob('*.conf'))
    paths.update(Path(p) for p in h.prop(UNIT,'DropInPaths').split())
    # /lib may be a system symlink; canonicalise its parent, never a config leaf.
    result = {}
    for p in paths:
        need(not p.is_symlink(), 'CONFIG_SYMLINK')
        p = p.resolve(strict=True)
        result[str(p)] = hashlib.sha256(managed(p)).hexdigest()
    return result

def captured():
    value = w.capture()
    value['web_selector_state'] = h.path_state(h.WEB_LINK)
    return json.loads(json.dumps(value))

def overlay(raw):
    old,new = str(BASE).encode(),str(APP).encode()
    need(hashlib.sha256(raw).hexdigest() == OLD_SELECTOR_SHA, 'SOURCE_SELECTOR_CHANGED')
    need(raw.count(old) == 3, 'SELECTOR_REPLACEMENT_BOUND')
    for line in raw.splitlines():
        if old in line:
            need(line.startswith((b'WorkingDirectory=',b'ExecStart=')), 'SELECTOR_REPLACEMENT_SCOPE')
    return raw.replace(old,new)

def expected_static(before, digest):
    value = json.loads(json.dumps(before))
    value['WorkingDirectory'] = value['WorkingDirectory'].replace(str(BASE),str(APP))
    value['argv'] = value['argv'].replace(str(BASE),str(APP))
    value['DropInPaths'] += ' '+str(SELECTOR)
    value['drop_hashes'][str(SELECTOR)] = digest
    return value

def ready():
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:18102/health/ready',timeout=3) as response:
        value = json.load(response)
        need(response.status == 200 and type(value.get('release')) is str, 'AUTHORITY_NOT_READY')
        return value['release']

def wait_ready(label):
    deadline = time.monotonic()+40
    while True:
        try:
            h.active([UNIT])
            need(ready() == label, 'HEALTH_LABEL_CHANGED')
            return
        except (OSError,RuntimeError,ValueError):
            need(time.monotonic() < deadline, 'AUTHORITY_NOT_READY')
            time.sleep(.3)

def environment():
    pid = int(h.prop(UNIT,'MainPID'))
    need(pid > 0, 'AUTHORITY_PROCESS_MISSING')
    entries = (Path('/proc')/str(pid)/'environ').read_bytes().split(b'\0')
    generated = {b'INVOCATION_ID',b'JOURNAL_STREAM',b'SYSTEMD_EXEC_PID',b'WATCHDOG_PID'}
    root = Path(h.prop(UNIT,'WorkingDirectory'))
    need(root in {BASE,APP}, 'ENVIRONMENT_RELEASE_PATH')
    expected = {b'ALISA_RELEASE':root.name.encode(), b'PYTHONPATH':str(root/'services/platform/src').encode()}
    values = dict(e.split(b'=',1) for e in entries if e)
    need(all(values.get(k) == v for k,v in expected.items()), 'LAUNCHER_ENVIRONMENT_CHANGED')
    stable = sorted(k+b'='+ (b'<PINNED_RELEASE>' if k in expected else v)
                    for k,v in values.items() if k not in generated)
    return hashlib.sha256(b'\0'.join(stable)).hexdigest()


def compatible(package, old):
    need(package['source_sha'] == SOURCE, 'PACKAGE_SOURCE')
    for key in ['locks','contracts','migrations','runtime_port']:
        need(package[key] == old[key], 'INTERFACE_OR_DEPENDENCY_CHANGE')
    need(all(package['files'][n] == old['files'][n] for n in UNCHANGED), 'PERIOD_DEPENDENCY_CHANGED')
    prefix = 'services/platform/src/alisa_platform/'
    for name in ['accounts/models.py','stores/models.py','queries/models.py','owner_data/models.py','runtime_adapter/job_client.py']:
        need(package['files'][prefix+name] == old['files'][prefix+name], 'MODEL_OR_CLIENT_CHANGED')
    need(old.get('external_links',{}).get('.venv') == str(DEPENDENCY_BASE/'.venv'), 'DEPENDENCY_LINK_CHANGED')
    # Preserve every accepted R15 file and all additive schema metadata. Only CHANGED is overlaid.


PREPARATION_PLAN = 'API_PLAN.json'

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
    need(h.WEB_LINK.resolve() != APP and Path(h.prop(UNIT,'WorkingDirectory')).resolve() != APP,
         'CANDIDATE_IN_USE')
    if APP.exists() or APP.is_symlink():
        need(proof.get('candidate_identity') is not None and actual_envelope.exists(), 'UNPROVEN_CANDIDATE')
        st = APP.lstat()
        need((st.st_dev,st.st_ino) == tuple(proof['candidate_identity']) and not APP.is_symlink(), 'PREPARATION_OWNER_CHANGED')
        h.candidate_manifest(APP,DEPENDENCY_BASE)
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

def candidate_identity(path):
    w.secure(path)
    st = path.lstat()
    need(path.is_dir() and not path.is_symlink(), 'CANDIDATE_NOT_DIRECTORY')
    return (st.st_dev,st.st_ino,st.st_mode,st.st_uid,st.st_gid)

def require_candidate(plan):
    need(candidate_identity(APP) == tuple(plan['candidate_identity']), 'CANDIDATE_REPLACED')

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
        h.materialize(DEPENDENCY_BASE,inner,value,sources,pool)
        h.candidate_manifest(inner,DEPENDENCY_BASE)
        st = inner.lstat()
        child_identity = (st.st_dev,st.st_ino)
        child_state = candidate_identity(inner)
        proof.update(candidate_identity=child_identity,candidate_manifest=sha(inner/'manifest.json'))
        proof_state = publish_record('PREPARING.json',proof,proof_state)
        h.rename_no_replace(inner,APP)
        st = APP.lstat()
        need((st.st_dev,st.st_ino) == child_identity, 'PUBLISHED_CANDIDATE_CHANGED')
        plan = build_plan()
        need(candidate_identity(APP) == child_state, 'CANDIDATE_REPLACED_DURING_PREPARE')
        plan['candidate_identity'] = child_state
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
            h.candidate_manifest(APP,DEPENDENCY_BASE)
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
    w.secure(ROOT)
    w.secure(BASE)
    w.secure(SELECTOR.parent)
    need(not APP.exists() and not APP.is_symlink() and not (ROOT/'API_PLAN.json').exists(), 'CANDIDATE_EXISTS')
    need(h.path_state(SELECTOR) is None, 'SELECTOR_OCCUPIED')
    h.reserve()
    h.idle()
    h.active([UNIT]+h.PRESERVE)
    need(sha(BASE/'manifest.json') == BASE_SHA, 'BASE_PIN')
    old = h.manifest(BASE)
    w.baseline_tree(BASE,old)
    before = captured()
    static_before = h.static(UNIT)
    need(static_before['WorkingDirectory'] == str(BASE)
         and static_before['DropInPaths'].split()[-1] == str(OLD_SELECTOR), 'AUTHORITY_BASE')
    config = inventory()
    raw = overlay(managed(OLD_SELECTOR))
    env = environment()
    label = ready()
    need(label == BASE.name, 'API_BASE_HEALTH')
    package = h.package_manifest(PAYLOAD,TAR,TAR_SHA)
    compatible(package,old)
    need(CHANGED[-1] not in old['files'], 'NEW_MODULE_ALREADY_PRESENT')
    files = dict(old['files'])
    files.update({n:package['files'][n] for n in CHANGED})
    sources = {n:(PAYLOAD if n in CHANGED else BASE)/n for n in files}
    pool = {d:BASE/n for n,d in old['files'].items()}
    unique = {d:sources[n].stat().st_size for n,d in files.items() if d not in pool}
    h.reserve(sum(unique.values())+16*1024**2,2*len(files))
    value = json.loads(json.dumps(old))
    value.update(files=files,artifact_id=APP.name,backend_source_sha=SOURCE,
                 backend_qualified_tar_sha256=TAR_SHA,base_release=BASE.name,
                 base_manifest_sha256=BASE_SHA,backend_overlay=list(CHANGED))
    def build_plan():
        need(captured() == before and h.static(UNIT) == static_before and inventory() == config
             and environment() == env and h.path_state(SELECTOR) is None, 'BASE_CHANGED_DURING_PREPARE')
        return {'source':SOURCE,'installer_sha':sha(__file__),'protected':before,
                'authority_static':static_before,'inventory':config,'environment_sha':env,
                'health_label':label,'overlay_sha':hashlib.sha256(raw).hexdigest(),
                'candidate_manifest':sha(APP/'manifest.json'),'changed_files':list(CHANGED)}
    stage_candidate(value,sources,pool,build_plan)
    print(json.dumps({'prepared':True,'plan_sha256':sha(ROOT/'API_PLAN.json'),
                      'new_unique_bytes':sum(unique.values())}),flush=True)

def read_plan(expected):
    p = ROOT/'API_PLAN.json'
    need(sha(p) == expected, 'PLAN_CHANGED')
    plan = json.loads(h.bounded(p))
    need(plan['source'] == SOURCE and plan['installer_sha'] == sha(__file__), 'PLAN_SOURCE')
    need(captured() == plan['protected'] and h.static(UNIT) == plan['authority_static']
         and inventory() == plan['inventory'] and environment() == plan['environment_sha'], 'BASE_CHANGED')
    need(h.path_state(SELECTOR) is None and sha(BASE/'manifest.json') == BASE_SHA, 'BASE_PIN')
    raw = overlay(managed(OLD_SELECTOR))
    need(hashlib.sha256(raw).hexdigest() == plan['overlay_sha'], 'OVERLAY_CHANGED')
    require_candidate(plan)
    h.candidate_manifest(APP,DEPENDENCY_BASE)
    require_candidate(plan)
    need(sha(APP/'manifest.json') == plan['candidate_manifest'], 'CANDIDATE_CHANGED')
    h.reserve()
    h.idle()
    h.active([UNIT]+h.PRESERVE)
    return plan,raw

def publish(raw):
    need(h.path_state(SELECTOR) is None, 'SELECTOR_OCCUPIED')
    temp = SELECTOR.with_name('.'+SELECTOR.name+'.bound-period-new')
    need(h.path_state(temp) is None, 'TEMP_OCCUPIED')
    identity = None
    staged = None
    try:
        with temp.open('xb') as stream:
            opened = os.fstat(stream.fileno())
            identity = (opened.st_dev,opened.st_ino)
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        temp.chmod(0o644)
        staged = h.path_state(temp)
        need(staged[:2] == identity and staged[-1] == hashlib.sha256(raw).hexdigest(),
             'STAGED_CONFIG_CHANGED')
        h.record('API_OWNED.json',{'source':SOURCE,'installer_sha':sha(__file__),
                 'state':staged,'selector':str(SELECTOR)})
        h.rename_no_replace(temp,SELECTOR)
        need(h.path_state(SELECTOR) == staged, 'PUBLISHED_CONFIG_CHANGED')
        return staged
    finally:
        actual = h.path_state(temp)
        if identity is not None and actual is not None and actual[:2] == identity:
            # During a failed write there may be only a prefix of our bytes.
            # Never remove a replacement inode or a file with foreign contents.
            if staged is None:
                own_bytes = managed(temp)
                if raw.startswith(own_bytes):
                    staged = actual
            if staged is not None and h.path_state(temp) == staged:
                h.replace_selection(temp,None,staged)

def service_state():
    return {key:h.prop(UNIT,key) for key in [
        'ActiveState','SubState','MainPID','ControlPID','InvocationID','Result','Job',
        'StateChangeTimestampMonotonic','InactiveEnterTimestampMonotonic']}

def failed_owned_state(plan, target_static, target_inventory, installed):
    value = service_state()
    failure = value.get('Result') in {
        'exit-code','signal','core-dump','timeout','watchdog',
        'resources','protocol','start-limit-hit','oom-kill'}
    state = value.get('ActiveState') == 'failed' or (
        value.get('ActiveState') == 'activating' and value.get('SubState') == 'auto-restart')
    if not (failure and state and value.get('MainPID') == '0'
            and value.get('ControlPID') == '0' and value.get('Job','0') in {'0',''}):
        return None
    need(h.static(UNIT) == target_static and inventory() == target_inventory
         and h.path_state(SELECTOR) == installed and captured() == plan['protected']
         and service_state() == value, 'START_FAILURE_CHANGED')
    return value

def verify_candidate(plan):
    require_candidate(plan)
    need(h.sha(APP/'manifest.json') == plan['candidate_manifest'], 'CANDIDATE_CHANGED')
    h.candidate_manifest(APP,DEPENDENCY_BASE)
    require_candidate(plan)

def apply(expected):
    plan,raw = read_plan(expected)
    verify_candidate(plan)
    need(not (ROOT/'API_STARTED.json').exists(), 'ALREADY_ATTEMPTED')
    h.record('API_STARTED.json',{'source':SOURCE,'installer_sha':sha(__file__)})
    installed = None
    stopped = False
    owned_state = None
    start_attempted = False
    try:
        # Drain the cabinet API that admits preparations and calculations; preserve the authority.
        h.stop(UNIT)
        stopped = True
        owned_state = service_state()
        h.idle()
        need(captured() == plan['protected'] and inventory() == plan['inventory']
             and h.static(UNIT) == plan['authority_static'], 'BASE_CHANGED_DURING_DRAIN')
        verify_candidate(plan)
        installed = publish(raw)
        h.run('systemctl','daemon-reload')
        target_static = expected_static(plan['authority_static'],plan['overlay_sha'])
        target_inventory = dict(plan['inventory'],**{str(SELECTOR):plan['overlay_sha']})
        need(h.static(UNIT) == target_static and inventory() == target_inventory, 'LOADED_CONFIG_CHANGED')
        verify_candidate(plan)
        start_attempted = True
        try:
            h.run('systemctl','start',UNIT)
        except BaseException:
            failed = failed_owned_state(plan,target_static,target_inventory,installed)
            if failed is not None:
                owned_state = failed
            raise
        owned_state = service_state()
        wait_ready(APP.name)
        need(environment() == plan['environment_sha'], 'ENVIRONMENT_CHANGED')
        need(Path(h.prop(UNIT,'WorkingDirectory')) == APP, 'WRONG_PROCESS_RELEASE')
        need(h.static(UNIT) == target_static and inventory() == target_inventory
             and h.path_state(SELECTOR) == installed, 'CONFIG_CHANGED_AFTER_START')
        need(captured() == plan['protected'] and service_state() == owned_state, 'PROTECTED_CHANGED')
        h.active([UNIT]+h.PRESERVE)
        verify_candidate(plan)
        h.reserve()
        h.record('API_APPLIED.json',{'source':SOURCE,'status':'APPLIED_API_ONLY',
                 'manifest_sha256':plan['candidate_manifest'],'protected_unchanged':True,
                 'main_pid':h.prop(UNIT,'MainPID'),'health_label':APP.name,
                 'live_provider_calls':0,'database_migrations':0})
        print('APPLIED_API_ONLY',flush=True)
    except BaseException:
        status = {'authority_rolled_back':False,'protected_unchanged':False}
        try:
            need(stopped, 'STOP_NOT_CONFIRMED')
            if start_attempted and service_state() != owned_state:
                failed = failed_owned_state(plan,target_static,target_inventory,installed)
                if failed is not None:
                    owned_state = failed
            need(service_state() == owned_state, 'ROLLBACK_SERVICE_STATE_CHANGED')
            # A publish may have moved the file before reporting failure.
            proof = ROOT/'API_OWNED.json'
            if installed is None and proof.exists():
                owned = json.loads(h.bounded(proof))
                need(owned['source'] == SOURCE and owned['installer_sha'] == sha(__file__)
                     and owned['selector'] == str(SELECTOR), 'FOREIGN_OWNERSHIP')
                installed = tuple(owned['state'])
            ours = installed is not None and h.path_state(SELECTOR) == installed
            no_overlay = h.path_state(SELECTOR) is None
            expected_inventory = dict(plan['inventory'])
            if ours:
                expected_inventory[str(SELECTOR)] = plan['overlay_sha']
            need((ours or no_overlay) and inventory() == expected_inventory, 'ROLLBACK_LATER_WRITER')
            h.stop(UNIT)
            rollback_state = service_state()
            if ours:
                need(h.path_state(SELECTOR) == installed, 'ROLLBACK_SELECTOR_CHANGED')
                h.replace_selection(SELECTOR,None,installed)
            h.run('systemctl','daemon-reload')
            need(inventory() == plan['inventory'] and h.static(UNIT) == plan['authority_static'],
                 'ROLLBACK_CONFIG_CHANGED')
            need(service_state() == rollback_state, 'ROLLBACK_SERVICE_STATE_CHANGED')
            h.run('systemctl','start',UNIT)
            wait_ready(plan['health_label'])
            need(environment() == plan['environment_sha'], 'ROLLBACK_ENVIRONMENT_CHANGED')
            status['authority_rolled_back'] = True
            status['protected_unchanged'] = captured() == plan['protected']
        finally:
            h.record('API_FAILED.json',status)
        need(all(status.values()), 'ROLLBACK_INCOMPLETE')
        raise

def main():
    need(os.geteuid() == 0, 'ROOT_REQUIRED')
    ROOT.mkdir(mode=0o700,exist_ok=True)
    w.secure(ROOT)
    with h.LOCK.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if sys.argv[1:] == ['recover-preparation']:
            recover_preparation()
        elif sys.argv[1:] == ['prepare']:
            prepare()
        else:
            need(len(sys.argv) == 3 and sys.argv[1] == 'apply','USAGE')
            apply(sys.argv[2])

if __name__ == '__main__':
    main()
