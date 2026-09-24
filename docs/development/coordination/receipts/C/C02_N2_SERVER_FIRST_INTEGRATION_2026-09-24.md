# C02 N2 server-first integration — 2026-09-24

Role: C
Evidence level: SOURCE + DISPOSABLE POSTGRESQL.
Live DB, deployment, client rollout and production acceptance: NOT CLAIMED.

## Shared C wire

- C shared wire commit: `c4b574587a59e6f179d0ba5a5b43fc4dae44482e`.
- Exact OpenAPI acceptance-hash correction: `1ca6184056ac1151b0764df55664351394701654`.
- `1ca6184...` received all five required GitHub workflows successfully before B intake.
- Legacy `f079c2e...` extension consumer was directly probed and safely ignored optional response `snapshots` while preserving its mutation-only request shape.

## B bounded server-first intake

The normal B `submit` command was blocked by the ownership guard because the C-owned shared wire was intentionally not yet in `main`. B did not bypass that guard. Direct owner assignment plus the open C controller notice require C to accept the exact bounded N2 server chain while excluding the accumulated B branch tail.

C therefore cherry-picked only these exact B commits, in order:

1. `32874aa7d137830842259a0f4f63c25a7264b40e` — canonical binding storage server-first.
2. `f4a348e9a5d29fa6a0df99bf5039f13a0e3bc8a7` — bounded account-scoped PostgreSQL snapshot reader.
3. `91f122b60e8f8a6393c74be317e17a600a781710` — reader revalidation evidence.
4. `5f5fdbadc5034d315d3787b372d7e082a9bde2ed` — SyncService + production reader wiring.
5. `a4a9eae393f0a1bb9f038d91f36cdfe1e46bf4ef` — stable HTTP mapping for reader bounds.

The published B carrier `8884b17c0856d408390794f5b5f4f7bd7040ccff` was NOT merged because it contains unrelated historical B work including migration 0049, health and commercial/subscription changes.

## Integrated semantics

- `POST /v1/sync` remains the only sync transport.
- Optional `readEntityIds` use canonical conversation/store keys; old mutation requests remain wire-compatible.
- Reader availability is checked before any mutation if reads were requested.
- Mixed calls complete mutations first and then read committed state.
- Read-only calls do not create entities or mutation receipts.
- Mutation-only responses omit `snapshots`.
- Snapshot reads are account-scoped and recheck durable account/session/device/user authority inside the database transaction.
- Unknown entities return revision 0 and null state.
- Durable snapshot state remains bounded to 4096 UTF-8 bytes per entity; read cardinality and total mutation+read cardinality remain bounded.
- Invalid snapshot reader inputs map to stable 400 `SYNC_REQUEST_INVALID`; oversized durable state maps fail-closed to 409 `SYNC_CONFLICT`.
- No heartbeat, lease, WebSocket, server polling loop or live migration was added.

## Exact integrated C verification

Toolchain: Node 24.20.0, pnpm 10.34.5.

Build-profile resource job:
- id `d76be09e4d9b40d39c64838b8061b68b`;
- exit 0; OOM 0; peak 792,723,456 bytes; cleanup verified;
- contracts: 23/23 PASS;
- sync: 19/19 PASS;
- API sync-route + OpenAPI tests: 7/7 PASS;
- contracts/sync/db/api typecheck: PASS;
- `openapi:check`: PASS.

Disposable PostgreSQL resource job:
- id `4d3a93e8d7e6484a979ab37d4362cd8f`;
- exit 0; OOM 0; peak 619,708,416 bytes; cleanup verified;
- `packages/server/db/src/sync.integration.test.ts`: 24/24 PASS;
- chained P5.7 `STATIC-71` exact OpenAPI fingerprint check: PASS.

One prior command used a nonexistent package-level vitest config and exited before tests; resource job `c557e712857843f093029da02a058776` is environment/command error only and is not acceptance evidence.

## Remaining rollout boundary

This is the server-first candidate. It must be published to `work/c-integration`, receive the five required GitHub workflows on the exact final HEAD, then pass `C ready-main` against unchanged `origin/main` before main publication.

A client N2 read/reconciliation rollout remains subsequent work and must not precede accepted server-first main. Live migration 0049/0050, production deployment and unrelated cumulative B work remain separately gated.
