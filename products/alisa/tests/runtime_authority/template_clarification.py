#!/usr/bin/env python3
"""Template clarification across real PG/OAuth/Unix, synthetic model/provider."""
import argparse
from copy import deepcopy
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

from voice_selection import VoiceChecks
from checks import connections, TEMP, uid
from alisa_platform.queries import service
from alisa_platform.queries.models import Query, VoiceDialogue
from alisa_platform.runtime_adapter.job_client import RuntimeClient, RuntimeFailure
from engine import Worker
from model_answer import Settings
from test_template_only import Transport, selection

QUESTION = 'Количество заказанных товаров'


class ClarificationFlow(VoiceChecks):
    def setUp(self):
        super().setUp()
        self.engine.template_mode = True
        self.engine.answer_settings = Settings(Path(self.folder.name) / 'answer.json')
        self.repo.answer_settings = self.engine.answer_settings
        self.transport = Transport(); self.worker = Worker(self.engine, self.transport)
        self.transport.selection = {'action': 'clarify', 'question': 'За какой период подготовить отчёт?',
                                    'missing': ['period']}

    def web_question(self):
        service.submit(self.principal, self.qid, self.stores, QUESTION)
        self.worker.step()
        return service.read(self.principal, self.qid, result=True)['result']

    def web_answer(self, value, request_id=None, **extra):
        return service.clarify(self.principal, self.qid, request_id or uid(),
                               value['clarification']['revision'], 'за октябрь 2026', **extra)

    def voice_question(self):
        self.assertIn('магазин', self.say(QUESTION, 0).lower())
        self.assertIn('принято', self.say('песок', 1))
        self.worker.step()
        self.assertEqual(self.say('готово', 2), self.transport.selection['question'])
        return Query.objects.get(customer=self.actor)

    def test_web_result_is_a_question_and_not_useful_data(self):
        value = self.web_question()
        self.assertEqual(value['result_kind'], 'CLARIFICATION')
        self.assertEqual([c.operation for c in self.transport.calls], ['template_select'])
        from alisa_platform.funnel.models import FunnelEvent
        self.assertFalse(FunnelEvent.objects.filter(subject_id=self.actor.pk,
                        event_type='query.first_useful_ready').exists())

    def test_legacy_insert_without_new_column_keeps_code_rollback_usable(self):
        self.web_question(); before = len(self.transport.calls); other = uid()
        db = connections['default']; quote = db.ops.quote_name
        columns = [f.column for f in Query._meta.concrete_fields if f.column not in {'id', 'continuation'}]
        names = ','.join(quote(n) for n in columns); table = quote(Query._meta.db_table)
        try:
            # The previous application knows none of the new column. Its INSERT
            # must still work while the additive migration is retained on rollback.
            with db.cursor() as cursor:
                cursor.execute('INSERT INTO ' + table + ' (id,' + names + ') SELECT %s,' + names +
                               ' FROM ' + table + ' WHERE id=%s', [other, self.qid])
                self.assertEqual(cursor.rowcount, 1)
            self.assertEqual(Query.objects.get(pk=other).continuation, {})
            self.assertEqual(len(self.transport.calls), before)
        finally:
            Query.objects.filter(pk=other).delete()

    def test_web_answer_keeps_public_and_native_identity(self):
        value = self.web_question(); before = Query.objects.get(pk=self.qid)
        result, code = self.web_answer(value)
        self.assertEqual(code, 201); self.assertEqual(result['query']['id'], self.qid)
        after = Query.objects.get(pk=self.qid)
        self.assertEqual(before.runtime_job_ref, after.runtime_job_ref)
        self.assertEqual(before.input_hash, after.input_hash)
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)
        with self.repo.connection() as c:self.assertEqual(c.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)

    def test_web_replay_is_confirmed_without_second_ipc(self):
        value = self.web_question(); rid = uid(); self.web_answer(value, rid)
        with patch.object(RuntimeClient, 'clarify', side_effect=AssertionError('replay dispatched')):
            _, status = self.web_answer(value, rid)
        self.assertEqual(status, 200)

    def test_lost_answer_acceptance_recovers_exact_id_once(self):
        value = self.web_question(); rid = uid(); original = RuntimeClient.clarify
        def lost(client, *args, **kwargs):
            original(client, *args, **kwargs)
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN')
        with patch.object(RuntimeClient, 'clarify', lost):
            result, status = self.web_answer(value, rid)
        self.assertEqual(status, 202); self.assertEqual(result['code'], 'UNKNOWN_OUTCOME')
        with patch.object(RuntimeClient, 'clarify', side_effect=AssertionError('implicit replay')):
            self.assertEqual(self.web_answer(value, rid)[1], 202)
        self.assertEqual(self.web_answer(value, rid, recover=True)[1], 201)
        self.assertEqual(len(self.transport.calls), 1)
        row = Query.objects.get(pk=self.qid)
        self.assertNotIn('за октябрь', json.dumps(row.continuation, ensure_ascii=False))

    def test_unknown_answer_blocks_a_new_request_id(self):
        value = self.web_question()
        with patch.object(RuntimeClient, 'clarify', side_effect=RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN')):
            self.web_answer(value)
        self.deny('UNKNOWN_OUTCOME', lambda: self.web_answer(value))

    def test_changed_answer_under_same_id_is_rejected(self):
        value = self.web_question(); rid = uid(); self.web_answer(value, rid)
        self.deny('IDEMPOTENCY_CONFLICT', lambda: service.clarify(self.principal, self.qid, rid,
            value['clarification']['revision'], 'за ноябрь 2026', recover=True))

    def test_read_confirms_lost_acceptance_without_resending(self):
        value = self.web_question(); rid = uid(); original = RuntimeClient.clarify
        def lost(client, *args, **kwargs):
            original(client, *args, **kwargs)
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN')
        with patch.object(RuntimeClient, 'clarify', lost):self.web_answer(value, rid)
        service.read(self.principal, self.qid)
        self.assertEqual(Query.objects.get(pk=self.qid).continuation['outcome'], 'CONFIRMED')

    def test_voice_answer_continues_the_original_query(self):
        before = self.voice_question()
        self.assertIn('Уточнение принято', self.say('за октябрь 2026', 3))
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)
        self.assertEqual(Query.objects.get(pk=before.pk).runtime_job_ref, before.runtime_job_ref)
        self.assertEqual(VoiceDialogue.objects.get(query_id=before.pk).encrypted_payload, '')
        self.transport.selection = selection(['B01.ordered_units'], store='native-store')
        self.finish({'job_ref': str(before.runtime_job_ref)})
        calls = len(self.transport.calls)
        self.assertEqual(self.say('готово', 4), 'Отчёт готов. Откройте его в разделе «Задания» в кабинете.')
        self.link.voice_private = False; self.link.save(update_fields=['voice_private'])
        self.assertIn('Данные получены', self.say('готово', 5))
        self.assertEqual(len(self.transport.calls), calls)

    def test_voice_replayed_answer_does_not_start_another_query(self):
        self.voice_question(); self.say('за октябрь 2026', 3)
        with patch.object(service, 'clarify', side_effect=AssertionError('duplicate answer')):
            self.say('за октябрь 2026', 3)
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)

    def test_voice_explicit_retry_keeps_the_pending_answer(self):
        self.voice_question(); original = RuntimeClient.clarify
        def lost(client, *args, **kwargs):
            original(client, *args, **kwargs)
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN')
        with patch.object(RuntimeClient, 'clarify', lost):
            self.assertIn('не подтверждена', self.say('за октябрь 2026', 3))
        self.assertIn('не подтверждена', self.say('другой ответ', 4))
        self.assertIn('Уточнение принято', self.say('повтори отправку', 5))
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)

    def test_voice_store_change_does_not_retarget_pending_question(self):
        row = self.voice_question()
        self.assertIn('отмените', self.say('смени магазин на озон два', 3))
        self.assertEqual(Query.objects.get(pk=row.pk).store_ids, self.stores)
        self.assertEqual(len(self.transport.calls), 1)

    def test_another_voice_dialogue_does_not_consume_the_answer(self):
        self.voice_question()
        self.assertNotIn('Уточнение принято', self.say('за октябрь 2026', 0, 'another-dialogue'))
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 2)

    def test_pending_question_cancel_sends_no_marketplace_call(self):
        self.voice_question()
        self.assertIn('отменено', self.say('отмена', 3))
        self.assertEqual([c.operation for c in self.transport.calls], ['template_select'])

    def test_new_continuation_can_receive_a_new_cancel_request(self):
        row = self.voice_question()
        VoiceDialogue.objects.filter(query_id=row.pk).update(cancel_id=uid(), cancel_started=True)
        original = RuntimeClient.clarify
        def interleaved(client, *args, **kwargs):
            self.assertIn('отмену принят', self.say('отмена', 4))
            return original(client, *args, **kwargs)
        with patch.object(RuntimeClient, 'clarify', interleaved):
            self.assertIn('отменено', self.say('за октябрь 2026', 3))
        self.assertEqual(Query.objects.get(pk=row.pk).state, 'CANCELLED')
        self.assertEqual(len(self.transport.calls), 1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True); args = parser.parse_args()
    connect = socket.socket.connect
    def confined(peer, address):
        if peer.family == socket.AF_UNIX or peer.family == socket.AF_INET and address == ('127.0.0.1', 55480):
            return connect(peer, address)
        raise AssertionError('External network forbidden')
    try:
        suite = unittest.TestSuite(ClarificationFlow(name) for name in ClarificationFlow.__dict__ if name.startswith('test_'))
        with patch.object(socket.socket, 'connect', confined), patch('socket.getaddrinfo', side_effect=AssertionError('DNS forbidden')):
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        args.output.write_text(json.dumps({'scope': 'S09_TEMPLATE_CLARIFICATION_PG_OAUTH_UNIX_SYNTHETIC',
            'status': 'PASS' if result.wasSuccessful() else 'FAILED', 'tests_run': result.testsRun,
            'failures': len(result.failures), 'errors': len(result.errors)}, indent=2) + '\n')
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:
        connections.close_all(); TEMP.cleanup()
