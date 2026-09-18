# C3F — Multi-browser reconciliation and preferred-executor stability

Work ID: `SA-I1-C2-3-C3F-MULTI-BROWSER-RECONCILIATION-20260918-01`

Status: `IMPLEMENTED_CANDIDATE_WITH_ENVIRONMENT_GAP`. This candidate extends the
accepted C3E journal and `/v1/sync` transport. It does not claim architect
acceptance and does not start C3G or C3H.

## Candidate identity

The exact base is C3E-R1 `eeb943fea402ff6cd5b97e72669de51e33dc2579`, tree
`3993d0129c40f636935948dc219b4a720899848a`. The C3B → C3C → C3D → C3E-R1
ancestry is preserved:

`ed32fc1` → `3ae08e3` → `d91aa70` → `2b2ca0c` → `2809415` → `eeb943f`.

The implementation candidate commit is `b72d2ed2fe52383f1c6644233bcba346f0908339`,
tree `3d0a536271138ae91b95c938a0e7ea02a181deac`; the formatting follow-up is
`fcf54962f889e9695a7aa6dd2ad3a1704004d490`, tree
`5b81e8ea13a4bc11a64ca0ec1dfe1f9aaa64af36`. The documentation commit records
these identities on the same feature branch.

## Consistency model

Each browser remains autonomous during a control-server partition. C3F does not
add a lease, heartbeat, presence signal, WebSocket, polling requirement, or
global dialogue lock. Reconciliation is an extension-initiated, optional,
bounded metadata exchange layered on top of the C3E journal.

The server cannot know what a disconnected browser did. Absence of a marker is
therefore `UNKNOWN_REMOTE_INSTALLATION_STATE`, not proof that Work stopped or
that delivery did not happen. Contact refines the known state. Server ACKs and
reconciliation metadata never grant local Work authority, signed offline grace,
credentials, or provider permission.

## Explicit state precedence

`bindingRevision` is the product ordering for explicit binding truth. The
server's `serverRevision` is the per-entity compare-and-swap/transport revision
used to serialize accepted explicit mutations and to detect stale bases. It is
monotonic metadata, not a replacement for binding ordering.

An accepted explicit `BINDING_UPSERT` or `FINISH` advances server revision once.
An equivalent stale explicit state is acknowledged as
`SAME_BINDING_MERGEABLE` without another semantic revision. An incompatible
stale store or marketplace mutation returns durable `EXPLICIT_BINDING_CONFLICT`
and never overwrites the server state. The client retains its local desired
state and stops blind retry.

`FINISH` is represented as `bindingState=FINISHED` with the next explicit
binding revision. A delivery marker is never allowed to replace or lower that
state. Store and marketplace changes use the same explicit boundary.

## Delivery eligibility and order provenance

The comparator is centralized in
`packages/bridge-core/src/sync/reconciliation.js`; the server transaction uses
the equivalent typed reconciliation kernel in
`packages/server/sync/src/reconciliation.ts`.

A marker is eligible only when account, entity/conversation digest, binding ID,
binding revision, store, marketplace, and represented Work generation all
match current explicit state. Wrong-binding, wrong-store, wrong-marketplace,
wrong-dialogue, and post-Finish markers are retained only as obsolete metadata
where useful; they cannot mutate current truth or preferred executor.

Ordering provenance is explicit:

1. `AI_ORDERED`: comparable stable AI message/order identity.
2. `CLIENT_APPROXIMATE`: client delivery time/sequence, advisory only.
3. `SERVER_RECEIVE_FALLBACK`: server receipt time only as a deterministic
   fallback/tie-break, never described as actual delivery time.

Stable installation identity and marker ID resolve final equality. Client wall
clock cannot change binding, store, marketplace, Finish, Work generation,
authority, or grace. Future/past clock values affect only advisory marker
ordering.

## Conflict and convergence behavior

- Different stores or marketplaces selected from the same stale base produce an
  explicit conflict. Receive time, wall clock, installation ID, random order,
  and delivery markers do not choose a winner.
- Same effective conversation/binding/store/marketplace/generation converges
  automatically. Pending equivalent metadata is compacted; local execution
  history is not replayed and no second Start prompt is created.
- Server Finish wins over late delivery. Old delivery remains historical only.
- Store 2 remains current after Store 1 → Store 2. A Store 1 marker cannot be
  relabeled as Store 2 or compete for Store 2's last-delivered state.
- Conflict state is per entity. Ozon, Wildberries, and separate conversations
  keep independent revisions, journals, markers, and preferred executors.

The existing popup/store-change warning and explicit rebind control remain the
user-resolution boundary. C3F exposes durable conflict metadata for that flow;
polished later conflict presentation remains a D3/S2 boundary.

## Preferred-executor state machine

The state is one of `UNSET`, `VALID_CURRENT`, or `REPLACEMENT_REQUIRED` with a
chosen installation ID.

Preferred executor may change only when:

- an accepted explicit binding action establishes a new revision and the acting
  installation becomes preferred;
- no preferred executor exists and eligible current-binding candidates must be
  compared; or
