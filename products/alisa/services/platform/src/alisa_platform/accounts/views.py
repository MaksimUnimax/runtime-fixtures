import hashlib
import hmac
import json
import re
import secrets
import uuid
from datetime import timedelta
from functools import wraps
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import DatabaseError,transaction,IntegrityError
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from django.views.decorators.csrf import csrf_exempt
from alisa_platform.foundation.views import reply
from alisa_platform.leads.views import event,allow
from alisa_platform.leads.models import Submission,Lead
from alisa_platform.funnel.models import FunnelEvent
from .models import Customer,Tenant,Membership,IdentityLink,AuthFlow,WebSession,ConsentRecord,LeadLink

VERSION='alisa-s02-1'
SESSION_MAX_AGE_SECONDS=30*24*60*60
def digest(value):return hashlib.sha256(value.encode()).hexdigest()

def boundary(view):
    @wraps(view)
    def wrapped(request):
        if not settings.ACCOUNTS_ENABLED:return reply({'code':'NOT_FOUND'},404)
        if not hmac.compare_digest(request.headers.get('Authorization','').encode(),('Bearer '+settings.AUTH_SERVICE_TOKEN).encode()):
            return reply({'code':'UNAUTHORIZED'},401)
        if request.method!='POST':return reply({'code':'METHOD_NOT_ALLOWED'},405)
        if request.content_type!='application/json' or request.META.get('QUERY_STRING') or len(request.body)>32768:
            return reply({'code':'INVALID_PAYLOAD'},422)
        try:
            data=json.loads(request.body)
            if not isinstance(data,dict):raise ValueError()
            return view(request,data)
        except (ValueError,KeyError,TypeError,AttributeError,ValidationError):return reply({'code':'INVALID_PAYLOAD'},422)
        except DatabaseError:return reply({'code':'DATABASE_UNAVAILABLE'},503)
    return csrf_exempt(wrapped)

def exact(data,required,optional=()):
    if not set(required)<=set(data) or set(data)-set(required)-set(optional):raise ValueError()

def opaque(value,maximum=16000):
    if not isinstance(value,str) or not 40<=len(value)<=maximum:raise ValueError()
    return value

@boundary
def flow_create(request,data):
    exact(data,{'encrypted_payload'},{'handoff_id','service_consent','privacy_consent'})
    # Legacy clients may still send their explicit consent pair during rollout.
    if {'service_consent','privacy_consent'} & set(data):
        if data.get('service_consent') is not True or data.get('privacy_consent') is not True:raise ValueError()
    with transaction.atomic():
        if not allow('auth-flow-global',60,60):return reply({'code':'RATE_LIMITED'},429)
        AuthFlow.objects.filter(expires_at__lt=timezone.now()-timedelta(days=1),websession__isnull=True).delete()
    handoff=None
    if data.get('handoff_id'):
        try:handoff=uuid.UUID(data['handoff_id'])
        except (ValueError,TypeError):pass
    secret=secrets.token_urlsafe(32)
    row=AuthFlow.objects.create(secret_hash=digest(secret),encrypted_payload=opaque(data['encrypted_payload']),
                               handoff_id=handoff,expires_at=timezone.now()+timedelta(minutes=10))
    return reply({'flow_ref':secret,'expires_in':600},201)

@boundary
def flow_consume(request,data):
    exact(data,{'flow_ref'});secret=opaque(data['flow_ref'],80)
    with transaction.atomic():
        row=AuthFlow.objects.select_for_update().filter(secret_hash=digest(secret)).first()
        if not row or row.consumed_at or row.expires_at<=timezone.now():return reply({'code':'INVALID_FLOW'},400)
        payload=row.encrypted_payload
        row.consumed_at=timezone.now();row.encrypted_payload='';row.save(update_fields=['consumed_at','encrypted_payload'])
    return reply({'flow_id':str(row.pk),'encrypted_payload':payload})

def registration_consents(value, now):
    if value == {}:
        return {}
    if not isinstance(value, dict) or set(value) != {'service', 'privacy'}:
        raise ValueError()
    result = {}
    for document, receipt in value.items():
        if not isinstance(receipt, dict) or set(receipt) != {'version', 'accepted_at'}:
            raise ValueError()
        if receipt['version'] not in {'identity-s02-1', 'identity-s02-mail-1', 'identity-s02-open-1'}:
            raise ValueError()
        stamp = receipt['accepted_at']
        if not isinstance(stamp, str) or len(stamp) > 40:
            raise ValueError()
        accepted = parse_datetime(stamp)
        if accepted is None or timezone.is_naive(accepted) or accepted.year < 2000 or accepted > now + timedelta(seconds=60):
            raise ValueError()
        result[document] = (receipt['version'], accepted)
    return result

