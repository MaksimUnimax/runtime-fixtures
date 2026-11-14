"""Single-row parameters using existing owner auth and metadata-only receipts.

External clients may read/set manual values/use the general value. Calculated
writes are an INTERNAL adapter entry, requiring a qualified-source verifier.
No history, background refresh, model call, provider IO or new queue lives here.
"""
from copy import deepcopy
from datetime import timedelta
import json,uuid
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from .models import CurrentParameter,OwnerCommand,PRODUCT
from .service import actor_store,identifier,Rejected,need
from .parameter_contract import (CATALOG_HASH,CANON,ParameterError,definition,scope,
                                validate_value,validate_calculation)
SKU_SALT='alisa.current-parameter.sku.v1'


def sku_reference(actor,store,sku):
    """Call only for a row returned by the authenticated owner-products reader."""
    return signing.dumps({'tenant':str(actor.tenant_id),'store':str(store.pk),'sku':sku,
        'store_revision':store.revision,'security_revision':actor.customer.security_revision},salt=SKU_SALT,compress=True)

def _enabled():
    need(getattr(settings,'OWNER_PARAMETERS_ENABLED',False)is True,'NOT_FOUND',404)
    need(getattr(settings,'OWNER_DATA_ENABLED',False)is True,'NOT_FOUND',404)

def _target(actor,store,key,area,proof):
    rule=definition(key);scope(area)
    need(store.provider in rule['platforms'],'PARAMETER_PLATFORM',422)
    need(area['kind']in rule['scopes'],'PARAMETER_SCOPE',422)
    if area['kind']=='sku':
        try:d=signing.loads(proof,salt=SKU_SALT,max_age=900)
        except (signing.BadSignature,TypeError):raise Rejected('PARAMETER_SKU_UNVERIFIED',403)from None
        expected={'tenant':str(actor.tenant_id),'store':str(store.pk),'sku':area['sku'],
            'store_revision':store.revision,'security_revision':actor.customer.security_revision}
        need(d==expected,'PARAMETER_SKU_UNVERIFIED',403)
    else:need(proof is None,'PARAMETER_SCHEMA',422)
    return rule

def _query(actor,store,key,area):
    return CurrentParameter.objects.filter(product_id=PRODUCT,tenant_id=actor.tenant_id,
         store=store,key=key,scope_kind=area['kind'],sku=area['sku'])

def _row(actor,store,key,area):return _query(actor,store,key,area).select_for_update().first()

def _data(row):
    if row is None:return None
    return {'parameter':row.key,'scope':{'kind':row.scope_kind,'sku':row.sku},'state':row.state,
      'revision':row.revision,'value':row.value,'unit':row.unit,'origin':row.origin,
      'collected_at':row.collected_at.isoformat()if row.collected_at else None,
      'calculated_at':row.calculated_at.isoformat()if row.calculated_at else None,
      'updated_at':row.updated_at.isoformat(),'requested_period':deepcopy(row.requested_period),
      'actual_period':deepcopy(row.actual_period),'evidence':deepcopy(row.evidence),
      'definition_hash':row.definition_hash}

def _read(actor,store,key,area):
    own=_row(actor,store,key,area);effective=own if own and own.state=='VALUE'else None
    if effective is None and area['kind']=='sku':
        general=_row(actor,store,key,{'kind':'store','sku':''})
        if general and general.state=='VALUE':effective=general
    return {'store_id':str(store.pk),'parameter':key,'scope':deepcopy(area),
      'revision':own.revision if own else 0,'state':own.state if own else'NOT_PROVIDED',
      'current':_data(own),'effective':_data(effective),'inherited':bool(effective and effective.scope_kind!=area['kind'])}

def _receipt(row,action):
    # Old command records never retain the coefficient, collection date/period,
    # numerator, denominator, raw result or a previous snapshot.
    return {'parameter_command':True,'parameter':row.key,'scope':{'kind':row.scope_kind,'sku':row.sku},
            'revision':row.revision,'action':action,'state':'SAVED'}

def _existing_command(actor,store,command,fingerprint):
    old=OwnerCommand.objects.filter(tenant_id=actor.tenant_id,customer_id=actor.customer_id,
        request_id=identifier(command['command_id'])).first()
    if old:
        need(old.store_id==store.pk and old.product_id==PRODUCT and old.fingerprint==fingerprint,'IDEMPOTENCY_CONFLICT')
        need(old.security_revision==actor.customer.security_revision,'OWNER_SOURCE_AUTH_CHANGED',403)
    return old

def _fingerprint(actor,command,extra=None):
    # Hash the semantic command, excluding a refreshable short-lived SKU proof.
    clean={k:v for k,v in command.items()if k!='sku_reference'}
    return salted_hmac('alisa.current.parameter.command.v1',CANON({'tenant':str(actor.tenant_id),
        'customer':str(actor.customer_id),'command':clean,'extra':extra}),algorithm='sha256').hexdigest()

def _deadline(command):
    now=int(timezone.now().timestamp());x=command['not_after']
    need(type(x)is int and x<=now+180,'OWNER_SOURCE_DEADLINE',422)
    need(now<x,'OWNER_COMMAND_EXPIRED')

