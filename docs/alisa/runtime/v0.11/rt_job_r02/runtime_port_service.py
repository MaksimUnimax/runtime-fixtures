"""Explicit opt-in attachment to the already configured Engine and its Worker."""
import os
from pathlib import Path
import pwd
import re
import stat
import struct
from semantics import Rejected
from platform_authority_client import PlatformAuthorityClient
from runtime_port import RuntimePort
from runtime_port_ipc import Gateway

FIELDS = {'enabled', 'socket', 'allowed_user', 'service_id', 'catalog_release_id',
          'authority_socket', 'authority_user', 'authority_credential'}


def private_credential(path):
    """Accept owner-only files and the exact read-only systemd per-user ACL.

    In systemd's credential mount, 0440 includes the ACL mask, while the owning
    group has no access. Only root and this service UID can read that file.
    """
    try:
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.getuid()}
            or info.st_size > 257): return False
        if not info.st_mode & 0o077: return True
        if (info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o440
            or os.getuid() == 0 or path.parent.parent != Path('/run/credentials')
            or not os.statvfs(path).f_flag & os.ST_RDONLY): return False
        for parent in path.parents:
            metadata = parent.lstat()
            if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0
                or metadata.st_mode & 0o022): return False
        nobody = 0xffffffff
        entries = [(1, 4, nobody), (2, 4, os.getuid()), (4, 0, nobody),
                   (16, 4, nobody), (32, 0, nobody)]
        expected = struct.pack('<I', 2) + b''.join(struct.pack('<HHI', *row) for row in entries)
        return os.getxattr(path, 'system.posix_acl_access') == expected
    except (OSError, ValueError, TypeError):
        return False


def validate(configuration):
    value = configuration.get('runtime_port')
    if value is None or type(value) is dict and set(value)=={'enabled'} and value['enabled'] is False:return None
    if type(value) is not dict or set(value) != FIELDS or value.get('enabled') is not True:
        raise Rejected('RUNTIME_PORT_CONFIG')
    for name in ('socket', 'authority_socket'):
        path = value[name]
        if (type(path) is not str or not Path(path).is_absolute() or len(path.encode()) > 107
            or '\x00' in path or '..' in Path(path).parts):raise Rejected('RUNTIME_PORT_CONFIG')
    if value['socket'] == value['authority_socket'] or value['socket'] == configuration.get('socket'):
        raise Rejected('RUNTIME_PORT_CONFIG')
    for name in ('allowed_user', 'authority_user', 'authority_credential', 'service_id', 'catalog_release_id'):
        if type(value[name]) is not str or re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value[name]) is None:
            raise Rejected('RUNTIME_PORT_CONFIG')
    credential = value['authority_credential']
    if credential in {'.', '..', 'deepseek', *configuration.get('credential_bindings', {}).values()}:
        raise Rejected('RUNTIME_PORT_CONFIG')
    return dict(value)


def attach(engine, configuration, credentials_directory):
    value = validate(configuration)
    if value is None: return None
    path = Path(value['socket'])
    # The operator creates the private parent; startup never repairs permissions
    # or overwrites an existing socket to make an invalid configuration pass.
    parent = path.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid not in {0, os.getuid()}
        or parent.st_mode & 0o022):raise Rejected('RUNTIME_PORT_CONFIG')
    credential = Path(credentials_directory) / value['authority_credential']
    if not private_credential(credential):raise Rejected('RUNTIME_PORT_CONFIG')
    authority = PlatformAuthorityClient(value['authority_socket'],
        expected_uid=pwd.getpwnam(value['authority_user']).pw_uid,
        service_token=credential.read_text().strip(), service_id=value['service_id'])
    port = RuntimePort(engine, authority, service_id=value['service_id'],
                       catalog_release_id=value['catalog_release_id'])
    try:
        gateway = Gateway(str(path), port, allowed_uid=pwd.getpwnam(value['allowed_user']).pw_uid,
                          service_id=value['service_id'])
        gateway.bound_identity = (path.lstat().st_dev, path.lstat().st_ino)
        return gateway
    except BaseException:
        if engine.execution_policy is port: engine.execution_policy = None
        raise


def close(gateway):
    if gateway is None:return
    gateway.server_close()
    path = Path(gateway.server_address)
    try:
        info = path.lstat()
        if (info.st_dev, info.st_ino) == gateway.bound_identity and stat.S_ISSOCK(info.st_mode):path.unlink()
    except FileNotFoundError:pass
