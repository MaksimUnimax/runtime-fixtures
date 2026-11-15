from pathlib import Path
from unittest import TestCase
import tempfile
from suite_routing import SPECIALIZED,inventory,labels

class SuiteRouting(TestCase):
 def fixture(self,root):
  for name,modules in SPECIALIZED.items():
   d=root/name;d.mkdir();(d/'__init__.py').write_text('')
   for module in modules:(d/(module+'.py')).write_text('')
  (root/'test_root.py').write_text('')
 def test_every_specialized_module_executes_exactly_once(self):
  groups=[labels(x)for x in ('base','collection','compound','ledger')];flat=sum(groups,[])
  expected={p+'.'+m for p,modules in SPECIALIZED.items()for m in modules}
  self.assertEqual(set(flat),expected);self.assertEqual(len(flat),len(expected))
 def test_unknown_new_package_not_silently_dropped(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);self.fixture(root);d=root/'future';d.mkdir();(d/'__init__.py').write_text('');(d/'test_new.py').write_text('')
   with self.assertRaisesRegex(RuntimeError,'UNASSIGNED'):inventory(root)
 def test_new_module_in_existing_suite_requires_assignment(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);self.fixture(root);(root/'current_parameters/test_future.py').write_text('')
   with self.assertRaisesRegex(RuntimeError,'UNASSIGNED'):inventory(root)
 def test_missing_registered_suite_is_failure(self):
  with tempfile.TemporaryDirectory()as t:
   with self.assertRaisesRegex(RuntimeError,'MISSING'):inventory(Path(t))
 def test_existing_checkout_inventory_is_complete(self):
  root,groups=inventory(Path(__file__).parent);self.assertIn('test_suite_routing',root);self.assertEqual(set(groups),set(SPECIALIZED))

 def test_nested_duplicate_basename_cannot_hide_unassigned_test(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);self.fixture(root);d=root/'economics_cohort/nested';d.mkdir();(d/'test_sources.py').write_text('')
   with self.assertRaisesRegex(RuntimeError,'UNASSIGNED'):inventory(root)
