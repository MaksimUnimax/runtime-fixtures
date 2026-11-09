"""Generic bounded dataset DAG: catalogue phrases/stages/columns, not provider code.
One existing HTTP transport call per worker step. No eval, credentials, or file writes.
"""
from pathlib import Path
from datetime import date,datetime,timedelta,timezone
from dataclasses import asdict
from decimal import Decimal
import copy,re
from semantics import Scope,Store,Rejected,parse,normalize,make_plan,strict_json,canonical_json,fingerprint
from matrix_sources import SourceMatrix
from matrix_core import MatrixError,validate_expression,evaluate,money,decimal_text
from dataset_relations import validate_relations,validate_window,calendar_windows,apply_relations
ROOT=Path(__file__).parent
SOURCES=SourceMatrix(strict_json((ROOT/'dataset_sources.json').read_text()))
CATALOG=strict_json((ROOT/'dataset_queries.json').read_text())

def fail(code,message=None):raise Rejected(code,message or ('Этот набор данных не получен полностью: '+code+'. Частичный итог не выдаю.'))

def validate_catalog(c):
 if type(c)is not dict or set(c)!={'schema','version','max_rows','max_bytes','max_tasks','max_pages','queries'} or c['schema']!='alice-dataset-queries/v1':fail('DATASET_CATALOG')
 for k,lo,hi in [('max_rows',1,20000),('max_bytes',1000,6000000),('max_tasks',1,150),('max_pages',1,200)]:
  if type(c[k])is not int or not lo<=c[k]<=hi:fail('DATASET_LIMIT')
 if not isinstance(c['version'],str) or not 1<=len(c['version'])<=100 or type(c['queries'])is not dict or not 1<=len(c['queries'])<=100:fail('DATASET_CATALOG')
 phrases=set()
 for qid,q in c['queries'].items():
  if not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',qid) or type(q)is not dict or not {'phrases','snapshot','max_days','flows','columns','group_by','aggregates','notes','output_stage'}<=set(q) or set(q)-{'phrases','snapshot','max_days','flows','columns','group_by','aggregates','notes','output_stage','relations'}:fail('DATASET_QUERY_SCHEMA')
  if type(q['snapshot'])is not bool or type(q['max_days'])is not int or not 1<=q['max_days']<=365:fail('DATASET_PERIOD_SCHEMA')
  if not isinstance(q['phrases'],list) or not 1<=len(q['phrases'])<=50:fail('DATASET_PHRASES')
  for p in q['phrases']:
   if not isinstance(p,str) or not 1<=len(p)<=200 or normalize(p)!=p or p in phrases:fail('DATASET_PHRASES')
   phrases.add(p)
  if type(q['flows'])is not dict or not q['flows']:fail('DATASET_FLOWS')
  for platform,stages in q['flows'].items():
   if not isinstance(stages,list) or not 1<=len(stages)<=16:fail('DATASET_STAGES')
   ids=set()
   for s in stages:
    if type(s)is not dict or not {'id','source','period_mode','foreach'}<=set(s) or set(s)-{'id','source','period_mode','foreach','window'} or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',s['id']) or s['id']in ids:fail('DATASET_STAGE')
    ids.add(s['id'])
    if s['source']not in SOURCES.sources or SOURCES.recipe(s['source'])['platform']!=platform or s['period_mode']not in ('whole','days'):fail('DATASET_SOURCE_ROUTE')
    validate_expression(s['foreach'],{'datasets','period'})
    if 'window' in s:validate_window(s['window'])
   outs=[q['output_stage']] if isinstance(q['output_stage'],str) else q['output_stage']
   derived=validate_relations(q.get('relations',[]),ids)
   if not isinstance(outs,list) or not outs or len(set(outs))!=len(outs) or not set(outs)<=derived:fail('DATASET_OUTPUT')
  if not isinstance(q['columns'],list) or not 1<=len(q['columns'])<=16:fail('DATASET_COLUMNS')
  seen=set()
  for col in q['columns']:
   if set(col)!={'field','label','kind'} or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',col['field']) or col['field']in seen or col['kind']not in ('text','number','money') or not isinstance(col['label'],str) or not 0<len(col['label'])<=80:fail('DATASET_COLUMNS')
   seen.add(col['field'])
  if type(q['group_by'])is not list or len(q['group_by'])>3 or any(not isinstance(f,str) or f not in seen for f in q['group_by']):fail('DATASET_GROUP')
  if type(q['aggregates'])is not list or len(q['aggregates'])>16 or bool(q['aggregates'])!=bool(q['group_by']):fail('DATASET_AGGREGATES')
  for a in q['aggregates']:
   if set(a)!={'field','kind','source','denominator'} or a['kind']not in ('sum','ratio_sum') or any(not isinstance(a[k],str) or not re.fullmatch(r'[a-z][a-z0-9_]{0,79}',a[k]) for k in ('field','source')):fail('DATASET_AGGREGATE')
   if a['kind']=='ratio_sum' and not isinstance(a['denominator'],str):fail('DATASET_AGGREGATE')
  if not isinstance(q['notes'],list) or not 1<=len(q['notes'])<=8 or any(not isinstance(n,str) or not 1<=len(n)<=550 for n in q['notes']):fail('DATASET_NOTES')
