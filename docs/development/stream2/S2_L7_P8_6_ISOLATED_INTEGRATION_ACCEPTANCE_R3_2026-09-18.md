# S2-L7 / P8.6 isolated integration acceptance R3

## Candidate and bounded correction

- R2 candidate under verification: `b5b796433502a00c43d6fbdfbc668c976f5ff174`.
- R2 tree: `b80f3099cca85e51770892ccddf60fdcefe10ebf`.
- R2 parent: `fb23e67d0cfb3cb31ebb364d98a591364a783db4`.
- R3 correction commit: `f4d950f` (`test(health): close isolated integration acceptance gaps`).
- The correction is acceptance-only: migration expectations now reflect 20
  migrations and `health_profile_evaluations`, and the deliberately failing
  legacy-incident migration fixture restores the shared sequential database
  before later files run. No product feature or Health contract was changed.
- The candidate remains directly descended from the accepted H4/H5 foundation
  `fb23e67d0cfb3cb31ebb364d98a591364a783db4`, which is descended from the
  accepted S2-L6 incident/scheduler line `44954d71d28257d885feaa270526abcf72fb04e3`.

## Preflight and isolated PostgreSQL

- `git fetch --all --prune` completed.
- `origin/main`=`bc718cc5c677ad0eb4598e7de3ad766473ff0847`.
- `origin/integration/i1-c1-srv5-2026-09-16`=`23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- PR #9 head=`23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- Node `v24.20.0`; pnpm `10.34.5`; PostgreSQL `18.0 (Debian 18.0-1.pgdg13+3)`.
- `pnpm install --frozen-lockfile` passed and did not change the lockfile.
- The R2 worktree was used. The unrelated root Stream-1 worktree had existing
  untracked content and was not modified.
- Preflight found existing PostgreSQL containers for other tasks and no active
  Vitest/Node integration process. No unrelated process or container was
  killed or mutated.
- Runs used fresh disposable PostgreSQL 18 containers backed by tmpfs because
  the host Docker filesystem was full. Run #1 used a unique database on local
  port `55461`; run #2 used a newly created unique database on `55462`; the
  migration-only check used a third fresh database on `55463`. Runtime
  credentials are task-local and intentionally omitted from this receipt.
  No other suite shared any of these databases.
- The first disk-backed container attempt failed before initdb with Docker's
  `No space left on device`; it was removed and replaced with tmpfs-backed
  disposable containers. PostgreSQL then started healthy and remained out of
  recovery with restart count zero for the acceptance runs.

## Prior R2 recovery-mode event

The only retained R2 evidence is the R2 receipt: 840 tests passed before a
shared PostgreSQL entered recovery while concurrent schema-reset suites were
running. The live repository config explicitly sets `fileParallelism: false`.
No retained log shows PostgreSQL OOM, restart, or server termination. Two clean
isolated canonical runs below did not reproduce recovery mode.

Classification: `SHARED_DB_INTERFERENCE` (execution-orchestration/shared
database misuse), not a PostgreSQL or candidate defect. The first corrected
canonical run also exposed a separate test-harness cleanup defect: an expected
duplicate-legacy-incident migration failure left its fixture database poisoned
for later sequential files. R3 corrected that cleanup and the stale migration
assertions.

## Canonical full integration

The exact repository command was run sequentially with the repository config:

```text
pnpm test:integration
```

- Corrected isolated pass #1: 45 files, 1,578 tests, 1,578 passed, 0 failed,
  0 skipped, 221.32 seconds.
- Corrected isolated pass #2 on a newly created database: 45 files, 1,578
  tests, 1,578 passed, 0 failed, 0 skipped, 290.87 seconds.
- First PostgreSQL run under the uncorrected R2 candidate was intentionally
  allowed to collect the full batch: 45 files, 1,578 tests, 863 passed, 4
  failed tests across 12 files, 711 skipped. Failures were three stale
  migration-count assertions, one stale table inventory, and eight downstream
  retries of the poisoned legacy-incident migration state. No recovery mode
  occurred in this isolated run.
- Final PostgreSQL health after pass #2: PostgreSQL 18.0, `pg_is_in_recovery()`
  false, container running, restart count zero.

## Admin auth and RBAC

`health.read` is the only additive permission, declared in the existing P6
admin permission authority and granted to `ADMIN_OWNER` through the owner set
and to `ADMIN_OPS`. There is no `health.manage` permission.

| Role | Health read |
| --- | --- |
| `ADMIN_OWNER` | allowed |
| `ADMIN_OPS` | allowed |
| `ADMIN_SUPPORT` | denied |
| `ADMIN_BILLING_READONLY` | denied |
| `ADMIN_BETA_OPERATOR` | denied |

The admin-auth unit suite passed 46/46. Diff review confirms no change to
session authentication, CSRF, TTL, role identity, existing permissions, owner
bootstrap, or unrelated role widening. The only role-map additions are the
intended `health.read` entries.

## API and OpenAPI

The Health API is GET-only:

- `GET /v1/admin/health/targets`
- `GET /v1/admin/health/targets/:target_id`
- `GET /v1/admin/health/incidents`
- `GET /v1/admin/health/incidents/:id`
- `GET /v1/admin/health/evaluations`
- `GET /v1/admin/health/evaluations/:id`
- `GET /v1/admin/health/recommendations`

All routes require `health.read`, use bounded list limits/cursors and filters,
return `cache-control: no-store`, and call only read composition methods. No
POST, PUT, PATCH, DELETE, mutation RPC, or hidden write path exists in the
Health route module.

OpenAPI check passed. Semantic comparison to the foundation is 111 current
operations versus 104 parent operations: exactly the seven GET Health
operations above were added, no existing operation was removed, and no
unrelated mutation operation or private schema key was added.

API tests passed 228/228. Unauthenticated requests and unauthorized roles are
denied; owner and ops reads are allowed. Pagination, empty, loading/error
boundaries, target, incident, candidate, H4/H5, and recommendation states are
covered by API/UI tests.

## Mutation and availability boundaries

The Health mutation guard passed. The Health admin/handoff implementation has
no runtime call path to `markProfileRevisionCandidate`, `publishProfileRevision`,
`startRollout`, `changeRolloutPercentage`, `pauseProfileRollout`,
`resumeProfileRollout`, `completeRollout`, or `rollbackProfileAssignment`.

The advisory recommendation contract remains bounded to provider, surface,
variant, profile revision, browser family/version scope, monitoring layer,
evaluation identity, incident identity, bounded evidence references, freshness
authority, and timestamps. It has `executionAuthority: false`. Exact scope or
freshness mismatch returns `STALE`; no direct availability/product mutation is
performed. The Health suite passed 124/124, including stale and scope guards.

## Admin UI and privacy

The admin UI exposes `/health`, `/health/[targetId]`, and
`/health/incidents/[id]` as read-only views. It includes authorization,
loading, empty, error, pagination, target, incident, candidate, H4/H5, and
recommendation states and has no mutation controls. Admin UI tests passed
153/153 and the production admin build passed.

The API/UI projections allow only opaque IDs, statuses, safe hashes, profile
revision IDs, machine keys, provider/surface/browser metadata, contour state,
bounded evidence references, and timestamps. No cookies, storage state, auth
headers, passwords, tokens, OTPs, technical session handles, conversation IDs,
assistant response text, raw DOM, seller data, or raw profile payload is
exposed. The OpenAPI schema scan found no private projection keys.

## Validation matrix

- Full integration pass #1: PASS, 45/45 files, 1,578/1,578.
- Full integration pass #2: PASS, 45/45 files, 1,578/1,578.
- Health full suite: PASS, 124/124.
- Health runner: PASS, 302/302.
- DB unit: PASS, 12/12.
- Focused Health PostgreSQL evaluation/incident/migration/scheduler/admin-read:
  PASS, 31/31.
- Admin auth: PASS, 46/46.
- API: PASS, 228/228.
- Admin UI: PASS, 153/153.
- Recursive workspace typecheck: PASS.
- OpenAPI check: PASS, 111 operations with the semantic delta above.
- API, worker, health-runner, portal, and admin builds: PASS.
- `pnpm lint`: PASS.
- `pnpm format:check`: PASS.
- `pnpm docs:check`: PASS.
- `pnpm bridge:guard`: PASS.
- `git diff --check`: PASS.
- Clean fresh-database `pnpm db:migrate`: PASS; 20 migration rows and
  `health_profile_evaluations` present.
- No live LLM calls and no real sends.
- Existing E2E inventory has no Health-admin navigation/route scenario; no
  unrelated live-browser LLM probing was run.

## Stream-1 ownership

`OWNED_BY_PARALLEL_STREAM_1` remains the actual product-runtime enforcement of
the advisory recommendation. The current consumer boundary is:

- `packages/server/bootstrap/src/ai-resolution.ts`
- `packages/server/bootstrap/src/index.ts`
- `packages/server/adapter-registry/src/index.ts`

Future Stream-1 behavior must consume exact provider/surface/variant/profile
revision/browser/monitoring identity, fail closed on stale or missing identity,
and add exact-scope integration tests. No product enforcement was implemented
in R3, and no Stream-1 runtime files changed.

## Deferred ledger and verdict

`ENVIRONMENT_DEFERRED`:

- Stream-2 publication credentials.
- Provisioned technical LLM sessions for future authenticated live validation.
- Ozon/WB S2-A1 public-document protection.

`OWNED_BY_PARALLEL_STREAM_1`:

- Actual product-runtime enforcement of the Health availability/restriction
  recommendation.

The PostgreSQL integration-harness item is removed from the deferred ledger:
two clean isolated canonical runs passed.

Verdict: `IMPLEMENTED_CANDIDATE` pending architect acceptance. From
Stream-2 ownership perspective, S2-L7 / P8.6 is complete and ready for
architect acceptance. This receipt does not self-accept the work and does not
start S2-L8.
