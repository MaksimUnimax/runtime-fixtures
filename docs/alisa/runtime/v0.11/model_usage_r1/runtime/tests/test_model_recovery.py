import json,unittest
from unittest.mock import patch
from copy import deepcopy
from dataclasses import replace
from test_read_surface import Universal as Fixture
from engine import Worker,CallError
from model_recovery import provider_feedback,expression_contract,FORBIDDEN_READ_FUNCTIONS,template_shape

class ModelRecovery(unittest.TestCase):
    setUp=Fixture.setUp;tearDown=Fixture.tearDown;ask=Fixture.ask;finish=Fixture.finish;direct=Fixture.direct
    def wire(self,status=400,fail_operation='read.ozon.ozon_actions_list',revoke=False):
        original=self.transport;outer=self;seen=[]
        class Transport:
            def prepare(self,*args):return None
            def execute(self,request,store=None):
                if request.operation==fail_operation:
                    outer.physical.append(request.operation);seen.append(1)
                    if revoke:outer.scope=replace(outer.scope,revision='revoked')
                    raise CallError('HTTP_'+str(status),status=status,feedback={'mentioned_parameters':[]})
                if request.operation=='read.ozon.ozon_action_products':
                    outer.physical.append(request.operation)
                    return {'result':{'products':[{'id':777}],'total':1}},{'status':200,'elapsed_ms':1,'bytes':100}
                return original.execute(request,store)
        self.worker=Worker(self.engine,Transport());return seen
    def alternative(self):
        store=next(s.id for s in self.scope.stores if s.platform=='ozon')
        return {'action':'read','store_id':store,'operation':'ozon_action_products','params':{'action_id':777,'limit':100}}
    def finish_alternative(self):
        return {'action':'finish','facts':[{'label':'Товаров в акции','expr':{'$path':['calls',0,'data','result','total']}}],'coverage':'complete'}
    def test_provider_400_repaired_in_same_job(self):
        self.decisions=self.decisions[:2]+[self.alternative(),self.finish_alternative()]
        seen=self.wire();a=self.ask('В каких акциях участвуют мои товары на Озоне, акция 777');row=self.finish(a)
        self.assertEqual(row['state'],'READY',row['error']);self.assertEqual(row['id'],a['job_id']);self.assertEqual(len(seen),1)
    def test_provider_422_uses_the_same_repair_boundary(self):
        self.decisions=self.decisions[:2]+[self.alternative(),self.finish_alternative()]
        self.wire(status=422);row=self.finish(self.ask('В каких акциях участвуют мои товары на Озоне, акция 777'))
        self.assertEqual(row['state'],'READY',row['error'])
    def test_identical_rejected_read_not_dispatched_again(self):
        duplicate=deepcopy(self.decisions[1]);self.decisions=self.decisions[:2]+[duplicate,self.alternative(),self.finish_alternative()]
        seen=self.wire();row=self.finish(self.ask('В каких акциях участвуют мои товары на Озоне, акция 777'))
        self.assertEqual(row['state'],'READY',row['error']);self.assertEqual(len(seen),1)
    def test_successful_data_survives_a_later_400(self):
        original_finish=self.decisions[-1];self.decisions=self.decisions[:2]+[self.alternative(),original_finish]
        self.wire(fail_operation='read.ozon.ozon_action_products');row=self.finish(self.ask())
        self.assertEqual(row['state'],'READY',row['error']);data=json.loads(row['result'])['data']['calls'];self.assertEqual(len(data),1)
        self.assertEqual(self.physical.count('read.ozon.ozon_actions_list'),1)
    def test_auth_error_is_not_a_model_parameter_repair(self):
        self.wire(status=403);row=self.finish(self.ask());self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'HTTP_403')
        self.assertEqual(self.physical.count('deepseek_read_plan'),2)
    def test_direct_read_400_never_silently_changes_method(self):
        self.wire();row=self.finish(self.direct());self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'HTTP_400')
        self.assertNotIn('deepseek_read_plan',self.physical)
    def test_revocation_after_rejection_prevents_another_model_call(self):
        self.wire(revoke=True);row=self.finish(self.ask());self.assertEqual(row['state'],'FAILED');self.assertEqual(self.physical.count('deepseek_read_plan'),2)
    def test_bad_expression_then_canonical_function(self):
        bad={'action':'finish','facts':[{'label':'Товаров в акции','expr':{'$fn':['invented_sum',{'$path':['calls',0,'data','result',0,'participating_products_count']}]}}],'coverage':'complete'}
        self.decisions=self.decisions[:2]+[bad,self.decisions[-1]];row=self.finish(self.ask());self.assertEqual(row['state'],'READY',row['error'])
        self.assertEqual(self.physical.count('read.ozon.ozon_actions_list'),1)
    def test_rejection_and_next_decision_survive_repository_restart(self):
        self.decisions=self.decisions[:2]+[self.alternative(),self.finish_alternative()]
        seen=self.wire();a=self.ask('В каких акциях участвуют мои товары на Озоне, акция 777')
        for _ in range(8):
            self.clock.advance(65);self.worker.step();row=self.repo.get('A',a['job_id']);progress=json.loads(row['progress']or'{}')
            if (progress.get('feedback')or{}).get('code')=='READ_PROVIDER_ARGUMENTS_REJECTED':break
        self.assertIsNone(progress['pending'])
        from repository import Repository
        from engine import Engine
        restarted=Repository(self.repo.path,clock=self.clock)
        self.engine=Engine(restarted,lambda tenant:self.scope,read_surface=self.reads)
        self.worker=Worker(self.engine,self.worker.transport)
        row=self.finish(a);self.assertEqual(row['state'],'READY',row['error']);self.assertEqual(len(seen),1)
    def test_crash_cannot_commit_400_without_repair_receipt(self):
        self.wire();a=self.ask();original=self.repo.reschedule
        class SimulatedCrash(BaseException):pass
        def reschedule(jid,owner,progress=None,**kwargs):
            if progress and (progress.get('feedback')or{}).get('code')=='READ_PROVIDER_ARGUMENTS_REJECTED':
                original(jid,owner,progress,**kwargs);raise SimulatedCrash()
            return original(jid,owner,progress,**kwargs)
        with patch.object(self.repo,'reschedule',side_effect=reschedule):
            with self.assertRaises(SimulatedCrash):
                for _ in range(8):self.clock.advance(65);self.worker.step()
        row=self.repo.get('A',a['job_id']);self.assertIsNotNone(json.loads(row['progress'])['pending'])
        with self.repo.connection()as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM calls WHERE jid=? AND http=400',(a['job_id'],)).fetchone()[0],0)

