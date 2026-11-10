"""Packaged selection UI; synthetic POSTs, real fixture store listing, no execution."""
from datetime import datetime,timedelta,timezone
import json,sys
from playwright.sync_api import sync_playwright,expect

data=json.load(sys.stdin)
with sync_playwright()as p:
    browser=p.chromium.launch(headless=True)
    try:
        context=browser.new_context(ignore_https_errors=False)
        denied=[]
        def local(r):
            if r.request.url.startswith(data['origin']+'/'):r.continue_()
            else:denied.append('external');r.abort()
        context.route('**/*',local)
        context.add_cookies([{'name':'__Host-alisa_session','value':data['session'],
                             'url':data['origin'],'httpOnly':True,'secure':True,'sameSite':'Lax'}])
        page=context.new_page();page.goto(data['origin']+'/app/queries',wait_until='networkidle')
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
            now=datetime.now(timezone.utc);confirmed=len(submissions)>1
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
        print(json.dumps({'status':'PASS','checks':['selection_single_default','selection_empty_blocks_submit',
              'selection_individual_checkbox','selection_all_three_stores','selection_unknown_freezes_controls',
              'selection_recovery_same_id_stores_question','selection_recovery_is_explicit']}))
    finally:browser.close()
