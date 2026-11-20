"""Presentation contracts over actual compiled Alisa plans, synthetic data only."""
from copy import deepcopy
from datetime import date
import os
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
CORE = Path(os.environ.get('ALISA_CORE_ROOT', str(PROJECT.parent / 'harness-reference/core')))
sys.path[:0] = [str(PROJECT / 'backend'), str(CORE)]
from chat_response import presentation
from event_response import render as render_events
from semantics import Rejected, Scope, Store
from test_scalar_response import fixture as scalar_fixture
from test_dataset_response import plan as dataset_plan, data as dataset_data
from test_total_response import fixtures as total_fixtures


def wrapped(source, completed, *, kind='scalar', template='B01.ordered_units'):
    root = {key: source[key] for key in ('tenant', 'access_revision', 'stores')}
    root['fragments'] = [{'id': 'fragment', 'kind': kind, 'template_ids': [template], 'plan': source}]
    return root, {'templates': [{'template_ids': [template], 'data': completed}]}


def event_plan():
    import table_analytics as native
    store = Store('wb', 'wb', 'synthetic-wb', 'access', 'source', 'RUB')
    scope = Scope('tenant', 'revision', (store,))
    caps = {store.id: {operation: {'status': 'READ_ONLY_CANARY', 'table_hash': native.HASH,
                                 'token_class': 'personal', 'evidence_ref': 'synthetic-test'}
                      for operation, spec in native.OPERATIONS.items() if spec['platform'] == 'wb'}}
    draft = native.parse_table('фактические выкупы за вчера на wb', date(2026, 11, 18))
    return native.make_table_plan(scope, draft, caps)


def event_data(*, amount='100', returns=False):
    return [{'store_id': 'wb', 'complete': True, 'currency': 'RUB', 'previous': [], 'current': [
        {'key': 'sale-or-return', 'kind': 'R' if returns else 'S', 'product': '101', 'label': 'Товар',
         'day': '2026-11-17', 'units': '0' if returns else '1',
         'return_units': '1' if returns else '0', 'revenue': amount}]}]


