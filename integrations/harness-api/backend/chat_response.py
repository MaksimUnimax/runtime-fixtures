"""A compact chat view of validated handler results, without answer generation."""
from collections import OrderedDict
from decimal import Decimal, ROUND_HALF_UP, localcontext
import json


def distinct(lines):
    return list(dict.fromkeys(line.strip() for line in lines if isinstance(line, str) and line.strip()))


def day(value):
    pieces = str(value).split('-')
    return '.'.join(reversed(pieces)) if len(pieces) == 3 else str(value)


def heading(plan, data, names):
    stores = plan.get('stores') or []
    labels = [names.get(store['id'], {'ozon': 'Ozon', 'wb': 'Wildberries'}.get(store.get('platform'), 'Магазин'))
              for store in stores]
    period = plan.get('period') or (data.get('period') if isinstance(data, dict) else None)
    if isinstance(period, dict) and period.get('from') and period.get('to'):
        label = day(period['from']) if period['from'] == period['to'] else day(period['from']) + ' — ' + day(period['to'])
        labels.append(('снимок на ' if plan.get('snapshot') else '') + label)
    comparison = plan.get('comparison')
    if comparison:
        labels.append('сравнение: ' + day(comparison['from']) + (' — ' + day(comparison['to'])
                      if comparison['from'] != comparison['to'] else ''))
    filters = plan.get('filters') or {}
    for key, value in sorted(filters.items()):
        name = {'brands': 'бренды', 'nm_ids': 'товары WB', 'exclude_nm_ids': 'кроме товаров WB'}.get(key, key)
        labels.append(name + ': ' + ', '.join(str(item) for item in value))
    return ' · '.join(labels)