@boundary
def session_create(request,data):
    exact(data,{'flow_id','issuer','client_id','subject','email','email_verified','session_hash','encrypted_payload'},{'registration_consents'})
    flow_id=uuid.UUID(data['flow_id']);subject=data['subject']
    if data['issuer']!=settings.IDENTITY_ISSUER or data['client_id']!=settings.OIDC_CLIENT_ID:
        return reply({'code':'WRONG_IDENTITY_CONTEXT'},403)
    if not isinstance(subject,str) or not 1<=len(subject)<=256 or data['email_verified'] is not True:raise ValueError()
    email=data['email'].strip().lower();validate_email(email)
    if len(email)>254 or (not email.endswith('@example.invalid') and not settings.REAL_LOGIN_OPEN and email not in settings.REAL_LOGIN_RECIPIENTS):raise ValueError()
    if not isinstance(data['session_hash'],str) or not re.fullmatch(r'[0-9a-f]{64}',data['session_hash']):raise ValueError()
    payload=opaque(data['encrypted_payload']);now=timezone.now()
    consents=registration_consents(data.get('registration_consents',{}),now)
    with transaction.atomic():
        flow=AuthFlow.objects.select_for_update().filter(pk=flow_id).first()
        if not flow or not flow.consumed_at or flow.expires_at<=now:return reply({'code':'INVALID_FLOW'},400)
        previous=WebSession.objects.filter(flow=flow).first()
        if previous:
            if previous.revoked_at or previous.expires_at<=now or not previous.customer.is_active:
                return reply({'code':'ACCOUNT_UNAVAILABLE'},403)
            if hmac.compare_digest(previous.token_hash,data['session_hash']):return reply({'state':'ALREADY_CREATED'})
            return reply({'code':'FLOW_ALREADY_USED'},409)
        # Serializes concurrent registrations of the same verified OIDC subject.
        from django.db import connection
        key=int.from_bytes(hashlib.sha256((data['issuer']+'\0'+data['client_id']+'\0'+subject).encode()).digest()[:8],'big',signed=True)
        with connection.cursor() as cursor:cursor.execute('SELECT pg_advisory_xact_lock(%s)',[key])
        link=IdentityLink.objects.select_related('customer').filter(issuer=data['issuer'],client_id=data['client_id'],subject=subject).first()
        created=link is None
        existing_documents=set(ConsentRecord.objects.filter(customer=link.customer,document__in=['service','privacy']).values_list('document',flat=True)) if link else set()
        if existing_documents | set(consents) != {'service','privacy'}:
            return reply({'code':'CONSENT_REQUIRED'},403)
        if created:
            customer=Customer.objects.create(email=email)
            tenant=Tenant.objects.create()
            Membership.objects.create(customer=customer,tenant=tenant,role='OWNER_CLIENT')
            link=IdentityLink.objects.create(customer=customer,issuer=data['issuer'],client_id=data['client_id'],subject=subject)
        customer=link.customer
        if not customer.is_active:return reply({'code':'ACCOUNT_UNAVAILABLE'},403)
        if customer.email!=email:
            customer.email=email;customer.save(update_fields=['email'])
        membership=Membership.objects.get(customer=customer)
        for document in set(consents)-existing_documents:
            version,accepted_at=consents[document]
            receipt=ConsentRecord.objects.create(customer=customer,document=document,version=version)
            ConsentRecord.objects.filter(pk=receipt.pk).update(accepted_at=accepted_at)
        WebSession.objects.create(token_hash=data['session_hash'],customer=customer,tenant=membership.tenant,flow=flow,
            encrypted_payload=payload,security_revision=customer.security_revision,expires_at=now+timedelta(seconds=SESSION_MAX_AGE_SECONDS))
        flow.completed_at=now;flow.save(update_fields=['completed_at'])
        registration_attribution=None
        if flow.handoff_id:
            submission=Submission.objects.select_related('lead').filter(pk=flow.handoff_id).first()
            if submission and submission.created_at and submission.created_at>now-timedelta(days=1) and submission.lead.email==email and submission.lead.confirmed_at and submission.lead.expires_at>now:
                lead=Lead.objects.select_for_update().get(pk=submission.lead_id)
                linked=LeadLink.objects.select_for_update().filter(lead=lead).first()
                if not linked:
                    LeadLink.objects.create(lead=lead,customer=customer)
                    source=FunnelEvent.objects.filter(subject_id=lead.pk,event_type='lead.submitted').first()
                    registration_attribution=source.attribution if source else None
        if created:event('customer.registered',customer.id,registration_attribution)
        return reply({'state':'CREATED'},201)

def session(data):
    token=opaque(data['session_token'],80)
    row=WebSession.objects.select_related('customer','tenant').filter(token_hash=digest(token),revoked_at__isnull=True,expires_at__gt=timezone.now()).first()
    if not row or not row.customer.is_active or row.security_revision!=row.customer.security_revision:return None
    if not Membership.objects.filter(customer=row.customer,tenant=row.tenant,role='OWNER_CLIENT').exists():return None
    return row

def profile(row):
    access_status='NOT_PROVISIONED'
    if settings.ENTITLEMENTS_ENABLED:
        from alisa_platform.entitlements.service import snapshot
        access_status=snapshot(row.tenant_id)['status']
    return {'customer_id':str(row.customer_id),'tenant_id':str(row.tenant_id),'email':row.customer.email,
            'display_name':row.customer.display_name,'role':'OWNER_CLIENT','access_status':access_status,'stores':[]}

@boundary
def me(request,data):
    exact(data,{'session_token'})
    row=session(data)
    if not row:return reply({'code':'AUTHENTICATION_REQUIRED'},401)
    return reply({'profile':profile(row)})

@boundary
def update_profile(request,data):
    exact(data,{'session_token','display_name'})
    name=data['display_name']
    if not isinstance(name,str) or len(name.strip())>80 or any(ord(c)<32 for c in name):raise ValueError()
    with transaction.atomic():
        row=session(data)
        if not row:return reply({'code':'AUTHENTICATION_REQUIRED'},401)
        row.customer.display_name=name.strip();row.customer.save(update_fields=['display_name'])
    return reply({'profile':profile(row)})

@boundary
def logout(request,data):
    exact(data,{'session_token'});token=opaque(data['session_token'],80)
    WebSession.objects.filter(token_hash=digest(token),revoked_at__isnull=True).update(revoked_at=timezone.now(),encrypted_payload='')
    return reply({'state':'SIGNED_OUT'})
