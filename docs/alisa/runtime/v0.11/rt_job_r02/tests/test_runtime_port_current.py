"""Current-core guard/reader/accounting regressions, with synthetic providers."""
import copy
import json
from datetime import datetime, timezone
from unittest.mock import patch

from test_runtime_port_r01_contract import Setup, uid
from engine import Worker
from semantics import strict_json, fingerprint, Rejected
import model_usage
import retention


class CurrentCore(Setup):
    def row(self, receipt):
        with self.repo.connection() as c:
            ref=c.execute('SELECT * FROM rt_job_refs WHERE ref=?',(receipt['job_ref'],)).fetchone()
            return self.repo._row(c,ref['jid'],ref['runtime_tenant'])

    def run_until_terminal(self, receipt, maximum=30):
        for _ in range(maximum):
            row=self.row(receipt)
            if row['state'] not in {'QUEUED','RUNNING'}:return row
            self.worker.step();self.clock.advance(3)
        self.fail('Worker did not reach terminal state')

    def test_guarded_execution_never_uses_legacy_scope(self):
        def deny(_):raise AssertionError('Legacy scope bypass')
        self.engine.scope_for=deny
        _,receipt=self.submit()
        self.assertEqual(self.run_until_terminal(receipt)['state'],'READY')

    def test_cancel_one_of_two_refs_keeps_other_reader_running(self):
        _,a=self.submit();_,b=self.submit()
        self.assertEqual(self.row(a)['id'],self.row(b)['id'])
        reply=self.port.cancel(a['job_ref'],self.ctx,uid(),self.peer)
        self.assertTrue(reply['cancelled']);self.assertEqual(reply['state'],'CANCELLED')
        self.assertEqual(self.row(b)['state'],'QUEUED')
        self.assertEqual(self.run_until_terminal(b)['state'],'READY')
        self.assertEqual(self.port.status(a['job_ref'],self.ctx,self.peer)['state'],'CANCELLED')
        self.assertTrue(self.port.read_result(b['job_ref'],self.ctx,self.peer)['complete'])

    def test_last_reader_cancel_stops_shared_job(self):
        _,a=self.submit();_,b=self.submit()
        self.port.cancel(a['job_ref'],self.ctx,uid(),self.peer)
        self.port.cancel(b['job_ref'],self.ctx,uid(),self.peer)
        self.assertEqual(self.row(b)['state'],'CANCELLED')
        self.assertFalse(self.worker.step());self.assertEqual(self.transport.calls,[])

    def test_actor_refs_do_not_select_legacy_reader(self):
        _,receipt=self.submit()
        with self.repo.connection() as c:
            self.assertEqual(c.execute('SELECT COUNT(*)FROM pointers').fetchone()[0],0)
            cursors=c.execute('SELECT conversation,page,delivered FROM reader_cursors').fetchall()
            self.assertEqual([tuple(r)for r in cursors],[(self.port.reader(receipt['job_ref']),0,0)])

    def test_guard_persists_through_model_repair(self):
        task=self.task('интересный показатель за октябрь 2026 на озоне')
        receipt=self.port.submit(task,self.peer)
        self.transport.model_raw='{"expressions":'
        self.worker.step();self.clock.advance(1)
        self.assertEqual(self.row(receipt)['state'],'QUEUED')
        self.transport.model_raw=None
        row=self.run_until_terminal(receipt)
        self.assertEqual(row['state'],'READY',row['error'])
        self.assertEqual(strict_json(row['draft'])['runtime_guard'],strict_json(row['plan'])['runtime_guard'])
        self.assertEqual(sum(r.operation=='deepseek_parse' for r in self.transport.calls),2)

    def test_model_revocation_at_dispatch_does_not_count_paid_attempt(self):
        _,receipt=self.submit('интересный показатель за октябрь 2026 на озоне')
        outer=self
        class RevokingTransport:
            sent=0
            def execute_observed(self,request,store,on_dispatch):
                outer.auth.revoked=True
                on_dispatch()
                self.sent+=1
                raise AssertionError('Forbidden dispatch')
        transport=RevokingTransport();self.worker=Worker(self.engine,transport)
        self.worker.step()
        row=self.row(receipt);self.assertEqual(row['state'],'FAILED');self.assertEqual(transport.sent,0)
        summary=model_usage.summary(self.repo)
        self.assertEqual(summary['requests'],1);self.assertEqual(summary['attempts'],0)
        with self.repo.connection()as c:
            self.assertEqual(c.execute('SELECT error_code FROM calls').fetchone()[0],'ACCESS_REQUIRED')

    def test_revocation_during_render_blocks_publication(self):
        import providers
        render=providers.render;calls=[]
        def revoke(plan,completed,stamp):
            value=render(plan,completed,stamp);calls.append(1)
            if len(calls)==2:self.auth.revoked=True
            return value
        _,receipt=self.submit()
        with patch('providers.render',side_effect=revoke):row=self.run_until_terminal(receipt)
        self.assertEqual(row['state'],'FAILED');self.assertIsNone(row['result'])

    def test_model_accounting_keeps_current_seven_day_policy(self):
        self.assertEqual(model_usage.WINDOW_SECONDS,604800)
        _,receipt=self.submit()
        self.assertEqual(model_usage.summary(self.repo)['requests'],1)
        self.port.status(receipt['job_ref'],self.ctx,self.peer)
        self.assertEqual(model_usage.summary(self.repo)['requests'],1)
        self.clock.advance(604801);retention.sweep(self.repo)
        self.assertEqual(model_usage.summary(self.repo)['requests'],0)

    def test_current_table_branch_keeps_guard(self):
        from test_table_analytics import caps, Transport
        self.engine.table_capabilities=lambda:caps(self.auth.scope)
        self.worker=Worker(self.engine,Transport())
        _,receipt=self.submit('топ 1 товаров по сумме заказов за октябрь 2026 на озоне')
        row=self.run_until_terminal(receipt)
        self.assertEqual(row['state'],'READY',row['error'])
        self.assertIn('runtime_guard',strict_json(row['plan']))

    def test_current_dataset_branch_keeps_guard(self):
        import test_dataset_pipeline as fixture
        self.auth.scope=fixture.SCOPE
        self.clock.now=datetime(2026,11,5,8,tzinfo=timezone.utc).timestamp()
        self.ctx['not_after']=datetime.fromtimestamp(self.clock()+3600,timezone.utc).isoformat().replace('+00:00','Z')
        self.ctx=self.auth.issue(self.ctx)
        self.engine.dataset_capabilities=fixture.caps
        self.worker=Worker(self.engine,fixture.Transport())
        _,receipt=self.submit('товарные начисления по товарам с 4 по 4 ноября 2026 на озоне')
        row=self.run_until_terminal(receipt)
        self.assertEqual(row['state'],'READY',row['error'])
        self.assertIn('runtime_guard',strict_json(row['plan']))

    def universal(self, typed_decline=False):
        from universal_reads import ReadSurface
        from test_read_surface import POLICY
        self.engine.read_surface=ReadSurface(lambda:copy.deepcopy(POLICY))
        store=next(s.id for s in self.auth.scope.stores if s.platform=='ozon')
        decisions=[{'action':'discover','platform':'ozon','cluster':'prices_promotions','query':'action','offset':0},
            {'action':'read','store_id':store,'operation':'ozon_actions_list','params':{}},
            {'action':'finish','facts':[{'label':'Акция','expr':{'$path':['calls',0,'data','result',0,'title']}}],'coverage':'complete'}]
        class Transport:
            def __init__(self):self.calls=[]
            def prepare(self,*args):return None
            def execute_observed(self,request,store,on_dispatch):
                on_dispatch();return self.execute(request,store)
            def execute(self,request,store):
                self.calls.append(request.operation)
                if request.operation=='deepseek_parse':
                    value={'expressions':[],'fully_understood':True,'unsupported':True}
                    return {'content':json.dumps(value),'finish_reason':'stop'},{'status':200,'elapsed_ms':1,'bytes':100}
                if request.operation=='deepseek_read_plan':
                    return {'content':json.dumps(decisions.pop(0)),'finish_reason':'stop'},{'status':200,'elapsed_ms':1,'bytes':100}
                return {'result':[{'id':777,'title':'Акция','participating_products_count':3}]},{'status':200,'elapsed_ms':1,'bytes':100}
        transport=Transport();self.worker=Worker(self.engine,transport)
        question='интересный показатель за октябрь 2026 на озоне' if typed_decline else 'В каких акциях участвуют мои товары на Озоне'
        _,receipt=self.submit(question)
        return receipt,transport

    def test_universal_branch_is_guarded_and_uses_same_ledger(self):
        receipt,transport=self.universal()
        row=self.run_until_terminal(receipt)
        self.assertEqual(row['state'],'READY',row['error'])
        self.assertIn('runtime_guard',strict_json(row['plan']))
        self.assertEqual(model_usage.summary(self.repo)['attempts'],3)
        self.assertEqual(transport.calls.count('read.ozon.ozon_actions_list'),1)
        before=len(transport.calls)
        for _ in range(3):self.port.read_result(receipt['job_ref'],self.ctx,self.peer)
        self.assertEqual(len(transport.calls),before)

    def test_typed_decline_to_universal_preserves_guard(self):
        receipt,transport=self.universal(typed_decline=True)
        row=self.run_until_terminal(receipt)
        self.assertEqual(row['state'],'READY',row['error'])
        self.assertEqual(strict_json(row['draft'])['runtime_guard'],strict_json(row['plan'])['runtime_guard'])
        self.assertEqual(model_usage.summary(self.repo)['attempts'],4)

    def test_tampered_plan_guard_is_rejected_before_io(self):
        _,receipt=self.submit();row=self.row(receipt)
        plan=strict_json(row['plan']);plan['runtime_guard']['scope_hash']='a'*64
        with self.repo.connection(True)as c:c.execute('UPDATE jobs SET plan=?WHERE id=?',(json.dumps(plan),row['id']))
        self.worker.step();self.assertEqual(self.transport.calls,[])
        self.assertEqual(self.row(receipt)['state'],'FAILED')

    def test_mapping_changes_between_final_ticket_verify_and_resolve(self):
        from dataclasses import replace
        _,receipt=self.submit();self.assertEqual(self.run_until_terminal(receipt)['state'],'READY')
        verify=self.auth.verify;checks=[]
        def changing(ticket,service):
            claims=verify(ticket,service);checks.append(1)
            if len(checks)==2:self.auth.scope=replace(self.auth.scope,revision='changed-native-mapping')
            return claims
        self.auth.verify=changing
        self.reject('PERMISSION_DENIED',lambda:self.port.read_result(receipt['job_ref'],self.ctx,self.peer))

    def test_cancel_during_late_authority_prevents_paid_dispatch(self):
        _,receipt=self.submit('интересный показатель за октябрь 2026 на озоне')
        outer=self;resolve=self.auth.resolve;cancelled=[]
        def cancel_during_authority(pins,action):
            scope=resolve(pins,action)
            if action=='execute' and not cancelled:
                cancelled.append(True)
                with outer.repo.reader_scope(scope.tenant,outer.port.reader(receipt['job_ref'])):
                    outer.assertTrue(outer.repo.cancel(scope.tenant))
            return scope
        class Transport:
            sent=0
            def execute_observed(self,request,store,on_dispatch):
                with patch.object(outer.auth,'resolve',side_effect=cancel_during_authority):on_dispatch()
                self.sent+=1
                raise AssertionError('Cancelled dispatch')
        transport=Transport();self.worker=Worker(self.engine,transport)
        self.worker.step()
        self.assertTrue(cancelled);self.assertEqual(transport.sent,0)
        self.assertEqual(self.row(receipt)['state'],'CANCELLED')
        self.assertEqual(model_usage.summary(self.repo)['attempts'],0)

    def test_deadline_expiring_in_dispatch_callback_does_not_count_paid_call(self):
        from shared_http import _Budget,_Connection
        _,receipt=self.submit('интересный показатель за октябрь 2026 на озоне')
        row=self.repo.claim()
        event=self.repo.reserve(row['id'],row['owner'],'model:deepseek-flash',0,None)
        now=[24.0];sent=[]
        class Sink:
            def settimeout(self,_):pass
            def sendall(self,data):sent.append(data)
        def authorize_and_account():
            now[0]=26.0
            model_usage.dispatched(self.repo,event)
            return lambda:model_usage.undispatched(self.repo,event)
        connection=_Connection('localhost',budget=_Budget(25,25,authorize_and_account))
        connection.sock=Sink()
        with patch('shared_http.time.monotonic',side_effect=lambda:now[0]):
            with self.assertRaises(TimeoutError):connection.send(b'POST /fixture HTTP/1.1\r\n\r\n')
        connection.sock=None
        self.assertEqual(sent,[])
        self.assertEqual(model_usage.summary(self.repo)['attempts'],0)