validate_catalog(CATALOG)
HASH=fingerprint({'queries':CATALOG,'sources':SOURCES.definition})

def parse_request(command,today):
 text=normalize(command)
 # Quoted product labels must never select a report.
 visible=re.sub(r'"[^"\n]*"|«[^»\n]*»',' ',text)
 found=[]
 for qid,q in CATALOG['queries'].items():
  for phrase in q['phrases']:
   m=re.search(r'(?<!\w)'+re.escape(phrase)+r'(?!\w)',visible)
   if m:found.append((m.end()-m.start(),qid,phrase,m.start(),m.end()))
 if not found:return None
 _,qid,phrase,a,b=max(found);q=CATALOG['queries'][qid]
 replacement='остатки на складах площадки' if q['snapshot'] else 'сводка заказов'
 try:d=parse(text[:a]+replacement+text[b:],today)
 except Rejected as exc:
  if exc.code in ('HISTORICAL_SNAPSHOT','OPERATION_NOT_ENABLED'):
   # Reference comes from the matched, validated matrix, never the raw question.
   raise Rejected(exc.code,exc.message,context={'subject_ref':qid}) from None
  raise
 if d['route']!='P1' or d.get('filters') or d.get('comparison') or d['group_by']!='marketplace':fail('DATASET_UNSUPPORTED_CONDITION','Этот разрез или фильтр ещё не поддерживается для выбранного набора; условия не отбрасываю.')
 if d['snapshot']!=q['snapshot']:fail('DATASET_TIME_AXIS')
 d.update(question=text,dataset_request={'id':qid},route='D1')
 return d

def operations(qid,platform):return {s['source'] for s in CATALOG['queries'][qid]['flows'][platform]}

def make_dataset_plan(scope,draft,capabilities):
 qid=draft['dataset_request']['id'];q=CATALOG['queries'].get(qid)
 if q is None:fail('DATASET_UNKNOWN')
 if draft.get('filters') or draft.get('comparison') or draft.get('group_by')!='marketplace':fail('DATASET_UNSUPPORTED_CONDITION')
 if not set(draft['platforms'])<=set(q['flows']):fail('DATASET_PLATFORM_UNAVAILABLE','Этот набор ещё не квалифицирован для всех выбранных площадок; другую площадку молча не исключаю.')
 if (date.fromisoformat(draft['period']['to'])-date.fromisoformat(draft['period']['from'])).days>=q['max_days']:fail('DATASET_PERIOD_LIMIT')
 if bool(draft.get('snapshot'))!=q['snapshot']:fail('DATASET_TIME_AXIS')
 base=make_plan(scope,draft,['stock_fbo_units'] if q['snapshot'] else ['ordered_units'])
 proofs={}
 for store in base['stores']:
  proofs[store['id']]={}
  for op in operations(qid,store['platform']):
   proof=capabilities.get(store['id'],{}).get(op,{})
   if proof.get('status')!='READ_ONLY_CANARY' or proof.get('dataset_source_hash')!=SOURCES.hash or proof.get('dataset_query_hash')!=HASH:fail('DATASET_NOT_QUALIFIED')
   if any(proof.get(k)!=v for k,v in SOURCES.recipe(op)['proof_requirements'].items()):fail('DATASET_TOKEN_POLICY')
   try:
    for stage in q['flows'][store['platform']]:
     if stage['source']==op:
      for window in calendar_windows(stage,draft['period']):SOURCES.available(op,window,draft['calendar_date'])
   except MatrixError as e:fail(e.code)
   proofs[store['id']][op]=copy.deepcopy(proof)
 base.update(metrics=['dataset:'+qid],definition='matrix-dataset-v1',dataset={'id':qid,'catalog_hash':HASH,'calendar_date':draft['calendar_date']},dataset_capabilities=proofs)
 return base

def valid(plan):
 try:
  d=plan['dataset']
  if set(d)!={'id','catalog_hash','calendar_date'} or d['catalog_hash']!=HASH:return False
  scope=Scope(plan['tenant'],plan['access_revision'],tuple(Store(**s) for s in plan['stores']))
  draft={k:plan[k] for k in ('period','comparison','timezone','group_by','filters','snapshot','snapshot_slot')}
  draft.update(calendar_date=d['calendar_date'],platforms=sorted({s['platform'] for s in plan['stores']}),dataset_request={'id':d['id']})
  expected=make_dataset_plan(scope,draft,plan['dataset_capabilities'])
  # Execution authority is validated by Engine, independently of dataset math.
  if 'runtime_guard' in plan:expected['runtime_guard']=copy.deepcopy(plan['runtime_guard'])
  return expected==plan
 except (Rejected,MatrixError,KeyError,TypeError,ValueError):return False

