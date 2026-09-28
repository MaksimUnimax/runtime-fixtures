# C — B16 H3 terminal persisted-result recovery acceptance — 2026-09-28

Status: **ACCEPTED SOURCE + DISPOSABLE POSTGRESQL / MAIN CI PENDING**

Original B candidate: `4a4e78581c5681711a7a89da9905da4c58969dce`.
Candidate base / current remote main at intake: `779d4b84dd240861b9c96e442970ae03f406bc2d`.
C checkpoint before B intake: `23f3d9707ce249637aa2ec0ea66de4439dfd65c7`.
Integrated B16 cherry-pick: `710e8d5974133648d42d1703203aa07f2af29645`.

C inspected the exact B16 commit, not the accumulated B branch history. The old `B_STOP` receipt and merge-only history were not replayed. The accepted commit changes only:
- `packages/server/db/src/health-scheduler-repository.ts`;
- `packages/server/db/src/health-scheduler.integration.test.ts`;
- `tests/integration/server/health-authenticated-deep-scope.integration.test.ts`;
- B16 receipt.

No schema or migration file changed.

## Accepted behavior

Terminal persisted-result recovery is admitted only for a real joined Health result where the scheduler row is `FAILED_TERMINAL`, `probe_layer='AUTHENTICATED_DEEP'`, `failure_code='AUTHENTICATED_DEEP_PERSISTENCE_REJECTED'`, and no `health_run_id` is linked yet. The same predicate protects the final scheduler UPDATE.

C independent disposable-PostgreSQL acceptance reran sequentially on the integrated tree:
- authenticated-deep scope/recovery: 5/5 PASS;
- health scheduler: 17/17 PASS;
- NO_SESSION persistence fence: 4/4 PASS;
- supervisor `octoport-test-c-88cf5e2f6c0446fcb0a86d0dce6e5025.service`: exit 0, OOM 0, cleanup verified, peak 419,430,400 bytes.

The scenario proves: H3 executes once; BROKEN result commits; incident processing fails; scheduler terminalizes; a failed reconciliation leaves the row recoverable; the next reconciliation creates exactly one notification intent and links the same Health run; the following reconciliation is a no-op. A committed-result fixture behind NO_SESSION `SEND_UNCERTAIN` remains terminal and unrecovered.

C production-composition compatibility on the integrated tree:
- telegram-operator unit suite: 72/72 PASS;
- telegram-operator typecheck: PASS;
- DB typecheck: PASS;
- targeted ESLint: PASS;
- targeted Prettier: PASS;
- `git diff --check origin/main..HEAD`: PASS.

Evidence boundary: SOURCE + disposable PostgreSQL only. No live DB, service restart, browser/provider call, Telegram poller change, store action or deployment occurred during acceptance.

Authenticated ChatGPT H3 remains disabled. Fixing B16 removes the code defect but does not create the separate legitimate dedicated technical session required to enable that check.

Next: exact final C HEAD must pass the five mandatory branch workflows before `ready-main` and non-force `HEAD:main` promotion.
