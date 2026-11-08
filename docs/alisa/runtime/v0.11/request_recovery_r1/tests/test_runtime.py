from __future__ import annotations
import copy
import json
import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import date,datetime,timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from semantics import *
from repository import Repository,Deferred
from engine import Engine,Worker,CallError
from http_transport import HTTPTransport,NoRedirect
import providers

TODAY=date(2026,11,3)
OZ=Store('oz1','ozon','cabinet-oz-1','access1','recipe1','RUB')
WB=Store('wb1','wb','cabinet-wb-1','access1','recipe1','RUB')
SCOPE=Scope('A','acl1',(OZ,WB))

class Clock:
    def __init__(self):self.now=datetime(2026,11,3,9,tzinfo=timezone.utc).timestamp()
    def __call__(self):return self.now
    def advance(self,n):self.now+=n

def draft(q='сводка заказов за октябрь 2026 на озоне'):
    return parse(q,TODAY)
def plan(q='сводка заказов за октябрь 2026 на озоне',scope=SCOPE):
    d=draft(q);return make_plan(scope,d,d['metrics'] or ['ordered_units'])
def oz_response(p,units=4,revenue='123.45'):
    values={'ordered_units':units,'ordered_revenue':revenue}
    metrics=[values[m] for m in p['metrics']]
    return {'result':{'data':[{'dimensions':[{'id':p['period']['from'][:7]}],'metrics':metrics}], 'totals':metrics}}
def wb_response(p,n=2,start_id=1,currency='RUB'):
    rows=[]
    for i in range(n):
        rows.append({'product':{'nmId':start_id+i},'statistic':{'selected':{
            'period':{'start':p['period']['from'],'end':p['period']['to']},
            'orderCount':1,'orderSum':'10.25'}}})
    return {'data':{'products':rows,'currency':currency}}

class FakeTransport:
    def __init__(self):self.calls=[];self.failure=None;self.on_call=None;self.model_metrics=['ordered_units'];self.model_raw=None
    def execute(self,request,store):
        self.calls.append(request)
        if self.on_call:self.on_call(request)
        if self.failure:raise self.failure
        if request.operation=='deepseek_parse':
            raw=self.model_raw or json.dumps({'expressions':[{'metric':m} for m in self.model_metrics],'fully_understood':True,'unsupported':False})
            return {'content':raw,'finish_reason':'stop'},{'status':200,'elapsed_ms':2,'bytes':100}
        if request.operation=='ozon_orders':
            mapping={'revenue':'ordered_revenue','ordered_units':'ordered_units'}
            p={'metrics':[mapping[m] for m in request.body['metrics']],
               'period':{'from':request.body['date_from'],'to':request.body['date_to']}}
            data=oz_response(p)
        else:
            p={'period':{'from':request.body['selectedPeriod']['start'],'to':request.body['selectedPeriod']['end']}}
            data=wb_response(p)
        return data,{'status':200,'elapsed_ms':3,'bytes':200}

