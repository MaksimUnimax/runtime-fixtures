"""Compound report parameters using existing Query and private authority RPC.

No new endpoint, table, session, OAuth permission or provider connection. A WEB
report's admitted principal and registry define allowed initial fills. Neither a
model-selected arbitrary variable nor a bearer reports:read grants write access.
"""
from copy import deepcopy
from datetime import date
from uuid import UUID,uuid5
import json
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from zoneinfo import ZoneInfo
from alisa_platform.accounts.models import WebSession
from alisa_platform.queries.models import Query
from alisa_platform.runtime_adapter.authority import principal_current,digest
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from .service import need,Rejected
from . import parameter_service as values,parameter_dependencies as dep,parameter_contract as pc,parameter_report_contract as spec
KEY='compound_parameter_reports'
PRINCIPAL='compound_parameter_principal'
SALT='alisa.compound.parameter.report.v1'
PREFIX='r8:'


def remember(principal,channel,utterance):
 if not getattr(settings,'OWNER_PARAMETER_COMPOUNDS_ENABLED',False):return {}
 if channel!='WEB':return {}
 actor,tenant,until,proof=principal.current()
 need(proof['kind']=='WEB','PARAMETER_REPORT_WEB_ONLY',403)
 return {PRINCIPAL:{'proof':deepcopy(proof),'question_hash':digest(utterance),
                   'anchor':timezone.now().astimezone(ZoneInfo('Europe/Moscow')).date().isoformat(),
                   'report_catalog_hash':spec.HASH,'dependency_catalog_hash':digest(dep.CATALOG)}}


def _sign(value):return PREFIX+signing.dumps(value,salt=SALT,compress=True)

def _unsign(value):
 need(type(value)is str and value.startswith(PREFIX),'PARAMETER_REPORT_REFERENCE',403)
 try:return signing.loads(value[len(PREFIX):],salt=SALT)
 except (signing.BadSignature,TypeError):raise Rejected('PARAMETER_REPORT_REFERENCE',403)from None


def _load(authority,qid,pins):
 scope=authority.resolve(pins,'execute')
 row=Query.objects.select_for_update().filter(pk=qid,tenant_id=pins['tenant_id'],customer_id=pins['actor_id'],channel='WEB').first()
 need(row is not None and PRINCIPAL in row.continuation,'PARAMETER_REPORT_NOT_ADMITTED',403)
 need(row.state not in('CANCELLED','FAILED','EXPIRED')and row.expires_at>timezone.now(),'PARAMETER_REPORT_CANCELLED',403)
 info=row.continuation[PRINCIPAL];principal_current(info['proof'],pins)
 need(info['report_catalog_hash']==spec.HASH and info['dependency_catalog_hash']==digest(dep.CATALOG),'CATALOG_INCOMPATIBLE',409)
 actor=WebSession.objects.select_for_update().select_related('customer','tenant').filter(pk=info['proof']['id'],tenant_id=row.tenant_id,customer_id=row.customer_id).first()
 need(actor is not None,'OWNER_SOURCE_AUTH_CHANGED',403)
 need(sorted(row.store_ids)==sorted(x['store_id']for x in pins['store_scope']),'PERMISSION_DENIED',403)
 return row,info,actor,scope


def _node(authority,reference):
 ref=_unsign(reference);pc.exact(ref,('query_id','pins','node_id','descriptor_hash','dependency_id'))
 row,info,actor,scope=_load(authority,ref['query_id'],ref['pins'])
 node=row.continuation.get(KEY,{}).get(ref['node_id']);need(node is not None and digest(node['descriptor'])==ref['descriptor_hash'],'PARAMETER_REPORT_REFERENCE',403)
 need(node['descriptor']['profile_hash']==dep.profile_hash(node['descriptor']['profile']),'CATALOG_INCOMPATIBLE',409)
 from alisa_platform.stores.models import Store
 store=Store.objects.select_for_update().get(pk=node['descriptor']['platform_store_id'],tenant_id=actor.tenant_id)
 expected_native=next((s for p,s in zip(ref['pins']['store_scope'],scope['stores'])if p['store_id']==str(store.pk)),None)
 need(expected_native is not None and expected_native['id']==node['descriptor']['runtime_store_id'],'PERMISSION_DENIED',403)
 return ref,row,info,actor,store,node


