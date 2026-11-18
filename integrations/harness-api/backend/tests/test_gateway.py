import concurrent.futures
from http.client import HTTPConnection
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from security import Bindings, Failure, require_origin, session_cookie
from gateway import Application, GatewayServer


A, T, OTHER_A, OTHER_T, STORE, FOREIGN_STORE = [str(uuid.uuid4()) for _ in range(6)]
TOKEN, OTHER_TOKEN, SECRET = 'a' * 43, 'b' * 43, 's' * 48


class Identity:
    def __init__(self):
        self.revoked = set()
        self.profiles = {TOKEN: {'customer_id': A, 'tenant_id': T, 'display_name': 'Первый'},
                         OTHER_TOKEN: {'customer_id': OTHER_A, 'tenant_id': OTHER_T, 'display_name': 'Второй'}}

    def profile(self, token):
        if token not in self.profiles or token in self.revoked:
            raise Failure('AUTH_REQUIRED', 401)
        return self.profiles[token]

    def stores(self, profile):
        return [{'id': STORE if profile['customer_id'] == A else FOREIGN_STORE,
                 'status': 'ACTIVE', 'name': 'Тестовый магазин', 'marketplace': 'OZON'}]

    def logout(self, token):
        self.revoked.add(token)


class Pipeline:
    templates_count, catalog_hash = 90, 'catalog-fixture'

    def __init__(self):
        self.calls = 0
        self.entered, self.release = threading.Event(), threading.Event()
        self.release.set()

    def query(self, binding, text):
        self.calls += 1
        self.entered.set()
        self.release.wait(2)
        return {'text': 'Заказано 17 товаров.', 'usage': {'prompt_tokens': 12, 'completion_tokens': 4},
                'metadata': {'final_model_calls': 0}}


