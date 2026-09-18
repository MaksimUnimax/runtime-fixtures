# POST-C3H P2 — Joint offline command/result completion and recovery

Work ID: `SA-I1-POST-C3H-P2-JOINT-OFFLINE-COMMAND-RESULT-RECOVERY-20260918-01`

Status: `IMPLEMENTED_CANDIDATE_WITH_ENVIRONMENT_GAP` — architect review pending.

Base: P1-R1 `1d9f0ca8986205f36911051fb5e4a73455d1202b`, tree
`90096b35c7e664ddc7e80d5d35b8a52fe82bfd62`.

This candidate joins the accepted P1 provider-outcome journal to bounded local
result materialization and the existing AI delivery model. It does not replay
providers, add server result storage, add scheduler/orchestration, or modify
Stream 2 monitoring agents.

## Architecture before P2 and gaps found

The mature queue already had durable provider dispatch intent, response
receipts, `OUTCOME_UNKNOWN`, delivery claim/commit/insert/confirm phases, local
artifact storage, context fencing, and one-hour payload expiry. The material
gap was between the provider response receipt and queue completion:

- a worker could restart after a known response receipt but before queue result
  projection;
- recovery saw a requesting entry and either treated it as an unsafe request or
  had no deterministic local result to project;
- the known response was not a bounded durable result payload;
- re-finalizing a WB binary result generated a new random artifact reference;
- expiry removed payload data without retaining a minimal no-replay fence.

The existing delivery state machine was retained. No parallel delivery model
was introduced.

## State model

There are three separate durable boundaries:

1. Provider attempt/outcome: owned by `SellerAgentsProviderOutcome`.
2. Local result materialization: owned by `SellerAgentsResultRecovery` and the
   queue entry's bounded `result_buffer` / `result_phase`.
3. AI delivery: owned by the existing delivery model and its adapter receipts.

`result-recovery.js` defines bounded `BUFFERED`, `MATERIALIZED`, `EXPIRED`, and
`UNAVAILABLE` result phases. A buffer has stable logical execution and provider
attempt identities, pinned account/conversation/store/binding/work context,
bounded sanitized provider payload, expiry, and `provider_replay_forbidden`.

Known provider result recovery is deterministic and reports zero provider calls.
An UNKNOWN provider attempt never fabricates a result, report ID, or file.
`RESULT_RECOVERY_UNAVAILABLE_NO_REPLAY` and `RESULT_BUFFER_EXPIRED` fail closed.

The existing text delivery phases retain their meanings:

- `CLAIMED`: delivery ownership is durable, but no irreversible insert/send
  intent is committed;
- `INSERT_COMMITTED` / `COMMITTED`: irreversible insert/send may have happened;
  recovery must reconcile or return `DELIVERY_OUTCOME_UNKNOWN_NO_RETRY`;
- `INSERTED`: insertion evidence is durable;
- `CONFIRMED`: accepted AI-visible confirmation is durable and can produce the
  compact delivery marker.

The attachment model retains separate preparation and send boundaries. A
prepared file is reused by a stable provider-attempt/request-derived artifact
key. An unknown attachment send is never automatically repeated.

## Recovery behavior

Known buffered results resume queue projection locally, including coalesced
physical multi-command groups. The queue marks the same provider attempt known,
projects each logical member, and advances once. Worker restart, browser restart,
page reload, server recovery, sync ACK, reconciliation, preferred-executor
change, and repeated queue scans do not call the provider again.

For plain text, recovery is allowed only before an irreversible delivery
boundary and only after rechecking account, conversation, AI surface/profile,
Work generation, binding/revision, marketplace, store, Finish, and explicit
reconciliation state. A changed Work, Finish, logout/account, conversation, or
store/marketplace binding fences the old result; it is never relabeled or
redirected.

For files, exact byte length and existing hash/integrity validation remain in
force. The local artifact is bounded to the technical window and is not uploaded
or archived on the server. Expired artifacts return explicit recovery
unavailable/expired state; they are not redownloaded automatically.

Report START, STATUS, and DOWNLOAD responses use the same known-result buffer.
Delivery interruption never reissues the corresponding provider command. A
known report file is delivered from its local bounded reference. An UNKNOWN
report START remains UNKNOWN.

