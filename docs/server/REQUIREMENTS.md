# Product Control Plane — Requirements / Technical Specification

Status: normative product/server requirements  
Date: 2026-09-09

## 1. Product objective

Build the commercial control plane and operating system around the browser bridge while the current Ozon Bridge continues independent development.

The server must turn the bridge from a developer extension into a maintainable paid product with:

- user accounts;
- device authorization;
- subscription and billing;
- remotely managed plans/prices/entitlements;
- remotely managed declarative AI adapter profiles;
- automatic AI detection support;
- Chrome-first but browser-modular compatibility;
- Yandex Browser as an independent later target;
- automated AI-interface health monitoring;
- safe diagnostics;
- admin operations;
- staged configuration rollout and rollback;
- a stable versioned integration contract for the future current Bridge build.

## 2. Scope boundaries

### Included

- control-plane backend;
- database and migrations;
- user portal;
- admin panel;
- payment-provider integration abstraction;
- email authentication abstraction;
- extension device authorization;
- bootstrap/config API;
- plan/price/subscription system;
- entitlement engine;
- feature flags;
- AI adapter/profile registry;
- compatibility policy;
- health runners and health dashboard;
- diagnostics aggregation;
- notifications;
- observability;
- deployment/backup/runbook foundations;
- production public-domain/ingress configuration and acceptance;
- simulated extension client for server development;
- eventual Bridge integration.

### Explicitly excluded from initial server

- Ozon API proxying;
- storing Ozon API keys;
- storing raw seller datasets;
- LLM inference;
- analytics/report generation;
- arbitrary remote extension code;
- full current Bridge source migration during parallel-development phase;
- automatic unreviewed Codex deployment to production.

## 3. Functional requirements

### FR-AUTH — Identity

**FR-AUTH-001** The system MUST support passwordless email authentication using a short-lived one-time code.

**FR-AUTH-002** OTP codes MUST be single-use, expire, be rate-limited and never be stored in plaintext after issuance.

**FR-AUTH-003** The internal user/account identity MUST be independent of the external email provider and future social-login providers.

**FR-AUTH-004** The system MUST support separate user and account/tenant concepts from the first schema version.

**FR-AUTH-005** Authentication and authorization failures MUST return stable machine-readable error codes.

### FR-DEVICE — Extension devices and sessions

**FR-DEVICE-001** The extension MUST authorize using a device activation flow; manual license-key entry is not the primary product flow.

**FR-DEVICE-002** Device authorization MUST require explicit confirmation in the authenticated web portal.

**FR-DEVICE-003** A device record MUST include stable device ID, account ID, display metadata, browser family, extension version, created/last-seen timestamps and revocation state.

**FR-DEVICE-004** The server MUST support per-plan active-device limits.

**FR-DEVICE-005** Users MUST be able to revoke their own devices from the portal.

**FR-DEVICE-006** Admins MUST be able to revoke a device.

**FR-DEVICE-007** Access tokens MUST be short-lived.

**FR-DEVICE-008** Refresh tokens MUST be opaque, rotating, revocable and stored only as secure hashes server-side.

**FR-DEVICE-009** Reuse of an invalidated rotating refresh token MUST be detectable and MUST trigger the configured session-compromise response.

### FR-BOOT — Bootstrap/control-plane snapshot

**FR-BOOT-001** An authorized extension MUST obtain its effective product state through a versioned bootstrap endpoint.

**FR-BOOT-002** Bootstrap input MUST include contract version, extension version, browser family/version, device identity, last known config version and detected AI context when available.

**FR-BOOT-003** Bootstrap output MUST include account state, subscription state, effective entitlements, device policy, compatibility policy, AI adapter/profile resolution, feature flags, config version, expiry and server time.

**FR-BOOT-004** Bootstrap/config payloads MUST be signed and schema-validated by the client.

**FR-BOOT-005** The server MUST be able to require a minimum extension version.

