"""New features: independent expected values, no external provider connections."""
import copy,json,tempfile,unittest,sys
from pathlib import Path
from decimal import Decimal
from datetime import date,timedelta
from dataclasses import replace
from unittest.mock import patch
from test_runtime import Clock,SCOPE,OZ,WB,TODAY,plan,draft,oz_response,wb_response
from semantics import parse,make_plan,fingerprint,Rejected,Scope,Store
from registry import REGISTRY_HASH,DEFINITIONS,base_metrics,load_registry
from repository import Repository
from engine import Engine,Worker,CallError
from http_transport import HTTPTransport
import providers

class ExtendedTransport:
    def __init__(self):self.calls=[];self.token=False;self.fail=None;self.negative=False;self.zero=False;self.model=['drr_ordered']
    def prepare(self,r,s):
        if r.operation in ('ozon_expense','ozon_ads_daily') and not self.token:
            return providers.Request('ozon_ads_token','ozon:'+s['identity']+':ozon_ads_token',s['id'],{},2,100)
    def execute(self,r,s):
        self.calls.append(r)
        if self.fail:raise self.fail
        if r.operation=='deepseek_parse':data={'content':json.dumps({'expressions':[{'metric':m} for m in self.model],'fully_understood':True,'unsupported':False}),'finish_reason':'stop'}
        elif r.operation=='ozon_ads_token':self.token=True;data={'authorized':True}
        elif r.operation=='ozon_orders':
            values={'ordered_units':4,'revenue':'0' if self.zero else '200'}
            ms=[values[m] for m in r.body['metrics']]
            data={'result':{'data':[{'dimensions':[{'id':r.body['date_from'][:7]}],'metrics':ms}],'totals':ms}}
        elif r.operation=='wb_orders':
            period=r.body['selectedPeriod']
            def selected(period,old=False):return {'period':period,'orderCount':2 if old else 4,'orderSum':'100' if old else ('0' if self.zero else '200'),'buyoutCount':2,'buyoutSum':'100','cancelCount':1,'cancelSum':'50','openCount':40,'cartCount':10}
            data={'data':{'currency':'RUB','products':[{'product':{'nmId':123,'brandName':'Лес'},'statistic':{'selected':selected(period),'past':selected(r.body.get('pastPeriod',period),True)}}]}}
        elif r.operation in ('ozon_expense','ozon_ads_daily'):data={'rows':[{'id':'1','date':r.body['dateFrom'],'moneySpent':'20,00','bonusSpent':'3,00','prepaymentSpent':'5,00'}]}
        elif r.operation=='wb_expense':data=[{'advertId':1,'updNum':0,'updTime':None,'updSum':20,'currency':'RUB'}]
        else:raise AssertionError(r.operation)
        return data,{'status':200,'elapsed_ms':1,'bytes':100}

