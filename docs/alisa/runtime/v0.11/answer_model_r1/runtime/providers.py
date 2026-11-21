"""Versioned physical recipes and strict response decoders.
No network, credentials, or automatic endpoint discovery in this module.
"""
from __future__ import annotations
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from semantics import Rejected, canonical_json

from zoneinfo import ZoneInfo
from registry import REGISTRY, DEFINITIONS, base_metrics
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
    daily_limit: int | None

    def record(self):
        return {'operation':self.operation, 'source':self.source, 'store_id':self.store_id,
                'body':self.body, 'interval':self.interval, 'daily_limit':self.daily_limit}

def _scalar_call(fn,*args,**kwargs):
    from matrix_core import MatrixError
    try:return fn(*args,**kwargs)
    except MatrixError as exc:raise Rejected(exc.code) from None

def _legacy_tasks(plan,store):
    from scalar_runtime import MATRIX
    return _scalar_call(MATRIX.tasks,plan,store)

def build_task(plan,store,task,progress=None):
    from scalar_runtime import MATRIX
    return Request(**_scalar_call(MATRIX.build,plan,store,task,progress))

def build(plan,store,progress=None):return build_task(plan,store,tasks(plan,store)[0],progress)

def sources(plan,store):
    if 'dataset' in plan:
        from dataset_pipeline import source_names
        return source_names(plan,store)
    if 'table' in plan:
        import table_analytics as tables
        return {tables.build_task(plan,store,t).source for t in tables.tasks(plan,store)}
    from scalar_runtime import MATRIX,SOURCES
    result=set()
    for task in tasks(plan,store):
        for op in MATRIX.operations_for(task):
            source=SOURCES.recipe(op)
            result.add(store['platform']+':'+store['identity']+':'+source['quota_operation'])
    return result

def integer_metric(metric):return DEFINITIONS[metric].get('unit') in ('item','count')

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

def metric_number(metric,value):
    if DEFINITIONS[metric].get('signed'):
        from finance_stock import numeric
        return numeric(value,signed=True)
    return number(value,integer_metric(metric))

def amount(value: Decimal) -> str:
    # Decimal -> non-exponent text without rounding or binary floating arithmetic.
    return format(value, 'f')

def _legacy_decode_task(data,plan,store,task,progress=None):
    from scalar_runtime import MATRIX
    return _scalar_call(MATRIX.decode,data,plan,store,task,progress)

# Compatibility surface only: no request, response-field or pagination logic.
def decode_ozon(data,plan,store):
    return _legacy_decode_task(data,plan,store,{'recipe':'ozon','metrics':plan['metrics'],'period':plan['period']})

def decode_wb(data,plan,store,progress=None):
    return _legacy_decode_task(data,plan,store,{'recipe':'wb','metrics':plan['metrics'],'period':plan['period']},progress)

def decode(data,plan,store,progress=None):
    return _legacy_decode_task(data,plan,store,tasks(plan,store)[0],progress)

def expense_number(value):
    from matrix_core import decimal_comma
    return Decimal(_scalar_call(decimal_comma,value))

def decode_expense(data,task,store):
    return _legacy_decode_task(data,{'period':task['period'],'filters':{}},store,task)

def derived(metric,values,period):
    definition=DEFINITIONS[metric]
    if 'formula' not in definition:return metric_number(metric,values[metric])
    operands=[number(values[m]) for m in definition['dependencies']]
    if definition['formula']=='per_calendar_day':
        days=(date.fromisoformat(period['to'])-date.fromisoformat(period['from'])).days+1
        return operands[0]/days
    if operands[1]==0:return None
    return operands[0]/operands[1]*(100 if definition['formula']=='ratio_percent' else 1)

def displayed(value):
    return amount(value.quantize(Decimal('.01'),rounding=ROUND_HALF_UP)).rstrip('0').rstrip('.') if value!=value.to_integral_value() else amount(value.to_integral_value())

