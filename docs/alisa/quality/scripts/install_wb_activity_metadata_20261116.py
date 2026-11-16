"""Finite metadata+web rollout over the exact installed R5 core; no migrations."""
from copy import deepcopy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import time

sys.dont_write_bytecode = True
SOURCE = 'e0a10bb47fe1cd83bbc4aaa47fa1f05ae3a4b725'
ROOT = Path('/root/alisa-wb-date-axis-install-20261116')
NATIVE_BASE = Path('/opt/alice-market/releases/alisa-parameters-1d572aebf6b05b88')
NATIVE = NATIVE_BASE.parent / ('alisa-wb-activity-' + SOURCE[:16])
CURRENT = NATIVE_BASE.parent / 'current'
NATIVE_PIN = '20c5afddbc8f07c86e72a33676d4475c4b23b7c0316bc73f814e51dc5a60e95e'
CANDIDATE_PIN = 'fa078b54e2bf1b57ae3c55e7ffba2a832367a17755a9c24eeedf7bc0d70ddb29'
WEB_BASE = Path('/opt/alisa-platform/stage/releases/alisa-catalog-units-0e00c848d3a4ad58')
WEB_PIN = 'c1fcd96cedb2278d06c9e384c883d38d471e0cb8a3743ce66022bdf1f4a15fba'
WEB_LINK = Path('/opt/alisa-platform/stage/web-current')
UNIT = 'alice-market.service'
CHECKER = 'alisa-store-check.service'
WEB = 'alisa-web@stage.service'
KEEP = ['alisa-platform@stage.service', 'alisa-identity@stage.service', 'alisa-admin@stage.service',
        'alisa-runtime-authority-stage.service', 'alisa-station.service', 'alisa-smtp-sandbox-stage.service']
CFG = Path('/etc/alice-market/market-runtime.json')
UTIL = Path('/root/alisa-catalog-units-install-20261116/install.py')
UTIL_SHA = 'e908cbb7819dd58501b1e5cfd5e7384c5a90ae4abe8cfaf9e1ddfafa5d34747c'
PAIR = Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a/pair_helpers.py')
PAIR_SHA = '194b45ba797b053544bff9db84a1e933da62db34dba6e55835121f66eb2f8fb9'
SYNC = Path('/usr/local/libexec/alisa/runtime_versions_sync.py')
SYNC_SHA = 'b57ebf6be29b05d08955b043cc3036592cf768016d4fcf18ac6ff67b1d63cee0'
WEB_DRIVER = ROOT / 'install_web.py'
WEB_SHA = '77bacd09b193ed28a52263d7717103797ca9a074b114d1a31d2c222f05903b4e'
PAYLOAD = Path('/dev/shm/alisa-wb-date-axis-e0a10bb4')
RUNTIME = PAYLOAD / ('payload/runtime/alisa-runtime-' + SOURCE[:16])
RUNTIME_TAR = PAYLOAD / ('alisa-runtime-' + SOURCE[:16] + '.tar.gz')
RUNTIME_SHA = 'ef715d2ac07c768fbb4d7aacb572d1f4fd05cd52d70190758f2231699ab56dff'
PLATFORM = PAYLOAD / ('payload/platform/alisa-' + SOURCE[:16])
PLATFORM_TAR = PAYLOAD / ('alisa-' + SOURCE[:16] + '.tar.gz')
PLATFORM_SHA = 'a52e35a86ce5745fde2eccf8b31ed55260a36dfd3d1cbaec11e64abce6afb190'
PRODUCER = RUNTIME / 'question_catalog/build_overlay.py'
PRODUCER_SHA = '32c64695a2a93622949c3e744a9bacb4be1a912871330c392472d9dcf509c711'
IDS = {'B14.card_views', 'B14.cart_additions'}
UNKNOWN = {'2d9fcf8f5a7e460ba4e95f1e2480734b', 'c720b083719d4c58a9952c5304b2fb48',
           'c9a51d9a15f14d68a6848a97b96c9bb0', 'ef81bb77451b4981b76cf7adb2ed0f8c'}


def need(value, code):
    if not value:
        raise RuntimeError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def module(path, expected, name):
    need(sha(path) == expected, 'UTILITY_CHANGED')
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def helpers():
    utility = module(UTIL, UTIL_SHA, 'reviewed_units_helpers')
    utility.EFFECTIVE_BASES.pop(UNIT)
    utility.h.ROOT = ROOT
    pair = module(PAIR, PAIR_SHA, 'reviewed_owner_helpers')
    need(sha(SYNC) == SYNC_SHA, 'SYNC_CHANGED')
    pair.ROOT, pair.SOURCE = ROOT, SOURCE
    pair.NATIVE_BASE, pair.NATIVE, pair.CURRENT = NATIVE_BASE, NATIVE, CURRENT
    return utility, utility.h, pair


