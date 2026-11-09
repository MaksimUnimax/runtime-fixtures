"""Model formatting recovery retains the exact already-read source responses."""
from copy import deepcopy
from contextlib import redirect_stdout
from io import StringIO
from unittest.mock import patch
import json,unittest
from semantics import Rejected
from universal_reads import model_decision,SYSTEM
from test_read_surface import Universal as Fixture
from engine import Worker

class FormatRecovery(unittest.TestCase):
 def setUp(self):self.progress={'calls':[{'data':{'value':3}}],'steps':0};self.row={'id':'synthetic-job'}
 def call(self,raw,finish='stop'):
  with redirect_stdout(StringIO()):return model_decision({'content':raw,'finish_reason':finish},self.progress,self.row)
 def test_valid_object_is_unchanged(self):
  value={'action':'discover','platform':'wb'};self.assertEqual(self.call(json.dumps(value)),value);self.assertEqual(self.progress['steps'],1)
 def test_invalid_json_gets_diagnostic_not_fake_value(self):
  self.assertIsNone(self.call('{"action":"finish",'));self.assertEqual(self.progress['feedback']['code'],'INVALID_JSON');self.assertFalse(self.progress['feedback']['provider_request_executed']);self.assertIn('json_position',self.progress['feedback'])
 def test_duplicate_key_is_not_accepted_last_wins(self):
  self.assertIsNone(self.call('{"action":"read","action":"finish"}'));self.assertEqual(self.progress['feedback']['code'],'DUPLICATE_JSON_KEY')
 def test_nonfinite_number_is_not_accepted(self):
  self.assertIsNone(self.call('{"value":NaN}'));self.assertEqual(self.progress['feedback']['code'],'NONFINITE_JSON')
 def test_truncated_output_not_executed(self):
  self.assertIsNone(self.call('{"action":"finish"}','length'));self.assertEqual(self.progress['feedback']['code'],'LLM_INCOMPLETE')
 def test_scalar_or_list_not_command(self):
  self.assertIsNone(self.call('["read"]'));self.assertEqual(self.progress['feedback']['code'],'READ_PLANNER_SCHEMA')
 def test_missing_content_not_interpreted(self):
  self.assertIsNone(self.call(None));self.assertEqual(self.progress['feedback']['code'],'READ_MODEL_CONTENT_TYPE')
 def test_no_response_body_or_identifier_leak(self):
  buf=StringIO();raw='{"PRIVATE_SYNTHETIC_VALUE":"secret-value",'
  with redirect_stdout(buf):model_decision({'content':raw,'finish_reason':'stop'},self.progress,self.row)
  for text in [buf.getvalue(),json.dumps(self.progress)]:self.assertNotIn('PRIVATE_SYNTHETIC_VALUE',text);self.assertNotIn('secret-value',text)
  self.assertNotIn(self.row['id'],buf.getvalue())
 def test_source_responses_unchanged(self):
  before=deepcopy(self.progress['calls']);self.call('{oops');self.assertEqual(self.progress['calls'],before)
 def test_identical_format_error_without_progress_stops(self):
  self.call('{bad');self.call('{bad')
  with self.assertRaises(Rejected)as e:self.call('{bad')
  self.assertEqual(e.exception.code,'READ_NO_PROGRESS')
 def test_distinct_repairs_not_limited_to_twelve(self):
  for n in range(15):self.assertIsNone(self.call('{"different'+str(n)+'":'))
  value={'action':'finish','facts':[]};self.assertEqual(self.call(json.dumps(value)),value);self.assertEqual(self.progress['steps'],16)
 def test_prompt_command_examples_are_real_json(self):
  examples=[line for line in SYSTEM.splitlines()if line.startswith('{"action"')];self.assertGreaterEqual(len(examples),5)
  for line in examples:self.assertIsInstance(json.loads(line),dict)

class PreservedProviderRead(unittest.TestCase):
 setUp=Fixture.setUp
 tearDown=Fixture.tearDown
 ask=Fixture.ask
 finish=Fixture.finish
 def install_failure(self,finish='stop'):
  original=self.transport;outer=self;self.feedback_seen=[];self.injected=False
  class Transport:
   def prepare(self,*a):return None
   def execute(self,request,store=None):
    if request.operation=='deepseek_read_plan'and request.body['context']['calls']:
     outer.feedback_seen.append(deepcopy(request.body['context'].get('feedback')))
     if not outer.injected:
      outer.injected=True;outer.physical.append(request.operation)
      return {'content':'{"action":"finish",','finish_reason':finish},{'status':200,'elapsed_ms':1,'bytes':30}
    return original.execute(request,store)
  self.worker=Worker(self.engine,Transport())
 def test_invalid_finish_recovers_same_job_without_duplicate_api(self):
  self.install_failure();a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(self.physical.count('read.ozon.ozon_actions_list'),1);self.assertEqual(self.physical.count('deepseek_read_plan'),4)
 def test_repair_context_contains_existing_data_and_error(self):
  self.install_failure();a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY');self.assertTrue(any(x and x.get('code')=='INVALID_JSON'for x in self.feedback_seen));self.assertEqual(json.loads(r['result'])['data']['calls'][0]['data']['result'][0]['participating_products_count'],3)
 def test_length_failure_can_simplify_finish_without_reread(self):
  self.install_failure('length');a=self.ask();r=self.finish(a);self.assertEqual(r['state'],'READY',r['error']);self.assertEqual(self.physical.count('read.ozon.ozon_actions_list'),1)

del Fixture
if __name__=='__main__':
 suite=unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromTestCase(c)for c in [FormatRecovery,PreservedProviderRead]);r=unittest.TextTestRunner(verbosity=2).run(suite);print(json.dumps({'status':'PASS'if r.wasSuccessful()else'FAIL','tests':r.testsRun,'real_provider_calls':0}));raise SystemExit(0 if r.wasSuccessful()else 1)
