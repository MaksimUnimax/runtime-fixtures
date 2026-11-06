"""In-memory bridge from approved graph captures to the qualified fresh normalizer.
No files with responses, second HTTP client or production authority are created.
Live raw-source recipes and the real issuer are deliberately not enabled here.
"""
from pathlib import Path
from copy import deepcopy
import hashlib,json,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'fresh_source'))
from normalized_source_engine import QualifiedSourceNormalizer,project_source,SourceError
from scenario_queue_adapter import ScenarioQueueAdapter
from semantics import Rejected,fingerprint
from matrix_core import MatrixError
from scenario_bindings import BindingError
from owner_inputs import InputError
from report_contracts import ContractError
from cost_source_selector import SelectionError


def need(ok,code):
 if not ok:raise Rejected(code)


class MemoryNormalizer(QualifiedSourceNormalizer):
 def __init__(self,policy,plan,outputs,now,scope_guard):
  self.policy=deepcopy(policy);self.now=int(now);self.hash=fingerprint(self.policy)
  self.code_hash=fingerprint({'memory_adapter':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                               'normalizer':hashlib.sha256((ROOT/'fresh_source/normalized_source_engine.py').read_bytes()).hexdigest()})
  self.scope_guard=scope_guard;self.data={};self.documents={};self.proofs={}
  self.manifest={'state':'ACQUIRED_COMPLETE','scope_hash':plan['graph_inputs']['payload']['scope_hash'],
                 'period':plan['period'],'started_utc':plan['graph_inputs']['payload']['started_utc'],
                 'sources':{}}
  roles={spec['source']for spec in self.policy['tables'].values()}
  need(set(outputs)==roles,'GRAPH_RAW_SOURCE_SET')
  for role in sorted(roles):
   source=outputs[role]
   need(type(source)is dict and source.get('complete')is True and type(source.get('captures'))is list
        and source['captures'],'GRAPH_RAW_SOURCE_INCOMPLETE')
   docs=[]
   for capture in source['captures']:
    need(set(capture)=={'data','body_hash','recipe_hash','period','observed_at','call_id'}
         and capture['body_hash']==fingerprint(capture['data']),'GRAPH_RAW_CAPTURE_CHANGED')
    need(type(capture['observed_at'])is int and capture['observed_at']<=now<
         capture['observed_at']+policy['max_age_seconds'],'GRAPH_RAW_CAPTURE_EXPIRED')
    proof={'source':role,'body_hash':capture['body_hash'],'recipe_hash':capture['recipe_hash'],
           'observed_at':capture['observed_at'],'expires_at':capture['observed_at']+policy['max_age_seconds'],
           'period':capture['period']}
    docs.append((deepcopy(capture['data']),proof))
   self.documents[role]=docs
   self.manifest['sources'][role]={'period':docs[0][1]['period']}
  for name,spec in self.policy['tables'].items():self.data[name]=project_source(policy,spec,self.documents[spec['source']])
  self.source_hash=fingerprint({role:[proof for _,proof in docs]for role,docs in self.documents.items()})
  self.expiry=min(plan['task_graph']['deadline'],min(proof['expires_at']for docs in self.documents.values()for _,proof in docs))


class FreshScenarioQueueAdapter:
 def __init__(self,authority,policy=None):
  self.policy=deepcopy(policy or json.loads((ROOT/'fresh_source/normalization_catalog.json').read_text()))
  self.policy_hash=fingerprint(self.policy);self.authority=authority
  # Existing catalog expansion is deterministic and reads pinned source catalogs.
  shell=object.__new__(QualifiedSourceNormalizer);shell.policy=self.policy
  selection,c,g,o=shell.catalogs()
  self.renderer=ScenarioQueueAdapter(lambda *a:False,scenario=c,owner=o,gates=g)
  self.pin=fingerprint({'adapter':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                       'normalizer':hashlib.sha256((ROOT/'fresh_source/normalized_source_engine.py').read_bytes()).hexdigest(),
                       'policy':self.policy_hash,'calculation':self.renderer.pin})
 def _allow(self,action,plan):
  if not callable(self.authority):return False
  try:return self.authority(action,deepcopy(plan))is True
  except Exception:return False
 def authorize_plan(self,plan,now,action):
  try:
   inputs=plan['graph_inputs']['payload']
   return (fingerprint(self.policy)==self.policy_hash and set(inputs)==
           {'owner_profile','scope_hash','started_utc','lookup_day'} and
           inputs['owner_profile']==self.policy['owner_profile'] and
           self._allow(action,plan))
  except (TypeError,KeyError,ValueError):return False
 def execute(self,plan,inputs,outputs,now):
  need(self.authorize_plan(plan,now,'execute'),'GRAPH_RAW_AUTH_DENIED')
  try:
   normalizer=MemoryNormalizer(self.policy,plan,outputs,now,lambda:self._allow('execute',plan))
   calculated=normalizer.calculate()
  except (MatrixError,BindingError,InputError,ContractError,SelectionError)as exc:
   raise Rejected(exc.code)from None
  except SourceError as exc:
   code=str(exc)
   need(code.replace('_','').isalnum() and len(code)<=80,'GRAPH_RAW_SOURCE_INVALID')
   raise Rejected(code)from None
  result=calculated['result']
  need(result['status']=='CALCULATED','GRAPH_RAW_SCENARIO_BLOCKED')
  value={'schema':'alice-queued-raw-scenario/v1','adapter_pin':self.pin,
         'input_hash':plan['task_graph']['input_hash'],'valid_until':normalizer.expiry,
         'result':result,'source_hash':normalizer.source_hash,
         'source_count':len(outputs),'calculation_pin':normalizer.artifacts['pin']}
  value['sha256']=fingerprint(value)
  return value
 def check(self,value,plan,now):
  try:
   need(self.authorize_plan(plan,now,'read'),'GRAPH_RAW_AUTH_DENIED')
   need(type(value)is dict and set(value)=={'schema','adapter_pin','input_hash','valid_until',
           'result','source_hash','source_count','calculation_pin','sha256'},'GRAPH_RAW_RESULT_SCHEMA')
   need(value['schema']=='alice-queued-raw-scenario/v1' and value['adapter_pin']==self.pin
        and value['input_hash']==plan['task_graph']['input_hash'] and value['sha256']==fingerprint(
            {k:v for k,v in value.items()if k!='sha256'}),'GRAPH_RAW_RESULT_CHANGED')
   need(self.expiry(value,plan)>now,'GRAPH_RAW_RESULT_EXPIRED')
   r=value['result'];need(r['status']=='CALCULATED' and r['result_sha256']==fingerprint(
       {k:v for k,v in r.items()if k!='result_sha256'}),'GRAPH_RAW_RESULT_CHANGED')
   return True
  except (Rejected,TypeError,KeyError,ValueError):return False
 def expiry(self,value,plan):
  need(type(value['valid_until'])is int and value['valid_until']<=plan['task_graph']['deadline'],
       'GRAPH_RAW_RESULT_EXPIRED')
  return value['valid_until']
 def render(self,value,stamp):return self.renderer.render(value,stamp)
