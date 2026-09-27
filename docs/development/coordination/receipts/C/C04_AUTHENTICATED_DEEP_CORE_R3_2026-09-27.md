# C04 Authenticated Deep Scheduler Core R3

Base: `a1c6f232fc24f102882cf742f5d1304c5008dbc4`.

Status: **SOURCE CORE PREPARED / NOT DEPLOYED / NOT LIVE / NOT YET PRODUCTION-COMPOSED**

## Source boundary

C adds a pure authenticated-deep scheduling/execution core for the existing Health stack:

- explicit ChatGPT Standard and Work `AUTHENTICATED_DEEP` schedule definitions at the current LLM default cadence of 5,400 seconds;
- distinct durable monitor-target identities, separate from existing NO_SESSION schedules;
- one scheduled deep executor that accepts only matching authenticated-deep runs;
- explicit injected dependencies for the dedicated target binding, provider-specific Health persistence context, one H3 execution, and Health persistence;
- safe H3 evidence materialization through the existing `createH3HealthEvidencePackage` / `materializeH3HealthPersistenceCommand` path;
- propagation of `scheduledRunId` into the persistence command.

The existing 60-second Health wake remains unchanged. The existing NO_SESSION schedule/bootstrap/runtime remains unchanged. This slice does not start a browser, Telegram delivery, a service, or a live schedule.

Local persistence rejection is classified as `TRANSIENT_ENVIRONMENT`, not provider/network failure, and the H3 action is never retried inside the executor.

## Explicitly excluded from this slice

This parent slice intentionally excludes the child worktree's edits to:

- `apps/health-runner/src/standard-h3-profile.ts`;
- `apps/health-runner/src/standard-h3-profile.test.ts`.

ChatGPT DOM/code/Copy compatibility remains A-owned at the current urgent compatibility boundary. C will consume the exact submitted A candidate normally and will not maintain a competing selector/profile patch.

## Remaining dependencies

### B-owned provider scope/read-model

The executor requires `AuthenticatedDeepPersistenceContextResolver` to resolve the exact Health suite/scope/profile revision and runtime metadata for the scheduled ChatGPT surface. This slice does not add SQL, DB read models, migrations, or a database adapter. If the existing DB surface cannot provide that context, the concrete gap belongs to B.

### A-owned ChatGPT compatibility

A must submit and pass the current ChatGPT DOM compatibility change before C binds a real ChatGPT H3 driver to the scheduled executor. No assumption is made that the existing Standard/Work H3 selectors are current.

### C-owned production composition still open

This slice does not yet:

- bootstrap authenticated-deep schedule rows into the production operator;
- resolve a dedicated technical browser/session binding at runtime;
- call the real H3 registry/browser driver from `apps/telegram-operator`;
- map persisted authenticated uncertainty into the monitoring-lane `NOT_OBSERVABLE` result surface;
- prove incident/outbox/Telegram delivery for an authenticated scheduled run;
- produce a deployable monitor release or systemd start evidence.

Those are follow-on composition steps after the A compatibility and B scope-resolver boundaries are available.

## Evidence boundary

Focused parent validation must cover:

- schedule identity/cadence and NO_SESSION independence;
- fail-closed non-deep/mismatched/missing-dependency cases;
- exactly one injected H3 invocation;
- exactly one persistence call with `scheduledRunId`;
- login/checkpoint/browser-unavailable uncertainty materialized as Health `UNKNOWN`;
- persistence failure classified as transient environment without re-running H3;
- typecheck/lint/format/docs/diff.

No live browser, network, database, Telegram, deployment, periodic-result, or notification-delivery claim is made by this receipt.
