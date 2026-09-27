# Subscription access shared contract v3 — 2026-09-27

Status: **C CONTRACT ASSIGNMENT / SOURCE DEVELOPMENT AUTHORIZED / NOT STORE-1 BLOCKER / NO COMMERCIAL ENABLEMENT**.

Authority: `docs/architecture/SUBSCRIPTION_ACCESS_POLICY.md`.
This document assigns the shared wire boundary required by the already approved 24-hour refresh and `paidThrough + 72h` policy. It does not enable billing, change live data, authorize deployment, or alter the frozen STORE-1 Opera 0.2.4 package.

## Version decision

The new signed access semantics use:
- `control_plane_v3`;
- `bootstrap_snapshot_v3`;
- `bootstrap_envelope_v3`.

Existing v1/v2 wire bytes and semantics remain accepted for their existing clients. Do not add the new fields to emitted v2 payloads: the current 0.2.4 verifier enforces an exact strict v2 field set and would reject such payloads.

The v3 request keeps identified and privacy-neutral shapes. V3 remains dormant: its schemas and standalone cryptographic helpers are not added to active runtime unions or wired into API/bootstrap issuance. B owns producer/API negotiation; activation requires that later implementation and review.

## New signed fields

Every v3 snapshot has a required `subscriptionAccess` field, either `null` or `{ schemaVersion: "subscription_access_v1", paidThrough: ISO-8601 timestamp with offset, offlineHardUntil: ISO-8601 timestamp with offset }`.

`paidThrough` means the server-confirmed end of a paid commercial period. It is not `accessUntil`, `graceUntil`, short bootstrap expiry, or the timestamp of the last refresh.
`offlineHardUntil` is the fixed maximum offline continuation instant derived from a real `paidThrough`: exactly `paidThrough + 72h`. It must never be recomputed from a retry, restart, failed refresh, wall-clock rollback, business GRACE, or last-seen time.

Invariants:
1. When the object is present, `offlineHardUntil` equals `paidThrough + 72 hours` exactly; ±1ms is invalid.
2. `accessBasis=BETA` and `accessBasis=NONE` require `subscriptionAccess=null`.
3. `accessBasis=COMMERCIAL` with `ACTIVE`, `GRACE` or period-preserving `CANCELED` requires non-null `subscriptionAccess`; `paidThrough` is the durable `currentPeriodEnd`. GRACE must not substitute `graceUntil`.
4. `accessBasis=COMMERCIAL` with `TRIAL` requires `subscriptionAccess=null` until a separately proven paid period exists; the current model must not fabricate paid dates.
5. For paid periods B derives `paidThrough` from the durable paid-period boundary, not `accessUntil`. `graceUntil` remains a business-access date and is never substituted or extended by offline 72h.

The existing signed `expiresAt` and `offlineGraceUntil` are not renamed into these fields. During staged v3 implementation they remain legacy wire fields. For `accessBasis=COMMERCIAL`, `offlineGraceUntil` is **not** an offline-entitlement deadline and MUST NOT be combined with, substituted for, or allowed to extend `subscriptionAccess.offlineHardUntil`. A current verified online response can still govern online work according to its current server decision and freshness; once the client falls back to cached commercial authority, the fixed `offlineHardUntil` is the only commercial offline deadline. BETA keeps its separately defined legacy behavior. Removal or semantic repurposing requires a later explicit contract revision.

## Refresh policy

The approximately 24-hour refresh cadence is a client scheduling policy, not a new server expiry field. A schedules one shared refresh per installation while in use, with bounded jitter and single-flight across tabs.

The schedule is anchored only by a successfully verified current authority and the effective-time machinery; sleep/restart causes one overdue refresh, not catch-up bursts. Access-token refresh remains a separate single-flight and must not become the licence cadence.
## Authoritative deny and offline fallback

A verified current v3 snapshot with `accessBasis=NONE` is an authoritative deny for new business work. It replaces any older cached allow and advances the existing trusted-time/generation watermark so replaying the older allow cannot restore offline access.

Account/device/session revocation that prevents bootstrap issuance is handled through the existing authenticated refresh/bootstrap flow: A first performs the normal access-token refresh rules, so an ordinary expired short token is not itself a licence denial. A terminal current revocation/block response after that flow must invalidate business authority without falling back to a prior allow.

