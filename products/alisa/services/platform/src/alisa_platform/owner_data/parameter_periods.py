"""One server-resolved period, bound to the current owner/store/source revisions.

This reference preserves a preparation; it grants no execution or write rights.
No first row, API error or registration date is used as a history boundary.
"""
from copy import deepcopy
from zoneinfo import ZoneInfo
from django.core import signing
from django.utils import timezone
from django.utils.crypto import salted_hmac
from alisa_platform.stores.models import CredentialRevision
from .models import PRODUCT
from .service import need, Rejected
from .parameter_contract import CANON, CATALOG_HASH, resolve_period, checked_period
from .parameter_producers import HASH as PRODUCER_HASH

SALT = 'alisa.parameter.prepared-period.v1'
MAX_AGE = 180


def _binding(actor, store, key, area, request, mode):
    credentials = list(CredentialRevision.objects.filter(
        product_id=PRODUCT, tenant_id=actor.tenant_id, store=store, status='ACTIVE'
    ).order_by('id').values_list('id', 'kind', 'revision', 'check_code'))
    facts = {
        'session': str(actor.pk), 'tenant': str(actor.tenant_id),
        'customer': str(actor.customer_id),
        'security_revision': actor.customer.security_revision,
        'store': str(store.pk), 'store_revision': store.revision,
        'identity': store.verified_identity, 'provider': store.provider,
        'credentials': [[str(i), k, rev, check] for i, k, rev, check in credentials],
        'parameter': key, 'scope': area, 'request': request, 'mode': mode,
        'definition_hash': CATALOG_HASH, 'producer_hash': PRODUCER_HASH,
    }
    return salted_hmac(SALT + '.binding', CANON(facts), algorithm='sha256').hexdigest()


def resolve(request):
    # The only resolution site for prepare/start. A future qualified history
    # adapter must supply source-attested bounds here; none is fabricated.
    today = timezone.now().astimezone(ZoneInfo('Europe/Moscow')).date()
    return resolve_period(today, request)


def prepare(actor, store, key, area, request, mode):
    period = resolve(request)
    checked_period(period)
    payload = {'schema': 1, 'binding': _binding(actor, store, key, area, request, mode),
               'period': deepcopy(period)}
    return period, signing.dumps(payload, salt=SALT, compress=True)


def accept(actor, store, key, area, request, mode, reference=None):
    if reference is None:
        # Compatibility for an older client: resolve its full/default or
        # explicit request, never accept a client-provided actual/short flag.
        return resolve(request)
    need(type(reference) is str and 0 < len(reference) <= 4096,
         'PARAMETER_PREPARATION_CHANGED', 422)
    try:
        payload = signing.loads(reference, salt=SALT, max_age=MAX_AGE)
    except signing.SignatureExpired:
        raise Rejected('PARAMETER_PREPARATION_EXPIRED', 422) from None
    except (signing.BadSignature, ValueError, TypeError):
        raise Rejected('PARAMETER_PREPARATION_CHANGED', 422) from None
    need(type(payload) is dict and set(payload) == {'schema', 'binding', 'period'}
         and type(payload['schema']) is int and payload['schema'] == 1
         and payload['binding'] == _binding(actor, store, key, area, request, mode),
         'PARAMETER_PREPARATION_CHANGED', 422)
    checked_period(payload['period'])
    return deepcopy(payload['period'])
