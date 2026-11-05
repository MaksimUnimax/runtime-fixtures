"""Guarded disposable tests for exact authority rename and stale-state invalidation."""
import io,json,os,secrets,subprocess,sys,uuid
from datetime import timedelta
from pathlib import Path
if not (os.environ.get('ALISA_STAFF_CORE_TEST_ALLOW')=='1' and os.environ.get('ALISA_ENV')=='dev'
        and os.environ.get('ALISA_DB_NAME') in {'alisa_s03_core_platform','alisa_s03_core_identity'}
        and os.environ.get('ALISA_DB_HOST')=='127.0.0.1' and os.environ.get('ALISA_DB_PORT')=='55480'):
    raise RuntimeError('Owned disposable canonical authority database required')
import django
django.setup()
from django.conf import settings
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone
CASES=[]
def check(name,ok):
    if not ok:raise RuntimeError('CHECK_FAILED:'+name)
    CASES.append({'case':name,'passed':True})
def denied(command,**kwargs):
    try:call_command(command,apply=True,stdout=io.StringIO(),**kwargs);return False
    except CommandError:return True
def configs(identity):
    base={**os.environ,'ALISA_ENV':'stage','ALISA_CANONICAL_AUTH_ENABLED':'1','ALISA_CANONICAL_SITE_ENABLED':'1',
          'ALISA_IDENTITY_ISSUER':'https://id.octoport.ru','ALISA_STAFF_OIDC_CLIENT_ID':'alisa_admin_stage',
          'ALISA_STAFF_OIDC_REDIRECT_URI':'https://alisa-admin.octoport.ru/auth/callback'}
    def loads(changes):
        r=subprocess.run([sys.executable,'-c','import django;django.setup()'],env={**base,**changes},capture_output=True,timeout=10)
        return r.returncode==0
    prefix='canonical_identity_' if identity else 'canonical_platform_'
    for name,changes,expected in [
        ('strict_positive',{},True),
        ('new_issuer_requires_flag',{'ALISA_CANONICAL_AUTH_ENABLED':'0'},False),
        ('old_issuer_refused_in_canonical_mode',{'ALISA_IDENTITY_ISSUER':'https://id-stage.octoport.ru'},False),
        ('invalid_flag_refused',{'ALISA_CANONICAL_AUTH_ENABLED':'yes'},False),
        ('arbitrary_issuer_refused',{'ALISA_IDENTITY_ISSUER':'https://id.octoport.ru.attacker.test'},False),
        ('prod_closed',{'ALISA_ENV':'prod'},False),
        ('dev_not_broadened',{'ALISA_ENV':'dev'},False)]:
        check(prefix+name,loads(changes)==expected)
    if identity:check(prefix+'mixed_staff_callback_refused',not loads({'ALISA_STAFF_OIDC_REDIRECT_URI':'https://alisa-admin-stage.octoport.ru/auth/callback'}))
