"""Qualified bounded row algebra alongside the existing scalar DAG.
No credentials or HTTP here. All pages are decoded before filter/group/rank/compare.
"""
from __future__ import annotations
import copy, re, json
from pathlib import Path
from datetime import date, datetime, timedelta
from dataclasses import asdict
from decimal import Decimal
from semantics import Rejected, parse, normalize, make_plan, fingerprint, strict_json, canonical_json

CATALOG=strict_json(Path(__file__).with_name('table_catalog.json').read_text())
from matrix_sources import SourceMatrix
from matrix_core import MatrixError
SOURCE_MATRIX=SourceMatrix(strict_json(Path(__file__).with_name('source_matrix.json').read_text()))
HASH=fingerprint({'table':CATALOG,'source_matrix':SOURCE_MATRIX.definition})
LANGUAGE='alice-rows/v1'
OPERATIONS=SOURCE_MATRIX.sources
if not (1<=CATALOG['max_rows']<=20000 and 1000<=CATALOG['max_bytes']<=6000000 and 1<=CATALOG['max_top']<=20):raise ValueError('UNREVIEWED_TABLE_LIMITS')
ORDER_METRICS=['ordered_units','ordered_revenue']
EVENT_METRICS=['event_buyout_units','event_buyout_amount','event_return_units','event_return_amount']


def fail(code,text=''):
    raise Rejected(code,text or ('Новый табличный запрос не выполнен: '+code+'. Неполные данные не выдаю.'))


def event_phrase(q):
    t=re.sub(r'"[^"\n]*"|«[^»\n]*»',' ',normalize(q))
    return bool(re.search(r'\bфактическ\w*\s+(?:выкуп|возврат)\w*|\bвыкупили\b|\bвыкуплен\w*\b|по дате (?:выкупа|события)|\bчто вернули\b',t)) and not re.search(r'по (?:дате )?заказ',t)


