# POST-C3H Provider Outcome / Replay Integration

Work ID: `SA-I1-POST-C3H-P1-PROVIDER-OUTCOME-REPLAY-20260918-01`

Status: `IMPLEMENTED_CANDIDATE_WITH_ENVIRONMENT_GAP`

Base: C3H `804d58b8198aa75fd8ec2830b7b37678dc8444bf`, tree
`c5f0fe25981f341745a6aac5345b6fbb7769bfab`.

This document records the bounded post-C3H provider-outcome step. It does not
advance joint offline command/result completion, scheduler work, mutation
enablement, or Stream 2 monitoring.

## Mature behavior and actual gaps

The imported Ozon implementation already had bounded report file session state,
provider-specific response taxonomy, observed Retry-After quota state, one
business request per explicit command, and no hidden provider retry. The shared
queue already persisted `requesting` plus a worker session and converted a stale
worker request to `REQUEST_OUTCOME_UNKNOWN_NO_RETRY`. Duplicate request IDs and
single-flight protected mature D2 behavior.

The gaps were structural: the queue had no common durable provider-attempt
record, logical execution and provider attempt were not separately represented,
the response-receipt boundary was implicit in final batch storage, and the Ozon
response hook ran after the complete command including Performance token
acquisition. The old post-command response hook was removed. Ozon now reports a
normalized business response from its concrete seller, Performance business,
and trusted report-file transport helpers; token acquisition is deliberately
outside the report business-response boundary. WB reports its normalized
response immediately after its provider transport helper returns.

## State machine and durable boundaries

`packages/bridge-core/src/execution/provider-outcome.js` defines the shared
technical model:

`NOT_DISPATCHED` → `DISPATCH_INTENT_COMMITTED` → `RESPONSE_RECEIVED` →
`COMPLETED_KNOWN` or `FAILED_KNOWN`.

Known HTTP 429 with Retry-After may become `RETRY_WAIT_KNOWN`. A permitted new
attempt is created with a new `provider_attempt_id`, the same
`logical_execution_id`, and an incremented attempt number. Existing accepted
queue behavior does not automatically replay a 429 command; explicit quota
resume continues only according to the existing queue semantics.

`DISPATCH_INTENT_COMMITTED` becomes `OUTCOME_UNKNOWN` when transport may have
started and no durable response receipt exists. `OUTCOME_UNKNOWN` has no
automatic transition to dispatch or retry. Known terminal state remains known
even if later local projection or AI delivery fails.

The durable record is stored in the existing local manual-operation record,
inside each batch entry. It contains only bounded identity/context metadata,
state, timestamps, and safe response metadata: HTTP status, success flag,
classification, Retry-After, and provider request ID when supplied. It does not
contain credentials, authorization headers, request bodies, conversation text,
raw responses, report bytes, or report archives. Attempt history is bounded to
eight entries per logical queue item and retained within the existing
approximately one-hour payload/result lifetime.

The dispatch boundary is:

1. the existing C3G authority/context gate passes where the provider adapter
   exposes a queue predispatch port;
2. logical execution and attempt identity are constructed from the owner,
   command index, binding, Work generation, marketplace, store, and credential
   revision;
3. the intent is committed through the existing serialized local operation
   store;
4. the provider adapter invokes its existing last-moment C3G/fetch fence and
   transport.

WB retains its accepted last-moment C3G fence inside `guardedFetch`; the queue
   boundary still commits the durable intent before entering the WB provider
   boundary. A predispatch denial is stored as a local non-provider result and
   does not create a provider attempt or call.

The normalized provider response receipt is committed before result projection,
cache projection, report parsing continuation, or delivery. A response receipt
and the later AI delivery commit remain separate dimensions. This is the local
handoff required by the next roadmap step; complete delivery recovery is not
implemented here.

## Crash-window semantics

* Window A, before intent commit: C3G/local denial or storage failure leaves
  provider calls at zero.
* Window B, after intent commit and before transport: restart does not replay;
  the intent is fenced and becomes UNKNOWN when recovery can identify the stale
  worker.
* Window C, during transport: the attempt is UNKNOWN unless a normalized
  provider response receipt was durably committed; restart adds zero calls.
* Window D, after an in-memory response but before receipt commit: UNKNOWN;
  no inferred success is persisted.
* Window E, after durable `RESPONSE_RECEIVED`: provider call count is unchanged;
  later processing uses the local result/outcome and never reconstructs it by
  calling the marketplace.
* Window F, after provider outcome commit and during result/delivery work:
  provider state remains known and delivery remains a separate pending/failed
  state. The next step owns recovery of that delivery state.

Transport exceptions, timeout, AbortError, worker interruption, and browser
network errors are not treated as proof that the marketplace did not receive a
request. Once dispatch began, they are conservatively UNKNOWN.

