"""Finite real-stage S01 verification. Synthetic contacts, safe evidence only."""
from concurrent.futures import ThreadPoolExecutor
import datetime
from email import policy
from email.parser import BytesParser
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import psycopg
from playwright.sync_api import sync_playwright, expect

ORIGIN='https://alisa-stage.octoport.ru'
RELEASE='alisa-8d680f775c8ccdf2'
EVIDENCE=Path('/var/lib/alisa-platform/stage/evidence')
INBOX=Path('/var/lib/alisa-platform/stage/mail-sandbox')
RESULT=EVIDENCE/'AL_S01_STAGE_SMOKE_20261105.json'
RUN=uuid.uuid4().hex[:12]
CASES=[]
cfg=dict(line.split('=',1) for line in Path('/etc/alisa-platform/stage/platform.env').read_text().splitlines() if line and not line.startswith('#'))
if cfg['ALISA_DB_NAME']!='alisa_stage_platform' or cfg['ALISA_DB_USER']!='alisa_stage_platform_runtime':raise RuntimeError('Wrong test DB scope')

def db():
    return psycopg.connect(host=cfg['ALISA_DB_HOST'],port=cfg['ALISA_DB_PORT'],dbname=cfg['ALISA_DB_NAME'],user=cfg['ALISA_DB_USER'],password=cfg['ALISA_DB_PASSWORD'],connect_timeout=3)
def sql(query,args=()):
    with db() as connection:
        cursor=connection.execute(query,args)
        return cursor.fetchall() if cursor.description else []
def check(name,condition,**safe):
    CASES.append({'case':name,'passed':bool(condition),**safe})
    if not condition:raise RuntimeError('Stage check failed: '+name)
def command(*args):return subprocess.run(list(args),capture_output=True,text=True,check=True)
def request(path,method='GET',data=None,origin=ORIGIN,content='application/json'):
    headers={'Content-Type':content}
    if origin is not None:headers['Origin']=origin
    body=None if data is None else json.dumps(data).encode()
    req=urllib.request.Request(ORIGIN+path,method=method,data=body,headers=headers)
    started=time.monotonic()
    try:
        response=urllib.request.urlopen(req,timeout=12)
    except urllib.error.HTTPError as error:response=error
    with response:
        raw=response.read();code=response.status
        result=json.loads(raw) if 'application/json' in response.headers.get('Content-Type','') else {'html':raw.decode()}
        return code,result,{k.lower():v for k,v in response.headers.items()},round((time.monotonic()-started)*1000)
def post(action,data,**kwargs):return request('/api/public/'+action,'POST',data,**kwargs)
def payload(label):return {'request_id':str(uuid.uuid4()),'email':'s01-'+RUN+'-'+label+'@example.invalid','service_consent':True,'marketing_consent':False,'attribution':{'utm_source':'private-'+RUN+'@example.invalid','utm_medium':'cpc','utm_campaign':'unknown-'+RUN,'utm_term':'private-question-'+RUN}}
def lead(contact):
    rows=sql('SELECT id,confirmed_at FROM leads_lead WHERE email=%s',[contact])
    if len(rows)!=1:raise RuntimeError('Synthetic lead is missing or duplicated')
    return rows[0]
def drain():command('systemctl','start','alisa-lead-mail@stage.service')
def letter(contact):
    for path in sorted(INBOX.glob('*.eml'),key=lambda p:p.stat().st_mtime,reverse=True):
        message=BytesParser(policy=policy.default).parsebytes(path.read_bytes())
        if contact not in str(message.get('To','')):continue
        body=message.get_body(preferencelist=('plain',)).get_content()
        url=re.search(r'https://[^\s]+/join/confirm#[^\s]+',body).group(0)
        values=urllib.parse.parse_qs(urllib.parse.urlsplit(url).fragment)
        return url,{'lead_id':values['lead_id'][0],'token':values['token'][0]},path
    raise RuntimeError('Sandbox letter was not received')
def wait_ready():
    for _ in range(50):
        try:
            code,data,_,_=request('/health/ready')
            if code==200 and data.get('release')==RELEASE:return
        except (OSError,ValueError):pass
        time.sleep(.2)
    raise RuntimeError('Stage ready timeout')

