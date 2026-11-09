import hmac
import json
import logging
import uuid
from functools import wraps
from django.conf import settings
from django.db import DatabaseError, connection, transaction
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from .models import FoundationProbe, FoundationJob

logger = logging.getLogger("alisa.foundation")

def reply(data, status=200):
    response = JsonResponse({**data, "environment": settings.ALISA_ENV, "release": settings.RELEASE}, status=status)
    response["Cache-Control"] = "no-store"
    return response

def service_only(view):
    @wraps(view)
    def wrapped(request, *args, **kwargs):
        if not settings.FOUNDATION_PROBE_ENABLED:
            return reply({"code": "NOT_FOUND"}, 404)
        if not hmac.compare_digest(request.headers.get("Authorization", "").encode(), ("Bearer " + settings.SERVICE_TOKEN).encode()):
            return reply({"code": "UNAUTHORIZED"}, 401)
        try:
            return view(request, *args, **kwargs)
        except DatabaseError:
            # Do not log driver exceptions: their text may contain connection data.
            logger.warning(json.dumps({"event": "database_unavailable"}))
            return reply({"code": "DATABASE_UNAVAILABLE"}, 503)
    return wrapped

def live(request):
    return reply({"component": "platform", "status": "LIVE"})

def ready(request):
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM django_migrations WHERE app = %s AND name = %s", ["foundation", "0001_initial"])
            if not cursor.fetchone():
                return reply({"code": "SCHEMA_NOT_READY"}, 503)
            cursor.execute("SELECT 1 FROM foundation_foundationprobe LIMIT 1")
            if settings.LEAD_INTAKE_ENABLED:
                cursor.execute('SELECT 1 FROM leads_lead LIMIT 1')
                cursor.execute('SELECT 1 FROM funnel_funnelevent LIMIT 1')
            if settings.ACCOUNTS_ENABLED:
                cursor.execute('SELECT 1 FROM accounts_customer LIMIT 1')
                cursor.execute('SELECT 1 FROM accounts_websession LIMIT 1')
            if settings.ENTITLEMENTS_ENABLED:
                cursor.execute('SELECT 1 FROM entitlements_accessgrant LIMIT 1')
                cursor.execute('SELECT 1 FROM entitlements_accessnotification LIMIT 1')
            if settings.STORES_ENABLED:
                cursor.execute('SELECT 1 FROM stores_store LIMIT 1')
                cursor.execute('SELECT 1 FROM stores_vaultsecret LIMIT 1')
                cursor.execute('SELECT 1 FROM stores_credentialrevision LIMIT 1')
            if settings.ALICE_LINK_ENABLED:
                cursor.execute('SELECT 1 FROM alice_link_alicelink LIMIT 1')
                cursor.execute('SELECT 1 FROM alice_link_authorizationrequest LIMIT 1')
                cursor.execute('SELECT 1 FROM alice_link_authorizationcode LIMIT 1')
                cursor.execute('SELECT 1 FROM alice_link_tokenfamily LIMIT 1')
            if settings.STAFF_ENABLED:
                cursor.execute('SELECT 1 FROM staff_staffmember LIMIT 1')
                cursor.execute('SELECT 1 FROM staff_staffsession LIMIT 1')
                cursor.execute('SELECT 1 FROM staff_staffauditevent LIMIT 1')
        return reply({"component": "platform", "status": "READY", "runtime": "RUNTIME_NOT_CONNECTED"})
    except DatabaseError:
        return reply({"code": "DATABASE_UNAVAILABLE"}, 503)

@csrf_exempt
@service_only
def probes(request):
    if request.method != "POST":
        return reply({"code": "METHOD_NOT_ALLOWED"}, 405)
    if request.content_type != "application/json" or len(request.body) > 512:
        return reply({"code": "INVALID_PAYLOAD"}, 422)
    try:
        payload = json.loads(request.body)
        if not isinstance(payload, dict) or set(payload) != {"probe_id", "kind"} or payload["kind"] != "foundation-v1":
            raise ValueError()
        probe_id = uuid.UUID(payload["probe_id"])
    except (ValueError, TypeError, KeyError, AttributeError):
        return reply({"code": "INVALID_PAYLOAD"}, 422)
    with transaction.atomic():
        row, created = FoundationProbe.objects.get_or_create(id=probe_id, defaults={"accepted_release": settings.RELEASE})
        if row.expires_at <= timezone.now():
            return reply({"code": "PROBE_EXPIRED"}, 410)
        FoundationJob.objects.get_or_create(probe=row)
    logger.info(json.dumps({"event": "probe_accepted", "probe_id": str(row.id), "correlation_id": str(row.correlation_id), "created": created}))
    return reply(serialize(row), 202 if created else 200)

def serialize(row):
    return {"probe_id": str(row.id), "kind": row.kind, "correlation_id": str(row.correlation_id),
            "state": row.state, "effect_count": row.effect_count,
            "accepted_release": row.accepted_release, "processed_release": row.processed_release}

@service_only
def probe(request, probe_id):
    if request.method != "GET":
        return reply({"code": "METHOD_NOT_ALLOWED"}, 405)
    row = FoundationProbe.objects.filter(id=probe_id, expires_at__gt=timezone.now()).first()
    return reply(serialize(row)) if row else reply({"code": "NOT_FOUND"}, 404)
