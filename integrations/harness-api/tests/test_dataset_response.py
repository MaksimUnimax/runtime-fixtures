"""Exercise chat rendering against the installed native dataset catalogue."""
import copy
import os
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[1]
CORE = Path(os.environ.get('ALISA_CORE_ROOT', str(PROJECT.parent / 'harness-reference/core')))
sys.path.insert(0, str(CORE))
sys.path.insert(0, str(PROJECT / 'backend'))
import dataset_pipeline as native
from dataset_response import render
from semantics import Rejected, Scope, Store


def plan(query_id):
    store = Store('test-store', 'ozon', 'synthetic', 'access-revision', 'source-revision', 'RUB')
    caps = {store.id: {operation: {'status': 'READ_ONLY_CANARY',
        'dataset_source_hash': native.SOURCES.hash, 'dataset_query_hash': native.HASH,
        **native.SOURCES.recipe(operation)['proof_requirements']}
        for operation in native.operations(query_id, 'ozon')}}
    snapshot = native.CATALOG['queries'][query_id]['snapshot']
    draft = {'period': {'from': '2026-11-18' if snapshot else '2026-11-17',
                        'to': '2026-11-18' if snapshot else '2026-11-17'},
             'comparison': None, 'timezone': 'Europe/Moscow', 'group_by': 'marketplace',
             'filters': {}, 'snapshot': snapshot, 'snapshot_slot': 0 if snapshot else None,
             'calendar_date': '2026-11-18', 'platforms': ['ozon'],
             'dataset_request': {'id': query_id}}
    return native.make_dataset_plan(Scope('tenant', 'revision', (store,)), draft, caps)


def data(datasets):
    return [{'store_id': 'test-store', 'complete': True, 'datasets': datasets}]


class DatasetResponseTests(unittest.TestCase):
    def test_full_chat_report_survives_native_voice_page_limit(self):
        checked = plan('product_registry')
        completed = data({'rows': [{'key': str(i), 'product_id': str(i),
            'offer_id': 'артикул-' + 'a' * 70 + str(i)} for i in range(1, 3001)]})
        with self.assertRaises(Rejected) as failure:
            native.render(checked, completed, 'test')
        self.assertEqual(failure.exception.code, 'DATASET_VOICE_CAPACITY')
        result = render(checked, completed, 'test')
        self.assertTrue(result['complete'])
        self.assertFalse(result['details_omitted'])
        self.assertEqual(result['row_counts'], [{'store_id': 'test-store', 'total': 3000, 'shown': 3000}])
        self.assertIn('a3000 |', '\n'.join(result['pages']))

    def test_optional_authorized_full_report_makes_truncation_explicit(self):
        completed = data({'rows': [{'key': str(i), 'product_id': str(i), 'offer_id': str(i)}
                                  for i in range(1, 151)]})
        result = render(plan('product_registry'), completed, 'test',
            full_report_url='/harness/api/reports/request-id/fragment-id')
        self.assertTrue(result['complete'])
        self.assertTrue(result['details_omitted'])
        self.assertEqual(result['row_counts'][0], {'store_id': 'test-store', 'total': 150, 'shown': 100})
        self.assertIn('показано 100 из 150', '\n'.join(result['pages']))
        self.assertEqual(result['data'], completed)
        absolute = 'https://alisa.octoport.ru/harness/api/reports/request-id/fragment-id'
        self.assertEqual(render(plan('product_registry'), completed, 'test',
            full_report_url=absolute)['full_report_url'], absolute)
        for unsafe in ['https://other.test/x',
                       'https://alisa.octoport.ru@other.test/harness/api/reports/a/b',
                       'https://alisa.octoport.ru/harness/api/reports/a/b?redirect=other']:
            with self.subTest(unsafe=unsafe):
                with self.assertRaises(Rejected):
                    render(plan('product_registry'), completed, 'test', full_report_url=unsafe)

    def test_missing_stage_foreign_store_and_duplicate_row_are_rejected(self):
        checked = plan('product_registry')
        for completed in [data({}), data({'rows': [{'key': 'x'}, {'key': 'x'}]}),
                          [{'store_id': 'another-store', 'complete': True, 'datasets': {'rows': []}}]]:
            with self.subTest(completed=completed):
                with self.assertRaises(Rejected):
                    render(checked, completed, 'test')

    def test_catalogue_pin_cannot_be_replaced_by_a_client(self):
        checked = plan('product_registry')
        checked['dataset']['catalog_hash'] = 'client-catalogue'
        with self.assertRaises(Rejected):
            render(checked, data({'rows': []}), 'test')

    def test_native_join_coverage_and_weighted_averages_are_preserved(self):
        checked = plan('realization_payment_totals')
        completed = data({'target': [
            {'key': 't1', 'posting_key': 'p1', 'product_id': '10', 'sale_units': '2',
             'sale_amount': '100', 'seller_amount': '140'},
            {'key': 't2', 'posting_key': None, 'product_id': '11', 'sale_units': '1',
             'sale_amount': '30', 'seller_amount': '40'}],
            'fbo': [{'key': 'p1-10', 'posting_key': 'p1', 'product_id': '10',
                     'item_units': '2', 'payment_raw': 'Карта'}], 'fbs': []})
        original = native.render(checked, completed, 'test')
        result = render(checked, completed, 'test')
        self.assertEqual(result['join_coverage'], original['join_coverage'])
        self.assertEqual(result['enrichment_complete'], original['enrichment_complete'])
        self.assertFalse(result['enrichment_complete'])
        text = '\n'.join(result['pages'])
        self.assertIn('| Карта | 2 | 100 | 140 | 50 |', text)
        self.assertIn('| неизвестно | 1 | 30 | 40 | 30 |', text)
        self.assertIn('без соответствия 1', text)
        # A second metadata row for the same join key must still fail closed.
        duplicate = copy.deepcopy(completed)
        duplicate[0]['datasets']['fbo'].append({**duplicate[0]['datasets']['fbo'][0], 'key': 'other-key'})
        with self.assertRaises(Rejected):
            render(checked, duplicate, 'test')

    def test_missing_numeric_value_is_visible_unknown_not_zero(self):
        checked = plan('offer_prices')
        result = render(checked, data({'rows': [{'key': '1', 'product_id': '1',
            'offer_id': '<script>x</script>|item', 'price': '0', 'currency': 'RUB'}]}), 'test')
        text = '\n'.join(result['pages'])
        self.assertIn('неизвестно', text)
        self.assertIn('<script>x</script>¦item', text)
        self.assertIn('| 0 |', text)


if __name__ == '__main__':
    unittest.main()
