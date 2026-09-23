# B06 server/admin/support/beta acceptance candidate — 2026-09-23

Role: B
Task: B06
Status: SOURCE_CORRECTION_READY_FOR_C_REVIEW
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

## Controller correction — retention release blocker

Controller review reproduced process exit on a post-start purge rejection and concurrent purges still active after stop. The previous repository path also deleted all eligible rows and materialized every returned ID.

Correction code commit before this receipt: `dfdd6314b9faab2230a13854e0abf625d74ba053`.

The correction keeps one purge in flight, preserves fail-closed initial startup, handles later failures without an unhandled rejection or tight retry, and makes stop await the active purge before database shutdown. Each repository pass is bounded to 500 cases and 500 signals by default under a 5-second transaction-local PostgreSQL statement timeout, returns only aggregate counts, and preserves strict `< cutoff` semantics.

Final-tree checks:
- worker tests: 22/22 PASS, including 6 retention regressions;
- feedback-support unit: 16/16 PASS;
- DB unit: 31/31 PASS;
- worker and DB typecheck: PASS;
- focused ESLint and Prettier: PASS;
- worker build: PASS;
- disposable PostgreSQL feedback-support integration: 6/6 PASS;
- resource job `10cfbfe7f13d478283589d242975d51f`: exit 0, OOM 0, cleanup verified, peak 547356672 bytes;
- JSON evidence: `/root/octoport-control/logs/B/b06-retention-integration-final.json`.

`apps/worker/src/main.ts` adds only the retention error logger callback. C has an independent C04 notification-wiring change in `/root/octoport-control/worktrees/C/c04-runtime-monitoring-current`; C must preserve both meanings during integration.

An unrelated unfinished parent draft discovered during handoff was preserved as `preserve/B/B06-parent-draft-20260923` commit `35a91a9` and is explicitly NOT_ACCEPTED.

The controller has resolved the earlier audit-policy ambiguity: the 90-day technical beta default applies only to the explicit administrative-audit category. This correction does not implement audit-event deletion and does not authorize any historical or live purge.

## Remaining gates

The retention-policy question is resolved, but this source correction still does
**not** authorize deletion from `audit_events`, historical cleanup, a first live
purge, deployment, or beta opening. Those actions remain separate explicit gates.

The ADMIN_OWNER transfer has been independently verified by the controller.
Installed owner-profile marketplace import and browser/live acceptance remain
separate product gates and are not inferred from this server source candidate.

## Result

The corrected B06 source candidate is ready for exact C intake/review. The
controller-reproduced retention crash/overlap/unbounded-delete defect is covered
by source, unit, type, build and disposable-PostgreSQL evidence on the corrected
tree.

Overall architectural, deployment and production acceptance are **not claimed**.

## Controller retention defect correction — 2026-09-23

Controller evidence reproduced two release blockers in the previous B06 candidate: a post-start purge rejection could become an unhandled rejection (`exit=1`), and slow retention work overlapped (`maxActive=4`, `activeAfterStop=4`). The repository also deleted every eligible row and materialized every deleted id.

Corrected source now:
- keeps exactly one retention purge in flight;
- keeps initial purge failure fail-closed;
- catches/reports later scheduled failures and waits the normal interval before the next attempt;
- stops future scheduling and awaits the current purge before worker DB shutdown can proceed;
- bounds each repository pass to 500 rows per feedback class by default, with validated upper bounds, `FOR UPDATE SKIP LOCKED`, a transaction-local PostgreSQL statement timeout, and count-only result materialization;
- preserves strict `< cutoff` retention semantics so rows exactly at the configured boundary remain;
- leaves excess eligible rows for later scheduled passes instead of draining an unbounded backlog in one tick.

Exact implementation before final formatting: `d409939321e3a299f6bab11dcaa2a91d9d996f31`.
A separate pre-existing/incomplete parent draft was preserved without acceptance at `35a91a9` on `preserve/B/B06-parent-draft-20260923`; it is not part of this candidate.

Final-source verification on Node 24.20.0 / pnpm 10.34.5:
- worker tests: 22/22 PASS; retention runner subset is 6/6 within that suite;
- worker typecheck: PASS;
- DB typecheck: PASS;
- feedback-support tests: 16/16 PASS;
- DB unit tests: 31/31 PASS;
- focused ESLint: PASS;
- focused Prettier: PASS after formatting normalization;
- worker build: PASS;
- supervised disposable-PostgreSQL retention integration: 6/6 PASS, job `6a0610e732254337b11fa9585b8cf378`, exit 0, peak 524 MiB, OOM 0, cgroup cleanup verified.

Integration log: `/root/octoport-control/logs/B/b06-retention-integration-r2.log`.
No live/historical purge, live migration, production restart, or audit-events TTL change was performed.
