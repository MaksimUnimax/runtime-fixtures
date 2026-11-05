"""Actual runtime account policies, only inside the owned disposable CI database."""
import json,os,re,sys,time,uuid
import ssl,urllib.request,urllib.error
from urllib.parse import urlencode
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch

if not (os.environ.get('ALISA_IDENTITY_POLICY_TEST_ALLOW')=='1' and os.environ.get('ALISA_ENV')=='dev'
        and os.environ.get('ALISA_DB_HOST')=='127.0.0.1' and os.environ.get('ALISA_DB_PORT')=='55480'
        and os.environ.get('ALISA_DB_NAME')=='alisa_stage_identity'):
    raise RuntimeError('Owned disposable identity database required')

import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.sessions.models import Session
from django.core import signing
from django.db import connections
from django.test import Client
from django.urls import reverse
from allauth.account.models import EmailAddress
from octoport_identity.accounts.models import IdentityMail
from octoport_identity.protocol.storage import open_sealed

cases=[];private_values=[]
def check(name,ok):
    if not ok:raise RuntimeError('CHECK_FAILED:'+name)
    cases.append({'case':name,'passed':True})
def browser():return Client(enforce_csrf_checks=True,HTTP_HOST='localhost:19443')
def post(b,path,data,key=None):
    cookie=b.cookies.get(settings.CSRF_COOKIE_NAME)
    return b.post(path,data,secure=True,HTTP_ORIGIN=settings.IDENTITY_ISSUER,HTTP_X_CSRFTOKEN=cookie.value if cookie else '',HTTP_IDEMPOTENCY_KEY=key or '')
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args):return None
def network_verify(b,value,key):
    """Actual TLS HTTP requests to the two real Gunicorn workers."""
    tls=ssl.create_default_context(cafile=os.environ['ALISA_TEST_CA_FILE'])
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=tls),NoRedirect())
    cookie='; '.join(k+'='+v.value for k,v in b.cookies.items())
    csrf=b.cookies[settings.CSRF_COOKIE_NAME].value
    req=urllib.request.Request(settings.IDENTITY_ISSUER+reverse('account_confirm_login_code'),data=urlencode({'code':value}).encode(),
        headers={'Content-Type':'application/x-www-form-urlencoded','Cookie':cookie,'X-CSRFToken':csrf,'Origin':settings.IDENTITY_ISSUER,'Idempotency-Key':key})
    try:response=opener.open(req,timeout=8)
    except urllib.error.HTTPError as exc:response=exc
    with response:
        status=response.status
        for header in response.headers.get_all('Set-Cookie',[]):b.cookies.load(header)
    return status
def code(b,email):
    path=reverse('account_request_login_code');b.get(path,secure=True)
    r=post(b,path,{'email':email})
    if r.status_code!=302:raise RuntimeError('Expected queued login-code redirect')
    row=IdentityMail.objects.get(pk=b.session['identity_mail_id'])
    match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',open_sealed(row.encrypted_payload)['body'])
    if not match:raise RuntimeError('Expected private code')
    b.get(reverse('account_confirm_login_code'),secure=True)
    private_values.extend([email,match.group(1)])
    return match.group(1)

