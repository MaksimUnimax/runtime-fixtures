"""Receipt metadata only. IPC happens outside DB locks, never on a worker queue.

An ambiguous submit is retained under the original ID. Only an explicit recovery
with the identical question may repeat that ID; ordinary status/list never submit.
"""
from datetime import timedelta
import hashlib
import re
import uuid
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from alisa_platform.accounts.models import Membership
from alisa_platform.runtime_adapter.authority_rpc import configured_authority
from alisa_platform.runtime_adapter.client import configured_client
from alisa_platform.runtime_adapter.job_client import RuntimeFailure, encode, identifier, need, text, timestamp
from .models import Query


def enabled():
    need(getattr(settings, 'QUERIES_ENABLED', False) is True, 'CAPABILITY_UNAVAILABLE')


def actor(principal):
    customer, tenant, _, _ = principal.current()
    need(Membership.objects.filter(customer_id=customer, tenant_id=tenant, role='OWNER_CLIENT').exists(),
         'PERMISSION_DENIED')
    return customer, tenant


def receipt(row):
    return {'id': str(row.pk), 'state': row.state, 'store_ids': row.store_ids,
            'created_at': row.created_at.isoformat(), 'expires_at': row.expires_at.isoformat(),
            'checked_at': row.checked_at.isoformat() if row.checked_at else None,
            'submission_confirmed': row.runtime_job_ref is not None}


def owned(principal, query_id, *, lock=False):
    customer, tenant = actor(principal)
    identifier(query_id)
    rows = Query.objects.select_for_update() if lock else Query.objects
    row = rows.filter(pk=query_id, customer_id=customer, tenant_id=tenant).first()
    need(row is not None, 'NOT_FOUND')
    need(row.expires_at > timezone.now(), 'RESULT_EXPIRED')
    return row


def client(principal, stores):
    from alisa_platform.runtime_adapter.authority import PlatformAuthorizer
    return configured_client(PlatformAuthorizer(configured_authority(), principal, stores))


class DeliveryGuard:
    """Request-local proof only; never returned by the BFF or stored in a row."""
    def __init__(self, principal, authorizer, context, query, result_expires_at):
        self.principal, self.authorizer, self.context = principal, authorizer, context
        self.query_id, self.expires_at = str(query.pk), query.expires_at
        self.result_expires_at = timestamp(result_expires_at)

    def check(self):
        # Called under the voice delivery transaction, after OAuth/privacy work.
        # Locks acquired by authority.state stay held until text is formed.
        row = owned(self.principal, self.query_id, lock=True)
        need(self.authorizer.current(self.context, 'read_result') is True, 'PERMISSION_DENIED')
        now = timezone.now()
        need(row.expires_at > now and self.expires_at > now and self.result_expires_at > now.timestamp(),
             'RESULT_EXPIRED')

    def __repr__(self):
        return '<DeliveryGuard>'


def list_queries(principal):
    enabled(); customer, tenant = actor(principal)
    rows = Query.objects.filter(customer_id=customer, tenant_id=tenant,
                                expires_at__gt=timezone.now()).order_by('-created_at')[:50]
    result = [receipt(row) for row in rows]
    need(actor(principal) == (customer, tenant), 'AUTH_REQUIRED')
    return {'items': result}


