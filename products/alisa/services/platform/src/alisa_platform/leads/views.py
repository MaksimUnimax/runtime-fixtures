import hashlib
import hmac
import json
import secrets
import uuid
from datetime import timedelta
from functools import wraps
from urllib.parse import urlencode
from django.conf import settings
from django.db import DatabaseError, transaction
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from alisa_platform.foundation.views import reply
from alisa_platform.funnel.models import FunnelEvent
from .models import Lead, MailOutbox, RateBucket, Submission
from .policy import attribution, contact, CONTENT_VERSION

def enabled():
    return settings.ALISA_ENV in {'stage', 'dev'} and settings.LEAD_INTAKE_ENABLED and settings.LANDING_RELEASE_MODE == 'CLOSED'

def boundary(view):
    @wraps(view)
    def wrapped(request):
        if not enabled(): return reply({'code': 'NOT_FOUND'}, 404)
        if not hmac.compare_digest(request.headers.get('Authorization', '').encode(), ('Bearer '+settings.SERVICE_TOKEN).encode()):
            return reply({'code': 'UNAUTHORIZED'}, 401)
        if request.method != 'POST': return reply({'code': 'METHOD_NOT_ALLOWED'}, 405)
        if request.content_type != 'application/json' or request.META.get('QUERY_STRING') or len(request.body) > 2048:
            return reply({'code': 'INVALID_PAYLOAD'}, 422)
        try:
            payload = json.loads(request.body)
            if not isinstance(payload, dict): raise ValueError()
            with transaction.atomic():
                if not allow('global', 120, 60): return reply({'code': 'RATE_LIMITED'}, 429)
                return view(request, payload)
        except (ValueError, TypeError, KeyError): return reply({'code': 'INVALID_PAYLOAD'}, 422)
        except DatabaseError: return reply({'code': 'DATABASE_UNAVAILABLE'}, 503)
    return csrf_exempt(wrapped)

def allow(subject, limit, seconds):
    now = timezone.now(); window = int(now.timestamp()) // seconds
    key = hmac.new(settings.SECRET_KEY.encode(), (subject+':'+str(window)).encode(), hashlib.sha256).hexdigest()
    bucket, _ = RateBucket.objects.get_or_create(key=key, defaults={'expires_at': now+timedelta(seconds=seconds*2)})
    bucket = RateBucket.objects.select_for_update().get(pk=key)
    if bucket.count >= limit: return False
    bucket.count += 1; bucket.save(update_fields=['count']); return True

def event(kind, subject=None, attrs=None, event_id=None, basis='service'):
    defaults = {'event_type': kind, 'subject_id': subject, 'environment': settings.ALISA_ENV,
                'release': settings.RELEASE, 'content_version': CONTENT_VERSION,
                'attribution': attribution(attrs), 'basis': basis}
    if subject is not None:
        return FunnelEvent.objects.get_or_create(event_type=kind, subject_id=subject, defaults=defaults)
    return FunnelEvent.objects.get_or_create(id=event_id or uuid.uuid4(), defaults=defaults)

@boundary
def submit(request, payload):
    if set(payload)-{'request_id', 'email', 'service_consent', 'marketing_consent', 'attribution'}:
        raise ValueError()
    request_id = uuid.UUID(payload['request_id'])
    if payload.get('service_consent') is not True or not isinstance(payload.get('marketing_consent', False), bool):
        raise ValueError()
    try: email = contact(payload.get('email'))
    except ValueError as exc: return reply({'code': str(exc)}, 422)
    digest = hashlib.sha256(email.encode()).hexdigest()
    previous = Submission.objects.filter(pk=request_id).first()
    if previous:
        if not hmac.compare_digest(previous.contact_digest, digest): return reply({'code': 'IDEMPOTENCY_CONFLICT'}, 409)
        return reply({'state': 'ACCEPTED', 'delivery': 'QUEUED_IF_NEW'}, 202)
    if not allow('contact:'+email, 5, 3600): return reply({'code': 'RATE_LIMITED'}, 429)
    now = timezone.now(); token = secrets.token_urlsafe(32)
    lead, created = Lead.objects.get_or_create(email=email, defaults={
        'expires_at': now+timedelta(days=90), 'token_hash': hashlib.sha256(token.encode()).hexdigest(),
        'token_expires_at': now+timedelta(minutes=15), 'marketing_consent': payload.get('marketing_consent', False)})
    lead = Lead.objects.select_for_update().get(pk=lead.pk)
    refreshed = not created and not lead.confirmed_at and lead.token_expires_at <= now
    if refreshed:
        lead.token_hash = hashlib.sha256(token.encode()).hexdigest(); lead.token_expires_at = now+timedelta(minutes=15); lead.failed_attempts = 0
        lead.save(update_fields=['token_hash', 'token_expires_at', 'failed_attempts'])
    if created or refreshed:
        fragment = urlencode({'lead_id': str(lead.id), 'token': token})
        url = settings.PUBLIC_BASE_URL+'/join/confirm#'+fragment
        MailOutbox.objects.update_or_create(lead=lead, defaults={'body': 'Подтвердите тестовую заявку Алисы в течение 15 минут:\n'+url+'\nЗаявка не создаёт аккаунт и не выдаёт доступ. Если вы не отправляли её, проигнорируйте письмо.', 'sent_at': None, 'attempts': 0})
        event('lead.submitted', lead.id, payload.get('attribution'))
    Submission.objects.create(id=request_id, lead=lead, contact_digest=digest)
    # Identical response for new, pending and already confirmed contacts.
    return reply({'state': 'ACCEPTED', 'delivery': 'QUEUED_IF_NEW'}, 202)

@boundary
def confirm(request, payload):
    if set(payload) != {'lead_id', 'token'}: raise ValueError()
    lead_id = uuid.UUID(payload['lead_id']); token = payload['token']
    if not isinstance(token, str) or not 32 <= len(token) <= 80: raise ValueError()
    lead = Lead.objects.select_for_update().filter(pk=lead_id).first(); now = timezone.now()
    if not lead or lead.confirmed_at or lead.token_expires_at <= now or lead.failed_attempts >= 5:
        return reply({'code': 'INVALID_OR_EXPIRED_LINK'}, 400)
    if not hmac.compare_digest(lead.token_hash, hashlib.sha256(token.encode()).hexdigest()):
        lead.failed_attempts += 1; lead.save(update_fields=['failed_attempts'])
        return reply({'code': 'INVALID_OR_EXPIRED_LINK'}, 400)
    lead.confirmed_at = now; lead.token_hash = ''; lead.save(update_fields=['confirmed_at', 'token_hash'])
    original = FunnelEvent.objects.filter(subject_id=lead.id, event_type='lead.submitted').first()
    event('lead.confirmed', lead.id, original.attribution if original else None)
    return reply({'state': 'CONFIRMED'})

@boundary
def client_event(request, payload):
    if set(payload) != {'event_id', 'event_type', 'analytics_consent', 'attribution'}: raise ValueError()
    if payload['event_type'] not in {'landing.view', 'demo.opened', 'cta.clicked'}: raise ValueError()
    event_id = uuid.UUID(payload['event_id'])
    if payload['analytics_consent'] is not True: return reply({'state': 'NOT_TRACKED'}, 202)
    event(payload['event_type'], attrs=payload.get('attribution'), event_id=event_id, basis='consent')
    return reply({'state': 'RECORDED'}, 202)
