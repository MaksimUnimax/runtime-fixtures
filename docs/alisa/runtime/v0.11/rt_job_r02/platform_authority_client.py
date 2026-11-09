"""Runtime consumer of the private platform authority, over a pinned Unix peer.

No TCP, DNS, redirects, token issuer, local permission cache or retry. The
dedicated service secret remains only in memory and is never persisted in jobs.
"""
from __future__ import annotations
import hashlib
import hmac
import os
from pathlib import Path
import re
import socket
import stat
import struct
import time
from uuid import uuid4

from semantics import Scope, Store, Rejected, canonical_json, strict_json
from runtime_port_contract import PRODUCT, claims_shape

SCHEMA = 'runtime_authority_v1'
ENDPOINT = '/internal/runtime/authority'
MAX_BODY = 131072
MAX_REPLY = 524288
MAX_HEADERS = 8192
ERRORS = {'AUTH_REQUIRED', 'PERMISSION_DENIED', 'NOT_FOUND', 'VALIDATION_FAILED',
          'ACCESS_REQUIRED', 'ACCOUNT_BLOCKED', 'CREDENTIAL_REVOKED',
          'CAPABILITY_UNAVAILABLE', 'CATALOG_INCOMPATIBLE', 'DEPENDENCY_UNAVAILABLE'}
ACTIONS = {'capabilities', 'submit', 'status', 'read_result', 'cancel', 'execute', 'list_reports', 'read_report'}


def need(value):
    if not value: raise Rejected('DEPENDENCY_UNAVAILABLE')


def encoded(value):
    return canonical_json(value).encode()


def _text(value, maximum=256):
    need(type(value) is str and 0 < len(value) <= maximum and
         not any(ord(c) < 32 or ord(c) == 127 for c in value))
    return value


def scope_shape(value):
    need(type(value) is dict and set(value) == {'tenant', 'revision', 'stores'})
    _text(value['tenant']); _text(value['revision'])
    need(type(value['stores']) is list and 1 <= len(value['stores']) <= 1000)
    stores = []
    for row in value['stores']:
        need(type(row) is dict and set(row) ==
             {'id', 'platform', 'identity', 'access_revision', 'source_revision', 'currency'})
        for field in ('id', 'identity', 'access_revision', 'source_revision'): _text(row[field])
        need(row['platform'] in {'ozon', 'wb'})
        need(row['currency'] is None or type(row['currency']) is str and
             re.fullmatch(r'[A-Z]{3}', row['currency']) is not None)
        stores.append(Store(**row))
    need(len({s.id for s in stores}) == len(stores) and
         len({(s.platform, s.identity) for s in stores}) == len(stores))
    return Scope(value['tenant'], value['revision'], tuple(stores))


