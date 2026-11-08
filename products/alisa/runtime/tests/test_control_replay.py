"""Regressions: durable idempotence of P0 commands, no provider networking."""
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from pathlib import Path
from test_runtime import TODAY, SCOPE, Clock, FakeTransport
from semantics import Rejected, fingerprint
from repository import Repository
from engine import Engine, Worker


class ControlReplayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'jobs.sqlite'
        self.clock = Clock()
        self.scope = SCOPE
        self.repo = Repository(self.path, self.clock)
        self.engine = Engine(self.repo, lambda tenant: self.scope)
        self.transport = FakeTransport()
        self.worker = Worker(self.engine, self.transport)
        self.seq = 0

    def tearDown(self):
        self.temp.cleanup()

    def submit(self, command, rid=None, body=None):
        self.seq += 1
        return self.engine.submit('A', command, rid or 'r-' + str(self.seq),
                                  body or fingerprint(command), TODAY)

    def queue(self, month='октябрь', rid=None):
        return self.submit('сводка заказов за ' + month + ' 2026 на озоне', rid)

    def ready(self, month='октябрь'):
        self.clock.advance(62)
        item = self.queue(month)
        self.worker.step()
        self.assertEqual(self.repo.get('A', item['job_id'])['state'], 'READY')
        return item

    def assertRejected(self, code, fn):
        with self.assertRaises(Rejected) as caught:
            fn()
        self.assertEqual(caught.exception.code, code)

    def test_late_cancel_retry_does_not_cancel_new_job(self):
        a = self.queue()
        first = self.submit('отмени отчет', 'cancel')
        b = self.queue('сентябрь')
        replay = self.submit('отмени отчет', 'cancel')
        self.assertEqual(first, replay)
        self.assertEqual(self.repo.get('A', a['job_id'])['state'], 'CANCELLED')
        self.assertEqual(self.repo.get('A', b['job_id'])['state'], 'QUEUED')
        self.assertEqual(self.repo.call_count(), 0)

    def test_fresh_cancel_id_cancels_new_job(self):
        self.queue(); self.submit('отмени отчет', 'cancel1')
        b = self.queue('сентябрь')
        self.submit('отмени отчет', 'cancel2')
        self.assertEqual(self.repo.get('A', b['job_id'])['state'], 'CANCELLED')

    def test_control_changed_replay_rejected_before_cancel(self):
        a = self.queue()
        self.submit('статус отчета', 'same')
        self.assertRejected('CHANGED_REPLAY', lambda: self.submit('отмени отчет', 'same'))
        self.assertEqual(self.repo.get('A', a['job_id'])['state'], 'QUEUED')

    def test_p1_to_p0_same_message_cannot_cancel(self):
        a = self.queue(rid='same')
        self.assertRejected('CHANGED_REPLAY', lambda: self.submit('отмени отчет', 'same'))
        self.assertEqual(self.repo.get('A', a['job_id'])['state'], 'QUEUED')

    def test_p0_to_p1_same_message_cannot_create_job(self):
        self.submit('помощь', 'same')
        self.assertRejected('CHANGED_REPLAY', lambda: self.queue(rid='same'))
        self.assertIsNone(self.repo.get('A'))

    def test_result_replay_does_not_switch_to_new_report(self):
        self.ready()
        first = self.submit('результат', 'result1')
        self.ready('сентябрь')
        self.assertEqual(first, self.submit('результат', 'result1'))
        self.assertIn('2026-10-01', first['text'])
        self.assertEqual(self.repo.call_count(), 2)

    def test_new_result_message_reads_new_pointer(self):
        self.ready(); self.submit('результат', 'result1')
        self.ready('сентябрь')
        self.assertIn('2026-09-01', self.submit('результат', 'result2')['text'])

    def test_queued_control_replay_does_not_turn_into_new_answer(self):
        self.queue()
        first = self.submit('результат', 'result1')
        self.worker.step()
        self.assertEqual(first, self.submit('результат', 'result1'))
        self.assertIn('2026-10-01', self.submit('результат', 'result2')['text'])

    def test_result_replay_checks_revoked_revision(self):
        self.ready(); self.submit('результат', 'result1')
        self.scope = replace(self.scope, revision='revoked')
        self.assertRejected('SOURCE_ACCESS', lambda: self.submit('результат', 'result1'))

    def test_result_replay_checks_source_revocation(self):
        self.ready(); self.submit('результат', 'result1')
        request = self.transport.calls[0]
        self.repo.deny(request.source, self.scope.stores[0].access_revision)
        self.assertRejected('SOURCE_ACCESS', lambda: self.submit('результат', 'result1'))

    def test_result_replay_checks_expiration(self):
        self.ready(); self.submit('результат', 'result1')
        self.clock.advance(901)
        self.assertRejected('RESULT_EXPIRED', lambda: self.submit('результат', 'result1'))

    def test_plan_replay_checks_access(self):
        self.queue(); self.submit('план запроса', 'plan1')
        self.scope = replace(self.scope, revision='revoked')
        self.assertRejected('SOURCE_ACCESS', lambda: self.submit('план запроса', 'plan1'))

    def test_cancel_receipt_survives_repository_restart(self):
        self.queue(); reply = self.submit('отмени отчет', 'cancel')
        b = self.queue('сентябрь')
        repo2 = Repository(self.path, self.clock)
        engine2 = Engine(repo2, lambda tenant: self.scope)
        replay = engine2.submit('A','отмени отчет','cancel',fingerprint('отмени отчет'),TODAY)
        self.assertEqual(reply, replay)
        self.assertEqual(repo2.get('A', b['job_id'])['state'], 'QUEUED')

    def test_concurrent_control_retries_execute_once(self):
        self.queue()
        def cancel(_):
            return self.engine.submit('A','отмени отчет','same',fingerprint('cancel'),TODAY)
        with ThreadPoolExecutor(max_workers=8) as pool:
            answers = list(pool.map(cancel, range(12)))
        self.assertTrue(all(a == answers[0] for a in answers))
        self.assertEqual(answers[0]['text'], 'Задание отменено.')
        with self.repo.connection() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM control_inbox').fetchone()[0], 1)

    def test_failure_rolls_back_action_and_receipt(self):
        a = self.queue()
        def action():
            self.repo.cancel('A')
            raise Rejected('TEST_FAILURE')
        self.assertRejected('TEST_FAILURE', lambda: self.repo.control_reply('A','cancel',fingerprint('c'),action,lambda p:True))
        self.assertEqual(self.repo.get('A', a['job_id'])['state'], 'QUEUED')
        with self.repo.connection() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM control_inbox').fetchone()[0], 0)
        self.submit('отмени отчет', 'cancel')
        self.assertEqual(self.repo.get('A', a['job_id'])['state'], 'CANCELLED')

    def test_invalid_control_id_has_no_effect(self):
        a = self.queue()
        self.assertRejected('INGRESS_SCHEMA', lambda: self.engine.submit('A','отмени отчет','',fingerprint('c'),TODAY))
        self.assertEqual(self.repo.get('A', a['job_id'])['state'], 'QUEUED')

    def test_invalid_control_body_hash_has_no_effect(self):
        a = self.queue()
        self.assertRejected('INGRESS_SCHEMA', lambda: self.engine.submit('A','отмени отчет','cancel','bad',TODAY))
        self.assertEqual(self.repo.get('A', a['job_id'])['state'], 'QUEUED')

    def test_same_message_id_in_different_tenants_is_isolated(self):
        self.submit('помощь','same')
        self.scope = replace(self.scope, tenant='B')
        result = self.engine.submit('B','диагностика аналитики','same',fingerprint('diagnostic'),TODAY)
        self.assertIn('0.9', result['text'])
        with self.repo.connection() as c:
            self.assertEqual(c.execute('SELECT COUNT(*) FROM control_inbox').fetchone()[0], 2)

    def test_controls_do_not_send_provider_calls(self):
        self.queue()
        for i,cmd in enumerate(('статус отчета','результат','план запроса','диагностика аналитики','помощь')):
            self.submit(cmd,str(i));self.submit(cmd,str(i))
        self.assertEqual(self.repo.call_count(),0)
        self.assertEqual(self.transport.calls,[])

    def test_write_promotion_of_read_transaction_is_rejected(self):
        with self.repo.connection():
            self.assertRejected('NESTED_WRITE_WITHOUT_TRANSACTION', lambda:self.queue())
        self.assertIsNone(self.repo.get('A'))

if __name__ == '__main__':
    unittest.main()
