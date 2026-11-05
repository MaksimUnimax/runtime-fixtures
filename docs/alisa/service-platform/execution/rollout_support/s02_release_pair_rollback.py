import pathlib,json,subprocess,os,contextlib,fcntl,urllib.request,urllib.error,time,datetime,uuid,sys,hashlib
import psycopg
from playwright.sync_api import sync_playwright,expect
os.umask(0o077)
BASE=pathlib.Path('/opt/alisa-platform/stage');R='alisa-6ae348354b3db0d3';BACK=pathlib.Path('/var/lib/alisa-platform/stage/rollout-backups/s02-6ae348354b3db0d3');E=pathlib.Path('/var/lib/alisa-platform/stage/evidence');ROOT=pathlib.Path('/etc/alisa-platform/stage');WEB='https://alisa-stage.octoport.ru';CASES=[]
def cmd(*a):return subprocess.run(list(a),capture_output=True,text=True,check=True,timeout=30)
def check(n,ok):
 CASES.append({'case':n,'passed':bool(ok)});print(json.dumps(CASES[-1]),flush=True)
 if not ok:raise RuntimeError(n)
def cfg(n):return dict(l.split('=',1) for l in (ROOT/(n+'.env')).read_text().splitlines() if l and not l.startswith('#') and '=' in l)
def sql(c,q,args=()):
 d=cfg(c)
 with psycopg.connect(host=d['ALISA_DB_HOST'],port=d['ALISA_DB_PORT'],dbname=d['ALISA_DB_NAME'],user=d['ALISA_DB_USER'],password=d['ALISA_DB_PASSWORD'],autocommit=True) as con:
  r=con.execute(q,args);return r.fetchall() if r.description else []
def point(n,target):
 tmp=BASE/('.s02-rollback-'+n);assert not tmp.exists();tmp.symlink_to(target);os.replace(tmp,BASE/n)
def restart():
 cmd('systemctl','daemon-reload');cmd('nginx','-t');cmd('systemctl','reload','nginx');cmd('systemctl','restart','alisa-web@stage.service','alisa-platform@stage.service','alisa-identity@stage.service')
def health(site,idp):
 result={}
 for n,port,version in [('web',18100,site),('platform',18102,site),('identity',18103,idp),('admin',18101,'alisa-77d0f8ee2643ef65')]:
  for _ in range(50):
   try:
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+'/health/ready',timeout=2) as r:d=json.load(r)
    if d.get('release')==version and d.get('status')=='READY':result[n]=d;break
   except OSError:pass
   time.sleep(.2)
  else:raise RuntimeError('Readback failed '+n)
 return result

