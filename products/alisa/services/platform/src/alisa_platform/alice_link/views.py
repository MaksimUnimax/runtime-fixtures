"""Private BFF boundary; public OAuth endpoints remain on the website origin."""
import json
import re
import secrets
from datetime import timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from oauthlib.oauth2 import OAuth2Error

from alisa_platform.accounts.models import Customer, WebSession
from alisa_platform.accounts.views import boundary, digest, exact, session
from alisa_platform.foundation.views import reply
from alisa_platform.leads.views import allow
from .models import AliceLink, AuthorizationRequest, AuthorizationCode, TokenFamily
from .oauth import REDIRECT, SCOPE, server, valid_link
from .vault import seal, unseal

AUTHORIZE = 'https://alisa.octoport.ru/alice/oauth/authorize'
TOKEN = 'https://alisa.octoport.ru/alice/oauth/token'


def parameters(value, allowed):
    if not isinstance(value, str) or len(value) > 8192:
        raise ValueError()
    pairs = parse_qsl(value, keep_blank_values=True, strict_parsing=True, max_num_fields=12)
    if len({key for key, _ in pairs}) != len(pairs) or any(key not in allowed for key, _ in pairs):
        raise ValueError()
    if any(len(item) > 2048 or any(ord(c) < 32 for c in item) for pair in pairs for item in pair):
        raise ValueError()
    return dict(pairs)


def projection(link):
    state = 'DISCONNECTED'
    if link and valid_link(link):
        live = TokenFamily.objects.filter(link=link, revision=link.revision, revoked_at__isnull=True,
                                         refresh_expires_at__gt=timezone.now()).exists()
        if live:
            state = 'CONNECTED' if link.confirmed_at else 'WAITING_FOR_ALICE'
    return {'state': state, 'voice_private': link.voice_private if link else True}


def customer_lock(customer_id):
    # Every grant, consent and unlink takes this lock before link/code/family locks.
    Customer.objects.select_for_update().get(pk=customer_id)


def find_link(row):
    return AliceLink.objects.select_for_update().select_related('customer', 'tenant').filter(
        customer=row.customer, tenant=row.tenant, client_id=settings.ALICE_CLIENT_ID).first()


def authorize_request(data):
    exact(data, {'action', 'query'}, {'session_token'})
    values = parameters(data['query'], {'client_id', 'redirect_uri', 'response_type', 'scope', 'state',
                                        'code_challenge', 'code_challenge_method'})
    if (not values.get('state') or values.get('redirect_uri') != REDIRECT or values.get('scope') != SCOPE
            or ('code_challenge' in values and (values.get('code_challenge_method') != 'S256'
                or re.fullmatch(r'[A-Za-z0-9_-]{43}', values['code_challenge']) is None))
            or ('code_challenge_method' in values and 'code_challenge' not in values)):
        raise ValueError()
    uri = AUTHORIZE + '?' + urlencode(values)
    try:
        server().validate_authorization_request(uri)
    except OAuth2Error:
        return reply({'code': 'INVALID_AUTHORIZATION_REQUEST'}, 400)
    with transaction.atomic():
        if not allow('alice-consent-minute', 60, 60) or not allow('alice-consent-day', 5000, 86400):
            return reply({'code': 'RATE_LIMITED'}, 429)
    secret = secrets.token_urlsafe(32)
    actor = session(data) if data.get('session_token') else None
    row = AuthorizationRequest(secret_hash=digest(secret), session=actor, expires_at=timezone.now() + timedelta(minutes=10))
    row.encrypted_payload = seal('consent', row.pk, {'uri': uri})
    row.save()
    return reply({'flow_ref': secret, 'expires_in': 600}, 201)


