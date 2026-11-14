"""Actual Next UI against an owned loopback fixture; no live auth/DB/providers."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json, os, re, signal, socket, subprocess, tempfile, threading, time, urllib.request
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
IDS = ['00000000-0000-4000-8000-00000000000' + str(n) for n in (1, 2, 3)]
NAMES = ['Первый магазин', 'Второй магазин', 'Третий магазин']
state = {'submissions': 0, 'pages': 0, 'external': []}


def store(n):
    return {'id': IDS[n], 'name': NAMES[n], 'provider': 'OZON', 'status': 'ACTIVE',
            'identity_verified': True, 'credentials': []}


class Fixture(BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if self.path.endswith('/me'):
            value = {'profile': {'customer_id': IDS[0], 'tenant_id': IDS[0], 'email': 'fixture@example.invalid',
                     'display_name': 'Тест', 'role': 'OWNER_CLIENT', 'access_status': 'ACTIVE', 'stores': []}}
        elif self.path.endswith('/stores'):
            if body['command'].get('cursor'):
                state['pages'] += 1
                value = {'items': [store(2)], 'next_cursor': 'next-fixture' if state['pages'] == 1 else None}
            else: value = {'items': [store(0), store(1)], 'next_cursor': 'next-fixture'}
        elif self.path.endswith('/question-catalog'):
            sid = body['store_id']; query = body['query']
            value = {'items': [{'id': 'orders', 'version': 1, 'kind': 'scalar',
                      'description': 'Количество заказанных товаров', 'platforms': ['ozon'], 'units': ['шт'],
                      'dependencies': [], 'input_policy': {'time_axis': 'order_period', 'snapshot': False,
                      'period_required': True, 'comparison_supported': True, 'filters_supported': True},
                      'availability': [{'store_id': sid, 'status': 'ELIGIBLE'}]},
                     {'id': 'accruals', 'version': 2, 'kind': 'dataset', 'description': 'Начисления по дате начисления',
                      'platforms': ['ozon'], 'units': ['RUB'], 'dependencies': [],
                      'input_policy': {'time_axis': 'accrual_date', 'snapshot': False, 'period_required': True,
                      'comparison_supported': False, 'filters_supported': False},
                      'availability': [{'store_id': sid, 'status': 'UNAVAILABLE'}]}], 'next_offset': None}
            value['items'] = [r for r in value['items'] if query['search'].casefold() in r['description'].casefold()
                              and (not query['kind'] or r['kind'] == query['kind'])]
            value['total'] = len(value['items'])
        elif self.path.endswith('/queries'):
            if body['command']['action'] != 'list': state['submissions'] += 1
            value = {'items': []}
        else:
            self.send_error(404); return
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)


def run():
    api = ThreadingHTTPServer(('127.0.0.1', 0), Fixture)
    threading.Thread(target=api.serve_forever, daemon=True).start()
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
    origin = 'http://127.0.0.1:' + str(port)
    env = {k:v for k,v in os.environ.items() if not k.startswith(('ALISA_', 'DATABASE_', 'PG'))}
    env.update(ALISA_ENV='dev', ALISA_ACCOUNTS_ENABLED='1', ALISA_QUERIES_ENABLED='1',
               ALISA_QUESTION_CATALOG_ENABLED='1', ALISA_PUBLIC_BASE_URL=origin,
               ALISA_PLATFORM_URL='http://127.0.0.1:' + str(api.server_port),
               ALISA_AUTH_SERVICE_TOKEN='synthetic-loopback-fixture-only-key', NEXT_TELEMETRY_DISABLED='1')
    app = ROOT / 'apps/web'
    node = os.environ.get('CATALOG_NODE', 'node')
    with tempfile.TemporaryDirectory(prefix='alisa-catalog-browser-') as folder:
        with (Path(folder)/'next.log').open('w') as log:
            process = subprocess.Popen([node, str(app/'node_modules/next/dist/bin/next'), 'dev', '--webpack',
                                        '--hostname', '127.0.0.1', '--port', str(port)], cwd=app,
                                       env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            try:
                for _ in range(120):
                    if process.poll() is not None: raise AssertionError((Path(folder)/'next.log').read_text()[-3000:])
                    try: urllib.request.urlopen(origin+'/health/live', timeout=1); break
                    except Exception:
                        try:
                            with socket.create_connection(('127.0.0.1', port), timeout=.2): break
                        except OSError: time.sleep(.25)
                with sync_playwright() as pw:
                    browser = pw.chromium.launch(headless=True)
                    try:
                        context = browser.new_context(extra_http_headers={'Cookie': '__Host-alisa_session='+'A'*43})
                        def confined(route):
                            if route.request.url.startswith(origin+'/'): route.continue_()
                            else: state['external'].append('blocked'); route.abort()
                        context.route('**/*', confined)
                        page = context.new_page(); page.goto(origin+'/app/catalog', wait_until='networkidle')
                        expect(page.get_by_role('heading', name='Поддерживаемые вопросы', exact=True)).to_be_visible()
                        expect(page.get_by_text('Дата финансового начисления', exact=False)).to_be_visible()
                        page.get_by_label('Магазин', exact=True).select_option(IDS[1])
                        expect(page.get_by_role('status')).to_contain_text('Найдено: 2')
                        page.get_by_role('button', name='Показать ещё магазины', exact=True).click()
                        expect(page.get_by_role('status')).to_contain_text('Текущий выбор сохранён')
                        expect(page.get_by_label('Магазин', exact=True)).to_have_value(IDS[1])
                        page.get_by_role('button', name='Показать ещё магазины', exact=True).click()
                        expect(page.get_by_label('Магазин', exact=True).locator('option')).to_have_count(4)
                        page.get_by_label('Найти вопрос', exact=True).fill('Начисления')
                        page.get_by_role('button', name='Найти', exact=True).click()
                        expect(page.get_by_role('status')).to_contain_text('Найдено: 1')
                        page.get_by_role('button', name='Найти', exact=True).click()
                        expect(page.get_by_role('heading', name='Начисления по дате начисления')).to_be_visible()
                        page.get_by_role('link', name='Подготовить вопрос в форме').click()
                        expect(page.get_by_label('Второй магазин · OZON', exact=True)).to_be_checked()
                        expect(page.get_by_label('Первый магазин · OZON', exact=True)).not_to_be_checked()
                        expect(page.get_by_role('textbox', name='Вопрос', exact=True)).to_have_value(re.compile('Начисления'))
                        assert not state['submissions'] and not state['external'], state
                        print(json.dumps({'status':'PASS', 'checks': ['rendered_catalog', 'date_axis',
                            'selected_store_preserved', 'repeated_cursor_recovery', 'search', 'repeat_search',
                            'draft_store_and_text', 'zero_submissions', 'zero_external_browser_requests']}))
                    finally: browser.close()
            finally:
                try: os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError: pass
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=5)
                api.shutdown(); api.server_close()


if __name__ == '__main__': run()