class ExtendedMatrix(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.clock=Clock();self.scope=SCOPE
        self.repo=Repository(Path(self.temp.name)/'db.sqlite',self.clock)
        self.engine=Engine(self.repo,lambda t:self.scope);self.http=ExtendedTransport();self.worker=Worker(self.engine,self.http);self.seq=0
    def tearDown(self):self.temp.cleanup()
    def submit(self,q):
        self.seq+=1;return self.engine.submit('A',q,'q'+str(self.seq),fingerprint(q),TODAY)
    def run_job(self,q):
        r=self.submit(q)
        for _ in range(40):
            row=self.repo.get('A',r['job_id'])
            if row['state'] not in ('QUEUED','RUNNING'):break
            self.worker.step();self.clock.advance(62)
        row=self.repo.get('A',r['job_id']);self.assertEqual(row['state'],'READY',row['error'])
        return json.loads(row['result'])
    def text(self,r):return ' '.join(r['pages'])
    def test_ozon_drr_and_auth_counted(self):
        r=self.run_job('дрр за октябрь на озоне');self.assertIn('10 процентов',self.text(r))
        self.assertEqual([x.operation for x in self.http.calls],['ozon_orders','ozon_ads_token','ozon_ads_daily'])
        self.assertEqual(self.http.calls[0].body['metrics'],['revenue']);self.assertEqual(self.repo.call_count(),3)
    def test_wb_drr_two_calls(self):
        r=self.run_job('дрр за октябрь на wb');self.assertIn('10 процентов',self.text(r));self.assertEqual(len(self.http.calls),2)
    def test_both_drr(self):
        r=self.run_job('дрр за октябрь на озоне и wb');self.assertEqual(len(self.http.calls),5);self.assertEqual(self.text(r).count('10 процентов'),2)
    def test_combined_drr_sales_no_duplicate_orders(self):
        r=self.run_job('сводка заказов и дрр за октябрь на озоне')
        self.assertEqual(len(self.http.calls),3);self.assertEqual(self.http.calls[0].body['metrics'],['revenue','ordered_units'])
        self.assertEqual(r['data'][0]['values'],{'ad_spend':'20.00','ordered_revenue':'200','ordered_units':'4'})
    def test_zero_denominator_undefined(self):
        self.http.zero=True;r=self.run_job('дрр за октябрь на wb');self.assertIn('знаменатель равен нулю',self.text(r));self.assertNotIn('0 процентов',self.text(r))
    def test_average_item_price(self):
        r=self.run_job('средняя стоимость заказанного товара за октябрь на озоне');self.assertIn('50 RUB',self.text(r));self.assertEqual(len(self.http.calls),1)
    def test_orders_per_day(self):
        r=self.run_job('среднее количество заказанных товаров в день за октябрь на wb');self.assertIn('0.13',self.text(r))
    def test_wb_funnel_one_source(self):
        r=self.run_job('сводка воронки за октябрь на wb');self.assertEqual(len(self.http.calls),1);self.assertIn('25 процентов',self.text(r));self.assertIn('40 процентов',self.text(r))
    def test_wb_cohort_buyouts(self):
        r=self.run_job('сводка выкупов по заказам за октябрь на wb');self.assertIn('не к дате выкупа',self.text(r));self.assertEqual(len(self.http.calls),1)
    def test_wb_cancel_cohort(self):
        r=self.run_job('сводка отмен по заказам за октябрь на wb');self.assertIn('50 RUB',self.text(r))
    def test_wb_buyout_share(self):
        r=self.run_job('доля выкупленных товаров в заказанных за октябрь на wb');self.assertIn('50 процентов',self.text(r))
    def test_wb_comparison_one_call(self):
        r=self.run_job('сравни сумму заказов за октябрь и сентябрь на wb');self.assertEqual(len(self.http.calls),1);self.assertIn('pastPeriod',self.http.calls[0].body);self.assertIn('ранее 100 RUB',self.text(r));self.assertIn('изменение +100 RUB',self.text(r))
    def test_comparison_drr_two_expense_calls(self):
        r=self.run_job('сравни дрр за октябрь и сентябрь на wb');self.assertEqual(len(self.http.calls),3);self.assertIn('процентных пункта',self.text(r));self.assertIn('ранее 20 процентов',self.text(r))
    def test_typed_wb_filter_inclusion(self):
        r=self.run_job('сумма заказов за октябрь на wb по артикулу wb 123');self.assertEqual(self.http.calls[0].body['nmIds'],[123]);self.assertIn('200 RUB',self.text(r))
    def test_typed_wb_filter_exclusion(self):
        r=self.run_job('сумма заказов за октябрь на wb кроме артикула wb 123');self.assertIn('сумма заказов 0 RUB',self.text(r));self.assertEqual(self.http.calls[0].body['nmIds'],[])
    def test_brand_match(self):
        r=self.run_job('сумма заказов за октябрь на wb бренд "лес"');self.assertIn('200 RUB',self.text(r))
    def test_brand_not_found(self):
        r=self.run_job('сумма заказов за октябрь на wb бренд "другой"');self.assertIn('сумма заказов 0 RUB',self.text(r))
    def test_advertised_product_not_inferred(self):
        with self.assertRaises(Rejected):self.submit('дрр за октябрь на wb по артикулу wb 123')
        self.assertEqual(self.repo.call_count(),0)
    def test_cohort_ozon_fails_before_api(self):
        with self.assertRaises(Rejected):self.submit('сумма выкупов по заказам за октябрь на озоне')
        self.assertEqual(self.repo.call_count(),0)
    def test_generic_buyouts_require_clarification(self):
        with self.assertRaises(Rejected) as e:self.submit('выкупы за октябрь на wb')
        self.assertEqual(e.exception.code,'COHORT_REQUIRED')
    def test_ozon_ad_bonus_not_double_counted(self):
        r=self.run_job('расходы на рекламу и расход рекламных бонусов за октябрь на озоне')
        self.assertEqual(r['data'][0]['values'],{'ad_bonus_spend':'3.00','ad_spend':'20.00'})
        self.assertEqual(len(self.http.calls),3)
    def test_ready_read_does_not_call(self):
        self.run_job('дрр за октябрь на wb');count=self.repo.call_count();self.submit('результат');self.assertEqual(self.repo.call_count(),count)
    def test_exact_hit_no_calls(self):
        self.run_job('дрр за октябрь на wb');r=self.submit('дрр с 1 по 31 октября на wb');self.assertEqual(r['cache'],'HIT');self.assertEqual(self.repo.call_count(),2)
    def test_metric_change_is_new(self):
        self.run_job('дрр за октябрь на wb');r=self.submit('расходы на рекламу за октябрь на wb');self.assertEqual(r['cache'],'NEW')
    def test_unknown_not_refreshed(self):
        self.http.fail=CallError('TIMEOUT',unknown=True);r=self.submit('дрр за октябрь на wb');self.worker.step();x=self.submit('обнови дрр за октябрь на wb');self.assertEqual(x['job_id'],r['job_id']);self.assertEqual(x['state'],'UNKNOWN')
    def test_model_new_metric(self):
        r=self.run_job('какая получилась доля рекламных трат от заказанной суммы за октябрь на wb');self.assertEqual(self.http.calls[0].operation,'deepseek_parse');self.assertIn('10 процентов',self.text(r))
    def test_quota_sources_separate_orders_ads(self):
        p=plan('дрр за октябрь на wb');sources=providers.sources(p,p['stores'][0]);self.assertEqual(len(sources),2)
    def test_weighted_ratio_not_average(self):
        p=plan('дрр за октябрь вместе');a={'store_id':'oz1','complete':True,'currency':'RUB','values':{'ad_spend':'10','ordered_revenue':'100'}};b={'store_id':'wb1','complete':True,'currency':'RUB','values':{'ad_spend':'90','ordered_revenue':'900'}}
        b['values']['ad_spend']='180';r=providers.render(p,[a,b],'test');self.assertIn('19 процентов',self.text(r));self.assertNotIn('15 процентов',self.text(r))
    def test_ad_currency_mismatch_rejected(self):
        p=plan('дрр за октябрь на wb');task=providers.tasks(p,p['stores'][0])[1]
        with self.assertRaises(Rejected):providers.decode_expense([{'advertId':1,'updTime':None,'updSum':10,'currency':'KZT'}],task,p['stores'][0])
    def test_zero_upd_numbers_not_deduplicated(self):
        p=plan('расходы на рекламу за октябрь на wb');s=p['stores'][0];t=providers.tasks(p,s)[0]
        r=providers.decode_expense([{'advertId':1,'updNum':0,'updTime':None,'updSum':10,'currency':'RUB'}]*2,t,s);self.assertEqual(r['values']['ad_spend'],'20')
    def test_ads_wrong_period(self):
        p=plan('расходы на рекламу за октябрь на wb');s=p['stores'][0];t=providers.tasks(p,s)[0]
        with self.assertRaises(Rejected):providers.decode_expense([{'advertId':1,'updTime':'2026-09-30T23:00:00+03:00','updSum':10,'currency':'RUB'}],t,s)
    def test_ads_no_timezone_rejected(self):
        p=plan('расходы на рекламу за октябрь на wb');s=p['stores'][0];t=providers.tasks(p,s)[0]
        with self.assertRaises(Rejected):providers.decode_expense([{'advertId':1,'updTime':'2026-10-01T00:00:00','updSum':10,'currency':'RUB'}],t,s)
    def test_ozon_ads_duplicate_rejected(self):
        p=plan('расходы на рекламу за октябрь на озоне');s=p['stores'][0];t=providers.tasks(p,s)[0]
        with self.assertRaises(Rejected):providers.decode_expense({'rows':[{'id':'1','date':'2026-10-01','moneySpent':'1,00'}]*2},t,s)
    def test_bad_comma_value_rejected(self):
        with self.assertRaises(Rejected):providers.expense_number('1,234,56')
    def test_boolean_money_rejected(self):
        with self.assertRaises(Rejected):providers.expense_number(True)
    def test_negative_expense_is_not_silently_abs(self):
        with self.assertRaises(Rejected):providers.expense_number('-10,00')
    def test_wb_chunk_month_not_daily(self):
        p=plan('расходы на рекламу с 2026-09-01 по 2026-10-31 на wb');ts=providers.tasks(p,p['stores'][0]);self.assertEqual(len(ts),2);self.assertEqual(ts[0]['period'],{'from':'2026-09-01','to':'2026-10-01'});self.assertEqual(ts[1]['period'],{'from':'2026-10-02','to':'2026-10-31'})
    def test_ozon_two_months_one_expense_call(self):
        p=plan('расходы на рекламу с 2026-09-01 по 2026-10-31 на озоне');self.assertEqual(len(providers.tasks(p,p['stores'][0])),1)
    def test_two_source_completeness_no_partial(self):
        r=self.submit('дрр за октябрь на wb');self.worker.step();self.assertEqual(self.repo.get('A',r['job_id'])['state'],'QUEUED');self.assertNotIn('200',self.submit('результат')['text'])
    def test_ratio_missing_operand_rejected(self):
        p=plan('дрр за октябрь на wb')
        with self.assertRaises(Rejected):providers.render(p,[{'store_id':'wb1','complete':True,'values':{'ad_spend':'20'},'currency':'RUB'}],'test')
    def test_filters_in_identity(self):
        self.assertNotEqual(plan('сумма заказов за октябрь на wb'),plan('сумма заказов за октябрь на wb кроме артикула wb 123'))
    def test_comparison_in_identity(self):
        self.assertNotEqual(plan('сумма заказов за октябрь на wb'),plan('сравни сумму заказов за октябрь и сентябрь на wb'))
    def test_token_not_in_persisted_jobs(self):
        self.run_job('дрр за октябрь на озоне')
        with self.repo.connection() as c:
            job=dict(c.execute('SELECT * FROM jobs LIMIT 1').fetchone())
        self.assertNotIn('access_token',json.dumps(job));self.assertNotIn('client_secret',json.dumps(job))
    def test_preparation_token_cached_for_next_job(self):
        self.run_job('дрр за октябрь на озоне');self.run_job('расходы на рекламу за октябрь на озоне');self.assertEqual(sum(r.operation=='ozon_ads_token' for r in self.http.calls),1)
    def test_ad_401_does_not_deny_orders(self):
        r=self.submit('расходы на рекламу за октябрь на wb');self.http.fail=CallError('HTTP_401',status=401);self.worker.step();self.assertTrue(self.engine.authorized(plan('сводка заказов за октябрь на wb')));self.assertFalse(self.engine.authorized(plan('расходы на рекламу за октябрь на wb')))

if __name__=='__main__':unittest.main()