def parse_table(command,today):
    """Consume supported row slots; a meaningful residue is never dropped.
    Unknown table operations are rejected, not translated to a scalar total.
    """
    original=normalize(command)
    quoted=re.findall(r'"[^"\n]*"|«[^»\n]*»',original)
    # Slots inside quoted brand labels are data, never operators or filters.
    protected={f'zzquote{i}zz':literal for i,literal in enumerate(quoted)}
    q=original
    for mark,literal in protected.items():q=q.replace(literal,mark,1)
    # Work through parse() again after replacing only completely consumed row slots.
    is_event=event_phrase(q)
    top_match=re.search(r'\b(?:топ|top)\s*(\d{1,2})\b',q)
    is_rows=bool(top_match or re.search(r'\b(?:топ|top)\b',q) or re.search(r'\b(?:по товарам|по артикулам|по дням|по неделям|рейтинг товаров|динамика заказов|сравни товары)\b|\bsku\s+\d+',q))
    if not (is_event or is_rows):return None
    if re.search(r'\b(?:топ|top)\b',q) and not top_match:
        fail('TOP_SIZE_REQUIRED','Укажите размер списка, например: топ 5 товаров по сумме заказов за октябрь на Озоне.')
    # No trading mutation / source ambiguity bypass by rewriting the business phrase.
    if re.search(r'\b(?:измени|удали|создай|запусти|чуж\w*|токен|парол\w*|прибыл\w*|дрр|реклам\w*)\b',q):
        fail('TABLE_SCOPE_UNSUPPORTED','Такое действие или сочетание источников в табличном расчёте не подключено; условия не отбрасываю.')
    if re.search(r'по количеству (?:отдельных )?заказов',q):fail('METRIC_AMBIGUOUS','Количество отдельных заказов не равно количеству товаров. Для рейтинга доступно количество заказанных товаров.')
    text=q;top=int(top_match.group(1)) if top_match else None
    if top is not None and not 1<=top<=CATALOG['max_top']:fail('TOP_SIZE')
    if top_match:text=text[:top_match.start()]+' '+text[top_match.end():]
    view='days' if re.search(r'\bпо дням\b|\bдинамика заказов\b',q) else 'weeks' if 'по неделям' in q else 'items' if is_rows else 'totals'
    if view in ('days','weeks') and top:fail('RANK_SERIES_CONFLICT')
    measure='units' if re.search(r'по (?:количеству|штукам)|больше (?:всего )?товаров',q) else 'revenue'
    direction='asc' if re.search(r'\b(?:наименьш\w*|худш\w*|по возрастанию)\b',q) else 'desc'
    filters={}
    def sku_filter(m):
        k='exclude_sku_ids' if m.group(1) else 'sku_ids'
        filters.setdefault(k,[]).append(m.group(2));return ' '
    text=re.sub(r'\b(кроме\s+)?(?:по\s+)?sku\s+([1-9]\d{0,18})\b',sku_filter,text)
    for k in filters:filters[k]=sorted(set(filters[k]))
    if filters and view in ('days','weeks'):fail('SKU_TIME_SERIES_NOT_QUALIFIED','Дневной ряд по отдельному SKU Ozon ещё не квалифицирован; фильтр не отбрасываю.')
    # Preserve brand literals, so their words cannot steer the parser.
    event_patterns=[r'\bвсе что выкупили\b',r'\bсколько (?:товаров )?выкупили\b',r'\bфактическ\w* выкуп\w*\b',r'\bвыкуплен\w*(?: товары)?\b',r'\bвыкупили\b',r'\bвыкупы по дате (?:выкупа|события)\b']
    if is_event:
        event_patterns=[r'\bвозврат\w* по дате события\b',r'\bфактическ\w* возврат\w*\b',r'\bчто вернули\b']+event_patterns
        found=False
        for pattern in event_patterns:
            if re.search(pattern,text):text=re.sub(pattern,'сводка заказов',text);found=True
        if not found:fail('EVENT_PHRASE')
        text=re.sub(r'\b(?:количество и сумма|количество|сумма)\s+(?=сводка заказов)','',text)
        text=re.sub(r'\bблядь\b|\bблять\b',' ',text) # Non-semantic interjection, not arbitrary negation.
    text=re.sub(r'\b(?:по товарам|по артикулам|по дням|по неделям|по возрастанию|по убыванию)\b',' ',text)
    text=text.replace('динамика заказов','сводка заказов').replace('рейтинг товаров',' ')
    text=re.sub(r'\b(?:сравни товары|сравни товарные заказы)\b','сравни сводка заказов',text)
    if top:
        text=re.sub(r'^(\s*(?:(?:дай|покажи|скажи|выведи)\s+)?)товар(?:ов|ы|а)?\b',r'\1 ',text,count=1)
        text=re.sub(r'\bпо сумме заказов\b|\bпо обороту заказов\b','сводка заказов',text)
        text=re.sub(r'\bпо количеству(?: заказанных товаров| заказов)?\b|\bпо штукам\b','сводка заказов',text)
        text=re.sub(r'\b(?:лучшие|наименьшие|худшие)\b',' ',text)
        if not re.search(r'заказ',text):fail('RANK_MEASURE_REQUIRED','Укажите: топ по сумме заказов или по количеству заказанных товаров. Продажи и прибыль не подставляю.')
    for mark,literal in protected.items():text=text.replace(mark,literal)
    text=' '.join(text.split())
    draft=parse(text,today)
    if draft['route']!='P1' or not set(draft['metrics'])<=set(ORDER_METRICS):
        fail('TABLE_INTENT_INCOMPLETE','Не все условия табличного запроса распознаны. Укажите показатель заказов, разрез по товарам или дням, период и площадку.')
    if view in ('days','weeks') and draft.get('comparison'):fail('SERIES_COMPARISON_NOT_QUALIFIED','Для сравнения рядов пока нет согласованного выравнивания дат; доступны два отдельных ряда или сравнение товаров.')
    if top and draft.get('comparison'):fail('RANK_COMPARISON_NOT_QUALIFIED','Сравнение товаров доступно без топ-ограничения; сначала запросите сравнение по товарам.')
    if filters and draft['platforms']!=['ozon']:fail('SKU_PLATFORM','Числовой SKU здесь относится к Ozon; укажите только Ozon.')
    if view=='items' and draft['group_by']=='total':fail('PRODUCT_NAMESPACE','Коды товаров площадок не считаю одним товаром. Списки доступны отдельно по площадкам.')
    if is_event:
        draft['metrics']=EVENT_METRICS
        if draft.get('comparison'):fail('EVENT_COMPARISON_NOT_QUALIFIED')
        if view=='totals' and top:fail('TABLE_VIEW')
    if view in ('days','weeks') and draft.get('filters'):fail('ROW_FILTER_TIME_NOT_QUALIFIED','Дневной ряд WB с таким товарным фильтром ещё не квалифицирован.')
    draft['question']=original
    draft['table_request']={'family':'events' if is_event else 'orders','view':view,'top':top,'sort':measure,'direction':direction,'sku_filters':filters}
    draft['route']='T1'
    return draft


