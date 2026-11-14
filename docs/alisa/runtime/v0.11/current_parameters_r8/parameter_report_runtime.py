"""Registered compound report using the current Worker, sources and authority.

Coefficient values only exist transiently while preparing/fencing the final answer.
Saved progress contains source facts, signed scope references and dependency plans,
not snapshots of old coefficient values or a second queue.
"""
from copy import deepcopy
from dataclasses import asdict
from pathlib import Path
from datetime import datetime,timezone
import hashlib,json
from semantics import Scope,Store,Rejected,canonical_json,strict_json,fingerprint
from parameter_support import parameter_report_contract as spec
from parameter_support import parameter_dependencies as dep
from parameter_support import parameter_contract as pc
import parameter_source_runtime as sources
import parameter_collection_runtime as collection
SCHEMA='alice-parameterized-report/v1'
PREFIX='r8:'
PIN=fingerprint({'source':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'report_catalog':spec.HASH,'bindings':dep.CATALOG,'support_code':{m.__name__:hashlib.sha256(Path(m.__file__).read_bytes()).hexdigest()for m in(spec,dep,pc)}})


def need(ok,code='PARAMETER_REPORT_SCHEMA'):
 if not ok:raise Rejected(code)


def enabled(engine):
 policy=getattr(engine,'parameter_compound_policy',None)
 if callable(policy):policy=policy()
 return type(policy)is dict and policy.get('enabled')is True and policy=={'enabled':True,'pin':PIN}


class Authority(collection.Authority):
 def current(self,intent,target,period):
  if not intent.get('intent_ref','').startswith(PREFIX):return super().current(intent,target,period)
  return self.call({'method':'report_dependency_current','reference':intent['intent_ref'],'target':target,'period':period})=={'current':True}
 def commit(self,intent,target,period,envelope,verify,job_id):
  if not intent.get('intent_ref','').startswith(PREFIX):return super().commit(intent,target,period,envelope,verify,job_id)
  need(intent['mode']=='fill_missing'and verify(target,period,envelope)is True,'PARAMETER_COMPLETION_UNQUALIFIED')
  try:
   return self.call({'method':'report_fill','reference':intent['intent_ref'],'target':target,'period':period,
      'envelope':envelope,'envelope_sha256':fingerprint(envelope),'job_id':job_id})
  except Rejected as error:
   if error.code!='DEPENDENCY_UNAVAILABLE':raise
   from repository import Deferred
   raise Deferred(self.repo.clock()+1)from None


def attach(port):
 if isinstance(getattr(port.engine,'parameter_intent_authority',None),collection.Authority):
  port.engine.parameter_intent_authority=Authority(port.authority,port.repo)


def available(engine,template,store):
 return enabled(engine)and isinstance(getattr(engine,'parameter_intent_authority',None),Authority)and store.platform=='ozon'and template.get('parameter_report')in spec.CATALOG['reports']


def input_value(call,template,today,now):
 try:value=spec.normalized_input(call['input'])
 except pc.ParameterError as error:raise Rejected(error.code)from None
 return {'period':value['period'],'comparison':None,'filters':{},'group_by':'marketplace','snapshot':False,
         'calendar_date':today,'timezone':'Europe/Moscow','parameter_periods':value['parameter_periods']}


