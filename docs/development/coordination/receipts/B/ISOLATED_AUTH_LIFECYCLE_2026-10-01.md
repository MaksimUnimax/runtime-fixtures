# B04 isolated normal auth lifecycle driver — 2026-10-01

Status: **SOURCE + DISPOSABLE DB/API INJECTION VERIFIED; NOT INSTALLED OR LIVE ACCEPTANCE**

Baseline: accepted task baseline `ef363662` (short SHA as provided by the parent).

## Scope and consumer contract

Added `tooling/server/isolated-auth-lifecycle.ts` as a small HTTP driver over the existing routes:

- OTP request and verification, plus account listing and approve/deny through the portal's same-origin `/api/control-plane` proxy;
- device authorization start and token exchange through the normal API origin;
- exchange pending/activated/closed/error outcomes, a server-timestamp expiry observation, pending cancellation by the existing deny action, active-device revoke and portal logout.

Consumers provide API and portal loopback origins, a loopback PostgreSQL URL whose database name includes `test`, `e2e` or `disposable`, an explicit `disposable: true` `*.test` identity, and a callback that supplies the generated local six-digit OTP fixture for the returned challenge. The callback contract does not read the database, mailboxes or logs. The driver does not connect to PostgreSQL or discover OTPs itself.

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

Call `exchangeDevice` again for a pending authorization; its idempotency key stays stable for that device code. `cancelDevice` maps to the product's normal denial action. `observeExpiredDevice({ deviceCode, expiresAt })` requires the supplied server expiry to have passed and then observes the same exchange API response; the API intentionally does not distinguish expiry from other closed terminal states. `revokeDevice` uses the portal CSRF cookie/header contract. No product auth rules, TTLs, schemas, migrations, signing or CSRF behavior changed.

## Evidence

The existing P2.2 OTP suite and P2.3 device authorization suite were read as the real service behavior baseline; C05 receipts were read for loopback/disposable and synthetic-identity boundaries. The new helper uses the existing route paths, cookie names, CSRF header, request bodies, response codes and required idempotency headers.

Added focused guard tests and a PostgreSQL/API integration test. It builds the real Fastify auth, device authorization and device management routes over a database that is checked for loopback host and a test/e2e/disposable name. `AuthService` generates a fixed test OTP fixture and the driver's injected callback supplies that fixture; no OTP is read from the database, mailbox or logs. The transport adapter uses `app.inject` and maps the portal proxy path to the real API routes; it does not start an API or portal server or claim portal UI/Next proxy acceptance. The test exercises cookies/CSRF, stable exchange idempotency, activation, cancellation, expiration through the existing expiry repository, revoke and logout.

Attempted bounded check:

```text
pnpm exec vitest run tooling/server/isolated-auth-lifecycle.test.ts tests/integration/server/isolated-auth-lifecycle.integration.test.ts
```

Result: **not run** because `vitest` is not installed in this child worktree (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). That attempt preceded the final DB-backed integration test change. A bounded Node TypeScript import/constructor smoke check passed, and a trailing-whitespace scan of the new files was clean. No package installation was attempted. Parent should run the final focused unit test and the integration file together with P2.2/P2.3 via the existing supervised `control.py heavy` path, with a named loopback disposable `DATABASE_URL`. No server, browser, database, worker or external endpoint was started here.

## Parent review boundary

Exact changed paths:

- `tooling/server/isolated-auth-lifecycle.ts`
- `tooling/server/isolated-auth-lifecycle.test.ts`
- `tests/integration/server/isolated-auth-lifecycle.integration.test.ts`
- `docs/development/coordination/receipts/B/ISOLATED_AUTH_LIFECYCLE_2026-10-01.md`

This is an uncommitted child-worktree source candidate. It contains no DB/server acceptance or live mailbox evidence. Parent owns review and Git operations.

## Parent verification — L2 2026-10-01
Parent read all four changed files and ran existing supervised B heavy with the B loopback disposable DB. Initial fixture incorrectly placed every device in 2020 and failed ordinary approval; corrected so only the expiry fixture uses past time, preserving real TTL/expiry code. Added a 10-second request deadline. Final focused checks: 8 guard tests plus 1 full PostgreSQL/API lifecycle test PASS. Supervisor exit 0, peak391MiB, cleanup verified.
Evidence: /root/octoport-control/controllers/L2/audits/night-idle-20261001T011816Z/b-auth-tests-r3.log. Prior failing logs retained; no unchanged full suite repeated. Transport is app.inject, not a running portal/browser; local generated OTP, no owner credentials. No product auth/DB/schema/TTL change. Candidate still needs normal B/C intake before main.
