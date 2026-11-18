"""Chat output from the existing matrix renderers, with no final LLM call."""
import json
import re
from decimal import Decimal, ROUND_HALF_UP, localcontext


def clean_pages(pages):
    # These are voice navigation cues. All facts, qualifications and figures
    # supplied by the original renderer remain intact.
    return [re.sub(r'\s*Скажите:\s*дальше\.?\s*$', '', str(page)).strip()
            for page in pages if str(page).strip()]


def parameter_text(result, definition):
    label = definition.get('label') or definition.get('title') or result['parameter']
    units = {'ratio': ' (доля)', 'percent': '%', 'rub': ' ₽', 'RUB': ' ₽',
             'rub_per_unit': ' ₽/шт.', 'RUB/ordered_unit': ' ₽ на заказанную единицу',
             'units': ' шт.', 'count': ' шт.'}
    unit = result.get('unit', '')
    value = str(result['value']).replace('.', ',')
    period = result.get('period', {})
    text = f"{label}: {value}{units.get(unit, ' ' + unit if unit else '')}."
    if isinstance(period, dict) and period.get('from') and period.get('to'):
        text += f" Период: {period['from']} — {period['to']}."
    return text


def compound_text(context, definitions=None):
    """Show registered calculated outputs; never invent a profit calculation."""
    if 'estimates' in context:
        definitions = definitions or {}
        lines = []
        for name, item in context['estimates'].items():
            definition = definitions.get(name, {})
            label = definition.get('label') or definition.get('title') or name
            value = str(item['value']).replace('.', ',')
            unit = item.get('unit', '')
            suffix = {'RUB': ' ₽', 'rub': ' ₽', 'units': ' шт.', 'ratio': ' (доля)'}.get(unit, ' ' + unit)
            lines.append(f'{label}: {value}{suffix}.')
        if context.get('not_profit'):
            lines.append('Расчёт по выбранным коэффициентам; это не чистая прибыль.')
        return '\n'.join(lines)
    if 'economics' in context:
        value = context['economics']
        if value.get('schema') != 'alisa-qualified-economics/v1':
            raise ValueError('DIRECT_ECONOMICS_SCHEMA')
        labels = {
            'original_units': 'Исходно заказано единиц', 'expected_retained_units': 'Ожидается оставшихся у покупателей единиц',
            'original_turnover': 'Исходная сумма заказов', 'revenue': 'Расчётная выручка',
            'commission': 'Комиссия', 'acquiring': 'Эквайринг', 'forward_last': 'Прямая и последняя доставка',
            'reverse': 'Обратная доставка', 'processing': 'Обработка', 'other': 'Прочие выбранные расходы',
            'cogs': 'Себестоимость', 'storage': 'Хранение', 'advertising': 'Реклама',
            'all_selected_costs': 'Все выбранные расходы',
            'remainder_before_owner_inputs': 'Остаток до налогов и собственных расходов',
            'remainder_after_cogs_and_ads': 'Остаток после себестоимости и рекламы', 'drr_percent': 'ДРР'}
        owner_labels = {'tax_amount': 'налоги', 'own_cost_amount': 'собственные расходы'}
        def number(item):
            if item is None:
                return 'не определено'
            with localcontext() as ctx:
                ctx.prec = 80
                return format(Decimal(str(item)).quantize(Decimal('.01'), rounding=ROUND_HALF_UP), 'f').replace('.', ',')
        lines = ['Расчёт экономики по шаблону. Это оценка остатка, а не фактическая чистая прибыль.']
        for scenario, result in value['scenarios'].items():
            lines.append('\n' + {'with_loss': 'С учётом потерь', 'without_loss': 'Без потерь'}.get(scenario, scenario) + ':')
            for name, item in result['totals'].items():
                unit = ' %' if name == 'drr_percent' else ' шт.' if name.endswith('_units') else ' ₽'
                lines.append(f"{labels.get(name, name)}: {number(item)}{unit if item is not None else ''}.")
            if result['owner_inputs_complete']:
                lines.append('После указанных налогов и собственных расходов: ' + number(result['after_declared_owner_inputs']) + ' ₽.')
            else:
                missing = ', '.join(owner_labels.get(name, name) for name in result['unknown_owner_inputs'])
                lines.append('Итог после всех собственных расходов не рассчитан: ' + missing + ' не заданы числом. Они не приняты за ноль.')
            lines.append('На исходно заказанную единицу:')
            for name, item in result.get('per_original_unit', {}).items():
                lines.append(f"{labels.get(name, name)}: {number(item)}{' ₽/шт.' if item is not None else ''}.")
        lines.append('Расходы периода распределены на выбранную когорту заказов. Суммы округлены до копеек только для отображения.')
        return '\n'.join(lines)
    raise ValueError('DIRECT_COMPOUND_RESULT')


