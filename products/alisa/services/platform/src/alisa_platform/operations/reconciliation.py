"""AL-S16 runtime-UNKNOWN assessment and idempotent command core.

Only server-wired ports may supply authority, operation identity and primary
proof. The HTTP ReconcileRequest never supplies a tenant, outcome, evidence,
verifier, path or permission. A digest is an identity check, NOT authentication.

This component records an assessment; it has NO job mutation/replay method.
Even authenticated whole-job evidence is not permission to turn an old UNKNOWN
into READY/FAILED, reconstruct an expired result, or weaken rollout readiness.
Real staff/BFF/native adapters and their acceptance are separate work.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, fields
from hashlib import sha256
import json
import math
import re
import time
from typing import ContextManager, Protocol
from uuid import UUID, uuid4

PRODUCT = 'alisa_market'
PERMISSION = 'ops.reconcile'
PROOF_SCHEMA = 'alisa-runtime-reconciliation-proof/v1'
MAX_PROOFS = 16
MAX_PROOF_BYTES = 16384
# A fresh authenticated observation can attest an older original receipt.
# This is a draft source policy, not an installed retention-policy change.
OBSERVATION_TTL = 120


class ReconcileError(Exception):
    """Closed public errors: no source exceptions, credentials or user text."""
    def __init__(self, code: str, status: int):
        self.code, self.status = code, status
        super().__init__(code)


def need(ok: bool, code='INVALID_PAYLOAD', status=422):
    if not ok:
        raise ReconcileError(code, status)


def identifier(value):
    need(type(value) is str and len(value) == 36)
    try:
        need(str(UUID(value)) == value)
    except ValueError:
        raise ReconcileError('INVALID_PAYLOAD', 422) from None
    return value


def digest_shape(value):
    need(type(value) is str and re.fullmatch(r'[a-f0-9]{64}', value) is not None)
    return value


def stamp(value):
    need(type(value) in (int, float) and math.isfinite(value)
         and 0 <= value <= 253402300799)
    return value


def now_seconds(clock):
    value = clock()
    need(type(value) in (int, float) and math.isfinite(value)
         and 0 <= value <= 253402300799, 'EVIDENCE_CLOCK_INVALID', 503)
    return value  # Preserve SQLite fractional timestamps; never round an identity.


def canonical(value):
    try:
        return json.dumps(value, sort_keys=True, separators=(',', ':'),
                          ensure_ascii=False, allow_nan=False).encode('utf-8')
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise ReconcileError('INVALID_PAYLOAD', 422) from None


def mark(value):
    return sha256(canonical(value)).hexdigest()


def decode(raw):
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out, 'EVIDENCE_INVALID', 503)
            out[key] = value
        return out
    def invalid(_):
        raise ReconcileError('EVIDENCE_INVALID', 503)
    try:
        return json.loads(raw.decode('utf-8'), object_pairs_hook=pairs, parse_constant=invalid)
    except (TypeError, ValueError, UnicodeError, RecursionError):
        raise ReconcileError('EVIDENCE_INVALID', 503) from None


def request_shape(value):
    need(type(value) is dict and set(value) == {'object_id', 'kind', 'reason'})
    identifier(value['object_id'])
    need(value['kind'] == 'RUNTIME_UNKNOWN', 'KIND_UNSUPPORTED', 422)
    reason = value['reason']
    need(type(reason) is str and 1 <= len(reason) <= 1000 and bool(reason.strip())
         and not any(ord(ch) < 32 or 127 <= ord(ch) <= 159 for ch in reason))
    canonical(value)  # Reject lone surrogates, not just control characters.
    return dict(value)


@dataclass(frozen=True, repr=False)
class NativeIdentity:
    """Exact metadata identity, not an authorization or a terminal receipt.

    The native database has no UUID dispatch or positive row revision. Keep
    its actual dispatch sequence (including zero), times and scoped job hash.
    """
    product_id: str
    object_id: str
    tenant_id: str
    customer_id: str
    runtime_job_ref: str
    request_sha256: str
    guard_sha256: str
    reference_created_at: int | float
    native_job_ref_sha256: str
    native_created_at: int | float
    native_updated_at: int | float
    dispatch_sequence: int
    state: str
    due: int | float
    lease: int | float | None
    expires: int | float | None
    has_owner: bool
    resume_safe: bool
    reader_updated_at: int | float

    def __repr__(self):
        return '<NativeIdentity; validated metadata, not authority>'

    def validate(self):
        need(self.product_id == PRODUCT and type(self.product_id) is str)
        for name in ('object_id','tenant_id','customer_id','runtime_job_ref'):
            identifier(getattr(self,name))
        for name in ('request_sha256','guard_sha256','native_job_ref_sha256'):
            digest_shape(getattr(self,name))
        for name in ('reference_created_at','native_created_at','native_updated_at',
                     'due','reader_updated_at'):
            stamp(getattr(self,name))
        for value in (self.lease,self.expires):
            if value is not None:stamp(value)
        need(self.native_created_at <= self.native_updated_at
             and self.native_created_at <= self.reference_created_at)
        need(type(self.dispatch_sequence) is int and 0 <= self.dispatch_sequence < 2**63)
        need(type(self.state) is str and self.state in {
            'UNKNOWN','QUEUED','RUNNING','READY','NEEDS_INPUT','FAILED','CANCELLED','EXPIRED'})
        need(type(self.has_owner) is bool and type(self.resume_safe) is bool)
        return self


@dataclass(frozen=True, repr=False)
class Operation:
    product_id: str
    object_id: str
    tenant_id: str
    runtime_job_ref: str
    dispatch_id: str | None
    request_sha256: str
    revision: int | None
    created_at: int | float
    state: str
    native_identity: NativeIdentity | None = None

    def __repr__(self):
        return '<Operation; server-resolved identity>'

    def validate(self):
        need(type(self.product_id) is str and self.product_id == PRODUCT, 'NOT_FOUND', 404)
        for name in ('object_id', 'tenant_id', 'runtime_job_ref'):
            identifier(getattr(self, name))
        digest_shape(self.request_sha256)
        stamp(self.created_at)
        if self.native_identity is None:
            # Preserve the earlier draft identity only when explicitly supplied.
            identifier(self.dispatch_id)
            need(type(self.revision) is int and 1 <= self.revision <= 2147483647)
            need(type(self.state) is str and self.state in {
                'UNKNOWN','QUEUED','RUNNING','READY','FAILED','CANCELLED','EXPIRED','ALIASED'})
        else:
            need(type(self.native_identity) is NativeIdentity)
            n = self.native_identity.validate()
            need(self.dispatch_id is None and self.revision is None)
            need((self.product_id,self.object_id,self.tenant_id,self.runtime_job_ref,
                  self.request_sha256,self.created_at,self.state) ==
                 (n.product_id,n.object_id,n.tenant_id,n.runtime_job_ref,
                  n.request_sha256,n.native_created_at,n.state))
        return self

    @property
    def receipt_revision(self):
        self.validate()
        # Native-mode revision is the immutable command-receipt version, NOT
        # a fabricated native row revision. Exact native changes use binding.
        return 1 if self.native_identity is not None else self.revision

    @property
    def binding(self):
        self.validate()
        value = asdict(self)
        if self.native_identity is None:
            value.pop('native_identity')  # Keep old draft receipt hashes stable.
        return mark(value)


def operation_from_native_snapshot(value, *, object_id, tenant_id, customer_id, runtime_job_ref):
    """Validate already-received data; caller MUST authenticate its transport.

    No source discovery, signing key, verified flag, DB read or authorization
    is performed. A recomputed SHA alone must never satisfy a source verifier.
    """
    try:
        need(type(value) is dict and set(value) == {
            'schema','binding','binding_sha256','observed_at','retained_calls',
            'retained_calls_truncated','call_history_complete','whole_job_outcome',
            'job_state_changed','replay_permitted'})
        need(value['schema'] == 'alisa-native-reconciliation-snapshot/v1')
        need(len(canonical(value)) <= MAX_PROOF_BYTES)
        data = value['binding']
        need(type(data) is dict and set(data) == {f.name for f in fields(NativeIdentity)})
        identity = NativeIdentity(**data).validate()
        need((identity.object_id,identity.tenant_id,identity.customer_id,identity.runtime_job_ref) ==
             (identifier(object_id),identifier(tenant_id),identifier(customer_id),identifier(runtime_job_ref)))
        need(digest_shape(value['binding_sha256']) == mark(data))
        observed = stamp(value['observed_at'])
        need(max(identity.native_updated_at,identity.reference_created_at,
                 identity.reader_updated_at) <= observed)
        need(value['call_history_complete'] is False and value['whole_job_outcome'] == 'UNPROVEN'
             and value['job_state_changed'] is False and value['replay_permitted'] is False
             and type(value['retained_calls_truncated']) is bool)
        calls = value['retained_calls']
        need(type(calls) is list and len(calls) <= MAX_PROOFS)
        need(not value['retained_calls_truncated'] or len(calls) == MAX_PROOFS)
        previous = 2**63
        for call in calls:
            need(type(call) is dict and set(call) == {'id','at','state','http','elapsed_ms','response_bytes'})
            need(type(call['id']) is int and 0 < call['id'] < previous)
            previous = call['id']
            need(identity.native_created_at <= stamp(call['at']) <= observed)
            need(type(call['state']) is str and call['state'] in {'SENDING','RECEIVED','UNKNOWN','HTTP_ERROR'})
            need(call['http'] is None or (type(call['http']) is int and 100 <= call['http'] <= 599))
            for name in ('elapsed_ms','response_bytes'):
                need(call[name] is None or (type(call[name]) is int and 0 <= call[name] < 2**63))
        return Operation(PRODUCT,identity.object_id,identity.tenant_id,identity.runtime_job_ref,
            None,identity.request_sha256,None,identity.native_created_at,identity.state,identity).validate()
    except (ReconcileError,TypeError,ValueError,KeyError,OverflowError):
        raise ReconcileError('OPERATION_BINDING_INVALID',503) from None


@dataclass(frozen=True, repr=False)
class PrimaryProof:
    payload: bytes
    authentication: bytes

    def __repr__(self):
        return '<PrimaryProof; private source bytes>'


@dataclass(frozen=True)
class Assessment:
    classification: str
    code: str
    evidence_digest: str
    verified_count: int
    assessed_at: int | float
    valid_until: int | float
    job_state_changed: bool = False
    replay_permitted: bool = False

    def validate(self):
        classifications = {'UNKNOWN', 'CONFIRMED_EXECUTED', 'CONFIRMED_NOT_EXECUTED', 'CONFIRMED_REJECTED'}
        codes = {'CONFLICTING_EVIDENCE', 'WHOLE_JOB_PROOF', 'NO_EVIDENCE', 'CALL_ONLY_PROOF', 'INCONCLUSIVE_EVIDENCE'}
        need(type(self.classification) is str and self.classification in classifications
             and type(self.code) is str and self.code in codes
             and (self.classification != 'UNKNOWN') == (self.code == 'WHOLE_JOB_PROOF')
             and type(self.verified_count) is int and 0 <= self.verified_count <= MAX_PROOFS
             and (self.code == 'NO_EVIDENCE') == (self.verified_count == 0)
             and self.job_state_changed is False and self.replay_permitted is False,
             'RECEIPT_INVALID', 503)
        try:
            digest_shape(self.evidence_digest)
            stamp(self.assessed_at); stamp(self.valid_until)
        except ReconcileError:
            raise ReconcileError('RECEIPT_INVALID', 503) from None
        need(self.assessed_at < self.valid_until <= self.assessed_at+OBSERVATION_TTL+1,
             'RECEIPT_INVALID', 503)
        return self

    def require_fresh(self, clock):
        self.validate()
        now = now_seconds(clock)
        need(self.assessed_at <= now < self.valid_until, 'EVIDENCE_STALE', 503)

    @property
    def receipt_state(self):
        self.validate()
        # APPLIED would incorrectly suggest that the runtime job was changed.
        return 'UNKNOWN' if self.classification == 'UNKNOWN' else 'NO_CHANGE'


@dataclass(frozen=True, repr=False)
class CommandReceipt:
    command_id: str
    actor_id: str
    request_fingerprint: str
    operation_binding: str
    revision: int
    trace_id: str
    assessment: Assessment

    def public(self):
        try:
            for value in (self.command_id, self.actor_id, self.trace_id):
                identifier(value)
            digest_shape(self.request_fingerprint); digest_shape(self.operation_binding)
            need(type(self.revision) is int and 1 <= self.revision <= 2147483647)
            need(type(self.assessment) is Assessment)
            self.assessment.validate()
        except ReconcileError:
            raise ReconcileError('RECEIPT_INVALID', 503) from None
        return {'id': self.command_id, 'state': self.assessment.receipt_state,
                'revision': self.revision, 'trace_id': self.trace_id}

    def __repr__(self):
        return '<CommandReceipt; no raw reason or operation identifiers in repr>'


class Authority(Protocol):
    def actor(self) -> str | None:
        """Current server-side staff session, including enabled/MFA/revocation checks."""
        ...

    def allowed(self, actor: str, operation: Operation, permission: str) -> bool:
        """Exact current product/tenant/resource authorization. Literal True only."""
        ...


class Store(Protocol):
    def atomic(self) -> ContextManager[None]:
        """Serialize operation and receipt access; rollback on any exception."""
        ...

    def operation(self, object_id: str) -> Operation | None: ...
    def receipt(self, command_id: str) -> CommandReceipt | None: ...
    def insert_receipt(self, receipt: CommandReceipt) -> None:
        """Durable unique command key, assessment + audit in the same transaction.

        Never update a runtime job or discard its UNKNOWN/dedup identity.
        The platform adapter must reuse its StaffCommandReceipt/audit boundary.
        """
        ...


class EvidenceReader(Protocol):
    def read(self, operation: Operation) -> tuple[PrimaryProof, ...]:
        """Bounded authenticated primary readback; no replay or new business call.

        An empty tuple means no retained proof; an unavailable reader raises.
        A historical receipt requires fresh authenticated observation. A lone
        HTTP status, absent log or caller's reason is never whole-job proof.
        """
        ...

    def verify(self, proof: PrimaryProof, operation: Operation) -> bool:
        """Authenticate payload AND exact scope against trusted server authority.

        Must not trust an envelope's boolean, digest, or supplied source name.
        Returning True must be the adapter's actual authenticity decision.
        This core supplies no signing key, adapter discovery or fallback.
        """
        ...


def assessed(operation: Operation, reader: EvidenceReader, clock=time.time) -> Assessment:
    """Validate authenticated evidence without assigning a terminal job state."""
    operation.validate()
    need(operation.state == 'UNKNOWN', 'STATE_CONFLICT', 409)
    try:
        before = now_seconds(clock)
        need(operation.created_at <= before, 'OPERATION_CONTEXT_INVALID', 503)
        proofs = reader.read(operation)
        need(type(proofs) is tuple and len(proofs) <= MAX_PROOFS, 'EVIDENCE_INVALID', 503)
        items, seen = [], {}
        for proof in proofs:
            need(type(proof) is PrimaryProof and type(proof.payload) is bytes
                 and 1 <= len(proof.payload) <= MAX_PROOF_BYTES
                 and type(proof.authentication) is bytes
                 and 1 <= len(proof.authentication) <= 4096, 'EVIDENCE_INVALID', 503)
            value = decode(proof.payload)
            fields = {'schema', 'binding_sha256', 'source', 'scope', 'outcome',
                      'recorded_at', 'observed_at', 'primary_sha256'}
            need(type(value) is dict and set(value) == fields, 'EVIDENCE_INVALID', 503)
            need(value['schema'] == PROOF_SCHEMA and value['binding_sha256'] == operation.binding,
                 'EVIDENCE_BINDING_MISMATCH', 503)
            need((value['source'], value['scope']) in (
                ('RUNTIME_TERMINAL_RECEIPT', 'JOB'), ('PROVIDER_OPERATION_RECEIPT', 'CALL')),
                'EVIDENCE_INVALID', 503)
            need(type(value['outcome']) is str and value['outcome'] in
                 {'EXECUTED', 'NOT_EXECUTED', 'REJECTED', 'UNKNOWN'}, 'EVIDENCE_INVALID', 503)
            recorded, observed = stamp(value['recorded_at']), stamp(value['observed_at'])
            need(operation.created_at <= recorded <= observed, 'EVIDENCE_INVALID', 503)
            digest_shape(value['primary_sha256'])
            need(reader.verify(proof, operation) is True, 'EVIDENCE_UNVERIFIED', 503)
            identity = value['primary_sha256']
            # Re-reading one primary receipt cannot produce contradictory fields.
            content = {k: v for k, v in value.items() if k != 'observed_at'}
            if identity in seen:
                need(seen[identity] == content, 'EVIDENCE_CONFLICT', 503)
            seen[identity] = content
            items.append(value)
        after = now_seconds(clock)
        need(after >= before, 'EVIDENCE_CLOCK_CHANGED', 503)
        for value in items:
            need(after-OBSERVATION_TTL <= value['observed_at'] <= after,
                 'EVIDENCE_STALE', 503)
        index = mark(sorted(mark(value) for value in items))
        valid_until = min((v['observed_at']+OBSERVATION_TTL+1 for v in items),
                          default=after+OBSERVATION_TTL+1)
        outcomes = {v['outcome'] for v in items if v['scope'] == 'JOB' and v['outcome'] != 'UNKNOWN'}
        has_unknown = any(v['scope'] == 'JOB' and v['outcome'] == 'UNKNOWN' for v in items)
        if len(outcomes) > 1 or (outcomes and has_unknown):
            return Assessment('UNKNOWN', 'CONFLICTING_EVIDENCE', index, len(seen), after, valid_until)
        if len(outcomes) == 1:
            return Assessment('CONFIRMED_'+next(iter(outcomes)), 'WHOLE_JOB_PROOF', index, len(seen), after, valid_until)
        code = 'NO_EVIDENCE' if not items else 'CALL_ONLY_PROOF' if all(
            v['scope'] == 'CALL' for v in items) else 'INCONCLUSIVE_EVIDENCE'
        return Assessment('UNKNOWN', code, index, len(seen), after, valid_until)
    except ReconcileError as error:
        # Source-shape validation is a dependency failure, not bad client input.
        if error.status == 422:
            raise ReconcileError('EVIDENCE_INVALID', 503) from None
        raise
    except Exception:
        raise ReconcileError('EVIDENCE_UNAVAILABLE', 503) from None


def reconcile(request, command_id, *, authority: Authority, store: Store,
              reader: EvidenceReader, clock=time.time):
    """Assess once per scoped command and persist only its immutable receipt.

    This is a synchronous domain handler, not a public route or background
    worker. Production adapters are deliberately not inferred from settings.
    """
    request = request_shape(request)
    identifier(command_id)
    try:
        actor = authority.actor()
        need(actor is not None, 'AUTH_REQUIRED', 401)
        identifier(actor)
        fingerprint = mark({'product': PRODUCT, 'actor': actor, 'request': request})

        def current():
            need(authority.actor() == actor, 'AUTH_REQUIRED', 401)
            op = store.operation(request['object_id'])
            need(type(op) is Operation and op.object_id == request['object_id'], 'NOT_FOUND', 404)
            op.validate()
            need(authority.allowed(actor, op, PERMISSION) is True, 'FORBIDDEN', 403)
            return op

        def previous(op):
            saved = store.receipt(command_id)
            if saved is not None:
                need(type(saved) is CommandReceipt and saved.command_id == command_id,
                     'RECEIPT_INVALID', 503)
                saved.public()  # Treat stored receipts as data, not authority.
                need(saved.actor_id == actor
                     and saved.request_fingerprint == fingerprint, 'IDEMPOTENCY_CONFLICT', 409)
                need(saved.operation_binding == op.binding, 'REVISION_CONFLICT', 409)
            return saved

        with store.atomic():
            op = current()
            saved = previous(op)
            if saved is not None:
                return saved.public(), 202
            need(op.state == 'UNKNOWN', 'STATE_CONFLICT', 409)
            binding = op.binding
        assessment = assessed(op, reader, clock)
        with store.atomic():
            fresh = current()
            need(fresh.binding == binding, 'REVISION_CONFLICT', 409)
            saved = previous(fresh)
            if saved is not None:
                return saved.public(), 202
            assessment.require_fresh(clock)
            receipt = CommandReceipt(command_id, actor, fingerprint, binding,
                                     fresh.receipt_revision, str(uuid4()), assessment)
            store.insert_receipt(receipt)
            need(current().binding == binding, 'REVISION_CONFLICT', 409)
            assessment.require_fresh(clock)
        return receipt.public(), 202
    except ReconcileError:
        raise
    except Exception:
        # A failed commit may have succeeded. Preserve the same command ID;
        # do not retry here, create another command, or publish an APPLIED state.
        raise ReconcileError('RECONCILIATION_UNAVAILABLE', 503) from None
