"""Bind a native allauth MFA event to one admin authorization request and code.

This adds policy/evidence around the pinned library. The library still owns
factor verification, recovery-code consumption, OAuth codes, PKCE and signing.
No authentication-record labels or browser-provided MFA claims are trusted.
"""
import hashlib
import re
import time
from urllib.parse import urlencode

from allauth.mfa.models import Authenticator
from django.conf import settings
from django.http import HttpResponseRedirect, JsonResponse
from django.shortcuts import render
from django.urls import reverse

PENDING = 'alisa_staff_authorization'
PROOF = 'alisa_staff_native_mfa'
CODE_PROOF = '_alisa_staff_mfa'
ACR = 'urn:octoport:staff:native-mfa:v1'


def fresh(value, now, maximum):
    return type(value) in {int, float} and now - maximum <= value <= now + 5


def fingerprint(query):
    # allauth removes prompt=login when returning from its native reauth flow.
    return hashlib.sha256(urlencode(sorted(
        (key, value) for key, values in query.lists() if key != 'prompt'
        for value in values)).encode()).hexdigest()


def valid_admin_query(query):
    from allauth.idp.oidc.models import Client
    if not settings.IDENTITY_ENABLED or not settings.IDENTITY_STAFF_ENABLED:
        return False
    client=Client.objects.filter(pk=settings.IDENTITY_STAFF_CLIENT_ID,type=Client.Type.CONFIDENTIAL).first()
    return (query.getlist('client_id')==[settings.IDENTITY_STAFF_CLIENT_ID]
        and not any(len(values)!=1 for _,values in query.lists())
        and query.getlist('redirect_uri')==[settings.IDENTITY_STAFF_CALLBACK]
        and client is not None and client.redirect_uris==settings.IDENTITY_STAFF_CALLBACK
        and query.getlist('response_type')==['code']
        and bool(query.get('state')) and bool(query.get('nonce'))
        and query.getlist('code_challenge_method')==['S256']
        and len(query.getlist('code_challenge'))==1
        and re.fullmatch(r'[A-Za-z0-9_-]{43}',query['code_challenge']) is not None)

def pending_authorization_target(request,user=None):
    from urllib.parse import urlsplit
    from django.http import QueryDict
    pending=request.session.get(PENDING)
    user=user or request.user
    if (not getattr(user,'is_authenticated',False) or not isinstance(pending,dict)
            or not fresh(pending.get('started'),time.time(),600)
            or pending.get('user') not in {None,str(user.pk)}):
        return None
    target=pending.get('target')
    if not isinstance(target,str) or not 1<=len(target)<=4096 or '\\' in target or any(ord(c)<32 or ord(c)==127 for c in target):
        return None
    try:parsed=urlsplit(target);query=QueryDict(parsed.query)
    except ValueError:return None
    if (parsed.scheme or parsed.netloc or parsed.fragment
            or parsed.path!=reverse('idp:oidc:authorization')
            or not valid_admin_query(query) or fingerprint(query)!=pending.get('request')):
        return None
    return target


def native_factor_used(sender, request, user, authenticator, **kwargs):
    """Only called by allauth after successful native factor validation."""
    if not getattr(settings,'IDENTITY_STAFF_ENABLED',False) or authenticator.type not in {'totp', 'recovery_codes'}:
        return
    pending = request.session.get(PENDING)
    now = time.time()
    if (not isinstance(pending, dict) or not fresh(pending.get('started'), now, 600)
            or pending.get('user') not in {None, str(user.pk)}
            or authenticator.user_id != user.pk or pending_authorization_target(request,user) is None):
        return
    request.session[PROOF] = {
        'request': pending['request'], 'user': str(user.pk),
        'at': now, 'type': authenticator.type,
    }


def proof_for_request(request):
    pending, proof = request.session.get(PENDING), request.session.get(PROOF)
    now = time.time()
    if (not request.user.is_authenticated or not isinstance(pending, dict)
            or not isinstance(proof, dict)
            or not fresh(pending.get('started'), now, 600)
            or not fresh(proof.get('at'), now, 300)
            or proof['at'] < pending['started']
            or proof.get('request') != pending.get('request')
            or proof.get('user') != str(request.user.pk)
            or proof.get('type') not in {'totp', 'recovery_codes'}
            or pending_authorization_target(request) is None):
        return None
    return proof


def bind_code(value):
    """Called at the encrypted cache write used by pinned authorization_codes.

    This is the point where a verified user and the actual library-issued code
    meet. Binding in the same cache object makes evidence one-use with the code.
    Any admin code written without the matching native event fails closed.
    """
    from allauth.core import context
    from allauth.core.exceptions import ImmediateHttpResponse
    if (not isinstance(value, dict) or value.get('client_id') != settings.IDENTITY_STAFF_CLIENT_ID
            or 'code' not in value or 'sub' not in value or 'pkce' not in value):
        return value
    request = context.request
    proof = proof_for_request(request) if request is not None else None
    if (not settings.IDENTITY_STAFF_ENABLED or proof is None
            or request.path != reverse('idp:oidc:authorization')
            or fingerprint(request.GET) != proof['request']):
        raise ImmediateHttpResponse(JsonResponse({'error': 'access_denied'}, status=403))
    request.session.pop(PROOF, None)
    request.session.pop(PENDING, None)
    return {**value, CODE_PROOF: {
        'at': int(proof['at']), 'type': proof['type'], 'sub': value['sub'],
        'client_id': value['client_id'],
    }}


