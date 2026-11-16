"""AL-S16 PostgreSQL adapter for the existing staff command/audit boundary.

No HTTP route, default runtime transport, job write or replay is installed here.
The server wiring must supply a bounded authenticated RuntimeEvidenceSource.
A Query selects a platform target; it does NOT prove a native dispatch identity.
"""
from __future__ import annotations

from contextlib import contextmanager
from dataclasses import asdict, dataclass, fields
from typing import Protocol

from django.db import connection, transaction

from alisa_platform.accounts.models import Customer, Membership
from alisa_platform.queries.models import Query
from alisa_platform.staff import service as staff
from alisa_platform.staff.models import StaffCommandReceipt
from alisa_platform.stores.models import Store as MarketplaceStore
from . import reconciliation as core

ACTION = 'runtime.reconciliation'
RECEIPT_SCHEMA = 'alisa-staff-reconciliation-receipt/v1'


@dataclass(frozen=True, repr=False)
class Target:
    product_id: str
    object_id: str
    tenant_id: str
    customer_id: str
    runtime_job_ref: str
    store_scope: tuple
    platform_snapshot: str

    def __repr__(self):
        return '<Target; server-resolved query scope, not native dispatch proof>'

    @property
    def binding(self):
        return core.mark(asdict(self))


@dataclass(frozen=True, repr=False)
class Resolution:
    target: Target
    operation: core.Operation

    def __repr__(self):
        return '<Resolution; server-authenticated runtime binding required>'


class RuntimeEvidenceSource(Protocol):
    def resolve(self, target: Target) -> Resolution:
        """Authenticate an exact current native binding, never infer it from Query.

        A bounded metadata-only read; may run under the short final transaction.
        The source must authenticate its peer and enforce its own deadline.
        Missing/pruned binding raises; no fallback to input_hash/attempt/old logs.
        """
        ...

    def read(self, operation: core.Operation) -> tuple[core.PrimaryProof, ...]:
        """Bounded primary readback, outside the receipt transaction; no dispatch."""
        ...

    def verify(self, proof: core.PrimaryProof, operation: core.Operation) -> bool:
        """Actual server authenticity decision, not a checksum/verified flag."""
        ...


