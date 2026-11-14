"""Explicit LK collection on the existing Query queue and private authority RPC.

Continuation stores only current request intent/technical outcome, never old
coefficient values, browser tokens or an independent collection queue. Native
runtime is trusted to attest its own qualified ledger; it cannot choose a new
owner/period/parameter or mint permission from a model response.
"""
from copy import deepcopy
from datetime import timedelta
from zoneinfo import ZoneInfo
import hashlib,json,re,uuid
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from alisa_platform.accounts.models import WebSession,Membership
from alisa_platform.stores.service import owned as owned_store,Rejected as StoreRejected
from alisa_platform.queries.models import Query
from alisa_platform.queries import service as queries
from alisa_platform.runtime_adapter.authority import SessionPrincipal,principal_current
from alisa_platform.runtime_adapter.job_client import RuntimeFailure,encode
from . import parameter_service as values
from .service import actor_store,need,Rejected,identifier
from .parameter_contract import definition,resolve_period,validate_calculation,ParameterError,CANON,CATALOG_HASH
from .parameter_producers import HASH as PRODUCER_HASH,source_plan

SALT='alisa.parameter.collection.intent.v1'
KEY='parameter_collection'
SCHEMA='alisa-parameter-collection/v1'


def digest(value):return hashlib.sha256(encode(value)).hexdigest()

def enabled():
    values._enabled()
    need(getattr(settings,'OWNER_PARAMETER_COLLECTION_ENABLED',False)is True,'PARAMETER_COLLECTION_NOT_ENABLED',422)
    need(getattr(settings,'QUERIES_ENABLED',False)is True,'PARAMETER_COLLECTION_NOT_ENABLED',422)


def readiness(token,store_id,key,area):
    if not getattr(settings,'OWNER_PARAMETER_COLLECTION_ENABLED',False):
        return {'available':False,'code':'PARAMETER_COLLECTION_NOT_ENABLED'}
    try:
        enabled();api=queries.client(SessionPrincipal(token),[store_id]);caps=api.capabilities()
        extension=caps.get('parameter_collection')
        need(type(extension)is dict and extension.get('schema')==SCHEMA and extension.get('available')is True
             and extension.get('producer_hash')==PRODUCER_HASH and extension.get('definition_hash')==CATALOG_HASH
             and key in extension.get('parameters',[]),'PARAMETER_COLLECTION_UNAVAILABLE',422)
        rule=definition(key)
        sources=__import__('alisa_platform.owner_data.parameter_producers',fromlist=['CATALOG']).CATALOG
        for name in sources['templates'][rule['producer_template']]['sources']:
            need(area['kind']in sources['sources'][name].get('scopes',['store','sku']),'PARAMETER_SOURCE_SCOPE_UNAVAILABLE',422)
        return {'available':True,'code':'READY','runtime_pin':extension['pin']}
    except (Rejected,RuntimeFailure,ParameterError)as error:return {'available':False,'code':error.code}


def _shape(command):
    required={'action','store_id','parameter','scope','sku_reference','period','mode','command_id','expected_revision','confirmed','not_after'}
    need(type(command)is dict and set(command)==required and command['action']=='start_calculation','PARAMETER_SCHEMA',422)
    identifier(command['command_id']);identifier(command['store_id'])
    need(command['mode']in('preview','replace')and command['confirmed']is True,'OWNER_CONFIRMATION_REQUIRED',422)
    need(type(command['expected_revision'])is int and command['expected_revision']>=0,'PARAMETER_REVISION',422)
    return digest({k:v for k,v in command.items()if k!='sku_reference'})


def _summary(row):
    info=row.continuation[KEY]
    return {'id':str(row.pk),'state':row.state,'submission_confirmed':row.runtime_job_ref is not None,
            'parameter':info['key'],'scope':deepcopy(info['area']),'mode':info['mode'],
            'period':deepcopy(info['period']),'expires_at':row.expires_at.isoformat(),
            'write_outcome':info.get('write_outcome','NOT_WRITTEN')}


