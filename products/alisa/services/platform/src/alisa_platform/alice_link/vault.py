"""Only short-lived pending consent and refresh retry responses are reversible."""
import json

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from django.conf import settings


def ring():
    return MultiFernet([Fernet(key.encode()) for key in settings.ALICE_DATA_KEYS])


def seal(purpose, identifier, payload):
    return ring().encrypt(json.dumps({
        'environment': settings.ALISA_ENV, 'purpose': purpose,
        'id': str(identifier), 'payload': payload,
    }, separators=(',', ':')).encode()).decode()


def unseal(purpose, identifier, ciphertext):
    try:
        value = json.loads(ring().decrypt(ciphertext.encode()))
        if (value['environment'] != settings.ALISA_ENV or value['purpose'] != purpose
                or value['id'] != str(identifier) or set(value) != {'environment', 'purpose', 'id', 'payload'}):
            raise ValueError()
        return value['payload']
    except (InvalidToken, KeyError, TypeError, UnicodeError):
        raise ValueError('Invalid Alice envelope') from None
