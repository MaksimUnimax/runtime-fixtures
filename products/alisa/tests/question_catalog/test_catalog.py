"""Actual compiler and temporary SQLite; never marketplace/model IO."""
from copy import deepcopy
from dataclasses import replace
from unittest.mock import patch
import unittest
import runtime_port_ipc
from runtime_port import Peer
from runtime_port_contract import PRODUCT, CONTRACT
from semantics import Rejected
from test_runtime_port_r01_contract import Setup
import template_catalog
import question_catalog_extension as extension
from alisa_platform.catalog.reader import validate, read as read_client
from alisa_platform.runtime_adapter.job_client import RuntimeFailure


class Catalogue(Setup):
    def setUp(self):
        super().setUp()
        self.engine.template_mode = True
        self.full_scope, self.full_context = self.auth.scope, deepcopy(self.ctx)
        self.auth.scope = replace(self.auth.scope, stores=self.auth.scope.stores[:1])
        self.ctx['store_scope'] = self.ctx['store_scope'][:1]
        self.ctx = self.auth.issue(self.ctx)

    def test_every_installed_template_has_metadata(self):
        value = extension.read(self.port, self.peer)
        self.assertEqual({x['id'] for x in value['items']}, set(template_catalog.TEMPLATES))
        self.assertEqual(value['template_hash'], template_catalog.HASH)
        validate(value, self.port.versions_for(self.peer), False)

    def test_customer_projection_has_no_execution_or_secrets(self):
        value = extension.read(self.port, self.peer, self.ctx)
        validate(value, self.port.versions_for(self.peer), True)
        forbidden = {'notes', 'params', 'credentials', 'execution_ticket', 'sources', 'metrics'}
        self.assertTrue(all(not forbidden.intersection(row) for row in value['items']))

    def test_read_never_creates_job_or_calls_transport(self):
        before = {name: self.count(name) for name in ['jobs', 'inbox', 'rt_job_refs', 'rt_job_receipts']}
        extension.read(self.port, self.peer, self.ctx)
        self.assertEqual(before, {name: self.count(name) for name in before})
        self.assertEqual(self.transport.calls, [])

    def test_actual_scalar_is_eligible(self):
        value = extension.read(self.port, self.peer, self.ctx)
        row = next(x for x in value['items'] if x['id'] == 'B01.ordered_units')
        self.assertTrue(any(x['status'] == 'ELIGIBLE' for x in row['availability']))

    def test_scoped_page_is_bounded_and_has_continuation(self):
        value = extension.read(self.port, self.peer, self.ctx)
        self.assertLessEqual(len(value['items']), 10)
        self.assertGreater(value['total'], 10)
        self.assertEqual(value['next_offset'], 10)
        other = extension.read(self.port, self.peer, self.ctx, {'search': '', 'kind': '', 'offset': 10})
        self.assertFalse({x['id'] for x in value['items']} & {x['id'] for x in other['items']})
        validate(other, self.port.versions_for(self.peer), True)

    def test_search_uses_published_metadata_before_compilation(self):
        value = extension.read(self.port, self.peer, self.ctx, {'search': 'B01.ordered_units', 'kind': '', 'offset': 0})
        self.assertEqual([row['id'] for row in value['items']], ['B01.ordered_units'])

    def test_unknown_offset_and_bad_filter_do_not_create_job(self):
        for query in [{'search':'','kind':[],'offset':0}, {'search':'','kind':'','offset':True}]:
            self.reject('VALIDATION_FAILED', lambda: extension.read(self.port, self.peer, self.ctx, query))
        self.assertEqual(self.count('jobs'), 0)

    def test_multiple_store_fanout_is_rejected(self):
        self.auth.scope = self.full_scope
        self.full_context = self.auth.issue(self.full_context)
        self.reject('VALIDATION_FAILED', lambda: extension.read(self.port, self.peer, self.full_context))

    def test_page_deadline_stops_before_next_compile(self):
        with patch.object(extension.time, 'monotonic', side_effect=[0.0, 2.0]):
            self.reject('DEPENDENCY_UNAVAILABLE', lambda: extension.read(self.port, self.peer, self.ctx))
        self.assertEqual(self.count('jobs'), 0)

    def test_non_template_runtime_does_not_advertise_support(self):
        self.engine.template_mode = False
        self.reject('CAPABILITY_UNAVAILABLE', lambda: extension.read(self.port, self.peer))

    def test_unqualified_dataset_is_unavailable(self):
        value = extension.read(self.port, self.peer, self.ctx, {'search': 'product_registry', 'kind': '', 'offset': 0})
        row = next(x for x in value['items'] if x['id'] == 'product_registry')
        self.assertTrue(row['availability'])
        self.assertTrue(all(x['status'] == 'UNAVAILABLE' for x in row['availability']))

    def test_peer_is_required_for_metadata(self):
        self.reject('AUTH_REQUIRED', lambda: extension.read(self.port, Peer('wrong', PRODUCT)))

    def test_revoked_access_does_not_return_scoped_metadata(self):
        self.auth.revoked = True
        with self.assertRaises(Rejected): extension.read(self.port, self.peer, self.ctx)

    def test_authority_failure_is_not_empty_catalogue(self):
        self.auth.down = True
        self.reject('DEPENDENCY_UNAVAILABLE', lambda: extension.read(self.port, self.peer, self.ctx))

    def test_install_preserves_previous_dispatch(self):
        previous = runtime_port_ipc.dispatch
        try:
            extension.install(); wrapped = runtime_port_ipc.dispatch
            extension.install(); self.assertIs(runtime_port_ipc.dispatch, wrapped)
            self.assertEqual(wrapped(self.port, self.peer, {'schema_version': CONTRACT,
                'operation': 'current_versions', 'payload': {}}), self.port.versions_for(self.peer))
        finally: runtime_port_ipc.dispatch = previous

    def test_scoped_operation_cannot_request_public_projection_with_null(self):
        previous = runtime_port_ipc.dispatch
        try:
            extension.install()
            self.reject('VALIDATION_FAILED', lambda: runtime_port_ipc.dispatch(self.port, self.peer,
                {'schema_version': CONTRACT, 'operation': 'question_catalog', 'payload': {'context': None, 'query': {'search':'','kind':'','offset':0}}}))
        finally: runtime_port_ipc.dispatch = previous

    def test_catalogue_contract_rejects_foreign_version(self):
        value = extension.read(self.port, self.peer)
        versions = deepcopy(value['versions']); versions['registry_hash'] = '0' * 64
        with self.assertRaises(RuntimeFailure): validate(value, versions, False)

    def test_catalogue_contract_rejects_duplicate_template(self):
        value = extension.read(self.port, self.peer); value['items'].append(deepcopy(value['items'][0]))
        with self.assertRaises(RuntimeFailure): validate(value, self.port.versions_for(self.peer), False)

    def test_catalogue_contract_rejects_unknown_dependencies(self):
        value = extension.read(self.port, self.peer); value['items'][0]['dependencies'].append('draft-unknown')
        with self.assertRaises(RuntimeFailure): validate(value, self.port.versions_for(self.peer), False)

    def test_catalogue_contract_rejects_prompt_field(self):
        value = extension.read(self.port, self.peer); value['items'][0]['notes'] = ['private']
        with self.assertRaises(RuntimeFailure): validate(value, self.port.versions_for(self.peer), False)

    def test_parameter_metadata_has_declared_unit(self):
        value=extension.read(self.port,self.peer)
        rows=[x for x in value['items']if x['kind']=='parameter']
        if not rows:self.skipTest('Parameter addon not present in this standalone runtime fixture')
        self.assertEqual({x['id']for x in rows},{'parameter.loss_rate.v1','parameter.delivery_mean.v1'})
        self.assertTrue(all(x['units']for x in rows))
        validate(value,self.port.versions_for(self.peer),False)

    def test_parameter_catalog_dry_compile_never_collects(self):
        import importlib.util
        if importlib.util.find_spec('parameter_source_runtime')is None:self.skipTest('Requires qualified parameter runtime addon')
        import parameter_source_runtime as parameters
        self.engine.parameter_source_policy={'enabled':True,'pin':parameters.PIN}
        before={n:self.count(n)for n in ['jobs','calls','inbox']}
        value=extension.read(self.port,self.peer,self.ctx,{'search':'parameter.loss_rate.v1','kind':'parameter','offset':0})
        self.assertEqual(len(value['items']),1)
        self.assertEqual(value['items'][0]['availability'][0]['status'],'ELIGIBLE')
        self.assertEqual(before,{n:self.count(n)for n in before});self.assertEqual(self.transport.calls,[])


class Client(unittest.TestCase):
    def test_authority_revocation_after_read_discards_result(self):
        class Api:
            _pid = 1
            versions = {}
            class authorizer:
                @staticmethod
                def current(*args): return False
            def _context(self, operation): return {'operation': operation}
            def _exchange(self, operation, payload, validator): return {'page_offset': 0}
        with self.assertRaises(RuntimeFailure): read_client(Api(), scoped=True)


if __name__ == '__main__': unittest.main()
