import os,sys,pathlib,json,datetime,subprocess,contextlib,fcntl,time,errno,socket,re
os.umask(0o077)
from playwright.sync_api import sync_playwright,expect
from email.parser import BytesParser
from email import policy
B=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s02-6ae348354b3db0d3');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');WEB='https://alisa-stage.octoport.ru';CREATED=[];CASES=[]
def cmd(*a):return subprocess.run(list(a),capture_output=True,text=True,check=True,timeout=30)
def check(n,ok):
 CASES.append({'case':n,'passed':bool(ok)});print(json.dumps(CASES[-1]),flush=True)
 if not ok:raise RuntimeError(n)
def run():
 out=E/'AL_S02_INSTALLED_EGRESS_20261105.json';assert not out.exists();r={'scope':'TEMPORARY_OWN_SYSTEMD_UNIT_IP_EGRESS_ISOLATION','release':'alisa-6ae348354b3db0d3','cases':CASES,'status':'RUNNING','network_limit':'Allowed issuer IP permits all its ports at network layer; fixed issuer/path enforced by product, not IP filter.'};pw=None;browser=None
 witness=pathlib.Path('/opt/alisa-platform/stage/s02-test');assert not witness.exists();witness.mkdir(mode=0o755);witness.chmod(0o755)
 script=witness/'egress-witness.py';script.write_text("import socket,errno,sys\ntry:\n s=socket.create_connection(('198.51.100.1',443),timeout=2);s.close();print('S02_EGRESS_WITNESS_UNRESTRICTED');sys.exit(2)\nexcept OSError as e:\n print('S02_EGRESS_WITNESS_ERRNO='+str(e.errno));sys.exit(0 if e.errno in (errno.EPERM,errno.EACCES) else 3)\n");script.chmod(0o644)
 try:
  for c in ['web','platform','identity']:
   p=pathlib.Path('/etc/systemd/system')/('alisa-'+c+'@stage.service.d')/'s02-egress-test.conf';assert not p.exists();p.parent.mkdir(mode=0o755,exist_ok=True);p.write_text('[Service]\nIPAccounting=yes\nIPAddressDeny=any\nIPAddressAllow=localhost\nIPAddressAllow=185.244.51.141/32\nExecStartPre=/usr/bin/python3 '+str(script)+'\n');p.chmod(0o644);CREATED.append(p);cmd('systemctl','daemon-reload')
   attempt=subprocess.run(['systemctl','restart','alisa-'+c+'@stage.service'],capture_output=True,text=True,timeout=20)
   if attempt.returncode:
    logs=cmd('journalctl','-u','alisa-'+c+'@stage.service','-n','15','--no-pager','-o','cat').stdout
    r['witness_errno_lines']=[l for l in logs.splitlines() if l.startswith('S02_EGRESS_WITNESS_')];r['blocked_reason']='Per-unit deny mechanism/witness not demonstrated';r['status']='BLOCKED';return r
   logs=cmd('journalctl','-u','alisa-'+c+'@stage.service','-n','15','--no-pager','-o','cat').stdout
   check(c+'_per_unit_actual_errno_denial',any(l in ['S02_EGRESS_WITNESS_ERRNO=1','S02_EGRESS_WITNESS_ERRNO=13'] for l in logs.splitlines()))
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});context=browser.new_context(storage_state=str(B/'synthetic-browser-state.json'));page=context.new_page();page.set_default_timeout(20000);page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('existing_cabinet_works_with_remote_egress_denied',True)
  data=json.loads((B/'synthetic-fixture.json').read_text());page.get_by_role('button',name='Выйти из кабинета').click();page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click();page.wait_for_url(re.compile('https://id-stage.octoport.ru/accounts/'))
  if page.get_by_role('button',name='Продолжить вход по коду').count():page.get_by_role('button',name='Продолжить вход по коду').click()
  f=page.locator('input[name=login],input[name=email]').first;expect(f).to_be_visible();f.fill(data['email']);page.locator('form').filter(has=f).locator('button[type=submit]').first.click();expect(page.locator('input[name=code]')).to_be_visible();cmd('systemctl','start','alisa-identity-mail@stage.service');value=None
  for p in sorted(pathlib.Path('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml'),key=lambda p:p.stat().st_mtime,reverse=True):
   m=BytesParser(policy=policy.default).parsebytes(p.read_bytes())
   if data['email'] in str(m.get('To','')):
    match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',m.get_body(preferencelist=('plain',)).get_content())
    if match:value=match[1];break
  assert value;data['private_values'].append(value);page.locator('input[name=code]').fill(value);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('fresh_identity_bff_pg_login_under_per_unit_deny',page.get_by_text(data['email'],exact=True).is_visible());context.storage_state(path=str(B/'synthetic-browser-state.json'));(B/'synthetic-fixture.json').write_text(json.dumps(data));r['status']='PASS'
 except Exception as ex:r['status']='FAILED';r['error_type']=type(ex).__name__;r['failed_case']=str(ex) if isinstance(ex,RuntimeError) else None
 finally:
  if browser:browser.close()
  if pw:pw.stop()
  for p in CREATED:p.unlink()
  cmd('systemctl','daemon-reload');cmd('systemctl','restart',*['alisa-'+c+'@stage.service' for c in ['web','platform','identity']]);script.unlink();witness.rmdir();r['temporary_dropins_removed']=all(not p.exists() for p in CREATED);r['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();out.write_text(json.dumps(r,indent=2));print(json.dumps(r))
 return r
with contextlib.ExitStack() as stack:
 for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
  f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 result=run();sys.exit(0 if result['status']=='PASS' else 1)
