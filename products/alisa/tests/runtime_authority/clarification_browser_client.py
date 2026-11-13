"""Real authenticated BFF/PG continuation; lose one accepted HTTP response only."""
import http.client
import json
import ssl
import sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

data = json.load(sys.stdin)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    try:
        context = browser.new_context(ignore_https_errors=False)
        denied, submissions = [], []
        def confined(route):
            if route.request.url.startswith(data['origin'] + '/'):
                route.continue_()
            else:
                denied.append('external'); route.abort()
        context.route('**/*', confined)
        context.add_cookies([{'name': '__Host-alisa_session', 'value': data['session'],
            'url': data['origin'], 'httpOnly': True, 'secure': True, 'sameSite': 'Lax'}])
        endpoint = data['origin'] + '/api/v1/queries/' + data['query_id'] + '/clarify'
        origin = urlsplit(data['origin'])
        if origin.scheme != 'https' or origin.hostname != '127.0.0.1':
            raise AssertionError('Expected owned loopback HTTPS origin')
        tls = ssl.create_default_context(cafile=data['ca'])
        def lose_once(route):
            submissions.append(route.request.post_data_json)
            # Chromium trusts the fixture CA through NSS. Playwright's separate
            # Route.fetch HTTP client does not inherit that trust store.
            # Forward the exact request with explicit CA verification; no redirects.
            peer = http.client.HTTPSConnection(origin.hostname, origin.port, context=tls, timeout=10)
            try:
                peer.request('POST', urlsplit(endpoint).path,
                    body=route.request.post_data.encode(), headers=route.request.all_headers())
                response = peer.getresponse(); status = response.status; body = response.read(65537)
                if status not in [200, 201] or len(body) > 65536:
                    raise AssertionError('Real continuation was not accepted: ' + str(status))
            finally:
                peer.close()
            if len(submissions) == 1:
                route.fulfill(status=503, json={'code': 'UNKNOWN_OUTCOME'})
            else:
                route.fulfill(status=status, content_type='application/json', body=body)
        context.route(endpoint, lose_once)
        page = context.new_page(); page.goto(data['origin'] + '/app/queries', wait_until='networkidle')
        page.get_by_role('region', name='Мои задания').get_by_role('button').filter(has_text='Нужно уточнение').click()
        page.get_by_role('button', name='Ответить на уточнение', exact=True).click()
        card = page.get_by_role('region', name='Карточка задания')
        expect(card).to_contain_text(data['question'])
        expect(card.get_by_role('button', name='Ответ не тот', exact=True)).to_have_count(0)
        answer = card.get_by_role('textbox', name='Ответ на уточнение', exact=True)
        answer.fill('за октябрь 2026')
        with page.expect_response(endpoint) as first:
            card.get_by_role('button', name='Продолжить задание', exact=True).click()
        if first.value.status != 503:
            raise AssertionError('Lost response fixture was not observed')
        expect(answer).to_be_disabled(); expect(answer).to_have_value('за октябрь 2026')
        retry = card.get_by_role('button', name='Повторить то же уточнение', exact=True)
        expect(retry).to_be_enabled()
        with page.expect_response(endpoint) as second:
            retry.click()
        if second.value.status != 200:
            raise AssertionError('Confirmed recovery was not idempotent')
        expect(page.get_by_role('status').filter(has_text='Уточнение принято')).to_be_visible()
        expect(retry).to_have_count(0)
        if len(submissions) != 2 or any(submissions[0][key] != submissions[1][key]
                for key in ['request_id', 'expected_revision', 'answer']):
            raise AssertionError('Recovery changed the original continuation')
        if submissions[0]['recover'] is not False or submissions[1]['recover'] is not True:
            raise AssertionError('Recovery was not explicit')
        if denied:
            raise AssertionError('External browser request attempted')
        print(json.dumps({'status': 'PASS', 'checks': ['clarification_real_pg_unix_bff_question',
            'clarification_no_wrong_semantics_for_prompt', 'clarification_real_http_acceptance_lost',
            'clarification_unknown_preserves_answer', 'clarification_explicit_recover_same_identity']}))
    finally:
        browser.close()