def run():
 out=E/'AL_S02_RELEASE_PAIR_ROLLBACK_20261105.json';assert not out.exists();r={'scope':'REAL_STAGE_S02_S01_S00_SAME_S02_ROLLBACK_RETAIN_DATA','release':R,'cases':CASES,'status':'RUNNING'}
 data=json.loads((BACK/'synthetic-fixture.json').read_text());v=pathlib.Path('/etc/nginx/sites-available/alisa-platform-stage.conf');drop=pathlib.Path('/etc/systemd/system/alisa-identity@stage.service.d/s02-release.conf');assert (BASE/'site-current').resolve().name==R and (BASE/'identity-current').resolve().name==R
 newv=v.read_text();newdrop=drop.read_text();(BACK/'after-stage-vhost.conf').write_text(newv);(BACK/'after-identity-dropin.conf').write_text(newdrop);before=BACK/'before';pw=None;browser=None;restored=False
 try:
  for c in ['identity-mail','account-cleanup']:cmd('systemctl','disable','--now','alisa-'+c+'@stage.timer');cmd('systemctl','stop','alisa-'+c+'@stage.service')
  for c in ['web','platform','identity','platform-migration','identity-migration']:
   p=ROOT/(c+'.env');p.write_bytes((before/p.relative_to('/')).read_bytes());p.chmod(0o600)
  v.write_bytes((before/v.relative_to('/')).read_bytes());v.chmod(0o644);drop.unlink();point('site-current',BASE/'releases/alisa-8d680f775c8ccdf2');assert (BASE/'identity-current').is_symlink();(BASE/'identity-current').unlink();restart();r['rolled_back_health']=health('alisa-8d680f775c8ccdf2','alisa-77d0f8ee2643ef65');check('real_s01_and_s00_versions_restored',True)
  check('new_tables_and_same_ids_retained_under_old_code',sql('platform','SELECT tenant_id FROM accounts_membership WHERE customer_id=%s',[data['customer_id']])[0][0].__str__()==data['tenant_id'] and str(sql('identity','SELECT id FROM accounts_person WHERE id=%s',[data['person_id']])[0][0])==data['person_id'])
  check('identity_auth_disabled_during_rollback',r['rolled_back_health']['identity'].get('authentication')=='NOT_IMPLEMENTED')
  payload={'request_id':str(uuid.uuid4()),'email':'s02-'+data['run']+'-rollback@example.invalid','service_consent':True,'marketing_consent':False,'attribution':{}}
  def post():
   req=urllib.request.Request(WEB+'/api/public/leads',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json','Origin':WEB})
   with urllib.request.urlopen(req,timeout=10) as response:return response.status
  check('old_s01_bff_inserts_compatible_expanded_schema',post()==202);check('old_s01_repeat_has_one_effect',post()==202 and sql('platform','SELECT count(*) FROM leads_lead WHERE email=%s',[payload['email']])[0][0]==1)
  check('old_submission_nullable_timestamp_compatible',sql('platform','SELECT s.created_at FROM leads_submission s JOIN leads_lead l ON s.lead_id=l.id WHERE l.email=%s',[payload['email']])[0][0] is None)
  data['private_values'].append(payload['email']);(BACK/'synthetic-fixture.json').write_text(json.dumps(data));r['rollback_without_database_restore']=True
 finally:
  for c in ['web','platform','identity','platform-migration','identity-migration']:
   p=ROOT/(c+'.env');p.write_bytes((BACK/'after'/(c+'.env')).read_bytes());p.chmod(0o600)
  v.write_text(newv);v.chmod(0o644);drop.write_text(newdrop);drop.chmod(0o644);point('site-current',BASE/'releases'/R);point('identity-current',BASE/'releases'/R);restart()
  for c in ['identity-mail','account-cleanup']:cmd('systemctl','enable','--now','alisa-'+c+'@stage.timer')
  r['restored_s02_health']=health(R,R);restored=True
 try:
  check('exact_same_s02_reenabled',restored)
  pw=sync_playwright().start();browser=pw.chromium.launch(headless=True,env={k:v for k,v in os.environ.items() if k in ['PATH','HOME','LANG','PLAYWRIGHT_BROWSERS_PATH']});context=browser.new_context(storage_state=str(BACK/'synthetic-browser-state.json'));page=context.new_page();page.goto(WEB+'/app');expect(page.get_by_role('heading',name='Мой кабинет',exact=True)).to_be_visible(timeout=15000);check('same_browser_session_and_profile_survive_release_pair',page.get_by_text(data['email'],exact=True).is_visible());check('same_customer_tenant_person_no_duplicate',str(sql('platform','SELECT tenant_id FROM accounts_membership WHERE customer_id=%s',[data['customer_id']])[0][0])==data['tenant_id'] and sql('platform','SELECT count(*) FROM accounts_customer WHERE email=%s',[data['email']])[0][0]==1 and str(sql('identity','SELECT id FROM accounts_person WHERE email=%s',[data['email']])[0][0])==data['person_id'])
  check('new_keys_retained',all((ROOT/(c+'.env')).read_bytes()==(BACK/'after'/(c+'.env')).read_bytes() for c in ['web','platform','identity','platform-migration','identity-migration']))
  check('shared_s00_current_unchanged',(BASE/'current').resolve().name=='alisa-77d0f8ee2643ef65');r['status']='PASS'
 finally:
  if browser:browser.close()
  if pw:pw.stop()
  r['finished_utc']=datetime.datetime.now(datetime.timezone.utc).isoformat();out.write_text(json.dumps(r,indent=2));print(json.dumps({'status':r['status'],'cases':len(CASES),'restored_s02':restored}))
 return r['status']=='PASS'
if __name__=='__main__':
 with contextlib.ExitStack() as stack:
  for n in ['alisa-stage-rollout.lock','alisa-s01-rollout.lock','alisa-s02-provider-probe.lock','alisa-s02-rollout.lock']:
   f=stack.enter_context(open('/run/lock/'+n,'a+'));fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  sys.exit(0 if run() else 1)
