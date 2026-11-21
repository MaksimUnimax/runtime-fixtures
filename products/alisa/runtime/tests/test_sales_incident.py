"""Regression for real 2026-11-03 P2 finance-sales substitution incident."""
import copy,json,tempfile,unittest
from pathlib import Path
from datetime import date
from test_runtime import SCOPE,Clock,TODAY
from test_finance_stock import FinancialTransport
from semantics import parse,Rejected,fingerprint,strict_json
from repository import Repository
from engine import Engine,Worker
from query_program import make_composed_plan
from request_basis import explicit_financial_basis, validate_request_basis, CLARIFICATION

AMBIGUOUS=[
 'дайпродажи за вчера','дай продажи за вчера','покажипродажи за вчера',
 'скажипродажи за вчера','сколькопродаж за вчера','продажи за вчера',
 'ДАЙПРОДАЖИ ЗА ВЧЕРА','дайпродажи за вчера!', 'дай\u200bпродажи за вчера',
 'дайпро\u200bдажи за вчера','дайпро\u00adдажи за вчера','дайпродажи за\u00a0вчера',
 'сколько продали вчера','сколько продано за вчера','сколько проданных товаров за вчера',
 'дайвыручку за вчера','покаживыручку за вчера','выручка за вчера',
 'сравни продажи за октябрь и сентябрь на озоне','доля рекламы в продажах за вчера',
 'продажи и финансовая сводка за вчера','дайпродажи по бренду "финансовые продажи" за вчера на wb',
 'обнови дайпродажи за вчера','Алиса, дайпродажи за вчера','финансовая сводка и продажи за вчера',
]
class SalesIncident(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.clock=Clock()
  self.repo=Repository(Path(self.temp.name)/'state.sqlite',self.clock)
  self.engine=Engine(self.repo,lambda _:SCOPE);self.transport=FinancialTransport();self.worker=Worker(self.engine,self.transport)
 def tearDown(self):self.temp.cleanup()
 def send(self,q,ident='q'):
  return self.engine.safe_submit('A',q,ident,fingerprint(q),TODAY)
 def test_original_route_never_invokes_model(self):
  r=self.send('дайпродажи за вчера')
  self.assertEqual(r['error'],'METRIC_AMBIGUOUS');self.assertEqual(r['text'],r['tts'])
  self.assertIn('заказанных',r['text']);self.assertIn('выкупы',r['text'])
  self.assertIsNone(self.repo.get('A'));self.assertFalse(self.worker.step());self.assertEqual(self.repo.call_count(),0)
 def test_exact_one_day_not_changed(self):
  d=parse('сводка заказов за вчера',TODAY)
  self.assertEqual(d['period'],{'from':'2026-11-02','to':'2026-11-02'})
  self.assertEqual(d['metrics'],['ordered_revenue','ordered_units'])
 def test_orders_success_never_finance(self):
  r=self.send('сводка заказов за вчера на озоне')
  self.worker.step();row=self.repo.get('A',r['job_id'])
  self.assertEqual(row['state'],'READY');self.assertEqual([c.operation for c in self.transport.calls],['ozon_orders'])
 def test_valid_model_json_is_not_semantic_proof(self):
  parent=self.transport
  class Model:
   def execute(self,r,s):
    if r.operation=='deepseek_parse':
     parent.calls.append(r)
     return {'content':json.dumps({'expressions':[{'metric':'finance_sales'}], 'fully_understood':True,'unsupported':False}),'finish_reason':'stop'},{'status':200}
    return parent.execute(r,s)
  worker=Worker(self.engine,Model());r=self.send('сколько денег принесли товары за вчера на озоне')
  self.assertEqual(r['state'],'QUEUED');worker.step();worker.step()
  row=self.repo.get('A',r['job_id']);self.assertEqual(row['state'],'FAILED');self.assertEqual(row['error'],'FINANCIAL_BASIS_NOT_REQUESTED')
  self.assertEqual([x.operation for x in parent.calls],['deepseek_parse'])
 def test_legacy_resolved_bad_job_stopped_before_http(self):
  # Simulate a resolved plan from the old build; keep the actual malformed draft.
  d=parse('сколько денег принесли товары за вчера на озоне',TODAY)
  d['question']='дайпродажи за вчера'
  p=make_composed_plan(SCOPE,d,expressions=[{'metric':'finance_sales'}])
  row,_=self.repo.enqueue('A','legacy',fingerprint('legacy'),d,p,'scope')
  self.worker.step();done=self.repo.get('A',row['id'])
  self.assertEqual(done['state'],'FAILED');self.assertEqual(done['error'],'FINANCIAL_BASIS_NOT_REQUESTED');self.assertEqual(self.repo.call_count(),0)
 def test_explicit_financial_wording_allowed(self):
  for q in ['продажи по финансовым отчетам за вчера на озоне','финансовая сводка за вчера на озоне','доля хранения и логистики в финансовых продажах за вчера на озоне']:
   r=self.send(q,q);self.assertNotIn('error',r)
 def test_model_source_guard_does_not_use_brand_literal(self):
  self.assertFalse(explicit_financial_basis('данные бренда "финансовые продажи" за вчера'))
 def test_registered_template_finance_allowed(self):
  d=parse('доля хранения и логистики в финансовых продажах за вчера на озоне',TODAY)
  p=make_composed_plan(SCOPE,d,metrics=d['metrics']);validate_request_basis(d,p)
 def test_only_financial_sales_no_logistics_filler(self):
  r=self.send('продажи по финансовым отчетам за вчера на озоне');self.worker.step()
  row=self.repo.get('A',r['job_id']);text=' '.join(strict_json(row['result'])['pages'])
  self.assertNotIn('Логистика Ozon',text);self.assertNotIn('Хранение Ozon',text);self.assertNotIn('reverse_logistics',text)
 def test_selected_cost_notes_still_present(self):
  r=self.send('хранение и логистика за вчера на озоне');self.worker.step()
  row=self.repo.get('A',r['job_id']);text=' '.join(strict_json(row['result'])['pages'])
  self.assertIn('Логистика Ozon',text);self.assertIn('Хранение Ozon',text)
 def test_receipt_projection_version_changed(self):
  d=parse('сводка заказов за вчера на озоне',TODAY);p=make_composed_plan(SCOPE,d,metrics=d['metrics'])
  self.assertEqual(p['projection'],'composed-voice-v3-sales-basis')
 def test_withdrawn_job_never_renders_old_result(self):
  r=self.send('продажи по финансовым отчетам за вчера на озоне');self.worker.step()
  with self.repo.connection(True) as c:c.execute("UPDATE jobs SET state='FAILED',error='SALES_SOURCE_MISMATCH_WITHDRAWN' WHERE id=?",(r['job_id'],))
  out=self.send('результат','read')
  self.assertIn('снят с выдачи',out['text']);self.assertNotIn('1000',out['text'])

def generated(q):
 def test(self):
  r=self.send(q);self.assertEqual(r.get('error'),'METRIC_AMBIGUOUS',q)
  self.assertIsNone(self.repo.get('A'));self.assertEqual(self.repo.call_count(),0)
 return test
for i,q in enumerate(AMBIGUOUS):setattr(SalesIncident,'test_ambiguous_variant_%02d'%i,generated(q))
