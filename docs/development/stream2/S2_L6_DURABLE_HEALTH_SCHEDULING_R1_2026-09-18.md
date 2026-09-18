# S2-L6 Durable Health Scheduling R1

Status: implementation candidate pending architect review. This bounded slice
owns durable Health schedule/run execution state only. It does not start the
incident lifecycle, notification providers, UI, S2-L7, api-watch, or any
Stream-1 product runtime path.

## Preflight and authority

- Starting accepted commit: `da779208e4897932f3ec2827f16ba8c726be38f3`
- Starting tree: `bfa04d375a03e018138b5774b8db78017fc2c1b6`
- Starting parent: `b02591fb8a3813db0b9afdb6053dedfa48aae5cf`
- Accepted L5A ancestor: `c289534c94063ab72d812e48506668ad008f0cfd`
- Remote `origin/main` at preflight: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`
- Remote integration at preflight: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`
- Toolchain used: Node `v24.20.0`, pnpm `10.34.5`.

The working checkout was a clean worktree created from the accepted local L5B
lineage. An unrelated dirty checkout was left untouched. No remote API
acquisition was repeated.

## Existing authority audit

| Area | Finding | R1 decision |
| --- | --- | --- |
| Durable schedule | Not present | ADD dedicated Health schedules |
| Completed Health run | `health_runs` plus immutable contour/evidence rows already present | KEEP and link from scheduled runs |
| Lease/ownership | No Health lease model | ADD compare-and-set lease token |
| Retry state | Runner operation retries only; no durable scheduled retry | ADD bounded durable retry state |
| Incidents | Minimal `health_incidents` physical table already present, with no lifecycle behavior | KEEP; emit normalized run boundary only |
| Long-lived process dependency | No durable scheduler existed | ADD wake/claim/execute/persist core that tolerates process death |

The existing `health_incidents` table is not duplicated or changed. Existing
completed Health persistence remains the authority for classification and safe
evidence references.

## Architecture

`durable schedule -> transactional due-slot materialization -> lease claim ->
RUNNING -> bounded execution -> completed Health result link -> next wake`

The scheduler core is in `packages/server/health/src/scheduler.ts` and is
repository-neutral. A process may wake, materialize due work, claim a bounded
batch, execute it, persist state, and exit. No `setInterval`, Work heartbeat,
product Start/Resume, bridge scheduler, provider replay, or authenticated
session is required.

The runner exports `createNoSessionHealthSchedules()`. It creates one enabled
`NO_SESSION` schedule for each of the nine accepted surfaces (eight provider
families, with ChatGPT Standard and Work as separate surfaces). It does not
look up or require an authenticated technical session. `AUTHENTICATED_DEEP` is
represented as a disabled-capability enum only; R1 creates no such schedules.

## Schedule model and policy

`health_schedules` stores:

- stable schedule id, monitor target, provider, surface, and probe layer;
- enabled flag;
- JSON cadence policy (`intervalSeconds`, `timeoutSeconds`, `maxAttempts`,
  `retryPolicyVersion`);
- next due, last attempt, last success, revision, and timestamps.

Cadence validation requires a minimum one-hour interval and a maximum seven-day
interval. The explicit first policy for no-session targets is six hours,
180-second total execution timeout, three attempts, and `health-retry-v1`.
This is reversible configuration, not provider behavior or hidden global magic.

## Due-slot idempotency

The logical key is SHA-256 of:

`scheduleId | scheduleRevision | dueSlotAt UTC | monitorTarget`

PostgreSQL enforces both the composite due-slot uniqueness and the unique
derived idempotency key. Materialization locks the schedule row, inserts at
most one `PENDING` run, and advances `next_due_at` in the same transaction.
Two simultaneous wakeups therefore cannot create two logical scheduled runs.
Downtime produces one current catch-up slot and advances directly to a fresh
future interval; it never replays every missed interval.

On-demand execution remains outside this authority: it uses the same execution
engine contract but does not call due-slot materialization and has no scheduled
idempotency key.

## Run state, lease, and recovery

`health_scheduled_runs` stores the schedule snapshot/revision, due slot,
execution state, attempt, owner, opaque lease id, claim/start/finish times,
lease expiry, timeout deadline, retry time, failure class/code, and optional
completed Health run/classification link.

Valid transitions are explicit and fail closed:

- `PENDING -> CLAIMED`
- `CLAIMED -> RUNNING`
- `RUNNING -> SUCCEEDED | FAILED_RETRYABLE | FAILED_TERMINAL | TIMED_OUT`
- retryable/timeout work may be reclaimed into `CLAIMED` while attempts remain
- terminal and successful states cannot be reclaimed

