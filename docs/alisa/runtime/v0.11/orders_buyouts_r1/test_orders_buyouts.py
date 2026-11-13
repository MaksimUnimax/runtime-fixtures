"""The composed question must acquire both quantities before the final answer."""
import json,unittest
import test_template_only as fixtures
from engine import Worker
from semantics import strict_json
class OrdersBuyouts(unittest.TestCase):
 def test_two_sources_reach_one_answer(self):
  pilot=fixtures.Pilot('test_simple_template_existing_source_and_normal_answer');pilot.setUp()
  try:
   class Transport(fixtures.Transport):
    def execute(self,request,store):
     if request.operation=='ozon_accrual_by_day':
      self.calls.append(request)
      money=lambda x:{'amount':str(x),'currency':'RUB'}
      product={'sku':12,'quantity':2,'delivery':None,'commission':{'seller_price':money(100),'sale_price':money(180),'sale_amount':money(200),'bonus':money(20),'coinvestment':money(0),'sale_commission':money(-40)}}
      row={'accrual_id':1,'date':'2026-11-02','posting':{'products':[product]},'total_amount':money(160)}
      return {'accruals':[row],'last_id':''},{'status':200}
     return super().execute(request,store)
   pilot.transport=Transport();pilot.transport.selection=fixtures.selection(['SUMMARY.58']);pilot.worker=Worker(pilot.engine,pilot.transport)
   row=pilot.finish(pilot.ask('Сколько товаров продали вчера на Озоне?'))
   self.assertEqual(row['state'],'READY',row['error']);self.assertIsNone(row['error'])
   ops=[r.operation for r in pilot.transport.calls]
   self.assertEqual(ops.count('ozon_orders'),1);self.assertEqual(ops.count('ozon_accrual_by_day'),1);self.assertEqual(ops.count('model_answer'),1)
   request=next(r for r in pilot.transport.calls if r.operation=='model_answer')
   from model_input_encoding import PREFIX
   data=json.loads(request.body['messages'][-1]['content'].removeprefix(PREFIX))
   self.assertEqual({r['operation']for r in data['responses']},{'ozon_orders','ozon_accrual_by_day'})
   self.assertEqual(data['template_context'][0]['template_id'],'SUMMARY.58')
   contract=next(c for c in data['calculation_context']if c['template_id']=='B05.accrual_sale_units')
   self.assertEqual(contract['selected_template_id'],'SUMMARY.58')
   self.assertEqual(contract['contract']['sum_field'],'quantity')
  finally:pilot.tearDown()
if __name__=='__main__':unittest.main()
