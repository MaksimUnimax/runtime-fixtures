"""Dedicated product vault. No secret or ciphertext belongs in public projections."""
import hashlib
import hmac
import json
from cryptography.fernet import Fernet, MultiFernet, InvalidToken
from django.conf import settings


class VaultUnavailable(Exception):
    pass


def ring():
    try:
        keys = settings.STORE_DATA_KEYS
        if not keys:
            raise ValueError()
        return MultiFernet([Fernet(key.encode()) for key in keys])
    except (ValueError, TypeError, AttributeError):
        raise VaultUnavailable() from None


def context(store, kind, revision):
    return {'environment': settings.ALISA_ENV, 'product_id': 'alisa_market',
            'tenant_id': str(store.tenant_id), 'store_id': str(store.pk),
            'provider': store.provider, 'kind': kind, 'revision': revision}


def seal(store, kind, revision, credential):
    payload = {'context': context(store, kind, revision), 'credential': credential}
    cipher = ring().encrypt(json.dumps(payload, separators=(',', ':'), sort_keys=True).encode()).decode()
    return cipher, hashlib.sha256(settings.STORE_DATA_KEYS[0].encode()).hexdigest()[:16]


def open_secret(store, revision, secret):
    try:
        expected = context(store, revision.kind, revision.revision)
        if (secret.product_id != 'alisa_market' or secret.tenant_id != store.tenant_id
                or secret.store_id != store.pk or secret.kind != revision.kind
                or secret.revision != revision.revision or revision.tenant_id != store.tenant_id):
            raise ValueError()
        data = json.loads(ring().decrypt(secret.ciphertext.encode()))
        if set(data) != {'context', 'credential'} or not hmac.compare_digest(
                json.dumps(data['context'], sort_keys=True), json.dumps(expected, sort_keys=True)):
            raise ValueError()
        return data['credential']
    except (InvalidToken, ValueError, TypeError, KeyError, UnicodeError):
        raise VaultUnavailable() from None
