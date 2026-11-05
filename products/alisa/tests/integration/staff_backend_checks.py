"""Commands/revocation/privileges on the owned disposable platform database."""
import hashlib
import json
import os
import secrets
import sys
import uuid
from datetime import timedelta
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

if not (os.environ.get('ALISA_STAFF_CORE_TEST_ALLOW') == '1' and os.environ.get('ALISA_ENV') == 'dev'
        and os.environ.get('ALISA_DB_NAME') == 'alisa_s03_core_platform'
        and os.environ.get('ALISA_DB_HOST') == '127.0.0.1' and os.environ.get('ALISA_DB_PORT') == '55480'):
    raise RuntimeError('Owned disposable staff platform database required')

import django
django.setup()
from django.conf import settings
from django.core.management import call_command
from django.db import connection, connections, transaction, DatabaseError
from django.test import Client
from django.utils import timezone
from alisa_platform.staff.service import bootstrap_owner
from alisa_platform.staff.models import StaffMember, StaffSession, StaffAuthFlow, StaffAuditEvent
from alisa_platform.staff.policy import PRODUCT
from alisa_platform.accounts.models import Customer, Tenant, Membership, AuthFlow, WebSession

CASES = []
def check(name, ok):
    if not ok:
        raise RuntimeError('CHECK_FAILED:' + name)
    CASES.append({'case': name, 'passed': True})

def api(action, data, service=None):
    return Client(HTTP_HOST='localhost').post('/api/v1/staff/' + action,
        data=json.dumps(data), content_type='application/json',
        HTTP_AUTHORIZATION='Bearer ' + (service or settings.STAFF_SERVICE_TOKEN))

