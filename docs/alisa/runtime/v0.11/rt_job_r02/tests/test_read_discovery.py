import unittest
from semantics import Rejected
import read_surface as rs
from universal_reads import pointer_fields,display
class Discovery(unittest.TestCase):
 def test_no_match_keeps_requested_cluster_methods(self):
  r=rs.discover('wb','unmatched-word','calendar');self.assertTrue(r['query_no_exact_match']);self.assertEqual(r['total'],3);self.assertIn('calendar_promotions',[x['operation']for x in r['items']])
 def test_original_search_is_visible_to_planner(self):
  r=rs.discover('wb','акции','calendar');self.assertEqual(r['request'],{'platform':'wb','query':'акции','cluster':'calendar','offset':0})
 def test_invalid_cluster_returns_known_clusters(self):
  r=rs.discover('wb','unmatched','промо');self.assertTrue(r['unknown_cluster']);self.assertIn('calendar',r['valid_clusters']);self.assertGreater(r['total'],0)
 def test_no_match_does_not_remove_method_permission_metadata(self):
  r=rs.discover('wb','unmatched','calendar');self.assertTrue(all('available'in x for x in r['items']))
 def test_no_default_zero_when_source_field_missing(self):
  with self.assertRaises(Rejected)as e:pointer_fields({'$path':['calls',0,'data','missing'],'default':0})
  self.assertEqual(e.exception.code,'READ_MISSING_FIELD_NO_DEFAULT')
 def test_no_get_default_zero_backdoor(self):
  with self.assertRaises(Rejected):pointer_fields({'$fn':['get_default',{'$path':['calls',0,'data']},'missing',0]})
 def test_source_path_without_default_allowed(self):pointer_fields({'$path':['calls',0,'data','amount']})
 def test_generic_field_labels_localized(self):self.assertEqual(display({'title':'Тест','participating_products_count':3}),'название: Тест, участвующих товаров: 3')
