"""Independent expected finance signs, coverage and asynchronous snapshot behavior."""
import copy,json,unittest,tempfile
from pathlib import Path
from datetime import timedelta
from decimal import Decimal
from dataclasses import replace
from test_runtime import TODAY,Clock,SCOPE
from test_extended_matrix import ExtendedTransport
from semantics import parse,make_plan,Rejected,fingerprint
from repository import Repository
from engine import Engine,Worker,CallError
from registry import DEFINITIONS,base_metrics,REGISTRY_HASH
import providers,finance_stock
TASK='11111111-2222-3333-4444-555555555555'
def money(v,c='RUB'):return {'value':v,'currency_code':c}
def oz_finance():
 return {'total':{'opening_balance':money(100),'closing_balance':money(200),'accrued':money(900),'payments':[money(800)]},'cashflows':{'sales':{'amount':money(1000),'fee':money(-100)},'returns':{'amount':money(-50),'fee':money(5)},'services':[{'name':n,'amount':money(v)} for n,v in [('product_placement_in_ozon_warehouses',-30),('temporary_placement_agent',-15),('logistics',-20),('reverse_logistics',2),('acquiring',-10),('unclassified-but-counted-service',-7)]]}}
def wb_finance(period):
 a=TODAY.fromisoformat(period['from']);b=TODAY.fromisoformat(period['to']);out=[]
 for i in range((b-a).days+1):
  d=(a+timedelta(days=i)).isoformat();r={'reportId':10**20+i,'dateFrom':d,'dateTo':d,'currency':'RUB'}
  r.update({v:('100' if k=='finance_sales' else '1') for k,v in finance_stock.WB_FIELDS.items()});out.append(r)
 return out
def oz_stocks():
 return {'items':[{'product_id':1,'stocks':[{'type':'fbo','sku':10,'shipment_type':'GENERAL','present':10,'reserved':2},{'type':'fbs','sku':10,'shipment_type':'GENERAL','present':5,'reserved':1}]},{'product_id':2,'stocks':[]}],'total':2,'total_items':2,'cursor':'terminal-cursor-can-be-nonempty'}
def wb_stocks():
 return [{'nmId':1,'warehouses':[{'warehouseName':'Всего находится на складах','quantity':10},{'warehouseName':'Тула','quantity':6},{'warehouseName':'Котовск','quantity':4},{'warehouseName':'В пути до получателей','quantity':3}]},{'nmId':2,'warehouses':[{'warehouseName':'В пути возвраты на склад WB','quantity':2}]}]
class FinancialTransport(ExtendedTransport):
 def __init__(self):super().__init__();self.polls=0;self.not_ready=False
 def execute(self,r,s):
  if r.operation in ('ozon_finance','wb_finance','ozon_stocks','wb_stocks_create','wb_stocks_status','wb_stocks_download','wb_balance'):
   self.calls.append(r)
   if self.fail:raise self.fail
   if r.operation=='ozon_finance':d=oz_finance()
   elif r.operation=='wb_finance':d=wb_finance({'from':r.body['dateFrom'],'to':r.body['dateTo']})
   elif r.operation=='ozon_stocks':d=oz_stocks()
   elif r.operation=='wb_stocks_create':d={'data':{'taskId':TASK}}
   elif r.operation=='wb_stocks_status':self.polls+=1;d={'data':{'id':TASK,'status':'processing' if self.not_ready and self.polls<2 else 'done'}}
   elif r.operation=='wb_stocks_download':d=wb_stocks()
   else:d={'currency':'RUB','current':-100,'for_withdraw':20}
   return d,{'status':200,'elapsed_ms':1,'bytes':500}
  return super().execute(r,s)
