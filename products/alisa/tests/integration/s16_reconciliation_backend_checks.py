"""AL-S16 adapter against real staff policy/ORM/locks on the existing S03 CI DB.

Native evidence is explicitly synthetic. No live route/producer is qualified.
This script is run by the existing bounded qualify_staff_core lifecycle.
"""
import hashlib
import hmac
import json
import os
import secrets
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict, replace
from datetime import timedelta
from pathlib import Path
from threading import Barrier, Event
from unittest.mock import patch

if not (os.environ.get('ALISA_STAFF_CORE_TEST_ALLOW') == '1' and os.environ.get('ALISA_ENV') == 'dev'
        and os.environ.get('ALISA_DB_NAME') == 'alisa_s03_core_platform'
        and os.environ.get('ALISA_DB_HOST') == '127.0.0.1' and os.environ.get('ALISA_DB_PORT') == '55480'):
    raise RuntimeError('Owned disposable staff platform database required')

import django
django.setup()
from django.conf import settings
from django.db import connection, connections, transaction, DatabaseError
from django.test import Client
from django.utils import timezone
from alisa_platform.accounts.models import Customer, Tenant, Membership
from alisa_platform.queries.models import Query
from alisa_platform.stores.models import Store
from alisa_platform.staff.models import StaffMember, StaffSession, StaffCommandReceipt, StaffAuditEvent
from alisa_platform.staff import policy, service
from alisa_platform.operations import reconciliation as core
from alisa_platform.operations import platform_adapter as adapter

CASES = []
def check(name, ok):
    if not ok:
        raise RuntimeError('CHECK_FAILED:'+name)
    CASES.append({'case': 's16_'+name, 'passed': True})


def api(action, body):
    return Client(HTTP_HOST='localhost').post('/api/v1/staff/'+action, data=json.dumps(body),
        content_type='application/json', HTTP_AUTHORIZATION='Bearer '+settings.STAFF_SERVICE_TOKEN)


def login(member):
    token = secrets.token_urlsafe(32)
    flow = api('auth/flows', {'encrypted_payload': 'synthetic-private-'+secrets.token_urlsafe(48)})
    consumed = api('auth/flows/consume', {'flow_ref': flow.json()['flow_ref']})
    result = api('auth/sessions', {'flow_id': consumed.json()['flow_id'],
        'issuer': settings.IDENTITY_ISSUER, 'client_id': settings.STAFF_CLIENT_ID,
        'subject': member.subject, 'session_hash': hashlib.sha256(token.encode()).hexdigest(),
        'encrypted_payload': 'synthetic-private-'+secrets.token_urlsafe(48),
        'mfa_at': int(timezone.now().timestamp()), 'mfa_type': 'totp'})
    if result.status_code != 201:
        raise RuntimeError('SYNTHETIC_STAFF_LOGIN_FAILED')
    return token


def member(permissions):
    return StaffMember.objects.create(product_id=core.PRODUCT, issuer=settings.IDENTITY_ISSUER,
        client_id=settings.STAFF_CLIENT_ID, subject=str(uuid.uuid4()), name='S16 synthetic staff',
        role='ADMIN', permissions=permissions)


def query():
    customer = Customer.objects.create(email='s16-'+uuid.uuid4().hex+'@example.invalid')
    tenant = Tenant.objects.create()
    Membership.objects.create(customer=customer, tenant=tenant)
    store = Store.objects.create(tenant=tenant, provider='OZON', name='S16 synthetic store')
    now = timezone.now()
    return Query.objects.create(id=uuid.uuid4(), customer=customer, tenant=tenant,
        store_ids=[str(store.pk)], input_hash='1'*64, runtime_job_ref=uuid.uuid4(),
        state='UNKNOWN', attempt=uuid.uuid4(), channel='WEB', created_at=now-timedelta(minutes=1),
        expires_at=now+timedelta(days=1))