def _utterance(rule,period,area,mode):
    # Human-readable description only. The signed internal admission carries the
    # actual registered invocation; the model does not choose these slots again.
    verb='Рассчитай и сохрани'if mode=='replace'else'Рассчитай без сохранения'
    suffix=''if area['kind']=='store'else' для SKU '+area['sku']
    return f"{verb} {rule['label']} на Озоне{suffix} за период {period['actual']['from']} — {period['actual']['to']}"


def start(token,command):
    enabled();mark=_shape(command);principal=SessionPrincipal(token)
    # No network while holding a database lock.
    with transaction.atomic():
        actor,store=actor_store(token,command['store_id'])
        old=Query.objects.select_for_update().filter(pk=command['command_id']).first()
        if old:
            need(old.customer_id==actor.customer_id and old.tenant_id==actor.tenant_id and KEY in old.continuation,'NOT_FOUND',404)
            need(old.continuation[KEY]['command_hash']==mark,'IDEMPOTENCY_CONFLICT')
            need(old.expires_at>timezone.now(),'RESULT_EXPIRED',410)
            return {'collection':_summary(old),'dispatched':old.runtime_job_ref is not None,'replayed':True}
        values._deadline(command);rule=values._target(actor,store,command['parameter'],command['scope'],command['sku_reference'])
        current=values._read(actor,store,command['parameter'],command['scope'])
        if command['mode']=='replace':need(current['revision']==command['expected_revision'],'PARAMETER_REVISION_CONFLICT')
    ready=readiness(token,command['store_id'],command['parameter'],command['scope']);need(ready['available'],ready['code'],422)
    api=queries.client(principal,[command['store_id']]);api.authorizer.prepare('submit')
    with transaction.atomic():
        actor,store=actor_store(token,command['store_id']);values._target(actor,store,command['parameter'],command['scope'],command['sku_reference'])
        previous=Query.objects.select_for_update().filter(pk=command['command_id']).first()
        if previous is not None:
            need(previous.customer_id==actor.customer_id and previous.tenant_id==actor.tenant_id and previous.continuation.get(KEY,{}).get('command_hash')==mark,'IDEMPOTENCY_CONFLICT')
            need(previous.expires_at>timezone.now(),'RESULT_EXPIRED',410)
            return {'collection':_summary(previous),'dispatched':previous.runtime_job_ref is not None,'replayed':True}
        # A slow readiness check cannot admit an expired initial command. This
        # deadline limits acceptance only, not duration of an already owned job.
        values._deadline(command)
        current=values._read(actor,store,command['parameter'],command['scope'])
        if command['mode']=='replace':need(current['revision']==command['expected_revision'],'PARAMETER_REVISION_CONFLICT')
        period=resolve_period(timezone.now().astimezone(ZoneInfo('Europe/Moscow')).date(),command['period'])
        utterance=_utterance(rule,period,command['scope'],command['mode'])
        actor_id,tenant_id,_,proof=principal.current()
        intent={'schema':SCHEMA,'key':command['parameter'],'area':deepcopy(command['scope']),
          'mode':command['mode'],'period':period,'expected_revision':command['expected_revision'],
          'command_hash':mark,'principal':proof,'session_id':str(actor.pk),'store_id':str(store.pk),
          'store_revision':store.revision,'verified_identity_hash':digest(store.verified_identity),
          'runtime_pin':ready['runtime_pin'],'producer_hash':PRODUCER_HASH,'definition_hash':CATALOG_HASH,
          'utterance':utterance,'write_outcome':'NOT_WRITTEN'}
        now=timezone.now();row,created=Query.objects.get_or_create(pk=command['command_id'],defaults={
          'tenant_id':actor.tenant_id,'customer_id':actor.customer_id,'store_ids':[str(store.pk)],
          'input_hash':digest({'stores':[str(store.pk)],'utterance':utterance}),'channel':'WEB',
          'created_at':now,'expires_at':now+timedelta(days=1),'continuation':{KEY:intent}})
        need(row.customer_id==actor.customer_id and row.tenant_id==actor.tenant_id and row.continuation.get(KEY,{}).get('command_hash')==mark,'IDEMPOTENCY_CONFLICT')
    if created:return _submit(token,row)
    return {'collection':_summary(row),'dispatched':row.runtime_job_ref is not None,'replayed':True}


