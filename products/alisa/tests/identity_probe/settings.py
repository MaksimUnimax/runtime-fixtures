"""Settings for a private, separately initialized PostgreSQL cluster only."""
import os
from pathlib import Path
import re
import secrets

from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

socket = Path(os.environ.get('ALISA_S02_PROBE_SOCKET', ''))
if not re.fullmatch(r'/var/lib/alisa-platform/testing/s02-provider-[0-9a-f]{12}/socket', str(socket)):
    raise RuntimeError('A separately provisioned S02 probe socket is required')
if (socket.parent/'PROBE_ONLY').read_text().strip() != 'ALISA_S02_DISPOSABLE_PROVIDER':
    raise RuntimeError('Disposable cluster marker missing')

SECRET_KEY = secrets.token_urlsafe(48)
DEBUG = False
ALLOWED_HOSTS = ['id-probe.example.invalid', 'alternate-probe.example.invalid']
ROOT_URLCONF = 'identity_probe.urls'
AUTH_USER_MODEL = 'accounts.Person'
INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions',
                  'django.contrib.messages', 'octoport_identity.accounts', 'allauth',
                  'allauth.account', 'allauth.mfa', 'allauth.idp', 'allauth.idp.oidc']
MIDDLEWARE = ['django.middleware.security.SecurityMiddleware', 'django.contrib.sessions.middleware.SessionMiddleware',
              'django.middleware.csrf.CsrfViewMiddleware', 'django.contrib.auth.middleware.AuthenticationMiddleware',
              'django.contrib.messages.middleware.MessageMiddleware', 'allauth.account.middleware.AccountMiddleware']
AUTHENTICATION_BACKENDS = ['django.contrib.auth.backends.ModelBackend', 'allauth.account.auth_backends.AuthenticationBackend']
DATABASES = {'default': {'ENGINE': 'django.db.backends.postgresql', 'NAME': 'alisa_s02_probe',
                         'HOST': str(socket), 'USER': 'postgres', 'PORT': '5432',
                         'OPTIONS': {'connect_timeout': 3}}}
TEMPLATES = [{'BACKEND': 'django.template.backends.django.DjangoTemplates', 'APP_DIRS': True,
              'OPTIONS': {'context_processors': ['django.template.context_processors.request',
                                                  'django.contrib.auth.context_processors.auth',
                                                  'django.contrib.messages.context_processors.messages']}}]
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
DEFAULT_FROM_EMAIL = 'probe@example.invalid'
ACCOUNT_LOGIN_METHODS = {'email'}
ACCOUNT_SIGNUP_FIELDS = ['email*']
ACCOUNT_EMAIL_VERIFICATION = 'mandatory'
ACCOUNT_EMAIL_VERIFICATION_BY_CODE_ENABLED = True
ACCOUNT_LOGIN_BY_CODE_ENABLED = True
ACCOUNT_LOGIN_BY_CODE_REQUIRED = True
ACCOUNT_LOGIN_BY_CODE_MAX_ATTEMPTS = 5
ACCOUNT_LOGIN_BY_CODE_TIMEOUT = 900
ACCOUNT_RATE_LIMITS = {'request_login_code': '20/m/key'}
LOGIN_REDIRECT_URL = '/probe/complete'
ACCOUNT_LOGOUT_REDIRECT_URL = '/probe/complete'
SESSION_COOKIE_SECURE = True
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = 'Lax'
SESSION_COOKIE_DOMAIN = None
CSRF_COOKIE_SECURE = True
USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
IDP_OIDC_DCR_ENABLED = False
IDP_OIDC_CIMD_ENABLED = False
IDP_OIDC_AUTH_METHODS = ('none', 'client_secret_basic')

def test_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048).private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()

IDP_OIDC_PRIVATE_KEY = test_key()

PROBE_POLICY_ENABLED = os.environ.get('ALISA_S02_PROBE_POLICY')=='1'
if PROBE_POLICY_ENABLED:
    IDP_OIDC_ADAPTER = 'identity_probe.policy.FixedIssuerAdapter'
    MIDDLEWARE.insert(0,'identity_probe.policy.ProviderPolicy')
    CACHES = {'default': {'BACKEND':'django.core.cache.backends.db.DatabaseCache',
                          'LOCATION':'s02_probe_cache','OPTIONS':{'MAX_ENTRIES':10000}}}
