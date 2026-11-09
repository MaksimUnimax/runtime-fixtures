"""S04 UI on the immutable package, native staff MFA and real disposable PostgreSQL."""
import uuid
from playwright.sync_api import expect


def run(*, owner_page, context, second_context, db, check, origin, web_origin, owner_email, reader_email, owner_label, manage):
    with db('platform') as conn:
        owner_id,tenant_id=conn.execute('SELECT c.id,m.tenant_id FROM accounts_customer c JOIN accounts_membership m ON m.customer_id=c.id WHERE c.email=%s',[owner_email]).fetchone()
    customer=context.new_page();customer.goto(web_origin+'/app/access')
    expect(customer.get_by_role('heading',name='Доступ ещё не выдан',exact=True)).to_be_visible()
    owner_page.goto(origin+'/admin');owner_page.get_by_role('button',name=owner_label,exact=True).click()
    panel=owner_page.locator('section[aria-label="Карточка клиента"] section[aria-label="Управление доступом"]')
    panel.get_by_label('Дней',exact=True).fill('7')
    panel.get_by_role('button',name='Предварительный просмотр',exact=True).click()
    expect(panel.locator('section[aria-label="Предпросмотр доступа"]')).to_be_visible()
    # Storage failures must not prevent the native API call or freeze the panel.
    owner_page.evaluate("""() => {
      window.__auditSetItem=Storage.prototype.setItem; window.__auditRemoveItem=Storage.prototype.removeItem;
      Storage.prototype.setItem=function(key,value){if(key==='alisa-access-pending-operation')throw new DOMException('blocked','SecurityError');return window.__auditSetItem.call(this,key,value);};
      Storage.prototype.removeItem=function(key){if(key==='alisa-access-pending-operation')throw new DOMException('full','QuotaExceededError');return window.__auditRemoveItem.call(this,key);};
    }""")
    with owner_page.expect_response(lambda response:response.url==origin+'/api/staff/access' and response.request.post_data_json.get('action')=='execute') as applied:
        panel.get_by_role('button',name='Подтвердить выдачу',exact=True).click()
    response=applied.value;original=response.json();payload=response.request.post_data_json
    check('s04_real_ui_preview_then_confirm_seven_days',response.status==200 and original['state']=='COMPLETED')
    expect(panel.get_by_role('status')).to_contain_text('Выдача завершена')
    expect(panel.get_by_role('button',name='Предварительный просмотр',exact=True)).to_be_enabled()
    check('audit_storage_write_and_cleanup_exceptions_do_not_freeze_or_fail_success',panel.get_by_role('button',name='Повторить ту же операцию',exact=True).count()==0)
    owner_page.evaluate('() => {Storage.prototype.setItem=window.__auditSetItem;Storage.prototype.removeItem=window.__auditRemoveItem;delete window.__auditSetItem;delete window.__auditRemoveItem;}')
    customer.reload();expect(customer.get_by_role('heading',name='Доступ действует',exact=True)).to_be_visible()
    expect(customer.locator('section[aria-label="История доступа"]')).to_contain_text('Подарок · 7 дн.')
    current=customer.request.get(web_origin+'/api/account/access').json()['access']
    with db('platform') as conn:
        grant=conn.execute('SELECT id,starts_at,ends_at FROM entitlements_accessgrant WHERE tenant_id=%s AND product_id=%s',[tenant_id,'alisa_market']).fetchone()
    check('s04_customer_and_admin_exact_same_absolute_period',current['history'][0]['id']==str(grant[0]) and current['active_until']==grant[2].isoformat() and original['items'][0]['ends_at']==grant[2].isoformat())
    expect(customer.locator('section[aria-label="Уведомления"]')).to_contain_text('Вам предоставлен период доступа')
    check('s04_in_product_notification_visible_without_fake_payment',not any(text in customer.locator('main').inner_text().lower() for text in ['платёж получен','оплата получена']))
    manage('platform',['access_deliver','--allow-private-sink','--limit','1'])
    manage('platform',['access_deliver','--allow-private-sink','--limit','1'])
    with db('platform') as conn:
        sent=conn.execute('SELECT count(*) FROM entitlements_accessnotification WHERE grant_id=%s AND email_sent_at IS NOT NULL',[grant[0]]).fetchone()[0]
    check('s04_explicit_synthetic_outbox_ack_persisted_no_second_grant',sent==1)
    repeat=owner_page.request.post(origin+'/api/staff/access',data=payload,headers={'Origin':origin})
    check('s04_real_bff_same_operation_retry_same_response',repeat.status==200 and repeat.json()==original)
    conflict=owner_page.request.post(origin+'/api/staff/access',data={**payload,'limit':1},headers={'Origin':origin})
    check('s04_real_bff_changed_payload_same_key_conflict',conflict.status==409)
    denied=second_context.request.post(origin+'/api/staff/access',data={'action':'preview','gift':{}},headers={'Origin':origin})
    check('s04_revoked_reader_cannot_grant_via_direct_bff',denied.status==403)
    check('s04_access_bff_checks_browser_origin',owner_page.request.post(origin+'/api/staff/access',data={'action':'batches'},headers={'Origin':'https://wrong.example.invalid'}).status==403)
    check('s04_customer_cannot_inject_scope_in_access_read',customer.request.get(web_origin+'/api/account/access?tenant_id='+str(uuid.uuid4())).status==422)
    # More than five real PG recipients exercises the visible resume button.
    labels=[owner_label,reader_email]
    with db('platform') as conn:
        for n in range(4):
            cid,tid=uuid.uuid4(),uuid.uuid4();label='Access Bulk '+str(n)
            conn.execute('INSERT INTO accounts_customer(id,email,display_name,is_active,security_revision,created_at) VALUES(%s,%s,%s,true,1,now())',[cid,'bulk-'+str(n)+'@example.invalid',label])
            conn.execute('INSERT INTO accounts_tenant(id,created_at) VALUES(%s,now())',[tid])
            conn.execute("INSERT INTO accounts_membership(customer_id,tenant_id,role) VALUES(%s,%s,'OWNER_CLIENT')",[cid,tid])
            labels.append(label)
    owner_page.goto(origin+'/admin')
    for label in labels:owner_page.get_by_role('checkbox',name='Выбрать '+label,exact=True).check()
    bulk=owner_page.locator('section[aria-label="Групповая выдача"]')
    bulk.get_by_label('Дней',exact=True).fill('3');bulk.get_by_role('button',name='Предварительный просмотр',exact=True).click()
    expect(bulk.locator('section[aria-label="Предпросмотр доступа"]')).to_be_visible()
    bulk.get_by_role('button',name='Подтвердить выдачу',exact=True).click()
    expect(bulk.get_by_role('button',name='Продолжить выдачу',exact=True)).to_be_visible()
    check('s04_six_recipient_ui_exposes_partial_resume',True)
    owner_page.reload();owner_page.get_by_role('button',name='Выдачи доступа',exact=True).click()
    journal=owner_page.locator('section[aria-label="Журнал выдач"]')
    journal.locator('ul').first.locator('button').first.click()
    expect(journal.get_by_role('button',name='Продолжить выдачу',exact=True)).to_be_visible()
    # Lose a committed resume ACK while storage reads/writes/deletes all fail.
    # The in-memory retry must send the same operation and create no extra grant.
    resume_attempts=[]
    def lose_resume_ack(route):
        data=route.request.post_data_json
        if data.get('action')=='execute':
            resume_attempts.append(data)
            response=route.fetch()
            if len(resume_attempts)==1:
                assert response.status==200
                route.fulfill(status=503,content_type='application/json',body='{"code":"UNAVAILABLE"}')
            else:route.fulfill(response=response)
        else:route.continue_()
    owner_page.evaluate("""() => {
      window.__auditStorage={};
      for(const method of ['getItem','setItem','removeItem']){
        window.__auditStorage[method]=Storage.prototype[method];
        Storage.prototype[method]=function(k,...args){if(k==='alisa-access-pending-operation')throw new DOMException('blocked','SecurityError');return window.__auditStorage[method].call(this,k,...args);};
      }
    }""")
    owner_page.route('**/api/staff/access',lose_resume_ack)
    journal.get_by_role('button',name='Продолжить выдачу',exact=True).click()
    expect(journal.get_by_role('status')).to_contain_text('Ответ не получен')
    expect(journal.get_by_role('button',name='Продолжить выдачу',exact=True)).to_be_enabled()
    journal.get_by_role('button',name='Продолжить выдачу',exact=True).click()
    expect(journal).to_contain_text('Все строки обработаны.')
    check('audit_resume_unknown_and_storage_failure_reuses_exact_operation',len(resume_attempts)==2 and resume_attempts[0]==resume_attempts[1])
    owner_page.unroute('**/api/staff/access',lose_resume_ack)
    owner_page.evaluate("() => {for(const m of ['getItem','setItem','removeItem'])Storage.prototype[m]=window.__auditStorage[m];delete window.__auditStorage;}")

    with db('platform') as conn:
        total=conn.execute("SELECT count(*) FROM entitlements_accessgrant WHERE product_id='alisa_market'").fetchone()[0]
    check('s04_reload_and_explicit_resume_do_not_duplicate_bulk',total==7)
    # Only the selected currently active gift is shortened; future grant stays.
    owner_page.get_by_role('button',name='Клиенты',exact=True).click();owner_page.get_by_role('button',name=owner_label,exact=True).click()
    panel=owner_page.locator('section[aria-label="Карточка клиента"] section[aria-label="Управление доступом"]')
    panel.get_by_role('button',name='Отозвать оставшийся срок',exact=True).first.click()
    expect(panel.locator('section[aria-label="Предпросмотр доступа"]')).to_contain_text('Остальные периоды сохранятся')
    panel.get_by_role('button',name='Подтвердить отзыв',exact=True).click()
    expect(panel.get_by_role('status')).to_contain_text('Оставшийся срок выбранного периода отозван')
    customer.reload();expect(customer.get_by_role('heading',name='Доступ запланирован',exact=True)).to_be_visible()
    after=customer.request.get(web_origin+'/api/account/access').json()['access']
    check('s04_revoke_keeps_original_history_and_future_period',len(after['history'])==2 and after['history'][0]['adjusted'] and after['history'][0]['ends_at']==grant[2].isoformat() and not after['history'][1]['adjusted'])
    customer.close()
