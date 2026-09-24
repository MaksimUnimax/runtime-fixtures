# C04 no-session persistence bridge — B handoff

Date: 2026-09-24
Role: B
Status: SOURCE / disposable PostgreSQL PASS; NOT LIVE

## Assignment

C assignment: bfe838ea8620b163883482c2cd7d046243f201a6
Accepted base main: 4ae52bb7d79ca02487cf70f9966dac5530c14e8f
B branch parent before this bounded change: f3d02b50492e752c046c58bd42be9c2488f9529f

## Result

Added one DB-owned completion adapter that composes the already accepted authorities:
1. createHealthNoSessionPersistenceRepository(...).persistCompletedNoSessionHealthRun(...)
2. createHealthIncidentRepository(...).processCompletedHealthRun(...)

The adapter returns scheduledRunId, healthRunId, and healthState required by the existing scheduler finishSuccess, plus the incident-processing result.

No scheduler, incident, notification, Telegram, or persistence model was duplicated.

## Idempotence / recovery

The existing unique health_runs.scheduled_run_id authority and no-session result fingerprint remain the persistence fence.

If execution stops after the Health run commit but before incident processing, retry reuses the exact persisted run and processes that run.

If execution stops after incident/notification processing but before scheduler finalization, retry reuses the same run; existing incident ordering and notification deduplication prevent duplicate incidents/intents.

Replay after scheduler success also reuses the same persisted run because the existing no-session persistence repository checks the committed scheduled-run result before requiring RUNNING state.

## Schema

No migration added.

Existing 0034 scheduler linkage plus existing B-only 0049_s2_l5_no_session_persistence.sql already provide the required authority and privacy constraints.

No 0050; no live migration.

## Changed paths

- packages/server/db/src/health-no-session-completion-adapter.ts
- packages/server/db/src/index.ts
- packages/server/db/src/health-no-session-persistence.integration.test.ts
- docs/development/coordination/receipts/B/C04_NO_SESSION_PERSISTENCE_BRIDGE_2026-09-24.md

No C-owned Health service-loop, runner, notification worker, Telegram, shared-contract, or package-manifest path changed.

## Evidence

Static:
- Node 24.20.0
- pnpm 10.34.5
- Prettier focused boundary: PASS
- ESLint focused three source/test files: PASS
- git diff --check: PASS
- @product/db typecheck: PASS
  - resource unit octoport-test-b-07c612511d034e0bb4f1c40e8cda0594.service
  - exit 0
  - peak 712 MiB
  - cleanup verified

Disposable PostgreSQL:
- pnpm --filter @product/db exec vitest run src/health-no-session-persistence.integration.test.ts
- PASS 3/3
- resource unit octoport-test-b-549c0b4076af46c69f12b47848edcc5c.service
- exit 0
- peak 557 MiB
- cleanup verified

The added bridge case proves:
- RUNNING scheduled no-session execution -> sanitized completed Health run;
- exact run -> centralized incident processing -> one notification intent for a BROKEN result;
- repeated bridge call before scheduler finalization creates no duplicate run/incident/intent;
- returned healthRunId/healthState successfully finalize the existing scheduler row;
- replay after scheduler success remains duplicate-free.

The same PostgreSQL suite retains existing fail-closed missing/ambiguous authority coverage and persisted URL-origin privacy assertions.

## Limits

This is a DB/repository adapter only.

No live DB, deploy, Telegram send, store submission, package publication, production acceptance, or live migration was performed.
