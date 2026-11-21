"""Owner-confirmed current facts; use the existing authenticated platform boundary.

No provider traffic, keys, authentication changes or inferred monetary values.
"""
from pathlib import Path
from copy import deepcopy
from datetime import timedelta
import json,re,uuid
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from alisa_platform.stores.service import principal,owned,Rejected as StoreRejected
from .models import PRODUCT,OwnerDataset,OwnerCommand
from .owner_inputs import OwnerInputs,InputError,digest,canonical

CATALOG = json.loads(Path(__file__).with_name('owner_input_catalog.json').read_text())
RESOLVER = OwnerInputs(CATALOG)
MAX_COMMANDS = 1000

class Rejected(Exception):
    def __init__(self,code,status=409):
        self.code,self.status=code,status
        super().__init__(code)

def need(ok,code,status=409):
    if not ok:raise Rejected(code,status)

def exact(value,fields):
    need(type(value)is dict and set(value)==set(fields),'OWNER_SOURCE_SCHEMA',422)

def identifier(value):
    need(type(value)is str,'OWNER_SOURCE_ID',422)
    try:return uuid.UUID(value)
    except (ValueError,TypeError,AttributeError):raise Rejected('OWNER_SOURCE_ID',422)from None

def actor_store(token,store_id):
    # Called only in atomic blocks; reuses existing session/security/membership checks.
    try:
        actor=principal(token)
        store=owned(actor,identifier(store_id))
    except StoreRejected as e:raise Rejected(e.code,e.status)from None
    need(store.status=='ACTIVE','OWNER_SOURCE_STORE_DISABLED',403)
    return actor,store

def validate_facts(facts,actor,store):
    exact(facts,('product_map','entries'))
    need(len(canonical(facts))<=24000,'OWNER_SOURCE_CAPACITY',422)
    mapping=facts['product_map'];entries=facts['entries']
    need(type(mapping)is dict and 0<=len(mapping)<=200,'OWNER_SOURCE_MAPPING',422)
    # This producer accepts same-store provider SKU identifiers only. It cannot
    # assert cross-market aliases or arbitrary platform entity associations.
    need(all(type(k)is str and re.fullmatch(r'[1-9][0-9]{0,19}',k)and v=='sku:'+k
             for k,v in mapping.items()),'OWNER_SOURCE_MAPPING',422)
    store_entity='store:'+str(store.pk);entities={store_entity,*mapping.values(),'all-products'}
    need(type(entries)is list and 0<len(entries)<=2000,'OWNER_SOURCE_CAPACITY',422)
    for row in entries:
        need(type(row)is dict and row.get('field')in CATALOG['fields'] and row.get('entity')in entities,
             'OWNER_SOURCE_ENTITY',422)
        rule=CATALOG['fields'][row['field']]
        need((row['entity']==store_entity)==(rule['mode']=='exact_period'),'OWNER_SOURCE_ENTITY',422)
        need(row['entity']!='all-products' or row['field']=='unit_cost','OWNER_SOURCE_ENTITY',422)
        need(row.get('currency')=='RUB','OWNER_SOURCE_CURRENCY',422)
    need(mapping or any(x['entity']=='all-products' and x['field']=='unit_cost'for x in entries),'OWNER_SOURCE_MAPPING',422)
    now=int(timezone.now().timestamp());scope_hash=digest({'tenant':str(actor.tenant_id),'store':str(store.pk)})
    payload={'schema':'alice-owner-input-snapshot/v1','revision':'structural-validation',
       'scope_hash':scope_hash,'catalog_hash':RESOLVER.hash,'issued_at':now,'expires_at':now+300,'entries':deepcopy(entries)}
    envelope={'payload':payload,'sha256':digest(payload)}
    # Structural validation only: this private pure method performs no authorization.
    # The existing authenticated actor_store above authorizes the explicit approval.
    try:
        for entity in sorted(entities):
            fields=sorted(k for k,v in CATALOG['fields'].items()
                          if (v['mode']=='exact_period')==(entity==store_entity))
            if fields:
                RESOLVER._validate(envelope,{'scope_hash':scope_hash,'entity':entity,'currency':'RUB',
                  'period':next((deepcopy(x['period'])for x in entries if x.get('period')is not None),
                    {'from':timezone.now().date().isoformat(),'to':timezone.now().date().isoformat()}),'fields':fields},now)
    except (InputError,KeyError,TypeError,ValueError)as e:
        raise Rejected(getattr(e,'code','OWNER_SOURCE_SCHEMA'),422)from None
    return deepcopy(facts)

