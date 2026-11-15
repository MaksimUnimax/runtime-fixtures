"""Real, disposable systemd credential lifecycle under the R3 mount sandbox.

Only this gate's producer, synthetic credential, socket, release directory and
projection are used. No installed app/helper/config/store is opened. The real
descriptor reader, kernel mount views, SO_PEERCRED and accepted HMAC execute.
Only the existing publication/checker side effects use fixture substitutes.
"""
from copy import deepcopy
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import patch
import argparse
import hashlib
import json
import os
import pwd
import re
import shutil
import socket
import stat
import struct
import subprocess
import sys
import tempfile
import time

SOURCE = Path(__file__).resolve().parents[1]
NAMES = ('activation_contract.py', 'activate.py', 'readiness.py', 'runtime_versions_sync.py')
BINDING_SHA = '30664db61e047927c9dafd2b16fd70d3d1ba662ee3ea59ce539d4e1e32045347'


def need(ok, code):
    if not ok: raise RuntimeError(code)


def command(*args, timeout=12):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout,
                            env={'PATH': '/usr/bin:/bin', 'LC_ALL': 'C.UTF-8'})
    need(result.returncode == 0 and len(result.stdout) <= 16384 and len(result.stderr) <= 16384,
         'FIXTURE_COMMAND_FAILED')
    return result.stdout


def property_value(unit, name):
    return command('/usr/bin/systemctl', 'show', unit, '--value', '--property='+name).decode().strip()


