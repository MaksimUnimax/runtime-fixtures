# Stream-2 A7–A10 API-watch closure

The Stream-2 API-watch boundary is advisory. It never edits marketplace
adapters, enables or disables product operations, changes `READ_POLICY`, or
changes Stream-1 execution authority.

## A7 product crosswalk

The crosswalk statically parses the current Ozon registry at
`apps/extension/src/imported/ozon-v0.1.22/shared/ozon_operation_registry.js`
and the pinned Wildberries registry at
`migration/reference/wildberries-v0.3.0/runtime/shared/wb_operations.js` with
the TypeScript AST parser. Registry JavaScript is never executed. Identity is
`SOURCE_FAMILY + UPPERCASE_METHOD + NORMALIZED_PATH`; aliases are metadata.

Rows are `MAPPED_ENABLED`, `MAPPED_DISABLED`, `SOURCE_ONLY`, `RUNTIME_ONLY`,
or `AMBIGUOUS_RUNTIME_MAPPING`. Review output is limited to
`NO_ACTION`, `REVIEW_REQUIRED`, and `BLOCKING_RISK`.

## A8 incidents

Incidents are durable, keyed by stable scope, and deduplicated while open.
Repeated observations increment occurrence count without repeating an OPEN
notification. Only a new OPEN and a valid COMPLETE comparable recovery may
produce notifications. Partial, blocked, failed, and missing-authority
observations do not resolve operation incidents. Incident evidence stores safe
codes and references, never source documents or private Telegram content.

## A9 retry policy

Retries reuse the durable `SWAGGER_API` lane. Network, timeout, and HTTP 5xx
failures retry after 15 minutes and then 60 minutes. HTTP 429 gets at most one
retry; `Retry-After` is clamped to 5 minutes–6 hours, or defaults to 60
minutes. Missing official URL authority, operator handoff, invalid documents,
authority review/rejection/blocking, and semantic/product changes are not
retried. Retry scheduling moves the existing lane earlier without changing
the configured interval or creating a timer loop.

## A10 automated acceptance

`pnpm --filter @product/api-watch acceptance` runs a deterministic local
fixture through snapshots, inventory, diff, impact, crosswalk, report,
incidents, and retry decisions. It also extracts all three current product
registries and verifies the production configuration truthfully remains
blocked because official URL authority is absent for `OZON_SELLER`,
`OZON_PERFORMANCE`, and `WILDBERRIES`. That blocked state is a source
authority condition, not an internal FAILED run, creates no TG3 request and
no retry, and does not claim live provider monitoring.

Database integration remains environment-dependent when `DATABASE_URL` is not
available; migrations 0028, 0029, and 0030 are still covered by offline
migration receipts.
