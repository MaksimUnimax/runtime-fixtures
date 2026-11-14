"""Finite Station/native update; unchanged cabinet, OAuth and database schema."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import urllib.error

ROOT = Path('/root/alisa-legacy-voice-install-20261114-r81-d11a9f2a')
PAYLOAD = Path('/run/alisa-legacy-voice-payload-r81-d11a9f2a')
OLD_ROOT = Path('/root/alisa-s09-clarification-install-20261113-d11a9f2a')
OPS_SHA = 'f8e68d5e0ad7502c8bd31f7c859a44921ba904f3265f8607e0f4091d2e596307'
RELEASES = Path('/opt/alice-market/releases')
REVIEWED_NATIVE_BASE = RELEASES/'alisa-accrual-day-speech-r1-20261114'
REVIEWED_NATIVE_SHA = 'af5fdc23472211d235770472703372e767bee7c77fee0a0c940a3cddd1b8c5c0'
NATIVE_BASE = REVIEWED_NATIVE_BASE
STATION_BASE = Path('/opt/alisa-station/releases/station-pending-ready-race-r1-20261113')
NATIVE_SHA = 'af5fdc23472211d235770472703372e767bee7c77fee0a0c940a3cddd1b8c5c0'
STATION_SHA = 'c4f389e45398ff933ae4d3dd86c8bab8dba0802b039accc8381e37e6f027a53d'
APP = Path('/opt/alisa-platform/stage/releases/alisa-template-clarification-81579c18d4725c7f')
AUTH_DIR = Path('/run/alisa-station')
DROP = Path('/etc/systemd/system/alisa-station.service.d/' + 'z'*40 + '-legacy-clarification-20261114.conf')
VERSIONS = Path('/etc/alisa-platform/stage/runtime-versions.json')
PROJECTION = Path('/etc/alisa-store-check/native-pair/scope.json')
LINK_ENV = Path('/etc/alisa-platform/stage/runtime-link.env')
OTHER = ['alisa-platform@stage.service', 'alisa-runtime-authority-stage.service',
         'alisa-web@stage.service', 'alisa-admin@stage.service', 'alisa-identity@stage.service',
         'alisa-smtp-sandbox-stage.service']
NATIVE_UNIT = 'alice-market.service'
STATION_UNIT = 'alisa-station.service'
CHECKER_UNIT = 'alisa-store-check.service'


def need(value, code):
    if not value:
        raise RuntimeError(code)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ops(source):
    path = OLD_ROOT/'install.py'; need(sha(path) == OPS_SHA, 'UTILITY_SOURCE_CHANGED')
    spec = importlib.util.spec_from_file_location('qualified_clarification_ops', path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    module.ROOT = ROOT; module.PAYLOAD = PAYLOAD; module.SOURCE = source
    module.NATIVE_BASE = NATIVE_BASE
    module.NATIVE = NATIVE_BASE.parent/('alisa-legacy-clarification-'+source[:16]+'-'+NATIVE_SHA[:8])
    module.BASE = module.APP = APP
    return module


def load_plan():
    value = json.loads((ROOT/'PLAN.json').read_text())
    need(type(value.get('source')) is str and re.fullmatch(r'[a-f0-9]{40}', value['source']), 'PLAN_SOURCE')
    need(set(value['native_files']) == {'engine.py', 'runtime.py', 'dialogue.py', 'template_runtime.py',
        'template_clarification.py', 'legacy_voice.py', 'CURRENT_CORE_MANIFEST.json',
        'tests/test_legacy_voice_clarification.py'}, 'NATIVE_SCOPE')
    need(set(value['station_files']) == {'service.py', 'station_authority.py'}, 'STATION_SCOPE')
    for kind in ('native', 'station'):
        for name, digest in value[kind+'_files'].items():
            p = PAYLOAD/kind/name
            need(not p.is_symlink() and p.resolve().is_relative_to(PAYLOAD) and sha(p) == digest,
                 'PAYLOAD_CHANGED')
    pin_base(value)
    return value


def compatible_base(reviewed, current):
    need(current.get('schema') == reviewed.get('schema'), 'BASE_SCHEMA_CHANGED')
    old, new = reviewed['files'], current['files']
    need(set(old) == set(new) and all(new[n] == old[n] for n in old if n != 'template_catalog.json'),
         'BASE_CODE_CHANGED')


def pin_base(value):
    global NATIVE_BASE, NATIVE_SHA
    name, digest = value.get('native_base'), value.get('native_base_manifest')
    need(type(name) is str and re.fullmatch(r'alisa-[a-zA-Z0-9_-]{1,120}', name), 'BASE_NAME')
    need(type(digest) is str and re.fullmatch(r'[a-f0-9]{64}', digest), 'BASE_DIGEST')
    selected = RELEASES/name
    need(not selected.is_symlink() and selected.resolve() == selected, 'BASE_PATH')
    need(sha(REVIEWED_NATIVE_BASE/'manifest.json') == REVIEWED_NATIVE_SHA, 'REVIEWED_BASE_CHANGED')
    need(sha(selected/'manifest.json') == digest, 'PINNED_BASE_CHANGED')
    compatible_base(json.loads((REVIEWED_NATIVE_BASE/'manifest.json').read_text()),
                    json.loads((selected/'manifest.json').read_text()))
    NATIVE_BASE, NATIVE_SHA = selected, digest


def station_target(value):
    return STATION_BASE.parent/('station-legacy-clarification-'+value['source'][:16]+'-'+NATIVE_SHA[:8])


def drop_bytes(target):
    return ('[Service]\nWorkingDirectory='+str(target)+'\nExecStart=\n'
        'ExecStart=/usr/bin/python3 -B '+str(target/'service.py')+
        ' --state /var/lib/alisa-station --key /run/credentials/alisa-station.service/station-key\n').encode()


def base_check(m):
    m.reserve()
    need(m.CURRENT.is_symlink() and m.CURRENT.resolve() == NATIVE_BASE, 'NATIVE_SELECTOR_MOVED')
    need(sha(NATIVE_BASE/'manifest.json') == NATIVE_SHA and sha(STATION_BASE/'manifest.json') == STATION_SHA,
         'BASE_MANIFEST_MOVED')
    need(Path(m.prop(NATIVE_UNIT, 'WorkingDirectory')).resolve() == NATIVE_BASE
         and m.prop(STATION_UNIT, 'WorkingDirectory') == str(STATION_BASE), 'PROCESS_BASE_MOVED')
    need(all(m.prop(u, 'ActiveState') == 'active' for u in OTHER+[NATIVE_UNIT, STATION_UNIT, CHECKER_UNIT]),
         'SERVICE_INACTIVE')
    return m.manifest(NATIVE_BASE), m.manifest(STATION_BASE)


def candidates(m, value, old):
    native, station = json.loads(json.dumps(old))
    core = json.loads((PAYLOAD/'native/CURRENT_CORE_MANIFEST.json').read_text())
    expected = {n: h for n, h in native['files'].items() if n != 'CURRENT_CORE_MANIFEST.json'}
    expected.update({n: h for n, h in value['native_files'].items() if n != 'CURRENT_CORE_MANIFEST.json'})
    need(core['files'] == expected, 'UNTOUCHED_NATIVE_FILES_CHANGED')
    for current, base, target, files, digest in (
        (native, NATIVE_BASE, m.NATIVE, value['native_files'], NATIVE_SHA),
        (station, STATION_BASE, station_target(value), value['station_files'], STATION_SHA)):
        need(not current.get('links'), 'UNEXPECTED_RELEASE_LINKS')
        previous_source = current.get('source_commit')
        current.update(artifact_id=target.name, source_commit=value['source'], base_release=base.name,
            base_manifest_sha256=digest, legacy_clarification_source=value['source'],
            parallel_source_commit=previous_source)
        current['files'].update(files)
    return native, station


def prepare(m, value):
    old = base_check(m); target = station_target(value)
    need(not m.NATIVE.exists() and not target.exists() and not DROP.exists()
         and not (ROOT/'PREPARED.json').exists(), 'CANDIDATE_EXISTS')
    new = candidates(m, value, old)
    extra = 8*1024**2 + sum((PAYLOAD/k/n).stat().st_size for k in ('native', 'station') for n in value[k+'_files'])
    m.reserve(extra, 512)
    helper = OLD_ROOT/'pair_helpers.py'
    need(sha(helper) == m.PAIR_SHA, 'PAIR_HELPER_CHANGED')
    m.atomic(ROOT/'pair_helpers.py', helper.read_bytes())
    created = []
    try:
        for base, dest, previous, candidate, kind in zip([NATIVE_BASE, STATION_BASE], [m.NATIVE, target], old, new, ['native','station']):
            created.append(dest); m.copy_release(base, dest, previous, candidate, kind)
        m.pair().expected_version_bytes(m.NATIVE)
        m.run('/usr/bin/python3', '-B', str(m.NATIVE/'runtime.py'), '--config', '/etc/alice-market/market-runtime.json', '--check')
        base_check(m)
        m.record('PREPARED.json', {'source': value['source'], 'budget_bytes': extra,
            'native_manifest': sha(m.NATIVE/'manifest.json'), 'station_manifest': sha(target/'manifest.json'),
            'database_or_access_changes': False, 'service_changes': False})
    except BaseException:
        m.record('PREPARE_FAILED.json', {'source': value['source'],
            'candidate_paths': [str(p) for p in created], 'service_changes': False})
        raise


def checked(m, value):
    old = base_check(m); expected = candidates(m, value, old)
    saved = json.loads((ROOT/'PREPARED.json').read_text())
    need(saved['source'] == value['source'] and not DROP.exists(), 'PREPARED_OR_SELECTOR_MOVED')
    for p, want, field in zip([m.NATIVE, station_target(value)], expected, ['native_manifest','station_manifest']):
        need(sha(p/'manifest.json') == saved[field] and m.manifest(p) == want, 'CANDIDATE_CHANGED')
    m.pair().expected_version_bytes(m.NATIVE)


def process(unit, m):
    pid = m.prop(unit, 'MainPID'); need(pid.isdigit() and int(pid) > 1, 'PROCESS_INACTIVE')
    data = {line.split(':',1)[0]: line.split(':',1)[1].strip()
            for line in Path('/proc/'+pid+'/status').read_text().splitlines() if ':' in line}
    return pid, int(data['Uid'].split()[0]), int(data['Gid'].split()[0]), list(map(int, data['Groups'].split()))


def stop_unit(m, unit):
    state = m.prop(unit, 'ActiveState')
    if state in ('inactive', 'failed'):
        return
    # Native has a two-minute graceful stop. A timed-out systemctl caller must
    # not start another stop job while the first one is still draining workers.
    if state != 'deactivating':
        m.run('systemctl', '--no-block', 'stop', unit)
    deadline = time.monotonic()+125
    while m.prop(unit, 'ActiveState') not in ('inactive', 'failed'):
        need(time.monotonic() < deadline, 'STOP_OUTCOME_UNRESOLVED')
        time.sleep(.3)


class StartupPending(Exception):
    pass


def remaining(deadline, maximum):
    left = deadline - time.monotonic()
    if left <= 0:
        raise StartupPending('READINESS_DEADLINE')
    return min(left, maximum)


def ready(m, value, rollback=False):
    deadline = time.monotonic() + 30
    while True:
        try:
            ready_once(m, value, rollback, deadline)
            return
        except (StartupPending, FileNotFoundError, ConnectionRefusedError,
                TimeoutError, subprocess.TimeoutExpired) as error:
            reason = type(error).__name__
        except urllib.error.HTTPError as error:
            if error.code not in (502, 503, 504):
                raise
            reason = 'HTTP_' + str(error.code)
        except urllib.error.URLError as error:
            if not isinstance(error.reason, (ConnectionRefusedError, TimeoutError)):
                raise
            reason = type(error.reason).__name__
        need(time.monotonic() < deadline, 'READINESS_TIMEOUT_' + reason)
        time.sleep(min(.3, deadline - time.monotonic()))


def ready_once(m, value, rollback, deadline):
    target = STATION_BASE if rollback else station_target(value)
    native = NATIVE_BASE if rollback else m.NATIVE
    states = [m.prop(u, 'ActiveState') for u in OTHER+[NATIVE_UNIT,STATION_UNIT,CHECKER_UNIT]]
    need(not any(state == 'failed' for state in states), 'SERVICE_FAILED')
    if any(state != 'active' for state in states):
        raise StartupPending('SERVICE_STARTING')
    need(m.prop(STATION_UNIT, 'WorkingDirectory') == str(target)
         and Path('/proc/'+m.prop(NATIVE_UNIT,'MainPID')+'/cwd').resolve() == native, 'INSTALLED_PROCESS_MISMATCH')
    pid, uid, gid, groups = process(NATIVE_UNIT, m)
    if not rollback:
        modes = (AUTH_DIR.stat().st_mode & 0o777,
                 (AUTH_DIR/'authorization.sock').stat().st_mode & 0o777,
                 (AUTH_DIR/'ingress.sock').stat().st_mode & 0o777)
        # bind() runs under umask 077, before the explicit final chmod calls.
        # Only these restrictive startup modes are transient; wider ACLs fail.
        need(modes[0] in (0o700, 0o710) and modes[1] in (0o600, 0o700, 0o660)
             and modes[2] == 0o700, 'SOCKET_MODE')
        if modes != (0o710, 0o660, 0o700):
            raise StartupPending('SOCKET_INITIALIZING')
        code = """import socket,json
