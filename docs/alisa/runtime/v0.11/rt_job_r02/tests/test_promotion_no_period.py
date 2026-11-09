"""Known unsupported snapshot question must not demand unrelated dates or spend LLM quota."""
from test_dialogue import DialogueTests
from semantics import parse,Rejected
from datetime import date
import unittest
class Promotions(unittest.TestCase):
 setUp=DialogueTests.setUp
 tearDown=DialogueTests.tearDown
 ask=DialogueTests.ask
 seed=DialogueTests.seed
 count_jobs=DialogueTests.count_jobs
 pending=DialogueTests.pending
 def test_live_dataset_capabilities_do_not_bypass_guard(self):
  self.engine.dataset_capabilities=lambda:{}
  self.engine.table_capabilities=lambda:{}
  for n,q in enumerate(['В каких акциях участвуют мои товары на Озоне','цены товаров в акциях на озоне сейчас']):
   r=self.ask(q,n);self.assertEqual(r['error'],'PROMOTION_PARTICIPATION_NOT_ENABLED')
  self.assertEqual(self.count_jobs(),0)
 def test_promotion_request_without_dates(self):
  for n,q in enumerate(['В каких акциях участвуют мои товары на Озоне','Покажи участие в акциях','Какие акции сейчас на Озоне','участвую ли я в акции','Акции на Вайлдберриз']):
   r=self.ask(q,i=n);self.assertEqual(r['error'],'PROMOTION_PARTICIPATION_NOT_ENABLED');self.assertFalse(r.get('clarification_required'));self.assertIn('даты не нужны',r['text']);self.assertEqual(r['text'],r['tts'])
  self.assertEqual(self.count_jobs(),0);self.assertEqual(self.repo.call_count(),0);self.assertIsNone(self.pending())
 def test_dates_do_not_make_unsupported_source_work(self):
  r=self.ask('участие в акциях на озоне за вчера');self.assertEqual(r['error'],'PROMOTION_PARTICIPATION_NOT_ENABLED');self.assertEqual(self.count_jobs(),0)
 def test_not_fake_zero_or_participation(self):
  r=self.ask('товары в акциях');self.assertNotIn('не участвуете',r['text']);self.assertNotIn('товаров: 0',r['text'])
 def test_write_request_not_allowed(self):
  r=self.ask('включи товары в акции на озоне');self.assertEqual(r['error'],'READ_ONLY')
 def test_sensitive_request_not_reflected(self):
  r=self.ask('акции api-key SECRET_PRIVATE');self.assertEqual(r['error'],'SENSITIVE_INPUT');self.assertNotIn('SECRET_PRIVATE',r['text'])
 def test_quoted_brand_not_blocked(self):
  r=self.ask('заказанные товары за вчера по бренду "Акция" на wb');self.assertNotEqual(r.get('error'),'PROMOTION_PARTICIPATION_NOT_ENABLED')
 def test_transaction_word_not_matched(self):
  try:parse('транзакции за вчера на озоне',date(2026,11,8))
  except Rejected as e:self.assertNotEqual(e.code,'PROMOTION_PARTICIPATION_NOT_ENABLED')
 def test_old_pending_period_replaced_by_new_promotion_question(self):
  self.seed('сводка заказов на озоне');r=self.ask('в каких акциях участвуют товары на озоне',1);self.assertEqual(r['error'],'PROMOTION_PARTICIPATION_NOT_ENABLED');self.assertIsNone(self.pending())
 def test_real_flow_period_still_available(self):
  self.seed('сводка заказов на озоне');r=self.ask('вчера',1);self.assertEqual(r['state'],'QUEUED')
 def test_replay_no_new_job(self):
  q='участие товаров в акциях';a=self.ask(q);b=self.ask(q);self.assertEqual(a,b);self.assertEqual(self.count_jobs(),0)
del DialogueTests

if __name__=='__main__':
 # Run only new cases here; full discovery independently includes old regressions.
 suite=unittest.TestSuite(Promotions(n)for n in Promotions.__dict__ if n.startswith('test_'))
 r=unittest.TextTestRunner(verbosity=2).run(suite);raise SystemExit(0 if r.wasSuccessful()else 1)