def _legacy_render(plan: dict, completed: list[dict], fetched_at: str) -> dict:
    leaves=base_metrics(plan['metrics'])
    if len(completed)!=len(plan['stores']):raise Rejected('INCOMPLETE_RESULT')
    for store,result in zip(plan['stores'],completed):
        if result.get('complete') is not True or result.get('store_id')!=store['id'] or set(result.get('values',{}))!=set(leaves):raise Rejected('INCOMPLETE_RESULT')
        for m in leaves:metric_number(m,result['values'][m])
        if plan.get('comparison'):
            if set(result.get('previous_values',{}))!=set(leaves):raise Rejected('INCOMPLETE_COMPARISON')
            for m in leaves:metric_number(m,result['previous_values'][m])
    lines=['Текущий снимок, не исторический отчёт.'] if plan.get('snapshot') else [f"С {plan['period']['from']} по {plan['period']['to']}."]
    if plan.get('comparison'):lines.append(f"Сравнение с {plan['comparison']['from']} по {plan['comparison']['to']}.")
    if plan.get('filters'):lines.append('С учётом заданного фильтра товаров WB.')
    grouped={}
    for store,result in zip(plan['stores'],completed):
        key='total' if plan['group_by']=='total' else store['platform'];grouped.setdefault(key,[]).append(result)
    for key,results in sorted(grouped.items()):
        currencies={r['currency'] for r in results}
        money=any(DEFINITIONS[m]['unit'] in ('currency','source_currency') for m in leaves)
        if money and len(results)>1 and (None in currencies or len(currencies)!=1):raise Rejected('CURRENCY_UNCONFIRMED')
        currency=next(iter(currencies)) if len(currencies)==1 else None
        values={m:amount(sum((metric_number(m,r['values'][m]) for r in results),Decimal(0))) for m in leaves}
        previous={m:amount(sum((metric_number(m,r['previous_values'][m]) for r in results),Decimal(0))) for m in leaves} if plan.get('comparison') else None
        label={'ozon':'Озон','wb':'Вайлдберриз','total':'Итого'}[key]
        for metric in plan['metrics']:
            d=DEFINITIONS[metric];v=derived(metric,values,plan['period'])
            name={'ordered_units':'заказано товаров','ordered_revenue':'сумма заказов'}.get(metric,d['label'])
            unit=(' '+(currency or 'в валюте кабинета, код валюты не подтвержден')) if (d['unit'].startswith('currency') or d['unit']=='source_currency') else (' процентов' if d.get('formula')=='ratio_percent' else '')
            text=label+': '+name+' '+(displayed(v)+unit if v is not None else 'не определён: знаменатель равен нулю')
            if previous is not None:
                old=derived(metric,previous,plan['comparison'])
                text+='; ранее '+(displayed(old)+unit if old is not None else 'не определено')
                if v is not None and old is not None:
                    diff=v-old;text+='; изменение '+('+' if diff>0 else '')+displayed(diff)+(' процентных пункта' if d.get('formula')=='ratio_percent' else unit)
            lines.append(text+'.')
    if any('cohort' in m or m=='buyout_share' for m in plan['metrics']):lines.append('Выкупы и отмены относятся к заказам выбранного периода, не к дате выкупа или отмены.')
    if 'drr_ordered' in plan['metrics']:lines.append('База ДРР — сумма заказов, не выкупы и не рекламно-атрибутированные продажи.')
    if any('ad_' in m or m=='drr_ordered' for m in plan['metrics']):lines.append('Рекламные расходы — данные расходного API; не пополнение счёта. Сверка с финансовыми начислениями не выполнена.')
    if any(DEFINITIONS[m].get('source')=='finance' for m in plan['metrics']):
        lines.append('Финансовые данные относятся к датам отчётов. Это не сумма заказов и не прибыль; корректировки могут быть отрицательными.')
        if any(s['platform']=='ozon' for s in plan['stores']):
            lines.append('Логистика Ozon: строки logistics и reverse_logistics. Хранение: размещение на складах и временное размещение у агента; прочие услуги идут отдельно.')
    if any(DEFINITIONS[m].get('source')=='stocks' for m in plan['metrics']):
        lines.append('Остатки склада площадки не включают FBS продавца. В Ozon поля present и reserved показаны отдельно, без вычитания одного из другого.')
    lines.append('Проверочные цифры API, пока без сверки с кабинетом. Получено '+fetched_at+'.')
    pages=[];page=''
    for line in lines:
        if len(line)>800:raise Rejected('VOICE_LINE_TOO_LONG')
        if len(page)+len(line)+1>800:pages.append(page.strip());page=''
        page+=line+' '
    if page:pages.append(page.strip())
    for i in range(len(pages)-1):pages[i]+=' Скажите: дальше.'
    return {'complete':True,'pages':pages,'data':completed,'fetched_at':fetched_at}


def tasks(plan,store):
    if 'program' in plan:
        from program_providers import tasks as compiled_tasks
        return compiled_tasks(plan,store)
    return _legacy_tasks(plan,store)

def decode_task(data,plan,store,task,progress=None):
    result=_legacy_decode_task(data,plan,store,task,progress)
    if '_select_current' in task and result['complete']:
        result['values']={m:result['values'][m] for m in task['_select_current']}
        result['previous_values']={m:result['previous_values'][m] for m in task['_select_previous']}
    return result

def render(plan,completed,fetched_at):
    if 'universal_read'in plan:
        from universal_reads import result
        return result(plan,completed,fetched_at)
    if 'dataset' in plan:
        from dataset_pipeline import render as dataset_render
        return dataset_render(plan,completed,fetched_at)
    if 'table' in plan:
        from table_analytics import render as table_render
        return table_render(plan,completed,fetched_at)
    if 'program' in plan:
        from program_providers import render as compiled_render
        return compiled_render(plan,completed,fetched_at)
    return _legacy_render(plan,completed,fetched_at)
