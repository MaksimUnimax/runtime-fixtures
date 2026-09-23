# S2-O3 LLM notification visibility acceptance R2

Status: `IMPLEMENTED_CANDIDATE`; bounded LLM Health operational-visibility
foundation is ready for architect acceptance. This receipt does not claim full
S2-O3.

## A. Preflight

- Exact R1: `8053f61cc9dbb32f597d0a5ccac5644901dd899e`.
- R1 tree: `f0d6e625005387f41d223e8bed178179519c66ce`.
- R1 parent: `90fc4bc9bf73cdd5cebe0066cd7754ea595cf2c4`.
- `90fc4bc9` is an ancestor of R1. No accepted history was rewritten.
- `origin/main`: `bc718cc5c677ad0eb4598e7de3ad766473ff0847`.
- `origin/integration/i1-c1-srv5-2026-09-16`:
  `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- PR #9 head: `23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- Toolchain: Node `v24.20.0`; pnpm `10.34.5`; PostgreSQL `18.0`.
- `pnpm install --frozen-lockfile` passed; lockfile unchanged.
- All linked worktrees were inspected and preserved. Active owner Codex,
  Chromium, PostgreSQL, and unrelated Stream-1 processes/containers were not
  stopped or modified. No Vitest/Playwright test process was active at the
  task-start process inspection.
- Isolated database: one task-owned PostgreSQL 18 container,
  `s2o3-r2-postgres-20260919`, bound to local port class `55460`, with
  tmpfs-backed PostgreSQL data. Passes used separate databases in that
  service and were sequential; no other suite shared either database.

## B. R1 resource failure and recovery

Classification: `UNRELATED_OWNER_DATA_PRESSURE`.

Evidence at preflight was a 59 GiB root filesystem at 100% with 53 MiB
available. The largest identified pressure classes were owner-managed
`/var/backups` at 4.5 GiB, unrelated business-bridge state at 2.1 GiB,
Docker storage at 8.6 GiB containing active database volumes, and unrelated
worktree/toolchain data. Docker reported no stopped containers and its
reclaimable volume summary was not attributable to this acceptance run;
active database volumes were retained. The dangling anonymous volume sweep
showed no large safe Stream-2 volume that could explain or safely repair the
failure. This is evidence of host owner-data pressure, not an R1 read/query
failure.

No owner data, source worktree, active container, database, secret, or
unrelated evidence was deleted. Broad Docker prune was not used. The safe
alternative was a uniquely named tmpfs-backed PostgreSQL 18 service. It
remained healthy for both complete integration passes and all focused DB
regressions. The host-disk/full-integration blocker is therefore removed from
the active deferred ledger.

## C. Canonical full integration

The initial post-R1 run reached the complete harness and exposed one stale
static acceptance assertion: P5.7 STATIC-71 expected the pre-R1 111-operation
OpenAPI artifact and its old hash. The complete initial result was 45 passed
files, 1 failed file, 1,585 passed tests, 1 failed test, 0 skipped, and
3m06.741s. Classification: `API_CONTRACT_DEFECT` in the stale acceptance
guard.

The bounded correction updated only that guard to the accepted R1 artifact:
113 operations and SHA-256
`4cd66e833b958b25d2cb46eda623e102984ffe1967e12e636c7b6dc2a6d90517`.
The focused red test then passed: 1 passed, 79 skipped.

After correction:

- Pass #1: 46 files, 1,586 passed, 0 failed, 0 skipped; Vitest duration
  179.01s.
- Pass #2, fresh database: 46 files, 1,586 passed, 0 failed, 0 skipped;
  Vitest duration 179.59s.
- PostgreSQL remained accepting connections throughout both passes.

No notification, join, pagination, cursor, filter, privacy, migration-state,
shared-database, or host-resource failure occurred in either corrected pass.

## D. Migration

On a fresh empty PostgreSQL 18 database, `pnpm db:migrate` passed.

- Exact migration count: 21.
- Journal entry `0022_s2_o2_llm_health_notification_intents` appears exactly
  once at journal index 20.
- `health_notification_intents` and its Health incident/run dependencies
  exist.
- O3 added no migration and made no schema mutation.

## E. PostgreSQL read regression and side effects

The focused real-PostgreSQL regression passed: 4 files, 33/33 tests.
It covered O2 notification authority (7), Health admin composition including
notification admin reads (2), incidents (7), and scheduler (17).

The exercised read coverage proves list pagination, maximum limit, invalid
cursor rejection at the API boundary, equal-timestamp deterministic
`created_at DESC, id DESC` ordering, state/severity/incident/provider/surface/
route-key filters, missing detail, incident and Health-run joins, bounded
evidence projection, no duplicate rows, and no write side effect in the admin
read contract.

Independent source inspection confirms the admin repository executes only
bounded SELECTs and exposes only `listNotifications` and `getNotification`.
It does not claim, deliver, retry, suppress, mutate incidents, or mutate
evidence. The API and repository tests also assert that provider payload,
claim owner/token, provider delivery ID, and provider response body are absent.

## F. API and OpenAPI

Routes remain GET-only:

- `GET /v1/admin/health/notifications`
- `GET /v1/admin/health/notifications/:id`

