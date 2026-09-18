# S2-L7 / P8.6 Health admin and availability handoff R2

## Completion state

This branch is an `IMPLEMENTED_CANDIDATE` for the Stream-2-owned P8.6
foundation. It adds bounded, read-only Health operational visibility and a
non-executing availability/restriction handoff. It does not start S2-L8,
send notifications, mutate P7 lifecycle state, or change Stream-1 runtime
resolution.

## Ancestry and preflight

- Starting accepted commit: `fb23e67d0cfb3cb31ebb364d98a591364a783db4`.
- Starting tree: `6d423d6e050400e50dab4801a62d7674b8882f51`.
- Parent: `44954d71d28257d885feaa270526abcf72fb04e3`.
- Remote preflight after fetch: `origin/main`=`bc718cc5c677ad0eb4598e7de3ad766473ff0847`; integration=`23047b3bdc22842a5b17e29e3d3f603c0ee51b16`.
- Active worktrees were audited. The accepted H4/H5 worktree and L6 incident/scheduler lineages were preserved; no migration was added.
- The host initially exposed Node 12 and no `pnpm`. Validation used a disposable Node 24.8.0 binary with pnpm 10.34.5; the repository requires Node `>=24 <25` and pnpm `>=10.34.5 <11`. A clean disposable PostgreSQL 18 instance was provisioned for the read-composition integration and removed after validation.

## Admin authority audit

P6 `AdminAuthService`, the existing admin session cookies, CSRF implementation,
`createAdminRouteGuard`, error envelope, no-store policy, and role-derived
permissions are reused. The smallest additive permission is `health.read`.
It is granted to `ADMIN_OWNER` through the existing owner permission set and to
`ADMIN_OPS`; it is not granted to support, billing-readonly, or beta-only roles.
There is no `health.manage` permission and no Health mutation route.

P7 `packages/server/admin-ai` remains the product-owned read/mutation surface.
Health admin uses a separate read composition repository and has no dependency
on P7 mutation methods.

## Read model

`packages/server/health/src/admin.ts` defines strict bounded models for target
summary/detail, incident summary, profile evaluation summary/detail,
recommendations, safe evidence references, and current/candidate profile
revision projections. The DB adapter composes Health runs, schedules,
incidents, evaluations, evidence metadata, registry identity, and current P7
assignment/profile revision IDs. Profile executable content, DOM, assistant
content, cookies, storage state, auth headers, and technical session handles
are not projected.

Current baseline is the current assignment baseline revision. Candidate is only
the current assignment candidate revision; absent candidates are represented by
`NO_CANDIDATE`. A stale evaluation remains visible as historical with
`currentAuthority=false`; it cannot become the current candidate authority.
H5 canary and H5 post-rollout phases remain distinct. Candidate success does
not resolve a production incident; only the accepted Health recovery lifecycle
does that.

## API

Read-only routes, all under the existing admin namespace and protected by
`health.read`:

- `GET /v1/admin/health/targets`
- `GET /v1/admin/health/targets/:target_id`
- `GET /v1/admin/health/incidents`
- `GET /v1/admin/health/incidents/:id`
- `GET /v1/admin/health/evaluations`
- `GET /v1/admin/health/evaluations/:id`
- `GET /v1/admin/health/recommendations`

All list routes use a default limit of 25 and a hard maximum of 50, with
bounded cursors and only provider/surface/state/phase/profile/browser/active
filters. Responses are strict and `cache-control: no-store`. OpenAPI was
updated and checked.

## Availability/restriction handoff

The Health-side recommendation contract includes:

`provider`, `surface`, `variant`, `profileRevisionId`, `browserFamily`,
`browserVersionScope`, `monitoringLayer`, `recommendation`, `reasonCode`,
`severity`, `evaluationId`, `evaluationKey`, `incidentId`, bounded
`evidenceReferences`, `issuedAt`, `evaluationRevision`,
`freshnessAuthority`, and `executionAuthority: false`.

