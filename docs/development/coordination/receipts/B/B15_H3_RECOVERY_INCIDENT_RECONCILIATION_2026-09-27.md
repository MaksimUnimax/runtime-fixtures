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

## Fresh-main reconciliation

While B15 was being completed, `origin/main` advanced to `64656567d0b9855dd7ef63f2b3918421539a0310` with the accepted C04/A117 H3 browser regression closure. The B15 file set had zero direct overlap with that main drift. B merged the fresh main on a clean boundary; merge HEAD before this receipt-only update is `b610857ddada9f2f6a200125c0f1569b99a968ea`.

Because the accepted main changed H3 runtime/profile code used by the B15 integration fixture, the authenticated-deep disposable test was rerun after the merge:
- `tests/integration/server/health-authenticated-deep-scope.integration.test.ts`: **4/4 PASS**;
- supervisor: `octoport-test-b-f4ba333c81634748b9c6ff4ffc507c19.service`;
- exit code: 0;
- peak memory: 585 MiB;
- cleanup verified.

The scheduler and NO_SESSION DB source used by the prior **17/17 + 4/4 PASS** compatibility evidence did not change in this main advance, so those successful sequential results remain applicable and were not redundantly rerun.

## Main reconciliation after B14 promotion

`origin/main` later advanced to `0208145336d75d10e2286fbcd8bd0c134215c815` by integrating exact B14 `0ca2566d0b37d01e6d2f8fcb12357e86295580b3`. B15 already contained the same B14 content in its history.

B merged this fresh main on a clean boundary. The repository tree SHA before and after the merge was exactly the same: `f137b2e68688d4944bfd7512587634bd90ec3910`. Therefore no B15 production or test bytes changed, and the existing B15 disposable PostgreSQL evidence remains directly applicable without redundant rerun.

Merge HEAD before this receipt-only update: `50d203269024801644dd1297630d5e7a2371a2b3`.
## Main acceptance — 2026-09-27

C integrated exact B15 `2153b919a6a2ec398d21135f24a7219268ed5e68` into candidate `641bf3d2f6ec6c535afb335ae1af86ea8a5a84f8`. All five GitHub workflows for that exact combined SHA completed SUCCESS: Server CI, Extension CI, Documentation CI, Coordination and release safety, and Extension I1-C1 client.

`origin/main` was then promoted non-force to exact `641bf3d2f6ec6c535afb335ae1af86ea8a5a84f8`, so B15 is now SOURCE-accepted in the canonical main line. This does not imply live authenticated-H3 acceptance or deployment.

B reconciled the accepted main into `work/b-backend`. Before reconciliation, B HEAD `02689b027c84f8b6b5857a4291dee1da8065e622` and `origin/main` had the identical tree SHA `0ab8a7a34db73ee7dc391e9f4ce781774f080c22`; after merge the tree remained exactly the same. No product or test bytes changed, so no redundant test rerun was required. The latest post-main B-owned H3 disposable regression remained **4/4 PASS** under supervisor `octoport-test-b-1842050315e34bae8fa9955a7e0db992.service`, exit 0, peak 525 MiB, cleanup verified.
