"""Installed canonical UI smoke, own existing fixture, no skill-grant mutation."""
import json
import os
from pathlib import Path as P
import re
import shutil
import signal
import subprocess
import sys
import time
from email import policy
from email.parser import BytesParser
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright, expect

sys.dont_write_bytecode = True
os.umask(0o077)
D = P('/var/lib/alisa-platform/stage/rollout-backups/skill-link-20261109')
OUT = D/'installed-browser.json'
FIXTURE = P('/var/lib/alisa-platform/stage/rollout-backups/auth-navigation-20261108/fixture.private.json')
WEB = 'https://alisa.octoport.ru'
ID = 'https://id.octoport.ru'
record = {'status':'FAILED','scope':'OWN_EXISTING_FIXTURE_NO_SKILL_GRANT_OR_PRIVACY_MUTATION',
          'cases':[], 'skill_grants_created':0, 'privacy_writes':0,
          'marketplace_calls':0, 'real_yandex_broker':'NOT_RUN'}


def check(name, ok):
    record['cases'].append({'case':name,'passed':bool(ok)})
    if not ok:
        raise RuntimeError(name)


def code(email, after):
    deadline = time.monotonic()+70
    while time.monotonic() < deadline:
        for p in P('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml'):
            if p.stat().st_mtime < after:
                continue
            msg = BytesParser(policy=policy.default).parsebytes(p.read_bytes())
            if email not in str(msg.get('To','')):
                continue
            text = msg.get_body(preferencelist=('plain',)).get_content() if msg.is_multipart() else msg.get_content()
            m = re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',text)
            if m:
                return m.group(1)
        time.sleep(.5)
    raise TimeoutError()


def origin(url):
    u = urlsplit(url)
    return u.scheme+'://'+u.netloc


def run():
    temp = P(os.environ.get('TMPDIR','/')).resolve()
    check('private_tmpfs_profile', str(temp).startswith('/run/alisa-s06-browser-') and
          P(os.environ.get('HOME','/')).resolve() == temp and
          subprocess.check_output(['stat','-f','-c','%T',str(temp)],text=True).strip() == 'tmpfs')
    check('root_disk_reserve', shutil.disk_usage('/').free >= 3072*1048576+1048576)
    check('tmpfs_browser_capacity', shutil.disk_usage(temp).free >= 128*1048576)
    check('memory_browser_reserve', next(int(x.split()[1]) for x in P('/proc/meminfo').read_text().splitlines()
          if x.startswith('MemAvailable:')) >= 2560*1024)
    s = FIXTURE.lstat()
    check('existing_private_fixture', s.st_uid == 0 and s.st_mode&0o777 == 0o600 and not FIXTURE.is_symlink())
    fixture = json.loads(FIXTURE.read_text())
    email, password = fixture['email'], fixture['password']
    check('reserved_own_mailbox', email.startswith('auth-ux-') and email.endswith('@example.invalid'))
    check('bounded_mail_sink', len(list(P('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml'))) < 195)
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        try:
            context = browser.new_context(service_workers='block')
            def allow(route):
                if origin(route.request.url) in {WEB,ID}:
                    route.continue_()
                else:
                    record['external_request_blocked'] = True
                    route.abort()
            context.route('**/*',allow)
            page = context.new_page()
            page.set_default_timeout(15000)
            check('canonical_homepage', page.goto(WEB).status == 200)
            page.goto(WEB+'/app/alice')
            check('anonymous_alice_page_requires_login', origin(page.url) == WEB and urlsplit(page.url).path == '/login')
            page.locator('input[name=service]').check()
            page.locator('input[name=privacy]').check()
            page.get_by_role('button',name='Войти или создать кабинет',exact=True).click()
            expect(page.locator('input[name=password]')).to_be_visible()
            check('native_password_form_directly', origin(page.url) == ID and
                  not page.get_by_role('button',name='Продолжить вход в кабинет',exact=True).count())
            page.locator('input[name=login]').fill(email)
            page.locator('input[name=password]').fill(password)
            sent = time.time()
            page.locator('form').filter(has=page.locator('input[name=password]')).locator('button[type=submit]').click()
            expect(page.locator('input[name=code]')).to_be_visible()
            check('email_code_at_pinned_identity_origin',origin(page.url) == ID)
            page.locator('input[name=code]').fill(code(email,sent))
            page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click()
            expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible()
            me = page.request.get(WEB+'/api/account/me')
            check('same_own_customer_logged_in', me.status == 200 and me.json()['profile']['email'] == email)
            own = me.json()['profile']
            cookie = next(c['value'] for c in context.cookies() if c['name']=='__Host-alisa_session')
            page.goto(WEB+'/app/alice')
            expect(page.get_by_role('heading',name='Подключение Алисы',exact=True)).to_be_visible()
            expect(page.get_by_text('Аккаунт ещё не подключён.',exact=True)).to_be_visible()
            check('privacy_default_on_exact_control', page.get_by_label('Приватность',exact=True).input_value() == 'on')
            check('new_page_preserves_product_session', next(c['value'] for c in context.cookies()
                  if c['name']=='__Host-alisa_session') == cookie)
            bad = page.request.post(WEB+'/api/account/alice',headers={'Origin':'https://foreign.example.invalid',
                                    'Content-Type':'application/x-www-form-urlencoded'},data='action=privacy&voice_private=off')
            check('foreign_origin_cannot_change_privacy',bad.status == 403 and bad.json().get('code') == 'ORIGIN_DENIED')
            bad = page.request.post(WEB+'/alice/oauth/token',headers={'Content-Type':'application/x-www-form-urlencoded'},
                                    data='grant_type=authorization_code&code=invalid-fixture-code',max_redirects=0)
            check('invalid_oauth_client_json_without_login_redirect',bad.status in {400,401} and
                  bad.headers.get('content-type','').startswith('application/json') and not bad.headers.get('location'))
            page.goto(WEB+'/login')
            check('login_keeps_valid_customer_session', urlsplit(page.url).path == '/app')
            me = page.request.get(WEB+'/api/account/me')
            check('customer_and_tenant_stable',me.status == 200 and all(me.json()['profile'][k] == own[k]
                  for k in ['customer_id','tenant_id','email']))
            check('no_external_browser_activity',not record.get('external_request_blocked'))
            check('final_disk_floor',shutil.disk_usage('/').free >= 3072*1048576)
        finally:
            browser.close()
    record['status'] = 'PASS'


if __name__ == '__main__':
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(InterruptedError()))
    if OUT.exists():
        raise SystemExit('Existing evidence retained')
    try:
        run()
    except Exception as e:
        record['error_type'] = type(e).__name__
        tb = e.__traceback__
        while tb:
            if tb.tb_frame.f_code.co_filename == __file__:
                record['error_line'] = tb.tb_lineno
            tb = tb.tb_next
    finally:
        with OUT.open('x') as f:
            json.dump(record,f,indent=2)
        print(json.dumps(record))
    sys.exit(0 if record['status']=='PASS' else 1)
