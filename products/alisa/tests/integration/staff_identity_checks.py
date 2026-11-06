"""Native factor/code binding on the guarded disposable PostgreSQL authority."""
import base64
import hashlib
import json
import os
import secrets
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlsplit
from unittest.mock import patch

if not (os.environ.get('ALISA_STAFF_CORE_TEST_ALLOW') == '1' and os.environ.get('ALISA_ENV') == 'dev'
        and os.environ.get('ALISA_DB_NAME') == 'alisa_s03_core_identity'
        and os.environ.get('ALISA_DB_HOST') == '127.0.0.1' and os.environ.get('ALISA_DB_PORT') == '55480'):
    raise RuntimeError('Owned disposable staff identity database required')

import django
django.setup()
import jwt
from django.conf import settings
from django.contrib.auth import get_user_model
from django.test import Client
from django.urls import reverse
from allauth.account.models import EmailAddress
from allauth.idp.oidc.models import Client as OIDCClient
from allauth.mfa.totp.internal.auth import TOTP, generate_totp_secret, hotp_value, format_hotp_value
from allauth.mfa.recovery_codes.internal.auth import RecoveryCodes
from allauth.mfa.models import Authenticator
from octoport_identity.protocol.staff import PROOF, PENDING, ACR

CASES = []
def check(name, ok):
    if not ok:
        raise RuntimeError('CHECK_FAILED:' + name)
    CASES.append({'case': name, 'passed': True})