def receipt(row):
    return {'store_id':str(row.store_id),'revision':row.revision,'status':row.status,
            'approval_id':str(row.approval_id)if row.approval_id else None,
            'catalog_hash':row.catalog_hash,'content_hash':row.content_hash}

@transaction.atomic
def execute(token,command):
    need(getattr(settings,'OWNER_DATA_ENABLED',False)is True,'NOT_FOUND',404)
    need(type(command)is dict,'OWNER_SOURCE_SCHEMA',422)
    action=command.get('action');need(action in ('read','status','approve','revoke'),'OWNER_SOURCE_ACTION',422)
    if action=='read':exact(command,('action','store_id'))
    elif action=='status':exact(command,('action','store_id','command_id'))
    elif action=='approve':exact(command,('action','store_id','command_id','expected_revision','confirmed','facts','not_after'))
    else:exact(command,('action','store_id','command_id','expected_revision','not_after'))
    actor,store=actor_store(token,command['store_id'])
    row=OwnerDataset.objects.select_for_update().filter(store=store,tenant_id=actor.tenant_id,product_id=PRODUCT).first()
    if action=='read':
        if row is None:return {'store_id':str(store.pk),'revision':0,'status':'NOT_PROVIDED','facts':None,'server_time':int(timezone.now().timestamp())}
        return {**receipt(row),'facts':deepcopy(row.facts)if row.status=='APPROVED'else None,'server_time':int(timezone.now().timestamp())}
    request_id=identifier(command['command_id'])
    if action=='status':
        old=OwnerCommand.objects.filter(product_id=PRODUCT,tenant_id=actor.tenant_id,customer_id=actor.customer_id,store=store,request_id=request_id).first()
        if old:need(old.security_revision==actor.customer.security_revision,'OWNER_SOURCE_AUTH_CHANGED',403)
        return {'state':'DONE'if old else'NOT_FOUND','receipt':deepcopy(old.result)if old else None,'server_time':int(timezone.now().timestamp())}
    need(type(command['expected_revision'])is int and command['expected_revision']>=0,'OWNER_SOURCE_REVISION',422)
    hashed=salted_hmac('alisa.owner.command.v1',json.dumps({'tenant':str(actor.tenant_id),
       'customer':str(actor.customer_id),'command':command},sort_keys=True,separators=(',',':')),algorithm='sha256').hexdigest()
    old=OwnerCommand.objects.filter(tenant_id=actor.tenant_id,customer_id=actor.customer_id,request_id=request_id).first()
    if old:
        need(old.product_id==PRODUCT and old.store_id==store.pk and old.fingerprint==hashed,'IDEMPOTENCY_CONFLICT')
        need(old.security_revision==actor.customer.security_revision,'OWNER_SOURCE_AUTH_CHANGED',403)
        return deepcopy(old.result)
    now=int(timezone.now().timestamp())
    need(type(command['not_after'])is int and command['not_after']<=now+180,'OWNER_SOURCE_DEADLINE',422)
    need(now<command['not_after'],'OWNER_COMMAND_EXPIRED')
    need((row.revision if row else 0)==command['expected_revision'],'REVISION_CONFLICT')
    # Bounded current state plus metadata-only idempotency receipts. No old costs log.
    OwnerCommand.objects.filter(tenant_id=actor.tenant_id,created_at__lt=timezone.now()-timedelta(days=1)).delete()
    need(OwnerCommand.objects.filter(tenant_id=actor.tenant_id).count()<MAX_COMMANDS,'OWNER_SOURCE_CAPACITY',429)
    if action=='approve':
        need(command['confirmed']is True,'OWNER_CONFIRMATION_REQUIRED',422)
        need(bool(store.verified_identity),'OWNER_SOURCE_STORE_UNVERIFIED',409)
        facts=validate_facts(command['facts'],actor,store)
    else:need(row is not None,'OWNER_SOURCE_NOT_APPROVED')
    if row is None:row=OwnerDataset(store=store,tenant_id=actor.tenant_id)
    row.revision+=1
    if action=='approve':
        row.status='APPROVED';row.approval_id=uuid.uuid4();row.approved_by_id=actor.customer_id
        row.approved_security_revision=actor.customer.security_revision;row.approved_at=timezone.now()
        row.catalog_hash=RESOLVER.hash;row.facts=facts;row.content_hash=digest(facts)
    else:
        row.status='REVOKED';row.facts={};row.content_hash='';row.approval_id=None
        row.approved_at=None;row.approved_by=None;row.approved_security_revision=None
    row.save()
    result=receipt(row)
    OwnerCommand.objects.create(request_id=request_id,tenant_id=actor.tenant_id,customer_id=actor.customer_id,
        store=store,fingerprint=hashed,security_revision=actor.customer.security_revision,result=result)
    return result