def operation(table,platform):
    matches=[route for route in CATALOG['routes']
             if route['family']==table['family'] and route['platform']==platform
             and table['view'] in route['views']]
    if len(matches)!=1:fail('TABLE_ROUTE_UNRESOLVED')
    route=matches[0]
    if 'unavailable' in route:fail(route['unavailable']['code'],route['unavailable']['message'])
    return route['source']


def validate_capabilities(draft,scope,capabilities):
    for s in scope.select(draft['platforms']):
        op=operation(draft['table_request'],s.platform)
        proof=capabilities.get(s.id,{}).get(op,{})
        if proof.get('status')!='READ_ONLY_CANARY' or proof.get('table_hash')!=HASH:
            fail('TABLE_SOURCE_NOT_QUALIFIED','Источник этого разреза пока не проверен для выбранного магазина. Данные другого источника не подставляю.')
        if any(proof.get(k)!=v for k,v in OPERATIONS[op]['proof_requirements'].items()):
            fail('TOKEN_CLASS_NOT_QUALIFIED')


def make_table_plan(scope,draft,capabilities):
    validate_capabilities(draft,scope,capabilities)
    base=make_plan(scope,{**draft,'metrics':ORDER_METRICS},ORDER_METRICS)
    table=draft['table_request'];today=date.fromisoformat(draft['calendar_date'])
    for store in scope.select(draft['platforms']):
        op=operation(table,store.platform)
        for period in [draft['period']]+([draft['comparison']] if draft.get('comparison') else []):
            try:SOURCE_MATRIX.available(op,period,draft['calendar_date'])
            except MatrixError as e:
                guard=next((g for g in OPERATIONS[op]['availability'] if g['code']==e.code),{})
                fail(e.code,guard.get('message',''))
    base['metrics']=EVENT_METRICS if table['family']=='events' else ORDER_METRICS
    base['table']={**copy.deepcopy(table),'language':LANGUAGE,'catalog_hash':HASH}
    base['table_capabilities']={s.id:{operation(table,s.platform):capabilities[s.id][operation(table,s.platform)]} for s in scope.select(draft['platforms'])}
    base['definition']='event-date-preliminary-v1' if table['family']=='events' else 'order-date-row-v1'
    base['projection']='table-voice-v1'
    return base


def valid(plan):
    try:
        t=plan['table']
        return (set(t)=={'family','view','top','sort','direction','sku_filters','language','catalog_hash'} and t['language']==LANGUAGE and t['catalog_hash']==HASH
          and t['family'] in ('events','orders') and t['view'] in ('items','totals','days','weeks') and t['sort'] in ('units','revenue')
          and t['direction'] in ('asc','desc') and (t['top'] is None or type(t['top']) is int and 1<=t['top']<=20)
          and set(t['sku_filters'])<={'sku_ids','exclude_sku_ids'} and all(isinstance(v,list) and all(isinstance(x,str) and re.fullmatch(r'[1-9]\d{0,18}',x) for x in v) for v in t['sku_filters'].values())
          and plan['metrics']==(EVENT_METRICS if t['family']=='events' else ORDER_METRICS)
          and set(plan['table_capabilities'])=={s['id'] for s in plan['stores']}
          and all(set(plan['table_capabilities'][s['id']])=={operation(t,s['platform'])} for s in plan['stores']))
    except (KeyError,TypeError):return False


