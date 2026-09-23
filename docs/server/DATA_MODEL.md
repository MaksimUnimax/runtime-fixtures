# Product Control Plane — Data Model

Status: logical schema authority before migrations  
Date: 2026-09-03

This document defines logical entities and invariants. Physical table/column names may be refined during P1/P2, but semantic boundaries require an ADR to change.

## 1. Identity / accounts

### `users`

Represents a human identity.

Key fields:

- `id` UUID;
- `status`;
- `created_at`;
- `updated_at`.

Do not put subscription/device state directly on user.

### `user_identities`

External/login identities.

Fields:

- `id`;
- `user_id`;
- `provider` (`email`, future oauth providers);
- normalized provider identifier;
- verified state;
- timestamps.

Unique on provider + normalized identifier.

### `accounts`

Commercial tenant/customer unit.

Fields:

- `id`;
- `status`;
- display metadata;
- created/updated timestamps.

### `account_memberships`

Maps users to accounts and role.

Initial product can still create one account/owner per user, but schema supports future teams.

## 2. OTP/authentication

### `otp_challenges`

Fields:

- `id`;
- purpose;
- normalized identity target;
- verification hash/artifact;
- attempt counters;
- expires_at;
- consumed_at;
- created_at;
- risk/rate-limit metadata references as needed.

No plaintext OTP persisted.

### `beta_admission_state`

The singleton (`id = 1`) stores `mode` (`CLOSED`, `OPEN`, `PAUSED`), integer
`capacity`, cumulative integer `admitted`, positive `revision`, and
`updated_at`. Database checks enforce `0 <= admitted <= capacity` and the
singleton key. Production starts at `CLOSED`, capacity `0`, admitted `0`.

### `beta_admissions`

Durable one-per-account admission membership with unique account and user
references plus `admitted_at`. It is not decremented automatically when an
account is suspended or removed.

### `otp_verify_replays`

Stores a challenge reference, HMAC idempotency identity, user/session
references, and expiry. It contains no plaintext OTP, idempotency key, or
portal token. Challenge uniqueness permits replay only for the same committed
verification attempt.

### `beta_admission_mutations`

Idempotent admin mutation ledger keyed by HMAC request identity. It records
safe action, actor, old/new mode/capacity/admitted/revision, and the resulting
state timestamp; the separate audit event records the bounded reason and
correlation identity.

## 3. Devices and sessions

### `devices`

Fields:

- `id`;
- `account_id`;
- created_by_user_id;
- status (`PENDING`, `ACTIVE`, `REVOKED` etc.);
- label/display metadata;
- browser_family;
- browser_version_last_seen;
- extension_version_last_seen;
- created_at;
- activated_at;
- last_seen_at;
- revoked_at;
- revoke_reason.

### `device_authorizations`

Fields:

- `id`;
- device_code hash;
- user_code verification representation;
- requested client/browser metadata;
- status (`PENDING`, `APPROVED`, `DENIED`, `EXPIRED`, `EXCHANGED`);
- approved_account_id/user_id;
- expires_at;
- approved_at;
- exchanged_at.

Single-use exchange enforced transactionally.

### `sessions`

Fields:

- `id`;
- `device_id`;
- `account_id`;
- status;
- token family identifier;
- created_at;
- last_refreshed_at;
- revoked_at;
- revoke_reason.

### `refresh_tokens`

Fields:

- `id`;
- `session_id`;
- token hash;
- generation/rotation sequence;
- issued_at;
- expires_at;
- consumed_at;
- replaced_by_token_id;
- reuse_detected_at.

Unique hash. Rotation happens in one transaction.

## 4. Plans / prices / entitlements

### `plans`

Stable logical product identity.

Fields:

- `id`;
- stable code;
- status (`DRAFT`, `ACTIVE`, `HIDDEN`, `ARCHIVED`);
- created_at.

### `plan_revisions`

Immutable after publish.

Fields:

- `id`;
- `plan_id`;
- revision number;
- display name/description metadata;
- publish/effective timestamps;
- status;
- created_by.

Unique `(plan_id, revision)`.

### `entitlement_definitions`

Stable capability registry.

Fields:

- stable key, e.g. `ozon.analytics`;
- value type (`boolean`, `integer`, future constrained enum);
- description;
- security classification;
- created_at/deprecated_at.

### `plan_entitlements`

Immutable composition for published plan revision.

Fields:

