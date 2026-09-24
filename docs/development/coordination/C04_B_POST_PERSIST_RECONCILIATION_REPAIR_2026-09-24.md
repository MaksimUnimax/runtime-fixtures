# C04 bounded B follow-up — post-persist incident reconciliation

Date: 2026-09-24
Assignment owner: C
Implementation owner: B, DB/repository boundary only
Base main: bfe838ea8620b163883482c2cd7d046243f201a6
Prior exact B completion candidate: cba62aa7fb9ebf103443853b98a922c1d9aaf696
Status: ASSIGNED / PRIOR CANDIDATE NOT YET ACCEPTED / NOT LIVE

## Finding

The prior completion candidate correctly composes the ordinary path:

`persistCompletedNoSessionHealthRun -> processCompletedHealthRun`

and repeated normal completion is idempotent.

There is still a crash boundary between those two operations.

If the process dies after the no-session `health_run` commits but before
`processCompletedHealthRun` commits, the existing
`createHealthSchedulerRepository(...).reconcilePersistedResults()` sees the
persisted `health_run` and can mark the scheduled run `SUCCEEDED`. It does
not prove that incident/outbox processing happened first.

That can permanently skip the incident/notification-intent side effect for the
persisted run. Normal replay-after-completion tests do not cover this crash
window.

## Required B repair

Keep the existing authorities and make recovery idempotently complete the
persisted Health side effects before a recoverable scheduled run becomes
`SUCCEEDED`.

Preferred behavior:

1. Identify a recoverable scheduled run that already has a linked persisted
   Health run.
2. Run the existing `processCompletedHealthRun(healthRunId)` authority for
   that exact run. It is already designed to be idempotent.
3. Only after that succeeds may reconciliation transition the scheduled run to
   `SUCCEEDED` and update schedule success metadata.
4. If incident/outbox processing fails, leave the scheduled run recoverable;
   do not report success and do not fabricate a second Health run.
5. Repeating recovery after process restart must not duplicate
   `health_runs`, `health_incidents`, or `health_notification_intents`.

No second incident model, outbox, scheduler, or persistence table is allowed.
A new migration is not expected; if B concludes one is required, stop that
specific migration and return the reason to C before allocating a number.

## C-owned companion fix

C will adjust the repository-neutral durable scheduler cycle so persisted-result
reconciliation runs before new claims as well as at the safe cycle boundary.
This prevents an expired/recoverable run with an already committed Health
result from launching a second browser probe before recovery.

B must not edit `packages/server/health/**` or C runtime paths for this task.

## Required evidence

Disposable PostgreSQL test must simulate the crash window explicitly:

1. Create/start a scheduled NO_SESSION run.
2. Persist its sanitized no-session Health run **without** calling the normal
   completion adapter / incident processor.
3. Verify no incident/intent exists yet for an incident-worthy result.
4. Invoke the repaired recovery path.
5. Verify the same scheduled run becomes `SUCCEEDED` only after the existing
   incident/outbox authority has processed that exact Health run.
6. Invoke recovery again and prove counts remain exactly one Health run, one
   incident, and the policy-expected single notification intent.
7. Cover UNKNOWN/no-op and HEALTHY/recovery behavior so recovery does not invent
   incidents.
8. `@product/db` typecheck and the existing health scheduler/no-session
   PostgreSQL suites remain green.

No live DB migration, deployment, Telegram send, or store action is authorized.

## Handoff back to C

Submit one exact bounded B candidate with `control.py B submit`. Include:
base main SHA, exact changed paths, focused/disposable PostgreSQL evidence,
migration status, and limitations.
