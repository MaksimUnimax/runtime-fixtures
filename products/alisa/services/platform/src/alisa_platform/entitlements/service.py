"""Finite product access operations. No external calls inside transactions."""
import hashlib
import json
import uuid
from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from alisa_platform.accounts.models import Customer, Membership
from alisa_platform.staff.service import owner_lock, principal, audit
from alisa_platform.staff.policy import identifier
from .models import (PRODUCT, AccessLedger, AccessPreview, AccessBatch, AccessBatchItem, AccessCommand,
                     AccessGrant, AccessAdjustment, AccessNotification)
from .policy import gift_input, append_interval, access_state, parse_time, SOURCES


class Rejected(Exception):
    def __init__(self, code, status=409):
        self.code, self.status = code, status


def actor_locked(token):
    owner_lock()
    actor = principal(token, 'access.grant')
    if not actor:
        raise Rejected('FORBIDDEN', 403)
    if actor.role != 'OWNER' and 'users.read' not in actor.permissions:
        audit(actor, 'access.denied', None, 'SECURITY_REVIEW', 'DENIED')
        raise Rejected('FORBIDDEN', 403)
    return actor


def limits(actor):
    return settings.ACCESS_LIMITS['OWNER' if actor.role == 'OWNER' else 'ADMIN']


def ledger_locked(tenant_id):
    # All staff writes already hold owner_lock, including lazy ledger creation.
    row, _ = AccessLedger.objects.get_or_create(product_id=PRODUCT, tenant_id=tenant_id)
    return AccessLedger.objects.select_for_update().get(pk=row.pk, product_id=PRODUCT)


def grants_for(tenant_id):
    return list(AccessGrant.objects.filter(product_id=PRODUCT, tenant_id=tenant_id)
                .prefetch_related('adjustments').order_by('starts_at', 'id'))


def effective_end(grant):
    return min([grant.ends_at] + [r.cutoff for r in grant.adjustments.all() if r.product_id == PRODUCT])


@transaction.atomic
def snapshot(tenant_id, now=None):
    now = now or timezone.now()
    ledger = AccessLedger.objects.select_for_update().filter(product_id=PRODUCT, tenant_id=tenant_id).first()
    grants = grants_for(tenant_id)
    intervals = [(g.starts_at, effective_end(g)) for g in grants]
    state, until = access_state(now, intervals)
    if state == 'NOT_PROVISIONED' and grants:
        state = 'REVOKED'
    history = []
    for grant in grants:
        end = effective_end(grant)
        status = ('REVOKED' if end <= grant.starts_at else 'EXPIRED' if end <= now
                  else 'SCHEDULED' if grant.starts_at > now else 'ACTIVE')
        history.append({'id': str(grant.pk), 'source': grant.source, 'reason': grant.reason,
            'comment': grant.comment, 'days': grant.days, 'starts_at': grant.starts_at.isoformat(),
            'ends_at': grant.ends_at.isoformat(), 'effective_ends_at': end.isoformat(),
            'adjusted': end != grant.ends_at, 'status': status,
            'revocable': grant.source in SOURCES and end > max(now, grant.starts_at)})
    return {'product_id': PRODUCT, 'status': state, 'active_until': until.isoformat() if until else None,
            'revision': ledger.revision if ledger else 1, 'history': history,
            'server_time': now.isoformat()}


@transaction.atomic
def preview_gift(token, value):
    actor = actor_locked(token)
    spec = gift_input(value, limits(actor))
    now = timezone.now()
    items = []
    for customer_id in spec['customer_ids']:
        member = Membership.objects.select_related('customer').filter(customer_id=customer_id).first()
        if not member or not member.customer.is_active or member.role != 'OWNER_CLIENT':
            raise Rejected('CUSTOMER_UNAVAILABLE', 422)
        ledger = ledger_locked(member.tenant_id)
        intervals = [(g.starts_at, effective_end(g)) for g in grants_for(member.tenant_id)]
        start, end = append_interval(now, intervals, spec['days'])
        items.append({'customer_id': customer_id, 'tenant_id': str(member.tenant_id),
            'revision': ledger.revision, 'starts_at': start.isoformat(), 'ends_at': end.isoformat(),
            'has_gap': start > now and (access_state(now, intervals)[1] is None or access_state(now, intervals)[1] < start)})
    if len({i['tenant_id'] for i in items}) != len(items):
        raise ValueError('Duplicate tenant')
    preview = AccessPreview.objects.create(product_id=PRODUCT, actor_id=actor.pk, actor_revision=actor.revision, kind='GIFT',
        snapshot={'spec': spec, 'items': items}, created_at=now, expires_at=now + timedelta(minutes=5))
    audit(actor, 'access.preview', preview.pk, spec['reason'], 'APPLIED', after={'count': len(items)})
    return preview_result(preview)


