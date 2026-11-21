"""Advertising source regression; independent synthetic values, no network."""
import copy,unittest
from test_runtime import plan
import providers
from semantics import Rejected
from scalar_runtime import MATRIX,SOURCES
class AdvertisingDaily(unittest.TestCase):
 def setUp(self):
  self.p=plan('расходы на рекламу за октябрь на озоне');self.s=self.p['stores'][0];self.t=providers.tasks(self.p,self.s)[0]
  self.raw={'rows':[{'id':'a','date':'2026-10-01','moneySpent':'12,34'},{'id':'b','date':'2026-10-02','moneySpent':'0,66'}]}
 def decode(self,r):return providers.decode_expense(r,self.t,self.s)
 def test_independent_sum(self):
  self.assertEqual(self.decode(self.raw)['values']['ad_spend'],'13.00')
  self.assertEqual(self.t['recipe'],'ozon_ads_daily')
  self.assertNotIn('ad_spend',MATRIX.recipe('ozon_ads')['fields'])
 def test_source_and_quota(self):
  req=providers.build_task(self.p,self.s,self.t);self.assertEqual(req.operation,'ozon_ads_daily');self.assertTrue(req.source.endswith(':ozon_expense'))
  self.assertTrue(SOURCES.recipe(req.operation)['url'].endswith('/daily/json'))
 def test_empty_never_zero(self):
  with self.assertRaises(Rejected) as e:self.decode({'rows':[]})
  self.assertEqual(e.exception.code,'ADS_EMPTY_UNCONFIRMED')
 def test_null_rejected(self):
  with self.assertRaises(Rejected):self.decode({'rows':None})
 def test_missing_money_rejected(self):
  del self.raw['rows'][0]['moneySpent']
  with self.assertRaises(Rejected):self.decode(self.raw)
 def test_null_money_rejected(self):
  self.raw['rows'][0]['moneySpent']=None
  with self.assertRaises(Rejected):self.decode(self.raw)
 def test_duplicate_rejected(self):
  self.raw['rows'].append(copy.deepcopy(self.raw['rows'][0]))
  with self.assertRaises(Rejected):self.decode(self.raw)
 def test_outside_period(self):
  self.raw['rows'][0]['date']='2026-11-01'
  with self.assertRaises(Rejected):self.decode(self.raw)
 def test_null_date(self):
  self.raw['rows'][0]['date']=None
  with self.assertRaises(Rejected):self.decode(self.raw)
 def test_negative_rejected(self):
  self.raw['rows'][0]['moneySpent']='-1,00'
  with self.assertRaises(Rejected):self.decode(self.raw)
 def test_nonfinite_rejected(self):
  self.raw['rows'][0]['moneySpent']='NaN'
  with self.assertRaises(Rejected):self.decode(self.raw)
 def test_explicit_zero_allowed(self):
  for row in self.raw['rows']:row['moneySpent']='0,00'
  self.assertEqual(self.decode(self.raw)['values']['ad_spend'],'0.00')
 def test_unknown_currency(self):
  self.s['currency']=None
  with self.assertRaises(Rejected):self.decode(self.raw)
 def test_legacy_empty_never_zero(self):
  t={**self.t,'recipe':'ozon_ads','metrics':['ad_bonus_spend']}
  with self.assertRaises(Rejected) as e:providers.decode_expense({'rows':[]},t,self.s)
  self.assertEqual(e.exception.code,'ADS_EMPTY_UNCONFIRMED')
