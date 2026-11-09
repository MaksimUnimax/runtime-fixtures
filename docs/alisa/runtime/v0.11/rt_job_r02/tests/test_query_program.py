"""Generic compiler acceptance: no speech template required, no external network."""
import copy,json,tempfile,unittest,hashlib
from pathlib import Path
from decimal import Decimal
from dataclasses import replace
from unittest.mock import patch
from test_runtime import TODAY,SCOPE,OZ,WB,Clock
from test_finance_stock import FinancialTransport
from semantics import parse,Rejected,fingerprint,strict_json,Scope
from semantic_catalog import EXPRESSION_CATALOG,SPEECH_CATALOG,validate_catalog,validate_speech,CatalogError,hash_value
from query_program import (compile_program,make_composed_plan,evaluate,validate_compiled,
                           validate_model_program,program_for_metrics,validate_catalog_typed,LANGUAGE)
from engine import Engine,Worker,CallError
from repository import Repository
import providers

def metric(name,role='current'):return {'metric':name,'period':role}
def op(name,*args):return {'op':name,'args':list(args)}
def draft(compare=False):return parse(('сравни сумму заказов за октябрь и сентябрь' if compare else 'сумма заказов за октябрь')+' на озоне',TODAY)
def costs(role='current'):return op('add',metric('finance_storage_cost',role),metric('finance_logistics_cost',role),metric('finance_acquiring_cost',role))
def share(role='current'):return op('percent',costs(role),metric('finance_sales',role))
QUESTION='Какой процент финансовых продаж составили хранение, логистика и эквайринг за октябрь 2026 на Озоне?'

