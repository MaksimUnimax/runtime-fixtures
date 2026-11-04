"""Synthetic AL-S01 qualification using ONLY the caller's guarded disposable DB."""
import email.policy
from email.parser import BytesParser
import json
import re
import socketserver
import threading
from urllib.parse import urlsplit, parse_qs
import uuid

class Sink(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

class SMTP(socketserver.StreamRequestHandler):
    def handle(self):
        self.wfile.write(b'220 synthetic mail sink\r\n')
        while line := self.rfile.readline():
            command=line.split(b' ',1)[0].strip().upper()
            if command in {b'EHLO',b'HELO'}: self.wfile.write(b'250-localhost\r\n250 HELP\r\n')
            elif command in {b'MAIL',b'RCPT',b'RSET',b'NOOP'}: self.wfile.write(b'250 OK\r\n')
            elif command==b'DATA':
                self.wfile.write(b'354 send data\r\n');body=[]
                while (part:=self.rfile.readline()) not in {b'.\r\n',b''}: body.append(part[1:] if part.startswith(b'..') else part)
                self.server.messages.append(b''.join(body));self.wfile.write(b'250 accepted\r\n')
            elif command==b'QUIT': self.wfile.write(b'221 bye\r\n');break
            else: self.wfile.write(b'502 unsupported\r\n')

def link(message):
    text=BytesParser(policy=email.policy.default).parsebytes(message).get_body(preferencelist=('plain',)).get_content()
    url=re.search(r'http[^\s]+/join/confirm#[^\s]+',text).group(0)
    params=parse_qs(urlsplit(url).fragment)
    return url, {key:params[key][0] for key in ['lead_id','token']}

def qualify(origin, request, check, connect, manage, logs_path, browser_enabled):
    url=origin+'/api/public/leads'
    def post(payload):return request(url,'POST',payload,origin=origin)
    payload={'request_id':str(uuid.uuid4()),'email':'roundtrip@example.invalid','service_consent':True,
             'marketing_consent':False,'attribution':{'utm_source':'private-contact@example.invalid','utm_medium':'cpc','utm_term':'secret-search'}}
    with Sink(('127.0.0.1',18225),SMTP) as sink:
        sink.messages=[];threading.Thread(target=sink.serve_forever,daemon=True).start()
        try:
            check('s01_cross_origin_denied',request(url,'POST',payload,origin='https://foreign.invalid')[0]==403)
            check('s01_no_real_contact_collection',post({**payload,'email':'real@example.com'})[0]==422)
            check('s01_consent_required',post({**payload,'service_consent':False})[0]==422)
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=4) as pool:
                responses=list(pool.map(lambda _:post(payload),range(8)))
            check('s01_concurrent_duplicate_submission_acknowledged',all(code==202 for code,_ in responses))
            check('s01_request_id_contact_conflict',post({**payload,'email':'different@example.invalid'})[0]==409)
            with connect('alisa_stage_platform') as db:
                check('s01_one_lead_outbox_and_server_effect',db.execute('SELECT count(*) FROM leads_lead').fetchone()[0]==1 and db.execute('SELECT count(*) FROM leads_mailoutbox').fetchone()[0]==1 and db.execute("SELECT count(*) FROM funnel_funnelevent WHERE event_type='lead.submitted'").fetchone()[0]==1)
                attrs=db.execute('SELECT attribution FROM funnel_funnelevent').fetchone()[0]
                check('s01_unknown_attribution_stripped',attrs=={'utm_source':'OTHER','utm_medium':'cpc','utm_campaign':'OTHER'})
            manage('platform',['leads_deliver'])
            check('s01_real_smtp_delivery',len(sink.messages)==1)
            confirmation,token=link(sink.messages[-1])
            check('s01_token_in_fragment_not_query',not urlsplit(confirmation).query and bool(urlsplit(confirmation).fragment))
            manage('platform',['leads_deliver'])
            check('s01_repeat_mail_batch_does_not_resend',len(sink.messages)==1)
            endpoint=origin+'/api/public/confirm'
            check('s01_wrong_token_rejected',request(endpoint,'POST',{**token,'token':'x'*43},origin=origin)[0]==400)
            check('s01_confirm_contact',request(endpoint,'POST',token,origin=origin)[1].get('state')=='CONFIRMED')
            check('s01_token_one_use',request(endpoint,'POST',token,origin=origin)[0]==400)
            with connect('alisa_stage_platform') as db:
                check('s01_one_confirmed_effect_and_outbox_cleared',db.execute('SELECT count(*) FROM leads_lead WHERE confirmed_at IS NOT NULL').fetchone()[0]==1 and db.execute("SELECT count(*) FROM funnel_funnelevent WHERE event_type='lead.confirmed'").fetchone()[0]==1 and db.execute('SELECT body FROM leads_mailoutbox').fetchone()[0]=='')
            e={'event_id':str(uuid.uuid4()),'event_type':'demo.opened','analytics_consent':False,'attribution':payload['attribution']}
            events=origin+'/api/public/events'
            check('s01_analytics_consent_optional',request(events,'POST',e,origin=origin)[1]['state']=='NOT_TRACKED')
            check('s01_client_cannot_emit_confirmation',request(events,'POST',{**e,'event_type':'lead.confirmed'},origin=origin)[0]==422)
            for _ in range(2):request(events,'POST',{**e,'analytics_consent':True},origin=origin)
            with connect('alisa_stage_platform') as db:
                check('s01_event_uuid_idempotency',db.execute('SELECT count(*) FROM funnel_funnelevent WHERE id=%s',[e['event_id']]).fetchone()[0]==1)
            for label in ['expired','locked']:
                p={**payload,'request_id':str(uuid.uuid4()),'email':label+'@example.invalid'};post(p);manage('platform',['leads_deliver']);_,t=link(sink.messages[-1])
                if label=='expired':
                    with connect('alisa_stage_platform') as db:db.execute("UPDATE leads_lead SET token_expires_at=now()-interval '1 second' WHERE id=%s",[t['lead_id']])
                    check('s01_expired_link_rejected',request(endpoint,'POST',t,origin=origin)[0]==400)
                    post({**p,'request_id':str(uuid.uuid4())});manage('platform',['leads_deliver']);_,new=link(sink.messages[-1])
                    check('s01_expired_challenge_reissued_without_new_lead',new['lead_id']==t['lead_id'] and new['token']!=t['token'] and request(endpoint,'POST',new,origin=origin)[0]==200)
                else:
                    for _ in range(5):request(endpoint,'POST',{**t,'token':'x'*43},origin=origin)
                    check('s01_confirmation_attempt_limit',request(endpoint,'POST',t,origin=origin)[0]==400)
            if browser_enabled:
                from playwright.sync_api import sync_playwright,expect
                with sync_playwright() as p:
                    browser=p.chromium.launch(headless=True)
                    try:
                        page=browser.new_page(viewport={'width':390,'height':844})
                        page.goto(origin);expect(page.get_by_role('heading',level=1)).to_contain_text('голосовом вопросе')
                        check('s01_mobile_layout',page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1'))
                        for route in ['how-it-works','examples','pricing','faq','help','contacts','privacy','terms','consents','login','app/private-object']:
                            response=page.goto(origin+'/'+route);check('s01_page_'+route.replace('/','_'),response.status==200)
                        page.goto(origin+'/join');page.get_by_label('Синтетическая почта').fill('browser-roundtrip@example.invalid')
                        page.locator('input[name=service]').check();page.get_by_role('button',name='Отправить тестовую заявку').click()
                        expect(page.get_by_role('status')).to_contain_text('Заявка сохранена')
                        check('s01_ui_rotates_request_uuid_after_ack',page.evaluate("sessionStorage.getItem('alisa-lead-request') === null"))
                        page.reload();expect(page.get_by_role('status')).to_contain_text('Заявка сохранена')
                        manage('platform',['leads_deliver']);confirmation,browser_token=link(sink.messages[-1])
                        old_browser_token=browser_token
                        with connect('alisa_stage_platform') as db:db.execute("UPDATE leads_lead SET token_expires_at=now()-interval '1 second' WHERE id=%s",[browser_token['lead_id']])
                        page.get_by_label('Синтетическая почта').fill('browser-roundtrip@example.invalid');page.locator('input[name=service]').check()
                        page.get_by_role('button',name='Отправить тестовую заявку').click()
                        expect(page.get_by_role('button',name='Отправить тестовую заявку')).to_be_enabled()
                        manage('platform',['leads_deliver']);confirmation,browser_token=link(sink.messages[-1])
                        check('s01_ui_expired_link_resend_reuses_lead',browser_token['lead_id']==old_browser_token['lead_id'] and browser_token['token']!=old_browser_token['token'])
                        page.goto(confirmation);page.get_by_role('button',name='Подтвердить контакт').click()
                        expect(page.get_by_role('status')).to_contain_text('Контакт подтверждён')
                        page.reload();expect(page.get_by_role('status')).to_contain_text('Контакт подтверждён')
                        check('s01_browser_smtp_confirmation_and_reload',not urlsplit(page.url).fragment)
                        page.goto(origin+'/join');page.get_by_role('button',name='Разрешить',exact=True).click()
                        with connect('alisa_stage_platform') as db:check('s01_direct_join_visit_is_not_cta',db.execute("SELECT count(*) FROM funnel_funnelevent WHERE event_type='cta.clicked'").fetchone()[0]==0)
                        page.goto(origin);page.locator('header a[href="/join"]').click()
                        import time
                        for _ in range(30):
                            with connect('alisa_stage_platform') as db:clicked=db.execute("SELECT count(*) FROM funnel_funnelevent WHERE event_type='cta.clicked'").fetchone()[0]
                            if clicked:break
                            time.sleep(.1)
                        check('s01_actual_cta_click_recorded',clicked==1)
                        with connect('alisa_stage_platform') as db:check('s01_browser_persistent_confirmed_lead',db.execute('SELECT count(*) FROM leads_lead WHERE id=%s AND confirmed_at IS NOT NULL',[browser_token['lead_id']]).fetchone()[0]==1)
                        token_values=[token['token'],browser_token['token']]
                    finally:browser.close()
            else:token_values=[token['token']]
            log=logs_path.read_text()
            check('s01_logs_contain_no_contact_or_confirmation_token',all(value not in log for value in [*token_values,payload['email'],'private-contact@example.invalid','secret-search']))
        finally:sink.shutdown()
