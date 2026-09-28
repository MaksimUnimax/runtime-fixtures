# B16 H3 terminal-result recovery — 2026-09-28

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CANDIDATE — NOT LIVE / NOT DEPLOYED**

Task: `B16_H3_TERMINAL_RESULT_RECOVERY`.
Fresh-main base merged before implementation: `dbfda35297220840b96ab99a32d46694fb867356`.
Canonical main at that reconciliation: `779d4b84dd240861b9c96e442970ae03f406bc2d`.

## Defect reproduced

An authenticated-deep H3 execution can commit a `health_runs` row and then fail while processing the incident/outbox stage.
Production maps that post-persist failure to `AUTHENTICATED_DEEP_PERSISTENCE_REJECTED`; the scheduler terminalizes it to prevent a second provider/browser send.
B15 reconciliation selected only `CLAIMED/RUNNING/TIMED_OUT/FAILED_RETRYABLE`, so the committed result was stranded after `FAILED_TERMINAL`.

Disposable PostgreSQL red proof before the production fix:
- supervisor: `octoport-test-b-085875b6c3504370b4eafb727cfb093e.service`;
- existing H3 tests: 4 PASS;
- new B16 scenario: FAIL at reconciliation, expected recovered `1`, received `0`;
- peak: 524 MiB; supervised cleanup verified.

## Bounded fix

`reconcilePersistedResults()` now admits `FAILED_TERMINAL` only when all of these are true:
- `probe_layer='AUTHENTICATED_DEEP'`;
- `failure_code='AUTHENTICATED_DEEP_PERSISTENCE_REJECTED'`;
- an actual committed `health_runs` row joins by `scheduled_run_id`;
- the scheduler row still has no linked `health_run_id`.

The same predicate guards both candidate SELECT and final UPDATE.
Incident processing still occurs before scheduler success. If recovery throws, the row remains terminal and eligible for another reconciliation attempt without re-running H3.
## Regression proof

The B16 integration scenario uses the real durable scheduler cycle and a disposable PostgreSQL database:
1. scheduler invokes the synthetic H3 executor exactly once;
2. BROKEN H3 result commits;
3. incident processing throws, so scheduler becomes `FAILED_TERMINAL`;
4. end-of-cycle recovery is forced to throw once more; the row remains terminal and notification count remains zero;
5. the next scheduler cycle reconciles the already-saved result, creates exactly one notification intent, links the saved health run and marks scheduler success;
6. a third cycle is a no-op;
7. H3 invocation count remains exactly `1`.

A separate scheduler regression inserts a committed Health result behind a NO_SESSION `SEND_UNCERTAIN` terminal row and proves reconciliation remains `0`, state remains `FAILED_TERMINAL`, and it cannot be claimed again. The fix therefore does not generally reopen terminal rows.

Final pinned toolchain: Node `24.20.0`, pnpm `10.34.5`.

Final sequential disposable PostgreSQL command used the B `--db` integration supervisor:
- `tests/integration/server/health-authenticated-deep-scope.integration.test.ts`: 5/5 PASS;
- `packages/server/db/src/health-scheduler.integration.test.ts`: 17/17 PASS;
- `packages/server/db/src/health-no-session-persistence.integration.test.ts`: 4/4 PASS;
- supervisor: `octoport-test-b-28d9965c8c774350ac6a25fc991f7ff0.service`;
- exit: 0; peak: 567 MiB; OOM: 0; cleanup verified.

Quality gates under the same pinned toolchain:
- `pnpm --filter @product/db typecheck`: PASS;
- targeted ESLint: PASS;
- targeted Prettier check: PASS;
- `git diff --check`: PASS;
- supervisor: `octoport-test-b-01ddec056cfe47689be47f1b31b71ab2.service`;
- exit: 0; peak: 718 MiB; OOM: 0; cleanup verified.

An earlier focused 880 MiB typecheck attempt hit the Node heap limit and was discarded as an environment-resource failure; the unchanged gate passed with the normal 2048 MiB budget.

## Boundaries

No schema or migration change. No C-owned health runtime/scheduler source change.
No live database mutation, monitoring enablement, service restart, provider/browser call, ChatGPT request, store action or deployment was performed.
The historical 18 public NO_SESSION terminal failures are outside the recovery predicate and were not modified.
C still owns review/integration, production-composition verification, five-CI promotion and any bounded pilot rollout.