class CompilerTests(unittest.TestCase):
    def rejected(self,code,fn):
        with self.assertRaises(Rejected) as e:fn()
        self.assertEqual(e.exception.code,code)
    def test_untemplated_formula_is_p2(self):self.assertEqual(parse(QUESTION,TODAY)['route'],'P2')
    def test_nested_template_matches_explicit_tree(self):
        d=draft();a=op('percent',op('add',metric('finance_storage_cost'),metric('finance_logistics_cost')),metric('finance_sales'))
        self.assertEqual(compile_program([a],d),compile_program([{'template':'finance_storage_logistics_share'}],d))
    def test_drr_metric_equals_raw_expression(self):
        self.assertEqual(compile_program([metric('drr_ordered')],draft()),compile_program([op('percent',metric('ad_spend'),metric('ordered_revenue'))],draft()))
    def test_multiple_formulas_have_one_shared_leaf(self):
        p=compile_program([metric('drr_ordered'),metric('ad_spend'),metric('average_ordered_item_price'),metric('ordered_revenue')],draft())
        self.assertEqual(p['required']['current'],['ad_spend','ordered_revenue','ordered_units'])
        self.assertEqual(sum(n.get('metric')=='ordered_revenue' for n in p['nodes']),1)
    def test_add_commutative_canonical(self):
        self.assertEqual(compile_program([costs()],draft()),compile_program([op('add',*list(reversed(costs()['args'])))],draft()))
    def test_subtract_order_changes_identity(self):
        a,b=metric('finance_storage_cost'),metric('finance_logistics_cost')
        self.assertNotEqual(compile_program([op('subtract',a,b)],draft()),compile_program([op('subtract',b,a)],draft()))
    def test_duplicate_output_deduplicated(self):
        self.assertEqual(compile_program([share()],draft()),compile_program([share(),share()],draft()))
    def test_unknown_metric(self):self.rejected('UNKNOWN_METRIC',lambda:compile_program([metric('made_up')],draft()))
    def test_unknown_operator(self):self.rejected('UNKNOWN_OPERATOR',lambda:compile_program([op('eval',metric('ordered_units'))],draft()))
    def test_endpoint_in_node_rejected(self):
        self.rejected('EXPRESSION_REFERENCE',lambda:compile_program([{'metric':'ad_spend','url':'https://other.invalid'}],draft()))
    def test_no_free_constants(self):self.rejected('UNKNOWN_OPERATOR',lambda:compile_program([{'constant':999}],draft()))
    def test_operator_arity(self):self.rejected('OPERATOR_ARITY',lambda:compile_program([op('divide',metric('ad_spend'))],draft()))
    def test_missing_previous_period(self):self.rejected('PERIOD_NOT_PROVIDED',lambda:compile_program([metric('ad_spend','previous')],draft()))
    def test_invalid_period_role(self):self.rejected('PERIOD_REFERENCE',lambda:compile_program([metric('ad_spend','future')],draft()))
    def test_money_plus_units(self):self.rejected('UNIT_MISMATCH',lambda:compile_program([op('add',metric('ordered_units'),metric('ordered_revenue'))],draft()))
    def test_views_plus_cart_wrong_quantity(self):self.rejected('UNIT_MISMATCH',lambda:compile_program([op('add',metric('card_views'),metric('cart_additions'))],draft()))
    def test_percent_wrong_units(self):self.rejected('PERCENT_UNIT_MISMATCH',lambda:compile_program([op('percent',metric('ad_spend'),metric('ordered_units'))],draft()))
    def test_cross_basis_add(self):self.rejected('TIME_BASIS_MISMATCH',lambda:compile_program([op('add',metric('ordered_revenue'),metric('finance_sales'))],draft()))
    def test_snapshot_plus_flow(self):self.rejected('MIXED_TIME_AXES',lambda:compile_program([op('divide',metric('stock_fbo_units'),metric('ordered_units'))],draft()))
    def test_snapshot_per_day(self):self.rejected('PER_DAY_TIME_BASIS',lambda:compile_program([op('per_day',metric('stock_fbo_units'))],draft()))
    def test_duplicate_additive_component(self):self.rejected('DUPLICATE_ADDITIVE_COMPONENT',lambda:compile_program([op('add',metric('ad_spend'),metric('ad_spend'))],draft()))
    def test_services_plus_component_overlap(self):self.rejected('OVERLAPPING_COST_COMPONENTS',lambda:compile_program([op('add',metric('finance_services_cost'),metric('finance_storage_cost'))],draft()))
    def test_orders_plus_buyouts_overlap(self):self.rejected('OVERLAPPING_ORDER_COMPONENTS',lambda:compile_program([op('add',metric('ordered_units'),metric('buyout_units_cohort'))],draft()))
    def test_cross_period_ratio(self):self.rejected('RATIO_PERIOD_MISMATCH',lambda:compile_program([op('percent',metric('ad_spend'),metric('ordered_revenue','previous'))],draft(True)))
    def test_cross_period_different_expression(self):self.rejected('INCOMPARABLE_PERIOD_EXPRESSIONS',lambda:compile_program([op('subtract',metric('finance_sales'),metric('finance_storage_cost','previous'))],draft(True)))
    def test_nested_formula_delta_is_allowed(self):
        p=compile_program([op('subtract',share(),share('previous'))],draft(True));self.assertEqual(p['outputs'][0]['style'],'percentage_points')
    def test_relative_change_nested_formula(self):
        p=compile_program([op('relative_change',share(),share('previous'))],draft(True));self.assertEqual(p['outputs'][0]['style'],'percent')
    def test_different_rate_bases_rejected(self):
        self.rejected('RATE_BASIS_MISMATCH',lambda:compile_program([op('add',metric('cart_to_order_rate'),metric('view_to_cart_rate'))],draft()))
    def test_maximum(self):
        p=compile_program([op('maximum',metric('finance_storage_cost'),metric('finance_logistics_cost'))],draft())
        r=evaluate(p,{'current':{'finance_storage_cost':'45','finance_logistics_cost':'18'}},{'current':draft()['period']})
        self.assertEqual(r[p['outputs'][0]['node']],Decimal(45))
    def test_zero_propagates_as_undefined(self):
        p=compile_program([op('per_day',op('divide',metric('ordered_revenue'),metric('ordered_units')))],draft())
        r=evaluate(p,{'current':{'ordered_revenue':'100','ordered_units':'0'}},{'current':draft()['period']})
        self.assertIsNone(r[p['outputs'][0]['node']])
    def test_signed_corrections_not_abs(self):
        p=compile_program([costs()],draft());r=evaluate(p,{'current':{'finance_storage_cost':'-5','finance_logistics_cost':'2','finance_acquiring_cost':'1'}},{'current':draft()['period']})
        self.assertEqual(r[p['outputs'][0]['node']],Decimal(-2))
    def test_nested_calculation_independent_oracle(self):
        p=compile_program([share()],draft());r=evaluate(p,{'current':{'finance_storage_cost':'45','finance_logistics_cost':'18','finance_acquiring_cost':'10','finance_sales':'1000'}},{'current':draft()['period']})
        self.assertEqual(r[p['outputs'][0]['node']],Decimal('7.3'))
    def test_graph_depth_bounded(self):
        a=metric('ordered_units')
        for _ in range(20):a=op('per_day',a)
        self.rejected('GRAPH_LIMIT',lambda:compile_program([a],draft()))
    def test_output_count_bounded(self):self.rejected('OUTPUT_LIMIT',lambda:compile_program([metric('ordered_units')]*65,draft()))
    def test_unsupported_filter_applies_to_whole_expression(self):
        d=parse('сумма заказов за октябрь на wb по артикулу wb 123',TODAY)
        self.rejected('ADS_FILTER_NOT_SUPPORTED',lambda:make_composed_plan(SCOPE,d,expressions=[op('percent',metric('ad_spend'),metric('ordered_revenue'))]))
    def test_currency_required_for_unregistered_ratio(self):
        scope=replace(SCOPE,stores=(replace(OZ,currency=None),WB))
        self.rejected('CURRENCY_UNCONFIRMED',lambda:make_composed_plan(scope,draft(),expressions=[share()]))
    def test_tampered_dag_not_authorized(self):
        p=make_composed_plan(SCOPE,draft(),expressions=[share()]);p['program']['nodes'][-1]['op']='eval'
        self.assertFalse(validate_compiled(p))
    def test_tampered_label_not_authorized(self):
        p=make_composed_plan(SCOPE,draft(),expressions=[share()]);p['program']['outputs'][0]['label']='чистая прибыль'
        self.assertFalse(validate_compiled(p))
    def test_speech_not_in_canonical_financial_key(self):
        p=make_composed_plan(SCOPE,draft(),expressions=[share()]);self.assertNotIn('phrases',json.dumps(p))
    def test_catalog_cache_is_not_mutable_shared_object(self):
        p=compile_program([share()],draft());p['nodes'][0]['metric']='secret'
        self.assertNotEqual(p,compile_program([share()],draft()))
    def test_new_formula_only_data_change(self):
        c=copy.deepcopy(EXPRESSION_CATALOG);c['version']='future'
        c['formulas']['new_sum']={'label':'новая сумма','expr':costs()}
        c['formulas']['new_share']={'label':'новая доля','expr':op('percent',{'template':'new_sum'},metric('finance_sales'))}
        p=compile_program([{'template':'new_share'}],draft(),c)
        self.assertEqual(p,compile_program([share()],draft(),c))
        self.assertEqual(p['required']['current'],['finance_acquiring_cost','finance_logistics_cost','finance_sales','finance_storage_cost'])
    def test_catalog_edit_changes_key(self):
        a=copy.deepcopy(EXPRESSION_CATALOG);b=copy.deepcopy(a)
        b['version']='changed';b['formulas']['finance_storage_logistics']['expr']=op('subtract',metric('finance_storage_cost'),metric('finance_logistics_cost'))
        self.assertNotEqual(compile_program([{'template':'finance_storage_logistics_share'}],draft(),a),compile_program([{'template':'finance_storage_logistics_share'}],draft(),b))
    def test_invalid_formula_types_rejected_at_activation(self):
        c=copy.deepcopy(EXPRESSION_CATALOG);c['formulas']['bad']={'label':'bad','expr':op('add',metric('ordered_units'),metric('ad_spend'))}
        self.rejected('UNIT_MISMATCH',lambda:validate_catalog_typed(c))
    def test_cycle_rejected(self):
        c=copy.deepcopy(EXPRESSION_CATALOG);c['formulas']['loop']={'label':'loop','expr':{'template':'loop'}}
        with self.assertRaises(CatalogError):validate_catalog(c)
    def test_missing_reference_rejected(self):
        c=copy.deepcopy(EXPRESSION_CATALOG);c['formulas']['bad']={'label':'bad','expr':{'template':'nonexistent'}}
        with self.assertRaises(CatalogError):validate_catalog(c)
    def test_atomic_override_rejected(self):
        c=copy.deepcopy(EXPRESSION_CATALOG);c['formulas']['ad_spend']={'label':'bad','expr':metric('ordered_units')}
        with self.assertRaises(CatalogError):validate_catalog(c)
    def test_extra_catalog_url_rejected(self):
        c=copy.deepcopy(EXPRESSION_CATALOG);c['url']='bad'
        with self.assertRaises(CatalogError):validate_catalog(c)
    def test_speech_alias_just_data(self):
        s=copy.deepcopy(SPEECH_CATALOG);s['phrases']['finance_storage_logistics_share'].append('новый синоним')
        self.assertEqual(validate_speech(s,EXPRESSION_CATALOG),s)
    def test_conflicting_alias_rejected(self):
        s=copy.deepcopy(SPEECH_CATALOG);s['phrases']['ad_spend'].append('сумма заказов')
        with self.assertRaises(CatalogError):validate_speech(s,EXPRESSION_CATALOG)
    def test_freeform_comparison_scope(self):
        d=parse('Насколько изменился ДРР в октябре 2026 относительно сентября 2026 на Озоне?',TODAY)
        self.assertEqual(d['route'],'P2');self.assertEqual(d['comparison']['from'],'2026-09-01')
    def test_single_period_difference_not_forced_comparison(self):
        d=parse('Разница между хранением и логистикой за октябрь на озоне',TODAY)
        self.assertIsNone(d['comparison']);self.assertEqual(d['route'],'P2')

