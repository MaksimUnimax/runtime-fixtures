# M1-C detailed funnel foundation — 2026-09-21

Work ID: `M1-C-20260921-DETAILED-FUNNEL-AND-COMMERCIAL-ANALYTICS-FOUNDATION`

This is a bounded Stream-1 implementation candidate. It does not enable
commercial access, checkout, billing, third-party analytics, or live
measurement. Codex does not self-accept it.

## Git and boundaries

- Start: `13fefe9ec038d1a1cc161a03c70fbf395dcc59e6`, tree
  `474ab419878f87898412e9e70668f4361a46a264`.
- Worktree/branch: `feature/m1c-detailed-funnel-foundation-2026-09-21`.
- SMTP/Exim, Stream-2 paths, Business Bridge, live deployment and publication
  were left untouched.
- Node parity: `v24.20.0`, pnpm `10.34.5`.

## Initial gap batch

The reachable pre-change gaps were `FUNNEL_DEFINITION_GAP`,
`SIGNAL_SCHEMA_GAP`, `SIGNAL_DUPLICATION_GAP`, `IDEMPOTENCY_GAP`,
`FUNNEL_ORDERING_GAP`, `TIME_TO_VALUE_GAP`, `VERSION_DIMENSION_GAP`,
`BROWSER_DIMENSION_GAP`, `MARKETPLACE_DIMENSION_GAP`, `COMMERCIAL_FUNNEL_GAP`,
`ADMIN_QUERY_GAP`, `DELETION_PRIVACY_GAP`, and `MIGRATION_GAP`. B2 had
milestone rows and raw aggregates, but no deterministic versioned funnel math,
safe subject identity, retry boundary, or funnel API/UI. No Stream-2, SMTP,
billing, or free-beta UX defect was changed.

## One signal authority and safe envelope

M1-C reuses B2-A `feedback_signal_events`; migration `0020_m1c_funnel_signals.sql`
adds fields to that table and does not create a second telemetry system.
Signals use server timestamps and verified account/device membership. A unique
idempotency key plus payload hash detects conflicting reuse. Account-level first
milestones use an advisory lock and partial unique index, so concurrent retries
produce one effective milestone.

Stored metadata is limited to event/schema version, account/device/subject
references, timestamps, idempotency/hash, product/extension/release identity,
browser family/version, marketplace enum, category/status, and safe support
code. Raw seller reports/files, AI bodies, provider payloads, marketplace
credentials, cookies/storageState, OTP/email content, transfer/backup data,
payment instruments, and raw payment webhooks are not stored.

## Canonical funnels and semantics

1. `ONBOARDING`: `registration_started → account_created → device_activated → first_store_added → first_start`.
2. `FIRST_VALUE`: `account_created → device_activated → first_store_added → first_start`.
   `first_successful_result` is not fabricated because current safe metadata
   cannot prove it without forbidden payload collection.
3. `SUPPORT`: `feedback_case_created → feedback_case_triaged → feedback_case_resolved → feedback_case_closed`.

Onboarding/first-value cohorts are distinct accounts; support cohorts are
distinct case subjects. First milestones are earliest per account. Additional
devices, stores, and marketplaces do not create another account milestone;
marketplace breakdowns do not inflate global counts.

For UTC half-open `[from,to)`, the entry cohort is entities with the first
stage in the window. `reachedCount(stage)` is the distinct cohort entity with
that stage at or after entry. Previous-stage conversion is
`reached(stage) / reached(previous stage)`; cumulative conversion is
`reached(stage) / cohortCount`. Empty denominators are `null`. Time-to-value is
entry-to-stage duration; median uses the midpoint for an even sample and p90
uses a bounded nearest-rank percentile. Default is the preceding 30 UTC days;
bounded `1D`, `7D`, `30D`, and explicit increasing UTC intervals are supported.
Filters include product, extension, release, browser family/version,
marketplace, and safe support code.

## Support, commercial compatibility and autonomy

Support analytics use the B2 case status lifecycle and safe case subject,
category, browser/version, marketplace, and support-code dimensions. The
admin-only `GET /v1/admin/support/funnels` endpoint and Support-page selector
expose aggregate stages, conversion, time-to-value, and safe breakdowns under
existing `support.aggregate.read` permission. Ordinary users have no platform
analytics route.

Future normalized commercial stage names can be represented at the contract
boundary, but are not current runtime events: there is no checkout, payment
provider, subscription requirement, or fake commercial event. Analytics is not
required for Work, delivery, or offline signed authority; no per-command call
or heartbeat was added. B2 retention remains configurable at 180 days for
signals/aggregates and 90 days after closed support cases. Account
anonymization clears identifying signal references; only non-identifying
derived data may remain under existing policy.

## Tests and recommendation

- Funnel unit tests: 6 passed; B2 service tests: 10 passed.
- PostgreSQL feedback/support integration: 3 passed, including concurrent
  idempotency, funnel query, and signal anonymization.
- API: 19 files / 231 tests passed; OpenAPI regenerated and checked.
- Migration 0020 applied to disposable PostgreSQL; Node 24 workspace
  typecheck passed. No real traffic or live measurements are claimed.

Recommendation: `M1C_READY_FOR_ARCHITECT_ACCEPTANCE` — recommendation only,
not self-acceptance.
