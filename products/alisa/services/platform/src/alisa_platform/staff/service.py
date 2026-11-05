"""Local staff mutations: transactional revisions, own customer scope and safe audit."""
import hashlib
import uuid
from django.conf import settings
from django.db import connection,transaction
from django.utils import timezone
from alisa_platform.accounts.models import Customer,WebSession
from .models import StaffMember,StaffSession,StaffAuditEvent
from .policy import PRODUCT,session_allowed,permissions,reason,identifier,positive_revision,audit_projection


def owner_lock():
    key=int.from_bytes(hashlib.sha256((PRODUCT+':staff-owner').encode()).digest()[:8],'big',signed=True)
    with connection.cursor() as cursor:cursor.execute('SELECT pg_advisory_xact_lock(%s)',[key])

def audit(actor,action,target,why,outcome,before=None,after=None):
    return StaffAuditEvent.objects.create(product_id=PRODUCT,actor_id=actor.pk if actor else None,
        action=action,target_id=target,reason=reason(why),outcome=outcome,
        before=audit_projection(before or {}),after=audit_projection(after or {}))

def principal(token,permission):
    if not settings.STAFF_ENABLED or not isinstance(token,str) or not 40<=len(token)<=80:return None
    row=StaffSession.objects.filter(token_hash=hashlib.sha256(token.encode()).hexdigest()).only('id','member_id').first()
    if not row:return None
    member=StaffMember.objects.select_for_update().get(pk=row.member_id)
    row=StaffSession.objects.select_for_update().filter(pk=row.pk,member=member).first()
    if not row:return None
    allowed=session_allowed({'product_id':member.product_id,'issuer':member.issuer,'client_id':member.client_id,'active':member.active,'revision':member.revision,'role':member.role,'permissions':member.permissions},
        {'product_id':row.product_id,'revision':row.revision,'revoked':row.revoked_at is not None,'expires_at':row.expires_at.timestamp(),'created_at':row.created_at.timestamp(),'mfa_at':row.mfa_verified_at.timestamp(),'mfa_type':row.mfa_type},
        issuer=settings.IDENTITY_ISSUER,client=settings.STAFF_CLIENT_ID,now=timezone.now().timestamp(),permission=permission)
    if not allowed:
        audit(member,'staff.denied',None,'SECURITY_REVIEW','DENIED')
        return None
    return member

@transaction.atomic
def bootstrap_owner(subject,name):
    if not settings.STAFF_ENABLED:raise ValueError('Staff capability disabled')
    subject=identifier(subject)
    if not isinstance(name,str) or not 1<=len(name.strip())<=80:raise ValueError('Named owner required')
    owner_lock()
    if StaffMember.objects.filter(product_id=PRODUCT).exists():raise ValueError('Initial staff already exists; bootstrap cannot rotate authority')
    member=StaffMember.objects.create(product_id=PRODUCT,issuer=settings.IDENTITY_ISSUER,client_id=settings.STAFF_CLIENT_ID,subject=subject,name=name.strip(),role='OWNER',permissions=[])
    audit(None,'staff.bootstrap',member.pk,'BOOTSTRAP','APPLIED',after={'staff_id':str(member.pk),'role':'OWNER','revision':1})
    return member

@transaction.atomic
def block_customer(token,customer_id,active,expected_revision,why):
    target=uuid.UUID(identifier(customer_id));expected=positive_revision(expected_revision);why=reason(why)
    if type(active) is not bool:raise ValueError('Boolean status required')
    actor=principal(token,'users.unblock' if active else 'users.block')
    if actor is None:return {'code':'FORBIDDEN'},403
    customer=Customer.objects.select_for_update().filter(pk=target).first()
    if customer is None:return {'code':'NOT_FOUND'},404
    if customer.security_revision!=expected:return {'code':'REVISION_CONFLICT'},409
    before={'customer_id':str(customer.pk),'active':customer.is_active,'revision':customer.security_revision}
    if customer.is_active==active:return {'state':'ALREADY_APPLIED','revision':customer.security_revision},200
    customer.is_active=active;customer.security_revision+=1;customer.save(update_fields=['is_active','security_revision'])
    # Local Alisa sessions are revoked; the authority person and other products are never changed.
    WebSession.objects.filter(customer=customer,revoked_at__isnull=True).update(revoked_at=timezone.now(),encrypted_payload='')
    after={'customer_id':str(customer.pk),'active':active,'revision':customer.security_revision}
    audit(actor,'customer.unblocked' if active else 'customer.blocked',customer.pk,why,'APPLIED',before,after)
    return {'state':'APPLIED','revision':customer.security_revision},200

@transaction.atomic
def assign_admin(token,subject,name,permission_set,why):
    subject=identifier(subject);perms=permissions(permission_set);why=reason(why)
    if not isinstance(name,str) or not 1<=len(name.strip())<=80:raise ValueError('Named staff required')
    owner_lock()
    actor=principal(token,'staff.manage')
    if actor is None:return {'code':'FORBIDDEN'},403

    target=StaffMember.objects.select_for_update().filter(product_id=PRODUCT,issuer=settings.IDENTITY_ISSUER,client_id=settings.STAFF_CLIENT_ID,subject=subject).first()
    if target and target.role=='OWNER':return {'code':'OWNER_PROTECTED'},409
    if target:
        target.name=name.strip();target.permissions=perms;target.active=True;target.revision+=1;target.save(update_fields=['name','permissions','active','revision'])
        StaffSession.objects.filter(member=target,revoked_at__isnull=True).update(revoked_at=timezone.now(),encrypted_payload='')
    else:target=StaffMember.objects.create(product_id=PRODUCT,issuer=settings.IDENTITY_ISSUER,client_id=settings.STAFF_CLIENT_ID,subject=subject,name=name.strip(),role='ADMIN',permissions=perms)
    audit(actor,'staff.assigned',target.pk,why,'APPLIED',after={'staff_id':str(target.pk),'role':'ADMIN','permissions':perms,'revision':target.revision})
    return {'state':'APPLIED','staff_id':str(target.pk),'revision':target.revision},200

@transaction.atomic
def revoke_staff(token,staff_id,expected_revision,why):
    target_id=uuid.UUID(identifier(staff_id));expected=positive_revision(expected_revision);why=reason(why)
    owner_lock()
    actor=principal(token,'staff.manage')
    if actor is None:return {'code':'FORBIDDEN'},403
    target=StaffMember.objects.select_for_update().filter(product_id=PRODUCT,pk=target_id).first()
    if target is None:return {'code':'NOT_FOUND'},404
    if target.revision!=expected:return {'code':'REVISION_CONFLICT'},409
    if target.role=='OWNER' and StaffMember.objects.filter(product_id=PRODUCT,role='OWNER',active=True).count()<=1:return {'code':'LAST_OWNER_PROTECTED'},409
    target.active=False;target.revision+=1;target.save(update_fields=['active','revision'])
    StaffSession.objects.filter(member=target,revoked_at__isnull=True).update(revoked_at=timezone.now(),encrypted_payload='')
    audit(actor,'staff.revoked',target.pk,why,'APPLIED',after={'staff_id':str(target.pk),'active':False,'revision':target.revision})
    return {'state':'APPLIED','revision':target.revision},200
