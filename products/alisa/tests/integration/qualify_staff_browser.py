"""S03 installed-package browser slice inside the owned S02 HTTPS/DB harness."""
import base64
import hashlib
import hmac
import json
import re
import time
import uuid
from urllib.parse import urlsplit

import jwt
from playwright.sync_api import expect


def totp(secret):
    raw = hmac.new(base64.b32decode(secret), (int(time.time())//30).to_bytes(8,'big'), hashlib.sha1).digest()
    offset = raw[-1] & 15
    return str((int.from_bytes(raw[offset:offset+4],'big') & 0x7fffffff) % 1000000).zfill(6)


def fresh_totp(secret, previous):
    # Native TOTP is one-use per time step. Wait for the next real value;
    # never change the verifier's clock or reuse a consumed value.
    for _ in range(160):
        value=totp(secret)
        if value!=previous:return value
        time.sleep(.2)
    raise RuntimeError('Fresh native TOTP interval did not arrive')


def run(*, browser, context, second_context, db, manage, check, origin, issuer,
        private_values, owner_email, reader_email, authority_proxy, private_key, token_path, record, access_enabled=False, web_origin=None, platform_proxy=None, native_letter=None, native_password=None):
    def subject(email):
        with db('identity') as conn:
            person = conn.execute('SELECT p.id FROM accounts_person p JOIN account_emailaddress e ON e.user_id=p.id WHERE e.email=%s AND e.verified=true AND p.is_active=true', [email]).fetchone()
            if not person:
                raise RuntimeError('Expected verified disposable identity')
            value = uuid.uuid4()
            conn.execute('INSERT INTO accounts_subject(id,person_id,client_id) VALUES(%s,%s,%s)', [value,person[0],'s03_admin'])
            return str(value), person[0]
    owner_sub, owner_person = subject(owner_email)
    reader_sub, reader_person = subject(reader_email)
    with db('platform') as conn:
        owner_label=conn.execute('SELECT display_name FROM accounts_customer WHERE email=%s',[owner_email]).fetchone()[0] or owner_email
    manage('platform',['bootstrap_staff_owner','--apply','--subject',owner_sub,'--name','Test Owner'])
    check('s03_owner_closed_bootstrap_uses_verified_admin_client_subject',True)

    observed_pages=set()
    def begin(page):
        record['staff_browser_phase']='begin'
        if id(page) not in observed_pages:
            observed_pages.add(id(page))
            def observe(response):
                if not response.request.is_navigation_request():return
                target=urlsplit(response.url)
                if target.hostname not in {'127.0.0.1','localhost'}:return
                trace=record.setdefault('safe_staff_navigation',[])
                trace.append({'origin':'authority' if target.netloc==urlsplit(issuer).netloc else 'admin','path':target.path,'status':response.status})
                del trace[:-12]
            page.on('response',observe)
        page.goto(origin+'/login')
        page.get_by_role('button',name='Войти с MFA',exact=True).click()
        page.wait_for_url(re.compile(re.escape(issuer)+r'/'))

    def enroll(page, accepted=True):
        begin(page)
        record['staff_browser_phase']='require_first_factor'
        expect(page.get_by_role('heading',name='Дополнительная защита входа в админку')).to_be_visible()
        page.get_by_role('link',name='Подключить приложение для кодов').click()
        if page.locator('input[name=password]').count():
            if native_password is None:raise RuntimeError('Owned synthetic password required by native security settings')
            page.locator('input[name=password]').fill(native_password)
            page.locator('form').filter(has=page.locator('input[name=password]')).locator('button[type=submit]').click()
        record['staff_browser_phase']='enroll_totp'
        secret = page.locator('#authenticator_secret').input_value()
        private_values.append(secret)
        value = totp(secret);private_values.append(value)
        page.locator('input[name=code]').fill(value)
        page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').click()
        page.wait_for_url(re.compile(re.escape(issuer)+r'/accounts/2fa/(recovery-codes/|reauthenticate/)'))
        record['staff_browser_phase']='recovery_view_single_verified_challenge'
        check('s03_native_browser_enrollment_does_not_ask_second_totp',urlsplit(page.url).path=='/accounts/2fa/recovery-codes/')
        expect(page.locator('#recovery_codes')).to_be_visible()
        check('s03_mfa_recovery_page_does_not_promise_email',page.get_by_text('Введите свою электронную почту.',exact=False).count()==0)
        recovery = page.locator('#recovery_codes').input_value().strip().splitlines()
        private_values.extend(recovery)
        check('s03_native_browser_totp_enrollment_and_recovery_codes',len(recovery)>=6)
        page.get_by_role('button',name='Коды сохранены — перейти в админку').click()
        if accepted:
            expect(page.get_by_role('heading',name='Админка Алисы',exact=True)).to_be_visible(timeout=15000)
            expect(page).to_have_url(origin+'/admin')
            check('s03_single_enrollment_challenge_resumes_original_admin_request',True)
        else:
            expect(page).to_have_url(re.compile(re.escape(origin)+r'/login\?error=AUTH_FAILED'))
        return secret,recovery,value

    def login(page, factor, accepted=True):
        # This helper explicitly starts a NEW login (lost-cookie scenario).
        # Active-cookie reuse is exercised separately below.
        page.context.clear_cookies(name='__Host-alisa_staff')
        begin(page)
        record['staff_browser_phase']='native_factor'
        expect(page.locator('input[name=code]')).to_be_visible()
        private_values.append(factor)
        page.locator('input[name=code]').fill(factor)
        page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').click()
        if accepted:
            expect(page.get_by_role('heading',name='Админка Алисы',exact=True)).to_be_visible(timeout=15000)
            expect(page).to_have_url(origin+'/admin')
        else:
            expect(page).to_have_url(re.compile(re.escape(origin)+r'/login\?error=AUTH_FAILED'))

    owner_page = context.new_page()
    secret, owner_recovery, used_value = enroll(owner_page)
    check('s03_real_https_native_mfa_oidc_bff_api_postgresql_admin',True)
    expect(owner_page.get_by_role('button',name=owner_label,exact=True)).to_be_visible()
    expect(owner_page.get_by_role('button',name=reader_email,exact=True)).to_be_visible()
    check('s03_owner_browser_lists_both_real_s02_customers',True)
    cookies = context.cookies()
    staff_cookie = next(c for c in cookies if c['name']=='__Host-alisa_staff')
    private_values.append(staff_cookie['value'])
    check('s03_dedicated_host_only_secure_httponly_staff_cookie',staff_cookie['secure'] and staff_cookie['httpOnly'] and staff_cookie['sameSite']=='Lax' and staff_cookie['domain']=='127.0.0.1')

    # Existing native MFA + backend-validated staff session must cover every
    # public entry without generating another factor challenge or auth flow.
    def flow_counts():
        with db('platform') as con:
            platform_counts=[con.execute('SELECT count(*) FROM '+table).fetchone()[0]
                for table in ['staff_staffauthflow','staff_staffsession']]
        with db('identity') as con:mail_count=con.execute('SELECT count(*) FROM accounts_identitymail').fetchone()[0]
        return [*platform_counts,mail_count]
    with db('platform') as con:
        own_session=con.execute('SELECT id,created_at,expires_at,mfa_verified_at,revoked_at,revision FROM staff_staffsession WHERE token_hash=%s',[hashlib.sha256(staff_cookie['value'].encode()).hexdigest()]).fetchone()
    before_counts=flow_counts()
    for entry_path in ['/','/login','/login?error=AUTH_FAILED']:
        owner_page.goto(origin+entry_path)
        expect(owner_page).to_have_url(origin+'/admin')
        check('s03_active_session_resumes_'+entry_path.replace('/','_').replace('?','_').replace('=','_'),True)
    reused=owner_page.request.post(origin+'/auth/start',form={'return_to':'/admin'},headers={'Origin':origin},max_redirects=0)
    check('s03_active_session_start_skips_new_oidc_and_cookie',reused.status==303 and reused.headers.get('location')==origin+'/admin' and 'set-cookie' not in reused.headers)
    check('s03_active_session_start_keeps_origin_guard',owner_page.request.post(origin+'/auth/start',form={'return_to':'/admin'},headers={'Origin':'https://wrong.example.invalid'},max_redirects=0).status==403)
    check('s03_active_session_start_keeps_payload_guard',owner_page.request.post(origin+'/auth/start',form={'return_to':'https://wrong.example.invalid/'},headers={'Origin':origin},max_redirects=0).status==422)
    check('s03_active_session_start_keeps_query_guard',owner_page.request.post(origin+'/auth/start?next=value',form={'return_to':'/admin'},headers={'Origin':origin},max_redirects=0).status==422)
    with db('platform') as con:
        unchanged=con.execute('SELECT id,created_at,expires_at,mfa_verified_at,revoked_at,revision FROM staff_staffsession WHERE id=%s',[own_session[0]]).fetchone()
    check('s03_reuse_does_not_create_flow_session_mail_or_extend_mfa',flow_counts()==before_counts and unchanged==own_session)
    for label,cookie in [('forged','z'*43),('duplicate',';'.join(['__Host-alisa_staff='+staff_cookie['value'],'__Host-alisa_staff='+'z'*43]))]:
        raw=cookie if label=='duplicate' else '__Host-alisa_staff='+cookie
        denied_login=owner_page.request.get(origin+'/login',headers={'Cookie':raw},max_redirects=0)
        check('s03_login_rejects_'+label+'_cookie',denied_login.status==200 and 'Войти с MFA' in denied_login.text())
    for label,field,value in [
        ('revoked','revoked_at','now()'),('expired','expires_at',"now()-interval '1 second'"),
        ('stale_mfa','mfa_verified_at',"now()-interval '301 seconds'"),('revision_mismatch','revision','revision+1')]:
        with db('platform') as con:con.execute('UPDATE staff_staffsession SET '+field+'='+value+' WHERE id=%s',[own_session[0]])
        try:
            blocked=owner_page.request.get(origin+'/login',max_redirects=0)
            check('s03_login_requires_new_auth_for_'+label,blocked.status==200 and 'Войти с MFA' in blocked.text())
        finally:
            with db('platform') as con:con.execute('UPDATE staff_staffsession SET expires_at=%s,mfa_verified_at=%s,revoked_at=%s,revision=%s WHERE id=%s',[own_session[2],own_session[3],own_session[4],own_session[5],own_session[0]])
    if platform_proxy is None:raise RuntimeError('Owned platform proxy required for dependency outage case')
    def unavailable(path,status,body):
        if path=='/api/v1/staff/me':return 503,b'{"code":"TEMPORARILY_UNAVAILABLE"}'
        return status,body
    platform_proxy.result_hook=unavailable
    try:
        unavailable_login=owner_page.request.get(origin+'/login',max_redirects=0)
        check('s03_backend_outage_login_does_not_offer_new_mfa','Проверка входа временно недоступна' in unavailable_login.text() and 'Войти с MFA' not in unavailable_login.text())
        blocked=owner_page.request.post(origin+'/auth/start',form={'return_to':'/admin'},headers={'Origin':origin},max_redirects=0)
        check('s03_backend_outage_start_fails_closed_without_flow',blocked.status==503 and flow_counts()==before_counts)
    finally:platform_proxy.result_hook=None
    owner_page.goto(origin+'/admin');expect(owner_page.get_by_role('heading',name='Админка Алисы',exact=True)).to_be_visible()

    # Real already-enrolled login from an anonymous identity context: one
    # email code and one TOTP, not the enrollment-only happy path.
    if native_letter is None:raise RuntimeError('Owned synthetic mailbox helper required')
    enrolled_context=browser.new_context(ignore_https_errors=False)
    enrolled_page=enrolled_context.new_page();begin(enrolled_page)
    if enrolled_page.get_by_role('button',name='Продолжить вход по коду').count():
        enrolled_page.get_by_role('button',name='Продолжить вход по коду').click()
    field=enrolled_page.locator('input[name=login],input[name=email]').first;field.fill(owner_email)
    enrolled_page.locator('form').filter(has=field).locator('button[type=submit]').first.click()
    expect(enrolled_page.locator('input[name=code]')).to_be_visible()
    manage('identity',['identity_deliver']);mail_value=native_letter(owner_email);private_values.append(mail_value)
    enrolled_page.locator('input[name=code]').fill(mail_value)
    enrolled_page.locator('form').filter(has=enrolled_page.locator('input[name=code]')).locator('button[type=submit]').first.click()
    enrolled_page.wait_for_url(re.compile(re.escape(issuer)+r'/accounts/2fa/authenticate/'))
    app_value=fresh_totp(secret,totp(secret));private_values.append(app_value)
    enrolled_page.locator('input[name=code]').fill(app_value)
    enrolled_page.locator('form').filter(has=enrolled_page.locator('input[name=code]')).locator('button[type=submit]').first.click()
    expect(enrolled_page.get_by_role('heading',name='Админка Алисы',exact=True)).to_be_visible(timeout=15000)
    expect(enrolled_page).to_have_url(origin+'/admin')
    check('s03_existing_enrolled_identity_email_one_totp_enters_admin',True)
    enrolled_page.get_by_role('button',name='Выйти',exact=True).click()
    expect(enrolled_page).to_have_url(origin+'/login');enrolled_context.close()

    # Product and identity cookies alone cannot authenticate the separate BFF.
    foreign = browser.new_context(ignore_https_errors=False)
    foreign.add_cookies([c for c in cookies if c['name']!='__Host-alisa_staff'])
    foreign_page = foreign.new_page()
    foreign_page.goto(origin+'/admin');expect(foreign_page).to_have_url(origin+'/login')
    check('s03_customer_and_identity_cookies_do_not_authorize_admin',True)
    foreign.close()
    check('s03_admin_bff_origin_denied',owner_page.request.post(origin+'/api/staff/read',data={'resource':'customers'},headers={'Origin':'https://wrong.example.invalid'}).status==403)

    # Read/card/command all traverse the packaged Next BFF and current backend.
    owner_page.get_by_role('button',name=reader_email,exact=True).click()
    card = owner_page.locator('section[aria-label="Карточка клиента"]')
    expect(card).to_contain_text(reader_email)
    card.get_by_role('button',name='Заблокировать в Алисе').click()
    expect(owner_page.locator('main > p[role="status"]')).to_contain_text('Изменение сохранено')
    with db('identity') as conn:
        check('s03_local_customer_block_preserves_global_identity',conn.execute('SELECT is_active FROM accounts_person WHERE id=%s',[reader_person]).fetchone()[0] is True)
    owner_page.get_by_role('button',name=reader_email,exact=True).click()
    card.get_by_role('button',name='Разблокировать в Алисе').click()
    expect(owner_page.locator('main > p[role="status"]')).to_contain_text('Изменение сохранено')
    check('s03_browser_customer_card_block_and_unblock',True)
    owner_page.get_by_role('button',name='Заявки',exact=True).click()
    expect(owner_page.locator('section[aria-label="Данные"]')).to_contain_text(owner_email)
    check('s03_browser_separates_leads_and_customers',True)

    # A normal customer completes native MFA but still receives no staff role.
    reader_page = second_context.new_page()
    reader_secret, reader_recovery, _ = enroll(reader_page,False)
    login(reader_page,reader_recovery[0],False)
    check('s03_ordinary_customer_with_valid_mfa_still_has_no_admin',not any(c['name']=='__Host-alisa_staff' for c in second_context.cookies()))
    owner_page.get_by_role('button',name='Сотрудники',exact=True).click()
    owner_page.locator('input[name=subject]').fill(reader_sub)
    owner_page.locator('input[name=name]').fill('Test Reader')
    owner_page.get_by_label('Просмотр клиентов',exact=True).check()
    owner_page.get_by_role('button',name='Назначить',exact=True).click()
    expect(owner_page.locator('main > p[role="status"]')).to_contain_text('Изменение сохранено')
    check('s03_owner_assigns_limited_admin_through_real_ui',True)
    login(reader_page,reader_recovery[1])
    expect(reader_page.get_by_role('button',name=owner_label,exact=True)).to_be_visible()
    reader_page.get_by_role('button',name=owner_label,exact=True).click()
    expect(reader_page.locator('section[aria-label="Карточка клиента"]')).to_be_visible()
    check('s03_limited_staff_ui_has_no_block_button',reader_page.get_by_role('button',name='Заблокировать в Алисе').count()==0)
    with db('platform') as conn:
        customer_id, revision = conn.execute('SELECT id,security_revision FROM accounts_customer WHERE email=%s',[owner_email]).fetchone()
    denied = reader_page.request.post(origin+'/api/staff/command',data={'command_id':str(uuid.uuid4()),'action':'customer.block','payload':{'customer_id':str(customer_id),'revision':revision},'reason':'SECURITY_REVIEW'},headers={'Origin':origin})
    check('s03_limited_staff_direct_command_denied_by_backend',denied.status==403)

    another = browser.new_context(ignore_https_errors=False)
    another.add_cookies([c for c in second_context.cookies() if c['domain']=='localhost'])
    another_page = another.new_page();login(another_page,reader_recovery[2])
    check('s03_same_limited_staff_has_two_independently_authenticated_browsers',True)
    # Revoke that member through the actual UI, then refresh both contexts.
    owner_page.get_by_role('button',name='Сотрудники',exact=True).click()
    entry = owner_page.locator('li').filter(has_text='Test Reader')
    entry.get_by_role('button',name='Отозвать сотрудника').click()
    expect(owner_page.locator('main > p[role="status"]')).to_contain_text('Изменение сохранено')
    for item in [reader_page,another_page]:
        item.goto(origin+'/admin');expect(item).to_have_url(origin+'/login')
    check('s03_staff_revocation_denies_both_real_browser_sessions',True)
    another.close()

    # Signed fixture token mutations specifically exercise the admin callback.
    for index, mode in enumerate(['missing','stale','wrong_type','wrong_acr']):
        negative = browser.new_context(ignore_https_errors=False)
        negative.add_cookies([c for c in context.cookies() if c['domain']=='localhost'])
        negative_page = negative.new_page()
        mutated = []
        def change(path,status,body):
            if path!=token_path or status!=200:
                return body
            value=json.loads(body);header=jwt.get_unverified_header(value['id_token'])
            claims=jwt.decode(value['id_token'],options={'verify_signature':False})
            if mode=='missing':claims.pop('alisa_mfa',None)
            elif mode=='stale':claims['alisa_mfa']['at']=int(time.time())-301;claims['auth_time']=claims['alisa_mfa']['at']
            elif mode=='wrong_type':claims['alisa_mfa']['type']='email'
            else:claims['acr']='unverified-label'
            value['id_token']=jwt.encode(claims,private_key,algorithm='RS256',headers={'kid':header['kid']})
            mutated.append(True)
            return json.dumps(value).encode()
        authority_proxy.response_hook=change
        try:
            login(negative_page,owner_recovery[index],False)
            check('s03_admin_bff_rejects_'+mode+'_mfa_claims',bool(mutated) and not any(c['name']=='__Host-alisa_staff' for c in negative.cookies()))
        finally:
            authority_proxy.response_hook=None
            negative.close()
    if access_enabled:
        from qualify_access_browser import run as run_access_browser
        login(owner_page,fresh_totp(secret,totp(secret)))
        run_access_browser(owner_page=owner_page,context=context,second_context=second_context,db=db,
            check=check,origin=origin,web_origin=web_origin,owner_email=owner_email,reader_email=reader_email,owner_label=owner_label,manage=manage)
    owner_page.goto(origin+'/admin')
    owner_page.get_by_role('button',name='Аудит',exact=True).click()
    expect(owner_page.locator('section[aria-label="Данные"]')).to_contain_text('staff.revoked')
    check('s03_audit_visible_without_contacts_tokens_or_factor_secrets',all(v not in owner_page.locator('section[aria-label="Данные"]').inner_text() for v in [owner_email,reader_email,secret,staff_cookie['value']]))
    owner_page.get_by_role('button',name='Выйти',exact=True).click()
    expect(owner_page).to_have_url(origin+'/login')
    check('s03_browser_logout_clears_and_revokes_staff_session',True)
    owner_page.close();reader_page.close()
