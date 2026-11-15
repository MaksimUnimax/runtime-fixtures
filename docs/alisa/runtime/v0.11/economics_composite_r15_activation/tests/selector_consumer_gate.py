"""Six actual systemd/Gunicorn selector checks using only this CI fixture.

One owned unit starts the old synthetic WSGI release and restarts once after the
real selector writer produces its later drop-in. The real unit predictor and
process flag checker run unchanged; fixed service/env paths are mapped solely
to owned fixture paths. No installed application/config/helper is read.
"""
from pathlib import Path
from types import ModuleType
from unittest.mock import patch
import argparse
import hashlib
import importlib.metadata
import json
import os
import pwd
import re
import shutil
import socket
import stat
import sys
import tempfile
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import native_credential_gate as fixture

need, command, prop = fixture.need, fixture.command, fixture.property_value
NAMES = ('activation_contract.py', 'activate.py', 'readiness.py', 'runtime_versions_sync.py')


def identity(path):
    info = path.lstat()
    return info.st_dev, info.st_ino, info.st_uid, stat.S_IMODE(info.st_mode)


def make_dir(path, mode):
    path.mkdir(mode=mode)
    path.chmod(mode)
    need(path.stat().st_uid == 0 and stat.S_IMODE(path.stat().st_mode) == mode,
         'SELECTOR_FIXTURE_DIRECTORY')


def new_file(path, raw, owned):
    with path.open('xb') as output:
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    path.chmod(0o444)
    owned[path] = (identity(path), hashlib.sha256(raw).hexdigest())


def exact_files(owned):
    return all(identity(path) == info and hashlib.sha256(path.read_bytes()).hexdigest() == digest
               for path, (info, digest) in owned.items())


def load_tools(root):
    folder = root/'tools'
    make_dir(folder, 0o755)
    blobs = {name: (HERE.parent/name).read_bytes() for name in NAMES}
    for name, raw in blobs.items():
        new_file(folder/name, raw, {})
    folder.chmod(0o555)
    module = ModuleType('r15_selector_consumer_tool')
    module.__file__ = str(folder/'activate.py')
    module.__r15_verified_tool_bytes__ = blobs
    sys.modules[module.__name__] = module
    exec(compile(blobs['activate.py'], module.__file__, 'exec'), module.__dict__)
    pin = module.c.canonical_hash({name: module.c.digest(raw) for name, raw in blobs.items()})
    need(module.tool_hash() == pin and tuple(module.c.TOOL_FILES) == NAMES, 'SELECTOR_TOOL_READBACK')
    return module, pin


def response(path):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as stream:
        stream.settimeout(.5)
        stream.connect(os.fspath(path))
        stream.sendall(b'GET /health/ready HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n')
        raw = b''
        while True:
            block = stream.recv(min(4096, 8193-len(raw)))
            if not block:
                break
            raw += block
            need(len(raw) <= 8192, 'SELECTOR_RESPONSE_BOUND')
    head, separator, body = raw.partition(b'\r\n\r\n')
    need(separator and head.split(b'\r\n', 1)[0] in (b'HTTP/1.0 200 OK', b'HTTP/1.1 200 OK'),
         'SELECTOR_RESPONSE_STATUS')
    return json.loads(body)


def wait_response(path):
    deadline = time.monotonic()+10
    while True:
        try:
            return response(path)
        except (OSError, ValueError):
            need(time.monotonic() < deadline, 'SELECTOR_READINESS_TIMEOUT')
            time.sleep(.1)


