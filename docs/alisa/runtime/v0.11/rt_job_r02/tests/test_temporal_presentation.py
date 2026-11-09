"""Formatting of explicit source dates, without silently changing the result data."""
from copy import deepcopy
import unittest
from universal_reads import display,interval_label
class TemporalPresentation(unittest.TestCase):
 def setUp(self):self.now='2026-11-08T11:15:00Z'
 def test_future_explicitly_named(self):
  row={'Название':'Будущая','Начало':'2026-11-10T21:00:00Z','Окончание':'2026-12-01T00:00:00Z'};self.assertEqual(interval_label(row,self.now),'ещё не началась');self.assertIn('ещё не началась',display(row,self.now))
 def test_active_interval_named(self):self.assertEqual(interval_label({'date_start':'2026-11-07T21:00:00Z','date_end':'2026-12-01T00:00:00Z'},self.now),'действует')
 def test_ended_interval_not_active(self):self.assertEqual(interval_label({'start':'2026-10-01T00:00:00Z','end':'2026-11-08T11:15:00Z'},self.now),'завершилась')
 def test_timezone_normalized(self):self.assertEqual(interval_label({'start':'2026-11-08T14:00:00+03:00','end':'2026-11-09T00:00:00+03:00'},self.now),'действует')
 def test_missing_end_not_invented(self):self.assertIsNone(interval_label({'start':'2026-01-01T00:00:00Z'},self.now))
 def test_naive_date_not_guessed(self):self.assertIsNone(interval_label({'start':'2026-01-01','end':'2027-01-01'},self.now))
 def test_reversed_interval_not_repaired(self):self.assertIsNone(interval_label({'start':'2027-01-01T00:00:00Z','end':'2026-01-01T00:00:00Z'},self.now))
 def test_ambiguous_date_keys_not_selected(self):self.assertIsNone(interval_label({'start':'2026-01-01T00:00:00Z','Начало':'2027-01-01T00:00:00Z','end':'2028-01-01T00:00:00Z'},self.now))
 def test_no_snapshot_no_label(self):self.assertIsNone(interval_label({'start':'2026-01-01T00:00:00Z','end':'2027-01-01T00:00:00Z'},None))
 def test_source_values_not_mutated(self):
  r={'name':'Test','start':'2026-01-01T00:00:00Z','end':'2027-01-01T00:00:00Z','participating_products':1};b=deepcopy(r);display(r,self.now);self.assertEqual(r,b)
 def test_nested_rows_labeled_independently(self):
  r=[{'start':'2026-01-01T00:00:00Z','end':'2027-01-01T00:00:00Z'},{'start':'2026-12-01T00:00:00Z','end':'2027-01-01T00:00:00Z'}];out=display(r,self.now);self.assertEqual(out.count('действует'),1);self.assertEqual(out.count('ещё не началась'),1)
 def test_registered_business_keys_are_russian(self):
  out=display({'participating_products':1,'not_participating':80,'type':'auto'},self.now);self.assertIn('участвующих товаров: 1',out);self.assertIn('тип акции: автоматическая',out);self.assertNotIn('participating_products',out)
 def test_non_date_output_not_changed(self):self.assertEqual(display({'title':'Test','participating_products_count':3},self.now),'название: Test, участвующих товаров: 3')
if __name__=='__main__':unittest.main()
