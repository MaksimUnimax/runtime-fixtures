# Subscription access policy — B server preparation — 2026-09-27

Status: **SOURCE INVENTORY + CURRENT-HEAD BASELINE VERIFIED. SHARED CONTRACT NOT YET ASSIGNED; NO WIRE/SCHEMA/API CHANGE.**

Task: `SUBSCRIPTION_ACCESS_POLICY_B_SERVER_PREP`.

Authority: `docs/architecture/SUBSCRIPTION_ACCESS_POLICY.md` is approved requirements, not implemented behavior. Current C assignment still owns the exact shared contract/version/path assignment for the 24h refresh and `paidThrough + 72h` policy.

Current B HEAD at inventory start: `f5f9c5251bbe813bd7ac4327ba8d0c2b8edac60f`.
Fresh `origin/main`: `7600f3ceb555c32ff798aac48f6c9613e8124ab2`.

## Existing authoritative server data

The subscription model already stores and projects `currentPeriodEnd` separately from optional business `graceUntil`. The DB current-subscription reader returns both fields without deriving one from the other.

The timestamp-authoritative access resolver also preserves both values. Commercial access currently exposes:
- `currentSubscription.currentPeriodEnd`;
- `access.currentPeriodEnd`;
- `access.graceUntil`;
- `accessUntil`, which is an access decision deadline, not a paid-through field.
For `TRIAL`, `ACTIVE` and `CANCELED`, current `accessUntil` is `currentPeriodEnd`. For `GRACE`, current `accessUntil` is deliberately `graceUntil`.

That distinction is material for the approved policy: a future `paidThrough` value must not be sourced from current `accessUntil` because a GRACE state can make `accessUntil > currentPeriodEnd`.

No new DB column is presently justified by the approved policy: the confirmed subscription period boundary already exists as `subscriptions.current_period_end`. This is preparation evidence only; C still assigns the shared contract and B must re-evaluate the exact field semantics at that boundary.

## Existing signed-bootstrap behavior is old semantics

Both current v1 and v2 bootstrap paths:
- start with a 15-minute signed `expiresAt`;
- start `offlineGraceUntil` at `expiresAt + 24h`;
- for COMMERCIAL, cap `offlineGraceUntil` to current `CommercialAccessSnapshot.accessUntil`;
- shorten `expiresAt` if necessary so `now < expiresAt < offlineGraceUntil`.

Therefore current `offlineGraceUntil` is neither the approved `paidThrough` nor the approved fixed `offlineHardUntil = paidThrough + 72h`.
In particular, a GRACE subscription currently caps signed bootstrap timing at `graceUntil`. The approved policy explicitly says not to stack business GRACE onto the offline 72-hour rule, so renaming or extending the old field would be semantically wrong.

BETA remains a separate access basis. Current beta bootstrap timing is independent of a real commercial deadline and must not receive a fabricated paid-through date.

The shared contract currently has only `issuedAt`, `expiresAt`, `offlineGraceUntil`, `serverTime`, `accessBasis` and the coarse subscription projection. There is no current `paidThrough` field. B did not edit this C-owned contract.

## B implementation seam after C assignment

Unless C's assigned contract proves otherwise, the smallest B consumer surface is expected to be:
1. keep `currentPeriodEnd` and `graceUntil` distinct in subscription/commercial access;
2. derive any confirmed paid-term value from the explicitly assigned subscription semantics, never from `accessUntil`;
3. have bootstrap/server signing populate the new versioned access fields assigned by C;
4. keep BETA separate and fail closed for ineligible/revoked/corrupted commercial authority;
5. keep the existing 30-second lifecycle worker unchanged;
6. add no licensing cron/service and no 72-hour DB lag.
No migration is proposed by this prep because the necessary period boundary is already durable. A migration remains B-owned if the final assigned contract demonstrates a real missing durable datum.

## Acceptance matrix reserved for the assigned contract

B-side tests after C publishes the shared field/version assignment must include at minimum:
- paid end -1 ms / exact end / +1 ms;
- `paidThrough + 72h` -1 ms / exact hard deadline / +1 ms;
- GRACE where `graceUntil != currentPeriodEnd`, proving no accidental substitution;
- long paid period with short signed refresh TTL;
- current renewal;
- authoritative current deny/revoke;
- BETA with no synthetic paid-through;
- corrupt/mismatched subscription authority fail-closed;
- unchanged 30-second lifecycle worker and the already accepted post-lock state materialization semantics.

Client scheduling/single-flight, replay/clock rollback and local dispatch enforcement remain A/shared-contract consumer work unless C assigns a precise B server seam.

## Current-head baseline verification

Focused current-head tests were rerun under the B resource supervisor with Node 24.20.0 / pnpm 10.34.5:
- `packages/server/commercial-access/src/index.test.ts`;
- `packages/server/bootstrap/src/index.test.ts`.

Result: **2 files, 91/91 tests PASS**.
Supervisor job: `66e11fde0e704d079296728868b8538a`.
Exit code 0, cleanup verified, OOM 0.
Log: `/root/octoport-control/logs/B/subscription-access-policy-server-inventory-r1.log`.
Log SHA256: `d6a7e3e8b26579cb2a60715e639aa2d91821c3d0cb6ffca65df8df012c74b3ba`.

This baseline includes the existing GRACE bootstrap deadline and timestamp-authoritative commercial access boundary tests; it does not claim the approved 24h/`paidThrough+72h` contract is implemented.

## Exact dependency / next action

Blocked source action: shared schema/version/path mutation is C-owned and has not yet been assigned. B must not create a competing wire format.

Ready continuation once assigned: implement only the B consumer/server portion against C's exact shared contract, then run focused unit + disposable PostgreSQL/bootstrap integration boundaries. Commercial enablement and live DB remain separately unauthorized.
