import json,unittest
from unittest.mock import patch
from semantics import Rejected,strict_json
import read_surface as rs
import test_model_answer as af
class Feedback(unittest.TestCase):
 def test_original_validator_reports_string_type(self):
  with self.assertRaises(Rejected)as e:rs.build('ozon','marketplace_search_queries_text',{'text':'песок','limit':10,'offset':0})
  self.assertEqual(e.exception.code,'INVALID_OPERATION_PARAMS');self.assertEqual(e.exception.contract_feedback['field'],'params.limit');self.assertEqual(e.exception.contract_feedback['expected_json_type'],'string')
 def test_valid_strings_are_not_changed(self):
  p={'text':'песок','limit':'10','offset':'0'};self.assertEqual(json.loads(rs.build('ozon','marketplace_search_queries_text',p)['body']),p)
 def test_unknown_field_not_silently_accepted(self):
  with self.assertRaises(Rejected):rs.build('ozon','marketplace_search_queries_text',{'text':'песок','limit':'10','offset':'0','url':'https://invalid.example'})
 def test_no_actual_values_in_feedback(self):
  with self.assertRaises(Rejected)as e:rs.build('ozon','marketplace_search_queries_text',{'text':'PRIVATE_INPUT_TEXT','limit':10,'offset':0})
  self.assertNotIn('PRIVATE_INPUT_TEXT',json.dumps(e.exception.contract_feedback))
 def test_model_can_not_select_arbitrary_feedback_type(self):
  from subprocess import CompletedProcess
  bad={'ok':False,'error':'INVALID_OPERATION_PARAMS','field':'params.limit','expected_type':'execute_python'}
  with patch('read_surface.subprocess.run',return_value=CompletedProcess([],2,json.dumps(bad),'')):
   with self.assertRaises(Rejected)as e:rs.build('ozon','marketplace_search_queries_text',{'text':'a','limit':10,'offset':0})
  self.assertFalse(hasattr(e.exception,'contract_feedback'))
class Pipeline(unittest.TestCase):
 setUp=af.AnswerFlow.setUp;tearDown=af.AnswerFlow.tearDown;ask=af.AnswerFlow.ask;run_job=af.AnswerFlow.run_job
 def test_repair_keeps_same_value_and_sends_only_one_provider_request(self):
  self.transport.decisions=[{'action':'read','store_id':'oz1','operation':'marketplace_search_queries_text','params':{'text':'песок','limit':10,'offset':0}},{'action':'read','store_id':'oz1','operation':'marketplace_search_queries_text','params':{'text':'песок','limit':'10','offset':'0'}},{'action':'data_ready'}]
  a=self.ask('Популярные поисковые запросы со словом песок на Озоне');row=self.run_job(a);self.assertEqual(row['state'],'READY',row['error'])
  planning=[c for c in self.transport.calls if c.operation=='deepseek_read_plan'];feedback=planning[1].body['context']['feedback'];self.assertEqual(feedback['parameter_error']['expected_json_type'],'string');self.assertEqual(sum(c.operation.startswith('read.')for c in self.transport.calls),1)
if __name__=='__main__':unittest.main()