def preview_result(preview):
    return {'preview_id': str(preview.pk), 'kind': preview.kind,
            'expires_at': preview.expires_at.isoformat(), **preview.snapshot}


@transaction.atomic
def preview_revoke(token, customer_id, grant_id, notify):
    actor = actor_locked(token)
    if type(notify) is not bool:
        raise ValueError('Notification choice required')
    member = Membership.objects.filter(customer_id=identifier(customer_id), role='OWNER_CLIENT').first()
    if not member:
        raise Rejected('NOT_FOUND', 404)
    ledger = ledger_locked(member.tenant_id)
    grant = AccessGrant.objects.prefetch_related('adjustments').filter(
        pk=identifier(grant_id), tenant_id=member.tenant_id, product_id=PRODUCT).first()
    now = timezone.now()
    if not grant or grant.source not in SOURCES or effective_end(grant) <= max(now, grant.starts_at):
        raise Rejected('NOT_REVOCABLE')
    cutoff = max(now, grant.starts_at)
    preview = AccessPreview.objects.create(product_id=PRODUCT, actor_id=actor.pk, actor_revision=actor.revision, kind='REVOKE',
        snapshot={'grant_id': str(grant.pk), 'customer_id': str(member.customer_id),
            'tenant_id': str(member.tenant_id), 'revision': ledger.revision,
            'cutoff': cutoff.isoformat(), 'previous_end': effective_end(grant).isoformat(), 'notify': notify},
        created_at=now, expires_at=now + timedelta(minutes=5))
    audit(actor, 'access.revoke_preview', preview.pk, 'ACCESS_REVOCATION', 'APPLIED')
    return preview_result(preview)


def fingerprint(payload):
    return hashlib.sha256(json.dumps({'payload': payload, 'product_id': PRODUCT},
                                     sort_keys=True).encode()).hexdigest()


@transaction.atomic
def prepare_batch(token, batch_id, preview_id):
    actor = actor_locked(token)
    batch_id, preview_id = identifier(batch_id), identifier(preview_id)
    previous = AccessBatch.objects.select_for_update().filter(pk=batch_id).first()
    if previous:
        if previous.product_id != PRODUCT or previous.actor_id != actor.pk or previous.fingerprint != fingerprint(preview_id) or previous.preview.kind != 'GIFT':
            raise Rejected('IDEMPOTENCY_CONFLICT')
        if previous.actor_revision != actor.revision:
            raise Rejected('STAFF_AUTHORITY_CHANGED', 403)
        return previous.pk
    preview = AccessPreview.objects.filter(pk=preview_id, product_id=PRODUCT, actor_id=actor.pk,
                                          actor_revision=actor.revision, kind='GIFT').first()
    if not preview or preview.expires_at <= timezone.now():
        raise Rejected('PREVIEW_EXPIRED')
    if AccessBatch.objects.filter(preview=preview).exists():
        raise Rejected('PREVIEW_ALREADY_USED')
    gift_input(preview.snapshot['spec'], limits(actor))
    batch = AccessBatch.objects.create(id=batch_id, product_id=PRODUCT, actor_id=actor.pk, actor_revision=actor.revision,
        preview=preview, fingerprint=fingerprint(preview_id))
    for item in preview.snapshot['items']:
        AccessBatchItem.objects.create(batch=batch, customer_id=item['customer_id'],
            tenant_id=item['tenant_id'], snapshot=item)
    return batch.pk


