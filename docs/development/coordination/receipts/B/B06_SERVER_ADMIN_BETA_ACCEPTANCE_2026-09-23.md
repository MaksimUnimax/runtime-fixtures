# B06 server/admin/support/beta acceptance candidate — 2026-09-23

Role: B
Task: B06
Status: SOURCE_CANDIDATE_READY_FOR_C_REVIEW
Overall B06 architectural/live acceptance: NOT CLAIMED.

## Revisions

- B06 implementation commit: `0c5866b838c04b708617af21c7a3d5b62ad477ce`.
- Controller/main reconciliation merges:
  - `c8af5eb0afb7a06a9171bb6f277d5a8c23afefa4`
  - `28a53c241bd7fd7149524f753fb1426559e5c28e`
- Fresh `origin/main` at final pre-publication check:
  `228bcbf21bf4ef812bdd70537a7a64f36e59cb42`, already in candidate ancestry.

## B06 fixes closed in source

### 1. Transaction-time authorization for support mutations

Support follow-up and transition writes now re-check `support.case.manage`
inside the same PostgreSQL transaction that performs the mutation. A stale
pre-handler/admin principal cannot continue mutating support state after a
concurrent role revocation.

### 2. Audit reason privacy at B-owned persistence boundaries

A shared DB-local `safeAuditReason()` applies the existing feedback text
redaction rules and a 512-character bound before operator-provided reasons are
persisted into `audit_events.reason`.

The sink is used across the affected B-owned beta/admin/commercial/profile
audit helpers, including beta admission, device revocation, P3 publication,
P4 plan/price/entitlement commands, P5 subscription commands, P6 admin ops,
P7 AI commands and profile lifecycle.

Business/domain reason fields were not silently rewritten; this patch targets
the audit persistence boundary only.

### 3. Feedback retention actually runs

The worker now contains a bounded `FeedbackRetentionRunner` and wires it into
the composite worker lifecycle.

- Retention periods continue to use the previously accepted B2
  `FEEDBACK_CLOSED_RETENTION_DAYS` /
  `FEEDBACK_SIGNAL_RETENTION_DAYS` authority and defaults.
- The runner performs one purge before arming its interval. If the first purge
  fails, startup fails closed and no orphan interval remains.
- Purge of closed cases is based on `closed_at`, not later mutable
  `updated_at`.
- Retention deletes are bounded to feedback/support records and signals.

### 4. Beta-admission and admin negative-path regressions

New/extended integration coverage proves:
- secret-shaped admin reasons are redacted before audit persistence;
- current server-side mutation permission is re-checked inside transactions;
- beta admission remains revision/requestId/audit controlled;
- current owner decisions (100 -> 200 -> 300 total-capacity waves) do not
  introduce any automatic opening or timer-based capacity change.

### 5. Pending device-authorization preview review

The independent B06 review flagged the pending authorization preview as
apparently account-unscoped. This was reviewed against the active activation
contract and is not changed in B06: before approval the authorization is not
yet attached to an account, the portal is intentionally entered by
`/activate?authorizationId=<uuid>`, the preview exposes only bounded
browser/version/device-label metadata, and approval separately requires the
user code plus OWNER authority for the selected account. Adding an account
predicate to the pending preview would break that contract.

## Verification on final executable diff

Toolchain: Node `v24.20.0`, pnpm `10.34.5`.

### Focused unit/static

- worker unit: 19/19 PASS
- DB unit: 31/31 PASS
- worker/db typecheck: PASS
- focused ESLint: PASS
- focused Prettier: PASS
- `git diff --check`: PASS

### Targeted PostgreSQL B06 matrix

12 sequential disposable-PostgreSQL suites: **447/447 PASS**.

Coverage includes feedback/support, beta admission, admin operations,
device management/revocation, P3 publication, P4 plan/price/entitlement,
P5 subscription persistence/lifecycle, and P7 admin-AI/profile lifecycle.

### Full server PostgreSQL integration

`pnpm test:integration` on the B disposable DB:

- Test Files: **52 passed (52)**
- Tests: **1631 passed (1631)**
- `HEAVY_SLOT_RELEASED exit=0`

Log:
`/root/octoport-control/logs/B/b06-full-integration.log`

### Package/API boundary

- `@product/feedback-support`: 16/16 PASS
- `@product/beta-access`: 2/2 PASS
- `@product/admin-ops`: 107/107 PASS
- `@product/api`: 249/249 PASS
- `@product/admin`: 157/157 PASS
- `@product/portal`: 38/38 PASS
- worker build: PASS
- API OpenAPI check: PASS

Log:
`/root/octoport-control/logs/B/b06-package-final.log`

### Full source-CI-like gate

The same tree completed with exit 0:

- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm openapi:check`
- `pnpm bridge:guard`
- `pnpm build`

Log:
`/root/octoport-control/logs/B/b06-server-source-ci.log`

### Fresh-main documentation gate

After merging current controller/owner documentation main:

`pnpm docs:check` PASS:
- files: 678
- markdownFiles: 391
- relativeLinks: 451
- requirements: 26
- acceptanceScenarios: 32

## Browser-level OTP smoke

The first broad E2E attempt is **not** counted as acceptance. It initially
collided with a running preprod portal on the default 3100 port. After moving
to dedicated B ports, the 195-test dev-server run accumulated severe memory
pressure, produced page crashes/DB connection loss and was stopped. No preprod
process was killed.

The auth path was then isolated safely:

- disposable B DB showed the OTP challenge consumed successfully;
- one user, account and portal session existed;
- beta test state was OPEN with ample synthetic capacity;
- challenge was not invalidated and had zero failed attempts;
- a temporary non-Git proxy harness proved the portal BFF forwards both
  `pcp_portal_session` and `pcp_csrf` Set-Cookie headers;
- after cleaning only B-owned E2E processes and restoring memory, the single
  Playwright test
  `OTP browser smoke establishes strict portal cookies`
  passed **1/1** on isolated ports 18102/18202/18302 with the guarded B test DB.

Final isolated-smoke log:
`/root/octoport-control/logs/B/b06-otp-smoke-isolated-v2.log`

The earlier broad E2E run is retained only as environment diagnostics, not as
a product failure or PASS.

## Open review / blocked action

### Audit retention authority conflict

B06 does **not** add automatic deletion of `audit_events`.

The active documentation currently conflicts:
- `DATA_AND_SECURITY` names 90 days as a technical admin-audit default;
- `DATA_MODEL` describes audit as append-only/long-lived and states retention
  policy direction is not finalized.

Deleting append-only audit rows without one authoritative policy would be an
architectural/data-retention change. B has requested controller review and
blocks that specific deletion action until authority is resolved.

### Live owner/admin access

Current owner-readiness documents reserve the real ADMIN_OWNER transfer and
mailbox OTP flow to the bounded controller/owner operation. B06 does not
activate beta, bypass CLOSED admission, create a user by SQL, use mailbox
credentials, or claim live owner/admin acceptance.

## Result

B06 executable source candidate is ready for C intake/review with strong
server, PostgreSQL, API, build and isolated browser evidence.

It is **not** self-declared as final B06 acceptance because audit retention
policy remains an explicit controller decision, and live owner/admin transfer
is a separate controlled operation.
