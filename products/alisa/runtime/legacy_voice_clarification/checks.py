"""Real native queue + Station ingress + private Unix authority; synthetic OAuth."""
from copy import deepcopy
from dataclasses import replace
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_template_only import Transport, selection, TODAY
from test_runtime import Clock, SCOPE
from engine import Engine, Worker
from model_answer import Settings
from repository import Repository
from semantics import fingerprint, strict_json, canonical_json
from legacy_voice import Authority
import station_authority as sa

spec = importlib.util.spec_from_file_location('legacy_station_service', os.environ['TEST_STATION_SOURCE'] + '/service.py')
station = importlib.util.module_from_spec(spec); spec.loader.exec_module(station)


class Checks(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='lv-', dir='/tmp')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name); self.clock = Clock(); self.scope = SCOPE
        self.token_hash = fingerprint('synthetic access credential')
        self.token_db = self.root / 'oauth.sqlite3'
        station.TOKEN_DB = str(self.token_db)
        with sqlite3.connect(self.token_db) as c:
            c.execute('CREATE TABLE tokens(hash TEXT, account TEXT, kind TEXT, revoked INTEGER, expires REAL)')
            c.execute('INSERT INTO tokens VALUES(?,?,?,?,?)', (self.token_hash, 'A', 'access', 0, time.time()+7200))
        self.delivery = station.Delivery(self.root, SimpleNamespace(), client=SimpleNamespace(),
                                          clock=self.clock, auth=station.token_active)
        self.delivery.state.update(owner='synthetic-owner', binding={'tenant': 'A', 'application': 'synthetic-app'},
                                   selected={'id': 'synthetic-column'})
        self.delivery.save()
        self.registry = station.Registry.__new__(station.Registry)
        self.registry.lock = threading.RLock(); self.registry.users = {'synthetic-owner': self.delivery}
        self.registry.policy = SimpleNamespace(state={'settings': deepcopy(station.DEFAULTS)})
        self.registry.pair_fail = {}
        self.server = sa.Server(str(self.root/'authority.sock'), sa.Handler)
        self.server.allowed_uid = os.geteuid(); self.server.registry = self.registry
        self.thread = threading.Thread(target=self.server.serve_forever, kwargs={'poll_interval': .01})
        self.thread.start(); self.addCleanup(self.close)
        self.repo = Repository(self.root/'runtime.sqlite3', self.clock)
        self.settings = Settings(self.root/'answer.json')
        self.engine = Engine(self.repo, lambda t: self.scope, answer_settings=self.settings, template_mode=True)
        self.engine.legacy_voice_authority = Authority(str(self.root/'authority.sock'))
        self.transport = Transport(); self.worker = Worker(self.engine, self.transport)
        self.transport.selection = {'action': 'clarify', 'question': 'За какой период подготовить отчёт?', 'missing': ['period']}
        self.sequence = 0

    def close(self):
        self.server.shutdown(); self.thread.join(2); self.server.server_close()

    def revoke(self):
        with sqlite3.connect(self.token_db) as c:
            c.execute('UPDATE tokens SET revoked=1')

    def submit(self, text, rid=None, seq=None, conversation='synthetic-session', application='synthetic-app', before=True, after=True):
        self.sequence += 1
        rid = rid or 'req-'+str(self.sequence); seq = self.sequence if seq is None else seq
        if before:
            opening = self.registry.ingress(dict(op='before', tenant='A', application=application, token_hash=self.token_hash,
                                                 rid=rid, command=text, conversation=conversation, message_id=seq))
        result = self.engine.safe_submit('A', text, rid, fingerprint(text), TODAY,
                                         conversation_id=conversation, message_id=seq)
        if before and after:
            self.registry.ingress(dict(op='after', tenant='A', application=application, token_hash=self.token_hash,
                conversation=conversation, result=result, ticket=opening.get('ticket')))
        return result

    def ask(self):
        value = self.submit('Покажи заказы по магазину, исключая товар Z')
        self.assertIn('job_id', value, value)
        self.worker.step(); self.jid = value['job_id']
        row = self.row()
        self.assertEqual(row['state'], 'READY', row.get('error'))
        self.assertIn('clarification', strict_json(row['result']))
        return value

    def row(self):
        return self.repo.get('A', self.jid)

    def count(self, table):
        with self.repo.connection() as c:
            return c.execute('SELECT count(*) FROM '+table).fetchone()[0]

    def finish(self):
        for _ in range(80):
            row = self.row()
            if row['state'] not in ('QUEUED', 'RUNNING'):
                return row
            self.clock.advance(max(0, row['due']-self.clock())+1)
            self.worker.step()
        self.fail('unfinished')

    def test_full_question_answer_one_job_and_one_marketplace_call(self):
        self.ask(); initial = strict_json(self.row()['plan'])
        self.assertEqual([x.operation for x in self.transport.calls], ['template_select'])
        value = self.submit('за октябрь 2026')
        self.assertEqual(value['job_id'], self.jid); self.assertEqual(value['state'], 'QUEUED')
        self.transport.selection = selection()
        row = self.finish(); self.assertEqual(row['state'], 'READY', row['error'])
        self.assertEqual(self.count('jobs'), 1); self.assertEqual(self.count('inbox'), 1)
        self.assertEqual([x.operation for x in self.transport.calls], ['template_select', 'template_select', 'ozon_orders', 'model_answer'])
        plan = strict_json(row['plan'])
        for key in ('question', 'calendar_date', 'timezone', 'stores', 'template_execution'):
            self.assertEqual(plan[key], initial[key])
        self.assertNotIn('runtime_guard', plan)
        self.assertIn('за октябрь', strict_json(row['draft'])['question_clarifications'][0])

    def test_lost_acceptance_response_retry_is_same_job(self):
        self.ask()
        first = self.submit('вчера', rid='same-answer', seq=2)
        again = self.submit('вчера', rid='same-answer', seq=2)
        self.assertEqual(first, again)
        self.assertEqual(self.count('jobs'), 1)
        self.assertEqual(len(strict_json(self.row()['draft'])['question_clarifications']), 1)
        self.assertEqual(len(self.transport.calls), 1)

    def test_changed_answer_same_request_denied(self):
        self.ask(); self.submit('вчера', rid='same-answer', seq=2)
        self.assertEqual(self.submit('сегодня', rid='same-answer', seq=2)['error'], 'CHANGED_REPLAY')
        self.assertEqual(self.count('jobs'), 1)

    def test_revocation_blocks_continuation_without_job_change(self):
        self.ask(); self.revoke()
        result = self.submit('вчера', before=False)
        self.assertIn(result.get('error'), ('PERMISSION_DENIED', 'SOURCE_ACCESS'))
        self.assertEqual(self.row()['state'], 'READY'); self.assertEqual(len(self.transport.calls), 1)

    def test_revocation_blocks_worker_dispatch(self):
        self.ask(); self.submit('вчера'); self.revoke()
        self.transport.selection = selection(); self.finish()
        self.assertEqual(len(self.transport.calls), 1)

    def test_scope_change_blocks_answer(self):
        self.ask(); self.scope = replace(self.scope, revision='new-revision')
        self.assertIn(self.submit('вчера').get('error'), ('PERMISSION_DENIED', 'SOURCE_ACCESS'))
        self.assertEqual(self.count('jobs'), 1); self.assertEqual(len(self.transport.calls), 1)

    def test_unbound_application_cannot_continue_same_reader(self):
        self.ask()
        self.assertEqual(self.submit('вчера', application='unknown-app')['error'], 'PERMISSION_DENIED')
        self.assertEqual(len(self.transport.calls), 1)

    def test_supplied_owner_does_not_select_another_binding(self):
        self.ask(); guard = strict_json(self.row()['plan'])['station_guard']
        altered = dict(guard, owner='different-owner')
        self.assertFalse(self.engine.legacy_voice_authority.current(altered, 'A'))
        self.assertFalse(self.engine.legacy_voice_authority.current(dict(guard, tenant='B'), 'B'))

    def test_expired_question_does_not_enqueue_answer_as_new_request(self):
        self.ask(); self.clock.advance(301)
        result = self.submit('вчера')
        self.assertEqual(result.get('error'), 'RESULT_EXPIRED')
        self.assertEqual(self.count('jobs'), 1); self.assertEqual(len(self.transport.calls), 1)

    def test_cancel_pending_then_late_answer_does_not_start_calculation(self):
        self.ask(); self.assertEqual(self.submit('отмена')['state'], 'CANCELLED')
        self.assertEqual(self.submit('вчера').get('error'), 'PERMISSION_DENIED')
        self.assertEqual(self.count('jobs'), 1); self.assertEqual(len(self.transport.calls), 1)

    def test_four_turn_limit_uses_existing_lifecycle(self):
        self.ask()
        for _ in range(4):
            result = self.submit('уточнение')
            self.assertEqual(result['job_id'], self.jid); self.worker.step()
        self.assertNotIn('clarification', strict_json(self.row()['result']))
        self.assertEqual(self.count('jobs'), 1)
        self.assertFalse(any(x.store_id for x in self.transport.calls))

    def test_private_guard_never_in_model_context(self):
        self.ask(); body = self.transport.calls[0].body
        self.assertTrue(body['context']['clarification_supported'])
        self.assertNotIn('station_guard', canonical_json(body))
        self.assertNotIn(self.token_hash, canonical_json(body))

    def test_unknown_binding_keeps_legacy_refusal_policy(self):
        value = self.submit('Покажи заказы', application='unknown-app')
        self.jid = value['job_id']; self.worker.step()
        self.assertNotIn('clarification', strict_json(self.row()['result']))
        self.assertNotIn('clarification_supported', self.transport.calls[0].body['context'])

    def test_fresh_legacy_token_renews_existing_proof_without_new_access(self):
        self.ask(); old = strict_json(self.row()['plan'])['station_guard']
        self.revoke(); self.token_hash = fingerprint('new synthetic access')
        with sqlite3.connect(self.token_db) as c:
            c.execute('INSERT INTO tokens VALUES(?,?,?,?,?)', (self.token_hash, 'A', 'access', 0, time.time()+7200))
        value = self.submit('вчера')
        self.assertEqual(value['job_id'], self.jid)
        self.assertTrue(self.engine.legacy_voice_authority.current(old, 'A'))
        self.assertEqual(self.count('jobs'), 1)

    def test_new_callback_session_continues_existing_question(self):
        from station_status import status
        self.ask()
        result = status(self.engine, dict(op='station_deliver', tenant='A', conversation_id='synthetic-session',
                        job_id=self.jid, target_conversation='callback-session', message_id=0))
        self.assertEqual(result['state'], 'READY')
        value = self.submit('вчера', conversation='callback-session', seq=1)
        self.assertEqual(value['job_id'], self.jid); self.assertEqual(self.count('jobs'), 1)

    def test_prior_provider_call_blocks_mutating_pending_job(self):
        self.ask()
        with self.repo.connection(True) as c:
            c.execute("UPDATE calls SET source='ozon:synthetic' WHERE jid=?", (self.jid,))
        self.assertEqual(self.submit('вчера').get('error'), 'PERMISSION_DENIED')
        self.assertEqual(len(self.transport.calls), 1)

    def test_receipt_replay_rechecks_current_authority(self):
        self.ask(); self.submit('вчера', rid='answer', seq=2); self.revoke()
        result = self.submit('вчера', rid='answer', seq=2, before=False)
        self.assertIn(result.get('error'), ('SOURCE_ACCESS', 'PERMISSION_DENIED'))

    def test_authority_wrong_unix_peer_is_denied(self):
        self.server.allowed_uid = os.geteuid()+10000
        self.assertEqual(self.submit('Покажи заказы').get('error'), 'DEPENDENCY_UNAVAILABLE')
        self.assertEqual(self.count('jobs'), 0)

    def test_ambiguous_saved_binding_revokes_existing_ticket(self):
        self.ask(); guard = strict_json(self.row()['plan'])['station_guard']
        other = SimpleNamespace(state=deepcopy(self.delivery.state), lock=threading.RLock(),
                                auth=self.delivery.auth, clock=self.delivery.clock)
        other.state['owner'] = 'other-owner'; sa.publish(other); self.registry.users['other-owner'] = other
        self.assertFalse(self.engine.legacy_voice_authority.current(guard, 'A'))

    def test_binding_revision_revokes_old_ticket(self):
        self.ask(); guard = strict_json(self.row()['plan'])['station_guard']
        self.delivery.state['voice_binding_revision'] = 1
        self.delivery.save()
        self.assertFalse(self.engine.legacy_voice_authority.current(guard, 'A'))

    def test_refresh_token_cannot_admit_continuation(self):
        self.ask()
        with sqlite3.connect(self.token_db) as c:
            c.execute("UPDATE tokens SET kind='refresh'")
        self.assertIn(self.submit('вчера', before=False).get('error'), ('SOURCE_ACCESS', 'PERMISSION_DENIED'))

    def test_revocation_between_transport_prepare_and_dispatch(self):
        self.ask(); self.submit('вчера'); self.transport.selection = selection()
        original = self.transport.execute_observed
        def revoke_then_dispatch(request, store, dispatch):
            self.revoke()
            return original(request, store, dispatch)
        self.transport.execute_observed = revoke_then_dispatch
        self.finish(); self.assertEqual(len(self.transport.calls), 1)

    def test_manual_result_route_does_not_deadlock_reverse_authority(self):
        from station_status import status
        self.ask(); self.delivery.peek = lambda value: status(self.engine, value)
        result = self.registry.ingress(dict(op='before', tenant='A', application='synthetic-app',
            token_hash=self.token_hash, rid='manual-result', command='результат',
            conversation='synthetic-session', message_id=2))
        self.assertEqual(result['reply'], 'За какой период подготовить отчёт?')
        self.assertEqual(len(self.transport.calls), 1)

    def test_cancel_callback_reader_keeps_original_reader_question(self):
        from station_status import status
        self.ask()
        status(self.engine, dict(op='station_deliver', tenant='A', conversation_id='synthetic-session',
            job_id=self.jid, target_conversation='callback-session', message_id=0))
        value = self.submit('отмена', conversation='callback-session', seq=1)
        self.assertEqual(value['state'], 'CANCELLED')
        self.assertEqual(self.row()['state'], 'READY')
        value = self.submit('вчера', conversation='synthetic-session', seq=2)
        self.assertEqual(value['job_id'], self.jid); self.assertEqual(value['state'], 'QUEUED')
        self.assertEqual(self.count('jobs'), 1)

    def test_changed_authority_snapshot_fails_closed(self):
        self.ask(); guard = strict_json(self.row()['plan'])['station_guard']
        original = self.delivery.auth
        def changed(tenant, token_hash):
            result = original(tenant, token_hash)
            self.delivery.state['voice_binding_revision'] = 1
            sa.publish(self.delivery)
            return result
        self.delivery.auth = changed
        with self.assertRaisesRegex(Exception, 'DEPENDENCY_UNAVAILABLE'):
            self.engine.legacy_voice_authority.current(guard, 'A')

    def test_failed_disconnect_write_invalidates_old_guard_and_dispatch(self):
        self.ask(); self.submit('вчера')
        guard = strict_json(self.row()['plan'])['station_guard']
        with patch.object(station, 'atomic', side_effect=OSError('synthetic disk failure')):
            with self.assertRaises(OSError):
                self.delivery.disconnect()
        with self.assertRaisesRegex(Exception, 'DEPENDENCY_UNAVAILABLE'):
            self.engine.legacy_voice_authority.current(guard, 'A')
        self.worker.step()
        self.assertEqual(len(self.transport.calls), 1)

    def test_lost_before_after_receipt_replay_persists_fresh_token(self):
        question = 'Покажи заказы по магазину'
        initial = self.submit(question, rid='original-request', seq=1, after=False)
        self.jid = initial['job_id']; self.worker.step()
        self.assertIsNone(self.delivery.state['job'])
        guard = strict_json(self.row()['plan'])['station_guard']
        self.revoke(); self.token_hash = fingerprint('refreshed synthetic access')
        with sqlite3.connect(self.token_db) as c:
            c.execute('INSERT INTO tokens VALUES(?,?,?,?,?)', (self.token_hash, 'A', 'access', 0, time.time()+7200))
        replay = self.submit(question, rid='original-request', seq=1)
        self.assertEqual(replay, initial)
        self.assertTrue(self.engine.legacy_voice_authority.current(guard, 'A'))
        saved = json.loads((self.root/'state.json').read_text())
        self.assertEqual(saved['turn_receipts']['original-request']['voice_auth']['token_hash'], self.token_hash)
        self.assertEqual(self.count('jobs'), 1); self.assertEqual(len(self.transport.calls), 1)

    def test_failed_refresh_save_recovers_on_same_receipt_retry(self):
        question = 'Покажи заказы по магазину'
        initial = self.submit(question, rid='original-request', seq=1, after=False)
        self.jid = initial['job_id']; self.worker.step()
        before = deepcopy(self.delivery.state['turn_receipts']['original-request'])
        self.revoke(); self.token_hash = fingerprint('refreshed synthetic access')
        with sqlite3.connect(self.token_db) as c:
            c.execute('INSERT INTO tokens VALUES(?,?,?,?,?)', (self.token_hash, 'A', 'access', 0, time.time()+7200))
        with patch.object(station, 'atomic', side_effect=OSError('one failed write')):
            with self.assertRaises(OSError):
                self.submit(question, rid='original-request', seq=1)
        self.assertIsNone(self.delivery.voice_authority_view)
        replay = self.submit(question, rid='original-request', seq=1)
        self.assertEqual(replay, initial)
        current = self.delivery.state['turn_receipts']['original-request']
        for key in ('ticket', 'at', 'rid', 'conversation', 'seq'):
            self.assertEqual(current[key], before[key])
        self.assertIsNotNone(self.delivery.voice_authority_view)
        self.assertEqual(self.count('jobs'), 1); self.assertEqual(len(self.transport.calls), 1)

    def test_unsaved_different_owner_does_not_block_existing_owner(self):
        self.ask(); guard = strict_json(self.row()['plan'])['station_guard']
        other = SimpleNamespace(state={'owner': 'different-owner',
            'binding': {'tenant': 'B', 'application': 'different-app'}, 'turn_receipts': {}}, voice_authority_view=None)
        self.registry.users['different-owner'] = other
        self.assertTrue(self.engine.legacy_voice_authority.current(guard, 'A'))
        other.state['binding'] = {'tenant': 'A', 'application': 'synthetic-app'}
        with self.assertRaisesRegex(Exception, 'DEPENDENCY_UNAVAILABLE'):
            self.engine.legacy_voice_authority.current(guard, 'A')


if __name__ == '__main__':
    unittest.main()
