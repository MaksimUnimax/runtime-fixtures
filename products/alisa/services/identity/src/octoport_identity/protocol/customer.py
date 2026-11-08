"""Customer password + native email-code policy for the registered web RP.

Allauth owns password/code validation, sessions, PKCE, OAuth codes and signing.
Evidence below is written only after its native validators succeed, belongs to
one Login and one authorization, and is consumed with the encrypted OAuth code.
"""
import time
from urllib.parse import urlencode, urlsplit

from allauth.account.stages import LoginStage
from allauth.account.views import ConfirmLoginCodeView, LoginView
from allauth.mfa.stages import AuthenticateStage
from django.conf import settings
from django.http import HttpResponseRedirect, JsonResponse, QueryDict
from django.urls import reverse
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.debug import sensitive_post_parameters

from .staff import fingerprint, fresh

PIN = 'alisa_customer_credentials'
PROOF = 'alisa_customer_authorization'
CODE_PROOF = '_alisa_customer_auth'
ACR = 'urn:octoport:customer:password-email:v1'


class CustomerReentryLoginView(LoginView):
    """Show the native login form immediately; end old SSO only on its CSRF POST."""

    @method_decorator(csrf_protect)
    @method_decorator(never_cache)
    @method_decorator(sensitive_post_parameters('password'))
    def dispatch(self, request, *args, **kwargs):
        if request.user.is_authenticated:
            if request.method == 'GET':
                # Bypass only the library's authenticated-user redirect. GET
                # displays its standard form and never signs the user out.
                return self.get(request, *args, **kwargs)
            if request.method == 'POST':
                from allauth.account.adapter import get_adapter
                get_adapter().logout(request)
        # The library still owns rate limits, password and email-code stages.
        return super().dispatch(request, *args, **kwargs)

    def get_context_data(self, **kwargs):
        from django.contrib import messages
        context = super().get_context_data(**kwargs)
        context['customer_reentry_action'] = reverse('account_reauthenticate')
        context['messages'] = [message for message in messages.get_messages(self.request)
                               if message.level != messages.SUCCESS]
        return context


def authorization_query(target):
    if (not isinstance(target, str) or not 1 <= len(target) <= 4096
            or '\\' in target or any(ord(c) < 32 or ord(c) == 127 for c in target)):
        return None
    try:
        parsed = urlsplit(target)
    except ValueError:
        return None
    if (parsed.scheme or parsed.netloc or parsed.fragment
            or parsed.path != reverse('idp:oidc:authorization')):
        return None
    return QueryDict(parsed.query)


def customer_client():
    from allauth.idp.oidc.models import Client
    # The probe RP shares the host but has a DIFFERENT callback. Ambiguous
    # registration fails closed; no new client or shared Octoport DB is created.
    callback = settings.IDENTITY_PRODUCT_ORIGIN + '/auth/callback'
    clients = [client for client in Client.objects.filter(type=Client.Type.CONFIDENTIAL)
        .exclude(pk=settings.IDENTITY_STAFF_CLIENT_ID) if callback in client.redirect_uris.split()]
    return clients[0] if len(clients) == 1 else None


def valid_customer_query(query):
    import re
    client = customer_client()
    return bool(client and not any(len(v) != 1 for _, v in query.lists())
        and query.getlist('client_id') == [client.id]
        and query.getlist('redirect_uri') == [settings.IDENTITY_PRODUCT_ORIGIN + '/auth/callback']
        and query.getlist('response_type') == ['code']
        and query.get('state') and query.get('nonce')
        and query.getlist('code_challenge_method') == ['S256']
        and re.fullmatch(r'[A-Za-z0-9_-]{43}', query.get('code_challenge', '')))


def customer_target(target):
    query = authorization_query(target)
    return query if query is not None and valid_customer_query(query) else None


def pin_password(login, target):
    query = customer_target(target)
    if query is not None and login.user is not None:
        login.state[PIN] = {'request': fingerprint(query), 'user': str(login.user.pk),
            'started': time.time(), 'target': target}


def credential_pin(login, require_code=False):
    pin = login.state.get(PIN)
    now = time.time()
    if (login.user is None or not isinstance(pin, dict)
            or pin.get('user') != str(login.user.pk)
            or not fresh(pin.get('started'), now, 600)):
        return None
    query = customer_target(login.redirect_url)
    if query is None or fingerprint(query) != pin.get('request'):
        return None
    if require_code and (not fresh(pin.get('code_at'), now, 300)
            or pin['code_at'] < pin['started']):
        return None
    return pin


