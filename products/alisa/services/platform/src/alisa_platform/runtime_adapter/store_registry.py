"""Server-assigned store references; live credentials remain in the product vault.

Enrollment follows a successful provider identity check in its transaction.
Reading this registry grants neither access nor a key; normal authority must
resolve the exact current job scope before the private credential RPC can read.
"""
from copy import deepcopy
import hashlib

from django.conf import settings
from django.db import transaction

from alisa_platform.stores.models import (Store, CredentialRevision, RuntimeTenantBinding,
                                          RuntimeStoreBinding, VaultSecret)
from alisa_platform.stores import vault, policy
from .job_client import encode, exact, need

CONFIRMED = {'CONNECTED', 'CONNECTED_NATIVE_OWNER'}
FIELDS = {'SELLER': {'client_id': 'seller_client_id', 'api_key': 'seller_api_key'},
          'PERFORMANCE': {'client_id': 'performance_client_id', 'client_secret': 'performance_client_secret'},
          'WB': {'token': 'seller_token'}}


def enabled():
    return getattr(settings, 'RUNTIME_AUTO_BINDINGS_ENABLED', False) is True


def active_credentials(store):
    rows = list(CredentialRevision.objects.filter(store=store, status='ACTIVE').order_by('kind', 'id'))
    kinds = [r.kind for r in rows]
    allowed = {'SELLER', 'PERFORMANCE'} if store.provider == 'OZON' else {'WB'}
    required = 'SELLER' if store.provider == 'OZON' else 'WB'
    if (required not in kinds or len(kinds) != len(set(kinds)) or not set(kinds) <= allowed
            or any(r.check_code not in CONFIRMED for r in rows)):
        return []
    return rows


def enroll(store):
    """Caller holds customer/tenant/store locks after its identity check."""
    if not enabled():
        return
    need(store.status == 'ACTIVE' and bool(store.verified_identity), 'CAPABILITY_UNAVAILABLE')
    if not active_credentials(store):
        return  # A Performance-only check cannot create a Seller identity.
    from .authority_rpc import configured_authority
    authority = configured_authority()
    old = authority.bindings.load(environment=settings.ALISA_ENV, service_id=authority.service_id,
                                  catalog_release_id=authority.catalog_release_id).get(str(store.tenant_id))
    tenant_defaults = {'native_tenant': old['runtime_tenant']} if old else {}
    tenant, _ = RuntimeTenantBinding.objects.get_or_create(tenant_id=store.tenant_id, defaults=tenant_defaults)
    need(not old or tenant.native_tenant == old['runtime_tenant'], 'CAPABILITY_UNAVAILABLE')
    existing = old['stores'].get(str(store.pk)) if old else None
    values = {'tenant_id': store.tenant_id, 'verified_identity': store.verified_identity}
    if existing:
        need(existing['provider'] == store.provider and
             existing['verified_identity'] == store.verified_identity, 'CAPABILITY_UNAVAILABLE')
        values.update(native_id=existing['runtime_store']['id'], native_identity=existing['runtime_store']['identity'])
    row, _ = RuntimeStoreBinding.objects.get_or_create(store=store, defaults=values)
    need(row.tenant_id == store.tenant_id and row.verified_identity == store.verified_identity,
         'CAPABILITY_UNAVAILABLE')


def overlay(tenant_id, legacy):
    if not enabled():
        return legacy
    tenant = RuntimeTenantBinding.objects.filter(tenant_id=tenant_id).first()
    if tenant is None:
        return legacy
    need(not legacy or tenant.native_tenant == legacy['runtime_tenant'], 'CAPABILITY_UNAVAILABLE')
    result = deepcopy(legacy) if legacy else {'runtime_tenant': tenant.native_tenant,
        'revision': 'registry-v1:' + tenant.native_tenant, 'stores': {}}
    # Retired references remain for stable identity/history, but are not an
    # ever-growing lifetime quota. Also remove their legacy fallback explicitly.
    enrolled_legacy = RuntimeStoreBinding.objects.filter(tenant_id=tenant_id,
        store_id__in=list(result['stores'])).values_list('store_id', flat=True)
    for sid in enrolled_legacy:
        result['stores'].pop(str(sid), None)
    rows = list(RuntimeStoreBinding.objects.filter(tenant_id=tenant_id,
        store__status='ACTIVE', store__product_id='alisa_market').select_related('store')[:1001])
    need(len(rows) <= 1000, 'CAPABILITY_UNAVAILABLE')
    for binding in rows:
        store = binding.store
        sid = str(store.pk)
        result['stores'].pop(sid, None)  # An enrolled invalid key never falls back to an old file.
        if (store.tenant_id != binding.tenant_id or store.product_id != 'alisa_market' or
                store.status != 'ACTIVE' or store.verified_identity != binding.verified_identity):
            continue
        credentials = active_credentials(store)
        if not credentials:
            continue
        refs = [{'id': str(r.pk), 'kind': r.kind, 'revision': r.revision} for r in credentials]
        source = hashlib.sha256(encode({'store_id': sid, 'identity': store.verified_identity,
                                         'credentials': refs})).hexdigest()
        result['stores'][sid] = {'store_id': sid, 'provider': store.provider,
            'verified_identity': store.verified_identity, 'credential_revision': store.revision,
            'credentials': refs, 'runtime_store': {'id': binding.native_id, 'platform': store.provider.lower(),
                'identity': binding.native_identity, 'access_revision': str(store.revision),
                'source_revision': 'platform:' + source, 'currency': 'RUB'}}
    need(len(result['stores']) <= 1000, 'CAPABILITY_UNAVAILABLE')
    return result


@transaction.atomic
def credentials(authority, payload):
    """Private native RPC only; never used by a browser or an ordinary projection."""
    need(enabled(), 'CAPABILITY_UNAVAILABLE')
    exact(payload, {'pins', 'store'})
    scope = authority.resolve(payload['pins'], 'execute')
    current = [s for s in scope['stores'] if s == payload['store']]
    need(len(current) == 1 and current[0]['source_revision'].startswith('platform:'), 'PERMISSION_DENIED')
    tenant_id = payload['pins']['tenant_id']
    binding = RuntimeStoreBinding.objects.select_related('store').filter(
        tenant_id=tenant_id, native_id=current[0]['id']).first()
    need(binding is not None, 'PERMISSION_DENIED')
    store = binding.store
    need(store.tenant_id == binding.tenant_id and store.verified_identity == binding.verified_identity,
         'PERMISSION_DENIED')
    material = {}
    for revision in active_credentials(store):
        secret = VaultSecret.objects.get(pk=revision.secret_id, tenant_id=tenant_id, store=store)
        value = policy.credential(revision.kind, vault.open_secret(store, revision, secret))
        material.update({target: value[source] for source, target in FIELDS[revision.kind].items()})
    need(bool(material), 'CREDENTIAL_REVOKED')
    # Keep authorization and secret read in the SAME authority transaction.
    fresh = authority.resolve(payload['pins'], 'execute')
    need(fresh == scope, 'PERMISSION_DENIED')
    return {'store': deepcopy(current[0]), 'credentials': material}
