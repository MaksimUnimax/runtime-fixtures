# S2-O3 LLM Health notification operational visibility R1

Status: bounded implementation candidate; architect acceptance is pending.

## Scope

This R1 advances only the LLM Health notification intent and delivery
read-only operational visibility foundation. It does not complete S2-O3. API
watch operational visibility remains dependency-blocked, so the roadmap
status remains `S2-O3 = PARTIAL / LLM_VISIBILITY_FOUNDATION`.

The implementation continues the accepted O2 ancestry:

- final O2 head: `90fc4bc9bf73cdd5cebe0066cd7754ea595cf2c4`;
- tree: `815e79ff97e947081a0e0e4c78747e42679f3421`;
- parent: `f728c18d105df48c8cbc62215f57f9133c793c44`;
- accepted LLM Health head: `7ec0693e7e8149ae8d9c50ad41c237a23a34bd86`.

No API-watch semantics, generic cross-domain incident model, real provider,
notification mutation control, or Stream-1 product runtime change is part of
this work.

## Existing Health admin reuse

The routes reuse the accepted Health admin read/security plane and the
existing `health.read` permission. `ADMIN_OWNER` and `ADMIN_OPS` are allowed;
`ADMIN_SUPPORT`, `ADMIN_BILLING_READONLY`, and `ADMIN_BETA_OPERATOR` remain
denied. No new permission or mutation permission was added.

## Read models and projection

`HealthNotificationIntentSummary` exposes only bounded operational fields:

- intent ID, `LLM_HEALTH` source, incident ID, event kind, severity, state,
  abstract route key, provider/surface labels;
- grouping count, observed window, cooldown deadline, attempt count, next
  attempt, delivery timestamp, suppression reason, and timestamps;
- typed safe provider result code and sink identity.

`HealthNotificationIntentDetail` additionally exposes:

- non-secret dedup scheme metadata;
- claimed/unclaimed state, lease expiry, and attempt number without owner or
  lease token;
- source Health run/state/level/target metadata;
- the existing Health incident projection;
- at most 32 existing safe evidence references;
- retention class and nullable expiry metadata.

Raw notification payloads, dedup keys, claim owners/tokens, provider delivery
IDs, provider response bodies, destination identifiers, credentials, and
unbounded error text are not projected.

## API

Both operations are GET-only and use `health.read`:

- `GET /v1/admin/health/notifications`
- `GET /v1/admin/health/notifications/:id`

The list uses deterministic cursor pagination ordered by `created_at DESC,
id DESC`, with a maximum limit of 50. The cursor contains only the ordered
timestamp and UUID tie-breaker. Supported bounded filters are state, event
kind, severity, incident ID, provider, surface, and route key. Invalid cursors
and limits use the existing API validation envelope.

The detail query joins one incident and one source Health run. Evidence is a
single bounded follow-up query limited to 32 references, not an N+1 page fan
out. No migration was added; the O2 `0022_s2_o2_llm_health_notification_intents.sql`
schema already contains the required fields. No speculative index was added.

OpenAPI was regenerated. The semantic delta is two new paths and two GET
operations: 111 existing operations became 113. No POST, PATCH, PUT, or
DELETE notification operation is present.

## UI

The existing Health admin now has:

- `/health/notifications` for the bounded list;
- `/health/notifications/[id]` for the read-only detail.

The UI covers loading, empty, error, forbidden, paginated list, and detail
states. It displays state, event kind, severity, incident, provider/surface,
grouping, cooldown, attempts, next retry, delivered time, suppression reason,
route key, safe result code, sink truth, evidence references, retention, and
timestamps. There are no action controls.

Current accepted O2 sink truth is represented as deterministic test sink or
disabled sink. The UI does not claim email, Slack, Telegram, or another real
provider.

## Incident, noise, and maintenance semantics

Notification state is observational. A failed or delivered notification does
not rewrite Health incident state. Recovery notifications link to the
Health-owned incident and show its already-resolved state when present.

Grouping count, first/latest observation, and cooldown deadline make repeated
failure suppression understandable. `COOLDOWN`, `MAINTENANCE_ENTERED`, and
`DISABLED_ROUTE` remain distinct typed reasons. `UNKNOWN` Health/environment
states do not fabricate notification rows.

## Mutation guard and privacy

Admin code receives only `HealthNotificationAdminReadRepository` with
`listNotifications` and `getNotification`. It cannot call O2 worker methods
`claimDue`, `markDelivered`, or `failClaim`, nor delivery/retry/suppression or
provider-send methods. Route registration exposes only GET handlers.

Allowlisted API/UI projections exclude cookies, storage state, tokens, auth
headers, passwords, OTPs, session handles, personal destinations, webhook
URLs, private conversation IDs, assistant content, raw DOM, seller/customer
payloads, and provider response bodies.

## Validation

Focused validation covers Health schemas and mutation guard, Health admin API
auth/limits/cursor/not-found/read-only behavior, OpenAPI path and artifact
checks, admin UI projection/control guards, and PostgreSQL 18 integration for
stable equal-timestamp ordering, cursor pagination, filters, bounded joins,
safe detail projection, and absence of mutation methods.

Existing accepted O2, Health, incident, scheduler, worker, and integration
gates remain regression scope; no live LLM calls or external sends are used.

## Dependencies and remaining S2-O3 work

S2-O1 remains blocked because API incident semantics are not mature. This R1
does not create generic monitoring-event or incident-v2 abstractions and does
not add API-watch rows or routes. The remaining S2-O3 work is API-watch
operational visibility after its source and incident dependencies mature,
followed by any architect-defined cross-domain dashboard criteria.

## Deferred ledger

`ENVIRONMENT_DEFERRED`:

- remote Stream-2 publication/readback;
- no provisioned technical LLM sessions;
- S2-A1 provider source access protection.

`OWNER_EXTERNAL_ACTION_DEFERRED`:

- future real notification provider selection and credentials.

`OWNED_BY_PARALLEL_STREAM_1`:

- product-runtime enforcement of Health recommendations.