RBAC remains exact: unauthenticated denied; `ADMIN_OWNER` and `ADMIN_OPS`
allowed; `ADMIN_SUPPORT`, `ADMIN_BILLING_READONLY`, and
`ADMIN_BETA_OPERATOR` denied, through `health.read`.

OpenAPI semantic comparison against accepted O2 is exact: 111 to 113
operations, additions only:

- `GET /v1/admin/health/notifications`
- `GET /v1/admin/health/notifications/{id}`

There are no notification mutation operations and no private notification
fields in the new schemas. `pnpm openapi:check` passed.

API full suite: 19 files, 238/238 passed. Notification/auth focused route
coverage: 36/36 passed, including the 13 notification-admin route tests.

## G. Admin UI

Routes remain `/health/notifications` and `/health/notifications/[id]`.
The full admin suite passed: 5 files, 154/154 tests. Navigation, list/detail,
loading, empty, error, forbidden, pagination, delivery state, retry metadata,
cooldown, suppression, incident link, retention truth, and read-only controls
remain covered. No action button or mutation control exists.

## H. Mutation guard

The admin Health module receives the narrowed
`HealthNotificationAdminReadRepository` interface only. Runtime access to
`claimDue`, `markDelivered`, `failClaim`, `scheduleRetry`, `deliver`,
`providerSend`, and `suppress` is absent. The architectural mutation guard
passed, including the two Health notification read-only guard assertions.

## I. Privacy and provider truth

The DB projection, API schemas, UI models, tests, and OpenAPI notification
paths were scanned for personal destinations, webhook URLs, credentials,
provider response bodies, raw payloads, lease secrets, cookies, storage state,
auth headers, passwords, OTPs, session handles, private conversation IDs,
assistant content, raw DOM, and seller/customer payloads. No such value is
projected. Negative tests explicitly guard payload, claim secrets, delivery
IDs, response bodies, and mutation methods. Only abstract route keys and
truthful `DETERMINISTIC_TEST_SINK` / `DISABLED_SINK` values are visible.
No live LLM call or real notification send occurred.

## J. O2, Health, incident, and scheduler regression

- O2 notification PostgreSQL regression: 7/7.
- Health admin PostgreSQL regression: 2/2.
- Incident PostgreSQL regression: 7/7.
- Scheduler PostgreSQL regression: 17/17.
- DB unit tests: 12/12.
- Health domain and mutation tests: 131/131.
- Worker unit tests: 16/16.

Delivered recovery notifications remain observational and do not resolve
incidents. Failed notifications do not reopen incidents. Suppressed
notifications do not change Health state. Nullable retention expiry remains
nullable and no cleanup SLA or automatic deletion claim was added.

## K. Boundaries

No generic cross-domain incident or notification model was added. No
`tooling/api-watch/**` path changed; S2-A1 acquisition was not repeated and
S2-A2 was not started. No S2-O1 source/model was added. No Stream-1 product
runtime, extension, bridge, marketplace, auth/session, Work, dispatch/replay,
sync, browser, or release path changed.

## L. Complete acceptance matrix

Passed after the bounded static-guard correction:

1. canonical integration pass #1;
2. canonical integration pass #2;
3. clean `pnpm db:migrate`;
4. notification admin PostgreSQL reads;
5. O2 notification PostgreSQL regression;
6. Health admin PostgreSQL regression;
7. incident PostgreSQL regression;
8. scheduler PostgreSQL regression;
9. DB unit tests;
10. API full suite;
11. notification/auth focused API tests;
12. admin UI full suite;
13. mutation guard;
14. Health domain tests;
15. recursive workspace tests plus bridge guard;
16. recursive typecheck;
17. API build;
18. admin build;
19. worker build;
20. lint;
21. format;
22. docs check;
23. OpenAPI check;
24. bridge guard;
25. `git diff --check`.

The only defect was the pre-R1 OpenAPI count/hash assertion; it was corrected
without weakening behavior, privacy, pagination, or mutation assertions.

## M. Git

R1 remains an unchanged parent. The bounded R2 correction is limited to the
P5.7 static OpenAPI expectation and this receipt. No force push, destructive
rebase, merge, or amend is used. Push/readback status is recorded in the
terminal handoff after the normal push attempt.

## N. Deferred ledger

`ENVIRONMENT_DEFERRED`:

- remote Stream-2 publication/readback if credentials are unavailable;
- no provisioned technical LLM sessions;
- S2-A1 provider source access protection.

`OWNER_EXTERNAL_ACTION_DEFERRED`:

- future real notification provider selection and credentials.

`OWNED_BY_PARALLEL_STREAM_1`:

- product-runtime enforcement of Health recommendations.

The prior host-disk/full-integration blocker is not deferred.

## O. Verdict

`IMPLEMENTED_CANDIDATE` — bounded R2 acceptance closure is complete; architect
acceptance remains the authority decision.

## P. S2-O3 readiness

- Is the bounded LLM notification operational-visibility foundation ready for
  architect acceptance? **YES**.
- Does this complete all S2-O3? **NO**. Full S2-O3 remains dependent on
  mature API-watch operational semantics.

## Q. Next

The next dependency-correct frontier is API-watch operational visibility only
after S2-A1 source authority and the required incident semantics mature. Do
not start S2-O1 prematurely, repeat A1 acquisition, or begin A2 without A1
authority. Until then, the productive bounded work is architect review and
remote publication/readback recovery; no independent implementation is
started by this task.