class ModelContractTests(unittest.TestCase):
    def validate(self,obj,reason='stop'):return validate_model_program(json.dumps(obj),reason,draft())
    def envelope(self):return {'expressions':[share()],'fully_understood':True,'unsupported':False}
    def test_complete_nested_model_ast(self):self.assertEqual(self.validate(self.envelope()),[share()])
    def test_model_no_custom_output_labels(self):
        d=self.envelope();d['label']='profit'
        with self.assertRaises(Rejected):self.validate(d)
    def test_old_metrics_envelope_not_accepted_on_new_route(self):
        with self.assertRaises(Rejected):self.validate({'metrics':['ad_spend'],'fully_understood':True,'unsupported':False})
    def test_boolean_not_numeric(self):
        d=self.envelope();d['fully_understood']=1
        with self.assertRaises(Rejected):self.validate(d)
    def test_unsupported_constraint_not_discarded(self):
        d=self.envelope();d['unsupported']=True
        with self.assertRaises(Rejected):self.validate(d)
    def test_truncation_even_valid_json(self):
        with self.assertRaises(Rejected):self.validate(self.envelope(),'length')
    def test_empty_content_even_stop(self):
        with self.assertRaises(Rejected):validate_model_program('   ','stop',draft())
    def test_model_unknown_api_metric(self):
        d=self.envelope();d['expressions']=[metric('http_get')]
        with self.assertRaises(Rejected):self.validate(d)
    def test_duplicate_json_key(self):
        with self.assertRaises(Rejected):validate_model_program('{"expressions":[],"expressions":[],"fully_understood":true,"unsupported":false}','stop',draft())

