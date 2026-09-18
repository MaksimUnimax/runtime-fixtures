# S2-O2 LLM Health notification / noise-control acceptance closure R2

Status: `IMPLEMENTED_CANDIDATE` — acceptance closure evidence is complete;
architect acceptance remains external.

Work ID: `S2_O2_LLM_NOTIFICATION_ACCEPTANCE_CLOSURE_2026-09-19_R2`.

## A. Preflight

- R1 SHA: `58092e8f05c8a7292ba080381501ab4426e2bab1`.
- R1 tree: `63eee66b073e2da4cf6cec2b42a660479641b2ae`.
- R1 parent: `7ec0693e7e8149ae8d9c50ad41c237a23a34bd86`.
- R1 is directly based on the accepted local S2-L8 line; no rebase onto A1,
  Stream-1, or main was performed.
- `origin/main`: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`.
- `origin/integration/i1-c1-srv5-2026-09-16`:
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- PR #9 head: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`; merge ref:
  `ccd6fd504f8e1d572e3e2c7eefce33884186e9f2`.
- Active worktree audit found 37 registered worktrees. Unrelated worktrees and
  owner processes were preserved.
- Toolchain: Node `v24.20.0`, pnpm `10.34.5`, Playwright `1.62.1`, PostgreSQL
  `18.0`, Chromium/Chrome for Testing `151.0.7922.34`.
- `pnpm install --frozen-lockfile`: PASS. `pnpm-lock.yaml` unchanged.
- Local migration inventory is unique and ordered through `0022`; no competing
  `0022` was found in the active R1 lineage/worktree audit.

## B. Isolated PostgreSQL

- Dedicated container: `s2-o2-r2-postgres-20260919`.
- Container identity: `24812fb9aada78dd6136e40154a025b163cb6b8185cd5aa1d1bc049cea44c374`.
- Image: `postgres:18.0`.
- Loopback port: `55460`; database: `s2_o2_r2`; disposable local database
  class; data mounted on container-local tmpfs.
- Final `pg_isready`: accepting connections. The image has no Docker healthcheck;
  readiness was verified directly with `pg_isready` and SQL.
- No other suite used this container/database. Integration runs were sequential;
  unrelated containers and processes were not touched.

## C. Clean migration and canonical integration

The complete chain was applied with repository-standard `pnpm db:migrate` to a
fresh empty database before each final canonical pass.

| Gate | Result |
| --- | --- |
| Clean `pnpm db:migrate` | PASS |
| Migration rows | 21 |
| Distinct migration hashes | 21 |
| Migration 0022 table/types/indexes | PASS; created exactly once |
| Canonical `pnpm test:integration` pass #1 | 46 files, 1,583 passed, 0 failed, 0 skipped; 187.61s wall |
| Canonical `pnpm test:integration` pass #2 | 46 files, 1,583 passed, 0 failed, 0 skipped; 180.74s wall |
| Final PostgreSQL health | PASS; `pg_isready` accepting connections |

The initial post-R1 canonical batch was collected completely before correction:
46 files, 1,578 passed, 5 failed, 0 skipped. The five failures were stale
expectations of 20 migration rows or the pre-0022 table list. They were corrected
to the actual 21-row chain and additive `health_notification_intents` table.

One unrelated P7.2 lock-order assertion failed in the first corrected attempt.
The exact P7.2 file then passed 10/10 on a fresh database, and both final full
passes passed. No P7.2 or product source was changed.

## D. Migration 0022 review

`0022_s2_o2_llm_health_notification_intents.sql` is additive only. It creates
three enums, one `health_notification_intents` table, one unique dedup index,
two operational indexes, and the table primary-key index. It does not rewrite or
drop Health tables, incidents, runs, evidence, H4, or H5 data.

The migration has deterministic unique dedup identity, restricted incident/run
foreign keys, state/severity/event constraints, positive group and non-negative
retry constraints, JSON-object payload validation, monotonic observation times,
claim-token/lease integrity, and delivered-state integrity. Nullable claim,
provider, delivery, and expiry fields match their lifecycle semantics.

