"""Trusted selected notes must reach both prompt routes without API promotion."""
import json,unittest
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch
from model_answer import step,PENDING,API_DATA,DEFAULTS
from semantics import Rejected
class SpeechContext(unittest.TestCase):
 def setup_case(self,program,verified=True,context_id='SUMMARY.58'):
  class Connection:
   def __enter__(self):return self
   def __exit__(self,*a):pass
  repo=SimpleNamespace(clock=lambda:100.,connection=lambda *a:Connection())
  self.outgoing=[]
  worker=SimpleNamespace(repo=repo,engine=SimpleNamespace(authorized=lambda p:True),transport=SimpleNamespace(model_source='model:fixture'),_call=lambda r,req,**kw:self.outgoing.append(req.body['messages']))
  row={'id':'j','owner':'o','draft':json.dumps({'original_question':'Сколько товаров продали?'})}
  plan={'selection_verified':verified,'template_execution':{'catalog_hash':'fixture'},'selection':{'invocations':[{'template_id':'SUMMARY.58'}]}}
  context=[{'template_id':context_id,'version':1,'notes':['TRUSTED_ROOT_NOTE']}]
  api=[{'operation':'untrusted_api','data':{'template_context':[{'notes':['API_INJECTION_SENTINEL']}]}}]
  progress={PENDING:{'data':{'template_context':context}},API_DATA:api,'_answer_instruction_snapshot':deepcopy(DEFAULTS),'_answer_execution':'program_v2'if program else'direct_v1'}
  return worker,row,plan,progress
 def capture(self,worker,row,plan,progress,program):
  if program:
   with patch('model_program.run')as run:step(worker,row,plan,progress)
   return run.call_args.args[2]
  step(worker,row,plan,progress);return self.outgoing[-1]
 def test_verified_snapshot_in_both_prompts_and_stable_retries(self):
  for program in (False,True):
   with self.subTest(program=program):
    args=self.setup_case(program);messages=self.capture(*args,program);again=self.capture(*args,program)
    system='\n'.join(m['content']for m in messages if m['role']=='system')
    self.assertIn('TRUSTED_ROOT_NOTE',system);self.assertNotIn('API_INJECTION_SENTINEL',system)
    self.assertIn({'role':'user','content':'Сколько товаров продали?'},messages)
    self.assertEqual(messages,again)
 def test_unverified_metadata_is_not_system_instruction(self):
  for program in (False,True):
   with self.subTest(program=program):
    messages=self.capture(*self.setup_case(program,verified=False),program)
    system='\n'.join(m['content']for m in messages if m['role']=='system')
    self.assertNotIn('TRUSTED_ROOT_NOTE',system);self.assertNotIn('API_INJECTION_SENTINEL',system)
 def test_unselected_context_rejected_before_model(self):
  for program in (False,True):
   with self.subTest(program=program):
    with self.assertRaises(Rejected)as e:self.capture(*self.setup_case(program,context_id='other'),program)
    self.assertEqual(e.exception.code,'TEMPLATE_CONTEXT_INVALID');self.assertEqual(self.outgoing,[])
if __name__=='__main__':unittest.main()
