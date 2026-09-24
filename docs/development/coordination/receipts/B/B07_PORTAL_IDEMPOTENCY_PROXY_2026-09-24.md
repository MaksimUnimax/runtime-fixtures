# B07 portal OTP idempotency proxy forwarding — 2026-09-24

Status: SOURCE CANDIDATE. No live deploy, owner credential use, auth bypass, SQL fixture, or production mutation is claimed.

## Authority

C handoff:
- /root/octoport-control/logs/C/B07_PORTAL_IDEMPOTENCY_PROXY_REQUEST_2026-09-24.md
- controller notice SITE-AUTH-READINESS-20260924

Confirmed defect:
- portal OTP verify client already sends idempotency-key;
- the normal portal control-plane BFF forwarded only content-type, cookie, and x-csrf-token;
- idempotency-key was dropped before the downstream control-plane request.

## Fix

The BFF request-header whitelist now adds exactly one existing header:
- idempotency-key

No arbitrary pass-through was added. Existing content-type, cookie, x-csrf-token, route allowlist, response headers, set-cookie forwarding, error behavior, and control-plane origin validation remain unchanged.

Regression exercises the actual Next route POST handler with downstream fetch mocked only at the external boundary. It proves:
- exact idempotency-key value reaches downstream;
- content-type, cookie, and x-csrf-token still reach downstream;
- an unapproved arbitrary header is absent downstream;
- when idempotency-key is absent, the proxy does not invent one;
- existing route allow/reject and portal response-security checks remain green.

## Verification

Node 24.20.0 / pnpm 10.34.5.

Focused final gate:
- Prettier: PASS
- ESLint: PASS
- apps/portal control-plane route test: 23/23 PASS
- @product/portal typecheck: PASS
- resource job: 8ee1ccbd488f42a6bed3b436305eedf4
- exit 0, OOM 0, cleanup_verified
- peak 377487360 bytes

The earlier focused attempts that stopped on formatting or mock type inference are not acceptance evidence; the final successful job above supersedes them.

## Boundaries

- No auth redesign.
- No new public/shared contract.
- No arbitrary request-header forwarding.
- No live deploy.
- Independent from N2 S1/S2.
