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
INSTALLED_APPS = ["alisa_platform.foundation"]
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
DATA_UPLOAD_MAX_MEMORY_SIZE = 1024
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SECURE_SSL_REDIRECT = False  # upstream loopback; TLS is terminated at ingress
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
LOGGING = {"version": 1, "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "loggers": {"alisa.foundation": {"handlers": ["console"], "level": "INFO", "propagate": False}}}
