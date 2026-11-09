"""Port integration with native plain answers; no live model or merchant I/O."""
from unittest.mock import patch

from test_runtime_port_r01_contract import Setup, uid
import test_runtime_port_current as current
from test_model_answer import Transport
from model_answer import Settings, DEFAULTS, PENDING, API_DATA
from engine import Worker, CallError
from semantics import Rejected, strict_json
import model_usage


class AnswerPort(Setup):
    row = current.CurrentCore.row
    run_until_terminal = current.CurrentCore.run_until_terminal

    def setUp(self):
        super().setUp()
        self.engine.answer_settings = Settings(self.root / 'answer-settings.json')
        self.repo.answer_settings = self.engine.answer_settings
        self.transport = Transport()
        self.worker = Worker(self.engine, self.transport)

    def pending(self):
        task, receipt = self.submit()
        self.worker.step(); self.clock.advance(3)
        row = self.row(receipt)
        self.assertEqual(row['state'], 'QUEUED', row['error'])
        self.assertIn(PENDING, strict_json(row['progress']))
        return task, receipt

    def test_original_question_prompts_same_queue_and_no_recompute(self):
        task, receipt = self.submit()
        row = self.run_until_terminal(receipt)
        self.assertEqual(row['state'], 'READY', row['error'])
        call = self.transport.answer_calls[0]
        self.assertEqual(call.body['messages'][0]['content'], DEFAULTS['answer_prompt'])
        self.assertEqual(call.body['messages'][1]['content'], task['query_input']['text'])
        self.assertIn('123.45', call.body['messages'][-1]['content'])
        self.assertEqual(model_usage.summary(self.repo)['attempts'], 1)
        before = len(self.transport.calls)
        result = self.port.read_result(receipt['job_ref'], self.ctx, self.peer)
        self.assertEqual(''.join(result['pages']), self.transport.answer)
        self.assertEqual(self.port.read_result(receipt['job_ref'], self.ctx, self.peer), result)
        self.assertEqual(len(self.transport.calls), before)
        with self.repo.connection() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM pointers').fetchone()[0], 0)

    def test_cancel_after_data_prevents_answer_call(self):
        _, receipt = self.pending()
        self.port.cancel(receipt['job_ref'], self.ctx, uid(), self.peer)
        self.assertFalse(self.worker.step())
        self.assertEqual(self.transport.answer_calls, [])
        self.assertEqual(model_usage.summary(self.repo)['attempts'], 0)

    def test_cancel_one_reader_keeps_shared_answer_for_other(self):
        _, first = self.submit(); _, second = self.submit()
        self.assertEqual(self.row(first)['id'], self.row(second)['id'])
        self.worker.step(); self.clock.advance(3)
        self.port.cancel(first['job_ref'], self.ctx, uid(), self.peer)
        self.assertEqual(self.run_until_terminal(second)['state'], 'READY')
        self.assertEqual(len(self.transport.answer_calls), 1)
        self.assertEqual(self.port.status(first['job_ref'], self.ctx, self.peer)['state'], 'CANCELLED')

    def test_revocation_after_data_prevents_answer_call(self):
        _, receipt = self.pending(); self.auth.revoked = True
        self.worker.step()
        self.assertEqual(self.row(receipt)['state'], 'FAILED')
        self.assertEqual(self.transport.answer_calls, [])
        self.assertEqual(model_usage.summary(self.repo)['attempts'], 0)

    def test_revocation_at_answer_dispatch_counts_no_paid_attempt(self):
        _, receipt = self.pending()
        def observed(request, store, on_dispatch):
            self.auth.revoked = True
            on_dispatch()
            self.fail('revoked answer sent')
        with patch.object(self.transport, 'execute_observed', observed):
            self.worker.step()
        self.assertEqual(self.row(receipt)['state'], 'FAILED')
        self.assertEqual(model_usage.summary(self.repo)['attempts'], 0)

    def test_last_reader_cancel_during_answer_authorization_prevents_send(self):
        _, receipt = self.pending()
        observed = self.transport.execute_observed
        def execute(request, store, on_dispatch):
            resolve = self.auth.resolve
            def cancel(pins, action):
                self.auth.resolve = resolve
                with self.repo.reader_scope(self.auth.scope.tenant, self.port.reader(receipt['job_ref'])):
                    self.repo.cancel(self.auth.scope.tenant)
                return resolve(pins, action)
            with patch.object(self.auth, 'resolve', cancel):
                return observed(request, store, on_dispatch)
        with patch.object(self.transport, 'execute_observed', execute):
            self.worker.step()
        self.assertEqual(self.row(receipt)['state'], 'CANCELLED')
        self.assertEqual(self.transport.answer_calls, [])
        self.assertEqual(model_usage.summary(self.repo)['attempts'], 0)

    def test_revocation_during_answer_response_blocks_publication(self):
        _, receipt = self.pending()
        self.transport.on_call = lambda request: setattr(self.auth, 'revoked', True)
        self.worker.step()
        self.assertEqual(self.row(receipt)['state'], 'FAILED')
        self.assertIsNone(self.row(receipt)['result'])
        self.assertEqual(model_usage.summary(self.repo)['attempts'], 1)

    def test_final_repository_authorizer_blocks_late_publication(self):
        _, receipt = self.pending()
        complete = self.repo.complete_answer
        def revoke(*args):
            self.auth.revoked = True
            return complete(*args)
        with patch.object(self.repo, 'complete_answer', revoke):
            self.worker.step()
        self.assertEqual(self.row(receipt)['state'], 'FAILED')
        self.assertIsNone(self.row(receipt)['result'])

    def permission_failure(self):
        def deny(request):
            if request.operation == 'ozon_orders':raise CallError('HTTP_403', status=403)
        self.transport.on_call = deny
        _, receipt = self.submit()
        self.worker.step(); self.clock.advance(3)
        row = self.row(receipt)
        self.assertTrue(strict_json(row['progress'])[PENDING]['permission_notice'])
        self.transport.on_call = None
        return receipt

    def test_permission_notice_uses_platform_owner_and_contains_no_prior_data(self):
        receipt = self.permission_failure()
        def forbidden(_):raise AssertionError('legacy tenant mapping used')
        self.engine.scope_for = forbidden
        self.assertEqual(self.run_until_terminal(receipt)['state'], 'READY')
        self.assertTrue(self.port.read_result(receipt['job_ref'], self.ctx, self.peer)['complete'])
        data = self.transport.answer_calls[0].body['messages'][-1]['content']
        self.assertIn('403', data)
        self.assertNotIn('123.45', data)

    def test_permission_notice_still_requires_current_platform_rights(self):
        receipt = self.permission_failure(); self.auth.revoked = True
        self.worker.step()
        self.assertEqual(self.row(receipt)['state'], 'FAILED')
        self.assertEqual(self.transport.answer_calls, [])

    def test_authority_outage_after_data_prevents_answer_and_is_not_provider_error(self):
        _, receipt = self.pending(); self.auth.down = True
        self.worker.step()
        row = self.row(receipt)
        self.assertEqual(row['state'], 'FAILED')
        self.assertEqual(row['error'], 'DEPENDENCY_UNAVAILABLE')
        self.assertEqual(self.transport.answer_calls, [])

    def test_table_data_goes_to_answer_stage_without_voice_renderer(self):
        import test_table_analytics as tables
        self.engine.table_capabilities = lambda: tables.caps(self.auth.scope)
        class TableTransport(Transport):
            def execute(self, request, store):
                if request.operation == 'ozon_table_orders':
                    self.calls.append(request)
                    offset = request.body.get('offset', 0)
                    return tables.oz_data([(i, 1, 100) for i in range(offset + 1, min(offset + 1000, 5000) + 1)],
                                          [5000, '500000']), {'status': 200, 'elapsed_ms': 1}
                return super().execute(request, store)
        self.transport = TableTransport(); self.worker = Worker(self.engine, self.transport)
        _, receipt = self.submit('топ 1 товаров по сумме заказов за октябрь 2026 на озоне')
        with patch('table_analytics.render', side_effect=AssertionError('voice capacity must not gate model answer')):
            row = self.run_until_terminal(receipt, maximum=160)
        self.assertEqual(row['state'], 'READY', row['error'])
        self.assertEqual(len(self.transport.answer_calls), 1)
        self.assertIn('runtime_guard', strict_json(row['plan']))