class PlatformAdapter:
    """One request-local adapter shared by Authority and Store ports.

    Uses the established owner-lock -> staff/member/session -> customer ->
    membership -> sorted stores -> query -> command receipt order. No new
    migration or command table. A row from another product/action is a conflict.
    """
    def __init__(self, token, source: RuntimeEvidenceSource):
        core.need(type(token) is str and 40 <= len(token) <= 80, 'AUTH_REQUIRED', 401)
        core.need(source is not None and all(callable(getattr(source, name, None))
                  for name in ('resolve', 'read', 'verify')), 'EVIDENCE_UNAVAILABLE', 503)
        self._token, self._source = token, source
        self._depth = 0
        self._actor = None
        self._target = None
        self._operation = None

    def __repr__(self):
        return '<PlatformAdapter; private staff session>'

    @contextmanager
    def atomic(self):
        # Reusing a browser/worker transaction would keep locks over evidence I/O.
        core.need(self._depth == 0 and not connection.in_atomic_block,
                  'TRANSACTION_CONTEXT_INVALID', 503)
        core.need(connection.vendor == 'postgresql', 'POSTGRESQL_REQUIRED', 503)
        with transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute("SET LOCAL lock_timeout = '1500ms'")
                cursor.execute("SET LOCAL statement_timeout = '2000ms'")
            staff.owner_lock()
            self._depth = 1
            try:
                yield
            finally:
                self._depth = 0

    def _inside(self):
        core.need(self._depth == 1 and connection.in_atomic_block,
                  'TRANSACTION_CONTEXT_INVALID', 503)

    def actor(self):
        if not self._depth:
            with self.atomic():
                return self.actor()
        self._inside()
        # Existing policy performs enabled, product, issuer/client, membership,
        # revision, session revocation/expiry and fresh MFA checks, each time.
        self._actor = staff.principal(self._token, core.PERMISSION)
        return str(self._actor.pk) if self._actor is not None else None

    def _target_now(self, object_id):
        self._inside()
        core.identifier(object_id)
        first = Query.objects.filter(pk=object_id).only('customer_id', 'tenant_id').first()
        if first is None:
            return None
        # Lock identities before the query as in existing authority consumers.
        customer = Customer.objects.select_for_update().filter(pk=first.customer_id).first()
        membership = Membership.objects.select_for_update().filter(
            customer_id=first.customer_id, tenant_id=first.tenant_id, role='OWNER_CLIENT').first()
        if customer is None or membership is None:
            return None
        preliminary = Query.objects.filter(pk=object_id).only('store_ids').first()
        if preliminary is None:
            return None
        ids = preliminary.store_ids
        core.need(type(ids) is list and 1 <= len(ids) <= 1000,
                  'OPERATION_CONTEXT_INVALID', 503)
        for value in ids:
            core.identifier(value)
        core.need(len(set(ids)) == len(ids), 'OPERATION_CONTEXT_INVALID', 503)
        stores = list(MarketplaceStore.objects.select_for_update().filter(
            pk__in=ids, product_id=core.PRODUCT, tenant_id=first.tenant_id).order_by('pk'))
        core.need(len(stores) == len(ids) and all(s.status == 'ACTIVE' for s in stores),
                  'FORBIDDEN', 403)
        row = Query.objects.select_for_update().filter(pk=object_id,
            customer_id=first.customer_id, tenant_id=first.tenant_id).first()
        if row is None:
            return None
        core.need(row.store_ids == ids, 'REVISION_CONFLICT', 409)
        core.need(row.runtime_job_ref is not None, 'OPERATION_BINDING_UNAVAILABLE', 503)
        # input_hash/attempt are merely platform race-detection metadata below;
        # neither is assigned to native request_sha256/dispatch_id.
        metadata = {'object_id': str(row.pk), 'customer_id': str(row.customer_id),
            'tenant_id': str(row.tenant_id), 'runtime_job_ref': str(row.runtime_job_ref),
            'store_ids': sorted(ids), 'state': row.state, 'input_hash': row.input_hash,
            'attempt': str(row.attempt) if row.attempt is not None else None,
            'lease_until': row.lease_until.isoformat() if row.lease_until else None,
            'created_at': row.created_at.isoformat(), 'expires_at': row.expires_at.isoformat(),
            'customer_active': customer.is_active, 'customer_revision': customer.security_revision}
        return Target(core.PRODUCT, str(row.pk), str(row.tenant_id), str(row.customer_id),
                      str(row.runtime_job_ref), tuple((str(s.pk), s.revision, s.status) for s in stores),
                      core.mark(metadata))

    def operation(self, object_id):
        self._inside()
        core.need(self._actor is not None, 'AUTH_REQUIRED', 401)
        target = self._target_now(object_id)
        if target is None:
            return None
        if self._target is not None:
            core.need(target == self._target, 'REVISION_CONFLICT', 409)
        try:
            resolved = self._source.resolve(target)
            core.need(type(resolved) is Resolution and resolved.target == target
                      and type(resolved.operation) is core.Operation,
                      'OPERATION_BINDING_INVALID', 503)
            op = resolved.operation.validate()
            core.need((op.product_id, op.object_id, op.tenant_id, op.runtime_job_ref) ==
                      (target.product_id, target.object_id, target.tenant_id, target.runtime_job_ref),
                      'OPERATION_BINDING_INVALID', 503)
        except core.ReconcileError as error:
            if error.status == 422:
                raise core.ReconcileError('OPERATION_BINDING_INVALID', 503) from None
            raise
        except Exception:
            raise core.ReconcileError('OPERATION_BINDING_UNAVAILABLE', 503) from None
        self._target, self._operation = target, op
        return op

    def allowed(self, actor, operation, permission):
        self._inside()
        if permission != core.PERMISSION or type(operation) is not core.Operation:
            return False
        if self.actor() != actor or self._target is None or self._operation != operation:
            return False
        return self._target_now(operation.object_id) == self._target

    def receipt(self, command_id):
        self._inside()
        row = StaffCommandReceipt.objects.select_for_update().filter(pk=core.identifier(command_id)).first()
        if row is None:
            return None
        value = row.result
        core.need(row.product_id == core.PRODUCT and type(value) is dict
                  and value.get('action') == ACTION, 'IDEMPOTENCY_CONFLICT', 409)
        try:
            core.need(type(row.http_status) is int and row.http_status == 202)
            core.need(set(value) == {'schema', 'action', 'target_binding', 'operation_binding',
                                    'revision', 'trace_id', 'assessment'})
            core.need(value['schema'] == RECEIPT_SCHEMA and type(value['assessment']) is dict
                      and set(value['assessment']) == {f.name for f in fields(core.Assessment)})
            core.digest_shape(value['target_binding'])
            saved = core.CommandReceipt(str(row.pk), str(row.actor_id), row.fingerprint,
                value['operation_binding'], value['revision'], value['trace_id'],
                core.Assessment(**value['assessment']))
            saved.public()
        except (core.ReconcileError, TypeError, ValueError, KeyError):
            raise core.ReconcileError('RECEIPT_INVALID', 503) from None
        core.need(self._target is not None and self._operation is not None
                  and value['target_binding'] == self._target.binding
                  and saved.revision == self._operation.revision, 'REVISION_CONFLICT', 409)
        return saved

    def insert_receipt(self, receipt):
        self._inside()
        core.need(type(receipt) is core.CommandReceipt, 'RECEIPT_INVALID', 503)
        receipt.public()
        core.need(self._target is not None and self._operation is not None
                  and self._actor is not None and str(self._actor.pk) == receipt.actor_id
                  and receipt.operation_binding == self._operation.binding
                  and receipt.revision == self._operation.revision, 'REVISION_CONFLICT', 409)
        value = {'schema': RECEIPT_SCHEMA, 'action': ACTION, 'target_binding': self._target.binding,
                 'operation_binding': receipt.operation_binding, 'revision': receipt.revision,
                 'trace_id': receipt.trace_id, 'assessment': asdict(receipt.assessment)}
        StaffCommandReceipt.objects.create(id=receipt.command_id, product_id=core.PRODUCT,
            actor_id=receipt.actor_id, fingerprint=receipt.request_fingerprint,
            result=value, http_status=202)
        # Existing reason vocabulary; free-text request reason stays only in its
        # fingerprint. Both writes roll back if the audit or final checks fail.
        staff.audit(self._actor, ACTION, self._target.object_id, 'SECURITY_REVIEW',
            receipt.assessment.classification,
            before={'tenant_id': self._target.tenant_id, 'revision': receipt.revision},
            after={'subject_fingerprint': receipt.assessment.evidence_digest,
                   'count': receipt.assessment.verified_count})


def execute(token, request, command_id, *, source: RuntimeEvidenceSource):
    """Server-side application service; not a browser-supplied dependency.

    Wire only an independently qualified primary transport. No settings-driven
    import, fallback source, signing key, route or new capability grant here.
    """
    core.need(not connection.in_atomic_block, 'TRANSACTION_CONTEXT_INVALID', 503)
    adapter = PlatformAdapter(token, source)
    return core.reconcile(request, command_id, authority=adapter, store=adapter, reader=source)
