# A04 — two installed-profile key transfer acceptance — 2026-10-01

Status: **PASS — INSTALLED_SYNTHETIC / LOCAL DEVELOPMENT; NOT STORE / LIVE_OWNER / DEPLOYMENT / PRODUCTION**

Task: `A04-TWO-INSTALL-KEY-TRANSFER`.

Harness implementation commit: `6e4c57daa9b70248e9540021ecb26e725dcc2e7b`.
Harness SHA-256: `f639669aab337e793eb53ed26e53691a869096f50c3ac42df16c95fa771fa212`.
Base used by the final installed run: `ff4a83a453b405feb259b2370bb7b146582bf65e`.

## Why this is a new result rather than a repeat of A02/B03

The existing A02+B03 joint acceptance already proved the durable recipient vault, non-extractable P-256 private key, restart recovery, exact-idempotent request/packet/ACK behavior and no credential re-application on replay.

The current 0.2.11 source and package also retain the accepted popup receive fix. Before creating this harness A verified on the frozen STORE0.2.11 extracted runtime:
- `client-transfer-popup-receive.mjs`: 5/5 PASS;
- `client-transfer-recipient-recovery.mjs`: TRR-01 through TRR-08 PASS.

The accepted transfer client/server/runtime inputs had not changed since their joint acceptance. Therefore A04 adds only the missing installed two-profile user/lifecycle evidence: ordinary authorization of both installations, source restart, recipient restart, explicit consent/refusal, account isolation, cancellation and expiry.

No transfer protocol, runtime, server route, DB schema, auth rule or marketplace logic was changed.

## Final exact installed package

Final supervised run:
`/root/octoport-control/logs/A/a04-two-install-key-transfer-20261001/run-r6/result.json`

Exact retained ZIP:
`/root/octoport-control/logs/A/a04-two-install-key-transfer-20261001/run-r6/SELLER_AGENTS_I1_C1_v0.2.11_LOCAL_DEVELOPMENT.zip`

ZIP SHA-256:
`6010d07dc1165535820732fd5fc5c8912d6707732b86cc829e688f3cb5e6d84b`

ZIP bytes: `2278225`.

Composition receipt:
`/root/octoport-control/logs/A/a04-two-install-key-transfer-20261001/run-r6/composition-receipt.json`

Package:
- version `0.2.11`;
- build mode `development`;
- environment `LOCAL DEVELOPMENT`;
- source HEAD `ff4a83a453b405feb259b2370bb7b146582bf65e`;
- runtime input SHA-256 `88e7bec45a03ebc252c2bccf48126aa7b2f11e7c1b326b8adc589611bc3650c0`;
- observed Chromium `151.0.7922.34`.

The retained ZIP hash was read back after the run and still equals the result record. Its extracted bytes independently PASS the popup receive 5-case regression and TRR-01..TRR-08 recipient-recovery matrix.

This is a test-only local package with process-local test trust. It is not a STORE candidate and must not be registered as READY_FOR_OPERATOR.

## Installed scenario proved

R6 used A's supervised `heavy --db --profile e2e` boundary and A's own disposable PostgreSQL.

The main transfer pair consisted of two independent persistent Chromium profiles:
- source installation;
- recipient installation.

Both performed the ordinary local OTP/device approval flow into the same synthetic fixture account and received different device identities. A separate fixture account was brought up only for the bounded cross-account negative check; at most two browser contexts were kept live together.

The scenario proved:
- refusal without explicit transfer consent creates no recipient request;
- explicit consent creates exactly one durable recipient request;
- recipient browser restart restores the same ACTIVE request and its non-extractable private ECDH key; JWK export is rejected;
- source browser restart preserves its local selected-store credentials and can discover/send the existing request;
- recipient receives/imports once;
- the successful request reaches server `COMPLETED`;
- exactly one packet GET and one ACK POST are observed;
- after recipient restart the selected credential revision is unchanged, no active transfer is presented and packet/ACK counts do not increase;
- a different-account installed profile cannot read or cancel the request;
- the rightful recipient can cancel a later request; server state is `CANCELLED`, recipient vault entry is removed and imported credentials do not change;
- a later request with the minimum bounded 60-second TTL is expired by changing only that row's `expires_at` inside A's disposable DB; the normal authenticated read/receive path exposes `EXPIRED`, prunes the recipient vault entry and does not alter imported credentials;
- cancelled/expired terminal requests are absent from the source pending list;
- provider business requests: 0;
- AI POSTs: 0.

The expiry DB write is test setup inside the disposable database only. Production schema, migration and runtime semantics are unchanged; the production PostgreSQL repository itself performs the normal transition to `EXPIRED` on read when `expires_at <= now`.

## Resource evidence

Resource receipt:
`/root/octoport-control/resource-jobs/b72eccad015d4daca5673c7bb48a57d7/receipt.json`

R6:
- command exit: 0;
- systemd result: success;
- OOM kills: 0;
- cleanup verified: true;
- peak memory: 1,716,518,912 bytes.

## Retained rework history

Earlier attempts remain evidence and are not hidden or counted as PASS:
- old helper email construction used a different fixture namespace, so closed-beta ordinary login correctly returned 403;
- an early harness kept three browser contexts live simultaneously and timed out waiting for a worker; the final harness keeps at most two live contexts;
- the first expiry helper used top-level await in `tsx -e`; it was replaced by an async IIFE without product changes;
- R5 passed the full behavior but its temporary ZIP was removed at teardown, so R6 repeated the same bounded scenario specifically to retain the exact tested artifact for independent verification.

These were harness/evidence defects. No product transfer defect was reproduced in the final current 0.2.11 local package.

## Evidence limits

Not proven here:
- STORE0.2.11 transfer compatibility on the immutable STORE SHA;
- LIVE_OWNER credentials or a real customer account;
- real email delivery;
- Windows/Yandex/Firefox/Safari transfer behavior;
- Ozon/Wildberries live provider calls;
- deployment, production or store submission;
- manual operator acceptance.

Independent review of the final candidate is mandatory before queue completion. The reviewer result is stored in control evidence and must bind the exact final Git candidate; this source receipt alone is not self-acceptance.
