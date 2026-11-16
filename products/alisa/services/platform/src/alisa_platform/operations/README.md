# AL-S16 runtime UNKNOWN reconciliation: assessment core

Status: **DRAFT SOURCE / AUTHOR-TESTED ONLY. Not a deployed endpoint, not a complete AL-S16 implementation.**

This first implementation lives at the operations path specified by the roadmap. It supplies a synchronous domain handler and authenticated-evidence assessment rules without changing runtime jobs or the existing R15 candidate. Its only write capability is an immutable reconciliation command receipt, through a caller-supplied server adapter.

## Existing contract versus new internal proposal

The existing v0.5 OpenAPI defines `reconcileUnknown`, `POST /staff/api/v1/operations/reconciliations`, current staff authorization with `ops.reconcile`, CSRF and UUID Idempotency-Key. Its ReconcileRequest is exactly `object_id`, `kind`, `reason`; its ActionReceipt is exactly `id`, `state`, `revision`, `trace_id`.

This core accepts only the RUNTIME_UNKNOWN kind. Payment, refund and fiscal receipt reconciliation are outside this source slice. It does not extend the public request with evidence, a tenant ID, a desired outcome, a verified boolean, an URL or a filesystem path.

The Operation binding, `alisa-runtime-reconciliation-proof/v1` envelope, source/scope labels and 120-second observation freshness are **new draft internal contracts**, not claims that an installed producer already emits such evidence. They require integration review. A historical primary receipt can be assessed only after a fresh authenticated observation of it. A digest proves identity, not authenticity.

## What is implemented

`reconcile()` validates the request and canonical UUID command key, resolves the exact operation through a server-only Store, checks current staff authority and resource scope, and fingerprints the actor/product/request. It checks for a matching original receipt before reading any primary evidence.

The evidence read occurs outside the final write transaction. `assessed()` enforces bounded exact JSON, rejects duplicate keys and non-finite values, binds every proof to product/object/tenant/runtime-job/dispatch/request-hash/revision/creation/state, and requires literal True from the actual server verifier. It rejects stale, future, malformed, unavailable, unauthenticated or contradictory same-primary bytes. It does not accept a reason, a checksum, absence of logs or resume_safe as proof.

No evidence and inconclusive or conflicting whole-job evidence retain UNKNOWN. A provider-call receipt alone never proves the result of a composite job. An authenticated whole-job terminal receipt can produce a CONFIRMED_* assessment, but the public ActionReceipt state remains NO_CHANGE, never APPLIED. No job status is updated, no missing answer is reconstructed and replay_permitted is always false.

Before storing a new receipt the handler rechecks the current actor/permission/scope, exact operation binding, any concurrent receipt and proof freshness. Receipt insertion, safe audit and final checks must be in the same transaction. A failed commit may actually have committed: the handler returns a closed dependency error and never retries internally. Repeating the **same** command recovers the one original receipt after current authority and binding checks. Changing actor, reason, operation or revision is not a duplicate success.

A replayed receipt is explicitly a historical assessment of that command, not a fresh observation or a rollout-readiness certificate. Reusing it cannot clear UNKNOWN or authorize a deployment. Any future apply phase must obtain its own current evidence and authorization.

## Adapter boundary and remaining engineering work

Authority must use the existing staff session, product membership/revision, enabled state, fresh MFA, revocation and exact resource scope. There is no permissive default implementation, fallback role or static permission grant. The current staff policy does not yet register ops.reconcile; this commit does not change that policy or any real membership.

Store must map to the existing StaffCommandReceipt and append-only staff audit, use the project's real transaction/serialization order, resolve a real native operation binding and re-read current state. The SQLite :memory: store in the tests is not this production adapter. No new production table, migration or live database write is supplied here.

EvidenceReader must obtain a primary receipt through a reviewed server-authenticated read-only source and verify it. Its source identity and operation binding cannot come from a browser. The synthetic HMAC verifier in the tests is only a fixture, not a production signing-key design or an approval to create a new key. There is no real primary-reader adapter in this commit. An unavailable source must raise, not return an empty tuple disguised as a completed lookup. The real transport must have its own enforced deadline; this synchronous core cannot interrupt an uncooperative Python adapter.

**Next author work:** connect these interfaces to existing staff authorization/command receipts and a supported runtime evidence resolver, then test actual PostgreSQL transactions and HTTP/BFF/MFA/CSRF boundaries. Do not infer native dispatch_id/request_sha256 from unrelated Query.attempt/input_hash fields. Legacy UNKNOWN rows with pruned bindings remain unresolved. No administrative close/ignore-UNKNOWN semantics is introduced. A job-state reconciliation transition and its no-replay tombstone need a separately qualified native adapter; they are deliberately absent here.

Independent review is not obtained. The previously safety-blocked reviewer invocation was not retried or routed through another tool/model. Source tests and CI do not replace independent acceptance. Existing R15 readiness and no-replay guards remain unchanged.

## Actual isolated qualification

The initial 45 methods passed. Four additional author regressions first reproduced: wrong cached command identity, corrupted cached assessment flags, non-finite/boolean clock acceptance, and evidence expiry while waiting for final storage. The final source rejects each. An intermediate author patch contained a clock-call typo and failed; it is preserved as a failed run, not counted as qualification.

**49 final methods passed in the chat container and on DEV Python 3.12**. These are repeat executions of the same 49 tests, not 98 distinct tests. The DEV process used a private network namespace and read-only filesystem mounts, 128 MiB cap and 45-second runtime bound. It ended with exit 0, MainPID=0, empty ControlGroup and LoadState=not-found.

Tests exercise real SQLite memory transactions/unique receipt persistence, concurrent identical commands, commit-reply loss, insertion failure and rollback; synthetic authority revocation/scope; proof authentication, substitution and time boundaries; idempotency conflicts; and preserved job metadata for all assessments. Neither live PostgreSQL locking, actual staff MFA, BFF origin/CSRF nor a real primary evidence transport is qualified by these fixtures. No external provider or live database is called.

Run the same test suite from the repository:

```sh
python -I -B -m unittest discover -s products/alisa/tests/operations -p test_reconciliation.py -v
```

The existing platform CI receives one named invocation of this suite; no additional workflow, runner, timer or daemon is added. Its exact-commit results must be read separately after publication. Alisa's working package and four UNKNOWN records are not modified by this source task.
