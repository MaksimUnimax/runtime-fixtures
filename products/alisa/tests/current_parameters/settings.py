"""Test-only settings: no live configuration or secret is loaded."""
import os
from pathlib import Path
socket=os.environ.get('PARAMETER_TEST_SOCKET','')
if not socket.startswith('/dev/shm/alisa-current-parameters-pg-')or not Path(socket).is_dir():
    raise RuntimeError('Only the owned disposable PostgreSQL Unix socket is allowed')
SECRET_KEY='synthetic-current-parameters-test-not-production'
AUTH_SERVICE_TOKEN='synthetic-only-account-boundary-token-00000000'
SERVICE_TOKEN='synthetic-only-service-token-00000000000000000'
ALISA_ENV='dev'
DEBUG=False
USE_TZ=True
TIME_ZONE='UTC'
DEFAULT_AUTO_FIELD='django.db.models.BigAutoField'
ALLOWED_HOSTS=['testserver']
ACCOUNTS_ENABLED=True
OWNER_DATA_ENABLED=True
OWNER_PARAMETERS_ENABLED=True
ENTITLEMENTS_ENABLED=False
INSTALLED_APPS=['alisa_platform.foundation','alisa_platform.leads','alisa_platform.funnel',
                'alisa_platform.accounts','alisa_platform.stores','alisa_platform.owner_data']
DATABASES={'default':{'ENGINE':'django.db.backends.postgresql','NAME':'parameter_test',
                     'USER':'postgres','HOST':socket,'PORT':'5432','TEST':{'NAME':'test_parameter_test'}}}
ROOT_URLCONF='current_parameters.urls'
MIDDLEWARE=[]

RELEASE='current-parameters-disposable-test'