Claim uses a database transaction with `FOR UPDATE SKIP LOCKED`, an owner id,
an opaque lease UUID, and an expiry. Every finalization is a compare-and-set
against run id, owner id, lease id, state, and live lease. A stale owner cannot
write after a newer worker reclaims the run.

The existing completed Health persistence accepts an optional
`scheduledRunId`. This creates the result link in the same transaction as the
immutable Health run/contour/evidence rows. A recovery reconciliation finds a
committed linked result if the process died after result commit but before
scheduler finalization, then closes the scheduled run as `SUCCEEDED` and
updates the schedule success timestamp.

## Timeout and retry

At `RUNNING`, timeout authority is read from the schedule cadence and persisted
as `timeout_at`. The scheduler wraps the execution promise with that deadline;
the repository also closes expired leases and bounded timeout retries after
process death. Provider/browser operation timeouts remain lower-level concerns.

Retry classes are bounded and differentiated:

- `TRANSIENT_ENVIRONMENT`: five minutes base;
- `PROVIDER_ACCESS_OR_NETWORK`: fifteen minutes base;
- `BROWSER_UNAVAILABLE`: ten minutes base;
- `TERMINAL_CONFIGURATION`: terminal, no retry;
- `PROVEN_PRODUCT_DRIFT`: terminal, no tight retry loop;
- `MAINTENANCE`: hourly retry policy when the executor treats maintenance as
  an execution failure.

Backoff doubles by attempt and caps at 24 hours. There is no busy polling or
unbounded exponential growth. A Health result of `BROKEN`, `DRIFT`,
`DEGRADED`, `UNKNOWN`, or `MAINTENANCE` can still be an execution `SUCCEEDED`;
classification is persisted separately from scheduler state.

## Revision and maintenance behavior

Schedule policy/target changes increment `revision` and replace only the
current schedule definition. Existing scheduled runs retain their historical
revision and idempotency identity. Re-enable requires an explicit `nextDueAt`,
so it does not replay an unlimited backlog. Disabled schedules never
materialize a new run. Maintenance is represented by the existing Health
classification vocabulary; this R1 does not invent a second maintenance
authority or incident lifecycle.

## Evidence and incident handoff

Scheduled runs point to the existing immutable Health run. The Health run points
to validated contour results and safe evidence reference metadata. R1 copies no
raw DOM, screenshots, cookies, storage state, auth headers, passwords, OTPs,
private conversation ids, private response contents, or seller data into
schedule rows. The existing `health_incidents` table remains a future consumer
boundary; no notification or incident deduplication behavior is implemented.

## Migration and Stream-1 boundary

Migration `0017_s2_l6_durable_health_scheduler.sql` is additive. It adds the
probe/state/failure enums, the two Health scheduler tables, a nullable
`health_runs.scheduled_run_id` link, uniqueness/indexes, and validation checks.
Existing immutable Health rows are preserved. No Stream-1 migration was
overwritten and no parallel dependency was found.

Files changed are limited to:

- `packages/server/health/src/scheduler.ts` and its tests;
- `packages/server/db/src/health-scheduler-repository.ts`;
- `packages/server/db/src/health-persistence-repository.ts`;
- `packages/server/db/src/schema/health.ts`, schema exports, and migration
  journal/SQL;
- `apps/health-runner/src/scheduler-targets.ts` and its tests;
- Health-specific PostgreSQL integration coverage;
- this document.

## Validation and deferred items

Focused Health scheduler tests cover deterministic identity, duplicate race
prevention, expired lease recovery, stale-owner rejection, crash-after-claim,
crash-after-result reconciliation, retry classes, terminal configuration,
BROKEN/MAINTENANCE classification separation, timeout closure, disabled and
re-enabled semantics, bounded catch-up, revision identity, cross-target
isolation, no-session schedule independence, and on-demand identity isolation.

The real PostgreSQL scheduler integration suite covers concurrent materialize,
lease claim/reclaim/stale-owner rejection, migration-backed revision and
disabled behavior. It requires `DATABASE_URL`; if unavailable, persistence
concurrency is `ENVIRONMENT_DEFERRED`, not accepted from mocks.

Known deferred ledger:

- `ENVIRONMENT_DEFERRED`: Stream-2 publication credentials;
- `ENVIRONMENT_DEFERRED`: no provisioned technical LLM sessions for future
  authenticated live validation;
- `ENVIRONMENT_DEFERRED`: external Ozon/Wildberries public documentation
  protection for A1;
- `ENVIRONMENT_DEFERRED`: PostgreSQL integration if `DATABASE_URL` remains
  unavailable in the validation environment.

Not part of R1: full incident lifecycle/deduplication, notification delivery,
admin UI, durable raw artifact storage, cloud wake/deployment wiring, or
authenticated deep schedules.
