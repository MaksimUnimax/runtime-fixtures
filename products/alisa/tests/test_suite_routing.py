from pathlib import Path
from unittest import TestCase, TestSuite, TextTestRunner
import io, tempfile
from suite_routing import SPECIALIZED,EXTERNAL,inventory,labels
from current_parameters.ci_qualified_suites import select_shard, RecordingResult, execution_coverage

class SuiteRouting(TestCase):
 def fixture(self,root):
  for name,modules in {**SPECIALIZED,**EXTERNAL}.items():
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
  root,groups=inventory(Path(__file__).parent);self.assertIn('test_suite_routing',root);self.assertEqual(set(groups),set(SPECIALIZED)|set(EXTERNAL))

 def test_nested_duplicate_basename_cannot_hide_unassigned_test(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);self.fixture(root);d=root/'economics_cohort/nested';d.mkdir();(d/'test_sources.py').write_text('')
   with self.assertRaisesRegex(RuntimeError,'UNASSIGNED'):inventory(root)

 def test_unknown_nonpackage_directory_also_requires_assignment(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);self.fixture(root);d=root/'future';d.mkdir();(d/'test_new.py').write_text('')
   with self.assertRaisesRegex(RuntimeError,'UNASSIGNED'):inventory(root)

 def test_new_module_in_other_known_environment_is_not_silently_external(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);self.fixture(root);(root/'runtime_client/test_unassigned.py').write_text('')
   with self.assertRaisesRegex(RuntimeError,'UNASSIGNED'):inventory(root)

 def test_symlinked_nested_test_tree_is_not_ignored(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t)/'tests';root.mkdir();self.fixture(root);outside=Path(t)/'outside';outside.mkdir();(outside/'test_future.py').write_text('')
   (root/'economics_ledger/nested_link').symlink_to(outside,target_is_directory=True)
   with self.assertRaisesRegex(RuntimeError,'SYMLINK'):inventory(root)
 def test_symlinked_test_file_is_rejected(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t)/'tests';root.mkdir();self.fixture(root);outside=Path(t)/'outside.py';outside.write_text('')
   p=root/'economics_ledger/test_accruals.py';p.unlink();p.symlink_to(outside)
   with self.assertRaisesRegex(RuntimeError,'SYMLINK'):inventory(root)

 def test_operations_exact_inventory_is_bound_to_existing_named_ci_step(self):
  self.assertEqual(EXTERNAL['operations'],{name:'existing alisa-platform-ci AL-S16 reconciliation assessment and idempotent receipts (isolated) step' for name in ('test_reconciliation','test_native_snapshot')})
  self.assertNotIn('operations',SPECIALIZED)
  self.assertFalse(any(x.startswith('operations.')for group in ('base','collection','compound','ledger')for x in labels(group)))
  workflow=Path(__file__).resolve().parents[3]/'.github/workflows/alisa-platform-ci.yml'
  text=workflow.read_text();name='      - name: AL-S16 reconciliation assessment and idempotent receipts (isolated)'
  self.assertEqual(text.count(name),1)
  block=text.split(name,1)[1].split('      - ',1)[0]
  self.assertIn('set -euo pipefail',block)
  self.assertIn("python -I -B -m unittest discover -s products/alisa/tests/operations -p 'test_*.py' -v",block)
  self.assertIn('s16-reconciliation-unit-tests.log',block)

 def test_another_operations_module_is_not_silently_external(self):
  with tempfile.TemporaryDirectory()as t:
   root=Path(t);self.fixture(root);(root/'operations/test_unassigned.py').write_text('')
   with self.assertRaisesRegex(RuntimeError,'UNASSIGNED:operations'):inventory(root)

 def nested_suite(self,names):
  class Probe(TestCase):
   def __init__(self,name):super().__init__('runTest');self.name=name
   def id(self):return self.name
   def runTest(self):pass
  return TestSuite([TestSuite(Probe(name)for name in names[::2]),
                    TestSuite([TestSuite(Probe(name)for name in names[1::2])])])

 def test_default_shard_runs_the_entire_discovered_inventory(self):
  names=['fixture.Case.test_'+str(i).zfill(2)for i in reversed(range(19))]
  selected,coverage=select_shard(self.nested_suite(names))
  self.assertEqual([test.id()for test in selected],sorted(names))
  self.assertEqual((coverage['shard_count'],coverage['shard_index']),(1,0))
  self.assertEqual(coverage['inventory_count'],len(names))
  self.assertEqual(coverage['inventory_sha256'],coverage['selected_ids_sha256'])

 def test_shards_are_disjoint_and_the_union_is_the_exact_inventory(self):
  names=['fixture.Case.test_'+str(i).zfill(2)for i in reversed(range(37))]
  for count in (2,4,6):
   with self.subTest(count=count):
    executed=[];seen=set();hashes=set();sizes=[]
    for index in range(count):
     selected,coverage=select_shard(self.nested_suite(names),count,index)
     ids=[test.id()for test in selected]
     self.assertEqual(ids,sorted(names)[index::count]);self.assertFalse(seen.intersection(ids))
     self.assertEqual(coverage['inventory_count'],len(names));self.assertEqual(coverage['selected_ids_count'],len(ids))
     hashes.add(coverage['inventory_sha256']);seen.update(ids);executed.extend(ids);sizes.append(len(ids))
    self.assertEqual(sorted(executed),sorted(names));self.assertEqual(len(hashes),1)
    self.assertLessEqual(max(sizes)-min(sizes),1)

 def test_shards_do_not_depend_on_discovery_order_or_nesting(self):
  names=['fixture.Case.test_'+str(i).zfill(2)for i in range(17)]
  for index in range(4):
   left,left_proof=select_shard(self.nested_suite(names),4,index)
   right,right_proof=select_shard(self.nested_suite(list(reversed(names))),4,index)
   self.assertEqual([test.id()for test in left],[test.id()for test in right]);self.assertEqual(left_proof,right_proof)

 def test_empty_duplicate_and_impossible_shards_are_hard_errors(self):
  with self.assertRaisesRegex(RuntimeError,'EMPTY_SPECIALIZED_SUITE'):select_shard(TestSuite())
  with self.assertRaisesRegex(RuntimeError,'DUPLICATE_TEST_ID'):select_shard(self.nested_suite(['same','same']))
  with self.assertRaisesRegex(RuntimeError,'EMPTY_TEST_SHARD'):select_shard(self.nested_suite(['only']),2,0)

 def test_out_of_range_or_noninteger_shard_arguments_are_hard_errors(self):
  for count,index in ((0,0),(-1,0),(2,-1),(2,2),(True,0),(2,False),(2,'0')):
   with self.subTest(count=count,index=index),self.assertRaisesRegex(RuntimeError,'TEST_SHARD_RANGE'):
    select_shard(self.nested_suite(['a','b']),count,index)

 def test_receipt_tracks_tests_actually_started(self):
  selected,planned=select_shard(self.nested_suite(['c','a','b']))
  result=TextTestRunner(stream=io.StringIO(),verbosity=0,resultclass=RecordingResult).run(selected)
  actual=execution_coverage(result,planned)
  self.assertTrue(result.wasSuccessful());self.assertEqual(result.executed_ids,['a','b','c'])
  self.assertTrue(actual['execution_complete']);self.assertEqual(actual['executed_ids_count'],3)
  self.assertEqual(actual['executed_ids_sha256'],planned['selected_ids_sha256'])

 def test_class_setup_failure_cannot_claim_planned_tests_executed(self):
  class Broken(TestCase):
   @classmethod
   def setUpClass(cls):raise RuntimeError('SYNTHETIC_SETUP_FAILURE')
   def runTest(self):self.fail('must not run')
  selected,planned=select_shard(TestSuite([Broken()]))
  result=TextTestRunner(stream=io.StringIO(),verbosity=0,resultclass=RecordingResult).run(selected)
  actual=execution_coverage(result,planned)
  self.assertFalse(result.wasSuccessful());self.assertEqual(actual['executed_ids_count'],0)
  self.assertFalse(actual['execution_complete']);self.assertNotEqual(actual['executed_ids_sha256'],planned['selected_ids_sha256'])
