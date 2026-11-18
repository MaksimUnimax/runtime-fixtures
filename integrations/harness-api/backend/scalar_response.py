"""Compact chat projection of the installed, checked scalar program.

Acquisition, metric validation and expression evaluation stay in Alisa. This
module owns presentation only; it has no voice pagination or model invocation.
The outer response supplies the store names and requested period.
"""
from decimal import Decimal


def _unit(dim, style, currency):
    if style == 'percent':
        return '%'
    if style == 'percentage_points':
        return ' п.п.'
    money = '₽' if currency == 'RUB' else currency
    if dim[0] and not money:
        money = 'валюта кабинета (код не подтверждён)'
    above, below = [], []
    for name, power in zip((money, 'шт.', 'день'), dim):
        if not power:
            continue
        part = name + (f'^{abs(power)}' if abs(power) != 1 else '')
        (above if power > 0 else below).append(part)
    if not above and not below:
        return ''
    value = '·'.join(above) if above else '1'
    if below:
        denominator = '·'.join(below)
        value += '/' + (f'({denominator})' if len(below) > 1 else denominator)
    return ' ' + value


def _shown(value, output, currency, *, signed=False):
    if value is None:
        return 'не определено (нулевой знаменатель)'
    from providers import displayed
    number = displayed(value).replace('.', ',')
    return ('+' if signed and value > 0 else '') + number + _unit(output['dim'], output['style'], currency)


def _roles(expression):
    if 'metric' in expression:
        return {expression['period']}
    return set().union(*(_roles(child) for child in expression['args']))


def _notes(plan, program, leaves):
    from registry import DEFINITIONS
    notes = []
    if plan.get('snapshot'):
        notes.append('Текущий снимок, не исторический отчёт.')
    if plan.get('filters'):
        notes.append('Учтён заданный фильтр товаров WB.')
    if any('cohort' in metric for metric in leaves):
        notes.append('Выкупы и отмены относятся к заказам выбранного периода, не к дате выкупа или отмены.')
    by_id = {node['id']: node for node in program['nodes']}
    if any(node.get('op') == 'percent'
           and [by_id[item].get('metric') for item in node['args']] == ['ad_spend', 'ordered_revenue']
           for node in program['nodes']):
        notes.append('База ДРР — сумма заказов, не выкупы и не рекламно-атрибутированные продажи.')
    if any(DEFINITIONS[metric]['source'] == 'ads' for metric in leaves):
        notes.append('Рекламные расходы — данные расходного API; не пополнение счёта.')
    if any(DEFINITIONS[metric]['source'] == 'finance' for metric in leaves):
        notes.append('Финансовые данные относятся к датам отчётов. Это не сумма заказов и не прибыль; корректировки могут быть отрицательными.')
        if any(store['platform'] == 'ozon' for store in plan['stores']):
            if 'finance_logistics_cost' in leaves:
                notes.append('Логистика Ozon: прямая и обратная доставка; прочие услуги отдельно.')
            if 'finance_storage_cost' in leaves:
                notes.append('Хранение Ozon: размещение на складах и временное размещение у агента.')
    if any(DEFINITIONS[metric]['source'] == 'stocks' for metric in leaves):
        notes.append('Остатки склада площадки не включают FBS продавца.')
        if any(store['platform'] == 'ozon' for store in plan['stores']):
            notes.append('В Ozon present и reserved показаны отдельно, без вычитания одного из другого.')
    for metric in leaves:
        for note in DEFINITIONS[metric].get('notes', []):
            if note not in notes:
                notes.append(note)
    return notes


def _caveats(plan, program, leaves):
    """Keep interpretation-changing facts short; full source notes are separate."""
    from registry import DEFINITIONS
    sources = {DEFINITIONS[metric]['source'] for metric in leaves}
    caveats = []
    if plan.get('snapshot'):
        caveats.append('Текущий снимок.')
    if plan.get('filters'):
        caveats.append('Учтён фильтр товаров.')
    if any('cohort' in metric for metric in leaves):
        caveats.append('Выкупы и отмены относятся к заказам этого периода.')
    nodes = {node['id']: node for node in program['nodes']}
    if any(node.get('op') == 'percent'
           and [nodes[item].get('metric') for item in node['args']] == ['ad_spend', 'ordered_revenue']
           for node in program['nodes']):
        caveats.append('ДРР рассчитан от суммы заказов.')
    if 'ads' in sources:
        caveats.append('Рекламные расходы не включают пополнения счёта.')
    if 'finance' in sources:
        caveats.append('По датам финансовых отчётов; это не чистая прибыль.')
    if 'stocks' in sources:
        text = 'Остатки площадки и продавца учитываются отдельно.'
        if set(leaves) & {'stock_fbo_reserved', 'stock_fbs_reserved'}:
            text += ' Резерв не вычтен из остатка.'
        caveats.append(text)
    if 'accrual' in sources:
        caveats.append('По дате начисления; суммы товарных строк, не выплата. '
                       'Обратные начисления не означают физический возврат в этот день.')
    # A future registered source note must not silently disappear because its
    # short wording has not yet been reviewed. Current accrual notes are the
    # only registered notes and their material basis is covered just above.
    for metric in leaves:
        if DEFINITIONS[metric]['source'] != 'accrual':
            for note in DEFINITIONS[metric].get('notes', []):
                if note not in caveats:
                    caveats.append(note)
    return caveats


