import json,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from copy import deepcopy
from unittest.mock import patch
from template_catalog import TEMPLATES,validate_catalog
from template_runtime import _finish_fragment
from model_answer import step,PENDING,API_DATA,DEFAULTS
class StockScope(unittest.TestCase):
 def test_selected_stock_contract_reaches_both_answer_routes(self):
  for metric in ['stock_fbo_units','stock_fbs_units','stock_fbo_reserved','stock_fbs_reserved']:
   for program in (False,True):
    with self.subTest(metric=metric,program=program):
     selected=[];tid='B15.'+metric
     repo=SimpleNamespace(clock=lambda:100.,stage_answer=lambda *args:selected.append(args[-1]))
     invocation={'id':'requested','template_id':tid,'store_id':'oz1','input':{'period':None}}
     plan={'selection':{'invocations':[invocation]},'fragments':[{'template_ids':[tid]}]}
     _finish_fragment(SimpleNamespace(repo=repo),{'id':'j','owner':'o'},plan,{'completed_fragments':[],'fragment_index':0},{})
     data=selected[0]['data'];contract=data['calculation_context'][0]
     self.assertEqual(contract['contract'],TEMPLATES[tid]['calculation_contract']);self.assertEqual(contract['invocation_id'],'requested');self.assertEqual(contract['store_id'],'oz1')
     self.assertNotIn('purpose',json.dumps(data));self.assertEqual(data['template_context'][0]['template_id'],tid)
     class Connection:
      def __enter__(self):return self
      def __exit__(self,*a):pass
     completed=[];repo.connection=lambda *a:Connection();repo.complete_answer=lambda *a:completed.append(a)
     row={'id':'j','owner':'o','draft':json.dumps({'original_question':'Сколько товаров на складах Озона?'})}
     engine=SimpleNamespace(authorized=lambda p:True)
     outgoing=[];worker=SimpleNamespace(repo=repo,engine=engine,transport=SimpleNamespace(model_source='model:synthetic'),_call=lambda r,req,**kw:outgoing.append(req.body))
     progress={PENDING:selected[0],API_DATA:[{'operation':'ozon_stocks','data':{'items':[{'stocks':[{'type':'fbo','present':3,'reserved':1},{'type':'fbs','present':100,'reserved':20}]}]}}], '_answer_instruction_snapshot':DEFAULTS,'_answer_execution':'program_v2'if program else'direct_v1'}
     if program:
      with patch('model_program.run')as run:step(worker,row,plan,progress)
      forwarded=run.call_args.args[3];self.assertEqual(forwarded['calculation_context'][0],contract)
     else:
      step(worker,row,plan,progress);forwarded=json.loads(outgoing[0]['messages'][-1]['content'].removeprefix(__import__('model_input_encoding').PREFIX));self.assertEqual(forwarded['calculation_context'][0],contract)
 def test_catalog_and_acquisition_stay_valid(self):
  validate_catalog()
  base=json.loads(Path(__file__).with_name('template_catalog.base.json').read_text())['templates']
  changed=[]
  for tid,t in TEMPLATES.items():
   if t!=base[tid]:
    changed.append(tid);self.assertEqual(set(k for k in t if t.get(k)!=base[tid].get(k)),{'version','notes','calculation_contract'})
  self.assertEqual(len(changed),4)
if __name__=='__main__':unittest.main()
