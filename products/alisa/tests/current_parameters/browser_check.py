"""Built Next/BFF → real Django → disposable PostgreSQL, synthetic accounts only.

This test does not stand in for live Ozon acquisition or physical voice acceptance.
"""
from pathlib import Path
from urllib.request import Request,urlopen
from playwright.sync_api import sync_playwright,expect
from datetime import datetime,timezone
import argparse,json,os,subprocess,socket,time,shutil
ROOT=Path(__file__).resolve().parents[2]
def freeport():
 with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);parser.add_argument('--python',required=True);parser.add_argument('--node',required=True);args=parser.parse_args()
 E=args.output;E.mkdir(parents=True,exist_ok=True);record=E/'private-fixture.json';record.unlink(missing_ok=True)
 config={**os.environ,'PARAMETER_BROWSER_FIXTURE':str(record)}
 backend_log=(E/'fixture.log').open('w');backend=subprocess.Popen([args.python,'-B',str(ROOT/'tests/current_parameters/fixture_server.py')],env=config,stdout=backend_log,stderr=subprocess.STDOUT)
 web=None;checks=[];forbidden=[]
 def check(name,ok):
  assert ok,name;checks.append({'case':name,'passed':True})
 try:
  for _ in range(200):
   if record.exists():break
   if backend.poll()is not None:raise RuntimeError('FIXTURE_EXITED')
   time.sleep(.1)
  else:raise RuntimeError('FIXTURE_NOT_READY')
  fixture=json.loads(record.read_text());port=freeport();origin=f'http://127.0.0.1:{port}';backend_origin=f'http://127.0.0.1:{fixture["port"]}'
  def control(action):
   data=json.dumps({'action':action,'session_token':fixture['session_token'],'store_id':fixture['store_id']}).encode()
   with urlopen(Request(backend_origin+'/__test/control',data,headers={'Content-Type':'application/json','Authorization':'Bearer '+fixture['service']}),timeout=8)as r:return json.load(r)
  standalone=ROOT/'apps/web/.next/standalone/apps/web'
  for source,dest in [(ROOT/'apps/web/.next/static',standalone/'.next/static'),(ROOT/'apps/web/public',standalone/'public')]:
   if source.exists():shutil.copytree(source,dest,dirs_exist_ok=True)
  env={**os.environ,'HOSTNAME':'127.0.0.1','PORT':str(port),'ALISA_ENV':'dev','ALISA_ACCOUNTS_ENABLED':'1','ALISA_OWNER_DATA_ENABLED':'1','ALISA_OWNER_PARAMETERS_ENABLED':'1','ALISA_PUBLIC_BASE_URL':origin,'ALISA_WEB_ORIGIN':origin,'ALISA_PLATFORM_URL':backend_origin,'ALISA_AUTH_SERVICE_TOKEN':fixture['service'],'ALISA_RELEASE':'synthetic-current-parameters-ui','NEXT_TELEMETRY_DISABLED':'1'}
  web_log=(E/'next.log').open('w');web=subprocess.Popen([args.node,str(standalone/'server.js')],env=env,stdout=web_log,stderr=subprocess.STDOUT)
  for _ in range(150):
   try:
    with urlopen(origin+'/health/live',timeout=.3):break
   except Exception:
    if web.poll()is not None:raise RuntimeError('NEXT_EXITED')
    time.sleep(.1)
  else:raise RuntimeError('NEXT_NOT_READY')
  with sync_playwright()as pw:
   browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);context=browser.new_context(viewport={'width':1280,'height':1000},extra_http_headers={'Cookie':'__Host-alisa_session='+fixture['session_token']})
   def guard(route):
    if not route.request.url.startswith(origin+'/'):forbidden.append(route.request.url);route.abort()
    else:route.continue_()
   context.route('**/*',guard);page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
   page.goto(origin+'/app/parameters?store='+fixture['store_id']);expect(page.get_by_role('heading',name='Коэффициенты',exact=True)).to_be_visible()
   expect(page.get_by_test_id('current-value')).to_have_text('Не задано');check('actual_new_page_read_no_write',control('state')['writes']==0)
   check('default_year_form',page.get_by_label('Период коэффициента',exact=True).input_value()=='12');check('manual_does_not_require_dates',page.locator('input[type=date]').count()==0)
   save=page.get_by_role('button',name='Сохранить число',exact=True);expect(save).to_be_disabled()
   page.get_by_label('Новое значение',exact=True).fill('0');save.click();expect(page.get_by_test_id('current-value')).to_have_text('0 %');check('zero_persisted_postgres',control('state')['rows'][0]['value']=='0')
   page.get_by_label('Новое значение',exact=True).fill('8,5');save.click();expect(page.get_by_test_id('current-value')).to_have_text('8,5 %');st=control('state');check('percentage_exact_one_current_row',len(st['rows'])==1 and st['rows'][0]['value']=='0.085'and len(st['receipts'])==2)
   check('manual_dates_empty',st['rows'][0]['collected_at']is None and st['rows'][0]['calculated_at']is None);check('receipts_no_past_values',all('value'not in r and 'evidence'not in r and 'collected_at'not in r for r in st['receipts']))
   control('seed_calculated');st=control('state');page.reload();expect(page.get_by_test_id('current-value')).to_have_text('12,5 %');check('last_build_and_source_dates_are_visible',page.get_by_text('Последний расчёт коэффициента',exact=True).count()==1 and page.get_by_text('Исходные данные получены',exact=True).count()==1)
   before=control('state');page.get_by_role('button',name='Обновить текущее значение',exact=True).click();expect(page.get_by_test_id('current-value')).to_have_text('12,5 %');after=control('state');check('refresh_date_does_not_write_or_recalculate',before==after)
   page.get_by_label('Новое значение',exact=True).fill('9');save.click();expect(page.get_by_test_id('current-value')).to_have_text('9 %');r=control('state')['rows'][0];check('manual_replace_removed_entire_old_passport',r['origin']=='manual'and r['collected_at']is None and r['calculated_at']is None and r['evidence']=={})
   requests=[]
   def lose_ack(route):
    c=route.request.post_data_json
    if c.get('action')=='set_manual':
     requests.append(c['command_id']);r=route.fetch();assert r.status==200;route.abort('failed')
    else:route.continue_()
   page.route('**/api/account/parameters',lose_ack);page.get_by_label('Новое значение',exact=True).fill('11');save.click();expect(page.get_by_role('button',name='Проверить сохранение',exact=True)).to_be_enabled();count=control('state')['writes'];check('lost_ack_one_effect',len(requests)==1 and control('state')['rows'][0]['value']=='0.11')
   page.unroute('**/api/account/parameters',lose_ack);page.reload();expect(page.get_by_role('button',name='Проверить сохранение',exact=True)).to_be_enabled();expect(save).to_be_disabled();page.get_by_role('button',name='Проверить сохранение',exact=True).click();expect(page.get_by_text('Сохранение подтверждено. Показано актуальное число.',exact=True)).to_be_visible();check('recovery_reads_receipt_no_duplicate_write',control('state')['writes']==count)
   check('local_storage_has_no_current_or_old_numbers',page.evaluate('JSON.stringify({...localStorage})')=='{}')
   page.get_by_label('Отдельный товар',exact=True).check();page.get_by_role('button',name='Обновить каталог товаров',exact=True).click();expect(page.get_by_label('Товар коэффициента',exact=True).locator('option[value="123"]')).to_have_count(1);page.get_by_label('Товар коэффициента',exact=True).select_option('123')
   expect(page.get_by_text('Для товара используется общее значение магазина.',exact=True)).to_be_visible();check('sku_inherits_no_duplicate',len(control('state')['rows'])==1)
   page.get_by_label('Новое значение',exact=True).fill('3');save.click();expect(page.get_by_test_id('current-value')).to_have_text('3 %');check('sku_exception_actual_db',len(control('state')['rows'])==2)
   page.get_by_label('Все товары магазина',exact=True).check();expect(page.get_by_test_id('current-value')).to_have_text('11 %');page.get_by_label('Новое значение',exact=True).fill('10');save.click();expect(page.get_by_test_id('current-value')).to_have_text('10 %')
   page.get_by_label('Отдельный товар',exact=True).check();expect(page.get_by_test_id('current-value')).to_have_text('3 %');check('general_change_preserves_sku_exception',True)
   page.get_by_role('button',name='Использовать общее значение',exact=True).click();expect(page.get_by_test_id('current-value')).to_have_text('10 %');skurow=next(r for r in control('state')['rows']if r['sku']=='123');check('exception_removed_without_old_value',skurow['value']is None and skurow['evidence']=={})
   page.get_by_label('Все товары магазина',exact=True).check();expect(page.get_by_test_id('current-value')).to_have_text('10 %');count=control('state')['writes']
   page.get_by_label('Период коэффициента',exact=True).select_option('6');page.get_by_role('button',name='Проверить период и доступность сбора',exact=True).click();expect(page.get_by_text('Сбор коэффициентов ещё не включён.',exact=False)).to_be_visible();check('readiness_does_not_claim_real_collection',control('state')['writes']==count)
   page.get_by_label('Период коэффициента',exact=True).select_option('custom');page.get_by_label('Начало периода коэффициента',exact=True).fill('2026-01-01');page.get_by_label('Конец периода коэффициента',exact=True).fill('2026-06-30');page.get_by_role('button',name='Проверить период и доступность сбора',exact=True).click();expect(page.get_by_text('Период: 2026-01-01 — 2026-06-30.',exact=False)).to_be_visible();check('custom_period_preserved_no_write',control('state')['writes']==count)
   page.get_by_label('Коэффициент',exact=True).select_option('delivery_mean');expect(page.get_by_test_id('current-value')).to_have_text('Не задано');page.get_by_label('Новое значение',exact=True).fill('101,614824');save.click();expect(page.get_by_test_id('current-value')).to_have_text('101,614824 ₽ на заказанную единицу');check('rub_per_ordered_unit_preserved',next(r for r in control('state')['rows']if r['key']=='delivery_mean')['value']=='101.614824')
   before=control('state')['writes'];page.evaluate("() => { window.__originalSetItem=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new DOMException('synthetic blocked','QuotaExceededError')}; return true; }")
   page.get_by_label('Новое значение',exact=True).fill('999');save.click();expect(page.get_by_text('Браузер не смог сохранить состояние команды. Изменение не отправлено.',exact=True)).to_be_visible()
   check('storage_failure_before_write_has_no_effect',control('state')['writes']==before)
   page.evaluate('() => { Storage.prototype.setItem=window.__originalSetItem; return true; }');page.reload();expect(page.get_by_test_id('current-value')).to_have_text('10 %')
   base={'action':'read','store_id':fixture['store_id'],'parameter':'loss_rate','scope':{'kind':'store','sku':''},'sku_reference':None}
   wrong=page.request.post(origin+'/api/account/parameters',data=base,headers={'Origin':'https://evil.invalid'});check('csrf_cross_origin_denied',wrong.status==403)
   anon=pw.request.new_context();wrong=anon.post(origin+'/api/account/parameters',data=base,headers={'Origin':origin});check('missing_cookie_denied',wrong.status==401);anon.dispose()
   body='{"action":"read","action":"set_manual","store_id":"'+fixture['store_id']+'"}';wrong=page.request.post(origin+'/api/account/parameters',data=body,headers={'Origin':origin,'Content-Type':'application/json'});check('duplicate_json_denied',wrong.status==422)
   wrong=page.request.post(origin+'/api/account/parameters',data={**base,'action':'replace_calculated'},headers={'Origin':origin});check('browser_cannot_commit_calculated_number',wrong.status==422)
   wrong=page.request.post(origin+'/api/account/parameters',data={**base,'store_id':'ffffffff-ffff-4fff-8fff-ffffffffffff'},headers={'Origin':origin});check('foreign_store_denied',wrong.status==404)
   page.screenshot(path=str(E/'desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(E/'mobile.png'),full_page=True)
   overflow=page.evaluate("({viewport:innerWidth,document:document.documentElement.scrollWidth,elements:[...document.querySelectorAll('body *')].map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).filter(e=>e.right>innerWidth+0.5)})")
   (E/'mobile-overflow.json').write_text(json.dumps(overflow,ensure_ascii=False,indent=2))
   check('mobile_no_horizontal_overflow',page.evaluate('document.documentElement.scrollWidth<=window.innerWidth'))
   check('no_uncaught_browser_errors',not errors);check('browser_external_requests',not forbidden)
   browser.close()
  output={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','checks':checks,'count':len(checks),'database':'isolated real PostgreSQL16.15','platform':'real Django5.2.19 owner_data','ui':'built Next16.4.5','node':subprocess.check_output([args.node,'--version'],text=True).strip(),'synthetic_accounts_and_provider_catalogue':True,'live_marketplace_calls':0,'live_voice_calls':0,'production_changes':False}
  (E/'RESULT.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n');print(json.dumps(output,ensure_ascii=False))
 finally:
  for process in [web,backend]:
   if process and process.poll()is None:
    process.terminate()
    try:process.wait(timeout=8)
    except subprocess.TimeoutExpired:process.kill();process.wait()
  record.unlink(missing_ok=True)
if __name__=='__main__':main()