def render_fragments(plan, result_data, fetched_at, compound_context=(), *,
                     provider_render=None, template_catalog=None,
                     parameter_definition=None, report_definition=None, store_names=None,
                     full_report_urls=None):
    if provider_render is None:
        from providers import render as provider_render
    if template_catalog is None:
        from template_catalog import TEMPLATES as template_catalog
    if parameter_definition is None:
        from parameter_support.parameter_contract import definition as parameter_definition
    if report_definition is None:
        from parameter_support.parameter_report_contract import definition as report_definition
    fragments = plan.get('fragments', [])
    values = result_data.get('templates', []) if isinstance(result_data, dict) else []
    if len(fragments) != len(values):
        raise ValueError('DIRECT_FRAGMENT_COVERAGE')
    pages = []
    parameterized = [fragment for fragment in fragments if fragment['kind'] == 'parameterized']
    if len(parameterized) != len(compound_context):
        raise ValueError('DIRECT_PARAMETER_CONTEXT_COVERAGE')
    # prepare_answer emits contexts in marker/fragment order. The same
    # template can run for different stores and periods in one question.
    contexts = iter(compound_context)
    for fragment, value in zip(fragments, values):
        if fragment['template_ids'] != value.get('template_ids'):
            raise ValueError('DIRECT_FRAGMENT_IDENTITY')
        kind, data = fragment['kind'], value['data']
        full_report_url = (full_report_urls or {}).get(fragment.get('id'))
        subplan = fragment.get('plan') or {}
        stores = subplan.get('stores', [])
        names = store_names or {}
        if stores:
            heading = ', '.join(names.get(store['id'],
                {'ozon': 'Ozon', 'wb': 'Wildberries'}.get(store.get('platform'), 'Магазин') +
                (' · ' + str(store.get('identity')) if len(plan.get('stores', [])) > 1 else '')) for store in stores)
            period = subplan.get('period')
            if isinstance(period, dict) and period.get('from') and period.get('to'):
                heading += f" · {period['from']} — {period['to']}"
            pages.append(heading)
        if kind in ('scalar', 'dataset', 'event'):
            if kind == 'dataset':
                from dataset_response import render as render_dataset
                rendered = render_dataset(fragment['plan'], data, fetched_at, full_report_url=full_report_url)
            else:
                rendered = provider_render(fragment['plan'], data, fetched_at)
            if rendered.get('complete') is not True:
                raise ValueError('DIRECT_RESULT_INCOMPLETE')
            pages.extend(clean_pages(rendered['pages']))
            from calculation_response import supplement
            additional = supplement(fragment, data, template_catalog=template_catalog)
            if len(additional) > 200 and full_report_url:
                pages.extend(additional[:200])
                pages.append(f'Показаны первые 200 из {len(additional)} строк расчёта. [Полный результат]({full_report_url}).')
            else:
                pages.extend(additional)
        elif kind == 'information':
            rows = data.get('capabilities', [])
            # Current discovery data includes availability; only list templates
            # actually usable by the authenticated account.
            lines = [r['purpose'] for r in rows if r.get('available_stores')]
            pages.append('Доступные вопросы и показатели:\n' + '\n'.join('• ' + line for line in lines))
        elif kind == 'parameter':
            pages.append(parameter_text(data, parameter_definition(data['parameter'])))
        elif kind == 'parameterized':
            tid = fragment['plan']['parameter_report']['template_id']
            context = next(contexts)
            if context.get('template_id') != tid:
                raise ValueError('DIRECT_PARAMETER_CONTEXT_MISSING')
            definitions = report_definition(tid).get('outputs', {})
            pages.append(compound_text(context, definitions))
        else:
            raise ValueError('DIRECT_FRAGMENT_KIND')
    if any(fragment['kind'] == 'scalar' and (fragment.get('plan') or {}).get('group_by') == 'total'
           for fragment in fragments):
        from total_response import append_totals
        pages.extend(append_totals(plan, result_data, store_names=store_names, fetched_at=fetched_at))
    if not pages:
        raise ValueError('DIRECT_EMPTY_RESULT')
    return pages


def answer_step(worker, row, plan, progress):
    """Replacement hook in the dedicated gateway process only."""
    from semantics import Rejected
    from model_answer import PENDING
    from parameter_report_runtime import prepare_answer, fence_answer
    pending = progress[PENDING]
    from provider_failure import notice_authorized
    def authorized():
        return notice_authorized(worker.engine, row) if pending.get('permission_notice') else worker.engine.authorized(plan)
    if not authorized():
        raise Rejected('SOURCE_ACCESS')
    if pending.get('permission_notice') or pending.get('failure_code'):
        from failure_explanations import explain
        code = pending.get('failure_code', 'SOURCE_ACCESS')
        failure = pending.get('provider_error') or {}
        pages = [failure.get('message') or explain(code)['text']]
        chat = {'schema': 'octoport-chat-presentation/v1', 'summary': pages[0],
                'details': pages[0], 'report_urls': []}
        fences = []
    else:
        contexts, fences = prepare_answer(worker, row, plan, progress)
        if contexts is None:
            return
        names = getattr(worker.engine, 'harness_store_names', lambda _plan: {})(plan)
        urls = getattr(worker.engine, 'harness_report_urls', lambda _row, _plan: {})(row, plan)
        from chat_response import presentation
        chat = presentation(plan, pending.get('data'), pending['fetched_at'], contexts,
                            store_names=names, full_report_urls=urls)
        pages = [chat['summary']]
    if not fence_answer(worker, row, progress, fences):
        return
    if not authorized():
        raise Rejected('SOURCE_ACCESS')
    result = dict(pending, complete=True, pages=pages, response_mode='matrix_chat_v2', chat_presentation=chat)
    from model_usage import finish_request
    with worker.repo.connection(True):
        finish_request(worker.repo, row)
        worker.repo.complete_answer(row['id'], row['owner'], result)
