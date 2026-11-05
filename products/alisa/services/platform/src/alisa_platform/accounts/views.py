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
from django.views.decorators.csrf import csrf_exempt
from alisa_platform.foundation.views import reply
from alisa_platform.leads.views import event,allow
from alisa_platform.leads.models import Submission,Lead
from alisa_platform.funnel.models import FunnelEvent
from .models import Customer,Tenant,Membership,IdentityLink,AuthFlow,WebSession,ConsentRecord,LeadLink

VERSION='alisa-s02-1'
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
    exact(data,{'encrypted_payload','service_consent','privacy_consent'},{'handoff_id'})
    if data['service_consent'] is not True or data['privacy_consent'] is not True:raise ValueError()
    with transaction.atomic():
        if not allow('auth-flow-global',60,60):return reply({'code':'RATE_LIMITED'},429)
        AuthFlow.objects.filter(expires_at__lt=timezone.now()-timedelta(days=1)).delete()
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

@boundary
def session_create(request,data):
    exact(data,{'flow_id','issuer','client_id','subject','email','email_verified','session_hash','encrypted_payload'})
    flow_id=uuid.UUID(data['flow_id']);subject=data['subject']
    if data['issuer']!=settings.IDENTITY_ISSUER or data['client_id']!=settings.OIDC_CLIENT_ID:
        return reply({'code':'WRONG_IDENTITY_CONTEXT'},403)
    if not isinstance(subject,str) or not 1<=len(subject)<=256 or data['email_verified'] is not True:raise ValueError()
    email=data['email'].strip().lower();validate_email(email)
    if len(email)>254 or (not email.endswith('@example.invalid') and email not in settings.REAL_LOGIN_RECIPIENTS):raise ValueError()
    if not isinstance(data['session_hash'],str) or not re.fullmatch(r'[0-9a-f]{64}',data['session_hash']):raise ValueError()
    payload=opaque(data['encrypted_payload']);now=timezone.now()
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
        for document in ['service','privacy']:
            ConsentRecord.objects.get_or_create(customer=customer,document=document,version=VERSION)
        WebSession.objects.create(token_hash=data['session_hash'],customer=customer,tenant=membership.tenant,flow=flow,
            encrypted_payload=payload,security_revision=customer.security_revision,expires_at=now+timedelta(hours=1))
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
    return {'customer_id':str(row.customer_id),'tenant_id':str(row.tenant_id),'email':row.customer.email,
            'display_name':row.customer.display_name,'role':'OWNER_CLIENT','access_status':'NOT_PROVISIONED','stores':[]}

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
