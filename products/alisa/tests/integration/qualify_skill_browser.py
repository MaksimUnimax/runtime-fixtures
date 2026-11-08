"""Packaged website/IdP/SQL scenario. The Yandex broker is intercepted, not certified."""
import secrets
import time
from urllib.parse import parse_qs, urlencode, urlsplit

from playwright.sync_api import expect

REDIRECT = 'https://social.yandex.net/broker/redirect'


def run(*, context, second_context, db, check, web_origin, client_id, client_secret, skill_id,
        private_values, native_login):
    page=context.new_page()
    before=context.request.get(web_origin+'/api/account/me').json()['profile']
    with db('platform') as conn:
        counts=conn.execute('SELECT (SELECT count(*) FROM accounts_customer),(SELECT count(*) FROM accounts_tenant)').fetchone()
    state=secrets.token_urlsafe(24)
    query=urlencode({'client_id':client_id,'redirect_uri':REDIRECT,'response_type':'code','scope':'reports:read','state':state})
    callbacks=[]
    def broker(route):
        callbacks.append(parse_qs(urlsplit(route.request.url).query))
        route.fulfill(status=200,content_type='text/html',body='<p>Owned test broker boundary</p>')
    context.route(REDIRECT+'**',broker)
    try:
        page.goto(web_origin+'/alice/oauth/authorize?'+query)
        expect(page.get_by_role('heading',name='Подключить аккаунт к Алисе',exact=True)).to_be_visible()
        check('s06_existing_session_goes_directly_to_skill_consent',urlsplit(page.url).path=='/app/alice/connect')
        denied=context.request.post(web_origin+'/api/account/alice',data='action=approve',headers={'Content-Type':'application/x-www-form-urlencoded','Origin':'https://other.example.invalid'},max_redirects=0)
        check('s06_consent_wrong_origin_is_denied',denied.status==403)
        original=context.cookies(web_origin)
        flow=next(c for c in original if c['name']=='__Host-alisa_alice')
        second_context.add_cookies([flow])
        foreign=second_context.new_page()
        foreign.goto(web_origin+'/app/alice/connect')
        expect(foreign).to_have_url(web_origin+'/app/alice?notice=EXPIRED')
        check('s06_pending_consent_cannot_move_to_another_account',not any(c['name']=='__Host-alisa_alice' for c in second_context.cookies(web_origin)))
        foreign.close()
        page.get_by_role('button',name='Разрешить подключение',exact=True).click()
        page.wait_for_url(REDIRECT+'**')
        check('s06_consent_mirrors_state_client_and_scope_to_fixed_broker',len(callbacks)==1 and callbacks[0]['state']==[state] and callbacks[0]['client_id']==[client_id] and callbacks[0]['scope']==['reports:read'])
        code=callbacks[0]['code'][0];private_values.append(code)
        form={'grant_type':'authorization_code','client_id':client_id,'client_secret':client_secret,'redirect_uri':REDIRECT,'code':code}
        def protocol(data,path='token'):
            return context.request.post(web_origin+'/alice/oauth/'+path,data=urlencode(data),headers={'Content-Type':'application/x-www-form-urlencoded'},max_redirects=0)
        exchanged=protocol(form)
        tokens=exchanged.json();private_values.extend([tokens.get('access_token',''),tokens.get('refresh_token','')])
        check('s06_public_token_endpoint_returns_protocol_json_without_oidc_redirect',exchanged.status==200 and exchanged.headers.get('content-type','').startswith('application/json') and 'environment' not in tokens and tokens.get('token_type')=='Bearer' and not exchanged.headers.get('location'))
        check('s06_public_code_replay_is_denied',protocol(form).status==400)
        page.goto(web_origin+'/app/alice')
        expect(page.get_by_text('Доступ выдан. Вернитесь в Алису, чтобы завершить подключение.',exact=True)).to_be_visible()
        skill=context.request.post(web_origin+'/alice/platform/webhook',data={'version':'1.0','session':{'skill_id':skill_id,'user':{'access_token':tokens['access_token']}},'meta':{'interfaces':{'account_linking':{}}},'request':{'type':'account_linking_complete_event'}})
        check('s06_account_linking_event_confirms_same_customer',skill.status==200 and 'response' in skill.json() and 'start_account_linking' not in skill.json())
        page.reload();expect(page.get_by_text('Аккаунт подключён.',exact=True)).to_be_visible()
        select=page.get_by_label('Приватность',exact=True)
        expect(select).to_have_value('on');select.select_option('off')
        page.get_by_role('button',name='Сохранить настройку',exact=True).click()
        expect(page.get_by_role('status')).to_have_text('Настройка сохранена.')
        check('s06_voice_privacy_saved_in_browser',page.get_by_label('Приватность',exact=True).input_value()=='off')
        refresh_started=time.monotonic()
        refreshed=protocol({'grant_type':'refresh_token','client_id':client_id,'client_secret':client_secret,'refresh_token':tokens['refresh_token']},'refresh')
        refresh_elapsed=time.monotonic()-refresh_started
        retried=protocol({'grant_type':'refresh_token','client_id':client_id,'client_secret':client_secret,'refresh_token':tokens['refresh_token']},'refresh')
        check('s06_public_refresh_retry_preserves_access_after_lost_response',refreshed.status==200 and retried.status==200 and refreshed.json()['access_token']==retried.json()['access_token'])
        check('s06_owned_browser_refresh_completes_within_five_seconds',refresh_elapsed<5,elapsed_ms=round(refresh_elapsed*1000))
        page.get_by_role('button',name='Отключить Алису',exact=True).click()
        expect(page.get_by_text('Аккаунт ещё не подключён.',exact=True)).to_be_visible()
        check('s06_public_unlink_revokes_refresh',protocol({'grant_type':'refresh_token','client_id':client_id,'client_secret':client_secret,'refresh_token':tokens['refresh_token']}).status==400)
        other=second_context.new_page();other.goto(web_origin+'/app/alice')
        expect(other.get_by_text('Аккаунт ещё не подключён.',exact=True)).to_be_visible()
        expect(other.get_by_label('Приватность',exact=True)).to_have_value('on')
        check('s06_connection_and_voice_privacy_are_account_isolated',True);other.close()
        fresh=context.browser.new_context(ignore_https_errors=False)
        try:
            fresh.route(REDIRECT+'**',broker)
            login=fresh.new_page();login.goto(web_origin+'/alice/oauth/authorize?'+query)
            expect(login).to_have_url(web_origin+'/login')
            native_login(login)
            expect(login.get_by_role('heading',name='Подключить аккаунт к Алисе',exact=True)).to_be_visible()
            check('s06_fresh_native_password_email_login_returns_to_skill_consent',urlsplit(login.url).path=='/app/alice/connect')
            login.get_by_role('button',name='Отмена',exact=True).click();login.wait_for_url(REDIRECT+'**')
            check('s06_consent_denial_has_no_code_and_clears_pending_cookie',callbacks[-1].get('error')==['access_denied'] and 'code' not in callbacks[-1] and not any(c['name']=='__Host-alisa_alice' for c in fresh.cookies(web_origin)))
            profile=fresh.request.get(web_origin+'/api/account/me').json()['profile']
            check('s06_same_oidc_subject_keeps_customer_tenant_and_access',all(profile[k]==before[k] for k in ['customer_id','tenant_id','access_status']))
        finally:fresh.close()
        with db('platform') as conn:
            check('s06_linking_created_no_customer_or_tenant_duplicate',conn.execute('SELECT (SELECT count(*) FROM accounts_customer),(SELECT count(*) FROM accounts_tenant)').fetchone()==counts)
    finally:
        context.unroute(REDIRECT+'**',broker)
        page.close()