def submit(principal, query_id, stores, utterance, *, recover=False, channel='WEB', voice_session_hash='',
           store_snapshot=None):
    enabled(); identifier(query_id); text(utterance, 1200); need(utterance.strip())
    need(type(recover) is bool and channel in {'WEB', 'ALICE'})
    need(type(stores) is list and 1 <= len(stores) <= 1000)
    stores = sorted(identifier(s) for s in stores); need(len(set(stores)) == len(stores))
    customer, tenant = actor(principal)
    api = client(principal, stores)
    if store_snapshot is not None:
        from .voice_dialogue import PinnedAuthorizer
        need(channel == 'ALICE' and type(store_snapshot) is list and
             sorted(row['id'] for row in store_snapshot) == stores)
        api.authorizer = PinnedAuthorizer(api.authorizer, customer, tenant, store_snapshot,
                                          voice_session_hash, query_id)
    # Validate access/mapping before persisting a receipt, without holding our row lock.
    api.authorizer.prepare('submit')
    mark = hashlib.sha256(encode({'stores': stores, 'utterance': utterance})).hexdigest()
    now = timezone.now(); attempt = uuid.uuid4()
    continuation = {}
    if store_snapshot is not None:
        from .voice_dialogue import auth_binding
        continuation = {'store_snapshot': store_snapshot, 'voice_auth': auth_binding(principal)}
    with transaction.atomic():
        row, created = Query.objects.get_or_create(pk=query_id, defaults={
            'customer_id': customer, 'tenant_id': tenant, 'store_ids': stores,
            'input_hash': mark, 'channel': channel, 'voice_session_hash': voice_session_hash,
            'created_at': now, 'expires_at': now + timedelta(days=1), 'continuation': continuation})
        row = owned(principal, query_id, lock=True)
        need(row.input_hash == mark, 'IDEMPOTENCY_CONFLICT')
        if row.runtime_job_ref or (not created and not recover) or (row.lease_until and row.lease_until > now):
            return {'query': receipt(row)}, 200 if row.runtime_job_ref else 202
        row.attempt = attempt; row.lease_until = now + timedelta(seconds=30)
        row.save(update_fields=['attempt', 'lease_until'])
        trace_id = str(row.trace_id)
    try:
        accepted = api.submit(utterance, request_id=query_id, logical_query_id=query_id, trace_id=trace_id)
    except RuntimeFailure as error:
        # No result, question, tokens or raw provider errors are journalled here.
        with transaction.atomic():
            row = Query.objects.select_for_update().get(pk=query_id)
            if row.attempt == attempt:
                row.state = 'UNKNOWN'; row.attempt = None; row.lease_until = None
                row.save(update_fields=['state', 'attempt', 'lease_until'])
        if error.outcome == 'UNKNOWN':
            owned(principal, query_id)
            return {'query': receipt(row), 'code': 'UNKNOWN_OUTCOME'}, 202
        raise
    with transaction.atomic():
        row = owned(principal, query_id, lock=True)
        if row.attempt == attempt:
            row.runtime_job_ref = accepted['job_ref']; row.state = 'QUEUED'
            row.attempt = None; row.lease_until = None; row.checked_at = timezone.now()
            row.save(update_fields=['runtime_job_ref', 'state', 'attempt', 'lease_until', 'checked_at'])
    return {'query': receipt(row)}, 201


def read(principal, query_id, *, result=False, with_delivery_guard=False,record_useful=True):
    need(not with_delivery_guard or result)
    enabled(); row = owned(principal, query_id)
    if row.runtime_job_ref is None:
        return {'query': receipt(row), 'code': 'UNKNOWN_OUTCOME'}
    api = client(principal, row.store_ids)
    operation = 'read_result' if result else 'status'
    context = api.authorizer.prepare(operation)
    value = api.read_result(str(row.runtime_job_ref)) if result else api.status(str(row.runtime_job_ref))
    # Runtime has already rechecked live rights and TTL; recheck the web/OAuth principal too.
    current = owned(principal, query_id)
    if result:
        need(timestamp(value['result_expires_at']) > timezone.now().timestamp(), 'RESULT_EXPIRED')
        if record_useful and value.get('result_kind', 'DATA') == 'DATA':
            from alisa_platform.leads.views import event
            event('query.first_useful_ready', subject=current.customer_id)
    # A read may confirm an answer whose acceptance response was lost. It never
    # resends that answer. Keep a newer in-flight mutation's receipt untouched.
    with transaction.atomic():
        current = owned(principal, query_id, lock=True)
        if not current.lease_until or current.lease_until <= timezone.now():
            continuation = current.continuation
            revision = value.get('clarification', {}).get('revision') if result else None
            if continuation.get('outcome') in {'SENDING', 'UNKNOWN'} and (
                    value['state'] != 'NEEDS_INPUT' or revision and revision != continuation.get('expected_revision')):
                continuation['outcome'] = 'CONFIRMED'
            current.state = value['state']; current.checked_at = timezone.now()
            current.save(update_fields=['state', 'checked_at', 'continuation'])
    current.state = value['state']; current.checked_at = timezone.now()
    need(api.authorizer.current(context, operation) is True, 'PERMISSION_DENIED')
    need(current.expires_at > timezone.now(), 'RESULT_EXPIRED')
    if result:
        need(timestamp(value['result_expires_at']) > timezone.now().timestamp(), 'RESULT_EXPIRED')
    answer = {'query': receipt(current), 'result' if result else 'status': value}
    if with_delivery_guard:
        answer['delivery_guard'] = DeliveryGuard(principal, api.authorizer, context, current, value['result_expires_at'])
    return answer


