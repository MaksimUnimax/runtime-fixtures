"""Business calculations use typed measures; capability fallback keeps one job."""
import json,unittest
from test_read_surface import Universal as Fixture
from model_recovery import compiler_declines

class TypedFirst(unittest.TestCase):
    setUp=Fixture.setUp;tearDown=Fixture.tearDown;ask=Fixture.ask
    def compiler(self,payload):
        original=self.transport;outer=self
        class Transport:
            def prepare(self,*args):return None
            def execute(self,request,store=None):
                if request.operation=='deepseek_parse':
                    outer.physical.append(request.operation)
                    raw=payload if type(payload)is str else json.dumps(payload)
                    return {'content':raw,'finish_reason':'stop'},{'status':200,'elapsed_ms':1,'bytes':100}
                return original.execute(request,store)
        from engine import Worker
        self.worker=Worker(self.engine,Transport())
    def step(self):self.clock.advance(65);self.worker.step()
    def test_ad_cost_per_ordered_unit_uses_typed_source_measures(self):
        self.compiler({'expressions':[{'op':'divide','args':[{'metric':'ad_spend'},{'metric':'ordered_units'}]}],'fully_understood':True,'unsupported':False})
        accepted=self.ask('Сколько рублей рекламных расходов приходится на одну заказанную единицу за вчера на Озоне')
        self.assertIsNone(self.repo.get('A',accepted['job_id'])['plan'])
        self.step();row=self.repo.get('A',accepted['job_id']);plan=json.loads(row['plan'])
        self.assertNotIn('universal_read',plan)
        self.assertEqual(plan['program']['required']['current'],['ad_spend','ordered_units'])
        self.assertEqual(self.physical,['deepseek_parse'])
    def test_unknown_measure_handoff_preserves_request_replay_and_counter(self):
        self.compiler({'expressions':[],'fully_understood':True,'unsupported':True})
        q='Какова стоимость клика за вчера на Озоне';accepted=self.ask(q);self.clock.advance(301);self.step()
        row=self.repo.get('A',accepted['job_id']);plan=json.loads(row['plan'])
        self.assertIn('universal_read',plan);self.assertEqual(row['id'],accepted['job_id'])
        self.assertEqual(plan['snapshot_slot'],int(row['created']//300))
        self.assertEqual(plan['request_contract']['period'],json.loads(row['draft'])['period'])
        from universal_reads import planner_context
        self.assertEqual(planner_context(plan,{'calls':[]})['request_contract'],plan['request_contract'])
        self.assertEqual(plan['question'],q.lower())
        repeated=self.ask(q);self.assertEqual(repeated,accepted)
        self.assertEqual(self.physical,['deepseek_parse'])
        with self.repo.connection()as connection:
            self.assertEqual(connection.execute('SELECT COUNT(*) FROM model_usage_requests').fetchone()[0],1)
    def test_malformed_model_response_is_repaired_without_capability_handoff(self):
        self.compiler('{');accepted=self.ask('Какова стоимость клика за вчера на Озоне');self.step()
        row=self.repo.get('A',accepted['job_id']);self.assertIsNone(row['plan'])
        self.assertIn('compiler_feedback',json.loads(row['progress']))
    def test_partial_unsupported_program_is_not_silently_handed_off(self):
        value={'expressions':[{'metric':'ordered_units'}],'fully_understood':False,'unsupported':True}
        self.assertFalse(compiler_declines({'content':json.dumps(value),'finish_reason':'stop'}))

    def test_ambiguous_question_is_not_a_capability_handoff(self):
        value={'expressions':[],'fully_understood':False,'unsupported':True}
        self.assertFalse(compiler_declines({'content':json.dumps(value),'finish_reason':'stop'}))

    def test_explicit_rubles_require_rub_source_currency(self):
        from dataclasses import replace
        self.scope=replace(self.scope,stores=tuple(replace(store,currency='USD')for store in self.scope.stores))
        answer=self.ask('Сколько рублей рекламных расходов приходится на одну заказанную единицу за вчера на Озоне')
        self.assertEqual(answer['error'],'CURRENCY_UNCONFIRMED');self.assertEqual(self.physical,[])

    def test_currency_conversion_does_not_fall_through_to_universal(self):
        answer=self.ask('Сумма заказов в долларах за вчера на Озоне')
        self.assertEqual(answer['error'],'OPERATION_NOT_ENABLED');self.assertEqual(self.physical,[])
        self.assertNotIn('job_id',answer)

    def test_unrelated_denied_orders_do_not_block_click_capability_handoff(self):
        import providers
        from semantics import parse,make_plan
        from datetime import date
        orders=make_plan(self.scope,parse('Сводка заказов за вчера на Озоне',date(2026,11,8)),['ordered_units'])
        for store in orders['stores']:
            for source in providers.sources(orders,store):self.repo.deny(source,store['access_revision'])
        self.compiler({'expressions':[],'fully_understood':True,'unsupported':True})
        accepted=self.ask('Какова стоимость клика за вчера на Озоне');self.step()
        row=self.repo.get('A',accepted['job_id']);self.assertIn('universal_read',json.loads(row['plan']))
        self.assertEqual(self.physical,['deepseek_parse'])

    def test_scope_revocation_before_compilation_prevents_model_io(self):
        from dataclasses import replace
        accepted=self.ask('Какова стоимость клика за вчера на Озоне')
        self.scope=replace(self.scope,revision='revoked');self.step()
        row=self.repo.get('A',accepted['job_id']);self.assertEqual(row['state'],'FAILED')
        self.assertEqual(row['error'],'SOURCE_ACCESS');self.assertEqual(self.physical,[])

del Fixture
if __name__=='__main__':unittest.main()