## Logical execution, retry, and replay

The logical execution ID is stable for one accepted command (`operation_id` plus
queue index). Every physical provider attempt has its own random
`provider_attempt_id`. A known 429 is historical known technical state; any
later permitted attempt receives a new ID and the same logical ID. UNKNOWN is
never a retry permit.

Worker restart, browser restart, page reload, server recovery, sync ACK,
reconciliation, preferred-executor convergence, fresh authority, and queue
recovery cannot clear UNKNOWN or create a provider attempt. Duplicate click
and duplicate request ID remain protected by the mature admission and
single-flight rules.

Two installations can independently issue the same user-intended operation
during a partition. There is no central provider-attempt lease and no exactly-
once guarantee across browsers. The no-replay guarantee is local to one
installation/execution context.

## Ozon, WB, and report lifecycle

Ozon ordinary Seller, Performance business, report START, report STATUS, and
report DOWNLOAD use the shared queue model. Performance token acquisition is
not treated as a report response. A known report START response is the only
source of a durable report ID; UNKNOWN START never fabricates one, and STATUS or
DOWNLOAD never infer that UNKNOWN START failed or should be repeated.

WB ordinary and binary operations use the same durable attempt record and keep
WB-specific response/error and credential semantics. WB 429 remains a known
response and its accepted observed-quota wait remains bounded and non-retrying.

No mutation endpoint was enabled.

## C3E/C3F and server isolation

Provider-attempt records are local batch technical state. They are not placed in
`/v1/sync` entries, PostgreSQL sync rows, server diagnostics, admin state, or a
new server endpoint. Sync ACK and reconciliation do not create attempts, clear
UNKNOWN, fabricate provider success, or authorize replay. No server migration
was required.

The existing one-hour local payload/result retention and report-file TTL remain
the cleanup boundary. Completed old attempt history is compacted; active,
UNKNOWN, and recent technical state remain only as needed for safety and the
bounded recovery handoff. No user-visible report archive was added.

## Red-first audit

The requested RED batch was audited against the source and mature imported
implementation:

* P1-RED-01 through P1-RED-05 were reachable in the implicit `requesting` /
  post-command storage windows and are closed by the durable intent, response
  receipt, and UNKNOWN fence.
* P1-RED-06 and P1-RED-07 were `ALREADY_GREEN_BASELINE` for provider replay:
  sync/reconciliation and preferred-executor code has no provider dispatch
  authority and does not own the local queue.
* P1-RED-08 was reachable conceptually because final batch storage combined
  provider processing and delivery visibility; it is closed structurally by the
  separate attempt receipt and delivery state.
* P1-RED-09 and P1-RED-10 were reachable in quota metadata and lacked a shared
  attempt identity; known 429 classification and new-attempt modeling close
  them without enabling automatic retry.
* P1-RED-11 and P1-RED-12 were `ALREADY_GREEN_BASELINE` in mature D2 admission,
  single-flight, and completed-entry handling, and are additionally fenced by
  the attempt record.

## Tests and evidence

Focused model and composed-provider tests:

```text
node tests/regression/extension-core/provider-outcome.mjs <runtime>  PASS
node tests/regression/extension-core/wb-adapter.mjs <runtime>         PASS, 18 scenarios
node tests/regression/extension-core/batch-context.mjs <runtime>      PASS, 12 scenarios
```

The WB crash-injection scenario proves durable intent, restart, UNKNOWN, and
zero additional calls. The C3H AUT-49 fixture proves no replay after restart;
its AUT-47 native MV3 registration result remains the architect-accepted
`ENVIRONMENT_DEFERRED_GOOGLE_CHROME_MV3_REGISTRATION` gap. C3H AUT-01–46 and
AUT-48–50 remain PASS.

The full I1 source route passed syntax, contracts, worker, context, WB,
provider-outcome, application, I1 lifecycle/race/review, C3B/C3C/C3D/C3F/C3G
and related checks until the expected C3H AUT-47 deferred result. APP-05 is
preserved as `PREEXISTING_TEST_HARNESS_FLAKE`; diagnostic rerun evidence shows
all 15 application scenarios PASS, including APP-05.

No real marketplace calls were used. The default shell Node 12 is not capable
of parsing this repository's existing modern JavaScript; supported validation
used Node `v24.20.0` from the repository environment.

## Next-step contract

The next dependency may consume local technical state containing:

* logical execution ID and provider attempt ID/history;
* known provider outcome or UNKNOWN fence;
* bounded known response/result material already held by the existing local
  result buffer;
* separate delivery phase and delivery uncertainty.

It must never convert pending delivery into provider replay, and it must not
turn UNKNOWN into retryable state. Joint offline command/result completion and
recovery is intentionally not started by this task.
