# B01 migration lineage receipt — 2026-09-23

Status: **SOURCE / READ-ONLY INVENTORY / DISPOSABLE-DB PASS; LIVE MIGRATION NOT AUTHORIZED**

Base HEAD before B01: `dc63fc6290b0ecd78d8b31452811dc5a93d89f38`
Role/branch: B / `work/b-backend`

## Scope

B01 verifies canonical migration lineage, inventories the preserved legacy Stream-2 database without mutating it, hardens fail-closed startup for untracked database objects, and records the safe reconciliation boundary. No live migration, applied-journal rewrite, production deploy, or production data mutation was performed.

## Source lineage

- Intake source: `77918a1ea5f8cd764bf6abe94b8dfb0ad61f7fd3`.
- Intake canonical base: `bdfaafc45612bd3ceacb52534478217fe17b6ff8`.
- The 14 mapped Stream-2 SQL files are byte-identical to canonical `0034..0047`: `14/14`, mismatches `0`.
- The normal migrator continues to accept only an exact ordered canonical `(hash, created_at)` prefix.

## Read-only database observations

Active `seller-agents-owner-test-postgres` was inspected read-only and contains 22 applied rows that classify as an exact canonical prefix. No mutation was performed.

The archived `s2l6-r2-postgres-20260918` source container remained stopped. Its volume was cold-copied to an isolated clone before inspection. The source metadata fingerprint was identical before and after the copy:
`df4816b2a9d4fca7990d2049745bf03a0c29e858d289f5761cd482a36b9c5718`.

The clone contains 20 applied migration rows:
- rows 1..17 match the canonical product prefix;
- row 18 is the durable-health-scheduler SQL hash with legacy timestamp `1789395000000`;
- rows 19..20 are canonical I1 sync and D3S2 credential-transfer migrations.

Classification: `OBSERVED_HYBRID_EXACT`.
First divergence from canonical lineage: zero-based applied position `17`.

A logical `pg_dump -Fc --no-owner --no-privileges` rehearsal on the isolated legacy clone failed because the clone catalog contains dangling references. That logical dump is therefore **not** accepted as recovery evidence. The source catalog is not to be repaired in place merely to make a dump succeed.

## Code hardening

Modified B-owned DB files only:
- `packages/server/db/src/migrations.ts`
- `packages/server/db/src/migrations.test.ts`
- `packages/server/db/src/canonical-lineage.integration.test.ts`

Behavior added:
- missing or empty Drizzle ledger plus existing objects in `public` fails with `MIGRATION_HISTORY_UNTRACKED` before invoking the migrator;
- detection covers relations, types and functions in the application schema;
- the observed legacy hybrid tuple sequence fails with `MIGRATION_HISTORY_DIVERGED` without changing migration rows or preserved test data.

## Verification on final diff

Environment: Node `24.20.0`, pnpm `10.34.5`.

- `pnpm --filter @product/db test`: **29/29 PASS** across 5 files.
- `pnpm --filter @product/db typecheck`: **exit 0**.
- targeted disposable PostgreSQL:
  `B heavy --db -- pnpm exec vitest run --config tests/integration/server/vitest.config.ts packages/server/db/src/canonical-lineage.integration.test.ts`: **6/6 PASS**.
- Prettier check for changed files: **PASS**.
- `git diff --check`: **PASS**.
- Stream-2 source mapping verifier: **14/14 byte-identical**.

## Safe reconciliation boundary

The observed legacy database is not a canonical prefix. Normal migration must stay fail-closed.

Do not delete, renumber or substitute applied journal rows; do not falsify hashes/timestamps; do not drop/reset the source database to make the guard pass.

The safe next decision path is:
1. preserve the legacy source unchanged;
2. retain verified physical/cold backup material;
3. investigate catalog inconsistency only on disposable copies;
4. prefer a fresh canonical database plus explicit vetted application-data transfer if an in-place forward-only path cannot be proven;
5. if an in-place path is proposed, rehearse it from a fresh restore and prove data/application invariants;
6. require separate explicit owner authorization for any live operation.

This receipt is not LIVE_OWNER, DEPLOYMENT or PRODUCTION acceptance. The B01 data-risk review remains open for controller review.
