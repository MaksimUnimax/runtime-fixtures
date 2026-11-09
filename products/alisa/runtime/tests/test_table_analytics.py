"""Row algebra, explicit event axis and multi-turn scope checks. Synthetic data only."""
import copy,json,tempfile,unittest
from pathlib import Path
from datetime import date,datetime,timezone
from decimal import Decimal
from dataclasses import replace
from unittest.mock import patch
import table_analytics as t
from semantics import Scope,Store,Rejected,fingerprint,strict_json,asdict
from repository import Repository
from engine import Engine,Worker
import retention
TODAY=date(2026,11,4)
SCOPE=Scope('A','revision',(Store('oz','ozon','synthetic-oz','a','s','RUB'),Store('wb','wb','synthetic-wb','a','s','RUB')))
def caps(scope=SCOPE):
    return {s.id:{op:{'status':'READ_ONLY_CANARY','table_hash':t.HASH,'token_class':'personal','evidence_ref':'synthetic-test'} for op,spec in t.OPERATIONS.items() if spec['platform']==s.platform} for s in scope.stores}
def plan(q):return t.make_table_plan(SCOPE,t.parse_table(q,TODAY),caps())
def oz_data(rows,totals=None):
    return {'result':{'data':[{'dimensions':[{'id':str(k),'name':str(k)}],'metrics':[u,str(v)]} for k,u,v in rows], 'totals':totals if totals is not None else [sum(x[1] for x in rows),str(sum(Decimal(str(x[2])) for x in rows))]}}
def wb_data(rows,period=None):
    p=period or {'from':'2026-10-01','to':'2026-10-31'}
    return {'data':{'currency':'RUB','products':[{'product':{'nmId':int(k),'title':'item '+str(k),'brandName':b},'statistic':{'selected':{'period':{'start':p['from'],'end':p['to']},'orderCount':u,'orderSum':str(v)}}} for k,u,v,b in rows]}}
def event(identity='S1',nm=101,day='2026-11-03',price=100,update=None,brand='brand'):
    return {'saleID':identity,'nmId':nm,'date':day+'T12:00:00','priceWithDisc':price,'lastChangeDate':update or day+'T15:00:00','supplierArticle':'item','brand':brand,'srid':'private-must-not-persist'}
def decoded(p,data):
    s=p['stores'][0];return t.decode(data,p,s,t.tasks(p,s)[0])
def report(p,rows,previous=None):
    s=p['stores'][0]
    return t.render(p,[{'store_id':s['id'],'currency':'RUB','complete':True,'current':rows,'previous':previous or []}],'2026-11-04 03:00 UTC')
class Clock:
    def __init__(self):self.n=datetime(2026,11,4,3,tzinfo=timezone.utc).timestamp()
    def __call__(self):return self.n
    def advance(self,n=61):self.n+=n
class Transport:
    def __init__(self):self.calls=[]
    def execute(self,r,store):
        self.calls.append(r)
        if r.operation=='wb_event_sales':return [event(day=r.body['dateFrom'][:10])],{'status':200,'elapsed_ms':1}
        if r.operation=='ozon_table_orders':return oz_data([(11,1,100),(22,3,90)]),{'status':200,'elapsed_ms':1}
        if r.operation=='wb_table_orders':
            p={'from':r.body['selectedPeriod']['start'],'to':r.body['selectedPeriod']['end']}
            return wb_data([(11,1,100,'brand'),(22,3,90,'brand')],p),{'status':200,'elapsed_ms':1}
        raise AssertionError(r.operation)

