# C — B16 H3 terminal persisted-result recovery acceptance prep — 2026-09-28

Status: **C COMPOSITION SIDE READY / B DB CANDIDATE PENDING**

Issue: a production authenticated-deep run can commit its Health result and then fail in `incidents.processCompletedHealthRun`. The outer executor reports `AUTHENTICATED_DEEP_PERSISTENCE_REJECTED`; scheduler terminalizes that post-send run to prevent provider/H3 replay.

C-owned production-composition regression is now explicit in:
`apps/telegram-operator/src/authenticated-deep-runtime.test.ts`.

It models the exact boundary: persistence port crosses its commit boundary, incident processing rejects, execution returns the persistence-rejected terminal failure, browser closes, and H3 plus persistence port are each called exactly once.

Current C focused verification on Node 24.20.0:
- telegram-operator: 72/72 tests PASS;
- telegram-operator typecheck: PASS.

This C test is not a substitute for PostgreSQL recovery. B remains the only author of `packages/server/db/**`, schema and migrations.

B candidate acceptance must prove on disposable PostgreSQL:
1. one BROKEN H3 Health run is committed and linked to the scheduled identity;
2. incident processing fails once before notification intent commit;
3. scheduled run reaches `FAILED_TERMINAL` without a second H3/browser/send;
4. later `reconcilePersistedResults()` processes the already committed Health run, creates exactly one incident notification intent and links scheduler success to that same Health run;
5. a second reconciliation is a no-op;
6. failed recovery stays recoverable without a provider call;
7. the recovery selector is narrow: it does not reopen arbitrary terminal rows and preserves historical NO_SESSION terminal failures;
8. `SEND_UNCERTAIN` is eligible only when an actual committed result identity exists and the policy is explicit/tested.

C intake sequence for a clean B SHA:
- ancestry and exact diff review against current `origin/main`;
- verify only B-authorized DB/test/receipt files changed;
- run B focused disposable-DB tests sequentially on C DB port 15543;
- run this C production-composition test again on the integrated tree;
- run changed-consumer compatibility/typecheck/lint;
- then run the mandatory five branch CI workflows on the exact integration HEAD;
- only after all five PASS: `ready-main`, non-force `HEAD:main`, remote readback.

Authenticated H3 remains disabled until this defect and the legitimate dedicated technical-session gate are both closed. No live incident will be fabricated for acceptance.
