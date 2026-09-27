# A — passive subscription-access v3 cache/work authority — 2026-09-27

Status: **SOURCE + EXTRACTED PACKAGE PASS / PASSIVE CACHE AUTHORITY / REFRESH SCHEDULER STILL OPEN**

Task: `A_V3_PASSIVE_CLIENT_CONSUMER`.
Parent A head: `11a60b30c60bb9d9d06fba4ffffc1770759c6629`.
Authority: `docs/development/coordination/SUBSCRIPTION_ACCESS_CONTRACT_V3_2026-09-27.md`.
Controller assignment: `STREAMS-AUDIT-20260927-0857`.

## Scope

This checkpoint extends the already committed passive v3 verifier foundation into the existing cache/effective-time and autonomous Work-authority paths without activating v3 negotiation.

Changed behavior:
- restored cached v3 envelopes dispatch through the strict v3 verifier;
- staged cache binding allows packaged v2 to consume a verified cached v3 authority, while preserving the historical rejection of cached v2 under a mismatched packaged contract;
- v3 cache clock owner is bound to the verified payload contract;
- cached COMMERCIAL paid authority uses only `subscriptionAccess.offlineHardUntil` as its offline deadline;
- COMMERCIAL TRIAL has no paid offline fallback after `expiresAt`;
- BETA retains the separately defined legacy offline grace;
- v3 NONE denies new work;
- v3 trusted bootstrap server-time is an exact replay watermark for cached v3 authority;
- device/session/generation/cache-binding mismatches remain fail-closed;
- autonomous Work authority verifies v3 signatures and enforces the same time/replay/account/context boundary.

No outgoing request changed: `bootstrapRequest()` still sends `control_plane_v2`.
No compatibility catalog advertises v3 and frozen STORE-1 0.2.4 is unchanged as a release contract.
## Time and replay semantics

For cached COMMERCIAL ACTIVE/GRACE/CANCELED authority with a valid paid object:
- short `expiresAt` may become stale;
- stale cached use can continue only while effective time is strictly before `offlineHardUntil`;
- exact `offlineHardUntil` and +1 ms deny;
- a later legacy `offlineGraceUntil` cannot extend the paid commercial cache;
- process restart and wall-clock rollback cannot reduce the persisted effective-time floor.

For COMMERCIAL TRIAL:
- `subscriptionAccess=null`;
- the cache deadline is the short `expiresAt`;
- legacy `offlineGraceUntil` is not a paid fallback.

For BETA:
- existing beta legacy offline-grace semantics remain unchanged.

For NONE:
- signed authority does not authorize business work.

The v3 replay fence requires the cached signed `serverTime` to equal the current trusted bootstrap watermark. A signed older v3 envelope cannot be substituted over a newer trusted watermark. Existing v2 behavior is preserved.

## Identity/context boundary

Control-client cached authority remains bound to:
- device;
- session;
- generation;
- control/portal origins;
- exact verified payload contract;
- extension/browser identity;
- requested AI and trust-bundle fingerprint.

Credentials intentionally do not carry a separate accountId. The signed account identity is therefore checked against the caller's expected account at the autonomous Work-authority layer, where a v3 expected-account mismatch produces `DENY_ACCOUNT_MISMATCH`.
## Exact changed bytes

`packages/control-client/src/client.js`
SHA-256: `b7c2d8a0434f18bcbf12f8f9d2bc6de0f060e0f9d2af522aec8e45bbfda86a13`.

`packages/control-client/src/autonomous-work-authority.js`
SHA-256: `502b5a6afe624a57c6e9397c37e39eb76dc6e731c1ea7e422e5c1f0a710f13e3`.

`tests/regression/extension-core/client-i1/client-v3-passive-cache.mjs`
SHA-256: `adc15dd3f88028bb26c646c8a4cf3b02f78da658ab91a8cfac2c420959f4e2c1`.

`tests/regression/extension-core/client-i1/client-v3-passive-autonomous-authority.mjs`
SHA-256: `7dda92d81b4a338fe15d46389d4ac8b3b74b5c775ba8dca2c31e2c09e88f2d55`.

`tooling/checks/extension_i1.py`
SHA-256: `354b7aa57ebe2618956c3d5fd9871b2da543377851bd02401dced1b8bdbacf09`.

## Focused coverage

`client-v3-passive-cache.mjs` proves:
- restore before hard deadline;
- exact hard/+1 ms denial;
- legacy grace cannot extend commercial;
- restart + wall rollback cannot extend;
- device/session/generation/binding fences;
- older signed v3 replay rejected by trusted watermark;
- transport-failure cache fallback verifies cached v3 while actual outgoing bootstrap body remains v2;
- BETA grace retained;
- TRIAL has no paid offline fallback;
- signed NONE denies;
- expected-account mismatch denied by Work authority.

`client-v3-passive-autonomous-authority.mjs` independently proves:
- fresh, paid-through, pre-hard and exact-hard boundaries;
- COMMERCIAL TRIAL/BETA/NONE distinctions;
- contract binding;
- older v3 replay rejection;
- expected-account mismatch;
- bad signature;
- no outgoing v3 activity.
## Supervised I1 evidence

First run:
- output: `/tmp/octoport-a-v3-passive-cache-i1-r1`;
- result: **FAIL**;
- exact failure: existing source `i1-cache-time` contract-dimension regression;
- cause: an intermediate cache-binding change treated the verified payload contract as sufficient and weakened the historical packaged-contract mismatch fence;
- no candidate was accepted from this run.

Correction:
- restored one-way staged compatibility: verified v3 may be passively cached under packaged v2, but cached v2 under a mismatched packaged contract remains a context mismatch;
- exact verified cache-clock owner remains tied to the verified payload contract.

Second run:
- command: `python3 tooling/coordination/control.py A heavy -- python3 tooling/checks/extension_i1.py --output /tmp/octoport-a-v3-passive-cache-i1-r2`;
- resource unit: `octoport-test-a-040e132254764dbd9aa941982f016bd2.service`;
- result: **PASS**;
- gate processes: **160**;
- existing source `client-cache-time`: PASS;
- source v3 passive cache: PASS;
- source v3 passive autonomous Work authority: PASS;
- extracted package v3 passive cache: PASS;
- extracted package v3 passive autonomous Work authority: PASS;
- all existing I1 source/package regressions: PASS;
- repeat archive match: true;
- source/extracted bytes match: true;
- local-development ZIP SHA-256: `3c08d599aea172af4f4bae0383d754158466322775fdc76c5728ce3d23699003`;
- `installed_acceptance=false`.

This is SOURCE/PACKAGE evidence only.
## Remaining task boundary

Still open under the same controller assignment:
- shared approximately-24h refresh scheduling while in use;
- single-flight across tabs/contexts;
- one overdue refresh after sleep/reopen, not catch-up bursts;
- paidThrough refresh-due scheduling distinct from access-token refresh;
- verified renewal replacing the paid boundary;
- verified current deny/revoke defeating an older cached allow through the future compatible v3 acquisition path;
- no heartbeat/licensing service/per-action server request.

Those remaining items do not authorize v3 advertisement, production deployment, billing activation or a change to frozen STORE-1 0.2.4.