import errno,sys
try:
 with socket.socket(socket.AF_UNIX)as s:
  s.settimeout(1);s.connect('/run/alisa-station/authorization.sock')
  s.sendall(b'{"op":"admit","tenant":"synthetic-readiness-probe","conversation":"synthetic-session","rid":"synthetic-request"}\\n')
  assert json.loads(s.recv(4000))=={'guard':None}
except OSError as error:
 if isinstance(error,TimeoutError) or error.errno in (errno.ENOENT,errno.ECONNREFUSED,errno.EAGAIN):
  sys.exit(75)
 raise
print('PASS')
"""
        result = subprocess.run(['/usr/bin/python3','-I','-B','-c',code],user=uid,group=gid,extra_groups=groups,
            capture_output=True,text=True,timeout=remaining(deadline,3),env={'PATH':'/usr/bin:/bin'})
        if result.returncode == 75:raise StartupPending('STATION_AUTHORITY_STARTING')
        need(result.returncode == 0 and result.stdout.strip() == 'PASS', 'CORE_UID_STATION_AUTHORITY')
    pid, uid, gid, groups = process(OTHER[0], m)
    env = {k.decode(): v.decode() for item in Path('/proc/'+pid+'/environ').read_bytes().split(b'\0')
           if b'=' in item for k,v in [item.split(b'=',1)]}
    code = """import django,json
