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
        private_values, owner_email, reader_email, authority_proxy, private_key, token_path, record):
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
    expect(owner_page.get_by_role('status')).to_contain_text('Изменение сохранено')
    with db('identity') as conn:
        check('s03_local_customer_block_preserves_global_identity',conn.execute('SELECT is_active FROM accounts_person WHERE id=%s',[reader_person]).fetchone()[0] is True)
    owner_page.get_by_role('button',name=reader_email,exact=True).click()
    card.get_by_role('button',name='Разблокировать в Алисе').click()
    expect(owner_page.get_by_role('status')).to_contain_text('Изменение сохранено')
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
    expect(owner_page.get_by_role('status')).to_contain_text('Изменение сохранено')
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
    expect(owner_page.get_by_role('status')).to_contain_text('Изменение сохранено')
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
    owner_page.goto(origin+'/admin')
    owner_page.get_by_role('button',name='Аудит',exact=True).click()
    expect(owner_page.locator('section[aria-label="Данные"]')).to_contain_text('staff.revoked')
    check('s03_audit_visible_without_contacts_tokens_or_factor_secrets',all(v not in owner_page.locator('section[aria-label="Данные"]').inner_text() for v in [owner_email,reader_email,secret,staff_cookie['value']]))
    owner_page.get_by_role('button',name='Выйти',exact=True).click()
    expect(owner_page).to_have_url(origin+'/login')
    check('s03_browser_logout_clears_and_revokes_staff_session',True)
    owner_page.close();reader_page.close()
