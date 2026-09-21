# M1-A commercial entitlement foundation — automated closure

Work ID: `M1-A-20260921-COMMERCIAL-ENTITLEMENT-AND-BILLING-NEUTRAL-FOUNDATION`

This is a provider-neutral preparation lane. It does not enable payments,
create real subscriptions, add checkout, select a payment vendor, change
pricing, or change the free-beta user experience.

## Git and scope

- Source accepted B2 HEAD: `90328d39327871187b5c34aaa2e818a142eb2ad6`
- Source accepted B2 tree: `3f8ddd7c0d19122285f6c2934ca285ee6d3aa9d6`
- Worktree: `/root/runtime-fixtures-m1`
- Branch: `feature/m1-commercial-entitlement-foundation-2026-09-21`
- Stream 2 files: unchanged.
- SMTP/Exim/email files: unchanged.
- Business Bridge and owner-test deployment: untouched.

## Initial gap batch

The repository already contained the accepted P4–P6 generic commercial
catalog, immutable plan revisions, entitlement resolution, simulator-only
billing ports, subscription lifecycle, billing-event idempotency, safe admin
reads, and signed Bootstrap integration. The reachable M1 gaps were:

| Classification | Finding | Disposition |
| --- | --- | --- |
| `ENTITLEMENT_MODEL_GAP` | No single Seller Agents projection described lifecycle, revision, source and provider reference at the capability boundary. | Added normalized provider-neutral event/record contracts and deterministic ledger fixture. |
| `BOOTSTRAP_POLICY_GAP` | The production composition had no explicit Seller Agents commercial-mode switch; commercial resolution was injectable by composition only. | Added `SELLER_AGENTS_COMMERCIAL_MODE`, default `DISABLED`, and gated production Bootstrap/device access. |
| `IDEMPOTENCY_GAP` | Existing payment-event idempotency did not provide a reusable normalized commercial-entitlement event boundary. | Added provider/event identity, revision ordering, duplicate and conflict semantics. |
| `LIFECYCLE_GAP` | Existing subscription states were richer than the Seller Agents capability policy needed. | Added deterministic `ACTIVE/GRACE/ENDED/SUSPENDED` projection. |
| `DOCUMENTATION_GAP` | Current owner-approved commercial truths and the free-beta/commercial boundary were not recorded in the current Stream-1 evidence. | This receipt records them. |
| `OWNER_DECISION_DEFERRED` | No owner-approved commercial display plan names, prices, trial policy, or payment provider exists for this lane. | No new plan names, prices, trials, or provider were invented. |

No `MIGRATION_GAP` was found: existing migrations 0008–0011 already provide
the accepted plan, entitlement, subscription and billing-event persistence;
this preparation adds no new persistent table.

## Current commercial truths

- `FREE_BETA`/wire basis `BETA` is a separate access basis, never a fake paid
  subscription.
- The current free-beta capability policy remains the four reviewed keys:
  `source.ozon`, `source.wildberries`, `ai.chatgpt`, and `ai.alice`.
- Commercial plan identity remains the existing immutable generic `plans.code`
  model. No new owner-approved commercial plan code was created here.
- Prices, trial duration, paid plan display names, device limits for paid
  plans, and provider selection remain owner decisions.

## Implemented boundary

`@product/entitlements/seller-agents-commercial-policy` provides:

- explicit `DISABLED | ENABLED` mode, with environment default `DISABLED`;
- one effective decision: `BETA`, `COMMERCIAL`, or `NONE`;
- normalized commercial fields: account, plan code, lifecycle, effective
  window, source, entitlement revision, external reference, and verified event
  version;
- deterministic composition into the existing signed entitlement vocabulary;
- exact capability projection that ignores unknown/limit keys, so a package
  capability is still required on the extension side.

`@product/billing` provides a provider-neutral normalized entitlement-event
contract and adapter boundary. `@product/billing-simulator` contains only a
deterministic fixture adapter; no external provider SDK, URL, credential,
checkout, webhook endpoint, or network call was added.

Event semantics are:

- `(provider,eventId)` is idempotent;
- reuse with a different normalized event is a conflict;
- lower entitlement revisions are stale and cannot overwrite current state;
- equal revisions with different content are conflicts;
- higher revisions replace the current normalized snapshot;
- account identity is part of the validated event and repository key.

## Access, autonomy and expiry

