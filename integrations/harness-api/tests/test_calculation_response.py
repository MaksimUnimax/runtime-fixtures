"""Catalogue arithmetic regression tests; no model or marketplace calls."""
import copy
import json
import os
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / 'backend'))
from calculation_response import CalculationError, DATASET_SUMMARIES, supplement

CORE = Path(os.environ.get('ALISA_CORE_ROOT', str(PROJECT.parent / 'harness-reference/core')))
CATALOG = json.loads((CORE / 'template_catalog.json').read_text())['templates']


def fixture(tid, values, *, platform='ozon', currency='RUB', previous=None):
    template = CATALOG[tid]
    kind = 'dataset' if template['kind'] == 'dataset' else 'scalar'
    plan = {'stores': [{'id': 'store-one', 'platform': platform, 'currency': currency}],
            'period': {'from': '2026-11-01', 'to': '2026-11-02'},
            'comparison': {'from': '2026-10-01', 'to': '2026-10-02'} if previous is not None else None}
    fragment = {'kind': kind, 'template_ids': [tid], 'plan': plan}
    block = {'store_id': 'store-one', 'complete': True, 'currency': currency}
    if kind == 'dataset':
        block['datasets'] = values
    else:
        block['values'] = values
        if previous is not None:
            block['previous_values'] = previous
    return fragment, [block]


def output(tid, values, **kwargs):
    fragment, completed = fixture(tid, values, **kwargs)
    return '\n'.join(supplement(fragment, completed, template_catalog=CATALOG))


class CalculationResponseTests(unittest.TestCase):
    def test_commission_total_preserves_refund_sign_and_comparison(self):
        result = output('SUMMARY.47', {'finance_commission_cost': '-7.30',
                         'finance_acquiring_cost': '10.10'},
                        previous={'finance_commission_cost': '8', 'finance_acquiring_cost': '2'})
        self.assertIn('вместе: 2,8 RUB', result)
        self.assertIn('В периоде сравнения: Комиссия и эквайринг вместе: 10 RUB', result)

    def test_missing_component_or_unconfirmed_currency_cannot_be_zero(self):
        with self.assertRaises(CalculationError):
            output('SUMMARY.47', {'finance_commission_cost': '4'})
        with self.assertRaises(CalculationError):
            output('SUMMARY.47', {'finance_commission_cost': '4',
                   'finance_acquiring_cost': '2'}, currency=None)

    def test_product_count_uses_unique_cards_and_rejects_duplicates(self):
        result = output('product_registry', {'rows': [
            {'key': '1', 'product_id': '1'}, {'key': '2', 'product_id': '2'}]})
        self.assertIn('справочнике Ozon: 2.', result)
        self.assertIn('не число активных', result)
        with self.assertRaises(CalculationError):
            output('product_registry', {'rows': [
                {'key': '1', 'product_id': '1'}, {'key': '2', 'product_id': '1'}]})
        # The Ozon-only contract must never be applied to WB size rows/cards.
        self.assertEqual(output('product_registry', {'rows': []}, platform='wb'), '')

    def test_price_groups_use_numeric_equality_and_keep_missing_marketing_unknown(self):
        result = output('offer_prices', {'rows': [
            {'key': '1', 'product_id': '1', 'price': '100.00', 'currency': 'RUB',
             'marketing_seller_price': None},
            {'key': '2', 'product_id': '2', 'price': '100', 'currency': 'RUB',
             'marketing_seller_price': '0'}]})
        self.assertIn('Цена продавца Ozon 100 RUB: товаров 2.', result)
        self.assertIn('Маркетинговая цена продавца Ozon 0 RUB: товаров 1.', result)
        self.assertIn('значение не указано у 1 товаров', result)

    def test_posting_count_is_not_item_count_and_keeps_schemes(self):
        result = output('posting_metadata', {'fbo': [
            {'key': 'FBO-A', 'posting_number': 'FBO-A', 'scheme': 'fbo', 'units': '100'}],
            'rows': [{'key': 'FBS-A', 'posting_number': 'FBS-A', 'scheme': 'fbs', 'units': '2'},
                     {'key': 'FBS-B', 'posting_number': 'FBS-B', 'scheme': 'fbs', 'units': '3'}]})
        self.assertIn('Отправлений со склада Озона: 1.', result)
        self.assertIn('Отправлений со склада продавца: 2.', result)
        self.assertNotIn('100', result)

    def test_accrual_distinct_unions_sku_across_days_and_both_directions(self):
        result = output('accrual_items', {'rows': [
            {'key': 'a', 'product_id': '17', 'day': '2026-11-01', 'direction': 'реализация'},
            {'key': 'b', 'product_id': '17', 'day': '2026-11-02', 'direction': 'обратное начисление'},
            {'key': 'c', 'product_id': '18', 'day': '2026-11-02', 'direction': 'обратное начисление'}]})
        self.assertIn('за весь период: 2.', result)

    def test_price_extrema_use_buyer_average_not_seller_price_and_keep_zero(self):
        result = output('accrual_price_lines', {'rows': [
            {'key': 'a', 'direction': 'реализация', 'line_units': '2', 'buyer_unit_average': '0',
             'seller_unit_price': '999', 'currency': 'RUB'},
            {'key': 'b', 'direction': 'реализация', 'line_units': '1', 'buyer_unit_average': '8',
             'seller_unit_price': '999', 'currency': 'RUB'},
            {'key': 'c', 'direction': 'обратное начисление', 'line_units': '1',
             'buyer_unit_average': '200', 'currency': 'RUB'}]})
        self.assertIn('товарных строк (реализация): от 0 до 8 RUB.', result)
        self.assertIn('обратное начисление): от 200 до 200 RUB.', result)
        self.assertIn('не доказывает минимум и максимум', result)
        self.assertNotIn('999', result)

    def test_empty_price_range_is_unknown_not_zero(self):
        result = output('accrual_price_lines', {'rows': []})
        self.assertIn('не определён', result)
        self.assertNotIn('от 0', result)

    def test_cross_store_and_incomplete_data_are_rejected(self):
        fragment, completed = fixture('product_registry', {'rows': []})
        wrong = copy.deepcopy(completed)
        wrong[0]['store_id'] = 'another-owner-store'
        with self.assertRaises(CalculationError):
            supplement(fragment, wrong, template_catalog=CATALOG)
        completed[0]['complete'] = False
        with self.assertRaises(CalculationError):
            supplement(fragment, completed, template_catalog=CATALOG)

    def test_all_installed_calculation_contracts_have_an_explicit_native_or_supplement_route(self):
        native = {
            'alisa-accrual-sale-units-calculation/v1',
            'alisa-accrual-scalar-calculation/v1',
            'alisa-finance-service-scalar-calculation/v1',
            'alisa-ozon-commission-scalar-calculation/v1',
            'alisa-wb-financial-scalar-calculation/v1',
            'alisa-stock-scalar-calculation/v1',
            'alisa-ozon-financial-summary-calculation/v1',
            'alisa-wb-stock-summary-calculation/v1',
            'alisa-realization-payment-fields/v1',
        }
        handled = native | set(DATASET_SUMMARIES) | {'alisa-ozon-expense-summary-calculation/v1'}
        for tid, template in CATALOG.items():
            contract = template.get('calculation_contract')
            if not contract:
                continue
            with self.subTest(tid=tid):
                if 'schema' in contract:
                    self.assertIn(contract['schema'], handled)
                else:
                    self.assertEqual(template['kind'], 'formula')
                    self.assertEqual(set(contract), {'label', 'expr'})


if __name__ == '__main__':
    unittest.main()
