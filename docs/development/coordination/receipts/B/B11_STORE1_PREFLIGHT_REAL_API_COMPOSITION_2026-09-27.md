# B11 STORE-1 preflight real API composition — 2026-09-27

Status: **SOURCE / DISPOSABLE POSTGRESQL VALIDATED CANDIDATE — NO LIVE OR STORE ACTION**

Controller assignment: `STREAMS-AUDIT-20260927-1022`.

Base and scope:
- accepted `main`: `22473b416949892d66e5d8e204805ea84347c329`;
- B10 read-only operator is already in that main;
- B11 changes **integration evidence only** in `tests/integration/server/store1-opera-admin-activation.integration.test.ts`;
- no production endpoint, production service, shared contract, dependency, DB schema/migration, catalog mutation client or deployment code was added.

## Composition proved

B11 reuses the existing STORE-1 disposable PostgreSQL fixture and composes B10 against actual application handlers instead of handcrafted successful HTTP payloads.

The fixture now creates:

- real DB-backed `AdminAuthService`, admin ops/commercial/AI services and `BetaAdmissionService`;
- real DB-backed `ExtensionAuthService` with an ordinary issued reviewer access token bound to the seeded reviewer account/device/session;
- real `BootstrapService` using the existing DB policy catalog and config signing service;
- synthetic Ed25519 signing material only for the test environment, bound to the actual test signing-key metadata/lifecycle;
- real Fastify routes through `createApiApp`.

The B10 VITEST seam receives a route-backed `fetchImpl` that converts requests into `app.inject`. The returned status, headers and JSON bodies therefore come from actual API route handlers. Successful reviewer/config/bootstrap payloads are not handcrafted by the fetch adapter.

## Positive scenario

With global beta CLOSED, one ACTIVE verified reviewer identity, exactly one ACTIVE reviewer-owned account and an existing beta admission:

1. B10 reads reviewer/beta/config state through actual authenticated admin GET routes.
2. Admin-session and reviewer extension bearer remain distinct.
3. B10 sends the ordinary no-AI `POST /v1/bootstrap` through the actual bootstrap route.
4. The route authenticates the real issued reviewer access token and calls the real v2 bootstrap producer.
5. The producer signs the v2 snapshot with the synthetic test private key whose public metadata is stored/ACTIVE in PostgreSQL.
6. Existing packaged verifier/B09 logic verifies the returned envelope and current config binding.
7. B10 continues actual GET planner readback and returns the first catalog mutation as an **unexecuted** preview:
   `POST /v1/admin/compatibility/releases/0.2.4/publish`.
8. Recorded B10 HTTP POSTs equal exactly `[/v1/bootstrap]`.
9. Extension-release and config-release row counts are unchanged across B10 execution.

Therefore the test proves route composition without claiming any catalog mutation authority.

## Negative scenarios

The same real route stack proves fail-closed behavior for:

- malformed/wrong reviewer bearer -> authenticated bootstrap fails;
- reviewer device revoked after token issuance -> bootstrap authentication fails;
- reviewer beta admission removed -> B10 stops during admin readback/planner preflight and does **not** call `/v1/bootstrap`;
- existing B09 forged proof, signature/context/freshness and stale-config boundaries remain covered by the same integration suite.

No registration opening, SQL bypass of production state, OTP request, owner credential read, provider call or live backend request is used.

## Parent verification

Toolchain: Node 24.20.0, pnpm 10.34.5.

- Exact parent disposable PostgreSQL STORE-1 integration: **5/5 PASS**, supervisor `octoport-test-b-1dd4f6d6062d46dcbb22244fd5aadd8e.service`.
- Exact child post-fix disposable PostgreSQL verification: **5/5 PASS**, supervisor `octoport-test-b-649cdbf610bf4224b8d1d9d42aa4a8b1.service`.
- Targeted TypeScript check under project compiler settings: PASS, supervisor `octoport-test-b-7d8b6db44435434789a244cea8664fd8.service`.
- Targeted ESLint: PASS, supervisor `octoport-test-b-626d366ec169480297c0fd6ea5687fe1.service`.
- Targeted Prettier: PASS, supervisor `octoport-test-b-04d4e8b123b44d4a9ad9c6290dfc0015.service`.
- `git diff --check`: PASS.

The first child integration attempt failed before tests because test PEM material was encoded incorrectly. Parent corrected the fixture to canonical base64 PEM and corrected BootstrapService constructor slotting; no production code was changed. The corrected exact test then passed.

## Evidence boundary / remaining STORE gate

This closes the B11 **source/disposable API-handler composition** gap. It does not prove:

- intended live backend reviewer identity/account/admission exists;
- a genuine owner/reviewer OTP login;
- live signed bootstrap on the intended backend;
- deployment;
- catalog mutation;
- store submission/review acceptance.

Those remain separate C/owner/live readiness gates. B11 itself must not be represented as LIVE_OWNER, DEPLOYMENT or store acceptance evidence.
