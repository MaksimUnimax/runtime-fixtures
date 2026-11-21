"""S04 real PostgreSQL policies with synthetic trusted-BFF fixtures, not native OIDC."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from unittest.mock import patch
import django
django.setup()
from django.conf import settings
from django.db import connection, connections, transaction, DatabaseError
from django.test import Client
from django.utils import timezone
from alisa_platform.accounts.models import Customer,Tenant,Membership,AuthFlow,WebSession
from alisa_platform.staff.models import StaffMember,StaffSession,StaffAuthFlow,StaffAuditEvent
from alisa_platform.staff.service import assign_admin,revoke_staff
from alisa_platform.entitlements.models import AccessGrant,AccessAdjustment,AccessNotification,AccessBatch,AccessBatchItem,AccessCommand
from alisa_platform.entitlements import service

record={'scope':'S04_POSTGRES_BACKEND_NOT_NATIVE_OIDC_NOT_INSTALLED','status':'FAILED','cases':[]}
def check(name, condition):
    record['cases'].append({'case':name,'passed':bool(condition)})
    if not condition:raise RuntimeError('CHECK_FAILED:'+name)
def fresh_member(member):
    token=secrets.token_urlsafe(32);now=timezone.now()
    flow=StaffAuthFlow.objects.create(secret_hash=secrets.token_hex(32),encrypted_payload='',expires_at=now+timedelta(minutes=10),consumed_at=now)
    StaffSession.objects.create(token_hash=hashlib.sha256(token.encode()).hexdigest(),member=member,flow=flow,revision=member.revision,mfa_verified_at=now,mfa_type='totp',encrypted_payload='synthetic-protected-fixture',expires_at=now+timedelta(hours=1))
    return token
def customer():
    row=Customer.objects.create(email='access-'+uuid.uuid4().hex+'@example.invalid');tenant=Tenant.objects.create();Membership.objects.create(customer=row,tenant=tenant);return row,tenant
def gift(ids,days=7,source='GIFT',notify=True):return {'customer_ids':[str(i) for i in ids],'days':days,'source':source,'reason':'PILOT_ACCESS','comment':'Synthetic qualification','notify':notify,'policy':'AFTER_LAST_SCHEDULED'}
def api(token,action,**body):
    response=Client().post('/api/v1/staff/access',data=json.dumps({'session_token':token,'action':action,**body}),content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.STAFF_SERVICE_TOKEN,HTTP_HOST='127.0.0.1')
    return response.status_code,response.json()
def preview(token,ids,**kw):
    code,data=api(token,'preview',gift=gift(ids,**kw));assert code==201;return data['preview_id']
def execute(token,p,b=None,c=None,limit=5):
    b=b or str(uuid.uuid4());c=c or str(uuid.uuid4());code,data=api(token,'execute',command_id=c,batch_id=b,preview_id=p,limit=limit);return code,data,b,c

try:
    assert os.environ.get('ALISA_ACCESS_CORE_TEST_ALLOW')=='1' and settings.DATABASES['default']['NAME']=='alisa_s04_core_platform'
    owner=StaffMember.objects.create(issuer=settings.IDENTITY_ISSUER,client_id=settings.STAFF_CLIENT_ID,subject=str(uuid.uuid4()),name='Synthetic Owner',role='OWNER')
    token=fresh_member(owner)
    a,ta=customer();b,tb=customer();c,tc=customer()
    p=preview(token,[a.pk]);key,batch=str(uuid.uuid4()),str(uuid.uuid4())
    def simultaneous():
        try:return execute(token,p,batch,key,1)[:2]
        finally:connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(lambda _:simultaneous(),range(2)))
    check('concurrent_same_command_same_response_one_grant',responses[0]==responses[1] and responses[0][0]==200 and AccessGrant.objects.filter(tenant=ta).count()==1)
    g=AccessGrant.objects.get(tenant=ta)
    check('seven_days_exact_and_frozen_preview_boundaries',(g.ends_at-g.starts_at).total_seconds()==604800 and responses[0][1]['items'][0]['starts_at']==g.starts_at.isoformat())
    check('gift_is_not_payment',g.source=='GIFT' and not hasattr(a,'paid'))
    check('notification_atomic_and_not_duplicated',AccessNotification.objects.filter(grant=g).count()==1)
    code,data,_,_=execute(token,p,batch,key,2)
    check('same_key_changed_limit_conflict',code==409 and data['code']=='IDEMPOTENCY_CONFLICT')
    check('rejected_replay_audit_attributable',StaffAuditEvent.objects.filter(action='access.rejected',actor_id=owner.pk,target_id=key).exists())
    code,_,_,_=execute(token,p)
    check('same_preview_cannot_issue_second_batch',code==409 and AccessGrant.objects.filter(tenant=ta).count()==1)
    check('current_and_exact_end_expiration',service.snapshot(ta.pk,now=g.starts_at)['status']=='ACTIVE' and service.snapshot(ta.pk,now=g.ends_at)['status']=='EXPIRED')
    p2=preview(token,[a.pk],source='COMPENSATION');code,_,_,_=execute(token,p2)
    grants=list(AccessGrant.objects.filter(tenant=ta).order_by('starts_at'))
    check('compensation_appended_without_overlap',code==200 and grants[1].starts_at==g.ends_at and grants[1].source=='COMPENSATION')
    # Chosen future grant only; original dates and the other interval survive.
    future=grants[1];code,rp=api(token,'revoke_preview',customer_id=str(a.pk),grant_id=str(future.pk),notify=True)
    revoke_key=str(uuid.uuid4());code,rv=api(token,'revoke',command_id=revoke_key,preview_id=rp['preview_id'])
    again=api(token,'revoke',command_id=revoke_key,preview_id=rp['preview_id'])
    check('future_tail_revoke_idempotent_original_history_intact',code==200 and again==(code,rv) and AccessAdjustment.objects.filter(grant=future).count()==1 and AccessGrant.objects.get(pk=future.pk).ends_at==future.ends_at and service.effective_end(AccessGrant.objects.prefetch_related('adjustments').get(pk=g.pk))==g.ends_at)
    # Revoke current tail at the displayed preview cutoff, never before its start.
    code,rp=api(token,'revoke_preview',customer_id=str(a.pk),grant_id=str(g.pk),notify=False)
    confirm_time=timezone.now()+timedelta(seconds=20)
    with patch('django.utils.timezone.now',return_value=confirm_time):
        code,rv=api(token,'revoke',command_id=str(uuid.uuid4()),preview_id=rp['preview_id'])
    check('current_revoke_only_unused_tail',code==200 and service.parse_time(rv['cutoff'])>=confirm_time and service.parse_time(rv['cutoff'])<g.ends_at)
    foreign=AccessGrant.objects.create(product_id='synthetic_other',tenant=tb,source='GIFT',source_id=uuid.uuid4(),days=40,starts_at=timezone.now(),ends_at=timezone.now()+timedelta(days=40),actor_id=owner.pk,reason='PILOT_ACCESS')
    check('other_product_does_not_provision_alisa',service.snapshot(tb.pk)['status']=='NOT_PROVISIONED')
    pay=AccessGrant.objects.create(tenant=tb,source='PAYMENT',source_id=uuid.uuid4(),days=1,starts_at=timezone.now(),ends_at=timezone.now()+timedelta(days=1),actor_id=owner.pk,reason='SYNTHETIC_PAYMENT_FIXTURE')
    check('payment_and_other_product_cannot_be_revoked',all(api(token,'revoke_preview',customer_id=str(b.pk),grant_id=str(x.pk),notify=False)[0]==409 for x in [pay,foreign]))
    stale=preview(token,[c.pk]);other=preview(token,[c.pk]);execute(token,other)
    code,result,_,_=execute(token,stale)
    check('revision_conflict_not_second_grant',result['items'][0]['outcome']=='REVISION_CONFLICT' and AccessGrant.objects.filter(tenant=tc).count()==1)
    # Interrupt one HTTP step after its first committed item; same command resumes
    # only the fixed reserved rows, then becomes a stable response receipt.
    recipients=[customer() for _ in range(3)];p=preview(token,[r[0].pk for r in recipients]);cmd,bid=str(uuid.uuid4()),str(uuid.uuid4());original=service.apply_item;count=[0]
    def interrupted(*args):
        count[0]+=1
        if count[0]==2:raise RuntimeError('SYNTHETIC_PROCESS_INTERRUPTION')
        return original(*args)
    try:
        with patch.object(service,'apply_item',side_effect=interrupted):service.execute(token,cmd,bid,p,3)
    except RuntimeError:pass
    check('partial_crash_commits_only_first_row',AccessGrant.objects.filter(tenant__in=[r[1] for r in recipients]).count()==1 and AccessCommand.objects.get(pk=cmd).result is None)
    first=execute(token,p,bid,cmd,3)[:2];second=execute(token,p,bid,cmd,3)[:2]
    check('partial_step_resumes_no_duplicate_and_replays_exactly',first==second and first[1]['state']=='COMPLETED' and AccessGrant.objects.filter(tenant__in=[r[1] for r in recipients]).count()==3)
    many=[customer() for _ in range(6)];p=preview(token,[r[0].pk for r in many]);_,result,bid,cmd=execute(token,p,limit=5)
    check('more_than_five_has_explicit_continuation_contract',result['state']=='PARTIAL' and result['can_continue'] and sum(i['state']=='APPLIED' for i in result['items'])==5 and all(i['customer_name'] for i in result['items']))
    check('completed_step_response_never_references_itself_as_unfinished',not any(i['command_id']==cmd for i in result['unfinished_commands']))
    replay=execute(token,p,bid,cmd,5)[1]
    check('replay_does_not_advance_next_chunk',replay==result and AccessGrant.objects.filter(tenant__in=[r[1] for r in many]).count()==5)
    _,done,_,_=execute(token,p,bid,limit=5)
    check('new_explicit_step_finishes_six_recipient_batch',done['state']=='COMPLETED' and AccessGrant.objects.filter(tenant__in=[r[1] for r in many]).count()==6)
    admin_sub=str(uuid.uuid4());out,status=assign_admin(token,admin_sub,'Synthetic Limited',['users.read','access.grant'],'OWNER_ASSIGNMENT');admin=StaffMember.objects.get(pk=out['staff_id']);at=fresh_member(admin)
    code,_=api(at,'preview',gift=gift([c.pk],31));check('ordinary_admin_thirty_day_ceiling',code==422)
    left=[customer() for _ in range(3)];p=preview(at,[r[0].pk for r in left]);_,part,bid,_=execute(at,p,limit=1)
    code,other_actor=api(token,'batch',batch_id=bid)
    check('owner_can_repreview_other_active_actor_pending_rows',not other_actor['can_continue'] and other_actor['recoverable_by_owner'] and len([i for i in other_actor['items'] if i['state']=='PENDING'])==2)
    revoke_staff(token,str(admin.pk),admin.revision,'STAFF_REVOCATION')
    check('revoked_staff_cannot_continue_bulk',execute(at,p,bid,limit=1)[0]==403)
    out,status=assign_admin(token,admin_sub,'Synthetic Limited',['users.read','access.grant'],'OWNER_ASSIGNMENT');admin.refresh_from_db();at2=fresh_member(admin)
    check('new_session_after_reassignment_does_not_revive_old_batch',execute(at2,p,bid,limit=1)[0]==403)
    code,blocked=api(token,'batch',batch_id=bid)
    pending=[i['customer_id'] for i in blocked['items'] if i['state']!='APPLIED']
    check('owner_sees_blocked_fixed_rows_for_safe_recovery',code==200 and blocked['state']=='BLOCKED' and len(pending)==2)
    pp=preview(token,pending);execute(token,pp)
    check('fresh_preview_recovers_only_unapplied_customers',AccessGrant.objects.filter(tenant__in=[r[1] for r in left]).count()==3)
    for extra in [{'product_id':'other'},{'tenant_id':str(tb.pk)}]:
        check('untrusted_scope_'+next(iter(extra))+'_rejected',api(token,'customer',customer_id=str(a.pk),**extra)[0]==422)
    out,status=assign_admin(token,str(uuid.uuid4()),'Synthetic Grant Only',['access.grant'],'OWNER_ASSIGNMENT')
    grant_only=fresh_member(StaffMember.objects.get(pk=out['staff_id']))
    check('grant_permission_without_customer_read_cannot_disclose_recipient',api(grant_only,'customer',customer_id=str(a.pk))[0]==403 and api(grant_only,'batches')[0]==403)
    # Actual runtime SQL privilege denial, independently of model methods.
    for table in ['entitlements_accessgrant','entitlements_accessadjustment','entitlements_accesspreview']:
        denied=False
        try:
            with transaction.atomic():
                with connection.cursor() as cur:cur.execute('DELETE FROM '+table+' WHERE false')
        except DatabaseError:denied=True
        check(table+'_runtime_append_only_acl',denied)
    # Customer endpoint ignores any client-provided target and returns own data.
    wt=secrets.token_urlsafe(32);now=timezone.now();flow=AuthFlow.objects.create(secret_hash=secrets.token_hex(32),encrypted_payload='',expires_at=now+timedelta(minutes=10),consumed_at=now)
    WebSession.objects.create(token_hash=hashlib.sha256(wt.encode()).hexdigest(),customer=c,tenant=tc,flow=flow,encrypted_payload='synthetic-protected-fixture',security_revision=c.security_revision,expires_at=now+timedelta(hours=1))
    def account(**data):return Client().post('/api/v1/account/access',data=json.dumps({'session_token':wt,**data}),content_type='application/json',HTTP_AUTHORIZATION='Bearer '+settings.AUTH_SERVICE_TOKEN,HTTP_HOST='127.0.0.1')
    response=account();check('customer_sees_own_actual_grant_only',response.status_code==200 and len(response.json()['access']['history'])==1 and response.json()['access']['history'][0]['id']==str(AccessGrant.objects.get(tenant=tc).pk))
    check('customer_cannot_select_another_tenant',account(tenant_id=str(ta.pk)).status_code==422)
    with patch.object(settings,'STAFF_ENABLED',False):check('staff_disable_preserves_customer_access',account().status_code==200)
    with patch.object(settings,'ENTITLEMENTS_ENABLED',False):check('capability_can_close_without_schema_down',account().status_code==404)
    record['status']='PASS'
except Exception as exc:
    record['error_type']=type(exc).__name__
    tb=exc.__traceback__
    while tb:
        if Path(tb.tb_frame.f_code.co_filename).name=='access_backend_checks.py':record['error_line']=tb.tb_lineno
        tb=tb.tb_next
finally:
    Path(sys.argv[1]).write_text(json.dumps(record,indent=2)+'\n')
sys.exit(0 if record['status']=='PASS' else 1)
