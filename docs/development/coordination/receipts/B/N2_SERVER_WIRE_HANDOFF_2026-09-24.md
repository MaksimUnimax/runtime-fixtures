# N2 server-first HTTP/service wiring handoff — 2026-09-24

Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE. NOT LIVE, NOT DEPLOYED, NOT MIGRATED.

## Shared dependency

C-owned shared wire:
- `c4b574587a59e6f179d0ba5a5b43fc4dae44482e` — request `readEntityIds`, response `snapshots`, bounds/OpenAPI/docs/tests.
- `1ca6184056ac1151b0764df55664351394701654` — refreshed exact OpenAPI acceptance hash.

## B bounded implementation chain

Integrate these exact B commits in order; do not merge the accumulated B branch tail:
1. `32874aa7d137830842259a0f4f63c25a7264b40e` — canonical binding storage server-first.
2. `f4a348e9a5d29fa6a0df99bf5039f13a0e3bc8a7` — bounded PostgreSQL `readSnapshots` reader.
3. `91f122b60e8f8a6393c74be317e17a600a781710` — reader revalidation evidence only.
4. `5f5fdbadc5034d315d3787b372d7e082a9bde2ed` — SyncService + production PostgreSQL reader wiring.
5. `a4a9eae393f0a1bb9f038d91f36cdfe1e46bf4ef` — stable snapshot-reader API error mapping.

The current B branch also contains unrelated historical B work including 0049/commercial/health commits. That tail is explicitly outside this handoff.

## Semantics

- Existing `POST /v1/sync` remains the only endpoint.
- Reader availability is checked before any mutation when reads are requested.
- Mixed requests apply mutations first, then perform one bounded read of committed state.
- Read-only HTTP requests create no entity/receipt and preserve request order.
- Mutation-only responses omit `snapshots`, preserving legacy response shape.
- Durable session/device/account/user authority is rechecked inside the snapshot transaction.
- Invalid reader boundary maps to 400 `SYNC_REQUEST_INVALID`.
- Oversized durable snapshot state maps fail-closed to 409 `SYNC_CONFLICT`.
- No live DB mutation, migration activation, deployment, heartbeat, lease, websocket, or per-command polling is included.

## Verification on composed C wire + B server tree

Node v24.20.0 / pnpm 10.34.5.

- diff/prettier/eslint: PASS.
- build-profile typecheck: contracts, sync, db, api PASS.
- contracts tests: 23/23 PASS.
- sync tests: 19/19 PASS.
- API sync-route tests after error mapping: 3/3 PASS.
- API `openapi:check`: PASS.
- disposable PostgreSQL `sync.integration.test.ts`: 24/24 PASS.
- STATIC-71 exact OpenAPI hash: 1/1 PASS.
- final PostgreSQL log: `/root/octoport-control/logs/B/n2-wire-final-postgres-r2-20260924.log`.
- final typecheck/route log: `/root/octoport-control/logs/B/n2-wire-final-typecheck-route-20260924.log`.
- final unit/OpenAPI log: `/root/octoport-control/logs/B/n2-wire-final-unit-openapi-20260924.log`.
- STATIC-71 log: `/root/octoport-control/logs/B/n2-wire-final-static71-20260924.log`.

## Remaining boundary

C owns serial integration/main publication and final server-first acceptance. A client read/reconciliation rollout remains after accepted server-first main. S2/0050 and live0049 remain separately gated.