def mail_policies():
    from datetime import timedelta
    from django.core.exceptions import ValidationError
    from django.test import override_settings
    from octoport_identity.protocol.adapter import AccountAdapter
    from octoport_identity.accounts.management.commands.identity_deliver import Command
    # Keep the parent's actual fixture outbox untouched by this isolated test batch.
    waiting=list(IdentityMail.objects.filter(sent_at__isnull=True).values_list('pk','lease_until'))
    IdentityMail.objects.filter(pk__in=[pk for pk,_ in waiting]).update(lease_until=django.utils.timezone.now()+timedelta(minutes=5))
    owned=[]
    def queued(**values):
        row=IdentityMail.objects.create(recipient='fixture@example.invalid',encrypted_payload='encrypted-test',
            expires_at=django.utils.timezone.now()+timedelta(minutes=10),**values)
        owned.append(row.pk);return row
    try:
        with override_settings(REAL_LOGIN_OPEN=False,REAL_LOGIN_RECIPIENTS={'invited@example.test'}):
            check('s02_real_mail_invited_contact_normalized',AccountAdapter().clean_email('Invited@Example.Test')=='invited@example.test')
            try:AccountAdapter().clean_email('other@example.test');denied=False
            except ValidationError:denied=True
            check('s02_real_mail_uninvited_contact_denied',denied)
        with override_settings(REAL_LOGIN_OPEN=False,REAL_LOGIN_RECIPIENTS=frozenset()):
            try:AccountAdapter().clean_email('invited@example.test');denied=False
            except ValidationError:denied=True
            check('s02_real_mail_off_by_default',denied)
        with override_settings(REAL_LOGIN_OPEN=True,REAL_LOGIN_RECIPIENTS=frozenset()):
            check('s02_open_registration_accepts_new_real_contact',AccountAdapter().clean_email('Fresh@Example.Test')=='fresh@example.test')
        with patch('octoport_identity.accounts.management.commands.identity_deliver.deliver_mail',return_value='DELIVERY_OUTCOME_UNKNOWN') as send:
            row=queued();Command().deliver();row.refresh_from_db();Command().deliver()
            check('s02_unknown_delivery_never_automatically_replayed',send.call_count==1 and row.attempts==5 and not row.encrypted_payload and row.error_code=='DELIVERY_OUTCOME_UNKNOWN')
        with patch('octoport_identity.accounts.management.commands.identity_deliver.deliver_mail',return_value='SENT') as send:
            row=queued(error_code='SENDING',lease_until=django.utils.timezone.now()-timedelta(seconds=1))
            Command().deliver();row.refresh_from_db()
            check('s02_abandoned_submission_fail_closed_without_resend',not send.called and row.error_code=='DELIVERY_OUTCOME_UNKNOWN' and not row.encrypted_payload)
        with patch('octoport_identity.accounts.management.commands.identity_deliver.deliver_mail',return_value='DELIVERY_UNAVAILABLE') as send:
            row=queued();Command().deliver();Command().deliver();row.refresh_from_db()
            check('s02_connection_failure_keeps_encrypted_code_and_backoff',send.call_count==1 and row.encrypted_payload and row.error_code=='DELIVERY_UNAVAILABLE')
        with patch('octoport_identity.accounts.management.commands.identity_deliver.deliver_mail',return_value='SENT') as send:
            IdentityMail.objects.filter(pk=row.pk).update(lease_until=None)
            Command().deliver();row.refresh_from_db();Command().deliver()
            check('s02_known_connection_recovery_once_and_private_payload_erased',send.call_count==1 and row.sent_at is not None and not row.encrypted_payload)
    finally:
        IdentityMail.objects.filter(pk__in=owned).delete()
        for pk,lease in waiting:IdentityMail.objects.filter(pk=pk).update(lease_until=lease)


