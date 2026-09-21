# B2 feedback / support / iteration foundation

Work ID: `B2-A-20260921-SAFE-FEEDBACK-SUPPORT-AND-ITERATION-FOUNDATION`

This is a bounded, non-live product foundation. It does not publish a browser
package, start production traffic, add billing, change SMTP/Exim, or take over
Stream 2 monitoring.

## Git and scope

- Source accepted base: `6de8247a423590f640e1538b0ea4c06b69c4e508`
- Source tree: `e127f5d97fad81924d4bd27b07fbbe60baf95bd0`
- Worktree: `/root/runtime-fixtures-b2`
- Branch: `feature/b2-feedback-support-2026-09-21`
- Active SMTP/Exim worktree was not touched.
- Stream-2 implementation paths were not touched.

The final commit/tree are recorded in the terminal handoff after the bounded
commit. No reset, rebase, amend, force push, or destructive cleanup was used.

## Initial gap batch

The reachable initial gaps were:

| Classification | Finding |
|---|---|
| `FEEDBACK_API_MISSING` | No authenticated feedback/case API existed. |
| `FEEDBACK_UI_MISSING` | No portal or support case UI existed. |
| `SUPPORT_WORKFLOW_MISSING` | No finite case status workflow existed. |
| `DIAGNOSTIC_REDACTION_GAP` | No B2 structured diagnostic envelope or persistence boundary existed. |
| `RETENTION_GAP` | No case/signal retention or account anonymization mechanism existed. |
| `AGGREGATION_GAP` | No onboarding/support aggregate event store or query existed. |
| `RELEASE_LINKAGE_GAP` | No case linkage to product/extension/browser/release identity existed. |
| `RATE_LIMIT_GAP` | No feedback/follow-up abuse limits existed. |
| `DOCUMENTATION_GAP` | No B2 operational receipt or user/support procedure existed. |

The existing Q1-D admin authority, audit model, account ownership checks and
diagnostic privacy rules were reusable; they were extended rather than forked.

## Data model and API

Migration `0019_b2_feedback_support.sql` adds:

- `feedback_cases`, with account/user/device ownership, finite category,
  severity/status, bounded description, safe diagnostics, version/browser/
  marketplace/release metadata, assignment and resolution metadata;
- `feedback_followups`, bounded user/support/admin notes;
- `feedback_signal_events`, bounded product-operational events;
- singleton `feedback_retention_config`, seeded to 90/180 days.

The API is provider-neutral and has no mail dependency:

- portal: `POST/GET /v1/support/cases`, case detail, user follow-up, and
  explicit onboarding signal submission;
- admin/support: case list/detail, finite status transition, staff follow-up,
  and aggregate reads;
- portal state-changing routes require the existing double-submit CSRF proof;
  admin mutations use the existing Q1-D admin CSRF guard;
- all support/API responses are `no-store`.

Categories are the fixed B2 vocabulary: `INSTALLATION`, `AUTH`, `OTP`,
`STORE`, `OZON`, `WILDBERRIES`, `AI`, `COMMAND`, `REPORT`, `FILE_RESULT`,
`SYNC`, `TRANSFER`, `BACKUP`, `BROWSER_COMPAT`, `SERVER_UNAVAILABLE`,
`VERSION_INCOMPATIBLE`, `OTHER`.

Status transitions are explicit:

`NEW → TRIAGED | NEEDS_INFO | RESOLVED`; `TRIAGED → NEEDS_INFO | RESOLVED`;
`NEEDS_INFO → TRIAGED | RESOLVED`; `RESOLVED → CLOSED | NEEDS_INFO`;
`CLOSED` is terminal.

## Authority, privacy and abuse controls

- A user can create/read/list/follow up only their own cases.
- Support can read/manage cases and aggregate signals through the Q1-D
  permissions `support.case.read`, `support.case.manage`, and
  `support.aggregate.read`; admin retains the same full authority.
- Support permissions do not grant beta-capacity mutation, credentials,
  bearer/session secrets, raw reports, or AI content.
- Every privileged transition/follow-up is written to the existing safe audit
  model with actor, action, case ID, timestamp/correlation and result metadata;
  bodies and diagnostics are excluded.
- User case creation is limited to 5 per account/user window; follow-ups are
  limited to 20 per actor window; signal submission is bounded at 50 per user
  window using existing rate-limit storage.
- Public signal submission accepts only onboarding events. Case-created and
  case-resolved aggregates are server-generated, preventing client poisoning.