def identity_checks():
    from allauth.idp.oidc.models import Client,Token
    from allauth.mfa.models import Authenticator
    from django.contrib.sessions.models import Session
    from octoport_identity.accounts.models import Person,Subject,ProtocolCache,IdentityMail
    old='https://alisa-admin-stage.octoport.ru/auth/callback';new='https://alisa-admin.octoport.ru/auth/callback'
    client=Client.objects.create(id='alisa_admin_stage',type=Client.Type.CONFIDENTIAL,secret='synthetic-hashed-secret',redirect_uris=old)
    person=Person.objects.create_user(username=uuid.uuid4().hex,email='canonical-owner@example.invalid')
    Subject.objects.create(person=person,client=client)
    before_people=list(Person.objects.values_list('id','email').order_by('id'))
    before_subjects=list(Subject.objects.values_list('id','person_id','client_id').order_by('id'))
    before_factors=list(Authenticator.objects.values_list('id','user_id','type','data').order_by('id'))
    expiry=timezone.now()+timedelta(hours=1)
    for kind in [Token.Type.ACCESS_TOKEN,Token.Type.REFRESH_TOKEN,Token.Type.AUTHORIZATION_CODE]:
        Token.objects.create(type=kind,hash=secrets.token_hex(32),client=client,user=person,expires_at=expiry)
    ProtocolCache.objects.update_or_create(cache_key='canonical-old-code',defaults={'value':'synthetic-encrypted-code','expires':expiry})
    Session.objects.create(session_key=secrets.token_hex(16),session_data='synthetic-session',expire_date=expiry)
    mail=IdentityMail.objects.create(recipient=person.email,encrypted_payload='synthetic-encrypted-code',expires_at=expiry)
    flags={'ALISA_ENV':'stage','CANONICAL_AUTH_ENABLED':True,'IDENTITY_ISSUER':'https://id.octoport.ru',
           'IDENTITY_STAFF_CLIENT_ID':client.pk,'IDENTITY_STAFF_CALLBACK':new}
    with override_settings(**flags):
        with override_settings(CANONICAL_AUTH_ENABLED=False):
            check('canonical_identity_disabled_command_denied',denied('canonicalize_staff_callback') and Token.objects.exists())
        client.redirect_uris=old+'\nhttps://attacker.test/auth/callback';client.save(update_fields=['redirect_uris'])
        check('canonical_identity_unknown_callback_refuses_without_clearing_tokens',denied('canonicalize_staff_callback') and Token.objects.exists())
        client.redirect_uris=old;client.save(update_fields=['redirect_uris'])
        call_command('canonicalize_staff_callback',apply=True,stdout=io.StringIO())
        client.refresh_from_db();mail.refresh_from_db()
        check('canonical_identity_same_confidential_client_and_secret',client.pk=='alisa_admin_stage' and client.type==Client.Type.CONFIDENTIAL and client.secret=='synthetic-hashed-secret' and client.redirect_uris==new)
        check('canonical_identity_native_codes_tokens_sessions_invalidated',not Token.objects.exists() and not ProtocolCache.objects.exists() and not Session.objects.exists())
        check('canonical_identity_pending_mail_code_erased_without_replay',mail.encrypted_payload=='' and mail.expires_at<=timezone.now() and mail.error_code=='AUTHORITY_DOMAIN_CHANGED')
        check('canonical_identity_people_subjects_factors_preserved',
              before_people==list(Person.objects.values_list('id','email').order_by('id'))
              and before_subjects==list(Subject.objects.values_list('id','person_id','client_id').order_by('id'))
              and before_factors==list(Authenticator.objects.values_list('id','user_id','type','data').order_by('id')))
        fresh=Token.objects.create(type=Token.Type.ACCESS_TOKEN,hash=secrets.token_hex(32),client=client,user=person,expires_at=expiry)
        output=io.StringIO();call_command('canonicalize_staff_callback',apply=True,stdout=output)
        check('canonical_identity_repeat_noop_preserves_new_tokens','ALREADY_APPLIED' in output.getvalue() and Token.objects.filter(pk=fresh.pk).exists())
