"""Full-report recovery races through the existing Query, RPC and Worker.

Only model/provider replies are synthetic. These tests keep the real authority,
source receipts, encrypted progress, owner reads and final generation fences.
"""
from collections import Counter
from copy import deepcopy
from unittest.mock import patch

from django.test import TransactionTestCase, override_settings

from alisa_platform.owner_data import parameter_report_rpc as rpc
from alisa_platform.owner_data import parameter_service as parameters
from alisa_platform.owner_data.models import CurrentParameter
from alisa_platform.queries.models import Query
from economics_ledger.test_order_sources import posting
from repository import Deferred
from semantics import canonical_json, strict_json
import economics_report_runtime as full

from .test_composite_worker import CompositeFixture, DAY, quote


@override_settings(ALISA_ENV='synthetic', OWNER_ECONOMICS_COMPOSITES_ENABLED=True)
class CompositeRaces(CompositeFixture, TransactionTestCase):
    def test_program_resume_discards_original_generation_before_rebinding_without_source_repeats(self):
        self.filled(); self.e.engine.program_answers = True; self.start()
        generations, contexts, caches, provider_snapshots, discarded = [], [], [], [], []
        stale_text = 'STALE FULL FORECAST OUTPUT'
        fresh_text = 'CURRENT FULL FORECAST OUTPUT'

        def provider_requests():
            return [(item.operation, deepcopy(item.body))
                    for item in self.e.transport.calls if item.store_id]

        def program(worker, row, messages, data, **kwargs):
            generations.append(kwargs['generation'])
            contexts.append(deepcopy(data['compound_parameter_context'][0]['economics']))
            saved = strict_json(self.e.row()['progress'])
            caches.append(deepcopy(saved[full.CACHE]))
            provider_snapshots.append(provider_requests())
            self.assertTrue(caches[-1]); self.assertTrue(provider_snapshots[-1])
            if len(generations) == 1:
                # The real program runner persists this dispatch marker before
                # recovering an in-flight result under the same generation.
                with self.e.repo.connection(True) as connection:
                    latest = self.e.repo._owned(connection, row['id'], row['owner'])
                    progress = strict_json(latest['progress'])
                    progress['_program_started'] = True
                    connection.execute('UPDATE jobs SET progress=? WHERE id=?',
                                       (canonical_json(progress), row['id']))
                self.e.save('0.2', 1)
                raise Deferred(self.e.clock() + 1)
            self.assertEqual(provider_snapshots[-1], provider_snapshots[0])
            self.assertEqual(caches[-1], caches[0])
            if len(generations) == 2:
                self.assertEqual(generations[1], generations[0])
                kwargs['on_complete']({'content': stale_text, 'finish_reason': 'stop'})
                latest = self.e.row()
                self.assertIn(latest['state'], ('QUEUED', 'RUNNING'))
                self.assertIsNone(latest['result'])
                progress = strict_json(latest['progress'])
                self.assertNotIn('_program_started', progress)
                self.assertNotIn('_compound_answer_generation', progress)
                self.assertEqual(progress[full.CACHE], caches[0])
                discarded.append(True)
                return
            self.assertEqual(len(generations), 3)
            self.assertEqual(discarded, [True])
            self.assertNotEqual(generations[2], generations[1])
            kwargs['on_complete']({'content': fresh_text, 'finish_reason': 'stop'})

        with patch('model_program.selected', return_value=True), \
             patch('model_program.run', side_effect=program):
            row = self.ready()
        self.assertEqual(len(generations), 3)
        self.assertEqual(generations[0], generations[1])
        self.assertNotEqual(generations[1], generations[2])
        self.assertEqual(contexts[0]['scenarios']['with_loss']['totals']['expected_retained_units'], '2.8')
        self.assertEqual(contexts[2]['scenarios']['with_loss']['totals']['expected_retained_units'], '2.6')
        self.assertEqual(provider_requests(), provider_snapshots[0])
        self.assertIn(fresh_text, row['result']); self.assertNotIn(stale_text, row['result'])
        self.assertIsNone(row['progress']); self.assertEqual(Query.objects.count(), 1)
        with self.e.repo.connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 1)

    def test_active_second_batch_fill_survives_new_first_batch_gap_and_manual_value_wins(self):
        self.delivery('0')
        for sku in range(100, 108):
            self.e.save('0', area={'kind': 'sku', 'sku': str(sku)})
        self.e.transport.orders = {
            'fbo': [posting('fbo', 'PRIVATE-RACE-' + str(sku), sku, '100', 1)
                    for sku in range(100, 109)], 'fbs': []}
        self.e.transport.quotes = [quote(sku + 1000, 20, 10, 40, 0) for sku in range(100, 109)]
        self.e.transport.skus = {sku + 1000: sku for sku in range(100, 109)}
        self.e.transport.fees = {}; self.e.transport.records = []
        self.assertFalse(CurrentParameter.objects.filter(key='loss_rate', scope_kind='store').exists())
        active, cleared, manual, fills = {}, [], [], []
        child_operations = {'read.ozon.report_postings_create', 'read.ozon.report_info',
                            'read.ozon.report_file_get', 'read.ozon.returns_list'}

        def provider_requests():
            return [(item.operation, deepcopy(item.body))
                    for item in self.e.transport.calls if item.store_id]

        def during_source(request):
            if request.operation not in child_operations:
                return
            progress = strict_json(self.e.row()['progress'])
            state = progress['_compound_fill']
            if not active:
                self.assertEqual(request.operation, 'read.ozon.report_postings_create')
                self.assertIsNotNone(state['child_progress'])
                nodes = Query.objects.get().continuation[rpc.KEY]
                batches = {node['owner_readset']['readset']['batch']['index']: (node_id, node)
                           for node_id, node in nodes.items() if 'owner_readset' in node}
                self.assertEqual(set(batches), {0, 1})
                self.assertEqual(len(batches[0][1]['owner_readset']['readset']['rows']), 8)
                self.assertEqual(batches[1][1]['owner_readset']['readset']['rows'],
                                 [{'sku': '108', 'day': DAY}])
                self.assertEqual(rpc._unsign(state['reference'])['node_id'], batches[1][0])
                source = state['fragment']['plan']['parameter_source']
                self.assertEqual(source['key'], 'loss_rate')
                self.assertEqual(source['target']['scope'], {'kind': 'store', 'sku': ''})
                self.assertEqual(source['intent']['mode'], 'fill_missing')
                producer_ref = source['intent']['intent_ref']
                self.assertEqual(rpc._unsign(producer_ref)['node_id'], batches[1][0])
                active.update(reference=state['reference'], fragment=deepcopy(state['fragment']),
                              producer_ref=producer_ref, job_id=self.e.row()['id'],
                              full_requests=provider_requests()[:-1])
                self.assertTrue(active['full_requests'])
                # Batch 1 already owns the protected child. Removing a batch 0
                # override now makes its earlier read newly missing on resume.
                parameters.execute(self.e.token, self.e.command(
                    'use_general', revision=1, area={'kind': 'sku', 'sku': '100'}))
                self.assertIsNone(self.e.read({'kind': 'sku', 'sku': '100'})['effective'])
                self.assertFalse(CurrentParameter.objects.filter(key='loss_rate', scope_kind='store').exists())
                cleared.append(True)
            else:
                self.assertEqual(state['reference'], active['reference'])
                self.assertEqual(state['fragment'], active['fragment'])
            if request.operation == 'read.ozon.returns_list' and not manual:
                self.assertEqual(cleared, [True])
                self.e.save('0.2'); manual.append(True)

        api = self.e.engine.parameter_intent_authority
        real_call = api.call

        def observe_rpc(payload):
            reply = real_call(payload)
            if payload.get('method') == 'report_fill':
                fills.append((deepcopy(payload), deepcopy(reply)))
            return reply

        self.e.transport.on_call = during_source
        self.start()
        with patch.object(api, 'call', side_effect=observe_rpc):
            row = self.ready()
        self.assertEqual(cleared, [True]); self.assertEqual(manual, [True])
        self.assertEqual(len(fills), 1)
        payload, reply = fills[0]
        self.assertEqual(payload['reference'], active['producer_ref'])
        self.assertEqual(payload['job_id'], active['job_id'])
        self.assertEqual(payload['target'], active['fragment']['plan']['parameter_source']['target'])
        self.assertEqual(payload['period'], active['fragment']['plan']['parameter_source']['period'])
        self.assertTrue(reply['saved']); self.assertFalse(reply['written'])
        general = CurrentParameter.objects.get(key='loss_rate', scope_kind='store')
        self.assertEqual((general.value, general.origin, general.revision), ('0.2', 'manual', 1))
        exception = CurrentParameter.objects.get(key='loss_rate', scope_kind='sku', sku='100')
        self.assertEqual((exception.state, exception.value, exception.revision), ('INHERIT', None, 2))
        self.assertEqual(self.context()['scenarios']['with_loss']['totals']['expected_retained_units'], '8.6')
        requests = provider_requests(); prefix = len(active['full_requests'])
        self.assertEqual(requests[:prefix], active['full_requests'])
        self.assertEqual(Counter(operation for operation, _ in requests[prefix:]),
                         Counter({operation: 2 for operation in child_operations}))
        self.assertIsNone(row['progress']); self.assertEqual(Query.objects.count(), 1)
        with self.e.repo.connection() as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM jobs').fetchone()[0], 1)
