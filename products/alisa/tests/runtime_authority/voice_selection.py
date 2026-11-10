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
import threading
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

from query_roundtrip import QueryChecks, connections, TEMP, uid, timezone, RuntimeClient, RuntimeFailure
from checks import Store, VaultSecret, CredentialRevision, settings, AccessAdjustment
from alisa_platform.queries import service, voice, voice_dialogue as dialogue
from alisa_platform.queries.models import Query, VoiceDialogue
from alisa_platform.alice_link.vault import unseal, seal
from alisa_platform.runtime_adapter.authority import AlicePrincipal
from django.core.management import call_command

QUESTION = 'сводка заказов за октябрь 2026 на озоне'


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
        row = VoiceDialogue.objects.filter(customer=self.actor).order_by('-last_message_id').first()
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
        self.assertEqual(VoiceDialogue.objects.filter(customer=self.actor).order_by('-last_message_id').first().encrypted_payload, '')

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

    def test_changed_runtime_mapping_without_database_revision_stops_dispatch(self):
        self.question()
        self.document['tenants'][0]['stores'][0]['runtime_store']['source_revision'] = 'changed'
        self.write()
        self.assertIn('изменилось', self.say('все', 1))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_key_change_in_second_prepare_is_checked_before_ipc(self):
        self.question(); original = dialogue.PinnedAuthorizer.prepare; calls = []
        def change(authorizer, operation):
            calls.append(operation)
            if len(calls) == 2:
                CredentialRevision.objects.filter(store=self.second).update(status='REVOKED')
            return original(authorizer, operation)
        with patch.object(dialogue.PinnedAuthorizer, 'prepare', change):
            self.assertIn('изменилось', self.say('все', 1))
        self.assertEqual(len(calls), 2)
        with self.repo.connection() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM jobs').fetchone()[0], 0)

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
        self.question(); self.say('все', 1)
        self.assertIsNotNone(Query.objects.get(customer=self.actor).runtime_job_ref)
        self.say(QUESTION, 2)
        with patch.object(service, 'cancel', side_effect=AssertionError('Wrong reader cancellation')):
            self.assertIn('не отправлен', self.say('отмена', 3))
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)
        self.assertNotIn('question', self.state()[1])

    def test_empty_reply_with_one_empty_alias_never_selects(self):
        self.second.voice_alias = ''; self.second.save()
        self.question(); self.assertIn('Уточните', self.say('', 1))
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_expired_pending_cancel_never_targets_previous_query(self):
        self.question(); self.say('все', 1); self.say(QUESTION, 2)
        row = VoiceDialogue.objects.filter(customer=self.actor).order_by('-last_message_id').first()
        row.expires_at = timezone.now() - timedelta(seconds=1); row.save()
        with patch.object(service, 'cancel', side_effect=AssertionError('Cancelled previous query')):
            self.assertIn('больше не действует', self.say('отмена', 3))

    def test_cancel_during_dispatch_targets_reserved_query_after_accept(self):
        self.question(); self.say('все', 1); previous = Query.objects.get(customer=self.actor)
        self.say(QUESTION, 2)
        original = service.submit; during = []
        def cancel_before_receipt(*args, **kwargs):
            self.assertNotEqual(args[1], str(previous.pk))
            during.append(self.say('отмена', 4))
            self.assertIn('не подтверждена', during[0])
            return original(*args, **kwargs)
        with patch.object(service, 'submit', cancel_before_receipt):
            self.assertIn('отменено', self.say('все', 3))
        self.assertNotEqual(Query.objects.get(pk=previous.pk).state, 'CANCELLED')
        self.assertEqual(Query.objects.exclude(pk=previous.pk).get(customer=self.actor).state, 'CANCELLED')

    def test_concurrent_duplicate_selection_has_one_dispatcher(self):
        self.question(); entered, release = threading.Event(), threading.Event(); original = service.submit
        def wait(*args, **kwargs):
            entered.set(); self.assertTrue(release.wait(5)); return original(*args, **kwargs)
        def first():
            try: return self.say('все', 1)
            finally: connections.close_all()
        with patch.object(service, 'submit', wait), ThreadPoolExecutor(max_workers=1) as pool:
            pending = pool.submit(first); self.assertTrue(entered.wait(5))
            try: self.assertIn('не подтверждена', self.say('все', 1))
            finally: release.set()
            self.assertIn('принято', pending.result(timeout=10))
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)

    def test_new_question_during_dispatch_cannot_erase_cancellation_intent(self):
        self.question(); original = service.submit
        def pending(*args, **kwargs):
            self.assertIn('не подтверждена', self.say('отмена', 2))
            self.assertIn('предыдущего вопроса', self.say(QUESTION + ' новый вопрос', 3))
            return original(*args, **kwargs)
        with patch.object(service, 'submit', pending):
            self.assertIn('отменено', self.say('все', 1))
        self.assertEqual(Query.objects.filter(customer=self.actor).count(), 1)
        self.assertEqual(Query.objects.get(customer=self.actor).state, 'CANCELLED')

    def test_cancel_after_receipt_before_complete_has_one_sender_even_on_unknown(self):
        self.question(); original = dialogue.complete; observed = []
        def before_complete(*args, **kwargs):
            self.assertIsNotNone(Query.objects.get(customer=self.actor).runtime_job_ref)
            observed.append(self.say('отмена', 2))
            return original(*args, **kwargs)
        with patch.object(dialogue, 'complete', before_complete), patch.object(service, 'cancel',
                side_effect=RuntimeFailure('UNKNOWN_OUTCOME', outcome='UNKNOWN')) as cancel:
            self.assertIn('не подтверждена', self.say('все', 1))
            self.assertEqual(cancel.call_count, 1)
            self.say('отмена', 2)
            self.assertEqual(cancel.call_count, 1)
        self.assertIn('не подтверждена', observed[0])

    def test_new_question_after_completed_state_ttl_is_accepted_normally(self):
        self.question(); self.say('все', 1)
        row = VoiceDialogue.objects.filter(customer=self.actor).order_by('-last_message_id').first()
        row.expires_at = timezone.now() - timedelta(seconds=1); row.save()
        self.assertIn('Уточните', self.say(QUESTION, 2))

    def test_orphan_dispatch_expires_without_blocking_or_late_sender(self):
        self.question(); row, _ = self.state(); principal = AlicePrincipal(self.token)
        frozen = dialogue.advance(principal, row.session_hash, 1, uid(), 'все')['submit']
        dialogue.advance(principal, row.session_hash, 2, uid(), 'отмена')
        row.refresh_from_db(); cancel_id = row.cancel_id
        row.expires_at = timezone.now() - timedelta(seconds=1); row.save()
        call_command('queries_cleanup', verbosity=0)
        self.assertIn('Уточните', self.say(QUESTION, 3))
        self.deny('PERMISSION_DENIED', lambda: service.submit(principal, frozen['query_id'],
            [s['id'] for s in frozen['stores']], frozen['question'], channel='ALICE',
            voice_session_hash=row.session_hash, store_snapshot=frozen['stores']))
        self.assertIsNone(dialogue.complete(principal, row.session_hash, frozen['query_id']))
        row.refresh_from_db(); self.assertEqual(row.phase, 'ABANDONED')
        self.assertEqual(row.cancel_id, cancel_id); self.assertEqual(str(row.query_id), frozen['query_id'])
        self.assertEqual(row.encrypted_payload, '')
        self.assertFalse(Query.objects.filter(customer=self.actor).exists())

    def test_orphan_dispatch_recovers_even_before_cleanup_timer(self):
        self.question(); row, _ = self.state(); principal = AlicePrincipal(self.token)
        dialogue.advance(principal, row.session_hash, 1, uid(), 'все')
        row.refresh_from_db(); row.expires_at = timezone.now() - timedelta(seconds=1); row.save()
        self.assertIn('Уточните', self.say(QUESTION, 2))
        row.refresh_from_db(); self.assertEqual(row.phase, 'ABANDONED')
        self.assertEqual(row.encrypted_payload, '')

    def test_explicit_new_cancel_after_unknown_reuses_id_without_automatic_retry(self):
        self.question(); self.say('все', 1)
        with patch.object(service, 'cancel', side_effect=RuntimeFailure('UNKNOWN_OUTCOME', outcome='UNKNOWN')) as cancel:
            self.say('отмена', 2); first = cancel.call_args.args
            self.say('отмена', 2); self.assertEqual(cancel.call_count, 1)
            self.say('отмена', 3); self.assertEqual(cancel.call_count, 2)
            self.assertEqual(first[0].current()[:2], cancel.call_args.args[0].current()[:2])
            self.assertEqual(first[1:], cancel.call_args.args[1:])

    def test_unknown_after_accept_never_automatically_resubmits(self):
        self.question(); original = RuntimeClient.submit
        def lose(api, *args, **kwargs):
            original(api, *args, **kwargs)
            raise RuntimeFailure('UNKNOWN_OUTCOME', outcome='UNKNOWN')
        with patch.object(RuntimeClient, 'submit', lose):
            self.assertIn('не подтверждена', self.say('все', 1))
        with patch.object(RuntimeClient, 'submit', side_effect=AssertionError('Implicit retry')):
            self.say('все', 1); self.say('готово', 2)
        with self.repo.connection() as conn:
            self.assertEqual(conn.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)

    def test_exclusion_is_forwarded_verbatim_without_reinterpreting_template(self):
        question = QUESTION + ', кроме товара 777'
        self.say(question)
        with patch.object(service, 'submit', wraps=service.submit) as submit:
            self.say('все', 1)
        self.assertEqual(submit.call_args.args[3], question)

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

    def test_expiry_blocks_alias_even_before_timer_and_does_not_refresh_on_prompt(self):
        self.question(); row, _ = self.state(); deadline = row.expires_at
        self.say('не понял', 1); row.refresh_from_db(); self.assertEqual(row.expires_at, deadline)
        row.expires_at = timezone.now() - timedelta(seconds=1); row.save()
        self.assertIn('больше не действует', self.say('озон два', 2))
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
