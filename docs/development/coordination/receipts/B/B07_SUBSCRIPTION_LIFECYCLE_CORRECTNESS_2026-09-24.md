# B07 subscription lifecycle mutation correctness — 2026-09-24

Status: SOURCE + DISPOSABLE POSTGRESQL CANDIDATE. No production DB mutation, deployment, payment, beta opening, store publication, or N2 wire/schema change is authorized or claimed.

## Authority

- Controller notice: SUBSCRIPTION-NETWORK-REVIEW-20260924.
- Approved policy: docs/architecture/SUBSCRIPTION_ACCESS_POLICY.md.
- Relevant B-owned defect: mutating activation paths treated every state <> EXPIRED row as occupying the subscription slot even when its authoritative paid/trial period had already ended and the 30-second lifecycle worker had not materialized the terminal transition yet.
- Access resolution itself was already date-aware; this change does not add a server-side 72-hour grace. The optional 72-hour allowance remains extension-local only.

## Fix

A single internal DB helper now materializes the existing lifecycle decision while the caller already owns the account advisory lock.

Lock/order for inline lifecycle materialization:
1. p5-subscription-account:<accountId> advisory lock (held by caller).
2. p5-subscription:<subscriptionId> advisory lock.
3. subscription row FOR UPDATE.
4. latest transition/history validation.
5. existing decideSubscriptionLifecycle decision.
6. atomic state/history/audit mutation in the caller transaction.

The helper is reused by:
- the existing 30-second lifecycle worker;
- manual subscription grant;
- checkout prepare;
- checkout finalize after provider return;
- verified billing success activation;
- billing reconciliation success activation.

Semantics preserved:
- due TRIAL / ACTIVE / CANCELED -> EXPIRED;
- due GRACE -> PAST_DUE and still occupies the current-subscription slot;
- PAST_DUE remains blocking;
- SUSPENDED with valid TRIAL / ACTIVE / CANCELED / GRACE origin expires when due according to the existing lifecycle decision;
- SUSPENDED with valid PAST_DUE origin is a NOOP and remains blocking;
- malformed or incoherent subscription/history state is CORRUPTED and fails closed;
- history must agree with the persisted current state; missing/mismatched latest transition is corruption rather than an opaque service retry;
- lifecycle transition source remains JOB, actor SYSTEM, stable subscriptionLifecycleJobIdentity, reason from the existing decision, occurred_at = decision dueAt;
- worker replay after inline materialization produces no duplicate lifecycle transition/audit.

Checkout authorization remains before any inline lifecycle side effect. An unauthorized/non-owner prepare cannot mutate subscription history.

No schema migration or partial-index change was required. The current state-based unique index remains the concurrency guard after the due row is atomically materialized to EXPIRED. Read-only portal/access/current-subscription reads remain non-mutating.

N2 cross-browser sync/wire/schema was not changed in this candidate.

## Exact base

Candidate work was applied after merging fresh origin/main into B:
- merged B base before this diff: 8a708cfe1ad5e851d010970052e1a404b644bd9c
- C/main included the approved subscription access policy and unrelated current integration work.
- No relevant P5 files changed on main between the child base and the merge, so the reviewed lifecycle diff applied without semantic conflict.

## Verification

Node 24.20.0 / pnpm 10.34.5.

Final static gate:
- Prettier focused files: PASS
- ESLint focused files: PASS
- @product/db typecheck: PASS
- resource job: 4c4fb4a88f94406283335e420633f7cc
- exit 0, OOM 0, cleanup_verified
- peak 725614592 bytes

Disposable PostgreSQL final evidence:
- P5.2 subscription lifecycle: 95/95 PASS
  - job 0deb7c3a4dae4276a1ba016d33800ab0
  - log /root/octoport-control/logs/B/b07-p52-final-20260924.log
  - includes inline ACTIVE expiry, exact worker identity/history/audit, malformed SUSPENDED fail-closed, due GRACE -> PAST_DUE blocking, valid SUSPENDED(PAST_DUE) blocking NOOP, worker replay no duplicate audit.
- P5.3 checkout: 105/105 PASS
  - job 2152ffe66c844913ad0d9798002cdd3b
  - log /root/octoport-control/logs/B/b07-p53-r3-20260924.log
  - includes due ACTIVE admission, unauthorized no-side-effect, due-between-prepare/finalize, current subscription precedence, all existing checkout concurrency/audit semantics.
- P5.4 verified billing events: 118/118 PASS
  - job 140fbd490ad94a70a4d99968b7e98ada
  - log /root/octoport-control/logs/B/b07-p54-p55-r3-20260924.log
  - includes due ACTIVE expiry before activation and due GRACE remaining a current-subscription conflict.
- P5.5 reconciliation/lifecycle: 122/122 PASS
  - same successful job 140fbd490ad94a70a4d99968b7e98ada
  - includes due ACTIVE repair activation and due GRACE -> PAST_DUE blocking, plus existing lifecycle boundary matrix.

Total final targeted PostgreSQL: 440/440 PASS.

Earlier exploratory jobs that failed because of newly-added noncanonical test fixtures or intermediate typecheck formatting/redeclaration issues are NOT acceptance evidence. They were corrected and replaced by the successful final jobs listed above.

## Remaining boundary

This candidate resolves only the B-owned lifecycle/state correctness part of SUBSCRIPTION-NETWORK-REVIEW-20260924.

N2 cross-browser synchronization/wire schema remains outside this B candidate and must follow the C-owned common contract/ownership boundary. No owner action is required for this source fix.