def source_names(plan,store):
 return {store['platform']+':'+store['identity']+':'+SOURCES.recipe(op)['quota_operation'] for op in operations(plan['dataset']['id'],store['platform'])}

def stage_tasks(plan,store,stage,datasets):
 try:params=evaluate(stage['foreach'],{'datasets':datasets,'period':plan['period']})
 except MatrixError as e:fail(e.code)
 if not isinstance(params,list) or len(params)>CATALOG['max_tasks'] or any(type(x)is not dict for x in params):fail('DATASET_FANOUT')
 try:periods=calendar_windows(stage,plan['period'])
 except MatrixError as e:fail(e.code)
 if stage['period_mode']=='days':
  expanded=[]
  for window in periods:
   a,b=map(date.fromisoformat,(window['from'],window['to']))
   expanded.extend({'from':(a+timedelta(days=n)).isoformat(),'to':(a+timedelta(days=n)).isoformat()} for n in range((b-a).days+1))
  periods=expanded
 tasks=[{'source':stage['source'],'period':copy.deepcopy(period),'params':p} for period in periods for p in params]
 if len(tasks)>CATALOG['max_tasks']:fail('DATASET_FANOUT')
 return tasks

def build_request(plan,store,task,page):
 from providers import Request
 normalized={**plan,'table':{'view':'dataset'},'table_params':task['params']}
 try:return Request(**SOURCES.request(task['source'],normalized,store,task,page))
 except MatrixError as e:fail(e.code)

def decode(plan,store,task,page,body):
 normalized={**plan,'table':{'view':'dataset'},'table_params':task['params']}
 try:return SOURCES.decode(task['source'],body,normalized,store,task,page,CATALOG)
 except MatrixError as e:fail(e.code)

def projected_rows(q,datasets,*,relations_applied=False):
 if not relations_applied:
  try:datasets,_=apply_relations(q,datasets,max_rows=CATALOG['max_rows'],max_bytes=CATALOG['max_bytes'])
  except MatrixError as e:fail(e.code)
 outputs=[q['output_stage']] if isinstance(q['output_stage'],str) else q['output_stage']
 rows=[]
 for name in outputs:
  for row in datasets[name]:rows.append(dict(row))
 if not q['group_by']:return sorted(rows,key=lambda x:str(x['key']))
 groups={}
 for row in rows:
  key=tuple(row[k] for k in q['group_by'])
  if any(not isinstance(x,str) or len(x)>160 for x in key):fail('DATASET_GROUP_KEY')
  groups.setdefault(key,[]).append(row)
 result=[]
 for key,items in sorted(groups.items()):
  record=dict(zip(q['group_by'],key))
  for a in q['aggregates']:
   total=sum((money(x[a['source']]) for x in items),Decimal(0))
   if a['kind']=='ratio_sum':
    den=sum((money(x[a['denominator']]) for x in items),Decimal(0));record[a['field']]=None if den==0 else decimal_text(total/den)
   else:record[a['field']]=decimal_text(total)
  result.append(record)
 return result

