# C02 / N2 cross-browser sync contract handoff — 2026-09-24

Role: C
Status: SHARED WIRE IMPLEMENTED IN C CANDIDATE / SERVER+CLIENT ROLLOUT NOT YET ACCEPTED / NOT LIVE
Reviewed base: `866a99562f3e21cf259e065d6c504ac938247963`.
Controller authority: `SUBSCRIPTION-NETWORK-REVIEW-20260924` assigns the shared N2 boundary to C, DB/migrations to B, and extension implementation to A.

## Confirmed defect

Binding sync currently uses a local random `bindingId` as `entityId` for most binding mutations. Server storage is keyed by `(accountId, entityId)`. Two installations of one Octoport account on the same AI conversation can therefore address different server entities, and the ordinary client has no bounded pull of the other installation's canonical binding.

The existing stable conversation identity is already suitable for the cross-install key: the shared runtime normalizes a confirmed conversation as lower-case `origin|conversation_id`, and `conversationKeyDigest` is SHA-256 of that value. Chromium and Firefox use the same shared conversation-identity source. Account isolation remains the server-side `accountId` partition.

## Shared wire decision

Keep one transport: `POST /v1/sync`. Do not create a second sync service, polling endpoint, lease, heartbeat, WebSocket, or per-command server coordinator.

For binding kinds `BINDING_UPSERT`, `FINISH`, and `DELIVERY_MARKER`, canonical storage identity is `conversation:<conversationKeyDigest>`. Store metadata keeps deterministic `store:<storeId>` identity. `bindingId` remains canonical binding metadata in state and is not the storage entity key.

The rollout is server-first. During compatibility, the server derives the canonical storage/lock key from binding payload `conversationKeyDigest` even when an old client supplies a legacy random wire `entityId`. Exact historical request replay remains governed by the pre-existing receipt and original fingerprint; old receipt fingerprints must not be rewritten.

Extend the existing V1 request compatibly with optional `readEntityIds`:
- unique canonical IDs, max 32;
- `entries` remains max 32 and may be empty only if a read is requested;
- combined mutations plus unique reads max 32;
- require at least one mutation or read.

Extend the response with optional `snapshots`, one per requested ID in request order, max 32: `entityId`, `serverRevision`, `serverState`. Unknown entity returns revision 0 and null state. Read-only calls create no entity or receipt. Mixed calls use one documented coherent ordering; preferred semantics are mutations first and then post-mutation snapshots. Preserve the existing per-state 4096-byte durable bound and add a bounded total response limit.

Current old control-client consumes `syncVersion/results` without strict response-object parsing, so optional response snapshots are compatible with the current implementation. Current server request parsing is strict, therefore new request fields must not be sent until server support is deployed and accepted.

## Path assignments

C owns the shared wire schema/architecture and integration:
- `packages/contracts/src/index.ts` sync V1 schema changes;
- `docs/architecture/SYNC.md`;
- shared compatibility assertions needed to prove old-response consumers tolerate optional snapshots;
- serial integration and final cross-stream acceptance.

B is assigned the server/DB implementation after reviewing this contract:
- `packages/server/sync/src/index.ts` read/canonical-storage semantics as required by this contract;
- `packages/server/db/src/schema/sync.ts`;
- `packages/server/db/src/sync-repository.ts`;
- one forward migration under the existing server DB migration area;
- PostgreSQL integration coverage including historical receipt replay and collision handling;
- `apps/api/src/sync-routes.ts` only if route wiring must change without creating a second endpoint.

A is assigned the client implementation only after server support is accepted:
- `packages/control-client/src/client.js` read-capable request shape;
- `apps/extension/src/application/sync-journal.js` canonical conversation entity key, rare reads, adoption/conflict behavior;
- existing scheduler/wake paths only for bounded open/new-conversation or service-wake reads, never per command/report;
- A-owned regression/e2e coverage.

## C shared-wire implementation

