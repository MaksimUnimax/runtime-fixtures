#!/usr/bin/env python3
"""Private operator entry page for the native Harness lab.

The existing DSH owner launch-token exchange is retained. This gateway is only
an access-code form and never bypasses DSH's session/authentication checks.
"""
from __future__ import annotations

from collections import defaultdict, deque
from hashlib import sha256
from html import escape
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from time import monotonic
from urllib.parse import parse_qs, urlsplit
import os
import secrets

ROOT = Path("/var/lib/harness-native-lab/dsh/private")
ENTRY = ROOT / "entry-url.txt"
HASH = ROOT / "entry-code.sha256"
EXPECTED_ORIGIN = "https://alisa.octoport.ru:18443"
PORT = 18444
LOCK = Lock()
FAILURES = defaultdict(deque)
WINDOW = 15 * 60
MAX_FAILURES = 6

def page(error="", status=200):
    notice = f'<p class="err" role="alert">{escape(error)}</p>' if error else ""
    html = """<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness — вход в тестовый стенд</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:#111113;color:#f1f1f2;font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}
main{width:min(100%,420px);background:#1b1b1e;border:1px solid #343437;border-radius:16px;padding:30px}
h1{font-size:25px;margin:0 0 8px}p{color:#bcbcc4;margin:0 0 20px}label{display:block;font-size:14px;margin-bottom:9px}
input{display:block;width:100%;padding:13px;border-radius:9px;background:#111113;color:#fff;border:1px solid #56565e;font:inherit;letter-spacing:.03em}
input:focus{outline:2px solid #a5a5bd;outline-offset:2px}
button{width:100%;margin-top:16px;padding:13px 18px;border:0;border-radius:9px;background:#eeeef0;color:#151515;font-size:16px;font-weight:600;cursor:pointer}
small{display:block;color:#a6a6af;margin-top:17px} .err{color:#ffbaba}
</style></head><body><main><h1>Harness · тестовый стенд</h1>
<p>Для доступа в рабочий тестовый чат введите код. В дальнейшем отдельный код не потребуется, пока действует сессия браузера.</p>
REPLACE_NOTICE
<form action="/lab-login" method="post" autocomplete="off">
<label for="code">Код доступа</label>
<input id="code" name="code" type="password" required minlength="12" maxlength="80" autofocus autocomplete="one-time-code">
<button type="submit">Войти в Harness</button></form>
<small>Это приватный стенд разработчика, а не регистрация пользователей.</small>
</main></body></html>""".replace("REPLACE_NOTICE", notice)
    return html.encode("utf-8")

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Don't log passwords, launch tokens or query parameters.
        return

    def send_body(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, private")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.send_header("X-Frame-Options", "DENY")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if urlsplit(self.path).path != "/lab-login":
            return self.send_body(404, page("Страница не найдена."))
        self.send_body(200, page())

    def do_POST(self):
        if self.path != "/lab-login":
            return self.send_body(404, page("Страница не найдена."))
        origin = self.headers.get("Origin", "")
        if origin and origin != EXPECTED_ORIGIN:
            return self.send_body(403, page("Недопустимый источник запроса."))
        if not self.headers.get("Content-Type", "").startswith("application/x-www-form-urlencoded"):
            return self.send_body(415, page("Неподдерживаемый тип формы."))
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > 256:
            return self.send_body(400, page("Некорректная длина формы."))
        ip = self.headers.get("X-Real-IP", self.client_address[0])
        now = monotonic()
        with LOCK:
            d = FAILURES[ip]
            while d and d[0] < now-WINDOW:
                d.popleft()
            limited = len(d) >= MAX_FAILURES
        if limited:
            return self.send_body(429, page("Слишком много попыток. Повторите вход позже."))
        fields = parse_qs(self.rfile.read(length).decode("utf-8", errors="replace"))
        code = fields.get("code", [""])[0].strip().replace("-", "").upper()
        digest = sha256(code.encode("utf-8")).hexdigest()
        try:
            allowed = secrets.compare_digest(digest, HASH.read_text().strip())
        except OSError:
            allowed = False
        if not allowed:
            with LOCK:
                FAILURES[ip].append(now)
            return self.send_body(403, page("Неверный код доступа."))
        with LOCK:
            FAILURES.pop(ip, None)
        # Authorize via the actual DSH owner launch-token endpoint.
        try:
            entry = ENTRY.read_text().strip()
            parts = urlsplit(entry)
            if parts.scheme != "https" or parts.netloc != "alisa.octoport.ru:18443" or not parse_qs(parts.query).get("token"):
                raise ValueError("invalid entry")
        except (OSError, ValueError):
            return self.send_body(503, page("Вход временно недоступен: отсутствует служебная ссылка."))
        self.send_response(303)
        self.send_header("Location", entry)
        self.send_header("Content-Length", "0")
        self.send_header("Cache-Control", "no-store, private")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()

if __name__ == "__main__":
    os.umask(0o077)
    if not HASH.is_file() or not ENTRY.is_file():
        raise SystemExit("Private lab credentials were not provisioned")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever(poll_interval=0.2)
