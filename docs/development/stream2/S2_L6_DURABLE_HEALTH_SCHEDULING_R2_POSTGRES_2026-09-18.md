# S2-L6 durable Health scheduling — R2 PostgreSQL acceptance closure

Work ID: `S2_L6_DURABLE_HEALTH_SCHEDULER_POSTGRES_ACCEPTANCE_2026-09-18_R2`

Verdict: `IMPLEMENTED_CANDIDATE` — architect acceptance remains external.

## A. Preflight

- R1 candidate: `1b7127f880067e9b6cf2efa026f19c72027cad85`.
- R1 tree: `71c18f09b42b39a1ff09e1c60960938009a8ffa9`.
- R1 parent: `f24f3d496eadc352ecf3d42442a2e3a591fc98a0`.
- Accepted L5B ancestor: `da779208e4897932f3ec2827f16ba8c726be38f3`.
- Accepted L5A ancestor: `c289534c94063ab72d812e48506668ad008f0cfd`.
- `origin/main`: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`.
- `origin/integration/i1-c1-srv5-2026-09-16`: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- PR #9 head: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`; merge ref: `ccd6fd504f8e1d572e3e2c7eefce33884186e9f2`.
- Toolchain: Node `v24.20.0`, pnpm `10.34.5`; `pnpm install --frozen-lockfile` passed.
- Docker Engine `29.1.3` was available. The Docker Compose subcommand was absent.
- PostgreSQL: repository image `postgres:18.0`, verified live as PostgreSQL `18.0`.
- DB URL class: repository-local disposable development PostgreSQL at loopback port `55432`, database `product_control_plane`; no shared, preprod, owner, or production database was used.

The R1 diff was reviewed in full. The correction remains on the R1 worktree and does not modify Stream-1 product runtime paths.

## B. Database startup

The prescribed `docker compose -f infra/local/docker-compose.yml up -d` command was attempted and failed because this host has no Compose plugin (`docker: unknown command: docker compose`). The repository-provided `postgres:18.0` image and exact Compose settings were then started through Docker CLI in a uniquely named disposable container and volume:

`s2l6-r2-postgres-20260918` — healthy, `127.0.0.1:55432 -> 5432`.

The complete migration chain was applied to the clean volume, then the migration runner was executed a second time. Both passes succeeded. Integration suites also reset only the disposable database schema where required; no unrelated volume or user data was deleted.

## C. Migration review

The scheduler migration is now `packages/server/db/drizzle/0019_s2_l6_durable_health_scheduler.sql`.

An active Stream-1 worktree contains `0017_i1_c3e_sync_journal.sql` and `0018_d3s2_credential_transfer_foundation.sql`. The R1 `0017_s2_l6...` name therefore had a real parallel-stream collision. It was not overwritten; the migration was history-preservingly advanced to `0019`, and the Drizzle journal tag was updated.

The migration is additive: safe scheduler enums, nullable `health_runs.scheduled_run_id`, a unique nullable link, `health_schedules`, and `health_scheduled_runs`. Schedule and Health-run foreign keys use `RESTRICT`; due-slot, idempotency-key, and Health-run uniqueness are database-enforced; claim, schedule, and due indexes are present. Existing Health rows remain valid because the new link is nullable. No destructive rewrite is present.

Existing Health persistence and representative pre-scheduler rows survived migration and the Health PostgreSQL suite passed `22/22`. Migration installation and idempotency passed in the database suite and in the scheduler suite.

## D. PostgreSQL concurrency

The focused PostgreSQL scheduler suite uses three independent `pg` pools and transaction contexts, not sequential calls in one transaction. It passed `17/17`.

- Duplicate due slot: exactly one logical row under two simultaneous materializers.
- Concurrent claim: exactly one worker receives the pending run lease.
- `SKIP LOCKED`: while one connection holds the first due row, another connection claims a distinct run without global blocking.
- Expired lease reclaim: owner B becomes current authority after owner A expiry.
- Stale finalization: owner A receives `HEALTH_SCHEDULED_RUN_STALE_OWNER` and cannot overwrite B.
- Success finalization: current owner persists terminal `SUCCEEDED`; subsequent claim returns no run.

## E. Crash and recovery

- Crash after claim: lease expiry reclaimed the run with attempt increment from 1 to 2.
- Crash after Health result commit: one committed `health_runs` row linked by the exact scheduled run was reconciled to `SUCCEEDED`; no second Health row was created.
- Stale owner after recovery: old owner finalization was rejected.
- Timeout recovery: stale `RUNNING` transitioned to `TIMED_OUT`, released ownership, and became boundedly reclaimable.