def main():
    if RESULT.exists():raise RuntimeError('Existing smoke result must be inspected; do not duplicate blindly')
    before=json.loads((EVIDENCE/'AL_S01_PREFLIGHT_20261105.json').read_text())
    proof={'record_type':'REAL_INSTALLED_AL_S01_STAGE_SMOKE','source_commit':'8d680f775c8ccdf2a9520fa93c4909dd0aaaa986',
           'artifact_sha256':'fd28f38960c50f5375fe4ff74ca0a29fd01aaf168673fe31213e3e662f094642',
           'release':RELEASE,'environment':'stage','started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),
           'scope':'own HTTPS BFF/API/platform DB/private synthetic SMTP only','cases':CASES,'synthetic_fixture_id':RUN,'status':'RUNNING'}
    RESULT.write_text(json.dumps(proof,indent=2)+'\n')
    timer_was_active=command('systemctl','is-active','alisa-lead-mail@stage.timer').stdout.strip()=='active'
    command('systemctl','stop','alisa-lead-mail@stage.timer')
    since=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')
    access=Path('/var/log/nginx/alisa-platform-stage.access.log');offset=access.stat().st_size if access.exists() else 0
    tokens=[];contacts=[]
    try:
        for route in ['/','/examples','/how-it-works','/pricing','/faq','/help','/contacts','/privacy','/terms','/consents','/join','/login','/app/private-object']:
            code,data,headers,elapsed=request(route)
            check('https_page_'+route.strip('/').replace('/','_'),code==200,status=code,elapsed_ms=elapsed)
            check('noindex_'+route.strip('/').replace('/','_'),'noindex' in headers.get('x-robots-tag',''))
        check('actual_release',request('/health/ready')[1].get('release')==RELEASE)
        check('unknown_route_is_safe_404',request('/absent-'+RUN)[0]==404)
        main_payload=payload('main');contacts.append(main_payload['email'])
        check('foreign_origin_denied',post('leads',main_payload,origin='https://foreign.invalid')[0]==403)
        check('missing_origin_denied',post('leads',main_payload,origin=None)[0]==403)
        check('real_contact_denied',post('leads',{**main_payload,'email':'not-a-recipient@example.com'})[0]==422)
        check('service_consent_required',post('leads',{**main_payload,'service_consent':False})[0]==422)
        check('extra_payload_rejected',post('leads',{**main_payload,'private':'forbidden'})[0]==422)
        with ThreadPoolExecutor(max_workers=4) as pool:
            results=list(pool.map(lambda _:post('leads',main_payload)[0],range(8)))
        check('concurrent_submit_idempotent',results==[202]*8)
        lead_id,_=lead(main_payload['email'])
        check('one_lead_and_submission',sql('SELECT count(*) FROM leads_submission WHERE id=%s',[main_payload['request_id']])[0][0]==1)
        check('request_uuid_cannot_rebind_contact',post('leads',{**main_payload,'email':'other-'+RUN+'@example.invalid'})[0]==409)
        check('one_submitted_server_event',sql("SELECT count(*) FROM funnel_funnelevent WHERE subject_id=%s AND event_type='lead.submitted'",[lead_id])[0][0]==1)
        attrs=sql('SELECT attribution FROM funnel_funnelevent WHERE subject_id=%s',[lead_id])[0][0]
        check('attribution_allowlist_only',attrs=={'utm_source':'OTHER','utm_medium':'cpc','utm_campaign':'OTHER'})
        drain();url,token,path=letter(main_payload['email']);tokens.append(token['token'])
        check('private_sandbox_mail_delivered',path.stat().st_mode&0o777==0o600 and INBOX.stat().st_mode&0o777==0o700)
        count=len(list(INBOX.glob('*.eml')));drain();post('leads',{**main_payload,'request_id':str(uuid.uuid4())});drain()
        check('ordinary_repeat_does_not_send_spam',len(list(INBOX.glob('*.eml')))==count)
        check('one_use_link_in_fragment',not urllib.parse.urlsplit(url).query)
        check('wrong_confirmation_rejected',post('confirm',{**token,'token':'x'*43})[0]==400)
        check('real_bff_api_db_confirmation',post('confirm',token)[1].get('state')=='CONFIRMED')
        check('confirmation_replay_rejected',post('confirm',token)[0]==400)
        check('one_confirmed_server_effect',sql("SELECT count(*) FROM funnel_funnelevent WHERE subject_id=%s AND event_type='lead.confirmed'",[lead_id])[0][0]==1)
        check('mail_outbox_secret_payload_cleared',sql('SELECT body,sent_at IS NOT NULL FROM leads_mailoutbox WHERE lead_id=%s',[lead_id])[0]==('',True))
        for label in ['expired','locked']:
            p=payload(label);contacts.append(p['email']);post('leads',p);drain();_,t,_=letter(p['email']);tokens.append(t['token'])
            if label=='expired':
                sql("UPDATE leads_lead SET token_expires_at=now()-interval '1 second' WHERE id=%s",[t['lead_id']])
                check('ttl_expiry_rejected',post('confirm',t)[0]==400)
                post('leads',{**p,'request_id':str(uuid.uuid4())});drain();_,fresh,_=letter(p['email']);tokens.append(fresh['token'])
                check('ttl_reissue_preserves_one_lead',fresh['lead_id']==t['lead_id'] and fresh['token']!=t['token'])
                check('new_link_after_expiry_works',post('confirm',fresh)[0]==200)
            else:
                for _ in range(5):post('confirm',{**t,'token':'x'*43})
                check('five_failures_lock_challenge',post('confirm',t)[0]==400)
        e={'event_id':str(uuid.uuid4()),'event_type':'demo.opened','analytics_consent':False,'attribution':main_payload['attribution']}
        check('analytics_is_optional',post('events',e)[1].get('state')=='NOT_TRACKED')
        for _ in range(2):post('events',{**e,'analytics_consent':True})
        check('client_event_deduplicated',sql('SELECT count(*) FROM funnel_funnelevent WHERE id=%s',[e['event_id']])[0][0]==1)
        check('client_cannot_forge_confirmation',post('events',{**e,'event_type':'lead.confirmed'})[0]==422)
        browser_payload=payload('browser');contacts.append(browser_payload['email'])
        safe_env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','LC_ALL','DISPLAY']}
        with sync_playwright() as playwright:
            browser=playwright.chromium.launch(headless=True,env=safe_env)
            try:
                page=browser.new_page(viewport={'width':390,'height':844})
                page.goto(ORIGIN);expect(page.get_by_role('heading',level=1)).to_contain_text('голосовом вопросе')
                check('mobile_layout_no_overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
                page.screenshot(path=str(EVIDENCE/'AL_S01_HOME_MOBILE_20261105.png'),full_page=True)
                page.set_viewport_size({'width':1440,'height':1000});check('desktop_layout_no_overflow',page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
                page.screenshot(path=str(EVIDENCE/'AL_S01_HOME_DESKTOP_20261105.png'),full_page=True)
                page.goto(ORIGIN+'/join');page.get_by_label('Синтетическая почта').fill(browser_payload['email']);page.locator('input[name=service]').check()
                page.get_by_role('button',name='Отправить тестовую заявку').click();expect(page.get_by_role('status')).to_contain_text('Заявка сохранена')
                check('browser_ack_clears_request_uuid',page.evaluate("sessionStorage.getItem('alisa-lead-request') === null"))
                page.reload();expect(page.get_by_role('status')).to_contain_text('Заявка сохранена')
                drain();link,t,_=letter(browser_payload['email']);tokens.append(t['token']);page.goto(link)
                page.get_by_role('button',name='Подтвердить контакт').click();expect(page.get_by_role('status')).to_contain_text('Контакт подтверждён')
                page.reload();expect(page.get_by_role('status')).to_contain_text('Контакт подтверждён')
                check('browser_confirm_and_reload_without_token_url',not urllib.parse.urlsplit(page.url).fragment)
                page.screenshot(path=str(EVIDENCE/'AL_S01_CONFIRMED_20261105.png'))
                check('browser_record_confirmed_in_postgresql',lead(browser_payload['email'])[1] is not None)
            finally:browser.close()
        saved=sql('SELECT id,confirmed_at FROM leads_lead WHERE id=%s',[lead_id])[0]
        for unit in ['alisa-platform@stage.service','alisa-web@stage.service']:
            command('systemctl','restart',unit);wait_ready()
        check('web_api_restart_preserves_confirmed_record',sql('SELECT id,confirmed_at FROM leads_lead WHERE id=%s',[lead_id])[0]==saved)
        down=payload('api-down');contacts.append(down['email'])
        command('systemctl','stop','alisa-platform@stage.service')
        try:check('bff_reports_real_api_outage',post('leads',down)[0]==503)
        finally:command('systemctl','start','alisa-platform@stage.service');wait_ready()
        check('api_outage_creates_no_lead',sql('SELECT count(*) FROM leads_lead WHERE email=%s',[down['email']])[0][0]==0)
        p=payload('smtp-recovery');contacts.append(p['email']);command('systemctl','stop','alisa-smtp-sandbox-stage.service')
        try:
            post('leads',p);drain();lid,_=lead(p['email'])
            check('smtp_outage_preserves_pending_outbox',sql('SELECT sent_at IS NULL,attempts FROM leads_mailoutbox WHERE lead_id=%s',[lid])[0]==(True,1))
        finally:command('systemctl','start','alisa-smtp-sandbox-stage.service')
        drain();_,recovery,_=letter(p['email']);tokens.append(recovery['token'])
        check('smtp_recovery_delivers_confirmation',post('confirm',recovery)[0]==200)
        raw_marker='private-'+RUN+'@example.invalid'
        request('/?'+urllib.parse.urlencode({'utm_source':raw_marker,'utm_term':'private-question-'+RUN,'referrer':'private-referrer-'+RUN}))
        time.sleep(.2)
        new_access=access.read_bytes()[offset:].decode()
        app_logs=command('journalctl','-u','alisa-web@stage.service','-u','alisa-platform@stage.service','-u','alisa-lead-mail@stage.service','-u','alisa-smtp-sandbox-stage.service','--since',since,'--no-pager','-o','cat').stdout
        forbidden=[*contacts,*tokens,raw_marker,urllib.parse.quote(raw_marker),'private-question-'+RUN,'private-referrer-'+RUN]
        check('ingress_logs_path_only_no_query',bool(new_access.strip()) and '?' not in new_access and 'utm_' not in new_access)
        check('no_contacts_tokens_or_raw_attribution_in_logs',all(value not in new_access+app_logs for value in forbidden))
        check('funnel_metrics_no_contacts_or_tokens',all(value not in json.dumps(sql('SELECT attribution FROM funnel_funnelevent')) for value in forbidden))
        for name,digest in before['protected_hashes'].items():check('protected_file_unchanged_'+Path(name).name,hashlib.sha256(Path(name).read_bytes()).hexdigest()==digest)
        for name,state in before['excluded_units'].items():
            actual=dict(x.split('=',1) for x in command('systemctl','show',name,'-p','MainPID','-p','ActiveState','-p','ActiveEnterTimestamp').stdout.splitlines())
            check('excluded_service_unchanged_'+name,actual==state)
        check('excluded_common_release_pointer_preserved',Path('/opt/alisa-platform/stage/current').resolve().name=='alisa-77d0f8ee2643ef65')
        check('own_selected_release_pointer',Path('/opt/alisa-platform/stage/site-current').resolve().name==RELEASE)
        check('smtp_only_loopback', '127.0.0.1:18225' in command('ss','-H','-ltn','sport = :18225').stdout)
        proof['confirmed_probe_id']=str(lead_id);proof['status']='PASS'
    except Exception as error:
        proof['status']='FAILED';proof['error_type']=type(error).__name__
        if isinstance(error,RuntimeError):proof['error']=str(error)
        raise
    finally:
        restoration_failed=False
        if timer_was_active:
            try:command('systemctl','start','alisa-lead-mail@stage.timer')
            except Exception as error:
                proof['status']='FAILED';proof['timer_restore_error']=type(error).__name__;restoration_failed=True
        proof['finished_at_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
        proof['case_count']=len(CASES);proof['passed_count']=sum(c['passed'] for c in CASES)
        RESULT.write_text(json.dumps(proof,indent=2)+'\n')
        if restoration_failed:raise RuntimeError('Mail timer restoration failed')

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'smoke_status':'FAILED','error_type':type(error).__name__}))
        sys.exit(1)
