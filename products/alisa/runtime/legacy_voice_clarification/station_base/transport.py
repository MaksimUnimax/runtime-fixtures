"""QR + Quasar transport; see THIRD_PARTY.md. No automatic mutation retries."""
import http.cookiejar, json, re, urllib.request, urllib.parse, urllib.error
HOSTS = {"passport.yandex.ru", "yandex.ru", "www.yandex.ru", "iot.quasar.yandex.ru"}
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



def payload(name, trigger, device, text, mode="text"):
    if not isinstance(text, str) or not 1 <= len(text) <= 900:
        raise Fault('speech_size')
    capability = {'type': 'devices.capabilities.quasar', 'state': {'instance': 'tts', 'value': {'text': text}}}
    if mode == 'skill':
        capability = {'type': 'devices.capabilities.quasar.server_action', 'state': {'instance': 'text_action', 'value': text}}
    elif mode != 'text': raise Fault('invalid_mode')
    return {'name': name, 'icon': 'home', 'triggers': [{'trigger': {'type': 'scenario.trigger.voice', 'value': trigger}}],
            'steps': [{'type': 'scenarios.steps.actions.v2', 'parameters': {'items': [
                {'id': device, 'type': 'step.action.item.device', 'value': {'id': device, 'item_type': 'device', 'capabilities': [capability]}}
            ]}}]}