def token_claims(client, token):
    from allauth.core import context
    from allauth.core.exceptions import ImmediateHttpResponse
    from allauth.idp.oidc.internal.oauthlib import authorization_codes
    request = context.request
    code = request.POST.get('code', '') if request is not None else ''
    row = authorization_codes.lookup(client.id, code)
    proof = row.get(CODE_PROOF) if isinstance(row, dict) else None
    if (not settings.IDENTITY_STAFF_ENABLED or not isinstance(proof, dict)
            or proof.get('sub') != token.get('sub') or proof.get('client_id') != client.id
            or proof.get('type') not in {'totp', 'recovery_codes'}
            or not fresh(proof.get('at'), time.time(), 300)):
        raise ImmediateHttpResponse(JsonResponse({'error': 'invalid_grant'}, status=400))
    return {'acr': ACR, 'amr': ['otp'] if proof['type'] == 'totp' else ['recovery_code'],
            'auth_time': proof['at'], 'alisa_mfa': {'at': proof['at'], 'type': proof['type']}}


class StaffMFAPolicy:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response=self.handle_request(request)
        if request.path.startswith('/accounts/2fa/'):
            response['Cache-Control']='no-store'
            response['Referrer-Policy']='no-referrer'
        return response

    def handle_request(self, request):
        client_id = settings.IDENTITY_STAFF_CLIENT_ID
        if (settings.IDENTITY_STAFF_ENABLED and request.user.is_authenticated
                and request.path == reverse('mfa_activate_totp')
                and not Authenticator.objects.filter(user=request.user, type='totp').exists()):
            # Pinned allauth treats passwordless users without native reauth
            # methods as already reauthenticated for MFA enrollment. Require
            # a fresh native email-code event before adding their first factor.
            from allauth.account.internal.flows.login import get_authentication_records
            records = get_authentication_records(request, request.user)
            if not any(row.get('method') == 'code' and fresh(row.get('at'), time.time(), 300) for row in records):
                login = reverse('account_request_login_code') + '?' + urlencode({'next': reverse('mfa_activate_totp')})
                response = render(request, 'identity/reauthenticate_code.html', {'login_target': login})
                response['Cache-Control'] = 'no-store'
                return response
        if (not settings.IDENTITY_ENABLED or not client_id
                or request.path != reverse('idp:oidc:authorization')
                or client_id not in request.GET.getlist('client_id')):
            return self.get_response(request)
        if not settings.IDENTITY_STAFF_ENABLED:
            return JsonResponse({'error': 'access_denied'}, status=403)
        # Gate only the registered admin callback; never redirect to input URLs.
        from allauth.idp.oidc.models import Client
        client = Client.objects.filter(pk=client_id, type=Client.Type.CONFIDENTIAL).first()
        if (request.method != 'GET' or request.GET.getlist('client_id') != [client_id]
                or any(len(values) != 1 for _, values in request.GET.lists())
                or request.GET.getlist('redirect_uri') != [settings.IDENTITY_STAFF_CALLBACK]
                or not client or client.redirect_uris != settings.IDENTITY_STAFF_CALLBACK
                or request.GET.get('response_type') != 'code'
                or not request.GET.get('state') or not request.GET.get('nonce')):
            return JsonResponse({'error': 'invalid_request'}, status=400)
        mark = fingerprint(request.GET)
        pending = request.session.get(PENDING)
        if (not isinstance(pending, dict) or pending.get('request') != mark
                or not fresh(pending.get('started'), time.time(), 600)):
            request.session[PENDING] = {'request': mark, 'started': time.time(),
                'user': str(request.user.pk) if request.user.is_authenticated else None,'target':request.get_full_path()}
            request.session.pop(PROOF, None)
        else:
            # Only this validated native authorization GET can refresh the stored target.
            request.session[PENDING]={**pending,'target':request.get_full_path()}
        if request.user.is_authenticated and proof_for_request(request) is None:
            if Authenticator.objects.filter(user=request.user, type='totp').exists():
                response = HttpResponseRedirect(reverse('mfa_reauthenticate') + '?' +
                    urlencode({'next': request.get_full_path()}))
            else:
                response = render(request, 'identity/staff_mfa_required.html', {
                    'continue_url': request.get_full_path(), 'setup_url': reverse('mfa_activate_totp')})
            response['Cache-Control'] = 'no-store'
            return response
        return self.get_response(request)