def render(plan,completed,stamp):
 if not valid(plan) or len(completed)!=len(plan['stores']):fail('DATASET_INCOMPLETE')
 if len(canonical_json(completed).encode())>CATALOG['max_bytes']:fail('DATASET_CAPACITY')
 q=CATALOG['queries'][plan['dataset']['id']]
 lines=['Текущий снимок.' if q['snapshot'] else 'Период '+plan['period']['from']+' — '+plan['period']['to']+'.'];join_coverage=[]
 for store,block in zip(plan['stores'],completed):
  if block.get('store_id')!=store['id'] or block.get('complete')is not True:fail('DATASET_INCOMPLETE')
  stageids={x['id'] for x in q['flows'][store['platform']]}
  if set(block.get('datasets',{}))!=stageids:fail('DATASET_STAGE_COVERAGE')
  for name,rows in block['datasets'].items():
   if not isinstance(rows,list) or len(rows)>CATALOG['max_rows']:fail('DATASET_CAPACITY')
   keys=[r.get('key') for r in rows]
   if any(not isinstance(k,str) or not k for k in keys) or len(set(keys))!=len(keys):fail('DATASET_ROW_ID')
  try:prepared,coverage=apply_relations(q,block['datasets'],max_rows=CATALOG['max_rows'],max_bytes=CATALOG['max_bytes'])
  except MatrixError as e:fail(e.code)
  if coverage:
   join_coverage.append({'store_id':store['id'],'relations':coverage})
   for proof in coverage:
    lines.append('Покрытие «'+proof['label']+'»: целевых строк '+str(proof['target_rows'])+', с известным значением '+str(proof['matched_rows'])+', с неизвестным значением '+str(proof['unknown_value_rows'])+', без соответствия '+str(proof['unmatched_rows'])+'.')
    if proof['excluded_rows']:lines.append('За пределами явно выбранного типа строк: '+str(proof['excluded_rows'])+'. Они не включены в суммы этого отчёта.')
  rows=projected_rows(q,prepared,relations_applied=True);lines.append(store['platform']+': строк '+str(len(rows))+'.')
  for row in rows:
   pieces=[]
   for c in q['columns']:
    value=row.get(c['field'])
    if value is None:continue
    if c['kind']in ('money','number'):
     value=money(value)
     if value<0:fail('DATASET_NEGATIVE_UNDECLARED')
     from providers import displayed
     value=displayed(value)
    elif not isinstance(value,str):fail('DATASET_TEXT_TYPE')
    value=re.sub(r'[\x00-\x1f<>]',' ',value)[:150]
    pieces.append(c['label']+': '+value)
   line='; '.join(pieces)+'.'
   if len(line)>740:fail('DATASET_VOICE_LINE')
   lines.append(line)
  if not rows:lines.append('В полной выборке нет строк. Отсутствие статистики не заменено денежным нулём.')
 lines+=q['notes']+['Получено '+stamp+'.']
 pages=[];text=''
 for line in lines:
  if len(text)+len(line)+1>780:
   if text:pages.append(text.strip())
   text=''
  text+=line+' '
 if text:pages.append(text.strip())
 if len(pages)>CATALOG['max_pages']:fail('DATASET_VOICE_CAPACITY','Полный отчёт слишком длинный для озвучивания; нужен меньший период или поддержанный разрез.')
 for i in range(len(pages)-1):pages[i]+=' Скажите: дальше.'
 result={'complete':True,'pages':pages,'data':completed,'fetched_at':stamp}
 if join_coverage:
  result['join_coverage']=join_coverage
  result['enrichment_complete']=all(r['enrichment_complete'] for b in join_coverage for r in b['relations'])
 return result

def worker_step(worker,row,plan):
 repo=worker.repo;jid,owner=row['id'],row['owner']
 progress=strict_json(row['progress']) if row['progress'] else {'plan_hash':fingerprint(plan),'completed':[],'datasets':{},'stage_index':0,'task_index':0,'rows':[],'page':None,'steps':0}
 if progress['plan_hash']!=fingerprint(plan) or progress['steps']>=CATALOG['max_tasks']:fail('DATASET_PROGRESS_VERSION_OR_LIMIT')
 done=progress['completed'];store=plan['stores'][len(done)];q=CATALOG['queries'][plan['dataset']['id']];stages=q['flows'][store['platform']];stage=stages[progress['stage_index']]
 tasks=stage_tasks(plan,store,stage,progress['datasets'])
 if tasks:
  task=tasks[progress['task_index']];req=build_request(plan,store,task,progress['page'])
  if not worker.engine.authorized(plan):fail('SOURCE_ACCESS')
  body=worker._call(row,req,store);result=decode(plan,store,task,progress['page'],body)
  if not worker.engine.authorized(plan):fail('SOURCE_ACCESS')
  progress['steps']+=1
  if result['complete']:
   progress['rows'].extend(result['rows']);progress.update(task_index=progress['task_index']+1,page=None)
  else:progress['page']=result['progress']
 if not tasks or progress['task_index']==len(tasks):
  keys=[r['key'] for r in progress['rows']]
  if len(set(keys))!=len(keys) or len(keys)>CATALOG['max_rows']:fail('DATASET_STAGE_DUPLICATE_OR_LIMIT')
  progress['datasets'][stage['id']]=progress['rows'];progress.update(rows=[],stage_index=progress['stage_index']+1,task_index=0,page=None)
 if progress['stage_index']==len(stages):
  done.append({'store_id':store['id'],'datasets':progress['datasets'],'complete':True});progress.update(datasets={},rows=[],stage_index=0,task_index=0,page=None)
 if len(canonical_json(progress).encode())>CATALOG['max_bytes']:fail('DATASET_CAPACITY')
 if len(done)==len(plan['stores']):
  stamp=datetime.fromtimestamp(repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
  if strict_json(row['draft']).get('answer_by_model'):repo.stage_answer(jid,owner,{'data':done,'fetched_at':stamp})
  else:repo.complete(jid,owner,render(plan,done,stamp))
 else:repo.reschedule(jid,owner,progress)
