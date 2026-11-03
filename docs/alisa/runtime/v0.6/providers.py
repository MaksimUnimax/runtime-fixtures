"""Versioned physical recipes and strict response decoders.
No network, credentials, or automatic endpoint discovery in this module.
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, InvalidOperation
from semantics import Rejected, canonical_json

from registry import REGISTRY
CATALOG = REGISTRY['recipes']

CURRENCY = {'RUB','BYN','KZT','AMD','KGS','UZS','CNY','USD','EUR'}
PROVIDER_METRIC = CATALOG['ozon']['metrics']
WB_METRIC = CATALOG['wb']['metrics']

@dataclass(frozen=True)
class Request:
    operation: str
    source: str
    store_id: str
    body: dict
    interval: int
    daily_limit: int

    def record(self):
        return {'operation':self.operation, 'source':self.source, 'store_id':self.store_id,
                'body':self.body, 'interval':self.interval, 'daily_limit':self.daily_limit}

def build(plan: dict, store: dict, progress: dict | None = None) -> Request:
    platform = store['platform']
    if platform not in CATALOG:
        raise Rejected('RECIPE_NOT_FOUND')
    recipe = CATALOG[platform]
    period = plan['period']
    if platform == 'ozon':
        body = {'date_from':period['from'], 'date_to':period['to'],
                'metrics':[PROVIDER_METRIC[m] for m in plan['metrics']],
                'dimension':['month'], 'filters':[], 'limit':1000, 'offset':0}
    else:
        body = {'selectedPeriod':{'start':period['from'], 'end':period['to']},
                'nmIds':[], 'brandNames':[], 'subjectIds':[], 'tagIds':[], 'skipDeletedNm':False,
                'orderBy':{'field':'orderSum','mode':'desc'}, 'limit':1000,
                'offset':(progress or {}).get('offset', 0)}
    # Source quota identity deliberately excludes key/catalog revisions.
    source = platform + ':' + store['identity'] + ':' + recipe['operation']
    return Request(recipe['operation'], source, store['id'], body, recipe['min_interval'], recipe['daily_limit'])

def number(value, integer=False) -> Decimal:
    if isinstance(value, bool) or not isinstance(value, (str,int,float,Decimal)):
        raise Rejected('NUMBER_TYPE')
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise Rejected('NUMBER_FORMAT') from None
    if not result.is_finite() or result < 0 or result > Decimal('1e18') or (integer and result != result.to_integral_value()):
        raise Rejected('NUMBER_RANGE')
    return result

def amount(value: Decimal) -> str:
    # Decimal -> non-exponent text without rounding or binary floating arithmetic.
    return format(value, 'f')

def decode_ozon(data: dict, plan: dict, store: dict) -> dict:
    try:
        result = data['result']
        rows, totals = result['data'], result['totals']
        metrics = plan['metrics']
        if not isinstance(rows, list) or len(rows) >= 1000 or not isinstance(totals, list) or len(totals) != len(metrics):
            raise Rejected('OZON_SHAPE')
        final = {m:number(totals[i], m == 'ordered_units') for i,m in enumerate(metrics)}
        sums = {m:Decimal(0) for m in metrics}
        first, last = plan['period']['from'][:7], plan['period']['to'][:7]
        seen = set()
        for row in rows:
            values, dimensions = row['metrics'], row['dimensions']
            if not isinstance(values,list) or len(values) != len(metrics) or not isinstance(dimensions,list) or len(dimensions) != 1:
                raise Rejected('OZON_ROW_SHAPE')
            month = dimensions[0].get('id')
            if not isinstance(month,str) or not re.fullmatch(r'\d{4}-\d{2}(?:-01)?', month):
                raise Rejected('OZON_DIMENSION_UNQUALIFIED')
            month = month[:7]
            date.fromisoformat(month + '-01')
            if month in seen or not first <= month <= last:
                raise Rejected('OZON_MONTH_COVERAGE')
            seen.add(month)
            for i, metric in enumerate(metrics):
                sums[metric] += number(values[i], metric == 'ordered_units')
        if sums != final:
            raise Rejected('OZON_TOTAL_MISMATCH')
        return {'values':{m:amount(v) for m,v in final.items()}, 'rows':len(rows),
                'currency':store['currency'], 'complete':True, 'progress':None}
    except (KeyError, TypeError, IndexError, AttributeError, ValueError) as exc:
        if isinstance(exc, Rejected):
            raise
        raise Rejected('OZON_SCHEMA') from None

def decode_wb(data: dict, plan: dict, store: dict, progress: dict | None = None) -> dict:
    try:
        block = data['data']
        rows, currency = block['products'], block['currency']
        if not isinstance(rows,list) or len(rows) > 1000 or currency not in CURRENCY:
            raise Rejected('WB_SHAPE_CURRENCY')
        if store['currency'] is not None and currency != store['currency']:
            raise Rejected('WB_CURRENCY_CHANGED')
        metrics = plan['metrics']
        progress = progress or {'seen':[], 'values':{m:'0' for m in metrics}, 'offset':0, 'currency':currency}
        if progress['currency'] != currency:
            raise Rejected('WB_CURRENCY_CHANGED')
        seen = set(progress['seen'])
        sums = {m:number(progress['values'][m], m == 'ordered_units') for m in metrics}
        if len(seen) != progress['offset']:
            raise Rejected('WB_PROGRESS')
        for row in rows:
            product = row['product']['nmId']
            selected = row['statistic']['selected']
            if isinstance(product,bool) or not isinstance(product,int) or product <= 0 or product in seen:
                raise Rejected('WB_DUPLICATE_PRODUCT')
            if selected['period'] != {'start':plan['period']['from'], 'end':plan['period']['to']}:
                raise Rejected('WB_PERIOD')
            seen.add(product)
            for metric in metrics:
                sums[metric] += number(selected[WB_METRIC[metric]], metric == 'ordered_units')
        # A full-sized page never proves completion, even if it is expected to be the last.
        complete = len(rows) < 1000
        accumulated = {m:amount(v) for m,v in sums.items()}
        more = None if complete else {'seen':sorted(seen), 'values':accumulated,
                                     'offset':progress['offset'] + len(rows), 'currency':currency}
        return {'values':accumulated, 'rows':len(seen), 'currency':currency,
                'complete':complete, 'progress':more}
    except (KeyError, TypeError, IndexError, AttributeError) as exc:
        raise Rejected('WB_SCHEMA') from None

def decode(data: dict, plan: dict, store: dict, progress: dict | None = None) -> dict:
    return decode_ozon(data,plan,store) if store['platform'] == 'ozon' else decode_wb(data,plan,store,progress)

def render(plan: dict, completed: list[dict], fetched_at: str) -> dict:
    if len(completed) != len(plan['stores']):
        raise Rejected('INCOMPLETE_RESULT')
    for store, result in zip(plan['stores'],completed):
        if result.get('complete') is not True or result.get('store_id') != store['id'] or set(result.get('values',{})) != set(plan['metrics']):
            raise Rejected('INCOMPLETE_RESULT')
        for metric in plan['metrics']:
            number(result['values'][metric], metric == 'ordered_units')
    lines = [f"С {plan['period']['from']} по {plan['period']['to']}."]
    grouped = {}
    for store,result in zip(plan['stores'],completed):
        key = 'total' if plan['group_by']=='total' else store['platform']
        grouped.setdefault(key,[]).append(result)
    for key,results in sorted(grouped.items()):
        currencies = {r['currency'] for r in results}
        if 'ordered_revenue' in plan['metrics'] and len(results)>1 and (None in currencies or len(currencies)!=1):
            raise Rejected('CURRENCY_UNCONFIRMED')
        values = {m:amount(sum((number(r['values'][m]) for r in results),Decimal(0))) for m in plan['metrics']}
        currency = next(iter(currencies)) if len(currencies)==1 else None
        label = {'ozon':'Озон','wb':'Вайлдберриз','total':'Итого'}[key]
        parts = []
        if 'ordered_units' in plan['metrics']:
            parts.append('заказано товаров ' + values['ordered_units'])
        if 'ordered_revenue' in plan['metrics']:
            unit = currency or 'в валюте кабинета, код валюты не подтвержден'
            parts.append('сумма заказов ' + values['ordered_revenue'] + ' ' + unit)
        lines.append(label + ': ' + ', '.join(parts) + '.')
    lines.append('Это заказы, не выкупы и не прибыль. Проверочные цифры API, пока без сверки с кабинетом. Получено ' + fetched_at + '.')
    pages, page = [], ''
    for line in lines:
        if len(line) > 800:
            raise Rejected('VOICE_LINE_TOO_LONG')
        if len(page) + len(line) + 1 > 800:
            pages.append(page.strip()); page = ''
        page += line + ' '
    if page: pages.append(page.strip())
    for i in range(len(pages)-1): pages[i] += ' Скажите: дальше.'
    return {'complete':True, 'pages':pages, 'data':completed, 'fetched_at':fetched_at}