class CredentialStage(LoginStage):
    key = 'alisa_customer_password'

    def handle(self):
        query = customer_target(self.login.redirect_url)
        if query is None or self.login.user is None:
            return None, True  # Preserve native duplicate-signup enumeration.
        if (self.login.signup and getattr(self.request, '_alisa_password_signup', None)
                == str(self.login.user.pk)):
            pin_password(self.login, self.login.redirect_url)
        if credential_pin(self.login) is None:
            return HttpResponseRedirect(reverse('account_login') + '?' + urlencode(
                {'next': self.login.redirect_url})), False
        self.request.session.pop(PROOF, None)
        return None, True


class VerifiedLoginCodeView(ConfirmLoginCodeView):
    def _verify_form_valid(self, form):
        # Native dispatch resumes the live process, and native form.is_valid()
        # validates its current code BEFORE this hook. Resend never calls it.
        pin = credential_pin(self.stage.login)
        if pin is not None and not self._process.state['initiated_by_user']:
            pin['code_at'] = time.time()
        return super()._verify_form_valid(form)


class CustomerProofStage(LoginStage):
    key = 'alisa_customer_proof'

    def handle(self):
        if customer_target(self.login.redirect_url) is None or self.login.user is None:
            return None, True
        pin = credential_pin(self.login, require_code=True)
        if pin is None:
            return HttpResponseRedirect(reverse('account_login') + '?' + urlencode(
                {'next': self.login.redirect_url})), False
        self.request.session[PROOF] = dict(pin)
        return None, True


class CustomerAwareMFAStage(AuthenticateStage):
    def _should_handle(self, request):
        if credential_pin(self.login, require_code=True) is not None:
            return False
        return super()._should_handle(request)


def bind_code(value):
    from allauth.core import context
    from allauth.core.exceptions import ImmediateHttpResponse
    if not isinstance(value, dict) or not {'code', 'sub', 'pkce', 'redirect_uri'} <= value.keys():
        return value
    client = customer_client()
    if client is None or value.get('client_id') != client.id:
        return value
    request = context.request
    proof = request.session.get(PROOF) if request is not None else None
    query = customer_target(proof.get('target')) if isinstance(proof, dict) else None
    from .adapter import OIDCAdapter
    user = OIDCAdapter().get_user_by_sub(client, value['sub'])
    if (request is None or request.path != reverse('idp:oidc:authorization')
            or request.method != 'GET' or query is None
            or not valid_customer_query(request.GET)
            or fingerprint(request.GET) != proof.get('request')
            or fingerprint(query) != proof.get('request')
            or not request.user.is_authenticated or user != request.user
            or proof.get('user') != str(request.user.pk)
            or not fresh(proof.get('started'), time.time(), 600)
            or not fresh(proof.get('code_at'), time.time(), 300)
            or proof['code_at'] < proof['started']
            or value['redirect_uri'] != query['redirect_uri']
            or value['pkce'] != {'code_challenge': query['code_challenge'], 'code_challenge_method': 'S256'}):
        raise ImmediateHttpResponse(JsonResponse({'error': 'access_denied',
            'code': 'PASSWORD_AND_EMAIL_REQUIRED'}, status=403))
    request.session.pop(PROOF, None)
    return {**value, CODE_PROOF: {'at': int(proof['code_at']), 'sub': value['sub'],
        'client_id': client.id}}


def token_claims(client, token):
    from allauth.core import context
    from allauth.core.exceptions import ImmediateHttpResponse
    from allauth.idp.oidc.internal.oauthlib import authorization_codes
    request = context.request
    code = request.POST.get('code', '') if request is not None else ''
    row = authorization_codes.lookup(client.id, code)
    proof = row.get(CODE_PROOF) if isinstance(row, dict) else None
    if (not isinstance(proof, dict) or proof.get('sub') != token.get('sub')
            or proof.get('client_id') != client.id
            or not fresh(proof.get('at'), time.time(), 300)):
        raise ImmediateHttpResponse(JsonResponse({'error': 'invalid_grant'}, status=400))
    return {'acr': ACR, 'amr': ['pwd', 'email_otp'], 'auth_time': proof['at']}
