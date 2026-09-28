# B18 late decisive retention correction — 2026-09-28

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CORRECTIVE CANDIDATE — NOT LIVE**

Task: `B18_LATE_DECISIVE_CORRECTION`.

Authority: controller notice `B-B18-LATE-DECISIVE-20260928-0924`.

Base before this correction: `27df48d5d3f5cca6734d83afa1bea4c224144476`.

## Defect

The max-3 compact NO_SESSION ring retained three newer UNKNOWN fingerprints and rejected a later-arriving decisive HEALTHY/BROKEN whose observation timestamp was older than the oldest UNKNOWN. That could erase the last decisive health knowledge even though latest overall observation correctly remained UNKNOWN.

This was a bounded storage/order problem only. It did not require a new schema or migration.

## Correction

`recordNoSessionCompactStateInTransaction()` now treats decisive and UNKNOWN eviction differently when the ring is full:

- UNKNOWN still replaces only an older UNKNOWN/current oldest by ordinary chronological ordering;
- a non-UNKNOWN result is retained only when it advances the current last-decisive knowledge;
- when such a decisive result must be retained and at least one UNKNOWN slot exists, it may evict the oldest UNKNOWN even if the decisive observation itself is older;
- an older decisive result does not displace an already newer decisive result;
- ring cardinality remains at most 3;
- `health_no_session_scope_states.latest_*` still describes latest overall observation, so newer UNKNOWN remains latest;
- incident ordering continues to use the latest decisive compact state, not UNKNOWN as health proof.

No provider/browser execution, scheduler send, live DB mutation or production cleanup was performed.

## Disposable PostgreSQL acceptance

Pinned Node `24.20.0`, pnpm `10.34.5`.

Upgrade/order-equivalence suite:
- `packages/server/db/src/health-retention-upgrade.integration.test.ts`: **8/8 PASS**;
- supervisor `octoport-test-b-fbdbfd031dcb4d4c884568d480c916b3.service`, exit 0, peak 539 MiB, cleanup verified;
- proves:
  - 0051→0052 migration/backfill remains idempotent;
  - legacy reconciliation/keyset/prune path remains correct;
  - older BROKEN cannot reopen behind newer processed HEALTHY;
  - latest UNKNOWN does not erase last decisive HEALTHY/BROKEN;
  - **three newer UNKNOWN states projected first, then an older HEALTHY is retained as last decisive while latest overall remains UNKNOWN**;
  - same sequence with late older BROKEN is retained;
  - after late HEALTHY is processed, an even older BROKEN is ignored and does not open a stale incident;
  - historical silent incident recovery produces no recovery-only notification.

Main no-session lifecycle:
- `packages/server/db/src/health-no-session-persistence.integration.test.ts`: **7/7 PASS**;
- supervisor `octoport-test-b-713fcbb5da524e8b95495f5ab9a7fdfd.service`, exit 0, peak 540 MiB, cleanup verified.

Quality:
- DB unit tests: **31/31 PASS**;
- DB typecheck PASS;
- targeted ESLint PASS;
- targeted Prettier PASS;
- `git diff --check` PASS;
- supervisor `octoport-test-b-67997d2e3037498480b9cc038d4cfa97.service`, exit 0, peak 731 MiB, cleanup verified.
- focused typecheck/format before PG: supervisor `octoport-test-b-9bc90b6818d848d190ed3630ca971ee9.service`, exit 0, cleanup verified.

A prior test attempt failed only because an additional test run reused the baseline due-slot and hit the existing scheduler unique tuple. The fixture due-slot was corrected; the product implementation was unchanged for that failure.

## Boundary

This candidate corrects B18 source behavior only. B19 repair approval/admission WIP was stashed intact before this correction and is not included.

No live 0052 application or GC is authorized by this receipt.