class SemanticTests(unittest.TestCase):
    def test_month_and_explicit_interval_canonical_equal(self):
        self.assertEqual(plan('сумма заказов за октябрь 2026 на озоне'),plan('сумма заказов с 1 по 31 октября 2026 на озоне'))
    def test_current_explicit_month_is_to_date(self):
        self.assertEqual(draft('сумма заказов за ноябрь 2026 на озоне')['period'],{'from':'2026-11-01','to':'2026-11-03'})
    def test_previous_month_at_year_boundary(self):
        d=parse('сумма заказов за прошлый месяц на озоне',date(2026,1,1));self.assertEqual(d['period']['from'],'2025-12-01')
    def test_leap_february(self):
        self.assertEqual(parse('сумма заказов за февраль 2024 на озоне',date(2024,3,1))['period']['to'],'2024-02-29')
    def test_last_week_is_calendar_week(self):
        self.assertEqual(draft('сумма заказов за прошлую неделю')['period'],{'from':'2026-10-26','to':'2026-11-01'})
    def test_rolling_excludes_today(self):
        self.assertEqual(draft('сумма заказов за последние 30 дней')['period'],{'from':'2026-10-04','to':'2026-11-02'})
    def test_invalid_calendar(self):
        with self.assertRaises(Rejected):draft('сумма заказов с 1 по 31 февраля 2026')
    def test_future_range(self):
        with self.assertRaises(Rejected):draft('сумма заказов за декабрь 2026')
    def test_two_periods(self):
        with self.assertRaises(Rejected):draft('сумма заказов за октябрь и за сентябрь')
    def test_ambiguous_sales(self):
        with self.assertRaises(Rejected):draft('продажи за октябрь')
    def test_order_count_is_not_units(self):
        with self.assertRaises(Rejected):draft('сколько заказов за октябрь')
    def test_exclusion_preserved(self):
        with self.assertRaises(Rejected):draft('сумма заказов за октябрь кроме артикула А')
    def test_explicit_no_buyouts(self):
        d=draft('сколько штук заказали и на какую сумму за прошлый месяц отдельно на Озоне и Вайлдберриз? Выкупы не учитывай')
        self.assertEqual(d['route'],'P1');self.assertEqual(set(d['metrics']),{'ordered_units','ordered_revenue'})
    def test_enabled_drr_has_explicit_order_base(self):
        self.assertEqual(draft('ДРР за октябрь на Озоне')['metrics'],['drr_ordered'])
    def test_mutation_blocked(self):
        with self.assertRaises(Rejected):draft('измени цены на озоне за октябрь')
    def test_credential_not_sent(self):
        with self.assertRaises(Rejected):draft('мой токен за октябрь')
    def test_unknown_phrase_is_p2_not_guess(self):
        self.assertEqual(draft('Каков объем заказанных единиц за октябрь на озоне')['route'],'P2')
    def test_timezone_in_key(self):
        d=draft();d['timezone']='UTC'
        with self.assertRaises(Rejected):make_plan(SCOPE,d,d['metrics'])
    def test_currency_total_unknown_rejected(self):
        unknown=Scope('A','acl1',(replace(OZ,currency=None),WB))
        with self.assertRaises(Rejected):plan('сумма заказов за октябрь вместе',unknown)
    def test_currency_total_mixed_rejected(self):
        mixed=Scope('A','acl1',(OZ,replace(WB,currency='KZT')))
        with self.assertRaises(Rejected):plan('сумма заказов за октябрь вместе',mixed)
    def test_units_total_unknown_currency_allowed(self):
        p=plan('количество заказанных товаров за октябрь вместе',Scope('A','acl1',(replace(OZ,currency=None),WB)))
        self.assertEqual(p['group_by'],'total')
    def test_duplicate_real_cabinet_dedup(self):
        scoped=Scope('A','acl1',(OZ,replace(OZ,id='oz2'),WB))
        self.assertEqual(len(plan(scope=scoped)['stores']),1)
    def test_new_store_does_not_expand_pending_snapshot(self):
        p=plan(); expanded=Scope('A','acl1',(OZ,replace(OZ,id='oz2',identity='other'),WB))
        self.assertTrue(plan_authorized(p,expanded));self.assertNotEqual(p,plan(scope=expanded))
    def test_access_revision_invalidates(self):
        self.assertFalse(plan_authorized(plan(),replace(SCOPE,revision='acl2')))
    def test_source_revision_invalidates(self):
        self.assertFalse(plan_authorized(plan(),Scope('A','acl1',(replace(OZ,source_revision='new'),WB))))
    def test_tenant_isolation(self):
        self.assertFalse(plan_authorized(plan(),replace(SCOPE,tenant='B')))
    def test_wb_lookback_not_only_length(self):
        d=parse('сумма заказов с 2024-01-01 по 2024-01-02 на вб',TODAY)
        with self.assertRaises(Rejected):make_plan(SCOPE,d,d['metrics'])

