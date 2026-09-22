# S2-TG2 independent Telegram monitoring schedules

Work ID: `S2-TG2-2026-09-22-INDEPENDENT-SCHEDULES-AND-FORCED-RUNS`

This bounded implementation adds a durable operator-control layer for two
independent monitoring lanes:

- `LLM`, default 90 minutes, using the accepted no-session monitoring batch;
- `SWAGGER_API`, default 6 hours, returning a bounded source-unavailable
  result while S2-A1 first-party authority remains partial.

The lane state is persisted by migration `0023_s2_tg2_monitoring_lanes` and
uses an atomic active-run lease. Scheduled and forced starts share the same
single-flight lock; forced runs do not change the configured interval. Interval
updates affect only their named lane and do not cancel an active run.

Telegram commands and callbacks are lane-specific:

```text
/llm_status       /llm_run       /llm_interval <5m..30d>
/swagger_status   /swagger_run   /swagger_interval <5m..30d>
```

Operator authorization is numeric-ID based. Callback buttons use the same
command semantics as text commands. Telegram polling errors are bounded and
do not stop the scheduler. Notifications contain only lane, run identity,
bounded result code, and safe summary; provider bodies and bot tokens are not
persisted or emitted.

Focused evidence from this worktree:

- `@product/monitoring-control`: 8/8 tests passed;
- `@product/telegram-operator`: 4/4 tests passed;
- `@product/health`: 131/131 tests passed;
- `@product/db` unit suite: 12/12 tests passed;
- TG2 package typechecks and ESLint passed;
- Telegram operator build passed with Node 24;
- bridge-boundary guard and docs check passed;
- `git diff --check` passed.

The referenced TG1 commit `af4ccd4035e4cd110cd411aeee2016c280fb41e4` was not
present in the available repository object database. This implementation
therefore preserves the described TG1 boundaries while adding the TG2 control
semantics required by the current task; it does not claim a TG1 receipt.
