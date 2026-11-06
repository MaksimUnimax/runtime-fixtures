"""Tenant-owned stores; external validation happens outside every DB transaction."""
import json
from datetime import timedelta
from django.core import signing
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from alisa_platform.accounts.models import Customer, Tenant
from alisa_platform.accounts.views import session
from alisa_platform.runtime_adapter.store_check import check_store
from .models import PRODUCT, Store, VaultSecret, CredentialRevision, StoreCommand, StoreAudit
from .policy import identifier, label, validate
from . import vault


class Rejected(Exception):
    def __init__(self, code, status=409):
        self.code, self.status = code, status


def principal(token):
    row = session({'session_token': token})
    if not row:
        raise Rejected('AUTHENTICATION_REQUIRED', 401)
    Customer.objects.select_for_update().get(pk=row.customer_id)
    row = session({'session_token': token})
    if not row:
        raise Rejected('AUTHENTICATION_REQUIRED', 401)
    Tenant.objects.select_for_update().get(pk=row.tenant_id)
    return row


def owned(actor, store_id, deleted=False):
    query = Store.objects.select_for_update().filter(product_id=PRODUCT, tenant_id=actor.tenant_id, pk=store_id)
    if not deleted:
        query = query.exclude(status='DELETED')
    row = query.first()
    if not row:
        raise Rejected('NOT_FOUND', 404)
    return row


def projection(store):
    credentials = CredentialRevision.objects.filter(product_id=PRODUCT, tenant_id=store.tenant_id,
        store=store, status__in=['ACTIVE', 'PENDING']).order_by('kind', '-revision')
    return {'id': str(store.pk), 'provider': store.provider, 'name': store.name,
        'voice_alias': store.voice_alias, 'revision': store.revision, 'status': store.status,
        'identity_verified': store.verified_identity is not None,
        'credentials': [{'id': str(r.pk), 'kind': r.kind, 'revision': r.revision,
            'status': r.status, 'check_code': r.check_code,
            'checked_at': r.checked_at.isoformat() if r.checked_at else None} for r in credentials]}


def listing(actor, cursor=''):
    rows = Store.objects.filter(product_id=PRODUCT, tenant_id=actor.tenant_id).exclude(status='DELETED').order_by('pk')
    if cursor:
        try:
            pin = signing.loads(cursor, salt='alisa-store-list-v1', max_age=3600)
            if not isinstance(pin, list) or len(pin) != 2 or pin[0] != str(actor.tenant_id):
                raise ValueError()
            rows = rows.filter(pk__gt=identifier(pin[1]))
        except (signing.BadSignature, ValueError, TypeError):
            raise Rejected('INVALID_CURSOR', 422) from None
    result = list(rows[:51])
    return {'items': [projection(r) for r in result[:50]],
        'next_cursor': signing.dumps([str(actor.tenant_id), str(result[49].pk)], salt='alisa-store-list-v1') if len(result) > 50 else None}


def retire(rows):
    ids = list(rows.values_list('secret_id', flat=True))
    VaultSecret.objects.filter(pk__in=ids).update(ciphertext='')
    rows.update(status='REVOKED')


def pending(store, kind, credential):
    if kind not in ({'SELLER', 'PERFORMANCE'} if store.provider == 'OZON' else {'WB'}):
        raise Rejected('CREDENTIAL_KIND_MISMATCH', 422)
    rows = CredentialRevision.objects.filter(store=store, tenant_id=store.tenant_id, kind=kind)
    previous = rows.order_by('-revision').first()
    revision = previous.revision+1 if previous else 1
    retire(rows.filter(status='PENDING'))
    ciphertext, key_version = vault.seal(store, kind, revision, credential)
    secret = VaultSecret.objects.create(tenant_id=store.tenant_id, store=store, kind=kind,
        revision=revision, ciphertext=ciphertext, key_version=key_version)
    return CredentialRevision.objects.create(tenant_id=store.tenant_id, store=store, kind=kind,
        revision=revision, secret=secret)


def audit(actor, store, action, code):
    StoreAudit.objects.create(tenant_id=actor.tenant_id, customer_id=actor.customer_id,
        store=store, action=action, outcome=code, revision=store.revision)


def result(command, value, status=200):
    command.result, command.http_status, command.state = value, status, 'DONE'
    command.save(update_fields=['result', 'http_status', 'state'])
    return value, status


def request_fingerprint(actor, data):
    envelope = {'environment': settings.ALISA_ENV, 'product_id': PRODUCT,
        'tenant_id': str(actor.tenant_id), 'customer_id': str(actor.customer_id), 'command': data}
    return salted_hmac('alisa.store.command.v1', json.dumps(envelope, sort_keys=True,
        separators=(',', ':')), algorithm='sha256').hexdigest()


