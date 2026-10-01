# C03 production crosswalk wiring — 2026-10-01

Status: **SOURCE ACCEPTED; no live deployment or live DB mutation**.

Task: `C03-PRODUCTION-CROSSWALK-WIRING`.
Parent before this change: `ac07bf49367e11fc833150490a3d527c917d0e25`.
Scope is exactly:
- `tooling/api-watch/src/run.ts`;
- `tooling/api-watch/src/report.test.ts`;
- `apps/telegram-operator/src/main.ts`;
- `apps/telegram-operator/src/tg4-security.test.ts`;
- this receipt.

The existing product registry, crosswalk store and incident evaluator are reused. No new crosswalk model, migration, scheduler or Telegram poller was added.
A report persists product crosswalk rows only after a valid accepted product baseline resolves to the exact stored snapshot. First observation, missing baseline and invalid baseline do not create product crosswalk rows.
Valid `NO_CHANGE` and `CHANGED` comparisons save rows under the current report ID; the same report's rows are loaded and passed to `evaluateApiWatchIncidents`.
Document-scoped source rows keep `documentKey`; existing incident recovery continues to require accepted `NO_CHANGE` evidence for the matching document. Existing sibling-document recovery tests remain part of the focused suite.
Callers without `crosswalkStore` remain backward-compatible and do not receive product rows from this wiring.
The existing Telegram `SWAGGER_API` runner now supplies `createPostgresProductCrosswalkStore(database)` to the same single `IndependentMonitoringScheduler`.

Verification on Node 24.20.0:
- `@product/api-watch` typecheck: PASS.
- `@product/telegram-operator` typecheck: PASS.
- Prettier check on four changed source/test files: PASS.
- `git diff --check`: PASS.
- supervised focused tests: `report.test.ts` + `incident.test.ts` + `tg4-security.test.ts` = **55/55 PASS**.
- resource receipt: `/root/octoport-control/resource-jobs/9db80ea4e11a484c9059ce51b7a83d5e/receipt.json`; exit 0, peak 359 MiB, OOM 0, cleanup verified.
- independent read-only review: `/root/octoport-control/logs/C/c03-production-crosswalk-review-20261001-result.md` = **PASS**, no blocking findings; process exit 0.

Evidence level: SOURCE / supervised local fixture only. No production Swagger fetch, live DB write, service restart, Telegram send, provider request, migration apply or deployment was performed.
Main publication remains a separate exact-candidate step against fresh `origin/main`; unrelated local C05/C06 history must not be bundled.
