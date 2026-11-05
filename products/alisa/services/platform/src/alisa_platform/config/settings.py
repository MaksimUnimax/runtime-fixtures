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
INSTALLED_APPS = ["alisa_platform.foundation", "alisa_platform.leads", "alisa_platform.funnel", "alisa_platform.accounts", "alisa_platform.staff", "alisa_platform.entitlements"]
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
