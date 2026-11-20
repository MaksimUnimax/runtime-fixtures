"""Compact scalar answers evaluated against the installed Alisa compiler."""
from copy import deepcopy
import os
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
CORE = Path(os.environ.get('ALISA_CORE_ROOT', str(PROJECT.parent / 'harness-reference/core')))
sys.path[:0] = [str(PROJECT / 'backend'), str(CORE)]
from query_program import make_composed_plan
from scalar_response import render
from semantics import Rejected, Scope, Store


def fixture(metrics, measured, *, platform='ozon', comparison=None, previous=None,
            expressions=None, snapshot=False, currencies=None, group_by='total'):
    currencies = currencies or ['RUB'] * len(measured)
    stores = tuple(Store(f's{index}', platform, f'physical-{index}', 'access', 'source', currency)
                   for index, currency in enumerate(currencies))
    draft = {'period': {'from': '2026-11-17', 'to': '2026-11-17'}, 'comparison': comparison,
             'timezone': 'Europe/Moscow', 'group_by': group_by, 'filters': {},
             'snapshot': snapshot, 'calendar_date': '2026-11-18', 'platforms': [platform],
             'question': 'Показатели'}
    if snapshot:
        draft['snapshot_slot'] = '2026-11-18T12:00:00+03:00'
    plan = make_composed_plan(Scope('tenant', 'revision', stores), draft,
                              metrics=metrics, expressions=expressions)
    completed = [{'store_id': store.id, 'complete': True, 'currency': store.currency,
                  'values': values, 'previous_values': (previous or [{}] * len(stores))[index]}
                 for index, (store, values) in enumerate(zip(stores, measured))]
    return plan, completed


