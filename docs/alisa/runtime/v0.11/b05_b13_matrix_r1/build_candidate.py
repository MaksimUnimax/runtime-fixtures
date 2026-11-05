"""Offline authoring only: writes two JSON catalogues into an inactive clone.
No source Python changes, credentials, DB, service control or network.
"""
from pathlib import Path
from copy import deepcopy
import argparse, hashlib, json

def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def build(root: Path, expected_manifest: str):
    manifest = root/'DEPLOY_VERIFIED_MANIFEST.json'
    if digest(manifest) != expected_manifest:
        raise ValueError('BASE_MANIFEST_CHANGED')
    hashes = json.loads(manifest.read_text())
    for name, value in hashes.items():
        if digest(root/name) != value: raise ValueError('BASE_SOURCE_CHANGED:'+name)
    s = json.loads((root/'dataset_sources.json').read_text())
    q = json.loads((root/'dataset_queries.json').read_text())
    before = {n: digest(root/n) for n in ('dataset_sources.json','dataset_queries.json','failure_catalog.json')}
    P = lambda *path: {'$path':list(path)}
    F = lambda fn,*args: {'$fn':[fn,*args]}
    IF = lambda cond,yes,no: {'$if':[cond,yes,no]}
    MAP = lambda expr,binding,body: {'$map':[expr,binding,body]}
    G = lambda test,code: {'test':test,'code':code}
    AND = lambda a,b: F('and',a,b)
    # Values below remain source expressions, not code executed by runtime.
    a = s['sources']['ds_ozon_accrual_rows']
    a['availability'].append(G(F('ge',F('days_between',P('period','to'),P('calendar_date')),1),'SOURCE_PERIOD_NOT_COMPLETED'))
    positive = F('gt',F('decimal_compare',P('product','sale_amount'),'0'),0)
    absval = lambda name: IF(positive,P('product',name),F('negate',P('product',name)))
    rowmap = a['response']['map']['$map'][2]
    rowmap.update(direction=IF(positive,'реализация','обратное начисление'),
                  line_units=P('product','quantity'),
                  buyer_line_amount=absval('sale_price'),
                  seller_unit_price=absval('seller_price'),
                  seller_line_amount=absval('sale_amount'),
                  buyer_unit_average=F('divide_or_null',absval('sale_price'),P('product','quantity')),
                  reversal_seller_amount=IF(positive,'0',F('negate',P('product','sale_amount'))))
    notes = ['Дата начисления, не дата заказа или физического выкупа; направления разделены.',
             'Показаны только дни и товары с записями источника; отсутствие строки не заменено нулём.',
             'Покупательская сумма — сумма строки; среднее взвешено количеством. Это не кассовый чек.']
    for key in ('accrual_items','accrual_days','accrual_items_days'):
        t=q['queries'][key]
        t['notes']=notes[:]
        t['aggregates'].append({'field':'reversal_seller_amount','kind':'sum','source':'reversal_seller_amount','denominator':None})
        t['columns'].append({'field':'seller_amount','label':'положительная сумма продавца','kind':'money'})
        t['columns'].append({'field':'reversal_seller_amount','label':'обратная сумма продавца, модуль','kind':'money'})
    lines=deepcopy(q['queries']['accrual_items'])
    lines.update(phrases=['строки товарных начислений','цены товарных строк по начислениям'],group_by=[],aggregates=[])
    lines['columns']=[{'field':name,'label':label,'kind':kind} for name,label,kind in [
        ('day','дата начисления','text'),('product_id','SKU','text'),('direction','направление','text'),
        ('line_units','товаров в строке','number'),('buyer_line_amount','покупательская сумма строки, модуль','money'),
        ('buyer_unit_average','среднее строки на товар','money'),('seller_unit_price','цена продавца за товар, модуль','money'),
        ('seller_line_amount','сумма продавца строки, модуль','money'),('currency','валюта','text')]]
    lines['notes']=[notes[0],notes[1],'Разные товарные строки одного SKU не объединены. При количестве больше одного среднее строки не доказывает цену каждой отдельной покупки.','Обратные начисления показаны отдельным направлением с модулями денежных сумм.']
    q['queries']['accrual_price_lines']=lines
    # Campaign ID inventory is its own read-only primitive, not full statistics.
    campaigns=s['sources']['ds_wb_campaigns']['response']
    campaigns['root_asserts'].append(G(F('all',MAP({'$path':['response','adverts'],'default':[]},'group',IF(F('in','count',F('keys',P('group'))),F('eq',P('group','count'),F('len',P('group','advert_list'))),True))),'DATASET_CAMPAIGN_GROUP_TOTAL'))
    inventory=deepcopy(q['queries']['product_registry'])
    inventory.update(phrases=['реестр рекламных кампаний','список рекламных кампаний по статусам'],
                     flows={'wb':[{'id':'rows','source':'ds_wb_campaigns','period_mode':'whole','foreach':[{}]}]},
                     columns=[{'field':'campaign_id','label':'ID кампании','kind':'number'},{'field':'status','label':'статус источника','kind':'number'}],
                     notes=['Список и статусы на момент запроса. Это не статистика за период и не восстановление прежних статусов.','Отсутствие кампании в отдельном отчёте статистики не означает нулевые показы или расходы.'])
    q['queries']['wb_campaign_inventory']=inventory
    # Optional provider fields, when present, must reconcile; absence is not fabricated.
    stats=s['sources']['ds_wb_adstats'];stats['axis']='advertising_period'
    stats['availability'].append(G(F('ge',F('days_between',P('period','to'),P('calendar_date')),1),'SOURCE_PERIOD_NOT_COMPLETED'))
    r=stats['response'];has_days=F('in','days',F('keys',P('row')))
    r['lets'].append({'name':'daily','value':IF(has_days,F('array',P('row','days')),[]),'code':'DATASET_DAILY_SCHEMA'})
    r['row_asserts'].append(G(IF(F('in','currency',F('keys',P('row'))),F('eq',P('row','currency'),P('store','currency')),True),'DATASET_CURRENCY'))
    day=F('event_day',P('daily','date'),'Europe/Moscow')
    r['row_asserts'].append(G(F('distinct',MAP(P('v','daily'),'daily',day)),'DATASET_DAILY_DUPLICATE'))
    r['row_asserts'].append(G(F('all',MAP(P('v','daily'),'daily',AND(F('le',P('period','from'),day),F('le',day,P('period','to'))))),'DATASET_DAILY_PERIOD'))
    for field in ('views','clicks','orders','shks','sum','sum_price'):
        numeric='nonnegative' if field in ('sum','sum_price') else 'natural'
        actual=F('sum_values',MAP(P('v','daily'),'daily',F(numeric,P('daily',field))))
        r['row_asserts'].append(G(IF(has_days,F('eq',F('decimal_compare',actual,F(numeric,P('row',field))),0),True),'DATASET_DAILY_TOTAL'))
    # Advertisers must not confuse current selection with historical cabinet totals.
    selected=q['queries']['wb_active_ads']
    selected['notes'].append('Показатели статистики предварительные и могут обновляться; статистический расход не прибавляется повторно к финансовому расходу.')
    totals=deepcopy(selected);totals['phrases']=['сводка статистики активных рекламных кампаний','итоги активных рекламных кампаний']
    totals['columns']=[deepcopy(c) for c in selected['columns'] if c['field']!='campaign_id']
    totals['group_by']=['currency']
    totals['aggregates']=[{'field':f,'kind':'sum','source':f,'denominator':None} for f in ('views','clicks','orders','units','revenue','spend')]
    q['queries']['wb_active_ads_totals']=totals
    supported=deepcopy(selected)
    supported['phrases']=['статистика завершенных активных и приостановленных кампаний']
    def replace_status(value):
        if type(value) is list:
            if value==[9,11]: return [7,9,11]
            return [replace_status(x) for x in value]
        if type(value) is dict:return {k:replace_status(v) for k,v in value.items()}
        return value
    supported['flows']=replace_status(supported['flows'])
    supported['notes']=['Выбраны кампании с текущими статусами 7, 9 и 11. Это не все удалённые кампании и не исторический снимок статусов.','Запрошены все ID выбранной группы; отсутствие ответа хотя бы по одному ID блокирует полный отчёт, а не превращается в ноль.',selected['notes'][-1]]
    q['queries']['wb_supported_ads']=supported
    s['version']='20261105-b05-b13-matrix-r1';q['version']='20261105-b05-b13-matrix-r1'
    for filename,obj in [('dataset_sources.json',s),('dataset_queries.json',q)]:
        (root/filename).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
    errors=json.loads((root/'failure_catalog.json').read_text());errors['version']='20261105-b05-b13-matrix-r1'
    errors['entries']['SOURCE_PERIOD_NOT_COMPLETED']['reason']='Запрошенный период ещё не завершён; неполные данные не выдаю за окончательный отчёт.'
    (root/'failure_catalog.json').write_text(json.dumps(errors,ensure_ascii=False,indent=2)+'\n')
    after={n:digest(root/n) for n in before}
    return {'changed_files':list(before),'before':before,'after':after,'sources':len(s['sources']),'queries':len(q['queries']),
            'added_queries':['accrual_price_lines','wb_campaign_inventory','wb_active_ads_totals','wb_supported_ads'],
            'runtime_python_changed':False,'installed':False,'external_calls':0}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);parser.add_argument('--base-manifest',required=True)
    args=parser.parse_args();print(json.dumps(build(args.root,args.base_manifest),ensure_ascii=False))