class Engine:
    def __init__(self):
        self.chats, self.jobs, self.calls = {}, {}, []

    def health(self):
        return {'ok': True, 'harness_version': 'fixture', 'default_api_key_configured': True}

    def call(self, operation, value):
        self.calls.append((operation, dict(value)))
        scope = (value['actor_id'], value['tenant_id'])
        if operation == 'chats/create':
            chat = {'chat_id': str(uuid.uuid4()), 'title': 'Новый разговор', 'created_at': 1}
            self.chats[chat['chat_id']] = (scope, chat)
            return chat
        if operation == 'chats/list':
            return {'chats': [chat for owner, chat in self.chats.values() if owner == scope]}
        if operation == 'jobs/status':
            result = self.jobs.get((scope, value['job_id']))
            if result is None:
                raise Failure('JOB_NOT_FOUND', 404)
            return result
        found = self.chats.get(value['chat_id'])
        if not found or found[0] != scope:
            raise Failure('FORBIDDEN', 403)
        if operation == 'chats/history':
            return {'messages': []}
        if operation == 'chats/send':
            key = (scope, value['request_id'])
            self.jobs.setdefault(key, {'state': 'running', 'finished': False, 'chat_id': value['chat_id']})
            return {'job_id': value['request_id'], 'accepted': True, 'chat_id': value['chat_id']}
        raise AssertionError(operation)


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.identity, self.pipeline, self.engine = Identity(), Pipeline(), Engine()
        self.app = Application(self.identity, self.pipeline, self.engine, SECRET)
        self.headers = {'Cookie': '__Host-alisa_session=' + TOKEN, 'Host': 'alisa.octoport.ru',
                        'Origin': 'https://alisa.octoport.ru'}
        self.other = dict(self.headers, Cookie='__Host-alisa_session=' + OTHER_TOKEN)
        self.chat = self.app.route('POST', '/harness/api/chats', self.headers, {})[1]['chat']['id']

    def admitted(self):
        request_id = str(uuid.uuid4())
        text = 'Сколько заказали товаров вчера?'
        result = self.app.route('POST', f'/harness/api/chats/{self.chat}/messages', self.headers,
                               {'request_id': request_id, 'text': text})
        self.assertEqual(result[0], 202)
        return {'actor_id': A, 'tenant_id': T, 'session_id': self.chat, 'request_id': request_id, 'text': text}

    def test_no_cookie_and_foreign_origin_cannot_admit(self):
        for headers in ({'Host': 'alisa.octoport.ru', 'Origin': 'https://alisa.octoport.ru'},
                        dict(self.headers, Origin='https://attacker.invalid'),
                        dict(self.headers, Host='attacker.invalid')):
            with self.assertRaises(Failure):
                self.app.route('POST', '/harness/api/chats', headers, {})
        self.assertEqual(len(self.engine.chats), 1)

    def test_cookie_duplicate_malformed_and_scope_fields_rejected(self):
        for header in ('', '__Host-alisa_session=short',
                       '__Host-alisa_session=' + TOKEN + '; __Host-alisa_session=' + TOKEN):
            with self.assertRaises(Failure):
                session_cookie(header)
        with self.assertRaises(Failure):
            self.app.route('POST', '/harness/api/chats', self.headers, {'actor_id': OTHER_A})

    def test_cross_tenant_chat_and_store_fail_before_binding(self):
        request_id = str(uuid.uuid4())
        for headers, data in ((self.other, {'text': 'Вопрос', 'request_id': request_id}),
                              (self.headers, {'text': 'Вопрос', 'request_id': request_id, 'store_ids': [FOREIGN_STORE]})):
            with self.assertRaises(Failure):
                self.app.route('POST', f'/harness/api/chats/{self.chat}/messages', headers, data)
        self.assertFalse(self.app.bindings._values)
        self.assertFalse(self.engine.jobs)

    def test_bridge_secret_alone_never_authorizes_actor(self):
        body = {'actor_id': A, 'tenant_id': T, 'session_id': self.chat,
                'request_id': str(uuid.uuid4()), 'text': 'Вопрос'}
        with self.assertRaises(Failure):
            self.app.internal({'Authorization': 'Bearer ' + SECRET}, body)
        self.assertEqual(self.pipeline.calls, 0)

    def test_binding_exact_scope_and_no_replay(self):
        data = self.admitted()
        for field, value in [('actor_id', OTHER_A), ('tenant_id', OTHER_T), ('text', 'Другой вопрос')]:
            with self.assertRaises(Failure):
                self.app.internal({'Authorization': 'Bearer ' + SECRET}, dict(data, **{field: value}))
        first = self.app.internal({'Authorization': 'Bearer ' + SECRET}, data)
        second = self.app.internal({'Authorization': 'Bearer ' + SECRET}, data)
        self.assertEqual(first, second)
        self.assertEqual(self.pipeline.calls, 1)

    def test_simultaneous_duplicate_waits_for_one_execution(self):
        data = self.admitted()
        self.pipeline.release.clear()
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(self.app.internal, {'Authorization': 'Bearer ' + SECRET}, data)
            self.assertTrue(self.pipeline.entered.wait(1))
            second = pool.submit(self.app.internal, {'Authorization': 'Bearer ' + SECRET}, data)
            self.pipeline.release.set()
            self.assertEqual(first.result(), second.result())
        self.assertEqual(self.pipeline.calls, 1)

    def test_revoked_session_does_not_read_cached_internal_result(self):
        data = self.admitted()
        self.app.internal({'Authorization': 'Bearer ' + SECRET}, data)
        self.identity.logout(TOKEN)
        with self.assertRaises(Failure) as raised:
            self.app.internal({'Authorization': 'Bearer ' + SECRET}, data)
        self.assertEqual(raised.exception.status, 401)
        self.assertEqual(self.pipeline.calls, 1)

    def test_failed_internal_attempt_is_not_automatically_retried(self):
        data = self.admitted()
        def rejected(*_args):
            self.pipeline.calls += 1
            raise Failure('REQUEST_UNKNOWN', 504)
        self.pipeline.query = rejected
        for _ in range(2):
            with self.assertRaises(Failure):
                self.app.internal({'Authorization': 'Bearer ' + SECRET}, data)
        self.assertEqual(self.pipeline.calls, 1)

    def test_binding_expiry_and_changed_store_selection_fail_closed(self):
        now = [10]
        bindings = Bindings(clock=lambda: now[0], ttl=30)
        data = self.admitted()
        profile = self.identity.profile(TOKEN)
        bindings.admit(profile, TOKEN, self.chat, data['request_id'], data['text'], [STORE])
        with self.assertRaises(Failure):
            bindings.admit(profile, TOKEN, self.chat, data['request_id'], data['text'], [FOREIGN_STORE])
        now[0] = 41
        with self.assertRaises(Failure):
            bindings.resolve(data)

    def test_duplicate_from_new_owner_login_cannot_replace_admitted_session(self):
        data = self.admitted()
        second_token = 'c' * 43
        self.identity.profiles[second_token] = self.identity.profiles[TOKEN]
        headers = dict(self.headers, Cookie='__Host-alisa_session=' + second_token)
        self.app.route('POST', f'/harness/api/chats/{self.chat}/messages', headers,
                       {'request_id': data['request_id'], 'text': data['text']})
        self.assertEqual(self.app.bindings.resolve(data).portal_token, TOKEN)
        self.identity.logout(TOKEN)
        with self.assertRaises(Failure) as raised:
            self.app.internal({'Authorization': 'Bearer ' + SECRET}, data)
        self.assertEqual(raised.exception.status, 401)
        self.assertEqual(self.pipeline.calls, 0)

    def test_poll_returns_specific_turn_text_not_latest_history(self):
        data = self.admitted()
        self.engine.jobs[((A, T), data['request_id'])] = {'state': 'completed', 'finished': True,
            'chat_id': self.chat, 'text': 'Ответ первого запроса',
            'messages': [{'id': 'later', 'role': 'assistant', 'text': 'Ответ другого запроса'}]}
        result = self.app.route('GET', '/harness/api/requests/' + data['request_id'], self.headers)[1]
        self.assertEqual(result['message']['text'], 'Ответ первого запроса')
        self.assertEqual(self.app.route('GET', '/harness/api/requests/' + data['request_id'], self.other)[1]['status'], 'unknown')

    def test_http_static_version_and_fixed_login_return(self):
        with tempfile.TemporaryDirectory() as directory:
            for name in ('index.html', 'app.js', 'style.css'):
                Path(directory, name).write_text('fixture')
            server = GatewayServer(('127.0.0.1', 0), self.app, directory)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                def get(path):
                    connection = HTTPConnection(*server.server_address, timeout=2)
                    connection.request('GET', path, headers={'Host': 'alisa.octoport.ru'})
                    response = connection.getresponse()
                    result = response.status, dict(response.getheaders()), response.read()
                    connection.close()
                    return result
                self.assertEqual(get('/harness/app.js?v=api-r1')[0], 200)
                self.assertEqual(get('/harness/app.js?redirect=https://attacker.invalid')[0], 400)
                self.assertEqual(get('/harness/api/me?actor_id=' + A)[0], 400)
                status, headers, _ = get('/harness/login')
                self.assertEqual((status, headers['Location']), (303, '/login'))
                self.assertIn('HttpOnly', headers['Set-Cookie'])
                self.assertIn('Max-Age=0', get('/harness/')[1]['Set-Cookie'])
                self.assertEqual(get('/harness/../backend/security.py')[0], 404)
            finally:
                server.shutdown(); server.server_close(); thread.join(2)


if __name__ == '__main__':
    unittest.main()
