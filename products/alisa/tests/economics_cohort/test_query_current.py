"""Current DB authority and owner reads for a full forecast's private batches.

Real Query/WebSession/RuntimeAuthority and signed references, synthetic accounts
and source attestations only. No provider, model or native authorizer substitute.
"""
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from threading import Thread
from unittest.mock import patch
import json, os, tempfile, uuid

from django.db import connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from alisa_platform.accounts.models import WebSession
from alisa_platform.entitlements.models import AccessLedger, AccessGrant, AccessAdjustment
from alisa_platform.queries.models import Query
from alisa_platform.stores.models import CredentialRevision, VaultSecret
from alisa_platform.runtime_adapter.authority import RuntimeAuthority, SessionPrincipal
from alisa_platform.runtime_adapter.bindings import BindingFile
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from alisa_platform.owner_data import economics_query as query
from alisa_platform.owner_data import parameter_report_rpc as rpc
from alisa_platform.owner_data import parameter_service as parameters, service as owner
from alisa_platform.owner_data.models import CurrentParameter, OwnerCommand, OwnerDataset
from current_parameters.test_parameters import Fixture

FLAGS = {'ALISA_ENV': 'synthetic', 'OWNER_ECONOMICS_COMPOSITES_ENABLED': True,
         'OWNER_PARAMETER_COMPOUNDS_ENABLED': True, 'OWNER_DATA_ENABLED': True,
         'OWNER_PARAMETERS_ENABLED': True, 'RUNTIME_AUTHORITY_ENABLED': True,
         'ACCOUNTS_ENABLED': True, 'STORES_ENABLED': True, 'ENTITLEMENTS_ENABLED': True,
         'RUNTIME_AUTO_BINDINGS_ENABLED': False}
PERIOD = {'from': '2026-11-12', 'to': '2026-11-13'}
DAY = '2026-11-13'