class FinanceStock(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.clock=Clock();self.repo=Repository(Path(self.temp.name)/'db',self.clock)
  self.engine=Engine(self.repo,lambda t:SCOPE);self.transport=FinancialTransport();self.worker=Worker(self.engine,self.transport);self.seq=0
 def tearDown(self):self.temp.cleanup()
 def submit(self,q):
  self.seq+=1;return self.engine.submit('A',q,'fs'+str(self.seq),fingerprint(q),TODAY)
 def done(self,q):
  request=self.submit(q)
  for _ in range(30):
   row=self.repo.get('A',request['job_id'])
   if row['state'] not in ('QUEUED','RUNNING'):break
   self.worker.step();self.clock.advance(62)
  row=self.repo.get('A',request['job_id']);self.assertEqual(row['state'],'READY',row['error'])
  return json.loads(row['result']),row
 def plan(self,q):
  d=parse(q,TODAY)
  if d.get('snapshot'):d['snapshot_slot']=int(self.clock()//300)
  return make_plan(SCOPE,d,d['metrics'])
 def reject(self,code,fn):
  with self.assertRaises(Rejected) as x:fn()
  self.assertEqual(x.exception.code,code)
 def test_ozon_finance_bundle_one_call(self):
  r,_=self.done('финансовая сводка за октябрь на озоне');self.assertEqual([x.operation for x in self.transport.calls],['ozon_finance']);v=r['data'][0]['values']
  self.assertEqual(v['finance_commission_cost'],'95');self.assertEqual(v['finance_storage_cost'],'45');self.assertEqual(v['finance_logistics_cost'],'18');self.assertEqual(v['finance_services_cost'],'80');self.assertEqual(v['finance_return_amount'],'-50')
 def test_wb_finance_one_month_one_request(self):
  r,_=self.done('финансовая сводка за октябрь на wb');self.assertEqual(len(self.transport.calls),1);v=r['data'][0]['values'];self.assertEqual(v['finance_sales'],'3100');self.assertEqual(v['finance_storage_cost'],'31')
 def test_common_finance_separate_sources(self):
  r,_=self.done('хранение и логистика за октябрь на озоне и wb');self.assertEqual(len(self.transport.calls),2);self.assertEqual(len(r['data']),2)
 def test_cross_market_financial_total_rejected(self):
  self.reject('FINANCIAL_SOURCE_BASIS',lambda:self.submit('хранение за октябрь на озоне и wb всего'));self.assertEqual(self.repo.call_count(),0)
 def test_finance_filter_not_ignored(self):
  self.reject('FILTER_SOURCE_NOT_SUPPORTED',lambda:self.submit('хранение за октябрь по артикулу WB 123 на wb'))
 def test_profit_is_missing_cost_not_zero(self):
  self.reject('MISSING_COST_BASIS',lambda:self.submit('прибыль за октябрь на озоне'));self.assertEqual(self.repo.call_count(),0)
 def test_missing_daily_report_fails(self):
  p=self.plan('хранение за октябрь на wb');t=providers.tasks(p,p['stores'][0])[0];d=wb_finance(t['period'])[:-1]
  self.reject('FINANCIAL_REPORT_NOT_READY',lambda:finance_stock.decode_wb_finance(d,t,p['stores'][0]))
 def test_empty_finance_not_zero(self):
  p=self.plan('хранение за октябрь на wb');t=providers.tasks(p,p['stores'][0])[0]
  self.reject('FINANCIAL_REPORT_NOT_READY',lambda:finance_stock.decode_wb_finance([],t,p['stores'][0]))
 def test_duplicate_report_rejected(self):
  p=self.plan('хранение за октябрь на wb');t=providers.tasks(p,p['stores'][0])[0];d=wb_finance(t['period']);d.append(d[0])
  self.reject('WB_FINANCE_DUPLICATE',lambda:finance_stock.decode_wb_finance(d,t,p['stores'][0]))
 def test_finance_currency_rejected(self):
  p=self.plan('хранение за октябрь на wb');t=providers.tasks(p,p['stores'][0])[0];d=wb_finance(t['period']);d[0]['currency']='USD'
  self.reject('FINANCE_CURRENCY_CHANGED',lambda:finance_stock.decode_wb_finance(d,t,p['stores'][0]))
 def test_finance_correction_sign_preserved(self):
  p=self.plan('хранение за октябрь на озоне');t=providers.tasks(p,p['stores'][0])[0];d=oz_finance();d['cashflows']['services'][0]['amount']['value']=100
  r=finance_stock.decode_ozon_finance(d,t,p['stores'][0]);self.assertEqual(r['values']['finance_storage_cost'],'-85')
 def test_ozon_missing_amount_fails(self):
  p=self.plan('хранение за октябрь на озоне');t=providers.tasks(p,p['stores'][0])[0];d=oz_finance();del d['cashflows']['services'][0]['amount']
  self.reject('OZON_FINANCE_SCHEMA',lambda:finance_stock.decode_ozon_finance(d,t,p['stores'][0]))
 def test_finance_negative_aggregate(self):
  p=self.plan('реализация по финансовым отчетам за октябрь на wb');t=providers.tasks(p,p['stores'][0])[0];d=wb_finance(t['period']);d[0]['retailAmountSum']='-5000'
  r=finance_stock.decode_wb_finance(d,t,p['stores'][0]);self.assertEqual(r['values']['finance_sales'],'-2000')
 def test_ozon_stocks_current(self):
  r,row=self.done('остатки на складах площадки и остатки на складах продавца сейчас на озоне');self.assertEqual(len(self.transport.calls),1);self.assertEqual(r['data'][0]['values'],{'stock_fbo_units':'10','stock_fbs_units':'5'});self.assertIn('Текущий снимок',r['pages'][0]);self.assertEqual(row['expires']-row['updated'],300)
 def test_stock_reserve_not_subtracted_twice(self):
  r,_=self.done('остатки на складах площадки и зарезервировано на складах площадки на озоне');self.assertEqual(r['data'][0]['values'],{'stock_fbo_reserved':'2','stock_fbo_units':'10'})
 def test_ozon_total_cursor_complete(self):
  p=self.plan('остатки на складах площадки на озоне');t=providers.tasks(p,p['stores'][0])[0];r=finance_stock.decode_ozon_stocks(oz_stocks(),t);self.assertTrue(r['complete'])
 def test_ozon_total_mismatch(self):
  p=self.plan('остатки на складах площадки на озоне');t=providers.tasks(p,p['stores'][0])[0];d=oz_stocks();d['total_items']=3
  self.reject('OZON_STOCK_TOTAL_CHANGED',lambda:finance_stock.decode_ozon_stocks(d,t))
 def test_ozon_stock_pagination(self):
  p=self.plan('остатки на складах площадки на озоне');t=providers.tasks(p,p['stores'][0])[0];d=oz_stocks();second=d['items'].pop();first=finance_stock.decode_ozon_stocks(d,t);self.assertFalse(first['complete']);d['items']=[second];done=finance_stock.decode_ozon_stocks(d,t,first['progress']);self.assertTrue(done['complete']);self.assertEqual(done['values']['stock_fbo_units'],'10')
 def test_stock_duplicate_page(self):
  p=self.plan('остатки на складах площадки на озоне');t=providers.tasks(p,p['stores'][0])[0];d=oz_stocks();d['items'].pop();first=finance_stock.decode_ozon_stocks(d,t)
  self.reject('OZON_STOCK_DUPLICATE',lambda:finance_stock.decode_ozon_stocks(d,t,first['progress']))
 def test_wb_async_three_steps(self):
  r,_=self.done('остатки на складах площадки и товаров в пути до покупателей и возвратов в пути на склад сейчас на wb');self.assertEqual([x.operation for x in self.transport.calls],['wb_stocks_create','wb_stocks_status','wb_stocks_download']);self.assertEqual(r['data'][0]['values'],{'stock_fbo_units':'10','stock_to_customer':'3','stock_return_transit':'2'})
 def test_wb_async_poll_does_not_recreate(self):
  self.transport.not_ready=True;r,_=self.done('остатки на складах площадки сейчас на wb');self.assertEqual([x.operation for x in self.transport.calls].count('wb_stocks_create'),1);self.assertEqual(len(self.transport.calls),4)
 def test_wb_task_scope(self):
  p=self.plan('остатки на складах площадки на wb');t=providers.tasks(p,p['stores'][0])[0]
  self.reject('PROVIDER_TASK_MISMATCH',lambda:finance_stock.decode_wb_stocks({'data':{'id':TASK,'status':'done'}},t,{'phase':'status','task_id':'aaaaaaaa-2222-3333-4444-555555555555','polls':0}))
 def test_task_id_not_url(self):
  p=self.plan('остатки на складах площадки на wb');t=providers.tasks(p,p['stores'][0])[0]
  self.reject('PROVIDER_TASK_ID',lambda:finance_stock.decode_wb_stocks({'data':{'taskId':'https://evil.invalid'}},t))
 def test_stock_grand_total_not_double_counted(self):
  p=self.plan('остатки на складах площадки на wb');t=providers.tasks(p,p['stores'][0])[0];r=finance_stock.decode_wb_stocks(wb_stocks(),t,{'phase':'download','task_id':TASK,'polls':1});self.assertEqual(r['values']['stock_fbo_units'],'10')
 def test_stock_aggregate_disagrees(self):
  p=self.plan('остатки на складах площадки на wb');t=providers.tasks(p,p['stores'][0])[0];d=wb_stocks();d[0]['warehouses'][0]['quantity']=11
  self.reject('WB_STOCK_TOTAL_MISMATCH',lambda:finance_stock.decode_wb_stocks(d,t,{'phase':'download'}))
 def test_stock_current_two_marketplaces(self):
  r,_=self.done('остатки на складах площадок сейчас на озоне и wb');self.assertEqual(len(self.transport.calls),4);self.assertEqual(len(r['data']),2)
 def test_snapshot_period_rejected(self):
  self.reject('HISTORICAL_SNAPSHOT',lambda:self.submit('остатки на складах площадки за октябрь на озоне'))
 def test_snapshot_comparison_rejected(self):
  self.reject('HISTORICAL_SNAPSHOT',lambda:self.submit('сравни остатки на складах площадки за октябрь и сентябрь на озоне'))
 def test_snapshot_mix_sales_rejected(self):
  self.reject('MIXED_TIME_AXES',lambda:self.submit('сумма заказов и остатки на складах площадки сегодня на озоне'))
 def test_snapshot_filter_rejected(self):
  self.reject('FILTER_SOURCE_NOT_SUPPORTED',lambda:self.submit('остатки на складах площадки по артикулу WB 123 на wb'))
 def test_snapshot_new_time_is_new_plan(self):
  a=self.submit('остатки на складах площадки на озоне');self.worker.step();self.clock.advance(301);b=self.submit('остатки на складах площадки на озоне');self.assertNotEqual(a['job_id'],b['job_id'])
 def test_snapshot_exact_hit(self):
  a=self.submit('остатки на складах площадки на озоне');self.worker.step();b=self.submit('остатки на складах площадки на озоне');self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(b['cache'],'HIT')
 def test_snapshot_unknown_not_recreated(self):
  a=self.submit('остатки на складах площадки на wb');self.transport.fail=CallError('NET',unknown=True);self.worker.step();b=self.submit('обнови остатки на складах площадки на wb');self.assertEqual(a['job_id'],b['job_id']);self.assertEqual(b['state'],'UNKNOWN')
 def test_current_balance_negative(self):
  r,_=self.done('текущий баланс и доступно к выводу сейчас на wb');self.assertEqual(len(self.transport.calls),1);self.assertEqual(r['data'][0]['values'],{'current_balance':'-100','available_withdrawal':'20'})
 def test_balance_and_stock_one_snapshot(self):
  r,_=self.done('текущий баланс и остатки на складах площадки сейчас на wb');self.assertEqual(len(self.transport.calls),4);self.assertEqual(r['data'][0]['currency'],'RUB')
 def test_finance_comparison_own_periods(self):
  r,_=self.done('сравни хранение за октябрь и сентябрь на wb');self.assertEqual(len(self.transport.calls),2);self.assertEqual(r['data'][0]['values']['finance_storage_cost'],'31');self.assertEqual(r['data'][0]['previous_values']['finance_storage_cost'],'30')
 def test_all_ad_orders_natural_phrase_is_local(self):
  d=parse('Сколько было заказано товаров и на какую сумму, сколько ушло на рекламу и каков ДРР за октябрь 2026 на Озоне и Вайлдберриз?',TODAY);self.assertEqual(d['route'],'P1');self.assertEqual(d['metrics'],['ad_spend','drr_ordered','ordered_revenue','ordered_units'])
 def test_all_financial_pages_under_voice_limit(self):
  r,_=self.done('финансовая сводка за октябрь на озоне');self.assertTrue(all(len(p)<900 for p in r['pages']));self.assertGreater(len(r['pages']),1)
if __name__=='__main__':unittest.main()
