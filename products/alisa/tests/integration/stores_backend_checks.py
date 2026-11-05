"""S05 real PostgreSQL, vault and Unix peer checks; no marketplace HTTP."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
import django
django.setup()
from django.conf import settings
from django.db import connections, connection, transaction, DatabaseError
from django.test import Client, override_settings
from django.utils import timezone
from alisa_platform.accounts.models import Customer, Tenant, Membership, AuthFlow, WebSession
from alisa_platform.stores.models import Store, CredentialRevision, VaultSecret, StoreCommand, StoreAudit
from alisa_platform.stores import service, vault
from store_check_fixture import Fixture

record={'scope':'S05_DISPOSABLE_POSTGRES_VAULT_UNIX_NOT_REAL_PROVIDER_NOT_INSTALLED','status':'FAILED','cases':[]}
def check(name, value):
    record['cases'].append({'case':name,'passed':bool(value)})
    if not value:raise RuntimeError('CHECK_FAILED:'+name)
def customer():
    row=Customer.objects.create(email='stores-'+uuid.uuid4().hex+'@example.invalid');tenant=Tenant.objects.create()
    Membership.objects.create(customer=row,tenant=tenant)
    now=timezone.now();flow=AuthFlow.objects.create(secret_hash=secrets.token_hex(32),encrypted_payload='',consumed_at=now,completed_at=now,expires_at=now+timedelta(minutes=10))
    token=secrets.token_urlsafe(32)
    WebSession.objects.create(customer=row,tenant=tenant,flow=flow,token_hash=hashlib.sha256(token.encode()).hexdigest(),security_revision=1,encrypted_payload='',expires_at=now+timedelta(hours=1))
    return row,tenant,token
def api(token,command):
    response=Client().post('/api/v1/account/stores',data=json.dumps({'session_token':token,'command':command}),content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN,HTTP_HOST='127.0.0.1')
    return response.status_code,response.json()
def command(action,**values):return {'action':action,'command_id':str(uuid.uuid4()),**values}
def key(identity='ozon:one',code='CONNECTED'):return {'client_id':'123','api_key':'fixture:'+code+':'+identity}
def create(token,identity='ozon:one',provider='OZON'):
    value=command('create',provider=provider,name='Synthetic shop',voice_alias='Основной',credential=key(identity) if provider=='OZON' else {'token':'fixture:CONNECTED:'+identity})
    status,data=api(token,value);assert status==201
    return data['store'],value
def verify(token,s,candidate=None):
    candidate=candidate or next(r for r in s['credentials'] if r['status']=='PENDING')
    value=command('check',store_id=s['id'],expected_revision=s['revision'],credential_id=candidate['id'])
    status,data=api(token,value);assert status==200
    return data['store'],data,value
def replace(token,s,value,kind='SELLER'):
    status,data=api(token,command('credential',store_id=s['id'],expected_revision=s['revision'],kind=kind,credential=value));assert status==200
    return data['store']

fixture=None
try:
    assert os.environ.get('ALISA_STORES_CORE_TEST_ALLOW')=='1' and settings.DATABASES['default']['NAME']=='alisa_s05_core_platform'
    a,ta,token=customer();b,tb,other=customer()
    with tempfile.TemporaryDirectory(prefix='alisa-s05-unix-') as folder:
      path=Path(folder)/'check.sock';fixture=Fixture(path,os.getuid())
      with override_settings(STORE_CHECK_SOCKET=str(path),STORE_CHECK_UID=os.getuid()):
        s,created=create(token)
        check('unpaid_customer_can_persist_pending_store',s['credentials'][0]['status']=='PENDING' and not s['identity_verified'])
        secret=VaultSecret.objects.get(store_id=s['id']);revision=CredentialRevision.objects.get(store_id=s['id'])
        check('vault_ciphertext_has_no_plaintext_and_context_roundtrips','fixture:' not in secret.ciphertext and vault.open_secret(Store.objects.get(pk=s['id']),revision,secret)==key())
        check('projection_has_no_secret_ciphertext_reference_or_identity',not any(x in json.dumps(s) for x in ['fixture:',secret.ciphertext,str(secret.pk),'ozon:one']))
        again=api(token,created)
        check('same_create_command_replays_one_store_and_secret',again[0]==201 and again[1]['store']==s and Store.objects.filter(tenant=ta).count()==1 and VaultSecret.objects.filter(store_id=s['id']).count()==1)
        check('changed_create_payload_same_uuid_conflicts',api(token,{**created,'name':'Changed'})[0]==409)
        saved_command=StoreCommand.objects.get(request_id=created['command_id'])
        from types import SimpleNamespace
        scoped_other=SimpleNamespace(tenant_id=tb.pk,customer_id=b.pk)
        check('secret_idempotency_digest_is_server_keyed_and_tenant_bound',saved_command.fingerprint!=hashlib.sha256(json.dumps(created,sort_keys=True,separators=(',',':')).encode()).hexdigest() and saved_command.fingerprint!=service.request_fingerprint(scoped_other,created))
        s,checked,checked_cmd=verify(token,s);before=fixture.calls
        check('actual_unix_peer_check_promotes_only_its_revision',checked['check_code']=='CONNECTED' and s['credentials'][0]['status']=='ACTIVE' and s['identity_verified'])
        check('same_check_command_does_not_dispatch_again',api(token,checked_cmd)[1]=={**checked,'environment':settings.ALISA_ENV,'release':settings.RELEASE} and fixture.calls==before)
        same=command('create',provider='OZON',name='Concurrent',voice_alias='',credential=key('ozon:concurrent'))
        def concurrent():
            try:return api(token,same)
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:out=list(pool.map(lambda _:concurrent(),range(2)))
        check('concurrent_same_command_has_one_persisted_effect',out[0]==out[1] and Store.objects.filter(tenant=ta,name='Concurrent').count()==1)
        duplicate,_=create(token);duplicate,out,_=verify(token,duplicate)
        check('verified_duplicate_is_tenant_local_and_not_promoted',out['check_code']=='ALREADY_CONNECTED' and duplicate['credentials'][0]['status']=='PENDING')
        cross,_=create(other);cross,out,_=verify(other,cross)
        check('same_provider_identity_in_other_tenant_is_allowed_without_disclosure',out['check_code']=='CONNECTED')
        check('foreign_store_id_returns_not_found',api(other,command('rename',store_id=s['id'],expected_revision=s['revision'],name='Foreign',voice_alias=''))[0]==404)
        check('forged_browser_tenant_is_rejected',api(token,{'action':'list','tenant_id':str(tb.pk)})[0]==422)
        active=CredentialRevision.objects.get(store_id=s['id'],status='ACTIVE');old_cipher=active.secret.ciphertext
        s=replace(token,s,key('ozon:other'));s,out,_=verify(token,s)
        active.refresh_from_db();active.secret.refresh_from_db()
        check('replacement_other_account_keeps_original_active_key',out['check_code']=='ACCOUNT_MISMATCH' and active.status=='ACTIVE' and active.secret.ciphertext==old_cipher)
        s=replace(token,s,key());s,out,_=verify(token,s);active.refresh_from_db();active.secret.refresh_from_db()
        check('same_account_replacement_promotes_new_and_erases_retired_secret',out['check_code']=='CONNECTED' and active.status=='REVOKED' and active.secret.ciphertext=='' and CredentialRevision.objects.filter(store_id=s['id'],status='ACTIVE').count()==1)
        for code in ['AUTH_DENIED','SCOPE_MISSING','TIMEOUT','RATE_LIMITED']:
            s=replace(token,s,key(code=code));s,out,_=verify(token,s)
            check('provider_'+code.lower()+'_is_distinct_and_preserves_active',out['check_code']==code and CredentialRevision.objects.filter(store_id=s['id'],status='ACTIVE').count()==1)
        fixture.bad_pins=True;s,out,_=verify(token,s);fixture.bad_pins=False
        check('changed_response_tenant_pins_fail_closed',out['check_code']=='CHECK_UNAVAILABLE')
        with override_settings(STORE_CHECK_UID=os.getuid()+1):s,out,_=verify(token,s)
        check('wrong_server_peer_never_receives_secret',out['check_code']=='CHECK_UNAVAILABLE')
        with override_settings(STORE_CHECK_SOCKET=''):s,out,_=verify(token,s)
        check('disconnected_runtime_never_claims_connected',out['check_code']=='CHECK_UNAVAILABLE')
        s=replace(token,s,{'client_id':'perf-123','client_secret':'fixture:CONNECTED:ozon:one'},'PERFORMANCE');s,out,_=verify(token,s,next(c for c in s['credentials'] if c['kind']=='PERFORMANCE'))
        check('performance_independent_same_account_capability',out['check_code']=='CONNECTED' and any(c['kind']=='SELLER' and c['status']=='ACTIVE' for c in s['credentials']))
        revoked=api(token,command('revoke_credential',store_id=s['id'],expected_revision=s['revision'],kind='PERFORMANCE'))
        check('revoke_performance_erases_only_its_secret_and_keeps_seller',revoked[0]==200 and not VaultSecret.objects.filter(store_id=s['id'],kind='PERFORMANCE').exclude(ciphertext='').exists() and CredentialRevision.objects.filter(store_id=s['id'],kind='SELLER',status='ACTIVE').exists())
        s=revoked[1]['store']
        wb,_=create(token,'wb:one','WB');wb,out,_=verify(token,wb)
        check('wildberries_uses_its_own_verified_channel',out['check_code']=='CONNECTED' and wb['provider']=='WB' and wb['credentials'][0]['kind']=='WB')
        renamed=api(token,command('rename',store_id=s['id'],expected_revision=s['revision'],name='Новое имя',voice_alias='Первый'))[1]['store']
        check('rename_preserves_store_id_and_credential_revisions',renamed['id']==s['id'] and renamed['credentials']==s['credentials']);s=renamed
        check('stale_revision_is_rejected',api(token,command('disable',store_id=s['id'],expected_revision=s['revision']-1))[0]==409)
        denied=False
        try:
            with transaction.atomic():VaultSecret.objects.create(tenant=tb,store_id=s['id'],kind='SELLER',revision=99,key_version='fixture',ciphertext='fixture')
        except DatabaseError:denied=True
        check('postgresql_rejects_cross_tenant_store_foreign_key',denied)
        for permission in ['UPDATE','DELETE','TRUNCATE']:
            with connection.cursor() as cursor:cursor.execute('SELECT has_table_privilege(current_user,%s,%s)',['stores_storeaudit',permission]);denied=not cursor.fetchone()[0]
            check('audit_runtime_'+permission.lower()+'_denied',denied)
        current=CredentialRevision.objects.filter(store_id=s['id'],status='ACTIVE',kind='SELLER').get()
        current.secret.ciphertext=VaultSecret.objects.get(store_id=wb['id']).ciphertext
        try:vault.open_secret(Store.objects.get(pk=s['id']),current,current.secret);denied=False
        except vault.VaultUnavailable:denied=True
        check('vault_ciphertext_cannot_move_between_stores',denied)
        # Persist the claim, interrupt before a response, then replay without IPC.
        pending_s=replace(token,s,key());request=command('check',store_id=s['id'],expected_revision=pending_s['revision'],credential_id=next(c['id'] for c in pending_s['credentials'] if c['status']=='PENDING' and c['kind']=='SELLER'))
        try:
            with patch.object(service,'check_store',side_effect=RuntimeError('SYNTHETIC_INTERRUPTION')):service.execute(token,request)
        except RuntimeError:pass
        before=fixture.calls
        check('crashed_check_replay_has_no_second_dispatch',api(token,request)[0]==202 and fixture.calls==before)
        claim=StoreCommand.objects.get(request_id=request['command_id']);claim.deadline=timezone.now()-timedelta(seconds=1);claim.save(update_fields=['deadline'])
        pending_s,out,_=verify(token,pending_s);claim.refresh_from_db()
        check('new_explicit_check_marks_expired_previous_unknown',out['check_code']=='CONNECTED' and claim.result['code']=='UNKNOWN_OUTCOME')
        s=pending_s
        original=service.check_store
        def disable_during_check(pins,material):
            assert not connection.in_atomic_block
            service.execute(token,command('disable',store_id=s['id'],expected_revision=s['revision']))
            return original(pins,material)
        active_meta=next(c for c in s['credentials'] if c['status']=='ACTIVE' and c['kind']=='SELLER')
        with patch.object(service,'check_store',side_effect=disable_during_check):status,out=api(token,command('check',store_id=s['id'],expected_revision=s['revision'],credential_id=active_meta['id']))
        check('disable_during_ipc_prevents_late_activation_and_erases_all_keys',status==409 and not VaultSecret.objects.filter(store_id=s['id']).exclude(ciphertext='').exists() and not CredentialRevision.objects.filter(store_id=s['id'],status__in=['ACTIVE','PENDING']).exists())
        deleted=api(token,command('delete',store_id=s['id'],expected_revision=Store.objects.get(pk=s['id']).revision))
        check('delete_tombstone_disappears_from_list_without_losing_audit',deleted[0]==200 and all(r['id']!=s['id'] for r in api(token,{'action':'list'})[1]['items']) and StoreAudit.objects.filter(store_id=s['id']).exists())
        check('customer_cookie_or_web_token_cannot_authorize_service_api',Client().post('/api/v1/account/stores',data='{}',content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.SERVICE_TOKEN,HTTP_HOST='127.0.0.1').status_code==401)
        check('safe_durable_command_results_have_no_credentials',all('fixture:' not in json.dumps(r) for r in StoreCommand.objects.values_list('result',flat=True)))
        record['status']='PASS'
except Exception as error:
    record['status']='FAILED';record['error_type']=type(error).__name__
    if isinstance(error,RuntimeError):record['failed_case']=str(error)
    trace=error.__traceback__
    while trace:
        if trace.tb_frame.f_code.co_filename==__file__:record['error_line']=trace.tb_lineno
        trace=trace.tb_next
finally:
    if fixture:fixture.close()
    connections.close_all();Path(sys.argv[1]).write_text(json.dumps(record,indent=2)+'\n')
sys.exit(0 if record['status']=='PASS' else 1)
