# C04 post-persist reconciliation repair — B handoff

Date: 2026-09-24
Role: B
Status: SOURCE / disposable PostgreSQL PASS; NOT LIVE

## Assignment

C follow-up: 329ff29a27179f4f389b99d33268e709fc9c2b08
Accepted main base: bfe838ea8620b163883482c2cd7d046243f201a6
Prior B completion candidate: cba62aa7fb9ebf103443853b98a922c1d9aaf696
B branch parent before repair: 20c5f326ac15a7afc5fa068797138accd2b3e83a

## Finding and repair

The prior completion adapter covered the ordinary persist -> incident path, but a crash after the persisted Health run commit and before incident/outbox processing could be reconciled directly to scheduler SUCCEEDED.

The DB scheduler recovery path now detects persisted NO_SESSION Health results and runs the existing createHealthIncidentRepository(...).processCompletedHealthRun(healthRunId) authority before it may transition the scheduled run to SUCCEEDED.

If side-effect processing throws, the scheduled row is not transitioned and remains recoverable. A later retry reuses the same Health run; existing incident/outbox deduplication remains authoritative.
## Scope

Changed runtime/test paths:
- packages/server/db/src/health-scheduler-repository.ts
- packages/server/db/src/health-no-session-persistence.integration.test.ts
- this B receipt

No packages/server/health path, worker/runtime path, shared contract, package manifest, schema, or migration was changed.

The repository-neutral DurableHealthSchedulerRepository interface is unchanged. The DB factory gained only an optional internal incidentProcessor seam used for fail-closed integration testing.

## Recovery behavior proven

Disposable PostgreSQL acceptance explicitly simulates:
- BROKEN Health run persisted without normal completion adapter processing;
- zero incident/intent before reconciliation;
- reconciliation creates the incident/notification intent before scheduler SUCCEEDED;
- repeated reconciliation creates no duplicate Health run, incident, or intent;
- HEALTHY recovery resolves the existing incident and emits the expected recovery intent;
- UNKNOWN reconciliation succeeds without inventing incident/intent;
- injected incident processor failure leaves the scheduled row RUNNING with healthRunId unset;
- a later successful retry completes the same persisted run without duplicates.
## Evidence

Static:
- Node 24.20.0
- pnpm 10.34.5
- focused Prettier: PASS
- focused ESLint: PASS
- git diff --check: PASS
- @product/db typecheck: PASS
  - resource unit octoport-test-b-439bac210e214483aa266f5a2f3635c9.service
  - exit 0
  - peak 687 MiB
  - cleanup verified

Disposable PostgreSQL, sequential under one DB heavy slot:
- health-no-session-persistence.integration.test.ts: 4/4 PASS
- health-scheduler.integration.test.ts: 17/17 PASS
- resource unit octoport-test-b-ea545d6c6bf3494f9526c6de3cc704c6.service
- exit 0
- peak 558 MiB
- cleanup verified

One earlier combined parallel invocation was discarded because both integration files independently reset the public schema. A first focused test draft also attempted to mutate an intentionally immutable no-session observation and shared incident identity with an earlier case; the acceptance was corrected to use a separate published profile authority and dependency injection. These were test-harness issues, not accepted product evidence.

## Migration / live limits

No migration added. No 0050. No live0049.
No live DB, deployment, Telegram send, store action, or package publication was performed.

C should integrate the prior exact candidate cba62aa7fb9ebf103443853b98a922c1d9aaf696 and this follow-up repair commit in order, then apply its C-owned pre-claim reconciliation companion fix.