def _submit(token,row):
    need(not row.continuation.get(KEY,{}).get('cancelled'),'PARAMETER_INTENT_EXPIRED',403)
    # Reuses exact request ID and original stored slots. UNKNOWN cannot create
    # another task. Existing Query handles durable admission and its lease.
    body,status=queries.submit(SessionPrincipal(token),str(row.pk),row.store_ids,row.continuation[KEY]['utterance'],recover=True)
    row=queries.owned(SessionPrincipal(token),str(row.pk))
    return {'collection':_summary(row),'dispatched':row.runtime_job_ref is not None,
            'code':body.get('code'),'acceptance_status':status}


def check(token,command):
    enabled();need(set(command)=={'action','store_id','parameter','scope','sku_reference','command_id'},'PARAMETER_SCHEMA',422)
    need(command['action']in('collection_status','recover_collection','cancel_collection'),'PARAMETER_ACTION',422)
    principal=SessionPrincipal(token)
    with transaction.atomic():
        actor,store=actor_store(token,command['store_id']);values._target(actor,store,command['parameter'],command['scope'],command['sku_reference'])
        row=queries.owned(principal,command['command_id'],lock=True);info=row.continuation.get(KEY)
        need(type(info)is dict and info['store_id']==str(store.pk)and info['key']==command['parameter']and info['area']==command['scope'],'NOT_FOUND',404)
        if command['action']=='cancel_collection':
            if info.get('write_outcome')=='COMMITTED':
                return {'collection':_summary(row),'cancelled':False,'already_saved':True,'current':values._read(actor,store,info['key'],info['area'])}
            info['cancelled']=True;row.continuation[KEY]=info;row.save(update_fields=['continuation'])
    if command['action']=='recover_collection':return _submit(token,row)
    if command['action']=='cancel_collection':
        stop_confirmed=False
        if row.runtime_job_ref:
            try:
                result=queries.client(principal,row.store_ids).cancel(str(row.runtime_job_ref),request_id=str(uuid.uuid5(uuid.UUID(str(row.pk)),'cancel-parameter')))
                stop_confirmed=result.get('cancelled')is True
            except RuntimeFailure:
                # Revoked write intent also blocks the runtime reader. It is
                # still a durable cancellation of mutation, not proof that an
                # already dispatched provider request has stopped.
                pass
        with transaction.atomic():
            row=queries.owned(principal,str(row.pk),lock=True);row.state='CANCELLED';row.save(update_fields=['state'])
        return {'collection':_summary(row),'cancelled':True,'write_permission_revoked':True,
                'runtime_stop_confirmed':stop_confirmed,'in_flight_may_complete':True}
    if row.continuation[KEY].get('cancelled'):
        return {'collection':_summary(row),'cancelled':True,'write_permission_revoked':True,'in_flight_may_complete':True}
    if row.state=='FAILED':
        # A confirmed terminal state is not a new execution. Do not make another
        # read go through the now-closed execution intent merely to display it.
        with transaction.atomic():
            actor,store=actor_store(token,command['store_id']);current=values._read(actor,store,info['key'],info['area'])
        return {'collection':_summary(row),'status':{'state':'FAILED','code':'EXECUTION_FAILED'},'current':current,
                'write_conflict':info['mode']=='replace'and info.get('write_outcome')!='COMMITTED'and current['revision']!=info['expected_revision']}
    result=queries.read(principal,str(row.pk));row=queries.owned(principal,str(row.pk))
    answer={'collection':_summary(row),'status':result.get('status'),'code':result.get('code')}
    if row.runtime_job_ref and answer['status']and answer['status']['state']=='READY':
        output=queries.read(principal,str(row.pk),result=True,record_useful=False);answer['result']=output['result']
    with transaction.atomic():
        actor,store=actor_store(token,command['store_id']);answer['current']=values._read(actor,store,command['parameter'],command['scope'])
    info=row.continuation[KEY]
    answer['write_conflict']=row.state=='FAILED'and info['mode']=='replace'and info.get('write_outcome')!='COMMITTED'and answer['current']['revision']!=info['expected_revision']
    answer['superseded']=info.get('write_outcome')=='COMMITTED'and answer['current']['revision']!=info['written_revision']
    if answer['superseded']:answer.pop('result',None)
    return answer