def run():
    mail_policies()
    check('s02_runtime_code_ttl_600_and_five_attempts',settings.ACCOUNT_LOGIN_BY_CODE_TIMEOUT==600 and settings.ACCOUNT_EMAIL_VERIFICATION_BY_CODE_TIMEOUT==600 and settings.ACCOUNT_LOGIN_BY_CODE_MAX_ATTEMPTS==5)
    email='policy-'+uuid.uuid4().hex[:10]+'@example.invalid'
    person=get_user_model().objects.create_user(username=uuid.uuid4().hex,email=email)
    EmailAddress.objects.create(user=person,email=email,primary=True,verified=True)
    b=browser();value=code(b,email)
    raw=Session.objects.get(session_key=b.cookies[settings.SESSION_COOKIE_NAME].value).session_data
    try:
        signing.loads(raw,salt='django.contrib.sessions.SessionStore',serializer=signing.JSONSerializer)
        protected=False
    except (ValueError,UnicodeError):protected=True
    check('s02_identity_session_encrypted_in_database',protected)
    with patch('time.time',return_value=time.time()+601):post(b,reverse('account_confirm_login_code'),{'code':value})
    check('s02_expired_email_code_denied','_auth_user_id' not in b.session)
    limited_email='limited-'+uuid.uuid4().hex[:10]+'@example.invalid'
    limited_person=get_user_model().objects.create_user(username=uuid.uuid4().hex,email=limited_email)
    EmailAddress.objects.create(user=limited_person,email=limited_email,primary=True,verified=True)
    limited=browser();valid=code(limited,limited_email);wrong='AAAA-AAAA' if valid!='AAAA-AAAA' else 'BBBB-BBBB'
    for _ in range(5):post(limited,reverse('account_confirm_login_code'),{'code':wrong})
    post(limited,reverse('account_confirm_login_code'),{'code':valid})
    check('s02_five_invalid_codes_exhaust_attempts','_auth_user_id' not in limited.session)
    email='concurrent-'+uuid.uuid4().hex[:10]+'@example.invalid'
    person=get_user_model().objects.create_user(username=uuid.uuid4().hex,email=email)
    EmailAddress.objects.create(user=person,email=email,primary=True,verified=True)
    concurrent=browser();valid=code(concurrent,email);cookie=concurrent.cookies.output(header='',sep=';').strip()
    # Independent HTTP middleware/session instances share only the original browser cookie.
    def redeem(index):
        other=browser();other.cookies.load(cookie)
        try:
            key='owned-policy-verify-'+str(index)
            network_verify(other,valid,key)
            return (other,key) if other.session.get('_auth_user_id')==str(person.pk) else None
        finally:connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(redeem,range(2)))
    check('s02_runtime_email_code_atomic_across_requests',sum(r is not None for r in results)==1)
    winner,key=next(r for r in results if r is not None);session_key=winner.cookies[settings.SESSION_COOKIE_NAME].value
    replay=network_verify(winner,valid,key)
    check('s02_verify_retry_safe_receipt_same_identity_session',replay in [302,409] and winner.cookies[settings.SESSION_COOKIE_NAME].value==session_key and winner.session.get('_auth_user_id')==str(person.pk))
    stale=browser();stale.cookies.load(cookie);network_verify(stale,valid,key)
    check('s02_used_code_old_browser_cookie_denied','_auth_user_id' not in stale.session)
    known=browser();unknown=browser();path=reverse('account_request_login_code')
    known.get(path,secure=True);unknown.get(path,secure=True)
    a=post(known,path,{'email':email});b=post(unknown,path,{'email':'unknown-'+uuid.uuid4().hex+'@example.invalid'})
    check('s02_known_unknown_code_request_same_response',(a.status_code,a.get('Location'))==(b.status_code,b.get('Location')))
    from allauth.mfa.totp.internal.auth import TOTP,generate_totp_secret,hotp_value,format_hotp_value
    factor_secret=generate_totp_secret();factor=TOTP.activate(person,factor_secret)
    factor_code=format_hotp_value(hotp_value(factor_secret,int(time.time())//30))
    private_values.extend([factor_secret,factor_code])
    check('s02_mfa_secret_encrypted_and_factor_one_use',factor_secret not in json.dumps(factor.instance.data) and factor.validate_code(factor_code) and not factor.validate_code(factor_code))
    # Parent exercises outage and delivery using this queued encrypted message.
    IdentityMail.objects.filter(sent_at__isnull=True).exclude(pk=known.session.get('identity_mail_id')).delete()

result={'scope':'ACTUAL_RUNTIME_POLICIES_DISPOSABLE_ONLY','cases':cases}
try:run();result['status']='PASS'
except Exception as exc:
    result['status']='FAILED';result['error_type']=type(exc).__name__
    if isinstance(exc,RuntimeError) and str(exc).startswith('CHECK_FAILED:'):result['failed_case']=str(exc).split(':',1)[1]
finally:
    Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n')
    if len(sys.argv)>2:
        private=Path(sys.argv[2]);private.write_text(json.dumps(private_values));private.chmod(0o600)
    connections.close_all()
sys.exit(0 if result['status']=='PASS' else 1)
