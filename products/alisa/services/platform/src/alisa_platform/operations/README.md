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

## 17 November resumption: installed R15 is not waiting for S16

Fresh server inspection at 01:12 UTC found R15 native/platform/authority cafb743c installed by a separate continuation, with program 20261116-recovery-ca15c4d2. WEB remains preview5e5e8cc8. PR460/a159e445 documents the separately reviewed forward recovery and the distinction between retained non-runnable UNKNOWN and active work. This branch did not perform or repeat that installation. Prior statements that R15 remains uninstalled or necessarily waits for all four historical UNKNOWN outcomes are historical, not the present deployment state. The four unknown external outcomes are not thereby proved. Full owner/acoustic acceptance is not implied by the documented control delivery.

The previously pending exact25dc Source43855523078 and Docs43855523031 are now SUCCESS. Qualificationartifact14221099936 was downloaded only to the chat container, CRC/SHA verified:292437e7ac3ea2cba410a275b0248d4d242e00f0d8db6ba8ecbe86edf6ad7a0a. Its real PostgreSQL record contains39 passing S16 cases inside188 total S03 cases. Native evidence remains synthetic in those tests; this is not authenticated runtime transport qualification.

### Concrete native read-side implementation

`products/alisa/runtime/reconciliation/native_snapshot.py` implements bounded native SQLite metadata reads without calling Repository.get(), which opens a write transaction and may update expiry. It uses mode=ro/query_only, one consistent current WAL snapshot, a strict table/column authorizer, disabled extension loading, a SQLite VM deadline and bounded lock waits. The file and parent identities are checked before and after; symlinks, foreign owners, multiple hard links and writable parents/files are refused. Deadline bounds SQLite work and lock waits, not arbitrary kernel/filesystem I/O stalls.

The caller must already possess a verified RuntimePort scope. `NativeScope` is DATA, not an authorization capability. This module does not grant staff access, install a route, register an opcode, accept browser paths/tenant claims, or claim that its digest authenticates a snapshot. No live database is opened on import. The next transport must independently derive and revalidate the scope, check both peer identity and current staff authority, and enforce its own deadline.

The reader matches the actual reference/product object/tenant/customer/native-tenant/guard and reader cursor. Aliases, cancellation, missing or pruned references fail explicitly. It returns no question, plan, result, progress, credential, provider-source name or raw owner token. At most16 retained calls are projected; full-history completeness remains false even when fewer rows remain. A single HTTP200, an empty ledger or a READY metadata flag is never promoted to authenticated whole-job proof. All snapshots retain UNPROVEN, job_state_changed=false and replay_permitted=false.

The native schema does NOT persist the earlier draft core's canonical dispatch UUID and positive revision. It stores a32hex job identity, dispatch_order including0, and fractional timestamps. The native reader preserves those fields. The continuation below now connects this exact metadata shape to the assessment core without inventing native UUID/revision. This is a data-contract correction, NOT authentication of the supplying channel.

### Actual tests of this continuation

40 new native tests plus85 prior core/routing/staff tests passed in a finite DEV run:125 total, zero failures/errors/skips. Tests include uncheckpointed WAL visibility, concurrent writer snapshot consistency, unchanged logical DB state, exact repository DDL extraction, bounded exclusive-lock contention, cross-tenant/actor/object/guard refusal, missing binding, aliases/cancelled cursors, malformed columns, output privacy and filesystem identity/race controls. The six relevant CREATE/ALTER statements extracted from the source are hash-identical to those read from the actually installed R15 sources on Alisa; this compares only relevant DDL, not whole-file equivalence or live schema/data. No production application is imported and no live database is queried by these checks.

The existing named operations CI step now discovers test_*.py and the exact inventory registers both test_reconciliation and test_native_snapshot. Unknown extra modules still fail inventory. No new workflow, runner, scheduled job, dependency or build is added. Final exact-head CI must be observed separately after publication; local125 is not automatically a remote result.

Remaining work: authenticated staff-to-native read-only transport plus an honest native identity binding in the assessment contract, then HTTP/BFF/Origin/CSRF integration and independent review. Existing R15 installation is independent of these unfinished features. No terminal-state change, administrative closure, replay permission or fresh live readiness count is introduced here. The earlier blocked reviewer call is not repeated or rerouted; this remains draft source, not independent approval.


## 17 November continuation: frozen source placement and native assessment identity

The exact f45 Source43995161439 FAILED at the broader1102-runtime suite:4failures/5errors, all originating from NATIVE_BASE_COVERAGE. The new file had been placed in the frozen rt_job_r02 directory, violating the builder's complete admitted inventory. The fix moves only that new module, with identical bytes (SHA148e555f6e10feec2973aeb6e8e3a5a50595468002c65a2be054fd2a4da4bd5a), into products/alisa/runtime/reconciliation. The frozen manifest and its hash/file checks are unchanged. A new regression verifies that no unmanifested executable remains and every actual frozen input matches its admitted hash. No test was disabled or its refusal relaxed.

NativeIdentity now preserves the exact object/tenant/customer/reference, request and guard hashes, scoped native-job hash, native timestamps, dispatch sequence and reader state. In native mode Operation.dispatch_id and Operation.revision are explicitly None. All changes use the complete binding digest, including subsecond time changes; the digest alone is not authentication. The earlier draft representation remains a distinct explicit mode and preserves its previous binding hash, with no fallback from native mode to that mode.

