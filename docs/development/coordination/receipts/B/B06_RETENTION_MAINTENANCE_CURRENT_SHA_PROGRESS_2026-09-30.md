# B06 — retention maintenance current-SHA progress — 2026-09-30

Status: **SOURCE + DISPOSABLE POSTGRESQL PASS / NO NEW PRODUCT SOURCE DIFF / NOT LIVE**.

Controller notice: `B-L1-RESUME-EXISTING-B06-20260930T1117Z`.
Task: `B_AUTO_RETENTION_MAINTENANCE`.

## Exact current identity

- B HEAD: `3d48c745afaebe69083e88b29776edefb1b7dd58`.
- `origin/main`: `ce66837f59ea1fa186dbcf582efb1edabc33a531`.
- Relevant B06 product paths have no diff between B HEAD and `origin/main`.
- The current integrated implementation includes later corrections after the original B20 handoff, including legacy writer receipt backfill and the pinned pilot runner boundary.
- This review makes no product source change. The current integrated source is the candidate under verification.

Current relevant blob identities:

- `tooling/server/monitor-pilot-retention.ts`: `82b6adf66462658e38c1bd9b4a4edfe67813262a`.
- `tooling/server/monitor-pilot-retention.test.ts`: `e59dfb94c43cf8f15743237291c48025b4630f8a`.
- `tooling/operations/monitor_pilot_retention_runner.py`: `cf717f6451fce3de0cacefdef69e3d09bb098a84`.
- `tooling/operations/test_monitor_pilot_retention_runner.py`: `b65f739d7de03c3fbe577e710d243f99fbdd146a`.
- `tests/integration/server/monitor-pilot-retention.integration.test.ts`: `9406d0dfa3bb2dd154ee21c873aecde809492ce6`.
- `packages/server/db/src/health-retention-upgrade.integration.test.ts`: `d365d8669b88c85ba7608f0334a0be537c781255`.
- `packages/server/db/src/health-retention-repository.ts`: `3fd09817855dc73f4f0680447bd240cf80d133f4`.
- `packages/server/db/drizzle/0052_monitoring_bounded_retention.sql`: `c032333d292fce948b08af25b34d021c89a1571d`.

## Current-SHA contract verification

Environment was pinned explicitly to Node `24.20.0` and pnpm `10.34.5`; the ambient Node `22.22.2` was not used.

CLI contract:

- `tooling/server/monitor-pilot-retention.test.ts`: **7/7 PASS**.
- Resource job: `octoport-test-b-0cd09bdeb743441398963605868234eb.service`.
- Exit 0; peak 472 MiB; cleanup verified.

Operational runner:

- `tooling/operations/test_monitor_pilot_retention_runner.py`: **13/13 PASS**.
- Resource job: `octoport-test-b-47f43ba34c994de0b60fc7156491735d.service`.
- Exit 0; peak 26 MiB; cleanup verified.

Disposable PostgreSQL finite maintenance:

- `tests/integration/server/monitor-pilot-retention.integration.test.ts`: **3/3 PASS**.
- Resource job: `octoport-test-b-4fbbaa57fe904a26834eb203a9c04473.service`.
- Exit 0; peak 533 MiB; cleanup verified.

Disposable PostgreSQL legacy upgrade/orchestration:

- `packages/server/db/src/health-retention-upgrade.integration.test.ts`: **11/11 PASS**.
- Resource job: `octoport-test-b-ff1b9930005743e4bd0a16de8fa0cb26.service`.
- Exit 0; peak 534 MiB; cleanup verified.

The legacy suite proves current 0051 -> 0052/current continuation, durable receipt backfill, compact projection, bounded continuation, silent legacy incident reconciliation, keyset/pin behavior, eligible raw-payload pruning, decisive HEALTHY/BROKEN ordering behind UNKNOWN observations, and no recovery-only notification replay.

## First combined-run failure and established cause

A first command invoked both destructive integration files together with Vitest's normal file-level parallelism:

- resource job `octoport-test-b-9886544c077649cdbfeb9fd6f8ac7f2a.service`;
- exit 1; OOM 0; cleanup verified.

The wrapper did not preserve the test stdout for that run. This was not classified as a resource failure.

The two files both operate on the same B disposable database and reset/rebuild its schemas during setup/test execution. Running them individually produced 3/3 and 11/11 PASS. Running the same two files together with file-level parallelism disabled produced:

- **2/2 files PASS; 14/14 tests PASS**;
- resource job `octoport-test-b-ab61e62692a942e287f6721fe83a9002.service`;
- systemd result `success`, exit 0;
- saved log `/root/octoport-control/logs/B/b06-retention-combined-serialized.log`.

Therefore the first combined exit1 is attributed to concurrent destructive use of the same disposable test database, not to a B06 product defect. No test was weakened; the final combined invocation only serialized file execution against the single disposable DB.

## B06 disposition

The exact API/CLI contract and finite retention semantics requested by L1 are present and current-SHA verified:

1. inspect remains read-only and authority-gated;
2. apply requires explicit confirmation and canonical pilot authority;
3. projection/backfill and legacy incident reconciliation are finite and idempotent;
4. inventory is bounded/keyset-driven and can page past pinned rows;
5. eligible raw payload pruning remains repository-authoritative and graph/pin guarded;
6. compact replay receipts and terminal metadata retain their longer no-replay horizon;
7. partial/backlog/deadline outcomes remain explicit rather than false success;
8. the Python runner preserves bounded continuation and hard outer supervision semantics.

No new daemon/poller, schema, migration, direct SQL deletion path, live database write, provider/browser execution or Telegram delivery was added or performed by this verification.

## Handoff to C

There is **no new product source candidate to merge**: the verified B06 product implementation is already present in current `origin/main` `ce66837f59ea1fa186dbcf582efb1edabc33a531`, and B HEAD has no relevant product diff from main.

C should consume this current-SHA evidence for any remaining isolated-pilot wiring/acceptance work. B does not perform live pilot apply/deployment under this notice. Any actual live maintenance outcome remains C-owned and must stay distinct from SOURCE/DISPOSABLE_POSTGRESQL evidence.
