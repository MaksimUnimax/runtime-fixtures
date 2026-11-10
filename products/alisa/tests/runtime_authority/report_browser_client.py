"""Ephemeral CI browser child. Only its own loopback origin is permitted."""
import hashlib
import json
from datetime import datetime,timedelta,timezone
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright,expect

data=json.load(sys.stdin)
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    try:
        context=browser.new_context(ignore_https_errors=False,accept_downloads=True)
        denied=[]
        def route(r):
            if r.request.url.startswith(data['origin']+'/'):r.continue_()
            else:denied.append('external');r.abort()
        context.route('**/*',route)
        context.add_cookies([{'name':'__Host-alisa_session','value':data['session'],
                             'url':data['origin'],'httpOnly':True,'secure':True,'sameSite':'Lax'}])
        page=context.new_page();page.goto(data['origin']+'/app/reports',wait_until='networkidle')
        page.get_by_role('heading',name='Отчёты',exact=True).wait_for()
        page.get_by_text(data['title'],exact=True).first.wait_for()
        for doc in data['files']:
            link=page.get_by_role('link').filter(has_text=doc['filename'])
            with page.expect_download() as got:link.click()
            download=got.value
            if download.failure():raise AssertionError('Download failed')
            if download.suggested_filename!=doc['filename']:raise AssertionError('Filename mismatch')
            if hashlib.sha256(Path(download.path()).read_bytes()).hexdigest()!=doc['sha256']:
                raise AssertionError('Original file bytes mismatch')
        page.goto(data['origin']+'/app/queries',wait_until='networkidle')
        page.get_by_role('heading',name='Задания',exact=True).wait_for()
        page.get_by_role('region',name='Мои задания').locator('ul button').first.click()
        page.get_by_role('button',name='Открыть отчёт',exact=True).click()
        page.get_by_role('button',name='Ответ не тот',exact=True).click()
        expect(page.get_by_role('button',name='Отметка сохранена',exact=True)).to_be_disabled()
        # Only the new selection transport is synthetic; downloads and feedback
        # above used the actual BFF, PG and signed Unix authority.
        selection=page.get_by_role('group',name='Магазины для запроса',exact=True)
        expect(selection.locator('input:checked')).to_have_count(1)
        page.get_by_role('button',name='Снять выбор',exact=True).click()
        expect(selection.locator('input:checked')).to_have_count(0)
        expect(page.get_by_role('button',name='Подготовить отчёт',exact=True)).to_be_disabled()
        selection.get_by_label('Selection WB · WB',exact=True).check()
        expect(selection.locator('input:checked')).to_have_count(1)
        page.get_by_role('button',name='Выбрать все в списке',exact=True).click()
        expect(selection.locator('input:checked')).to_have_count(3)
        submissions=[]
        def capture(r):
            if r.request.method!='POST':r.fallback();return
            value=r.request.post_data_json;submissions.append(value)
            now=datetime.now(timezone.utc)
            confirmed=len(submissions)>1
            row={'id':value['id'],'store_ids':value['store_ids'],'state':'QUEUED'if confirmed else'UNKNOWN',
                 'created_at':now.isoformat(),'expires_at':(now+timedelta(days=1)).isoformat(),
                 'checked_at':None,'submission_confirmed':confirmed}
            r.fulfill(status=201 if confirmed else 202,json={'query':row})
        context.route(data['origin']+'/api/v1/queries',capture)
        page.get_by_label('Вопрос',exact=True).fill('Synthetic selection question')
        page.get_by_role('button',name='Подготовить отчёт',exact=True).click()
        retry=page.get_by_role('button',name='Повторить ту же отправку',exact=True)
        expect(retry).to_be_enabled()
        if len(submissions)!=1 or submissions[0]['store_ids']!=data['selection_store_ids']:
            raise AssertionError('Selection was truncated or reordered')
        expect(selection.get_by_role('checkbox').first).to_be_disabled()
        expect(page.get_by_role('button',name='Выбрать все в списке',exact=True)).to_be_disabled()
        retry.click();expect(page.get_by_role('button',name='Выбрать все в списке',exact=True)).to_be_enabled()
        if len(submissions)!=2 or any(submissions[0][k]!=submissions[1][k]for k in ['id','store_ids','utterance']):
            raise AssertionError('Unknown submission identity or selection changed')
        if submissions[0]['recover']is not False or submissions[1]['recover']is not True:
            raise AssertionError('Recovery must be explicit')
        if denied:raise AssertionError('External browser request attempted')
        print(json.dumps({'status':'PASS','checks':['real_https_page','real_pg_unix_authority','template_name',
              'html_api_document_download','original_marketplace_file_download','download_bytes_sha256','external_browser_requests_zero','own_ready_result_wrong_semantics_feedback',
              'selection_single_default','selection_empty_blocks_submit','selection_individual_checkbox','selection_all_three_stores',
              'selection_unknown_freezes_controls','selection_recovery_same_id_stores_question','selection_recovery_is_explicit']}))
    finally:browser.close()
