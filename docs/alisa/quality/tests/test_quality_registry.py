import copy,importlib.util,json,shutil,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('qa_check',ROOT/'tools/qa_check.py');qa=importlib.util.module_from_spec(spec);spec.loader.exec_module(qa)
class QualityTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  for name in ('BUGS.json','TEMPLATES.json','RUNS.json','IMPORT_MANIFEST.json'):shutil.copy2(ROOT/name,self.root/name)
 def tearDown(self):self.temp.cleanup()
 def edit(self,name,fn):
  p=self.root/name;data=json.loads(p.read_text());fn(data);p.write_text(json.dumps(data,ensure_ascii=False));return data
 def bad(self,code):
  with self.assertRaises(qa.CheckError) as c:qa.check(self.root)
  self.assertEqual(str(c.exception),code)
 def test_import_counts(self):
  r=qa.check(self.root);self.assertEqual((r['findings'],r['candidates'],r['source_reports']),(27,5,7));self.assertEqual(r['enabled_candidates'],0)
 def test_all_legacy_ids_present(self):
  rows=qa.load(self.root/'BUGS.json')['records'];ids={x['id'] for x in rows}
  expected={f'OZCP-{i:03}' for i in range(1,6)}|{f'OZCP-G{i:03}' for i in range(1,6)}|{f'OZPAY-{i:03}' for i in range(1,5)}|{f'OZYOY-{i:03}' for i in range(1,9)}|{f'INFRA-{i:03}' for i in range(1,5)}|{'INFRA-YOY-001'}
  self.assertEqual(ids,expected)
 def test_duplicate_issue_rejected(self):self.edit('BUGS.json',lambda d:d['records'].append(copy.deepcopy(d['records'][0])));self.bad('DUPLICATE_RECORD_ID')
 def test_duplicate_candidate_rejected(self):self.edit('TEMPLATES.json',lambda d:d['records'].append(copy.deepcopy(d['records'][0])));self.bad('DUPLICATE_RECORD_ID')
 def test_missing_candidate_link(self):self.edit('BUGS.json',lambda d:d['records'][0].update(linked_templates=['missing']));self.bad('TEMPLATE_REFERENCE')
 def test_missing_bug_link(self):self.edit('TEMPLATES.json',lambda d:d['records'][0].update(linked_findings=['missing']));self.bad('FINDING_REFERENCE')
 def test_missing_dependency(self):self.edit('TEMPLATES.json',lambda d:d['records'][0].update(dependencies=['missing']));self.bad('DEPENDENCY_REFERENCE')
 def test_dependency_cycle(self):
  self.edit('TEMPLATES.json',lambda d:d['records'][0].update(dependencies=[d['records'][1]['id']]));self.bad('DEPENDENCY_CYCLE')
 def test_no_forced_release(self):self.edit('TEMPLATES.json',lambda d:d['records'][0].update(runtime_enabled=True));self.bad('RELEASE_PROOF_REQUIRED')
 def test_no_forced_verified(self):self.edit('BUGS.json',lambda d:d['records'][0].update(state='VERIFIED'));self.bad('RETEST_REQUIRED')
 def test_source_hash_tamper(self):self.edit('BUGS.json',lambda d:d['records'][0]['source'].update(sha256='0'*64));self.bad('IMPORTED_SOURCE_MISMATCH')
 def test_historical_pass_not_current(self):self.edit('RUNS.json',lambda d:d['records'][0].update(current_release_acceptance=True));self.bad('HISTORICAL_NOT_CURRENT')
 def test_unsafe_path(self):self.edit('RUNS.json',lambda d:d['records'][0]['source'].update(path='../../etc/passwd'));self.bad('UNSAFE_SOURCE_PATH')
 def test_secret_detected(self):
  self.edit('BUGS.json',lambda d:d['records'][0].update(access_token='synthetic-token-value-for-negative-check'))
  self.bad('POSSIBLE_SECRET')
 def test_render_repeat_identical(self):qa.render(self.root);s=(self.root/'BOARD.md').read_bytes();qa.render(self.root);self.assertEqual(s,(self.root/'BOARD.md').read_bytes())
 def test_cannot_remove_legacy_record(self):
  before=qa.load(self.root/'BUGS.json');after=copy.deepcopy(before);after['records'].pop()
  with self.assertRaisesRegex(qa.CheckError,'RECORD_REMOVAL_FORBIDDEN'):qa.transition(before,after)
 def test_source_history_not_rewritten(self):
  before=qa.load(self.root/'BUGS.json');after=copy.deepcopy(before);after['records'][0]['reported_outcome']='all-good'
  with self.assertRaisesRegex(qa.CheckError,'HISTORICAL_SOURCE_REWRITE'):qa.transition(before,after)
 def test_revision_required(self):
  before=qa.load(self.root/'BUGS.json');after=copy.deepcopy(before);after['records'][0]['next_action']='changed'
  with self.assertRaisesRegex(qa.CheckError,'REVISION_NOT_INCREASED'):qa.transition(before,after)
 def test_higher_revision_valid_update(self):
  before=qa.load(self.root/'BUGS.json');after=copy.deepcopy(before);after['records'][0].update(revision=2,next_action='Reproduce synthetic negative.')
  self.assertTrue(qa.transition(before,after))
 def test_changed_content_revokes_approval(self):
  before=qa.load(self.root/'TEMPLATES.json');after=copy.deepcopy(before);after['records'][0].update(revision=2,candidate_sha256='4'*64,approved_hash='4'*64,approval_ref='forged')
  with self.assertRaisesRegex(qa.CheckError,'STALE_APPROVAL_AFTER_EDIT'):qa.transition(before,after)
if __name__=='__main__':unittest.main(verbosity=2)
