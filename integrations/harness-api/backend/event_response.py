"""Chat formatting over the native event grouping and source validation rules."""
from datetime import date
from decimal import Decimal
import re


def render(plan, completed, stamp):
    from table_analytics import valid, fail, CATALOG, num, group_rows
    from semantics import canonical_json
    from providers import displayed
    if not valid(plan) or not isinstance(completed, list) or len(completed) != len(plan['stores']):
        fail('TABLE_INCOMPLETE')
    if len(canonical_json(completed).encode()) > CATALOG['max_bytes']:
        fail('TABLE_CAPACITY')
    table, groups = plan['table'], {}
    if table['family'] != 'events':
        fail('DIRECT_EVENT_FAMILY')
    # The registered event templates and native admission parser both refuse
    # event-period comparisons; there is no qualified alignment of event dates.
    if plan.get('comparison'):
        fail('EVENT_COMPARISON_NOT_QUALIFIED')
    for store, block in zip(plan['stores'], completed):
        if (not isinstance(block, dict) or block.get('store_id') != store['id']
                or block.get('complete') is not True or not isinstance(block.get('current'), list)):
            fail('TABLE_INCOMPLETE')
        for role, period in [('current', plan['period'])]:
            checked = set()
            if len(block[role]) > CATALOG['max_rows']:
                fail('TABLE_CAPACITY')
            for row in block[role]:
                key = row.get('key')
                if not isinstance(key, str) or not key or key in checked:
                    fail('ROW_DUPLICATE_OR_ID')
                checked.add(key)
                if row.get('kind') not in ('S', 'R') or not re.fullmatch(r'[1-9]\d{0,18}', str(row.get('product', ''))):
                    fail('EVENT_ID_DUPLICATE_OR_TYPE')
                day = date.fromisoformat(row['day']).isoformat()
                if not period['from'] <= day <= period['to']:
                    fail('ROW_PERIOD')
                if (num(row['units'], True), num(row['return_units'], True)) != ((Decimal(1), Decimal(0))
                        if row['kind'] == 'S' else (Decimal(0), Decimal(1))):
                    fail('EVENT_KIND_COUNTS')
                if row.get('revenue') is not None:
                    num(row['revenue'])
        if (block.get('currency') not in ('RUB', 'BYN', 'KZT', 'AMD', 'KGS', 'UZS', 'CNY', 'USD', 'EUR')
                or (store['currency'] is not None and block['currency'] != store['currency'])):
            fail('TABLE_CURRENCY_CHANGED')
        label = 'total' if plan['group_by'] == 'total' else store['platform']
        group = groups.setdefault(label, {'currency': block['currency'], 'current': [], 'previous': []})
        if group['currency'] != block['currency']:
            fail('TABLE_CURRENCY_CHANGED')
        group['current'].extend(block['current'])
        group['previous'].extend(block.get('previous', []))
    lines = []
    for _, block in sorted(groups.items()):
        current = group_rows(block['current'], plan)
        rows = list(current.values())
        if table['top'] and table['sort'] == 'revenue' and any(not row['money_complete'] for row in rows):
            fail('EVENT_AMOUNTS_NOT_READY')
        rows.sort(key=(lambda row: ((-row[table['sort']] if table['direction'] == 'desc' else row[table['sort']]), row['key']))
                  if table['view'] == 'items' else lambda row: row['key'])
        full = len(rows)
        if table['top']:
            rows = rows[:table['top']]
            lines.append(f'Топ {len(rows)} из {full} товаров.')
        for row in rows:
            label = '' if table['view'] == 'totals' else row['key'] + ': '
            unit = '₽' if block['currency'] == 'RUB' else block['currency']
            text = label + 'Выкуплено: ' + displayed(row['units']) + ' шт.'
            text += (' · ' + displayed(row['revenue']) + ' ' + unit if row['money_complete']
                     else ' · сумма ещё заполняется источником')
            text += '\nВозвраты: ' + displayed(row['return_units']) + ' шт.'
            if row['money_complete']:
                text += ' · ' + displayed(row['return_revenue']) + ' ' + unit
            lines.append(text)
        if not rows:
            lines.append('В полной выборке нет строк, соответствующих фильтру.')
    notes = ['По дате продажи. Оперативные данные WB могут дополняться; возвраты учтены отдельно.',
             'Сумма — цена продавца со скидкой, не выплата и не бухгалтерский итог. '
             'Неоплаченные и некоторые рассроченные покупки могут отсутствовать.']
    if table['view'] == 'weeks':
        notes.append('Недели начинаются в понедельник; крайние недели ограничены выбранными датами.')
    caveats = ['По дате продажи; предварительные данные WB. Сумма по цене продавца со скидкой, не выплата.']
    return {'complete': True, 'pages': lines, 'notes': notes, 'caveats': caveats,
            'data': completed, 'fetched_at': stamp}
