"""Explicit multi-store totals through the original scalar program compiler.

Only fragments already requested with group_by=total are considered. Ratios,
percentages, comparisons, currencies and cross-market financial definitions are
handled by the installed native compiler/renderer, never by adding chat text.
"""
from copy import deepcopy


def append_totals(plan, result_data, *, store_names=None, fetched_at=None, renderer=None):
    from semantics import Rejected, Scope, Store, canonical_json
    from query_program import make_composed_plan
    from providers import render
    if renderer is not None:
        render = renderer

    def need(condition, code):
        if not condition:
            raise Rejected(code)

    fragments = plan.get('fragments', [])
    values = result_data.get('templates', []) if type(result_data) is dict else []
    need(len(fragments) == len(values), 'DIRECT_TOTAL_COVERAGE')
    allowed = {store['id']: store for store in plan.get('stores', [])}
    groups = {}
    selected_stores = set()
    for fragment, value in zip(fragments, values):
        need(value.get('template_ids') == fragment['template_ids'], 'DIRECT_TOTAL_IDENTITY')
        source = fragment.get('plan') or {}
        if fragment['kind'] != 'scalar' or source.get('group_by') != 'total':
            continue
        need(source.get('tenant') == plan.get('tenant')
             and source.get('access_revision') == plan.get('access_revision'), 'DIRECT_TOTAL_SCOPE')
        completed = value.get('data')
        need(type(completed) is list and len(completed) == len(source['stores']), 'DIRECT_TOTAL_COVERAGE')
        for store, block in zip(source['stores'], completed):
            need(allowed.get(store['id']) == store, 'DIRECT_TOTAL_SCOPE')
            need(type(block) is dict and block.get('store_id') == store['id']
                 and block.get('complete') is True, 'DIRECT_TOTAL_COVERAGE')
            selected_stores.add(store['id'])
        # Includes program/catalog pin, every condition, date axis, access
        # revision and runtime guard; only the explicit store list differs.
        signature = canonical_json({key: item for key, item in source.items() if key != 'stores'})
        groups.setdefault(signature, []).append((fragment, completed))
    if len(selected_stores) < 2:
        return []

    if not any(sum(len(fragment['plan']['stores']) for fragment, _ in entries) > 1
               for entries in groups.values()):
        return ['Общий итог не рассчитан: наборы показателей, периоды или условия магазинов различаются.']

    pages = []
    if len(groups) > 1:
        pages.append('Общий итог разделён по совместимым показателям, периодам и условиям. '
                     'Между разными группами значения не складываются.')
    names = store_names or {}
    for entries in groups.values():
        first = entries[0][0]
        original = first['plan']
        stores, results = {}, {}
        for fragment, completed in entries:
            for store, result in zip(fragment['plan']['stores'], completed):
                need(store['id'] not in stores, 'DIRECT_TOTAL_DUPLICATE_STORE')
                stores[store['id']], results[store['id']] = store, result
        if len(stores) < 2:
            continue
        draft = deepcopy(first['draft'])
        draft['platforms'] = sorted({store['platform'] for store in stores.values()})
        draft['catalog_pin'] = deepcopy(original['program']['catalog_pin'])
        scope = Scope(original['tenant'], original['access_revision'],
                      tuple(Store(**store) for store in stores.values()))
        labels = [names.get(store_id, stores[store_id]['platform'] + ' · ' + store_id)
                  for store_id in sorted(stores)]
        pages.append('Общий итог по магазинам: ' + ', '.join(labels) + '.')
        try:
            combined = make_composed_plan(scope, draft, expressions=original['program']['asts'])
        except Rejected as error:
            if error.code not in ('CURRENCY_UNCONFIRMED', 'FINANCIAL_SOURCE_BASIS'):
                raise
            # Keep the valid per-store answers already shown. Refuse only the
            # unsupported aggregate, with the native reason visible to users.
            pages.append('Общий итог не рассчитан. ' + error.message)
            continue
        if 'runtime_guard' in original:
            combined['runtime_guard'] = deepcopy(original['runtime_guard'])
        need(combined['program'] == original['program'], 'DIRECT_TOTAL_PROGRAM_CHANGED')
        need({key: value for key, value in combined.items() if key != 'stores'} ==
             {key: value for key, value in original.items() if key != 'stores'},
             'DIRECT_TOTAL_PLAN_CHANGED')
        # Scope.select also prevents two store records for the same physical
        # account from being counted twice; silently dropping either is refused.
        need({store['id'] for store in combined['stores']} == set(stores), 'DIRECT_TOTAL_STORE_ALIAS')
        stamp = fetched_at or result_data.get('fetched_at') or 'см. результаты магазинов выше'
        rendered = render(combined, [results[store['id']] for store in combined['stores']], stamp)
        need(rendered.get('complete') is True, 'DIRECT_TOTAL_INCOMPLETE')
        for page in rendered['pages']:
            suffix = ' Скажите: дальше.'
            pages.append(page[:-len(suffix)] if page.endswith(suffix) else page)
        pages.extend(rendered.get('notes', []))
    return pages
