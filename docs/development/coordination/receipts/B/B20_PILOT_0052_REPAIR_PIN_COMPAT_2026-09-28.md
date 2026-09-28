# B20 — pilot 0052 / repair-pin compatibility — 2026-09-28

Status: **SOURCE + DISPOSABLE POSTGRESQL CANDIDATE; NOT LIVE / NOT DEPLOYED**.

Task: `C-B-B20-PILOT0052-B19-PIN-COMPAT-20260928-1607`.
Base: `d448e41b741561f1516f41df81a60f3c6f5ad9ca`.

## Defect

The accepted B20 GC inventory SQL unconditionally parsed `monitor_profile_repair_bindings`, introduced by migration 0053. The authorized isolated monitoring pilot is intentionally still at retention schema 0052, so read-only maintenance `inspect` failed before inventory with PostgreSQL `42P01` even though all 0052 retention tables were present.

## Correction

`health-retention-repository.ts` now probes schema capability with read-only `to_regclass('public.monitor_profile_repair_bindings')` for each inventory/prune operation and renders one of two static GC inventory SQL forms:

- pre-0053: the SQL contains no reference to the absent repair table;
- 0053+: the existing repair pin predicate remains present and checks `observation_run_id`, `accepted_baseline_run_id`, and `rollback_run_id` before incident/notification/baseline/recent-state eligibility.

The capability is not cached for repository lifetime, so a sequential 0052 -> 0053 rollout starts honoring repair pins without requiring a process restart. No migration, retention cutoff, incident/notification pin, accepted-baseline pin, recent-state pin, scheduler guard, or live database is changed.

## Disposable PostgreSQL evidence

Pinned toolchain: Node `v24.20.0`, pnpm `10.34.5`.

### Exact 0052-only command boundary

Supervisor: `octoport-test-b-44c4dff9ce6f4538960c396803d39863.service`.

- `packages/server/db/src/health-retention-upgrade.integration.test.ts`: **10/10 PASS**;
- new regression constructs a real migration prefix through 0052 only, confirms `monitor_profile_repair_bindings` is absent, and invokes `runMonitorPilotRetentionMaintenance(mode=inspect)`;
- result is `INSPECTED`, inventory scans the legacy receipt as `PROJECTION_MISSING`, no `42P01` occurs and no mutation is performed;
- all existing 0051 -> current projection/reconciliation/order/no-replay regressions remain green;
- exit 0, peak 584 MiB, cleanup verified.

### Post-0053 repair pin boundary

Supervisor: `octoport-test-b-463b6129b1d94044bdb34e413602e761.service`.

- targeted `monitor-profile-repair-admission.integration.test.ts` GC pin regression: **1/1 PASS** (19 unrelated tests skipped);
- a registered repair binding keeps its routine observation payload `REPAIR_APPROVAL_PINNED` and blocks prune;
- the production SQL branch still contains all three repair evidence references: observation, accepted baseline and rollback. The canonical fixture's baseline/rollback runs are baseline-contour rows rather than routine GC receipt rows, so no invalid synthetic receipt was fabricated merely to force those branches;
- exit 0, peak 573 MiB, cleanup verified.

### B20 command current-schema consumer

Supervisor: `octoport-test-b-054cb77fe04e41a28d98fc1b48c16ccd.service`.

- `tests/integration/server/monitor-pilot-retention.integration.test.ts`: **3/3 PASS**;
- exit 0, peak 642 MiB, cleanup verified.

## Light checks

Under Node `v24.20.0` / pnpm `10.34.5`:

- `@product/db` typecheck PASS;
- targeted Prettier PASS;
- targeted ESLint PASS;
- `git diff --check` PASS.

An earlier local light-check invocation inherited Node 22 from the interactive shell; it is not counted as evidence. The canonical checks above were rerun under the pinned Node 24.20.0 runtime.

## Boundary

This candidate fixes SOURCE/disposable PostgreSQL compatibility only. B does not apply retention to the live isolated pilot, migrate it to 0053, or bypass C's authority/preflight. C may re-run `inspect` against the authorized 0052 pilot after exact intake; any live `apply` remains separately controlled by C.
