"""User-reported two-turn incident and durable/session-safe follow-up regressions."""
import copy,json,tempfile,unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import date
from pathlib import Path
from unittest.mock import patch
from test_runtime import Clock,SCOPE,FakeTransport,TODAY
from engine import Engine,Worker
from repository import Repository
from semantics import fingerprint,Rejected

class DialogueTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'test.sqlite'
        self.clock=Clock();self.scope=SCOPE
        self.repo=Repository(self.path,self.clock);self.engine=Engine(self.repo,lambda t: self.scope)
        self.transport=FakeTransport();self.worker=Worker(self.engine,self.transport)
    def tearDown(self):self.tmp.cleanup()
    def ask(self,q,i=0,s='session-one',rid=None,body=None,today=TODAY,tenant='A'):
        return self.engine.safe_submit(tenant,q,rid or s+'-'+str(i),body or fingerprint(q),today,conversation_id=s,message_id=i)
    def seed(self,q='дай продажи ща вчеар',s='session-one',i=0):
        r=self.ask(q,i,s);self.assertTrue(r.get('clarification_required'));return r
    def plan(self,jid=None):
        # A dialogue test must observe its own session, not the legacy pointer.
        with self.repo.reader_scope('A','session-one'):
            return json.loads(self.repo.get('A',jid)['plan'])
    def count_jobs(self):
        with self.repo.connection() as c:return c.execute('SELECT count(*) FROM jobs').fetchone()[0]
    def pending(self,s='session-one'):
        with self.repo.connection() as c:
            r=c.execute('SELECT pending FROM dialogue_context WHERE tenant=? AND conversation=?',('A',s)).fetchone()
            return json.loads(r[0]) if r and r[0] else None
    def test_exact_user_sequence(self):
        r=self.seed();self.assertIn('2026-11-02',r['text'])
        self.assertEqual(self.count_jobs(),0);self.assertEqual(self.repo.call_count(),0)
        r=self.ask('заказанные',1);self.assertEqual(r['state'],'QUEUED')
        p=self.plan();self.assertEqual(p['period'],{'from':'2026-11-02','to':'2026-11-02'})
        self.assertEqual(p['metrics'],['ordered_revenue','ordered_units']);self.assertEqual(len(p['stores']),2)
        self.assertIsNone(self.pending());self.assertEqual(self.count_jobs(),1)
    def test_worker_real_logic_mock_providers(self):
        self.seed();r=self.ask('заказанные',1)
        for _ in range(3):self.worker.step()
        self.assertEqual(self.repo.get('A',r['job_id'])['state'],'READY')
        self.assertEqual([x.operation for x in self.transport.calls],['ozon_orders','wb_orders'])
        result=self.ask('результат',2)
        self.assertIn('123.45',result['text']);self.assertIn('Вайлдберриз',result['text'])
        self.assertEqual(result['text'],result['tts'])
    def test_original_and_resolved_provenance(self):
        self.seed();a=self.ask('заказанные',1);d=json.loads(self.repo.get('A',a['job_id'])['draft'])['clarification']
        self.assertEqual(d['original_question'],'дай продажи ща вчеар')
        self.assertEqual(d['normalizations'],[{'from':'ща вчеар','to':'за вчера'}]);self.assertEqual(d['basis'],'orders')
    def test_plain_spelling(self):
        self.seed('дай продажи за вчера');self.ask('заказанные',1);self.assertEqual(self.plan()['period']['to'],'2026-11-02')
    def test_merged_spelling(self):
        self.seed('дайпродажи за вчера');r=self.ask('заказанные',1);self.assertEqual(r['state'],'QUEUED')
    def test_selected_market_preserved(self):
        self.seed('продажи за октябрь 2026 на озоне');self.ask('заказанные',1)
        self.assertEqual([s['platform'] for s in self.plan()['stores']],['ozon']);self.assertEqual(self.plan()['period']['from'],'2026-10-01')
    def test_totals_preserved(self):
        self.seed('продажи за вчера всего на озоне и wb');self.ask('заказанные',1);self.assertEqual(self.plan()['group_by'],'total')
    def test_wb_filter_preserved(self):
        self.seed('продажи за вчера по артикулу wb 12345 на wb');self.ask('заказанные',1)
        self.assertEqual(self.plan()['filters'],{'nm_ids':[12345]})
    def test_brand_literal_unchanged(self):
        self.seed('продажи за вчера по бренду "Ща вчеар" на wb');self.ask('заказанные',1)
        self.assertEqual(self.plan()['filters'],{'brands':['ща вчеар']})
    def test_two_clarifications(self):
        self.seed('дай продажи');r=self.ask('заказанные',1);self.assertEqual(r['error'],'PERIOD_REQUIRED')
        self.assertEqual(self.pending()['choice'],'orders');self.assertEqual(self.count_jobs(),0)
        r=self.ask('вчера',2);self.assertEqual(r['state'],'QUEUED');self.assertEqual(self.plan()['period']['from'],'2026-11-02')
    def test_explicit_period_only_clarification(self):
        self.seed('сводка заказов на озоне');r=self.ask('за октябрь 2026',1);self.assertEqual(r['state'],'QUEUED')
        self.assertEqual(len(self.plan()['stores']),1)
    def test_unknown_date_not_guessed(self):
        self.seed('дай продажи за непонятнодень');r=self.ask('заказанные',1)
        self.assertEqual(r['error'],'PERIOD_REQUIRED');self.assertEqual(self.count_jobs(),0)
    def test_restored_after_restart(self):
        self.seed();self.repo=Repository(self.path,self.clock);self.engine=Engine(self.repo,lambda t:self.scope)
        self.assertEqual(self.ask('заказанные',1)['state'],'QUEUED')
    def test_day_anchor_does_not_shift(self):
        self.seed('продажи за вчера');self.clock.advance(30)
        self.ask('заказанные',1,today=date(2026,11,4));self.assertEqual(self.plan()['period']['from'],'2026-11-02')
    def test_expired_context(self):
        self.seed();self.clock.advance(901);r=self.ask('заказанные',1)
        self.assertEqual(r['error'],'CLARIFICATION_MISSING');self.assertEqual(self.count_jobs(),0)
    def test_session_isolation(self):
        self.seed();r=self.ask('заказанные',0,s='session-two');self.assertEqual(r['error'],'CLARIFICATION_MISSING')
        self.assertIsNotNone(self.pending());self.assertEqual(self.count_jobs(),0)
    def test_tenant_isolation(self):
        self.seed();self.scope=replace(self.scope,tenant='B')
        r=self.ask('заказанные',1,tenant='B');self.assertEqual(r['error'],'CLARIFICATION_MISSING')
        self.assertEqual(self.count_jobs(),0)
    def test_changed_access_stops_merge(self):
        self.seed();self.scope=replace(self.scope,revision='new')
        r=self.ask('заказанные',1);self.assertEqual(r['error'],'CLARIFICATION_SCOPE_CHANGED');self.assertEqual(self.count_jobs(),0)
    def test_added_store_does_not_sneak_into_old_question(self):
        self.seed();self.scope=replace(self.scope,stores=self.scope.stores+(replace(self.scope.stores[0],id='extra',identity='other'),))
        self.assertEqual(self.ask('заказанные',1)['error'],'CLARIFICATION_SCOPE_CHANGED')
    def test_new_complete_question_replaces_pending(self):
        self.seed();self.ask('сумма заказов за сентябрь 2026 на озоне',1)
        self.assertEqual(self.plan()['period']['from'],'2026-09-01');self.assertIsNone(self.pending())
    def test_new_ambiguous_question_replaces_pending(self):
        self.seed('продажи за вчера');self.seed('продажи за октябрь 2026 на wb',i=1);self.ask('заказанные',2)
        self.assertEqual(self.plan()['period']['from'],'2026-10-01');self.assertEqual(len(self.plan()['stores']),1)
    def test_cancel_pending_not_unrelated_report(self):
        job=self.ask('сводка заказов за октябрь 2026 на озоне',0)
        self.seed(i=1);self.ask('отмени отчет',2)
        self.assertIsNone(self.pending());self.assertEqual(self.repo.get('A',job['job_id'])['state'],'QUEUED')
    def test_cancel_replay_does_not_cancel_new_pending(self):
        self.seed();a=self.ask('отмена',1);self.seed('продажи за октябрь 2026',i=2)
        self.assertEqual(a,self.ask('отмена',1));self.assertIsNotNone(self.pending())
    def test_help_preserves_pending(self):
        self.seed();self.ask('помощь',1);self.assertEqual(self.ask('заказанные',2)['state'],'QUEUED')
    def test_diagnostic_preserves_pending(self):
        self.seed();self.assertIn('сборка 8',self.ask('диагностика аналитики',1)['text'])
        self.assertEqual(self.ask('заказанные',2)['state'],'QUEUED')
    def test_result_while_pending_does_not_read_other_job(self):
        self.seed();r=self.ask('результат',1);self.assertTrue(r.get('clarification_required'));self.assertIsNotNone(self.pending())
    def test_duplicate_initial_question_no_reset(self):
        a=self.seed();self.ask('заказанные',1);self.assertEqual(a,self.ask('дай продажи ща вчеар',0))
        self.assertIsNone(self.pending());self.assertEqual(self.count_jobs(),1)
    def test_duplicate_answer_one_job(self):
        self.seed();a=self.ask('заказанные',1);b=self.ask('заказанные',1)
        self.assertEqual(a,b);self.assertEqual(self.count_jobs(),1)
    def test_answer_with_new_id_no_pending(self):
        self.seed();self.ask('заказанные',1)
        self.assertEqual(self.ask('заказанные',2)['error'],'CLARIFICATION_MISSING');self.assertEqual(self.count_jobs(),1)
    def test_changed_replay(self):
        self.seed();r=self.ask('выкупы',0);self.assertEqual(r['error'],'CHANGED_REPLAY');self.assertIsNotNone(self.pending())
    def test_out_of_order_turn_not_applied(self):
        self.seed(i=5);r=self.ask('заказанные',4);self.assertEqual(r['error'],'STALE_DIALOGUE_TURN');self.assertEqual(self.count_jobs(),0)
    def test_same_sequence_different_rid_rejected(self):
        self.seed();r=self.ask('дай продажи ща вчеар',0,rid='other');self.assertEqual(r['error'],'CHANGED_REPLAY')
    def test_both_concurrent_answers_one_job(self):
        self.seed()
        with ThreadPoolExecutor(max_workers=6) as pool:out=list(pool.map(lambda _:self.ask('заказанные',1),range(10)))
        self.assertTrue(all(r==out[0] for r in out));self.assertEqual(self.count_jobs(),1)
    def test_invalid_conversation_no_state(self):
        self.assertEqual(self.ask('заказанные',0,s='x')['error'],'DIALOGUE_SCHEMA')
        with self.repo.connection() as c:self.assertEqual(c.execute('SELECT count(*) FROM dialogue_context').fetchone()[0],0)
    def test_boolean_message_id_rejected(self):self.assertEqual(self.ask('заказанные',True)['error'],'DIALOGUE_SCHEMA')
    def test_unbounded_message_id_rejected(self):self.assertEqual(self.ask('заказанные',10**12)['error'],'DIALOGUE_SCHEMA')
    def test_secret_not_persisted_in_pending(self):
        q='дай продажи за вчера токен synthetic-no-real-secret'
        self.assertEqual(self.ask(q,0)['error'],'SENSITIVE_INPUT');self.assertIsNone(self.pending())
        self.assertNotIn('synthetic-no-real-secret',self.path.read_bytes().decode(errors='ignore'))
    def test_bare_date_after_expiry_never_reuses_old_query(self):
        self.seed('сводка заказов на озоне');self.clock.advance(901)
        self.assertEqual(self.ask('вчера',1)['error'],'CLARIFICATION_MISSING');self.assertEqual(self.count_jobs(),0)
    def test_orphan_date_no_model_job(self):
        self.assertEqual(self.ask('вчера')['error'],'CLARIFICATION_MISSING');self.assertEqual(self.count_jobs(),0)
    def test_polite_choice(self):
        self.seed();self.assertEqual(self.ask('заказанные пожалуйста',1)['state'],'QUEUED')
    def test_explicit_finance_choice(self):
        self.seed();r=self.ask('финансовые продажи',1);self.assertEqual(r['state'],'QUEUED')
        self.assertEqual(self.plan()['metrics'],['finance_sales'])
    def test_buyouts_not_silently_cohort(self):
        self.seed('продажи за вчера на wb');r=self.ask('выкупы',1)
        self.assertEqual(r['error'],'COHORT_REQUIRED');self.assertEqual(self.count_jobs(),0)
        r=self.ask('по дате заказа',2);self.assertEqual(r['state'],'QUEUED')
        self.assertEqual(self.plan()['metrics'],['buyout_revenue_cohort','buyout_units_cohort'])
    def test_buyout_event_not_replaced(self):
        self.seed();self.ask('выкупы',1);r=self.ask('по дате выкупа',2)
        self.assertEqual(r['error'],'EVENT_BUYOUTS_NOT_ENABLED');self.assertEqual(self.count_jobs(),0)
    def test_both_market_buyouts_no_partial_report(self):
        self.seed();self.ask('выкупы',1);r=self.ask('по дате заказа',2)
        self.assertEqual(r['error'],'PLATFORM_METRIC_NOT_ENABLED');self.assertEqual(self.count_jobs(),0)
    def test_denied_orders_not_enqueued(self):
        self.seed('продажи за вчера на озоне')
        self.repo.deny('oz1:ozon_orders','access1')
        # Real provider source ids are fingerprinted; inject deterministic auth denial.
        with patch.object(self.engine,'authorized',return_value=False):r=self.ask('заказанные',1)
        self.assertEqual(r['error'],'SOURCE_ACCESS');self.assertEqual(self.count_jobs(),0)
    def test_receipt_rechecks_access(self):
        self.seed();self.ask('заказанные',1);self.scope=replace(self.scope,revision='changed')
        self.assertEqual(self.ask('заказанные',1)['error'],'SOURCE_ACCESS')
    def test_failed_enqueue_rolls_back_context_transition(self):
        self.seed()
        with patch.object(self.repo,'enqueue',side_effect=RuntimeError('simulated process loss')):
            with self.assertRaises(RuntimeError):self.ask('заказанные',1)
        self.assertEqual(self.pending()['need'],'basis');self.assertEqual(self.count_jobs(),0)
        self.assertEqual(self.ask('заказанные',1)['state'],'QUEUED')
    def test_same_word_in_new_conversation_not_global_memory(self):
        self.seed('продажи за октябрь 2026 на озоне',s='thread-one')
        self.seed('продажи за сентябрь 2026 на wb',s='thread-two')
        a=self.ask('заказанные',1,s='thread-one');b=self.ask('заказанные',1,s='thread-two')
        self.assertEqual(self.plan(a['job_id'])['period']['from'],'2026-10-01')
        self.assertEqual(self.plan(b['job_id'])['period']['from'],'2026-09-01')
    def test_invalid_period_preserves_selected_basis(self):
        self.seed('дай продажи');self.ask('заказанные',1);r=self.ask('за завтра',2)
        self.assertNotIn('job_id',r);self.assertEqual(self.count_jobs(),0)
    def test_legacy_stateless_interface_unchanged(self):
        r=self.engine.safe_submit('A','заказанные','old',fingerprint('q'),TODAY)
        self.assertEqual(r['error'],'PERIOD_REQUIRED')
    def test_same_job_exact_cache_not_conversation_memory(self):
        self.seed('продажи за вчера на озоне');a=self.ask('заказанные',1);self.worker.step()
        self.seed('продажи за вчера на озоне',s='session-two');b=self.ask('заказанные',1,s='session-two')
        self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(b['cache'],'HIT');self.assertEqual(len(self.transport.calls),1)

if __name__=='__main__':unittest.main()
