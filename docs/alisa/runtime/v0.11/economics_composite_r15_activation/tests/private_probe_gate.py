"""Disposable root-to-nobody source gate inside its own systemd RuntimeDirectory.

No installed inputs, services, database, provider or credentials are accessed.
Every product-like module is a synthetic fixture and executes only as nobody.
The finite CI unit owns and removes the entire workspace, including on timeout.
"""
from pathlib import Path
from types import ModuleType
from unittest.mock import patch
import argparse
import hashlib
import json
import os
import pwd
import re
import stat
import subprocess
import sys
import tempfile

SOURCE = Path(__file__).resolve().parents[1]
NAMES = ('activation_contract.py', 'activate.py', 'readiness.py', 'runtime_versions_sync.py',
         'program_pair.py')
CANONICAL_SHA = '10421a4ec0000a5e26ecc92e5fbeed0a31f48133698a84b92935b04700615dd4'


def need(ok, code):
    if not ok: raise RuntimeError(code)


def load_tools(root):
    tool_root = root/'tools'
    tool_root.mkdir(mode=0o755)
    blobs = {name: (SOURCE/name).read_bytes() for name in NAMES}
    need(hashlib.sha256(blobs['runtime_versions_sync.py']).hexdigest() == CANONICAL_SHA, 'CANONICAL_PIN')
    for name, raw in blobs.items():
        (tool_root/name).write_bytes(raw)
        (tool_root/name).chmod(0o444)
    tool_root.chmod(0o555)
    module = ModuleType('r15_ci_probe_tool')
    module.__file__ = str(tool_root/'activate.py')
    module.__r15_verified_tool_bytes__ = blobs
    sys.modules[module.__name__] = module
    exec(compile(blobs['activate.py'], module.__file__, 'exec'), module.__dict__)
    pin = module.c.canonical_hash({name: module.c.digest(raw) for name, raw in blobs.items()})
    need(module.tool_hash() == pin and tuple(module.c.TOOL_FILES) == NAMES, 'TOOL_READBACK')
    sync = module.load_module('r15_ci_canonical_sync', tool_root/'runtime_versions_sync.py', CANONICAL_SHA)
    # Use the real unchanged frozen manifest verifier, never a mirror of its
    # implementation. These two source modules import only their stdlib closure.
    builder_root = root/'builder'
    builder_root.mkdir(mode=0o755)
    for name in ('release_contract.py', 'build_candidate.py'):
        # This gate exercises the historical activator's REAL pinned verifier,
        # not the newer S16 source-closure contract. Preserve exact historical
        # bytes instead of changing BUILD_TOOLS or bypassing its hash check.
        origin = (Path(__file__).parent/'fixtures/accepted_97_release_contract.py'
                  if name == 'release_contract.py'
                  else SOURCE.with_name('economics_composite_r15_release')/name)
        raw = origin.read_bytes()
        need(module.c.digest(raw) == module.c.BUILD_TOOLS[name], 'FROZEN_BUILDER_PIN')
        (builder_root/name).write_bytes(raw)
        (builder_root/name).chmod(0o444)
    builder_root.chmod(0o555)
    module.load_module('release_contract', builder_root/'release_contract.py',
                       module.c.BUILD_TOOLS['release_contract.py'])
    builder = module.load_module('r15_ci_frozen_builder', builder_root/'build_candidate.py',
                                 module.c.BUILD_TOOLS['build_candidate.py'])
    return module, sync, builder, pin


def payload_source(forbidden_fd, nobody_uid):
    return ('''import hashlib,json,os
from pathlib import Path
from dependency import VALUE
ROOT=Path(__file__).parent
def current_versions():
    assert os.getuid()==os.geteuid()==NOBODY_UID
    assert 'R15_PRIVATE_PROBE_CANARY' not in os.environ
    try: os.fstat(FORBIDDEN_FD)
    except OSError: pass
    else: raise RuntimeError('UNRELATED_FD_INHERITED')
    fd=int(ROOT.name)
    held=[]
    for item in os.listdir('/proc/self/fd'):
        if item.isdecimal() and int(item)>2:
            try: os.fstat(int(item));held.append(int(item))
            except OSError: pass
    assert held==[fd]
    assert os.stat('.').st_ino==os.fstat(fd).st_ino
    assert sorted(p.name for p in ROOT.glob('*.py'))==['dependency.py','runtime_port.py']
    assert json.loads((ROOT/'adjacent.json').read_text())=={'value':7}
    assert VALUE=='sibling-data'
    return {'runtime_contract_version':'fixture-v1','task_schema_version':'fixture-schema',
            'task_schema_sha256':hashlib.sha256(Path(__file__).with_name('schema.json').read_bytes()).hexdigest(),
            'registry_hash':hashlib.sha256(VALUE.encode()).hexdigest(),
            'catalog_bundle_hash':hashlib.sha256((ROOT/'adjacent.json').read_bytes()).hexdigest(),
            'query_language':'fixture-query','projection':'fixture-projection',
            'port_build':'uid:'+str(os.geteuid())+';fd:'+str(fd)}
''').replace('FORBIDDEN_FD', str(forbidden_fd)).replace('NOBODY_UID', str(nobody_uid)).encode()


