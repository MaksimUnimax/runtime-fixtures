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

## Initial CI integration finding

The first exact-head platform run43852574230 refused the new operations test directory with TEST_SUITE_ENVIRONMENT_UNASSIGNED:operations. Its complete-inventory guard correctly detected that the new named CI step alone was not an environment assignment. The fix registers exactly test_reconciliation in the existing EXTERNAL map with that named step, retains all previous assignments and adds routing regressions for the explicit invocation and an unassigned extra operations module. No suite is skipped or test disabled. The failed run is preserved; corrected exact-head CI is separate evidence.


## PostgreSQL/staff adapter continuation — 16 November 2026

`platform_adapter.py` now supplies real Django Authority/Store integration using the existing `staff.principal`, owner advisory-lock order, `StaffCommandReceipt`, and append-only `StaffAuditEvent`. A receipt and its safe audit are committed atomically. The core still has no job mutation or replay method. No new database model/migration, public route, worker, runtime key or signing service is added.

The registered source permission is now `ops.reconcile`, as specified by the existing AL-S16 contract. It is explicit for ADMIN; users.read/audit.read/access.grant are not substitutes. OWNER inherits this declared permission through the existing owner policy, not through a new role model. This is a reviewable source-policy change, NOT an assignment to a real account or a live deployment. Current enabled/client/product/MFA/session/revision checks remain in the existing principal and run again for receipt recovery and final storage.

The adapter resolves and locks the real Query/customer/membership/sorted-store metadata. The Query is only the platform target; a mandatory server-only RuntimeEvidenceSource must authenticate and return the exact native operation binding. The returned target/product/object/tenant/runtime-job identities must all match. Query.attempt and Query.input_hash participate ONLY in detecting platform races; neither is used as dispatch_id/request_sha256. Unbound legacy queries are unavailable, never guessed. There is NO production primary runtime transport in this commit, and therefore no public/internal HTTP endpoint is registered. Actual BFF/CSRF and native-source qualification remain work, not implied by the adapter tests.

`resolve` is a short metadata-only source call and may execute under a receipt transaction; its eventual production implementation must have an enforced deadline and peer verification. Full proof reading runs outside the receipt transaction. PostgreSQL locks/statements have fixed local timeouts (1.5s/2s), not global database setting changes. An ambient caller transaction is rejected rather than retaining locks over evidence I/O. Immutable receipt recovery also checks the current target snapshot and action/product namespace, with no arbitrary import/source selection from settings or browser input.

The existing `qualify_staff_core.py` lifecycle now also invokes `s16_reconciliation_backend_checks.py` on its already-created disposable platform DB as the runtime role. Native evidence/HMAC are fixtures only; the staff session, policy, PostgreSQL ORM/transactions/locks, unique receipts and audit are real. Cases include denial before target lookup, stale MFA, revoked session, wrong tenant/job binding, missing legacy binding, platform/native changes during evidence, audit failure rolling back the receipt, concurrent same-key commands, actual commit-reply loss, corrupt persisted data, ambient transactions and bounded advisory-lock contention. No Alisa data is imported. This paragraph lists implemented tests, not a predeclared PASS; exact-head CI must establish execution.

Local core/routing/staff-policy subset: 85 methods passed. Independent source approval and actual PostgreSQL result for this delta are pending at this checkpoint. Earlier source results remain attributed to their original commits; the previously blocked reviewer call was not repeated or routed elsewhere.

The existing staff/PostgreSQL CI step is moved, without duplication or command changes, immediately after locked bootstrap and before UI/browser work. It needs the locked Python environment and already-initialized disposable cluster, not a built browser artifact. This obtains backend failures before expensive unrelated qualification.
