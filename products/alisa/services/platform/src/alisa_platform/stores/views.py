from django.conf import settings
from alisa_platform.accounts.views import boundary, exact
from alisa_platform.foundation.views import reply
from . import service, vault


@boundary
def stores(request, data):
    exact(data, {'session_token', 'command'})
    if not settings.STORES_ENABLED:
        return reply({'code': 'NOT_FOUND'}, 404)
    try:
        value, status = service.execute(data['session_token'], data['command'])
        return reply(value, status)
    except service.Rejected as error:
        return reply({'code': error.code}, error.status)
    except vault.VaultUnavailable:
        return reply({'code': 'VAULT_UNAVAILABLE'}, 503)
