# B18 — bounded monitoring retention and no-replay foundation — 2026-09-28

Status: **SOURCE + DISPOSABLE POSTGRESQL CANDIDATE — NOT LIVE / NOT DEPLOYED / NO LIVE DELETION**

Task: `B_MONITOR_RETENTION_AND_RELEASE_ADMISSION`.
Architecture authority: `15ca964e56dba9230f520e67a919d5b1136bb847`.

## Scope

This candidate implements the B-owned storage half of bounded monitoring retention. It does not change `packages/server/health/**`, shared contracts, live databases, Docker volumes, provider/browser execution, store publication or authenticated H3 enablement.

New migration: `0052_monitoring_bounded_retention.sql`.

The migration is additive over 0051 and does not edit applied 0049.
## Bounded model

Routine NO_SESSION state is separated into:

- one `health_no_session_scope_states` row per stable compatibility scope;
- at most three `health_no_session_recent_states` rows per scope;
- identical normalized results coalesce into `repeat_count` + first/last seen timestamps;
- `latest_*`, `last_attempt_at` and `last_verified_at` remain separate from nullable accepted-baseline fields;
- UNKNOWN can become the latest observation but never mutates accepted baseline fields.

The retention scope excludes browser patch version. It binds provider, surface, target, strategy + strategy revision, browser family and resolved profile revision identity.

Compact normalized result excludes volatile observation timestamps and evidence IDs, while retaining bounded navigation/surface/contour/readiness/browser-mode metadata.
## Durable replay receipts and finite metadata

Each completed NO_SESSION run receives a skinny immutable/monotonic `health_no_session_run_receipts` row containing exact scheduled-run identity, exact callback result SHA-256, original run identity and authority references.

Existing 0051 NO_SESSION runs are backfilled into receipts by migration. `backfillNoSessionCompactProjection()` deterministically projects legacy payloads into the bounded state/ring and is restart-idempotent.

After the explicit late-callback/reconciliation cutoff:

1. eligible routine raw payload may be pruned;
2. the skinny receipt and SUCCEEDED scheduler row remain for late callback idempotency;
3. after a later metadata cutoff, a monotonic `health_schedule_retention_watermarks` row is advanced before receipt/scheduler deletion;
4. retired exact `(schedule, revision, due_slot)` can never materialize again;
5. a higher schedule revision is not blocked by the prior watermark.

Watermarks are one row per stable schedule, not an archive of every attempt.
## Fail-closed GC

`listRoutineNoSessionGcInventory()` is the dry-run inventory. It reports exact reasons including projection missing, scheduler mismatch, incident/notification pin, accepted-baseline pin and recent-state pin.

`pruneRoutineNoSessionPayload()` only deletes raw routine NO_SESSION payload when:

- compact projection exists;
- scheduled run is SUCCEEDED;
- no active/historical incident row references the run;
- no notification intent references it;
- it is not accepted baseline;
- it is not latest state or a current recent-ring representative.

Delete guards remain immutable for ordinary SQL. Migration triggers validate the GC predicate at DB level.
Receipt retirement and terminal scheduler retirement first acquire the stable schedule lock, then advance a monotonic watermark. The watermark trigger itself accepts only:

- a pruned SUCCEEDED NO_SESSION receipt with no remaining `health_runs` payload; or
- FAILED_TERMINAL/CANCELLED work with no retry, receipt or persisted result.

This preserves B16 recovery: a terminal scheduler row with a committed `health_runs.scheduled_run_id` result is `PERSISTED_RESULT_PRESENT` and cannot be retired.

SEND_UNCERTAIN with no persisted result can be retired after cutoff, but resetting `next_due_at` to the retired slot still materializes nothing because the watermark survives.
## Evidence

Pinned toolchain: Node 24.20.0 / pnpm 10.34.5.

Final disposable PostgreSQL evidence:

One final sequential disposable-PostgreSQL supervisor `octoport-test-b-a304672938c145ac9e5dd689144c5544.service` proves the final migration/guard set end to end:

- fresh migration/schema/idempotency: **3/3 PASS**;
- NO_SESSION persistence/retention/GC/no-replay matrix: **7/7 PASS**;
- 0051 -> 0052 upgrade + receipt backfill + restart-idempotent compact projection: **1/1 PASS**;
- durable scheduler regression: **17/17 PASS**;
- exit 0, cleanup verified.

