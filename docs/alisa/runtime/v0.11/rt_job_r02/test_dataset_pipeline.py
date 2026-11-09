"""Offline synthetic regression for generic dataset sources and queue integration."""
from pathlib import Path
from datetime import date,datetime,timezone
from decimal import Decimal
from unittest.mock import patch
import sys,json,copy,tempfile,socket,unittest,hashlib
ROOT=Path(__file__).parent;sys.path.insert(0,str(ROOT))
import dataset_pipeline as dp
from matrix_sources import SourceMatrix
from matrix_core import MatrixError,evaluate
from semantics import Scope,Store,Rejected,fingerprint,strict_json
from repository import Repository
from engine import Engine,Worker
SCOPE=Scope('fixture','rev',(Store('o','ozon','o','a','s','RUB'),Store('w','wb','w','a','s','RUB')))
TODAY=date(2026,11,5);DAY={'from':'2026-11-04','to':'2026-11-04'}
def caps():return {s.id:{op:{'status':'READ_ONLY_CANARY','dataset_source_hash':dp.SOURCES.hash,'dataset_query_hash':dp.HASH,'evidence_ref':'synthetic-only',**d['proof_requirements']} for op,d in dp.SOURCES.sources.items() if d['platform']==s.platform} for s in SCOPE.stores}
def amount(v):return {'amount':str(v),'currency':'RUB'}
def accrual(day='2026-11-04',aid=1):
 return {'accruals':[{'accrual_id':aid,'date':day,'total_amount':amount(180),'posting':{'products':[{'sku':101,'quantity':2,'commission':{'seller_price':amount(100),'sale_price':amount(160),'sale_amount':amount(200),'bonus':amount(40),'coinvestment':amount(0),'sale_commission':amount(-20)},'delivery':None}]}}],'last_id':''}
def fixture(op,body):
 if op=='ds_ozon_products':return {'result':{'items':[{'product_id':1,'offer_id':'fixture','sku':101}],'total_items':1,'last_id':''}}
 if op=='ds_ozon_prices':return {'items':[{'product_id':1,'offer_id':'fixture','price':{'price':'100','marketing_seller_price':'90','currency_code':'RUB'}}],'total_items':1,'cursor':''}
 if op=='ds_wb_prices':return {'data':{'listGoods':[] if body['offset'] else [{'nmID':2,'vendorCode':'fixture-w','currencyIsoCode4217':'RUB','sizes':[{'sizeID':3,'techSizeName':'0','price':120,'discountedPrice':100,'clubDiscountedPrice':95}]}]},'error':False}
 if op=='ds_wb_products':return {'cards':[{'nmID':2,'vendorCode':'fixture-w','title':'Тест','brand':'Марка'}],'cursor':{'total':1}}
 if op=='ds_wb_campaigns':return {'adverts':[{'status':9,'advert_list':[{'advertId':44}]}],'all':1}
 if op=='ds_wb_adstats':return [{'advertId':44,'views':30,'clicks':4,'orders':1,'shks':2,'sum_price':200,'sum':20}]
 if op in ('ds_ozon_fbo_postings','ds_ozon_fbs_postings'):
  kind='fbo' if 'fbo' in op else 'fbs'
  return {'has_next':False,'cursor':'nonempty-terminal-token','postings':[{'posting_number':'fixture-'+kind,'created_at':'2026-11-04T03:00:00Z' if kind=='fbo' else None,'in_process_at':'2026-11-04T03:00:00Z','status':'delivered','analytics_data':{'payment_type_group_name':'Ozon Банк'},'products':[{'sku':101,'quantity':2}]}]}
 if op=='ds_ozon_accrual_rows':return accrual(body['date'],int(body['date'][-2:]))
 if op=='ds_ozon_accrual_join_rows':
  value=accrual(body['date'],int(body['date'][-2:]));value['accruals'][0]['unit_number']='fixture-join';return value
 if op in ('ds_ozon_fbo_join_items','ds_ozon_fbs_join_items'):
  rows=[]
  if op=='ds_ozon_fbo_join_items' and body['filter']['since']<='2026-11-04T10:00:00Z'<=body['filter']['to']:
   rows=[{'posting_number':'fixture-join','created_at':'2026-11-04T10:00:00Z','analytics_data':{'payment_type_group_name':'Ozon Банк'},'products':[{'sku':101,'quantity':2}]}]
  return {'postings':rows,'has_next':False,'cursor':''}
 raise AssertionError(op)
