#!/usr/bin/env python3
"""Bounded owner-only Station transport probe; no marketplace or skill mutations."""
import hashlib
import hmac
import http.cookiejar
import json
import os
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASE = '/station-probe/'
ORIGIN = 'https://alice-lab.octoport.ru'
TTL = 10800
DELAY_SECONDS = 15
TEST_TEXT = 'Автоматическая доставка Октопорта работает. Контрольное число сто двадцать три.'
TEST_COMMAND = 'Спроси Октопорт маркет проверка связи'
HOSTS = {'passport.yandex.ru', 'yandex.ru', 'www.yandex.ru', 'iot.quasar.yandex.ru'}


class Fault(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


class NoForeignRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        u = urllib.parse.urlsplit(newurl)
        if u.scheme != 'https' or u.hostname not in HOSTS:
            raise Fault('redirect_blocked')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class Yandex:
    def __init__(self):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar), NoForeignRedirect())
        self.csrf = None
        self.track = None

    def request(self, method, url, payload=None, form=False, headers=None):
        u = urllib.parse.urlsplit(url)
        if u.scheme != 'https' or u.hostname not in HOSTS:
            raise Fault('host_blocked')
        data = None
        hd = {'User-Agent': 'Mozilla/5.0 OctoportStationProbe/1.0'}
        if headers:
            hd.update(headers)
        if payload is not None:
            data = (urllib.parse.urlencode(payload).encode() if form else
                    json.dumps(payload).encode())
            hd['Content-Type'] = ('application/x-www-form-urlencoded' if form
                                  else 'application/json')
        req = urllib.request.Request(url, data=data, headers=hd, method=method)
        # Never retry a mutation: an HTTP/network failure can follow acceptance.
        try:
            with self.opener.open(req, timeout=8) as r:
                raw = r.read(1048577)
                if len(raw) > 1048576:
                    raise Fault('response_too_large')
        except urllib.error.HTTPError as e:
            raise Fault('yandex_http_' + str(e.code)) from None
        except (OSError, TimeoutError, urllib.error.URLError):
            raise Fault('network_outcome_unknown') from None
        try:
            return json.loads(raw)
        except (ValueError, UnicodeError):
            return raw.decode('utf-8', errors='replace')

    def start_qr(self):
        raw = self.request('GET', 'https://passport.yandex.ru/pwl-yandex')
        if not isinstance(raw, str):
            raise Fault('qr_page_changed')
        m = re.search(r'__CSRF__\s*=\s*"([^\"]+)"', raw)
        if not m:
            raise Fault('qr_page_changed')
        headers = {'X-CSRF-Token': m[1]}
        auth = self.request('POST', 'https://passport.yandex.ru/pwl-yandex/api/passport/auth/password/submit',
                            {'retpath': 'https://passport.yandex.ru/'}, headers=headers)
        if not isinstance(auth, dict) or not isinstance(auth.get('track_id'), str):
            raise Fault('qr_track_missing')
        raw = self.request('POST', 'https://passport.yandex.ru/pwl-yandex/api/passport/auth/magic/code',
                           {'location_id': '0', 'magic_track_id': auth['track_id'], 'track_id': ''},
                           form=True, headers=headers)
        link = raw.get('link', '') if isinstance(raw, dict) else ''
        u = urllib.parse.urlsplit(link)
        if u.scheme != 'https' or u.hostname not in {'passport.yandex.ru', 'yandex.ru'}:
            raise Fault('qr_link_invalid')
        self.track = (auth, headers)
        return link

    def poll_qr(self):
        if not self.track:
            raise Fault('qr_not_started')
        auth, headers = self.track
        r = self.request('POST', 'https://passport.yandex.ru/pwl-yandex/api/passport/auth/magic/code/status',
                         auth, headers=headers)
        if not isinstance(r, dict):
            raise Fault('qr_status_changed')
        if r.get('state') != 'otp_auth_finished':
            return False
        self.request('POST', 'https://passport.yandex.ru/pwl-yandex/api/passport/sessions/get_session',
                     {'track_id': r['trackId']}, form=True, headers=headers)
        # A 200 here can be an error page. Verify authenticated IoT identity.
        storage = self.request('GET', 'https://yandex.ru/iot?storage=1')
        if not isinstance(storage, dict) or not storage.get('storage', {}).get('user', {}).get('uid'):
            raise Fault('qr_session_not_authenticated')
        # Keep approved cookies in memory. No mobile-app credentials or x-token conversion.
        self.track = None
        return True

    def api(self, method, path, payload=None):
        headers = {}
        if method != 'GET':
            if self.csrf is None:
                raw = self.request('GET', 'https://yandex.ru/iot')
                m = re.search(r'"csrfToken2":"(.+?)"', raw) if isinstance(raw, str) else None
                if not m:
                    raise Fault('quasar_auth_required')
                self.csrf = m[1]
            headers['x-csrf-token'] = self.csrf
        r = self.request(method, 'https://iot.quasar.yandex.ru' + path, payload, headers=headers)
        if not isinstance(r, dict) or r.get('status') != 'ok':
            raise Fault('quasar_response_changed')
        return r

    def devices(self):
        r = self.api('GET', '/m/v3/user/devices')
        devices = []
        for home in r.get('households', []):
            for d in home.get('all', []):
                if isinstance(d.get('quasar_info'), dict) and d.get('capabilities'):
                    devices.append({'id': d['id'], 'name': d.get('name', 'Колонка')})
        return devices