def _intent(ident,pins,authority,*,lock=True):
    # Authority verifies entitlement + store mapping again. Session proof is
    # independently rechecked; no browser token is carried in a runtime job.
    scope=authority.resolve(pins,'execute')
    row=Query.objects.select_for_update().filter(pk=ident,tenant_id=pins['tenant_id'],customer_id=pins['actor_id'],channel='WEB').first()
    need(row is not None and KEY in row.continuation,'NOT_FOUND',404)
    info=row.continuation[KEY]
    need(row.expires_at>timezone.now()and row.state not in('CANCELLED','FAILED','EXPIRED')and not info.get('cancelled'),'PARAMETER_INTENT_EXPIRED',403)
    principal_current(info['principal'],pins)
    actor=WebSession.objects.select_for_update().select_related('customer','tenant').filter(pk=info['session_id'],customer_id=row.customer_id,tenant_id=row.tenant_id,revoked_at__isnull=True,expires_at__gt=timezone.now()).first()
    need(actor is not None and actor.customer.is_active and actor.security_revision==actor.customer.security_revision,'OWNER_SOURCE_AUTH_CHANGED',403)
    need(Membership.objects.filter(customer_id=row.customer_id,tenant_id=row.tenant_id,role='OWNER_CLIENT').exists(),'PERMISSION_DENIED',403)
    try:store=owned_store(actor,identifier(info['store_id']))
    except StoreRejected as error:raise Rejected(error.code,error.status)from None
    need(store.status=='ACTIVE'and store.revision==info['store_revision']and digest(store.verified_identity)==info['verified_identity_hash'],'OWNER_SOURCE_AUTH_CHANGED',403)
    need(row.store_ids==[str(store.pk)]and len(pins['store_scope'])==len(scope['stores'])==1 and pins['store_scope'][0]['store_id']==str(store.pk),'PERMISSION_DENIED',403)
    need(info['producer_hash']==PRODUCER_HASH and info['definition_hash']==CATALOG_HASH,'CATALOG_INCOMPATIBLE',409)
    runtime_target={'tenant_id':scope['tenant'],'store_id':scope['stores'][0]['id'],'provider':store.provider,'scope':deepcopy(info['area'])}
    return row,info,actor,store,runtime_target


def _reference(row,info,pins,target):
    return signing.dumps({'schema':SCHEMA,'environment':settings.ALISA_ENV,'query_id':str(row.pk),
        'pins':pins,'target':target,'command_hash':info['command_hash']},salt=SALT,compress=True)


def _reference_data(reference):
    try:value=signing.loads(reference,salt=SALT)
    except (signing.BadSignature,TypeError):raise Rejected('PARAMETER_INTENT_INVALID',403)from None
    need(type(value)is dict and set(value)=={'schema','environment','query_id','pins','target','command_hash'}and value['schema']==SCHEMA and value['environment']==settings.ALISA_ENV,'PARAMETER_INTENT_INVALID',403)
    return value


