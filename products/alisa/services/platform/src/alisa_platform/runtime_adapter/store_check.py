"""RT-CHECK client only. Never submits a report or talks to provider HTTP."""
import json
import os
import socket
import stat
import struct
import time
from pathlib import Path
from django.conf import settings

VERSION = 'rt_check_v1'
LIMIT = 32768
CODES = {'CONNECTED', 'AUTH_DENIED', 'SCOPE_MISSING', 'TIMEOUT', 'RATE_LIMITED',
         'CHECK_UNAVAILABLE', 'PROVIDER_UNAVAILABLE', 'IDENTITY_NOT_VERIFIED', 'UNKNOWN_OUTCOME', 'PROVIDER_PLAN_REQUIRED', 'AUTHENTICATED_UNLINKED'}


def strict_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError()
        value[key] = item
    return value


def invalid_number(value):
    raise ValueError()


def check_store(pins, credential):
    path = settings.STORE_CHECK_SOCKET
    if not path:
        return {'code': 'CHECK_UNAVAILABLE'}
    try:
        if not hasattr(socket, 'SO_PEERCRED'):
            raise ValueError()
        info = os.lstat(path)
        if not stat.S_ISSOCK(info.st_mode) or info.st_uid != settings.STORE_CHECK_UID:
            raise ValueError()
        parent = os.lstat(str(Path(path).parent))
        if not stat.S_ISDIR(parent.st_mode) or parent.st_uid not in {0, settings.STORE_CHECK_UID} or parent.st_mode & 0o022:
            raise ValueError()
        message = {'schema_version': VERSION, 'operation': 'check_store', 'pins': pins, 'credential': credential}
        raw = json.dumps(message, separators=(',', ':'), allow_nan=False).encode()+b'\n'
        if len(raw) > LIMIT:
            raise ValueError()
        deadline = time.monotonic()+3.0
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as peer:
            peer.settimeout(3.0); peer.connect(path)
            _, uid, _ = struct.unpack('3i', peer.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            if uid != settings.STORE_CHECK_UID:
                raise ValueError()
            peer.sendall(raw)
            data = bytearray()
            while not data.endswith(b'\n'):
                peer.settimeout(max(.001, deadline-time.monotonic()))
                part = peer.recv(min(4096, LIMIT+1-len(data)))
                if not part or len(data)+len(part) > LIMIT or time.monotonic() >= deadline:
                    raise ValueError()
                data.extend(part)
        value = json.loads(data, object_pairs_hook=strict_object, parse_constant=invalid_number)
        if (not isinstance(value, dict) or set(value) != {'schema_version', 'pins', 'result'}
                or value['schema_version'] != VERSION or json.dumps(value['pins'], sort_keys=True) != json.dumps(pins, sort_keys=True)):
            raise ValueError()
        result = value['result']
        if not isinstance(result, dict) or result.get('code') not in CODES:
            raise ValueError()
        if result['code'] == 'AUTHENTICATED_UNLINKED' and pins['kind'] != 'PERFORMANCE':
            raise ValueError()
        if result['code'] == 'CONNECTED':
            fields = {'code', 'identity', 'capabilities'}
            if 'identity_provenance' in result:
                if pins['kind'] != 'PERFORMANCE' or result['identity_provenance'] != 'NATIVE_OWNER_CONFIGURED_PAIR':
                    raise ValueError()
                fields.add('identity_provenance')
            if set(result) != fields:
                raise ValueError()
            identity = result['identity']
            if (not isinstance(identity, str) or not 1 <= len(identity) <= 160
                    or any(not (c.isascii() and (c.isalnum() or c in ':_-')) for c in identity)
                    or result['capabilities'] != [pins['kind']]):
                raise ValueError()
            return result
        if set(result) != {'code'}:
            raise ValueError()
        return result
    except (TimeoutError, socket.timeout):
        return {'code': 'TIMEOUT'}
    except (OSError, ValueError, KeyError, TypeError, UnicodeError):
        return {'code': 'CHECK_UNAVAILABLE'}
