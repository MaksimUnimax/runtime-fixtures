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

- fresh migration/schema/idempotency after the final FK/delete-guard change: **3/3 PASS**, supervisor `octoport-test-b-a6caed95b1d842a7b3b6df0027069344.service`;
- final NO_SESSION persistence/retention/GC/no-replay matrix: **7/7 PASS**, supervisor `octoport-test-b-53255f34c3d240cca13595e044d42da5.service`;
- 0051 -> 0052 upgrade + receipt backfill + restart-idempotent compact projection: **1/1 PASS**, and durable scheduler regression: **17/17 PASS**, supervisor `octoport-test-b-8db00b3271734c31ac749e9cfa43490b.service`.

The 7/7 matrix proves concurrent identical saves coalesce, max-three ring, UNKNOWN/baseline separation, direct unsafe mutation rejection, persist-to-incident crash protection, incident and pending-notification pins, explicit raw payload GC, exact late callback replay from receipt, duplicate callback vs prune, duplicate callback vs receipt retirement, retire-vs-materialize serialization, old-revision no-replay, higher-revision admission, persisted-terminal recovery protection and SEND_UNCERTAIN no-replay after terminal metadata retirement.

A read-only exact review of source commit `8ca5ac2a61d92ed5c29051bf01f1f8ad0e3546ef` with pinned `gpt-6-luna` found one HIGH: direct SQL could delete `health_scheduled_runs` after payload GC while its replay receipt still existed. The follow-up closes this with `health_no_session_run_receipts.scheduled_run_id -> health_scheduled_runs.id ON DELETE RESTRICT` plus a DB `BEFORE DELETE` guard on scheduler rows requiring a covering watermark and absence of persisted payload/replay authority. The final 7/7 matrix proves direct scheduler DELETE fails both while a pruned receipt exists and for terminal `SEND_UNCERTAIN` before watermark retirement.

Final local quality supervisor `octoport-test-b-2fe8d81d20da43128fd0e7ca5f21ade0.service`:

- DB unit: **31/31 PASS**;
- DB typecheck PASS;
- targeted ESLint PASS;
- targeted Prettier PASS for TS/JSON;
- `git diff --check` PASS;
- exit 0, OOM 0, cleanup verified.

Earlier discarded integration attempts are not acceptance evidence: one ran schema-resetting PostgreSQL files concurrently on one disposable DB and failed from test-schema races; one higher-revision cleanup used a retirement timestamp older than the existing watermark and was correctly rejected as non-monotonic; another crash-recovery assertion reused an existing incident scope and therefore correctly received `IGNORED` instead of `OPENED`. The fixtures were corrected without weakening production guards, and the final sequential matrix passed 7/7.

## Handoff / limitations

No automatic GC loop is enabled here. No live row was deleted.

C must integrate the exact candidate, run the legacy compact-projection backfill after migration, inspect dry-run inventory, and only then wire bounded cleanup under accepted rollout policy. Cutoff age remains a caller policy; B deliberately does not invent a shorter TTL than the scheduler/reconciliation/late-callback contract.

This candidate prunes only routine NO_SESSION payload. Baseline contour runs, authenticated H3, H4/H5 evaluations, incident/notification evidence and future operator/release approval evidence are not cleanup targets.

Durable exact-candidate operator approval/admission is the next B task after C publishes the owning contract/path boundary.