@transaction.atomic
def apply_item(token, batch_id, item_id, command_id):
    actor = actor_locked(token)
    batch = AccessBatch.objects.select_for_update(of=('self',)).select_related('preview').get(pk=batch_id, product_id=PRODUCT)
    if batch.actor_id != actor.pk or batch.actor_revision != actor.revision:
        raise Rejected('FORBIDDEN', 403)
    spec = gift_input(batch.preview.snapshot['spec'], limits(actor))
    item = batch.items.select_for_update().get(pk=item_id, reserved_by=command_id)
    if item.state != 'PENDING':
        return
    ledger = ledger_locked(item.tenant_id)
    member = Membership.objects.select_related('customer').filter(customer_id=item.customer_id,
                        tenant_id=item.tenant_id, role='OWNER_CLIENT').first()
    outcome = ('CUSTOMER_UNAVAILABLE' if not member or not member.customer.is_active else
               'REVISION_CONFLICT' if ledger.revision != item.snapshot['revision'] else
               'PREVIEW_INTERVAL_EXPIRED' if parse_time(item.snapshot['ends_at']) <= timezone.now() else None)
    if outcome:
        item.state, item.outcome = 'FAILED', outcome
        item.save(update_fields=['state', 'outcome'])
        audit(actor, 'access.grant_failed', item.pk, spec['reason'], 'DENIED')
        return
    grant = AccessGrant.objects.create(product_id=PRODUCT, tenant_id=item.tenant_id, source=spec['source'],
        source_id=item.pk, days=spec['days'], starts_at=parse_time(item.snapshot['starts_at']),
        ends_at=parse_time(item.snapshot['ends_at']), actor_id=actor.pk, reason=spec['reason'], comment=spec['comment'])
    ledger.revision += 1
    ledger.save(update_fields=['revision'])
    if spec['notify']:
        AccessNotification.objects.create(product_id=PRODUCT, event_id=item.pk,
            customer_id=item.customer_id, grant=grant, kind='GRANTED')
    item.state, item.outcome = 'APPLIED', 'APPLIED'
    item.save(update_fields=['state', 'outcome'])
    audit(actor, 'access.granted', grant.pk, spec['reason'], 'APPLIED',
        after={'grant_id': str(grant.pk), 'tenant_id': str(item.tenant_id), 'days': grant.days, 'source': grant.source})


@transaction.atomic
def prepare_command(token, command_id, batch_id, preview_id, limit):
    actor = actor_locked(token)
    command_id, batch_id, preview_id = map(identifier, [command_id, batch_id, preview_id])
    payload = {'action': 'execute', 'batch_id': batch_id, 'preview_id': preview_id, 'limit': limit}
    previous = AccessCommand.objects.select_for_update().filter(pk=command_id).first()
    if previous:
        if previous.product_id != PRODUCT or previous.actor_id != actor.pk or previous.fingerprint != fingerprint(payload):
            raise Rejected('IDEMPOTENCY_CONFLICT')
        if previous.batch.actor_revision != actor.revision:
            raise Rejected('STAFF_AUTHORITY_CHANGED', 403)
        return previous
    own_batch_id = prepare_batch(token, batch_id, preview_id)
    items = list(AccessBatchItem.objects.select_for_update().filter(batch_id=own_batch_id,
                 state='PENDING', reserved_by__isnull=True).order_by('tenant_id')[:limit])
    command = AccessCommand.objects.create(id=command_id, product_id=PRODUCT, actor_id=actor.pk,
        batch_id=own_batch_id, fingerprint=fingerprint(payload), payload=payload,
        item_ids=[str(i.pk) for i in items])
    for item in items:
        item.reserved_by = command.pk
        item.save(update_fields=['reserved_by'])
    return command


def execute(token, command_id, batch_id, preview_id, limit):
    if type(limit) is not int or not 1 <= limit <= 5:
        raise ValueError('Bounded batch step required')
    command = prepare_command(token, command_id, batch_id, preview_id, limit)
    if command.result is not None:
        return command.result
    for item_id in command.item_ids:
        apply_item(token, command.batch_id, item_id, command.pk)
    with transaction.atomic():
        actor_locked(token)
        command = AccessCommand.objects.select_for_update().get(pk=command.pk, product_id=PRODUCT)
        if command.result is None:
            command.result = batch_read(token, str(command.batch_id))
            command.result['unfinished_commands'] = [item for item in command.result['unfinished_commands'] if item['command_id'] != str(command.pk)]
            command.save(update_fields=['result'])
        return command.result


