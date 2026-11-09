import os
from django.core.exceptions import ImproperlyConfigured

def required(name):
    value = os.environ.get(name, "")
    if not value or value.startswith("REPLACE_"):
        raise ImproperlyConfigured(f"Missing configuration: {name}")
    return value

ALISA_ENV = required("ALISA_ENV")
if ALISA_ENV not in {"dev", "stage", "prod"}:
    raise ImproperlyConfigured("Invalid ALISA_ENV")
SECRET_KEY = required("ALISA_SECRET_KEY")
SERVICE_TOKEN = required("ALISA_SERVICE_TOKEN")
if min(len(SECRET_KEY), len(SERVICE_TOKEN)) < 32:
    raise ImproperlyConfigured("Service secrets must be at least 32 characters")
RELEASE = required("ALISA_RELEASE")
DEBUG = False
ALLOWED_HOSTS = required("ALISA_ALLOWED_HOSTS").split(",")
FOUNDATION_PROBE_ENABLED = ALISA_ENV in {"dev", "stage"} and os.environ.get("FOUNDATION_PROBE_ENABLED") == "1"
INSTALLED_APPS = ["alisa_platform.foundation", "alisa_platform.leads", "alisa_platform.funnel", "alisa_platform.accounts", "alisa_platform.staff", "alisa_platform.entitlements", "alisa_platform.stores", "alisa_platform.owner_data", "alisa_platform.alice_link"]
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "django.middleware.common.CommonMiddleware"]
ROOT_URLCONF = "alisa_platform.config.urls"
WSGI_APPLICATION = "alisa_platform.config.wsgi.application"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql",
    "NAME": required("ALISA_DB_NAME"), "USER": required("ALISA_DB_USER"),
    "PASSWORD": required("ALISA_DB_PASSWORD"), "HOST": required("ALISA_DB_HOST"),
    "PORT": required("ALISA_DB_PORT"), "CONN_MAX_AGE": 0,
    "OPTIONS": {"connect_timeout": 3},
}}
USE_TZ = True
TIME_ZONE = "UTC"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
DATA_UPLOAD_MAX_MEMORY_SIZE = 2048
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_SSL_REDIRECT = False  # upstream loopback; TLS is terminated at ingress
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
LOGGING = {"version": 1, "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"alisa.foundation": {"handlers": ["console"], "level": "INFO", "propagate": False}}}

# AL-S01 remains synthetic-only and CLOSED until separate product admission.
LANDING_RELEASE_MODE = os.environ.get('ALISA_LANDING_MODE', 'CLOSED')
if LANDING_RELEASE_MODE != 'CLOSED': raise ImproperlyConfigured('Landing mode is not admitted')
LEAD_INTAKE_ENABLED = os.environ.get('ALISA_LEAD_INTAKE_ENABLED') == '1'
PUBLIC_BASE_URL = os.environ.get('ALISA_PUBLIC_BASE_URL', '').rstrip('/')
if LEAD_INTAKE_ENABLED:
    from urllib.parse import urlsplit
    u = urlsplit(PUBLIC_BASE_URL)
    if not u.hostname or u.username or u.password or u.query or u.fragment or u.path or u.scheme not in {'http', 'https'}:
        raise ImproperlyConfigured('Invalid ALISA_PUBLIC_BASE_URL')
    if u.scheme != 'https' and u.hostname not in {'127.0.0.1', 'localhost'}:
        raise ImproperlyConfigured('HTTPS public origin required')
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
EMAIL_HOST = os.environ.get('ALISA_SMTP_HOST', '127.0.0.1')
EMAIL_PORT = int(os.environ.get('ALISA_SMTP_PORT', '18225'))
EMAIL_TIMEOUT = 4
DEFAULT_FROM_EMAIL = 'alisa-test@example.invalid'
if LEAD_INTAKE_ENABLED and EMAIL_HOST not in {'127.0.0.1', 'localhost'}:
    raise ImproperlyConfigured('Only private synthetic SMTP sink is admitted')

CANONICAL_AUTH_ENABLED=os.environ.get('ALISA_CANONICAL_AUTH_ENABLED','0')=='1'
if os.environ.get('ALISA_CANONICAL_AUTH_ENABLED','0') not in {'0','1'} or CANONICAL_AUTH_ENABLED and ALISA_ENV!='stage':
    raise ImproperlyConfigured('Invalid canonical auth mode')
ACCOUNTS_ENABLED=os.environ.get('ALISA_ACCOUNTS_ENABLED')=='1'
AUTH_SERVICE_TOKEN=os.environ.get('ALISA_AUTH_SERVICE_TOKEN','')
IDENTITY_ISSUER=os.environ.get('ALISA_IDENTITY_ISSUER','').rstrip('/')
OIDC_CLIENT_ID=os.environ.get('ALISA_WEB_OIDC_CLIENT_ID','')
if ACCOUNTS_ENABLED:
    if ALISA_ENV=='prod':raise ImproperlyConfigured('Public account admission is not authorized')
    if len(AUTH_SERVICE_TOKEN)<32 or AUTH_SERVICE_TOKEN==SERVICE_TOKEN or not OIDC_CLIENT_ID:
        raise ImproperlyConfigured('Dedicated account service authority required')
    from urllib.parse import urlsplit
    u=urlsplit(IDENTITY_ISSUER)
    if u.path or u.query or u.fragment or u.username or u.password:raise ImproperlyConfigured('Invalid issuer')
    if ALISA_ENV=='stage' and IDENTITY_ISSUER!=('https://id.octoport.ru' if CANONICAL_AUTH_ENABLED else 'https://id-stage.octoport.ru'):raise ImproperlyConfigured('Wrong stage issuer')
    if ALISA_ENV=='dev' and not (u.scheme in {'http','https'} and u.hostname in {'127.0.0.1','localhost'}):raise ImproperlyConfigured('Dev issuer must be loopback')
DATA_UPLOAD_MAX_MEMORY_SIZE=32768

# Real-email admission is explicit. Existing accounts are never merged by email.
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
REAL_LOGIN_OPEN=os.environ.get('ALISA_REAL_LOGIN_OPEN','0')=='1'
if os.environ.get('ALISA_REAL_LOGIN_OPEN','0') not in {'0','1'}:
    raise ImproperlyConfigured('Invalid real-login admission mode')
if REAL_LOGIN_OPEN and ALISA_ENV not in {'stage','dev'}:
    raise ImproperlyConfigured('Real-login mode is not enabled for this environment')
REAL_LOGIN_RECIPIENTS=frozenset(x.strip().lower() for x in os.environ.get('ALISA_REAL_LOGIN_RECIPIENTS','').split(',') if x.strip())
try:
    if len(REAL_LOGIN_RECIPIENTS)>20:raise ValueError()
    for contact in REAL_LOGIN_RECIPIENTS:
        validate_email(contact)
        if len(contact)>254 or contact.endswith('@example.invalid'):raise ValueError()
    if REAL_LOGIN_RECIPIENTS and ALISA_ENV!='stage':raise ValueError()
except (ValidationError,ValueError):
    raise ImproperlyConfigured('Invalid closed-test login recipients') from None

# S03 source capability is closed until its own release/config approval.
STAFF_ENABLED=os.environ.get('ALISA_STAFF_ENABLED')=='1'
STAFF_SERVICE_TOKEN=os.environ.get('ALISA_STAFF_SERVICE_TOKEN','')
STAFF_CLIENT_ID=os.environ.get('ALISA_STAFF_OIDC_CLIENT_ID','')
if STAFF_ENABLED:
    if ALISA_ENV=='prod':raise ImproperlyConfigured('Public staff admission is not authorized')
    if not ACCOUNTS_ENABLED or len(STAFF_SERVICE_TOKEN)<32 or STAFF_SERVICE_TOKEN in {SERVICE_TOKEN,AUTH_SERVICE_TOKEN} or not STAFF_CLIENT_ID or STAFF_CLIENT_ID==OIDC_CLIENT_ID:
        raise ImproperlyConfigured('Dedicated staff authority required')
    if ALISA_ENV=='stage' and STAFF_CLIENT_ID!='alisa_admin_stage':raise ImproperlyConfigured('Wrong stage staff client')

ENTITLEMENTS_ENABLED = os.environ.get('ALISA_ENTITLEMENTS_ENABLED') == '1'
if ENTITLEMENTS_ENABLED and not ACCOUNTS_ENABLED:
    raise ImproperlyConfigured('Access requires the existing account boundary')

def access_limit(name, default, ceiling):
    value = int(os.environ.get(name, str(default)))
    if not 1 <= value <= ceiling:
        raise ImproperlyConfigured('Invalid access limit: ' + name)
    return value

ACCESS_LIMITS = {
    'ADMIN': {'days': access_limit('ALISA_ACCESS_ADMIN_DAYS', 30, 30),
              'recipients': access_limit('ALISA_ACCESS_ADMIN_RECIPIENTS', 10, 10),
              'budget': access_limit('ALISA_ACCESS_ADMIN_BUDGET', 300, 300)},
    'OWNER': {'days': access_limit('ALISA_ACCESS_OWNER_DAYS', 365, 365),
              'recipients': access_limit('ALISA_ACCESS_OWNER_RECIPIENTS', 50, 50),
              'budget': access_limit('ALISA_ACCESS_OWNER_BUDGET', 5000, 5000)},
}

# S05 is opt-in with a separate product vault; existing identity/BFF keys are not reused.
STORES_ENABLED = os.environ.get('ALISA_STORES_ENABLED', '0') == '1'
STORE_DATA_KEYS = [value for value in os.environ.get('ALISA_STORE_DATA_KEYS', '').split(',') if value]
STORE_CHECK_SOCKET = os.environ.get('ALISA_STORE_CHECK_SOCKET', '')
try:
    STORE_CHECK_UID = int(os.environ.get('ALISA_STORE_CHECK_UID', '-1'))
    if os.environ.get('ALISA_STORES_ENABLED', '0') not in {'0', '1'}:
        raise ValueError()
    if STORES_ENABLED:
        from cryptography.fernet import Fernet
        if not ACCOUNTS_ENABLED or not 1 <= len(STORE_DATA_KEYS) <= 5 or len(set(STORE_DATA_KEYS)) != len(STORE_DATA_KEYS):
            raise ValueError()
        for key in STORE_DATA_KEYS:
            Fernet(key.encode())
        if set(STORE_DATA_KEYS) & set(os.environ.get('ALISA_IDENTITY_DATA_KEYS', '').split(',')):
            raise ValueError()
    if STORE_CHECK_SOCKET:
        if not STORES_ENABLED or STORE_CHECK_UID < 0:
            raise ValueError()
        if ALISA_ENV != 'dev' and STORE_CHECK_SOCKET != '/run/alice-market/store-check.sock':
            raise ValueError()
        if ALISA_ENV == 'dev' and (not STORE_CHECK_SOCKET.startswith('/') or '..' in STORE_CHECK_SOCKET.split('/')):
            raise ValueError()
except (ValueError, TypeError):
    raise ImproperlyConfigured('Invalid store vault or RT-CHECK configuration') from None

# Skill OAuth is independent of browser OIDC and opt-in; legacy lab grants stay intact.
ALICE_LINK_ENABLED = os.environ.get('ALISA_ALICE_LINK_ENABLED', '0') == '1'
ALICE_CLIENT_ID = os.environ.get('ALISA_ALICE_CLIENT_ID', '')
ALICE_CLIENT_SECRET = os.environ.get('ALISA_ALICE_CLIENT_SECRET', '')
ALICE_SKILL_ID = os.environ.get('ALISA_ALICE_SKILL_ID', '')
ALICE_DATA_KEYS = [key for key in os.environ.get('ALISA_ALICE_DATA_KEYS', '').split(',') if key]
try:
    if os.environ.get('ALISA_ALICE_LINK_ENABLED', '0') not in {'0', '1'}:
        raise ValueError()
    if ALICE_LINK_ENABLED:
        from cryptography.fernet import Fernet
        import uuid
        if (not ACCOUNTS_ENABLED or not 1 <= len(ALICE_CLIENT_ID) <= 100 or len(ALICE_CLIENT_SECRET) < 32
                or ALICE_CLIENT_SECRET in {SERVICE_TOKEN, AUTH_SERVICE_TOKEN, STAFF_SERVICE_TOKEN}
                or not 1 <= len(ALICE_DATA_KEYS) <= 5 or len(set(ALICE_DATA_KEYS)) != len(ALICE_DATA_KEYS)):
            raise ValueError()
        uuid.UUID(ALICE_SKILL_ID)
        for key in ALICE_DATA_KEYS:
            Fernet(key.encode())
        if set(ALICE_DATA_KEYS) & (set(STORE_DATA_KEYS) | set(os.environ.get('ALISA_IDENTITY_DATA_KEYS', '').split(','))):
            raise ValueError()
except (ValueError, TypeError):
    raise ImproperlyConfigured('Invalid Alice account-link configuration') from None

# Runtime authority is separate from browser, skill and owner-data service tokens.
RUNTIME_AUTHORITY_ENABLED = os.environ.get('ALISA_RUNTIME_AUTHORITY_ENABLED', '0') == '1'
RUNTIME_AUTHORITY_TOKEN = os.environ.get('ALISA_RUNTIME_AUTHORITY_TOKEN', '')
RUNTIME_BINDINGS_PATH = os.environ.get('ALISA_RUNTIME_BINDINGS_PATH', '')
RUNTIME_SERVICE_ID = os.environ.get('ALISA_RUNTIME_SERVICE_ID', '')
RUNTIME_CATALOG_RELEASE_ID = os.environ.get('ALISA_RUNTIME_CATALOG_RELEASE_ID', '')
if os.environ.get('ALISA_RUNTIME_AUTHORITY_ENABLED', '0') not in {'0', '1'}:
    raise ImproperlyConfigured('Invalid runtime authority mode')
if RUNTIME_AUTHORITY_ENABLED:
    import hmac
    import re
    if (not (ACCOUNTS_ENABLED and STORES_ENABLED and ENTITLEMENTS_ENABLED)
        or not re.fullmatch(r'[A-Za-z0-9_-]{43,128}', RUNTIME_AUTHORITY_TOKEN)
        or not RUNTIME_BINDINGS_PATH.startswith('/') or '..' in RUNTIME_BINDINGS_PATH.split('/')
        or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', RUNTIME_SERVICE_ID)
        or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', RUNTIME_CATALOG_RELEASE_ID)
        or any(value and hmac.compare_digest(RUNTIME_AUTHORITY_TOKEN, value) for value in
               [SERVICE_TOKEN, AUTH_SERVICE_TOKEN, STAFF_SERVICE_TOKEN, ALICE_CLIENT_SECRET,
                os.environ.get('ALISA_OWNER_RUNTIME_AUTH_TOKEN', '')])):
        raise ImproperlyConfigured('Invalid runtime authority boundary')

# Owner-data entry remains separate from analytical execution and authentication.
OWNER_DATA_ENABLED = os.environ.get("ALISA_OWNER_DATA_ENABLED", "0") == "1"
OWNER_RUNTIME_ENABLED = os.environ.get("ALISA_OWNER_RUNTIME_ENABLED", "0") == "1"
OWNER_RUNTIME_AUTH_TOKEN = os.environ.get("ALISA_OWNER_RUNTIME_AUTH_TOKEN", "")
if any(os.environ.get(k,"0") not in {"0","1"} for k in ("ALISA_OWNER_DATA_ENABLED","ALISA_OWNER_RUNTIME_ENABLED")):
    raise RuntimeError("Invalid owner feature flag")
if OWNER_DATA_ENABLED and not (ACCOUNTS_ENABLED and STORES_ENABLED and ENTITLEMENTS_ENABLED):
    raise RuntimeError("Owner data requires accounts, stores and entitlements")
if OWNER_RUNTIME_ENABLED and not OWNER_DATA_ENABLED:
    raise RuntimeError("Owner runtime requires owner data")

INSTALLED_APPS += ['alisa_platform.queries']
QUERIES_ENABLED = os.environ.get('ALISA_QUERIES_ENABLED', '0') == '1'
RUNTIME_VERSIONS_PATH = os.environ.get('ALISA_RUNTIME_VERSIONS_PATH', '')
RUNTIME_JOB_SOCKET = os.environ.get('ALISA_RUNTIME_JOB_SOCKET', '')
try:
    RUNTIME_JOB_UID = int(os.environ.get('ALISA_RUNTIME_JOB_UID', '-1'))
except ValueError:
    raise ImproperlyConfigured('Invalid runtime UID') from None
if os.environ.get('ALISA_QUERIES_ENABLED', '0') not in {'0', '1'} or (QUERIES_ENABLED and
        (not RUNTIME_AUTHORITY_ENABLED or RUNTIME_JOB_UID < 0 or
         not RUNTIME_VERSIONS_PATH.startswith('/') or not RUNTIME_JOB_SOCKET.startswith('/'))):
    raise ImproperlyConfigured('Invalid query runtime configuration')
