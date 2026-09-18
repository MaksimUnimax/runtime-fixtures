# D3S2-1 Store Metadata/State — implementation evidence

Work ID: `D3S2-1-STORE-METADATA-STATE-2026-09-18`

Status: `IMPLEMENTED_CANDIDATE / REMOTE_NOT_VERIFIED`

This document records bounded local implementation evidence. It is not an
architect acceptance, production deployment, browser-store publication, or
live provider certification.

## Base and safety

- Start HEAD: `57f872b84bd121959c368d571d6bf9b80fdb3839`
- Start tree: `c1fdc6a2ed3dd77af499bdb3fed14d7fb471d050`
- Start classification: `ACCEPTED_BOUNDED_AUDIT / REMOTE_NOT_VERIFIED`
- Branch: `feature/d3s2-store-metadata-state-2026-09-18`
- R0 evidence preservation commit: `a5a9e64dea363bdd0e777fe3e79e8176eb5999de`
- R0 evidence tree: `6b59b3d6c163f2adc4c0c614cbebefb2d44a1e64`

The R0 files preserved in that commit are `D3S2_R0_SOURCE_OF_TRUTH.md`,
`D3S2_R0_RESIDUAL_MATRIX.md`, `D3S2_R0_DEPENDENCY_MAP.md`, and
`D3S2_R0_QA.md`. The A03 correction preserves the historical
`PASS_AUTOMATED_CURRENT_SCOPE`: local deletion ends/fences local work and a
late result does not attach to another store. Broader D3/S2 store-state
convergence is documented as an extension, not a rewrite of that acceptance.

Remote heads checked before implementation:

- `origin/main` = `bc718cc5c677ad0eb4598e7de3ad766473ff0847`
- `origin/integration/i1-c1-srv5-2026-09-16` = `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- `origin/docs/roadmap-autonomy-correction-2026-09-18` = `6a48af8cd19137aaa10688c36cb064d3c4b16969`

No newer legitimate Stream-1 descendant was found. Existing unrelated
`repro/` and server/shared untracked symlink entries were preserved and were
not staged.

## Red-first receipt

The complete reachable batch is
`tests/regression/extension-core/client-i1/client-d3s2-store-metadata-state.mjs`:
59 cases covering STORE-01..32, SYNC-33..40, BIND-41..45, REPLAY-46..50,
PRIV-51..55, and CALL-56..59.

Initial red batch: 24 failures — STORE-03, 05, 06, 07, 14, 15, 16, 17,
19, 23, 24, 25, 26, 27, 28, 29, 30; SYNC-33, 34, 37, 38; BIND-41;
PRIV-51, 54. The remaining 35 cases were existing guards that stayed green.

Root-cause groups were: catalog lacked lifecycle/provider metadata; credential
revision was not represented as an opaque fence across metadata; C3E had no
typed store operation path; C3F/server reconciliation only handled binding and
delivery state; tombstone dominance was absent; and privacy allowlisting did
not cover the new state.

Focused green receipts:

- D3/S2 matrix: 59/59 passed.
- Direct C3E journal test: rename, offline retention, tombstone compaction,
  recovery ACK projection all passed.
- Server sync tests: 16/16 passed across the D3/S2, existing index, and
  reconciliation suites.

## Architecture delta

The local catalog now represents account-scoped stable `storeId`, marketplace,
label, lifecycle, metadataRevision, opaque credentialRevision, confirmed or
unconfirmed provider identity, and local `credentialsStale` state. Credentials
remain local only. Rename changes metadataRevision and name but does not change
storeId, marketplace, provider identity, or credentialRevision.

Credential revisions are opaque UUID fencing values for new credential changes;
unchanged credentials retain their revision. No new synchronized value is a
credential hash or secret-derived fingerprint. WB execution now relies on the
existing execution-context guard for the opaque revision; the historical WB
hash check is retained only for old local 64-hex fixture snapshots.

Provider identity is confirmed only from an explicit provider result field.
Labels, token shape/equality, timing, browser state, and unconfirmed failures
cannot bind identity. A confirmed different provider account fails closed.

Delete is locally immediate, clears local credentials, hides/denies the store,
fences active work, and records a metadata-only tombstone. C3E carries
`STORE_UPSERT` and `STORE_TOMBSTONE` using the existing requestId,
baseRevision, durable journal, ACK/conflict, compaction, retry, and P3 wake
paths. Tombstones dominate stale upsert/rename/update/ACK and recreation uses a
new storeId.

C3F gains store-specific deterministic reconciliation classes for compatible
state, stale revision, confirmed identity mismatch, tombstone dominance, and
unknown remote installation state. BindingRevision, explicit Finish, store
switch, last-delivered eligibility, and preferredExecutor logic remain on the
existing reconciliation path.

Server contracts accept only the minimum store metadata fields. Existing
`sync_entities` JSONB persistence is sufficient; no migration was required.
No new endpoint, queue, scheduler, heartbeat, WebSocket, lease, provider retry,
secret channel, transfer, or export/import path was added.

## Files and persistence

Changed implementation areas:

- `packages/bridge-core/src/stores/catalog.js`
- `packages/bridge-core/src/sync/reconciliation.js`
- `packages/contracts/src/index.ts`
- `packages/server/sync/src/reconciliation.ts`
- `packages/server/sync/src/index.ts`
- `apps/extension/src/application/runtime.js`
- `apps/extension/src/application/sync-journal.js`
- `packages/marketplaces/wildberries/src/adapter.js`

Added tests:

- `tests/regression/extension-core/client-i1/client-d3s2-store-metadata-state.mjs`
- `tests/regression/extension-core/client-i1/client-d3s2-c3e-store-journal.mjs`
- `packages/server/sync/src/d3s2-store-metadata.test.ts`

No database migration changed. No Stream-2 implementation path was modified;
the overlap check covered `apps/health-runner/**`, `packages/server/health/**`,
and `tooling/api-watch/**`.

## Regression and package evidence

- Client D3/S2 matrix: PASS, 59/59.
- C3E direct test: PASS.
- Extension application regression: PASS, APP-00..10 and C3A-01..04.
- Full Extension I1 checker: all source, C3D, C3F, C3G, P1/P2/P3 and C3H
  assertions pass except AUT-47, the externally deferred native unpacked
  Chromium MV3 registration gate.
- Server sync/index/reconciliation tests: PASS, 16/16.
- Full server unit suite excluding integration: PASS, 73 files and 1,552
  tests. DB package run had 3 non-integration files pass; 8 PostgreSQL-backed
  suites were environment-deferred because `DATABASE_URL` was not configured.
- Typecheck: contracts, server sync, server DB, and API all PASS under Node
  24.8.0.
- Deterministic composition: repeat archive equality and source/extracted byte
  parity PASS. Latest checker package: 2,030,077 bytes,
  SHA-256 `2f2e3719f66a479a25a5ac64ba30a0875d9a80900c5349af9c3f1e4a24f5d9da`.
- Live provider calls: 0. Real unpacked Chromium PASS is deferred; no other
  browser-family PASS is claimed.

The ordinary command/delivery control-call instrumentation remains zero in the
existing AUT-42/AUT-43 and application no-control-call fixtures for both Ozon
and WB command paths and ordinary delivery. Store-state reconciliation itself
does not call either provider adapter and has zero provider calls in the D3/S2
and replay receipts.

Privacy review found no marketplace credentials, raw provider responses, seller
reports, provider files, AI text, or secret-derived credential fingerprint in
the new sync payload or server persistence. Synthetic credentials only were
used in tests.

Transfer (`A22/A23`), export/import (`A24`), browser-family certification,
live provider certification, owner-authenticated AI tests, Health/DOM monitor,
API watcher, publication, and production deployment were not implemented.

## Deferred and next work

Deferred: architect review/acceptance; remote publication/readback; real
unpacked Chromium MV3 registration; Firefox/Safari/Opera/Yandex environments;
live Ozon/WB provider certification; owner-authenticated AI evidence.

Remaining D3/S2 work after this bounded step is the separately scoped transfer
and export/import work, later browser/live gates, and any architect-requested
follow-up. This candidate does not self-mark D3S2-1 accepted.

Known architectural risk: legacy local WB fixture snapshots may still carry a
historical secret-derived 64-hex revision and therefore use the compatibility
check; new D3/S2 synchronized state uses opaque revisions and must not regress
to the legacy representation.
