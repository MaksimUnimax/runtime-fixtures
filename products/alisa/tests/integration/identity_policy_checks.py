"""Actual runtime account policies, only inside the owned disposable CI database."""
import json,os,re,sys,time,uuid
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

cases=[]
def check(name,ok):
    if not ok:raise RuntimeError('CHECK_FAILED:'+name)
    cases.append({'case':name,'passed':True})
def browser():return Client(enforce_csrf_checks=True,HTTP_HOST='localhost:19443')
def post(b,path,data,key=None):
    cookie=b.cookies.get(settings.CSRF_COOKIE_NAME)
    return b.post(path,data,secure=True,HTTP_ORIGIN=settings.IDENTITY_ISSUER,HTTP_X_CSRFTOKEN=cookie.value if cookie else '',HTTP_IDEMPOTENCY_KEY=key or '')
def code(b,email):
    path=reverse('account_request_login_code');b.get(path,secure=True)
    r=post(b,path,{'email':email})
    if r.status_code!=302:raise RuntimeError('Expected queued login-code redirect')
    row=IdentityMail.objects.get(pk=b.session['identity_mail_id'])
    match=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',open_sealed(row.encrypted_payload)['body'])
    if not match:raise RuntimeError('Expected private code')
    b.get(reverse('account_confirm_login_code'),secure=True)
    return match.group(1)

def run():
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
    limited=browser();valid=code(limited,email);wrong='AAAA-AAAA' if valid!='AAAA-AAAA' else 'BBBB-BBBB'
    for _ in range(5):post(limited,reverse('account_confirm_login_code'),{'code':wrong})
    post(limited,reverse('account_confirm_login_code'),{'code':valid})
    check('s02_five_invalid_codes_exhaust_attempts','_auth_user_id' not in limited.session)
    concurrent=browser();valid=code(concurrent,email);cookie=concurrent.cookies.output(header='',sep=';').strip()
    # Independent HTTP middleware/session instances share only the original browser cookie.
    def redeem(index):
        other=browser();other.cookies.load(cookie)
        try:
            key='owned-policy-verify-'+str(index)
            post(other,reverse('account_confirm_login_code'),{'code':valid},key)
            return (other,key) if other.session.get('_auth_user_id')==str(person.pk) else None
        finally:connections.close_all()
    with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(redeem,range(2)))
    check('s02_runtime_email_code_atomic_across_requests',sum(r is not None for r in results)==1)
    winner,key=next(r for r in results if r is not None);session_key=winner.cookies[settings.SESSION_COOKIE_NAME].value
    replay=post(winner,reverse('account_confirm_login_code'),{'code':valid},key)
    check('s02_verify_retry_safe_receipt_same_identity_session',replay.status_code in [302,409] and winner.cookies[settings.SESSION_COOKIE_NAME].value==session_key and winner.session.get('_auth_user_id')==str(person.pk))
    stale=browser();stale.cookies.load(cookie);post(stale,reverse('account_confirm_login_code'),{'code':valid},key)
    check('s02_used_code_old_browser_cookie_denied','_auth_user_id' not in stale.session)
    known=browser();unknown=browser();path=reverse('account_request_login_code')
    known.get(path,secure=True);unknown.get(path,secure=True)
    a=post(known,path,{'email':email});b=post(unknown,path,{'email':'unknown-'+uuid.uuid4().hex+'@example.invalid'})
    check('s02_known_unknown_code_request_same_response',(a.status_code,a.get('Location'))==(b.status_code,b.get('Location')))
    # Parent exercises outage and delivery using this queued encrypted message.
    IdentityMail.objects.filter(sent_at__isnull=True).exclude(pk=known.session.get('identity_mail_id')).delete()

result={'scope':'ACTUAL_RUNTIME_POLICIES_DISPOSABLE_ONLY','cases':cases}
try:run();result['status']='PASS'
except Exception as exc:
    result['status']='FAILED';result['error_type']=type(exc).__name__
    if isinstance(exc,RuntimeError) and str(exc).startswith('CHECK_FAILED:'):result['failed_case']=str(exc).split(':',1)[1]
finally:Path(sys.argv[1]).write_text(json.dumps(result,indent=2)+'\n');connections.close_all()
sys.exit(0 if result['status']=='PASS' else 1)