def scenario_payload(name, trigger, device, mode):
    if mode not in ('text', 'skill'):
        raise Fault('invalid_mode')
    capability = ({'type': 'devices.capabilities.quasar',
                   'state': {'instance': 'tts', 'value': {'text': TEST_TEXT}}}
                  if mode == 'text' else
                  {'type': 'devices.capabilities.quasar.server_action',
                   'state': {'instance': 'text_action', 'value': TEST_COMMAND}})
    return {'name': name, 'icon': 'home',
            'triggers': [{'trigger': {'type': 'scenario.trigger.voice', 'value': trigger}}],
            'steps': [{'type': 'scenarios.steps.actions.v2', 'parameters': {'items': [
                {'id': device, 'type': 'step.action.item.device', 'value': {
                    'id': device, 'item_type': 'device', 'capabilities': [capability]}}]}}]}


class Probe:
    def __init__(self, token, client=None, clock=time.monotonic):
        self.token = token
        self.clock = clock
        self.expires = clock() + TTL
        self.client = client or Yandex()
        self.lock = threading.Lock()
        self.connected = False
        self.devices = []
        self.selected = None
        self.sid = None
        self.name = 'Октопорт проверка ' + secrets.token_hex(6)
        self.trigger = 'октопорт техническая проверка ' + secrets.token_hex(8)
        self.qr = None
        self.qr_expires = 0
        self.last_poll = -100
        self.attempts = []
        self.last_send = -100
        self.unknown = False
        self.generation = 0

    def authorized(self, token):
        return self.clock() < self.expires and hmac.compare_digest(token, self.token)

    def clear_expired(self):
        with self.lock:
            self.generation += 1
            self.client = Yandex()
            self.connected = False
            self.qr = None
            self.track = None
            self.devices = []
            self.selected = None

    def view(self):
        return {'connected': self.connected, 'devices': self.devices, 'selected': self.selected,
                'scenario_created': bool(self.sid), 'uncertain': self.unknown,
                'attempts': self.attempts[-20:], 'expires_in': max(0, int(self.expires-self.clock()))}

    def action(self, kind, data):
        with self.lock:
            if self.clock() >= self.expires:
                self.client = Yandex()
                self.connected = False
                raise Fault('probe_expired')
            if kind == 'status':
                return self.view()
            if kind == 'qr':
                if self.connected:
                    raise Fault('already_connected')
                if self.qr and self.clock() < self.qr_expires:
                    return {'link': self.qr}
                self.client = Yandex()
                self.qr = self.client.start_qr()
                self.qr_expires = self.clock() + 240
                return {'link': self.qr}
            if kind == 'poll':
                if self.connected:
                    return self.view()
                if self.clock() >= self.qr_expires:
                    raise Fault('qr_expired')
                if self.clock() - self.last_poll < 2:
                    return self.view()
                self.last_poll = self.clock()
                if self.client.poll_qr():
                    self.connected = True
                    self.qr = None
                return self.view()
            if kind == 'revoke':
                self.generation += 1
                self.client = Yandex()
                self.connected = False
                self.devices = []
                self.selected = None
                self.sid = None
                self.qr = None
                self.qr_expires = 0
                # Do not blindly retry or delete a possibly-created scenario after an unknown outcome.
                return self.view()
            if not self.connected:
                raise Fault('not_connected')
            if kind == 'devices':
                self.devices = self.client.devices()
                return self.view()
            if kind == 'select':
                if self.sid or self.unknown or self.selected:
                    raise Fault('selection_locked')
                device = data.get('device')
                if device not in {x['id'] for x in self.devices}:
                    raise Fault('device_not_allowed')
                self.selected = device
                return self.view()
            if kind in ('test', 'delay'):
                if self.unknown:
                    raise Fault('outcome_unknown_no_retry')
                if not self.selected:
                    raise Fault('select_device')
                mode = data.get('mode')
                if mode not in ('text', 'skill'):
                    raise Fault('invalid_mode')
                if len(self.attempts) >= 20 or self.clock() - self.last_send < 12:
                    raise Fault('test_rate_limit')
                self.last_send = self.clock()
                attempt = {'number': len(self.attempts)+1, 'mode': mode, 'state': 'waiting' if kind == 'delay' else 'sending'}
                self.attempts.append(attempt)
                if kind == 'delay':
                    t = threading.Thread(target=self.delayed, args=(attempt, self.generation), daemon=True)
                    t.start()
                else:
                    self.send(attempt)
                return self.view()
            raise Fault('unknown_action')

    def delayed(self, attempt, generation):
        time.sleep(DELAY_SECONDS)
        with self.lock:
            if generation != self.generation or not self.connected or self.clock() >= self.expires or self.unknown:
                attempt['state'] = 'cancelled'
                return
            self.send(attempt)

    def send(self, attempt):
        attempt['state'] = 'sending'
        try:
            payload = scenario_payload(self.name, self.trigger, self.selected, attempt['mode'])
            if not self.sid:
                r = self.client.api('POST', '/m/v4/user/scenarios', payload)
                sid = r.get('scenario_id')
                if not isinstance(sid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', sid):
                    raise Fault('scenario_id_missing')
                self.sid = sid
            else:
                self.client.api('PUT', '/m/v4/user/scenarios/' + self.sid, payload)
            self.client.api('POST', '/m/user/scenarios/' + self.sid + '/actions')
            attempt['state'] = 'accepted_not_heard'
        except Fault as e:
            self.unknown = True
            attempt['state'] = 'unknown_no_retry'
            attempt['error'] = e.code
            # Return a stable redacted error, never the upstream response/cookies.


def greeting(verified_site_name=None):
    """Call only with a name obtained from the verified linked SITE profile."""
    if verified_site_name is None or not isinstance(verified_site_name, str):
        return 'Привет'
    name = ' '.join(verified_site_name.split())
    if not name or len(name) > 80 or any(c in name for c in '<>{}@'):
        return 'Привет'
    return 'Привет, ' + name


class Handler(BaseHTTPRequestHandler):
    server_version = 'OctoportStationProbe'
    def log_message(self, *args):
        pass

    def output(self, code, data, content='application/json; charset=utf-8'):
        raw = json.dumps(data, ensure_ascii=False).encode() if isinstance(data, dict) else data
        self.send_response(code)
        for k, v in {'Content-Type': content, 'Content-Length': str(len(raw)), 'Cache-Control': 'no-store',
                     'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
                     'X-Frame-Options': 'DENY',
                     'Content-Security-Policy': "default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' blob:; style-src 'self'; frame-ancestors 'none'; base-uri 'none'"}.items():
            self.send_header(k, v)
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        files = {BASE: ('index.html', 'text/html; charset=utf-8'),
                 BASE+'app.js': ('app.js', 'application/javascript; charset=utf-8'),
                 BASE+'style.css': ('style.css', 'text/css; charset=utf-8')}
        route = urllib.parse.urlsplit(self.path)
        if route.query or route.path not in files:
            self.output(404, {'error': 'not_found'})
            return
        file, mime = files[route.path]
        self.output(200, (Path(__file__).parent/file).read_bytes(), mime)

    def do_POST(self):
        if self.headers.get('Origin') != ORIGIN:
            self.output(403, {'error': 'origin'})
            return
        token = self.headers.get('Authorization', '')
        if not token.startswith('Bearer ') or not self.server.probe.authorized(token[7:]):
            self.output(401, {'error': 'link_expired'})
            return
        try:
            if self.headers.get_content_type() != 'application/json' or self.headers.get('Transfer-Encoding'):
                raise Fault('json_required')
            n = int(self.headers.get('Content-Length', '0'))
            if not 0 < n <= 2048:
                raise Fault('body_size')
            self.connection.settimeout(3)
            raw = self.rfile.read(n)
            if len(raw) != n:
                raise Fault('body_size')
            data = json.loads(raw)
            if not isinstance(data, dict):
                raise Fault('json_required')
            route = urllib.parse.urlsplit(self.path)
            kind = route.path.removeprefix(BASE+'api/')
            if route.query or not route.path.startswith(BASE+'api/') or kind not in {'qr', 'poll', 'devices', 'select', 'test', 'delay', 'status', 'revoke'}:
                raise Fault('unknown_action')
            result = self.server.probe.action(kind, data)
            if kind == 'qr':
                from qrcodegen import QrCode
                qr = QrCode.encode_text(result['link'], QrCode.Ecc.MEDIUM)
                result['svg'] = qr_svg(qr)
            self.output(200, result)
        except Fault as e:
            self.output(409, {'error': e.code})
        except (ValueError, UnicodeError, OSError):
            self.output(400, {'error': 'invalid_request'})
        except Exception:
            self.output(502, {'error': 'protocol_changed'})


def qr_svg(qr):
    size = qr.get_size()
    path = ' '.join(f'M{x+4},{y+4}h1v1h-1z' for y in range(size) for x in range(size) if qr.get_module(x,y))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size+8} {size+8}"><rect width="100%" height="100%" fill="white"/><path d="{path}" fill="black"/></svg>'


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--token-file', required=True)
    parser.add_argument('--port', type=int, default=8776)
    args = parser.parse_args()
    token = Path(args.token_file).read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{40,100}', token):
        raise SystemExit('invalid capability')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    server.probe = Probe(token)
    # Clear memory even when no HTTP request arrives; then end the bounded probe.
    def expire():
        server.probe.clear_expired()
        server.shutdown()
    timer = threading.Timer(TTL, expire)
    timer.daemon = True
    timer.start()
    server.serve_forever()


if __name__ == '__main__':
    main()