The public ActionReceipt revision remains a positive integer by contract. For a new immutable native-mode command it is1, explicitly the COMMAND RECEIPT version, never a synthetic native row revision. This new internal interpretation needs independent review before deployment. The existing StaffCommandReceipt stores the exact operation hash and checks it on recovery; a changed native sequence or timestamp conflicts even when the receipt version stays1. No migration, native-state update, automatic retry or permission grant accompanies this change.

operation_from_native_snapshot validates the exact snapshot shape and target identity. No browser path, verifier flag, desired outcome, key or source import is accepted. Missing/pruned records cannot be reconstructed. Metadata, one received200 or an empty call ledger remain UNPROVEN. A separate authenticated primary proof is still required to assess a confirmed whole-job result; even that assessment remains NO_CHANGE. The existing receipt transaction additionally checks native customer scope.

Author checks:156 methods PASS on DEV (41snapshot including new frozen-inventory check,30native-binding,49core,19routing,17staff-policy), no failures/errors/skips. The local30binding tests use actual disposable SQLite snapshots feeding the core and synthetic authority/proof ports. Existing PostgreSQL qualification now has12 additional native-shaped cases (intended total51S16): actual receipt/audit uniqueness, subsecond stale binding, changed dispatch, customer mismatch, fractional proof time, audit rollback, concurrency, commit-reply loss and privacy. Their exact-head CI result must be read separately; source addition is not a test result.

Focused existing overlay tests now pass the original coverage boundary. Local R1 ran11 methods with2nested failures because the author test sandbox denied explicit /tmp and the Node executable. R2 provided an isolated64MiB/tmp and the existing NodePATH;10of11 methods passed, but the nested1986-test suite still reached the frozen code's absolute /usr/local/bin/node, which the DEV OS denies executing. No chmod, replacement, alternate execution of that denied path or third blind rerun was attempted. These failed local invocations remain failed; the complete unchanged runtime suite must pass on the existing GitHub environment. Temporary test roots/units were removed after both runs. Source placement is fixed independently of this remaining local-environment limitation.

The first local binding harness accidentally rediscovered an imported TestCase class and ran119 methods, including an unprepared schema fixture, giving1error. Importing the fixture as a module corrected discovery; the intended49+30 methods then passed. This is not suppression of a test: the41 native tests still run explicitly in the full156 suite and existing CI operations step. Its exact registry now lists all three modules; unknown modules still fail.

Remaining: actual current-staff authenticated runtime channel with peer identity, request/response binding and a deadline, then HTTP/BFF/Origin/CSRF tests. Do not impersonate the customer to reuse customer execution tickets. No public/internal route, new runtime opcode, production primary source or native transition is wired by this continuation. The earlier blocked SQLite allocation-cap action and blocked independent-review invocation remain open and were not repeated or routed elsewhere. Source-only/DRAFT; installed R15 remains independent and unchanged.

## 17 November, read channel continuation — no CI-wait dependency

Prior exact296c211 Source43998114508 and Docs43998114455 are complete SUCCESS. The qualification artifact14291906600 (SHA256 ae66d7a760d0940ccb8f8937fa37f1d139e3327d4a3abb1de188ca0320f5e225,24entries) was downloaded only to the chat container and checked. It contains1102 successful runtime methods and51 passing S16 PostgreSQL cases. No workflow rerun was requested.

`products/alisa/runtime/reconciliation/read_channel.py` now supplies an actual bounded one-request Unix exchange and an accepted-connection handler, not a listener/daemon. Client and server check real SO_PEERCRED; the client also pins the expected server PID, socket/parent identities and producer source. A fresh256-bit nonce and exact target hash bind each answer. A length-prefixed single message rejects suffixes, duplicate JSON fields and oversized wire frames. One absolute budget spans send/receive and authority checks; slow drip cannot reset it. No retry, fallback endpoint, chmod or automatic reconnection exists.

The client must receive an explicit current-staff authorizer. The server must receive a separate verifier of the ticket, nonce and exact target which returns an expiring Grant with the authorized native scope. It is checked before and after the real SQLite read; changed/revoked authority suppresses the answer. Client rechecks current authority after receipt. The grant and source hashes alone are NOT authority. This primitive cannot substitute for its required concrete verifier, and no verified=True switch or default successful verifier exists.

**Qualification boundary:** the32 new tests use real Unix sockets/SO_PEERCRED and a real private SQLite database. They execute the existing staff policy with synthetic member/session rows and a test-only HMAC issuer. They do not prove a production DB-backed staff issuer/verifier, authority-RPC roundtrip, existing-listener dispatch integration, HTTP/BFF/CSRF or InstalledSynthetic. No production secret is copied and no permission or listener is registered. The production verifier must enforce its own finite I/O deadline and avoid lock-taking callbacks into the platform transaction already holding staff/query rows. The outer deadline detects expiry but cannot preempt an unbounded injected verifier or kernel filesystem stall.

The full focused run passed188 methods (the prior156 plus32; no failures/errors/skips). Fixtures exercise wrong UID/PID, tampered and wrongly bound tickets, MFA expiry/revocation, changed authorization during read, final-client revocation, producer/nonce/target mismatches, framing, deadline and no-retry behavior. Native data remain logically unchanged. Both own finite test units were collected and their private roots removed. Exact registry now covers4 operations modules; frozen native manifest and native_snapshot.py bytes are unchanged, including the previously reported unimplemented selected-value allocation cap. Earlier blocked reviewer/allocation-cap/Node actions were not retried.

Next author integration remains concrete current-staff issuance and independent non-locking verification through the existing private authority, followed by existing-listener dispatch and BFF. These are unfinished implementation tasks, not work delegated to a tester. This source checkpoint is not independently reviewed or deployable. Already-installed R15 is unaffected.