def render(plan, completed, fetched_at):
    """Return concise metric lines and separate material interpretation notes."""
    import providers
    from query_program import validate_compiled, evaluate, compile_program
    from registry import DEFINITIONS
    from semantic_catalog import hash_value
    from semantics import Rejected

    if not validate_compiled(plan):
        raise Rejected('COMPILED_PLAN_INVALID')
    program = plan['program']
    required = program['required']
    leaves = sorted(set(required['current']) | set(required['previous']))
    if not isinstance(completed, list) or len(completed) != len(plan['stores']):
        raise Rejected('INCOMPLETE_RESULT')
    # Same coverage, scalar-number and currency checks as program_providers.
    for store, result in zip(plan['stores'], completed):
        if not isinstance(result, dict) or result.get('complete') is not True or result.get('store_id') != store['id']:
            raise Rejected('INCOMPLETE_RESULT')
        for role, bucket in (('current', 'values'), ('previous', 'previous_values')):
            values = result.get(bucket, {})
            if not isinstance(values, dict) or set(values) != set(required[role]):
                raise Rejected('INCOMPLETE_RESULT' if role == 'current' else 'INCOMPLETE_COMPARISON')
            for metric in required[role]:
                providers.metric_number(metric, values[metric])
        if 'currency' not in result:
            raise Rejected('INCOMPLETE_RESULT')
        if store['currency'] is not None and result['currency'] is not None and store['currency'] != result['currency']:
            raise Rejected('SOURCE_CURRENCY_MISMATCH')
    periods = {'current': plan['period'], 'previous': plan.get('comparison')}
    groups = {}
    for store, result in zip(plan['stores'], completed):
        group = 'total' if plan['group_by'] == 'total' else store['platform']
        groups.setdefault(group, []).append(result)
    nodes = {node['id']: node for node in program['nodes']}
    outputs = {output['node']: output for output in program['outputs']}
    expressions = {}

    def index(expression):
        expressions[hash_value(expression)] = expression
        for child in expression.get('args', []):
            index(child)
    for expression in program['asts']:
        index(expression)

    def descriptor(identity):
        if identity in outputs:
            return outputs[identity]
        return compile_program([expressions[identity]],
            {'period': plan['period'], 'comparison': plan.get('comparison')}, program['catalog_pin'])['outputs'][0]

    # Preserve all requested deltas while showing the same current/previous
    # pair once. The native compiler has already checked comparability.
    comparisons = {}
    for output in program['outputs']:
        node = nodes[output['node']]
        if node.get('op') not in ('subtract', 'relative_change'):
            continue
        current, previous = node['args']
        if (current in expressions and previous in expressions
                and _roles(expressions[current]) == {'current'}
                and _roles(expressions[previous]) == {'previous'}):
            comparisons.setdefault((current, previous), []).append(output)
    pages = []
    money = any(DEFINITIONS[metric]['unit'] in ('currency', 'source_currency') for metric in leaves)
    for group, results in sorted(groups.items()):
        currencies = {result['currency'] for result in results}
        if money and (len(currencies) > 1 or
                (None in currencies and (len(results) > 1 or program['requires_confirmed_currency']))):
            raise Rejected('CURRENCY_UNCONFIRMED')
        currency = next(iter(currencies)) if len(currencies) == 1 else None
        values = {}
        for role, bucket in (('current', 'values'), ('previous', 'previous_values')):
            values[role] = {metric: providers.amount(sum(
                (providers.metric_number(metric, result[bucket][metric]) for result in results), Decimal(0)))
                for metric in required[role]}
        computed = evaluate(program, values, periods)
        prefix = ({'ozon': 'Ozon', 'wb': 'WB', 'total': 'Итого'}[group] + ' · ') if len(groups) > 1 else ''
        consumed = set()
        for (current, previous), changes in comparisons.items():
            base = descriptor(current)
            line = prefix + base['label'] + ': ' + _shown(computed[current], base, currency)
            line += '; ранее ' + _shown(computed[previous], descriptor(previous), currency)
            for change in changes:
                node = nodes[change['node']]
                label = 'относительное изменение' if node['op'] == 'relative_change' else 'изменение'
                line += '; ' + label + ' ' + _shown(computed[change['node']], change, currency, signed=True)
                consumed.add(change['node'])
            pages.append(line)
            consumed.update((current, previous))
        for output in program['outputs']:
            if output['node'] not in consumed:
                pages.append(prefix + output['label'] + ': ' + _shown(computed[output['node']], output, currency))
    return {'complete': True, 'pages': pages, 'data': completed, 'fetched_at': fetched_at,
            'notes': _notes(plan, program, leaves), 'caveats': _caveats(plan, program, leaves)}
