"""Observe the existing center session after losing only this fixture's site cookie."""
import json,os,pathlib,re,sys
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright,expect
sys.dont_write_bytecode=True;os.umask(0o077)
D=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/auth-navigation-20261108')
PHASE=sys.argv[1] if len(sys.argv)==2 else 'before'
if PHASE not in {'before','after'}:raise SystemExit('Expected before or after')
OUT=D/('identity-reentry-'+PHASE+'.json')
record={'scope':'OWN_FIXTURE_MISSING_SITE_COOKIE_VALID_IDENTITY_COOKIE_NO_LOGOUT_OR_CREDENTIAL_SUBMISSION','status':'FAILED'}
if OUT.exists():raise SystemExit('Existing receipt retained')
try:
 f=json.loads((D/'fixture.private.json').read_text())
 if not f['email'].startswith('auth-ux-') or not f['email'].endswith('@example.invalid'):raise ValueError()
 state=json.loads((D/'browser-state.private.json').read_text())
 state['cookies']=[c for c in state['cookies'] if c['name']!='__Host-alisa_session']
 with sync_playwright() as p:
  b=p.chromium.launch(headless=True);ctx=b.new_context(storage_state=state,ignore_https_errors=False);page=ctx.new_page()
  page.goto('https://alisa.octoport.ru/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет',exact=True).click()
  page.wait_for_url(re.compile(r'https://id\.octoport\.ru/accounts/'))
  record.update(destination=urlsplit(page.url).path,headings=page.locator('h1').all_inner_texts(),messages=[re.sub(r'auth-ux-[a-f0-9]+','[own fixture]',re.sub(r'[\w.+-]+@[\w.-]+','[own fixture]',s)) for s in page.get_by_role('status').all_inner_texts()],explicit_continue=page.get_by_role('button',name='Продолжить вход в кабинет',exact=True).count()==1)
  if PHASE=='after' and (record['destination']!='/accounts/reauthenticate/' or record['headings']!=['Подтвердите вход в кабинет'] or not record['explicit_continue'] or any(re.search(r'Успешный вход|Successfully signed in|Адрес .* подтверждён',m) for m in record['messages'])):raise RuntimeError('Stale session presentation not fixed')
  b.close()
 record['status']='PASS'
except Exception as e:record['error_type']=type(e).__name__
finally:
 with OUT.open('x') as out:json.dump(record,out,indent=2)
 OUT.chmod(0o600);print(json.dumps(record))
