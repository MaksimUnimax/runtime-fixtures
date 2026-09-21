# M1-B commercial device / installation admission foundation — automated closure

Work ID: `M1-B-20260921-COMMERCIAL-DEVICE-INSTALLATION-LIMIT-FOUNDATION`

This is a reversible server-side foundation. It does not enable commercial
limits, billing, checkout, payment providers, or a new runtime authority model.
The active product mode remains FREE_BETA.

## Git and scope

- Start HEAD: `ed034599493ee564b9252960cf6f142d668e2a67`
- Start tree: `354a5ac06c89c3c9f8021d1c35027f997bcc1abd`
- Worktree: `/root/runtime-fixtures-m1b`
- Branch: `feature/m1b-commercial-device-limit-foundation-2026-09-21`
- Node: `v24.20.0`
- SMTP/Exim worktree: not touched.
- Stream-2 implementation paths: not touched.
- Business Bridge, deployment VPS, owner packages and production: not touched.

## Initial failure/gap batch

The existing P2.5 activation implementation already had the required
transaction boundary, account advisory lock, active-device count, replay
idempotency, account foreign keys and revoke lifecycle. The reachable M1-B
gaps were:

| Classification | Finding | Disposition |
| --- | --- | --- |
| `DEVICE_LIMIT_POLICY_GAP` | No explicit `UNLIMITED | positive finite` device-limit value or pure decision contract. | Added the strict model and decision function. |
| `ENTITLEMENT_MAPPING_GAP` | M1-A commercial records did not carry an optional future device-limit projection. | Added an optional provider-neutral device-limit field; current records remain unchanged. |
| `DEVICE_ADMISSION_GAP` | The accepted atomic SQL gate was not explicitly bound to the new policy function. | Positive finite activation decisions now use the shared pure policy inside the existing transaction. |
| `ADMIN_VISIBILITY_GAP` | Safe device allowance and safe device metadata existed in separate accepted admin surfaces. | Documented the composed read model; no secret-bearing endpoint was added. |
| `DOCUMENTATION_GAP` | Counted unit, lower-limit behavior and no-lease boundary were not recorded in current M1 evidence. | This receipt records the accepted boundary and provisional policy. |
| `OWNER_DECISION_DEFERRED` | No owner-approved paid numeric limit, replacement policy or forced-revocation policy exists. | No numeric production value was selected. |

No `DEVICE_IDENTITY_GAP`, `CONCURRENCY_GAP`, `IDEMPOTENCY_GAP`,
`REVOCATION_GAP`, `PRIVACY_GAP`, `AUTONOMY_REGRESSION` or `MIGRATION_GAP` was
found after inspecting the existing lifecycle and PostgreSQL tests.

## Existing device lifecycle and counted unit

The existing authenticated server device row is the counted unit:

`device_authorization approval -> transactional exchange -> ACTIVE devices row
and session -> refresh/session use -> REVOKED device on explicit revoke`.

One slot means one account-bound `devices.id` row. The implementation does not
count tabs, dialogues, Work contexts, stores, marketplaces, service-worker
restarts, browser restarts, commands or reports. Exchange replay returns the
existing device/session during the bounded replay window and does not insert a
second device.

No second device identity, browser fingerprint, canvas/font fingerprint,
history fingerprint or IP-derived identity was introduced.

## Future limit model and admission boundary

`@product/entitlements` now exports `SellerAgentsDeviceLimitSchema`:

- `{ kind: "UNLIMITED" }`; or
- `{ kind: "FINITE", value: positive safe integer }`.

`decideSellerAgentsDeviceAdmission` is the single pure decision for a future
new-device admission. Existing admitted devices are idempotently admitted;
new devices are admitted below a finite limit, admitted for `UNLIMITED`, and
denied at/above a finite limit with `DEVICE_LIMIT_REACHED`.

The existing PostgreSQL exchange transaction remains the enforcement point. It
locks the account with a transaction-scoped advisory lock, verifies the owner
and account, counts `devices.status = 'ACTIVE'`, makes the decision, and only
then inserts the device/session/refresh rows. The final-slot race therefore
cannot be implemented as an unsafe read-count-then-insert sequence.

The historical `maxActive = 0` compatibility value remains deny-all for the
older generic resolver contract. New M1-B plan values do not permit zero.

Current production behavior is unchanged:

- `SELLER_AGENTS_COMMERCIAL_MODE` remains `DISABLED` by default;
- FREE_BETA resolves to the existing `BETA_UNLIMITED_FOR_COMMERCIAL_COUNT`
  path;
- the effective beta device limit is `UNLIMITED`;
- no numeric production limit was selected;
- no payment or checkout is required.

The M1-A resolver remains the one commercial entitlement chain. The optional
device-limit projection is provider-neutral and is not a payment-provider SKU.
The existing signed Bootstrap permission vocabulary remains authoritative; the
device limit is server-side admission policy, not a browser capability.

## Idempotency, concurrency and account isolation

The accepted P2.5 PostgreSQL exchange uses row locking on the authorization,
an account advisory transaction lock and an exchanged-authorization replay
record. Duplicate exchange requests cannot create another device. Two new
authorizations racing for the final slot produce exactly one activation and
one `DEVICE_LIMIT_REACHED` result. Account A's lock/count/query uses A's
account ID and cannot consume account B's capacity. Caller-supplied counts,
limits, entitlement objects or authorization booleans are not read by the
server policy.

Existing device revoke changes the device to `REVOKED`; the active count then
releases that capacity. There is no automatic inactivity deletion and no new
production device-removal UX in this task.

## Autonomy and no runtime lease

No heartbeat, renewable lease, active-tab count, central browser lock or
per-command/per-delivery device-limit request was added. Ordinary command and
delivery paths do not call device admission. A legitimately admitted device
continues under the existing signed authority freshness boundary:

- `FRESH`: allowed;
- `STALE_BUT_OFFLINE_GRACE_ELIGIBLE`: allowed according to accepted grace;
- `CACHE_EXPIRED`: denied as before.

Server outage neither frees nor consumes a slot and does not revoke an
admitted device. Lowering a future limit does not shorten signed authority.

## Provisional lower-limit policy

Recorded decision:
`PROVISIONAL_OWNER_REVIEW-M1-DEVICE-LIMIT-DECREASE-20260921`.

Until owner policy changes it, lowering a future limit does not revoke already
admitted devices or break their issued offline authority. It blocks new
admission while the active count is at/above the new limit. Existing explicit
revoke/removal releases capacity. Forced replacement/revocation remains an
owner decision.

## Admin, support, audit and privacy

The existing safe admin projections compose:

- commercial subscription read: effective basis, safe allowance, active count,
  remaining/over-limit state, plan/revision and timestamps;
- admin device read: safe device ID, status, label, browser/version metadata,
  created/activated/last-seen/revoked timestamps.

Q1-D RBAC remains authoritative. Support can inspect bounded approved metadata
but cannot change plan/entitlement, grant capacity or bypass admission. Admin
commercial/device views contain no marketplace credentials, cookies, extension
storage, raw reports, AI bodies, OTPs or private keys. System activation-limit
audit records contain only action, target, correlation ID and safe decision
metadata. No browser fingerprinting was added.

## Database and migration safety

No migration was required. Existing `devices` and `device_authorizations`
schema, account/device foreign keys, ACTIVE/REVOKED enum and P2.5 exchange
constraints already provide the required persistence. Existing beta device
rows are preserved. The real PostgreSQL suite was run against the local
disposable database after migrations were applied idempotently.

## M1-B test matrix

| ID | Result / evidence |
| --- | --- |
| M1B-01 | PASS — commercial mode disabled and beta resolver preserve current admission; S1.1/P2.5 integration. |
| M1B-02 | PASS — beta uses the explicit unlimited commercial-count path; no numeric beta cap. |
| M1B-03 | PASS — pure unlimited policy admits multiple synthetic devices. |
| M1B-04 | PASS — finite policy admits counts strictly below the configured synthetic limit. |
| M1B-05 | PASS — finite policy denies the device at/above the limit. |
| M1B-06 | PASS — exchanged authorization replay is idempotent and returns the same device/session. |
| M1B-07 | PASS — browser restart reuses existing session/device; no activation call is introduced. |
| M1B-08 | PASS — service-worker restart has no device-admission input or lease. |
| M1B-09 | PASS — dialogue is outside device-management inputs. |
| M1B-10 | PASS — store is outside device-management inputs. |
| M1B-11 | PASS — marketplace switch is outside device-management inputs. |
| M1B-12 | PASS — ordinary command path has zero device-limit calls. |
| M1B-13 | PASS — ordinary delivery path has zero device-limit calls. |
| M1B-14 | PASS — existing signed authority path is unchanged. |
| M1B-15 | PASS — existing offline-grace tests remain green. |
| M1B-16 | PASS — existing CACHE_EXPIRED denial remains green. |
| M1B-17 | PASS — admission is server-transactional; outage does not mutate device rows. |
| M1B-18 | PASS — P2.5 real PostgreSQL final-slot race yields one activation and one limit denial. |
| M1B-19 | PASS — duplicate exchange/retry cannot double-consume. |
| M1B-20 | PASS — account-scoped lock/count and account FK isolate accounts. |
| M1B-21 | PASS — existing revoke changes ACTIVE to REVOKED and releases capacity. |
| M1B-22 | PASS — lower-limit policy preserves existing admitted devices. |
| M1B-23 | PASS — lower-limit policy denies new admission at/above the lower limit. |
| M1B-24 | PASS — support has no capacity-bypass or entitlement mutation authority. |
| M1B-25 | PASS — support cannot mutate commercial entitlement under Q1-D RBAC. |
| M1B-26 | PASS — admin projections are safe metadata only. |
| M1B-27 | PASS — activation-limit audit is safe metadata only. |
| M1B-28 | PASS — no fingerprinting code or dependency was introduced. |
| M1B-29 | PASS — extension/package tree has no billing/provider secret. |
| M1B-30 | PASS — browser has no payment-provider endpoint or dependency. |
| M1B-31 | PASS — existing multi-browser behavior is untouched and beta remains unlimited. |
| M1B-32 | PASS — no central browser execution lease exists or was added. |
| M1B-33 | PASS — no heartbeat is required to retain an admitted device. |
| M1B-34 | PASS — PostgreSQL migration/upgrade suite preserves current device schema and rows. |
| M1B-35 | PASS — no extension/client contract or production package changed. |

Focused added policy tests: 9 passed. Existing device-management, commercial,
Bootstrap, admin/RBAC and audit suites passed. Node 24 full workspace unit/API
regression passed. Real PostgreSQL integration passed: 41 files, 1,535 tests.
Build, OpenAPI, lint, typecheck, format, docs check and Bridge guard passed.

## Deferred decisions and boundaries

- Owner must later choose paid plan numeric limits and any replacement policy;
  no such number was selected here.
- `PROVISIONAL_OWNER_REVIEW-M1-DEVICE-LIMIT-DECREASE-20260921` remains open.
- M1-A future provider selection, checkout, pricing, legal acceptance,
  production billing and S1.2 external SMTP/DNS actions remain deferred.
- Q1-C owner/live testing, browser publication and Stream-2 integration remain
  separate lanes.

## Recommendation

This is an automated implementation candidate only; Codex does not self-accept
it. Recommended architect disposition: `M1B_READY_FOR_ARCHITECT_ACCEPTANCE`.