- Text is NFC-normalized, control-character filtered, length bounded and
  conservatively redacted for bearer/JWT/cookie/private-key/password and
  recognizable marketplace-secret patterns. Detection is deliberately not
  treated as a perfect secret scanner.
- Diagnostics are a strict server-validated allowlist. Arbitrary files/raw
  logs, `storageState`, cookies, raw reports, provider payloads and AI bodies
  are rejected or never accepted.
- React renders text as text; no HTML injection sink or `dangerouslySetInnerHTML`
  is used by the new portal/admin surfaces.

## Version linkage and aggregates

Cases capture safe server, portal, extension, browser and release-candidate
identity fields when supplied, plus safe error/support code and marketplace
enum. The aggregate store supports grouping/filtering by day, event, product
version, extension version, browser family, category and case status. It stores
no feedback body or seller payload.

Supported product events are `registration_started`, `account_created`,
`device_activated`, `first_store_added`, `first_start`, plus the two server-
generated case lifecycle events. This is product feedback/support aggregation,
not Stream-2 health/DOM/provider monitoring.

## Retention and deletion

Decision recorded:
`PROVISIONAL_OWNER_REVIEW-B2-FEEDBACK-RETENTION-20260921`.

- closed cases: 90 days after closure by default;
- privacy-safe aggregate events: 180 days by default;
- open cases: retained until resolution, then enter the closed-case window;
- values are reversible/configurable through `FEEDBACK_CLOSED_RETENTION_DAYS`
  and `FEEDBACK_SIGNAL_RETENTION_DAYS` (bounded to 1–3650 days), with the
  migration table documenting the defaults;
- account anonymization removes account/user/device ownership, clears
  diagnostics and replaces description with a non-identifying removal marker;
- follow-ups are removed with their case; aggregate events remain only as
  non-identifying counters/events under the configured signal retention.

No new legal policy was created.

## UI and support workflow

The portal has a minimal `Обратная связь` flow with category, bounded text,
optional safe-diagnostics consent, case result and own-case status list. The
admin portal has a Support section with status/category/version/browser/
marketplace filters, safe case detail, permitted status transitions, staff
follow-up, and aggregate JSON readout. Both surfaces render untrusted text
safely and never display secrets/raw report content.

## Security matrix

| IDs | Result | Evidence |
|---|---|---|
| B2-01..08 | PASS | API route tests and Q1-D permission guard; user ownership, support/admin authority and unauthenticated denial. |
| B2-09..18 | PASS | strict contracts, UI text rendering, bounded descriptions, rate keys, diagnostic allowlist, redaction and safe audit integration. |
| B2-19..21 | PASS | service transition tests, PostgreSQL transition persistence and safe version/release fields. |
| B2-22..24 | PASS | aggregate integration, no-body assertion, configurable retention and purge test. |
| B2-25 | PASS | PostgreSQL account anonymization test. |
| B2-26..30 | PASS | no SMTP wiring, bridge/path guard, schema/repository privacy checks and durable-storage assertions. |

The new API test file has 6 tests, the support package has 10 unit tests, the
portal/admin helper tests cover form/query behavior, and the PostgreSQL
feedback integration has 2 tests.

## Regression and gates

- Node 24.20.0 / pnpm 10.34.5: PASS.
- Workspace typecheck: PASS.
- Workspace lint and Business Bridge guard: PASS.
- API, worker, health-runner, portal and admin builds: PASS.
- Workspace unit suites: PASS; final API suite 19 files / 231 tests.
- PostgreSQL feedback integration: 2/2 PASS.
- PostgreSQL persistence integration: 3/3 PASS.
- Full server PostgreSQL integration: 41 files, 1,535 tests, PASS after
  updating the truthful migration-0019/OpenAPI-124 acceptance fixtures.
- OpenAPI generation/check and portal/admin UI tests: PASS.
- No SMTP/Exim or Stream-2 implementation change: PASS.

The first full integration run exposed only stale expectations for migration
count 19 versus the new truthful count 20 and OpenAPI operation count/hash;
those acceptance fixtures were updated to reflect B2's additive API/migration.

## External and remaining B2 work

B2-A itself has no required external dependency and does not require working
SMTP. Real beta traffic, owner mailbox OTP, live owner sessions, browser-store
publication and Stream-2 monitoring remain separately governed gates. Future
B2 iteration can add richer triage/search and owner-approved retention changes
without changing the current privacy boundary.

## Recommendation

`B2A_READY_FOR_ARCHITECT_ACCEPTANCE`

This is a recommendation only; Codex does not self-accept B2-A.
