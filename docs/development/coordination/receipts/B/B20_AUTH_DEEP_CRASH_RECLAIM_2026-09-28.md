# B20 authenticated-deep crash reclaim fence — 2026-09-28

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CANDIDATE — NOT LIVE H3**

Task: `B_AUTH_DEEP_CRASH_RECLAIM`.

Authority: controller notice `B-AUTH-DEEP-CRASH-RECLAIM-20260928-0705`.

## Defect

Before this change, `claimNext()` could reclaim an expired `RUNNING` scheduler row for every probe layer. For `AUTHENTICATED_DEEP`, execution may already have performed the bounded external send before persistence. Process loss after that boundary left no durable proof that resend was safe, so generic lease reclaim could authorize a second H3 execution.

The existing C/controller source fix `b5122beb72ce2943f702e51763bdafceb9212578` protects caught executor rejections, but does not cover process loss.

## Change

Only `packages/server/db/src/health-scheduler-repository.ts` changes runtime behavior:

- expired `AUTHENTICATED_DEEP/RUNNING` with no scheduler-linked result and no committed `health_runs` row is atomically terminalized as `FAILED_TERMINAL / TRANSIENT_ENVIRONMENT / SEND_UNCERTAIN` before claim selection;
- expired `AUTHENTICATED_DEEP/RUNNING` is excluded from generic reclaim;
- expired `CLAIMED` remains reclaimable because execution has not started;
- public/NO_SESSION `RUNNING` retains the existing reclaim behavior;
- if a Health result committed before process loss, direct `claimNext` cannot reclaim that auth-deep row; normal `reconcilePersistedResults()` attaches the persisted result;
- if a valid auth-deep result arrives after the crash fence terminalized `SEND_UNCERTAIN`, reconciliation may attach that already-persisted result and transition the same scheduler slot to `SUCCEEDED`. This does not invoke H3 again.
- historical/public terminal `SEND_UNCERTAIN` behavior is unchanged because terminal reconciliation is restricted to `AUTHENTICATED_DEEP`.

No schema or migration was needed.

## Disposable PostgreSQL acceptance

Pinned Node `24.20.0`, pnpm `10.34.5`.

Scheduler authority:
- `packages/server/db/src/health-scheduler.integration.test.ts`: **20/20 PASS**;
- proves safe `CLAIMED` reclaim, auth-deep process-loss terminal fence, no reclaim after committed persistence, existing NO_SESSION lease recovery, and existing SEND_UNCERTAIN no-retry;
- supervisor `octoport-test-b-0565c9071e35477a8fa6ef93f12f7cfa.service`, exit 0, peak 556 MiB, cleanup verified.

Authenticated-deep persistence/reconciliation:
- `tests/integration/server/health-authenticated-deep-scope.integration.test.ts`: **7/7 PASS**;
- proves committed-before-crash evidence wins over reclaim;
- proves expired RUNNING with no evidence yields zero second claim;
- proves one late valid persisted H3 result after `SEND_UNCERTAIN` is reconciled to the same slot;
- proves repeated reconcile/claim is a no-op and incident/outbox counts do not duplicate;
- preserves B16 terminal persistence-rejection recovery;
- supervisor `octoport-test-b-2af5645a791c4bebbcf036bcc478f81e.service`, exit 0, peak 556 MiB, cleanup verified.

The first auth-deep run was discarded because the two newly added tests reused an existing test-only unique scheduler target and failed before execution. The fixture identities were corrected; no product change was made for that failure.

Quality:
- DB typecheck + targeted Prettier + `git diff --check`: PASS, supervisor `octoport-test-b-6994d5a6980b4c0c915a4ac1b8dd48ef.service`, exit 0, peak 730 MiB, cleanup verified.
- DB unit tests: **31/31 PASS**; targeted ESLint, Prettier and diff-check PASS, supervisor `octoport-test-b-4d57c56a694f4732a4f7c867038b0ed6.service`, exit 0, peak 585 MiB, cleanup verified.

## Safety boundary

No live ChatGPT/H3 execution, browser send, provider call, live database mutation, deployment, operator session, Telegram delivery or production configuration change was performed.

Authenticated H3 remains disabled until C accepts this source candidate and the separate legitimate dedicated-session/live gate is satisfied.
