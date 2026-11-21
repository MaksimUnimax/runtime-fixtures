"""Built Next page and real BFF; synthetic platform replies, no real account.
Production PostgreSQL/source authority is tested separately by backend checks.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
from urllib.request import urlopen
from copy import deepcopy
from playwright.sync_api import sync_playwright,expect
import argparse,json,os,socket,subprocess,threading,time,uuid
ROOT=Path(__file__).resolve().parents[2]
SID='11111111-1111-4111-8111-111111111111'
COOKIE='a'*43
SERVICE='synthetic-platform-service-'+('z'*32)
PROFILE={'tenant_id':'synthetic-tenant','customer_id':'synthetic-customer','role':'OWNER_CLIENT','display_name':'Synthetic','email':'synthetic@example.invalid','access_status':'ACTIVE','stores':[]}
STORE={'id':SID,'provider':'OZON','name':'Тестовый магазин','voice_alias':'','revision':1,'status':'ACTIVE','identity_verified':True,'credentials':[]}
class State:
 def __init__(self):self.record={'store_id':SID,'revision':0,'status':'NOT_PROVIDED','facts':None};self.commands={};self.calls=[];self.writes=0;self.offset=0;self.lock=threading.Lock()
state=State()
class Backend(BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def respond(self,value,status=200):
  body=json.dumps(value,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
 def do_POST(self):
  if self.headers.get('Authorization')!='Bearer '+SERVICE:self.respond({'code':'UNAUTHORIZED'},401);return
  body=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))));
  if body.get('session_token')!=COOKIE:self.respond({'code':'AUTHENTICATION_REQUIRED'},401);return
  if self.path=='/api/v1/account/me':self.respond({'profile':PROFILE});return
  if self.path=='/api/v1/account/stores':self.respond({'items':[STORE],'next_cursor':None});return
  if self.path=='/api/v1/account/owner-products':self.respond({'items':[{'sku':'123','name':'Браслет тестовый','offer_id':'ART-TEST'}],'next_cursor':None,'complete':True});return
  if self.path!='/api/v1/account/owner-inputs':self.respond({'code':'NOT_FOUND'},404);return
  c=body['command'];state.calls.append(deepcopy(c));now=int(time.time())+state.offset
  with state.lock:
   if c['store_id']!=SID:self.respond({'code':'NOT_FOUND'},404);return
   if c['action']=='read':self.respond({**deepcopy(state.record),'server_time':now});return
   if c['action']=='status':
    previous=state.commands.get(c['command_id']);self.respond({'state':'DONE'if previous else'NOT_FOUND','receipt':previous,'server_time':now});return
   if c['command_id']in state.commands:self.respond(state.commands[c['command_id']]);return
   if c['not_after']<=now:self.respond({'code':'OWNER_COMMAND_EXPIRED'},409);return
   if c['expected_revision']!=state.record['revision']:self.respond({'code':'REVISION_CONFLICT'},409);return
   state.writes+=1;state.record.update(revision=state.record['revision']+1,status='APPROVED'if c['action']=='approve'else'REVOKED',facts=deepcopy(c.get('facts'))if c['action']=='approve'else None)
   receipt={k:v for k,v in state.record.items()if k!='facts'};state.commands[c['command_id']]=receipt;self.respond(receipt)

def freeport():
 with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]

def main():
 p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--node',required=True);p.add_argument('--narrow',action='store_true');a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
 checks=[]
 def check(name,ok):
  assert ok,name;checks.append({'case':name,'passed':True})
 backend=ThreadingHTTPServer(('127.0.0.1',0),Backend);bt=threading.Thread(target=backend.serve_forever,daemon=True);bt.start();port=freeport();origin=f'http://127.0.0.1:{port}'
 env={**os.environ,'HOSTNAME':'127.0.0.1','PORT':str(port),'ALISA_ENV':'dev','ALISA_ACCOUNTS_ENABLED':'1','ALISA_OWNER_DATA_ENABLED':'1','ALISA_PUBLIC_BASE_URL':origin,'ALISA_WEB_ORIGIN':origin,'ALISA_PLATFORM_URL':f'http://127.0.0.1:{backend.server_port}','ALISA_AUTH_SERVICE_TOKEN':SERVICE,'ALISA_RELEASE':'synthetic-owner-console','NEXT_TELEMETRY_DISABLED':'1'}
 server=ROOT/'apps/web/.next/standalone/apps/web/server.js';log=(a.output/'next.log').open('w');process=subprocess.Popen([a.node,str(server)],env=env,stdout=log,stderr=subprocess.STDOUT)
 forbidden=[]
 try:
  for _ in range(150):
   try:
    with urlopen(origin+'/health/live',timeout=.3):break
   except Exception:
    if process.poll()is not None:raise RuntimeError('NEXT_EXITED')
    time.sleep(.1)
  else:raise RuntimeError('NEXT_NOT_READY')
  with sync_playwright()as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);context=browser.new_context(viewport={'width':390,'height':844}if a.narrow else{'width':1280,'height':900},extra_http_headers={'Cookie':'__Host-alisa_session='+COOKIE})
   def guard(route):
    if not route.request.url.startswith(origin+'/'):forbidden.append(route.request.url);route.abort()
    else:route.continue_()
   context.route('**/*',guard);page=context.new_page();page.goto(origin+'/app/owner-inputs?store='+SID)
   expect(page.get_by_role('heading',name='Себестоимость и расходы',exact=True)).to_be_visible();expect(page.get_by_role('button',name='Обновить версию')).to_be_enabled()
   check('built_actual_owner_route',True);check('initial_no_default_costs',page.get_by_label('Сумма 1',exact=True).input_value()=='' and state.writes==0)
   save=page.get_by_role('button',name='Подтвердить и сохранить параметры',exact=True);expect(save).to_be_disabled()
   check('no_dates_for_current_cost',page.locator('input[type=date]').count()==0);check('no_state_choice_for_cost',page.get_by_label('Состояние 1',exact=True).count()==0);check('no_manual_sku_for_common_cost',page.get_by_label('SKU 1',exact=True).count()==0);page.get_by_label('Сумма 1',exact=True).fill('300,25')
   expect(save).to_be_disabled();check('explicit_confirmation_required',True)
   page.get_by_role('checkbox').check();save.click();expect(page.get_by_role('status')).to_contain_text('Параметры подтверждены');expect(save).to_be_disabled()
   check('explicit_cost_saved_no_default_tax',state.record['facts']['entries'][0]['value']=='300.25'and len(state.record['facts']['entries'])==1 and state.writes==1)
   check('saved_cost_period_is_null',state.record['facts']['entries'][0]['period']is None);check('storewide_rule_saved_without_product_map',state.record['facts']['product_map']=={}and state.record['facts']['entries'][0]['entity']=='all-products')
   check('recovery_storage_has_no_cost_values',page.evaluate('JSON.stringify({...localStorage})').find('300.25')<0)
   page.reload();expect(page.get_by_label('Сумма 1',exact=True)).to_have_value('300.25');check('reload_reads_saved_values_without_write',state.writes==1)
   denied=page.request.post(origin+'/api/account/owner-inputs',data={'action':'read','store_id':SID},headers={'Origin':'https://evil.invalid'});check('cross_origin_denied',denied.status==403)
   no_session=pw.request.new_context();denied=no_session.post(origin+'/api/account/owner-inputs',data={'action':'read','store_id':SID},headers={'Origin':origin});check('absent_session_denied',denied.status==401);no_session.dispose()
   body='{"action":"approve","store_id":"'+SID+'","command_id":"'+str(uuid.uuid4())+'","expected_revision":1,"not_after":'+str(int(time.time())+120)+',"confirmed":false,"confirmed":true,"facts":{}}'
   denied=page.request.post(origin+'/api/account/owner-inputs',data=body,headers={'Origin':origin,'Content-Type':'application/json'});check('duplicate_json_rejected_before_platform',denied.status==422 and state.writes==1)
   denied=page.request.post(origin+'/api/account/owner-inputs',data={'action':'issue','store_id':SID},headers={'Origin':origin});check('browser_cannot_prepare_runtime_ticket',denied.status==422)
   page.get_by_label('Сумма 1',exact=True).fill('1e6');page.get_by_role('checkbox').check();save.click();expect(page.locator('section[aria-label="Параметры владельца"] p[role="alert"]')).to_contain_text('неотрицательную сумму');check('invalid_amount_no_mutation',state.writes==1)
   page.get_by_label('Сумма 1',exact=True).fill('310');page.get_by_role('checkbox').check();attempts=[]
   def lose_ack(route):
    data=route.request.post_data_json
    if data.get('action')=='approve':attempts.append(data['command_id']);response=route.fetch();assert response.status==200;route.abort('failed')
    else:route.continue_()
   page.route('**/api/account/owner-inputs',lose_ack);save.click();expect(page.get_by_role('button',name='Проверить сохранение',exact=True)).to_be_enabled();check('lost_ack_blocks_new_command',state.writes==2 and len(attempts)==1)
   page.unroute('**/api/account/owner-inputs',lose_ack);page.reload();expect(page.get_by_role('button',name='Проверить сохранение',exact=True)).to_be_enabled();expect(save).to_be_disabled();page.get_by_role('button',name='Проверить сохранение',exact=True).click();expect(page.get_by_role('status')).to_contain_text('Исходная команда выполнена');expect(page.get_by_label('Сумма 1',exact=True)).to_have_value('310');check('reload_recovery_no_duplicate_write',state.writes==2 and len(attempts)==1)
   # Separate tabs have stale revisions even though Web Locks serialize the POSTs.
   second=context.new_page();second.goto(origin+'/app/owner-inputs?store='+SID);expect(second.get_by_label('Сумма 1',exact=True)).to_have_value('310')
   page.get_by_label('Сумма 1',exact=True).fill('320');page.get_by_role('checkbox').check();save.click();expect(page.get_by_role('status')).to_contain_text('Версия 3')
   second.get_by_label('Сумма 1',exact=True).fill('330');second.get_by_role('checkbox').check();second.get_by_role('button',name='Подтвердить и сохранить параметры',exact=True).click();expect(second.locator('section[aria-label="Параметры владельца"] p[role="alert"]')).to_contain_text('другой вкладке');check('stale_tab_cannot_overwrite',state.writes==3 and state.record['facts']['entries'][0]['value']=='320');second.close()
   storage=browser.new_context(viewport={'width':390,'height':844}if a.narrow else{'width':1280,'height':900},extra_http_headers={'Cookie':'__Host-alisa_session='+COOKIE});storage.route('**/*',guard);storage.add_init_script("Storage.prototype.setItem=function(){throw new Error('Хранилище браузера недоступно')}" );blocked=storage.new_page();blocked.goto(origin+'/app/owner-inputs?store='+SID);expect(blocked.get_by_label('Сумма 1',exact=True)).to_have_value('320');blocked.get_by_label('Сумма 1',exact=True).fill('999');blocked.get_by_role('checkbox').check();blocked.get_by_role('button',name='Подтвердить и сохранить параметры',exact=True).click();expect(blocked.locator('section[aria-label="Параметры владельца"] p[role="alert"]')).to_contain_text('Хранилище');check('storage_failure_stops_before_send',state.writes==3);storage.close()
   page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='Отозвать параметры',exact=True).click();expect(page.get_by_role('status')).to_contain_text('отозваны');check('explicit_revoke',state.record['status']=='REVOKED'and state.record['facts']is None and state.writes==4)
   page.get_by_label('Сумма 1',exact=True).fill('400')
   page.get_by_role('button',name='Добавить исключение для товара',exact=True).click();expect(page.get_by_label('Товар 2',exact=True).locator('option',has_text='Браслет тестовый')).to_have_count(1)
   page.get_by_label('Товар 2',exact=True).select_option('123');page.get_by_label('Сумма 2',exact=True).fill('500')
   check('automatic_product_catalog_names_and_articles',page.get_by_label('Товар 2',exact=True).locator('option:checked').inner_text()=='Браслет тестовый · ART-TEST')
   page.get_by_role('checkbox').check();save.click();expect(page.get_by_role('status')).to_contain_text('Версия 5')
   check('no_dates_for_current_exception',page.locator('input[type=date]').count()==0);check('exception_period_null',state.record['facts']['entries'][1]['period']is None);check('common_and_specific_saved_together',state.record['facts']['entries'][0]['entity']=='all-products'and state.record['facts']['entries'][1]['entity']=='sku:123'and state.writes==5)
   page.reload();expect(page.get_by_label('Сумма 1',exact=True)).to_have_value('400');expect(page.get_by_label('Сумма 2',exact=True)).to_have_value('500');check('common_exception_reload_without_loss',state.writes==5)
   forbidden_catalog=page.request.post(origin+'/api/account/owner-products',data={'store_id':SID,'cursor':''},headers={'Origin':'https://evil.invalid'});check('catalog_origin_denied',forbidden_catalog.status==403)
   check('no_service_secret_in_rendered_html',SERVICE not in page.content());check('no_external_browser_network',not forbidden)
   page.screenshot(path=str(a.output/'owner-inputs-synthetic.png'),full_page=True)
   context.close();browser.close()
  result={'status':'PASS','cases':checks,'tests':len(checks),'platform_replies':'SYNTHETIC','real_owner_data':False,'real_provider_http':0,'external_browser_requests':len(forbidden)}
  (a.output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k!='cases'}))
 finally:
  process.terminate()
  try:process.wait(timeout=10)
  except subprocess.TimeoutExpired:process.kill();process.wait()
  log.close();backend.shutdown();backend.server_close();bt.join(3)
if __name__=='__main__':main()
