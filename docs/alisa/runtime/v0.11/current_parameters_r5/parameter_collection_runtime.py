"""LK-specific admission through the existing authenticated RuntimePort.

No browser fields become write claims. The private platform authority returns an
exact one-template invocation bound to an existing owner Query row. All source
execution still uses the same Worker/ledger. This is not a voice-scope expansion.
"""
from contextvars import ContextVar
from copy import deepcopy
from semantics import Rejected,fingerprint
from runtime_port_contract import task_shape
from parameter_support import parameter_contract as pc,parameter_producers as pp
import parameter_source_runtime as sources

ADMISSION=ContextVar('alisa_parameter_lk_admission',default=None)
SCHEMA='alisa-parameter-collection/v1'


def need(ok,code='PERMISSION_DENIED'):
    if not ok:raise Rejected(code)


def capability(engine):
    return {'schema':SCHEMA,'available':sources.enabled(engine)and isinstance(getattr(engine,'parameter_intent_authority',None),Authority),
      'producer_hash':pp.HASH,'definition_hash':pc.CATALOG_HASH,'pin':sources.PIN,'parameters':sorted(pc.CATALOG['parameters'])}


class Authority:
    def __init__(self,authority,repo):self.api=authority;self.repo=repo

    def call(self,payload):
        result=self.api.parameter_collection(payload)
        need(type(result)is dict and type(result.get('ok'))is bool,'DEPENDENCY_UNAVAILABLE')
        if not result['ok']:
            code=result.get('code');need(type(code)is str and code and code.replace('_','').isalnum(),'DEPENDENCY_UNAVAILABLE')
            raise Rejected(code)
        need(set(result)=={'ok','data'},'DEPENDENCY_UNAVAILABLE');return result['data']

    def admit(self,task,guard):
        value=self.call({'method':'admit','query_id':task['request_id'],'pins':guard['pins'],
                         'question_hash':fingerprint(task['query_input']['text']),'runtime_pin':sources.PIN})
        need(type(value)is dict and set(value)=={'admitted','intent','key','target','period','invocation'}and value['admitted']is True,'DEPENDENCY_UNAVAILABLE')
        need(value['key']in pc.CATALOG['parameters']and value['invocation']['template_id']==pc.definition(value['key'])['producer_template'],'DEPENDENCY_UNAVAILABLE')
        need(value['intent']['mode']in('preview','replace_calculated'),'DEPENDENCY_UNAVAILABLE')
        value['query_id']=task['request_id'];return value

    def describe(self,root,key,target,period,mode):
        admitted=root.get('parameter_admission')
        need(type(admitted)is dict and admitted['key']==key and admitted['target']==target and admitted['period']==period and admitted['intent']['mode']==mode,'PARAMETER_WRITE_INTENT_REQUIRED')
        need(self.current(admitted['intent'],target,period),'PARAMETER_WRITE_INTENT_REVOKED')
        return deepcopy(admitted['intent'])

    def current(self,intent,target,period):
        value=self.call({'method':'current','reference':intent['intent_ref'],'target':target,'period':period})
        return value=={'current':True}

    def commit(self,intent,target,period,envelope,verify,job_id):
        need(intent['mode']=='replace_calculated'and verify(target,period,envelope)is True,'PARAMETER_COMPLETION_UNQUALIFIED')
        try:
            value=self.call({'method':'commit','reference':intent['intent_ref'],'target':target,'period':period,
                             'envelope':envelope,'envelope_sha256':fingerprint(envelope),'job_id':job_id})
        except Rejected as error:
            if error.code!='DEPENDENCY_UNAVAILABLE':raise
            # The platform may already have committed. Retain the existing
            # source checkpoint and repeat only this exact idempotent commit.
            # The shared Worker owns deferral; no new task/collection is created.
            from repository import Deferred
            raise Deferred(self.repo.clock()+1)from None
        need(type(value)is dict and value.get('saved')is True,'PARAMETER_WRITE_NOT_CONFIRMED')
        return value


def attach(port):
    if callable(getattr(port.authority,'parameter_collection',None)):
        port.engine.parameter_intent_authority=Authority(port.authority,port.repo)


def submit(port,task,peer):
    need(capability(port.engine)['available'],'CAPABILITY_UNAVAILABLE')
    task=task_shape(task);need(task['request_id']==task['logical_query_id'],'VALIDATION_FAILED')
    _,guard,_=port._auth(task['context'],peer,'submit')
    admitted=port.engine.parameter_intent_authority.admit(task,guard)
    token=ADMISSION.set(admitted)
    try:return port.submit(task,peer)
    finally:ADMISSION.reset(token)


def mark():
    value=ADMISSION.get()
    if value is None:return None
    return fingerprint({k:v for k,v in value.items()if k!='intent'}|{'expected_revision':value['intent']['expected_revision'],'mode':value['intent']['mode']})


def pin(plan):
    value=ADMISSION.get()
    if value is not None:plan['parameter_admission']=deepcopy(value)


def authorized(engine,plan):
    value=plan.get('parameter_admission')
    if value is None:return True
    need(isinstance(getattr(engine,'parameter_intent_authority',None),Authority),'PARAMETER_WRITE_INTENT_REQUIRED')
    return engine.parameter_intent_authority.current(value['intent'],value['target'],value['period'])


def decision(plan):
    value=plan['parameter_admission']
    return {'action':'plan','complete':True,'missing':[],'requirements':[{'id':'explicit-parameter','description':'Явно выбранный в ЛК расчёт параметра','invocations':[value['invocation']['id']]}],'invocations':[deepcopy(value['invocation'])]}
