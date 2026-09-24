# C04 bounded B assignment — no-session durable Health persistence

Date: 2026-09-24
Assignment owner: C
Implementation owner: B, DB/repository boundary only
Base main: 4ae52bb7d79ca02487cf70f9966dac5530c14e8f
Status: ASSIGNED / NOT ACCEPTED / NOT LIVE

## Why this assignment exists

C04 has an isolated C-owned notification/runtime checkpoint at child commit
`22eadf4796c25d188f021c15d30f3b1d4afb405c` (tree
`03e16e37564f160230fbb2021ff3409f9e996817`). It bootstraps the existing
no-session schedules and wires the existing durable Health notification outbox
to the already provisioned Telegram runtime contract. It deliberately does not
invent DB persistence identity.

The remaining gap is the scheduler execution -> completed Health run ->
incident/outbox persistence bridge. DB and migrations are B-owned.

## Ownership boundary

B may change only the minimum DB/repository/integration-test paths needed,
expected under:
- packages/server/db/src/health-*.ts
- packages/server/db/src/health-*.test.ts / *.integration.test.ts
- packages/server/db/src/index.ts only if export wiring is required
- packages/server/db/drizzle/** only if a forward migration is strictly required
- tests/integration/server/** only for DB-bound acceptance owned by B

B must NOT edit:
- packages/server/health/**
- apps/health-runner/**
- apps/worker/src/health-notification*
- C04 service-loop composition
- Telegram delivery/runtime code

C owns those consumers and will integrate the returned DB adapter.

## Existing contracts to reuse

- packages/server/health/src/scheduler.ts
- packages/server/health/src/no-session.ts
- packages/server/db/src/health-scheduler-repository.ts
- packages/server/db/src/health-persistence-repository.ts
- packages/server/db/src/health-incident-repository.ts

Do not create a second scheduler, run table, incident model, notification model,
or Telegram path.

## Required B result

Expose the smallest DB-backed adapter/repository capability that lets C take one
scheduled NO_SESSION execution and persist it as the ordinary completed Health
run already defined by the accepted schema, linked by scheduledRunId.

The result must:
1. deterministically resolve the existing P7 scope/profile/suite authority
   required by persistCompletedHealthRun for the no-session provider/surface;
2. fail closed when the mapping is absent or ambiguous;
3. persist the completed run through the existing Health persistence authority;
4. return the persisted healthRunId and state needed by scheduler finishSuccess;
5. allow the existing incident repository to process that exact run so incident
   and notification-intent creation stay centralized;
6. preserve restart/retry idempotence and avoid duplicate run/incident/intent;
7. persist only the already sanitized no-session projection — no DOM, URL
   path/query/fragment, cookies, sessions, credentials, Telegram destination,
   marketplace payload, or conversation contents.

If the current schema already carries enough deterministic authority, use it
without a migration. If not, B may add only the smallest forward migration
after collision review; no live migration is authorized.

## Required evidence

- focused repository/domain tests for deterministic resolution and fail-closed
  missing/ambiguous authority;
- disposable PostgreSQL acceptance:
  scheduled run -> sanitized no-session result -> completed Health run with
  scheduledRunId -> incident processing -> notification intent when policy
  requires;
- replay/restart proof with no duplicate run/incident/intent;
- negative persisted-privacy assertions;
- @product/db typecheck;
- migration smoke only if a migration is added.

## Handoff back to C

Submit one exact bounded B candidate with control.py B submit. State explicitly:
- base main SHA;
- exact changed paths;
- whether a migration exists;
- PostgreSQL/test evidence;
- limitations.

No live DB, deployment, Telegram send, or production acceptance is part of this
assignment.
