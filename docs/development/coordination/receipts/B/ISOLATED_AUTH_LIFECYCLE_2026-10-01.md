# B04 isolated normal auth lifecycle driver — 2026-10-01

Status: **SOURCE + CURRENT DISPOSABLE DB/API VERIFIED; INDEPENDENT REVIEW PENDING; NOT INSTALLED OR LIVE ACCEPTANCE**

Original task baseline: `ef363662`. Current B integration base before the four auth commits: `dbeaaf2f8d9cc36c5bac5f7a27ba83acc51a2503`.

## Scope and consumer contract

Added `tooling/server/isolated-auth-lifecycle.ts` as a small HTTP driver over the existing routes:

- OTP request and verification, plus account listing and approve/deny through the portal's same-origin `/api/control-plane` proxy;
- device authorization start and token exchange through the normal API origin;
- exchange pending/activated/closed/error outcomes, a server-timestamp expiry observation, pending cancellation by the existing deny action, active-device revoke and portal logout.

Consumers provide loopback API and portal origins, one exact registered disposable PostgreSQL target, an explicit `disposable: true` `*.test` identity, and a callback that supplies the generated local six-digit OTP fixture for the returned challenge. The helper rejects DB query/hash overrides and unregistered host/port/database combinations before I/O. The callback contract does not read the database, mailboxes or logs. The driver does not connect to PostgreSQL or discover OTPs itself.

Minimal consumer setup:

```ts
const auth = createIsolatedAuthLifecycleDriver({
  apiOrigin: "http://127.0.0.1:3100",
  portalOrigin: "http://127.0.0.1:3200",
  disposableDatabaseUrl: testDatabaseUrl,
  identity: { email: "auth-flow@example.test", disposable: true },
  readOtpFixture: ({ challengeId }) => localOtpFixture(challengeId),
});
await auth.login();
const [account] = await auth.listAccounts();
const device = await auth.startDevice({
  browserFamily: "chrome",
  extensionVersion: "1.0.0",
});
await auth.approveDevice(device.authorizationId, String(account?.id), device.userCode);
const outcome = await auth.exchangeDevice(device.deviceCode);
```

Call `exchangeDevice` again for a pending authorization; its idempotency key stays stable for that device code. A malformed HTTP 200 token response fails closed under the product contract. `cancelDevice` maps to the product's normal denial action. `observeExpiredDevice({ deviceCode, expiresAt })` requires the supplied server expiry to have passed and then observes the same exchange API response; the API intentionally does not distinguish expiry from other closed terminal states. `revokeDevice` uses the portal CSRF cookie/header contract. No product auth rules, TTLs, schemas, migrations, signing or CSRF behavior changed.

## Evidence

The existing P2.2 OTP suite and P2.3 device authorization suite were used as the real service behavior baseline; C05 receipts supplied the loopback/disposable and synthetic-identity boundaries. The helper uses the existing route paths, cookie names, CSRF header, request bodies, response codes and required idempotency headers.

The integration test builds the real Fastify auth, device authorization and device management routes over the supervisor-provided B disposable database. `AuthService` generates a fixed local test OTP fixture and the driver's injected callback supplies that fixture; no OTP is read from the database, mailbox or logs. The transport adapter uses `app.inject` and maps the portal proxy path to the real API routes; it does not start an API or portal server or claim portal UI/Next proxy acceptance. The test exercises cookies/CSRF, stable exchange idempotency, activation, cancellation, expiration through the existing expiry repository, revoke and logout.

Exact current file hashes match the preserved repair candidate. Saved exact-current checks:
- `/root/octoport-control/logs/B/isolated-auth-ci-target-20261001.log`: 51/51 unit tests PASS, Prettier PASS, ESLint PASS.
- Fresh current B heavy integration: resource receipt `/root/octoport-control/resource-jobs/5fa16e351f41408b8e073b5e6210d2b4/receipt.json`, command exit 0, systemd result success, OOM 0, peak 555745280 bytes, cleanup verified.

The earlier L2 run is retained as historical evidence at `/root/octoport-control/controllers/L2/audits/night-idle-20261001T011816Z/b-auth-tests-r3.log`; it predates the final fail-closed/DB-registry hardening and is not used as the sole current acceptance proof.

## Exact changed paths

- `tooling/server/isolated-auth-lifecycle.ts`
- `tooling/server/isolated-auth-lifecycle.test.ts`
- `tests/integration/server/isolated-auth-lifecycle.integration.test.ts`
- `docs/development/coordination/receipts/B/ISOLATED_AUTH_LIFECYCLE_2026-10-01.md`

Current B auth commits, ported without the rejected/foreign repair-branch history:
- `906e25a9` — initial lifecycle driver and DB verification;
- `1fb9d235` — exact disposable DB registry and fail-closed token handling;
- `c4614e72` — formatting only;
- `e9b0fac9` — exact disposable Server CI DB target.

## Acceptance boundary

This is ordinary isolated OTP/device-auth source plus disposable PostgreSQL/API-injection evidence. It is **not** installed-browser evidence, owner-account acceptance, live mailbox evidence, production DB evidence, or authorization to change live catalog/policy. No real credentials or customer data are used. Independent review of the current exact candidate is still required before publication.