class QueryFixture(Fixture):
    def setUp(self):
        self.create()
        now = timezone.now()
        AccessLedger.objects.create(tenant=self.tenant)
        self.grant = AccessGrant.objects.create(tenant=self.tenant, source='GIFT', source_id=uuid.uuid4(),
            days=7, starts_at=now-timedelta(hours=1), ends_at=now+timedelta(days=6), actor_id=uuid.uuid4(), reason='SYNTHETIC_QUERY_ONLY')
        credentials = []
        for kind in ('SELLER', 'PERFORMANCE'):
            secret = VaultSecret.objects.create(tenant=self.tenant, store=self.store, kind=kind, revision=1,
                                                key_version='fixture', ciphertext='SYNTHETIC-NOT-DECRYPTED')
            credential = CredentialRevision.objects.create(tenant=self.tenant, store=self.store, kind=kind,
                revision=1, secret=secret, status='ACTIVE', check_code='CONNECTED')
            credentials.append({'kind': kind, 'id': str(credential.pk), 'revision': 1})
        self.folder = tempfile.TemporaryDirectory(prefix='alisa-query-current-', dir='/root')
        self.addCleanup(self.folder.cleanup)
        bindings = Path(self.folder.name)/'bindings.json'
        self.bindings = bindings
        mapping = {'schema': 'alisa-runtime-bindings/v1', 'environment': 'synthetic',
            'service_id': 'synthetic-economics-service', 'catalog_release_id': 'synthetic-economics-catalog',
            'tenants': [{'tenant_id': str(self.tenant.pk), 'runtime_tenant': 'native-tenant', 'revision': 'fixture-1',
                'stores': [{'store_id': str(self.store.pk), 'provider': 'OZON', 'verified_identity': self.store.verified_identity,
                    'credential_revision': 1, 'credentials': credentials,
                    'runtime_store': {'id': 'native-store', 'platform': 'ozon', 'identity': 'native-cabinet',
                        'access_revision': 'store-1', 'source_revision': 'source-1', 'currency': 'RUB'}}]}]}
        bindings.write_text(json.dumps(mapping)); bindings.chmod(0o600)
        self.authority = RuntimeAuthority(BindingFile(str(bindings), owner_uid=os.getuid()),
            service_id=mapping['service_id'], catalog_release_id=mapping['catalog_release_id'])
        self.pins, self.scope, _ = self.authority.state(str(self.customer.pk), str(self.tenant.pk), [str(self.store.pk)])
        self.question = 'Synthetic full Ozon forecast'
        continuation = rpc.remember(SessionPrincipal(self.token), 'WEB', self.question)
        self.query = Query.objects.create(id=uuid.uuid4(), tenant=self.tenant, customer=self.customer,
            store_ids=[str(self.store.pk)], input_hash=query.digest(self.question), runtime_job_ref=uuid.uuid4(),
            state='RUNNING', channel='WEB', created_at=now, expires_at=now+timedelta(days=1), continuation=continuation)
        self.job_id = 'synthetic-native-job'
        self.facts = {'product_map': {}, 'entries': [self.entry('unit_cost', '250', 'all-products')]}
        self.approve()

    def entry(self, field, value, entity, period=None):
        return {'id': str(uuid.uuid4()), 'field': field, 'entity': entity, 'currency': 'RUB',
                'period': deepcopy(period), 'state': 'VALUE' if value is not None else 'NOT_PROVIDED', 'value': value}

    def approve(self):
        previous = OwnerDataset.objects.filter(store=self.store).first()
        return owner.execute(self.token, {'action': 'approve', 'store_id': str(self.store.pk),
            'command_id': str(uuid.uuid4()), 'expected_revision': previous.revision if previous else 0,
            'confirmed': True, 'facts': self.facts, 'not_after': int(timezone.now().timestamp())+120})

    def delivery(self, value='100', revision=0, area=None):
        command = self.command(value=value, revision=revision, area=area)
        command.update(parameter='delivery_mean', unit='RUB/ordered_unit')
        return parameters.execute(self.token, command)

    def filled(self):
        self.save('0.2'); self.delivery()

    def payload(self, index=0, template=None):
        return {'method': 'report_bind', 'query_id': str(self.query.pk), 'pins': deepcopy(self.pins),
                'template_id': template or query.TEMPLATE, 'invocation_id': 'forecast:owner:'+str(index),
                'runtime_store_id': 'native-store', 'input': {'period': deepcopy(PERIOD)},
                'question_hash': query.digest(self.question), 'job_id': self.job_id}

    def bound(self, index=0):
        return query.bind(self.authority, self.payload(index))['reference']

    def readset(self, rows=None, *, index=0, distinct=None, original=None):
        rows = [{'sku': '101', 'day': DAY}] if rows is None else rows
        count = len(rows) if distinct is None else distinct
        return {'schema': query.READSET_SCHEMA, 'scope': {'tenant_id': 'native-tenant', 'store_id': 'native-store',
                'provider': 'OZON', 'currency': 'RUB'}, 'period': deepcopy(PERIOD),
                'order_definition_hash': query.orders.HASH, 'order_normalizer_sha256': query.ORDER_NORMALIZER_SHA256,
                'orders_block_sha256': 'a'*64, 'orders_checkpoint_sha256': 'b'*64, 'receipt_set_sha256': 'c'*64,
                'original_row_count': count if original is None else original, 'distinct_read_count': count,
                'batch': {'index': index, 'total': max(1, (count+query.BATCH_SIZE-1)//query.BATCH_SIZE)},
                'rows': deepcopy(rows)}

    def get(self, reference=None, readset=None):
        return query.inputs(self.authority, reference or self.bound(), self.job_id,
                            self.readset() if readset is None else readset)

    def node(self, reference):
        self.query.refresh_from_db()
        return self.query.continuation[rpc.KEY][rpc._unsign(reference)['node_id']]

    def state(self):
        return (list(CurrentParameter.objects.order_by('id').values()), list(OwnerCommand.objects.order_by('id').values()),
                list(OwnerDataset.objects.values('revision', 'content_hash')))


@override_settings(**FLAGS)
class QueryCurrent(QueryFixture, TestCase):
    def test_existing_query_principal_reads_without_plaintext_token_or_value_writes(self):
        self.filled(); before = self.state(); reference = self.bound()
        with patch('alisa_platform.owner_data.source.actor_store', side_effect=AssertionError('NO_TOKEN_REAUTH')), \
             patch('alisa_platform.stores.service.principal', side_effect=AssertionError('NO_TOKEN_PRINCIPAL')):
            result = self.get(reference)
        self.assertTrue(result['ready']); self.assertEqual(before, self.state())
        self.assertEqual(result['unit_costs'], {'["101","2026-11-13"]': '250'})
        self.assertEqual(result['coefficients']['["101","2026-11-13"]'], {'loss_rate': '0.2', 'delivery_mean': '100'})
        self.assertEqual(query.current(self.authority, reference), {'current': True})

    def test_bind_is_idempotent_but_cannot_change_job(self):
        first = self.bound(); self.assertEqual(first, self.bound())
        payload = self.payload(); payload['job_id'] = 'different-job'
        with self.assertRaisesRegex(owner.Rejected, 'PARAMETER_JOB_MISMATCH'): query.bind(self.authority, payload)

    def test_current_preflight_before_readset_exposes_no_values_or_parameter_work(self):
        reference = self.bound(); before = self.state()
        with patch.object(parameters, '_read', side_effect=AssertionError('NO_COEFFICIENT_READ')), \
             patch.object(query.current_owner, '_owner_value', side_effect=AssertionError('NO_OWNER_VALUE_RESOLUTION')):
            self.assertEqual(query.current(self.authority, reference), {'current': True})
        self.assertEqual(before, self.state()); node = self.node(reference)
        self.assertNotIn('owner_readset', node); self.assertEqual(node['dependencies'], {})

    def test_current_preflight_rejects_disabled_owner_data_before_readset(self):
        reference = self.bound()
        with override_settings(OWNER_DATA_ENABLED=False):
            with self.assertRaisesRegex(owner.Rejected, 'OWNER_SOURCE_DISABLED'):
                query.current(self.authority, reference)
        self.assertNotIn('owner_readset', self.node(reference))

    def test_current_preflight_rejects_unapproved_owner_data_before_readset(self):
        reference = self.bound(); OwnerDataset.objects.filter(store=self.store).update(status='REVOKED')
        with self.assertRaisesRegex(owner.Rejected, 'OWNER_SOURCE_NOT_APPROVED'):
            query.current(self.authority, reference)
        self.assertNotIn('owner_readset', self.node(reference))

    def test_current_preflight_keeps_strict_owner_credential_policy_before_readset(self):
        reference = self.bound()
        CredentialRevision.objects.filter(kind='PERFORMANCE').update(check_code='CONNECTED_NATIVE_OWNER')
        # Existing runtime pins still resolve; the stricter owner source policy
        # is independently enforced before the native parent can send a request.
        self.authority.resolve(self.pins, 'execute')
        with self.assertRaisesRegex(owner.Rejected, 'OWNER_SOURCE_CREDENTIAL_UNQUALIFIED'):
            query.current(self.authority, reference)
        self.assertNotIn('owner_readset', self.node(reference))

    def test_all_full_nodes_of_one_query_remain_bound_to_the_same_native_job(self):
        self.bound(0); payload = self.payload(1); payload['job_id'] = 'foreign-native-job'
        with self.assertRaisesRegex(owner.Rejected, 'PARAMETER_JOB_MISMATCH'): query.bind(self.authority, payload)
        self.query.refresh_from_db(); self.assertEqual(len(self.query.continuation[rpc.KEY]), 1)
        self.bound(1); self.query.refresh_from_db(); self.assertEqual(len(self.query.continuation[rpc.KEY]), 2)

    def test_old_delivery_reference_cannot_read_owner_values(self):
        self.filled()
        old = rpc.dispatch(self.authority, self.payload(template='economics.delivery_projection.v1'))['reference']
        for operation in (lambda: query.current(self.authority, old), lambda: self.get(old),
                          lambda: query.fence(self.authority, old, {})):
            with self.assertRaises((owner.Rejected, query.pc.ParameterError)): operation()

    def test_producer_reference_is_not_a_full_report_read_authority(self):
        result = self.get(); producer = result['producers'][0]['intent']['intent_ref']
        with self.assertRaisesRegex(owner.Rejected, 'ECONOMICS_QUERY_REFERENCE'): self.get(producer)

    def test_unknown_template_and_arbitrary_owner_fields_cannot_be_bound(self):
        payload = self.payload(); payload['template_id'] = 'arbitrary.owner.reader'
        with self.assertRaises(owner.Rejected): query.bind(self.authority, payload)
        payload = self.payload(); payload['owner_fields'] = ['unit_cost']
        with self.assertRaises(query.pc.ParameterError): query.bind(self.authority, payload)

    def test_parameter_periods_cannot_persist_arbitrary_values_or_unknown_slots(self):
        requests = [{'unit_cost': '273.4567'}, {'arbitrary': {'months': 6}}, {'loss_rate': '0.2'},
                    {'loss_rate': None}, {'loss_rate': {'value': '0.2'}},
                    {'loss_rate': {'months': True}}, {'loss_rate': {'months': 6, 'value': '0.2'}}]
        for periods in requests:
            payload = self.payload(); payload['input']['parameter_periods'] = periods
            with self.assertRaises((owner.Rejected, query.pc.ParameterError)): query.bind(self.authority, payload)
        self.query.refresh_from_db(); self.assertNotIn(rpc.KEY, self.query.continuation)

    def test_bad_period_request_is_rejected_even_for_saved_values_or_empty_cohort(self):
        self.filled(); payload = self.payload(); payload['input']['parameter_periods'] = {'loss_rate': '0.2'}
        with self.assertRaises((owner.Rejected, query.pc.ParameterError)):
            self.get(query.bind(self.authority, payload)['reference'])
        payload['input']['parameter_periods'] = {'delivery_mean': {'arbitrary': '101.612345'}}
        with self.assertRaises((owner.Rejected, query.pc.ParameterError)):
            self.get(query.bind(self.authority, payload)['reference'], self.readset([]))
        self.query.refresh_from_db(); self.assertNotIn(rpc.KEY, self.query.continuation)

    def test_valid_independent_coefficient_period_requests_are_metadata_only(self):
        payload = self.payload(); payload['input']['parameter_periods'] = {'loss_rate': {'months': 6}}
        reference = query.bind(self.authority, payload)['reference']; result = self.get(reference)
        self.assertEqual(self.node(reference)['descriptor']['input']['parameter_periods'], {'loss_rate': {'months': 6}})
        loss = next(p for p in result['producers'] if p['key'] == 'loss_rate')
        anchor = self.node(reference)['descriptor']['anchor']
        from datetime import date
        expected = query.pc.resolve_period(date.fromisoformat(anchor), {'months': 6})
        self.assertEqual(loss['period'], expected)

    def test_wrong_question_job_and_platform_as_runtime_store_are_rejected(self):
        payload = self.payload(); payload['question_hash'] = '0'*64
        with self.assertRaises(owner.Rejected): query.bind(self.authority, payload)
        payload = self.payload(); payload['runtime_store_id'] = str(self.store.pk)
        with self.assertRaises(owner.Rejected): query.bind(self.authority, payload)
        reference = self.bound()
        with self.assertRaisesRegex(owner.Rejected, 'PARAMETER_JOB_MISMATCH'):
            query.inputs(self.authority, reference, 'foreign-job', self.readset())

    def test_changed_native_tenant_mapping_rejects_old_reference_with_same_platform_pins(self):
        reference = self.bound(); mapping = json.loads(self.bindings.read_text())
        mapping['tenants'][0]['runtime_tenant'] = 'other-native-tenant'
        mapping['tenants'][0]['revision'] = 'fixture-2'
        self.bindings.write_text(json.dumps(mapping))
        self.assertEqual(self.authority.resolve(self.pins, 'execute')['tenant'], 'other-native-tenant')
        for operation in (lambda: query.current(self.authority, reference), lambda: self.get(reference)):
            with self.assertRaisesRegex(owner.Rejected, 'PERMISSION_DENIED'): operation()
        self.assertNotIn('owner_readset', self.node(reference))

    def test_source_scope_and_period_are_exact_runtime_scope(self):
        reference = self.bound()
        for mutate in (lambda r: r['scope'].update(store_id=str(self.store.pk)),
                       lambda r: r['scope'].update(tenant_id=str(self.tenant.pk)),
                       lambda r: r['period'].update(**{'from': '2026-11-11'})):
            value = self.readset(); mutate(value)
            with self.assertRaisesRegex(owner.Rejected, 'ECONOMICS_READSET_SCOPE'): self.get(reference, value)

    def test_readset_does_not_accept_qualified_flags_prices_or_postings(self):
        reference = self.bound()
        for mutate in (lambda r: r.update(qualified=True), lambda r: r['rows'][0].update(price='1'),
                       lambda r: r['rows'][0].update(posting='private-posting'),
                       lambda r: r.update(schema='alisa-qualified-cohort/v1')):
            value = self.readset(); mutate(value)
            with self.assertRaises((owner.Rejected, query.pc.ParameterError)): self.get(reference, value)

    def test_compiled_source_contract_and_hashed_receipt_attestations_are_required(self):
        reference = self.bound()
        for field in ('order_definition_hash', 'order_normalizer_sha256', 'receipt_set_sha256', 'orders_block_sha256'):
            value = self.readset(); value[field] = 'unqualified'
            with self.assertRaises(owner.Rejected): self.get(reference, value)

    def test_invalid_count_batch_order_duplicate_and_day_are_rejected(self):
        reference = self.bound()
        cases = [lambda r: r.update(original_row_count=True), lambda r: r.update(distinct_read_count=65),
                 lambda r: r['batch'].update(index=1), lambda r: r['batch'].update(total=True),
                 lambda r: r['rows'][0].update(day='2026-11-14'), lambda r: r['rows'][0].update(sku=101)]
        for mutate in cases:
            value = self.readset(); mutate(value)
            with self.assertRaises((owner.Rejected, query.pc.ParameterError)): self.get(reference, value)
        duplicate = self.readset([{'sku': '101', 'day': DAY}]*2)
        with self.assertRaises(owner.Rejected): self.get(reference, duplicate)
        unsorted = self.readset([{'sku': '102', 'day': DAY}, {'sku': '101', 'day': DAY}])
        with self.assertRaises(owner.Rejected): self.get(reference, unsorted)

    def test_first_source_binding_is_immutable_even_with_same_rowcount(self):
        reference = self.bound(); self.get(reference)
        value = self.readset(); value['rows'][0]['sku'] = '102'
        with self.assertRaisesRegex(owner.Rejected, 'ECONOMICS_READSET_CHANGED'): self.get(reference, value)
        value = self.readset(); value['orders_block_sha256'] = 'f'*64
        with self.assertRaisesRegex(owner.Rejected, 'ECONOMICS_READSET_CHANGED'): self.get(reference, value)

    def test_more_than_sixtyfour_distinct_reads_use_multiple_nodes_without_total_cap(self):
        self.filled(); rows = [{'sku': str(i), 'day': DAY} for i in range(100, 165)]
        first = self.get(self.bound(0), self.readset(rows[:64], distinct=65, original=1000))
        second = self.get(self.bound(1), self.readset(rows[64:], index=1, distinct=65, original=1000))
        self.assertTrue(first['ready'] and second['ready'])
        self.assertEqual(len(first['coefficients'])+len(second['coefficients']), 65)
        self.assertEqual(first['checkpoint']['owner'], second['checkpoint']['owner'])

    def test_empty_cohort_reads_exact_period_owner_amounts_without_parameter_jobs(self):
        result = self.get(readset=self.readset([]))
        self.assertTrue(result['ready']); self.assertEqual(result['coefficients'], {})
        self.assertEqual(result['producers'], []); self.assertEqual(result['unit_costs'], {})
        self.assertIsNone(result['owner_period']['tax_amount']['value'])
        self.assertEqual(CurrentParameter.objects.count(), 0)

    def test_sku_current_coefficient_overrides_store_and_zero_is_current(self):
        self.filled(); self.save('0', area={'kind': 'sku', 'sku': '101'})
        result = self.get(); self.assertTrue(result['ready']); self.assertEqual(result['producers'], [])
        self.assertEqual(result['coefficients']['["101","2026-11-13"]']['loss_rate'], '0')

    def test_each_sku_consumer_is_checked_before_shared_read_deduplication(self):
        rows = [{'sku': '101', 'day': '2026-11-12'}, {'sku': '101', 'day': DAY}]
        original = parameters.sku_reference; calls = []
        def proof(*args):
            calls.append(True); return original(*args) if len(calls) == 1 else 'forged'
        with patch.object(parameters, 'sku_reference', side_effect=proof), patch.object(parameters, '_read', wraps=parameters._read) as read:
            with self.assertRaises(owner.Rejected): self.get(readset=self.readset(rows))
        self.assertEqual(read.call_count, 0)

    def test_unit_cost_by_sku_and_order_day_preserves_explicit_zero(self):
        self.filled(); self.facts['product_map']['101'] = 'sku:101'
        self.facts['entries'].extend([self.entry('unit_cost', '0', 'sku:101', {'from': '2026-11-12', 'to': '2026-11-12'}),
                                     self.entry('unit_cost', '333', 'sku:101', {'from': DAY, 'to': DAY})]); self.approve()
        rows = [{'sku': '101', 'day': '2026-11-12'}, {'sku': '101', 'day': DAY}]
        result = self.get(readset=self.readset(rows)); self.assertTrue(result['ready'])
        self.assertEqual(result['unit_costs'], {'["101","2026-11-12"]': '0', '["101","2026-11-13"]': '333'})

    def test_unknown_sku_cost_does_not_fall_back_to_general(self):
        self.filled(); self.facts['product_map']['101'] = 'sku:101'
        self.facts['entries'].append(self.entry('unit_cost', None, 'sku:101')); self.approve()
        result = self.get(); self.assertFalse(result['ready']); self.assertEqual(result['unit_costs'], {})
        self.assertEqual(result['missing_owner'][0]['sku'], '101')

    def test_tax_and_own_cost_require_exact_report_period_and_unknown_is_not_zero(self):
        self.filled(); entity = 'store:'+str(self.store.pk)
        self.facts['entries'].extend([self.entry('tax_amount', '3000', entity, {'from': '2026-11-01', 'to': '2026-11-30'}),
                                     self.entry('own_cost_amount', '0', entity, PERIOD)]); self.approve()
        result = self.get()
        self.assertEqual(result['owner_period']['tax_amount'], {'state': 'NOT_PROVIDED', 'value': None})
        self.assertEqual(result['owner_period']['own_cost_amount'], {'state': 'VALUE', 'value': '0'})

    def test_missing_coefficients_only_admit_shared_general_plans(self):
        before = self.state(); reference = self.bound()
        rows = [{'sku': '101', 'day': DAY}, {'sku': '102', 'day': DAY}]
        result = self.get(reference, self.readset(rows))
        self.assertFalse(result['ready']); self.assertIsNone(result['coefficients'])
        self.assertEqual({p['key'] for p in result['producers']}, {'loss_rate', 'delivery_mean'})
        self.assertTrue(all(p['target']['scope'] == {'kind': 'store', 'sku': ''} for p in result['producers']))
        self.assertEqual(before, self.state()); self.assertEqual(len(self.node(reference)['dependencies']), 2)

    def test_existing_report_fill_preserves_manual_value_and_rebinds_current(self):
        self.delivery(); reference = self.bound(); initial = self.get(reference)
        producer = initial['producers'][0]; self.assertEqual(producer['key'], 'loss_rate')
        self.save('0.17')
        envelope = self.envelope(); envelope['coverage']['actual_period'] = producer['period']['actual']
        envelope['coverage']['short_history'] = producer['period']['short_history']
        reply = rpc.dispatch(self.authority, {'method': 'report_fill', 'reference': producer['intent']['intent_ref'],
            'target': producer['target'], 'period': producer['period'], 'envelope': envelope,
            'envelope_sha256': query.digest(envelope), 'job_id': self.job_id})
        self.assertTrue(reply['saved']); self.assertFalse(reply['written'])
        self.assertEqual(self.get(reference)['coefficients']['["101","2026-11-13"]']['loss_rate'], '0.17')

    def test_owner_and_parameter_revisions_fence_original_generation(self):
        self.filled(); reference = self.bound(); initial = self.get(reference)
        self.assertTrue(query.fence(self.authority, reference, initial['checkpoint'])['current'])
        self.save('0.3', 1)
        self.assertFalse(query.fence(self.authority, reference, initial['checkpoint'])['current'])
        rebound = self.get(reference); self.facts['entries'][0]['value'] = '300'; self.approve()
        self.assertFalse(query.fence(self.authority, reference, rebound['checkpoint'])['current'])
        self.assertEqual(self.get(reference)['unit_costs']['["101","2026-11-13"]'], '300')

    def test_fence_is_read_only_and_does_not_accept_bool_for_integer_pin(self):
        self.filled(); reference = self.bound(); result = self.get(reference)
        self.query.refresh_from_db(); before = (self.state(), deepcopy(self.query.continuation))
        self.assertTrue(query.fence(self.authority, reference, result['checkpoint'])['current'])
        forged = deepcopy(result['checkpoint']); forged['owner']['revision'] = True
        self.assertFalse(query.fence(self.authority, reference, forged)['current'])
        self.query.refresh_from_db(); self.assertEqual(before, (self.state(), self.query.continuation))

    def test_saved_readset_is_metadata_only_and_old_numbers_are_not_retained(self):
        self.save('0.083721'); self.delivery('101.612345'); self.facts['entries'][0]['value'] = '273.4567'; self.approve()
        reference = self.bound(); result = self.get(reference); self.query.refresh_from_db()
        for value in (self.query.continuation, result['checkpoint']):
            text = json.dumps(value)
            for secret in (self.token, '0.083721', '101.612345', '273.4567', 'SYNTHETIC-NOT-DECRYPTED'):
                self.assertNotIn(secret, text)
        self.assertEqual(set(self.node(reference)['owner_readset']['readset']['rows'][0]), {'sku', 'day'})

    def test_cancel_expiry_session_revoke_and_token_rotation_deny_current_authority(self):
        reference = self.bound(); self.query.state = 'CANCELLED'; self.query.save(update_fields=['state'])
        with self.assertRaises(owner.Rejected): query.current(self.authority, reference)
        self.query.state = 'RUNNING'; self.query.expires_at = timezone.now()-timedelta(seconds=1)
        self.query.save(update_fields=['state', 'expires_at'])
        with self.assertRaises(owner.Rejected): query.current(self.authority, reference)
        self.query.expires_at = timezone.now()+timedelta(days=1); self.query.save(update_fields=['expires_at'])
        self.session.token_hash = 'f'*64; self.session.save(update_fields=['token_hash'])
        with self.assertRaises(RuntimeFailure): query.current(self.authority, reference)

    def test_revoked_principal_cannot_use_captured_source_or_checkpoint(self):
        self.filled(); reference = self.bound(); result = self.get(reference)
        source = query._QueryOwnerSource(self.authority, reference)
        self.assertFalse(hasattr(source, '_token'))
        self.session.revoked_at = timezone.now(); self.session.save(update_fields=['revoked_at'])
        for operation in (source.current, lambda: self.get(reference), lambda: query.fence(self.authority, reference, result['checkpoint'])):
            with self.assertRaises(RuntimeFailure): operation()

    def test_entitlement_and_strict_existing_credential_policy_remain_required(self):
        reference = self.bound()
        CredentialRevision.objects.filter(kind='PERFORMANCE').update(check_code='CONNECTED_NATIVE_OWNER')
        with self.assertRaisesRegex(owner.Rejected, 'OWNER_SOURCE_CREDENTIAL_UNQUALIFIED'): self.get(reference)
        CredentialRevision.objects.filter(kind='PERFORMANCE').update(check_code='CONNECTED')
        AccessAdjustment.objects.create(id=uuid.uuid4(), grant=self.grant, cutoff=timezone.now(),
                                         actor_id=uuid.uuid4(), reason='SYNTHETIC_REVOKE')
        with self.assertRaises(RuntimeFailure): self.get(reference)

    def test_new_feature_gate_covers_current_inputs_and_existing_producer_fill(self):
        reference = self.bound(); producer = self.get(reference)['producers'][0]
        with override_settings(OWNER_ECONOMICS_COMPOSITES_ENABLED=False):
            for operation in (lambda: query.current(self.authority, reference), lambda: self.get(reference),
                              lambda: rpc.dispatch(self.authority, {'method': 'report_dependency_current',
                                  'reference': producer['intent']['intent_ref'], 'target': producer['target'], 'period': producer['period']})):
                with self.assertRaisesRegex(owner.Rejected, 'ECONOMICS_QUERY_DISABLED'): operation()


@override_settings(**FLAGS)
class QuerySessionRace(QueryFixture, TransactionTestCase):
    def test_revocation_committed_between_principal_check_and_lock_is_rechecked(self):
        reference = self.bound(); original = rpc.principal_current; fired = []; writes = []
        def writer():
            try:
                with connections['default'].cursor() as cursor: cursor.execute("SET statement_timeout='3000ms'")
                writes.append(WebSession.objects.filter(pk=self.session.pk).update(revoked_at=timezone.now()))
            except Exception as error:
                writes.append(type(error).__name__)
            finally:
                connections.close_all()
        def validate(proof, pins):
            original(proof, pins)
            if not fired:
                fired.append(True); thread = Thread(target=writer, name='owned-economics-query-revoke')
                thread.start(); thread.join(5)
                self.assertFalse(thread.is_alive()); self.assertEqual(writes, [1])
        with patch.object(rpc, 'principal_current', side_effect=validate):
            with self.assertRaisesRegex(RuntimeFailure, 'AUTH_REQUIRED'): self.get(reference)
        self.session.refresh_from_db(); self.assertIsNotNone(self.session.revoked_at)
        self.assertNotIn('owner_readset', self.node(reference)); self.assertEqual(CurrentParameter.objects.count(), 0)
