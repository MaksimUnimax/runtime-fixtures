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
INSTALLED_APPS = ["alisa_platform.foundation", "alisa_platform.leads", "alisa_platform.funnel"]
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
