"""Synthetic RuntimePort + real SQLite/worker; no marketplace/model network."""
from copy import deepcopy
import unittest
from unittest.mock import patch

from test_runtime_port_r01_contract import Setup, uid, utc
from test_template_only import Transport, selection, TODAY
from engine import Worker
from model_answer import Settings
from semantics import strict_json, fingerprint
import model_usage


class ClarificationChecks(Setup):
    def setUp(self):
        super().setUp()
        self.engine.template_mode = True
        self.engine.answer_settings = Settings(self.root / 'answer.json')
        self.repo.answer_settings = self.engine.answer_settings
        self.transport = Transport(); self.worker = Worker(self.engine, self.transport)
        self.transport.selection = {'action': 'clarify', 'question': 'За какой период подготовить отчёт?',
                                    'missing': ['period']}

    def ask(self, question='Покажи заказы по магазину, исключая товар Z'):
        task, receipt = self.submit(question)
        self.worker.step()
        value = self.port.read_result(receipt['job_ref'], self.ctx, self.peer)
        self.assertEqual(value['state'], 'NEEDS_INPUT')
        self.assertEqual(value['result_kind'], 'CLARIFICATION')
        return task, receipt, value

    def continuation(self, task, receipt, value, answer='за октябрь 2026'):
        return {k: deepcopy(task[k]) for k in ('context','logical_query_id','trace_id')} | {
            'schema_version': 'runtime_clarification_task_v1', 'request_id': uid(),
            'job_ref': receipt['job_ref'], 'answer': answer,
            'expected_revision': value['clarification']['revision']}

    def row(self, receipt):
        return self.repo.get('A', self.inner_id(receipt))

    def test_question_calls_only_selector_and_keeps_one_job(self):
        _, receipt, value = self.ask()
        self.assertEqual([c.operation for c in self.transport.calls], ['template_select'])
        self.assertEqual(self.count('jobs'), 1); self.assertEqual(self.count('inbox'), 1)
        self.assertEqual(value['pages'], [value['clarification']['question']])
        self.assertFalse(strict_json(self.row(receipt)['result']).get('template_gap'))

    def test_legacy_station_has_original_policy_and_no_unanswerable_pending_job(self):
        from template_protocol import SELECT_SYSTEM
        question = 'Сколько товаров заказали вчера на Озоне?'
        value = self.engine.safe_submit('A', question, uid(), fingerprint(question), TODAY,
            conversation_id='legacy-station-session', message_id=0)
        self.worker.step(); row = self.repo.get('A', value['job_id'])
        self.assertEqual(self.transport.calls[0].body['system'], SELECT_SYSTEM)
        self.assertNotIn('clarification_supported', self.transport.calls[0].body['context'])
        self.assertNotIn('clarification', strict_json(row['result']))
        # The pinned R02 and later native source distinguish invalid selector
        # output differently; both retain their existing closed refusal path.
        self.assertIn(strict_json(row['result'])['failure_code'],
                      ('TEMPLATE_NOT_FOUND', 'TEMPLATE_EXECUTION_FAILED'))
        self.assertIsNone(strict_json(row['result'])['data'])
        self.assertEqual(self.count('rt_job_refs'), 0)
        self.assertEqual([c.operation for c in self.transport.calls], ['template_select'])

    def test_extended_selector_policy_requires_server_continuation_capability(self):
        from template_protocol import payload, SELECT_SYSTEM
        self.ask(); body = self.transport.calls[0].body
        self.assertTrue(body['context']['clarification_supported'])
        self.assertNotEqual(body['system'], SELECT_SYSTEM)
        payload('template_select', body)
        altered = deepcopy(body); altered['context'].pop('clarification_supported')
        with self.assertRaisesRegex(ValueError, 'TEMPLATE_MODEL_POLICY'):
            payload('template_select', altered)

    def test_answer_preserves_original_date_scope_and_job(self):
        original = 'Покажи заказы за вчера по магазину, исключая товар Z'
        task, receipt, value = self.ask(original)
        before = strict_json(self.row(receipt)['plan'])
        continuation = self.continuation(task, receipt, value, 'заказанные')
        result = self.port.clarify(continuation, self.peer)
        self.assertEqual(result['job_ref'], receipt['job_ref'])
        self.assertEqual(self.count('jobs'), 1); self.assertEqual(self.count('inbox'), 1)
        self.assertEqual(self.count('rt_job_refs'), 1)
        draft = strict_json(self.row(receipt)['draft']); after = strict_json(self.row(receipt)['plan'])
        self.assertEqual(draft['original_question'], original)
        self.assertIn('заказанные', draft['question_clarifications'][0])
        for field in ('question', 'calendar_date', 'timezone', 'stores', 'runtime_guard', 'template_execution'):
            self.assertEqual(after[field], before[field])
        self.worker.step()
        self.assertEqual(self.transport.calls[-1].body['context']['original_question'], original)
        self.assertIn('заказанные', self.transport.calls[-1].body['context']['clarifications'][0])

    def test_duplicate_answer_is_one_continuation(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        first = self.port.clarify(continuation, self.peer)
        self.assertEqual(self.port.clarify(continuation, self.peer), first)
        self.assertEqual(len(strict_json(self.row(receipt)['draft'])['question_clarifications']), 1)
        self.assertEqual(len(self.transport.calls), 1)

    def test_changed_answer_under_same_request_id_is_rejected(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        self.port.clarify(continuation, self.peer); continuation['answer'] = 'за ноябрь 2026'
        self.reject('IDEMPOTENCY_CONFLICT', lambda: self.port.clarify(continuation, self.peer))

    def test_stale_prompt_cannot_replace_a_later_answer(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        self.port.clarify(continuation, self.peer); self.worker.step()
        continuation['request_id'] = uid()
        self.reject('IDEMPOTENCY_CONFLICT', lambda: self.port.clarify(continuation, self.peer))

    def test_other_logical_query_is_rejected(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        continuation['logical_query_id'] = uid()
        self.reject('IDEMPOTENCY_CONFLICT', lambda: self.port.clarify(continuation, self.peer))

    def test_whitespace_padding_cannot_bypass_native_answer_bound(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        continuation['answer'] = 'вчера' + ' ' * 1200
        self.reject('VALIDATION_FAILED', lambda: self.port.clarify(continuation, self.peer))
        self.assertEqual(len(self.transport.calls), 1)

    def test_revocation_prevents_answer_and_any_api_dispatch(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        self.auth.revoked = True
        self.reject('ACCESS_REQUIRED', lambda: self.port.clarify(continuation, self.peer))
        self.assertEqual(len(self.transport.calls), 1)

    def test_expired_question_is_not_resumed(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        self.clock.advance(301)
        self.reject('RESULT_EXPIRED', lambda: self.port.clarify(continuation, self.peer))

    def test_question_expiring_during_final_authorization_is_not_resumed(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        ctx, guard, _ = self.port._auth(self.ctx, self.peer, 'submit')
        with self.repo.connection(True) as connection:
            reference, row = self.port._lookup(connection, receipt['job_ref'], ctx, guard)
        def late_authorization(_):
            self.clock.advance(301)
            return True
        with patch.object(self.port, '_lookup', return_value=(reference, row)), \
                patch.object(self.engine, 'authorized', side_effect=late_authorization):
            self.reject('RESULT_EXPIRED', lambda: self.port.clarify(continuation, self.peer))
        with self.repo.connection() as connection:
            self.assertEqual(connection.execute('SELECT state FROM jobs WHERE id=?', (row['id'],)).fetchone()[0], 'READY')
        self.assertEqual(len(self.transport.calls), 1)

    def test_cancel_question_prevents_continuation(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        self.assertTrue(self.port.cancel(receipt['job_ref'], self.ctx, uid(), self.peer)['cancelled'])
        self.reject('RESULT_EXPIRED', lambda: self.port.clarify(continuation, self.peer))
        self.assertEqual(len(self.transport.calls), 1)

    def test_ticket_expiring_during_final_authorization_is_not_resumed(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        context = self.auth.issue({**self.ctx, 'not_after': utc(self.clock() + 1)})
        continuation['context'] = context
        ctx, guard, _ = self.port._auth(context, self.peer, 'submit')
        with self.repo.connection(True) as connection:
            reference, row = self.port._lookup(connection, receipt['job_ref'], ctx, guard)
        def late_authorization(_):
            self.clock.advance(2)
            return True
        with patch.object(self.port, '_lookup', return_value=(reference, row)), \
                patch.object(self.engine, 'authorized', side_effect=late_authorization):
            self.reject('AUTH_REQUIRED', lambda: self.port.clarify(continuation, self.peer))
        self.assertEqual(len(self.transport.calls), 1)

    def test_different_reader_cannot_be_mutated(self):
        task, receipt, value = self.ask(); continuation = self.continuation(task, receipt, value)
        with self.repo.connection(True) as c:
            from reader_state import _attach
            _attach(self.repo, c, 'A', 'another-reader', self.inner_id(receipt), self.clock())
        self.reject('PERMISSION_DENIED', lambda: self.port.clarify(continuation, self.peer))

    def test_four_questions_are_bounded(self):
        task, receipt, value = self.ask()
        for _ in range(3):
            self.port.clarify(self.continuation(task, receipt, value), self.peer)
            self.clock.advance(1); self.worker.step()
            value = self.port.read_result(receipt['job_ref'], self.ctx, self.peer)
        self.assertEqual(value['clarification']['turn'], 4)

    def test_answer_can_reach_data_without_a_new_job_or_model_request_count(self):
        task, receipt, value = self.ask('Количество заказанных товаров')
        self.port.clarify(self.continuation(task, receipt, value), self.peer)
        self.transport.selection = selection(['B01.ordered_units'])
        final = self.finish(receipt)
        self.assertEqual(final['result_kind'], 'DATA'); self.assertEqual(self.count('jobs'), 1)
        self.assertEqual(model_usage.summary(self.repo)['requests'], 1)
        self.assertEqual([c.operation for c in self.transport.calls],
                         ['template_select', 'template_select', 'ozon_orders', 'model_answer'])
        final_messages = self.transport.calls[-1].body['messages']
        self.assertTrue(any('за октябрь 2026' in m['content'] for m in final_messages))

    def test_product_journal_keeps_one_episode_from_question_to_data(self):
        from query_gap_terminal import TerminalStore
        journal = TerminalStore(self.repo.path, b'fixture-key-for-product-events-32', 'fixture', internal_test=True)
        journal.initialize()
        task, receipt, value = self.ask('Количество заказанных товаров')
        first, marks = journal.pending(); journal.acknowledge(marks)
        self.assertEqual(len(first['events']), 1)
        event = first['events'][0]
        self.assertEqual(event['final_outcome'], 'NEEDS_CLARIFICATION')
        self.assertNotIn('safe_utterance', event)
        self.port.clarify(self.continuation(task, receipt, value), self.peer)
        self.transport.selection = selection(['B01.ordered_units']); self.finish(receipt)
        final, _ = journal.pending()
        self.assertEqual(len(final['events']), 1)
        self.assertEqual(final['events'][0]['logical_query_id'], event['logical_query_id'])
        self.assertGreater(final['events'][0]['episode_revision'], event['episode_revision'])
        self.assertEqual(final['events'][0]['final_outcome'], 'READY')


if __name__ == '__main__':
    unittest.main()
