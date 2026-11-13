"""DB-backed product rights and short Django-signed runtime admission tickets.

No identity implementation, native database access or provider credentials.
The runtime consumer converts the returned strict scope JSON to its own types.
"""
from copy import deepcopy
from datetime import datetime, timezone as datetime_timezone
import hashlib

from django.conf import settings
from django.core import signing
from django.db import DatabaseError, transaction
from django.utils import timezone

from alisa_platform.accounts.models import Customer, Membership, Tenant, WebSession
from alisa_platform.accounts.views import session
from alisa_platform.alice_link.models import TokenFamily
from alisa_platform.alice_link.oauth import SCOPE, server, valid_link
from alisa_platform.entitlements.models import AccessLedger
from alisa_platform.entitlements.service import snapshot as access_snapshot
from alisa_platform.stores.models import CredentialRevision, Store
from .bindings import BindingFile, revision
from .job_client import (CONTEXT_FIELDS, RuntimeFailure, context_shape, encode, exact,
                         identifier, need, text, timestamp)

PRODUCT = 'alisa_market'
SALT = 'alisa.runtime.admission.v1'
LIFETIME = 120
ACTIONS = {'capabilities', 'submit', 'status', 'read_result', 'cancel', 'execute', 'list_reports', 'read_report'}


def digest(value):
    return hashlib.sha256(encode(value)).hexdigest()


def pins(context):
    return {'product_id': PRODUCT, **{k: deepcopy(v) for k, v in context.items()
                                    if k not in {'execution_ticket', 'not_after'}}}


class SessionPrincipal:
    def __init__(self, token):
        text(token, 80); need(len(token) >= 40, 'AUTH_REQUIRED')
        self._token = token

    def current(self):
        row = session({'session_token': self._token})
        need(row is not None, 'AUTH_REQUIRED')
        proof = {'kind': 'WEB', 'id': str(row.pk), 'revision': row.security_revision,
                 'fingerprint': digest(row.token_hash)}
        return str(row.customer_id), str(row.tenant_id), row.expires_at.timestamp(), proof


class AlicePrincipal:
    def __init__(self, token):
        self._token = text(token, 2048)

    def current(self):
        need(getattr(settings, 'ALICE_LINK_ENABLED', False) is True, 'AUTH_REQUIRED')
        valid, request = server().verify_request('https://alisa.octoport.ru/alice/oauth/token',
            http_method='POST', headers={'Authorization': 'Bearer ' + self._token}, scopes=[SCOPE])
        need(valid, 'AUTH_REQUIRED')
        row = request.alice_family
        need(row.link.client_id == settings.ALICE_CLIENT_ID, 'AUTH_REQUIRED')
        proof = {'kind': 'ALICE', 'id': str(row.pk), 'revision': row.revision,
                 'fingerprint': digest(row.access_hash)}
        return str(request.user.customer_id), str(request.user.tenant_id), row.access_expires_at.timestamp(), proof


def principal_current(proof, claims):
    exact(proof, {'kind', 'id', 'revision', 'fingerprint'})
    identifier(proof['id'])
    revision(proof['revision']); text(proof['fingerprint'], 64)
    need(len(proof['fingerprint']) == 64 and all(c in '0123456789abcdef' for c in proof['fingerprint']))
    if proof['kind'] == 'WEB':
        row = WebSession.objects.select_related('customer').filter(pk=proof['id'], revoked_at__isnull=True,
            expires_at__gt=timezone.now(), customer_id=claims['actor_id'], tenant_id=claims['tenant_id']).first()
        need(row is not None and row.customer.is_active and row.security_revision == row.customer.security_revision
             and proof['revision'] == row.security_revision and proof['fingerprint'] == digest(row.token_hash),
             'AUTH_REQUIRED')
    else:
        need(proof['kind'] == 'ALICE', 'AUTH_REQUIRED')
        need(getattr(settings, 'ALICE_LINK_ENABLED', False) is True, 'AUTH_REQUIRED')
        row = TokenFamily.objects.select_related('link__customer').filter(pk=proof['id'], revoked_at__isnull=True,
            access_expires_at__gt=timezone.now(), link__customer_id=claims['actor_id'], link__tenant_id=claims['tenant_id']).first()
        need(row is not None and row.link.client_id == settings.ALICE_CLIENT_ID
             and valid_link(row.link) and row.revision == row.link.revision
             and proof['revision'] == row.revision and proof['fingerprint'] == digest(row.access_hash), 'AUTH_REQUIRED')