class ModelTests(unittest.TestCase):
    def test_valid_json(self):
        self.assertEqual(validate_model('{"metrics":["ordered_units"],"fully_understood":true,"unsupported":false}','stop'),['ordered_units'])
    def test_unknown_key(self):
        with self.assertRaises(Rejected):validate_model('{"metrics":["ordered_units"],"fully_understood":true,"unsupported":false,"url":"x"}','stop')
    def test_duplicate_key(self):
        with self.assertRaises(Rejected):validate_model('{"metrics":["ordered_units"],"metrics":["ordered_revenue"],"fully_understood":true,"unsupported":false}','stop')
    def test_blank_output(self):
        with self.assertRaises(Rejected):validate_model('    ','stop')
    def test_truncated_output(self):
        with self.assertRaises(Rejected):validate_model('{}','length')
    def test_numeric_truth_not_boolean(self):
        with self.assertRaises(Rejected):validate_model('{"metrics":["ordered_units"],"fully_understood":1,"unsupported":false}','stop')
    def test_unsupported_is_not_ignored(self):
        with self.assertRaises(Rejected):validate_model('{"metrics":["ordered_units"],"fully_understood":true,"unsupported":true}','stop')
    def test_arbitrary_metric(self):
        with self.assertRaises(Rejected):validate_model('{"metrics":["profit"],"fully_understood":true,"unsupported":false}','stop')
    def test_metric_duplicates(self):
        with self.assertRaises(Rejected):validate_model('{"metrics":["ordered_units","ordered_units"],"fully_understood":true,"unsupported":false}','stop')
    def test_nan_json(self):
        with self.assertRaises(Rejected):strict_json('{"x":NaN}')

class ProviderTests(unittest.TestCase):
    def test_one_month_request_not_daily_loop(self):
        p=plan();r=providers.build(p,p['stores'][0]);self.assertEqual(r.body['date_from'],'2026-10-01');self.assertEqual(r.body['date_to'],'2026-10-31');self.assertEqual(r.body['dimension'],['month'])
    def test_only_requested_ozon_metric(self):
        p=plan('сумма заказов за октябрь на озоне');self.assertEqual(providers.build(p,p['stores'][0]).body['metrics'],['revenue'])
    def test_quota_key_survives_source_revision(self):
        p=plan();s=p['stores'][0];r=providers.build(p,s)
        changed=dict(s,source_revision='new',access_revision='new')
        self.assertEqual(r.source,providers.build(p,changed).source)
    def test_ozon_valid(self):
        p=plan();r=providers.decode_ozon(oz_response(p),p,p['stores'][0]);self.assertTrue(r['complete']);self.assertEqual(r['values']['ordered_revenue'],'123.45')
    def test_ozon_mismatching_totals(self):
        p=plan();d=oz_response(p);d['result']['totals']=['999',4]
        with self.assertRaises(Rejected):providers.decode_ozon(d,p,p['stores'][0])
    def test_ozon_missing_metric(self):
        p=plan();d=oz_response(p);d['result']['data'][0]['metrics']=[]
        with self.assertRaises(Rejected):providers.decode_ozon(d,p,p['stores'][0])
    def test_ozon_outside_month(self):
        p=plan();d=oz_response(p);d['result']['data'][0]['dimensions'][0]['id']='2026-09'
        with self.assertRaises(Rejected):providers.decode_ozon(d,p,p['stores'][0])
    def test_ozon_unqualified_dimension(self):
        p=plan();d=oz_response(p);d['result']['data'][0]['dimensions'][0]['id']='October'
        with self.assertRaises(Rejected):providers.decode_ozon(d,p,p['stores'][0])
    def test_ozon_zero_is_valid_only_explicit_zero(self):
        p=plan();d={'result':{'data':[],'totals':[0,0]}}
        self.assertEqual(providers.decode_ozon(d,p,p['stores'][0])['values']['ordered_units'],'0')
    def test_wb_period_echo_required(self):
        p=plan('сводка заказов за октябрь на вб');d=wb_response(p);d['data']['products'][0]['statistic']['selected']['period']['end']='2026-10-30'
        with self.assertRaises(Rejected):providers.decode_wb(d,p,p['stores'][0])
    def test_wb_unknown_currency(self):
        p=plan('сводка заказов за октябрь на вб')
        with self.assertRaises(Rejected):providers.decode_wb(wb_response(p,currency='???'),p,p['stores'][0])
    def test_wb_duplicate_product(self):
        p=plan('сводка заказов за октябрь на вб');d=wb_response(p);d['data']['products'][1]['product']['nmId']=1
        with self.assertRaises(Rejected):providers.decode_wb(d,p,p['stores'][0])
    def test_wb_full_page_requires_next(self):
        p=plan('сводка заказов за октябрь на вб');r=providers.decode_wb(wb_response(p,n=1000),p,p['stores'][0]);self.assertFalse(r['complete']);self.assertEqual(r['progress']['offset'],1000)
    def test_wb_empty_final_page_preserves_sums(self):
        p=plan('сводка заказов за октябрь на вб');r=providers.decode_wb(wb_response(p,n=1000),p,p['stores'][0]);f=providers.decode_wb(wb_response(p,n=0),p,p['stores'][0],r['progress']);self.assertTrue(f['complete']);self.assertEqual(f['values']['ordered_units'],'1000')
    def test_wb_cross_page_duplicates_rejected(self):
        p=plan('сводка заказов за октябрь на вб');r=providers.decode_wb(wb_response(p,n=1000),p,p['stores'][0])
        with self.assertRaises(Rejected):providers.decode_wb(wb_response(p,n=2),p,p['stores'][0],r['progress'])
    def test_nonfinite_money(self):
        with self.assertRaises(Rejected):providers.number('NaN')
    def test_boolean_quantity(self):
        with self.assertRaises(Rejected):providers.number(True,True)
    def test_fractional_quantity(self):
        with self.assertRaises(Rejected):providers.number('1.5',True)
    def test_decimal_no_float_arithmetic(self):
        self.assertEqual(providers.number('0.1')+providers.number('0.2'),Decimal('0.3'))
    def test_partial_result_not_speech(self):
        with self.assertRaises(Rejected):providers.render(plan(),[],'date')

class FlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.clock=Clock();self.scope=SCOPE
        self.repo=Repository(str(Path(self.tmp.name)/'db.sqlite3'),clock=self.clock)
        self.engine=Engine(self.repo,self.scope_for);self.transport=FakeTransport();self.worker=Worker(self.engine,self.transport);self.seq=0
    def tearDown(self):self.tmp.cleanup()
    def scope_for(self,tenant):
        if tenant!='A':raise Rejected('TENANT_DENIED')
        return self.scope
    def submit(self,q='сводка заказов за октябрь на озоне',rid=None):
        self.seq+=1;return self.engine.submit('A',q,rid or str(self.seq),fingerprint(q),TODAY)
    def done(self,q='сводка заказов за октябрь на озоне'):
        result=self.submit(q)
        for _ in range(6):
            if not self.worker.step():break
        return result
    def test_ingress_has_no_network(self):
        self.submit();self.assertEqual(self.transport.calls,[]);self.assertEqual(self.repo.call_count(),0)
    def test_realistic_ozon_pipeline_fake_transport(self):
        self.done();self.assertEqual(self.repo.get('A')['state'],'READY');self.assertIn('123.45',self.engine.control('A','результат')['text'])
    def test_two_sources_two_requests(self):
        self.done('сводка заказов за октябрь на обеих площадках');self.assertEqual(len(self.transport.calls),2);self.assertEqual(self.repo.get('A')['state'],'READY')
    def test_poll_never_issues_call(self):
        self.done();before=self.repo.call_count()
        for _ in range(25):self.engine.control('A','результат')
        self.assertEqual(self.repo.call_count(),before)
    def test_equivalent_month_is_exact_cache_hit(self):
        self.done();r=self.submit('сводка заказов с 1 по 31 октября 2026 на озоне');self.assertEqual(r['cache'],'HIT');self.assertEqual(len(self.transport.calls),1)
    def test_week_does_not_reuse_month(self):
        first=self.done();r=self.submit('сводка заказов с 1 по 7 октября 2026 на озоне');self.assertEqual(r['cache'],'NEW');self.assertNotEqual(first['job_id'],r['job_id'])
    def test_subset_metric_does_not_reuse_superset(self):
        self.done();r=self.submit('сумма заказов за октябрь на озоне');self.assertEqual(r['cache'],'NEW')
    def test_store_subset_does_not_reuse_all(self):
        self.done('сводка заказов за октябрь на обеих площадках');self.assertEqual(self.submit()['cache'],'NEW')
    def test_same_running_job_joins(self):
        a=self.submit();b=self.submit();self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(b['cache'],'JOIN')
    def test_refresh_running_does_not_duplicate(self):
        a=self.submit();b=self.submit('обнови сводка заказов за октябрь на озоне');self.assertEqual(a['job_id'],b['job_id'])
    def test_refresh_ready_creates_fresh_job(self):
        a=self.done();b=self.submit('обнови сводка заказов за октябрь на озоне');self.assertNotEqual(a['job_id'],b['job_id'])
    def test_expired_cache_misses(self):
        self.done();self.clock.advance(901);self.assertEqual(self.submit()['cache'],'NEW')
    def test_request_id_replay(self):
        a=self.submit(rid='same');b=self.submit(rid='same');self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(b['cache'],'REPLAY')
    def test_changed_replay_rejected(self):
        self.submit(rid='same')
        with self.assertRaises(Rejected):self.submit('сумма заказов за вчера на озоне',rid='same')
    def test_revocation_blocks_saved_result(self):
        self.done();self.scope=replace(SCOPE,revision='revoked');self.assertIn('Доступ',self.engine.control('A','результат')['text'])
    def test_unknown_cannot_refresh(self):
        self.transport.failure=CallError('TIMEOUT',unknown=True);a=self.done();b=self.submit('обнови сводка заказов за октябрь на озоне');self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(b['state'],'UNKNOWN');self.assertEqual(len(self.transport.calls),1)
    def test_known_http_error_is_not_zero(self):
        self.transport.failure=CallError('HTTP_500',status=500);self.done();self.assertEqual(self.repo.get('A')['state'],'QUEUED');self.assertNotIn('заказано товаров 0',self.engine.control('A','результат')['text'])
    def test_429_known_rejection_reschedules_one_job(self):
        self.transport.failure=CallError('HTTP_429',status=429,retry_at=self.clock()+90)
        initial=self.submit();self.worker.step()
        row=self.repo.get('A');self.assertEqual(row['state'],'QUEUED')
        self.assertGreaterEqual(row['due'],self.clock()+90)
        duplicate=self.submit('обнови сводка заказов за октябрь на озоне')
        self.assertEqual(duplicate['job_id'],initial['job_id'])
        self.assertEqual(self.repo.call_count(),1)
        self.transport.failure=None;self.clock.advance(91);self.worker.step()
        self.assertEqual(self.repo.get('A')['state'],'READY')
        self.assertEqual(self.repo.call_count(),2)
    def test_429_keeps_same_job_until_provider_accepts(self):
        self.transport.failure=CallError('HTTP_429',status=429)
        original=self.submit()['job_id']
        for count,advance in ((1,91),(2,181),(3,361)):
            self.worker.step();self.assertEqual(self.repo.call_count(),count)
            row=self.repo.get('A');self.assertEqual(row['state'],'QUEUED')
            self.assertEqual(row['id'],original)
            self.assertGreater(row['due'],self.clock())
            self.clock.advance(advance)
        self.transport.failure=None;self.worker.step()
        self.assertEqual(self.repo.get('A')['state'],'READY')
    def test_401_denies_only_affected_source(self):
        self.transport.failure=CallError('HTTP_401',status=401);self.done()
        self.transport.failure=None
        self.done('сводка заказов за октябрь на вб');self.assertEqual(self.repo.get('A')['state'],'READY')
    def test_cancel_before_send(self):
        self.submit();self.engine.control('A','отмени отчет');self.assertFalse(self.worker.step());self.assertEqual(self.transport.calls,[])
    def test_cancel_during_send_prevents_publish(self):
        self.submit();self.transport.on_call=lambda r:self.repo.cancel('A');self.worker.step();self.assertEqual(self.repo.get('A')['state'],'CANCELLED')
    def test_expired_lease_cannot_complete(self):
        self.submit();r=self.repo.claim();self.clock.advance(121)
        with self.assertRaises(Rejected):self.repo.complete(r['id'],r['owner'],{'complete':True,'pages':['x']})
        self.assertEqual(self.repo.get('A')['state'],'UNKNOWN')
    def test_wrong_owner_cannot_commit(self):
        self.submit();r=self.repo.claim()
        with self.assertRaises(Rejected):self.repo.complete(r['id'],'not-owner',{'complete':True,'pages':['x']})
    def test_incomplete_result_cannot_commit(self):
        self.submit();r=self.repo.claim()
        with self.assertRaises(Rejected):self.repo.complete(r['id'],r['owner'],{'complete':False,'pages':['x']})
    def test_throttle_yields_to_other_platform(self):
        self.done();self.submit('сумма заказов за вчера на озоне');self.worker.step();self.assertEqual(len(self.transport.calls),1)
        self.submit('сводка заказов за октябрь на вб');self.worker.step();self.assertEqual(len(self.transport.calls),2)
    def test_p2_single_model_then_physical_plan(self):
        self.submit('Каков объем заказанных единиц за октябрь на озоне');self.worker.step();self.assertEqual(self.transport.calls[0].operation,'deepseek_parse');self.worker.step();self.assertEqual(self.transport.calls[1].operation,'ozon_orders');self.assertEqual(self.repo.get('A')['state'],'READY')
    def test_p2_bad_schema_makes_no_marketplace_call(self):
        self.transport.model_raw='{"endpoint":"anything"}';self.done('Каков объем заказанных единиц за октябрь на озоне');self.assertEqual(len(self.transport.calls),3);self.assertTrue(all(r.operation=='deepseek_parse' for r in self.transport.calls));self.assertEqual(self.repo.get('A')['state'],'FAILED')
    def test_p2_attaches_existing_canonical_report(self):
        self.done('количество заказанных товаров за октябрь на озоне');self.done('Каков объем заказанных единиц за октябрь на озоне');self.assertEqual([r.operation for r in self.transport.calls],['ozon_orders','deepseek_parse']);self.assertEqual(self.repo.get('A')['state'],'READY')
    def test_p2_snapshot_does_not_include_later_store(self):
        self.submit('Каков объем заказанных единиц за октябрь на озоне');self.scope=Scope('A','acl1',(OZ,WB,replace(OZ,id='oz2',identity='cabinet-2')));self.worker.step();r=self.repo.get('A');self.assertEqual(len(strict_json(r['plan'])['stores']),1)
    def test_persistent_new_session_readback(self):
        self.done();other=Engine(Repository(self.repo.path,clock=self.clock),self.scope_for);self.assertIn('123.45',other.control('A','результат')['text'])
    def test_completed_delivery_stops_reminder(self):
        r=self.done();self.assertIsNotNone(self.repo.unread('A'));self.engine.control('A','результат');self.assertIsNone(self.repo.unread('A'))
    def test_other_tenant_cannot_read_job(self):
        r=self.done()
        with self.assertRaises(Rejected):self.repo.get('B',r['job_id'])
    def test_parallel_duplicate_ingress_one_job(self):
        def go(i):return self.repo.enqueue('A','parallel-'+str(i),'a'*64,draft(),plan(),'scope')[0]['id']
        with ThreadPoolExecutor(max_workers=6) as pool:ids=list(pool.map(go,range(12)))
        self.assertEqual(len(set(ids)),1)
    def test_parallel_claim_only_one_owner(self):
        self.submit()
        with ThreadPoolExecutor(max_workers=6) as pool:claims=list(pool.map(lambda _:self.repo.claim(),range(12)))
        self.assertEqual(sum(x is not None for x in claims),1)
    def test_rolling_daily_budget(self):
        self.submit();r=self.repo.claim();self.repo.reserve(r['id'],r['owner'],'daily',1,1);self.clock.advance(2)
        with self.assertRaises(Deferred):self.repo.reserve(r['id'],r['owner'],'daily',1,1)

