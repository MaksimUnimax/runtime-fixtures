"""Disposable RT-CHECK peer; never imported by packaged product code."""
import json
import os
import socket
import socketserver
import struct
import threading


class Fixture(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True
    def __init__(self, path, uid):
        self.uid, self.calls, self.bad_pins = uid, 0, False
        super().__init__(str(path), Handler)
        os.chmod(path, 0o666)  # Only in an owned disposable test directory.
        self.thread = threading.Thread(target=self.serve_forever, daemon=True); self.thread.start()

    def close(self):
        self.shutdown(); self.server_close(); self.thread.join(timeout=2)


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        self.request.settimeout(4)
        _, uid, _ = struct.unpack('3i', self.request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
        if uid != self.server.uid:
            return
        raw = self.rfile.readline(32769)
        if len(raw) > 32768 or not raw.endswith(b'\n'):
            return
        value = json.loads(raw)
        if set(value) != {'schema_version', 'operation', 'pins', 'credential'} or value['operation'] != 'check_store':
            return
        secret = next(value['credential'][n] for n in ['api_key', 'client_secret', 'token'] if n in value['credential'])
        prefix, code, identity = secret.split(':', 2)
        if prefix != 'fixture':
            return
        self.server.calls += 1
        result = {'code': code}
        if code == 'CONNECTED_NATIVE_OWNER':
            result = {'code': 'CONNECTED', 'identity_provenance': 'NATIVE_OWNER_CONFIGURED_PAIR'}
        if result['code'] == 'CONNECTED':
            result.update(identity=identity, capabilities=[value['pins']['kind']])
        pins = {**value['pins']}
        if self.server.bad_pins:
            pins['tenant_id'] = 'untrusted-other-tenant'
        self.wfile.write((json.dumps({'schema_version': 'rt_check_v1', 'pins': pins, 'result': result})+'\n').encode())
