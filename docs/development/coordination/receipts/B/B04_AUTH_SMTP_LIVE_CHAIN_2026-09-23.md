# B04 auth / SMTP / bootstrap / sync / revocation receipt — 2026-09-23

Role: B
Task: B04
Evidence levels: SOURCE + disposable PostgreSQL + read-only server/network observation.
LIVE_OWNER mailbox acceptance, deployment and production acceptance: NOT CLAIMED.

## Revisions

- Base/candidate ancestry includes `origin/main de45ce6c6b9dc99c79c4140e28043e17f10fdda5`.
- B04 implementation commit: `fe31ece8c954763625e6c0f19bbd0161784fcef8`.
- Independent read-only Luna review: `b04-auth-chain-review`, exit 0; no child edits were accepted blindly.

## Source fixes and regressions

1. OTP worker ambiguous crash recovery now fails closed.
   - Before: an expired `PROCESSING` lease was reclaimed and could call SMTP again even if the first worker had already reached remote acceptance before crashing.
   - After: expired or missing processing lease is marked `DEAD`, encrypted delivery bytes are cleared, and `LEASE_EXPIRED_UNKNOWN_OUTCOME` is recorded. Only known retryable SMTP failures explicitly returned to `PENDING` are retried.
   - PostgreSQL regression proves the recovered job is not resent and its secret payload is cleared.

2. Sync now rechecks durable extension authority inside the same transaction as the write.
   - Before: a bearer could authenticate in the API pre-handler, then device/session revocation could commit before repository apply, while the stale principal still wrote an ACKed sync state.
   - RED reproduction confirmed stale principal -> ACK before the fix.
   - After: repository checks and takes shared locks on session/device/account/user active authority before any sync receipt/entity write. A revocation committed first makes sync fail closed; if sync already holds the shared authority lock, revocation waits for that in-flight transaction.
   - API maps the transaction-time authority failure to the existing `401 UNAUTHORIZED` envelope. No shared contract/OpenAPI change was introduced.

3. Concurrent different-idempotency refresh race is now explicitly covered.
   - Current repository serialization already produces one successful rotation plus one `EXTENSION_AUTH_REUSE`, compromises the token family, and leaves exactly two refresh-token generations.
   - No refresh implementation change was required.

4. Missing `AUTH_ROOT_SECRET_B64` is explicitly covered as fail-fast source behavior.

## Verification

Toolchain: Node `v24.20.0`, pnpm `10.34.5`.

Final focused unit gate:
- `@product/email`: 9/9 PASS
- `@product/worker`: 16/16 PASS
- `@product/auth`: 9/9 PASS
- `@product/device-auth`: 9/9 PASS
- `@product/extension-auth`: 10/10 PASS
- `@product/bootstrap`: 60/60 PASS
- `@product/sync`: 16/16 PASS
- total: 129/129 PASS

Final disposable-PostgreSQL gate on B DB:
- auth/OTP: 14/14 PASS
- token-core/refresh: 12/12 PASS
- device management/revocation: 7/7 PASS
- authenticated bootstrap: 9/9 PASS
- sync: 7/7 PASS
- total: 49/49 PASS

API/package boundary:
- `@product/api`: 22 test files / 249 tests PASS
- OpenAPI check: PASS, no artifact drift
- auth/worker/api/db/sync typecheck: PASS
- focused ESLint zero warnings: PASS
- focused Prettier: PASS
- `git diff --check`: PASS

Logs:
- `/root/octoport-control/logs/B/b04-final-gate.log`
- `/root/octoport-control/logs/B/b04-source-final.log`
- `/root/octoport-control/logs/B/b04-final-static.log`
- `/root/octoport-control/logs/B/b04-refresh-sync-red.log`
- `/root/octoport-control/logs/B/b04-otp-idempotency-final.log`

## Read-only server / SMTP evidence

No message DATA, OTP, mailbox, credential or private message content was used.

Observed on the execution host:
- public egress IP: `78.17.68.165`;
- Exim active and enabled; primary hostname `mail.octoport.ru`;
- queue count 0 at observation;
- listeners present on 25/465/587;
- public A/MX/PTR/SPF/DKIM/DMARC records present;
- `https://api.octoport.ru/health/ready` and `https://app.octoport.ru/` returned HTTP 200;
- outbound TCP/25 from this same public egress reached SMTP greetings at Gmail, Outlook and Yandex MX hosts.

This proves current outbound TCP/25 reachability from the observed mail host path. It does NOT prove message acceptance, DKIM/DMARC authentication of a delivered message, inbox placement, OTP receipt, or owner login.

## Remaining B04 boundary

One legitimate owner-controlled mailbox is still required for a single real OTP end-to-end check: request OTP through the real application, observe receipt without exposing the code in evidence, complete verification, and confirm authenticated session/device/bootstrap/revocation behavior with sanitized evidence.

A-side client handoff remains independently required for client refresh single-flight and installed-browser sync/revocation behavior. B does not self-accept that evidence.

B04 source/server candidate is ready for C review, while LIVE_OWNER mailbox acceptance remains open.