class ProgramTransport(FinancialTransport):
    def __init__(self):super().__init__();self.ast=[share()]
    def execute(self,r,s):
        if r.operation=='deepseek_parse':
            self.calls.append(r)
            return {'content':json.dumps({'expressions':self.ast,'fully_understood':True,'unsupported':False}),'finish_reason':'stop'},{'status':200,'elapsed_ms':1,'bytes':100}
        return super().execute(r,s)

class ProgramFlowTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.clock=Clock();self.scope=SCOPE
        self.repo=Repository(Path(self.temp.name)/'db',self.clock);self.engine=Engine(self.repo,lambda _:self.scope)
        self.transport=ProgramTransport();self.worker=Worker(self.engine,self.transport);self.seq=0
    def tearDown(self):self.temp.cleanup()
    def send(self,q):
        self.seq+=1;return self.engine.submit('A',q,'generic-'+str(self.seq),fingerprint(q),TODAY)
    def finish(self,item):
        for _ in range(20):
            row=self.repo.get('A',item['job_id'])
            if row['state'] not in ('QUEUED','RUNNING'):return row
            self.worker.step();self.clock.advance(62)
        self.fail('unfinished')
    def test_no_phrase_template_end_to_end(self):
        row=self.finish(self.send(QUESTION));self.assertEqual(row['state'],'READY',row['error'])
        self.assertEqual([x.operation for x in self.transport.calls],['deepseek_parse','ozon_finance'])
        self.assertIn('7.3 процентов',' '.join(strict_json(row['result'])['pages']))
    def test_compound_and_raw_leaves_share_one_source(self):
        self.transport.ast=[share(),costs(),metric('finance_sales'),metric('finance_storage_cost')]
        row=self.finish(self.send(QUESTION));self.assertEqual(row['state'],'READY')
        self.assertEqual(sum(x.operation=='ozon_finance' for x in self.transport.calls),1)
    def test_p1_new_declarative_formula_no_llm(self):
        row=self.finish(self.send('доля хранения и логистики в финансовых продажах за октябрь на озоне'))
        self.assertEqual(row['state'],'READY');self.assertEqual([x.operation for x in self.transport.calls],['ozon_finance'])
        self.assertIn('6.3 процентов',' '.join(strict_json(row['result'])['pages']))
    def test_model_explicit_drr_joins_p1_same_canonical(self):
        self.transport.ast=[op('percent',metric('ad_spend'),metric('ordered_revenue'))]
        first=self.finish(self.send('дрр за октябрь на озоне'));count=self.repo.call_count()
        second=self.finish(self.send('Какова доля рекламных трат от заказанной суммы за октябрь на озоне'))
        self.assertEqual(first['id'],second['id']);self.assertEqual(self.repo.call_count(),count+1)
    def test_source_scope_frozen_before_model(self):
        item=self.send(QUESTION);self.scope=replace(self.scope,stores=self.scope.stores+(replace(OZ,id='new',identity='newcab'),))
        row=self.finish(item);self.assertEqual(len(strict_json(row['plan'])['stores']),1)
    def test_new_template_catalog_does_not_reinterpret_pending(self):
        self.transport.ast=[{'template':'finance_storage_logistics_share'}];item=self.send(QUESTION)
        changed=copy.deepcopy(EXPRESSION_CATALOG);changed['version']='after-admission'
        changed['formulas']['finance_storage_logistics']['expr']=op('subtract',metric('finance_storage_cost'),metric('finance_logistics_cost'))
        self.engine=Engine(self.repo,lambda _:self.scope,catalog=changed);self.worker=Worker(self.engine,self.transport)
        row=self.finish(item);self.assertIn('6.3 процентов',' '.join(strict_json(row['result'])['pages']))
        self.assertEqual(strict_json(row['plan'])['program']['catalog_hash'],hash_value(EXPRESSION_CATALOG))
    def test_ready_pin_still_readable_after_catalog_only_update(self):
        row=self.finish(self.send(QUESTION));changed=copy.deepcopy(EXPRESSION_CATALOG);changed['version']='new'
        other=Engine(self.repo,lambda _:self.scope,catalog=changed)
        self.assertTrue(other.authorized(strict_json(row['plan'])));self.assertIn('7.3',other.control('A','результат')['text'])
    def test_changed_formula_creates_new_exact_job(self):
        first=self.finish(self.send('доля хранения и логистики в финансовых продажах за октябрь на озоне'))
        changed=copy.deepcopy(EXPRESSION_CATALOG);changed['version']='changed'
        changed['formulas']['finance_storage_logistics']['expr']=op('subtract',metric('finance_storage_cost'),metric('finance_logistics_cost'))
        self.engine=Engine(self.repo,lambda _:self.scope,catalog=changed);second=self.send('доля хранения и логистики в финансовых продажах за октябрь на озоне')
        self.assertEqual(second['cache'],'NEW');self.assertNotEqual(first['id'],second['job_id'])
    def test_no_marketplace_call_for_wrong_model_unit(self):
        self.transport.ast=[op('add',metric('ordered_units'),metric('ordered_revenue'))]
        row=self.finish(self.send(QUESTION));self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'READ_NO_PROGRESS');self.assertEqual(json.loads(row['progress'])['compiler_feedback']['code'],'UNIT_MISMATCH')
        self.assertEqual([r.operation for r in self.transport.calls],['deepseek_parse']*3)
    def test_no_secret_sent_to_model(self):
        self.finish(self.send(QUESTION));body=self.transport.calls[0].body
        self.assertEqual(set(body),{'question','catalog','slots'})
        for forbidden in ('tenant','cabinet-oz-1','access_token','seller_api_key','1000'):
            self.assertNotIn(forbidden,json.dumps(body))
    def test_week_not_synthesized_from_month(self):
        first=self.finish(self.send(QUESTION));second=self.send(QUESTION.replace('за октябрь 2026','с 1 по 7 октября 2026'))
        self.assertNotEqual(first['id'],second['job_id']);self.assertEqual(second['cache'],'NEW')
    def test_operators_do_not_execute_python(self):
        self.transport.ast=[{'op':'__import__','args':[{'metric':'ad_spend'}]}]
        row=self.finish(self.send(QUESTION));self.assertEqual(row['state'],'FAILED');self.assertEqual(self.repo.call_count(),3);self.assertTrue(all(r.operation=='deepseek_parse' for r in self.transport.calls))
    def test_partial_sources_no_speech(self):
        self.transport.ast=[op('percent',metric('ad_spend'),metric('ordered_revenue'))]
        i=self.send(QUESTION);self.worker.step();self.clock.advance(62);self.worker.step()
        self.assertEqual(self.repo.get('A',i['job_id'])['state'],'QUEUED')
        self.assertNotIn('процентов',self.engine.control('A','результат')['text'])
    def test_period_roles_only_fetch_required(self):
        d=draft(True);p=make_composed_plan(self.scope,d,expressions=[metric('ordered_units'),metric('ad_spend','previous')])
        ts=providers.tasks(p,p['stores'][0]);self.assertEqual(len(ts),2)
        self.assertEqual([(t['recipe'],t['role'],t['metrics']) for t in ts],[('ozon','current',['ordered_units']),('ozon_ads_daily','previous',['ad_spend'])])
    def test_shared_formula_ratio_aggregate_raw_operands(self):
        d=parse('дрр за октябрь на озоне и wb всего',TODAY)
        p=make_composed_plan(self.scope,d,expressions=[op('percent',metric('ad_spend'),metric('ordered_revenue'))])
        data=[{'store_id':'oz1','complete':True,'currency':'RUB','values':{'ad_spend':'10','ordered_revenue':'100'}},{'store_id':'wb1','complete':True,'currency':'RUB','values':{'ad_spend':'180','ordered_revenue':'900'}}]
        report=providers.render(p,data,'2026-11-03 09:00 UTC')
        self.assertIn('19 процентов',' '.join(report['pages']))
    def test_plain_results_use_same_compiler(self):
        item=self.send('сводка заказов за октябрь на озоне');p=strict_json(self.repo.get('A',item['job_id'])['plan'])
        self.assertEqual(p['program']['language'],LANGUAGE)
    def test_replay_does_not_run_llm_again(self):
        row=self.finish(self.send(QUESTION));n=self.repo.call_count()
        for _ in range(4):self.send('результат')
        self.assertEqual(self.repo.call_count(),n)