Offline use of a previously verified COMMERCIAL snapshot may continue only while the effective time is strictly before `offlineHardUntil`. Reaching the exact hard instant denies new marketplace requests until a new current server authority permits them.

A current online server decision may still express business GRACE according to server policy. The offline hard deadline is not a rewrite of server-side GRACE and does not delay server truth.

## Ownership and exact paths

C is the single shared-contract author for:
- `packages/contracts/src/index.ts` — standalone v3 request/snapshot/envelope schemas and types; active unions remain v1/v2 only;
- `packages/server/remote-config/src/index.ts` — standalone v3 signing/verification using the existing trusted key ring, signing domain and key binding; no producer service wiring;
- this C contract document and focused tests/fixtures.

B owns the server producer and DB boundary:
- `packages/server/bootstrap/src/index.ts` and focused tests;
- any required API/bootstrap composition changes in `apps/api/**`;
- commercial-access/subscription producer changes in `packages/server/**`;
- DB/migrations only if B proves the existing durable period boundary is insufficient.

A owns the client consumer after producer and negotiation support exists:
- `packages/control-client/src/crypto.js`;
- `packages/control-client/src/client.js`;
- `packages/control-client/src/autonomous-work-authority.js`;
- `apps/extension/src/application/runtime.js`;
- extension regression/browser fixtures for refresh, replay, restart and multi-tab behavior.
## Implementation order

1. C publishes the exact standalone shared v3 schemas and verification boundary without changing active unions or emitted v2.
2. B adds v3 producer support and proves `paidThrough` mapping, the exact +72h calculation, GRACE separation, BETA nulls, signed deny, and no new cron/service. Existing 30-second lifecycle worker is unchanged.
3. A adds v3 verification/cache/dispatch and the one-per-installation approximately-24h refresh scheduler. A must preserve old v2 support while STORE-1 0.2.4 remains deployed.
4. Only after both consumers are green may a compatibility/config release advertise v3 support to a new extension version. Do not send v3 to 0.2.4 and do not add fields to its v2 response.
5. Commercial go-live remains a separate gate; this source work does not enable billing.

## Required cross-consumer acceptance

At minimum:
- paid boundary at `paidThrough - 1ms`, exact `paidThrough`, and `+1ms`;
- hard boundary at `paidThrough + 72h - 1ms`, exact hard instant, and `+1ms`;
- GRACE where `graceUntil != currentPeriodEnd`, proving no substitution or stacking;
- BETA with both new commercial fields null and existing beta authority preserved;
- TRIAL/non-paid state with no fabricated paid dates;
- verified renewal replacing deadlines;
- verified current deny/revoke defeating an older cached allow;
- wrong account/device/session/context, bad signature, unknown key and replay fail closed;
- wall-clock rollback and process restart cannot extend either commercial timestamp;
- many tabs share one overdue refresh; browser sleep/reopen performs one refresh, not a burst;
- expired short access token refreshes through the existing auth single-flight without becoming a subscription denial;
- old v1/v2 fixtures and frozen 0.2.4 keep their exact current behavior.

## STORE-1 boundary

This contract is deliberately not a new blocker for the first Opera STORE-1 submission. The frozen package remains version 0.2.4 on `control_plane_v2`; its package/runtime bytes and current store minimum are evaluated independently.

STORE-1 still requires its existing concrete gates: ordinary verified admitted reviewer, cryptographically verified signed compatible v2 bootstrap/config on the intended reviewer path, supported catalog activation, truthful worker/portal rollback evidence, and the separate bounded live-operation authority.

No live service, database, billing provider, marketplace, reviewer identity, signing secret, catalog, or browser-store dashboard is changed by this assignment.

## Paid-boundary behavior

The exact `paidThrough` instant is a required refresh trigger, not by itself the offline deny instant. At `paidThrough`, the client attempts the normal current-authority refresh. If that attempt is unavailable and there is no known authoritative deny, the previously verified paid authority may continue only until the fixed `offlineHardUntil`. If a current verified response grants access (including a server-side state the server still treats as eligible), that current response governs online work; it must not move the old paid term or manufacture another 72-hour extension unless it contains a genuinely renewed `paidThrough`. A current verified deny/revoke blocks immediately.

Acceptance at the paid boundary therefore proves both branches: refresh is due at `paidThrough`; an unavailable refresh does not erase the fixed offline fallback; an authoritative deny does. The hard-boundary cases prove that absence of a newer permitting authority denies exactly at `offlineHardUntil`.
