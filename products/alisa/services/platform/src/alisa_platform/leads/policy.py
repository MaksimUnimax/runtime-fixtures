from django.core.validators import validate_email
from django.core.exceptions import ValidationError

CONTENT_VERSION = 'landing-1'
ATTRIBUTION = {'utm_source': {'direct', 'yandex', 'telegram', 'internal'},
               'utm_medium': {'none', 'organic', 'cpc', 'referral'},
               'utm_campaign': {'internal', 'pilot2026'}}

def attribution(value):
    value = value if isinstance(value, dict) else {}
    return {key: value.get(key) if isinstance(value.get(key), str) and value[key] in allowed else 'OTHER'
            for key, allowed in ATTRIBUTION.items()}

def contact(value):
    if not isinstance(value, str) or len(value) > 254:
        raise ValueError('INVALID_CONTACT')
    email = value.strip().lower()
    try: validate_email(email)
    except ValidationError: raise ValueError('INVALID_CONTACT') from None
    # No public contact collection has been admitted in AL-S01.
    if email.split('@')[-1] != 'example.invalid':
        raise ValueError('SYNTHETIC_CONTACT_REQUIRED')
    return email