The 7/7 matrix proves concurrent identical saves coalesce, max-three ring, UNKNOWN/baseline separation, direct unsafe mutation rejection, persist-to-incident crash protection, incident and pending-notification pins, explicit raw payload GC, exact late callback replay from receipt, duplicate callback vs prune, duplicate callback vs receipt retirement, retire-vs-materialize serialization, old-revision no-replay, higher-revision admission, persisted-terminal recovery protection and SEND_UNCERTAIN no-replay after terminal metadata retirement.

A read-only exact review of source commit `8ca5ac2a61d92ed5c29051bf01f1f8ad0e3546ef` with pinned `gpt-6-luna` found one HIGH: direct SQL could delete `health_scheduled_runs` after payload GC while its replay receipt still existed. The follow-up closed direct deletion with `health_no_session_run_receipts.scheduled_run_id -> health_scheduled_runs.id ON DELETE RESTRICT` plus a DB `BEFORE DELETE` guard on scheduler rows requiring a covering watermark and absence of persisted payload/replay authority.

A second read-only exact review of follow-up commit `3ed0cab5ba48ee50563752dbbb19878edd78804d` confirmed the delete HIGH was closed but found another HIGH: direct SQL could mutate scheduler identity (`schedule_id`/revision/due slot/target identity), free the old unique tuple, then rematerialize it before retirement. The final follow-up adds a DB `BEFORE UPDATE` identity guard that freezes scheduler identity while leaving lifecycle/lease/result fields mutable. The 7/7 matrix now proves direct scheduler DELETE and direct identity UPDATE both fail for receipt-backed rows and terminal `SEND_UNCERTAIN`, while higher legitimate schedule revisions remain materializable.

Final local quality supervisor `octoport-test-b-ce0234e59dc1484dac4d525f7a0b48f9.service`:

- DB unit: **31/31 PASS**;
- DB typecheck PASS;
- targeted ESLint PASS;
- targeted Prettier PASS for TS/JSON;
- `git diff --check` PASS;
- exit 0, OOM 0, cleanup verified.

Earlier discarded integration attempts are not acceptance evidence: one ran schema-resetting PostgreSQL files concurrently on one disposable DB and failed from test-schema races; one higher-revision cleanup used a retirement timestamp older than the existing watermark and was correctly rejected as non-monotonic; another crash-recovery assertion reused an existing incident scope and therefore correctly received `IGNORED` instead of `OPENED`. The fixtures were corrected without weakening production guards, and the final sequential matrix passed 7/7.

## Handoff / limitations

No automatic GC loop is enabled here. No live row was deleted.

C must integrate the exact candidate, run legacy compact-projection plus silent incident reconciliation after migration, inspect the keyset dry-run inventory, and only then wire bounded cleanup under accepted rollout policy. The repository enforces a minimum eight-day cleanup age from trusted server time; rollout policy may choose a longer retention period but cannot choose a shorter one.

This candidate prunes only routine NO_SESSION payload. Baseline contour runs, authenticated H3, H4/H5 evaluations, incident/notification evidence and future operator/release approval evidence are not cleanup targets.

Durable exact-candidate operator approval/admission is the next B task after C publishes the owning contract/path boundary.


## Legacy activation follow-up

Controller review of exact `400c713c08a6ecfc7be8f531447c5e0cdfe804bf` found one rollout gap for the already-existing NO_SESSION history: migration 0052 could backfill receipts and compact projection, but legacy scheduler rows were already `SUCCEEDED`, so ordinary scheduler reconciliation would never set their `incident_processed_at` marker. Those rows would remain permanently `INCIDENT_PROCESSING_PENDING` and could not become GC-eligible.

The follow-up keeps 0052 additive and does **not** rerun any provider/browser action.

- `reconcileLegacyNoSessionIncidentProcessing()` pages only already-persisted, already-projected, `SUCCEEDED` NO_SESSION rows whose marker is still null.
- It reuses the existing incident state-machine with notification emission disabled for historical catch-up. Incident OPEN/UPDATE/RESOLVE semantics stay the same; historical catch-up creates no Telegram/outbox notification intents and never calls a provider/browser executor.
- `incident_processed_at` is written only after the incident transaction succeeds. A crash after incident mutation but before the marker is safe to retry: the same incident state-machine is replayed idempotently, then the marker is set.
- The normal completion adapter is unchanged in behavior: new completions still process incidents with ordinary notification behavior and only then set the marker.

