# S2-O3 LLM aggregate diagnostics R3 — 2026-09-19

Status: IMPLEMENTED_CANDIDATE pending architect acceptance. This is an LLM
Health-only operational read surface. It does not complete full S2-O3 because
API-watch operational incident semantics remain unavailable.

## Ancestry and boundaries

- Base accepted O3 R2: `898b69b1a22a14672ac9dfb0a11d830bda1e2bcb`
- Base tree: `4695ef45006d28314d650d5d210afee9036b8793`
- Base parent: `8053f61cc9dbb32f597d0a5ccac5644901dd899e`
- Accepted O2: `90fc4bc9bf73cdd5cebe0066cd7754ea595cf2c4`
- Accepted final LLM Health lineage: `7ec0693e7e8149ae8d9c50ad41c237a23a34bd86`

The implementation composes existing `health_runs`, Health target/suite
identity, `health_incidents`, `health_contour_results` only through durable
incident root identity, H4/H5 evaluation records, notification intents,
`health_schedules`, and `health_scheduled_runs`. There is no diagnostics table
and no migration. Existing target, incident, evaluation, notification, and
scheduler authorities remain authoritative.

## Metrics and windows

The strict query schema accepts only `1h`, `24h`, `7d`, and `30d`; the default
is `24h`. Every aggregate uses `windowStart <= observation < windowEnd`.
Current-target lookup is additionally capped at the last 30 days so a read
cannot become an unbounded historical scan. Results expose `generatedAt`, the
explicit window, `latestHealthObservationAt`, and `stale`.

Health states remain six separate values: `HEALTHY`, `DRIFT`, `DEGRADED`,
`BROKEN`, `UNKNOWN`, and `MAINTENANCE`. Product-quality counts contain the
first four; environment/maintenance counts contain `UNKNOWN` and `MAINTENANCE`.
No percentage is displayed. A current target older than the selected window is
`NO_RECENT_RUN`; unsupported browser coverage is not emitted as `HEALTHY` and
the UI labels missing coverage `NOT_COVERED`.

Breakdowns preserve provider, exact surface (including Standard vs Work),
variant, browser family/version, exact profile revision and content hash, and
accepted incident root/status/provider/surface dimensions. Profile results are
observational and do not claim causation. Incident durations use only
`first_seen_at`, `last_observed_at`, and `resolved_at`; median duration is
computed deterministically from those accepted timestamps.

## Read model and API

The monitoring-specific `HealthDiagnosticsReadRepository` has only:

- `getSummary`: bounded current targets, six state counts, product/environment
  counts, active incident count, notification queue summary, and scheduler
  liveness;
- `getBreakdown`: provider/surface/variant, observed browser coverage, exact
  profile revision, and incident-root aggregates.

Routes are GET-only and reuse `health.read`:

- `GET /v1/admin/health/diagnostics/summary`
- `GET /v1/admin/health/diagnostics/breakdown`

Supported filters are the fixed window plus provider, surface, browser family,
browser version, profile revision, Health state, and incident status. Responses
are capped at 50 current targets and 100 rows per breakdown. They contain no
evidence references, payloads, raw logs, account/user/conversation identity,
provider response bodies, or notification destinations.

Notification counts reuse accepted O2/O3 intent states and distinguish pending,
claimed, retryable, terminal, suppressed, and delivered. Scheduler execution
state is reported separately; scheduler failures are never converted into a
Health state or incident.

## UI and mutation guard

The read-only page is `/health/diagnostics`. It shows freshness, state counts,
provider/surface observations, current target state, browser coverage, profile
revision observations, incident roots, notification counts, and scheduler
separation. It has no mutation controls.

The API receives a read-only diagnostics repository. No incident mutation,
scheduler mutation, notification claim/finalize, profile lifecycle, provider
send, availability enforcement, or “last viewed” write is reachable from the
GET routes.

## Validation record

Added red-first coverage for diagnostics RBAC, fixed-window rejection, GET-only
behavior, and UI privacy/misleading-metric boundaries. Existing accepted
notification, incident, scheduler, Health, and admin RBAC tests remain in the
matrix. Focused route, Health schema, and UI tests pass; recursive workspace
tests pass; recursive typecheck, API/worker/health-runner/portal/admin builds,
lint, bridge guard, format, docs, OpenAPI, and diff checks pass.

The real PostgreSQL 18 diagnostics fixture passed 2/2 tests with exact state,
surface, browser, profile, incident, notification, scheduler, privacy, and
read-only assertions. The first canonical integration pass reached 46/47 files
and 1587/1588 tests; its only failure was the expected OpenAPI operation count
remaining at 113 after the two new GET routes. After correcting that baseline,
the second canonical pass reached 39/47 files and 1555/1588 tests before the
host root filesystem exhausted space; its failures were PostgreSQL
`No space left on device` errors, not diagnostics assertions. The task-owned
database was dropped afterward; unrelated owner data and shared Docker volumes
were not pruned. No live LLM call or notification send is used.

OpenAPI changed from 103 paths / 113 operations to 105 paths / 115 operations:
exactly the two diagnostics GET operations above, with no mutation operation.

## Non-interference and remaining work

- S2-O1 remains blocked; no generic `MonitorAggregate`, `UnifiedIncident`, or
  `UnifiedAlert` was introduced.
- `tooling/api-watch/**` is untouched and no API-watch data is displayed.
- Stream-1 product runtime paths are untouched.
- S2-A1 remains blocked for Ozon Seller, Ozon Performance, and Wildberries
  source authority; unchanged acquisition is not retried.
- Real notification provider selection and credentials remain deferred.
- A complete post-correction canonical integration pass remains environment-
  deferred until host root-disk pressure is relieved safely.
- The next dependency-correct Stream-2 action after acceptance is API-watch
  incident maturity assessment, not S2-O1 implementation.