class Clock:
 def __init__(self):self.t=datetime(2026,11,5,8,tzinfo=timezone.utc).timestamp()
 def __call__(self):return self.t
class Transport:
 def __init__(self):self.calls=[];self.error=None
 def execute(self,req,store):
  self.calls.append(req.record())
  if self.error:raise self.error
  body=fixture(req.operation,req.body)
  return body,{'status':200,'elapsed_ms':1,'bytes':len(json.dumps(body))}
class Pipeline(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.clock=Clock();self.caps=caps()
  self.repo=Repository(Path(self.temp.name)/'db.sqlite',self.clock)
  self.engine=Engine(self.repo,lambda _:SCOPE,dataset_capabilities=lambda:self.caps)
  self.transport=Transport();self.worker=Worker(self.engine,self.transport)
 def tearDown(self):self.temp.cleanup()
 def submit(self,q,rid='request'):
  return self.engine.safe_submit(SCOPE.tenant,q,rid,fingerprint(q),TODAY)
 def finish(self,q):
  a=self.submit(q);self.assertNotIn('error',a,a)
  for _ in range(20):
   row=self.repo.get(SCOPE.tenant,a['job_id'])
   if row['state']not in ('QUEUED','RUNNING'):break
   self.clock.t+=62;self.worker.step()
  row=self.repo.get(SCOPE.tenant,a['job_id']);self.assertEqual(row['state'],'READY',row['error'])
  return a,strict_json(row['result'])
 def test_weighted_average(self):
  a,r=self.finish('товарные начисления по товарам с 4 по 4 ноября 2026 на озоне')
  self.assertIn('средняя на товар: 80',r['pages'][0]);self.assertNotIn('320',r['pages'][0])
 def test_two_days_accumulate_without_averaging_averages(self):
  a,r=self.finish('товарные начисления по дням с 3 по 4 ноября 2026 на озоне')
  self.assertEqual(len(self.transport.calls),2);self.assertIn('2026-11-03',r['pages'][0]);self.assertIn('2026-11-04',r['pages'][0])
 def test_empty_page_needed_for_wb_price(self):
  a,r=self.finish('текущие цены предложения сейчас на wb');self.assertEqual(len(self.transport.calls),2);self.assertEqual(self.transport.calls[1]['body']['offset'],1000)
 def test_posting_both_schemes(self):
  a,r=self.finish('метаданные отправлений с 4 по 4 ноября 2026 на озоне');self.assertEqual(len(self.transport.calls),2);self.assertIn('схема: fbo',r['pages'][0]);self.assertIn('схема: fbs',r['pages'][0])
 def test_ads_prerequisite(self):
  a,r=self.finish('статистика активных рекламных кампаний с 4 по 4 ноября 2026 на wb');self.assertEqual(len(self.transport.calls),2);self.assertEqual(self.transport.calls[1]['body']['ids'],'44')
 def test_cache_no_new_calls(self):
  q='справочник товаров сейчас на озоне';a,r=self.finish(q);n=len(self.transport.calls);b=self.submit(q,'repeat');self.assertEqual(b['cache'],'HIT');self.assertEqual(b['job_id'],a['job_id']);self.worker.step();self.assertEqual(len(self.transport.calls),n)
 def test_read_no_calls(self):
  a,r=self.finish('справочник товаров сейчас на wb');n=len(self.transport.calls)
  for i in range(3):self.submit('результат','read'+str(i))
  self.assertEqual(len(self.transport.calls),n)
 def test_restart_mid_pagination(self):
  a=self.submit('текущие цены предложения сейчас на wb');self.worker.step()
  self.assertEqual(self.repo.get(SCOPE.tenant,a['job_id'])['state'],'QUEUED')
  new=Engine(Repository(self.repo.path,self.clock),lambda _:SCOPE,dataset_capabilities=lambda:self.caps);worker=Worker(new,self.transport);self.clock.t+=62;worker.step()
  self.assertEqual(self.repo.get(SCOPE.tenant,a['job_id'])['state'],'READY')
 def test_cancel_between_stages(self):
  a=self.submit('метаданные отправлений с 4 по 4 ноября 2026 на озоне');self.worker.step();self.submit('отмени отчет','cancel');self.clock.t+=62;self.worker.step();self.assertEqual(len(self.transport.calls),1)
 def test_revoke_before_call(self):
  self.submit('справочник товаров сейчас на озоне');self.caps['o']={};self.worker.step();self.assertEqual(len(self.transport.calls),0)
 def test_revoke_before_read(self):
  self.finish('справочник товаров сейчас на озоне');self.caps['o']={};a=self.submit('результат','read');self.assertIn('Доступ',a['text'])
 def test_proven_read_unknown_resumes_same_job(self):
  from engine import CallError
  self.transport.error=CallError('NETWORK_OUTCOME_UNKNOWN',unknown=True)
  a=self.submit('справочник товаров сейчас на озоне');self.worker.step()
  self.assertEqual(self.repo.get(SCOPE.tenant,a['job_id'])['state'],'QUEUED')
  self.clock.t+=1000;self.worker.step();self.assertEqual(len(self.transport.calls),2)
  self.assertEqual(self.repo.get(SCOPE.tenant,a['job_id'])['state'],'QUEUED')
 def test_unqualified_unknown_still_never_retried(self):
  from engine import CallError
  from unittest.mock import patch
  self.transport.error=CallError('NETWORK_OUTCOME_UNKNOWN',unknown=True)
  a=self.submit('справочник товаров сейчас на озоне')
  with patch('request_recovery.repeat_safe',return_value=False):
   self.worker.step();self.clock.t+=1000;self.worker.step()
  self.assertEqual(len(self.transport.calls),1)
  self.assertEqual(self.repo.get(SCOPE.tenant,a['job_id'])['state'],'UNKNOWN')
 def test_fake_current_price_not_historical(self):self.assertTrue(self.submit('текущие цены предложения за октябрь 2026 на озоне').get('error'))
 def test_unknown_filter_not_dropped(self):self.assertTrue(self.submit('справочник товаров сейчас на озоне кроме артикула А').get('error'))
 def test_other_platform_not_dropped(self):self.assertEqual(self.submit('товарные начисления по товарам с 4 по 4 ноября 2026 на озоне и wb').get('error'),'DATASET_PLATFORM_UNAVAILABLE')
 def test_period_budget(self):self.assertEqual(self.submit('товарные начисления по дням с 2026-09-01 по 2026-11-04 на озоне').get('error'),'DATASET_PERIOD_LIMIT')
 def test_compiled_filter_tamper(self):
  a=self.submit('справочник товаров сейчас на wb');p=strict_json(self.repo.get(SCOPE.tenant,a['job_id'])['plan']);p['filters']={'nm_ids':[123]};self.assertFalse(self.engine.authorized(p))
 def test_compiled_comparison_tamper(self):
  a=self.submit('товарные начисления по дням с 4 по 4 ноября 2026 на озоне');p=strict_json(self.repo.get(SCOPE.tenant,a['job_id'])['plan']);p['comparison']={'from':'2026-11-03','to':'2026-11-03'};self.assertFalse(self.engine.authorized(p))
 def test_unqualified_source(self):self.caps['o']['ds_ozon_products']['dataset_source_hash']='bad';self.assertEqual(self.submit('справочник товаров сейчас на озоне').get('error'),'DATASET_NOT_QUALIFIED')
 def test_plan_tampering(self):
  a=self.submit('справочник товаров сейчас на озоне');p=strict_json(self.repo.get(SCOPE.tenant,a['job_id'])['plan']);p['dataset']['id']='offer_prices';self.assertFalse(self.engine.authorized(p))
 def test_snapshot_not_mixed_with_period(self):self.assertTrue(self.submit('справочник товаров с 4 по 4 ноября 2026 на озоне').get('error'))
 def test_source_values_not_commands(self):self.assertIsNone(dp.parse_request('бренд «справочник товаров»',TODAY))

def route_case(qid,platform,phrase):
 def test(self):
  q=dp.CATALOG['queries'][qid];text=phrase+(' сейчас' if q['snapshot'] else ' с 4 по 4 ноября 2026')+' на '+('озоне' if platform=='ozon' else 'wb')
  a,r=self.finish(text);self.assertTrue(r['complete']);self.assertTrue(all(len(s)<=900 for s in r['pages']))
 return test
n=0
for qid,q in dp.CATALOG['queries'].items():
 for plat in q['flows']:
  for phrase in q['phrases']:setattr(Pipeline,'test_route_'+str(n),route_case(qid,plat,phrase));n+=1

class SourceGuards(unittest.TestCase):
 def decode(self,op,body,page=None,matrix=None):
  m=matrix or dp.SOURCES;s=m.recipe(op);store={'id':'fixture','platform':s['platform'],'identity':'fixture','currency':'RUB'}
  plan={'table':{'view':'dataset'},'filters':{},'table_params':{'campaigns':[44]}}
  return m.decode(op,body,plan,store,{'period':DAY},page)
 def bad(self,op,body,code=None):
  with self.assertRaises(MatrixError) as e:self.decode(op,body)
  if code:self.assertEqual(e.exception.code,code)
 def test_total_items_only(self):self.assertTrue(self.decode('ds_ozon_products',fixture('ds_ozon_products',{}))['complete'])
 def test_legacy_total_only(self):
  d=fixture('ds_ozon_products',{});d['result']['total']=d['result'].pop('total_items');self.assertTrue(self.decode('ds_ozon_products',d)['complete'])
 def test_total_disagreement(self):
  d=fixture('ds_ozon_products',{});d['result']['total']=2;self.bad('ds_ozon_products',d,'DATASET_TOTAL_CHANGED')
 def test_cursor_does_not_advance(self):
  d=fixture('ds_ozon_products',{});d['result']['total_items']=2;self.bad('ds_ozon_products',d,'DATASET_CURSOR')
 def test_has_next_false_nonempty_cursor(self):self.assertTrue(self.decode('ds_ozon_fbo_postings',fixture('ds_ozon_fbo_postings',{}))['complete'])
 def test_has_next_true_empty_cursor(self):
  d=fixture('ds_ozon_fbo_postings',{});d.update(has_next=True,cursor='');self.bad('ds_ozon_fbo_postings',d,'DATASET_CURSOR')
 def test_missing_has_next(self):
  d=fixture('ds_ozon_fbo_postings',{});d.pop('has_next');self.bad('ds_ozon_fbo_postings',d)
 def test_false_payment_not_inferred(self):
  d=fixture('ds_ozon_fbo_postings',{});d['postings'][0]['analytics_data']=None;self.assertEqual(self.decode('ds_ozon_fbo_postings',d)['rows'][0]['payment'],'unknown')
 def test_fbs_missing_create_date_not_fabricated(self):self.assertIsNone(self.decode('ds_ozon_fbs_postings',fixture('ds_ozon_fbs_postings',{}))['rows'][0]['created_day'])
 def test_duplicate_posting(self):
  d=fixture('ds_ozon_fbo_postings',{});d['postings']*=2;self.bad('ds_ozon_fbo_postings',d,'DATASET_DUPLICATE')
 def test_size_currency_changed(self):
  d=fixture('ds_wb_prices',{'offset':0});d['data']['listGoods'][0]['currencyIsoCode4217']='USD';self.bad('ds_wb_prices',d,'DATASET_CURRENCY')
 def test_sizes_not_flattened_into_one_product_price(self):
  d=fixture('ds_wb_prices',{'offset':0});x=copy.deepcopy(d['data']['listGoods'][0]['sizes'][0]);x['sizeID']=4;x['price']=150;d['data']['listGoods'][0]['sizes'].append(x)
  result=self.decode('ds_wb_prices',d);self.assertEqual(len(result['progress']['rows']),2)
 def test_duplicate_size(self):
  d=fixture('ds_wb_prices',{'offset':0});d['data']['listGoods'][0]['sizes']*=2;self.bad('ds_wb_prices',d,'DATASET_SIZE_DUPLICATE')
 def test_no_null_to_zero_ads(self):self.bad('ds_wb_adstats',None,'TABLE_RESPONSE_SCHEMA')
 def test_missing_campaign(self):self.bad('ds_wb_adstats',[],'DATASET_CAMPAIGN_COVERAGE')
 def test_foreign_campaign(self):
  d=fixture('ds_wb_adstats',{});d[0]['advertId']=45;self.bad('ds_wb_adstats',d,'DATASET_CAMPAIGN_SCOPE')
 def test_missing_clicks(self):
  d=fixture('ds_wb_adstats',{});d[0].pop('clicks');self.bad('ds_wb_adstats',d)
 def test_catalog_operator_not_importable(self):
  d=dp.SOURCES.definition;d['sources']['ds_ozon_products']['request']={'$fn':['eval','1']}
  with self.assertRaises(MatrixError):SourceMatrix(d)
 def test_private_origin_rejected(self):
  d=dp.SOURCES.definition;d['sources']['ds_ozon_products']['url']='http://127.0.0.1/'
  with self.assertRaises(MatrixError):SourceMatrix(d)
 def test_credential_not_decodable(self):
  d=dp.SOURCES.definition;d['sources']['ds_ozon_products']['response']['map']={'key':{'$path':['credentials','key']}}
  with self.assertRaises(MatrixError):SourceMatrix(d)
 def test_flatten_bounded(self):
  with self.assertRaises(MatrixError):evaluate({'$fn':['flatten',{'$path':['input']}]},{'input':[list(range(20000)),[1]]})
 def test_csv_injection_rejected(self):
  with self.assertRaises(MatrixError):evaluate({'$fn':['csv_ids',['1&extra=bad']]},{})
 def test_day_boundary(self):self.assertEqual(evaluate({'$fn':['utc_day_boundary','2026-11-04','Europe/Moscow',False]},{}),'2026-11-03T21:00:00Z')
 def test_wrong_date(self):
  d=accrual();d['accruals'][0]['date']='2026-11-03';self.bad('ds_ozon_accrual_rows',d,'ACCRUAL_DATE')
 def test_duplicate_accrual(self):
  d=accrual();d['accruals']*=2;self.bad('ds_ozon_accrual_rows',d,'ACCRUAL_DUPLICATE')
 def test_no_double_multiply(self):
  rows=self.decode('ds_ozon_accrual_rows',accrual())['rows'];self.assertEqual(rows[0]['sale_amount'],'160');self.assertEqual(rows[0]['sale_units'],'2')
 def test_bad_line_sum(self):
  d=accrual();d['accruals'][0]['posting']['products'][0]['commission']['sale_amount']=amount(100);self.bad('ds_ozon_accrual_rows',d,'ACCRUAL_UNIT_LINE')
 def test_signed_reversal(self):
  d=accrual();a=d['accruals'][0];a['total_amount']=amount(-180)
  for m in a['posting']['products'][0]['commission'].values():m['amount']=str(-Decimal(m['amount']))
  row=self.decode('ds_ozon_accrual_rows',d)['rows'][0];self.assertEqual(row['reversal_amount'],'160');self.assertEqual(row['sale_amount'],'0')
if __name__=='__main__':
 with patch.object(socket.socket,'connect',side_effect=AssertionError('TCP_FORBIDDEN')),patch.object(socket,'getaddrinfo',side_effect=AssertionError('DNS_FORBIDDEN')):
  result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromModule(sys.modules[__name__]))
 report={'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped),'network_calls':0,'status':'PASS' if result.wasSuccessful() else 'FAIL','source_hash':dp.SOURCES.hash,'query_hash':dp.HASH}
 print(json.dumps(report));raise SystemExit(0 if result.wasSuccessful() else 1)