class ChatPresentationTests(unittest.TestCase):
    def test_simple_order_answer_is_short_with_one_store_and_period(self):
        source, values = scalar_fixture(['ordered_units'], [{'ordered_units': '17'}], group_by='marketplace')
        root, completed = wrapped(source, values)
        result = presentation(root, completed, '2026-11-18T12:00:00Z', store_names={'s0': 'Мой магазин'})
        self.assertEqual(result['schema'], 'octoport-chat-presentation/v1')
        self.assertIn('17 шт.', result['summary'])
        self.assertLess(len(result['summary']), 100)
        self.assertEqual(result['summary'].count('17.11.2026'), 1)
        self.assertEqual(result['summary'].count('Мой магазин'), 1)
        for voice in ('Скажите', 'Получено', 'Проверочные цифры', 'Итого:', 'Данные источника получены'):
            self.assertNotIn(voice, result['summary'])
        self.assertIn('2026-11-18T12:00:00Z', result['details'])

    def test_same_store_period_has_one_heading_for_multiple_fragments(self):
        first, one = scalar_fixture(['ordered_units'], [{'ordered_units': '17'}], group_by='marketplace')
        second, two = scalar_fixture(['ordered_revenue'], [{'ordered_revenue': '1234'}], group_by='marketplace')
        root, data = wrapped(first, one)
        root['fragments'].append({'id': 'other', 'kind': 'scalar', 'template_ids': ['B01.ordered_revenue'], 'plan': second})
        data['templates'].append({'template_ids': ['B01.ordered_revenue'], 'data': two})
        result = presentation(root, data, 'stamp', store_names={'s0': 'Мой магазин'})
        self.assertEqual(result['summary'].count('Мой магазин'), 1)
        self.assertEqual(result['summary'].count('17.11.2026'), 1)
        self.assertIn('17 шт.', result['summary'])
        self.assertIn('1234 ₽', result['summary'])

    def test_dataset_count_is_brief_and_all_rows_remain_available(self):
        source = dataset_plan('product_registry')
        values = dataset_data({'rows': [{'key': str(i), 'product_id': str(i), 'offer_id': str(i)} for i in range(1, 151)]})
        root, data = wrapped(source, values, kind='dataset', template='product_registry')
        url = '/harness/api/reports/synthetic/fragment'
        result = presentation(root, data, 'stamp', full_report_urls={'fragment': url})
        self.assertIn('150', result['summary'])
        self.assertNotIn('|', result['summary'])
        self.assertIn('не число активных карточек', result['summary'])
        self.assertIn('показано 100 из 150', result['details'])
        self.assertEqual(result['report_urls'][0]['url'], url)
        self.assertEqual(len(data['templates'][0]['data'][0]['datasets']['rows']), 150)

    def test_dataset_incomplete_payment_enrichment_is_visible_in_summary(self):
        source = dataset_plan('realization_payment_totals')
        values = dataset_data({'target': [{'key': 't', 'posting_key': None, 'product_id': '11',
            'sale_units': '1', 'sale_amount': '0', 'seller_amount': '40'}], 'fbo': [], 'fbs': []})
        root, data = wrapped(source, values, kind='dataset', template='realization_payment_totals')
        result = presentation(root, data, 'stamp')
        self.assertIn('неизвестно', result['summary'])
        self.assertIn('не отнесены к оплате без карты', result['summary'])
        self.assertIn('| 0 |', result['summary'])
        self.assertIn('по дате начисления', result['summary'])

    def test_economics_unknown_inputs_and_profit_caveat_stay_brief(self):
        source = {'parameter_report': {'template_id': 'economics'}, 'stores': []}
        root = {'fragments': [{'id': 'e', 'kind': 'parameterized', 'template_ids': ['economics'], 'plan': source}]}
        data = {'templates': [{'template_ids': ['economics'], 'data': {}}]}
        context = {'template_id': 'economics', 'economics': {'schema': 'alisa-qualified-economics/v1', 'scenarios': {
            'with_loss': {'totals': {'revenue': '100', 'all_selected_costs': '75',
                'remainder_before_owner_inputs': '25', 'drr_percent': None},
                'owner_inputs_complete': False, 'unknown_owner_inputs': ['tax_amount'],
                'after_declared_owner_inputs': None, 'per_original_unit': {'revenue': '10'}}}}}
        result = presentation(root, data, 'stamp', [context], report_definition=lambda _key: {})
        self.assertIn('25,00 ₽', result['summary'])
        self.assertIn('Не заданы: налоги', result['summary'])
        self.assertIn('не приняты за ноль', result['summary'])
        self.assertIn('не фактическая чистая прибыль', result['summary'])
        self.assertNotIn('На исходно заказанную единицу', result['summary'])
        self.assertIn('На исходно заказанную единицу', result['details'])

    def test_two_parameterized_contexts_cannot_overwrite_each_other(self):
        root = {'fragments': []}
        data, contexts = {'templates': []}, []
        for index, value in enumerate(('100', '200')):
            root['fragments'].append({'id': str(index), 'kind': 'parameterized', 'template_ids': ['r'],
                'plan': {'parameter_report': {'template_id': 'r'}, 'stores': [{'id': str(index), 'platform': 'ozon'}]}})
            data['templates'].append({'template_ids': ['r'], 'data': {}})
            contexts.append({'template_id': 'r', 'estimates': {'amount': {'value': value, 'unit': 'RUB'}}})
        result = presentation(root, data, 'stamp', contexts, store_names={'0': 'Первый', '1': 'Второй'},
                              report_definition=lambda _key: {'outputs': {'amount': {'label': 'Оценка'}}})
        self.assertIn('Первый\nОценка: 100 ₽', result['summary'])
        self.assertIn('Второй\nОценка: 200 ₽', result['summary'])

    def test_multi_store_total_keeps_native_weighted_rate(self):
        root, data = total_fixtures('drr_ordered', [('ozon', 'RUB', {'ad_spend': '10', 'ordered_revenue': '100'}),
                                                  ('ozon', 'RUB', {'ad_spend': '30', 'ordered_revenue': '900'})])
        result = presentation(root, data, 'stamp', store_names={'s0': 'Первый', 's1': 'Второй'})
        self.assertIn('ДРР от суммы заказов: 4%', result['summary'])
        self.assertNotIn('13,33', result['summary'])
        self.assertNotIn('Скажите', result['summary'])
        self.assertNotIn('Проверочные', result['summary'])

    def test_identically_named_stores_do_not_merge_equal_values(self):
        root, data = total_fixtures('ordered_units', [('ozon', 'RUB', {'ordered_units': '17'}),
                                                    ('ozon', 'RUB', {'ordered_units': '17'})])
        for fragment, value in zip(root['fragments'], data['templates']):
            fragment['template_ids'] = value['template_ids'] = ['B01.ordered_units']
        result = presentation(root, data, 'stamp', store_names={'s0': 'Магазин', 's1': 'Магазин'})
        self.assertIn('Магазин · Ozon · s0\n', result['summary'].replace(' · 17.11.2026', ''))
        self.assertIn('Магазин · Ozon · s1\n', result['summary'].replace(' · 17.11.2026', ''))
        self.assertEqual(result['summary'].count(': 17 шт.'), 2)
        self.assertIn(': 34 шт.', result['summary'])

    def test_distinct_filters_preserve_separate_results_for_same_store(self):
        from query_program import make_composed_plan
        source, values = scalar_fixture(['ordered_units'], [{'ordered_units': '17'}], platform='wb', group_by='marketplace')
        root, data = wrapped(source, values)
        root['fragments'].clear()
        data['templates'].clear()
        for brand in ('Первый', 'Второй'):
            draft = {'period': source['period'], 'comparison': None, 'timezone': 'Europe/Moscow',
                'group_by': 'marketplace', 'filters': {'brands': [brand]}, 'snapshot': False,
                'calendar_date': '2026-11-18', 'platforms': ['wb'], 'question': 'Заказы по бренду'}
            checked = make_composed_plan(Scope(source['tenant'], source['access_revision'],
                                               tuple(Store(**store) for store in source['stores'])), draft, metrics=['ordered_units'])
            root['fragments'].append({'id': brand, 'kind': 'scalar', 'template_ids': ['B01.ordered_units'], 'plan': checked})
            data['templates'].append({'template_ids': ['B01.ordered_units'], 'data': deepcopy(values)})
        result = presentation(root, data, 'stamp', store_names={'s0': 'Магазин'})
        self.assertEqual(result['summary'].count(': 17 шт.'), 2)
        self.assertIn('бренды: Первый', result['summary'])
        self.assertIn('бренды: Второй', result['summary'])