**FR-BOOT-006** The server MUST support a bounded signed offline-grace snapshot for already-authorized clients.

### FR-PLAN — Plans

**FR-PLAN-001** Admins MUST be able to create a plan.

**FR-PLAN-002** Admins MUST be able to edit plan metadata without an extension release.

**FR-PLAN-003** Admins MUST be able to publish a new immutable plan revision.

**FR-PLAN-004** Admins MUST be able to hide a plan from new sales while preserving existing subscriptions.

**FR-PLAN-005** Admins MUST be able to archive a plan.

**FR-PLAN-006** Physical deletion MUST be rejected when historical financial/subscription references exist.

**FR-PLAN-007** Plan entitlements MUST be versioned independently from UI copy.

### FR-PRICE — Prices

**FR-PRICE-001** Admins MUST be able to create and publish a price revision including amount, currency, billing period and effective date.

**FR-PRICE-002** Changing a public price MUST NOT rewrite historical payments or silently change the price revision bound to an existing subscription.

**FR-PRICE-003** The system MUST support a policy decision between grandfathered subscriptions and explicit migration to a new price revision.

**FR-PRICE-004** Price changes MUST be audited.

### FR-SUB — Subscription lifecycle

**FR-SUB-001** Supported states MUST include at least `TRIAL`, `ACTIVE`, `GRACE`, `PAST_DUE`, `CANCELED`, `EXPIRED`, `SUSPENDED`.

**FR-SUB-002** State transitions MUST be explicit, validated and recorded with reason/source.

**FR-SUB-003** Admins MUST be able to grant, extend, suspend and restore a subscription subject to role permissions.

**FR-SUB-004** Users MUST be able to see their current plan, renewal/expiry information and active-device allowance.

### FR-BILL — Billing

**FR-BILL-001** Billing providers MUST be behind an internal provider interface.

**FR-BILL-002** Checkout MUST bind to a concrete account and immutable price revision.

**FR-BILL-003** Payment return/redirect pages MUST NOT be authoritative proof of payment.

**FR-BILL-004** Provider webhooks MUST be authenticated/verified, idempotent and durably recorded before subscription effects are finalized.

**FR-BILL-005** Duplicate webhooks MUST NOT duplicate payments or extend subscription twice.

**FR-BILL-006** Reconciliation jobs MUST exist for uncertain/incomplete provider states.

### FR-ENT — Entitlements and features

**FR-ENT-001** Product capabilities MUST be represented by stable named entitlements.

**FR-ENT-002** Effective entitlement resolution MUST support global policy, plan revision, account override and rollout policy.

**FR-ENT-003** Admins MUST be able to enable/disable a feature globally without releasing a new extension where the feature is already packaged locally.

**FR-ENT-004** Server policy MUST NOT expand the packaged extension security/capability boundary.

**FR-ENT-005** Admin/support diagnostics MUST be able to explain why an entitlement resolved to allowed/denied.

### FR-AI — AI registry and automatic selection

**FR-AI-001** The normal user flow MUST use automatic AI detection, not mandatory manual AI selection.

**FR-AI-002** The adapter registry MUST model `AI family -> surface -> variant -> profile revision`.

**FR-AI-003** Each AI adapter/surface MUST have an independently controllable availability/health state.

**FR-AI-004** Admins MUST be able to disable an AI adapter or specific surface independently.

**FR-AI-005** Admins MUST be able to switch the active profile revision and rollback.

**FR-AI-006** Published profile revisions MUST be immutable.

**FR-AI-007** Remote profiles MUST remain declarative and MUST NOT contain arbitrary executable code.

**FR-AI-008** Manual AI/profile override MAY exist only as an advanced diagnostic/test capability.

**FR-AI-009** Every current and future AI registry record MUST have an independent hint-and-answer tree keyed by its permanent registry ID. Adding an AI MUST atomically and idempotently create its tree from the shared starter template; the template content is not yet specified, and later template edits MUST NOT overwrite existing trees.