@transaction.atomic
def dispatch(authority,payload):
    enabled();need(type(payload)is dict,'PARAMETER_SCHEMA',422);method=payload.get('method')
    if method=='admit':
        need(set(payload)=={'method','query_id','pins','question_hash','runtime_pin'},'PARAMETER_SCHEMA',422)
        row,info,actor,store,target=_intent(payload['query_id'],payload['pins'],authority)
        need(payload['question_hash']==digest(info['utterance'])and payload['runtime_pin']==info['runtime_pin'],'PARAMETER_INTENT_MISMATCH',403)
        ref=_reference(row,info,payload['pins'],target)
        mode='replace_calculated'if info['mode']=='replace'else'preview'
        request={'intent_ref':ref,'expected_revision':info['expected_revision'],'mode':mode}
        return {'admitted':True,'intent':request,'key':info['key'],'target':target,'period':info['period'],
          'invocation':{'id':'parameter-lk','template_id':definition(info['key'])['producer_template'],'store_id':target['store_id'],
             'input':{'period':info['period']['actual'],'filters':{}if info['area']['kind']=='store'else{'sku':info['area']['sku']},'parameter_mode':mode}}}
    need(method in('current','commit')and type(payload.get('reference'))is str,'PARAMETER_SCHEMA',422)
    expected={'method','reference','target','period'}|({'envelope','envelope_sha256','job_id'}if method=='commit'else set())
    need(set(payload)==expected,'PARAMETER_SCHEMA',422)
    ref=_reference_data(payload['reference']);row,info,actor,store,target=_intent(ref['query_id'],ref['pins'],authority)
    need(ref['command_hash']==info['command_hash']and ref['target']==target==payload['target']and info['period']==payload['period'],'PARAMETER_INTENT_MISMATCH',403)
    if method=='current':return {'current':True}
    need(info['mode']=='replace','PARAMETER_PREVIEW_CANNOT_WRITE',403)
    envelope=payload['envelope'];need(digest(envelope)==payload['envelope_sha256'],'PARAMETER_COMPLETION_INTEGRITY',422)
    need(type(payload['job_id'])is str and payload['job_id'],'PARAMETER_COMPLETION_INTEGRITY',422)
    # A service-authenticated private call from the Worker attests its ledger.
    # It remains bound to this one explicit user command and current scope.
    completion_hash=digest({'target':target,'period':info['period'],'envelope':envelope,'job_id':payload['job_id']})
    if info.get('completion_hash'):
        need(info['completion_hash']==completion_hash,'IDEMPOTENCY_CONFLICT')
        current=values._read(actor,store,info['key'],info['area']);need(info['write_outcome']=='COMMITTED','PARAMETER_WRITE_NOT_CONFIRMED')
        return _commit_reply(info,current,True)
    platform_target={'tenant_id':str(actor.tenant_id),'store_id':str(store.pk),'provider':store.provider,'scope':info['area']}
    checked=validate_calculation(info['key'],envelope,platform_target,info['period'],timezone.now(),
      lambda t,p,e:t==platform_target and p==info['period']and digest(e)==payload['envelope_sha256'])
    command={'action':'replace_calculated','store_id':str(store.pk),'parameter':info['key'],'scope':info['area'],'sku_reference':None,
      'command_id':str(row.pk),'expected_revision':info['expected_revision'],'confirmed':True,'not_after':int(timezone.now().timestamp())+120}
    data={'value':checked.value,'state':'VALUE','unit':checked.unit,'origin':'calculated','collected_at':checked.collected_at,
      'calculated_at':checked.calculated_at,'requested_period':json.loads(checked.requested_json),'actual_period':json.loads(checked.actual_json),'evidence':json.loads(checked.evidence_json)}
    result=values._write(actor,store,info['key'],info['area'],command,data,'replace_calculated',{'admitted_query':str(row.pk),'completion_hash':completion_hash})
    info.update(completion_hash=completion_hash,write_outcome='COMMITTED',written_revision=result['revision'])
    row.continuation[KEY]=info;row.save(update_fields=['continuation'])
    return _commit_reply(info,result,False)


def _commit_reply(info,current,replayed):
    value=current['effective'];need(value is not None,'PARAMETER_CURRENT_UNAVAILABLE',409)
    return {'parameter':info['key'],'saved':True,'mode':'replace_calculated','replayed':replayed,
       'superseded':current['revision']!=info['written_revision'],'revision':current['revision'],
       'value':value['value'],'unit':value['unit'],'period':value['actual_period'],
       'collected_at':value['collected_at'],'calculated_at':value['calculated_at']}


def rpc(authority,payload):
    try:return {'ok':True,'data':dispatch(authority,payload)}
    except (Rejected,ParameterError,RuntimeFailure)as error:return {'ok':False,'code':error.code}