def tasks(plan,store):
    result=[];t=plan['table'];op=operation(t,store['platform'])
    if op not in OPERATIONS:fail('TABLE_SOURCE_NOT_QUALIFIED')
    for role,period in [('current',plan['period'])]+([('previous',plan['comparison'])] if plan.get('comparison') else []):
        result.append({'operation':op,'role':role,'period':period})
    return result


def build_task(plan,store,task,progress=None):
    from providers import Request
    try:return Request(**SOURCE_MATRIX.request(task['operation'],plan,store,task,progress))
    except MatrixError as exc:fail(exc.code)


def _label(v):
    if not isinstance(v,str) or len(v)>2000:fail('ROW_LABEL')
    return re.sub(r'[\x00-\x1f<>]',' ',v)[:120]


def num(v,integer=False):
    from providers import number
    return number(v,integer)


def decode(data,plan,store,task,progress=None):
    """One reviewed interpreter, independent of provider/operation identifiers."""
    try:return SOURCE_MATRIX.decode(task['operation'],data,plan,store,task,progress,CATALOG)
    except MatrixError as exc:fail(exc.code)


def _selected(row,plan):
    f=plan['filters'];sf=plan['table']['sku_filters'];key=row.get('product',row['key'])
    return ((not f.get('nm_ids') or int(key) in f['nm_ids']) and (not f.get('exclude_nm_ids') or int(key) not in f['exclude_nm_ids'])
         and (not f.get('brands') or row.get('brand') in f['brands']) and (not sf.get('sku_ids') or key in sf['sku_ids']) and key not in sf.get('exclude_sku_ids',[]))


def group_rows(rows,plan):
    t=plan['table'];groups={}
    for r in rows:
        if not _selected(r,plan):continue
        key='total' if t['view']=='totals' else r.get('product',r['key']) if t['view']=='items' else r.get('day',r['key'])
        if t['view']=='weeks':
            d=date.fromisoformat(key);key=(d-timedelta(days=d.weekday())).isoformat()
        out=groups.setdefault(key,{'key':key,'label':r['label'] if t['view']=='items' else key,'units':Decimal(0),'revenue':Decimal(0),'return_units':Decimal(0),'return_revenue':Decimal(0),'money_complete':True})
        out['units']+=num(r['units'],True)
        if t['family']=='events':
            out['return_units']+=num(r['return_units'],True)
            if r['revenue'] is None:out['money_complete']=False
            else:out['return_revenue' if r['kind']=='R' else 'revenue']+=num(r['revenue'])
        else:out['revenue']+=num(r['revenue'])
    if t['view'] in ('days','weeks') and t['family']=='events':
        a,b=map(date.fromisoformat,(plan['period']['from'],plan['period']['to']))
        for i in range((b-a).days+1):
            d=a+timedelta(days=i);key=(d-timedelta(days=d.weekday())).isoformat() if t['view']=='weeks' else d.isoformat()
            groups.setdefault(key,{'key':key,'label':key,'units':Decimal(0),'revenue':Decimal(0),'return_units':Decimal(0),'return_revenue':Decimal(0),'money_complete':True})
    if t['view']=='totals' and not groups:
        groups['total']={'key':'total','label':'total','units':Decimal(0),'revenue':Decimal(0),'return_units':Decimal(0),'return_revenue':Decimal(0),'money_complete':True}
    return groups