def consent(data, row):
    exact(data, {'action', 'session_token', 'flow_ref'})
    if not isinstance(data['flow_ref'], str) or len(data['flow_ref']) != 43:
        raise ValueError()
    flow = AuthorizationRequest.objects.select_for_update().filter(secret_hash=digest(data['flow_ref'])).first()
    if not flow or flow.consumed_at or flow.expires_at <= timezone.now():
        return reply({'code': 'AUTHORIZATION_EXPIRED'}, 400)
    if data['action'] == 'preview' and flow.session_id is None:
        flow.session = row
        flow.save(update_fields=['session'])
    if flow.session_id != row.pk:
        return reply({'code': 'AUTHORIZATION_ACCOUNT_CHANGED'}, 409)
    if data['action'] == 'preview':
        return reply({'state': 'AWAITING_CONSENT'})
    uri = unseal('consent', flow.pk, flow.encrypted_payload)['uri']
    values = dict(parse_qsl(urlsplit(uri).query))
    if data['action'] == 'approve':
        link = find_link(row)
        if not link:
            link = AliceLink(customer=row.customer, tenant=row.tenant, client_id=settings.ALICE_CLIENT_ID,
                             security_revision=row.customer.security_revision)
        else:
            link.revision += 1
            TokenFamily.objects.filter(link=link, revoked_at__isnull=True).update(
                revoked_at=timezone.now(), encrypted_response='', retry_until=None)
        link.authorized_at, link.confirmed_at, link.revoked_at = timezone.now(), None, None
        link.security_revision = row.customer.security_revision
        link.save()
        headers, _, status = server().create_authorization_response(uri, scopes=[SCOPE], credentials={'user': link})
        if status != 302:
            raise ValueError()
        target = headers['Location']
        target += '&' + urlencode({'client_id': settings.ALICE_CLIENT_ID, 'scope': SCOPE})
    else:
        target = REDIRECT + '?' + urlencode({'error': 'access_denied', 'state': values['state'],
                                             'client_id': settings.ALICE_CLIENT_ID, 'scope': SCOPE})
    flow.consumed_at, flow.encrypted_payload = timezone.now(), ''
    flow.save(update_fields=['consumed_at', 'encrypted_payload'])
    return reply({'redirect_uri': target})


def oauth_response(data):
    exact(data, {'action', 'body', 'authorization'})
    values = parameters(data['body'], {'grant_type', 'client_id', 'client_secret', 'code', 'redirect_uri',
                                       'code_verifier', 'refresh_token', 'scope', 'token', 'token_type_hint'})
    authorization = data['authorization']
    if not isinstance(authorization, str) or len(authorization) > 2048 or any(ord(c) < 32 for c in authorization):
        raise ValueError()
    if data['action'] == 'token' and values.get('grant_type') not in {'authorization_code', 'refresh_token'}:
        return reply({'oauth_body': {'error': 'unsupported_grant_type'}, 'oauth_status': 400})
    allowed = {'client_id', 'client_secret'}
    if data['action'] == 'revoke':
        allowed |= {'token', 'token_type_hint'}
    elif values['grant_type'] == 'authorization_code':
        allowed |= {'grant_type', 'code', 'redirect_uri', 'code_verifier'}
    else:
        allowed |= {'grant_type', 'refresh_token', 'scope'}
    if set(values) - allowed:
        return reply({'oauth_body': {'error': 'invalid_request'}, 'oauth_status': 400})
    with transaction.atomic():
        # Resolve without a row lock, then serialize with consent/unlink before validation.
        candidate = None
        if values.get('code'):
            candidate = AuthorizationCode.objects.filter(code_hash=digest(values['code'])).values_list('link__customer_id', flat=True).first()
        elif values.get('refresh_token') or values.get('token'):
            from django.db.models import Q
            value = digest(values.get('refresh_token') or values['token'])
            candidate = TokenFamily.objects.filter(Q(access_hash=value) | Q(refresh_hash=value)).values_list('link__customer_id', flat=True).first()
        if candidate:
            customer_lock(candidate)
        headers = {'Authorization': authorization} if authorization else {}
        if data['action'] == 'token':
            _, body, status = server().create_token_response(TOKEN, http_method='POST', body=data['body'], headers=headers)
        else:
            _, body, status = server().create_revocation_response(TOKEN + '/revoke', http_method='POST', body=data['body'], headers=headers)
        return reply({'oauth_body': json.loads(body) if body else {}, 'oauth_status': status})


