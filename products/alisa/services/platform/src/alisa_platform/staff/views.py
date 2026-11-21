"""Dedicated BFF authority; every read/mutation rechecks current staff state."""
import hashlib
import hmac
import json
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone as tz
from functools import wraps

from django.conf import settings
from django.db import DatabaseError, connection, transaction
from django.db.models import Q
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from alisa_platform.accounts.models import Customer, Membership
from alisa_platform.accounts.views import exact, opaque
from alisa_platform.foundation.views import reply
from alisa_platform.leads.models import Lead
from alisa_platform.leads.views import allow
from .models import StaffAuthFlow, StaffSession, StaffMember, StaffAuditEvent, StaffCommandReceipt
from .policy import PRODUCT, OWNER_PERMISSIONS, identifier, reason, permissions
from .service import principal, audit, owner_lock, block_customer, assign_admin, revoke_staff


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def boundary(view):
    @wraps(view)
    def wrapped(request):
        if not settings.STAFF_ENABLED:
            return reply({'code': 'NOT_FOUND'}, 404)
        if not hmac.compare_digest(request.headers.get('Authorization', '').encode(),
                ('Bearer ' + settings.STAFF_SERVICE_TOKEN).encode()):
            return reply({'code': 'UNAUTHORIZED'}, 401)
        if request.method != 'POST':
            return reply({'code': 'METHOD_NOT_ALLOWED'}, 405)
        if request.content_type != 'application/json' or request.META.get('QUERY_STRING') or len(request.body) > 32768:
            return reply({'code': 'INVALID_PAYLOAD'}, 422)
        try:
            data = json.loads(request.body)
            if not isinstance(data, dict):
                raise ValueError()
            return view(request, data)
        except (ValueError, KeyError, TypeError, AttributeError, OverflowError):
            return reply({'code': 'INVALID_PAYLOAD'}, 422)
        except DatabaseError:
            return reply({'code': 'DATABASE_UNAVAILABLE'}, 503)
    return csrf_exempt(wrapped)


@boundary
def flow_create(request, data):
    exact(data, {'encrypted_payload'})
    with transaction.atomic():
        if not allow('staff-flow-global', 60, 60):
            return reply({'code': 'RATE_LIMITED'}, 429)
        secret = secrets.token_urlsafe(32)
        StaffAuthFlow.objects.create(product_id=PRODUCT, secret_hash=digest(secret),
            encrypted_payload=opaque(data['encrypted_payload']), expires_at=timezone.now() + timedelta(minutes=10))
    return reply({'flow_ref': secret, 'expires_in': 600}, 201)


@boundary
def flow_consume(request, data):
    exact(data, {'flow_ref'})
    secret = opaque(data['flow_ref'], 80)
    with transaction.atomic():
        row = StaffAuthFlow.objects.select_for_update().filter(product_id=PRODUCT, secret_hash=digest(secret)).first()
        if not row or row.consumed_at or row.expires_at <= timezone.now():
            return reply({'code': 'INVALID_FLOW'}, 400)
        payload = row.encrypted_payload
        row.consumed_at = timezone.now()
        row.encrypted_payload = ''
        row.save(update_fields=['consumed_at', 'encrypted_payload'])
    return reply({'flow_id': str(row.pk), 'encrypted_payload': payload})