The C-owned shared schema now exposes optional `readEntityIds` and optional response `snapshots` without changing the V1 version string or the legacy mutation entry shape. New read IDs are canonical-only. Conversation reads require exactly `conversation:<64 lowercase hex>`; store reads require `store:<storeId>` with the complete entity key within the existing 128-character storage-key width. Current locally-created `store-<uuid>` identities satisfy that bound; longer imported local IDs are not silently widened into the server key.

The request requires at least one mutation or read, rejects duplicate read IDs, and enforces `entries + unique reads <= 32`. Response snapshots are bounded to 32, reject duplicate entity IDs, enforce each non-null state at 4096 UTF-8 JSON bytes and reject a total JSON response above 256 KiB. Existing mutation results use the same state bound already enforced durably by PostgreSQL.

A real old extracted runtime from exact `f079c2e` was exercised with a response containing an extra `snapshots` member. It continued to send the legacy mutation-only request, ignored the optional response field safely, consumed `results`, and drained the journal. Evidence: `/root/octoport-control/logs/C/n2-wire-legacy-consumer-probe.mjs`. This is compatibility evidence only; no new reads are sent before server-first acceptance.

## B migration invariants

`sync_entities` binding rows may be migrated using stored `state.conversationKeyDigest`. Historical `sync_request_receipts` must remain replay-compatible: the default is to retain their original wire `entity_id` and fingerprint because the fingerprint covers the old entry.

Before mutation, B must inventory collisions where multiple legacy entity rows map to one canonical conversation key. One source row can move while preserving revision/state/installation/timestamps. Multiple semantically identical rows may consolidate only under a deterministic tested rule. Conflicting rows must fail closed or use a proven deterministic reconciliation migration; row-order winner and silent loss of FINISH/tombstone/delivery state are forbidden.

Server canonicalization must be deployed before or atomically with data consolidation so legacy clients cannot recreate split rows during rollout. B remains sole DB/migration author.

## A client invariants

A uses `conversation:<digest>` locally for binding sync. On a rare read, a new installation with no local binding may adopt compatible remote `bindingId`/revision/store metadata. Incompatible local/remote binding or store state requires explicit conflict/rebind and never silently changes marketplace/store. Credentials remain local; remote binding state never implies that marketplace credentials exist on the current installation.

Server/read failure does not block already permitted offline continuation. Pending explicit changes reconcile later. No new heartbeat/lease/polling loop is allowed.

## Acceptance matrix

1. Same account and same AI conversation on two installations resolve to one canonical server entity; second installation can read and adopt compatible binding metadata.
2. Same conversation digest under different Octoport accounts stays isolated.
3. Legacy random wire entity ID after server-first rollout canonicalizes storage and does not create a second split entity.
4. Exact historical request replay after migration returns the same stored result; changed payload with reused request ID conflicts.
5. Read-only request makes no entity/receipt mutation; missing entity returns revision 0/null snapshot.
6. Mixed mutation/read has documented coherent ordering and bounded response.
7. Conflicting store/binding produces explicit conflict, not a silent switch.
8. Existing FINISH/newer explicit-binding precedence over late delivery markers remains intact.
9. Offline failure preserves permitted local continuation and later bounded reconciliation.
10. Durable schema contains no raw AI conversation, seller report/payload, token, cookie, or marketplace credential bytes.
11. Scheduler evidence shows no per-command poll, heartbeat, lease, server poll, or WebSocket.
12. Old response consumer tolerates optional snapshots; new request fields are proven server-first.

Read-only design review evidence: `/root/octoport-control/logs/C/n2-cross-browser-contract-review-20260924-result.md`.
Operational B handoff: `/root/octoport-control/logs/C/N2_CROSS_BROWSER_SYNC_REQUEST_2026-09-24.md`.

This receipt claims the C-owned shared wire schema, generated OpenAPI representation, architecture documentation and legacy-response compatibility proof only. It does not claim B server/DB rollout, A client read/reconciliation rollout, migration activation, live DB mutation, deployment, or cross-browser acceptance.