def _resolve(actor,store,node):
 descriptor=node['descriptor'];consumer={'id':descriptor['invocation_id'],'store_id':str(store.pk),'scope':{'kind':'store','sku':''},'sku_reference':None}
 reads=[]
 for r in dep.read_requests(descriptor['profile'],[consumer]):
  values._target(actor,store,r['parameter'],r['scope'],None);reads.append(values._read(actor,store,r['parameter'],r['scope']))
 return dep.resolve(descriptor['profile'],[consumer],reads,date.fromisoformat(descriptor['anchor']),
                    report_period=descriptor['input']['period'],parameter_periods=descriptor['input']['parameter_periods'])


def _reply(row,pins,actor,store,node_id,node,reference):
 result=_resolve(actor,store,node);checkpoint=result.checkpoint();producers=[]
 for requested in result.producers:
  ident=requested['id'];old=node['dependencies'].get(ident)
  if old is None:
   old={'plan':deepcopy(requested),'command_id':str(uuid5(row.pk,node_id+':'+ident))};node['dependencies'][ident]=old
  else:need(old['plan']['parameter_period']==requested['parameter_period'],'PARAMETER_PERIOD_MISMATCH',409)
  plan=old['plan'];target={'tenant_id':node['descriptor']['runtime_tenant'],'store_id':node['descriptor']['runtime_store_id'],'provider':store.provider,'scope':plan['scope']}
  ref=_sign({'query_id':str(row.pk),'pins':pins,'node_id':node_id,'descriptor_hash':digest(node['descriptor']),'dependency_id':ident})
  producers.append({'key':plan['parameter'],'target':target,'period':plan['parameter_period'],
                    'intent':{'intent_ref':ref,'expected_revision':plan['expected_revision'],'mode':'fill_missing'}})
 row.continuation.setdefault(KEY,{})[node_id]=node;row.save(update_fields=['continuation'])
 return {'reference':reference,'ready':result.ready,'checkpoint':checkpoint,'producers':producers,
         'inputs':result.formula_inputs(node['descriptor']['invocation_id'])if result.ready else None,
         'basis':result.answer_basis()if result.ready else None}