Mixed command packages are not flattened: a pending known result may recover, a
confirmed result remains confirmed, UNKNOWN remains no-replay, and undispatched
commands remain subject to the existing queue/C3G policy.

## Retention and privacy

The technical result buffer remains bounded to approximately one hour and is
not a user report archive. On expiry raw result/artifact data is removed and a
minimal `RESULT_BUFFER_EXPIRED` fence retains only execution/context identity,
attempt identities/states, delivery identity, and replay-forbidden flags.

Result buffers exclude authorization/access-token/API-key/client-secret and
storage-state fields. WB and Ozon structured projections redact echoed
credentials before buffering. No server business-result state, marketplace
token, authorization header, unrelated dialogue text, raw Health envelope, or
storageState is added.

## Delivery marker and server independence

The accepted compact C3E/C3F marker is emitted only by the existing confirmed
delivery path. Known result, delivery intent, and delivery UNKNOWN do not emit a
success marker. Confirmed delivery remains idempotent and bounded.

Known-result transformation, ordinary text delivery, and attachment delivery
require zero Seller Agents control calls. Sync can remain pending. Server
recovery only resumes metadata sync and cannot replay either provider traffic or
AI delivery.

## Red-first audit

| ID range | Baseline finding |
|---|---|
| P2-RED-01..03 | Fixed: durable known response now carries a local result buffer; restart resumes projection with zero provider calls. |
| P2-RED-04..05 | Already-green delivery baseline: committed/unknown text and attachment phases fail closed; P2 preserves and tests the boundary. |
| P2-RED-06..08 | Already-green C3F/C3H context fences; P2 routes known-result recovery through the same fences. |
| P2-RED-09..10 | Fixed by result handoff: START/STATUS/DOWNLOAD known responses are not reissued for delivery recovery. |
| P2-RED-11 | Fixed: expiry produces a replay-forbidden fence and cannot authorize a provider call. |
| P2-RED-12..13 | Already-green delivery marker/reconciliation baseline; repeated recovery does not redeliver. |
| P2-RED-14 | Fixed: physical coalesced groups recover as their original logical members. |
| P2-RED-15 | Fixed: provider outcome, result phase, and delivery outcome are separate fields/models. |

## Evidence

Focused model suite: `client-p2-result-recovery.mjs`, 9 scenarios, PASS,
provider additional calls 0. Existing worker, application, WB, provider-outcome,
delivery, report/file, multi-dialogue/store, C3D, C3F, C3G, and C3H suites remain
green.

Real unpacked Playwright Chromium used the P1-R1 BrowserFixture with synthetic
provider/AI surfaces only. Both composed source and ZIP-extracted runtimes PASS:

- known response + worker restart before projection: result `MATERIALIZED`,
  provider additional calls 0;
- known result + control-server outage/reload: provider additional calls 0;
- committed delivery boundary + restart: `insert_committed`, automatic sends 0.

The accepted P1 Chromium matrix was also rerun on this candidate for both source
and extracted runtimes: provider UNKNOWN restart safety, known response receipt,
429 identity, sync/authority recovery, report START, and privacy all PASS.

The full Extension I1 checker was run with Node 24 and the accepted real-unpacked
proof receipt. Source, extracted/package, D3C signed readback, and verifier gates
passed. The ordinary no-receipt run still reports only the pre-existing AUT-47
native MV3 registration environment gap; the system Google Chrome path remains
separate/deferred. No live marketplace calls were made.

## Stream 2 and next boundary

Expected Stream-2-owned production files changed: `NONE`. ChatGPT/Alice health,
DOM/surface monitoring, marketplace API/spec watchers, and monitoring schedules
were not modified or duplicated.

This candidate stops before scheduler/orchestration integration and before full
Early-I1/D2 pre-handoff acceptance. If accepted, the next dependency is
`SCHEDULER / INTEGRATION DEPENDENCIES`.

## Candidate identity

The final candidate SHA/tree, deterministic ZIP identity, exact gate counts, and
publication result are recorded in the terminal work report and must be updated
after the final commit. Status remains `IMPLEMENTED_CANDIDATE` only after
architect review; this document does not self-accept P2.