class TransportSafetyTests(unittest.TestCase):
    def test_disabled_never_opens_network(self):
        t=HTTPTransport('/nonexistent',{}, {},enabled=False)
        with patch('urllib.request.OpenerDirector.open',side_effect=AssertionError('network')):
            with self.assertRaises(CallError) as ctx:t.execute(providers.build(plan(),plan()['stores'][0]),plan()['stores'][0])
        self.assertEqual(ctx.exception.code,'LIVE_DISABLED')
    def test_unqualified_recipe_never_reads_keys(self):
        t=HTTPTransport('/nonexistent',{}, {},enabled=True)
        with patch.object(t,'_credential',side_effect=AssertionError('secrets')):
            with self.assertRaises(CallError) as ctx:t.execute(providers.build(plan(),plan()['stores'][0]),plan()['stores'][0])
        self.assertEqual(ctx.exception.code,'DECODER_NOT_LIVE_QUALIFIED')
    def test_unknown_endpoint_never_network(self):
        t=HTTPTransport('/nonexistent',{}, {},enabled=True)
        with self.assertRaises(CallError):t.execute(providers.Request('not-in-catalog','s','id',{},1,1),None)
    def test_no_redirect(self):self.assertIsNone(NoRedirect().redirect_request(None,None,None,None,None,None))
    def test_path_escape_rejected(self):
        t=HTTPTransport('/nonexistent',{}, {},enabled=False)
        with self.assertRaises(CallError):t._credential('../other')


