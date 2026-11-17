"""Concrete staff-authenticated native binding resolver; NOT terminal proof.

Server composition supplies the qualified read-channel Client and existing
StaffReadAuthority, never a browser dependency, file path or verified flag.
No default empty proof is returned: a primary outcome reader is still absent,
and reconcile must refuse without writing a receipt rather than fake success.
"""
import time

from . import reconciliation as core
from .platform_adapter import Target, Resolution
from .staff_read_authority import StaffReadAuthority


class NativeBindingSource:
    def __init__(self, client, authority, token, *, clock=time.time):
        core.need(callable(getattr(client,'read',None))
                  and type(authority) is StaffReadAuthority,
                  'EVIDENCE_UNAVAILABLE',503)
        core.need(type(token) is str and 40 <= len(token) <= 80 and token.isascii(),
                  'AUTH_REQUIRED',401)
        self._client,self._authority,self._token = client,authority,token
        self._clock,self._target,self._operation = clock,None,None

    def __repr__(self):
        return '<NativeBindingSource; authenticated metadata, primary outcome unavailable>'

    def resolve(self, target):
        core.need(type(target) is Target,'OPERATION_BINDING_INVALID',503)
        core.need(self._target is None or self._target == target,'REVISION_CONFLICT',409)
        try:
            value = self._client.read(target.binding,self._authority.for_target(self._token,target))
            operation = core.operation_from_native_snapshot(value,object_id=target.object_id,
                tenant_id=target.tenant_id,customer_id=target.customer_id,
                runtime_job_ref=target.runtime_job_ref)
            now = core.now_seconds(self._clock)
            core.need(0 <= now-value['observed_at'] <= 2,'EVIDENCE_STALE',503)
            self._target,self._operation = target,operation
            return Resolution(target,operation)
        except core.ReconcileError:
            raise
        except Exception:
            raise core.ReconcileError('OPERATION_BINDING_UNAVAILABLE',503) from None

    def read(self, operation):
        # The native snapshot contains metadata only, not rt_job terminal
        # receipts or authenticated provider outcomes. Returning () here would
        # falsely claim that a real primary-evidence search had found nothing.
        core.need(type(operation) is core.Operation and self._operation == operation,
                  'OPERATION_BINDING_INVALID',503)
        raise core.ReconcileError('EVIDENCE_UNAVAILABLE',503)

    def verify(self, proof, operation):
        return False  # never promote caller-provided proofs or metadata hashes