- `plan_revision_id`;
- entitlement key;
- typed value.

### `account_entitlement_overrides`

Fields:

- account_id;
- entitlement key;
- typed value;
- reason;
- effective/expiry timestamps;
- actor/audit reference.

### `prices`

Stable logical price identity tied to plan.

### `price_revisions`

Immutable after publish.

Fields:

- `id`;
- `price_id`;
- revision;
- plan/plan_revision relationship according to final billing policy;
- amount minor units;
- currency;
- billing interval/unit/count;
- effective_from/to;
- public availability;
- provider price reference if external system requires it.

Amounts are integers in minor currency units, never binary floats.

## 5. Subscriptions and billing

### `subscriptions`

Fields:

- `id`;
- account_id;
- state;
- current_plan_revision_id;
- bound_price_revision_id;
- started_at;
- current_period_start/end;
- grace_until;
- cancel_at_period_end;
- canceled_at;
- suspended_at;
- state_reason;
- provider/customer/subscription references via provider mapping fields/table.

### `subscription_transitions`

Append-only history:

- subscription_id;
- from_state;
- to_state;
- reason;
- source (`WEBHOOK`, `ADMIN`, `JOB`, `CHECKOUT`, etc.);
- source_event_id;
- timestamp;
- actor when applicable.

### `billing_customers`

Provider mapping if needed:

- account_id;
- provider;
- provider_customer_id;
- created_at.

### `payments`

Canonical commercial payment records.

Fields:

- id;
- account/subscription;
- provider;
- provider_payment_id;
- price_revision_id;
- amount minor units/currency;
- state;
- created/confirmed timestamps;
- idempotency key/reference.

Unique provider + provider_payment_id.

### `billing_events`

Append-only validated provider-event ledger.

Fields:

- id;
- provider;
- provider_event_id;
- event_type;
- received_at;
- verified_at;
- processing state;
- safe payload/reference strategy;
- resulting transition/payment references;
- failure code.

Unique provider + provider_event_id.

## 6. Feature flags / rollouts

### `feature_definitions`

Stable feature key and description.

### `feature_rules`

Rules may target:

- global;
- plan revision;
- account;
- browser family/version;
- extension version;
- AI family/surface;
- stable rollout cohort.

Each rule is versioned/audited.

### `rollouts`

Fields:

- id;
- feature/profile/config target;
- state;
- percentage;
- targeting metadata from an allowlisted schema;
- created/started/paused/completed timestamps;
- actor.

Assignment must be deterministic from stable keys.

## 7. AI adapter registry

### `ai_adapters`

Logical family:

- key (`chatgpt`, `alice`, ...);
- display metadata;
- global status;
- created_at.

### `ai_surfaces`

Examples:

- adapter_id;
- key (`standard`, `work`);
- status;
- metadata.

### `ai_variants`

Optional explicit UI variants beneath a surface.

### `adapter_profiles`

Stable profile identity.

### `adapter_profile_revisions`

Immutable published revision:

- profile_id;
- revision;
- declarative profile payload/schema version;
- compatibility constraints;
- checksum;
- state (`DRAFT`, `CANDIDATE`, `PUBLISHED`, `RETIRED`);
- created/published timestamps;
- actor.

### `adapter_profile_assignments`

Maps family/surface/variant/browser compatibility to active rollout/profile revision.

Rollback changes assignment/rollout, not historical revision contents.

## 8. Client compatibility / releases

### `extension_releases`

Fields:

- version;
- release channel;
- browser family compatibility metadata;
- protocol versions supported;
- release state;
- released_at;
- artifact/checksum/store metadata where appropriate.

### `compatibility_policies`

Rules for:

- minimum version;
- update recommended;
- blocked versions;
- browser-family constraints;
- maintenance messages.

## 9. Signed configuration

### `config_releases`

Fields:

- config version monotonic ID;
- schema/contract version;
- published state;
- generated hash;
- signing key ID;
- issued/published timestamps;
- source revisions included;
- actor.

The actual per-device bootstrap snapshot may be generated from immutable revisions/policies; not every individualized snapshot needs its own DB row unless operational evidence requires it.

### `signing_keys`

DB stores metadata/public key/key ID/state only. Production private key remains in secret management, not ordinary database fields.

## 10. Diagnostics

### `diagnostic_events`

Allowlisted structured metadata:

- id;
- occurred/received timestamps;
- account/device pseudonymous references;
- extension/browser versions;
- AI family/surface/profile;
- stage;
- error code;
- safe numeric/string dimensions;
- correlation ID.

No arbitrary JSON business payload column in baseline schema.

Aggregates may later be materialized separately if volume warrants.

## 11. Health system

### `health_suites`

Defines logical suite for AI/surface/browser combination and cadence.

### `health_suite_revisions`

Versioned deterministic expected behavior/contours.

### `health_runs`

Fields:

- id;
- suite revision;
- trigger (`SCHEDULED`, `MANUAL`, `CANDIDATE_PROFILE`, `POST_ROLLOUT`);
- browser/runtime versions;
- adapter/profile revision;
- started/finished;
- final health state;
- correlation ID;
- failure summary code.

### `health_check_results`

Per contour:

- health_run_id;
- contour key;
- status;
- strategy used;
- primary/fallback match state;
- structural/behavioral results;
- severity;
- evidence references.

### `health_incidents`

Fields:

- id;
- AI/surface/browser scope;
- detected state;
- first_seen/last_seen;
- current status (`OPEN`, `INVESTIGATING`, `CANDIDATE_FIX`, `ROLLOUT`, `RESOLVED`);
- related contour/error;
- active/candidate profile revisions;
- owner/notes metadata.

### `evidence_objects`

Metadata for private object-store evidence:

- object key/reference;
- content classification;
- hash;
- size;
- created_at;
- expires_at;
- health run/incident reference.

### P8.2 physical persistence boundary

P8.2 materializes the Health entities as four immutable/reference-safe tables:

- `health_suite_revisions`: validated suite definition JSONB plus a canonical
  SHA-256 fingerprint and unique `(machine_key, revision)`;
- `health_runs`: exact P7 hierarchy/profile revision, browser/runtime scope,
  validated scope fingerprint, level and the classifier-derived state;
- `health_contour_results`: one validated P8.1 result per `(run_id,
  contour_key)`;
- `health_evidence_references`: only `SafeEvidenceReference` metadata, linked
  to the exact validated contour result.

Completed runs, suite revisions, contour results and evidence references are
append-only. The completed-run repository validates through P8.1, calls
`classifyHealth()`, and writes the run, results and evidence in one
transaction. The database does not classify Health. `health_incidents` is a
minimal P8.2 schema primitive only; lifecycle, deduplication, orchestration
and notifications remain later-stage responsibilities.

## 12. Notifications

### `notification_endpoints`

Operational destinations/config references; secrets stay in secret manager when appropriate.

### `notification_events`

Tracks delivery idempotency/status for alerts such as health incidents.

## 13. Admin audit

### `admin_users` / admin identity mapping

Separate privileged role state from ordinary account memberships.

### `audit_events`

Append-only:

- id;
- actor type/id;
- action;
- target type/id;
- correlation/request ID;
- safe before/after summary;
- reason;
- timestamp.

High-value mutations should persist audit in the same transaction as domain change where feasible.

## 14. Durable jobs

Queue library may own physical tables. Domain jobs still require stable logical identifiers/idempotency keys.

Examples:

- email OTP send;
- billing reconciliation;
- subscription expiry;
- health schedule;
- notification delivery;
- evidence retention cleanup.

## 15. Key database invariants

1. One provider billing event identity can be processed at most once.
2. One provider payment identity maps to at most one canonical payment.
3. Published plan/price/profile revisions cannot be mutated in place.
4. Refresh token hash is unique.
5. Device revoke blocks session refresh.
6. Device activation exchange is single-use.
7. Monetary values use minor-unit integer + currency.
8. Effective subscription references exact price/plan revisions.
9. Audit and state-transition history are append-only.
10. Health evidence never requires real seller/customer payload storage.
11. Remote profile payload is validated against a versioned declarative schema before publication.

## 16. Deletion / retention policy direction

- accounts/users: legal/product retention policy to be finalized before production;
- financial/payment records: retain according to legal/accounting requirements;
- audit: long-lived operational/security retention;
- diagnostic events: bounded retention, then aggregate/delete;
- health screenshots/evidence: short bounded retention unless attached to active incident/release acceptance;
- OTP challenges: short retention/delete after security window;
- refresh tokens/session history: retain enough metadata for security/audit, never plaintext token;
- archived plans/prices/profile revisions: retained for historical reproducibility.

Exact durations are a production/legal decision and will be configured/documented before P14.