def render(plan,completed,stamp):
    from providers import displayed
    if not valid(plan) or len(completed)!=len(plan['stores']):fail('TABLE_INCOMPLETE')
    if len(canonical_json(completed).encode())>CATALOG['max_bytes']:fail('TABLE_CAPACITY')
    t=plan['table'];by_platform={}
    for store,block in zip(plan['stores'],completed):
        if block.get('store_id')!=store['id'] or block.get('complete') is not True or not isinstance(block.get('current'),list):fail('TABLE_INCOMPLETE')
        if plan.get('comparison') and not isinstance(block.get('previous'),list):fail('TABLE_COMPARISON_INCOMPLETE')
        for role,period in [('current',plan['period'])]+([('previous',plan['comparison'])] if plan.get('comparison') else []):
            checked=set()
            if len(block[role])>CATALOG['max_rows']:fail('TABLE_CAPACITY')
            for row in block[role]:
                key=row.get('key')
                if not isinstance(key,str) or not key or key in checked:fail('ROW_DUPLICATE_OR_ID')
                checked.add(key)
                num(row['units'],True)
                if t['family']=='events':
                    if row.get('kind') not in ('S','R') or not re.fullmatch(r'[1-9]\d{0,18}',str(row.get('product',''))):fail('EVENT_ID_DUPLICATE_OR_TYPE')
                    day=date.fromisoformat(row['day']).isoformat()
                    if not period['from']<=day<=period['to']:fail('ROW_PERIOD')
                    if (num(row['units'],True),num(row['return_units'],True))!=((Decimal(1),Decimal(0)) if row['kind']=='S' else (Decimal(0),Decimal(1))):fail('EVENT_KIND_COUNTS')
                elif t['view'] in ('days','weeks'):
                    day=date.fromisoformat(key).isoformat()
                    if not period['from']<=day<=period['to']:fail('ROW_PERIOD')
                if row.get('revenue') is not None:num(row['revenue'])
                elif t['family']!='events':fail('ROW_NUMBER_MISSING')
        if block.get('currency') not in ('RUB','BYN','KZT','AMD','KGS','UZS','CNY','USD','EUR') or (store['currency'] is not None and block['currency']!=store['currency']):fail('TABLE_CURRENCY_CHANGED')
        label='total' if plan['group_by']=='total' else store['platform']
        group=by_platform.setdefault(label,{'currency':block['currency'],'current':[],'previous':[]})
        if group['currency']!=block['currency']:fail('TABLE_CURRENCY_CHANGED')
        group['current'].extend(block['current']);group['previous'].extend(block.get('previous',[]))
    lines=[f"С {plan['period']['from']} по {plan['period']['to']}."]
    if plan.get('comparison'):lines.append(f"Сравнение с {plan['comparison']['from']} по {plan['comparison']['to']}.")
    if t['family']=='events':lines.append('WB: оперативные выкупы по дате продажи, не по дате заказа. Возвраты показаны отдельно.')
    for platform,block in sorted(by_platform.items()):
        name={'ozon':'Озон','wb':'Вайлдберриз','total':'Всего'}[platform];current=group_rows(block['current'],plan);past=group_rows(block['previous'],plan) if plan.get('comparison') else {}
        rows=list(current.values())
        if plan.get('comparison'):
            for key,row in past.items():
                if key not in current:rows.append({**row,'units':Decimal(0),'revenue':Decimal(0)})
        if t['top'] and t['sort']=='revenue' and any(not r['money_complete'] for r in rows):fail('EVENT_AMOUNTS_NOT_READY','Источник ещё заполняет суммы событий; денежный рейтинг пока не определён. Количество доступно отдельно.')
        if t['view']=='items':rows.sort(key=lambda r:((-r[t['sort']] if t['direction']=='desc' else r[t['sort']]),r['key']))
        else:rows.sort(key=lambda r:r['key'])
        full=len(rows)
        if t['top']:rows=rows[:t['top']]
        lines.append(name+': '+(f"топ {len(rows)} из {full} товаров после полной выборки." if t['top'] else f"строк результата {full}."))
        for row in rows:
            label='' if t['view']=='totals' else (row['label'][:70]+'; код '+row['key']+': ') if t['view']=='items' else row['key']+': '
            text=label+('выкуплено ' if t['family']=='events' else 'заказано ')+displayed(row['units'])+' шт.'
            if row['money_complete']:text+=', сумма '+displayed(row['revenue'])+' '+block['currency']
            else:text+=', сумма ещё дозаполняется источником'
            if t['family']=='events':text+='; возвраты '+displayed(row['return_units'])+' шт.'+((', сумма '+displayed(row['return_revenue'])+' '+block['currency']) if row['money_complete'] else '')
            if plan.get('comparison'):
                old=past.get(row['key'],{'units':Decimal(0),'revenue':Decimal(0)})
                text+='; ранее '+displayed(old['units'])+' шт., '+displayed(old['revenue'])+' '+block['currency']+'; изменение суммы '+displayed(row['revenue']-old['revenue'])
            lines.append(text+'.')
        if not rows:lines.append('В полной выборке нет строк, соответствующих фильтру.')
    if t['family']=='events':lines.append('Предварительная статистика WB, обновляется с задержкой; неоплаченные и некоторые рассроченные покупки могут отсутствовать. Сумма — priceWithDisc, цена продавца со скидкой; не выплата и не финальный бухгалтерский итог.')
    else:lines.append('Это заказанные товары, не выкупы и не прибыль. Данные API могут уточняться; с кабинетом не сверено.')
    if t['view']=='weeks':lines.append('Недели начинаются в понедельник; крайние недели ограничены запрошенными датами.')
    lines.append('Получено '+stamp+'.')
    pages=[];text=''
    for line in lines:
        if len(text)+len(line)+1>780:
            if text:pages.append(text.strip())
            text=''
        if len(line)>780:fail('TABLE_VOICE_LINE')
        text+=line+' '
    if text:pages.append(text.strip())
    if len(pages)>200:fail('TABLE_VOICE_CAPACITY','Отчёт слишком длинный для озвучивания. Укажите топ или меньший период.')
    for i in range(len(pages)-1):pages[i]+=' Скажите: дальше.'
    return {'complete':True,'pages':pages,'data':completed,'fetched_at':stamp}


