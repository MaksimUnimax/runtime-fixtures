"""Native customer credential regressions inside the owned staff-core DB."""
import base64
import hashlib
import os
import re
import secrets
import uuid
from urllib.parse import parse_qs, urlencode, urlsplit

from allauth.account.models import EmailAddress
from allauth.mfa.totp.internal.auth import TOTP, generate_totp_secret
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse
from octoport_identity.accounts.models import IdentityMail
from octoport_identity.protocol.customer import ACR, PROOF, customer_client, customer_target
from octoport_identity.protocol.storage import open_sealed


def run(check):
    if os.environ.get('ALISA_STAFF_CORE_TEST_ALLOW') != '1':
        raise RuntimeError('Owned disposable customer authority required')
    client = customer_client()
    check('customer_exact_registered_callback_selected',client is not None and client.id == 's03_web')
    password = secrets.token_urlsafe(24)
    person = get_user_model().objects.create_user(username=uuid.uuid4().hex,
        email='customer-'+uuid.uuid4().hex[:12]+'@example.invalid',password=password)
    EmailAddress.objects.create(user=person,email=person.email,primary=True,verified=True)
    TOTP.activate(person,generate_totp_secret())

    def browser():
        return Client(enforce_csrf_checks=True,HTTP_HOST=urlsplit(settings.IDENTITY_ISSUER).netloc)

    def post(b,path,data):
        return b.post(path,data,secure=True,HTTP_ORIGIN=settings.IDENTITY_ISSUER,
            HTTP_X_CSRFTOKEN=b.cookies[settings.CSRF_COOKIE_NAME].value)

    def target():
        verifier=secrets.token_urlsafe(48)
        values={'client_id':client.id,'redirect_uri':settings.IDENTITY_PRODUCT_ORIGIN+'/auth/callback',
            'response_type':'code','scope':'openid email','state':secrets.token_urlsafe(24),
            'nonce':secrets.token_urlsafe(24),'code_challenge_method':'S256',
            'code_challenge':base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()}
        return reverse('idp:oidc:authorization')+'?'+urlencode(values),verifier

    def letter(b):
        row=IdentityMail.objects.get(pk=b.session['identity_mail_id'])
        return re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',open_sealed(row.encrypted_payload)['body']).group(1)

    def password_step(b,return_to,user=person,pwd=password):
        path=reverse('account_login')+'?'+urlencode({'next':return_to})
        b.get(path,secure=True)
        return post(b,reverse('account_login'),{'login':user.email,'password':pwd,'next':return_to})

    def code_step(b,value):
        b.get(reverse('account_confirm_login_code'),secure=True)
        return post(b,reverse('account_confirm_login_code'),{'code':value})

    b=browser();url,verifier=target()
    before=IdentityMail.objects.filter(recipient=person.email).count()
    denied=password_step(b,url,pwd='incorrect-owned-test-password')
    check('customer_wrong_password_sends_no_code',denied.status_code==200
        and IdentityMail.objects.filter(recipient=person.email).count()==before
        and '_auth_user_id' not in b.session)
    response=password_step(b,url)
    check('customer_native_password_requires_email_even_with_totp',response.status_code==302
        and urlsplit(response['Location']).path==reverse('account_confirm_login_code')
        and '_auth_user_id' not in b.session)
    value=letter(b)
    invalid=code_step(b,'AAAA-AAAA' if value!='AAAA-AAAA' else 'BBBB-BBBB')
    check('customer_wrong_email_code_does_not_log_in',invalid.status_code==200
        and '_auth_user_id' not in b.session and PROOF not in b.session)
    response=code_step(b,value)
    check('customer_email_code_skips_enrolled_totp_only_for_cabinet',response.status_code==302
        and response['Location']==url and b.session.get('_auth_user_id')==str(person.pk)
        and PROOF in b.session)
    altered=url.replace('nonce=','nonce=changed')
    denied=b.get(altered,secure=True)
    check('customer_proof_bound_to_exact_nonce',denied.status_code==403)
    issued=b.get(url,secure=True)
    code=parse_qs(urlsplit(issued.get('Location','')).query).get('code',[None])[0]
    check('customer_actual_oauth_code_consumes_proof',issued.status_code==302 and bool(code) and PROOF not in b.session)
    basic='Basic '+base64.b64encode((client.id+':'+os.environ['ALISA_WEB_OIDC_CLIENT_SECRET']).encode()).decode()
    grant={'grant_type':'authorization_code','code':code,'redirect_uri':settings.IDENTITY_PRODUCT_ORIGIN+'/auth/callback','code_verifier':verifier}
    token=b.post(reverse('idp:oidc:token'),grant,secure=True,HTTP_AUTHORIZATION=basic)
    import jwt
    claims=jwt.decode(token.json()['id_token'],options={'verify_signature':False}) if token.status_code==200 else {}
    check('customer_native_signed_token_contains_both_factors',token.status_code==200
        and claims.get('acr')==ACR and claims.get('amr')==['pwd','email_otp'])
    check('customer_oauth_code_single_use',b.post(reverse('idp:oidc:token'),grant,secure=True,HTTP_AUTHORIZATION=basic).status_code==400)
    new_url,_=target()
    check('customer_existing_sso_cannot_issue_new_code',b.get(new_url,secure=True).status_code==403)
    check('customer_duplicate_parameter_not_customer_authorization',customer_target(new_url+'&nonce=duplicate') is None)
    check('customer_probe_callback_not_customer_authorization',customer_target(new_url.replace('%2Fauth%2Fcallback','%2Foidc-probe%2Fcallback')) is None)
    staff=reverse('idp:oidc:authorization')+'?'+urlencode({'client_id':settings.IDENTITY_STAFF_CLIENT_ID,
        'redirect_uri':settings.IDENTITY_STAFF_CALLBACK,'response_type':'code','scope':'openid email',
        'state':secrets.token_urlsafe(24),'nonce':secrets.token_urlsafe(24),
        'code_challenge_method':'S256','code_challenge':'x'*43})
    staff_response=b.get(staff,secure=True)
    check('customer_login_does_not_satisfy_admin_mfa',staff_response.status_code==302
        and '/accounts/2fa/' in staff_response.get('Location',''))

    only_code=browser();only_code.get(reverse('account_request_login_code'),secure=True)
    post(only_code,reverse('account_request_login_code'),{'email':person.email,'next':new_url})
    rejected=code_step(only_code,letter(only_code))
    check('customer_code_only_route_cannot_bypass_password',PROOF not in only_code.session
        and '_auth_user_id' not in only_code.session and 'code=' not in rejected.get('Location',''))

    legacy=get_user_model().objects.create_user(username=uuid.uuid4().hex,
        email='legacy-'+uuid.uuid4().hex[:12]+'@example.invalid')
    EmailAddress.objects.create(user=legacy,email=legacy.email,primary=True,verified=True)
    reset=browser();reset.get(reverse('account_reset_password'),secure=True)
    response=post(reset,reverse('account_reset_password'),{'email':legacy.email})
    reset_code=letter(reset)
    check('customer_legacy_passwordless_account_receives_reset_code',response.status_code==302 and not legacy.has_usable_password())
    reset.get(reverse('account_confirm_password_reset_code'),secure=True)
    post(reset,reverse('account_confirm_password_reset_code'),{'code':reset_code})
    reset.get(reverse('account_complete_password_reset'),secure=True)
    next_password=secrets.token_urlsafe(24)
    response=post(reset,reverse('account_complete_password_reset'),{'password1':next_password,'password2':next_password})
    legacy.refresh_from_db()
    check('customer_native_reset_sets_password_without_login',response.status_code==302
        and legacy.check_password(next_password) and '_auth_user_id' not in reset.session and PROOF not in reset.session)
    completed=reset.get(reverse('account_password_reset_completed'),secure=True)
    check('customer_reset_returns_to_cabinet_front_door',completed.status_code==200
        and (settings.IDENTITY_PRODUCT_ORIGIN+'/login').encode() in completed.content)
    legacy_url,_=target();response=password_step(reset,legacy_url,legacy,next_password)
    check('customer_reset_requires_fresh_login_email',response.status_code==302
        and urlsplit(response['Location']).path==reverse('account_confirm_login_code') and letter(reset)!=reset_code)
    signup=browser();signup_url,_=target()
    signup_path=reverse('account_signup')+'?'+urlencode({'next':signup_url})
    signup.get(signup_path,secure=True)
    new_email='signup-'+uuid.uuid4().hex[:12]+'@example.invalid'
    payload={'email':new_email,'password1':password,'password2':password,
        'privacy':'on','service':'on','next':signup_url}
    rejected=post(signup,reverse('account_signup'),{**payload,'password1':'123','password2':'123'})
    check('customer_signup_rejects_weak_password',rejected.status_code==200
        and not get_user_model().objects.filter(email=new_email).exists())
    response=post(signup,reverse('account_signup'),payload)
    check('customer_native_registration_requires_email_code',response.status_code==302
        and '_auth_user_id' not in signup.session)
    response=code_step(signup,letter(signup))
    registered=get_user_model().objects.get(email=new_email)
    check('customer_native_registration_password_and_email_complete',response.status_code==302
        and response['Location']==signup_url and registered.check_password(password)
        and signup.session.get('_auth_user_id')==str(registered.pk) and PROOF in signup.session)

    from django.db import connection,connections
    if connection.vendor=='postgresql':
        from concurrent.futures import ThreadPoolExecutor
        race=browser();race_url,_=target()
        password_step(race,race_url);code_step(race,letter(race))
        original=race.cookies.output(header='',sep=';').strip()
        def authorize_once(_):
            other=browser();other.cookies.load(original)
            try:
                response=other.get(race_url,secure=True)
                return response.status_code==302 and 'code=' in response.get('Location','')
            finally:connections.close_all()
        with ThreadPoolExecutor(max_workers=2) as pool:results=list(pool.map(authorize_once,range(2)))
        check('customer_parallel_authorizations_consume_proof_once',sum(results)==1)