In the deployed application composition, commercial access is passed to
Bootstrap and device admission only when
`SELLER_AGENTS_COMMERCIAL_MODE=ENABLED`. The absent/default value is
`DISABLED`; admitted free-beta accounts continue through the existing beta
path. Existing signed authority remains authoritative for ordinary Work and
delivery; there is no billing call, payment-provider call, lease or heartbeat
per command. The existing client freshness boundary remains unchanged:
`FRESH` and accepted offline grace may continue, while `CACHE_EXPIRED` denies.

When commercial mode is eventually enabled, `ACTIVE` and valid `GRACE`
records can project authority; `ENDED`/`SUSPENDED` or an expired effective
window cannot. A server-learned cancellation affects the next signed refresh;
it does not silently revoke already-issued offline authority outside the
accepted signed expiry/grace boundary.

Provisional decision recorded:
`PROVISIONAL_OWNER_REVIEW-M1-COMMERCIAL-EXPIRY-20260921`.

## Admin, support, audit and privacy

Existing Q1-D RBAC remains authoritative. Admin safe subscription/commercial
reads expose only bounded identifiers, plan/state/revision and timestamps.
Support has read-only commercial visibility and no plan, entitlement, billing
or subscription mutation permission. Existing safe audit paths retain actor,
action, account/target, revision/reference and result metadata only. Card or
bank data, payment credentials, raw provider payloads, and provider secrets
remain outside Seller Agents.

## Database and migration safety

No migration was required. Existing P4–P5 schema constraints remain the
persistent source of truth: immutable published plan revisions, account-bound
entitlements, one current subscription per account, append-only transitions,
and unique provider event identity. The new in-memory repository is a
deterministic test fixture for the normalized adapter contract, not production
storage.

## Automated evidence

Node 24 parity target: `v24.20.0`.

Focused results before the full regression:

- entitlements: 28 passed;
- billing: 188 passed (including M1 event boundary tests);
- billing simulator: 42 passed;
- API typecheck: passed.

M1 coverage:

| ID | Result / evidence |
| --- | --- |
| M1-01 | PASS — commercial mode disabled preserves beta projection. |
| M1-02 | PASS — active synthetic entitlement projects commercial access. |
| M1-03 | PASS — one-market capability projection excludes the second marketplace. |
| M1-04 | PASS — both-market projection is exact. |
| M1-05 | PASS — unknown/limit values do not manufacture capability authority. |
| M1-06 | PASS — expired, ended and suspended access denies in enabled-isolated policy tests. |
| M1-07 | PASS — ordinary command path has no billing dependency. |
| M1-08 | PASS — ordinary delivery path has no billing dependency. |
| M1-09 | PASS — existing signed offline-grace boundary remains valid. |
| M1-10 | PASS — existing `CACHE_EXPIRED` boundary remains denial. |
| M1-11 | PASS — duplicate normalized event is idempotent. |
| M1-12 | PASS — stale revision cannot overwrite newer state. |
| M1-13 | PASS — concurrent event application is deterministic. |
| M1-14 | PASS — beta is not represented as a paid subscription. |
| M1-15 | PASS — existing Q1-D support role has no commercial mutation permission. |
| M1-16 | PASS — admin projection is safe and payment-secret-free. |
| M1-17 | PASS — audit uses normalized metadata only. |
| M1-18 | PASS — normalized event/client boundary has no provider secret field. |
| M1-19 | PASS — no browser payment-provider endpoint or client dependency. |
| M1-20 | PASS — server outage does not create per-command billing denial. |

The full Node 24 typecheck, lint, format, documentation, unit, PostgreSQL
integration, build, OpenAPI, API/auth/Bootstrap/admin/audit, compatibility,
privacy, application and bridge gates passed. No client runtime contract
change was introduced.

## Deferred boundaries

These are intentionally not executed in M1-A:

- `OWNER_EXTERNAL_ACTION_DEFERRED / FUTURE_PROVIDER_SELECTION`;
- real payment provider account, credentials, checkout and webhook setup;
- pricing/trial/legal decisions;
- S1.2 SMTP/Exim owner infrastructure actions and real OTP mailbox test;
- Q1-C owner/live sessions, browser-store publication, and production launch.

## Recommendation

This receipt is an automated implementation candidate only. Codex does not
self-accept it. Recommended architect disposition after review is recorded in
the terminal report.