def worker_step(worker,row,plan):
    repo=worker.repo;jid,owner=row['id'],row['owner'];progress=strict_json(row['progress']) if row['progress'] else {'completed':[],'task_index':0,'partial':None,'page':None}
    done=progress['completed'];store=plan['stores'][len(done)];tt=tasks(plan,store);task=tt[progress['task_index']]
    req=build_task(plan,store,task,progress['page']);data=worker._call(row,req,store)
    decoded=decode(data,plan,store,task,progress['page'])
    if not worker.engine.authorized(plan):fail('SOURCE_ACCESS')
    if decoded['complete']:
        partial=progress['partial'] or {'store_id':store['id'],'current':[],'previous':[],'currency':decoded['currency'],'complete':False}
        if partial['currency']!=decoded['currency']:fail('TABLE_CURRENCY_CHANGED')
        partial[task['role']].extend(decoded['rows'])
        if len(canonical_json(partial).encode())>CATALOG['max_bytes']:fail('TABLE_CAPACITY')
        progress.update(partial=partial,page=None,task_index=progress['task_index']+1)
        if progress['task_index']==len(tt):partial['complete']=True;done.append(partial);progress.update(partial=None,page=None,task_index=0)
    else:progress['page']=decoded['progress']
    if len(done)==len(plan['stores']):
        from datetime import timezone
        stamp=datetime.fromtimestamp(repo.clock(),timezone.utc).strftime('%Y-%m-%d %H:%M UTC')
        if strict_json(row['draft']).get('answer_by_model'):repo.stage_answer(jid,owner,{'data':done,'fetched_at':stamp})
        else:repo.complete(jid,owner,render(plan,done,stamp))
    else:
        if len(canonical_json(progress).encode())>CATALOG['max_bytes']:fail('TABLE_CAPACITY')
        repo.reschedule(jid,owner,progress)
