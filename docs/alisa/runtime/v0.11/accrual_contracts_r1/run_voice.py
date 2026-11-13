"""One authorized voice acceptance; own temporary Quasar scenario, no launch retry."""
import fcntl,hashlib,http.cookiejar,json,os,sqlite3,sys,time,uuid
from pathlib import Path
from decimal import Decimal
from cryptography.fernet import Fernet
CORE=Path('/opt/alice-market/releases/current').resolve();STATION=Path('/opt/alisa-station/releases/station-request-economics-r1-20261113')
sys.path[:0]=[str(CORE),str(STATION)]
from transport import Yandex,payload
from model_pricing import price
from voice_question_identity import same_question
ROOT=Path('/root/alice-lab-evidence/answer-model-20261109')
DB='/var/lib/alice-market/state.sqlite3'
CASES={'simple-47': 'Сколько добавлений в корзину на Вайлдберриз восьмого ноября?', 'simple-48': 'Сколько товаров сейчас на складах Озона?', 'simple-49': 'Сколько товаров сейчас на складах Озона?', 'simple-50': 'Сколько товаров сейчас на складах продавца на Озоне?', 'simple-51': 'Сколько товаров зарезервировано на складах продавца на Озоне?', 'simple-52': 'Сколько товаров зарезервировано на складах продавца на Озоне?', 'simple-53': 'Сколько товаров зарезервировано на складах Озона?', 'simple-54': 'Сколько товаров сейчас на складах Вайлдберриз?', 'simple-55': 'Сколько товаров Вайлдберриз сейчас в пути к покупателям?', 'simple-56': 'Сколько товаров сейчас в пути обратно на склады Вайлдберриз?', 'simple-57': 'Сколько товаров сейчас в пути обратно на склады Вайлдберриз?', 'simple-58': 'Сколько товаров Вайлдберриз сейчас в пути к покупателям?', 'simple-59': 'Сколько товаров заказали на Озоне вчера?', 'simple-60': 'Какова средняя стоимость заказанного товара на Озоне вчера?', 'simple-61': 'Какая конверсия из карточки в корзину на Вайлдберриз восьмого ноября?', 'simple-62': 'Какая конверсия из карточки в корзину на Вайлдберриз восьмого ноября?', 'simple-63': 'Какой ДРР на Озоне за вчера?', 'simple-64': 'Какая конверсия из корзины в заказ на Вайлдберриз восьмого ноября?', 'simple-65': 'Сколько товаров в среднем заказывали в день на Озоне с 1 по 10 ноября?', 'simple-66': 'Сколько вместе стоили хранение и логистика на Озоне восьмого ноября?', 'simple-67': 'Сколько вместе стоили хранение и логистика на Озоне восьмого ноября?', 'simple-68': 'Сколько вместе стоили хранение и логистика на Озоне восьмого ноября?', 'simple-69': 'Сколько стоила логистика на Озоне восьмого ноября?', 'simple-70': 'Какой текущий баланс на Вайлдберриз?', 'simple-71': 'Сколько сейчас доступно к выводу на Вайлдберриз?', 'simple-72': 'Сколько товаров продали на Озоне восьмого ноября?', 'simple-73': 'Сколько товаров продали на Озоне восьмого ноября?', 'simple-74': 'Сколько товаров продали на Озоне восьмого ноября?', 'simple-75': 'Сколько товаров продали на Озоне восьмого ноября?', 'simple-76': 'Сколько товаров вернули на Озоне восьмого ноября?', 'simple-77': 'Сколько товаров вернули на Озоне восьмого ноября?', 'simple-78': 'Какая средняя цена выкупленного товара для покупателя на Озоне 8 ноября?', 'simple-79': 'На какую сумму покупатели выкупили товары на Озоне 8 ноября?', 'simple-80': 'На какую сумму выкупили товары в цене продавца на Озоне 8 ноября?', 'simple-81': 'Сколько денег вернули покупателям на Озоне 8 ноября?', 'simple-82': 'Какая сумма возвратов в цене продавца на Озоне 8 ноября?', 'simple-83': 'Какая средняя цена выкупа на Озоне для покупателя 9 ноября?', 'simple-84': 'Сколько к перечислению за товары на Вайлдберриз за 8 ноября?', 'simple-85': 'Какая сумма к выплате на Вайлдберриз за 8 ноября?', 'simple-86': 'Сколько рекламных бонусов потратили на Озоне 8 ноября?', 'simple-87': 'Сколько потратили предоплаты на рекламу Озона 8 ноября?', 'simple-88': 'Какой ДРР на Вайлдберриз за 8 ноября?', 'simple-89': 'Какая средняя цена заказанного товара на Вайлдберриз 8 ноября?', 'simple-90': 'Сколько товаров в день в среднем заказали на Вайлдберриз с 1 по 10 ноября?', 'simple-91': 'Сколько выкупили из заказов Вайлдберриз за 8 ноября?', 'simple-92': 'На какую сумму выкупили из заказов Вайлдберриз за 8 ноября?'}
def read_db():
 c=sqlite3.connect('file:'+DB+'?mode=ro',uri=True);c.row_factory=sqlite3.Row;return c
