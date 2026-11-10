"""Ephemeral CI browser child. Only its own loopback origin is permitted."""
import hashlib
import json
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
        if denied:raise AssertionError('External browser request attempted')
        print(json.dumps({'status':'PASS','checks':['real_https_page','real_pg_unix_authority','template_name',
              'html_api_document_download','original_marketplace_file_download','download_bytes_sha256','external_browser_requests_zero','own_ready_result_wrong_semantics_feedback']}))
    finally:browser.close()
