"""Apply exact additive runtime changes to an isolated copy, never live paths."""
from pathlib import Path
import json,shutil,hashlib,sys
ROOT=Path(__file__).resolve().parent

def change(path,old,new):
 s=path.read_text();assert s.count(old)==1,(path.name,old[:80]);path.write_text(s.replace(old,new))

def prepare(target,platform):
 target=target.resolve()
 assert target!=Path('/')and target!=Path('/opt')and '/opt/'not in str(target)and target.is_dir()
 expected=json.loads((ROOT/'BASELINE_RUNTIME.json').read_text())['files']
 for name,digest in expected.items():
  assert (target/name).is_file()and hashlib.sha256((target/name).read_bytes()).hexdigest()==digest,('BASELINE_CHANGED',name)
 shutil.copy2(ROOT/'parameter_source_runtime.py',target/'parameter_source_runtime.py')
 package=target/'parameter_support';package.mkdir(exist_ok=True);(package/'__init__.py').write_text('')
 for n in ['parameter_catalog.json','parameter_contract.py','parameter_producers.json','parameter_producers.py']:shutil.copy2(platform/n,package/n)
 p=target/'template_catalog.json';catalog=json.loads(p.read_text())
 for key,desc in [('loss_rate','Доля потерь исходно заказанных товаров: отмены, невыкупы и возвраты без повторного счёта. Отдельный расчёт за год по умолчанию или указанный период. Не фактический процент возвратов финансового дня.'),('delivery_mean','Средняя прямая и последняя доставка на исходно заказанную единицу. Отдельный годовой или указанный период; общая по магазину, без обратной логистики и обработки FBS.')]:
  tid='parameter.'+key+'.v1';assert tid not in catalog['templates']
  catalog['templates'][tid]={'id':tid,'version':1,'purpose':desc,'platforms':['ozon'],'kind':'parameter','parameter_key':key,
   'input_policy':{'time_axis':'parameter_period','snapshot':False,'period_required':False,'comparison_supported':False,'filters_supported':key=='loss_rate'},
   'steps':[{'id':'qualified_parameter_sources','platform':'ozon','operation':'parameter.'+key+'.v1','source_registry':'parameter_producers','params':{'period':'input.parameter_period','scope':'input.scope'}}],
   'metrics':[],'qualification':'parameter_source_policy','notes':['По умолчанию это предварительный расчёт. Не утверждай, что число сохранено, если результат не содержит saved=true. Укажи период, дату расчёта и использованные коэффициенты; pending не объявляй успешными продажами.']}
 p.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
 p=target/'template_catalog.py'
 change(p,"('scalar','compound','formula','dataset','event','information')","('scalar','compound','formula','dataset','event','information','parameter')")
 change(p,"    if t['kind']=='information':return True","    if t['kind']=='information':return True\n    if t['kind']=='parameter':\n        from parameter_source_runtime import available\n        return available(engine,t,store)")
 change(p,"def _input(call,t,today,now):\n", "def _input(call,t,today,now):\n    if t['kind']=='parameter':\n        from parameter_source_runtime import input_value\n        return input_value(call,t,today,now)\n")
 change(p,"            else:plan=None\n", "            elif group['kind']=='parameter':\n                from parameter_source_runtime import compile_plan\n                plan=compile_plan(engine,subscope,draft,t,root)\n            else:plan=None\n")
 # Explicit recipe-binding validation; descriptor fields cannot silently point to
 # an alternative operation while executing an old mapping.
 change(p,"        if t['kind']=='compound':\n            if any", "        if t['kind']=='parameter':\n            from parameter_support.parameter_contract import definition\n            rule=definition(t['parameter_key'])\n            expected={'id':'qualified_parameter_sources','platform':'ozon','operation':rule['producer_template'],'source_registry':'parameter_producers','params':{'period':'input.parameter_period','scope':'input.scope'}}\n            if t['id']!=rule['producer_template']or t['steps']!=[expected]or t['platforms']!=['ozon']:raise ValueError('TEMPLATE_PARAMETER_CONTRACT')\n        if t['kind']=='compound':\n            if any")
 p=target/'template_catalog.py';change(p,"        t=TEMPLATES[call['template_id']]\n        if t['kind']=='compound':","        t=TEMPLATES[call['template_id']]\n        if t['kind']=='parameter'and ancestors:raise TemplateGap('PARAMETER_DEPENDENCY_BINDING_REQUIRED')\n        if t['kind']=='compound':")
 p=target/'engine.py';change(p,"            scope = self.execution_scope(plan.get('runtime_guard'),plan['tenant'])\n            if 'universal_read'in plan:\n", "            scope = self.execution_scope(plan.get('runtime_guard'),plan['tenant'])\n            if 'parameter_source'in plan:\n                from parameter_source_runtime import authorized as parameter_authorized\n                return parameter_authorized(self,plan)\n            if 'universal_read'in plan:\n")
 p=target/'template_runtime.py';change(p,"def _run_fragment(worker,row,plan,progress,fragment):\n", "def _run_fragment(worker,row,plan,progress,fragment):\n    if fragment['kind']=='parameter':\n        from parameter_source_runtime import step\n        return step(worker,row,plan,progress,fragment)\n")
 p=target/'template_runtime.py';change(p,"        result_data={'templates':progress['completed_fragments']}\n", "        result_data={'templates':progress['completed_fragments']}\n        parameters=[{'template_ids':item['template_ids'],'result':item['data']}for item in progress['completed_fragments']if any(TEMPLATES[tid]['kind']=='parameter'for tid in item['template_ids'])]\n        if parameters:result_data['parameter_context']=parameters\n")
 p=target/'model_answer.py'
 change(p,"    if template_context or calculation_context:\n", "    parameter_context=result_data.get('parameter_context') if type(result_data)is dict else None\n    if template_context or calculation_context or parameter_context:\n")
 change(p,"        if calculation_context:api_data['calculation_context']=calculation_context\n", "        if calculation_context:api_data['calculation_context']=calculation_context\n        if parameter_context:api_data['parameter_context']=parameter_context\n")
 p=target/'report_archive.py';change(p,"    for tid in dependencies(template_id):\n        for step", "    for tid in dependencies(template_id):\n        if TEMPLATES[tid]['kind']=='parameter':continue\n        for step")
 p=target/'runtime.py'
 change(p,"        validate_selector_policy(d.get('selector_prompt'))\n        return d","        validate_selector_policy(d.get('selector_prompt'))\n        parameter_policy=d.get('parameter_sources')\n        if parameter_policy is not None:\n            from parameter_source_runtime import PIN\n            if type(parameter_policy)is not dict or type(parameter_policy.get('enabled'))is not bool or parameter_policy not in ({'enabled':False},{'enabled':True,'pin':PIN}):raise Rejected('CONFIG_SCHEMA')\n        return d")
 change(p,'    from legacy_voice import Authority\n    engine.legacy_voice_authority=Authority()',"    engine.parameter_source_policy=lambda:config.read().get('parameter_sources')\n    from legacy_voice import Authority\n    engine.legacy_voice_authority=Authority()")
 # Static model instructions contain no current user coefficients or permissions.
 p=target/'template_protocol.py';s=p.read_text();s+='\nSELECT_SYSTEM += \'\\nДля kind=parameter period задаёт период самого коэффициента, не день отчёта. Нет явного периода — period=null (год по умолчанию). parameter_mode=preview по умолчанию; режимы fill_missing/replace_calculated допустимы только при серверном разрешении конкретного намерения. Числа и команды записи не придумывай.\\n\'\n';p.write_text(s)
 return {str(p.relative_to(target)):hashlib.sha256(p.read_bytes()).hexdigest()for p in target.rglob('*')if p.is_file()and p.suffix in('.py','.json')and '__pycache__'not in p.parts}

if __name__=='__main__':
 target=Path(sys.argv[1]);platform=Path(sys.argv[2]);result=prepare(target,platform);print('PARAMETER_RUNTIME_CANDIDATE_READY',len(result))