def peer(path):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
        stream.settimeout(.5)
        stream.connect(path)
        pid, uid, _ = struct.unpack('3i', stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        return pid, uid


def load_tools(root):
    folder = root/'tools'
    folder.mkdir(mode=0o755)
    blobs = {name: (SOURCE/name).read_bytes() for name in NAMES}
    for name, raw in blobs.items():
        (folder/name).write_bytes(raw)
        (folder/name).chmod(0o444)
    folder.chmod(0o555)
    module = ModuleType('r15_native_credential_gate_tool')
    module.__file__ = str(folder/'activate.py')
    module.__r15_verified_tool_bytes__ = blobs
    sys.modules[module.__name__] = module
    exec(compile(blobs['activate.py'], module.__file__, 'exec'), module.__dict__)
    pin = module.c.canonical_hash({name: module.c.digest(raw) for name, raw in blobs.items()})
    need(module.tool_hash() == pin and tuple(module.c.TOOL_FILES) == NAMES, 'TOOL_READBACK')
    raw = (SOURCE/'tests/fixtures/native_store_binding.py').read_bytes()
    need(module.c.digest(raw) == BINDING_SHA == module.c.HELPERS[str(module.c.CHECKER)], 'BINDING_PIN')
    binding = ModuleType('r15_gate_accepted_binding')
    with patch.dict(sys.modules, {'store_checker': SimpleNamespace(loads=module.c.strict_json)}):
        exec(compile(raw, 'accepted_native_store_binding.py', 'exec'), binding.__dict__)
    return module, binding, pin


def owner_data(binding, generation, socket_path, material):
    row = {'tenant_id': 'fixture-tenant', 'store_id': 'fixture-store', 'native_account': 'fixture-account',
           'native_store': 'fixture-native', 'credential_name': 'fixture.json',
           'identity': 'ozon:client:11', 'source_hmac': ''}
    config = {'execution_enabled': True, 'runtime_port': {'socket': str(socket_path)},
              'accounts': {'fixture-account': {'active': True,
                            'stores': [{'id': 'fixture-native', 'platform': 'ozon'}]}},
              'credential_bindings': {'fixture-native': 'fixture.json'},
              'qualifications': {operation: {'status': 'READ_ONLY_CANARY', 'evidence_ref': 'synthetic-only'}
                                 for operation in ('ozon_ads_token', 'ozon_ads_daily')}}
    data = {'schema_version': 'native_owner_store_binding_v1', 'environment': 'fixture',
            'product_id': 'alisa_market', 'mac_key': '11'*32, 'native_generation': generation,
            'bindings': [row]}
    context = binding.native_context(config, material, row, environment=data['environment'],
                                     product_id=data['product_id'], generation=generation)
    row['source_hmac'] = binding.mac(bytes.fromhex(data['mac_key']), 'native-owner-source-v1', context)
    return config, data


PRODUCER = '''import json,os,socket,sys
from pathlib import Path
assert os.getuid()==os.geteuid()==int(sys.argv[2])
fd=os.open(Path(os.environ['CREDENTIALS_DIRECTORY'])/'fixture.json',os.O_RDONLY|os.O_NOFOLLOW)
try:
 raw=os.read(fd,32769)
 assert len(raw)<=32768 and len(json.loads(raw))==4
finally: os.close(fd)
stream=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
stream.bind(sys.argv[1]);stream.listen(8)
while True:
 connection,_=stream.accept();connection.close()
'''


def gate(workspace, source_sha):
    need(os.getuid() == os.geteuid() == 0, 'ROOT_FIXTURE_REQUIRED')
    need(workspace.parent == Path('/run') and
         re.fullmatch('alisa-r15-native-credential-ci-[0-9]+-[0-9]+', workspace.name), 'WORKSPACE_SCOPE')
    info = workspace.lstat()
    need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o755,
         'WORKSPACE_METADATA')
    need(re.fullmatch('[0-9a-f]{40}', source_sha) is not None, 'SOURCE_SHA')
    observer = workspace.name+'.service'
    need(property_value(observer, 'MainPID') == str(os.getpid()), 'OBSERVER_PROCESS')
    for name, expected in {'NoNewPrivileges': 'yes', 'ProtectSystem': 'strict',
                           'ProtectHome': 'read-only', 'PrivateTmp': 'yes',
                           'MemorySwapMax': '0', 'KillMode': 'control-group'}.items():
        need(property_value(observer, name) == expected, 'OBSERVER_SANDBOX')
    version = command('/usr/bin/systemd', '--version').decode().splitlines()[0]
    need(version.startswith('systemd 255 ('), 'SYSTEMD_VERSION')
    producer = workspace.name+'-native.service'
    runtime = Path('/run')/producer.removesuffix('.service')
    need(property_value(producer, 'LoadState') == 'not-found' and not os.path.lexists(runtime),
         'PRODUCER_ALREADY_EXISTS')
    root = Path(tempfile.mkdtemp(prefix='owned-', dir=workspace))
    root.chmod(0o755)  # Public synthetic cwd; all material stays under private0700.
    root_identity = (root.stat().st_dev, root.stat().st_ino)
    private = root/'private'
    private.mkdir(mode=0o700)
    cwd = root/'release'
    cwd.mkdir(mode=0o555)
    wrong_cwd = root/'wrong-release'
    wrong_cwd.mkdir(mode=0o555)
    link = root/'current'
    link.symlink_to(cwd, target_is_directory=True)
    material = {'seller_client_id': '11', 'seller_api_key': 'synthetic-seller',
                'performance_client_id': 'synthetic-client', 'performance_client_secret': 'synthetic-secret'}
    credential = private/'credential.json'
    credential.write_text(json.dumps(material)+'\n')
    credential.chmod(0o600)
    config_path, projection_path = private/'config.json', private/'projection.json'
    native_uid = pwd.getpwnam('nobody').pw_uid
    native_gid = pwd.getpwnam('nobody').pw_gid
    socket_path = runtime/'native.sock'
    description = 'R15 owned synthetic native credential lifecycle '+workspace.name
    checks, retained, writes, checker_calls = [], [], [], []
    started, invocation, cleaned, removed = False, None, False, False
    a = binding = None
    def passed(name): checks.append(name)
    def blocked(operation, code):
        try: operation()
        except a.c.Blocked as error:
            need(error.code == code, 'WRONG_REJECTION')
        else: raise RuntimeError('MISSING_REJECTION')
    try:
        a, binding, pin = load_tools(root)
        properties = {
            'Type': 'exec', 'Description': description, 'User': 'nobody', 'Group': str(native_gid),
            'BindsTo': observer, 'After': observer,
            'RuntimeMaxSec': '90', 'TimeoutStartSec': '5', 'TimeoutStopSec': '5',
            'KillMode': 'control-group', 'SendSIGKILL': 'yes', 'OOMPolicy': 'stop',
            'MemoryAccounting': 'yes', 'MemoryMax': '67108864', 'MemorySwapMax': '0',
            'TasksMax': '8', 'LimitCORE': '0', 'CPUQuota': '25%', 'Nice': '10', 'UMask': '0077',
            'NoNewPrivileges': 'yes', 'ProtectSystem': 'strict', 'ProtectHome': 'read-only',
            'PrivateTmp': 'yes', 'PrivateNetwork': 'yes', 'RestrictAddressFamilies': 'AF_UNIX',
            'WorkingDirectory': str(cwd), 'RuntimeDirectory': runtime.name, 'RuntimeDirectoryMode': '0700',
            'ReadWritePaths': str(runtime), 'LoadCredential': 'fixture.json:'+str(credential),
            'StandardOutput': 'null', 'StandardError': 'null',
        }
        command('/usr/bin/systemd-run', '--quiet', '--collect', '--unit='+producer,
                *('--property='+key+'='+value for key, value in properties.items()),
                '/usr/bin/python3', '-I', '-B', '-c', PRODUCER, str(socket_path), str(native_uid))
        started = True
        invocation = property_value(producer, 'InvocationID')
        need(re.fullmatch('[0-9a-f]{32}', invocation) is not None, 'PRODUCER_INVOCATION')
        def current_generation():
            deadline = time.monotonic()+6
            while True:
                try:
                    pid = int(property_value(producer, 'MainPID'))
                    generation = binding.process_generation(pid)
                    if (property_value(producer, 'ActiveState') == 'active' and generation['uid'] == native_uid
                            and peer(socket_path) == (pid, native_uid)
                            and binding.process_generation(pid) == generation):
                        return generation
                except (OSError, ValueError, RuntimeError): pass
                need(time.monotonic() < deadline, 'PRODUCER_NOT_READY')
                time.sleep(.05)
        def restart():
            nonlocal invocation
            need(property_value(producer, 'InvocationID') == invocation
                 and property_value(producer, 'Description') == description, 'PRODUCER_IDENTITY_MOVED')
            command('/usr/bin/systemctl', 'restart', producer)
            invocation = property_value(producer, 'InvocationID')
            need(re.fullmatch('[0-9a-f]{32}', invocation) is not None, 'PRODUCER_INVOCATION')
            return current_generation()
        generation_a = current_generation()
        invocation = property_value(producer, 'InvocationID')
        need(re.fullmatch('[0-9a-f]{32}', invocation) is not None, 'PRODUCER_INVOCATION')
        try:
            fd = os.open(Path('/run/credentials')/producer/'fixture.json', os.O_RDONLY | os.O_NOFOLLOW)
        except FileNotFoundError: pass
        else:
            os.close(fd)
            raise RuntimeError('DIRECT_CREDENTIAL_PATH_VISIBLE')
        parent = Path('/run/credentials').stat()
        need(parent.st_uid == 0 and stat.S_IMODE(parent.st_mode) == 0, 'DIRECT_CREDENTIAL_PARENT_NOT_HIDDEN')
        passed('strict_observer_hides_global_credential_tree')
        config, data_a = owner_data(binding, generation_a, socket_path, material)
        pair = SimpleNamespace(native_module=lambda: binding, native_peer=peer,
            wait_native_generation=lambda module, uid: current_generation())
        checker = workspace.name+'-checker-fixture.service'
        original_run = a.run
        def scoped_run(*args, **kwargs):
            if args == ('systemctl', 'show', producer, '--property=MainPID,ActiveState,SubState'):
                return original_run(*args, **kwargs)
            if args == ('systemctl', 'restart', checker):
                checker_calls.append(True)  # Outside this credential-reader gate's boundary.
                return b''
            raise RuntimeError('INSTALLED_COMMAND_FORBIDDEN')
        with patch.dict(a.c.UNITS, {'native': producer}), patch.object(a.c, 'NATIVE_LINK', link), \
             patch.object(a.c, 'CONFIG', config_path), patch.object(a.c, 'PROJECTION', projection_path), \
             patch.object(a.c, 'CHECKER_UNIT', checker), patch.object(a, 'run', scoped_run):
            def view(generation, config_value=None, root_value=None):
                return a.NativeCredentialView(binding, pair, generation, root_value or cwd,
                                               config_value or config, ['fixture.json'])
            old_view = view(generation_a).__enter__()
            try:
                need(old_view.read('fixture.json') == material, 'CURRENT_MATERIAL_MISMATCH')
                need(all(not os.get_inheritable(fd) for fd in old_view.fds), 'INHERITABLE_DESCRIPTOR')
                old_ids = deepcopy(old_view.identities)
                old_root = os.dup(old_view.anchor['root'])
                retained.append(old_root)
                old_credential = os.dup(old_view.anchor['credentials'])
                retained.append(old_credential)
                retained.append(os.dup(old_view.anchor['namespace']))
                passed('actual_current_native_view_reads_only_authorized_readonly_material')
                blocked(lambda: old_view.read('unlisted.json'), 'NATIVE_CREDENTIAL_NAME')
                passed('unlisted_credential_name_refused')
                alive_wrong = binding.process_generation(os.getpid())
                blocked(lambda: view(alive_wrong).__enter__(), 'NATIVE_GENERATION_MOVED')
                passed('different_still_alive_pid_refused_before_credential_open')
                blocked(lambda: view({**generation_a, 'start_ticks': generation_a['start_ticks']+1}).__enter__(),
                        'NATIVE_GENERATION_MOVED')
                passed('wrong_start_generation_refused')
                wrong_socket = root/'wrong.sock'
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as other:
                    other.bind(str(wrong_socket)); other.listen(1)
                    blocked(lambda: view(generation_a, {**config, 'runtime_port': {'socket': str(wrong_socket)}}).__enter__(),
                            'NATIVE_SOCKET_GENERATION_MOVED')
                passed('real_wrong_socket_peer_refused')
                link.unlink(); link.symlink_to(wrong_cwd, target_is_directory=True)
                try:
                    blocked(lambda: view(generation_a, root_value=wrong_cwd).__enter__(), 'NATIVE_PROCESS_SOURCE_MOVED')
                finally:
                    link.unlink(); link.symlink_to(cwd, target_is_directory=True)
                passed('wrong_actual_process_cwd_refused')
                generation_b = restart()
                need(generation_b != generation_a, 'RESTART_DID_NOT_CHANGE_GENERATION')
                blocked(old_view.check, 'NATIVE_GENERATION_MOVED')
                passed('held_scope_rejects_restart_during_read')
                held_fds = list(old_view.fds)
            finally: old_view.close()
            for fd in held_fds:
                try: os.fstat(fd)
                except OSError: pass
                else: raise RuntimeError('DESCRIPTOR_LEAK')
            passed('all_scope_descriptors_closed_after_generation_failure')
            # The retained old material remains readable. Successful rejection
            # must therefore come from current-view coupling, not path absence.
            fd = os.open('fixture.json', os.O_RDONLY | os.O_NOFOLLOW, dir_fd=old_credential)
            try: need(a.c.strict_json(os.read(fd, 32769)) == material, 'OLD_FD_NOT_RETAINED')
            finally: os.close(fd)
            with view(generation_b) as fresh:
                need(fresh.read('fixture.json') == material, 'SAME_MATERIAL_RESTART_FAILED')
                need(old_ids['root'][:2] == fresh.identities['root'][:2], 'ROOT_INODE_NOT_SHARED')
                need(old_ids['namespace'] != fresh.identities['namespace']
                     and old_ids['credentials'] != fresh.identities['credentials'], 'MOUNT_VIEW_NOT_RECREATED')
                saved_anchor, saved_ids = dict(fresh.anchor), dict(fresh.identities)
                try:
                    # Fault injection supplies stale descriptors with their own
                    # matching cached identity under a genuinely NEW generation.
                    fresh.anchor['root'], fresh.anchor['credentials'] = old_root, old_credential
                    fresh.identities['root'] = a._native_fd_identity(old_root)
                    fresh.identities['credentials'] = a._native_fd_identity(old_credential)
                    blocked(fresh.check, 'NATIVE_CREDENTIAL_VIEW_MOVED')
                finally:
                    fresh.anchor, fresh.identities = saved_anchor, saved_ids
            passed('fresh_same_material_restart_passes_with_equal_root_inode')
            passed('stale_root_and_credential_fds_refused_under_current_generation')
            need(not writes and not projection_path.exists(), 'STALE_PROJECTION_PUBLISHED')
            config_path.write_bytes(a.c.encoded(config)); config_path.chmod(0o600)
            projection_path.write_bytes(a.c.encoded(data_a)); projection_path.chmod(0o600)
            host = object.__new__(a.LiveHost)
            host.baseline = {'bases': {'native': {'root': str(cwd)}}}
            host.targets = {'native': cwd}
            host.helper_guard = lambda: need(a.tool_hash() == pin, 'TOOL_CHANGED')
            host.helpers = lambda: pair
            host.old_projection = deepcopy(data_a)
            host.intent = {'ours': {'config': a.path_state(config_path), 'projection': a.path_state(projection_path)}}
            def publish(name, **kwargs):
                need(name == 'projection' and set(kwargs) == {'raw'}, 'FIXTURE_WRITE_SCOPE')
                writes.append(True)
                projection_path.write_bytes(kwargs['raw'])
                host.intent['ours']['projection'] = a.path_state(projection_path)
            host.change = publish
            before_raw = projection_path.read_bytes()
            original_read = a.NativeCredentialView.read
            def stale_read(self, name):
                saved_anchor, saved_ids = dict(self.anchor), dict(self.identities)
                try:
                    self.anchor['root'], self.anchor['credentials'] = old_root, old_credential
                    self.identities['root'] = a._native_fd_identity(old_root)
                    self.identities['credentials'] = a._native_fd_identity(old_credential)
                    return original_read(self, name)
                finally:
                    self.anchor, self.identities = saved_anchor, saved_ids
            with patch.object(a.NativeCredentialView, 'read', stale_read):
                blocked(host.refresh, 'NATIVE_CREDENTIAL_VIEW_MOVED')
            need(not writes and not checker_calls and projection_path.read_bytes() == before_raw,
                 'STALE_PROJECTION_PUBLISHED')
            passed('refresh_rejects_stale_current_generation_anchor_before_publication')
            host.refresh()
            data_b = a.c.strict_json(projection_path.read_bytes())
            need(data_b['native_generation'] == generation_b and len(writes) == len(checker_calls) == 1,
                 'SAME_MATERIAL_REPROJECTION_FAILED')
            passed('new_material_confirms_old_full_hmac_before_new_generation_publication')
            # One final fence fails immediately before publication. The real
            # process remains valid; this models a concurrent generation change.
            projection_path.write_bytes(a.c.encoded(data_a))
            host.intent['ours']['projection'] = a.path_state(projection_path)
            before_raw = projection_path.read_bytes()
            original_check = a.NativeCredentialView.check
            def before_write(self):
                original_check(self)
                # refresh explicitly calls check after its credential read.
                if sys._getframe(1).f_code.co_name == 'refresh':
                    raise a.c.Blocked('NATIVE_GENERATION_MOVED')
            with patch.object(a.NativeCredentialView, 'check', before_write):
                blocked(host.refresh, 'NATIVE_GENERATION_MOVED')
            need(len(writes) == 1 and projection_path.read_bytes() == before_raw, 'STALE_PROJECTION_PUBLISHED')
            passed('generation_fence_before_publication_preserves_projection')
            projection_path.write_bytes(a.c.encoded(data_b))
            host.old_projection = deepcopy(data_b)
            host.intent['ours']['projection'] = a.path_state(projection_path)
            changed = {**material, 'performance_client_secret': 'changed-synthetic-secret'}
            credential.write_text(json.dumps(changed)+'\n')
            generation_c = restart()
            need(generation_c not in (generation_a, generation_b), 'SECOND_GENERATION_NOT_NEW')
            with view(generation_c) as current:
                need(current.read('fixture.json') == changed, 'NEW_MATERIAL_NOT_OBSERVED')
            before_raw = projection_path.read_bytes()
            blocked(host.refresh, 'OWNER_PAIR_CHANGED_DURING_RESTART')
            need(len(writes) == len(checker_calls) == 1 and projection_path.read_bytes() == before_raw,
                 'CHANGED_OWNER_REPROJECTION_PUBLISHED')
            passed('changed_material_refuses_old_owner_hmac_without_publication')
        need(a.tool_hash() == pin, 'TOOL_CHANGED')
        result = {'schema': 'alisa-r15-native-credential-gate/v1', 'status': 'PASS', 'source_sha': source_sha,
                  'tool_sha256': pin, 'gate_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  'accepted_binding_sha256': BINDING_SHA, 'systemd_version': version,
                  'actual_private_namespace': True, 'actual_load_credential': True, 'native_uid': native_uid,
                  'actual_native_restarts': 2, 'root_inode_equal_across_restart': True,
                  'retained_old_material_still_readable': True, 'checks': checks, 'checks_passed': len(checks),
                  'projection_publication_fixture_only': True, 'checker_restart_fixture_stub': True,
                  'production_access': False, 'producer_unit': producer}
    finally:
        for fd in reversed(retained): os.close(fd)
        if started:
            load = property_value(producer, 'LoadState')
            if load == 'not-found':
                cleaned = not os.path.lexists(runtime)
            else:
                need(property_value(producer, 'Description') == description
                     and property_value(producer, 'Transient') == 'yes'
                     and property_value(producer, 'FragmentPath') == '/run/systemd/transient/'+producer
                     and property_value(producer, 'InvocationID') == invocation, 'PRODUCER_CLEANUP_IDENTITY')
                command('/usr/bin/systemctl', 'stop', producer)
                cleaned = (property_value(producer, 'LoadState') == 'not-found'
                           or property_value(producer, 'ActiveState') == 'inactive') and not os.path.lexists(runtime)
        else:
            cleaned = not os.path.lexists(runtime)
        need((root.stat().st_dev, root.stat().st_ino) == root_identity, 'FIXTURE_DIRECTORY_REPLACED')
        shutil.rmtree(root)
        removed = not os.path.lexists(root)
    need(cleaned and removed, 'OWN_FIXTURE_CLEANUP_FAILED')
    result.update({'producer_stopped': cleaned, 'producer_runtime_removed': not os.path.lexists(runtime),
                   'fixture_removed': removed, 'retained_descriptors_closed': True})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--source-sha', required=True)
    args = parser.parse_args()
    try:
        result = gate(args.workspace, args.source_sha)
    except BaseException as error:
        frames, trace = [], error.__traceback__
        while trace is not None:
            frames.append({'file': Path(trace.tb_frame.f_code.co_filename).name,
                           'function': trace.tb_frame.f_code.co_name, 'line': trace.tb_lineno})
            trace = trace.tb_next
        print(json.dumps({'status': 'BLOCKED', 'code': 'NATIVE_CREDENTIAL_FIXTURE_FAILED',
                          'exception_type': type(error).__name__, 'frames': frames,
                          'source_sha': args.source_sha, 'production_access': False}, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