class RuntimeAuthority:
    def __init__(self, bindings: BindingFile, *, service_id, catalog_release_id):
        text(service_id, 128); text(catalog_release_id, 128)
        need(isinstance(bindings, BindingFile))
        self.bindings, self.service_id, self.catalog_release_id = bindings, service_id, catalog_release_id

    def enabled(self):
        need(getattr(settings, 'RUNTIME_AUTHORITY_ENABLED', False) is True and
             settings.ACCOUNTS_ENABLED is True and settings.STORES_ENABLED is True and
             settings.ENTITLEMENTS_ENABLED is True, 'CAPABILITY_UNAVAILABLE')

    def for_session(self, token, store_ids):
        return PlatformAuthorizer(self, SessionPrincipal(token), store_ids)

    def for_alice(self, token, store_ids):
        return PlatformAuthorizer(self, AlicePrincipal(token), store_ids)

    @transaction.atomic
    def state(self, actor_id, tenant_id, store_ids):
        self.enabled(); identifier(actor_id); identifier(tenant_id)
        need(type(store_ids) is list and 1 <= len(store_ids) <= 1000)
        ids = sorted(identifier(value) for value in store_ids); need(len(set(ids)) == len(ids))
        # Block account changes without conflicting with KEY SHARE acquired by
        # grant/notification foreign keys while their writer holds the ledger.
        actor = Customer.objects.select_for_update(no_key=True).filter(pk=actor_id).first()
        need(actor is not None and actor.is_active, 'ACCOUNT_BLOCKED')
        need(Tenant.objects.select_for_update(no_key=True).filter(pk=tenant_id).exists() and
             Membership.objects.filter(customer=actor, tenant_id=tenant_id, role='OWNER_CLIENT').exists(),
             'PERMISSION_DENIED')
        need(AccessLedger.objects.select_for_update().filter(product_id=PRODUCT, tenant_id=tenant_id).exists(),
             'ACCESS_REQUIRED')
        access = access_snapshot(tenant_id)
        need(access['status'] == 'ACTIVE' and access['active_until'], 'ACCESS_REQUIRED')
        mapping = self.bindings.for_tenant(tenant_id, environment=settings.ALISA_ENV,
            service_id=self.service_id, catalog_release_id=self.catalog_release_id)
        need(mapping is not None, 'CAPABILITY_UNAVAILABLE')
        store_pins, selected = [], []
        for sid in ids:
            store = Store.objects.select_for_update().filter(pk=sid, product_id=PRODUCT, tenant_id=tenant_id).first()
            need(store is not None, 'NOT_FOUND'); need(store.status == 'ACTIVE', 'PERMISSION_DENIED')
            binding = mapping['stores'].get(sid)
            need(binding is not None and store.verified_identity and binding['provider'] == store.provider
                 and binding['verified_identity'] == store.verified_identity, 'CAPABILITY_UNAVAILABLE')
            credentials = list(CredentialRevision.objects.select_for_update().filter(product_id=PRODUCT,
                tenant_id=tenant_id, store=store, status='ACTIVE').values('id', 'kind', 'revision', 'check_code'))
            actual = []
            for credential in credentials:
                need(credential['check_code'] in {'CONNECTED', 'CONNECTED_NATIVE_OWNER'}, 'CREDENTIAL_REVOKED')
                actual.append({key: str(credential[key]) if key == 'id' else credential[key]
                               for key in ('kind', 'id', 'revision')})
            need(sorted(actual, key=lambda row: row['kind']) ==
                 sorted(binding['credentials'], key=lambda row: row['kind']), 'CREDENTIAL_REVOKED')
            store_pins.append({'store_id': sid, 'credential_revision': binding['credential_revision'],
                               'scope_revision': store.revision})
            selected.append(binding)
        claim_pins = {'product_id': PRODUCT, 'tenant_id': tenant_id, 'actor_id': actor_id,
            'store_scope': store_pins, 'security_revision': actor.security_revision,
            'access_revision': access['revision'], 'business_timezone': 'Europe/Moscow',
            'catalog_release_id': self.catalog_release_id, 'runtime_contract_version': 'runtime_port_v1'}
        revision = digest({'pins': claim_pins, 'mapping_revision': mapping['revision'], 'bindings': selected})
        scope = {'tenant': mapping['runtime_tenant'], 'revision': 'platform:' + revision,
                 'stores': [deepcopy(binding['runtime_store']) for binding in selected]}
        return claim_pins, scope, datetime.fromisoformat(access['active_until']).timestamp()

    def resolve(self, claim_pins, action):
        try:
            need(action in ACTIONS)
            exact(claim_pins, {'product_id'} | (CONTEXT_FIELDS - {'execution_ticket', 'not_after'}))
            need(claim_pins['product_id'] == PRODUCT, 'PERMISSION_DENIED')
            # Reuse strict context validation without turning a shape into authority.
            probe = {key: value for key, value in claim_pins.items() if key != 'product_id'}
            probe.update(execution_ticket='shape-only', not_after='9999-01-01T00:00:00Z')
            normalized = pins(context_shape(probe, timezone.now().timestamp()))
            expected, scope, _ = self.state(normalized['actor_id'], normalized['tenant_id'],
                                             [row['store_id'] for row in normalized['store_scope']])
            need(normalized == expected, 'PERMISSION_DENIED')
            return scope
        except RuntimeFailure: raise
        except (DatabaseError, OSError, ValueError, TypeError, KeyError):
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None

    def verify(self, ticket, service_id):
        try:
            self.enabled(); need(service_id == self.service_id, 'AUTH_REQUIRED'); text(ticket, 4096)
            value = signing.loads(ticket, salt=SALT, max_age=LIFETIME)
            exact(value, {'schema', 'environment', 'service_id', 'issued_at', 'claims', 'principal', 'scope_hash'})
            need(value['schema'] == 'alisa-runtime-admission/v1' and value['environment'] == settings.ALISA_ENV
                 and value['service_id'] == self.service_id, 'AUTH_REQUIRED')
            now = timezone.now().timestamp()
            need(type(value['issued_at']) is int and value['issued_at'] <= now,
                 'AUTH_REQUIRED')
            need(type(value['claims']) is dict, 'AUTH_REQUIRED')
            context = {**value['claims'], 'execution_ticket': ticket}
            context.pop('product_id', None)
            normalized = context_shape(context, now)
            need(value['claims'].get('product_id') == PRODUCT and
                 value['issued_at'] < timestamp(normalized['not_after']) <= value['issued_at'] + LIFETIME,
                 'AUTH_REQUIRED')
            result = {'product_id': PRODUCT, **{k: v for k, v in normalized.items() if k != 'execution_ticket'}}
            need(value['scope_hash'] == digest(self.resolve(pins(normalized), 'capabilities')), 'AUTH_REQUIRED')
            principal_current(value['principal'], result)
            return result
        except RuntimeFailure as failure:
            if failure.code == 'DEPENDENCY_UNAVAILABLE': raise
            raise RuntimeFailure('AUTH_REQUIRED') from None
        except DatabaseError:
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None
        except (signing.BadSignature, ValueError, TypeError, KeyError):
            raise RuntimeFailure('AUTH_REQUIRED') from None


