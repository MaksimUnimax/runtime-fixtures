"""Bounded HTTP I/O shared by recipes and setup checks.

The caller's total budget includes DNS, connect, TLS, headers and body.
DNS cannot be killed in a Python thread: timed-out workers keep their bounded
slot until they actually exit, and must never dispatch after cancellation.
"""
import http.client
import io
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request

_MAX_IO = 4
_IO_SLOTS = threading.BoundedSemaphore(_MAX_IO)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class _Budget:
    def __init__(self, deadline, timeout, on_dispatch=None):
        self.deadline, self.timeout = deadline, timeout
        self.lock = threading.Lock()
        self.cancelled = False
        self.sock = None
        self.on_dispatch = on_dispatch
        self.dispatch_observed = False

    def remaining(self):
        with self.lock:
            remaining = self.deadline - time.monotonic()
            if self.cancelled or remaining <= 0:
                raise TimeoutError('HTTP_DEADLINE')
            return min(self.timeout, remaining)

    def observe_dispatch(self):
        # Called once at the first HTTP send, after DNS/connect/TLS and pool
        # admission. It counts attempts, not a promise of provider billing.
        self.remaining()
        if not self.dispatch_observed and self.on_dispatch is not None:
            self.on_dispatch()
            self.dispatch_observed = True
        self.remaining()

    @staticmethod
    def close(sock):
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

    def publish(self, sock):
        with self.lock:
            cancelled = self.cancelled or time.monotonic() >= self.deadline
            if not cancelled:
                self.sock = sock
        if cancelled:
            self.close(sock)
            raise TimeoutError('HTTP_DEADLINE')
        self.prepare(sock)

    def prepare(self, sock):
        remaining = self.remaining()
        if sock is not None:
            sock.settimeout(remaining)

    def cancel(self):
        with self.lock:
            self.cancelled = True
            sock, self.sock = self.sock, None
        # Never close a buffered HTTPResponse here: another thread may hold its
        # read lock. Socket shutdown wakes reads without waiting for that lock.
        self.close(sock)


class _Connection(http.client.HTTPConnection):
    def __init__(self, host, *, budget, **kwargs):
        self.budget = budget
        super().__init__(host, **kwargs)

    def connect(self):
        self.budget.remaining()
        addresses = socket.getaddrinfo(self.host, self.port, 0, socket.SOCK_STREAM)
        self.budget.remaining()  # DNS may have returned after cancellation.
        last_error = None
        for family, kind, proto, _, address in addresses:
            self.budget.remaining()
            sock = socket.socket(family, kind, proto)
            try:
                self.budget.publish(sock)
                if self.source_address:
                    sock.bind(self.source_address)
                sock.connect(address)
                self.budget.prepare(sock)
                self.sock = sock
                return
            except OSError as exc:
                last_error = exc
                self.budget.close(sock)
        if last_error:
            raise last_error
        raise OSError('DNS_EMPTY')

    def send(self, data):
        self.budget.remaining()
        if self.sock is None:
            self.connect()
        self.budget.prepare(self.sock)
        self.budget.observe_dispatch()
        return super().send(data)

    def getresponse(self):
        self.budget.prepare(self.sock)
        return super().getresponse()


class _TLSConnection(_Connection):
    default_port = 443

    def __init__(self, host, *, context, **kwargs):
        self.context = context
        super().__init__(host, **kwargs)

    def connect(self):
        super().connect()
        raw = self.sock
        try:
            self.budget.remaining()
            # Publish the real SSL socket before the potentially blocking handshake.
            wrapped = self.context.wrap_socket(raw, server_hostname=self.host,
                                               do_handshake_on_connect=False)
            self.sock = wrapped
            self.budget.publish(wrapped)
            wrapped.do_handshake()
            self.budget.prepare(wrapped)
        except BaseException:
            self.close()
            raise


class _HTTPHandler(urllib.request.HTTPHandler):
    def __init__(self, budget):
        super().__init__()
        self.budget = budget

    def http_open(self, request):
        return self.do_open(lambda host, **kw: _Connection(host, budget=self.budget, **kw), request)


class _HTTPSHandler(urllib.request.HTTPSHandler):
    def __init__(self, budget, context):
        super().__init__(context=context)
        self.budget = budget

    def https_open(self, request):
        return self.do_open(lambda host, **kw: _TLSConnection(
            host, budget=self.budget, context=self._context, **kw), request)


def _read_body(response, budget, limit):
    chunks = bytearray()
    while len(chunks) <= limit:
        budget.remaining()
        if getattr(response, 'isclosed', lambda: False)():
            break
        budget.prepare(budget.sock)
        chunk = response.read1(min(8192, limit + 1 - len(chunks)))
        if not chunk:
            break
        chunks.extend(chunk)
    budget.remaining()
    return bytes(chunks)


def read_response(request, *, timeout=25, limit=12000000, deadline=None, ssl_context=None, on_dispatch=None):
    started = time.monotonic()
    if timeout <= 0 or limit < 0:
        raise ValueError('HTTP_LIMIT')
    deadline = min(started + timeout, deadline) if deadline is not None else started + timeout
    budget = _Budget(deadline, timeout, on_dispatch)
    # Admission consumes the same total budget; cancellation does not free a
    # still-running DNS worker's slot and cannot create unbounded replacements.
    if not _IO_SLOTS.acquire(timeout=budget.remaining()):
        raise TimeoutError('HTTP_CAPACITY_DEADLINE')
    try:
        budget.remaining()
        context = ssl_context if ssl_context is not None else ssl.create_default_context()
        budget.remaining()
    except BaseException:
        _IO_SLOTS.release()
        raise
    done = threading.Event()
    outcome = {}
    result_lock = threading.Lock()

    def exchange():
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                                _HTTPHandler(budget), _HTTPSHandler(budget, context))
            budget.remaining()
            with opener.open(request, timeout=budget.remaining()) as response:
                result = (_read_body(response, budget, limit), response.status)
            with result_lock:
                if time.monotonic() < deadline:
                    outcome['result'] = result
        except BaseException as exc:
            if isinstance(exc, urllib.error.HTTPError):
                # Preserve status and Retry-After, never transfer a live response
                # or its buffered reader to the caller thread.
                original = exc
                # Status and Retry-After are sufficient. An error body's broken
                # connection must not erase a received 429/503 or hang this call.
                body = b''
                if original.code not in (408,425,429,500,502,503,504):
                    try:body = _read_body(original, budget, limit) if original.fp is not None else b''
                    except Exception:pass
                exc = urllib.error.HTTPError(request.full_url, original.code, original.msg,
                                             original.headers, io.BytesIO(body))
                if original.fp is not None:
                    original.close()
            with result_lock:
                if time.monotonic() < deadline:
                    outcome['error'] = exc
        finally:
            budget.cancel()
            _IO_SLOTS.release()
            done.set()

    thread = threading.Thread(target=exchange, name='alisa-http-io', daemon=True)
    try:
        thread.start()
    except BaseException:
        budget.cancel()
        _IO_SLOTS.release()
        raise
    done.wait(max(0, deadline - time.monotonic()))
    with result_lock:
        result, error = outcome.get('result'), outcome.get('error')
    if not done.is_set() or time.monotonic() >= deadline or (result is None and error is None):
        budget.cancel()
        raise TimeoutError('HTTP_DEADLINE')
    if error is not None:
        raise error
    return result


