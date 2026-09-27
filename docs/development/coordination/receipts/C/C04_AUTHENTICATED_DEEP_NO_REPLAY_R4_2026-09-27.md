# C04 authenticated-deep no-replay R4 — 2026-09-27

Status: **SOURCE SAFETY PASS / NOT YET LIVE AUTHENTICATED H3**

C safety commit: `8ab42d33fd4b2699ed08f9045714d8eb9829a027`.
Fresh-main B13 exact handoff: `dca641ca6d919059a5da9234678d25f2e008912f`.
Integration HEAD after B13 receipt reconciliation: `9c29f333eaf7f409e1af2ac295e2d0f5f4cccff3`.

The authenticated-deep executor now owns `startedAt` from the scheduled run and captures `completedAt` only after H3 returns. The DB resolver no longer supplies invented execution timestamps.

Post-send materialization failure returns `AUTHENTICATED_DEEP_POST_SEND_MATERIALIZATION_REJECTED`. Persistence rejection returns `AUTHENTICATED_DEEP_PERSISTENCE_REJECTED`. Both are terminal scheduler outcomes for that scheduled run.

An authenticated-deep scheduler timeout after execution has started is recorded as terminal `SEND_UNCERTAIN`, not a reclaimable `TIMED_OUT` slot. Before-send configuration failures remain distinct.

Focused scheduler + executor regression proves a persistence failure after one H3 invocation becomes `FAILED_TERMINAL`; a later scheduler cycle does not reclaim the same run and H3/persistence remain exactly one call.

Validation under supervisor `octoport-test-c-0d1190487a5745c78c2015bc44aaf946.service`:
- `@product/health` scheduler: 13/13 PASS;
- `@product/telegram-operator` health runtime: 14/14 PASS;
- both package typechecks PASS;
- Prettier and ESLint PASS;
- exit 0, peak 574 MiB, cleanup verified.

This closes the known post-send replay and completion-timestamp source defects. It does not claim a configured dedicated ChatGPT session, real authenticated browser execution, incident delivery, or live H3 deployment. Those remain separate C04 gates.
