# C04 no-session durable persistence — B handoff — 2026-09-24

Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE. No live DB mutation, production deployment, browser execution, beta admission, or notification delivery is claimed.

## Exact requested boundary

Implements the accepted C04 -> B persistence request without coercing no-session truth into BASELINE_CONTRACT_FIXTURE/C01-C13 and without creating a second scheduler or parallel monitoring store.

Public DB repository boundary:
- createHealthNoSessionPersistenceRepository(runtime)
- persistCompletedNoSessionHealthRun({
    scheduledRunId,
    observation,
    classifierVersion,
    startedAt,
    completedAt
  })

C does not provide adapter/surface/profile UUIDs or machine-key authority hints. B derives:
- adapter machine key from validated provider/surface identity;
- surface machine key from validated no-session surface mapping;
- profile machine key from observation.strategyId;
then resolves ACTIVE adapter/surface/profile and exactly one PUBLISHED browser-compatible P7 profile revision inside the DB transaction. Missing/inactive/ambiguous authority fails closed with stable codes.

## Persistence shape

Migration 0049_s2_l5_no_session_persistence:
- adds DB-local health_run_kind: BASELINE_CONTOUR | NO_SESSION_OBSERVATION;
- keeps health_runs as common scheduler/incident/outbox authority;
- NO_SESSION_OBSERVATION requires scheduled_run_id, H2, no baseline suite, no extension/adapter-engine version and no operator-maintenance authority;
- baseline contour rows are guarded so they cannot attach to no-session runs;
- adds immutable one-to-one health_no_session_observations;
- adds immutable metadata-only health_no_session_evidence_references;
- DB guards prove detail classification matches health_runs.health_state, observedAt lies inside run time, evidence derives exactly from validated observation, and no-session evidence is bounded METADATA only.

The repository:
- parses exact @product/health NoSessionObservationResultSchema;
- persists observation.classification exactly as health_runs.health_state;
- never invokes the baseline classifier;
- writes only the validated observation contract + bounded metadata references;
- binds the existing health_scheduled_runs.id;
- exact replay of the same scheduled result returns the same healthRunId;
- conflicting reuse fails NO_SESSION_SCHEDULED_RUN_CONFLICT;
- first persistence requires the schedule to be RUNNING;
- reconcilePersistedResults can recover a crash after run persistence and before scheduler finalization.

## Incident / admin compatibility

health-incident-repository branches by run_kind:
- BASELINE_CONTOUR retains the existing suite/contour reclassification path;
- NO_SESSION_OBSERVATION loads the immutable no-session observation, verifies persisted classification equality, uses rootContourKey=null, and uses the existing incident + LLM_HEALTH notification/outbox lifecycle;
- UNKNOWN is NOOP and does not resolve an active incident;
- HEALTHY resolves the same no-session incident identity.

health-admin-read-repository returns no-session metadata evidence through the existing evidenceReferences projection and leaves contourStatuses empty for no-session.

## Verification

Node 24.20.0 / pnpm 10.34.5.

Final focused static gate after caller-authority removal:
- Prettier focused files: PASS
- ESLint focused files: PASS
- @product/db typecheck: PASS
- resource job: 47636183e17a4378b2d24ce0472457d3
- exit 0, OOM 0, cleanup_verified, peak 731906048 bytes

Final source gate:
- Prettier all changed tracked source/test files: PASS
- ESLint all changed tracked TS files: PASS
- @product/db typecheck: PASS
- @product/db unit: 31/31 PASS
- resource job: 2962d69898d84acdaab01c86181a6baf
- exit 0, OOM 0, cleanup_verified, peak 729808896 bytes

Final focused C04 disposable PostgreSQL acceptance:
- 1/1 PASS
- covers exact classification persistence, H2/run_kind shape, DB-resolved P7 identity, no baseline contours, metadata evidence, exact replay/conflict, scheduler crash reconciliation, provider/surface/profile/revision fail-closed cases, ambiguous revision, incident/open+recovery outbox, UNKNOWN no-op with active incident, admin evidence projection
- log: /root/octoport-control/logs/B/c04-no-session-persistence-postgres-final-20260924.log
- resource job: 446a637a9f02442388e6b6601a987fac
- exit 0, OOM 0, cleanup_verified, peak 583008256 bytes

Final clean migration smoke:
- postgres.integration.test.ts 3/3 PASS
- log: /root/octoport-control/logs/B/c04-postgres-migration-smoke-final-20260924.log
- resource job: 63f2d45606da4e069cd8ecfac1acd0e4
- exit 0, OOM 0, cleanup_verified

Sequential baseline / shared-health regression on disposable B DB:
- canonical-lineage 6/6 PASS
- health-persistence 22/22 PASS
- health-incidents 7/7 PASS
- health-scheduler 17/17 PASS
- health-notification 7/7 PASS
- health-admin-read 2/2 PASS
- health-diagnostics-read 2/2 PASS
- total 63/63 PASS
- log: /root/octoport-control/logs/B/c04-health-regression-sequential-r2-20260924.log
- resource job: 68d79895c5b648e09f58ac3e75796fe7
- exit 0, OOM 0, cleanup_verified, peak 591396864 bytes

DB unit migration/schema checks:
- 31/31 PASS in final source gate.

Two earlier focused PostgreSQL failures are NOT acceptance evidence and were test-fixture defects only:
1. fixture attempted direct PUBLISHED P7 revision; corrected to real DRAFT -> CANDIDATE -> PUBLISHED lifecycle;
2. fixture reused one (monitor_target, revision) schedule identity; corrected to unique schedule revisions.
Production guards were not weakened.

A prior sequential regression attempt correctly discovered one stale acceptance expectation (migration count 38 -> 39). Canonical-lineage was updated and the clean rerun passed 6/6.

## Files / ownership

B-owned DB/migration/test paths only:
- packages/server/db/drizzle/0049_s2_l5_no_session_persistence.sql
- packages/server/db/drizzle/meta/_journal.json
- packages/server/db/src/schema/health.ts
- packages/server/db/src/health-no-session-persistence-repository.ts
- packages/server/db/src/health-no-session-persistence.integration.test.ts
- packages/server/db/src/health-incident-repository.ts
- packages/server/db/src/health-admin-read-repository.ts
- packages/server/db/src/index.ts
- packages/server/db/src/postgres.integration.test.ts
- packages/server/db/src/canonical-lineage.integration.test.ts

No C-owned health runtime/shared contract file was edited.

## C integration contract

C can now wire its existing NoSessionObservationResult directly to this repository with:
- claimed scheduledRunId;
- validated observation;
- bounded classifierVersion;
- startedAt/completedAt.

C must not fabricate UUIDs or identity authority. Browser execution remains C-owned. The existing scheduler remains authoritative; do not add another scheduler.

No live migration or production activation is authorized by this receipt.
