"""Install the finite restart hook; native core/API/web/DB are not changed."""
import base64
import grp
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pwd
import shutil
import signal
import subprocess
import sys

sys.dont_write_bytecode = True
os.umask(0o077)
D = Path('/var/lib/alisa-platform/stage/rollout-backups/s05-native-pair-20261108')
SOURCE = D/'install-r5.py'
if hashlib.sha256(SOURCE.read_bytes()).hexdigest() != 'ec75e6016fffc43ba431e8810880f2537fc4d288cfa5ebe67a7bc8c0d2756ff0':
    raise ValueError('UNEXPECTED_REVIEWED_INSTALL_SOURCE')
spec = importlib.util.spec_from_file_location('installation', SOURCE)
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
TARGETS = {
    'requalify.py': Path('/etc/alisa-store-check/native-pair/requalify.py'),
    'alisa-native-pair-refresh.service': Path('/etc/systemd/system/alisa-native-pair-refresh.service'),
    'native-pair-refresh.conf': Path('/etc/systemd/system/alisa-store-check.service.d/zzzzzzz-native-pair-refresh-20261108.conf'),
}
EXPECTED = {'requalify.py': 'ab6c237e9a5affda88df6bb91dc2f7c9f9b09d1c0f9f3f4fe7b34cbc02e7d799', 'alisa-native-pair-refresh.service': '29608ba61951f1ec610781e17c8d5d2a6e614c13c6997a4296d1c2d9129e0411', 'native-pair-refresh.conf': '8d225c86c0103b69ab30d7f78b3f16694acaebc7ef7bc7ebc18f2bf35633c253'}
record = {'status': 'FAILED', 'scope': 'UNCHANGED_NATIVE_PAIR_RESTART_HOOK', 'cases': []}
created = []


def check(name, ok):
    record['cases'].append({'case': name, 'passed': bool(ok)})
    if not ok: raise ValueError(name)


def run():
    before = m.snapshot()
    check('exact_installed_overlay', (m.B/'site-current').resolve() == m.API and m.command(['systemctl', 'show', m.UNIT, '-p', 'WorkingDirectory', '--value']) == str(m.CHECKER)
          and m.sha((m.API/m.SERVICE).read_bytes()) == m.FILES['service.py']
          and m.sha((m.CHECKER/'native_store_binding.py').read_bytes()) == m.FILES['native_store_binding.py'])
    check('resource_reserve', shutil.disk_usage('/').free >= m.FLOOR+524288 and os.statvfs('/').f_favail >= 200000)
    payload = json.loads((D/'refresh-payload-r2.json').read_text())
    check('only_reviewed_sources', set(payload) == set(TARGETS) == set(EXPECTED))
    values = {n: base64.b64decode(v) for n,v in payload.items()}
    check('exact_source_hashes', all(m.sha(values[n]) == EXPECTED[n] for n in TARGETS))
    check('fresh_owned_paths', all(not p.exists() and not p.is_symlink() for p in TARGETS.values()))
    try:
        for name, target in TARGETS.items():
            m.secure(target.parent)
            blocked = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
            try:
                fd = os.open(target, os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW, 0o600)
                st = os.fstat(fd); created.append((target, st.st_dev, st.st_ino))
            finally: signal.pthread_sigmask(signal.SIG_SETMASK, blocked)
            with os.fdopen(fd, 'wb') as f:
                f.write(values[name]); f.flush(); os.fsync(f.fileno()); os.fchmod(f.fileno(), 0o644)
        m.command(['systemctl', 'daemon-reload'])
        m.command(['systemctl', 'restart', m.UNIT], timeout=35)
        check('checker_active', m.command(['systemctl', 'is-active', m.UNIT]) == 'active')
        unit = m.command(['systemctl', 'show', 'alisa-native-pair-refresh.service', '-p', 'Result,ExecMainStatus,MemoryMax,MemorySwapMax,TasksMax,TimeoutStartUSec,TimeoutStopUSec,PrivateNetwork,ReadWritePaths'])
        check('refresh_one_shot_succeeded', 'Result=success' in unit and 'ExecMainStatus=0' in unit)
        sys.path.insert(0, str(m.CHECKER))
        from native_store_binding import process_generation, root_json
        proof = root_json(m.BIND/'scope.json', 65536)
        pid = int(m.command(['systemctl', 'show', 'alice-market.service', '-p', 'MainPID', '--value']))
        check('proof_matches_current_native_generation', proof['native_generation'] == process_generation(pid))
        pins = json.loads((D/'pins.private.json').read_text())
        native = json.loads(Path('/run/credentials/alice-market.service/ozon').read_text())
        user = m.command(['systemctl', 'show', m.APIUNIT, '-p', 'User', '--value'])
        group = m.command(['systemctl', 'show', m.APIUNIT, '-p', 'Group', '--value'])
        groups = m.command(['systemctl', 'show', m.APIUNIT, '-p', 'SupplementaryGroups', '--value']).split()
        identity = (pwd.getpwnam(user).pw_uid, grp.getgrnam(group).gr_gid, [grp.getgrnam(n).gr_gid for n in groups])
        result = m.child(m.PROBE, base=m.API, env=m.appenv(), identity=identity,
                         packet={'pins': pins, 'credential': {'client_id': native['performance_client_id'], 'client_secret': native['performance_client_secret']},
                                 'identity': 'ozon:client:'+str(int(native['seller_client_id']))})
        check('real_performance_peer_after_native_restart', result == {'code': 'CONNECTED', 'identity_matches': True, 'native_provenance': True})
        after = m.snapshot()
        def api_launch(value): return '\n'.join(line.split(' ; ignore_errors=',1)[0] if line.startswith('ExecStart=') else line for line in value.splitlines())
        check('native_api_web_identity_admin_and_environment_preserved', before['protected'] == after['protected'] and api_launch(before['api_launch']) == api_launch(after['api_launch'])
              and before['pointers'] == after['pointers'] and before['env_hashes'] == after['env_hashes'])
        check('checker_sandbox_preserved', before['checker_profile'] == after['checker_profile'] and before['checker_inaccessible'] == after['checker_inaccessible'])
        check('all_four_services_ready', all(m.ready().values()))
        check('mandatory_free_reserve', shutil.disk_usage('/').free >= m.FLOOR)
        record.update(status='PASS', performance_live_ipc=result, refresh_unit_profile=unit, database_mutations=0, native_core_restarts_by_this_hook_install=0,
                      owner_browser_flow='NOT_RUN', free_bytes=shutil.disk_usage('/').free)
    except BaseException:
        for path,dev,ino in reversed(created):
            if path.exists() and (path.lstat().st_dev,path.lstat().st_ino) == (dev,ino): path.unlink()
        subprocess.run(['systemctl','daemon-reload'], capture_output=True, timeout=10)
        subprocess.run(['systemctl','restart',m.UNIT], capture_output=True, timeout=35)
        record['recovery'] = 'OWN_HOOK_FILES_REMOVED_PRIOR_CHECKER_RESTARTED_VALID_SAME_PAIR_PROOF_RETAINED'
        raise


if __name__ == '__main__':
    def interrupted(*_): raise InterruptedError()
    signal.signal(signal.SIGTERM, interrupted)
    m.secure(D)
    out = D/'refresh-install-r2.json'
    check('new_receipt', not out.exists())
    try: run()
    except BaseException as e: record['error_type'] = type(e).__name__
    finally:
        m.fresh(out, json.dumps(record, indent=2).encode()); print(json.dumps(record))
    sys.exit(0 if record['status'] == 'PASS' else 1)
