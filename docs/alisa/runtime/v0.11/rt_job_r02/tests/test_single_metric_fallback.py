import unittest
from universal_reads import single_ordered_units_report
class Fallback(unittest.TestCase):
 def test_exact_received_daily_total(self):
  plan={'stores':[{'id':'owner-ozon'}],'calendar_date':'2026-11-08','question':'сколько заказано сегодня'}
  call={'store_id':'owner-ozon','operation':'analytics_data','params':{'metrics':['ordered_units'],'dimension':['day'],'date_from':'2026-11-08','date_to':'2026-11-08'},'data':{'result':{'totals':[17],'data':[{'metrics':[17]}]}}}
  r=single_ordered_units_report(plan,{'calls':[call]},'2026-11-08 10:00 UTC')
  self.assertIn('17',r['pages'][0]);self.assertTrue(r['complete'])
  call['data']['result']['totals']=[18]
  self.assertIsNone(single_ordered_units_report(plan,{'calls':[call]},'2026-11-08 10:00 UTC'))
if __name__=='__main__':unittest.main()