@transaction.atomic
def batch_read(token, batch_id):
    actor = actor_locked(token)
    row = AccessBatch.objects.filter(pk=identifier(batch_id), product_id=PRODUCT).first()
    if not row or (row.actor_id != actor.pk and actor.role != 'OWNER'):
        raise Rejected('NOT_FOUND', 404)
    from alisa_platform.staff.models import StaffMember
    authority_current = StaffMember.objects.filter(pk=row.actor_id, product_id=PRODUCT, active=True, revision=row.actor_revision).exists()
    items = [{'customer_id': str(i.customer_id), 'customer_name': i.customer.display_name or i.customer.email, 'state': i.state, 'outcome': i.outcome,
              **{k: i.snapshot[k] for k in ['starts_at', 'ends_at']}}
             for i in row.items.select_related('customer').order_by('tenant_id')]
    return {'batch_id': str(row.pk), 'preview_id': str(row.preview_id),
            'state': ('PARTIAL' if authority_current else 'BLOCKED') if any(i['state'] == 'PENDING' for i in items) else 'COMPLETED', 'items': items,
            'can_continue': row.actor_id == actor.pk and row.actor_revision == actor.revision,
            'recoverable_by_owner': actor.role == 'OWNER' and any(i['state'] != 'APPLIED' for i in items),
            'unfinished_commands': [{'command_id': str(c.pk), **c.payload}
                for c in AccessCommand.objects.filter(batch=row, result__isnull=True).order_by('created_at')]}


@transaction.atomic
def revoke(token, command_id, preview_id):
    actor = actor_locked(token)
    command_id, preview_id = identifier(command_id), identifier(preview_id)
    payload = {'action': 'revoke', 'preview_id': preview_id}
    command = AccessCommand.objects.filter(pk=command_id).first()
    if command:
        if command.product_id != PRODUCT or command.actor_id != actor.pk or command.fingerprint != fingerprint(payload):
            raise Rejected('IDEMPOTENCY_CONFLICT')
        return command.result
    preview = AccessPreview.objects.filter(pk=preview_id, product_id=PRODUCT, actor_id=actor.pk,
                                          actor_revision=actor.revision, kind='REVOKE').first()
    if not preview or preview.expires_at <= timezone.now():
        raise Rejected('PREVIEW_EXPIRED')
    if AccessBatch.objects.filter(preview=preview).exists():
        raise Rejected('PREVIEW_ALREADY_USED')
    spec = preview.snapshot
    ledger = ledger_locked(spec['tenant_id'])
    if ledger.revision != spec['revision']:
        raise Rejected('REVISION_CONFLICT')
    grant = AccessGrant.objects.prefetch_related('adjustments').get(pk=spec['grant_id'],
                                      tenant_id=spec['tenant_id'], product_id=PRODUCT)
    if grant.source not in SOURCES or effective_end(grant).isoformat() != spec['previous_end']:
        raise Rejected('NOT_REVOCABLE')
    # Never revoke a slice already used while confirmation was pending.
    cutoff = max(timezone.now(), parse_time(spec['cutoff']), grant.starts_at)
    if cutoff >= effective_end(grant):
        raise Rejected('NOT_REVOCABLE')
    batch = AccessBatch.objects.create(id=uuid.uuid4(), product_id=PRODUCT, actor_id=actor.pk, actor_revision=actor.revision,
        preview=preview, fingerprint=fingerprint(preview_id))
    AccessAdjustment.objects.create(id=command_id, product_id=PRODUCT, grant=grant,
                                    cutoff=cutoff, actor_id=actor.pk, reason='ACCESS_REVOCATION')
    ledger.revision += 1
    ledger.save(update_fields=['revision'])
    if spec['notify']:
        AccessNotification.objects.create(product_id=PRODUCT, event_id=command_id,
            customer_id=spec['customer_id'], grant=grant, kind='REVOKED')
    audit(actor, 'access.revoked', grant.pk, 'ACCESS_REVOCATION', 'APPLIED', after={'grant_id': str(grant.pk)})
    result = {'state': 'APPLIED', 'grant_id': str(grant.pk), 'cutoff': cutoff.isoformat()}
    AccessCommand.objects.create(id=command_id, product_id=PRODUCT, actor_id=actor.pk, batch=batch,
                                 fingerprint=fingerprint(payload), payload=payload, result=result)
    return result
