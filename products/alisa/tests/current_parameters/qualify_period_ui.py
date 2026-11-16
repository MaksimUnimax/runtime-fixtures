"""Real React component, locked compiler, synthetic HTTP only; no DB or provider.

This proves UI interpretation of an attested period, not discovery of history.
Run against a bundle from build_ui_fixture.cjs in the same owned temp directory.
"""
from copy import deepcopy
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
import argparse
import json
import time
import os
import stat
import re
from playwright.sync_api import sync_playwright, expect

SID = '11111111-1111-4111-8111-111111111111'
AREA = {'kind': 'store', 'sku': ''}
REQUESTED = {'from': '2025-11-16', 'to': '2026-11-15'}
ACTUAL = {'from': '2026-08-15', 'to': '2026-11-15'}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--case', choices=['period', 'preview', 'replace', 'prepare_change', 'read_change', 'all'], default='all')
    parser.add_argument('--browser', type=Path)
    args = parser.parse_args()
    work = args.bundle.parent
    if not (args.bundle.is_absolute() and work.parent == Path('/dev/shm')
            and work.name.startswith('alisa-r5-period-ui-') and work.resolve(strict=True) == work):
        raise RuntimeError('DISPOSABLE_BUNDLE_REQUIRED')
    root_stat = work.lstat()
    if not (stat.S_ISDIR(root_stat.st_mode) and root_stat.st_uid == os.getuid()
            and not root_stat.st_mode & 0o022 and not work.is_symlink()):
        raise RuntimeError('DISPOSABLE_DIRECTORY_REQUIRED')
    bundle_stat = args.bundle.lstat()
    if not (args.bundle.name == 'bundle.js' and stat.S_ISREG(bundle_stat.st_mode)
            and bundle_stat.st_uid == os.getuid() and not args.bundle.is_symlink()):
        raise RuntimeError('DISPOSABLE_BUNDLE_REQUIRED')
    if not (args.output.is_absolute() and args.output.parent == work and args.output.suffix == '.json'
            and not args.output.exists() and not args.output.is_symlink()):
        raise RuntimeError('DISPOSABLE_OUTPUT_REQUIRED')
    state = {'short': True, 'commands': [], 'held': Event(), 'release': Event(), 'hold_start': False, 'hold_action': None, 'preflight_held': Event(), 'preflight_release': Event()}
    row = {'parameter': 'loss_rate', 'scope': AREA, 'state': 'VALUE', 'revision': 1,
           'value': '0.07', 'unit': 'ratio', 'origin': 'manual', 'collected_at': None,
           'calculated_at': None, 'updated_at': '2026-11-16T00:00:00Z',
           'requested_period': None, 'actual_period': None, 'evidence': {}}

    def current():
        return {'store_id': SID, 'parameter': 'loss_rate', 'scope': AREA, 'revision': 1,
                'state': 'VALUE', 'current': deepcopy(row), 'effective': deepcopy(row),
                'inherited': False, 'server_time': int(time.time())}

    class Handler(BaseHTTPRequestHandler):
        def send(self, body, mime):
            self.send_response(200)
            self.send_header('Content-Type', mime + '; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path == '/bundle.js':
                return self.send(args.bundle.read_bytes(), 'text/javascript')
            return self.send(b'<!doctype html><html><body><div id="root"></div><script src="/bundle.js"></script></body></html>', 'text/html')

        def do_POST(self):
            if self.path != '/api/account/parameters':
                self.send_error(404); return
            cmd = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
            state['commands'].append(deepcopy(cmd))
            action = cmd['action']
            if state['hold_action'] == action:
                state['hold_action'] = None
                state['preflight_held'].set()
                if not state['preflight_release'].wait(10):
                    self.send_error(504); return
            if action == 'catalog':
                result = {'definitions': [{'key': 'loss_rate', 'label': 'Коэффициент потерь',
                    'unit': 'ratio', 'minimum': '0', 'maximum': '1', 'scopes': ['store'],
                    'producer_template': 'parameter.loss_rate.v1', 'collection': {'available': True, 'code': 'READY'}}]}
            elif action == 'read': result = current()
            elif action == 'prepare_calculation':
                result = {**current(), 'prepared': True, 'dispatched': False,
                    'period': {'requested': REQUESTED, 'actual': ACTUAL if state['short'] else REQUESTED},
                    'period_reference': 'fixture-period-short' if state['short'] else 'fixture-period-full',
                    'collection': {'available': True, 'code': 'READY'}}
            elif action == 'start_calculation':
                assert cmd.get('period_reference') == ('fixture-period-short' if state['short'] else 'fixture-period-full')
                state['held'].set()
                if state['hold_start'] and not state['release'].wait(10):
                    self.send_error(504); return
                result = {'dispatched': True, 'collection': {'id': cmd['command_id'], 'state': 'QUEUED', 'mode': cmd['mode']}}
            else:
                self.send_error(400); return
            self.send(json.dumps(result).encode(), 'application/json')

        def log_message(self, *_): pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True); thread.start()
    origin = 'http://127.0.0.1:' + str(server.server_port)
    checks, errors, forbidden = [], [], []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True, executable_path=str(args.browser) if args.browser else None, args=['--no-sandbox'])
            try:
                cases = ['period', 'preview', 'replace', 'prepare_change', 'read_change'] if args.case == 'all' else [args.case]
                for case in cases:
                    state['commands'].clear(); state['held'].clear(); state['release'].clear()
                    state['preflight_held'].clear(); state['preflight_release'].clear(); state['hold_action'] = None
                    state['hold_start'] = case == 'replace'
                    context = browser.new_context()
                    def route(request):
                        if request.request.url.startswith(origin + '/'): request.continue_()
                        else: forbidden.append(request.request.url); request.abort()
                    context.route('**/*', route)
                    page = context.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
                    page.goto(origin)
                    expect(page.get_by_test_id('current-value')).to_have_text('7 %')
                    if case == 'period':
                        expect(page.get_by_text('По умолчанию — год. Период можно изменить перед расчётом. Полнота данных проверяется при сборе.', exact=True)).to_be_visible()
                        checks.append('help_does_not_promise_unimplemented_history_discovery')
                        page.get_by_role('button', name='Проверить период и доступность сбора', exact=True).click()
                        expect(page.get_by_role('status')).to_contain_text('2026-08-15 — 2026-11-15')
                        expect(page.get_by_role('status')).to_contain_text('2025-11-16 — 2026-11-15')
                        assert not any(c['action'] == 'start_calculation' for c in state['commands'])
                        checks.append('attested_actual_and_requested_period_visible_without_submission')
                        state['short'] = False
                        page.get_by_role('button', name='Проверить период и доступность сбора', exact=True).click()
                        expect(page.get_by_role('status')).to_contain_text('Период: 2025-11-16 — 2026-11-15')
                        expect(page.get_by_role('status')).not_to_contain_text('Запрошенный период:')
                        checks.append('complete_year_has_no_false_shortening')
                    elif case in ('prepare_change', 'read_change'):
                        page.get_by_label('Режим расчёта', exact=True).select_option('preview')
                        state['hold_action'] = 'prepare_calculation' if case == 'prepare_change' else 'read'
                        with page.expect_request(lambda req: req.method == 'POST' and req.url == origin + '/api/account/parameters' and req.post_data_json.get('action') == ('prepare_calculation' if case == 'prepare_change' else 'read')):
                            page.get_by_role('button', name='Рассчитать без сохранения', exact=True).click()
                        deadline = time.monotonic() + 5
                        while not state['preflight_held'].is_set() and time.monotonic() < deadline:
                            page.wait_for_timeout(10)
                        assert state['preflight_held'].is_set() and not state['preflight_release'].is_set()
                        page.get_by_label('Режим расчёта', exact=True).select_option('replace')
                        state['preflight_release'].set()
                        notice = page.get_by_role('status').filter(has_text=re.compile(r'Параметры формы изменились|Расчёт.*принят'))
                        expect(notice).to_have_count(1)
                        starts = [c for c in state['commands'] if c['action'] == 'start_calculation']
                        assert not starts, {'unexpected_start_count': len(starts), 'case': case}
                        expect(notice).to_have_text('Параметры формы изменились. Расчёт не запускался.')
                        assert page.evaluate("Object.keys(localStorage).filter(k=>k.endsWith(':collection')).length") == 0
                        expect(page.get_by_test_id('current-value')).to_have_text('7 %')
                        checks.append(case + '_never_admits_or_records_pending')
                    else:
                        mode = 'preview' if case == 'preview' else 'replace'
                        page.get_by_label('Режим расчёта', exact=True).select_option(mode)
                        button = page.get_by_role('button', name='Рассчитать без сохранения' if mode == 'preview' else 'Рассчитать и заменить', exact=True)
                        if case == 'replace':
                            # Keep Playwright's event loop running while the HTTP reply is held.
                            with page.expect_request(lambda req: req.method == 'POST' and req.url == origin + '/api/account/parameters' and req.post_data_json.get('action') == 'start_calculation'):
                                button.click()
                            deadline = time.monotonic() + 5
                            while not state['held'].is_set() and time.monotonic() < deadline:
                                page.wait_for_timeout(10)  # Pump routed browser requests until server latch.
                            assert state['held'].is_set() and not state['release'].is_set()
                            page.get_by_label('Режим расчёта', exact=True).select_option('preview')
                            assert state['held'].is_set() and not state['release'].is_set()
                            checks.append('server_response_held_until_mode_switch')
                            state['release'].set()
                        else: button.click()
                        expect(page.get_by_role('button', name='Проверить расчёт', exact=True)).to_be_enabled()
                        if mode == 'preview':
                            notice=page.get_by_role('status').filter(has_text='Расчёт без сохранения принят.')
                            expect(notice).to_have_count(1)
                            expect(notice).to_contain_text('Текущее число не изменится.')
                            expect(notice).not_to_contain_text('будет заменено')
                            checks.append('preview_admission_does_not_claim_replacement')
                        else:
                            notice=page.get_by_role('status').filter(has_text='Расчёт принят.')
                            expect(notice).to_have_count(1)
                            expect(notice).to_contain_text('Текущее число будет заменено только после успешного завершения.')
                            checks.append('notice_remains_bound_to_admitted_mode_after_ui_switch')
                        starts = [c for c in state['commands'] if c['action'] == 'start_calculation']
                        assert len(starts) == 1 and starts[0]['mode'] == mode
                        assert starts[0]['period_reference'] == ('fixture-period-short' if state['short'] else 'fixture-period-full')
                        checks.append(mode + '_prepared_reference_forwarded')
                        assert not any(c['action'] in ['set_manual', 'use_general'] for c in state['commands'])
                        expect(page.get_by_test_id('current-value')).to_have_text('7 %')
                        checks.append(mode + '_one_submission_no_manual_write_or_value_change')
                    context.close()
                assert not forbidden and not errors, (forbidden, errors)
            finally: browser.close()
        result = {'status': 'PASS', 'checks': checks, 'external_requests': 0,
                  'scope': 'real client component with synthetic HTTP; no Next BFF, DB, marketplace or installed history discovery'}
        with args.output.open('x', encoding='utf-8') as receipt:
            receipt.write(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result))
    finally:
        state['release'].set(); state['preflight_release'].set(); server.shutdown(); server.server_close(); thread.join(2)


if __name__ == '__main__': main()