## F. Retry and schedule policy

- Retryable environment failure: `FAILED_RETRYABLE`, deterministic five-minute next attempt, one logical due row.
- Terminal configuration failure: `FAILED_TERMINAL`, no later claim.
- Timeout: bounded `TIMED_OUT` transition and reclaim; no zombie lease.
- Disabled schedule: no due materialization.
- Re-enable: one current slot, no unlimited historical replay.
- Long downtime: one bounded catch-up slot, next due at the current interval boundary.
- Revision: historical run retains revision 1; new due identity uses revision 2 and a different idempotency key.
- On-demand isolation: no scheduled due-slot row is consumed or mutated.

## G. Health semantics and safety boundaries

Execution success is separate from Health classification. Real PostgreSQL tests persisted `BROKEN` and `MAINTENANCE` Health results and finalized both scheduler executions as `SUCCEEDED`.

All nine accepted NO_SESSION targets materialized without any authenticated-session lookup: ChatGPT Standard, ChatGPT Work, Alice, DeepSeek, Grok, Claude, Gemini, Qwen, and Kimi. Authenticated deep schedules remain absent/dormant.

`SEND_UNCERTAIN` is now terminal even if a lower layer labels the failure transient. This prevents blind scheduler re-execution after an external Send may have occurred. Deterministic unit and PostgreSQL tests cover the prohibition. Real Send count: `0`.

No incident, notification, admin UI, live provider, or S2-L7 work was started.

## H. Validation

Failure-batch rule was followed. Before correction, the complete integration batch was `1,546/1,550` passing with four existing migration-count assertions expecting 17 after candidate migration 0017. They were classified as integration-test expectation defects and updated to the accepted 18-entry chain. The migration collision and SEND_UNCERTAIN retry gap were classified as scheduler/migration correction items.

Final gates on the corrected tree:

- Focused PostgreSQL scheduler: `17/17`.
- Full `pnpm test:integration`: `41` files, `1,564/1,564`.
- DB unit suite: `12/12`.
- Health domain: `67/67`.
- Health-runner: `302/302`.
- Existing L5A no-session regression: `66/66` within the full Health-runner run.
- Accepted L5B slice: prior R1 `87/87` retained; full Health-runner regression rerun `302/302`.
- Recursive typecheck: `34/34` participating projects; the 35th workspace has no typecheck script.
- Health-runner, API, and worker builds: PASS.
- Lint and bridge guard: PASS.
- Format check: PASS.
- Docs check: PASS.
- `git diff --check`: PASS.

## I. Privacy

Scheduler code, migration, fixtures, and live table columns were reviewed. Persistence contains opaque schedule/run/owner/lease identifiers, timing, state, failure classification, and safe Health classification/linkage only. No cookies, storage state, passwords, tokens, Authorization headers, OTPs, private conversation IDs, private assistant contents, or seller payloads are stored.

## J. Stream-1 boundary

No Stream-1 product runtime was changed. The only overlap is migration numbering: active Stream-1 work owns 0017 and 0018, so S2-L6 uses 0019. This is recorded as `PARALLEL_STREAM_DEPENDENCY` at the migration boundary, resolved locally by forward numbering; it is not a scheduler runtime blocker.

## K. Git

The correction is prepared as a normal R2 commit from the R1 candidate worktree. No force push, destructive rebase, main merge, or PR #9 mutation is permitted. Remote publication/readback is attempted separately; if credentials are unavailable it remains `ENVIRONMENT_DEFERRED`.

## L. Deferred ledger

- `ENVIRONMENT_DEFERRED`: Stream-2 remote publication credentials, if normal push/readback is unavailable.
- `ENVIRONMENT_DEFERRED`: no provisioned technical LLM sessions for later authenticated live probes.
- `ENVIRONMENT_DEFERRED`: Ozon/Wildberries A1 public-document protection.

PostgreSQL is not deferred: the repository-local disposable Docker path was executed successfully.

## M. Verdict

`IMPLEMENTED_CANDIDATE`.

## N. S2-L6 scheduler foundation readiness

Is the durable scheduler/run-ownership foundation ready for architect acceptance? **YES.**

There is no remaining scheduler correctness blocker in this bounded task. The migration boundary must be integrated with the active Stream-1 migration line at 0019.

## O. Next

After architect acceptance, the next bounded S2-L6 step may define incident deduplication and recovery transitions consuming the durable scheduled-run output. Do not add notification providers or admin UI in that step.