def _write(actor,store,key,area,command,payload,action,extra=None):
    need(bool(store.verified_identity),'OWNER_SOURCE_STORE_UNVERIFIED')
    revision=command['expected_revision'];need(type(revision)is int and revision>=0,'PARAMETER_REVISION',422)
    fingerprint=_fingerprint(actor,command,extra);old=_existing_command(actor,store,command,fingerprint)
    if old:
        # Replay acknowledges effect, but returns today's current row, never an
        # old value resurrected from a receipt.
        return {'replayed':True,'receipt':deepcopy(old.result),'value_at_receipt_not_stored':True,
                **_read(actor,store,key,area)}
    _deadline(command)
    row=_row(actor,store,key,area)
    if action=='fill_missing'and row and row.state=='VALUE':
        return {'replayed':False,'written':False,'reason':'ALREADY_PRESENT',**_read(actor,store,key,area)}
    need((row.revision if row else 0)==revision,'PARAMETER_REVISION_CONFLICT')
    if row is None:row=CurrentParameter(tenant_id=actor.tenant_id,store=store,key=key,scope_kind=area['kind'],sku=area['sku'])
    for k,v in payload.items():setattr(row,k,deepcopy(v))
    row.revision+=1;row.updated_at=timezone.now();row.updated_by_id=actor.customer_id
    row.definition_hash=CATALOG_HASH;row.save()
    # The row was replaced as a whole. No old payload is appended anywhere.
    result=_receipt(row,action)
    # Expired metadata-only receipts may be removed; their admission deadlines
    # have elapsed, so deletion cannot authorize an old command as a new write.
    OwnerCommand.objects.filter(tenant_id=actor.tenant_id,product_id=PRODUCT,
        result__parameter_command=True,created_at__lt=timezone.now()-timedelta(days=1)).delete()
    OwnerCommand.objects.create(request_id=identifier(command['command_id']),tenant_id=actor.tenant_id,
        customer_id=actor.customer_id,store=store,fingerprint=fingerprint,
        security_revision=actor.customer.security_revision,result=result)
    return {'replayed':False,'written':True,'receipt':result,**_read(actor,store,key,area)}

@transaction.atomic
def execute(token,command):
    _enabled();need(type(command)is dict,'PARAMETER_SCHEMA',422)
    action=command.get('action');need(action in('read','set_manual','use_general'),'PARAMETER_ACTION',422)
    base={'action','store_id','parameter','scope','sku_reference'}
    fields=base if action=='read'else base|{'command_id','expected_revision','confirmed','not_after'}
    if action=='set_manual':fields|={'value','unit'}
    need(set(command)==fields,'PARAMETER_SCHEMA',422)
    actor,store=actor_store(token,command['store_id']);key=command['parameter'];area=command['scope']
    try:
        rule=_target(actor,store,key,area,command['sku_reference'])
        if action=='read':return _read(actor,store,key,area)
        need(command['confirmed']is True,'OWNER_CONFIRMATION_REQUIRED',422)
        if action=='set_manual':
            value=validate_value(rule,command['value'],command['unit']);state='VALUE';origin='manual'
        else:
            need(area['kind']=='sku','PARAMETER_GENERAL_NOT_AN_EXCEPTION',422)
            value=None;state='INHERIT';origin=''
        payload={'value':value,'state':state,'unit':rule['unit'],'origin':origin,'collected_at':None,
                 'calculated_at':None,'requested_period':None,'actual_period':None,'evidence':{}}
        return _write(actor,store,key,area,command,payload,action)
    except ParameterError as e:raise Rejected(e.code,422)from None

@transaction.atomic
def commit_calculated(token,command,envelope,period,*,verify_sources):
    """Internal seam for the existing job authority; NOT an HTTP client action.

    The adapter must renew authorization at commit time, preserve the user's
    original target/revision/intent, and provide qualified source observations.
    Long-running jobs do not reuse an expired 180s admission command: their
    existing authority must approve a fresh commit envelope. This module neither
    renews credentials nor creates a new background execution mechanism.
    """
    _enabled();need(type(command)is dict,'PARAMETER_SCHEMA',422)
    need(set(command)=={'action','store_id','parameter','scope','sku_reference','command_id','expected_revision','confirmed','not_after'},'PARAMETER_SCHEMA',422)
    need(command['action']in('fill_missing','replace_calculated'),'PARAMETER_ACTION',422)
    need(command['confirmed']is True,'OWNER_CONFIRMATION_REQUIRED',422)
    actor,store=actor_store(token,command['store_id']);key=command['parameter'];area=command['scope']
    try:
        _target(actor,store,key,area,command['sku_reference'])
        # Check replay before producer work and before any check of expired data.
        extra={'period':period,'calculation':envelope}
        fp=_fingerprint(actor,command,extra);old=_existing_command(actor,store,command,fp)
        if old:return {'replayed':True,'receipt':deepcopy(old.result),'value_at_receipt_not_stored':True,**_read(actor,store,key,area)}
        _deadline(command)
        own=_row(actor,store,key,area)
        if command['action']=='fill_missing':
            effective=_read(actor,store,key,area)['effective']
            if effective is not None:return {'written':False,'reason':'ALREADY_PRESENT',**_read(actor,store,key,area)}
        need((own.revision if own else 0)==command['expected_revision'],'PARAMETER_REVISION_CONFLICT')
        target={'tenant_id':str(actor.tenant_id),'store_id':str(store.pk),'provider':store.provider,'scope':deepcopy(area)}
        checked=validate_calculation(key,envelope,target,period,timezone.now(),verify_sources)
        payload={'value':checked.value,'state':'VALUE','unit':checked.unit,'origin':'calculated',
                 'collected_at':checked.collected_at,'calculated_at':checked.calculated_at,
                 'requested_period':json.loads(checked.requested_json),'actual_period':json.loads(checked.actual_json),
                 'evidence':json.loads(checked.evidence_json)}
        return _write(actor,store,key,area,command,payload,command['action'],extra)
    except ParameterError as e:raise Rejected(e.code,422)from None