class TableTests(unittest.TestCase):
    def reject(self,fn,code=None):
        with self.assertRaises(Rejected) as e:fn()
        if code:self.assertEqual(e.exception.code,code)
    def test_sku_filter_then_rank(self):
        p=plan('топ 1 товаров по сумме заказов за октябрь 2026 на озоне кроме sku 11')
        d=decoded(p,oz_data([(11,9,900),(22,2,200),(33,1,100)]))
        text=' '.join(report(p,d['rows'])['pages'])
        self.assertIn('код 22',text);self.assertNotIn('код 11',text)
    def test_wb_brand_filter_before_rank(self):
        p=plan('топ 1 товаров по сумме заказов за октябрь 2026 на wb бренд "brand"')
        d=decoded(p,wb_data([(11,9,900,'other'),(22,2,200,'Brand'),(33,1,100,'brand')]))
        self.assertIn('код 22',' '.join(report(p,d['rows'])['pages']))
    def test_number_of_goods_sort(self):
        p=plan('топ 1 товаров по количеству заказанных товаров за октябрь 2026 на озоне')
        d=decoded(p,oz_data([(11,1,900),(22,3,200)]));self.assertIn('код 22',' '.join(report(p,d['rows'])['pages']))
    def test_ascending(self):
        p=plan('топ 1 товаров по сумме заказов по возрастанию за октябрь 2026 на озоне')
        self.assertIn('код 22',' '.join(report(p,decoded(p,oz_data([(11,1,900),(22,3,200)]))['rows'])['pages']))
    def test_quote_is_not_operation(self):
        self.assertIsNone(t.parse_table('сводка заказов за октябрь 2026 на wb бренд "по дням"',TODAY))
    def test_quote_cannot_alter_view(self):
        p=plan('топ 1 товаров по сумме заказов за октябрь 2026 на wb бренд "по дням"')
        self.assertEqual(p['table']['view'],'items');self.assertEqual(p['filters']['brands'],['по дням'])
    def test_quote_sku_no_side_effect(self):
        d=t.parse_table('топ 1 товаров по сумме заказов за октябрь 2026 на wb бренд "sku 123"',TODAY)
        self.assertEqual(d['table_request']['sku_filters'],{});self.assertEqual(d['filters']['brands'],['sku 123'])
    def test_quote_price_no_side_effect(self):
        p=plan('топ 1 товаров по сумме заказов за октябрь 2026 на wb бренд "по количеству"')
        self.assertEqual(p['table']['sort'],'revenue')
    def test_ozon_pagination_complete_not_top_first_page(self):
        p=plan('топ 1 товаров по сумме заказов за октябрь 2026 на озоне');s=p['stores'][0];task=t.tasks(p,s)[0]
        d=t.decode(oz_data([(i,1,1) for i in range(1,1001)],[1001,'2000']),p,s,task)
        self.assertFalse(d['complete']);self.assertEqual(t.build_task(p,s,task,d['progress']).body['offset'],1000)
        d=t.decode(oz_data([(1001,1,1000)],[1001,'2000']),p,s,task,d['progress'])
        self.assertTrue(d['complete']);self.assertIn('код 1001',' '.join(report(p,d['rows'])['pages']))
    def test_ozon_duplicate_page_denied(self):
        p=plan('топ 2 товаров по сумме заказов за октябрь 2026 на озоне');s=p['stores'][0];task=t.tasks(p,s)[0]
        d=t.decode(oz_data([(i,1,1) for i in range(1,1001)],[1001,'1001']),p,s,task)
        self.reject(lambda:t.decode(oz_data([(1,1,1)],[1001,'1001']),p,s,task,d['progress']),'ROW_DUPLICATE')
    def test_changed_totals_denied(self):
        p=plan('топ 2 товаров по сумме заказов за октябрь 2026 на озоне');s=p['stores'][0];task=t.tasks(p,s)[0]
        d=t.decode(oz_data([(i,1,1) for i in range(1,1001)],[1001,'1001']),p,s,task)
        self.reject(lambda:t.decode(oz_data([(1001,1,1)],[1002,'1002']),p,s,task,d['progress']),'OZON_TABLE_TOTALS_CHANGED')
    def test_totals_reconciled(self):
        p=plan('топ 2 товаров по сумме заказов за октябрь 2026 на озоне')
        self.reject(lambda:decoded(p,oz_data([(1,1,100)],[1,'101'])),'OZON_TABLE_TOTAL_MISMATCH')
    def test_wb_currency_changed(self):
        p=plan('топ 2 товаров по сумме заказов за октябрь 2026 на wb');d=wb_data([(1,1,100,'a')]);d['data']['currency']='USD'
        self.reject(lambda:decoded(p,d),'TABLE_CURRENCY_CHANGED')
    def test_wb_wrong_period(self):
        p=plan('топ 2 товаров по сумме заказов за октябрь 2026 на wb')
        self.reject(lambda:decoded(p,wb_data([(1,1,100,'a')],{'from':'2026-09-01','to':'2026-09-30'})),'ROW_PERIOD')
    def test_event_sales_and_returns_separate(self):
        p=plan('фактические выкупы за вчера на wb');d=decoded(p,[event(),event('S2',price=50),event('R3',price=-20)])
        g=t.group_rows(d['rows'],p)['total'];self.assertEqual((g['units'],g['revenue'],g['return_units'],g['return_revenue']),(2,150,1,20))
        self.assertNotIn('srid',json.dumps(d));self.assertNotIn('private-must-not-persist',json.dumps(d));self.assertNotIn('S1',json.dumps(d))
    def test_event_zero_money_not_zero_revenue(self):
        p=plan('фактические выкупы за вчера на wb');d=decoded(p,[event(price=0)])
        self.assertIsNone(d['rows'][0]['revenue']);self.assertFalse(t.group_rows(d['rows'],p)['total']['money_complete'])
        self.assertIn('дозаполняется',' '.join(report(p,d['rows'])['pages']))
    def test_event_bad_return_sign(self):
        p=plan('фактические выкупы за вчера на wb');self.reject(lambda:decoded(p,[event('R1',price=10)]),'EVENT_PRICE_SIGN')
    def test_event_bad_sales_sign(self):
        p=plan('фактические выкупы за вчера на wb');self.reject(lambda:decoded(p,[event(price=-10)]),'EVENT_PRICE_SIGN')
    def test_event_wrong_day(self):
        p=plan('фактические выкупы за вчера на wb');self.reject(lambda:decoded(p,[event(day='2026-11-02')]),'EVENT_DATE_OR_ITEM')
    def test_event_moscow_day(self):
        p=plan('фактические выкупы за вчера на wb');e=event();e['date']='2026-11-02T22:30:00+00:00';self.assertTrue(decoded(p,[e])['complete'])
    def test_event_cursor_until_empty(self):
        p=plan('фактические выкупы за октябрь 2026 на wb');s=p['stores'][0];task=t.tasks(p,s)[0]
        d=t.decode([event('S1',day='2026-10-02'),event('R2',day='2026-11-02',price=-20)],p,s,task)
        self.assertFalse(d['complete']);self.assertEqual(len(d['progress']['rows']),1)
        req=t.build_task(p,s,task,d['progress']);self.assertEqual(req.body,{'dateFrom':'2026-11-02T15:00:00','flag':0})
        d=t.decode([],p,s,task,d['progress']);self.assertTrue(d['complete']);self.assertEqual(len(d['rows']),1)
    def test_event_duplicate_cursor(self):
        p=plan('фактические выкупы за октябрь 2026 на wb');s=p['stores'][0];task=t.tasks(p,s)[0];e=event(day='2026-10-02')
        d=t.decode([e],p,s,task);self.reject(lambda:t.decode([e],p,s,task,d['progress']),'EVENT_CURSOR_DUPLICATE')
    def test_event_cursor_stalled(self):
        p=plan('фактические выкупы за октябрь 2026 на wb')
        self.reject(lambda:decoded(p,[event(day='2026-10-01',update='2026-10-01T00:00:00')]),'EVENT_CURSOR_STALLED')
    def test_event_empty_is_zero(self):
        p=plan('фактические выкупы за вчера на wb');d=decoded(p,[]);self.assertEqual(t.group_rows(d['rows'],p)['total']['units'],0)
    def test_event_missing_days_filled_only_after_complete(self):
        p=plan('фактические выкупы по дням с 2026-10-01 по 2026-10-03 на wb');s=p['stores'][0];task=t.tasks(p,s)[0]
        d=t.decode([event(day='2026-10-02')],p,s,task);self.assertFalse(d['complete'])
        d=t.decode([],p,s,task,d['progress']);g=t.group_rows(d['rows'],p);self.assertEqual(len(g),3);self.assertEqual(g['2026-10-01']['units'],0)
    def test_ozon_missing_day_is_not_invented_zero(self):
        p=plan('сводка заказов по дням с 2026-10-01 по 2026-10-03 на озоне')
        self.reject(lambda:decoded(p,oz_data([('2026-10-01',1,10),('2026-10-03',1,10)])),'OZON_MISSING_DAYS')
    def test_weeks_preserve_totals(self):
        p=plan('сводка заказов по неделям с 2026-10-01 по 2026-10-03 на озоне')
        d=decoded(p,oz_data([('2026-10-01',1,10),('2026-10-02',2,20),('2026-10-03',3,30)]));g=t.group_rows(d['rows'],p)
        self.assertEqual(list(g),['2026-09-28']);self.assertEqual(g['2026-09-28']['revenue'],60)
    def test_compare_union_missing_current(self):
        p=plan('сравни товары за октябрь и сентябрь 2026 на озоне')
        d=decoded(p,oz_data([(11,2,200)]));prev=[{'key':'22','label':'gone','units':'3','revenue':'90'}]
        text=' '.join(report(p,d['rows'],prev)['pages']);self.assertIn('код 22',text);self.assertIn('изменение суммы -90',text)
    def test_capabilities_removed(self):
        d=t.parse_table('фактические выкупы за вчера на wb',TODAY)
        self.reject(lambda:t.make_table_plan(SCOPE,d,{}),'TABLE_SOURCE_NOT_QUALIFIED')
    def test_basic_token_denied(self):
        d=t.parse_table('фактические выкупы за вчера на wb',TODAY);c=caps();c['wb']['wb_event_sales']['token_class']='basic'
        self.reject(lambda:t.make_table_plan(SCOPE,d,c),'TOKEN_CLASS_NOT_QUALIFIED')
    def test_currency_unconfirmed(self):
        p=plan('фактические выкупы за вчера на wb');p['stores'][0]['currency']=None
        self.reject(lambda:decoded(p,[event()]),'TABLE_CURRENCY_UNKNOWN')
    def test_tampered_caps_not_valid(self):
        p=plan('фактические выкупы за вчера на wb');p['table_capabilities']={};self.assertFalse(t.valid(p))
    def test_render_duplicate_rows_denied(self):
        p=plan('фактические выкупы за вчера на wb');d=decoded(p,[event()]);self.reject(lambda:report(p,d['rows']*2),'ROW_DUPLICATE_OR_ID')
    def test_render_event_kind_counts_denied(self):
        p=plan('фактические выкупы за вчера на wb');d=decoded(p,[event()]);d['rows'][0]['units']='9';self.reject(lambda:report(p,d['rows']),'EVENT_KIND_COUNTS')
    def test_capacity_no_partial_ready(self):
        p=plan('топ 2 товаров по сумме заказов за октябрь 2026 на озоне')
        with patch.dict(t.CATALOG,{'max_rows':1}):self.reject(lambda:decoded(p,oz_data([(1,1,1),(2,1,1)])),'TABLE_CAPACITY')
    def test_no_old_history_claim(self):
        self.reject(lambda:plan('сводка заказов по дням за октябрь 2026 на wb'),'WB_SERIES_HISTORY_LIMIT')
    def test_event_history_bounded(self):
        self.reject(lambda:plan('фактические выкупы с 2026-08-01 по 2026-08-10 на wb'),'EVENT_HISTORY_LIMIT')
    def test_ozon_event_denied_no_substitution(self):
        self.reject(lambda:plan('фактические выкупы за вчера на озоне'),'OZON_EVENT_SOURCE_UNAVAILABLE')