- the current preferred installation is explicitly known to be revoked or
  otherwise ineligible and a deterministic replacement is selected.

For initialization/replacement, eligible same-binding markers are compared by
AI order, then client-approximate evidence, then server receive fallback, then
stable installation/marker identity. Once a valid preferred executor exists,
ordinary eligible delivery markers update marker metadata but do not flip it.
Disconnected/not-recently-observed is unknown, not revoked.

Preferred changes are metadata-only: zero prompt sends, provider calls, result
replays, Work restarts, credential clears, or quota resets.

## C3E reuse and restart safety

C3E remains the only sync mechanism. The existing bounded journal keeps stable
request IDs, bounded entries, per-entity base revisions, in-flight protection,
retry scheduling, ACK compaction, and conflict retention. C3F adds bounded
`serverStates` and `reconciliation` projections and preserves current local
desired payloads.

An older ACK cannot clear a newer dirty entry, conflict, explicit revision, or
preferred decision. Reconciliation is storage/classification only and cannot
invoke provider commands, prompt sends, result sends, or credentials/quota
operations. Newer server Finish/binding metadata fences future stale local
actions; already-sent AI messages are not deleted.

Persistence is compact: one current server state, one current reconciliation
projection, and bounded marker candidates per entity. No report, command,
conversation text, token, authorization header, Health envelope, storageState,
or raw business response is persisted.

## Contract and persistence boundary

The existing `seller_agents_sync_v1` contract is extended additively with
explicit binding state, Work generation, delivery-order evidence, ordering
provenance, preferred-executor metadata, classification, observed installations,
and a bounded marker list. OpenAPI is regenerated. Existing C3E request IDs,
base revisions, request receipts, and entity rows remain the one persistence
model; no second sync database or migration is introduced. The existing JSON
state bound remains enforced by PostgreSQL.

Server transactions lock one account/entity and the request receipt, process
each batch item independently, and update marker metadata without advancing
explicit server revision. Explicit races, equivalent stale mutations, Finish
races, store-switch races, duplicate request retries, account isolation,
conversation isolation, and rollback are covered by the real PostgreSQL run.

## Stream 2 boundary

No files under `apps/health-runner/**`, `packages/server/health/**`, or
`tooling/api-watch/**` were changed. No monitoring agent, API watcher, schedule,
heartbeat, or health implementation was duplicated. No parallel-stream
dependency was encountered.

## RED batch

The pre-change bounded RED probe reproduced all 15 requested classes:

`C3F-RED-01` old delivery could replace current state; `02` preferred executor
was absent; `03` only generic stale-base conflict existed; `04` Finish had no
precedence; `05` marker store identity/order was absent; `06` receive time had
no provenance; `07` disconnected state had no unknown classification; `08`
same-binding stale equivalence had no merge path; `09` no per-entity
reconciliation projection; `10` no clock-skew marker boundary; `11` preference
side-effect boundary was absent; `12` no Work-generation eligibility fence;
`13` no server reconciliation state for late ACK protection; `14` no restart
projection; `15` no bounded marker candidate model.

## Test matrix

The focused browser kernel covers C3F-01 through C3F-28, including partition
independence, reconnect ordering, same-binding convergence, no lease/heartbeat,
marker eligibility, Finish/store/marketplace precedence, explicit conflicts and
retained local state, dialogue isolation, ordering inversion, approximate
fallback, clock skew, disconnected unknown/refinement, message preservation,
future-action fencing, zero prompt/provider/result replay, and deterministic
restart behavior.

The server kernel covers same-binding merge, marker acceptance/obsolescence,
Finish-vs-late-delivery, explicit store conflict, AI-order precedence, and
stable preferred selection. C3E focused journal tests remain green.

Affected real PostgreSQL C3E/C3F integration passed on PostgreSQL 18 in a
task-owned ephemeral container, including migrations, authenticated `/v1/sync`,
idempotency, stale conflicts, mixed entities, same-entity concurrency, account
isolation, revocation, rollback, bounds, and schema privacy checks.

## Boundaries and deferrals

C3F does not claim global exactly-once business execution, realtime liveness,
credential transfer, provider outcome resolution, or polished user conflict UX.
It does not mark C3G/C3H accepted. Native MV3 registration remains
`ENVIRONMENT_DEFERRED_NATIVE_MV3_REGISTRATION`: the C3D/C3E pre-journal failure
was reproduced before worker initialization, so C3F does not fake native PASS.

Preserved deferred ledger:

- `OWNER_DEFERRED_TEST-I1-ONLINE-WORK-HEALTH-20260917`
- `PROVISIONAL_OWNER_REVIEW-HEALTH-TTL-20260917`
- `PROVISIONAL_OWNER_REVIEW-OFFLINE-ACTIVE-CONTINUATION-20260918 = SUPERSEDED_BY_OWNER`
- `ENVIRONMENT_DEFERRED_REMOTE_PUBLICATION`
- `PREEXISTING_DOCS_CHECK_FAILURES`
- `ENVIRONMENT_DEFERRED_NATIVE_MV3_REGISTRATION`
- Stream 2 responsibilities remain `OWNED_BY_PARALLEL_STREAM_2`.
