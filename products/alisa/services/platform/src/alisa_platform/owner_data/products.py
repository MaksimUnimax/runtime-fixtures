"""Read-only reference catalogue for the owner form. No financial calculations.

Provider IO stays in the existing private checker process with shared bounded
HTTP. Session/store/credential checks run before and after IO; no DB lock spans
network. Browser cursors cannot change provider, account, URL or filter.
"""
from copy import deepcopy
import uuid
from django.conf import settings
from django.core import signing
from django.db import transaction
from alisa_platform.stores.models import CredentialRevision,VaultSecret
from alisa_platform.stores import vault
from alisa_platform.runtime_adapter.store_check import check_store
from alisa_platform.leads.views import allow
from .service import actor_store,need,Rejected,PRODUCT
from .owner_inputs import digest
SALT='alisa-owner-product-cursor-v1'

def page(token,store_id,cursor=''):
 need(getattr(settings,'OWNER_DATA_ENABLED',False)is True,'NOT_FOUND',404)
 need(type(cursor)is str and len(cursor)<=4096,'INVALID_CURSOR',422)
 with transaction.atomic():
  actor,store=actor_store(token,store_id)
  need(bool(store.verified_identity),'OWNER_SOURCE_STORE_UNVERIFIED')
  kind='SELLER'if store.provider=='OZON'else'WB'
  candidates=list(CredentialRevision.objects.filter(product_id=PRODUCT,tenant_id=store.tenant_id,store=store,kind=kind,status='ACTIVE')[:2])
  need(len(candidates)==1 and candidates[0].check_code=='CONNECTED','CATALOG_CREDENTIAL_UNQUALIFIED',403)
  candidate=candidates[0]
  scope={'environment':settings.ALISA_ENV,'tenant':str(store.tenant_id),'store':str(store.pk),'revision':store.revision,'credential':str(candidate.pk),'credential_revision':candidate.revision,'security_revision':actor.customer.security_revision}
  raw_cursor={}
  if cursor:
   try:
    pin=signing.loads(cursor,salt=SALT,max_age=900)
    need(type(pin)is dict and set(pin)=={'scope','cursor'}and pin['scope']==scope,'INVALID_CURSOR',422)
    raw_cursor=pin['cursor']
   except signing.BadSignature:raise Rejected('INVALID_CURSOR',422)from None
  # Reference browsing is bounded independently of financial report jobs; no
  # report or analytical-cache bypass. Current aliases share this identity key.
  key='owner-product-catalog:'+digest([settings.ALISA_ENV,store.provider,store.verified_identity])
  need(allow(key+':burst',1,3)and allow(key+':day',100,86400),'RATE_LIMITED',429)
  pins={'environment':settings.ALISA_ENV,'product_id':PRODUCT,'tenant_id':str(store.tenant_id),'store_id':str(store.pk),'provider':store.provider,'kind':kind,'credential_revision':candidate.revision,'store_revision':store.revision,'request_id':str(uuid.uuid4())}
  secret=VaultSecret.objects.get(pk=candidate.secret_id,tenant_id=store.tenant_id,store=store)
  material=vault.open_secret(store,candidate,secret)
 try:result=check_store(pins,material,catalog_cursor=raw_cursor)
 finally:del material
 with transaction.atomic():
  actor2,store2=actor_store(token,store_id)
  current=CredentialRevision.objects.filter(pk=candidate.pk,tenant_id=store2.tenant_id,store=store2,status='ACTIVE',check_code='CONNECTED',revision=candidate.revision).exists()
  need(current and store2.revision==scope['revision']and actor2.customer.security_revision==scope['security_revision'],'REVISION_CONFLICT')
  code=result.get('code')
  need(code=='OK',code if code in {'RATE_LIMITED','AUTH_DENIED','SCOPE_MISSING','CATALOG_INCOMPLETE','CHECK_UNAVAILABLE','TIMEOUT','PROVIDER_UNAVAILABLE','PROVIDER_PLAN_REQUIRED'}else'CATALOG_UNAVAILABLE',429 if code=='RATE_LIMITED'else 503)
  next_cursor=signing.dumps({'scope':scope,'cursor':result['cursor']},salt=SALT,compress=True)if result['cursor']else None
  items=deepcopy(result['items'])
  if getattr(settings,'OWNER_PARAMETERS_ENABLED',False):
   from .parameter_service import sku_reference
   for item in items:item['parameter_reference']=sku_reference(actor2,store2,item['sku'])
  return {'items':items,'next_cursor':next_cursor,'complete':result['complete'],'store_id':str(store2.pk),'provider':store2.provider}