def main():
    unenrolled = get_user_model().objects.create_user(username=uuid.uuid4().hex, email='staff-enrollment@example.invalid')
    EmailAddress.objects.create(user=unenrolled, email=unenrolled.email, primary=True, verified=True)
    enrollment = Client(enforce_csrf_checks=True, HTTP_HOST='localhost:19443')
    enrollment.force_login(unenrolled, backend='django.contrib.auth.backends.ModelBackend')
    response = enrollment.get(reverse('mfa_activate_totp'), secure=True)
    check('s03_stale_passwordless_session_cannot_enroll_first_factor', response.status_code == 200 and b'authenticator_secret' not in response.content and reverse('account_logout').encode() in response.content)
    # Reach the enrollment page only after the actual native email code is
    # consumed; no session labels are injected by this positive test.
    enrollment.get(reverse('account_request_login_code'), secure=True)
    # The request-code view is for anonymous users, so use native logout first.
    csrf=enrollment.cookies[settings.CSRF_COOKIE_NAME].value
    enrollment.post(reverse('account_logout'), secure=True, HTTP_ORIGIN=settings.IDENTITY_ISSUER, HTTP_X_CSRFTOKEN=csrf)
    enrollment.get(reverse('account_request_login_code'), secure=True)
    csrf=enrollment.cookies[settings.CSRF_COOKIE_NAME].value
    response=enrollment.post(reverse('account_request_login_code'), {'email':unenrolled.email}, secure=True, HTTP_ORIGIN=settings.IDENTITY_ISSUER, HTTP_X_CSRFTOKEN=csrf)
    from octoport_identity.accounts.models import IdentityMail
    from octoport_identity.protocol.storage import open_sealed
    import re
    mail=IdentityMail.objects.get(pk=enrollment.session['identity_mail_id'])
    code=re.search(r'(?m)^\s*([A-Z0-9]{4}-[A-Z0-9]{4})\s*$',open_sealed(mail.encrypted_payload)['body']).group(1)
    enrollment.get(reverse('account_confirm_login_code'), secure=True)
    csrf=enrollment.cookies[settings.CSRF_COOKIE_NAME].value
    enrollment.post(reverse('account_confirm_login_code'), {'code':code}, secure=True, HTTP_ORIGIN=settings.IDENTITY_ISSUER, HTTP_X_CSRFTOKEN=csrf)
    response=enrollment.get(reverse('mfa_activate_totp'), secure=True)
    check('s03_real_native_email_code_allows_first_factor_enrollment',response.status_code==200 and b'authenticator_secret' in response.content)
    import io
    from django.core.management import call_command
    from django.core.management.base import CommandError
    from octoport_identity.accounts.models import Subject
    result=io.StringIO()
    call_command('prepare_verified_staff_subject',apply=True,person_id=str(unenrolled.pk),stdout=result)
    prepared=Subject.objects.get(person=unenrolled,client_id=settings.IDENTITY_STAFF_CLIENT_ID)
    check('s03_closed_prepare_subject_maps_verified_person_to_admin_client',str(prepared.pk) in result.getvalue())
    second=io.StringIO();call_command('prepare_verified_staff_subject',apply=True,person_id=str(unenrolled.pk),stdout=second)
    check('s03_closed_prepare_subject_is_idempotent',result.getvalue()==second.getvalue()
        and Subject.objects.filter(person=unenrolled,client_id=settings.IDENTITY_STAFF_CLIENT_ID).count()==1)
    check('s03_closed_prepare_subject_does_not_create_factor',not Authenticator.objects.filter(user=unenrolled).exists())
    unverified=get_user_model().objects.create_user(username=uuid.uuid4().hex,email='unverified-staff@example.invalid')
    try:call_command('prepare_verified_staff_subject',apply=True,person_id=str(unverified.pk),stdout=io.StringIO());denied=False
    except CommandError:denied=True
    check('s03_closed_prepare_subject_rejects_unverified_person',denied and not Subject.objects.filter(person=unverified).exists())
    person = get_user_model().objects.create_user(username=uuid.uuid4().hex, email='staff-core@example.invalid')
    EmailAddress.objects.create(user=person, email=person.email, primary=True, verified=True)
    secret = generate_totp_secret()
    TOTP.activate(person, secret)
    recovery = RecoveryCodes.activate(person)
    codes = recovery.get_unused_codes()
    browser = Client(enforce_csrf_checks=True, HTTP_HOST='localhost:19443')
    # A preexisting identity session is deliberately insufficient. Factor
    # verification below uses the unmodified native CSRF-protected form.
    browser.force_login(person, backend='django.contrib.auth.backends.ModelBackend')
    def authorize():
        verifier = secrets.token_urlsafe(48)
        nonce = secrets.token_urlsafe(32)
        query = {'client_id': settings.IDENTITY_STAFF_CLIENT_ID, 'redirect_uri': settings.IDENTITY_STAFF_CALLBACK,
            'response_type': 'code', 'scope': 'openid email', 'state': secrets.token_urlsafe(32), 'nonce': nonce,
            'code_challenge': base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode(), 'code_challenge_method': 'S256'}
        return reverse('idp:oidc:authorization') + '?' + urlencode(query), verifier, nonce
    def post_factor(target, value):
        browser.get(target, secure=True)
        csrf = browser.cookies[settings.CSRF_COOKIE_NAME].value
        return browser.post(target, {'code': value}, secure=True,
            HTTP_ORIGIN=settings.IDENTITY_ISSUER, HTTP_X_CSRFTOKEN=csrf)
    def redeem(code, verifier, client_secret=None):
        password = client_secret or os.environ['ALISA_STAFF_OIDC_CLIENT_SECRET']
        authorization = 'Basic ' + base64.b64encode((settings.IDENTITY_STAFF_CLIENT_ID + ':' + password).encode()).decode()
        return browser.post(reverse('idp:oidc:token'), {'grant_type': 'authorization_code', 'code': code,
            'redirect_uri': settings.IDENTITY_STAFF_CALLBACK, 'code_verifier': verifier},
            secure=True, HTTP_AUTHORIZATION=authorization)
    url, verifier, nonce = authorize()
    response = browser.get(url, secure=True)
    check('s03_existing_identity_and_enrolled_factor_do_not_issue_admin_code', response.status_code == 302 and '/2fa/reauthenticate/' in response['Location'])
    target = response['Location']
    check('s03_native_factor_form_rejects_missing_csrf', browser.post(target, {'code': '000000'}, secure=True).status_code == 403)
    failed = post_factor(target, 'not-a-factor')
    check('s03_wrong_native_factor_has_no_attestation', failed.status_code == 200 and PROOF not in browser.session)
    valid = format_hotp_value(hotp_value(secret, int(time.time()) // 30))
    response = post_factor(target, valid)
    check('s03_native_totp_creates_pending_request_bound_evidence', response.status_code == 302 and PROOF in browser.session)
    issued = browser.get(url, secure=True)
    code = parse_qs(urlsplit(issued.get('Location', '')).query).get('code', [None])[0]
    check('s03_native_totp_issues_one_library_authorization_code', issued.status_code == 302 and bool(code) and PROOF not in browser.session and PENDING not in browser.session)
    check('s03_wrong_client_secret_cannot_exchange_bound_code', redeem(code, verifier, 'z' * 48).status_code == 401)
    tokens = redeem(code, verifier)
    check('s03_native_mfa_bound_code_exchanges_via_library', tokens.status_code == 200)
    pem = settings.IDP_OIDC_PRIVATE_KEYS[0]['pem']
    from cryptography.hazmat.primitives.serialization import load_pem_private_key
    public = load_pem_private_key(pem.encode(), None).public_key()
    claims = jwt.decode(tokens.json()['id_token'], public, algorithms=['RS256'],
        issuer=settings.IDENTITY_ISSUER, audience=settings.IDENTITY_STAFF_CLIENT_ID)
    check('s03_signed_mfa_evidence_has_fixed_issuer_client_subject_nonce', claims['nonce'] == nonce and claims['acr'] == ACR and claims['amr'] == ['otp'] and claims['alisa_mfa']['type'] == 'totp' and claims['auth_time'] == claims['alisa_mfa']['at'])
    check('s03_admin_authorization_code_replay_denied', redeem(code, verifier).status_code == 400)
    next_url, _, _ = authorize()
    response = browser.get(next_url, secure=True)
    check('s03_persisted_authentication_records_do_not_attest_a_new_request', response.status_code == 302 and PROOF not in browser.session)
    # The same TOTP value cannot be used twice, including on a different flow.
    repeated = post_factor(response['Location'], valid)
    check('s03_native_totp_replay_does_not_attest_new_flow', repeated.status_code == 200 and PROOF not in browser.session)
    recovery_response = post_factor(response['Location'], codes[0])
    check('s03_native_recovery_consumption_creates_attestation', recovery_response.status_code == 302 and browser.session[PROOF]['type'] == 'recovery_codes')
    # A new authorization request destroys evidence for the previous request.
    another_url, another_verifier, _ = authorize()
    response = browser.get(another_url, secure=True)
    check('s03_native_proof_cannot_move_to_another_authorization_request', response.status_code == 302 and PROOF not in browser.session)
    repeated = post_factor(response['Location'], codes[0])
    check('s03_used_recovery_code_cannot_attest_another_flow', repeated.status_code == 200 and PROOF not in browser.session)
    post_factor(response['Location'], codes[1])
    pending = browser.session
    proof = pending[PROOF]
    proof['at'] = time.time() - 301
    pending[PROOF] = proof
    pending.save()
    expired = browser.get(another_url, secure=True)
    check('s03_stale_native_factor_requires_step_up', expired.status_code == 302 and '/2fa/reauthenticate/' in expired['Location'])
    post_factor(expired['Location'], codes[2])
    response = browser.get(another_url, secure=True)
    code = parse_qs(urlsplit(response.get('Location', '')).query)['code'][0]
    tokens = redeem(code, another_verifier)
    recovery_claims = jwt.decode(tokens.json()['id_token'], public, algorithms=['RS256'],
        issuer=settings.IDENTITY_ISSUER, audience=settings.IDENTITY_STAFF_CLIENT_ID)
    check('s03_recovery_proof_is_signed_for_the_actual_code', tokens.status_code == 200 and recovery_claims['amr'] == ['recovery_code'] and recovery_claims['alisa_mfa']['type'] == 'recovery_codes')
    check('s03_factor_secret_is_encrypted_in_postgresql', secret not in json.dumps(Authenticator.objects.get(user=person,type='totp').data))
    # The ordinary client does not gain staff claims even for an MFA person.
    check('s03_client_registration_uses_confidential_dedicated_admin', OIDCClient.objects.get(pk=settings.IDENTITY_STAFF_CLIENT_ID).type == OIDCClient.Type.CONFIDENTIAL)

    # Complete the originally passwordless, unenrolled native email identity
    # through one real enrollment POST and every following HTTP redirect.
    enrollment_url,enrollment_verifier,_=authorize()
    response=enrollment.get(enrollment_url,secure=True)
    check('s03_single_enrollment_starts_with_registered_admin_request',response.status_code==200)
    response=enrollment.get(reverse('mfa_activate_totp'),secure=True)
    from allauth.account.internal.flows.login import get_authentication_records
    setup_secret=response.context_data['form'].secret
    csrf=enrollment.cookies[settings.CSRF_COOKIE_NAME].value
    mail_before=IdentityMail.objects.filter(recipient=unenrolled.email).count()
    bad=enrollment.post(reverse('mfa_activate_totp'),{'code':'incorrect'},secure=True,
        HTTP_ORIGIN=settings.IDENTITY_ISSUER,HTTP_X_CSRFTOKEN=csrf)
    check('s03_wrong_enrollment_code_cannot_add_factor_or_proof',bad.status_code==200
        and not Authenticator.objects.filter(user=unenrolled,type='totp').exists() and PROOF not in enrollment.session)
    enrollment_code=format_hotp_value(hotp_value(setup_secret,int(time.time())//30))
    response=enrollment.post(reverse('mfa_activate_totp'),{'code':enrollment_code},secure=True,
        HTTP_ORIGIN=settings.IDENTITY_ISSUER,HTTP_X_CSRFTOKEN=csrf)
    check('s03_one_enrollment_post_redirects_directly_to_recovery',response.status_code==302
        and response['Location']==reverse('mfa_view_recovery_codes'))
    recovered=enrollment.get(response['Location'],secure=True)
    check('s03_recovery_http_uses_same_verified_challenge_without_second_form',recovered.status_code==200
        and b'identity/staff/continue' in recovered.content and b'input name="code"' not in recovered.content
        and PROOF in enrollment.session)
    check('s03_native_reauth_record_survives_redirect_after_enrollment',any(
        r.get('method')=='mfa' and r.get('reauthenticated') is True
        for r in get_authentication_records(recovered.wsgi_request,unenrolled)))
    check('s03_same_enrollment_code_has_native_replay_marker',
        not Authenticator.objects.get(user=unenrolled,type='totp').wrap().validate_code(enrollment_code))
    check('s03_enrollment_recovery_does_not_send_second_login_mail',
        IdentityMail.objects.filter(recipient=unenrolled.email).count()==mail_before)
    check('s03_recovery_response_not_cacheable',recovered['Cache-Control']=='no-store'
        and recovered['Referrer-Policy']=='no-referrer')
    path=reverse('identity_staff_continue')
    check('s03_continue_requires_csrf',enrollment.post(path,{},secure=True).status_code==403)
    csrf=enrollment.cookies[settings.CSRF_COOKIE_NAME].value
    import copy
    native_pending=copy.deepcopy(enrollment.session[PENDING])
    native_proof=copy.deepcopy(enrollment.session[PROOF])
    for name,changes in [
        ('external_target',{'target':'https://attacker.test/'}),
        ('changed_nonce',{'target':enrollment_url.replace('nonce=','nonce=changed')}),
        ('different_user',{'user':str(person.pk)}),
        ('stale_pending',{'started':time.time()-601})]:
        state=enrollment.session;state[PENDING]={**native_pending,**changes};state[PROOF]=native_proof;state.save()
        fallback=enrollment.post(path,{'next':'https://attacker.test/'},secure=True,
            HTTP_ORIGIN=settings.IDENTITY_ISSUER,HTTP_X_CSRFTOKEN=csrf)
        from octoport_identity.protocol.mfa import staff_login_url
        check('s03_continue_rejects_'+name,fallback.status_code==303 and fallback['Location']==staff_login_url())
    state=enrollment.session;state[PENDING]=native_pending;state[PROOF]={**native_proof,'at':time.time()-301};state.save()
    fallback=enrollment.post(path,{},secure=True,HTTP_ORIGIN=settings.IDENTITY_ISSUER,HTTP_X_CSRFTOKEN=csrf)
    check('s03_continue_does_not_extend_expired_mfa',fallback.status_code==303 and fallback['Location']==staff_login_url())
    state=enrollment.session;state[PENDING]=native_pending;state[PROOF]=native_proof;state.save()
    resumed=enrollment.post(path,{'next':'https://attacker.test/'},secure=True,
        HTTP_ORIGIN=settings.IDENTITY_ISSUER,HTTP_X_CSRFTOKEN=csrf)
    check('s03_continue_uses_only_original_validated_native_target',resumed.status_code==303 and resumed['Location']==enrollment_url)
    issued=enrollment.get(resumed['Location'],secure=True)
    single_code=parse_qs(urlsplit(issued.get('Location','')).query).get('code',[None])[0]
    check('s03_single_challenge_resumes_to_library_oauth_code',issued.status_code==302 and bool(single_code)
        and PENDING not in enrollment.session and PROOF not in enrollment.session)
    check('s03_single_challenge_code_exchanges_once_with_native_mfa',redeem(single_code,enrollment_verifier).status_code==200
        and redeem(single_code,enrollment_verifier).status_code==400)
    fallback=enrollment.post(path,{},secure=True,HTTP_ORIGIN=settings.IDENTITY_ISSUER,HTTP_X_CSRFTOKEN=csrf)
    check('s03_finished_or_legacy_missing_pending_has_clean_admin_fallback',
        fallback.status_code==303 and fallback['Location']==staff_login_url())

    return CASES

if __name__ == '__main__':
    record = {'scope': 'S03_NATIVE_MFA_CORE_NOT_BROWSER_NOT_STAGE', 'status': 'FAILED', 'cases': CASES}
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
