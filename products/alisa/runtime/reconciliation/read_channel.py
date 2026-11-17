"""One bounded staff-read exchange; no listener, route, grant or key is installed.

OS peer identity authenticates the service, not a staff member. A server-wired
current-staff verifier is mandatory before AND after the native read. It must
independently verify ticket/request/target scope and enforce the supplied time
budget, without taking platform row locks held by the caller. The Grant object
is data, not a substitute for that verifier. No production verifier is inferred.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import struct
import time
from . import native_snapshot as native

SCHEMA = 'alisa-staff-native-read/v1'
PERMISSION = 'ops.reconcile'
MAX_REQUEST = 8192
MAX_RESPONSE = 24576
MAX_GRANT_SECONDS = 5
CODES = frozenset({'CHANNEL_INVALID','CHANNEL_UNAVAILABLE','CHANNEL_TIMEOUT',
    'PEER_REJECTED','AUTH_REQUIRED','AUTH_CHANGED','RESPONSE_MISMATCH',
    'PRODUCER_MISMATCH','SNAPSHOT_UNAVAILABLE'})


class ChannelError(Exception):
    def __init__(self, code='CHANNEL_UNAVAILABLE'):
        self.code = code if code in CODES else 'CHANNEL_UNAVAILABLE'
        super().__init__(self.code)


def require(value, code='CHANNEL_INVALID'):
    if not value:
        raise ChannelError(code)


def hash_value(value):
    require(type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None)
    return value


def ticket_value(value):
    require(type(value) is str and 1 <= len(value) <= 4096
            and value.isascii() and all(32 < ord(c) < 127 for c in value))
    return value


def number(value):
    require(type(value) in (int, float) and math.isfinite(value) and value >= 0)
    return value


def encoded(value):
    try:
        return json.dumps(value, ensure_ascii=True, sort_keys=True,
                          separators=(',', ':'), allow_nan=False).encode()
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ChannelError() from None


def decoded(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result)
            result[key] = value
        return result
    def invalid(_):
        raise ChannelError('CHANNEL_INVALID')
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs,
                          parse_constant=invalid)
    except (ValueError, TypeError, UnicodeError, RecursionError):
        raise ChannelError('CHANNEL_INVALID') from None


def producer_pin():
    # Source pin is consistency, NOT staff or peer authentication.
    return sha256(encoded({p.name:sha256(p.read_bytes()).hexdigest() for p in
        (Path(__file__), Path(native.__file__))})).hexdigest()


class Budget:
    def __init__(self, seconds, monotonic=time.monotonic):
        require(type(seconds) in (int, float) and math.isfinite(seconds)
                and .05 <= seconds <= 2)
        self.clock, self.end = monotonic, monotonic()+seconds

    def remaining(self):
        left = self.end-self.clock()
        require(left > 0, 'CHANNEL_TIMEOUT')
        return left


def peer_identity(stream, expected_uid, expected_pid=None):
    require(type(expected_uid) is int and expected_uid >= 0, 'PEER_REJECTED')
    require(hasattr(socket, 'SO_PEERCRED') and stream.family == socket.AF_UNIX,
            'PEER_REJECTED')
    pid, uid, _ = struct.unpack('3i', stream.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
    require(pid > 0 and uid == expected_uid and (expected_pid is None or
            type(expected_pid) is int and expected_pid > 0 and pid == expected_pid),
            'PEER_REJECTED')
    return pid


def receive(stream, maximum, budget):
    def exact(count):
        data = bytearray()
        while len(data) < count:
            stream.settimeout(budget.remaining())
            part = stream.recv(min(4096, count-len(data)))
            require(bool(part), 'CHANNEL_UNAVAILABLE')
            data.extend(part)
        return bytes(data)
    size = struct.unpack('!I', exact(4))[0]
    require(0 < size <= maximum)
    raw = exact(size)
    stream.settimeout(budget.remaining())
    require(stream.recv(1) == b'', 'CHANNEL_INVALID')  # one request, no suffix
    budget.remaining()
    return decoded(raw)


def send(stream, value, maximum, budget):
    raw = encoded(value)
    require(0 < len(raw) <= maximum)
    stream.settimeout(budget.remaining())
    stream.sendall(struct.pack('!I',len(raw))+raw)
    stream.shutdown(socket.SHUT_WR)
    budget.remaining()


@dataclass(frozen=True, repr=False)
class Grant:
    request_id: str
    target_sha256: str
    staff_id: str
    authority_revision: str
    scope: native.NativeScope
    issued_at: int | float
    expires_at: int | float
    permission: str = PERMISSION

    def __repr__(self):
        return '<Grant; requires independent current-staff verification>'

    def validate(self, request_id, target_sha256, now):
        require(self.permission == PERMISSION, 'AUTH_REQUIRED')
        hash_value(self.request_id);hash_value(self.target_sha256);hash_value(self.authority_revision)
        require(self.request_id == request_id and self.target_sha256 == target_sha256,
                'AUTH_REQUIRED')
        native.uuid_text(self.staff_id)
        require(type(self.scope) is native.NativeScope, 'AUTH_REQUIRED')
        self.scope.validate()
        require(number(self.issued_at) <= number(now) < number(self.expires_at)
                <= self.issued_at+MAX_GRANT_SECONDS, 'AUTH_REQUIRED')
        return self


def serve_connected(stream, *, allowed_uid, authority, database, native_uid,
                    timeout=1., clock=time.time):
    """Handle an accepted connection owned by the existing runtime lifecycle.

    authority.verify(ticket,request_id,target_sha256,remaining=...) must consult
    the real staff authority. The reader is fixed here, not supplied by JSON.
    Deadline checks cannot preempt an unbounded external verifier: its concrete
    adapter must prove its own bound before this primitive is wired to live IPC.
    """
    budget = Budget(timeout)
    request_id = target = None
    try:
        peer_identity(stream, allowed_uid)
        require(callable(getattr(authority,'verify',None)), 'AUTH_REQUIRED')
        value = receive(stream, MAX_REQUEST, budget)
        require(type(value) is dict and set(value) == {'schema','request_id','target_sha256','ticket'})
        require(value['schema'] == SCHEMA)
        request_id = hash_value(value['request_id']);target = hash_value(value['target_sha256'])
        ticket = ticket_value(value['ticket'])
        def verify():
            result = authority.verify(ticket,request_id,target,remaining=budget.remaining())
            budget.remaining()
            require(type(result) is Grant,'AUTH_REQUIRED')
            return result.validate(request_id,target,clock())
        before = verify()
        require(budget.remaining() >= .05,'CHANNEL_TIMEOUT')
        snapshot = native.read_snapshot(database,before.scope,expected_uid=native_uid,
                                       timeout=min(budget.remaining(),1.),clock=clock)
        budget.remaining()
        require(verify() == before,'AUTH_CHANGED')
        answer = {'schema':SCHEMA,'request_id':request_id,'target_sha256':target,
                  'producer_sha256':producer_pin(),'ok':True,'snapshot':snapshot}
        before.validate(request_id,target,clock());budget.remaining()
        send(stream,answer,MAX_RESPONSE,budget)
        return 'SENT'
    except Exception as error:
        code = error.code if isinstance(error,ChannelError) else (
            'SNAPSHOT_UNAVAILABLE' if isinstance(error,native.SnapshotUnavailable) else
            'CHANNEL_TIMEOUT' if isinstance(error,(TimeoutError,socket.timeout)) else 'CHANNEL_UNAVAILABLE')
        try:
            send(stream,{'schema':SCHEMA,'request_id':request_id,'target_sha256':target,
                         'ok':False,'code':code},MAX_RESPONSE,budget)
        except Exception:
            pass  # no payload, credentials or exception logging
        return code


def endpoint_state(path, uid):
    require(type(path) is str and path.startswith('/') and str(Path(path)) == path)
    p = Path(path)
    require(p.resolve(strict=True) == p,'PEER_REJECTED')
    info,parent = p.lstat(),p.parent.lstat()
    require(stat.S_ISSOCK(info.st_mode) and info.st_uid == uid and not info.st_mode & 0o002
            and stat.S_ISDIR(parent.st_mode) and parent.st_uid in {0,uid}
            and not parent.st_mode & 0o022,'PEER_REJECTED')
    return tuple((s.st_dev,s.st_ino,s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode)) for s in (info,parent))


class Client:
    def __init__(self, path, *, expected_uid, expected_pid, expected_producer, timeout=1.):
        require(type(expected_uid) is int and expected_uid >= 0
                and type(expected_pid) is int and expected_pid > 0,'PEER_REJECTED')
        hash_value(expected_producer);Budget(timeout)
        self.path,self.uid,self.pid,self.pin,self.timeout = path,expected_uid,expected_pid,expected_producer,timeout

    def __repr__(self):
        return '<NativeReadClient; server-configured private endpoint>'

    def read(self, target_sha256, authorizer):
        """Authorizer.prepare/current use existing staff authority, not browser role claims."""
        budget = Budget(self.timeout)
        request_id = secrets.token_hex(32)
        target = hash_value(target_sha256)
        try:
            require(callable(getattr(authorizer,'prepare',None)) and
                    callable(getattr(authorizer,'current',None)),'AUTH_REQUIRED')
            ticket = ticket_value(authorizer.prepare(request_id,target,remaining=budget.remaining()))
            def current():
                require(authorizer.current(ticket,request_id,target,remaining=budget.remaining()) is True,
                        'AUTH_REQUIRED')
                budget.remaining()
            current()
            identity = endpoint_state(self.path,self.uid)
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as stream:
                stream.settimeout(budget.remaining());stream.connect(self.path)
                peer_identity(stream,self.uid,self.pid)
                require(endpoint_state(self.path,self.uid) == identity,'PEER_REJECTED')
                current()
                send(stream,{'schema':SCHEMA,'request_id':request_id,'target_sha256':target,'ticket':ticket},
                     MAX_REQUEST,budget)
                value = receive(stream,MAX_RESPONSE,budget)
            require(endpoint_state(self.path,self.uid) == identity,'PEER_REJECTED')
            require(type(value) is dict and value.get('schema') == SCHEMA
                    and value.get('request_id') == request_id and value.get('target_sha256') == target
                    and type(value.get('ok')) is bool,'RESPONSE_MISMATCH')
            if value['ok'] is False:
                require(set(value) == {'schema','request_id','target_sha256','ok','code'}
                        and type(value['code']) is str and value['code'] in CODES,'RESPONSE_MISMATCH')
                raise ChannelError(value['code'])
            require(set(value) == {'schema','request_id','target_sha256','producer_sha256','ok','snapshot'},
                    'RESPONSE_MISMATCH')
            require(value['producer_sha256'] == self.pin,'PRODUCER_MISMATCH')
            current()
            # Exact native binding validation remains the assessment consumer's job.
            require(type(value['snapshot']) is dict and
                    len(encoded(value['snapshot'])) <= native.MAX_BYTES,'RESPONSE_MISMATCH')
            return value['snapshot']
        except ChannelError:
            raise
        except (TimeoutError,socket.timeout):
            raise ChannelError('CHANNEL_TIMEOUT') from None
        except Exception:
            raise ChannelError('CHANNEL_UNAVAILABLE') from None