class InvariantTests(unittest.TestCase):
    setUp=FlowTests.setUp
    tearDown=FlowTests.tearDown
    scope_for=FlowTests.scope_for
    submit=FlowTests.submit
    done=FlowTests.done
    def test_multiple_stores_aggregate_by_platform(self):
        self.scope=Scope('A','acl1',(OZ,replace(OZ,id='oz2',identity='other-oz'),WB))
        self.done();text=self.engine.control('A','результат')['text']
        self.assertIn('заказано товаров 8',text);self.assertEqual(text.count('Озон:'),2)
    def test_no_model_receives_financial_records(self):
        self.done('Каков объем заказанных единиц за октябрь на озоне')
        self.assertEqual(set(self.transport.calls[0].body),{'question','slots','catalog'})
        sent=json.dumps(self.transport.calls[0].body)
        for forbidden in ('access_token','seller_api_key','tenant','cabinet-oz-1','123.45'):
            self.assertNotIn(forbidden,sent)
    def test_failed_source_invalidates_earlier_ready_cache(self):
        first=self.done();self.clock.advance(62);self.transport.failure=CallError('HTTP_401',status=401)
        self.done('сводка заказов за вчера на озоне')
        self.assertIn('Доступ',self.engine.describe('A',self.repo.get('A',first['job_id']),True))
    def test_ready_data_cannot_differ_from_voice_projection(self):
        self.submit();row=self.repo.claim();p=strict_json(row['plan'])
        data=providers.decode_ozon(oz_response(p),p,p['stores'][0]);data['store_id']=p['stores'][0]['id'];data.pop('progress')
        report=providers.render(p,[data],'2026-11-03 09:00 UTC');report['pages']=['Непроверенная сумма 999999.']
        with self.assertRaises(Rejected) as ctx:self.repo.complete(row['id'],row['owner'],report)
        self.assertEqual(ctx.exception.code,'RESULT_PROJECTION_MISMATCH')
    def test_no_arbitrary_small_shop_limit(self):
        self.scope=Scope('A','acl1',tuple(replace(OZ,id='oz'+str(i).zfill(3),identity='cabinet'+str(i)) for i in range(25)))
        r=self.submit('количество заказанных товаров за октябрь на озоне')
        self.assertEqual(len(strict_json(self.repo.get('A',r['job_id'])['plan'])['stores']),25)

if __name__=='__main__':unittest.main(verbosity=2)