def compile_plan(engine,scope,draft,template,root,invocation_id):
 need(len(scope.stores)==1 and available(engine,template,scope.stores[0]),'PARAMETER_REPORT_NOT_ENABLED')
 need(type(root.get('runtime_guard'))is dict,'PARAMETER_REPORT_AUTHORITY_REQUIRED')
 rule=spec.definition(template['parameter_report']);normalized=spec.normalized_input({'period':draft['period'],'parameter_periods':draft['parameter_periods']})
 from template_catalog import compile_selection
 call={'id':'report-source','template_id':rule['base_template'],'store_id':scope.stores[0].id,'input':{'period':normalized['period']}}
 selection={'action':'plan','complete':True,'missing':[],'requirements':[{'id':'source','description':'Registered source','invocations':['report-source']}],'invocations':[call]}
 child=compile_selection(engine,root,selection);need(len(child)==1 and child[0]['kind']=='scalar','PARAMETER_REPORT_SOURCE')
 return {'schema':SCHEMA,'tenant':scope.tenant,'access_revision':scope.revision,'stores':[asdict(s)for s in scope.stores],
         'question':root['question'],'calendar_date':root['calendar_date'],'timezone':'Europe/Moscow','freshness_seconds':0,
         'parameter_report':{'pin':PIN,'template_id':template['parameter_report'],'invocation_id':invocation_id,'input':normalized,'child':child[0]}}


def authorized(engine,plan):
 try:
  if not enabled(engine)or plan.get('schema')!=SCHEMA:return False
  info=plan['parameter_report'];rule=spec.definition(info['template_id'])
  if info['pin']!=PIN or info['input']!=spec.normalized_input(info['input']):return False
  scope=engine.execution_scope(plan.get('runtime_guard'),plan['tenant'])
  actual={s.id:asdict(s)for s in scope.stores}
  if plan['access_revision']!=scope.revision or any(actual.get(s['id'])!=s for s in plan['stores']):return False
  child=info['child'];return(child['template_ids']==[rule['base_template']]and child['plan']['period']==info['input']['period']and child['plan']['stores']==plan['stores']and child['plan']['metrics']==rule['metrics']and engine.authorized(child['plan']))
 except Rejected as error:
  if error.code=='DEPENDENCY_UNAVAILABLE':raise
  return False
 except (ValueError,KeyError,TypeError):return False


def _api(worker):
 value=getattr(worker.engine,'parameter_intent_authority',None);need(isinstance(value,Authority),'PARAMETER_REPORT_AUTHORITY_REQUIRED');return value


def _current_report(worker,reference):
 need(_api(worker).call({'method':'report_current','reference':reference})=={'current':True},'PARAMETER_REPORT_REVOKED')


class ReportWorker:
 """Recheck the admitted report principal just before actual provider send."""
 def __init__(self,worker,reference):
  self.parent=worker;self.references=reference if type(reference)is list else[reference]
 def __getattr__(self,key):return getattr(self.parent,key)
 def execution_ready(self):
  for reference in self.references:_current_report(self.parent,reference)
  previous=getattr(self.parent,'execution_ready',None)
  if previous is not None:previous()
 def _call(self,row,request,store=None,**kwargs):
  prior=kwargs.pop('before_dispatch',None)
  def current():
   self.execution_ready()
   if prior is not None:prior()
  return self.parent._call(row,request,store,before_dispatch=current,**kwargs)


def _bind(worker,row,root,fragment):
 info=fragment['plan']['parameter_report'];guard=root['runtime_guard']
 with worker.repo.connection()as c:
  refs=c.execute('SELECT logical_id FROM rt_job_refs WHERE jid=? AND tenant=? AND actor=?',(row['id'],guard['pins']['tenant_id'],guard['pins']['actor_id'])).fetchall()
 need(len(refs)==1,'PARAMETER_REPORT_JOB_AMBIGUOUS')
 return _api(worker).call({'method':'report_bind','query_id':refs[0]['logical_id'],'pins':guard['pins'],'template_id':info['template_id'],
   'invocation_id':info['invocation_id'],'runtime_store_id':fragment['plan']['stores'][0]['id'],'input':info['input'],'question_hash':fingerprint(root['question']),'job_id':row['id']})