class EventChatTests(unittest.TestCase):
    def test_returns_and_source_date_basis_are_preserved_without_voice(self):
        result = render_events(event_plan(), event_data(returns=True), 'stamp')
        self.assertEqual(result['pages'], ['Выкуплено: 0 шт. · 0 ₽\nВозвраты: 1 шт. · 100 ₽'])
        self.assertIn('По дате продажи', result['caveats'][0])
        self.assertNotIn('Скажите', ' '.join(result['pages']))

    def test_event_unknown_money_is_not_zero(self):
        result = render_events(event_plan(), event_data(amount=None), 'stamp')
        self.assertIn('сумма ещё заполняется', result['pages'][0])
        self.assertNotIn('0 ₽', result['pages'][0])

    def test_event_invalid_store_kind_duplicate_and_comparison_fail_closed(self):
        source = event_plan()
        for changed in ('store', 'duplicate', 'counts', 'currency', 'comparison'):
            plan, data = deepcopy(source), event_data()
            if changed == 'store':
                data[0]['store_id'] = 'other-owner'
            elif changed == 'duplicate':
                data[0]['current'].append(deepcopy(data[0]['current'][0]))
            elif changed == 'counts':
                data[0]['current'][0]['units'] = '5'
            elif changed == 'currency':
                data[0]['currency'] = 'USD'
            else:
                plan['comparison'] = {'from': '2026-11-16', 'to': '2026-11-16'}
            with self.subTest(changed=changed), self.assertRaises(Rejected):
                render_events(plan, data, 'stamp')
