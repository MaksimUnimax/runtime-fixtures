# N2 S1 server-first canonical binding storage — 2026-09-24

Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE. No migration, live/preprod mutation, deployment, client rollout, store publication, or cross-browser LIVE acceptance is claimed.

## Authority

- C contract handoff: docs/development/coordination/receipts/C/C02_N2_CROSS_BROWSER_SYNC_CONTRACT_2026-09-24.md
- Operational request: /root/octoport-control/logs/C/N2_CROSS_BROWSER_SYNC_REQUEST_2026-09-24.md
- Architecture: docs/architecture/SYNC.md
- Controller notice: SUBSCRIPTION-NETWORK-REVIEW-20260924

## Read-only inventory before implementation

A read-only aggregate query was executed against the current preprod API database connection. No identifiers, digests, state bytes, credentials, reports, tokens, or raw conversation data were printed.

- total sync_entities: 2
- binding rows: 2
- valid conversationKeyDigest rows: 2
- missing/invalid digest rows: 0
- already canonical binding rows: 0
- legacy-keyed binding rows: 2
- collision groups: 0
- semantically-identical collision groups: 0
- conflicting collision groups: 0
- historical receipt rows: 2
- historical receipts tied to legacy binding entity IDs: 2

No DB mutation was performed.

## S1 scope

This candidate intentionally contains NO migration and NO C-owned wire-schema changes.

For BINDING_UPSERT / FINISH / DELIVERY_MARKER only:
- canonical durable/lock identity is conversation:<conversationKeyDigest>;
- old random wire entityId remains accepted during server-first compatibility;
- a wire ID already prefixed conversation: must exactly match the payload digest or the request fails closed;
- binding reconciliation receives a normalized copy whose entityId is canonical, so marker/effective-binding identity converges across installations;
- original wire entry remains the authority for request fingerprint, historical receipt entity_id and response result.entityId.

STORE_UPSERT / STORE_TOMBSTONE preserve their existing store entity key and are not canonicalized by conversation digest.

## Historical replay and collision rules

Transaction order:
1. durable auth recheck;
2. request advisory lock;
3. historical receipt lookup and exact replay/conflict decision using ORIGINAL wire fingerprint/mutationId/entityId;
4. canonical binding advisory lock;
5. legacy wire lock when applicable;
6. physical state lookup/row lock;
7. reconciliation;
8. state update/rename and receipt write.

Therefore an exact historical request can replay without consulting canonical state.

For a new binding request:
- zero matching physical rows => revision 0/null;
- exactly one legacy row with matching digest => it is used as current and, on non-null ACK, updated/renamed in place to the canonical key;
- exactly one canonical row must also carry the same digest and a binding kind;
- more than one matching physical row => fail closed, no winner and no state/receipt mutation;
- a canonical key occupied by a row with another digest/non-binding state => fail closed.

No ACK-null/CONFLICT path renames a legacy row.

Internal B error causes distinguish canonical-ID mismatch from physical collision. Because ApiErrorCodeV1 is C-owned and has not yet been extended, HTTP maps both safely to the existing SYNC_CONFLICT code with bounded non-identifying messages. B did not modify packages/contracts.

## S2 rollout boundary

S2 data consolidation / migration 0050 is NOT in this candidate.

Required ordering:
1. integrate and accept S1 canonicalizing server code;
2. deploy/activate S1 server compatibility before or atomically with consolidation;
3. only then prepare/accept the separate S2 migration candidate that renames the two current legacy rows (and future eligible rows) and adds the DB invariant.

Historical sync_request_receipts must remain untouched by S2.

This split prevents migration from accidentally preceding the compatibility layer and breaking old clients or recreating split rows.

## Verification

Node 24.20.0 / pnpm 10.34.5.

Final static/source gate:
- focused Prettier: PASS
- focused ESLint: PASS
- @product/sync unit tests: PASS
- @product/sync typecheck: PASS
- @product/db typecheck: PASS
- API sync route test: PASS
- @product/api typecheck: PASS
- resource job: fb74821e4b2e4ef49fdd021400da6b48
- exit 0, OOM 0, cleanup_verified
- peak 737148928 bytes

Disposable PostgreSQL sync acceptance:
- packages/server/db/src/sync.integration.test.ts: 17/17 PASS
- resource job: 156e4835edf94a90b173bfc2eebf16f4
- log: /root/octoport-control/logs/B/n2-s1-sync-postgres-20260924.log
- exit 0, OOM 0, cleanup_verified
- peak approximately 585 MiB

Acceptance includes:
- legacy random wire ID stores one canonical conversation row while response/receipt retain original wire ID;
- exact canonical wire ID;
- canonical-prefixed mismatch fail-closed with no mutation;
- one legacy physical row reused and renamed in place on ACK;
- corrupt canonical row fail-closed;
- duplicate physical rows fail-closed with no mutation;
- same digest isolated by account;
- historical receipt replay wins before canonical collision/state lookup; changed request reuse conflicts;
- FINISH remains dominant over late delivery marker across different legacy/canonical wire IDs;
- store metadata remains keyed by store entity ID;
- existing auth/revocation/rollback/stale-base/concurrency/idempotency coverage remains green.

## Remaining N2 work

Blocked on S1 integration/acceptance:
- separate S2 migration 0050 and DB CHECK/consolidation evidence.

Blocked on C-owned shared wire implementation:
- readEntityIds request support;
- snapshots response;
- mixed mutation/read ordering and response budget.

A-owned client adoption/read behavior remains outside this B candidate.