class PlatformAuthorizer:
    def __init__(self, authority, principal, store_ids):
        need(type(store_ids) is list and 1 <= len(store_ids) <= 1000)
        self.authority, self.principal = authority, principal
        self.store_ids = sorted(identifier(value) for value in store_ids)
        need(len(set(self.store_ids)) == len(self.store_ids))

    def prepare(self, operation):
        try:
            self.authority.enabled()
            need(operation in ACTIONS)
            actor, tenant, principal_until, proof = self.principal.current()
            claim_pins, scope, access_until = self.authority.state(actor, tenant, self.store_ids)
            fresh_actor, fresh_tenant, fresh_until, fresh_proof = self.principal.current()
            need((fresh_actor, fresh_tenant, fresh_proof) == (actor, tenant, proof), 'AUTH_REQUIRED')
            principal_until = min(principal_until, fresh_until)
            issued = int(timezone.now().timestamp())
            until = min(issued + LIFETIME, principal_until, access_until)
            need(until > timezone.now().timestamp(), 'AUTH_REQUIRED')
            claims = {**claim_pins, 'not_after': datetime.fromtimestamp(until, datetime_timezone.utc).isoformat().replace('+00:00', 'Z')}
            ticket = signing.dumps({'schema': 'alisa-runtime-admission/v1', 'environment': settings.ALISA_ENV,
                'service_id': self.authority.service_id, 'issued_at': issued, 'claims': claims,
                'principal': proof, 'scope_hash': digest(scope)}, salt=SALT, compress=False)
            result = {key: value for key, value in claims.items() if key != 'product_id'}
            result['execution_ticket'] = ticket
            return context_shape(result, timezone.now().timestamp())
        except RuntimeFailure: raise
        except DatabaseError:
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None
        except (ValueError, TypeError, KeyError):
            raise RuntimeFailure('AUTH_REQUIRED') from None

    def current(self, context, operation):
        try:
            actor, tenant, _, _ = self.principal.current()
            need(context['actor_id'] == actor and context['tenant_id'] == tenant and
                 sorted(row['store_id'] for row in context['store_scope']) == self.store_ids,
                 'PERMISSION_DENIED')
            need(operation in ACTIONS)
            verified = self.authority.verify(context['execution_ticket'], self.authority.service_id)
            need(verified == {'product_id': PRODUCT, **{key: value for key, value in context.items()
                                                       if key != 'execution_ticket'}}, 'PERMISSION_DENIED')
            return True
        except RuntimeFailure as failure:
            if failure.code == 'DEPENDENCY_UNAVAILABLE': raise
            return False
        except DatabaseError:
            raise RuntimeFailure('DEPENDENCY_UNAVAILABLE') from None
        except (ValueError, TypeError, KeyError):
            return False
