"""Short signed publication authority over an already committed product decision.

The native peer verifies this through the existing authenticated authority RPC.
Neither a browser role nor a model message is a publication capability.
"""
import hashlib
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from alisa_platform.staff.models import StaffMember,StaffSession
from alisa_platform.staff.policy import PRODUCT,session_allowed
from alisa_platform.staff.service import principal
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from .models import CatalogAssignment,CatalogPublication
from .package_rules import digest,exact,need

SALT='alisa.catalog.publication.v1'


def enabled():
 need(getattr(settings,'CATALOG_RELEASE_ENABLED',False)is True,'CATALOG_RELEASE_UNAVAILABLE')


def binding(authority,tenant):
 from alisa_platform.accounts.models import Tenant,Membership
 enabled();need(tenant in settings.CATALOG_PILOT_TENANTS,'CATALOG_TENANT_NOT_ALLOWED')
 need(Tenant.objects.filter(pk=tenant).exists(),'CATALOG_TENANT_NOT_BOUND')
 need(Membership.objects.filter(tenant_id=tenant,role='OWNER_CLIENT',customer__is_active=True).exists(),
      'CATALOG_TENANT_NOT_BOUND')
 value=authority.bindings.for_tenant(tenant,environment=settings.ALISA_ENV,
  service_id=authority.service_id,catalog_release_id=authority.catalog_release_id)
 need(value is not None,'CATALOG_TENANT_NOT_BOUND')
 return value


@transaction.atomic
def mint(publication_id,session_token):
 enabled();actor=principal(session_token,'catalog.publish')
 need(actor is not None,'CATALOG_FORBIDDEN')
 row=StaffSession.objects.get(member=actor,token_hash=hashlib.sha256(session_token.encode()).hexdigest())
 payload={'schema':'alisa-catalog-control/v1','publication_id':str(publication_id),
  'session_id':str(row.pk),'actor_id':str(actor.pk),'actor_revision':actor.revision,
  'service_id':settings.RUNTIME_SERVICE_ID}
 return signing.dumps(payload,salt=SALT,compress=True)


def current_session(value):
 # Preserve the staff principal lock order: member first, then session.
 member=StaffMember.objects.select_for_update().filter(pk=value['actor_id']).first()
 need(member is not None and member.revision==value['actor_revision'],'CATALOG_FORBIDDEN')
 row=StaffSession.objects.select_for_update().filter(pk=value['session_id'],member=member).first()
 need(row is not None,'CATALOG_FORBIDDEN')
 allowed=session_allowed(
  {'product_id':member.product_id,'issuer':member.issuer,'client_id':member.client_id,
   'active':member.active,'revision':member.revision,'role':member.role,'permissions':member.permissions},
  {'product_id':row.product_id,'revision':row.revision,'revoked':row.revoked_at is not None,
   'expires_at':row.expires_at.timestamp(),'created_at':row.created_at.timestamp(),
   'mfa_at':row.mfa_verified_at.timestamp(),'mfa_type':row.mfa_type},
  issuer=settings.IDENTITY_ISSUER,client=settings.STAFF_CLIENT_ID,
  now=timezone.now().timestamp(),permission='catalog.publish')
 need(allowed,'CATALOG_FORBIDDEN')


@transaction.atomic
def rpc(authority,payload):
 from .package_rules import ReleaseFailure
 try:
  enabled();exact(payload,{'ticket'})
  need(type(payload['ticket'])is str and 0<len(payload['ticket'])<=4096,'CATALOG_FORBIDDEN')
  try:value=signing.loads(payload['ticket'],salt=SALT,max_age=120)
  except signing.BadSignature:raise RuntimeFailure('PERMISSION_DENIED')from None
  exact(value,{'schema','publication_id','session_id','actor_id','actor_revision','service_id'})
  need(value['schema']=='alisa-catalog-control/v1'and value['service_id']==authority.service_id,
       'CATALOG_FORBIDDEN')
  current_session(value)
  publication=CatalogPublication.objects.get(pk=value['publication_id'])
  assignment=CatalogAssignment.objects.get(tenant_id=publication.tenant_id)
  target=assignment.release_id or''
  need(assignment.revision==publication.revision and target==publication.package_sha256,
       'CATALOG_ASSIGNMENT_CONFLICT')
  mapping=binding(authority,str(publication.tenant_id))
  need(mapping['runtime_tenant']==publication.runtime_tenant and digest(mapping)==publication.binding_sha256,
       'CATALOG_BINDING_CHANGED')
  return {'request_id':str(publication.pk),'runtime_tenant':publication.runtime_tenant,
   'expected_revision':publication.expected_revision,'revision':publication.revision,
   'package_sha256':publication.package_sha256,'engine_sha256':publication.engine_sha256,
   'template_hash':publication.template_hash,'qualification_sha256':publication.qualification_sha256}
 except ReleaseFailure as error:
  raise RuntimeFailure('PERMISSION_DENIED'if error.code=='CATALOG_FORBIDDEN'else'CATALOG_INCOMPATIBLE')from None

