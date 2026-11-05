"""One bounded exact-rule own-UID stage egress qualification, with own-table cleanup."""
import os,sys,pathlib,json,subprocess,socket,signal,time,datetime,fcntl,contextlib,pwd,hashlib,re,urllib.request
from email.parser import BytesParser
from email import policy
from playwright.sync_api import sync_playwright,expect
import psycopg
os.umask(0o077)
TABLE='alisa_s02_egress_probe_6ae34835';RELEASE='alisa-6ae348354b3db0d3';HASH='491e90c3178d404240de17e684f0651f3d6ca11a5a447cfc306984bda0b9c7d0';WEB='https://alisa-stage.octoport.ru';IDP='https://id-stage.octoport.ru';BASE=pathlib.Path('/opt/alisa-platform/stage');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');BACK=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s02-6ae348354b3db0d3');RULES=E/'PROPOSED_ONLY_s02_egress_probe_6ae34835.nft';CASES=[]

def cmd(*a,timeout=10):return subprocess.run(list(a),capture_output=True,text=True,check=True,timeout=timeout)
def cfg(n):return dict(l.split('=',1) for l in (pathlib.Path('/etc/alisa-platform/stage')/(n+'.env')).read_text().splitlines() if l and not l.startswith('#') and '=' in l)
def sql(c,q,args=()):
 d=cfg(c)
 with psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],autocommit=True,connect_timeout=3) as con:
  cur=con.execute(q,args);return cur.fetchall() if cur.description else []
def exists():return subprocess.run(['nft','list','table','inet',TABLE],capture_output=True,timeout=5).returncode==0
def normalized_rules():
 data=json.loads(cmd('nft','--json','list','ruleset').stdout)
 def strip(x):
  if isinstance(x,list):return [strip(v) for v in x]
  if isinstance(x,dict):return {k:strip(v) for k,v in x.items() if k not in ['handle','packets','bytes']}
  return x
 items=[]
 for item in data['nftables']:
  if 'metainfo' in item:continue
  entity=next(iter(item.values()))
  if isinstance(entity,dict) and (entity.get('name')==TABLE or entity.get('table')==TABLE):continue
  items.append(strip(item))
 return hashlib.sha256(json.dumps(items,sort_keys=True,separators=(',',':')).encode()).hexdigest()
def counters():
 data=json.loads(cmd('nft','--json','list','table','inet',TABLE).stdout);out={}
 for item in data['nftables']:
  rule=item.get('rule',{})
  if 'comment' in rule:out[rule['comment']]=next(v['counter']['packets'] for v in rule['expr'] if 'counter' in v)
 return out
def check(name,ok,**safe):
 CASES.append({'case':name,'passed':bool(ok),**safe});print(json.dumps(CASES[-1]),flush=True)
 if not ok:raise RuntimeError('CHECK_FAILED:'+name)