Retention is metadata only (`retention_class` plus nullable `expires_at`); no
automatic deletion or destructive cleanup policy exists. Existing Health-data
compatibility and incident migration safety passed through the PostgreSQL
integration suites, including `health-incident-migration.integration.test.ts`.

## E. Health-runner failure identity and closure

Retained R1 evidence was insufficient for the exact identity, so the permitted
single diagnostic full-suite rerun was performed.

- File: `apps/health-runner/src/dedicated-health-session.test.ts`.
- Test: `dedicated Alice Health session capability › AD39-44 retains only the
  frozen in-memory Alice snapshot after source changes`.
- Provider/surface: synthetic dedicated Alice / `ALICE`; target key
  `alice_health`; browser family Chrome/Chromium.
- Scenario: AD39–44.
- Expected: both controlled drivers start, report Chromium runtime metadata, and
  preserve the frozen in-memory empty storage-state snapshot after source
  mutation/deletion.
- R1/diagnostic actual: `BrowserDriverError` with safe code
  `CONTROLLED_BROWSER_UNAVAILABLE`; suite result 301/302, one failed test.
- Failure step: `firstDriver.start()` at the browser launch boundary
  (`browser-driver.ts:174` maps the launch exception).
- Browser path resolution: Playwright resolved the installed browser at
  `/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`, but Playwright
  1.62 attempted the absent companion executable
  `/root/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell`.
- Browser process launched: no; failure occurred before launch.
- Fixture server: not applicable; this security/configuration test uses no fixture
  server or live provider.
- Classification: `CONTROLLED_BROWSER_INSTALLATION_MISSING`.

The repository/CI-supported command `pnpm exec playwright install chromium` was
run. It installed Chrome Headless Shell `151.0.7922.34`. An independent launch,
context creation, page creation, and close then passed. No stealth browser,
profile, security weakening, skipped test, retry-to-green, or assertion change
was used.

Repetition matrix, all sequential and zero-retry:

| Target | Result |
| --- | --- |
| Exact AD39–44 test ×30 | 30 passed, 0 failed |
| Alice logical group ×20 | 22 tests/run; 440 total executions; 440 passed, 0 failed |
| Full health-runner ×5 | Each run 15 files, 302 passed, 0 failed, 0 skipped; 5/5 runs passed |

## F. Correction

One real acceptance-test defect was corrected: five existing PostgreSQL tests
still encoded the pre-0022 migration count/table shape. Changed files:

- `packages/server/db/src/adapter-registry.integration.test.ts`;
- `packages/server/db/src/postgres.integration.test.ts`;
- `tests/integration/server/p2-auth.integration.test.ts`;
- `tests/integration/server/p5-7-p5-final-acceptance.integration.test.ts`;
- `tests/integration/server/p6-1-admin-security.integration.test.ts`.

The correction updates migration count `20` to `21` and adds the additive intent
table to the exact table assertion. No production implementation or notification
semantics changed. Full integration passes #1 and #2 were rerun after this
correction and passed.

## G. Notification PostgreSQL regression

Focused notification regression passed against real PostgreSQL 18: 5/5
PostgreSQL tests and 6/6 Health notification unit tests, 11/11 combined.
Coverage includes producer dedup and concurrent producers, repeated-failure
aggregation, cooldown, escalation, recovery exactly once, maintenance
suppression/resumption, UNKNOWN no product alert, delivery claim, expired-lease
reclaim, stale-owner rejection, delivered non-reclaim, transient retry, terminal
failure, disabled-route suppression, bounded payload, and stable provider
idempotency key.

Independent-connection claim safety is database-backed: worker A claims, worker B
cannot claim the live row, an expired lease is reclaimed, stale A cannot finalize,
B finalizes, and delivered state cannot reclaim. No process-local lock is needed.

## H. Delivery contract and provider boundary

The contract remains durable internal dedup plus a stable provider idempotency key
with at-least-once delivery semantics for arbitrary providers. The deterministic
test sink proves one logical local delivery per key, but R1/R2 make no universal
exactly-once claim for arbitrary external providers. The disabled/no-op sink and
provider-neutral `NotificationDeliveryPort` remain the only delivery surfaces.

