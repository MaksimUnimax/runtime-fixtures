"""S05 packaged UI + real PostgreSQL; only the RT-CHECK peer is synthetic."""
import json
import time
import uuid
from playwright.sync_api import expect


def run(*, context, second_context, db, check, web_origin, private_values, restart):
    # A browser removes an expired session cookie. The stores BFF must return
    # 401 so the existing UI goes to login, rather than showing a field error.
    no_session=context.browser.new_context(ignore_https_errors=False)
    try:
        read=no_session.request.get(web_origin+'/api/account/stores')
        write=no_session.request.post(web_origin+'/api/account/stores',data={'action':'create','command_id':str(uuid.uuid4()),'provider':'WB','name':'must-not-be-created','voice_alias':'','credential':{'token':'fixture:must-not-dispatch'}},headers={'Origin':web_origin})
        check('s05_absent_session_read_and_mutation_require_login',read.status==401 and write.status==401 and read.json()['code']=='AUTHENTICATION_REQUIRED' and write.json()['code']=='AUTHENTICATION_REQUIRED')
        for label,cookies in [
            ('empty','__Host-alisa_session='),
            ('malformed','__Host-alisa_session=short'),
            ('duplicate','__Host-alisa_session='+('a'*43)+'; __Host-alisa_session='+('b'*43)),
        ]:
            denied=no_session.request.get(web_origin+'/api/account/stores',headers={'Cookie':cookies})
            check('s05_'+label+'_session_cookie_requires_login',denied.status==401 and denied.json()['code']=='AUTHENTICATION_REQUIRED')
    finally:no_session.close()
    page=context.new_page();page.goto(web_origin+'/app')
    page.get_by_role('link',name='Открыть мои магазины').click()
    expect(page.get_by_role('heading',name='Мои магазины',exact=True)).to_be_visible()
    check('s05_cabinet_opens_actual_stores_route',True)
    profile=page.request.get(web_origin+'/api/account/me').json()['profile']
    check('s05_unpaid_customer_can_open_setup',profile['access_status']=='NOT_PROVISIONED')
    form=page.locator('section[aria-label="Добавить магазин"]')
    seller_fields=form.get_by_role('group',name='Ozon Seller API',exact=True)
    performance_fields=form.get_by_role('group',name='Ozon Performance API — реклама (необязательно)',exact=True)
    expect(performance_fields).to_be_visible()
    check('s05_create_form_exposes_both_ozon_channels',seller_fields.is_visible() and performance_fields.is_visible())
    secret='fixture:CONNECTED:ozon:browser-one';private_values.append(secret)
    performance_secret='fixture:IDENTITY_NOT_VERIFIED:ozon:browser-one';private_values.append(performance_secret)
    form.get_by_label('Название магазина',exact=True).fill('Synthetic Ozon')
    form.get_by_label('Как называть магазин голосом',exact=True).fill('Первый')
    seller_fields.get_by_label('Client ID',exact=True).fill('123')
    seller_fields.get_by_label('API-ключ',exact=True).fill(secret)
    performance_fields.get_by_label('Client ID',exact=True).fill('performance-one')
    form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
    check('s05_partial_performance_client_id_creates_no_store',bool(performance_fields.get_by_label('Client Secret',exact=True).evaluate('(input)=>input.validationMessage')) and page.request.get(web_origin+'/api/account/stores').json()['items']==[])
    performance_fields.get_by_label('Client Secret',exact=True).fill(performance_secret)
    performance_fields.get_by_label('Client ID',exact=True).fill('')
    form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
    check('s05_partial_performance_secret_creates_no_store',bool(performance_fields.get_by_label('Client ID',exact=True).evaluate('(input)=>input.validationMessage')) and page.request.get(web_origin+'/api/account/stores').json()['items']==[])
    performance_fields.get_by_label('Client ID',exact=True).fill('performance-one')
    form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
    card=page.locator('section[data-store-id]').filter(has=page.get_by_role('heading',name='Synthetic Ozon · Ozon',exact=True))
    expect(card).to_contain_text('Подключение подтверждено')
    expect(page.get_by_role('button',name='Обновить список',exact=True)).to_be_enabled()
    store_id=card.get_attribute('data-store-id')
    api=page.request.get(web_origin+'/api/account/stores').json()
    check('s05_form_persists_and_checks_one_actual_store',len(api['items'])==1 and api['items'][0]['id']==store_id and any(c['kind']=='SELLER' and c['status']=='ACTIVE' for c in api['items'][0]['credentials']))
    check('s05_both_ozon_keys_are_saved_to_one_store_and_checked_separately',{c['kind'] for c in api['items'][0]['credentials']}=={'SELLER','PERFORMANCE'} and any(c['kind']=='PERFORMANCE' and c['status']=='PENDING' and c['check_code']=='IDENTITY_NOT_VERIFIED' for c in api['items'][0]['credentials']))
    check('s05_secret_not_returned_or_retained_in_form',all(v not in json.dumps(api) for v in [secret,performance_secret]) and seller_fields.get_by_label('API-ключ',exact=True).input_value()=='' and performance_fields.get_by_label('Client Secret',exact=True).input_value()=='')
    # Real server HTML remains inert without JS and never uses GET for secrets.
    no_script=context.browser.new_context(java_script_enabled=False,ignore_https_errors=False,storage_state=context.storage_state())
    try:
        inert=no_script.new_page();inert.goto(web_origin+'/app/stores')
        forms=inert.locator('form');count=forms.count()
        check('s05_no_script_all_store_forms_use_fixed_post',count>=3 and all(forms.nth(i).get_attribute('method')=='post' and forms.nth(i).get_attribute('action')=='/api/account/stores' for i in range(count)))
        expect(inert.get_by_role('button',name='Сохранить и проверить',exact=True)).to_be_disabled()
        check('s05_no_script_secret_form_cannot_submit_before_hydration',True)
    finally:no_script.close()

    foreign=second_context.request.post(web_origin+'/api/account/stores',data={'action':'disable','command_id':str(uuid.uuid4()),'store_id':store_id,'expected_revision':api['items'][0]['revision']},headers={'Origin':web_origin})
    check('s05_browser_foreign_store_id_is_denied',foreign.status==404)
    denied=page.request.post(web_origin+'/api/account/stores',data={'action':'delete'},headers={'Origin':'https://evil.invalid'})
    check('s05_browser_cross_origin_mutation_denied',denied.status==403)
    seller=card.locator('section[aria-label="Ozon Seller API"]')
    seller.locator('summary').click()
    bad='fixture:CONNECTED:ozon:different';private_values.append(bad)
    seller.get_by_label('Client ID',exact=True).fill('456');seller.get_by_label('API-ключ',exact=True).fill(bad)
    seller.get_by_role('button',name='Сохранить и проверить новый ключ',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Ключ относится к другому кабинету')
    after=page.request.get(web_origin+'/api/account/stores').json()['items'][0]
    check('s05_ui_rejects_other_cabinet_replacement',any(c['status']=='ACTIVE' and c['revision']==1 for c in after['credentials']) and any(c['check_code']=='ACCOUNT_MISMATCH' for c in after['credentials']))
    restart()
    for _ in range(100):
        try:
            if page.request.get(web_origin+'/api/account/stores').status==200:break
        except Exception:pass
        time.sleep(.1)
    else:raise RuntimeError('S05_RESTART_READBACK_FAILED')
    page.reload();expect(card).to_be_visible()
    check('s05_store_and_safe_revisions_survive_real_platform_restart',page.request.get(web_origin+'/api/account/stores').json()['items'][0]==after)
    card.get_by_label('Название',exact=True).fill('Renamed Ozon')
    card.get_by_label('Голосовое название',exact=True).fill('Главный')
    card.get_by_role('button',name='Сохранить названия',exact=True).click()
    card=page.locator('section[data-store-id="'+store_id+'"]');expect(card).to_contain_text('Renamed Ozon')
    check('s05_rename_and_voice_alias_keep_same_store_id',card.get_attribute('data-store-id')==store_id)
    # Advertising remains optional, and the two stored channels do not depend
    # on a successful Seller provider response during creation.
    for with_advertising in [False,True]:
        name='Synthetic Seller only' if not with_advertising else 'Synthetic denied Seller'
        seller_secret='fixture:CONNECTED:ozon:only' if not with_advertising else 'fixture:AUTH_DENIED:ozon:denied'
        private_values.append(seller_secret)
        form.get_by_label('Название магазина',exact=True).fill(name)
        seller_fields.get_by_label('Client ID',exact=True).fill('789')
        seller_fields.get_by_label('API-ключ',exact=True).fill(seller_secret)
        if with_advertising:
            performance_fields.get_by_label('Client ID',exact=True).fill('performance-denied-seller')
            performance_fields.get_by_label('Client Secret',exact=True).fill(performance_secret)
        form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
        extra=page.locator('section[data-store-id]').filter(has=page.get_by_role('heading',name=name+' · Ozon',exact=True))
        expect(extra).to_be_visible();expect(page.get_by_role('button',name='Обновить список',exact=True)).to_be_enabled()
        item=next(s for s in page.request.get(web_origin+'/api/account/stores').json()['items'] if s['name']==name)
        if with_advertising:
            check('s05_seller_auth_error_keeps_and_checks_advertising_key',len(item['credentials'])==2 and any(c['kind']=='SELLER' and c['check_code']=='AUTH_DENIED' for c in item['credentials']) and any(c['kind']=='PERFORMANCE' and c['check_code']=='IDENTITY_NOT_VERIFIED' for c in item['credentials']))
        else:check('s05_seller_only_store_needs_no_advertising_key',len(item['credentials'])==1 and item['credentials'][0]['kind']=='SELLER' and item['credentials'][0]['status']=='ACTIVE')
        page.once('dialog',lambda dialog:dialog.accept())
        extra.get_by_role('button',name='Удалить магазин',exact=True).click();expect(extra).to_have_count(0)
    # Inject loss of the second save response. The UI must show the existing
    # store and a partial-save notice, without retrying creation or checks.
    def fail_advertising_save(route):
        data=route.request.post_data_json if route.request.method=='POST' else None
        if data and data.get('action')=='credential' and data.get('kind')=='PERFORMANCE':
            route.fulfill(status=503,content_type='application/json',body=json.dumps({'code':'STORES_UNAVAILABLE'}))
        else:route.continue_()
    page.route('**/api/account/stores',fail_advertising_save)
    try:
        partial_secret='fixture:CONNECTED:ozon:partial';private_values.append(partial_secret)
        form.get_by_label('Название магазина',exact=True).fill('Synthetic partial save')
        seller_fields.get_by_label('Client ID',exact=True).fill('901')
        seller_fields.get_by_label('API-ключ',exact=True).fill(partial_secret)
        performance_fields.get_by_label('Client ID',exact=True).fill('performance-partial')
        performance_fields.get_by_label('Client Secret',exact=True).fill(performance_secret)
        form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
        expect(page.get_by_role('status')).to_contain_text('Магазин уже создан. Не удалось подтвердить сохранение ключа рекламы.')
        expect(page.get_by_role('button',name='Обновить список',exact=True)).to_be_enabled()
    finally:page.unroute('**/api/account/stores',fail_advertising_save)
    partial=[s for s in page.request.get(web_origin+'/api/account/stores').json()['items'] if s['name']=='Synthetic partial save']
    check('s05_partial_advertising_save_shows_one_store_without_false_success',len(partial)==1 and len(partial[0]['credentials'])==1 and partial[0]['credentials'][0]['check_code']=='NOT_CHECKED' and performance_fields.get_by_label('Client Secret',exact=True).input_value()=='')
    extra=page.locator('section[data-store-id="'+partial[0]['id']+'"]')
    page.once('dialog',lambda dialog:dialog.accept());extra.get_by_role('button',name='Удалить магазин',exact=True).click();expect(extra).to_have_count(0)
    form.get_by_label('Маркетплейс',exact=True).select_option('WB')
    expect(performance_fields).to_have_count(0)
    wb_secret='fixture:CONNECTED:wb:browser-one';private_values.append(wb_secret)
    form.get_by_label('Название магазина',exact=True).fill('Synthetic WB');form.get_by_label('API-токен',exact=True).fill(wb_secret)
    form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
    wb=page.locator('section[data-store-id]').filter(has=page.get_by_role('heading',name='Synthetic WB · Wildberries',exact=True));expect(wb).to_contain_text('Подключение подтверждено')
    check('s05_wb_form_has_separate_verified_channel',True)
    card.get_by_role('button',name='Отключить и удалить ключи',exact=True).click();expect(card).to_contain_text('Магазин отключён')
    with db('platform') as conn:
        count=conn.execute("SELECT count(*) FROM stores_vaultsecret WHERE store_id=%s AND ciphertext<>''",[store_id]).fetchone()[0]
    check('s05_disable_erases_saved_keys',count==0)
    page.on('dialog',lambda dialog:dialog.accept())
    card.get_by_role('button',name='Удалить магазин',exact=True).click();expect(card).to_have_count(0)
    wb.get_by_role('button',name='Удалить магазин',exact=True).click();expect(wb).to_have_count(0)
    check('s05_delete_removes_cards_and_retains_no_plaintext_keys',page.request.get(web_origin+'/api/account/stores').json()['items']==[])
    # A committed create whose ACK and subsequent list read are lost must retain
    # exactly one recovery UUID across reload. No real credentials are involved.
    create_attempts=[]
    def lose_create_ack(route):
        data=route.request.post_data_json if route.request.method=='POST' else None
        if data and data.get('action')=='create':
            create_attempts.append(data['command_id'])
            response=route.fetch()
            assert response.status==201
            route.abort('failed')
        elif route.request.method=='GET':
            route.fulfill(status=503,content_type='application/json',body='{"code":"UNAVAILABLE"}')
        else:route.continue_()
    page.route('**/api/account/stores',lose_create_ack)
    form.get_by_label('Маркетплейс',exact=True).select_option('WB')
    form.get_by_label('Название магазина',exact=True).fill('Synthetic lost ACK')
    form.get_by_label('API-токен',exact=True).fill('fixture:CONNECTED:wb:lost-ack')
    form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
    expect(page.get_by_role('button',name='Обновить список',exact=True)).to_be_enabled()
    expect(page.get_by_role('button',name='Повторить это же добавление',exact=True)).to_be_disabled()
    page.unroute('**/api/account/stores',lose_create_ack)
    page.reload()
    expect(page.get_by_role('button',name='Повторить это же добавление',exact=True)).to_be_disabled()
    page.get_by_role('button',name='Восстановить результат добавления',exact=True).click()
    expect(page.get_by_role('button',name='Сохранить и проверить',exact=True)).to_be_enabled()
    recovered=page.request.get(web_origin+'/api/account/stores').json()['items']
    check('audit_create_committed_lost_ack_failed_refresh_reload_one_store',len(create_attempts)==1 and len(recovered)==1 and recovered[0]['name']=='Synthetic lost ACK')
    recovered_card=page.locator('section[data-store-id="'+recovered[0]['id']+'"]')
    recovered_card.get_by_role('button',name='Удалить магазин',exact=True).click();expect(recovered_card).to_have_count(0)

    # Failure before dispatch leaves UNKNOWN. The explicit retry must preserve
    # the UUID even if storage was removed before its queued storage event.
    retry_attempts=[]
    def fail_before_create(route):
        data=route.request.post_data_json if route.request.method=='POST' else None
        if data and data.get('action')=='create':
            retry_attempts.append(data['command_id']);route.abort('failed')
        else:route.continue_()
    page.route('**/api/account/stores',fail_before_create)
    form.get_by_label('Маркетплейс',exact=True).select_option('WB')
    form.get_by_label('Название магазина',exact=True).fill('Synthetic retry')
    form.get_by_label('API-токен',exact=True).fill('fixture:CONNECTED:wb:retry')
    form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
    expect(page.get_by_role('button',name='Обновить список',exact=True)).to_be_enabled()
    page.unroute('**/api/account/stores',fail_before_create)
    page.get_by_role('button',name='Восстановить результат добавления',exact=True).click()
    retry_button=page.get_by_role('button',name='Повторить это же добавление',exact=True)
    expect(retry_button).to_be_enabled()
    page.evaluate("() => {for(const key of Object.keys(localStorage))if(key.startsWith('alisa-store-create:'))localStorage.removeItem(key);}")
    def record_retry(route):
        data=route.request.post_data_json if route.request.method=='POST' else None
        if data and data.get('action')=='create':retry_attempts.append(data['command_id'])
        route.continue_()
    page.route('**/api/account/stores',record_retry)
    form.get_by_label('Маркетплейс',exact=True).select_option('WB')
    form.get_by_label('Название магазина',exact=True).fill('Synthetic retry')
    form.get_by_label('API-токен',exact=True).fill('fixture:CONNECTED:wb:retry')
    retry_button.click()
    retry_card=page.locator('section[data-store-id]').filter(has=page.get_by_role('heading',name='Synthetic retry · Wildberries',exact=True))
    expect(retry_card).to_contain_text('Подключение подтверждено')
    page.unroute('**/api/account/stores',record_retry)
    check('audit_unknown_create_explicit_retry_retains_original_uuid',len(retry_attempts)==2 and len(set(retry_attempts))==1)
    retry_card.get_by_role('button',name='Удалить магазин',exact=True).click();expect(retry_card).to_have_count(0)

    # Two actual tabs: hold the first create response while the second tab
    # submits stale UI. Only the tab holding the shared Web Lock may dispatch.
    other=context.new_page();other.goto(web_origin+'/app/stores')
    other_form=other.locator('section[aria-label="Добавить магазин"]')
    held=[];cross_tab_posts=[]
    other.evaluate("() => window.addEventListener('storage',event=>event.stopImmediatePropagation(),true)")
    def hold_create(route):
        data=route.request.post_data_json if route.request.method=='POST' else None
        if data and data.get('action')=='create':
            cross_tab_posts.append(data['command_id']);held.append(route)
        else:route.continue_()
    context.route('**/api/account/stores',hold_create)
    try:
        for target in [form,other_form]:
            target.get_by_label('Маркетплейс',exact=True).select_option('WB')
            target.get_by_label('Название магазина',exact=True).fill('Synthetic concurrent')
            target.get_by_label('API-токен',exact=True).fill('fixture:CONNECTED:wb:concurrent')
        form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
        expect(page.get_by_role('button',name='Обновить список',exact=True)).to_be_disabled()
        other_form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
        expect(other.get_by_role('status')).to_contain_text('в другой вкладке')
        check('audit_two_tabs_only_one_create_dispatches',len(cross_tab_posts)==1)
        held[0].abort('failed')
        expect(page.get_by_role('button',name='Обновить список',exact=True)).to_be_enabled()
    finally:
        context.unroute('**/api/account/stores',hold_create);other.close()
    # Recover the uncommitted fixture using its exact UUID, then remove it.
    page.get_by_role('button',name='Восстановить результат добавления',exact=True).click()
    expect(page.get_by_role('button',name='Повторить это же добавление',exact=True)).to_be_enabled()
    form.get_by_label('Маркетплейс',exact=True).select_option('WB')
    form.get_by_label('Название магазина',exact=True).fill('Synthetic concurrent')
    form.get_by_label('API-токен',exact=True).fill('fixture:CONNECTED:wb:concurrent')
    page.get_by_role('button',name='Повторить это же добавление',exact=True).click()
    concurrent_card=page.locator('section[data-store-id]').filter(has=page.get_by_role('heading',name='Synthetic concurrent · Wildberries',exact=True))
    expect(concurrent_card).to_contain_text('Подключение подтверждено')
    concurrent_card.get_by_role('button',name='Удалить магазин',exact=True).click();expect(concurrent_card).to_have_count(0)
    # A storage write failure must stop before secrets leave the browser.
    intercepted=[]
    def observe_storage_failure(route):
        data=route.request.post_data_json if route.request.method=='POST' else None
        if data and data.get('action')=='create':intercepted.append(data)
        route.continue_()
    page.route('**/api/account/stores',observe_storage_failure)
    page.evaluate("""() => {window.__saveSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('alisa-store-create:'))throw new DOMException('blocked','SecurityError');return window.__saveSet.call(this,k,v);};}""")
    form.get_by_label('Маркетплейс',exact=True).select_option('WB')
    form.get_by_label('Название магазина',exact=True).fill('must-not-leave-browser')
    form.get_by_label('API-токен',exact=True).fill('fixture:must-not-dispatch')
    form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Магазин и ключи не отправлены')
    check('audit_failed_recovery_storage_prevents_create_dispatch',intercepted==[])
    page.evaluate('() => {Storage.prototype.setItem=window.__saveSet;delete window.__saveSet;}')
    page.unroute('**/api/account/stores',observe_storage_failure);page.reload()
    # Exercise the actual mounted UI after the browser loses its cookie.
    # Clearing this owned fixture context does not alter a user's live session.
    for action in ['refresh','create']:
        expired=context.browser.new_context(ignore_https_errors=False,storage_state=context.storage_state())
        try:
            expired_page=expired.new_page();expired_page.goto(web_origin+'/app/stores')
            button=expired_page.get_by_role('button',name='Обновить список',exact=True)
            expect(button).to_be_enabled()
            if action=='create':
                expired_form=expired_page.locator('section[aria-label="Добавить магазин"]')
                expired_form.get_by_label('Маркетплейс',exact=True).select_option('WB')
                expired_form.get_by_label('Название магазина',exact=True).fill('must-not-be-created')
                expired_form.get_by_label('API-токен',exact=True).fill('fixture:must-not-dispatch')
                button=expired_form.get_by_role('button',name='Сохранить и проверить',exact=True)
            expired.clear_cookies(name='__Host-alisa_session')
            button.click();expect(expired_page).to_have_url(web_origin+'/login')
            check('s05_loaded_stores_'+action+'_returns_to_login_after_cookie_expiry',True)
        finally:expired.close()
    check('s05_expired_session_create_saved_no_store',page.request.get(web_origin+'/api/account/stores').json()['items']==[])
    page.close()
