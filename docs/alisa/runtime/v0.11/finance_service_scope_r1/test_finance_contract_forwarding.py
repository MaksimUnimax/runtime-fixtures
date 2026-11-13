"""Composed financial questions must carry both dependency contracts to the model."""
import json,unittest
from types import SimpleNamespace
from unittest.mock import patch
from template_catalog import TEMPLATES
from template_runtime import _finish_fragment
from model_answer import step,PENDING,API_DATA,DEFAULTS
class FinanceContracts(unittest.TestCase):
 def test_composed_contracts_reach_direct_and_program_answers(self):
  for root in ('SUMMARY.46','finance_storage_logistics','finance_storage_logistics_share'):
   for program in (False,True):
    with self.subTest(root=root,program=program):
     captured=[]
     repo=SimpleNamespace(clock=lambda:100.,stage_answer=lambda *args:captured.append(args[-1]))
     inv={'id':'asked','template_id':root,'store_id':'oz1','input':{'period':{'from':'2026-11-08','to':'2026-11-08'}}}
     plan={'selection':{'invocations':[inv]},'fragments':[{'template_ids':[root]}]}
     _finish_fragment(SimpleNamespace(repo=repo),{'id':'j','owner':'o'},plan,{'completed_fragments':[],'fragment_index':0},{})
     class Connection:
      def __enter__(self):return self
      def __exit__(self,*a):pass
     repo.connection=lambda *a:Connection()
     outgoing=[]
     worker=SimpleNamespace(repo=repo,engine=SimpleNamespace(authorized=lambda p:True),transport=SimpleNamespace(model_source='model:fixture'),_call=lambda r,req,**kw:outgoing.append(req.body))
     row={'id':'j','owner':'o','draft':json.dumps({'original_question':'Сколько вместе стоили хранение и логистика?'})}
     api=[{'operation':'ozon_finance','data':{'cashflows':{'services':[{'name':'logistics','amount':{'value':'-1686','currency_code':'RUB'}},{'name':'reverse_logistics','amount':{'value':'-158','currency_code':'RUB'}}]}}}]
     progress={PENDING:captured[0],API_DATA:api,'_answer_instruction_snapshot':DEFAULTS,'_answer_execution':'program_v2'if program else'direct_v1'}
     if program:
      with patch('model_program.run')as run:step(worker,row,plan,progress)
      forwarded=run.call_args.args[3]
     else:
      step(worker,row,plan,progress)
      from model_input_encoding import PREFIX
      forwarded=json.loads(outgoing[0]['messages'][-1]['content'].removeprefix(PREFIX))
     self.assertEqual(forwarded['responses'],api)
     contracts={c['template_id']:c for c in forwarded['calculation_context']}
     for tid in ('B06.finance_storage_cost','B06.finance_logistics_cost'):
      self.assertEqual(contracts[tid]['contract'],TEMPLATES[tid]['calculation_contract'])
      self.assertEqual(contracts[tid]['selected_template_id'],root)
      self.assertEqual(contracts[tid]['store_id'],'oz1')
      self.assertEqual(contracts[tid]['input'],inv['input'])
     self.assertNotIn('purpose',json.dumps(forwarded['calculation_context']))
if __name__=='__main__':unittest.main()