def fixture(a, builder, root, name, code):
    private = root/name
    private.mkdir(mode=0o700)
    native = private/'native'
    native.mkdir(mode=0o755)
    files = {'runtime_port.py': code,
             'dependency.py': b'from pathlib import Path\nVALUE=Path(__file__).with_name("sibling.txt").read_text().strip()\n',
             'adjacent.json': b'{"value":7}\n', 'sibling.txt': b'sibling-data\n', 'schema.json': b'{"fixture":true}\n'}
    for leaf, raw in files.items():
        (native/leaf).write_bytes(raw)
        (native/leaf).chmod(0o444)
    manifest = {'schema': 'alice-read-surface-release/v1', 'artifact_id': native.name,
                'source_commit': '1'*40, 'files': {n: a.c.digest(raw) for n, raw in files.items()},
                'links': {}, 'external_links': {}}
    manifest_raw = a.c.encoded(manifest)
    (native/'manifest.json').write_bytes(manifest_raw)
    (native/'manifest.json').chmod(0o444)
    native.chmod(0o555)
    pin = a.c.digest(manifest_raw)
    prepared = {'candidates': {'native': {'manifest_sha256': pin}}}
    def verify():
        a.no_native_cache(native)
        a.verify_target(builder, native, pin, 'native', prepared)
    return native, verify


