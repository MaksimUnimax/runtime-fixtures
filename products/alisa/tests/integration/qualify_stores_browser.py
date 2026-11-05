"""S05 packaged UI + real PostgreSQL; only the RT-CHECK peer is synthetic."""
import json
import time
import uuid
from playwright.sync_api import expect


def run(*, context, second_context, db, check, web_origin, private_values, restart):
    page=context.new_page();page.goto(web_origin+'/app')
    page.get_by_role('link',name='Открыть мои магазины').click()
    expect(page.get_by_role('heading',name='Мои магазины',exact=True)).to_be_visible()
    check('s05_cabinet_opens_actual_stores_route',True)
    profile=page.request.get(web_origin+'/api/account/me').json()['profile']
    check('s05_unpaid_customer_can_open_setup',profile['access_status']=='NOT_PROVISIONED')
    form=page.locator('section[aria-label="Добавить магазин"]')
    secret='fixture:CONNECTED:ozon:browser-one';private_values.append(secret)
    form.get_by_label('Название магазина',exact=True).fill('Synthetic Ozon')
    form.get_by_label('Как называть магазин голосом',exact=True).fill('Первый')
    form.get_by_label('Client ID',exact=True).fill('123')
    form.get_by_label('API-ключ',exact=True).fill(secret)
    form.get_by_role('button',name='Сохранить и проверить',exact=True).click()
    card=page.locator('section[data-store-id]').filter(has=page.get_by_role('heading',name='Synthetic Ozon · Ozon',exact=True))
    expect(card).to_contain_text('Подключение подтверждено')
    expect(page.get_by_role('button',name='Обновить список',exact=True)).to_be_enabled()
    store_id=card.get_attribute('data-store-id')
    api=page.request.get(web_origin+'/api/account/stores').json()
    check('s05_form_persists_and_checks_one_actual_store',len(api['items'])==1 and api['items'][0]['id']==store_id and api['items'][0]['credentials'][0]['status']=='ACTIVE')
    check('s05_secret_not_returned_or_retained_in_form',secret not in json.dumps(api) and form.get_by_label('API-ключ',exact=True).input_value()=='')
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
    form.get_by_label('Маркетплейс',exact=True).select_option('WB')
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
    page.close()
