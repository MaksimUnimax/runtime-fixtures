"""Built Next -> public BFF -> Django -> Unix authority/RuntimePort -> Worker -> PG.
Only model/provider responses and account/key fixtures are synthetic. No live IO.
"""
from pathlib import Path
from urllib.request import Request,urlopen
from playwright.sync_api import sync_playwright,expect
from datetime import datetime,timezone
import argparse,json,os,subprocess,socket,time,shutil
ROOT=Path(__file__).resolve().parents[2]
def port():
    with socket.socket()as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,required=True);ap.add_argument('--python',required=True);ap.add_argument('--node',required=True);a=ap.parse_args();E=a.output;E.mkdir(parents=True,exist_ok=True);private=E/'private-fixture.json';private.unlink(missing_ok=True)
    env={**os.environ,'PARAMETER_BROWSER_FIXTURE':str(private)}
    back=subprocess.Popen([a.python,'-B',str(ROOT/'tests/current_parameters/collection_browser_server.py')],env=env,stdout=(E/'platform.log').open('w'),stderr=subprocess.STDOUT)
    web=None;checks=[]
    def check(name,value):assert value,name;checks.append({'case':name,'passed':True})
    try:
        for _ in range(300):
            if private.exists():break
            if back.poll()is not None:raise RuntimeError('BACKEND_FAILED')
            time.sleep(.1)
        else:raise RuntimeError('BACKEND_NOT_READY')
        f=json.loads(private.read_text());origin=f'http://127.0.0.1:{port()}';backend=f'http://127.0.0.1:{f["port"]}'
        def control(action):
            data=json.dumps({'action':action}).encode()
            with urlopen(Request(backend+'/__test/control',data,headers={'Authorization':'Bearer '+f['service'],'Content-Type':'application/json'}),timeout=90)as r:return json.load(r)
        root=ROOT/'apps/web/.next/standalone/apps/web'
        for src,dst in [(ROOT/'apps/web/.next/static',root/'.next/static'),(ROOT/'apps/web/public',root/'public')]:
            if src.exists():shutil.copytree(src,dst,dirs_exist_ok=True)
        runenv={**os.environ,'HOSTNAME':'127.0.0.1','PORT':origin.rsplit(':',1)[1],'ALISA_ENV':'dev','ALISA_ACCOUNTS_ENABLED':'1','ALISA_OWNER_DATA_ENABLED':'1','ALISA_OWNER_PARAMETERS_ENABLED':'1','ALISA_PUBLIC_BASE_URL':origin,'ALISA_WEB_ORIGIN':origin,'ALISA_PLATFORM_URL':backend,'ALISA_AUTH_SERVICE_TOKEN':f['service'],'ALISA_RELEASE':'synthetic-r5-collection-browser','NEXT_TELEMETRY_DISABLED':'1'}
        web=subprocess.Popen([a.node,str(root/'server.js')],env=runenv,stdout=(E/'next.log').open('w'),stderr=subprocess.STDOUT)
        for _ in range(150):
            try:
                with urlopen(origin+'/health/live',timeout=.3):break
            except Exception:
                if web.poll()is not None:raise RuntimeError('NEXT_FAILED')
                time.sleep(.1)
        else:raise RuntimeError('NEXT_NOT_READY')
        with sync_playwright()as pw:
            browser=pw.chromium.launch(headless=True,args=['--no-sandbox']);context=browser.new_context(viewport={'width':1280,'height':1000},extra_http_headers={'Cookie':'__Host-alisa_session='+f['session_token']})
            external=[];errors=[]
            def guard(route):
                if not route.request.url.startswith(origin+'/'):external.append(route.request.url);route.abort()
                else:route.continue_()
            context.route('**/*',guard);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(origin+'/app/parameters?store='+f['store_id']);expect(page.get_by_test_id('current-value')).to_have_text('Не задано')
            check('default_year_editable',page.get_by_label('Период коэффициента',exact=True).input_value()=='12')
            page.get_by_label('Период коэффициента',exact=True).select_option('custom');page.get_by_label('Начало периода коэффициента',exact=True).fill('2026-10-01');page.get_by_label('Конец периода коэффициента',exact=True).fill('2026-10-31')
            page.get_by_role('button',name='Проверить период и доступность сбора',exact=True).click();expect(page.get_by_text('Сбор доступен.',exact=False)).to_be_visible()
            check('readiness_does_not_queue',control('state')['jobs']==0)
            page.get_by_role('button',name='Рассчитать и заменить',exact=True).click();expect(page.get_by_role('button',name='Проверить расчёт',exact=True)).to_be_enabled(timeout=10000)
            check('one_actual_query_and_job',control('state')['jobs']==control('state')['queries']==1)
            state=control('finish');check('actual_worker_completed',state['state']=='READY')
            page.get_by_role('button',name='Проверить расчёт',exact=True).click();expect(page.get_by_test_id('current-value')).to_have_text('50 %',timeout=15000)
            state=control('state');check('same_store_current_write',len(state['parameters'])==1 and state['parameters'][0]['value']=='0.5'and state['writes']==1)
            check('no_selector_for_explicit_form',state['selector_calls']==0 and state['model_calls']==1)
            check('dates_visible_and_stored',bool(state['parameters'][0]['calculated_at'])and bool(state['parameters'][0]['collected_at'])and page.get_by_text('Последний расчёт коэффициента',exact=True).count()==1)
            before=control('state');page.get_by_role('button',name='Обновить текущее значение',exact=True).click();expect(page.get_by_test_id('current-value')).to_have_text('50 %');check('date_read_no_recollection',control('state')==before)
            page.get_by_label('Новое значение',exact=True).fill('7');page.get_by_role('button',name='Сохранить число',exact=True).click();expect(page.get_by_test_id('current-value')).to_have_text('7 %')
            check('manual_clear_collection_passport',control('state')['parameters'][0]['evidence']=={}and control('state')['parameters'][0]['calculated_at']is None)
            page.get_by_label('Режим расчёта',exact=True).select_option('preview');before=control('state')['writes'];page.get_by_role('button',name='Рассчитать без сохранения',exact=True).click();expect(page.get_by_role('button',name='Проверить расчёт',exact=True)).to_be_enabled()
            check('preview_worker_completed',control('finish')['state']=='READY');page.get_by_role('button',name='Проверить расчёт',exact=True).click();expect(page.get_by_text('Предварительный расчёт готов. Сохранённое значение не менялось.',exact=True)).to_be_visible(timeout=15000)
            check('preview_does_not_write',control('state')['writes']==before and control('state')['parameters'][0]['value']=='0.07')
            page.get_by_label('Режим расчёта',exact=True).select_option('replace')
            intercepted=[]
            def lose(route):
                if route.request.post_data_json.get('action')=='start_calculation':
                    intercepted.append(route.request.post_data_json['command_id']);result=route.fetch();assert result.status==200;route.abort('failed')
                else:route.continue_()
            page.route('**/api/account/parameters',lose);page.get_by_role('button',name='Рассчитать и заменить',exact=True).click();expect(page.get_by_role('button',name='Проверить расчёт',exact=True)).to_be_enabled()
            page.unroute('**/api/account/parameters',lose);count=control('state')['jobs'];check('lost_browser_ack_one_request',len(intercepted)==1)
            page.reload();expect(page.get_by_role('button',name='Проверить расчёт',exact=True)).to_be_enabled();page.get_by_role('button',name='Проверить расчёт',exact=True).click();expect(page.get_by_text('Состояние: QUEUED',exact=True)).to_be_visible(timeout=15000)
            check('reload_did_not_repeat_collection',control('state')['jobs']==count)
            check('recovered_existing_job_completed',control('finish')['state']=='READY');page.get_by_role('button',name='Проверить расчёт',exact=True).click();expect(page.get_by_test_id('current-value')).to_have_text('50 %',timeout=15000)
            check('current_only_after_replacement',len(control('state')['parameters'])==1)
            check('pending_metadata_cleaned',page.evaluate('JSON.stringify({...localStorage})')=='{}')
            before=control('state')['writes'];page.get_by_role('button',name='Рассчитать и заменить',exact=True).click();expect(page.get_by_role('button',name='Отменить расчёт',exact=True)).to_be_enabled();page.get_by_role('button',name='Отменить расчёт',exact=True).click();expect(page.get_by_text('Расчёт завершён без замены текущего числа.',exact=True)).to_be_visible(timeout=15000)
            check('cancel_does_not_replace_value',control('state')['writes']==before)
            before=control('state');response=page.request.post(origin+'/api/account/parameters',data={'action':'cancel_collection','store_id':f['store_id'],'parameter':'loss_rate','scope':{'kind':'store','sku':''},'sku_reference':None,'command_id':intercepted[0]},headers={'Origin':origin})
            check('late_cancel_does_not_revert_saved_coefficient',response.status==200 and response.json().get('already_saved')is True and control('state')==before)
            page.evaluate("f => { const key='alisa.parameter.pending.v1:'+JSON.stringify([f.tenant_id+':'+f.customer_id,f.store_id,'loss_rate','store',''])+':collection'; localStorage.setItem(key,JSON.stringify({id:'ffffffff-ffff-4fff-8fff-ffffffffffff',store:f.store_id,parameter:'loss_rate',scope:{kind:'store',sku:''},not_after:1})); }",f)
            page.reload();expect(page.get_by_role('button',name='Проверить расчёт',exact=True)).to_be_enabled();page.get_by_role('button',name='Проверить расчёт',exact=True).click();expect(page.get_by_text('Задание не найдено, срок приёма прежней команды истёк. Можно начать новый расчёт.',exact=True)).to_be_visible(timeout=15000)
            check('unknown_expired_start_unblocks_without_auto_submission',control('state')['jobs']==before['jobs']and page.evaluate('JSON.stringify({...localStorage})')=='{}')
            before=control('state')['jobs'];page.evaluate("() => { window.__originalSetItem=Storage.prototype.setItem; Storage.prototype.setItem=function(){throw new DOMException('synthetic quota','QuotaExceededError')}; return true; }")
            page.get_by_role('button',name='Рассчитать и заменить',exact=True).click();expect(page.get_by_text('Браузер не смог сохранить состояние запуска. Сбор не отправлен.',exact=True)).to_be_visible(timeout=15000)
            check('blocked_browser_storage_never_submits_collection',control('state')['jobs']==before);page.evaluate('() => { Storage.prototype.setItem=window.__originalSetItem; return true; }')
            page.get_by_label('Период коэффициента',exact=True).select_option('custom');page.get_by_label('Начало периода коэффициента',exact=True).fill('2026-10-01');page.get_by_label('Конец периода коэффициента',exact=True).fill('2026-10-31')
            page.get_by_role('button',name='Рассчитать и заменить',exact=True).click();expect(page.get_by_role('button',name='Проверить расчёт',exact=True)).to_be_enabled()
            page.get_by_label('Новое значение',exact=True).fill('9');page.get_by_role('button',name='Сохранить число',exact=True).click();expect(page.get_by_test_id('current-value')).to_have_text('9 %')
            check('concurrent_manual_edit_blocks_stale_collection',control('finish')['state']=='FAILED');page.get_by_role('button',name='Проверить расчёт',exact=True).click();expect(page.get_by_text('Текущее значение изменено другим действием. Результат этого сбора не записан.',exact=True)).to_be_visible(timeout=15000);expect(page.get_by_test_id('current-value')).to_have_text('9 %')
            check('manual_value_and_no_old_passport_remain',control('state')['parameters'][0]['value']=='0.09'and control('state')['parameters'][0]['evidence']=={})
            page.screenshot(path=str(E/'desktop.png'),full_page=True);page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(E/'mobile.png'),full_page=True)
            check('no_horizontal_overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth'));check('no_browser_errors',not errors);check('no_external_browser_requests',not external)
            browser.close()
        receipt={'utc':datetime.now(timezone.utc).isoformat(),'status':'PASS','checks':checks,'count':len(checks),'real_stack':'Next+BFF+Django+current owner authority+two Unix RPCs+Worker+SQLite+PostgreSQL','synthetic':'account/credential records, provider and model responses only','production_mutations':False,'paid_calls':0}
        (E/'RESULT.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n');print(json.dumps(receipt,ensure_ascii=False))
    finally:
        for process in (web,back):
            if process and process.poll()is None:
                process.terminate()
                try:process.wait(8)
                except subprocess.TimeoutExpired:process.kill();process.wait()
        private.unlink(missing_ok=True)
if __name__=='__main__':main()
