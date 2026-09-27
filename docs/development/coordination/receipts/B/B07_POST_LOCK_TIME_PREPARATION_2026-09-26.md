# B07 post-lock classification preparation — 2026-09-26

## Finding

The controller's deterministic repository/materializer reproduction confirms
that webhook activation classified a current subscription at its earlier
`receivedAt`. Reconciliation made the same mistake with caller-supplied
`processedAt`. If either transaction waited on the account lock across the
current period end, it could still reject a new paid period as
`CURRENT_SUBSCRIPTION_CONFLICT`.

## Change

Both repositories accept an optional deterministic `now` clock, defaulting to
the system clock. They sample it after the relevant transaction locks and use
that value for lifecycle classification and processing timestamps. The
materializer invokes the supplied clock after it locks the subscription row.
Webhook `receivedAt`/`verifiedAt`, webhook provider `occurredAt`,
reconciliation provider `statusAt`, and payment confirmation/period chronology
remain tied to their original event or snapshot times. No schema, worker
cadence, or client contract changed.

Integration coverage adds a PostgreSQL advisory-lock wait that is confirmed
through `pg_blocking_pids` before advancing the injected clock across expiry,
and a reconciliation case that verifies a delayed new period uses fresh
classification time while preserving provider period dates.

## Verification

Child did not launch PostgreSQL or integration tests. Parent should run on the
B disposable database through the resource supervisor (`control.py B heavy
--db --` followed by):

```sh
pnpm --dir /root/octoport-control/worktrees/B/resume-b07-postlock-time-20260926 exec vitest run --config tests/integration/server/vitest.config.ts tests/integration/server/p5-4-simulated-billing-events.integration.test.ts tests/integration/server/p5-5-reconciliation-lifecycle.integration.test.ts
```

The child could not run Prettier because this worktree has no installed
`node_modules/prettier`; dependency installation is outside the assignment.
This receipt is preparation evidence only, not PostgreSQL acceptance.

## Controller correction — 2026-09-27

The new reconciliation test incorrectly called `find` on QueryResult. Corrected both calls to `subscriptions.rows.find`. Full PostgreSQL acceptance remains pending. Existing fixtures also need a deliberate clock review: the new repository defaults to wall-clock time, while historical tests still pass fixed processedAt values and most repository constructors do not inject the fixture clock. Pin the relevant processing clock without weakening expected lifecycle/period assertions, then run both complete focused files. No database implementation was edited by the controller.

Run the supervisor from `/root/octoport-b-backend`, and use `pnpm --dir` for the exact child path above. Prepare frozen dependencies in that tree first. Do not run an unchanged parent copy and attribute its PASS to this diff. Controller used the already installed parent Prettier binary to format the two edited test files; no dependency installation was performed.