**FR-AI-010** Admin tree edits MUST be saved as drafts and published separately after validation; clients MUST resolve only the published revision for the requested AI. Published revisions are immutable and auditable by author/time; restoring old content MUST create a new monotonic publication distinguishable from stale-data replay. Existing RBAC, CSRF and transactional authorization checks remain in force, and concurrent edits MUST NOT silently overwrite each other.

**FR-AI-011** The existing signed configuration channel MUST advertise the AI ID, tree version, format and content hash; the tree body is separately delivered and authenticated through the accepted signed-configuration system. Clients validate AI ownership, integrity, authenticity and format compatibility before atomic local save. Detailed behavior, offline handling, execution pinning, shared operation limits and acceptance are defined by [Per-AI hint and answer trees](../architecture/SYNC.md#per-ai-hint-and-answer-trees). These requirements do not claim an implemented schema, API or ready feature.

### FR-BROWSER — Browser modularity

**FR-BROWSER-001** Chrome is the first acceptance target unless explicitly reprioritized.

**FR-BROWSER-002** Yandex Browser MUST be implemented as an independent Chromium browser-family driver/capability target, not as a fork of account/billing/server domains.

**FR-BROWSER-003** Compatibility and health state MUST be able to differ by browser family.

**FR-BROWSER-004** A failure in one browser family MUST NOT automatically disable another without shared-root-cause evidence.

**FR-BROWSER-005** Future Chromium browser families MUST be addable through the same capability model.

### FR-HEALTH — AI compatibility health

**FR-HEALTH-001** The system MUST perform scheduled compatibility checks against supported AI surfaces using controlled browser sessions.

**FR-HEALTH-002** The baseline schedule MUST support at least one daily standard smoke run per production-supported AI surface.

**FR-HEALTH-003** Health MUST use named critical UI contours and behavioral assertions, not whole-page HTML hash comparison as the primary signal.

**FR-HEALTH-004** Required health states: `HEALTHY`, `DRIFT`, `DEGRADED`, `BROKEN`, `UNKNOWN`, `MAINTENANCE`.

**FR-HEALTH-005** A failed primary strategy with a successful fallback MUST be observable as drift/degradation rather than hidden as fully healthy.

**FR-HEALTH-006** Health checks MUST record sanitized evidence sufficient to diagnose selector/interaction changes.

**FR-HEALTH-007** Evidence MUST include stable test/run identifiers, browser/AI/profile versions, contour results and relevant sanitized artifacts.

**FR-HEALTH-008** Candidate adapter profiles MUST be testable before activation.

**FR-HEALTH-009** Profile rollout MUST support staged percentages and explicit rollback.

**FR-HEALTH-010** Codex MAY be given incident evidence to implement a candidate fix, but Codex is not the source of pass/fail truth and MUST NOT automatically deploy an unreviewed fix in the initial system.

### FR-DIAG — Diagnostics

**FR-DIAG-001** The extension MUST be able to submit safe structured diagnostic events.

**FR-DIAG-002** Server diagnostics MUST reject or strip disallowed payload fields.

**FR-DIAG-003** Diagnostic data MUST support aggregation by extension version, browser family, AI family/surface/profile, stage and stable error code.

**FR-DIAG-004** Admin UI MUST expose aggregate failure trends without requiring raw user business payloads.

### FR-ADMIN — Administration

The admin panel MUST support, subject to RBAC:

- find account/user;
- view account/subscription/device state;
- grant/extend/suspend/restore subscription;
- revoke device;
- create/edit/hide/archive plans;
- create price revisions;
- publish plan-entitlement revisions;
- set account overrides;
- enable/disable features;
- enable/disable AI adapter/surface;
- select/rollback adapter profile revision;
- view health status/incidents/evidence metadata;
- trigger an on-demand health check;
- view aggregate diagnostics;
- view admin audit history.

### FR-AUDIT — Auditability

**FR-AUDIT-001** Every security/commercial/admin mutation MUST produce an append-only audit event.

**FR-AUDIT-002** Audit records MUST include actor, action, target, timestamp, request/correlation ID and safe before/after metadata where applicable.

**FR-AUDIT-003** Secret values MUST never appear in audit records.

### FR-NOTIFY — Notifications

**FR-NOTIFY-001** The system MUST support operational notifications for `DRIFT`, `DEGRADED`, `BROKEN`, payment reconciliation failures and critical backend incidents.

**FR-NOTIFY-002** Notification channels MUST be provider-abstracted so Telegram/email/other channels can be added without changing health domain logic.

## 4. Non-functional requirements

### NFR-SEC — Security

- TLS is mandatory in non-local environments.
- secrets must come from environment/secret management, never Git;
- refresh tokens stored hashed;
- config-signing private key server-only;
- admin actions require strong authentication and RBAC;
- CSRF protections apply to cookie-authenticated web actions;
- payment webhooks require provider verification and idempotency;
- APIs require rate limiting on abuse-prone endpoints;
- remote configuration cannot become remote executable code;
- raw seller payloads and Ozon credentials are forbidden from baseline server storage.

### NFR-INGRESS — Production domain and public ingress

The approved product-domain authority is:

- `selleragents.ru` — canonical public user Portal origin;
- `selleragents.ru/admin/` — initial Admin UI route on the same web origin as Portal;
- `api.selleragents.ru` — public Control Plane API origin;
- `docs.selleragents.ru` — documentation origin;
- `www.selleragents.ru` — alias that MUST redirect canonically to `https://selleragents.ru/` and MUST NOT operate as a second independent application origin.

Current owner-prepared DNS points `selleragents.ru`, `api.selleragents.ru` and `docs.selleragents.ru` to VPS `78.17.68.165`; `www.selleragents.ru` is a CNAME to `selleragents.ru`.

Production ingress MUST satisfy all of the following before launch acceptance:

- public HTTP(S) terminates at the accepted reverse proxy/ingress layer, not directly at application development ports;
- HTTP redirects to HTTPS;
- valid TLS certificates cover every enabled public hostname and certificate renewal is tested/documented;
- Portal/Admin/API application ports remain loopback/private behind ingress;
- Portal and Admin routing preserves the accepted source-portal-session, admin-session, cookie and CSRF boundaries;
- API routing preserves the accepted authentication, authorization, rate-limit, exact-contract/allowlist and security-header behavior;
- production observability distinguishes Portal/Admin/API ingress without logging secrets;
- DNS availability does not by itself mean a hostname or service is production-accepted;
- no `admin.selleragents.ru` origin is introduced unless a later ADR deliberately changes the cookie/CSRF topology.

The current zone mail `MX` records are not acceptance evidence for production OTP delivery. Production OTP email still requires an explicitly selected/configured SMTP/email provider and separate delivery/security acceptance.

### NFR-PRIV — Privacy/data minimization

The database and telemetry schemas MUST be designed around data minimization. Every persisted field must have an operational/commercial/security purpose and a retention policy where applicable.

### NFR-REL — Reliability

- database migrations must be deterministic and reversible where practical;
- durable jobs must survive process restart;
- duplicate webhook/job delivery must be safe;
- backup/restore procedure must be documented before production;
- configuration/profile rollback must be possible without a client release;
- server outage must not immediately brick already-authorized clients within the bounded offline-grace policy.

### NFR-PERF — Performance

Initial service objectives for non-health control-plane endpoints:

- bootstrap p95 target < 500 ms under normal production load excluding network geography;
- token refresh p95 target < 300 ms;
- admin/portal ordinary reads p95 target < 750 ms;
- no synchronous request should wait for email delivery, payment reconciliation or browser-health execution.

These are engineering targets, not contractual public SLAs, until load evidence exists.

### NFR-OBS — Observability

Every server request/job/health run must carry correlation/trace identity. Structured logs, metrics and traces must not contain forbidden secrets or business payloads.

Required baseline operational signals:

- request rate/error/latency;
- auth/OTP failures;
- token refresh/reuse failures;
- webhook errors/duplicates;
- subscription transition failures;
- job queue lag/failures;
- bootstrap denial reasons;
- adapter health by surface/browser/profile;
- health drift/incidents;
- diagnostic error-code trends.

### NFR-TEST — Testability

Every domain module requires unit tests for invariants. Database-dependent modules require integration tests against real PostgreSQL in CI/test containers. API schemas require contract tests. Portal/admin require critical E2E flows. Health contours require deterministic fixtures plus controlled-browser smoke tests.

### NFR-VERSION — Versioning/compatibility

The system MUST version:

- client/server protocol;
- extension version policy;
- config snapshots;
- adapter profile revisions;
- plan revisions;
- price revisions;
- health suite definitions where behavior changes materially.

## 5. Required critical UI contours for first AI health implementation

At minimum:

1. page identity;
2. conversation root;
3. composer root;
4. composer input;
5. send control;
6. stop/busy control;
7. assistant message detection;
8. completion detection;
9. bridge command/code block discovery surface;
10. native Copy control where the bridge relies on it;
11. conversation identity;
12. delivery/insertion path;
13. blocking modal/login/paywall detection.

Each contour definition must state:

- purpose;
- primary strategy;
- fallback strategies;
- structural assertions;
- behavioral assertions;
- safe evidence to collect;
- severity when failed.

## 6. Acceptance gates

### Server foundation acceptance

- repo skeleton and CI pass;
- local Docker environment reproducible;
- database migration baseline accepted;
- test strategy in place;
- no production secret in repository.

### Identity/device acceptance

- complete OTP -> activate device -> token -> refresh -> revoke flow;
- token rotation/reuse tests;
- device-limit tests;
- audit evidence.

### Billing acceptance

- checkout bound to immutable price revision;
- valid webhook activates once;
- duplicate webhook is no-op;
- invalid webhook rejected;
- reconciliation behavior tested;
- admin manual extension audited.

### Remote config acceptance

- signed config validates;
- tampered config rejected;
- rollback works;
- old compatible client accepts supported version;
- unsupported client receives explicit upgrade state;
- server cannot cause unapproved capability expansion.

### Health acceptance

- scheduled run executes;
- on-demand run executes;
- known selector change produces DRIFT/DEGRADED;
- broken core contour produces BROKEN;
- evidence is sanitized;
- candidate profile can be tested and rolled back;
- browser-family result isolation proven.

### Bridge integration acceptance

- current accepted Bridge candidate uses the versioned control-plane contract;
- no Ozon credentials sent to product server;
- no raw provider payload sent to product server by baseline flows;
- switching AI/browser binding does not reset unrelated provider state;
- offline-grace/restart flows pass;
- existing bridge security/exactly-once/delivery regressions remain protected.

### Production ingress/domain acceptance

- authoritative DNS resolves the approved public names to the intended ingress host(s);
- `https://selleragents.ru/` serves the user Portal through the accepted ingress path;
- `https://selleragents.ru/admin/` serves Admin on the same origin without weakening the accepted Portal/Admin session and CSRF model;
- `https://api.selleragents.ru/` reaches only the accepted public Control Plane API surface;
- `https://docs.selleragents.ru/` serves the approved documentation surface;
- `http://...` redirects to HTTPS for every enabled public hostname;
- `www.selleragents.ru` redirects canonically to `https://selleragents.ru/`;
- certificate issuance and automatic renewal are proven;
- application/internal ports are not publicly exposed as alternate bypasses around ingress;
- production security headers, auth, CSRF, rate limits and BFF/API boundaries are verified through the real HTTPS origins;
- DNS/HTTPS rollback and incident recovery are documented before staged launch.
