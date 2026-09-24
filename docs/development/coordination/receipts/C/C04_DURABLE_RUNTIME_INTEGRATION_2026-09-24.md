# C04 durable no-session runtime integration — 2026-09-24

Status: CHECKPOINT / NOT_ACCEPTED / NOT_LIVE

Base accepted main before the C04 runtime/data selective chain:
`329ff29a27179f4f389b99d33268e709fc9c2b08`.

## Selective dependency chain

The full C04 review composition intentionally excludes unrelated B commercial,
subscription, N2, portal and 0050 tails. It contains only:

- `fdf5f1636ecacb310814aa73d651bccad088efcb` — source migration 0049 +
  no-session persistence authority;
- `2db449ab4906809aa221505a652ea43c3110dc21` — URL/privacy repair;
- `cba62aa7fb9ebf103443853b98a922c1d9aaf696` — scheduled completion adapter;
- `ff7e2483fc6ea37b025be64e77bd38e5c0fcf395` — post-persist
  incident/outbox reconciliation repair;
- C notification/runtime checkpoint originally reviewed as
  `22eadf4796c25d188f021c15d30f3b1d4afb405c`;
- C scheduler companion repair: reconcile committed persistence before claiming
  retryable work;
- this service-loop checkpoint.

No live migration was executed. Migration 0049 is source-only in this
checkpoint.

## Runtime topology

- `telegram-operator` remains the existing browser/no-session process.
- TG2 remains the single operator-control lane for LLM and Swagger.
- Forced `/llm_run` remains the bounded on-demand no-session probe.
- Scheduled LLM wakes dispatch the durable Health scheduler instead of running a
  second raw scheduled batch.
- A 60-second in-process wake only asks the durable scheduler for due/retry/
  recovery work; DB idempotency/single-flight decides whether anything runs.
- The existing monitoring-store LLM interval is the cadence authority for
  durable no-session schedules.
- Health safety cadence remains 1h..7d with the accepted default 6h.
- Telegram `/llm_interval` now explicitly enforces 1h..7d; Swagger keeps its
  existing 5m..30d range.
- Scheduled LLM summary notifications are suppressed except scheduler execution
  failure; durable incident/outbox notifications remain the semantic source.
- Notification delivery remains in the existing worker outbox consumer using
  the provisioned `TELEGRAM_BOT_TOKEN` plus exactly one
  `TELEGRAM_NOTIFICATION_CHAT_IDS` owner destination.

## Crash/restart invariant

Post-persist reconciliation processes the existing Health incident/outbox
authority before marking the scheduled run SUCCEEDED. If that processing fails,
the scheduled run stays recoverable. The scheduler also reconciles already
committed persistence before claiming retryable work after restart, preventing a
second browser probe for the same persisted result.

## Fresh C validation on the combined composition

Build/runtime resource job:
`0d31b4e4b0e64074b4d165b4813b2d5d`
- exit 0, OOM 0, peak 956301312 bytes, cleanup verified;
- `@product/telegram-operator`: 48/48 tests PASS, typecheck PASS, build PASS;
- `@product/health-runner`: 303/303 tests PASS, typecheck PASS;
- `@product/health`: 132/132 tests PASS.

Disposable PostgreSQL resource job:
`5ec7025166e34a61bbdc7d6287062a3d`
- exit 0, OOM 0, peak 709 MiB, cleanup verified;
- `@product/db` typecheck PASS;
- migrations 17/17 PASS;
- C04 no-session persistence 4/4 PASS;
- Health scheduler PostgreSQL 17/17 PASS;
- incident migration 2/2 PASS;
- incidents 7/7 PASS;
- admin read 2/2 PASS;
- canonical lineage 6/6 PASS;
- baseline PostgreSQL 3/3 PASS.

The suites were intentionally executed sequentially because each integration
file owns/reset the same disposable public schema; a prior parallel exploratory
run produced schema-reset collisions and is not evidence against the candidate.

## Acceptance boundary

This checkpoint is SOURCE/disposable-DB evidence only until C serially applies
the selective chain to `work/c-integration`, publishes that exact branch, and
gets all five required workflows green on the exact resulting HEAD.

This does NOT authorize:
- live 0049 migration;
- production deploy;
- live Telegram send;
- Opera store Submit;
- any 0050 work.
