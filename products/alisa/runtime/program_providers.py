"""Lower a checked scalar program to existing qualified recipes; render only complete data."""
from __future__ import annotations
from decimal import Decimal
from registry import DEFINITIONS
from semantics import Rejected
from query_program import evaluate,validate_compiled,compile_program
from semantic_catalog import hash_value


def tasks(plan,store):
    import providers
    result=[]
    for role in ('current','previous'):
        metrics=plan['program']['required'][role]
        if not metrics:continue
        period=plan['period'] if role=='current' else plan['comparison']
        sub={**plan,'metrics':metrics,'period':period,'comparison':None}
        sub.pop('program',None)
        for task in providers._legacy_tasks(sub,store):
            result.append({**task,'role':role})
    from scalar_runtime import MATRIX
    for recipe,definition in MATRIX.recipes.items():
        if not definition['paired_periods']:continue
        current=next((t for t in result if t['recipe']==recipe and t['role']=='current'),None)
        previous=next((t for t in result if t['recipe']==recipe and t['role']=='previous'),None)
        if current and previous:
            current['_select_current']=list(current['metrics'])
            current['_select_previous']=list(previous['metrics'])
            current['metrics']=sorted(set(current['metrics'])|set(previous['metrics']))
            current['comparison']=previous['period'];result.remove(previous)
    return result


def unit_text(dim,style,currency):
    if style=='percent':return ' процентов'
    if style=='percentage_points':return ' процентных пункта'
    if dim[0]:
        unit=currency or 'в валюте кабинета, код валюты не подтвержден'
        if dim[0]!=1:unit+='^'+str(dim[0])
        if dim[1]<0:unit+='/товар'+('^'+str(-dim[1]) if dim[1]<-1 else '')
        if dim[2]<0:unit+='/день'
        return ' '+unit
    return ''


