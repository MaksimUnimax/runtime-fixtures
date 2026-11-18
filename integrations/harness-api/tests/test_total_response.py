"""Totals reuse the real compiler so rates and financial bases stay correct."""
from copy import deepcopy
import os
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
CORE = Path(os.environ.get('ALISA_CORE_ROOT', str(PROJECT.parent / 'harness-reference/core')))
sys.path[:0] = [str(PROJECT / 'backend'), str(CORE)]
from query_program import make_composed_plan
from semantics import Rejected, Scope, Store
from total_response import append_totals


def fixtures(metric, entries):
    stores = [Store('s' + str(i), platform, 'physical-' + str(i), 'access', 'source', unit)
              for i, (platform, unit, _values) in enumerate(entries)]
    root = {'tenant': 'tenant', 'access_revision': 'revision',
            'stores': [vars(store) for store in stores], 'fragments': []}
    values = []
    for store, (_, _, measured) in zip(stores, entries):
        draft = {'period': {'from': '2026-11-17', 'to': '2026-11-17'}, 'comparison': None,
                 'timezone': 'Europe/Moscow', 'group_by': 'total', 'filters': {},
                 'snapshot': False, 'calendar_date': '2026-11-18', 'platforms': [store.platform],
                 'question': 'Общий итог'}
        source = make_composed_plan(Scope('tenant', 'revision', (store,)), draft, metrics=[metric])
        root['fragments'].append({'kind': 'scalar', 'template_ids': [metric], 'draft': draft, 'plan': source})
        values.append({'template_ids': [metric], 'data': [{'store_id': store.id,
            'complete': True, 'currency': store.currency, 'values': measured, 'previous_values': {}}]})
    return root, {'templates': values}


class TotalResponseTests(unittest.TestCase):
    def test_native_total_rate_is_weighted_from_base_metrics(self):
        plan, values = fixtures('drr_ordered', [
            ('ozon', 'RUB', {'ad_spend': '10', 'ordered_revenue': '100'}),
            ('ozon', 'RUB', {'ad_spend': '30', 'ordered_revenue': '900'})])
        text = '\n'.join(append_totals(plan, values,
            store_names={'s0': 'Первый магазин', 's1': 'Второй магазин'}, fetched_at='test'))
        self.assertIn('Первый магазин, Второй магазин', text)
        self.assertIn('ДРР от суммы заказов 4 процентов', text)
        self.assertNotIn('13,33', text)

    def test_mixed_currencies_refuse_only_aggregate(self):
        plan, values = fixtures('ordered_revenue', [
            ('ozon', 'RUB', {'ordered_revenue': '100'}),
            ('ozon', 'KZT', {'ordered_revenue': '200'})])
        text = '\n'.join(append_totals(plan, values, fetched_at='test'))
        self.assertIn('Общий итог не рассчитан', text)
        self.assertIn('одинаковой валюты', text)
        self.assertNotIn('300', text)

    def test_cross_market_finance_definitions_remain_separate(self):
        plan, values = fixtures('finance_storage_cost', [
            ('ozon', 'RUB', {'finance_storage_cost': '10'}),
            ('wb', 'RUB', {'finance_storage_cost': '20'})])
        text = '\n'.join(append_totals(plan, values, fetched_at='test'))
        self.assertIn('Общий итог не рассчитан', text)
        self.assertIn('разные определения', text)
        self.assertNotIn('Итого:', text)

    def test_store_pairing_is_checked_before_aggregate(self):
        plan, values = fixtures('ordered_revenue', [
            ('ozon', 'RUB', {'ordered_revenue': '100'}),
            ('ozon', 'RUB', {'ordered_revenue': '200'})])
        values['templates'][1]['data'][0]['store_id'] = 'other-owner-store'
        with self.assertRaises(Rejected):
            append_totals(plan, values, fetched_at='test')

    def test_incompatible_periods_cannot_claim_one_combined_total(self):
        plan, values = fixtures('ordered_revenue', [
            ('ozon', 'RUB', {'ordered_revenue': '100'}),
            ('ozon', 'RUB', {'ordered_revenue': '200'})])
        fragment = plan['fragments'][1]
        fragment['draft']['period'] = {'from': '2026-11-16', 'to': '2026-11-16'}
        store = Store(**fragment['plan']['stores'][0])
        fragment['plan'] = make_composed_plan(Scope('tenant', 'revision', (store,)),
            fragment['draft'], metrics=['ordered_revenue'])
        text = '\n'.join(append_totals(plan, values, fetched_at='test'))
        self.assertIn('Общий итог не рассчитан', text)
        self.assertNotIn('Итого:', text)


if __name__ == '__main__':
    unittest.main()
