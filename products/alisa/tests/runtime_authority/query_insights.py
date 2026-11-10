#!/usr/bin/env python3
"""S08: real PG + signed Unix ingestion + own-result feedback; synthetic providers."""
import argparse,json,socket,time,unittest,uuid
from copy import deepcopy
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from query_roundtrip import QueryChecks,connections,TEMP,uid,timezone,AccessAdjustment
from django.conf import settings
from django.test import override_settings
from alisa_platform.query_insights import service,views
from alisa_platform.query_insights.models import Episode,Inbox,Coverage,Feedback
from alisa_platform.staff.models import StaffMember,StaffSession,StaffAuthFlow,StaffAuditEvent
from alisa_platform.funnel.models import FunnelEvent
from alisa_platform.queries.models import Query
from alisa_platform.runtime_adapter.authority import SessionPrincipal
from query_gap_events import make_event,canonical
from template_gaps import GapStore
from query_gap_terminal import TerminalStore

class InsightsChecks(unittest.TestCase):
    def setUp(self):
        Feedback.objects.all().delete();Episode.objects.all().delete();Inbox.objects.all().delete();Coverage.objects.all().delete()
        self.f=QueryChecks('runTest');self.f.setUp()
        self.addCleanup(self.f.doCleanups);self.addCleanup(self.f.tearDown)
        self.config=override_settings(QUERY_INSIGHTS_ENABLED=True,STAFF_ENABLED=True,STAFF_CLIENT_ID='fixture-staff',STAFF_SERVICE_TOKEN='S'*48)
        self.config.enable();self.addCleanup(self.config.disable)
        self.now=timezone.now();self.streams={k:uid()for k in ['template_misses','terminal_outcomes']}
    def event(self,**changes):
        event=make_event(b't'*32,'fixture-tenant',uid(),time.time(),'MODEL_NO_TEMPLATE','a'*64,
                         {'runtime_release':'fixture-core','original_question':'Покажи выкупы не из заказов за вчера'})
        event.update(changes);return event
    def packet(self,events=(),kind='template_misses',**changes):
        coverage={'kind':kind,'stream_id':self.streams[kind],'coverage_start':(self.now-timedelta(days=1)).timestamp(),
            'dropped':0,'pending_bytes':0,'oldest_pending_at':None,'internal_test':False}
        coverage.update(changes);return {'events':list(events),'coverage':coverage}
    def window(self,**changes):
        return {'from':(self.now-timedelta(hours=12)).isoformat(),'to':(timezone.now()+timedelta(seconds=5)).isoformat(),**changes}
    def send(self,events=(),kind='template_misses',**changes):return self.f.bridge.publish_query_gaps(self.packet(events,kind,**changes))
    def deny(self,fn,code='VALIDATION_FAILED'):
        with self.assertRaises(Exception)as caught:fn()
        self.assertEqual(getattr(caught.exception,'code',None),code)
    def staff(self,perms=('insights.read',)):
        import hashlib
        token=uid()+uid();now=timezone.now()
        member=StaffMember.objects.create(issuer=settings.IDENTITY_ISSUER,client_id=settings.STAFF_CLIENT_ID,subject=uid(),name='Fixture',role='ADMIN',permissions=list(perms))
        flow=StaffAuthFlow.objects.create(secret_hash=hashlib.sha256(uid().encode()).hexdigest(),encrypted_payload='',expires_at=now+timedelta(minutes=10),consumed_at=now)
        session=StaffSession.objects.create(member=member,flow=flow,token_hash=hashlib.sha256(token.encode()).hexdigest(),revision=1,mfa_verified_at=now,mfa_type='totp',encrypted_payload='',expires_at=now+timedelta(minutes=50))
        return token,member,session
    def staff_request(self,token,action='list',**extra):
        body={'session_token':token,'action':action,'filters':self.window(),**extra}
        request=self.f.factory.post('/api/v1/staff/query-insights',data=json.dumps(body),content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.STAFF_SERVICE_TOKEN)
        return views.staff(request)
    def test_real_signed_unix_ingest_and_duplicate_ack(self):
        event=self.event();packet=self.packet([event]);first=self.f.bridge.publish_query_gaps(packet)
        self.assertEqual(first,self.f.bridge.publish_query_gaps(packet));self.assertEqual(first['accepted'],[event['event_id']])
        self.assertEqual(Episode.objects.count(),1);self.assertEqual(Inbox.objects.count(),1)
    def test_conflicting_uuid_rolls_back_entire_batch(self):
        event=self.event();self.send([event]);bad=deepcopy(event);bad['reason_code']='OPERATOR_UNSUPPORTED'
        other=self.event();self.deny(lambda:self.send([other,bad]));self.assertEqual(Episode.objects.count(),1)
    def test_later_final_revision_enriches_one_episode(self):
        event=self.event();self.send([event]);final=deepcopy(event)
        final.update(event_id=uid(),episode_revision=2,final_outcome='UNSUPPORTED',redaction_state='METADATA_ONLY');final.pop('safe_utterance',None)
        self.send([final],kind='terminal_outcomes');row=Episode.objects.get()
        self.assertEqual(row.revision,2);self.assertEqual(row.outcome,'UNSUPPORTED');self.assertIn('не из заказов',row.event['safe_utterance']);self.assertEqual(Episode.objects.count(),1)
    def test_out_of_order_stage_does_not_revert_final_outcome(self):
        stage=self.event();final=deepcopy(stage);final.update(event_id=uid(),episode_revision=2,final_outcome='UNSUPPORTED',redaction_state='METADATA_ONLY');final.pop('safe_utterance',None)
        self.send([final],kind='terminal_outcomes');self.send([stage]);self.assertEqual(Episode.objects.get().outcome,'UNSUPPORTED');self.assertIn('safe_utterance',Episode.objects.get().event)
    def test_unknown_redactor_cannot_export_claimed_safe_text(self):
        event=self.event(redactor_version='unknown-redactor',safe_utterance='private lowercasename test@example.invalid')
        self.send([event]);value=service.journal(self.window(),export=True)
        self.assertEqual(value['items'][0]['redaction_state'],'METADATA_ONLY');self.assertNotIn('private',canonical(value));self.assertNotIn('safe_utterance',value['items'][0])
    def test_raw_field_or_wrong_producer_is_rejected(self):
        event=self.event();event['original_question']='PRIVATE'
        self.deny(lambda:self.send([event]));self.deny(lambda:self.send([self.event(producer='platform_feedback')]))
        self.assertEqual(Episode.objects.count(),0)
    def test_synthetic_historical_fallback_success_is_not_failure(self):
        self.send([self.event(reason_code='P1_MISS_P2_SUCCESS',p1_status='MISS',p2_status='SUCCESS',final_outcome='READY')])
        self.assertEqual(Episode.objects.get().outcome,'READY')
    def test_auth_provider_plan_and_template_failure_are_separate_counts(self):
        self.send([self.event(reason_code=x,final_outcome='FAILED')for x in ['AUTH_OR_SCOPE','PROVIDER_PLAN_REQUIRED','SEMANTIC_UNSUPPORTED']])
        value=service.journal(self.window());self.assertEqual({r['reason']:r['count']for r in value['counts']},{'AUTH_OR_SCOPE':1,'PROVIDER_PLAN_REQUIRED':1,'SEMANTIC_UNSUPPORTED':1})
        self.assertEqual(len(service.journal(self.window(reason='AUTH_OR_SCOPE'))['items']),1)
    def test_internal_checks_are_excluded_from_product_counts(self):
        self.send([self.event(internal_test=True)],internal_test=True)
        self.assertEqual(service.journal(self.window())['items'],[]);self.assertEqual(len(service.journal(self.window(include_internal=True))['items']),1)
    def test_complete_requires_both_streams_and_no_in_progress_or_lost_events(self):
        event=self.event(final_outcome='UNSUPPORTED');self.send([event]);self.assertFalse(service.journal(self.window())['coverage']['complete'])
        self.send(kind='terminal_outcomes');self.assertTrue(service.journal(self.window())['coverage']['complete'])
        self.send(dropped=1);self.assertFalse(service.journal(self.window())['coverage']['complete'])
        self.deny(lambda:self.send(dropped=0))
    def test_pending_and_stale_heartbeat_mark_selected_period_incomplete(self):
        self.send();self.send(kind='terminal_outcomes',pending_bytes=512,oldest_pending_at=self.now.timestamp())
        self.assertFalse(service.journal(self.window())['coverage']['complete'])
        self.send(kind='terminal_outcomes');Coverage.objects.update(seen_at=self.now-timedelta(minutes=4))
        self.assertFalse(service.journal(self.window())['coverage']['complete'])
    def test_export_is_byte_bounded_and_pages_without_duplicates(self):
        for _ in range(10):self.send([self.event()for _ in range(16)])
        seen=set();filters=self.window();pages=0
        while True:
            value=service.journal(filters,export=True);self.assertLess(len(canonical(value).encode()),110000)
            ids={x['id']for x in value['items']};self.assertFalse(seen&ids);seen|=ids;pages+=1
            if not value['has_more']:break
            filters['cursor']=value['next_cursor'];self.assertLess(pages,20)
        self.assertEqual(len(seen),160);self.assertGreater(pages,1)
    def test_staff_permission_mfa_revocation_and_safe_audit(self):
        self.send([self.event()]);token,member,session=self.staff()
        self.assertEqual(self.staff_request(token).status_code,200);self.assertEqual(self.staff_request(token,'export').status_code,403)
        last=StaffAuditEvent.objects.filter(action='query_insights.list',actor_id=member.pk).get();self.assertEqual(last.after,{'count':1});self.assertEqual(last.before,{})
        session.mfa_verified_at=self.now-timedelta(minutes=6);session.save(update_fields=['mfa_verified_at']);self.assertEqual(self.staff_request(token).status_code,403)
        session.mfa_verified_at=timezone.now();session.revoked_at=timezone.now();session.save(update_fields=['mfa_verified_at','revoked_at']);self.assertEqual(self.staff_request(token).status_code,403)
    def test_staff_export_permission_and_no_customer_session_authority(self):
        self.send([self.event()]);token,_,_=self.staff(('insights.export',))
        self.assertEqual(self.staff_request(token,'export').status_code,200);self.assertEqual(self.staff_request(self.f.web_token).status_code,403)
        self.assertEqual(self.staff_request(token,'export',filters={'query':'PRIVATE'}).status_code,422)
    def ready(self):self.f.send();self.f.finish_query()
    def test_feedback_uses_saved_result_once_without_model_or_useful_funnel_event(self):
        self.ready();calls=len(self.f.transport.calls)
        self.assertEqual(service.wrong_semantics(self.f.principal,self.f.qid)['state'],'RECORDED')
        self.assertEqual(service.wrong_semantics(self.f.principal,self.f.qid)['state'],'ALREADY_RECORDED')
        self.assertEqual(len(self.f.transport.calls),calls);self.assertEqual(Feedback.objects.count(),1);self.assertEqual(Episode.objects.get().reason,'WRONG_SEMANTICS')
        self.assertFalse(FunnelEvent.objects.filter(subject_id=self.f.actor.pk,event_type='query.first_useful_ready').exists())
    def test_feedback_is_for_own_ready_data_only(self):
        self.f.send();self.deny(lambda:service.wrong_semantics(self.f.principal,self.f.qid),code='RESULT_NOT_READY')
        self.f.finish_query()
        real=self.f.port.read_result
        def refusal(*a,**kw):
            value=real(*a,**kw);value['result_kind']='PROVIDER_REFUSAL';return value
        with patch.object(self.f.port,'read_result',refusal):self.deny(lambda:service.wrong_semantics(self.f.principal,self.f.qid))
        self.assertEqual(Feedback.objects.count(),0)
    def test_feedback_denied_after_session_logout(self):
        self.ready();self.f.session.revoked_at=timezone.now();self.f.session.save(update_fields=['revoked_at'])
        self.deny(lambda:service.wrong_semantics(self.f.principal,self.f.qid),code='AUTH_REQUIRED');self.assertEqual(Feedback.objects.count(),0)
    def test_feedback_expiry_and_access_revoke_are_enforced(self):
        self.ready();AccessAdjustment.objects.create(id=uid(),grant=self.f.grant,cutoff=timezone.now(),actor_id=uid(),reason='INITIAL_TEST')
        self.deny(lambda:service.wrong_semantics(self.f.principal,self.f.qid),code='ACCESS_REQUIRED');self.assertEqual(Feedback.objects.count(),0)
    def test_feedback_late_revoke_rolls_back_episode(self):
        self.ready();from alisa_platform.queries import service as queries
        answer=queries.read(self.f.principal,self.f.qid,result=True,with_delivery_guard=True,record_useful=False)
        self.f.session.revoked_at=timezone.now();self.f.session.save(update_fields=['revoked_at'])
        self.deny(lambda:service.record_feedback(self.f.principal,self.f.qid,answer),code='AUTH_REQUIRED');self.assertEqual(Episode.objects.count(),0)
    def test_feedback_expired_metadata_and_foreign_owner_are_denied(self):
        self.ready()
        from alisa_platform.accounts.models import Customer,Tenant,Membership
        customer=Customer.objects.create(email=uid()+'@example.invalid');tenant=Tenant.objects.create();Membership.objects.create(customer=customer,tenant=tenant)
        foreign=type('Principal',(),{'current':lambda _:(str(customer.pk),str(tenant.pk),0,{})})()
        self.deny(lambda:service.wrong_semantics(foreign,self.f.qid),code='NOT_FOUND')
        Query.objects.filter(pk=self.f.qid).update(expires_at=timezone.now()-timedelta(seconds=1))
        self.deny(lambda:service.wrong_semantics(self.f.principal,self.f.qid),code='RESULT_EXPIRED');self.assertEqual(Feedback.objects.count(),0)
    def test_feedback_second_guard_failure_rolls_back_both_rows(self):
        self.ready();from alisa_platform.queries import service as queries
        from alisa_platform.runtime_adapter.job_client import RuntimeFailure
        answer=queries.read(self.f.principal,self.f.qid,result=True,with_delivery_guard=True,record_useful=False)
        real=answer['delivery_guard']
        class LateGuard:
            calls=0
            def check(guard):
                guard.calls+=1
                if guard.calls==2:raise RuntimeFailure('ACCESS_REQUIRED')
                real.check()
        answer['delivery_guard']=LateGuard()
        self.deny(lambda:service.record_feedback(self.f.principal,self.f.qid,answer),code='ACCESS_REQUIRED')
        self.assertEqual(Feedback.objects.count(),0);self.assertEqual(Episode.objects.count(),0)
    def test_actual_failed_provider_transaction_delivers_final_reason_and_survives_cleanup(self):
        from provider_denial import diagnose_denial
        from importlib.util import spec_from_file_location,module_from_spec
        store=GapStore(Path(self.f.folder.name)/'template-gaps.sqlite3');store.state_path=Path(self.f.repo.path)
        stream=TerminalStore(self.f.repo.path,store.key,'fixture',cases=store);stream.initialize()
        self.f.send();job=self.f.repo.claim()
        diagnosis=diagnose_denial('read.ozon.marketplace_search_queries_top','https://api-seller.ozon.ru/v1/search-queries/top',403,b'{"code":7,"message":"Method available with Premium Pro subscription"}')
        self.assertTrue(self.f.repo.fail(job['id'],job['owner'],'HTTP_403_OZON_SUBSCRIPTION_REQUIRED',model_response=diagnosis['model_response']))
        spec=spec_from_file_location('publisher',Path(__file__).resolve().parents[2]/'infra/query_gap_publish.py');publisher=module_from_spec(spec);spec.loader.exec_module(publisher)
        publisher.deliver(stream,self.f.bridge);row=Episode.objects.get()
        self.assertEqual(row.reason,'PROVIDER_PLAN_REQUIRED');self.assertEqual(row.outcome,'FAILED');self.assertEqual(Inbox.objects.count(),1)
        with self.f.repo.connection(True)as c:c.execute('UPDATE jobs SET result=NULL')
        publisher.deliver(stream,self.f.bridge);self.assertEqual(Episode.objects.get().reason,'PROVIDER_PLAN_REQUIRED');self.assertEqual(Inbox.objects.count(),1)
    def test_shared_job_cancelled_reader_has_own_final_outcome(self):
        from alisa_platform.queries import service as queries
        from importlib.util import spec_from_file_location,module_from_spec
        store=GapStore(Path(self.f.folder.name)/'template-gaps.sqlite3');store.state_path=Path(self.f.repo.path)
        stream=TerminalStore(self.f.repo.path,store.key,'fixture',cases=store);stream.initialize()
        self.f.send();first=self.f.qid;self.f.qid=uid();self.f.send()
        with self.f.repo.connection()as c:
            self.assertEqual(c.execute('SELECT count(*)FROM jobs').fetchone()[0],1)
            row=c.execute('SELECT id,tenant FROM jobs').fetchone();receipts=[dict(r)for r in c.execute('SELECT rid,body_hash FROM inbox')]
        self.assertTrue(queries.cancel(self.f.principal,first,uid())['status']['cancelled'])
        store.save(row['tenant'],row['id'],time.time(),'MODEL_NO_TEMPLATE','a'*64,{'runtime_release':'fixture','original_question':'Покажи выкупы за вчера','request_receipts':receipts})
        with self.f.repo.connection(True)as c:c.execute("UPDATE jobs SET state='READY',result=?WHERE id=?",[json.dumps({'template_gap':True}),row['id']])
        spec=spec_from_file_location('publisher',Path(__file__).resolve().parents[2]/'infra/query_gap_publish.py');publisher=module_from_spec(spec);spec.loader.exec_module(publisher)
        publisher.deliver(store,self.f.bridge);publisher.deliver(stream,self.f.bridge)
        self.assertEqual(sorted(Episode.objects.values_list('outcome',flat=True)),['CANCELED','UNSUPPORTED'])
    def test_native_detailed_outbox_and_terminal_share_one_product_episode(self):
        self.f.send();store=GapStore(Path(self.f.folder.name)/'template-gaps.sqlite3');store.state_path=Path(self.f.repo.path)
        stream=TerminalStore(self.f.repo.path,store.key,'fixture',cases=store);stream.initialize()
        with self.f.repo.connection()as c:
            row=c.execute('SELECT tenant,rid,jid FROM inbox LIMIT 1').fetchone()
        store.save(row['tenant'],row['jid'],time.time(),'MODEL_NO_TEMPLATE','a'*64,{'runtime_release':'fixture','original_question':'Покажи выкупы за вчера','request_receipts':[{'rid':row['rid'],'body_hash':'private'}]})
        import query_gap_outbox
        from importlib.util import spec_from_file_location,module_from_spec
        spec=spec_from_file_location('publisher',Path(__file__).resolve().parents[2]/'infra/query_gap_publish.py');publisher=module_from_spec(spec);spec.loader.exec_module(publisher)
        publisher.deliver(store,self.f.bridge)
        with self.f.repo.connection(True)as c:c.execute("UPDATE jobs SET state='READY',result=?WHERE id=?",[json.dumps({'template_gap':True}),row['jid']])
        publisher.deliver(stream,self.f.bridge)
        self.assertEqual(Episode.objects.count(),1);self.assertEqual(Episode.objects.get().outcome,'UNSUPPORTED');self.assertEqual(Episode.objects.get().revision,2)
        self.assertEqual(query_gap_outbox.pending(store)[0]['events'],[]);self.assertEqual(stream.pending()[0]['events'],[])

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,required=True);args=parser.parse_args()
    original=socket.socket.connect
    def confined(peer,address):
        if peer.family==socket.AF_UNIX or peer.family==socket.AF_INET and address==('127.0.0.1',55480):return original(peer,address)
        raise AssertionError('External network forbidden')
    try:
        with patch.object(socket.socket,'connect',confined),patch('socket.getaddrinfo',side_effect=AssertionError('DNS forbidden')):
            result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(InsightsChecks))
        args.output.write_text(json.dumps({'scope':'S08_QUERY_INSIGHTS_PG_UNIX_SYNTHETIC_PROVIDER_MODEL','status':'PASS'if result.wasSuccessful()else'FAILED','tests_run':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)},indent=2)+'\n')
        raise SystemExit(0 if result.wasSuccessful()else 1)
    finally:connections.close_all();TEMP.cleanup()