class CatalogueLifecycleTests(unittest.TestCase):
    def test_exact_completed_p2_reuses_plan_without_model_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            clock=Clock();repo=Repository(Path(tmp)/'db',clock);e=Engine(repo,lambda _:SCOPE)
            t=FinancialTransport();w=Worker(e,t)
            q='Пожалуйста сообщи сумму заказанных товаров за октябрь 2026 на Озоне'
            self.assertEqual(parse(q,TODAY)['route'],'P2')
            a=e.submit('A',q,'a',fingerprint(q),TODAY)
            for _ in range(6):w.step();clock.advance(62)
            self.assertEqual(repo.get('A',a['job_id'])['state'],'READY')
            before=len(t.calls);b=e.submit('A',q,'b',fingerprint(q),TODAY)
            self.assertEqual(b['job_id'],a['job_id']);self.assertEqual(b['cache'],'HIT')
            w.step();self.assertEqual(len(t.calls),before)

    def test_expired_p2_exact_job_does_not_reuse_stale_report(self):
        with tempfile.TemporaryDirectory() as tmp:
            clock=Clock();repo=Repository(Path(tmp)/'db',clock);e=Engine(repo,lambda _:SCOPE);t=FinancialTransport();w=Worker(e,t)
            q='Пожалуйста сообщи сумму заказанных товаров за октябрь 2026 на Озоне'
            a=e.submit('A',q,'a',fingerprint(q),TODAY)
            for _ in range(6):w.step();clock.advance(62)
            clock.advance(901);b=e.submit('A',q,'b',fingerprint(q),TODAY)
            self.assertNotEqual(a['job_id'],b['job_id']);self.assertEqual(b['cache'],'NEW')

    def test_model_budget_is_configured_not_returned_by_llm(self):
        from engine import validate_model_budget
        self.assertIsNone(validate_model_budget({'schema':'alice-model-budget/v2','daily_calls':None,'min_interval_seconds':0})['daily_calls'])
        for n in (0,-1,True,20,100,101,'20'):
            with self.assertRaises(Rejected):validate_model_budget({'schema':'alice-model-budget/v2','daily_calls':n,'min_interval_seconds':0})
        with self.assertRaises(Rejected):validate_model_budget({'schema':'alice-model-budget/v2','daily_calls':None,'min_interval_seconds':2})

    def test_pending_p2_pins_language_projection_and_source_registry(self):
        from registry import REGISTRY_HASH
        from query_program import PROJECTION
        with tempfile.TemporaryDirectory() as tmp:
            repo=Repository(Path(tmp)/'db',Clock());e=Engine(repo,lambda _:SCOPE)
            item=e.submit('A',QUESTION,'x',fingerprint(QUESTION),TODAY)
            saved=strict_json(repo.get('A',item['job_id'])['draft'])
            self.assertEqual(saved['compiler_pin'],{'language':LANGUAGE,'projection':PROJECTION,'registry_hash':REGISTRY_HASH})

    def test_pending_source_registry_change_rejected_before_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo=Repository(Path(tmp)/'db',Clock());e=Engine(repo,lambda _:SCOPE)
            item=e.submit('A',QUESTION,'x',fingerprint(QUESTION),TODAY)
            t=FinancialTransport()
            with patch('engine.REGISTRY_HASH','different'):Worker(e,t).step()
            row=repo.get('A',item['job_id'])
            self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'PENDING_PLAN_VERSION_CHANGED')
            self.assertEqual(t.calls,[])

    def test_projection_change_has_new_p2_admission_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo=Repository(Path(tmp)/'db',Clock());e=Engine(repo,lambda _:SCOPE)
            a=e.submit('A',QUESTION,'x',fingerprint(QUESTION),TODAY)
            with patch('engine.PROJECTION','new-projection'):
                b=e.submit('A',QUESTION,'y',fingerprint(QUESTION),TODAY)
            self.assertNotEqual(a['job_id'],b['job_id'])

    def test_voice_projection_is_part_of_exact_identity(self):
        p=make_composed_plan(SCOPE,draft(),expressions=[metric('ordered_units')])
        self.assertEqual(p['projection'],'composed-voice-v3-sales-basis')
        old=copy.deepcopy(p);old.pop('projection')
        self.assertNotEqual(fingerprint(p),fingerprint(old))

    def test_comparison_only_root_still_displays_both_operands(self):
        d=draft(True);scope=Scope(SCOPE.tenant,SCOPE.revision,(SCOPE.stores[0],))
        e=op('subtract',metric('ordered_revenue'),metric('ordered_revenue','previous'))
        p=make_composed_plan(scope,d,expressions=[e])
        data=[{'store_id':scope.stores[0].id,'complete':True,'currency':'RUB','rows':2,'values':{'ordered_revenue':'100'},'previous_values':{'ordered_revenue':'50'}}]
        report=providers.render(p,data,'synthetic')
        text=' '.join(report['pages']);self.assertIn('100 RUB',text);self.assertIn('ранее 50 RUB',text);self.assertIn('изменение +50 RUB',text)

    def test_relative_comparison_displays_context(self):
        d=draft(True);scope=Scope(SCOPE.tenant,SCOPE.revision,(SCOPE.stores[0],))
        e=op('relative_change',metric('ordered_revenue'),metric('ordered_revenue','previous'))
        p=make_composed_plan(scope,d,expressions=[e])
        data=[{'store_id':scope.stores[0].id,'complete':True,'currency':'RUB','rows':2,'values':{'ordered_revenue':'100'},'previous_values':{'ordered_revenue':'50'}}]
        text=' '.join(providers.render(p,data,'synthetic')['pages'])
        self.assertIn('ранее 50 RUB',text);self.assertIn('относительное изменение +100 процентов',text)

    def test_p2_receives_full_comparison_question(self):
        q='Сравни долю хранения и логистики в финансовых продажах за октябрь и сентябрь 2026 на Озоне'
        with tempfile.TemporaryDirectory() as tmp:
            repo=Repository(Path(tmp)/'db',Clock());engine=Engine(repo,lambda _:SCOPE)
            class Capture:
                def execute(self,request,store):
                    self.body=request.body
                    return {'content':json.dumps({'expressions':[metric('ordered_units')],'fully_understood':True,'unsupported':False}),'finish_reason':'stop'},{'status':200,'elapsed_ms':0}
            t=Capture();engine.submit('A',q,'q',fingerprint(q),TODAY);Worker(engine,t).step()
            self.assertEqual(t.body['question'],parse(q,TODAY)['question'])
            self.assertTrue(t.body['question'].startswith('сравни'))
            self.assertIn('сентябрь',t.body['question'])
            self.assertEqual(t.body['slots']['comparison']['from'],'2026-09-01')

    def test_real_catalogue_edit_without_python_change(self):
        import subprocess,sys,shutil
        root=Path(__file__).resolve().parent.parent
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)
            files=list(root.glob('*.py'))+list(root.glob('*catalog.json'))+[root/'registry.json',root/'resource_limits.json']
            for source in files:shutil.copy2(source,target/source.name)
            before={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in target.glob('*.py')}
            cat=json.loads((target/'expression_catalog.json').read_text())
            cat['version']='extension-proof'
            cat['formulas']['three_costs']={'label':'три затраты','expr':costs()}
            cat['formulas']['three_cost_share']={'label':'доля трёх затрат','expr':op('percent',{'template':'three_costs'},metric('finance_sales'))}
            (target/'expression_catalog.json').write_text(json.dumps(cat,ensure_ascii=False))
            speech=json.loads((target/'speech_catalog.json').read_text())
            speech['phrases']['three_cost_share']=['доля трех затрат'];speech['version']='extension-proof'
            (target/'speech_catalog.json').write_text(json.dumps(speech,ensure_ascii=False))
            script="""import json,socket
from unittest.mock import patch
with patch.object(socket.socket,'connect',side_effect=AssertionError('no network')),patch.object(socket,'getaddrinfo',side_effect=AssertionError('no DNS')):
 from datetime import date
 from semantics import parse,Scope,Store
 from query_program import make_composed_plan
 d=parse('доля трех затрат за октябрь 2026 на озоне',date(2026,11,3))
 p=make_composed_plan(Scope('synthetic','rev',(Store('s','ozon','synthetic','a','b','RUB'),)),d,metrics=d['metrics'])
 print(json.dumps({'route':d['route'],'leaves':p['metrics'],'catalog':p['program']['catalog_pin']['version']}))
"""
            run=subprocess.run([sys.executable,'-B','-c',script],cwd=target,capture_output=True,text=True,timeout=20)
            self.assertEqual(run.returncode,0,run.stderr)
            result=json.loads(run.stdout)
            self.assertEqual(result['route'],'P1');self.assertEqual(result['catalog'],'extension-proof')
            self.assertEqual(result['leaves'],['finance_acquiring_cost','finance_logistics_cost','finance_sales','finance_storage_cost'])
            after={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in target.glob('*.py')}
            self.assertEqual(before,after)

    def test_nested_duplicate_addition_not_double_counted(self):
        e=op('add',op('add',metric('finance_storage_cost'),metric('finance_logistics_cost')),metric('finance_storage_cost'))
        with self.assertRaises(Rejected) as c:compile_program([e],draft())
        self.assertEqual(c.exception.code,'OVERLAPPING_ADDITIVE_COMPONENTS')

    def test_long_nested_description_is_not_code_or_unbounded_speech(self):
        e=share()
        for _ in range(7):e=op('divide',e,op('divide',metric('finance_storage_cost'),metric('finance_logistics_cost')))
        p=compile_program([e],draft())
        from query_program import explain_program
        self.assertLess(len(explain_program(p)),700)
        self.assertTrue(all(len(o['label'])<=500 for o in p['outputs']))
        self.assertTrue(p['asts'])

    def test_speech_requires_canonical_spelling(self):
        s=copy.deepcopy(SPEECH_CATALOG);s['phrases']['ad_spend']+=[' РЕКЛАМА  ']
        with self.assertRaises(CatalogError):validate_speech(s,EXPRESSION_CATALOG)

if __name__=='__main__':unittest.main()

