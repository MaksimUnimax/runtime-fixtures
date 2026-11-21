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
if len(SECRET_KEY) < 32:
    raise ImproperlyConfigured("Identity secret must be at least 32 characters")
RELEASE = required("ALISA_RELEASE")
DEBUG = False
ALLOWED_HOSTS = required("ALISA_ALLOWED_HOSTS").split(",")
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "octoport_identity.accounts"]
AUTH_USER_MODEL = "accounts.Person"
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "django.middleware.common.CommonMiddleware"]
ROOT_URLCONF = "octoport_identity.config.urls"
WSGI_APPLICATION = "octoport_identity.config.wsgi.application"
DATABASES = {"default": {
    "ENGINE": "django.db.backends.postgresql", "NAME": required("ALISA_DB_NAME"),
    "USER": required("ALISA_DB_USER"), "PASSWORD": required("ALISA_DB_PASSWORD"),
    "HOST": required("ALISA_DB_HOST"), "PORT": required("ALISA_DB_PORT"),
    "CONN_MAX_AGE": 0, "OPTIONS": {"connect_timeout": 3},
}}
USE_TZ = True
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