### Finite cutoff and complete scan

The repository now owns the cleanup clock. Cleanup callers no longer pass a `now` value.

`NO_SESSION_RETENTION_MIN_AGE_MS` is fixed at **8 days**. The accepted scheduler contract permits at most eight attempts, one-hour attempt timeout and bounded retry delays up to 24 hours; eight days is a conservative lower bound beyond that retry/reconciliation window. Repository construction may inject a clock for tests; production uses server time. Inventory, raw-payload prune, receipt retirement and terminal scheduler retirement all reject a cutoff younger than this minimum.

Exact-slot no-replay remains durable beyond metadata deletion through the monotonic schedule watermark.

`listRoutineNoSessionGcInventory()` now supports keyset pagination by `(completed_at, run_id)`, so permanently pinned oldest rows cannot prevent scanning later eligible rows.

### Upgrade / legacy acceptance

Final sequential disposable PostgreSQL supervisor `octoport-test-b-13e3026f0add4f9eaeb24beb78d94342.service`:

- fresh migration/schema/idempotency: **3/3 PASS**;
- real 0051 -> 0052 upgrade: **2/2 PASS**;
- current NO_SESSION persistence/retention/no-replay: **7/7 PASS**;
- scheduler regression: **17/17 PASS**;
- exit 0, peak 567 MiB, cleanup verified.

The second upgrade scenario seeds four real 0051 `SUCCEEDED` rows in one scope: two identical HEALTHY observations, a BROKEN boundary and a newer HEALTHY recovery. It proves:

- migration backfills all four receipts with incident markers still null;
- projection is restart-idempotent and coalesces identical routine state;
- a forced crash after BROKEN incident mutation but before marker leaves one incident, no notification intent and a null marker;
- a fresh repository retries successfully, resolves that same incident with the newer HEALTHY row, leaves exactly one resolved incident and **zero historical notification intents**, and a further retry is a no-op;
- accepted baseline remains pinned;
- keyset page 1 can be pinned while page 2 reaches an eligible older repeated HEALTHY row;
- a cutoff shorter than eight days is rejected by repository policy;
- the eligible legacy raw run/observation is actually pruned while its replay receipt remains.

Local quality supervisor `octoport-test-b-36fc0dab0e3346cea9e0935d5acc7a4a.service`:
- DB unit **31/31 PASS**;
- targeted ESLint PASS;
- targeted Prettier PASS;
- `git diff --check` PASS;
- exit 0, peak 598 MiB, cleanup verified.

Pinned dependency/typecheck supervisor `octoport-test-b-e825bc6616214e53912c3e915a99588e.service`:
- frozen workspace dependency state already synchronized;
- DB typecheck PASS;
- targeted Prettier PASS;
- `git diff --check` PASS;
- exit 0, cleanup verified.

No live database, Docker volume, provider/browser execution or notification delivery was performed by this follow-up.


### Final follow-up review and acceptance

Pinned `gpt-6-luna` read-only review of the legacy-activation diff found one MEDIUM: the first draft exposed a `legacyIncidentProcessor` repository option, which could have been populated with the ordinary notification-emitting incident repository. That test seam was removed.

The accepted follow-up always constructs the historical processor internally with `emitNotifications: false`. The crash regression now injects failure only at the DB-runtime marker write, after the real incident transaction commits. It cannot substitute notification behavior.

The same review confirmed:
- legacy incident ordering uses existing `(completedAt, runId)` guards, so an older replay cannot resolve or reopen a newer observation;
- keyset parameter ordering is consistent;
- the eight-day bound covers the scheduler retry/timeout envelope;
- the normal completion adapter retains ordinary notification behavior;
- no new lock-order or pruned-payload replay path was found.

Final all-in-one acceptance supervisor `octoport-test-b-3caedbcbe218476a8165d1bcef0081e4.service` completed exit 0, peak 720 MiB, OOM 0, cleanup verified. The sequential command required every stage to succeed:
- fresh PostgreSQL **3/3**;
- 0051 -> 0052 upgrade/legacy activation **2/2**;
- NO_SESSION retention/no-replay **7/7**;
- durable scheduler **17/17**;
- DB unit **31/31**;
- DB typecheck PASS;
- targeted ESLint PASS;
- targeted Prettier PASS;
- `git diff --check` PASS.
