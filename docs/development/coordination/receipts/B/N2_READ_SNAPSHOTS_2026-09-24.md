# N2 bounded readSnapshots internal server reader — 2026-09-24

Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE. NOT HTTP-WIRED, NOT LIVE, NOT DEPLOYED, NOT MIGRATED.

## Authority

- FLOW_UNBLOCK_ASSIGNMENT_2026-09-24.md, B assignment.
- Existing N2 contract: receipts/C/C02_N2_CROSS_BROWSER_SYNC_CONTRACT_2026-09-24.md.
- Existing canonical storage candidate: receipts/B/N2_S1_CANONICAL_SERVER_2026-09-24.md.

## Implemented boundary

Additive internal interface:
`readSnapshots({principal: ExtensionPrincipal, entityIds: readonly string[]})`.

Implementation:
- packages/server/sync/src/index.ts defines SyncSnapshotReader/SyncSnapshot and bounded reader errors.
- packages/server/db/src/sync-repository.ts implements the real PostgreSQL reader.
- packages/server/db/src/index.ts exports createSyncSnapshotReader.
- No shared contract, HTTP schema, route, migration, lockfile, live DB, or deployment change.

## Guarantees checked

- Durable session/device/account/user authority is re-checked and SHARE-locked inside the reader transaction.
- accountId comes only from ExtensionPrincipal.
- Accepted keys are canonical conversation:<64 lowercase hex digest> or store:<storeId>; max 32 unique keys.
- Full entity key remains inside the existing sync entity_id 128-character bound.
- One bounded sync_entities SELECT follows the authority re-check.
- Missing entity returns revision 0 and null state.
- Response order exactly follows request order.
- Revision and state are read in one SELECT and remain a coherent row pair under concurrent mutation.
- Reader performs no INSERT/UPDATE, receipt creation, or updated_at mutation.
- Stored state is defensively rejected above the existing 4096-byte durable bound.
- Existing historical mutation receipt replay remains unchanged.

## Verification

Node v24.20.0 / pnpm 10.34.5.

Static:
- git diff --check: PASS.
- focused Prettier on changed files: PASS.
- focused ESLint on changed files: PASS.

Typecheck through required build profile:
- @product/sync typecheck: PASS.
- @product/db typecheck: PASS.
- resource unit: octoport-test-b-09ab0dcc8025414a9a9ad30e7913f62d.service
- exit 0; peak 757 MiB; cleanup_verified.

Disposable PostgreSQL / unit:
- @product/sync: 16/16 PASS.
- packages/server/db/src/sync.integration.test.ts: 22/22 PASS.
- New reader cases cover order/missing/no-write timestamps+receipts, account isolation, stale principal revocation at session/device/account/user layers, key/count limits, concurrent mutation/read, and historical replay preservation.
- resource unit: octoport-test-b-02fcac9f076d4969a4e376c2f91b3f21.service
- exit 0; peak 581 MiB; cleanup_verified.
- log: /root/octoport-control/logs/B/n2-read-snapshots-postgres-20260924.log

## Remaining boundary

C still owns readEntityIds/snapshots HTTP wire schemas, combined entries+reads<=32 validation, response<=256 KiB enforcement, service ordering/wiring, and final integration acceptance.
A owns client adoption behavior.
S2/0050 and live0049 remain separate and are not authorized by this candidate.
