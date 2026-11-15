"""Separate, finite R15 activation tool; no effects at import time.

Source authoring/tests do not authorize any invocation on the installed system.
The CLI has no fixture, skip-check, auto-retry, migration or credential command.
"""
import sys
if __name__ == '__main__' and (not sys.flags.isolated or not sys.dont_write_bytecode):
    print('{"status":"BLOCKED","code":"ISOLATED_INTERPRETER_REQUIRED"}')
    raise SystemExit(2)

from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
import argparse
import ctypes
import errno
import fcntl
import hashlib
import importlib.util
import json
import os
import pwd
import re
import signal
import stat
import subprocess
import tempfile
import time
import urllib.request

HERE = Path(__file__).resolve().parent
OWNER_UID = 0  # Fixed production owner; tests patch this in their disposable tree.


def _raw_tools():
    result = {}
    for name in ('activation_contract.py', 'activate.py', 'readiness.py', 'runtime_versions_sync.py'):
        fd = os.open(HERE/name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            if not stat.S_ISREG(before.st_mode) or before.st_size > 2*1024*1024:
                raise RuntimeError('TOOL_IDENTITY')
            with os.fdopen(fd, 'rb', closefd=False) as stream:
                result[name] = stream.read(2*1024*1024+1)
            after = os.fstat(fd)
            if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
                    after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
                raise RuntimeError('TOOL_IDENTITY')
        finally:
            os.close(fd)
    return result


def _execute_bytes(name, path, raw):
    # -B prevents cache writes, not cache reads. Never ask a source loader to
    # re-read a pinned path or select .pyc after its hash has been verified.
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    exec(compile(raw, str(path), 'exec', dont_inherit=True), module.__dict__)
    return module


_tool_blobs = globals().get('__r15_verified_tool_bytes__')
if _tool_blobs is None:
    _tool_blobs = _raw_tools()
if __name__ == '__main__':
    # Verify the external tool identity BEFORE executing either local module.
    # Direct `python -I -B activate.py ...` does not read the script's .pyc.
    try:
        positions = [i for i, arg in enumerate(sys.argv) if arg == '--tool-sha256']
        if len(positions) != 1:
            raise ValueError()
        expected = sys.argv[positions[0]+1]
        index = {n: hashlib.sha256(raw).hexdigest() for n, raw in _tool_blobs.items()}
        actual = hashlib.sha256((json.dumps(index, sort_keys=True, ensure_ascii=False, indent=2)+'\n').encode()).hexdigest()
        if actual != expected:
            raise ValueError()
    except (IndexError, ValueError):
        print('{"status":"BLOCKED","code":"TOOL_IDENTITY"}')
        raise SystemExit(2) from None
c = _execute_bytes('activation_contract', HERE/'activation_contract.py', _tool_blobs['activation_contract.py'])
readiness = _execute_bytes('readiness', HERE/'readiness.py', _tool_blobs['readiness.py'])


def secure_dir(path):
    path = Path(path)
    c.need(c.absolute(str(path)), 'UNTRUSTED_DIRECTORY')
    for parent in (path, *path.parents):
        info = parent.lstat()
        c.need(stat.S_ISDIR(info.st_mode) and info.st_uid in (0, OWNER_UID)
               and not info.st_mode & 0o022, 'UNTRUSTED_DIRECTORY')
    return path


def regular(path, maximum=16*1024*1024):
    path = Path(path)
    secure_dir(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        c.need(stat.S_ISREG(before.st_mode) and before.st_uid == OWNER_UID
               and not before.st_mode & 0o022 and before.st_size <= maximum,
               'UNTRUSTED_FILE')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(maximum+1)
        after = os.fstat(fd)
        c.need(len(raw) == before.st_size and
               (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
               (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'FILE_CHANGED')
        return raw
    finally:
        os.close(fd)


def path_state(path):
    path = Path(path)
    secure_dir(path.parent)
    try:
        info = path.lstat()
    except FileNotFoundError:
        return None
    c.need(info.st_uid == OWNER_UID and (stat.S_ISREG(info.st_mode) or stat.S_ISLNK(info.st_mode)),
           'MANAGED_PATH_TYPE')
    if stat.S_ISREG(info.st_mode):
        c.need(info.st_nlink == 1 and not info.st_mode & 0o022, 'MANAGED_FILE_ALIAS')
        content = c.digest(regular(path))
        kind = 'file'
    else:
        content, kind = os.readlink(path), 'link'
    # Rename changes ctime. Inode+content+mtime preserve identity across our
    # no-replace moves; a same-target replacement has a different inode.
    result = {'kind': kind, 'device': str(info.st_dev), 'inode': str(info.st_ino),
              'mode': stat.S_IMODE(info.st_mode), 'uid': info.st_uid, 'gid': info.st_gid,
              'size': info.st_size, 'mtime_ns': str(info.st_mtime_ns), 'content': content}
    after = path.lstat()
    c.need((info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) ==
           (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
           'MANAGED_PATH_CHANGED')
    return result


def metadata(path):
    """Environment-file identity only; never open or print its contents."""
    path = Path(path)
    secure_dir(path.parent)
    info = path.lstat()
    c.need(stat.S_ISREG(info.st_mode) and info.st_uid == OWNER_UID and not info.st_mode & 0o022,
           'ENVIRONMENT_FILE_UNSAFE')
    return [str(x) for x in (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                             info.st_size, info.st_mtime_ns, info.st_ctime_ns)]


def optional_state(path):
    if not os.path.lexists(path.parent):
        secure_dir(path.parent.parent)
        return None
    return path_state(path)


def _native_fd_identity(fd):
    """Include the mount ID: equal root inodes do not identify a mount view."""
    info = os.fstat(fd)
    meta = os.open('/proc/self/fdinfo/'+str(fd), os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        raw = os.read(meta, 4097)
    finally:
        os.close(meta)
    c.need(len(raw) <= 4096, 'NATIVE_DESCRIPTOR_METADATA')
    rows = [line.split(b':', 1)[1].strip() for line in raw.splitlines()
            if line.startswith(b'mnt_id:')]
    c.need(len(rows) == 1 and rows[0].isdigit() and int(rows[0]) > 0,
           'NATIVE_DESCRIPTOR_METADATA')
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, int(rows[0]))


class NativeCredentialView:
    """One checked native generation's existing, read-only credential directory.

    Only the fixed kernel process-root link and mount-namespace link are followed.
    All ordinary components and credential leaves use O_NOFOLLOW. Nothing is
    mounted, copied, inherited by a child, cached across calls, or made public.
    """
    def __init__(self, binding, pair, generation, root, config, names):
        self.binding, self.pair = binding, pair
        self.generation, self.root = deepcopy(generation), Path(root)
        c.need(type(generation) is dict and set(generation) == {'pid', 'start_ticks', 'uid', 'boot_id'}
               and type(generation['pid']) is int and generation['pid'] > 1
               and type(generation['start_ticks']) is int and generation['start_ticks'] > 0
               and type(generation['uid']) is int and generation['uid'] >= 0
               and type(generation['boot_id']) is str
               and re.fullmatch('[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}', generation['boot_id']),
               'NATIVE_GENERATION_SHAPE')
        # The accepted checker.resolve admits 1..128 explicit bindings; never
        # interpret an empty or unbounded projection as a successful owner proof.
        c.need(type(names) in (tuple, list) and 0 < len(names) <= 128
               and all(type(name) is str and 0 < len(os.fsencode(name)) <= 255
                       and Path(name).name == name and name not in ('.', '..') and '\x00' not in name
                       for name in names), 'NATIVE_CREDENTIAL_NAME')
        self.names = frozenset(names)
        self.socket_path = config['runtime_port']['socket']
        c.need(c.absolute(self.socket_path) and self.socket_path.startswith('/run/'), 'NATIVE_SOCKET_SCOPE')
        secure_dir(self.root)
        self.fds, self.anchor, self.closed = [], None, True

    def _generation_guard(self):
        unit = c.UNITS['native']
        raw = run('systemctl', 'show', unit, '--property=MainPID,ActiveState,SubState', timeout=10)
        rows = [line.partition('=') for line in raw.decode().splitlines()]
        c.need(len(rows) == 3 and all(row[1] for row in rows), 'NATIVE_UNIT_IDENTITY')
        values = {key: value for key, _, value in rows}
        c.need(values == {'MainPID': str(self.generation['pid']), 'ActiveState': 'active', 'SubState': 'running'},
               'NATIVE_GENERATION_MOVED')
        c.need(self.binding.process_generation(self.generation['pid']) == self.generation,
               'NATIVE_GENERATION_MOVED')
        c.need(c.NATIVE_LINK.resolve(strict=True) == self.root
               and Path('/proc', str(self.generation['pid']), 'cwd').resolve(strict=True) == self.root,
               'NATIVE_PROCESS_SOURCE_MOVED')
        c.need(self.pair.native_peer(self.socket_path) ==
               (self.generation['pid'], self.generation['uid']), 'NATIVE_SOCKET_GENERATION_MOVED')
        c.need(self.binding.process_generation(self.generation['pid']) == self.generation,
               'NATIVE_GENERATION_MOVED')

    def _open_anchor(self):
        fds = []
        def opened(path, flags, *, parent=None):
            fd = os.open(path, flags | os.O_CLOEXEC, dir_fd=parent)
            fds.append(fd)
            c.need(not os.get_inheritable(fd), 'NATIVE_DESCRIPTOR_INHERITABLE')
            return fd
        try:
            directory = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
            proc = opened('/proc/'+str(self.generation['pid']), directory)
            c.need(os.fstat(proc).st_uid == self.generation['uid'], 'NATIVE_PROCESS_OWNER')
            # These two literal kernel links are the complete exception. Never
            # resolve root into '/', follow a caller path, or enter a namespace.
            namespace = opened('ns/mnt', os.O_RDONLY, parent=proc)
            root = opened('root', os.O_RDONLY | os.O_DIRECTORY, parent=proc)
            current = root
            for component in ('run', 'credentials', c.UNITS['native']):
                parent_info = os.fstat(current)
                c.need(stat.S_ISDIR(parent_info.st_mode) and parent_info.st_uid == OWNER_UID
                       and not parent_info.st_mode & 0o022, 'NATIVE_CREDENTIAL_DIRECTORY')
                current = opened(component, directory, parent=current)
            info = os.fstat(current)
            c.need(stat.S_ISDIR(info.st_mode) and info.st_uid == OWNER_UID and not info.st_mode & 0o022
                   and os.fstatvfs(current).f_flag & os.ST_RDONLY, 'NATIVE_CREDENTIAL_DIRECTORY')
            return fds, {'proc': proc, 'namespace': namespace, 'root': root, 'credentials': current}
        except BaseException:
            for fd in reversed(fds): os.close(fd)
            raise

    def check(self):
        c.need(not self.closed and self.anchor is not None, 'NATIVE_CREDENTIAL_SCOPE_CLOSED')
        self._generation_guard()
        c.need({key: _native_fd_identity(fd) for key, fd in self.anchor.items()} == self.identities,
               'NATIVE_CREDENTIAL_VIEW_MOVED')
        fresh, anchor = self._open_anchor()
        try:
            # Reopen from the CURRENT process, not from the held root. This also
            # rejects an old root/credential fd whose root inode happens to match.
            c.need({key: _native_fd_identity(fd) for key, fd in anchor.items()} == self.identities,
                   'NATIVE_CREDENTIAL_VIEW_MOVED')
            self._generation_guard()
        finally:
            for fd in reversed(fresh): os.close(fd)

    def __enter__(self):
        try:
            self._generation_guard()
            self.fds, self.anchor = self._open_anchor()
            self.identities = {key: _native_fd_identity(fd) for key, fd in self.anchor.items()}
            self.closed = False
            self.check()
            return self
        except BaseException:
            self.close()
            raise

    def close(self):
        self.closed = True
        for fd in reversed(self.fds): os.close(fd)
        self.fds = []
        self.anchor = None

    def __exit__(self, *_):
        try:
            self.check()
        finally:
            self.close()

    def read(self, name):
        c.need(name in self.names, 'NATIVE_CREDENTIAL_NAME')
        self.check()
        directory = self.anchor['credentials']
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
        try:
            before = os.fstat(fd)
            c.need(stat.S_ISREG(before.st_mode) and before.st_uid == OWNER_UID and before.st_nlink == 1
                   and not before.st_mode & 0o027 and 0 < before.st_size <= 32768
                   and os.fstatvfs(fd).f_flag & os.ST_RDONLY and not os.get_inheritable(fd),
                   'NATIVE_CREDENTIAL_FILE')
            raw = b''
            while len(raw) <= 32768:
                part = os.read(fd, min(32769-len(raw), 65536))
                if not part: break
                raw += part
            def state(info):
                return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
                        info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
            c.need(len(raw) == before.st_size and len(raw) <= 32768
                   and state(os.fstat(fd)) == state(before)
                   and state(os.stat(name, dir_fd=directory, follow_symlinks=False)) == state(before),
                   'NATIVE_CREDENTIAL_CHANGED')
            self.check()
            return self.binding.loads(raw)
        finally:
            os.close(fd)


def fence_environment():
    paths = run('systemctl', 'show', '--property=UnitPath', '--value', timeout=10).decode().split()
    c.need(tuple(paths) == c.UNIT_PATHS, 'UNIT_LOAD_PATH_CHANGED')
    higher = Path(c.UNIT_PATHS[0])
    for unit in c.UNITS.values():
        names = [unit]
        if '@' in unit:
            names.append(unit.split('@', 1)[0]+'@.service')
        for name in names:
            c.need(optional_state(higher/name) is None, 'HIGHER_PRIORITY_UNIT_PRESENT')
        if len(names) > 1:
            c.need(optional_state(c.FENCE_ROOT/names[1]) is None, 'CONTROL_TEMPLATE_PRESENT')
    return paths


def fsync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def write_new(path, raw, mode=0o600, owner=None):
    secure_dir(path.parent)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(fd, 'wb') as stream:
        os.fchmod(stream.fileno(), mode)
        if owner is not None:
            os.fchown(stream.fileno(), *owner)
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    fsync_dir(path.parent)


def noreplace(source, target):
    libc = ctypes.CDLL(None, use_errno=True)
    c.need(hasattr(libc, 'renameat2'), 'ATOMIC_RENAME_UNAVAILABLE')
    fn = libc.renameat2
    fn.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    fn.restype = ctypes.c_int
    if fn(-100, os.fsencode(source), -100, os.fsencode(target), 1):
        code = ctypes.get_errno()
        raise c.Blocked('DESTINATION_OCCUPIED' if code == errno.EEXIST else 'ATOMIC_RENAME_FAILED')
    fsync_dir(target.parent)


def replace_managed(path, staged, expected, staged_state, *, nonce):
    """Exact-inode CAS. A foreign live name is never removed to restore ours."""
    held = path.with_name('.'+path.name+'.r15-held-'+nonce)
    c.need(path_state(held) is None and path_state(path) == expected, 'COMPONENT_CHANGED')
    if staged is not None:
        c.need(path_state(staged) == staged_state, 'STAGED_COMPONENT_CHANGED')
    moved = False
    try:
        if expected is not None:
            noreplace(path, held)
            moved = True
            c.need(path_state(held) == expected, 'DISPLACED_COMPONENT_CHANGED')
        if staged is not None:
            c.need(path_state(staged) == staged_state, 'STAGED_COMPONENT_CHANGED')
            noreplace(staged, path)
            c.need(path_state(path) == staged_state, 'INSTALLED_COMPONENT_CHANGED')
        if moved:
            c.need(path_state(held) == expected, 'DISPLACED_COMPONENT_CHANGED')
            held.unlink()
            fsync_dir(held.parent)
    except BaseException:
        # noreplace() can rename successfully and then fail during directory
        # fsync, before `moved` is assigned. Prove the retained old inode itself.
        if expected is not None and path_state(path) is None and path_state(held) == expected:
            noreplace(held, path)
        # Preserve held/staged/live evidence if ownership is uncertain.
        raise


def run(*args, timeout=45, **kwargs):
    try:
        result = subprocess.run(args, capture_output=True, timeout=timeout, check=False, **kwargs)
    except (OSError, subprocess.TimeoutExpired):
        raise c.Blocked('COMMAND_UNAVAILABLE') from None
    c.need(result.returncode == 0, 'COMMAND_FAILED')
    return result.stdout


def prop(unit, key):
    return run('systemctl', 'show', unit, '--value', '-p', key, timeout=10).decode().strip()


def _lock_identity(info):
    # Directory timestamps/link counts can change when unrelated locks appear.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid)


def _lock_parent_state():
    c.need(c.LOCK == Path('/run/lock/alisa-stage-rollout.lock'), 'UNTRUSTED_LOCK')
    parent = c.LOCK.parent
    secure_dir(parent.parent)
    for ancestor in (parent.parent, *parent.parent.parents):
        info = ancestor.lstat()
        c.need(info.st_uid == 0 and info.st_gid == 0, 'UNTRUSTED_LOCK')
    info = parent.lstat()
    c.need(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
           and (not info.st_mode & 0o022 or stat.S_IMODE(info.st_mode) == 0o1777),
           'UNTRUSTED_LOCK')
    return _lock_identity(info)


def _lock_file_state(info):
    c.need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
           and not info.st_mode & 0o022 and info.st_nlink == 1, 'UNTRUSTED_LOCK')
    return _lock_identity(info)


def _check_lock(parent_fd, fd, parent_before, file_before):
    c.need(_lock_parent_state() == parent_before
           and _lock_identity(os.fstat(parent_fd)) == parent_before, 'UNTRUSTED_LOCK')
    # Compare the held fd, its entry in the held directory, and the public path.
    # A root writer replacing either inode must not split the shared flock.
    for info in (os.fstat(fd), os.stat(c.LOCK.name, dir_fd=parent_fd, follow_symlinks=False),
                 c.LOCK.lstat()):
        c.need(_lock_file_state(info) == file_before, 'UNTRUSTED_LOCK')


@contextmanager
def lock():
    parent_fd = fd = None
    try:
        try:
            parent_before = _lock_parent_state()
            parent_fd = os.open(c.LOCK.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            c.need(_lock_identity(os.fstat(parent_fd)) == parent_before, 'UNTRUSTED_LOCK')
            # The shared lock must already exist. Never create, chmod, relabel,
            # rename or substitute a different file in the sticky directory.
            fd = os.open(c.LOCK.name, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=parent_fd)
            file_before = _lock_file_state(os.fstat(fd))
            _check_lock(parent_fd, fd, parent_before, file_before)
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise c.Blocked('ROLLOUT_BUSY') from None
            _check_lock(parent_fd, fd, parent_before, file_before)
        except OSError:
            raise c.Blocked('UNTRUSTED_LOCK') from None
        with os.fdopen(fd, 'r+b', closefd=False) as stream:
            yield stream
    finally:
        if fd is not None:
            os.close(fd)
        if parent_fd is not None:
            os.close(parent_fd)


def load_module(name, path, digest):
    raw = regular(path)
    c.need(c.digest(raw) == digest, 'EXECUTABLE_SOURCE_CHANGED')
    previous = sys.dont_write_bytecode
    sys.dont_write_bytecode = True
    try:
        return _execute_bytes(name, path, raw)
    finally:
        sys.dont_write_bytecode = previous


def _version_root_identity(info):
    c.need(stat.S_ISDIR(info.st_mode) and info.st_uid == OWNER_UID
           and not info.st_mode & 0o222 and info.st_mode & 0o005 == 0o005,
           'VERSION_ROOT_UNTRUSTED')
    return tuple(getattr(info, name) for name in
                 ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
                  'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def _version_root_unchanged(root, fd, expected):
    secure_dir(root)
    c.need(_version_root_identity(os.fstat(fd)) == expected
           and _version_root_identity(root.lstat()) == expected, 'VERSION_ROOT_CHANGED')


def compute_versions_from_fd(root, sync, verify_root):
    """Compute the canonical version result as nobody from a verified directory.

    The immutable bundle can have private root-owned ancestors. Its held read-only
    directory fd grants access only to this payload; it does not grant traversal
    of those ancestors. The caller supplies its exact frozen-manifest verifier.
    No product module is imported in this privileged process.
    """
    root = secure_dir(root)
    before = _version_root_identity(root.lstat())
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        _version_root_unchanged(root, fd, before)
        verify_root()
        _version_root_unchanged(root, fd, before)
        account = pwd.getpwnam('nobody')
        c.need(account.pw_uid != 0, 'COMPUTE_IDENTITY')
        public_root = '/proc/self/fd/'+str(fd)
        # Same import/call/result algorithm as the frozen canonical compute().
        # The actual current_versions import closure uses __file__.parent and
        # with_name; it never resolves this fd alias back to private ancestors.
        code = ('import sys,json;sys.path.insert(0,'+repr(public_root)+');'
                'from runtime_port import current_versions;print(json.dumps(current_versions()))')
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as error:
            try:
                result = subprocess.run(['/usr/bin/python3', '-I', '-B', '-c', code],
                    cwd=public_root,
                    env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8', 'HOME': '/nonexistent',
                         'PYTHONDONTWRITEBYTECODE': '1'},
                    user=account.pw_uid, group=account.pw_gid, extra_groups=[],
                    pass_fds=(fd,), close_fds=True, stdin=subprocess.DEVNULL,
                    stdout=output, stderr=error, timeout=8, preexec_fn=sync.limits)
            except (subprocess.TimeoutExpired, OSError):
                raise c.Blocked('COMPUTE_UNAVAILABLE') from None
            finally:
                _version_root_unchanged(root, fd, before)
                verify_root()
                _version_root_unchanged(root, fd, before)
            c.need(result.returncode == 0, 'COMPUTE_UNAVAILABLE')
            output.seek(0)
            raw = output.read(8193)
        c.need(len(raw) <= 8192, 'VERSION_SCHEMA')
        return sync.decode(raw)
    finally:
        os.close(fd)


def tool_hash():
    return c.canonical_hash({name: c.digest(regular(HERE/name)) for name in c.TOOL_FILES})


def public_tool_directory(expected):
    c.need(HERE.parent == Path('/usr/local/libexec')
           and HERE.name == 'alisa-r15-activation-'+expected[:16], 'SAMPLER_TOOL_LOCATION')
    secure_dir(HERE)
    c.need({p.name for p in HERE.iterdir()} == set(c.TOOL_FILES), 'SAMPLER_TOOL_INVENTORY')
    for path in (HERE, *HERE.parents):
        c.need(path.stat().st_mode & 0o001, 'SAMPLER_SOURCE_INACCESSIBLE')
    for name in c.TOOL_FILES:
        info = (HERE/name).lstat()
        c.need(stat.S_ISREG(info.st_mode) and info.st_uid == 0
               and info.st_mode & 0o004 and not info.st_mode & 0o222, 'SAMPLER_SOURCE_INACCESSIBLE')


def builder_at(root):
    root = secure_dir(root)
    c.need({name: c.digest(regular(root/name)) for name in c.BUILD_TOOLS} == c.BUILD_TOOLS,
           'BUILDER_CHANGED')
    module = load_module('release_contract', root/'release_contract.py', c.BUILD_TOOLS['release_contract.py'])
    sys.modules['release_contract'] = module
    return load_module('r15_frozen_builder', root/'build_candidate.py', c.BUILD_TOOLS['build_candidate.py'])


def interpreter_alias(environment):
    expected = environment['python']
    c.need(str(Path('/usr/bin/python3').resolve(strict=True)) == expected['path']
           and c.digest(regular(Path(expected['path']), maximum=64*1024*1024)) == expected['sha256'],
           'PYTHON_ALIAS_CHANGED')


def package(builder, bundle, prepared_hash):
    # Import probes run only from an immutable, root-owned package. Checksums
    # alone would leave a swap race in a package owned by another principal.
    secure_dir(bundle)
    for base, dirs, files in os.walk(bundle, followlinks=False):
        info = Path(base).lstat()
        c.need(info.st_uid == 0 and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o222,
               'PACKAGE_NOT_IMMUTABLE')
        for name in (*dirs, *files):
            info = (Path(base)/name).lstat()
            c.need(info.st_uid == 0, 'PACKAGE_OWNER_CHANGED')
            if stat.S_ISREG(info.st_mode):
                c.need(info.st_nlink == 1 and not info.st_mode & 0o222, 'PACKAGE_NOT_IMMUTABLE')
    builder.verify_prepared(bundle, prepared_hash)  # OLD live bases, before switch only.
    prepared = c.strict_json(regular(bundle/'PREPARED.json'))
    plan_raw = regular(bundle/'PLAN.json')
    c.need(c.digest(plan_raw) == c.PRODUCT_PLAN, 'PRODUCT_PLAN_CHANGED')
    plan = c.strict_json(plan_raw)
    c.product_identity(plan, prepared)
    for key, root in (('native_before', Path(plan['baseline']['bases']['native']['root'])),
                      ('native_candidate', bundle/'releases/native')):
        no_native_cache(root)
        c.need(builder.native_probe(root, plan['baseline']['environment']['python']['path']) ==
               prepared[key], 'NATIVE_PROBE_CHANGED')
    return plan, prepared


def no_native_cache(root):
    for _base, dirs, files in os.walk(root, followlinks=False):
        c.need('__pycache__' not in dirs and not any(name.endswith(('.pyc', '.pyo')) for name in files),
               'NATIVE_BYTECODE_CACHE_PRESENT')


def verify_target(builder, root, manifest_hash, role, prepared):
    manifest, _ = builder.verify_manifest(root, manifest_hash)
    links = {**manifest.get('links', {}), **manifest.get('external_links', {})}
    c.need(builder.file_hashes(root, links) == {**manifest['files'], 'manifest.json': manifest_hash},
           'PUBLISHED_TREE_CHANGED')
    expected_external = {} if role == 'native' else {'.venv': prepared['environment']['venv_root']}
    c.need(manifest.get('external_links') == expected_external, 'PUBLISHED_ENVIRONMENT_CHANGED')
    for name, target in expected_external.items():
        c.need((root/name).is_symlink() and os.readlink(root/name) == target
               and str((root/name).resolve(strict=True)) == target, 'PUBLISHED_ENVIRONMENT_CHANGED')
    leaves = {*manifest['files'], 'manifest.json', *links}
    directories = {str(p) for name in leaves for p in Path(name).parents if str(p) != '.'}
    seen = set()
    for base, dirs, files in os.walk(root, followlinks=False):
        info = Path(base).lstat()
        c.need(info.st_uid == OWNER_UID and stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o222,
               'PUBLISHED_DIRECTORY_WRITABLE')
        for name in (*dirs, *files):
            path = Path(base)/name
            relative = str(path.relative_to(root))
            c.need(relative in leaves or relative in directories, 'PUBLISHED_EXTRA_ENTRY')
            seen.add(relative)
            info = path.lstat()
            c.need(info.st_uid == OWNER_UID, 'PUBLISHED_OWNER_CHANGED')
            if stat.S_ISREG(info.st_mode):
                c.need(info.st_nlink == 1 and not info.st_mode & 0o222, 'PUBLISHED_FILE_WRITABLE')
    c.need(seen == leaves | directories, 'PUBLISHED_ENTRY_MISSING')
    return manifest


def reserve(required=0, inodes=0, roots=()):
    filesystems = {}
    for root in roots or (Path('/opt'),):
        root = secure_dir(root)
        info = root.stat()
        filesystems.setdefault(info.st_dev, os.statvfs(root))
    for fs in filesystems.values():
        c.need(fs.f_bavail*fs.f_frsize >= required+c.MIN_FREE_BYTES, 'PACKAGE_DISK_RESERVE')
        c.need(fs.f_favail >= inodes+c.MIN_FREE_INODES, 'PACKAGE_INODE_RESERVE')
    rows = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    memory = rows.get('MemAvailable', '').split()
    c.need(len(memory) == 2 and memory[0].isdecimal() and memory[1] == 'kB'
           and int(memory[0])*1024 >= c.MIN_MEMORY_HEADROOM+512*1024**2, 'MEMORY_RESERVE')


def publish_role(builder, source, target, role, prepared, on_stage=None):
    """No hardlinks, no merge, no overwrite, no deletion of historical paths."""
    secure_dir(target.parent)
    c.need(not os.path.lexists(target), 'TARGET_ALREADY_EXISTS')
    manifest_hash = prepared['candidates'][role]['manifest_sha256']
    manifest, _ = builder.verify_manifest(source, manifest_hash)
    stage = Path(tempfile.mkdtemp(prefix='.'+target.name+'-', dir=target.parent))
    inode = (stage.stat().st_dev, stage.stat().st_ino)
    if on_stage is not None:
        on_stage({'stage': str(stage), 'target': str(target), 'device': str(inode[0]),
                  'inode': str(inode[1]), 'source_commit': c.PRODUCT, 'manifest_sha256': manifest_hash})
    # On failure retain our incomplete staging path as evidence, never recursively
    # remove an uncertain inode. The finite receipt identifies it for review.
    for name in [*manifest['files'], 'manifest.json']:
        src, dst = source/name, stage/name
        dst.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        expected = manifest_hash if name == 'manifest.json' else manifest['files'][name]
        info = src.lstat()
        c.need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o222, 'PACKAGE_NOT_IMMUTABLE')
        fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW)
        h = hashlib.sha256()
        try:
            before = os.fstat(fd)
            with os.fdopen(fd, 'rb', closefd=False) as input_stream, dst.open('xb') as output:
                for block in iter(lambda: input_stream.read(1024*1024), b''):
                    h.update(block)
                    output.write(block)
                output.flush()
                os.fsync(output.fileno())
            after = os.fstat(fd)
            c.need((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                   (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                   and h.hexdigest() == expected, 'COPY_SOURCE_CHANGED')
        finally:
            os.close(fd)
        dst.chmod(0o555 if info.st_mode & 0o111 else 0o444)
    for name, target_link in {**manifest.get('links', {}), **manifest.get('external_links', {})}.items():
        dst = stage/name
        dst.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        dst.symlink_to(target_link)
    builder.freeze(stage)
    verify_target(builder, stage, manifest_hash, role, prepared)
    c.need((stage.stat().st_dev, stage.stat().st_ino) == inode, 'PUBLICATION_STAGE_CHANGED')
    noreplace(stage, target)
    c.need((target.stat().st_dev, target.stat().st_ino) == inode, 'PUBLICATION_TARGET_CHANGED')
    verify_target(builder, target, manifest_hash, role, prepared)
    return {'root': str(target), 'device': str(inode[0]), 'inode': str(inode[1]),
            'manifest_sha256': manifest_hash}


def _environment_paths(value):
    matches = re.findall(r'(/[^\s]+) \(ignore_errors=(?:no|yes)\)', value)
    remainder = re.sub(r'/[^\s]+ \(ignore_errors=(?:no|yes)\)', '', value).strip()
    c.need(not remainder, 'ENVIRONMENT_FILES_GRAMMAR')
    return matches


def unit_static(unit, rewrite=None):
    values = {name: prop(unit, name) for name in
              ('WorkingDirectory', 'FragmentPath', 'DropInPaths', 'EnvironmentFiles', 'User', 'Group', 'DynamicUser')}
    command = prop(unit, 'ExecStart')
    path = re.search(r'(?:^|\{ )path=([^;]+) ;', command)
    argv = re.search(r'argv\[\]=(.*?) ; ignore_errors=', command)
    c.need(path is not None and argv is not None, 'UNIT_COMMAND_GRAMMAR')
    command_values = {'path': path.group(1), 'argv': argv.group(1)}
    if rewrite is not None:
        base, target = rewrite
        c.need(all(base in value for value in command_values.values()), 'UNIT_RELEASE_COMMAND')
        command_values = {k: v.replace(base, target) for k, v in command_values.items()}
    # Even an unexpected installed argument is not reflected into a receipt.
    values['command'] = {k: c.digest(v.encode()) for k, v in command_values.items()}
    unset = prop(unit, 'UnsetEnvironment')
    c.need(not any(token.split('=', 1)[0] in c.FLAGS for token in unset.split()),
           'FEATURE_FLAGS_UNSET')
    values['unset_environment_sha256'] = c.digest(unset.encode())
    source_paths = [values['FragmentPath'], *values['DropInPaths'].split()]
    c.need(all(c.absolute(p) for p in source_paths), 'UNIT_SOURCE_PATH')
    values['source_hashes'] = {p: c.digest(regular(Path(p))) for p in source_paths}
    values['environment_stats'] = {p: metadata(Path(p)) for p in _environment_paths(values['EnvironmentFiles'])}
    return values


class LiveHost:
    """Fixed installed surfaces. Internal sampler subprocesses expose counts only."""
    def __init__(self, builder, bundle, prepared_hash, attempt, lock_stream):
        self.builder, self.bundle = builder, bundle
        self.tool_pin = tool_hash()
        self.prepared_hash, self.attempt, self.lock_stream = prepared_hash, attempt, lock_stream
        self.plan, self.prepared = package(builder, bundle, prepared_hash)
        self.baseline = self.plan['baseline']
        self.targets = {r: Path(self.prepared['rollback_candidate'][r]['root']) for r in c.ROLES}
        self.components = {'config': c.CONFIG, 'versions': c.VERSIONS, 'projection': c.PROJECTION,
                           'flags': c.FLAG_FILE,
                           'native_pointer': c.NATIVE_LINK,
                           **{r+'_selector': p for r, p in c.SELECTORS.items()}}
        self.private_before = {}
        self.old_projection = None
        self.intent = {'before': {}, 'ours': {}, 'fences': {}, 'admission_possible': False}
        self.nonce = os.urandom(16).hex()
        self.pair = None

    def helper_guard(self):
        c.need(tool_hash() == self.tool_pin, 'ACTIVATION_SOURCE_CHANGED')
        interpreter_alias(self.baseline['environment'])
        c.need({p: c.digest(regular(Path(p))) for p in c.HELPERS} == c.HELPERS, 'HELPER_CHANGED')
        c.need(c.digest(regular(HERE/c.VERSION_SYNC_FILE)) == c.VERSION_SYNC_SHA,
               'VERSION_HELPER_CHANGED')

    def helpers(self):
        self.helper_guard()
        if self.pair is None:
            # Do not let a previously cached or path-shadowed checker substitute
            # for the exact accepted module the helper imports by name.
            load_module('shared_http', c.SHARED_HTTP, c.HELPERS[str(c.SHARED_HTTP)])
            load_module('store_checker', c.STORE_CHECKER, c.HELPERS[str(c.STORE_CHECKER)])
            binding = load_module('native_store_binding', c.CHECKER, c.HELPERS[str(c.CHECKER)])
            self.pair = load_module('r15_accepted_pair', c.PAIR, c.HELPERS[str(c.PAIR)])
            self.pair.native_module = lambda: binding
            self.pair.NATIVE_BASE = Path(self.baseline['bases']['native']['root'])
            self.pair.NATIVE = self.targets['native']
            self.pair.CURRENT = c.NATIVE_LINK
            # Suppress helper stderr/tracebacks at the public boundary. The only
            # admitted calls are the separately reviewed functions below.
        return self.pair

    def expected_versions(self, root):
        # Separate canonical helper; the shared installed startup helper remains
        # pinned as a baseline and is never substituted, edited or imported here.
        self.helper_guard()
        root = Path(root)
        c.need(root in (self.bundle/'releases/native', self.targets['native']), 'VERSION_SOURCE_SCOPE')
        sync = load_module('r15_canonical_version_sync', HERE/c.VERSION_SYNC_FILE, c.VERSION_SYNC_SHA)
        def verify_root():
            no_native_cache(root)
            verify_target(self.builder, root, self.prepared['candidates']['native']['manifest_sha256'],
                          'native', self.prepared)
        old = sync.version_shape(c.strict_json(regular(c.VERSIONS)))
        new = sync.version_shape({**compute_versions_from_fd(root, sync, verify_root),
                                  'catalog_release_id': old['catalog_release_id']})
        c.need({key for key in old if old[key] != new[key]} <= {'catalog_bundle_hash'}, 'VERSION_SCOPE')
        return (json.dumps(new, indent=2)+'\n').encode()

    def capture(self):
        self.helper_guard()
        unit_paths = fence_environment()
        units = {role: unit_static(unit) for role, unit in c.UNITS.items()}
        c.need(tuple(_environment_paths(units['platform']['EnvironmentFiles'])) == c.ENV_FILES,
               'PLATFORM_ENVIRONMENT_CHANGED')
        for role, path in c.SOURCE_SELECTORS.items():
            drops = units[role]['DropInPaths'].split()
            c.need(str(path) in drops and drops[-1] == str(path), 'EFFECTIVE_SELECTOR_CHANGED')
        others = {unit: {'static': unit_static(unit),
                         'pid': prop(unit, 'MainPID'), 'invocation': prop(unit, 'InvocationID')}
                  for unit in c.OTHER_UNITS}
        self.sampling_units = {'native': units['native'], 'postgres': units['platform'],
                               'voice': others['alisa-station.service']['static']}
        for kind, item in self.sampling_units.items():
            c.need((item['User'], item['Group']) == c.SAMPLER_IDENTITIES[kind]
                   and item['DynamicUser'] == 'no', 'SAMPLER_IDENTITY_CHANGED')
        c.need(all(prop(unit, 'ActiveState') == 'active' for unit in
                   (*c.UNITS.values(), *c.OTHER_UNITS, c.CHECKER_UNIT)), 'SERVICE_NOT_ACTIVE')
        c.need(prop(c.CLEANUP_UNIT, 'ActiveState') not in ('active', 'activating', 'deactivating'),
               'CLEANUP_BUSY')
        for path in (*c.SELECTORS.values(), c.FLAG_FILE):
            c.need(path_state(path) is None, 'ACTIVATION_SELECTOR_EXISTS')
        for unit in c.UNITS.values():
            c.need(optional_state(c.FENCE_ROOT/unit) is None, 'EXISTING_ADMISSION_MASK')
        return {'units': units, 'others': others, 'checker_static': unit_static(c.CHECKER_UNIT),
                'components': {name: path_state(path) for name, path in self.components.items()},
                'web_pointer': path_state(c.WEB_LINK),
                'publisher': c.digest(regular(Path(self.baseline['publisher']['path']))),
                'helpers': dict(c.HELPERS), 'unit_load_paths': unit_paths}

    def _projection_inputs(self, expected_states=None):
        pair = self.helpers()
        module = pair.native_module()
        states = {'projection': path_state(c.PROJECTION), 'config': path_state(c.CONFIG)}
        c.need(expected_states is None or states == expected_states, 'PROJECTION_INPUTS_MOVED')
        data = module.root_json(c.PROJECTION, 65536)
        config = module.root_json(c.CONFIG, 1048576)
        c.need(states == {'projection': path_state(c.PROJECTION), 'config': path_state(c.CONFIG)},
               'PROJECTION_INPUTS_MOVED')
        return pair, module, data, config, states

    def projection_data(self, root, *, expected=None, expected_config=None, candidate_config=None,
                        expected_states=None):
        """Accepted full source proof, using this projection's CURRENT generation."""
        pair, module, data, config, states = self._projection_inputs(expected_states)
        c.need(root in (Path(self.baseline['bases']['native']['root']), self.targets['native']),
               'NATIVE_PROCESS_SOURCE_SCOPE')
        c.need(expected is None or data == expected, 'PROJECTION_RACE')
        c.need(expected_config is None or config == expected_config, 'PROJECTION_INPUTS_MOVED')
        generation = data['native_generation']
        key = bytes.fromhex(data['mac_key'])
        names = [row['credential_name'] for row in data['bindings']]
        with NativeCredentialView(module, pair, generation, root, config, names) as view:
            for row in data['bindings']:
                material = view.read(row['credential_name'])
                context = module.native_context(config, material, row,
                    environment=data['environment'], product_id=data['product_id'], generation=generation)
                c.need(module.hmac.compare_digest(module.mac(key, 'native-owner-source-v1', context),
                                                  row['source_hmac']), 'OWNER_PAIR_MOVED')
                if candidate_config is not None:
                    context = module.native_context(candidate_config, material, row,
                        environment=data['environment'], product_id=data['product_id'], generation=generation)
                    c.need(module.hmac.compare_digest(module.mac(key, 'native-owner-source-v1', context),
                                                      row['source_hmac']), 'OWNER_SOURCE_WOULD_CHANGE')
            c.need(states == {'projection': path_state(c.PROJECTION), 'config': path_state(c.CONFIG)},
                   'PROJECTION_INPUTS_MOVED')
        return data

    def private_inputs(self):
        self.private_before = {name: regular(path) for name, path in self.components.items()
                               if name not in ('native_pointer', 'platform_selector', 'authority_selector', 'flags')}
        config = c.policy_bytes(self.private_before['config'], self.prepared['native_before'],
                                self.prepared['native_candidate'])
        # Same full old source HMAC under the candidate policy configuration;
        # no credential relabel, enrollment, provider qualification or new grant.
        self.old_projection = self.projection_data(Path(self.baseline['bases']['native']['root']),
            expected=c.strict_json(self.private_before['projection']),
            expected_config=c.strict_json(self.private_before['config']), candidate_config=c.strict_json(config))
        desired = {'config': config, 'flags': c.FLAG_BYTES,
                   'versions': self.expected_versions(self.bundle/'releases/native')}
        before_versions, after_versions = (c.strict_json(self.private_before['versions']),
                                           c.strict_json(desired['versions']))
        c.need(set(before_versions) == set(after_versions)
               and {k for k in before_versions if before_versions[k] != after_versions[k]} == {'catalog_bundle_hash'}
               and after_versions['catalog_bundle_hash'] == self.prepared['native_candidate']['versions']['catalog_bundle_hash'],
               'VERSION_SCOPE')
        for role, path in c.SOURCE_SELECTORS.items():
            desired[role+'_selector'] = c.selector_bytes(regular(path), self.baseline['bases'][role]['root'],
                                                       str(self.targets[role]))
        self.target_commands = {role: unit_static(c.UNITS[role],
            rewrite=(self.baseline['bases'][role]['root'], str(self.targets[role])))['command']
            for role in ('platform', 'authority')}
        return desired

    def counts(self):
        # Do not construct the worker, RuntimePort, GapStore or TerminalStore.
        native = {**self._sampler('native'), **self._sampler('voice')}
        postgres = self._sampler('postgres')
        readiness.check_idle(native, postgres)
        return {'native': native, 'postgres': postgres}

    def _sampler(self, kind):
        c.need(kind in ('native', 'voice', 'postgres'), 'SAMPLER_SCOPE')
        public_tool_directory(self.tool_pin)
        c.need(tool_hash() == self.tool_pin, 'ACTIVATION_SOURCE_CHANGED')
        descriptor = self.sampling_units[kind]
        self.unit_files_unchanged(descriptor)
        user, group = descriptor['User'], descriptor['Group']
        c.need((user, group) == c.SAMPLER_IDENTITIES[kind] and descriptor['DynamicUser'] == 'no'
               and pwd.getpwnam(user).pw_uid != 0, 'SAMPLER_IDENTITY')
        # One finite systemd process, no reusable queue or new service registry.
        # Parent tools are root-only, so source is sent as Python -c and imported
        # from the immutable reviewed tool directory (must be readable by user).
        command = ['systemd-run', '--quiet', '--wait', '--pipe', '--collect',
                   '--unit=alisa-r15-count-'+kind+'-'+os.urandom(8).hex(),
                   '--property=Type=exec', '--property=User='+user, '--property=Group='+group,
                   '--property=RuntimeMaxSec=20', '--property=TimeoutStartSec=10s',
                   '--property=TimeoutStopSec=5s', '--property=KillMode=control-group',
                   '--property=SendSIGKILL=yes', '--property=OOMPolicy=stop',
                   '--property=MemoryAccounting=yes', '--property=MemoryMax=268435456',
                   '--property=MemorySwapMax=0', '--property=TasksMax=16', '--property=NoNewPrivileges=yes',
                   '--setenv=PYTHONDONTWRITEBYTECODE=1']
        if kind == 'postgres':
            for path in c.ENV_FILES:
                command.append('--property=EnvironmentFile='+path)
            command.append('--setenv=PGOPTIONS='+c.PGOPTIONS)
            executable = str(Path(self.baseline['environment']['venv_root'])/'bin/python')
            root = self.baseline['bases']['platform']['root']
        else:
            executable, root = self.baseline['environment']['python']['path'], ''
        # These paths/hashes are metadata, never credential values.
        code = sampler_code(kind, root, self.tool_pin,
                            path_state(c.CONFIG) if kind == 'native' else None)
        result = c.strict_json(run(*command, executable, '-I', '-B', '-c', code, timeout=45))
        c.need(type(result) is dict and result.get('status') == 'COUNTED'
               and set(result) == {'status', 'counts'}, 'SAMPLER_FAILED')
        keys = (readiness.SQLITE_KEYS if kind == 'native' else
                ('voice_undelivered',) if kind == 'voice' else readiness.POSTGRES_KEYS)
        c.need(type(result['counts']) is dict and set(result['counts']) == set(keys)
               and all(type(n) is int and n >= 0 for n in result['counts'].values()), 'SAMPLER_SCHEMA')
        c.need(tool_hash() == self.tool_pin, 'ACTIVATION_SOURCE_CHANGED')
        self.unit_files_unchanged(descriptor)
        return result['counts']

    def check_plan(self, planned):
        package(self.builder, self.bundle, self.prepared_hash)
        c.need(planned['before'] == self.capture(), 'LIVE_CAS_CHANGED')
        desired = self.private_inputs()
        c.need(planned['desired_hashes'] == {k: c.digest(v) for k, v in desired.items()}, 'DESIRED_CONFIG_CHANGED')
        c.need(planned['target_commands'] == self.target_commands, 'DESIRED_COMMAND_CHANGED')
        self.desired = desired
        return self.counts()

    def record(self, name, value):
        # Immutable events: a failed/partial attempt is never silently reused.
        write_new(self.attempt/(name+'.json'), c.encoded(value))

    def _intent(self):
        # Persist a distinct immutable checkpoint before each state mutation.
        self.record('EVENT-'+str(self.event).zfill(4), self.intent)
        self.event += 1

    def backup(self, planned):
        self.event = 0
        self.intent['before'] = deepcopy(planned['before']['components'])
        self.intent['ours'] = deepcopy(self.intent['before'])
        folder = self.attempt/'private'
        folder.mkdir(mode=0o700)
        fsync_dir(self.attempt)
        for name, raw in self.private_before.items():
            write_new(folder/name, raw)
        self.record('STARTED', {'activation_plan_sha256': c.digest(c.encoded(planned)),
                                'nonce': self.nonce, 'admission_possible': False})
        self._intent()

    def _stage(self, path, *, raw=None, target=None, mode=0o644, owner=None):
        staged = path.with_name('.'+path.name+'.r15-new-'+self.nonce+'-'+os.urandom(4).hex())
        c.need(path_state(staged) is None, 'STAGED_PATH_EXISTS')
        if raw is not None:
            write_new(staged, raw, mode, owner)
        else:
            staged.symlink_to(target)
            fsync_dir(staged.parent)
        return staged, path_state(staged)

    def change(self, name, raw=None, target=None):
        if getattr(self, 'pre_admission_writes', False):
            self.require_fences()
        path = self.components[name]
        before = self.intent['ours'][name]
        c.need(path_state(path) == before, 'COMPONENT_CHANGED')
        mode = before['mode'] if before is not None and before['kind'] == 'file' else 0o644
        owner = (before['uid'], before['gid']) if before is not None else (0, 0)
        staged, state = self._stage(path, raw=raw, target=target, mode=mode, owner=owner)
        self.intent['source_mutation_started'] = True
        self.intent['ours'][name] = state
        self._intent()  # exact staged inode retained even if publish fails later
        if getattr(self, 'pre_admission_writes', False):
            self.require_fences()
        replace_managed(path, staged, before, state, nonce=self.nonce)

    def fence(self, role):
        unit = c.UNITS[role]
        fence_environment()
        if not os.path.lexists(c.FENCE_ROOT):
            secure_dir(c.FENCE_ROOT.parent)
            c.FENCE_ROOT.mkdir(mode=0o755)
            fd = os.open(c.FENCE_ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                info = os.fstat(fd)
                c.need(info.st_uid == OWNER_UID, 'FENCE_DIRECTORY_OWNER')
                os.fchmod(fd, 0o755)
                os.fsync(fd)
                self.intent['fence_directory'] = {'path': str(c.FENCE_ROOT),
                    'device': str(info.st_dev), 'inode': str(info.st_ino), 'created_by_attempt': True}
                self._intent()
            finally:
                os.close(fd)
            fsync_dir(c.FENCE_ROOT.parent)
        secure_dir(c.FENCE_ROOT)
        path = c.FENCE_ROOT/unit
        c.need(path_state(path) is None, 'EXISTING_ADMISSION_MASK')
        staged, state = self._stage(path, target='/dev/null')
        self.intent['fences'][role] = state
        self._intent()
        replace_managed(path, staged, None, state, nonce=self.nonce)
        run('systemctl', 'daemon-reload')
        c.need(prop(unit, 'LoadState') == 'masked', 'ADMISSION_FENCE_FAILED')

    def stop(self, role):
        unit = c.UNITS[role]
        run('systemctl', '--no-block', 'stop', unit)
        deadline = time.monotonic()+45
        while prop(unit, 'ActiveState') not in ('inactive', 'failed'):
            c.need(time.monotonic() < deadline, 'SERVICE_STOP_UNRESOLVED')
            time.sleep(.2)
        c.need(prop(unit, 'MainPID') == '0' and prop(unit, 'ControlPID') == '0', 'SERVICE_STILL_RUNNING')
        group = prop(unit, 'ControlGroup')
        if group:
            c.need(group.startswith('/') and '..' not in Path(group).parts, 'CGROUP_SHAPE')
            events = Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.events'
            if events.exists():
                c.need('populated 0' in events.read_text().splitlines(), 'SERVICE_CGROUP_POPULATED')

    def require_fences(self):
        fence_environment()
        for role in c.STOP_ORDER:
            unit = c.UNITS[role]
            c.need(path_state(c.FENCE_ROOT/unit) == self.intent['fences'][role]
                   and prop(unit, 'LoadState') == 'masked'
                   and prop(unit, 'ActiveState') in ('inactive', 'failed')
                   and prop(unit, 'MainPID') == '0', 'ADMISSION_FENCE_LOST')

    def verify_frozen(self, planned):
        self.require_fences()
        self.protected(planned)
        for name, expected in self.intent['ours'].items():
            c.need(path_state(self.components[name]) == expected, 'COMPONENT_CHANGED')
        for old in planned['before']['units'].values():
            self.unit_files_unchanged(old)
        self.verify_publications(planned)

    def component_state(self, name):
        return path_state(self.components[name])

    def reload(self):
        run('systemctl', 'daemon-reload')

    def unit_files_unchanged(self, old):
        c.need(all(c.digest(regular(Path(p))) == h for p, h in old['source_hashes'].items())
               and all(metadata(Path(p)) == info for p, info in old['environment_stats'].items()),
               'UNIT_SOURCE_CHANGED_DURING_DRAIN')

    def sync_check(self):
        self.helper_guard()
        result = c.strict_json(run('/usr/bin/python3', '-I', '-B', str(HERE/c.VERSION_SYNC_FILE),
                                   '--source', str(self.targets['native']), '--check',
                                   '--lock-fd', str(self.lock_stream.fileno()),
                                   pass_fds=(self.lock_stream.fileno(),)))
        c.need(result.get('status') in ('UPDATE_REQUIRED', 'UNCHANGED'), 'VERSION_CHECK_FAILED')
        c.need(self.expected_versions(self.targets['native']) == self.desired['versions'],
               'VERSION_CALCULATION_CHANGED')

    def admission_marker(self):
        # Disk or fsync failure here must prevent the FIRST new process start.
        if getattr(self, 'pre_admission_writes', False):
            self.require_fences()
        self.record('ADMISSION_POSSIBLE', {'source_commit': c.PRODUCT,
                                         'automatic_downgrade_supported': False})
        self.intent['admission_possible'] = True

    def release(self, role):
        fence_environment()
        path = c.FENCE_ROOT/c.UNITS[role]
        expected = self.intent['fences'].get(role)
        if expected is None:
            c.need(path_state(path) is None, 'FOREIGN_ADMISSION_FENCE')
            return
        c.need(path_state(path) == expected, 'ADMISSION_FENCE_LOST')
        replace_managed(path, None, expected, None, nonce=self.nonce)
        run('systemctl', 'daemon-reload')

    def start(self, role):
        run('systemctl', 'start', c.UNITS[role])

    def expected_unit(self, role, planned, *, old=False):
        expected = deepcopy(planned['before']['units'][role])
        if role in ('platform', 'authority') and not old:
            base, target = self.baseline['bases'][role]['root'], str(self.targets[role])
            expected['WorkingDirectory'] = expected['WorkingDirectory'].replace(base, target)
            expected['command'] = planned['target_commands'][role]
            expected['DropInPaths'] += ' '+str(c.SELECTORS[role])
            expected['source_hashes'][str(c.SELECTORS[role])] = c.digest(self.desired[role+'_selector'])
            expected['EnvironmentFiles'] += '\n'+str(c.FLAG_FILE)+' (ignore_errors=no)'
            expected['environment_stats'][str(c.FLAG_FILE)] = metadata(c.FLAG_FILE)
        return expected

    def validate_start(self, role, planned, *, old=False):
        self.unit_files_unchanged(planned['before']['units'][role])
        c.need(unit_static(c.UNITS[role]) == self.expected_unit(role, planned, old=old),
               'START_UNIT_CHANGED')

    def refresh(self, *, old=False):
        self.helper_guard()
        expected_states = {name: self.intent['ours'][name] for name in ('projection', 'config')}
        pair, module, current, config, states = self._projection_inputs(expected_states)
        c.need(current == self.old_projection and states['projection'] == self.intent['ours']['projection'],
               'PROJECTION_RACE')
        root = Path(self.baseline['bases']['native']['root']) if old else self.targets['native']
        generation = pair.wait_native_generation(module, self.old_projection['native_generation']['uid'])
        data = deepcopy(self.old_projection)
        data['native_generation'] = generation
        key = bytes.fromhex(data['mac_key'])
        names = [row['credential_name'] for row in data['bindings']]
        # The descriptor is NEW-generation material. The previous proof MUST
        # still use the OLD generation, exactly as the accepted helper does.
        with NativeCredentialView(module, pair, generation, root, config, names) as view:
            for row in data['bindings']:
                material = view.read(row['credential_name'])
                previous = module.native_context(config, material, row,
                    environment=data['environment'], product_id=data['product_id'],
                    generation=self.old_projection['native_generation'])
                c.need(module.hmac.compare_digest(module.mac(key, 'native-owner-source-v1', previous),
                                                  row['source_hmac']), 'OWNER_PAIR_CHANGED_DURING_RESTART')
                context = module.native_context(config, material, row,
                    environment=data['environment'], product_id=data['product_id'], generation=generation)
                row['source_hmac'] = module.mac(key, 'native-owner-source-v1', context)
            c.need(states == {'projection': path_state(c.PROJECTION), 'config': path_state(c.CONFIG)},
                   'PROJECTION_INPUTS_MOVED')
            view.check()  # before publication, not merely after the helper returns
            self.change('projection', raw=(json.dumps(data, indent=2)+'\n').encode())
            c.need(path_state(c.CONFIG) == states['config'], 'PROJECTION_INPUTS_MOVED')
        # No old descriptor survives the restart or the independent readback.
        run('systemctl', 'restart', c.CHECKER_UNIT)
        self.projection_data(root, expected_states={name: self.intent['ours'][name]
                                                  for name in ('projection', 'config')})

    def verify_publications(self, planned):
        for role, entry in planned['published'].items():
            path = self.targets[role]
            info = path.lstat()
            c.need(stat.S_ISDIR(info.st_mode) and str(info.st_dev) == entry['device']
                   and str(info.st_ino) == entry['inode'], 'PUBLISHED_INODE_CHANGED')
            verify_target(self.builder, path, entry['manifest_sha256'], role, self.prepared)

    def protected(self, planned):
        before = planned['before']
        c.need(path_state(c.WEB_LINK) == before['web_pointer']
               and c.digest(regular(Path(self.baseline['publisher']['path']))) == before['publisher'],
               'PRESERVED_COMPONENT_CHANGED')
        for unit, old in before['others'].items():
            c.need(unit_static(unit) == old['static'] and prop(unit, 'MainPID') == old['pid']
                   and prop(unit, 'InvocationID') == old['invocation'], 'UNRELATED_SERVICE_CHANGED')
        c.need(unit_static(c.CHECKER_UNIT) == before['checker_static'], 'CHECKER_SOURCE_CHANGED')
        self.helper_guard()

    def ready(self, role, planned, *, old=False):
        deadline = time.monotonic()+20
        while True:
            try:
                return self._ready_once(role, planned, old=old)
            except (c.Blocked, OSError, ValueError):
                c.need(time.monotonic() < deadline, 'ROLE_NOT_READY')
                time.sleep(.25)

    def _ready_once(self, role, planned, *, old=False):
        target = (self.targets[role] if role in c.ROLES and not old
                  else Path(self.baseline['bases'][role]['root']))
        descriptor = self.baseline['live_references']['services'][role]
        unit = c.UNITS[role]
        pid = prop(unit, 'MainPID')
        c.need(prop(unit, 'ActiveState') == 'active' and prop(unit, 'SubState') == 'running'
               and pid.isdecimal() and int(pid) > 0
               and Path(prop(unit, 'WorkingDirectory')).resolve(strict=True) == target/descriptor['unit_cwd_suffix']
               and (Path('/proc')/pid/'cwd').resolve(strict=True) == target/descriptor['process_cwd_suffix'],
               'ROLE_PROCESS_MISMATCH')
        if role == 'native':
            # refresh() additionally binds socket SO_PEERCRED to this generation.
            return
        if role in ('platform', 'authority') and not old:
            self.process_flags(pid)
        if role == 'authority':
            response = run('curl', '--silent', '--show-error', '--fail', '--max-time', '3',
                           '--unix-socket', '/run/alisa-runtime-rpc/authority/authority.sock',
                           'http://localhost/health/ready')
        else:
            port = 18102 if role == 'platform' else 18100
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open('http://127.0.0.1:'+str(port)+'/health/ready', timeout=3) as reply:
                c.need(reply.status == 200, 'HEALTH_FAILED')
                response = reply.read(8193)
        c.need(len(response) <= 8192 and c.strict_json(response).get('release') == target.name,
               'HEALTH_RELEASE_MISMATCH')

    def process_flags(self, pid):
        # Only these two values are compared. All other entries remain private
        # memory and are neither returned nor logged; no session/token is used.
        directory = Path('/proc')/pid
        before = (directory/'stat').read_bytes()
        fd = os.open(directory/'environ', os.O_RDONLY | os.O_NOFOLLOW)
        try:
            raw = os.read(fd, 1024*1024+1)
        finally:
            os.close(fd)
        c.need(len(raw) <= 1024*1024, 'PROCESS_ENVIRONMENT_BOUND')
        selected = {flag.encode(): [] for flag in c.FLAGS}
        for item in raw.split(b'\0'):
            key, _, value = item.partition(b'=')
            if key in selected:
                selected[key].append(value)
        c.need(all(values == [b'1'] for values in selected.values()), 'FEATURE_FLAGS_NOT_ENABLED')
        # /proc/stat contains volatile counters; pin PID start_ticks (field22),
        # not a whole-file comparison. A dying/reused process fails closed.
        def generation(data):
            return data.rsplit(b') ', 1)[1].split()[19]
        c.need(generation(before) == generation((directory/'stat').read_bytes()), 'PROCESS_GENERATION_CHANGED')

    def post_switch(self, planned):
        # Deliberately not builder.verify_prepared(): OLD live references have
        # changed. Validate immutable payload and every exact NEW coordinate.
        self.verify_publications(planned)
        self.protected(planned)
        for name, expected in self.intent['ours'].items():
            c.need(path_state(self.components[name]) == expected, 'POST_SWITCH_COMPONENT_CHANGED')
        for role, old in planned['before']['units'].items():
            if role == 'web' and prop(c.UNITS[role], 'LoadState') == 'masked':
                c.need(path_state(c.FENCE_ROOT/c.UNITS[role]) == self.intent['fences'][role],
                       'ADMISSION_FENCE_LOST')
                self.unit_files_unchanged(old)
                continue
            c.need(unit_static(c.UNITS[role]) == self.expected_unit(role, planned), 'POST_SWITCH_UNIT_CHANGED')
        self.projection_data(self.targets['native'], expected_states={name: self.intent['ours'][name]
                                                                     for name in ('projection', 'config')})
        reserve(roots=tuple(p.parent for p in self.targets.values()))

    def recover_pre_admission(self, planned):
        """Best-effort independent restoration; receipt failure cannot stop it."""
        failures, restored = [], {}
        def attempt(label, operation):
            try:
                operation()
                return True
            except BaseException:
                failures.append(label)
                return False
        if self.intent.get('source_mutation_started'):
            # A foreign unmask/start is an admission possibility even if OUR
            # marker/start was never reached. No downgrade under that process.
            try:
                self.require_fences()
            except BaseException:
                attempt('receipt_blocked', lambda: self.record('RECOVERY_BLOCKED',
                                                               c.public_result('RECOVERY_REQUIRES_REVIEW')))
                return 'RECOVERY_REQUIRES_REVIEW'
        attempt('receipt_start', lambda: self.record('RECOVERY_STARTED', {'phase': 'PRE_ADMISSION'}))
        for name, path in self.components.items():
            before, ours = self.intent['before'][name], self.intent['ours'][name]
            def restore(name=name, path=path, before=before, ours=ours):
                if self.intent.get('source_mutation_started'):
                    self.require_fences()
                actual = path_state(path)
                if actual == before:
                    return
                held = path.with_name('.'+path.name+'.r15-held-'+self.nonce)
                if before is not None and path_state(held) == before:
                    c.need(actual in (None, ours), 'RECOVERY_LATER_WRITER')
                    if actual is None:
                        noreplace(held, path)
                    else:
                        replace_managed(path, held, actual, before, nonce=self.nonce+'-recover')
                    self.intent['ours'][name] = before
                    return
                c.need(actual == ours, 'RECOVERY_LATER_WRITER')
                if before is None:
                    replace_managed(path, None, actual, None, nonce=self.nonce)
                else:
                    raw = self.private_before[name] if before['kind'] == 'file' else None
                    staged, staged_state = self._stage(path, raw=raw,
                        target=before['content'] if raw is None else None,
                        mode=before['mode'], owner=(before['uid'], before['gid']))
                    replace_managed(path, staged, actual, staged_state, nonce=self.nonce)
                    self.intent['ours'][name] = staged_state
            restored[name] = attempt(name, restore)
        reload_ok = attempt('reload', lambda: run('systemctl', 'daemon-reload'))
        # All config restoration is finished. Only the accepted projection
        # generation refresh may now publish after the OLD native is restarted.
        self.pre_admission_writes = False
        def restart_old(role):
            self.unit_files_unchanged(planned['before']['units'][role])
            self.release(role)
            self.validate_start(role, planned, old=True)
            self.start(role)
            self.ready(role, planned, old=True)
        native_ok = reload_ok and all(restored.get(k) for k in ('config', 'versions', 'projection', 'native_pointer'))
        if native_ok:
            native_ok = attempt('restart_native', lambda: restart_old('native'))
            if native_ok:
                # Restarting the OLD source also changes PID generation. Its
                # existing source HMAC must still hold before refreshing.
                native_ok = attempt('refresh_old_generation', lambda: self.refresh(old=True))
        service_ok = {'native': native_ok}
        for role in ('authority', 'platform'):
            safe = native_ok and restored.get(role+'_selector') and restored.get('flags') and reload_ok
            service_ok[role] = bool(safe and attempt('restart_'+role, lambda role=role: restart_old(role)))
        if all(service_ok.values()) and attempt('protected', lambda: self.protected(planned)):
            attempt('restart_web', lambda: restart_old('web'))
        else:
            failures.append('unsafe_restart_skipped')
        status = 'PRE_ADMISSION_RECOVERY_INCOMPLETE' if failures else 'PRE_ADMISSION_RESTORED'
        attempt('receipt_final', lambda: self.record('RECOVERY_FINISHED', {'status': status,
                                                                         'failed_components': failures}))
        if failures:
            status = 'PRE_ADMISSION_RECOVERY_INCOMPLETE'
        return status


def apply(host, planned, coordination, *, plan_hash, tool_pin, now=None):
    """Phase machine also used by fault tests; real CLI always uses LiveHost."""
    def window_current():
        c.window(coordination, plan_hash=plan_hash, tool_hash=tool_pin,
                 prepared_hash=host.prepared_hash, now=time.time() if now is None else now)
    window_current()
    host.check_plan(planned)
    window_current()
    host.backup(planned)
    entered, admission = False, False
    try:
        # All masks are owned and verified before any stop. Existing masks fail.
        entered = True
        for role in c.STOP_ORDER:
            host.fence(role)
        for role in c.STOP_ORDER:
            host.stop(role)
        host.counts()  # final racing admission must block before ANY selector
        host.verify_frozen(planned)
        window_current()
        host.pre_admission_writes = True
        for name in ('flags', 'platform_selector', 'authority_selector', 'config'):
            host.change(name, raw=host.desired[name])
        host.change('native_pointer', target=str(host.targets['native']))
        host.sync_check()
        # Candidate/config/source can change after the sync subprocess exits.
        host.verify_publications(planned)
        host.protected(planned)
        for name, expected in host.intent['ours'].items():
            c.need(host.component_state(name) == expected, 'PRE_VERSION_CAS_CHANGED')
        host.change('versions', raw=host.desired['versions'])
        host.reload()
        window_current()
        host.require_fences()
        host.admission_marker()  # durable before unmask/start, including failure paths
        admission = True
        host.pre_admission_writes = False
        for role in c.START_ORDER:
            host.release(role)
            host.validate_start(role, planned)
            host.start(role)
            host.ready(role, planned)
            if role == 'native':
                host.refresh()
            if role == 'platform':
                host.post_switch(planned)  # web remains fenced
        host.post_switch(planned)
        host.record('ACTIVATED', c.public_result('INSTALLED_TECHNICAL_CHECKS_PASS'))
        return c.public_result('INSTALLED_TECHNICAL_CHECKS_PASS')
    except BaseException:
        if admission or host.intent.get('admission_possible'):
            try:
                host.counts()
                status = c.rollback_disposition(admission_possible=True, idle=True)
            except readiness.Blocked as error:
                status = ('ROLLBACK_BLOCKED_BUSY' if error.code == 'READINESS_BUSY'
                          else 'RECOVERY_REQUIRES_REVIEW')
            except BaseException:
                status = 'RECOVERY_REQUIRES_REVIEW'
            # Never stop/revert a new native/backend, even when samples are zero.
            try:
                host.record('RECOVERY_BLOCKED', c.public_result(status))
            except BaseException:
                pass
            return c.public_result(status)
        if entered:
            return c.public_result(host.recover_pre_admission(planned))
        raise


def sampler_main(kind, platform_root, expected_tool, config_state=None):
    """Internal subprocess entry, no CLI route and no fixture switch."""
    try:
        c.need(tool_hash() == expected_tool and os.geteuid() != 0, 'SAMPLER_SOURCE')
        if kind == 'native':
            # The native service identity reads its own config in memory; only
            # its exact DB paths are consumed. No values reach stdout.
            c.need(path_state(c.CONFIG) == config_state, 'SAMPLER_CONFIG_CHANGED')
            config = c.strict_json(regular(c.CONFIG))
            state_db = config['database']
            c.need(c.absolute(state_db), 'SAMPLER_DATABASE_PATH')
            gap_db = Path(state_db).with_name('template-gaps.sqlite3')
            counts = readiness.sqlite_counts(state_db, gap_db)
            c.need(path_state(c.CONFIG) == config_state, 'SAMPLER_CONFIG_CHANGED')
        elif kind == 'voice':
            counts = readiness.voice_count(c.STATION)
        else:
            c.need(kind == 'postgres' and os.environ.get('PGOPTIONS') == c.PGOPTIONS
                   and os.environ.get('ALISA_ENV') == 'stage'
                   and os.environ.get('ALISA_DB_USER') == readiness.DB_ROLE
                   and os.environ.get('ALISA_DB_NAME') == readiness.DB_NAME, 'SAMPLER_DATABASE_SCOPE')
            os.environ['DJANGO_SETTINGS_MODULE'] = 'alisa_platform.config.settings'
            sys.path.insert(0, str(Path(platform_root)/'services/platform/src'))
            import django
            django.setup()
            from django.db import connection
            try:
                counts = readiness.postgres_counts(connection)
            finally:
                connection.close()
        result = {'status': 'COUNTED', 'counts': counts}
        c.need(tool_hash() == expected_tool, 'SAMPLER_SOURCE_CHANGED')
    except BaseException:
        result = {'status': 'BLOCKED'}
    print(json.dumps(result, sort_keys=True))


def sampler_code(kind, root, expected_tool, config_state=None):
    """Isolated child bootstraps all four verified source bytes, never .pyc."""
    # No credentials or environment values are embedded in this command.
    return ('import sys,os,json,hashlib;from pathlib import Path;'
            'p=Path('+repr(str(HERE))+');names='+repr(c.TOOL_FILES)+';b={};'
            '\nfor n in names:\n'
            ' f=os.open(p/n,os.O_RDONLY|os.O_NOFOLLOW);s=os.fstat(f);'
            'data=os.read(f,2097153);os.close(f);'
            '\n if len(data)!=s.st_size or len(data)>2097152:raise SystemExit("SAMPLER_SOURCE")\n'
            ' b[n]=data\n'
            'index={n:hashlib.sha256(v).hexdigest() for n,v in b.items()};'
            'h=hashlib.sha256((json.dumps(index,sort_keys=True,ensure_ascii=False,indent=2)+"\\n").encode()).hexdigest();'
            '\nif h!='+repr(expected_tool)+':raise SystemExit("SAMPLER_SOURCE")\n'
            'scope={"__name__":"r15_verified_sampler","__file__":str(p/"activate.py"),'
            '"__r15_verified_tool_bytes__":b};'
            'exec(compile(b["activate.py"],str(p/"activate.py"),"exec"),scope);'
            'scope["sampler_main"]('+repr(kind)+','+repr(root)+','+repr(expected_tool)+','+repr(config_state)+')')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=('plan', 'prepare', 'apply'))
    parser.add_argument('--builder', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--prepared-sha256', required=True)
    parser.add_argument('--tool-sha256', required=True)
    parser.add_argument('--attempt', type=Path, required=True)
    parser.add_argument('--activation-plan-sha256')
    parser.add_argument('--coordination', type=Path)
    parser.add_argument('--coordination-sha256')
    args = parser.parse_args()
    try:
        c.need(os.geteuid() == 0 and sys.flags.isolated == 1 and sys.dont_write_bytecode
               and tool_hash() == args.tool_sha256, 'TOOL_IDENTITY')
        public_tool_directory(args.tool_sha256)
        c.need(c.absolute(str(args.attempt)) and args.attempt.parent == Path('/root')
               and re.fullmatch('alisa-r15-activation-1964d60f-[0-9a-f]{16}', args.attempt.name),
               'ATTEMPT_SCOPE')
        builder = builder_at(args.builder)
        with lock() as stream:
            host = LiveHost(builder, args.bundle, args.prepared_sha256, args.attempt, stream)
            if args.command in ('plan', 'prepare'):
                c.need(not os.path.lexists(args.attempt), 'ATTEMPT_ALREADY_EXISTS')
                before = host.capture()
                desired = host.private_inputs()
                counts = host.counts()
                sizes, entries = 0, 0
                for role in c.ROLES:
                    m, size = builder.verify_manifest(args.bundle/'releases'/role,
                                                      host.prepared['candidates'][role]['manifest_sha256'])
                    sizes += size
                    entries += 2*(len(m['files'])+len(m.get('links', {}))+8)
                estimate = sizes+entries*8192+8*1024**2
                value = {'schema': 'alisa-r15-activation-plan/v1', 'source_commit': c.PRODUCT,
                         'tool_sha256': args.tool_sha256, 'prepared_sha256': args.prepared_sha256,
                         'bundle': str(args.bundle), 'builder': str(args.builder), 'before': before,
                         'desired_hashes': {k: c.digest(v) for k, v in desired.items()},
                         'target_commands': host.target_commands,
                         'counts_at_plan': counts, 'required_bytes': estimate, 'required_inodes': entries,
                         'published': {}, 'status': 'ACTIVATION_PLAN_NOT_APPLIED'}
                if args.command == 'prepare':
                    reserve(estimate, entries, tuple(p.parent for p in host.targets.values()))
                    args.attempt.mkdir(mode=0o700)
                    fsync_dir(args.attempt.parent)
                    host.record('PREPARING', value)
                    for role in c.ROLES:
                        value['published'][role] = publish_role(builder, args.bundle/'releases'/role,
                            host.targets[role], role, host.prepared,
                            on_stage=lambda receipt, role=role: host.record('PUBLICATION-'+role, receipt))
                    # Recheck actual bundle and complete OLD source CAS after copy.
                    package(builder, args.bundle, args.prepared_sha256)
                    c.need(host.capture() == before, 'BASE_CHANGED_DURING_PREPARE')
                    reserve(roots=tuple(p.parent for p in host.targets.values()))
                    host.record('ACTIVATION_PLAN', value)
                print(c.encoded(value).decode(), end='')
                return 0
            secure_dir(args.attempt)
            c.need(not os.path.lexists(args.attempt/'STARTED.json'), 'ATTEMPT_ALREADY_STARTED')
            raw = regular(args.attempt/'ACTIVATION_PLAN.json')
            c.need(c.is_hash(args.activation_plan_sha256) and c.digest(raw) == args.activation_plan_sha256,
                   'ACTIVATION_PLAN_CHANGED')
            planned = c.strict_json(raw)
            c.need(planned.get('schema') == 'alisa-r15-activation-plan/v1'
                   and planned.get('tool_sha256') == args.tool_sha256
                   and planned.get('prepared_sha256') == args.prepared_sha256
                   and planned.get('bundle') == str(args.bundle)
                   and planned.get('builder') == str(args.builder)
                   and set(planned.get('published', {})) == set(c.ROLES), 'ACTIVATION_PLAN_BINDING')
            host.verify_publications(planned)
            coordination_raw = regular(args.coordination)
            c.need(c.is_hash(args.coordination_sha256) and c.digest(coordination_raw) == args.coordination_sha256,
                   'COORDINATION_CHANGED')
            result = apply(host, planned, c.strict_json(coordination_raw),
                           plan_hash=args.activation_plan_sha256, tool_pin=args.tool_sha256)
            print(c.encoded(result).decode(), end='')
            return 0 if result['status'] == 'INSTALLED_TECHNICAL_CHECKS_PASS' else 2
    except BaseException as error:
        code = error.code if isinstance(error, (c.Blocked, readiness.Blocked)) else 'ACTIVATION_DEPENDENCY_UNAVAILABLE'
        print(c.encoded(c.public_result('BLOCKED', code=code)).decode(), end='')
        return 2


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, lambda *_: c.need(False, 'INTERRUPTED'))
    raise SystemExit(main())