Consumer vocabulary is `NO_RESTRICTION_SIGNAL`, `ADVISORY_HOLD`,
`SCOPED_RESTRICTION_RECOMMENDED`, `ROLLBACK_RECOMMENDED`, `INCONCLUSIVE`, and
`STALE`. The source H4/H5 vocabulary remains `CONTINUE`, `HOLD`, `RESTRICT`,
`ROLLBACK_RECOMMENDED`, and `INCONCLUSIVE`.

The pure `deriveHealthAvailabilityRecommendation` reader requires exact
provider, surface, variant, profile revision, browser family/version, and
monitoring-layer identity. Any mismatch returns `STALE`; no product state is
rewritten. A Chrome-only or Work-only finding remains scoped to that exact
browser/surface/variant.

## Product boundary

Actual product enforcement would require a Stream-1-owned consumer in the
profile-resolution/bootstrap/assignment path. The current product consumer is
`packages/server/bootstrap/src/ai-resolution.ts`
(`resolveBootstrapAiSnapshot`/`BootstrapAiResolutionRepository`), wired through
`packages/server/bootstrap/src/index.ts`, with assignment selection and profile
identity types in `packages/server/adapter-registry/src/index.ts`. Stream 2
does not modify those paths. Stream 1 must consume the Health contract above,
fail closed on stale/missing identity, and test exact
profile/provider/surface/variant/browser matching before any future behavior
change. No product assignment, profile, rollout, publish, pause, resume,
complete, rollback, bootstrap, or dispatch mutation is performed here.

## UI

`/health` reuses the existing admin shell and displays target state, browser,
last observation, active incident, baseline/candidate IDs, H4/H5 result, and
recommendation. Target detail displays contour summaries, current/candidate
fingerprints, evaluations with current/stale authority, incident state, safe
evidence metadata, and `executionAuthority=false`. Incident detail preserves
the Health lifecycle distinction. Loading, empty, error, authorization, and
read-only states are covered by the existing shell patterns. There are no
mutation buttons.

## Tests and validation

RED-first tests were added for bounded pagination, privacy projection, exact
scope and stale handoff behavior, no mutation repository surface,
unauthenticated denial, ordinary-role denial, owner access without CSRF for
GET, and absent Health mutation routes. The admin UI boundary also verifies
the read-only target/detail surface and absence of mutation controls. Health
full suite passed 124 tests; DB unit suite passed 12 tests; PostgreSQL Health
evaluation/incident/scheduler/admin composition suites passed 4/7/17/1 tests;
the API suite passed 228 tests across 19 files; admin-auth passed 46 tests;
admin UI passed 153 tests; health-runner passed 302 tests; OpenAPI passed 3
tests. Recursive typecheck, API/admin builds, lint, format, docs, bridge guard,
and diff checks passed. The full repository PostgreSQL integration harness was
also attempted; its parallel schema-reset suites drove the disposable
database into recovery mode after 840 tests had passed, so that harness is
recorded as an environment/concurrency failure. Its stale migration-count and
pre-Health OpenAPI assertions were updated to the accepted 20-migration and
111-operation repository state. No live LLM calls, authenticated Health
sessions, or real sends were used.

## Privacy and deferred ledger

API/UI allowlists contain only identifiers, statuses, timestamps, browser and
provider/surface metadata, profile fingerprints, contour outcomes, and bounded
evidence references. No raw evidence bytes or private content are exposed.

Real unresolved items:

- `ENVIRONMENT_DEFERRED`: Stream-2 publication credentials.
- `ENVIRONMENT_DEFERRED`: provisioned technical LLM sessions for future
  authenticated live validation.
- `ENVIRONMENT_DEFERRED`: Ozon/WB S2-A1 public-document access protection.
- `OWNED_BY_PARALLEL_STREAM_1`: future product-runtime enforcement of this
  advisory contract, if/when product behavior is authorized to consume it.

## P8.6 verdict

`IMPLEMENTED_CANDIDATE`, pending architect acceptance. From Stream-2 ownership
perspective, the Health-side S2-L7/P8.6 contract is complete. Runtime
enforcement remains an explicit Stream-1 integration dependency and was not
implemented in this branch.
