from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
import json
import os
from pathlib import Path
import sys
import unittest

PROJECT = Path(__file__).resolve().parents[2]
CORE = Path(os.environ.get('ALISA_CORE_ROOT', str(PROJECT.parent / 'harness-reference/core')))
sys.path[:0] = [str(PROJECT / 'backend'), str(CORE)]
import model_pricing
from pricing_snapshot import install
from request_meter import measure, tokens


def receipt(**changed):
    return {'model': 'deepseek-flash', 'requested_model': 'deepseek-flash', 'usage': {
        'prompt_tokens': 100, 'completion_tokens': 20, 'total_tokens': 120,
        'prompt_cache_hit_tokens': 80, 'prompt_cache_miss_tokens': 20, **changed}}


def call(value, quote=None, state='RECEIVED'):
    return {'source': 'model:deepseek-flash', 'state': state, 'dispatched': 1,
            'model_usage': json.dumps(value) if value is not None else None,
            'model_context': json.dumps({'stage': 'template_select', 'pricing_quote': quote})}


class MeterTests(unittest.TestCase):
    def setUp(self):
        self.original = model_pricing.snapshot
        self.addCleanup(setattr, model_pricing, 'snapshot', self.original)
        self.at = datetime(2026, 11, 18, 12, tzinfo=timezone.utc).timestamp()

    def test_receipt_quote_is_immutable_when_future_fx_is_installed(self):
        before = model_pricing.snapshot('deepseek-flash', self.at)
        old = deepcopy(before)
        old_price = measure([call(receipt(), old)])['rub']['estimated']
        install()
        fresh = model_pricing.snapshot('deepseek-flash', self.at)
        self.assertEqual(fresh['fx_as_of'], '2026-11-18')
        self.assertEqual(fresh['rates']['rub_per_currency'], '82.4529')
        from model_usage import _context
        self.assertIsInstance(_context({'schema': 'alisa-model-attempt-context/v1', 'stage': 'template_select',
                                       'requested_model': 'deepseek-flash', 'pricing_quote': fresh}), str)
        self.assertEqual(before, old)
        self.assertEqual(measure([call(receipt(), old)])['rub']['estimated'], old_price)
        measured = measure([call(receipt(), fresh)], 'synthetic-request')
        expected = (Decimal(80) * Decimal('.003') + Decimal(20) * Decimal('.15') + Decimal(20) * Decimal('.60')) / Decimal(1000000) * Decimal('82.4529')
        self.assertEqual(Decimal(measured['rub']['estimated']), expected)
        self.assertEqual(measured['calls'], {'model': 1, 'selector': 1, 'final': 0})
        self.assertIn('not_invoice', measured['rub']['basis'])

    def test_dated_snapshot_does_not_apply_future_fx(self):
        install()
        past = datetime(2026, 11, 17, 12, tzinfo=timezone.utc).timestamp()
        self.assertEqual(model_pricing.snapshot('deepseek-flash', past)['fx_as_of'], '2026-11-13')

    def test_missing_failed_receipt_keeps_known_subtotal_and_unknown_total(self):
        quote = model_pricing.snapshot('deepseek-flash', self.at)
        known = measure([call(receipt(), quote)])
        mixed = measure([call(receipt(), quote), call(None, quote, state='UNKNOWN')])
        self.assertIsNone(mixed['rub']['estimated'])
        self.assertEqual(mixed['rub']['known'], known['rub']['known'])
        self.assertEqual(mixed['rub']['unpriced_attempts'], 1)
        self.assertIsNone(mixed['tokens']['prompt'])
        self.assertEqual(mixed['calls']['model'], 2)

    def test_inconsistent_receipts_are_never_reported_as_exact(self):
        for changes in ({'total_tokens': 999}, {'prompt_tokens_details': {'cached_tokens': 70}},
                        {'prompt_cache_miss_tokens': 30}):
            with self.subTest(changes=changes):
                value = receipt(**changes)
                self.assertIsNone(tokens(value)['total'])
                self.assertFalse(measure([call(value, model_pricing.snapshot('deepseek-flash', self.at))])['rub']['complete'])

    def test_reasoning_tokens_are_not_added_twice_and_zero_calls_are_zero(self):
        value = receipt(completion_tokens_details={'reasoning_tokens': 10})
        self.assertEqual(tokens(value)['completion'], 20)
        zero = measure([])
        self.assertEqual(zero['tokens']['total'], 0)
        self.assertEqual(zero['rub']['estimated'], '0')
        self.assertTrue(zero['rub']['complete'])

    def test_malformed_ledger_data_is_unknown_not_a_render_failure(self):
        value = call(receipt(), {'rates': {}, 'id': 'broken'})
        self.assertFalse(measure([value])['rub']['complete'])
        value['model_usage'] = '{truncated'
        self.assertIsNone(measure([value])['tokens']['total'])
