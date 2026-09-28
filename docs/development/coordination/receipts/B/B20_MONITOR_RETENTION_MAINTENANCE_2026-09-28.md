# B20 — monitor retention maintenance entry point — 2026-09-28

Status: **SOURCE + DISPOSABLE POSTGRESQL CANDIDATE; NOT LIVE / NOT DEPLOYED**.

Task: `B_AUTO_RETENTION_MAINTENANCE`.

This follow-up does not change schema, migration 0052, retention policy, provider execution, browser execution, notification delivery or any live database. It adds a finite operational caller for the already accepted B18 repository APIs so C can wire them to the isolated monitor pilot.

## Command contract

Entry: `tooling/server/monitor-pilot-retention.ts`.

Modes:

- `inspect`: strict read-only preflight/inventory; performs no projection, reconciliation, prune or retirement writes.
- `apply`: requires `--confirm=ISOLATED_MONITOR_PILOT_RETENTION`; runs the same canonical pilot authority/database-identity preflight before any retention mutation.

Production identity uses the existing `MONITOR_PILOT_EXPECTED_ROLE` plus the canonical `octoport_monitor_pilot` database check in monitor-pilot authority preflight. Missing authority exits nonzero before retention-table access.

Exit codes: 0 = inspected/applied completely; 2 = missing authority; 3 = bounded partial work remains; 1 = invalid command/config/schema/error.

## Finite maintenance phases

The apply path reuses B18 without direct deletion SQL:

1. bounded idempotent `backfillNoSessionCompactProjection()`;
2. bounded silent `reconcileLegacyNoSessionIncidentProcessing()`;
3. keyset `listRoutineNoSessionGcInventory()`;
4. eligible raw payload prune through `pruneRoutineNoSessionPayload()`;
5. old already-pruned receipt retirement through `retireRoutineNoSessionReceipt()`;
6. old terminal scheduler retirement through `retireTerminalScheduledRun()`.

The repository remains the mutation authority for row locks, graph pins and monotonic schedule watermarks. The command only performs a read-only SELECT to discover safe-age terminal scheduler candidates; each retirement is still revalidated transactionally by B18.

Cutoffs are imported from B18:

- routine raw payload grace: 1 hour;
- replay receipt / terminal metadata minimum age: 8 days.

Default caps are 500 backfill, 500 reconcile, 5000 inventory rows, 250 payload prunes, 250 receipt retirements, 250 terminal retirements and a 30-second deadline. All are bounded; inventory cannot be disabled. Keyset resume is `completed_at + run_id`. A cap/deadline/race-blocked backlog returns PARTIAL rather than false success.

## Disposable PostgreSQL evidence

New command integration supervisor `octoport-test-b-ef031a9c2b3b4eecaf487b77e0813416.service`:

- monitor retention maintenance integration: **3/3 PASS**;
- exit 0;
- peak 470 MiB;
- OOM 0;
- cgroup cleanup verified.

It proves:

- inspect leaves retention/payload/scheduler/incident/notification/watermark state unchanged;
- a keyset cursor passes an oldest accepted-baseline pin and reaches later eligible work;
- five identical observations coalesce to one recent state with repeat_count=5;
- a two-item prune cap returns PARTIAL and a retry finishes remaining eligible work;
- no provider/probe replay and no notification side effect occurs during maintenance;
- three old raw payloads are pruned while receipts remain;
- after the replay horizon, three receipts and one independent terminal scheduler row retire only through four monotonic watermarks;
- repeating the maintenance run is a no-op.

Targeted unit contract: `tooling/server/monitor-pilot-retention.test.ts` **5/5 PASS**, including apply confirmation, cap/cursor validation, missing-authority no-touch path and exit-code contract.

B18 compatibility supervisor `octoport-test-b-856e56d2b1a44f9384b67515748033d5.service` ran the accepted:

- `health-retention-upgrade.integration.test.ts`;
- `health-no-session-persistence.integration.test.ts`.

Result: exit 0, OOM 0, cleanup verified. This preserves the existing real 0051 -> 0052 upgrade/legacy reconciliation and retention/no-replay proof; no migration was changed for B20.

Workspace typecheck supervisor `octoport-test-b-23f29f06f1a543a68c97d0ed114f9dfa.service`: exit 0, OOM 0, cleanup verified.

Targeted ESLint PASS, Prettier PASS and `git diff --check` PASS.

## Handoff to C

C should integrate the exact B20 source candidate, deploy/wire it only inside the already authorized isolated monitor pilot, run `inspect` first, review result/cursor/reason counts, and only then invoke explicit `apply` with accepted finite caps. B does not run this command against the live pilot.

This is not a daemon, second poller or alternate retention implementation. The next independent B task is the DB-backed operator read projection for monitor repair case/candidate/decision/operation state.
