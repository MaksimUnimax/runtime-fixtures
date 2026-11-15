import uuid
from django.conf import settings
from django.db import transaction
from alisa_platform.accounts.views import boundary, exact
from alisa_platform.foundation.views import reply
from alisa_platform.runtime_adapter.authority import SessionPrincipal
from alisa_platform.runtime_adapter.client import configured_client
from alisa_platform.runtime_adapter.job_client import RuntimeFailure
from alisa_platform.queries.service import actor, client
from alisa_platform.staff.views import boundary as staff_boundary
from alisa_platform.stores.models import Store, PRODUCT
from alisa_platform.entitlements.models import AccessGrant
from .reader import read, preview_metadata


class MetadataOnly:
    def prepare(self, operation):
        raise RuntimeFailure('PERMISSION_DENIED')
    def current(self, context, operation):
        return False


def store_context(tenant, store_id):
    if type(store_id) is not str or str(uuid.UUID(store_id)) != store_id:
        raise ValueError()
    row = Store.objects.filter(pk=store_id, product_id=PRODUCT, tenant_id=tenant,
                               status='ACTIVE').values_list('provider', 'revision').first()
    if row is None or row[0] not in {'OZON', 'WB'}:
        raise RuntimeFailure('PERMISSION_DENIED')
    return row


def unprovisioned(tenant):
    # Any past, scheduled, expired or revoked grant keeps its existing gate.
    return not AccessGrant.objects.filter(product_id=PRODUCT, tenant_id=tenant).exists()


@boundary
def customer(request, data):
    if not getattr(settings, 'QUESTION_CATALOG_ENABLED', False): return reply({'code': 'NOT_FOUND'}, 404)
    exact(data, {'session_token', 'store_id', 'query'})
    query = data['query']
    if (type(query) is not dict or set(query) != {'search', 'kind', 'offset'} or
            type(query['search']) is not str or len(query['search']) > 200 or
            type(query['kind']) is not str or query['kind'] not in {'', 'scalar', 'compound', 'dataset', 'formula', 'event', 'information', 'parameter'} or
            type(query['offset']) is not int or not 0 <= query['offset'] <= 1000):
        return reply({'code': 'INVALID_PAYLOAD'}, 422)
    try:
        principal = SessionPrincipal(data['session_token']); before = actor(principal)
        store = store_context(before[1], data['store_id'])
        preview = unprovisioned(before[1])
        if preview:
            # Published definitions before first access provision. No work ticket,
            # credentials, dry compilation or execution permission is requested.
            metadata = read(configured_client(MetadataOnly()), scoped=False)
            result = preview_metadata(metadata, store[0].lower(), data['store_id'], query)
        else:
            result = read(client(principal, [data['store_id']]), scoped=True, query=data['query'])
        if actor(principal) != before: return reply({'code': 'AUTH_REQUIRED'}, 401)
        if store_context(before[1], data['store_id']) != store:
            return reply({'code': 'PERMISSION_DENIED'}, 403)
        if preview and not unprovisioned(before[1]):
            return reply({'code': 'ACCESS_REQUIRED'}, 403)
        result['preview_only'] = preview
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
