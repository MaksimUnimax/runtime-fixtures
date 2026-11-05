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
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "django.contrib.sessions", "django.contrib.messages",
                  "octoport_identity.accounts", "allauth", "allauth.account", "allauth.mfa", "allauth.idp", "allauth.idp.oidc"]
AUTH_USER_MODEL = "accounts.Person"
MIDDLEWARE = ["django.middleware.security.SecurityMiddleware", "octoport_identity.protocol.middleware.IdentityPolicy",
              "django.contrib.sessions.middleware.SessionMiddleware", "django.middleware.common.CommonMiddleware",
              "django.middleware.csrf.CsrfViewMiddleware", "django.contrib.auth.middleware.AuthenticationMiddleware",
              "django.contrib.messages.middleware.MessageMiddleware", "allauth.account.middleware.AccountMiddleware"]
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

# Auth is an explicit release/config capability; old shell config stays closed.
IDENTITY_ENABLED = os.environ.get('ALISA_IDENTITY_ENABLED')=='1'
IDENTITY_ISSUER = os.environ.get('ALISA_IDENTITY_ISSUER','').rstrip('/')
IDENTITY_DATA_KEYS = os.environ.get('ALISA_IDENTITY_DATA_KEYS','').split(',') if IDENTITY_ENABLED else []
if IDENTITY_ENABLED:
    import base64,json
    from urllib.parse import urlsplit
    from cryptography.fernet import Fernet
    u=urlsplit(IDENTITY_ISSUER)
    if u.path or u.query or u.fragment or u.username or u.password or not u.hostname:
        raise ImproperlyConfigured('Invalid fixed identity issuer')
    if ALISA_ENV=='stage' and IDENTITY_ISSUER!='https://id-stage.octoport.ru':raise ImproperlyConfigured('Wrong stage issuer')
    if ALISA_ENV=='prod':raise ImproperlyConfigured('Public identity admission is not authorized')
    if ALISA_ENV=='dev' and not (u.scheme in {'http','https'} and u.hostname in {'localhost','127.0.0.1'}):raise ImproperlyConfigured('Dev issuer must be loopback')
    try:
        for key in IDENTITY_DATA_KEYS:Fernet(key.encode())
        if not IDENTITY_DATA_KEYS:raise ValueError()
        IDP_OIDC_PRIVATE_KEYS=json.loads(base64.b64decode(required('ALISA_IDENTITY_SIGNING_KEYS_B64'),validate=True))
        if not isinstance(IDP_OIDC_PRIVATE_KEYS,list) or not IDP_OIDC_PRIVATE_KEYS:raise ValueError()
    except (ValueError,TypeError):raise ImproperlyConfigured('Invalid identity private key configuration') from None

AUTHENTICATION_BACKENDS = ['django.contrib.auth.backends.ModelBackend','allauth.account.auth_backends.AuthenticationBackend']
TEMPLATES = [{'BACKEND':'django.template.backends.django.DjangoTemplates','APP_DIRS':True,
 'OPTIONS':{'context_processors':['django.template.context_processors.request','django.contrib.auth.context_processors.auth','django.contrib.messages.context_processors.messages','octoport_identity.protocol.views.brand_context']}}]
LANGUAGE_CODE='ru'
USE_I18N=True
TIME_ZONE='UTC'
ACCOUNT_ADAPTER='octoport_identity.protocol.adapter.AccountAdapter'
MFA_ADAPTER='octoport_identity.protocol.adapter.MFAAdapter'
ACCOUNT_FORMS={'signup':'octoport_identity.protocol.forms.SignupForm',
 'login':'octoport_identity.protocol.forms.LoginForm','request_login_code':'octoport_identity.protocol.forms.RequestLoginCodeForm'}
