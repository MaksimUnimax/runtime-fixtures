"""Add R8 to a pinned isolated R5 copy; never edit /opt or an active release."""
from pathlib import Path
import json,shutil,hashlib,sys
ROOT=Path(__file__).resolve().parent

def change(path,old,new):
 text=path.read_text();assert text.count(old)==1,(path.name,old[:90]);path.write_text(text.replace(old,new))

def prepare(target,platform):
 target=target.resolve();assert target.is_dir()and not str(target).startswith('/opt/')
 for name,digest in json.loads((ROOT/'BASELINE.json').read_text()).items():assert hashlib.sha256((target/name).read_bytes()).hexdigest()==digest,('BASELINE_CHANGED',name)
 shutil.copy2(ROOT/'parameter_report_runtime.py',target/'parameter_report_runtime.py')
 for name in ['parameter_dependencies.py','parameter_dependency_catalog.json','parameter_resolution.py','parameter_report_catalog.json','parameter_report_contract.py']:
  shutil.copy2(platform/name,target/'parameter_support'/name)
 catalog=json.loads((target/'template_catalog.json').read_text());reports=json.loads((platform/'parameter_report_catalog.json').read_text())['reports']
 for tid,rule in reports.items():
  assert tid not in catalog['templates']
  catalog['templates'][tid]={'id':tid,'version':1,'purpose':rule['label']+' Это оценки, не прибыль и не фактические выкупы.',
   'platforms':['ozon'],'kind':'compound','parameter_report':tid,
   'input_policy':{'time_axis':'order_period','snapshot':False,'period_required':True,'comparison_supported':False,'filters_supported':False},
   'steps':[{'id':'ordered','template':rule['base_template']}],'metrics':rule['metrics'],'qualification':'existing_parameter_report_sources','notes':rule['notes']}
 (target/'template_catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
 p=target/'template_catalog.py'
 change(p,"        if t['kind']=='compound':\n            if any", "        if t.get('parameter_report'):\n            from parameter_support.parameter_report_contract import definition\n            rule=definition(t['parameter_report'])\n            if t['id']!=t['parameter_report']or t['kind']!='compound'or t['steps']!=[{'id':'ordered','template':rule['base_template']}]or t['metrics']!=rule['metrics']:raise ValueError('PARAMETER_REPORT_CONTRACT')\n        if t['kind']=='compound':\n            if any")
 change(p,"    if t['kind']=='information':return True", "    if t.get('parameter_report'):\n        from parameter_report_runtime import available\n        return available(engine,t,store)\n    if t['kind']=='information':return True")
 change(p,"def _input(call,t,today,now):\n", "def _input(call,t,today,now):\n    if t.get('parameter_report'):\n        from parameter_report_runtime import input_value\n        return input_value(call,t,today,now)\n")
 change(p,"        if t['kind']=='compound':\n            for step in t['steps']:expand", "        if t['kind']=='compound'and not t.get('parameter_report'):\n            for step in t['steps']:expand")
 change(p,"        bucket='scalar'if t['kind']in('scalar','compound','formula')else t['kind']", "        bucket='parameterized'if t.get('parameter_report')else'scalar'if t['kind']in('scalar','compound','formula')else t['kind']")
 change(p,"            if group['kind']=='scalar':\n", "            if group['kind']=='parameterized':\n                from parameter_report_runtime import compile_plan\n                plan=compile_plan(engine,subscope,draft,t,root,group['invocations'][0])\n            elif group['kind']=='scalar':\n")
 p=target/'engine.py';change(p,"            if 'parameter_source'in plan:\n", "            if 'parameter_report'in plan:\n                from parameter_report_runtime import authorized as report_authorized\n                return report_authorized(self,plan)\n            if 'parameter_source'in plan:\n")
 p=target/'template_runtime.py';change(p,"def _run_fragment(worker,row,plan,progress,fragment):\n", "def _run_fragment(worker,row,plan,progress,fragment):\n    if fragment['kind']=='parameterized':\n        from parameter_report_runtime import step\n        return step(worker,row,plan,progress,fragment)\n")
 p=target/'parameter_source_runtime.py';change(p,"def step(worker,row,root,progress,fragment):", "def step(worker,row,root,progress,fragment,*,save_progress=None,on_complete=None):")
 change(p,"        progress['fragment_progress']=_seal(worker.repo,row,fragment,state);return _save(worker.repo,row,progress,until)","        progress['fragment_progress']=_seal(worker.repo,row,fragment,state)\n        if save_progress is not None:return save_progress(progress['fragment_progress'],until)\n        return _save(worker.repo,row,progress,until)")
 change(p,"            _finish_fragment(worker,row,root,progress,result);return", "            if on_complete is not None:on_complete(result)\n            else:_finish_fragment(worker,row,root,progress,result)\n            return")
 p=target/'parameter_collection_runtime.py';change(p,"        port.engine.parameter_intent_authority=Authority(port.authority,port.repo)","        port.engine.parameter_intent_authority=Authority(port.authority,port.repo)\n        from parameter_report_runtime import attach as report_attach\n        report_attach(port)")
 p=target/'model_answer.py';change(p,"    api_data = progress[API_DATA]\n", "    from parameter_report_runtime import prepare_answer\n    compound_context,compound_fences=prepare_answer(worker,row,plan,progress)\n    if compound_context is None:return\n    api_data = progress[API_DATA]\n")
 change(p,"    if template_context or calculation_context or parameter_context:","    if template_context or calculation_context or parameter_context or compound_context:")
 change(p,"        if parameter_context:api_data['parameter_context']=parameter_context", "        if parameter_context:api_data['parameter_context']=parameter_context\n        if compound_context:api_data['compound_parameter_context']=compound_context")
 change(p,"        result = dict(progress[PENDING], complete=True, pages=pages(response['content']))", "        from parameter_report_runtime import fence_answer\n        if not fence_answer(worker,row,progress,compound_fences):return\n        result = dict(progress[PENDING], complete=True, pages=pages(response['content']))")
 p=target/'model_answer.py'
 change(p,"    if compound_context is None:return\n", "    if compound_context is None:return\n    from parameter_report_runtime import answer_generation\n    compound_fences,compound_generation=answer_generation(worker,row,progress,compound_fences)\n")
 change(p,"        run(worker,row,body['messages'],api_data,on_complete=received)","        if compound_generation is None:run(worker,row,body['messages'],api_data,on_complete=received)\n        else:run(worker,row,body['messages'],api_data,on_complete=received,generation=compound_generation)")
 change(p,"    compound_fences,compound_generation=answer_generation(worker,row,progress,compound_fences)\n","    compound_fences,compound_generation=answer_generation(worker,row,progress,compound_fences)\n    from parameter_report_runtime import ReportWorker\n    answer_worker=ReportWorker(worker,[reference for reference,_ in compound_fences])if compound_fences else worker\n")
 change(p,"        else:run(worker,row,body['messages'],api_data,on_complete=received,generation=compound_generation)","        else:run(answer_worker,row,body['messages'],api_data,on_complete=received,generation=compound_generation)")
 change(p,"        worker._call(row, request, on_received=received)","        answer_worker._call(row, request, on_received=received)")
 p=target/'model_program.py'
 change(p,"def run(worker,row,messages,api_data,*,socket_path=SOCKET,on_complete=None):","def run(worker,row,messages,api_data,*,socket_path=SOCKET,on_complete=None,generation=None):")
 change(p,"send({'protocol':2,'job_id':hashlib.sha256((row['tenant']+'\\0'+row['id']).encode()).hexdigest(),","send({'protocol':2,'job_id':hashlib.sha256((row['tenant']+'\\0'+row['id']+(''if generation is None else'\\0parameter-revision:'+generation)).encode()).hexdigest(),")
 p=target/'runtime.py';change(p,"    engine.parameter_source_policy=lambda:config.read().get('parameter_sources')", "    engine.parameter_source_policy=lambda:config.read().get('parameter_sources')\n    engine.parameter_compound_policy=lambda:config.read().get('parameter_compounds')")
 # The isolated candidate exposes no new live route or deployment command.

if __name__=='__main__':prepare(Path(sys.argv[1]),Path(sys.argv[2]))