def cases(a, sync, builder, root):
    results = []
    account = pwd.getpwnam('nobody')
    need(account.pw_uid != 0 and account.pw_gid != 0, 'NOBODY_IDENTITY')
    trap = root/'must-not-inherit'
    trap.write_bytes(b'owned-fixture-only\n')
    forbidden_fd = os.open(trap, os.O_RDONLY | os.O_NOFOLLOW)
    os.set_inheritable(forbidden_fd, True)
    try:
        source = payload_source(forbidden_fd, account.pw_uid)
        native, verify = fixture(a, builder, root, 'success', source)
        # Reproduce the original defect with a real inaccessible 0700 ancestor.
        direct_code = ('import errno,os,sys;from pathlib import Path\n'
                       'assert os.getuid()==os.geteuid()=='+str(account.pw_uid)+'\n'
                       'try:Path('+repr(str(native/'runtime_port.py'))+').read_bytes()\n'
                       'except PermissionError as error:\n'
                       ' if error.errno==errno.EACCES:raise SystemExit(73)\n'
                       ' raise\n')
        direct = subprocess.run(['/usr/bin/python3', '-I', '-B', '-c', direct_code],
            cwd='/', env={'PATH': '/usr/bin:/bin'}, user=account.pw_uid, group=account.pw_gid,
            extra_groups=[], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=8, preexec_fn=sync.limits, close_fds=True)
        need(direct.returncode == 73, 'PRIVATE_ABSOLUTE_PATH_NOT_PROVEN_DENIED')
        results.append('direct_private_path_refused')
        original_run = a.subprocess.run
        observed = []
        def observe(*args, **kwargs):
            observed.append(kwargs['pass_fds'][0])
            return original_run(*args, **kwargs)
        with patch.dict(os.environ, {'R15_PRIVATE_PROBE_CANARY': 'fixture-only'}), \
             patch.object(a.subprocess, 'run', side_effect=observe):
            value = a.compute_versions_from_fd(native, sync, verify)
        sync.version_shape({**value, 'catalog_release_id': 'fixture'})
        need(value['port_build'].startswith('uid:'+str(account.pw_uid)+';fd:'), 'WRONG_CHILD_IDENTITY')
        need(stat.S_IMODE(native.parent.stat().st_mode) == 0o700, 'PRIVATE_ANCESTOR_CHANGED')
        for fd in observed:
            try: os.fstat(fd)
            except OSError: pass
            else: raise RuntimeError('PAYLOAD_FD_LEAK')
        results.extend(['nobody_import_and_adjacent_data', 'only_payload_fd_and_clean_environment',
                        'closed_fd_and_unchanged_private_ancestor'])

        for name in ('payload-change', 'extra-directory', 'replace-root', 'child-failure', 'oversized', 'timeout'):
            if name == 'child-failure': code = b'raise RuntimeError("owned fixture failure")\n'
            elif name == 'oversized': code = b'def current_versions(): return {"value":"x"*9000}\n'
            elif name == 'timeout': code = b'import time\ndef current_versions(): time.sleep(30);return {}\n'
            else: code = source
            native, verify = fixture(a, builder, root, name, code)
            observed = []
            def child(*args, **kwargs):
                observed.append(kwargs['pass_fds'][0])
                result = original_run(*args, **kwargs)
                if name == 'payload-change':
                    path = native/'adjacent.json'
                    path.chmod(0o644)
                    path.write_bytes(b'{"value":8}\n')
                    path.chmod(0o444)
                elif name == 'extra-directory':
                    native.chmod(0o755)
                    (native/'unlisted').mkdir()
                    native.chmod(0o555)
                elif name == 'replace-root':
                    native.rename(native.with_name('retained-original'))
                    native.mkdir(mode=0o555)
                return result
            failure = None
            with patch.object(a.subprocess, 'run', side_effect=child):
                try: a.compute_versions_from_fd(native, sync, verify)
                except (a.c.Blocked, builder.c.ReleaseError) as error:
                    failure = error.code if isinstance(error, a.c.Blocked) else str(error)
            wanted = {'payload-change': 'BASE_FILE_CHANGED:adjacent.json',
                      'extra-directory': 'VERSION_ROOT_CHANGED', 'replace-root': 'VERSION_ROOT_CHANGED',
                      'child-failure': 'COMPUTE_UNAVAILABLE', 'oversized': 'VERSION_SCHEMA',
                      'timeout': 'COMPUTE_UNAVAILABLE'}[name]
            need(failure == wanted, 'WRONG_BOUNDARY:'+name)
            need(len(observed) == 1, 'CHILD_COUNT:'+name)
            for fd in observed:
                try: os.fstat(fd)
                except OSError: pass
                else: raise RuntimeError('FAILURE_FD_LEAK:'+name)
            results.append(name+'_refused_and_fd_closed')
        return results
    finally:
        os.close(forbidden_fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workspace', type=Path, required=True)
    parser.add_argument('--source-sha', required=True)
    args = parser.parse_args()
    need(os.geteuid() == 0 and sys.flags.isolated and sys.dont_write_bytecode, 'ISOLATED_ROOT_GATE')
    need(re.fullmatch('[a-f0-9]{40}', args.source_sha), 'SOURCE_SHA')
    workspace = args.workspace
    need(workspace.parent == Path('/run') and
         re.fullmatch(r'alisa-r15-private-probe-ci-[0-9]+-[0-9]+', workspace.name), 'OWN_WORKSPACE_SCOPE')
    for path in (workspace, *workspace.parents):
        info = path.lstat()
        need(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
             and not info.st_mode & 0o022, 'OWN_WORKSPACE_IDENTITY')
    need(stat.S_IMODE(workspace.stat().st_mode) == 0o700 and not any(workspace.iterdir()), 'OWN_WORKSPACE_NOT_EMPTY')
    with tempfile.TemporaryDirectory(prefix='fixture-', dir=workspace) as temporary:
        root = Path(temporary)
        a, sync, builder, tool_pin = load_tools(root)
        results = cases(a, sync, builder, root)
    need(not any(workspace.iterdir()), 'OWN_FIXTURE_CLEANUP_INCOMPLETE')
    print(json.dumps({'status': 'PASS', 'source_sha': args.source_sha, 'tool_sha256': tool_pin,
                      'canonical_sync_sha256': CANONICAL_SHA, 'checks': results,
                      'check_count': len(results), 'actual_root_to_nobody': True,
                      'fixture_removed': True, 'installed_access': False}, sort_keys=True))


if __name__ == '__main__': main()
