"""Resume only uncompleted checks after reconciling the SMTP systemd rate limit."""
import datetime,importlib.util,json,sys,time,urllib.parse,uuid,hashlib,subprocess,os,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
path=Path('/var/lib/alisa-platform/stage/evidence/smoke-s01-stage.py')
assert hashlib.sha256(path.read_bytes()).hexdigest()=='5f74aaab26594f678e2f9d290d6344b97b8b53cc4c49592500ec2e3a952c24d8'
spec=importlib.util.spec_from_file_location('previous_stage_smoke',path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
EVIDENCE=m.EVIDENCE;INBOX=m.INBOX;ORIGIN=m.ORIGIN;RELEASE=m.RELEASE
original=json.loads(m.RESULT.read_text());assert original['status']=='FAILED' and original['passed_count']==49 and original['case_count']==49
RUN=original['synthetic_fixture_id'];m.RUN=RUN
sql=m.sql;check=m.check;command=m.command;request=m.request;post=m.post;payload=m.payload;lead=m.lead;letter=m.letter;wait_ready=m.wait_ready
last_start=0

def drain():
    global last_start
    remaining=3.0-(time.monotonic()-last_start)
    if remaining>0:time.sleep(remaining)
    last_start=time.monotonic();m.drain()

def main():
    output=EVIDENCE/'AL_S01_STAGE_SMOKE_CONTINUATION_20261105.json'
    if output.exists():raise RuntimeError('Continuation exists; inspect rather than duplicate')
    proof={'record_type':'AL_S01_RECONCILED_SMOKE_CONTINUATION','source_commit':'8d680f775c8ccdf2a9520fa93c4909dd0aaaa986','artifact_sha256':'fd28f38960c50f5375fe4ff74ca0a29fd01aaf168673fe31213e3e662f094642','release':RELEASE,'started_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'previous_result':m.RESULT.name,'previous_passed_cases':49,'cause':'Test manually started five mail batches inside10seconds; native StartLimitBurst5/10seconds blocked the sixth. Scheduled timer subsequently delivered the pending message; no protection was relaxed.','status':'RUNNING','cases':m.CASES}
    output.write_text(json.dumps(proof,indent=2)+'\n')
    before=json.loads((EVIDENCE/'AL_S01_PREFLIGHT_20261105.json').read_text())
    timer_was_active=command('systemctl','is-active','alisa-lead-mail@stage.timer').stdout.strip()=='active';command('systemctl','stop','alisa-lead-mail@stage.timer')
    since=datetime.datetime.fromisoformat(original['started_at_utc']).strftime('%Y-%m-%d %H:%M:%S UTC')
    access=Path('/var/log/nginx/alisa-platform-stage.access.log');offset=0
    main_payload=payload('main');lead_id,_=lead(main_payload['email'])
    contacts=[payload(k)['email'] for k in ['main','expired','locked']];tokens=[]
    for file in INBOX.glob('*.eml'):
        text=file.read_text()
        if 's01-'+RUN+'-' in text:
            found=re.search(r'https://[^\s]+/join/confirm#[^\s]+',text)
            if found:
                parsed=urllib.parse.parse_qs(urllib.parse.urlsplit(found.group(0)).fragment)
                if 'token' in parsed:tokens.extend(parsed['token'])
    try:
        p=payload('locked');lid,_=lead(p['email']);delivered=sql('SELECT sent_at IS NOT NULL,attempts FROM leads_mailoutbox WHERE lead_id=%s',[lid])[0]
        check('failed_batch_outcome_reconciled_without_duplicate_delivery',delivered==(True,1))
        _,t,_=letter(p['email']);tokens.append(t['token'])
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
        try:
            if timer_was_active:command('systemctl','start','alisa-lead-mail@stage.timer')
        except Exception as error:
            proof['status']='FAILED';proof['timer_restore_error']=type(error).__name__
        proof['finished_at_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();proof['case_count']=len(m.CASES);proof['passed_count']=sum(x['passed'] for x in m.CASES)
        output.write_text(json.dumps(proof,indent=2)+'\n')

if __name__=='__main__':
    try:main()
    except Exception as error:
        print(json.dumps({'continuation_status':'FAILED','error_type':type(error).__name__}));sys.exit(1)
