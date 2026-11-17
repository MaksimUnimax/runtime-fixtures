"""Real PostgreSQL staff tickets and Unix/SQLite read; owned S03 fixture only."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import sys
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch

# Import the guarded existing S16 fixture, not application startup/environment.
import s16_reconciliation_backend_checks as fixture
from django.conf import settings
from django.core import signing
from django.db import connection, connections, transaction, DatabaseError
from django.test import override_settings
from django.utils import timezone
from alisa_platform.accounts.models import Customer, Membership
from alisa_platform.staff.models import StaffMember, StaffSession, StaffCommandReceipt, StaffAuditEvent
from alisa_platform.staff import service
from alisa_platform.stores.models import Store, CredentialRevision, VaultSecret
from alisa_platform.entitlements.models import AccessLedger, AccessGrant
from alisa_platform.entitlements.service import snapshot, readonly_snapshot
from alisa_platform.runtime_adapter.authority import RuntimeAuthority
from alisa_platform.runtime_adapter.bindings import BindingFile
from alisa_platform.operations.platform_adapter import target_snapshot, PlatformAdapter
from alisa_platform.operations import staff_read_authority as a
from alisa_platform.operations import reconciliation as core

CASES=[]
def check(name, value):
    if not value:raise RuntimeError('CHECK_FAILED:'+name)
    CASES.append({'case':'s16_staff_read_'+name,'passed':True})

def rejected(name, fn, code=None):
    try:fn()
    except Exception as error:
        check(name,isinstance(error,core.ReconcileError) and (code is None or error.code==code))
        check(name+'_safe_error',str(error)==error.code)
    else:check(name,False)

def target(row):
    with transaction.atomic():return target_snapshot(str(row.pk),lock_rows=False)

def main():
    check('guarded_actual_pg_role',connection.vendor=='postgresql' and
          connection.settings_dict['USER']=='alisa_s03_core_platform_runtime')
    root=Path(__file__).resolve().parents[2]
    sys.path.insert(0,str(root))
    from runtime.reconciliation import native_snapshot as native,read_channel as channel
    # These imports are plain product/test source, not the installed native DB.
    sys.path.insert(0,str(root/'tests/operations'))
    import test_native_snapshot as native_fixture
    operator=fixture.member([core.PERMISSION]);token=fixture.login(operator)
    reader=fixture.member(['users.read']);reader_token=fixture.login(reader)
    row=fixture.query();store=Store.objects.get(pk=row.store_ids[0])
    store.verified_identity='synthetic-read-'+uuid.uuid4().hex;store.save(update_fields=['verified_identity'])
    secret=VaultSecret.objects.create(tenant_id=row.tenant_id,store=store,kind='SELLER',revision=1,
                                     key_version='fixture',ciphertext='never-decrypted-synthetic')
    credential=CredentialRevision.objects.create(tenant_id=row.tenant_id,store=store,kind='SELLER',
                  revision=1,secret=secret,status='ACTIVE',check_code='CONNECTED')
    ledger=AccessLedger.objects.create(tenant_id=row.tenant_id)
    now=timezone.now()
    AccessGrant.objects.create(tenant_id=row.tenant_id,source='GIFT',source_id=uuid.uuid4(),days=1,
        starts_at=now-timedelta(minutes=2),ends_at=now+timedelta(hours=1),actor_id=operator.pk,reason='PILOT_ACCESS')
    with tempfile.TemporaryDirectory(prefix='s16-auth-',dir=root/'dist') as temporary:
        private=Path(temporary);private.chmod(0o700)
        mapping={'schema':'alisa-runtime-bindings/v1','environment':'dev','service_id':'s16-source-test',
            'catalog_release_id':'s16-catalog-test','tenants':[{'tenant_id':str(row.tenant_id),
            'runtime_tenant':'synthetic-native','revision':'fixture-v1','stores':[{'store_id':str(store.pk),
            'provider':'OZON','verified_identity':store.verified_identity,'credential_revision':1,
            'credentials':[{'kind':'SELLER','id':str(credential.pk),'revision':1}],
            'runtime_store':{'id':'fixture-store','platform':'ozon','identity':'fixture-account',
                'access_revision':'1','source_revision':'platform:fixture','currency':'RUB'}}]}]}
        path=private/'bindings.json';path.write_text(json.dumps(mapping));path.chmod(0o600)
        runtime=RuntimeAuthority(BindingFile(str(path),owner_uid=os.getuid()),
                                 service_id='s16-source-test',catalog_release_id='s16-catalog-test')
        authority=a.StaffReadAuthority(runtime,'f'*64)
        with override_settings(RUNTIME_AUTHORITY_ENABLED=True,ACCOUNTS_ENABLED=True,STORES_ENABLED=True,
                               ENTITLEMENTS_ENABLED=True,RUNTIME_AUTO_BINDINGS_ENABLED=False):
            t=target(row);nonce=secrets.token_hex(32)
            ticket=authority.issue(token,t,nonce,remaining=2.)
            grant=authority.verify(ticket,nonce,t.binding,remaining=2.)
            check('actual_signing_and_pg_staff_ticket',grant['staff_id']==str(operator.pk)
                  and grant['scope']['object_id']==str(row.pk) and grant['permission']==core.PERMISSION)
            check('private_session_and_vault_not_in_return',token not in json.dumps(grant)
                  and 'never-decrypted' not in json.dumps(grant) and 'session_id' not in grant)
            check('issuer_current_exact_session',authority.current(token,ticket,nonce,t.binding,remaining=2.) is True)
            rejected('other_session_cannot_reuse_signed_ticket',lambda:authority.current(reader_token,ticket,nonce,t.binding,remaining=2.))
            rejected('missing_permission_cannot_issue',lambda:authority.issue(reader_token,t,nonce,remaining=2.))
            rejected('forged_signature',lambda:authority.verify(ticket[:-1]+('X' if ticket[-1]!='X' else 'Y'),nonce,t.binding,remaining=2.))
            rejected('wrong_nonce',lambda:authority.verify(ticket,secrets.token_hex(32),t.binding,remaining=2.))
            rejected('wrong_target',lambda:authority.verify(ticket,nonce,'a'*64,remaining=2.))
            signed=signing.loads(ticket,salt=a.SALT,max_age=a.LIFETIME)
            for key,value in [('environment','wrong'),('service_id','wrong'),('catalog_bundle_hash','a'*64),
                              ('expires_at',signed['issued_at']+6),('issued_at',timezone.now().timestamp()+1),
                              ('staff_id',str(uuid.uuid4()))]:
                candidate=signing.dumps({**signed,key:value},salt=a.SALT,compress=False)
                rejected('signed_invalid_'+key,lambda v=candidate:authority.verify(v,nonce,t.binding,remaining=2.))
            # Compare the common projection while preserving old locking calls.
            with transaction.atomic():
                p1=runtime.state(str(row.customer_id),str(row.tenant_id),row.store_ids)
                p2=runtime.read_state(str(row.customer_id),str(row.tenant_id),row.store_ids)
                check('same_runtime_rights_projection',p1==p2)
                stamp=timezone.now();check('same_entitlement_projection',snapshot(row.tenant_id,stamp)==readonly_snapshot(row.tenant_id,stamp))
            sql=[]
            def observe(execute,statement,params,many,context):
                sql.append(str(statement));return execute(statement,params,many,context)
            with connection.execute_wrapper(observe):runtime.state(str(row.customer_id),str(row.tenant_id),row.store_ids)
            check('old_runtime_path_retains_locks',any('FOR UPDATE' in x or 'FOR NO KEY UPDATE' in x for x in sql))
            # Native callback runs on another actual database connection while
            # the initiating adapter retains exactly its established row locks.
            def independent(ticket,nonce,thash):
                connections.close_all()
                try:
                    started=time.monotonic();out=authority.verify(ticket,nonce,thash,remaining=1.5)
                    return out,time.monotonic()-started
                finally:connections.close_all()
            with ThreadPoolExecutor(max_workers=1) as pool:
                with transaction.atomic():
                    service.owner_lock();require_member=service.principal(token,core.PERMISSION)
                    locked=target_snapshot(str(row.pk),lock_rows=True)
                    AccessLedger.objects.select_for_update().get(pk=ledger.pk)
                    CredentialRevision.objects.select_for_update().get(pk=credential.pk)
                    n=secrets.token_hex(32);issued=authority.issue(token,locked,n,remaining=1.5)
                    answer,elapsed=pool.submit(independent,issued,n,locked.binding).result(timeout=2.5)
                    check('callback_finishes_while_real_initiator_locks_held',require_member.pk==operator.pk
                          and answer['scope']['object_id']==str(row.pk) and elapsed<1.5)
            # Each verifier call gets a new read-only snapshot, no local cache.
            n=secrets.token_hex(32);issued=authority.issue(token,target(row),n,remaining=2.)
            StaffSession.objects.filter(token_hash=hashlib.sha256(token.encode()).hexdigest()).update(revoked_at=timezone.now())
            rejected('committed_session_revoke_observed',lambda:authority.verify(issued,n,target(row).binding,remaining=2.))
            token=fixture.login(operator)
            n=secrets.token_hex(32);issued=authority.issue(token,target(row),n,remaining=2.)
            StaffMember.objects.filter(pk=operator.pk).update(revision=2)
            rejected('member_revision_observed',lambda:authority.verify(issued,n,target(row).binding,remaining=2.))
            operator.refresh_from_db();token=fixture.login(operator)
            session=StaffSession.objects.get(token_hash=hashlib.sha256(token.encode()).hexdigest())
            StaffSession.objects.filter(pk=session.pk).update(mfa_verified_at=timezone.now()-timedelta(seconds=301))
            rejected('real_stale_mfa_refused',lambda:authority.issue(token,target(row),secrets.token_hex(32),remaining=2.))
            token=fixture.login(operator)
            n=secrets.token_hex(32);t=target(row);issued=authority.issue(token,t,n,remaining=2.)
            AccessLedger.objects.filter(pk=ledger.pk).update(revision=2)
            rejected('access_revision_changes_guard',lambda:authority.verify(issued,n,t.binding,remaining=2.))
            n=secrets.token_hex(32);issued=authority.issue(token,target(row),n,remaining=2.)
            CredentialRevision.objects.filter(pk=credential.pk).update(status='REVOKED')
            rejected('credential_revocation_refused',lambda:authority.verify(issued,n,target(row).binding,remaining=2.))
            CredentialRevision.objects.filter(pk=credential.pk).update(status='ACTIVE')
            n=secrets.token_hex(32);issued=authority.issue(token,target(row),n,remaining=2.)
            Customer.objects.filter(pk=row.customer_id).update(is_active=False)
            rejected('customer_block_refused',lambda:authority.verify(issued,n,target(row).binding,remaining=2.))
            Customer.objects.filter(pk=row.customer_id).update(is_active=True)
            n=secrets.token_hex(32);t=target(row);issued=authority.issue(token,t,n,remaining=2.)
            type(row).objects.filter(pk=row.pk).update(runtime_job_ref=uuid.uuid4())
            rejected('changed_query_native_binding_refused',lambda:authority.verify(issued,n,t.binding,remaining=2.))
            row.refresh_from_db()
            # The independent verifier refuses a caller transaction instead of
            # silently inheriting a stale snapshot or recursively locking rows.
            n=secrets.token_hex(32);t=target(row);issued=authority.issue(token,t,n,remaining=2.)
            with transaction.atomic():rejected('ambient_callback_transaction_refused',lambda:authority.verify(issued,n,t.binding,remaining=2.))
            start=time.monotonic()
            try:
                with a.bounded_reads(.08):
                    with connection.cursor() as cursor:cursor.execute('SELECT pg_sleep(1)')
            except DatabaseError as error:
                check('pg_sleep_really_cancelled',getattr(error.__cause__,'sqlstate',None)=='57014'
                      and time.monotonic()-start<.6)
            else:check('pg_sleep_really_cancelled',False)
            for sql in ('SELECT id FROM queries_query FOR UPDATE','UPDATE queries_query SET state=state'):
                try:
                    with a.bounded_reads(.2):
                        with connection.cursor() as cursor:cursor.execute(sql)
                except core.ReconcileError:check('read_callback_rejects_'+('row_lock' if 'FOR UPDATE' in sql else 'write'),True)
                else:check('read_callback_rejects_sql',False)
            with connection.cursor() as cursor:cursor.execute('SHOW statement_timeout');original=cursor.fetchone()[0]
            with transaction.atomic():
                with a.bounded_reads(.2,ambient=True):
                    with connection.cursor() as cursor:cursor.execute('SELECT 1')
                with connection.cursor() as cursor:cursor.execute('SHOW statement_timeout');restored=cursor.fetchone()[0]
                check('parent_statement_timeout_restored',original==restored)
            # Actual Unix channel uses the REAL signed/DB authority, no boolean
            # verifier or synthetic HMAC. Conversion only shapes its grant data.
            t=target(row);authorizer=authority.for_target(token,t)
            n=secrets.token_hex(32);tmp_ticket=authorizer.prepare(n,t.binding,remaining=2.)
            g=authority.verify(tmp_ticket,n,t.binding,remaining=2.);scope=native.NativeScope(**g['scope'])
            database=private/'native.sqlite3';db=sqlite3.connect(database,isolation_level=None)
            db.executescript(native_fixture.SCHEMA);database.chmod(0o600)
            now=time.time();jid=uuid.uuid4().hex
            db.execute('INSERT INTO rt_job_refs VALUES(?,?,?,?,?,?,?,?,?)',(scope.runtime_job_ref,scope.tenant_id,
                scope.customer_id,scope.object_id,'b'*64,scope.guard_sha256,scope.runtime_tenant,jid,now-1))
            db.execute('INSERT INTO jobs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(jid,scope.runtime_tenant,'UNKNOWN',
                now-2,now-1,now-2,None,None,None,None,0,0,'private','private','private','private','private'))
            db.execute('INSERT INTO reader_cursors VALUES(?,?,?,?,?)',(scope.runtime_tenant,
                'rt_'+scope.runtime_job_ref.replace('-',''),jid,0,now-1))
            before=list(db.iterdump())
            class NativeVerifier:
                def verify(self,ticket,nonce,target_sha256,*,remaining):
                    value=authority.verify(ticket,nonce,target_sha256,remaining=remaining)
                    value['scope']=native.NativeScope(**value['scope'])
                    return channel.Grant(**value)
            endpoint=private/'s';listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
            listener.bind(str(endpoint));endpoint.chmod(0o600);listener.listen(1);listener.settimeout(3)
            outcome=[]
            def serve():
                connections.close_all()
                try:
                    with listener.accept()[0] as peer:
                        outcome.append(channel.serve_connected(peer,allowed_uid=os.getuid(),authority=NativeVerifier(),
                                      database=database,native_uid=os.getuid(),timeout=2.))
                finally:connections.close_all()
            thread=threading.Thread(target=serve);thread.start()
            try:
                client=channel.Client(str(endpoint),expected_uid=os.getuid(),expected_pid=os.getpid(),
                                      expected_producer=channel.producer_pin(),timeout=2.)
                result=client.read(t.binding,authorizer)
                op=core.operation_from_native_snapshot(result,object_id=t.object_id,tenant_id=t.tenant_id,
                      customer_id=t.customer_id,runtime_job_ref=t.runtime_job_ref)
                check('real_db_authority_unix_and_native_snapshot_roundtrip',op.state=='UNKNOWN' and op.native_identity is not None)
            finally:
                thread.join(timeout=3);listener.close();endpoint.unlink()
            check('actual_handler_finished_and_no_replay',not thread.is_alive() and outcome==['SENT']
                  and before==list(db.iterdump()) and result['replay_permitted'] is False)
            db.close()
            check('real_key_ticket_no_new_secret_or_model',len(ticket)<=4096 and len(CASES)>20)
    return CASES


if __name__=='__main__':
    report={'scope':'AL_S16_REAL_DB_STAFF_SIGNING_UNIX_SQLITE_NO_PUBLIC_ROUTE','status':'FAILED','cases':CASES,
            'production_listener_wired':False,'primary_terminal_evidence':False,'native_job_mutations':0}
    try:main();report['status']='PASS'
    except Exception as error:
        report['error_type']=type(error).__name__
        if isinstance(error,RuntimeError) and str(error).startswith('CHECK_FAILED:'):
            report['failed_case']=str(error).split(':',1)[1]
        trace=error.__traceback__
        while trace.tb_next:trace=trace.tb_next
        report['error_location']={'file':Path(trace.tb_frame.f_code.co_filename).name,'line':trace.tb_lineno}
    finally:Path(sys.argv[1]).write_text(json.dumps(report,indent=2)+'\n')
    raise SystemExit(0 if report['status']=='PASS' else 1)