@boundary
def session_create(request, data):
    exact(data, {'flow_id', 'issuer', 'client_id', 'subject', 'session_hash', 'encrypted_payload', 'mfa_at', 'mfa_type'})
    if data['issuer'] != settings.IDENTITY_ISSUER or data['client_id'] != settings.STAFF_CLIENT_ID:
        return reply({'code': 'WRONG_IDENTITY_CONTEXT'}, 403)
    subject = identifier(data['subject'])
    flow_id = uuid.UUID(data['flow_id'])
    if not isinstance(data['session_hash'], str) or not re.fullmatch(r'[0-9a-f]{64}', data['session_hash']):
        raise ValueError()
    if type(data['mfa_at']) is not int or data['mfa_type'] not in {'totp', 'recovery_codes'}:
        raise ValueError()
    now = timezone.now()
    factor = datetime.fromtimestamp(data['mfa_at'], tz.utc)
    if not now - timedelta(seconds=300) <= factor <= now + timedelta(seconds=5):
        return reply({'code': 'FRESH_MFA_REQUIRED'}, 403)
    payload = opaque(data['encrypted_payload'])
    with transaction.atomic():
        member = StaffMember.objects.select_for_update().filter(product_id=PRODUCT,
            issuer=settings.IDENTITY_ISSUER, client_id=settings.STAFF_CLIENT_ID, subject=subject, active=True).first()
        if member is None:
            audit(None, 'staff.login_denied', None, 'SECURITY_REVIEW', 'DENIED')
            return reply({'code': 'STAFF_NOT_AUTHORIZED'}, 403)
        flow = StaffAuthFlow.objects.select_for_update().filter(pk=flow_id, product_id=PRODUCT).first()
        if not flow or not flow.consumed_at or flow.expires_at <= now:
            return reply({'code': 'INVALID_FLOW'}, 400)
        previous = StaffSession.objects.filter(flow=flow).first()
        if previous:
            if (previous.member_id == member.pk and previous.revision == member.revision
                    and not previous.revoked_at and previous.expires_at > now
                    and hmac.compare_digest(previous.token_hash, data['session_hash'])):
                return reply({'state': 'ALREADY_CREATED'})
            return reply({'code': 'FLOW_ALREADY_USED'}, 409)
        row = StaffSession.objects.create(product_id=PRODUCT, token_hash=data['session_hash'], member=member,
            flow=flow, revision=member.revision, mfa_verified_at=factor, mfa_type=data['mfa_type'],
            encrypted_payload=payload, expires_at=now + timedelta(hours=1))
        audit(member, 'staff.login', row.pk, 'SECURITY_REVIEW', 'APPLIED', after={'session_id': str(row.pk)})
    return reply({'state': 'CREATED'}, 201)


@boundary
def me(request, data):
    exact(data, {'session_token'})
    with transaction.atomic():
        actor = principal(data['session_token'], None)
        if actor is None:
            return reply({'code': 'STAFF_AUTHENTICATION_REQUIRED'}, 401)
        return reply({'staff': {'id': str(actor.pk), 'name': actor.name, 'role': actor.role,
            'product_id': PRODUCT, 'revision': actor.revision,
            'permissions': sorted(OWNER_PERMISSIONS) if actor.role == 'OWNER' else permissions(actor.permissions)}})


@boundary
def logout(request, data):
    exact(data, {'session_token'})
    token = opaque(data['session_token'], 80)
    with transaction.atomic():
        row = StaffSession.objects.select_for_update().filter(product_id=PRODUCT, token_hash=digest(token), revoked_at__isnull=True).first()
        if row:
            row.revoked_at = timezone.now()
            row.encrypted_payload = ''
            row.save(update_fields=['revoked_at', 'encrypted_payload'])
            audit(row.member, 'staff.logout', row.pk, 'SECURITY_REVIEW', 'APPLIED')
    return reply({'state': 'SIGNED_OUT'})


def search_text(value):
    if not isinstance(value, str) or len(value) > 80 or any(ord(c) < 32 for c in value):
        raise ValueError()
    return value.strip()