def clarify(principal, query_id, request_id, expected_revision, answer, *, recover=False,
            voice_session_hash='', store_snapshot=None):
    """One explicit continuation, retaining its ID/hash across UNKNOWN transport."""
    enabled(); identifier(query_id); identifier(request_id); text(answer, 1200)
    need(answer.strip() and type(recover) is bool)
    need(type(expected_revision) is str and re.fullmatch(r'[a-f0-9]{64}', expected_revision))
    current = owned(principal, query_id)
    need(current.runtime_job_ref is not None, 'UNKNOWN_OUTCOME')
    api = client(principal, current.store_ids)
    if store_snapshot is not None:
        from .voice_dialogue import PinnedAuthorizer
        need(current.channel == 'ALICE' and current.voice_session_hash == voice_session_hash
             and sorted(row['id'] for row in store_snapshot) == current.store_ids)
        api.authorizer = PinnedAuthorizer(api.authorizer, str(current.customer_id), str(current.tenant_id),
                                          store_snapshot, voice_session_hash, query_id)
    api.authorizer.prepare('submit')
    mark = hashlib.sha256(encode({'revision': expected_revision, 'answer': answer})).hexdigest()
    now = timezone.now(); attempt = uuid.uuid4()
    with transaction.atomic():
        row = owned(principal, query_id, lock=True)
        previous = row.continuation
        same = previous.get('request_id') == request_id
        if same:
            need(previous.get('input_hash') == mark, 'IDEMPOTENCY_CONFLICT')
            if previous.get('outcome') == 'CONFIRMED':
                return {'query': receipt(row)}, 200
            if not recover or row.lease_until and row.lease_until > now:
                return {'query': receipt(row), 'code': 'UNKNOWN_OUTCOME'}, 202
        else:
            need(previous.get('outcome') not in {'SENDING', 'UNKNOWN'}, 'UNKNOWN_OUTCOME')
            need(not row.lease_until or row.lease_until <= now, 'UNKNOWN_OUTCOME')
        row.continuation = {**{k: previous[k] for k in ('store_snapshot', 'voice_auth') if k in previous},
                            'request_id': request_id, 'input_hash': mark,
                            'expected_revision': expected_revision, 'outcome': 'SENDING'}
        row.attempt = attempt; row.lease_until = now + timedelta(seconds=30)
        row.save(update_fields=['continuation', 'attempt', 'lease_until'])
        job_ref, trace_id = str(row.runtime_job_ref), str(row.trace_id)
    try:
        accepted = api.clarify(answer, job_ref=job_ref, expected_revision=expected_revision,
                               request_id=request_id, logical_query_id=query_id, trace_id=trace_id)
        if accepted['job_ref'] != job_ref:
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE', outcome='UNKNOWN')
    except RuntimeFailure as error:
        with transaction.atomic():
            row = owned(principal, query_id, lock=True)
            if row.attempt == attempt:
                row.continuation['outcome'] = 'UNKNOWN' if error.outcome == 'UNKNOWN' else 'REJECTED'
                row.attempt = None; row.lease_until = None
                row.save(update_fields=['continuation', 'attempt', 'lease_until'])
        if error.outcome == 'UNKNOWN':
            return {'query': receipt(row), 'code': 'UNKNOWN_OUTCOME'}, 202
        raise
    with transaction.atomic():
        row = owned(principal, query_id, lock=True)
        if row.attempt == attempt:
            row.continuation['outcome'] = 'CONFIRMED'
            row.state = 'QUEUED'; row.attempt = None; row.lease_until = None
            row.checked_at = timezone.now()
            row.save(update_fields=['continuation', 'state', 'attempt', 'lease_until', 'checked_at'])
    return {'query': receipt(row)}, 201


def cancel(principal, query_id, request_id):
    enabled(); identifier(request_id); row = owned(principal, query_id)
    if row.runtime_job_ref is None:
        return {'query': receipt(row), 'code': 'UNKNOWN_OUTCOME'}
    value = client(principal, row.store_ids).cancel(str(row.runtime_job_ref), request_id=request_id)
    current = owned(principal, query_id)
    Query.objects.filter(pk=row.pk).update(state=value['state'], checked_at=timezone.now())
    current.state = value['state']; current.checked_at = timezone.now()
    return {'query': receipt(current), 'status': value}
