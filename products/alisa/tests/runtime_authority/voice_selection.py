#!/usr/bin/env python3
"""Store clarification on PostgreSQL, OAuth, Unix authority and the frozen core.

All credentials/provider/model fixtures are synthetic; no installed acceptance.
"""
import argparse
from copy import deepcopy
from datetime import timedelta
import hashlib
import json
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

from query_roundtrip import QueryChecks, connections, TEMP, uid, timezone
from checks import Store, VaultSecret, CredentialRevision, settings, AccessAdjustment
from alisa_platform.queries import service, voice, voice_dialogue as dialogue
from alisa_platform.queries.models import Query, VoiceDialogue
from alisa_platform.alice_link.vault import unseal, seal
from alisa_platform.runtime_adapter.authority import AlicePrincipal
from django.core.management import call_command

QUESTION = 'заказы за вчера, кроме товара 777 на озоне'


class VoiceChecks(QueryChecks):
    def setUp(self):
        super().setUp()
        self.store.name = 'Первый'; self.store.voice_alias = 'песок'; self.store.save()
        _, self.link, self.family, self.token = self.issue_alice()
        self.second = self.shop('Второй', 'OZON', 'озон два')

    def shop(self, name, provider, alias=''):
        row = Store.objects.create(tenant=self.tenant, name=name, voice_alias=alias,
            provider=provider, verified_identity=provider.lower() + ':fixture:' + uid())
        creds = []
        for kind in (['SELLER', 'PERFORMANCE'] if provider == 'OZON' else ['WB']):
            secret = VaultSecret.objects.create(tenant=self.tenant, store=row, kind=kind,
                revision=1, key_version='fixture', ciphertext='fixture-never-decrypted')
            creds.append(CredentialRevision.objects.create(tenant=self.tenant, store=row, kind=kind,
                revision=1, secret=secret, status='ACTIVE', check_code='CONNECTED'))
        entry = deepcopy(self.document['tenants'][0]['stores'][0])
        entry.update(store_id=str(row.pk), provider=provider, verified_identity=row.verified_identity,
                     credentials=[{'id': str(c.pk), 'kind': c.kind, 'revision': c.revision} for c in creds])
        entry['runtime_store'].update(id='native-' + str(row.pk), platform=provider.lower(), identity='fixture-' + str(row.pk))
        self.document['tenants'][0]['stores'].append(entry); self.write()
        return row

    def say(self, text, mid=0, sid='fixture-session'):
        payload = self.payload(text, mid); payload['session']['session_id'] = sid
        return voice.handle(self.token, payload)['response']['text']

    def state(self):
        row = VoiceDialogue.objects.get(customer=self.actor)
        return row, unseal('voice-dialogue/v1', row.pk, row.encrypted_payload)

    def question(self):
        self.assertIn('Уточните магазин', self.say(QUESTION))
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 0)
        self.assertEqual(self.transport.calls, [])

    def test_all_resumes_exact_question_and_original_id(self):
        self.question(); row, state = self.state(); qid = state['query_id']
        with patch.object(service, 'submit', wraps=service.submit) as submit:
            self.assertIn('принято', self.say('все', 1))
        self.assertEqual(submit.call_args.args[1], qid)
        self.assertEqual(submit.call_args.args[3], QUESTION)
        query = Query.objects.get(pk=qid)
        self.assertEqual(query.store_ids, sorted([str(self.store.pk), str(self.second.pk)]))
        self.assertEqual(self.transport.calls, [])
        self.assertNotIn('question', self.state()[1])

    def test_exact_alias_selects_one(self):
        self.question(); self.assertIn('принято', self.say('озон два', 1))
        self.assertEqual(Query.objects.get(customer=self.actor).store_ids, [str(self.second.pk)])

    def test_ordinal_uses_spoken_absolute_number(self):
        self.question(); _, state = self.state(); sid = state['stores'][1]['id']
        self.say('второй', 1)
        self.assertEqual(Query.objects.get(customer=self.actor).store_ids, [sid])

    def test_duplicate_alias_never_randomly_selects(self):
        self.second.voice_alias = 'песок'; self.second.save()
        self.question(); self.assertIn('Уточните', self.say('песок', 1))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())
        self.say('номер 2', 2)
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)

    def test_new_shop_does_not_join_all(self):
        self.question(); extra = self.shop('Поздний', 'OZON')
        self.say('все', 1)
        self.assertNotIn(str(extra.pk), Query.objects.get(customer=self.actor).store_ids)

    def test_changed_store_stops_entire_all_without_partial_job(self):
        self.question(); self.second.status = 'DISABLED'; self.second.save()
        self.assertIn('изменилось', self.say('все', 1))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())
        self.assertEqual(self.transport.calls, [])

    def test_changed_key_stops_without_dispatch(self):
        self.question()
        CredentialRevision.objects.filter(store=self.second).update(status='REVOKED')
        self.assertIn('изменилось', self.say('все', 1))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_revoked_access_between_turns_never_submits(self):
        self.question()
        AccessAdjustment.objects.create(id=uid(), grant=self.grant, cutoff=timezone.now(),
            actor_id=uid(), reason='FIXTURE')
        self.assertIn('не активен', self.say('все', 1))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_duplicate_selection_and_old_question_do_not_create_second_job(self):
        self.question(); self.say('все', 1); self.say('все', 1); self.say(QUESTION, 0)
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)
        with self.repo.connection() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)

    def test_same_message_changed_content_is_conflict(self):
        self.question(); self.assertIn('другим содержимым', self.say('все', 0))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_unrecognized_clarification_preserves_period_and_exclusion(self):
        self.question(); self.say('заказанные', 1)
        self.assertEqual(self.state()[1]['question'], QUESTION)
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_cancel_pending_never_cancels_prior_job(self):
        # First real job, followed by another question in the same voice session.
        self.say('заказы за вчера по всем магазинам', 0)
        self.say(QUESTION, 1)
        with patch.object(service, 'cancel', side_effect=AssertionError('Wrong reader cancellation')):
            self.assertIn('не отправлен', self.say('отмена', 2))
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)
        self.assertNotIn('question', self.state()[1])

    def test_status_while_choosing_never_reads_previous_job(self):
        self.question()
        with patch.object(service, 'read', side_effect=AssertionError('Read while pending')):
            self.assertIn('Уточните', self.say('готово', 1))

    def test_parallel_sessions_do_not_consume_each_others_question(self):
        self.question(); other = QUESTION.replace('вчера', 'октябрь')
        self.say(other, 0, 'other-session')
        self.say('озон два', 1, 'other-session')
        with patch.object(service, 'submit', wraps=service.submit) as submit:
            self.say('все', 1)
        self.assertEqual(submit.call_args.args[3], QUESTION)
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 2)

    def test_inbound_yandex_state_cannot_replace_question_or_stores(self):
        self.question(); payload = self.payload('все', 1)
        payload['state'] = {'session': {'question': 'чужой вопрос', 'store_ids': [uid()]}}
        with patch.object(service, 'submit', wraps=service.submit) as submit:
            voice.handle(self.token, payload)
        self.assertEqual(submit.call_args.args[3], QUESTION)

    def test_encrypted_question_large_enough_for_full_supported_input(self):
        question = 'заказы на озоне ' + 'я' * 1180
        self.say(question); row, state = self.state()
        self.assertEqual(state['question'], question)
        self.assertNotIn(question, row.encrypted_payload)
        self.assertNotIn('я' * 20, row.encrypted_payload)

    def test_cleanup_wipes_expired_question_retains_replay_tombstone(self):
        self.question(); row, _ = self.state()
        row.expires_at = timezone.now() - timedelta(seconds=1); row.save()
        call_command('queries_cleanup', verbosity=0)
        row.refresh_from_db(); self.assertEqual(row.encrypted_payload, '')
        self.assertIn('больше не действует', self.say(QUESTION, 0))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_tampered_ciphertext_fails_closed(self):
        self.question(); row, _ = self.state(); row.encrypted_payload = 'broken'; row.save()
        self.assertIn('больше не действует', self.say('все', 1))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_prompt_paging_and_all_are_bounded(self):
        for i in range(6): self.shop('Магазин ' + str(i), 'OZON')
        first = self.say(QUESTION); self.assertLess(len(first), 1024)
        self.assertIn('дальше', first)
        second = self.say('дальше', 1); self.assertIn('6.', second)
        self.say('все', 2)
        self.assertEqual(len(Query.objects.get(customer=self.actor).store_ids), 8)

    def test_both_marketplaces_do_not_silently_select_only_ozon(self):
        wb = self.shop('Третий', 'WB')
        self.say('заказы за вчера на озон и вайлдберриз по всем магазинам')
        self.assertIn(str(wb.pk), Query.objects.get(customer=self.actor).store_ids)

    def test_unlink_invalidates_pending_question(self):
        self.question(); self.link.revoked_at = timezone.now(); self.link.save()
        self.deny('AUTH_REQUIRED', lambda: self.say('все', 1))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--output', type=Path, required=True); args = parser.parse_args()
    connect = socket.socket.connect
    def confined(peer, address):
        if peer.family == socket.AF_UNIX or peer.family == socket.AF_INET and address == ('127.0.0.1', 55480):
            return connect(peer, address)
        raise AssertionError('External network forbidden')
    try:
        suite = unittest.TestSuite(VoiceChecks(name) for name in VoiceChecks.__dict__ if name.startswith('test_'))
        with patch.object(socket.socket, 'connect', confined), patch('socket.getaddrinfo', side_effect=AssertionError('DNS forbidden')):
            result = unittest.TextTestRunner(verbosity=2).run(suite)
        args.output.write_text(json.dumps({'scope': 'S09_VOICE_SELECTION_PG_UNIX_SYNTHETIC',
            'status': 'PASS' if result.wasSuccessful() else 'FAILED', 'tests_run': result.testsRun,
            'failures': len(result.failures), 'errors': len(result.errors)}, indent=2) + '\n')
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:
        connections.close_all(); TEMP.cleanup()