def _producer_fragment(worker,root,descriptor,child_id):
 target=descriptor['target'];store=next(s for s in root['stores']if s['id']==target['store_id'])
 template={'parameter_key':descriptor['key']}
 draft={'scope':target['scope'],'parameter_period':descriptor['period'],'parameter_mode':'fill_missing','question':root['question'],'calendar_date':root['calendar_date']}
 local_root={**root,'parameter_admission':descriptor}
 plan=sources.compile_plan(worker.engine,Scope(root['tenant'],root['access_revision'],(Store(**store),)),draft,template,local_root)
 worker.engine.pin_execution(plan,root['runtime_guard'])
 return {'id':child_id,'kind':'parameter','plan':plan,'draft':draft,'template_ids':[pc.definition(descriptor['key'])['producer_template']]}


def _check_source(fragment,data):
 store=fragment['plan']['stores'][0]['id'];rule=spec.definition(fragment['plan']['parameter_report']['template_id'])
 need(type(data)is list and len(data)==1 and data[0].get('complete')is True and data[0].get('store_id')==store,'PARAMETER_REPORT_SOURCE')
 metrics=data[0].get('values');need(type(metrics)is dict and set(metrics)==set(rule['metrics']),'PARAMETER_REPORT_SOURCE')
 for v in metrics.values():need(pc.number(v)>=0,'PARAMETER_REPORT_SOURCE')
 return deepcopy(metrics)


def step(worker,row,root,progress,fragment):
 from template_runtime import _save,_finish_fragment,_FragmentRepo
 need(authorized(worker.engine,fragment['plan'])and worker.engine.authorized(root),'SOURCE_ACCESS')
 state=progress.get('fragment_progress')or{'phase':'bind','reference':None,'child_progress':None,'producer':None,'source_data':None}
 if state['reference']is not None:_current_report(worker,state['reference'])
 def save(until=None):progress['fragment_progress']=state;return _save(worker.repo,row,progress,until)
 if state['phase']=='bind':
  resolved=_bind(worker,row,root,fragment)if state['reference']is None else _api(worker).call({'method':'report_refresh','reference':state['reference']})
  state['reference']=resolved['reference']
  if not resolved['ready']:
   need(resolved['producers'],'PARAMETER_DEPENDENCIES_PENDING');state['producer']=_producer_fragment(worker,root,resolved['producers'][0],fragment['id']+':fill')
   state['phase']='fill';state['child_progress']=None
  else:state['phase']='source'if state['source_data']is None else'ready'
  save();return
 if state['phase']=='fill':
  def saved(packed,until=None):state['child_progress']=packed;save(until)
  def filled(result):
   need(result.get('saved')is True,'PARAMETER_WRITE_NOT_CONFIRMED')
   state.update(phase='bind',producer=None,child_progress=None);save()
  sources.step(ReportWorker(worker,state['reference']),row,root,{'fragment_progress':state['child_progress']},state['producer'],save_progress=saved,on_complete=filled);return
 if state['phase']=='source':
  child=fragment['plan']['parameter_report']['child']
  class Nested(_FragmentRepo):
   def __init__(self):self.base=worker.repo;self.claimed=False
   def claim(self):
    if self.claimed:return None
    self.claimed=True;draft=strict_json(row['draft']);draft.update(child['draft']);draft['answer_by_model']=True
    return {**dict(row),'plan':canonical_json(child['plan']),'draft':canonical_json(draft),'progress':canonical_json(state['child_progress'])if state['child_progress']is not None else None}
   def reschedule(self,jid,owner,progress=None,until=None):
    if progress is not None:state['child_progress']=progress
    return save(until)
   def stage_answer(self,jid,owner,result,progress=None):
    state['source_data']=_check_source(fragment,result['data']);state['child_progress']=None;state['phase']='ready';return save()
  from engine import Worker
  child_worker=Worker(worker.engine,worker.transport);child_worker.repo=Nested();child_worker._call=lambda r,request,store=None,**kw:ReportWorker(worker,state['reference'])._call(row,request,store,**kw)
  child_worker.step();return
 need(state['phase']=='ready'and state['source_data']is not None,'PARAMETER_REPORT_STATE')
 marker={'schema':SCHEMA,'template_id':fragment['plan']['parameter_report']['template_id'],'reference':state['reference'],'source_data':state['source_data'],'fragment_id':fragment['id']}
 _finish_fragment(worker,row,root,progress,{'compound_parameter_report':marker})


