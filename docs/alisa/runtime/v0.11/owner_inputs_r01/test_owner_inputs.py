"""Synthetic, network-free contract tests. No real costs or accounts are loaded."""
from pathlib import Path
from copy import deepcopy
from decimal import Decimal
from unittest.mock import patch
import hashlib
import json
import socket
import unittest
from owner_inputs import OwnerInputs, InputError, digest, strict_loads

ROOT = Path(__file__).parent
CATALOG = json.loads((ROOT / 'owner_input_catalog.json').read_text())
NOW = 1793865600
SCOPE = 'a' * 64
PERIOD = {'from': '2026-11-01', 'to': '2026-11-04'}


def row(field='unit_cost', value='250', *, rid='cost-r1', entity='product:synthetic:1',
        start='2026-11-01', end='2026-11-04', state='VALUE', currency='RUB'):
    return {'id': rid, 'field': field, 'entity': entity, 'currency': currency,
            'period': {'from': start, 'to': end}, 'state': state, 'value': value}


class OwnerInputTests(unittest.TestCase):
    def setUp(self):
        self.catalog = deepcopy(CATALOG)
        self.engine = OwnerInputs(self.catalog)
        self.payload = {'schema': 'alice-owner-input-snapshot/v1', 'revision': 'fixture-r1',
                        'scope_hash': SCOPE, 'catalog_hash': self.engine.hash,
                        'issued_at': NOW - 60, 'expires_at': NOW + 3600, 'entries': [row()]}
        self.request = {'scope_hash': SCOPE, 'entity': 'product:synthetic:1',
                        'currency': 'RUB', 'period': deepcopy(PERIOD), 'fields': ['unit_cost']}
        self.approved = set()
        self.actions = []

    def envelope(self):
        result = {'payload': deepcopy(self.payload), 'sha256': digest(self.payload)}
        self.approved.add(result['sha256'])
        return result

    def auth(self, metadata, request, action):
        self.actions.append(action)
        return metadata['facts_sha256'] in self.approved and metadata['scope_hash'] == SCOPE

    def run_it(self, **kwargs):
        return self.engine.resolve(self.envelope(), self.request, authorize=self.auth, now=NOW, **kwargs)

    def segment(self, field='unit_cost', **kwargs):
        return self.run_it(**kwargs)['fields'][field]['segments'][0]

    def reject(self, code, fn=None):
        with self.assertRaises(InputError) as exc:
            (fn or self.run_it)()
        self.assertEqual(exc.exception.code, code)

    def test_exact_cost_retained_not_changed_to_order_denominator(self):
        s = self.segment()
        self.assertEqual(s['value'], '250')
        self.assertEqual(s['unit'], 'currency_per_physical_unit')
        # Independent arithmetic illustrates why allocation is NOT the input cost.
        actual_cogs = Decimal(s['value']) * Decimal('4')
        self.assertEqual(actual_cogs, Decimal('1000'))
        self.assertNotEqual(actual_cogs / Decimal('6'), Decimal(s['value']))
        self.assertEqual(self.payload['entries'][0]['value'], '250')

    def test_missing_cost_no_default(self):
        self.payload['entries'] = []
        r = self.run_it(); s = r['fields']['unit_cost']['segments'][0]
        self.assertIsNone(s['value']); self.assertEqual(s['state'], 'NOT_PROVIDED')
        self.assertEqual(r['status'], 'RESOLVED_WITH_OMISSIONS')

    def test_explicit_zero_is_value_not_missing(self):
        self.payload['entries'][0]['value'] = '0'
        self.assertEqual(self.segment()['state'], 'VALUE')
        self.assertEqual(self.segment()['value'], '0')

    def test_tax_excluded_does_not_imply_zero_tax(self):
        self.request['fields'] = ['tax_amount']
        self.payload['entries'] = [row('tax_amount', None, state='EXCLUDED_BY_OWNER')]
        s = self.segment('tax_amount'); self.assertEqual(s['state'], 'EXCLUDED_BY_OWNER'); self.assertIsNone(s['value'])

    def test_tax_not_provided_separate_from_excluded(self):
        self.request['fields'] = ['tax_amount']; self.payload['entries'] = []
        self.assertEqual(self.segment('tax_amount')['state'], 'NOT_PROVIDED')

    def test_cost_cannot_be_excluded_by_fake_boolean(self):
        self.payload['entries'][0].update(state='EXCLUDED_BY_OWNER', value=None)
        self.reject('OWNER_INPUT_EXCLUSION')

    def test_missing_not_zero(self):
        self.payload['entries'][0].update(state='NOT_PROVIDED', value='0')
        self.reject('OWNER_INPUT_MISSING_NOT_ZERO')

    def test_two_effective_values_remain_two_segments(self):
        self.payload['entries'] = [row(value='250', end='2026-11-02'), row(value='300', rid='cost-r2', start='2026-11-03')]
        segments = self.run_it()['fields']['unit_cost']['segments']
        self.assertEqual([(s['period'], s['value']) for s in segments], [
            ({'from': '2026-11-01', 'to': '2026-11-02'}, '250'),
            ({'from': '2026-11-03', 'to': '2026-11-04'}, '300')])

    def test_gap_retained_as_unknown(self):
        self.payload['entries'] = [row(end='2026-11-01'), row(rid='cost-r3', start='2026-11-03')]
        self.assertEqual([s['state'] for s in self.run_it()['fields']['unit_cost']['segments']], ['VALUE', 'NOT_PROVIDED', 'VALUE'])

    def test_monthly_expense_not_prorated_to_day(self):
        self.request['fields'] = ['own_cost_amount']
        self.payload['entries'] = [row('own_cost_amount', '3100', end='2026-11-30')]
        s = self.segment('own_cost_amount')
        self.assertEqual(s['reason'], 'PERIOD_ALLOCATION_REQUIRED'); self.assertIsNone(s['value'])

    def test_exact_own_cost_period(self):
        self.request['fields'] = ['own_cost_amount']; self.payload['entries'] = [row('own_cost_amount', '123.40')]
        self.assertEqual(self.segment('own_cost_amount')['value'], '123.40')

    def test_unmatched_entity_not_borrowed(self):
        self.payload['entries'][0]['entity'] = 'product:synthetic:other'
        self.assertIsNone(self.segment()['value'])

    def test_different_scope_rejected(self):
        self.request['scope_hash'] = 'b' * 64; self.reject('OWNER_INPUT_SCOPE')

    def test_currency_not_converted(self):
        self.request['currency'] = 'USD'; self.reject('OWNER_INPUT_CURRENCY')

    def test_overlap_even_same_value_rejected(self):
        self.payload['entries'].append(row(rid='duplicate-period'))
        self.reject('OWNER_INPUT_OVERLAP')

    def test_overlap_across_currency_also_rejected(self):
        self.payload['entries'].append(row(rid='other-currency', currency='USD'))
        self.reject('OWNER_INPUT_OVERLAP')

    def test_duplicate_entry_id_rejected(self):
        self.payload['entries'].append(row(entity='product:other:1'))
        self.reject('OWNER_INPUT_DUPLICATE_ID')

    def test_expired_snapshot_rejected(self):
        self.payload['expires_at'] = NOW; self.reject('OWNER_INPUT_EXPIRED')

    def test_future_receipt_rejected(self):
        self.payload['issued_at'] = NOW + 1; self.reject('OWNER_INPUT_EXPIRED')

    def test_unbounded_retention_rejected(self):
        self.payload['expires_at'] = NOW + 86401; self.reject('OWNER_INPUT_EXPIRED')

    def test_boolean_clock_rejected(self):
        self.reject('OWNER_INPUT_CLOCK', lambda: self.engine.resolve(self.envelope(), self.request, authorize=self.auth, now=True))

    def test_missing_authority_rejected(self):
        self.reject('OWNER_INPUT_AUTH_REQUIRED', lambda: self.engine.resolve(self.envelope(), self.request, authorize=None, now=NOW))

    def test_unapproved_facts_rejected(self):
        e = self.envelope(); self.approved.clear()
        self.reject('OWNER_INPUT_AUTH_DENIED', lambda: self.engine.resolve(e, self.request, authorize=self.auth, now=NOW))

    def test_truthy_one_not_authority(self):
        self.reject('OWNER_INPUT_AUTH_DENIED', lambda: self.engine.resolve(self.envelope(), self.request, authorize=lambda *x: 1, now=NOW))

    def test_authority_exception_safe(self):
        def fail(*args): raise RuntimeError('Bearer hidden-private-string')
        self.reject('OWNER_INPUT_AUTH_UNAVAILABLE', lambda: self.engine.resolve(self.envelope(), self.request, authorize=fail, now=NOW))

    def test_read_and_execute_authorized_again(self):
        r = self.run_it(); self.run_it(action='execute', pin=r['pin']); self.run_it(action='read', pin=r['pin'])
        self.assertEqual(self.actions, ['resolve', 'execute', 'read'])

    def test_revoked_after_acceptance_rejected(self):
        e = self.envelope(); r = self.engine.resolve(e, self.request, authorize=self.auth, now=NOW)
        self.approved.clear()
        self.reject('OWNER_INPUT_AUTH_DENIED', lambda: self.engine.resolve(e, self.request, authorize=self.auth, now=NOW, action='execute', pin=r['pin']))

    def test_same_revision_changed_value_not_pinned_old_fact(self):
        pin = self.run_it()['pin']; self.payload['entries'][0]['value'] = '999'
        self.reject('OWNER_INPUT_PIN_CHANGED', lambda: self.run_it(pin=pin))

    def test_new_revision_does_not_reinterpret_old_pin(self):
        pin = self.run_it()['pin']; self.payload['revision'] = 'fixture-r2'
        self.reject('OWNER_INPUT_PIN_CHANGED', lambda: self.run_it(pin=pin))

    def test_request_period_bound_to_pin(self):
        pin = self.run_it()['pin']; self.request['period']['to'] = '2026-11-03'
        self.reject('OWNER_INPUT_PIN_CHANGED', lambda: self.run_it(pin=pin))

    def test_field_order_does_not_change_pin(self):
        self.request['fields'] = ['tax_amount', 'unit_cost']; a = self.run_it()
        self.request['fields'] = ['unit_cost', 'tax_amount']; b = self.run_it(pin=a['pin'])
        self.assertEqual(a['pin'], b['pin'])

    def test_hash_tamper(self):
        e = self.envelope(); e['payload']['entries'][0]['value'] = '111'
        self.reject('OWNER_INPUT_HASH', lambda: self.engine.resolve(e, self.request, authorize=self.auth, now=NOW))

    def test_wrong_catalog_hash(self):
        self.payload['catalog_hash'] = '0' * 64; self.reject('OWNER_INPUT_CATALOG')

    def test_copy_isolation(self):
        old = self.engine.hash; self.catalog['version'] = 'changed'; out = self.engine.catalog; out['fields'].clear()
        self.assertEqual(self.engine.hash, old); self.assertTrue(self.engine.catalog['fields'])

    def test_authority_cannot_mutate_validated_inputs(self):
        e = self.envelope()
        def mutate(m, r, action):
            m.clear(); r.clear(); e['payload']['entries'][0]['value'] = '999'
            return True
        r = self.engine.resolve(e, self.request, authorize=mutate, now=NOW)
        self.assertEqual(r['fields']['unit_cost']['segments'][0]['value'], '250')

    def test_no_values_forwarded_to_authority(self):
        def inspect(metadata, request, action):
            self.assertNotIn('entries', metadata); self.assertNotIn('250', json.dumps(metadata))
            return True
        self.engine.resolve(self.envelope(), self.request, authorize=inspect, now=NOW)

    def test_invalid_date(self):
        self.payload['entries'][0]['period']['from'] = '2026-02-30'; self.reject('OWNER_INPUT_PERIOD')

    def test_reversed_date(self):
        self.request['period'] = {'from': '2026-11-04', 'to': '2026-11-01'}; self.reject('OWNER_INPUT_PERIOD')

    def test_period_limit(self):
        self.request['period'] = {'from': '2025-01-01', 'to': '2026-11-01'}; self.reject('OWNER_INPUT_PERIOD_LIMIT')

    def test_date_max_boundary(self):
        self.request['period'] = {'from': '9999-12-31', 'to': '9999-12-31'}
        self.payload['entries'][0]['period'] = deepcopy(self.request['period'])
        self.assertEqual(self.segment()['period'], self.request['period'])

    def test_extra_secret_field_rejected(self):
        self.payload['execution_ticket'] = 'synthetic-only'; self.reject('OWNER_INPUT_SCHEMA')

    def test_duplicate_json_key(self):
        self.reject('OWNER_INPUT_DUPLICATE_KEY', lambda: strict_loads('{"x":1,"x":2}'))

    def test_nonfinite_json(self):
        self.reject('OWNER_INPUT_NONFINITE', lambda: strict_loads('{"x":NaN}'))

    def test_oversize_input(self):
        self.reject('OWNER_INPUT_SIZE', lambda: strict_loads(' ' * 1048577))

    def test_row_capacity(self):
        cat = deepcopy(CATALOG); cat['max_entries'] = 1; self.engine = OwnerInputs(cat); self.payload['catalog_hash'] = self.engine.hash
        self.payload['entries'].append(row(rid='other', entity='product:other:2')); self.reject('OWNER_INPUT_CAPACITY')

    def test_segment_capacity(self):
        cat = deepcopy(CATALOG); cat['max_segments'] = 1; self.engine = OwnerInputs(cat); self.payload['catalog_hash'] = self.engine.hash
        self.payload['entries'][0]['period']['from'] = '2026-11-03'; self.reject('OWNER_INPUT_CAPACITY')

    def test_json_only_new_field(self):
        before = hashlib.sha256((ROOT / 'owner_inputs.py').read_bytes()).hexdigest()
        cat = deepcopy(CATALOG); cat['fields']['packaging_unit_cost'] = deepcopy(cat['fields']['unit_cost'])
        cat['fields']['packaging_unit_cost']['label'] = 'Упаковка одной физической единицы'
        self.engine = OwnerInputs(cat); self.payload['catalog_hash'] = self.engine.hash
        self.payload['entries'] = [row('packaging_unit_cost', '12.50')]; self.request['fields'] = ['packaging_unit_cost']
        self.assertEqual(self.segment('packaging_unit_cost')['value'], '12.50')
        self.assertEqual(before, hashlib.sha256((ROOT / 'owner_inputs.py').read_bytes()).hexdigest())

    def test_resolution_not_ready_report(self):
        r = self.run_it(); self.assertEqual(r['network_calls'], 0); self.assertFalse(r['report_saved'])
        self.assertNotIn('READY', r['status']); self.assertNotIn('profit', r)

    def test_output_checksum(self):
        r = self.run_it(); h = r.pop('resolution_sha256'); self.assertEqual(h, digest(r))

    def test_empty_fields_forbidden(self):
        self.request['fields'] = []; self.reject('OWNER_INPUT_FIELDS')

    def test_duplicate_field_request(self):
        self.request['fields'] = ['unit_cost', 'unit_cost']; self.reject('OWNER_INPUT_FIELDS')

    def test_unknown_field(self):
        self.request['fields'] = ['invented']; self.reject('OWNER_INPUT_FIELDS')

    def test_unauthorized_entity_callback(self):
        self.reject('OWNER_INPUT_AUTH_DENIED', lambda: self.engine.resolve(self.envelope(), self.request,
              authorize=lambda m, r, a: r['entity'] == 'different-store', now=NOW))

    def test_invalid_action(self):
        self.reject('OWNER_INPUT_ACTION', lambda: self.run_it(action='publish'))


INVALID_VALUES = [None, True, 250, 2.5, 'NaN', 'Infinity', '1e2', '12,50', '', '-1', '1000000000001', '0.000000001']
for index, value in enumerate(INVALID_VALUES):
    def case(self, value=value):
        self.payload['entries'][0]['value'] = value
        self.reject('OWNER_INPUT_BOUNDS' if value in ('-1', '1000000000001') else 'OWNER_INPUT_VALUE')
    setattr(OwnerInputTests, f'test_invalid_amount_{index:02d}', case)

if __name__ == '__main__':
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('NETWORK_FORBIDDEN')), \
         patch.object(socket.socket, 'connect_ex', side_effect=AssertionError('NETWORK_FORBIDDEN')), \
         patch.object(socket, 'getaddrinfo', side_effect=AssertionError('DNS_FORBIDDEN')):
        result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(OwnerInputTests))
    receipt = {'tests': result.testsRun, 'failures': len(result.failures), 'errors': len(result.errors),
               'skipped': len(result.skipped), 'network_calls': 0, 'live_credentials': False,
               'live_database': False, 'status': 'PASS' if result.wasSuccessful() else 'FAIL'}
    print(json.dumps(receipt)); raise SystemExit(0 if result.wasSuccessful() else 1)
