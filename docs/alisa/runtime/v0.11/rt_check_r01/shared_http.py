"""Single HTTPS I/O primitive shared by runtime recipes and setup checks.

The analytical caller keeps its existing decoder, auth and qualification guards.
The setup caller supplies only a fixed read-only endpoint, never a browser URL.
"""
import time
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def read_response(request, *, timeout=25, limit=12000000, deadline=None, ssl_context=None):
    handlers = [urllib.request.ProxyHandler({}), NoRedirect()]
    if ssl_context is not None:
        handlers.append(urllib.request.HTTPSHandler(context=ssl_context))
    opener = urllib.request.build_opener(*handlers)
    if deadline is not None:
        timeout = min(timeout, deadline-time.monotonic())
        if timeout <= 0:
            raise TimeoutError()
    with opener.open(request, timeout=timeout) as response:
        # Preserve the existing analytical caller's single bounded read.
        if deadline is None:
            return response.read(limit+1), response.status
        chunks = bytearray()
        while len(chunks) <= limit:
            if time.monotonic() >= deadline:
                raise TimeoutError()
            chunk = response.read(min(8192, limit+1-len(chunks)))
            if not chunk:
                break
            chunks.extend(chunk)
        if time.monotonic() >= deadline:
            raise TimeoutError()
        return bytes(chunks), response.status
