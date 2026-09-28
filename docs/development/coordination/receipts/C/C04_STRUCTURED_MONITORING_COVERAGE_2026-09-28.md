# C04 structured monitoring coverage producer contract — 2026-09-28

Status: SOURCE CANDIDATE / NO DEPLOYMENT.

Base checkpoint: d5774b05672d0ebbab7849b7e27ba7abfe0440cc.

Purpose:
- carry exact tested/unverified targets, observation time, check depth, comparison state and change severity from monitoring producers;
- prevent SUCCEEDED/acquisition from being presented later as full comparison coverage;
- preserve coverage through durable monitoring state.

Changes:
- optional strict MonitoringCoverage on MonitoringRunResult;
- public no-session producer marks only actually observed public outcomes as tested and auth/environment-limited outcomes as unverified;
- durable scheduled Health reports SCHEDULED_EXECUTION without inventing target coverage;
- API authority-only runs report API_SOURCE_ACQUISITION with comparisonState NOT_RUN;
- API report runs mark a target tested only when an authority-accepted exact source has a real product-baseline comparison (base SHA present, CHANGED/NO_CHANGE, no source error);
- document-scoped target IDs allow source-family prefix plus 128-char document keys;
- PostgreSQL monitoring state validates persisted coverage through MonitoringCoverageSchema before reuse.

Validation:
- focused Vitest: apps/telegram-operator/src/runners.test.ts + packages/server/monitoring-control/src/scheduler.test.ts + tooling/api-watch/src/report.test.ts = 43/43 PASS;
- @product/monitoring-control typecheck PASS;
- @product/api-watch typecheck PASS;
- @product/telegram-operator typecheck PASS;
- targeted Prettier PASS;
- targeted ESLint PASS;
- git diff --check PASS.

Boundary:
- no Telegram send;
- no service deploy/restart;
- no DB/schema/migration change;
- no live provider/API calls;
- no claim that user-facing Russian explanation is complete;
- C03 product baseline checkpoint remains NOT_ACCEPTED until B 0054 chain is integrated and verified.