def interrupted(*_):raise TimeoutError('Bounded egress qualification interrupted')
def run():
 result_path=E/'AL_S02_INSTALLED_NFT_EGRESS_20261105.json'
 if result_path.exists():raise RuntimeError('Existing outcome must be reconciled; no duplicate test')
 r={'scope':'REAL_INSTALLED_EXACT_UID_PORT_NFT_EGRESS_QUALIFICATION','release':RELEASE,'source_sha':'6ae348354b3db0d3cdcdac03c7fcc7dd3ca0eb36','artifact_sha256':'4848fc3e0975d4b3fb347e7b0f5634c44ad81d01a31690263a3bf31cfb83136c','rules_sha256':HASH,'table':TABLE,'status':'RUNNING','cases':CASES,'started_utc':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 owned=False;applied_attempted=False;sentinel=None;browser=None;pw=None;before_rules=None;started=time.monotonic()
 try:
  check('exact_stage_pointers',all((BASE/n).resolve().name==RELEASE for n in ['site-current','identity-current']) and (BASE/'current').resolve().name=='alisa-77d0f8ee2643ef65')
  check('exact_three_owned_uids',{c:pwd.getpwnam('alisa-'+c+'-stage').pw_uid for c in ['web','platform','identity']}=={'web':995,'platform':993,'identity':990})
  check('exact_dns_unchanged',[l.split()[1] for l in pathlib.Path('/etc/resolv.conf').read_text().splitlines() if l.startswith('nameserver')]==['195.208.4.1','8.8.4.4'])
  for c in ['platform','identity']:check(c+'_own_pg_endpoint',cfg(c)['ALISA_DB_HOST']=='127.0.0.1' and cfg(c)['ALISA_DB_PORT']=='5432')
  check('exact_web_api_and_fixed_issuer',cfg('web')['ALISA_PLATFORM_URL']=='http://127.0.0.1:18102' and cfg('web')['ALISA_IDENTITY_ISSUER']==IDP)
  check('exact_rules_hash',hashlib.sha256(RULES.read_bytes()).hexdigest()==HASH)
  check('table_absent_before_apply',not exists());cmd('nft','--check','--file',str(RULES));before_rules=normalized_rules();r['foreign_rules_before_sha256']=before_rules
  sentinel=socket.socket();sentinel.bind(('127.0.0.1',18299));sentinel.listen(8)
  with socket.create_connection(('127.0.0.1',18299),timeout=2):pass
  check('own_sentinel_positive_observer_baseline',True)
  signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted);signal.signal(signal.SIGALRM,interrupted);signal.alarm(180)
  applied_attempted=True;cmd('nft','--file',str(RULES));owned=True;check('only_exact_new_table_applied',exists() and normalized_rules()==before_rules)
  before=counters();r['counters_before']=before
  for label,host,port in [('own_loopback_sentinel','127.0.0.1',18299),('reserved_external_address','198.51.100.1',443)]:
   code="import socket,json\ntry:\n s=socket.create_connection(("+repr(host)+","+str(port)+"),timeout=2);s.close();print(json.dumps({'denied':False}))\nexcept OSError as e:print(json.dumps({'denied':True,'errno':e.errno}))\n"
   previous=counters()['alisa-s02-denied'];out=cmd('runuser','-u','alisa-web-stage','--','/usr/bin/python3','-c',code);w=json.loads(out.stdout);after=counters()['alisa-s02-denied'];check(label+'_actual_uid_deny',w['denied'] and after>previous,errno=w.get('errno'),deny_packets_delta=after-previous)
  with socket.create_connection(('127.0.0.1',18299),timeout=2):pass
  check('observer_positive_sentinel_still_available',True)
  private=json.loads((BACK/'synthetic-fixture.json').read_text());customer=private['customer_id'];tenant=private['tenant_id'];person=private['person_id']
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});context=browser.new_context(storage_state=str(BACK/'synthetic-browser-state.json'));page=context.new_page();page.set_default_timeout(20000)
  page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('existing_cabinet_with_filter_active',page.get_by_text(private['email'],exact=True).is_visible())
  page.get_by_role('button',name='Выйти из кабинета').click();page.goto(WEB+'/login');page.locator('input[name=service]').check();page.locator('input[name=privacy]').check();page.get_by_role('button',name='Войти или создать кабинет').click();page.wait_for_url(re.compile(re.escape(IDP)+'/accounts/'))
  if page.get_by_role('button',name='Продолжить вход по коду').count():page.get_by_role('button',name='Продолжить вход по коду').click()
  field=page.locator('input[name=login],input[name=email]').first;expect(field).to_be_visible();field.fill(private['email']);page.locator('form').filter(has=field).locator('button[type=submit]').first.click();expect(page.locator('input[name=code]')).to_be_visible();cmd('systemctl','start','alisa-identity-mail@stage.service',timeout=25)
  value=None
  for p in sorted(pathlib.Path('/var/lib/alisa-platform/stage/mail-sandbox').glob('*.eml'),key=lambda p:p.stat().st_mtime,reverse=True):
   m=BytesParser(policy=policy.default).parsebytes(p.read_bytes())
   if private['email'] not in str(m.get('To','')):continue
   match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',m.get_body(preferencelist=('plain',)).get_content())
   if match:value=match[1];break
  assert value;private['private_values'].append(value)
  page.locator('input[name=code]').fill(value);page.locator('form').filter(has=page.locator('input[name=code]')).locator('button[type=submit]').first.click();expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible();check('fresh_https_identity_code_bff_api_pg_under_filter',page.get_by_text(private['email'],exact=True).is_visible())
  check('same_person_customer_tenant_no_duplicate',str(sql('platform','SELECT tenant_id FROM accounts_membership WHERE customer_id=%s',[customer])[0][0])==tenant and sql('platform','SELECT count(*) FROM accounts_customer WHERE email=%s',[private['email']])[0][0]==1 and str(sql('identity','SELECT id FROM accounts_person WHERE email=%s',[private['email']])[0][0])==person)
  check('same_profile_preserved',page.locator('input[name=display_name]').input_value()=='Тестовый пользователь S02')
  context.storage_state(path=str(BACK/'synthetic-browser-state.json'));private['private_values'].extend(c['value'] for c in context.cookies());(BACK/'synthetic-fixture.json').write_text(json.dumps(private))
  after=counters();r['counters_after']=after
  for name in ['alisa-s02-web-api','alisa-s02-platform-db','alisa-s02-identity-db-mail','alisa-s02-fixed-issuer']:check(name+'_allowed_packets_observed',after[name]>before[name],delta=after[name]-before[name])
  check('foreign_rules_unchanged_while_applied',normalized_rules()==before_rules)
  r['status']='PASS'
 except BaseException as ex:
  r['status']='FAILED';r['error_type']=type(ex).__name__
  if isinstance(ex,RuntimeError) and str(ex).startswith('CHECK_FAILED:'):r['failed_case']=str(ex).split(':',1)[1]
  if 'page' in locals():r['last_browser_path']=__import__('urllib.parse',fromlist=['urlsplit']).urlsplit(page.url).path
  tb=ex.__traceback__
  while tb:
   if tb.tb_frame.f_code.co_filename==__file__:r['line']=tb.tb_lineno
   tb=tb.tb_next
 finally:
  signal.alarm(0)
  if browser:
   try:browser.close()
   except Exception:pass
  if pw:
   try:pw.stop()
   except Exception:pass
  if sentinel:sentinel.close()
  if applied_attempted and not owned:
   r['apply_uncertain_table_present']=exists()
   # Baseline was absent and this exact single apply was attempted under own locks.
   if r['apply_uncertain_table_present']:r['status']='UNKNOWN_APPLY_OUTCOME_REQUIRES_RECONCILIATION'
  if owned:
   try:cmd('nft','delete','table','inet',TABLE)
   except Exception as ex:r['cleanup_error_type']=type(ex).__name__;r['status']='CLEANUP_FAILED'
  r['table_removed']=not exists()
  r['foreign_rules_after_sha256']=normalized_rules();r['foreign_rules_unchanged']=before_rules is not None and r['foreign_rules_after_sha256']==before_rules
  if not r['table_removed'] or not r['foreign_rules_unchanged']:r['status']='CLEANUP_OR_FOREIGN_RULE_CHECK_FAILED'
  r['health']={}
  for c,port in [('web',18100),('platform',18102),('identity',18103),('admin',18101)]:
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=3) as response:r['health'][c]=json.load(response)
   except Exception as ex:r['health'][c]={'error_type':type(ex).__name__};r['status']='POSTCHECK_FAILED'
  r['elapsed_seconds']=round(time.monotonic()-started,3);r['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();result_path.write_text(json.dumps(r,indent=2));print(json.dumps({'status':r['status'],'cases':len(CASES),'table_removed':r['table_removed'],'foreign_rules_unchanged':r['foreign_rules_unchanged'],'elapsed_seconds':r['elapsed_seconds'],'failed_case':r.get('failed_case'),'error_type':r.get('error_type'),'line':r.get('line')}),flush=True)
 return r['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
