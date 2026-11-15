"""Read current approved owner inputs and coefficient revisions for one cohort.

Existing WebSession, entitlement, credentials and approval checks are reused. No
new permissions, routes, background collection, DB rows or retained old values.
The future Worker adapter must still bind these calls to its admitted Query.
"""
from copy import deepcopy
from datetime import date
from dataclasses import dataclass
from django.db import transaction
from django.utils import timezone
from . import economics_cohort as economics,parameter_dependency_service as dependencies
from . import parameter_service as parameters
from .source import DjangoOwnerSource
from .service import actor_store,need,Rejected,RESOLVER
from .owner_inputs import digest,InputError
PROFILE='unit_economics.ozon.v1'


def _pin(state):
    return {k:deepcopy(state[k])for k in ('revision','approval_id','catalog_hash','content_hash','scope')}

@dataclass(repr=False)
class CurrentEconomics:
    qualified:economics.QualifiedCohort
    source:DjangoOwnerSource
    owner_pin:dict
    parameter_binding:object
    result:dict|None
    missing_owner:list
    def __repr__(self):return '<CurrentEconomics request-local; no stored coefficient values>'
    @property
    def ready(self):return self.result is not None
    def checkpoint(self):
        return {'schema':'alisa-current-economics-fence/v1','sources':self.qualified.checkpoint(),
                'owner':deepcopy(self.owner_pin),'parameters':self.parameter_binding.checkpoint()if self.parameter_binding else None,
                'ready':self.ready,'missing_owner':deepcopy(self.missing_owner),'persist_values':False}


def _owner_value(source,state,bundle,entity,fields,report_period):
    now=int(timezone.now().timestamp());envelope=bundle['snapshot']
    request={'scope_hash':bundle['scope_hash'],'entity':entity,'currency':'RUB','period':report_period,'fields':fields}
    def authorize(metadata,req,action):
        fresh=source.current()
        expected={'catalog_hash':RESOLVER.hash,'facts_sha256':envelope['sha256'],
                  'revision':envelope['payload']['revision'],'request_sha256':digest({**request,'fields':sorted(fields)}),
                  'scope_hash':bundle['scope_hash'],'issued_at':envelope['payload']['issued_at'],'expires_at':envelope['payload']['expires_at']}
        return _pin(fresh)==_pin(state)and metadata==expected and req=={**request,'fields':sorted(fields)}and action=='resolve'
    try:return RESOLVER.resolve(envelope,request,authorize=authorize,now=now)
    except InputError as error:raise Rejected(error.code,422)from None


@transaction.atomic
def prepare(token,qualified,*,today:date,parameter_periods=None):
    need(type(qualified)is economics.QualifiedCohort,'ECONOMICS_QUALIFIED_INPUT_REQUIRED',422)
    target=qualified.scope;source=DjangoOwnerSource(token,target['store_id'])
    state=source.current()
    need(str(state['scope']['tenant'])==target['tenant_id']and state['scope']['stores'][0]['platform'].upper()==target['provider'],
         'ECONOMICS_OWNER_SCOPE',403)
    actor,store=actor_store(token,target['store_id'])
    now=int(timezone.now().timestamp());expires=min(now+300,state['authority_expires_at'])
    need(expires>now,'OWNER_SOURCE_AUTH_EXPIRED',403)
    bundle=source.make_bundle(state,now,expires);rows=qualified.rows;consumers=[];row_ids={}
    for row in rows:
        order=row['order'];k=economics.c.CANON(economics.key(order));cid='cohort-'+digest(k);row_ids[k]=cid
        consumers.append({'id':cid,'store_id':target['store_id'],'scope':{'kind':'sku','sku':order['sku']},
                          'sku_reference':parameters.sku_reference(actor,store,order['sku'])})
    binding=dependencies.resolve_current(token,PROFILE,consumers,today,report_period=qualified.period,
                                         parameter_periods=parameter_periods)if consumers else None
    unit_costs={};missing=[];owner_basis={};cost_basis=[]
    for row in rows:
        order=row['order'];k=economics.c.CANON(economics.key(order));sku=order['sku']
        if sku not in owner_basis:owner_basis[sku]=_owner_value(source,state,bundle,'sku:'+sku,['unit_cost'],qualified.period)
        segments=owner_basis[sku]['fields']['unit_cost']['segments']
        chosen=[s for s in segments if s['period']['from']<=order['day']<=s['period']['to']]
        need(len(chosen)==1,'ECONOMICS_COGS_PERIOD',422)
        if chosen[0]['state']!='VALUE':missing.append({'sku':sku,'day':order['day'],'reason':chosen[0]['reason']})
        else:
            unit_costs[k]=chosen[0]['value']
            cost_basis.append({'sku':sku,'day':order['day'],'value':chosen[0]['value'],
                               'unit':chosen[0]['unit'],'entry_id':chosen[0]['entry_id']})
    owner=_owner_value(source,state,bundle,bundle['store_entity'],['tax_amount','own_cost_amount'],qualified.period)
    amounts={}
    for name,value in owner['fields'].items():
        need(len(value['segments'])==1,'ECONOMICS_OWNER_PERIOD',422);segment=value['segments'][0]
        amounts[name]={'state':segment['state'],'value':segment['value']}
    result=None
    if not missing and(binding is None or binding.ready):
        coeff={k:binding.formula_inputs(cid)for k,cid in row_ids.items()}if binding else{}
        result=economics.calculate(qualified,unit_costs,coeff,amounts)
        # These current numbers/dates are explanation inputs in memory, not a
        # coefficient history or material added to the value-free checkpoint.
        result['parameters_used']=binding.answer_basis()if binding else[]
        result['unit_cost_basis']=cost_basis
        result['owner_data_revision']=state['revision']
    return CurrentEconomics(qualified,source,_pin(state),binding,result,missing)


@transaction.atomic
def publication_check(token,prepared):
    need(type(prepared)is CurrentEconomics,'ECONOMICS_CURRENT_RESULT',422)
    # Never trust a captured source object instead of the caller's CURRENT token.
    fresh=DjangoOwnerSource(token,prepared.qualified.scope['store_id']).current()
    same=_pin(fresh)==prepared.owner_pin
    coefficient_current=True
    if prepared.parameter_binding is not None:coefficient_current=dependencies.publication_check(token,prepared.parameter_binding)['current']
    return {'current':prepared.ready and same and coefficient_current,
            'recompute_from_current':not(prepared.ready and same and coefficient_current),
            'recollect_marketplace':False,'old_values_stored':False,'execution_authorized':False}