def render(plan,completed,fetched_at):
    import providers
    if not validate_compiled(plan):raise Rejected('COMPILED_PLAN_INVALID')
    program=plan['program'];required=program['required']
    leaves=sorted(set(required['current'])|set(required['previous']))
    if len(completed)!=len(plan['stores']):raise Rejected('INCOMPLETE_RESULT')
    for store,result in zip(plan['stores'],completed):
        if result.get('complete') is not True or result.get('store_id')!=store['id']:raise Rejected('INCOMPLETE_RESULT')
        for role,bucket in (('current','values'),('previous','previous_values')):
            if set(result.get(bucket,{}))!=set(required[role]):raise Rejected('INCOMPLETE_RESULT' if role=='current' else 'INCOMPLETE_COMPARISON')
            for m in required[role]:providers.metric_number(m,result[bucket][m])
        if store['currency'] is not None and result['currency'] is not None and store['currency']!=result['currency']:raise Rejected('SOURCE_CURRENCY_MISMATCH')
    periods={'current':plan['period'],'previous':plan.get('comparison')}
    lines=['Текущий снимок, не исторический отчёт.'] if plan.get('snapshot') else [f"С {plan['period']['from']} по {plan['period']['to']}."]
    if plan.get('comparison'):lines.append(f"Сравнение с {plan['comparison']['from']} по {plan['comparison']['to']}.")
    if plan.get('filters'):lines.append('С учётом заданного фильтра товаров WB.')
    groups={}
    for store,result in zip(plan['stores'],completed):
        key='total' if plan['group_by']=='total' else store['platform']
        groups.setdefault(key,[]).append(result)
    node_by_id={n['id']:n for n in program['nodes']}
    outputs={o['node']:o for o in program['outputs']}
    ast_by_id={}
    def index_expr(e):
        ast_by_id[hash_value(e)]=e
        for child in e.get('args',[]):index_expr(child)
    for e in program['asts']:index_expr(e)
    for group,results in sorted(groups.items()):
        currencies={r['currency'] for r in results}
        money=any(DEFINITIONS[m]['unit'] in ('currency','source_currency') for m in leaves)
        if money and (len(currencies)>1 or (None in currencies and (len(results)>1 or program['requires_confirmed_currency']))):raise Rejected('CURRENCY_UNCONFIRMED')
        currency=next(iter(currencies)) if len(currencies)==1 else None
        values={}
        for role,bucket in (('current','values'),('previous','previous_values')):
            values[role]={m:providers.amount(sum((providers.metric_number(m,r[bucket][m]) for r in results),Decimal(0))) for m in required[role]}
        computed=evaluate(program,values,periods)
        label={'ozon':'Озон','wb':'Вайлдберриз','total':'Итого'}[group]
        consumed=set()
        # Formatting is generic: any expression + the same expression in another period + its delta.
        for o in program['outputs']:
            n=node_by_id[o['node']]
            if n.get('op') not in ('subtract','relative_change'):continue
            a,b=n['args'];an,bn=node_by_id[a],node_by_id[b]
            # Compiler already guaranteed cross-period semantic comparability.
            a_expr=ast_by_id.get(a);b_expr=ast_by_id.get(b)
            def roles(expr):
                if 'metric' in expr:return {expr['period']}
                return set().union(*(roles(x) for x in expr['args']))
            if a_expr is None or b_expr is None or roles(a_expr)!={'current'} or roles(b_expr)!={'previous'}:continue
            def descriptor(identity,expression):
                if identity in outputs:return outputs[identity]
                return compile_program([expression],{'period':plan['period'],'comparison':plan.get('comparison')},program['catalog_pin'])['outputs'][0]
            ao=descriptor(a,a_expr);bo=descriptor(b,b_expr)
            suffix=unit_text(ao['dim'],ao['style'],currency)
            def shown(v):return providers.displayed(v)+suffix if v is not None else 'не определено: знаменатель равен нулю'
            text=label+': '+ao['label']+' '+shown(computed[a])+'; ранее '+shown(computed[b])
            diff=computed[n['id']]
            if diff is not None:text+=('; относительное изменение ' if n['op']=='relative_change' else '; изменение ')+('+' if diff>0 else '')+providers.displayed(diff)+unit_text(o['dim'],o['style'],currency)
            lines.append(text+'.');consumed.update((a,b,n['id']))
        for o in program['outputs']:
            if o['node'] in consumed:continue
            value=computed[o['node']]
            shown=providers.displayed(value)+unit_text(o['dim'],o['style'],currency) if value is not None else 'не определён: знаменатель равен нулю'
            lines.append(label+': '+o['label']+' '+shown+'.')
    if any('cohort' in m for m in leaves):lines.append('Выкупы и отмены относятся к заказам выбранного периода, не к дате выкупа или отмены.')
    if any(o['name']=='drr_ordered' for o in program['outputs']):lines.append('База ДРР — сумма заказов, не выкупы и не рекламно-атрибутированные продажи.')
    if any(DEFINITIONS[m]['source']=='ads' for m in leaves):lines.append('Рекламные расходы — данные расходного API; не пополнение счёта.')
    if any(DEFINITIONS[m]['source']=='finance' for m in leaves):
        lines.append('Финансовые данные относятся к датам отчётов. Это не сумма заказов и не прибыль; корректировки могут быть отрицательными.')
        if any(s['platform']=='ozon' for s in plan['stores']):
            if 'finance_logistics_cost' in leaves:lines.append('Логистика Ozon: прямая и обратная доставка; прочие услуги отдельно.')
            if 'finance_storage_cost' in leaves:lines.append('Хранение Ozon: размещение на складах и временное размещение у агента.')
    if any(DEFINITIONS[m]['source']=='stocks' for m in leaves):lines.append('Остатки склада площадки не включают FBS продавца. В Ozon present и reserved показаны отдельно, без вычитания одного из другого.')
    notes=[]
    for metric in leaves:
        for note in DEFINITIONS[metric].get('notes',[]):
            if note not in notes:notes.append(note)
    lines.extend(notes)
    lines.append('Проверочные цифры API, пока без сверки с кабинетом. Получено '+fetched_at+'.')
    pages=[];page=''
    for line in lines:
        if len(line)>800:raise Rejected('VOICE_LINE_TOO_LONG')
        if len(page)+len(line)+1>800:pages.append(page.strip());page=''
        page+=line+' '
    if page:pages.append(page.strip())
    for i in range(len(pages)-1):pages[i]+=' Скажите: дальше.'
    return {'complete':True,'pages':pages,'data':completed,'fetched_at':fetched_at}