def save(path,d):
 p=path.with_suffix('.pending');p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');p.chmod(0o600);os.replace(p,path)
def run(case):
 path=ROOT/(case.upper().replace('-','')+'_PRIVATE_20261113.json')
 if path.exists():record=json.loads(path.read_text())
 else:
  question=CASES[case];command='Спроси Октопорт маркет '+question
  assert len(command)<=100,'QUASAR_COMMAND_TOO_LONG'
  assert json.loads(Path('/var/lib/alisa-station/state.json').read_text())['settings']['enabled'],'STATION_PAUSED'
  states=[]
  for p in Path('/var/lib/alisa-station/users').glob('*/state.json'):
   d=json.loads(p.read_text())
   if d.get('connected')and d.get('binding')and d.get('selected'):states.append((p,d))
  assert len(states)==1,'STATION_BINDING_AMBIGUOUS'
  statepath,state=states[0];assert not state['uncertain'],'STATION_OUTCOME_UNKNOWN'
  with read_db()as c:assert c.execute("SELECT count(*)FROM jobs WHERE state IN ('QUEUED','RUNNING')").fetchone()[0]==0,'OTHER_ACTIVE_JOB'
  record={'case':case,'question':question,'command':command,'started_at':time.time(),'runtime':CORE.name,'state_path':str(statepath),'tenant':state['binding']['tenant'],'stage':'PREPARING','heard':False,'own_scenario_id':None,'launch_attempted':False}
  save(path,record)
 if record.get('finished_at'):print(json.dumps(record,ensure_ascii=False));return
 statepath=Path(record['state_path']);state=json.loads(statepath.read_text());client=Yandex()
 cipher=Fernet(Path('/run/credentials/alisa-station.service/station-key').read_bytes())
 for cookie in json.loads(cipher.decrypt((statepath.parent/'session.enc').read_bytes())):client.jar.set_cookie(http.cookiejar.Cookie(**cookie))
 if not record['launch_attempted']:
  if not record['own_scenario_id']:
   devices=client.devices();assert any(d['id']==state['selected']['id']for d in devices),'SELECTED_DEVICE_UNAVAILABLE'
   scenario=client.api('POST','/m/v4/user/scenarios',payload('Октопорт приёмка '+case,'октопорт тест '+uuid.uuid4().hex[:12],state['selected']['id'],record['command'],'skill'))
   record['own_scenario_id']=scenario['scenario_id'];save(path,record)
  record['launch_attempted']=True;record['stage']='LAUNCH_ATTEMPTED';save(path,record)
  try:record['launch_receipt']=client.api('POST','/m/user/scenarios/'+record['own_scenario_id']+'/actions');record['launch_acknowledged']=True
  except Exception as error:record['launch_error']=getattr(error,'code',type(error).__name__)
  save(path,record)
 api_data=[];route=None;plan={};last=0;terminal=None
 while time.time()-record['started_at']<600:
  station=json.loads(statepath.read_text());job=station.get('job')or{}
  with read_db()as c:
   if record.get('job_id'):row=c.execute('SELECT *FROM jobs WHERE id=?AND tenant=?',(record['job_id'],record['tenant'])).fetchone()
   else:
    rows=c.execute('SELECT *FROM jobs WHERE tenant=?AND created>=?ORDER BY created',(record['tenant'],record['started_at']-1)).fetchall()
    row=next((r for r in rows if r['id']==job.get('jid')and job.get('created',0)>=record['started_at']and same_question(json.loads(r['draft']).get('original_question'),record['question'])),None)
    if row:record['job_id']=row['id'];record['original_question']=json.loads(row['draft']).get('original_question');save(path,record)
   if row:
    if row['alias']:record['job_id']=row['alias'];save(path,record);continue
    progress=json.loads(row['progress'])if row['progress']else{}
    if progress.get('_answer_api_data'):api_data=progress['_answer_api_data']
    if progress.get('_answer_execution'):route=progress['_answer_execution']
    if row['plan']:plan=json.loads(row['plan'])
    if row['state']not in ('QUEUED','RUNNING'):terminal=dict(row)
  if terminal and terminal['state']=='FAILED':
   record['delivery']=job.get('delivery')if job.get('jid')==record.get('job_id')else'not_observed';record['delivery_not_completed']=True;break
  if terminal and job.get('jid')==record.get('job_id')and job.get('delivery')in ('responded_to_skill','manual','revoked','unknown','failed'):
   record['delivery']=job['delivery'];record['last_delivery']=station.get('last_delivery');break
  if time.time()-last>20:
   print(json.dumps({'case':case,'elapsed':round(time.time()-record['started_at'],1),'job_state':row['state']if row else None,'delivery':job.get('delivery'),'route':route}),flush=True);last=time.time()
  time.sleep(.5)
 else:record['observation_timeout']=True
 if terminal:
  result=json.loads(terminal['result'])if terminal['result']else{}
  attempts=[]
  with read_db()as c:
   for r in c.execute("SELECT *FROM calls WHERE jid=?AND source LIKE 'model:%'AND dispatched IS NOT NULL ORDER BY id",(terminal['id'],)):
    context=json.loads(r['model_context'])if r['model_context']else{};receipt=json.loads(r['model_usage'])if r['model_usage']else{}
    attempts.append({'stage':context.get('stage'),'state':r['state'],'http':r['http'],'receipt':receipt,'context':context,'price':price(receipt,context.get('pricing_quote'))})
  if not api_data:
   from archive_inputs import values as archived
   api_data=archived(terminal['id'])
  values=[]
  def walk(v):
   if type(v)is dict:
    selected=v.get('selected')
    if type(selected)is dict and 'cartCount'in selected:values.append(Decimal(str(selected['cartCount'])))
    for x in v.values():walk(x)
   elif type(v)is list:
    for x in v:walk(x)
  for data in api_data:
   if data['operation']=='wb_orders':walk(data['data'])
   if data['operation']=='ozon_stocks':
    stock_type='fbs'if case in ('simple-50','simple-51','simple-52')else'fbo'
    field='reserved'if case in ('simple-51','simple-52','simple-53')else'present'
    values.extend(Decimal(str(stock[field]))for item in data['data']['items']for stock in item['stocks']if stock['type']==stock_type)
  if route is None:route='program_v2'if any(x['stage']=='model_answer_program'for x in attempts)else'direct_v1'
  record.update(job_state=terminal['state'],job_error=terminal['error'],answer=''.join(result.get('pages',[])),job_seconds=round(terminal['updated']-terminal['created'],3),route=route,template_ids=[x['template_id']for x in plan.get('selection',{}).get('invocations',[])],deepseek_attempts=len(attempts),attempts=attempts,known_rub=str(sum(Decimal(x['price']['rub'])for x in attempts if x['price'])),cost_complete=all(x['price']is not None for x in attempts),data_check={'source_rows':len(values),'expected_total':str(sum(values))if values else None,'api_pages':len(api_data)})
 # Delete only this acceptance scenario, never the service delivery scenario.
 if record['own_scenario_id'] and not record.get('own_scenario_deleted'):
  try:client.api('DELETE','/m/user/scenarios/'+record['own_scenario_id']);record['own_scenario_deleted']=True
  except Exception as error:record['cleanup_error']=getattr(error,'code',type(error).__name__)
 record.update(finished_at=time.time(),stage='FINISHED');save(path,record)
 print(json.dumps({k:v for k,v in record.items()if k not in ('attempts','state_path','tenant','own_scenario_id','job_id','command')},ensure_ascii=False),flush=True)
if __name__=='__main__':
 with open('/root/alice-lab-evidence/ue-acceptance-review.lock','a')as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);run(sys.argv[1])
