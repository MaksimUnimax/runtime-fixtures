# Subscription state expiry correctness — B candidate — 2026-09-25

Status: **SOURCE + DISPOSABLE POSTGRESQL CANDIDATE. NO LIVE DB / NO DEPLOY / NO PAYMENT ACTION.**

Task: `SUBSCRIPTION_STATE_EXPIRY_CORRECTNESS_REVIEW`.

Controller source:
`/root/octoport-control/controller-notices/B-SUBSCRIPTION-NETWORK-REVIEW-20260924.json`.

## Confirmed defect class

The existing 30-second shared lifecycle worker remains the canonical background materializer. The defect was not its cadence by itself: synchronous commercial mutations could observe stale persisted non-`EXPIRED` state before the worker ran, so outcomes could depend on worker timing.

This candidate reuses one lifecycle classifier/materializer under the existing per-account transaction lock and applies it at mutation boundaries that require a current-subscription decision:

- manual grant;
- checkout preflight/prepare/finalize;
- verified billing webhook activation;
- reconciliation activation;
- extension of an existing subscription.

No new schema, migration, lifecycle cron, licensing service, client refresh policy, or offline entitlement window is introduced.

## Timing semantics

Two times are intentionally distinct:

1. **provider-effective chronology**
   - billing webhook `occurredAt`;
   - reconciliation `statusAt`;
   - used for payment confirmation, subscription start/current-period dates, and activation transition chronology.

2. **processing-time lifecycle classification**
   - grant/extend post-lock `now()`;
   - webhook `receivedAt`;
   - reconciliation `processedAt`;
   - used to decide whether persisted/current/new subscription state is already due at the moment the transaction is making an access-relevant decision.

If a delayed provider success creates a provider-derived period that is already fully elapsed at processing time, the new subscription is created with historical provider chronology and immediately materialized to `EXPIRED` in the same transaction. No stale `ACTIVE` access gap is left for the background worker.

## Lock / atomicity boundary

- account advisory lock remains first;
- subscription row locking follows inside the same transaction;
- lifecycle state update, transition, and audit are transaction-local;
- activation + immediate post-activation materialization are also transaction-local;
- thrown materializer/audit errors roll the whole transaction back.

This preserves worker/inline serialization and avoids duplicate lifecycle transitions.

## Independent Luna review loop

R1 found two P2 issues:
- grant captured time before account-lock and could wait across expiry;
- EXTEND could revive stale ACTIVE if the lifecycle worker had not yet materialized expiry.

Fixes:
- grant repeats period validation after account-lock using fresh post-lock time;
- EXTEND materializes due lifecycle after account+subscription locks before revision/state checks.

R2 found one P2:
- webhook/reconciliation classified existing subscription lifecycle at provider time, while the worker classifies at processing time.

Fix:
- lifecycle classification uses `receivedAt/processedAt`; provider times remain chronology only.

R3 found two P2s:
- delayed success could create an already-ended provider period as ACTIVE until the next worker pass;
- regressions did not directly prove worker-first/inline-first semantic equivalence.

Fixes:
- immediately materialize the newly activated subscription at processing time inside the same transaction;
- add paired worker-first/inline-first semantic-history regressions;
- add delayed-success regressions proving immediate `ACTIVE -> EXPIRED` with zero current non-expired subscriptions.

R4 result:
**No material findings remain.**

Review evidence:
- `/root/octoport-control/logs/B/subscription-expiry-correctness-review-r1-20260925-result.md`
- `/root/octoport-control/logs/B/subscription-expiry-correctness-review-r2-20260925-result.md`
- `/root/octoport-control/logs/B/subscription-expiry-correctness-review-r3-20260925-result.md`
- `/root/octoport-control/logs/B/subscription-expiry-correctness-review-r4-20260925-result.md`

## Verification

Required environment:
- Node `24.20.0`
- pnpm `10.34.5`

PASS:
- Prettier on touched scope
- ESLint on touched scope
- `@product/db` typecheck
- `git diff --check`
- `python3 tooling/coordination/control.py B guard`

Disposable PostgreSQL:
- P5.2 subscription lifecycle: **94/94 PASS**
- P5.3 simulated checkout: **103/103 PASS**
- P5.4 verified billing events after final timing fixes: **119/119 PASS**
- P5.5 reconciliation/lifecycle after final timing fixes: **123/123 PASS**

Key new regressions include:
- grant crosses expiry while waiting at the mutation boundary -> rejected without creating subscription;
- stale ACTIVE EXTEND materializes to EXPIRED before mutation;
- inline stale-subscription materialization vs lifecycle-worker-first produces the same semantic `ACTIVE -> EXPIRED` history;
- webhook delayed success whose entire provider period ended before processing commits the new subscription already EXPIRED;
- reconciliation delayed success has the same immediate-expiry behavior;
- reconciliation test fixtures preserve immutable checkout snapshot semantics.

## Explicit non-claims / remaining policy

This candidate does **not** implement or claim:
- client-side 24-hour subscription refresh;
- `paidThrough + 72h` offline entitlement;
- a 72-hour database lag;
- a new commercial licensing service;
- a new lifecycle worker cadence/cron;
- live payment-provider acceptance;
- production deployment or live DB mutation.

Those remain separate approved requirements / integration boundaries. This candidate only fixes correctness of the existing persisted subscription state machine so synchronous mutation outcome no longer depends on whether the 30-second lifecycle worker happened to run first.