def gate(workspace, source_sha):
    need(os.geteuid() == 0 and re.fullmatch('[0-9a-f]{40}', source_sha), 'SELECTOR_FIXTURE_PRINCIPAL')
    need(workspace.parent == Path('/run') and re.fullmatch(r'alisa-r15-selector-ci-[0-9]+-[0-9]+', workspace.name),
         'SELECTOR_FIXTURE_SCOPE')
    need(identity(workspace)[2:] == (0, 0o755) and stat.S_ISDIR(workspace.lstat().st_mode)
         and not workspace.is_symlink(), 'SELECTOR_FIXTURE_WORKSPACE')
    need(importlib.metadata.version('gunicorn') == '26.2.0', 'SELECTOR_GUNICORN_PIN')
    venv = Path(sys.prefix).resolve(strict=True)
    account = pwd.getpwuid((venv/'pyvenv.cfg').stat().st_uid)
    need(account.pw_uid != 0 and account.pw_gid != 0, 'SELECTOR_FIXTURE_SERVICE_PRINCIPAL')
    unit = workspace.name+'-authority.service'
    runtime = Path('/run')/unit[:-len('.service')]
    fragment = Path('/run/systemd/system')/unit
    dropins = fragment.with_name(unit+'.d')
    need(prop(unit, 'LoadState') == 'not-found' and not any(os.path.lexists(p)
         for p in (fragment, dropins, runtime)), 'SELECTOR_FIXTURE_OCCUPIED')
    need(shutil.rmtree.avoids_symlink_attacks, 'SELECTOR_FIXTURE_CLEANUP_SUPPORT')
    root = Path(tempfile.mkdtemp(prefix='owned-', dir=workspace))
    root.chmod(0o755)
    root_identity = identity(root)
    owned, dirs = {}, {}
    installed = False
    cleanup = {'service_stopped': False, 'cgroup_empty': False, 'unit_files_removed': False,
               'unit_not_found': False, 'runtime_removed': False, 'payload_removed': False}
    try:
        a, pin = load_tools(root)
        c = a.c
        old, target = root/'old-selector-release', root/'new-selector-release'
        sock = runtime/'authority.sock'
        base_env, query, catalog, flags = (root/name for name in ('base.env', 'query.env', 'catalog.env', 'flags.env'))
        envfiles = (str(query), str(catalog))
        for path, marker in ((base_env, 'base'), (query, 'query'), (catalog, 'catalog')):
            new_file(path, ('SELECTOR_ORDER='+marker+'\nALISA_RELEASE=conflicting-file-release\n'+
                ''.join(flag+'=0\n' for flag in c.FLAGS)).encode(), {})
        new_file(flags, c.FLAG_BYTES, {})
        for release in (old, target):
            make_dir(release, 0o755)
            make_dir(release/'services', 0o755)
            make_dir(release/'services/platform', 0o755)
            (release/'.venv').symlink_to(venv)
            code = ('import json,os\nMARKER='+repr(release.name)+'\nFLAGS='+repr(c.FLAGS)+'\n'
                    'def application(environ,start_response):\n'
                    ' value={"release":os.environ.get("ALISA_RELEASE"),"module":MARKER,"cwd":os.getcwd(),'
                    '"order":os.environ.get("SELECTOR_ORDER"),"flags":{k:os.environ.get(k) for k in FLAGS}}\n'
                    ' body=json.dumps(value,sort_keys=True).encode()\n'
                    ' start_response("200 OK",[("Content-Type","application/json"),("Content-Length",str(len(body)))])\n'
                    ' return [body]\n')
            new_file(release/'services/platform/synthetic_wsgi.py', code.encode(), {})
            for directory in (release/'services/platform', release/'services', release):
                directory.chmod(0o555)
        # The two release paths and existing --env token mirror the observed
        # authority structure. Other arguments are synthetic and never copied
        # from production. The existing locked Gunicorn consumes them itself.
        argv = (str(old)+'/.venv/bin/python -B -m gunicorn synthetic_wsgi:application --pythonpath '+
                str(old)+'/services/platform --env KEEP=unchanged --env ALISA_RELEASE='+old.name+
                ' --bind unix:'+str(sock)+' --workers 1 --threads 1 --timeout 10'
                ' --access-logfile /dev/null --error-logfile /dev/null')
        original = ('# Synthetic selector consumer only\n[Service]\nWorkingDirectory='+str(old)+
            '/services/platform\nEnvironment=ALISA_RELEASE='+old.name+'\nExecStart=\nExecStart='+argv+
            '\n\nEnvironmentFile='+str(query)+'\n\nEnvironmentFile='+str(catalog)+'\n').encode()
        make_dir(dropins, 0o755)
        dirs[dropins] = identity(dropins)
        before_file, after_file = dropins/'10-original.conf', dropins/'90-candidate.conf'
        description = 'R15 selector fixture '+root.name
        fragment_raw = ('[Unit]\nDescription='+description+'\nBindsTo='+workspace.name+'.service\n'
            'After='+workspace.name+'.service\n[Service]\nType=exec\nUser='+str(account.pw_uid)+
            '\nGroup='+str(account.pw_gid)+'\nExecStart=/usr/bin/false\nEnvironmentFile='+str(base_env)+
            '\nRuntimeDirectory='+runtime.name+'\nRuntimeDirectoryMode=0700\n'
            'RuntimeMaxSec=60\nTimeoutStartSec=5\nTimeoutStopSec=5\nKillMode=control-group\n'
            'SendSIGKILL=yes\nOOMPolicy=stop\nMemoryAccounting=yes\nMemoryMax=134217728\n'
            'MemorySwapMax=0\nTasksMax=16\nCPUQuota=25%\nLimitCORE=0\nUMask=0077\n'
            'PrivateTmp=yes\nPrivateNetwork=yes\nProtectSystem=strict\nProtectHome=read-only\n'
            'NoNewPrivileges=yes\nRestrictAddressFamilies=AF_UNIX\n'
            'StandardOutput=null\nStandardError=null\n').encode()
        new_file(fragment, fragment_raw, owned)
        new_file(before_file, original, owned)
        installed = True

        def own_unit():
            need(exact_files(owned) and all(identity(path) == value for path, value in dirs.items())
                 and prop(unit, 'FragmentPath') == str(fragment) and prop(unit, 'Description') == description,
                 'SELECTOR_FIXTURE_UNIT_MOVED')

        with patch.object(c, 'UNITS', {**c.UNITS, 'authority': unit}), \
             patch.object(c, 'SELECTORS', {**c.SELECTORS, 'authority': after_file}), \
             patch.object(c, 'SELECTOR_ENV_FILES', {**c.SELECTOR_ENV_FILES, 'authority': envfiles}), \
             patch.object(c, 'FLAG_FILE', flags):
            command('/usr/bin/systemctl', 'daemon-reload')
            own_unit()
            before = a.unit_static(unit)
            target_commands = a.unit_static(unit, rewrite=(str(old), str(target)))['command']
            desired = c.selector_bytes(original, str(old), str(target), role='authority')
            command('/usr/bin/systemctl', 'start', unit)
            old_reply = wait_response(sock)
            old_pid, old_invocation = prop(unit, 'MainPID'), prop(unit, 'InvocationID')
            need(old_reply == {'release': old.name, 'module': old.name,
                 'cwd': str(old/'services/platform'), 'order': 'catalog',
                 'flags': {flag: '0' for flag in c.FLAGS}}, 'SELECTOR_BASELINE_RESPONSE')
            checks = ['baseline_actual_release_module_cwd']
            need(old_pid.isdecimal() and int(old_pid) > 0 and re.fullmatch('[0-9a-f]{32}', old_invocation),
                 'SELECTOR_BASELINE_GENERATION')
            own_unit()
            new_file(after_file, desired, owned)
            command('/usr/bin/systemctl', 'daemon-reload')
            own_unit()
            host = object.__new__(a.LiveHost)
            host.baseline = {'bases': {'authority': {'root': str(old)}}}
            host.targets = {'authority': target}
            host.desired = {'authority_selector': desired}
            planned = {'before': {'units': {'authority': before}},
                       'target_commands': {'authority': target_commands}}
            expected = host.expected_unit('authority', planned)
            need(a.unit_static(unit) == expected, 'SELECTOR_EFFECTIVE_UNIT_MISMATCH')
            release_environment = [item for item in prop(unit, 'Environment').split()
                                   if item.startswith('ALISA_RELEASE=')]
            need(release_environment == ['ALISA_RELEASE='+target.name], 'SELECTOR_ENVIRONMENT_RELEASE')
            checks.append('actual_effective_unit_matches_runtime_predictor')
            paths = a._environment_paths(expected['EnvironmentFiles'])
            need(paths == [str(base_env), *envfiles, *envfiles, str(flags)],
                 'SELECTOR_ENVFILE_ORDER')
            checks.append('actual_envfiles_preserve_order_and_duplicates')
            command('/usr/bin/systemctl', 'restart', unit)
            new_reply = wait_response(sock)
            need(new_reply.get('order') == 'catalog'
                 and new_reply.get('flags') == {flag: '1' for flag in c.FLAGS}, 'SELECTOR_ENVFILE_PRECEDENCE')
            checks.append('catalog_then_final_flags_override_conflicts')
            need(new_reply.get('release') == target.name and new_reply.get('module') == target.name
                 and new_reply.get('cwd') == str(target/'services/platform'), 'SELECTOR_GUNICORN_RELEASE')
            checks.append('real_gunicorn_env_override_and_new_module_cwd')
            new_pid, new_invocation = prop(unit, 'MainPID'), prop(unit, 'InvocationID')
            need(new_pid.isdecimal() and int(new_pid) > 0 and new_pid != old_pid
                 and re.fullmatch('[0-9a-f]{32}', new_invocation) and new_invocation != old_invocation,
                 'SELECTOR_NEW_GENERATION')
            host.process_flags(new_pid)
            host.validate_start('authority', planned)
            checks.append('new_pid_invocation_and_actual_process_flags')
            own_unit()
            need(a.tool_hash() == pin and len(checks) == 6, 'SELECTOR_FINAL_SOURCE')
        result = {'schema': 'alisa-r15-selector-consumer-ci/v1', 'status': 'PASS', 'source_sha': source_sha,
                  'tool_pin': pin, 'checks': checks, 'checks_passed': len(checks), 'gunicorn': '26.2.0',
                  'systemd_version': command('/usr/bin/systemd', '--version').decode().splitlines()[0],
                  'service_uid': account.pw_uid, 'production_access': False,
                  'fixture_scope_substitutions': ['unit name', 'selector paths', 'environment-file paths'],
                  'source_files': {str(path.relative_to(HERE.parent)): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in (Path(__file__), HERE/'native_credential_gate.py')}, 'cleanup': cleanup}
    finally:
        # The finite producer is also BindsTo the finite observer. Any source
        # collision stops cleanup rather than adopting another unit or file.
        if installed:
            need(exact_files(owned) and all(identity(path) == value for path, value in dirs.items()),
                 'SELECTOR_CLEANUP_SOURCE_MOVED')
            need(prop(unit, 'FragmentPath') == str(fragment) and prop(unit, 'Description') == description,
                 'SELECTOR_CLEANUP_UNIT_MOVED')
            group = prop(unit, 'ControlGroup')
            need(group in ('', '/system.slice/'+unit), 'SELECTOR_CLEANUP_CGROUP_SCOPE')
            command('/usr/bin/systemctl', 'stop', unit)
            need(prop(unit, 'ActiveState') == 'inactive' and prop(unit, 'MainPID') == '0',
                 'SELECTOR_CLEANUP_NOT_STOPPED')
            cleanup['service_stopped'] = True
            group_path = Path('/sys/fs/cgroup/system.slice')/unit
            if os.path.lexists(group_path):
                need(group_path.is_dir() and not group_path.is_symlink(), 'SELECTOR_CLEANUP_CGROUP_SCOPE')
                try:
                    processes = (group_path/'cgroup.procs').read_text().strip()
                    events = dict(line.split() for line in (group_path/'cgroup.events').read_text().splitlines())
                except FileNotFoundError:
                    need(not os.path.lexists(group_path), 'SELECTOR_CLEANUP_CGROUP_CHANGED')
                else:
                    need(not processes and events.get('populated') == '0', 'SELECTOR_CLEANUP_CGROUP_BUSY')
            cleanup['cgroup_empty'] = True
            need(not os.path.lexists(runtime), 'SELECTOR_CLEANUP_RUNTIME_EXISTS')
            cleanup['runtime_removed'] = True
        need(exact_files(owned) and all(identity(path) == value for path, value in dirs.items()),
             'SELECTOR_CLEANUP_FILES_MOVED')
        for path in reversed(tuple(owned)):
            path.unlink()
        for path in reversed(tuple(dirs)):
            path.rmdir()
        cleanup['unit_files_removed'] = not any(os.path.lexists(path) for path in (fragment, dropins))
        if installed:
            command('/usr/bin/systemctl', 'daemon-reload')
        cleanup['unit_not_found'] = prop(unit, 'LoadState') == 'not-found'
        need(identity(root) == root_identity, 'SELECTOR_CLEANUP_ROOT_MOVED')
        shutil.rmtree(root)
        cleanup['payload_removed'] = not os.path.lexists(root)
    need(all(cleanup.values()), 'SELECTOR_CLEANUP_INCOMPLETE')
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
        result = {'status': 'BLOCKED', 'code': 'SELECTOR_CONSUMER_FIXTURE_FAILED',
                  'exception_type': type(error).__name__, 'frames': frames,
                  'source_sha': args.source_sha, 'production_access': False}
        fixed_code = getattr(error, 'code', None)
        if type(error) is RuntimeError and error.args and re.fullmatch(r'SELECTOR_[A-Z_]+', str(error.args[0])):
            fixed_code = error.args[0]
        if type(fixed_code) is str and re.fullmatch('[A-Z][A-Z0-9_]{0,80}', fixed_code):
            result['fixed_code'] = fixed_code
        current = error
        while current is not None:
            if isinstance(current, fixture.FixtureCommandFailure):
                result['command_failure'] = current.public
                break
            current = current.__context__
        print(json.dumps(result, sort_keys=True))
        return 2
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