class FixtureSource:
    """Synthetic native port, NOT the production primary-proof transport."""
    def __init__(self, row):
        self.op = core.Operation(core.PRODUCT, str(row.pk), str(row.tenant_id), str(row.runtime_job_ref),
            str(uuid.uuid4()), '2'*64, 7, int(timezone.now().timestamp())-60, 'UNKNOWN')
        self.key = secrets.token_bytes(32)
        self.reads = self.resolutions = self.verifications = 0
        self.on_read = None
        self.invalid = None
        self.mode = 'empty'
        self.barrier = None

    def resolve(self, target):
        self.resolutions += 1
        if self.invalid == 'unavailable':
            raise RuntimeError('synthetic missing binding')
        op = self.op
        if self.invalid == 'tenant': op = replace(op, tenant_id=str(uuid.uuid4()))
        if self.invalid == 'job': op = replace(op, runtime_job_ref=str(uuid.uuid4()))
        if self.invalid == 'object': op = replace(op, object_id=str(uuid.uuid4()))
        if self.invalid == 'target': target = replace(target, customer_id=str(uuid.uuid4()))
        if self.invalid == 'dict': return {'target': asdict(target), 'operation': asdict(op)}
        return adapter.Resolution(target, op)

    def read(self, op):
        if connection.in_atomic_block:
            raise RuntimeError('full evidence read under receipt transaction')
        self.reads += 1
        if self.barrier is not None: self.barrier.wait(timeout=5)
        if self.on_read is not None: self.on_read()
        if self.mode == 'empty': return ()
        if self.mode == 'unavailable': raise RuntimeError('synthetic source error with private data')
        value = {'schema': core.PROOF_SCHEMA, 'binding_sha256': op.binding,
            'source': 'RUNTIME_TERMINAL_RECEIPT', 'scope': 'JOB', 'outcome': 'EXECUTED',
            'recorded_at': op.created_at, 'observed_at': int(timezone.now().timestamp()),
            'primary_sha256': '3'*64}
        raw = core.canonical(value)
        signature = hmac.digest(self.key, raw, 'sha256')
        if self.mode == 'tamper': signature = b'x'*32
        return (core.PrimaryProof(raw, signature),)

    def verify(self, proof, op):
        self.verifications += 1
        return hmac.compare_digest(proof.authentication, hmac.digest(self.key, proof.payload, 'sha256'))


def invoke(token, row, source, command=None, reason='Synthetic operator check'):
    request = {'object_id': str(row.pk), 'kind': 'RUNTIME_UNKNOWN', 'reason': reason}
    try:
        return adapter.execute(token, request, command or str(uuid.uuid4()), source=source)
    except core.ReconcileError as error:
        return {'code': error.code}, error.status