def execute(token, data):
    validate(data)
    checking = None
    with transaction.atomic():
        actor = principal(token)
        if data['action'] == 'list':
            return listing(actor, data.get('cursor', '')), 200
        fingerprint = request_fingerprint(actor, data)
        previous = StoreCommand.objects.filter(product_id=PRODUCT, tenant_id=actor.tenant_id,
            customer_id=actor.customer_id, request_id=identifier(data['command_id'])).first()
        if previous:
            if previous.fingerprint != fingerprint:
                raise Rejected('IDEMPOTENCY_CONFLICT')
            return previous.result, previous.http_status
        from alisa_platform.leads.views import allow
        if not allow('store-command:'+str(actor.tenant_id), 60, 60):
            raise Rejected('RATE_LIMITED', 429)
        action = data['action']
        if action == 'create':
            store = Store.objects.create(tenant_id=actor.tenant_id, provider=data['provider'],
                name=label(data['name']), voice_alias=label(data['voice_alias'], True))
            pending(store, 'SELLER' if store.provider == 'OZON' else 'WB', data['credential'])
        else:
            store = owned(actor, identifier(data['store_id']))
            if store.revision != data['expected_revision']:
                raise Rejected('REVISION_CONFLICT')
        command = StoreCommand.objects.create(request_id=identifier(data['command_id']), tenant_id=actor.tenant_id,
            customer_id=actor.customer_id, fingerprint=fingerprint, action=action, store=store,
            security_revision=actor.customer.security_revision)
        if action == 'check':
            if store.status != 'ACTIVE':
                raise Rejected('STORE_DISABLED')
            candidate = CredentialRevision.objects.filter(pk=identifier(data['credential_id']), product_id=PRODUCT,
                tenant_id=actor.tenant_id, store=store, status__in=['PENDING', 'ACTIVE']).first()
            if not candidate:
                raise Rejected('NOT_FOUND', 404)
            now = timezone.now()
            running = StoreCommand.objects.filter(store=store, state='RUNNING')
            if running.filter(deadline__gt=now).exists():
                raise Rejected('CHECK_IN_PROGRESS')
            for expired in running:
                result(expired, {'code': 'UNKNOWN_OUTCOME', 'store_id': str(store.pk)}, 409)
            secret = VaultSecret.objects.get(pk=candidate.secret_id, tenant_id=store.tenant_id, store=store)
            material = vault.open_secret(store, candidate, secret)
            command.state = 'RUNNING'; command.store_revision = store.revision
            command.credential = candidate; command.deadline = now+timedelta(seconds=15)
            command.result = {'state': 'CHECKING', 'store_id': str(store.pk)}; command.http_status = 202
            command.save()
            audit(actor, store, 'check_started', 'CHECKING')
            pins = {'environment': settings.ALISA_ENV, 'product_id': PRODUCT, 'tenant_id': str(store.tenant_id), 'store_id': str(store.pk),
                'provider': store.provider, 'kind': candidate.kind, 'credential_revision': candidate.revision,
                'store_revision': store.revision, 'request_id': str(command.pk)}
            checking = (command.pk, pins, material)
        elif action == 'rename':
            store.name = label(data['name']); store.voice_alias = label(data['voice_alias'], True)
        elif action == 'credential':
            if store.status != 'ACTIVE':
                raise Rejected('STORE_DISABLED')
            pending(store, data['kind'], data['credential'])
        elif action == 'revoke_credential':
            retire(CredentialRevision.objects.filter(store=store, tenant_id=store.tenant_id,
                kind=data['kind'], status__in=['ACTIVE', 'PENDING']))
        elif action in {'disable', 'delete'}:
            store.status = 'DISABLED' if action == 'disable' else 'DELETED'
            retire(CredentialRevision.objects.filter(store=store, tenant_id=store.tenant_id, status__in=['ACTIVE', 'PENDING']))
            # Deleted identity reservations are released only after secrets are revoked.
            if action == 'delete':
                store.verified_identity = None
        elif action == 'enable':
            store.status = 'ACTIVE'
        if checking is None:
            if action != 'create':
                store.revision += 1
                store.save()
            audit(actor, store, action, 'SAVED')
            return result(command, {'store': projection(store)}, 201 if action == 'create' else 200)
    # The persisted claim precedes IPC; no network while a customer/tenant lock is held.
    command_id, pins, material = checking
    try:
        checked = check_store(pins, material)
    finally:
        del material
        del checking
    return finish(token, command_id, checked)


def finish(token, command_id, checked):
    with transaction.atomic():
        actor = principal(token)
        command = StoreCommand.objects.select_for_update().get(pk=command_id, tenant_id=actor.tenant_id, customer_id=actor.customer_id)
        store = owned(actor, command.store_id, deleted=True)
        if command.state != 'RUNNING':
            return command.result, command.http_status
        candidate = CredentialRevision.objects.select_for_update().get(pk=command.credential_id, store=store, tenant_id=store.tenant_id)
        now = timezone.now()
        if (store.status != 'ACTIVE' or store.revision != command.store_revision
                or actor.customer.security_revision != command.security_revision
                or candidate.status not in {'ACTIVE', 'PENDING'}):
            return result(command, {'code': 'REVISION_CONFLICT'}, 409)
        code = checked['code'] if command.deadline > now else 'UNKNOWN_OUTCOME'
        if code == 'CONNECTED':
            identity = checked['identity']
            # Performance must independently prove the same provider account.
            if (candidate.kind == 'PERFORMANCE' and store.verified_identity is None
                    or store.verified_identity is not None and store.verified_identity != identity):
                code = 'ACCOUNT_MISMATCH'
            elif Store.objects.filter(product_id=PRODUCT, tenant_id=store.tenant_id,
                    provider=store.provider, verified_identity=identity).exclude(pk=store.pk).exists():
                code = 'ALREADY_CONNECTED'
            else:
                retire(CredentialRevision.objects.filter(store=store, tenant_id=store.tenant_id,
                    kind=candidate.kind, status='ACTIVE').exclude(pk=candidate.pk))
                store.verified_identity = identity
                candidate.status = 'ACTIVE'
        candidate.check_code = code; candidate.checked_at = now; candidate.save(update_fields=['status', 'check_code', 'checked_at'])
        store.revision += 1; store.save(update_fields=['verified_identity', 'revision'])
        audit(actor, store, 'check', code)
        return result(command, {'store': projection(store), 'check_code': code})
