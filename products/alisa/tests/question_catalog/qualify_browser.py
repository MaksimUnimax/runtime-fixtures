"""Actual Next UI against an owned loopback fixture; no live auth/DB/providers."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json, os, re, signal, socket, subprocess, tempfile, threading, time, urllib.request
from datetime import datetime, timedelta, timezone
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[2]
IDS = ['00000000-0000-4000-8000-00000000000' + str(n) for n in (1, 2, 3)]
NAMES = ['Первый магазин', 'Второй магазин', 'Третий магазин']
state = {'submissions': 0, 'pages': 0, 'external': []}


def store(n):
    return {'id': IDS[n], 'name': NAMES[n], 'provider': 'WB' if n == 1 else 'OZON', 'status': 'ACTIVE',
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
                      'description': 'Количество заказанных товаров', 'platforms': ['ozon', 'wb'], 'units': ['шт'],
                      'dependencies': [], 'input_policy': {'time_axis': 'order_period', 'snapshot': False,
                      'period_required': True, 'comparison_supported': True, 'filters_supported': True},
                      'availability': [{'store_id': sid, 'status': 'ELIGIBLE'}]},
                     {'id': 'accruals', 'version': 2, 'kind': 'dataset', 'description': 'Начисления по дате начисления',
                      'platforms': ['ozon', 'wb'], 'units': ['RUB'], 'dependencies': [],
                      'input_policy': {'time_axis': 'accrual_date', 'snapshot': False, 'period_required': True,
                      'comparison_supported': False, 'filters_supported': False},
                      'availability': [{'store_id': sid, 'status': 'UNAVAILABLE'}]}], 'next_offset': None}
            value['items'].extend([
                {'id': 'snapshot', 'version': 1, 'kind': 'scalar', 'description': 'Текущие остатки',
                 'platforms': ['ozon', 'wb'], 'units': ['шт'], 'dependencies': [],
                 'input_policy': {'time_axis': 'snapshot', 'snapshot': True, 'period_required': False,
                                  'comparison_supported': False, 'filters_supported': False},
                 'availability': [{'store_id': sid, 'status': 'ELIGIBLE'}]},
                {'id': 'parameter.loss_rate.v1', 'version': 1, 'kind': 'parameter', 'description': 'Коэффициент потерь',
                 'platforms': ['ozon'], 'units': ['ratio'], 'dependencies': [],
                 'input_policy': {'time_axis': 'parameter_period', 'snapshot': False, 'period_required': False,
                                  'comparison_supported': False, 'filters_supported': True},
                 'availability': [{'store_id': sid, 'status': 'ELIGIBLE' if sid == IDS[0] else 'UNAVAILABLE'}]}
            ])
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
                        page = context.new_page(); page.clock.install(); page.goto(origin+'/app/catalog', wait_until='networkidle')
                        expect(page.get_by_role('heading', name='Поддерживаемые вопросы', exact=True)).to_be_visible()
                        expect(page.get_by_text('Дата финансового начисления', exact=False)).to_be_visible()
                        page.get_by_label('Магазин', exact=True).select_option(IDS[1])
                        expect(page.get_by_role('status')).to_contain_text('Найдено: 4')
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
                        expect(page.get_by_label('Второй магазин · WB', exact=True)).to_be_checked()
                        expect(page.get_by_label('Первый магазин · OZON', exact=True)).not_to_be_checked()
                        expect(page.get_by_role('textbox', name='Вопрос', exact=True)).to_have_value(re.compile('Начисления'))
                        # Repeat the actual UI flow with explicit dates and a different platform.
                        page.goto(origin+'/app/catalog', wait_until='networkidle')
                        expect(page.get_by_text('Площадка: OZON.', exact=True)).to_be_visible()
                        page.get_by_label('Период', exact=True).select_option('custom')
                        page.get_by_label('Дата начала', exact=True).fill('2026-11-10')
                        page.get_by_label('Дата окончания', exact=True).fill('2026-11-01')
                        expect(page.get_by_role('group', name='Период примера', exact=True).get_by_role('alert')).to_contain_text('Дата начала')
                        dated = page.get_by_role('heading', name='Начисления по дате начисления', exact=True).locator('..')
                        expect(dated.get_by_role('link', name='Подготовить вопрос в форме')).to_have_count(0)
                        snapshot = page.get_by_role('heading', name='Текущие остатки', exact=True).locator('..')
                        coefficient = page.get_by_role('heading', name='Коэффициент потерь', exact=True).locator('..')
                        expect(snapshot.get_by_text('Пример: Покажи Текущие остатки сейчас', exact=True)).to_be_visible()
                        expect(coefficient.get_by_text('Пример: Покажи Коэффициент потерь', exact=True)).to_be_visible()
                        page.get_by_label('Дата начала', exact=True).fill('2026-11-01')
                        page.get_by_label('Дата окончания', exact=True).fill('2026-11-10')
                        expect(page.get_by_role('group', name='Период примера', exact=True).get_by_role('alert')).to_have_count(0)
                        expected = 'Покажи Начисления по дате начисления с 01.11.2026 по 10.11.2026'
                        expect(dated.get_by_text('Пример: '+expected, exact=True)).to_be_visible()
                        before_day = page.get_by_label('Дата окончания', exact=True).get_attribute('max')
                        page.get_by_label('Период', exact=True).select_option('last7')
                        expect(page.get_by_label('Дата начала', exact=True)).to_have_count(0)
                        expect(dated.get_by_text(re.compile(r'Пример: Покажи Начисления по дате начисления с \d{2}\.\d{2}\.\d{4} по'))).to_be_visible()
                        before_text = dated.get_by_text(re.compile(r'Пример: Покажи Начисления по дате начисления с')).inner_text()
                        page.clock.fast_forward(24*60*60*1000)
                        expected_range = re.search(r'с (\d{2}\.\d{2}\.\d{4}) по (\d{2}\.\d{2}\.\d{4})', before_text)
                        assert expected_range
                        advanced = [(datetime.strptime(v, '%d.%m.%Y')+timedelta(days=1)).strftime('%d.%m.%Y') for v in expected_range.groups()]
                        expect(dated.get_by_text('Пример: Покажи Начисления по дате начисления с '+advanced[0]+' по '+advanced[1], exact=True)).to_be_visible()
                        page.get_by_label('Период', exact=True).select_option('custom')
                        expected_max = (datetime.strptime(before_day, '%Y-%m-%d')+timedelta(days=1)).strftime('%Y-%m-%d')
                        expect(page.get_by_label('Дата окончания', exact=True)).to_have_attribute('max', expected_max)
                        # set_system_time moves wall time without advancing performance/timers: device-sleep case.
                        wall_ms = page.evaluate('Date.now()')
                        page.clock.set_system_time(datetime.fromtimestamp(wall_ms/1000, timezone.utc)+timedelta(days=1))
                        page.evaluate("window.dispatchEvent(new Event('focus'))")
                        after_sleep_max = (datetime.strptime(expected_max, '%Y-%m-%d')+timedelta(days=1)).strftime('%Y-%m-%d')
                        expect(page.get_by_label('Дата окончания', exact=True)).to_have_attribute('max', after_sleep_max)
                        expect(page.get_by_label('Дата начала', exact=True)).to_have_value('2026-11-01')
                        expect(page.get_by_label('Дата окончания', exact=True)).to_have_value('2026-11-10')
                        page.get_by_label('Магазин', exact=True).select_option(IDS[1])
                        expect(page.get_by_text('Площадка: WB.', exact=True)).to_be_visible()
                        expect(dated.get_by_text('Пример: '+expected, exact=True)).to_be_visible()
                        if os.environ.get('CATALOG_SCREENSHOTS'):
                            output = Path(os.environ['CATALOG_SCREENSHOTS']); output.mkdir(parents=True, exist_ok=True)
                            page.screenshot(path=str(output/'catalog-period-fixture.png'), full_page=True)
                        dated.get_by_role('link', name='Подготовить вопрос в форме').click()
                        expect(page.get_by_label('Второй магазин · WB', exact=True)).to_be_checked()
                        expect(page.get_by_role('textbox', name='Вопрос', exact=True)).to_have_value(expected)
                        if os.environ.get('CATALOG_SCREENSHOTS'):
                            page.screenshot(path=str(output/'catalog-period-prefill-fixture.png'), full_page=True)
                        # A click must also refresh a stale link before the next minute/focus event.
                        page.goto(origin+'/app/catalog', wait_until='networkidle')
                        page.get_by_label('Магазин', exact=True).select_option(IDS[1])
                        page.get_by_label('Период', exact=True).select_option('last7')
                        dated = page.get_by_role('heading', name='Начисления по дате начисления', exact=True).locator('..')
                        click_before = dated.get_by_text(re.compile(r'Пример: Покажи Начисления по дате начисления с')).inner_text()
                        values = re.search(r'с (\d{2}\.\d{2}\.\d{4}) по (\d{2}\.\d{2}\.\d{4})', click_before).groups()
                        click_dates = [(datetime.strptime(v, '%d.%m.%Y')+timedelta(days=1)).strftime('%d.%m.%Y') for v in values]
                        wall_ms = page.evaluate('Date.now()')
                        page.clock.set_system_time(datetime.fromtimestamp(wall_ms/1000, timezone.utc)+timedelta(days=1))
                        dated.get_by_role('link', name='Подготовить вопрос в форме').click()
                        expect(page.get_by_role('textbox', name='Вопрос', exact=True)).to_have_value('Покажи Начисления по дате начисления с '+click_dates[0]+' по '+click_dates[1])
                        expect(page.get_by_label('Второй магазин · WB', exact=True)).to_be_checked()
                        assert not state['submissions'] and not state['external'], state
                        print(json.dumps({'status':'PASS', 'checks': ['rendered_catalog', 'date_axis',
                            'selected_store_preserved', 'repeated_cursor_recovery', 'search', 'repeat_search',
                            'draft_store_and_text', 'invalid_period_blocks_draft', 'custom_period_visible',
                            'seven_complete_days', 'open_tab_midnight_rollover', 'date_input_max_rollover', 'device_sleep_wake', 'click_refreshes_stale_period', 'custom_dates_preserved', 'snapshot_ignores_report_dates',
                            'parameter_keeps_own_period', 'platform_switch', 'explicit_period_prefill',
                            'zero_submissions', 'zero_external_browser_requests']}))
                    finally: browser.close()
            finally:
                try: os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError: pass
                try: process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=5)
                api.shutdown(); api.server_close()


if __name__ == '__main__': run()