def markers(progress):
 from model_answer import PENDING
 data=progress[PENDING].get('data',{})
 if type(data)is not dict:return []
 return [item['data']['compound_parameter_report']for item in data.get('templates',[])if type(item)is dict and type(item.get('data'))is dict and 'compound_parameter_report'in item['data']]


def prepare_answer(worker,row,root,progress):
 """Resolve values in memory. A late missing value resumes fill in the same job."""
 from model_answer import PENDING
 items=markers(progress)
 if not items:return [],[]
 need(enabled(worker.engine),'PARAMETER_REPORT_NOT_ENABLED')
 contexts=[];fences=[]
 for marker in items:
  result=_api(worker).call({'method':'report_refresh','reference':marker['reference']})
  if not result['ready']:
   state=progress.get('_compound_fill')
   if state is None:
    need(result['producers'],'PARAMETER_DEPENDENCIES_PENDING')
    state={'fragment':_producer_fragment(worker,root,result['producers'][0],marker['fragment_id']+':late-fill'),'child_progress':None,'reference':marker['reference']}
   need(state['reference']==marker['reference'],'PARAMETER_REPORT_STATE')
   def saved(packed,until=None):
    state['child_progress']=packed;progress['_compound_fill']=state;worker.repo.reschedule(row['id'],row['owner'],progress,until)
   def filled(reply):
    need(reply.get('saved')is True,'PARAMETER_WRITE_NOT_CONFIRMED');progress.pop('_compound_fill',None);worker.repo.reschedule(row['id'],row['owner'],progress)
   sources.step(ReportWorker(worker,state['reference']),row,root,{'fragment_progress':state['child_progress']},state['fragment'],save_progress=saved,on_complete=filled)
   return None,None
  calculated=spec.evaluate(marker['template_id'],marker['source_data'],result['inputs'])
  contexts.append({'template_id':marker['template_id'],'source_metrics':deepcopy(marker['source_data']),'estimates':calculated,'parameters_used':result['basis'],'not_profit':True})
  fences.append((marker['reference'],result['checkpoint']))
 return contexts,fences


def answer_generation(worker,row,progress,fences):
 """A recovery belongs to the exact parameter revisions first dispatched.

 A resumed plugin result is fenced against its original revisions, not against
 fresh values read while recovering. Only after discarding the obsolete result
 can the same report start another final-answer generation.
 """
 if not fences:return fences,None
 if not progress.get('_program_started'):
  progress['_compound_answer_fences']=deepcopy(fences)
  progress['_compound_answer_generation']=fingerprint(fences)
  with worker.repo.connection(True)as c:
   worker.repo._owned(c,row['id'],row['owner'])
   c.execute('UPDATE jobs SET progress=?WHERE id=?',(canonical_json(progress),row['id']))
 need('_compound_answer_fences'in progress and '_compound_answer_generation'in progress,'PARAMETER_ANSWER_RECOVERY_UNPINNED')
 return deepcopy(progress['_compound_answer_fences']),progress['_compound_answer_generation']


def fence_answer(worker,row,progress,fences):
 for reference,checkpoint in fences:
  value=_api(worker).call({'method':'report_fence','reference':reference,'checkpoint':checkpoint})
  if value!={'current':True}:
   # Discard the stale response, not the fetched marketplace facts. The next
   # final-answer pass rebinds current values (or fills only newly empty slots).
   for key in ('_program_started','_program_started_at','_program_recovery_at','_compound_answer_fences','_compound_answer_generation'):
    progress.pop(key,None)
   worker.repo.reschedule(row['id'],row['owner'],progress)
   return False
 return True