Real provider sends: `0`. No email, Telegram, Slack, SMS, webhook, or paid
monitoring provider was configured or contacted.

## I. Policy and retention

Cooldown authority is centralized in
`packages/server/health/src/notifications.ts`: injectable policy with a reversible
15-minute default and explicit stronger-severity bypass behavior. There are no
scattered cooldown constants. Retention is non-destructive metadata only; no
automatic cleanup job or duration guarantee is implemented. No Health incidents,
runs, or evidence were deleted.

Future live provider selection, credentials, routing destination, account/legal
terms remain `OWNER_EXTERNAL_ACTION_DEFERRED`; this does not block the provider-
neutral foundation.

## J. Privacy and security

The final-scope source, migration, worker, tests, R1/R2 documentation, and
receipt were scanned for secret/private payload persistence. Notification payloads
contain bounded operational identifiers, enums, timestamps, provider/surface,
incident/run references, route, and severity only. No cookies, storage state,
auth headers, passwords, tokens, OTP values, technical sessions, private
conversation contents, assistant response contents, raw DOM, screenshots,
seller/customer payloads, or personal notification destinations persist in the
notification path. Test assertions mentioning forbidden categories are negative
privacy checks, not persisted values. Logs contain safe operational codes and
test-generated correlation identifiers only.

## K. S2-O1 and Stream-1 boundaries

- No generic incident v2 was implemented.
- No API change incident schema or API-watch notification adapter was added.
- No Stream-1 product runtime path was changed.
- The existing Health recommendation enforcement item remains
  `OWNED_BY_PARALLEL_STREAM_1`.
- No real LLM provider call occurred and no product runtime notification feature
  was added.

## L. Regression, builds, and checks

| Gate | Result |
| --- | --- |
| Health domain | 130/130 |
| DB unit/migration | 12/12 |
| Health incidents | 7/7 |
| Health persistence | 22/22 |
| Health scheduler | 17/17 |
| Incident migration safety | 2/2 |
| Worker tests | 16/16 |
| Recursive workspace tests | PASS; includes Health 130/130 and health-runner 302/302 |
| Recursive typecheck | PASS; 34 workspace projects |
| API/worker/health-runner/portal/admin builds | PASS |
| Lint | PASS |
| Format check | PASS |
| Documentation check | PASS; 530 files, 294 Markdown files |
| OpenAPI check | PASS |
| Bridge guard | PASS |
| `git diff --check` | PASS |

No live LLM calls and no real notification sends occurred.

## M. Git and publication

R2 continues directly from R1 on branch
`feature/stream2-o2-llm-notifications-r2-2026-09-19`. There was no force push,
rebase, amend, reset, main merge, or PR #9 mutation. The bounded correction and
this receipt are the only R2 worktree changes before commit. A normal push/readback
will be attempted; if GitHub credentials are unavailable, publication remains
`ENVIRONMENT_DEFERRED / NOT_REMOTE_VERIFIED`.

## N. Deferred ledger

`ENVIRONMENT_DEFERRED`

- Stream-2 remote publication/readback if credentials are unavailable;
- no provisioned technical LLM sessions for future authenticated live validation;
- S2-A1 provider source access protection.

`OWNER_EXTERNAL_ACTION_DEFERRED`

- Future real notification provider selection, credentials, terms, and routing,
  if still applicable.

`OWNED_BY_PARALLEL_STREAM_1`

- Product-runtime enforcement of Health recommendations.

## O. Verdict

`IMPLEMENTED_CANDIDATE`

## P. S2-O2 foundation readiness

Is the LLM Health notification/noise-control foundation ready for architect
acceptance independently of a real notification provider?

`YES` — subject to architect acceptance. The foundation is provider-neutral,
non-live, migration-clean, regression-green, and does not claim arbitrary-provider
exactly-once delivery.

## Q. Next

The next dependency-correct Stream-2 work should remain outside this bounded task
and may proceed only when its prerequisites are accepted. Do not start S2-O1 or
an API-watch notification adapter until API incident semantics mature; do not
repeat identical A1 source-acquisition probing.
