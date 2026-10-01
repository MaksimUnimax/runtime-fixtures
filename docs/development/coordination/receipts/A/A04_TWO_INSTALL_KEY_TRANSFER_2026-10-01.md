# A04 — two installed-profile key transfer acceptance — 2026-10-01

Status: **PASS — INSTALLED_SYNTHETIC / LOCAL DEVELOPMENT; NOT STORE / LIVE_OWNER / DEPLOYMENT / PRODUCTION**

Task: `A04-TWO-INSTALL-KEY-TRANSFER`.

Harness implementation commit: `6e4c57daa9b70248e9540021ecb26e725dcc2e7b`.
Reviewer-driven network instrumentation fix: `6be73fefdef204970a02ab3fb7f628aa06b70e96`.
Final harness SHA-256: `a5f8ca1649704f9fe0a7ebed4c09bac88527e2d26013e7802670dbfd0a46a6fe`.

## Why this is a new result rather than a repeat of A02/B03

The existing A02+B03 joint acceptance already proved the durable recipient vault, non-extractable P-256 private key, restart recovery, exact-idempotent request/packet/ACK behavior and no credential re-application on replay.

The current 0.2.11 source and package also retain the accepted popup receive fix. Before creating this harness A verified on the frozen STORE0.2.11 extracted runtime:
- `client-transfer-popup-receive.mjs`: 5/5 PASS;
- `client-transfer-recipient-recovery.mjs`: TRR-01 through TRR-08 PASS.

The accepted transfer client/server/runtime inputs had not changed since their joint acceptance. Therefore A04 adds only the missing installed two-profile user/lifecycle evidence: ordinary authorization of both installations, source restart, recipient restart, explicit consent/refusal, account isolation, cancellation and expiry.

No transfer protocol, runtime, server route, DB schema, auth rule or marketplace logic was changed.

## Final exact installed package

Final reviewer-driven supervised run:
`/root/octoport-control/logs/A/a04-two-install-key-transfer-20261001/run-r7/result.json`

Exact retained ZIP:
`/root/octoport-control/logs/A/a04-two-install-key-transfer-20261001/run-r7/SELLER_AGENTS_I1_C1_v0.2.11_LOCAL_DEVELOPMENT.zip`

ZIP SHA-256:
`e128361ef14009c8b65779d145fc9c02e2ff441a67a007cdd411e14d0edd4303`

ZIP bytes: `2278225`.

Composition receipt:
`/root/octoport-control/logs/A/a04-two-install-key-transfer-20261001/run-r7/composition-receipt.json`

Package:
- version `0.2.11`;
- build mode `development`;
- environment `LOCAL DEVELOPMENT`;
- package build Git HEAD `a5def035948606c6a581b9b0408533c3f99f793e`;
- runtime input SHA-256 `88e7bec45a03ebc252c2bccf48126aa7b2f11e7c1b326b8adc589611bc3650c0`;
- observed Chromium `151.0.7922.34`.

The package build HEAD predates only the test-harness network-instrumentation commit `6be73fef`; that commit changes no product/runtime input. The recorded runtime input SHA is unchanged.

The retained R7 ZIP hash was read back after the run and still equals the result record. Its extracted bytes independently PASS the popup receive 5-case regression and TRR-01..TRR-08 recipient-recovery matrix.

This is a test-only local package with process-local test trust. It is not a STORE candidate and must not be registered as READY_FOR_OPERATOR.

## Installed scenario proved

R7 used A's supervised `heavy --db --profile e2e` boundary and A's own disposable PostgreSQL.

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
- Ozon/Wildberries provider business requests observed by the installed browser contexts: 0;
- POSTs to all AI origins packaged for this extension version (`chatgpt.com`, `chat.openai.com`, `alice.yandex.ru`): 0.

The expiry DB write is test setup inside the disposable database only. Production schema, migration and runtime semantics are unchanged; the production PostgreSQL repository itself performs the normal transition to `EXPIRED` on read when `expires_at <= now`.

## Resource evidence

Resource receipt:
`/root/octoport-control/resource-jobs/36579990ddd14857a0b1319f5da790f4/receipt.json`

R7:
- command exit: 0;
- systemd result: success;
- OOM kills: 0;
- cleanup verified: true;
- peak memory: 1,718,616,064 bytes.

## Retained rework and review history

Earlier run records are retained and are not counted as PASS. They directly show:
- OTP verification returning 403 in early harness attempts;
- one service-worker startup timeout;
- one expiry-helper command failure;
- R5 passing the full behavioral scenario while its temporary package was not retained.

The parent diagnosed fixture-namespace/account setup, simultaneous-context sequencing and the `tsx -e` helper form while correcting those attempts. The retained failed run records do **not** independently establish every causal diagnosis, so this receipt does not present those diagnoses as separately proven product facts. None of the retained failures records a transfer-product failure after the transfer scenario itself was reached.

R6 then PASSed with a retained exact artifact. The first independent Luna review of candidate `a5def035` returned **REWORK_REQUIRED** for two evidence issues:
1. its AI POST counter did not include the packaged Alice origin;
2. the earlier rework causes were stated more strongly than the retained evidence independently supported.

Commit `6be73fef` fixed the network instrumentation to exact packaged AI hostnames, and this receipt narrows the historical claims. R7 is the reviewer-driven rerun of that corrected harness and is the final installed evidence.

A fresh independent review of the final candidate is mandatory before queue completion. Its result is stored in control evidence; this source receipt alone is not self-acceptance.

## Evidence limits

Not proven here:
- STORE0.2.11 transfer compatibility on the immutable STORE SHA;
- LIVE_OWNER credentials or a real customer account;
- real email delivery;
- Windows/Yandex/Firefox/Safari transfer behavior;
- Ozon/Wildberries live provider calls;
- deployment, production or store submission;
- manual operator acceptance.
