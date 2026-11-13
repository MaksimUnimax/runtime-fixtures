"""Three real store-list pages; synthetic query submissions never execute work."""
from datetime import datetime, timedelta, timezone
import json
import sys
from urllib.parse import urlsplit,parse_qs
from playwright.sync_api import sync_playwright, expect

data=json.load(sys.stdin)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    try:
        context=browser.new_context(ignore_https_errors=False)
        denied=[]
        def local(route):
            if route.request.url.startswith(data['origin']+'/'):route.continue_()
            else:denied.append('external');route.abort()
        context.route('**/*',local)
        context.add_cookies([{'name':'__Host-alisa_session','value':data['session'],
            'url':data['origin'],'httpOnly':True,'secure':True,'sameSite':'Lax'}])
        page=context.new_page();page.goto(data['origin']+'/app/queries',wait_until='networkidle')
        group=page.get_by_role('group',name='Магазины для запроса',exact=True)
        more=page.get_by_role('button',name='Показать ещё магазины',exact=True)
        expect(group).to_have_count(0);expect(more).to_be_enabled()
        # The first 50 cards are disabled: the next-page control must still work.
        more.click();expect(group.get_by_role('checkbox')).to_have_count(50)
        expect(group.locator('input:checked')).to_have_count(0)
        chosen=group.get_by_label('Pagination active 00 · OZON',exact=True)
        chosen.check();expect(group.locator('input:checked')).to_have_count(1)
        submissions=[]
        def query(route):
            if route.request.method!='POST':route.fallback();return
            value=route.request.post_data_json;submissions.append(value)
            now=datetime.now(timezone.utc);confirmed=len(submissions)>1
            row={'id':value['id'],'store_ids':value['store_ids'],'state':'QUEUED'if confirmed else'UNKNOWN',
                'created_at':now.isoformat(),'expires_at':(now+timedelta(days=1)).isoformat(),
                'checked_at':None,'submission_confirmed':confirmed}
            route.fulfill(status=201 if confirmed else 202,json={'query':row})
        context.route(data['origin']+'/api/v1/queries',query)
        question=page.get_by_label('Вопрос',exact=True)
        question.fill('Synthetic paginated store question')
        page.get_by_role('button',name='Подготовить отчёт',exact=True).click()
        retry=page.get_by_role('button',name='Повторить ту же отправку',exact=True)
        expect(retry).to_be_enabled();expect(more).to_be_disabled();expect(chosen).to_be_disabled()
        retry.click();expect(more).to_be_enabled()
        if len(submissions)!=2 or any(submissions[0][k]!=submissions[1][k]for k in ['id','store_ids','utterance']):
            raise AssertionError('Pagination changed unknown submission identity')
        if submissions[0]['store_ids']!=[data['target_store_id']]:raise AssertionError('Wrong late-page store submitted')
        question.fill('Keep this question while loading stores')
        failures=['http','shape','cursor']
        def fail_page(route):
            if failures:
                failure=failures.pop(0)
                if failure=='http':route.fulfill(status=503,json={'code':'STORES_UNAVAILABLE'})
                elif failure=='shape':route.fulfill(status=200,json={'items':[],'next_cursor':17})
                else:route.fulfill(status=200,json={'items':[],'next_cursor':parse_qs(urlsplit(route.request.url).query)['cursor'][0]})
            else:route.fallback()
        context.route(data['origin']+'/api/account/stores?cursor=*',fail_page)
        for _ in range(3):
            more.click();expect(page.get_by_role('region',name='Новый отчёт',exact=True).get_by_role('alert')).to_contain_text('Не удалось загрузить')
            expect(more).to_be_enabled();expect(chosen).to_be_checked()
            expect(group.get_by_role('checkbox')).to_have_count(50)
            expect(question).to_have_value('Keep this question while loading stores')
        more.click();expect(group.get_by_role('checkbox')).to_have_count(len(data['all_store_ids']))
        expect(more).to_have_count(0);expect(chosen).to_be_checked()
        expect(group.locator('input:checked')).to_have_count(1)
        expect(question).to_have_value('Keep this question while loading stores')
        page.get_by_role('button',name='Выбрать все в списке',exact=True).click()
        expect(group.locator('input:checked')).to_have_count(len(data['all_store_ids']))
        page.get_by_role('button',name='Подготовить отчёт',exact=True).click()
        expect(question).to_have_value('')
        if len(submissions)!=3 or submissions[2]['store_ids']!=data['all_store_ids']:
            raise AssertionError('All loaded pages were not included exactly once')
        if denied:raise AssertionError('External browser network attempted')
        print(json.dumps({'status':'PASS','checks':['pagination_empty_first_page_continues',
            'pagination_real_signed_cursor_pages','pagination_late_store_selectable',
            'pagination_unknown_freezes_loading','pagination_unknown_recovery_same_identity',
            'pagination_http_failure_preserves_selection','pagination_bad_shape_preserves_selection',
            'pagination_repeated_cursor_preserves_selection',
            'pagination_question_and_selection_survive_append','pagination_all_loaded_stores_submitted']}))
    finally:browser.close()