def webhook(data):
    exact(data, {'action', 'payload', 'authorization'})
    payload = data['payload']
    if not isinstance(payload, dict) or payload.get('version') != '1.0':
        raise ValueError()
    session_data, meta = payload.get('session', {}), payload.get('meta', {})
    if not isinstance(session_data, dict) or not isinstance(meta, dict) or session_data.get('skill_id') != settings.ALICE_SKILL_ID:
        return reply({'code': 'WRONG_SKILL'}, 403)
    authorization = data['authorization']
    user = session_data.get('user', {})
    if not isinstance(user, dict) or not isinstance(authorization, str) or len(authorization) > 2055:
        raise ValueError()
    token = user.get('access_token', '')
    if not isinstance(token, str) or len(token) > 2048:
        raise ValueError()
    if authorization:
        if not authorization.startswith('Bearer ') or (token and token != authorization[7:]):
            return reply({'code': 'INVALID_BEARER'}, 401)
        token = authorization[7:]
    valid, oauth_request = server().verify_request(TOKEN, http_method='POST', headers={'Authorization': 'Bearer ' + token}, scopes=[SCOPE])
    if not valid:
        interfaces = meta.get('interfaces', {})
        if isinstance(interfaces, dict) and 'account_linking' in interfaces:
            result = {'version': '1.0', 'start_account_linking': {}}
        else:
            result = {'version': '1.0', 'response': {'text': 'Подключите аккаунт в приложении Алисы.', 'end_session': False}}
        return reply({'skill_response': result})
    with transaction.atomic():
        customer_lock(oauth_request.user.customer_id)
        # Recheck after the customer lock so a concurrent unlink always wins.
        valid, oauth_request = server().verify_request(TOKEN, http_method='POST', headers={'Authorization': 'Bearer ' + token}, scopes=[SCOPE])
        if not valid:
            return reply({'code': 'INVALID_BEARER'}, 401)
        link = oauth_request.user
        if not link.confirmed_at:
            link.confirmed_at = timezone.now()
            link.save(update_fields=['confirmed_at'])
    return reply({'skill_response': {'version': '1.0', 'response': {
        'text': 'Аккаунт кабинета подключён. Настройки подключения доступны на сайте Алиса Маркет.',
        'end_session': False}}})


@boundary
def handle(request, data):
    if not settings.ALICE_LINK_ENABLED:
        return reply({'code': 'NOT_FOUND'}, 404)
    action = data.get('action')
    if action == 'request':
        return authorize_request(data)
    if action in {'token', 'revoke'}:
        return oauth_response(data)
    if action == 'webhook':
        return webhook(data)
    if action not in {'status', 'preview', 'approve', 'deny', 'unlink', 'privacy'}:
        raise ValueError()
    with transaction.atomic():
        row = session(data)
        if not row:
            return reply({'code': 'AUTHENTICATION_REQUIRED'}, 401)
        customer_lock(row.customer_id)
        # Logout's UPDATE takes this same row lock. A logout that commits first
        # is visible to the fresh session check; otherwise consent commits first.
        WebSession.objects.select_for_update().get(pk=row.pk)
        row = session(data)
        if not row:
            return reply({'code': 'AUTHENTICATION_REQUIRED'}, 401)
        if action in {'preview', 'approve', 'deny'}:
            return consent(data, row)
        exact(data, {'action', 'session_token'}, {'voice_private'} if action == 'privacy' else ())
        link = find_link(row)
        if action == 'privacy':
            if type(data.get('voice_private')) is not bool:
                raise ValueError()
            if not link:
                link = AliceLink(customer=row.customer, tenant=row.tenant, client_id=settings.ALICE_CLIENT_ID,
                                 security_revision=row.customer.security_revision)
            link.voice_private = data['voice_private']
            link.save()
        if action == 'unlink' and link:
            link.revision += 1
            link.revoked_at, link.confirmed_at = timezone.now(), None
            link.save(update_fields=['revision', 'revoked_at', 'confirmed_at'])
            TokenFamily.objects.filter(link=link, revoked_at__isnull=True).update(
                revoked_at=timezone.now(), encrypted_response='', retry_until=None)
        if action == 'unlink':
            AuthorizationRequest.objects.filter(session__customer_id=row.customer_id, consumed_at__isnull=True).update(
                consumed_at=timezone.now(), encrypted_payload='')
        return reply({'alice': projection(link)})
