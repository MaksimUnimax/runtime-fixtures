import copy,json,tempfile,unittest
from pathlib import Path
from datetime import date
from unittest.mock import patch
from failure_explanations import CATALOG,explain
from repository import Repository
from engine import Engine
from semantics import Rejected,Scope,Store,fingerprint
class ExplanationTests(unittest.TestCase):
 def test_every_entry_complete_and_short(self):
  for code in CATALOG['entries']:
   r=explain(code);self.assertEqual(r['reason_code'],code);self.assertTrue(r['reason']);self.assertTrue(r['next_action']);self.assertEqual(r['text'],r['tts']);self.assertFalse(r['retryable']);self.assertLessEqual(len(r['text']),800)
 def test_all_aliases_resolve(self):
  for code,target in CATALOG['aliases'].items():self.assertEqual(explain(code)['reason_code'],target)
 def test_unknown_no_echo(self):
  raw='Authorization: Bearer synthetic_secret_123 /etc/private tenant-id'
  r=explain(raw);self.assertEqual(r['reason_code'],'UNSPECIFIED');self.assertNotIn(raw,json.dumps(r));self.assertEqual(r['cause_status'],'UNKNOWN')
 def test_null_safe(self):self.assertEqual(explain(None)['reason_code'],'UNSPECIFIED')
 def test_nonstring_safe(self):self.assertEqual(explain({'unsafe':'secret'})['reason_code'],'UNSPECIFIED')
 def test_unknown_provider_cause_honest(self):self.assertEqual(explain('HTTP_400')['cause_status'],'PROVIDER_CAUSE_UNKNOWN')
 def test_empty_is_not_zero(self):self.assertIn('не подтверждает нулевые расходы',explain('ADS_EMPTY_UNCONFIRMED')['text'])
 def test_llm_clarify_has_action(self):self.assertGreater(len(explain('LLM_CLARIFY')['next_action']),20)
 def test_unknown_no_retry(self):self.assertFalse(explain('NETWORK_OUTCOME_UNKNOWN')['retryable'])
 def test_catalog_return_copy(self):r=explain('LLM_CLARIFY');r['reason']='changed';self.assertNotEqual(explain('LLM_CLARIFY')['reason'],'changed')
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.repo=Repository(Path(self.tmp.name)/'db.sqlite')
  self.scope=Scope('A','r',(Store('s','ozon','synthetic','a','s','RUB'),))
  self.engine=Engine(self.repo,lambda _:self.scope)
 def tearDown(self):self.tmp.cleanup()
 def test_failed_describe_integrated(self):
  row={'tenant':'A','plan':None,'state':'FAILED','error':'ADS_EMPTY_UNCONFIRMED'}
  text=self.engine.describe('A',row);self.assertEqual(text,explain('ADS_EMPTY_UNCONFIRMED')['text'])
 def test_raw_failure_no_echo(self):
  row={'tenant':'A','plan':None,'state':'FAILED','error':'Bearer synthetic-secret'}
  self.assertNotIn('synthetic-secret',self.engine.describe('A',row))
 def test_read_does_not_create_jobs_or_calls(self):
  before=self.repo.call_count();row={'tenant':'A','plan':None,'state':'FAILED','error':'LLM_CLARIFY'}
  for _ in range(3):self.engine.describe('A',row)
  self.assertEqual(self.repo.call_count(),before)
  with self.repo.connection() as c:self.assertEqual(c.execute('SELECT count(*) FROM jobs').fetchone()[0],0)
 def test_bare_code_safe_submit_expanded(self):
  with patch.object(self.engine,'submit',side_effect=Rejected('ADS_EMPTY_UNCONFIRMED')):r=self.engine.safe_submit()
  self.assertEqual(r['reason_code'],'ADS_EMPTY_UNCONFIRMED');self.assertTrue(r['next_action']);self.assertEqual(r['text'],r['tts']);self.assertEqual(r['error'],'ADS_EMPTY_UNCONFIRMED')
 def test_bare_sensitive_exception_not_in_error_field(self):
  with patch.object(self.engine,'submit',side_effect=Rejected('Bearer synthetic-secret /private/path')):r=self.engine.safe_submit()
  self.assertNotIn('synthetic-secret',json.dumps(r));self.assertEqual(r['error'],'UNSPECIFIED')
 def test_bounded_unknown_code_preserved(self):
  with patch.object(self.engine,'submit',side_effect=Rejected('NEW_INTERNAL_CODE')):r=self.engine.safe_submit()
  self.assertEqual(r['error'],'NEW_INTERNAL_CODE');self.assertEqual(r['reason_code'],'UNSPECIFIED')
 def test_human_clarification_retained(self):
  text='Какой период сохранить?'
  with patch.object(self.engine,'submit',side_effect=Rejected('PERIOD_REQUIRED',text)):r=self.engine.safe_submit()
  self.assertEqual(r['text'],text);self.assertEqual(r['error'],'PERIOD_REQUIRED')
 def test_unknown_state_no_auto_retry(self):
  row={'tenant':'A','plan':None,'state':'UNKNOWN','error':'anything'}
  self.assertIn('не буду',self.engine.describe('A',row));self.assertEqual(self.repo.call_count(),0)
if __name__=='__main__':unittest.main()