def main():
    owner = bootstrap_owner(str(uuid.uuid4()), 'Synthetic Owner')
    def login(member, token=None):
        token = token or secrets.token_urlsafe(32)
        encrypted = 'synthetic-encrypted-' + secrets.token_urlsafe(48)
        created = api('auth/flows', {'encrypted_payload': encrypted})
        flow = api('auth/flows/consume', {'flow_ref': created.json()['flow_ref']})
        payload = {'flow_id': flow.json()['flow_id'], 'issuer': settings.IDENTITY_ISSUER,
            'client_id': settings.STAFF_CLIENT_ID, 'subject': member.subject,
            'session_hash': hashlib.sha256(token.encode()).hexdigest(), 'encrypted_payload': encrypted,
            'mfa_at': int(timezone.now().timestamp()), 'mfa_type': 'totp'}
        result = api('auth/sessions', payload)
        return token, result, payload
    token, response, login_payload = login(owner)
    check('s03_closed_bootstrap_and_explicit_staff_session', response.status_code == 201)
    check('s03_session_creation_identical_retry_recovers_receipt', api('auth/sessions', login_payload).json().get('state') == 'ALREADY_CREATED')
    changed = {**login_payload, 'session_hash': 'a' * 64}
    check('s03_session_flow_cannot_bind_another_session_token', api('auth/sessions', changed).status_code == 409)
    check('s03_web_service_token_cannot_call_staff_api', api('me', {'session_token': token}, settings.AUTH_SERVICE_TOKEN).status_code == 401)
    check('s03_browser_role_labels_do_not_authorize', api('me', {'session_token': 'z' * 43}).status_code == 401)
    try:
        bootstrap_owner(str(uuid.uuid4()), 'Second Owner')
        denied = False
    except ValueError:
        denied = True
    check('s03_closed_bootstrap_cannot_replace_or_append_owner', denied)
    customer = Customer.objects.create(email='customer-core@example.invalid')
    tenant = Tenant.objects.create()
    Membership.objects.create(customer=customer, tenant=tenant)
    flow = AuthFlow.objects.create(secret_hash=secrets.token_hex(32), encrypted_payload='', expires_at=timezone.now()+timedelta(minutes=10))
    web = WebSession.objects.create(customer=customer, tenant=tenant, flow=flow, token_hash=secrets.token_hex(32),
        encrypted_payload='synthetic-private-state', security_revision=1, expires_at=timezone.now()+timedelta(hours=1))
    def command(action, payload, actor_token=token, command_id=None):
        return {'session_token': actor_token, 'command_id': command_id or str(uuid.uuid4()),
            'action': action, 'payload': payload, 'reason': 'SECURITY_REVIEW'}
    block = command('customer.block', {'customer_id': str(customer.pk), 'revision': 1})
    response = api('command', block)
    check('s03_local_block_and_idempotent_receipt', response.status_code == 200 and api('command', block).json() == response.json())
    customer.refresh_from_db(); web.refresh_from_db()
    check('s03_local_block_revokes_only_product_customer_sessions', not customer.is_active and customer.security_revision == 2 and web.revoked_at is not None and web.encrypted_payload == '')
    altered = {**block, 'payload': {**block['payload'], 'revision': 2}}
    check('s03_command_uuid_cannot_apply_changed_payload', api('command', altered).status_code == 409)
    def concurrent(_):
        try:
            return api('command', unblock).status_code
        finally:
            connections.close_all()
    unblock = command('customer.unblock', {'customer_id': str(customer.pk), 'revision': 2})
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(concurrent, range(2)))
    customer.refresh_from_db()
    check('s03_concurrent_identical_commands_have_one_revision_effect', results == [200,200] and customer.is_active and customer.security_revision == 3)
    reader = StaffMember.objects.create(product_id=PRODUCT, issuer=settings.IDENTITY_ISSUER,
        client_id=settings.STAFF_CLIENT_ID, subject=str(uuid.uuid4()), name='Reader', role='ADMIN', permissions=['users.read'])
    reader_token, result, _ = login(reader)
    check('s03_limited_staff_can_read_real_customer', result.status_code == 201 and api('read', {'session_token': reader_token, 'resource': 'customers'}).json()['items'][0]['id'] == str(customer.pk))
    check('s03_reader_block_denied_by_backend_and_audited', api('command', command('customer.block', {'customer_id': str(customer.pk), 'revision': 3}, reader_token)).status_code == 403 and StaffAuditEvent.objects.filter(actor_id=reader.pk, action='staff.denied').exists())
    second_reader, _, _ = login(reader)
    revoke = api('command', command('staff.revoke', {'staff_id': str(reader.pk), 'revision': 1}))
    check('s03_staff_revocation_invalidates_both_sessions', revoke.status_code == 200 and all(api('me', {'session_token': t}).status_code == 401 for t in [reader_token,second_reader]))
    check('s03_last_owner_is_transactionally_protected', api('command', command('staff.revoke', {'staff_id': str(owner.pk), 'revision': 1})).status_code == 409)
    foreign = StaffMember.objects.create(product_id='other_product', issuer=settings.IDENTITY_ISSUER,
        client_id=settings.STAFF_CLIENT_ID, subject=str(uuid.uuid4()), name='Other product', role='OWNER', permissions=[])
    _, denied, _ = login(foreign)
    check('s03_other_product_staff_has_no_alisa_session', denied.status_code == 403)
    owner_session = StaffSession.objects.get(token_hash=hashlib.sha256(token.encode()).hexdigest())
    owner_session.mfa_verified_at = timezone.now()-timedelta(seconds=301)
    owner_session.save(update_fields=['mfa_verified_at'])
    check('s03_stale_mfa_denies_current_backend_reads', api('read', {'session_token': token, 'resource': 'customers'}).status_code == 403)
    owner_session.mfa_verified_at = timezone.now()
    owner_session.save(update_fields=['mfa_verified_at'])
    for verb in ['UPDATE staff_staffauditevent SET outcome=outcome', 'DELETE FROM staff_staffauditevent', 'TRUNCATE staff_staffauditevent']:
        try:
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(verb)
            denied = False
        except DatabaseError:
            denied = True
        check('s03_runtime_audit_' + verb.split()[0].lower() + '_denied_by_postgresql', denied)
    text = json.dumps(list(StaffAuditEvent.objects.values('before','after','reason','action')))
    check('s03_safe_audit_excludes_contacts_and_session_tokens', customer.email not in text and token not in text and reader_token not in text)
    check('s03_logout_revokes_current_staff_session', api('logout', {'session_token': token}).status_code == 200 and api('me', {'session_token': token}).status_code == 401)
    own_expired=StaffAuthFlow.objects.create(product_id=PRODUCT,secret_hash=secrets.token_hex(32),encrypted_payload='expired-private-state',expires_at=timezone.now()-timedelta(seconds=1))
    foreign_expired=StaffAuthFlow.objects.create(product_id='other_product',secret_hash=secrets.token_hex(32),encrypted_payload='foreign-private-state',expires_at=timezone.now()-timedelta(seconds=1))
    call_command('accounts_cleanup')
    own_expired.refresh_from_db();foreign_expired.refresh_from_db();owner_session.refresh_from_db()
    check('s03_cleanup_erases_owned_expired_and_revoked_staff_payloads',own_expired.encrypted_payload=='' and owner_session.encrypted_payload=='')
    check('s03_cleanup_preserves_foreign_product_staff_payload',foreign_expired.encrypted_payload=='foreign-private-state')
    check('s03_staff_enabled_readiness_checks_own_schema',Client(HTTP_HOST='localhost').get('/health/ready').status_code==200)
    return CASES

if __name__ == '__main__':
    record = {'scope': 'S03_PLATFORM_CORE_NOT_BROWSER_NOT_STAGE', 'status': 'FAILED', 'cases': CASES}
    try:
        main()
        record['status'] = 'PASS'
    except Exception as exc:
        record['error_type']=type(exc).__name__
        trace=exc.__traceback__
        while trace.tb_next:trace=trace.tb_next
        record['error_location']={'file':Path(trace.tb_frame.f_code.co_filename).name,'line':trace.tb_lineno}
    finally:
        Path(sys.argv[1]).write_text(json.dumps(record, indent=2) + '\n')
    sys.exit(0 if record['status']=='PASS' else 1)