@boundary
def read(request, data):
    exact(data, {'session_token', 'resource'}, {'query', 'id'})
    resource = data['resource']
    required = {'customers': 'users.read', 'customer': 'users.read', 'leads': 'leads.read',
        'audit': 'audit.read', 'staff': 'staff.manage', 'sessions': 'sessions.revoke'}
    if resource not in required:
        raise ValueError()
    query = search_text(data.get('query', ''))
    with transaction.atomic():
        actor = principal(data['session_token'], required[resource])
        if actor is None:
            return reply({'code': 'FORBIDDEN'}, 403)
        if resource in {'customers', 'customer'}:
            rows = Customer.objects.all()
            if resource == 'customer':
                rows = rows.filter(pk=identifier(data['id']))
            elif query:
                rows = rows.filter(Q(email__icontains=query) | Q(display_name__icontains=query))
            items = [{'id': str(row.pk), 'email': row.email, 'name': row.display_name,
                'active': row.is_active, 'revision': row.security_revision,
                'tenant_id': str(Membership.objects.get(customer=row).tenant_id)}
                for row in rows.order_by('-created_at')[:100]]
        elif resource == 'leads':
            rows = Lead.objects.filter(expires_at__gt=timezone.now())
            if query:
                rows = rows.filter(email__icontains=query)
            items = [{'id': str(row.pk), 'email': row.email, 'confirmed': row.confirmed_at is not None,
                'created_at': row.created_at.isoformat()} for row in rows.order_by('-created_at')[:100]]
        elif resource == 'staff':
            items = [{'id': str(row.pk), 'name': row.name, 'subject': row.subject, 'role': row.role,
                'permissions': row.permissions, 'active': row.active, 'revision': row.revision}
                for row in StaffMember.objects.filter(product_id=PRODUCT).order_by('created_at')[:100]]
        elif resource == 'sessions':
            items = [{'id': str(row.pk), 'staff_id': str(row.member_id), 'expires_at': row.expires_at.isoformat(),
                'revoked': row.revoked_at is not None}
                for row in StaffSession.objects.filter(product_id=PRODUCT).order_by('-created_at')[:100]]
        else:
            items = [{'id': str(row.pk), 'action': row.action, 'actor_id': str(row.actor_id) if row.actor_id else None,
                'target_id': str(row.target_id) if row.target_id else None, 'reason': row.reason, 'outcome': row.outcome,
                'before': row.before, 'after': row.after, 'created_at': row.created_at.isoformat()}
                for row in StaffAuditEvent.objects.filter(product_id=PRODUCT).order_by('-created_at')[:100]]
        audit(actor, 'staff.read', None, 'STAFF_READ', 'APPLIED', after={'count': len(items)})
        return reply({'items': items, 'limit': 100})


@boundary
def command(request, data):
    exact(data, {'session_token', 'command_id', 'action', 'payload', 'reason'})
    command_id = uuid.UUID(identifier(data['command_id']))
    why = reason(data['reason'])
    action, payload = data['action'], data['payload']
    required = {'customer.block': 'users.block', 'customer.unblock': 'users.unblock',
        'staff.assign': 'staff.manage', 'staff.revoke': 'staff.manage', 'session.revoke': 'sessions.revoke'}
    if action not in required or not isinstance(payload, dict):
        raise ValueError()
    expected_fields = {'customer.block': {'customer_id', 'revision'}, 'customer.unblock': {'customer_id', 'revision'},
        'staff.assign': {'subject', 'name', 'permissions'}, 'staff.revoke': {'staff_id', 'revision'}, 'session.revoke': {'session_id'}}
    exact(payload, expected_fields[action])
    with transaction.atomic():
        # Same global role-mutation lock/order as assign/revoke services. This
        # also serializes repeated UUID commands before reading their receipt.
        owner_lock()
        actor = principal(data['session_token'], required[action])
        if actor is None:
            return reply({'code': 'FORBIDDEN'}, 403)
        mark = digest(json.dumps({'actor': str(actor.pk), 'action': action, 'payload': payload,
            'reason': why, 'product': PRODUCT}, sort_keys=True, separators=(',', ':')))
        previous = StaffCommandReceipt.objects.filter(pk=command_id, product_id=PRODUCT).first()
        if previous:
            if previous.actor_id != actor.pk or previous.fingerprint != mark:
                return reply({'code': 'IDEMPOTENCY_CONFLICT'}, 409)
            return reply(previous.result, previous.http_status)
        token = data['session_token']
        if action.startswith('customer.'):
            result, status = block_customer(token, payload['customer_id'], action == 'customer.unblock', payload['revision'], why)
        elif action == 'staff.assign':
            result, status = assign_admin(token, payload['subject'], payload['name'], payload['permissions'], why)
        elif action == 'staff.revoke':
            result, status = revoke_staff(token, payload['staff_id'], payload['revision'], why)
        else:
            target = StaffSession.objects.select_for_update().filter(product_id=PRODUCT, pk=identifier(payload['session_id'])).first()
            if target:
                target.revoked_at = timezone.now()
                target.encrypted_payload = ''
                target.save(update_fields=['revoked_at', 'encrypted_payload'])
                audit(actor, 'staff.session_revoked', target.pk, why, 'APPLIED')
            result, status = {'state': 'APPLIED' if target else 'NOT_FOUND'}, 200 if target else 404
        StaffCommandReceipt.objects.create(id=command_id, product_id=PRODUCT, actor_id=actor.pk,
            fingerprint=mark, result=result, http_status=status)
        return reply(result, status)