def capture(utility):
    value = utility.capture()
    value.pop('native')
    value['pids'] = {key: value['pids'][key] for key in KEEP}
    value['web_static'] = utility.h.static(WEB)
    value['web_base_manifest'] = sha(WEB_BASE / 'manifest.json')
    value['native_config'] = sha(CFG)
    return value


def queue():
    cfg = json.loads(CFG.read_text())
    with sqlite3.connect(Path(cfg['database']).as_uri() + '?mode=ro', uri=True, timeout=2) as db:
        active = db.execute("SELECT count(*) FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]
        unknown = {row[0] for row in db.execute("SELECT id FROM jobs WHERE state='UNKNOWN'")}
        maximum = db.execute('SELECT COALESCE(MAX(id),0) FROM calls').fetchone()[0]
    need(active == 0 and unknown == UNKNOWN, 'QUEUE_MOVED')
    return {'max_call_id': maximum, 'at': time.time(), 'unknown': sorted(unknown)}


def record(h, name, value):
    h.atomic(ROOT / name, (json.dumps(value, indent=2) + '\n').encode(), 0o600)


def select(h, link, target, expected):
    temp = link.with_name('.wb-activity-' + link.name)
    need(h.path_state(temp) is None, 'SELECTOR_TEMP_EXISTS')
    temp.symlink_to(target)
    staged = h.path_state(temp)
    try:
        h.replace_selection(link, temp, expected, staged)
        return staged
    finally:
        if h.path_state(temp) == staged:
            temp.unlink()


def make_web_directory(web):
    need(web.ROOT == ROOT/'web', 'WEB_ROOT_SCOPE')
    need(not web.ROOT.exists() and not web.ROOT.is_symlink(), 'WEB_STATE_EXISTS')
    web.ROOT.mkdir(mode=0o700)
    web.secure(web.ROOT)
    st = web.ROOT.lstat()
    return st.st_dev, st.st_ino


def same_web_directory(web, identity):
    web.secure(web.ROOT)
    st = web.ROOT.lstat()
    need((st.st_dev, st.st_ino) == identity, 'WEB_DIRECTORY_MOVED')


def metadata_guard(old_blocks, old_catalog, changes):
    need(set(changes) == {'base_blocks.json', 'template_catalog.json'}, 'METADATA_SCOPE')
    blocks, catalog = deepcopy(old_blocks), deepcopy(old_catalog)
    need(len(catalog['templates']) == 88, 'TEMPLATE_COUNT')
    for tid in IDS:
        template = catalog['templates'][tid]
        need(template['version'] == 1 and template['input_policy']['time_axis'] == 'order_period',
             'METADATA_BASE_MOVED')
        template['version'] = 2
        template['input_policy']['time_axis'] = 'analytics_period'
        rows = [row for row in blocks['entries'] if row.get('id') == tid]
        need(len(rows) == 1 and rows[0]['time_axis'] == 'order_period', 'METADATA_BASE_MOVED')
        rows[0]['time_axis'] = 'analytics_period'
    need(json.loads(changes['template_catalog.json']) == catalog and
         json.loads(changes['base_blocks.json']) == blocks, 'METADATA_EXECUTION_CHANGED')


def native_process(h, root):
    pid = h.prop(UNIT, 'MainPID')
    need(pid.isdigit() and pid != '0' and Path('/proc/' + pid + '/cwd').resolve() == root,
         'NATIVE_PROCESS_MISMATCH')


def prepare():
    utility, h, pair = helpers()
    utility.secure(ROOT)
    need(not (ROOT / 'PLAN.json').exists() and not NATIVE.exists(), 'ALREADY_PREPARED')
    need(CURRENT.is_symlink() and CURRENT.resolve(strict=True) == NATIVE_BASE and
         WEB_LINK.is_symlink() and WEB_LINK.resolve(strict=True) == WEB_BASE, 'BASE_MOVED')
    need(sha(NATIVE_BASE / 'manifest.json') == NATIVE_PIN and
         sha(WEB_BASE / 'manifest.json') == WEB_PIN and sha(WEB_DRIVER) == WEB_SHA, 'BASE_PIN')
    h.active(KEEP + [UNIT, CHECKER, WEB]); queue(); native_process(h, NATIVE_BASE)
    before = capture(utility)
    native_state, web_state = h.path_state(CURRENT), h.path_state(WEB_LINK)
    changing = {unit: {key: h.prop(unit, key) for key in ['MainPID', 'InvocationID']}
                for unit in [UNIT, CHECKER, WEB]}
    old = h.manifest(NATIVE_BASE)
    runtime = h.package_manifest(RUNTIME, RUNTIME_TAR, RUNTIME_SHA)
    need(runtime['source_sha'] == SOURCE, 'RUNTIME_SOURCE')
    platform = h.package_manifest(PLATFORM, PLATFORM_TAR, PLATFORM_SHA)
    web_base = h.manifest(WEB_BASE)
    need(platform['source_sha'] == SOURCE and platform['locks'] == web_base['locks'] and
         platform['contracts'] == web_base['contracts'], 'PLATFORM_CONTRACT_CHANGED')
    producer = module(PRODUCER, PRODUCER_SHA, 'qualified_activity_producer')
    changes = producer.activity_sources(NATIVE_BASE)
    metadata_guard(json.loads((NATIVE_BASE / 'base_blocks.json').read_text()),
                   json.loads((NATIVE_BASE / 'template_catalog.json').read_text()), changes)
    extra = sum(len(value.encode()) for value in changes.values())
    h.reserve(extra + 32 * 1024**2, 20000)
    value = deepcopy(old)
    value['files'].update({name: digest(raw.encode()) for name, raw in changes.items()})
    value.update(artifact_id=NATIVE.name, base_release=NATIVE_BASE.name, base_manifest_sha256=NATIVE_PIN,
                 catalog_metadata_source=SOURCE, catalog_metadata_producer_sha256=PRODUCER_SHA)
    need(digest((json.dumps(value, indent=2) + '\n').encode()) == CANDIDATE_PIN, 'CANDIDATE_PLAN_CHANGED')
    NATIVE.mkdir(mode=0o755)
    for name, expected in value['files'].items():
        need(h.safe(name), 'FILE_PATH')
        dst = NATIVE / name; dst.parent.mkdir(parents=True, exist_ok=True)
        if name in changes:
            h.atomic(dst, changes[name].encode(), 0o644)
        else:
            need(sha(NATIVE_BASE / name) == expected, 'BASE_FILE_CHANGED')
            os.link(NATIVE_BASE / name, dst)
    h.atomic(NATIVE / 'manifest.json', (json.dumps(value, indent=2) + '\n').encode(), 0o644)
    h.manifest(NATIVE)
    h.exact_tree(NATIVE, value)
    expected_versions = pair.expected_version_bytes(NATIVE)
    need(capture(utility) == before and h.path_state(CURRENT) == native_state and
         h.path_state(WEB_LINK) == web_state, 'PREPARE_CONTEXT_MOVED')
    native_process(h, NATIVE_BASE)
    record(h, 'PLAN.json', {'source': SOURCE, 'installer_sha': sha(__file__), 'web_installer_sha': WEB_SHA,
        'native_manifest': CANDIDATE_PIN, 'protected': before, 'native_selector': native_state,
        'web_selector': web_state, 'changing_pids': changing, 'versions_sha': digest(expected_versions),
        'native_files': len(value['files']), 'new_native_bytes': extra})
    print(json.dumps({'prepared': True, 'plan_sha256': sha(ROOT/'PLAN.json'),
                      'native_manifest': CANDIDATE_PIN, 'new_native_bytes': extra}), flush=True)


def checked(expected):
    utility, h, pair = helpers()
    need(sha(ROOT / 'PLAN.json') == expected, 'PLAN_CHANGED')
    utility.secure(ROOT)
    plan = json.loads((ROOT / 'PLAN.json').read_text())
    need(plan['source'] == SOURCE and plan['installer_sha'] == sha(__file__) and
         plan['web_installer_sha'] == WEB_SHA and sha(WEB_DRIVER) == WEB_SHA, 'PLAN_SOURCE')
    need(capture(utility) == plan['protected'] and
         h.path_state(CURRENT) == tuple(plan['native_selector']) and
         h.path_state(WEB_LINK) == tuple(plan['web_selector']), 'APPLY_CONTEXT_MOVED')
    now = {unit: {key: h.prop(unit, key) for key in ['MainPID', 'InvocationID']}
           for unit in [UNIT, CHECKER, WEB]}
    need(now == plan['changing_pids'], 'CHANGING_PROCESS_MOVED')
    need(sha(NATIVE/'manifest.json') == plan['native_manifest'] == CANDIDATE_PIN, 'CANDIDATE_CHANGED')
    value = h.manifest(NATIVE)
    h.exact_tree(NATIVE, value)
    h.reserve(); queue(); native_process(h, NATIVE_BASE)
    need(digest(pair.expected_version_bytes(NATIVE)) == plan['versions_sha'], 'VERSIONS_CHANGED')
    return plan, utility, h, pair


def metadata_read(h, pair):
    pid = h.prop('alisa-platform@stage.service', 'MainPID')
    env = {k.decode(): v.decode() for item in Path('/proc/'+pid+'/environ').read_bytes().split(b'\0')
           if b'=' in item for k, v in [item.split(b'=', 1)]}
    fields = {line.split(':', 1)[0]: line.split(':', 1)[1].strip()
              for line in Path('/proc/'+pid+'/status').read_text().splitlines() if ':' in line}
    base = Path(h.prop('alisa-platform@stage.service', 'WorkingDirectory')).resolve()
    env['PYTHONPATH'] = str(base / 'services/platform/src')
    code = """import django,json
django.setup()
from alisa_platform.runtime_adapter.client import configured_client
from alisa_platform.catalog.reader import read
class MetadataOnly:
 def prepare(self,*a): raise AssertionError('OWNER_ADMISSION_FORBIDDEN')
 def current(self,*a): return False
api=configured_client(MetadataOnly())
v=read(api,scoped=False)
ids={'B14.card_views','B14.cart_additions'}
print(json.dumps({'count':len(v['items']),'versions':v['versions'],'template_hash':v['template_hash'],
 'b14':{r['id']:{'version':r['version'],'axis':r['input_policy']['time_axis']} for r in v['items'] if r['id'] in ids}}))
"""
    result = subprocess.run([str(base/'.venv/bin/python'), '-B', '-c', code], cwd=base, env=env,
        user=int(fields['Uid'].split()[0]), group=int(fields['Gid'].split()[0]),
        extra_groups=list(map(int, fields['Groups'].split())), capture_output=True, text=True, timeout=15)
    need(result.returncode == 0, 'METADATA_READ_FAILED')
    value = json.loads(result.stdout)
    need(value['count'] == 88 and value['versions'] == json.loads(pair.VERSIONS.read_text())
         and set(value['b14']) == IDS and
         all(row == {'version': 2, 'axis': 'analytics_period'} for row in value['b14'].values()),
         'LIVE_METADATA_MISMATCH')
    return value


def rollback(plan, utility, h, pair, original, owned, allowed_versions, allowed_projection, lock, web_expected=None):
    expected_native = owned if owned is not None else tuple(plan['native_selector'])
    expected_web = tuple(plan['web_selector']) if web_expected is None else tuple(web_expected)
    def guard():
        need(capture(utility) == plan['protected'], 'ROLLBACK_PROTECTED_MOVED')
        need(h.path_state(CURRENT) == expected_native, 'ROLLBACK_SELECTOR_MOVED')
        need(h.path_state(WEB_LINK) == expected_web and WEB_LINK.resolve(strict=True) == WEB_BASE,
             'ROLLBACK_WEB_REQUIRES_REVIEW')
        need(sha(pair.VERSIONS) in allowed_versions and sha(pair.PROJECTION) in allowed_projection,
             'ROLLBACK_MUTABLE_MOVED')
    guard()
    queue()
    h.run('systemctl', 'stop', UNIT)
    need(h.prop(UNIT, 'ActiveState') == 'inactive', 'ROLLBACK_STOP_UNRESOLVED')
    queue()
    guard()
    if owned is not None:
        expected_native = select(h, CURRENT, NATIVE_BASE, owned)
    guard()
    pair.sync(NATIVE_BASE, lock)
    guard()
    h.run('systemctl', 'start', UNIT)
    pair.refresh_projection(original)
    native_process(h, NATIVE_BASE)
    h.active(KEEP + [UNIT, CHECKER, WEB])
    need(capture(utility) == plan['protected'], 'ROLLBACK_PROTECTED_MOVED')
    record(h, 'ROLLED_BACK.json', {'status': 'RESTORED', 'source': SOURCE})


def apply(expected, lock):
    plan, utility, h, pair = checked(expected)
    need(not any((ROOT/name).exists() for name in
                 ['BEFORE.json', 'APPLIED.json', 'SETUP_FAILED.json']), 'ALREADY_STARTED')
    web = module(WEB_DRIVER, WEB_SHA, 'reviewed_activity_web')
    original = pair.projection_data()
    old_versions, old_projection = pair.VERSIONS.read_bytes(), pair.PROJECTION.read_bytes()
    new_versions = pair.expected_version_bytes(NATIVE)
    allowed_versions = {digest(old_versions), digest(new_versions)}
    allowed_projection = {digest(old_projection)}
    owned = None
    transition_started = False
    web_identity = None
    web_expected = tuple(plan['web_selector'])
    def accept_web_restore(state):
        nonlocal web_expected
        web_expected = tuple(state)
    try:
        web_identity = make_web_directory(web)
        record(h, 'BEFORE.json', {'plan_sha256': expected, 'queue': queue(), 'source': SOURCE})
        h.atomic(ROOT/'rollback-versions.json', old_versions, 0o600)
        h.atomic(ROOT/'rollback-projection.json', old_projection, 0o600)
        transition_started = True
        h.run('systemctl', 'stop', UNIT)
        need(h.prop(UNIT, 'ActiveState') == 'inactive', 'NATIVE_STOP_UNRESOLVED')
        queue()
        need(capture(utility) == plan['protected'], 'PROTECTED_CHANGED')
        owned = select(h, CURRENT, NATIVE, tuple(plan['native_selector']))
        record(h, 'OWNED_SELECTOR.json', {'native_selector': owned})
        pair.sync(NATIVE, lock)
        need(pair.VERSIONS.read_bytes() == new_versions, 'VERSION_PUBLICATION_MISMATCH')
        h.run('systemctl', 'start', UNIT)
        pair.refresh_projection(original, on_write=lambda raw: allowed_projection.add(digest(raw)))
        native_process(h, NATIVE)
        need(h.path_state(CURRENT) == owned, 'NATIVE_SELECTOR_MOVED')
        value = metadata_read(h, pair)
        need(capture(utility) == plan['protected'], 'PROTECTED_CHANGED')
        same_web_directory(web, web_identity)
        need(h.path_state(WEB_LINK) == web_expected, 'WEB_SELECTOR_MOVED_BEFORE_PREPARE')
        web.prepare()
        web.apply(sha(web.ROOT/'PLAN.json'), on_restore=accept_web_restore)
        h.active(KEEP + [UNIT, CHECKER, WEB])
        need(h.path_state(CURRENT) == owned, 'NATIVE_SELECTOR_MOVED')
        need(capture(utility) == plan['protected'], 'PROTECTED_CHANGED')
        q = queue()
        record(h, 'APPLIED.json', {'status': 'INSTALLED_TECHNICAL_PASS', 'source': SOURCE,
            'native': str(NATIVE), 'native_manifest': CANDIDATE_PIN, 'web': str(web.APP),
            'metadata': value, 'protected_six_unchanged': True, 'queue': q,
            'browser_acceptance': 'PENDING', 'changed_services': [UNIT, CHECKER, WEB]})
    except BaseException as failure:
        if not transition_started:
            record(h, 'SETUP_FAILED.json', {'status': 'SETUP_FAILED_NO_SERVICE_TRANSITION',
                'code': str(failure)[:160], 'web_directory_identity': web_identity,
                'retry': 'Review preserved setup evidence before retry; no automatic deletion.'})
            raise
        try:
            rollback(plan, utility, h, pair, original, owned, allowed_versions, allowed_projection,
                     lock, web_expected)
        except BaseException as error:
            record(h, 'ROLLBACK_BLOCKED.json', {'status': 'REQUIRES_REVIEW', 'code': str(error)[:160]})
            raise RuntimeError('ROLLBACK_REQUIRES_REVIEW') from None
        raise


def main():
    os.umask(0o077)
    need(len(sys.argv) in (2, 3), 'USAGE')
    ROOT.mkdir(mode=0o700, exist_ok=True)
    with Path('/run/lock/alisa-stage-rollout.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if sys.argv[1] == '--prepare' and len(sys.argv) == 2:
            prepare()
        elif sys.argv[1] == '--apply' and len(sys.argv) == 3:
            apply(sys.argv[2], lock)
        else:
            raise RuntimeError('USAGE')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'status': 'BLOCKED', 'code': str(error)[:160]}), flush=True)
        raise SystemExit(1)