def platform_checks():
    from alisa_platform.accounts.models import Customer,Tenant,Membership,IdentityLink,AuthFlow,WebSession
    from alisa_platform.staff.models import StaffMember,StaffSession,StaffAuthFlow,StaffAuditEvent
    from alisa_platform.staff.policy import PRODUCT
    old='https://id-stage.octoport.ru';new='https://id.octoport.ru'
    StaffMember.objects.filter(product_id=PRODUCT).update(issuer=old,client_id='alisa_admin_stage')
    customer=Customer.objects.create(email='canonical-customer@example.invalid')
    tenant=Tenant.objects.create();Membership.objects.create(customer=customer,tenant=tenant)
    link=IdentityLink.objects.create(customer=customer,issuer=old,client_id='alisa_market_stage',subject=str(uuid.uuid4()))
    owner=StaffMember.objects.get(product_id=PRODUCT,role='OWNER',active=True)
    members=list(StaffMember.objects.filter(product_id=PRODUCT,issuer=old,client_id='alisa_admin_stage').order_by('id').values())
    foreign=list(StaffMember.objects.exclude(product_id=PRODUCT).order_by('id').values())
    expiry=timezone.now()+timedelta(minutes=10)
    f=AuthFlow.objects.create(secret_hash=secrets.token_hex(32),encrypted_payload='synthetic-flow',expires_at=expiry)
    WebSession.objects.create(customer=customer,tenant=tenant,flow=f,token_hash=secrets.token_hex(32),encrypted_payload='synthetic-web-session',security_revision=1,expires_at=expiry)
    sf=StaffAuthFlow.objects.create(secret_hash=secrets.token_hex(32),encrypted_payload='synthetic-staff-flow',expires_at=expiry)
    StaffSession.objects.create(member=owner,flow=sf,token_hash=secrets.token_hex(32),revision=owner.revision,mfa_verified_at=timezone.now(),mfa_type='totp',encrypted_payload='synthetic-staff-session',expires_at=expiry)
    stable={m.__name__:list(m.objects.order_by('pk').values()) for m in [Customer,Tenant,Membership]}
    arguments={'expected_links':1,'expected_staff':len(members),'expected_owner_id':str(owner.pk),'expected_owner_revision':owner.revision}
    flags={'ALISA_ENV':'stage','CANONICAL_AUTH_ENABLED':True,'IDENTITY_ISSUER':new,'STAFF_CLIENT_ID':'alisa_admin_stage','OIDC_CLIENT_ID':'alisa_market_stage'}
    with override_settings(**flags):
        from alisa_platform.staff.management.commands.canonicalize_identity_issuer import binding_fingerprint
        arguments['expected_state']=binding_fingerprint(old)
        check('canonical_platform_stale_owner_revision_refused',denied('canonicalize_identity_issuer',**{**arguments,'expected_owner_revision':owner.revision+1}) and IdentityLink.objects.get(pk=link.pk).issuer==old)
        collision=IdentityLink.objects.create(customer=customer,issuer=new,client_id='alisa_market_stage',subject=link.subject)
        check('canonical_platform_target_collision_refuses_without_merge',denied('canonicalize_identity_issuer',**arguments) and IdentityLink.objects.get(pk=link.pk).issuer==old)
        collision.delete()
        call_command('canonicalize_identity_issuer',apply=True,stdout=io.StringIO(),**arguments)
        link.refresh_from_db();owner.refresh_from_db()
        check('canonical_platform_customer_tenant_and_pairwise_subject_preserved',link.issuer==new and link.customer_id==customer.pk
              and stable=={m.__name__:list(m.objects.order_by('pk').values()) for m in [Customer,Tenant,Membership]})
        after=list(StaffMember.objects.filter(product_id=PRODUCT,issuer=new,client_id='alisa_admin_stage').order_by('id').values())
        check('canonical_platform_roles_permissions_ids_preserved',len(after)==len(members) and all(
              all(row[k]==before[k] for k in before if k not in {'issuer','revision'})
              and row['revision']==before['revision']+1 for before,row in zip(members,after)))
        check('canonical_platform_foreign_product_untouched',foreign==list(StaffMember.objects.exclude(product_id=PRODUCT).order_by('id').values()))
        check('canonical_platform_stale_product_flows_sessions_erased',not AuthFlow.objects.filter(encrypted_payload__gt='').exists()
              and not WebSession.objects.filter(revoked_at__isnull=True).exists()
              and not StaffAuthFlow.objects.filter(product_id=PRODUCT,encrypted_payload__gt='').exists()
              and not StaffSession.objects.filter(member__product_id=PRODUCT,revoked_at__isnull=True).exists())
        check('canonical_platform_one_owner_and_safe_audit',StaffMember.objects.filter(product_id=PRODUCT,role='OWNER',active=True).count()==1
              and StaffAuditEvent.objects.filter(action='staff.issuer_migrated').count()==len(members))
        output=io.StringIO();call_command('canonicalize_identity_issuer',apply=True,stdout=output,**arguments)
        check('canonical_platform_identical_repeat_noop','ALREADY_APPLIED' in output.getvalue()
              and StaffMember.objects.get(pk=owner.pk).revision==owner.revision)
        StaffMember.objects.filter(pk=owner.pk).update(name='Changed after migration')
        check('canonical_platform_changed_composition_cannot_replay',denied('canonicalize_identity_issuer',**arguments))
if __name__=='__main__':
    record={'scope':'DISPOSABLE_CANONICAL_AUTHORITY_CUTOVER','status':'FAILED','cases':CASES}
    try:
        identity=os.environ['ALISA_DB_NAME'].endswith('_identity');configs(identity)
        (identity_checks if identity else platform_checks)()
        record['status']='PASS'
    except Exception as exc:
        record['error_type']=type(exc).__name__;trace=exc.__traceback__
        while trace.tb_next:trace=trace.tb_next
        record['error_location']={'file':Path(trace.tb_frame.f_code.co_filename).name,'line':trace.tb_lineno}
        if str(exc).startswith('CHECK_FAILED:'):record['failed_case']=str(exc).split(':',1)[1]
    finally:Path(sys.argv[1]).write_text(json.dumps(record,indent=2)+'\n')
    sys.exit(0 if record['status']=='PASS' else 1)
