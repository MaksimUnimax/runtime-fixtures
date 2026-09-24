# C04 Server CI migration-fact repair — B handoff

Date: 2026-09-24
Role: B
Status: SOURCE / disposable PostgreSQL PASS; NOT LIVE

## Trigger

C full C04 candidate:
- 166df7f5716297ce2abc6fe741f3702a0930877e

GitHub Server CI:
- run 36035243587
- job 107754165565
- pnpm test:integration failed
- 4 failed / 1659 passed

All four failures had the same cause: source migration 0049 is present and the migration journal contains 39 entries, while four historical integration assertions still expected 38 / through 0048.

No runtime, schema, migration, or health behavior failed in this finding.

## Repair

Updated only the stale migration-fact assertions:
- tests/integration/server/p2-auth.integration.test.ts: 38 -> 39
- tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts: title through 0048 -> 0049 and 38 -> 39
- tests/integration/server/p6-1-admin-security.integration.test.ts: title through 0048 -> 0049 and 38 -> 39
- packages/server/db/src/adapter-registry.integration.test.ts: 38 -> 39

Repository scan after the edit found no remaining `toBe("38")` or `through 0048` migration facts in the relevant server integration / DB test scope.

## Validation

Static:
- focused Prettier check: PASS
- git diff --check: PASS

An initial combined four-file Vitest invocation was discarded because those integration files share/reset the same public schema when run concurrently; that produced cross-file relation-missing/deadlock noise and is not acceptance evidence.

Each originally failing CI file was then run in its own fresh disposable PostgreSQL job:
- p2-auth.integration.test.ts: 14/14 PASS
  - unit octoport-test-b-8c3fd57c50414b4eab0a336bf080f8bb.service
  - exit 0, peak 527 MiB, cleanup verified
- p5-7-p5-final-acceptance.integration.test.ts: 80/80 PASS
  - unit octoport-test-b-fabdeb0977514dbaab76363a8658c9dc.service
  - exit 0, peak 536 MiB, cleanup verified
- p6-1-admin-security.integration.test.ts: 77/77 PASS
  - unit octoport-test-b-5434e18fbc1e4c1d8ddd028015a9f66e.service
  - exit 0, peak 524 MiB, cleanup verified
- adapter-registry.integration.test.ts: 7/7 PASS
  - unit octoport-test-b-182e88acf6814962ac2ecc07ed7c3915.service
  - exit 0, peak 509 MiB, cleanup verified

Focused total: 178/178 PASS.

## Limits

No new migration. No 0050. No live0049.
No live DB, deployment, Telegram send, store action, or package publication.

C should selectively integrate the exact tests-only repair commit on top of its C04 candidate and rerun the exact five-workflow CI gate.
