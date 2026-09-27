# Subscription access v3 foundation — 2026-09-27

Status: **SOURCE CONTRACT FOUNDATION / DORMANT / NOT COMMERCIAL ENABLEMENT / NOT STORE-1 BLOCKER**

Authority: `docs/architecture/SUBSCRIPTION_ACCESS_POLICY.md`.

C defines the breaking signed-wire boundary as standalone `control_plane_v3`, `bootstrap_snapshot_v3`, and `bootstrap_envelope_v3`. Existing active v1/v2 unions remain unchanged, so the frozen Opera STORE-1 0.2.4 package continues to request and verify only v2.

## Exact shared contract

V3 adds required `subscriptionAccess`:
- paid commercial `ACTIVE`, `GRACE`, and period-preserving `CANCELED`: non-null `subscription_access_v1`;
- `paidThrough`: durable `currentPeriodEnd`, never `accessUntil` or `graceUntil`;
- `offlineHardUntil = paidThrough + 72h` exactly;
- `BETA`, `NONE`, and current non-paid `TRIAL`: `subscriptionAccess=null`.

The schema rejects ±1 ms hard-deadline drift and rejects a missing paid-access object for paid commercial eligible states. GRACE therefore cannot substitute `graceUntil` for `paidThrough`. The retained v3 `offlineGraceUntil` field is legacy wire/freshness data only: a future A consumer must ignore it when computing commercial cached offline entitlement, which is capped solely by `subscriptionAccess.offlineHardUntil`.

## Dormant boundary

This candidate adds standalone schemas/types and v3 sign/verify helpers only. It deliberately does not:
- add v3 to active request/snapshot/envelope unions;
- add v3 to compatibility/config-release runtime catalogs;
- wire API/bootstrap issuance;
- change DB/migrations or the 30-second lifecycle worker;
- change the STORE-1 package/runtime bytes;
- enable paid commerce or deployment.

## Ownership handoff

After this foundation is accepted:
- B owns bootstrap producer/API negotiation and mapping from commercial subscription truth to v3 fields; DB remains B-only if any DB work is later proven necessary.
- A owns v3 client verification/cache/effective-time enforcement and the shared approximately-24h refresh scheduler/single-flight behavior.
- C continues to own the shared wire contract, cross-consumer integration, CI and release gates.

## Verification

Independent read-only Luna review of the initial exact diff reported `READY_TO_TEST` with no material findings. Parent C then tightened the schema after source review showed server-commercial eligibility includes ACTIVE, GRACE and CANCELED; these states now require the paid access object, while TRIAL cannot fabricate paid dates.

Node 24.20.0 / pnpm 10.34.5 supervised checks:
- `@product/contracts` typecheck: PASS;
- `@product/remote-config` typecheck: PASS;
- focused contracts + remote-config tests: PASS;
- `docs:check`: PASS;
- `git diff --check`: PASS;
- resource job `895aeaeb43eb45a7b09988e37e0c90c5`: exit 0, cleanup verified, OOM 0.

A later full branch CI on the exact integrated C HEAD is still required before `ready-main`.

## Acceptance boundary

This receipt is SOURCE evidence only. It makes no LIVE_OWNER, DEPLOYMENT, billing-provider, marketplace, reviewer, catalog or store-submission claim. STORE-1 signed-v2/reviewer preparation remains a separate v2 gate and must not be blocked on future v3 commercial work.
