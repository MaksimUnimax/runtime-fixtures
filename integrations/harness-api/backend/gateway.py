"""Loopback HTTP gateway for the authenticated Octoport Harness UI."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import mimetypes
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from security import Bindings, Failure, identifier, question, require_bearer, require_origin, session_cookie


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class EngineClient:
    def __init__(self, secret, url='http://127.0.0.1:18132'):
        endpoint = urllib.parse.urlsplit(url)
        if endpoint.scheme != 'http' or endpoint.hostname != '127.0.0.1' or endpoint.path not in ('', '/'):
            raise ValueError('engine must use loopback HTTP')
        self.url, self.secret = url.rstrip('/'), secret
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, operation, data):
        request = urllib.request.Request(self.url + '/v1/' + operation,
            data=json.dumps(data, ensure_ascii=False).encode(), method='POST',
            headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.secret})
        try:
            with self.opener.open(request, timeout=30) as response:
                raw = response.read(4 * 1024 * 1024 + 1)
                if len(raw) > 4 * 1024 * 1024:
                    raise Failure('ENGINE_RESPONSE_TOO_LARGE', 502)
                value = json.loads(raw)
                if not isinstance(value, dict):
                    raise ValueError('invalid engine response')
                return value
        except urllib.error.HTTPError as error:
            try:
                value = json.loads(error.read(10000))
            except (ValueError, OSError):
                value = {}
            code = value.get('code', 'SERVICE_UNAVAILABLE')
            if not isinstance(code, str) or not re.fullmatch('[A-Z][A-Z0-9_]{1,80}', code):
                code = 'SERVICE_UNAVAILABLE'
            # Engine error messages are our own product text. Do not include
            # transport exceptions or request headers in client responses.
            message = value.get('error')
            if not isinstance(message, str) or self.secret in message:
                message = None
            raise Failure(code, error.code if 400 <= error.code <= 599 else 502, message) from None
        except Failure:
            raise
        except (OSError, ValueError, urllib.error.URLError):
            raise Failure('SERVICE_UNAVAILABLE', 503) from None

    def health(self):
        try:
            with self.opener.open(self.url + '/health', timeout=5) as response:
                value = json.loads(response.read(10000))
                return value if isinstance(value, dict) else {'ok': False}
        except (OSError, ValueError, urllib.error.URLError):
            return {'ok': False}


def public_chat(value):
    return {'id': value.get('chat_id', value.get('id')), 'title': value.get('title') or 'Новый разговор',
            'created_at': value.get('created_at'), 'updated_at': value.get('updated_at', value.get('created_at'))}


class Application:
    def __init__(self, identity, pipeline, engine, secret, *, origin='https://alisa.octoport.ru', bindings=None):
        self.identity, self.pipeline, self.engine, self.secret = identity, pipeline, engine, secret
        self.origin, self.bindings = origin, bindings or Bindings()
        self.condition = threading.Condition(threading.RLock())

    def authenticate(self, headers):
        # The browser cannot pick an actor or tenant in an API payload.
        token = session_cookie(headers.get('Cookie'))
        profile = self.identity.profile(token)
        identifier(profile['customer_id']); identifier(profile['tenant_id'])
        return token, profile

    @staticmethod
    def owner(profile):
        return {'actor_id': profile['customer_id'], 'tenant_id': profile['tenant_id']}

    def internal(self, headers, data):
        require_bearer(headers.get('Authorization'), self.secret)
        binding = self.bindings.resolve(data)
        profile = self.identity.profile(binding.portal_token)
        if (profile['customer_id'], profile['tenant_id']) != (binding.actor_id, binding.tenant_id):
            raise Failure('FORBIDDEN', 403)
        with self.condition:
            # A repeated provider delivery waits for the first attempt; it may
            # never dispatch an identical paid selector/provider query again.
            deadline = time.monotonic() + 590
            while binding.active and binding.completed is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise Failure('REQUEST_UNKNOWN', 504)
                self.condition.wait(min(remaining, 10))
            if binding.completed is not None:
                value = binding.completed
                if '_failure' in value:
                    raise Failure(**value['_failure'])
                return 200, value, {}
            binding.active = True
        try:
            result = self.pipeline.query(binding, question(data['text']))
            self.identity.profile(binding.portal_token)
            with self.condition:
                binding.completed = result
            return 200, result, {}
        except Failure as error:
            with self.condition:
                binding.completed = {'_failure': {'code': error.code, 'status': error.status, 'message': error.message}}
            raise
        except Exception as error:
            # Fail closed and keep the no-replay receipt even for an unexpected
            # worker error. Logging only its class prevents accidental secrets.
            print('matrix_request_error ' + type(error).__name__, flush=True)
            code = getattr(error, 'code', 'MATRIX_UNAVAILABLE')
            if not isinstance(code, str) or not re.fullmatch('[A-Z][A-Z0-9_]{1,80}', code):
                code = 'MATRIX_UNAVAILABLE'
            status = 401 if code == 'AUTH_REQUIRED' else 409
            failure = Failure(code, status)
            with self.condition:
                binding.completed = {'_failure': {'code': failure.code, 'status': failure.status, 'message': failure.message}}
            raise failure from None
        finally:
            with self.condition:
                binding.active = False
                self.condition.notify_all()

    def route(self, method, path, headers, data=None):
        if method == 'GET' and path == '/health':
            return 200, {'ok': True, 'service': 'octoport-harness-gateway',
                         'templates_count': self.pipeline.templates_count}, {}
        if path == '/internal/harness/query':
            if method != 'POST':
                raise Failure('NOT_FOUND', 404)
            return self.internal(headers, data)
        if not path.startswith('/harness/api/'):
            raise Failure('NOT_FOUND', 404)
        if headers.get('Host') != self.origin.removeprefix('https://'):
            raise Failure('FORBIDDEN', 403)
        if method != 'GET':
            require_origin(headers.get('Host'), headers.get('Origin'), self.origin)
        token, profile = self.authenticate(headers)
        scope = self.owner(profile)
        if method == 'GET' and path == '/harness/api/me':
            stores = self.identity.stores(profile)
            engine = self.engine.health()
            return 200, {'user': {'id': profile['customer_id'], 'name': profile.get('display_name') or profile.get('email') or 'Ваш аккаунт',
                                 'email': profile.get('email')},
                'stores': stores, 'ready': bool(engine.get('ok')),
                'templates_count': self.pipeline.templates_count, 'catalog_hash': self.pipeline.catalog_hash,
                'harness_version': engine.get('harness_version'), 'mode': 'matrix_direct_v1',
                'default_api_key_configured': bool(engine.get('default_api_key_configured')),
                'stores_url': '/app/stores/', 'login_url': '/harness/login'}, {}
        if method == 'POST' and path == '/harness/api/logout':
            self.identity.logout(token)
            return 200, {'ok': True, 'login_url': '/login'}, {
                'Set-Cookie': '__Host-alisa_session=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'}
        matched = re.fullmatch(r'/harness/api/reports/([^/]+)/([a-f0-9]{64})', path)
        if method == 'GET' and matched:
            ref = identifier(matched.group(1))
            value = self.pipeline.report(token, profile, ref, matched.group(2))
            return 200, value, {'Content-Type': 'application/json; charset=utf-8',
                               'Content-Disposition': 'attachment; filename="octoport-template-result.json"'}
        if path == '/harness/api/chats':
            if method == 'GET':
                value = self.engine.call('chats/list', scope)
                return 200, {'chats': [public_chat(chat) for chat in value['chats']]}, {}
            if method == 'POST':
                if set(data or {}) - {'title'}:
                    raise Failure('INVALID_PAYLOAD', 422)
                value = self.engine.call('chats/create', scope)
                return 201, {'chat': public_chat(value)}, {}
        matched = re.fullmatch(r'/harness/api/chats/([^/]+)(/messages)?', path)
        if matched:
            chat_id = identifier(matched.group(1))
            if method == 'GET' and not matched.group(2):
                listed = self.engine.call('chats/list', scope)
                chat = next((entry for entry in listed['chats'] if entry['chat_id'] == chat_id), None)
                if chat is None:
                    raise Failure('FORBIDDEN', 403)
                value = self.engine.call('chats/history', {**scope, 'chat_id': chat_id})
                return 200, {'chat': public_chat(chat), 'messages': value['messages']}, {}
            if method == 'POST' and matched.group(2):
                if not isinstance(data, dict) or set(data) - {'text', 'request_id', 'store_ids'}:
                    raise Failure('INVALID_PAYLOAD', 422)
                text = question(data.get('text'))
                request_id = identifier(data.get('request_id'))
                # History performs the engine's durable owner check before
                # the gateway grants any right to the internal adapter.
                self.engine.call('chats/history', {**scope, 'chat_id': chat_id})
                stores = [entry['id'] for entry in self.identity.stores(profile) if entry['status'] == 'ACTIVE']
                chosen = data.get('store_ids', stores)
                if not isinstance(chosen, list) or not chosen or len(chosen) > 1000 or len(set(chosen)) != len(chosen):
                    raise Failure('NO_STORES' if chosen == [] else 'INVALID_STORES', 409)
                if any(identifier(store) not in stores for store in chosen):
                    raise Failure('FORBIDDEN', 403)
                self.bindings.admit(profile, token, chat_id, request_id, text, chosen)
                value = self.engine.call('chats/send', {**scope, 'chat_id': chat_id,
                                        'request_id': request_id, 'text': text})
                return 202, {'request_id': value['job_id'], 'status': 'pending',
                             'duplicate': bool(value.get('duplicate'))}, {}
        matched = re.fullmatch(r'/harness/api/requests/([^/]+)', path)
        if method == 'GET' and matched:
            request_id = identifier(matched.group(1))
            try:
                value = self.engine.call('jobs/status', {**scope, 'job_id': request_id})
            except Failure as error:
                if error.status == 404:
                    return 200, {'status': 'unknown', 'request_id': request_id}, {}
                raise
            state = {'queued': 'pending', 'running': 'running', 'completed': 'completed',
                     'interrupted': 'unknown', 'cancelled': 'failed', 'failed': 'failed'}.get(value.get('state'), 'unknown')
            message = ({'id': value.get('assistant_message_id') or 'request-result-' + request_id,
                        'role': 'assistant', 'text': value['text'], 'metadata': value.get('metadata') or {}}
                       if state == 'completed' and isinstance(value.get('text'), str) else None)
            return 200, {'request_id': request_id, 'status': state, 'message': message if state == 'completed' else None,
                         'text': value.get('text'), 'error': value.get('error'),
                         'usage': value.get('usage'), 'metadata': value.get('metadata'), 'chat_id': value.get('chat_id')}, {}
        raise Failure('NOT_FOUND', 404)


class GatewayServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, app, static_directory):
        self.app, self.static_directory = app, Path(static_directory).resolve()
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = 'Octoport'
    sys_version = ''

    def log_message(self, *_args):
        pass  # Never log URLs, question text, cookies or bearer credentials.

    def respond(self, status, payload, extra=None, content_type='application/json; charset=utf-8'):
        body = payload if isinstance(payload, bytes) else json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        headers = {'Content-Type': content_type, 'Content-Length': str(len(body)), 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
            'Permissions-Policy': 'microphone=(self), camera=(), geolocation=()'}
        headers.update(extra or {})
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        self.handle_request('GET')

    def do_POST(self):
        self.handle_request('POST')

    def handle_request(self, method):
        self.connection.settimeout(650)
        try:
            parsed = urllib.parse.urlsplit(self.path)
            static_path = parsed.path in ('/harness/style.css', '/harness/app.js')
            version_query = not parsed.query or (static_path and re.fullmatch(r'v=[A-Za-z0-9._-]{1,80}', parsed.query))
            if parsed.scheme or parsed.netloc or not version_query or parsed.fragment:
                raise Failure('INVALID_PATH', 400)
            path = parsed.path
            if method == 'GET' and path == '/harness/login':
                if self.headers.get('Host') != 'alisa.octoport.ru':
                    raise Failure('FORBIDDEN', 403)
                return self.respond(303, b'', {'Location': '/login',
                    'Set-Cookie': '__Host-octoport_harness_return=1; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=900'})
            if method == 'GET' and path in ('/harness', '/harness/'):
                target = self.server.static_directory / 'index.html'
                return self.respond(200, target.read_bytes(), {'Set-Cookie':
                    '__Host-octoport_harness_return=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0'},
                    content_type='text/html; charset=utf-8')
            if method == 'GET' and path in ('/harness/style.css', '/harness/app.js'):
                target = self.server.static_directory / path.rsplit('/', 1)[1]
                return self.respond(200, target.read_bytes(), content_type=(mimetypes.guess_type(target.name)[0] or 'application/octet-stream') + '; charset=utf-8')
            data = None
            if method == 'POST':
                if self.headers.get('Transfer-Encoding'):
                    raise Failure('INVALID_BODY', 400)
                if self.headers.get_content_type() != 'application/json':
                    raise Failure('JSON_REQUIRED', 415)
                try:
                    size = int(self.headers.get('Content-Length', '0'))
                except ValueError:
                    raise Failure('INVALID_BODY', 400) from None
                if not 1 <= size <= 65536:
                    raise Failure('INVALID_BODY', 413)
                try:
                    data = json.loads(self.rfile.read(size))
                except (ValueError, UnicodeError):
                    raise Failure('INVALID_JSON', 400) from None
                if not isinstance(data, dict):
                    raise Failure('INVALID_PAYLOAD', 422)
            status, value, headers = self.server.app.route(method, path, self.headers, data)
            self.respond(status, value, headers)
        except Failure as error:
            self.respond(error.status, {'code': error.code, 'error': error.message,
                **({'login_url': '/harness/login'} if error.status == 401 else {})})
        except Exception as error:
            print('gateway_error ' + type(error).__name__, flush=True)
            self.respond(503, {'code': 'SERVICE_UNAVAILABLE', 'error': Failure('SERVICE_UNAVAILABLE').message})


def main():
    os.umask(0o077)
    from runtime_adapter import bootstrap, Identity, AlisaPipeline
    bootstrap()
    identity = Identity()
    credential_directory = Path(os.environ['CREDENTIALS_DIRECTORY'])
    secret = (credential_directory / 'bridge.key').read_text().strip()
    if len(secret) < 32 or '\n' in secret or '\r' in secret:
        raise ValueError('invalid service credential')
    pipeline = AlisaPipeline(os.environ.get('OCTOPORT_GATEWAY_STATE', '/var/lib/octoport-harness/gateway'), identity)
    engine = EngineClient(secret, os.environ.get('OCTOPORT_ENGINE_URL', 'http://127.0.0.1:18132'))
    app = Application(identity, pipeline, engine, secret)
    server = GatewayServer(('127.0.0.1', int(os.environ.get('OCTOPORT_GATEWAY_PORT', '18131'))), app,
        os.environ.get('OCTOPORT_STATIC_DIRECTORY', str(Path(__file__).resolve().parent.parent / 'static')))
    print('harness_gateway_ready', flush=True)
    try:
        server.serve_forever(poll_interval=.3)
    finally:
        pipeline.stop.set()
        server.server_close()


if __name__ == '__main__':
    main()