django.setup()
from alisa_platform.runtime_adapter.client import configured_client
class MetadataOnly:
 def prepare(self,*a):raise AssertionError('OWNER_ADMISSION_FORBIDDEN')
 def current(self,*a):raise AssertionError('OWNER_ADMISSION_FORBIDDEN')
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
import sys
try:
 print(json.dumps(configured_client(MetadataOnly()).current_versions()))
except RuntimeFailure as error:
 if error.code == 'DEPENDENCY_UNAVAILABLE':sys.exit(75)
 raise
"""
    result = subprocess.run([str(APP/'.venv/bin/python'),'-B','-c',code],user=uid,group=gid,extra_groups=groups,
        cwd=APP,capture_output=True,text=True,timeout=remaining(deadline,12),env={**env,'PYTHONPATH':str(APP/'services/platform/src')})
    if result.returncode == 75:raise StartupPending('RUNTIME_METADATA_STARTING')
    need(result.returncode == 0 and json.loads(result.stdout) == json.loads(VERSIONS.read_text()), 'VERSION_HANDSHAKE')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for port in (18102,18100):
        with opener.open('http://127.0.0.1:'+str(port)+'/health/ready',timeout=remaining(deadline,3)) as response:
            need(response.status == 200, 'PLATFORM_READINESS')
    m.pair().projection_data(); m.reserve()


def activate(m, value, lock):
    checked(m, value)
    need(not (ROOT/'backup').exists() and not (ROOT/'ACTIVATED.json').exists(), 'ALREADY_STARTED')
    pair = m.pair(); original = pair.projection_data()
    files = [VERSIONS, PROJECTION, LINK_ENV]
    old = {p: p.read_bytes() for p in files}
    expected = dict(old); expected[VERSIONS] = pair.expected_version_bytes(m.NATIVE)
    others = {u: {k:m.prop(u,k) for k in ('MainPID','WorkingDirectory')} for u in OTHER}
    (ROOT/'backup').mkdir(mode=0o700)
    for i,p in enumerate(files):
        m.atomic(ROOT/'backup'/str(i),old[p])
    m.record('BACKUP_INDEX.json', [str(p) for p in files])
    contents = drop_bytes(station_target(value))
    try:
        stop_unit(m,STATION_UNIT); stop_unit(m,NATIVE_UNIT)
        m.atomic(DROP,contents,0o644); m.pointer(m.CURRENT,m.NATIVE); pair.sync(m.NATIVE,lock)
        m.run('systemctl','daemon-reload'); m.run('systemctl','start',NATIVE_UNIT)
        pair.refresh_projection(original,on_write=lambda raw:expected.update({PROJECTION:raw}))
        m.run('systemctl','start',STATION_UNIT)
        ready(m,value)
        need(LINK_ENV.read_bytes() == old[LINK_ENV], 'LINK_AUTH_CHANGED')
        need(all(all(m.prop(u,k)==v for k,v in state.items()) for u,state in others.items()), 'OTHER_SERVICE_CHANGED')
        m.record('ACTIVATED.json', {'status':'INSTALLED_TECHNICAL_CHECKS_PASS','source':value['source'],
            'native_release':m.NATIVE.name,'station_release':station_target(value).name,
            'native_manifest':sha(m.NATIVE/'manifest.json'),'station_manifest':sha(station_target(value)/'manifest.json'),
            'database_migrations':[],'new_accounts_links_grants':0,'live_owner':'NOT_PERFORMED',
            'verifier_marketplace_or_model_calls':0,'other_six_service_pids_unchanged':True})
    except BaseException:
        failures = []
        def attempt(label, action):
            try:action()
            except BaseException:failures.append(label)
        need(m.CURRENT.resolve() in (NATIVE_BASE,m.NATIVE)
             and (not DROP.exists() or DROP.read_bytes()==contents)
             and all(p.read_bytes() in (old[p],expected[p]) for p in files), 'ROLLBACK_LATER_WRITER')
        attempt('stop_station',lambda:stop_unit(m,STATION_UNIT))
        attempt('stop_native',lambda:stop_unit(m,NATIVE_UNIT))
        if DROP.exists():DROP.unlink()
        attempt('native_selector',lambda:m.pointer(m.CURRENT,NATIVE_BASE))
        attempt('versions',lambda:pair.sync(NATIVE_BASE,lock))
        attempt('reload',lambda:m.run('systemctl','daemon-reload'))
        attempt('native',lambda:m.run('systemctl','start',NATIVE_UNIT))
        attempt('owner_pair',lambda:pair.refresh_projection(original))
        attempt('station',lambda:m.run('systemctl','start',STATION_UNIT))
        attempt('readiness',lambda:ready(m,value,rollback=True))
        m.record('ROLLED_BACK.json',{'status':'ROLLBACK_NEEDS_ATTENTION' if failures else 'ROLLED_BACK','failures':failures})
        raise


def main():
    need(os.geteuid()==0 and sys.argv[1:] in [['--prepare'],['--check'],['--apply']], 'ARGUMENTS')
    value=load_plan(); m=ops(value['source'])
    with Path('/run/lock/alisa-stage-rollout.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        if sys.argv[1]=='--prepare':prepare(m,value)
        elif sys.argv[1]=='--check':checked(m,value)
        else:activate(m,value,lock)
    print(json.dumps({'status':'PASS','operation':sys.argv[1],'source':value['source']}))


if __name__=='__main__':
    try:main()
    except Exception as error:
        code=str(error) if isinstance(error,RuntimeError) else type(error).__name__
        print(json.dumps({'status':'BLOCKED','code':code}));raise SystemExit(1)
