from django.conf import settings
from django.db import transaction
from alisa_platform.accounts.views import boundary as customer_boundary, session, exact
from alisa_platform.foundation.views import reply
from alisa_platform.staff.views import boundary as staff_boundary
from alisa_platform.staff.service import audit
from .models import PRODUCT, AccessBatch, AccessNotification
from . import service


@staff_boundary
def staff(request, data):
    if not settings.ENTITLEMENTS_ENABLED:
        return reply({'code': 'NOT_FOUND'}, 404)
    try:
        # Denials stay audited even when a later operation rolls back.
        with transaction.atomic():
            try:
                actor = service.actor_locked(data.get('session_token'))
            except service.Rejected:
                return reply({'code': 'FORBIDDEN'}, 403)
        action = data.get('action')
        base = {'session_token', 'action'}
        if action == 'preview':
            exact(data, base | {'gift'})
            return reply(service.preview_gift(data['session_token'], data['gift']), 201)
        if action == 'execute':
            exact(data, base | {'command_id', 'batch_id', 'preview_id', 'limit'})
            return reply(service.execute(data['session_token'], data['command_id'], data['batch_id'], data['preview_id'], data['limit']))
        if action == 'revoke_preview':
            exact(data, base | {'customer_id', 'grant_id', 'notify'})
            return reply(service.preview_revoke(data['session_token'], data['customer_id'], data['grant_id'], data['notify']), 201)
        if action == 'revoke':
            exact(data, base | {'command_id', 'preview_id'})
            return reply(service.revoke(data['session_token'], data['command_id'], data['preview_id']))
        if action == 'batch':
            exact(data, base | {'batch_id'})
            return reply(service.batch_read(data['session_token'], data['batch_id']))
        if action in {'customer', 'batches'}:
            exact(data, base | ({'customer_id'} if action == 'customer' else set()))
            with transaction.atomic():
                actor = service.actor_locked(data['session_token'])
                if action == 'batches':
                    rows = AccessBatch.objects.filter(product_id=PRODUCT, preview__kind='GIFT')
                    if actor.role != 'OWNER':
                        rows = rows.filter(actor_id=actor.pk)
                    return reply({'items': [{'batch_id': str(r.pk), 'created_at': r.created_at.isoformat(),
                        'preview_id': str(r.preview_id)} for r in rows.order_by('-created_at')[:50]], 'limits': service.limits(actor)})
                from alisa_platform.accounts.models import Membership
                from alisa_platform.staff.policy import identifier
                member = Membership.objects.filter(customer_id=identifier(data['customer_id']), role='OWNER_CLIENT').first()
                if not member:
                    raise service.Rejected('NOT_FOUND', 404)
                return reply({'access': service.snapshot(member.tenant_id), 'limits': service.limits(actor)})
        raise ValueError('Unknown access action')
    except service.Rejected as error:
        # A safe immutable record includes rejected replay/conflict attempts.
        with transaction.atomic():
            from alisa_platform.staff.policy import identifier
            target = None
            try:
                target = identifier(data.get('command_id') or data.get('preview_id'))
            except (ValueError, TypeError, AttributeError):
                pass
            audit(actor, 'access.rejected', target, 'SECURITY_REVIEW', 'DENIED')
        return reply({'code': error.code}, error.status)


@customer_boundary
def access(request, data):
    exact(data, {'session_token'})
    if not settings.ENTITLEMENTS_ENABLED:
        return reply({'code': 'NOT_FOUND'}, 404)
    with transaction.atomic():
        row = session(data)
        if not row:
            return reply({'code': 'AUTHENTICATION_REQUIRED'}, 401)
        result = service.snapshot(row.tenant_id)
        notes = AccessNotification.objects.filter(product_id=PRODUCT, customer_id=row.customer_id).order_by('-created_at')[:50]
        result['notifications'] = [{'id': str(n.pk), 'kind': n.kind, 'grant_id': str(n.grant_id),
                                   'created_at': n.created_at.isoformat()} for n in notes]
        return reply({'access': result})
