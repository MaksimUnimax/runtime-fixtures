> Перенесённая исходная история. Текущий общий план: ../ROADMAP.md. По фиксации владельца P8.4 Foundation принят, H3 browser actions/P8.5/P8.6 не начаты; перенос не открывает их автоматически.

# Product Control Plane — Two-Level Roadmap

<a id="infrastructure-first-20261109"></a>

## Инфраструктура и подготовка оплаты прежде новой логики расширения — 09.11.2026

Это датированное дополнение к историческому P0–P15, а не новая приёмка сентябрьских этапов. [Действующий PLAN](../development/coordination/PLAN.md#infrastructure-first-20261109) переносит server core/common services/recovery и подготовку коммерческого домена раньше новой версии расширения.

P5 DONE сохраняется только в исторически принятом deterministic Fake/StubBillingProvider/simulated scope. Реальный провайдер не выбран, боевой checkout/списания/возвраты и production не объявлены готовыми. Reference client — предусмотренный [INTEGRATION_CONTRACT](INTEGRATION_CONTRACT.md) seam, а не доказательство клиентского enforcement. Старые DNS/IP, server/ layout, Chrome-only и WB-later не становятся current фактами: текущие пути apps/, packages/server/, tests/, обе площадки и четыре браузера сохраняются.


Status: active source of truth  
Date: 2026-09-09

## 1. Execution rules

1. Every implementation task maps to one Level 1 product item and one Level 2 step.
2. Every Codex task names authority docs, allowed changes, tests/evidence and non-goals.
3. Code existing is not DONE; acceptance evidence + documentation update are required.
4. Server work does not opportunistically patch the active Bridge during parallel development.
5. Bridge integration happens only at P11 using the then-current accepted Bridge candidate.
6. Architecture changes are made deliberately in docs/ADR; Codex implements approved architecture.
7. Owner-provided infrastructure prerequisites (for example domain/DNS preparation) may be recorded before their later roadmap stage begins; recording them MUST NOT implicitly start or accept that stage.

Legend: `[DONE] [ACTIVE] [NEXT] [PLANNED] [BLOCKED]`.

# Level 1 — Product roadmap

## P0 — Architecture and development contract `[DONE / FINAL ACCEPTED]`

Goal: remove architecture ambiguity before server implementation.

Completed deliverables:

- `ARCHITECTURE.md`;
- `REQUIREMENTS.md`;
- `DEVELOPMENT_RULES.md`;
- `SECURITY.md`;
- `INTEGRATION_CONTRACT.md`;
- `TECH_STACK.md`;
- `DATA_MODEL.md`;
- `API_CONTRACTS.md`;
- `BILLING_AND_PLANS.md`;
- `HEALTH_SYSTEM.md`;
- `TEST_STRATEGY.md`;
- ADR set;
- Bridge reference baseline/source map;
- `P0_ARCHITECTURE_AUDIT.md` PASS;
- `P1_CODEX_IMPLEMENTATION_PACKET.md`.

Key decisions frozen for P1:

- control plane != seller data plane;
- modular monolith;
- Node.js 24 LTS / TypeScript / Fastify / PostgreSQL baseline;
- browser family independent; Chrome-first only as priority;
- declarative signed remote profiles, no remote executable code;
- immutable plan/price/profile/config revisions;
- deterministic Health truth; Codex writes repairs but does not auto-deploy them initially;
- Bridge and server develop in parallel through a versioned contract.

Acceptance: `P0_ARCHITECTURE_AUDIT.md` = PASS.

## P1 — Repository and engineering foundation `[DONE / FINAL ACCEPTED]`

Goal: create reproducible server workspace with infrastructure shells only.

Implementation authority: `P1_CODEX_IMPLEMENTATION_PACKET.md`.

Deliverables:

- pnpm workspace;
- Node 24 + TypeScript strict;
- Fastify API shell;
- worker shell;
- portal/admin shells;
- health-runner abstraction shell;
- contracts/db/observability/shared packages;
- PostgreSQL + Drizzle migration harness;
- validated env config;
- logging/correlation IDs;
- Docker Compose local PostgreSQL;
- Vitest/integration test baseline;
- CI pipeline;
- OpenAPI/schema baseline.

Non-goals:

- no real auth/billing/entitlements/remote AI profiles/live Health/Ozon logic;
- no Bridge code import.

Exit gate:

- clean checkout setup documented;
- lint/typecheck/unit/integration/build pass;
- real PostgreSQL migration/query test passes;
- CI passes;
- no Bridge import;
- P1 evidence recorded.

P1 implementation status: P1.1 `[DONE]`; P1.2 `[DONE]`; P1.3 `[DONE]`; P1.4 `[DONE]`; P1.5 `[DONE]`; P1.6 `[DONE]`.

## P2 — Accounts, OTP identity and device authorization `[DONE / FINAL ACCEPTED]`

Goal: user can authenticate and authorize an extension installation.

Scope:

- user/account/membership schema;
- passwordless email OTP;
- device authorization request/approval/exchange;
- device status/limits;
- access tokens;
- rotating opaque refresh tokens;
- refresh reuse detection;
- revoke;
- audit;
- activation portal.

Exit: complete simulated extension activation/refresh/revoke/device-limit flow with security tests.

## P3 — Bootstrap, compatibility and signed remote configuration `[DONE / FINAL ACCEPTED]`

Goal: authorized client receives a safe versioned policy/config snapshot.

Scope:

- `/v1/bootstrap`;
- client protocol/version compatibility;
- browser/extension metadata;
- Ed25519 signed snapshots;
- config revisions;
- minimum extension version;
- offline grace;
- feature/rollout primitives;
- simulated client signature verifier.

Exit: valid/tampered/expired/offline/unsupported-client tests pass; remote payload cannot expand packaged capability.

## P4 — Plans, price revisions and entitlement engine `[DONE / FINAL ACCEPTED]`

Goal: admin can change sellable capabilities/pricing structure without extension releases.

Scope:

- plan + immutable revisions;
- price + immutable revisions;
- entitlement definitions/mapping;
- account overrides;
- device limits;
- entitlement explanation;
- admin plan/price/entitlement workflows.

Exit: price history/grandfathering/revision immutability and deterministic entitlement tests pass.

## P5 — Billing and subscription state machine `[DONE / FINAL ACCEPTED]`

Goal: paid access works idempotently.

Scope:

- billing provider interface + first provider;
- checkout;
- webhook verification/idempotency;
- payment/billing event ledger;
- subscription states `TRIAL|ACTIVE|GRACE|PAST_DUE|CANCELED|EXPIRED|SUSPENDED`;
- reconciliation;
- manual grant/extend/suspend;
- portal billing.

Exit: duplicate/forged/delayed webhook, reconciliation and admin audit scenarios pass.

P5 execution decomposition (frozen by ADR-0020):

- P5.1 `[DONE]` subscription/billing persistence foundation: four core tables, physical integrity/immutability/idempotency constraints, migration/schema tests, local evidence, recovery freeze, and remote acceptance.
- P5.2 `[DONE]` subscription FSM, internal manual grant/extend/suspend/restore commands, exact revision bindings, eligibility/read contracts, and audit.
- P5.3 `[DONE]` provider-neutral `BillingProviderPort`, deterministic fake/stub provider, simulated checkout orchestration, and server checkout idempotency.
- P5.4 `[DONE]` simulated verified billing-event/webhook application through the deterministic fake provider; no real provider HTTP webhook.
- P5.5 `[DONE]` simulated reconciliation and durable subscription period/grace/expiry/cancel jobs through the deterministic fake provider.
- P5.6 `[DONE]` subscription eligibility/bootstrap integration, P4.4 account-plan binding, atomic commercial device limits, portal reads, and non-real-money billing UX.
- P5.7 `[DONE]` P5 security/architecture/full-regression/final acceptance in simulated billing mode.

Real payment go-live: `[DEFERRED UNTIL AFTER REMAINING PRODUCT ROADMAP]`.
YooKassa and Tinkoff/T-Bank: candidates only; no production provider is selected.

## P6 — Admin and operations core `[DONE / FINAL ACCEPTED]`

Goal: first-line operation without direct SQL.

Admin capabilities:

- account/user lookup;
- subscription grant/extend/suspend/restore;
- device revoke;
- create/edit/hide/archive plans;
- create/publish price revisions;
- entitlement/account overrides;
- feature enable/disable;
- AI adapter/surface enable/disable;
- profile candidate/activate/rollback;
- compatibility policy;
- health dashboard;
- aggregate diagnostics;
- audit log.

Exit: required mutations RBAC-protected and audited.

P6 execution decomposition (frozen by ADR-0026):

- P6.1 `[DONE]` admin identity/session/RBAC foundation, CSRF and one-time owner bootstrap.
- P6.2 `[DONE]` admin read plane, safe account/subscription/device views, audit reads, support device revoke, and principal/role management.
- P6.3 `[DONE]` subscription/billing operations through accepted P5 commands and safe billing reads.
- P6.4 `[DONE]` existing plan, price, entitlement and compatibility policy operations; remote final acceptance complete.
- P6.5 `[DONE]` admin portal shell and operations UX; Attempt 4 was independently reviewed, committed as `bc566930c36654a6dd57a8f9eb79872cdb89e8f5`, pushed fast-forward, and passed exact-SHA Server CI plus remote product-safety acceptance.
- P6.6 `[DONE]` P6 security, architecture, regression and final acceptance; see server/docs/P6_6_P6_FINAL_ACCEPTANCE_2026-09-09.md.

P6.6 does not start P7, P8, P9 or P14. AI registry/profile administration,
compatibility health, diagnostics/notification visibility, and production
domain service deployment remain owned by their later stages.

P6.1 does not implement admin UI, account search, subscription/plan/price/
entitlement endpoints, or AI/health/diagnostic admin domains. P7, P8 and P9
own those later domain modules respectively; they reuse this admin framework.

## P7 — AI adapter registry and auto-selection contract `[DONE / FINAL ACCEPTED]`

Goal: normal UX automatically detects the active supported AI; profiles become safely server-managed.

Model:

`active tab -> packaged trusted host/AI/surface detector -> server entitlement/health/profile resolution -> validated declarative bind`

Scope:

- AI family/surface/variant registry;
- profile schemas/revisions;
- compatibility constraints;
- rollout/rollback;
- diagnostic manual override only.

Exit: independent ChatGPT Standard/Work resolution, safe rollback and no remote capability expansion.

P7 execution decomposition (frozen by ADR-0031):

- P7.1 [DONE / REMOTE ACCEPTED] AI adapter registry/profile persistence foundation and strict declarative profile schema.
- P7.2 [DONE / REMOTE ACCEPTED] profile lifecycle commands, deterministic assignment, rollout/pause/rollback authority; exact-SHA Server CI and remote readback passed.
- P7.3 [DONE / REMOTE ACCEPTED] bootstrap AI resolution, signed wire contract, and simulated-client automatic selection.
- P7.4 [DONE / REMOTE ACCEPTED] admin API and P7 RBAC permissions; the post-acceptance contract correction is remotely accepted.
- P7.5 [DONE / REMOTE ACCEPTED] admin portal AI adapter/profile operations UX.
- P7.6 [DONE / REMOTE ACCEPTED] P7 security, architecture, full regression, and final acceptance.

## P8 — AI Compatibility Health v1 `[ACTIVE]`

Goal: detect AI UI changes before widespread user breakage.

Scope:

- health orchestrator;
- controlled Chrome runner first;
- browser-driver abstraction;
- critical contours;
- structural + behavioral checks;
- daily scheduled H3 smoke;
- on-demand/candidate/post-rollout runs;
- evidence sanitization/storage;
- `HEALTHY|DRIFT|DEGRADED|BROKEN|UNKNOWN|MAINTENANCE`;
- incidents/notifications;
- candidate profile validation;
- rollout/rollback hooks.

Exit examples:

- primary selector fail + fallback pass => DRIFT;
- core contour fail => BROKEN;
- expired health account => UNKNOWN;
- candidate profile fixes incident without regression.

P8 execution decomposition (frozen by ADR-0036):

- P8.1 `[DONE / REMOTE ACCEPTED]` health domain,
  deterministic classifier, suite registry, and H0 profile-candidate boundary.
- P8.2 `[DONE / REMOTE ACCEPTED]` health persistence; remote-acceptance
  materialization is recorded in the accepted documentation.
- P8.3 `[DONE / REMOTE ACCEPTED]` BrowserDriver and controlled Chrome H2;
  final-local E2E `85/85`; independent Review1 `PASS`; unchanged product-tree
  CI100 `85/85 PASS`; CI99 and CI101 failures were later proven independent
  pre-existing test-only defects; baseline-test stabilization commit
  `130e3f1bd9cffc28b5ac799c87173fac96d9adf2` passed CI102 `85/85`; P8.3
  product source required no correction. The remote-acceptance state is valid
  when the commit containing this final documentation rematerialization
  satisfies the exact-SHA Server CI condition in
  `P8_3_REMOTE_ACCEPTANCE_2026-09-13.md`.
- P8.4 `[PLANNED]` ChatGPT Standard/Work H3 and sanitized evidence.
- P8.5 `[PLANNED]` scheduling, orchestration, and health incidents.
- P8.6 `[PLANNED]` H4/H5, P7 availability-restriction hooks, and minimal
  Health admin API/UI.
- P8.7 `[PLANNED]` whole-P8 security, privacy, architecture, regression, and
  final acceptance.

## P9 — Diagnostics, notifications and operational visibility `[PLANNED]`

Goal: low support burden and early incident visibility.

Scope:

- safe allowlisted diagnostics API;
- aggregate dashboards by version/browser/AI/profile/error;
- stable error taxonomy;
- Health/backend/billing alerts;
- retention;
- observability dashboards/alerts.

Exit: common failures diagnosable without raw seller payloads; alert grouping/noise control works.

## P10 — Bridge integration preparation `[PLANNED]`

Goal: validate all server/client contracts before touching production Bridge.

Scope:

- simulated extension/reference client;
- device auth/bootstrap/signature/profile fixtures;
- compatibility/offline/denial fixtures;
- Bridge integration checklist;
- state ownership mapping template.

Exit: server system testable without live Bridge dependency.

## P11 — Integrate then-current accepted Ozon Bridge `[PLANNED]`

Goal: attach current Bridge version, not the old reference snapshot.

Steps:

- fetch fresh accepted Bridge commit/artifact/tests;
- delta audit against `server/reference/bridge/`;
- integrate auth/bootstrap/profile client contract;
- preserve Ozon credential/data-plane locality;
- preserve fixed provider security boundary;
- prove AI rebind/auth/config refresh cannot reset provider quota/cache/execution state;
- preserve exactly-once/delivery regressions;
- run combined contract + Bridge regression suite.

Exit: accepted integrated Chrome candidate.

## P12 — Chrome commercial acceptance `[PLANNED]`

End-to-end:

install -> device auth -> subscription -> local Ozon connection -> AI auto-detection -> remote profile -> question -> Ozon data -> AI answer -> diagnostics/recovery.

Also store/privacy/update/restart/failure acceptance.

Chrome is first only unless roadmap priority changes.

## P13 — Yandex Browser compatibility `[PLANNED]`

Goal: add Yandex Browser without product fork.

Scope:

- `yandex_chromium` browser driver/capabilities;
- distribution/permissions differences;
- Yandex Health runner;
- browser-specific compatibility/diagnostics;
- same server account/auth/billing/bootstrap contracts.

Exit: independent browser health and no duplicated commercial/domain logic.

## P14 — Production launch hardening `[PLANNED]`

Approved prerequisite already completed outside P14 implementation:

- product domain acquired: `selleragents.ru`;
- owner-prepared DNS: `selleragents.ru`, `api.selleragents.ru` and `docs.selleragents.ru` resolve to VPS `78.17.68.165`;
- `www.selleragents.ru` is a CNAME to `selleragents.ru`.

This prerequisite does **not** mean P14 has started or that any public service is production-accepted.

Scope:

- production infrastructure/secrets;
- public ingress/reverse proxy for the approved domain topology;
- `https://selleragents.ru/` user Portal;
- `https://selleragents.ru/admin/` Admin on the same origin unless a later ADR deliberately changes the cookie/CSRF topology;
- `https://api.selleragents.ru/` Control Plane API;
- `https://docs.selleragents.ru/` documentation surface;
- canonical `www.selleragents.ru -> https://selleragents.ru/` redirect;
- TLS issuance, automatic renewal and renewal-failure monitoring;
- HTTP -> HTTPS redirects;
- non-public/loopback application ports behind ingress;
- production ingress security-header/auth/CSRF/rate-limit validation;
- backup + restore drill;
- deployment/rollback;
- payment reconciliation runbook;
- AI compatibility incident runbook;
- monitoring/alerts;
- admin MFA/RBAC acceptance;
- production OTP email/SMTP provider and deliverability/security acceptance;
- privacy/legal/store readiness;
- staged launch.

P14 provisional ingress-related substeps:

- P14.0 `[DONE PREREQUISITE ONLY]` acquire `selleragents.ru` and prepare the owner-managed DNS records listed above; P14 remains `[PLANNED]`.
- P14.1 `[PLANNED]` implement nginx/accepted reverse-proxy routing, bind internal services privately, and verify no alternate public application-port bypass exists.
- P14.2 `[PLANNED]` issue TLS for enabled public names, enforce HTTP -> HTTPS, canonicalize `www`, and prove automatic certificate renewal.
- P14.3 `[PLANNED]` validate real-origin Portal/Admin session-cookie/CSRF behavior and API authentication/rate-limit/security-header boundaries.
- P14.4 `[PLANNED]` productionize secrets, backup/restore, deployment/rollback and monitoring for the public endpoints.
- P14.5 `[PLANNED]` select/configure the production OTP email provider independently of the current zone MX records and prove delivery/security acceptance.
- P14.6 `[PLANNED]` complete remaining MFA/privacy/legal/store/staged-launch gates.

Exit: all enabled `selleragents.ru` HTTPS origins pass real-ingress security, certificate-renewal, private-port, deployment/rollback and monitoring acceptance; DNS existence alone is never treated as launch readiness.

## P15 — Post-Ozon expansion `[PLANNED]`

Only after paid Ozon path is proven:

- additional data sources;
- additional AI adapters;
- additional browsers when justified;
- cross-source workflows.

Architecture remains:

`business data adapters -> common bridge protocol -> supported AI adapters`

# Level 2 — Current execution

## P0 substeps

- P0.1 `[DONE]` create `feature/product-control-plane-server-2026-09-03` from then-current Bridge branch.
- P0.2 `[DONE]` create `server/` root/documentation skeleton.
- P0.3 `[DONE]` complete normative architecture/spec/security/data/API/billing/Health/test docs and ADRs.
- P0.4 `[DONE]` capture pinned Bridge reference baseline/source map without runtime import.
- P0.5 `[DONE]` run architecture consistency audit -> PASS.
- P0.6 `[DONE]` prepare first bounded Codex packet `P1_CODEX_IMPLEMENTATION_PACKET.md`.

## P1 completed substeps

- P1.1 `[DONE]` Codex creates workspace/tooling skeleton exactly within P1 packet.
- P1.2 `[DONE]` verify local install/build/lint/typecheck/unit tests.
- P1.3 `[DONE]` verify real PostgreSQL migration/integration baseline.
- P1.4 `[DONE]` verify CI and generated contract baseline.
- P1.5 `[DONE]` architecture review implementation vs P0 decisions.
- P1.6 `[DONE]` close accepted findings, run final acceptance, and record P1 completion.

## P2 substeps

- P2.1 `[DONE]` Identity/device persistence foundation.
- P2.2 `[DONE]` Email OTP request/verify, abuse controls, durable delivery and portal session.
- P2.3 `[DONE]` Device authorization start/approve/deny/expire plus client idempotency.
- P2.4 `[DONE]` Short-lived access-token auth plus opaque refresh rotation/reuse detection.
- P2.5 `[DONE]` Device exchange/list/revoke/device limits and transactional audit.
- P2.6 `[DONE]` Portal activation flow plus simulated extension client and E2E.
- P2.7 `[DONE]` P2 security/architecture audit and final P2 acceptance/checkpoint.

## P3 substeps

- P3.1 `[DONE]` Signed bootstrap contract and cryptographic foundation.
- P3.2 `[DONE]` Compatibility/config/signing persistence foundation.
- P3.3 `[DONE]` Compatibility, config-release and rollout resolution.
- P3.4 `[DONE]` Authenticated `/v1/bootstrap` and coherent signed snapshot service.
- P3.5 `[DONE]` Simulated-client signature verification and signing-key rotation.
- P3.6 `[DONE]` Offline grace, cached snapshot and unsupported-client/browser flows.
- P3.7 `[DONE]` P3 security/architecture audit, E2E and final P3 acceptance.

## P4 substeps

- P4.1 `[DONE]` Commercial catalog persistence foundation.
- P4.2 `[DONE]` Plan / entitlement definition / plan-revision command services, publication, hide/archive, transactionally audited mutations and concurrency.
- P4.3 `[DONE]` Price revision commands, explicit new-sales selection/closure, effective windows, price history and catalog-level grandfathering.
- P4.4 `[DONE]` Deterministic commercial entitlement resolver, account override resolution, explanation objects and `device.max_active` adapter contract.
- P4.5 `[DONE]` Public commercial catalog read model/API plus stable P5/P6 consumer interfaces, without implementing subscriptions/admin mutation transport.
- P4.6 `[DONE]` P4 security/architecture audit, full regression and final P4 acceptance.

## P7 current execution

- P6 [DONE / FINAL ACCEPTED].
- P7 [DONE / FINAL ACCEPTED].
- P7.1 [DONE / REMOTE ACCEPTED].
- P7.2 [DONE / REMOTE ACCEPTED].
- P7.3 [DONE / REMOTE ACCEPTED].
- P7.4 [DONE / REMOTE ACCEPTED — post-acceptance correction remotely accepted].
- P7.5 [DONE / REMOTE ACCEPTED].
- P7.6 [DONE / REMOTE ACCEPTED].
- P8 [ACTIVE].
- P8.1 [DONE / REMOTE ACCEPTED].
- P8.2 [DONE / REMOTE ACCEPTED].
- P8.3 [DONE / REMOTE ACCEPTED]. Local full E2E `85/85`, independent Review1
  PASS, unchanged-product-tree CI100 `85/85`, and baseline-test stabilization
  CI102 `85/85`; CI99 and CI101 were later proven independent pre-existing
  test-only defects, and P8.3 product source required no correction. The
  formal finality of this roadmap materialization is governed by the exact-SHA
  CI condition in `P8_3_REMOTE_ACCEPTANCE_2026-09-13.md`.
- P8.3 final-local acceptance [LOCAL ACCEPTED / REMOTE ACCEPTANCE PENDING].
- P8.4 [PLANNED].
- P8.5 [PLANNED].
- P8.6 [PLANNED].
- P8.7 [PLANNED].
- P9 [PLANNED].
- P13 [PLANNED].

# Parallel Bridge rule

During P1-P10, the active Bridge can continue changing independently. Server uses contracts, fixtures and pinned reference knowledge. It does not continuously copy Bridge runtime internals.

At P11 the current accepted Bridge becomes the only meaningful integration baseline.