def render_context(source, data, kind):
    """Display labels are never identities, including duplicate store names."""
    values = {key: source.get(key) for key in ('period', 'comparison', 'filters', 'snapshot',
                                              'snapshot_slot', 'timezone', 'group_by')}
    values['stores'] = [store['id'] for store in source.get('stores') or []]
    values['kind'] = kind
    if not values['period'] and isinstance(data, dict):
        values['period'] = data.get('period')
    # Different non-scalar report definitions do not silently deduplicate
    # identically labelled rows that happen to have the same numeric value.
    for key in ('dataset', 'table', 'parameter_report', 'parameter_source'):
        if source.get(key):
            values[key] = source[key]
    return json.dumps(values, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def table(columns, rows):
    return '\n'.join(['| ' + ' | '.join(columns) + ' |',
                      '| ' + ' | '.join('---' for _ in columns) + ' |'] +
                     ['| ' + ' | '.join(row) + ' |' for row in rows])


def economics_brief(context):
    value = context['economics']
    if value.get('schema') != 'alisa-qualified-economics/v1':
        raise ValueError('DIRECT_ECONOMICS_SCHEMA')
    def money(item):
        if item is None:
            return 'не определено'
        with localcontext() as arithmetic:
            arithmetic.prec = 80
            return format(Decimal(str(item)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP), 'f').replace('.', ',') + ' ₽'
    lines = []
    labels = {'revenue': 'Выручка', 'all_selected_costs': 'Выбранные расходы',
              'remainder_before_owner_inputs': 'Остаток до налогов и собственных расходов',
              'remainder_after_cogs_and_ads': 'Остаток после себестоимости и рекламы'}
    for scenario, result in value['scenarios'].items():
        if len(value['scenarios']) > 1:
            lines.append({'with_loss': 'С учётом потерь', 'without_loss': 'Без потерь'}.get(scenario, scenario))
        for name, label in labels.items():
            if name in result['totals']:
                lines.append(label + ': ' + money(result['totals'][name]))
        if result['owner_inputs_complete']:
            lines.append('После указанных налогов и собственных расходов: ' + money(result['after_declared_owner_inputs']))
        else:
            missing = ', '.join({'tax_amount': 'налоги', 'own_cost_amount': 'собственные расходы'}.get(name, name)
                                for name in result['unknown_owner_inputs'])
            lines.append('Не заданы: ' + missing + '. Они не приняты за ноль.')
    lines.append('Оценка по шаблону, не фактическая чистая прибыль.')
    return lines


def presentation(plan, result_data, fetched_at, compound_context=(), *, store_names=None,
                 full_report_urls=None, template_catalog=None, parameter_definition=None,
                 report_definition=None):
    from direct_response import compound_text, parameter_text
    from calculation_response import supplement
    if template_catalog is None:
        from template_catalog import TEMPLATES as template_catalog
    if parameter_definition is None:
        from parameter_support.parameter_contract import definition as parameter_definition
    if report_definition is None:
        from parameter_support.parameter_report_contract import definition as report_definition
    fragments = plan.get('fragments') or []
    values = result_data.get('templates') if isinstance(result_data, dict) else None
    if not isinstance(values, list) or len(fragments) != len(values):
        raise ValueError('DIRECT_FRAGMENT_COVERAGE')
    if sum(fragment['kind'] == 'parameterized' for fragment in fragments) != len(compound_context):
        raise ValueError('DIRECT_PARAMETER_CONTEXT_COVERAGE')
    contexts, blocks, reports = iter(compound_context), OrderedDict(), []
    names, urls = dict(store_names or {}), full_report_urls or {}
    if len(plan.get('stores') or []) > 1:
        for store in plan['stores']:
            names.setdefault(store['id'], {'ozon': 'Ozon', 'wb': 'Wildberries'}.get(store.get('platform'), 'Магазин')
                             + ' · ' + str(store.get('identity') or store['id']))
        for store in plan['stores']:
            base = (store_names or {}).get(store['id'])
            same = [item for item in plan['stores'] if base and (store_names or {}).get(item['id']) == base]
            if len(same) > 1:
                short = str(store['id'])[-8:]
                if sum(str(item['id'])[-8:] == short for item in same) > 1:
                    short = str(store['id'])
                names[store['id']] = base + ' · ' + {'ozon': 'Ozon', 'wb': 'Wildberries'}.get(store.get('platform'), 'Магазин') + ' · ' + short
    for fragment, item in zip(fragments, values):
        if fragment['template_ids'] != item.get('template_ids'):
            raise ValueError('DIRECT_FRAGMENT_IDENTITY')
        data, kind, source = item['data'], fragment['kind'], fragment.get('plan') or {}
        label = heading(source, data, names)
        brief, detail, notes = [], [], []
        report_url = urls.get(fragment.get('id'))
        if report_url:
            reports.append({'id': fragment.get('id'), 'label': label or 'Полный результат', 'url': report_url})
        if kind in ('scalar', 'event'):
            if kind == 'scalar':
                from scalar_response import render
            else:
                from event_response import render
            rendered = render(source, data, fetched_at)
            if rendered.get('complete') is not True:
                raise ValueError('DIRECT_RESULT_INCOMPLETE')
            brief.extend(rendered['pages'])
            detail.extend(rendered['pages'])
            notes = rendered.get('notes') or []
            additional = supplement(fragment, data, template_catalog=template_catalog)
            brief.extend(additional)
            detail.extend(additional)
            # Semantic basis and unknown values affect interpretation and stay
            # beside the figures; only source/definition detail is collapsible.
            brief.extend(rendered.get('caveats', notes))
        elif kind == 'dataset':
            from dataset_response import render
            rendered = render(source, data, fetched_at, full_report_url=report_url, include_context=False)
            additional = supplement(fragment, data, template_catalog=template_catalog)
            brief.extend(additional[:8])
            if len(additional) > 8:
                brief.append(f'Ещё {len(additional) - 8} строк расчёта — в подробностях.')
            if not additional:
                for sheet in rendered['tables']:
                    if not sheet['rows']:
                        brief.append('В полной выборке нет строк. Отсутствие статистики не заменено нулём.')
                    else:
                        brief.append(table(sheet['columns'], sheet['rows'][:8]))
                        if sheet['total'] > 8:
                            brief.append(f'Показаны 8 из {sheet["total"]} строк. Остальные — в подробностях и полном отчёте.')
            detail.extend(additional[:200] if report_url else additional)
            if len(additional) > 200 and report_url:
                detail.append(f'Показаны 200 из {len(additional)} строк расчёта. Все исходные строки — в полном отчёте.')
            detail.extend(rendered['pages'])
            notes = rendered.get('notes') or []
            if notes:
                brief.append(notes[0])
            if rendered.get('enrichment_complete') is False:
                brief.append('Для части строк метка оплаты неизвестна; эти строки сохранены отдельно, а не отнесены к оплате без карты.')
        elif kind == 'parameter':
            without_period = {key: value for key, value in data.items() if key != 'period'}
            brief.append(parameter_text(without_period, parameter_definition(data['parameter'])))
            detail.extend(brief)
        elif kind == 'parameterized':
            template_id = source['parameter_report']['template_id']
            context = next(contexts)
            if context.get('template_id') != template_id:
                raise ValueError('DIRECT_PARAMETER_CONTEXT_MISSING')
            definitions = report_definition(template_id).get('outputs', {})
            text = compound_text(context, definitions)
            detail.append(text)
            brief.extend(economics_brief(context) if 'economics' in context else [text])
        elif kind == 'information':
            available = distinct([entry['purpose'] for entry in data.get('capabilities', []) if entry.get('available_stores')])
            brief.append('Доступные вопросы:\n' + '\n'.join('• ' + line for line in available[:8]))
            if len(available) > 8:
                brief.append(f'Всего {len(available)} вариантов; полный список — в подробностях.')
            detail.append('\n'.join('• ' + line for line in available))
        else:
            raise ValueError('DIRECT_FRAGMENT_KIND')
        key = render_context(source, data, kind)
        block = blocks.setdefault(key, {'label': label, 'brief': [], 'detail': []})
        block['brief'].extend(brief)
        block['detail'].extend(detail + notes)
    if any(fragment['kind'] == 'scalar' and (fragment.get('plan') or {}).get('group_by') == 'total' for fragment in fragments):
        from total_response import append_totals
        from scalar_response import render
        totals = append_totals(plan, result_data, store_names=names, fetched_at=fetched_at, renderer=render)
        if totals:
            blocks['totals'] = {'label': '', 'brief': totals, 'detail': totals}
    def joined(key):
        return '\n\n'.join((block['label'] + '\n' if block['label'] else '') + '\n'.join(distinct(block[key]))
                           for block in blocks.values() if distinct(block[key]))
    summary, details = joined('brief'), joined('detail')
    if not summary:
        raise ValueError('DIRECT_EMPTY_RESULT')
    if fetched_at:
        details += '\n\nДанные источника получены: ' + str(fetched_at) + '.'
    return {'schema': 'octoport-chat-presentation/v1', 'summary': summary, 'details': details,
            'report_urls': reports}