class SafeFeedback(unittest.TestCase):
    def test_missing_field_from_provider_catalog_without_echoing_values(self):
        value=provider_feedback(b'{"error":"empty campaigns SECRET_BEARER"}',{'dateFrom':'private'},None,{'campaigns','access_token'})
        self.assertEqual(value['mentioned_parameters'],['campaigns'])
        self.assertIn('required',value['reason_hints'])
        self.assertNotIn('SECRET_BEARER',json.dumps(value))

    def test_provider_rejection_survives_overwritten_local_feedback(self):
        from universal_reads import planner_context
        plan={'question':'fixture','calendar_date':'2026-11-09','snapshot_slot':1,'timezone':'Europe/Moscow','stores':[]}
        receipt={'request':{'operation':'fixture','params':{'dateFrom':'2026-11-08'}},'feedback':{'code':'READ_PROVIDER_ARGUMENTS_REJECTED'}}
        progress={'calls':[],'feedback':{'code':'READ_PROVIDER_ARGUMENTS_REPEATED'},'read_rejections':[receipt]}
        self.assertEqual(planner_context(plan,progress)['provider_rejections'],[receipt])

    def test_non_string_function_name_is_rejected_not_type_error(self):
        from universal_reads import pointer_fields
        from semantics import Rejected
        for name in ({},[]):
            with self.assertRaises(Rejected):pointer_fields({'$fn':[name,{'$path':['calls',0,'data']}]})
    def test_template_shape_budget_bounds_wide_objects(self):
        value=template_shape({str(i):'private-example'for i in range(1000)})
        self.assertLessEqual(len(value['properties']),255);self.assertTrue(value['properties_truncated'])
        self.assertNotIn('private-example',json.dumps(value))

    def test_missing_parameter_name_can_come_from_schema(self):
        value=provider_feedback(b'{"message":"required skus"}',{'dateFrom':'fixture'},{'template':{'skus':[]}})
        self.assertEqual(value['mentioned_parameters'],['skus'])
    def test_provider_values_never_leak(self):
        raw=b'{"code":"SECRET_PASSWORD","message":"required dateFrom, token=PRIVATE_BEARER, email=a@example.invalid"}'
        value=provider_feedback(raw,{'dateFrom':'private-date','access_token':'PRIVATE_BEARER'});text=json.dumps(value)
        for private in ['PRIVATE_BEARER','SECRET_PASSWORD','a@example.invalid','private-date']:self.assertNotIn(private,text)
        self.assertIn('dateFrom',value['mentioned_parameters']);self.assertIn('required',value['reason_hints'])
    def test_contract_is_derived_from_executor_registry(self):
        from matrix_core import FUNCTIONS
        value=expression_contract();self.assertEqual(value['functions'],{name:info[0]for name,info in sorted(FUNCTIONS.items())if name not in FORBIDDEN_READ_FUNCTIONS})
        self.assertNotIn('get_default',value['functions']);self.assertEqual(value['functions']['sum_values'],1);self.assertEqual(value['functions']['divide_or_null'],2)

del Fixture
if __name__=='__main__':unittest.main()