class RowIntegration(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.clock=Clock();self.scope=SCOPE;self.cap=caps()
        self.repo=Repository(Path(self.tmp.name)/'state.sqlite',self.clock)
        self.engine=Engine(self.repo,lambda _:self.scope,table_capabilities=lambda:self.cap)
        self.transport=Transport();self.worker=Worker(self.engine,self.transport);self.seq=0
    def tearDown(self):self.tmp.cleanup()
    def send(self,q,rid=None,conversation='synthetic-conversation'):
        self.seq+=1
        return self.engine.safe_submit('A',q,rid or str(self.seq),fingerprint(q),TODAY,conversation_id=conversation,message_id=self.seq)
    def test_event_three_turns(self):
        self.assertTrue(self.send('дай продажи за вчера на wb')['clarification_required'])
        self.assertEqual(self.send('выкупы')['error'],'COHORT_REQUIRED')
        r=self.send('все что выкупили вчера блядь');self.assertEqual(r['state'],'QUEUED');self.worker.step()
        row=self.repo.get('A',r['job_id']);self.assertEqual(row['state'],'READY');self.assertEqual(len(self.transport.calls),1)
        p=strict_json(row['plan']);self.assertEqual(p['period']['from'],'2026-11-03');self.assertEqual(p['table']['family'],'events')
    def test_explicit_subset_after_unavailable_ozon(self):
        self.send('дай продажи за вчера');self.send('выкупы');r=self.send('все что выкупили вчера блядь')
        self.assertTrue(r['clarification_required']);self.assertEqual(r['error'],'OZON_EVENT_SOURCE_UNAVAILABLE');self.assertEqual(self.repo.call_count(),0)
        r=self.send('только WB');self.assertEqual(r['state'],'QUEUED');self.worker.step();row=self.repo.get('A',r['job_id'])
        self.assertEqual(row['state'],'READY');p=strict_json(row['plan']);self.assertEqual([s['platform'] for s in p['stores']],['wb']);self.assertEqual(p['period']['from'],'2026-11-03')
    def test_capability_revocation_before_worker(self):
        r=self.send('фактические выкупы за вчера на wb');self.cap={};self.worker.step();row=self.repo.get('A',r['job_id'])
        self.assertEqual(row['state'],'FAILED');self.assertEqual(self.repo.call_count(),0)
    def test_exact_cache_hit(self):
        q='топ 1 товаров по сумме заказов за октябрь 2026 на озоне';r=self.send(q);self.worker.step()
        r2=self.send(q);self.assertEqual(r2['cache'],'HIT');self.assertEqual(r2['job_id'],r['job_id']);self.assertEqual(self.repo.call_count(),1)
    def test_larger_top_is_new_job(self):
        self.send('топ 1 товаров по сумме заказов за октябрь 2026 на озоне');self.worker.step()
        r=self.send('топ 2 товаров по сумме заказов за октябрь 2026 на озоне');self.assertEqual(r['cache'],'NEW')
    def test_no_aggregation_cross_platform_product_ids(self):
        r=self.send('сводка заказов по товарам за октябрь 2026 на озоне и wb');self.worker.step();self.worker.step()
        row=self.repo.get('A',r['job_id']);self.assertEqual(row['state'],'READY');text=' '.join(strict_json(row['result'])['pages'])
        self.assertIn('Озон:',text);self.assertIn('Вайлдберриз:',text);self.assertEqual(text.count('код 11'),2)
    def test_retention_erases_rows(self):
        r=self.send('фактические выкупы за вчера на wb');self.worker.step();self.clock.advance(901);retention.sweep(self.repo)
        row=self.repo.get('A',r['job_id']);self.assertEqual(row['state'],'EXPIRED');self.assertIsNone(row['result']);self.assertIsNone(row['plan'])
    def test_cancel_before_first_call(self):
        r=self.send('фактические выкупы за вчера на wb');self.send('отмени отчет');self.worker.step();self.assertEqual(self.repo.get('A',r['job_id'])['state'],'CANCELLED');self.assertEqual(self.repo.call_count(),0)
    def test_table_does_not_use_deepseek(self):
        self.send('топ 1 товаров по сумме заказов за октябрь 2026 на wb');self.worker.step();self.assertEqual([x.operation for x in self.transport.calls],['wb_table_orders'])

REJECTED=[
 ('топ товаров по сумме заказов за октябрь 2026 на озоне','TOP_SIZE_REQUIRED'),
 ('топ 0 товаров по сумме заказов за октябрь 2026 на озоне','TOP_SIZE'),
 ('топ 21 товаров по сумме заказов за октябрь 2026 на озоне','TOP_SIZE'),
 ('топ 5 товаров по количеству заказов за октябрь 2026 на озоне','METRIC_AMBIGUOUS'),
 ('топ 5 товаров по прибыли за октябрь 2026 на озоне','TABLE_SCOPE_UNSUPPORTED'),
 ('топ 5 товаров по дрр за октябрь 2026 на озоне','TABLE_SCOPE_UNSUPPORTED'),
 ('сводка заказов по товарам за октябрь 2026 на озоне и wb всего','PRODUCT_NAMESPACE'),
 ('сводка заказов по дням за октябрь 2026 на озоне sku 11','SKU_TIME_SERIES_NOT_QUALIFIED'),
 ('сводка заказов по товарам за октябрь 2026 на wb sku 11','SKU_PLATFORM'),
 ('топ 5 по дням по сумме заказов за октябрь 2026 на озоне','RANK_SERIES_CONFLICT'),
 ('сравни сводка заказов по дням за октябрь и сентябрь 2026 на озоне','SERIES_COMPARISON_NOT_QUALIFIED'),
 ('сравни топ 5 товаров по сумме заказов за октябрь и сентябрь 2026 на озоне','TABLE_INTENT_INCOMPLETE'),
 ('топ 5 товаров по сумме заказов за октябрь 2026 на озоне кроме бренда X','OPERATION_NOT_ENABLED'),
 ('топ 5 товаров по сумме заказов за октябрь 2026 на озоне и не wb','OPERATION_NOT_ENABLED'),
 ('фактические выкупы за вчера на wb без возвратов','EVENT_RETURNS_NOT_ENABLED'),
]
for i,(q,code) in enumerate(REJECTED):
    def test(self,q=q,code=code):self.reject(lambda:t.parse_table(q,TODAY),code)
    setattr(TableTests,f'test_negative_phrase_{i:02}',test)

class RowTransportTests(unittest.TestCase):
    def setUp(self):
        import base64
        from http_transport import HTTPTransport
        from registry import REGISTRY_HASH
        self.tmp=tempfile.TemporaryDirectory();self.dir=Path(self.tmp.name);self.calls=[]
        self.claims={'acc':3,'for':'self','t':False};self.base64=base64
        self.put_token()
        (self.dir/'ozon').write_text(json.dumps({'seller_client_id':'synthetic-client','seller_api_key':'synthetic-not-real-key'}))
        self.proofs={op:{'status':'READ_ONLY_CANARY','registry_hash':REGISTRY_HASH,'table_hash':t.HASH,'evidence_ref':'synthetic-only'} for op in t.OPERATIONS}
        self.tr=HTTPTransport(str(self.dir),{'wb':'wb','oz':'ozon'},self.proofs,enabled=True)
    def tearDown(self):self.tmp.cleanup()
    def put_token(self):
        payload=self.base64.urlsafe_b64encode(json.dumps(self.claims).encode()).decode().rstrip('=')
        (self.dir/'wb').write_text(json.dumps({'seller_token':'synthetic.'+payload+'.synthetic-signature'}))
    def request(self,q='фактические выкупы за вчера на wb'):
        p=plan(q);s=p['stores'][0];return t.build_task(p,s,t.tasks(p,s)[0]),s
    def fake(self):
        outer=self
        class Response:
            status=200
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def __init__(self):
                import io
                self.body=io.BytesIO(b'[]')
            def read1(self,n):return self.body.read1(n)
        class Opener:
            def open(self,req,timeout):outer.calls.append(req);return Response()
        return Opener()
    def test_event_get_query(self):
        req,store=self.request()
        with patch('urllib.request.build_opener',return_value=self.fake()):data,meta=self.tr.execute(req,store)
        self.assertEqual(data,[]);self.assertEqual(self.calls[0].method,'GET');self.assertIn('dateFrom=2026-11-03&flag=1',self.calls[0].full_url);self.assertIsNone(self.calls[0].data)
    def test_range_cursor_get(self):
        req,store=self.request('фактические выкупы за октябрь 2026 на wb')
        with patch('urllib.request.build_opener',return_value=self.fake()):self.tr.execute(req,store)
        self.assertIn('flag=0',self.calls[0].full_url)
    def test_new_proof_hash_required(self):
        from engine import CallError
        req,store=self.request();self.tr.qualifications['wb_event_sales']['table_hash']='wrong'
        with self.assertRaises(CallError) as e:self.tr.execute(req,store)
        self.assertEqual(e.exception.code,'TABLE_DECODER_NOT_QUALIFIED')
    def test_missing_proof_denied(self):
        from engine import CallError
        req,store=self.request();self.tr.qualifications={}
        with self.assertRaises(CallError) as e:self.tr.execute(req,store)
        self.assertEqual(e.exception.code,'DECODER_NOT_LIVE_QUALIFIED')
    def test_personal_token_class_checked(self):
        from engine import CallError
        req,store=self.request();self.claims['acc']=1;self.put_token()
        with self.assertRaises(CallError) as e:self.tr.execute(req,store)
        self.assertEqual(e.exception.code,'TOKEN_CLASS_REQUALIFICATION_REQUIRED')
    def test_sandbox_token_denied(self):
        from engine import CallError
        req,store=self.request();self.claims['t']=True;self.put_token()
        with self.assertRaises(CallError) as e:self.tr.execute(req,store)
        self.assertEqual(e.exception.code,'TOKEN_CLASS_REQUALIFICATION_REQUIRED')
    def test_string_false_not_boolean_false(self):
        from engine import CallError
        req,store=self.request();self.claims['t']='false';self.put_token()
        with self.assertRaises(CallError):self.tr.execute(req,store)
    def test_wrong_store_binding(self):
        from engine import CallError
        req,store=self.request();store={**store,'id':'other'}
        with self.assertRaises(CallError) as e:self.tr.execute(req,store)
        self.assertEqual(e.exception.code,'CREDENTIAL_SCOPE')
    def test_flag_bool_denied(self):
        from engine import CallError
        req,store=self.request();req=replace(req,body={**req.body,'flag':True})
        with self.assertRaises(CallError) as e:self.tr.execute(req,store)
        self.assertEqual(e.exception.code,'QUERY_SCHEMA')
    def test_ozon_table_same_analytics_quota(self):
        req,store=self.request('топ 1 товаров по сумме заказов за октябрь 2026 на озоне')
        self.assertTrue(req.source.endswith(':ozon_orders'));self.assertEqual(req.interval,61)
        with patch('urllib.request.build_opener',return_value=self.fake()):self.tr.execute(req,store)
        self.assertEqual(self.calls[0].method,'POST');self.assertEqual(json.loads(self.calls[0].data)['dimension'],['sku'])
    def test_zero_live_disabled(self):
        from engine import CallError
        req,store=self.request();self.tr.enabled=False
        with self.assertRaises(CallError) as e:self.tr.execute(req,store)
        self.assertEqual(e.exception.code,'LIVE_DISABLED')
    def test_503_is_not_automatic_retry(self):
        from engine import CallError
        from urllib.error import HTTPError
        req,store=self.request();opener=self.fake()
        with patch.object(opener,'open',side_effect=HTTPError(req.operation,503,'error',{},None)) as call,patch('urllib.request.build_opener',return_value=opener):
            with self.assertRaises(CallError) as e:self.tr.execute(req,store)
        self.assertEqual(e.exception.status,503);self.assertEqual(call.call_count,1)

if __name__=='__main__':unittest.main()