class PlatformAuthorityClient:
    def __init__(self, path, *, expected_uid, service_token, service_id, timeout=2):
        # Fail configuration locally. Neither diagnostic text nor repr contains
        # the supplied token, ticket, response or socket contents.
        if (type(path) is not str or not Path(path).is_absolute() or
            len(path.encode()) > 107 or '\x00' in path or
            type(expected_uid) is not int or expected_uid < 0 or
            type(service_token) is not str or not re.fullmatch(r'[A-Za-z0-9_-]{40,256}', service_token) or
            type(service_id) is not str or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', service_id) or
            type(timeout) not in (int, float) or not .01 <= timeout <= 10):
            raise ValueError('Invalid private authority configuration')
        self.path, self.uid, self.service_id = path, expected_uid, service_id
        self._secret, self.timeout = service_token, float(timeout)

    def _trusted_socket(self):
        path = Path(self.path)
        for parent in [path.parent, *path.parent.parents]:
            info = parent.lstat()
            need(stat.S_ISDIR(info.st_mode) and info.st_uid in {0, os.getuid(), self.uid})
            writable = info.st_mode & 0o022
            need(not writable or info.st_uid == 0 and info.st_mode & stat.S_ISVTX)
        info = path.lstat()
        need(stat.S_ISSOCK(info.st_mode) and info.st_uid == self.uid and not info.st_mode & 0o002)

    def _exchange(self, body):
        self._trusted_socket()
        deadline = time.monotonic() + self.timeout
        header = (f'POST {ENDPOINT} HTTP/1.1\r\nHost: localhost\r\n'
                  f'Authorization: Bearer {self._secret}\r\nContent-Type: application/json\r\n'
                  f'Content-Length: {len(body)}\r\nConnection: close\r\n\r\n').encode('ascii')
        def budget(sock):
            remaining = deadline - time.monotonic()
            if remaining <= 0: raise TimeoutError()
            sock.settimeout(remaining)
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as sock:
            budget(sock); sock.connect(self.path)
            _, uid, _ = struct.unpack('3i', sock.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            need(uid == self.uid)
            budget(sock); sock.sendall(header + body)
            raw = bytearray()
            while b'\r\n\r\n' not in raw:
                budget(sock); chunk = sock.recv(4096)
                need(chunk); raw.extend(chunk)
                need(len(raw) <= MAX_HEADERS + 4096)
            raw_header, payload = bytes(raw).split(b'\r\n\r\n', 1)
            need(len(raw_header) <= MAX_HEADERS)
            lines = raw_header.decode('ascii').split('\r\n')
            match = re.fullmatch(r'HTTP/1\.[01] ([1-5][0-9]{2})(?: [ -~]*)?', lines[0])
            need(match is not None)
            headers = {}
            for line in lines[1:]:
                name, separator, value = line.partition(':')
                need(separator and re.fullmatch(r'[A-Za-z0-9-]+', name) is not None)
                name = name.lower(); need(name not in headers)
                headers[name] = value.strip()
            need('transfer-encoding' not in headers and 'content-encoding' not in headers)
            need(headers.get('content-type', '').split(';')[0].strip().lower() == 'application/json')
            length = headers.get('content-length', '')
            need(length.isascii() and length.isdigit() and 0 < int(length) <= MAX_REPLY)
            length = int(length); need(len(payload) <= length)
            while len(payload) < length:
                budget(sock); chunk = sock.recv(min(16384, length - len(payload)))
                need(chunk); payload += chunk
            budget(sock)
            return int(match[1]), payload

    def _call(self, operation, payload):
        request_id = str(uuid4())
        try:
            body = encoded({'schema': SCHEMA, 'request_id': request_id,
                'service_id': self.service_id, 'operation': operation, 'payload': payload})
            need(len(body) <= MAX_BODY)
            status, raw = self._exchange(body)
            reply = strict_json(raw)
            need(type(reply) is dict and set(reply) == {'payload', 'mac'})
            value, mac = reply['payload'], reply['mac']
            need(type(mac) is str and re.fullmatch(r'[a-f0-9]{64}', mac) is not None)
            expected = hmac.new(self._secret.encode(), encoded(value), hashlib.sha256).hexdigest()
            need(hmac.compare_digest(mac, expected))
            need(type(value) is dict and value.get('schema') == SCHEMA and
                 value.get('product_id') == PRODUCT and value.get('request_id') == request_id and
                 type(value.get('ok')) is bool)
            if value['ok']:
                need(status == 200 and set(value) == {'schema', 'product_id', 'request_id', 'ok', 'data'})
                return value['data']
            need(set(value) == {'schema', 'product_id', 'request_id', 'ok', 'code'} and
                 value['code'] in ERRORS and 400 <= status <= 599)
            raise Rejected(value['code'])
        except Rejected as exc:
            if exc.code in ERRORS: raise
            raise Rejected('DEPENDENCY_UNAVAILABLE') from None
        except (OSError, ValueError, TypeError, KeyError, OverflowError, RecursionError):
            raise Rejected('DEPENDENCY_UNAVAILABLE') from None

    def verify(self, ticket, service_id):
        if service_id != self.service_id: raise Rejected('AUTH_REQUIRED')
        _text(ticket, 4096)
        data = self._call('verify', {'ticket': ticket})
        try:
            return claims_shape(data)
        except (Rejected, ValueError, TypeError, KeyError):
            raise Rejected('DEPENDENCY_UNAVAILABLE') from None

    def resolve(self, pins, action):
        if action not in ACTIONS: raise Rejected('VALIDATION_FAILED')
        return scope_shape(self._call('resolve', {'pins': pins, 'action': action}))