ACCOUNT_LOGIN_METHODS={'email'}
ACCOUNT_SIGNUP_FIELDS=['email*']
ACCOUNT_EMAIL_VERIFICATION='mandatory'
ACCOUNT_EMAIL_VERIFICATION_BY_CODE_ENABLED=True
ACCOUNT_EMAIL_VERIFICATION_BY_CODE_TIMEOUT=600
ACCOUNT_EMAIL_VERIFICATION_BY_CODE_MAX_ATTEMPTS=5
ACCOUNT_LOGIN_BY_CODE_ENABLED=True
ACCOUNT_LOGIN_BY_CODE_REQUIRED=True
ACCOUNT_LOGIN_BY_CODE_TIMEOUT=600
ACCOUNT_LOGIN_BY_CODE_MAX_ATTEMPTS=5
ACCOUNT_PREVENT_ENUMERATION=True
ACCOUNT_RATE_LIMITS={'request_login_code':'5/m/key','login_failed':'5/m/key','signup':'5/m/ip'}
LOGIN_REDIRECT_URL='/accounts/'
ACCOUNT_LOGOUT_REDIRECT_URL='/accounts/login/'
SESSION_COOKIE_NAME='__Host-alisa_identity'
SESSION_COOKIE_HTTPONLY=True
SESSION_COOKIE_SAMESITE='Lax'
SESSION_COOKIE_DOMAIN=None
SESSION_COOKIE_AGE=8*3600
SESSION_SERIALIZER='octoport_identity.protocol.storage.SessionSerializer' if IDENTITY_ENABLED else 'django.contrib.sessions.serializers.JSONSerializer'
CSRF_COOKIE_NAME='__Host-alisa_identity_csrf'
CSRF_COOKIE_HTTPONLY=True
CSRF_COOKIE_SAMESITE='Lax'
CSRF_TRUSTED_ORIGINS=[IDENTITY_ISSUER] if IDENTITY_ENABLED else []
SECURE_PROXY_SSL_HEADER=('HTTP_X_FORWARDED_PROTO','https')
IDP_OIDC_ADAPTER='octoport_identity.protocol.adapter.OIDCAdapter'
IDP_OIDC_DCR_ENABLED=False
IDP_OIDC_CIMD_ENABLED=False
IDP_OIDC_AUTH_METHODS=('client_secret_basic',)
IDP_OIDC_AUTHORIZATION_CODE_EXPIRES_IN=60
CACHES={'default':{'BACKEND':'octoport_identity.protocol.storage.PrivateDatabaseCache','LOCATION':'identity_protocol_cache',
                  'KEY_FUNCTION':'octoport_identity.protocol.storage.cache_key','OPTIONS':{'MAX_ENTRIES':10000}}} if IDENTITY_ENABLED else {'default':{'BACKEND':'django.core.cache.backends.locmem.LocMemCache'}}
EMAIL_HOST=os.environ.get('ALISA_SMTP_HOST','127.0.0.1')
EMAIL_PORT=int(os.environ.get('ALISA_SMTP_PORT','18225'))
EMAIL_TIMEOUT=4
EMAIL_BACKEND='django.core.mail.backends.smtp.EmailBackend'
DEFAULT_FROM_EMAIL='alisa-identity@example.invalid'
IDENTITY_PRODUCT_ORIGIN=os.environ.get('ALISA_PRODUCT_ORIGIN','https://alisa-stage.octoport.ru')
if IDENTITY_ENABLED and EMAIL_HOST not in {'localhost','127.0.0.1'}:raise ImproperlyConfigured('Private synthetic SMTP required')
DATA_UPLOAD_MAX_MEMORY_SIZE=16384
LOGGING={'version':1,'disable_existing_loggers':False,'handlers':{'console':{'class':'logging.StreamHandler'}},
         'loggers':{'django.request':{'handlers':['console'],'level':'CRITICAL','propagate':False},
                    'oauthlib':{'handlers':['console'],'level':'CRITICAL','propagate':False}}}

# An explicit closed-test invitation, not public registration or email-based account linking.
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
REAL_LOGIN_RECIPIENTS=frozenset(x.strip().lower() for x in os.environ.get('ALISA_REAL_LOGIN_RECIPIENTS','').split(',') if x.strip())
try:
    if len(REAL_LOGIN_RECIPIENTS)>20:raise ValueError()
    for contact in REAL_LOGIN_RECIPIENTS:
        validate_email(contact)
        if len(contact)>254 or contact.endswith('@example.invalid'):raise ValueError()
    if REAL_LOGIN_RECIPIENTS and ALISA_ENV!='stage':raise ValueError()
except (ValidationError,ValueError):
    raise ImproperlyConfigured('Invalid closed-test login recipients') from None

REAL_SMTP=None
if REAL_LOGIN_RECIPIENTS:
    from pathlib import Path
    import stat
    try:
        secret_file=Path(required('ALISA_REAL_SMTP_PASSWORD_FILE'))
        if not secret_file.is_absolute() or not secret_file.is_file():raise ValueError()
        if stat.S_IMODE(secret_file.stat().st_mode)&0o007:raise ValueError()
        secret=secret_file.read_text().strip()
        if len(secret)<32:raise ValueError()
        REAL_SMTP={'host':'mail.octoport.ru','port':25,
                   'username':'alisa-mailer@octoport.ru','password':secret,
                   'use_tls':True,'use_ssl':False,'timeout':4}
        REAL_FROM_EMAIL='no-reply@octoport.ru'
    except (OSError,ValueError):
        raise ImproperlyConfigured('Private real-mail transport configuration required') from None
