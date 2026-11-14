from django.conf import settings
import unittest,importlib.util
if not getattr(settings,'OWNER_PARAMETER_COLLECTION_ENABLED',False)or importlib.util.find_spec('parameter_collection_runtime')is None:
    raise unittest.SkipTest('Requires explicit isolated R5 collection settings/runtime')
from django.test import TransactionTestCase,override_settings,RequestFactory
from django.utils import timezone
from django.db import connection
from copy import deepcopy
from datetime import timedelta
from unittest.mock import patch
import json,uuid
from current_parameters.collection_fixture import Environment
from alisa_platform.owner_data import parameter_collection as c,parameter_service as v
from alisa_platform.owner_data.service import Rejected
from alisa_platform.owner_data.models import CurrentParameter,OwnerCommand
from alisa_platform.queries.models import Query
from alisa_platform.runtime_adapter.job_client import RuntimeClient,RuntimeFailure
from alisa_platform.entitlements.models import AccessAdjustment

class Collection(TransactionTestCase):
    def setUp(self):self.e=Environment();self.e.setup()
    def tearDown(self):self.e.close()
    def start(self,cmd=None):
        self.cmd=cmd or self.e.start_command();return c.start(self.e.token,self.cmd)
    def finish(self):
        row=self.e.finish();self.assertEqual(row['state'],'READY',row.get('error'));return row
    def test_lk_real_unix_authority_worker_and_current_pg(self):
        a=self.start();self.assertTrue(a['dispatched'],a);self.assertEqual(len(self.e.transport.calls),0);self.finish()
        self.assertEqual(CurrentParameter.objects.count(),1);value=CurrentParameter.objects.get();self.assertEqual(value.value,'0.5');self.assertEqual(value.origin,'calculated')
        ops=[r.operation for r in self.e.transport.calls];self.assertNotIn('template_select',ops);self.assertEqual(ops.count('model_answer'),1)
        import sys,traceback,os
        def diagnostic(frame,event,arg):
            if event=='exception'and frame.f_code.co_name=='_exchange'and frame.f_code.co_filename.endswith('job_client.py'):traceback.print_exception(*arg)
            return diagnostic
        if os.environ.get('PARAMETER_RPC_TRACE')=='1':
            from alisa_platform.queries import service as qs
            from alisa_platform.runtime_adapter.authority import SessionPrincipal
            q=Query.objects.get();api=qs.client(SessionPrincipal(self.e.token),q.store_ids)
            ctx=api.authorizer.prepare('read_result');raw=self.e.port.read_result(str(q.runtime_job_ref),ctx,self.e.peer)
            print('SYNTHETIC_RESULT_SCHEMA',raw,'REAL_CLOCK',api.clock(),'NATIVE_CLOCK',self.e.clock())
            sys.settrace(diagnostic)
        try:r=c.check(self.e.token,self.e.check_command(self.cmd))
        finally:sys.settrace(None)
        self.assertEqual(r['collection']['write_outcome'],'COMMITTED');self.assertEqual(r['current']['effective']['value'],'0.5')
    def test_preview_uses_same_worker_without_write(self):
        self.start(self.e.start_command(mode='preview'));self.finish();self.assertEqual(CurrentParameter.objects.count(),0);self.assertEqual(OwnerCommand.objects.count(),0)
    def test_same_start_creates_one_query_and_job(self):
        self.start();second=c.start(self.e.token,self.cmd);self.assertTrue(second['replayed']);self.assertEqual(Query.objects.count(),1)
        with self.e.repo.connection()as db:self.assertEqual(db.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
    def test_lost_acceptance_needs_explicit_same_id_recovery(self):
        original=RuntimeClient.submit_collection
        def lose(api,*a,**kw):original(api,*a,**kw);raise RuntimeFailure('UNKNOWN_OUTCOME',outcome='UNKNOWN')
        with patch.object(RuntimeClient,'submit_collection',lose):r=self.start()
        self.assertFalse(r['dispatched']);self.assertEqual(Query.objects.count(),1)
        before=len(self.e.transport.calls);s=c.check(self.e.token,self.e.check_command(self.cmd));self.assertEqual(s['code'],'UNKNOWN_OUTCOME');self.assertEqual(before,len(self.e.transport.calls))
        r=c.check(self.e.token,self.e.check_command(self.cmd,'recover_collection'));self.assertTrue(r['dispatched'])
        with self.e.repo.connection()as db:self.assertEqual(db.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
        self.finish();self.assertEqual(CurrentParameter.objects.get().revision,1)
    def test_changed_period_same_id_denied(self):
        self.start();self.cmd['period']={'months':6}
        with self.assertRaises(Rejected)as e:c.start(self.e.token,self.cmd)
        self.assertEqual(e.exception.code,'IDEMPOTENCY_CONFLICT')
    def test_no_network_inside_admission_db_transaction(self):
        original=RuntimeClient.submit_collection
        def check(api,*a,**kw):self.assertFalse(connection.in_atomic_block);return original(api,*a,**kw)
        with patch.object(RuntimeClient,'submit_collection',check):self.start()
    def test_manual_change_during_collection_is_not_lost(self):
        self.start();self.e.save('0.12');row=self.e.finish();self.assertEqual(row['state'],'FAILED');self.assertEqual(CurrentParameter.objects.get().value,'0.12')
        first=c.check(self.e.token,self.e.check_command(self.cmd));calls=len(self.e.transport.calls)
        second=c.check(self.e.token,self.e.check_command(self.cmd));self.assertTrue(first['write_conflict']);self.assertTrue(second['write_conflict']);self.assertEqual(len(self.e.transport.calls),calls)
    def test_logout_revokes_explicit_pending_write(self):
        self.start();self.e.session.revoked_at=timezone.now();self.e.session.save();row=self.e.finish();self.assertEqual(row['state'],'FAILED');self.assertFalse(CurrentParameter.objects.exists())
    def test_cancel_stops_pending_write_even_before_provider_request(self):
        self.start();c.check(self.e.token,self.e.check_command(self.cmd,'cancel_collection'));row=self.e.finish();self.assertIn(row['state'],('CANCELLED','FAILED'));self.assertFalse(CurrentParameter.objects.exists())
    def test_query_intent_has_no_raw_token_or_coefficient_history(self):
        self.start();self.finish();raw=json.dumps(Query.objects.get().continuation);self.assertNotIn(self.e.token,raw);self.assertNotIn('0.5',raw);self.assertNotIn('"value"',raw)
    def test_unknown_browser_actor_fields_rejected(self):
        cmd=self.e.start_command();cmd['actor_id']=str(uuid.uuid4())
        with self.assertRaises(Rejected):self.start(cmd)
        self.assertFalse(Query.objects.exists())
    def test_disabled_native_gate_never_queues(self):
        self.e.engine.parameter_source_policy={'enabled':False}
        with self.assertRaises(Rejected):self.start()
        self.assertFalse(Query.objects.exists());self.assertIsNone(self.e.row())

    def test_lost_commit_reply_resumes_same_sources_without_second_write(self):
        self.start();original=self.e.native_authority._exchange;lost=[False]
        def lose(raw):
            status,reply=original(raw);request=json.loads(raw)
            if request.get('operation')=='parameter_collection'and request['payload'].get('method')=='commit'and not lost[0]:
                lost[0]=True;raise TimeoutError('synthetic lost commit ACK')
            return status,reply
        with patch.object(self.e.native_authority,'_exchange',lose):self.finish()
        self.assertTrue(lost[0]);self.assertEqual(CurrentParameter.objects.get().revision,1);self.assertEqual(OwnerCommand.objects.count(),1)
        self.assertEqual(sum(x.operation=='read.ozon.report_postings_create'for x in self.e.transport.calls),2)
    def test_cancel_after_commit_reports_saved_not_reverted(self):
        self.start();self.finish();r=c.check(self.e.token,self.e.check_command(self.cmd,'cancel_collection'))
        self.assertFalse(r['cancelled']);self.assertTrue(r['already_saved']);self.assertEqual(CurrentParameter.objects.get().value,'0.5')
    def test_revoked_entitlement_stops_sources_and_write(self):
        self.start();AccessAdjustment.objects.create(id=uuid.uuid4(),grant=self.e.grant,cutoff=self.e.grant.starts_at,actor_id=uuid.uuid4(),reason='SYNTHETIC_REVOKE')
        row=self.e.finish();self.assertEqual(row['state'],'FAILED');self.assertEqual(len(self.e.transport.calls),0);self.assertFalse(CurrentParameter.objects.exists())
    def test_revoked_seller_key_stops_write(self):
        self.start();self.e.credential.status='REVOKED';self.e.credential.save();row=self.e.finish();self.assertEqual(row['state'],'FAILED');self.assertFalse(CurrentParameter.objects.exists())
    def test_default_year_remains_default_in_admitted_fragment(self):
        cmd=self.e.start_command();cmd['period']=None;self.start(cmd);self.e.worker.step()
        from semantics import strict_json
        row=self.e.row();plan=strict_json(row['plan']);part=plan['fragments'][0]['plan']['parameter_source']['period']
        self.assertFalse(part['explicit']);self.assertEqual(part,Query.objects.get().continuation['parameter_collection']['period'])
        self.assertEqual(len(self.e.transport.calls),0)
    def test_no_permission_to_submit_other_owners_command(self):
        self.start();from alisa_platform.runtime_adapter.authority import SessionPrincipal
        from alisa_platform.queries import service as qs
        api=qs.client(SessionPrincipal(self.e.token),[str(self.e.store.pk)])
        with self.assertRaises(RuntimeFailure):api.submit_collection('anything',request_id=str(uuid.uuid4()),logical_query_id=str(uuid.uuid4()),trace_id=str(uuid.uuid4()))
        with self.e.repo.connection()as db:self.assertEqual(db.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
    def test_ordinary_submit_cannot_collide_with_admitted_collection_id(self):
        self.start();from alisa_platform.runtime_adapter.authority import SessionPrincipal
        from alisa_platform.queries import service as qs
        api=qs.client(SessionPrincipal(self.e.token),[str(self.e.store.pk)]);row=Query.objects.get()
        with self.assertRaises(RuntimeFailure)as error:api.submit(row.continuation['parameter_collection']['utterance'],request_id=str(row.pk),logical_query_id=str(row.pk),trace_id=str(row.trace_id))
        self.assertEqual(error.exception.code,'IDEMPOTENCY_CONFLICT')

    def test_recover_cancelled_command_does_not_admit_again(self):
        self.start();c.check(self.e.token,self.e.check_command(self.cmd,'cancel_collection'))
        with self.assertRaises(Rejected):c.check(self.e.token,self.e.check_command(self.cmd,'recover_collection'))
        with self.e.repo.connection()as db:self.assertEqual(db.execute('SELECT COUNT(*)FROM jobs').fetchone()[0],1)
    def test_expired_initial_command_does_not_create_query(self):
        cmd=self.e.start_command();cmd['not_after']=int(timezone.now().timestamp())-1
        with self.assertRaises(Rejected)as error:self.start(cmd)
        self.assertEqual(error.exception.code,'OWNER_COMMAND_EXPIRED');self.assertFalse(Query.objects.exists())
    def test_other_period_never_replaces_original_on_recovery(self):
        self.start();q=Query.objects.get();original=deepcopy(q.continuation['parameter_collection']['period']);c.check(self.e.token,self.e.check_command(self.cmd,'recover_collection'));q.refresh_from_db()
        self.assertEqual(q.continuation['parameter_collection']['period'],original)

    def test_slow_readiness_does_not_admit_expired_initial_command(self):
        import time
        cmd=self.e.start_command();cmd['not_after']=int(time.time())+1;original=c.readiness
        def slow(*args):
            result=original(*args);time.sleep(2);return result
        with patch.object(c,'readiness',slow):
            with self.assertRaises(Rejected)as error:c.start(self.e.token,cmd)
        self.assertEqual(error.exception.code,'OWNER_COMMAND_EXPIRED');self.assertFalse(Query.objects.exists());self.assertIsNone(self.e.row())
    def test_readiness_false_does_not_require_performance_credentials(self):
        self.assertEqual(self.e.credential.kind,'SELLER')
        result=c.readiness(self.e.token,str(self.e.store.pk),'loss_rate',{'kind':'store','sku':''})
        self.assertTrue(result['available']);self.assertFalse(Query.objects.exists());self.assertEqual(len(self.e.transport.calls),0)

    def test_completed_collection_never_relabels_old_result_as_current(self):
        self.start();self.finish();self.e.save('0.07',1)
        result=c.check(self.e.token,self.e.check_command(self.cmd))
        self.assertTrue(result['superseded']);self.assertNotIn('result',result);self.assertEqual(result['current']['effective']['value'],'0.07');self.assertIsNone(result['current']['effective']['calculated_at'])
