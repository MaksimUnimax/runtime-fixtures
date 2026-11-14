from django.conf import settings
from django.db import transaction
from alisa_platform.accounts.views import boundary, exact
from alisa_platform.foundation.views import reply
from alisa_platform.runtime_adapter.authority import SessionPrincipal
from alisa_platform.runtime_adapter.client import configured_client
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from alisa_platform.queries.service import actor, client
from alisa_platform.staff.views import boundary as staff_boundary
from .reader import read


class MetadataOnly:
    def prepare(self, operation):
        raise RuntimeFailure('PERMISSION_DENIED')
    def current(self, context, operation):
        return False


@boundary
def customer(request, data):
    if not getattr(settings, 'QUESTION_CATALOG_ENABLED', False): return reply({'code': 'NOT_FOUND'}, 404)
    exact(data, {'session_token', 'store_id', 'query'})
    query = data['query']
    if (type(query) is not dict or set(query) != {'search', 'kind', 'offset'} or
            type(query['search']) is not str or len(query['search']) > 200 or
            type(query['kind']) is not str or query['kind'] not in {'', 'scalar', 'compound', 'dataset', 'formula', 'event', 'information'} or
            type(query['offset']) is not int or not 0 <= query['offset'] <= 1000):
        return reply({'code': 'INVALID_PAYLOAD'}, 422)
    try:
        principal = SessionPrincipal(data['session_token']); before = actor(principal)
        result = read(client(principal, [data['store_id']]), scoped=True, query=data['query'])
        if actor(principal) != before: return reply({'code': 'AUTH_REQUIRED'}, 401)
        for row in result['items']:
            row['availability'] = [{'store_id': data['store_id'], 'status': value['status']}
                                   for value in row['availability']]
        return reply(result)
    except RuntimeFailure as error: return reply({'code': error.code}, error.http_status)


@staff_boundary
def staff(request, data):
    if not getattr(settings, 'QUESTION_CATALOG_ENABLED', False): return reply({'code': 'NOT_FOUND'}, 404)
    exact(data, {'session_token'})
    from alisa_platform.staff.service import principal, audit
    try:
        with transaction.atomic():
            owner = principal(data['session_token'], 'staff.manage')
            if owner is None: return reply({'code': 'FORBIDDEN'}, 403)
            owner_id = owner.pk
        # No user-store ticket or business request. Native verifies the service peer.
        result = read(configured_client(MetadataOnly()), scoped=False)
        with transaction.atomic():
            owner = principal(data['session_token'], 'staff.manage')
            if owner is None or owner.pk != owner_id: return reply({'code': 'FORBIDDEN'}, 403)
            audit(owner, 'catalog.read', None, 'STAFF_READ', 'READ', after={'count': len(result['items'])})
        return reply(result)
    except RuntimeFailure as error: return reply({'code': error.code}, error.http_status)