class ScalarResponseTests(unittest.TestCase):
    def test_total_ratio_is_recomputed_from_summed_operands(self):
        plan, data = fixture(['drr_ordered'], [
            {'ad_spend': '10', 'ordered_revenue': '100'},
            {'ad_spend': '30', 'ordered_revenue': '900'}])
        result = render(plan, data, 'timestamp')
        self.assertEqual(result['pages'], ['ДРР от суммы заказов: 4%'])
        self.assertIn('База ДРР — сумма заказов', ' '.join(result['notes']))
        self.assertIn('ДРР рассчитан от суммы заказов.', result['caveats'])
        self.assertEqual(result['data'], data)
        self.assertEqual(result['fetched_at'], 'timestamp')

    def test_period_rates_use_percentage_points_and_keep_cohort_note(self):
        plan, data = fixture(['buyout_share'], [{'buyout_units_cohort': '1', 'ordered_units': '2'}],
            platform='wb', comparison={'from': '2026-11-16', 'to': '2026-11-16'},
            previous=[{'buyout_units_cohort': '1', 'ordered_units': '4'}])
        result = render(plan, data, 'timestamp')
        self.assertEqual(len(result['pages']), 1)
        self.assertIn(': 50%; ранее 25%; изменение +25 п.п.', result['pages'][0])
        self.assertIn('относятся к заказам выбранного периода', ' '.join(result['notes']))

    def test_zero_denominator_stays_undefined(self):
        plan, data = fixture(['drr_ordered'], [{'ad_spend': '10', 'ordered_revenue': '0'}])
        text = '\n'.join(render(plan, data, 'timestamp')['pages'])
        self.assertIn('не определено (нулевой знаменатель)', text)
        self.assertNotIn(': 0%', text)

    def test_current_previous_and_both_requested_changes_are_kept_once(self):
        current = {'metric': 'ordered_revenue', 'period': 'current'}
        previous = {'metric': 'ordered_revenue', 'period': 'previous'}
        expressions = [current, previous,
            {'op': 'subtract', 'args': [current, previous]},
            {'op': 'relative_change', 'args': [current, previous]}]
        plan, data = fixture(None, [{'ordered_revenue': '100'}], expressions=expressions,
            comparison={'from': '2026-11-16', 'to': '2026-11-16'}, previous=[{'ordered_revenue': '0'}])
        pages = render(plan, data, 'timestamp')['pages']
        self.assertEqual(len(pages), 1)
        self.assertIn('100 ₽; ранее 0 ₽', pages[0])
        self.assertIn('изменение +100 ₽', pages[0])
        self.assertIn('относительное изменение не определено (нулевой знаменатель)', pages[0])

    def test_incomplete_or_swapped_store_is_rejected(self):
        plan, data = fixture(['ordered_units'], [{'ordered_units': '12'}])
        for changed in ({**data[0], 'complete': False}, {**data[0], 'store_id': 'another-owner'},
                        {**data[0], 'values': {}}, {**data[0], 'values': {'ordered_units': True}}):
            with self.subTest(changed=changed), self.assertRaises(Rejected):
                render(plan, [changed], 'timestamp')

    def test_currency_mismatch_and_unconfirmed_multi_store_money_are_rejected(self):
        plan, data = fixture(['ordered_revenue'], [{'ordered_revenue': '10'}, {'ordered_revenue': '20'}])
        wrong = deepcopy(data)
        wrong[1]['currency'] = 'KZT'
        with self.assertRaises(Rejected) as error:
            render(plan, wrong, 'timestamp')
        self.assertEqual(error.exception.code, 'SOURCE_CURRENCY_MISMATCH')
        wrong[1]['currency'] = None
        with self.assertRaises(Rejected) as error:
            render(plan, wrong, 'timestamp')
        self.assertEqual(error.exception.code, 'CURRENCY_UNCONFIRMED')

    def test_compiled_program_tampering_is_rejected(self):
        plan, data = fixture(['ordered_units'], [{'ordered_units': '12'}])
        plan['program']['outputs'][0]['label'] = 'Another calculation'
        with self.assertRaises(Rejected) as error:
            render(plan, data, 'timestamp')
        self.assertEqual(error.exception.code, 'COMPILED_PLAN_INVALID')

    def test_negative_financial_adjustments_and_basis_notes_are_retained(self):
        plan, data = fixture(['finance_storage_cost'], [{'finance_storage_cost': '-12.50'}])
        result = render(plan, data, 'timestamp')
        self.assertIn(': -12,5 ₽', result['pages'][0])
        self.assertIn('датам отчётов', ' '.join(result['notes']))
        self.assertIn('временное размещение у агента', ' '.join(result['notes']))
        self.assertEqual(result['caveats'], ['По датам финансовых отчётов; это не чистая прибыль.'])

    def test_stock_snapshot_is_not_subtracted_and_has_no_voice_boilerplate(self):
        plan, data = fixture(['stock_fbo_units', 'stock_fbo_reserved'],
            [{'stock_fbo_units': '12', 'stock_fbo_reserved': '3'}], snapshot=True)
        result = render(plan, data, 'timestamp')
        self.assertEqual(len(result['pages']), 2)
        text = '\n'.join(result['pages'])
        self.assertIn(': 12 шт.', text)
        self.assertIn(': 3 шт.', text)
        self.assertIn('без вычитания', ' '.join(result['notes']))
        self.assertIn('Текущий снимок', ' '.join(result['notes']))
        self.assertIn('Резерв не вычтен', ' '.join(result['caveats']))
        for phrase in ['Скажите', 'Получено', 'Проверочные цифры', 'timestamp', 'С 2026-']:
            self.assertNotIn(phrase, text)

    def test_scalar_unit_dimensions_are_preserved(self):
        expr = {'op': 'per_day', 'args': [{'op': 'divide', 'args': [
            {'metric': 'ordered_revenue'}, {'metric': 'ordered_units'}]}]}
        plan, data = fixture(None, [{'ordered_revenue': '100', 'ordered_units': '2'}], expressions=[expr])
        self.assertIn('50 ₽/(шт.·день)', render(plan, data, 'timestamp')['pages'][0])


if __name__ == '__main__':
    unittest.main()