def main():
    check('real_postgresql_and_runtime_identity', connection.vendor == 'postgresql'
          and connection.settings_dict['USER'] == 'alisa_s03_core_platform_runtime')
    check('declared_permission_is_explicit_not_reader_fallback',
          policy.permissions([core.PERMISSION]) == [core.PERMISSION])
    operator = member([core.PERMISSION]); token = login(operator)
    reader = member(['users.read']); reader_token = login(reader)
    row = query(); source = FixtureSource(row); command = str(uuid.uuid4())
    before = dict(Query.objects.filter(pk=row.pk).values().get())
    reply, status = invoke(token, row, source, command)
    check('actual_staff_login_receipt_and_no_evidence_unknown', status == 202 and reply['state'] == 'UNKNOWN')
    saved = StaffCommandReceipt.objects.get(pk=command)
    events = StaffAuditEvent.objects.filter(action=adapter.ACTION, target_id=row.pk)
    check('existing_receipt_and_audit_are_inserted_once', saved.actor_id == operator.pk
          and saved.http_status == 202 and events.count() == 1)
    check('job_query_metadata_is_unchanged', dict(Query.objects.filter(pk=row.pk).values().get()) == before)
    reads = source.reads
    again, status = invoke(token, row, source, command)
    check('same_key_reuses_original_receipt_after_real_checks', status == 202 and again == reply
          and source.reads == reads and events.count() == 1)
    check('raw_reason_session_and_operation_details_not_stored',
          'Synthetic operator check' not in json.dumps(saved.result) and token not in json.dumps(saved.result)
          and str(row.runtime_job_ref) not in json.dumps(saved.result))
    reply2, status = invoke(token, row, source, command, reason='Changed reason')
    check('changed_reason_conflicts_without_second_write', status == 409 and events.count() == 1)
    other = member([core.PERMISSION]); other_token = login(other)
    check('another_staff_cannot_reuse_command', invoke(other_token, row, source, command)[1] == 409)
    reader_source = FixtureSource(row)
    check('reader_is_refused_before_target_and_evidence', invoke(reader_token, row, reader_source)[1] == 401
          and reader_source.resolutions == reader_source.reads == 0)
    check('invalid_session_refused_before_target', invoke('z'*43, row, reader_source)[1] == 401
          and reader_source.resolutions == 0)
    session = StaffSession.objects.get(token_hash=hashlib.sha256(token.encode()).hexdigest())
    session.mfa_verified_at = timezone.now()-timedelta(seconds=301); session.save(update_fields=['mfa_verified_at'])
    check('real_stale_mfa_denies_even_cached_receipt', invoke(token, row, source, command)[1] == 401)
    session.mfa_verified_at = timezone.now(); session.save(update_fields=['mfa_verified_at'])
    session.revoked_at = timezone.now(); session.save(update_fields=['revoked_at'])
    check('real_session_revocation_denies_cached_receipt', invoke(token, row, source, command)[1] == 401)
    token = login(operator)

    confirmed_row = query(); confirmed_source = FixtureSource(confirmed_row); confirmed_source.mode = 'confirmed'
    original = dict(Query.objects.filter(pk=confirmed_row.pk).values().get())
    result, status = invoke(token, confirmed_row, confirmed_source)
    check('authenticated_fixture_assessment_is_no_change_not_applied', status == 202 and result['state'] == 'NO_CHANGE'
          and dict(Query.objects.filter(pk=confirmed_row.pk).values().get()) == original)
    for kind in ('tenant', 'job', 'object', 'target', 'dict', 'unavailable'):
        bad_row = query(); bad_source = FixtureSource(bad_row); bad_source.invalid = kind; key = uuid.uuid4()
        result, status = invoke(token, bad_row, bad_source, str(key))
        check('native_binding_'+kind+'_refused', status == 503 and bad_source.reads == 0
              and not StaffCommandReceipt.objects.filter(pk=key).exists())
    unbound = query(); unbound.runtime_job_ref = None; unbound.save(update_fields=['runtime_job_ref'])
    unbound_source = FixtureSource(row)
    result, status = invoke(token, unbound, unbound_source)
    check('legacy_missing_binding_does_not_use_attempt_or_input_hash', status == 503
          and result['code'] == 'OPERATION_BINDING_UNAVAILABLE' and unbound_source.resolutions == 0)
    bad_tenant = query(); mismatch_source = FixtureSource(bad_tenant)
    Membership.objects.filter(customer_id=bad_tenant.customer_id).update(tenant=Tenant.objects.create())
    check('foreign_membership_refused_before_runtime', invoke(token, bad_tenant, mismatch_source)[1] == 404
          and mismatch_source.resolutions == 0)
    store_row = query(); store_source = FixtureSource(store_row)
    Store.objects.filter(pk=store_row.store_ids[0]).update(tenant=Tenant.objects.create())
    check('cross_tenant_store_refused_before_runtime', invoke(token, store_row, store_source)[1] == 403
          and store_source.resolutions == 0)
    for mode in ('unavailable', 'tamper'):
        target = query(); port = FixtureSource(target); port.mode = mode; key = uuid.uuid4()
        result, status = invoke(token, target, port, str(key))
        check('evidence_'+mode+'_does_not_commit', status == 503
              and not StaffCommandReceipt.objects.filter(pk=key).exists()
              and not StaffAuditEvent.objects.filter(action=adapter.ACTION, target_id=target.pk).exists())

    changed = query(); port = FixtureSource(changed); key = uuid.uuid4()
    port.on_read = lambda: Query.objects.filter(pk=changed.pk).update(attempt=uuid.uuid4())
    check('platform_race_aborts_final_receipt', invoke(token, changed, port, str(key))[1] == 409
          and not StaffCommandReceipt.objects.filter(pk=key).exists())
    changed = query(); port = FixtureSource(changed); key = uuid.uuid4()
    port.on_read = lambda: setattr(port, 'op', replace(port.op, revision=8))
    check('native_revision_race_aborts_final_receipt', invoke(token, changed, port, str(key))[1] == 409
          and not StaffCommandReceipt.objects.filter(pk=key).exists())
    changed = query(); port = FixtureSource(changed); key = uuid.uuid4()
    active = StaffSession.objects.get(token_hash=hashlib.sha256(token.encode()).hexdigest())
    port.on_read = lambda: StaffSession.objects.filter(pk=active.pk).update(revoked_at=timezone.now())
    check('revoked_during_evidence_no_receipt_or_success_audit', invoke(token, changed, port, str(key))[1] == 401
          and not StaffCommandReceipt.objects.filter(pk=key).exists()
          and not StaffAuditEvent.objects.filter(action=adapter.ACTION, target_id=changed.pk).exists())
    token = login(operator)

    target = query(); port = FixtureSource(target); key = uuid.uuid4()
    actual_audit = service.audit
    def audit_failure(*args, **kwargs):
        if args[1] == adapter.ACTION: raise RuntimeError('synthetic audit failure')
        return actual_audit(*args, **kwargs)
    with patch.object(service, 'audit', side_effect=audit_failure):
        result, status = invoke(token, target, port, str(key))
    check('actual_postgres_rolls_back_receipt_when_audit_fails', status == 503
          and not StaffCommandReceipt.objects.filter(pk=key).exists())
    target = query(); port = FixtureSource(target); key = uuid.uuid4(); port.barrier = Barrier(2)
    def concurrent(_):
        try: return invoke(token, target, port, str(key))
        finally: connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:
        replies = list(pool.map(concurrent, range(2)))
    check('two_actual_postgres_commands_commit_one_receipt_audit', replies[0] == replies[1]
          and replies[0][1] == 202 and StaffCommandReceipt.objects.filter(pk=key).count() == 1
          and StaffAuditEvent.objects.filter(action=adapter.ACTION, target_id=target.pk).count() == 1)

    target = query(); port = FixtureSource(target); key = uuid.uuid4()
    real_commit = connection.commit; commits = 0
    def lost_reply():
        nonlocal commits
        real_commit(); commits += 1
        # Initial actor, initial receipt lookup, then final write transaction.
        if commits == 3: raise RuntimeError('synthetic post-commit reply loss')
    with patch.object(connection, 'commit', side_effect=lost_reply):
        result, status = invoke(token, target, port, str(key))
    check('commit_reply_loss_is_unknown_to_caller_not_internal_retry', status == 503 and commits == 3
          and StaffCommandReceipt.objects.filter(pk=key).count() == 1)
    reads = port.reads
    result, status = invoke(token, target, port, str(key))
    check('same_key_recovers_actual_committed_receipt_after_loss', status == 202 and port.reads == reads
          and StaffAuditEvent.objects.filter(action=adapter.ACTION, target_id=target.pk).count() == 1)
    saved = StaffCommandReceipt.objects.get(pk=key); damaged = dict(saved.result)
    damaged['assessment'] = {**damaged['assessment'], 'replay_permitted': True}
    StaffCommandReceipt.objects.filter(pk=key).update(result=damaged)
    check('corrupt_persisted_receipt_fails_closed', invoke(token, target, port, str(key))[1] == 503)
    target = query(); port = FixtureSource(target); key = uuid.uuid4()
    StaffCommandReceipt.objects.create(id=key, product_id=core.PRODUCT, actor_id=operator.pk,
        fingerprint='4'*64, result={'state':'APPLIED'}, http_status=200)
    check('different_command_kind_cannot_collide', invoke(token, target, port, str(key))[1] == 409)
    with transaction.atomic():
        result, status = invoke(token, target, port)
    check('outer_transaction_is_refused_before_evidence', status == 503 and result['code']=='TRANSACTION_CONTEXT_INVALID')
    acquired, release = Event(), Event()
    def hold_existing_owner_lock():
        try:
            with transaction.atomic():
                service.owner_lock(); acquired.set(); release.wait(timeout=8)
        finally: connections.close_all()
    key = uuid.uuid4()
    with ThreadPoolExecutor(max_workers=1) as pool:
        held = pool.submit(hold_existing_owner_lock)
        try:
            check('contention_fixture_owns_existing_lock', acquired.wait(timeout=3))
            result, status = invoke(token, target, port, str(key))
        finally:
            release.set(); held.result(timeout=5)
    check('real_pg_lock_contention_is_bounded_and_has_no_receipt', status == 503
          and not StaffCommandReceipt.objects.filter(pk=key).exists())
    route = Client(HTTP_HOST='localhost').post('/api/v1/staff/operations/reconciliations',
        data='{}', content_type='application/json', HTTP_AUTHORIZATION='Bearer '+settings.STAFF_SERVICE_TOKEN)
    check('unfinished_live_endpoint_not_registered', route.status_code == 404)
    check('no_new_models_or_migration_required', set(saved._meta.fields[i].name for i in range(len(saved._meta.fields)))
          == {'id','product_id','actor_id','fingerprint','result','http_status','created_at'})
    return CASES


if __name__ == '__main__':
    report = {'scope':'AL_S16_REAL_POSTGRES_STAFF_ADAPTER_SYNTHETIC_RUNTIME_SOURCE',
              'status':'FAILED','cases':CASES,'runtime_transport_qualified':False,
              'public_route_or_browser_qualified':False,'native_job_mutations':0}
    try:
        main(); report['status'] = 'PASS'
    except Exception as error:
        report['error_type'] = type(error).__name__
        if isinstance(error, RuntimeError) and str(error).startswith('CHECK_FAILED:'):
            report['failed_case'] = str(error).split(':',1)[1]
        trace = error.__traceback__
        while trace.tb_next: trace = trace.tb_next
        report['error_location'] = {'file':Path(trace.tb_frame.f_code.co_filename).name, 'line':trace.tb_lineno}
    finally:
        Path(sys.argv[1]).write_text(json.dumps(report, indent=2)+'\n')
    raise SystemExit(0 if report['status']=='PASS' else 1)
