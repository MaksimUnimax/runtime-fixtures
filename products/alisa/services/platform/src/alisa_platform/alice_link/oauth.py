"""OAuthlib protocol adapter. Call mutating methods inside the customer lock."""
import base64
import binascii
import hmac
import secrets
from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import unquote_plus

from django.conf import settings
from django.utils import timezone
from oauthlib.oauth2 import RequestValidator, Server

from alisa_platform.accounts.models import Membership
from alisa_platform.accounts.views import digest
from .models import AuthorizationCode, TokenFamily
from .vault import seal, unseal

SCOPE = 'reports:read'
REDIRECT = 'https://social.yandex.net/broker/redirect'
ACCESS_SECONDS = 600
REFRESH_DAYS = 14
RETRY_SECONDS = 30


def valid_link(link):
    return (link.revoked_at is None and link.authorized_at is not None
            and link.customer.is_active and link.security_revision == link.customer.security_revision
            and Membership.objects.filter(customer=link.customer, tenant=link.tenant, role='OWNER_CLIENT').exists())


def token_generator(request=None):
    return 'as6_' + secrets.token_urlsafe(32)


class Validator(RequestValidator):
    def validate_client_id(self, client_id, request, *args, **kwargs):
        return isinstance(client_id, str) and hmac.compare_digest(client_id, settings.ALICE_CLIENT_ID)

    def authenticate_client(self, request, *args, **kwargs):
        client_id, secret = request.client_id, request.client_secret
        authorization = request.headers.get('Authorization', '')
        if authorization:
            if client_id is not None or secret is not None or not authorization.startswith('Basic '):
                return False
            try:
                pair = base64.b64decode(authorization[6:], validate=True).decode('utf-8').split(':', 1)
                if len(pair) != 2:
                    return False
                client_id, secret = [unquote_plus(value) for value in pair]
            except (ValueError, UnicodeError, binascii.Error):
                return False
        if (not self.validate_client_id(client_id, request) or not isinstance(secret, str)
                or not hmac.compare_digest(secret.encode(), settings.ALICE_CLIENT_SECRET.encode())):
            return False
        request.client_id = client_id
        request.client = SimpleNamespace(client_id=client_id)
        return True

    def client_authentication_required(self, request, *args, **kwargs):
        return True

    def validate_redirect_uri(self, client_id, redirect_uri, request, *args, **kwargs):
        return redirect_uri == REDIRECT

    def get_default_redirect_uri(self, client_id, request, *args, **kwargs):
        return REDIRECT

    def validate_response_type(self, client_id, response_type, client, request, *args, **kwargs):
        return response_type == 'code'

    def validate_scopes(self, client_id, scopes, client, request, *args, **kwargs):
        return scopes == [SCOPE]

    def get_default_scopes(self, client_id, request, *args, **kwargs):
        return [SCOPE]

    def validate_grant_type(self, client_id, grant_type, client, request, *args, **kwargs):
        return grant_type in {'authorization_code', 'refresh_token'}

    def save_authorization_code(self, client_id, code, request, *args, **kwargs):
        link = request.user
        if not valid_link(link):
            raise ValueError('Inactive Alice link')
        AuthorizationCode.objects.create(
            code_hash=digest(code['code']), link=link, revision=link.revision,
            redirect_uri=request.redirect_uri,
            challenge=request.code_challenge or '', challenge_method=request.code_challenge_method or '',
            expires_at=timezone.now() + timedelta(seconds=120))

    def validate_code(self, client_id, code, client, request, *args, **kwargs):
        row = AuthorizationCode.objects.select_for_update().select_related('link__customer').filter(code_hash=digest(code)).first()
        if (not row or row.consumed_at or row.expires_at <= timezone.now()
                or row.link.client_id != client_id or row.revision != row.link.revision or not valid_link(row.link)):
            return False
        request.user, request.scopes, request.alice_code = row.link, [SCOPE], row
        return True

    def confirm_redirect_uri(self, client_id, code, redirect_uri, client, request, *args, **kwargs):
        return redirect_uri == REDIRECT == request.alice_code.redirect_uri

    def is_pkce_required(self, client_id, request):
        # Yandex's confidential client does not require PKCE; validate S256 when supplied.
        return False

    def get_code_challenge(self, code, request):
        return request.alice_code.challenge or None

    def get_code_challenge_method(self, code, request):
        return request.alice_code.challenge_method or None

    def invalidate_authorization_code(self, client_id, code, request, *args, **kwargs):
        request.alice_code.consumed_at = timezone.now()
        request.alice_code.save(update_fields=['consumed_at'])

    def validate_refresh_token(self, refresh_token, client, request, *args, **kwargs):
        row = TokenFamily.objects.select_for_update().select_related('link__customer').filter(refresh_hash=digest(refresh_token)).first()
        if (not row or row.revoked_at or row.refresh_expires_at <= timezone.now()
                or row.link.client_id != client.client_id or row.revision != row.link.revision or not valid_link(row.link)):
            return False
        request.user, request.alice_family = row.link, row
        return True

    def get_original_scopes(self, refresh_token, request, *args, **kwargs):
        return [SCOPE]

    def rotate_refresh_token(self, request):
        return False

    def save_bearer_token(self, token, request, *args, **kwargs):
        now, link = timezone.now(), request.user
        if request.grant_type == 'refresh_token':
            row = request.alice_family
            if row.retry_until and row.retry_until > now and row.encrypted_response:
                previous = unseal('refresh-retry', row.pk, row.encrypted_response)
                token.clear()
                token.update(previous)
                token['expires_in'] = max(1, int((row.access_expires_at - now).total_seconds()))
                return
            token['refresh_token'] = request.refresh_token
            row.access_hash = digest(token['access_token'])
            row.access_expires_at = now + timedelta(seconds=ACCESS_SECONDS)
        else:
            row = TokenFamily(
                link=link, revision=link.revision, access_hash=digest(token['access_token']),
                refresh_hash=digest(token['refresh_token']), access_expires_at=now + timedelta(seconds=ACCESS_SECONDS),
                refresh_expires_at=now + timedelta(days=REFRESH_DAYS))
        row.encrypted_response = seal('refresh-retry', row.pk, dict(token))
        row.retry_until = now + timedelta(seconds=RETRY_SECONDS)
        row.save()

    def validate_bearer_token(self, token, scopes, request):
        if not isinstance(token, str) or not token.startswith('as6_'):
            return False
        row = TokenFamily.objects.select_related('link__customer', 'link__tenant').filter(
            access_hash=digest(token), revoked_at__isnull=True, access_expires_at__gt=timezone.now()).first()
        if (not row or row.revision != row.link.revision or not valid_link(row.link)
                or not set(scopes or []) <= {SCOPE}):
            return False
        request.user, request.scopes, request.alice_family = row.link, [SCOPE], row
        return True

    def revoke_token(self, token, token_type_hint, request, *args, **kwargs):
        from django.db.models import Q
        TokenFamily.objects.filter(Q(access_hash=digest(token)) | Q(refresh_hash=digest(token)),
                                   link__client_id=request.client_id, revoked_at__isnull=True).update(
            revoked_at=timezone.now(), encrypted_response='', retry_until=None)


def server():
    return Server(Validator(), token_expires_in=ACCESS_SECONDS,
                  token_generator=token_generator, refresh_token_generator=token_generator)
