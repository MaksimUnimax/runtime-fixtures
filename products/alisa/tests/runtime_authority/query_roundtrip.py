#!/usr/bin/env python3
"""Query metadata/API/voice against real PG + current core + Unix authority.

Providers and model remain synthetic. No installed or owner acceptance claim.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
import json
import socket
import threading
import unittest
from unittest.mock import patch
from current_core_roundtrip import RoundtripChecks, RuntimeClient, RuntimeFailure, connections, TEMP
from checks import uid, timezone, AccessAdjustment, token_digest
from django.test import override_settings
from django.core.management import call_command
from alisa_platform.runtime_adapter.authority import SessionPrincipal, AlicePrincipal
from alisa_platform.queries import service, views, voice
from alisa_platform.queries.models import Query

QUESTION = 'сводка заказов за октябрь 2026 на озоне'


class QueryChecks(RoundtripChecks):
    def setUp(self):
        super().setUp()
        self.override = override_settings(QUERIES_ENABLED=True); self.override.enable()
        self.addCleanup(self.override.disable)
        self.authority_patch = patch.object(service, 'configured_authority', return_value=self.authority)
        self.authority_patch.start(); self.addCleanup(self.authority_patch.stop)
        self.client_patch = patch.object(service, 'configured_client', side_effect=lambda authorizer:
            RuntimeClient(str(self.gateway.server_address), self.client.uid, self.client.versions,
                          authorizer, clock=self.clock))
        self.client_patch.start(); self.addCleanup(self.client_patch.stop)
        self.principal = SessionPrincipal(self.web_token)
        self.qid = uid(); self.stores = [str(self.store.pk)]

    def send(self, **changes):
        return service.submit(self.principal, self.qid, self.stores, QUESTION, **changes)

    def finish_query(self):
        row = Query.objects.get(pk=self.qid)
        self.finish({'job_ref': str(row.runtime_job_ref)})

    def test_submit_persists_public_ref_then_both_channels_read_same_result(self):
        value, status = self.send(); self.assertEqual(status, 201)
        self.finish_query(); calls = len(self.transport.calls)
        web = service.read(self.principal, self.qid, result=True)
        _, _, _, token = self.issue_alice()
        alice = service.read(AlicePrincipal(token), self.qid, result=True)
        self.assertEqual(web['result'], alice['result']); self.assertEqual(calls, len(self.transport.calls))
        self.assertTrue(web['query']['submission_confirmed'])

    def test_duplicate_and_page_reopen_never_submit_again(self):
        self.send(); self.send(); self.finish_query()
        for _ in range(2):
            service.list_queries(self.principal); service.read(self.principal, self.qid)
            service.read(self.principal, self.qid, result=True)
        self.assertEqual(Query.objects.filter(pk=self.qid).count(), 1)
        with self.repo.connection() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)
        from alisa_platform.funnel.models import FunnelEvent
        self.assertEqual(FunnelEvent.objects.filter(subject_id=self.actor.pk,event_type='query.first_useful_ready').count(),1)

    def test_same_id_changed_body_is_conflict(self):
        self.send()
        self.deny('IDEMPOTENCY_CONFLICT', lambda: service.submit(self.principal, self.qid, self.stores, QUESTION+'!'))

    def test_unknown_after_real_accept_needs_explicit_identical_recovery(self):
        real = RuntimeClient.submit
        def accept_then_lose(api, *args, **kwargs):
            real(api, *args, **kwargs)
            raise RuntimeFailure('UNKNOWN_OUTCOME', outcome='UNKNOWN')
        with patch.object(RuntimeClient, 'submit', accept_then_lose):
            result, status = self.send(); self.assertEqual(status, 202)
        self.assertFalse(result['query']['submission_confirmed'])
        with patch.object(RuntimeClient, 'submit', side_effect=AssertionError('implicit resubmit')):
            self.send(); service.list_queries(self.principal); service.read(self.principal, self.qid)
        result, status = self.send(recover=True); self.assertEqual(status, 201)
        with self.repo.connection() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM jobs').fetchone()[0], 1)

    def test_no_db_transaction_during_mutation_ipc(self):
        from django.db import connection
        real = RuntimeClient.submit
        def assert_unlocked(api, *args, **kwargs):
            self.assertFalse(connection.in_atomic_block)
            return real(api, *args, **kwargs)
        with patch.object(RuntimeClient, 'submit', assert_unlocked):self.send()

    def test_concurrent_same_submission_has_one_sender(self):
        entered, release = threading.Event(), threading.Event(); real = RuntimeClient.submit
        def wait(api, *args, **kwargs):
            entered.set(); self.assertTrue(release.wait(5)); return real(api, *args, **kwargs)
        def first():
            try:return self.send()
            finally:connections.close_all()
        with patch.object(RuntimeClient, 'submit', wait), ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(first); self.assertTrue(entered.wait(5))
            try:self.assertEqual(self.send(recover=True)[1], 202)
            finally:release.set()
            self.assertEqual(future.result()[1], 201)

    def test_receipt_has_no_question_result_ticket_or_tokens(self):
        self.send(); self.finish_query(); service.read(self.principal, self.qid, result=True)
        row = Query.objects.get(pk=self.qid)
        raw = json.dumps({k:str(v) for k,v in row.__dict__.items()})
        for secret in (QUESTION,self.web_token,'execution_ticket','pages','model_result'):
            self.assertNotIn(secret, raw)

    def test_foreign_query_id_and_expired_query_are_denied_without_ipc(self):
        self.send()
        from alisa_platform.accounts.models import Customer, Tenant, Membership
        other = Customer.objects.create(email=uid()+'@example.invalid'); tenant = Tenant.objects.create()
        Membership.objects.create(customer=other, tenant=tenant)
        principal = type('Principal', (), {'current': lambda _:(str(other.pk),str(tenant.pk),0,{})})()
        self.deny('NOT_FOUND',lambda:service.read(principal,self.qid,result=True))
        Query.objects.filter(pk=self.qid).update(expires_at=timezone.now()-timedelta(seconds=1))
        with patch.object(service,'client',side_effect=AssertionError('expired IPC')):
            self.deny('RESULT_EXPIRED',lambda:service.read(self.principal,self.qid,result=True))

    def test_revoked_access_cannot_read_saved_report(self):
        self.send();self.finish_query()
        AccessAdjustment.objects.create(id=uid(),grant=self.grant,cutoff=timezone.now(),actor_id=uid(),reason='INITIAL_TEST')
        self.ledger.revision+=1;self.ledger.save(update_fields=['revision'])
        self.deny('ACCESS_REQUIRED',lambda:service.read(self.principal,self.qid,result=True))

    def test_current_session_logout_denies_list_and_result(self):
        self.send(); self.session.revoked_at=timezone.now(); self.session.save(update_fields=['revoked_at'])
        self.deny('AUTH_REQUIRED',lambda:service.list_queries(self.principal))
        self.deny('AUTH_REQUIRED',lambda:service.read(self.principal,self.qid,result=True))

    def test_cancel_is_runtime_reader_cancel(self):
        self.send(); value=service.cancel(self.principal,self.qid,uid())
        self.assertTrue(value['status']['cancelled']); self.assertEqual(value['query']['state'],'CANCELLED')
        self.assertEqual(len(self.transport.calls),0)

    def test_unknown_cancel_never_claims_stopped(self):
        with patch.object(RuntimeClient,'submit',side_effect=RuntimeFailure('UNKNOWN_OUTCOME',outcome='UNKNOWN')):self.send()
        value=service.cancel(self.principal,self.qid,uid())
        self.assertEqual(value['code'],'UNKNOWN_OUTCOME');self.assertNotIn('status',value)

    def test_cleanup_only_expired_metadata(self):
        self.send();call_command('queries_cleanup',verbosity=0)
        self.assertTrue(Query.objects.filter(pk=self.qid).exists())
        Query.objects.filter(pk=self.qid).update(expires_at=timezone.now()-timedelta(seconds=1))
        call_command('queries_cleanup',verbosity=0)
        self.assertFalse(Query.objects.filter(pk=self.qid).exists())
        with self.repo.connection() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM jobs').fetchone()[0],1)

    def test_bff_rejects_browser_claims_and_never_accepts_tickets(self):
        body={'session_token':self.web_token,'command':{'action':'submit','id':self.qid,
              'store_ids':self.stores,'utterance':QUESTION,'execution_ticket':'fake'}}
        req=self.factory.post('/api/v1/account/queries',data=json.dumps(body),content_type='application/json',
                              HTTP_AUTHORIZATION='Bearer '+__import__('django.conf',fromlist=['settings']).settings.AUTH_SERVICE_TOKEN)
        self.assertEqual(views.queries(req).status_code,422)
        self.assertFalse(Query.objects.filter(pk=self.qid).exists())

    def test_paid_refusal_uses_same_runtime_result_and_one_api_request(self):
        from model_answer import Settings
        from test_model_answer import Transport
        from engine import Worker
        from pathlib import Path
        import test_paid_model_result as paid
        self.engine.answer_settings=Settings(Path(self.socket_dir.name)/'answer-settings.json')
        self.repo.answer_settings=self.engine.answer_settings;self.transport=Transport();self.worker=Worker(self.engine,self.transport)
        diagnosis=paid.diagnose()
        def deny(request):
            if request.operation=='ozon_orders':raise paid.error(diagnosis)
        self.transport.on_call=deny
        self.send();self.finish_query();web=service.read(self.principal,self.qid,result=True)['result']
        _,_,_,token=self.issue_alice();alice=service.read(AlicePrincipal(token),self.qid,result=True)['result']
        self.assertEqual(web,alice);self.assertEqual(web['result_kind'],'PROVIDER_REFUSAL')
        self.assertIsNone(web['model_result']['data']);self.assertEqual(len(self.transport.answer_calls),1)
        self.assertEqual([r.operation for r in self.transport.calls].count('ozon_orders'),1)
        from alisa_platform.funnel.models import FunnelEvent
        self.assertFalse(FunnelEvent.objects.filter(subject_id=self.actor.pk,event_type='query.first_useful_ready').exists())

    def payload(self,command,mid=0):
        from django.conf import settings
        return {'session':{'skill_id':settings.ALICE_SKILL_ID,'session_id':'fixture-session','message_id':mid},
                'request':{'original_utterance':command}}

    def test_voice_submit_ready_and_web_read_share_receipt(self):
        _,link,_,token=self.issue_alice()
        voice.handle(token,self.payload(QUESTION))
        row=Query.objects.filter(customer=self.actor).latest('created_at');self.qid=str(row.pk);self.finish_query()
        calls=len(self.transport.calls)
        private=voice.handle(token,self.payload('готово',1))['response']['text']
        self.assertIn('кабинете',private)
        web=service.read(self.principal,self.qid,result=True)['result']
        link.voice_private=False;link.save(update_fields=['voice_private'])
        public=voice.handle(token,self.payload('повтори',2))['response']['text']
        self.assertEqual(public,web['pages'][0]);self.assertEqual(calls,len(self.transport.calls))

    def test_duplicate_voice_message_never_creates_new_job(self):
        _,_,_,token=self.issue_alice();payload=self.payload(QUESTION)
        voice.handle(token,payload);voice.handle(token,payload)
        self.assertEqual(Query.objects.filter(customer=self.actor).count(),1)
        with self.repo.connection() as conn:self.assertEqual(conn.execute('SELECT count(*) FROM jobs').fetchone()[0],1)

    def test_voice_privacy_changed_during_read_hides_pages(self):
        _,link,_,token=self.issue_alice();link.voice_private=False;link.save(update_fields=['voice_private'])
        voice.handle(token,self.payload(QUESTION));row=Query.objects.filter(customer=self.actor).latest('created_at')
        self.qid=str(row.pk);self.finish_query();real=service.read
        def change(*args,**kwargs):
            value=real(*args,**kwargs)
            if kwargs.get('result'):
                link.voice_private=True;link.save(update_fields=['voice_private'])
            return value
        with patch.object(service,'read',change):value=voice.handle(token,self.payload('готово',1))
        self.assertIn('кабинете',value['response']['text'])

    def test_voice_unlink_during_read_never_releases_pages(self):
        _,link,_,token=self.issue_alice();voice.handle(token,self.payload(QUESTION))
        self.qid=str(Query.objects.filter(customer=self.actor).latest('created_at').pk);self.finish_query();real=service.read
        def revoke(*args,**kwargs):
            value=real(*args,**kwargs)
            if kwargs.get('result'):link.revoked_at=timezone.now();link.save(update_fields=['revoked_at'])
            return value
        with patch.object(service,'read',revoke):self.deny('AUTH_REQUIRED',lambda:voice.handle(token,self.payload('готово',1)))

    def test_voice_new_session_does_not_read_another_session_pointer(self):
        _,_,_,token=self.issue_alice();voice.handle(token,self.payload(QUESTION));payload=self.payload('готово',1)
        payload['session']['session_id']='different-session'
        with patch.object(service,'read',side_effect=AssertionError('cross dialogue read')):
            self.assertIn('нет задания',voice.handle(token,payload)['response']['text'])


if __name__=='__main__':
    from pathlib import Path
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    original=socket.socket.connect
    def confined(peer,address):
        if peer.family==socket.AF_UNIX or peer.family==socket.AF_INET and address==('127.0.0.1',55480):return original(peer,address)
        raise AssertionError('External network forbidden')
    try:
        suite=unittest.TestSuite(QueryChecks(name) for name in QueryChecks.__dict__ if name.startswith('test_'))
        with patch.object(socket.socket,'connect',confined),patch('socket.getaddrinfo',side_effect=AssertionError('DNS forbidden')):
            result=unittest.TextTestRunner(verbosity=2).run(suite)
        args.output.write_text(json.dumps({'scope':'S07_QUERY_PLATFORM_PG_UNIX_SYNTHETIC_PROVIDER_MODEL',
            'status':'PASS' if result.wasSuccessful() else 'FAILED','tests_run':result.testsRun,
            'failures':len(result.failures),'errors':len(result.errors)},indent=2)+'\n')
        raise SystemExit(0 if result.wasSuccessful() else 1)
    finally:connections.close_all();TEMP.cleanup()
