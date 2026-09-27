# B15 H3 recovery incident reconciliation — 2026-09-27

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CANDIDATE — NOT LIVE / NOT DEPLOYED**

Assignment: precise B-owned C04 persistence-recovery blocker reported after B14 handoff.

## Defect

`health-scheduler-repository.ts::reconcilePersistedResults()` reconciled committed health results after an interrupted scheduler finalization. Before this patch it called the existing idempotent `processCompletedHealthRun()` only when `run_kind=NO_SESSION_OBSERVATION`.

Authenticated-deep H3 persistence uses the existing baseline health-run storage path while its scheduler row has `probe_layer=AUTHENTICATED_DEEP`. Therefore a process crash after H3 persistence but before incident processing could leave a committed BROKEN H3 run; reconciliation could then mark the scheduler row `SUCCEEDED` without creating/updating the existing incident + notification-intent state.

## Change

Code commit: `42f247493cd4ab7cca94494cf163ff2ff86fca49`.

The recovery query now reads the scheduler `probe_layer`. Before scheduler success, it invokes the existing idempotent incident processor when either:

- the committed run is `NO_SESSION_OBSERVATION`; or
- the scheduler row is `AUTHENTICATED_DEEP`.

No schema, migration, queue, health runtime, shared contract, live catalog or deployment behavior was added.

The authenticated-deep disposable integration scenario now explicitly simulates:

1. AUTHENTICATED_DEEP scheduled run is RUNNING;
2. H3 BROKEN result commits;
3. no incident or notification intent exists yet (simulated crash boundary);
4. `reconcilePersistedResults()` runs;
5. incident processing succeeds before the scheduler row becomes `SUCCEEDED`;
6. the expected `INCIDENT_OPENED` notification intent exists;
7. a second reconciliation is a no-op.

## Verification

Pinned toolchain: Node 24.20.0 / pnpm 10.34.5.

Disposable PostgreSQL H3 regression:
- `tests/integration/server/health-authenticated-deep-scope.integration.test.ts`: **4/4 PASS**.
- This includes the new crash-after-persist-before-incident H3 reconciliation scenario.

Compatibility checks were then run sequentially in one supervised disposable DB job:
- `packages/server/db/src/health-scheduler.integration.test.ts`: **17/17 PASS**;
- `packages/server/db/src/health-no-session-persistence.integration.test.ts`: **4/4 PASS**;
- supervisor: `octoport-test-b-7b01f20fe7b94db3bcc6343ee9a0f8f6.service`;
- exit code: 0;
- peak memory: 549 MiB;
- cleanup verified.

An earlier attempt to run all three schema-resetting integration files concurrently used `octoport-test-b-0b0b73e842554b0d9099164114f665aa.service`. The H3 file itself passed **4/4**, while the other two collided while independently dropping/creating the same disposable `public` schema (`schema public already exists` / missing relation). That run is classified as a test-orchestration race, not product evidence; the sequential rerun above is the applicable compatibility evidence.

Quality gates:
- `pnpm --filter @product/db typecheck`: PASS;
- targeted ESLint: PASS;
- targeted Prettier: PASS after formatting-only correction;
- `git diff --check`: PASS.

## Boundary

This fixes source/disposable recovery ordering only. It does not authorize live H3 sessions, live DB mutation, monitor runtime changes, deployment, store/admin mutation, or production acceptance. C remains owner of monitoring/runtime integration and main promotion.