@transaction.atomic
def dispatch(authority,payload):
 need(getattr(settings,'OWNER_PARAMETER_COMPOUNDS_ENABLED',False)is True,'PARAMETER_REPORT_DISABLED',403);values._enabled()
 need(type(payload)is dict,'PARAMETER_SCHEMA',422);method=payload.get('method')
 if method=='report_bind':
  pc.exact(payload,('method','query_id','pins','template_id','invocation_id','runtime_store_id','input','question_hash','job_id'))
  rule=spec.definition(payload['template_id']);inputs=spec.normalized_input(payload['input'])
  need(type(payload['invocation_id'])is str and payload['invocation_id']and type(payload['job_id'])is str and payload['job_id'],'PARAMETER_SCHEMA',422)
  row,info,actor,scope=_load(authority,payload['query_id'],payload['pins'])
  need(info['question_hash']==payload['question_hash'],'PARAMETER_INTENT_MISMATCH',403)
  targets=[p['store_id']for p,s in zip(payload['pins']['store_scope'],scope['stores'])if s['id']==payload['runtime_store_id']]
  need(len(targets)==1,'PERMISSION_DENIED',403)
  from alisa_platform.stores.models import Store
  store=Store.objects.select_for_update().get(pk=targets[0],tenant_id=actor.tenant_id)
  need(store.provider==rule['provider'],'PARAMETER_PLATFORM',422)
  node_id=digest({'invocation':payload['invocation_id'],'template':payload['template_id'],'store':targets[0]})
  descriptor={'invocation_id':payload['invocation_id'],'template_id':payload['template_id'],'profile':rule['profile'],
    'profile_hash':dep.profile_hash(rule['profile']),'input':inputs,'anchor':info['anchor'],
    'platform_store_id':targets[0],'runtime_store_id':payload['runtime_store_id'],'runtime_tenant':scope['tenant'],'job_id':payload['job_id']}
  node=row.continuation.get(KEY,{}).get(node_id)
  if node is None:node={'descriptor':descriptor,'dependencies':{}}
  else:need(node['descriptor']==descriptor,'IDEMPOTENCY_CONFLICT',409)
  reference=_sign({'query_id':str(row.pk),'pins':payload['pins'],'node_id':node_id,'descriptor_hash':digest(descriptor),'dependency_id':None})
  return _reply(row,payload['pins'],actor,store,node_id,node,reference)
 need(method in('report_current','report_refresh','report_fence','report_dependency_current','report_fill'),'PARAMETER_ACTION',422)
 expected={'method','reference'}
 if method=='report_fence':expected|={'checkpoint'}
 if method in('report_dependency_current','report_fill'):expected|={'target','period'}
 if method=='report_fill':expected|={'envelope','envelope_sha256','job_id'}
 pc.exact(payload,expected);ref,row,info,actor,store,node=_node(authority,payload['reference'])
 if method in('report_current','report_refresh','report_fence'):
  need(ref['dependency_id']is None,'PARAMETER_REPORT_REFERENCE',403)
  if method=='report_current':return {'current':True}
  if method=='report_refresh':return _reply(row,ref['pins'],actor,store,ref['node_id'],node,payload['reference'])
  current=_resolve(actor,store,node)
  return {'current':current.ready and current.checkpoint()==payload['checkpoint']}
 dependency=node['dependencies'].get(ref['dependency_id']);need(dependency is not None,'PARAMETER_REPORT_REFERENCE',403)
 plan=dependency['plan'];target={'tenant_id':node['descriptor']['runtime_tenant'],'store_id':node['descriptor']['runtime_store_id'],'provider':store.provider,'scope':plan['scope']}
 need(payload['target']==target and payload['period']==plan['parameter_period'],'PARAMETER_INTENT_MISMATCH',403)
 if method=='report_dependency_current':return {'current':True}
 need(payload['job_id']==node['descriptor']['job_id'],'PARAMETER_JOB_MISMATCH',403)
 need(digest(payload['envelope'])==payload['envelope_sha256'],'PARAMETER_COMPLETION_INTEGRITY',422)
 fingerprint=digest({'envelope':payload['envelope'],'job_id':payload['job_id'],'target':target,'period':payload['period']})
 if dependency.get('completion_hash'):
  need(dependency['completion_hash']==fingerprint,'IDEMPOTENCY_CONFLICT',409)
  result=values._read(actor,store,plan['parameter'],plan['scope'])
 else:
  platform_target={'tenant_id':str(actor.tenant_id),'store_id':str(store.pk),'provider':store.provider,'scope':plan['scope']}
  checked=pc.validate_calculation(plan['parameter'],payload['envelope'],platform_target,payload['period'],timezone.now(),
       lambda t,p,e:t==platform_target and p==payload['period']and digest(e)==payload['envelope_sha256'])
  cmd={'action':'fill_missing','store_id':str(store.pk),'parameter':plan['parameter'],'scope':plan['scope'],'sku_reference':None,
       'command_id':dependency['command_id'],'expected_revision':plan['expected_revision'],'confirmed':True,'not_after':int(timezone.now().timestamp())+120}
  data={'value':checked.value,'state':'VALUE','unit':checked.unit,'origin':'calculated','collected_at':checked.collected_at,'calculated_at':checked.calculated_at,
        'requested_period':json.loads(checked.requested_json),'actual_period':json.loads(checked.actual_json),'evidence':json.loads(checked.evidence_json)}
  result=values._write(actor,store,plan['parameter'],plan['scope'],cmd,data,'fill_missing',{'report_query':str(row.pk),'node':ref['node_id'],'completion_hash':fingerprint})
  dependency.update(completion_hash=fingerprint,written_revision=result['revision'],written=result.get('written',False))
  row.continuation[KEY][ref['node_id']]=node;row.save(update_fields=['continuation'])
 need(result['effective']is not None,'PARAMETER_CURRENT_UNAVAILABLE',409)
 # Acknowledgement only: do not persist a past numeric value in native progress.
 return {'saved':True,'parameter':plan['parameter'],'mode':'fill_missing','revision':result['revision'],'written':dependency.get('written',False),'value_at_receipt_not_stored':True}


def rpc(authority,payload):
 try:return {'ok':True,'data':dispatch(authority,payload)}
 except (Rejected,pc.ParameterError,RuntimeFailure)as error:return {'ok':False,'code':error.code}
