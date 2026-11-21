"""Private peer-bound product IPC. No Engine, SQLite, old keys or report gateway."""
import argparse
import json
import os
from pathlib import Path
import socket
import socketserver
import signal
import stat
import struct
import subprocess
import sys
import threading
import time
sys.dont_write_bytecode = True
from store_checker import Checker, MAX_MESSAGE, VERSION, loads, validate, safe_result
import product_catalog


def child_check(raw, pins, *, environment, enabled, seller_binding_qualified, timeout, enable_catalog=False):
    command = [sys.executable, '-I', '-B', str(Path(__file__).with_name('store_check_worker.py')),
        '--environment', environment]
    for kind in enabled:
        command.extend(['--enable-kind', kind])
    if seller_binding_qualified:
        command.append('--seller-binding-qualified')
    if enable_catalog:command.append('--enable-catalog')
    version=loads(raw).get('schema_version')
    validator=product_catalog.safe_result if version==product_catalog.VERSION else safe_result
    clean = {k: v for k, v in os.environ.items() if k in {'PATH', 'LANG', 'LC_ALL'}}
    with subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=clean, cwd=Path(__file__).resolve().parent) as child:
        try:
            response, _ = child.communicate(raw, timeout=max(.001, timeout))
        except subprocess.TimeoutExpired:
            child.kill(); child.communicate()
            return {'code': 'TIMEOUT'}
        if child.returncode or len(response) > MAX_MESSAGE:
            return {'code': 'CHECK_UNAVAILABLE'}
    try:
        value = loads(response)
        if (set(value) != {'schema_version', 'pins', 'result'} or value['schema_version'] != version
                or json.dumps(value['pins'], sort_keys=True) != json.dumps(pins, sort_keys=True)):
            raise ValueError()
        result = value['result']
        if not validator(result, pins):
            raise ValueError()
        return result
    except (ValueError, TypeError, KeyError):
        return {'code': 'CHECK_UNAVAILABLE'}


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = False
    block_on_close = True
    request_queue_size = 8

    def __init__(self, path, *, allowed_uid, environment, enabled=(), seller_binding_qualified=False, runner=child_check, enable_catalog=False):
        if not hasattr(socket, 'SO_PEERCRED') or allowed_uid < 0:
            raise ValueError('Verifiable peer identity required')
        target = Path(path)
        if environment not in {'dev', 'stage', 'prod'}:
            raise ValueError()
        if environment != 'dev' and str(target) != '/run/alice-market/store-check.sock':
            raise ValueError('Pinned socket required')
        Checker(enabled=enabled, seller_binding_qualified=seller_binding_qualified)
        parent = target.parent.lstat()
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid not in {0, os.geteuid()}
                or parent.st_mode & 0o022 or target.exists() or target.is_symlink()):
            raise ValueError('Private owned socket path required; existing paths are preserved')
        self.allowed_uid, self.environment = allowed_uid, environment
        self.enabled, self.seller_binding_qualified, self.runner = tuple(enabled), seller_binding_qualified, runner
        self.enable_catalog = enable_catalog
        self.slots = threading.BoundedSemaphore(2)
        super().__init__(str(target), Handler)
        os.chmod(target, 0o660)
        self.owned_path, self.owned_inode = target, target.lstat().st_ino

    def verify_request(self, request, address):
        try:
            _, uid, _ = struct.unpack('3i', request.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            return uid == self.allowed_uid
        except OSError:
            return False

    def process_request(self, request, address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except Exception:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def handle_error(self, request, address):
        # Never let request data or exception text reach service logs.
        pass

    def server_close(self):
        super().server_close()
        if hasattr(self, 'owned_path'):
            try:
                if self.owned_path.lstat().st_ino == self.owned_inode:
                    self.owned_path.unlink()
            except FileNotFoundError:
                pass


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        started = time.monotonic()
        self.request.settimeout(.5)
        pins = {};version=VERSION;validator=safe_result
        try:
            raw = self.rfile.readline(MAX_MESSAGE+1)
            if len(raw) > MAX_MESSAGE or not raw.endswith(b'\n'):
                raise ValueError()
            message = loads(raw)
            options={}
            if message.get('schema_version')==product_catalog.VERSION:
                if not self.server.enable_catalog:raise ValueError()
                pins,_,_=product_catalog.validate(message,self.server.environment)
                if pins['kind']not in self.server.enabled:raise ValueError()
                version=product_catalog.VERSION;validator=product_catalog.safe_result;options['enable_catalog']=True
            else:pins, _ = validate(message, self.server.environment)
            remaining = (3.8 if options else 2.7)-(time.monotonic()-started)
            result = self.server.runner(raw, pins, environment=self.server.environment,
                enabled=self.server.enabled, seller_binding_qualified=self.server.seller_binding_qualified,
                timeout=max(.001, remaining),**options)
            if not validator(result, pins):
                raise ValueError()
        except Exception:
            result = {'code': 'CHECK_UNAVAILABLE'}
        try:
            self.wfile.write((json.dumps({'schema_version': version, 'pins': pins, 'result': result}, separators=(',', ':'))+'\n').encode())
        except OSError:
            pass


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--socket', required=True)
    parser.add_argument('--allowed-uid', type=int, required=True)
    parser.add_argument('--environment', required=True, choices=['dev', 'stage', 'prod'])
    parser.add_argument('--enable-kind', action='append', default=[], choices=['WB', 'SELLER', 'PERFORMANCE'])
    parser.add_argument('--seller-binding-qualified', action='store_true')
    parser.add_argument('--enable-catalog', action='store_true')
    args = parser.parse_args()
    def interrupted(*_):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    with Server(args.socket, allowed_uid=args.allowed_uid, environment=args.environment,
            enabled=args.enable_kind, seller_binding_qualified=args.seller_binding_qualified, enable_catalog=args.enable_catalog) as server:
        try:
            server.serve_forever(poll_interval=.1)
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
